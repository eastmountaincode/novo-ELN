#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const startedAt = Date.now();
const args = parseArgs(process.argv.slice(2));

if (args.help || args.h) {
  printHelp();
  process.exit(0);
}

const notebookId = stringArg("notebook-id");
const notebookName = stringArg("notebook-name");
if (!notebookId && !notebookName) {
  fail("Pass --notebook-id <id> or --notebook-name <name>.");
}
if (notebookId && notebookName) {
  fail("Pass only one of --notebook-id or --notebook-name.");
}

const cwd = process.cwd();
const dbPath = path.resolve(stringArg("db") ?? process.env.ELN_DATABASE_PATH ?? path.join(cwd, "runtime", "data", "eln.sqlite3"));
const uploadDir = path.resolve(stringArg("uploads") ?? process.env.ELN_UPLOAD_DIR ?? path.join(cwd, "runtime", "uploads"));
const outRoot = path.resolve(stringArg("out") ?? path.join(cwd, "exports"));
const shouldZip = Boolean(args.zip);

if (!existsSync(dbPath)) fail(`Database not found: ${dbPath}`);
if (!existsSync(uploadDir)) fail(`Uploads directory not found: ${uploadDir}`);

const notebook = findNotebook();
const pages = sqliteJson(`
  SELECT id, notebook_id, title, body, preview_text, status, owner_id, locked_at, locked_by, created_at, updated_at
  FROM pages
  WHERE notebook_id = ${sqlString(notebook.id)}
  ORDER BY datetime(created_at) ASC, title COLLATE NOCASE ASC
`);
const totals = sqliteJson(`
  SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes
  FROM attachments
  WHERE page_id IN (SELECT id FROM pages WHERE notebook_id = ${sqlString(notebook.id)})
`)[0] ?? { count: 0, bytes: 0 };

const timestamp = timestampForPath(new Date());
const exportDir = path.join(outRoot, `${sanitizeFilename(notebook.name).slice(0, 80) || "notebook"}-${timestamp}`);
const pagesDir = path.join(exportDir, "pages");
const missingAttachments = [];
const exportedPages = [];
const state = {
  pageDone: 0,
  pageTotal: pages.length,
  attachmentDone: 0,
  attachmentTotal: Number(totals.count ?? 0),
  bytesDone: 0,
  bytesTotal: Number(totals.bytes ?? 0),
  current: "Preparing export",
};

await mkdir(pagesDir, { recursive: true });

console.log(`Novo notebook export started at ${new Date(startedAt).toISOString()}`);
console.log(`Notebook: ${notebook.name}`);
console.log(`Notebook ID: ${notebook.id}`);
console.log(`Pages: ${pages.length.toLocaleString()}`);
console.log(`Attachments: ${state.attachmentTotal.toLocaleString()} (${formatBytes(state.bytesTotal)})`);
console.log(`Output: ${exportDir}`);

