"""Shared fixtures for the PC Control server tests.

server.py reads LINUX_USER / LINUX_UID at import time, so they are provided
here before anything imports it. Tests never touch PAM, the real token file,
or the network.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("LINUX_USER", "tester")
os.environ.setdefault("LINUX_UID", "1000")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import server  # noqa: E402


@pytest.fixture(autouse=True)
def _isolate_server_state(tmp_path, monkeypatch):
    """Never touch the real audit log; start every test with clean auth state."""
    monkeypatch.setattr(server, "AUDIT_LOG", str(tmp_path / "audit.log"))
    server._auth_failures.clear()
    server._pin_cache.clear()
    yield


@pytest.fixture
def client():
    return TestClient(server.app)


@pytest.fixture
def local_client():
    """A client the server sees as 127.0.0.1, for the localhost-only hook."""
    return TestClient(server.app, client=("127.0.0.1", 54321))


@pytest.fixture
def home(tmp_path, monkeypatch):
    """A scratch HOME the file endpoints are confined to."""
    h = (tmp_path / "home").resolve()
    h.mkdir()
    monkeypatch.setattr(server, "HOME", h)
    return h


def audit_actions():
    with open(server.AUDIT_LOG) as f:
        return [line.split(" | ")[1] for line in f.read().splitlines()]


@pytest.fixture
def token_file(tmp_path, monkeypatch):
    """Point the server at a scratch push-token file."""
    path = tmp_path / "push_token.json"
    monkeypatch.setattr(server, "TOKEN_FILE", str(path))
    return path


@pytest.fixture
def accept_any_pin(monkeypatch):
    monkeypatch.setattr(server, "verify", lambda pin: None)


@pytest.fixture
def reject_every_pin(monkeypatch):
    class FakePam:
        def authenticate(self, user, pin, service=None):
            return False

    monkeypatch.setattr(server.pam, "pam", lambda: FakePam())


class FakeResponse:
    def __init__(self, payload):
        self._payload = __import__("json").dumps(payload).encode()

    def read(self):
        return self._payload

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@pytest.fixture
def expo_push(monkeypatch):
    """Capture calls to Expo's push API. `expo_push.tickets_for(tokens)` decides the reply."""
    import json

    state = {"calls": [], "tickets_for": lambda tokens: [{"status": "ok"} for _ in tokens]}

    def fake_urlopen(req, timeout=None):
        body = json.loads(req.data.decode())
        state["calls"].append({"url": req.full_url, "body": body})
        return FakeResponse({"data": state["tickets_for"](body["to"])})

    monkeypatch.setattr(server.urllib.request, "urlopen", fake_urlopen)

    class Handle:
        @property
        def calls(self):
            return state["calls"]

        def reply_with(self, fn):
            state["tickets_for"] = fn

    return Handle()
