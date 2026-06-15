import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { XMLParser } from "fast-xml-parser";

const options = parseArgs(process.argv.slice(2));
const databasePath = options.database || process.env.ELN_DATABASE_PATH || "/app-data/data/eln.sqlite3";
const enexRoot = options.enexRoot || "/evernote-imports";
const reportDir = options.reportDir || "/app-data/enex-repair-reports";
const startedAt = new Date();

const enmlParser = new XMLParser({
  ignoreAttributes: false,
  preserveOrder: true,
  trimValues: false,
  cdataPropName: "__cdata",
  textNodeName: "#text",
});

const pages = loadPages();
const pagesByNotebookAndTitle = groupPages(pages);
const files = findEnexFiles(enexRoot);

process.stdout.write(`Loaded ${pages.length} Novo pages from ${databasePath}\n`);
process.stdout.write(`Found ${files.length} ENEX files under ${enexRoot}\n`);

const findings = [];
let notesScanned = 0;
let notesWithSiblingNestedLists = 0;

for (const [fileIndex, filePath] of files.entries()) {
  const notebookName = path.basename(filePath).replace(/\.enex$/i, "");
  const fileSize = fs.statSync(filePath).size;
  const fileLabel = path.relative(enexRoot, filePath) || filePath;
  const fileStartedAt = Date.now();
  let fileNotesScanned = 0;
  let fileNotesWithSiblingNestedLists = 0;
  const prefix = `[${fileIndex + 1}/${files.length}]`;
  process.stdout.write(`${prefix} scanning ${fileLabel} (${formatBytes(fileSize)})\n`);

  await streamEnexNotes(filePath, async (noteXml) => {
    notesScanned += 1;
    fileNotesScanned += 1;
    const title = extractTagText(noteXml, "title") || "Untitled Evernote note";
    const enml = extractTagInnerXml(noteXml, "content");
    if (!enml) return;
    const nestedTexts = siblingNestedListTexts(enml);
    if (!nestedTexts.length) return;
    notesWithSiblingNestedLists += 1;
    fileNotesWithSiblingNestedLists += 1;

    const pageMatches = pagesByNotebookAndTitle.get(keyFor(notebookName, title)) ?? [];
    if (pageMatches.length !== 1) {
      findings.push({
        classification: "ambiguous",
        reason: pageMatches.length === 0 ? "no matching Novo page" : "multiple matching Novo pages",
        notebookName,
        title,
        sourceFile: filePath,
        nestedTexts,
        matches: pageMatches.map(pageSummary),
      });
      return;
    }

    const page = pageMatches[0];
    const missingTexts = nestedTexts.filter((text) => !bodyContainsText(page.plainText, text));
    if (!missingTexts.length) {
      findings.push({
        classification: "unchanged",
        notebookName,
        title,
        sourceFile: filePath,
        nestedTexts,
        page: pageSummary(page),
      });
      return;
    }

    findings.push({
      classification: page.bodyEditCount > 0 ? "manual_review" : "safe_auto_repair",
      reason: page.bodyEditCount > 0 ? "page has body edit audit events" : "page body has no body edit audit events",
      notebookName,
      title,
      sourceFile: filePath,
      missingTexts,
      nestedTexts,
      page: pageSummary(page),
    });
  }, {
    fileSize,
    onProgress: (progress) => {
      process.stdout.write(`${prefix} ${fileLabel}: ${progress.percent}% (${formatBytes(progress.bytesRead)} / ${formatBytes(fileSize)}), ${fileNotesScanned} notes\n`);
    },
  });

  process.stdout.write(`${prefix} done ${fileLabel}: ${fileNotesScanned} notes, ${fileNotesWithSiblingNestedLists} notes with sibling nested lists, ${formatDuration(Date.now() - fileStartedAt)}\n`);
}

const summary = {
  generatedAt: startedAt.toISOString(),
  databasePath,
  enexRoot,
  enexFilesScanned: files.length,
  notesScanned,
  notesWithSiblingNestedLists,
  findings: countBy(findings, "classification"),
};

await fsp.mkdir(reportDir, { recursive: true });
const reportPath = path.join(reportDir, `nested-list-loss-${timestampForFile(startedAt)}.json`);
await fsp.writeFile(reportPath, JSON.stringify({ summary, findings }, null, 2));

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`Report: ${reportPath}\n`);

function loadPages() {
  const rows = queryJson(`
    SELECT
      p.id,
      n.name AS notebook_name,
      p.title,
      p.body,
      p.created_at,
      p.updated_at,
      COUNT(ae.id) AS body_edit_count
    FROM pages p
    JOIN notebooks n ON n.id = p.notebook_id
    LEFT JOIN audit_events ae ON ae.page_id = p.id AND ae.action = 'page.body.updated'
    GROUP BY p.id
    ORDER BY lower(n.name), lower(p.title);
  `);
  return rows.map((row) => ({
    id: String(row.id),
    notebookName: String(row.notebook_name),
    title: String(row.title),
    body: String(row.body ?? ""),
    plainText: editorBodyToPlainText(String(row.body ?? "")),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    bodyEditCount: Number(row.body_edit_count ?? 0),
  }));
}

function queryJson(sql) {
  const output = execFileSync("sqlite3", ["-json", databasePath, sql], { encoding: "utf8", maxBuffer: 1024 * 1024 * 200 });
  return output.trim() ? JSON.parse(output) : [];
}

function groupPages(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = keyFor(row.notebookName, row.title);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return grouped;
}

