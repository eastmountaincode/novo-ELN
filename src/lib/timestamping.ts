import { execFile } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
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
  certificateChainPem: string;
  trustAnchorPem: string;
  verificationJson: string;
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

    const verifiedAt = new Date().toISOString();
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
      certificateChainPem: verification.certificateChainPem,
      trustAnchorPem: verification.trustAnchorPem,
      verificationJson: buildVerificationJson({
        provider: config.provider,
        tsaUrl: config.url,
        verifiedAt,
        caFile: config.caFile,
        verification,
      }),
      verifiedAt,
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

  let timestampVerification: OpenSslResult;
  try {
    timestampVerification = await runner(verifyArgs);
  } catch (error) {
    throw new Error(`Timestamp authority response verification failed${opensslErrorDetail(error)}.`, { cause: error });
  }

  const tokenPath = path.join(input.tempDir, "timestamp-token.der");
  const signerPath = path.join(input.tempDir, "timestamp-signer.pem");
  const contentPath = path.join(input.tempDir, "timestamp-content.der");
  const certificatesPath = path.join(input.tempDir, "timestamp-certificates.pem");
  const untrustedPath = path.join(input.tempDir, "timestamp-untrusted.pem");
  try {
    await runner(["ts", "-reply", "-in", input.responsePath, "-token_out", "-out", tokenPath]);
    await runner(["cms", "-verify", "-inform", "DER", "-in", tokenPath, "-noverify", "-out", contentPath, "-signer", signerPath]);
    await runner(["pkcs7", "-inform", "DER", "-in", tokenPath, "-print_certs", "-out", certificatesPath]);
    const certificate = await runner(["x509", "-in", signerPath, "-noout", "-subject", "-fingerprint", "-sha256"]);
    const certificateChainPem = normalizePemBundle(await readFile(certificatesPath, "utf8"));
    const additionalUntrusted = input.untrustedCertFile ? await readFile(input.untrustedCertFile, "utf8") : "";
    await writeFile(untrustedPath, normalizePemBundle(`${certificateChainPem}\n${additionalUntrusted}`));
    const chainResult = await runner([
      "verify",
      "-show_chain",
      "-nameopt",
      "RFC2253",
      "-purpose",
      "timestampsign",
      "-CAfile",
      input.caFile,
      "-untrusted",
      untrustedPath,
      signerPath,
    ]);
    const caBundle = await readFile(input.caFile);
    const selectedChain = parseOpenSslCertificateChain(chainResult.stdout);
    const trustAnchorPem = findTrustAnchorPem(caBundle.toString("utf8"), selectedChain);
    const signer = parseTsaSignerCertificateText(certificate.stdout);
    return {
      ...signer,
      certificateChainPem,
      trustAnchorPem,
      timestampVerificationOutput: cleanVerificationOutput(timestampVerification),
      certificateChainVerificationOutput: cleanVerificationOutput(chainResult),
      selectedChain,
      embeddedCertificates: parsePemCertificates(certificateChainPem).map(certificateMetadata),
      trustAnchor: certificateMetadata(trustAnchorPem),
      caBundleSha256: sha256Hex(caBundle),
      caBundleBytes: caBundle.byteLength,
      opensslVersion: await readOpenSslVersion(runner),
      caPackage: await readCaPackageMetadata(),
      operatingSystem: await readOperatingSystemMetadata(),
    };
  } catch (error) {
    throw new Error(`Timestamp authority signer certificate inspection failed${opensslErrorDetail(error)}.`, { cause: error });
  }
}

type SelectedCertificate = {
  depth: number;
  subject: string;
  source: "timestamp-token" | "trust-store";
};

export function parseOpenSslCertificateChain(text: string): SelectedCertificate[] {
  const chain = text.split("\n").flatMap((line) => {
    const match = line.trim().match(/^depth=(\d+):\s*(.*?)(?:\s+\(untrusted\))?$/);
    if (!match) return [];
    return [{
      depth: Number(match[1]),
      subject: match[2].replace(/\s+\(untrusted\)$/, "").trim(),
      source: line.includes("(untrusted)") ? "timestamp-token" as const : "trust-store" as const,
    }];
  });
  if (!chain.length || !chain.some((entry) => entry.source === "trust-store")) {
    throw new Error("OpenSSL did not report a selected timestamp trust anchor.");
  }
  return chain.sort((left, right) => left.depth - right.depth);
}

export function findTrustAnchorPem(caBundlePem: string, selectedChain: SelectedCertificate[]) {
  const selectedAnchor = [...selectedChain].reverse().find((entry) => entry.source === "trust-store");
  if (!selectedAnchor) throw new Error("Timestamp trust anchor is missing from the selected certificate chain.");
  const candidates = parsePemCertificates(caBundlePem).filter((pem) => {
    const certificate = new X509Certificate(pem);
    return normalizeDistinguishedName(certificate.subject) === normalizeDistinguishedName(selectedAnchor.subject);
  });
  const selfSignedCandidates = candidates.filter((pem) => {
    const certificate = new X509Certificate(pem);
    return normalizeDistinguishedName(certificate.subject) === normalizeDistinguishedName(certificate.issuer);
  });
  const matches = selfSignedCandidates.length ? selfSignedCandidates : candidates;
  if (matches.length !== 1) {
    throw new Error(`Could not uniquely identify the selected timestamp trust anchor in the CA bundle (${matches.length} matches).`);
  }
  return `${matches[0].trim()}\n`;
}

