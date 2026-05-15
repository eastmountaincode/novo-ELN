import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { deleteProject, renameProject, updateProjectColor } from "@/lib/store";

export async function PATCH(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId } = await context.params;
  const body = (await request.json().catch(() => null)) as { name?: string; color?: string } | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  if (body.name !== undefined) {
    if (!body.name.trim()) return NextResponse.json({ error: "Project name is required" }, { status: 400 });
    renameProject(user.id, projectId, body.name);
  }
  if (body.color !== undefined) {
    updateProjectColor(user.id, projectId, body.color);
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId } = await context.params;
  deleteProject(user.id, projectId);
  return NextResponse.json({ ok: true });
}
