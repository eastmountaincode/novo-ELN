import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Worker, isMainThread, parentPort } from "node:worker_threads";
import { XMLParser } from "fast-xml-parser";

const cwd = process.cwd();
const databasePath = process.env.ELN_DATABASE_PATH || path.join(cwd, "data", "eln.sqlite3");
const uploadDir = process.env.ELN_UPLOAD_DIR || path.join(cwd, "storage", "uploads");
const parser = new XMLParser({ ignoreAttributes: false, trimValues: false, cdataPropName: "__cdata", textNodeName: "#text" });
const enmlParser = new XMLParser({ ignoreAttributes: false, preserveOrder: true, trimValues: false, cdataPropName: "__cdata", textNodeName: "#text" });
const createdStorageKeys = new Set();
const cliOptions = isMainThread ? parseCliArgs(process.argv.slice(2)) : null;
let currentNotebookId = "";
let cancelRequested = false;
let lastCancelCheckAt = 0;

class ImportCanceledError extends Error {
  constructor() {
    super("Import canceled by user.");
    this.name = "ImportCanceledError";
  }
}

if (!isMainThread) {
  startNoteParserWorker();
} else {
  if (!cliOptions.path) failStartup("Missing --path /absolute/path/to/export.enex.");
  if (!cliOptions.userEmail && !cliOptions.userId) failStartup("Provide --user-email or --user-id for the notebook owner.");
  process.on("SIGINT", () => {
    cancelRequested = true;
    process.stdout.write("\nCancel requested. Rolling back partial import...\n");
  });
  process.on("SIGTERM", () => {
    cancelRequested = true;
  });
  try {
    await run();
  } catch (error) {
    await rollbackImport(error);
  }
}

async function run() {
  const user = findImportUser(cliOptions);
  if (!user) throw new Error("Import owner user was not found.");
  ensureNotCanceled({ force: true });
  const absolutePath = normalizeServerPath(cliOptions.path);
  const stats = await fsp.stat(absolutePath);
  if (!stats.isFile()) throw new Error("ENEX path must point to a file.");

  await fsp.mkdir(uploadDir, { recursive: true });
  const job = {
    user_id: user.id,
    notebook_name: cliOptions.notebookName || notebookNameFromPath(absolutePath),
  };

  const notebookId = crypto.randomUUID();
  currentNotebookId = notebookId;
  execSql(`
    INSERT INTO notebooks (id, name, owner_id)
    VALUES (${sql(notebookId)}, ${sql(job.notebook_name || notebookNameFromPath(absolutePath))}, ${sql(job.user_id)});
    INSERT INTO notebook_members (notebook_id, user_id, role)
    VALUES (${sql(notebookId)}, ${sql(job.user_id)}, 'owner');
  `);

  let importedNotes = 0;
  let importedResources = 0;
  let lastProgressAt = 0;
  let progressBytes = 0;
  const noteWorkerCount = getNoteWorkerCount();
  const noteParserPool = createNoteParserPool(noteWorkerCount);

  try {
    await streamEnexNotes(absolutePath, async (noteXml, processedBytes) => {
      ensureNotCanceled();
      const note = await noteParserPool.parse(noteXml);
      ensureNotCanceled();
      const pageId = crypto.randomUUID();
      const createdAt = note.createdAt || new Date().toISOString();
      const updatedAt = note.updatedAt || createdAt;
      progressBytes = Math.max(progressBytes, processedBytes);

      const attachmentsByHash = new Map();
      for (const resource of note.resources) {
        ensureNotCanceled();
        const storageKey = await writeImportedResource(pageId, resource);
        const attachment = buildAttachment({ pageId, resource, storageKey, createdAt });
        attachmentsByHash.set(resource.hash, attachment);
        importedResources += 1;
        if (Date.now() - lastProgressAt > 750) {
          ensureNotCanceled();
          renderProgress({ processedBytes: progressBytes, totalBytes: stats.size, importedNotes, importedResources, workerCount: noteWorkerCount });
          lastProgressAt = Date.now();
        }
      }

      ensureNotCanceled();
      const { body, plainText } = enmlToEditorBody(note.body, attachmentsByHash);
      insertImportedNote({ job, notebookId, pageId, note, body, plainText, attachments: [...attachmentsByHash.values()], createdAt, updatedAt });

      importedNotes += 1;
      ensureNotCanceled();
      renderProgress({ processedBytes: progressBytes, totalBytes: stats.size, importedNotes, importedResources, workerCount: noteWorkerCount });
    }, { concurrency: noteWorkerCount });
  } finally {
    await noteParserPool.close();
  }

  ensureNotCanceled({ force: true });
  execSql(`
    UPDATE notebooks SET updated_at = datetime('now') WHERE id = ${sql(notebookId)};
  `);
  renderProgress({ processedBytes: stats.size, totalBytes: stats.size, importedNotes, importedResources, workerCount: noteWorkerCount });
  process.stdout.write(`\nImport complete.\nNotebook: ${job.notebook_name}\nNotebook ID: ${notebookId}\nPages: ${importedNotes}\nENEX resources: ${importedResources}\n`);
}

