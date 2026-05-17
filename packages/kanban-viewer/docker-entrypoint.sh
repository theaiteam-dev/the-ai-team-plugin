#!/bin/sh
# Container startup: backup → backfill → migrate deploy → prune → exec.
# Hard-fails on any error (set -e). No silent swallows.
#
# Runtime assumptions:
#   - Image is node:20-slim (Debian) → GNU coreutils. `head -n -5` and
#     `xargs -r` below are GNU extensions and would fail on macOS / BSD;
#     use a Linux container (or install GNU coreutils) when running locally.
#   - This script runs ONLY inside the container at /app/. Don't invoke it
#     directly against a host-mounted DB path — that would resolve to host
#     paths and could damage live state. (See PR #37 for the incident.)
set -e

# Guard: DATABASE_URL must be set before any migration step runs
if [ -z "$DATABASE_URL" ]; then
  echo "[ateam] ERROR: DATABASE_URL is not set"
  exit 1
fi

# Validate scheme: SQLite-only deployment, only file: URLs are supported.
# Reject libsql://, postgres://, etc. up-front so misconfiguration surfaces
# before any backup, backfill, or migrate step runs. (Mirrors the
# normalizeDatabasePath scheme guard in the backfill TypeScript module.)
case "$DATABASE_URL" in
  file:*) ;;
  *)
    echo "[ateam] ERROR: DATABASE_URL must use the file: scheme (got: $DATABASE_URL)"
    exit 1
    ;;
esac

# Derive DB_PATH from DATABASE_URL by stripping the "file:" scheme prefix.
# Use shell parameter expansion (no sed/echo subshell). Relative paths
# (e.g. file:./prisma/data/ateam.db) are resolved against /app (the container
# workdir) so every downstream step works on an absolute path.
DB_PATH=${DATABASE_URL#file:}
if [ -z "$DB_PATH" ]; then
  echo "[ateam] ERROR: DATABASE_URL has empty path after file: prefix"
  exit 1
fi
case "$DB_PATH" in
  /*) ;;                          # already absolute — use as-is
  *)  DB_PATH="/app/$DB_PATH" ;;  # relative → resolve against /app
esac

if [ ! -f "$DB_PATH" ]; then
  # ── Fresh volume: copy factory-fresh seed database ──────────────────────────
  # The seed DB (built by WI-322) already has _prisma_migrations populated,
  # so the shared migrate deploy below is a no-op on first boot.
  if [ ! -f /app/prisma/data.init/ateam.db ]; then
    echo "[ateam] ERROR: seed database not found at /app/prisma/data.init/ateam.db"
    exit 1
  fi
  echo "[ateam] Fresh volume detected — copying seed database..."
  cp -p /app/prisma/data.init/ateam.db "$DB_PATH"
else
  # ── Existing volume: backup → backfill ──────────────────────────────────────
  # Backup with a timestamped filename (no colons — safe for all filesystems)
  echo "[ateam] Existing volume detected — creating backup..."
  cp -p "$DB_PATH" "$(dirname "$DB_PATH")/$(basename "$DB_PATH").backup-$(date +%Y%m%dT%H%M%SZ)"

  # Backfill _prisma_migrations for databases originally created via db push
  echo "[ateam] Running migrations backfill..."
  DATABASE_URL="file:$DB_PATH" npx tsx ./prisma/scripts/backfill-migrations.ts
fi

# ── Apply pending migrations (shared: no-op for seeded fresh DB) ────────────
echo "[ateam] Applying pending migrations..."
DATABASE_URL="file:$DB_PATH" npx prisma migrate deploy --config ./prisma/prisma.config.ts

# ── Prune old backups: keep the 5 most recent ───────────────────────────────
# Uses ateam.db.backup-* so the live ateam.db is never matched by the glob.
# head -n -5 outputs all but the last 5 lines (the oldest); xargs -r skips
# running rm when the list is empty (at-limit or below).
ls -1 "$(dirname "$DB_PATH")/$(basename "$DB_PATH").backup-"* 2>/dev/null | sort | head -n -5 | xargs -r rm -f

exec node server.js
