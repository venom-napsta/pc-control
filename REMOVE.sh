#!/bin/bash
# Complete removal of PC Control system
# Run: bash ~/++/misc/pc-control/REMOVE.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
set -a
source "$SCRIPT_DIR/.env"
set +a
USER_NAME="${LINUX_USER:-$USER}"

echo "=== PC Control — Full Removal ==="
echo ""

# ── 1. User services ──
echo "[1/9] Stopping and disabling user services..."
systemctl --user stop pc_control phone_watch intruder_watcher 2>/dev/null || true
systemctl --user disable pc_control phone_watch intruder_watcher 2>/dev/null || true
rm -f ~/.config/systemd/user/pc_control.service
rm -f ~/.config/systemd/user/phone_watch.service
rm -f ~/.config/systemd/user/intruder_watcher.service
systemctl --user daemon-reload

# ── 2. PAM service ──
echo "[2/9] Removing PAM service..."
sudo rm -f /etc/pam.d/pc-control

# ── 3. Pip packages ──
echo "[3/9] Uninstalling pip packages (from the interpreter the service used)..."
PY="${PYTHON:-$HOME/anaconda3/bin/python}"
"$PY" -m pip uninstall -y fastapi uvicorn python-pam psutil python-dotenv httpx 2>/dev/null || true

# ── 4. Apt packages ──
# These are general desktop tools other software may rely on, so ask first.
read -rp "[4/9] Remove apt packages used only by PC Control (imagemagick playerctl libnotify-bin gpaste ffmpeg avahi-utils)? (y/N): " yn
if [[ "$yn" =~ ^[Yy]$ ]]; then
    sudo apt remove -y imagemagick playerctl libnotify-bin gpaste ffmpeg avahi-utils 2>/dev/null || true
fi

# ── 5. Tailscale ──
read -rp "[5/9] Remove Tailscale? (y/N): " yn
if [[ "$yn" =~ ^[Yy]$ ]]; then
    sudo apt remove -y tailscale 2>/dev/null || true
    echo "  Tailscale removed."
else
    echo "  Tailscale kept."
fi

# ── 6. Shadow group ──
echo "[6/9] Removing user from shadow group..."
sudo gpasswd -d "$USER_NAME" shadow 2>/dev/null || true

# ── 7. Sudoers ──
echo "[7/9] Removing sudoers entry..."
sudo rm -f /etc/sudoers.d/pc-control

# ── 8. SSH authorized keys ──
read -rp "[8/9] Clear SSH authorized keys? (y/N): " yn
if [[ "$yn" =~ ^[Yy]$ ]]; then
    > ~/.ssh/authorized_keys
    echo "  SSH authorized keys cleared."
else
    echo "  SSH authorized keys kept."
fi

# ── 9. Linger ──
echo "[9/9] Disabling user linger..."
sudo loginctl disable-linger "$USER_NAME" 2>/dev/null || true

# ── Remove project files (only this project, never the parent directory) ──
echo ""
echo "Removing project files..."
rm -rf "$SCRIPT_DIR"
rm -f ~/++/misc/phone_watch.sh

echo ""
echo "Done. Removed:"
echo "  - User services (pc_control, phone_watch, intruder_watcher)"
echo "  - PAM service (/etc/pam.d/pc-control)"
echo "  - Pip packages (fastapi, uvicorn, python-pam, psutil, python-dotenv)"
echo "  - Shadow group membership (if any)"
echo "  - Sudoers entry"
echo "  - User linger"
echo "  - Project files ($SCRIPT_DIR, ~/++/misc/phone_watch.sh)"
echo ""
echo "Deliberately left alone (not part of PC Control):"
echo "  - code_server.service and ~/.local/bin/code-server"
echo "    Remove with: systemctl --user disable --now code_server &&"
echo "                 rm -f ~/.config/systemd/user/code_server.service &&"
echo "                 rm -rf ~/.local/lib/code-server-* ~/.local/bin/code-server"
