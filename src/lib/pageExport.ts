import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { JSONContent } from "@tiptap/react";
import { strToU8, zipSync } from "fflate";
import sharp from "sharp";
import { bodyToEditorDocument, bodyToEditorText } from "./editor";
import { uploadDir } from "./paths";
import type { Attachment, Notebook, PageEntry } from "./types";

type ExportNotebook = Pick<Notebook, "id" | "name" | "color">;

type RenderContext = {
  attachmentMap: Map<string, Attachment>;
  archiveAttachmentNames?: Map<string, string>;
  imageSizes: Map<string, { width: number; height: number }>;
};

export function pageExportFilename(page: PageEntry, extension: "pdf" | "zip") {
  const base = sanitizeFilename(page.title || "Untitled page").slice(0, 90) || "page";
  return `${base}.${extension}`;
}

export async function buildPageExportHtml(page: PageEntry, notebook: ExportNotebook, options: { archiveAttachmentNames?: Map<string, string> } = {}) {
  const document = bodyToEditorDocument(page.body);
  const attachmentMap = new Map(page.attachments.map((attachment) => [attachment.id, attachment]));
  const context: RenderContext = {
    attachmentMap,
    archiveAttachmentNames: options.archiveAttachmentNames,
    imageSizes: await readImageSizes(page.attachments),
  };
  const exportedAt = new Date().toISOString();

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(page.title || "Untitled page")}</title>
  <style>
    @page { size: Letter; margin: 0.65in; }
    * { box-sizing: border-box; }
    body { color: #0f172a; font-family: Arial, Helvetica, sans-serif; font-size: 11pt; line-height: 1.45; margin: 0; overflow-wrap: anywhere; }
    header { border-bottom: 1px solid #cbd5e1; margin-bottom: 22px; padding-bottom: 14px; }
    h1 { font-size: 22pt; line-height: 1.15; margin: 0 0 10px; }
    .meta { color: #475569; display: grid; gap: 4px; font-size: 9.5pt; }
    .meta-row { display: grid; grid-template-columns: 82px minmax(0, 1fr); gap: 10px; }
    .meta-label { color: #64748b; }
    .tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
    .tag, .status { border: 1px solid #cbd5e1; border-radius: 3px; color: #334155; display: inline-block; font-size: 9pt; padding: 2px 6px; }
    .content p, .content h1, .content h2, .content h3, .content ul, .content ol { margin: 0; }
    .content > * + * { margin-top: 0.25rem; }
    .content > h1 + *, .content > h2 + *, .content > h3 + * { margin-top: 0.4rem; }
    .content h1 { font-size: 16pt; font-weight: 700; line-height: 1.25; }
    .content h2 { font-size: 13pt; font-weight: 700; line-height: 1.3; }
    .content h3 { font-size: 12pt; font-weight: 700; line-height: 1.3; }
    .content ul, .content ol { padding-left: 1.4rem; }
    .content li { margin: 0; }
    .content blockquote { border-left: 3px solid #cbd5e1; color: #334155; margin: 12px 0; padding-left: 12px; }
    .content pre { background: #f1f5f9; border: 1px solid #cbd5e1; color: #0f172a; font-family: "Courier New", monospace; font-size: 10pt; overflow-wrap: anywhere; padding: 10px; white-space: pre-wrap; }
    .content code { background: #f1f5f9; border: 1px solid #e2e8f0; font-family: "Courier New", monospace; font-size: 0.9em; padding: 0 3px; }
    .content table { border-collapse: collapse; margin: 12px 0; width: 100%; }
    .content th, .content td { border: 1px solid #cbd5e1; padding: 6px 8px; vertical-align: top; }
    .content th { background: #f1f5f9; font-weight: 700; }
    .inline-image { border: 1px solid #cbd5e1; break-inside: avoid; margin: 0.75rem 0; padding: 0.5rem; page-break-inside: avoid; }
    .inline-image img { display: block; height: auto; max-height: 8in; max-width: 6.8in; width: auto; }
    .image-caption { color: #64748b; display: block; font-size: 0.8rem; line-height: 1.25; margin-top: 0.35rem; overflow-wrap: anywhere; }
    .attachment-marker { background: #f8fafc; border: 1px dashed #cbd5e1; break-inside: avoid; margin: 0.75rem 0; padding: 0.5rem; page-break-inside: avoid; }
    .attachment-label { color: #64748b; font-size: 9pt; margin-bottom: 2px; }
    .attachment-name { font-weight: 700; overflow-wrap: anywhere; }
    .attachment-meta { color: #64748b; font-size: 9pt; margin-top: 2px; }
    a { color: #0369a1; }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(page.title || "Untitled page")}</h1>
    <div class="meta">
      <div class="meta-row"><span class="meta-label">Notebook:</span><span>${escapeHtml(notebook.name)}</span></div>
      <div class="meta-row"><span class="meta-label">Created:</span><span>${escapeHtml(formatDateTime(page.createdAt))}</span></div>
      <div class="meta-row"><span class="meta-label">Updated:</span><span>${escapeHtml(formatDateTime(page.updatedAt))}</span></div>
      <div class="meta-row"><span class="meta-label">Exported:</span><span>${escapeHtml(formatDateTime(exportedAt))}</span></div>
    </div>
    ${renderTags(page)}
  </header>
  <main class="content">
    ${renderNodes(document.content ?? [], context)}
  </main>
</body>
</html>`;
}

export async function buildPageExportArchive(page: PageEntry, notebook: ExportNotebook) {
  const entries: Record<string, Uint8Array> = {};
  const archiveAttachmentNames = new Map<string, string>();
  const usedNames = new Map<string, number>();
  const missingAttachments: Array<{ id: string; originalName: string; storageKey: string }> = [];

  for (const attachment of page.attachments) {
    const archiveName = uniqueArchivePath(attachment.originalName, usedNames);
    archiveAttachmentNames.set(attachment.id, archiveName);
    const filePath = path.join(uploadDir, attachment.storageKey);
    if (!existsSync(filePath)) {
      missingAttachments.push({ id: attachment.id, originalName: attachment.originalName, storageKey: attachment.storageKey });
      continue;
    }
    entries[archiveName] = readFileSync(filePath);
  }

  const attachmentMetadata = page.attachments.map((attachment) => ({
    ...attachment,
    archivePath: archiveAttachmentNames.get(attachment.id) ?? "",
  }));
  const metadata = {
    exportedAt: new Date().toISOString(),
    notebook,
    page: {
      ...page,
      attachments: attachmentMetadata,
    },
  };

  entries["page.json"] = strToU8(JSON.stringify(metadata, null, 2));
  entries["page.html"] = strToU8(await buildPageExportHtml(page, notebook, { archiveAttachmentNames }));
  entries["page.txt"] = strToU8(bodyToEditorText(page.body));
  if (missingAttachments.length) {
    entries["missing-attachments.json"] = strToU8(JSON.stringify(missingAttachments, null, 2));
  }

  return zipSync(entries, { level: 6 });
}

function renderTags(page: PageEntry) {
  const tags = page.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`);
  if (page.status) tags.unshift(`<span class="status">${escapeHtml(page.status)}</span>`);
  return tags.length ? `<div class="tags">${tags.join("")}</div>` : "";
}

function renderNodes(nodes: JSONContent[], context: RenderContext) {
  return nodes.map((node) => renderNode(node, context)).join("");
}

function renderNode(node: JSONContent, context: RenderContext): string {
  const children = renderNodes(node.content ?? [], context);
  switch (node.type) {
    case "text":
      return renderText(node);
    case "hardBreak":
      return "<br />";
    case "paragraph":
      return `<p>${children || "&nbsp;"}</p>`;
    case "heading": {
      const level = clampHeadingLevel(Number(node.attrs?.level ?? 1));
      return `<h${level}>${children}</h${level}>`;
    }
    case "bulletList":
      return `<ul>${children}</ul>`;
    case "orderedList":
      return `<ol>${children}</ol>`;
    case "listItem":
      return `<li>${children}</li>`;
    case "blockquote":
      return `<blockquote>${children}</blockquote>`;
    case "codeBlock":
      return `<pre>${escapeHtml(node.content?.map((child) => child.text ?? "").join("") ?? "")}</pre>`;
    case "horizontalRule":
      return "<hr />";
    case "table":
      return `<table>${children}</table>`;
    case "tableRow":
      return `<tr>${children}</tr>`;
    case "tableHeader":
      return renderTableCell("th", node, children);
    case "tableCell":
      return renderTableCell("td", node, children);
    case "attachmentCard":
      return renderAttachmentCard(node, context);
    default:
      return children;
  }
}

function renderText(node: JSONContent) {
  let html = escapeHtml(node.text ?? "");
  for (const mark of node.marks ?? []) {
    if (mark.type === "bold") html = `<strong>${html}</strong>`;
    else if (mark.type === "italic") html = `<em>${html}</em>`;
    else if (mark.type === "underline") html = `<u>${html}</u>`;
    else if (mark.type === "strike") html = `<s>${html}</s>`;
    else if (mark.type === "code") html = `<code>${html}</code>`;
    else if (mark.type === "link") {
      const href = String(mark.attrs?.href ?? "");
      html = href ? `<a href="${escapeAttribute(href)}">${html}</a>` : html;
    } else if (mark.type === "textStyle") {
      const color = sanitizeCssColor(mark.attrs?.color);
      if (color) html = `<span style="color: ${escapeAttribute(color)};">${html}</span>`;
    }
  }
  return html;
}

function renderTableCell(tag: "td" | "th", node: JSONContent, children: string) {
  const attrs: string[] = [];
  const colspan = Number(node.attrs?.colspan ?? 1);
  const rowspan = Number(node.attrs?.rowspan ?? 1);
  if (Number.isFinite(colspan) && colspan > 1) attrs.push(`colspan="${Math.round(colspan)}"`);
  if (Number.isFinite(rowspan) && rowspan > 1) attrs.push(`rowspan="${Math.round(rowspan)}"`);
  return `<${tag}${attrs.length ? ` ${attrs.join(" ")}` : ""}>${children}</${tag}>`;
}

function renderAttachmentCard(node: JSONContent, context: RenderContext) {
  const attachmentId = String(node.attrs?.attachmentId ?? "");
  const attachment = context.attachmentMap.get(attachmentId);
  const filename = attachment?.originalName ?? String(node.attrs?.filename ?? "Attachment");
  const kind = attachment?.blockType ?? String(node.attrs?.kind ?? "file");
  const size = attachment?.size ?? Number(node.attrs?.size ?? 0);
  const mimeType = attachment?.mimeType ?? String(node.attrs?.mimeType ?? "");

  if (attachment && attachment.blockType === "image") {
    const src = attachmentImageSource(attachment, context);
    if (src) {
      const imageAttributes = imageExportAttributes(attachment, context);
      return `<figure class="inline-image"><img src="${escapeAttribute(src)}" alt="${escapeAttribute(filename)}"${imageAttributes} /><div class="image-caption">${escapeHtml(filename)}</div></figure>`;
    }
  }

  return `<div class="attachment-marker">
    <div class="attachment-label">Inline attachment</div>
    <div class="attachment-name">${escapeHtml(filename)}</div>
    <div class="attachment-meta">${escapeHtml(labelForKind(kind))}${mimeType ? ` · ${escapeHtml(mimeType)}` : ""}${size ? ` · ${escapeHtml(formatBytes(size))}` : ""}</div>
  </div>`;
}

async function readImageSizes(attachments: Attachment[]) {
  const sizes = new Map<string, { width: number; height: number }>();
  await Promise.all(attachments.map(async (attachment) => {
    if (attachment.blockType !== "image") return;
    const filePath = path.join(uploadDir, attachment.storageKey);
    if (!existsSync(filePath)) return;
    try {
      const metadata = await sharp(filePath, { limitInputPixels: false }).metadata();
      if (metadata.width && metadata.height) {
        sizes.set(attachment.id, { width: metadata.width, height: metadata.height });
      }
    } catch {
      // If Sharp cannot read a legacy image format, LibreOffice still gets the file.
    }
  }));
  return sizes;
}

function imageExportAttributes(attachment: Attachment, context: RenderContext) {
  const size = context.imageSizes.get(attachment.id);
  if (!size) return ` style="display:block;width:6.5in;height:auto;max-width:6.5in;max-height:8in;object-fit:contain;"`;

  const maxWidthIn = 6.25;
  const maxHeightIn = 8;
  const naturalWidthIn = size.width / 96;
  const naturalHeightIn = size.height / 96;
  const scale = Math.min(1, maxWidthIn / naturalWidthIn, maxHeightIn / naturalHeightIn);
  const widthIn = Math.max(0.1, naturalWidthIn * scale);
  const heightIn = Math.max(0.1, naturalHeightIn * scale);
  const fallbackWidth = Math.round(widthIn * 72);
  const fallbackHeight = Math.round(heightIn * 72);
  return ` width="${fallbackWidth}" height="${fallbackHeight}" style="display:block;width:${widthIn.toFixed(2)}in;height:${heightIn.toFixed(2)}in;max-width:${maxWidthIn}in;max-height:${maxHeightIn}in;object-fit:contain;"`;
}

function attachmentImageSource(attachment: Attachment, context: RenderContext) {
  const archivePath = context.archiveAttachmentNames?.get(attachment.id);
  if (archivePath) return archivePath;
  const filePath = path.join(uploadDir, attachment.storageKey);
  if (!existsSync(filePath)) return "";
  return pathToFileURL(filePath).href;
}

function uniqueArchivePath(originalName: string, usedNames: Map<string, number>) {
  const parsed = path.parse(sanitizeFilename(originalName) || "attachment");
  const base = parsed.name || "attachment";
  const extension = parsed.ext;
  let candidate = `attachments/${base}${extension}`;
  const used = usedNames.get(candidate) ?? 0;
  if (used > 0) candidate = `attachments/${base}-${used + 1}${extension}`;
  usedNames.set(`attachments/${base}${extension}`, used + 1);
  return candidate;
}

function sanitizeFilename(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replaceAll("\n", " ");
}

function sanitizeCssColor(value: unknown) {
  if (typeof value !== "string") return "";
  const color = value.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
  if (/^rgba?\([\d\s.,%]+\)$/i.test(color)) return color;
  return "";
}

function clampHeadingLevel(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(3, Math.max(1, Math.round(value)));
}

function labelForKind(kind: string) {
  const labels: Record<string, string> = {
    image: "Image",
    sheet: "Spreadsheet",
    pdf: "PDF",
    slides: "Presentation",
    sequence: "Sequence",
    file: "File",
  };
  return labels[kind] ?? "File";
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 KB";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDateTime(value: string) {
  const parsed = Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(parsed)) return value;
  const date = new Date(parsed);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
