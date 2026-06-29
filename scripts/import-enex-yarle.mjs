import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { marked } from "marked";

const cwd = process.cwd();
const databasePath = process.env.ELN_DATABASE_PATH || path.join(cwd, "data", "eln.sqlite3");
const uploadDir = process.env.ELN_UPLOAD_DIR || path.join(cwd, "storage", "uploads");
const previewDir = process.env.ELN_PREVIEW_DIR || path.join(cwd, "storage", "previews");
const createdStorageKeys = new Set();
let currentNotebookId = "";

const options = parseArgs(process.argv.slice(2));
if (!options.path) failStartup("Missing --path /absolute/path/to/export.enex.");
if (!options.userEmail && !options.userId) failStartup("Provide --user-email or --user-id for the notebook owner.");

process.on("SIGINT", () => process.exit(130));

try {
  await run();
} catch (error) {
  await rollback(error);
}

async function run() {
  const user = findImportUser(options);
  if (!user) throw new Error("Import owner user was not found.");
  const enexPath = normalizeServerPath(options.path);
  const stats = await fsp.stat(enexPath);
  if (!stats.isFile()) throw new Error("ENEX path must point to a file.");
  await fsp.mkdir(uploadDir, { recursive: true });
  await fsp.mkdir(previewDir, { recursive: true });
  ensureImportColumns();

  const notebookName = options.notebookName || notebookNameFromPath(enexPath);
  const enexSha256 = await hashFile(enexPath, "sha256");
  const existingImport = querySql(`SELECT notebook_id, count(*) AS page_count FROM pages WHERE import_source_hash = ${sql(enexSha256)} GROUP BY notebook_id LIMIT 1;`)[0];
  if (existingImport) {
    process.stdout.write(`Skipping duplicate ENEX source hash. Existing notebook ID: ${existingImport.notebook_id}; pages: ${existingImport.page_count}.\n`);
    return;
  }
  const workDir = options.workDir || path.join(os.tmpdir(), `novo-yarle-${Date.now()}-${crypto.randomUUID()}`);
  const outputDir = path.join(workDir, "yarle-output");
  await fsp.rm(workDir, { recursive: true, force: true });
  await fsp.mkdir(outputDir, { recursive: true });

  const templatePath = path.join(workDir, "novo-yarle-template.tmpl");
  const configPath = path.join(workDir, "novo-yarle-config.json");
  await fsp.writeFile(templatePath, yarleTemplate());
  await fsp.writeFile(configPath, JSON.stringify(yarleConfig({ enexPath, templatePath, outputDir }), null, 2));

  process.stdout.write(`Running Yarle conversion for ${path.basename(enexPath)}...\n`);
  await runYarle(configPath);

  const markdownFiles = (await listFiles(outputDir)).filter((file) => file.toLowerCase().endsWith(".md"));
  if (!markdownFiles.length) throw new Error("Yarle produced no Markdown files.");
  markdownFiles.sort((a, b) => a.localeCompare(b));

  const notebookId = crypto.randomUUID();
  currentNotebookId = notebookId;
  execSql(`
    BEGIN IMMEDIATE;
    INSERT INTO notebooks (id, name, owner_id)
    VALUES (${sql(notebookId)}, ${sql(notebookName)}, ${sql(user.id)});
    INSERT INTO notebook_members (notebook_id, user_id, role)
    VALUES (${sql(notebookId)}, ${sql(user.id)}, 'owner');
    COMMIT;
  `);

  let importedPages = 0;
  let importedAttachments = 0;
  for (const markdownPath of markdownFiles) {
    const result = await importMarkdownPage({ markdownPath, notebookId, notebookName, userId: user.id, enexPath, enexSha256 });
    importedPages += 1;
    importedAttachments += result.attachmentCount;
    renderProgress({ importedPages, totalPages: markdownFiles.length, importedAttachments });
  }

  execSql(`UPDATE notebooks SET updated_at = datetime('now') WHERE id = ${sql(notebookId)};`);
  renderProgress({ importedPages, totalPages: markdownFiles.length, importedAttachments });
  process.stdout.write(`\nImport complete.\nNotebook: ${notebookName}\nNotebook ID: ${notebookId}\nPages: ${importedPages}\nAttachments: ${importedAttachments}\nSource SHA256: ${enexSha256}\n`);
  if (options.keepWorkDir) process.stdout.write(`Yarle work dir kept at ${workDir}\n`);
  else await fsp.rm(workDir, { recursive: true, force: true });
}

