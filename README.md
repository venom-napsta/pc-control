# PC Control

Remote control your Ubuntu desktop from your phone over Tailscale.

## Features

- **Lock / Unlock** — Control your desktop session remotely
- **Phone Away Lock** — Auto-locks PC when your phone disconnects from the network
- **Power Controls** — Shutdown and reboot with confirmation dialogs
- **Volume Control** — Slider to adjust system volume
- **System Monitor** — Live CPU, RAM, disk usage, bandwidth, and active window
- **Screenshots** — Capture and view your desktop remotely
- **File Browser** — Browse, download, and delete files in your home directory
- **Clipboard Sync** — Read and write PC clipboard from your phone
- **Terminal** — Full interactive PTY shell via WebSocket (xterm.js)
- **Desktop Notifications** — Send notifications to your PC
- **Wake-on-LAN** — Send magic packets to wake PCs on your network
- **Fake Busy Screen** — Display a fake "updating" screen on your PC
- **Webcam Monitor** — Check webcam status and kill active processes
- **Network Scanner** — Discover devices on your LAN with hostname resolution
- **Uptime History** — View recent boot/shutdown history
- **Intruder Alert** — Push notification + photo on failed login attempts
- **Audit Log** — Track all remote actions with timestamps
- **Session login** — The password is exchanged once for a revocable token, so polls no longer carry it. Shutdown, reboot, delete and the terminal still ask for the password
- **Biometric unlock** — Optionally remember the password in the device keystore and sign in with a fingerprint or face
- **File upload** — Send a file from the phone or tablet into the folder open on the PC
- **Image push** — Paste a screenshot from the phone's clipboard, or pick an image, and put it straight onto the PC's clipboard ready to paste — or save it to the PC's Downloads folder instead
- **Roaming** — The app probes every saved address (Tailscale name, Tailscale IP, LAN, hotspot) and uses the first that answers; addresses are editable in-app
- **Multi-device** — Phone and tablet both receive push alerts; layouts adapt to tablet widths and rotation

## Stack

| Component | Technology |
|---|---|
| Server | Python FastAPI + Uvicorn |
| Auth | Linux PAM (system password) |
| Mobile App | Expo React Native |
| Networking | Tailscale (WireGuard) |
| Notifications | Expo Push |
| Process Manager | systemd user services |

## Setup

### Prerequisites

- Ubuntu 22.04+ desktop
- Python 3.10+ (Anaconda or system)
- Node.js + npm
- Tailscale installed on PC and phone
- Expo Go app on phone

### 1. Install system packages

```bash
sudo apt install imagemagick playerctl libnotify-bin gpaste-2 ffmpeg avahi-utils

# Wayland sessions only (X11 uses ImageMagick's `import`)
sudo apt install gnome-screenshot   # or: sudo apt install grim
```

ImageMagick takes screenshots, playerctl drives media, libnotify sends desktop
notifications, GPaste backs the clipboard, ffmpeg captures the intruder photo,
avahi-utils resolves hostnames in the network scan.

### 2. Install Python packages

```bash
pip install fastapi uvicorn python-pam psutil python-dotenv websockets
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env with your values — see Configuration section below

cp mobile/.env.example mobile/.env
# Edit mobile/.env with your server URL
```

### 4. PAM service

The server checks the PIN through PAM. Out of the box it uses the `login`
service, which works but adds a 3 s delay on every wrong PIN and shares its
log line with real console logins. Install the dedicated service instead:

```bash
sudo install -m 644 pam/pc-control /etc/pam.d/pc-control
echo "PAM_SERVICE=pc-control" >> .env
```

Your user does **not** need to be in the `shadow` group: pam_unix verifies the
server's own account through the setuid `unix_chkpwd` helper. If an older
setup added it, remove it and confirm login still works:

```bash
sudo gpasswd -d $USER shadow
```

### 5. Sudoers for shutdown/reboot

```bash
echo "$USER ALL=(ALL) NOPASSWD: /sbin/shutdown, /sbin/reboot" | sudo tee /etc/sudoers.d/pc-control
```

### 6. Enable user linger

```bash
sudo loginctl enable-linger $USER
```

