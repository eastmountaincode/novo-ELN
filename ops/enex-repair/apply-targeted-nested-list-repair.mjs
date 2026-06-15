import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { XMLParser } from "fast-xml-parser";

const options = parseArgs(process.argv.slice(2));
if (!options.report) fail("Missing --report /path/to/nested-list-loss-report.json.");
if (options.apply && !options.actorEmail) fail("Applying repairs requires --actor-email.");

const databasePath = options.database || process.env.ELN_DATABASE_PATH || "/app-data/data/eln.sqlite3";
const reportDir = options.reportDir || "/app-data/enex-repair-reports";
const classification = options.classification || "manual_review";
const applyChanges = Boolean(options.apply);
const startedAt = new Date();
const report = JSON.parse(fs.readFileSync(options.report, "utf8"));
const actor = options.actorEmail ? loadActor(options.actorEmail) : null;
const candidates = report.findings
  .filter((finding) => finding.classification === classification)
  .filter((finding) => !options.pageId || finding.page?.id === options.pageId)
  .slice(0, options.limit || undefined);

const enmlParser = new XMLParser({
  ignoreAttributes: false,
  preserveOrder: true,
  trimValues: false,
  cdataPropName: "__cdata",
  textNodeName: "#text",
});

process.stdout.write(`Mode: ${applyChanges ? "apply" : "dry-run"}\n`);
process.stdout.write(`Classification: ${classification}\n`);
process.stdout.write(`Candidates: ${candidates.length}\n`);

const pages = loadPages(candidates.map((finding) => finding.page?.id).filter(Boolean));
const tagsByPage = loadPageTags([...pages.keys()]);
const attachmentsByPage = loadPageAttachments([...pages.keys()]);
const findingsBySourceAndTitle = groupFindingsBySourceAndTitle(candidates);
const results = [];
let processed = 0;

for (const [sourceFile, titleMap] of findingsBySourceAndTitle) {
  if (!fs.existsSync(sourceFile)) {
    for (const findings of titleMap.values()) for (const finding of findings) results.push(skipped(finding, "source ENEX file was not found"));
    continue;
  }
  process.stdout.write(`Scanning ${sourceFile}\n`);
  await streamEnexNotes(sourceFile, async (noteXml) => {
    const title = extractTagText(noteXml, "title") || "Untitled Evernote note";
    const findings = titleMap.get(normalizeKey(title));
    if (!findings?.length) return;
    const enml = extractTagInnerXml(noteXml, "content");
    if (!enml) {
      for (const finding of findings) results.push(skipped(finding, "source note has no ENML content"));
      return;
    }
    const groups = siblingNestedListGroups(enml);
    for (const finding of findings) {
      processed += 1;
      results.push(repairFinding(finding, groups));
      if (processed % 25 === 0) process.stdout.write(`Processed ${processed}/${candidates.length}\n`);
    }
  });
}

const seen = new Set(results.map((result) => result.pageId).filter(Boolean));
for (const finding of candidates) {
  if (!seen.has(finding.page?.id)) results.push(skipped(finding, "matching source note was not found in ENEX file"));
}

const summary = {
  generatedAt: startedAt.toISOString(),
  mode: applyChanges ? "apply" : "dry-run",
  classification,
  report: options.report,
  databasePath,
  candidates: candidates.length,
  results: countBy(results, "status"),
};
await fsp.mkdir(reportDir, { recursive: true });
const outputPath = path.join(reportDir, `nested-list-targeted-${timestampForFile(startedAt)}.json`);
await fsp.writeFile(outputPath, JSON.stringify({ summary, results }, null, 2));
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`Targeted report: ${outputPath}\n`);

