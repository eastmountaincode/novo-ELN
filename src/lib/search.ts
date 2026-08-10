import { bodyToEditorText } from "./editor";
import { execSql, isPostgresDatabase, queryOne, querySql, sql } from "./sqlite";
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
type SearchField = "title" | "body" | "tags" | "attachments";
type SearchScope = { notebookId?: string; includeTerms?: string[]; excludeTerms?: string[]; tags?: string[]; fields?: string[] };

const searchIndexQueueBatchSize = 25;
const approximateCandidateLimit = 800;
const approximateAlternativesPerToken = 5;
const defaultSearchFields: SearchField[] = ["title", "body", "tags", "attachments"];
const searchFields: SearchField[] = ["title", "body", "tags", "attachments"];
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
    INSERT INTO search_pages_fts (page_id, notebook_id, title, body, tags, attachments, updated_at)
    VALUES (${sql(row.pageId)}, ${sql(row.notebookId)}, ${sql(row.title)}, ${sql(row.body)}, ${sql(row.tags)}, ${sql(row.attachments)}, ${sql(row.updatedAt)});
  `).join("\n"));
}

export function searchWorkspace(userId: string, rawQuery: string, limit = 30, mode: SearchMode = "full", scope: SearchScope = {}): SearchResult[] {
  const query = rawQuery.trim();
  const advancedScope = normalizeSearchScope(scope);
  const includeQuery = (advancedScope.includeTerms ?? []).filter((term) => !term.includes("*")).join(" ");
  const searchQuery = [query, includeQuery].filter(Boolean).join(" ").trim();
  if (isPostgresDatabase()) return searchPostgres(userId, searchQuery, limit, advancedScope);
  if (!searchQuery) {
    if (!hasAdvancedSearchFilters(advancedScope)) return [];
    return searchFilteredPages(userId, limit, advancedScope);
  }

  if (mode === "fast") return searchFast(userId, searchQuery, limit, advancedScope);
  if (mode === "approx") return searchApproximate(userId, searchQuery, limit, advancedScope);

  return mergeSearchResults(searchFast(userId, searchQuery, limit, advancedScope), searchApproximate(userId, searchQuery, limit, advancedScope)).slice(0, limit);
}

function searchPostgres(userId: string, query: string, limit: number, scope: SearchScope): SearchResult[] {
  if (!query) {
    if (!hasAdvancedSearchFilters(scope)) return [];
    return searchFilteredPages(userId, limit, scope);
  }

  const tokens = tokenize(query);
  if (!tokens.length) return [];
  const accessCondition = searchAccessCondition(userId, "n", "nm");
  const notebookCondition = scope.notebookId ? `AND f.notebook_id = ${sql(scope.notebookId)}` : "";
  const advancedCondition = advancedSearchSqlCondition(scope);
  const textExpression = searchableSqlExpression(scope.fields);
  const tokenConditions = tokens.map((token) => `${textExpression} LIKE ${sql(postgresTokenLikePattern(token))} ESCAPE '\\'`);
  const rows = querySql(`
    SELECT
      f.page_id,
      f.notebook_id,
      f.title,
      n.name AS notebook_name,
      f.body,
      f.tags,
      f.attachments,
      f.updated_at
    FROM search_pages_fts f
    JOIN notebooks n ON n.id = f.notebook_id
    LEFT JOIN notebook_members nm ON nm.notebook_id = n.id AND nm.user_id = ${sql(userId)}
    WHERE ${accessCondition}
      ${notebookCondition}
      ${advancedCondition}
      AND (${tokenConditions.join(" OR ")})
    ORDER BY datetime(f.updated_at) DESC
    LIMIT ${Math.max(limit * 10, 300)}
  `);

  const minimumMatchCount = relaxedMinimumMatchCount(tokens.length);
  return rows
    .filter((row) => rowMatchesAdvancedFilters(row, scope))
    .map((row): SearchResult & { matchedTokenCount: number } => {
      const searchableText = searchableTextForScope(row, scope.fields);
      const matchedTokenCount = countMatchedTokens(tokens, searchableText);
      const titleMatchedTokenCount = countMatchedTokens(tokens, row.title);
      const attachmentMatchedTokenCount = countMatchedTokens(tokens, row.attachments);
      return {
        pageId: row.page_id,
        projectId: "workspace",
        notebookId: row.notebook_id,
        title: row.title,
        projectName: "Notebooks",
        notebookName: row.notebook_name,
        snippet: bestSubstringSnippet(row, scope.fields, query),
        updatedAt: row.updated_at,
        matchType: titleMatchedTokenCount >= minimumMatchCount ? "title" : attachmentMatchedTokenCount >= minimumMatchCount ? "attachment" : "content",
        score: scoreFtsResult({
          query,
          tokens,
          title: row.title,
          searchableText,
          bm25Score: 0,
        }),
        matchedTokenCount,
      };
    })
    .filter((result) => result.matchedTokenCount >= minimumMatchCount)
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

function searchFast(userId: string, query: string, limit: number, scope: SearchScope) {
  const exactSubstringResults = searchExactSubstring(userId, query, limit, scope);
  const strictResults = searchFts(userId, query, limit, "strict", "", undefined, scope);
  const relaxedResults = searchFts(userId, query, limit, "relaxed", "", undefined, scope);
  return mergeSearchResults(mergeSearchResults(exactSubstringResults, strictResults), relaxedResults)
    .sort((a, b) => b.score - a.score || Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, limit);
}

function searchApproximate(userId: string, query: string, limit: number, scope: SearchScope): SearchResult[] {
  const tokens = tokenize(query);
  if (!tokens.length) return [];

  const expansions = tokens.map(expandSearchToken);
  const hasApproximateTerms = expansions.some((expansion) => expansion.terms.some((term) => term !== expansion.token));
  if (!hasApproximateTerms) return [];

  const match = buildExpandedFtsQuery(expansions);
  if (!match) return [];

  const matchTokens = uniqueIds(expansions.flatMap((expansion) => expansion.terms));
  return searchFts(userId, query, limit, "approx", match, matchTokens, scope).map((result) => ({
    ...result,
    matchType: "fuzzy",
  }));
}

function searchFts(userId: string, query: string, limit: number, mode: SearchFtsMode, customMatch = "", matchTokens?: string[], scope: SearchScope = {}): SearchResult[] {
  const queryTokens = tokenize(query);
  const tokens = matchTokens?.length ? matchTokens : queryTokens;
  const match = buildScopedFtsQuery(customMatch || buildFtsQuery(queryTokens, mode === "strict" ? "strict" : "relaxed"), scope.fields);
  if (!match) return [];
  const literal = `%${query.toLowerCase()}%`;
  const queryLimit = mode === "strict" ? limit : mode === "approx" ? Math.max(limit * 6, 120) : Math.max(limit * 4, 60);
  const accessCondition = searchAccessCondition(userId, "n", "nm");
  const notebookCondition = scope.notebookId ? `AND f.notebook_id = ${sql(scope.notebookId)}` : "";
  const advancedCondition = advancedSearchSqlCondition(scope);
  const rows = querySql(`
    SELECT
      f.page_id,
      f.notebook_id,
      f.title,
      n.name AS notebook_name,
      f.body,
      f.tags,
      f.attachments,
      f.updated_at,
      snippet(search_pages_fts, -1, '', '', '...', 28) AS snippet,
      bm25(search_pages_fts, 0.0, 0.0, 8.0, 2.0, 2.0, 3.0, 0.0) AS bm25_score,
      CASE
        WHEN lower(f.title) LIKE ${sql(literal)} THEN 'title'
        WHEN lower(f.attachments) LIKE ${sql(literal)} THEN 'attachment'
        ELSE 'content'
      END AS match_type
    FROM search_pages_fts f
    JOIN notebooks n ON n.id = f.notebook_id
    LEFT JOIN notebook_members nm ON nm.notebook_id = n.id AND nm.user_id = ${sql(userId)}
    WHERE ${accessCondition}
      ${notebookCondition}
      ${advancedCondition}
      AND search_pages_fts MATCH ${sql(match)}
    ORDER BY
      bm25_score ASC,
      datetime(f.updated_at) DESC
    LIMIT ${Math.max(1, Math.min(queryLimit, 300))}
  `);

  const minimumMatchCount = relaxedMinimumMatchCount(queryTokens.length);
  return rows
    .filter((row) => rowMatchesAdvancedFilters(row, scope))
    .map((row): SearchResult & { matchedTokenCount: number } => {
      const searchableText = searchableTextForScope(row, scope.fields);
      const matchedTokenCount = countMatchedTokens(tokens, searchableText);
      const titleMatchedTokenCount = countMatchedTokens(tokens, row.title);
      const matchType = mode === "approx" ? "fuzzy" : titleMatchedTokenCount >= relaxedMinimumMatchCount(queryTokens.length) ? "title" : row.match_type;
      return {
        pageId: row.page_id,
        projectId: "workspace",
        notebookId: row.notebook_id,
        title: row.title,
        projectName: "Notebooks",
        notebookName: row.notebook_name,
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

function searchFilteredPages(userId: string, limit: number, scope: SearchScope): SearchResult[] {
  const accessCondition = searchAccessCondition(userId, "n", "nm");
  const notebookCondition = scope.notebookId ? `AND f.notebook_id = ${sql(scope.notebookId)}` : "";
  const advancedCondition = advancedSearchSqlCondition(scope, { includeTextCandidates: true });
  const rows = querySql(`
    SELECT
      f.page_id,
      f.notebook_id,
      f.title,
      n.name AS notebook_name,
      f.body,
      f.tags,
      f.attachments,
      f.updated_at
    FROM search_pages_fts f
    JOIN notebooks n ON n.id = f.notebook_id
    LEFT JOIN notebook_members nm ON nm.notebook_id = n.id AND nm.user_id = ${sql(userId)}
    WHERE ${accessCondition}
      ${notebookCondition}
      ${advancedCondition}
    ORDER BY datetime(f.updated_at) DESC
    LIMIT ${Math.max(250, Math.min(limit * 80, 2500))}
  `);

  return rows.filter((row) => rowMatchesAdvancedFilters(row, scope)).slice(0, limit).map((row): SearchResult => {
    const searchableText = searchableTextForScope(row, scope.fields);
    return {
      pageId: row.page_id,
      projectId: "workspace",
      notebookId: row.notebook_id,
      title: row.title,
      projectName: "Notebooks",
      notebookName: row.notebook_name,
      snippet: cleanSnippet(searchableText).slice(0, 180),
      updatedAt: row.updated_at,
      matchType: attachmentTermsMatch(scope.includeTerms ?? [], row.attachments) ? "attachment" : "content",
      score: 1,
    };
  });
}

function searchExactSubstring(userId: string, query: string, limit: number, scope: SearchScope): SearchResult[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];
  const accessCondition = searchAccessCondition(userId, "n", "nm");
  const notebookCondition = scope.notebookId ? `AND f.notebook_id = ${sql(scope.notebookId)}` : "";
  const advancedCondition = advancedSearchSqlCondition(scope);
  const textExpression = searchableSqlExpression(scope.fields);
  const rows = querySql(`
    SELECT
      f.page_id,
      f.notebook_id,
      f.title,
      n.name AS notebook_name,
      f.body,
      f.tags,
      f.attachments,
      f.updated_at
    FROM search_pages_fts f
    JOIN notebooks n ON n.id = f.notebook_id
    LEFT JOIN notebook_members nm ON nm.notebook_id = n.id AND nm.user_id = ${sql(userId)}
    WHERE ${accessCondition}
      ${notebookCondition}
      ${advancedCondition}
      AND ${textExpression} LIKE ${sql(termCandidateLikePattern(query))} ESCAPE '\\'
    ORDER BY datetime(f.updated_at) DESC
    LIMIT ${Math.max(1, Math.min(limit * 10, 300))}
  `);

  return rows
    .filter((row) => rowMatchesAdvancedFilters(row, scope))
    .filter((row) => fieldMatchesSearchQuery(row, scope.fields, query))
    .map((row): SearchResult => {
      const titleMatch = scopedFieldMatches(row, scope.fields, "title", query);
      const attachmentMatch = scopedFieldMatches(row, scope.fields, "attachments", query);
      return {
        pageId: row.page_id,
        projectId: "workspace",
        notebookId: row.notebook_id,
        title: row.title,
        projectName: "Notebooks",
        notebookName: row.notebook_name,
        snippet: bestSubstringSnippet(row, scope.fields, query),
        updatedAt: row.updated_at,
        matchType: titleMatch ? "title" : attachmentMatch ? "attachment" : "content",
        score: titleMatch ? 8 : attachmentMatch ? 6 : 5,
      };
    })
    .sort((a, b) => b.score - a.score || Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, limit);
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
  const tagAggregate = isPostgresDatabase() ? "string_agg(DISTINCT t.label, ',')" : "group_concat(DISTINCT t.label)";
  const attachmentAggregate = isPostgresDatabase() ? "string_agg(DISTINCT a.original_name, ',')" : "group_concat(DISTINCT a.original_name)";
  return mapSearchRows(querySql(`
    SELECT
      p.id AS page_id,
      p.notebook_id,
      p.title,
      p.body,
      p.updated_at,
      n.name AS notebook_name,
      COALESCE(${tagAggregate}, '') AS tags,
      COALESCE(${attachmentAggregate}, '') AS attachments
    FROM pages p
    JOIN notebooks n ON n.id = p.notebook_id
    LEFT JOIN page_tags pt ON pt.page_id = p.id
    LEFT JOIN tags t ON t.id = pt.tag_id
    LEFT JOIN attachments a ON a.page_id = p.id
    ${whereClause}
    GROUP BY p.id, p.notebook_id, p.title, p.body, p.updated_at, n.name
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

