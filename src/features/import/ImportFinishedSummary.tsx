import { formatBytes } from "@/lib/formatBytes";
import { type EnexImportRun, type EnexInspection, formatDuration } from "./enexImportModel";
import { ImportProgressRow } from "./ImportProgressRow";

type ImportFinishedSummaryProps = {
  notebookName: string;
  serverPath: string;
  inspection: EnexInspection | null;
  job: EnexImportRun;
  elapsedSeconds: number;
};

export function ImportFinishedSummary({ notebookName, serverPath, inspection, job, elapsedSeconds }: ImportFinishedSummaryProps) {
  const resourceTotal = job.progress.totalResources ?? inspection?.resourceCount ?? null;
  const noteTotal = job.progress.totalNotes ?? inspection?.noteCount ?? null;

  return (
    <div className="mt-5 space-y-4">
      <div className="border border-emerald-400/30 bg-emerald-400/10 p-3">
        <p className="text-sm font-semibold text-emerald-200">Notebook created</p>
        <p className="mt-1 text-sm text-slate-300">{notebookName || job.notebookId || "Imported notebook"}</p>
      </div>
      <div className="grid gap-1 border border-white/10 bg-white/5 p-3 text-xs text-slate-400">
        <ImportProgressRow label="Pages imported" value={`${job.progress.importedNotes.toLocaleString()}${noteTotal ? ` / ${noteTotal.toLocaleString()}` : ""}`} />
        <ImportProgressRow label="ENEX resources" value={`${job.progress.importedResources.toLocaleString()}${resourceTotal ? ` / ${resourceTotal.toLocaleString()}` : ""}`} />
        {inspection ? <ImportProgressRow label="Inline media refs" value={inspection.inlineMediaCount.toLocaleString()} /> : null}
        <ImportProgressRow label="Elapsed time" value={formatDuration(elapsedSeconds)} />
        <ImportProgressRow label="Data" value={formatBytes(job.progress.processedBytes || job.progress.totalBytes)} />
        <ImportProgressRow label="Source file" value={serverPath || "ENEX import"} />
      </div>
      {inspection?.tags.length ? (
        <p className="text-xs leading-5 text-slate-400">Top tags: {inspection.tags.slice(0, 6).map((tag) => `${tag.tag} (${tag.count})`).join(", ")}</p>
      ) : null}
    </div>
  );
}
