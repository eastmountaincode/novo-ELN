import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { attachmentPreviewText, resolveAttachmentBlockType } from "@/lib/attachmentTypes";
import { uploadDir } from "@/lib/paths";
import { createAttachment } from "@/lib/store";
import type { Attachment } from "@/lib/types";

export async function POST(request: Request, context: { params: Promise<{ pageId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { pageId } = await context.params;
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file is required" }, { status: 400 });

  const blockType = resolveAttachmentBlockType({
    name: file.name,
    mimeType: file.type,
    requestedBlockType: form.get("blockType"),
  });
  const bytes = Buffer.from(await file.arrayBuffer());
  const safeName = sanitizeFileName(file.name || "attachment.bin");
  const storageKey = path.join(pageId, `${randomUUID()}-${safeName}`);
  const absolutePath = path.join(uploadDir, storageKey);

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, bytes);

  const attachmentId = createAttachment({
    userId: user.id,
    pageId,
    originalName: file.name || safeName,
    mimeType: file.type || "application/octet-stream",
    size: bytes.length,
    storageKey,
    blockType,
    previewText: attachmentPreviewText(blockType, "upload"),
  });

  const createdAt = new Date().toISOString();
  const attachment: Attachment = {
    id: attachmentId,
    pageId,
    originalName: file.name || safeName,
    mimeType: file.type || "application/octet-stream",
    size: bytes.length,
    storageKey,
    blockType,
    previewText: attachmentPreviewText(blockType, "upload"),
    createdAt,
    updatedAt: createdAt,
  };

  return NextResponse.json({ attachment });
}

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}