function findEnexFiles(root) {
  const found = [];
  visit(root);
  return found.sort((a, b) => a.localeCompare(b));

  function visit(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (entry.isFile() && /\.enex$/i.test(entry.name)) found.push(absolutePath);
    }
  }
}

async function streamEnexNotes(filePath, onNote, options = {}) {
  const stream = fs.createReadStream(filePath, { encoding: "utf8", highWaterMark: 1024 * 1024 });
  let buffer = "";
  let bytesRead = 0;
  let lastProgressAt = 0;
  let mode = "seeking-note";
  for await (const chunk of stream) {
    const chunkText = String(chunk);
    bytesRead += Buffer.byteLength(chunkText);
    buffer += chunkText;
    const now = Date.now();
    if (options.onProgress && now - lastProgressAt >= 5000) {
      lastProgressAt = now;
      options.onProgress(progressFor(bytesRead, options.fileSize));
    }
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
        if (contentEnd === -1) {
          break;
        }
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

      if (mode !== "seeking-note") {
        break;
      }
    }
  }
  if (options.onProgress) options.onProgress(progressFor(bytesRead, options.fileSize));
}

function siblingNestedListTexts(enml) {
  try {
    const cleaned = cleanEnml(enml);
    const wrapped = /^<en-note\b/i.test(cleaned) ? cleaned : `<en-note>${cleaned}</en-note>`;
    const parsed = enmlParser.parse(wrapped);
    const root = parsed.find((node) => getNodeTag(node) === "en-note");
    return uniqueTexts(findSiblingNestedListTexts(root ? getNodeChildren(root) : parsed));
  } catch {
    return [];
  }
}

function findSiblingNestedListTexts(nodes) {
  const texts = [];
  for (const node of nodes) {
    const tag = getNodeTag(node);
    const children = getNodeChildren(node);
    if (tag === "ul" || tag === "ol") {
      let hasPreviousListItem = false;
      for (const child of children) {
        const childTag = getNodeTag(child);
        if (childTag === "li") {
          hasPreviousListItem = true;
          texts.push(...findSiblingNestedListTexts(getNodeChildren(child)));
          continue;
        }
        if ((childTag === "ul" || childTag === "ol") && hasPreviousListItem) {
          texts.push(...directListItemTexts(child));
        }
        texts.push(...findSiblingNestedListTexts(getNodeChildren(child)));
      }
      continue;
    }
    texts.push(...findSiblingNestedListTexts(children));
  }
  return texts;
}

function directListItemTexts(listNode) {
  return getNodeChildren(listNode)
    .filter((child) => getNodeTag(child) === "li")
    .map((child) => normalizeText(collectText(getNodeChildren(child))))
    .filter(Boolean);
}

function collectText(nodes) {
  let value = "";
  for (const node of nodes) {
    const tag = getNodeTag(node);
    if (tag === "#text" || tag === "__cdata") {
      value += ` ${textValue(node[tag])}`;
      continue;
    }
    if (tag === ":@") continue;
    value += ` ${collectText(getNodeChildren(node))}`;
  }
  return value;
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

function bodyContainsText(body, text) {
  return normalizeText(body).includes(normalizeText(text));
}

function editorBodyToPlainText(body) {
  try {
    return editorDocumentToPlainText(JSON.parse(body));
  } catch {
    return body;
  }
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

function pageSummary(page) {
  return {
    id: page.id,
    notebookName: page.notebookName,
    title: page.title,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
    bodyEditCount: page.bodyEditCount,
  };
}

function countBy(rows, field) {
  return rows.reduce((counts, row) => {
    counts[row[field]] = (counts[row[field]] ?? 0) + 1;
    return counts;
  }, {});
}

function uniqueTexts(values) {
  const seen = new Set();
  const out = [];
  for (const value of values.map(normalizeText).filter(Boolean)) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function keyFor(notebookName, title) {
  return `${notebookName.trim().toLowerCase()}\0${title.trim().toLowerCase()}`;
}

function cleanEnml(enml) {
  return unwrapCdata(enml).replace(/<\?xml[^>]*>/gi, "").replace(/<!DOCTYPE[^>]*>/gi, "").trim();
}

function unwrapCdata(value) {
  return value.replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "");
}

function stripTags(value) {
  return value.replace(/<[^>]+>/g, "");
}

function getNodeTag(node) {
  return Object.keys(node).find((key) => key !== ":@") ?? "";
}

function getNodeChildren(node) {
  const tag = getNodeTag(node);
  const value = node[tag];
  return Array.isArray(value) ? value : [];
}

function textValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") {
    if ("__cdata" in value) return textValue(value.__cdata);
    if ("#text" in value) return textValue(value["#text"]);
  }
  return "";
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

function progressFor(bytesRead, fileSize) {
  const percent = fileSize > 0 ? Math.min(100, Math.floor((bytesRead / fileSize) * 100)) : 100;
  return { bytesRead, percent };
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Number(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1);
  return `${rounded}${units[unit]}`;
}

function formatDuration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes === 0) return `${remainingSeconds}s`;
  return `${minutes}m ${remainingSeconds}s`;
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
    if (arg === "--database") parsed.database = readValue();
    else if (arg === "--enex-root") parsed.enexRoot = readValue();
    else if (arg === "--report-dir") parsed.reportDir = readValue();
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`Usage:
node ops/enex-repair/analyze-nested-list-loss.mjs \\
  --database /app-data/data/eln.sqlite3 \\
  --enex-root /evernote-imports \\
  --report-dir /app-data/enex-repair-reports
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}
