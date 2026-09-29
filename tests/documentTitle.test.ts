import { describe, expect, it } from "vitest";
import { getNovoDocumentTitle } from "../src/lib/documentTitle";

describe("Novo document title", () => {
  it("uses the environment wordmark when no page is selected", () => {
    expect(getNovoDocumentTitle("Novo", null)).toBe("Novo");
    expect(getNovoDocumentTitle("Novo-dev", null)).toBe("Novo-dev");
  });

  it("puts the normalized page title before the environment wordmark", () => {
    expect(getNovoDocumentTitle("Novo", " Useful commands ")).toBe(
      "Useful commands | Novo",
    );
  });

  it("labels a selected page without a title as untitled", () => {
    expect(getNovoDocumentTitle("Novo-dev", "   ")).toBe("Untitled | Novo-dev");
  });
});
