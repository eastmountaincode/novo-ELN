import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { createTagGroup } from "@/lib/store";
import type { TagSelectionMode } from "@/lib/types";

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId } = await context.params;
  const body = (await request.json().catch(() => null)) as { name?: string; mode?: TagSelectionMode } | null;
  if (!body?.name?.trim()) return NextResponse.json({ error: "Tag group name is required" }, { status: 400 });
  try {
    const tagGroupId = createTagGroup(user.id, projectId, { name: body.name, mode: body.mode });
    return NextResponse.json({ tagGroupId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create tag group" }, { status: 400 });
  }
}
