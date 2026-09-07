"""Category-3 server features: batched snapshot, media metadata, raw
screenshot, push routing."""
import json
import os
import stat
import tempfile
from types import SimpleNamespace

import pytest

import server
from conftest import audit_actions

H = {"x-pin": "x"}


# ── /snapshot ───────────────────────────────────────────

@pytest.fixture
def stub_parts(monkeypatch):
    """Replace every snapshot part with a cheap marker."""
    calls = []

    def make(name):
        def part(_auth=None):
            calls.append(name)
            return {"part": name}
        return part

    monkeypatch.setattr(server, "SNAPSHOT_PARTS", {n: make(n) for n in server.SNAPSHOT_PARTS})
    return calls


def test_snapshot_returns_every_part_in_one_request(client, accept_any_pin, stub_parts):
    body = client.get("/snapshot", headers=H).json()
    assert set(body) == set(server.SNAPSHOT_PARTS)
    assert body["status"] == {"part": "status"}
    assert sorted(stub_parts) == sorted(server.SNAPSHOT_PARTS)


def test_snapshot_can_be_narrowed(client, accept_any_pin, stub_parts):
    body = client.get("/snapshot", params={"parts": "status,stats"}, headers=H).json()
    assert list(body) == ["status", "stats"]
    assert sorted(stub_parts) == ["stats", "status"]


def test_snapshot_rejects_an_unknown_part(client, accept_any_pin, stub_parts):
    r = client.get("/snapshot", params={"parts": "status,nonsense"}, headers=H)
    assert r.status_code == 400
    assert "nonsense" in r.json()["detail"]
    assert stub_parts == [], "nothing should run when the request is invalid"


def test_one_broken_part_does_not_blank_the_rest(client, accept_any_pin, monkeypatch):
    def boom(_auth=None):
        raise server.HTTPException(503, "wpctl is not installed on the PC")

    def fine(_auth=None):
        return {"ok": True}

    monkeypatch.setattr(server, "SNAPSHOT_PARTS", {"volume": boom, "status": fine})
    body = client.get("/snapshot", headers=H).json()
    assert body["status"] == {"ok": True}
    assert body["volume"] == {"error": "wpctl is not installed on the PC", "status": 503}


def test_an_unexpected_error_in_a_part_is_contained(client, accept_any_pin, monkeypatch):
    def boom(_auth=None):
        raise RuntimeError("kaboom")

    monkeypatch.setattr(server, "SNAPSHOT_PARTS", {"stats": boom})
    assert client.get("/snapshot", headers=H).json() == {"stats": {"error": "kaboom"}}


def test_snapshot_needs_authentication(client, reject_every_pin):
    assert client.get("/snapshot", headers={"x-pin": "bad"}).status_code == 401


def test_snapshot_covers_what_the_app_polls(accept_any_pin):
    # Home and Monitor between them poll these; the batch must replace all of them.
    assert {"status", "phone_watch", "stats", "bandwidth", "active_window",
            "webcam"} <= set(server.SNAPSHOT_PARTS)


# ── media ───────────────────────────────────────────────

def fake_playerctl(monkeypatch, *, status="Playing", metadata="spotify\nSong\nBand\nAlbum", rc=0):
    seen = []

    def run(cmd, **kwargs):
        seen.append(cmd)
        if cmd[:2] == ["playerctl", "status"]:
            return SimpleNamespace(stdout=status + "\n", stderr="", returncode=0)
        if cmd[:2] == ["playerctl", "metadata"]:
            return SimpleNamespace(stdout=metadata + "\n", stderr="", returncode=rc)
        return SimpleNamespace(stdout="", stderr="", returncode=0)

    monkeypatch.setattr(server, "run_cmd", run)
    return seen


def test_media_status_reports_the_current_track(client, accept_any_pin, monkeypatch):
    fake_playerctl(monkeypatch)
    assert client.get("/media/status", headers=H).json() == {
        "playing": True, "player": "spotify", "title": "Song", "artist": "Band", "album": "Album",
    }


