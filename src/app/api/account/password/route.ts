import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { changeOwnPassword } from "@/lib/store";

export async function PATCH(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { currentPassword?: string; nextPassword?: string } | null;
  if (!body?.currentPassword || !body.nextPassword) {
    return NextResponse.json({ error: "Current password and new password are required." }, { status: 400 });
  }

  try {
    changeOwnPassword(user.id, body.currentPassword, body.nextPassword);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Password change failed.";
    return NextResponse.json({ error: message }, { status: message === "Forbidden" ? 403 : 400 });
  }
}
