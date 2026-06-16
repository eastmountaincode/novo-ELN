#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export NOVO_BUILD_ID="${NOVO_BUILD_ID:-$(git rev-parse --short=8 HEAD 2>/dev/null || echo unknown)}"
export NOVO_BUILD_DATE="${NOVO_BUILD_DATE:-$(TZ="${NOVO_BUILD_TIME_ZONE:-America/New_York}" date +%Y-%m-%d)}"

echo "Deploying Novo ${NOVO_BUILD_DATE} · ${NOVO_BUILD_ID}"
docker compose up -d --build
echo "Novo deployment updated."
