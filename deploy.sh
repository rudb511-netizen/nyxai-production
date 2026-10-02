#!/bin/sh
set -e

echo "=== NYX Production Self-Hosting Startup ==="

# Load environment variables if .env exists
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

# Ensure database URL is set or fallback to local postgres/pglite
export DATABASE_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/nyx}"
export PORT="${PORT:-8080}"
export HOST="${HOST:-0.0.0.0}"

echo "[1/3] Running database migrations..."
node scripts/migrate.mjs || echo "Migration notice: ensure PostgreSQL is running if external DB is required."

echo "[2/3] Building production frontend & server..."
npm run build || echo "Build notice: verify dependencies."

echo "[3/3] Starting NYX production server on ${HOST}:${PORT}..."
exec node --env-file=.env server/index.mjs 2>/dev/null || exec node server/index.mjs
