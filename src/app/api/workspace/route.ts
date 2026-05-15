import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getWorkspace } from "@/lib/store";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(getWorkspace(user.id));
}
