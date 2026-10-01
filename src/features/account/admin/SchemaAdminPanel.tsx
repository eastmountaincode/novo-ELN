import { RefreshCw, Workflow } from "lucide-react";
import { useEffect, useState } from "react";
import { AdminLoadingState, AdminPanelHeader } from "@/features/account/admin/AdminPanelLayout";
import { SchemaDiagram } from "@/features/account/admin/SchemaDiagram";
import type { DatabaseSchemaOverview } from "@/lib/types";

export function SchemaAdminPanel() {
  const [schema, setSchema] = useState<DatabaseSchemaOverview | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/schema", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as { schema?: DatabaseSchemaOverview; error?: string };
        if (!response.ok || !body.schema) throw new Error(body.error || "Unable to load the schema.");
        if (!controller.signal.aborted) setSchema(body.schema);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Unable to load the schema.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh]);

  return (
    <section className="min-w-0 border border-slate-200 bg-white" aria-busy={loading}>
      <AdminPanelHeader icon={Workflow} title="Schema" action={
        <button type="button" disabled={loading} onClick={() => { setLoading(true); setError(""); setRefresh((value) => value + 1); }}
          className="inline-flex h-9 items-center gap-2 border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      } />
      {error ? <p role="alert" className="m-4 border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      {!schema && loading ? <AdminLoadingState>Loading schema...</AdminLoadingState> : null}
      {schema ? <SchemaDiagram schema={schema} /> : null}
    </section>
  );
}
