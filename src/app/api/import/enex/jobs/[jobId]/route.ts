import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { cancelEnexImportJob, getEnexImportJob } from "@/lib/enexJobs";

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { jobId } = await context.params;
  const job = getEnexImportJob(jobId);
  if (!job) return NextResponse.json({ error: "Import job not found" }, { status: 404 });
  if (job.userId !== user.id && user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  return NextResponse.json(job);
}

export async function DELETE(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { jobId } = await context.params;
  try {
    return NextResponse.json(cancelEnexImportJob(jobId, user.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to cancel import.";
    return NextResponse.json({ error: message }, { status: message === "Forbidden" ? 403 : message === "Import job not found" ? 404 : 400 });
  }
}
