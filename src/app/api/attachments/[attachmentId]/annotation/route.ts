import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getAttachmentAnnotationForUser, saveAttachmentAnnotation } from "@/lib/store";

export async function GET(_request: Request, context: { params: Promise<{ attachmentId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { attachmentId } = await context.params;
  try {
    const { annotation } = getAttachmentAnnotationForUser(user.id, attachmentId);
    return NextResponse.json({ annotation: annotationResponse(annotation) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load annotation";
    return NextResponse.json({ error: message }, { status: message === "Forbidden" ? 403 : message === "Attachment not found" ? 404 : 400 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ attachmentId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { attachmentId } = await context.params;
  const body = (await request.json().catch(() => null)) as { data?: unknown } | null;
  if (!body || body.data === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  try {
    const annotation = saveAttachmentAnnotation({ userId: user.id, attachmentId, data: body.data });
    return NextResponse.json({ ok: true, annotation: annotationResponse(annotation) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save annotation";
    const status = message === "Forbidden" ? 403 : message === "Attachment not found" ? 404 : message === "Page is locked." ? 423 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

function annotationResponse(annotation: { dataJson: string; updatedAt: string; updatedBy: string }) {
  return {
    data: parseAnnotation(annotation.dataJson),
    updatedAt: annotation.updatedAt,
    updatedBy: annotation.updatedBy,
  };
}

function parseAnnotation(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { items: [] };
    const items = (parsed as { items?: unknown }).items;
    return { items: Array.isArray(items) ? items : [] };
  } catch {
    return { items: [] };
  }
}
