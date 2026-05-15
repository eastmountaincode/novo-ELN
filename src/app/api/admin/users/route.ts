import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { listUsersForAdmin } from "@/lib/store";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    return NextResponse.json({ users: listUsersForAdmin(user.id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to list users.";
    return NextResponse.json({ error: message }, { status: message === "Forbidden" ? 403 : 400 });
  }
}
