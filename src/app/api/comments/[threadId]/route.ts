import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { deletePageCommentThread, setPageCommentThreadResolved } from "@/lib/store";

export async function PATCH(request: Request, context: { params: Promise<{ threadId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { threadId } = await context.params;
  const body = await request.json().catch(() => null) as { resolved?: boolean } | null;

  try {
    const thread = setPageCommentThreadResolved(user.id, threadId, Boolean(body?.resolved));
    return NextResponse.json({ thread });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update comment";
    return NextResponse.json({ error: message }, { status: message === "Forbidden" ? 403 : 400 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ threadId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { threadId } = await context.params;
  const pageId = new URL(request.url).searchParams.get("pageId") ?? "";

  try {
    const result = deletePageCommentThread(user.id, threadId, pageId);
    return NextResponse.json({ ok: true, body: result.body });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete comment";
    const status = message === "Forbidden" ? 403 : message === "Page is locked." ? 423 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
