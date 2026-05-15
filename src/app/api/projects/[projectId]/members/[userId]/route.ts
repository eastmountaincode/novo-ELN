import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { unshareProject } from "@/lib/store";

export async function DELETE(_request: Request, context: { params: Promise<{ projectId: string; userId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId, userId } = await context.params;
  try {
    unshareProject(user.id, projectId, userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to remove project member.";
    return NextResponse.json({ error: message }, { status: message === "Forbidden" ? 403 : 400 });
  }
}
