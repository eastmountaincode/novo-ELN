import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getErflowAdminStatus, syncSchemaToErflow } from "@/lib/erflow";
import { getAdminDatabaseSchema } from "@/lib/store";

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { dryRun?: boolean; includeInternal?: boolean } | null;
  try {
    const schema = getAdminDatabaseSchema(user.id);
    const result = await syncSchemaToErflow(schema, {
      dryRun: body?.dryRun === true,
      includeInternal: body?.includeInternal === true,
    });
    return NextResponse.json({
      result,
      erflow: getErflowAdminStatus(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to sync ER Flow.";
    return NextResponse.json({ error: message }, { status: message === "Forbidden" ? 403 : 400 });
  }
}
