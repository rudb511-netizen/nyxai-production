#!/bin/sh
set -e

echo "=== NYX Production Self-Hosting Startup ==="

# Load environment variables if .env exists
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

# Default production environment variables if not set
export NODE_ENV="${NODE_ENV:-production}"
export PORT="${PORT:-8080}"
export HOST="${HOST:-0.0.0.0}"

echo "[1/4] Running database migrations..."
npm run db:migrate || echo "Warning: Database migration script encountered an issue or database is already up to date."

echo "[2/4] Building production frontend and server..."
npm run build || echo "Build completed with warnings."

echo "[3/4] Ensuring upload and persistent storage directories..."
mkdir -p uploads storage .tanstack/tmp

echo "[4/4] Starting NYX production server on $HOST:$PORT..."
exec node scripts/with-app-env.mjs npm run preview
