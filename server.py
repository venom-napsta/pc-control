from fastapi import FastAPI, HTTPException, Header, Request, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from pydantic import BaseModel
import subprocess
import pam
import psutil
import os
import re
import json
import base64
import tempfile
import time
import platform
import threading
import socket
import struct
import pty
import fcntl
import termios
import signal
import asyncio
from pathlib import Path
from datetime import datetime
import urllib.request
from dotenv import load_dotenv

app = FastAPI()

# ── Config ──────────────────────────────────────────────
load_dotenv()
USERNAME = os.environ["LINUX_USER"]
UID = int(os.environ["LINUX_UID"])
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
AUDIT_LOG = os.path.join(BASE_DIR, "audit.log")
TOKEN_FILE = os.path.join(BASE_DIR, "push_token.json")


# ── Dynamic Session Detection ───────────────────────────
_ses_cache = {"id": None, "display": ":1", "ts": 0}
_ses_lock = threading.Lock()


def _detect_session():
    """Find active graphical session ID and DISPLAY for USERNAME."""
    try:
        r = subprocess.run(
            ["loginctl", "list-sessions", "--no-legend"],
            capture_output=True, text=True, timeout=5,
        )
        for line in r.stdout.strip().splitlines():
            cols = line.split()
            if len(cols) >= 3 and cols[2] == USERNAME:
                sid = cols[0]
                stype = subprocess.run(
                    ["loginctl", "show-session", sid, "-p", "Type", "--value"],
                    capture_output=True, text=True, timeout=5,
                ).stdout.strip()
                if stype in ("x11", "wayland"):
                    display = subprocess.run(
                        ["loginctl", "show-session", sid, "-p", "Display", "--value"],
                        capture_output=True, text=True, timeout=5,
                    ).stdout.strip()
                    if not display:
                        # Fallback: detect from X11 sockets
                        try:
                            socks = os.listdir("/tmp/.X11-unix")
                            nums = sorted(
                                [int(s[1:]) for s in socks if s.startswith("X")],
                                reverse=True,
                            )
                            if nums:
                                display = f":{nums[0]}"
                        except OSError:
                            pass
                    return sid, display or ":1"
        # Fallback: first session for user
        for line in r.stdout.strip().splitlines():
            cols = line.split()
            if len(cols) >= 3 and cols[2] == USERNAME:
                return cols[0], ":1"
    except Exception:
        pass
    return None, ":1"


def _get_session():
    """Return (session_id, display), cached 30 s."""
    now = time.time()
    with _ses_lock:
        if now - _ses_cache["ts"] > 30 or _ses_cache["id"] is None:
            sid, display = _detect_session()
            _ses_cache.update({"id": sid, "display": display, "ts": now})
    return _ses_cache["id"], _ses_cache["display"]


def session_id():
    sid = _get_session()[0]
    if sid is None:
        raise HTTPException(503, "No active graphical session found")
    return sid


def desk_env():
    _, display = _get_session()
    return {
        "PATH": "/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin",
        "DISPLAY": display,
        "XDG_RUNTIME_DIR": f"/run/user/{UID}",
        "DBUS_SESSION_BUS_ADDRESS": f"unix:path=/run/user/{UID}/bus",
        "HOME": f"/home/{USERNAME}",
        "USER": USERNAME,
        "LANG": "en_US.UTF-8",
    }


# ── Request Models ──────────────────────────────────────
class VolumeBody(BaseModel):
    level: int

class NotifyBody(BaseModel):
    message: str

class ClipboardBody(BaseModel):
    text: str

class TokenBody(BaseModel):
    token: str

class FileDeleteBody(BaseModel):
    path: str

class WOLBody(BaseModel):
    mac: str
    broadcast: str = "255.255.255.255"


# ── Helpers ─────────────────────────────────────────────
def verify(pin: str):
    p = pam.pam()
    if not p.authenticate(USERNAME, pin):
        raise HTTPException(401, "Invalid credentials")


def audit(action: str, ip: str):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with open(AUDIT_LOG, "a") as f:
        f.write(f"{ts} | {action} | {ip}\n")


def push(title: str, body: str):
    """Send Expo push notification to the registered device."""
    try:
        with open(TOKEN_FILE) as f:
            token = json.load(f).get("token")
        if not token:
            return
        data = json.dumps({
            "to": token,
            "title": title,
            "body": body,
            "sound": "default",
        }).encode()
        req = urllib.request.Request(
            "https://exp.host/--/api/v2/push/send",
            data=data,
            headers={"Content-Type": "application/json"},
        )
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass


