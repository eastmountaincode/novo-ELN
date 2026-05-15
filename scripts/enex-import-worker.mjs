import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { XMLParser } from "fast-xml-parser";

const jobId = process.argv[2];
if (!jobId) failStartup("Missing import job id.");

const cwd = process.cwd();
const databasePath = process.env.ELN_DATABASE_PATH || path.join(cwd, "data", "eln.sqlite3");
const uploadDir = process.env.ELN_UPLOAD_DIR || path.join(cwd, "storage", "uploads");
const parser = new XMLParser({ ignoreAttributes: false, trimValues: false, cdataPropName: "__cdata", textNodeName: "#text" });

try {
  await run();
} catch (error) {
  updateJob(`state = 'failed', error = ${sql(error instanceof Error ? error.message : 'Import failed.')}, finished_at = datetime('now')`);
}

async function run() {
  const job = getJob();
  if (!job) throw new Error(`Import job ${jobId} not found.`);
  const absolutePath = normalizeServerPath(job.file_path);
  const stats = await fsp.stat(absolutePath);
  if (!stats.isFile()) throw new Error("ENEX path must point to a file.");

  await fsp.mkdir(uploadDir, { recursive: true });
  updateJob(`state = 'running', total_bytes = ${stats.size}, started_at = datetime('now'), updated_at = datetime('now')`);

  const notebookId = crypto.randomUUID();
  execSql(`
    INSERT INTO notebooks (id, project_id, name)
    VALUES (${sql(notebookId)}, ${sql(job.project_id)}, ${sql(job.notebook_name || notebookNameFromPath(absolutePath))});
    UPDATE import_jobs SET notebook_id = ${sql(notebookId)}, updated_at = datetime('now') WHERE id = ${sql(jobId)};
    UPDATE projects SET updated_at = datetime('now') WHERE id = ${sql(job.project_id)};
  `);

  let importedNotes = 0;
  let importedResources = 0;
  let lastProgressAt = 0;

  await streamEnexNotes(absolutePath, async (noteXml, processedBytes) => {
    const note = parseNoteXml(noteXml);
    const pageId = crypto.randomUUID();
    const createdAt = note.createdAt || new Date().toISOString();
    const updatedAt = note.updatedAt || createdAt;

    execSql(`
      INSERT INTO pages (id, notebook_id, title, body, status, owner_id, created_at, updated_at)
      VALUES (${sql(pageId)}, ${sql(notebookId)}, ${sql(note.title)}, '', 'Draft', ${sql(job.user_id)}, ${sql(createdAt)}, ${sql(updatedAt)});
    `);

    const attachmentsByHash = new Map();
    for (const resource of note.resources) {
      const storageKey = await writeImportedResource(pageId, resource);
      const attachment = insertAttachment({ pageId, resource, storageKey, createdAt });
      attachmentsByHash.set(resource.hash, attachment);
      importedResources += 1;
      if (Date.now() - lastProgressAt > 750) {
        updateProgress({ processedBytes, importedNotes, importedResources });
        lastProgressAt = Date.now();
      }
    }

    const { body, plainText } = enmlToEditorBody(note.body, attachmentsByHash);
    const tagSql = note.tags.map((tag) => `INSERT OR IGNORE INTO page_tags (page_id, tag) VALUES (${sql(pageId)}, ${sql(tag)});`).join("\n");
    execSql(`
      UPDATE pages SET body = ${sql(body)}, updated_at = ${sql(updatedAt)} WHERE id = ${sql(pageId)};
      ${tagSql}
      INSERT INTO page_versions (id, page_id, summary, created_by, created_at)
      VALUES (${sql(crypto.randomUUID())}, ${sql(pageId)}, 'Imported from ENEX', ${sql(job.user_id)}, ${sql(updatedAt)});
      INSERT INTO search_pages_fts (page_id, project_id, notebook_id, title, body, tags, attachments, project, notebook, updated_at)
      VALUES (${sql(pageId)}, ${sql(job.project_id)}, ${sql(notebookId)}, ${sql(note.title)}, ${sql(plainText)}, ${sql(note.tags.join(','))}, ${sql([...attachmentsByHash.values()].map((attachment) => attachment.originalName).join(','))}, (SELECT name FROM projects WHERE id = ${sql(job.project_id)}), ${sql(job.notebook_name)}, ${sql(updatedAt)});
    `);

    importedNotes += 1;
    updateProgress({ processedBytes, importedNotes, importedResources });
  });

  execSql(`
    UPDATE notebooks SET updated_at = datetime('now') WHERE id = ${sql(notebookId)};
    UPDATE projects SET updated_at = datetime('now') WHERE id = ${sql(job.project_id)};
    UPDATE import_jobs
    SET state = 'succeeded', imported_notes = ${importedNotes}, imported_resources = ${importedResources}, processed_bytes = ${stats.size}, total_bytes = ${stats.size}, finished_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ${sql(jobId)};
  `);
}

