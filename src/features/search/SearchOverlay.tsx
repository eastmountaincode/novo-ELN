"use client";

import { Check, Search, SlidersHorizontal, Tag, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Notebook } from "@/lib/types";
import { formatDateTime } from "@/lib/dateTime";
import { colorWithAlpha, projectColor } from "@/lib/workspaceDisplay";
import {
  DEFAULT_SEARCH_FIELDS,
  emptySearchAdvancedFilters,
  hasSearchAdvancedFilters,
  hasSearchResultCriteria,
  searchFilterCount,
  type HydratedSearchResult,
  type SearchAdvancedFilters,
  type SearchFieldKey,
} from "@/features/search/searchModel";

const SEARCH_FIELD_OPTIONS: Array<{ key: SearchFieldKey; label: string }> = [
  { key: "title", label: "Page titles" },
  { key: "body", label: "Page text" },
  { key: "tags", label: "Tags" },
  { key: "attachments", label: "Attachment names" },
];

function AdvancedTermInput({ label, terms, value, setValue, addTerm, removeTerm }: { label: string; terms: string[]; value: string; setValue: (value: string) => void; addTerm: (value: string) => void; removeTerm: (value: string) => void }) {
  function addPendingTerm() {
    addTerm(value);
  }

  return (
    <label className="grid gap-1.5 text-sm font-medium text-slate-200">
      <span>{label}</span>
      <div className="min-h-9 border border-white/10 bg-slate-900 px-2 py-1.5 focus-within:border-cyan-400">
        {terms.length ? (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {terms.map((term) => (
              <button
                key={term}
                type="button"
                onClick={() => removeTerm(term)}
                className="inline-flex h-6 max-w-full items-center gap-1 border border-white/10 bg-white/10 px-2 text-xs font-medium text-slate-200 hover:border-white/25"
              >
                <span className="truncate">{term}</span>
                <X size={12} />
              </button>
            ))}
          </div>
        ) : null}
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={addPendingTerm}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addPendingTerm();
            }
          }}
          className="h-6 w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
        />
      </div>
    </label>
  );
}

