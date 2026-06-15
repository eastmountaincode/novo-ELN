import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { createUser, findUserById, recordUserLogin, verifyCredentials } from "./store";

const cookieName = "eln_session";
const defaultMaxAgeSeconds = 60 * 60 * 12;
const rememberedMaxAgeSeconds = 60 * 60 * 24 * 14;

function useSecureCookies() {
  return process.env.NODE_ENV === "production" && process.env.ELN_ALLOW_INSECURE_COOKIES !== "true";
}

function getSessionSecret() {
  const secret = process.env.ELN_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("ELN_SESSION_SECRET must be set to at least 32 characters.");
  }
  return secret;
}

type SessionPayload = {
  userId: string;
  expiresAt: number;
};

export async function login(email: string, password: string, rememberDevice = false) {
  const user = verifyCredentials(email, password);
  if (!user) return null;
  recordUserLogin(user.id);
  await setSession(user.id, rememberDevice ? rememberedMaxAgeSeconds : defaultMaxAgeSeconds);
  return user;
}

export async function register(input: { email: string; firstName: string; lastName?: string; password: string }) {
  const user = createUser(input);
  recordUserLogin(user.id);
  await setSession(user.id, defaultMaxAgeSeconds);
  return user;
}

export async function logout() {
  const cookieStore = await cookies();
  cookieStore.set(cookieName, "", { path: "/", maxAge: 0 });
}

export async function currentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(cookieName)?.value;
  const payload = token ? verifySession(token) : null;
  if (!payload) return null;
  return findUserById(payload.userId);
}

function signSession(payload: SessionPayload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${signature(body)}`;
}

async function setSession(userId: string, maxAgeSeconds: number) {
  const cookieStore = await cookies();
  cookieStore.set(cookieName, signSession({ userId, expiresAt: Date.now() + maxAgeSeconds * 1000 }), {
    httpOnly: true,
    sameSite: "lax",
    secure: useSecureCookies(),
    path: "/",
    maxAge: maxAgeSeconds,
  });
}

function verifySession(token: string): SessionPayload | null {
  const [body, actualSignature] = token.split(".");
  if (!body || !actualSignature) return null;
  const expectedSignature = signature(body);
  if (!safeEqual(actualSignature, expectedSignature)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (!payload.userId || payload.expiresAt < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function signature(body: string) {
  return createHmac("sha256", getSessionSecret()).update(body).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
