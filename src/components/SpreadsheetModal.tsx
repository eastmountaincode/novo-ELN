"use client";

import { HotTable, type HotTableRef } from "@handsontable/react-wrapper";
import { read, utils, write } from "@e965/xlsx";
import { Download, Save, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { registerAllModules } from "handsontable/registry";
import type { CellValue } from "handsontable/common";
import type { WorkBook } from "@e965/xlsx";

registerAllModules();

type InlineAttachmentAttrs = {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt?: string;
  updatedAt?: string;
};

type Cell = string | number | boolean | null;
type SheetsByName = Record<string, Cell[][]>;

export function SpreadsheetModal({ attachment, onClose, onSaved }: { attachment: InlineAttachmentAttrs; onClose: () => void; onSaved: (attachment: InlineAttachmentAttrs) => void }) {
  const tableRef = useRef<HotTableRef>(null);
  const tableHostRef = useRef<HTMLDivElement>(null);
  const downloadUrl = `/api/attachments/${attachment.attachmentId}/download`;
  const [sheets, setSheets] = useState<SheetsByName>({});
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheetName, setActiveSheetName] = useState("");
  const [tableHeight, setTableHeight] = useState(520);
  const [status, setStatus] = useState("Loading spreadsheet");
  const cells = useMemo(() => activeSheetName ? sheets[activeSheetName] ?? [[""]] : [], [activeSheetName, sheets]);
  const columns = useMemo(() => Math.max(8, ...cells.map((row) => row.length), 0), [cells]);
  const rows = useMemo(() => normalizeGrid(cells, columns), [cells, columns]);

  useEffect(() => {
    let active = true;
    async function load() {
      setStatus("Loading spreadsheet");
      try {
        const response = await fetch(downloadUrl, { cache: "no-store" });
        if (!response.ok) throw new Error(`Download failed (${response.status})`);
        const buffer = await response.arrayBuffer();
        const workbook = read(buffer, { type: "array" });
        const names = workbook.SheetNames.length ? workbook.SheetNames : ["Sheet1"];
        const nextSheets = Object.fromEntries(
          names.map((name) => [name, sheetToCells(workbook, name)]),
        );
        if (active) {
          setSheetNames(names);
          setSheets(nextSheets);
          setActiveSheetName(names[0]);
          setStatus("");
        }
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Could not load spreadsheet");
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [downloadUrl]);

  useEffect(() => {
    if (!cells.length) return;
    const timer = window.setTimeout(() => {
      tableRef.current?.hotInstance?.render();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [cells]);

  useEffect(() => {
    const element = tableHostRef.current;
    if (!element) return;
    const host = element;
    function updateHeight() {
      setTableHeight(Math.max(240, Math.floor(host.getBoundingClientRect().height)));
      window.setTimeout(() => tableRef.current?.hotInstance?.render(), 0);
    }
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(host);
    window.addEventListener("resize", updateHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, []);

  function currentTableData() {
    const hot = tableRef.current?.hotInstance;
    return trimTrailingEmptyRowsAndColumns((hot?.getData() ?? rows) as CellValue[][]) as Cell[][];
  }

  function persistActiveSheet() {
    if (!activeSheetName) return sheets;
    const data = currentTableData();
    const nextSheets = { ...sheets, [activeSheetName]: data };
    setSheets(nextSheets);
    return nextSheets;
  }

  function selectSheet(name: string) {
    if (name === activeSheetName) return;
    persistActiveSheet();
    setActiveSheetName(name);
  }

  async function save() {
    setStatus("Saving");
    try {
      const nextSheets = persistActiveSheet();
      const file = spreadsheetFileFromSheets(nextSheets, sheetNames, attachment.filename, attachment.mimeType);
      const form = new FormData();
      form.set("file", file);
      const response = await fetch(`/api/attachments/${attachment.attachmentId}`, { method: "PUT", body: form });
      if (!response.ok) throw new Error(`Save failed (${response.status})`);
      const body = (await response.json()) as { attachment?: { id: string; originalName: string; mimeType: string; size: number; createdAt: string; updatedAt: string } };
      const updatedAttachment = body.attachment
        ? {
            attachmentId: body.attachment.id,
            filename: body.attachment.originalName,
            mimeType: body.attachment.mimeType,
            size: body.attachment.size,
            createdAt: body.attachment.createdAt,
            updatedAt: body.attachment.updatedAt,
          }
        : { ...attachment, updatedAt: new Date().toISOString() };
      setStatus("Saved");
      onSaved(updatedAttachment);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save spreadsheet");
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-5">
      <div className="flex h-[84vh] w-full max-w-7xl flex-col border border-white/10 bg-slate-900 shadow-2xl shadow-slate-950/50">
        <header className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3 text-white">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{attachment.filename}</h2>
            <p className="mt-1 text-xs text-slate-400">Spreadsheet editor. Right-click cells or headers for row and column actions.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {status ? <span className="text-xs text-slate-400">{status}</span> : null}
            <a href={downloadUrl} className="inline-flex h-8 items-center gap-1 border border-white/10 px-2 text-sm text-slate-200 hover:bg-white/10"><Download size={14} />Download</a>
            <button onClick={() => void save()} className="inline-flex h-8 items-center gap-1 bg-cyan-500 px-2 text-sm font-medium text-slate-950 hover:bg-cyan-400"><Save size={14} />Save</button>
            <button onClick={onClose} className="grid size-8 place-items-center border border-white/10 text-slate-200 hover:bg-white/10" title="Close"><X size={16} /></button>
          </div>
        </header>
        {sheetNames.length > 1 ? (
          <div className="flex gap-1 overflow-x-auto border-b border-white/10 bg-slate-950 px-3 py-2">
            {sheetNames.map((name) => (
              <button
                key={name}
                onClick={() => selectSheet(name)}
                className={`h-8 shrink-0 border px-3 text-sm ${name === activeSheetName ? "border-cyan-400 bg-cyan-500 text-slate-950" : "border-white/10 text-slate-300 hover:bg-white/10"}`}
              >
                {name}
              </button>
            ))}
          </div>
        ) : null}
        <div ref={tableHostRef} className="min-h-0 flex-1 overflow-hidden bg-white p-3">
          {cells.length ? (
            <HotTable
              key={activeSheetName}
              ref={tableRef}
              data={rows}
              rowHeaders={true}
              colHeaders={true}
              width="100%"
              height={tableHeight - 24}
              stretchH="none"
              fixedRowsTop={0}
              fixedColumnsStart={0}
              manualColumnResize={true}
              manualRowResize={true}
              contextMenu={true}
              copyPaste={true}
              undo={true}
              licenseKey="non-commercial-and-evaluation"
              className="ht-theme-main"
            />
          ) : (
            <div className="grid h-full place-items-center text-sm text-slate-500">{status}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function normalizeGrid(data: Cell[][], columns: number) {
  const rows = data.length ? data : [[""]];
  return rows.map((row) => Array.from({ length: columns }, (_, index) => row[index] ?? ""));
}

function sheetToCells(workbook: WorkBook, sheetName: string) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [[""]];
  const data = utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true, blankrows: true }) as Cell[][];
  return data.length ? data : [[""]];
}

function trimTrailingEmptyRowsAndColumns(data: CellValue[][]) {
  let lastRow = data.length - 1;
  while (lastRow > 0 && data[lastRow].every(isEmptyCell)) lastRow -= 1;

  let lastColumn = Math.max(0, ...data.slice(0, lastRow + 1).map((row) => row.length - 1));
  while (lastColumn > 0 && data.slice(0, lastRow + 1).every((row) => isEmptyCell(row[lastColumn]))) lastColumn -= 1;

  return data.slice(0, lastRow + 1).map((row) => row.slice(0, lastColumn + 1));
}

function isEmptyCell(value: CellValue) {
  return value === null || value === undefined || value === "";
}

function extensionForName(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "xlsx";
}

function bookTypeForName(name: string) {
  const ext = extensionForName(name);
  if (["csv", "xls", "xlsx", "xlsb", "ods"].includes(ext)) return ext as never;
  return "xlsx" as never;
}

function spreadsheetFileFromSheets(sheets: SheetsByName, sheetNames: string[], name: string, fallbackMimeType: string) {
  const ext = extensionForName(name);
  const firstSheetName = sheetNames[0] ?? "Sheet1";
  const firstSheet = sheets[firstSheetName] ?? [[""]];
  if (ext === "tsv") {
    const text = firstSheet.map((row) => row.map(formatDelimitedCell).join("\t")).join("\n");
    return new File([text], name, { type: fallbackMimeType || mimeForName(name) });
  }
  if (ext === "csv") {
    const text = firstSheet.map((row) => row.map(formatCsvCell).join(",")).join("\n");
    return new File([text], name, { type: fallbackMimeType || mimeForName(name) });
  }

  const workbook = utils.book_new();
  for (const sheetName of sheetNames.length ? sheetNames : ["Sheet1"]) {
    const worksheet = utils.aoa_to_sheet(sheets[sheetName] ?? [[""]]);
    utils.book_append_sheet(workbook, worksheet, sheetName);
  }
  const bytes = write(workbook, { bookType: bookTypeForName(name), type: "array" }) as ArrayBuffer;
  return new File([bytes], name, { type: fallbackMimeType || mimeForName(name) });
}

function formatDelimitedCell(value: CellValue) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[\t\n\r"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function formatCsvCell(value: CellValue) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[,\n\r"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function mimeForName(name: string) {
  const ext = extensionForName(name);
  if (ext === "csv") return "text/csv";
  if (ext === "tsv") return "text/tab-separated-values";
  if (ext === "xls") return "application/vnd.ms-excel";
  if (ext === "ods") return "application/vnd.oasis.opendocument.spreadsheet";
  return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}
