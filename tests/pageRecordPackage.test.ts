import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";

const testAdminEmail = "record-package@example.local";
const testAdminPassword = "Secret-password-2026!";

async function createTestPage() {
  const { editorDocumentToBody } = await import("../src/lib/editor");
  const {
    createAttachment,
    createPageCommentThread,
    createUser,
    getPage,
    getPageCommentThreads,
    getPageNotebook,
    getWorkspace,
    listPageRecordAuditEvents,
    updatePage,
  } = await import("../src/lib/store");
  const { uploadDir } = await import("../src/lib/paths");

  const user = createUser({
    email: testAdminEmail,
    firstName: "Record",
    lastName: "Tester",
    password: testAdminPassword,
    role: "admin",
  });
  const pageId = getWorkspace(user.id).notebooks[0].pages[0].id;
  const storageKey = "record-proof/sample.bin";
  const attachmentBytes = Buffer.from("actual attachment bytes\n", "utf8");
  fs.mkdirSync(path.dirname(path.join(uploadDir, storageKey)), { recursive: true });
  fs.writeFileSync(path.join(uploadDir, storageKey), attachmentBytes);
  const attachmentId = createAttachment({
    userId: user.id,
    pageId,
    originalName: "sample data.bin",
    mimeType: "application/octet-stream",
    size: attachmentBytes.byteLength,
    storageKey,
    blockType: "file",
  });
  const thread = createPageCommentThread(user.id, pageId, {
    selectedText: "Observed cells",
    body: "Review attachment data.",
  });
  updatePage(user.id, pageId, {
    title: "Deterministic record",
    body: editorDocumentToBody({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Observed cells" }] },
        {
          type: "attachmentCard",
          attrs: {
            attachmentId,
            kind: "file",
            filename: "sample data.bin",
            mimeType: "application/octet-stream",
            size: attachmentBytes.byteLength,
          },
        },
        {
          type: "paragraph",
          content: [{
            type: "text",
            text: "Commented note",
            marks: [{ type: "comment", attrs: { threadId: thread.id } }],
          }],
        },
      ],
    }),
    status: "Completed",
  });

  const page = getPage(user.id, pageId);
  return {
    userId: user.id,
    page,
    notebook: getPageNotebook(user.id, pageId),
    auditEvents: listPageRecordAuditEvents(user.id, pageId),
    commentThreads: getPageCommentThreads(user.id, pageId),
    attachmentBytes,
    storageKey,
    uploadDir,
  };
}

describe("page record package", () => {
  beforeEach(() => {
    vi.resetModules();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "eln-record-package-"));
    process.env.ELN_DATA_DIR = path.join(tempDir, "data");
    process.env.ELN_UPLOAD_DIR = path.join(tempDir, "uploads");
    process.env.ELN_DATABASE_PATH = path.join(tempDir, "data", "test.sqlite3");
    process.env.ELN_SESSION_SECRET = "test-session-secret-for-record-package-tests-2026";
  });

  it("builds a deterministic package that includes canonical page data and attachment bytes", async () => {
    const { buildPageRecordPackage, stableJsonStringify, sha256Hex } = await import("../src/lib/pageRecordPackage");
    const setup = await createTestPage();

    const first = await buildPageRecordPackage(setup.page, setup.notebook, {
      auditEvents: setup.auditEvents,
      commentThreads: setup.commentThreads,
    });
    const second = await buildPageRecordPackage(setup.page, setup.notebook, {
      auditEvents: setup.auditEvents,
      commentThreads: setup.commentThreads,
    });

    expect(second.recordHash).toBe(first.recordHash);
    expect(Buffer.from(second.archive).equals(Buffer.from(first.archive))).toBe(true);

    const entries = unzipSync(first.archive);
    const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
    expect(manifest.recordHash).toBe(first.recordHash);
    const manifestPayload = { ...manifest };
    delete manifestPayload.recordHash;
    expect(sha256Hex(Buffer.from(`${stableJsonStringify(manifestPayload)}\n`, "utf8"))).toBe(first.recordHash);

    const pageRecord = JSON.parse(strFromU8(entries["record/page.json"]));
    expect(pageRecord.page.title).toBe("Deterministic record");
    expect(pageRecord.page.body.text).toContain("Observed cells");
    expect(pageRecord.page.body.raw).toContain(setup.page.attachments[0].id);
    expect(JSON.parse(strFromU8(entries["record/comments.json"]))).toHaveLength(1);
    expect(JSON.parse(strFromU8(entries["record/audit-events.json"])).length).toBeGreaterThan(0);

    const attachmentEntry = manifest.files.find((file: { role: string }) => file.role === "attachment");
    expect(attachmentEntry).toBeTruthy();
    expect(Buffer.from(entries[attachmentEntry.path]).equals(setup.attachmentBytes)).toBe(true);
    expect(attachmentEntry.sha256).toBe(sha256Hex(setup.attachmentBytes));
  });

  it("changes the record hash when attachment bytes change", async () => {
    const { buildPageRecordPackage } = await import("../src/lib/pageRecordPackage");
    const setup = await createTestPage();
    const before = await buildPageRecordPackage(setup.page, setup.notebook, {
      auditEvents: setup.auditEvents,
      commentThreads: setup.commentThreads,
    });

    fs.writeFileSync(path.join(setup.uploadDir, setup.storageKey), Buffer.from("changed attachment bytes\n", "utf8"));

    const after = await buildPageRecordPackage(setup.page, setup.notebook, {
      auditEvents: setup.auditEvents,
      commentThreads: setup.commentThreads,
    });
    expect(after.recordHash).not.toBe(before.recordHash);
  });

  it("fails when a page attachment row points to a missing file", async () => {
    const { buildPageRecordPackage } = await import("../src/lib/pageRecordPackage");
    const setup = await createTestPage();
    fs.unlinkSync(path.join(setup.uploadDir, setup.storageKey));

    await expect(buildPageRecordPackage(setup.page, setup.notebook, {
      auditEvents: setup.auditEvents,
      commentThreads: setup.commentThreads,
    })).rejects.toThrow("Attachment file is missing: sample data.bin");
  });
});
