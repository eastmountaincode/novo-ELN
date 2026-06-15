import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { uploadDir } from "@/lib/paths";
import { createSpreadsheetPreview } from "@/lib/spreadsheetPreview";
import { getAttachmentForUser } from "@/lib/store";

export async function GET(request: Request, context: { params: Promise<{ attachmentId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { attachmentId } = await context.params;
  const attachment = getAttachmentForUser(user.id, attachmentId);
  if (!attachment || attachment.blockType !== "sheet") return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { searchParams } = new URL(request.url);
  const maxRows = Number(searchParams.get("rows") ?? 20);
  const maxColumns = Number(searchParams.get("columns") ?? 8);
  const sheetIndex = Number(searchParams.get("sheet") ?? 0);

  try {
    const bytes = await fs.readFile(path.join(uploadDir, attachment.storageKey));
    return NextResponse.json({
      preview: await createSpreadsheetPreview(bytes, {
        maxRows,
        maxColumns,
        sheetIndex,
        filename: attachment.originalName,
        mimeType: attachment.mimeType,
      }),
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to preview spreadsheet.",
    }, { status: 422 });
  }
}
