import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getPageActivityEvents } from "@/lib/store";

export async function GET(request: Request, context: { params: Promise<{ pageId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { pageId } = await context.params;
  const url = new URL(request.url);
  const limit = clampNumber(url.searchParams.get("limit"), 1, 100, 25);
  const offset = clampNumber(url.searchParams.get("offset"), 0, 1_000_000_000, 0);

  try {
    return NextResponse.json(getPageActivityEvents(user.id, pageId, { limit, offset }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load page activity";
    return NextResponse.json({ error: message }, { status: message === "Forbidden" ? 403 : 400 });
  }
}

function clampNumber(value: string | null, min: number, max: number, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
