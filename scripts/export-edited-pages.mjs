import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

const cwd = process.cwd();
const databasePath = process.env.ELN_DATABASE_PATH || path.join(cwd, "data", "eln.sqlite3");
const uploadDir = process.env.ELN_UPLOAD_DIR || path.join(cwd, "storage", "uploads");

const options = parseArgs(process.argv.slice(2));
if (!options.since) fail("Missing --since 'YYYY-MM-DD HH:MM:SS'.");
if (!options.out) fail("Missing --out /absolute/output/dir.");
if (!path.isAbsolute(options.out)) fail("--out must be an absolute path inside the container or server.");

await run();

async function run() {
  await fsp.mkdir(options.out, { recursive: true });
  const rows = queryJson(`
    WITH touched_pages AS (
      SELECT id AS page_id FROM pages WHERE datetime(updated_at) >= datetime(${sql(options.since)})
      UNION
      SELECT page_id FROM audit_events WHERE page_id IS NOT NULL AND datetime(updated_at) >= datetime(${sql(options.since)})
    )
    SELECT
      p.id AS page_id,
      p.title,
      p.body,
      p.status,
      p.created_at,
      p.updated_at,
      n.id AS notebook_id,
      n.name AS notebook_name,
      COALESCE((SELECT json_group_array(tag) FROM page_tags WHERE page_id = p.id ORDER BY lower(tag)), '[]') AS tags_json,
      COALESCE((
        SELECT json_group_array(json_object(
          'id', id,
          'originalName', original_name,
          'mimeType', mime_type,
          'size', size,
          'storageKey', storage_key,
          'blockType', block_type,
          'createdAt', created_at
        ))
        FROM attachments
        WHERE page_id = p.id
        ORDER BY datetime(created_at), original_name
      ), '[]') AS attachments_json,
      COALESCE((SELECT max(updated_at) FROM audit_events WHERE page_id = p.id), p.updated_at) AS last_activity_at
    FROM touched_pages tp
    JOIN pages p ON p.id = tp.page_id
    JOIN notebooks n ON n.id = p.notebook_id
    ORDER BY datetime(last_activity_at) DESC, lower(n.name), lower(p.title);
  `);

  const exported = [];
  for (const [index, row] of rows.entries()) {
    const safeBase = `${String(index + 1).padStart(2, "0")}-${safeFileName(row.notebook_name)}-${safeFileName(row.title)}`.slice(0, 180);
    const pageDir = path.join(options.out, safeBase);
    const attachmentDir = path.join(pageDir, "attachments");
    await fsp.mkdir(attachmentDir, { recursive: true });

    const tags = parseJson(row.tags_json, []);
    const attachments = parseJson(row.attachments_json, []);
    const bodyText = editorBodyToText(row.body).trimEnd();
    const record = {
      pageId: row.page_id,
      notebookId: row.notebook_id,
      notebookName: row.notebook_name,
      title: row.title,
      status: row.status,
      tags,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastActivityAt: row.last_activity_at,
      attachments,
      body: parseJson(row.body, row.body),
      bodyText,
    };
    await fsp.writeFile(path.join(pageDir, "page.json"), `${JSON.stringify(record, null, 2)}\n`);
    await fsp.writeFile(path.join(pageDir, "body.txt"), `${headerFor(record)}\n\n${bodyText}\n`);

    for (const attachment of attachments) {
      const source = path.resolve(uploadDir, attachment.storageKey || "");
      if (!source.startsWith(`${path.resolve(uploadDir)}${path.sep}`) || !fs.existsSync(source)) continue;
      await fsp.copyFile(source, path.join(attachmentDir, safeFileName(attachment.originalName || attachment.id || "attachment")));
    }
    exported.push({ ...record, body: undefined, bodyText: undefined });
  }

  await fsp.writeFile(path.join(options.out, "edited-pages-summary.json"), `${JSON.stringify(exported, null, 2)}\n`);
  await fsp.writeFile(path.join(options.out, "README.md"), readmeFor(exported));
  process.stdout.write(`Exported ${exported.length} edited pages to ${options.out}\n`);
}

function headerFor(record) {
  return [
    `Notebook: ${record.notebookName}`,
    `Page: ${record.title}`,
    `Page ID: ${record.pageId}`,
    `Status: ${record.status || "No status"}`,
    `Tags: ${record.tags.join(", ") || "None"}`,
    `Created: ${record.createdAt}`,
    `Updated: ${record.updatedAt}`,
    `Last activity: ${record.lastActivityAt}`,
    `Attachments: ${record.attachments.length}`,
  ].join("\n");
}

function readmeFor(records) {
  const lines = [
    "# Edited Pages Export",
    "",
    `Created: ${new Date().toISOString()}`,
    `Since: ${options.since}`,
    "",
    "These are the pages touched before the Yarle reimport. Use these folders to manually reapply edits after the clean import.",
    "",
  ];
  for (const record of records) lines.push(`- ${record.notebookName} / ${record.title} (${record.pageId})`);
  return `${lines.join("\n")}\n`;
}

function editorBodyToText(body) {
  const doc = parseJson(body, null);
  if (!doc || doc.type !== "doc") return String(body || "");
  return editorNodeToText(doc);
}

function editorNodeToText(node) {
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "attachmentCard") return `[${node.attrs?.kind || "File"}: ${node.attrs?.filename || "attachment"}]\n`;
  const childText = Array.isArray(node.content) ? node.content.map(editorNodeToText).join("") : "";
  if (["paragraph", "heading", "blockquote", "listItem", "tableCell", "tableHeader"].includes(node.type || "")) return `${childText}\n`;
  return childText;
}

function queryJson(statement) {
  const output = execFileSync("sqlite3", ["-json", databasePath, statement], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  return parseJson(output || "[]", []);
}

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function sql(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function safeFileName(value) {
  return String(value || "untitled").replace(/[^a-zA-Z0-9._ -]/g, "_").replace(/\s+/g, "_").slice(0, 120) || "untitled";
}

function parseArgs(args) {
  const parsed = { since: "", out: "" };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (arg === "--since") { parsed.since = value || ""; index += 1; }
    else if (arg === "--out") { parsed.out = value || ""; index += 1; }
    else if (arg === "--help" || arg === "-h") usage();
    else fail(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function usage() {
  process.stdout.write("Usage: node scripts/export-edited-pages.mjs --since '2026-05-26 00:00:00' --out /app-data/manual-review/export-dir\n");
  process.exit(0);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
