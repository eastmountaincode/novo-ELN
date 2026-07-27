import type { JSONContent } from "@tiptap/react";
import {
  Flag,
  History,
  Lock,
  Loader2,
  Tag,
  Unlock,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PrintPageDocument } from "@/components/PrintPageDocument";
import {
  RichTextEditor,
  type InlineAttachmentAttrs,
} from "@/components/RichTextEditor";
import { PageActivityDrawer } from "@/features/editor/PageActivityDrawer";
import { PageCommentPopover } from "@/features/editor/PageCommentPopover";
import { PageAttachmentsPanel } from "@/features/editor/attachments/PageAttachmentsPanel";
import { usePageAttachments } from "@/features/editor/attachments/usePageAttachments";
import { usePageEditorController } from "@/features/editor/page/usePageEditorController";
import { PAGE_STATUS_OPTIONS, StatusDot } from "@/features/pages/PageStatus";
import type { PageUpdater } from "@/features/pages/workspacePageState";
import { normalizeTagList } from "@/lib/tags";
import type {
  AuditEvent,
  Notebook,
  PageCommentThread,
  PageEntry,
  PageStatus,
  Project,
} from "@/lib/types";
import { colorWithAlpha, projectColor } from "@/lib/workspaceDisplay";

const PAGE_ACTIVITY_PAGE_SIZE = 25;

type EditorPaneProps = {
  page: PageEntry;
  sessionScope: string;
  selectedProject?: Project;
  selectedNotebook?: Notebook;
  pageLoading: boolean;
  canEdit: boolean;
  canManageLock: boolean;
  updatePage: (pageId: string, updater: PageUpdater) => void;
  openSpreadsheet: (attachment: InlineAttachmentAttrs, onSaved?: (attachment: InlineAttachmentAttrs) => void) => void;
  openPresentation: (attachment: InlineAttachmentAttrs) => void;
  tagSuggestions: string[];
};

function filenameFromContentDisposition(disposition: string | null) {
  if (!disposition) return "";
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }
  const quotedMatch = disposition.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) return quotedMatch[1];
  const bareMatch = disposition.match(/filename=([^;]+)/i);
  return bareMatch?.[1]?.trim() ?? "";
}

function safeDownloadName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 90) || "page";
}