function searchAccessCondition(userId: string, _notebookAlias: string, memberAlias: string) {
  const user = queryOne(`SELECT role FROM users WHERE id = ${sql(userId)} LIMIT 1`);
  if (user?.role === "admin") return "1=1";
  return `${memberAlias}.user_id IS NOT NULL`;
}

function normalizeSearchScope(scope: SearchScope): SearchScope {
  return {
    notebookId: scope.notebookId?.trim() || undefined,
    includeTerms: normalizeTermFilters(scope.includeTerms ?? []),
    excludeTerms: normalizeTermFilters(scope.excludeTerms ?? []),
    tags: uniqueIds((scope.tags ?? []).map((tag) => tag.trim()).filter(Boolean)),
    fields: normalizeSearchFields(scope.fields ?? defaultSearchFields),
  };
}

function normalizeSearchFields(fields: string[]) {
  const normalized = uniqueIds(fields).filter((field): field is SearchField => searchFields.includes(field as SearchField));
  return normalized.length ? normalized : defaultSearchFields;
}

function normalizeTermFilters(values: string[]) {
  return uniqueIds(values.map((value) => value.trim().replace(/\s+/g, " ")).filter(Boolean)).slice(0, 12);
}

function hasAdvancedSearchFilters(scope: SearchScope) {
  return Boolean(scope.includeTerms?.length || scope.excludeTerms?.length || scope.tags?.length);
}

