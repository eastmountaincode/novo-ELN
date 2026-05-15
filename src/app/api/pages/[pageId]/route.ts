import { NextResponse } from "next/server";
import type { PageStatus } from "@/lib/types";
import { currentUser } from "@/lib/auth";
import { deletePage, updatePage } from "@/lib/store";

export async function PATCH(request: Request, context: { params: Promise<{ pageId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { pageId } = await context.params;
  const body = (await request.json().catch(() => null)) as { title?: string; body?: string; status?: PageStatus } | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  updatePage(user.id, pageId, body);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, context: { params: Promise<{ pageId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { pageId } = await context.params;
  deletePage(user.id, pageId);
  return NextResponse.json({ ok: true });
}
