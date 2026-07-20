import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { deleteTagForAdmin, listTagsForAdmin, mergeTagForAdmin, renameTagForAdmin } from "@/lib/store";

function errorStatus(message: string) {
  if (message === "Forbidden") return 403;
  if (message === "Tag not found.") return 404;
  return 400;
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    return NextResponse.json({ tags: listTagsForAdmin(user.id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load tags.";
    return NextResponse.json({ error: message }, { status: errorStatus(message) });
  }
}

export async function PATCH(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { tagId?: unknown; label?: unknown } | null;
  try {
    if (!body || typeof body.tagId !== "string" || typeof body.label !== "string") throw new Error("Tag and name are required.");
    return NextResponse.json({ tags: renameTagForAdmin(user.id, body.tagId, body.label) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to rename tag.";
    return NextResponse.json({ error: message }, { status: errorStatus(message) });
  }
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { sourceTagId?: unknown; targetTagId?: unknown } | null;
  try {
    if (!body || typeof body.sourceTagId !== "string" || typeof body.targetTagId !== "string") throw new Error("Source and target tags are required.");
    return NextResponse.json({ tags: mergeTagForAdmin(user.id, body.sourceTagId, body.targetTagId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to merge tags.";
    return NextResponse.json({ error: message }, { status: errorStatus(message) });
  }
}

export async function DELETE(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tagId = new URL(request.url).searchParams.get("tagId");
  try {
    if (!tagId) throw new Error("Tag is required.");
    return NextResponse.json({ tags: deleteTagForAdmin(user.id, tagId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete tag.";
    return NextResponse.json({ error: message }, { status: errorStatus(message) });
  }
}