function advancedSearchSqlCondition(scope: SearchScope, options: { includeTextCandidates?: boolean } = {}) {
  const textExpression = searchableSqlExpression(scope.fields);
  const conditions: string[] = [];
  if (options.includeTextCandidates) {
    for (const term of scope.includeTerms ?? []) {
      conditions.push(`${textExpression} LIKE ${sql(termCandidateLikePattern(term))} ESCAPE '\\'`);
    }
  }
  for (const tag of scope.tags ?? []) {
    conditions.push(`EXISTS (
      SELECT 1
      FROM page_tags search_filter_tag
      JOIN tags search_filter_tag_value ON search_filter_tag_value.id = search_filter_tag.tag_id
      WHERE search_filter_tag.page_id = f.page_id
        AND lower(search_filter_tag_value.label) = ${sql(tag.toLowerCase())}
    )`);
  }
  return conditions.length ? `AND ${conditions.join("\n      AND ")}` : "";
}

function termCandidateLikePattern(term: string) {
  const lowerTerm = term.toLowerCase();
  const escaped = lowerTerm
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .replace(/\*/g, "%");
  return `%${escaped}%`;
}

function postgresTokenLikePattern(term: string) {
  const escaped = term
    .toLowerCase()
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
  return `%${escaped}%`;
}

