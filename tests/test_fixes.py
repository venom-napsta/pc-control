"""Server-side fixes: one subprocess helper, Wayland awareness, logging,
audit gaps, input validation, lifecycle and the self-hosted terminal assets."""
import asyncio.selector_events
import base64
import json
import logging
import threading
import time
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import server
from conftest import audit_actions

H = {"x-pin": "x"}
OK = SimpleNamespace(stdout="", stderr="", returncode=0)


def no_audit_yet():
    """True when nothing has been audited (the log is created on first write)."""
    import os
    return not os.path.exists(server.AUDIT_LOG)


@pytest.fixture
def session(monkeypatch):
    """Pin the session type without running loginctl. Usage: session("wayland")."""
    def pin(kind):
        monkeypatch.setattr(server, "_get_session", lambda: ("3", ":1"))
        monkeypatch.setattr(server, "_session_type", lambda: kind)
    return pin


@pytest.fixture
def recorded_run(monkeypatch):
    """Stub subprocess.run; `calls` collects (cmd, kwargs). `reply(cmd, kw)` can be
    swapped to shape stdout per command."""
    state = {"calls": [], "reply": lambda cmd, kw: OK}

    def fake_run(cmd, **kw):
        state["calls"].append((list(cmd), kw))
        return state["reply"](cmd, kw)

    monkeypatch.setattr(server.subprocess, "run", fake_run)

    class Handle:
        calls = state["calls"]

        def reply_with(self, fn):
            state["reply"] = fn

        def cmds(self, name):
            return [c for c, _ in state["calls"] if c and c[0] == name]

    return Handle()


# ── 1. run_cmd ──────────────────────────────────────────

def test_missing_binary_is_503(client, accept_any_pin, monkeypatch):
    def missing(cmd, **kw):
        raise FileNotFoundError(cmd[0])
    monkeypatch.setattr(server.subprocess, "run", missing)
    r = client.get("/volume", headers=H)
    assert r.status_code == 503
    assert r.json()["detail"] == "wpctl is not installed on the PC"


def test_hung_binary_is_504(client, accept_any_pin, monkeypatch):
    def hangs(cmd, **kw):
        raise server.subprocess.TimeoutExpired(cmd, kw.get("timeout", 5))
    monkeypatch.setattr(server.subprocess, "run", hangs)
    r = client.get("/uptime/history", headers=H)
    assert r.status_code == 504
    assert r.json()["detail"] == "last did not respond"


def test_run_cmd_passes_timeout_env_and_stdin(recorded_run, session):
    session("x11")
    server.run_cmd(["tool", "arg"], timeout=7, desktop=True, input="payload")
    cmd, kw = recorded_run.calls[-1]
    assert cmd == ["tool", "arg"]
    assert kw["timeout"] == 7 and kw["capture_output"] and kw["text"]
    assert kw["input"] == "payload"
    assert kw["env"]["DISPLAY"] and "WAYLAND_DISPLAY" not in kw["env"]
    server.run_cmd(["plain"])
    _, kw = recorded_run.calls[-1]
    assert "env" not in kw and "input" not in kw and kw["timeout"] == 5


def test_run_cmd_check_tool_false_returns_none_for_missing_binary(monkeypatch):
    def missing(cmd, **kw):
        raise FileNotFoundError(cmd[0])
    monkeypatch.setattr(server.subprocess, "run", missing)
    assert server.run_cmd(["nope"], check_tool=False) is None
    with pytest.raises(server.HTTPException) as exc:
        server.run_cmd(["nope"])
    assert exc.value.status_code == 503


# ── 2. Wayland ──────────────────────────────────────────

def test_active_window_on_wayland_is_200_and_marked_unsupported(client, accept_any_pin, recorded_run, session):
    session("wayland")
    r = client.get("/active-window", headers=H)
    assert r.status_code == 200
    assert r.json() == {"title": "", "unsupported": "wayland"}
    assert recorded_run.cmds("xprop") == []


def test_active_window_on_x11_still_uses_xprop(client, accept_any_pin, recorded_run, session):
    session("x11")

    def xprop(cmd, kw):
        if cmd[:2] == ["xprop", "-root"]:
            return SimpleNamespace(stdout="_NET_ACTIVE_WINDOW(WINDOW): window id # 0x3a00007\n", returncode=0)
        if cmd[:2] == ["xprop", "-id"]:
            return SimpleNamespace(stdout='_NET_WM_NAME(UTF8_STRING) = "server.py — Editor"\n', returncode=0)
        return OK
    recorded_run.reply_with(xprop)
    assert client.get("/active-window", headers=H).json() == {"title": "server.py — Editor"}


