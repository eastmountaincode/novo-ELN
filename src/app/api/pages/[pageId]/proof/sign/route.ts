import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { buildPageRecordPackage } from "@/lib/pageRecordPackage";
import { createPageRecordSignature, createPageSignatureTimestamp, getPage, getPageCommentThreads, getPageNotebook, listPageRecordAuditEvents, listPageRecordSignatures, rollbackPageRecordFinalization, setPageLocked, storePageFinalizationPackage } from "@/lib/store";
import { requestTimestampForProofHash } from "@/lib/timestamping";

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

  let pageSignatureId = "";
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
      recordArchive: recordPackage.archive,
      signingPassphrase,
    });
    pageSignatureId = signature.id;
    const timestamp = createPageSignatureTimestamp(user.id, signature.id, await requestTimestampForProofHash(signature.proofHash));
    const finalizedSignature = storePageFinalizationPackage(user.id, signature.id);
    setPageLocked(user.id, pageId, true);
    return NextResponse.json({ signature: { ...finalizedSignature, timestamps: [timestamp] }, timestamp, page: getPage(user.id, pageId) }, { status: 201 });
  } catch (error) {
    if (pageSignatureId) {
      try {
        rollbackPageRecordFinalization(user.id, pageSignatureId);
      } catch (rollbackError) {
        console.error("Could not roll back failed page finalization", rollbackError);
      }
    }
    const message = error instanceof Error ? error.message : "Could not sign page record";
    const status = message === "Forbidden" || message === "Only editors and owners can lock pages."
      ? 403
      : message === "Page not found"
        ? 404
        : message === "No active signing key."
          ? 409
          : message === "Page is already finalized."
            ? 409
          : message.toLowerCase().includes("timestamp authority")
            ? 502
          : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
