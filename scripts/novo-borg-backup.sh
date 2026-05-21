#!/usr/bin/env bash
set -euo pipefail

runtime_dir="${NOVO_RUNTIME_DIR:-/app-runtime}"
staging_dir="${NOVO_BACKUP_STAGING_DIR:-/backup-staging}"
repo="${BORG_REPO:-/borg-repo}"
archive_prefix="${NOVO_BORG_ARCHIVE_PREFIX:-novo}"
database_path="$runtime_dir/data/eln.sqlite3"
snapshot_path="$staging_dir/eln.sqlite3"
manifest_path="$staging_dir/manifest.txt"

fix_host_permissions() {
  local owner=""
  if [[ -d "$runtime_dir" ]]; then
    owner="$(stat -c '%u:%g' "$runtime_dir" 2>/dev/null || true)"
  fi

  if [[ -n "$owner" ]]; then
    chown -R "$owner" "$repo" "$staging_dir" 2>/dev/null || true
  fi
}

trap fix_host_permissions EXIT

if [[ -z "${BORG_PASSPHRASE:-}" ]]; then
  echo "BORG_PASSPHRASE is required." >&2
  exit 1
fi

if [[ ! -f "$database_path" ]]; then
  echo "Novo database not found: $database_path" >&2
  exit 1
fi

mkdir -p "$staging_dir" "$repo"
rm -f "$snapshot_path" "$manifest_path"

sqlite3 "$database_path" <<SQL
.timeout 30000
.backup '$snapshot_path'
SQL

integrity_check="$(sqlite3 "$snapshot_path" 'PRAGMA integrity_check;')"
if [[ "$integrity_check" != "ok" ]]; then
  echo "SQLite backup failed integrity check: $integrity_check" >&2
  exit 1
fi

count_files() {
  local dir="$1"
  if [[ -d "$dir" ]]; then
    find "$dir" -type f | wc -l | tr -d ' '
  else
    printf '0'
  fi
}

count_bytes() {
  local dir="$1"
  if [[ -d "$dir" ]]; then
    find "$dir" -type f -printf '%s\n' | awk '{ total += $1 } END { print total + 0 }'
  else
    printf '0'
  fi
}

sqlite_count() {
  local table="$1"
  sqlite3 "$snapshot_path" "SELECT COUNT(*) FROM $table;" 2>/dev/null || printf '0'
}

created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
archive_name="${archive_prefix}-$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cat > "$manifest_path" <<MANIFEST
created_at=$created_at
archive=$archive_name
database_path=$database_path
snapshot_path=$snapshot_path
snapshot_bytes=$(stat -c '%s' "$snapshot_path")
uploads_path=$runtime_dir/uploads
uploads_files=$(count_files "$runtime_dir/uploads")
uploads_bytes=$(count_bytes "$runtime_dir/uploads")
previews_path=$runtime_dir/previews
previews_files=$(count_files "$runtime_dir/previews")
previews_bytes=$(count_bytes "$runtime_dir/previews")
users=$(sqlite_count users)
notebooks=$(sqlite_count notebooks)
pages=$(sqlite_count pages)
attachments=$(sqlite_count attachments)
audit_events=$(sqlite_count audit_events)
MANIFEST

if [[ ! -f "$repo/config" ]]; then
  echo "Initializing Borg repository at $repo"
  borg init --encryption=repokey "$repo"
fi

sources=("$staging_dir")
if [[ -d "$runtime_dir/uploads" ]]; then
  sources+=("$runtime_dir/uploads")
fi
if [[ -d "$runtime_dir/previews" ]]; then
  sources+=("$runtime_dir/previews")
fi

echo "Creating Borg archive: $archive_name"
borg create --stats "$repo::$archive_name" "${sources[@]}"

echo "Applying retention policy: 30 daily, 12 weekly, 6 monthly"
borg prune --list "$repo" --glob-archives "${archive_prefix}-*" --keep-daily 30 --keep-weekly 12 --keep-monthly 6

borg compact "$repo"

echo "Created Borg backup archive: $archive_name"
