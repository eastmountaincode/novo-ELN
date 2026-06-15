import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { deleteNotebook, renameNotebook, updateNotebookColor, updateNotebookPageTitleTemplate } from "@/lib/store";

export async function PATCH(request: Request, context: { params: Promise<{ notebookId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { notebookId } = await context.params;
  const body = (await request.json().catch(() => null)) as { name?: string; color?: string; pageTitleTemplate?: string; pageTitleTemplateEnabled?: unknown } | null;
  try {
    if (body?.name !== undefined) {
      if (!body.name.trim()) return NextResponse.json({ error: "Notebook name is required" }, { status: 400 });
      renameNotebook(user.id, notebookId, body.name);
    }
    if (body?.color !== undefined) updateNotebookColor(user.id, notebookId, body.color);
    if (body?.pageTitleTemplate !== undefined || body?.pageTitleTemplateEnabled !== undefined) {
      updateNotebookPageTitleTemplate(user.id, notebookId, body?.pageTitleTemplate ?? "", body?.pageTitleTemplateEnabled === true);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update notebook";
    return NextResponse.json({ error: message }, { status: message === "Forbidden" ? 403 : 400 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ notebookId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { notebookId } = await context.params;
  try {
    deleteNotebook(user.id, notebookId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete notebook";
    return NextResponse.json({ error: message }, { status: message === "Forbidden" || message === "Only owners can manage sharing." ? 403 : 400 });
  }
}
