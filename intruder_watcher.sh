#!/bin/bash
# Watches for failed *desktop* login attempts and triggers the intruder alert.
#
# Follows the system journal (works with or without rsyslog's auth.log) and
# matches only GDM's password prompt. Matching "login" or "sudo" too would fire
# on every mistyped PIN from the phone, because the server itself verifies the
# PIN through PAM's "login" service unless PAM_SERVICE is set.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
set -a
# shellcheck disable=SC1091
source "$SCRIPT_DIR/.env"
set +a

PORT="${SERVER_PORT:-2000}"
PATTERN='pam_unix\(gdm-password:auth\): authentication failure'

journalctl -f -n 0 -o cat 2>/dev/null | while read -r line; do
  if [[ "$line" =~ $PATTERN ]]; then
    curl -s -m 5 -X POST "http://127.0.0.1:${PORT}/intruder" >/dev/null 2>&1
  fi
done
