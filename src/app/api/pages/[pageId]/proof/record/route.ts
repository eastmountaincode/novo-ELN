import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { buildPageRecordPackage, pageRecordPackageFilename } from "@/lib/pageRecordPackage";
import { getPage, getPageCommentThreads, getPageNotebook, listPageRecordAuditEvents } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ pageId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { pageId } = await context.params;
  try {
    const page = getPage(user.id, pageId);
    const notebook = getPageNotebook(user.id, pageId);
    const commentThreads = getPageCommentThreads(user.id, pageId);
    const auditEvents = listPageRecordAuditEvents(user.id, pageId);
    const recordPackage = await buildPageRecordPackage(page, notebook, { auditEvents, commentThreads });
    return new NextResponse(new Blob([recordPackage.archive as unknown as BlobPart], { type: "application/zip" }), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${escapeContentDispositionFilename(pageRecordPackageFilename(page))}"`,
        "Content-Type": "application/zip",
        "X-Novo-Record-Hash": recordPackage.recordHash,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not build record package";
    const status = message === "Forbidden" ? 403 : message === "Page not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

function escapeContentDispositionFilename(filename: string) {
  return filename.replace(/[\\"]/g, "_");
}
