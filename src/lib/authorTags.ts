import { randomUUID } from "node:crypto";
import { queryOne, querySql, sql } from "./sqlite";

export function normalizeAuthorTag(label: string) {
  const value = label.normalize("NFC").trim().replace(/\s+/g, " ");
  if (!value) throw new Error("Author tag is required.");
  if (value.length > 80) throw new Error("Author tag must be 80 characters or fewer.");
  return value;
}

export function authorTagKey(label: string) {
  return label.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

function shorten(value: string, length: number) {
  let result = "";
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)) {
    if (result.length + segment.length > length) break;
    result += segment;
  }
  return result.trim();
}

export function* authorTagCandidates(firstName: string, lastName: string) {
  const first = normalizeAuthorTag(shorten(firstName.normalize("NFC").trim().replace(/\s+/g, " "), 80));
  const last = shorten(lastName.normalize("NFC").replace(/\s+/g, ""), 60);
  yield first;
  let prefix = "";
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(last)) {
    prefix += segment;
    yield `${shorten(first, 79 - prefix.length)}-${prefix}`;
  }
  const stem = last ? `${shorten(first, 79 - last.length)}-${last}` : first;
  for (let number = 2; ; number += 1) {
    const suffix = `-${number}`;
    yield `${shorten(stem, 80 - suffix.length)}${suffix}`;
  }
}

export function newAuthorTag(firstName: string, lastName: string) {
  const occupied = new Set(querySql("SELECT label FROM tags").map((tag) => authorTagKey(tag.label)));
  for (const label of authorTagCandidates(firstName, lastName)) {
    if (!occupied.has(authorTagKey(label))) return { id: randomUUID(), label };
  }
  throw new Error("Unable to generate an author tag.");
}

export function getAuthorTag(userId: string) {
  return queryOne(`SELECT t.id, t.label FROM user_author_tags a JOIN tags t ON t.id = a.tag_id WHERE a.user_id = ${sql(userId)}`);
}

export function authorTagSelectSql(userIdColumn: string) {
  return `(SELECT t.label FROM user_author_tags a JOIN tags t ON t.id = a.tag_id WHERE a.user_id = ${userIdColumn})`;
}

export function insertAuthorTagSql(userId: string, tag: { id: string; label: string }) {
  return `
    INSERT INTO tags (id, label) VALUES (${sql(tag.id)}, ${sql(tag.label)});
    INSERT INTO user_author_tags (user_id, tag_id, label_key) VALUES (${sql(userId)}, ${sql(tag.id)}, ${sql(authorTagKey(tag.label))});
  `;
}

export function assertAuthorTagAvailable(label: string, ownTagId?: string) {
  const key = authorTagKey(label);
  if (querySql("SELECT id, label FROM tags").some((tag) => tag.id !== ownTagId && authorTagKey(tag.label) === key)) {
    throw new Error("That tag already exists. Choose a different author tag.");
  }
}

export function renameAuthorTagSql(tagId: string, label: string) {
  return `UPDATE user_author_tags SET label_key = ${sql(authorTagKey(label))} WHERE tag_id = ${sql(tagId)};`;
}

export function pageAuthorTagInsertSql(userId: string, pageId: string) {
  return `
    INSERT INTO page_tags (page_id, tag_id)
    SELECT ${sql(pageId)}, a.tag_id FROM user_author_tags a
    WHERE a.user_id = ${sql(userId)}
      AND EXISTS (SELECT 1 FROM app_settings WHERE key = 'add_author_tag_to_new_pages' AND value = '1')
    ON CONFLICT (page_id, tag_id) DO NOTHING;
  `;
}

export function isAuthorTagConflict(error: unknown) {
  const detail = String((error as { stderr?: unknown })?.stderr ?? "");
  return /UNIQUE constraint failed: (tags\.|user_author_tags\.)|unique constraint "(?:tags_label_unique_idx|user_author_tags_[^" ]+)"/i.test(detail);
}
