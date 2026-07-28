"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Extension, Mark, Node, mergeAttributes, type Editor } from "@tiptap/core";
import type { Mark as ProseMirrorMark } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, useEditorState, type JSONContent, type NodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Color } from "@tiptap/extension-color";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { TextStyle } from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import {
  Bold,
  CalendarClock,
  CalendarPlus,
  ChevronDown,
  Code,
  Columns3,
  Download,
  Eraser,
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
  Loader2,
  Link as LinkIcon,
  List,
  ListOrdered,
  MessageSquarePlus,
  Minus,
  Palette,
  ArrowUpRight,
  Pencil,
  Plus,
  Printer,
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
  X,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { PresentationPreviewCarousel } from "@/components/PresentationPreviewCarousel";
import {
  bodyToEditorDocument,
  editorDocumentToBody,
  removeCommentMarksFromBody,
} from "@/lib/editor";
import type { SpreadsheetPreview, SpreadsheetPreviewCell } from "@/lib/spreadsheetPreview";
import type { Attachment, BlockType, PageCommentThread } from "@/lib/types";

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
  onPrint?: (selection?: { content: JSONContent[] }) => void;
  onExportPdf?: () => void;
  onExportArchive?: () => void;
  exporting?: boolean;
  onCreateComment?: (input: { selectedText: string; body: string }) => Promise<PageCommentThread | null>;
  onDiscardComment?: (threadId: string) => Promise<void>;
  runEditorMutation?: <T>(
    mutation: (context: {
      saveBody: (body: string) => Promise<boolean>;
    }) => Promise<T>,
  ) => Promise<T> | null;
  editorBusy?: boolean;
  onSelectCommentThread?: (threadId: string) => void;
  commentThreadToRemove?: string;
  onCommentThreadRemoved?: (body: string | null) => void;
  readOnly?: boolean;
};

const spreadsheetAccept = ".csv,.tsv,.xls,.xlsx,.xlsb,.ods";
const presentationAccept = ".ppt,.pptx,.pps,.ppsx,.odp";
const imageAccept = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/tiff";
const IMAGE_MIN_WIDTH = 180;
const PDF_DEFAULT_WIDTH = 360;
const PDF_MIN_WIDTH = 260;
const PDF_PAGE_ASPECT = 11 / 8.5;
const INLINE_ATTACHMENT_DRAGGING_CLASS = "inline-attachment-dragging";
const TAB_INDENT = "    ";
const TEXT_COLOR_OPTIONS = [
  { label: "Default", value: "", swatch: "#0f172a" },
  { label: "Gray", value: "#475569", swatch: "#475569" },
  { label: "Red", value: "#dc2626", swatch: "#dc2626" },
  { label: "Amber", value: "#d97706", swatch: "#d97706" },
  { label: "Green", value: "#16a34a", swatch: "#16a34a" },
  { label: "Blue", value: "#2563eb", swatch: "#2563eb" },
  { label: "Purple", value: "#9333ea", swatch: "#9333ea" },
] as const;

const ANNOTATION_COLORS = ["#dc2626", "#d97706", "#16a34a", "#2563eb", "#9333ea", "#0f172a"] as const;
const ANNOTATION_CANVAS_SIZE = 1000;

type AnnotationTool = "pen" | "arrow" | "erase";
type AnnotationPoint = { x: number; y: number };
type AnnotationItem =
  | { id: string; type: "pen"; color: string; width: number; points: AnnotationPoint[] }
  | { id: string; type: "arrow"; color: string; width: number; from: AnnotationPoint; to: AnnotationPoint };
type AnnotationDocument = { items: AnnotationItem[] };

const EditorTabBehavior = Extension.create({
  name: "editorTabBehavior",
  addKeyboardShortcuts() {
    return {
      Tab: () => handleEditorTab(this.editor, false),
      "Shift-Tab": () => handleEditorTab(this.editor, true),
    };
  },
});

type CommentDraftSelectionRange = { from: number; to: number } | null;

const commentDraftSelectionKey = new PluginKey<CommentDraftSelectionRange>("novoCommentDraftSelection");

const CommentDraftSelectionHighlight = Extension.create({
  name: "commentDraftSelectionHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin<CommentDraftSelectionRange>({
        key: commentDraftSelectionKey,
        state: {
          init: (): CommentDraftSelectionRange => null,
          apply(transaction, value) {
            const next = transaction.getMeta(commentDraftSelectionKey) as { from: number; to: number } | null | undefined;
            if (next !== undefined) return next;
            if (!value || !transaction.docChanged) return value;
            const from = transaction.mapping.map(value.from);
            const to = transaction.mapping.map(value.to);
            return from < to ? { from, to } : null;
          },
        },
        props: {
          decorations(state) {
            const range = commentDraftSelectionKey.getState(state);
            if (!range) return null;
            return DecorationSet.create(state.doc, [
              Decoration.inline(range.from, range.to, { class: "novo-comment-draft-mark" }),
            ]);
          },
        },
      }),
    ];
  },
});

const CommentMark = Mark.create({
  name: "comment",
  inclusive: false,
  addAttributes() {
    return {
      threadId: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-comment-thread-id") ?? "",
        renderHTML: (attributes) => attributes.threadId ? { "data-comment-thread-id": attributes.threadId } : {},
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-comment-thread-id]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "novo-comment-mark" }), 0];
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

