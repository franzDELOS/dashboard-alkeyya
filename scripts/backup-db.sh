#!/usr/bin/env bash
# Alkeyya Dashboard — nightly Postgres backup.
# Runs via cron on the VPS host (NOT inside a container).
# Backs up the dashboard Postgres (port 5433 on localhost).
# Keeps 7 days of local backups; older files are deleted automatically.
#
# SETUP:
# 1. chmod +x scripts/backup-db.sh
# 2. Add to crontab (crontab -e):
#    0 2 * * * /home/franz/alkeyya-dashboard/scripts/backup-db.sh >> /var/log/alkeyya-backup.log 2>&1
# 3. IMPORTANT: configure offsite copy (S3, Backblaze B2, or rclone to
#    any cloud storage) by adding an rclone or aws s3 cp command after the
#    pg_dump line. Without offsite copy, a VPS disk failure loses all backups.
#    Example (add after the pg_dump line, uncomment and configure):
#    # rclone copy "$BACKUP_FILE" remote:alkeyya-backups/dashboard/

set -euo pipefail

BACKUP_DIR="/var/backups/alkeyya-dashboard"
RETENTION_DAYS=7
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/dashboard_${TIMESTAMP}.sql.gz"

# Read DB credentials from the dashboard .env file.
# Adjust REPO_DIR if your repo is not at this path.
REPO_DIR="/home/franz/alkeyya-dashboard"
if [ -f "${REPO_DIR}/.env" ]; then
  # shellcheck source=/dev/null
  set -a; source "${REPO_DIR}/.env"; set +a
fi

: "${POSTGRES_USER:?POSTGRES_USER not set}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD not set}"
: "${POSTGRES_DB:?POSTGRES_DB not set}"

mkdir -p "$BACKUP_DIR"

echo "[$(date -Iseconds)] Starting backup of ${POSTGRES_DB}..."

PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
  --host=127.0.0.1 \
  --port=5433 \
  --username="$POSTGRES_USER" \
  --dbname="$POSTGRES_DB" \
  --no-password \
  --format=plain \
  | gzip > "$BACKUP_FILE"

echo "[$(date -Iseconds)] Backup written to ${BACKUP_FILE} ($(du -h "$BACKUP_FILE" | cut -f1))"

# Prune backups older than RETENTION_DAYS.
find "$BACKUP_DIR" -name "dashboard_*.sql.gz" \
  -mtime +${RETENTION_DAYS} -delete

echo "[$(date -Iseconds)] Pruned backups older than ${RETENTION_DAYS} days. Done."
