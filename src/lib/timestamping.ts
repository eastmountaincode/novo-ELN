import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const defaultTimestampUrl = "http://timestamp.digicert.com";
const defaultTimestampProvider = "digicert";
const defaultTimestampTimeoutMs = 30_000;
const defaultTimestampCaFiles = [
  "/etc/ssl/certs/ca-certificates.crt",
  "/etc/ssl/cert.pem",
  "/etc/pki/tls/certs/ca-bundle.crt",
];
const opensslTimeoutMs = 15_000;
const opensslMaxBuffer = 1024 * 1024;

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
  caFile: string;
  untrustedCertFile: string;
};

type OpenSslResult = { stdout: string; stderr: string };
type OpenSslRunner = (args: string[]) => Promise<OpenSslResult>;

export async function requestTimestampForProofHash(proofHash: string): Promise<TimestampAuthorityToken> {
  const messageImprint = normalizeSha256Digest(proofHash);
  const config = readTimestampConfig();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "novo-rfc3161-"));
  const requestPath = path.join(tempDir, "request.tsq");
  const responsePath = path.join(tempDir, "response.tsr");

  try {
    await runOpenSsl(["ts", "-query", "-digest", messageImprint, "-sha256", "-cert", "-no_nonce", "-out", requestPath]);
    const requestBytes = await readFile(requestPath);
    const responseBytes = await postTimestampRequest(config, requestBytes);
    await writeFile(responsePath, responseBytes);
    const reply = await runOpenSsl(["ts", "-reply", "-in", responsePath, "-text"]);
    const metadata = parseTimestampReplyText(reply.stdout);
    if (metadata.status !== "granted") {
      throw new Error(`Timestamp authority returned ${metadata.status || "unknown status"}.`);
    }
    const verification = await verifyTimestampResponseFiles({
      requestPath,
      responsePath,
      tempDir,
      caFile: config.caFile,
      untrustedCertFile: config.untrustedCertFile,
    });

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
      tsaSubject: verification.tsaSubject || metadata.tsaSubject,
      tsaCertFingerprint: verification.tsaCertFingerprint,
      verifiedAt: new Date().toISOString(),
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

export async function verifyTimestampResponseFiles(
  input: {
    requestPath: string;
    responsePath: string;
    tempDir: string;
    caFile: string;
    untrustedCertFile?: string;
  },
  runner: OpenSslRunner = runOpenSsl,
) {
  const verifyArgs = ["ts", "-verify", "-queryfile", input.requestPath, "-in", input.responsePath, "-CAfile", input.caFile];
  if (input.untrustedCertFile) verifyArgs.push("-untrusted", input.untrustedCertFile);

  try {
    await runner(verifyArgs);
  } catch (error) {
    throw new Error(`Timestamp authority response verification failed${opensslErrorDetail(error)}.`, { cause: error });
  }

  const tokenPath = path.join(input.tempDir, "timestamp-token.der");
  const signerPath = path.join(input.tempDir, "timestamp-signer.pem");
  const contentPath = path.join(input.tempDir, "timestamp-content.der");
  try {
    await runner(["ts", "-reply", "-in", input.responsePath, "-token_out", "-out", tokenPath]);
    await runner(["cms", "-verify", "-inform", "DER", "-in", tokenPath, "-noverify", "-out", contentPath, "-signer", signerPath]);
    const certificate = await runner(["x509", "-in", signerPath, "-noout", "-subject", "-fingerprint", "-sha256"]);
    return parseTsaSignerCertificateText(certificate.stdout);
  } catch (error) {
    throw new Error(`Timestamp authority signer certificate inspection failed${opensslErrorDetail(error)}.`, { cause: error });
  }
}

export function parseTsaSignerCertificateText(text: string) {
  const subject = readCertificateLine(text, "subject");
  const rawFingerprint = readCertificateLine(text, "sha256 Fingerprint").replaceAll(":", "").toLowerCase();
  if (!subject || !/^[a-f0-9]{64}$/.test(rawFingerprint)) {
    throw new Error("Timestamp authority signer certificate details are incomplete.");
  }
  return {
    tsaSubject: subject,
    tsaCertFingerprint: `sha256:${rawFingerprint}`,
  };
}

function readTimestampConfig(): TimestampConfig {
  const provider = (process.env.NOVO_TSA_PROVIDER || defaultTimestampProvider).trim() || defaultTimestampProvider;
  const url = (process.env.NOVO_TSA_URL || defaultTimestampUrl).trim() || defaultTimestampUrl;
  const authModeValue = (process.env.NOVO_TSA_AUTH_MODE || "none").trim().toLowerCase();
  if (authModeValue !== "none" && authModeValue !== "basic") throw new Error(`Unsupported TSA auth mode: ${authModeValue}`);
  const timeoutMs = Number.parseInt(process.env.NOVO_TSA_TIMEOUT_MS || "", 10);
  const configuredCaFile = (process.env.NOVO_TSA_CA_FILE || "").trim();
  const caFile = configuredCaFile || defaultTimestampCaFiles.find(existsSync) || defaultTimestampCaFiles[0];
  return {
    provider,
    url,
    authMode: authModeValue,
    username: process.env.NOVO_TSA_USERNAME || "",
    password: process.env.NOVO_TSA_PASSWORD || "",
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : defaultTimestampTimeoutMs,
    caFile,
    untrustedCertFile: (process.env.NOVO_TSA_UNTRUSTED_CERT_FILE || "").trim(),
  };
}

async function runOpenSsl(args: string[]): Promise<OpenSslResult> {
  return execFileAsync("openssl", args, {
    timeout: opensslTimeoutMs,
    maxBuffer: opensslMaxBuffer,
    encoding: "utf8",
  });
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

function readCertificateLine(text: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`^${escaped}\\s*=\\s*(.*)$`, "im"));
  return match?.[1]?.trim() ?? "";
}

function opensslErrorDetail(error: unknown) {
  if (!error || typeof error !== "object" || !("stderr" in error) || typeof error.stderr !== "string") return "";
  const detail = error.stderr.trim().split("\n").at(-1)?.trim();
  return detail ? `: ${detail}` : "";
}
