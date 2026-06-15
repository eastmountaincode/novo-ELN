import { NextResponse } from "next/server";
import { appVersion } from "@/generated/app-version";

export async function GET() {
  return NextResponse.json(
    { version: appVersion },
    { headers: { "Cache-Control": "no-store" } },
  );
}
