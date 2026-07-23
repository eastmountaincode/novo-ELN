#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

requested_commit="${1:-}"
if [[ ! "$requested_commit" =~ ^[0-9a-fA-F]{7,40}$ ]]; then
  echo "Usage: $0 <Git commit SHA>" >&2
  exit 2
fi

production_root="${NOVO_PRODUCTION_ROOT:-$ROOT_DIR/../novo-eln-prod}"
production_env="${NOVO_PRODUCTION_ENV_FILE:-$production_root/.env.local}"
production_runtime="${NOVO_PRODUCTION_RUNTIME_DIR:-$production_root/runtime}"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Refusing to promote from a checkout with tracked changes." >&2
  exit 1
fi

git fetch --prune origin main
commit="$(git rev-parse "${requested_commit}^{commit}")"
if ! git merge-base --is-ancestor "$commit" origin/main; then
  echo "Refusing to promote $commit because it is not on origin/main." >&2
  exit 1
fi

image="novo-eln:${commit}"
docker image inspect "$image" >/dev/null
image_revision="$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"
if [[ "$image_revision" != "$commit" ]]; then
  echo "Image revision mismatch: expected $commit, found $image_revision" >&2
  exit 1
fi

staging_image="$(docker inspect novo-staging --format '{{.Config.Image}}' 2>/dev/null || true)"
if [[ "$staging_image" != "$image" ]]; then
  echo "Refusing to promote an image that is not running in staging." >&2
  echo "Expected $image, staging is running ${staging_image:-nothing}." >&2
  exit 1
fi
if ! curl -fsS "http://127.0.0.1:${NOVO_STAGING_PORT:-3155}/" | grep -Fq '<title>Novo-dev</title>'; then
  echo "Staging is not healthy with Novo-dev branding." >&2
  exit 1
fi

if [[ ! -f "$production_env" ]] || ! grep -Eq '^NOVO_INSTANCE=(prod|production)$' "$production_env"; then
  echo "$production_env must explicitly set NOVO_INSTANCE=prod before production promotion." >&2
  exit 1
fi
sqlite3 "$production_runtime/data/eln.sqlite3" 'PRAGMA quick_check;' | grep -qx ok

previous_image="$(docker inspect novo-eln --format '{{.Config.Image}}' 2>/dev/null || true)"

export NOVO_COMPOSE_PROJECT=novo-eln
export NOVO_CONTAINER_NAME=novo-eln
export NOVO_HOST_PORT="${NOVO_PRODUCTION_PORT:-3148}"
export NOVO_ENV_FILE="$production_env"
export NOVO_RUNTIME_DIR="$production_runtime"
export NOVO_IMAGE="$image"

git checkout --detach "$commit"
docker compose up -d --no-build novo

page=""
for _attempt in $(seq 1 60); do
  page="$(curl -fsS "http://127.0.0.1:${NOVO_HOST_PORT}/" 2>/dev/null || true)"
  if grep -Fq '<title>Novo</title>' <<<"$page"; then
    break
  fi
  sleep 1
done

if ! grep -Fq '<title>Novo</title>' <<<"$page"; then
  echo "Production failed its health check; attempting rollback." >&2
  if [[ -n "$previous_image" ]]; then
    export NOVO_IMAGE="$previous_image"
    docker compose up -d --no-build novo || true
  fi
  exit 1
fi

docker exec "$NOVO_CONTAINER_NAME" sqlite3 /app-data/data/eln.sqlite3 'PRAGMA quick_check;' | grep -qx ok
echo "Production now runs the staging-tested image $image"
