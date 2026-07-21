#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

production_db="${NOVO_PRODUCTION_DATABASE:-$ROOT_DIR/runtime/data/eln.sqlite3}"
staging_runtime="${NOVO_STAGING_RUNTIME_DIR:-$ROOT_DIR/runtime-staging}"
staging_db="$staging_runtime/data/eln.sqlite3"
snapshot_tmp="$staging_runtime/data/eln.sqlite3.next"
staging_container="${NOVO_STAGING_CONTAINER:-novo-staging}"
was_running=false

if [[ ! -f "$production_db" ]]; then
  echo "Production database not found at $production_db" >&2
  exit 1
fi

if [[ "$(docker inspect "$staging_container" --format '{{.State.Running}}' 2>/dev/null || true)" == "true" ]]; then
  was_running=true
  docker stop "$staging_container" >/dev/null
fi

cleanup() {
  rm -f "$snapshot_tmp"
  if [[ "$was_running" == "true" ]]; then
    docker start "$staging_container" >/dev/null || true
  fi
}
trap cleanup EXIT

mkdir -p "$staging_runtime/data" "$staging_runtime/uploads" "$staging_runtime/previews"
sqlite3 "$production_db" ".backup '$snapshot_tmp'"
sqlite3 "$snapshot_tmp" 'PRAGMA quick_check;' | grep -qx ok
chmod 600 "$snapshot_tmp"
mv -f "$snapshot_tmp" "$staging_db"

echo "Refreshed the disposable staging database at $staging_db"
echo "Attachment and preview files were not copied. Sync only the files needed for a file-specific test."
