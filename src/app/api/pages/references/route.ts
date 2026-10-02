import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { suggestPageReferences } from "@/lib/pageReferences";
import { ensureDatabase } from "@/lib/store";

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  ensureDatabase();
  const params = new URL(request.url).searchParams;
  return NextResponse.json({
    pages: suggestPageReferences(user.id, params.get("q") ?? "", params.get("currentPageId") ?? ""),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
