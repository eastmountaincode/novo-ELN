import { describe, expect, it } from "vitest";
import { utils, write } from "@e965/xlsx";
import { createSpreadsheetPreview } from "../src/lib/spreadsheetPreview";

describe("createSpreadsheetPreview", () => {
  it("returns a bounded read-only preview of the first sheet", () => {
    const workbook = utils.book_new();
    const worksheet = utils.aoa_to_sheet([
      ["Sample", "Value", "Notes"],
      ["A", 12.5, "first"],
      ["B", 20, "second"],
      ["C", 33, "third"],
    ]);
    utils.book_append_sheet(workbook, worksheet, "Qubit");
    const bytes = write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const preview = createSpreadsheetPreview(bytes, { maxRows: 3, maxColumns: 2 });

    expect(preview.sheetName).toBe("Qubit");
    expect(preview.sheetCount).toBe(1);
    expect(preview.rowCount).toBe(4);
    expect(preview.columnCount).toBe(3);
    expect(preview.previewRowCount).toBe(3);
    expect(preview.previewColumnCount).toBe(2);
    expect(preview.truncatedRows).toBe(true);
    expect(preview.truncatedColumns).toBe(true);
    expect(preview.rows).toEqual([
      ["Sample", "Value"],
      ["A", "12.5"],
      ["B", "20"],
    ]);
  });

  it("caps requested preview dimensions", () => {
    const workbook = utils.book_new();
    const worksheet = utils.aoa_to_sheet(Array.from({ length: 60 }, (_, row) => (
      Array.from({ length: 20 }, (_cell, column) => `${row}:${column}`)
    )));
    utils.book_append_sheet(workbook, worksheet, "Large");
    const bytes = write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const preview = createSpreadsheetPreview(bytes, { maxRows: 500, maxColumns: 500 });

    expect(preview.previewRowCount).toBe(50);
    expect(preview.previewColumnCount).toBe(16);
    expect(preview.rows).toHaveLength(50);
    expect(preview.rows[0]).toHaveLength(16);
  });
});
