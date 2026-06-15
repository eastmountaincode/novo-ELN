import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { currentUser } from "@/lib/auth";
import { previewDir, uploadDir } from "@/lib/paths";
import { getAttachmentForUser } from "@/lib/store";

const previewableImageTypes = new Set(["image/tiff", "image/x-tiff"]);

export async function GET(_request: Request, context: { params: Promise<{ attachmentId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { attachmentId } = await context.params;
  const attachment = getAttachmentForUser(user.id, attachmentId);
  if (!attachment || attachment.blockType !== "image") return NextResponse.json({ error: "Not found" }, { status: 404 });

  const mimeType = attachment.mimeType.toLowerCase();
  if (!previewableImageTypes.has(mimeType)) return NextResponse.redirect(new URL(`/api/attachments/${attachmentId}/view`, _request.url));

  const sourcePath = path.join(uploadDir, attachment.storageKey);
  const cachePath = path.join(previewDir, "images", `${attachment.id}-${attachment.size}.png`);

  try {
    const cached = await fs.readFile(cachePath);
    return pngResponse(cached);
  } catch {}

  try {
    const png = await sharp(sourcePath, { pages: 1 })
      .rotate()
      .resize({ width: 1800, height: 1800, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, png);
    return pngResponse(png);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not render image preview";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function pngResponse(bytes: Buffer) {
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Response(body, {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, max-age=86400",
    },
  });
}