# ── Bandwidth Sampler ──────────────────────────────────
_bw_lock = threading.Lock()
_bw_data = {"up": 0, "down": 0, "ts": 0}


def _bandwidth_sampler():
    prev = psutil.net_io_counters()
    while True:
        time.sleep(1)
        curr = psutil.net_io_counters()
        with _bw_lock:
            _bw_data["up"] = curr.bytes_sent - prev.bytes_sent
            _bw_data["down"] = curr.bytes_recv - prev.bytes_recv
            _bw_data["ts"] = time.time()
        prev = curr


# ── Fake Busy State ────────────────────────────────────
_fake_busy_proc = None


@app.on_event("startup")
def on_startup():
    _get_session()
    threading.Thread(target=_bandwidth_sampler, daemon=True).start()


# ── Status ──────────────────────────────────────────────
@app.get("/status")
def get_status(x_pin: str = Header(...)):
    verify(x_pin)
    r = subprocess.run(
        ["loginctl", "show-session", session_id(), "-p", "LockedHint", "--value"],
        capture_output=True, text=True,
    )
    return {"locked": r.stdout.strip() == "yes"}


# ── Lock / Unlock ───────────────────────────────────────
@app.post("/lock")
def lock(req: Request, x_pin: str = Header(...)):
    verify(x_pin)
    subprocess.run(["loginctl", "lock-session", session_id()])
    audit("lock", req.client.host)
    return {"status": "locked"}


@app.post("/unlock")
def unlock(req: Request, x_pin: str = Header(...)):
    verify(x_pin)
    subprocess.run(["loginctl", "unlock-session", session_id()])
    audit("unlock", req.client.host)
    return {"status": "unlocked"}


# ── Phone Watch ─────────────────────────────────────────
@app.get("/phone-watch/status")
def phone_watch_status(x_pin: str = Header(...)):
    verify(x_pin)
    r = subprocess.run(
        ["systemctl", "--user", "is-active", "phone_watch"],
        capture_output=True, text=True,
    )
    return {"active": r.stdout.strip() == "active"}


@app.post("/phone-watch/toggle")
def phone_watch_toggle(req: Request, x_pin: str = Header(...)):
    verify(x_pin)
    r = subprocess.run(
        ["systemctl", "--user", "is-active", "phone_watch"],
        capture_output=True, text=True,
    )
    if r.stdout.strip() == "active":
        subprocess.run(["systemctl", "--user", "stop", "phone_watch"])
        audit("phone_watch_off", req.client.host)
        return {"active": False}
    else:
        subprocess.run(["systemctl", "--user", "start", "phone_watch"])
        audit("phone_watch_on", req.client.host)
        return {"active": True}


# ── Shutdown / Reboot ───────────────────────────────────
@app.post("/shutdown")
def shutdown(req: Request, x_pin: str = Header(...)):
    verify(x_pin)
    audit("shutdown", req.client.host)
    subprocess.Popen(["sudo", "shutdown", "now"])
    return {"status": "shutting_down"}


@app.post("/reboot")
def reboot(req: Request, x_pin: str = Header(...)):
    verify(x_pin)
    audit("reboot", req.client.host)
    subprocess.Popen(["sudo", "reboot"])
    return {"status": "rebooting"}


# ── Volume ──────────────────────────────────────────────
@app.get("/volume")
def get_volume(x_pin: str = Header(...)):
    verify(x_pin)
    r = subprocess.run(
        ["wpctl", "get-volume", "@DEFAULT_AUDIO_SINK@"],
        capture_output=True, text=True, env=desk_env(),
    )
    match = re.search(r"Volume:\s+([\d.]+)", r.stdout)
    return {"level": round(float(match.group(1)) * 100) if match else 0}


@app.post("/volume")
def set_volume(body: VolumeBody, req: Request, x_pin: str = Header(...)):
    verify(x_pin)
    level = max(0, min(100, body.level))
    subprocess.run(
        ["wpctl", "set-volume", "@DEFAULT_AUDIO_SINK@", f"{level / 100:.2f}"],
        env=desk_env(),
    )
    audit(f"volume_{level}", req.client.host)
    return {"level": level}


