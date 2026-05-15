import crypto, { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import type { JSONContent } from "@tiptap/react";
import { editorDocumentToBody } from "./editor";
import { uploadDir } from "./paths";
import { createImportedAttachment, createImportedNotebook, createImportedPage, finishImportedNotebook } from "./store";
import type { Attachment, BlockType } from "./types";

export type ParsedEnexResource = {
  hash: string;
  fileName: string;
  mimeType: string;
  data: Buffer;
};

export type ParsedEnexNote = {
  title: string;
  body: string;
  tags: string[];
  createdAt?: string;
  updatedAt?: string;
  resources: ParsedEnexResource[];
  mediaCount: number;
};

export type EnexInspection = {
  path: string;
  fileName: string;
  suggestedNotebookName: string;
  sizeBytes: number;
  noteCount: number;
  resourceCount: number;
  inlineMediaCount: number;
  notesWithResources: number;
  tags: Array<{ tag: string; count: number }>;
  mimeTypes: Array<{ mimeType: string; count: number }>;
  firstTitles: string[];
  lastTitles: string[];
  elapsedMs: number;
};

export type EnexImportProgress = {
  processedBytes: number;
  totalBytes: number;
  importedNotes: number;
  totalNotes: number | null;
  importedResources: number;
  totalResources: number | null;
};

export type EnexImportResult = {
  notebookId: string;
  importedNotes: number;
  importedResources: number;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: false,
  cdataPropName: "__cdata",
  textNodeName: "#text",
});

export function parseEnex(xml: string): ParsedEnexNote[] {
  const parsed = parser.parse(xml) as { "en-export"?: { note?: unknown } };
  const notes = toArray(parsed["en-export"]?.note);
  return notes.map(parseRawNote);
}

export async function inspectEnexFile(filePath: string): Promise<EnexInspection> {
  const startedAt = Date.now();
  const absolutePath = normalizeServerPath(filePath);
  const stats = await fsp.stat(absolutePath);
  if (!stats.isFile()) throw new Error("ENEX path must point to a file.");

  const summary = await scanEnexInspectionSummary(absolutePath);

  return {
    path: absolutePath,
    fileName: path.basename(absolutePath),
    suggestedNotebookName: notebookNameFromPath(absolutePath),
    sizeBytes: stats.size,
    noteCount: summary.noteCount,
    resourceCount: summary.resourceCount,
    inlineMediaCount: summary.inlineMediaCount,
    notesWithResources: summary.notesWithResources,
    tags: topCounts(summary.tagCounts, "tag"),
    mimeTypes: topCounts(summary.mimeCounts, "mimeType"),
    firstTitles: summary.firstTitles,
    lastTitles: summary.lastTitles,
    elapsedMs: Date.now() - startedAt,
  };
}

