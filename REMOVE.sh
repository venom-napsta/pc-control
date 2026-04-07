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
systemctl --user stop pc_control phone_watch 2>/dev/null || true
systemctl --user disable pc_control phone_watch 2>/dev/null || true
rm -f ~/.config/systemd/user/pc_control.service
rm -f ~/.config/systemd/user/phone_watch.service
systemctl --user daemon-reload

# ── 2. System service (intruder watcher) ──
echo "[2/9] Stopping intruder watcher..."
sudo systemctl stop pc-intruder-watcher 2>/dev/null || true
sudo systemctl disable pc-intruder-watcher 2>/dev/null || true
sudo rm -f /etc/systemd/system/pc-intruder-watcher.service
sudo systemctl daemon-reload

# ── 3. Pip packages ──
echo "[3/9] Uninstalling pip packages..."
pip uninstall -y fastapi uvicorn python-pam psutil python-dotenv 2>/dev/null || true

# ── 4. Apt packages ──
echo "[4/9] Removing apt packages..."
sudo apt remove -y openssh-server scrot xdotool xclip 2>/dev/null || true

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

# ── Remove project files ──
echo ""
echo "Removing project directory..."
rm -rf ~/++/misc/

echo ""
echo "Done. Removed:"
echo "  - User services (pc_control, phone_watch)"
echo "  - System service (pc-intruder-watcher)"
echo "  - Pip packages (fastapi, uvicorn, python-pam, psutil, python-dotenv)"
echo "  - Apt packages (openssh-server, scrot, xdotool, xclip)"
echo "  - Shadow group membership"
echo "  - Sudoers entry"
echo "  - User linger"
echo "  - Project files (~/++/misc/)"
