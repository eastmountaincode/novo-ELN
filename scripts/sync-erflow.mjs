#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const args = parseArgs(process.argv.slice(2));
const databasePath = args.db ?? process.env.ELN_DATABASE_PATH ?? path.join(cwd, "data", "eln.sqlite3");
const endpoint = normalizeEndpoint(args.endpoint ?? args.modelUrl ?? args.uuid ?? process.env.ELN_ERFLOW_MODEL ?? "");
const dryRun = Boolean(args.dryRun);
const replace = Boolean(args.replace);

const appTables = [
  "users",
  "login_attempts",
  "notebooks",
  "notebook_members",
  "pages",
  "page_tags",
  "attachments",
  "audit_events",
];

const defaultPositions = {
  users: { x: 80, y: 80 },
  login_attempts: { x: 80, y: 520 },
  notebooks: { x: 560, y: 80 },
  notebook_members: { x: 560, y: 440 },
  pages: { x: 1040, y: 80 },
  page_tags: { x: 1040, y: 620 },
  attachments: { x: 1520, y: 80 },
  audit_events: { x: 1520, y: 520 },
};

if (!endpoint) fail("Pass --model-url, --uuid, --endpoint, or ELN_ERFLOW_MODEL.");
if (!fs.existsSync(databasePath)) fail(`Database not found: ${databasePath}`);

const activeDiagram = await getActiveDiagram();
const existingTables = await listExistingTables();
if (existingTables.length && !replace) {
  fail(`ER Flow model already has ${existingTables.length} table(s). Re-run with --replace to delete and rebuild them.`);
}

const schema = readSchema();
const operations = [];
if (replace) {
  for (const table of existingTables) operations.push({ op: "delete-table", tableId: table.id });
}
operations.push(...buildCreateTableOperations(schema, activeDiagram.id));
operations.push(...buildForeignKeyOperations(schema));

const result = await callTool("batch-operations", { dryRun, operations });
console.log(result);

async function getActiveDiagram() {
  const result = parseToolJson(await callTool("list-diagrams", {}));
  const diagrams = Array.isArray(result) ? result : result.diagrams;
  const diagram = diagrams?.find((item) => item.active) ?? diagrams?.[0];
  if (!diagram?.id) fail("ER Flow model has no active diagram.");
  return diagram;
}

async function listExistingTables() {
  const result = parseToolJson(await callTool("list-tables", {}));
  const tables = Array.isArray(result) ? result : result.tables;
  return tables ?? [];
}

function readSchema() {
  return appTables.map((tableName) => {
    const columns = querySql(`PRAGMA table_info(${quoteIdentifier(tableName)});`).map((column) => ({
      id: columnId(tableName, column.name),
      name: column.name,
      type: normalizeType(column.type),
      nullable: column.notnull !== "1" && column.pk === "0",
      isPrimaryKey: column.pk !== "0",
    }));

    const foreignKeys = querySql(`PRAGMA foreign_key_list(${quoteIdentifier(tableName)});`).map((fk) => ({
      id: fk.id,
      sequence: fk.seq,
      tableId: tableId(tableName),
      fkId: foreignKeyId(tableName, fk.from, fk.table, fk.to || "id"),
      name: foreignKeyName(tableName, fk.from, fk.table, fk.to || "id"),
      columnIds: [columnId(tableName, fk.from)],
      referencedTableId: tableId(fk.table),
      referencedColumnIds: [columnId(fk.table, fk.to || "id")],
      onDelete: fk.on_delete,
      onUpdate: fk.on_update,
    }));

    return {
      name: tableName,
      tableId: tableId(tableName),
      columns,
      foreignKeys,
      position: defaultPositions[tableName] ?? { x: 80, y: 80 },
    };
  });
}

function buildCreateTableOperations(schema, diagramId) {
  return schema.map((table) => ({
    op: "create-table",
    tableId: table.tableId,
    name: table.name,
    kind: "table",
    diagramId,
    position: table.position,
    columns: table.columns,
  }));
}

function buildForeignKeyOperations(schema) {
  return schema.flatMap((table) =>
    table.foreignKeys.map((fk) => ({
      op: "create-foreign-key",
      tableId: fk.tableId,
      fkId: fk.fkId,
      data: {
        name: fk.name,
        columnIds: fk.columnIds,
        referencedTableId: fk.referencedTableId,
        referencedColumnIds: fk.referencedColumnIds,
        onDelete: fk.onDelete,
        onUpdate: fk.onUpdate,
      },
    })),
  );
}

async function callTool(name, toolArguments) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: {
        name,
        arguments: toolArguments,
      },
    }),
  });

  const body = await response.json();
  if (!response.ok || body.error) {
    throw new Error(body.error?.message ?? `ER Flow MCP request failed with ${response.status}`);
  }
  const text = body.result?.content?.find((item) => item.type === "text")?.text ?? "";
  if (body.result?.isError) throw new Error(text || `ER Flow tool ${name} failed.`);
  return text;
}

function parseToolJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`ER Flow returned non-JSON tool output: ${text.slice(0, 200)}`);
  }
}

function querySql(statement) {
  const output = execFileSync("sqlite3", [databasePath, "-batch", "-header", "-csv"], {
    input: `.timeout 30000\nPRAGMA foreign_keys=ON;\n${statement}`,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return parseCsv(output);
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

function normalizeEndpoint(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (/^https:\/\/app\.erflow\.io\/mcp\/data-model\/[a-f0-9-]+$/i.test(trimmed)) return trimmed;
  const uuid = trimmed.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i)?.[0];
  if (!uuid) fail(`Could not find an ER Flow model UUID in: ${trimmed}`);
  return `https://app.erflow.io/mcp/data-model/${uuid}`;
}

function normalizeType(type) {
  const upper = String(type || "TEXT").trim().toUpperCase();
  if (upper.includes("INT")) return "INTEGER";
  if (upper.includes("REAL") || upper.includes("FLOA") || upper.includes("DOUB")) return "REAL";
  if (upper.includes("BLOB")) return "BLOB";
  if (upper.includes("NUM")) return "NUMERIC";
  return "TEXT";
}

function tableId(name) {
  return `tbl_${slug(name)}`;
}

function columnId(tableName, columnName) {
  return `col_${slug(tableName)}_${slug(columnName)}`;
}

function foreignKeyId(tableName, columnName, referencedTable, referencedColumn) {
  return `fk_${slug(tableName)}_${slug(columnName)}_${slug(referencedTable)}_${slug(referencedColumn)}`;
}

function foreignKeyName(tableName, columnName, referencedTable, referencedColumn) {
  return `${tableName}_${columnName}_${referencedTable}_${referencedColumn}_fk`;
}

function slug(value) {
  return String(value).replace(/[^a-zA-Z0-9_]/g, "_");
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--db") parsed.db = values[++index];
    else if (value === "--model-url") parsed.modelUrl = values[++index];
    else if (value === "--endpoint") parsed.endpoint = values[++index];
    else if (value === "--uuid") parsed.uuid = values[++index];
    else if (value === "--dry-run") parsed.dryRun = true;
    else if (value === "--replace") parsed.replace = true;
    else if (value === "--help" || value === "-h") {
      console.log("Usage: npm run sync:erflow -- --model-url https://app.erflow.io/workspace/.../models/<uuid> [--dry-run] [--replace]");
      process.exit(0);
    }
  }
  return parsed;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
