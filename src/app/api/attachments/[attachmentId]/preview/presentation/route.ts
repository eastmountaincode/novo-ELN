import path from "node:path";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { uploadDir } from "@/lib/paths";
import { createPresentationPreview, presentationPreviewSignature } from "@/lib/presentationPreview";
import { getAttachmentForUser } from "@/lib/store";

export async function GET(_request: Request, context: { params: Promise<{ attachmentId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { attachmentId } = await context.params;
  const attachment = getAttachmentForUser(user.id, attachmentId);
  if (!attachment || attachment.blockType !== "slides") return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const signature = presentationPreviewSignature({
      storageKey: attachment.storageKey,
      size: attachment.size,
      updatedAt: attachment.updatedAt,
    });
    const preview = await createPresentationPreview({
      attachmentId,
      sourcePath: path.join(uploadDir, attachment.storageKey),
      sourceName: attachment.originalName,
      signature,
      baseUrl: `/api/attachments/${attachmentId}/preview/presentation/slides`,
    });
    return NextResponse.json({ preview });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to preview presentation.",
    }, { status: 422 });
  }
}
