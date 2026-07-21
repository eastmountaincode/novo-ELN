#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

requested_commit="${1:-}"
if [[ ! "$requested_commit" =~ ^[0-9a-fA-F]{7,40}$ ]]; then
  echo "Usage: $0 <Git commit SHA>" >&2
  exit 2
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Refusing to deploy from a checkout with tracked changes." >&2
  exit 1
fi

git fetch --prune origin
commit="$(git rev-parse "${requested_commit}^{commit}")"
if [[ -z "$(git branch -r --contains "$commit")" ]]; then
  echo "Commit $commit is not present on a fetched GitHub branch." >&2
  exit 1
fi

git checkout --detach "$commit"

if [[ ! -f .env.staging ]]; then
  echo "Missing .env.staging. See ops/deployment/README.md." >&2
  exit 1
fi
if ! grep -Eq '^NOVO_INSTANCE=(dev|development|staging)$' .env.staging; then
  echo ".env.staging must explicitly set NOVO_INSTANCE=dev." >&2
  exit 1
fi
if [[ ! -f runtime-staging/data/eln.sqlite3 ]]; then
  echo "Missing staging database. Run scripts/refresh-staging-snapshot.sh first." >&2
  exit 1
fi

export NOVO_COMPOSE_PROJECT=novo-staging
export NOVO_CONTAINER_NAME=novo-staging
export NOVO_HOST_PORT="${NOVO_STAGING_PORT:-3155}"
export NOVO_ENV_FILE=.env.staging
export NOVO_RUNTIME_DIR=./runtime-staging
export NOVO_IMAGE="novo-eln:${commit}"
export NOVO_BUILD_ID="${commit:0:12}"
export NOVO_GIT_SHA="$commit"
export NOVO_BUILD_DATE="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

echo "Building staging image $NOVO_IMAGE from GitHub commit $commit"
docker compose build novo

image_revision="$(docker image inspect "$NOVO_IMAGE" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"
if [[ "$image_revision" != "$commit" ]]; then
  echo "Image revision mismatch: expected $commit, found $image_revision" >&2
  exit 1
fi

docker compose up -d --no-build novo

page=""
for _attempt in $(seq 1 60); do
  page="$(curl -fsS "http://127.0.0.1:${NOVO_HOST_PORT}/" 2>/dev/null || true)"
  if grep -Fq '<title>Novo-dev</title>' <<<"$page"; then
    break
  fi
  sleep 1
done

if ! grep -Fq '<title>Novo-dev</title>' <<<"$page"; then
  echo "Staging failed its Novo-dev health check." >&2
  docker logs --tail=100 "$NOVO_CONTAINER_NAME" >&2 || true
  exit 1
fi

docker exec "$NOVO_CONTAINER_NAME" sqlite3 /app-data/data/eln.sqlite3 'PRAGMA quick_check;' | grep -qx ok
echo "Staging is healthy on 127.0.0.1:${NOVO_HOST_PORT} at commit $commit"
