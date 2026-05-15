import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { searchWorkspace } from "@/lib/search";
import { ensureDatabase } from "@/lib/store";

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  ensureDatabase();
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? "";
  const limit = Number(searchParams.get("limit") ?? 30);
  return NextResponse.json({
    results: searchWorkspace(user.id, query, Number.isFinite(limit) ? limit : 30),
  });
}
