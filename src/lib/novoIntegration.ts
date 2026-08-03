import { createHash } from "node:crypto";
import { bodyToEditorText } from "./editor";
import { ensureDatabase, findUserById } from "./store";
import { queryOne, querySql, sql } from "./sqlite";
import type { AccessRole, AppUser, BlockType } from "./types";

export const novoIntegrationApiVersion = "1";
export const defaultIntegrationPageLimit = 100;
export const maximumIntegrationPageLimit = 100;

export type IntegrationNotebookContext = {
  id: string;
  name: string;
  accessRole: AccessRole;
  contentRevision: string;
  updatedAt: string;
  pageCount: number;
  attachmentCount: number;
  textChars: number;
};

export type IntegrationContext = {
  user: AppUser;
  notebooks: IntegrationNotebookContext[];
};

export type IntegrationPage = {
  id: string;
  title: string;
  text: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  attachments: Array<{
    id: string;
    name: string;
    mimeType: string;
    size: number;
    blockType: BlockType;
    createdAt: string;
  }>;
  sourceUrl: string;
};

type IntegrationNotebookIdentity = {
  id: string;
  name: string;
  accessRole: AccessRole;
  contentRevision: string;
};

export type IntegrationPageBatchResult =
  | {
    status: "ok";
    notebook: IntegrationNotebookIdentity;
    pages: IntegrationPage[];
    nextAfterPageId: string | null;
    complete: boolean;
  }
  | { status: "not-found" }
  | { status: "stale"; contentRevision: string };

type IntegrationCursorPayload = {
  v: 1;
  notebookId: string;
  contentRevision: string;
  afterPageId: string;
};

export function getIntegrationContext(userId: string): IntegrationContext {
  ensureDatabase();
  const user = findUserById(userId);
  if (!user) throw new Error("User not found");
  const notebookRows = querySql(`
    SELECT
      n.id,
      n.name,
      n.updated_at,
      n.content_revision,
      CASE
        WHEN requesting_user.role = 'admin' THEN 'owner'
        WHEN nm.role = 'owner' THEN 'owner'
        WHEN nm.role = 'editor' THEN 'editor'
        ELSE 'viewer'
      END AS access_role
    FROM notebooks n
    JOIN users requesting_user ON requesting_user.id = ${sql(userId)}
    LEFT JOIN notebook_members nm
      ON nm.notebook_id = n.id AND nm.user_id = ${sql(userId)}
    WHERE requesting_user.role = 'admin' OR nm.user_id IS NOT NULL
    ORDER BY n.id COLLATE BINARY ASC
  `);
  const notebookIds = notebookRows.map((row) => row.id);
  const pageCountRows = notebookIds.length
    ? querySql(`
        SELECT
          notebook_id,
          COUNT(*) AS page_count,
          COALESCE(SUM(length(body)), 0) AS text_chars
        FROM pages
        WHERE notebook_id IN (${sqlList(notebookIds)})
        GROUP BY notebook_id
      `)
    : [];
  const attachmentCountRows = notebookIds.length
    ? querySql(`
        SELECT p.notebook_id, COUNT(*) AS attachment_count
        FROM attachments a
        JOIN pages p ON p.id = a.page_id
        WHERE p.notebook_id IN (${sqlList(notebookIds)})
        GROUP BY p.notebook_id
      `)
    : [];

  // Context is on the authorization and job-polling path, so keep it to
  // aggregate metadata. Exact editor normalization happens only in the
  // paginated export path. textChars is therefore a size hint, not an index
  // checksum or revision input.
  const pageCountByNotebook = new Map(
    pageCountRows.map((row) => [row.notebook_id, Number(row.page_count ?? 0)]),
  );
  const textCharsByNotebook = new Map(
    pageCountRows.map((row) => [row.notebook_id, Number(row.text_chars ?? 0)]),
  );
  const attachmentCountByNotebook = new Map(
    attachmentCountRows.map((row) => [row.notebook_id, Number(row.attachment_count ?? 0)]),
  );

  return {
    user,
    notebooks: notebookRows.map((row) => ({
      id: row.id,
      name: row.name,
      accessRole: normalizeAccessRole(row.access_role),
      contentRevision: contentRevisionToken(row.id, row.content_revision),
      updatedAt: normalizeDatabaseDate(row.updated_at),
      pageCount: pageCountByNotebook.get(row.id) ?? 0,
      attachmentCount: attachmentCountByNotebook.get(row.id) ?? 0,
      textChars: textCharsByNotebook.get(row.id) ?? 0,
    })),
  };
}

