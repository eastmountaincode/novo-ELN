"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ModalFrame } from "@/components/ModalFrame";
import { formatBytes } from "@/lib/formatBytes";
import type { Notebook, Project } from "@/lib/types";
import {
  type EnexImportRun,
  type EnexInspection,
  estimateRemainingSeconds,
  formatDuration,
  readEnexImportStream,
  secondsBetween,
} from "./enexImportModel";
import { ImportFinishedSummary } from "./ImportFinishedSummary";
import { ImportMetric } from "./ImportMetric";
import { ImportProgressRow } from "./ImportProgressRow";

export type NameDialogState =
  | { kind: "createProject" }
  | { kind: "createNotebook"; projectId: string; projectName: string; initialMode?: "blank" | "import" }
  | { kind: "renameProject"; project: Project }
  | { kind: "renameNotebook"; notebook: Notebook };

type NameModalProps = {
  dialog: NameDialogState;
  onCancel: () => void;
  onSubmit: (name: string) => Promise<void>;
  onImportComplete?: (projectId: string, notebookId: string) => Promise<void>;
};

export function NameModal({ dialog, onCancel, onSubmit, onImportComplete }: NameModalProps) {
  const initialValue = dialog.kind === "renameProject" ? dialog.project.name : dialog.kind === "renameNotebook" ? dialog.notebook.name : "";
  const [name, setName] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);
  const [mode] = useState<"blank" | "import">(dialog.kind === "createNotebook" ? dialog.initialMode ?? "blank" : "blank");
  const [serverPath, setServerPath] = useState("");
  const [inspection, setInspection] = useState<EnexInspection | null>(null);
  const [inspectionError, setInspectionError] = useState("");
  const [inspecting, setInspecting] = useState(false);
  const [job, setJob] = useState<EnexImportRun | null>(null);
  const [importNow, setImportNow] = useState(Date.now());
  const [importError, setImportError] = useState("");
  const [openingImportedNotebook, setOpeningImportedNotebook] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const importAbortRef = useRef<AbortController | null>(null);
  const title = getNameModalTitle(dialog);
  const description = getNameModalDescription(dialog);
  const submitLabel = dialog.kind.startsWith("rename") ? "Rename" : "Create";
  const pendingSubmitLabel = dialog.kind.startsWith("rename") ? "Renaming..." : "Creating...";
  const isNotebookCreate = dialog.kind === "createNotebook";
  const importing = job?.state === "running" || job?.state === "canceling";
  const cancelingImport = job?.state === "canceling";
  const disabled = !name.trim() || submitting || importing;
  const importDisabled = !isNotebookCreate || !serverPath.trim() || !name.trim() || inspecting || importing;
  const progressTotal = job?.progress.totalNotes ?? inspection?.noteCount ?? null;
  const resourceProgressTotal = job?.progress.totalResources ?? inspection?.resourceCount ?? null;
  const byteProgressPercent = job?.progress.totalBytes ? Math.min(100, Math.round((job.progress.processedBytes / job.progress.totalBytes) * 100)) : 0;
  const progressPercent = byteProgressPercent || (progressTotal && job ? Math.min(100, Math.round((job.progress.importedNotes / progressTotal) * 100)) : 0);
  const elapsedSeconds = job ? secondsBetween(job.startedAt, job.finishedAt, importNow) : 0;
  const predictedRemainingSeconds = job ? estimateRemainingSeconds(elapsedSeconds, progressPercent) : 0;
  const importFinished = job?.state === "succeeded";
  const importCanceled = job?.state === "canceled";
  const importTerminal = importFinished || importCanceled || job?.state === "failed";

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    if (!importing) return;
    const timer = window.setInterval(() => setImportNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [importing]);

  useEffect(() => () => importAbortRef.current?.abort(), []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    setSubmitting(true);
    try {
      await onSubmit(name);
    } finally {
      setSubmitting(false);
    }
  }

  async function inspectEnex() {
    if (!serverPath.trim()) return;
    setInspecting(true);
    setInspection(null);
    setInspectionError("");
    setImportError("");
    const response = await fetch("/api/import/enex/inspect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: serverPath.trim() }),
    });
    const body = await response.json().catch(() => null) as EnexInspection | { error?: string } | null;
    setInspecting(false);
    if (!response.ok || !body || "error" in body) {
      setInspectionError((body as { error?: string } | null)?.error || "Unable to inspect ENEX file.");
      return;
    }
    const inspected = body as EnexInspection;
    setInspection(inspected);
    setServerPath(inspected.path);
    if (!name.trim()) setName(inspected.suggestedNotebookName);
  }

  async function startImport() {
    if (dialog.kind !== "createNotebook" || importDisabled) return;
    setImportError("");
    const startedAt = new Date().toISOString();
    const controller = new AbortController();
    importAbortRef.current = controller;
    setImportNow(Date.now());
    setJob({
      state: "running",
      importedResources: 0,
      startedAt,
      progress: {
        processedBytes: 0,
        totalBytes: inspection?.sizeBytes ?? 0,
        importedNotes: 0,
        totalNotes: inspection?.noteCount ?? null,
        importedResources: 0,
        totalResources: inspection?.resourceCount ?? null,
      },
    });

    try {
      const response = await fetch("/api/import/enex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          notebookName: name.trim(),
          path: serverPath.trim(),
          totalNotes: inspection?.noteCount,
          totalResources: inspection?.resourceCount,
        }),
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || "Unable to import ENEX file.");
      }

      await readEnexImportStream(response, {
        onEvent: (event) => {
          if (event.type === "started") {
            setJob((current) => current ? { ...current, startedAt: event.startedAt, progress: { ...current.progress, ...event.progress } } : current);
            return;
          }
          if (event.type === "progress") {
            setJob((current) => current ? { ...current, progress: event.progress, importedResources: event.progress.importedResources } : current);
            return;
          }
          if (event.type === "complete") {
            setJob((current) => current ? {
              ...current,
              state: "succeeded",
              notebookId: event.result.notebookId,
              importedResources: event.result.importedResources,
              finishedAt: event.finishedAt,
              progress: event.result.progress,
            } : current);
            return;
          }
          setJob((current) => current ? {
            ...current,
            state: event.type === "canceled" ? "canceled" : "failed",
            error: event.error,
            finishedAt: event.finishedAt,
          } : current);
        },
      });
    } catch (error) {
      if (controller.signal.aborted) {
        setJob((current) => current ? { ...current, state: "canceled", error: "Import canceled. Partial import was rolled back.", finishedAt: new Date().toISOString() } : current);
      } else {
        setJob((current) => current ? { ...current, state: "failed", error: error instanceof Error ? error.message : "Unable to import ENEX file.", finishedAt: new Date().toISOString() } : current);
      }
    } finally {
      if (importAbortRef.current === controller) importAbortRef.current = null;
    }
  }

  async function openImportedNotebook() {
    if (dialog.kind !== "createNotebook" || !job?.notebookId) return;
    setOpeningImportedNotebook(true);
    await onImportComplete?.(dialog.projectId, job.notebookId);
    setOpeningImportedNotebook(false);
  }

  async function handleCancel() {
    if (job && job.state === "running") {
      setImportError("");
      setJob({ ...job, state: "canceling", error: "Cancel requested. Rolling back partial import." });
      importAbortRef.current?.abort();
      return;
    }
    onCancel();
  }

  return (
    <ModalFrame>
      <form onSubmit={(event) => void handleSubmit(event)}>
        <h2 className="text-lg font-semibold text-white">{importFinished ? "Import complete" : importCanceled ? "Import canceled" : title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-400">{importFinished ? "Review the imported notebook before opening it." : importCanceled ? "The partial notebook and imported files were rolled back." : description}</p>
        {importFinished ? (
          <ImportFinishedSummary
            notebookName={name}
            serverPath={serverPath}
            inspection={inspection}
            job={job}
            elapsedSeconds={elapsedSeconds}
          />
        ) : null}
        {!importFinished ? <label className="mt-5 block text-sm font-medium text-slate-200">
          {mode === "import" && isNotebookCreate ? "Notebook name" : "Name"}
          <input
            ref={inputRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-2 h-10 w-full border border-white/10 bg-white/10 px-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400"
            placeholder="Name"
          />
        </label> : null}
        {!importFinished && mode === "import" && isNotebookCreate ? (
          <div className="mt-4 space-y-4">
            <label className="block text-sm font-medium text-slate-200">
              ENEX server path
              <input
                value={serverPath}
                onChange={(event) => {
                  setServerPath(event.target.value);
                  setInspection(null);
                  setInspectionError("");
                }}
                className="mt-2 h-10 w-full border border-white/10 bg-white/10 px-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400"
                placeholder="/mnt/speedy/aboylan/local_llm_2026_03_31/ctDNA_test_2026_05_05/ctDNA.enex"
              />
            </label>
            <button type="button" onClick={() => void inspectEnex()} disabled={!serverPath.trim() || inspecting || importing} className="h-9 border border-white/10 px-3 text-sm text-slate-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500">
              {inspecting ? "Inspecting" : "Inspect file"}
            </button>
            {inspectionError ? <p className="text-sm text-rose-300">{inspectionError}</p> : null}
            {inspection ? (
              <div className="border border-white/10 bg-white/5 p-3 text-sm text-slate-300">
                <div className="grid grid-cols-2 gap-3">
                  <ImportMetric label="Pages" value={inspection.noteCount.toLocaleString()} />
                  <ImportMetric label="ENEX resources" value={inspection.resourceCount.toLocaleString()} />
                  <ImportMetric label="Inline media refs" value={inspection.inlineMediaCount.toLocaleString()} />
                  <ImportMetric label="File size" value={formatBytes(inspection.sizeBytes)} />
                </div>
                {inspection.tags.length ? <p className="mt-3 text-xs text-slate-400">Top tags: {inspection.tags.slice(0, 6).map((tag) => `${tag.tag} (${tag.count})`).join(", ")}</p> : null}
              </div>
            ) : null}
            {job ? (
              <div className="space-y-2 border border-white/10 bg-white/5 p-3 text-sm text-slate-300">
                <div className="flex items-center justify-between gap-3">
                  <span className="capitalize">{job.state}</span>
                  <span>{job.progress.importedNotes.toLocaleString()}{progressTotal ? ` / ${progressTotal.toLocaleString()}` : ""} pages</span>
                </div>
                <div className="h-2 overflow-hidden bg-slate-800">
                  <div className="h-full bg-cyan-400 transition-all" style={{ width: `${progressPercent}%` }} />
                </div>
                <div className="grid gap-1 text-xs text-slate-400">
                  <ImportProgressRow label="Elapsed time" value={formatDuration(elapsedSeconds)} />
                  <ImportProgressRow label="Predicted remaining time" value={predictedRemainingSeconds ? formatDuration(predictedRemainingSeconds) : "Calculating"} />
                  <ImportProgressRow label="ENEX resources" value={`${job.progress.importedResources.toLocaleString()}${resourceProgressTotal ? ` / ${resourceProgressTotal.toLocaleString()}` : ""}`} />
                  <ImportProgressRow label="Data" value={`${formatBytes(job.progress.processedBytes)} / ${formatBytes(job.progress.totalBytes)}`} />
                </div>
                {job.state === "failed" ? <p className="text-sm text-rose-300">{job.error || "Import failed. Partial notebook and files were rolled back."}</p> : null}
                {job.state === "canceling" ? <p className="text-sm text-amber-200">Canceling import and rolling back partial data...</p> : null}
                {job.state === "canceled" ? <p className="text-sm text-slate-300">{job.error || "Import canceled. Partial notebook and files were rolled back."}</p> : null}
              </div>
            ) : null}
            {importError ? <p className="text-sm text-rose-300">{importError}</p> : null}
          </div>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => void handleCancel()} disabled={cancelingImport} className="h-9 border border-white/10 px-3 text-sm text-slate-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500">{importTerminal ? "Close" : cancelingImport ? "Canceling" : importing ? "Cancel import" : "Cancel"}</button>
          {importFinished ? (
            <button type="button" onClick={() => void openImportedNotebook()} disabled={openingImportedNotebook || !job?.notebookId} className="h-9 bg-cyan-500 px-3 text-sm font-medium text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400">
              {openingImportedNotebook ? "Opening" : "Open notebook"}
            </button>
          ) : mode === "import" && isNotebookCreate ? (
            <button type="button" onClick={() => void startImport()} disabled={importDisabled} className="h-9 bg-cyan-500 px-3 text-sm font-medium text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400">
              {importing ? "Importing" : "Import"}
            </button>
          ) : (
            <button type="submit" disabled={disabled} className="inline-flex h-9 items-center gap-2 bg-cyan-500 px-3 text-sm font-medium text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400">
              {submitting ? <Loader2 size={15} className="animate-spin" /> : null}
              {submitting ? pendingSubmitLabel : submitLabel}
            </button>
          )}
        </div>
      </form>
    </ModalFrame>
  );
}

function getNameModalTitle(dialog: NameDialogState) {
  if (dialog.kind === "createProject") return "New project";
  if (dialog.kind === "createNotebook") return dialog.initialMode === "import" ? "Import ENEX notebook" : "New notebook";
  if (dialog.kind === "renameProject") return "Rename project";
  return "Rename notebook";
}

function getNameModalDescription(dialog: NameDialogState) {
  if (dialog.kind === "createProject") return "Create a project to group related notebooks.";
  if (dialog.kind === "createNotebook") return dialog.initialMode === "import" ? "Create a new notebook from an Evernote ENEX export." : "Create a notebook.";
  if (dialog.kind === "renameProject") return "Update the project name shown in the sidebar.";
  return "Update the notebook name shown in the sidebar.";
}
