import { NextResponse } from "next/server";
import { register } from "@/lib/auth";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { email?: string; firstName?: string; lastName?: string; name?: string; password?: string } | null;
  const name = `${body?.firstName ?? ""} ${body?.lastName ?? ""}`.trim() || body?.name?.trim() || "";
  if (!body?.email || !name || !body.password) {
    return NextResponse.json({ error: "First name, email, and password are required." }, { status: 400 });
  }

  try {
    const user = await register({ email: body.email, name, password: body.password });
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Registration failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
