import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { strToU8, type Zippable, zipSync } from "fflate";
import { bodyToEditorDocument, bodyToEditorText } from "./editor";
import { uploadDir } from "./paths";
import type { Attachment, AuditEvent, Notebook, PageCommentThread, PageEntry } from "./types";

type RecordNotebook = Pick<Notebook, "id" | "name" | "color">;

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type RecordFileRole = "page" | "comments" | "audit-events" | "attachment-metadata" | "attachment";

type ManifestFile = {
  path: string;
  role: RecordFileRole;
  mediaType: string;
  bytes: number;
  sha256: string;
};

type RecordPackageFile = ManifestFile & {
  bytesValue: Uint8Array;
};

type PageRecordManifestPayload = {
  schemaVersion: 1;
  packageType: "novo.page.record";
  packageVersion: 1;
  hashAlgorithm: "sha256";
  recordHashMaterial: "canonical-json(manifest without recordHash)";
  page: {
    id: string;
    notebookId: string;
    title: string;
    updatedAt: string;
    attachmentCount: number;
    attachmentBytes: number;
  };
  files: ManifestFile[];
};

export type PageRecordManifest = PageRecordManifestPayload & {
  recordHash: string;
};

export type PageRecordPackage = {
  archive: Uint8Array;
  manifest: PageRecordManifest;
  recordHash: string;
};

const fixedZipMtime = new Date("1980-01-02T00:00:00.000Z");

export async function buildPageRecordPackage(
  page: PageEntry,
  notebook: RecordNotebook,
  options: {
    auditEvents?: AuditEvent[];
    commentThreads?: PageCommentThread[];
  } = {},
): Promise<PageRecordPackage> {
  const files: RecordPackageFile[] = [];

  addJsonFile(files, "record/page.json", "page", buildPageRecord(page, notebook));
  addBytesFile(files, "record/page.txt", "page", strToU8(`${bodyToEditorText(page.body).replace(/\r\n/g, "\n")}\n`), "text/plain; charset=utf-8");
  addJsonFile(files, "record/comments.json", "comments", sortCommentThreads(options.commentThreads ?? []));
  addJsonFile(files, "record/audit-events.json", "audit-events", sortAuditEvents(options.auditEvents ?? []));
  addAttachmentFiles(files, page.attachments);

  files.sort((left, right) => left.path.localeCompare(right.path));
  const manifestFiles = files.map(({ bytesValue: _bytesValue, ...file }) => file);
  const manifestPayload: PageRecordManifestPayload = {
    schemaVersion: 1,
    packageType: "novo.page.record",
    packageVersion: 1,
    hashAlgorithm: "sha256",
    recordHashMaterial: "canonical-json(manifest without recordHash)",
    page: {
      id: page.id,
      notebookId: page.notebookId,
      title: page.title,
      updatedAt: page.updatedAt,
      attachmentCount: page.attachments.length,
      attachmentBytes: page.attachments.reduce((total, attachment) => total + attachment.size, 0),
    },
    files: manifestFiles,
  };
  const recordHash = sha256Hex(canonicalJsonBytes(manifestPayload));
  const manifest: PageRecordManifest = { ...manifestPayload, recordHash };
  const zipEntries: Zippable = {};
  zipEntries["manifest.json"] = [canonicalJsonBytes(manifest), { level: 6, mtime: fixedZipMtime }];
  for (const file of files) {
    zipEntries[file.path] = [file.bytesValue, { level: 6, mtime: fixedZipMtime }];
  }

  return {
    archive: zipSync(zipEntries, { level: 6, mtime: fixedZipMtime }),
    manifest,
    recordHash,
  };
}

export function pageRecordPackageFilename(page: PageEntry) {
  const base = sanitizeFilename(page.title || "Untitled page").slice(0, 90) || "page";
  return `${base}.record.zip`;
}

export function stableJsonStringify(value: unknown) {
  return JSON.stringify(toCanonicalJson(value), null, 2);
}

export function sha256Hex(bytes: Uint8Array | Buffer | string) {
  return createHash("sha256").update(bytes).digest("hex");
}

