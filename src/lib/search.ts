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
  const rows = querySql(`
    SELECT
      f.page_id,
      f.project_id,
      f.notebook_id,
      f.title,
      f.project,
      f.notebook,
      f.body,
      f.tags,
      f.attachments,
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
      bm25_score ASC,
      datetime(f.updated_at) DESC
    LIMIT ${Math.max(1, Math.min(queryLimit, 200))}
  `);

  return rows
    .map((row): SearchResult & { matchedTokenCount: number } => {
      const searchableText = [row.title, row.body, row.tags, row.attachments, row.project, row.notebook].join(" ");
      const matchedTokenCount = countMatchedTokens(tokens, searchableText);
      const titleMatchedTokenCount = countMatchedTokens(tokens, row.title);
      const matchType = titleMatchedTokenCount >= relaxedMinimumMatchCount(tokens.length) ? "title" : row.match_type;
      return {
        pageId: row.page_id,
        projectId: row.project_id,
        notebookId: row.notebook_id,
        title: row.title,
        projectName: row.project,
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
      const contextScore = Math.max(fuzzyFieldScore(tokens, page.projectName), fuzzyFieldScore(tokens, page.notebookName)) * 0.9;
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
      projectId: page.projectId,
      notebookId: page.notebookId,
      title: page.title,
      projectName: page.projectName,
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
    if (!existing) {
      merged.set(result.pageId, result);
      continue;
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

function buildFtsQuery(tokens: string[], mode: "strict" | "relaxed") {
  if (!tokens.length) return "";
  const operator = mode === "strict" ? " AND " : " OR ";
  return tokens.map((token) => `${token.replace(/"/g, "\"\"")}*`).join(operator);
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
  const textCoverage = matchedTokens / input.tokens.length;
  const titleWords = tokenize(input.title);
  const titleSequenceBoost = containsTokenSequence(titleWords, input.tokens) ? 120 : 0;
  const partialTitleSequenceBoost = (longestTokenSequenceLength(titleWords, input.tokens) / input.tokens.length) * 80;
  const literalTitleBoost = normalizeSearchText(input.title).includes(normalizeSearchText(input.query)) ? 60 : 0;
  const bm25Boost = Number.isFinite(input.bm25Score) ? Math.max(-input.bm25Score, 0) : 0;

  return titleSequenceBoost + partialTitleSequenceBoost + literalTitleBoost + titleCoverage * 80 + textCoverage * 40 + bm25Boost;
}

function normalizeSearchText(value: string) {
  return tokenize(value).join(" ");
}

function containsTokenSequence(words: string[], sequence: string[]) {
  if (!sequence.length || sequence.length > words.length) return false;
  for (let index = 0; index <= words.length - sequence.length; index += 1) {
    const candidate = words.slice(index, index + sequence.length);
    if (candidate.every((word, offset) => word.startsWith(sequence[offset]) || sequence[offset].startsWith(word))) return true;
  }
  return false;
}

function longestTokenSequenceLength(words: string[], sequence: string[]) {
  let best = 0;
  for (let start = 0; start < sequence.length; start += 1) {
    for (let wordIndex = 0; wordIndex < words.length; wordIndex += 1) {
      let length = 0;
      while (
        start + length < sequence.length &&
        wordIndex + length < words.length &&
        (words[wordIndex + length].startsWith(sequence[start + length]) || sequence[start + length].startsWith(words[wordIndex + length]))
      ) {
        length += 1;
      }
      best = Math.max(best, length);
    }
  }
  return best;
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
