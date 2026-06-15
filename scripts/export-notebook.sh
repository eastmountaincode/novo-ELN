#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR=""
MODE="auto"
ARGS=()

usage() {
  cat <<'EOF'
Export a Novo notebook.

Usage:
  ./scripts/export-notebook.sh --notebook-name "Binders-II" --out ./notebook-exports
  ./scripts/export-notebook.sh --notebook-id <uuid> --out ./notebook-exports

Options:
  --direct   Run with host node/sqlite3 instead of Docker.
  --docker   Run through Docker even if host node/sqlite3 exist.

All other options are passed to export-notebook.mjs.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --direct)
      MODE="direct"
      shift
      ;;
    --docker)
      MODE="docker"
      shift
      ;;
    --out)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --out" >&2
        exit 1
      fi
      OUT_DIR="$2"
      ARGS+=("$1" "$2")
      shift 2
      ;;
    *)
      ARGS+=("$1")
      shift
      ;;
  esac
done

if [[ ${#ARGS[@]} -eq 0 ]]; then
  usage
  exit 1
fi

if [[ -z "$OUT_DIR" ]]; then
  OUT_DIR="$APP_DIR/notebook-exports"
  ARGS+=("--out" "$OUT_DIR")
fi

run_direct() {
  cd "$APP_DIR"
  exec node scripts/export-notebook.mjs "${ARGS[@]}"
}

run_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker is not available, and direct mode is not usable on this host." >&2
    echo "Install node + sqlite3, or run on a host with Docker." >&2
    exit 1
  fi

  mkdir -p "$OUT_DIR"
  local out_abs
  out_abs="$(cd "$OUT_DIR" && pwd)"

  local docker_args=()
  local skip_next=0
  for ((i = 0; i < ${#ARGS[@]}; i++)); do
    if [[ "$skip_next" -eq 1 ]]; then
      skip_next=0
      continue
    fi
    case "${ARGS[$i]}" in
      --out)
        docker_args+=("--out" "/exports")
        skip_next=1
        ;;
      --db|--uploads)
        echo "${ARGS[$i]} is handled by the Docker runtime mount; omit it when using Docker mode." >&2
        exit 1
        ;;
      *)
        docker_args+=("${ARGS[$i]}")
        ;;
    esac
  done

  cd "$APP_DIR"
  exec docker run --rm --user "$(id -u):$(id -g)" \
    --env-file .env.local \
    -e ELN_DATA_DIR=/app-data/data \
    -e ELN_UPLOAD_DIR=/app-data/uploads \
    -e ELN_PREVIEW_DIR=/app-data/previews \
    -e ELN_DATABASE_PATH=/app-data/data/eln.sqlite3 \
    -v "$APP_DIR/runtime:/app-data:ro" \
    -v "$APP_DIR/scripts:/app/scripts:ro" \
    -v "$out_abs:/exports" \
    -w /app \
    novo-eln:latest \
    node scripts/export-notebook.mjs \
      --db /app-data/data/eln.sqlite3 \
      --uploads /app-data/uploads \
      "${docker_args[@]}"
}

case "$MODE" in
  direct)
    if ! command -v node >/dev/null 2>&1 || ! command -v sqlite3 >/dev/null 2>&1; then
      echo "Direct mode requires node and sqlite3 on PATH." >&2
      exit 1
    fi
    run_direct
    ;;
  docker)
    run_docker
    ;;
  auto)
    if command -v node >/dev/null 2>&1 && command -v sqlite3 >/dev/null 2>&1; then
      run_direct
    else
      run_docker
    fi
    ;;
esac
