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
const postgres = process.env.NOVO_AUTHOR_TAG_TEST_POSTGRES === "1";
if (postgres) vi.setConfig({ testTimeout: 15000 });
let tempDir: string;
let databaseName: string;
let sequence = 0;

beforeEach(() => {
  vi.resetModules();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "novo-author-tags-"));
  vi.stubEnv("ELN_DATA_DIR", path.join(tempDir, "data"));
  vi.stubEnv("ELN_UPLOAD_DIR", path.join(tempDir, "uploads"));
  vi.stubEnv("ELN_DATABASE_PATH", path.join(tempDir, "data", "test.sqlite3"));
  vi.stubEnv("ELN_DATABASE_CLIENT", postgres ? "postgres" : "sqlite");
  if (postgres) {
    // Dedicated disposable Postgres fixture; never use the app's database.
    databaseName = `author_tags_${randomUUID().replaceAll("-", "")}`;
    execFileSync("psql", ["postgresql://postgres@127.0.0.1:55439/postgres", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", `CREATE DATABASE ${databaseName}`]);
    vi.stubEnv("DATABASE_URL", `postgresql://postgres@127.0.0.1:55439/${databaseName}`);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (postgres && databaseName) execFileSync("psql", ["postgresql://postgres@127.0.0.1:55439/postgres", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", `DROP DATABASE ${databaseName} WITH (FORCE)`]);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function create(firstName: string, lastName = "", role: "admin" | "member" = "member") {
  const api = await import("../src/lib/store");
  return api.createUser({ firstName, lastName, role, email: `person${sequence++}@example.test`, password: "Author-password-2026!" });
}

async function pageTags(pageId: string) {
  const { querySql, sql } = await import("../src/lib/sqlite");
  return querySql(`SELECT t.label FROM tags t JOIN page_tags pt ON pt.tag_id = t.id WHERE pt.page_id = ${sql(pageId)} ORDER BY t.label`).map(row => row.label);
}

describe(`author tags (${postgres ? "Postgres" : "SQLite"})`, () => {
  it("uses progressively longer last-name prefixes, numbers, and names without surnames", async () => {
    const { authorTagCandidates, normalizeAuthorTag } = await import("../src/lib/authorTags");
    const names = authorTagCandidates("Anne", "Lee");
    expect(Array.from({ length: 6 }, () => names.next().value)).toEqual(["Anne", "Anne-L", "Anne-Le", "Anne-Lee", "Anne-Lee-2", "Anne-Lee-3"]);
    const noSurname = authorTagCandidates("Slim", "");
    expect(Array.from({ length: 3 }, () => noSurname.next().value)).toEqual(["Slim", "Slim-2", "Slim-3"]);
    const unicode = authorTagCandidates("李", "美玲");
    expect(Array.from({ length: 4 }, () => unicode.next().value)).toEqual(["李", "李-美", "李-美玲", "李-美玲-2"]);
    expect(normalizeAuthorTag("  Anne   H  ")).toBe("Anne H");
    expect(() => normalizeAuthorTag(" ")).toThrow(/required/);
    expect(() => normalizeAuthorTag("a".repeat(81))).toThrow(/80/);
  });

  it("allocates unique tags against existing tags and inactive users without changing earlier labels", async () => {
    const api = await import("../src/lib/store");
    api.ensureDatabase();
    const { execSql } = await import("../src/lib/sqlite");
    execSql("INSERT INTO tags (id,label) VALUES ('existing','ANNE');");
    const people = [];
    for (let i = 0; i < 4; i += 1) people.push(await create("Anne", "Li"));
    expect(people.map(person => person.authorTag)).toEqual(["Anne-L", "Anne-Li", "Anne-Li-2", "Anne-Li-3"]);
    const first = await create("Slim");
    expect((await create("slim")).authorTag).toBe("slim-2");
    const admin = await create("Admin", "", "admin");
    api.adminSetUserActive(admin.id, first.id, false);
    expect((await create("Slim")).authorTag).toBe("Slim-3");
    expect(api.findUserById(people[0].id)?.authorTag).toBe("Anne-L");
  });

  it("reuses a manually mapped existing tag and preserves its historical note associations", async () => {
    const api = await import("../src/lib/store");
    const { execSql, sql, queryOne } = await import("../src/lib/sqlite");
    api.ensureDatabase();
    execSql("INSERT INTO users (id,email,first_name,last_name,password_hash) VALUES ('anne','anne@example.test','Anne','Hakim','unused'); INSERT INTO tags (id,label) VALUES ('anne-h','Anne-H');");
    const notebook = api.createNotebook("anne");
    api.setPageTags("anne", notebook.pageId, ["Anne-H"]);
    execSql("INSERT INTO user_author_tags (user_id,tag_id,label_key) VALUES ('anne','anne-h','anne-h');");
    expect(api.findUserById("anne")?.authorTag).toBe("Anne-H");
    expect(await pageTags(notebook.pageId)).toEqual(["Anne-H"]);
    expect(queryOne(`SELECT tag_id FROM page_tags WHERE page_id = ${sql(notebook.pageId)}`)?.tag_id).toBe("anne-h");
  });

  it("adds tags only to newly authored notes when enabled, including both kinds of starter note", async () => {
    const api = await import("../src/lib/store");
    const admin = await create("Andrew", "Boylan", "admin");
    const workspace = api.getWorkspace(admin.id);
    const notebookId = workspace.notebooks[0].id;
    const oldPage = workspace.notebooks[0].pages[0].id;
    expect(api.getAdminAppSettings(admin.id).addAuthorTagToNewPages).toBe(false);
    expect(await pageTags(oldPage)).toEqual([]);
    api.updateAdminAppSettings(admin.id, { addAuthorTagToNewPages: true });
    const pageId = api.createPage(admin.id, notebookId);
    expect(await pageTags(pageId)).toEqual(["Andrew"]);
    expect(await pageTags(api.createNotebook(admin.id).pageId)).toEqual(["Andrew"]);
    const member = await create("Anne", "Hakim");
    expect(await pageTags(api.getWorkspace(member.id).notebooks[0].pages[0].id)).toEqual(["Anne"]);
    expect(await pageTags(oldPage)).toEqual([]);
    const imported = api.createImportedPage({ userId: admin.id, notebookId, title: "Imported", body: "", tags: ["Historical"] });
    expect(await pageTags(imported)).toEqual(["Historical"]);
    expect(await pageTags(api.duplicatePage(admin.id, imported).pageId)).toEqual(["Historical"]);
    api.setPageTags(admin.id, pageId, []);
    api.updatePage(admin.id, pageId, { title: "Edited" });
    expect(await pageTags(pageId)).toEqual([]);
    api.updateAdminAppSettings(admin.id, { addAuthorTagToNewPages: false });
    expect(await pageTags(api.createPage(admin.id, notebookId))).toEqual([]);
  });

  it("renames the stable tag through Profile, checks uniqueness atomically, and keeps it through profile name changes", async () => {
    const api = await import("../src/lib/store");
    const { getAuthorTag } = await import("../src/lib/authorTags");
    const admin = await create("Andrew", "", "admin");
    api.updateAdminAppSettings(admin.id, { addAuthorTagToNewPages: true });
    const anne = await create("Anne", "Hakim");
    const oldId = getAuthorTag(anne.id)?.id;
    const pageId = api.getWorkspace(anne.id).notebooks[0].pages[0].id;
    api.updateOwnProfile(anne.id, { firstName: "Anne", lastName: "Hakim", authorTag: " Anne-H " });
    expect(getAuthorTag(anne.id)?.id).toBe(oldId);
    expect(await pageTags(pageId)).toEqual(["Anne-H"]);
    expect(() => api.updateOwnProfile(anne.id, { firstName: "Changed", authorTag: " ANDREW " })).toThrow(/already exists/);
    expect(api.findUserById(anne.id)?.firstName).toBe("Anne");
    api.updateOwnProfile(anne.id, { firstName: "Annie", lastName: "Hakim" });
    expect(api.findUserById(anne.id)?.authorTag).toBe("Anne-H");
    expect(() => api.updateAdminAppSettings(anne.id, { addAuthorTagToNewPages: false })).toThrow("Forbidden");
    expect(() => api.updateOwnProfile("missing", { firstName: "Nobody", authorTag: "Nobody" })).toThrow("Forbidden");
  });

  it("reserves unused author tags and keeps admin rename/merge operations consistent", async () => {
    const api = await import("../src/lib/store");
    const { getAuthorTag } = await import("../src/lib/authorTags");
    const admin = await create("Andrew", "", "admin");
    const anne = await create("Anne", "Hakim");
    const tagId = getAuthorTag(anne.id)!.id;
    expect(api.listTagsForAdmin(admin.id).some(tag => tag.id === tagId)).toBe(true);
    expect(() => api.deleteTagForAdmin(admin.id, tagId)).toThrow(/author tag/);
    expect(() => api.mergeTagForAdmin(admin.id, tagId, getAuthorTag(admin.id)!.id)).toThrow(/different users/);
    api.renameTagForAdmin(admin.id, tagId, "Anne-H");
    expect(api.findUserById(anne.id)?.authorTag).toBe("Anne-H");
    const page = api.getWorkspace(anne.id).notebooks[0].pages[0];
    api.setPageTags(anne.id, page.id, ["Anne-H", "Annie"]);
    const target = api.listTagsForAdmin(admin.id).find(tag => tag.label === "Annie")!;
    api.mergeTagForAdmin(admin.id, tagId, target.id);
    expect(getAuthorTag(anne.id)?.id).toBe(target.id);
    expect(api.findUserById(anne.id)?.authorTag).toBe("Annie");
    expect(await pageTags(page.id)).toEqual(["Annie"]);
    api.deletePage(anne.id, page.id);
    expect(api.listTagsForAdmin(admin.id).some(tag => tag.id === target.id)).toBe(true);
  });

  it("retries a tag allocation collision without leaving partial accounts or starter notes", async () => {
    const api = await import("../src/lib/store");
    const authorTags = await import("../src/lib/authorTags");
    const { execSql, queryOne } = await import("../src/lib/sqlite");
    api.ensureDatabase();
    execSql("INSERT INTO tags (id,label) VALUES ('existing','Busy');");
    vi.spyOn(authorTags, "newAuthorTag").mockReturnValueOnce({ id: randomUUID(), label: "Busy" });
    const user = await create("Anne", "Hakim");
    expect(user.authorTag).toBe("Anne");
    expect(queryOne("SELECT COUNT(*) AS count FROM users")?.count).toBe("1");
    expect(queryOne("SELECT COUNT(*) AS count FROM pages")?.count).toBe("1");
    expect(queryOne("SELECT COUNT(*) AS count FROM user_author_tags")?.count).toBe("1");
  });
});
