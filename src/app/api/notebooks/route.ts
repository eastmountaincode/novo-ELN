import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { createNotebook } from "@/lib/store";

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { projectId?: string; name?: string } | null;
  if (!body?.projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  return NextResponse.json(createNotebook(user.id, body.projectId, body.name?.trim() || "New Notebook"));
}
