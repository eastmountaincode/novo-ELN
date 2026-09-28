import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { deleteSharedLink, SharedLinkError, updateSharedLink } from "@/lib/sharedLinks";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await params;
    const link = updateSharedLink(user.id, id, await request.json().catch(() => null));
    return NextResponse.json({ link });
  } catch (error) {
    return linkError(error, "Unable to save link. Please try again.");
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await params;
    deleteSharedLink(user.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return linkError(error, "Unable to delete link. Please try again.");
  }
}

function linkError(error: unknown, fallback: string) {
  return NextResponse.json(
    { error: error instanceof SharedLinkError ? error.message : fallback },
    { status: error instanceof SharedLinkError ? error.status : 500 },
  );
}
