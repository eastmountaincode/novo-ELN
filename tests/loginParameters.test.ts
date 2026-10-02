import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/search", () => ({
  deleteSearchIndexForNotebook: vi.fn(), deleteSearchIndexForPage: vi.fn(),
  queueSearchIndexForNotebook: vi.fn(), queueSearchIndexForPage: vi.fn(),
  queueSearchIndexForPages: vi.fn(), rebuildSearchIndex: vi.fn(), scheduleSearchIndexDrain: vi.fn(),
}));

const postgresAdminUrl = process.env.NOVO_LOGIN_TEST_POSTGRES_ADMIN_URL;
if (postgresAdminUrl && new URL(postgresAdminUrl).hostname !== "novo-login-parameters-postgres") {
  throw new Error("Login tests require the dedicated novo-login-parameters-postgres fixture, not an application database.");
}
let tempDir: string;
let fixtureDatabase: string;

beforeEach(() => {
  vi.resetModules();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "novo-login-parameters-"));
  vi.stubEnv("ELN_DATA_DIR", path.join(tempDir, "data"));
  vi.stubEnv("ELN_UPLOAD_DIR", path.join(tempDir, "uploads"));
  vi.stubEnv("ELN_PREVIEW_DIR", path.join(tempDir, "previews"));
  vi.stubEnv("ELN_PROOF_DIR", path.join(tempDir, "proofs"));
  vi.stubEnv("ELN_DATABASE_PATH", path.join(tempDir, "data", "test.sqlite3"));
  vi.stubEnv("ELN_DATABASE_CLIENT", postgresAdminUrl ? "postgres" : "sqlite");
  if (postgresAdminUrl) {
    fixtureDatabase = `novo_login_parameters_${randomUUID().replaceAll("-", "")}`;
    execFileSync("psql", [postgresAdminUrl, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", `CREATE DATABASE ${fixtureDatabase}`]);
    const url = new URL(postgresAdminUrl);
    url.pathname = `/${fixtureDatabase}`;
    vi.stubEnv("DATABASE_URL", url.toString());
  } else {
    vi.stubEnv("DATABASE_URL", "");
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (postgresAdminUrl && fixtureDatabase) {
    execFileSync("psql", [postgresAdminUrl, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", `DROP DATABASE ${fixtureDatabase} WITH (FORCE)`]);
  }
  // Only remove this test's known files and empty directories; no recursive cleanup.
  const databaseFile = path.join(tempDir, "data", "test.sqlite3");
  if (fs.existsSync(databaseFile)) fs.unlinkSync(databaseFile);
  for (const directory of ["previews", "proofs", "uploads", "data"]) {
    const target = path.join(tempDir, directory);
    if (fs.existsSync(target)) fs.rmdirSync(target);
  }
  fs.rmdirSync(tempDir);
});

describe.sequential(`login parameters (${postgresAdminUrl ? "Postgres" : "SQLite"})`, () => {
  it("round-trips literal text including SQL and CLI-looking input", async () => {
    const { queryOne } = await import("../src/lib/sqlite");
    for (const value of ["", "o'brien@example.test", "') OR 1=1 --", "\\! touch /tmp/not-executed\n\\q", "`uname` :variable \\g", "datetime('now')", "αβ 李 🧪\t\r\nquoted \"text\"", "\\000", "123", "-1e2"]) {
      expect(queryOne("SELECT $1 AS value", [value])).toEqual({ value });
    }
    expect(queryOne("SELECT $1 AS value, $2 AS other", ["literal", 42])).toEqual({ value: "literal", other: "42" });
    expect(queryOne("SELECT $1 AS value WHERE 1 = 0", ["unused"])).toBeNull();
    expect(queryOne("SELECT '' AS value")).toEqual({ value: "" });
  });

  it("binds writes and repeated placeholders without changing other rows", async () => {
    const { execSql, querySql } = await import("../src/lib/sqlite");
    execSql("CREATE TABLE parameter_fixture (id TEXT PRIMARY KEY, value TEXT, amount INTEGER)");
    execSql("INSERT INTO parameter_fixture VALUES ($1, $2, $3)", ["one", "unchanged", 1]);
    execSql("INSERT INTO parameter_fixture VALUES ($1, $2, $3)", ["two", "before", 2]);
    const value = "'); DELETE FROM parameter_fixture; --";
    execSql("UPDATE parameter_fixture SET value = $1, amount = $2 + $2 WHERE id = $3", [value, 3, "two"]);
    expect(querySql("SELECT * FROM parameter_fixture ORDER BY id")).toEqual([
      { id: "one", value: "unchanged", amount: "1" }, { id: "two", value, amount: "6" },
    ]);
  });

  it("rejects unsupported parameters rather than interpolating them", async () => {
    const { queryOne } = await import("../src/lib/sqlite");
    for (const value of [NaN, Infinity, null, undefined, {}, "null\0byte"]) {
      expect(() => queryOne("SELECT $1 AS value", [value as never])).toThrow(/SQL parameters/);
    }
  });

  it("keeps case-insensitive email lookup, password checks and active-user checks", async () => {
    const api = await import("../src/lib/store");
    const { execSql } = await import("../src/lib/sqlite");
    const password = "Login-fixture-password-2026!";
    const user = api.createUser({ email: "o'brien@example.test", firstName: "Fixture", password, role: "admin" });
    expect(api.verifyCredentials("O'BRIEN@example.test", password)?.id).toBe(user.id);
    expect(api.verifyCredentials(user.email, "Wrong-password")).toBeNull();
    expect(api.verifyCredentials("') OR 1=1 --", password)).toBeNull();
    expect(api.findUserById("' OR 1=1 --")).toBeNull();
    expect(api.verifyUserPassword(user.id, password)).toBe(true);
    api.recordUserLogin(user.id);
    execSql("UPDATE users SET is_active = 0 WHERE id = $1", [user.id]);
    expect(api.verifyCredentials(user.email, password)).toBeNull();
    expect(api.findUserById(user.id)).toBeNull();
    expect(api.verifyUserPassword(user.id, password)).toBe(false);
  }, 30000);

  it("preserves rate limiting, reset and window expiry for literal email/IP values", async () => {
    const api = await import("../src/lib/store");
    const email = "') OR 1=1 --";
    const ip = "'\\g `uname`";
    const now = Date.now();
    for (let index = 0; index < 10; index += 1) api.recordFailedLogin(email, ip, now);
    expect(api.getLoginRateLimit(email, ip, now).limited).toBe(true);
    expect(api.getLoginRateLimit("other@example.test", ip, now).limited).toBe(false);
    expect(api.getLoginRateLimit(email, "different-ip", now).limited).toBe(false);
    expect(api.getLoginRateLimit(email, ip, now + 16 * 60 * 1000).limited).toBe(false);
    api.clearFailedLogins(email, ip);
    expect(api.getLoginRateLimit(email, ip, now).limited).toBe(false);
  }, 30000);
});
