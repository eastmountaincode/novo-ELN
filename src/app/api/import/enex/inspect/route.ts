import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { inspectEnexFile } from "@/lib/enex";

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { path?: string } | null;
  if (!body?.path?.trim()) return NextResponse.json({ error: "ENEX server path is required" }, { status: 400 });

  try {
    const inspection = await inspectEnexFile(body.path);
    return NextResponse.json(inspection);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to inspect ENEX file." }, { status: 400 });
  }
}
