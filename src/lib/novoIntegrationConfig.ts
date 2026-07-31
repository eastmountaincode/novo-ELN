import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

const minimumIntegrationSecretLength = 32;
const sameOriginBase = new URL("https://novo.invalid");
const defaultChatReturnBase = "/chat/";
const reportedConfigurationIssues = new Set<string>();

export type IntegrationSecretState =
  | { status: "disabled" }
  | { status: "ready"; secret: string }
  | { status: "misconfigured" };

export function getIntegrationSecretState(): IntegrationSecretState {
  const filePath = process.env.NOVO_INTEGRATION_SECRET_FILE?.trim();
  if (!filePath) return { status: "disabled" };

  try {
    const secret = readFileSync(filePath, "utf8").trim();
    if (Buffer.byteLength(secret, "utf8") < minimumIntegrationSecretLength || secret.includes("\0")) {
      return { status: "misconfigured" };
    }
    return { status: "ready", secret };
  } catch {
    return { status: "misconfigured" };
  }
}

export function bearerMatchesIntegrationSecret(authorizationHeader: string | null, secret: string) {
  const match = authorizationHeader?.match(/^Bearer[\t ]+(.+)$/i);
  const presented = match?.[1]?.trim() ?? "";
  if (!presented) return false;
  const actual = Buffer.from(presented, "utf8");
  const expected = Buffer.from(secret, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function validateSameOriginAbsolutePath(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate || !isSafeAbsolutePathSyntax(candidate)) return null;

  try {
    const parsed = new URL(candidate, sameOriginBase);
    if (parsed.origin !== sameOriginBase.origin) return null;
    const normalized = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    // WHATWG parsing removes encoded dot segments before serializing. Recheck
    // the result so normalization cannot turn a leading path into a
    // scheme-relative redirect (for example /%2e%2e//attacker.example/...).
    return isSafeAbsolutePathSyntax(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

export function getAdvertisedChatIntegration(): { url: string } | null {
  const configuredUrl = process.env.NOVO_CHAT_URL?.trim();
  if (!configuredUrl) return null;

  const url = validateSameOriginAbsolutePath(configuredUrl);
  const secretState = getIntegrationSecretState();
  if (!url) {
    reportConfigurationIssue("invalid-chat-url", "NOVO_CHAT_URL must be a same-origin absolute path.");
    return null;
  }
  if (secretState.status !== "ready") {
    reportConfigurationIssue(
      "chat-without-secret",
      "NOVO_CHAT_URL is configured, but NOVO_INTEGRATION_SECRET_FILE is unavailable or invalid.",
    );
    return null;
  }
  return { url };
}

export function validateNovoLoginReturnPath(value: string | null | undefined): string | null {
  const requested = validateSameOriginAbsolutePath(value);
  if (!requested) return null;

  const configuredValue = process.env.NOVO_CHAT_URL?.trim();
  const configuredBase = configuredValue
    ? validateSameOriginAbsolutePath(configuredValue)
    : defaultChatReturnBase;
  if (!configuredBase) return null;

  const requestedUrl = new URL(requested, sameOriginBase);
  const baseUrl = new URL(configuredBase, sameOriginBase);
  if (requestedUrl.origin !== sameOriginBase.origin || baseUrl.origin !== sameOriginBase.origin) return null;
  const basePath = baseUrl.pathname.endsWith("/") ? baseUrl.pathname : `${baseUrl.pathname}/`;
  if (requestedUrl.pathname !== baseUrl.pathname && !requestedUrl.pathname.startsWith(basePath)) return null;
  return requested;
}

function isSafeAbsolutePathSyntax(value: string) {
  return value.startsWith("/")
    && !value.startsWith("//")
    && !value.includes("\\")
    && !/%2f|%5c/i.test(value)
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function reportConfigurationIssue(key: string, message: string) {
  if (reportedConfigurationIssues.has(key)) return;
  reportedConfigurationIssues.add(key);
  console.error(`[Novo integration] ${message}`);
}
