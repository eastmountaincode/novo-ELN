import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testPassword = "Secret-password-2026!";

describe("Novo Chat integration", () => {
  beforeEach(() => {
    vi.resetModules();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "novo-integration-"));
    process.env.ELN_DATA_DIR = path.join(tempDir, "data");
    process.env.ELN_UPLOAD_DIR = path.join(tempDir, "uploads");
    process.env.ELN_DATABASE_PATH = path.join(tempDir, "data", "test.sqlite3");
    process.env.ELN_SESSION_SECRET = "test-session-secret-for-integration-tests-2026";
    delete process.env.NOVO_CHAT_URL;
    delete process.env.NOVO_INTEGRATION_SECRET_FILE;
  });

  afterEach(() => {
    delete process.env.NOVO_CHAT_URL;
    delete process.env.NOVO_INTEGRATION_SECRET_FILE;
    vi.doUnmock("../src/lib/auth");
    vi.restoreAllMocks();
  });

  it("loads a bearer secret from a file and validates only same-origin Chat paths", async () => {
    const secretFile = path.join(path.dirname(process.env.ELN_DATABASE_PATH!), "integration-secret");
    fs.mkdirSync(path.dirname(secretFile), { recursive: true });
    fs.writeFileSync(secretFile, "integration-secret-with-at-least-32-characters\n");
    process.env.NOVO_INTEGRATION_SECRET_FILE = secretFile;
    process.env.NOVO_CHAT_URL = "/chat/";

    const {
      bearerMatchesIntegrationSecret,
      getAdvertisedChatIntegration,
      getIntegrationSecretState,
      validateNovoLoginReturnPath,
      validateSameOriginAbsolutePath,
    } = await import("../src/lib/novoIntegrationConfig");
    const secretState = getIntegrationSecretState();

    expect(secretState).toEqual({
      status: "ready",
      secret: "integration-secret-with-at-least-32-characters",
    });
    expect(getAdvertisedChatIntegration()).toEqual({ url: "/chat/" });
    expect(bearerMatchesIntegrationSecret("Bearer integration-secret-with-at-least-32-characters", secretState.status === "ready" ? secretState.secret : "")).toBe(true);
    expect(bearerMatchesIntegrationSecret("Bearer wrong-secret", secretState.status === "ready" ? secretState.secret : "")).toBe(false);
    expect(validateSameOriginAbsolutePath("https://attacker.example/chat/")).toBeNull();
    expect(validateSameOriginAbsolutePath("//attacker.example/chat/")).toBeNull();
    expect(validateSameOriginAbsolutePath("/%2e%2e//attacker.example/chat/")).toBeNull();
    expect(validateNovoLoginReturnPath("/chat/conversation?id=1#answer")).toBe("/chat/conversation?id=1#answer");
    expect(validateNovoLoginReturnPath("/%2e%2e//attacker.example/chat/")).toBeNull();
    expect(validateNovoLoginReturnPath("/settings")).toBeNull();
    delete process.env.NOVO_CHAT_URL;
    expect(validateNovoLoginReturnPath("/chat/")).toBe("/chat/");
    expect(validateNovoLoginReturnPath("/chat-impersonator/")).toBeNull();
  });

  it("keeps content revisions independent from membership and lock state", async () => {
    const store = await import("../src/lib/store");
    const integration = await import("../src/lib/novoIntegration");
    const owner = store.createUser({
      email: "owner@example.local",
      firstName: "Owner",
      password: testPassword,
      role: "member",
    });
    const viewer = store.createUser({
      email: "viewer@example.local",
      firstName: "Viewer",
      password: testPassword,
      role: "viewer",
    });
    const notebook = store.getWorkspace(owner.id).notebooks[0];
    const pageId = notebook.pages[0].id;
    const revision = () => integration.getIntegrationContext(owner.id).notebooks.find((item) => item.id === notebook.id)!.contentRevision;

    const initialRevision = revision();
    store.shareNotebook({ actorUserId: owner.id, notebookId: notebook.id, email: viewer.email, role: "viewer" });
    expect(revision()).toBe(initialRevision);
    expect(integration.getIntegrationContext(viewer.id).notebooks.find((item) => item.id === notebook.id)?.accessRole).toBe("viewer");

    store.setPageLocked(owner.id, pageId, true);
    expect(revision()).toBe(initialRevision);
    store.setPageLocked(owner.id, pageId, false);
    expect(revision()).toBe(initialRevision);

    store.updatePage(owner.id, pageId, { body: "new indexable text" });
    const bodyRevision = revision();
    expect(bodyRevision).not.toBe(initialRevision);

    store.setPageTags(owner.id, pageId, ["Cells"]);
    const tagRevision = revision();
    expect(tagRevision).not.toBe(bodyRevision);

    store.createAttachment({
      userId: owner.id,
      pageId,
      originalName: "results.csv",
      mimeType: "text/csv",
      size: 10,
      storageKey: "results-v1.csv",
      blockType: "sheet",
    });
    const attachmentRevision = revision();
    expect(attachmentRevision).not.toBe(tagRevision);

    store.renameNotebook(owner.id, notebook.id, "Renamed notebook");
    const renamedRevision = revision();
    expect(renamedRevision).not.toBe(attachmentRevision);

    store.unshareNotebook(owner.id, notebook.id, viewer.id);
    expect(revision()).toBe(renamedRevision);
    expect(integration.getIntegrationContext(viewer.id).notebooks.some((item) => item.id === notebook.id)).toBe(false);
  });

  it("exports deterministic normalized batches and rejects an obsolete revision", async () => {
    const store = await import("../src/lib/store");
    const { editorDocumentToBody } = await import("../src/lib/editor");
    const integration = await import("../src/lib/novoIntegration");
    const owner = store.createUser({
      email: "batch-owner@example.local",
      firstName: "Batch",
      password: testPassword,
      role: "member",
    });
    const outsider = store.createUser({
      email: "outsider@example.local",
      firstName: "Outsider",
      password: testPassword,
      role: "member",
    });
    const notebook = store.getWorkspace(owner.id).notebooks[0];
    const firstPageId = notebook.pages[0].id;
    store.updatePage(owner.id, firstPageId, {
      title: "Normalized page",
      body: editorDocumentToBody({
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Experiment" }] },
          { type: "paragraph", content: [{ type: "text", text: "Measured response" }] },
        ],
      }),
      status: "Completed",
    });
    store.setPageTags(owner.id, firstPageId, ["Cells", "Readout"]);
    store.createAttachment({
      userId: owner.id,
      pageId: firstPageId,
      originalName: "results.csv",
      mimeType: "text/csv",
      size: 12,
      storageKey: "private/storage-key.csv",
      blockType: "sheet",
    });
    for (let index = 0; index < 3; index += 1) {
      const pageId = store.createPage(owner.id, notebook.id);
      store.updatePage(owner.id, pageId, { title: `Page ${index}`, body: `Body ${index}` });
    }

    const context = integration.getIntegrationContext(owner.id);
    const notebookContext = context.notebooks.find((item) => item.id === notebook.id)!;
    const inaccessible = integration.getIntegrationNotebookPageBatch({
      userId: outsider.id,
      notebookId: notebook.id,
      expectedContentRevision: notebookContext.contentRevision,
      limit: 2,
    });
    expect(inaccessible).toEqual({ status: "not-found" });

    const firstBatch = integration.getIntegrationNotebookPageBatch({
      userId: owner.id,
      notebookId: notebook.id,
      expectedContentRevision: notebookContext.contentRevision,
      limit: 2,
    });
    expect(firstBatch.status).toBe("ok");
    if (firstBatch.status !== "ok") throw new Error("Expected an integration page batch");
    expect(firstBatch.pages).toHaveLength(2);
    expect(firstBatch.complete).toBe(false);
    expect(firstBatch.nextAfterPageId).toBeTruthy();
    expect(firstBatch.pages.map((page) => page.id)).toEqual([...firstBatch.pages.map((page) => page.id)].sort());

    const cursor = integration.encodeIntegrationCursor({
      notebookId: notebook.id,
      contentRevision: notebookContext.contentRevision,
      afterPageId: firstBatch.nextAfterPageId!,
    });
    expect(integration.decodeIntegrationCursor(cursor, {
      notebookId: notebook.id,
      contentRevision: notebookContext.contentRevision,
    })).toEqual({ valid: true, afterPageId: firstBatch.nextAfterPageId });
    expect(integration.decodeIntegrationCursor(cursor, {
      notebookId: outsider.id,
      contentRevision: notebookContext.contentRevision,
    })).toEqual({ valid: false });

    const secondBatch = integration.getIntegrationNotebookPageBatch({
      userId: owner.id,
      notebookId: notebook.id,
      expectedContentRevision: notebookContext.contentRevision,
      afterPageId: firstBatch.nextAfterPageId!,
      limit: 2,
    });
    expect(secondBatch.status).toBe("ok");
    if (secondBatch.status === "ok") {
      expect(secondBatch.pages).toHaveLength(2);
      expect(secondBatch.complete).toBe(true);
      expect(secondBatch.pages.map((page) => page.id)).not.toEqual(firstBatch.pages.map((page) => page.id));
      const normalizedPage = [...firstBatch.pages, ...secondBatch.pages].find((page) => page.id === firstPageId)!;
      expect(normalizedPage.text).toBe("Experiment\nMeasured response");
      expect(normalizedPage.text).not.toContain('"type":"doc"');
      expect(normalizedPage.attachments[0]).toMatchObject({
        name: "results.csv",
        mimeType: "text/csv",
        size: 12,
        blockType: "sheet",
      });
      expect(normalizedPage.attachments[0]).not.toHaveProperty("storageKey");
    }

    store.updatePage(owner.id, firstPageId, { body: "changed after export began" });
    const stale = integration.getIntegrationNotebookPageBatch({
      userId: owner.id,
      notebookId: notebook.id,
      expectedContentRevision: notebookContext.contentRevision,
      limit: 2,
    });
    expect(stale.status).toBe("stale");
    if (stale.status === "stale") expect(stale.contentRevision).not.toBe(notebookContext.contentRevision);
  });

  it("requires a quoted revision and binds cursors to notebook and revision", async () => {
    const integration = await import("../src/lib/novoIntegration");
    const revision = `sha256:${"a".repeat(64)}`;

    expect(integration.parseIntegrationIfMatch(null)).toEqual({ status: "missing" });
    expect(integration.parseIntegrationIfMatch(revision)).toEqual({ status: "invalid" });
    expect(integration.parseIntegrationIfMatch(`"${revision}"`)).toEqual({ status: "ok", contentRevision: revision });
    expect(integration.quoteContentRevision(revision)).toBe(`"${revision}"`);
  });

  it("applies private no-store headers to integration responses", async () => {
    const { integrationJson } = await import("../src/lib/novoIntegrationHttp");
    const response = integrationJson({ ok: true });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie, Authorization");
  });
});
