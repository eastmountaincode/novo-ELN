import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/search", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/lib/search")>(),
  scheduleSearchIndexDrain: vi.fn(),
}));

let tempDir: string;

describe("shared group links", () => {
  beforeEach(() => {
    vi.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "novo-links-test-"));
    vi.stubEnv("ELN_DATABASE_CLIENT", "sqlite");
    vi.stubEnv("ELN_DATA_DIR", path.join(tempDir, "data"));
    vi.stubEnv("ELN_UPLOAD_DIR", path.join(tempDir, "uploads"));
    vi.stubEnv("ELN_DATABASE_PATH", path.join(tempDir, "data", "test.sqlite3"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  async function members() {
    const { ensureDatabase } = await import("../src/lib/store");
    const { execSql } = await import("../src/lib/sqlite");
    ensureDatabase();
    execSql(`INSERT INTO users (id, email, first_name, password_hash, role, is_active) VALUES
      ('alice', 'alice@example.test', 'Alice', 'unused', 'member', 1),
      ('bob', 'bob@example.test', 'Bob', 'unused', 'member', 1),
      ('inactive', 'inactive@example.test', 'Inactive', 'unused', 'member', 0);`);
    return import("../src/lib/sharedLinks");
  }

  it("allows another ordinary member to read, edit, and delete a persisted link", async () => {
    const { createSharedLink, listSharedLinks, updateSharedLink, deleteSharedLink } = await members();
    const original = createSharedLink("alice", { title: " Lab's resource ", url: " https://example.test ", description: " Shared documentation " });
    expect(listSharedLinks("bob")).toEqual([{ ...original, title: "Lab's resource", url: "https://example.test/", description: "Shared documentation" }]);
    updateSharedLink("bob", original.id, { title: "Updated resource", url: "http://intranet.test/docs", description: "" });
    vi.resetModules();
    const reloaded = await import("../src/lib/sharedLinks");
    expect(reloaded.listSharedLinks("alice")).toEqual([{ id: original.id, title: "Updated resource", url: "http://intranet.test/docs", description: "" }]);
    deleteSharedLink("alice", original.id);
    expect(reloaded.listSharedLinks("bob")).toEqual([]);
    expect(() => updateSharedLink("bob", original.id, { title: "Missing", url: "https://example.test" })).toThrow(/no longer exists/);
    expect(() => deleteSharedLink("bob", original.id)).toThrow(/no longer exists/);
  });

  it("denies missing and deactivated users access to every operation", async () => {
    const api = await members();
    const input = { title: "Resource", url: "https://example.test" };
    const link = api.createSharedLink("alice", input);
    for (const userId of ["unknown", "inactive"]) {
      expect(() => api.listSharedLinks(userId)).toThrow("Forbidden");
      expect(() => api.createSharedLink(userId, input)).toThrow("Forbidden");
      expect(() => api.updateSharedLink(userId, link.id, input)).toThrow("Forbidden");
      expect(() => api.deleteSharedLink(userId, link.id)).toThrow("Forbidden");
    }
    expect(api.listSharedLinks("alice")).toHaveLength(1);
  });

  it("rejects malformed input and unsafe URLs without changing stored links", async () => {
    const api = await members();
    const input = { title: "Resource", url: "https://example.test" };
    const link = api.createSharedLink("alice", input);
    for (const invalid of [null, [], 42, { ...input, title: " " }, { ...input, title: "x".repeat(201) }, { ...input, url: 42 }, { ...input, description: false }, { ...input, description: "x".repeat(1001) }, ...["javascript:alert(1)", "data:text/html,hello", "file:///tmp/file", "https://name:password@example.test", "example.test", `https://example.test/${"x".repeat(2048)}`].map((url) => ({ ...input, url }))]) {
      expect(() => api.createSharedLink("alice", invalid)).toThrow();
      expect(() => api.updateSharedLink("bob", link.id, invalid)).toThrow();
    }
    expect(api.listSharedLinks("bob")).toEqual([link]);
  });
});
