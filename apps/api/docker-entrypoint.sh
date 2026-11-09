#!/bin/sh
# Container entrypoint for the API and worker images.
# Applies committed Prisma migrations before starting (OPS-06). The worker sets
# RUN_MIGRATIONS=false so only the API migrates.
set -e

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "Applying database migrations..."
  npx --no-install prisma migrate deploy
fi

exec "$@"