export async function importEnexFile(input: {
  userId: string;
  projectId: string;
  notebookName: string;
  filePath: string;
  totalNotes?: number | null;
  onProgress?: (progress: EnexImportProgress) => void;
}): Promise<EnexImportResult> {
  const absolutePath = normalizeServerPath(input.filePath);
  const stats = await fsp.stat(absolutePath);
  if (!stats.isFile()) throw new Error("ENEX path must point to a file.");

  const notebookId = createImportedNotebook({
    userId: input.userId,
    projectId: input.projectId,
    name: input.notebookName.trim() || notebookNameFromPath(absolutePath),
  });

  let importedNotes = 0;
  let importedResources = 0;

  await streamEnexNotes(absolutePath, async (noteXml, processedBytes) => {
    const note = parseNoteXml(noteXml);
    const pageId = createImportedPage({
      userId: input.userId,
      notebookId,
      title: note.title,
      body: "",
      tags: [],
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    });

    const attachmentsByHash = new Map<string, Attachment>();
    for (const resource of note.resources) {
      const storageKey = await writeImportedResource(pageId, resource);
      const attachment = createImportedAttachment({
        pageId,
        originalName: resource.fileName,
        mimeType: resource.mimeType,
        size: resource.data.length,
        storageKey,
        blockType: inferBlockType(resource.fileName, resource.mimeType),
        previewText: previewFor(resource.fileName, resource.mimeType),
        createdAt: note.createdAt,
      });
      attachmentsByHash.set(resource.hash, attachment);
      importedResources += 1;
      input.onProgress?.({
        processedBytes,
        totalBytes: stats.size,
        importedNotes,
        totalNotes: input.totalNotes ?? null,
        importedResources,
        totalResources: null,
      });
    }

    const body = enmlToEditorBody(note.body, attachmentsByHash);
    createImportedPage({
      userId: input.userId,
      notebookId,
      pageId,
      title: note.title,
      body,
      tags: note.tags,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      replaceExisting: true,
    });

    importedNotes += 1;
    input.onProgress?.({
      processedBytes,
      totalBytes: stats.size,
      importedNotes,
      totalNotes: input.totalNotes ?? null,
      importedResources,
      totalResources: null,
    });
  });

  finishImportedNotebook(input.projectId, notebookId);
  return { notebookId, importedNotes, importedResources };
}

function parseNoteXml(noteXml: string): ParsedEnexNote {
  const parsed = parser.parse(noteXml) as { note?: unknown };
  return parseRawNote(parsed.note);
}


function parseRawNote(rawNote: unknown): ParsedEnexNote {
  const note = rawNote as Record<string, unknown>;
  const content = textValue(note.content);
  const resources = toArray(note.resource).map(parseResource).filter((resource): resource is ParsedEnexResource => Boolean(resource));
  return {
    title: textValue(note.title) || "Untitled Evernote note",
    body: content,
    tags: toArray(note.tag).map(textValue).map((tag) => tag.trim()).filter(Boolean),
    createdAt: normalizeEvernoteDate(textValue(note.created)),
    updatedAt: normalizeEvernoteDate(textValue(note.updated)),
    resources,
    mediaCount: countInlineMedia(content),
  };
}

function parseResource(rawResource: unknown): ParsedEnexResource | null {
  const resource = rawResource as Record<string, unknown>;
  const dataText = textValue(resource.data).replace(/\s+/g, "");
  if (!dataText) return null;
  const data = Buffer.from(dataText, "base64");
  const attributes = (resource["resource-attributes"] ?? {}) as Record<string, unknown>;
  const mimeType = textValue(resource.mime) || "application/octet-stream";
  const fileName = sanitizeFileName(textValue(attributes["file-name"]) || `evernote-resource-${randomUUID()}${extensionForMime(mimeType)}`);
  return {
    hash: crypto.createHash("md5").update(data).digest("hex"),
    fileName,
    mimeType,
    data,
  };
}

function enmlToEditorBody(enml: string, attachmentsByHash: Map<string, Attachment>) {
  const cleaned = unwrapCdata(enml)
    .replace(/<\?xml[^>]*>/gi, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<\/?en-note[^>]*>/gi, "");
  const content: JSONContent[] = [];
  let paragraphParts: JSONContent[] = [];
  const tokenPattern = /<en-media\b[^>]*>|<br\s*\/?>|<\/(?:div|p|li|h[1-6])>/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(cleaned))) {
    pushText(cleaned.slice(cursor, match.index));
    const token = match[0];
    if (/^<en-media/i.test(token)) {
      flushParagraph();
      const hash = attrValue(token, "hash");
      const attachment = hash ? attachmentsByHash.get(hash.toLowerCase()) : undefined;
      if (attachment) content.push(attachmentNode(attachment));
    } else {
      paragraphParts.push({ type: "hardBreak" });
      flushParagraph();
    }
    cursor = match.index + token.length;
  }

  pushText(cleaned.slice(cursor));
  flushParagraph();

  return editorDocumentToBody({
    type: "doc",
    content: content.length ? content : [{ type: "paragraph" }],
  });

  function pushText(rawText: string) {
    const text = decodeXmlEntities(stripTags(rawText)).replace(/\s+/g, " ").trim();
    if (!text) return;
    paragraphParts.push({ type: "text", text });
  }

  function flushParagraph() {
    const compactParts = paragraphParts.filter((part, index, parts) => {
      if (part.type !== "hardBreak") return true;
      return index > 0 && index < parts.length - 1;
    });
    if (compactParts.length) content.push({ type: "paragraph", content: compactParts });
    paragraphParts = [];
  }
}

