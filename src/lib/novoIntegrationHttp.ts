import { NextResponse } from "next/server";
import { currentUser } from "./auth";
import {
  bearerMatchesIntegrationSecret,
  getIntegrationSecretState,
} from "./novoIntegrationConfig";
import type { AppUser } from "./types";

const privateNoStoreHeaders = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie, Authorization",
};

export async function authenticateIntegrationRequest(request: Request): Promise<
  | { authorized: true; user: AppUser }
  | { authorized: false; response: NextResponse }
> {
  const secretState = getIntegrationSecretState();
  if (secretState.status === "disabled") {
    return {
      authorized: false,
      response: integrationJson({ error: "Not found" }, { status: 404 }),
    };
  }
  if (secretState.status === "misconfigured") {
    return {
      authorized: false,
      response: integrationJson({ error: "Integration unavailable" }, { status: 503 }),
    };
  }
  if (!bearerMatchesIntegrationSecret(request.headers.get("authorization"), secretState.secret)) {
    return {
      authorized: false,
      response: integrationJson({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const user = await currentUser();
  if (!user) {
    return {
      authorized: false,
      response: integrationJson({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { authorized: true, user };
}

export function integrationJson(
  body: unknown,
  init: { status?: number; headers?: HeadersInit } = {},
) {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(privateNoStoreHeaders)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return NextResponse.json(body, { status: init.status, headers });
}
