"use client";

import { Extension, Node, mergeAttributes, type Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type NodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import Underline from "@tiptap/extension-underline";
import {
  Bold,
  CalendarClock,
  CalendarPlus,
  Code,
  Download,
  Edit3,
  Eye,
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  GripVertical,
  Heading1,
  Heading2,
  HardDrive,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Plus,
  Presentation,
  Quote,
  Redo2,
  Rows3,
  Strikethrough,
  Table as TableIcon,
  Trash2,
  Underline as UnderlineIcon,
  Undo2,
  Unlink,
} from "lucide-react";
import { useEffect, useMemo, useRef, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { bodyToEditorDocument, editorDocumentToBody } from "@/lib/editor";
import type { Attachment, BlockType } from "@/lib/types";

export const INLINE_ATTACHMENT_DRAG_TYPE = "application/x-novo-attachment";

export type InlineAttachmentAttrs = {
  attachmentId: string;
  kind: BlockType;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
  updatedAt?: string;
  displayWidth?: number;
};

type RichTextEditorProps = {
  pageId: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: (value: string) => void;
  uploadInlineFile: (file: File, blockType: BlockType) => Promise<Attachment | null>;
  onInlineAttachmentInserted: (attachment: Attachment, body: string) => void;
  openSpreadsheet: (attachment: InlineAttachmentAttrs, onSaved?: (attachment: InlineAttachmentAttrs) => void) => void;
  openPresentation: (attachment: InlineAttachmentAttrs) => void;
};

const spreadsheetAccept = ".csv,.tsv,.xls,.xlsx,.xlsb,.ods";
const presentationAccept = ".ppt,.pptx,.pps,.ppsx,.odp";
const imageAccept = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/tiff";
const IMAGE_MIN_WIDTH = 180;
const PDF_DEFAULT_WIDTH = 360;
const PDF_MIN_WIDTH = 260;
const PDF_PAGE_ASPECT = 11 / 8.5;
const TAB_INDENT = "    ";

const EditorTabBehavior = Extension.create({
  name: "editorTabBehavior",
  addKeyboardShortcuts() {
    return {
      Tab: () => handleEditorTab(this.editor, false),
      "Shift-Tab": () => handleEditorTab(this.editor, true),
    };
  },
});

export function attachmentToInlineAttrs(attachment: Attachment): InlineAttachmentAttrs {
  return {
    attachmentId: attachment.id,
    kind: attachment.blockType,
    filename: attachment.originalName,
    mimeType: attachment.mimeType,
    size: attachment.size,
    createdAt: attachment.createdAt,
    updatedAt: attachment.updatedAt,
  };
}

export function RichTextEditor({ pageId, value, onChange, onBlur, uploadInlineFile, onInlineAttachmentInserted, openSpreadsheet, openPresentation }: RichTextEditorProps) {
  const lastPageId = useRef(pageId);
  const AttachmentCard = useMemo(() => createAttachmentCardExtension({ openSpreadsheet, openPresentation }), [openSpreadsheet, openPresentation]);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        link: false,
      }),
      EditorTabBehavior,
      Underline,
      Link.configure({
        autolink: true,
        openOnClick: false,
        defaultProtocol: "https",
      }),
      Placeholder.configure({
        placeholder: "Write notes...",
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
      AttachmentCard,
    ],
    content: bodyToEditorDocument(value),
    editorProps: {
      attributes: {
        class: "rich-text-surface min-h-[460px] outline-none",
      },
    },
    onUpdate: ({ editor: activeEditor }) => {
      onChange(editorDocumentToBody(activeEditor.getJSON()));
    },
    onBlur: ({ editor: activeEditor }) => {
      onBlur(editorDocumentToBody(activeEditor.getJSON()));
    },
  });

  useEffect(() => {
    if (!editor) return;
    const currentBody = editorDocumentToBody(editor.getJSON());
    if (lastPageId.current === pageId && currentBody === value) return;
    lastPageId.current = pageId;
    let canceled = false;
    queueMicrotask(() => {
      if (!canceled && !editor.isDestroyed) {
        editor.commands.setContent(bodyToEditorDocument(value), { emitUpdate: false });
      }
    });
    return () => {
      canceled = true;
    };
  }, [editor, pageId, value]);

  if (!editor) {
    return <div className="min-h-[460px] border border-slate-300 bg-white p-4 text-sm text-slate-500">Loading editor...</div>;
  }

  function setLink() {
    if (!editor) return;
    const previousUrl = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previousUrl ?? "");
    if (url === null) return;
    if (!url.trim()) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  }

  async function insertInlineFile(blockType: BlockType, accept: string) {
    if (!editor) return;
    const file = await pickFile(accept);
    if (!file) return;
    const attachment = await uploadInlineFile(file, blockType);
    if (!attachment) return;
    insertAttachmentCard(attachmentToInlineAttrs(attachment));
    const body = editorDocumentToBody(editor.getJSON());
    onInlineAttachmentInserted(attachment, body);
  }

  function insertAttachmentCard(attrs: InlineAttachmentAttrs, position?: number) {
    if (!editor) return;
    const content = { type: "attachmentCard", attrs };
    if (typeof position === "number") {
      editor.chain().focus().insertContentAt(position, content).run();
    } else {
      editor.chain().focus().insertContent(content).run();
    }
    const body = editorDocumentToBody(editor.getJSON());
    onChange(body);
    onBlur(body);
  }

  function handleEditorDragOver(event: DragEvent<HTMLDivElement>) {
    if (!hasInlineAttachmentPayload(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleEditorDrop(event: DragEvent<HTMLDivElement>) {
    if (!editor) return;
    const attrs = parseInlineAttachmentDrag(event.dataTransfer);
    if (!attrs) return;
    event.preventDefault();
    event.stopPropagation();
    const dropPosition = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? editor.state.doc.content.size;
    insertAttachmentCard(attrs, dropPosition);
  }

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] border border-slate-300 bg-white">
      <div className="z-20 flex flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50 p-2 shadow-sm">
        <ToolbarButton active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} label="Bold"><Bold size={15} /></ToolbarButton>
        <ToolbarButton active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} label="Italic"><Italic size={15} /></ToolbarButton>
        <ToolbarButton active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} label="Underline"><UnderlineIcon size={15} /></ToolbarButton>
        <ToolbarButton active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} label="Strikethrough"><Strikethrough size={15} /></ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} label="Heading 1"><Heading1 size={16} /></ToolbarButton>
        <ToolbarButton active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} label="Heading 2"><Heading2 size={16} /></ToolbarButton>
        <ToolbarButton active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} label="Bullet list"><List size={15} /></ToolbarButton>
        <ToolbarButton active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} label="Numbered list"><ListOrdered size={15} /></ToolbarButton>
        <ToolbarButton active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} label="Quote"><Quote size={15} /></ToolbarButton>
        <ToolbarButton active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()} label="Code block"><Code size={15} /></ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton active={editor.isActive("link")} onClick={setLink} label="Link"><LinkIcon size={15} /></ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().unsetLink().run()} label="Remove link"><Unlink size={15} /></ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} label="Insert table"><TableIcon size={15} /></ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().addRowAfter().run()} label="Add table row"><Rows3 size={15} /></ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().deleteTable().run()} label="Delete table"><Trash2 size={15} /></ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton onClick={() => void insertInlineFile("image", imageAccept)} label="Insert image"><FileImage size={15} /></ToolbarButton>
        <ToolbarButton onClick={() => void insertInlineFile("sheet", spreadsheetAccept)} label="Insert spreadsheet"><FileSpreadsheet size={15} /></ToolbarButton>
        <ToolbarButton onClick={() => void insertInlineFile("slides", presentationAccept)} label="Insert presentation"><Presentation size={15} /></ToolbarButton>
        <ToolbarButton onClick={() => void insertInlineFile("file", "")} label="Insert file"><Plus size={15} /></ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton onClick={() => editor.chain().focus().undo().run()} label="Undo"><Undo2 size={15} /></ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().redo().run()} label="Redo"><Redo2 size={15} /></ToolbarButton>
      </div>
      <div className="min-h-0 overflow-y-auto scroll-contained p-4" onDragOverCapture={handleEditorDragOver} onDropCapture={handleEditorDrop}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function createAttachmentCardExtension(actions: { openSpreadsheet: (attachment: InlineAttachmentAttrs, onSaved?: (attachment: InlineAttachmentAttrs) => void) => void; openPresentation: (attachment: InlineAttachmentAttrs) => void }) {
  return Node.create({
    name: "attachmentCard",
    group: "block",
    atom: true,
    draggable: true,
    addAttributes() {
      return {
        attachmentId: { default: "" },
        kind: { default: "file" },
        filename: { default: "attachment" },
        mimeType: { default: "application/octet-stream" },
        size: { default: 0 },
        createdAt: { default: "" },
        updatedAt: { default: "" },
        displayWidth: { default: null },
      };
    },
    parseHTML() {
      return [{ tag: "div[data-attachment-card]" }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, { "data-attachment-card": "true" })];
    },
    addNodeView() {
      return ReactNodeViewRenderer((props) => <AttachmentCardView {...props} {...actions} />);
    },
  });
}

