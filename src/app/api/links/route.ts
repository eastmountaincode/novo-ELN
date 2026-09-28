import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { createSharedLink, listSharedLinks, SharedLinkError } from "@/lib/sharedLinks";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ links: listSharedLinks(user.id) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const link = createSharedLink(user.id, await request.json().catch(() => null));
    return NextResponse.json({ link }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof SharedLinkError ? error.message : "Unable to add link. Please try again." },
      { status: error instanceof SharedLinkError ? error.status : 500 },
    );
  }
}
