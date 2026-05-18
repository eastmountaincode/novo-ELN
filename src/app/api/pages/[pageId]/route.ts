import { NextResponse } from "next/server";
import type { PageStatus } from "@/lib/types";
import { currentUser } from "@/lib/auth";
import { deletePage, setPageLocked, updatePage } from "@/lib/store";

export async function PATCH(request: Request, context: { params: Promise<{ pageId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { pageId } = await context.params;
  const body = (await request.json().catch(() => null)) as { title?: string; body?: string; status?: PageStatus; locked?: boolean } | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  try {
    if (typeof body.locked === "boolean") setPageLocked(user.id, pageId, body.locked);
    const contentPatch = {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.body !== undefined ? { body: body.body } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
    };
    updatePage(user.id, pageId, contentPatch);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update page";
    const status = message === "Forbidden" || message === "Only owners can lock pages." ? 403 : message === "Page is locked." ? 423 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ pageId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { pageId } = await context.params;
  try {
    deletePage(user.id, pageId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete page";
    return NextResponse.json({ error: message }, { status: message === "Forbidden" ? 403 : message === "Page is locked." ? 423 : 400 });
  }
}