function hasInlineAttachmentPayload(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.types).includes(INLINE_ATTACHMENT_DRAG_TYPE);
}

function parseInlineAttachmentDrag(dataTransfer: DataTransfer): InlineAttachmentAttrs | null {
  const rawPayload = dataTransfer.getData(INLINE_ATTACHMENT_DRAG_TYPE);
  if (!rawPayload) return null;
  try {
    const payload = JSON.parse(rawPayload) as Partial<InlineAttachmentAttrs>;
    if (!payload || typeof payload.attachmentId !== "string" || !payload.attachmentId) return null;
    return {
      attachmentId: payload.attachmentId,
      kind: normalizeKind(String(payload.kind ?? "file")),
      filename: typeof payload.filename === "string" && payload.filename ? payload.filename : "attachment",
      mimeType: typeof payload.mimeType === "string" && payload.mimeType ? payload.mimeType : "application/octet-stream",
      size: Number.isFinite(Number(payload.size)) ? Number(payload.size) : 0,
      createdAt: typeof payload.createdAt === "string" ? payload.createdAt : "",
      updatedAt: typeof payload.updatedAt === "string" ? payload.updatedAt : "",
      displayWidth: normalizeDisplayWidth(payload.displayWidth),
    };
  } catch {
    return null;
  }
}

