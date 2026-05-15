import crypto from "node:crypto";
import { importEnexFile, type EnexImportProgress } from "./enex";

export type EnexImportJob = {
  id: string;
  userId: string;
  state: "queued" | "running" | "succeeded" | "failed";
  projectId: string;
  notebookName: string;
  filePath: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  notebookId?: string;
  importedResources: number;
  progress: EnexImportProgress;
};

const jobs = new Map<string, EnexImportJob>();

export function createEnexImportJob(input: {
  userId: string;
  projectId: string;
  notebookName: string;
  filePath: string;
  totalNotes?: number | null;
}) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const job: EnexImportJob = {
    id,
    userId: input.userId,
    state: "queued",
    projectId: input.projectId,
    notebookName: input.notebookName,
    filePath: input.filePath,
    startedAt: now,
    importedResources: 0,
    progress: {
      processedBytes: 0,
      totalBytes: 0,
      importedNotes: 0,
      totalNotes: input.totalNotes ?? null,
      importedResources: 0,
    },
  };
  jobs.set(id, job);

  void runJob(id, input);
  return job;
}

export function getEnexImportJob(id: string) {
  return jobs.get(id) ?? null;
}

async function runJob(id: string, input: {
  userId: string;
  projectId: string;
  notebookName: string;
  filePath: string;
  totalNotes?: number | null;
}) {
  const job = jobs.get(id);
  if (!job) return;
  job.state = "running";
  try {
    const result = await importEnexFile({
      userId: input.userId,
      projectId: input.projectId,
      notebookName: input.notebookName,
      filePath: input.filePath,
      totalNotes: input.totalNotes,
      onProgress(progress) {
        const activeJob = jobs.get(id);
        if (activeJob) {
          activeJob.progress = progress;
          activeJob.importedResources = progress.importedResources;
        }
      },
    });
    job.state = "succeeded";
    job.notebookId = result.notebookId;
    job.importedResources = result.importedResources;
    job.progress = {
      ...job.progress,
      importedNotes: result.importedNotes,
      processedBytes: job.progress.totalBytes || job.progress.processedBytes,
      importedResources: result.importedResources,
    };
  } catch (error) {
    job.state = "failed";
    job.error = error instanceof Error ? error.message : "Import failed.";
  } finally {
    job.finishedAt = new Date().toISOString();
  }
}