# ── Media Playback ─────────────────────────────────────
@app.get("/media/status")
def media_status(x_pin: str = Header(...)):
    verify(x_pin)
    r = subprocess.run(
        ["playerctl", "status"],
        capture_output=True, text=True, env=desk_env(),
    )
    status = r.stdout.strip().lower()
    return {"playing": status == "playing"}


@app.post("/media/toggle")
def media_toggle(req: Request, x_pin: str = Header(...)):
    verify(x_pin)
    subprocess.run(["playerctl", "play-pause"], env=desk_env())
    r = subprocess.run(
        ["playerctl", "status"],
        capture_output=True, text=True, env=desk_env(),
    )
    status = r.stdout.strip().lower()
    audit("media_toggle", req.client.host)
    return {"playing": status == "playing"}


# ── System Stats ────────────────────────────────────────
@app.get("/stats")
def get_stats(x_pin: str = Header(...)):
    verify(x_pin)
    cpu = psutil.cpu_percent(interval=1)
    mem = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    boot = datetime.fromtimestamp(psutil.boot_time())
    up = int((datetime.now() - boot).total_seconds())
    h, m = divmod(up, 3600)[0], divmod(up % 3600, 60)[0]
    return {
        "cpu_percent": cpu,
        "cpu_count": psutil.cpu_count(),
        "ram_used_gb": round(mem.used / 1073741824, 1),
        "ram_total_gb": round(mem.total / 1073741824, 1),
        "ram_percent": mem.percent,
        "disk_used_gb": round(disk.used / 1073741824, 1),
        "disk_total_gb": round(disk.total / 1073741824, 1),
        "disk_percent": disk.percent,
        "hostname": platform.node(),
        "kernel": platform.release(),
        "uptime": f"{h}h {m}m",
    }


# ── Desktop Notification ───────────────────────────────
@app.post("/notify")
def notify(body: NotifyBody, req: Request, x_pin: str = Header(...)):
    verify(x_pin)
    subprocess.run(["notify-send", "PC Control", body.message], env=desk_env())
    audit("notify", req.client.host)
    return {"status": "sent"}


# ── Screenshot ──────────────────────────────────────────
@app.get("/screenshot")
def screenshot(req: Request, x_pin: str = Header(...)):
    verify(x_pin)
    fd, path = tempfile.mkstemp(suffix=".jpg")
    os.close(fd)
    os.unlink(path)
    subprocess.run(
        ["import", "-window", "root", "-quality", "60", "-resize", "50%", path],
        env=desk_env(), timeout=10,
    )
    if not os.path.exists(path):
        raise HTTPException(500, "Screenshot failed — is ImageMagick installed and DISPLAY correct?")
    try:
        with open(path, "rb") as f:
            data = base64.b64encode(f.read()).decode()
    finally:
        if os.path.exists(path):
            os.unlink(path)
    audit("screenshot", req.client.host)
    return {"image": data}


# ── Active Window ───────────────────────────────────────
@app.get("/active-window")
def active_window(x_pin: str = Header(...)):
    verify(x_pin)
    env = desk_env()
    r = subprocess.run(
        ["xprop", "-root", "_NET_ACTIVE_WINDOW"],
        capture_output=True, text=True, env=env,
    )
    match = re.search(r"window id # (0x[\da-fA-F]+)", r.stdout)
    if not match:
        return {"title": ""}
    wid = match.group(1)
    r2 = subprocess.run(
        ["xprop", "-id", wid, "_NET_WM_NAME"],
        capture_output=True, text=True, env=env,
    )
    name_match = re.search(r'"(.+)"', r2.stdout)
    return {"title": name_match.group(1) if name_match else ""}


# ── Clipboard ──────────────────────────────────────────
@app.get("/clipboard")
def get_clipboard(req: Request, x_pin: str = Header(...)):
    verify(x_pin)
    env = desk_env()
    r = subprocess.run(
        ["gpaste-client", "history"],
        capture_output=True, text=True, env=env,
    )
    first = r.stdout.strip().splitlines()[0] if r.stdout.strip() else ""
    uuid = first.split(":")[0].strip() if first else ""
    text = ""
    if uuid:
        r2 = subprocess.run(
            ["gpaste-client", "get", uuid],
            capture_output=True, text=True, env=env,
        )
        text = r2.stdout
    audit("clipboard_read", req.client.host)
    return {"text": text}