async function importMarkdownPage({ markdownPath, notebookId, notebookName, userId, enexPath, enexSha256 }) {
  const rawMarkdown = await fsp.readFile(markdownPath, "utf8");
  const metadata = extractNovoMetadata(rawMarkdown);
  const markdown = stripNovoMetadata(rawMarkdown).trim();
  const pageId = crypto.randomUUID();
  const context = { pageId, outputRoot: path.dirname(path.dirname(markdownPath)), markdownPath, attachmentsByPath: new Map() };
  const doc = await markdownToEditorDocument(markdown, context);
  const title = metadata.title || path.basename(markdownPath, ".md") || "Untitled Evernote note";
  const tags = metadata.tags;
  const body = JSON.stringify(doc);
  const plainText = editorDocumentToPlainText(doc).trim();
  const noteHash = crypto.createHash("sha256").update(rawMarkdown).digest("hex");
  const createdAt = normalizeDate(metadata.createdAt) || new Date().toISOString();
  const updatedAt = normalizeDate(metadata.updatedAt) || createdAt;
  const attachments = [...context.attachmentsByPath.values()];
  const attachmentSql = attachments.map((attachment) => `
    INSERT INTO attachments (id, page_id, original_name, mime_type, size, storage_key, block_type, evernote_hash, created_at)
    VALUES (${sql(attachment.id)}, ${sql(pageId)}, ${sql(attachment.originalName)}, ${sql(attachment.mimeType)}, ${attachment.size}, ${sql(attachment.storageKey)}, ${sql(attachment.blockType)}, ${sql(attachment.evernoteHash)}, ${sql(createdAt)});
  `).join("\n");
  const tagSql = pageTagInsertSql(pageId, tags);
  execSql(`
    BEGIN IMMEDIATE;
    INSERT INTO pages (id, notebook_id, title, body, preview_text, status, owner_id, created_at, updated_at, import_source_path, import_source_hash, import_note_hash)
    VALUES (${sql(pageId)}, ${sql(notebookId)}, ${sql(title)}, ${sql(body)}, '', '', ${sql(userId)}, ${sql(createdAt)}, ${sql(updatedAt)}, ${sql(enexPath)}, ${sql(enexSha256)}, ${sql(noteHash)});
    ${attachmentSql}
    ${tagSql}
    INSERT INTO search_pages_fts (page_id, notebook_id, title, body, tags, attachments, notebook, updated_at)
    VALUES (${sql(pageId)}, ${sql(notebookId)}, ${sql(title)}, ${sql(plainText)}, ${sql(tags.join(','))}, ${sql(attachments.map((attachment) => attachment.originalName).join(','))}, ${sql(notebookName)}, ${sql(updatedAt)});
    COMMIT;
  `);
  return { attachmentCount: attachments.length };
}

function extractNovoMetadata(markdown) {
  return {
    title: captureComment(markdown, "novo-title"),
    createdAt: captureComment(markdown, "novo-created-at"),
    updatedAt: captureComment(markdown, "novo-updated-at"),
    tags: parseTags(captureComment(markdown, "novo-tags-json")),
  };
}

function captureComment(markdown, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`<!--\\s*${escapedKey}:\\s*([\\s\\S]*?)\\s*-->`, "i"));
  return match ? match[1].trim() : "";
}

function stripNovoMetadata(markdown) {
  return markdown.replace(/<!--\s*novo-[\w-]+:\s*[\s\S]*?\s*-->\s*/gi, "");
}