function attachmentNode(attachment: Attachment): JSONContent {
  return {
    type: "attachmentCard",
    attrs: {
      attachmentId: attachment.id,
      kind: attachment.blockType,
      filename: attachment.originalName,
      mimeType: attachment.mimeType,
      size: attachment.size,
      createdAt: attachment.createdAt,
      updatedAt: attachment.updatedAt,
    },
  };
}

async function scanEnexInspectionSummary(filePath: string) {
  const tagCounts = new Map<string, number>();
  const mimeCounts = new Map<string, number>();
  const firstTitles: string[] = [];
  const lastTitles: string[] = [];
  let noteCount = 0;
  let resourceCount = 0;
  let inlineMediaCount = 0;
  let notesWithResources = 0;
  let currentNoteResources = 0;
  let carry = "";
  const carrySize = 128 * 1024;
  const stream = fs.createReadStream(filePath, { encoding: "utf8", highWaterMark: 1024 * 1024 });

  for await (const chunk of stream) {
    const combined = carry + String(chunk);
    const scanEnd = Math.max(0, combined.length - carrySize);
    const segment = combined.slice(0, scanEnd);
    carry = combined.slice(scanEnd);
    scanInspectionSegment(segment);
  }
  scanInspectionSegment(carry);

  return { noteCount, resourceCount, inlineMediaCount, notesWithResources, tagCounts, mimeCounts, firstTitles, lastTitles };

  function scanInspectionSegment(segment: string) {
    inlineMediaCount += countMatches(segment, /<en-media\b/gi);

    const structuralPattern = /<note>|<\/note>|<resource(?:\s|>)/gi;
    let structuralMatch: RegExpExecArray | null;
    while ((structuralMatch = structuralPattern.exec(segment))) {
      const token = structuralMatch[0].toLowerCase();
      if (token === "<note>") {
        noteCount += 1;
        currentNoteResources = 0;
        continue;
      }
      if (token === "</note>") {
        if (currentNoteResources > 0) notesWithResources += 1;
        currentNoteResources = 0;
        continue;
      }
      resourceCount += 1;
      currentNoteResources += 1;
    }

    for (const title of allTagText(segment, "title").map(decodeXmlEntities).filter(Boolean)) {
      if (firstTitles.length < 8) firstTitles.push(title);
      lastTitles.push(title);
      if (lastTitles.length > 8) lastTitles.shift();
    }
    for (const tag of allTagText(segment, "tag").map((value) => decodeXmlEntities(value).trim()).filter(Boolean)) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
    for (const mimeType of allTagText(segment, "mime").map((value) => decodeXmlEntities(value).trim() || "application/octet-stream")) {
      mimeCounts.set(mimeType, (mimeCounts.get(mimeType) ?? 0) + 1);
    }
  }
}

async function streamEnexNotes(filePath: string, onNote: (noteXml: string, processedBytes: number) => void | Promise<void>) {
  const stream = fs.createReadStream(filePath, { encoding: "utf8", highWaterMark: 1024 * 1024 });
  let buffer = "";
  let processedBytes = 0;

  for await (const chunk of stream) {
    const text = String(chunk);
    processedBytes += Buffer.byteLength(text);
    buffer += text;
    while (true) {
      const start = buffer.indexOf("<note>");
      if (start === -1) {
        buffer = buffer.slice(Math.max(0, buffer.length - 32));
        break;
      }
      const end = buffer.indexOf("</note>", start);
      if (end === -1) {
        buffer = buffer.slice(start);
        break;
      }
      const noteXml = buffer.slice(start, end + "</note>".length);
      buffer = buffer.slice(end + "</note>".length);
      await onNote(noteXml, processedBytes - Buffer.byteLength(buffer));
    }
  }
}

