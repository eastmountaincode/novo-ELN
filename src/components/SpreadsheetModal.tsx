"use client";

import { HotTable, type HotTableRef } from "@handsontable/react-wrapper";
import Handsontable from "handsontable";
import { Download, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { registerAllModules } from "handsontable/registry";
import type { SpreadsheetPreview, SpreadsheetPreviewCell } from "@/lib/spreadsheetPreview";

registerAllModules();

type InlineAttachmentAttrs = {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt?: string;
  updatedAt?: string;
};

const VIEWER_MAX_ROWS = 1000;
const VIEWER_MAX_COLUMNS = 100;

export function SpreadsheetModal({ attachment, onClose }: { attachment: InlineAttachmentAttrs; onClose: () => void; onSaved?: (attachment: InlineAttachmentAttrs) => void }) {
  const tableRef = useRef<HotTableRef>(null);
  const tableHostRef = useRef<HTMLDivElement>(null);
  const downloadUrl = `/api/attachments/${attachment.attachmentId}/download`;
  const [preview, setPreview] = useState<SpreadsheetPreview | null>(null);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [tableHeight, setTableHeight] = useState(520);
  const [status, setStatus] = useState("Loading spreadsheet");

  const data = useMemo(() => {
    if (!preview) return [];
    return preview.rows.map((row) => row.map((cell) => cell.value ?? ""));
  }, [preview]);

  useEffect(() => {
    let active = true;
    async function load() {
      setStatus("Loading spreadsheet");
      try {
        const response = await fetch(`/api/attachments/${attachment.attachmentId}/preview/spreadsheet?rows=${VIEWER_MAX_ROWS}&columns=${VIEWER_MAX_COLUMNS}&sheet=${activeSheetIndex}`, { cache: "no-store" });
        const body = (await response.json().catch(() => null)) as { preview?: SpreadsheetPreview; error?: string } | null;
        if (!response.ok || !body?.preview) throw new Error(body?.error || `Preview failed (${response.status})`);
        if (active) {
          setPreview(body.preview);
          setStatus("");
        }
      } catch (error) {
        if (active) {
          setPreview(null);
          setStatus(error instanceof Error ? error.message : "Could not load spreadsheet");
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [activeSheetIndex, attachment.attachmentId]);

  useEffect(() => {
    if (!preview) return;
    const timer = window.setTimeout(() => {
      tableRef.current?.hotInstance?.render();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [preview]);

  useEffect(() => {
    const element = tableHostRef.current;
    if (!element) return;
    const host = element;
    function updateHeight() {
      setTableHeight(Math.max(260, Math.floor(host.getBoundingClientRect().height)));
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

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-5">
      <div className="flex h-[86vh] w-full max-w-7xl flex-col border border-white/10 bg-slate-900 shadow-2xl shadow-slate-950/50">
        <header className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3 text-white">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{attachment.filename}</h2>
            <p className="mt-1 text-xs text-slate-400">Spreadsheet viewer. Download the original file to edit it.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {status ? <span className="text-xs text-slate-400">{status}</span> : null}
            <a href={downloadUrl} className="inline-flex h-8 items-center gap-1 border border-white/10 px-2 text-sm text-slate-200 hover:bg-white/10"><Download size={14} />Download</a>
            <button onClick={onClose} className="grid size-8 place-items-center border border-white/10 text-slate-200 hover:bg-white/10" title="Close"><X size={16} /></button>
          </div>
        </header>
        {preview && preview.sheetNames.length > 1 ? (
          <div className="flex gap-1 overflow-x-auto border-b border-white/10 bg-slate-950 px-3 py-2">
            {preview.sheetNames.map((name, index) => (
              <button
                key={`${name}-${index}`}
                onClick={() => setActiveSheetIndex(index)}
                className={`h-8 shrink-0 border px-3 text-sm ${index === activeSheetIndex ? "border-cyan-400 bg-cyan-500 text-slate-950" : "border-white/10 text-slate-300 hover:bg-white/10"}`}
              >
                {name}
              </button>
            ))}
          </div>
        ) : null}
        {preview ? (
          <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-slate-950 px-4 py-2 text-xs text-slate-400">
            <span className="min-w-0 truncate">{preview.sheetName}</span>
            <span className="shrink-0 tabular-nums">
              {preview.rowCount.toLocaleString()} rows x {preview.columnCount.toLocaleString()} columns
              {preview.truncatedRows || preview.truncatedColumns ? ` · showing ${preview.previewRowCount} x ${preview.previewColumnCount}` : ""}
            </span>
          </div>
        ) : null}
        <div ref={tableHostRef} className="min-h-0 flex-1 overflow-hidden bg-white p-3">
          {preview ? (
            <HotTable
              key={`${attachment.attachmentId}-${activeSheetIndex}`}
              ref={tableRef}
              data={data}
              rowHeaders={true}
              colHeaders={true}
              width="100%"
              height={tableHeight - 24}
              stretchH="none"
              readOnly={true}
              mergeCells={preview.mergeCells}
              colWidths={preview.columnWidths}
              rowHeights={preview.rowHeights}
              manualColumnResize={true}
              manualRowResize={true}
              copyPaste={true}
              contextMenu={false}
              licenseKey="non-commercial-and-evaluation"
              className="ht-theme-main"
              cells={(row, column) => ({ renderer: spreadsheetCellRenderer(preview.rows[row]?.[column]) })}
            />
          ) : (
            <div className="grid h-full place-items-center text-sm text-slate-500">{status}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function spreadsheetCellRenderer(cell: SpreadsheetPreviewCell | undefined) {
  return function renderCell(instance: Handsontable.Core, td: HTMLTableCellElement, row: number, col: number, prop: string | number, value: unknown, cellProperties: Handsontable.CellProperties) {
    Handsontable.renderers.TextRenderer(instance, td, row, col, prop, value, cellProperties);
    setCellStyle(td, "background-color", cell?.backgroundColor);
    setCellStyle(td, "color", cell?.color);
    setCellStyle(td, "font-weight", cell?.bold ? "700" : undefined);
    setCellStyle(td, "font-style", cell?.italic ? "italic" : undefined);
    setCellStyle(td, "text-align", cell?.horizontalAlign);
    setCellStyle(td, "vertical-align", cell?.verticalAlign);
    setCellStyle(td, "white-space", cell?.wrapText ? "pre-wrap" : "nowrap");
  };
}

function setCellStyle(td: HTMLTableCellElement, property: string, value: string | undefined) {
  if (value) td.style.setProperty(property, value, "important");
  else td.style.removeProperty(property);
}