function buildVerificationJson(input: {
  provider: string;
  tsaUrl: string;
  verifiedAt: string;
  caFile: string;
  verification: Awaited<ReturnType<typeof verifyTimestampResponseFiles>>;
}) {
  return `${JSON.stringify({
    schemaVersion: 1,
    verificationType: "novo.rfc3161.timestamp",
    result: "verified",
    provider: input.provider,
    tsaUrl: input.tsaUrl,
    verifiedAt: input.verifiedAt,
    timestampVerification: {
      command: "openssl ts -verify -queryfile request.tsq -in response.tsr -CAfile <system-ca-bundle>",
      output: input.verification.timestampVerificationOutput,
    },
    certificatePathVerification: {
      command: "openssl verify -show_chain -purpose timestampsign -CAfile <system-ca-bundle> -untrusted tsa-certificates.pem <tsa-signer-certificate>",
      output: input.verification.certificateChainVerificationOutput,
      selectedChain: input.verification.selectedChain,
    },
    tsaSigner: {
      subject: input.verification.tsaSubject,
      sha256Fingerprint: input.verification.tsaCertFingerprint,
    },
    embeddedCertificates: input.verification.embeddedCertificates,
    trustAnchor: {
      ...input.verification.trustAnchor,
      source: "system-ca-bundle",
    },
    trustStore: {
      path: input.caFile,
      sha256: `sha256:${input.verification.caBundleSha256}`,
      bytes: input.verification.caBundleBytes,
      package: input.verification.caPackage,
      operatingSystem: input.verification.operatingSystem,
    },
    openssl: input.verification.opensslVersion,
    certificateValidityCheckedAt: input.verifiedAt,
    revocationCheck: "not-performed",
  }, null, 2)}\n`;
}

function parsePemCertificates(value: string) {
  return value.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
}

function normalizePemBundle(value: string) {
  const certificates = parsePemCertificates(value);
  if (!certificates.length) throw new Error("Timestamp certificate bundle does not contain an X.509 certificate.");
  return `${certificates.map((certificate) => certificate.trim()).join("\n")}\n`;
}

function certificateMetadata(value: string) {
  const certificate = new X509Certificate(value);
  return {
    subject: certificate.subject,
    issuer: certificate.issuer,
    serialNumber: certificate.serialNumber,
    validFrom: certificate.validFrom,
    validTo: certificate.validTo,
    sha256Fingerprint: `sha256:${certificate.fingerprint256.replaceAll(":", "").toLowerCase()}`,
  };
}

function normalizeDistinguishedName(value: string) {
  const normalized = value.replace(/^subject\s*=\s*/i, "").trim();
  const components: string[] = [];
  let current = "";
  let escaped = false;
  let quoted = false;
  for (const character of normalized) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && (character === "," || character === "\n")) {
      if (current.trim()) components.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  if (current.trim()) components.push(current.trim());
  return components.map((component) => {
    const separator = component.indexOf("=");
    if (separator === -1) return component.replace(/\s+/g, " ").toLowerCase();
    const key = component.slice(0, separator).trim().toUpperCase();
    const valuePart = component.slice(separator + 1).trim().replace(/\s+/g, " ");
    return `${key}=${valuePart}`;
  }).sort().join("|");
}

function cleanVerificationOutput(result: OpenSslResult) {
  return [result.stdout, result.stderr]
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n")
    .replaceAll(/\/tmp\/novo-rfc3161-[^/\s]+\//g, "<temporary-directory>/");
}

function sha256Hex(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

async function readOpenSslVersion(runner: OpenSslRunner) {
  try {
    const result = await runner(["version", "-a"]);
    return cleanVerificationOutput(result);
  } catch {
    return "unknown";
  }
}

async function readCaPackageMetadata() {
  try {
    const result = await runCommand("dpkg-query", ["-W", "-f=${Version}", "ca-certificates"]);
    return { manager: "dpkg", name: "ca-certificates", version: result.stdout.trim() || "unknown" };
  } catch {
    try {
      const result = await runCommand("apk", ["info", "-v", "ca-certificates"]);
      return { manager: "apk", name: "ca-certificates", version: result.stdout.trim() || "unknown" };
    } catch {
      // Keep the verification usable on systems without a supported package manager.
      return { manager: "unknown", name: "ca-certificates", version: "unknown" };
    }
  }
}

async function readOperatingSystemMetadata() {
  try {
    const values: Record<string, string> = Object.fromEntries((await readFile("/etc/os-release", "utf8")).split("\n").flatMap((line) => {
      const separator = line.indexOf("=");
      if (separator === -1) return [];
      const key = line.slice(0, separator);
      const value = line.slice(separator + 1).replace(/^"|"$/g, "");
      return [[key, value]];
    }));
    return {
      id: values.ID ?? "unknown",
      versionId: values.VERSION_ID ?? "unknown",
      prettyName: values.PRETTY_NAME ?? "unknown",
    };
  } catch {
    return { id: "unknown", versionId: "unknown", prettyName: "unknown" };
  }
}

async function runCommand(command: string, args: string[]) {
  return execFileAsync(command, args, {
    timeout: opensslTimeoutMs,
    maxBuffer: opensslMaxBuffer,
    encoding: "utf8",
  });
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