async function writeImportedResource(pageId: string, resource: ParsedEnexResource) {
  const storageKey = path.join(pageId, `${randomUUID()}-${resource.fileName}`);
  const absolutePath = path.join(uploadDir, storageKey);
  await fsp.mkdir(path.dirname(absolutePath), { recursive: true });
  await fsp.writeFile(absolutePath, resource.data);
  return storageKey;
}

function notebookNameFromPath(filePath: string) {
  return path.basename(filePath).replace(/\.enex$/i, "") || "Evernote Import";
}

function normalizeServerPath(filePath: string) {
  const trimmed = filePath.trim();
  if (!path.isAbsolute(trimmed)) throw new Error("Use an absolute server path.");
  if (!/\.enex$/i.test(trimmed)) throw new Error("Path must point to an .enex file.");
  return trimmed;
}

function countInlineMedia(enml: string) {
  return unwrapCdata(enml).match(/<en-media\b/gi)?.length ?? 0;
}

function unwrapCdata(value: string) {
  return value.replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "");
}

function attrValue(tag: string, name: string) {
  const match = tag.match(new RegExp(`${name}=["']([^"']+)["']`, "i"));
  return match?.[1] ?? "";
}

function stripTags(value: string) {
  return value.replace(/<[^>]+>/g, "");
}

function allTagText(xml: string, tag: string) {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const values: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml))) values.push(stripTags(match[1] ?? "").trim());
  return values;
}

function countMatches(value: string, pattern: RegExp) {
  return value.match(pattern)?.length ?? 0;
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function normalizeEvernoteDate(value: string) {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return undefined;
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.000Z`;
}

function inferBlockType(name: string, mimeType: string): BlockType {
  const lower = name.toLowerCase();
  if (mimeType.startsWith("image/") || /\.(png|jpe?g|gif|tiff?|webp)$/.test(lower)) return "image";
  if (/\.(xlsx?|csv|tsv)$/.test(lower)) return "sheet";
  if (/\.pdf$/.test(lower)) return "pdf";
  if (/\.(pptx?|key)$/.test(lower)) return "slides";
  if (/\.(gb|gbk|fasta|fa|dna|seq)$/.test(lower)) return "sequence";
  return "file";
}

function previewFor(name: string, mimeType: string) {
  const type = inferBlockType(name, mimeType);
  const labels: Record<BlockType, string> = {
    image: "Image imported inline from Evernote.",
    sheet: "Spreadsheet imported from Evernote.",
    pdf: "PDF imported from Evernote.",
    slides: "Slide deck imported from Evernote.",
    sequence: "Sequence file imported from Evernote.",
    file: "File imported from Evernote.",
  };
  return labels[type];
}

function extensionForMime(mimeType: string) {
  if (mimeType === "application/pdf") return ".pdf";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/tiff") return ".tif";
  if (mimeType.includes("spreadsheet")) return ".xlsx";
  if (mimeType.includes("presentation")) return ".pptx";
  if (mimeType === "text/plain") return ".txt";
  return ".bin";
}

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "attachment.bin";
}

function topCounts<K extends "tag" | "mimeType">(counts: Map<string, number>, key: K): Array<Record<K, string> & { count: number }> {
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 20)
    .map(([value, count]) => ({ [key]: value, count }) as Record<K, string> & { count: number });
}

function toArray(value: unknown): unknown[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("__cdata" in record) return textValue(record.__cdata);
    if ("#text" in record) return textValue(record["#text"]);
  }
  return "";
}
