import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getPageActivityEvents } from "@/lib/store";

export async function GET(_request: Request, context: { params: Promise<{ pageId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { pageId } = await context.params;

  try {
    return NextResponse.json({ events: getPageActivityEvents(user.id, pageId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load page activity";
    return NextResponse.json({ error: message }, { status: message === "Forbidden" ? 403 : 400 });
  }
}
