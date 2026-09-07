"""Guards for the server-side performance fixes: PIN caching, a non-blocking
/stats, and parallel hostname resolution in /network/scan."""
import time
from types import SimpleNamespace

import pytest

import server


# ── PIN cache ───────────────────────────────────────────

class CountingPam:
    def __init__(self, accept):
        self.accept = accept
        self.calls = 0

    def authenticate(self, user, pin, service=None):
        self.calls += 1
        return pin in self.accept


@pytest.fixture
def counting_pam(monkeypatch):
    fake = CountingPam(accept={"right"})
    monkeypatch.setattr(server.pam, "pam", lambda: fake)
    server._pin_cache.clear()
    monkeypatch.setattr(server, "PIN_CACHE_TTL", 300)
    return fake


def test_repeated_correct_pin_hits_pam_once(counting_pam):
    for _ in range(25):
        server.verify("right")
    assert counting_pam.calls == 1


def test_wrong_pin_is_rejected_and_never_cached(counting_pam):
    for _ in range(3):
        with pytest.raises(server.HTTPException) as exc:
            server.verify("wrong")
        assert exc.value.status_code == 401
    assert counting_pam.calls == 3


def test_different_pins_are_cached_separately(counting_pam):
    counting_pam.accept = {"a", "b"}
    server.verify("a")
    server.verify("b")
    server.verify("a")
    server.verify("b")
    assert counting_pam.calls == 2


def test_cache_entry_expires(counting_pam, monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(server.time, "monotonic", lambda: now[0])
    server.verify("right")
    now[0] += 299
    server.verify("right")
    assert counting_pam.calls == 1
    now[0] += 2  # past the 300 s TTL
    server.verify("right")
    assert counting_pam.calls == 2


def test_cache_can_be_disabled(counting_pam, monkeypatch):
    monkeypatch.setattr(server, "PIN_CACHE_TTL", 0)
    server.verify("right")
    server.verify("right")
    assert counting_pam.calls == 2


def test_cache_is_keyed_by_hmac_not_plaintext(counting_pam):
    server.verify("right")
    assert b"right" not in b"".join(server._pin_cache.keys())
    assert all(len(k) == 32 for k in server._pin_cache.keys())


def test_cached_pin_makes_authenticated_endpoints_cheap(client, counting_pam):
    # Two polls of the same endpoint: PAM consulted once, both succeed.
    for _ in range(2):
        r = client.get("/fake-busy/status", headers={"x-pin": "right"})
        assert r.status_code == 200
    assert counting_pam.calls == 1


def test_restart_forgets_the_cache():
    # The HMAC secret is generated per process, so a cache can never be
    # replayed across restarts or copied between machines.
    assert len(server._pin_secret) == 32
    assert server._pin_key("x") != hmac_key_with_other_secret("x")


def hmac_key_with_other_secret(pin):
    import hashlib
    import hmac
    return hmac.new(b"\x00" * 32, pin.encode(), hashlib.sha256).digest()


# ── /stats must not block ───────────────────────────────

def test_stats_does_not_sleep_inside_psutil(client, accept_any_pin, monkeypatch):
    real = server.psutil.cpu_percent

    def guarded(interval=None, percpu=False):
        assert not interval, "/stats must not call cpu_percent with a blocking interval"
        return real(interval=None, percpu=percpu)

    monkeypatch.setattr(server.psutil, "cpu_percent", guarded)
    with server._bw_lock:
        server._bw_data["cpu"] = 42.5
    t0 = time.perf_counter()
    r = client.get("/stats", headers={"x-pin": "x"})
    elapsed = time.perf_counter() - t0
    assert r.status_code == 200
    body = r.json()
    assert body["cpu_percent"] == 42.5
    assert body["cpu_count"] == server.psutil.cpu_count()
    assert {"ram_percent", "disk_percent", "uptime", "hostname", "kernel"} <= set(body)
    assert elapsed < 0.5, f"/stats took {elapsed:.2f}s"


# ── /network/scan resolves in parallel ──────────────────

NEIGH = "\n".join(
    f"192.168.1.{i} dev enp45s0 lladdr aa:bb:cc:dd:ee:{i:02x} REACHABLE" for i in range(1, 9)
) + "\n192.168.1.99 dev enp45s0  FAILED\n192.168.1.1 dev enp45s0 lladdr aa:bb:cc:dd:ee:01 STALE\n"


def test_network_scan_resolves_hosts_concurrently(client, accept_any_pin, monkeypatch, tmp_path):
    monkeypatch.setattr(server, "AUDIT_LOG", str(tmp_path / "audit.log"))
    monkeypatch.setattr(
        server.subprocess, "run",
        lambda *a, **k: SimpleNamespace(stdout=NEIGH, returncode=0),
    )

    def slow_resolve(ip):
        time.sleep(0.25)
        return f"host-{ip.rsplit('.', 1)[1]}"

    monkeypatch.setattr(server, "_resolve_host", slow_resolve)

    t0 = time.perf_counter()
    r = client.get("/network/scan", headers={"x-pin": "x"})
    elapsed = time.perf_counter() - t0

    assert r.status_code == 200
    devices = r.json()["devices"]
    assert len(devices) == 8  # FAILED entry skipped, duplicate .1 collapsed
    assert {d["hostname"] for d in devices} == {f"host-{i}" for i in range(1, 9)}
    assert devices[0] == {"ip": "192.168.1.1", "mac": "aa:bb:cc:dd:ee:01", "hostname": "host-1"}
    # Sequential would be 8 x 0.25 s = 2 s; parallel is one round trip.
    assert elapsed < 1.0, f"scan took {elapsed:.2f}s, lookups are not parallel"


def test_network_scan_gives_up_on_stragglers(client, accept_any_pin, monkeypatch, tmp_path):
    monkeypatch.setattr(server, "AUDIT_LOG", str(tmp_path / "audit.log"))
    monkeypatch.setattr(server, "SCAN_RESOLVE_BUDGET_S", 0.2)
    monkeypatch.setattr(
        server.subprocess, "run",
        lambda *a, **k: SimpleNamespace(stdout=NEIGH, returncode=0),
    )

    def resolve(ip):
        if ip.endswith(".3"):
            time.sleep(1.0)  # one host that never answers in time
        return "fast"

    monkeypatch.setattr(server, "_resolve_host", resolve)
    t0 = time.perf_counter()
    devices = client.get("/network/scan", headers={"x-pin": "x"}).json()["devices"]
    assert time.perf_counter() - t0 < 0.8
    by_ip = {d["ip"]: d["hostname"] for d in devices}
    assert by_ip["192.168.1.3"] == ""
    assert all(v == "fast" for ip, v in by_ip.items() if ip != "192.168.1.3")
