import type { JSONContent } from "@tiptap/react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  FileSignature,
  Flag,
  History,
  Lock,
  Loader2,
  MoreHorizontal,
  Tag,
  Unlock,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ModalFrame } from "@/components/ModalFrame";
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
import { attachmentIdsFromBody } from "@/lib/editor";
import { formatBytes } from "@/lib/formatBytes";
import { normalizeTagList } from "@/lib/tags";
import type {
  AuditEvent,
  Notebook,
  PageCommentThread,
  PageEntry,
  PageSignature,
  PageStatus,
  Project,
} from "@/lib/types";
import { colorWithAlpha, projectColor } from "@/lib/workspaceDisplay";

const PAGE_ACTIVITY_PAGE_SIZE = 25;

type PageExportFormat = "pdf" | "archive" | "record";

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

function textByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
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
  const [exportingPage, setExportingPage] = useState<PageExportFormat | null>(null);
  const [signingOpen, setSigningOpen] = useState(false);
  const [pageActionsOpen, setPageActionsOpen] = useState(false);
  const [pageSignatures, setPageSignatures] = useState<PageSignature[]>([]);
  const [signaturesLoading, setSignaturesLoading] = useState(false);
  const [signaturesError, setSignaturesError] = useState("");
  const [downloadingFinalizationId, setDownloadingFinalizationId] = useState("");
  const color = projectColor(selectedNotebook ?? selectedProject);
  const locked = Boolean(page.lockedAt);
  const finalizedSignature = pageSignatures.find((signature) => signature.pageId === page.id) ?? null;
  const finalized = Boolean(finalizedSignature || page.finalizedAt);
  const titleFieldRef = useRef<HTMLTextAreaElement>(null);
  const pageActionsRef = useRef<HTMLDivElement>(null);
  const closeComments = useCallback(() => setCommentsOpen(false), []);
  const pageController = usePageEditorController({
    page,
    sessionScope,
    canEdit,
    canManageLock,
    updatePage,
  });
  const inlineAttachmentIds = useMemo(
    () => new Set(attachmentIdsFromBody(pageController.editorBody)),
    [pageController.editorBody],
  );
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
    let cancelled = false;

    void (async () => {
      setSignaturesLoading(true);
      setSignaturesError("");
      const response = await fetch(`/api/pages/${page.id}/proof/sign`);
      const body = (await response.json().catch(() => null)) as { signatures?: PageSignature[]; error?: string } | null;
      if (cancelled) return;
      setSignaturesLoading(false);
      if (!response.ok) {
        setSignaturesError(body?.error ?? "Could not load finalization.");
        setPageSignatures([]);
        return;
      }
      setPageSignatures(body?.signatures ?? []);
    })();

    return () => {
      cancelled = true;
    };
  }, [page.id]);

  useEffect(() => {
    if (!pageActionsOpen) return;

    function isInsidePageActions(target: EventTarget | null) {
      return target instanceof Element && Boolean(pageActionsRef.current?.contains(target));
    }

    function closePageActions() {
      setPageActionsOpen(false);
    }

    function onPointerDown(event: PointerEvent) {
      if (!isInsidePageActions(event.target)) closePageActions();
    }

    function onFocusIn(event: FocusEvent) {
      if (!isInsidePageActions(event.target)) closePageActions();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closePageActions();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [pageActionsOpen]);

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

  async function downloadPageExport(format: PageExportFormat) {
    if (exportingPage) return;
    setExportingPage(format);
    try {
      if (format === "record") {
        const flushResults = await pageController.flush();
        if (!flushResults.every(Boolean)) throw new Error("Could not save the current page before creating a record package.");
      }
      const endpoint = format === "record"
        ? `/api/pages/${page.id}/proof/record`
        : `/api/pages/${page.id}/export/${format}`;
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error(`Export failed with ${response.status}`);
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition");
      const fallbackName = `${safeDownloadName(page.title || "page")}.${format === "pdf" ? "pdf" : format === "record" ? "record.zip" : "zip"}`;
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
      window.alert(format === "record" ? "Record package export failed. Please try again." : "Export failed. Please try again.");
    } finally {
      setExportingPage(null);
    }
  }


  async function signPageRecord(signingPassphrase: string, reportProgress: (message: string) => void): Promise<PageSignature> {
    if (finalized) throw new Error("This page is already finalized.");
    reportProgress("Saving page");
    const flushResults = await pageController.flush();
    if (!flushResults.every(Boolean)) throw new Error("Could not save the current page before finalizing.");

    reportProgress("Creating record package");
    const response = await fetch(`/api/pages/${page.id}/proof/sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signingPassphrase }),
    });
    const body = (await response.json().catch(() => null)) as { signature?: PageSignature; page?: PageEntry; error?: string } | null;
    if (!response.ok || !body?.signature) throw new Error(body?.error ?? `Finalization failed with ${response.status}`);
    if (body.page) pageController.patchSelectedPage(body.page);
    setPageSignatures([body.signature]);
    if (activityOpen) await loadActivity(0);
    return body.signature;
  }

  async function downloadFinalizationPackage(signature: PageSignature) {
    if (downloadingFinalizationId) return;
    setDownloadingFinalizationId(signature.id);
    try {
      const response = await fetch(`/api/pages/${page.id}/proof/finalization/${signature.id}`);
      if (!response.ok) throw new Error(`Finalization package download failed with ${response.status}`);
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition");
      const filename = filenameFromContentDisposition(disposition) || `${safeDownloadName(page.title || "page")}.finalization.zip`;
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
      window.alert("Finalization package download failed. Please try again.");
    } finally {
      setDownloadingFinalizationId("");
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
              {finalized ? <FileSignature size={16} strokeWidth={2.1} className="mt-1.5 shrink-0 text-slate-500" aria-label="Finalized page" /> : null}
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
            <PageActionsMenu
              menuRef={pageActionsRef}
              open={pageActionsOpen}
              setOpen={setPageActionsOpen}
              locked={locked}
              finalized={finalized}
              canManage={canManageLock}
              blocked={pageController.lockBlocked}
              finalizationLoading={signaturesLoading}
              setLocked={pageController.setPageLocked}
              onFinalize={() => setSigningOpen(true)}
            />
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
              onExportRecordPackage={() => downloadPageExport("record")}
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
            inlineAttachmentIds={inlineAttachmentIds}
            pendingUploads={attachments.pendingUploads}
            uploadAttachments={attachments.uploadAttachments}
            deleteAttachment={attachments.deleteAttachment}
          />
          {finalizedSignature ? (
            <PageFinalizationPanel
              signature={finalizedSignature}
              signaturesError={signaturesError}
              downloading={downloadingFinalizationId === finalizedSignature.id}
              onDownload={() => void downloadFinalizationPackage(finalizedSignature)}
            />
          ) : null}
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
      {signingOpen ? (
        <PageSignatureModal
          pageTitle={page.title}
          onSign={signPageRecord}
          onClose={() => setSigningOpen(false)}
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


function PageActionsMenu({
  menuRef,
  open,
  setOpen,
  locked,
  finalized,
  canManage,
  blocked,
  finalizationLoading,
  setLocked,
  onFinalize,
}: {
  menuRef: RefObject<HTMLDivElement | null>;
  open: boolean;
  setOpen: (open: boolean) => void;
  locked: boolean;
  finalized: boolean;
  canManage: boolean;
  blocked: boolean;
  finalizationLoading: boolean;
  setLocked: (locked: boolean) => Promise<void>;
  onFinalize: () => void;
}) {
  const [pendingLock, setPendingLock] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!canManage) return null;

  async function toggleLocked() {
    if (pendingLock || blocked || finalized) return;
    setPendingLock(true);
    setFailed(false);
    try {
      await setLocked(!locked);
      setOpen(false);
    } catch {
      setFailed(true);
    } finally {
      setPendingLock(false);
    }
  }

  function finalizePage() {
    if (blocked || finalized || finalizationLoading) return;
    setOpen(false);
    onFinalize();
  }

  const lockDisabled = pendingLock || blocked || finalized;
  const finalizeDisabled = blocked || finalized || finalizationLoading;

  return (
    <div ref={menuRef} data-transient-menu="true" className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="grid size-8 place-items-center border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-950"
        title="Page actions"
        aria-label="Page actions"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <MoreHorizontal size={16} />
      </button>
      {open ? (
        <section
          role="dialog"
          aria-label="Page actions"
          className="absolute right-0 top-10 z-30 w-52 border border-slate-800 bg-slate-950 py-1 text-slate-100 shadow-xl"
        >
          <button
            type="button"
            onClick={finalizePage}
            disabled={finalizeDisabled}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500"
            title={finalized ? "This page is already finalized" : blocked ? "Finish the current editor action before finalizing" : "Finalize page"}
          >
            {finalizationLoading ? <Loader2 size={14} className="animate-spin" /> : <FileSignature size={14} />}
            {finalized ? "Finalized" : "Finalize page"}
          </button>
          <button
            type="button"
            onClick={() => void toggleLocked()}
            disabled={lockDisabled}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500 ${failed ? "text-rose-300" : "text-slate-100"}`}
            title={finalized ? "Finalized pages cannot be unlocked" : blocked ? "Finish the current editor action before locking" : locked ? "Unlock page" : "Lock page"}
          >
            {pendingLock ? <Loader2 size={14} className="animate-spin" /> : locked ? <Lock size={14} /> : <Unlock size={14} />}
            {pendingLock ? (locked ? "Unlocking..." : "Locking...") : failed ? "Lock failed" : finalized ? "Locked" : locked ? "Unlock page" : "Lock page"}
          </button>
        </section>
      ) : null}
    </div>
  );
}

