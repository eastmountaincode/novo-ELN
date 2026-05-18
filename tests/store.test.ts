import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("store", () => {
  beforeEach(() => {
    vi.resetModules();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "eln-store-"));
    process.env.ELN_DATA_DIR = path.join(tempDir, "data");
    process.env.ELN_UPLOAD_DIR = path.join(tempDir, "uploads");
    process.env.ELN_DATABASE_PATH = path.join(tempDir, "data", "test.sqlite3");
    process.env.ELN_BOOTSTRAP_EMAIL = "test@example.local";
    process.env.ELN_BOOTSTRAP_PASSWORD = "Secret-password-2026!";
  });

  it("seeds an admin user and a queryable workspace", async () => {
    const { verifyCredentials, getWorkspace } = await import("../src/lib/store");
    const user = verifyCredentials("test@example.local", "Secret-password-2026!");

    expect(user?.role).toBe("admin");
    const workspace = getWorkspace(user!.id);
    expect(workspace.notebooks.length).toBeGreaterThan(0);
    expect(workspace.notebooks[0].pages.length).toBeGreaterThan(0);
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

      INSERT INTO users (id, email, name, password_hash, role, created_at)
      VALUES ('user-1', 'legacy@example.local', 'Legacy User', 'hash', 'member', '2026-05-18 12:00:00');
      INSERT INTO notebooks (id, name, owner_id, color, created_at, updated_at)
      VALUES ('notebook-1', 'Legacy Notebook', 'user-1', '#0891b2', '2026-05-18 12:01:00', '2026-05-18 12:01:00');
      INSERT INTO pages (id, notebook_id, title, body, status, owner_id, created_at, updated_at)
      VALUES ('page-1', 'notebook-1', 'Legacy Page', 'body', '', 'user-1', '2026-05-18 12:02:00', '2026-05-18 12:02:00');
      INSERT INTO attachments (id, page_id, original_name, mime_type, size, storage_key, block_type)
      VALUES ('attachment-1', 'page-1', 'legacy.pdf', 'application/pdf', 12, 'legacy.pdf', 'pdf');
    `);

    const { ensureDatabase } = await import("../src/lib/store");
    ensureDatabase();

    expect(queryOne("SELECT COUNT(*) AS count FROM notebooks")?.count).toBe("1");
    expect(queryOne("SELECT COUNT(*) AS count FROM pages")?.count).toBe("1");
    expect(queryOne("SELECT COUNT(*) AS count FROM attachments")?.count).toBe("1");
    const migratedUser = queryOne("SELECT first_name, last_name FROM users WHERE id = 'user-1'");
    expect(migratedUser?.first_name).toBe("Legacy");
    expect(migratedUser?.last_name).toBe("User");
  });

  it("creates and updates pages through the repository API", async () => {
    const { verifyCredentials, getWorkspace, createPage, updatePage } = await import("../src/lib/store");
    const user = verifyCredentials("test@example.local", "Secret-password-2026!")!;
    const notebookId = getWorkspace(user.id).notebooks[0].id;
    const pageId = createPage(user.id, notebookId);

    updatePage(user.id, pageId, { title: "Edited title", body: "Edited body", status: "Completed" });

    const page = getWorkspace(user.id).notebooks[0].pages.find((candidate) => candidate.id === pageId);
    expect(page?.title).toBe("Edited title");
    expect(page?.body).toBe("Edited body");
    expect(page?.status).toBe("Completed");
    expect(page?.versions[0]).toBe("Status changed to Completed");
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
    const { createUser, changeOwnPassword, verifyCredentials } = await import("../src/lib/store");
    const admin = verifyCredentials("test@example.local", "Secret-password-2026!")!;

    expect(() => createUser({ email: "weak@example.local", firstName: "Weak", lastName: "User", password: "simplepass" })).toThrow(
      "Password must be at least 12 characters and include uppercase, lowercase, number, and symbol characters.",
    );
    expect(() => changeOwnPassword(admin.id, "Secret-password-2026!", "lowercase-password-2026")).toThrow(
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
    const { verifyCredentials, getWorkspace, createPage, deletePage } = await import("../src/lib/store");
    const user = verifyCredentials("test@example.local", "Secret-password-2026!")!;
    const notebookId = getWorkspace(user.id).notebooks[0].id;
    const pageId = createPage(user.id, notebookId);

    deletePage(user.id, pageId);

    const pages = getWorkspace(user.id).notebooks[0].pages;
    expect(pages.some((page) => page.id === pageId)).toBe(false);
  });

  it("searches pages with FTS ranking and fuzzy fallback", async () => {
    const { verifyCredentials, getWorkspace, createNotebook, createPage, updatePage } = await import("../src/lib/store");
    const { searchWorkspace } = await import("../src/lib/search");
    const user = verifyCredentials("test@example.local", "Secret-password-2026!")!;
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
    const { verifyCredentials, getWorkspace, setPageTags } = await import("../src/lib/store");
    const user = verifyCredentials("test@example.local", "Secret-password-2026!")!;
    const workspace = getWorkspace(user.id);
    const pageId = workspace.notebooks[0].pages[0].id;

    setPageTags(user.id, pageId, ["cells", "success", "cells", "  needs review  "]);

    const page = getWorkspace(user.id).notebooks[0].pages.find((candidate) => candidate.id === pageId)!;
    expect(page.tags).toEqual(["cells", "success", "needs review"]);

    setPageTags(user.id, pageId, ["success"]);
    const updatedPage = getWorkspace(user.id).notebooks[0].pages.find((candidate) => candidate.id === pageId)!;
    expect(updatedPage.tags).toEqual(["success"]);
  });

  it("lets a user change their own password with the current password", async () => {
    const { verifyCredentials, changeOwnPassword } = await import("../src/lib/store");
    const user = verifyCredentials("test@example.local", "Secret-password-2026!")!;

    expect(() => changeOwnPassword(user.id, "wrong-password", "New-secret-password-2026!")).toThrow("Current password is incorrect.");

    changeOwnPassword(user.id, "Secret-password-2026!", "New-secret-password-2026!");

    expect(verifyCredentials("test@example.local", "Secret-password-2026!")).toBeNull();
    expect(verifyCredentials("test@example.local", "New-secret-password-2026!")?.id).toBe(user.id);
  });

  it("lets admins list users and set another user's password", async () => {
    const { createUser, verifyCredentials, listUsersForAdmin, adminSetUserPassword } = await import("../src/lib/store");
    const admin = verifyCredentials("test@example.local", "Secret-password-2026!")!;
    const member = createUser({ email: "lab.member@example.local", firstName: "Lab", lastName: "Member", password: "Member-password-2026!" });

    const users = listUsersForAdmin(admin.id);
    expect(users.some((user) => user.email === "lab.member@example.local" && user.notebookCount === 1)).toBe(true);

    adminSetUserPassword(admin.id, member.id, "Temporary-password-2026!");

    expect(verifyCredentials("lab.member@example.local", "Member-password-2026!")).toBeNull();
    expect(verifyCredentials("lab.member@example.local", "Temporary-password-2026!")?.id).toBe(member.id);
  });

  it("summarizes database and upload storage for admins", async () => {
    const { verifyCredentials, getWorkspace, createAttachment, getAdminDataOverview } = await import("../src/lib/store");
    const admin = verifyCredentials("test@example.local", "Secret-password-2026!")!;
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
      previewText: "",
    });

    const overview = getAdminDataOverview(admin.id);

    expect(overview.counts.notebooks).toBe(2);
    expect(overview.counts.pages).toBe(3);
    expect(overview.counts.attachments).toBe(1);
    expect(overview.storage.attachmentBytes).toBe(5);
    expect(overview.storage.uploadFileCount).toBe(2);
    expect(overview.storage.orphanUploadCount).toBe(1);
    expect(overview.storage.missingUploadCount).toBe(0);
    expect(overview.files[0]).toEqual(expect.objectContaining({ originalName: "attached.txt", storageKey: "attached.txt" }));

    const emptyFilePage = getAdminDataOverview(admin.id, { fileLimit: 1, fileOffset: 1 });
    expect(emptyFilePage.filePage).toEqual({ total: 1, limit: 1, offset: 1 });
    expect(emptyFilePage.files).toHaveLength(0);
    expect(emptyFilePage.storage.attachmentBytes).toBe(5);
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
    const { createNotebook, createUser, getWorkspace, shareNotebook, verifyCredentials } = await import("../src/lib/store");
    const owner = verifyCredentials("test@example.local", "Secret-password-2026!")!;
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
      getAttachmentForUser,
      getWorkspace,
      renameNotebook,
      setPageTags,
      setPageLocked,
      shareNotebook,
      updateAttachmentFile,
      updateNotebookColor,
      updatePage,
      verifyCredentials,
    } = await import("../src/lib/store");
    const owner = verifyCredentials("test@example.local", "Secret-password-2026!")!;
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
      previewText: "permissions",
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
      previewText: "",
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
      previewText: "",
    });
    expect(() => shareNotebook({ actorUserId: editor.id, notebookId, email: viewer.email, role: "editor" })).toThrow("Only owners can manage sharing.");
    expect(() => deleteNotebook(editor.id, notebookId)).toThrow("Only owners can manage sharing.");

    expect(() => setPageLocked(editor.id, pageId, true)).toThrow("Only owners can lock pages.");
    setPageLocked(owner.id, pageId, true);
    const lockedPage = getWorkspace(owner.id).notebooks.find((notebook) => notebook.id === notebookId)?.pages.find((page) => page.id === pageId);
    expect(lockedPage?.lockedAt).toBeTruthy();
    expect(lockedPage?.lockedBy).toBe(owner.id);
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
      previewText: "",
    })).toThrow("Page is locked.");
    expect(() => deleteAttachment(owner.id, attachmentId)).toThrow("Page is locked.");
    expect(() => deletePage(owner.id, pageId)).toThrow("Page is locked.");

    setPageLocked(owner.id, pageId, false);
    updatePage(editor.id, pageId, { title: "Editor edit after unlock" });
  });

  it("uses notebook membership roles for ownership instead of creator status", async () => {
    const { createNotebook, createUser, getWorkspace, shareNotebook, unshareNotebook, verifyCredentials } = await import("../src/lib/store");
    const creator = verifyCredentials("test@example.local", "Secret-password-2026!")!;
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
    expect(() => unshareNotebook(secondOwner.id, notebookId, secondOwner.id)).toThrow("Owners cannot remove themselves.");

    shareNotebook({ actorUserId: secondOwner.id, notebookId, email: creator.email, role: "viewer" });

    expect(getWorkspace(creator.id).notebooks.find((notebook) => notebook.id === notebookId)?.accessRole).toBe("viewer");
  });
});