def test_media_status_with_no_player_is_empty_not_an_error(client, accept_any_pin, monkeypatch):
    fake_playerctl(monkeypatch, status="")
    body = client.get("/media/status", headers=H).json()
    assert body == {"playing": False, "player": "", "title": "", "artist": "", "album": ""}


def test_missing_metadata_fields_come_back_blank(client, accept_any_pin, monkeypatch):
    fake_playerctl(monkeypatch, metadata="mpv\nclip.mkv\n\n")
    body = client.get("/media/status", headers=H).json()
    assert body["title"] == "clip.mkv"
    assert body["artist"] == "" and body["album"] == ""


def test_metadata_failure_leaves_playback_state_intact(client, accept_any_pin, monkeypatch):
    fake_playerctl(monkeypatch, rc=1)
    body = client.get("/media/status", headers=H).json()
    assert body["playing"] is True and body["title"] == ""


@pytest.mark.parametrize("path,command,action", [
    ("/media/next", "next", "media_next"),
    ("/media/previous", "previous", "media_previous"),
    ("/media/toggle", "play-pause", "media_toggle"),
])
def test_skip_controls_drive_playerctl_and_return_new_state(
    client, accept_any_pin, monkeypatch, path, command, action,
):
    seen = fake_playerctl(monkeypatch)
    body = client.post(path, headers=H).json()
    assert ["playerctl", command] in seen
    assert body["title"] == "Song"
    assert action in audit_actions()


# ── /screenshot.jpg ─────────────────────────────────────

def test_raw_screenshot_returns_an_image_not_json(client, accept_any_pin, monkeypatch):
    jpeg = b"\xff\xd8\xff\xe0 not really a jpeg"
    monkeypatch.setattr(server, "_capture_screen", lambda path: pathlib_write(path, jpeg))
    r = client.get("/screenshot.jpg", headers=H)
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/jpeg"
    assert r.headers["cache-control"] == "no-store"
    assert r.content == jpeg
    assert "screenshot" in audit_actions()


def test_raw_screenshot_labels_a_png_correctly(client, accept_any_pin, monkeypatch):
    png = b"\x89PNG\r\n\x1a\n rest"
    monkeypatch.setattr(server, "_capture_screen", lambda path: pathlib_write(path, png))
    r = client.get("/screenshot.jpg", headers=H)
    assert r.headers["content-type"] == "image/png"


def test_raw_screenshot_needs_authentication(client, reject_every_pin):
    assert client.get("/screenshot.jpg", headers={"x-pin": "bad"}).status_code == 401


def pathlib_write(path, data):
    with open(path, "wb") as f:
        f.write(data)


# ── push routing ────────────────────────────────────────

def test_push_carries_a_kind_so_a_tap_can_deep_link(token_file, expo_push):
    token_file.write_text(json.dumps({"devices": [{"token": "ExponentPushToken[a]", "device": None}]}))
    server.push("Title", "Body", kind="intruder")
    assert expo_push.calls[0]["body"]["data"] == {"kind": "intruder"}


def test_push_without_a_kind_sends_empty_data(token_file, expo_push):
    token_file.write_text(json.dumps({"devices": [{"token": "ExponentPushToken[a]", "device": None}]}))
    server.push("Title", "Body")
    assert expo_push.calls[0]["body"]["data"] == {}


def test_the_intruder_hook_refuses_a_remote_caller(client):
    # The endpoint is unauthenticated, so it must only ever accept localhost.
    r = client.post("/intruder")
    assert r.status_code == 403
    assert r.json()["detail"] == "Local only"


def test_the_intruder_alert_routes_to_the_photo(local_client, token_file, expo_push, monkeypatch):
    token_file.write_text(json.dumps({"devices": [{"token": "ExponentPushToken[a]", "device": None}]}))
    monkeypatch.setattr(server, "run_cmd", lambda *a, **k: SimpleNamespace(stdout="", stderr="", returncode=1))
    monkeypatch.setattr(server.subprocess, "run", lambda *a, **k: SimpleNamespace(stdout=b"", returncode=1))
    assert local_client.post("/intruder").status_code == 200
    assert expo_push.calls[0]["body"]["data"] == {"kind": "intruder"}


