import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { XMLParser } from "fast-xml-parser";

const options = parseArgs(process.argv.slice(2));
if (!options.report) fail("Missing --report /path/to/nested-list-loss-report.json.");

const databasePath = options.database || process.env.ELN_DATABASE_PATH || "/app-data/data/eln.sqlite3";
const uploadDir = options.uploadDir || process.env.ELN_UPLOAD_DIR || "/app-data/uploads";
const reportDir = options.reportDir || "/app-data/enex-repair-reports";
const applyChanges = Boolean(options.apply);
const startedAt = new Date();

const enmlParser = new XMLParser({
  ignoreAttributes: false,
  preserveOrder: true,
  trimValues: false,
  cdataPropName: "__cdata",
  textNodeName: "#text",
});

const report = JSON.parse(fs.readFileSync(options.report, "utf8"));
const actor = options.actorEmail ? loadActor(options.actorEmail) : null;
const candidates = report.findings
  .filter((finding) => finding.classification === "safe_auto_repair")
  .filter((finding) => !options.pageId || finding.page?.id === options.pageId)
  .slice(0, options.limit || undefined);

if (applyChanges && !actor) {
  fail("Applying repairs requires --actor-email so the audit trail is attributable.");
}

process.stdout.write(`Mode: ${applyChanges ? "apply" : "dry-run"}\n`);
process.stdout.write(`Database: ${databasePath}\n`);
process.stdout.write(`Upload directory: ${uploadDir}\n`);
process.stdout.write(`Report: ${options.report}\n`);
process.stdout.write(`Candidates: ${candidates.length}\n`);

const pageIds = candidates.map((finding) => finding.page?.id).filter(Boolean);
const pages = loadPages(pageIds);
const tagsByPage = loadPageTags(pageIds);
const attachmentsByPage = loadPageAttachments(pageIds);
const findingsBySourceAndTitle = groupFindingsBySourceAndTitle(candidates);
const results = [];
let processed = 0;

for (const [sourceFile, titleMap] of findingsBySourceAndTitle) {
  if (!fs.existsSync(sourceFile)) {
    for (const findings of titleMap.values()) {
      for (const finding of findings) {
        results.push(skipped(finding, "source ENEX file was not found"));
      }
    }
    continue;
  }

  process.stdout.write(`Scanning ${sourceFile}\n`);
  await streamEnexNotes(sourceFile, async (noteXml) => {
    const title = extractTagText(noteXml, "title") || "Untitled Evernote note";
    const key = normalizeKey(title);
    const findings = titleMap.get(key);
    if (!findings?.length) return;

    const enml = extractTagInnerXml(noteXml, "content");
    if (!enml) {
      for (const finding of findings) results.push(skipped(finding, "source note has no ENML content"));
      return;
    }

    for (const finding of findings) {
      processed += 1;
      const result = await repairFinding(finding, enml);
      results.push(result);
      if (processed % 25 === 0) {
        process.stdout.write(`Processed ${processed}/${candidates.length} candidates\n`);
      }
    }
  });
}

const seenPageIds = new Set(results.map((result) => result.pageId).filter(Boolean));
for (const finding of candidates) {
  if (!seenPageIds.has(finding.page?.id)) {
    results.push(skipped(finding, "matching source note was not found in ENEX file"));
  }
}

const summary = {
  generatedAt: startedAt.toISOString(),
  mode: applyChanges ? "apply" : "dry-run",
  report: options.report,
  databasePath,
  candidates: candidates.length,
  results: countBy(results, "status"),
};

await fsp.mkdir(reportDir, { recursive: true });
const outputPath = path.join(reportDir, `nested-list-apply-${timestampForFile(startedAt)}.json`);
await fsp.writeFile(outputPath, JSON.stringify({ summary, results }, null, 2));

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`Apply report: ${outputPath}\n`);