def test_screenshot_on_wayland_without_tools_is_501(client, accept_any_pin, monkeypatch, session):
    session("wayland")
    tried = []

    def missing(cmd, **kw):
        tried.append(cmd[0])
        raise FileNotFoundError(cmd[0])
    monkeypatch.setattr(server.subprocess, "run", missing)
    r = client.get("/screenshot", headers=H)
    assert r.status_code == 501
    assert "gnome-screenshot" in r.json()["detail"] and "grim" in r.json()["detail"]
    assert tried == ["gnome-screenshot", "grim"]


PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 16


def test_screenshot_on_wayland_falls_back_to_grim(client, accept_any_pin, monkeypatch, session):
    session("wayland")
    seen = []

    def run(cmd, **kw):
        seen.append(cmd[0])
        if cmd[0] == "gnome-screenshot":
            raise FileNotFoundError(cmd[0])
        if cmd[0] == "grim":
            assert cmd == ["grim", cmd[-1]] and kw["env"]["WAYLAND_DISPLAY"]
            with open(cmd[-1], "wb") as f:
                f.write(PNG)
        return OK
    monkeypatch.setattr(server.subprocess, "run", run)
    r = client.get("/screenshot", headers=H)
    assert r.status_code == 200
    assert base64.b64decode(r.json()["image"]) == PNG
    assert r.json()["format"] == "png"
    assert "grim" in seen and "import" not in seen
    assert "screenshot" in audit_actions()


def test_screenshot_on_x11_uses_import_and_reports_jpeg(client, accept_any_pin, monkeypatch, session):
    session("x11")

    def run(cmd, **kw):
        if cmd[0] == "import":
            assert cmd[1:3] == ["-window", "root"] and kw["timeout"] == 10
            with open(cmd[-1], "wb") as f:
                f.write(JPEG)
        return OK
    monkeypatch.setattr(server.subprocess, "run", run)
    body = client.get("/screenshot", headers=H).json()
    assert base64.b64decode(body["image"]) == JPEG and body["format"] == "jpeg"


def test_screenshot_on_x11_without_imagemagick_is_503(client, accept_any_pin, monkeypatch, session):
    session("x11")

    def run(cmd, **kw):
        if cmd[0] == "import":
            raise FileNotFoundError("import")
        return OK
    monkeypatch.setattr(server.subprocess, "run", run)
    r = client.get("/screenshot", headers=H)
    assert r.status_code == 503 and r.json()["detail"] == "import is not installed on the PC"


def test_session_type_comes_from_loginctl(monkeypatch):
    monkeypatch.setattr(server, "USERNAME", "tester")
    monkeypatch.setattr(server, "_ses_cache", {"id": None, "display": ":1", "type": "unknown", "ts": 0})

    def loginctl(cmd, **kw):
        if cmd[1] == "list-sessions":
            return SimpleNamespace(stdout="3 1000 tester seat0 tty2\n", returncode=0)
        prop = cmd[cmd.index("-p") + 1]
        return SimpleNamespace(stdout={"Type": "wayland", "Display": ""}[prop], returncode=0)
    monkeypatch.setattr(server.subprocess, "run", loginctl)
    assert server._session_type() == "wayland"
    assert server.desk_env()["WAYLAND_DISPLAY"].startswith("wayland-")
    monkeypatch.setattr(server, "_ses_cache", {"id": None, "display": ":1", "type": "unknown", "ts": 0})
    monkeypatch.setattr(server.subprocess, "run", lambda cmd, **kw: (_ for _ in ()).throw(FileNotFoundError("loginctl")))
    assert server._session_type() == "unknown"


# ── 3. logging ──────────────────────────────────────────

def access_record(method, path, status):
    return logging.LogRecord(
        name="uvicorn.access", level=logging.INFO, pathname="", lineno=0,
        msg='%s - "%s %s HTTP/%s" %d',
        args=("127.0.0.1:50000", method, path, "1.1", status), exc_info=None,
    )


