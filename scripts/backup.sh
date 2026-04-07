#!/bin/bash
# Dump SQLite to text SQL and auto-commit to repo
set -e

DB="/opt/organizer/data/organizer.db"
DUMP="/opt/organizer/repo/backup.sql"

sqlite3 "$DB" .dump > "$DUMP"

cd /opt/organizer/repo
if ! git diff --quiet backup.sql 2>/dev/null; then
  git add backup.sql
  git commit -m "backup: $(date -u '+%Y-%m-%d %H:%M UTC')"
  git push origin main 2>/dev/null || true
fi
