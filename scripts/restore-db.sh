#!/usr/bin/env bash
# Alkeyya Dashboard — database restore from backup.
# Usage: ./scripts/restore-db.sh /path/to/dashboard_TIMESTAMP.sql.gz
#
# WARNING: This REPLACES the current database contents. Run only in a
# recovery scenario. Stop the API service first:
#   docker compose stop dashboard-api
# Then run this script. Then restart:
#   docker compose start dashboard-api

set -euo pipefail

BACKUP_FILE="${1:?Usage: $0 /path/to/backup.sql.gz}"
REPO_DIR="/home/franz/alkeyya-dashboard"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "ERROR: backup file not found: $BACKUP_FILE"
  exit 1
fi

if [ -f "${REPO_DIR}/.env" ]; then
  set -a; source "${REPO_DIR}/.env"; set +a
fi

: "${POSTGRES_USER:?POSTGRES_USER not set}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD not set}"
: "${POSTGRES_DB:?POSTGRES_DB not set}"

echo "[$(date -Iseconds)] Restoring ${POSTGRES_DB} from ${BACKUP_FILE}..."
echo "WARNING: This will overwrite all current data. Ctrl+C to abort (5s)..."
sleep 5

gunzip -c "$BACKUP_FILE" | PGPASSWORD="$POSTGRES_PASSWORD" psql \
  --host=127.0.0.1 \
  --port=5433 \
  --username="$POSTGRES_USER" \
  --dbname="$POSTGRES_DB" \
  --no-password

echo "[$(date -Iseconds)] Restore complete."
