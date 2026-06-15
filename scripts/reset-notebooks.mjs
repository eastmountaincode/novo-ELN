import fsp from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

const cwd = process.cwd();
const databasePath = process.env.ELN_DATABASE_PATH || path.join(cwd, "data", "eln.sqlite3");
const uploadDir = process.env.ELN_UPLOAD_DIR || path.join(cwd, "storage", "uploads");
const previewDir = process.env.ELN_PREVIEW_DIR || path.join(cwd, "storage", "previews");

const confirmed = process.argv.includes("--confirm") && process.argv.includes("DELETE_ALL_NOTEBOOKS");
if (!confirmed) {
  process.stderr.write("Refusing to reset notebooks. Run with: --confirm DELETE_ALL_NOTEBOOKS\n");
  process.exit(1);
}

const before = queryJson(`
  SELECT
    (SELECT COUNT(*) FROM notebooks) AS notebooks,
    (SELECT COUNT(*) FROM pages) AS pages,
    (SELECT COUNT(*) FROM attachments) AS attachments,
    (SELECT COUNT(*) FROM audit_events) AS audit_events;
`)[0] || {};

execSql(`
  BEGIN IMMEDIATE;
  DELETE FROM notebooks;
  DELETE FROM search_pages_fts;
  DELETE FROM search_index_queue;
  DELETE FROM audit_events;
  COMMIT;
`);

await fsp.rm(uploadDir, { recursive: true, force: true });
await fsp.rm(previewDir, { recursive: true, force: true });
await fsp.mkdir(uploadDir, { recursive: true });
await fsp.mkdir(previewDir, { recursive: true });

process.stdout.write(`Reset complete. Removed ${before.notebooks || 0} notebooks, ${before.pages || 0} pages, ${before.attachments || 0} attachment records, and ${before.audit_events || 0} audit events. Users were preserved.\n`);

function execSql(statement) {
  execFileSync("sqlite3", [databasePath, "-batch"], { input: `.timeout 30000\nPRAGMA foreign_keys=ON;\n${statement}`, stdio: ["pipe", "pipe", "pipe"], maxBuffer: 512 * 1024 * 1024 });
}

function queryJson(statement) {
  const output = execFileSync("sqlite3", ["-json", databasePath, statement], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  return JSON.parse(output || "[]");
}