# ── /files/upload ───────────────────────────────────────

def upload(client, home, name="note.txt", content=b"hello", path=None, headers=None):
    data = {"path": str(path if path is not None else home)}
    return client.post(
        "/files/upload",
        files={"file": (name, content, "application/octet-stream")},
        data=data,
        headers=headers if headers is not None else H,
    )


def test_upload_lands_in_the_named_directory(client, accept_any_pin, home):
    r = upload(client, home)
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "note.txt" and body["size"] == 5
    assert (home / "note.txt").read_bytes() == b"hello"
    assert "file_upload" in audit_actions()


def test_upload_defaults_to_the_home_directory(client, accept_any_pin, home):
    r = client.post("/files/upload", files={"file": ("a.txt", b"x", "text/plain")}, headers=H)
    assert r.status_code == 200
    assert (home / "a.txt").exists()


def test_upload_never_overwrites(client, accept_any_pin, home):
    (home / "note.txt").write_text("original")
    assert upload(client, home).json()["name"] == "note (2).txt"
    assert upload(client, home).json()["name"] == "note (3).txt"
    assert (home / "note.txt").read_text() == "original"


def test_upload_is_confined_to_home(client, accept_any_pin, home, tmp_path):
    outside = tmp_path / "elsewhere"
    outside.mkdir()
    assert upload(client, home, path=outside).status_code == 403
    assert list(outside.iterdir()) == []


def test_a_traversing_filename_is_reduced_to_its_basename(client, accept_any_pin, home, tmp_path):
    victim = tmp_path / "victim.txt"
    r = upload(client, home, name="../../victim.txt", content=b"pwned")
    assert r.status_code == 200
    assert r.json()["name"] == "victim.txt"
    assert (home / "victim.txt").read_bytes() == b"pwned"
    assert not victim.exists()


def test_upload_to_a_file_rather_than_a_directory_is_refused(client, accept_any_pin, home):
    f = home / "existing.txt"
    f.write_text("x")
    assert upload(client, home, path=f).status_code == 400


def test_an_oversized_upload_is_refused_and_leaves_nothing_behind(
    client, accept_any_pin, home, monkeypatch,
):
    monkeypatch.setattr(server, "UPLOAD_MAX_BYTES", 8)
    monkeypatch.setattr(server, "UPLOAD_CHUNK", 4)
    r = upload(client, home, name="big.bin", content=b"0" * 64)
    assert r.status_code == 413
    assert list(home.iterdir()) == [], "the partial file must be cleaned up"


def test_upload_needs_authentication(client, reject_every_pin, home):
    assert upload(client, home, headers={"x-pin": "bad"}).status_code == 401
    assert list(home.iterdir()) == []


# ── /clipboard/image ────────────────────────────────────

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
GIF = b"GIF89a" + b"\x00" * 64
WEBP = b"RIFF" + b"\x00\x00\x00\x00" + b"WEBP" + b"\x00" * 64
TIFF = b"II*\x00" + b"\x00" * 64


@pytest.fixture
def gpaste(monkeypatch):
    """Stub subprocess.run and collect only the `gpaste-client file` calls,
    keeping a copy of each file's bytes because the endpoint deletes it on the
    way out. The desktop-session lookup also runs a command; ignore it, or it
    would sit at index 0 and every assertion here would be reading the wrong
    call."""
    seen = []

    def fake_run(cmd, **kw):
        cmd = list(cmd)
        if cmd[:2] == ["gpaste-client", "file"]:
            with open(cmd[2], "rb") as f:
                seen.append({"cmd": cmd, "payload": f.read(), "kwargs": kw})
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(server.subprocess, "run", fake_run)
    return seen


