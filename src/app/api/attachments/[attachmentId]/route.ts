import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { uploadDir } from "@/lib/paths";
import { deleteAttachment, getAttachmentForUser, updateAttachmentFile } from "@/lib/store";

export async function PUT(request: Request, context: { params: Promise<{ attachmentId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { attachmentId } = await context.params;
  const attachment = getAttachmentForUser(user.id, attachmentId);
  if (!attachment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file is required" }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const storageKey = path.join(attachment.pageId, `${randomUUID()}-${sanitizeFileName(attachment.originalName)}`);
  const absolutePath = path.join(uploadDir, storageKey);

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, bytes);

  try {
    const updatedAttachment = updateAttachmentFile({
      userId: user.id,
      attachmentId,
      mimeType: file.type || attachment.mimeType || "application/octet-stream",
      size: bytes.length,
      storageKey,
    });

    return NextResponse.json({ ok: true, attachment: updatedAttachment });
  } catch (error) {
    await fs.rm(absolutePath, { force: true });
    const message = error instanceof Error ? error.message : "Could not update attachment";
    return NextResponse.json({ error: message }, { status: message === "Forbidden" ? 403 : 400 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ attachmentId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { attachmentId } = await context.params;
  try {
    const attachment = deleteAttachment(user.id, attachmentId);
    await fs.rm(path.join(uploadDir, attachment.storageKey), { force: true });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete attachment";
    return NextResponse.json({ error: message }, { status: message === "Forbidden" ? 403 : message === "Attachment not found" ? 404 : 400 });
  }
}

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}
