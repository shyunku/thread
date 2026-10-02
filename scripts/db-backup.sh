#!/bin/sh
# Back up the production MySQL database from the Compose "mysql" service.
# Run on the server from anywhere inside the repository: `pnpm db:backup` or `sh scripts/db-backup.sh`.
# The dump contains v2 plaintext data: it is written owner-only under .local/db-backups/,
# which is excluded from Git and Docker builds.
set -eu

cd "$(dirname "$0")/.."

fail() { echo "db-backup: $*" >&2; exit 1; }

# Without .env, Compose falls back to the development defaults and would dump the wrong database.
[ -f .env ] || fail ".env not found in $(pwd). Run this on the server repository."
docker compose ps --status running --services 2>/dev/null | grep -qx mysql || fail "mysql service is not running."

umask 077
dir=.local/db-backups
mkdir -p "$dir"
file="$dir/thread-$(date +%Y%m%d-%H%M%S).sql"
tmp="$file.partial"
trap 'rm -f "$tmp"' EXIT INT TERM

echo "db-backup: dumping to $file"
docker compose exec -T mysql sh -c \
  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump --single-transaction --routines --triggers --hex-blob -uroot "$MYSQL_DATABASE"' \
  > "$tmp" || fail "mysqldump failed."

# mysqldump writes this footer only when the dump finished.
tail -n 1 "$tmp" | grep -q "^-- Dump completed" || fail "dump is incomplete."
mv "$tmp" "$file"
trap - EXIT INT TERM

echo "db-backup: done ($(du -h "$file" | cut -f1)) $file"
echo "db-backup: tables: $(grep -c '^CREATE TABLE' "$file")"
