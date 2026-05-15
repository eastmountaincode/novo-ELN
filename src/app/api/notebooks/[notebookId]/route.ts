import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { deleteNotebook, renameNotebook } from "@/lib/store";

export async function PATCH(request: Request, context: { params: Promise<{ notebookId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { notebookId } = await context.params;
  const body = (await request.json().catch(() => null)) as { name?: string } | null;
  if (!body?.name?.trim()) return NextResponse.json({ error: "Notebook name is required" }, { status: 400 });
  renameNotebook(user.id, notebookId, body.name);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, context: { params: Promise<{ notebookId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { notebookId } = await context.params;
  deleteNotebook(user.id, notebookId);
  return NextResponse.json({ ok: true });
}
