import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getAdminDataOverview } from "@/lib/store";

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const url = new URL(request.url);
    const fileLimitParam = url.searchParams.get("fileLimit");
    const fileOffsetParam = url.searchParams.get("fileOffset");
    const fileLimit = fileLimitParam ? Number(fileLimitParam) : undefined;
    const fileOffset = fileOffsetParam ? Number(fileOffsetParam) : undefined;
    return NextResponse.json({ data: getAdminDataOverview(user.id, { fileLimit, fileOffset }) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load data overview.";
    return NextResponse.json({ error: message }, { status: message === "Forbidden" ? 403 : 400 });
  }
}