function repairFinding(finding, groups) {
  const pageId = finding.page?.id;
  const page = pages.get(pageId);
  if (!page) return skipped(finding, "page no longer exists");
  let doc;
  try {
    doc = JSON.parse(page.body || "{}");
  } catch (error) {
    return skipped(finding, `current page body is not valid editor JSON: ${error.message}`);
  }
  const beforePlainText = editorDocumentToPlainText(doc);
  const missingBefore = (finding.missingTexts ?? []).filter((text) => !bodyContainsText(beforePlainText, text));
  if (!missingBefore.length) {
    return { status: "unchanged_now", pageId, notebookName: page.notebookName, title: page.title, sourceFile: finding.sourceFile };
  }

  const parentsTried = [];
  let inserted = 0;
  for (const group of groups) {
    const groupMissing = group.allTexts.filter((text) => missingBefore.some((missing) => normalizeText(missing) === normalizeText(text)));
    if (!groupMissing.length) continue;
    parentsTried.push(group.parentText);
    const targets = findListItemsByOwnText(doc, group.parentText);
    for (const target of targets) {
      if (listItemContainsAnyText(target, group.allTexts)) continue;
      if (mergeNestedList(target, group.listNode)) {
        inserted += 1;
        break;
      }
    }
  }

  if (!inserted) return skipped(finding, `no matching list parent found for missing nested text; parents tried: ${parentsTried.slice(0, 5).join("; ")}`);

  const afterPlainText = editorDocumentToPlainText(doc);
  const missingAfter = (finding.missingTexts ?? []).filter((text) => !bodyContainsText(afterPlainText, text));
  if (missingAfter.length) return skipped(finding, `targeted insert still missing text: ${missingAfter.slice(0, 5).join("; ")}`);

  const body = JSON.stringify(doc);
  const result = {
    status: applyChanges ? "repaired" : "would_repair",
    pageId,
    notebookId: page.notebookId,
    notebookName: page.notebookName,
    title: page.title,
    sourceFile: finding.sourceFile,
    insertedGroups: inserted,
    missingTexts: finding.missingTexts ?? [],
    oldBodySha256: sha256(page.body),
    newBodySha256: sha256(body),
  };
  if (applyChanges) {
    const applied = applyPageRepair({ page, body, plainText: afterPlainText.trim(), result });
    if (!applied) return skipped(finding, "page changed before repair could be applied");
  }
  return result;
}

function applyPageRepair({ page, body, plainText, result }) {
  const tags = tagsByPage.get(page.id) ?? [];
  const attachmentNames = (attachmentsByPage.get(page.id) ?? []).map((attachment) => attachment.originalName);
  const metadata = {
    repair: "enex-targeted-sibling-nested-list",
    sourceReport: options.report,
    sourceFile: result.sourceFile,
    missingTexts: result.missingTexts,
    insertedGroups: result.insertedGroups,
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
      AND body = ${sql(page.body)};
    INSERT INTO repair_guard(repaired) VALUES (changes());

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
  return Number(output.trim().split(/\s+/).pop() || 0) === 1;
}

function siblingNestedListGroups(enml) {
  try {
    const cleaned = cleanEnml(enml);
    const wrapped = /^<en-note\b/i.test(cleaned) ? cleaned : `<en-note>${cleaned}</en-note>`;
    const parsed = enmlParser.parse(wrapped);
    const root = parsed.find((node) => getNodeTag(node) === "en-note");
    return collectSiblingGroups(root ? getNodeChildren(root) : parsed);
  } catch {
    return [];
  }
}

function collectSiblingGroups(nodes) {
  const groups = [];
  for (const node of nodes) {
    const tag = getNodeTag(node);
    const children = getNodeChildren(node);
    if (tag === "ul" || tag === "ol") {
      let previousLi = null;
      for (const child of children) {
        const childTag = getNodeTag(child);
        if (childTag === "li") {
          groups.push(...collectSiblingGroups(getNodeChildren(child)));
          previousLi = child;
          continue;
        }
        if ((childTag === "ul" || childTag === "ol") && previousLi) {
          const parentText = ownListItemText(previousLi);
          const listNode = enexListToEditorList(child);
          const allTexts = directAndNestedListItemTexts(child);
          if (parentText && listNode.content?.length && allTexts.length) groups.push({ parentText, listNode, allTexts });
          continue;
        }
        groups.push(...collectSiblingGroups(getNodeChildren(child)));
      }
      continue;
    }
    groups.push(...collectSiblingGroups(children));
  }
  return groups;
}

function enexListToEditorList(listNode) {
  const tag = getNodeTag(listNode);
  const items = [];
  let previousItem = null;
  for (const child of getNodeChildren(listNode)) {
    const childTag = getNodeTag(child);
    if (childTag === "li") {
      const text = ownListItemText(child);
      previousItem = { type: "listItem", content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }] };
      for (const nested of getNodeChildren(child).filter((node) => ["ul", "ol"].includes(getNodeTag(node)))) {
        previousItem.content.push(enexListToEditorList(nested));
      }
      items.push(previousItem);
      continue;
    }
    if ((childTag === "ul" || childTag === "ol") && previousItem) {
      previousItem.content.push(enexListToEditorList(child));
    }
  }
  return { type: tag === "ul" ? "bulletList" : "orderedList", content: items };
}