### 7. Install systemd services

```bash
cp systemd/*.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now pc_control phone_watch intruder_watcher
```

The units read `.env` (`EnvironmentFile`), so `SERVER_PORT` and `BIND_HOST`
live in one place. `intruder_watcher` follows the journal for failed GDM
logins; your user must be in the `adm` or `systemd-journal` group to read it.

### 8. Mobile app

```bash
cd mobile
npm install
npx expo start
```

Scan the QR code with Expo Go on your phone. There is no `expo-dev-client` and
no `scheme`, so a dev server can only be loaded by Expo Go — never by an
installed release build.

If the device is on the PC's hotspot, Metro has to advertise the hotspot
address or Expo Go times out reaching the bundle:

```bash
REACT_NATIVE_PACKAGER_HOSTNAME=10.42.0.1 npx expo start --port 8090
```

then open `exp://10.42.0.1:8090` in Expo Go. The printed QR encodes the LAN
address, so scanning it will not work from the hotspot.

#### Cloud builds need the address list uploaded first

`EXPO_PUBLIC_SERVERS` is inlined at build time from `mobile/.env`, which is
gitignored — and EAS Build uploads only git-tracked files. So a cloud build
sees none of it and `DEFAULT_SERVERS` collapses to `http://localhost:2000`,
producing an app that reaches nothing. Upload the list once per environment:

```bash
cd mobile
set -a; . ./.env; set +a
eas env:create --name EXPO_PUBLIC_SERVERS --value "$EXPO_PUBLIC_SERVERS" \
  --visibility sensitive --scope project \
  --environment development --environment preview --environment production

eas env:list --environment production   # verify before building
```

Each build profile in `eas.json` names the environment it loads. Note the
plural: a legacy singular `EXPO_PUBLIC_SERVER` is still honoured, but it holds
only one address and so silently disables the roaming fallback.

## Network exposure

The `x-pin` header carries your Linux password. Over Tailscale it is inside
WireGuard; on plain Wi-Fi, the hotspot or an office LAN it is readable by any
device on the path. Pick one:

```bash
# A. Keep roaming, but only over Tailscale and your own hotspot
sudo ufw allow in on tailscale0 to any port 2000 proto tcp
sudo ufw allow from 10.42.0.0/24 to any port 2000 proto tcp
sudo ufw deny 2000/tcp

# B. Tailscale only: bind the Tailscale IP and drop the LAN/hotspot addresses
#    from EXPO_PUBLIC_SERVERS
echo "BIND_HOST=$(tailscale ip -4)" >> .env && systemctl --user restart pc_control
```

Wrong PINs are audited (`auth_failed`) and an address is locked out for
`AUTH_LOCKOUT_S` seconds after `AUTH_MAX_FAILURES` failures, doubling on each
further strike. The terminal sends the PIN as its first WebSocket frame, never
in the URL. If you ran a version before September 2026, the URL form was
logged; purge it (this discards all archived journal history):

```bash
sudo journalctl --rotate && sudo journalctl --vacuum-time=1s
```

## Configuration

Copy `.env.example` to `.env` and fill in your values:

| Variable | Description | How to find |
|---|---|---|
| `LINUX_USER` | Your Linux username | `whoami` |
| `LINUX_UID` | Your user ID | `id -u` |
| `SERVER_PORT` | FastAPI server port | Default: `2000` |
| `TAILSCALE_IP` | PC's Tailscale IP | `tailscale ip -4` |
| `HOME_LAN_IP` | PC's LAN IP | `hostname -I \| awk '{print $1}'` |
| `PHONE_HOTSPOT_IP` | Phone IP on hotspot | Check phone settings or `arp -a` |
| `BIND_HOST` | Interface to listen on (default `0.0.0.0`) | See Network exposure |
| `PAM_SERVICE` | PAM service for PIN checks (default `login`; use `pc-control` after installing `pam/pc-control`) | |
| `AUTH_MAX_FAILURES` / `AUTH_LOCKOUT_S` | Brute-force lockout threshold and base duration (defaults `5` / `60`) | |
| `SESSION_TTL` | Idle lifetime of a session token in seconds (default `28800`, `0` disables `/login`) | |
| `UPLOAD_MAX_BYTES` | Largest accepted upload (default 512 MB) | |
| `CLIPBOARD_IMAGE_MAX_BYTES` | Largest image accepted onto the clipboard (default 32 MB) | Far lower than an upload: GPaste holds the whole image in its history, and the realistic payload is a screenshot |
| `PIN_CACHE_TTL` | Seconds a verified PIN is remembered before PAM is asked again (default `300`, `0` disables) | A PAM round trip costs hundreds of ms and the app polls every few seconds |