for (const [index, page] of pages.entries()) {
  state.current = page.title || "Untitled page";
  const pageSlug = `${String(index + 1).padStart(5, "0")}-${sanitizeFilename(page.title || "Untitled_page").slice(0, 90) || "Untitled_page"}`;
  const pageDir = path.join(pagesDir, pageSlug);
  const attachmentDir = path.join(pageDir, "attachments");
  await mkdir(attachmentDir, { recursive: true });

  const tags = sqliteJson(`SELECT tag FROM page_tags WHERE page_id = ${sqlString(page.id)} ORDER BY tag COLLATE NOCASE ASC`).map((row) => row.tag);
  const attachments = sqliteJson(`
    SELECT id, page_id, original_name, mime_type, size, storage_key, block_type, evernote_hash, created_at
    FROM attachments
    WHERE page_id = ${sqlString(page.id)}
    ORDER BY datetime(created_at) ASC, original_name COLLATE NOCASE ASC
  `);
  const archiveAttachmentNames = new Map();
  const usedNames = new Map();

  for (const attachment of attachments) {
    const archiveName = uniqueAttachmentName(attachment.original_name, usedNames);
    archiveAttachmentNames.set(attachment.id, `attachments/${archiveName}`);
    const source = path.join(uploadDir, attachment.storage_key);
    const destination = path.join(attachmentDir, archiveName);
    if (!existsSync(source)) {
      missingAttachments.push({
        pageId: page.id,
        pageTitle: page.title,
        attachmentId: attachment.id,
        originalName: attachment.original_name,
        storageKey: attachment.storage_key,
      });
      state.attachmentDone += 1;
      drawProgress(state);
      continue;
    }
    await copyFile(source, destination);
    const copied = await stat(destination);
    state.attachmentDone += 1;
    state.bytesDone += copied.size;
    drawProgress(state);
  }

  const pageExport = {
    ...normalizePage(page),
    tags,
    attachments: attachments.map((attachment) => ({
      ...normalizeAttachment(attachment),
      exportPath: archiveAttachmentNames.get(attachment.id) ?? "",
    })),
  };
  const pageMetadata = {
    exportedAt: new Date().toISOString(),
    notebook: normalizeNotebook(notebook),
    page: pageExport,
  };
  await writeFile(path.join(pageDir, "page.json"), JSON.stringify(pageMetadata, null, 2));
  await writeFile(path.join(pageDir, "page.html"), renderPageHtml(pageExport, notebook, archiveAttachmentNames));
  await writeFile(path.join(pageDir, "page.txt"), bodyToText(page.body));

  exportedPages.push({
    id: page.id,
    title: page.title,
    createdAt: page.created_at,
    updatedAt: page.updated_at,
    exportPath: path.relative(exportDir, pageDir),
    attachmentCount: attachments.length,
  });

  state.pageDone += 1;
  drawProgress(state);
}

process.stdout.write("\n");

const manifest = {
  exportedAt: new Date().toISOString(),
  databasePath: dbPath,
  uploadDir,
  notebook: normalizeNotebook(notebook),
  counts: {
    pages: pages.length,
    attachments: state.attachmentTotal,
    attachmentBytes: state.bytesTotal,
    missingAttachments: missingAttachments.length,
  },
  pages: exportedPages,
};
await writeFile(path.join(exportDir, "notebook.json"), JSON.stringify(manifest, null, 2));
await writeFile(path.join(exportDir, "index.html"), renderNotebookIndex(manifest));
if (missingAttachments.length) {
  await writeFile(path.join(exportDir, "missing-attachments.json"), JSON.stringify(missingAttachments, null, 2));
}

if (shouldZip) {
  const zipPath = `${exportDir}.zip`;
  const zipResult = spawnSync("zip", ["-qr", zipPath, path.basename(exportDir)], {
    cwd: outRoot,
    stdio: "inherit",
  });
  if (zipResult.error) {
    console.warn(`Could not create zip archive because zip is unavailable: ${zipResult.error.message}`);
  } else if (zipResult.status !== 0) {
    console.warn(`zip exited with status ${zipResult.status}; folder export is still complete.`);
  } else {
    console.log(`Zip archive: ${zipPath}`);
  }
}

console.log(`Export complete in ${formatDuration(Date.now() - startedAt)}.`);
console.log(`Folder: ${exportDir}`);

function findNotebook() {
  if (notebookId) {
    const rows = sqliteJson(`
      SELECT id, name, color, owner_id, created_at, updated_at
      FROM notebooks
      WHERE id = ${sqlString(notebookId)}
    `);
    if (!rows.length) fail(`No notebook found with ID ${notebookId}.`);
    return rows[0];
  }

  const rows = sqliteJson(`
    SELECT id, name, color, owner_id, created_at, updated_at
    FROM notebooks
    WHERE lower(name) = lower(${sqlString(notebookName)})
    ORDER BY datetime(updated_at) DESC, name COLLATE NOCASE ASC
  `);
  if (!rows.length) fail(`No notebook found named ${notebookName}.`);
  if (rows.length > 1) {
    console.error(`Multiple notebooks are named ${notebookName}. Re-run with --notebook-id:`);
    for (const row of rows) console.error(`  ${row.id}  ${row.name}  updated ${row.updated_at}`);
    process.exit(1);
  }
  return rows[0];
}

