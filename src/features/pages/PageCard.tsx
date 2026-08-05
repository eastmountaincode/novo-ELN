"use client";

import { CalendarClock, CalendarPlus, Copy, FileSignature, Loader2, Lock, MoreHorizontal, MoveRight, Paperclip, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { getPageStatusLabel, StatusDot } from "@/features/pages/PageStatus";
import { formatDateTime } from "@/lib/dateTime";
import { bodyToEditorText } from "@/lib/editor";
import type { PageEntry } from "@/lib/types";
import { colorWithAlpha, normalizeColor } from "@/lib/workspaceDisplay";

const PAGE_CARD_TINT_ALPHA = 0.035;
const PAGE_CARD_ACTIVE_ALPHA = 0.075;

type PageCardProps = {
  page: PageEntry;
  active?: boolean;
  contextLabel?: string;
  accentColor?: string;
  tinted?: boolean;
  menuOpen?: boolean;
  setMenuOpen?: (open: boolean) => void;
  onClick: () => void;
  onDuplicate?: () => void;
  duplicating?: boolean;
  onMove?: () => void;
  moveDisabled?: boolean;
  onDelete?: () => void;
  deleteDisabled?: boolean;
};

export function PageCard({
  page,
  active = false,
  contextLabel,
  accentColor = "#0891b2",
  tinted = false,
  menuOpen = false,
  setMenuOpen,
  onClick,
  onDuplicate,
  duplicating = false,
  onMove,
  moveDisabled = false,
  onDelete,
  deleteDisabled = false,
}: PageCardProps) {
  const fileCount = page.attachmentCount ?? page.attachments.length;
  const fileLabel = fileCount ? `${fileCount} files` : "No files";
  const color = normalizeColor(accentColor);
  const finalized = Boolean(page.finalizedAt);
  const cardStyle = pageCardStyle(color, { active, tinted });
  const visibleTags = page.tags.slice(0, 3);
  const previewText = useMemo(() => (page.bodyLoaded ? bodyToEditorText(page.body) : page.bodyPreview) || "Empty page", [page.body, page.bodyLoaded, page.bodyPreview]);
  return (
    <div data-page-card-id={page.id} className="group relative w-full min-w-0 max-w-full overflow-visible">
      <button
        onClick={onClick}
        className={`block min-w-0 w-full max-w-full overflow-hidden border p-3 pr-10 text-left ${active ? "" : "border-slate-200 bg-white hover:border-slate-400"}`}
        style={cardStyle}
      >
        <h3 className="min-w-0 max-w-full break-words text-sm font-semibold leading-5 text-slate-900 [overflow-wrap:anywhere]">
          {page.lockedAt ? <Lock size={13} strokeWidth={2.2} className="mr-1 inline-block align-[-1px] text-slate-500" aria-label="Locked page" /> : null}
          {finalized ? <FileSignature size={13} strokeWidth={2.1} className="mr-1 inline-block align-[-1px] text-slate-500" aria-label="Finalized page" /> : null}
          {page.title || "Untitled"}
        </h3>
        <p className="mt-2 max-h-10 min-w-0 max-w-full overflow-hidden break-words text-sm leading-5 text-slate-500 [overflow-wrap:anywhere]">{previewText}</p>
        {(page.status || visibleTags.length > 0) ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {page.status ? <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-2.5 text-[11px] font-medium text-slate-700"><StatusDot status={page.status} />{getPageStatusLabel(page.status)}</span> : null}
            {visibleTags.map((tag) => <span key={tag} className="inline-flex h-6 max-w-full items-center truncate border border-slate-200 bg-slate-100 px-2 text-[11px] font-medium text-slate-600">{tag}</span>)}
            {page.tags.length > visibleTags.length ? <span className="inline-flex h-6 items-center px-1 text-[11px] font-medium text-slate-400">+{page.tags.length - visibleTags.length} more</span> : null}
          </div>
        ) : null}
        <div className="mt-3 space-y-1 text-[11px] leading-4 text-slate-500">
          {contextLabel ? (
            <div className="truncate font-medium text-slate-600">{contextLabel}</div>
          ) : null}
          <div className="flex items-center gap-1.5">
            <CalendarPlus size={12} className="shrink-0 text-slate-400" />
            <span>Created {formatDateTime(page.createdAt)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CalendarClock size={12} className="shrink-0 text-slate-400" />
            <span>Updated {formatDateTime(page.updatedAt)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Paperclip size={12} className="shrink-0 text-slate-400" />
            <span>{fileLabel}</span>
          </div>
        </div>
      </button>
      {setMenuOpen && (onDuplicate || onMove || onDelete) ? (
        <div data-transient-menu className="absolute right-2 top-2">
          <button
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpen(!menuOpen);
            }}
            className={`grid size-7 place-items-center border text-slate-500 ${menuOpen ? "border-slate-300 bg-white" : "border-transparent bg-transparent opacity-80 hover:border-slate-300 hover:bg-white group-hover:opacity-100"}`}
            title="Page actions"
          >
            <MoreHorizontal size={16} />
          </button>
          {menuOpen ? (
            <div className="absolute right-0 top-8 z-20 w-40 border border-slate-800 bg-slate-950 py-1 text-slate-100 shadow-xl">
              {onDuplicate ? (
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuOpen(false);
                    onDuplicate();
                  }}
                  disabled={duplicating}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500"
                >
                  {duplicating ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}
                  {duplicating ? "Duplicating..." : "Duplicate"}
                </button>
              ) : null}
              {onMove ? (
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    if (moveDisabled) return;
                    setMenuOpen(false);
                    onMove();
                  }}
                  disabled={moveDisabled}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500"
                >
                  <MoveRight size={14} />
                  Move page
                </button>
              ) : null}
              {onDelete ? (
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    if (deleteDisabled) return;
                    setMenuOpen(false);
                    onDelete();
                  }}
                  disabled={deleteDisabled}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500"
                >
                  <Trash2 size={14} />
                  Delete page
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function pageCardStyle(value: string | undefined, state: { active: boolean; tinted: boolean }) {
  const color = normalizeColor(value);
  const backgroundAlpha = state.active ? PAGE_CARD_ACTIVE_ALPHA : state.tinted ? PAGE_CARD_TINT_ALPHA : null;
  if (backgroundAlpha === null) return undefined;

  return {
    backgroundColor: colorWithAlpha(color, backgroundAlpha),
    borderColor: colorWithAlpha(color, 0.65),
  };
}