function PageSignatureModal({
  pageTitle,
  onSign,
  onClose,
}: {
  pageTitle: string;
  onSign: (signingPassphrase: string, reportProgress: (message: string) => void) => Promise<PageSignature>;
  onClose: () => void;
}) {
  const [signingPassphrase, setSigningPassphrase] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [signature, setSignature] = useState<PageSignature | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || signature) return;
    setSubmitting(true);
    setError("");
    try {
      const createdSignature = await onSign(signingPassphrase, setProgress);
      setSignature(createdSignature);
      setSigningPassphrase("");
      setProgress("Finalized");
    } catch (caught) {
      setProgress("");
      setError(caught instanceof Error ? caught.message : "Could not finalize page.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalFrame>
      <form onSubmit={(event) => void submit(event)} className="space-y-4" role="dialog" aria-modal="true" aria-label="Finalize page">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-white">Finalize page</h2>
            <p className="mt-1 truncate text-sm text-slate-400">{pageTitle || "Untitled page"}</p>
          </div>
          <button type="button" onClick={onClose} className="grid size-8 shrink-0 place-items-center text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Close signing dialog">
            <X size={16} />
          </button>
        </div>

        {signature ? (
          <div className="space-y-3 border border-white/10 bg-white/5 p-3 text-sm text-slate-100">
            <div className="flex items-center gap-2 font-medium"><FileSignature size={15} />Finalized</div>
            <dl className="space-y-2 text-xs text-slate-200">
              {signature.timestamps[0] ? (
                <div>
                  <dt className="text-slate-400">Timestamp</dt>
                  <dd className="mt-1">{signature.timestamps[0].provider}: {signature.timestamps[0].tsaTime || "timestamp token stored"}</dd>
                </div>
              ) : null}
              {signature.proofHash ? (
                <div>
                  <dt className="text-slate-400">Proof hash</dt>
                  <dd className="mt-1 break-all font-mono">{signature.proofHash}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-slate-400">Record hash</dt>
                <dd className="mt-1 break-all font-mono">{signature.recordHash}</dd>
              </div>
              {signature.recordPackageStorageKey ? (
                <div>
                  <dt className="text-slate-400">Record package</dt>
                  <dd className="mt-1">Stored: {signature.recordPackageBytes.toLocaleString()} bytes</dd>
                </div>
              ) : null}
              {signature.finalizationPackageStorageKey ? (
                <div>
                  <dt className="text-slate-400">Finalization package</dt>
                  <dd className="mt-1">Stored: {signature.finalizationPackageBytes.toLocaleString()} bytes</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-slate-400">Signature ID</dt>
                <dd className="mt-1 break-all font-mono">{signature.id}</dd>
              </div>
            </dl>
          </div>
        ) : (
          <>
            <label className="block text-sm font-medium text-slate-200">
              Signing passphrase
              <input
                type="password"
                value={signingPassphrase}
                onChange={(event) => setSigningPassphrase(event.target.value)}
                className="mt-2 h-10 w-full border border-white/10 bg-slate-950 px-3 text-sm text-white outline-none focus:border-white/30"
                autoFocus
              />
            </label>
            {progress ? (
              <div className="flex items-center gap-2 text-sm text-slate-300">
                <Loader2 size={15} className="animate-spin" />
                <span>{progress}</span>
              </div>
            ) : null}
            {error ? <p className="text-sm text-rose-300">{error}</p> : null}
          </>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="h-9 border border-white/10 px-3 text-sm text-slate-200 hover:bg-white/10">
            {signature ? "Close" : "Cancel"}
          </button>
          {!signature ? (
            <button type="submit" disabled={submitting || signingPassphrase.length === 0} className="inline-flex h-9 items-center gap-2 bg-white px-3 text-sm font-medium text-slate-950 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60">
              {submitting ? <Loader2 size={15} className="animate-spin" /> : <FileSignature size={15} />}
              <span>{submitting ? "Finalizing" : "Finalize page"}</span>
            </button>
          ) : null}
        </div>
      </form>
    </ModalFrame>
  );
}


function PageFinalizationPanel({
  signature,
  signaturesError,
  downloading,
  onDownload,
}: {
  signature: PageSignature;
  signaturesError: string;
  downloading: boolean;
  onDownload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const timestamp = signature.timestamps[0];
  const signerName = [signature.signerFirstName, signature.signerLastName].filter(Boolean).join(" ") || signature.signerEmail;
  const proofPackageBytes = textByteLength(signature.proofPackageJson);
  return (
    <section className="mt-4 border border-slate-200 bg-slate-50 p-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-800 hover:text-slate-950"
          aria-expanded={open}
        >
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <FileSignature size={16} className="text-slate-600" />
          <span>Finalization</span>
        </button>
        <button
          type="button"
          onClick={onDownload}
          disabled={downloading || !signature.timestamps.length}
          className="inline-flex h-7 items-center gap-1 border border-slate-300 bg-white px-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          title={signature.timestamps.length ? "Download finalization package" : "Finalization package is not available"}
        >
          {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          <span>{downloading ? "Downloading" : "Download package"}</span>
        </button>
      </div>
      {open ? (
        <div className="mt-3 px-2 pb-2">
          <div className="grid gap-x-8 gap-y-2 text-sm text-slate-700 sm:grid-cols-2">
            <div><span className="font-medium text-slate-900">Signed by:</span> {signerName}</div>
            <div><span className="font-medium text-slate-900">Timestamp:</span> {timestamp ? `${timestamp.provider}, ${timestamp.tsaTime || timestamp.createdAt}` : "Stored"}</div>
            <div><span className="font-medium text-slate-900">Record package:</span> {formatBytes(signature.recordPackageBytes)}</div>
            <div><span className="font-medium text-slate-900">Proof package:</span> {formatBytes(proofPackageBytes)}</div>
            {signature.finalizationPackageBytes ? (
              <div><span className="font-medium text-slate-900">Finalization package:</span> {formatBytes(signature.finalizationPackageBytes)}</div>
            ) : null}
          </div>
          {signaturesError ? <p className="mt-2 text-xs text-rose-700">{signaturesError}</p> : null}
          <button
            type="button"
            onClick={() => setDetailsOpen((current) => !current)}
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-slate-700 hover:text-slate-950"
            aria-expanded={detailsOpen}
          >
            {detailsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Details
          </button>
          {detailsOpen ? (
            <dl className="mt-2 grid gap-2 text-xs text-slate-700">
              <div>
                <dt className="font-medium text-slate-900">Proof hash</dt>
                <dd className="mt-1 break-all font-mono">{signature.proofHash}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-900">Record hash</dt>
                <dd className="mt-1 break-all font-mono">{signature.recordHash}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-900">Signature ID</dt>
                <dd className="mt-1 break-all font-mono">{signature.id}</dd>
              </div>
            </dl>
          ) : null}
        </div>
      ) : null}
    </section>
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
