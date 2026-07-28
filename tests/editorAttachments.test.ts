import { describe, expect, it } from "vitest";
import { attachmentIdsFromBody } from "../src/lib/editor";

describe("inline attachment references", () => {
  it("collects exact attachment IDs from nested editor cards", () => {
    const body = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [
            {
              type: "attachmentCard",
              attrs: { attachmentId: "attachment-1", filename: "one.pdf" },
            },
          ],
        },
        {
          type: "attachmentCard",
          attrs: { attachmentId: "attachment-10", filename: "ten.pdf" },
        },
      ],
    });

    expect(attachmentIdsFromBody(body)).toEqual(["attachment-1", "attachment-10"]);
  });

  it("deduplicates multiple inline placements of the same attachment", () => {
    const body = JSON.stringify({
      type: "doc",
      content: [
        { type: "attachmentCard", attrs: { attachmentId: "attachment-1" } },
        { type: "paragraph" },
        { type: "attachmentCard", attrs: { attachmentId: "attachment-1" } },
      ],
    });

    expect(attachmentIdsFromBody(body)).toEqual(["attachment-1"]);
  });

  it("ignores attachment-like text and cards without an ID", () => {
    const body = JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "attachment-1" }] },
        { type: "attachmentCard", attrs: { filename: "missing-id.pdf" } },
      ],
    });

    expect(attachmentIdsFromBody(body)).toEqual([]);
  });

  it("returns no references for legacy text or malformed editor bodies", () => {
    expect(attachmentIdsFromBody("attachment-1")).toEqual([]);
    expect(attachmentIdsFromBody("{not json")).toEqual([]);
    expect(attachmentIdsFromBody(JSON.stringify({ type: "paragraph" }))).toEqual([]);
  });
});