def test_access_filter_drops_successful_polls_only():
    f = server._access_filter
    for path in server.QUIET_POLL_PATHS:
        assert not f.filter(access_record("GET", path, 200)), path
    assert not f.filter(access_record("GET", "/status?x=1", 200))
    assert not f.filter(access_record("GET", "/health", 304))
    assert f.filter(access_record("GET", "/status", 401))
    assert f.filter(access_record("GET", "/status", 500))
    assert f.filter(access_record("POST", "/volume", 200))
    assert f.filter(access_record("GET", "/screenshot", 200))
    assert f.filter(access_record("GET", "/static/xterm.js", 200))
    assert f.filter(access_record("GET", "/audit", 200))


def test_access_filter_ignores_records_it_does_not_understand():
    rec = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, "plain message", None, None)
    assert server._access_filter.filter(rec)
    rec = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, "%s %s", ("GET", "/status"), None)
    assert server._access_filter.filter(rec)


def test_access_filter_is_installed_on_uvicorn_access_logger():
    assert server._access_filter in logging.getLogger("uvicorn.access").filters
    assert isinstance(server.log, logging.Logger) and server.log.name == "pc_control"


def test_push_failure_is_logged_not_swallowed(token_file, monkeypatch, caplog):
    token_file.write_text(json.dumps({"devices": [{"token": "ExponentPushToken[p]", "device": None}]}))

    def boom(req, timeout=None):
        raise OSError("network down")
    monkeypatch.setattr(server.urllib.request, "urlopen", boom)
    with caplog.at_level(logging.WARNING, logger="pc_control"):
        server.push("T", "B")
    warnings = [r for r in caplog.records if r.name == "pc_control" and r.levelno == logging.WARNING]
    assert warnings and "push" in warnings[0].getMessage()
    assert warnings[0].exc_info and warnings[0].exc_info[0] is OSError


# ── 4. audit gaps ───────────────────────────────────────

def test_register_token_is_audited(client, token_file, accept_any_pin):
    client.post("/register-token", json={"token": "ExponentPushToken[p]"}, headers=H)
    assert audit_actions() == ["push_register"]


def test_intruder_photo_view_is_audited(client, accept_any_pin, tmp_path, monkeypatch):
    photo = tmp_path / "intruder_photo.jpg"
    monkeypatch.setattr(server, "INTRUDER_PHOTO", str(photo))
    assert client.get("/intruder/photo", headers=H).status_code == 404
    assert no_audit_yet()
    photo.write_bytes(JPEG)
    r = client.get("/intruder/photo", headers=H)
    assert r.status_code == 200 and base64.b64decode(r.json()["image"]) == JPEG
    assert audit_actions() == ["intruder_photo_view"]


def test_audit_clear_rotates_instead_of_deleting(client, accept_any_pin):
    server.audit("lock", "1.1.1.1")
    server.audit("unlock", "1.1.1.1")
    with open(server.AUDIT_LOG + ".1", "w") as f:
        f.write("stale | older | rotation\n")
    r = client.post("/audit/clear", headers=H)
    assert r.json() == {"status": "cleared"}
    assert audit_actions() == ["audit_cleared"]
    with open(server.AUDIT_LOG + ".1") as f:
        archived = [line.split(" | ")[1] for line in f.read().splitlines()]
    assert archived == ["lock", "unlock"], "previous log survives as .1, replacing the older .1"
    assert client.get("/audit", headers=H).json()["entries"][0]["action"] == "audit_cleared"


def test_audit_clear_with_no_log_yet(client, accept_any_pin):
    assert client.post("/audit/clear", headers=H).status_code == 200
    assert audit_actions() == ["audit_cleared"]


# ── 5. input validation ─────────────────────────────────

def test_wol_rejects_a_bad_broadcast_address_with_400(client, accept_any_pin):
    mac = "AA:BB:CC:DD:EE:FF"
    for bad in ("not-an-ip", "192.168.1.999", "fe80::1", "", "example.com"):
        r = client.post("/wol", json={"mac": mac, "broadcast": bad}, headers=H)
        assert r.status_code == 400, bad
    assert client.post("/wol", json={"mac": "nope", "broadcast": "192.168.1.255"}, headers=H).status_code == 400
    assert no_audit_yet()


