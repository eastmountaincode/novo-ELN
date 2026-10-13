import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/auth", () => ({ currentUser: vi.fn() }));
vi.mock("../src/lib/search", () => ({
  deleteSearchIndexForNotebook: vi.fn(), deleteSearchIndexForPage: vi.fn(),
  queueSearchIndexForNotebook: vi.fn(), queueSearchIndexForPage: vi.fn(),
  queueSearchIndexForPages: vi.fn(), rebuildSearchIndex: vi.fn(), scheduleSearchIndexDrain: vi.fn(),
}));

let tempDir: string;
let notebookId: string;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "novo-template-permissions-"));
  vi.stubEnv("ELN_DATABASE_CLIENT", "sqlite");
  vi.stubEnv("ELN_DATA_DIR", path.join(tempDir, "data"));
  vi.stubEnv("ELN_UPLOAD_DIR", path.join(tempDir, "uploads"));
  vi.stubEnv("ELN_DATABASE_PATH", path.join(tempDir, "data", "test.sqlite3"));
  const store = await import("../src/lib/store");
  const { execSql } = await import("../src/lib/sqlite");
  store.ensureDatabase();
  execSql(`INSERT INTO users (id,email,first_name,password_hash,role) VALUES
    ('owner','owner@example.test','Owner','unused','member'),
    ('editor','editor@example.test','Editor','unused','member'),
    ('viewer','viewer@example.test','Viewer','unused','member'),
    ('outsider','outsider@example.test','Outsider','unused','member'),
    ('admin','admin@example.test','Admin','unused','admin');`);
  notebookId = store.createNotebook("owner", "Shared notebook").notebookId;
  store.shareNotebook({ actorUserId: "owner", notebookId, email: "editor@example.test", role: "editor" });
  store.shareNotebook({ actorUserId: "owner", notebookId, email: "viewer@example.test", role: "viewer" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function patchAs(userId: string | null, enabled = true) {
  const { currentUser } = await import("../src/lib/auth");
  const { findUserById } = await import("../src/lib/store");
  vi.mocked(currentUser).mockResolvedValue(userId ? findUserById(userId) : null);
  const { PATCH } = await import("../src/app/api/notebooks/[notebookId]/route");
  return PATCH(new Request(`http://localhost/api/notebooks/${notebookId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pageTitleTemplate: "Experiment-{number}", pageTitleTemplateEnabled: enabled }),
  }), { params: Promise.resolve({ notebookId }) });
}

describe("notebook title template permissions", () => {
  it.each(["owner", "editor", "admin"])("lets %s save, disable and re-enable the template used by new pages", async (userId) => {
    const store = await import("../src/lib/store");
    expect((await patchAs(userId)).status).toBe(200);
    expect(store.getPage(userId, store.createPage(userId, notebookId)).title).toBe("Experiment-1");
    expect((await patchAs(userId, false)).status).toBe(200);
    expect(store.getPage(userId, store.createPage(userId, notebookId)).title).toBe("Untitled");
    expect((await patchAs(userId)).status).toBe(200);
    expect(store.getPage(userId, store.createPage(userId, notebookId)).title).toBe("Experiment-2");
    expect(store.getWorkspace(userId).notebooks.find(notebook => notebook.id === notebookId)).toMatchObject({
      name: "Shared notebook", pageTitleTemplate: "Experiment-{number}", pageTitleTemplateEnabled: true,
    });
  });

  it.each(["viewer", "outsider"])("rejects %s without modifying the notebook", async (userId) => {
    const store = await import("../src/lib/store");
    store.updateNotebookPageTitleTemplate("owner", notebookId, "Original-{number}", true);
    expect((await patchAs(userId)).status).toBe(403);
    expect((await patchAs(userId, false)).status).toBe(403);
    expect(store.getWorkspace("owner").notebooks.find(notebook => notebook.id === notebookId)).toMatchObject({
      pageTitleTemplate: "Original-{number}", pageTitleTemplateEnabled: true,
    });
  });

  it("rejects unauthenticated changes", async () => {
    expect((await patchAs(null)).status).toBe(401);
  });

  it("keeps notebook deletion and sharing restricted after an editor changes the template", async () => {
    const store = await import("../src/lib/store");
    expect((await patchAs("editor")).status).toBe(200);
    const { DELETE } = await import("../src/app/api/notebooks/[notebookId]/route");
    expect((await DELETE(new Request(`http://localhost/api/notebooks/${notebookId}`, { method: "DELETE" }), {
      params: Promise.resolve({ notebookId }),
    })).status).toBe(403);
    expect(() => store.shareNotebook({ actorUserId: "editor", notebookId, email: "viewer@example.test", role: "editor" }))
      .toThrow("Only owners can manage sharing.");
    expect(store.getWorkspace("owner").notebooks.find(notebook => notebook.id === notebookId)).toBeDefined();
  });
});
