"""Session tokens: the PIN is traded once, then polls carry a revocable token."""
import pytest

import server
from conftest import audit_actions

PIN = {"x-pin": "right"}


@pytest.fixture(autouse=True)
def _clear_sessions():
    server._sessions.clear()
    yield
    server._sessions.clear()


@pytest.fixture
def good_pam(monkeypatch):
    class Pam:
        def __init__(self):
            self.calls = 0
        def authenticate(self, user, pin, service=None):
            self.calls += 1
            return pin == "right"
    fake = Pam()
    monkeypatch.setattr(server.pam, "pam", lambda: fake)
    monkeypatch.setattr(server, "PIN_CACHE_TTL", 0)  # count every PAM call
    return fake


def login(client, headers=None):
    return client.post("/login", headers=headers if headers is not None else PIN)


# ── issuing ─────────────────────────────────────────────

def test_login_trades_the_pin_for_a_token(client, good_pam):
    r = login(client)
    assert r.status_code == 200
    body = r.json()
    assert body["expires_in"] == server.SESSION_TTL
    assert body["token_header"] == "x-token"
    assert len(body["token"]) >= 32
    assert "login" in audit_actions()


def test_login_rejects_a_wrong_pin_and_issues_nothing(client, good_pam):
    assert client.post("/login", headers={"x-pin": "wrong"}).status_code == 401
    assert server._sessions == {}


def test_login_without_a_pin_is_401(client, good_pam):
    assert client.post("/login").status_code == 401


def test_two_logins_give_two_distinct_sessions(client, good_pam):
    a = login(client).json()["token"]
    b = login(client).json()["token"]
    assert a != b
    assert len(server._sessions) == 2


def test_the_raw_token_is_never_stored(client, good_pam):
    token = login(client).json()["token"]
    assert token.encode() not in b"".join(server._sessions.keys())
    assert all(len(k) == 32 for k in server._sessions)


def test_login_is_refused_when_sessions_are_disabled(client, good_pam, monkeypatch):
    monkeypatch.setattr(server, "SESSION_TTL", 0)
    assert login(client).status_code == 503


# ── using ───────────────────────────────────────────────

def test_a_token_authenticates_ordinary_requests_without_pam(client, good_pam):
    token = login(client).json()["token"]
    before = good_pam.calls
    for _ in range(5):
        assert client.get("/fake-busy/status", headers={"x-token": token}).status_code == 200
    assert good_pam.calls == before, "polling with a token must not touch PAM"


def test_an_unknown_token_is_401_session_expired(client, good_pam):
    r = client.get("/fake-busy/status", headers={"x-token": "not-a-real-token"})
    assert r.status_code == 401
    assert r.json()["detail"] == "Session expired"


def test_an_expired_token_stops_working(client, good_pam, monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(server.time, "monotonic", lambda: now[0])
    token = login(client).json()["token"]
    now[0] += server.SESSION_TTL - 1
    assert client.get("/fake-busy/status", headers={"x-token": token}).status_code == 200
    now[0] += server.SESSION_TTL + 1  # idle past the sliding window
    assert client.get("/fake-busy/status", headers={"x-token": token}).status_code == 401
    assert server._sessions == {}, "the dead session is dropped"


def test_use_slides_the_expiry_forward(client, good_pam, monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(server.time, "monotonic", lambda: now[0])
    token = login(client).json()["token"]
    for _ in range(4):
        now[0] += server.SESSION_TTL - 10
        assert client.get("/fake-busy/status", headers={"x-token": token}).status_code == 200


def test_a_stale_token_does_not_trigger_the_lockout(client, good_pam):
    # A token ageing out mid-poll must not lock the address out of /login.
    for _ in range(server.AUTH_MAX_FAILURES + 3):
        assert client.get("/fake-busy/status", headers={"x-token": "stale"}).status_code == 401
    assert login(client).status_code == 200, "the correct PIN must still be accepted"
    assert audit_actions().count("auth_failed") == 0


def test_the_pin_still_works_alongside_tokens(client, good_pam):
    assert client.get("/fake-busy/status", headers=PIN).status_code == 200


def test_a_token_is_accepted_from_any_address(client, good_pam):
    # The app roams between LAN, hotspot and Tailscale mid-session, so tokens
    # are deliberately not pinned to a client address.
    token = login(client).json()["token"]
    r = client.get("/fake-busy/status", headers={"x-token": token, "x-forwarded-for": "10.42.0.9"})
    assert r.status_code == 200


# ── destructive routes refuse tokens ────────────────────

@pytest.mark.parametrize("method,path,body", [
    ("post", "/shutdown", None),
    ("post", "/reboot", None),
    ("post", "/files/delete", {"path": "/tmp/whatever"}),
    ("post", "/audit/clear", None),
    ("post", "/sessions/revoke-all", None),
])
def test_destructive_routes_reject_a_token(client, good_pam, method, path, body):
    token = login(client).json()["token"]
    r = getattr(client, method)(path, headers={"x-token": token}, json=body)
    assert r.status_code == 401, f"{path} accepted a token"


def test_a_token_holder_cannot_delete_files(client, good_pam, home):
    victim = home / "keep.txt"
    victim.write_text("x")
    token = login(client).json()["token"]
    r = client.post("/files/delete", json={"path": str(victim), "permanent": True},
                    headers={"x-token": token})
    assert r.status_code == 401
    assert victim.exists()


# ── revoking ────────────────────────────────────────────

def test_logout_revokes_just_that_session(client, good_pam):
    a = login(client).json()["token"]
    b = login(client).json()["token"]
    assert client.post("/logout", headers={"x-token": a}).json()["revoked"] is True
    assert client.get("/fake-busy/status", headers={"x-token": a}).status_code == 401
    assert client.get("/fake-busy/status", headers={"x-token": b}).status_code == 200


def test_logout_is_idempotent_and_needs_no_credential(client, good_pam):
    r = client.post("/logout", headers={"x-token": "never-existed"})
    assert r.status_code == 200 and r.json()["revoked"] is False
    assert client.post("/logout").status_code == 200


def test_revoke_all_ends_every_session_and_needs_the_pin(client, good_pam):
    tokens = [login(client).json()["token"] for _ in range(3)]
    assert client.post("/sessions/revoke-all", headers={"x-token": tokens[0]}).status_code == 401
    r = client.post("/sessions/revoke-all", headers=PIN)
    assert r.json() == {"status": "revoked", "sessions": 3}
    for t in tokens:
        assert client.get("/fake-busy/status", headers={"x-token": t}).status_code == 401
    assert "sessions_revoked" in audit_actions()


# ── discovery ───────────────────────────────────────────

def test_health_advertises_session_support(client):
    assert client.get("/health").json()["sessions"] is True


def test_health_says_so_when_sessions_are_off(client, monkeypatch):
    monkeypatch.setattr(server, "SESSION_TTL", 0)
    assert client.get("/health").json()["sessions"] is False
