#!/bin/bash
# Dump SQLite to text SQL outside the repo, with rotation
set -e

DB="/opt/organizer/data/organizer.db"
BACKUP_DIR="/opt/organizer/data/backups"
DUMP="$BACKUP_DIR/backup.sql"

mkdir -p "$BACKUP_DIR"
sqlite3 "$DB" .dump > "$DUMP"

# Keep a timestamped copy, prune anything older than 7 days
cp "$DUMP" "$BACKUP_DIR/backup-$(date -u '+%Y-%m-%dT%H%M')UTC.sql"
find "$BACKUP_DIR" -name 'backup-*.sql' -mtime +7 -delete
