import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { adminSetUserActive } from "@/lib/store";

export async function PATCH(request: Request, context: { params: Promise<{ userId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { userId } = await context.params;
  const body = (await request.json().catch(() => null)) as { active?: boolean } | null;
  if (typeof body?.active !== "boolean") return NextResponse.json({ error: "Active status is required." }, { status: 400 });

  try {
    adminSetUserActive(user.id, userId, body.active);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update user status.";
    const status = message === "Forbidden" ? 403 : message === "User not found." ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