export function getIntegrationNotebookPageBatch(input: {
  userId: string;
  notebookId: string;
  expectedContentRevision: string;
  afterPageId?: string;
  limit?: number;
}): IntegrationPageBatchResult {
  ensureDatabase();
  const before = getReadableNotebookIdentity(input.userId, input.notebookId);
  if (!before) return { status: "not-found" };
  if (before.contentRevision !== input.expectedContentRevision) {
    return { status: "stale", contentRevision: before.contentRevision };
  }

  const limit = clampPageLimit(input.limit);
  const afterPageId = input.afterPageId ?? "";
  const candidateRows = querySql(`
    SELECT id, title, body, status, created_at, updated_at
    FROM pages
    WHERE notebook_id = ${sql(input.notebookId)}
      AND id COLLATE BINARY > ${sql(afterPageId)} COLLATE BINARY
    ORDER BY id COLLATE BINARY ASC
    LIMIT ${limit + 1}
  `);
  const pageRows = candidateRows.slice(0, limit);
  const pageIds = pageRows.map((row) => row.id);
  const tagRows = pageIds.length
    ? querySql(`
        SELECT pt.page_id, t.label
        FROM page_tags pt
        JOIN tags t ON t.id = pt.tag_id
        WHERE pt.page_id IN (${sqlList(pageIds)})
        ORDER BY pt.page_id COLLATE BINARY ASC, lower(t.label) ASC, t.label COLLATE BINARY ASC, t.id COLLATE BINARY ASC
      `)
    : [];
  const attachmentRows = pageIds.length
    ? querySql(`
        SELECT id, page_id, original_name, mime_type, size, block_type, created_at
        FROM attachments
        WHERE page_id IN (${sqlList(pageIds)})
        ORDER BY page_id COLLATE BINARY ASC, id COLLATE BINARY ASC
      `)
    : [];

  const tagsByPage = groupRows(tagRows, "page_id");
  const attachmentsByPage = groupRows(attachmentRows, "page_id");
  const pages: IntegrationPage[] = pageRows.map((page) => ({
    id: page.id,
    title: page.title,
    text: normalizeIntegrationText(page.body),
    status: page.status,
    createdAt: normalizeDatabaseDate(page.created_at),
    updatedAt: normalizeDatabaseDate(page.updated_at),
    tags: (tagsByPage.get(page.id) ?? []).map((row) => row.label),
    attachments: (attachmentsByPage.get(page.id) ?? []).map((attachment) => ({
      id: attachment.id,
      name: attachment.original_name,
      mimeType: attachment.mime_type,
      size: Number(attachment.size ?? 0),
      blockType: normalizeBlockType(attachment.block_type),
      createdAt: normalizeDatabaseDate(attachment.created_at),
    })),
    sourceUrl: `/?page=${encodeURIComponent(page.id)}`,
  }));

  const after = getReadableNotebookIdentity(input.userId, input.notebookId);
  if (!after) return { status: "not-found" };
  if (after.contentRevision !== input.expectedContentRevision) {
    return { status: "stale", contentRevision: after.contentRevision };
  }

  const hasMore = candidateRows.length > limit;
  return {
    status: "ok",
    notebook: after,
    pages,
    nextAfterPageId: hasMore ? pageRows.at(-1)?.id ?? null : null,
    complete: !hasMore,
  };
}

