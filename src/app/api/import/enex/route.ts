import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { EnexImportCanceledError, importEnexFile } from "@/lib/enex";

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    notebookName?: string;
    path?: string;
    totalNotes?: number;
    totalResources?: number;
  } | null;

  if (!body?.path?.trim()) return NextResponse.json({ error: "ENEX server path is required" }, { status: 400 });
  const enexPath = body.path;

  let canceled = false;
  request.signal.addEventListener("abort", () => {
    canceled = true;
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        } catch {
          closed = true;
          canceled = true;
        }
      };

      try {
        const startedAt = new Date().toISOString();
        send({
          type: "started",
          startedAt,
          progress: {
            processedBytes: 0,
            totalBytes: 0,
            importedNotes: 0,
            totalNotes: Number.isFinite(body.totalNotes) ? body.totalNotes : null,
            importedResources: 0,
            totalResources: Number.isFinite(body.totalResources) ? body.totalResources : null,
          },
        });
        const result = await importEnexFile({
          userId: user.id,
          notebookName: body.notebookName?.trim() || "Evernote Import",
          filePath: enexPath,
          totalNotes: Number.isFinite(body.totalNotes) ? body.totalNotes : null,
          totalResources: Number.isFinite(body.totalResources) ? body.totalResources : null,
          shouldCancel: () => canceled,
          onProgress: (progress) => send({ type: "progress", progress }),
        });
        send({ type: "complete", result, finishedAt: new Date().toISOString() });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to import ENEX file.";
        send({
          type: error instanceof EnexImportCanceledError ? "canceled" : "error",
          error: message,
          finishedAt: new Date().toISOString(),
        });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // The client may have already aborted the request.
        }
      }
    },
    cancel() {
      canceled = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