function parseTags(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map((tag) => String(tag).trim()).filter(Boolean);
  } catch {}
  return value.split(/[,#]/).map((tag) => tag.trim()).filter(Boolean);
}

async function markdownToEditorDocument(markdown, context) {
  const tokens = marked.lexer(markdown, { gfm: true, breaks: false });
  const content = await tokensToBlocks(tokens, context);
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

async function tokensToBlocks(tokens, context) {
  const blocks = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === "space") {
      if (shouldPreserveMarkdownSpacer(token, blocks, tokens, index)) blocks.push({ type: "paragraph" });
      continue;
    }
    if (token.type === "heading") {
      blocks.push({ type: "heading", attrs: { level: Math.min(Math.max(Number(token.depth) || 1, 1), 2) }, content: inlineTokensToContent(token.tokens || [{ type: "text", text: token.text || "" }], []) });
      continue;
    }
    if (token.type === "paragraph" || token.type === "text") {
      blocks.push(...await paragraphToBlocks(token.tokens || [{ type: "text", text: token.text || token.raw || "" }], context));
      continue;
    }
    if (token.type === "list") {
      blocks.push(await listNode(token, context));
      continue;
    }
    if (token.type === "blockquote") {
      const children = await tokensToBlocks(token.tokens || [], context);
      blocks.push({ type: "blockquote", content: children.length ? ensureParagraphBlocks(children) : [{ type: "paragraph" }] });
      continue;
    }
    if (token.type === "code") {
      blocks.push({ type: "codeBlock", content: token.text ? [{ type: "text", text: token.text }] : undefined });
      continue;
    }
    if (token.type === "table") {
      blocks.push(tableNode(token));
      continue;
    }
    if (token.type === "hr") {
      blocks.push({ type: "paragraph" });
      continue;
    }
    if (token.type === "html") {
      const text = stripHtml(token.text || token.raw || "").trim();
      if (text) blocks.push({ type: "paragraph", content: [{ type: "text", text }] });
    }
  }
  return blocks.filter((block) => block.type === "attachmentCard" || block.type === "table" || block.type === "bulletList" || block.type === "orderedList" || block.type === "blockquote" || block.content?.length || block.type === "paragraph");
}

function shouldPreserveMarkdownSpacer(token, blocks, tokens, index) {
  if (!blocks.length) return false;
  const newlineCount = (String(token.raw || "").match(/\n/g) || []).length;
  if (newlineCount < 3) return false;
  return tokens.slice(index + 1).some((nextToken) => nextToken.type !== "space");
}

async function paragraphToBlocks(tokens, context) {
  const blocks = [];
  let inline = [];
  const flush = () => {
    const content = normalizeInline(inline);
    if (content.length) blocks.push({ type: "paragraph", content });
    inline = [];
  };
  for (const token of tokens) {
    const localAttachment = await attachmentForInlineToken(token, context);
    if (localAttachment) {
      flush();
      blocks.push(attachmentNode(localAttachment));
      continue;
    }
    if (token.type === "text") {
      const segments = await localAttachmentSegmentsFromText(token.text || token.raw || "", context);
      if (segments) {
        for (const segment of segments) {
          if (segment.type === "attachment") {
            flush();
            blocks.push(attachmentNode(segment.attachment));
          } else {
            inline.push(...textNode(segment.text, []));
          }
        }
        continue;
      }
    }
    inline.push(...inlineTokenToContent(token, []));
  }
  flush();
  return blocks.length ? blocks : [{ type: "paragraph" }];
}

async function listNode(token, context) {
  const items = [];
  for (const item of token.items || []) {
    const itemBlocks = await tokensToBlocks(item.tokens || [], context);
    items.push({ type: "listItem", content: sanitizeListItemBlocks(itemBlocks) });
  }
  const node = { type: token.ordered ? "orderedList" : "bulletList", content: items };
  if (token.ordered && Number(token.start) > 1) node.attrs = { start: Number(token.start) };
  return node;
}

function sanitizeListItemBlocks(blocks) {
  if (!blocks.length) return [{ type: "paragraph" }];
  return ensureParagraphBlocks(blocks.map((block) => {
    if (block.type !== "attachmentCard") return block;
    return { type: "paragraph", content: [{ type: "text", text: `[${String(block.attrs?.filename || "attachment")}]` }] };
  }));
}

function ensureParagraphBlocks(blocks) {
  if (!blocks.length || blocks[0].type !== "paragraph") return [{ type: "paragraph" }, ...blocks];
  return blocks;
}

function inlineTokensToContent(tokens, marks) {
  return normalizeInline(tokens.flatMap((token) => inlineTokenToContent(token, marks)));
}