export function EditorPane({
  page,
  sessionScope,
  selectedProject,
  selectedNotebook,
  pageLoading,
  canEdit,
  canManageLock,
  updatePage,
  openSpreadsheet,
  openPresentation,
  tagSuggestions,
}: EditorPaneProps) {
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityEvents, setActivityEvents] = useState<AuditEvent[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityLoadingMore, setActivityLoadingMore] = useState(false);
  const [activityHasMore, setActivityHasMore] = useState(false);
  const [activityError, setActivityError] = useState("");
  const [commentThreads, setCommentThreads] = useState<PageCommentThread[]>([]);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentsError, setCommentsError] = useState("");
  const [selectedCommentThreadId, setSelectedCommentThreadId] = useState("");
  const [printPage, setPrintPage] = useState<PageEntry | null>(null);
  const [printContent, setPrintContent] = useState<JSONContent[] | undefined>(undefined);
  const [exportingPage, setExportingPage] = useState<"pdf" | "archive" | null>(null);
  const color = projectColor(selectedNotebook ?? selectedProject);
  const locked = Boolean(page.lockedAt);
  const titleFieldRef = useRef<HTMLTextAreaElement>(null);
  const closeComments = useCallback(() => setCommentsOpen(false), []);
  const pageController = usePageEditorController({
    page,
    sessionScope,
    canEdit,
    canManageLock,
    updatePage,
  });
  const effectiveCanEdit = pageController.canEdit;
  const attachments = usePageAttachments({
    page,
    canEdit: effectiveCanEdit,
    updatePage,
    reportSaveStatus: pageController.reportSaveStatus,
    successStatusClearAfterMs: pageController.successStatusClearAfterMs,
    runPageMutation: pageController.runExternalMutation,
    canApplyEditorMutation: pageController.canApplyEditorMutation,
    removeAttachmentFromDraft: pageController.removeAttachmentFromDraft,
  });

  const loadComments = useCallback(async () => {
    setCommentsLoading(true);
    setCommentsError("");
    const response = await fetch(`/api/pages/${page.id}/comments`);
    const body = (await response.json().catch(() => null)) as { threads?: PageCommentThread[]; error?: string } | null;
    setCommentsLoading(false);
    if (!response.ok) {
      setCommentsError(body?.error ?? "Could not load comments.");
      return;
    }
    setCommentThreads(body?.threads ?? []);
  }, [page.id]);

  function resizeTitleField(element: HTMLTextAreaElement | null) {
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }

  useEffect(() => {
    resizeTitleField(titleFieldRef.current);
  }, [page.id, page.title]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const response = await fetch(`/api/pages/${page.id}/comments`);
      const body = (await response.json().catch(() => null)) as { threads?: PageCommentThread[]; error?: string } | null;
      if (cancelled) return;
      setCommentsLoading(false);
      if (!response.ok) {
        setCommentsError(body?.error ?? "Could not load comments.");
        return;
      }
      setCommentThreads(body?.threads ?? []);
    })();

    return () => {
      cancelled = true;
    };
  }, [page.id]);

  useEffect(() => {
    if (!printPage) return;

    function clearPrintPage() {
      setPrintPage(null);
      setPrintContent(undefined);
    }

    document.body.classList.add("novo-printing");
    window.addEventListener("afterprint", clearPrintPage);
    return () => {
      document.body.classList.remove("novo-printing");
      window.removeEventListener("afterprint", clearPrintPage);
    };
  }, [printPage]);

  useEffect(() => {
    const element = titleFieldRef.current;
    const container = element?.parentElement;
    if (!element || !container) return;

    function handleResize() {
      resizeTitleField(element);
    }

    handleResize();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }

    const observer = new ResizeObserver(handleResize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [page.id]);

  async function loadActivity(offset: number) {
    const append = offset > 0;
    if (append) setActivityLoadingMore(true);
    else setActivityLoading(true);
    setActivityError("");
    const response = await fetch(`/api/pages/${page.id}/activity?limit=${PAGE_ACTIVITY_PAGE_SIZE}&offset=${offset}`);
    const body = (await response.json().catch(() => null)) as { events?: AuditEvent[]; hasMore?: boolean; error?: string } | null;
    if (append) setActivityLoadingMore(false);
    else setActivityLoading(false);
    if (!response.ok) {
      setActivityError(body?.error ?? "Could not load activity.");
      return;
    }
    setActivityEvents((current) => append ? [...current, ...(body?.events ?? [])] : body?.events ?? []);
    setActivityHasMore(Boolean(body?.hasMore));
  }

  async function openActivity() {
    setActivityOpen(true);
    await loadActivity(0);
  }

  function replaceCommentThread(thread: PageCommentThread) {
    setCommentThreads((current) => {
      const exists = current.some((candidate) => candidate.id === thread.id);
      const next = exists ? current.map((candidate) => candidate.id === thread.id ? thread : candidate) : [thread, ...current];
      return next.sort(compareCommentThreads);
    });
    setSelectedCommentThreadId(thread.id);
    setCommentsOpen(true);
  }

  async function createComment(input: { selectedText: string; body: string }) {
    const response = await fetch(`/api/pages/${page.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = (await response.json().catch(() => null)) as { thread?: PageCommentThread; error?: string } | null;
    if (!response.ok || !body?.thread) {
      throw new Error(body?.error ?? "Could not add comment.");
    }
    replaceCommentThread(body.thread);
    return body.thread;
  }

  async function discardComment(threadId: string) {
    const response = await fetch(`/api/comments/${threadId}?pageId=${encodeURIComponent(page.id)}`, { method: "DELETE" });
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok && response.status !== 404) {
      throw new Error(body?.error ?? "Could not discard comment.");
    }
    setCommentThreads((current) => current.filter((thread) => thread.id !== threadId));
    setSelectedCommentThreadId((current) => current === threadId ? "" : current);
  }

  async function addCommentReply(threadId: string, reply: string) {
    const mutation = pageController.runExternalMutation(async () => {
      const response = await fetch(`/api/comments/${threadId}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: reply }),
      });
      const body = (await response.json().catch(() => null)) as { thread?: PageCommentThread; error?: string } | null;
      if (!response.ok || !body?.thread) throw new Error(body?.error ?? "Could not add reply.");
      replaceCommentThread(body.thread);
    });
    if (!mutation) throw new Error("Finish locking or signing out before adding a reply.");
    await mutation;
  }

  async function deleteCommentThread(threadId: string) {
    const mutation = pageController.runEditorMutation(async ({ flushBody, adoptBody }) => {
      if (!await flushBody()) {
        throw new Error("Could not save the page before deleting the comment.");
      }
      const response = await fetch(`/api/comments/${threadId}?pageId=${encodeURIComponent(page.id)}`, { method: "DELETE" });
      const body = (await response.json().catch(() => null)) as { body?: string; error?: string } | null;
      if (!response.ok || typeof body?.body !== "string") throw new Error(body?.error ?? "Could not delete comment.");
      adoptBody(body.body, "Just now");
      setCommentThreads((current) => current.filter((thread) => thread.id !== threadId));
      setSelectedCommentThreadId("");
      setCommentsOpen(false);
    });
    if (!mutation) throw new Error("Finish locking or signing out before deleting a comment.");
    await mutation;
  }

  function printCurrentPage(selection?: { content: JSONContent[] }) {
    openPagePrintDialog(selection);
  }

  async function downloadPageExport(format: "pdf" | "archive") {
    if (exportingPage) return;
    setExportingPage(format);
    try {
      const response = await fetch(`/api/pages/${page.id}/export/${format}`);
      if (!response.ok) throw new Error(`Export failed with ${response.status}`);
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition");
      const fallbackName = `${safeDownloadName(page.title || "page")}.${format === "pdf" ? "pdf" : "zip"}`;
      const filename = filenameFromContentDisposition(disposition) || fallbackName;
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
      window.alert("Export failed. Please try again.");
    } finally {
      setExportingPage(null);
    }
  }

  function openPagePrintDialog(selection?: { content: JSONContent[] }) {
    document.body.classList.add("novo-printing");
    setPrintContent(selection?.content);
    setPrintPage({
      ...page,
      attachments: [...page.attachments],
      tags: [...page.tags],
    });
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => window.print());
    });
  }

  return (
    <>
      <section className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-white">
        <header className="border-b border-slate-200 px-6 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex min-w-0 flex-1 items-start gap-1.5">
              {locked ? <Lock size={16} strokeWidth={2.2} className="mt-1.5 shrink-0 text-slate-500" aria-label="Locked page" /> : null}
              <textarea
                ref={titleFieldRef}
                rows={1}
                value={page.title}
                readOnly={!effectiveCanEdit}
                onChange={(event) => {
                  if (!effectiveCanEdit) return;
                  const title = event.target.value.replace(/\s*\n+\s*/g, " ");
                  pageController.patchSelectedPage({ title });
                  resizeTitleField(event.currentTarget);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  event.currentTarget.blur();
                }}
                onBlur={(event) => effectiveCanEdit && void pageController.savePage({ title: event.target.value })}
                className={`min-w-0 flex-1 resize-none overflow-hidden break-words bg-transparent py-1 text-4xl font-semibold leading-tight tracking-normal text-slate-950 outline-none [overflow-wrap:anywhere] ${effectiveCanEdit ? "" : "cursor-default"}`}
              />
            </div>
            {pageController.saving ? <span className="shrink-0 px-2 py-0.5 text-xs" style={{ backgroundColor: colorWithAlpha(color, 0.1), color }}>{pageController.saving}</span> : null}
            <button
              type="button"
              onClick={() => void openActivity()}
              className="grid size-8 shrink-0 place-items-center border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-950"
              title="Page activity"
              aria-label="Page activity"
            >
              <History size={16} />
            </button>
          </div>
          <PageTagsBar tags={page.tags} canEdit={effectiveCanEdit} setPageTags={pageController.setPageTags} tagSuggestions={tagSuggestions} />
          <div className="flex items-end justify-between gap-3">
            <PageStatusRow
              status={page.status}
              canEdit={effectiveCanEdit}
              setStatus={(status) => {
                if (!effectiveCanEdit) return;
                pageController.patchSelectedPage({ status });
                void pageController.savePage({ status });
              }}
            />
            <PageLockControl locked={locked} canManage={canManageLock} blocked={pageController.lockBlocked} setLocked={pageController.setPageLocked} />
          </div>
        </header>
        <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden bg-white px-6 pb-6 pt-4">
          {pageLoading ? (
            <div className="grid min-h-[24rem] place-items-center border border-slate-200 bg-white text-sm text-slate-500">
              <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" />Loading page...</span>
            </div>
          ) : (
            <RichTextEditor
              key={`${page.id}-${effectiveCanEdit ? "edit" : "read"}`}
              pageId={page.id}
              value={pageController.editorBody}
              onChange={(body) => {
                if (effectiveCanEdit) pageController.markBodyUnsaved(body);
              }}
              onBlur={(body) => void pageController.savePage({ body })}
              uploadInlineFile={attachments.uploadInlineFile}
              onInlineAttachmentInserted={attachments.markInlineAttachmentInserted}
              openSpreadsheet={openSpreadsheet}
              openPresentation={openPresentation}
              readOnly={!effectiveCanEdit}
              onPrint={printCurrentPage}
              exporting={Boolean(exportingPage)}
              onExportPdf={() => downloadPageExport("pdf")}
              onExportArchive={() => downloadPageExport("archive")}
              onCreateComment={effectiveCanEdit ? createComment : undefined}
              onDiscardComment={discardComment}
              runEditorMutation={pageController.runEditorMutation}
              editorBusy={pageController.lockBlocked}
              onSelectCommentThread={(threadId) => {
                setSelectedCommentThreadId(threadId);
                setCommentsOpen(true);
              }}
            />
          )}
          <PageAttachmentsPanel
            page={page}
            pageLoading={pageLoading}
            canEdit={effectiveCanEdit}
            pendingUploads={attachments.pendingUploads}
            uploadAttachments={attachments.uploadAttachments}
            deleteAttachment={attachments.deleteAttachment}
          />
        </div>
      </section>
      {activityOpen ? (
        <PageActivityDrawer
          events={activityEvents}
          loading={activityLoading}
          loadingMore={activityLoadingMore}
          hasMore={activityHasMore}
          error={activityError}
          onRefresh={openActivity}
          onLoadMore={() => loadActivity(activityEvents.length)}
          onClose={() => setActivityOpen(false)}
        />
      ) : null}
      {commentsOpen ? (
        <PageCommentPopover
          key={selectedCommentThreadId}
          threads={commentThreads}
          loading={commentsLoading}
          error={commentsError}
          selectedThreadId={selectedCommentThreadId}
          canEdit={effectiveCanEdit}
          onRefresh={loadComments}
          onReply={addCommentReply}
          onDelete={deleteCommentThread}
          onClose={closeComments}
        />
      ) : null}
      {printPage && typeof document !== "undefined"
        ? createPortal(<PrintPageDocument page={printPage} notebook={selectedNotebook} content={printContent} />, document.body)
        : null}
    </>
  );
}

