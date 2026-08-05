import { strToU8, type Zippable, zipSync } from "fflate";
import { sha256Hex, stableJsonStringify } from "./pageRecordPackage";
import type { PageSignature, PageSignatureTimestamp } from "./types";

type FinalizationPackageFile = {
  path: string;
  role: "record-package" | "proof-package" | "signature-payload" | "record-manifest" | "timestamp-request" | "timestamp-response" | "readme";
  mediaType: string;
  bytes: number;
  sha256: string;
};

type FinalizationPackageFileEntry = FinalizationPackageFile & {
  bytesValue: Uint8Array;
};

type PageFinalizationPackageManifestPayload = {
  schemaVersion: 1;
  packageType: "novo.page.finalization";
  packageVersion: 1;
  hashAlgorithm: "sha256";
  finalizationHashMaterial: "canonical-json(manifest without finalizationHash)";
  createdAt: string;
  page: {
    id: string;
    notebookId: string;
  };
  signature: {
    id: string;
    signerUserId: string;
    signerEmail: string;
    signerFirstName: string;
    signerLastName: string;
    signingKeyId: string;
    signingPublicKeyFingerprint: string;
    recordHashAlgorithm: string;
    recordHash: string;
    proofHashAlgorithm: string;
    proofHash: string;
    createdAt: string;
  };
  timestamps: Array<{
    id: string;
    provider: string;
    tsaUrl: string;
    hashAlgorithm: string;
    messageImprint: string;
    status: string;
    policyOid: string;
    serialNumber: string;
    tsaTime: string;
    createdAt: string;
  }>;
  files: FinalizationPackageFile[];
};

export type PageFinalizationPackageManifest = PageFinalizationPackageManifestPayload & {
  finalizationHash: string;
};

export type PageFinalizationPackage = {
  archive: Uint8Array;
  manifest: PageFinalizationPackageManifest;
  finalizationHash: string;
};

const fixedZipMtime = new Date("1980-01-01T00:00:00.000Z");

export function buildPageFinalizationPackage(input: {
  signature: PageSignature;
  recordArchive: Uint8Array;
  createdAt?: string;
}): PageFinalizationPackage {
  if (!input.signature.timestamps.length) throw new Error("Page finalization timestamp is missing.");

  const createdAt = input.createdAt ?? new Date().toISOString();
  const files: FinalizationPackageFileEntry[] = [];
  addBytesFile(files, "record.zip", "record-package", input.recordArchive, "application/zip");
  addTextFile(files, "proof/proof-package.json", "proof-package", input.signature.proofPackageJson);
  addTextFile(files, "proof/signature-payload.json", "signature-payload", input.signature.signaturePayload);
  addTextFile(files, "proof/record-manifest.json", "record-manifest", input.signature.recordManifestJson);
  for (const timestamp of input.signature.timestamps) {
    addTimestampFiles(files, timestamp);
  }
  addTextFile(files, "README.txt", "readme", finalizationReadme(input.signature));

  files.sort((left, right) => left.path.localeCompare(right.path));
  const manifestFiles = files.map((file) => ({
    path: file.path,
    role: file.role,
    mediaType: file.mediaType,
    bytes: file.bytes,
    sha256: file.sha256,
  }));
  const manifestPayload: PageFinalizationPackageManifestPayload = {
    schemaVersion: 1,
    packageType: "novo.page.finalization",
    packageVersion: 1,
    hashAlgorithm: "sha256",
    finalizationHashMaterial: "canonical-json(manifest without finalizationHash)",
    createdAt,
    page: {
      id: input.signature.pageId,
      notebookId: input.signature.notebookId,
    },
    signature: {
      id: input.signature.id,
      signerUserId: input.signature.signerUserId,
      signerEmail: input.signature.signerEmail,
      signerFirstName: input.signature.signerFirstName,
      signerLastName: input.signature.signerLastName,
      signingKeyId: input.signature.signingKeyId,
      signingPublicKeyFingerprint: input.signature.signingPublicKeyFingerprint,
      recordHashAlgorithm: input.signature.recordHashAlgorithm,
      recordHash: input.signature.recordHash,
      proofHashAlgorithm: input.signature.proofHashAlgorithm,
      proofHash: input.signature.proofHash,
      createdAt: input.signature.createdAt,
    },
    timestamps: input.signature.timestamps.map((timestamp) => ({
      id: timestamp.id,
      provider: timestamp.provider,
      tsaUrl: timestamp.tsaUrl,
      hashAlgorithm: timestamp.hashAlgorithm,
      messageImprint: timestamp.messageImprint,
      status: timestamp.status,
      policyOid: timestamp.policyOid,
      serialNumber: timestamp.serialNumber,
      tsaTime: timestamp.tsaTime,
      createdAt: timestamp.createdAt,
    })),
    files: manifestFiles,
  };
  const finalizationHash = sha256Hex(canonicalJsonBytes(manifestPayload));
  const manifest: PageFinalizationPackageManifest = { ...manifestPayload, finalizationHash };
  const zipEntries: Zippable = {};
  zipEntries["manifest.json"] = [canonicalJsonBytes(manifest), { level: 6, mtime: fixedZipMtime }];
  for (const file of files) {
    zipEntries[file.path] = [file.bytesValue, { level: 6, mtime: fixedZipMtime }];
  }

  return {
    archive: zipSync(zipEntries, { level: 6, mtime: fixedZipMtime }),
    manifest,
    finalizationHash,
  };
}

function addTimestampFiles(files: FinalizationPackageFileEntry[], timestamp: PageSignatureTimestamp) {
  const directory = `timestamps/${timestamp.id}`;
  addBytesFile(files, `${directory}/request.tsq`, "timestamp-request", Buffer.from(timestamp.requestDerBase64, "base64"), "application/timestamp-query");
  addBytesFile(files, `${directory}/response.tsr`, "timestamp-response", Buffer.from(timestamp.responseDerBase64, "base64"), "application/timestamp-reply");
}

function addTextFile(files: FinalizationPackageFileEntry[], filePath: string, role: FinalizationPackageFile["role"], value: string) {
  addBytesFile(files, filePath, role, strToU8(value.endsWith("\n") ? value : `${value}\n`), "text/plain; charset=utf-8");
}

function addBytesFile(
  files: FinalizationPackageFileEntry[],
  filePath: string,
  role: FinalizationPackageFile["role"],
  bytesValue: Uint8Array,
  mediaType: string,
) {
  files.push({
    path: filePath,
    role,
    mediaType,
    bytes: bytesValue.byteLength,
    sha256: sha256Hex(bytesValue),
    bytesValue,
  });
}

function canonicalJsonBytes(value: unknown) {
  return strToU8(`${stableJsonStringify(value)}\n`);
}

function finalizationReadme(signature: PageSignature) {
  const timestamp = signature.timestamps[0];
  return [
    "Novo page finalization package",
    "",
    "This archive contains the record package and proof files for a finalized Novo page.",
    "",
    `Signature ID: ${signature.id}`,
    `Record hash (${signature.recordHashAlgorithm}): ${signature.recordHash}`,
    `Proof hash (${signature.proofHashAlgorithm}): ${signature.proofHash}`,
    timestamp ? `Timestamp: ${timestamp.provider}, ${timestamp.tsaTime || timestamp.createdAt}` : "",
    "",
    "record.zip is the page snapshot being proved.",
    "proof/proof-package.json contains the user signature and proof hash.",
    "timestamps/*/response.tsr contains the RFC3161 timestamp token from the timestamp authority.",
  ].filter(Boolean).join("\n");
}