function getJob() {
  const rows = querySql(`SELECT * FROM import_jobs WHERE id = ${sql(jobId)} LIMIT 1;`);
  return rows[0] || null;
}

function updateProgress({ processedBytes, importedNotes, importedResources }) {
  updateJob(`processed_bytes = ${processedBytes}, imported_notes = ${importedNotes}, imported_resources = ${importedResources}, updated_at = datetime('now')`);
}

function updateJob(assignments) {
  execSql(`UPDATE import_jobs SET ${assignments} WHERE id = ${sql(jobId)};`);
}

function parseNoteXml(noteXml) {
  const parsed = parser.parse(noteXml);
  const note = parsed.note || {};
  const content = textValue(note.content);
  return {
    title: textValue(note.title) || "Untitled Evernote note",
    body: content,
    tags: toArray(note.tag).map(textValue).map((tag) => tag.trim()).filter(Boolean),
    createdAt: normalizeEvernoteDate(textValue(note.created)),
    updatedAt: normalizeEvernoteDate(textValue(note.updated)),
    resources: toArray(note.resource).map(parseResource).filter(Boolean),
  };
}

function parseResource(rawResource) {
  const dataText = textValue(rawResource?.data).replace(/\s+/g, "");
  if (!dataText) return null;
  const data = Buffer.from(dataText, "base64");
  const attributes = rawResource?.["resource-attributes"] || {};
  const mimeType = textValue(rawResource?.mime) || "application/octet-stream";
  const fileName = sanitizeFileName(textValue(attributes["file-name"]) || `evernote-resource-${crypto.randomUUID()}${extensionForMime(mimeType)}`);
  return { hash: crypto.createHash("md5").update(data).digest("hex"), fileName, mimeType, data };
}

