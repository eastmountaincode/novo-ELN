import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { presentationCacheDir, presentationPreviewSignature, safeSlideFileName } from "@/lib/presentationPreview";
import { getAttachmentForUser } from "@/lib/store";

export async function GET(_request: Request, context: { params: Promise<{ attachmentId: string; fileName: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { attachmentId, fileName } = await context.params;
  const attachment = getAttachmentForUser(user.id, attachmentId);
  if (!attachment || attachment.blockType !== "slides") return NextResponse.json({ error: "Not found" }, { status: 404 });

  const safeFileName = safeSlideFileName(fileName);
  if (!safeFileName) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const signature = presentationPreviewSignature({
    storageKey: attachment.storageKey,
    size: attachment.size,
    updatedAt: attachment.updatedAt,
  });
  const filePath = path.join(presentationCacheDir(attachmentId, signature), safeFileName);

  try {
    const bytes = await fs.readFile(filePath);
    return new Response(bytes, {
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