Mobile `mobile/.env`:

| Variable | Description |
|---|---|
| `EXPO_PUBLIC_SERVERS` | Comma-separated list of every address the PC may answer at, most preferred first. Include the Tailscale MagicDNS name (`tailscale status --json \| jq -r .Self.DNSName`), the Tailscale IP, the LAN IP and `10.42.0.1` for the PC's own hotspot. |
| `EXPO_PUBLIC_SERVER` | Legacy single address; used only if `EXPO_PUBLIC_SERVERS` is unset. |

These are only the defaults baked into a build. On the login screen, tap the address pill to add, remove or test addresses on the device itself. The app probes all of them in parallel against `/health` and uses whichever answers first, and re-probes automatically if a request fails mid-session, so it roams between LAN and Tailscale on its own.

Away from home the Tailscale address is the only one that can answer, so Tailscale must be connected on the phone or tablet. On Android, exclude Tailscale from battery optimisation and, if you use another VPN, note that Android allows only one at a time. Disable key expiry for both nodes in the Tailscale admin console or re-authenticate before the keys expire.

## App Navigation

The mobile app has 4 bottom tabs:

| Tab | Screens |
|---|---|
| **Home** | Lock/unlock, phone watch, connection status. Links to Monitor and Log sub-screens. |
| **Controls** | Power, volume, notifications, Wake-on-LAN, fake busy |
| **Files** | File browser + clipboard sync (tab switcher) |
| **Terminal** | Full interactive PTY shell |

## API Endpoints

