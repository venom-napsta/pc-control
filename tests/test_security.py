"""Category-one hardening: brute-force lockout, file confinement, terminal auth."""
import json
import os

import pytest
from starlette.websockets import WebSocketDisconnect

import server
from conftest import audit_actions


# ── lockout ─────────────────────────────────────────────

def test_wrong_pins_are_audited_then_locked_out(client, reject_every_pin):
    for i in range(server.AUTH_MAX_FAILURES):
        assert client.get("/status", headers={"x-pin": "bad"}).status_code == 401
    r = client.get("/status", headers={"x-pin": "bad"})
    assert r.status_code == 429
    assert "Retry-After" in r.headers
    assert audit_actions() == ["auth_failed"] * (server.AUTH_MAX_FAILURES - 1) + ["auth_failed_lockout"]


def test_lockout_blocks_even_the_correct_pin(client, monkeypatch):
    class Pam:
        def __init__(self):
            self.accept = False
        def authenticate(self, user, pin, service=None):
            return self.accept
    fake = Pam()
    monkeypatch.setattr(server.pam, "pam", lambda: fake)
    for _ in range(server.AUTH_MAX_FAILURES):
        client.get("/status", headers={"x-pin": "bad"})
    fake.accept = True
    assert client.get("/fake-busy/status", headers={"x-pin": "right"}).status_code == 429


