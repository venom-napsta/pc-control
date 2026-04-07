#!/bin/bash
# Watches auth.log for failed login attempts and triggers intruder alert

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
set -a
source "$SCRIPT_DIR/.env"
set +a

PORT="${SERVER_PORT:-8000}"

tail -F /var/log/auth.log 2>/dev/null | while read -r line; do
  if echo "$line" | grep -qE "(gdm|login|sudo).*authentication failure"; then
    curl -s -X POST "http://127.0.0.1:${PORT}/intruder" >/dev/null 2>&1
  fi
done
