import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getPageFinalizationPackageDownload } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ pageId: string; signatureId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { pageId, signatureId } = await context.params;

  try {
    const download = getPageFinalizationPackageDownload(user.id, pageId, signatureId);
    return new Response(download.bytes, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": contentDisposition("attachment", download.filename),
        "Content-Length": String(download.size),
        "Content-Type": "application/zip",
        "X-Novo-Finalization-Package-SHA256": download.sha256,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not download finalization package";
    const status = message === "Forbidden"
      ? 403
      : message === "Page finalization not found."
        ? 404
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

function contentDisposition(disposition: "inline" | "attachment", filename: string) {
  const fallback = filename
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_")
    .trim() || "finalization.zip";
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