def test_lockout_expires_and_doubles_on_repeat(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(server.time, "monotonic", lambda: now[0])
    for _ in range(server.AUTH_MAX_FAILURES):
        server._record_failure("1.2.3.4")
    assert server._lockout_remaining("1.2.3.4") == server.AUTH_LOCKOUT_S + 1
    assert server._lockout_remaining("5.6.7.8") == 0, "lockout is per address"
    now[0] += server.AUTH_LOCKOUT_S + 1
    assert server._lockout_remaining("1.2.3.4") == 0
    for _ in range(server.AUTH_MAX_FAILURES):
        server._record_failure("1.2.3.4")
    assert server._lockout_remaining("1.2.3.4") == 2 * server.AUTH_LOCKOUT_S + 1


def test_a_correct_pin_resets_the_failure_count(client, monkeypatch):
    class Pam:
        def authenticate(self, user, pin, service=None):
            return pin == "right"
    monkeypatch.setattr(server.pam, "pam", lambda: Pam())
    for _ in range(server.AUTH_MAX_FAILURES - 1):
        client.get("/status", headers={"x-pin": "bad"})
    assert client.get("/fake-busy/status", headers={"x-pin": "right"}).status_code == 200
    for _ in range(server.AUTH_MAX_FAILURES - 1):
        assert client.get("/status", headers={"x-pin": "bad"}).status_code == 401  # not 429


def test_pam_is_asked_with_the_configured_service(monkeypatch):
    seen = {}
    class Pam:
        def authenticate(self, user, pin, service=None):
            seen["service"] = service
            return True
    monkeypatch.setattr(server.pam, "pam", lambda: Pam())
    monkeypatch.setattr(server, "PAM_SERVICE", "pc-control")
    server.verify("x")
    assert seen["service"] == "pc-control"


# ── files ───────────────────────────────────────────────

H = {"x-pin": "x"}


def test_list_is_confined_to_home(client, accept_any_pin, home, tmp_path):
    (home / "docs").mkdir()
    (tmp_path / "home2").mkdir()  # shares the string prefix of HOME
    assert client.get("/files", headers=H).json()["parent"] is None
    assert client.get("/files", params={"path": str(home / "docs")}, headers=H).status_code == 200
    assert client.get("/files", params={"path": str(home / ".." / "home2")}, headers=H).status_code == 403
    assert client.get("/files", params={"path": str(tmp_path / "home2")}, headers=H).status_code == 403
    assert client.get("/files", params={"path": "/etc"}, headers=H).status_code == 403
    assert client.get("/files", params={"path": str(home / "missing")}, headers=H).status_code == 404


def test_symlink_out_of_home_is_rejected(client, accept_any_pin, home, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    (home / "escape").symlink_to(outside)
    assert client.get("/files", params={"path": str(home / "escape")}, headers=H).status_code == 403


def test_download_is_confined_and_audited(client, accept_any_pin, home):
    (home / "a.txt").write_text("hello")
    r = client.get("/files/download", params={"path": str(home / "a.txt")}, headers=H)
    assert r.status_code == 200 and r.content == b"hello"
    assert client.get("/files/download", params={"path": "/etc/passwd"}, headers=H).status_code == 403
    assert "file_download" in audit_actions()


def test_delete_refuses_the_home_directory_itself(client, accept_any_pin, home):
    (home / "keep.txt").write_text("x")
    for target in (str(home), str(home) + "/", str(home / "docs" / ".."), "."):
        r = client.post("/files/delete", json={"path": target, "permanent": True}, headers=H)
        assert r.status_code == 400, target
    assert (home / "keep.txt").exists()


def test_delete_goes_to_trash_by_default(client, accept_any_pin, home, monkeypatch):
    trashed = []
    monkeypatch.setattr(server, "_trash", lambda p: trashed.append(p) or True)
    f = home / "old.txt"
    f.write_text("x")
    r = client.post("/files/delete", json={"path": str(f)}, headers=H)
    assert r.json()["status"] == "trashed"
    assert trashed == [f]
    assert f.exists(), "trash was stubbed, so nothing should be unlinked"
    assert "file_trash" in audit_actions()


def test_delete_without_trash_available_is_refused_not_destructive(client, accept_any_pin, home, monkeypatch):
    monkeypatch.setattr(server, "_trash", lambda p: False)
    f = home / "old.txt"
    f.write_text("x")
    assert client.post("/files/delete", json={"path": str(f)}, headers=H).status_code == 503
    assert f.exists()


def test_permanent_delete_removes_files_and_directories(client, accept_any_pin, home):
    d = home / "dir"
    d.mkdir()
    (d / "inner.txt").write_text("x")
    f = home / "f.txt"
    f.write_text("x")
    assert client.post("/files/delete", json={"path": str(f), "permanent": True}, headers=H).json()["status"] == "deleted"
    assert client.post("/files/delete", json={"path": str(d), "permanent": True}, headers=H).json()["status"] == "deleted"
    assert not f.exists() and not d.exists()
    assert client.post("/files/delete", json={"path": str(f), "permanent": True}, headers=H).status_code == 404


def test_deleting_a_symlink_removes_the_link_not_the_target(client, accept_any_pin, home):
    docs = home / "Documents"
    docs.mkdir()
    (docs / "thesis.txt").write_text("precious")
    link = home / "shortcut"
    link.symlink_to(docs)
    r = client.post("/files/delete", json={"path": str(link), "permanent": True}, headers=H)
    assert r.json() == {"status": "deleted", "path": str(link), "symlink": True}
    assert not link.exists() and not link.is_symlink()
    assert (docs / "thesis.txt").read_text() == "precious"


def test_traversal_in_delete_is_rejected(client, accept_any_pin, home, tmp_path):
    victim = tmp_path / "victim.txt"
    victim.write_text("x")
    r = client.post("/files/delete", json={"path": str(home / ".." / "victim.txt"), "permanent": True}, headers=H)
    assert r.status_code == 403
    assert victim.exists()


# ── terminal websocket ──────────────────────────────────

def ws_rejects(client, path, first_frame=None):
    with client.websocket_connect(path) as ws:
        if first_frame is not None:
            ws.send_text(first_frame)
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_text()
    return exc.value.code


def test_terminal_rejects_a_wrong_pin_with_4001(client, reject_every_pin):
    assert ws_rejects(client, "/ws/terminal", json.dumps({"pin": "bad"})) == 4001
    assert audit_actions() == ["auth_failed"]


def test_terminal_ignores_a_pin_in_the_url(client, accept_any_pin, monkeypatch):
    monkeypatch.setattr(server, "WS_AUTH_TIMEOUT_S", 0.2)
    # Even with a valid PIN in the query string, no auth frame means no session.
    assert ws_rejects(client, "/ws/terminal?pin=right") == 4001


def test_terminal_rejects_garbage_first_frame(client, accept_any_pin):
    assert ws_rejects(client, "/ws/terminal", "not json") == 4001
    assert ws_rejects(client, "/ws/terminal", json.dumps(["list"])) == 4001


def test_terminal_session_runs_a_shell_after_a_valid_frame(client, accept_any_pin, home):
    if not os.path.exists("/bin/bash"):
        pytest.skip("no bash")
    with client.websocket_connect("/ws/terminal") as ws:
        ws.send_text(json.dumps({"pin": "right"}))
        ws.send_text("echo hi_from_pc_control_test\r")
        out = b""
        for _ in range(40):
            msg = ws.receive()
            if "bytes" in msg and msg["bytes"]:
                out += msg["bytes"]
            elif "text" in msg and msg["text"]:
                out += msg["text"].encode()
            if b"hi_from_pc_control_test\r\n" in out:
                break
        assert b"hi_from_pc_control_test\r\n" in out
        ws.send_text("exit\r")
    assert audit_actions()[:1] == ["terminal_open"]