function AttachmentCardView({ node, selected, updateAttributes, openSpreadsheet, openPresentation }: NodeViewProps & { openSpreadsheet: (attachment: InlineAttachmentAttrs, onSaved?: (attachment: InlineAttachmentAttrs) => void) => void; openPresentation: (attachment: InlineAttachmentAttrs) => void }) {
  const attrs = node.attrs as InlineAttachmentAttrs;
  const kind = normalizeKind(attrs.kind);
  const canEdit = kind === "sheet";
  const canPreview = kind === "slides";
  const updatedAt = attrs.updatedAt || attrs.createdAt;
  const imageWrapperRef = useRef<HTMLDivElement>(null);
  const pdfWrapperRef = useRef<HTMLDivElement>(null);
  const viewUrl = `/api/attachments/${attrs.attachmentId}/view`;
  const pdfViewUrl = `${viewUrl}#toolbar=0&navpanes=0`;
  const downloadUrl = `/api/attachments/${attrs.attachmentId}/download`;

  function handleSpreadsheetSaved(attachment: InlineAttachmentAttrs) {
    updateAttributes({
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.size,
      createdAt: attachment.createdAt,
      updatedAt: attachment.updatedAt,
    });
  }

  if (kind === "image") {
    const displayWidth = normalizeDisplayWidth(attrs.displayWidth);

    function startImageResize(event: ReactPointerEvent<HTMLButtonElement>) {
      event.preventDefault();
      event.stopPropagation();
      const wrapper = imageWrapperRef.current;
      if (!wrapper) return;
      const parentWidth = wrapper.parentElement?.getBoundingClientRect().width ?? wrapper.getBoundingClientRect().width;
      const startX = event.clientX;
      const startWidth = wrapper.getBoundingClientRect().width;
      const maxWidth = Math.max(IMAGE_MIN_WIDTH, Math.floor(parentWidth));
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";

      function resize(pointerEvent: PointerEvent) {
        const nextWidth = clamp(Math.round(startWidth + pointerEvent.clientX - startX), IMAGE_MIN_WIDTH, maxWidth);
        updateAttributes({ displayWidth: nextWidth });
      }

      function stopResize() {
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        window.removeEventListener("pointermove", resize);
        window.removeEventListener("pointerup", stopResize);
      }

      window.addEventListener("pointermove", resize);
      window.addEventListener("pointerup", stopResize, { once: true });
    }

    return (
      <NodeViewWrapper className="my-4" data-attachment-card="true">
        <div
          ref={imageWrapperRef}
          className={`group/inline-image relative inline-block max-w-full align-top ${selected ? "outline outline-2 outline-cyan-500" : ""}`}
          style={displayWidth ? { width: `${displayWidth}px` } : undefined}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={viewUrl}
            alt={attrs.filename}
            className="block h-auto max-h-[640px] max-w-full object-contain"
            draggable={false}
          />
          <button
            type="button"
            onPointerDown={startImageResize}
            tabIndex={-1}
            className="absolute -right-2 -top-2 grid size-4 cursor-ew-resize place-items-center border border-cyan-500 bg-white opacity-0 shadow-sm transition-opacity group-hover/inline-image:opacity-100 focus:opacity-100"
            title="Resize image"
            aria-label="Resize image"
          />
          <button
            type="button"
            onPointerDown={startImageResize}
            tabIndex={-1}
            className="absolute -bottom-2 -right-2 grid size-4 cursor-ew-resize place-items-center border border-cyan-500 bg-white opacity-0 shadow-sm transition-opacity group-hover/inline-image:opacity-100 focus:opacity-100"
            title="Resize image"
            aria-label="Resize image"
          />
        </div>
      </NodeViewWrapper>
    );
  }

  if (kind === "pdf") {
    const displayWidth = normalizePdfDisplayWidth(attrs.displayWidth);
    const previewHeight = Math.round(displayWidth * PDF_PAGE_ASPECT);

    function startPdfResize(event: ReactPointerEvent<HTMLButtonElement>) {
      event.preventDefault();
      event.stopPropagation();
      const wrapper = pdfWrapperRef.current;
      if (!wrapper) return;
      const parentWidth = wrapper.parentElement?.getBoundingClientRect().width ?? wrapper.getBoundingClientRect().width;
      const startX = event.clientX;
      const startWidth = wrapper.getBoundingClientRect().width;
      const maxWidth = Math.max(PDF_MIN_WIDTH, Math.floor(parentWidth));
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";

      function resize(pointerEvent: PointerEvent) {
        const nextWidth = clamp(Math.round(startWidth + pointerEvent.clientX - startX), PDF_MIN_WIDTH, maxWidth);
        updateAttributes({ displayWidth: nextWidth });
      }

      function stopResize() {
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        window.removeEventListener("pointermove", resize);
        window.removeEventListener("pointerup", stopResize);
      }

      window.addEventListener("pointermove", resize);
      window.addEventListener("pointerup", stopResize, { once: true });
    }

    return (
      <NodeViewWrapper className="my-4" data-attachment-card="true">
        <div
          ref={pdfWrapperRef}
          className={`group/pdf-preview relative max-w-full border border-slate-300 bg-slate-50 text-sm ${selected ? "outline outline-2 outline-cyan-500" : ""}`}
          style={{ width: `${displayWidth}px` }}
        >
          <div className="flex min-w-0 items-center gap-2 border-b border-slate-300 bg-slate-100 px-3 py-2">
            <button type="button" tabIndex={-1} data-drag-handle className="-ml-1 grid size-6 cursor-grab place-items-center text-slate-400 hover:text-slate-700" title="Move PDF" aria-label="Move PDF">
              <GripVertical size={16} />
            </button>
            <FileText size={17} className="shrink-0 text-rose-600" />
            <div className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-950">{attrs.filename}</div>
            <span className="shrink-0 text-xs text-slate-500">{formatBytes(attrs.size)}</span>
            <a href={downloadUrl} tabIndex={-1} className="inline-flex h-7 shrink-0 items-center gap-1 border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-50"><Download size={13} />Download</a>
          </div>
          <iframe
            src={pdfViewUrl}
            title={attrs.filename}
            className="block w-full bg-white"
            style={{ height: `${previewHeight}px` }}
          />
          <button
            type="button"
            onPointerDown={startPdfResize}
            tabIndex={-1}
            className="absolute -right-2 -top-2 grid size-4 cursor-ew-resize place-items-center border border-cyan-500 bg-white opacity-0 shadow-sm transition-opacity group-hover/pdf-preview:opacity-100 focus:opacity-100"
            title="Resize PDF preview"
            aria-label="Resize PDF preview"
          />
          <button
            type="button"
            onPointerDown={startPdfResize}
            tabIndex={-1}
            className="absolute -bottom-2 -right-2 grid size-4 cursor-ew-resize place-items-center border border-cyan-500 bg-white opacity-0 shadow-sm transition-opacity group-hover/pdf-preview:opacity-100 focus:opacity-100"
            title="Resize PDF preview"
            aria-label="Resize PDF preview"
          />
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="my-3">
      <div data-attachment-card="true" className="max-w-lg border border-slate-300 border-l-cyan-500 border-l-4 bg-slate-50 px-3 py-2.5 text-sm">
        <div className="flex items-start gap-2.5">
          {renderKindIcon(kind)}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1 truncate text-sm font-semibold leading-5 text-slate-950">{attrs.filename}</div>
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{labelForKind(kind)}</span>
            </div>
            <dl className="mt-1.5 grid gap-1 text-[11px] leading-4 text-slate-600 sm:grid-cols-2">
              <AttachmentMeta icon={<HardDrive size={12} />} label="Size" value={formatBytes(attrs.size)} />
              {attrs.createdAt ? <AttachmentMeta icon={<CalendarPlus size={12} />} label="Added" value={formatDateTime(attrs.createdAt)} /> : null}
              {updatedAt ? <AttachmentMeta icon={<CalendarClock size={12} />} label="Updated" value={formatDateTime(updatedAt)} /> : null}
            </dl>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {canEdit ? <button type="button" tabIndex={-1} onClick={() => openSpreadsheet(attrs, handleSpreadsheetSaved)} className="inline-flex h-7 items-center gap-1 border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-100"><Edit3 size={13} />Edit</button> : null}
              {canPreview ? <button type="button" tabIndex={-1} onClick={() => openPresentation(attrs)} className="inline-flex h-7 items-center gap-1 border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-100"><Eye size={13} />Preview</button> : null}
              <a href={downloadUrl} tabIndex={-1} className="inline-flex h-7 items-center gap-1 border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-100"><Download size={13} />Download</a>
            </div>
          </div>
        </div>
      </div>
    </NodeViewWrapper>
  );
}

function handleEditorTab(editor: Editor, outdent: boolean) {
  if (editor.isActive("bulletList") || editor.isActive("orderedList")) {
    const listCommand = outdent ? editor.commands.liftListItem : editor.commands.sinkListItem;
    listCommand("listItem");
    return true;
  }

  if (outdent) return true;
  if (editor.state.selection instanceof NodeSelection) return true;
  return editor.commands.insertContent(TAB_INDENT);
}

function AttachmentMeta({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <dt className="flex shrink-0 items-center gap-1 text-slate-400">{icon}<span>{label}</span></dt>
      <dd className="min-w-0 truncate">{value}</dd>
    </div>
  );
}

function ToolbarButton({ active = false, label, onClick, children }: { active?: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`grid size-8 place-items-center border text-slate-700 hover:bg-white ${active ? "border-cyan-500 bg-cyan-50 text-cyan-800" : "border-transparent"}`}
    >
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return <div className="mx-1 h-6 w-px bg-slate-200" />;
}

function pickFile(accept: string) {
  return new Promise<File | null>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
    input.click();
  });
}

