import { bodyToEditorText } from "./editor";
import { execSql, querySql, sql } from "./sqlite";
import type { SearchMatchType, SearchResult } from "./types";

type SearchablePage = {
  pageId: string;
  notebookId: string;
  title: string;
  body: string;
  tags: string;
  attachments: string;
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
    INSERT INTO search_pages_fts (page_id, notebook_id, title, body, tags, attachments, notebook, updated_at)
    VALUES (${sql(row.pageId)}, ${sql(row.notebookId)}, ${sql(row.title)}, ${sql(row.body)}, ${sql(row.tags)}, ${sql(row.attachments)}, ${sql(row.notebookName)}, ${sql(row.updatedAt)});
  `).join("\n"));
}

export function searchWorkspace(userId: string, rawQuery: string, limit = 30): SearchResult[] {
  const query = rawQuery.trim();
  if (!query) return [];

  const strictResults = searchFts(userId, query, limit, "strict");
  const relaxedResults = searchFts(userId, query, limit, "relaxed");
  const ftsResults = mergeSearchResults(strictResults, relaxedResults).sort((a, b) => b.score - a.score);
  const fuzzyResults = searchFuzzy(userId, query, limit);
  return mergeSearchResults(ftsResults, fuzzyResults).slice(0, limit);
}

function searchFts(userId: string, query: string, limit: number, mode: "strict" | "relaxed"): SearchResult[] {
  const tokens = tokenize(query);
  const match = buildFtsQuery(tokens, mode);
  if (!match) return [];
  const literal = `%${query.toLowerCase()}%`;
  const queryLimit = mode === "strict" ? limit : Math.max(limit * 4, 60);
  const accessCondition = searchAccessCondition(userId, "n", "nm");
  const rows = querySql(`
    SELECT
      f.page_id,
      f.notebook_id,
      f.title,
      f.notebook,
      f.body,
      f.tags,
      f.attachments,
      f.updated_at,
      snippet(search_pages_fts, -1, '', '', '...', 28) AS snippet,
      bm25(search_pages_fts, 0.0, 0.0, 8.0, 2.0, 2.0, 3.0, 1.5, 0.0) AS bm25_score,
      CASE
        WHEN lower(f.title) LIKE ${sql(literal)} THEN 'title'
        WHEN lower(f.attachments) LIKE ${sql(literal)} THEN 'attachment'
        ELSE 'content'
      END AS match_type
    FROM search_pages_fts f
    JOIN notebooks n ON n.id = f.notebook_id
    LEFT JOIN notebook_members nm ON nm.notebook_id = n.id AND nm.user_id = ${sql(userId)}
    WHERE ${accessCondition}
      AND search_pages_fts MATCH ${sql(match)}
    ORDER BY
      bm25_score ASC,
      datetime(f.updated_at) DESC
    LIMIT ${Math.max(1, Math.min(queryLimit, 200))}
  `);

  return rows
    .map((row): SearchResult & { matchedTokenCount: number } => {
      const searchableText = [row.title, row.body, row.tags, row.attachments, row.notebook].join(" ");
      const matchedTokenCount = countMatchedTokens(tokens, searchableText);
      const titleMatchedTokenCount = countMatchedTokens(tokens, row.title);
      const matchType = titleMatchedTokenCount >= relaxedMinimumMatchCount(tokens.length) ? "title" : row.match_type;
      return {
        pageId: row.page_id,
        projectId: "workspace",
        notebookId: row.notebook_id,
        title: row.title,
        projectName: "Notebooks",
        notebookName: row.notebook,
        snippet: cleanSnippet(row.snippet),
        updatedAt: row.updated_at,
        matchType: matchType as SearchMatchType,
        score: scoreFtsResult({
          query,
          tokens,
          title: row.title,
          searchableText,
          bm25Score: Number(row.bm25_score),
        }),
        matchedTokenCount,
      };
    })
    .filter((result) => mode === "strict" || result.matchedTokenCount >= relaxedMinimumMatchCount(tokens.length))
    .sort((a, b) => b.score - a.score || Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, limit)
    .map((result) => ({
      pageId: result.pageId,
      projectId: result.projectId,
      notebookId: result.notebookId,
      title: result.title,
      projectName: result.projectName,
      notebookName: result.notebookName,
      snippet: result.snippet,
      updatedAt: result.updatedAt,
      matchType: result.matchType,
      score: result.score,
    }));
}

function searchFuzzy(userId: string, query: string, limit: number): SearchResult[] {
  const tokens = tokenize(query);
  if (!tokens.length) return [];

  return getUserSearchablePages(userId)
    .map((page) => {
      const titleScore = fuzzyFieldScore(tokens, page.title) * 1.2;
      const attachmentScore = fuzzyFieldScore(tokens, page.attachments);
      const contextScore = fuzzyFieldScore(tokens, page.notebookName) * 0.9;
      const bodyScore = fuzzyFieldScore(tokens, page.body) * 0.75;
      const score = Math.max(titleScore, attachmentScore, contextScore, bodyScore);
      const exactTokenMatches = countMatchedTokens(tokens, [page.title, page.body, page.tags, page.attachments].join(" "));
      const matchType: SearchMatchType = score === titleScore ? "title" : score === attachmentScore ? "attachment" : "fuzzy";
      return { page, score, matchType, exactTokenMatches };
    })
    .filter((result) => result.score >= 0.62 && (tokens.length === 1 || result.exactTokenMatches > 0))
    .sort((a, b) => b.score - a.score || Date.parse(b.page.updatedAt) - Date.parse(a.page.updatedAt))
    .slice(0, limit)
    .map(({ page, score, matchType }): SearchResult => ({
      pageId: page.pageId,
      projectId: "workspace",
      notebookId: page.notebookId,
      title: page.title,
      projectName: "Notebooks",
      notebookName: page.notebookName,
      snippet: makeSnippet(page.body || page.attachments || page.tags, query),
      updatedAt: page.updatedAt,
      matchType,
      score,
    }));
}

function mergeSearchResults(primary: SearchResult[], fuzzy: SearchResult[]) {
  const merged = new Map<string, SearchResult>();
  for (const result of primary) merged.set(result.pageId, result);
  for (const result of fuzzy) {
    const existing = merged.get(result.pageId);
    if (!existing) merged.set(result.pageId, result);
  }
  return [...merged.values()];
}

function getAllSearchablePages(): SearchablePage[] {
  return mapSearchRows(querySql(`
    SELECT
      p.id AS page_id,
      p.notebook_id,
      p.title,
      p.body,
      p.updated_at,
      n.name AS notebook_name,
      COALESCE(group_concat(DISTINCT pt.tag), '') AS tags,
      COALESCE(group_concat(DISTINCT a.original_name), '') AS attachments,
      COALESCE(group_concat(DISTINCT a.preview_text), '') AS attachment_previews
    FROM pages p
    JOIN notebooks n ON n.id = p.notebook_id
    LEFT JOIN page_tags pt ON pt.page_id = p.id
    LEFT JOIN attachments a ON a.page_id = p.id
    GROUP BY p.id
  `));
}

function getUserSearchablePages(userId: string): SearchablePage[] {
  const accessCondition = searchAccessCondition(userId, "n", "nm");
  return mapSearchRows(querySql(`
    SELECT
      p.id AS page_id,
      p.notebook_id,
      p.title,
      p.body,
      p.updated_at,
      n.name AS notebook_name,
      COALESCE(group_concat(DISTINCT pt.tag), '') AS tags,
      COALESCE(group_concat(DISTINCT a.original_name), '') AS attachments,
      COALESCE(group_concat(DISTINCT a.preview_text), '') AS attachment_previews
    FROM pages p
    JOIN notebooks n ON n.id = p.notebook_id
    LEFT JOIN notebook_members nm ON nm.notebook_id = n.id AND nm.user_id = ${sql(userId)}
    LEFT JOIN page_tags pt ON pt.page_id = p.id
    LEFT JOIN attachments a ON a.page_id = p.id
    WHERE ${accessCondition}
    GROUP BY p.id
  `));
}

function mapSearchRows(rows: Record<string, string>[]): SearchablePage[] {
  return rows.map((row) => ({
    pageId: row.page_id,
    notebookId: row.notebook_id,
    title: row.title,
    body: `${bodyToEditorText(row.body)} ${row.attachment_previews}`.trim(),
    tags: row.tags,
    attachments: row.attachments,
    notebookName: row.notebook_name,
    updatedAt: row.updated_at,
  }));
}

function searchAccessCondition(_userId: string, _notebookAlias: string, memberAlias: string) {
  return `${memberAlias}.user_id IS NOT NULL`;
}

function buildFtsQuery(tokens: string[], mode: "strict" | "relaxed") {
  if (!tokens.length) return "";
  const operator = mode === "strict" ? " AND " : " OR ";
  return tokens.map((token) => `${token.replace(/"/g, '""')}*`).join(operator);
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z0-9_]+/g) ?? [];
}