def push_image(client, content=PNG, name="clip.png", mime="image/png", headers=None):
    return client.post(
        "/clipboard/image",
        files={"file": (name, content, mime)},
        headers=headers if headers is not None else H,
    )


def test_clipboard_image_reaches_gpaste(client, accept_any_pin, gpaste):
    r = push_image(client)
    assert r.status_code == 200
    assert r.json() == {"status": "set", "format": "png", "size": len(PNG)}

    call = gpaste[0]
    assert call["cmd"][:2] == ["gpaste-client", "file"]
    # The bytes must arrive intact, and via a file rather than argv.
    assert call["payload"] == PNG
    assert "clipboard_image" in audit_actions()


def test_clipboard_image_runs_against_the_desktop_session(client, accept_any_pin, gpaste):
    # Without the session environment gpaste-client cannot reach the daemon.
    assert push_image(client).status_code == 200
    assert gpaste[0]["kwargs"].get("env") is not None


def test_clipboard_image_removes_the_temp_file(client, accept_any_pin, gpaste):
    assert push_image(client).status_code == 200
    handed_over = gpaste[0]["cmd"][2]
    assert not os.path.exists(handed_over), "the temp image must not be left behind"


def test_clipboard_image_temp_file_is_private(client, accept_any_pin, monkeypatch):
    modes = []

    def fake_run(cmd, **kw):
        if list(cmd)[:2] == ["gpaste-client", "file"]:
            modes.append(stat.S_IMODE(os.stat(cmd[2]).st_mode))
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(server.subprocess, "run", fake_run)
    assert push_image(client).status_code == 200
    # It passes through a world-readable /tmp, so owner-only or nothing.
    assert modes == [0o600]


@pytest.mark.parametrize("content,ext", [
    (PNG, "png"), (JPG, "jpg"), (GIF, "gif"), (WEBP, "webp"), (TIFF, "tiff"),
])
def test_clipboard_image_sniffs_each_format(client, accept_any_pin, gpaste, content, ext):
    r = push_image(client, content=content)
    assert r.status_code == 200
    assert r.json()["format"] == ext
    # The extension comes from the bytes, not from the filename.
    assert gpaste[0]["cmd"][2].endswith(f".{ext}")


def test_clipboard_image_rejects_a_non_image(client, accept_any_pin, gpaste):
    r = push_image(client, content=b"#!/bin/sh\nrm -rf /\n", name="evil.png")
    assert r.status_code == 415
    assert gpaste == [], "nothing may be handed to gpaste-client"


def test_clipboard_image_ignores_a_lying_content_type(client, accept_any_pin, gpaste):
    # Declared as an image, actually a script: the sniff must win.
    r = push_image(client, content=b"not an image at all", mime="image/png")
    assert r.status_code == 415
    assert gpaste == []


def test_clipboard_image_enforces_the_size_cap(client, accept_any_pin, gpaste, monkeypatch):
    monkeypatch.setattr(server, "CLIPBOARD_IMAGE_MAX_BYTES", 32)
    r = push_image(client, content=PNG)
    assert r.status_code == 413
    assert "MB limit" in r.json()["detail"]
    assert gpaste == []


def test_clipboard_image_cleans_up_when_oversized(client, accept_any_pin, gpaste, monkeypatch):
    monkeypatch.setattr(server, "CLIPBOARD_IMAGE_MAX_BYTES", 32)
    before = set(os.listdir(tempfile.gettempdir()))
    assert push_image(client, content=PNG).status_code == 413
    leaked = [n for n in set(os.listdir(tempfile.gettempdir())) - before
              if n.startswith("pc-control-clip-")]
    assert leaked == []


def test_clipboard_image_surfaces_a_gpaste_failure(client, accept_any_pin, monkeypatch):
    def fake_run(cmd, **kw):
        return SimpleNamespace(returncode=1, stdout="", stderr="no daemon running")

    monkeypatch.setattr(server.subprocess, "run", fake_run)
    r = push_image(client)
    assert r.status_code == 502
    assert "no daemon running" in r.json()["detail"]


