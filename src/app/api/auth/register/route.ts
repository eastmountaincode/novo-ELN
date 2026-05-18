import { NextResponse } from "next/server";
import { register } from "@/lib/auth";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { email?: string; firstName?: string; lastName?: string; password?: string } | null;
  if (!body?.email || !body.firstName?.trim() || !body.password) {
    return NextResponse.json({ error: "First name, email, and password are required." }, { status: 400 });
  }

  try {
    const user = await register({ email: body.email, firstName: body.firstName, lastName: body.lastName, password: body.password });
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Registration failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
