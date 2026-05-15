import { execFileSync } from "node:child_process";
import { ensureRuntimeDirs, databasePath } from "./paths";

export type SqlRow = Record<string, string>;

export function sql(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}

export function nowSql() {
  return "datetime('now')";
}

export function execSql(statement: string) {
  ensureRuntimeDirs();
  execFileSync("sqlite3", [databasePath, "-batch"], {
    input: `.timeout 30000\nPRAGMA foreign_keys=ON;\n${statement}`,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

export function querySql(statement: string): SqlRow[] {
  ensureRuntimeDirs();
  const output = execFileSync("sqlite3", [databasePath, "-batch", "-header", "-csv"], {
    input: `.timeout 30000\nPRAGMA foreign_keys=ON;\n${statement}`,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return parseCsv(output);
}

export function queryOne(statement: string): SqlRow | null {
  return querySql(statement)[0] ?? null;
}

export function insertAndReturnId(statement: string) {
  const row = queryOne(`${statement};\nSELECT last_insert_rowid() AS id;`);
  return row?.id ?? "";
}

function parseCsv(input: string): SqlRow[] {
  const clean = input.trimEnd();
  if (!clean) return [];
  const rows = parseCsvRows(clean);
  const [headers, ...dataRows] = rows;
  return dataRows.map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])),
  );
}

function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
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
