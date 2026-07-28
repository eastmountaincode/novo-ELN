import {
  Beaker,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  GripVertical,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Plus,
  SlidersHorizontal,
  TextCursorInput,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  INLINE_ATTACHMENT_DRAG_TYPE,
  attachmentToInlineAttrs,
} from "@/components/RichTextEditor";
import { writeStoredSortKey } from "@/lib/clientSorting";
import { formatBytes } from "@/lib/formatBytes";
import type { Attachment, BlockType, PageEntry } from "@/lib/types";
import {
  ATTACHMENT_SORT_OPTIONS,
  ATTACHMENT_SORT_STORAGE_KEY,
  readStoredAttachmentSortKey,
  sortAttachments,
  type AttachmentSortKey,
} from "./attachmentSorting";
import type { PendingAttachmentUpload } from "./usePageAttachments";

const blockIcons: Record<BlockType, typeof ImageIcon> = {
  image: ImageIcon,
  sheet: FileSpreadsheet,
  pdf: FileText,
  slides: FileArchive,
  sequence: Beaker,
  file: FileImage,
};

type PageAttachmentsPanelProps = {
  page: PageEntry;
  pageLoading: boolean;
  canEdit: boolean;
  inlineAttachmentIds: ReadonlySet<string>;
  pendingUploads: PendingAttachmentUpload[];
  uploadAttachments: (files: FileList | File[] | undefined) => Promise<void>;
  deleteAttachment: (attachment: Attachment) => Promise<boolean>;
};