export function RichTextEditor({ pageId, value, onChange, onBlur, uploadInlineFile, onInlineAttachmentInserted, openSpreadsheet, openPresentation, onPrint, onExportPdf, onExportArchive, exporting = false, onCreateComment, onDiscardComment, runEditorMutation, editorBusy = false, onSelectCommentThread, commentThreadToRemove = "", onCommentThreadRemoved, readOnly = false }: RichTextEditorProps) {
  const lastPageId = useRef(pageId);
  const dirty = useRef(false);
  const initialCanonicalBody = useRef<string | null>(null);
  if (initialCanonicalBody.current === null) initialCanonicalBody.current = editorDocumentToBody(bodyToEditorDocument(value));
  const latestBody = useRef<string>(initialCanonicalBody.current ?? "");
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commentButtonRef = useRef<HTMLButtonElement | null>(null);
  const pendingCommentThread = useRef<PageCommentThread | null>(null);
  const AttachmentCard = useMemo(() => createAttachmentCardExtension({ openSpreadsheet, openPresentation, readOnly }), [openPresentation, openSpreadsheet, readOnly]);
  const [commentDraftOpen, setCommentDraftOpen] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentSelection, setCommentSelection] = useState<{ from: number; to: number; selectedText: string } | null>(null);
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [commentError, setCommentError] = useState("");
  const [commentBlockMessage, setCommentBlockMessage] = useState("");
  const editorInteractionBlocked = readOnly || editorBusy || commentSubmitting;
  const editorInteractionBlockedRef = useRef(editorInteractionBlocked);
  editorInteractionBlockedRef.current = editorInteractionBlocked;

  function clearAutosaveTimer() {
    if (!autosaveTimer.current) return;
    clearTimeout(autosaveTimer.current);
    autosaveTimer.current = null;
  }

  function saveDirtyBody(body = latestBody.current) {
    if (readOnly || !dirty.current) return;
    clearAutosaveTimer();
    dirty.current = false;
    onBlur(body);
  }

  function scheduleAutosave(body: string) {
    latestBody.current = body;
    clearAutosaveTimer();
    autosaveTimer.current = setTimeout(() => saveDirtyBody(body), 1200);
  }

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        link: false,
        dropcursor: {
          color: "#0891b2",
          width: 2,
        },
      }),
      EditorTabBehavior,
      Underline,
      TextStyle,
      Color.configure({
        types: ["textStyle"],
      }),
      CommentDraftSelectionHighlight,
      CommentMark,
      Link.configure({
        autolink: true,
        openOnClick: false,
        defaultProtocol: "https",
      }),
      Placeholder.configure({
        placeholder: "Write page content...",
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
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: "rich-text-surface min-h-[460px] outline-none",
      },
      handleClick: (_view, _pos, event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return false;
        const commentElement = target.closest("[data-comment-thread-id]");
        const threadId = commentElement?.getAttribute("data-comment-thread-id");
        if (!threadId) return false;
        onSelectCommentThread?.(threadId);
        return false;
      },
    },
    onUpdate: ({ editor: activeEditor }) => {
      if (readOnly) return;
      const body = editorDocumentToBody(activeEditor.getJSON());
      if (body === latestBody.current) return;
      if (!activeEditor.isFocused && !dirty.current) {
        latestBody.current = body;
        return;
      }
      dirty.current = true;
      latestBody.current = body;
      onChange(body);
      scheduleAutosave(body);
    },
    onBlur: ({ editor: activeEditor }) => {
      saveDirtyBody(editorDocumentToBody(activeEditor.getJSON()));
    },
  });
  const historyState = useEditorState({
    editor,
    selector: ({ editor: activeEditor }) => ({
      canUndo: activeEditor?.can().undo() ?? false,
      canRedo: activeEditor?.can().redo() ?? false,
    }),
  });
  const canUndo = historyState?.canUndo ?? false;
  const canRedo = historyState?.canRedo ?? false;

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!readOnly && !editorBusy);
  }, [editor, editorBusy, readOnly]);

  useEffect(() => {
    if (!editor) return;
    const nextDocument = bodyToEditorDocument(value);
    const nextBody = editorDocumentToBody(nextDocument);
    const currentBody = editorDocumentToBody(editor.getJSON());
    if (lastPageId.current === pageId && currentBody === nextBody) {
      latestBody.current = nextBody;
      return;
    }
    lastPageId.current = pageId;
    latestBody.current = nextBody;
    dirty.current = false;
    clearAutosaveTimer();
    clearCommentDraftSelectionHighlight(editor);
    setCommentDraftOpen(false);
    setCommentDraft("");
    setCommentSelection(null);
    setCommentError("");
    setCommentBlockMessage("");
    let canceled = false;
    queueMicrotask(() => {
      if (!canceled && !editor.isDestroyed) {
        editor.commands.setContent(nextDocument, { emitUpdate: false });
      }
    });
    return () => {
      canceled = true;
    };
  }, [editor, pageId, value]);

  useEffect(() => {
    return () => {
      saveDirtyBody();
    };
  }, []);

  useEffect(() => {
    if (!editor || !commentThreadToRemove) return;
    const removed = removeCommentMarkByThreadId(editor, commentThreadToRemove);
    if (!removed) {
      onCommentThreadRemoved?.(null);
      return;
    }
    const body = editorDocumentToBody(editor.getJSON());
    latestBody.current = body;
    dirty.current = false;
    clearAutosaveTimer();
    onChange(body);
    onCommentThreadRemoved?.(body);
  }, [commentThreadToRemove, editor, onChange, onCommentThreadRemoved]);

  if (!editor) {
    return <div className="min-h-[460px] border border-slate-300 bg-white p-4 text-sm text-slate-500">Loading editor...</div>;
  }

  function setLink() {
    if (!editor || readOnly) return;
    const previousUrl = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previousUrl ?? "");
    if (url === null) return;
    if (!url.trim()) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  }

  function commitEditorCommand(command: () => boolean) {
    if (!editor || !command()) return;
    const body = editorDocumentToBody(editor.getJSON());
    // A menu can trigger a blur save before its command runs, so queue the newer body immediately.
    latestBody.current = body;
    dirty.current = false;
    clearAutosaveTimer();
    onChange(body);
    onBlur(body);
  }

  function openCommentComposer() {
    if (!editor || readOnly || !onCreateComment) return;
    const { from, to, empty } = editor.state.selection;
    if (empty || from === to) return;
    const selectedText = editor.state.doc.textBetween(from, to, " ").trim();
    if (!selectedText) return;
    if (selectionHasCommentMark(editor, from, to)) {
      clearCommentDraftSelectionHighlight(editor);
      setCommentSelection(null);
      setCommentDraft("");
      setCommentError("");
      setCommentBlockMessage("This selection overlaps an existing comment. Open the existing comment or select different text.");
      setCommentDraftOpen(true);
      return;
    }
    setCommentSelection({ from, to, selectedText });
    setCommentDraftSelectionHighlight(editor, { from, to });
    setCommentDraft("");
    setCommentError("");
    setCommentBlockMessage("");
    setCommentDraftOpen(true);
  }

  async function submitCommentDraft() {
    if (!editor || !commentSelection || !onCreateComment || commentSubmitting) return;
    const body = commentDraft.trim();
    if (!body) {
      setCommentError("Write a comment first.");
      return;
    }
    const restoreEditorEditing = editor.isEditable && !readOnly;
    editor.setEditable(false);
    setCommentSubmitting(true);
    setCommentError("");
    try {
      const createThreadAndMarkBody = async ({ saveBody }: { saveBody: (nextBody: string) => Promise<boolean> }) => {
        const thread = pendingCommentThread.current
          ?? await onCreateComment({ selectedText: commentSelection.selectedText, body });
        if (!thread) throw new Error("Comment was not created.");
        pendingCommentThread.current = thread;
        if (editor.isDestroyed) {
          await onDiscardComment?.(thread.id);
          pendingCommentThread.current = null;
          throw new Error("The page changed before the comment could be added.");
        }
        const currentSelection = commentDraftSelectionKey.getState(editor.state);
        if (!currentSelection) {
          await onDiscardComment?.(thread.id);
          pendingCommentThread.current = null;
          throw new Error("The selected text is no longer available.");
        }
        editor.chain().focus().setTextSelection(currentSelection).setMark("comment", { threadId: thread.id }).run();
        clearCommentDraftSelectionHighlight(editor);
        const nextBody = editorDocumentToBody(editor.getJSON());
        latestBody.current = nextBody;
        dirty.current = false;
        clearAutosaveTimer();
        onChange(nextBody);
        if (!(await saveBody(nextBody))) {
          if (!editor.isDestroyed) removeCommentMarkByThreadId(editor, thread.id);
          const cleanBody = removeCommentMarksFromBody(nextBody, thread.id);
          latestBody.current = cleanBody;
          dirty.current = false;
          onChange(cleanBody);
          await saveBody(cleanBody);
          try {
            await onDiscardComment?.(thread.id);
            pendingCommentThread.current = null;
          } catch {
            // Keep the same thread available for a retry if compensating deletion fails.
            throw new Error("The comment marker was not saved, and the comment could not be removed. Try again.");
          }
          throw new Error("Could not save the comment marker.");
        }
        pendingCommentThread.current = null;
        if (editor.isDestroyed) return;
        setCommentDraftOpen(false);
        setCommentDraft("");
        setCommentSelection(null);
        onSelectCommentThread?.(thread.id);
      };
      if (runEditorMutation) {
        const mutation = runEditorMutation(createThreadAndMarkBody);
        if (!mutation) throw new Error("Finish locking or signing out before adding a comment.");
        await mutation;
      } else {
        await createThreadAndMarkBody({
          saveBody: async (nextBody) => {
            onBlur(nextBody);
            return true;
          },
        });
      }
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : "Could not add comment.");
    } finally {
      if (!editor.isDestroyed && restoreEditorEditing) editor.setEditable(true);
      setCommentSubmitting(false);
    }
  }

  async function insertInlineFile(blockType: BlockType, accept: string) {
    if (!editor || readOnly || editorBusy || commentSubmitting) return;
    const file = await pickFile(accept);
    if (!file) return;
    const attachment = await uploadInlineFile(file, blockType);
    if (!attachment || editor.isDestroyed || editorInteractionBlockedRef.current) return;
    insertAttachmentCard(attachmentToInlineAttrs(attachment));
    const body = editorDocumentToBody(editor.getJSON());
    onInlineAttachmentInserted(attachment, body);
  }

  function insertAttachmentCard(attrs: InlineAttachmentAttrs, position?: number) {
    if (!editor || readOnly || editorBusy || commentSubmitting) return;
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
    if (!readOnly && !editorBusy && !commentSubmitting && hasExternalFilePayload(event.dataTransfer)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      return;
    }
    if (readOnly || editorBusy || commentSubmitting || !hasInlineAttachmentPayload(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  async function handleEditorDrop(event: DragEvent<HTMLDivElement>) {
    if (!editor || readOnly || editorBusy || commentSubmitting) return;
    if (hasExternalFilePayload(event.dataTransfer)) {
      const files = Array.from(event.dataTransfer.files);
      if (!files.length) return;
      event.preventDefault();
      event.stopPropagation();
      const dropPosition = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? editor.state.doc.content.size;
      let insertPosition = dropPosition;
      for (const file of files) {
        const attachment = await uploadInlineFile(file, blockTypeForDroppedFile(file));
        if (!attachment || editor.isDestroyed || editorInteractionBlockedRef.current) continue;
        insertAttachmentCard(attachmentToInlineAttrs(attachment), insertPosition);
        onInlineAttachmentInserted(attachment, editorDocumentToBody(editor.getJSON()));
        insertPosition += 1;
      }
      clearEditorDropCursor(editor.view.dom);
      return;
    }
    const attrs = parseInlineAttachmentDrag(event.dataTransfer);
    if (!attrs) return;
    event.preventDefault();
    event.stopPropagation();
    const dropPosition = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? editor.state.doc.content.size;
    insertAttachmentCard(attrs, dropPosition);
    clearEditorDropCursor(editor.view.dom);
  }

  return (
    <div
      className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden border border-slate-300 bg-white"
    >
      {!readOnly || onPrint || onExportPdf || onExportArchive ? <div role="group" aria-label="Text editor controls" className="z-20 flex flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50 p-2 shadow-sm">
        {!editorInteractionBlocked ? (
          <>
            <ToolbarButton active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} label="Bold"><Bold size={15} /></ToolbarButton>
            <ToolbarButton active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} label="Italic"><Italic size={15} /></ToolbarButton>
            <ToolbarButton active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} label="Underline"><UnderlineIcon size={15} /></ToolbarButton>
            <ToolbarButton active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} label="Strikethrough"><Strikethrough size={15} /></ToolbarButton>
            <TextColorMenu editor={editor} />
            <ToolbarDivider />
            <ToolbarButton active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} label="Heading 1"><Heading1 size={16} /></ToolbarButton>
            <ToolbarButton active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} label="Heading 2"><Heading2 size={16} /></ToolbarButton>
            <ToolbarButton active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} label="Bullet list"><List size={15} /></ToolbarButton>
            <ToolbarButton active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} label="Numbered list"><ListOrdered size={15} /></ToolbarButton>
            <ToolbarButton active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} label="Quote"><Quote size={15} /></ToolbarButton>
            <ToolbarButton active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()} label="Code block"><Code size={15} /></ToolbarButton>
            {onCreateComment ? <ToolbarButton buttonRef={commentButtonRef} onClick={openCommentComposer} label="Add comment"><MessageSquarePlus size={15} /></ToolbarButton> : null}
            <ToolbarDivider />
            <ToolbarButton active={editor.isActive("link")} onClick={setLink} label="Link"><LinkIcon size={15} /></ToolbarButton>
            <ToolbarButton onClick={() => editor.chain().focus().unsetLink().run()} label="Remove link"><Unlink size={15} /></ToolbarButton>
            <ToolbarDivider />
            <ToolbarMenu
              label="Table"
              icon={null}
              items={() => [
                {
                  label: "Insert 3 × 3 table",
                  icon: <TableIcon size={15} />,
                  onSelect: () => commitEditorCommand(() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()),
                  disabled: !editor.can().chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
                  focusEditor: true,
                },
                {
                  label: "Add row below",
                  icon: <TableActionIcon kind="row" action="add" />,
                  onSelect: () => commitEditorCommand(() => editor.chain().focus().addRowAfter().run()),
                  disabled: !editor.can().chain().focus().addRowAfter().run(),
                  separatorBefore: true,
                  focusEditor: true,
                },
                {
                  label: "Delete row",
                  icon: <TableActionIcon kind="row" action="delete" />,
                  onSelect: () => commitEditorCommand(() => editor.chain().focus().deleteRow().run()),
                  disabled: !editor.can().chain().focus().deleteRow().run(),
                  focusEditor: true,
                },
                {
                  label: "Add column right",
                  icon: <TableActionIcon kind="column" action="add" />,
                  onSelect: () => commitEditorCommand(() => editor.chain().focus().addColumnAfter().run()),
                  disabled: !editor.can().chain().focus().addColumnAfter().run(),
                  focusEditor: true,
                },
                {
                  label: "Delete column",
                  icon: <TableActionIcon kind="column" action="delete" />,
                  onSelect: () => commitEditorCommand(() => editor.chain().focus().deleteColumn().run()),
                  disabled: !editor.can().chain().focus().deleteColumn().run(),
                  focusEditor: true,
                },
                {
                  label: "Delete table",
                  icon: <TableActionIcon kind="table" action="delete" />,
                  onSelect: () => commitEditorCommand(() => editor.chain().focus().deleteTable().run()),
                  disabled: !editor.can().chain().focus().deleteTable().run(),
                  separatorBefore: true,
                  focusEditor: true,
                },
              ]}
            />
            <ToolbarDivider />
            <ToolbarMenu
              label="Insert"
              icon={null}
              items={[
                { label: "Image", icon: <FileImage size={15} />, onSelect: () => void insertInlineFile("image", imageAccept) },
                { label: "Spreadsheet", icon: <FileSpreadsheet size={15} />, onSelect: () => void insertInlineFile("sheet", spreadsheetAccept) },
                { label: "Presentation", icon: <Presentation size={15} />, onSelect: () => void insertInlineFile("slides", presentationAccept) },
                { label: "File", icon: <File size={15} />, onSelect: () => void insertInlineFile("file", "") },
              ]}
            />
            <ToolbarDivider />
            <ToolbarButton disabled={!canUndo} onClick={() => editor.chain().focus().undo().run()} label="Undo"><Undo2 size={15} /></ToolbarButton>
            <ToolbarButton disabled={!canRedo} onClick={() => editor.chain().focus().redo().run()} label="Redo"><Redo2 size={15} /></ToolbarButton>
          </>
        ) : null}
        {onPrint || onExportPdf || onExportArchive ? (
          <>
            {!readOnly ? <ToolbarDivider /> : null}
            {onPrint ? <ToolbarButton onClick={() => onPrint(getPrintSelection(editor))} label="Print page"><Printer size={15} /></ToolbarButton> : null}
            {onExportPdf || onExportArchive ? <ExportMenu onExportPdf={onExportPdf} onExportArchive={onExportArchive} exporting={exporting} /> : null}
          </>
        ) : null}
      </div> : null}
      <div className="min-h-0 min-w-0 overflow-y-auto overflow-x-hidden scroll-contained p-4" onDragOverCapture={editorInteractionBlocked ? undefined : handleEditorDragOver} onDropCapture={editorInteractionBlocked ? undefined : handleEditorDrop}>
        <EditorContent editor={editor} />
      </div>
      {commentDraftOpen ? (
        <CommentComposer
          anchorRef={commentButtonRef}
          value={commentDraft}
          error={commentError}
          blockMessage={commentBlockMessage}
          submitting={commentSubmitting}
          onChange={setCommentDraft}
          onCancel={() => {
            clearCommentDraftSelectionHighlight(editor);
            setCommentDraftOpen(false);
            setCommentDraft("");
            setCommentSelection(null);
            setCommentError("");
            setCommentBlockMessage("");
          }}
          onSubmit={() => void submitCommentDraft()}
        />
      ) : null}
    </div>
  );
}