function ownListItemText(liNode) {
  return normalizeText(collectText(getNodeChildren(liNode).filter((child) => !["ul", "ol"].includes(getNodeTag(child)))));
}

function directAndNestedListItemTexts(listNode) {
  const texts = [];
  for (const child of getNodeChildren(listNode)) {
    if (getNodeTag(child) !== "li") continue;
    const text = ownListItemText(child);
    if (text) texts.push(text);
    for (const nested of getNodeChildren(child).filter((node) => ["ul", "ol"].includes(getNodeTag(node)))) {
      texts.push(...directAndNestedListItemTexts(nested));
    }
  }
  return texts;
}

function findListItemsByOwnText(node, text) {
  const matches = [];
  visit(node);
  return matches;

  function visit(current) {
    if (!current || typeof current !== "object") return;
    if (current.type === "listItem" && normalizeText(editorNodeOwnText(current)) === normalizeText(text)) matches.push(current);
    for (const child of current.content || []) visit(child);
  }
}

function listItemContainsAnyText(listItem, texts) {
  const plain = editorDocumentToPlainText(listItem);
  return texts.some((text) => bodyContainsText(plain, text));
}

function mergeNestedList(listItem, nestedList) {
  const content = listItem.content || [];
  const existing = content.find((child) => child.type === nestedList.type);
  if (!existing) {
    listItem.content = [...content, clone(nestedList)];
    return true;
  }
  const existingPlain = editorDocumentToPlainText(existing);
  const additions = (nestedList.content || []).filter((item) => !bodyContainsText(existingPlain, editorNodeOwnText(item)));
  if (!additions.length) return false;
  existing.content = [...(existing.content || []), ...clone(additions)];
  return true;
}

function editorNodeOwnText(listItem) {
  const paragraph = (listItem.content || []).find((child) => child.type === "paragraph" || child.type === "heading");
  return paragraph ? editorDocumentToPlainText(paragraph) : "";
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

function loadActor(email) {
  return queryJson(`SELECT id, email FROM users WHERE lower(email) = lower(${sql(email)}) LIMIT 1;`)[0] || null;
}

function loadPages(ids) {
  if (!ids.length) return new Map();
  const rows = queryJson(`
    SELECT p.id, p.notebook_id, n.name AS notebook_name, p.title, p.body, p.created_at, p.updated_at
    FROM pages p
    JOIN notebooks n ON n.id = p.notebook_id
    WHERE p.id IN (${sqlList(ids)});
  `);
  return new Map(rows.map((row) => [String(row.id), {
    id: String(row.id), notebookId: String(row.notebook_id), notebookName: String(row.notebook_name),
    title: String(row.title), body: String(row.body || ""), createdAt: String(row.created_at || ""), updatedAt: String(row.updated_at || ""),
  }]));
}

function loadPageTags(ids) {
  if (!ids.length) return new Map();
  const grouped = new Map();
  for (const row of queryJson(`SELECT page_id, tag FROM page_tags WHERE page_id IN (${sqlList(ids)}) ORDER BY lower(tag);`)) {
    const pageId = String(row.page_id);
    grouped.set(pageId, [...(grouped.get(pageId) || []), String(row.tag)]);
  }
  return grouped;
}

function loadPageAttachments(ids) {
  if (!ids.length) return new Map();
  const grouped = new Map();
  for (const row of queryJson(`SELECT page_id, original_name FROM attachments WHERE page_id IN (${sqlList(ids)}) ORDER BY created_at, original_name;`)) {
    const pageId = String(row.page_id);
    grouped.set(pageId, [...(grouped.get(pageId) || []), { originalName: String(row.original_name) }]);
  }
  return grouped;
}

function groupFindingsBySourceAndTitle(findings) {
  const grouped = new Map();
  for (const finding of findings) {
    const titleMap = grouped.get(finding.sourceFile) || new Map();
    const key = normalizeKey(finding.title);
    titleMap.set(key, [...(titleMap.get(key) || []), finding]);
    grouped.set(finding.sourceFile, titleMap);
  }
  return grouped;
}

function editorDocumentToPlainText(node) {
  if (!node || typeof node !== "object") return "";
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "attachmentCard") return `[${String(node.attrs?.kind || "File")}: ${String(node.attrs?.filename || "attachment")}]\n`;
  const childText = node.content?.map(editorDocumentToPlainText).join("") || "";
  if (["paragraph", "heading", "blockquote", "listItem", "tableCell", "tableHeader"].includes(node.type || "")) return `${childText}\n`;
  return childText;
}