export function PageAttachmentsPanel({
  page,
  pageLoading,
  canEdit,
  inlineAttachmentIds,
  pendingUploads,
  uploadAttachments,
  deleteAttachment,
}: PageAttachmentsPanelProps) {
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [sortKey, setSortKey] = useState<AttachmentSortKey>(readStoredAttachmentSortKey);
  const [sortOptionsOpen, setSortOptionsOpen] = useState(false);
  const dragDepthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sortOptionsRef = useRef<HTMLDivElement>(null);
  const attachmentCount = page.attachmentCount ?? page.attachments.length;
  const attachmentLabel = `${attachmentCount} file${attachmentCount === 1 ? "" : "s"}`;
  const sortedAttachments = useMemo(
    () => sortAttachments(page.attachments, sortKey),
    [page.attachments, sortKey],
  );

  useEffect(() => {
    writeStoredSortKey(ATTACHMENT_SORT_STORAGE_KEY, sortKey);
  }, [sortKey]);

  useEffect(() => {
    if (!sortOptionsOpen) return;

    function isInsideSortOptions(target: EventTarget | null) {
      return target instanceof Element && Boolean(sortOptionsRef.current?.contains(target));
    }

    function closeSortOptions() {
      setSortOptionsOpen(false);
    }

    function onPointerDown(event: PointerEvent) {
      if (!isInsideSortOptions(event.target)) closeSortOptions();
    }

    function onFocusIn(event: FocusEvent) {
      if (!isInsideSortOptions(event.target)) closeSortOptions();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeSortOptions();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [sortOptionsOpen]);

  function hasDraggedFiles(event: React.DragEvent<HTMLElement>) {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  function resetDrag() {
    dragDepthRef.current = 0;
    setDragging(false);
  }

  function handleDragEnter(event: React.DragEvent<HTMLDivElement>) {
    if (!canEdit || !open || pageLoading || !hasDraggedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    setDragging(true);
  }

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    if (!canEdit || !open || pageLoading || !hasDraggedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setDragging(true);
  }

  function handleDragLeave(event: React.DragEvent<HTMLDivElement>) {
    if (!canEdit || !open || pageLoading || !hasDraggedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragging(false);
  }

  async function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    if (!canEdit || !open || pageLoading || !hasDraggedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const files = Array.from(event.dataTransfer.files);
    resetDrag();
    await uploadAttachments(files);
  }

  return (
    <div className="mt-4 border border-slate-200 bg-slate-50 p-2">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          void uploadAttachments(event.target.files ?? undefined);
          event.currentTarget.value = "";
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-800 hover:text-slate-950"
          aria-expanded={open}
        >
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <Paperclip size={16} />
          <span>Attachments</span>
          <span className="bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">{attachmentLabel}</span>
        </button>
        <div className="flex items-center gap-2">
          <div ref={sortOptionsRef} data-transient-menu="true" className="relative">
            <button
              type="button"
              onClick={() => setSortOptionsOpen((current) => !current)}
              className="grid size-7 place-items-center border border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-900"
              aria-label="Sort attachments"
              aria-haspopup="dialog"
              aria-expanded={sortOptionsOpen}
              title={`Sort attachments: ${ATTACHMENT_SORT_OPTIONS.find((option) => option.key === sortKey)?.label}`}
            >
              <SlidersHorizontal size={14} />
            </button>
            {sortOptionsOpen ? (
              <section
                role="dialog"
                aria-label="Sort attachments"
                className="absolute bottom-9 right-0 z-30 w-52 border border-slate-200 bg-white p-1 text-slate-900 shadow-2xl shadow-slate-950/15"
              >
                <p className="px-3 pb-1.5 pt-2 text-xs font-semibold text-slate-500">Sort by</p>
                <div className="space-y-1">
                  {ATTACHMENT_SORT_OPTIONS.map((option) => {
                    const selected = option.key === sortKey;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => {
                          setSortKey(option.key);
                          setSortOptionsOpen(false);
                        }}
                        className={`flex h-9 w-full items-center justify-between gap-3 px-3 text-left text-sm font-medium ${
                          selected
                            ? "bg-slate-100 text-slate-950"
                            : "text-slate-700 hover:bg-slate-50 hover:text-slate-950"
                        }`}
                      >
                        <span>{option.label}</span>
                        {selected ? <Check size={14} className="text-cyan-600" /> : null}
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}
          </div>
          {canEdit ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex h-7 items-center gap-1 border border-slate-300 bg-white px-2 text-sm text-slate-700 hover:bg-slate-100"
            >
              <Plus size={14} />File
            </button>
          ) : null}
        </div>
      </div>
      {open ? (
        <div
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={(event) => void handleDrop(event)}
          className={`relative mt-3 border border-dashed transition-colors ${
            canEdit
              ? dragging
                ? "border-cyan-500 bg-cyan-50"
                : "border-slate-300 bg-white"
              : "border-transparent bg-transparent"
          }`}
        >
          {dragging ? (
            <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-cyan-50/90 px-4 text-sm font-semibold text-cyan-800">
              Drop files to attach
            </div>
          ) : null}
          {pageLoading ? (
            <p className="p-4 text-sm text-slate-500">Loading files...</p>
          ) : pendingUploads.length || page.attachments.length ? (
            <div className="grid max-h-80 gap-2 overflow-y-auto scroll-contained p-2">
              {pendingUploads.map((upload) => <PendingAttachmentUploadRow key={upload.id} upload={upload} />)}
              {sortedAttachments.map((attachment, index) => (
                <AttachmentRow
                  key={attachment.id}
                  index={index + 1}
                  attachment={attachment}
                  canEdit={canEdit}
                  usedInline={inlineAttachmentIds.has(attachment.id)}
                  onDelete={() => deleteAttachment(attachment)}
                />
              ))}
            </div>
          ) : (
            <p className="p-4 text-sm text-slate-500">{canEdit ? "Drop files here or use + File." : "No files attached yet."}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function PendingAttachmentUploadRow({ upload }: { upload: PendingAttachmentUpload }) {
  const failed = upload.status === "failed";
  return (
    <div className="flex items-center justify-between gap-4 border border-slate-200 bg-white px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <GripVertical className="shrink-0 text-slate-300" size={15} aria-hidden="true" />
        <span className="w-5 shrink-0 text-center text-xs font-medium tabular-nums text-slate-300">-</span>
        {failed ? <X className="shrink-0 text-rose-500" size={17} /> : <Loader2 className="shrink-0 animate-spin text-cyan-600" size={17} />}
        <div className="min-w-0">
          <div className="truncate text-sm text-slate-800">{upload.name}</div>
          <div className={`mt-0.5 text-xs ${failed ? "text-rose-600" : "text-slate-500"}`}>
            {formatBytes(upload.size)} · {failed ? "Upload failed" : "Uploading..."}
          </div>
        </div>
      </div>
    </div>
  );
}

function AttachmentRow({
  attachment,
  index,
  canEdit,
  usedInline,
  onDelete,
}: {
  attachment: Attachment;
  index: number;
  canEdit: boolean;
  usedInline: boolean;
  onDelete: () => Promise<boolean>;
}) {
  const Icon = blockIcons[attachment.blockType];
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);

  function handleDragStart(event: React.DragEvent<HTMLDivElement>) {
    if (!canEdit || deleting) return;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(INLINE_ATTACHMENT_DRAG_TYPE, JSON.stringify(attachmentToInlineAttrs(attachment)));
    event.dataTransfer.setData("text/plain", attachment.originalName);
  }

  async function handleDelete() {
    if (deleting) return;
    setDeleteFailed(false);
    setDeleting(true);
    const deleted = await onDelete();
    if (!deleted) {
      setDeleteFailed(true);
      setDeleting(false);
    }
  }

  return (
    <div
      draggable={canEdit && !deleting}
      onDragStart={handleDragStart}
      className={`flex items-center justify-between gap-4 border border-slate-200 bg-white px-3 py-2 ${canEdit && !deleting ? "cursor-grab active:cursor-grabbing" : ""}`}
      title={canEdit && !deleting ? "Drag into the page to place this attachment inline" : undefined}
    >
      <div className="flex min-w-0 items-center gap-2">
        {canEdit ? <GripVertical className={`shrink-0 ${deleting ? "text-slate-300" : "text-slate-400"}`} size={15} aria-hidden="true" /> : null}
        <span className="w-5 shrink-0 text-center text-xs font-medium tabular-nums text-slate-400">{index}</span>
        <Icon className="shrink-0 text-slate-500" size={17} />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="truncate text-sm text-slate-800">{attachment.originalName}</div>
            {usedInline ? (
              <span
                role="img"
                aria-label="Used inline in this page"
                title="Used inline in this page"
                className="grid size-4 shrink-0 place-items-center text-cyan-600"
              >
                <TextCursorInput size={14} aria-hidden="true" />
              </span>
            ) : null}
          </div>
          <div className={`mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-xs ${deleteFailed ? "text-rose-600" : "text-slate-500"}`}>
            <span>{attachment.blockType}</span>
            <span>{Math.max(1, Math.round(attachment.size / 1024))} KB</span>
            <span>{deleteFailed ? "Delete failed" : `Added ${formatAttachmentDate(attachment.createdAt)}`}</span>
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-xs">
        <a href={`/api/attachments/${attachment.id}/download`} className="inline-flex h-8 items-center gap-1 border border-slate-300 bg-white px-2 text-slate-700 hover:bg-slate-100"><Download size={13} />Download</a>
        {canEdit ? (
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={deleting}
            className="grid size-8 place-items-center border border-slate-300 bg-white text-slate-500 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-wait disabled:border-slate-300 disabled:bg-slate-50 disabled:text-slate-400"
            title={deleting ? "Deleting attachment" : "Delete attachment"}
          >
            {deleting ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function formatAttachmentDate(value: string) {
  const parsed = Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(parsed)) return value;
  const date = new Date(parsed);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}