function getPrintSelection(editor: Editor) {
  if (editor.state.selection.empty) return undefined;
  const selectionJson = editor.state.selection.content().content.toJSON();
  if (!Array.isArray(selectionJson) || selectionJson.length === 0) return undefined;
  return { content: selectionJson as JSONContent[] };
}

function setCommentDraftSelectionHighlight(editor: Editor, range: { from: number; to: number }) {
  editor.view.dispatch(editor.state.tr.setMeta(commentDraftSelectionKey, range));
}

function clearCommentDraftSelectionHighlight(editor: Editor) {
  editor.view.dispatch(editor.state.tr.setMeta(commentDraftSelectionKey, null));
}

function selectionHasCommentMark(editor: Editor, from: number, to: number) {
  const commentMarkType = editor.state.schema.marks.comment;
  if (!commentMarkType) return false;
  let found = false;
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (found) return false;
    if (!node.isText || !node.marks.length) return;
    found = node.marks.some((mark) => mark.type === commentMarkType);
    return !found;
  });
  return found;
}

function removeCommentMarkByThreadId(editor: Editor, threadId: string) {
  const commentMarkType = editor.state.schema.marks.comment;
  if (!commentMarkType) return false;
  let transaction = editor.state.tr;
  let removed = false;

  editor.state.doc.descendants((node, position) => {
    if (!node.isText || !node.marks.length) return;
    const matchingMarks = node.marks.filter((mark: ProseMirrorMark) => mark.type === commentMarkType && String(mark.attrs.threadId ?? "") === threadId);
    for (const mark of matchingMarks) {
      transaction = transaction.removeMark(position, position + node.nodeSize, mark);
      removed = true;
    }
  });

  if (!removed) return false;
  editor.view.dispatch(transaction);
  return true;
}