function rowMatchesAdvancedFilters(row: Record<string, string>, scope: SearchScope) {
  const searchableText = searchableTextForScope(row, scope.fields);
  return (scope.includeTerms ?? []).every((term) => termMatchesSearchText(searchableText, term))
    && (scope.excludeTerms ?? []).every((term) => !termMatchesSearchText(searchableText, term));
}

function attachmentTermsMatch(terms: string[], attachments: string) {
  return terms.some((term) => termMatchesSearchText(attachments, term));
}

function termMatchesSearchText(text: string, rawTerm: string) {
  const phrase = normalizeTermPhrase(rawTerm);
  if (!phrase) return true;
  if (phrase.includes(" ")) {
    if (phrase.includes("*")) {
      const source = phrase.split("*").map(escapeRegExp).join(".*");
      return new RegExp(source, "i").test(normalizeSearchText(text));
    }
    return normalizeSearchText(text).includes(phrase);
  }
  const term = normalizeTermPattern(rawTerm);
  if (!term) return true;
  const words = tokenize(text);
  if (term.includes("*")) {
    const source = `^${term.split("*").map(escapeRegExp).join(".*")}$`;
    const matcher = new RegExp(source, "i");
    return words.some((word) => matcher.test(word));
  }
  return words.some((word) => word.startsWith(term) || word.includes(term));
}

