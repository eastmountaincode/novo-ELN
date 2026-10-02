import { execFileSync } from "node:child_process";
import { ensureRuntimeDirs, databasePath } from "./paths";

const defaultSqliteMaxBufferBytes = 256 * 1024 * 1024;
const defaultPostgresMaxBufferBytes = 256 * 1024 * 1024;

export type DatabaseClient = "sqlite" | "postgres";

function sqliteMaxBufferBytes() {
  const configured = Number.parseInt(process.env.ELN_SQLITE_MAX_BUFFER_BYTES || "", 10);
  return Number.isFinite(configured) && configured > 0 ? configured : defaultSqliteMaxBufferBytes;
}

function postgresMaxBufferBytes() {
  const configured = Number.parseInt(process.env.ELN_POSTGRES_MAX_BUFFER_BYTES || "", 10);
  return Number.isFinite(configured) && configured > 0 ? configured : defaultPostgresMaxBufferBytes;
}

export function databaseClient(): DatabaseClient {
  const configured = (process.env.ELN_DATABASE_CLIENT ?? "").trim().toLowerCase();
  if (configured === "postgres" || configured === "postgresql") return "postgres";
  if (configured === "sqlite") return "sqlite";
  return process.env.DATABASE_URL ? "postgres" : "sqlite";
}

export function isPostgresDatabase() {
  return databaseClient() === "postgres";
}

export function databaseDisplayName() {
  if (!isPostgresDatabase()) return databasePath;
  const url = process.env.DATABASE_URL;
  if (!url) return "postgres";
  try {
    const parsed = new URL(url);
    return `postgres://${parsed.host}${parsed.pathname}`;
  } catch {
    return "postgres";
  }
}

export type SqlRow = Record<string, string>;
export type SqlParameter = string | number;

export function sql(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}

export function nowSql() {
  return isPostgresDatabase() ? "novo_now_text()" : "datetime('now')";
}

export function execSql(statement: string, parameters?: readonly SqlParameter[]) {
  ensureRuntimeDirs();
  if (isPostgresDatabase()) {
    execPostgresSql(statement, parameters);
    return;
  }
  execFileSync("sqlite3", ["-batch", databasePath], {
    input: `.timeout 30000\n.bail on\nPRAGMA foreign_keys=ON;\n${sqliteParameterBindings(parameters)}${statement}`,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: sqliteMaxBufferBytes(),
  });
}

export function querySql(statement: string, parameters?: readonly SqlParameter[]): SqlRow[] {
  ensureRuntimeDirs();
  if (isPostgresDatabase()) {
    return parseCsv(queryPostgresSql(statement, parameters));
  }
  const output = execFileSync("sqlite3", ["-batch", databasePath], {
    input: `.timeout 30000\n.bail on\n.headers on\n.mode csv\nPRAGMA foreign_keys=ON;\n${sqliteParameterBindings(parameters)}${statement}`,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: sqliteMaxBufferBytes(),
  });
  return parseCsv(output);
}

export function queryOne(statement: string, parameters?: readonly SqlParameter[]): SqlRow | null {
  return querySql(statement, parameters)[0] ?? null;
}

export function insertAndReturnId(statement: string) {
  if (isPostgresDatabase()) {
    const row = queryOne(`${statement} RETURNING id;`);
    return row?.id ?? "";
  }
  const row = queryOne(`${statement};\nSELECT last_insert_rowid() AS id;`);
  return row?.id ?? "";
}

function postgresUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required when ELN_DATABASE_CLIENT=postgres.");
  return url;
}

function execPostgresSql(statement: string, parameters?: readonly SqlParameter[]) {
  execFileSync("psql", [postgresUrl(), "-X", "-q", "-v", "ON_ERROR_STOP=1"], {
    input: postgresQueryInput(statement, parameters),
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: postgresMaxBufferBytes(),
  });
}

function queryPostgresSql(statement: string, parameters?: readonly SqlParameter[]) {
  return execFileSync("psql", [postgresUrl(), "-X", "-q", "-v", "ON_ERROR_STOP=1", "--csv", "-P", "footer=off"], {
    input: postgresQueryInput(statement, parameters),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: postgresMaxBufferBytes(),
  });
}

function validateSqlParameter(value: SqlParameter) {
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value === "string" && !value.includes("\0")) return;
  throw new Error("SQL parameters must be finite numbers or text without null bytes.");
}

function sqliteParameterBindings(parameters?: readonly SqlParameter[]) {
  if (!parameters) return "";
  // Hex encodes text for the CLI transport; SQLite binds the decoded value to $N.
  // Never pass user text directly to .parameter, which can evaluate SQL expressions.
  return ".parameter init\n" + parameters.map((value, index) => {
    validateSqlParameter(value);
    const literal = typeof value === "number" ? String(value) : `"CAST(X'${Buffer.from(value, "utf8").toString("hex")}' AS TEXT)"`;
    return `.parameter set $${index + 1} ${literal}\n`;
  }).join("");
}

function postgresQueryInput(statement: string, parameters?: readonly SqlParameter[]) {
  const query = postgresCompatibleSql(statement);
  if (!parameters) return query;
  // psql 16+ \bind uses PostgreSQL's extended query protocol, not SQL interpolation.
  // Encode every UTF-8 byte as a CLI octal escape so quotes, newlines, backticks,
  // variable references and backslash commands in a value cannot become CLI syntax.
  const bindings = parameters.map((value) => {
    validateSqlParameter(value);
    const encoded = Array.from(Buffer.from(String(value), "utf8"), (byte) => `\\${byte.toString(8).padStart(3, "0")}`).join("");
    return `'${encoded}'`;
  }).join(" ");
  return `${query.trim().replace(/;$/, "")}\n\\bind ${bindings}\n\\g\n`;
}

function postgresCompatibleSql(statement: string) {
  return statement
    .replace(/^\s*PRAGMA\s+[^;]+;\s*$/gim, "")
    .replace(/\bBEGIN\s+IMMEDIATE\b/gi, "BEGIN")
    .replace(/strftime\('%s',\s*'now'\)/gi, "(extract(epoch from clock_timestamp())::bigint)")
    .replace(/datetime\('now',\s*'-(\d+)\s+seconds?'\)/gi, (_match, seconds) => `novo_datetime_text(novo_now_text(-${Number(seconds)}))`)
    .replace(/datetime\('now',\s*'-(\d+)\s+minutes?'\)/gi, (_match, minutes) => `novo_datetime_text(novo_now_text(-${Number(minutes) * 60}))`)
    .replace(/datetime\('now'\)/gi, "novo_now_text()")
    .replace(/datetime\(([^()]+)\)/gi, "novo_datetime_text($1)")
    .replace(/\binstr\(/gi, "strpos(")
    .replace(/ESCAPE\s+'\\\\'/gi, "ESCAPE E'\\\\'")
    .replace(/\s+COLLATE\s+BINARY\b/gi, "")
    .replace(/([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*([^;\n]+?)\s+COLLATE\s+NOCASE/gi, "lower($1) = lower($2)")
    .replace(/([A-Za-z_][A-Za-z0-9_.]*)\s+COLLATE\s+NOCASE/gi, "lower($1)");
}

function parseCsv(input: string): SqlRow[] {
  const clean = input.endsWith("\n") ? input.slice(0, -1) : input;
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
