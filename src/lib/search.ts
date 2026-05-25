import { bodyToEditorText } from "./editor";
import { execSql, queryOne, querySql, sql } from "./sqlite";
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

type SearchMode = "full" | "fast" | "approx";
type SearchFtsMode = "strict" | "relaxed" | "approx";
type TokenExpansion = { token: string; terms: string[] };

const searchIndexQueueBatchSize = 25;
const approximateCandidateLimit = 800;
const approximateAlternativesPerToken = 5;
let searchIndexDrainScheduled = false;
let searchIndexDrainRunning = false;

export function rebuildSearchIndex() {
  execSql(`
    DELETE FROM search_pages_fts;
  `);
  insertSearchRows(getAllSearchablePages());
}

export function updateSearchIndexForPage(pageId: string) {
  updateSearchIndexForPages([pageId]);
}

export function updateSearchIndexForNotebook(notebookId: string) {
  const pageRows = querySql(`SELECT id FROM pages WHERE notebook_id = ${sql(notebookId)}`);
  updateSearchIndexForPages(pageRows.map((row) => row.id));
}

export function queueSearchIndexForPage(pageId: string) {
  queueSearchIndexForPages([pageId]);
}

export function queueSearchIndexForNotebook(notebookId: string) {
  execSql(`
    INSERT INTO search_index_queue (page_id, queued_at)
    SELECT p.id, strftime('%s', 'now')
    FROM pages p
    WHERE p.notebook_id = ${sql(notebookId)}
    ON CONFLICT(page_id) DO UPDATE SET queued_at = excluded.queued_at;
  `);
  scheduleSearchIndexDrain();
}

export function queueSearchIndexForPages(pageIds: string[]) {
  const uniquePageIds = uniqueIds(pageIds);
  if (!uniquePageIds.length) return;
  execSql(uniquePageIds.map((pageId) => `
    INSERT INTO search_index_queue (page_id, queued_at)
    VALUES (${sql(pageId)}, strftime('%s', 'now'))
    ON CONFLICT(page_id) DO UPDATE SET queued_at = excluded.queued_at;
  `).join("\n"));
  scheduleSearchIndexDrain();
}

export function scheduleSearchIndexDrain(delayMs = 100) {
  if (searchIndexDrainScheduled || searchIndexDrainRunning) return;
  searchIndexDrainScheduled = true;
  const timer = setTimeout(drainSearchIndexQueue, delayMs);
  timer.unref?.();
}

function updateSearchIndexForPages(pageIds: string[]) {
  const uniquePageIds = uniqueIds(pageIds);
  if (!uniquePageIds.length) return;
  const pageIdList = inList(uniquePageIds);
  execSql(`DELETE FROM search_pages_fts WHERE page_id IN (${pageIdList});`);
  insertSearchRows(getSearchablePages(`WHERE p.id IN (${pageIdList})`));
}

function drainSearchIndexQueue() {
  if (searchIndexDrainRunning) return;
  searchIndexDrainScheduled = false;
  searchIndexDrainRunning = true;
  let shouldContinue = false;
  try {
    const rows = querySql(`
      SELECT page_id
      FROM search_index_queue
      ORDER BY queued_at ASC
      LIMIT ${searchIndexQueueBatchSize}
    `);
    const pageIds = rows.map((row) => row.page_id);
    if (pageIds.length) {
      updateSearchIndexForPages(pageIds);
      execSql(`DELETE FROM search_index_queue WHERE page_id IN (${inList(pageIds)});`);
    }
    shouldContinue = pageIds.length === searchIndexQueueBatchSize && hasQueuedSearchIndexPages();
  } catch (error) {
    console.error("Search index queue failed", error);
    shouldContinue = true;
  } finally {
    searchIndexDrainRunning = false;
  }
  if (shouldContinue) scheduleSearchIndexDrain(shouldContinue ? 500 : 100);
}

function hasQueuedSearchIndexPages() {
  return Number(queryOne("SELECT COUNT(*) AS count FROM search_index_queue")?.count ?? 0) > 0;
}

export function deleteSearchIndexForPage(pageId: string) {
  execSql(`
    DELETE FROM search_index_queue WHERE page_id = ${sql(pageId)};
    DELETE FROM search_pages_fts WHERE page_id = ${sql(pageId)};
  `);
}

export function deleteSearchIndexForNotebook(notebookId: string) {
  execSql(`
    DELETE FROM search_index_queue WHERE page_id IN (SELECT id FROM pages WHERE notebook_id = ${sql(notebookId)});
    DELETE FROM search_pages_fts WHERE notebook_id = ${sql(notebookId)};
  `);
}

