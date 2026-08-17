import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { createUserForAdmin } from "@/lib/store";

export async function POST(request: Request) {
  const admin = await currentUser();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { email?: string; firstName?: string; lastName?: string; password?: string } | null;
  if (!body?.email || !body.firstName?.trim() || !body.password) {
    return NextResponse.json({ error: "First name, email, and password are required." }, { status: 400 });
  }

  try {
    const user = createUserForAdmin(admin.id, { email: body.email, firstName: body.firstName, lastName: body.lastName, password: body.password });
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create user.";
    return NextResponse.json({ error: message }, { status: message === "Forbidden" ? 403 : 400 });
  }
}