export function encodeIntegrationCursor(input: {
  notebookId: string;
  contentRevision: string;
  afterPageId: string;
}) {
  const payload: IntegrationCursorPayload = { v: 1, ...input };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeIntegrationCursor(
  cursor: string | null,
  expected: { notebookId: string; contentRevision: string },
): { valid: true; afterPageId: string } | { valid: false } {
  if (!cursor) return { valid: true, afterPageId: "" };
  if (cursor.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(cursor)) return { valid: false };
  try {
    const payload = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<IntegrationCursorPayload>;
    if (
      payload.v !== 1
      || payload.notebookId !== expected.notebookId
      || payload.contentRevision !== expected.contentRevision
      || typeof payload.afterPageId !== "string"
      || !payload.afterPageId
      || payload.afterPageId.length > 512
    ) {
      return { valid: false };
    }
    return { valid: true, afterPageId: payload.afterPageId };
  } catch {
    return { valid: false };
  }
}

export function parseIntegrationIfMatch(value: string | null):
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "ok"; contentRevision: string } {
  if (!value) return { status: "missing" };
  const match = value.trim().match(/^"(sha256:[a-f0-9]{64})"$/);
  return match ? { status: "ok", contentRevision: match[1] } : { status: "invalid" };
}

export function quoteContentRevision(contentRevision: string) {
  return `"${contentRevision}"`;
}

function getReadableNotebookIdentity(userId: string, notebookId: string): IntegrationNotebookIdentity | null {
  const user = findUserById(userId);
  if (!user) return null;
  const row = queryOne(`
    SELECT
      n.id,
      n.name,
      n.content_revision,
      CASE
        WHEN requesting_user.role = 'admin' THEN 'owner'
        WHEN nm.role = 'owner' THEN 'owner'
        WHEN nm.role = 'editor' THEN 'editor'
        ELSE 'viewer'
      END AS access_role
    FROM notebooks n
    JOIN users requesting_user ON requesting_user.id = ${sql(userId)}
    LEFT JOIN notebook_members nm
      ON nm.notebook_id = n.id AND nm.user_id = ${sql(userId)}
    WHERE n.id = ${sql(notebookId)}
      AND (requesting_user.role = 'admin' OR nm.user_id IS NOT NULL)
    LIMIT 1
  `);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    accessRole: normalizeAccessRole(row.access_role),
    contentRevision: contentRevisionToken(row.id, row.content_revision),
  };
}

function contentRevisionToken(notebookId: string, revisionValue: string | undefined) {
  const revision = Number.parseInt(revisionValue ?? "", 10);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error("Notebook content revision is invalid.");
  }
  const digest = createHash("sha256")
    .update("novo-content-revision-v1\0", "utf8")
    .update(notebookId, "utf8")
    .update("\0", "utf8")
    .update(String(revision), "utf8")
    .digest("hex");
  return `sha256:${digest}`;
}

function normalizeIntegrationText(body: string | undefined) {
  return bodyToEditorText(body ?? "").replace(/\r\n?/g, "\n").trimEnd();
}

function normalizeDatabaseDate(value: string | undefined) {
  const raw = value?.trim() ?? "";
  if (!raw) return "";
  const sqliteUtc = raw.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d+))?$/);
  const candidate = sqliteUtc
    ? `${sqliteUtc[1]}T${sqliteUtc[2]}${sqliteUtc[3] ? `.${sqliteUtc[3]}` : ""}Z`
    : raw;
  const timestamp = Date.parse(candidate);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : raw;
}

function normalizeAccessRole(value: string | undefined): AccessRole {
  if (value === "owner" || value === "editor") return value;
  return "viewer";
}

function normalizeBlockType(value: string | undefined): BlockType {
  if (["image", "sheet", "pdf", "slides", "sequence"].includes(value ?? "")) return value as BlockType;
  return "file";
}

function clampPageLimit(value: number | undefined) {
  if (!Number.isFinite(value)) return defaultIntegrationPageLimit;
  return Math.min(maximumIntegrationPageLimit, Math.max(1, Math.floor(value ?? defaultIntegrationPageLimit)));
}

function sqlList(values: string[]) {
  return values.map(sql).join(", ");
}

function groupRows(rows: Array<Record<string, string>>, key: string) {
  const groups = new Map<string, Array<Record<string, string>>>();
  for (const row of rows) {
    const group = groups.get(row[key]) ?? [];
    group.push(row);
    groups.set(row[key], group);
  }
  return groups;
}
