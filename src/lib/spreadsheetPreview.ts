import ExcelJS from "exceljs";

export type SpreadsheetPreviewCellValue = string | number | boolean | null;

export type SpreadsheetPreviewCell = {
  value: SpreadsheetPreviewCellValue;
  backgroundColor?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  horizontalAlign?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  wrapText?: boolean;
  colSpan?: number;
  rowSpan?: number;
  hidden?: boolean;
};

export type SpreadsheetPreview = {
  sheetName: string;
  sheetNames: string[];
  sheetIndex: number;
  sheetCount: number;
  rows: SpreadsheetPreviewCell[][];
  columnWidths: number[];
  rowHeights: Array<number | undefined>;
  mergeCells: Array<{ row: number; col: number; rowspan: number; colspan: number }>;
  rowCount: number;
  columnCount: number;
  previewRowCount: number;
  previewColumnCount: number;
  truncatedRows: boolean;
  truncatedColumns: boolean;
};

const DEFAULT_MAX_ROWS = 20;
const DEFAULT_MAX_COLUMNS = 8;
const HARD_MAX_ROWS = 1000;
const HARD_MAX_COLUMNS = 100;

export async function createSpreadsheetPreview(
  input: Buffer | ArrayBuffer,
  options: { maxRows?: number; maxColumns?: number; sheetIndex?: number; filename?: string; mimeType?: string } = {},
): Promise<SpreadsheetPreview> {
  const maxRows = clampPositiveInteger(options.maxRows, DEFAULT_MAX_ROWS, HARD_MAX_ROWS);
  const maxColumns = clampPositiveInteger(options.maxColumns, DEFAULT_MAX_COLUMNS, HARD_MAX_COLUMNS);
  const delimitedFormat = inferDelimitedFormat(options.filename, options.mimeType);
  if (delimitedFormat) {
    return delimitedToPreview(toBuffer(input), delimitedFormat, maxRows, maxColumns);
  }

  const workbook = new ExcelJS.Workbook();
  const bytes = toBuffer(input) as unknown as Parameters<typeof workbook.xlsx.load>[0];
  await workbook.xlsx.load(bytes);
  return workbookToPreview(workbook, maxRows, maxColumns, options.sheetIndex ?? 0);
}

function inferDelimitedFormat(filename?: string, mimeType?: string): "csv" | "tsv" | null {
  const lowerName = filename?.toLowerCase() ?? "";
  const lowerMime = mimeType?.toLowerCase() ?? "";
  if (lowerName.endsWith(".tsv") || lowerMime.includes("tab-separated-values")) return "tsv";
  if (lowerName.endsWith(".csv") || lowerMime === "text/csv") return "csv";
  return null;
}

function delimitedToPreview(input: Buffer, format: "csv" | "tsv", maxRows: number, maxColumns: number): SpreadsheetPreview {
  const delimiter = format === "tsv" ? "\t" : ",";
  const text = input.toString("utf8").replace(/^\uFEFF/, "");
  const parsedRows = parseDelimitedRows(text, delimiter);
  const rowCount = parsedRows.length;
  const columnCount = parsedRows.reduce((max, row) => Math.max(max, row.length), 0);
  const previewRowCount = Math.min(rowCount, maxRows);
  const previewColumnCount = Math.min(columnCount, maxColumns);
  const rows = parsedRows.slice(0, previewRowCount).map((row) => (
    Array.from({ length: previewColumnCount }, (_, columnIndex) => ({
      value: row[columnIndex] ?? null,
    }))
  ));

  return {
    sheetName: "Sheet1",
    sheetNames: ["Sheet1"],
    sheetIndex: 0,
    sheetCount: 1,
    rows,
    columnWidths: delimitedColumnWidths(rows, previewColumnCount),
    rowHeights: Array.from({ length: previewRowCount }, () => undefined),
    mergeCells: [],
    rowCount,
    columnCount,
    previewRowCount,
    previewColumnCount,
    truncatedRows: rowCount > previewRowCount,
    truncatedColumns: columnCount > previewColumnCount,
  };
}

function parseDelimitedRows(text: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        cell += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      if (char === "\r" && next === "\n") index += 1;
      continue;
    }

    cell += char;
  }

  if (cell || row.length || !text.endsWith("\n")) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function delimitedColumnWidths(rows: SpreadsheetPreviewCell[][], columnCount: number) {
  return Array.from({ length: columnCount }, (_, columnIndex) => {
    const maxLength = rows.reduce((max, row) => Math.max(max, String(row[columnIndex]?.value ?? "").length), 0);
    return Math.max(72, Math.min(360, maxLength * 8 + 24));
  });
}