All endpoints require the `x-pin` header (your Linux login password) unless noted. A missing header is `401`, a wrong PIN `401`, a locked-out address `429` with `Retry-After`.

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Reachability probe, **no auth**: `{ok, service, host, version, sessions}` |
| POST | `/login` | Trade the PIN for a session token: `{token, expires_in, token_header}`. Optional `x-device` header labels the session. |
| POST | `/logout` | Revoke this session. Idempotent, needs no credential beyond the token. |
| POST | `/sessions/revoke-all` | End every session on every device. **PIN only.** |
| GET | `/snapshot` | Several status reads in one round trip. `?parts=status,stats` narrows it; a failed part carries its own `{error}`. |
| GET | `/status` | Lock state |
| POST | `/lock` | Lock session |
| POST | `/unlock` | Unlock session |
| GET | `/phone-watch/status` | Phone watch service state |
| POST | `/phone-watch/toggle` | Toggle phone watch on/off |
| POST | `/shutdown` | Shutdown PC |
| POST | `/reboot` | Reboot PC |
| GET | `/volume` | Current volume % |
| POST | `/volume` | Set volume `{"level": 0-100}` |
| GET | `/stats` | CPU / RAM / disk usage |
| GET | `/bandwidth` | Upload/download speed and totals |
| POST | `/notify` | Desktop notification `{"message": "..."}` |
| POST | `/media/next` | Skip to the next track |
| POST | `/media/previous` | Skip to the previous track |
| GET | `/screenshot.jpg` | The capture as an image response rather than base64 in JSON. Cheaper on the wire and renderable directly. |
| GET | `/screenshot` | Screen capture: `{image, format}` where format is `jpeg` on X11 and `png` on Wayland. Wayland needs gnome-screenshot or grim, else `501`. |
| GET | `/active-window` | Focused window title. On Wayland returns `{title: "", unsupported: "wayland"}` with `200`, since there is no `_NET_ACTIVE_WINDOW`. |
| GET | `/clipboard` | PC clipboard contents |
| POST | `/clipboard` | Set clipboard `{"text": "..."}` |
| GET | `/files` | List directory `?path=/home/user/...` |
| GET | `/files/download` | Download file `?path=...` (audited) |
| POST | `/clipboard/image` | Put an image on the PC clipboard, multipart `file`. The bytes are sniffed for a real image signature rather than trusting the declared content type, capped at `CLIPBOARD_IMAGE_MAX_BYTES`. Handed to GPaste, which keeps its own copy, so the temp file is removed immediately. |
| POST | `/files/upload` | Receive a file, multipart `file` plus optional `path` form field. Streamed to disk, capped at `UPLOAD_MAX_BYTES`, never overwrites. A named `dest` (`downloads` or `home`) targets a well-known folder without the caller knowing its path — Downloads is localised and relocatable, and a relocation outside `HOME` is ignored. `path` wins over `dest`. |
| POST | `/files/delete` | Move to Trash `{"path": "..."}`; add `"permanent": true` to delete for good. Refuses the home directory itself; removes symlinks as links. |
| GET | `/webcam/status` | Webcam active state and processes |
| POST | `/webcam/kill` | Kill webcam processes |
| GET | `/network/scan` | Scan LAN for devices (ARP + mDNS) |
| GET | `/uptime/history` | Boot/shutdown history |
| POST | `/wol` | Wake-on-LAN `{"mac": "AA:BB:CC:DD:EE:FF"}` |
| POST | `/fake-busy` | Activate fake busy screen |
| POST | `/fake-busy/dismiss` | Dismiss fake busy screen |
| GET | `/fake-busy/status` | Fake busy active state |
| GET | `/audit` | Last 50 audit entries |
| POST | `/audit/clear` | Rotate the audit log: the current file becomes `audit.log.1`, so a clear cannot erase history. |
| GET | `/intruder/photo` | Last intruder photo (base64 JPEG) |
| POST | `/intruder` | Trigger intruder alert (localhost only, no auth) |
| POST | `/register-token` | Add a device's Expo push token `{"token": "...", "device": "Galaxy Tab S11"}`. Tokens accumulate per device; ones Expo reports as unregistered are pruned. |
| GET | `/static/*` | xterm.js, its CSS and the fit addon, **no auth** (public library code). Lets the terminal work with no internet. |
| WS | `/ws/terminal` | Interactive PTY shell. First frame must be `{"pin": "..."}`; closes with code 4001 on rejection. |

## Services

```bash
# Check status
systemctl --user status pc_control phone_watch intruder_watcher

# Restart
systemctl --user restart pc_control phone_watch

# View logs
journalctl --user -u pc_control -f
journalctl --user -u phone_watch -f

# Enable / disable
systemctl --user enable pc_control phone_watch
systemctl --user disable pc_control phone_watch
```

`systemd/code_server.service` also lives here, but it is not part of PC
Control: it serves VS Code in a browser so the tablet can edit code on this
machine. It is kept alongside the others so every user unit is in one place.

```bash
systemctl --user status code_server
```

It reads its address, password and TLS settings from
`~/.config/code-server/config.yaml` (mode 0600, since the password is stored
in plaintext there), listens on 8443 because 8080-8087 are taken by editor
language servers, and opens on `~/++` rather than all of `$HOME`.

## Authentication

Two credentials, deliberately:

| Credential | Sent as | Used for |
|---|---|---|
| Session token | `x-token` | Everything the app polls |
| Linux password | `x-pin` | `/login`, and the destructive routes below |

`POST /login` runs PAM once and returns a 256-bit token. The server keeps only
an HMAC of it, never the token itself, so a memory dump yields nothing
replayable. Expiry is idle-based and slides forward on use; a server restart
ends every session. Tokens are **not** tied to a client address, because the
app roams between the LAN, the hotspot and Tailscale mid-session.

Shutdown, reboot, `/files/delete`, `/audit/clear` and `/sessions/revoke-all`
refuse tokens outright and demand the password, so a stolen token cannot cause
lasting damage. The terminal likewise takes the password in its first frame.

