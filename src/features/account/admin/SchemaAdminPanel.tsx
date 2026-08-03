import { ExternalLink, Loader2, Workflow } from "lucide-react";
import { useEffect, useState } from "react";
import type { ErflowAdminStatus, ErflowSyncResult } from "@/lib/types";

type SchemaResponse = {
  erflow?: ErflowAdminStatus;
  result?: ErflowSyncResult;
  error?: string;
};

export function SchemaAdminPanel() {
  const [erflow, setErflow] = useState<ErflowAdminStatus | null>(null);
  const [syncResult, setSyncResult] = useState<ErflowSyncResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");

  async function loadSchema() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/schema", { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as SchemaResponse | null;
      if (!response.ok) {
        setError(body?.error ?? "Unable to load database schema.");
        return;
      }
      setErflow(body?.erflow ?? null);
    } catch {
      setError("Unable to load database schema.");
    } finally {
      setLoading(false);
    }
  }

  async function syncErflow() {
    setSyncing(true);
    setError("");
    setSyncResult(null);
    try {
      const response = await fetch("/api/admin/schema/erflow-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false }),
      });
      const body = (await response.json().catch(() => null)) as SchemaResponse | null;
      if (!response.ok) {
        setError(body?.error ?? "Unable to sync ER Flow.");
        return;
      }
      setSyncResult(body?.result ?? null);
      setErflow(body?.erflow ?? erflow);
      await loadSchema();
    } catch {
      setError("Unable to sync ER Flow.");
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    let active = true;
    fetch("/api/admin/schema", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as SchemaResponse | null;
        if (!active) return;
        setLoading(false);
        if (!response.ok) {
          setError(body?.error ?? "Unable to load database schema.");
          return;
        }
        setErflow(body?.erflow ?? null);
      })
      .catch(() => {
        if (!active) return;
        setLoading(false);
        setError("Unable to load database schema.");
      });
    return () => {
      active = false;
    };
  }, []);

  const configured = erflow?.configured === true;
  const syncedAt = syncResult ? new Date(syncResult.syncedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";

  return (
    <section className="max-w-3xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 p-5">
        <div className="flex items-start gap-3">
          <div className="grid size-10 place-items-center border border-slate-200 bg-slate-50 text-slate-600">
            <Workflow size={21} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Schema</h2>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span
            className={`inline-flex h-9 items-center border px-3 font-medium ${
              configured ? "border-cyan-200 bg-cyan-50 text-cyan-800" : "border-slate-200 bg-slate-50 text-slate-500"
            }`}
          >
            {configured ? "ER Flow configured" : "ER Flow not configured"}
          </span>
        </div>
      </div>

      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void syncErflow()}
            disabled={loading || !configured || syncing}
            className="inline-flex h-9 items-center gap-2 bg-slate-950 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {syncing ? <Loader2 size={15} className="animate-spin" /> : <Workflow size={15} />}
            Sync ER Flow
          </button>
          {erflow?.viewUrl ? (
            <a
              href={erflow.viewUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-2 border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <ExternalLink size={15} />
              Open ER Flow
            </a>
          ) : (
            <button
              type="button"
              disabled
              className="inline-flex h-9 cursor-not-allowed items-center gap-2 border border-slate-200 px-3 text-sm font-medium text-slate-400"
            >
              <ExternalLink size={15} />
              Open ER Flow
            </button>
          )}
        </div>

        {loading ? <p className="text-sm text-slate-500">Checking ER Flow...</p> : null}
        {!loading && !configured ? (
          <p className="border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">ER Flow is not configured for this environment.</p>
        ) : null}
        {error ? <p className="border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
        {syncResult ? (
          <p className="border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm text-cyan-800">
            Synced {syncResult.tableCount.toLocaleString()} tables and {syncResult.relationshipCount.toLocaleString()} relationships to ER Flow
            {syncedAt ? ` at ${syncedAt}` : ""}.
          </p>
        ) : null}
      </div>
    </section>
  );
}
