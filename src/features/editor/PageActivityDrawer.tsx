import { Loader2, RefreshCw, X } from "lucide-react";
import { auditActorName, auditInitials } from "@/features/activity/AuditEventDisplay";
import { formatDateTime } from "@/lib/dateTime";
import type { AuditEvent } from "@/lib/types";

type PageActivityDrawerProps = {
  events: AuditEvent[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string;
  onRefresh: () => Promise<void>;
  onLoadMore: () => Promise<void>;
  onClose: () => void;
};

export function PageActivityDrawer({
  events,
  loading,
  loadingMore,
  hasMore,
  error,
  onRefresh,
  onLoadMore,
  onClose,
}: PageActivityDrawerProps) {
  return (
    <aside className="fixed inset-y-0 right-0 z-50 flex w-[420px] max-w-[calc(100vw-32px)] flex-col overflow-x-hidden border-l border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <h2 className="text-lg font-semibold text-slate-950">Activity</h2>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void onRefresh()} disabled={loading} className="inline-flex h-8 items-center gap-2 border border-slate-300 bg-white px-3 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-950 disabled:cursor-wait disabled:text-slate-400" aria-label="Refresh activity">
            {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            <span>Refresh</span>
          </button>
          <button type="button" onClick={onClose} className="grid size-8 place-items-center border border-slate-300 bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-950" aria-label="Close activity">
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-5">
        {error ? <p className="mb-4 border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
        {loading && !events.length ? (
          <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" />Loading activity...</div>
        ) : null}
        {!loading && !events.length && !error ? <p className="text-sm text-slate-500">No activity recorded for this page yet.</p> : null}
        <div className="space-y-5">
          {events.map((event) => (
            <div key={event.id} className="grid grid-cols-[32px_minmax(0,1fr)] gap-3">
              <div className="grid size-8 place-items-center rounded-full bg-slate-950 text-xs font-semibold text-white">{auditInitials(event)}</div>
              <div className="min-w-0">
                <p className="whitespace-normal break-words text-sm leading-5 text-slate-700 [overflow-wrap:anywhere]">
                  <span className="font-semibold text-slate-950">{auditActorName(event)}</span>{" "}
                  {event.summary}
                </p>
                <p className="mt-1 text-xs font-medium text-slate-500">{formatDateTime(event.updatedAt)}</p>
              </div>
            </div>
          ))}
        </div>
        {hasMore ? (
          <button
            type="button"
            onClick={() => void onLoadMore()}
            disabled={loading || loadingMore}
            className="mt-5 inline-flex h-9 w-full items-center justify-center gap-2 border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-wait disabled:text-slate-400"
          >
            {loadingMore ? <Loader2 size={14} className="animate-spin" /> : null}
            {loadingMore ? "Loading..." : "Load more activity"}
          </button>
        ) : null}
      </div>
    </aside>
  );
}