function inlineTokenToContent(token, marks) {
  if (!token) return [];
  if (token.type === "strong") return inlineTokensToContent(token.tokens || [{ type: "text", text: token.text || "" }], [...marks, { type: "bold" }]);
  if (token.type === "em") return inlineTokensToContent(token.tokens || [{ type: "text", text: token.text || "" }], [...marks, { type: "italic" }]);
  if (token.type === "del") return inlineTokensToContent(token.tokens || [{ type: "text", text: token.text || "" }], [...marks, { type: "strike" }]);
  if (token.type === "codespan") return textNode(token.text || "", [...marks, { type: "code" }]);
  if (token.type === "br") return [{ type: "hardBreak" }];
  if (token.type === "link") return inlineTokensToContent(token.tokens || [{ type: "text", text: token.text || token.href || "" }], token.href ? [...marks, { type: "link", attrs: { href: token.href } }] : marks);
  if (token.type === "image") return textNode(token.text || path.basename(token.href || "image"), marks);
  if (token.type === "html") return stripHtml(token.text || token.raw || "") ? textNode(stripHtml(token.text || token.raw || ""), marks) : [];
  if (token.type === "text" && isEmptyMarkdownEmphasisArtifact(token.text || token.raw || "")) return [];
  return textNode(token.text || token.raw || "", marks);
}

function isEmptyMarkdownEmphasisArtifact(value) {
  const lines = String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length || lines.length % 2 !== 0) return false;
  for (let index = 0; index < lines.length; index += 2) {
    const opener = lines[index];
    const closer = lines[index + 1];
    if (opener !== closer || !["**", "__", "*", "_", "***", "___"].includes(opener)) return false;
  }
  return true;
}

function textNode(text, marks) {
  if (!text) return [];
  const node = { type: "text", text };
  if (marks.length) node.marks = dedupeMarks(marks);
  return [node];
}

async function attachmentForInlineToken(token, context) {
  if (!token || !["image", "link"].includes(token.type)) return null;
  return attachmentForHref(token.href || "", context);
}

async function localAttachmentSegmentsFromText(text, context) {
  const source = String(text || "");
  const matches = findLocalMarkdownResourceLinks(source);
  const segments = [];
  let foundAttachment = false;
  let cursor = 0;
  for (const match of matches) {
    const attachment = await attachmentForHref(match.href, context);
    if (!attachment) continue;
    if (match.start > cursor) segments.push({ type: "text", text: source.slice(cursor, match.start) });
    segments.push({ type: "attachment", attachment });
    cursor = match.end;
    foundAttachment = true;
  }
  if (!foundAttachment) return null;
  if (cursor < source.length) segments.push({ type: "text", text: source.slice(cursor) });
  return segments;
}

function findLocalMarkdownResourceLinks(source) {
  const matches = [];
  let index = 0;
  while (index < source.length) {
    const labelStart = source.indexOf("[", index);
    if (labelStart === -1) break;
    const imageStart = labelStart > 0 && source[labelStart - 1] === "!" ? labelStart - 1 : labelStart;
    const labelEnd = findClosingBracket(source, labelStart, "[", "]");
    if (labelEnd === -1 || source[labelEnd + 1] !== "(") {
      index = labelStart + 1;
      continue;
    }
    const hrefStart = labelEnd + 2;
    const hrefEnd = findClosingBracket(source, hrefStart - 1, "(", ")");
    if (hrefEnd === -1) {
      index = labelStart + 1;
      continue;
    }
    matches.push({ start: imageStart, end: hrefEnd + 1, href: source.slice(hrefStart, hrefEnd).trim() });
    index = hrefEnd + 1;
  }
  return matches;
}

function findClosingBracket(source, openIndex, openChar, closeChar) {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === openChar) depth += 1;
    if (character === closeChar) {
      depth -= 1;
      if (depth === 0) return index;
    }
    if (character === "\n") return -1;
  }
  return -1;
}

