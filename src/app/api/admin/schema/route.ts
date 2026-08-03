import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getErflowAdminStatus } from "@/lib/erflow";
import { getAdminDatabaseSchema } from "@/lib/store";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    return NextResponse.json({
      schema: getAdminDatabaseSchema(user.id),
      erflow: getErflowAdminStatus(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load database schema.";
    return NextResponse.json({ error: message }, { status: message === "Forbidden" ? 403 : 400 });
  }
}
