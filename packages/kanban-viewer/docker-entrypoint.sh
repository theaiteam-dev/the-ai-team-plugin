#!/bin/sh
set -e

# Guard: DATABASE_URL must be set before any migration step runs
if [ -z "$DATABASE_URL" ]; then
  echo "[ateam] ERROR: DATABASE_URL is not set"
  exit 1
fi

if [ ! -f /app/prisma/data/ateam.db ]; then
  # ── Fresh volume: copy factory-fresh seed database ──────────────────────────
  # The seed DB (built by WI-322) already has _prisma_migrations populated,
  # so the shared migrate deploy below is a no-op on first boot.
  if [ ! -f /app/prisma/data.init/ateam.db ]; then
    echo "[ateam] ERROR: seed database not found at /app/prisma/data.init/ateam.db"
    exit 1
  fi
  echo "[ateam] Fresh volume detected — copying seed database..."
  cp -p /app/prisma/data.init/ateam.db /app/prisma/data/ateam.db
else
  # ── Existing volume: backup → backfill ──────────────────────────────────────
  # Backup with a timestamped filename (no colons — safe for all filesystems)
  echo "[ateam] Existing volume detected — creating backup..."
  cp -p /app/prisma/data/ateam.db "/app/prisma/data/ateam.db.backup-$(date +%Y%m%dT%H%M%SZ)"

  # Backfill _prisma_migrations for databases originally created via db push
  echo "[ateam] Running migrations backfill..."
  DATABASE_URL=file:/app/prisma/data/ateam.db npx tsx ./prisma/scripts/backfill-migrations.ts
fi

# ── Apply pending migrations (shared: no-op for seeded fresh DB) ────────────
echo "[ateam] Applying pending migrations..."
DATABASE_URL=file:/app/prisma/data/ateam.db npx prisma migrate deploy --config ./prisma/prisma.config.ts

# ── Prune old backups: keep the 5 most recent ───────────────────────────────
# Uses ateam.db.backup-* so the live ateam.db is never matched by the glob.
# head -n -5 outputs all but the last 5 lines (the oldest); xargs -r skips
# running rm when the list is empty (at-limit or below).
ls -1 /app/prisma/data/ateam.db.backup-* 2>/dev/null | sort | head -n -5 | xargs -r rm -f

exec node server.js