def test_wol_sends_a_magic_packet_to_a_valid_broadcast(monkeypatch, tmp_path):
    sent = []

    class FakeSock:
        def __init__(self, *a):
            pass
        def __enter__(self):
            return self
        def __exit__(self, *exc):
            return False
        def setsockopt(self, *a):
            pass
        def sendto(self, data, addr):
            sent.append((data, addr))
    monkeypatch.setattr(server.socket, "socket", FakeSock)
    req = SimpleNamespace(client=SimpleNamespace(host="10.0.0.2"))
    out = server.wake_on_lan(server.WOLBody(mac="aa-bb-cc-dd-ee-ff", broadcast="192.168.1.255"), req, None)
    assert out == {"status": "magic_packet_sent", "mac": "aa-bb-cc-dd-ee-ff"}
    assert sent == [(b"\xff" * 6 + bytes.fromhex("aabbccddeeff") * 16, ("192.168.1.255", 9))]
    assert audit_actions() == ["wol"]


def test_clipboard_write_goes_through_stdin(client, accept_any_pin, recorded_run):
    text = "x" * 300_000 + "\n" + "tail with 'quotes' and $vars"
    r = client.post("/clipboard", json={"text": text}, headers=H)
    assert r.status_code == 200 and r.json() == {"status": "set"}
    (cmd, kw), = [(c, k) for c, k in recorded_run.calls if c[0] == "gpaste-client"]
    assert cmd == ["gpaste-client"], "argv must not carry the payload"
    assert kw["input"] == text and kw["text"] is True
    assert kw["env"]["DBUS_SESSION_BUS_ADDRESS"]
    assert "clipboard_write" in audit_actions()


def test_volume_out_of_range_is_400_not_clamped(client, accept_any_pin, recorded_run):
    for bad in (-1, 101, 1000):
        r = client.post("/volume", json={"level": bad}, headers=H)
        assert r.status_code == 400, bad
    assert recorded_run.cmds("wpctl") == []
    assert no_audit_yet()
    for ok in (0, 50, 100):
        r = client.post("/volume", json={"level": ok}, headers=H)
        assert r.status_code == 200 and r.json() == {"level": ok}
    assert [c[-1] for c in recorded_run.cmds("wpctl")] == ["0.00", "0.50", "1.00"]
    assert audit_actions() == ["volume_0", "volume_50", "volume_100"]


# ── 6. lifecycle ────────────────────────────────────────

def test_lifespan_starts_the_sampler_and_no_on_event_remains(monkeypatch):
    started = threading.Event()
    monkeypatch.setattr(server, "_bandwidth_sampler", started.set)
    monkeypatch.setattr(server, "_get_session", lambda: (None, ":1"))
    assert server.app.router.on_startup == [] and server.app.router.on_shutdown == []
    with TestClient(server.app) as c:
        assert started.wait(2), "sampler thread was not started by the lifespan"
        assert c.get("/health").status_code == 200


NEIGH = "\n".join(
    f"192.168.1.{i} dev enp45s0 lladdr aa:bb:cc:dd:ee:{i:02x} REACHABLE" for i in range(1, 9)
) + "\n"


def test_network_scan_reuses_one_module_level_pool(client, accept_any_pin, monkeypatch):
    monkeypatch.setattr(server.subprocess, "run", lambda *a, **k: SimpleNamespace(stdout=NEIGH, returncode=0))
    monkeypatch.setattr(server, "_resolve_host", lambda ip: "host")
    real_pool = server._scan_pool
    submitted = []

    class Spy:
        def submit(self, fn, *a):
            submitted.append(a)
            return real_pool.submit(fn, *a)
    monkeypatch.setattr(server, "_scan_pool", Spy())
    for _ in range(2):
        devices = client.get("/network/scan", headers=H).json()["devices"]
        assert len(devices) == 8 and all(d["hostname"] == "host" for d in devices)
    assert len(submitted) == 16
    assert isinstance(real_pool, server.concurrent.futures.ThreadPoolExecutor)
    assert not real_pool._shutdown


class FakeProc:
    instances = []

    def __init__(self, cmd, **kw):
        time.sleep(0.3)  # long enough for a second POST to arrive meanwhile
        self.cmd, self.ended = cmd, False
        FakeProc.instances.append(self)

    def poll(self):
        return 0 if self.ended else None

    def terminate(self):
        self.ended = True

    def wait(self, timeout=None):
        return 0

    def kill(self):
        self.ended = True


