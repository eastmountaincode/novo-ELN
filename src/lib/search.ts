import { bodyToEditorText } from "./editor";
import { execSql, querySql, sql } from "./sqlite";
import type { SearchMatchType, SearchResult } from "./types";

type SearchablePage = {
  pageId: string;
  projectId: string;
  notebookId: string;
  title: string;
  body: string;
  tags: string;
  attachments: string;
  projectName: string;
  notebookName: string;
  updatedAt: string;
};

export function rebuildSearchIndex() {
  execSql(`
    DELETE FROM search_pages_fts;
  `);

  const rows = getAllSearchablePages();
  if (!rows.length) return;

  execSql(rows.map((row) => `
    INSERT INTO search_pages_fts (page_id, project_id, notebook_id, title, body, tags, attachments, project, notebook, updated_at)
    VALUES (${sql(row.pageId)}, ${sql(row.projectId)}, ${sql(row.notebookId)}, ${sql(row.title)}, ${sql(row.body)}, ${sql(row.tags)}, ${sql(row.attachments)}, ${sql(row.projectName)}, ${sql(row.notebookName)}, ${sql(row.updatedAt)});
  `).join("\n"));
}

export function searchWorkspace(userId: string, rawQuery: string, limit = 30): SearchResult[] {
  const query = rawQuery.trim();
  if (!query) return [];

  const ftsResults = searchFts(userId, query, limit);
  const fuzzyResults = searchFuzzy(userId, query, limit);
  return mergeSearchResults(ftsResults, fuzzyResults).slice(0, limit);
}

function searchFts(userId: string, query: string, limit: number): SearchResult[] {
  const match = buildFtsQuery(query);
  if (!match) return [];
  const literal = `%${query.toLowerCase()}%`;
  const rows = querySql(`
    SELECT
      f.page_id,
      f.project_id,
      f.notebook_id,
      f.title,
      f.project,
      f.notebook,
      f.updated_at,
      snippet(search_pages_fts, -1, '', '', '...', 28) AS snippet,
      bm25(search_pages_fts, 0.0, 0.0, 0.0, 8.0, 2.0, 2.0, 3.0, 1.5, 1.5, 0.0) AS bm25_score,
      CASE
        WHEN lower(f.title) LIKE ${sql(literal)} THEN 'title'
        WHEN lower(f.attachments) LIKE ${sql(literal)} THEN 'attachment'
        ELSE 'content'
      END AS match_type
    FROM search_pages_fts f
    LEFT JOIN project_members pm ON pm.project_id = f.project_id AND pm.user_id = ${sql(userId)}
    LEFT JOIN notebook_members nm ON nm.notebook_id = f.notebook_id AND nm.user_id = ${sql(userId)}
    WHERE (pm.user_id IS NOT NULL OR nm.user_id IS NOT NULL)
      AND search_pages_fts MATCH ${sql(match)}
    ORDER BY
      CASE WHEN lower(f.title) LIKE ${sql(literal)} THEN 0 ELSE 1 END,
      bm25_score ASC,
      datetime(f.updated_at) DESC
    LIMIT ${Math.max(1, Math.min(limit, 100))}
  `);

  return rows.map((row): SearchResult => ({
    pageId: row.page_id,
    projectId: row.project_id,
    notebookId: row.notebook_id,
    title: row.title,
    projectName: row.project,
    notebookName: row.notebook,
    snippet: cleanSnippet(row.snippet),
    updatedAt: row.updated_at,
    matchType: row.match_type as SearchMatchType,
    score: Number(row.bm25_score),
  }));
}

function searchFuzzy(userId: string, query: string, limit: number): SearchResult[] {
  const tokens = tokenize(query);
  if (!tokens.length) return [];

  return getUserSearchablePages(userId)
    .map((page) => {
      const titleScore = fuzzyFieldScore(tokens, page.title) * 1.2;
      const attachmentScore = fuzzyFieldScore(tokens, page.attachments);
      const contextScore = Math.max(fuzzyFieldScore(tokens, page.projectName), fuzzyFieldScore(tokens, page.notebookName)) * 0.9;
      const bodyScore = fuzzyFieldScore(tokens, page.body) * 0.75;
      const score = Math.max(titleScore, attachmentScore, contextScore, bodyScore);
      const matchType: SearchMatchType = score === titleScore ? "title" : score === attachmentScore ? "attachment" : "fuzzy";
      return { page, score, matchType };
    })
    .filter((result) => result.score >= 0.62)
    .sort((a, b) => b.score - a.score || Date.parse(b.page.updatedAt) - Date.parse(a.page.updatedAt))
    .slice(0, limit)
    .map(({ page, score, matchType }): SearchResult => ({
      pageId: page.pageId,
      projectId: page.projectId,
      notebookId: page.notebookId,
      title: page.title,
      projectName: page.projectName,
      notebookName: page.notebookName,
      snippet: makeSnippet(page.body || page.attachments || page.tags, query),
      updatedAt: page.updatedAt,
      matchType,
      score: 1 - score,
    }));
}

