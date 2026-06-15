#!/usr/bin/env bash
set -euo pipefail

APP_DIR=${APP_DIR:-$(pwd)}
OWNER_EMAIL=${OWNER_EMAIL:-}
IMPORT_DIRS=${IMPORT_DIRS:-${IMPORT_DIR:-}}
ORDER=${ORDER:-largest-first}
PRIORITY_NOTEBOOKS=${PRIORITY_NOTEBOOKS:-}
RESET_FIRST=${RESET_FIRST:-0}
EXPORT_EDITED_FIRST=${EXPORT_EDITED_FIRST:-1}
SAVE_EDITED_SINCE=${SAVE_EDITED_SINCE:-"2026-05-26 00:00:00"}
RUN_STAMP=$(date +%Y%m%d-%H%M%S)

if [[ -z "$OWNER_EMAIL" ]]; then
  echo "Set OWNER_EMAIL before running." >&2
  exit 1
fi

if [[ -z "$IMPORT_DIRS" ]]; then
  echo "Set IMPORT_DIR or IMPORT_DIRS before running." >&2
  exit 1
fi

cd "$APP_DIR"
RUN_DIR=${RUN_DIR:-"$APP_DIR/import-runs/yarle-$RUN_STAMP"}
mkdir -p "$RUN_DIR"
COMBINED_MANIFEST="$RUN_DIR/enex-files.tsv"
: > "$COMBINED_MANIFEST"

priority_rank() {
  local notebook_name=$1
  local rank=1
  local priority

  if [[ -z "$PRIORITY_NOTEBOOKS" ]]; then
    echo 999999
    return
  fi

  IFS=':' read -r -a priority_notebooks <<< "$PRIORITY_NOTEBOOKS"
  for priority in "${priority_notebooks[@]}"; do
    if [[ "$notebook_name" == "$priority" ]]; then
      echo "$rank"
      return
    fi
    rank=$((rank + 1))
  done

  echo 999999
}

IFS=':' read -r -a import_dirs <<< "$IMPORT_DIRS"
for import_dir in "${import_dirs[@]}"; do
  manifest="$import_dir/enex-files.tsv"
  if [[ ! -f "$manifest" ]]; then
    echo "Missing manifest: $manifest" >&2
    exit 1
  fi
  while IFS=$'\t' read -r size rel_path; do
    [[ -z "${size:-}" || -z "${rel_path:-}" ]] && continue
    if [[ ! -f "$import_dir/$rel_path" && -f "$import_dir/extracted/$rel_path" ]]; then
      rel_path="extracted/$rel_path"
    fi
    if [[ ! -f "$import_dir/$rel_path" ]]; then
      echo "Missing ENEX listed in manifest: $import_dir/$rel_path" >&2
      exit 1
    fi
    printf '%s\t%s\t%s\n' "$size" "$import_dir" "$rel_path" >> "$COMBINED_MANIFEST"
  done < "$manifest"
done

SORT_MANIFEST="$RUN_DIR/enex-files.with-priority.tsv"
SORTED_MANIFEST="$RUN_DIR/enex-files.sorted.tsv"
: > "$SORT_MANIFEST"
row_index=0
while IFS=$'\t' read -r size import_dir rel_path; do
  row_index=$((row_index + 1))
  notebook_name=$(basename "$rel_path" .enex)
  rank=$(priority_rank "$notebook_name")
  printf '%s\t%s\t%s\t%s\t%s\n' "$rank" "$size" "$row_index" "$import_dir" "$rel_path" >> "$SORT_MANIFEST"
done < "$COMBINED_MANIFEST"

case "$ORDER" in
  largest-first)
    sort -t $'\t' -k1,1n -k2,2nr "$SORT_MANIFEST" > "$SORTED_MANIFEST"
    ;;
  smallest-first)
    sort -t $'\t' -k1,1n -k2,2n "$SORT_MANIFEST" > "$SORTED_MANIFEST"
    ;;
  manifest)
    sort -t $'\t' -k1,1n -k3,3n "$SORT_MANIFEST" > "$SORTED_MANIFEST"
    ;;
  *)
    echo "Unknown ORDER '$ORDER'. Use largest-first, smallest-first, or manifest." >&2
    exit 1
    ;;
