import { History, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { AdminActivityContext, adminActivitySummary, auditActorName, auditInitials } from "@/features/activity/AuditEventDisplay";
import { formatDateTime } from "@/lib/dateTime";
import type { AdminActivityOverview } from "@/lib/types";

const ADMIN_ACTIVITY_PAGE_SIZE = 30;

export function AdminActivityPanel() {
  const [activity, setActivity] = useState<AdminActivityOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  async function loadActivity(offset = 0) {
    const append = offset > 0;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");
    const response = await fetch(`/api/admin/activity?limit=${ADMIN_ACTIVITY_PAGE_SIZE}&offset=${offset}`);
    const body = (await response.json().catch(() => null)) as { activity?: AdminActivityOverview; error?: string } | null;
    if (append) setLoadingMore(false);
    else setLoading(false);
    if (!response.ok) {
      setError(body?.error ?? "Unable to load activity.");
      return;
    }
    const nextActivity = body?.activity ?? null;
    if (!nextActivity) {
      setActivity(null);
      return;
    }
    setActivity((current) => append && current
      ? { ...nextActivity, events: [...current.events, ...nextActivity.events] }
      : nextActivity);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Preserve the existing initial-load behavior during this mechanical extraction.
    void loadActivity(0);
  }, []);

  const events = activity?.events ?? [];

  return (
    <section className="max-w-5xl border border-slate-200 bg-white">
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
        <div className="flex items-start gap-3">
          <div className="grid size-10 place-items-center border border-slate-200 bg-slate-50 text-slate-600">
            <History size={21} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Activity</h2>
          </div>
        </div>
        <button
          onClick={() => void loadActivity(0)}
          disabled={loading}
          className="inline-flex h-9 items-center gap-2 border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:text-slate-400"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          Refresh
        </button>
      </div>
      {error ? <p className="m-5 border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      {loading && !events.length ? (
        <p className="flex items-center gap-2 p-5 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" />Loading activity...</p>
      ) : null}
      {!loading && !events.length && !error ? <p className="p-5 text-sm text-slate-500">No activity recorded yet.</p> : null}
      {events.length ? (
        <div className="divide-y divide-slate-100">
          {events.map((event) => (
            <div key={event.id} className="grid grid-cols-[32px_minmax(0,1fr)] gap-3 px-5 py-4">
              <div className="grid size-8 place-items-center rounded-full bg-slate-950 text-xs font-semibold text-white">{auditInitials(event)}</div>
              <div className="min-w-0">
                <p className="whitespace-normal break-words text-sm leading-5 text-slate-700 [overflow-wrap:anywhere]">
                  <span className="font-semibold text-slate-950">{auditActorName(event)}</span>{" "}
                  {adminActivitySummary(event)}
                </p>
                <p className="mt-1 whitespace-normal break-words text-xs text-slate-500 [overflow-wrap:anywhere]">
                  <AdminActivityContext event={event} />
                </p>
                <p className="mt-1 text-xs font-medium text-slate-500">{formatDateTime(event.updatedAt)}</p>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {activity?.hasMore ? (
        <div className="border-t border-slate-100 p-5">
          <button
            type="button"
            onClick={() => void loadActivity(events.length)}
            disabled={loading || loadingMore}
            className="inline-flex h-9 w-full items-center justify-center gap-2 border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-wait disabled:text-slate-400"
          >
            {loadingMore ? <Loader2 size={14} className="animate-spin" /> : null}
            {loadingMore ? "Loading..." : "Load more activity"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
