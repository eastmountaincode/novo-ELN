import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getAdminAppSettings, updateAdminAppSettings } from "@/lib/store";
import type { AdminAppSettings } from "@/lib/types";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    return NextResponse.json({ settings: getAdminAppSettings(user.id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load app settings.";
    return NextResponse.json({ error: message }, { status: message === "Forbidden" ? 403 : 400 });
  }
}

export async function PATCH(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Partial<AdminAppSettings> | null;
  try {
    return NextResponse.json({ settings: updateAdminAppSettings(user.id, body ?? {}) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update app settings.";
    return NextResponse.json({ error: message }, { status: message === "Forbidden" ? 403 : 400 });
  }
}
