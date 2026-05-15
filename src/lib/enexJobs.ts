import { spawn } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ensureDatabase } from "./store";
import { databasePath, uploadDir } from "./paths";
import { execSql, queryOne, sql } from "./sqlite";
import type { EnexImportProgress } from "./enex";

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
  workerPid?: number;
  progress: EnexImportProgress;
};

export function createEnexImportJob(input: {
  userId: string;
  projectId: string;
  notebookName: string;
  filePath: string;
  totalNotes?: number | null;
  totalResources?: number | null;
}) {
  ensureDatabase();
  assertProjectImportAccess(input.userId, input.projectId);

  const active = queryOne(`
    SELECT id FROM import_jobs
    WHERE user_id = ${sql(input.userId)}
      AND project_id = ${sql(input.projectId)}
      AND file_path = ${sql(input.filePath)}
      AND state IN ('queued', 'running')
    ORDER BY created_at DESC
    LIMIT 1
  `);
  if (active?.id) {
    const existing = getEnexImportJob(active.id);
    if (existing) return existing;
  }

  const id = randomUUID();
  const totalNotes = Number.isFinite(Number(input.totalNotes)) ? Number(input.totalNotes) : null;
  const totalResources = Number.isFinite(Number(input.totalResources)) ? Number(input.totalResources) : null;
  execSql(`
    INSERT INTO import_jobs (id, user_id, project_id, notebook_name, file_path, state, total_notes, total_resources)
    VALUES (${sql(id)}, ${sql(input.userId)}, ${sql(input.projectId)}, ${sql(input.notebookName)}, ${sql(input.filePath)}, 'queued', ${totalNotes ?? "NULL"}, ${totalResources ?? "NULL"});
  `);

  launchWorker(id);
  const job = getEnexImportJob(id);
  if (!job) throw new Error("Unable to create import job.");
  return job;
}

export function getEnexImportJob(id: string) {
  ensureDatabase();
  const row = queryOne(`
    SELECT id, user_id, project_id, notebook_name, file_path, state, started_at, finished_at, error,
           notebook_id, imported_resources, imported_notes, total_notes, total_resources, processed_bytes, total_bytes, worker_pid
    FROM import_jobs
    WHERE id = ${sql(id)}
    LIMIT 1
  `);
  return row ? toJob(row) : null;
}

function launchWorker(jobId: string) {
  const workerPath = path.join(process.cwd(), "scripts", "enex-import-worker.mjs");
  const child = spawn(process.execPath, [workerPath, jobId], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      ELN_DATABASE_PATH: databasePath,
      ELN_UPLOAD_DIR: uploadDir,
    },
  });
  child.unref();
  execSql(`UPDATE import_jobs SET worker_pid = ${child.pid ?? "NULL"}, updated_at = datetime('now') WHERE id = ${sql(jobId)};`);
}

function assertProjectImportAccess(userId: string, projectId: string) {
  const user = queryOne(`SELECT role FROM users WHERE id = ${sql(userId)} LIMIT 1`);
  if (user?.role === "admin") return;
  const row = queryOne(`SELECT role FROM project_members WHERE user_id = ${sql(userId)} AND project_id = ${sql(projectId)} LIMIT 1`);
  if (row?.role !== "owner" && row?.role !== "editor") throw new Error("Forbidden");
}

function toJob(row: Record<string, string>): EnexImportJob {
  return {
    id: row.id,
    userId: row.user_id,
    state: normalizeState(row.state),
    projectId: row.project_id,
    notebookName: row.notebook_name,
    filePath: row.file_path,
    startedAt: row.started_at,
    finishedAt: row.finished_at || undefined,
    error: row.error || undefined,
    notebookId: row.notebook_id || undefined,
    importedResources: Number(row.imported_resources || 0),
    workerPid: row.worker_pid ? Number(row.worker_pid) : undefined,
    progress: {
      processedBytes: Number(row.processed_bytes || 0),
      totalBytes: Number(row.total_bytes || 0),
      importedNotes: Number(row.imported_notes || 0),
      totalNotes: row.total_notes ? Number(row.total_notes) : null,
      importedResources: Number(row.imported_resources || 0),
      totalResources: row.total_resources ? Number(row.total_resources) : null,
    },
  };
}

function normalizeState(value: string): EnexImportJob["state"] {
  return value === "running" || value === "succeeded" || value === "failed" ? value : "queued";
}