function createAttachmentCardExtension(actions: { openSpreadsheet: (attachment: InlineAttachmentAttrs, onSaved?: (attachment: InlineAttachmentAttrs) => void) => void; openPresentation: (attachment: InlineAttachmentAttrs) => void; readOnly: boolean }) {
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

function hasExternalFilePayload(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.types).includes("Files");
}

function acceptListMatchesFile(file: File, accept: string) {
  const name = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();
  return accept.split(",").some((entry) => {
    const value = entry.trim().toLowerCase();
    if (!value) return false;
    if (value.endsWith("/*")) return mimeType.startsWith(value.slice(0, -1));
    if (value.startsWith(".")) return name.endsWith(value);
    return mimeType === value;
  });
}

function blockTypeForDroppedFile(file: File): BlockType {
  const name = file.name.toLowerCase();
  if (acceptListMatchesFile(file, imageAccept)) return "image";
  if (name.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  if (acceptListMatchesFile(file, spreadsheetAccept)) return "sheet";
  if (acceptListMatchesFile(file, presentationAccept)) return "slides";
  return "file";
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

function AttachmentCardView({ node, selected, updateAttributes, openSpreadsheet, openPresentation, readOnly }: NodeViewProps & { openSpreadsheet: (attachment: InlineAttachmentAttrs, onSaved?: (attachment: InlineAttachmentAttrs) => void) => void; openPresentation: (attachment: InlineAttachmentAttrs) => void; readOnly: boolean }) {
  const attrs = node.attrs as InlineAttachmentAttrs;
  const kind = normalizeKind(attrs.kind);
  const canViewSheet = kind === "sheet";
  const canPreview = kind === "slides";
  const dragHandlers = readOnly ? {} : { onDragStart: startInlineAttachmentDrag, onDragEnd: clearInlineAttachmentDragState };
  const updatedAt = attrs.updatedAt || attrs.createdAt;
  const imageWrapperRef = useRef<HTMLDivElement>(null);
  const pdfWrapperRef = useRef<HTMLDivElement>(null);
  const viewUrl = `/api/attachments/${attrs.attachmentId}/view`;
  const pdfViewUrl = `${viewUrl}#toolbar=0&navpanes=0`;
  const downloadUrl = `/api/attachments/${attrs.attachmentId}/download`;
  const [sheetPreview, setSheetPreview] = useState<SpreadsheetPreview | null>(null);
  const [sheetPreviewStatus, setSheetPreviewStatus] = useState("");
  const [annotationDocument, setAnnotationDocument] = useState<AnnotationDocument>({ items: [] });
  const [annotationOpen, setAnnotationOpen] = useState(false);
  const [annotationStatus, setAnnotationStatus] = useState("");
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageLoadError, setImageLoadError] = useState("");

  useEffect(() => {
    if (kind !== "sheet") return;
    let active = true;
    async function loadSheetPreview() {
      setSheetPreviewStatus("Loading preview");
      try {
        const response = await fetch(`/api/attachments/${attrs.attachmentId}/preview/spreadsheet?rows=20&columns=8`, { cache: "no-store" });
        const body = (await response.json().catch(() => null)) as { preview?: SpreadsheetPreview; error?: string } | null;
        if (!response.ok || !body?.preview) throw new Error(body?.error || `Preview failed (${response.status})`);
        if (active) {
          setSheetPreview(body.preview);
          setSheetPreviewStatus("");
        }
      } catch (error) {
        if (active) {
          setSheetPreview(null);
          setSheetPreviewStatus(error instanceof Error ? error.message : "Unable to preview spreadsheet");
        }
      }
    }
    void loadSheetPreview();
    return () => {
      active = false;
    };
  }, [attrs.attachmentId, attrs.size, attrs.updatedAt, kind]);

  useEffect(() => {
    if (kind !== "image") return;
    let active = true;
    setImageLoaded(false);
    setImageLoadError("");
    async function loadAnnotation() {
      try {
        const response = await fetch(`/api/attachments/${attrs.attachmentId}/annotation`, { cache: "no-store" });
        const body = (await response.json().catch(() => null)) as { annotation?: { data?: unknown }; error?: string } | null;
        if (!response.ok) throw new Error(body?.error || `Annotation load failed (${response.status})`);
        if (active) setAnnotationDocument(normalizeAnnotationDocument(body?.annotation?.data));
      } catch (error) {
        if (active) setAnnotationStatus(error instanceof Error ? error.message : "Unable to load annotations");
      }
    }
    void loadAnnotation();
    return () => {
      active = false;
    };
  }, [attrs.attachmentId, attrs.mimeType, attrs.updatedAt, kind]);

  async function saveAnnotationDocument(data: AnnotationDocument) {
    const response = await fetch(`/api/attachments/${attrs.attachmentId}/annotation`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
    });
    const body = (await response.json().catch(() => null)) as { annotation?: { data?: unknown }; error?: string } | null;
    if (!response.ok) throw new Error(body?.error || `Annotation save failed (${response.status})`);
    const nextDocument = normalizeAnnotationDocument(body?.annotation?.data ?? data);
    setAnnotationStatus("");
    return nextDocument;
  }

  if (kind === "image") {
    const displayWidth = normalizeDisplayWidth(attrs.displayWidth);
    const imageUrl = isBrowserRenderableImage(attrs.mimeType) ? viewUrl : `/api/attachments/${attrs.attachmentId}/preview/image`;

    function startImageResize(event: ReactPointerEvent<HTMLButtonElement>) {
      const wrapper = imageWrapperRef.current;
      if (!wrapper) return;
      const parentWidth = wrapper.parentElement?.getBoundingClientRect().width ?? wrapper.getBoundingClientRect().width;
      const maxWidth = Math.max(IMAGE_MIN_WIDTH, Math.floor(parentWidth));
      startHorizontalAttachmentResize(event, {
        minWidth: IMAGE_MIN_WIDTH,
        maxWidth,
        startWidth: wrapper.getBoundingClientRect().width,
        onResize: (displayWidth) => updateAttributes({ displayWidth }),
      });
    }

    return (
      <NodeViewWrapper className="my-4" data-attachment-card="true" {...dragHandlers}>
        <div
          ref={imageWrapperRef}
          className={`group/inline-image relative inline-block max-w-full overflow-hidden border border-slate-300 bg-slate-50 align-top text-sm ${selected ? "outline outline-2 outline-cyan-500" : ""}`}
          style={displayWidth ? { width: `${displayWidth}px` } : undefined}
        >
          <div className="flex min-w-0 items-center gap-2 border-b border-slate-300 bg-slate-100 px-3 py-2">
            {!readOnly ? <button type="button" tabIndex={-1} data-drag-handle className="-ml-1 grid size-6 cursor-grab place-items-center text-slate-400 hover:text-slate-700" title="Move image" aria-label="Move image">
              <GripVertical size={16} />
            </button> : null}
            <FileImage size={17} className="shrink-0 text-cyan-700" />
            <div className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-950">{attrs.filename}</div>
            <span className="shrink-0 text-xs text-slate-500">{formatBytes(attrs.size)}</span>
            {!readOnly ? <button type="button" tabIndex={-1} onClick={() => setAnnotationOpen(true)} className="inline-flex h-7 shrink-0 items-center gap-1 border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-50"><Pencil size={13} />Annotate</button> : null}
          </div>
          <div className="relative block min-h-28 w-full max-w-full bg-white">
            {!imageLoaded && !imageLoadError ? (
              <div className="flex min-h-28 w-full items-center justify-center gap-2 px-4 py-8 text-xs text-slate-500">
                <Loader2 size={14} className="animate-spin" />
                Loading image...
              </div>
            ) : null}
            {imageLoadError ? <div className="w-full px-4 py-8 text-xs text-rose-700">{imageLoadError}</div> : null}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt={attrs.filename}
              className={`${imageLoaded && !imageLoadError ? "block" : "absolute left-0 top-0 size-px opacity-0"} h-auto max-h-[640px] max-w-full object-contain`}
              draggable={false}
              onLoad={() => {
                setImageLoaded(true);
                setImageLoadError("");
              }}
              onError={() => {
                setImageLoaded(true);
                setImageLoadError("Unable to load image preview.");
              }}
            />
            {imageLoaded && !imageLoadError ? <AnnotationOverlay document={annotationDocument} /> : null}
          </div>
          {annotationStatus ? <div className="border-t border-slate-200 bg-white px-3 py-1.5 text-xs text-rose-700">{annotationStatus}</div> : null}
          {!readOnly ? <button
            type="button"
            onPointerDown={startImageResize}
            tabIndex={-1}
            className="absolute -right-2 -top-2 grid size-4 cursor-ew-resize place-items-center border border-cyan-500 bg-white opacity-0 shadow-sm transition-opacity group-hover/inline-image:opacity-100 focus:opacity-100"
            title="Resize image"
            aria-label="Resize image"
          /> : null}
          {!readOnly ? <button
            type="button"
            onPointerDown={startImageResize}
            tabIndex={-1}
            className="absolute -bottom-2 -right-2 grid size-4 cursor-ew-resize place-items-center border border-cyan-500 bg-white opacity-0 shadow-sm transition-opacity group-hover/inline-image:opacity-100 focus:opacity-100"
            title="Resize image"
            aria-label="Resize image"
          /> : null}
          {annotationOpen ? (
            <ImageAnnotationModal
              filename={attrs.filename}
              imageUrl={imageUrl}
              initialDocument={annotationDocument}
              onClose={() => setAnnotationOpen(false)}
              onSaved={setAnnotationDocument}
              saveDocument={saveAnnotationDocument}
            />
          ) : null}
        </div>
      </NodeViewWrapper>
    );
  }

  if (kind === "pdf") {
    const displayWidth = normalizePdfDisplayWidth(attrs.displayWidth);
    const previewHeight = Math.round(displayWidth * PDF_PAGE_ASPECT);

    function startPdfResize(event: ReactPointerEvent<HTMLButtonElement>) {
      const wrapper = pdfWrapperRef.current;
      if (!wrapper) return;
      const parentWidth = wrapper.parentElement?.getBoundingClientRect().width ?? wrapper.getBoundingClientRect().width;
      const maxWidth = Math.max(PDF_MIN_WIDTH, Math.floor(parentWidth));
      startHorizontalAttachmentResize(event, {
        minWidth: PDF_MIN_WIDTH,
        maxWidth,
        startWidth: wrapper.getBoundingClientRect().width,
        onResize: (displayWidth) => updateAttributes({ displayWidth }),
      });
    }

    return (
      <NodeViewWrapper className="my-4" data-attachment-card="true" {...dragHandlers}>
        <div
          ref={pdfWrapperRef}
          className={`group/pdf-preview relative max-w-full border border-slate-300 bg-slate-50 text-sm ${selected ? "outline outline-2 outline-cyan-500" : ""}`}
          style={{ width: `${displayWidth}px` }}
        >
          <div className="flex min-w-0 items-center gap-2 border-b border-slate-300 bg-slate-100 px-3 py-2">
            {!readOnly ? <button type="button" tabIndex={-1} data-drag-handle className="-ml-1 grid size-6 cursor-grab place-items-center text-slate-400 hover:text-slate-700" title="Move PDF" aria-label="Move PDF">
              <GripVertical size={16} />
            </button> : null}
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
          {!readOnly ? <button
            type="button"
            onPointerDown={startPdfResize}
            tabIndex={-1}
            className="absolute -right-2 -top-2 grid size-4 cursor-ew-resize place-items-center border border-cyan-500 bg-white opacity-0 shadow-sm transition-opacity group-hover/pdf-preview:opacity-100 focus:opacity-100"
            title="Resize PDF preview"
            aria-label="Resize PDF preview"
          /> : null}
          {!readOnly ? <button
            type="button"
            onPointerDown={startPdfResize}
            tabIndex={-1}
            className="absolute -bottom-2 -right-2 grid size-4 cursor-ew-resize place-items-center border border-cyan-500 bg-white opacity-0 shadow-sm transition-opacity group-hover/pdf-preview:opacity-100 focus:opacity-100"
            title="Resize PDF preview"
            aria-label="Resize PDF preview"
          /> : null}
        </div>
      </NodeViewWrapper>
    );
  }

  if (kind === "sheet") {
    return (
      <NodeViewWrapper className="my-4" data-attachment-card="true" {...dragHandlers}>
        <div className={`max-w-3xl overflow-hidden border border-slate-300 bg-slate-50 text-sm ${selected ? "outline outline-2 outline-cyan-500" : ""}`}>
          <div className="flex min-w-0 items-center gap-2 border-b border-slate-300 bg-slate-100 px-3 py-2">
            {!readOnly ? <button type="button" tabIndex={-1} data-drag-handle className="-ml-1 grid size-6 cursor-grab place-items-center text-slate-400 hover:text-slate-700" title="Move spreadsheet" aria-label="Move spreadsheet">
              <GripVertical size={16} />
            </button> : null}
            <FileSpreadsheet size={17} className="shrink-0 text-emerald-700" />
            <div className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-950">{attrs.filename}</div>
            <span className="shrink-0 text-xs text-slate-500">{formatBytes(attrs.size)}</span>
            <button type="button" tabIndex={-1} onClick={() => openSpreadsheet(attrs)} className="inline-flex h-7 shrink-0 items-center gap-1 border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-50"><Eye size={13} />View</button>
            <a href={downloadUrl} tabIndex={-1} className="inline-flex h-7 shrink-0 items-center gap-1 border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-50"><Download size={13} />Download</a>
          </div>
          {sheetPreview ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600">
                <span className="min-w-0 truncate font-medium">{sheetPreview.sheetName}</span>
                <span className="shrink-0 tabular-nums">
                  {sheetPreview.rowCount.toLocaleString()} rows x {sheetPreview.columnCount.toLocaleString()} columns
                  {sheetPreview.truncatedRows || sheetPreview.truncatedColumns ? ` · showing ${sheetPreview.previewRowCount} x ${sheetPreview.previewColumnCount}` : ""}
                </span>
              </div>
              <div className="max-h-72 overflow-auto scroll-contained bg-white">
                <table className="min-w-full border-collapse text-xs leading-5">
                  <tbody>
                    {sheetPreview.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, columnIndex) => cell.hidden ? null : (
                          <td
                            key={columnIndex}
                            colSpan={cell.colSpan}
                            rowSpan={cell.rowSpan}
                            className={`max-w-56 border border-slate-200 px-2 py-1 align-top text-slate-800 ${rowIndex === 0 && !cell.backgroundColor ? "bg-slate-100 font-medium text-slate-950" : "bg-white"}`}
                            style={spreadsheetCellStyle(cell)}
                          >
                            <div className="max-h-20 overflow-hidden whitespace-pre-wrap break-words">{formatSpreadsheetCell(cell)}</div>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="border-t border-slate-200 bg-white px-3 py-4 text-sm text-slate-500">{sheetPreviewStatus || "No spreadsheet preview available."}</div>
          )}
        </div>
      </NodeViewWrapper>
    );
  }

  if (kind === "slides") {
    return (
      <NodeViewWrapper className="my-4" data-attachment-card="true" {...dragHandlers}>
        <div className={`max-w-3xl overflow-hidden border border-slate-300 bg-slate-50 text-sm ${selected ? "outline outline-2 outline-cyan-500" : ""}`}>
          <div className="flex min-w-0 items-center gap-2 border-b border-slate-300 bg-slate-100 px-3 py-2">
            {!readOnly ? <button type="button" tabIndex={-1} data-drag-handle className="-ml-1 grid size-6 cursor-grab place-items-center text-slate-400 hover:text-slate-700" title="Move presentation" aria-label="Move presentation"><GripVertical size={16} /></button> : null}
            <Presentation size={17} className="shrink-0 text-orange-600" />
            <div className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-950">{attrs.filename}</div>
            <span className="shrink-0 text-xs text-slate-500">{formatBytes(attrs.size)}</span>
            <button type="button" tabIndex={-1} onClick={() => openPresentation(attrs)} className="inline-flex h-7 shrink-0 items-center gap-1 border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-50"><Eye size={13} />Open</button>
            <a href={downloadUrl} tabIndex={-1} className="inline-flex h-7 shrink-0 items-center gap-1 border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-50"><Download size={13} />Download</a>
          </div>
          <PresentationPreviewCarousel attachmentId={attrs.attachmentId} filename={attrs.filename} />
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="my-3" {...dragHandlers}>
      <div data-attachment-card="true" className="max-w-lg overflow-hidden border border-slate-300 border-l-cyan-500 border-l-4 bg-slate-50 px-3 py-2.5 text-sm">
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
              {canViewSheet ? <button type="button" tabIndex={-1} onClick={() => openSpreadsheet(attrs)} className="inline-flex h-7 items-center gap-1 border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-100"><Eye size={13} />View</button> : null}
              {canPreview ? <button type="button" tabIndex={-1} onClick={() => openPresentation(attrs)} className="inline-flex h-7 items-center gap-1 border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-100"><Eye size={13} />Preview</button> : null}
              <a href={downloadUrl} tabIndex={-1} className="inline-flex h-7 items-center gap-1 border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-100"><Download size={13} />Download</a>
            </div>
          </div>
        </div>
      </div>
    </NodeViewWrapper>
  );
}

function ImageAnnotationModal({ filename, imageUrl, initialDocument, onClose, onSaved, saveDocument }: { filename: string; imageUrl: string; initialDocument: AnnotationDocument; onClose: () => void; onSaved: (document: AnnotationDocument) => void; saveDocument: (document: AnnotationDocument) => Promise<AnnotationDocument> }) {
  const [draft, setDraft] = useState<AnnotationDocument>(() => normalizeAnnotationDocument(initialDocument));
  const [tool, setTool] = useState<AnnotationTool>("pen");
  const [color, setColor] = useState<string>(ANNOTATION_COLORS[0]);
  const [currentItem, setCurrentItem] = useState<AnnotationItem | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [error, setError] = useState("");
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState("");
  const surfaceRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef(draft);
  const queuedSaveDocument = useRef<AnnotationDocument | null>(null);
  const saveInFlight = useRef(false);
  const saveWaiters = useRef<Array<(ok: boolean) => void>>([]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    setImageLoaded(false);
    setImageError("");
  }, [imageUrl]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  function queueSave(nextDocument: AnnotationDocument) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState("idle");
    saveTimer.current = setTimeout(() => {
      void flushSave(nextDocument);
    }, 700);
  }

  async function flushSave(document = draftRef.current) {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    queuedSaveDocument.current = document;
    return drainSaveQueue();
  }

  async function drainSaveQueue(): Promise<boolean> {
    if (saveInFlight.current) {
      return new Promise<boolean>((resolve) => {
        saveWaiters.current.push(resolve);
      });
    }
    saveInFlight.current = true;
    let ok = true;
    setSaveState("saving");
    setError("");
    try {
      while (queuedSaveDocument.current) {
        const document = queuedSaveDocument.current;
        const requestedKey = annotationDocumentKey(document);
        queuedSaveDocument.current = null;
        try {
          const saved = await saveDocument(document);
          if (annotationDocumentKey(draftRef.current) === requestedKey) {
            draftRef.current = saved;
            setDraft(saved);
            onSaved(saved);
          }
        } catch (saveError) {
          ok = false;
          setSaveState("failed");
          setError(saveError instanceof Error ? saveError.message : "Annotation save failed");
          break;
        }
      }
      if (ok) {
        setSaveState("saved");
        window.setTimeout(() => setSaveState((state) => state === "saved" ? "idle" : state), 1500);
      }
    } finally {
      saveInFlight.current = false;
      if (queuedSaveDocument.current && ok) ok = await drainSaveQueue();
      const waiters = saveWaiters.current.splice(0);
      for (const resolve of waiters) resolve(ok);
    }
    return ok;
  }

  function commit(nextDocument: AnnotationDocument) {
    const normalizedDocument = normalizeAnnotationDocument(nextDocument);
    draftRef.current = normalizedDocument;
    setDraft(normalizedDocument);
    onSaved(normalizedDocument);
    queueSave(normalizedDocument);
  }

  function pointFromEvent(event: ReactPointerEvent<HTMLElement>): AnnotationPoint | null {
    const surface = surfaceRef.current;
    if (!surface) return null;
    const rect = surface.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    };
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!imageLoaded || imageError) return;
    const point = pointFromEvent(event);
    if (!point) return;
    if (tool === "erase") {
      const itemId = findAnnotationItemNearPoint(draftRef.current.items, point);
      if (!itemId) return;
      commit({ items: draftRef.current.items.filter((item) => item.id !== itemId) });
      return;
    }
    const nextItem: AnnotationItem = tool === "arrow"
      ? { id: randomClientId(), type: "arrow", color, width: 3, from: point, to: point }
      : { id: randomClientId(), type: "pen", color, width: 3, points: [point] };
    setCurrentItem(nextItem);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!currentItem) return;
    const point = pointFromEvent(event);
    if (!point) return;
    if (currentItem.type === "arrow") setCurrentItem({ ...currentItem, to: point });
    if (currentItem.type === "pen") setCurrentItem({ ...currentItem, points: [...currentItem.points, point] });
  }

  function handlePointerUp() {
    if (!currentItem) return;
    const item = currentItem;
    setCurrentItem(null);
    if (item.type === "pen" && item.points.length < 2) return;
    if (item.type === "arrow" && annotationDistance(item.from, item.to) < 0.01) return;
    commit({ items: [...draftRef.current.items, item] });
  }

  function undo() {
    if (!draft.items.length) return;
    commit({ items: draft.items.slice(0, -1) });
  }

  function clear() {
    if (!draft.items.length || !window.confirm("Clear all annotations on this image?")) return;
    commit({ items: [] });
  }

  async function closeAfterSave() {
    if (await flushSave()) onClose();
  }

  const visibleDocument = currentItem ? { items: [...draft.items, currentItem] } : draft;

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/75 p-5" role="dialog" aria-modal="true" aria-label={`Annotate ${filename}`}>
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden border border-slate-700 bg-white shadow-2xl">
        <div className="flex min-w-0 items-center gap-3 border-b border-slate-200 bg-slate-950 px-4 py-3 text-white">
          <FileImage size={20} className="shrink-0 text-cyan-300" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-semibold">Annotate image</div>
            <div className="truncate text-xs text-slate-300">{filename}</div>
          </div>
          <div className="text-xs text-slate-300">{saveState === "saving" ? "Saving..." : saveState === "saved" ? "Saved" : saveState === "failed" ? "Save failed" : ""}</div>
          <button type="button" onClick={closeAfterSave} className="grid size-9 place-items-center border border-slate-600 text-slate-200 hover:bg-slate-800" aria-label="Close annotation editor"><X size={16} /></button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2">
          <AnnotationToolButton active={tool === "pen"} onClick={() => setTool("pen")} label="Freehand"><Pencil size={15} /></AnnotationToolButton>
          <AnnotationToolButton active={tool === "arrow"} onClick={() => setTool("arrow")} label="Arrow"><ArrowUpRight size={15} /></AnnotationToolButton>
          <AnnotationToolButton active={tool === "erase"} onClick={() => setTool("erase")} label="Erase object"><Eraser size={15} /></AnnotationToolButton>
          <div className="mx-1 h-6 w-px bg-slate-300" />
          {ANNOTATION_COLORS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              onClick={() => setColor(swatch)}
              className={`size-7 border ${color === swatch ? "border-cyan-600 ring-2 ring-cyan-200" : "border-slate-300"}`}
              style={{ backgroundColor: swatch }}
              aria-label={`Use ${swatch}`}
            />
          ))}
          <div className="mx-1 h-6 w-px bg-slate-300" />
          <button type="button" onClick={undo} disabled={!draft.items.length} className="inline-flex h-8 items-center gap-1 border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"><Undo2 size={14} />Undo</button>
          <button type="button" onClick={clear} disabled={!draft.items.length} className="inline-flex h-8 items-center gap-1 border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"><Trash2 size={14} />Clear</button>
          {tool === "erase" ? <div className="ml-auto text-xs text-slate-500">Click a stroke or arrow to remove it.</div> : null}
        </div>
        {error ? <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div> : null}
        <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-4">
          <div
            ref={surfaceRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={() => setCurrentItem(null)}
            className={`relative mx-auto inline-block min-h-48 min-w-80 max-w-full select-none bg-white shadow-lg ${imageLoaded && !imageError ? "cursor-crosshair" : "cursor-default"}`}
          >
            {!imageLoaded && !imageError ? (
              <div className="flex min-h-48 min-w-80 items-center justify-center gap-2 px-5 py-12 text-sm text-slate-500">
                <Loader2 size={16} className="animate-spin" />
                Loading image...
              </div>
            ) : null}
            {imageError ? <div className="px-5 py-12 text-sm text-rose-700">{imageError}</div> : null}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt={filename}
              className={`${imageLoaded && !imageError ? "block" : "absolute left-0 top-0 size-px opacity-0"} max-h-[72vh] max-w-full object-contain`}
              draggable={false}
              onLoad={() => {
                setImageLoaded(true);
                setImageError("");
              }}
              onError={() => {
                setImageLoaded(true);
                setImageError("Unable to load image preview.");
              }}
            />
            {imageLoaded && !imageError ? <AnnotationOverlay document={visibleDocument} interactive /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function AnnotationToolButton({ active, onClick, label, children }: { active: boolean; onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`grid size-8 place-items-center border text-sm ${active ? "border-cyan-500 bg-cyan-50 text-cyan-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}`}
    >
      {children}
    </button>
  );
}

function AnnotationOverlay({ document, interactive = false }: { document: AnnotationDocument; interactive?: boolean }) {
  if (!document.items.length) return null;
  return (
    <svg
      className={`absolute inset-0 size-full ${interactive ? "" : "pointer-events-none"}`}
      viewBox={`0 0 ${ANNOTATION_CANVAS_SIZE} ${ANNOTATION_CANVAS_SIZE}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        {ANNOTATION_COLORS.map((color) => (
          <marker key={color} id={`annotation-arrow-${color.slice(1)}`} markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L9,3 z" fill={color} />
          </marker>
        ))}
      </defs>
      {document.items.map((item) => {
        if (item.type === "pen") {
          const pathData = item.points.map((point, index) => `${index === 0 ? "M" : "L"} ${scaleAnnotationValue(point.x)} ${scaleAnnotationValue(point.y)}`).join(" ");
          return <path key={item.id} d={pathData} fill="none" stroke={item.color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={item.width} vectorEffect="non-scaling-stroke" />;
        }
        if (item.type === "arrow") {
          return (
            <line
              key={item.id}
              x1={scaleAnnotationValue(item.from.x)}
              y1={scaleAnnotationValue(item.from.y)}
              x2={scaleAnnotationValue(item.to.x)}
              y2={scaleAnnotationValue(item.to.y)}
              stroke={item.color}
              strokeLinecap="round"
              strokeWidth={item.width}
              vectorEffect="non-scaling-stroke"
              markerEnd={`url(#annotation-arrow-${item.color.replace("#", "")})`}
            />
          );
        }
        return null;
      })}
    </svg>
  );
}