async function streamEnexNotes(filePath, onNote) {
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

async function writeImportedResource(pageId, resource) {
  const storageKey = path.join(pageId, `${crypto.randomUUID()}-${resource.fileName}`);
  const absolutePath = path.join(uploadDir, storageKey);
  await fsp.mkdir(path.dirname(absolutePath), { recursive: true });
  await fsp.writeFile(absolutePath, resource.data);
  return storageKey;
}

function insertAttachment({ pageId, resource, storageKey, createdAt }) {
  const id = crypto.randomUUID();
  const blockType = inferBlockType(resource.fileName, resource.mimeType);
  const attachment = { id, pageId, originalName: resource.fileName, mimeType: resource.mimeType, size: resource.data.length, storageKey, blockType, previewText: previewFor(resource.fileName, resource.mimeType), createdAt, updatedAt: createdAt };
  execSql(`
    INSERT INTO attachments (id, page_id, original_name, mime_type, size, storage_key, block_type, preview_text, created_at)
    VALUES (${sql(id)}, ${sql(pageId)}, ${sql(resource.fileName)}, ${sql(resource.mimeType)}, ${resource.data.length}, ${sql(storageKey)}, ${sql(blockType)}, ${sql(attachment.previewText)}, ${sql(createdAt)});
  `);
  return attachment;
}

function enmlToEditorBody(enml, attachmentsByHash) {
  const cleaned = unwrapCdata(enml).replace(/<\?xml[^>]*>/gi, "").replace(/<!DOCTYPE[^>]*>/gi, "").replace(/<\/?en-note[^>]*>/gi, "");
  const content = [];
  let paragraphParts = [];
  let plainText = "";
  const tokenPattern = /<en-media\b[^>]*>|<br\s*\/?>|<\/?(?:div|p|li|ul|ol|blockquote|h[1-6])\b[^>]*>/gi;
  let cursor = 0;
  let listDepth = 0;
  let inBlockquote = false;
  let match;

  while ((match = tokenPattern.exec(cleaned))) {
    pushText(cleaned.slice(cursor, match.index));
    const token = match[0];
    if (/^<en-media/i.test(token)) {
      flushParagraph();
      const hash = attrValue(token, "hash");
      const attachment = hash ? attachmentsByHash.get(hash.toLowerCase()) : undefined;
      if (attachment) {
        content.push(attachmentNode(attachment));
        plainText += ` [${attachment.originalName}] `;
      }
    } else if (/^<ul|^<ol/i.test(token)) {
      listDepth += 1;
    } else if (/^<\/ul|^<\/ol/i.test(token)) {
      listDepth = Math.max(0, listDepth - 1);
      flushParagraph();
    } else if (/^<blockquote/i.test(token)) {
      inBlockquote = true;
      flushParagraph();
    } else if (/^<\/blockquote/i.test(token)) {
      flushParagraph();
      inBlockquote = false;
    } else if (/^<li/i.test(token)) {
      flushParagraph();
      if (listDepth) paragraphParts.push({ type: "text", text: "- " });
    } else if (/^<br/i.test(token)) {
      paragraphParts.push({ type: "hardBreak" });
      plainText += "\n";
    } else if (/^<\//.test(token)) {
      flushParagraph();
    }
    cursor = match.index + token.length;
  }

  pushText(cleaned.slice(cursor));
  flushParagraph();
  return { body: JSON.stringify({ type: "doc", content: content.length ? content : [{ type: "paragraph" }] }), plainText: plainText.trim() };

  function pushText(rawText) {
    const text = decodeXmlEntities(stripTags(rawText)).replace(/[ \t\r\f]+/g, " ").trim();
    if (!text) return;
    const finalText = inBlockquote && !paragraphParts.length ? `> ${text}` : text;
    paragraphParts.push({ type: "text", text: finalText });
    plainText += `${finalText} `;
  }

  function flushParagraph() {
    const compactParts = paragraphParts.filter((part, index, parts) => part.type !== "hardBreak" || (index > 0 && index < parts.length - 1));
    if (compactParts.length) content.push({ type: "paragraph", content: compactParts });
    paragraphParts = [];
  }
}

function attachmentNode(attachment) {
  return { type: "attachmentCard", attrs: { attachmentId: attachment.id, kind: attachment.blockType, filename: attachment.originalName, mimeType: attachment.mimeType, size: attachment.size, createdAt: attachment.createdAt, updatedAt: attachment.updatedAt } };
}

function execSql(statement) {
  execFileSync("sqlite3", [databasePath, "-batch"], { input: `PRAGMA foreign_keys=ON;\n${statement}`, stdio: ["pipe", "pipe", "pipe"] });
}

function querySql(statement) {
  const output = execFileSync("sqlite3", [databasePath, "-batch", "-header", "-csv"], { input: `PRAGMA foreign_keys=ON;\n${statement}`, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  return parseCsv(output);
}

function parseCsv(input) {
  const clean = input.trimEnd();
  if (!clean) return [];
  const rows = parseCsvRows(clean);
  const [headers, ...dataRows] = rows;
  return dataRows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function parseCsvRows(input) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ""; }
    else if (char === '\n') { row.push(field); rows.push(row); row = []; field = ""; }
    else if (char !== '\r') field += char;
  }
  row.push(field); rows.push(row); return rows;
}

function sql(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}
function textValue(value) { if (value === null || value === undefined) return ""; if (typeof value === "string" || typeof value === "number") return String(value); if (typeof value === "object") { if ("__cdata" in value) return textValue(value.__cdata); if ("#text" in value) return textValue(value["#text"]); } return ""; }
function toArray(value) { if (!value) return []; return Array.isArray(value) ? value : [value]; }
function normalizeServerPath(filePath) { const trimmed = String(filePath || "").trim(); if (!path.isAbsolute(trimmed)) throw new Error("Use an absolute server path."); if (!/\.enex$/i.test(trimmed)) throw new Error("Path must point to an .enex file."); return trimmed; }
function notebookNameFromPath(filePath) { return path.basename(filePath).replace(/\.enex$/i, "") || "Evernote Import"; }
function normalizeEvernoteDate(value) { const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/); return match ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.000Z` : undefined; }
function unwrapCdata(value) { return value.replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, ""); }
function attrValue(tag, name) { return tag.match(new RegExp(`${name}=["']([^"']+)["']`, "i"))?.[1] ?? ""; }
function stripTags(value) { return value.replace(/<[^>]+>/g, ""); }
function decodeXmlEntities(value) { return value.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'"); }
function inferBlockType(name, mimeType) { const lower = name.toLowerCase(); if (mimeType.startsWith("image/") || /\.(png|jpe?g|gif|tiff?|webp)$/.test(lower)) return "image"; if (/\.(xlsx?|csv|tsv)$/.test(lower)) return "sheet"; if (/\.pdf$/.test(lower)) return "pdf"; if (/\.(pptx?|key)$/.test(lower)) return "slides"; if (/\.(gb|gbk|fasta|fa|dna|seq)$/.test(lower)) return "sequence"; return "file"; }
function previewFor(name, mimeType) { return { image: "Image imported inline from Evernote.", sheet: "Spreadsheet imported from Evernote.", pdf: "PDF imported from Evernote.", slides: "Slide deck imported from Evernote.", sequence: "Sequence file imported from Evernote.", file: "File imported from Evernote." }[inferBlockType(name, mimeType)]; }
function extensionForMime(mimeType) { if (mimeType === "application/pdf") return ".pdf"; if (mimeType === "image/png") return ".png"; if (mimeType === "image/jpeg") return ".jpg"; if (mimeType === "image/tiff") return ".tif"; if (mimeType.includes("spreadsheet")) return ".xlsx"; if (mimeType.includes("presentation")) return ".pptx"; if (mimeType === "text/plain") return ".txt"; return ".bin"; }
function sanitizeFileName(name) { return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "attachment.bin"; }
function failStartup(message) { console.error(message); process.exit(1); }
