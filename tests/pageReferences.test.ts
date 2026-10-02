import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/search", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/lib/search")>(),
  scheduleSearchIndexDrain: vi.fn(),
}));

let tempDir: string;
describe("page reference suggestions", () => {
  beforeEach(async () => {
    vi.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "novo-references-"));
    vi.stubEnv("ELN_DATABASE_CLIENT", "sqlite");
    vi.stubEnv("ELN_DATA_DIR", path.join(tempDir, "data"));
    vi.stubEnv("ELN_UPLOAD_DIR", path.join(tempDir, "uploads"));
    vi.stubEnv("ELN_DATABASE_PATH", path.join(tempDir, "data", "test.sqlite3"));
    const { ensureDatabase } = await import("../src/lib/store");
    const { execSql } = await import("../src/lib/sqlite");
    ensureDatabase();
    execSql(`INSERT INTO users (id,email,first_name,password_hash,role,is_active) VALUES
      ('viewer','viewer@example.test','viewer','unused','member',1),
      ('owner','owner@example.test','owner','unused','member',1),
      ('admin','admin@example.test','admin','unused','admin',1),
      ('inactive','inactive@example.test','inactive','unused','admin',0);
      INSERT INTO notebooks (id,name,owner_id) VALUES ('shared','Shared notebook','owner'),('private','Private notebook','owner');
      INSERT INTO notebook_members (notebook_id,user_id,role) VALUES ('shared','viewer','viewer');
      INSERT INTO pages (id,notebook_id,title,owner_id,updated_at) VALUES
      ('older','shared','SortSeq-1','owner','2026-10-01 10:00:00.000'),
      ('newer','shared','sortseq-2','owner','2026-10-02 10:00:00.000'),
      ('hidden','private','SortSeq-private','owner','2026-10-02 11:00:00.000'),
      ('substring','shared','My SortSeq','owner','2026-10-02 12:00:00.000'),
      ('literal','shared','SortSeq_100%','owner','2026-10-02 10:00:00.500');`);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("shows only accessible prefix matches, ordered by update time, and excludes the current page", async () => {
    const { suggestPageReferences } = await import("../src/lib/pageReferences");
    expect(suggestPageReferences("viewer", "SORTSEQ").map(p => p.id)).toEqual(["literal", "newer", "older"]);
    expect(suggestPageReferences("viewer", "SortSeq", "newer").map(p => p.id)).toEqual(["literal", "older"]);
    expect(suggestPageReferences("viewer", "").map(p => p.id)).toEqual(["substring", "literal", "newer", "older"]);
    expect(suggestPageReferences("viewer", "SortSq")).toEqual([]);
    expect(suggestPageReferences("viewer", "SortSeq")[0].notebookName).toBe("Shared notebook");
  });

  it("treats punctuation literally instead of as SQL wildcards", async () => {
    const { suggestPageReferences } = await import("../src/lib/pageReferences");
    expect(suggestPageReferences("viewer", "SortSeq_100%").map(p => p.id)).toEqual(["literal"]);
    expect(suggestPageReferences("viewer", "SortSeq%" )).toEqual([]);
    expect(suggestPageReferences("viewer", "' OR 1=1 --")).toEqual([]);
  });

  it("reflects fresh renames, moves and revoked membership without reindexing", async () => {
    const { suggestPageReferences } = await import("../src/lib/pageReferences");
    const { execSql } = await import("../src/lib/sqlite");
    execSql("UPDATE pages SET title='Renamed', updated_at='2026-10-02 13:00:00' WHERE id='older';");
    expect(suggestPageReferences("viewer", "Renamed").map(p => p.id)).toEqual(["older"]);
    execSql("UPDATE pages SET notebook_id='private' WHERE id='older';");
    expect(suggestPageReferences("viewer", "Renamed")).toEqual([]);
    execSql("DELETE FROM notebook_members WHERE user_id='viewer';");
    expect(suggestPageReferences("viewer", "")).toEqual([]);
  });

  it("honors the existing admin access rule and excludes inactive or unknown users", async () => {
    const { suggestPageReferences } = await import("../src/lib/pageReferences");
    expect(suggestPageReferences("admin", "SortSeq")[0].id).toBe("hidden");
    expect(suggestPageReferences("inactive", "")).toEqual([]);
    expect(suggestPageReferences("unknown", "")).toEqual([]);
  });
});

it("preserves a reference and its readable title through save, text and HTML exports", async () => {
  const { bodyToEditorDocument, bodyToEditorText, editorDocumentToBody } = await import("../src/lib/editor");
  const { buildPageExportHtml } = await import("../src/lib/pageExport");
  const doc = { type: "doc", content: [{ type: "paragraph", content: [
    { type: "text", text: "See " },
    { type: "pageReference", attrs: { id: "target-id", label: "SortSeq <1>" } },
  ] }] };
  const body = editorDocumentToBody(doc);
  expect(bodyToEditorDocument(body)).toEqual(doc);
  expect(bodyToEditorText(body).trim()).toBe("See SortSeq <1>");
  const html = await buildPageExportHtml({ id: "source", notebookId: "shared", title: "Source", body, createdAt: "2026-10-02", updatedAt: "2026-10-02", attachments: [], tags: [], status: "", ownerId: "owner", ownerFirstName: "Owner", ownerLastName: "", lockedAt: "", lockedBy: "", lockedByFirstName: "", lockedByLastName: "" }, { id: "shared", name: "Shared", color: "#0891b2" });
  expect(html).toContain('href="https://novo.mgh.harvard.edu/?page=target-id">SortSeq &lt;1&gt;</a>');
});
