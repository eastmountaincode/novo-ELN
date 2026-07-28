import { describe, expect, it } from "vitest";
import {
  addAttachmentToPage,
  markInlineAttachmentInsertedInPage,
  removeAttachmentFromPage,
} from "../src/features/editor/attachments/attachmentState";
import type { Attachment, PageEntry } from "../src/lib/types";

function attachment(id: string, size = 4096): Attachment {
  return {
    id,
    pageId: "page-1",
    originalName: `${id}.txt`,
    mimeType: "text/plain",
    size,
    storageKey: `page-1/${id}.txt`,
    blockType: "file",
    evernoteHash: "",
    createdAt: "2026-07-27T12:00:00.000Z",
    updatedAt: "2026-07-27T12:00:00.000Z",
  };
}

function editorBody(attachmentId: string) {
  return JSON.stringify({
    type: "doc",
    content: [
      { type: "attachmentCard", attrs: { attachmentId } },
      { type: "paragraph", content: [{ type: "text", text: "After attachment" }] },
    ],
  });
}

function page(): PageEntry {
  const existingAttachment = attachment("attachment-1");
  return {
    id: "page-1",
    notebookId: "notebook-1",
    title: "Page",
    body: editorBody(existingAttachment.id),
    bodyLoaded: true,
    bodyPreview: "After attachment",
    status: "",
    ownerId: "user-1",
    ownerFirstName: "Test",
    ownerLastName: "User",
    lockedAt: "",
    lockedBy: "",
    lockedByFirstName: "",
    lockedByLastName: "",
    createdAt: "2026-07-27T12:00:00.000Z",
    updatedAt: "2026-07-27T12:00:00.000Z",
    tags: [],
    attachments: [existingAttachment],
    attachmentCount: 1,
    attachmentBytes: existingAttachment.size,
  };
}

describe("attachment page state", () => {
  it("adds an attachment exactly once while maintaining counts and bytes", () => {
    const addedAttachment = attachment("attachment-2", 1024);
    const added = addAttachmentToPage(page(), addedAttachment);
    const repeated = addAttachmentToPage(added, addedAttachment);

    expect(added.attachments.map((candidate) => candidate.id)).toEqual(["attachment-2", "attachment-1"]);
    expect(added.attachmentCount).toBe(2);
    expect(added.attachmentBytes).toBe(5120);
    expect(repeated).toBe(added);
  });

  it("removes an attachment and its inline document card", () => {
    const current = page();
    const removed = removeAttachmentFromPage(current, current.attachments[0]);

    expect(removed.attachments).toEqual([]);
    expect(removed.attachmentCount).toBe(0);
    expect(removed.attachmentBytes).toBe(0);
    expect(removed.body).not.toContain("attachment-1");
    expect(removed.bodyPreview?.trim()).toBe("After attachment");
  });

  it("records an inline insertion without duplicating an existing attachment", () => {
    const current = page();
    const body = editorBody("attachment-1");
    const inserted = markInlineAttachmentInsertedInPage(current, current.attachments[0], body);

    expect(inserted.attachments).toHaveLength(1);
    expect(inserted.attachmentCount).toBe(1);
    expect(inserted.attachmentBytes).toBe(4096);
    expect(inserted.body).toBe(body);
    expect(inserted.bodyLoaded).toBe(true);
  });
});
