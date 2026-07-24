import { Database } from "lucide-react";
import { useEffect, useState } from "react";
import { formatBytes } from "@/lib/formatBytes";
import { formatDateTime } from "@/lib/dateTime";
import type { AdminDataOverview } from "@/lib/types";

const DATA_ADMIN_FILE_PAGE_SIZE = 25;

export function DataAdminPanel() {
  const [overview, setOverview] = useState<AdminDataOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadData(fileOffset = overview?.filePage.offset ?? 0) {
    setLoading(true);
    setError("");
    const response = await fetch(`/api/admin/data?fileLimit=${DATA_ADMIN_FILE_PAGE_SIZE}&fileOffset=${fileOffset}`);
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
    fetch(`/api/admin/data?fileLimit=${DATA_ADMIN_FILE_PAGE_SIZE}&fileOffset=0`)
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
  const filePage = overview?.filePage;
  const fileStart = filePage && filePage.total > 0 ? filePage.offset + 1 : 0;
  const fileEnd = filePage ? Math.min(filePage.offset + overview.files.length, filePage.total) : 0;
  const canPageBackward = Boolean(filePage && filePage.offset > 0);
  const canPageForward = Boolean(filePage && filePage.offset + filePage.limit < filePage.total);

  return (
    <section className="max-w-6xl border border-slate-200 bg-white">
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
        <div className="flex items-start gap-3">
          <div className="grid size-10 place-items-center border border-slate-200 bg-slate-50 text-slate-600">
            <Database size={21} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Data</h2>
          </div>
        </div>
        <button onClick={() => void loadData()} className="h-9 border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-50">Refresh</button>
      </div>

      {error ? <p className="m-5 border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      {loading ? <p className="p-5 text-sm text-slate-500">Loading data...</p> : null}

      {!loading && overview ? (
        <>
          <div className="grid gap-5 border-b border-slate-200 p-5 lg:grid-cols-3">
            {metricGroups.map((group) => <DataMetricGroup key={group.title} title={group.title} rows={group.rows} />)}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-5">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">Files</h3>
              <p className="mt-1 text-sm text-slate-500">
                Showing {fileStart.toLocaleString()}-{fileEnd.toLocaleString()} of {overview.filePage.total.toLocaleString()} attachment records.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => filePage && void loadData(Math.max(0, filePage.offset - filePage.limit))}
                disabled={!canPageBackward}
                className="h-8 border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => filePage && void loadData(filePage.offset + filePage.limit)}
                disabled={!canPageForward}
                className="h-8 border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">File</th>
                  <th className="px-4 py-3 font-semibold">Page</th>
                  <th className="px-4 py-3 font-semibold">Notebook</th>
                  <th className="px-4 py-3 font-semibold">Type</th>
                  <th className="px-4 py-3 text-right font-semibold">Size</th>
                  <th className="px-4 py-3 font-semibold">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {overview.files.map((file) => (
                  <tr key={file.id}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-950">{file.originalName}</div>
                      <div className="mt-1 truncate font-mono text-xs text-slate-500">{file.storageKey}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{file.pageTitle}</div>
                      </td>
                    <td className="px-4 py-3">
                      <div className="text-slate-700">{file.notebookName}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="capitalize text-slate-700">{file.blockType}</div>
                      <div className="mt-1 text-xs text-slate-500">{file.mimeType}</div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{formatBytes(file.size)}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDateTime(file.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {overview.files.length === 0 ? <p className="p-5 text-sm text-slate-500">No attachments found.</p> : null}
          </div>
        </>
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
