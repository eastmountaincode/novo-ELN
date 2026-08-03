import { ExternalLink, Loader2, RefreshCw, Workflow } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatDateTime } from "@/lib/dateTime";
import type { DatabaseSchemaOverview, DatabaseSchemaTable, ErflowAdminStatus, ErflowSyncResult } from "@/lib/types";

type SchemaResponse = {
  schema?: DatabaseSchemaOverview;
  erflow?: ErflowAdminStatus;
  result?: ErflowSyncResult;
  error?: string;
};

export function SchemaAdminPanel() {
  const [schema, setSchema] = useState<DatabaseSchemaOverview | null>(null);
  const [erflow, setErflow] = useState<ErflowAdminStatus | null>(null);
  const [syncResult, setSyncResult] = useState<ErflowSyncResult | null>(null);
  const [showInternal, setShowInternal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<"dry-run" | "sync" | "">("");
  const [error, setError] = useState("");

  async function loadSchema() {
    setLoading(true);
    setError("");
    const response = await fetch("/api/admin/schema", { cache: "no-store" });
    const body = (await response.json().catch(() => null)) as SchemaResponse | null;
    setLoading(false);
    if (!response.ok) {
      setError(body?.error ?? "Unable to load database schema.");
      return;
    }
    setSchema(body?.schema ?? null);
    setErflow(body?.erflow ?? null);
  }

  async function syncErflow(dryRun: boolean) {
    setSyncing(dryRun ? "dry-run" : "sync");
    setError("");
    setSyncResult(null);
    const response = await fetch("/api/admin/schema/erflow-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun }),
    });
    const body = (await response.json().catch(() => null)) as SchemaResponse | null;
    setSyncing("");
    if (!response.ok) {
      setError(body?.error ?? "Unable to sync ER Flow.");
      return;
    }
    setSyncResult(body?.result ?? null);
    setErflow(body?.erflow ?? erflow);
    await loadSchema();
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
        setSchema(body?.schema ?? null);
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

  const visibleTables = useMemo(() => schema?.tables.filter((table) => showInternal || !table.internal) ?? [], [schema, showInternal]);
  const configured = erflow?.configured === true;

  return (
    <section className="max-w-6xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 p-5">
        <div className="flex items-start gap-3">
          <div className="grid size-10 place-items-center border border-slate-200 bg-slate-50 text-slate-600">
            <Workflow size={21} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Schema</h2>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {erflow?.viewUrl ? (
            <a href={erflow.viewUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-50">
              <ExternalLink size={15} />
              Open ER Flow
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => void syncErflow(true)}
            disabled={!configured || Boolean(syncing)}
            className="inline-flex h-9 items-center gap-2 border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {syncing === "dry-run" ? <Loader2 size={15} className="animate-spin" /> : null}
            Dry run
          </button>
          <button
            type="button"
            onClick={() => void syncErflow(false)}
            disabled={!configured || Boolean(syncing)}
            className="inline-flex h-9 items-center gap-2 bg-slate-950 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {syncing === "sync" ? <Loader2 size={15} className="animate-spin" /> : null}
            Sync ER Flow
          </button>
          <button
            type="button"
            onClick={() => void loadSchema()}
            disabled={loading}
            className="inline-flex h-9 items-center gap-2 border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:text-slate-400"
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            Refresh
          </button>
        </div>
      </div>

      {error ? <p className="m-5 border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      {syncResult ? (
        <p className="m-5 border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {syncResult.dryRun ? "Dry run" : "ER Flow sync"} completed with {syncResult.operationCount.toLocaleString()} operations.
        </p>
      ) : null}
      {loading ? <p className="p-5 text-sm text-slate-500">Loading schema...</p> : null}

      {!loading && schema ? (
        <>
          <div className="grid gap-5 border-b border-slate-200 p-5 lg:grid-cols-4">
            <SchemaMetric label="Tables" value={schema.tableCount.toLocaleString()} />
            <SchemaMetric label="Columns" value={schema.columnCount.toLocaleString()} />
            <SchemaMetric label="Relationships" value={schema.relationshipCount.toLocaleString()} />
            <SchemaMetric label="ER Flow" value={configured ? "Configured" : "Not configured"} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-5 text-sm">
            <div className="min-w-0">
              <p className="font-medium text-slate-950">Generated {formatDateTime(schema.generatedAt)}</p>
              <p className="mt-1 truncate font-mono text-xs text-slate-500">{schema.databasePath}</p>
            </div>
            <label className="inline-flex h-9 items-center gap-2 border border-slate-300 px-3 text-slate-700 hover:bg-slate-50">
              <input checked={showInternal} onChange={(event) => setShowInternal(event.target.checked)} type="checkbox" className="size-4" />
              Show internal tables
            </label>
          </div>

          <div className="divide-y divide-slate-100">
            {visibleTables.map((table) => <SchemaTable key={table.name} table={table} />)}
          </div>
          {visibleTables.length === 0 ? <p className="p-5 text-sm text-slate-500">No tables found.</p> : null}
        </>
      ) : null}
    </section>
  );
}

function SchemaMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-normal text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-950">{value}</div>
    </div>
  );
}

function SchemaTable({ table }: { table: DatabaseSchemaTable }) {
  return (
    <details className="group">
      <summary className="grid cursor-pointer grid-cols-[minmax(0,1fr)_90px_110px_90px] gap-3 px-5 py-3 text-sm hover:bg-slate-50">
        <span className="min-w-0 truncate font-semibold text-slate-950">{table.name}</span>
        <span className="text-slate-600">{table.columns.length} cols</span>
        <span className="text-slate-600">{table.foreignKeys.length} relations</span>
        <span className="text-slate-600">{table.indexes.length} indexes</span>
      </summary>
      <div className="border-t border-slate-100 bg-slate-50 px-5 py-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="pb-2 pr-4 font-semibold">Column</th>
                <th className="pb-2 pr-4 font-semibold">Type</th>
                <th className="pb-2 pr-4 font-semibold">Flags</th>
                <th className="pb-2 pr-4 font-semibold">Default</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {table.columns.map((column) => {
                const flags = [
                  column.primaryKey ? "PK" : "",
                  table.foreignKeys.some((relationship) => relationship.fromColumn === column.name) ? "FK" : "",
                  column.notNull ? "NOT NULL" : "",
                ].filter(Boolean);
                return (
                  <tr key={column.name}>
                    <td className="py-2 pr-4 font-mono text-slate-950">{column.name}</td>
                    <td className="py-2 pr-4 font-mono text-slate-700">{column.type}</td>
                    <td className="py-2 pr-4 text-slate-600">{flags.join(", ") || "Nullable"}</td>
                    <td className="py-2 pr-4 font-mono text-slate-500">{column.defaultValue || ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {table.foreignKeys.length ? (
          <div className="mt-4 space-y-1 text-xs text-slate-600">
            {table.foreignKeys.map((relationship) => (
              <p key={`${relationship.id}-${relationship.sequence}`} className="font-mono">
                {relationship.fromColumn} -&gt; {relationship.toTable}.{relationship.toColumn}
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}
