#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const args = parseArgs(process.argv.slice(2));
const sqlitePath = args.sqlite ?? process.env.ELN_DATABASE_PATH ?? path.join(cwd, "runtime", "data", "eln.sqlite3");
const databaseUrl = args.databaseUrl ?? process.env.DATABASE_URL ?? "";
const dryRun = Boolean(args.dryRun);
const truncateTarget = Boolean(args.truncateTarget);
const chunkSize = Number(args.chunkSize ?? 150);
const derivedSearchTables = ["search_pages_vocab", "search_pages_fts"];

const tableOrder = [
  "users",
  "login_attempts",
  "notebooks",
  "notebook_members",
  "pages",
  "user_signing_keys",
  "tags",
  "page_tags",
  "page_comment_threads",
  "page_comments",
  "attachments",
  "attachment_annotations",
  "page_signatures",
  "page_signature_timestamps",
  "audit_events",
  "search_index_queue",
  "app_settings",
];

if (!databaseUrl) fail("DATABASE_URL is required for the Postgres target.");
if (!fs.existsSync(sqlitePath)) fail(`SQLite database not found: ${sqlitePath}`);
if (!commandExists("sqlite3")) fail("sqlite3 is required.");
if (!commandExists("psql")) fail("psql is required.");
if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 1000) fail("--chunk-size must be between 1 and 1000.");

const sourceTables = new Set(sqliteJson("SELECT name FROM sqlite_master WHERE type = 'table';").map((row) => row.name));
const targetTables = new Set(postgresRows(`
  SELECT table_name AS name
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_type = 'BASE TABLE';
`).map((row) => row.name));

const missingTargetTables = tableOrder.filter((table) => !targetTables.has(table));
if (missingTargetTables.length) {
  fail(`Postgres target is missing table(s): ${missingTargetTables.join(", ")}. Start Novo once with ELN_DATABASE_CLIENT=postgres or initialize the schema before migration.`);
}

const plan = tableOrder
  .filter((table) => sourceTables.has(table))
  .map((table) => {
    const sourceColumns = sqliteJson(`PRAGMA table_info(${quoteSqliteIdentifier(table)});`).map((column) => column.name);
    const targetColumns = postgresRows(`
      SELECT column_name AS name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${pgValue(table)}
      ORDER BY ordinal_position;
    `).map((column) => column.name);
    const targetColumnSet = new Set(targetColumns);
    const columns = sourceColumns.filter((column) => targetColumnSet.has(column));
    const sourceCount = Number(sqliteJson(`SELECT COUNT(*) AS count FROM ${quoteSqliteIdentifier(table)};`)[0]?.count ?? 0);
    return { table, columns, sourceCount };
  });

for (const item of plan) {
  if (!item.columns.length && item.sourceCount > 0) fail(`No shared columns for table ${item.table}.`);
}

console.log(`SQLite source: ${sqlitePath}`);
console.log(`Postgres target: ${safePostgresTarget(databaseUrl)}`);
console.log(`Tables: ${plan.map((item) => `${item.table}=${item.sourceCount}`).join(", ")}`);

if (dryRun) {
  console.log("Dry run complete. No Postgres data was changed.");
  process.exit(0);
}

if (truncateTarget) {
  const tables = [...new Set([...tableOrder].reverse().concat(derivedSearchTables))].filter((table) => targetTables.has(table));
  postgresExec(`TRUNCATE TABLE ${tables.map(quotePgIdentifier).join(", ")} CASCADE;`);
  console.log(`Truncated target tables: ${tables.length}`);
}

for (const item of plan) {
  if (item.sourceCount === 0) {
    console.log(`Skipped ${item.table}: 0 rows`);
    continue;
  }
  const rows = sqliteJson(`SELECT ${item.columns.map(quoteSqliteIdentifier).join(", ")} FROM ${quoteSqliteIdentifier(item.table)};`);
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const values = chunk.map((row) => `(${item.columns.map((column) => pgValue(row[column])).join(", ")})`);
    postgresExec(`
      INSERT INTO ${quotePgIdentifier(item.table)} (${item.columns.map(quotePgIdentifier).join(", ")})
      VALUES ${values.join(",\n")}
      ON CONFLICT DO NOTHING;
    `);
  }
  const targetCount = Number(postgresRows(`SELECT COUNT(*) AS count FROM ${quotePgIdentifier(item.table)};`)[0]?.count ?? 0);
  console.log(`Copied ${item.table}: ${item.sourceCount} source rows, ${targetCount} target rows`);
}

