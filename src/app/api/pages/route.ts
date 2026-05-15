import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { createPage } from "@/lib/store";

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { notebookId?: string } | null;
  if (!body?.notebookId) return NextResponse.json({ error: "notebookId is required" }, { status: 400 });
  const pageId = createPage(user.id, body.notebookId);
  return NextResponse.json({ pageId });
}