async function attachmentForHref(href, context) {
  href = String(href || "");
  const sourcePath = resolveLocalResourcePath(href, context.markdownPath, context.outputRoot);
  if (!sourcePath) return null;
  if (context.attachmentsByPath.has(sourcePath)) return context.attachmentsByPath.get(sourcePath);
  const stat = await fsp.stat(sourcePath).catch(() => null);
  if (!stat?.isFile()) return null;
  const originalName = safeFileName(path.basename(sourcePath));
  const storageKey = path.join(context.pageId, `${crypto.randomUUID()}-${originalName}`);
  const destination = path.join(uploadDir, storageKey);
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  await fsp.copyFile(sourcePath, destination);
  createdStorageKeys.add(storageKey);
  const mimeType = inferMimeType(originalName);
  const attachment = {
    id: crypto.randomUUID(),
    pageId: context.pageId,
    originalName,
    mimeType,
    size: stat.size,
    storageKey,
    blockType: inferBlockType(originalName, mimeType),
    evernoteHash: await hashFile(sourcePath, "md5"),
    createdAt: new Date().toISOString(),
  };
  context.attachmentsByPath.set(sourcePath, attachment);
  return attachment;
}

function resolveLocalResourcePath(href, markdownPath, outputRoot) {
  const cleanHref = href.replace(/^file:\/\//i, "").split("#")[0].split("?")[0];
  if (!cleanHref || /^(https?:|mailto:|evernote:|#)/i.test(cleanHref)) return null;
  let decoded = cleanHref;
  try { decoded = decodeURIComponent(cleanHref); } catch {}
  const root = path.resolve(outputRoot);
  const normalized = decoded.replace(/^\.\/+/, "");
  const candidates = [
    path.resolve(path.dirname(markdownPath), decoded),
    path.resolve(root, normalized),
    path.resolve(root, decoded),
  ];
  const validCandidates = [...new Set(candidates)].filter((candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`));
  return validCandidates.find((candidate) => fs.existsSync(candidate)) || validCandidates[0] || null;
}

function tableNode(token) {
  const rows = [];
  if (Array.isArray(token.header) && token.header.length) rows.push(tableRow(token.header, true));
  for (const row of token.rows || []) rows.push(tableRow(row, false));
  return { type: "table", content: rows.length ? rows : [{ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph" }] }] }] };
}

function tableRow(cells, header) {
  return { type: "tableRow", content: cells.map((cell) => ({ type: header ? "tableHeader" : "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: "paragraph", content: inlineTokensToContent(cell.tokens || [{ type: "text", text: cell.text || "" }], []) }] })) };
}

function normalizeInline(content) {
  const normalized = [];
  for (const node of content) {
    if (node.type === "text" && !node.text) continue;
    const previous = normalized[normalized.length - 1];
    if (node.type === "text" && previous?.type === "text" && JSON.stringify(previous.marks || []) === JSON.stringify(node.marks || [])) previous.text += node.text;
    else normalized.push(node);
  }
  return normalized;
}

function attachmentNode(attachment) {
  return { type: "attachmentCard", attrs: { attachmentId: attachment.id, kind: attachment.blockType, filename: attachment.originalName, mimeType: attachment.mimeType, size: attachment.size, createdAt: attachment.createdAt, updatedAt: attachment.createdAt } };
}

function editorDocumentToPlainText(node) {
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "attachmentCard") return `[${String(node.attrs?.kind || "File")}: ${String(node.attrs?.filename || "attachment")}]\n`;
  const childText = node.content?.map(editorDocumentToPlainText).join("") || "";
  if (["paragraph", "heading", "blockquote", "listItem", "tableCell", "tableHeader"].includes(node.type || "")) return `${childText}\n`;
  return childText;
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

function stripHtml(value) {
  return String(value || "").replace(/<!--[\s\S]*?-->/g, "").replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function yarleTemplate() {
  return `{title-block}<!-- novo-title: {title} -->{end-title-block}
{created-at-block}<!-- novo-created-at: {created-at} -->{end-created-at-block}
{updated-at-block}<!-- novo-updated-at: {updated-at} -->{end-updated-at-block}
{tags-array-block}<!-- novo-tags-json: {tags-array} -->{end-tags-array-block}

{content-block}{content}{end-content-block}
`;
}

function yarleConfig({ enexPath, templatePath, outputDir }) {
  return {
    enexSources: [enexPath],
    templateFile: templatePath,
    outputDir,
    skipWebClips: false,
    useHashTags: false,
    outputFormat: "StandardMD",
    taskOutputFormat: "StandardMD",
    urlEncodeFileNamesAndLinks: false,
    skipEnexFileNameFromOutputPath: true,
    keepOriginalAmountOfNewlines: true,
    convertPlainHtmlNewlines: true,
    resourcesDir: "_resources",
    haveEnexLevelResources: true,
    haveGlobalResources: false,
    useUniqueUnknownFileNames: true,
    sanitizeResourceNameSpaces: false,
    keepMDCharactersOfENNotes: false,
    monospaceIsCodeBlock: false,
    dateFormat: "YYYY-MM-DD HH:mm:ss",
    replacementCharacterMap: { "<": "_", ">": "_", ":": "_", "\"": "_", "/": "_", "\\": "_", "|": "_", "?": "_", "*": "_" },
    nestedTags: { separatorInEN: "_", replaceSeparatorWith: "/", replaceSpaceWith: "-" },
  };
}

async function runYarle(configPath) {
  const yarleEntry = path.join(cwd, "node_modules", "yarle-evernote-to-md", "dist", "dropTheRope.js");
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--max-old-space-size=4096", yarleEntry, "--configFile", configPath], {
      stdio: "inherit",
      env: { ...process.env, npm_config_update_notifier: "false" },
    });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Yarle exited with code ${code}`)));
  });
}

