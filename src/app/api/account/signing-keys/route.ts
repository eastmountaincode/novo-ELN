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

  const body = (await request.json().catch(() => null)) as { signingPassphrase?: string; signingPassphraseConfirmation?: string } | null;
  const signingPassphrase = body?.signingPassphrase ?? "";
  const signingPassphraseConfirmation = body?.signingPassphraseConfirmation ?? "";
  if (!signingPassphrase) return NextResponse.json({ error: "Signing passphrase is required." }, { status: 400 });
  if (signingPassphrase !== signingPassphraseConfirmation) return NextResponse.json({ error: "Signing passphrases do not match." }, { status: 400 });

  try {
    ensureUserSigningKey(user.id, signingPassphrase);
    return NextResponse.json({ keys: listUserSigningKeys(user.id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Signing key setup failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
