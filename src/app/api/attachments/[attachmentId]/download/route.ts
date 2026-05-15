import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { uploadDir } from "@/lib/paths";
import { getAttachmentForUser } from "@/lib/store";

export async function GET(_request: Request, context: { params: Promise<{ attachmentId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { attachmentId } = await context.params;
  const attachment = getAttachmentForUser(user.id, attachmentId);
  if (!attachment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const filePath = path.join(uploadDir, attachment.storageKey);
  const bytes = await fs.readFile(filePath);

  return new Response(bytes, {
    headers: {
      "Content-Type": attachment.mimeType || "application/octet-stream",
      "Content-Length": String(bytes.length),
      "Content-Disposition": contentDisposition("attachment", attachment.originalName),
    },
  });
}

function contentDisposition(disposition: "inline" | "attachment", filename: string) {
  const fallback = filename
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_")
    .trim() || "attachment";
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
