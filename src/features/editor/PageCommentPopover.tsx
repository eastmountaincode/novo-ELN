import { Loader2, MessageSquare, RefreshCw, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatDateTime } from "@/lib/dateTime";
import type { PageCommentThread } from "@/lib/types";
import { userInitials } from "@/lib/workspaceDisplay";

type PageCommentPopoverProps = {
  threads: PageCommentThread[];
  loading: boolean;
  error: string;
  selectedThreadId: string;
  canEdit: boolean;
  onRefresh: () => Promise<void>;
  onReply: (threadId: string, reply: string) => Promise<void>;
  onDelete: (threadId: string) => Promise<void>;
  onClose: () => void;
};

export function PageCommentPopover({
  threads,
  loading,
  error,
  selectedThreadId,
  canEdit,
  onRefresh,
  onReply,
  onDelete,
  onClose,
}: PageCommentPopoverProps) {
  const [reply, setReply] = useState("");
  const [pending, setPending] = useState("");
  const [localError, setLocalError] = useState("");
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const selectedThread = threads.find((thread) => thread.id === selectedThreadId) ?? null;

  useEffect(() => {
    if (!selectedThreadId) return;

    function positionPopover() {
      const width = 360;
      const margin = 16;
      const selector = `[data-comment-thread-id="${CSS.escape(selectedThreadId)}"]`;
      const mark = document.querySelector<HTMLElement>(selector);
      const rect = mark?.getBoundingClientRect();
      const fallbackTop = 150;
      const fallbackLeft = window.innerWidth - width - margin;
      if (!rect) {
        setPosition({
          top: Math.max(margin, Math.min(fallbackTop, window.innerHeight - 180)),
          left: Math.max(margin, fallbackLeft),
        });
        return;
      }

      const placeRight = rect.right + margin + width <= window.innerWidth - margin;
      const left = placeRight ? rect.right + margin : Math.max(margin, rect.left - width - margin);
      const top = Math.max(margin, Math.min(rect.top - 12, window.innerHeight - 260));
      setPosition({ top, left });
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    function closeOnOutsidePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (popoverRef.current?.contains(target)) return;
      if (target.closest("[data-comment-thread-id]")) return;
      onClose();
    }

    positionPopover();
    window.addEventListener("resize", positionPopover);
    window.addEventListener("scroll", positionPopover, true);
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointerDown);
    return () => {
      window.removeEventListener("resize", positionPopover);
      window.removeEventListener("scroll", positionPopover, true);
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
    };
  }, [onClose, selectedThreadId]);

  async function submitReply() {
    if (!selectedThread || pending) return;
    const body = reply.trim();
    if (!body) return;
    setPending("reply");
    setLocalError("");
    try {
      await onReply(selectedThread.id, body);
      setReply("");
    } catch (replyError) {
      setLocalError(replyError instanceof Error ? replyError.message : "Could not add reply.");
    } finally {
      setPending("");
    }
  }

  async function deleteSelectedThread() {
    if (!selectedThread || pending) return;
    setPending("delete");
    setLocalError("");
    try {
      await onDelete(selectedThread.id);
    } catch (deleteError) {
      setLocalError(deleteError instanceof Error ? deleteError.message : "Could not delete comment.");
    } finally {
      setPending("");
    }
  }

  if (!position) return null;

  return createPortal(
    <div ref={popoverRef} className="fixed z-[1000] w-[360px] max-w-[calc(100vw-32px)] border border-slate-200 bg-white shadow-2xl" style={{ top: position.top, left: position.left }}>
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MessageSquare size={16} className="text-slate-950" />
            <h2 className="text-sm font-semibold text-slate-950">Comment</h2>
          </div>
          {selectedThread ? <p className="mt-1 truncate text-xs text-slate-500">{selectedThread.selectedText || "Commented text was removed"}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={() => void onRefresh()} disabled={loading} className="grid size-7 place-items-center border border-transparent text-slate-500 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-wait disabled:text-slate-300" aria-label="Refresh comment thread" title="Refresh comment thread">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
          {selectedThread && canEdit ? (
            <button type="button" onClick={() => void deleteSelectedThread()} disabled={Boolean(pending)} className="grid size-7 place-items-center border border-transparent text-slate-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-wait disabled:text-slate-300" aria-label="Delete comment thread" title="Delete comment thread">
              {pending === "delete" ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={15} />}
            </button>
          ) : null}
          <button type="button" onClick={onClose} className="grid size-7 place-items-center border border-transparent text-slate-500 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900" aria-label="Close" title="Close">
            <X size={15} />
          </button>
        </div>
      </div>
      <div className="max-h-[420px] overflow-y-auto p-4">
        {error ? <p className="mb-3 border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
        {localError ? <p className="mb-3 border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{localError}</p> : null}
        {loading && !selectedThread ? <p className="inline-flex items-center gap-2 text-sm text-slate-500"><Loader2 size={15} className="animate-spin" />Loading comment...</p> : null}
        {!loading && !selectedThread ? <p className="text-sm text-slate-500">This comment could not be found.</p> : null}
        {selectedThread ? (
          <>
            <div className="space-y-4">
              {selectedThread.comments.map((comment) => (
                <div key={comment.id} className="grid grid-cols-[32px_minmax(0,1fr)] gap-3">
                  <div className="grid size-8 place-items-center rounded-full bg-slate-950 text-xs font-semibold text-white">{userInitials({ firstName: comment.userFirstName, lastName: comment.userLastName, email: comment.userEmail })}</div>
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                      <p className="text-sm font-semibold text-slate-950">{commentAuthorName(comment)}</p>
                      <p className="text-xs font-medium text-slate-500">{formatDateTime(comment.createdAt)}</p>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-slate-700">{comment.body}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 border-t border-slate-200 pt-3">
              {canEdit ? (
                <>
                  <textarea value={reply} onChange={(event) => setReply(event.target.value)} rows={2} placeholder="Reply..." className="w-full resize-none border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cyan-500" />
                  <div className="mt-2 flex justify-end">
                    <button type="button" onClick={() => void submitReply()} disabled={Boolean(pending) || !reply.trim()} className="inline-flex h-8 items-center gap-1.5 bg-slate-950 px-3 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300">
                      {pending === "reply" ? <Loader2 size={13} className="animate-spin" /> : null}
                      Reply
                    </button>
                  </div>
                </>
              ) : <p className="text-sm text-slate-500">You can view this comment, but you do not have edit access to reply.</p>}
            </div>
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

function commentAuthorName(comment: PageCommentThread["comments"][number]) {
  return [comment.userFirstName, comment.userLastName].filter(Boolean).join(" ") || comment.userEmail || "Unknown user";
}