function collectText(nodes) {
  let value = "";
  for (const node of nodes) {
    const tag = getNodeTag(node);
    if (tag === "#text" || tag === "__cdata") value += ` ${textValue(node[tag])}`;
    else if (tag !== ":@") value += ` ${collectText(getNodeChildren(node))}`;
  }
  return value;
}

function extractTagText(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXmlEntities(stripTags(unwrapCdata(match[1] || ""))).trim() : "";
}
function extractTagInnerXml(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? unwrapCdata(match[1] || "").trim() : "";
}
function cleanEnml(enml) { return unwrapCdata(enml).replace(/<\?xml[^>]*>/gi, "").replace(/<!DOCTYPE[^>]*>/gi, "").trim(); }
function unwrapCdata(value) { return String(value).replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, ""); }
function stripTags(value) { return String(value).replace(/<[^>]+>/g, ""); }
function getNodeTag(node) { return Object.keys(node).find((key) => key !== ":@") || ""; }
function getNodeChildren(node) { const value = node[getNodeTag(node)]; return Array.isArray(value) ? value : []; }
function textValue(value) { if (value == null) return ""; if (typeof value === "string" || typeof value === "number") return String(value); if (typeof value === "object") return textValue(value.__cdata ?? value["#text"] ?? ""); return ""; }
function bodyContainsText(body, text) { return normalizeText(body).includes(normalizeText(text)); }
function normalizeText(value) { return decodeXmlEntities(String(value)).replace(/\s+/g, " ").trim(); }
function decodeXmlEntities(value) { return String(value).replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'"); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function skipped(finding, reason) { return { status: "skipped", reason, pageId: finding.page?.id || "", notebookName: finding.notebookName, title: finding.title, sourceFile: finding.sourceFile }; }
function countBy(rows, field) { return rows.reduce((counts, row) => { counts[row[field]] = (counts[row[field]] || 0) + 1; return counts; }, {}); }
function normalizeKey(value) { return String(value || "").trim().toLowerCase(); }
function sha256(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function timestampForFile(date) { return date.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z"); }
function queryJson(statement) { const out = execFileSync("sqlite3", ["-json", databasePath, statement], { encoding: "utf8", maxBuffer: 1024 * 1024 * 200 }); return out.trim() ? JSON.parse(out) : []; }
function execSqlOutput(statement) { return execFileSync("sqlite3", [databasePath, "-batch", "-noheader"], { input: `.timeout 30000\nPRAGMA foreign_keys=ON;\n${statement}`, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }); }
function sql(value) { if (value === null || value === undefined || value === "") return value === "" ? "''" : "NULL"; if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL"; return `'${String(value).replace(/'/g, "''")}'`; }
function sqlList(values) { return values.length ? values.map(sql).join(", ") : "NULL"; }
function parseArgs(args) { const parsed = {}; for (let i = 0; i < args.length; i++) { const arg = args[i]; const val = () => { const v = args[++i]; if (!v || v.startsWith("--")) fail(`Missing value for ${arg}`); return v; }; if (arg === "--report") parsed.report = val(); else if (arg === "--database") parsed.database = val(); else if (arg === "--report-dir") parsed.reportDir = val(); else if (arg === "--actor-email") parsed.actorEmail = val(); else if (arg === "--page-id") parsed.pageId = val(); else if (arg === "--classification") parsed.classification = val(); else if (arg === "--limit") parsed.limit = Math.max(1, Number.parseInt(val(), 10) || 0); else if (arg === "--apply") parsed.apply = true; else fail(`Unknown argument: ${arg}`); } return parsed; }
function fail(message) { process.stderr.write(`${message}\n`); process.exit(1); }