function buildPageRecord(page: PageEntry, notebook: RecordNotebook) {
  return {
    schemaVersion: 1,
    notebook,
    page: {
      id: page.id,
      notebookId: page.notebookId,
      title: page.title,
      status: page.status,
      owner: {
        id: page.ownerId,
        firstName: page.ownerFirstName,
        lastName: page.ownerLastName,
      },
      locked: {
        at: page.lockedAt,
        by: page.lockedBy,
        byFirstName: page.lockedByFirstName,
        byLastName: page.lockedByLastName,
      },
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
      tags: [...page.tags].sort((left, right) => left.localeCompare(right)),
      body: {
        storageFormat: "novo-page-body",
        raw: page.body,
        editorDocument: bodyToEditorDocument(page.body),
        text: bodyToEditorText(page.body),
      },
      attachments: {
        count: page.attachments.length,
        bytes: page.attachments.reduce((total, attachment) => total + attachment.size, 0),
      },
    },
  };
}

function addAttachmentFiles(files: RecordPackageFile[], attachments: Attachment[]) {
  const metadata = attachments
    .slice()
    .sort(compareAttachments)
    .map((attachment) => {
      const filePath = path.join(uploadDir, attachment.storageKey);
      if (!existsSync(filePath)) throw new Error(`Attachment file is missing: ${attachment.originalName}`);
      const bytes = readFileSync(filePath);
      const archivePath = attachmentArchivePath(attachment);
      const sha256 = sha256Hex(bytes);
      addBytesFile(files, archivePath, "attachment", bytes, attachment.mimeType || "application/octet-stream", sha256);
      return {
        id: attachment.id,
        pageId: attachment.pageId,
        originalName: attachment.originalName,
        mimeType: attachment.mimeType,
        size: attachment.size,
        storageKey: attachment.storageKey,
        blockType: attachment.blockType,
        evernoteHash: attachment.evernoteHash,
        createdAt: attachment.createdAt,
        updatedAt: attachment.updatedAt,
        annotation: attachment.annotation ?? null,
        archivePath,
        sha256,
      };
    });

  addJsonFile(files, "record/attachments.json", "attachment-metadata", metadata);
}

function addJsonFile(files: RecordPackageFile[], filePath: string, role: RecordFileRole, value: unknown) {
  addBytesFile(files, filePath, role, canonicalJsonBytes(value), "application/json; charset=utf-8");
}

function addBytesFile(
  files: RecordPackageFile[],
  filePath: string,
  role: RecordFileRole,
  bytesValue: Uint8Array,
  mediaType: string,
  sha256 = sha256Hex(bytesValue),
) {
  files.push({
    path: filePath,
    role,
    mediaType,
    bytes: bytesValue.byteLength,
    sha256,
    bytesValue,
  });
}

function canonicalJsonBytes(value: unknown) {
  return strToU8(`${stableJsonStringify(value)}\n`);
}

function toCanonicalJson(value: unknown): JsonValue {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Cannot serialize non-finite number in record package.");
    return value;
  }
  if (Array.isArray(value)) return value.map(toCanonicalJson);
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter((entry) => entry[1] !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return Object.fromEntries(entries.map(([key, entryValue]) => [key, toCanonicalJson(entryValue)]));
  }
  throw new Error(`Cannot serialize ${typeof value} in record package.`);
}

function sortAuditEvents(events: AuditEvent[]) {
  return events.slice().sort((left, right) =>
    compareText(left.createdAt, right.createdAt)
    || compareText(left.updatedAt, right.updatedAt)
    || compareText(left.id, right.id)
  );
}

function sortCommentThreads(threads: PageCommentThread[]) {
  return threads
    .slice()
    .sort((left, right) =>
      compareText(left.createdAt, right.createdAt)
      || compareText(left.updatedAt, right.updatedAt)
      || compareText(left.id, right.id)
    )
    .map((thread) => ({
      ...thread,
      comments: thread.comments.slice().sort((left, right) =>
        compareText(left.createdAt, right.createdAt)
        || compareText(left.updatedAt, right.updatedAt)
        || compareText(left.id, right.id)
      ),
    }));
}

function compareAttachments(left: Attachment, right: Attachment) {
  return compareText(left.createdAt, right.createdAt) || compareText(left.id, right.id);
}

function compareText(left: string, right: string) {
  return left.localeCompare(right);
}

function attachmentArchivePath(attachment: Attachment) {
  const id = sanitizeFilename(attachment.id) || "attachment";
  const filename = sanitizeFilename(attachment.originalName) || "attachment";
  return `record/attachments/${id}/${filename}`;
}

function sanitizeFilename(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
}
