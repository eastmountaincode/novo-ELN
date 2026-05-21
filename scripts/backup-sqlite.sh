#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${ELN_ENV_FILE:-$project_root/.env.local}"

if [[ -f "$env_file" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
fi

data_dir="${ELN_DATA_DIR:-$project_root/data}"
upload_dir="${ELN_UPLOAD_DIR:-$project_root/storage/uploads}"
preview_dir="${ELN_PREVIEW_DIR:-$data_dir/previews}"
database_path="${ELN_DATABASE_PATH:-$data_dir/eln.sqlite3}"
staging_dir="${ELN_BACKUP_STAGING_DIR:-$data_dir/backup-staging}"
snapshot_path="$staging_dir/eln.sqlite3"
manifest_path="$staging_dir/manifest.json"

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 is required for Novo backups." >&2
  exit 1
fi

if [[ ! -f "$database_path" ]]; then
  echo "SQLite database not found: $database_path" >&2
  exit 1
fi

mkdir -p "$staging_dir"
rm -f "$snapshot_path" "$manifest_path"

sqlite3 "$database_path" <<SQL
.timeout 30000
.backup '$snapshot_path'
SQL

integrity_check="$(sqlite3 "$snapshot_path" 'PRAGMA integrity_check;')"
if [[ "$integrity_check" != "ok" ]]; then
  echo "SQLite backup failed integrity check: $integrity_check" >&2
  exit 1
fi

node - "$manifest_path" "$snapshot_path" "$database_path" "$upload_dir" "$preview_dir" "$project_root" <<'NODE'
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const [manifestPath, snapshotPath, databasePath, uploadDir, previewDir, projectRoot] = process.argv.slice(2);

function fileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function dirStats(dirPath) {
  let files = 0;
  let bytes = 0;

  function visit(currentPath) {
    if (!fs.existsSync(currentPath)) return;
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile()) {
        files += 1;
        bytes += fs.statSync(entryPath).size;
      }
    }
  }

  visit(dirPath);
  return { files, bytes };
}

function sqliteValue(query) {
  try {
    return execFileSync("sqlite3", [snapshotPath, "-batch", "-noheader", query], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function gitCommit() {
  try {
    return execFileSync("git", ["-C", projectRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

const manifest = {
  createdAt: new Date().toISOString(),
  projectRoot,
  databasePath,
  sqliteSnapshotPath: snapshotPath,
  sqliteSnapshotBytes: fileSize(snapshotPath),
  uploads: {
    path: uploadDir,
    ...dirStats(uploadDir),
  },
  previews: {
    path: previewDir,
    ...dirStats(previewDir),
  },
  databaseCounts: {
    users: Number(sqliteValue("SELECT COUNT(*) FROM users;") || 0),
    notebooks: Number(sqliteValue("SELECT COUNT(*) FROM notebooks;") || 0),
    pages: Number(sqliteValue("SELECT COUNT(*) FROM pages;") || 0),
    attachments: Number(sqliteValue("SELECT COUNT(*) FROM attachments;") || 0),
    auditEvents: Number(sqliteValue("SELECT COUNT(*) FROM audit_events;") || 0),
  },
  gitCommit: gitCommit(),
};

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

echo "Created SQLite backup snapshot: $snapshot_path"
echo "Wrote backup manifest: $manifest_path"