async function repairFinding(finding, enml) {
  const pageId = finding.page?.id;
  const page = pages.get(pageId);
  if (!page) return skipped(finding, "page no longer exists");
  if (page.bodyEditCount > 0) return skipped(finding, "page now has body edit audit events");

  const attachments = attachmentsByPage.get(pageId) ?? [];
  const attachmentHashResult = await buildAttachmentHashMap(attachments);
  if (attachmentHashResult.errors.length) {
    return skipped(finding, attachmentHashResult.errors.join("; "));
  }

  const requiredMediaHashes = mediaHashesFromEnml(enml);
  const missingHashes = requiredMediaHashes.filter((hash) => !attachmentHashResult.attachmentsByHash.has(hash));
  if (missingHashes.length) {
    return skipped(finding, `inline ENEX media hash did not match a stored attachment: ${missingHashes.join(", ")}`);
  }

  const duplicateRequiredHashes = requiredMediaHashes.filter((hash) => attachmentHashResult.duplicateHashes.has(hash));
  if (duplicateRequiredHashes.length) {
    return skipped(finding, `inline ENEX media hash matched multiple stored attachments: ${duplicateRequiredHashes.join(", ")}`);
  }

  const { body, plainText } = enmlToEditorBody(enml, attachmentHashResult.attachmentsByHash);
  const missingAfterRepair = (finding.missingTexts ?? []).filter((text) => !bodyContainsText(plainText, text));
  if (missingAfterRepair.length) {
    return skipped(finding, `fixed converter still did not contain expected text: ${missingAfterRepair.slice(0, 3).join("; ")}`);
  }

  if (body === page.body) {
    return {
      status: "unchanged_now",
      pageId,
      notebookName: page.notebookName,
      title: page.title,
      sourceFile: finding.sourceFile,
    };
  }

  const result = {
    status: applyChanges ? "repaired" : "would_repair",
    pageId,
    notebookId: page.notebookId,
    notebookName: page.notebookName,
    title: page.title,
    sourceFile: finding.sourceFile,
    missingTexts: finding.missingTexts ?? [],
    oldBodySha256: sha256(page.body),
    newBodySha256: sha256(body),
    attachmentHashesBackfilled: attachmentHashResult.hashesToBackfill.length,
  };

  if (applyChanges) {
    const applied = applyPageRepair({ page, body, plainText, attachments, attachmentHashResult, result });
    if (!applied) {
      return skipped(finding, "page changed before repair could be applied");
    }
  }

  return result;
}

function applyPageRepair({ page, body, plainText, attachments, attachmentHashResult, result }) {
  const tags = tagsByPage.get(page.id) ?? [];
  const attachmentNames = attachments.map((attachment) => attachment.originalName);
  const backfillSql = attachmentHashResult.hashesToBackfill.map((entry) => `
    UPDATE attachments
    SET evernote_hash = ${sql(entry.hash)}
    WHERE id = ${sql(entry.attachmentId)}
      AND (evernote_hash IS NULL OR evernote_hash = '')
      AND (SELECT repaired FROM repair_guard LIMIT 1) = 1;
  `).join("\n");
  const metadata = {
    repair: "enex-sibling-nested-list",
    sourceReport: options.report,
    sourceFile: result.sourceFile,
    missingTexts: result.missingTexts,
    oldBodySha256: result.oldBodySha256,
    newBodySha256: result.newBodySha256,
    previousPageUpdatedAt: page.updatedAt,
  };

  const output = execSqlOutput(`
    CREATE TEMP TABLE repair_guard(repaired INTEGER NOT NULL);
    BEGIN IMMEDIATE;
    UPDATE pages
    SET body = ${sql(body)}
    WHERE id = ${sql(page.id)}
      AND body = ${sql(page.body)}
      AND NOT EXISTS (
        SELECT 1
        FROM audit_events
        WHERE page_id = ${sql(page.id)}
          AND action = 'page.body.updated'
      );

    INSERT INTO repair_guard(repaired) VALUES (changes());

    ${backfillSql}

    DELETE FROM search_pages_fts
    WHERE page_id = ${sql(page.id)}
      AND (SELECT repaired FROM repair_guard LIMIT 1) = 1;

    INSERT INTO search_pages_fts (page_id, notebook_id, title, body, tags, attachments, notebook, updated_at)
    SELECT
      ${sql(page.id)},
      ${sql(page.notebookId)},
      ${sql(page.title)},
      ${sql(plainText)},
      ${sql(tags.join(","))},
      ${sql(attachmentNames.join(","))},
      ${sql(page.notebookName)},
      ${sql(page.updatedAt)}
    WHERE (SELECT repaired FROM repair_guard LIMIT 1) = 1;

    INSERT INTO audit_events (
      id,
      entity_type,
      entity_id,
      page_id,
      notebook_id,
      actor_user_id,
      action,
      summary,
      metadata_json,
      event_count
    )
    SELECT
      ${sql(crypto.randomUUID())},
      'page',
      ${sql(page.id)},
      ${sql(page.id)},
      ${sql(page.notebookId)},
      ${sql(actor.id)},
      'page.import.repaired',
      'repaired imported ENEX nested list content',
      ${sql(JSON.stringify(metadata))},
      1
    WHERE (SELECT repaired FROM repair_guard LIMIT 1) = 1;
    COMMIT;
    SELECT repaired FROM repair_guard LIMIT 1;
  `);
  const repairedRows = Number(output.trim().split(/\s+/).pop() || 0);
  return repairedRows === 1;
}

