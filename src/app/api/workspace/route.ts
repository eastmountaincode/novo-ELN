import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getAdvertisedChatIntegration } from "@/lib/novoIntegrationConfig";
import { getWorkspace } from "@/lib/store";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const workspace = getWorkspace(user.id);
  const chat = getAdvertisedChatIntegration();
  return NextResponse.json(chat ? { ...workspace, integrations: { chat } } : workspace);
}
