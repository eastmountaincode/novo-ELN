import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { buildPageRecordPackage } from "@/lib/pageRecordPackage";
import { createPageRecordSignature, getPage, getPageCommentThreads, getPageNotebook, listPageRecordAuditEvents, listPageRecordSignatures } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ pageId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { pageId } = await context.params;

  try {
    return NextResponse.json({ signatures: listPageRecordSignatures(user.id, pageId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load page signatures";
    const status = message === "Forbidden" ? 403 : message === "Page not found" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request, context: { params: Promise<{ pageId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { pageId } = await context.params;
  const body = (await request.json().catch(() => null)) as { signingPassphrase?: string } | null;
  const signingPassphrase = body?.signingPassphrase ?? "";
  if (!signingPassphrase) return NextResponse.json({ error: "Signing passphrase is required." }, { status: 400 });

  try {
    const page = getPage(user.id, pageId);
    const notebook = getPageNotebook(user.id, pageId);
    const commentThreads = getPageCommentThreads(user.id, pageId);
    const auditEvents = listPageRecordAuditEvents(user.id, pageId);
    const recordPackage = await buildPageRecordPackage(page, notebook, { auditEvents, commentThreads });
    const signature = createPageRecordSignature(user.id, {
      pageId,
      recordHash: recordPackage.recordHash,
      recordManifest: recordPackage.manifest,
      signingPassphrase,
    });
    return NextResponse.json({ signature }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not sign page record";
    const status = message === "Forbidden" || message === "Only editors and owners can lock pages."
      ? 403
      : message === "Page not found"
        ? 404
        : message === "No active signing key."
          ? 409
          : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
