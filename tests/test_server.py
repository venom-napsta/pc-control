import json

import server


# ── /health ─────────────────────────────────────────────

def test_health_needs_no_auth(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["service"] == "pc-control"
    assert body["version"] == server.SERVER_VERSION
    assert isinstance(body["host"], str) and body["host"]


def test_health_leaks_nothing_that_needs_the_pin(client):
    assert set(client.get("/health").json()) == {"ok", "service", "host", "version", "sessions"}


def test_every_route_except_the_public_three_is_authenticated():
    from fastapi.routing import APIRoute
    # /health is the reachability probe, /intruder is localhost-only, and
    # /login and /logout carry their own credential checks.
    exempt = {"/health", "/intruder", "/login", "/logout"}
    guards = {server.require_auth, server.require_pin}
    unprotected = [
        route.path for route in server.app.routes
        if isinstance(route, APIRoute)
        and route.path not in exempt
        and not guards.intersection(d.call for d in route.dependant.dependencies)
    ]
    assert unprotected == []


def test_destructive_routes_demand_the_pin_not_a_token():
    from fastapi.routing import APIRoute
    must_be_strict = {"/shutdown", "/reboot", "/files/delete", "/audit/clear", "/sessions/revoke-all"}
    for route in server.app.routes:
        if isinstance(route, APIRoute) and route.path in must_be_strict:
            calls = [d.call for d in route.dependant.dependencies]
            assert server.require_pin in calls, route.path
            assert server.require_auth not in calls, route.path


# ── auth ────────────────────────────────────────────────

def test_status_without_pin_header_is_401(client):
    r = client.get("/status")
    assert r.status_code == 401
    assert r.json()["detail"] == "Missing x-pin header"


def test_wrong_pin_is_401(client, reject_every_pin):
    r = client.get("/status", headers={"x-pin": "wrong"})
    assert r.status_code == 401
    assert r.json()["detail"] == "Invalid credentials"


# ── /register-token: several devices ────────────────────

def register(client, token, device=None):
    body = {"token": token}
    if device:
        body["device"] = device
    return client.post("/register-token", json=body, headers={"x-pin": "x"})


def test_register_keeps_every_device(client, token_file, accept_any_pin):
    assert register(client, "ExponentPushToken[phone]", "Galaxy S23").json() == {"status": "registered", "devices": 1}
    assert register(client, "ExponentPushToken[tab]", "Galaxy Tab S11").json() == {"status": "registered", "devices": 2}

    saved = json.loads(token_file.read_text())
    assert saved == {"devices": [
        {"token": "ExponentPushToken[phone]", "device": "Galaxy S23"},
        {"token": "ExponentPushToken[tab]", "device": "Galaxy Tab S11"},
    ]}


def test_registering_the_same_token_twice_is_idempotent(client, token_file, accept_any_pin):
    register(client, "ExponentPushToken[phone]", "old name")
    r = register(client, "ExponentPushToken[phone]", "new name")
    assert r.json()["devices"] == 1
    assert json.loads(token_file.read_text())["devices"] == [
        {"token": "ExponentPushToken[phone]", "device": "new name"},
    ]


def test_register_migrates_legacy_single_token_file(client, token_file, accept_any_pin):
    token_file.write_text(json.dumps({"token": "ExponentPushToken[old-phone]"}))
    register(client, "ExponentPushToken[tab]", "Galaxy Tab S11")
    devices = json.loads(token_file.read_text())["devices"]
    assert [d["token"] for d in devices] == ["ExponentPushToken[old-phone]", "ExponentPushToken[tab]"]


def test_register_requires_pin(client, token_file, reject_every_pin):
    assert register(client, "ExponentPushToken[x]").status_code == 401
    assert not token_file.exists()


def test_load_devices_tolerates_garbage_file(token_file):
    token_file.write_text("not json")
    assert server._load_devices() == []


# ── push(): fan-out and pruning ─────────────────────────

def seed(token_file, *tokens):
    token_file.write_text(json.dumps({"devices": [{"token": t, "device": None} for t in tokens]}))


def test_push_sends_to_all_devices_in_one_request(token_file, expo_push):
    seed(token_file, "ExponentPushToken[phone]", "ExponentPushToken[tab]")
    server.push("Title", "Body")
    assert len(expo_push.calls) == 1
    call = expo_push.calls[0]
    assert call["url"] == server.EXPO_PUSH_URL
    assert call["body"]["to"] == ["ExponentPushToken[phone]", "ExponentPushToken[tab]"]
    assert call["body"]["title"] == "Title" and call["body"]["body"] == "Body"


def test_push_prunes_devices_expo_no_longer_knows(token_file, expo_push):
    seed(token_file, "ExponentPushToken[phone]", "ExponentPushToken[gone]")
    expo_push.reply_with(lambda tokens: [
        {"status": "ok"},
        {"status": "error", "details": {"error": "DeviceNotRegistered"}},
    ])
    server.push("Title", "Body")
    assert [d["token"] for d in server._load_devices()] == ["ExponentPushToken[phone]"]


def test_push_keeps_devices_on_other_errors(token_file, expo_push):
    seed(token_file, "ExponentPushToken[phone]")
    expo_push.reply_with(lambda tokens: [{"status": "error", "details": {"error": "MessageRateExceeded"}}])
    server.push("Title", "Body")
    assert [d["token"] for d in server._load_devices()] == ["ExponentPushToken[phone]"]


def test_push_without_devices_does_not_call_expo(token_file, expo_push):
    server.push("Title", "Body")
    assert expo_push.calls == []


def test_push_survives_expo_outage(token_file, monkeypatch):
    seed(token_file, "ExponentPushToken[phone]")

    def boom(req, timeout=None):
        raise OSError("network down")

    monkeypatch.setattr(server.urllib.request, "urlopen", boom)
    server.push("Title", "Body")  # must not raise
    assert [d["token"] for d in server._load_devices()] == ["ExponentPushToken[phone]"]
