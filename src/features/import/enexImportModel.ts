export type EnexInspection = {
  path: string;
  fileName: string;
  suggestedNotebookName: string;
  sizeBytes: number;
  noteCount: number;
  resourceCount: number;
  inlineMediaCount: number;
  notesWithResources: number;
  tags: Array<{ tag: string; count: number }>;
  mimeTypes: Array<{ mimeType: string; count: number }>;
  elapsedMs: number;
};

export type EnexImportRun = {
  state: "running" | "canceling" | "canceled" | "succeeded" | "failed";
  error?: string;
  notebookId?: string;
  importedResources: number;
  startedAt: string;
  finishedAt?: string;
  progress: {
    processedBytes: number;
    totalBytes: number;
    importedNotes: number;
    totalNotes: number | null;
    importedResources: number;
    totalResources: number | null;
  };
};

type EnexImportStreamEvent =
  | { type: "started"; startedAt: string; progress: EnexImportRun["progress"] }
  | { type: "progress"; progress: EnexImportRun["progress"] }
  | { type: "complete"; finishedAt: string; result: { notebookId: string; importedNotes: number; importedResources: number; progress: EnexImportRun["progress"] } }
  | { type: "error"; finishedAt: string; error?: string }
  | { type: "canceled"; finishedAt: string; error?: string };

export async function readEnexImportStream(response: Response, input: { onEvent: (event: EnexImportStreamEvent) => void }) {
  if (!response.body) throw new Error("Import response did not include a progress stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      input.onEvent(JSON.parse(line) as EnexImportStreamEvent);
    }
  }

  const finalLine = `${buffer}${decoder.decode()}`.trim();
  if (finalLine) input.onEvent(JSON.parse(finalLine) as EnexImportStreamEvent);
}

export function secondsBetween(startedAt: string, finishedAt?: string, now = Date.now()) {
  const start = parseServerTimestamp(startedAt);
  const end = finishedAt ? parseServerTimestamp(finishedAt) : now;
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.floor((end - start) / 1000));
}

export function estimateRemainingSeconds(elapsedSeconds: number, progressPercent: number) {
  if (!elapsedSeconds || progressPercent <= 0 || progressPercent >= 100) return 0;
  const estimatedTotalSeconds = Math.round(elapsedSeconds / (progressPercent / 100));
  return Math.max(0, estimatedTotalSeconds - elapsedSeconds);
}

export function formatDuration(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "0s";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function parseServerTimestamp(value: string) {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  return Date.parse(normalized);
}