An expired token answers `401 Session expired`, which the app recognises: it
signs in again with the password it already holds and retries once, invisibly.
That failure never counts toward the brute-force lockout, since a token ageing
out mid-poll would otherwise lock the address out just as the app tries to
recover. A wrong password still counts, and still locks out.

Set `SESSION_TTL=0` to turn tokens off entirely; the app detects this from
`/health` and falls back to sending the password on every request.

On the device, the password can optionally be kept in the platform keystore
(Keychain / Android Keystore) behind a biometric check, so a cold start does
not mean retyping it. It is only offered where the device has a sensor with
something enrolled, and turning the option off erases what was stored.

## Behaviour on failure

Every handler runs external tools through one helper with a timeout, so a
missing or wedged tool is a clear error instead of a hung request or a
traceback:

| Situation | Response |
|---|---|
| Tool not installed | `503 <tool> is not installed on the PC` |
| Tool did not finish in time | `504 <tool> did not respond` |
| Wayland with no screenshot tool | `501` with the packages to install |
| Bad Wake-on-LAN broadcast address | `400` |
| Volume outside 0-100 | `400` |

Failures inside background work (push delivery, session detection, the terminal
reader) go to the `pc_control` logger rather than vanishing. The access log
drops successful GETs to the endpoints the app polls, so `journalctl` stays
readable; everything else, including every non-2xx, is still logged.

## Deliberately not built

Two ideas from the audit were considered and rejected, recorded here so they
are not re-proposed:

- **A `/run` endpoint for saved command shortcuts.** The terminal already
  provides a full interactive shell over the same credential, so `/run` would
  add a second remote-execution surface without adding any capability. Saved
  shortcuts, if wanted, belong in the terminal screen as canned input.
- **Replacing `subprocess` with D-Bus for lock, media and notifications.** It
  would remove a fork per call and be Wayland-agnostic, but it means a new
  dependency and rewriting working code for a cost the PIN cache and the
  background sampler already largely removed. Worth revisiting only if the
  session ever moves to Wayland for good.

## Performance notes

- **PIN cache.** Every request carries the Linux password and used to run a full PAM login (hundreds of ms, ~3 s on failure). Successful PINs are now cached in memory for `PIN_CACHE_TTL` seconds under an HMAC with a per-process secret, and PAM calls are serialised so a burst of parallel requests costs one PAM call. Only successes are cached, so a wrong password is never remembered.
- **`/stats` no longer blocks.** CPU usage is sampled by the background thread that already samples bandwidth, instead of sleeping one second inside the request.
- **Parallel network scan.** Reverse-DNS lookups run concurrently under a 6 s budget instead of one host at a time.
- **Polling only when visible.** The app polls only while the screen is focused and the app is in the foreground, never overlaps a slow request, and pull-to-refresh awaits the in-flight request instead of starting another.
- **Release shrinking.** Android release builds enable R8 code and resource shrinking via `expo-build-properties`. If a release build misbehaves, remove those two flags from `mobile/app.json`.

## Tests

```bash
# Server (pytest + FastAPI TestClient; PAM, the token file and Expo are stubbed)
python -m pytest

# Mobile: lint, type-check and unit tests in one go
cd mobile && npm run check
```

The mobile checks are also available separately as `npm run lint`,
`npm run typecheck` and `npm test`.

The pure modules under `mobile/src` (address parsing, server discovery, the
polling scheduler, snapshot batching, session rules, the stats cache, layout
breakpoints, byte formatting) are TypeScript under `strict`, and they are the
modules with unit tests. The screens and components stay JavaScript:
`checkJs` is off, so the untyped half is not type-checked. `src/env.d.ts`
declares only the `EXPO_PUBLIC_*` variables Babel substitutes at build time,
rather than pulling in Node's types, which do not exist on a device.

Prettier is deliberately absent: the codebase is already consistently
formatted, and adopting it now would rewrite every file for no behavioural
gain.

## Removal

```bash
bash REMOVE.sh
```

This will stop and disable all services, remove service files, uninstall pip and apt packages, prompt before removing Tailscale, remove shadow group membership and sudoers entry, prompt before clearing SSH authorized keys, disable user linger, and remove all project files.