async function rollbackImport(error) {
  const canceled = error instanceof ImportCanceledError;
  const message = error instanceof Error ? error.message : "Import failed.";
  let storageKeys = [];
  try {
    storageKeys = [...new Set([...(currentNotebookId ? getNotebookStorageKeys(currentNotebookId) : []), ...createdStorageKeys])];
    execSql(`
      ${currentNotebookId ? `DELETE FROM notebooks WHERE id = ${sql(currentNotebookId)};` : ""}
    `);
    await removeStorageFiles(storageKeys);
    process.stdout.write(`\n${canceled ? "Import canceled" : "Import failed"}: ${message}\nPartial notebook and files were rolled back.\n`);
    process.exit(canceled ? 130 : 1);
  } catch (cleanupError) {
    const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : "Rollback cleanup failed.";
    process.stderr.write(`\n${message}\nRollback cleanup failed: ${cleanupMessage}\n`);
    process.exit(1);
  }
}

function ensureNotCanceled(options = {}) {
  const now = Date.now();
  if (!options.force && now - lastCancelCheckAt < 500) return;
  lastCancelCheckAt = now;
  if (cancelRequested) throw new ImportCanceledError();
}

function findImportUser(options) {
  const where = options.userId ? `id = ${sql(options.userId)}` : `lower(email) = lower(${sql(options.userEmail)})`;
  return querySql(`SELECT id, email FROM users WHERE ${where} LIMIT 1;`)[0] || null;
}

function renderProgress({ processedBytes, totalBytes, importedNotes, importedResources, workerCount }) {
  const percent = totalBytes > 0 ? Math.min(100, Math.floor((processedBytes / totalBytes) * 100)) : 0;
  const barWidth = 28;
  const filledWidth = Math.round((percent / 100) * barWidth);
  const bar = `[${"#".repeat(filledWidth)}${"-".repeat(barWidth - filledWidth)}]`;
  const line = [
    bar,
    `${percent.toString().padStart(3, " ")}%`,
    `${formatBytes(processedBytes)} / ${formatBytes(totalBytes)}`,
    `${importedNotes} pages`,
    `${importedResources} ENEX resources`,
    `${workerCount} workers`,
  ].join(" | ");
  process.stdout.write(`\r${line}`);
}

function parseCliArgs(args) {
  const options = { path: "", notebookName: "", userEmail: "", userId: "", workers: 4 };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const readValue = () => {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) failStartup(`Missing value for ${arg}.`);
      index += 1;
      return value;
    };
    if (arg === "--path") options.path = readValue();
    else if (arg === "--notebook-name") options.notebookName = readValue();
    else if (arg === "--user-email") options.userEmail = readValue();
    else if (arg === "--user-id") options.userId = readValue();
    else if (arg === "--workers") options.workers = normalizeWorkerCount(readValue());
    else if (arg === "--help" || arg === "-h") printUsageAndExit();
    else failStartup(`Unknown argument: ${arg}`);
  }
  return options;
}

function normalizeWorkerCount(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 4;
  return Math.min(parsed, 80);
}

function printUsageAndExit() {
  process.stdout.write(`Usage:
  node scripts/import-enex.mjs --path /absolute/export.enex --user-email user@example.org --notebook-name "Notebook name" --workers 16

Options:
  --path            Absolute server path to the .enex file.
  --user-email      Email of the Novo user who will own the imported notebook.
  --user-id         User ID alternative to --user-email.
  --notebook-name   Optional notebook name. Defaults to the ENEX filename.
  --workers         Parser workers for note conversion. Defaults to 4, max 80.
`);
  process.exit(0);
}

function getNotebookStorageKeys(notebookId) {
  return querySql(`
    SELECT a.storage_key
    FROM attachments a
    JOIN pages p ON p.id = a.page_id
    WHERE p.notebook_id = ${sql(notebookId)};
  `).map((row) => row.storage_key).filter(Boolean);
}

