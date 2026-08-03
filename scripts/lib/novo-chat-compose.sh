#!/usr/bin/env bash

# Configure NOVO_COMPOSE_ARGS for an optional, file-mounted Novo Chat secret.
# This file is sourced by deployment scripts that already enable strict mode.

novo_read_env_value() {
  local env_file="$1"
  local key="$2"
  local count
  local value

  count="$(grep -Ec "^${key}=" "$env_file" || true)"
  if ((count > 1)); then
    echo "$env_file must define $key at most once." >&2
    return 1
  fi
  if ((count == 0)); then
    return 0
  fi

  value="$(sed -n "s/^${key}=//p" "$env_file")"
  if [[ "$value" != "${value#"${value%%[![:space:]]*}"}" ]] ||
    [[ "$value" != "${value%"${value##*[![:space:]]}"}" ]]; then
    echo "$env_file must not wrap $key in whitespace." >&2
    return 1
  fi
  printf '%s' "$value"
}

novo_configure_compose_args() {
  local service_env_file="$1"
  local project_root="$2"
  local container_secret_file
  local chat_url
  local host_secret_file="${NOVO_INTEGRATION_SECRET_HOST_FILE:-}"
  local canonical_project_root
  local canonical_host_secret_file

  NOVO_COMPOSE_ARGS=(-f "$project_root/docker-compose.yml")

  if [[ ! -f "$service_env_file" || ! -r "$service_env_file" ]]; then
    echo "Missing or unreadable service environment file: $service_env_file" >&2
    return 1
  fi

  if grep -q '^NOVO_INTEGRATION_SECRET_HOST_FILE=' "$service_env_file"; then
    echo "NOVO_INTEGRATION_SECRET_HOST_FILE belongs in the invoking shell, not $service_env_file." >&2
    return 1
  fi

  container_secret_file="$(novo_read_env_value "$service_env_file" NOVO_INTEGRATION_SECRET_FILE)" || return 1
  chat_url="$(novo_read_env_value "$service_env_file" NOVO_CHAT_URL)" || return 1

  if [[ -z "$container_secret_file" && -z "$host_secret_file" ]]; then
    if [[ -n "$chat_url" ]]; then
      echo "$service_env_file sets NOVO_CHAT_URL but does not set NOVO_INTEGRATION_SECRET_FILE." >&2
      return 1
    fi
    return 0
  fi

  if [[ -z "$container_secret_file" ]]; then
    echo "$service_env_file must set NOVO_INTEGRATION_SECRET_FILE when NOVO_INTEGRATION_SECRET_HOST_FILE is configured." >&2
    return 1
  fi
  if [[ "$container_secret_file" != "/run/secrets/novo-integration" ]]; then
    echo "NOVO_INTEGRATION_SECRET_FILE must be exactly /run/secrets/novo-integration." >&2
    return 1
  fi
  if [[ -z "$host_secret_file" ]]; then
    echo "NOVO_INTEGRATION_SECRET_HOST_FILE must be set when $service_env_file enables the integration." >&2
    return 1
  fi
  if [[ "$host_secret_file" != /* ]] || [[ "$host_secret_file" == *$'\n'* ]] || [[ "$host_secret_file" == *$'\r'* ]]; then
    echo "NOVO_INTEGRATION_SECRET_HOST_FILE must be an absolute host path without line breaks." >&2
    return 1
  fi
  if [[ ! -f "$host_secret_file" || ! -r "$host_secret_file" || ! -s "$host_secret_file" ]]; then
    echo "NOVO_INTEGRATION_SECRET_HOST_FILE must be a readable, non-empty regular file." >&2
    return 1
  fi

  canonical_project_root="$(realpath "$project_root")"
  canonical_host_secret_file="$(realpath "$host_secret_file")"
  if [[ "$canonical_host_secret_file" == "$canonical_project_root"/* ]]; then
    echo "NOVO_INTEGRATION_SECRET_HOST_FILE must live outside the Git checkout." >&2
    return 1
  fi

  export NOVO_INTEGRATION_SECRET_FILE="$container_secret_file"
  export NOVO_INTEGRATION_SECRET_HOST_FILE="$canonical_host_secret_file"
  NOVO_COMPOSE_ARGS+=(-f "$project_root/docker-compose.chat.yml")
}
