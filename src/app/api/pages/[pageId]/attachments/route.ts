import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { uploadDir } from "@/lib/paths";
import { createAttachment } from "@/lib/store";
import type { Attachment, BlockType } from "@/lib/types";

export async function POST(request: Request, context: { params: Promise<{ pageId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { pageId } = await context.params;
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file is required" }, { status: 400 });

  const blockType = normalizeBlockType(String(form.get("blockType") ?? inferBlockType(file.name, file.type)));
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
    previewText: previewFor(file.name, file.type),
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
    previewText: previewFor(file.name, file.type),
    createdAt,
    updatedAt: createdAt,
  };

  return NextResponse.json({ attachment });
}

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function normalizeBlockType(value: string): BlockType {
  const allowed = new Set(["image", "sheet", "pdf", "slides", "sequence", "file"]);
  return allowed.has(value) ? (value as BlockType) : "file";
}

function inferBlockType(name: string, mimeType: string): BlockType {
  const lower = name.toLowerCase();
  if (mimeType.startsWith("image/") || /\.(png|jpe?g|gif|tiff?|webp)$/.test(lower)) return "image";
  if (/\.(xlsx?|csv|tsv)$/.test(lower)) return "sheet";
  if (/\.pdf$/.test(lower)) return "pdf";
  if (/\.(pptx?|key)$/.test(lower)) return "slides";
  if (/\.(gb|gbk|fasta|fa|dna|seq)$/.test(lower)) return "sequence";
  return "file";
}

function previewFor(name: string, mimeType: string) {
  const type = inferBlockType(name, mimeType);
  const labels: Record<BlockType, string> = {
    image: "Image stored inline with this page.",
    sheet: "Spreadsheet uploaded; table preview/parser is the next integration step.",
    pdf: "PDF uploaded; text extraction is the next integration step.",
    slides: "Slide deck uploaded; preview rendering is the next integration step.",
    sequence: "Sequence file uploaded; sequence viewer is the next integration step.",
    file: "File uploaded and attached to this page.",
  };
  return labels[type];
}