restoreNotebookContentRevisions();
clearDerivedSearchTables();
console.log("Postgres migration copy complete. Start Novo with Postgres enabled so it can rebuild search_pages_fts if needed.");

function sqliteJson(statement) {
  const output = execFileSync("sqlite3", ["-json", sqlitePath, statement], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
  return JSON.parse(output || "[]");
}

function postgresRows(statement) {
  return parseCsv(execFileSync("psql", [databaseUrl, "-X", "-q", "-v", "ON_ERROR_STOP=1", "--csv", "-P", "footer=off"], {
    input: statement,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 512 * 1024 * 1024,
  }));
}

function postgresExec(statement) {
  execFileSync("psql", [databaseUrl, "-X", "-q", "-v", "ON_ERROR_STOP=1"], {
    input: statement,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 512 * 1024 * 1024,
  });
}

function restoreNotebookContentRevisions() {
  if (!sourceTables.has("notebooks") || !targetTables.has("notebooks")) return;
  const sourceColumns = sqliteJson(`PRAGMA table_info(${quoteSqliteIdentifier("notebooks")});`).map((column) => column.name);
  if (!sourceColumns.includes("content_revision")) return;
  const rows = sqliteJson(`SELECT id, content_revision FROM ${quoteSqliteIdentifier("notebooks")};`);
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    if (!chunk.length) continue;
    postgresExec(`
      UPDATE notebooks AS n
      SET content_revision = v.content_revision
      FROM (VALUES ${chunk.map((row) => `(${pgValue(row.id)}, ${Number(row.content_revision) || 1})`).join(",\n")}) AS v(id, content_revision)
      WHERE n.id = v.id;
    `);
  }
  console.log(`Restored notebook content revisions: ${rows.length}`);
}

function clearDerivedSearchTables() {
  const tables = derivedSearchTables.filter((table) => targetTables.has(table));
  if (!tables.length) return;
  postgresExec(`TRUNCATE TABLE ${tables.map(quotePgIdentifier).join(", ")} CASCADE;`);
  console.log(`Cleared derived search tables: ${tables.join(", ")}`);
}

function parseCsv(input) {
  const clean = input.trimEnd();
  if (!clean) return [];
  const rows = parseCsvRows(clean);
  const [headers, ...dataRows] = rows;
  return dataRows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function parseCsvRows(input) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  row.push(field);
  rows.push(row);
  return rows;
}

function pgValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  const text = String(value);
  if (text.includes("\u0000")) throw new Error("Postgres text values cannot contain NUL bytes.");
  return `'${text.replace(/'/g, "''")}'`;
}

function quotePgIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function quoteSqliteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function commandExists(name) {
  try {
    execFileSync("command", ["-v", name], { stdio: "ignore" });
    return true;
  } catch {
    try {
      execFileSync("which", [name], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }
}

function safePostgresTarget(value) {
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return "postgres";
  }
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--dry-run") {
      parsed.dryRun = true;
    } else if (value === "--truncate-target") {
      parsed.truncateTarget = true;
    } else if (value.startsWith("--sqlite=")) {
      parsed.sqlite = value.slice("--sqlite=".length);
    } else if (value === "--sqlite") {
      parsed.sqlite = values[++index];
    } else if (value.startsWith("--database-url=")) {
      parsed.databaseUrl = value.slice("--database-url=".length);
    } else if (value === "--database-url") {
      parsed.databaseUrl = values[++index];
    } else if (value.startsWith("--chunk-size=")) {
      parsed.chunkSize = value.slice("--chunk-size=".length);
    } else if (value === "--chunk-size") {
      parsed.chunkSize = values[++index];
    } else if (value === "--help" || value === "-h") {
      console.log("Usage: npm run db:migrate:postgres -- --sqlite runtime/data/eln.sqlite3 --database-url postgresql://... [--truncate-target] [--dry-run]");
      process.exit(0);
    } else {
      fail(`Unknown argument: ${value}`);
    }
  }
  return parsed;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
