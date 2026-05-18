import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { shareNotebook } from "@/lib/store";
import type { AccessRole } from "@/lib/types";

export async function POST(request: Request, context: { params: Promise<{ notebookId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { notebookId } = await context.params;
  const body = (await request.json().catch(() => null)) as { email?: string; role?: AccessRole } | null;
  if (!body?.email || !body.role) return NextResponse.json({ error: "Email and role are required." }, { status: 400 });

  try {
    shareNotebook({ actorUserId: user.id, notebookId, email: body.email, role: body.role });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to share notebook.";
    return NextResponse.json({ error: message }, { status: message === "Forbidden" || message === "Only owners can manage sharing." ? 403 : message === "User not found." ? 404 : 400 });
  }
}