function mergeSearchResults(primary: SearchResult[], fuzzy: SearchResult[]) {
  const merged = new Map<string, SearchResult>();
  for (const result of primary) merged.set(result.pageId, result);
  for (const result of fuzzy) {
    const existing = merged.get(result.pageId);
    if (!existing) {
      merged.set(result.pageId, result);
      continue;
    }
    if (existing.matchType === "content" && result.matchType === "title") {
      merged.set(result.pageId, { ...existing, matchType: "title" });
    }
  }
  return [...merged.values()];
}

function getAllSearchablePages(): SearchablePage[] {
  return mapSearchRows(querySql(`
    SELECT
      p.id AS page_id,
      n.project_id,
      p.notebook_id,
      p.title,
      p.body,
      p.updated_at,
      n.name AS notebook_name,
      pr.name AS project_name,
      COALESCE(group_concat(DISTINCT pt.tag), '') AS tags,
      COALESCE(group_concat(DISTINCT a.original_name), '') AS attachments,
      COALESCE(group_concat(DISTINCT a.preview_text), '') AS attachment_previews
    FROM pages p
    JOIN notebooks n ON n.id = p.notebook_id
    JOIN projects pr ON pr.id = n.project_id
    LEFT JOIN page_tags pt ON pt.page_id = p.id
    LEFT JOIN attachments a ON a.page_id = p.id
    GROUP BY p.id
  `));
}

function getUserSearchablePages(userId: string): SearchablePage[] {
  return mapSearchRows(querySql(`
    SELECT
      p.id AS page_id,
      n.project_id,
      p.notebook_id,
      p.title,
      p.body,
      p.updated_at,
      n.name AS notebook_name,
      pr.name AS project_name,
      COALESCE(group_concat(DISTINCT pt.tag), '') AS tags,
      COALESCE(group_concat(DISTINCT a.original_name), '') AS attachments,
      COALESCE(group_concat(DISTINCT a.preview_text), '') AS attachment_previews
    FROM pages p
    JOIN notebooks n ON n.id = p.notebook_id
    JOIN projects pr ON pr.id = n.project_id
    LEFT JOIN project_members pm ON pm.project_id = pr.id AND pm.user_id = ${sql(userId)}
    LEFT JOIN notebook_members nm ON nm.notebook_id = n.id AND nm.user_id = ${sql(userId)}
    LEFT JOIN page_tags pt ON pt.page_id = p.id
    LEFT JOIN attachments a ON a.page_id = p.id
    WHERE pm.user_id IS NOT NULL OR nm.user_id IS NOT NULL
    GROUP BY p.id
  `));
}

function mapSearchRows(rows: Record<string, string>[]): SearchablePage[] {
  return rows.map((row) => ({
    pageId: row.page_id,
    projectId: row.project_id,
    notebookId: row.notebook_id,
    title: row.title,
    body: `${bodyToEditorText(row.body)} ${row.attachment_previews}`.trim(),
    tags: row.tags,
    attachments: row.attachments,
    projectName: row.project_name,
    notebookName: row.notebook_name,
    updatedAt: row.updated_at,
  }));
}

function buildFtsQuery(query: string) {
  const tokens = tokenize(query);
  if (!tokens.length) return "";
  return tokens.map((token) => `${token.replace(/"/g, "\"\"")}*`).join(" AND ");
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z0-9_]+/g) ?? [];
}

function fuzzyFieldScore(queryTokens: string[], field: string) {
  const words = tokenize(field);
  if (!words.length) return 0;
  const total = queryTokens.reduce((sum, token) => {
    const best = words.reduce((max, word) => Math.max(max, tokenSimilarity(token, word)), 0);
    return sum + best;
  }, 0);
  return total / queryTokens.length;
}

function tokenSimilarity(a: string, b: string) {
  if (b.includes(a) || a.includes(b)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  const maxLength = Math.max(a.length, b.length);
  if (!maxLength) return 1;
  return 1 - levenshtein(a, b) / maxLength;
}

function levenshtein(a: string, b: string) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }
  return previous[b.length];
}

function cleanSnippet(snippet: string) {
  return snippet.replace(/\s+/g, " ").trim();
}

function makeSnippet(text: string, query: string) {
  const clean = cleanSnippet(text);
  if (!clean) return "";
  const index = clean.toLowerCase().indexOf(tokenize(query)[0] ?? "");
  if (index < 0) return clean.slice(0, 180);
  const start = Math.max(0, index - 60);
  return `${start > 0 ? "..." : ""}${clean.slice(start, start + 180)}${start + 180 < clean.length ? "..." : ""}`;
}