function fieldMatchesSearchQuery(row: Record<string, string>, fields: string[] | undefined, query: string) {
  return normalizeSearchText(searchableTextForScope(row, fields)).includes(normalizeSearchText(query));
}

function scopedFieldMatches(row: Record<string, string>, fields: string[] | undefined, field: SearchField, query: string) {
  const scopedFields = normalizeSearchFields(fields ?? defaultSearchFields);
  return scopedFields.includes(field) && normalizeSearchText(String(row[field] ?? "")).includes(normalizeSearchText(query));
}

function bestSubstringSnippet(row: Record<string, string>, fields: string[] | undefined, query: string) {
  const scopedFields = normalizeSearchFields(fields ?? defaultSearchFields);
  const normalizedQuery = normalizeSearchText(query);
  const field = scopedFields.find((candidate) => normalizeSearchText(String(row[candidate] ?? "")).includes(normalizedQuery));
  const value = cleanSnippet(String(field ? row[field] ?? "" : searchableTextForScope(row, fields)));
  if (!normalizedQuery) return value.slice(0, 180);

  const index = value.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return value.slice(0, 180);
  const start = Math.max(0, index - 60);
  const end = Math.min(value.length, index + query.length + 100);
  return `${start > 0 ? "..." : ""}${value.slice(start, end)}${end < value.length ? "..." : ""}`;
}

function normalizeTermPattern(term: string) {
  return term
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_*]/g, "");
}

function normalizeTermPhrase(term: string) {
  return term
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_*\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSearchText(text: string) {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_*\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function buildScopedFtsQuery(match: string, fields: string[] | undefined) {
  if (!match) return "";
  const scopedFields = normalizeSearchFields(fields ?? defaultSearchFields);
  if (scopedFields.length === searchFields.length) return match;
  return `{${scopedFields.join(" ")}} : (${match})`;
}

function searchableTextForScope(row: Record<string, string>, fields: string[] | undefined) {
  const scopedFields = normalizeSearchFields(fields ?? defaultSearchFields);
  return scopedFields.map((field) => String(row[field] ?? "")).join(" ");
}

function searchableSqlExpression(fields: string[] | undefined) {
  const scopedFields = normalizeSearchFields(fields ?? defaultSearchFields);
  return `lower(${scopedFields.map((field) => `coalesce(f.${field}, '')`).join(" || ' ' || ")})`;
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
