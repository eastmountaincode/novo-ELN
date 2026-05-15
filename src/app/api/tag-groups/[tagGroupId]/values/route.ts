import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { createTagValue } from "@/lib/store";

export async function POST(request: Request, context: { params: Promise<{ tagGroupId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { tagGroupId } = await context.params;
  const body = (await request.json().catch(() => null)) as { label?: string; color?: string } | null;
  if (!body?.label?.trim()) return NextResponse.json({ error: "Tag label is required" }, { status: 400 });
  try {
    const tagValueId = createTagValue(user.id, tagGroupId, { label: body.label, color: body.color });
    return NextResponse.json({ tagValueId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create tag value" }, { status: 400 });
  }
}
