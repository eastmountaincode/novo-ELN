import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { addPageComment } from "@/lib/store";

export async function POST(request: Request, context: { params: Promise<{ threadId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { threadId } = await context.params;
  const body = await request.json().catch(() => null) as { body?: string } | null;

  try {
    const thread = addPageComment(user.id, threadId, body?.body ?? "");
    return NextResponse.json({ thread }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not add reply";
    return NextResponse.json({ error: message }, { status: message === "Forbidden" ? 403 : 400 });
  }
}
