from fastapi import (
    FastAPI, Depends, File, Form, HTTPException, Header, Request, Query, UploadFile,
    WebSocket, WebSocketDisconnect,
)
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import subprocess
import logging
import ipaddress
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
import pwd
import shutil
import secrets
import fcntl
import termios
import signal
import asyncio
import hmac
import hashlib
import concurrent.futures
from pathlib import Path
from datetime import datetime
from typing import Optional
import urllib.request
from contextlib import asynccontextmanager
from dotenv import load_dotenv

log = logging.getLogger("pc_control")

# ── Config ──────────────────────────────────────────────
load_dotenv()
USERNAME = os.environ["LINUX_USER"]
UID = int(os.environ["LINUX_UID"])
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
AUDIT_LOG = os.path.join(BASE_DIR, "audit.log")
TOKEN_FILE = os.path.join(BASE_DIR, "push_token.json")
EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
SERVER_VERSION = "1.6.0"
STATIC_DIR = os.path.join(BASE_DIR, "static")
FAKE_BUSY_SCRIPT = os.path.join(BASE_DIR, "fake_busy.py")
INTRUDER_PHOTO = os.path.join(BASE_DIR, "intruder_photo.jpg")
# Seconds a successfully verified PIN is remembered before PAM is asked again.
# 0 disables the cache. See verify() for why this matters.
PIN_CACHE_TTL = int(os.environ.get("PIN_CACHE_TTL", "300"))
# PAM service used to check the PIN. "login" works out of the box but carries a
# multi-second failure delay and makes the intruder watcher fire on every
# mistyped PIN. Install pam/pc-control to /etc/pam.d/ and set PAM_SERVICE=pc-control.
PAM_SERVICE = os.environ.get("PAM_SERVICE", "login")
# Per-IP brute-force lockout: after AUTH_MAX_FAILURES wrong PINs the address is
# refused for AUTH_LOCKOUT_S seconds, doubling on each further strike.
AUTH_MAX_FAILURES = int(os.environ.get("AUTH_MAX_FAILURES", "5"))
AUTH_LOCKOUT_S = int(os.environ.get("AUTH_LOCKOUT_S", "60"))
AUTH_FAILURE_WINDOW_S = 600
# The terminal must send its PIN within this many seconds of connecting.
WS_AUTH_TIMEOUT_S = 5.0
# Session tokens: POST /login trades the PIN for one, and every poll then
# carries the token instead of the account password. Idle expiry, refreshed on
# each use; 0 disables /login entirely and forces PIN-on-every-request.
SESSION_TTL = int(os.environ.get("SESSION_TTL", str(8 * 3600)))
# Largest file the phone may push to the PC, streamed in chunks so a big one
# never sits in memory.
UPLOAD_MAX_BYTES = int(os.environ.get("UPLOAD_MAX_BYTES", str(512 * 1024 * 1024)))
UPLOAD_CHUNK = 1024 * 1024
# Images pushed onto the PC clipboard are capped far lower than a file upload:
# GPaste holds the whole thing in its history, and the realistic payload is a
# phone screenshot or a photo, not a disk image.
CLIPBOARD_IMAGE_MAX_BYTES = int(
    os.environ.get("CLIPBOARD_IMAGE_MAX_BYTES", str(32 * 1024 * 1024))
)

try:
    HOME = Path(pwd.getpwnam(USERNAME).pw_dir).resolve()
except KeyError:
    HOME = Path(f"/home/{USERNAME}")


# ── Access log noise ────────────────────────────────────
# The app polls these every few seconds. A successful GET on any of them says
# nothing worth a journal line; everything else (writes, errors, other paths)
# is kept.
QUIET_POLL_PATHS = frozenset({
    "/health", "/status", "/phone-watch/status", "/stats", "/bandwidth",
    "/active-window", "/webcam/status", "/volume", "/media/status",
    "/fake-busy/status",
})


