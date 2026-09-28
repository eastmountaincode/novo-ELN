import { randomUUID } from "node:crypto";
import { findUserById } from "./store";
import { isPostgresDatabase, queryOne, querySql, sql, type SqlRow } from "./sqlite";
import type { SharedLink } from "./sharedLinkTypes";

export class SharedLinkError extends Error {
  constructor(message: string, public readonly status: number = 400) {
    super(message);
  }
}

function requireMember(userId: string) {
  // Novo currently has one group per instance, shared by all active users.
  if (!findUserById(userId)) throw new SharedLinkError("Forbidden", 403);
}

function validateLink(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new SharedLinkError("Enter a title and URL.");
  }
  const { title, url, description = "" } = input as Record<string, unknown>;
  if (typeof title !== "string" || !title.trim() || title.trim().length > 200) {
    throw new SharedLinkError("Enter a title of up to 200 characters.");
  }
  if (typeof url !== "string" || !url.trim() || url.trim().length > 2048) {
    throw new SharedLinkError("Enter a URL of up to 2,048 characters.");
  }
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new SharedLinkError("Enter a complete URL starting with https:// or http://.");
  }
  if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new SharedLinkError("Use an http:// or https:// URL without embedded login details.");
  }
  if (parsed.href.length > 2048) throw new SharedLinkError("Enter a URL of up to 2,048 characters.");
  if (typeof description !== "string" || description.trim().length > 1000) {
    throw new SharedLinkError("Keep the description under 1,001 characters.");
  }
  return { title: title.trim(), url: parsed.href, description: description.trim() };
}

function toLink(row: SqlRow): SharedLink {
  return { id: row.id, title: row.title, url: row.url, description: row.description };
}

export function listSharedLinks(userId: string): SharedLink[] {
  requireMember(userId);
  return querySql("SELECT id, title, url, description FROM shared_links ORDER BY sort_order, lower(title), id").map(toLink);
}

// Serialize ordering and appends, including the membership check, on one connection.
function queryLinkOrderWrite(statement: string) {
  return querySql(`
    ${isPostgresDatabase() ? "BEGIN; LOCK TABLE shared_links IN SHARE ROW EXCLUSIVE MODE;" : "BEGIN IMMEDIATE;"}
    ${statement}
    COMMIT;
  `);
}

export function createSharedLink(userId: string, input: unknown): SharedLink {
  requireMember(userId);
  const link = validateLink(input);
  const [row] = queryLinkOrderWrite(`
    INSERT INTO shared_links (id, title, url, description, sort_order)
    SELECT ${sql(randomUUID())}, ${sql(link.title)}, ${sql(link.url)}, ${sql(link.description)},
      COALESCE(MAX(sort_order), -1) + 1 FROM shared_links
    RETURNING id, title, url, description;
  `);
  if (!row) throw new Error("Unable to create link.");
  return toLink(row);
}

export function reorderSharedLinks(userId: string, input: unknown): SharedLink[] {
  requireMember(userId);
  const ids = input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>).ids : null;
  if (!Array.isArray(ids) || ids.length === 0 ||
      ids.some((id) => typeof id !== "string" || !id || id.length > 200) ||
      new Set(ids).size !== ids.length) {
    throw new SharedLinkError("Provide each link exactly once.");
  }
  const rows = queryLinkOrderWrite(`
    WITH requested(id, position) AS (VALUES ${ids.map((id, index) => `(${sql(id)}, ${index})`).join(", ")})
    UPDATE shared_links
    SET sort_order = (SELECT position FROM requested WHERE requested.id = shared_links.id)
    WHERE (SELECT COUNT(*) FROM shared_links) = ${ids.length}
      AND NOT EXISTS (SELECT 1 FROM requested WHERE NOT EXISTS (SELECT 1 FROM shared_links WHERE shared_links.id = requested.id))
    RETURNING id, title, url, description;
  `);
  if (rows.length !== ids.length) {
    throw new SharedLinkError("The links changed. Reload the page and try again.", 409);
  }
  const linksById = new Map(rows.map((row) => [row.id, toLink(row)]));
  return ids.map((id) => linksById.get(id)!);
}

export function updateSharedLink(userId: string, id: string, input: unknown): SharedLink {
  requireMember(userId);
  const link = validateLink(input);
  const row = queryOne(`
    UPDATE shared_links SET title = ${sql(link.title)}, url = ${sql(link.url)},
      description = ${sql(link.description)}
    WHERE id = ${sql(id)} RETURNING id, title, url, description;
  `);
  if (!row) throw new SharedLinkError("This link no longer exists. Refresh the list to see the latest links.", 404);
  return toLink(row);
}

export function deleteSharedLink(userId: string, id: string) {
  requireMember(userId);
  const row = queryOne(`DELETE FROM shared_links WHERE id = ${sql(id)} RETURNING id;`);
  if (!row) throw new SharedLinkError("This link no longer exists. Refresh the list to see the latest links.", 404);
}