esac
awk -F '\t' 'BEGIN {OFS="\t"} {print $2, $4, $5}' "$SORTED_MANIFEST" > "$COMBINED_MANIFEST"

total_count=$(wc -l < "$COMBINED_MANIFEST" | tr -d ' ')
total_bytes=$(awk -F '\t' '{sum += $1} END {printf "%.0f", sum}' "$COMBINED_MANIFEST")

format_bytes() {
  numfmt --to=iec-i --suffix=B "$1" 2>/dev/null || echo "$1 bytes"
}

echo "Novo Yarle ENEX batch import started at $(date -Is)"
echo "App directory: $APP_DIR"
echo "Owner email: $OWNER_EMAIL"
echo "Import dirs: $IMPORT_DIRS"
echo "Order: $ORDER"
if [[ -n "$PRIORITY_NOTEBOOKS" ]]; then
  echo "Priority notebooks: $PRIORITY_NOTEBOOKS"
fi
echo "Total: $total_count notebooks, $(format_bytes "$total_bytes")"
echo "Run dir: $RUN_DIR"

if [[ "${LIST_ONLY:-0}" == "1" ]]; then
  index=0
  while IFS=$'\t' read -r size import_dir rel_path; do
    index=$((index + 1))
    notebook_name=$(basename "$rel_path" .enex)
    echo "$(printf '%02d' "$index")  $(format_bytes "$size")  $notebook_name"
  done < "$COMBINED_MANIFEST"
  exit 0
fi

if [[ "$EXPORT_EDITED_FIRST" == "1" ]]; then
  export_dir="/app-data/manual-review/edited-pages-before-yarle-reimport-$RUN_STAMP"
  echo "Exporting edited pages since $SAVE_EDITED_SINCE to $export_dir"
  docker compose run --rm novo npm run export:edited-pages -- --since "$SAVE_EDITED_SINCE" --out "$export_dir"
fi

if [[ "$RESET_FIRST" == "1" ]]; then
  if [[ "${CONFIRM_WIPE_AND_REIMPORT:-}" != "YES" ]]; then
    echo "RESET_FIRST=1 requires CONFIRM_WIPE_AND_REIMPORT=YES." >&2
    exit 1
  fi
  echo "Resetting notebooks before reimport. Users will be preserved."
  docker compose run --rm novo npm run reset:notebooks -- --confirm DELETE_ALL_NOTEBOOKS
fi

index=0
done_bytes=0
while IFS=$'\t' read -r size import_dir rel_path; do
  index=$((index + 1))
  notebook_name=$(basename "$rel_path" .enex)
  safe_log_name=$(echo "$notebook_name" | tr -c '[:alnum:]. _-' '_' | tr ' ' '_')
  log_file="$RUN_DIR/$(printf '%02d' "$index")-$safe_log_name.log"
  echo
  echo "============================================================"
  echo "Notebook $index of $total_count: $notebook_name"
  echo "File: $import_dir/$rel_path"
  echo "Size: $(format_bytes "$size")"
  echo "Overall before this notebook: $(format_bytes "$done_bytes") / $(format_bytes "$total_bytes")"
  echo "Log: $log_file"
  echo "============================================================"

  set +e
  docker compose run --rm -T -v "$import_dir:/import:ro" novo npm run import:enex-yarle -- \
    --path "/import/$rel_path" \
    --user-email "$OWNER_EMAIL" \
    --notebook-name "$notebook_name" < /dev/null 2>&1 | tee "$log_file"
  status=${PIPESTATUS[0]}
  set -e
  if [[ "$status" -ne 0 ]]; then
    echo "Import failed for $notebook_name. See $log_file" >&2
    exit "$status"
  fi
  done_bytes=$((done_bytes + size))
  echo "[done] $notebook_name"
done < "$COMBINED_MANIFEST"

echo
echo "All Yarle ENEX imports completed at $(date -Is)."