function sqliteJson(sql) {
  try {
    const output = execFileSync("sqlite3", ["-json", dbPath, sql], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    });
    return output.trim() ? JSON.parse(output) : [];
  } catch (error) {
    const message = error.stderr?.toString?.() || error.message;
    fail(`SQLite query failed: ${message}`);
  }
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (!token.startsWith("--")) fail(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (["zip", "help"].includes(key)) {
      parsed[key] = true;
      continue;
    }
    const value = values[index + 1];
    if (!value || value.startsWith("--")) fail(`Missing value for --${key}`);
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

function stringArg(name) {
  const value = args[name];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeNotebook(row) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizePage(row) {
  return {
    id: row.id,
    notebookId: row.notebook_id,
    title: row.title,
    body: row.body,
    previewText: row.preview_text,
    status: row.status,
    ownerId: row.owner_id,
    lockedAt: row.locked_at,
    lockedBy: row.locked_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeAttachment(row) {
  return {
    id: row.id,
    pageId: row.page_id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    size: Number(row.size ?? 0),
    storageKey: row.storage_key,
    blockType: row.block_type,
    evernoteHash: row.evernote_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

function renderNotebookIndex(manifest) {
  const pageRows = manifest.pages.map((page) => `<li><a href="${escapeAttribute(page.exportPath)}/page.html">${escapeHtml(page.title || "Untitled page")}</a> <span>${page.attachmentCount} attachments</span></li>`).join("\n");
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(manifest.notebook.name)}</title>
  <style>
    body { color: #0f172a; font-family: Arial, Helvetica, sans-serif; line-height: 1.45; margin: 2rem; }
    h1 { margin-bottom: 0.25rem; }
    .meta { color: #475569; margin-bottom: 1.5rem; }
    li { margin: 0.35rem 0; }
    span { color: #64748b; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>${escapeHtml(manifest.notebook.name)}</h1>
  <div class="meta">Notebook ID: ${escapeHtml(manifest.notebook.id)}<br />Exported: ${escapeHtml(formatDateTime(manifest.exportedAt))}</div>
  <ol>
    ${pageRows}
  </ol>
</body>
</html>`;
}

function renderPageHtml(page, notebook, archiveAttachmentNames) {
  const document = bodyToDocument(page.body);
  const attachmentMap = new Map(page.attachments.map((attachment) => [attachment.id, attachment]));
  const context = { attachmentMap, archiveAttachmentNames };
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(page.title || "Untitled page")}</title>
  <style>
    body { color: #0f172a; font-family: Arial, Helvetica, sans-serif; line-height: 1.45; margin: 2rem; overflow-wrap: anywhere; }
    h1 { margin-bottom: 0.25rem; }
    .meta { border-bottom: 1px solid #cbd5e1; color: #475569; margin-bottom: 1.5rem; padding-bottom: 1rem; }
    .tag { border: 1px solid #cbd5e1; border-radius: 3px; color: #334155; display: inline-block; font-size: 0.85rem; margin: 0 0.25rem 0.25rem 0; padding: 0.15rem 0.4rem; }
    p, ul, ol, blockquote, pre, table { margin-bottom: 0.6rem; }
    ul, ol { padding-left: 1.5rem; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #cbd5e1; padding: 0.35rem 0.5rem; vertical-align: top; }
    th { background: #f1f5f9; }
    pre, code { background: #f1f5f9; font-family: "Courier New", monospace; }
    pre { border: 1px solid #cbd5e1; padding: 0.75rem; white-space: pre-wrap; }
    code { border: 1px solid #e2e8f0; padding: 0 0.2rem; }
    blockquote { border-left: 3px solid #cbd5e1; color: #334155; padding-left: 0.75rem; }
    img { display: block; height: auto; max-height: 8in; max-width: 100%; }
    figure { border: 1px solid #cbd5e1; margin: 0.75rem 0; padding: 0.5rem; }
    figcaption, .attachment-meta { color: #64748b; font-size: 0.85rem; margin-top: 0.25rem; }
    .attachment-marker { background: #f8fafc; border: 1px dashed #cbd5e1; margin: 0.75rem 0; padding: 0.5rem; }
  </style>
</head>
<body>
  <h1>${escapeHtml(page.title || "Untitled page")}</h1>
  <div class="meta">
    Notebook: ${escapeHtml(notebook.name)}<br />
    Created: ${escapeHtml(formatDateTime(page.createdAt))}<br />
    Updated: ${escapeHtml(formatDateTime(page.updatedAt))}
    ${renderTags(page)}
  </div>
  <main>${renderNodes(document.content ?? [], context)}</main>
</body>
</html>`;
}

function renderTags(page) {
  const values = [];
  if (page.status) values.push(page.status);
  values.push(...page.tags);
  if (!values.length) return "";
  return `<div>${values.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>`;
}

function bodyToDocument(body) {
  if (!body) return { type: "doc", content: [] };
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === "object" && parsed.type) return parsed;
  } catch {
    return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: body }] }] };
  }
  return { type: "doc", content: [] };
}

function bodyToText(body) {
  const doc = bodyToDocument(body);
  const lines = [];
  collectText(doc, lines);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function collectText(node, lines) {
  if (node.type === "text") {
    lines[lines.length - 1] = `${lines[lines.length - 1] ?? ""}${node.text ?? ""}`;
    return;
  }
  if (["paragraph", "heading", "listItem"].includes(node.type)) {
    lines.push("");
  }
  if (node.type === "attachmentCard") {
    lines.push(`[Attachment: ${node.attrs?.filename ?? "file"}]`);
    return;
  }
  for (const child of node.content ?? []) collectText(child, lines);
}

function renderNodes(nodes, context) {
  return nodes.map((node) => renderNode(node, context)).join("");
}

function renderNode(node, context) {
  const children = renderNodes(node.content ?? [], context);
  switch (node.type) {
    case "text":
      return renderText(node);
    case "hardBreak":
      return "<br />";
    case "paragraph":
      return `<p>${children || "&nbsp;"}</p>`;
    case "heading": {
      const level = Math.min(3, Math.max(1, Math.round(Number(node.attrs?.level ?? 1))));
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
      return `<pre>${escapeHtml((node.content ?? []).map((child) => child.text ?? "").join(""))}</pre>`;
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

function renderText(node) {
  let html = escapeHtml(node.text ?? "");
  for (const mark of node.marks ?? []) {
    if (mark.type === "bold") html = `<strong>${html}</strong>`;
    else if (mark.type === "italic") html = `<em>${html}</em>`;
    else if (mark.type === "underline") html = `<u>${html}</u>`;
    else if (mark.type === "strike") html = `<s>${html}</s>`;
    else if (mark.type === "code") html = `<code>${html}</code>`;
    else if (mark.type === "link" && mark.attrs?.href) html = `<a href="${escapeAttribute(mark.attrs.href)}">${html}</a>`;
    else if (mark.type === "textStyle") {
      const color = sanitizeCssColor(mark.attrs?.color);
      if (color) html = `<span style="color:${escapeAttribute(color)}">${html}</span>`;
    }
  }
  return html;
}

function renderTableCell(tag, node, children) {
  const attrs = [];
  const colspan = Number(node.attrs?.colspan ?? 1);
  const rowspan = Number(node.attrs?.rowspan ?? 1);
  if (Number.isFinite(colspan) && colspan > 1) attrs.push(`colspan="${Math.round(colspan)}"`);
  if (Number.isFinite(rowspan) && rowspan > 1) attrs.push(`rowspan="${Math.round(rowspan)}"`);
  return `<${tag}${attrs.length ? ` ${attrs.join(" ")}` : ""}>${children}</${tag}>`;
}

function renderAttachmentCard(node, context) {
  const attachmentId = String(node.attrs?.attachmentId ?? "");
  const attachment = context.attachmentMap.get(attachmentId);
  const filename = attachment?.originalName ?? String(node.attrs?.filename ?? "Attachment");
  const kind = attachment?.blockType ?? String(node.attrs?.kind ?? "file");
  const size = Number(attachment?.size ?? node.attrs?.size ?? 0);
  const archivePath = context.archiveAttachmentNames.get(attachmentId);

  if (attachment?.blockType === "image" && archivePath) {
    return `<figure><img src="${escapeAttribute(archivePath)}" alt="${escapeAttribute(filename)}" /><figcaption>${escapeHtml(filename)}</figcaption></figure>`;
  }

  return `<div class="attachment-marker">
    <strong>${escapeHtml(filename)}</strong>
    <div class="attachment-meta">${escapeHtml(labelForKind(kind))}${size ? ` · ${escapeHtml(formatBytes(size))}` : ""}${archivePath ? ` · ${escapeHtml(archivePath)}` : ""}</div>
  </div>`;
}

function uniqueAttachmentName(originalName, usedNames) {
  const parsed = path.parse(sanitizeFilename(originalName) || "attachment");
  const base = parsed.name || "attachment";
  const extension = parsed.ext;
  const count = usedNames.get(`${base}${extension}`) ?? 0;
  usedNames.set(`${base}${extension}`, count + 1);
  return count === 0 ? `${base}${extension}` : `${base}-${count + 1}${extension}`;
}

function sanitizeFilename(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function drawProgress(progress) {
  const pageFraction = progress.pageTotal ? progress.pageDone / progress.pageTotal : 1;
  const byteFraction = progress.bytesTotal ? progress.bytesDone / progress.bytesTotal : pageFraction;
  const fraction = Math.max(0, Math.min(1, progress.bytesTotal ? (pageFraction + byteFraction) / 2 : pageFraction));
  const width = 28;
  const complete = Math.round(fraction * width);
  const elapsed = Date.now() - startedAt;
  const eta = fraction > 0.01 ? elapsed * (1 / fraction - 1) : 0;
  const line = `[${"#".repeat(complete)}${"-".repeat(width - complete)}] ${String(Math.round(fraction * 100)).padStart(3)}% | pages ${progress.pageDone}/${progress.pageTotal} | files ${progress.attachmentDone}/${progress.attachmentTotal} | ${formatBytes(progress.bytesDone)} / ${formatBytes(progress.bytesTotal)} | elapsed ${formatDuration(elapsed)} | remaining ${eta ? formatDuration(eta) : "unknown"} | ${truncate(progress.current, 44)}`;
  process.stdout.write(`\r${line.padEnd(180)}`);
}

function timestampForPath(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function formatBytes(value) {
  const bytes = Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = bytes;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount >= 10 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1)}${units[unit]}`;
}

function formatDuration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function labelForKind(kind) {
  const labels = {
    image: "Image",
    sheet: "Spreadsheet",
    pdf: "PDF",
    slides: "Presentation",
    sequence: "Sequence",
    file: "File",
  };
  return labels[kind] ?? "File";
}

function sanitizeCssColor(value) {
  if (typeof value !== "string") return "";
  const color = value.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
  if (/^rgba?\([\d\s.,%]+\)$/i.test(color)) return color;
  return "";
}

function truncate(value, max) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("\n", " ");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function printHelp() {
  console.log(`Export a Novo notebook to a folder of page HTML, page JSON, page text, and attachment files.

Usage:
  node scripts/export-notebook.mjs --notebook-name "Binders-II" --out /path/to/exports
  node scripts/export-notebook.mjs --notebook-id <uuid> --out /path/to/exports

Options:
  --notebook-name <name>  Exact notebook name, case-insensitive.
  --notebook-id <id>      Notebook UUID.
  --out <dir>             Output parent directory. Default: ./exports
  --db <path>             SQLite database path. Default: ELN_DATABASE_PATH or ./runtime/data/eln.sqlite3
  --uploads <dir>         Uploads directory. Default: ELN_UPLOAD_DIR or ./runtime/uploads
  --zip                   Also create a .zip using the system zip command, if installed.
  --help                  Show this help.
`);
}