function isBrowserRenderableImage(mimeType: string) {
  return new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"]).has(mimeType.toLowerCase());
}

function normalizeAnnotationDocument(value: unknown): AnnotationDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { items: [] };
  const items = (value as { items?: unknown }).items;
  if (!Array.isArray(items)) return { items: [] };
  return {
    items: items.map(normalizeAnnotationItem).filter((item): item is AnnotationItem => Boolean(item)).slice(0, 1000),
  };
}

function normalizeAnnotationItem(value: unknown): AnnotationItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const id = typeof item.id === "string" && item.id ? item.id : randomClientId();
  const color = normalizeAnnotationColor(item.color);
  const width = clamp(Number(item.width || 3), 1, 12);
  if (item.type === "pen") {
    const points = Array.isArray(item.points) ? item.points.map(normalizeAnnotationPoint).filter((point): point is AnnotationPoint => Boolean(point)).slice(0, 5000) : [];
    return points.length ? { id, type: "pen", color, width, points } : null;
  }
  if (item.type === "arrow") {
    const from = normalizeAnnotationPoint(item.from);
    const to = normalizeAnnotationPoint(item.to);
    return from && to ? { id, type: "arrow", color, width, from, to } : null;
  }
  return null;
}

function annotationDocumentKey(document: AnnotationDocument) {
  return JSON.stringify(document);
}

