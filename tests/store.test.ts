import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, verify } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";

const testAdminEmail = "test@example.local";
const testAdminPassword = "Secret-password-2026!";

async function createTestAdmin() {
  const { createUser } = await import("../src/lib/store");
  return createUser({ email: testAdminEmail, firstName: "Test", lastName: "Admin", password: testAdminPassword, role: "admin" });
}

describe("store", () => {
  beforeEach(() => {
    vi.resetModules();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "eln-store-"));
    process.env.ELN_DATA_DIR = path.join(tempDir, "data");
    process.env.ELN_UPLOAD_DIR = path.join(tempDir, "uploads");
    process.env.ELN_DATABASE_PATH = path.join(tempDir, "data", "test.sqlite3");
    process.env.ELN_SESSION_SECRET = "test-session-secret-for-store-tests-2026";
  });

  it("creates an explicit admin user with a queryable workspace", async () => {
    const { getWorkspace } = await import("../src/lib/store");
    const user = await createTestAdmin();

    expect(user.role).toBe("admin");
    const workspace = getWorkspace(user.id);
    expect(workspace.notebooks.length).toBeGreaterThan(0);
    expect(workspace.notebooks[0].pages.length).toBeGreaterThan(0);
  });

  it("preserves a single-column empty string row from query output", async () => {
    const { querySql } = await import("../src/lib/sqlite");

    expect(querySql("SELECT '' AS value")).toEqual([{ value: "" }]);
    expect(querySql("SELECT '' AS value WHERE 0")).toEqual([]);
  });

  it("migrates legacy user names without deleting notebook data", async () => {
    const { execSql, queryOne } = await import("../src/lib/sqlite");
    execSql(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE notebooks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        color TEXT NOT NULL DEFAULT '#0891b2',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE pages (
        id TEXT PRIMARY KEY,
        notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT '',
        owner_id TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE attachments (
        id TEXT PRIMARY KEY,
        page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        original_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        storage_key TEXT NOT NULL,
        block_type TEXT NOT NULL DEFAULT 'file',
        preview_text TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE page_tags (
        page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        tag TEXT NOT NULL,
        PRIMARY KEY (page_id, tag)
      );

      INSERT INTO users (id, email, name, password_hash, role, created_at)
      VALUES ('user-1', 'legacy@example.local', 'Legacy User', 'hash', 'member', '2026-05-18 12:00:00');
      INSERT INTO notebooks (id, name, owner_id, color, created_at, updated_at)
      VALUES ('notebook-1', 'Legacy Notebook', 'user-1', '#0891b2', '2026-05-18 12:01:00', '2026-05-18 12:01:00');
      INSERT INTO pages (id, notebook_id, title, body, status, owner_id, created_at, updated_at)
      VALUES ('page-1', 'notebook-1', 'Legacy Page', 'body', '', 'user-1', '2026-05-18 12:02:00', '2026-05-18 12:02:00');
      INSERT INTO attachments (id, page_id, original_name, mime_type, size, storage_key, block_type)
      VALUES ('attachment-1', 'page-1', 'legacy.pdf', 'application/pdf', 12, 'legacy.pdf', 'pdf');
      INSERT INTO page_tags (page_id, tag)
      VALUES ('page-1', 'Cells'), ('page-1', 'Needs review');
    `);

    const { ensureDatabase } = await import("../src/lib/store");
    ensureDatabase();

    expect(queryOne("SELECT COUNT(*) AS count FROM notebooks")?.count).toBe("1");
    expect(queryOne("SELECT COUNT(*) AS count FROM pages")?.count).toBe("1");
    expect(queryOne("SELECT COUNT(*) AS count FROM attachments")?.count).toBe("1");
    const migratedUser = queryOne("SELECT first_name, last_name FROM users WHERE id = 'user-1'");
    expect(migratedUser?.first_name).toBe("Legacy");
    expect(migratedUser?.last_name).toBe("User");
    expect(queryOne("SELECT COUNT(*) AS count FROM tags WHERE label IN ('Cells', 'Needs review')")?.count).toBe("2");
    expect(queryOne("SELECT COUNT(*) AS count FROM page_tags WHERE page_id = 'page-1' AND tag_id IS NOT NULL")?.count).toBe("2");
  });

  it("creates and updates pages through the repository API", async () => {
    const { bodyToEditorText } = await import("../src/lib/editor");
    const { getPage, getWorkspace, createPage, updatePage } = await import("../src/lib/store");
    const user = await createTestAdmin();
    const notebookId = getWorkspace(user.id).notebooks[0].id;
    const pageId = createPage(user.id, notebookId);

    updatePage(user.id, pageId, { title: "Edited title", body: "Edited body", status: "Completed" });

    const page = getPage(user.id, pageId);
    expect(page.title).toBe("Edited title");
    expect(bodyToEditorText(page.body).trim()).toBe("Edited body");
    expect(page.bodyLoaded).toBe(true);
    expect(page.status).toBe("Completed");
  });

  it("removes an inline attachment card from the authoritative page after deletion", async () => {
    const { bodyToEditorText, editorDocumentToBody } = await import("../src/lib/editor");
    const { createAttachment, createPage, deleteAttachment, getPage, getWorkspace, updatePage } = await import("../src/lib/store");
    const user = await createTestAdmin();
    const notebookId = getWorkspace(user.id).notebooks[0].id;
    const pageId = createPage(user.id, notebookId);
    const attachmentId = createAttachment({
      userId: user.id,
      pageId,
      originalName: "inline.txt",
      mimeType: "text/plain",
      size: 12,
      storageKey: "inline.txt",
      blockType: "file",
    });

    updatePage(user.id, pageId, {
      body: editorDocumentToBody({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Before attachment" }] },
          {
            type: "attachmentCard",
            attrs: {
              attachmentId,
              kind: "file",
              filename: "inline.txt",
              mimeType: "text/plain",
              size: 12,
            },
          },
          { type: "paragraph", content: [{ type: "text", text: "After attachment" }] },
        ],
      }),
    });

    expect(getPage(user.id, pageId).body).toContain(attachmentId);

    deleteAttachment(user.id, attachmentId);

    const authoritativePage = getPage(user.id, pageId);
    expect(authoritativePage.attachments).toEqual([]);
    expect(authoritativePage.attachmentCount).toBe(0);
    expect(authoritativePage.body).not.toContain(attachmentId);
    expect(bodyToEditorText(authoritativePage.body).trim()).toBe("Before attachment\nAfter attachment");
  });

  it("atomically deletes a comment thread and its page marker", async () => {
    const { editorDocumentToBody } = await import("../src/lib/editor");
    const {
      createPage,
      createPageCommentThread,
      deletePageCommentThread,
      getPage,
      getPageActivityEvents,
      getPageCommentThreads,
      getWorkspace,
      setPageLocked,
      updatePage,
    } = await import("../src/lib/store");
    const user = await createTestAdmin();
    const notebookId = getWorkspace(user.id).notebooks[0].id;
    const pageId = createPage(user.id, notebookId);
    const thread = createPageCommentThread(user.id, pageId, {
      selectedText: "Commented text",
      body: "Review this",
    });
    const markedBody = editorDocumentToBody({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{
          type: "text",
          text: "Commented text",
          marks: [{ type: "comment", attrs: { threadId: thread.id } }],
        }],
      }],
    });
    updatePage(user.id, pageId, { body: markedBody });

    setPageLocked(user.id, pageId, true);
    expect(() => deletePageCommentThread(user.id, thread.id)).toThrow("Page is locked.");
    expect(getPage(user.id, pageId).body).toContain(thread.id);
    expect(getPageCommentThreads(user.id, pageId)).toHaveLength(1);

    setPageLocked(user.id, pageId, false);
    const updatedPage = deletePageCommentThread(user.id, thread.id);

    expect(updatedPage.body).not.toContain(thread.id);
    expect(getPage(user.id, pageId).body).not.toContain(thread.id);
    expect(getPageCommentThreads(user.id, pageId)).toEqual([]);
    expect(getPageActivityEvents(user.id, pageId).events).toContainEqual(
      expect.objectContaining({ action: "page.comment.deleted" }),
    );
    expect(deletePageCommentThread(user.id, thread.id, pageId).body).toBe(updatedPage.body);

    updatePage(user.id, pageId, { body: markedBody });
    const pageAfterStaleSave = getPage(user.id, pageId);
    expect(pageAfterStaleSave.body).not.toContain(thread.id);
    expect(pageAfterStaleSave.body).toContain("Commented text");
  });

  it("does not timestamp or audit no-op page saves", async () => {
    const { queryOne } = await import("../src/lib/sqlite");
    const { bodyToEditorDocument, editorDocumentToBody } = await import("../src/lib/editor");
    const { getPageActivityEvents, getWorkspace, createPage, updatePage, setPageTags } = await import("../src/lib/store");
    const user = await createTestAdmin();
    const notebookId = getWorkspace(user.id).notebooks[0].id;
    const pageId = createPage(user.id, notebookId);

    expect(updatePage(user.id, pageId, { title: "Note 1", body: "hello" })).toBe(true);
    const before = queryOne(`SELECT updated_at FROM pages WHERE id = '${pageId}'`);

    expect(updatePage(user.id, pageId, { title: "Note 1" })).toBe(false);
    expect(updatePage(user.id, pageId, { body: editorDocumentToBody(bodyToEditorDocument("hello")) })).toBe(false);
    expect(setPageTags(user.id, pageId, [])).toBe(false);

    const after = queryOne(`SELECT updated_at FROM pages WHERE id = '${pageId}'`);
    expect(after?.updated_at).toBe(before?.updated_at);
    expect(getPageActivityEvents(user.id, pageId).events.filter((event) => event.action !== "page.created")).toHaveLength(2);
  });

  it("records page activity and coalesces body edits within five minutes", async () => {
    const { execSql } = await import("../src/lib/sqlite");
    const { createAttachment, createPage, getPageActivityEvents, getWorkspace, setPageLocked, setPageTags, updatePage } = await import("../src/lib/store");
    const user = await createTestAdmin();
    const notebookId = getWorkspace(user.id).notebooks[0].id;
    const pageId = createPage(user.id, notebookId);

    updatePage(user.id, pageId, { title: "Audit note" });
    updatePage(user.id, pageId, { body: "first body edit" });
    updatePage(user.id, pageId, { body: "second body edit" });
    setPageTags(user.id, pageId, ["Megan"]);
    updatePage(user.id, pageId, { status: "Needs review" });
    setPageLocked(user.id, pageId, true);
    setPageLocked(user.id, pageId, false);
    createAttachment({
      userId: user.id,
      pageId,
      originalName: "audit.pdf",
      mimeType: "application/pdf",
      size: 10,
      storageKey: "audit.pdf",
      blockType: "pdf",
    });

    let events = getPageActivityEvents(user.id, pageId).events;
    expect(events.some((event) => event.action === "page.title.updated" && event.summary.includes("Audit note"))).toBe(true);
    expect(events.some((event) => event.action === "page.tags.updated" && event.summary.includes("Megan"))).toBe(true);
    expect(events.some((event) => event.action === "page.status.updated" && event.summary.includes("Needs review"))).toBe(true);
    expect(events.some((event) => event.action === "page.locked")).toBe(true);
    expect(events.some((event) => event.action === "page.unlocked")).toBe(true);
    expect(events.some((event) => event.action === "attachment.created" && event.summary.includes("audit.pdf"))).toBe(true);

    let bodyEvents = events.filter((event) => event.action === "page.body.updated");
    expect(bodyEvents).toHaveLength(1);
    expect(bodyEvents[0].eventCount).toBe(2);
    const textDiff = bodyEvents[0].metadata.textDiff as { oldText: string; newText: string; lines: Array<{ type: string; text: string }> };
    expect(bodyEvents[0].metadata.oldTextLength).toBe(textDiff.oldText.length);
    expect(bodyEvents[0].metadata.newTextLength).toBe(textDiff.newText.length);
    expect(bodyEvents[0].metadata.textDiff).toMatchObject({
      format: "novo-plain-text-diff-v1",
      newText: "second body edit\n",
      truncated: false,
    });
    expect(textDiff.oldText).not.toBe("first body edit\n");
    expect(textDiff.lines).toContainEqual({ type: "added", text: "second body edit" });

    execSql(`UPDATE audit_events SET updated_at = datetime('now', '-6 minutes') WHERE id = '${bodyEvents[0].id}';`);
    updatePage(user.id, pageId, { body: "third body edit after the audit window" });

    events = getPageActivityEvents(user.id, pageId).events;
    bodyEvents = events.filter((event) => event.action === "page.body.updated");
    expect(bodyEvents).toHaveLength(2);

    const firstPage = getPageActivityEvents(user.id, pageId, { limit: 3, offset: 0 });
    const secondPage = getPageActivityEvents(user.id, pageId, { limit: 3, offset: 3 });
    expect(firstPage.events).toHaveLength(3);
    expect(firstPage.hasMore).toBe(true);
    expect(secondPage.events.length).toBeGreaterThan(0);
    expect(new Set([...firstPage.events, ...secondPage.events].map((event) => event.id)).size).toBe(firstPage.events.length + secondPage.events.length);
  });

  it("stores readable text diffs for long page body edits", async () => {
    const { execSql, sql } = await import("../src/lib/sqlite");
    const { createPage, getPageActivityEvents, getWorkspace, updatePage } = await import("../src/lib/store");
    const user = await createTestAdmin();
    const notebookId = getWorkspace(user.id).notebooks[0].id;
    const pageId = createPage(user.id, notebookId);
    const baselineLines = Array.from({ length: 900 }, (_, index) => (
      `Baseline line ${String(index + 1).padStart(3, "0")}: this intentionally long audit body should keep readable diff data.`
    ));
    const changedLines = baselineLines.map((line, index) => (
      index >= 450 && index < 520
        ? `Updated line ${String(index + 1).padStart(3, "0")}: this long audit edit should remain readable in activity.`
        : line
    ));

    updatePage(user.id, pageId, { body: baselineLines.join("\n") });
    execSql(`UPDATE audit_events SET updated_at = datetime('now', '-6 minutes') WHERE page_id = ${sql(pageId)} AND action = 'page.body.updated';`);
    updatePage(user.id, pageId, { body: changedLines.join("\n") });

    const bodyEvent = getPageActivityEvents(user.id, pageId).events.find((event) => event.action === "page.body.updated");
    const textDiff = bodyEvent?.metadata.textDiff as { oldText: string; newText: string; truncated: boolean; lines: Array<{ type: string; text: string }> } | undefined;
    expect(textDiff?.truncated).toBe(false);
    expect(textDiff?.oldText.length).toBeGreaterThan(20_000);
    expect(textDiff?.oldText.split("\n").length).toBeGreaterThan(400);
    expect(textDiff?.lines).toContainEqual({ type: "removed", text: baselineLines[450] });
    expect(textDiff?.lines).toContainEqual({ type: "added", text: changedLines[450] });
  });

  it("registers a member with a private starter workspace", async () => {
    const { createUser, verifyCredentials, getWorkspace } = await import("../src/lib/store");
    const user = createUser({ email: "new.user@example.local", firstName: "New", lastName: "User", password: "Strong-password-2026!" });

    expect(user.role).toBe("member");
    expect(user.firstName).toBe("New");
    expect(user.lastName).toBe("User");
    expect(verifyCredentials("new.user@example.local", "Strong-password-2026!")?.id).toBe(user.id);

    const workspace = getWorkspace(user.id);
    expect(workspace.user.email).toBe("new.user@example.local");
    expect(workspace.user.firstName).toBe("New");
    expect(workspace.user.lastName).toBe("User");
    expect(workspace.notebooks.length).toBeGreaterThan(0);
    expect(workspace.notebooks[0].pages[0].ownerId).toBe(user.id);
  });

  it("rejects weak account passwords", async () => {
    const { createUser, changeOwnPassword } = await import("../src/lib/store");
    const admin = await createTestAdmin();

    expect(() => createUser({ email: "weak@example.local", firstName: "Weak", lastName: "User", password: "simplepass" })).toThrow(
      "Password must be at least 12 characters and include uppercase, lowercase, number, and symbol characters.",
    );
    expect(() => changeOwnPassword(admin.id, testAdminPassword, "lowercase-password-2026")).toThrow(
      "Password must be at least 12 characters and include uppercase, lowercase, number, and symbol characters.",
    );
  });

  it("rate limits repeated failed login attempts by email and IP", async () => {
    const { clearFailedLogins, getLoginRateLimit, recordFailedLogin } = await import("../src/lib/store");
    const email = "TEST@example.local";
    const ipAddress = "192.0.2.10";
    const now = 1_800_000;

    for (let attempt = 0; attempt < 9; attempt += 1) {
      recordFailedLogin(email, ipAddress, now + attempt);
      expect(getLoginRateLimit(email, ipAddress, now + attempt).limited).toBe(false);
    }

    recordFailedLogin(email, ipAddress, now + 9);
    const limited = getLoginRateLimit("test@example.local", ipAddress, now + 10);
    expect(limited.limited).toBe(true);
    expect(limited.retryAfterSeconds).toBeGreaterThan(0);

    expect(getLoginRateLimit(email, "198.51.100.4", now + 10).limited).toBe(false);
    expect(getLoginRateLimit(email, ipAddress, now + 15 * 60 * 1000 + 1).limited).toBe(false);

    recordFailedLogin("stale@example.local", ipAddress, now - 25 * 60 * 60 * 1000);
    recordFailedLogin("stale@example.local", ipAddress, now);
    expect(getLoginRateLimit("stale@example.local", ipAddress, now).limited).toBe(false);

    clearFailedLogins(email, ipAddress);
    expect(getLoginRateLimit(email, ipAddress, now + 10).limited).toBe(false);
  });

  it("deletes pages from a notebook", async () => {
    const { getWorkspace, createPage, deletePage } = await import("../src/lib/store");
    const user = await createTestAdmin();
    const notebookId = getWorkspace(user.id).notebooks[0].id;
    const pageId = createPage(user.id, notebookId);

    deletePage(user.id, pageId);

    const pages = getWorkspace(user.id).notebooks[0].pages;
    expect(pages.some((page) => page.id === pageId)).toBe(false);
  });

  it("searches pages with FTS ranking and fuzzy fallback", async () => {
    const { getWorkspace, createNotebook, createPage, updatePage } = await import("../src/lib/store");
    const { searchWorkspace, updateSearchIndexForPage } = await import("../src/lib/search");
    const user = await createTestAdmin();
    const notebookId = getWorkspace(user.id).notebooks[0].id;
    const pageId = createPage(user.id, notebookId);
    const relatedPageId = createPage(user.id, notebookId);
    createNotebook(user.id, "Zephyr Quasar Notebooklabel");

    updatePage(user.id, pageId, {
      title: "GPA33 Search 2026",
      body: "Looking for expression in neurons and antibody half-life records.",
    });
    updatePage(user.id, relatedPageId, {
      title: "ctDNA-Expt57 DNA/exosome isolation from B16F10-ROR1 tumors in B6 mice",
      body: "Compare direct DNA isolation from plasma. Tumor cells are processed before sequencing.",
    });
    updateSearchIndexForPage(pageId);
    updateSearchIndexForPage(relatedPageId);

    const titleResults = searchWorkspace(user.id, "GPA33");
    expect(titleResults[0]?.pageId).toBe(pageId);
    expect(titleResults[0]?.matchType).toBe("title");

    const fuzzyResults = searchWorkspace(user.id, "neuronn");
    expect(fuzzyResults.some((result) => result.pageId === pageId)).toBe(true);

    const relaxedResults = searchWorkspace(user.id, "exosome cell culture");
    expect(relaxedResults.some((result) => result.pageId === relatedPageId)).toBe(true);

    const titleTokenResults = searchWorkspace(user.id, "ctDNA Expt57 DNA exosome isolation");
    expect(titleTokenResults[0]?.pageId).toBe(relatedPageId);
    expect(titleTokenResults[0]?.matchType).toBe("title");

    expect(searchWorkspace(user.id, "Zephyr Quasar Notebooklabel")).toHaveLength(0);
  });

  it("adds and removes simple page tags", async () => {
    const { queryOne } = await import("../src/lib/sqlite");
    const { createPage, getWorkspace, setPageTags } = await import("../src/lib/store");
    const user = await createTestAdmin();
    const workspace = getWorkspace(user.id);
    const notebookId = workspace.notebooks[0].id;
    const pageId = workspace.notebooks[0].pages[0].id;
    const secondPageId = createPage(user.id, notebookId);

    setPageTags(user.id, pageId, ["cells", "success", "cells", "  needs review  "]);
    setPageTags(user.id, secondPageId, ["Cells"]);

    const page = getWorkspace(user.id).notebooks[0].pages.find((candidate) => candidate.id === pageId)!;
    expect(page.tags).toEqual(["cells", "success", "needs review"]);
    expect(queryOne("SELECT COUNT(*) AS count FROM tags WHERE lower(label) = 'cells'")?.count).toBe("1");
    expect(queryOne("SELECT COUNT(*) AS count FROM page_tags WHERE tag_id = (SELECT id FROM tags WHERE lower(label) = 'cells')")?.count).toBe("2");

    setPageTags(user.id, pageId, ["success"]);
    const updatedPage = getWorkspace(user.id).notebooks[0].pages.find((candidate) => candidate.id === pageId)!;
    expect(updatedPage.tags).toEqual(["success"]);
  });

  it("lets a user change their own password with the current password", async () => {
    const { verifyCredentials, changeOwnPassword } = await import("../src/lib/store");
    const user = await createTestAdmin();

    expect(() => changeOwnPassword(user.id, "wrong-password", "New-secret-password-2026!")).toThrow("Current password is incorrect.");

    changeOwnPassword(user.id, testAdminPassword, "New-secret-password-2026!");

    expect(verifyCredentials(testAdminEmail, testAdminPassword)).toBeNull();
    expect(verifyCredentials(testAdminEmail, "New-secret-password-2026!")?.id).toBe(user.id);
  });

  it("lets admins list users and set another user's password", async () => {
    const { createUser, verifyCredentials, listUsersForAdmin, adminSetUserPassword } = await import("../src/lib/store");
    const admin = await createTestAdmin();
    const member = createUser({ email: "lab.member@example.local", firstName: "Lab", lastName: "Member", password: "Member-password-2026!" });

    const users = listUsersForAdmin(admin.id);
    expect(users.some((user) => user.email === "lab.member@example.local" && user.notebookCount === 1)).toBe(true);

    adminSetUserPassword(admin.id, member.id, "Temporary-password-2026!");

    expect(verifyCredentials("lab.member@example.local", "Member-password-2026!")).toBeNull();
    expect(verifyCredentials("lab.member@example.local", "Temporary-password-2026!")?.id).toBe(member.id);
  });

  it("manages user signing keys with a separate signing passphrase", async () => {
    const { adminSetUserPassword, changeOwnPassword, createUser, ensureUserSigningKey, getActiveUserSigningPrivateKeyForSigning, listUserSigningKeys } = await import("../src/lib/store");
    const admin = await createTestAdmin();
    const originalPassword = "Member-password-2026!";
    const changedPassword = "Changed-password-2026!";
    const resetPassword = "Temporary-password-2026!";
    const signingPassphrase = "Signing passphrase 2026";
    const member = createUser({ email: "signed.member@example.local", firstName: "Signed", lastName: "Member", password: originalPassword });

    expect(listUserSigningKeys(member.id)).toEqual([]);
    const createdKey = ensureUserSigningKey(member.id, signingPassphrase);
    const initialKeys = listUserSigningKeys(member.id);
    expect(initialKeys).toHaveLength(1);
    expect(initialKeys[0]).toEqual(expect.objectContaining({ active: true, algorithm: "ed25519", revokedAt: "", revocationReason: "" }));
    expect(initialKeys[0].id).toBe(createdKey.id);
    expect(initialKeys[0].publicKey).toContain("BEGIN PUBLIC KEY");
    expect(initialKeys[0].publicKeyFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(getActiveUserSigningPrivateKeyForSigning(member.id, signingPassphrase)).toContain("BEGIN PRIVATE KEY");

    changeOwnPassword(member.id, originalPassword, changedPassword);

    const afterOwnPasswordChange = listUserSigningKeys(member.id);
    expect(afterOwnPasswordChange).toHaveLength(1);
    expect(afterOwnPasswordChange[0].id).toBe(initialKeys[0].id);
    expect(afterOwnPasswordChange[0].publicKey).toBe(initialKeys[0].publicKey);
    expect(() => getActiveUserSigningPrivateKeyForSigning(member.id, originalPassword)).toThrow("Private signing key could not be decrypted.");
    expect(() => getActiveUserSigningPrivateKeyForSigning(member.id, changedPassword)).toThrow("Private signing key could not be decrypted.");
    expect(getActiveUserSigningPrivateKeyForSigning(member.id, signingPassphrase)).toContain("BEGIN PRIVATE KEY");

    adminSetUserPassword(admin.id, member.id, resetPassword);

    const afterAdminReset = listUserSigningKeys(member.id);
    expect(afterAdminReset).toHaveLength(1);
    expect(afterAdminReset[0].id).toBe(initialKeys[0].id);
    expect(afterAdminReset[0].publicKey).toBe(initialKeys[0].publicKey);
    expect(() => getActiveUserSigningPrivateKeyForSigning(member.id, resetPassword)).toThrow("Private signing key could not be decrypted.");
    expect(getActiveUserSigningPrivateKeyForSigning(member.id, signingPassphrase)).toContain("BEGIN PRIVATE KEY");
  });

  it("creates signing keys from a signing passphrase", async () => {
    const { execSql } = await import("../src/lib/sqlite");
    const { createUser, ensureUserSigningKey, listUserSigningKeys } = await import("../src/lib/store");
    const password = "Legacy-password-2026!";
    const signingPassphrase = "Legacy signing passphrase";
    const member = createUser({ email: "legacy.signing@example.local", firstName: "Legacy", lastName: "Signer", password });
    execSql(`DELETE FROM user_signing_keys WHERE user_id = '${member.id}';`);

    expect(listUserSigningKeys(member.id)).toEqual([]);
    expect(() => ensureUserSigningKey(member.id, "too-short")).toThrow("Signing passphrase must be at least 12 characters.");

    const key = ensureUserSigningKey(member.id, signingPassphrase);
    expect(key.active).toBe(true);
    expect(key.publicKeyFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(listUserSigningKeys(member.id)).toHaveLength(1);
  });


  it("creates verifiable page record signatures", async () => {
    const { queryOne } = await import("../src/lib/sqlite");
    const { buildPageRecordPackage, stableJsonStringify } = await import("../src/lib/pageRecordPackage");
    const {
      createPageRecordSignature,
      createPageSignatureTimestamp,
      ensureUserSigningKey,
      getPageFinalizationPackageDownload,
      getPage,
      getPageCommentThreads,
      getPageNotebook,
      getWorkspace,
      listPageRecordAuditEvents,
      listPageRecordSignatures,
      rollbackPageRecordFinalization,
      setPageLocked,
      storePageFinalizationPackage,
    } = await import("../src/lib/store");
    const admin = await createTestAdmin();
    const signingPassphrase = "Signing passphrase 2026";
    ensureUserSigningKey(admin.id, signingPassphrase);
    const pageId = getWorkspace(admin.id).notebooks[0].pages[0].id;
    const page = getPage(admin.id, pageId);
    const notebook = getPageNotebook(admin.id, pageId);
    const commentThreads = getPageCommentThreads(admin.id, pageId);
    const auditEvents = listPageRecordAuditEvents(admin.id, pageId);
    const recordPackage = await buildPageRecordPackage(page, notebook, { auditEvents, commentThreads });

    const signature = createPageRecordSignature(admin.id, {
      pageId,
      recordHash: recordPackage.recordHash,
      recordManifest: recordPackage.manifest,
      recordArchive: recordPackage.archive,
      signingPassphrase,
    });

    expect(signature.recordHash).toBe(recordPackage.recordHash);
    expect(signature.signingPublicKey).toContain("BEGIN PUBLIC KEY");
    expect(signature.signingPublicKeyFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(signature.recordPackageStorageKey).toBe(`page-signatures/${signature.id}/record.zip`);
    expect(signature.recordPackageBytes).toBe(recordPackage.archive.byteLength);
    expect(signature.recordPackageSha256).toBe(createHash("sha256").update(recordPackage.archive).digest("hex"));
    expect(fs.existsSync(path.join(process.env.ELN_DATA_DIR!, "proofs", signature.recordPackageStorageKey))).toBe(true);
    expect(JSON.parse(signature.signaturePayload).record.hash).toBe(recordPackage.recordHash);
    expect(JSON.parse(signature.signaturePayload).schemaVersion).toBe(2);
    expect(verify(null, Buffer.from(signature.signaturePayload, "utf8"), signature.signingPublicKey, Buffer.from(signature.signature, "base64"))).toBe(true);
    expect(signature.proofHashAlgorithm).toBe("sha256");
    expect(signature.proofHash).toMatch(/^[a-f0-9]{64}$/);
    const proofPackage = JSON.parse(signature.proofPackageJson);
    expect(proofPackage.packageType).toBe("novo.page.proof");
    expect(proofPackage.packageVersion).toBe(2);
    expect(proofPackage.proofHash).toBe(signature.proofHash);
    const proofHashMaterial = { ...proofPackage };
    delete proofHashMaterial.proofHash;
    expect(createHash("sha256").update(`${stableJsonStringify(proofHashMaterial)}\n`).digest("hex")).toBe(signature.proofHash);
    expect(proofPackage.record.hash).toBe(recordPackage.recordHash);
    expect(proofPackage.record.hashTarget).toBe("manifest.json");
    expect(proofPackage.record.hashFile).toBe("manifest.sha256");
    expect(proofPackage.record.manifest.packageVersion).toBe(2);
    expect(proofPackage.record.manifest.recordHash).toBeUndefined();
    expect(proofPackage.record.manifestHash).toBeUndefined();
    expect(JSON.parse(signature.signaturePayload).record.manifestHash).toBeUndefined();
    expect(proofPackage.userSignature.id).toBe(signature.id);
    expect(proofPackage.userSignature.payload).toBe(signature.signaturePayload);
    expect(proofPackage.userSignature.signature).toBe(signature.signature);
    expect(signature.timestamps).toEqual([]);
    expect(listPageRecordSignatures(admin.id, pageId).map((candidate) => candidate.id)).toContain(signature.id);
    const timestamp = createPageSignatureTimestamp(admin.id, signature.id, {
      provider: "digicert",
      tsaUrl: "http://timestamp.digicert.com",
      hashAlgorithm: "sha256",
      messageImprint: signature.proofHash,
      requestDerBase64: "request",
      responseDerBase64: "response",
      status: "granted",
      statusMessage: "unspecified",
      policyOid: "2.16.840.1.114412.7.1",
      serialNumber: "0x01",
      tsaTime: "Aug  5 17:25:33 2026 GMT",
      tsaSubject: "",
      tsaCertFingerprint: "",
      verifiedAt: "",
      errorMessage: "",
    });
    expect(timestamp.messageImprint).toBe(signature.proofHash);
    expect(listPageRecordSignatures(admin.id, pageId).find((candidate) => candidate.id === signature.id)?.timestamps[0]?.id).toBe(timestamp.id);
    const finalizedSignature = storePageFinalizationPackage(admin.id, signature.id);
    expect(finalizedSignature.finalizationPackageStorageKey).toBe(`page-signatures/${signature.id}/finalization.zip`);
    expect(finalizedSignature.finalizationPackageBytes).toBeGreaterThan(recordPackage.archive.byteLength);
    expect(finalizedSignature.finalizationPackageSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fs.existsSync(path.join(process.env.ELN_DATA_DIR!, "proofs", finalizedSignature.finalizationPackageStorageKey))).toBe(true);
    const finalizationDownload = getPageFinalizationPackageDownload(admin.id, pageId, signature.id);
    expect(finalizationDownload.filename).toContain(".finalization.zip");
    expect(finalizationDownload.sha256).toBe(finalizedSignature.finalizationPackageSha256);
    const finalizationEntries = unzipSync(finalizationDownload.bytes);
    expect(finalizationEntries["record.zip"]).toBeTruthy();
    expect(finalizationEntries["manifest.json"]).toBeTruthy();
    expect(finalizationEntries["proof/proof-package.json"]).toBeTruthy();
    expect(strFromU8(finalizationEntries["proof/record-manifest.sha256"])).toBe(`${signature.recordHash}  record-manifest.json\n`);
    expect(finalizationEntries[`timestamps/${timestamp.id}/request.tsq`]).toBeTruthy();
    expect(finalizationEntries[`timestamps/${timestamp.id}/response.tsr`]).toBeTruthy();
    const finalizationManifest = JSON.parse(strFromU8(finalizationEntries["manifest.json"]));
    expect(finalizationManifest.packageType).toBe("novo.page.finalization");
    expect(finalizationManifest.signature.proofHash).toBe(signature.proofHash);
    expect(finalizationManifest.files).toContainEqual(expect.objectContaining({ path: "record.zip", sha256: signature.recordPackageSha256 }));
    expect(() => createPageRecordSignature(admin.id, {
      pageId,
      recordHash: recordPackage.recordHash,
      recordManifest: recordPackage.manifest,
      recordArchive: recordPackage.archive,
      signingPassphrase,
    })).toThrow("Page is already finalized.");
    setPageLocked(admin.id, pageId, true);
    expect(() => setPageLocked(admin.id, pageId, false)).toThrow("Finalized pages cannot be unlocked.");
    const signedEvent = listPageRecordAuditEvents(admin.id, pageId).find((event) => event.action === "page.record.signed" && event.metadata.signatureId === signature.id);
    expect(signedEvent?.metadata.proofHash).toBe(signature.proofHash);

    rollbackPageRecordFinalization(admin.id, signature.id);

    expect(listPageRecordSignatures(admin.id, pageId).some((candidate) => candidate.id === signature.id)).toBe(false);
    expect(queryOne(`SELECT COUNT(*) AS count FROM page_signature_timestamps WHERE page_signature_id = '${signature.id}'`)?.count).toBe("0");
    expect(fs.existsSync(path.join(process.env.ELN_DATA_DIR!, "proofs", signature.recordPackageStorageKey))).toBe(false);
    expect(fs.existsSync(path.join(process.env.ELN_DATA_DIR!, "proofs", finalizedSignature.finalizationPackageStorageKey))).toBe(false);
    expect(listPageRecordAuditEvents(admin.id, pageId).some((event) =>
      (event.action === "page.record.signed" || event.action === "page.record.timestamped") && event.metadata.signatureId === signature.id,
    )).toBe(false);
  });

  it("returns the live database schema for admins", async () => {
    const { createUser, getAdminDatabaseSchema } = await import("../src/lib/store");
    const admin = await createTestAdmin();
    const member = createUser({ email: "schema.member@example.local", firstName: "Schema", password: "Schema-password-2026!" });

    const schema = getAdminDatabaseSchema(admin.id);

    expect(schema.tables.some((table) => table.name === "user_signing_keys")).toBe(true);
    expect(schema.tables.some((table) => table.name === "page_signatures")).toBe(true);
    expect(schema.tables.some((table) => table.name === "page_signature_timestamps")).toBe(true);
    expect(schema.tables.find((table) => table.name === "user_signing_keys")?.columns.map((column) => column.name)).toContain("public_key_fingerprint");
    expect(schema.tables.find((table) => table.name === "page_signatures")?.columns.map((column) => column.name)).toContain("proof_hash");
    expect(schema.tables.find((table) => table.name === "page_signatures")?.columns.map((column) => column.name)).toContain("finalization_package_storage_key");
    expect(schema.tables.find((table) => table.name === "page_signature_timestamps")?.columns.map((column) => column.name)).toContain("response_der_base64");
    expect(schema.relationships).toContainEqual(expect.objectContaining({
      fromTable: "user_signing_keys",
      fromColumn: "user_id",
      toTable: "users",
      toColumn: "id",
    }));
    expect(schema.relationships).toContainEqual(expect.objectContaining({
      fromTable: "page_signatures",
      fromColumn: "page_id",
      toTable: "pages",
      toColumn: "id",
    }));
    expect(schema.relationships).toContainEqual(expect.objectContaining({
      fromTable: "page_signature_timestamps",
      fromColumn: "page_signature_id",
      toTable: "page_signatures",
      toColumn: "id",
    }));
    expect(schema.tableCount).toBeGreaterThan(0);
    expect(schema.columnCount).toBeGreaterThan(0);
    expect(() => getAdminDatabaseSchema(member.id)).toThrow("Forbidden");
  });

  it("summarizes database and upload storage for admins", async () => {
    const { getWorkspace, createAttachment, getAdminDataOverview } = await import("../src/lib/store");
    const admin = await createTestAdmin();
    const pageId = getWorkspace(admin.id).notebooks[0].pages[0].id;
    const uploadDir = process.env.ELN_UPLOAD_DIR!;
    fs.mkdirSync(uploadDir, { recursive: true });
    fs.writeFileSync(path.join(uploadDir, "attached.txt"), "hello");
    fs.writeFileSync(path.join(uploadDir, "orphan.txt"), "left behind");

    createAttachment({
      userId: admin.id,
      pageId,
      originalName: "attached.txt",
      mimeType: "text/plain",
      size: 5,
      storageKey: "attached.txt",
      blockType: "file",
    });

    const overview = getAdminDataOverview(admin.id);

    expect(overview.counts.notebooks).toBe(1);
    expect(overview.counts.pages).toBe(1);
    expect(overview.counts.attachments).toBe(1);
    expect(overview.storage.attachmentBytes).toBe(5);
    expect(overview.storage.uploadFileCount).toBe(2);
    expect(overview.storage.orphanUploadCount).toBe(1);
    expect(overview.storage.missingUploadCount).toBe(0);
  });

  it("blocks non-admins from listing users or setting passwords", async () => {
    const { createUser, listUsersForAdmin, adminSetUserPassword, getAdminDataOverview } = await import("../src/lib/store");
    const member = createUser({ email: "member@example.local", firstName: "Member", password: "Member-password-2026!" });
    const other = createUser({ email: "other@example.local", firstName: "Other", password: "Other-password-2026!" });

    expect(() => listUsersForAdmin(member.id)).toThrow("Forbidden");
    expect(() => adminSetUserPassword(member.id, other.id, "Temporary-password-2026!")).toThrow("Forbidden");
    expect(() => getAdminDataOverview(member.id)).toThrow("Forbidden");
  });

  it("shares individual notebooks without exposing sibling notebooks", async () => {
    const { createNotebook, createUser, getWorkspace, shareNotebook } = await import("../src/lib/store");
    const owner = await createTestAdmin();
    const viewer = createUser({ email: "notebook.viewer@example.local", firstName: "Notebook", lastName: "Viewer", password: "Viewer-password-2026!" });
    const sharedNotebookId = createNotebook(owner.id, "Shared Notebook").notebookId;
    const privateNotebookId = createNotebook(owner.id, "Private Notebook").notebookId;

    shareNotebook({ actorUserId: owner.id, notebookId: sharedNotebookId, email: viewer.email, role: "viewer" });

    const viewerWorkspace = getWorkspace(viewer.id);
    const sharedNotebook = viewerWorkspace.notebooks.find((candidate) => candidate.id === sharedNotebookId);
    expect(sharedNotebook).toEqual(expect.objectContaining({ id: sharedNotebookId, accessRole: "viewer" }));
    expect(viewerWorkspace.notebooks.some((candidate) => candidate.id === privateNotebookId)).toBe(false);
  });

  it("enforces notebook roles for server-side page and attachment changes", async () => {
    const {
      createAttachment,
      createNotebook,
      createPage,
      createUser,
      deleteAttachment,
      deleteNotebook,
      deletePage,
      duplicatePage,
      getAttachmentForUser,
      getWorkspace,
      renameNotebook,
      setPageTags,
      setPageLocked,
      shareNotebook,
      updateAttachmentFile,
      updateNotebookColor,
      updatePage,
    } = await import("../src/lib/store");
    const owner = await createTestAdmin();
    const viewer = createUser({ email: "viewer.permissions@example.local", firstName: "Viewer", password: "Viewer-password-2026!" });
    const editor = createUser({ email: "editor.permissions@example.local", firstName: "Editor", password: "Editor-password-2026!" });
    const notebookId = createNotebook(owner.id, "Permission Notebook").notebookId;
    const pageId = createPage(owner.id, notebookId);
    const attachmentId = createAttachment({
      userId: owner.id,
      pageId,
      originalName: "permissions.txt",
      mimeType: "text/plain",
      size: 4,
      storageKey: "permissions.txt",
      blockType: "file",
    });

    shareNotebook({ actorUserId: owner.id, notebookId, email: viewer.email, role: "viewer" });
    shareNotebook({ actorUserId: owner.id, notebookId, email: editor.email, role: "editor" });

    expect(getWorkspace(viewer.id).notebooks.find((notebook) => notebook.id === notebookId)?.accessRole).toBe("viewer");
    expect(getAttachmentForUser(viewer.id, attachmentId)?.id).toBe(attachmentId);
    expect(() => createPage(viewer.id, notebookId)).toThrow("Forbidden");
    expect(() => updatePage(viewer.id, pageId, { title: "Viewer edit" })).toThrow("Forbidden");
    expect(() => setPageTags(viewer.id, pageId, ["viewer"])).toThrow("Forbidden");
    expect(() => createAttachment({
      userId: viewer.id,
      pageId,
      originalName: "viewer.txt",
      mimeType: "text/plain",
      size: 1,
      storageKey: "viewer.txt",
      blockType: "file",
    })).toThrow("Forbidden");
    expect(() => updateAttachmentFile({
      userId: viewer.id,
      attachmentId,
      mimeType: "text/plain",
      size: 5,
      storageKey: "viewer-replacement.txt",
    })).toThrow("Forbidden");
    expect(() => deleteAttachment(viewer.id, attachmentId)).toThrow("Forbidden");
    expect(() => deletePage(viewer.id, pageId)).toThrow("Forbidden");
    expect(() => renameNotebook(viewer.id, notebookId, "Viewer Rename")).toThrow("Forbidden");
    expect(() => updateNotebookColor(viewer.id, notebookId, "#111111")).toThrow("Forbidden");
    expect(() => shareNotebook({ actorUserId: viewer.id, notebookId, email: editor.email, role: "viewer" })).toThrow("Only owners can manage sharing.");

    updatePage(editor.id, pageId, { title: "Editor edit" });
    createAttachment({
      userId: editor.id,
      pageId,
      originalName: "editor.txt",
      mimeType: "text/plain",
      size: 1,
      storageKey: "editor.txt",
      blockType: "file",
    });
    expect(() => shareNotebook({ actorUserId: editor.id, notebookId, email: viewer.email, role: "editor" })).toThrow("Only owners can manage sharing.");
    expect(() => deleteNotebook(editor.id, notebookId)).toThrow("Only owners can manage sharing.");

    expect(() => setPageLocked(viewer.id, pageId, true)).toThrow("Only editors and owners can lock pages.");
    setPageLocked(editor.id, pageId, true);
    const lockedPage = getWorkspace(owner.id).notebooks.find((notebook) => notebook.id === notebookId)?.pages.find((page) => page.id === pageId);
    expect(lockedPage?.lockedAt).toBeTruthy();
    expect(lockedPage?.lockedBy).toBe(editor.id);
    expect(() => updatePage(owner.id, pageId, { title: "Owner edit while locked" })).toThrow("Page is locked.");
    expect(() => updatePage(editor.id, pageId, { title: "Editor edit while locked" })).toThrow("Page is locked.");
    expect(() => setPageTags(owner.id, pageId, ["locked"])).toThrow("Page is locked.");
    expect(() => createAttachment({
      userId: owner.id,
      pageId,
      originalName: "locked.txt",
      mimeType: "text/plain",
      size: 1,
      storageKey: "locked.txt",
      blockType: "file",
    })).toThrow("Page is locked.");
    expect(() => deleteAttachment(owner.id, attachmentId)).toThrow("Page is locked.");
    expect(() => deletePage(owner.id, pageId)).toThrow("Page is locked.");
    const lockedCopySourceId = createPage(owner.id, notebookId);
    setPageLocked(owner.id, lockedCopySourceId, true);
    const duplicate = duplicatePage(owner.id, lockedCopySourceId);
    expect(duplicate.pageId).not.toBe(lockedCopySourceId);
    expect(getWorkspace(owner.id).notebooks.find((notebook) => notebook.id === notebookId)?.pages.some((page) => page.id === duplicate.pageId)).toBe(true);

    setPageLocked(owner.id, pageId, false);
    setPageLocked(owner.id, lockedCopySourceId, false);
    updatePage(editor.id, pageId, { title: "Editor edit after unlock" });
  });

  it("uses notebook membership roles for ownership instead of creator status", async () => {
    const { createNotebook, createUser, getWorkspace, shareNotebook, unshareNotebook } = await import("../src/lib/store");
    const creator = createUser({ email: "notebook.creator@example.local", firstName: "Notebook", lastName: "Creator", password: "Creator-password-2026!" });
    const secondOwner = createUser({ email: "second.owner@example.local", firstName: "Second", lastName: "Owner", password: "Owner-password-2026!" });
    const viewer = createUser({ email: "shared.viewer@example.local", firstName: "Shared", lastName: "Viewer", password: "Viewer-password-2026!" });
    const notebookId = createNotebook(creator.id, "Multiple Owner Notebook").notebookId;

    shareNotebook({ actorUserId: creator.id, notebookId, email: secondOwner.email, role: "owner" });
    shareNotebook({ actorUserId: creator.id, notebookId, email: viewer.email, role: "viewer" });

    const ownerWorkspace = getWorkspace(secondOwner.id);
    expect(ownerWorkspace.notebooks.find((notebook) => notebook.id === notebookId)?.accessRole).toBe("owner");

    expect(() => shareNotebook({ actorUserId: secondOwner.id, notebookId, email: secondOwner.email, role: "viewer" })).toThrow(
      "Owners cannot change their own role.",
    );
    shareNotebook({ actorUserId: secondOwner.id, notebookId, email: creator.email, role: "viewer" });

    expect(getWorkspace(creator.id).notebooks.find((notebook) => notebook.id === notebookId)?.accessRole).toBe("viewer");
    expect(() => unshareNotebook(secondOwner.id, notebookId, secondOwner.id)).toThrow("Notebooks need at least one owner.");

    shareNotebook({ actorUserId: secondOwner.id, notebookId, email: creator.email, role: "owner" });
    unshareNotebook(secondOwner.id, notebookId, secondOwner.id);

    expect(getWorkspace(secondOwner.id).notebooks.some((notebook) => notebook.id === notebookId)).toBe(false);
    expect(getWorkspace(creator.id).notebooks.find((notebook) => notebook.id === notebookId)?.accessRole).toBe("owner");
  });
});
