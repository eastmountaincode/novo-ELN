import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { duplicatePage } from "@/lib/store";

export async function POST(_request: Request, context: { params: Promise<{ pageId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { pageId } = await context.params;
  try {
    return NextResponse.json(duplicatePage(user.id, pageId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not duplicate page";
    const status = message === "Forbidden" ? 403 : message === "Page is locked." ? 423 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