function compareCommentThreads(a: PageCommentThread, b: PageCommentThread) {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

function PageLockControl({ locked, canManage, blocked, setLocked }: { locked: boolean; canManage: boolean; blocked: boolean; setLocked: (locked: boolean) => Promise<void> }) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const Icon = locked ? Lock : Unlock;
  if (!canManage) return null;
  async function toggleLocked() {
    if (pending || blocked) return;
    setPending(true);
    setFailed(false);
    try {
      await setLocked(!locked);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }
  return (
    <button
      type="button"
      onClick={() => void toggleLocked()}
      disabled={pending || blocked}
      className={`inline-flex h-7 shrink-0 items-center gap-1.5 border bg-white px-2 text-xs font-medium hover:bg-slate-100 disabled:cursor-wait ${failed ? "border-rose-300 text-rose-700" : "border-slate-300 text-slate-700"}`}
      title={blocked ? "Finish the current editor action before locking" : locked ? "Unlock page" : "Lock page"}
      aria-label={blocked ? "Finish current editor action" : locked ? "Unlock page" : "Lock page"}
    >
      {pending ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />}
      <span>{pending ? (locked ? "Unlocking" : "Locking") : blocked ? "Finishing edit" : failed ? "Lock failed" : locked ? "Unlock page" : "Lock page"}</span>
    </button>
  );
}

function PageTagsBar({ tags, canEdit, setPageTags, tagSuggestions }: { tags: string[]; canEdit: boolean; setPageTags: (tags: string[]) => Promise<void>; tagSuggestions: string[] }) {
  const [tagInput, setTagInput] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const [highlightedSuggestion, setHighlightedSuggestion] = useState(0);
  const normalizedTags = useMemo(() => normalizeTagList(tags), [tags]);
  const visibleSuggestions = useMemo(() => {
    if (!canEdit) return [];
    const query = tagInput.trim().toLowerCase();
    const currentTagKeys = new Set(normalizedTags.map((tag) => tag.toLowerCase()));
    return tagSuggestions
      .filter((tag) => !currentTagKeys.has(tag.toLowerCase()))
      .filter((tag) => !query || tag.toLowerCase().includes(query))
      .slice(0, 12);
  }, [canEdit, normalizedTags, tagInput, tagSuggestions]);
  const suggestionsOpen = inputFocused && visibleSuggestions.length > 0;

  function addTag(value: string) {
    if (!canEdit) return;
    const trimmed = value.trim().replace(/\s+/g, " ");
    if (!trimmed) return;
    const canonicalTag = tagSuggestions.find((tag) => tag.toLowerCase() === trimmed.toLowerCase()) ?? trimmed;
    const nextTags = normalizeTagList([...normalizedTags, canonicalTag]);
    setTagInput("");
    if (nextTags.length !== normalizedTags.length) void setPageTags(nextTags);
  }

  function addTagInput() {
    addTag(tagInput);
  }

  function selectSuggestion(tag: string) {
    addTag(tag);
    setInputFocused(false);
  }

  function removeTag(tag: string) {
    if (!canEdit) return;
    void setPageTags(normalizedTags.filter((candidate) => candidate !== tag));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && suggestionsOpen) {
      event.preventDefault();
      setHighlightedSuggestion((index) => (index + 1) % visibleSuggestions.length);
      return;
    }
    if (event.key === "ArrowUp" && suggestionsOpen) {
      event.preventDefault();
      setHighlightedSuggestion((index) => (index - 1 + visibleSuggestions.length) % visibleSuggestions.length);
      return;
    }
    if ((event.key === "Tab" || event.key === "Enter") && suggestionsOpen && visibleSuggestions[highlightedSuggestion]) {
      event.preventDefault();
      selectSuggestion(visibleSuggestions[highlightedSuggestion]);
      return;
    }
    if (event.key === "Escape" && suggestionsOpen) {
      event.preventDefault();
      setInputFocused(false);
      return;
    }
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addTagInput();
    }
  }

  return (
    <div className="mt-2 flex min-h-8 min-w-0 flex-wrap items-center gap-1.5">
      <Tag size={15} className="mr-1 shrink-0 text-slate-400" />
      {normalizedTags.map((tag) => (
        <span key={tag} className="inline-flex h-7 max-w-full min-w-0 items-center gap-1 border border-slate-200 bg-slate-100 px-2 text-sm text-slate-700">
          <span className="min-w-0 truncate">{tag}</span>
          {canEdit ? <button type="button" onClick={() => removeTag(tag)} className="-mr-1 grid size-5 shrink-0 place-items-center text-slate-400 hover:text-slate-900" aria-label={`Remove ${tag} tag`}>
            <X size={13} />
          </button> : null}
        </span>
      ))}
      {canEdit ? (
        <div className="relative min-w-44 flex-1">
          <input
            value={tagInput}
            onChange={(event) => {
              setTagInput(event.target.value);
              setInputFocused(true);
              setHighlightedSuggestion(0);
            }}
            onFocus={() => {
              setInputFocused(true);
              setHighlightedSuggestion(0);
            }}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              addTagInput();
              setInputFocused(false);
            }}
            className="h-7 w-full border-0 bg-transparent px-1 text-sm text-slate-700 outline-none placeholder:text-slate-400"
            placeholder="Type to add..."
            role="combobox"
            aria-expanded={suggestionsOpen}
            aria-controls="page-tag-suggestions"
          />
          {suggestionsOpen ? (
            <div id="page-tag-suggestions" role="listbox" className="absolute left-0 top-full z-30 mt-1 max-h-60 w-72 overflow-y-auto border border-slate-200 bg-white py-1 text-sm shadow-lg">
              {visibleSuggestions.map((tag, index) => (
                <button
                  key={tag}
                  type="button"
                  role="option"
                  aria-selected={index === highlightedSuggestion}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setHighlightedSuggestion(index)}
                  onClick={() => selectSuggestion(tag)}
                  className={`flex h-8 w-full cursor-pointer items-center px-3 text-left ${index === highlightedSuggestion ? "bg-slate-100 text-slate-950" : "text-slate-700 hover:bg-slate-50 hover:text-slate-950"}`}
                >
                  <span className="min-w-0 truncate">{tag}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PageStatusRow({ status, canEdit, setStatus }: { status: PageStatus; canEdit: boolean; setStatus: (status: PageStatus) => void }) {
  return (
    <div className="mt-1 flex min-h-8 flex-wrap items-center gap-1.5 text-sm">
      <Flag size={15} className="mr-1 shrink-0 text-slate-400" />
      <div className="inline-flex h-8 items-center gap-1.5 rounded-full border border-slate-300 bg-white pl-3 pr-1 hover:border-slate-400 focus-within:border-cyan-500">
        <StatusDot status={status} />
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as PageStatus)}
          disabled={!canEdit}
          className="h-7 w-36 cursor-pointer border-0 bg-transparent px-0 text-sm font-medium text-slate-700 outline-none disabled:cursor-not-allowed disabled:text-slate-500"
          aria-label="Page status"
        >
          {PAGE_STATUS_OPTIONS.map((option) => <option key={option.label} value={option.value}>{option.label}</option>)}
        </select>
      </div>
    </div>
  );
}
