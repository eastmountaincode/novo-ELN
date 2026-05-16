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
  state: "queued" | "running" | "canceling" | "canceled" | "succeeded" | "failed";
  notebookName: string;
  filePath: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  notebookId?: string;
  importedResources: number;
  workerCount: number;
  workerPid?: number;
  progress: EnexImportProgress;
};

export function createEnexImportJob(input: {
  userId: string;
  notebookName: string;
  filePath: string;
  totalNotes?: number | null;
  totalResources?: number | null;
  workerCount?: number | null;
}) {
  ensureDatabase();
  assertUserExists(input.userId);

  const active = queryOne(`
    SELECT id FROM import_jobs
    WHERE user_id = ${sql(input.userId)}
      AND file_path = ${sql(input.filePath)}
      AND state IN ('queued', 'running', 'canceling')
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
  const workerCount = normalizeWorkerCount(input.workerCount);
  execSql(`
    INSERT INTO import_jobs (id, user_id, notebook_name, file_path, state, total_notes, total_resources, worker_count)
    VALUES (${sql(id)}, ${sql(input.userId)}, ${sql(input.notebookName)}, ${sql(input.filePath)}, 'queued', ${totalNotes ?? "NULL"}, ${totalResources ?? "NULL"}, ${workerCount});
  `);

  launchWorker(id);
  const job = getEnexImportJob(id);
  if (!job) throw new Error("Unable to create import job.");
  return job;
}

export function getEnexImportJob(id: string) {
  ensureDatabase();
  const row = queryOne(`
    SELECT id, user_id, notebook_name, file_path, state, started_at, finished_at, error,
           notebook_id, imported_resources, imported_notes, total_notes, total_resources, processed_bytes, total_bytes, worker_count, worker_pid
    FROM import_jobs
    WHERE id = ${sql(id)}
    LIMIT 1
  `);
  return row ? toJob(row) : null;
}

export function cancelEnexImportJob(id: string, actorUserId: string) {
  ensureDatabase();
  const job = getEnexImportJob(id);
  if (!job) throw new Error("Import job not found");
  if (job.userId !== actorUserId && !isAdmin(actorUserId)) throw new Error("Forbidden");
  if (job.state === "succeeded" || job.state === "failed" || job.state === "canceled") return job;
  execSql(`
    UPDATE import_jobs
    SET state = 'canceling',
        error = 'Cancel requested. Rolling back partial import.',
        updated_at = datetime('now')
    WHERE id = ${sql(id)}
      AND state IN ('queued', 'running', 'canceling');
  `);
  return getEnexImportJob(id) ?? job;
}

function launchWorker(jobId: string) {
  const row = queryOne(`SELECT worker_count FROM import_jobs WHERE id = ${sql(jobId)} LIMIT 1`);
  const workerCount = normalizeWorkerCount(row?.worker_count);
  const workerPath = path.join(process.cwd(), "scripts", "enex-import-worker.mjs");
  const child = spawn(process.execPath, [workerPath, jobId], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      ELN_DATABASE_PATH: databasePath,
      ELN_UPLOAD_DIR: uploadDir,
      ENEX_IMPORT_WORKERS: String(workerCount),
    },
  });
  child.unref();
  execSql(`UPDATE import_jobs SET worker_pid = ${child.pid ?? "NULL"}, updated_at = datetime('now') WHERE id = ${sql(jobId)};`);
}

function assertUserExists(userId: string) {
  const user = queryOne(`SELECT id FROM users WHERE id = ${sql(userId)} LIMIT 1`);
  if (!user) throw new Error("Forbidden");
}

function isAdmin(userId: string) {
  const row = queryOne(`SELECT role FROM users WHERE id = ${sql(userId)} LIMIT 1`);
  return row?.role === "admin";
}

function toJob(row: Record<string, string>): EnexImportJob {
  return {
    id: row.id,
    userId: row.user_id,
    state: normalizeState(row.state),
    notebookName: row.notebook_name,
    filePath: row.file_path,
    startedAt: row.started_at,
    finishedAt: row.finished_at || undefined,
    error: row.error || undefined,
    notebookId: row.notebook_id || undefined,
    importedResources: Number(row.imported_resources || 0),
    workerCount: normalizeWorkerCount(row.worker_count),
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
  return value === "running" || value === "canceling" || value === "canceled" || value === "succeeded" || value === "failed" ? value : "queued";
}

function normalizeWorkerCount(value: unknown) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 4;
  return Math.min(parsed, 80);
}
