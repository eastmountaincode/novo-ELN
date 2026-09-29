import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { listSharedLinks } from "@/lib/sharedLinks";
import { resolveLinkFavicon } from "@/lib/linkFavicon";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
  const user = await currentUser();
  if (!user) return new NextResponse(null, { status: 401, headers });
  const { id } = await params;
  const link = listSharedLinks(user.id).find((item) => item.id === id);
  if (!link) return new NextResponse(null, { status: 404, headers });
  const icon = await resolveLinkFavicon(link.url);
  return icon
    ? NextResponse.redirect(icon, { status: 302, headers })
    : new NextResponse(null, { status: 404, headers });
}
