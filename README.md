# PC Control

Remote control your Ubuntu desktop from your phone over Tailscale.

## Features

- **Lock / Unlock** — Control your desktop session remotely
- **Phone Away Lock** — Auto-locks PC when your phone disconnects from the network
- **Power Controls** — Shutdown and reboot with confirmation dialogs
- **Volume Control** — Slider to adjust system volume
- **System Monitor** — Live CPU, RAM, and disk usage
- **Screenshots** — Capture and view your desktop remotely
- **Clipboard Sync** — Read and write PC clipboard from your phone
- **Desktop Notifications** — Send notifications to your PC
- **Intruder Alert** — Push notification on failed login attempts
- **Audit Log** — Track all remote actions with timestamps

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
sudo apt install openssh-server scrot xdotool xclip
```

### 2. Install Python packages

```bash
pip install fastapi uvicorn python-pam psutil python-dotenv
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env with your values — see Configuration section below

cp mobile/.env.example mobile/.env
# Edit mobile/.env with your server URL
```

### 4. PAM authentication setup

```bash
# Add your user to the shadow group for PAM auth
sudo gpasswd -a $USER shadow
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

Copy service files to `~/.config/systemd/user/` then:

```bash
systemctl --user daemon-reload
systemctl --user enable --now pc_control phone_watch
```

### 8. Mobile app

```bash
cd mobile
npm install
npx expo start
```

Scan the QR code with Expo Go on your phone.

## Configuration

Copy `.env.example` to `.env` and fill in your values:

| Variable | Description | How to find |
|---|---|---|
| `LINUX_USER` | Your Linux username | `whoami` |
| `LINUX_UID` | Your user ID | `id -u` |
| `SERVER_PORT` | FastAPI server port | Default: `8000` |
| `TAILSCALE_IP` | PC's Tailscale IP | `tailscale ip -4` |
| `HOME_LAN_IP` | PC's LAN IP | `hostname -I \| awk '{print $1}'` |
| `PHONE_HOTSPOT_IP` | Phone IP on hotspot | Check phone settings or `arp -a` |

Mobile `mobile/.env`:

| Variable | Description |
|---|---|
| `EXPO_PUBLIC_SERVER` | `http://<TAILSCALE_IP>:<SERVER_PORT>` |

## API Endpoints

All endpoints require `x-pin` header (your Linux login password) unless noted.

| Method | Path | Description |
|---|---|---|
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
| POST | `/notify` | Desktop notification `{"message": "..."}` |
| GET | `/screenshot` | Screen capture (base64 JPEG) |
| GET | `/active-window` | Focused window title |
| GET | `/clipboard` | PC clipboard contents |
| POST | `/clipboard` | Set clipboard `{"text": "..."}` |
| GET | `/audit` | Last 50 audit entries |
| POST | `/register-token` | Store Expo push token `{"token": "..."}` |
| POST | `/intruder` | Trigger intruder alert (localhost only, no auth) |

## Services

```bash
# Check status
systemctl --user status pc_control phone_watch

# Restart
systemctl --user restart pc_control phone_watch

# View logs
journalctl --user -u pc_control -f
journalctl --user -u phone_watch -f

# Enable / disable
systemctl --user enable pc_control phone_watch
systemctl --user disable pc_control phone_watch
```

## Removal

```bash
bash REMOVE.sh
```

This will stop and disable all services, remove service files, uninstall pip and apt packages, prompt before removing Tailscale, remove shadow group membership and sudoers entry, prompt before clearing SSH authorized keys, disable user linger, and remove all project files.