function countMatchedTokens(queryTokens: string[], field: string) {
  const words = tokenize(field);
  if (!words.length) return 0;
  return queryTokens.filter((token) => words.some((word) => word.startsWith(token) || word.includes(token))).length;
}

function relaxedMinimumMatchCount(tokenCount: number) {
  if (tokenCount <= 1) return 1;
  if (tokenCount <= 3) return 2;
  return Math.ceil(tokenCount * 0.6);
}

function scoreFtsResult(input: { query: string; tokens: string[]; title: string; searchableText: string; bm25Score: number }) {
  const titleMatchedTokens = countMatchedTokens(input.tokens, input.title);
  const matchedTokens = countMatchedTokens(input.tokens, input.searchableText);
  const titleCoverage = titleMatchedTokens / input.tokens.length;
  const coverage = matchedTokens / input.tokens.length;
  const exactPhraseBoost = input.searchableText.toLowerCase().includes(input.query.toLowerCase()) ? 1.8 : 1;
  const bm25Score = Number.isFinite(input.bm25Score) ? input.bm25Score : 0;
  const bm25Component = 1 / (1 + Math.max(0, bm25Score + 20));
  return coverage * 2.4 + titleCoverage * 2.2 + exactPhraseBoost + bm25Component;
}

function fuzzyFieldScore(tokens: string[], field: string) {
  const words = tokenize(field);
  if (!tokens.length || !words.length) return 0;
  const scores = tokens.map((token) => {
    let best = 0;
    for (const word of words) {
      if (word === token) best = Math.max(best, 1);
      else if (word.startsWith(token)) best = Math.max(best, 0.92);
      else if (word.includes(token)) best = Math.max(best, 0.78);
      else best = Math.max(best, 1 - levenshteinDistance(token, word.slice(0, Math.max(token.length, 1))) / Math.max(token.length, word.length));
    }
    return Math.max(0, Math.min(1, best));
  });
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

function levenshteinDistance(a: string, b: string) {
  const dp = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

function cleanSnippet(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function makeSnippet(value: string, query: string) {
  const text = cleanSnippet(value);
  if (!text) return "";
  const lowerText = text.toLowerCase();
  const index = lowerText.indexOf(query.toLowerCase());
  if (index === -1) return text.slice(0, 180);
  const start = Math.max(0, index - 70);
  const end = Math.min(text.length, index + query.length + 110);
  return `${start > 0 ? "..." : ""}${text.slice(start, end)}${end < text.length ? "..." : ""}`;
}
