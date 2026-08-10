#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="${NOVO_COMPOSE_FILE:-$project_root/docker-compose.yml}"
timestamp="$(date +%Y%m%d-%H%M%S)"
backup_root="${NOVO_BACKUP_ROOT:-$project_root/runtime/backups}"
backup_dir="$backup_root/$timestamp"

mkdir -p "$backup_dir"

docker compose -f "$compose_file" exec -T novo sh -c '
set -eu
timestamp="$1"
backup_dir="/app-data/backups/$timestamp"
mkdir -p "$backup_dir"

database_client="${ELN_DATABASE_CLIENT:-sqlite}"
case "$database_client" in
  postgres | postgresql)
    pg_dump --format=custom --no-owner --no-privileges --file="$backup_dir/postgres.dump" "$DATABASE_URL"
    pg_restore --list "$backup_dir/postgres.dump" >/dev/null
    database_backup="$backup_dir/postgres.dump"
    database_client=postgres
    ;;
  sqlite | "")
    if [ ! -f /app-data/data/eln.sqlite3 ]; then
      echo "Novo database not found: /app-data/data/eln.sqlite3" >&2
      exit 1
    fi
    sqlite3 /app-data/data/eln.sqlite3 ".timeout 30000" ".backup $backup_dir/eln.sqlite3"
    integrity_check="$(sqlite3 "$backup_dir/eln.sqlite3" "PRAGMA integrity_check;")"
    if [ "$integrity_check" != "ok" ]; then
      echo "SQLite backup failed integrity check: $integrity_check" >&2
      exit 1
    fi
    database_backup="$backup_dir/eln.sqlite3"
    database_client=sqlite
    ;;
  *)
    echo "Unsupported ELN_DATABASE_CLIENT: $database_client" >&2
    exit 1
    ;;
esac

file_paths=""
for path in uploads previews proofs; do
  if [ -d "/app-data/$path" ]; then
    file_paths="$file_paths $path"
  fi
done
if [ -n "$file_paths" ]; then
  # shellcheck disable=SC2086
  tar -C /app-data -czf "$backup_dir/files.tar.gz" $file_paths
fi
printf "created_at=%s\ndatabase_client=%s\ndatabase_backup=%s\nfiles_backup=%s\n" "$(date -Iseconds)" "$database_client" "$database_backup" "$backup_dir/files.tar.gz" > "$backup_dir/manifest.txt"
' sh "$timestamp"

echo "Created Novo backup: $backup_dir"
find "$backup_root" -mindepth 1 -maxdepth 1 -type d -mtime +30 -print -exec rm -rf {} +
