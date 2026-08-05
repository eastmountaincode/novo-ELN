import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const defaultTimestampUrl = "http://timestamp.digicert.com";
const defaultTimestampProvider = "digicert";
const defaultTimestampTimeoutMs = 30_000;

export type TimestampAuthorityToken = {
  provider: string;
  tsaUrl: string;
  hashAlgorithm: "sha256";
  messageImprint: string;
  requestDerBase64: string;
  responseDerBase64: string;
  status: string;
  statusMessage: string;
  policyOid: string;
  serialNumber: string;
  tsaTime: string;
  tsaSubject: string;
  tsaCertFingerprint: string;
  verifiedAt: string;
  errorMessage: string;
};

type TimestampConfig = {
  provider: string;
  url: string;
  authMode: "none" | "basic";
  username: string;
  password: string;
  timeoutMs: number;
};

export async function requestTimestampForProofHash(proofHash: string): Promise<TimestampAuthorityToken> {
  const messageImprint = normalizeSha256Digest(proofHash);
  const config = readTimestampConfig();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "novo-rfc3161-"));
  const requestPath = path.join(tempDir, "request.tsq");
  const responsePath = path.join(tempDir, "response.tsr");

  try {
    await execFileAsync("openssl", ["ts", "-query", "-digest", messageImprint, "-sha256", "-cert", "-no_nonce", "-out", requestPath], {
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    });
    const requestBytes = await readFile(requestPath);
    const responseBytes = await postTimestampRequest(config, requestBytes);
    await writeFile(responsePath, responseBytes);
    const reply = await execFileAsync("openssl", ["ts", "-reply", "-in", responsePath, "-text"], {
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    });
    const metadata = parseTimestampReplyText(reply.stdout);
    if (metadata.status !== "granted") {
      throw new Error(`Timestamp authority returned ${metadata.status || "unknown status"}.`);
    }

    return {
      provider: config.provider,
      tsaUrl: config.url,
      hashAlgorithm: "sha256",
      messageImprint,
      requestDerBase64: requestBytes.toString("base64"),
      responseDerBase64: responseBytes.toString("base64"),
      status: metadata.status,
      statusMessage: metadata.statusMessage,
      policyOid: metadata.policyOid,
      serialNumber: metadata.serialNumber,
      tsaTime: metadata.tsaTime,
      tsaSubject: metadata.tsaSubject,
      tsaCertFingerprint: "",
      verifiedAt: "",
      errorMessage: "",
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function parseTimestampReplyText(text: string) {
  const rawStatus = readReplyLine(text, "Status");
  const normalizedStatus = rawStatus.replace(/\.$/, "").trim().toLowerCase();
  return {
    status: normalizedStatus === "granted" ? "granted" : normalizedStatus,
    statusMessage: readReplyLine(text, "Status description"),
    policyOid: readReplyLine(text, "Policy OID"),
    serialNumber: readReplyLine(text, "Serial number"),
    tsaTime: readReplyLine(text, "Time stamp"),
    tsaSubject: readReplyLine(text, "TSA"),
  };
}

function readTimestampConfig(): TimestampConfig {
  const provider = (process.env.NOVO_TSA_PROVIDER || defaultTimestampProvider).trim() || defaultTimestampProvider;
  const url = (process.env.NOVO_TSA_URL || defaultTimestampUrl).trim() || defaultTimestampUrl;
  const authModeValue = (process.env.NOVO_TSA_AUTH_MODE || "none").trim().toLowerCase();
  if (authModeValue !== "none" && authModeValue !== "basic") throw new Error(`Unsupported TSA auth mode: ${authModeValue}`);
  const timeoutMs = Number.parseInt(process.env.NOVO_TSA_TIMEOUT_MS || "", 10);
  return {
    provider,
    url,
    authMode: authModeValue,
    username: process.env.NOVO_TSA_USERNAME || "",
    password: process.env.NOVO_TSA_PASSWORD || "",
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : defaultTimestampTimeoutMs,
  };
}

async function postTimestampRequest(config: TimestampConfig, requestBytes: Buffer) {
  const headers: Record<string, string> = {
    Accept: "application/timestamp-reply",
    "Content-Type": "application/timestamp-query",
  };
  if (config.authMode === "basic") {
    if (!config.username || !config.password) throw new Error("TSA basic auth requires NOVO_TSA_USERNAME and NOVO_TSA_PASSWORD.");
    headers.Authorization = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const requestBody = requestBytes.buffer.slice(requestBytes.byteOffset, requestBytes.byteOffset + requestBytes.byteLength) as ArrayBuffer;
  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers,
      body: requestBody,
      signal: controller.signal,
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!response.ok) throw new Error(`Timestamp authority request failed with HTTP ${response.status}.`);
    return bytes;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("Timestamp authority request timed out.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeSha256Digest(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error("RFC3161 timestamping requires a SHA-256 hex proof hash.");
  return normalized;
}

function readReplyLine(text: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`^${escaped}:\\s*(.*)$`, "im"));
  return match?.[1]?.trim() ?? "";
}
