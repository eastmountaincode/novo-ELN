import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { createEnexImportJob } from "@/lib/enexJobs";

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    projectId?: string;
    notebookName?: string;
    path?: string;
    totalNotes?: number;
    totalResources?: number;
  } | null;

  if (!body?.projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  if (!body.path?.trim()) return NextResponse.json({ error: "ENEX server path is required" }, { status: 400 });

  try {
    const job = createEnexImportJob({
      userId: user.id,
      projectId: body.projectId,
      notebookName: body.notebookName?.trim() || "Evernote Import",
      filePath: body.path,
      totalNotes: Number.isFinite(body.totalNotes) ? body.totalNotes : null,
      totalResources: Number.isFinite(body.totalResources) ? body.totalResources : null,
    });

    return NextResponse.json({ jobId: job.id, job });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start ENEX import.";
    return NextResponse.json({ error: message }, { status: message === "Forbidden" ? 403 : 400 });
  }
}
