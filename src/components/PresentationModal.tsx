"use client";

import { Download, Maximize2, Minimize2, MoveDiagonal2, Presentation, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { PresentationPreviewCarousel } from "@/components/PresentationPreviewCarousel";

type InlineAttachmentAttrs = {
  attachmentId: string;
  filename: string;
};

export function PresentationModal({ attachment, onClose }: { attachment: InlineAttachmentAttrs; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dragRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const titleId = useId();
  const downloadUrl = `/api/attachments/${attachment.attachmentId}/download`;

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  function resize(width: number, height: number) {
    const maxWidth = window.innerWidth - 32;
    const maxHeight = window.innerHeight - 32;
    setSize({
      width: Math.min(maxWidth, Math.max(Math.min(400, maxWidth), width)),
      height: Math.min(maxHeight, Math.max(Math.min(320, maxHeight), height)),
    });
  }

  function startResize(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !dialogRef.current) return;
    event.preventDefault();
    event.currentTarget.focus();
    const bounds = dialogRef.current.getBoundingClientRect();
    dragRef.current = { x: event.clientX, y: event.clientY, width: bounds.width, height: bounds.height };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveResize(event: PointerEvent<HTMLButtonElement>) {
    const start = dragRef.current;
    if (!start) return;
    // The dialog stays centered, so each dragged edge moves by half the size change.
    resize(start.width + (event.clientX - start.x) * 2, start.height + (event.clientY - start.y) * 2);
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    if (!event.key.startsWith("Arrow") || !dialogRef.current) return;
    event.preventDefault();
    const bounds = dialogRef.current.getBoundingClientRect();
    const step = event.shiftKey ? 80 : 20;
    resize(
      bounds.width + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0),
      bounds.height + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0),
    );
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={onClose}
      style={{
        width: expanded ? "calc(100vw - 32px)" : size?.width ?? "min(64rem, calc(100vw - 32px))",
        height: expanded ? "calc(100dvh - 32px)" : size?.height ?? "86dvh",
      }}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-32px)] max-w-[calc(100vw-32px)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden border border-neutral-700 bg-neutral-900 p-0 text-white shadow-2xl open:grid backdrop:bg-black/70"
    >
      <header className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Presentation className="shrink-0 text-neutral-300" size={22} />
          <h2 id={titleId} className="truncate text-lg font-semibold">{attachment.filename}</h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={() => setExpanded((value) => !value)} className="grid size-8 place-items-center border border-white/20 text-neutral-200 hover:bg-white/10" title={expanded ? "Restore size" : "Expand viewer"} aria-label={expanded ? "Restore size" : "Expand viewer"}>
            {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button type="button" onClick={onClose} className="grid size-8 place-items-center border border-white/20 text-neutral-200 hover:bg-white/10" title="Close" aria-label="Close presentation"><X size={16} /></button>
        </div>
      </header>
      <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden bg-neutral-100 text-neutral-900">
        <PresentationPreviewCarousel attachmentId={attachment.attachmentId} filename={attachment.filename} large />
        <div className="relative flex justify-end border-t border-neutral-300 bg-white p-3 pr-12">
          <a href={downloadUrl} className="inline-flex h-9 items-center gap-2 border border-neutral-300 px-3 text-sm font-medium text-neutral-800 hover:bg-neutral-100"><Download size={15} />Download</a>
          {!expanded ? (
            <button
              type="button"
              onPointerDown={startResize}
              onPointerMove={moveResize}
              onPointerUp={(event) => {
                dragRef.current = null;
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerCancel={() => { dragRef.current = null; }}
              onLostPointerCapture={() => { dragRef.current = null; }}
              onKeyDown={resizeWithKeyboard}
              style={{ cursor: "nwse-resize" }}
              className="absolute bottom-0 right-0 grid size-9 touch-none select-none place-items-center text-neutral-500 hover:text-neutral-900 focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-neutral-600"
              title="Drag to resize, or use arrow keys"
              aria-label="Resize presentation viewer"
            ><MoveDiagonal2 size={18} /></button>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}
