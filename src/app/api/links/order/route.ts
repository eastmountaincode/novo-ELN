import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { reorderSharedLinks, SharedLinkError } from "@/lib/sharedLinks";

export async function PUT(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const links = reorderSharedLinks(user.id, await request.json().catch(() => null));
    return NextResponse.json({ links });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof SharedLinkError ? error.message : "Unable to save the order. Please try again." },
      { status: error instanceof SharedLinkError ? error.status : 500 },
    );
  }
}
