import { read, utils } from "@e965/xlsx";
import type { WorkBook, WorkSheet } from "@e965/xlsx";

export type SpreadsheetPreviewCell = string | number | boolean | null;

export type SpreadsheetPreview = {
  sheetName: string;
  sheetCount: number;
  rows: SpreadsheetPreviewCell[][];
  rowCount: number;
  columnCount: number;
  previewRowCount: number;
  previewColumnCount: number;
  truncatedRows: boolean;
  truncatedColumns: boolean;
};

const DEFAULT_MAX_ROWS = 20;
const DEFAULT_MAX_COLUMNS = 8;
const HARD_MAX_ROWS = 50;
const HARD_MAX_COLUMNS = 16;

export function createSpreadsheetPreview(input: Buffer | ArrayBuffer, options: { maxRows?: number; maxColumns?: number } = {}): SpreadsheetPreview {
  const maxRows = clampPositiveInteger(options.maxRows, DEFAULT_MAX_ROWS, HARD_MAX_ROWS);
  const maxColumns = clampPositiveInteger(options.maxColumns, DEFAULT_MAX_COLUMNS, HARD_MAX_COLUMNS);
  const workbook = read(input, { type: Buffer.isBuffer(input) ? "buffer" : "array" });
  return workbookToPreview(workbook, maxRows, maxColumns);
}

function workbookToPreview(workbook: WorkBook, maxRows: number, maxColumns: number): SpreadsheetPreview {
  const sheetName = workbook.SheetNames[0] ?? "Sheet1";
  const sheet = workbook.Sheets[sheetName];
  const range = sheet ? usedRange(sheet) : null;
  const rowCount = range ? range.e.r - range.s.r + 1 : 0;
  const columnCount = range ? range.e.c - range.s.c + 1 : 0;
  const previewRowCount = Math.min(rowCount, maxRows);
  const previewColumnCount = Math.min(columnCount, maxColumns);
  const rows = sheet && range
    ? normalizeRows(utils.sheet_to_json(sheet, {
        header: 1,
        defval: "",
        raw: false,
        blankrows: false,
        range: {
          s: range.s,
          e: {
            r: Math.min(range.e.r, range.s.r + maxRows - 1),
            c: Math.min(range.e.c, range.s.c + maxColumns - 1),
          },
        },
      }) as SpreadsheetPreviewCell[][], previewColumnCount)
    : [];

  return {
    sheetName,
    sheetCount: workbook.SheetNames.length,
    rows,
    rowCount,
    columnCount,
    previewRowCount,
    previewColumnCount,
    truncatedRows: rowCount > previewRowCount,
    truncatedColumns: columnCount > previewColumnCount,
  };
}

function usedRange(sheet: WorkSheet) {
  const ref = sheet["!ref"];
  if (!ref) return null;
  try {
    return utils.decode_range(ref);
  } catch {
    return null;
  }
}

function normalizeRows(rows: SpreadsheetPreviewCell[][], columnCount: number) {
  if (!rows.length) return [];
  return rows.map((row) => Array.from({ length: columnCount }, (_, index) => normalizeCell(row[index])));
}

function normalizeCell(value: SpreadsheetPreviewCell | undefined): SpreadsheetPreviewCell {
  if (value === undefined || value === "") return null;
  return value;
}

function clampPositiveInteger(value: number | undefined, fallback: number, max: number) {
  if (!Number.isFinite(value) || !value || value < 1) return fallback;
  return Math.min(Math.floor(value), max);
}