async function removeStorageFiles(storageKeys) {
  for (const storageKey of storageKeys) await removeStorageFile(storageKey);
}

async function removeStorageFile(storageKey) {
  if (!storageKey) return;
  const absoluteUploadDir = path.resolve(uploadDir);
  const absolutePath = path.resolve(uploadDir, storageKey);
  if (!absolutePath.startsWith(`${absoluteUploadDir}${path.sep}`)) return;
  await fsp.rm(absolutePath, { force: true });
  await removeEmptyParentDirs(path.dirname(absolutePath), absoluteUploadDir);
}

async function removeEmptyParentDirs(directory, stopDirectory) {
  let current = directory;
  while (current.startsWith(`${stopDirectory}${path.sep}`)) {
    try {
      await fsp.rmdir(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

function startNoteParserWorker() {
  parentPort?.on("message", (message) => {
    try {
      const note = parseNoteXml(message.noteXml);
      parentPort.postMessage({ id: message.id, note });
    } catch (error) {
      parentPort.postMessage({ id: message.id, error: error instanceof Error ? error.message : "Unable to parse ENEX note." });
    }
  });
}

function getNoteWorkerCount() {
  const raw = Number.parseInt(String(cliOptions?.workers || process.env.ENEX_IMPORT_WORKERS || "4"), 10);
  if (!Number.isFinite(raw) || raw < 1) return 4;
  return Math.min(raw, 80);
}

function createNoteParserPool(size) {
  if (size <= 1) return { parse: async (noteXml) => parseNoteXml(noteXml), close: async () => {} };

  let nextId = 1;
  const idleWorkers = [];
  const queuedJobs = [];
  const activeJobs = new Map();
  const workers = Array.from({ length: size }, () => {
    const worker = new Worker(new URL(import.meta.url), { type: "module" });
    worker.on("message", (message) => {
      const job = activeJobs.get(message.id);
      if (!job) return;
      activeJobs.delete(message.id);
      idleWorkers.push(worker);
      if (message.error) job.reject(new Error(message.error));
      else job.resolve(message.note);
      assignParserJobs();
    });
    worker.on("error", (error) => {
      for (const [id, job] of activeJobs) {
        if (job.worker === worker) {
          activeJobs.delete(id);
          job.reject(error);
        }
      }
    });
    idleWorkers.push(worker);
    return worker;
  });

  function assignParserJobs() {
    while (idleWorkers.length && queuedJobs.length) {
      const worker = idleWorkers.pop();
      const job = queuedJobs.shift();
      activeJobs.set(job.id, { ...job, worker });
      worker.postMessage({ id: job.id, noteXml: job.noteXml });
    }
  }

  return {
    parse(noteXml) {
      return new Promise((resolve, reject) => {
        queuedJobs.push({ id: nextId++, noteXml, resolve, reject });
        assignParserJobs();
      });
    },
    async close() {
      for (const job of queuedJobs.splice(0)) job.reject(new Error("ENEX parser pool closed."));
      await Promise.allSettled(workers.map((worker) => worker.terminate()));
    },
  };
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

async function streamEnexNotes(filePath, onNote, options = {}) {
  const concurrency = Math.max(1, options.concurrency || 1);
  const stream = fs.createReadStream(filePath, { encoding: "utf8", highWaterMark: 1024 * 1024 });
  let buffer = "";
  let processedBytes = 0;
  let firstError = null;
  const inFlight = new Set();

  async function enqueue(noteXml, noteProcessedBytes) {
    if (firstError) throw firstError;
    const promise = Promise.resolve()
      .then(() => onNote(noteXml, noteProcessedBytes))
      .catch((error) => { firstError ||= error; })
      .finally(() => { inFlight.delete(promise); });
    inFlight.add(promise);
    if (inFlight.size >= concurrency) {
      await Promise.race(inFlight);
      if (firstError) {
        await Promise.allSettled(inFlight);
        throw firstError;
      }
    }
  }

  for await (const chunk of stream) {
    if (firstError) break;
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
      await enqueue(noteXml, processedBytes - Buffer.byteLength(buffer));
    }
  }
  await Promise.allSettled(inFlight);
  if (firstError) throw firstError;
}

async function writeImportedResource(pageId, resource) {
  const storageKey = path.join(pageId, `${crypto.randomUUID()}-${resource.fileName}`);
  const absolutePath = path.join(uploadDir, storageKey);
  await fsp.mkdir(path.dirname(absolutePath), { recursive: true });
  await fsp.writeFile(absolutePath, resource.data);
  createdStorageKeys.add(storageKey);
  return storageKey;
}

function buildAttachment({ pageId, resource, storageKey, createdAt }) {
  const id = crypto.randomUUID();
  const blockType = inferBlockType(resource.fileName, resource.mimeType);
  return { id, pageId, originalName: resource.fileName, mimeType: resource.mimeType, size: resource.data.length, storageKey, blockType, evernoteHash: resource.hash, createdAt, updatedAt: createdAt };
}

function insertImportedNote({ job, notebookId, pageId, note, body, plainText, attachments, createdAt, updatedAt }) {
  const attachmentSql = attachments.map((attachment) => `
    INSERT INTO attachments (id, page_id, original_name, mime_type, size, storage_key, block_type, evernote_hash, created_at)
    VALUES (${sql(attachment.id)}, ${sql(pageId)}, ${sql(attachment.originalName)}, ${sql(attachment.mimeType)}, ${attachment.size}, ${sql(attachment.storageKey)}, ${sql(attachment.blockType)}, ${sql(attachment.evernoteHash || "")}, ${sql(createdAt)});
  `).join("\n");
  const tagSql = note.tags.map((tag) => `INSERT OR IGNORE INTO page_tags (page_id, tag) VALUES (${sql(pageId)}, ${sql(tag)});`).join("\n");
  execSql(`
    BEGIN IMMEDIATE;
    INSERT INTO pages (id, notebook_id, title, body, status, owner_id, created_at, updated_at)
    VALUES (${sql(pageId)}, ${sql(notebookId)}, ${sql(note.title)}, ${sql(body)}, '', ${sql(job.user_id)}, ${sql(createdAt)}, ${sql(updatedAt)});
    ${attachmentSql}
    ${tagSql}
    INSERT INTO search_pages_fts (page_id, notebook_id, title, body, tags, attachments, notebook, updated_at)
    VALUES (${sql(pageId)}, ${sql(notebookId)}, ${sql(note.title)}, ${sql(plainText)}, ${sql(note.tags.join(','))}, ${sql(attachments.map((attachment) => attachment.originalName).join(','))}, ${sql(job.notebook_name)}, ${sql(updatedAt)});
    COMMIT;
  `);
}

function enmlToEditorBody(enml, attachmentsByHash) {
  const doc = enmlToEditorDocument(enml, attachmentsByHash);
  return { body: JSON.stringify(doc), plainText: editorDocumentToPlainText(doc).trim() };
}

function attachmentNode(attachment) {
  return { type: "attachmentCard", attrs: { attachmentId: attachment.id, kind: attachment.blockType, filename: attachment.originalName, mimeType: attachment.mimeType, size: attachment.size, createdAt: attachment.createdAt, updatedAt: attachment.updatedAt } };
}

function enmlToEditorDocument(enml, attachmentsByHash) {
  try {
    const rootNodes = parseEnmlNodes(enml);
    const content = normalizeBlocks(nodesToBlocks(rootNodes, attachmentsByHash, []));
    return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
  } catch {
    const fallback = decodeXmlEntities(stripTags(cleanEnml(enml))).replace(/\s+/g, " ").trim();
    return { type: "doc", content: fallback ? [{ type: "paragraph", content: [{ type: "text", text: fallback }] }] : [{ type: "paragraph" }] };
  }
}

function parseEnmlNodes(enml) {
  const cleaned = cleanEnml(enml);
  const wrapped = /^<en-note\b/i.test(cleaned) ? cleaned : `<en-note>${cleaned}</en-note>`;
  const parsed = enmlParser.parse(wrapped);
  const root = parsed.find((node) => getNodeTag(node) === "en-note");
  return root ? getNodeChildren(root) : parsed;
}

function nodesToBlocks(nodes, attachmentsByHash, marks) {
  const blocks = [];
  let inline = [];
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
      const items = listItemsFromChildren(children, attachmentsByHash, marks);
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

function listItemsFromChildren(nodes, attachmentsByHash, marks) {
  const items = [];
  for (const node of nodes) {
    const tag = getNodeTag(node);
    if (tag === "li") {
      items.push(listItemNode(getNodeChildren(node), attachmentsByHash, marks));
      continue;
    }
    if (tag === "ul" || tag === "ol") {
      const nestedItems = listItemsFromChildren(getNodeChildren(node), attachmentsByHash, marks);
      if (!nestedItems.length) continue;
      const nestedList = { type: tag === "ul" ? "bulletList" : "orderedList", content: nestedItems };
      const previousItem = items[items.length - 1];
      if (previousItem) {
        previousItem.content = [...(previousItem.content || []), nestedList];
      } else {
        items.push({ type: "listItem", content: [{ type: "paragraph" }, nestedList] });
      }
    }
  }
  return items;
}

function nodesToInline(nodes, attachmentsByHash, marks) {
  const inline = [];
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

function listItemNode(nodes, attachmentsByHash, marks) {
  const content = normalizeBlocks(nodesToBlocks(nodes, attachmentsByHash, marks));
  return { type: "listItem", content: content.length ? ensureParagraphBlocks(content) : [{ type: "paragraph" }] };
}

function tableNode(nodes, attachmentsByHash, marks) {
  const rows = collectRows(nodes);
  const content = rows.map((row) => {
    const cells = getNodeChildren(row)
      .filter((cell) => ["td", "th"].includes(getNodeTag(cell)))
      .map((cell) => tableCellNode(cell, attachmentsByHash, marks));
    return cells.length ? { type: "tableRow", content: cells } : null;
  }).filter(Boolean);
  return content.length ? { type: "table", content } : null;
}

function tableCellNode(node, attachmentsByHash, marks) {
  const tag = getNodeTag(node);
  const attrs = getNodeAttrs(node);
  const content = normalizeBlocks(nodesToBlocks(getNodeChildren(node), attachmentsByHash, marks));
  return { type: tag === "th" ? "tableHeader" : "tableCell", attrs: { colspan: positiveInteger(attrs["@_colspan"], 1), rowspan: positiveInteger(attrs["@_rowspan"], 1), colwidth: null }, content: content.length ? ensureParagraphBlocks(content) : [{ type: "paragraph" }] };
}

function collectRows(nodes) {
  const rows = [];
  for (const node of nodes) {
    const tag = getNodeTag(node);
    if (tag === "tr") rows.push(node);
    else if (["thead", "tbody", "tfoot"].includes(tag)) rows.push(...collectRows(getNodeChildren(node)));
  }
  return rows;
}

function appendText(content, rawText, marks) {
  const text = decodeXmlEntities(rawText).replace(/[ \t\r\n\f]+/g, " ");
  if (!text.trim()) {
    if (content.length && !inlineEndsWithSpace(content)) content.push({ type: "text", text: " " });
    return;
  }
  const node = { type: "text", text };
  if (marks.length) node.marks = marks;
  content.push(node);
}

function marksForTag(tag, attrs, marks) {
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

function dedupeMarks(marks) {
  const seen = new Set();
  return marks.filter((mark) => {
    const key = `${mark.type}:${JSON.stringify(mark.attrs || {})}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeBlocks(blocks) {
  return blocks.filter((block) => block.type === "attachmentCard" || block.type === "table" || block.type === "bulletList" || block.type === "orderedList" || block.type === "blockquote" || block.content?.length);
}

function ensureParagraphBlocks(blocks) {
  return blocks.map((block) => block.type === "attachmentCard" ? { type: "paragraph", content: [{ type: "text", text: String(block.attrs?.filename || "attachment") }] } : block);
}

function normalizeInline(content) {
  const normalized = content.filter((node) => node.type !== "text" || Boolean(node.text));
  trimInlineEdge(normalized, "start");
  trimInlineEdge(normalized, "end");
  return normalized.filter((node) => node.type !== "text" || Boolean(node.text));
}

function trimInlineEdge(content, edge) {
  const index = edge === "start" ? content.findIndex((node) => node.type === "text") : findLastIndex(content, (node) => node.type === "text");
  if (index === -1) return;
  const text = content[index].text || "";
  content[index] = { ...content[index], text: edge === "start" ? text.replace(/^ +/, "") : text.replace(/ +$/, "") };
}

function findLastIndex(items, predicate) {
  for (let index = items.length - 1; index >= 0; index -= 1) if (predicate(items[index])) return index;
  return -1;
}

function inlineEndsWithSpace(content) {
  const lastText = [...content].reverse().find((node) => node.type === "text");
  return Boolean(lastText?.text?.endsWith(" "));
}

function attachmentForMedia(attrs, attachmentsByHash) {
  const hash = attrs["@_hash"] || attrs.hash;
  return hash ? attachmentsByHash.get(hash.toLowerCase()) : undefined;
}

function getNodeTag(node) {
  return Object.keys(node).find((key) => key !== ":@") || "";
}

function getNodeChildren(node) {
  const tag = getNodeTag(node);
  const value = node[tag];
  return Array.isArray(value) ? value : [];
}

function getNodeAttrs(node) {
  return node[":@"] || {};
}

function isInlineTag(tag) {
  return ["a", "b", "strong", "i", "em", "u", "s", "strike", "del", "code", "span", "font"].includes(tag);
}

function hasBlockChildren(nodes) {
  return nodes.some((node) => isBlockTag(getNodeTag(node)));
}

function isBlockTag(tag) {
  return tag === "en-media" || tag === "table" || tag === "ul" || tag === "ol" || tag === "blockquote" || tag === "div" || tag === "p" || /^h[1-6]$/.test(tag);
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function cleanEnml(enml) {
  return unwrapCdata(enml).replace(/<\?xml[^>]*>/gi, "").replace(/<!DOCTYPE[^>]*>/gi, "").trim();
}

function editorDocumentToPlainText(node) {
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "attachmentCard") return `[${String(node.attrs?.kind || "File")}: ${String(node.attrs?.filename || "attachment")}]\n`;
  const childText = node.content?.map(editorDocumentToPlainText).join("") || "";
  if (["paragraph", "heading", "blockquote", "listItem", "tableCell", "tableHeader"].includes(node.type || "")) return `${childText}\n`;
  return childText;
}

function execSql(statement) {
  execFileSync("sqlite3", [databasePath, "-batch"], { input: `.timeout 30000\nPRAGMA foreign_keys=ON;\n${statement}`, stdio: ["pipe", "pipe", "pipe"] });
}

function querySql(statement) {
  const output = execFileSync("sqlite3", [databasePath, "-batch", "-header", "-csv"], { input: `.timeout 30000\nPRAGMA foreign_keys=ON;\n${statement}`, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
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
function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}
function textValue(value) { if (value === null || value === undefined) return ""; if (typeof value === "string" || typeof value === "number") return String(value); if (typeof value === "object") { if ("__cdata" in value) return textValue(value.__cdata); if ("#text" in value) return textValue(value["#text"]); } return ""; }
function toArray(value) { if (!value) return []; return Array.isArray(value) ? value : [value]; }
function normalizeServerPath(filePath) { const trimmed = String(filePath || "").trim(); if (!path.isAbsolute(trimmed)) throw new Error("Use an absolute server path."); if (!/\.enex$/i.test(trimmed)) throw new Error("Path must point to an .enex file."); return trimmed; }
function notebookNameFromPath(filePath) { return path.basename(filePath).replace(/\.enex$/i, "") || "Evernote Import"; }
function normalizeEvernoteDate(value) { const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/); return match ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.000Z` : undefined; }
function unwrapCdata(value) { return value.replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, ""); }
function stripTags(value) { return value.replace(/<[^>]+>/g, ""); }
function decodeXmlEntities(value) { return value.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'"); }
function inferBlockType(name, mimeType) { const lower = name.toLowerCase(); const lowerMime = mimeType.toLowerCase(); if (lowerMime.startsWith("image/") || /\.(png|jpe?g|gif|tiff?|webp|svg)$/.test(lower)) return "image"; if (lowerMime === "application/pdf" || /\.pdf$/.test(lower)) return "pdf"; if (lowerMime.includes("spreadsheet") || lowerMime.includes("excel") || lowerMime === "text/csv" || /\.(xlsx?|xlsb|csv|tsv|ods)$/.test(lower)) return "sheet"; if (lowerMime.includes("presentation") || lowerMime.includes("powerpoint") || /\.(pptx?|ppsx?|odp|key)$/.test(lower)) return "slides"; if (/\.(gb|gbk|fasta|fa|fna|fastq|fq|dna|seq|ab1)$/.test(lower)) return "sequence"; return "file"; }
function extensionForMime(mimeType) { if (mimeType === "application/pdf") return ".pdf"; if (mimeType === "image/png") return ".png"; if (mimeType === "image/jpeg") return ".jpg"; if (mimeType === "image/tiff") return ".tif"; if (mimeType.includes("spreadsheet")) return ".xlsx"; if (mimeType.includes("presentation")) return ".pptx"; if (mimeType === "text/plain") return ".txt"; return ".bin"; }
function sanitizeFileName(name) { return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "attachment.bin"; }
function failStartup(message) { console.error(message); process.exit(1); }
