import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { buildPageExportArchive, pageExportFilename } from "@/lib/pageExport";
import { getPage, getPageNotebook } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ pageId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { pageId } = await context.params;
  try {
    const page = getPage(user.id, pageId);
    const notebook = getPageNotebook(user.id, pageId);
    const archive = await buildPageExportArchive(page, notebook);
    return new NextResponse(new Blob([archive as unknown as BlobPart], { type: "application/zip" }), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${escapeContentDispositionFilename(pageExportFilename(page, "zip"))}"`,
        "Content-Type": "application/zip",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not export archive";
    const status = message === "Forbidden" ? 403 : message === "Page not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

function escapeContentDispositionFilename(filename: string) {
  return filename.replace(/[\\"]/g, "_");
}
