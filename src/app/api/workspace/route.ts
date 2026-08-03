import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getWorkspace } from "@/lib/store";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const workspace = getWorkspace(user.id);
  return NextResponse.json(workspace);
}