async function rollback(error) {
  const message = error instanceof Error ? error.message : String(error);
  try {
    if (currentNotebookId) execSql(`DELETE FROM notebooks WHERE id = ${sql(currentNotebookId)};`);
    for (const storageKey of createdStorageKeys) await removeStorageFile(storageKey);
    process.stderr.write(`\nImport failed: ${message}\nPartial notebook and files were rolled back.\n`);
  } catch (cleanupError) {
    process.stderr.write(`\nImport failed: ${message}\nRollback cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}\n`);
  }
  process.exit(1);
}

function ensureImportColumns() {
  const columns = new Set(querySql("PRAGMA table_info(pages);").map((row) => row.name));
  if (!columns.has("import_source_path")) execSql("ALTER TABLE pages ADD COLUMN import_source_path TEXT NOT NULL DEFAULT '';");
  if (!columns.has("import_source_hash")) execSql("ALTER TABLE pages ADD COLUMN import_source_hash TEXT NOT NULL DEFAULT '';");
  if (!columns.has("import_note_hash")) execSql("ALTER TABLE pages ADD COLUMN import_note_hash TEXT NOT NULL DEFAULT '';");
}

function findImportUser(parsedOptions) {
  const where = parsedOptions.userId ? `id = ${sql(parsedOptions.userId)}` : `lower(email) = lower(${sql(parsedOptions.userEmail)})`;
  return querySql(`SELECT id, email FROM users WHERE ${where} LIMIT 1;`)[0] || null;
}

function renderProgress({ importedPages, totalPages, importedAttachments }) {
  const percent = totalPages > 0 ? Math.floor((importedPages / totalPages) * 100) : 0;
  const barWidth = 28;
  const filledWidth = Math.round((percent / 100) * barWidth);
  const bar = `[${"#".repeat(filledWidth)}${"-".repeat(barWidth - filledWidth)}]`;
  process.stdout.write(`\r${bar} | ${String(percent).padStart(3, " ")}% | ${importedPages} / ${totalPages} pages | ${importedAttachments} attachments`);
}

function parseArgs(args) {
  const parsed = { path: "", notebookName: "", userEmail: "", userId: "", workDir: "", keepWorkDir: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const read = () => {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) failStartup(`Missing value for ${arg}.`);
      index += 1;
      return value;
    };
    if (arg === "--path") parsed.path = read();
    else if (arg === "--notebook-name") parsed.notebookName = read();
    else if (arg === "--user-email") parsed.userEmail = read();
    else if (arg === "--user-id") parsed.userId = read();
    else if (arg === "--work-dir") parsed.workDir = read();
    else if (arg === "--keep-work-dir") parsed.keepWorkDir = true;
    else if (arg === "--workers") index += 1;
    else if (arg === "--help" || arg === "-h") usage();
    else failStartup(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function usage() {
  process.stdout.write(`Usage:
  node scripts/import-enex-yarle.mjs --path /absolute/export.enex --user-email user@example.org --notebook-name "Notebook name"

This importer runs Yarle first, then imports the generated Markdown/resources into Novo.
`);
  process.exit(0);
}

function execSql(statement) {
  execFileSync("sqlite3", ["-batch", databasePath], { input: `.timeout 30000\n.bail on\nPRAGMA foreign_keys=ON;\n${statement}`, stdio: ["pipe", "pipe", "pipe"], maxBuffer: 512 * 1024 * 1024 });
}

function querySql(statement) {
  const output = execFileSync("sqlite3", ["-batch", databasePath], { input: `.timeout 30000\n.bail on\n.headers on\n.mode csv\nPRAGMA foreign_keys=ON;\n${statement}`, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 512 * 1024 * 1024 });
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
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (char !== "\r") field += char;
  }
  row.push(field);
  rows.push(row);
  return rows;
}

async function listFiles(directory) {
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(filePath));
    else files.push(filePath);
  }
  return files;
}

