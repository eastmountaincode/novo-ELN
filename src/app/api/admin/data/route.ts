import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getAdminDataOverview } from "@/lib/store";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    return NextResponse.json({ data: getAdminDataOverview(user.id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load data overview.";
    return NextResponse.json({ error: message }, { status: message === "Forbidden" ? 403 : 400 });
  }
}