def test_clipboard_image_needs_authentication(client, reject_every_pin, gpaste):
    assert push_image(client, headers={"x-pin": "bad"}).status_code == 401
    assert gpaste == []


# ── named upload destinations ───────────────────────────

def test_upload_dest_downloads_lands_in_downloads(client, accept_any_pin, home):
    (home / ".config").mkdir()
    (home / ".config" / "user-dirs.dirs").write_text('XDG_DOWNLOAD_DIR="$HOME/Downloads"\n')
    r = client.post(
        "/files/upload",
        files={"file": ("shot.png", PNG, "image/png")},
        data={"dest": "downloads"},
        headers=H,
    )
    assert r.status_code == 200
    assert (home / "Downloads" / "shot.png").read_bytes() == PNG
    # And not in the home directory itself, which is what it used to do.
    assert not (home / "shot.png").exists()


def test_upload_dest_downloads_creates_the_folder(client, accept_any_pin, home):
    assert not (home / "Downloads").exists()
    r = client.post(
        "/files/upload",
        files={"file": ("a.png", PNG, "image/png")},
        data={"dest": "downloads"},
        headers=H,
    )
    assert r.status_code == 200
    assert (home / "Downloads" / "a.png").exists()


def test_upload_dest_honours_a_relocated_downloads(client, accept_any_pin, home):
    (home / ".config").mkdir()
    (home / ".config" / "user-dirs.dirs").write_text('XDG_DOWNLOAD_DIR="$HOME/Saved/Inbox"\n')
    r = client.post(
        "/files/upload",
        files={"file": ("a.png", PNG, "image/png")},
        data={"dest": "downloads"},
        headers=H,
    )
    assert r.status_code == 200
    assert (home / "Saved" / "Inbox" / "a.png").exists()


def test_upload_dest_ignores_a_downloads_outside_home(client, accept_any_pin, home, tmp_path):
    # A relocation out of HOME must not widen where an upload may land.
    escape = tmp_path / "elsewhere"
    escape.mkdir()
    (home / ".config").mkdir()
    (home / ".config" / "user-dirs.dirs").write_text(f'XDG_DOWNLOAD_DIR="{escape}"\n')

    r = client.post(
        "/files/upload",
        files={"file": ("a.png", PNG, "image/png")},
        data={"dest": "downloads"},
        headers=H,
    )
    assert r.status_code == 200
    assert (home / "Downloads" / "a.png").exists()
    assert list(escape.iterdir()) == []


def test_upload_dest_home_still_means_home(client, accept_any_pin, home):
    r = client.post(
        "/files/upload",
        files={"file": ("a.png", PNG, "image/png")},
        data={"dest": "home"},
        headers=H,
    )
    assert r.status_code == 200
    assert (home / "a.png").exists()


def test_upload_rejects_an_unknown_dest(client, accept_any_pin, home):
    r = client.post(
        "/files/upload",
        files={"file": ("a.png", PNG, "image/png")},
        data={"dest": "/etc"},
        headers=H,
    )
    assert r.status_code == 400
    assert list(home.iterdir()) == []


def test_upload_explicit_path_beats_dest(client, accept_any_pin, home):
    # The browse tab sends a path for the folder it has open; that must win.
    folder = home / "Pictures"
    folder.mkdir()
    r = client.post(
        "/files/upload",
        files={"file": ("a.png", PNG, "image/png")},
        data={"path": str(folder), "dest": "downloads"},
        headers=H,
    )
    assert r.status_code == 200
    assert (folder / "a.png").exists()
    assert not (home / "Downloads").exists()


def test_upload_without_path_or_dest_is_unchanged(client, accept_any_pin, home):
    r = client.post("/files/upload", files={"file": ("a.txt", b"x", "text/plain")}, headers=H)
    assert r.status_code == 200
    assert (home / "a.txt").exists()
