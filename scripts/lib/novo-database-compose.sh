#!/usr/bin/env bash

# Add the Postgres compose override when the service environment opts in.
# This file expects novo_read_env_value from novo-chat-compose.sh.

novo_database_client() {
  local service_env_file="$1"
  local client

  client="$(novo_read_env_value "$service_env_file" ELN_DATABASE_CLIENT)" || return 1
  client="$(printf '%s' "$client" | tr '[:upper:]' '[:lower:]')"
  case "$client" in
    "" | sqlite)
      printf 'sqlite'
      ;;
    postgres | postgresql)
      printf 'postgres'
      ;;
    *)
      echo "Unsupported ELN_DATABASE_CLIENT in $service_env_file: $client" >&2
      return 1
      ;;
  esac
}

novo_configure_database_compose_args() {
  local service_env_file="$1"
  local project_root="$2"
  local client
  local postgres_env_file
  local service_root
  local password
  local data_dir
  local identifier
  local key

  client="$(novo_database_client "$service_env_file")" || return 1
  if [[ "$client" == "sqlite" ]]; then
    return 0
  fi

  service_root="$(cd "$(dirname "$service_env_file")" && pwd)"
  postgres_env_file="${NOVO_POSTGRES_ENV_FILE:-$service_root/.env.postgres}"
  if [[ ! -f "$postgres_env_file" || ! -r "$postgres_env_file" ]]; then
    echo "Postgres configuration is missing or unreadable: $postgres_env_file" >&2
    return 1
  fi

  password="$(novo_read_env_value "$postgres_env_file" NOVO_POSTGRES_PASSWORD)" || return 1
  data_dir="$(novo_read_env_value "$postgres_env_file" NOVO_POSTGRES_DATA_DIR)" || return 1
  if [[ -z "$password" || "$password" == "novo-dev-password" ]]; then
    echo "$postgres_env_file must define a non-default NOVO_POSTGRES_PASSWORD." >&2
    return 1
  fi
  if [[ ! "$password" =~ ^[A-Za-z0-9._~-]+$ ]]; then
    echo "NOVO_POSTGRES_PASSWORD must be URL-safe because it is embedded in DATABASE_URL." >&2
    return 1
  fi
  if [[ "$data_dir" != /* ]]; then
    echo "$postgres_env_file must define NOVO_POSTGRES_DATA_DIR as an absolute path." >&2
    return 1
  fi
  for key in NOVO_POSTGRES_CONTAINER_NAME NOVO_POSTGRES_USER NOVO_POSTGRES_DB; do
    identifier="$(novo_read_env_value "$postgres_env_file" "$key")" || return 1
    if [[ ! "$identifier" =~ ^[A-Za-z0-9_.-]+$ ]]; then
      echo "$postgres_env_file must define $key using simple identifier characters." >&2
      return 1
    fi
  done

  NOVO_COMPOSE_ARGS=(--env-file "$postgres_env_file" "${NOVO_COMPOSE_ARGS[@]}" -f "$project_root/docker-compose.postgres.yml")
}

novo_verify_database() {
  local container_name="$1"
  local service_env_file="$2"
  local client

  client="$(novo_database_client "$service_env_file")" || return 1
  if [[ "$client" == "postgres" ]]; then
    docker exec "$container_name" sh -c 'psql "$DATABASE_URL" -X -q -Atc "SELECT 1;"' | grep -qx 1
  else
    docker exec "$container_name" sqlite3 /app-data/data/eln.sqlite3 'PRAGMA quick_check;' | grep -qx ok
  fi
}
