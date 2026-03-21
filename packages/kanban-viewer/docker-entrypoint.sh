#!/bin/sh
set -e

# On first run with an empty volume mount, the seeded database won't exist.
# Copy the baked-in seed database so the app starts with stages pre-configured.
if [ ! -f /app/prisma/data/ateam.db ]; then
  echo "[ateam] Initializing database..."
  cp /app/prisma/data.init/ateam.db /app/prisma/data/ateam.db
fi

exec node server.js