function loadActor(email) {
  const rows = queryJson(`SELECT id, email FROM users WHERE lower(email) = lower(${sql(email)}) LIMIT 1;`);
  return rows[0] || null;
}

function loadPages(ids) {
  const rows = queryJson(`
    SELECT
      p.id,
      p.notebook_id,
      n.name AS notebook_name,
      p.title,
      p.body,
      p.created_at,
      p.updated_at,
      COUNT(ae.id) AS body_edit_count
    FROM pages p
    JOIN notebooks n ON n.id = p.notebook_id
    LEFT JOIN audit_events ae ON ae.page_id = p.id AND ae.action = 'page.body.updated'
    WHERE p.id IN (${sqlList(ids)})
    GROUP BY p.id;
  `);
  return new Map(rows.map((row) => [String(row.id), {
    id: String(row.id),
    notebookId: String(row.notebook_id),
    notebookName: String(row.notebook_name),
    title: String(row.title),
    body: String(row.body ?? ""),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    bodyEditCount: Number(row.body_edit_count ?? 0),
  }]));
}

function loadPageTags(ids) {
  const rows = queryJson(`
    SELECT page_id, tag
    FROM page_tags
    WHERE page_id IN (${sqlList(ids)})
    ORDER BY lower(tag);
  `);
  const grouped = new Map();
  for (const row of rows) {
    const pageId = String(row.page_id);
    grouped.set(pageId, [...(grouped.get(pageId) ?? []), String(row.tag)]);
  }
  return grouped;
}

function loadPageAttachments(ids) {
  const rows = queryJson(`
    SELECT
      id,
      page_id,
      original_name,
      mime_type,
      size,
      storage_key,
      block_type,
      COALESCE(evernote_hash, '') AS evernote_hash,
      created_at
    FROM attachments
    WHERE page_id IN (${sqlList(ids)})
    ORDER BY created_at, original_name;
  `);
  const grouped = new Map();
  for (const row of rows) {
    const attachment = {
      id: String(row.id),
      pageId: String(row.page_id),
      originalName: String(row.original_name),
      mimeType: String(row.mime_type),
      size: Number(row.size ?? 0),
      storageKey: String(row.storage_key),
      blockType: String(row.block_type || "file"),
      evernoteHash: String(row.evernote_hash || "").toLowerCase(),
      createdAt: String(row.created_at ?? ""),
      updatedAt: String(row.created_at ?? ""),
    };
    grouped.set(attachment.pageId, [...(grouped.get(attachment.pageId) ?? []), attachment]);
  }
  return grouped;
}

