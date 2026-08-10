#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

production_db="${NOVO_PRODUCTION_DATABASE:-$ROOT_DIR/../novo-eln-prod/runtime/data/eln.sqlite3}"
production_root="${NOVO_PRODUCTION_ROOT:-$ROOT_DIR/../novo-eln-prod}"
production_env="${NOVO_PRODUCTION_ENV_FILE:-$production_root/.env.local}"
staging_runtime="${NOVO_STAGING_RUNTIME_DIR:-$ROOT_DIR/runtime-staging}"
staging_db="$staging_runtime/data/eln.sqlite3"
snapshot_tmp="$staging_runtime/data/eln.sqlite3.next"
staging_container="${NOVO_STAGING_CONTAINER:-novo-staging}"
was_running=false

source "$ROOT_DIR/scripts/lib/novo-chat-compose.sh"
source "$ROOT_DIR/scripts/lib/novo-database-compose.sh"
database_client="$(novo_database_client "$production_env")"

if [[ "$database_client" == "postgres" ]]; then
  production_postgres_env="${NOVO_PRODUCTION_POSTGRES_ENV_FILE:-$production_root/.env.postgres}"
  staging_postgres_env="${NOVO_STAGING_POSTGRES_ENV_FILE:-$ROOT_DIR/.env.postgres}"
  for config in "$production_postgres_env" "$staging_postgres_env"; do
    if [[ ! -f "$config" || ! -r "$config" ]]; then
      echo "Postgres configuration is missing or unreadable: $config" >&2
      exit 1
    fi
  done
  production_postgres_container="$(novo_read_env_value "$production_postgres_env" NOVO_POSTGRES_CONTAINER_NAME)"
  production_postgres_user="$(novo_read_env_value "$production_postgres_env" NOVO_POSTGRES_USER)"
  production_postgres_db="$(novo_read_env_value "$production_postgres_env" NOVO_POSTGRES_DB)"
  staging_postgres_container="$(novo_read_env_value "$staging_postgres_env" NOVO_POSTGRES_CONTAINER_NAME)"
  staging_postgres_user="$(novo_read_env_value "$staging_postgres_env" NOVO_POSTGRES_USER)"
  staging_postgres_db="$(novo_read_env_value "$staging_postgres_env" NOVO_POSTGRES_DB)"
  dump_tmp="$staging_runtime/data/postgres.dump.next"

  for value in "$production_postgres_container" "$production_postgres_user" "$production_postgres_db" "$staging_postgres_container" "$staging_postgres_user" "$staging_postgres_db"; do
    if [[ ! "$value" =~ ^[A-Za-z0-9_.-]+$ ]]; then
      echo "Postgres container, user, and database names must use simple identifier characters." >&2
      exit 1
    fi
  done

  if [[ "$(docker inspect "$staging_container" --format '{{.State.Running}}' 2>/dev/null || true)" == "true" ]]; then
    was_running=true
    docker stop "$staging_container" >/dev/null
  fi

  cleanup_postgres() {
    rm -f "$dump_tmp"
    if [[ "$was_running" == "true" ]]; then
      docker start "$staging_container" >/dev/null || true
    fi
  }
  trap cleanup_postgres EXIT

  mkdir -p "$staging_runtime/data"
  docker exec "$production_postgres_container" pg_dump -U "$production_postgres_user" -d "$production_postgres_db" --format=custom --no-owner --no-privileges > "$dump_tmp"
  docker exec -i "$production_postgres_container" pg_restore --list < "$dump_tmp" >/dev/null
  docker exec "$staging_postgres_container" psql -U "$staging_postgres_user" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$staging_postgres_db\" WITH (FORCE);"
  docker exec "$staging_postgres_container" psql -U "$staging_postgres_user" -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$staging_postgres_db\";"
  docker exec -i "$staging_postgres_container" pg_restore -U "$staging_postgres_user" -d "$staging_postgres_db" --no-owner --no-privileges < "$dump_tmp"

  source_count="$(docker exec "$production_postgres_container" psql -U "$production_postgres_user" -d "$production_postgres_db" -Atc 'SELECT COUNT(*) FROM pages;')"
  staging_count="$(docker exec "$staging_postgres_container" psql -U "$staging_postgres_user" -d "$staging_postgres_db" -Atc 'SELECT COUNT(*) FROM pages;')"
  if [[ "$source_count" != "$staging_count" ]]; then
    echo "Postgres staging refresh page count mismatch: source=$source_count staging=$staging_count" >&2
    exit 1
  fi

  echo "Refreshed the disposable Postgres staging database with $staging_count pages"
  echo "Attachment, preview, and proof files were not copied. Sync only the files needed for a file-specific test."
  exit 0
fi

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
