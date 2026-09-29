import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { updateOwnProfile } from "@/lib/store";

export async function PATCH(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { firstName?: string; lastName?: string; authorTag?: string } | null;
  if (typeof body?.firstName !== "string" || !body.firstName.trim()) return NextResponse.json({ error: "First name is required." }, { status: 400 });
  if ((body.lastName !== undefined && typeof body.lastName !== "string") || (body.authorTag !== undefined && typeof body.authorTag !== "string")) {
    return NextResponse.json({ error: "Enter valid profile details." }, { status: 400 });
  }

  try {
    return NextResponse.json({ user: updateOwnProfile(user.id, { firstName: body.firstName, lastName: body.lastName ?? "", authorTag: body.authorTag }) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Profile update failed.";
    return NextResponse.json({ error: message }, { status: message === "Forbidden" ? 403 : 400 });
  }
}
