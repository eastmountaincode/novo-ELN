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
    expect(workspace.projects[0].notebooks.length).toBeGreaterThan(0);
    expect(workspace.projects[0].notebooks[0].pages.length).toBeGreaterThan(0);
  });

  it("creates and updates pages through the repository API", async () => {
    const { verifyCredentials, getWorkspace, createPage, updatePage } = await import("../src/lib/store");
    const user = verifyCredentials("test@example.local", "Secret-password-2026!")!;
    const notebookId = getWorkspace(user.id).projects[0].notebooks[0].id;
    const pageId = createPage(user.id, notebookId);

    updatePage(user.id, pageId, { title: "Edited title", body: "Edited body", status: "Completed" });

    const page = getWorkspace(user.id).projects[0].notebooks[0].pages.find((candidate) => candidate.id === pageId);
    expect(page?.title).toBe("Edited title");
    expect(page?.body).toBe("Edited body");
    expect(page?.status).toBe("Completed");
    expect(page?.versions[0]).toBe("Status changed to Completed");
  });

  it("registers a member with a private starter workspace", async () => {
    const { createUser, verifyCredentials, getWorkspace } = await import("../src/lib/store");
    const user = createUser({ email: "new.user@example.local", name: "New User", password: "Strong-password-2026!" });

    expect(user.role).toBe("member");
    expect(verifyCredentials("new.user@example.local", "Strong-password-2026!")?.id).toBe(user.id);

    const workspace = getWorkspace(user.id);
    expect(workspace.user.email).toBe("new.user@example.local");
    expect(workspace.projects).toHaveLength(1);
    expect(workspace.projects[0].notebooks[0].pages[0].ownerId).toBe(user.id);
  });

  it("rejects weak account passwords", async () => {
    const { createUser, changeOwnPassword, verifyCredentials } = await import("../src/lib/store");
    const admin = verifyCredentials("test@example.local", "Secret-password-2026!")!;

    expect(() => createUser({ email: "weak@example.local", name: "Weak User", password: "simplepass" })).toThrow(
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

    clearFailedLogins(email, ipAddress);
    expect(getLoginRateLimit(email, ipAddress, now + 10).limited).toBe(false);
  });

  it("deletes pages from a notebook", async () => {
    const { verifyCredentials, getWorkspace, createPage, deletePage } = await import("../src/lib/store");
    const user = verifyCredentials("test@example.local", "Secret-password-2026!")!;
    const notebookId = getWorkspace(user.id).projects[0].notebooks[0].id;
    const pageId = createPage(user.id, notebookId);

    deletePage(user.id, pageId);

    const pages = getWorkspace(user.id).projects[0].notebooks[0].pages;
    expect(pages.some((page) => page.id === pageId)).toBe(false);
  });

  it("searches pages with FTS ranking and fuzzy fallback", async () => {
    const { verifyCredentials, getWorkspace, createPage, updatePage } = await import("../src/lib/store");
    const { searchWorkspace } = await import("../src/lib/search");
    const user = verifyCredentials("test@example.local", "Secret-password-2026!")!;
    const notebookId = getWorkspace(user.id).projects[0].notebooks[0].id;
    const pageId = createPage(user.id, notebookId);
    const relatedPageId = createPage(user.id, notebookId);

    updatePage(user.id, pageId, {
      title: "GPA33 Search 2026",
      body: "Looking for expression in neurons and antibody half-life notes.",
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
  });

  it("adds and removes simple page tags", async () => {
    const { verifyCredentials, getWorkspace, setPageTags } = await import("../src/lib/store");
    const user = verifyCredentials("test@example.local", "Secret-password-2026!")!;
    const workspace = getWorkspace(user.id);
    const pageId = workspace.projects[0].notebooks[0].pages[0].id;

    setPageTags(user.id, pageId, ["cells", "success", "cells", "  needs review  "]);

    const page = getWorkspace(user.id).projects[0].notebooks[0].pages.find((candidate) => candidate.id === pageId)!;
    expect(page.tags).toEqual(["cells", "success", "needs review"]);

    setPageTags(user.id, pageId, ["success"]);
    const updatedPage = getWorkspace(user.id).projects[0].notebooks[0].pages.find((candidate) => candidate.id === pageId)!;
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
    const member = createUser({ email: "lab.member@example.local", name: "Lab Member", password: "Member-password-2026!" });

    const users = listUsersForAdmin(admin.id);
    expect(users.some((user) => user.email === "lab.member@example.local" && user.projectCount === 1)).toBe(true);

    adminSetUserPassword(admin.id, member.id, "Temporary-password-2026!");

    expect(verifyCredentials("lab.member@example.local", "Member-password-2026!")).toBeNull();
    expect(verifyCredentials("lab.member@example.local", "Temporary-password-2026!")?.id).toBe(member.id);
  });

  it("summarizes database and upload storage for admins", async () => {
    const { verifyCredentials, getWorkspace, createAttachment, getAdminDataOverview } = await import("../src/lib/store");
    const admin = verifyCredentials("test@example.local", "Secret-password-2026!")!;
    const pageId = getWorkspace(admin.id).projects[0].notebooks[0].pages[0].id;
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

    expect(overview.counts.projects).toBe(1);
    expect(overview.counts.notebooks).toBe(2);
    expect(overview.counts.pages).toBe(3);
    expect(overview.counts.attachments).toBe(1);
    expect(overview.storage.attachmentBytes).toBe(5);
    expect(overview.storage.uploadFileCount).toBe(2);
    expect(overview.storage.orphanUploadCount).toBe(1);
    expect(overview.storage.missingUploadCount).toBe(0);
    expect(overview.files[0]).toEqual(expect.objectContaining({ originalName: "attached.txt", storageKey: "attached.txt" }));
  });

  it("blocks non-admins from listing users or setting passwords", async () => {
    const { createUser, listUsersForAdmin, adminSetUserPassword, getAdminDataOverview } = await import("../src/lib/store");
    const member = createUser({ email: "member@example.local", name: "Member", password: "Member-password-2026!" });
    const other = createUser({ email: "other@example.local", name: "Other", password: "Other-password-2026!" });

    expect(() => listUsersForAdmin(member.id)).toThrow("Forbidden");
    expect(() => adminSetUserPassword(member.id, other.id, "Temporary-password-2026!")).toThrow("Forbidden");
    expect(() => getAdminDataOverview(member.id)).toThrow("Forbidden");
  });

  it("shares full projects with all notebooks", async () => {
    const { createNotebook, createUser, getWorkspace, shareProject, verifyCredentials } = await import("../src/lib/store");
    const owner = verifyCredentials("test@example.local", "Secret-password-2026!")!;
    const viewer = createUser({ email: "project.viewer@example.local", name: "Project Viewer", password: "Viewer-password-2026!" });
    const ownerWorkspace = getWorkspace(owner.id);
    const project = ownerWorkspace.projects[0];
    const originalNotebookCount = project.notebooks.length;

    createNotebook(owner.id, project.id, "Second Notebook");
    shareProject({ actorUserId: owner.id, projectId: project.id, email: viewer.email, role: "editor" });

    const viewerProject = getWorkspace(viewer.id).projects.find((candidate) => candidate.id === project.id)!;
    expect(viewerProject.accessScope).toBe("project");
    expect(viewerProject.accessRole).toBe("editor");
    expect(viewerProject.notebooks.length).toBe(originalNotebookCount + 1);
  });

  it("shares individual notebooks without exposing sibling notebooks", async () => {
    const { createNotebook, createUser, getWorkspace, shareNotebook, verifyCredentials } = await import("../src/lib/store");
    const owner = verifyCredentials("test@example.local", "Secret-password-2026!")!;
    const viewer = createUser({ email: "notebook.viewer@example.local", name: "Notebook Viewer", password: "Viewer-password-2026!" });
    const ownerWorkspace = getWorkspace(owner.id);
    const project = ownerWorkspace.projects[0];
    const sharedNotebookId = createNotebook(owner.id, project.id, "Shared Notebook").notebookId;
    createNotebook(owner.id, project.id, "Private Notebook");

    shareNotebook({ actorUserId: owner.id, notebookId: sharedNotebookId, email: viewer.email, role: "viewer" });

    const viewerProject = getWorkspace(viewer.id).projects.find((candidate) => candidate.id === project.id)!;
    expect(viewerProject.accessScope).toBe("notebook");
    expect(viewerProject.accessRole).toBeNull();
    expect(viewerProject.notebooks).toHaveLength(1);
    expect(viewerProject.notebooks[0]).toEqual(expect.objectContaining({ id: sharedNotebookId, accessRole: "viewer" }));
  });
});
