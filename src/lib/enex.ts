import crypto, { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import type { JSONContent } from "@tiptap/react";
import { attachmentPreviewText, inferAttachmentBlockType } from "./attachmentTypes";
import { editorDocumentToBody } from "./editor";
import { uploadDir } from "./paths";
import { createImportedAttachment, createImportedNotebook, createImportedPage, finishImportedNotebook } from "./store";
import type { Attachment } from "./types";

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
const enmlParser = new XMLParser({
  ignoreAttributes: false,
  preserveOrder: true,
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
      const blockType = inferAttachmentBlockType(resource.fileName, resource.mimeType);
      const attachment = createImportedAttachment({
        pageId,
        originalName: resource.fileName,
        mimeType: resource.mimeType,
        size: resource.data.length,
        storageKey,
        blockType,
        previewText: attachmentPreviewText(blockType, "evernote"),
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

  finishImportedNotebook(notebookId);
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
  return editorDocumentToBody(enmlToEditorDocument(enml, attachmentsByHash));
}

function enmlToEditorDocument(enml: string, attachmentsByHash: Map<string, Attachment>): JSONContent {
  try {
    const rootNodes = parseEnmlNodes(enml);
    const content = normalizeBlocks(nodesToBlocks(rootNodes, attachmentsByHash, []));
    return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
  } catch {
    const fallback = decodeXmlEntities(stripTags(cleanEnml(enml))).replace(/\s+/g, " ").trim();
    return { type: "doc", content: fallback ? [{ type: "paragraph", content: [{ type: "text", text: fallback }] }] : [{ type: "paragraph" }] };
  }
}

function parseEnmlNodes(enml: string): EnmlNode[] {
  const cleaned = cleanEnml(enml);
  const wrapped = /^<en-note\b/i.test(cleaned) ? cleaned : `<en-note>${cleaned}</en-note>`;
  const parsed = enmlParser.parse(wrapped) as EnmlNode[];
  const root = parsed.find((node) => getNodeTag(node) === "en-note");
  return root ? getNodeChildren(root) : parsed;
}

type EnmlNode = Record<string, unknown>;
type Mark = NonNullable<JSONContent["marks"]>[number];

function nodesToBlocks(nodes: EnmlNode[], attachmentsByHash: Map<string, Attachment>, marks: Mark[]): JSONContent[] {
  const blocks: JSONContent[] = [];
  let inline: JSONContent[] = [];
  const flushParagraph = () => {
    const content = normalizeInline(inline);
    if (content.length) blocks.push({ type: "paragraph", content });
    inline = [];
  };

  for (const node of nodes) {
    const tag = getNodeTag(node);
    if (tag === "#text" || tag === "__cdata") {
      appendText(inline, textValue(node[tag]), marks);
      continue;
    }
    if (tag === ":@") continue;
    const children = getNodeChildren(node);
    const attrs = getNodeAttrs(node);
    if (isInlineTag(tag)) {
      inline.push(...nodesToInline(children, attachmentsByHash, marksForTag(tag, attrs, marks)));
      continue;
    }
    if (tag === "br") {
      inline.push({ type: "hardBreak" });
      continue;
    }
    if (tag === "en-todo") {
      appendText(inline, attrs["@_checked"] === "true" ? "[x] " : "[ ] ", marks);
      continue;
    }
    if (tag === "en-media") {
      flushParagraph();
      const attachment = attachmentForMedia(attrs, attachmentsByHash);
      if (attachment) blocks.push(attachmentNode(attachment));
      continue;
    }
    if (tag === "p" || tag === "div") {
      flushParagraph();
      if (hasBlockChildren(children)) {
        blocks.push(...nodesToBlocks(children, attachmentsByHash, marks));
        continue;
      }
      const content = normalizeInline(nodesToInline(children, attachmentsByHash, marks));
      if (content.length) blocks.push({ type: "paragraph", content });
      continue;
    }
    if (/^h[1-6]$/.test(tag)) {
      flushParagraph();
      const content = normalizeInline(nodesToInline(children, attachmentsByHash, marks));
      if (content.length) blocks.push({ type: "heading", attrs: { level: Number(tag.slice(1)) }, content });
      continue;
    }
    if (tag === "blockquote") {
      flushParagraph();
      const content = normalizeBlocks(nodesToBlocks(children, attachmentsByHash, marks));
      if (content.length) blocks.push({ type: "blockquote", content: ensureParagraphBlocks(content) });
      continue;
    }
    if (tag === "ul" || tag === "ol") {
      flushParagraph();
      const items = children.filter((child) => getNodeTag(child) === "li").map((child) => listItemNode(getNodeChildren(child), attachmentsByHash, marks));
      if (items.length) blocks.push({ type: tag === "ul" ? "bulletList" : "orderedList", content: items });
      continue;
    }
    if (tag === "table") {
      flushParagraph();
      const table = tableNode(children, attachmentsByHash, marks);
      if (table) blocks.push(table);
      continue;
    }
    inline.push(...nodesToInline(children, attachmentsByHash, marks));
  }

  flushParagraph();
  return blocks;
}

function nodesToInline(nodes: EnmlNode[], attachmentsByHash: Map<string, Attachment>, marks: Mark[]): JSONContent[] {
  const inline: JSONContent[] = [];
  for (const node of nodes) {
    const tag = getNodeTag(node);
    if (tag === "#text" || tag === "__cdata") {
      appendText(inline, textValue(node[tag]), marks);
      continue;
    }
    if (tag === ":@") continue;
    const attrs = getNodeAttrs(node);
    const children = getNodeChildren(node);
    if (isInlineTag(tag)) {
      inline.push(...nodesToInline(children, attachmentsByHash, marksForTag(tag, attrs, marks)));
      continue;
    }
    if (tag === "br") {
      inline.push({ type: "hardBreak" });
      continue;
    }
    if (tag === "en-todo") {
      appendText(inline, attrs["@_checked"] === "true" ? "[x] " : "[ ] ", marks);
      continue;
    }
    if (tag === "en-media") {
      const attachment = attachmentForMedia(attrs, attachmentsByHash);
      if (attachment) appendText(inline, `[${attachment.originalName}]`, marks);
      continue;
    }
    const childInline = nodesToInline(children, attachmentsByHash, marks);
    if (childInline.length) {
      if (inline.length) inline.push({ type: "hardBreak" });
      inline.push(...childInline);
    }
  }
  return normalizeInline(inline);
}

function listItemNode(nodes: EnmlNode[], attachmentsByHash: Map<string, Attachment>, marks: Mark[]): JSONContent {
  const content = normalizeBlocks(nodesToBlocks(nodes, attachmentsByHash, marks));
  return { type: "listItem", content: content.length ? ensureParagraphBlocks(content) : [{ type: "paragraph" }] };
}

function tableNode(nodes: EnmlNode[], attachmentsByHash: Map<string, Attachment>, marks: Mark[]): JSONContent | null {
  const rows = collectRows(nodes);
  const content: JSONContent[] = rows.map((row): JSONContent | null => {
    const cells = getNodeChildren(row)
      .filter((cell) => ["td", "th"].includes(getNodeTag(cell)))
      .map((cell) => tableCellNode(cell, attachmentsByHash, marks));
    return cells.length ? { type: "tableRow", content: cells } : null;
  }).filter((row): row is JSONContent => row !== null);
  return content.length ? { type: "table", content } : null;
}

function tableCellNode(node: EnmlNode, attachmentsByHash: Map<string, Attachment>, marks: Mark[]): JSONContent {
  const tag = getNodeTag(node);
  const attrs = getNodeAttrs(node);
  const content = normalizeBlocks(nodesToBlocks(getNodeChildren(node), attachmentsByHash, marks));
  return {
    type: tag === "th" ? "tableHeader" : "tableCell",
    attrs: {
      colspan: positiveInteger(attrs["@_colspan"], 1),
      rowspan: positiveInteger(attrs["@_rowspan"], 1),
      colwidth: null,
    },
    content: content.length ? ensureParagraphBlocks(content) : [{ type: "paragraph" }],
  };
}

function collectRows(nodes: EnmlNode[]): EnmlNode[] {
  const rows: EnmlNode[] = [];
  for (const node of nodes) {
    const tag = getNodeTag(node);
    if (tag === "tr") rows.push(node);
    else if (["thead", "tbody", "tfoot"].includes(tag)) rows.push(...collectRows(getNodeChildren(node)));
  }
  return rows;
}

function appendText(content: JSONContent[], rawText: string, marks: Mark[]) {
  const text = decodeXmlEntities(rawText).replace(/[ \t\r\n\f]+/g, " ");
  if (!text.trim()) {
    if (content.length && !inlineEndsWithSpace(content)) content.push({ type: "text", text: " " });
    return;
  }
  const node: JSONContent = { type: "text", text };
  if (marks.length) node.marks = marks;
  content.push(node);
}

function marksForTag(tag: string, attrs: Record<string, string>, marks: Mark[]): Mark[] {
  const next = [...marks];
  const style = attrs["@_style"] || "";
  if (tag === "b" || tag === "strong" || /font-weight\s*:\s*(bold|[6-9]00)/i.test(style)) next.push({ type: "bold" });
  if (tag === "i" || tag === "em" || /font-style\s*:\s*italic/i.test(style)) next.push({ type: "italic" });
  if (tag === "u" || /text-decoration[^;]*underline/i.test(style)) next.push({ type: "underline" });
  if (tag === "s" || tag === "strike" || tag === "del" || /text-decoration[^;]*(line-through|strike)/i.test(style)) next.push({ type: "strike" });
  if (tag === "code") next.push({ type: "code" });
  if (tag === "a" && attrs["@_href"]) next.push({ type: "link", attrs: { href: attrs["@_href"] } });
  return dedupeMarks(next);
}

function dedupeMarks(marks: Mark[]) {
  const seen = new Set<string>();
  return marks.filter((mark) => {
    const key = `${mark.type}:${JSON.stringify(mark.attrs ?? {})}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeBlocks(blocks: JSONContent[]) {
  return blocks.filter((block) => block.type === "attachmentCard" || block.type === "table" || block.type === "bulletList" || block.type === "orderedList" || block.type === "blockquote" || block.content?.length);
}

function ensureParagraphBlocks(blocks: JSONContent[]) {
  return blocks.map((block) => block.type === "attachmentCard" ? { type: "paragraph", content: [{ type: "text", text: String(block.attrs?.filename ?? "attachment") }] } : block);
}

function normalizeInline(content: JSONContent[]) {
  const normalized = content.filter((node) => node.type !== "text" || Boolean(node.text));
  trimInlineEdge(normalized, "start");
  trimInlineEdge(normalized, "end");
  return normalized.filter((node) => node.type !== "text" || Boolean(node.text));
}

function trimInlineEdge(content: JSONContent[], edge: "start" | "end") {
  const index = edge === "start" ? content.findIndex((node) => node.type === "text") : findLastIndex(content, (node) => node.type === "text");
  if (index === -1) return;
  const text = content[index].text ?? "";
  content[index] = { ...content[index], text: edge === "start" ? text.replace(/^ +/, "") : text.replace(/ +$/, "") };
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean) {
  for (let index = items.length - 1; index >= 0; index -= 1) if (predicate(items[index])) return index;
  return -1;
}

function inlineEndsWithSpace(content: JSONContent[]) {
  const lastText = [...content].reverse().find((node) => node.type === "text");
  return Boolean(lastText?.text?.endsWith(" "));
}

function attachmentForMedia(attrs: Record<string, string>, attachmentsByHash: Map<string, Attachment>) {
  const hash = attrs["@_hash"] || attrs.hash;
  return hash ? attachmentsByHash.get(hash.toLowerCase()) : undefined;
}

function getNodeTag(node: EnmlNode) {
  return Object.keys(node).find((key) => key !== ":@") ?? "";
}

function getNodeChildren(node: EnmlNode): EnmlNode[] {
  const tag = getNodeTag(node);
  const value = node[tag];
  return Array.isArray(value) ? value as EnmlNode[] : [];
}

function getNodeAttrs(node: EnmlNode): Record<string, string> {
  return (node[":@"] ?? {}) as Record<string, string>;
}

function isInlineTag(tag: string) {
  return ["a", "b", "strong", "i", "em", "u", "s", "strike", "del", "code", "span", "font"].includes(tag);
}

function hasBlockChildren(nodes: EnmlNode[]) {
  return nodes.some((node) => isBlockTag(getNodeTag(node)));
}

function isBlockTag(tag: string) {
  return tag === "en-media" || tag === "table" || tag === "ul" || tag === "ol" || tag === "blockquote" || tag === "div" || tag === "p" || /^h[1-6]$/.test(tag);
}

function positiveInteger(value: unknown, fallback: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function cleanEnml(enml: string) {
  return unwrapCdata(enml).replace(/<\?xml[^>]*>/gi, "").replace(/<!DOCTYPE[^>]*>/gi, "").trim();
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
