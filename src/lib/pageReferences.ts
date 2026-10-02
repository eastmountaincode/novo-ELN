import { queryOne, querySql, sql } from "./sqlite";
import type { PageReferenceSuggestion } from "./pageReferenceTypes";

export function suggestPageReferences(userId: string, query: string, currentPageId = ""): PageReferenceSuggestion[] {
  const user = queryOne(`SELECT role FROM users WHERE id = ${sql(userId)} AND is_active = 1 LIMIT 1`);
  if (!user) return [];
  const prefix = query.trimStart().slice(0, 120).toLowerCase().replace(/[\\%_]/g, "\\$&");
  // Read pages directly so a rename or save is visible without waiting for the search index.
  return querySql(`
    SELECT p.id, p.title, n.name AS notebook_name, p.updated_at
    FROM pages p
    JOIN notebooks n ON n.id = p.notebook_id
    WHERE ${user.role === "admin" ? "1=1" : `EXISTS (
      SELECT 1 FROM notebook_members nm
      WHERE nm.notebook_id = p.notebook_id AND nm.user_id = ${sql(userId)}
    )`}
      AND p.id <> ${sql(currentPageId)}
      AND lower(ltrim(p.title)) LIKE ${sql(`${prefix}%`)} ESCAPE '\\'
    ORDER BY datetime(p.updated_at) DESC, p.updated_at DESC, p.id ASC
    LIMIT 8
  `).map((row) => ({ id: row.id, title: row.title, notebookName: row.notebook_name, updatedAt: row.updated_at }));
}
