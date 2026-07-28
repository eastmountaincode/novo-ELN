import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { createPage, getPage } from "@/lib/store";

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { notebookId?: string } | null;
  if (!body?.notebookId) return NextResponse.json({ error: "notebookId is required" }, { status: 400 });
  try {
    const pageId = createPage(user.id, body.notebookId);
    return NextResponse.json({ pageId, page: getPage(user.id, pageId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create page";
    return NextResponse.json({ error: message }, { status: message === "Forbidden" ? 403 : 400 });
  }
}
