import { describe, expect, it } from "vitest";
import { utils, write } from "@e965/xlsx";
import { createSpreadsheetPreview } from "../src/lib/spreadsheetPreview";

describe("createSpreadsheetPreview", () => {
  it("returns a bounded read-only preview of the first sheet", async () => {
    const workbook = utils.book_new();
    const worksheet = utils.aoa_to_sheet([
      ["Sample", "Value", "Notes"],
      ["A", 12.5, "first"],
      ["B", 20, "second"],
      ["C", 33, "third"],
    ]);
    utils.book_append_sheet(workbook, worksheet, "Qubit");
    const bytes = write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const preview = await createSpreadsheetPreview(bytes, { maxRows: 3, maxColumns: 2 });

    expect(preview.sheetName).toBe("Qubit");
    expect(preview.sheetCount).toBe(1);
    expect(preview.rowCount).toBe(4);
    expect(preview.columnCount).toBe(3);
    expect(preview.previewRowCount).toBe(3);
    expect(preview.previewColumnCount).toBe(2);
    expect(preview.truncatedRows).toBe(true);
    expect(preview.truncatedColumns).toBe(true);
    expect(preview.rows.map((row) => row.map((cell) => cell.value))).toEqual([
      ["Sample", "Value"],
      ["A", "12.5"],
      ["B", "20"],
    ]);
  });

  it("caps requested preview dimensions", async () => {
    const bytes = Buffer.from(
      Array.from({ length: 1005 }, (_, row) => (
        Array.from({ length: 105 }, (_cell, column) => `${row}:${column}`).join(",")
      )).join("\n"),
    );

    const preview = await createSpreadsheetPreview(bytes, {
      maxRows: 5000,
      maxColumns: 5000,
      filename: "large.csv",
    });

    expect(preview.rowCount).toBe(1005);
    expect(preview.columnCount).toBe(105);
    expect(preview.previewRowCount).toBe(1000);
    expect(preview.previewColumnCount).toBe(100);
    expect(preview.rows).toHaveLength(1000);
    expect(preview.rows[0]).toHaveLength(100);
    expect(preview.truncatedRows).toBe(true);
    expect(preview.truncatedColumns).toBe(true);
  });
});
