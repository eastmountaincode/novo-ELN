import { Database } from "lucide-react";
import { useEffect, useState } from "react";
import { AdminLoadingState, AdminPanelHeader } from "@/features/account/admin/AdminPanelLayout";
import { formatBytes } from "@/lib/formatBytes";
import type { AdminDataOverview } from "@/lib/types";

export function DataAdminPanel() {
  const [overview, setOverview] = useState<AdminDataOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadData() {
    setLoading(true);
    setError("");
    const response = await fetch("/api/admin/data");
    const body = (await response.json().catch(() => null)) as { data?: AdminDataOverview; error?: string } | null;
    setLoading(false);
    if (!response.ok) {
      setError(body?.error ?? "Unable to load data overview.");
      return;
    }
    setOverview(body?.data ?? null);
  }

  useEffect(() => {
    let active = true;
    fetch("/api/admin/data")
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { data?: AdminDataOverview; error?: string } | null;
        if (!active) return;
        setLoading(false);
        if (!response.ok) {
          setError(body?.error ?? "Unable to load data overview.");
          return;
        }
        setOverview(body?.data ?? null);
      })
      .catch(() => {
        if (!active) return;
        setLoading(false);
        setError("Unable to load data overview.");
      });
    return () => {
      active = false;
    };
  }, []);

  const metricGroups = overview
    ? [
        {
          title: "Records",
          rows: [
            { label: "Users", value: overview.counts.users.toLocaleString() },
            { label: "Notebooks", value: overview.counts.notebooks.toLocaleString() },
            { label: "Pages", value: overview.counts.pages.toLocaleString() },
          ],
        },
        {
          title: "Attachments",
          rows: [
            { label: "Attachment records", value: overview.counts.attachments.toLocaleString() },
            { label: "Attachment data", value: formatBytes(overview.storage.attachmentBytes) },
            { label: "Missing files", value: overview.storage.missingUploadCount.toLocaleString() },
          ],
        },
        {
          title: "Upload storage",
          rows: [
            { label: "Files on disk", value: overview.storage.uploadFileCount.toLocaleString() },
            { label: "Disk usage", value: formatBytes(overview.storage.uploadBytes) },
            { label: "Orphan files", value: overview.storage.orphanUploadCount.toLocaleString() },
            { label: "Orphan storage", value: formatBytes(overview.storage.orphanUploadBytes) },
          ],
        },
      ]
    : [];

  return (
    <section className="max-w-6xl border border-slate-200 bg-white">
      <AdminPanelHeader
        icon={Database}
        title="Data"
        action={<button onClick={() => void loadData()} className="h-9 border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-50">Refresh</button>}
      />

      {error ? <p className="m-5 border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      {loading ? <AdminLoadingState>Loading data...</AdminLoadingState> : null}

      {!loading && overview ? (
        <div className="grid max-w-xl gap-5 p-5">
          {metricGroups.map((group) => <DataMetricGroup key={group.title} title={group.title} rows={group.rows} />)}
        </div>
      ) : null}
    </section>
  );
}

function DataMetricGroup({ title, rows }: { title: string; rows: Array<{ label: string; value: string }> }) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
      <dl className="mt-2 divide-y divide-slate-100 border-y border-slate-100 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[minmax(0,1fr)_minmax(96px,auto)] gap-4 py-2">
            <dt className="text-slate-500">{row.label}</dt>
            <dd className="text-left font-medium tabular-nums text-slate-950">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