def test_concurrent_fake_busy_starts_spawn_one_window(accept_any_pin, tmp_path, monkeypatch):
    script = tmp_path / "fake_busy.py"
    script.write_text("pass\n")
    monkeypatch.setattr(server, "FAKE_BUSY_SCRIPT", str(script))
    monkeypatch.setattr(server, "_fake_busy_proc", None)
    monkeypatch.setattr(server, "desk_env", lambda: {"DISPLAY": ":1"})
    monkeypatch.setattr(server.subprocess, "Popen", FakeProc)
    FakeProc.instances.clear()
    results = []

    def start():
        results.append(TestClient(server.app).post("/fake-busy", headers=H).json()["status"])
    threads = [threading.Thread(target=start) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(results) == ["activated", "already_active"]
    assert len(FakeProc.instances) == 1
    assert FakeProc.instances[0].cmd == ["python3", str(script)]
    c = TestClient(server.app)
    assert c.get("/fake-busy/status", headers=H).json() == {"active": True}
    assert c.post("/fake-busy/dismiss", headers=H).json() == {"status": "dismissed"}
    assert FakeProc.instances[0].ended
    assert c.get("/fake-busy/status", headers=H).json() == {"active": False}
    assert audit_actions() == ["fake_busy_on", "fake_busy_off"]


def test_terminal_reads_the_pty_through_the_event_loop_not_polling(client, accept_any_pin, home, monkeypatch):
    Loop = asyncio.selector_events.BaseSelectorEventLoop
    real_add, real_remove = Loop.add_reader, Loop.remove_reader
    events = []

    def add_reader(self, fd, cb, *a):
        events.append(("add", fd))
        return real_add(self, fd, cb, *a)

    def remove_reader(self, fd):
        events.append(("remove", fd))
        return real_remove(self, fd)
    monkeypatch.setattr(Loop, "add_reader", add_reader)
    monkeypatch.setattr(Loop, "remove_reader", remove_reader)
    sleeps = []
    real_sleep = server.asyncio.sleep

    async def spy_sleep(delay, *a, **k):
        sleeps.append(delay)
        return await real_sleep(delay, *a, **k)
    monkeypatch.setattr(server.asyncio, "sleep", spy_sleep)

    with client.websocket_connect("/ws/terminal") as ws:
        ws.send_text(json.dumps({"pin": "right"}))
        ws.send_text("echo add_reader_ok\r")
        out = b""
        for _ in range(40):
            msg = ws.receive()
            out += msg.get("bytes") or (msg.get("text") or "").encode()
            if b"add_reader_ok\r\n" in out:
                break
        assert b"add_reader_ok\r\n" in out
    added = [fd for kind, fd in events if kind == "add"]
    assert len(added) == 1, "exactly one pty fd registered with the loop"
    assert ("remove", added[0]) in events, "the reader is removed when the session ends"
    assert 0.02 not in sleeps, "the 20 ms polling loop must be gone"
    assert audit_actions()[:1] == ["terminal_open"]


# ── 7. static assets ────────────────────────────────────

def test_static_terminal_assets_are_served_without_a_pin(client):
    r = client.get("/static/xterm.js")
    assert r.status_code == 200
    assert "javascript" in r.headers["content-type"]
    assert r.content.startswith(b"!function") and len(r.content) > 100_000
    css = client.get("/static/xterm.css")
    assert css.status_code == 200 and "text/css" in css.headers["content-type"]
    fit = client.get("/static/addon-fit.js")
    assert fit.status_code == 200 and "javascript" in fit.headers["content-type"]
    assert client.get("/static/missing.js").status_code == 404
    assert client.get("/static/../server.py").status_code == 404


def test_static_mount_is_not_an_api_route_and_the_pin_check_covers_the_rest():
    from fastapi.routing import APIRoute
    from starlette.routing import Mount
    mounts = [r for r in server.app.routes if isinstance(r, Mount)]
    assert [m.path for m in mounts] == ["/static"]
    # /login and /logout carry their own credential checks; every other route
    # declares one of the two auth dependencies.
    public = ("/health", "/intruder", "/login", "/logout")
    guards = {server.require_auth, server.require_pin}
    protected = [r for r in server.app.routes if isinstance(r, APIRoute) and r.path not in public]
    assert protected and all(
        guards.intersection(d.call for d in r.dependant.dependencies) for r in protected
    )