function workbookToPreview(workbook: ExcelJS.Workbook, maxRows: number, maxColumns: number, requestedSheetIndex: number): SpreadsheetPreview {
  const worksheets = workbook.worksheets;
  const sheetIndex = Math.max(0, Math.min(Math.floor(requestedSheetIndex), Math.max(worksheets.length - 1, 0)));
  const worksheet = worksheets[sheetIndex];
  const sheetNames = worksheets.map((sheet) => sheet.name);
  const rowCount = worksheet?.rowCount ?? 0;
  const columnCount = worksheet?.columnCount ?? 0;
  const previewRowCount = Math.min(rowCount, maxRows);
  const previewColumnCount = Math.min(columnCount, maxColumns);
  const mergeInfo = worksheet ? buildMergeInfo(worksheet, previewRowCount, previewColumnCount) : { mergeMap: new Map<string, MergeCellInfo>(), mergeCells: [] };
  const rows = worksheet ? sheetToPreviewRows(worksheet, previewRowCount, previewColumnCount, mergeInfo.mergeMap) : [];

  return {
    sheetName: worksheet?.name ?? "Sheet1",
    sheetNames,
    sheetIndex,
    sheetCount: worksheets.length,
    rows,
    columnWidths: worksheet ? columnWidths(worksheet, previewColumnCount) : [],
    rowHeights: worksheet ? rowHeights(worksheet, previewRowCount) : [],
    mergeCells: mergeInfo.mergeCells,
    rowCount,
    columnCount,
    previewRowCount,
    previewColumnCount,
    truncatedRows: rowCount > previewRowCount,
    truncatedColumns: columnCount > previewColumnCount,
  };
}

type MergeCellInfo = { colSpan?: number; rowSpan?: number; hidden?: boolean };

function sheetToPreviewRows(worksheet: ExcelJS.Worksheet, rowCount: number, columnCount: number, mergeMap: Map<string, MergeCellInfo>) {
  return Array.from({ length: rowCount }, (_, rowIndex) => (
    Array.from({ length: columnCount }, (_, columnIndex) => {
      const rowNumber = rowIndex + 1;
      const columnNumber = columnIndex + 1;
      const cell = worksheet.getCell(rowNumber, columnNumber);
      const merge = mergeMap.get(cellKey(rowNumber, columnNumber));
      return {
        value: formattedCellValue(cell),
        backgroundColor: cellBackgroundColor(cell),
        color: fontColor(cell),
        bold: cell.font?.bold,
        italic: cell.font?.italic,
        horizontalAlign: normalizeHorizontalAlign(cell.alignment?.horizontal),
        verticalAlign: normalizeVerticalAlign(cell.alignment?.vertical),
        wrapText: cell.alignment?.wrapText,
        colSpan: merge?.colSpan,
        rowSpan: merge?.rowSpan,
        hidden: merge?.hidden,
      } satisfies SpreadsheetPreviewCell;
    })
  ));
}

function buildMergeInfo(worksheet: ExcelJS.Worksheet, rowCount: number, columnCount: number) {
  const mergeMap = new Map<string, MergeCellInfo>();
  const mergeCells: Array<{ row: number; col: number; rowspan: number; colspan: number }> = [];
  const merges = Array.isArray(worksheet.model.merges) ? worksheet.model.merges : [];

  for (const mergeAddress of merges) {
    const range = decodeExcelRange(mergeAddress);
    if (!range) continue;
    const startRow = Math.max(range.startRow, 1);
    const startColumn = Math.max(range.startColumn, 1);
    const endRow = Math.min(range.endRow, rowCount);
    const endColumn = Math.min(range.endColumn, columnCount);
    if (startRow > endRow || startColumn > endColumn) continue;

    const rowSpan = endRow - startRow + 1;
    const colSpan = endColumn - startColumn + 1;
    mergeMap.set(cellKey(startRow, startColumn), { rowSpan, colSpan });
    mergeCells.push({ row: startRow - 1, col: startColumn - 1, rowspan: rowSpan, colspan: colSpan });

    for (let row = startRow; row <= endRow; row += 1) {
      for (let column = startColumn; column <= endColumn; column += 1) {
        if (row === startRow && column === startColumn) continue;
        mergeMap.set(cellKey(row, column), { hidden: true });
      }
    }
  }

  return { mergeMap, mergeCells };
}

