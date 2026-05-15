import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { adminSetUserPassword } from "@/lib/store";

export async function PATCH(request: Request, context: { params: Promise<{ userId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { userId } = await context.params;
  const body = (await request.json().catch(() => null)) as { nextPassword?: string } | null;
  if (!body?.nextPassword) return NextResponse.json({ error: "New password is required." }, { status: 400 });

  try {
    adminSetUserPassword(user.id, userId, body.nextPassword);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Password reset failed.";
    const status = message === "Forbidden" ? 403 : message === "User not found." ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
