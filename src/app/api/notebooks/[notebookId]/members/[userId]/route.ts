import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { unshareNotebook } from "@/lib/store";

export async function DELETE(_request: Request, context: { params: Promise<{ notebookId: string; userId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { notebookId, userId } = await context.params;
  try {
    unshareNotebook(user.id, notebookId, userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to remove notebook member.";
    return NextResponse.json({ error: message }, { status: message === "Forbidden" ? 403 : 400 });
  }
}
