import { NextResponse } from "next/server";
import { login } from "@/lib/auth";
import { validateNovoLoginReturnPath } from "@/lib/novoIntegrationConfig";
import { clearFailedLogins, getLoginRateLimit, recordFailedLogin } from "@/lib/store";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { email?: string; password?: string; rememberDevice?: boolean; returnTo?: string } | null;
  if (!body?.email || !body.password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const clientIp = getClientIp(request);
  const limit = getLoginRateLimit(body.email, clientIp);
  if (limit.limited) {
    return NextResponse.json(
      { error: "Too many login attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const user = await login(body.email, body.password, body.rememberDevice === true);
  if (!user) {
    recordFailedLogin(body.email, clientIp);
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  clearFailedLogins(body.email, clientIp);
  return NextResponse.json({ user, returnTo: validateNovoLoginReturnPath(body.returnTo) });
}

function getClientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor || request.headers.get("x-real-ip") || "unknown";
}
