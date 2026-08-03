import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { ensureUserSigningKey, listUserSigningKeys } from "@/lib/store";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ keys: listUserSigningKeys(user.id) });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { currentPassword?: string } | null;
  if (!body?.currentPassword) return NextResponse.json({ error: "Current password is required." }, { status: 400 });

  try {
    ensureUserSigningKey(user.id, body.currentPassword);
    return NextResponse.json({ keys: listUserSigningKeys(user.id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Signing key setup failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