@app.post("/clipboard")
def set_clipboard(body: ClipboardBody, req: Request, x_pin: str = Header(...)):
    verify(x_pin)
    subprocess.run(
        ["gpaste-client", "add", body.text],
        env=desk_env(),
    )
    audit("clipboard_write", req.client.host)
    return {"status": "set"}


# ── Audit Log ──────────────────────────────────────────
@app.get("/audit")
def get_audit(x_pin: str = Header(...)):
    verify(x_pin)
    if not os.path.exists(AUDIT_LOG):
        return {"entries": []}
    with open(AUDIT_LOG) as f:
        lines = f.readlines()
    entries = []
    for line in lines[-50:]:
        parts = line.strip().split(" | ")
        if len(parts) == 3:
            entries.append({"timestamp": parts[0], "action": parts[1], "ip": parts[2]})
    return {"entries": entries}


@app.post("/audit/clear")
def clear_audit(req: Request, x_pin: str = Header(...)):
    verify(x_pin)
    if os.path.exists(AUDIT_LOG):
        os.remove(AUDIT_LOG)
    audit("audit_cleared", req.client.host)
    return {"status": "cleared"}


# ── Push Token Registration ────────────────────────────
@app.post("/register-token")
def register_token(body: TokenBody, x_pin: str = Header(...)):
    verify(x_pin)
    with open(TOKEN_FILE, "w") as f:
        json.dump({"token": body.token}, f)
    return {"status": "registered"}


# ── Intruder Alert (localhost only) ────────────────────
@app.post("/intruder")
def intruder(req: Request):
    if req.client.host not in ("127.0.0.1", "::1"):
        raise HTTPException(403, "Local only")
    audit("intruder_alert", req.client.host)
    photo_path = os.path.join(BASE_DIR, "intruder_photo.jpg")
    has_photo = False
    try:
        subprocess.run(
            ["ffmpeg", "-f", "v4l2", "-i", "/dev/video0",
             "-frames:v", "1", "-y", "-loglevel", "quiet", photo_path],
            capture_output=True, timeout=5, env=desk_env(),
        )
        has_photo = os.path.exists(photo_path) and os.path.getsize(photo_path) > 0
    except Exception:
        pass
    push(
        "\U0001f6a8 Intruder Alert",
        "Wrong password entered on your PC!" + (" Photo captured." if has_photo else ""),
    )
    return {"status": "alert_sent", "photo": has_photo}


@app.get("/intruder/photo")
def intruder_photo(x_pin: str = Header(...)):
    verify(x_pin)
    photo_path = os.path.join(BASE_DIR, "intruder_photo.jpg")
    if not os.path.exists(photo_path):
        raise HTTPException(404, "No intruder photo available")
    with open(photo_path, "rb") as f:
        data = base64.b64encode(f.read()).decode()
    ts = datetime.fromtimestamp(os.path.getmtime(photo_path)).strftime("%Y-%m-%d %H:%M:%S")
    return {"image": data, "timestamp": ts}


