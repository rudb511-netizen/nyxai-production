#!/bin/sh
set -eu
cd /workspace
# Load server-only secrets if present. Never print this file.
if [ -f /workspace/.env ]; then
  set -a
  # shellcheck disable=SC1091
  . /workspace/.env
  set +a
fi
# Gmail SMTP defaults. SMTP_PASS is never written here — it comes from .env
# or the existing deployment secret and is left untouched if already set.
export SMTP_HOST="${SMTP_HOST:-smtp.gmail.com}"
export SMTP_PORT="${SMTP_PORT:-587}"
export SMTP_SECURE="${SMTP_SECURE:-false}"
export SMTP_USER="${SMTP_USER:-nyx.officialsupport@gmail.com}"
export PASSWORD_RESET_OTP_EXPIRY_MINUTES="${PASSWORD_RESET_OTP_EXPIRY_MINUTES:-10}"
export PASSWORD_RESET_RESEND_COOLDOWN_SECONDS="${PASSWORD_RESET_RESEND_COOLDOWN_SECONDS:-60}"
node scripts/preview.mjs stop || true
if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  exit 0
fi
npm run dev >>/tmp/app-startup.log 2>&1 &
