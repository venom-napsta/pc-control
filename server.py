from fastapi import FastAPI, HTTPException, Header, Request
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
import threading
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


@app.on_event("startup")
def on_startup():
    _get_session()


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
        ["pactl", "get-sink-volume", "@DEFAULT_SINK@"],
        capture_output=True, text=True, env=desk_env(),
    )
    match = re.search(r"(\d+)%", r.stdout)
    return {"level": int(match.group(1)) if match else 0}


@app.post("/volume")
def set_volume(body: VolumeBody, req: Request, x_pin: str = Header(...)):
    verify(x_pin)
    level = max(0, min(100, body.level))
    subprocess.run(
        ["pactl", "set-sink-volume", "@DEFAULT_SINK@", f"{level}%"],
        env=desk_env(),
    )
    audit(f"volume_{level}", req.client.host)
    return {"level": level}


# ── System Stats ────────────────────────────────────────
@app.get("/stats")
def get_stats(x_pin: str = Header(...)):
    verify(x_pin)
    cpu = psutil.cpu_percent(interval=1)
    mem = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    return {
        "cpu_percent": cpu,
        "ram_used_gb": round(mem.used / 1073741824, 1),
        "ram_total_gb": round(mem.total / 1073741824, 1),
        "ram_percent": mem.percent,
        "disk_used_gb": round(disk.used / 1073741824, 1),
        "disk_total_gb": round(disk.total / 1073741824, 1),
        "disk_percent": disk.percent,
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
    subprocess.run(["scrot", "-q", "60", path], env=desk_env())
    if not os.path.exists(path):
        raise HTTPException(500, "Screenshot failed — is scrot installed and DISPLAY correct?")
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
    r = subprocess.run(
        ["xdotool", "getactivewindow", "getwindowname"],
        capture_output=True, text=True, env=desk_env(),
    )
    return {"title": r.stdout.strip()}


# ── Clipboard ──────────────────────────────────────────
@app.get("/clipboard")
def get_clipboard(req: Request, x_pin: str = Header(...)):
    verify(x_pin)
    r = subprocess.run(
        ["xclip", "-selection", "clipboard", "-o"],
        capture_output=True, text=True, env=desk_env(),
    )
    audit("clipboard_read", req.client.host)
    return {"text": r.stdout}


@app.post("/clipboard")
def set_clipboard(body: ClipboardBody, req: Request, x_pin: str = Header(...)):
    verify(x_pin)
    subprocess.run(
        ["xclip", "-selection", "clipboard"],
        input=body.text, text=True, env=desk_env(),
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
    push("\U0001f6a8 Intruder Alert", "Wrong password entered on your PC!")
    return {"status": "alert_sent"}
