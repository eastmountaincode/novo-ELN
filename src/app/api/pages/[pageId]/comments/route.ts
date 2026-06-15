import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { createPageCommentThread, getPageCommentThreads } from "@/lib/store";

export async function GET(_request: Request, context: { params: Promise<{ pageId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { pageId } = await context.params;

  try {
    return NextResponse.json({ threads: getPageCommentThreads(user.id, pageId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load comments";
    return NextResponse.json({ error: message }, { status: message === "Forbidden" ? 403 : 400 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ pageId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { pageId } = await context.params;
  const body = await request.json().catch(() => null) as { selectedText?: string; body?: string } | null;

  try {
    const thread = createPageCommentThread(user.id, pageId, {
      selectedText: body?.selectedText ?? "",
      body: body?.body ?? "",
    });
    return NextResponse.json({ thread }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not add comment";
    return NextResponse.json({ error: message }, { status: message === "Forbidden" ? 403 : 400 });
  }
}
