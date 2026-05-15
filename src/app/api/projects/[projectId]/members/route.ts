import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { shareProject } from "@/lib/store";
import type { AccessRole } from "@/lib/types";

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await context.params;
  const body = (await request.json().catch(() => null)) as { email?: string; role?: AccessRole } | null;
  if (!body?.email || !body.role) return NextResponse.json({ error: "Email and role are required." }, { status: 400 });

  try {
    shareProject({ actorUserId: user.id, projectId, email: body.email, role: body.role });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to share project.";
    return NextResponse.json({ error: message }, { status: message === "Forbidden" ? 403 : message === "User not found." ? 404 : 400 });
  }
}