async function buildAttachmentHashMap(attachments) {
  const attachmentsByHash = new Map();
  const duplicateHashes = new Set();
  const hashesToBackfill = [];
  const errors = [];
  for (const attachment of attachments) {
    const filePath = safeUploadPath(attachment.storageKey);
    if (!filePath) {
      errors.push(`unsafe attachment storage path for ${attachment.originalName}`);
      continue;
    }
    if (!fs.existsSync(filePath)) {
      errors.push(`stored attachment file is missing for ${attachment.originalName}`);
      continue;
    }
    const fileHash = await md5File(filePath);
    if (attachment.evernoteHash && attachment.evernoteHash !== fileHash) {
      errors.push(`stored attachment hash disagrees with evernote_hash for ${attachment.originalName}`);
      continue;
    }
    if (!attachment.evernoteHash) {
      hashesToBackfill.push({ attachmentId: attachment.id, hash: fileHash });
    }
    if (attachmentsByHash.has(fileHash)) duplicateHashes.add(fileHash);
    attachmentsByHash.set(fileHash, { ...attachment, evernoteHash: fileHash });
  }
  return { attachmentsByHash, duplicateHashes, hashesToBackfill, errors };
}

function safeUploadPath(storageKey) {
  const absoluteUploadDir = path.resolve(uploadDir);
  const absolutePath = path.resolve(uploadDir, storageKey);
  if (!absolutePath.startsWith(`${absoluteUploadDir}${path.sep}`)) return "";
  return absolutePath;
}

function md5File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("md5");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function groupFindingsBySourceAndTitle(findings) {
  const grouped = new Map();
  for (const finding of findings) {
    const sourceFile = finding.sourceFile;
    const titleKey = normalizeKey(finding.title);
    const titleMap = grouped.get(sourceFile) ?? new Map();
    titleMap.set(titleKey, [...(titleMap.get(titleKey) ?? []), finding]);
    grouped.set(sourceFile, titleMap);
  }
  return grouped;
}

async function streamEnexNotes(filePath, onNote) {
  const stream = fs.createReadStream(filePath, { encoding: "utf8", highWaterMark: 1024 * 1024 });
  let buffer = "";
  let mode = "seeking-note";
  for await (const chunk of stream) {
    buffer += String(chunk);
    while (true) {
      if (mode === "seeking-note") {
        const start = buffer.indexOf("<note>");
        if (start === -1) {
          buffer = buffer.slice(Math.max(0, buffer.length - 32));
          break;
        }
        buffer = buffer.slice(start);
        mode = "reading-content";
      }

      if (mode === "reading-content") {
        const contentEnd = buffer.indexOf("</content>");
        if (contentEnd === -1) break;
        const noteHead = `${buffer.slice(0, contentEnd + "</content>".length)}</note>`;
        buffer = buffer.slice(contentEnd + "</content>".length);
        mode = "skipping-note-tail";
        await onNote(noteHead);
      }

      if (mode === "skipping-note-tail") {
        const noteEnd = buffer.indexOf("</note>");
        if (noteEnd === -1) {
          buffer = buffer.slice(Math.max(0, buffer.length - 32));
          break;
        }
        buffer = buffer.slice(noteEnd + "</note>".length);
        mode = "seeking-note";
        continue;
      }

      if (mode !== "seeking-note") break;
    }
  }
}

function mediaHashesFromEnml(enml) {
  try {
    const rootNodes = parseEnmlNodes(enml);
    const hashes = [];
    visit(rootNodes);
    return [...new Set(hashes.map((hash) => hash.toLowerCase()).filter(Boolean))];

    function visit(nodes) {
      for (const node of nodes) {
        const tag = getNodeTag(node);
        if (tag === "en-media") {
          const attrs = getNodeAttrs(node);
          const hash = attrs["@_hash"] || attrs.hash;
          if (hash) hashes.push(String(hash));
        }
        visit(getNodeChildren(node));
      }
    }
  } catch {
    return [];
  }
}

function enmlToEditorBody(enml, attachmentsByHash) {
  const doc = enmlToEditorDocument(enml, attachmentsByHash);
  return { body: JSON.stringify(doc), plainText: editorDocumentToPlainText(doc).trim() };
}

