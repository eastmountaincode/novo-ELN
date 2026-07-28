import { describe, expect, it } from "vitest";
import {
  sortAttachments,
  type AttachmentSortKey,
} from "../src/features/editor/attachments/attachmentSorting";
import type { Attachment } from "../src/lib/types";

function attachment(
  id: string,
  originalName: string,
  createdAt: string,
): Attachment {
  return {
    id,
    pageId: "page-1",
    originalName,
    mimeType: "text/plain",
    size: 1,
    storageKey: `page-1/${id}`,
    blockType: "file",
    evernoteHash: "",
    createdAt,
    updatedAt: createdAt,
  };
}

const attachments = [
  attachment("a", "Sample 10.txt", "2026-07-01T12:00:00.000Z"),
  attachment("b", "alpha.txt", "2026-07-03T12:00:00.000Z"),
  attachment("c", "Sample 2.txt", "2026-07-02T12:00:00.000Z"),
];

function sortedIds(sortKey: AttachmentSortKey) {
  return sortAttachments(attachments, sortKey).map((candidate) => candidate.id);
}

describe("attachment sorting", () => {
  it("sorts creation dates newest first", () => {
    expect(sortedIds("created")).toEqual(["b", "c", "a"]);
  });

  it("sorts titles alphabetically with numeric filename segments", () => {
    expect(sortedIds("title")).toEqual(["b", "c", "a"]);
  });

  it("does not mutate the attachment order supplied by the page", () => {
    sortAttachments(attachments, "title");
    expect(attachments.map((candidate) => candidate.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps equal dates and titles stable", () => {
    const tiedAttachments = [
      attachment("first", "same.txt", "2026-07-08T12:00:00.000Z"),
      attachment("second", "same.txt", "2026-07-08T12:00:00.000Z"),
      attachment("older", "older.txt", "2026-07-07T12:00:00.000Z"),
    ];

    expect(sortAttachments(tiedAttachments, "created").map((candidate) => candidate.id))
      .toEqual(["first", "second", "older"]);
    expect(sortAttachments(tiedAttachments.slice(0, 2), "title").map((candidate) => candidate.id))
      .toEqual(["first", "second"]);
  });
});