function normalizeAnnotationPoint(value: unknown): AnnotationPoint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const point = value as { x?: unknown; y?: unknown };
  const x = Number(point.x);
  const y = Number(point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
}

function normalizeAnnotationColor(value: unknown) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : ANNOTATION_COLORS[0];
}

function scaleAnnotationValue(value: number) {
  return Math.round(clamp(value, 0, 1) * ANNOTATION_CANVAS_SIZE);
}

function randomClientId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `annotation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function findAnnotationItemNearPoint(items: AnnotationItem[], point: AnnotationPoint) {
  let nearest: { id: string; distance: number } | null = null;
  for (const item of items) {
    const distance = distanceToAnnotationItem(item, point);
    if (distance > 0.035) continue;
    if (!nearest || distance < nearest.distance) nearest = { id: item.id, distance };
  }
  return nearest?.id ?? "";
}

function distanceToAnnotationItem(item: AnnotationItem, point: AnnotationPoint) {
  if (item.type === "arrow") return distanceToSegment(point, item.from, item.to);
  if (item.points.length === 1) return annotationDistance(item.points[0], point);
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 1; index < item.points.length; index += 1) {
    minimum = Math.min(minimum, distanceToSegment(point, item.points[index - 1], item.points[index]));
  }
  return minimum;
}

function distanceToSegment(point: AnnotationPoint, start: AnnotationPoint, end: AnnotationPoint) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return annotationDistance(point, start);
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  return annotationDistance(point, { x: start.x + t * dx, y: start.y + t * dy });
}

function annotationDistance(a: AnnotationPoint, b: AnnotationPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
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

function startHorizontalAttachmentResize(event: ReactPointerEvent<HTMLButtonElement>, options: { minWidth: number; maxWidth: number; startWidth: number; onResize: (width: number) => void }) {
  event.preventDefault();
  event.stopPropagation();
  const handle = event.currentTarget;
  const pointerId = event.pointerId;
  const startX = event.clientX;
  const previousCursor = document.body.style.cursor;
  const previousUserSelect = document.body.style.userSelect;
  let stopped = false;

  document.body.style.cursor = "ew-resize";
  document.body.style.userSelect = "none";

  try {
    handle.setPointerCapture(pointerId);
  } catch {
    // Some browsers do not allow capture if the pointer has already ended.
  }

  function resize(pointerEvent: PointerEvent) {
    const nextWidth = clamp(Math.round(options.startWidth + pointerEvent.clientX - startX), options.minWidth, options.maxWidth);
    options.onResize(nextWidth);
  }

  function cleanup() {
    if (stopped) return;
    stopped = true;
    document.body.style.cursor = previousCursor;
    document.body.style.userSelect = previousUserSelect;
    window.removeEventListener("pointermove", resize);
    window.removeEventListener("pointerup", cleanup);
    window.removeEventListener("pointercancel", cleanup);
    window.removeEventListener("blur", cleanup);
    document.removeEventListener("visibilitychange", cleanupIfHidden);
    handle.removeEventListener("lostpointercapture", cleanup);
    try {
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }
  }

  function cleanupIfHidden() {
    if (document.hidden) cleanup();
  }

  window.addEventListener("pointermove", resize);
  window.addEventListener("pointerup", cleanup);
  window.addEventListener("pointercancel", cleanup);
  window.addEventListener("blur", cleanup);
  document.addEventListener("visibilitychange", cleanupIfHidden);
  handle.addEventListener("lostpointercapture", cleanup);
}

function startInlineAttachmentDrag() {
  document.body.classList.add(INLINE_ATTACHMENT_DRAGGING_CLASS);
  window.addEventListener("dragend", clearInlineAttachmentDragState);
  window.addEventListener("drop", clearInlineAttachmentDragState);
  window.addEventListener("blur", clearInlineAttachmentDragState);
  document.addEventListener("visibilitychange", clearInlineAttachmentDragStateIfHidden);
}

function clearInlineAttachmentDragState() {
  document.body.classList.remove(INLINE_ATTACHMENT_DRAGGING_CLASS);
  window.removeEventListener("dragend", clearInlineAttachmentDragState);
  window.removeEventListener("drop", clearInlineAttachmentDragState);
  window.removeEventListener("blur", clearInlineAttachmentDragState);
  document.removeEventListener("visibilitychange", clearInlineAttachmentDragStateIfHidden);
}

function clearInlineAttachmentDragStateIfHidden() {
  if (document.hidden) clearInlineAttachmentDragState();
}

function clearEditorDropCursor(editorDom: HTMLElement) {
  const dragEndEvent = typeof DragEvent === "function" ? new DragEvent("dragend") : new Event("dragend");
  editorDom.dispatchEvent(dragEndEvent);
}

function TextColorMenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const currentColor = normalizeTextColor(editor.getAttributes("textStyle").color);
  const activeOption = TEXT_COLOR_OPTIONS.find((option) => option.value === currentColor) ?? TEXT_COLOR_OPTIONS[0];

  function applyTextColor(color: string) {
    if (color) editor.chain().focus().setColor(color).run();
    else editor.chain().focus().unsetColor().run();
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
        title="Text color"
        aria-label="Text color"
        aria-expanded={open}
        className={`grid size-8 cursor-pointer place-items-center border text-slate-700 hover:bg-white ${currentColor ? "border-cyan-500 bg-cyan-50 text-cyan-800" : "border-transparent"}`}
      >
        <span className="relative grid size-5 place-items-center">
          <Palette size={15} />
          <span className="absolute -bottom-0.5 left-1/2 h-1 w-4 -translate-x-1/2 border border-white" style={{ backgroundColor: activeOption.swatch }} />
        </span>
      </button>
      {open ? (
        <div
          className="absolute left-0 top-full z-50 mt-1 w-44 border border-slate-300 bg-white p-1 shadow-lg"
          onMouseDown={(event) => event.preventDefault()}
        >
          {TEXT_COLOR_OPTIONS.map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => applyTextColor(option.value)}
              className={`flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100 ${option.value === currentColor ? "bg-cyan-50 text-cyan-900" : ""}`}
            >
              <span className="size-3 shrink-0 rounded-full border border-slate-300" style={{ backgroundColor: option.swatch }} />
              <span className="min-w-0 flex-1">{option.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

type ToolbarMenuItem = {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  separatorBefore?: boolean;
  focusEditor?: boolean;
};

function ToolbarMenu({
  label,
  icon,
  items,
  align = "start",
  iconOnly = false,
  disabled = false,
}: {
  label: string;
  icon: ReactNode;
  items: ToolbarMenuItem[] | (() => ToolbarMenuItem[]);
  align?: "start" | "center" | "end";
  iconOnly?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const keepEditorFocus = useRef(false);
  const resolvedItems = typeof items === "function" ? items() : items;

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={label}
          aria-label={label}
          className={`${iconOnly ? "grid size-8 place-items-center" : "inline-flex h-8 items-center gap-1.5 px-2"} cursor-pointer border text-slate-700 hover:bg-white disabled:cursor-not-allowed disabled:text-slate-400 ${open ? "border-slate-300 bg-white text-slate-900" : "border-transparent"}`}
        >
          {icon}
          {!iconOnly ? (
            <>
              <span className="text-xs font-medium">{label}</span>
              <ChevronDown size={12} aria-hidden="true" />
            </>
          ) : null}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={4}
          collisionPadding={8}
          onCloseAutoFocus={(event) => {
            if (!keepEditorFocus.current) return;
            event.preventDefault();
            keepEditorFocus.current = false;
          }}
          className="z-[1000] min-w-48 border border-slate-200 bg-white p-1 shadow-md outline-none"
        >
          <DropdownMenu.Label className="px-2 pb-1 pt-1 text-xs font-semibold text-slate-500">{label}</DropdownMenu.Label>
          {resolvedItems.map((item) => (
            <Fragment key={item.label}>
              {item.separatorBefore ? <DropdownMenu.Separator className="my-1 h-px bg-slate-200" /> : null}
              <DropdownMenu.Item
                disabled={item.disabled}
                onSelect={() => {
                  keepEditorFocus.current = Boolean(item.focusEditor);
                  item.onSelect();
                }}
                className="flex cursor-pointer select-none items-center gap-2 px-2 py-1.5 text-xs text-slate-700 outline-none data-[highlighted]:bg-slate-100 data-[highlighted]:text-slate-900 data-[disabled]:cursor-not-allowed data-[disabled]:text-slate-300"
              >
                <span className="grid size-5 shrink-0 place-items-center" aria-hidden="true">{item.icon}</span>
                <span className="min-w-0 flex-1">{item.label}</span>
              </DropdownMenu.Item>
            </Fragment>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function ExportMenu({ onExportPdf, onExportArchive, exporting }: { onExportPdf?: () => void; onExportArchive?: () => void; exporting?: boolean }) {
  const items: ToolbarMenuItem[] = [];
  if (onExportPdf) items.push({ label: "PDF", icon: <FileText size={14} />, onSelect: onExportPdf, disabled: exporting });
  if (onExportArchive) items.push({ label: "ZIP archive", icon: <FileArchive size={14} />, onSelect: onExportArchive, disabled: exporting });
  return (
    <ToolbarMenu
      label={exporting ? "Exporting" : "Export"}
      icon={exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
      items={items}
      align="end"
      iconOnly
      disabled={exporting}
    />
  );
}

function CommentComposer({ anchorRef, value, error, blockMessage, submitting, onChange, onCancel, onSubmit }: { anchorRef: RefObject<HTMLButtonElement | null>; value: string; error: string; blockMessage: string; submitting: boolean; onChange: (value: string) => void; onCancel: () => void; onSubmit: () => void }) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    function positionComposer() {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 320;
      const padding = 8;
      setPosition({
        top: rect.bottom + 8,
        left: Math.max(padding, Math.min(rect.left, window.innerWidth - width - padding)),
      });
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }

    positionComposer();
    window.addEventListener("resize", positionComposer);
    window.addEventListener("scroll", positionComposer, true);
    document.addEventListener("keydown", closeOnEscape);
    if (!blockMessage) textAreaRef.current?.focus();
    return () => {
      window.removeEventListener("resize", positionComposer);
      window.removeEventListener("scroll", positionComposer, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [anchorRef, blockMessage, onCancel]);

  if (!position) return null;
  return createPortal(
    <div className="fixed z-[1000] w-80 border border-slate-300 bg-white p-3 shadow-xl" style={{ top: position.top, left: position.left }}>
      <label className="text-xs font-semibold text-slate-700" htmlFor="comment-draft">Comment</label>
      {blockMessage ? (
        <p className="mt-2 border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-5 text-amber-900">{blockMessage}</p>
      ) : (
        <textarea
          ref={textAreaRef}
          id="comment-draft"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={4}
          className="mt-2 w-full resize-none border border-slate-300 px-2 py-1.5 text-sm text-slate-900 outline-none focus:border-cyan-500"
          placeholder="Add a comment..."
        />
      )}
      {error ? <p className="mt-2 text-xs text-rose-700">{error}</p> : null}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="h-8 border border-slate-300 bg-white px-3 text-xs text-slate-700 hover:bg-slate-100">{blockMessage ? "Close" : "Cancel"}</button>
        {!blockMessage ? (
          <button type="button" onClick={onSubmit} disabled={submitting || !value.trim()} className="inline-flex h-8 items-center gap-1.5 bg-slate-950 px-3 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300">
            {submitting ? <Loader2 size={13} className="animate-spin" /> : null}
            Comment
          </button>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

function ToolbarButton({ active, disabled = false, label, onClick, children, buttonRef }: { active?: boolean; disabled?: boolean; label: string; onClick: () => void; children: ReactNode; buttonRef?: RefObject<HTMLButtonElement | null> }) {
  return (
    <button
      ref={buttonRef}
      type="button"
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`grid size-8 cursor-pointer place-items-center border text-slate-700 hover:bg-white disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent ${active ? "border-cyan-500 bg-cyan-50 text-cyan-800" : "border-transparent"}`}
    >
      {children}
    </button>
  );
}

function TableActionIcon({ kind, action }: { kind: "row" | "column" | "table"; action: "add" | "delete" }) {
  const BaseIcon = kind === "row" ? Rows3 : kind === "column" ? Columns3 : TableIcon;
  const BadgeIcon = action === "add" ? Plus : kind === "table" ? Trash2 : Minus;
  return (
    <span className="relative inline-grid size-5 place-items-center" aria-hidden="true">
      <BaseIcon size={16} />
      <span className="absolute -bottom-0.5 -right-0.5 grid size-3 place-items-center bg-slate-50 text-slate-700">
        <BadgeIcon size={8} strokeWidth={2.7} />
      </span>
    </span>
  );
}

function normalizeTextColor(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function ToolbarDivider() {
  return <div aria-hidden="true" className="mx-1 h-6 w-px bg-slate-200" />;
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

function formatSpreadsheetCell(cell: SpreadsheetPreviewCell) {
  const value = cell.value;
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

function spreadsheetCellStyle(cell: SpreadsheetPreviewCell): CSSProperties | undefined {
  const style: CSSProperties = {};
  if (cell.backgroundColor) style.backgroundColor = cell.backgroundColor;
  if (cell.color) style.color = cell.color;
  if (cell.bold) style.fontWeight = 700;
  if (cell.italic) style.fontStyle = "italic";
  if (cell.horizontalAlign) style.textAlign = cell.horizontalAlign;
  if (cell.verticalAlign) style.verticalAlign = cell.verticalAlign;
  if (cell.wrapText) style.whiteSpace = "pre-wrap";
  return Object.keys(style).length ? style : undefined;
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
  const parsed = Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(parsed)) return value;
  const date = new Date(parsed);
  return date.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