function formattedCellValue(cell: ExcelJS.Cell): SpreadsheetPreviewCellValue {
  const value = cell.value;
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return formatDate(value);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return cell.text || value;
  if (isFormulaValue(value)) {
    const result = scalarValue(value.result);
    const formula = scalarValue(value.formula);
    return cell.text || (result ?? formula ?? null);
  }
  if (isRichTextValue(value)) return value.richText.map((part) => part.text).join("");
  if (isHyperlinkValue(value)) return value.text ?? value.hyperlink ?? null;
  return cell.text || null;
}

function scalarValue(value: unknown): SpreadsheetPreviewCellValue {
  if (value instanceof Date) return formatDate(value);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return null;
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", { month: "numeric", day: "numeric", year: "2-digit" }).format(value);
}

function cellBackgroundColor(cell: ExcelJS.Cell) {
  const fill = cell.fill;
  if (!fill || fill.type !== "pattern") return undefined;
  return colorToCss(fill.fgColor) ?? colorToCss(fill.bgColor);
}

function fontColor(cell: ExcelJS.Cell) {
  return colorToCss(cell.font?.color);
}

function colorToCss(color: Partial<ExcelJS.Color> | undefined) {
  const argb = color?.argb;
  if (!argb || argb === "00000000" || argb === "FFFFFFFF") return undefined;
  return `#${argb.slice(-6)}`;
}

function columnWidths(worksheet: ExcelJS.Worksheet, columnCount: number) {
  return Array.from({ length: columnCount }, (_, index) => {
    const width = worksheet.getColumn(index + 1).width;
    if (!width || !Number.isFinite(width)) return 96;
    return Math.max(48, Math.min(360, Math.round(width * 8)));
  });
}

function rowHeights(worksheet: ExcelJS.Worksheet, rowCount: number): Array<number | undefined> {
  return Array.from({ length: rowCount }, (_, index) => {
    const height = worksheet.getRow(index + 1).height;
    if (!height || !Number.isFinite(height)) return undefined;
    return Math.max(22, Math.min(160, Math.round(height * 1.35)));
  });
}

function normalizeHorizontalAlign(value: ExcelJS.Alignment["horizontal"] | undefined): SpreadsheetPreviewCell["horizontalAlign"] {
  if (value === "center" || value === "right" || value === "left") return value;
  return undefined;
}

function normalizeVerticalAlign(value: ExcelJS.Alignment["vertical"] | undefined): SpreadsheetPreviewCell["verticalAlign"] {
  if (value === "top" || value === "middle" || value === "bottom") return value;
  return undefined;
}

function decodeExcelRange(range: string) {
  const [start, end] = range.split(":");
  const startCell = decodeExcelCell(start);
  const endCell = decodeExcelCell(end ?? start);
  if (!startCell || !endCell) return null;
  return {
    startRow: startCell.row,
    startColumn: startCell.column,
    endRow: endCell.row,
    endColumn: endCell.column,
  };
}

function decodeExcelCell(cell: string | undefined) {
  const match = cell?.match(/^([A-Z]+)(\d+)$/i);
  if (!match) return null;
  return {
    column: columnNameToNumber(match[1]),
    row: Number(match[2]),
  };
}

function columnNameToNumber(name: string) {
  return name.toUpperCase().split("").reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0);
}

function toBuffer(input: Buffer | ArrayBuffer) {
  return Buffer.isBuffer(input) ? input : Buffer.from(input);
}

function isFormulaValue(value: ExcelJS.CellValue): value is ExcelJS.CellFormulaValue {
  return typeof value === "object" && value !== null && "formula" in value;
}

function isRichTextValue(value: ExcelJS.CellValue): value is ExcelJS.CellRichTextValue {
  return typeof value === "object" && value !== null && "richText" in value && Array.isArray(value.richText);
}

function isHyperlinkValue(value: ExcelJS.CellValue): value is ExcelJS.CellHyperlinkValue {
  return typeof value === "object" && value !== null && "hyperlink" in value;
}

function cellKey(row: number, column: number) {
  return `${row}:${column}`;
}

function clampPositiveInteger(value: number | undefined, fallback: number, max: number) {
  if (!Number.isFinite(value) || !value || value < 1) return fallback;
  return Math.min(Math.floor(value), max);
}
