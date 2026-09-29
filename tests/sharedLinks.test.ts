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
      expect(() => api.reorderSharedLinks(userId, { ids: [link.id] })).toThrow("Forbidden");
    }
    expect(api.listSharedLinks("alice")).toHaveLength(1);
  });

  it("saves plain website addresses and preserves explicitly entered HTTP links", async () => {
    const api = await members();
    for (const [url, expected] of [
      [" example.test/docs?view=all#details ", "https://example.test/docs?view=all#details"],
      ["www.example.test", "https://www.example.test/"],
      ["//example.test/docs", "https://example.test/docs"],
      ["example.test:8080/docs", "https://example.test:8080/docs"],
      ["localhost:8080/docs", "https://localhost:8080/docs"],
      ["http://intranet.test:8080/docs", "http://intranet.test:8080/docs"],
    ]) {
      const link = api.createSharedLink("alice", { title: "Resource", url });
      expect(link.url).toBe(expected);
      api.updateSharedLink("bob", link.id, { title: "Updated", url });
      expect(api.listSharedLinks("alice").find((item) => item.id === link.id)?.url).toBe(expected);
    }
  });

  it("rejects malformed input and unsafe URLs without changing stored links", async () => {
    const api = await members();
    const input = { title: "Resource", url: "https://example.test" };
    const link = api.createSharedLink("alice", input);
    for (const invalid of [null, [], 42, { ...input, title: " " }, { ...input, title: "x".repeat(201) }, { ...input, url: 42 }, { ...input, description: false }, { ...input, description: "x".repeat(1001) }, ...["javascript:alert(1)", "data:text/html,hello", "file:///tmp/file", "mailto:name@example.test", "https://name:password@example.test", "name@example.test", "/relative/path", "?query=value", "#fragment", "not a website", `https://example.test/${"x".repeat(2048)}`, `example.test/${"x".repeat(2029)}`].map((url) => ({ ...input, url }))]) {
      expect(() => api.createSharedLink("alice", invalid)).toThrow();
      expect(() => api.updateSharedLink("bob", link.id, invalid)).toThrow();
    }
    expect(api.listSharedLinks("bob")).toEqual([link]);
  });

  it("persists the shared order, retains positions on edit, and appends new links", async () => {
    const api = await members();
    const original = ["Zebra", "Alpha", "Middle"].map((title) => api.createSharedLink("alice", { title, url: "https://example.test" }));
    expect(api.listSharedLinks("bob")).toEqual(original);
    const reordered = [original[2], original[0], original[1]];
    expect(api.reorderSharedLinks("bob", { ids: reordered.map((link) => link.id) })).toEqual(reordered);
    vi.resetModules();
    const reloaded = await import("../src/lib/sharedLinks");
    expect(reloaded.listSharedLinks("alice")).toEqual(reordered);
    const edited = reloaded.updateSharedLink("alice", original[0].id, { ...original[0], title: "AAA" });
    const appended = reloaded.createSharedLink("bob", { title: "AAA new", url: "https://example.test/new" });
    expect(reloaded.listSharedLinks("alice")).toEqual([original[2], edited, original[1], appended]);
    reloaded.deleteSharedLink("alice", original[1].id);
    expect(reloaded.listSharedLinks("bob")).toEqual([original[2], edited, appended]);
  });

  it("rejects invalid and stale orders atomically, including concurrent additions and deletions", async () => {
    const api = await members();
    const original = ["Alpha", "Beta", "Gamma"].map((title) => api.createSharedLink("alice", { title, url: "https://example.test" }));
    const ids = original.map((link) => link.id);
    for (const invalid of [null, [], {}, { ids: [] }, { ids: "abc" }, { ids: [42] }, { ids: [ids[0], ids[0], ids[1]] }]) {
      expect(() => api.reorderSharedLinks("bob", invalid)).toThrow(/exactly once/);
      expect(api.listSharedLinks("alice")).toEqual(original);
    }
    for (const staleIds of [[ids[1], ids[0]], [ids[2], ids[1], "missing' id"], [...ids, "missing"]]) {
      expect(() => api.reorderSharedLinks("bob", { ids: staleIds })).toThrow(expect.objectContaining({ status: 409 }));
      expect(api.listSharedLinks("alice")).toEqual(original);
    }
    const added = api.createSharedLink("alice", { title: "New", url: "https://example.test" });
    expect(() => api.reorderSharedLinks("bob", { ids: [...ids].reverse() })).toThrow(expect.objectContaining({ status: 409 }));
    expect(api.listSharedLinks("alice")).toEqual([...original, added]);
    api.deleteSharedLink("alice", added.id);
    api.deleteSharedLink("alice", ids[1]);
    expect(() => api.reorderSharedLinks("bob", { ids: [...ids].reverse() })).toThrow(expect.objectContaining({ status: 409 }));
    expect(api.listSharedLinks("alice")).toEqual([original[0], original[2]]);
  });

  it("upgrades existing links without changing their alphabetical order", async () => {
    const { execSql } = await import("../src/lib/sqlite");
    execSql(`CREATE TABLE shared_links (id TEXT PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL, description TEXT NOT NULL DEFAULT '');
      INSERT INTO shared_links (id, title, url) VALUES ('z', 'Zebra', 'https://example.test'), ('a', 'Alpha', 'https://example.test');`);
    const api = await members();
    expect(api.listSharedLinks("alice").map((link) => link.id)).toEqual(["a", "z"]);
    api.updateSharedLink("alice", "a", { title: "ZZZ renamed", url: "https://example.test" });
    expect(api.listSharedLinks("bob").map((link) => link.id)).toEqual(["a", "z"]);
    api.reorderSharedLinks("alice", { ids: ["z", "a"] });
    vi.resetModules();
    const reloaded = await import("../src/lib/sharedLinks");
    expect(reloaded.listSharedLinks("bob").map((link) => link.id)).toEqual(["z", "a"]);
  });
});