async function removeStorageFile(storageKey) {
  const absoluteUploadDir = path.resolve(uploadDir);
  const absolutePath = path.resolve(uploadDir, storageKey);
  if (!absolutePath.startsWith(`${absoluteUploadDir}${path.sep}`)) return;
  await fsp.rm(absolutePath, { force: true });
}

async function hashFile(filePath, algorithm) {
  const hash = crypto.createHash(algorithm);
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

function normalizeDate(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) return trimmed;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function normalizeServerPath(filePath) {
  const trimmed = String(filePath || "").trim();
  if (!path.isAbsolute(trimmed)) throw new Error("Use an absolute server path.");
  if (!/\.enex$/i.test(trimmed)) throw new Error("Path must point to an .enex file.");
  return trimmed;
}

function notebookNameFromPath(filePath) {
  return path.basename(filePath).replace(/\.enex$/i, "") || "Evernote Import";
}

function inferMimeType(name) {
  const lower = name.toLowerCase();
  if (/\.pdf$/.test(lower)) return "application/pdf";
  if (/\.png$/.test(lower)) return "image/png";
  if (/\.jpe?g$/.test(lower)) return "image/jpeg";
  if (/\.gif$/.test(lower)) return "image/gif";
  if (/\.tiff?$/.test(lower)) return "image/tiff";
  if (/\.webp$/.test(lower)) return "image/webp";
  if (/\.xlsx$/.test(lower)) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (/\.xls$/.test(lower)) return "application/vnd.ms-excel";
  if (/\.csv$/.test(lower)) return "text/csv";
  if (/\.pptx$/.test(lower)) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (/\.ppt$/.test(lower)) return "application/vnd.ms-powerpoint";
  if (/\.txt$/.test(lower)) return "text/plain";
  return "application/octet-stream";
}

function inferBlockType(name, mimeType) {
  const lower = name.toLowerCase();
  const lowerMime = mimeType.toLowerCase();
  if (lowerMime.startsWith("image/") || /\.(png|jpe?g|gif|tiff?|webp|svg)$/.test(lower)) return "image";
  if (lowerMime === "application/pdf" || /\.pdf$/.test(lower)) return "pdf";
  if (lowerMime.includes("spreadsheet") || lowerMime.includes("excel") || lowerMime === "text/csv" || /\.(xlsx?|xlsb|csv|tsv|ods)$/.test(lower)) return "sheet";
  if (lowerMime.includes("presentation") || lowerMime.includes("powerpoint") || /\.(pptx?|ppsx?|odp|key)$/.test(lower)) return "slides";
  if (/\.(gb|gbk|fasta|fa|fna|fastq|fq|dna|seq|ab1)$/.test(lower)) return "sequence";
  return "file";
}

function safeFileName(name) {
  return String(name || "attachment.bin").replace(/[^a-zA-Z0-9._ -]/g, "_").replace(/\s+/g, "_").slice(0, 140) || "attachment.bin";
}

function sql(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function pageTagInsertSql(pageId, tags) {
  return tags.map((tag) => `
    INSERT OR IGNORE INTO tags (id, label)
    VALUES (${sql(crypto.randomUUID())}, ${sql(tag)});

    INSERT OR IGNORE INTO page_tags (page_id, tag_id)
    SELECT ${sql(pageId)}, id
    FROM tags
    WHERE label = ${sql(tag)} COLLATE NOCASE
    LIMIT 1;
  `).join("\n");
}

function failStartup(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
