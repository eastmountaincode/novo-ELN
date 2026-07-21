#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Commit changes before triggering CCIB staging." >&2
  exit 1
fi

git fetch --prune origin
commit="$(git rev-parse "${1:-HEAD}^{commit}")"
if [[ -z "$(git branch -r --contains "$commit")" ]]; then
  echo "Push commit $commit to GitHub before triggering CCIB staging." >&2
  exit 1
fi

ccib_jump="${NOVO_CCIB_JUMP:-aboylan@ccibprod0.mgh.harvard.edu}"
ccib_host="${NOVO_CCIB_HOST:-aboylan@clustweb2}"
ccib_repo="${NOVO_CCIB_REPO:-/export/home/aboylan/novo-eln-prod}"

printf -v remote_command \
  'cd %q && git diff --quiet && git diff --cached --quiet && git fetch --prune origin && git checkout --detach %q && scripts/deploy-staging.sh %q' \
  "$ccib_repo" "$commit" "$commit"

echo "Triggering CCIB staging for GitHub commit $commit"
ssh -J "$ccib_jump" "$ccib_host" "$remote_command"
