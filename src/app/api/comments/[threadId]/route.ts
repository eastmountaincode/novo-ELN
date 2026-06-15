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

export async function DELETE(_request: Request, context: { params: Promise<{ threadId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { threadId } = await context.params;

  try {
    deletePageCommentThread(user.id, threadId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete comment";
    return NextResponse.json({ error: message }, { status: message === "Forbidden" ? 403 : 400 });
  }
}