function attachmentNode(attachment) {
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
  return {
    type: tag === "th" ? "tableHeader" : "tableCell",
    attrs: { colspan: positiveInteger(attrs["@_colspan"], 1), rowspan: positiveInteger(attrs["@_rowspan"], 1), colwidth: null },
    content: content.length ? ensureParagraphBlocks(content) : [{ type: "paragraph" }],
  };
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
  return blocks.filter((block) => ["attachmentCard", "table", "bulletList", "orderedList", "blockquote"].includes(block.type) || block.content?.length);
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
  return hash ? attachmentsByHash.get(String(hash).toLowerCase()) : undefined;
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

function editorDocumentToPlainText(node) {
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "attachmentCard") return `[${String(node.attrs?.kind || "File")}: ${String(node.attrs?.filename || "attachment")}]\n`;
  const childText = node.content?.map(editorDocumentToPlainText).join("") || "";
  if (["paragraph", "heading", "blockquote", "listItem", "tableCell", "tableHeader"].includes(node.type || "")) return `${childText}\n`;
  return childText;
}

function extractTagText(xml, tag) {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = xml.match(pattern);
  if (!match) return "";
  return decodeXmlEntities(stripTags(unwrapCdata(match[1] ?? ""))).trim();
}

function extractTagInnerXml(xml, tag) {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = xml.match(pattern);
  return match ? unwrapCdata(match[1] ?? "").trim() : "";
}

function cleanEnml(enml) {
  return unwrapCdata(enml).replace(/<\?xml[^>]*>/gi, "").replace(/<!DOCTYPE[^>]*>/gi, "").trim();
}

function unwrapCdata(value) {
  return String(value).replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "");
}

function stripTags(value) {
  return String(value).replace(/<[^>]+>/g, "");
}

function bodyContainsText(body, text) {
  return normalizeText(body).includes(normalizeText(text));
}

function normalizeText(value) {
  return decodeXmlEntities(String(value)).replace(/\s+/g, " ").trim();
}

function decodeXmlEntities(value) {
  return String(value)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function skipped(finding, reason) {
  return {
    status: "skipped",
    reason,
    pageId: finding.page?.id ?? "",
    notebookName: finding.notebookName,
    title: finding.title,
    sourceFile: finding.sourceFile,
  };
}

function queryJson(statement) {
  if (statement.includes("IN ()")) return [];
  const output = execFileSync("sqlite3", ["-json", databasePath, statement], { encoding: "utf8", maxBuffer: 1024 * 1024 * 200 });
  return output.trim() ? JSON.parse(output) : [];
}

function execSql(statement) {
  execFileSync("sqlite3", [databasePath, "-batch"], {
    input: `.timeout 30000\nPRAGMA foreign_keys=ON;\n${statement}`,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function execSqlOutput(statement) {
  return execFileSync("sqlite3", [databasePath, "-batch", "-noheader"], {
    input: `.timeout 30000\nPRAGMA foreign_keys=ON;\n${statement}`,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function sql(value) {
  if (value === null || value === undefined || value === "") return value === "" ? "''" : "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlList(values) {
  return values.length ? values.map(sql).join(", ") : "NULL";
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function countBy(rows, field) {
  return rows.reduce((counts, row) => {
    counts[row[field]] = (counts[row[field]] ?? 0) + 1;
    return counts;
  }, {});
}

function timestampForFile(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const readValue = () => {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      index += 1;
      return value;
    };
    if (arg === "--report") parsed.report = readValue();
    else if (arg === "--database") parsed.database = readValue();
    else if (arg === "--upload-dir") parsed.uploadDir = readValue();
    else if (arg === "--report-dir") parsed.reportDir = readValue();
    else if (arg === "--actor-email") parsed.actorEmail = readValue();
    else if (arg === "--page-id") parsed.pageId = readValue();
    else if (arg === "--limit") parsed.limit = Math.max(1, Number.parseInt(readValue(), 10) || 0);
    else if (arg === "--apply") parsed.apply = true;
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`Usage:
node ops/enex-repair/apply-safe-nested-list-repair.mjs \\
  --report /app-data/enex-repair-reports/nested-list-loss-YYYY.json \\
  --actor-email admin@example.org

By default this is a dry-run. Add --apply to write safe repairs.
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
