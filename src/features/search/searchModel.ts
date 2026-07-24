import type { Notebook, PageEntry, Project, SearchResult } from "@/lib/types";

export type HydratedSearchResult = SearchResult & {
  page?: PageEntry;
  project?: Project;
  notebook?: Notebook;
};

export type SearchFieldKey = "title" | "body" | "tags" | "attachments";

export type SearchAdvancedFilters = {
  include: string[];
  exclude: string[];
  tags: string[];
  fields: SearchFieldKey[];
};

export const DEFAULT_SEARCH_FIELDS: SearchFieldKey[] = ["title", "body", "tags", "attachments"];

export function emptySearchAdvancedFilters(): SearchAdvancedFilters {
  return { include: [], exclude: [], tags: [], fields: DEFAULT_SEARCH_FIELDS };
}

export function hasSearchAdvancedFilters(filters: SearchAdvancedFilters) {
  return Boolean(filters.include.length || filters.exclude.length || filters.tags.length || !searchFieldListsEqual(filters.fields ?? DEFAULT_SEARCH_FIELDS, DEFAULT_SEARCH_FIELDS));
}

export function hasSearchResultCriteria(filters: SearchAdvancedFilters) {
  return Boolean(filters.include.length || filters.exclude.length || filters.tags.length);
}

export function hasApproximateSearchBasis(query: string, filters: SearchAdvancedFilters) {
  return Boolean(query.trim() || filters.include.length);
}

export function searchFilterCount(filters: SearchAdvancedFilters) {
  return filters.include.length + filters.exclude.length + filters.tags.length + (searchFieldListsEqual(filters.fields ?? DEFAULT_SEARCH_FIELDS, DEFAULT_SEARCH_FIELDS) ? 0 : 1);
}

export function searchApiUrl(input: { query: string; limit: number; mode: "fast" | "approx"; notebookId?: string; filters: SearchAdvancedFilters }) {
  const params = new URLSearchParams();
  params.set("q", input.query);
  params.set("limit", String(input.limit));
  params.set("mode", input.mode);
  if (input.notebookId) params.set("notebookId", input.notebookId);
  for (const term of input.filters.include) params.append("include", term);
  for (const term of input.filters.exclude) params.append("exclude", term);
  for (const tag of input.filters.tags) params.append("tag", tag);
  for (const field of input.filters.fields ?? DEFAULT_SEARCH_FIELDS) params.append("field", field);
  return `/api/search?${params.toString()}`;
}

export function searchCacheKey(input: { query: string; notebookId?: string; filters: SearchAdvancedFilters }) {
  const normalize = (values: string[]) => values.map((value) => value.trim().toLowerCase()).filter(Boolean).sort().join("\u001f");
  const fields = [...(input.filters.fields ?? DEFAULT_SEARCH_FIELDS)].sort().join("\u001f");
  return [
    input.notebookId ?? "",
    input.query.trim().toLowerCase(),
    normalize(input.filters.include),
    normalize(input.filters.exclude),
    normalize(input.filters.tags),
    fields,
  ].join("\u001e");
}

function searchFieldListsEqual(left: SearchFieldKey[], right: SearchFieldKey[]) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((field) => rightSet.has(field));
}

export function mergeSearchResultLists(primary: SearchResult[], secondary: SearchResult[]) {
  const merged = new Map<string, SearchResult>();
  for (const result of primary) merged.set(result.pageId, result);
  for (const result of secondary) {
    if (!merged.has(result.pageId)) merged.set(result.pageId, result);
  }
  return [...merged.values()];
}