function normalizeKind(kind: string): BlockType {
  if (["image", "sheet", "pdf", "slides", "sequence", "file"].includes(kind)) return kind as BlockType;
  return "file";
}

function renderKindIcon(kind: BlockType) {
  const className = "shrink-0 text-slate-600";
  if (kind === "sheet") return <FileSpreadsheet size={22} className={className} />;
  if (kind === "slides") return <Presentation size={22} className={className} />;
  if (kind === "pdf") return <FileText size={22} className={className} />;
  if (kind === "image") return <FileImage size={22} className={className} />;
  if (kind === "sequence") return <FileArchive size={22} className={className} />;
  return <File size={22} className={className} />;
}

function labelForKind(kind: BlockType) {
  const labels: Record<BlockType, string> = {
    image: "Image",
    sheet: "Spreadsheet",
    pdf: "PDF",
    slides: "Presentation",
    sequence: "Sequence",
    file: "File",
  };
  return labels[kind];
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 KB";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function normalizeDisplayWidth(value: unknown) {
  const width = Number(value);
  return Number.isFinite(width) && width >= IMAGE_MIN_WIDTH ? Math.round(width) : undefined;
}

function normalizePdfDisplayWidth(value: unknown) {
  const width = Number(value);
  return Number.isFinite(width) && width >= PDF_MIN_WIDTH ? Math.round(width) : PDF_DEFAULT_WIDTH;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
