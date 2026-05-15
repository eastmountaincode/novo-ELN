import { describe, expect, it } from "vitest";
import { inferAttachmentBlockType, resolveAttachmentBlockType } from "../src/lib/attachmentTypes";

describe("attachment type inference", () => {
  it("treats generic file uploads as auto-detectable PDFs by extension", () => {
    expect(resolveAttachmentBlockType({
      name: "flow-report.pdf",
      mimeType: "application/octet-stream",
      requestedBlockType: "file",
    })).toBe("pdf");
  });

  it("detects PDFs from MIME type even without a useful extension", () => {
    expect(inferAttachmentBlockType("download", "application/pdf")).toBe("pdf");
  });

  it("uses explicit button type only when the file itself is generic", () => {
    expect(resolveAttachmentBlockType({
      name: "instrument-export",
      mimeType: "application/octet-stream",
      requestedBlockType: "sheet",
    })).toBe("sheet");
  });

  it("lets file identity override a mismatched requested type", () => {
    expect(resolveAttachmentBlockType({
      name: "protocol.pdf",
      mimeType: "application/pdf",
      requestedBlockType: "sheet",
    })).toBe("pdf");
  });
});
