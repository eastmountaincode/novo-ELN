import { describe, expect, it } from "vitest";
import { getNovoDocumentTitle } from "../src/lib/documentTitle";

describe("Novo document title", () => {
  it("uses the environment wordmark when no page is selected", () => {
    expect(getNovoDocumentTitle("Novo", null)).toBe("Novo");
    expect(getNovoDocumentTitle("Novo-dev", null)).toBe("Novo-dev");
  });

  it("appends a normalized page title", () => {
    expect(getNovoDocumentTitle("Novo", " Useful commands ")).toBe(
      "Novo | Useful commands",
    );
  });

  it("labels a selected page without a title as untitled", () => {
    expect(getNovoDocumentTitle("Novo-dev", "   ")).toBe("Novo-dev | Untitled");
  });
});
