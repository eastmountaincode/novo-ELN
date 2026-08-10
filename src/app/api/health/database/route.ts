import { NextResponse } from "next/server";
import { ensureDatabase } from "../../../../lib/store";

export const runtime = "nodejs";

export async function GET() {
  try {
    ensureDatabase();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