function uniqueIds(ids: string[]) {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

function inList(ids: string[]) {
  return uniqueIds(ids).map(sql).join(", ") || "NULL";
}

function insertSearchRows(rows: SearchablePage[]) {
  if (!rows.length) return;
  execSql(rows.map((row) => `
    INSERT INTO search_pages_fts (page_id, notebook_id, title, body, tags, attachments, notebook, updated_at)
    VALUES (${sql(row.pageId)}, ${sql(row.notebookId)}, ${sql(row.title)}, ${sql(row.body)}, ${sql(row.tags)}, ${sql(row.attachments)}, ${sql(row.notebookName)}, ${sql(row.updatedAt)});
  `).join("\n"));
}

export function searchWorkspace(userId: string, rawQuery: string, limit = 30, mode: SearchMode = "full"): SearchResult[] {
  const query = rawQuery.trim();
  if (!query) return [];

  if (mode === "fast") return searchFast(userId, query, limit);
  if (mode === "approx") return searchApproximate(userId, query, limit);

  return mergeSearchResults(searchFast(userId, query, limit), searchApproximate(userId, query, limit)).slice(0, limit);
}

function searchFast(userId: string, query: string, limit: number) {
  const strictResults = searchFts(userId, query, limit, "strict");
  const relaxedResults = searchFts(userId, query, limit, "relaxed");
  return mergeSearchResults(strictResults, relaxedResults).sort((a, b) => b.score - a.score).slice(0, limit);
}

function searchApproximate(userId: string, query: string, limit: number): SearchResult[] {
  const tokens = tokenize(query);
  if (!tokens.length) return [];

  const expansions = tokens.map(expandSearchToken);
  const hasApproximateTerms = expansions.some((expansion) => expansion.terms.some((term) => term !== expansion.token));
  if (!hasApproximateTerms) return [];

  const match = buildExpandedFtsQuery(expansions);
  if (!match) return [];

  const matchTokens = uniqueIds(expansions.flatMap((expansion) => expansion.terms));
  return searchFts(userId, query, limit, "approx", match, matchTokens).map((result) => ({
    ...result,
    matchType: "fuzzy",
  }));
}

function searchFts(userId: string, query: string, limit: number, mode: SearchFtsMode, customMatch = "", matchTokens?: string[]): SearchResult[] {
  const queryTokens = tokenize(query);
  const tokens = matchTokens?.length ? matchTokens : queryTokens;
  const match = customMatch || buildFtsQuery(queryTokens, mode === "strict" ? "strict" : "relaxed");
  if (!match) return [];
  const literal = `%${query.toLowerCase()}%`;
  const queryLimit = mode === "strict" ? limit : mode === "approx" ? Math.max(limit * 6, 120) : Math.max(limit * 4, 60);
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
    LIMIT ${Math.max(1, Math.min(queryLimit, 300))}
  `);

  const minimumMatchCount = relaxedMinimumMatchCount(queryTokens.length);
  return rows
    .map((row): SearchResult & { matchedTokenCount: number } => {
      const searchableText = [row.title, row.body, row.tags, row.attachments].join(" ");
      const matchedTokenCount = countMatchedTokens(tokens, searchableText);
      const titleMatchedTokenCount = countMatchedTokens(tokens, row.title);
      const matchType = mode === "approx" ? "fuzzy" : titleMatchedTokenCount >= relaxedMinimumMatchCount(queryTokens.length) ? "title" : row.match_type;
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
          tokens: mode === "approx" ? tokens : queryTokens,
          title: row.title,
          searchableText,
          bm25Score: Number(row.bm25_score),
        }),
        matchedTokenCount,
      };
    })
    .filter((result) => mode === "strict" || result.matchedTokenCount >= minimumMatchCount)
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

function expandSearchToken(token: string): TokenExpansion {
  if (token.length < 3) return { token, terms: [token] };
  const firstCharacter = token[0].replace(/[\[\]{}()*?+.,\\^$|#\s-]/g, "");
  if (!firstCharacter) return { token, terms: [token] };
  const minimumLength = Math.max(2, token.length - 1);
  const maximumLength = token.length + 2;
  const maximumDistance = token.length <= 4 ? 2 : token.length <= 8 ? 2 : 3;

  try {
    const candidates = querySql(`
      SELECT term, doc
      FROM search_pages_vocab
      WHERE length(term) BETWEEN ${minimumLength} AND ${maximumLength}
        AND term GLOB ${sql(`${firstCharacter}*`)}
      ORDER BY doc DESC
      LIMIT ${approximateCandidateLimit}
    `);
    const alternatives = candidates
      .map((candidate) => ({
        term: String(candidate.term),
        distance: levenshteinDistance(token, String(candidate.term)),
        documentCount: Number(candidate.doc ?? 0),
      }))
      .filter((candidate) => candidate.term !== token && candidate.distance > 0 && candidate.distance <= maximumDistance)
      .sort((a, b) => a.distance - b.distance || b.documentCount - a.documentCount)
      .slice(0, approximateAlternativesPerToken)
      .map((candidate) => candidate.term);
    return { token, terms: uniqueIds([token, ...alternatives]) };
  } catch (error) {
    console.error("Search vocabulary lookup failed", error);
    return { token, terms: [token] };
  }
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
  return getSearchablePages();
}

function getSearchablePages(whereClause = ""): SearchablePage[] {
  return mapSearchRows(querySql(`
    SELECT
      p.id AS page_id,
      p.notebook_id,
      p.title,
      p.body,
      p.updated_at,
      n.name AS notebook_name,
      COALESCE(group_concat(DISTINCT pt.tag), '') AS tags,
      COALESCE(group_concat(DISTINCT a.original_name), '') AS attachments
    FROM pages p
    JOIN notebooks n ON n.id = p.notebook_id
    LEFT JOIN page_tags pt ON pt.page_id = p.id
    LEFT JOIN attachments a ON a.page_id = p.id
    ${whereClause}
    GROUP BY p.id
  `));
}

function mapSearchRows(rows: Record<string, string>[]): SearchablePage[] {
  return rows.map((row) => ({
    pageId: row.page_id,
    notebookId: row.notebook_id,
    title: row.title,
    body: bodyToEditorText(row.body),
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
  return tokens.map((token) => `${escapeFtsToken(token)}*`).join(operator);
}

function buildExpandedFtsQuery(expansions: TokenExpansion[]) {
  return expansions
    .map((expansion) => {
      const terms = uniqueIds(expansion.terms).map((term) => `${escapeFtsToken(term)}*`);
      if (!terms.length) return "";
      return terms.length === 1 ? terms[0] : `(${terms.join(" OR ")})`;
    })
    .filter(Boolean)
    .join(" AND ");
}

function escapeFtsToken(token: string) {
  return token.replace(/"/g, '""');
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