export function SearchOverlay({ query, setQuery, advancedFilters, setAdvancedFilters, availableTags, loading, approxLoading, results, scopeNotebook, onClose, selectResult }: { query: string; setQuery: (value: string) => void; advancedFilters: SearchAdvancedFilters; setAdvancedFilters: (value: SearchAdvancedFilters | ((current: SearchAdvancedFilters) => SearchAdvancedFilters)) => void; availableTags: string[]; loading: boolean; approxLoading: boolean; results: HydratedSearchResult[]; scopeNotebook?: Notebook; onClose: () => void; selectResult: (result: HydratedSearchResult) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [tagQuery, setTagQuery] = useState("");
  const [includeInput, setIncludeInput] = useState("");
  const [excludeInput, setExcludeInput] = useState("");
  const trimmedQuery = query.trim();
  const filtersActive = hasSearchAdvancedFilters(advancedFilters);
  const searchActive = Boolean(trimmedQuery || hasSearchResultCriteria(advancedFilters));
  const scopeColor = scopeNotebook ? projectColor(scopeNotebook) : undefined;
  const placeholder = scopeNotebook ? `Search pages and attachments within ${scopeNotebook.name}` : "Search pages and attachments";
  const emptyStateText = scopeNotebook ? `Start typing to search page titles, page text, tags, and attachment names within ${scopeNotebook.name}.` : "Start typing to search page titles, page text, tags, and attachment names.";
  const visibleTags = useMemo(() => {
    const normalizedQuery = tagQuery.trim().toLowerCase();
    return normalizedQuery ? availableTags.filter((tag) => tag.toLowerCase().includes(normalizedQuery)) : availableTags;
  }, [availableTags, tagQuery]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function addAdvancedTerm(key: "include" | "exclude", value: string) {
    const term = value.trim().replace(/\s+/g, " ");
    if (!term) return;
    setAdvancedFilters((current) => {
      if (current[key].some((candidate) => candidate.toLowerCase() === term.toLowerCase())) return current;
      return { ...current, [key]: [...current[key], term] };
    });
    if (key === "include") setIncludeInput("");
    else setExcludeInput("");
  }

  function removeAdvancedTerm(key: "include" | "exclude", value: string) {
    setAdvancedFilters((current) => ({
      ...current,
      [key]: current[key].filter((candidate) => candidate.toLowerCase() !== value.toLowerCase()),
    }));
  }

  function toggleSearchTag(tag: string) {
    setAdvancedFilters((current) => ({
      ...current,
      tags: current.tags.some((selected) => selected.toLowerCase() === tag.toLowerCase())
        ? current.tags.filter((selected) => selected.toLowerCase() !== tag.toLowerCase())
        : [...current.tags, tag],
    }));
  }

  function toggleSearchField(field: SearchFieldKey) {
    setAdvancedFilters((current) => {
      const currentFields = current.fields ?? DEFAULT_SEARCH_FIELDS;
      const selected = currentFields.includes(field);
      if (selected && currentFields.length === 1) return current;
      return {
        ...current,
        fields: selected ? currentFields.filter((candidate) => candidate !== field) : [...currentFields, field],
      };
    });
  }

  return (
    <div className="fixed inset-0 z-40 bg-slate-950/55 p-6" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={scopeNotebook ? `Search ${scopeNotebook.name}` : "Search pages"}
        onMouseDown={(event) => event.stopPropagation()}
        className="mx-auto mt-12 grid max-h-[78vh] w-full max-w-4xl grid-rows-[auto_1fr] border border-white/10 bg-slate-950 text-slate-100 shadow-2xl shadow-slate-950/50"
        style={scopeColor ? { borderColor: colorWithAlpha(scopeColor, 0.65) } : undefined}
      >
        <div className="border-b border-white/10 px-5 py-4">
          {scopeNotebook ? (
            <div className="mb-2 flex min-w-0 items-center gap-2 text-sm text-slate-300">
              <span className="size-2.5 shrink-0" style={{ backgroundColor: scopeColor }} />
              <span className="shrink-0 text-slate-500">Searching notebook:</span>
              <span className="min-w-0 truncate font-medium text-slate-100">{scopeNotebook.name}</span>
            </div>
          ) : null}
          <div className="flex items-center gap-3">
            <Search className="shrink-0 text-slate-400" size={18} style={scopeColor ? { color: scopeColor } : undefined} />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={placeholder}
              className="h-9 min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-slate-500"
            />
            {query ? (
              <button onClick={() => setQuery("")} className="grid size-8 place-items-center text-slate-500 hover:bg-white/10 hover:text-white" title="Clear search">
                <X size={16} />
              </button>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setAdvancedOpen((open) => !open)}
              className={`inline-flex h-8 items-center gap-2 border px-3 text-sm font-medium ${advancedOpen || filtersActive ? "border-cyan-400/70 bg-cyan-400/10 text-cyan-100" : "border-white/10 text-slate-300 hover:border-white/20 hover:bg-white/5 hover:text-white"}`}
              aria-expanded={advancedOpen}
            >
              <SlidersHorizontal size={14} />
              Advanced
              {filtersActive ? <span className="bg-white/10 px-1.5 text-xs">{searchFilterCount(advancedFilters)}</span> : null}
            </button>
            {filtersActive ? (
              <button
                type="button"
                onClick={() => {
                  setAdvancedFilters(emptySearchAdvancedFilters());
                  setTagQuery("");
                }}
                className="h-8 px-2 text-sm font-medium text-slate-400 hover:bg-white/5 hover:text-white"
              >
                Clear filters
              </button>
            ) : null}
          </div>
          {advancedOpen ? (
            <div className="mt-3 grid gap-3 border border-white/10 bg-white/[0.03] p-3">
              <div className="grid gap-2">
                <div className="text-sm font-medium text-slate-200">Search in</div>
                <div className="flex flex-wrap gap-2">
                  {SEARCH_FIELD_OPTIONS.map(({ key, label }) => {
                    const selected = (advancedFilters.fields ?? DEFAULT_SEARCH_FIELDS).includes(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => toggleSearchField(key)}
                        className={`inline-flex h-7 items-center gap-1.5 border px-2 text-left text-[11px] font-medium ${selected ? "border-cyan-400/70 bg-cyan-400/10 text-cyan-100" : "border-white/10 text-slate-400 hover:border-white/20 hover:bg-white/5 hover:text-white"}`}
                        aria-pressed={selected}
                      >
                        <span className={`grid size-3.5 shrink-0 place-items-center border ${selected ? "border-cyan-400 bg-cyan-400 text-slate-950" : "border-white/20"}`}>{selected ? <Check size={10} /> : null}</span>
                        <span>{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <AdvancedTermInput
                  label="Must include"
                  terms={advancedFilters.include}
                  value={includeInput}
                  setValue={setIncludeInput}
                  addTerm={(value) => addAdvancedTerm("include", value)}
                  removeTerm={(value) => removeAdvancedTerm("include", value)}
                />
                <AdvancedTermInput
                  label="Exclude"
                  terms={advancedFilters.exclude}
                  value={excludeInput}
                  setValue={setExcludeInput}
                  addTerm={(value) => addAdvancedTerm("exclude", value)}
                  removeTerm={(value) => removeAdvancedTerm("exclude", value)}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
                  <Tag size={14} style={scopeColor ? { color: scopeColor } : undefined} />
                  Tags
                </div>
                {advancedFilters.tags.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {advancedFilters.tags.map((tag) => (
                      <button key={tag} type="button" onClick={() => toggleSearchTag(tag)} className="inline-flex h-7 max-w-full items-center gap-1 border border-white/10 bg-white/10 px-2 text-xs font-medium text-slate-200 hover:border-white/25">
                        <span className="truncate">{tag}</span>
                        <X size={12} />
                      </button>
                    ))}
                  </div>
                ) : null}
                <input
                  value={tagQuery}
                  onChange={(event) => setTagQuery(event.target.value)}
                  className="h-9 border border-white/10 bg-slate-900 px-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400"
                  placeholder="Filter by tags..."
                />
                <div className="max-h-28 overflow-y-auto scroll-contained border border-white/10">
                  {visibleTags.slice(0, 80).map((tag) => {
                    const selected = advancedFilters.tags.some((candidate) => candidate.toLowerCase() === tag.toLowerCase());
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleSearchTag(tag)}
                        className={`flex h-8 w-full items-center gap-2 px-2 text-left text-sm ${selected ? "bg-cyan-400/15 text-cyan-100" : "text-slate-300 hover:bg-white/5 hover:text-white"}`}
                      >
                        <span className={`grid size-4 shrink-0 place-items-center border ${selected ? "border-cyan-400 bg-cyan-400 text-slate-950" : "border-white/20"}`}>{selected ? <Check size={11} /> : null}</span>
                        <span className="truncate">{tag}</span>
                      </button>
                    );
                  })}
                  {visibleTags.length === 0 ? <p className="px-2 py-2 text-sm text-slate-500">No matching tags.</p> : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>
        <div className="overflow-y-auto scroll-contained p-5">
          {searchActive ? (
            <SearchResultList loading={loading} approxLoading={approxLoading} results={results} selectResult={selectResult} />
          ) : (
            <div className="border border-white/10 bg-white/[0.03] p-5 text-sm text-slate-400">
              {emptyStateText}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}


function SearchResultList({ loading, approxLoading, results, selectedPageId, selectResult, compact = false }: { loading: boolean; approxLoading?: boolean; results: HydratedSearchResult[]; selectedPageId?: string; selectResult: (result: HydratedSearchResult) => void; compact?: boolean }) {
  if (loading) return <p className="p-3 text-sm text-slate-400">Searching...</p>;
  if (!results.length) return <p className="p-3 text-sm text-slate-400">{approxLoading ? "Looking for approximate matches..." : "No matching pages."}</p>;
  return (
    <>
      <div className={compact ? "space-y-2" : "divide-y divide-white/10 border border-white/10"}>
        {results.map((result) => (
          <SearchResultButton
            key={result.pageId}
            result={result}
            active={selectedPageId === result.pageId}
            compact={compact}
            onClick={() => selectResult(result)}
          />
        ))}
      </div>
      {approxLoading ? <p className="p-3 text-sm text-slate-400">Looking for approximate matches...</p> : null}
    </>
  );
}

function SearchResultButton({ result, active, compact, onClick }: { result: HydratedSearchResult; active: boolean; compact: boolean; onClick: () => void }) {
  const label = result.matchType === "title" ? "Title" : result.matchType === "attachment" ? "Attachment" : result.matchType === "fuzzy" ? "Approximate" : "Text";
  const color = projectColor(result.notebook ?? result.project);
  return (
    <button
      onClick={onClick}
      className={`block w-full text-left ${compact ? `border p-3 ${active ? "" : "border-slate-200 bg-white hover:border-slate-400"}` : "bg-slate-950 px-4 py-3 hover:bg-white/5"}`}
      style={compact && active ? { borderColor: color, backgroundColor: colorWithAlpha(color, 0.1) } : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className={`truncate text-sm font-semibold ${compact ? "text-slate-950" : "text-white"}`}>{result.title || "Untitled"}</h3>
          <p className={`mt-1 truncate text-xs ${compact ? "text-slate-500" : "text-slate-500"}`}>{result.projectName} / {result.notebookName}</p>
        </div>
        <span className={`shrink-0 px-2 py-1 text-[11px] font-medium ${compact ? "bg-slate-100 text-slate-600" : "bg-white/10 text-slate-300"}`}>{label}</span>
      </div>
      {result.snippet ? <p className={`mt-2 max-h-10 overflow-hidden text-sm leading-5 ${compact ? "text-slate-600" : "text-slate-400"}`}>{result.snippet}</p> : null}
      <p className="mt-2 text-xs text-slate-500">Updated {formatDateTime(result.updatedAt)}</p>
    </button>
  );
}
