import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { setPageTags } from "@/lib/store";

export async function PATCH(request: Request, context: { params: Promise<{ pageId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { pageId } = await context.params;
  const body = (await request.json().catch(() => null)) as { tags?: unknown } | null;
  if (!body || !Array.isArray(body.tags) || body.tags.some((tag) => typeof tag !== "string")) {
    return NextResponse.json({ error: "Tags must be an array of strings" }, { status: 400 });
  }
  try {
    setPageTags(user.id, pageId, body.tags);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update page tags";
    return NextResponse.json({ error: message }, { status: message === "Forbidden" ? 403 : 400 });
  }
}