class QuietPollingFilter(logging.Filter):
    """Drop uvicorn access records for 2xx/3xx GETs to QUIET_POLL_PATHS.

    uvicorn logs access lines with
    args = (client_addr, method, full_path, http_version, status_code).
    Anything not shaped like that passes through untouched.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if not isinstance(args, tuple) or len(args) != 5:
            return True
        _, method, full_path, _, status = args
        if method != "GET":
            return True
        try:
            status = int(status)
        except (TypeError, ValueError):
            return True
        if not 200 <= status < 400:
            return True
        path = str(full_path).split("?", 1)[0]
        return path not in QUIET_POLL_PATHS


_access_filter = QuietPollingFilter()
logging.getLogger("uvicorn.access").addFilter(_access_filter)


# ── Dynamic Session Detection ───────────────────────────
_ses_cache = {"id": None, "display": ":1", "type": "unknown", "ts": 0}
_ses_lock = threading.Lock()


def _detect_session():
    """Find the active graphical session for USERNAME.

    Returns (session_id, display, session_type); session_type is "x11",
    "wayland" or "unknown".
    """
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
                            log.debug("no X11 sockets to derive DISPLAY from", exc_info=True)
                    return sid, display or ":1", stype
        # Fallback: first session for user
        for line in r.stdout.strip().splitlines():
            cols = line.split()
            if len(cols) >= 3 and cols[2] == USERNAME:
                return cols[0], ":1", "unknown"
    except Exception:
        log.warning("graphical session detection failed", exc_info=True)
    return None, ":1", "unknown"


def _get_session():
    """Return (session_id, display), cached 30 s."""
    now = time.time()
    with _ses_lock:
        if now - _ses_cache["ts"] > 30 or _ses_cache["id"] is None:
            sid, display, stype = _detect_session()
            _ses_cache.update({"id": sid, "display": display, "type": stype, "ts": now})
    return _ses_cache["id"], _ses_cache["display"]


def _session_type() -> str:
    """"x11", "wayland" or "unknown"; refreshed together with the session cache."""
    _get_session()
    return _ses_cache["type"]


def _wayland_socket() -> str:
    """Name of the compositor socket in XDG_RUNTIME_DIR (grim needs it)."""
    socks = sorted(
        p.name for p in Path(f"/run/user/{UID}").glob("wayland-*")
        if not p.name.endswith(".lock")
    )
    return socks[0] if socks else "wayland-0"


def session_id():
    sid = _get_session()[0]
    if sid is None:
        raise HTTPException(503, "No active graphical session found")
    return sid


def desk_env():
    _, display = _get_session()
    env = {
        "PATH": "/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin",
        "DISPLAY": display,
        "XDG_RUNTIME_DIR": f"/run/user/{UID}",
        "DBUS_SESSION_BUS_ADDRESS": f"unix:path=/run/user/{UID}/bus",
        "HOME": f"/home/{USERNAME}",
        "USER": USERNAME,
        "LANG": "en_US.UTF-8",
    }
    if _session_type() == "wayland":
        env["WAYLAND_DISPLAY"] = _wayland_socket()
    return env


def run_cmd(cmd, *, timeout=5, desktop=False, input=None, check_tool=True):
    """subprocess.run for request handlers.

    Output is captured as text under `timeout` seconds, with the desktop
    session's environment when `desktop` is set and `input` fed to stdin.
    A missing binary becomes 503 and a hang 504 instead of a traceback.
    With check_tool=False a missing binary returns None instead, so a caller
    can fall through to an alternative tool.
    """
    kwargs = {"capture_output": True, "text": True, "timeout": timeout}
    if desktop:
        kwargs["env"] = desk_env()
    if input is not None:
        kwargs["input"] = input
    try:
        return subprocess.run(cmd, **kwargs)
    except FileNotFoundError:
        if not check_tool:
            return None
        raise HTTPException(503, f"{cmd[0]} is not installed on the PC")
    except subprocess.TimeoutExpired:
        raise HTTPException(504, f"{cmd[0]} did not respond")


# ── Request Models ──────────────────────────────────────
class VolumeBody(BaseModel):
    level: int

class NotifyBody(BaseModel):
    message: str

class ClipboardBody(BaseModel):
    text: str

class TokenBody(BaseModel):
    token: str
    device: Optional[str] = None

class FileDeleteBody(BaseModel):
    path: str
    permanent: bool = False

class WOLBody(BaseModel):
    mac: str
    broadcast: str = "255.255.255.255"


# ── Helpers ─────────────────────────────────────────────
# ── PIN verification ────────────────────────────────────
# A PAM round trip loads the whole "login" stack and takes hundreds of
# milliseconds (seconds on failure, by design). The app polls several
# endpoints every few seconds, so without a cache PAM dominates every request.
# Only *successful* PINs are remembered, keyed by an HMAC under a secret that
# lives for this process only, and PAM calls are serialised so a burst of
# parallel requests with the same PIN costs one PAM call, not four.
_pin_secret = os.urandom(32)
_pin_cache = {}  # hmac(pin) -> monotonic expiry
_pin_lock = threading.Lock()
_pam_lock = threading.Lock()


def _pin_key(pin: str) -> bytes:
    return hmac.new(_pin_secret, pin.encode(), hashlib.sha256).digest()


def _pin_cached(key: bytes) -> bool:
    if PIN_CACHE_TTL <= 0:
        return False
    with _pin_lock:
        exp = _pin_cache.get(key)
        return exp is not None and exp > time.monotonic()


def _pin_remember(key: bytes):
    if PIN_CACHE_TTL <= 0:
        return
    now = time.monotonic()
    with _pin_lock:
        _pin_cache[key] = now + PIN_CACHE_TTL
        for k in [k for k, e in _pin_cache.items() if e <= now]:
            del _pin_cache[k]


def verify(pin: str):
    key = _pin_key(pin)
    if _pin_cached(key):
        return
    with _pam_lock:
        if _pin_cached(key):  # verified by a concurrent request while we waited
            return
        ok = pam.pam().authenticate(USERNAME, pin, service=PAM_SERVICE)
    if not ok:
        raise HTTPException(401, "Invalid credentials")
    _pin_remember(key)


# ── Session tokens ──────────────────────────────────────
# Trading the PIN for a token keeps the Linux password off the wire on every
# poll, so a leaked log or a sniffed request costs a revocable session rather
# than the account. Tokens are 256-bit, kept only as an HMAC (a memory dump
# yields nothing replayable), live only in this process (a restart ends every
# session) and are deliberately NOT bound to a client address, because the app
# roams between the LAN, the hotspot and Tailscale mid-session.
_sessions = {}  # hmac(token) -> {"expires": monotonic, "device": str|None}
_session_lock = threading.Lock()


def _token_key(token: str) -> bytes:
    return hmac.new(_pin_secret, token.encode(), hashlib.sha256).digest()


def _session_new(device: Optional[str] = None) -> str:
    token = secrets.token_urlsafe(32)
    with _session_lock:
        _sessions[_token_key(token)] = {
            "expires": time.monotonic() + SESSION_TTL,
            "device": device,
        }
    return token


def _session_touch(token: str) -> bool:
    """True if the token is live; also slides its expiry forward."""
    if not token or SESSION_TTL <= 0:
        return False
    key = _token_key(token)
    now = time.monotonic()
    with _session_lock:
        rec = _sessions.get(key)
        if rec is None:
            return False
        if rec["expires"] <= now:
            del _sessions[key]
            return False
        rec["expires"] = now + SESSION_TTL
        for k in [k for k, r in _sessions.items() if r["expires"] <= now]:
            del _sessions[k]
        return True


def _session_revoke(token: str) -> bool:
    with _session_lock:
        return _sessions.pop(_token_key(token), None) is not None


def _session_revoke_all() -> int:
    with _session_lock:
        n = len(_sessions)
        _sessions.clear()
        return n


# ── Brute-force lockout ─────────────────────────────────
_auth_failures = {}  # ip -> {"count", "first", "until", "strikes"}
_auth_lock = threading.Lock()


def _lockout_remaining(ip: str) -> int:
    """Seconds this address is still locked out, 0 if it may try."""
    with _auth_lock:
        rec = _auth_failures.get(ip)
        if not rec:
            return 0
        now = time.monotonic()
        if rec["until"] > now:
            return int(rec["until"] - now) + 1
        if now - rec["first"] > AUTH_FAILURE_WINDOW_S:
            del _auth_failures[ip]
        return 0


def _record_failure(ip: str) -> float:
    """Count a wrong PIN. Returns the lockout length just imposed, or 0."""
    with _auth_lock:
        now = time.monotonic()
        rec = _auth_failures.get(ip)
        if not rec or now - rec["first"] > AUTH_FAILURE_WINDOW_S:
            rec = {"count": 0, "first": now, "until": 0.0, "strikes": 0}
            _auth_failures[ip] = rec
        rec["count"] += 1
        if rec["count"] >= AUTH_MAX_FAILURES:
            rec["strikes"] += 1
            lock_for = AUTH_LOCKOUT_S * (2 ** (rec["strikes"] - 1))
            rec["until"] = now + lock_for
            rec["count"] = 0
            return lock_for
        return 0


def _clear_failures(ip: str):
    with _auth_lock:
        _auth_failures.pop(ip, None)


async def check_pin(ip: str, pin: Optional[str]):
    """Lockout check + PAM verify, off the event loop. Raises 401 or 429."""
    if not pin:
        raise HTTPException(401, "Missing x-pin header")
    retry = _lockout_remaining(ip)
    if retry:
        raise HTTPException(
            429, f"Too many failed attempts. Try again in {retry}s",
            headers={"Retry-After": str(retry)},
        )
    try:
        await asyncio.to_thread(verify, pin)
    except HTTPException as e:
        if e.status_code == 401:
            locked = _record_failure(ip)
            audit("auth_failed_lockout" if locked else "auth_failed", ip)
        raise
    _clear_failures(ip)


async def require_auth(
    request: Request,
    x_pin: Optional[str] = Header(default=None),
    x_token: Optional[str] = Header(default=None),
):
    """Ordinary routes: a live session token, or the PIN.

    An unknown or expired token is 401 "Session expired" and does NOT count
    toward the lockout: a token that ages out mid-poll would otherwise lock the
    address out just as the app tries to sign in again.
    """
    if x_token:
        if _session_touch(x_token):
            return
        raise HTTPException(401, "Session expired")
    await check_pin(request.client.host if request.client else "unknown", x_pin)


async def require_pin(request: Request, x_pin: Optional[str] = Header(default=None)):
    """Destructive routes: the PIN itself, never a token.

    Shutdown, reboot, deleting files, clearing the audit log and the terminal
    all re-ask for the password, so a stolen token cannot do lasting damage.
    """
    await check_pin(request.client.host if request.client else "unknown", x_pin)


def audit(action: str, ip: str):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with open(AUDIT_LOG, "a") as f:
        f.write(f"{ts} | {action} | {ip}\n")


def _load_devices():
    """Registered push devices as [{"token": ..., "device": ...}].

    Accepts the legacy single-token file ({"token": "..."}) so existing
    installs keep working, and de-duplicates by token.
    """
    try:
        with open(TOKEN_FILE) as f:
            data = json.load(f)
    except (OSError, ValueError):
        return []
    if isinstance(data, dict):
        if isinstance(data.get("devices"), list):
            entries = data["devices"]
        elif data.get("token"):
            entries = [{"token": data["token"], "device": data.get("device")}]
        else:
            entries = []
    elif isinstance(data, list):
        entries = data
    else:
        entries = []
    devices, seen = [], set()
    for e in entries:
        tok = e.get("token") if isinstance(e, dict) else e
        if not tok or tok in seen:
            continue
        seen.add(tok)
        devices.append({"token": tok, "device": e.get("device") if isinstance(e, dict) else None})
    return devices


def _save_devices(devices):
    with open(TOKEN_FILE, "w") as f:
        json.dump({"devices": devices}, f)


def push(title: str, body: str, kind: Optional[str] = None):
    """Send an Expo push notification to every registered device.

    `kind` travels in the payload's data so a tap can open the relevant screen
    ("intruder" -> the photo, "audit" -> the log) instead of just the app.
    Devices Expo reports as DeviceNotRegistered (app uninstalled, token
    rotated) are dropped so the list does not grow stale.
    """
    devices = _load_devices()
    if not devices:
        return
    tokens = [d["token"] for d in devices]
    try:
        data = json.dumps({
            "to": tokens,
            "title": title,
            "body": body,
            "sound": "default",
            "data": {"kind": kind} if kind else {},
        }).encode()
        req = urllib.request.Request(
            EXPO_PUSH_URL,
            data=data,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            result = json.loads(resp.read().decode() or "{}")
    except Exception:
        log.warning("push notification to %d device(s) failed", len(tokens), exc_info=True)
        return
    tickets = result.get("data")
    if not isinstance(tickets, list) or len(tickets) != len(tokens):
        return
    dead = {
        tok for tok, t in zip(tokens, tickets)
        if isinstance(t, dict) and (t.get("details") or {}).get("error") == "DeviceNotRegistered"
    }
    if dead:
        _save_devices([d for d in devices if d["token"] not in dead])


# ── System Sampler ─────────────────────────────────────
# One background thread samples bandwidth and CPU every second so /stats and
# /bandwidth answer instantly instead of blocking inside psutil.
_bw_lock = threading.Lock()
_bw_data = {"up": 0, "down": 0, "cpu": 0.0, "ts": 0}
_STATIC_STATS = {
    "cpu_count": psutil.cpu_count(),
    "hostname": platform.node(),
    "kernel": platform.release(),
}


def _bandwidth_sampler():
    prev = psutil.net_io_counters()
    psutil.cpu_percent(interval=None)  # prime: first call always returns 0
    while True:
        time.sleep(1)
        curr = psutil.net_io_counters()
        cpu = psutil.cpu_percent(interval=None)
        with _bw_lock:
            _bw_data["up"] = curr.bytes_sent - prev.bytes_sent
            _bw_data["down"] = curr.bytes_recv - prev.bytes_recv
            _bw_data["cpu"] = cpu
            _bw_data["ts"] = time.time()
        prev = curr


# ── Fake Busy State ────────────────────────────────────
_fake_busy_proc = None
_fake_busy_lock = threading.Lock()  # two concurrent starts must not spawn two windows


# ── Network scan resolver pool ─────────────────────────
# One pool for the whole process. A pool per request left its worker threads
# behind whenever a lookup outlived SCAN_RESOLVE_BUDGET_S.
_scan_pool = concurrent.futures.ThreadPoolExecutor(max_workers=16, thread_name_prefix="scan-resolve")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await asyncio.to_thread(_get_session)
    threading.Thread(target=_bandwidth_sampler, daemon=True, name="sampler").start()
    yield


app = FastAPI(lifespan=lifespan)

# xterm.js and its CSS, so the terminal works with no internet on the phone's
# network. Library code only, nothing private, hence no PIN.
if not os.path.isdir(STATIC_DIR):
    log.warning("static asset directory %s is missing; /static will 404", STATIC_DIR)
app.mount("/static", StaticFiles(directory=STATIC_DIR, check_dir=False), name="static")


# ── Session ─────────────────────────────────────────────
@app.post("/login")
async def login(
    request: Request,
    x_pin: Optional[str] = Header(default=None),
    x_device: Optional[str] = Header(default=None),
):
    """Trade the PIN for a session token."""
    if SESSION_TTL <= 0:
        raise HTTPException(503, "Session tokens are disabled on this server")
    await check_pin(request.client.host if request.client else "unknown", x_pin)
    token = _session_new(x_device)
    audit("login", request.client.host)
    return {"token": token, "expires_in": SESSION_TTL, "token_header": "x-token"}


@app.post("/logout")
def logout(request: Request, x_token: Optional[str] = Header(default=None)):
    """Revoke this session. Unknown tokens answer 200: logout is idempotent."""
    revoked = bool(x_token) and _session_revoke(x_token)
    if revoked:
        audit("logout", request.client.host)
    return {"status": "logged_out", "revoked": revoked}


@app.post("/sessions/revoke-all")
def revoke_all_sessions(request: Request, _auth: None = Depends(require_pin)):
    """Panic button: end every session on every device. Needs the PIN."""
    n = _session_revoke_all()
    audit("sessions_revoked", request.client.host)
    return {"status": "revoked", "sessions": n}


# ── Health (no auth) ────────────────────────────────────
@app.get("/health")
def health():
    """Reachability probe. The app tries every saved address against this
    and talks to whichever answers first, so no address is hardcoded."""
    return {
        "ok": True,
        "service": "pc-control",
        "host": platform.node(),
        "version": SERVER_VERSION,
        "sessions": SESSION_TTL > 0,
    }


# ── Status ──────────────────────────────────────────────
@app.get("/status")
def get_status(_auth: None = Depends(require_auth)):
    r = run_cmd(["loginctl", "show-session", session_id(), "-p", "LockedHint", "--value"])
    return {"locked": r.stdout.strip() == "yes"}


# ── Lock / Unlock ───────────────────────────────────────
@app.post("/lock")
def lock(req: Request, _auth: None = Depends(require_auth)):
    run_cmd(["loginctl", "lock-session", session_id()])
    audit("lock", req.client.host)
    return {"status": "locked"}


@app.post("/unlock")
def unlock(req: Request, _auth: None = Depends(require_auth)):
    run_cmd(["loginctl", "unlock-session", session_id()])
    audit("unlock", req.client.host)
    return {"status": "unlocked"}


# ── Phone Watch ─────────────────────────────────────────
@app.get("/phone-watch/status")
def phone_watch_status(_auth: None = Depends(require_auth)):
    r = run_cmd(["systemctl", "--user", "is-active", "phone_watch"])
    return {"active": r.stdout.strip() == "active"}


@app.post("/phone-watch/toggle")
def phone_watch_toggle(req: Request, _auth: None = Depends(require_auth)):
    r = run_cmd(["systemctl", "--user", "is-active", "phone_watch"])
    if r.stdout.strip() == "active":
        run_cmd(["systemctl", "--user", "stop", "phone_watch"])
        audit("phone_watch_off", req.client.host)
        return {"active": False}
    else:
        run_cmd(["systemctl", "--user", "start", "phone_watch"])
        audit("phone_watch_on", req.client.host)
        return {"active": True}


# ── Shutdown / Reboot ───────────────────────────────────
@app.post("/shutdown")
def shutdown(req: Request, _auth: None = Depends(require_pin)):
    audit("shutdown", req.client.host)
    subprocess.Popen(["sudo", "shutdown", "now"])
    return {"status": "shutting_down"}


@app.post("/reboot")
def reboot(req: Request, _auth: None = Depends(require_pin)):
    audit("reboot", req.client.host)
    subprocess.Popen(["sudo", "reboot"])
    return {"status": "rebooting"}


# ── Volume ──────────────────────────────────────────────
@app.get("/volume")
def get_volume(_auth: None = Depends(require_auth)):
    r = run_cmd(["wpctl", "get-volume", "@DEFAULT_AUDIO_SINK@"], desktop=True)
    match = re.search(r"Volume:\s+([\d.]+)", r.stdout)
    return {"level": round(float(match.group(1)) * 100) if match else 0}


@app.post("/volume")
def set_volume(body: VolumeBody, req: Request, _auth: None = Depends(require_auth)):
    level = body.level
    if not 0 <= level <= 100:
        raise HTTPException(400, "level must be between 0 and 100")
    run_cmd(["wpctl", "set-volume", "@DEFAULT_AUDIO_SINK@", f"{level / 100:.2f}"], desktop=True)
    audit(f"volume_{level}", req.client.host)
    return {"level": level}


# ── Media Playback ─────────────────────────────────────
def _media_state():
    """Playback state plus whatever metadata the active player exposes.

    playerctl exits non-zero when no player is running, which is a normal
    state, not an error, so the fields simply come back empty.
    """
    r = run_cmd(["playerctl", "status"], desktop=True)
    status = r.stdout.strip().lower()
    state = {"playing": status == "playing", "player": "", "title": "", "artist": "", "album": ""}
    if not status or "no players" in (r.stderr or "").lower():
        return state
    # One call for every field: playerctl prints empty lines for what is missing.
    meta = run_cmd(
        ["playerctl", "metadata", "--format",
         "{{playerName}}\n{{title}}\n{{artist}}\n{{album}}"],
        desktop=True,
    )
    if meta.returncode == 0:
        parts = (meta.stdout.rstrip("\n").split("\n") + ["", "", "", ""])[:4]
        state["player"], state["title"], state["artist"], state["album"] = (p.strip() for p in parts)
    return state


@app.get("/media/status")
def media_status(_auth: None = Depends(require_auth)):
    return _media_state()


@app.post("/media/toggle")
def media_toggle(req: Request, _auth: None = Depends(require_auth)):
    run_cmd(["playerctl", "play-pause"], desktop=True)
    audit("media_toggle", req.client.host)
    return _media_state()


@app.post("/media/next")
def media_next(req: Request, _auth: None = Depends(require_auth)):
    run_cmd(["playerctl", "next"], desktop=True)
    audit("media_next", req.client.host)
    return _media_state()


@app.post("/media/previous")
def media_previous(req: Request, _auth: None = Depends(require_auth)):
    run_cmd(["playerctl", "previous"], desktop=True)
    audit("media_previous", req.client.host)
    return _media_state()


# ── System Stats ────────────────────────────────────────
@app.get("/stats")
def get_stats(_auth: None = Depends(require_auth)):
    with _bw_lock:
        cpu = _bw_data["cpu"]
    mem = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    boot = datetime.fromtimestamp(psutil.boot_time())
    up = int((datetime.now() - boot).total_seconds())
    h, m = divmod(up, 3600)[0], divmod(up % 3600, 60)[0]
    return {
        "cpu_percent": cpu,
        "ram_used_gb": round(mem.used / 1073741824, 1),
        "ram_total_gb": round(mem.total / 1073741824, 1),
        "ram_percent": mem.percent,
        "disk_used_gb": round(disk.used / 1073741824, 1),
        "disk_total_gb": round(disk.total / 1073741824, 1),
        "disk_percent": disk.percent,
        "uptime": f"{h}h {m}m",
        **_STATIC_STATS,
    }


# ── Desktop Notification ───────────────────────────────
@app.post("/notify")
def notify(body: NotifyBody, req: Request, _auth: None = Depends(require_auth)):
    run_cmd(["notify-send", "PC Control", body.message], desktop=True)
    audit("notify", req.client.host)
    return {"status": "sent"}


# ── Screenshot ──────────────────────────────────────────
def _capture_screen(path: str):
    """Write a screenshot to `path` with whatever the session type allows."""
    if _session_type() == "wayland":
        # X11 tools cannot see a Wayland desktop; ask the compositor instead.
        # gnome-screenshot and grim both write PNG whatever the extension.
        ran_any = False
        for cmd in (["gnome-screenshot", "-f", path], ["grim", path]):
            if run_cmd(cmd, timeout=10, desktop=True, check_tool=False) is None:
                continue  # not installed, try the next tool
            ran_any = True
            if os.path.exists(path):
                return
        if not ran_any:
            raise HTTPException(
                501, "Screenshots on Wayland need gnome-screenshot or grim installed on the PC"
            )
    else:
        run_cmd(["import", "-window", "root", "-quality", "60", "-resize", "50%", path],
                timeout=10, desktop=True)
    if not os.path.exists(path):
        raise HTTPException(500, "Screenshot failed — is the DISPLAY correct?")


@app.get("/screenshot")
def screenshot(req: Request, _auth: None = Depends(require_auth)):
    fd, path = tempfile.mkstemp(suffix=".jpg")
    os.close(fd)
    os.unlink(path)
    try:
        _capture_screen(path)
        with open(path, "rb") as f:
            raw = f.read()
    finally:
        if os.path.exists(path):
            os.unlink(path)
    audit("screenshot", req.client.host)
    fmt = "png" if raw.startswith(b"\x89PNG\r\n\x1a\n") else "jpeg"
    return {"image": base64.b64encode(raw).decode(), "format": fmt}


@app.get("/screenshot.jpg")
def screenshot_raw(req: Request, _auth: None = Depends(require_auth)):
    """The capture as an image response.

    Base64 inside JSON costs a third more bytes and makes the phone parse a
    multi-megabyte string; an <Image> can consume this directly.
    """
    fd, path = tempfile.mkstemp(suffix=".jpg")
    os.close(fd)
    os.unlink(path)
    _capture_screen(path)
    with open(path, "rb") as f:
        raw = f.read()
    os.unlink(path)
    audit("screenshot", req.client.host)
    media = "image/png" if raw.startswith(b"\x89PNG\r\n\x1a\n") else "image/jpeg"
    return Response(content=raw, media_type=media, headers={"Cache-Control": "no-store"})


# ── Active Window ───────────────────────────────────────
@app.get("/active-window")
def active_window(_auth: None = Depends(require_auth)):
    if _session_type() == "wayland":
        # No _NET_ACTIVE_WINDOW on Wayland. Answer 200 so the app's poll does
        # not surface an error every few seconds; it can hide the field instead.
        return {"title": "", "unsupported": "wayland"}
    r = run_cmd(["xprop", "-root", "_NET_ACTIVE_WINDOW"], desktop=True)
    match = re.search(r"window id # (0x[\da-fA-F]+)", r.stdout)
    if not match:
        return {"title": ""}
    wid = match.group(1)
    r2 = run_cmd(["xprop", "-id", wid, "_NET_WM_NAME"], desktop=True)
    name_match = re.search(r'"(.+)"', r2.stdout)
    return {"title": name_match.group(1) if name_match else ""}


# ── Clipboard ──────────────────────────────────────────
@app.get("/clipboard")
def get_clipboard(req: Request, _auth: None = Depends(require_auth)):
    r = run_cmd(["gpaste-client", "history"], desktop=True)
    first = r.stdout.strip().splitlines()[0] if r.stdout.strip() else ""
    uuid = first.split(":")[0].strip() if first else ""
    text = ""
    if uuid:
        text = run_cmd(["gpaste-client", "get", uuid], desktop=True).stdout
    audit("clipboard_read", req.client.host)
    return {"text": text}


@app.post("/clipboard")
def set_clipboard(body: ClipboardBody, req: Request, _auth: None = Depends(require_auth)):
    # `whatever | gpaste-client` sets the clipboard from stdin. argv has a size
    # limit and would also expose the text in the process list.
    run_cmd(["gpaste-client"], desktop=True, input=body.text)
    audit("clipboard_write", req.client.host)
    return {"status": "set"}


# Magic numbers for the formats GdkPixbuf (and so GPaste) reads. The bytes are
# sniffed rather than the upload's declared Content-Type trusted: the file is
# handed to another program, so "is this really an image" must not be the
# client's word. WebP and TIFF carry their marker past the first bytes.
_IMAGE_MAGIC = (
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"\xff\xd8\xff", "jpg"),
    (b"GIF87a", "gif"),
    (b"GIF89a", "gif"),
    (b"BM", "bmp"),
)


def _sniff_image(head: bytes) -> Optional[str]:
    """File extension for a recognised image, or None for anything else."""
    for magic, ext in _IMAGE_MAGIC:
        if head.startswith(magic):
            return ext
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    if head[:4] in (b"II*\x00", b"MM\x00*"):
        return "tiff"
    return None


@app.post("/clipboard/image")
async def set_clipboard_image(
    req: Request,
    file: UploadFile = File(...),
    _auth: None = Depends(require_auth),
):
    """Put an image from the phone onto the PC's clipboard, ready to paste.

    `gpaste-client file` hands the image to the GPaste daemon, which copies it
    into its own history and owns the X selection from then on -- so the temp
    file here is deleted immediately afterwards and the clipboard survives it.
    That daemon ownership is also why this needs no xclip: nothing has to stay
    running on our side to serve the selection.
    """
    first = await file.read(UPLOAD_CHUNK)
    ext = _sniff_image(first)
    if ext is None:
        raise HTTPException(415, "That does not look like an image")

    limit_mb = CLIPBOARD_IMAGE_MAX_BYTES // (1024 * 1024)
    fd, tmp_name = tempfile.mkstemp(prefix="pc-control-clip-", suffix=f".{ext}")
    tmp = Path(tmp_name)
    written = 0
    try:
        # mkstemp gives 0600, which is what we want: the image passes through
        # a world-readable directory on its way to the clipboard.
        with os.fdopen(fd, "wb") as out:
            chunk = first
            while chunk:
                written += len(chunk)
                if written > CLIPBOARD_IMAGE_MAX_BYTES:
                    raise HTTPException(413, f"Image is larger than the {limit_mb} MB limit")
                out.write(chunk)
                chunk = await file.read(UPLOAD_CHUNK)

        r = run_cmd(["gpaste-client", "file", str(tmp)], desktop=True, timeout=15)
        if r.returncode != 0:
            detail = (r.stderr or r.stdout or "").strip() or "gpaste-client refused the image"
            raise HTTPException(502, f"Could not set the clipboard: {detail}")
    finally:
        tmp.unlink(missing_ok=True)

    audit("clipboard_image", req.client.host)
    return {"status": "set", "format": ext, "size": written}


# ── Audit Log ──────────────────────────────────────────
@app.get("/audit")
def get_audit(_auth: None = Depends(require_auth)):
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
def clear_audit(req: Request, _auth: None = Depends(require_pin)):
    # Rotate rather than delete: the previous log survives as audit.log.1, so
    # a clear cannot be used to hide what was done before it.
    if os.path.exists(AUDIT_LOG):
        os.replace(AUDIT_LOG, AUDIT_LOG + ".1")
    audit("audit_cleared", req.client.host)
    return {"status": "cleared"}


# ── Push Token Registration ────────────────────────────
@app.post("/register-token")
def register_token(body: TokenBody, req: Request, _auth: None = Depends(require_auth)):
    devices = _load_devices()
    for d in devices:
        if d["token"] == body.token:
            if body.device:
                d["device"] = body.device
            break
    else:
        devices.append({"token": body.token, "device": body.device})
    _save_devices(devices)
    audit("push_register", req.client.host)
    return {"status": "registered", "devices": len(devices)}


# ── Intruder Alert (localhost only) ────────────────────
@app.post("/intruder")
def intruder(req: Request):
    if req.client.host not in ("127.0.0.1", "::1"):
        raise HTTPException(403, "Local only")
    audit("intruder_alert", req.client.host)
    has_photo = False
    try:
        run_cmd(
            ["ffmpeg", "-f", "v4l2", "-i", "/dev/video0",
             "-frames:v", "1", "-y", "-loglevel", "quiet", INTRUDER_PHOTO],
            timeout=5, desktop=True,
        )
        has_photo = os.path.exists(INTRUDER_PHOTO) and os.path.getsize(INTRUDER_PHOTO) > 0
    except HTTPException as e:
        log.warning("intruder photo not captured: %s", e.detail)
    except OSError:
        log.warning("intruder photo not captured", exc_info=True)
    push(
        "\U0001f6a8 Intruder Alert",
        "Wrong password entered on your PC!" + (" Photo captured." if has_photo else ""),
        kind="intruder",
    )
    return {"status": "alert_sent", "photo": has_photo}


@app.get("/intruder/photo")
def intruder_photo(req: Request, _auth: None = Depends(require_auth)):
    if not os.path.exists(INTRUDER_PHOTO):
        raise HTTPException(404, "No intruder photo available")
    with open(INTRUDER_PHOTO, "rb") as f:
        data = base64.b64encode(f.read()).decode()
    ts = datetime.fromtimestamp(os.path.getmtime(INTRUDER_PHOTO)).strftime("%Y-%m-%d %H:%M:%S")
    audit("intruder_photo_view", req.client.host)
    return {"image": data, "timestamp": ts}


# ── File Browser ──────────────────────────────────────
def _confine(raw: str) -> Path:
    """Resolve a client-supplied path and refuse anything outside HOME.

    A plain string-prefix check would also admit /home/<user>2/...; symlinks
    are resolved so ~/x -> /etc is rejected too.
    """
    p = Path(raw).expanduser()
    if not p.is_absolute():
        p = HOME / p
    resolved = p.resolve()
    if not resolved.is_relative_to(HOME):
        raise HTTPException(403, "Access restricted to home directory")
    return resolved


def _downloads_dir() -> Path:
    """The user's Downloads folder, created if it does not exist yet.

    Read from ~/.config/user-dirs.dirs rather than assumed, because the folder
    is localised and relocatable -- but a relocation outside HOME is ignored,
    so this can never widen where an upload may land.
    """
    configured = None
    try:
        with open(HOME / ".config" / "user-dirs.dirs") as f:
            for line in f:
                line = line.strip()
                if not line.startswith("XDG_DOWNLOAD_DIR="):
                    continue
                raw = line.split("=", 1)[1].strip().strip('"').strip("'")
                configured = raw.replace("$HOME", str(HOME)).replace("${HOME}", str(HOME))
    except OSError:
        pass

    target = Path(configured) if configured else HOME / "Downloads"
    if not target.is_absolute():
        target = HOME / target
    target = target.resolve()
    if not target.is_relative_to(HOME):
        target = (HOME / "Downloads").resolve()

    target.mkdir(parents=True, exist_ok=True)
    return target


# Named upload destinations the phone may ask for without knowing the path.
_UPLOAD_DESTS = {"downloads": _downloads_dir, "home": lambda: HOME}


def _trash(p: Path) -> bool:
    """Move to the desktop Trash via gio. False if that is not possible."""
    try:
        r = subprocess.run(
            ["gio", "trash", str(p)],
            capture_output=True, text=True, timeout=10, env=desk_env(),
        )
        return r.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


@app.get("/files")
def list_files(path: str = Query(default=None), _auth: None = Depends(require_auth)):
    p = _confine(path) if path else HOME
    if not p.exists():
        raise HTTPException(404, "Not found")
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
    return {"path": str(p), "parent": str(p.parent) if p != HOME else None, "entries": entries}


@app.get("/files/download")
def download_file(req: Request, path: str = Query(...), _auth: None = Depends(require_auth)):
    p = _confine(path)
    if not p.is_file():
        raise HTTPException(404, "File not found")
    audit("file_download", req.client.host)
    return FileResponse(str(p), filename=p.name)


@app.post("/files/upload")
async def upload_file(
    req: Request,
    file: UploadFile = File(...),
    path: str = Form(default=None),
    dest: str = Form(default=None),
    _auth: None = Depends(require_auth),
):
    """Receive a file from the phone into a directory inside HOME.

    Streamed to disk in chunks and capped at UPLOAD_MAX_BYTES; a partial
    transfer is removed rather than left behind. An existing name is never
    overwritten, it gains a " (2)" style suffix.

    Target is an explicit `path`, or a named `dest` ("downloads"/"home") for a
    caller that wants a well-known folder without having to know where it is --
    Downloads is localised and relocatable, so only the PC can resolve it.
    """
    if path:
        target_dir = _confine(path)
    elif dest:
        resolve = _UPLOAD_DESTS.get(dest.strip().lower())
        if resolve is None:
            raise HTTPException(400, f"Unknown upload destination {dest!r}")
        target_dir = resolve()
    else:
        target_dir = HOME
    if not target_dir.is_dir():
        raise HTTPException(400, "Upload target is not a directory")

    # Trust only the basename: a client-supplied "../" must not escape.
    name = os.path.basename(file.filename or "").strip() or "upload"
    dest = _confine(str(target_dir / name))
    if dest.parent != target_dir:
        raise HTTPException(403, "Access restricted to home directory")

    stem, suffix = os.path.splitext(dest.name)
    n = 2
    while dest.exists():
        dest = target_dir / f"{stem} ({n}){suffix}"
        n += 1

    written = 0
    try:
        with open(dest, "wb") as out:
            while chunk := await file.read(UPLOAD_CHUNK):
                written += len(chunk)
                if written > UPLOAD_MAX_BYTES:
                    raise HTTPException(
                        413, f"File is larger than the {UPLOAD_MAX_BYTES // (1024 * 1024)} MB limit"
                    )
                out.write(chunk)
    except Exception:
        if dest.exists():
            dest.unlink()
        raise
    audit("file_upload", req.client.host)
    return {"status": "uploaded", "path": str(dest), "name": dest.name, "size": written}


@app.post("/files/delete")
def delete_file(body: FileDeleteBody, req: Request, _auth: None = Depends(require_pin)):
    raw = Path(body.path).expanduser()
    if not raw.is_absolute():
        raw = HOME / raw
    # A symlink is removed as a link. Resolving it first would delete the
    # target instead, which may be a whole directory tree elsewhere in HOME.
    if raw.is_symlink():
        link = raw.parent.resolve() / raw.name
        if not link.is_relative_to(HOME):
            raise HTTPException(403, "Access restricted to home directory")
        link.unlink()
        audit("file_delete", req.client.host)
        return {"status": "deleted", "path": str(link), "symlink": True}

    p = _confine(body.path)
    if p == HOME:
        raise HTTPException(400, "Refusing to delete the home directory itself")
    if not p.exists():
        raise HTTPException(404, "Not found")

    if not body.permanent:
        if _trash(p):
            audit("file_trash", req.client.host)
            return {"status": "trashed", "path": str(p)}
        raise HTTPException(503, "Trash is unavailable on the PC. Retry with permanent=true to delete for good.")

    if p.is_dir():
        shutil.rmtree(p)
    else:
        p.unlink()
    audit("file_delete", req.client.host)
    return {"status": "deleted", "path": str(p)}


# ── Network Scan ──────────────────────────────────────
SCAN_RESOLVE_BUDGET_S = 6  # total time allowed for all hostname lookups


def _resolve_host(ip: str) -> str:
    try:
        return socket.gethostbyaddr(ip)[0]
    except Exception:
        log.debug("reverse DNS for %s failed", ip, exc_info=True)
    try:
        ar = subprocess.run(
            ["avahi-resolve", "-a", ip],
            capture_output=True, text=True, timeout=2,
        )
        if ar.returncode == 0 and ar.stdout.strip():
            return ar.stdout.strip().split()[-1].rstrip(".")
    except Exception:
        log.debug("mDNS lookup for %s failed", ip, exc_info=True)
    return ""


def _neighbours():
    """(ip, mac) pairs from the kernel neighbour table, de-duplicated by ip."""
    r = run_cmd(["ip", "neigh", "show"], timeout=10)
    found, seen = [], set()
    for line in r.stdout.strip().splitlines():
        parts = line.split()
        if len(parts) < 4 or parts[-1] in ("FAILED", "INCOMPLETE"):
            continue
        ip = parts[0]
        mac = next((p.lower() for p in parts if re.match(r"([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}", p)), "")
        if mac and ip not in seen:
            seen.add(ip)
            found.append((ip, mac))
    return found


@app.get("/network/scan")
def network_scan(req: Request, _auth: None = Depends(require_auth)):
    found = _neighbours()
    # Reverse DNS has no timeout of its own and used to run one host at a time,
    # so a dozen unresolvable devices meant a scan of half a minute or more.
    # Resolve everything in parallel under one overall budget; stragglers
    # simply come back without a hostname.
    names = {}
    if found:
        futures = {_scan_pool.submit(_resolve_host, ip): ip for ip, _ in found}
        done, pending = concurrent.futures.wait(futures, timeout=SCAN_RESOLVE_BUDGET_S)
        for f in pending:
            f.cancel()  # not started yet: never will be. Running ones finish on their own.
        for f in done:
            if f.exception() is None:
                names[futures[f]] = f.result()
    devices = [{"ip": ip, "mac": mac, "hostname": names.get(ip, "")} for ip, mac in found]
    audit("network_scan", req.client.host)
    return {"devices": devices}


# ── Bandwidth ─────────────────────────────────────────
@app.get("/bandwidth")
def get_bandwidth(_auth: None = Depends(require_auth)):
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
def webcam_status(_auth: None = Depends(require_auth)):
    video_devices = sorted(Path("/dev").glob("video*"))
    if not video_devices:
        return {"available": False, "active": False, "processes": []}
    dev = str(video_devices[0])
    r = run_cmd(["fuser", dev])
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
def webcam_kill(req: Request, _auth: None = Depends(require_auth)):
    video_devices = sorted(Path("/dev").glob("video*"))
    if not video_devices:
        raise HTTPException(404, "No webcam device found")
    run_cmd(["fuser", "-k", str(video_devices[0])])
    audit("webcam_kill", req.client.host)
    return {"status": "killed"}


# ── Uptime History ────────────────────────────────────
@app.get("/uptime/history")
def uptime_history(_auth: None = Depends(require_auth)):
    r = run_cmd(["last", "-x", "-F", "reboot"])
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
def fake_busy_start(req: Request, _auth: None = Depends(require_auth)):
    global _fake_busy_proc
    with _fake_busy_lock:
        if _fake_busy_proc and _fake_busy_proc.poll() is None:
            return {"status": "already_active"}
        if not os.path.exists(FAKE_BUSY_SCRIPT):
            raise HTTPException(500, "fake_busy.py script not found")
        try:
            _fake_busy_proc = subprocess.Popen(["python3", FAKE_BUSY_SCRIPT], env=desk_env())
        except OSError:
            log.warning("could not launch the fake busy screen", exc_info=True)
            raise HTTPException(500, "Could not launch the fake busy screen")
    audit("fake_busy_on", req.client.host)
    return {"status": "activated"}


@app.post("/fake-busy/dismiss")
def fake_busy_dismiss(req: Request, _auth: None = Depends(require_auth)):
    global _fake_busy_proc
    with _fake_busy_lock:
        if _fake_busy_proc and _fake_busy_proc.poll() is None:
            _fake_busy_proc.terminate()
            try:
                _fake_busy_proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                log.warning("fake busy screen ignored SIGTERM, killing it")
                _fake_busy_proc.kill()
        _fake_busy_proc = None
    audit("fake_busy_off", req.client.host)
    return {"status": "dismissed"}


@app.get("/fake-busy/status")
def fake_busy_status(_auth: None = Depends(require_auth)):
    proc = _fake_busy_proc
    return {"active": proc is not None and proc.poll() is None}


# ── Wake on LAN ──────────────────────────────────────
@app.post("/wol")
def wake_on_lan(body: WOLBody, req: Request, _auth: None = Depends(require_auth)):
    mac = body.mac.replace(":", "").replace("-", "")
    if len(mac) != 12:
        raise HTTPException(400, "Invalid MAC address")
    try:
        mac_bytes = bytes.fromhex(mac)
    except ValueError:
        raise HTTPException(400, "Invalid MAC address format")
    try:
        target = ipaddress.ip_address(body.broadcast)
    except ValueError:
        raise HTTPException(400, "Invalid broadcast address")
    if target.version != 4:
        raise HTTPException(400, "Broadcast address must be IPv4")
    magic = b"\xff" * 6 + mac_bytes * 16
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        s.sendto(magic, (str(target), 9))
    audit("wol", req.client.host)
    return {"status": "magic_packet_sent", "mac": body.mac}


# ── Snapshot ────────────────────────────────────────────
# Home polls /status + /phone-watch/status and Monitor polls /stats +
# /bandwidth + /active-window + /webcam/status, every 5 s. Each one spawns a
# process, so this runs them together in the thread pool and answers once.
SNAPSHOT_PARTS = {
    "status": get_status,
    "phone_watch": phone_watch_status,
    "stats": get_stats,
    "bandwidth": get_bandwidth,
    "active_window": active_window,
    "webcam": webcam_status,
    "volume": get_volume,
    "media": media_status,
    "fake_busy": fake_busy_status,
}


@app.get("/snapshot")
async def snapshot(parts: str = Query(default=None), _auth: None = Depends(require_auth)):
    """Several status reads in one round trip.

    `?parts=status,stats` limits the work; omitting it returns everything.
    A part that fails carries its own {"error": ...} rather than failing the
    whole response, so one broken tool cannot blank the dashboard.
    """
    wanted = SNAPSHOT_PARTS
    if parts:
        names = [n.strip() for n in parts.split(",") if n.strip()]
        unknown = [n for n in names if n not in SNAPSHOT_PARTS]
        if unknown:
            raise HTTPException(400, f"Unknown snapshot part(s): {', '.join(unknown)}")
        wanted = {n: SNAPSHOT_PARTS[n] for n in names}

    def run_part(fn):
        try:
            return fn(_auth=None)
        except HTTPException as e:
            return {"error": e.detail, "status": e.status_code}
        except Exception as e:
            log.warning("snapshot part failed", exc_info=True)
            return {"error": str(e)}

    results = await asyncio.gather(*(asyncio.to_thread(run_part, fn) for fn in wanted.values()))
    return dict(zip(wanted.keys(), results))


# ── Live Terminal (WebSocket) ─────────────────────────
@app.websocket("/ws/terminal")
async def ws_terminal(ws: WebSocket):
    await ws.accept()
    ip = ws.client.host if ws.client else "unknown"
    # The PIN arrives as the first frame, {"pin": "..."}. It must never be in the
    # URL: uvicorn writes every WebSocket URL, query string included, to the journal.
    try:
        first = await asyncio.wait_for(ws.receive_text(), timeout=WS_AUTH_TIMEOUT_S)
        pin = json.loads(first).get("pin", "")
        await check_pin(ip, pin)
    except Exception:
        try:
            await ws.close(code=4001, reason="Unauthorized")
        except Exception:
            log.debug("terminal already gone before the 4001 close", exc_info=True)
        return
    audit("terminal_open", ip)

    master_fd, slave_fd = pty.openpty()
    env = desk_env()
    env["TERM"] = "xterm-256color"
    env["SHELL"] = "/bin/bash"

    proc = subprocess.Popen(
        ["/bin/bash", "-l"],
        stdin=slave_fd, stdout=slave_fd, stderr=slave_fd,
        preexec_fn=os.setsid,
        env=env,
        cwd=str(HOME),
    )
    os.close(slave_fd)

    fl = fcntl.fcntl(master_fd, fcntl.F_GETFL)
    fcntl.fcntl(master_fd, fcntl.F_SETFL, fl | os.O_NONBLOCK)

    # The event loop wakes us when the pty has output instead of us polling it
    # every 20 ms. Chunks go through a queue so one task sends them in order.
    loop = asyncio.get_running_loop()
    out_q: asyncio.Queue = asyncio.Queue()

    def on_pty_readable():
        try:
            data = os.read(master_fd, 65536)
        except BlockingIOError:
            return
        except OSError:  # EIO: the shell exited and the slave side is closed
            data = b""
        if not data:
            loop.remove_reader(master_fd)
        out_q.put_nowait(data)

    async def pty_writer():
        try:
            while True:
                data = await out_q.get()
                if not data:
                    break
                await ws.send_bytes(data)
        except Exception:
            log.debug("terminal output stream ended", exc_info=True)

    loop.add_reader(master_fd, on_pty_readable)
    writer = asyncio.create_task(pty_writer())

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
                        try:
                            rows, cols = (int(x) for x in cmd[7:].split(",")[:2])
                        except ValueError:
                            continue  # malformed resize: ignore, keep the session
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
        log.warning("terminal session for %s ended with an error", ip, exc_info=True)
    finally:
        loop.remove_reader(master_fd)
        writer.cancel()
        try:
            os.close(master_fd)
        except OSError:
            pass
        try:
            # bash was started with setsid, so signal the whole process group:
            # backgrounded children must not outlive the terminal.
            os.killpg(os.getpgid(proc.pid), signal.SIGHUP)
            await asyncio.to_thread(proc.wait, 3)
        except Exception:
            log.debug("terminal shell did not exit on SIGHUP, killing it", exc_info=True)
            try:
                proc.kill()
            except Exception:
                log.debug("terminal shell could not be killed", exc_info=True)
        audit("terminal_close", ip)