# ── File Browser ──────────────────────────────────────
@app.get("/files")
def list_files(path: str = Query(default=None), x_pin: str = Header(...)):
    verify(x_pin)
    home = Path(f"/home/{USERNAME}").resolve()
    p = Path(path).resolve() if path else home
    if not str(p).startswith(str(home)):
        raise HTTPException(403, "Access restricted to home directory")
    if not p.is_dir():
        raise HTTPException(400, "Not a directory")
    entries = []
    for item in sorted(p.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
        try:
            stat = item.stat()
            entries.append({
                "name": item.name,
                "path": str(item),
                "is_dir": item.is_dir(),
                "size": stat.st_size if item.is_file() else 0,
                "modified": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M"),
                "hidden": item.name.startswith("."),
            })
        except (PermissionError, OSError):
            continue
    return {"path": str(p), "parent": str(p.parent) if p != home else None, "entries": entries}


@app.get("/files/download")
def download_file(path: str = Query(...), x_pin: str = Header(...)):
    verify(x_pin)
    p = Path(path).resolve()
    home = Path(f"/home/{USERNAME}").resolve()
    if not str(p).startswith(str(home)):
        raise HTTPException(403, "Access restricted to home directory")
    if not p.is_file():
        raise HTTPException(404, "File not found")
    return FileResponse(str(p), filename=p.name)


@app.post("/files/delete")
def delete_file(body: FileDeleteBody, req: Request, x_pin: str = Header(...)):
    verify(x_pin)
    p = Path(body.path).resolve()
    home = Path(f"/home/{USERNAME}").resolve()
    if not str(p).startswith(str(home)):
        raise HTTPException(403, "Access restricted to home directory")
    if not p.exists():
        raise HTTPException(404, "Not found")
    import shutil
    if p.is_dir():
        shutil.rmtree(str(p))
    else:
        p.unlink()
    audit("file_delete", req.client.host)
    return {"status": "deleted", "path": str(p)}


# ── Network Scan ──────────────────────────────────────
@app.get("/network/scan")
def network_scan(req: Request, x_pin: str = Header(...)):
    verify(x_pin)
    r = subprocess.run(["ip", "neigh", "show"], capture_output=True, text=True, timeout=10)
    devices = []
    seen = set()
    for line in r.stdout.strip().splitlines():
        parts = line.split()
        if len(parts) < 4:
            continue
        ip = parts[0]
        state = parts[-1]
        if state in ("FAILED", "INCOMPLETE"):
            continue
        mac = ""
        for p in parts:
            if re.match(r"([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}", p):
                mac = p.lower()
                break
        if mac and ip not in seen:
            seen.add(ip)
            hostname = ""
            try:
                hostname = socket.gethostbyaddr(ip)[0]
            except Exception:
                pass
            if not hostname:
                try:
                    ar = subprocess.run(
                        ["avahi-resolve", "-a", ip],
                        capture_output=True, text=True, timeout=2,
                    )
                    if ar.returncode == 0 and ar.stdout.strip():
                        hostname = ar.stdout.strip().split()[-1].rstrip(".")
                except Exception:
                    pass
            devices.append({"ip": ip, "mac": mac, "hostname": hostname})
    audit("network_scan", req.client.host)
    return {"devices": devices}


# ── Bandwidth ─────────────────────────────────────────
@app.get("/bandwidth")
def get_bandwidth(x_pin: str = Header(...)):
    verify(x_pin)
    with _bw_lock:
        data = dict(_bw_data)
    counters = psutil.net_io_counters()
    return {
        "upload_speed": data["up"],
        "download_speed": data["down"],
        "total_sent": counters.bytes_sent,
        "total_recv": counters.bytes_recv,
    }


# ── Webcam ────────────────────────────────────────────
@app.get("/webcam/status")
def webcam_status(x_pin: str = Header(...)):
    verify(x_pin)
    video_devices = sorted(Path("/dev").glob("video*"))
    if not video_devices:
        return {"available": False, "active": False, "processes": []}
    dev = str(video_devices[0])
    r = subprocess.run(["fuser", dev], capture_output=True, text=True)
    pids = r.stdout.strip().split() if r.stdout.strip() else []
    processes = []
    for pid_str in pids:
        try:
            p = psutil.Process(int(pid_str.strip()))
            processes.append({"pid": p.pid, "name": p.name()})
        except (psutil.NoSuchProcess, ValueError):
            pass
    return {"available": True, "active": len(processes) > 0, "processes": processes}


@app.post("/webcam/kill")
def webcam_kill(req: Request, x_pin: str = Header(...)):
    verify(x_pin)
    video_devices = sorted(Path("/dev").glob("video*"))
    if not video_devices:
        raise HTTPException(404, "No webcam device found")
    subprocess.run(["fuser", "-k", str(video_devices[0])], capture_output=True)
    audit("webcam_kill", req.client.host)
    return {"status": "killed"}


# ── Uptime History ────────────────────────────────────
@app.get("/uptime/history")
def uptime_history(x_pin: str = Header(...)):
    verify(x_pin)
    r = subprocess.run(
        ["last", "-x", "-F", "reboot"],
        capture_output=True, text=True,
    )
    boots = []
    for line in r.stdout.strip().splitlines():
        if not line.startswith("reboot"):
            continue
        m = re.search(
            r"(\w{3} \w{3}\s+\d+ \d{2}:\d{2}:\d{2} \d{4})\s+-\s+(.*?)\s+\(",
            line,
        )
        if m:
            boot_time = m.group(1).strip()
            end_str = m.group(2).strip()
            running = "running" in end_str
            boots.append({
                "boot": boot_time,
                "end": None if running else end_str,
                "running": running,
            })
    return {"boots": boots[:30]}


# ── Fake Busy Screen ─────────────────────────────────
@app.post("/fake-busy")
def fake_busy_start(req: Request, x_pin: str = Header(...)):
    global _fake_busy_proc
    verify(x_pin)
    if _fake_busy_proc and _fake_busy_proc.poll() is None:
        return {"status": "already_active"}
    script = os.path.join(BASE_DIR, "fake_busy.py")
    if not os.path.exists(script):
        raise HTTPException(500, "fake_busy.py script not found")
    _fake_busy_proc = subprocess.Popen(["python3", script], env=desk_env())
    audit("fake_busy_on", req.client.host)
    return {"status": "activated"}


@app.post("/fake-busy/dismiss")
def fake_busy_dismiss(req: Request, x_pin: str = Header(...)):
    global _fake_busy_proc
    verify(x_pin)
    if _fake_busy_proc and _fake_busy_proc.poll() is None:
        _fake_busy_proc.terminate()
        try:
            _fake_busy_proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            _fake_busy_proc.kill()
        _fake_busy_proc = None
    audit("fake_busy_off", req.client.host)
    return {"status": "dismissed"}


@app.get("/fake-busy/status")
def fake_busy_status(x_pin: str = Header(...)):
    verify(x_pin)
    active = _fake_busy_proc is not None and _fake_busy_proc.poll() is None
    return {"active": active}


# ── Wake on LAN ──────────────────────────────────────
@app.post("/wol")
def wake_on_lan(body: WOLBody, req: Request, x_pin: str = Header(...)):
    verify(x_pin)
    mac = body.mac.replace(":", "").replace("-", "")
    if len(mac) != 12:
        raise HTTPException(400, "Invalid MAC address")
    try:
        mac_bytes = bytes.fromhex(mac)
    except ValueError:
        raise HTTPException(400, "Invalid MAC address format")
    magic = b"\xff" * 6 + mac_bytes * 16
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        s.sendto(magic, (body.broadcast, 9))
    audit("wol", req.client.host)
    return {"status": "magic_packet_sent", "mac": body.mac}


# ── Live Terminal (WebSocket) ─────────────────────────
@app.websocket("/ws/terminal")
async def ws_terminal(ws: WebSocket):
    pin = ws.query_params.get("pin", "")
    try:
        verify(pin)
    except HTTPException:
        await ws.close(code=4001, reason="Unauthorized")
        return

    await ws.accept()
    audit("terminal_open", ws.client.host if ws.client else "unknown")

    master_fd, slave_fd = pty.openpty()
    env = desk_env()
    env["TERM"] = "xterm-256color"
    env["SHELL"] = "/bin/bash"

    proc = subprocess.Popen(
        ["/bin/bash", "-l"],
        stdin=slave_fd, stdout=slave_fd, stderr=slave_fd,
        preexec_fn=os.setsid,
        env=env,
        cwd=f"/home/{USERNAME}",
    )
    os.close(slave_fd)

    fl = fcntl.fcntl(master_fd, fcntl.F_GETFL)
    fcntl.fcntl(master_fd, fcntl.F_SETFL, fl | os.O_NONBLOCK)

    stop = asyncio.Event()

    async def pty_reader():
        try:
            while not stop.is_set():
                try:
                    data = os.read(master_fd, 4096)
                    if data:
                        await ws.send_bytes(data)
                except BlockingIOError:
                    await asyncio.sleep(0.02)
                except OSError:
                    break
        except Exception:
            pass

    reader = asyncio.create_task(pty_reader())

    try:
        while True:
            msg = await ws.receive()
            if msg["type"] == "websocket.disconnect":
                break
            if "bytes" in msg and msg["bytes"]:
                raw = msg["bytes"]
                if raw[:1] == b"\x01":
                    cmd = raw[1:].decode()
                    if cmd.startswith("RESIZE:"):
                        parts = cmd[7:].split(",")
                        rows, cols = int(parts[0]), int(parts[1])
                        winsize = struct.pack("HHHH", rows, cols, 0, 0)
                        fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)
                        os.kill(proc.pid, signal.SIGWINCH)
                else:
                    os.write(master_fd, raw)
            elif "text" in msg and msg["text"]:
                os.write(master_fd, msg["text"].encode())
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        stop.set()
        reader.cancel()
        try:
            os.close(master_fd)
        except OSError:
            pass
        try:
            os.kill(proc.pid, signal.SIGHUP)
            proc.wait(timeout=3)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        audit("terminal_close", ws.client.host if ws.client else "unknown")
