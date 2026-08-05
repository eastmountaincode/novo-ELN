"use client";

import { Check, ChevronLeft, ChevronRight, Filter, Flag, Loader2, Plus, Search, SlidersHorizontal, Tag, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageCard } from "@/features/pages/PageCard";
import { getPageStatusLabel, PAGE_STATUS_OPTIONS, StatusDot } from "@/features/pages/PageStatus";
import { SearchOverlay } from "@/features/search/SearchOverlay";
import {
  emptySearchAdvancedFilters,
  hasApproximateSearchBasis,
  hasSearchResultCriteria,
  mergeSearchResultLists,
  searchApiUrl,
  searchCacheKey,
  type HydratedSearchResult,
  type SearchAdvancedFilters,
} from "@/features/search/searchModel";
import { readStoredSortKey, timestampForSort, writeStoredSortKey } from "@/lib/clientSorting";
import { normalizeTagList } from "@/lib/tags";
import type { Notebook, PageEntry, PageStatus, Project, SearchResult } from "@/lib/types";
import { projectColor } from "@/lib/workspaceDisplay";

type PageSortKey = "updated" | "created" | "title";

const PAGE_SORT_OPTIONS: Array<{ key: PageSortKey; label: string }> = [
  { key: "updated", label: "Date updated" },
  { key: "created", label: "Date created" },
  { key: "title", label: "Title" },
];

const PAGE_SORT_STORAGE_KEY = "novo.pageSortKey";

export function PagesSidebar({ selectedProject, selectedNotebook, selectedPage, pageMenuId, setPageMenuId, selectPage, createNewPage, creatingPage, canEdit, deletePage, movePage, duplicatePage, duplicatingPageId, searchTagSuggestions, collapsed, toggleCollapsed }: { selectedProject?: Project; selectedNotebook?: Notebook; selectedPage?: PageEntry; pageMenuId: string | null; setPageMenuId: (id: string | null) => void; selectPage: (project: Project, notebook: Notebook, page: PageEntry) => void; createNewPage: () => void; creatingPage: boolean; canEdit: boolean; deletePage: (page: PageEntry) => void; movePage: (page: PageEntry) => void; duplicatePage: (page: PageEntry) => void; duplicatingPageId: string; searchTagSuggestions: string[]; collapsed: boolean; toggleCollapsed: () => void }) {
  const pages = useMemo(() => selectedNotebook?.pages ?? [], [selectedNotebook]);
  const [sortKey, setSortKey] = useState<PageSortKey>(readStoredPageSortKey);
  const [sortOptionsOpen, setSortOptionsOpen] = useState(false);
  const [filterOptionsOpen, setFilterOptionsOpen] = useState(false);
  const [activeFilterPanel, setActiveFilterPanel] = useState<"tags" | "status">("tags");
  const [tagQuery, setTagQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<PageStatus[]>([]);
  const [notebookQuery, setNotebookQuery] = useState("");
  const [notebookSearchFilters, setNotebookSearchFilters] = useState<SearchAdvancedFilters>(emptySearchAdvancedFilters);
  const [notebookSearchResults, setNotebookSearchResults] = useState<SearchResult[]>([]);
  const [notebookSearchLoading, setNotebookSearchLoading] = useState(false);
  const [notebookSearchApproxLoading, setNotebookSearchApproxLoading] = useState(false);
  const [notebookSearchOpen, setNotebookSearchOpen] = useState(false);
  const [searchNotebookId, setSearchNotebookId] = useState(selectedNotebook?.id);
  const lastNotebookSearchKeyRef = useRef("");
  const sortOptionsRef = useRef<HTMLDivElement>(null);
  const filterOptionsRef = useRef<HTMLDivElement>(null);
  const pageListRef = useRef<HTMLDivElement>(null);
  const availableTags = useMemo(() => normalizeTagList(pages.flatMap((page) => page.tags)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })), [pages]);
  const filteredPages = useMemo(() => filterNotebookPages(pages, selectedTags, selectedStatuses), [pages, selectedTags, selectedStatuses]);
  const sortedPages = useMemo(() => sortNotebookPages(filteredPages, sortKey), [filteredPages, sortKey]);
  const filterActive = selectedTags.length > 0 || selectedStatuses.length > 0;
  const filterCount = selectedTags.length + selectedStatuses.length;
  const pageWord = pages.length === 1 ? "page" : "pages";
  const pageCountLabel = filterActive
    ? `${sortedPages.length} of ${pages.length} ${pageWord}`
    : `${pages.length} ${pageWord}`;
  const visibleTags = useMemo(() => {
    const query = tagQuery.trim().toLowerCase();
    return query ? availableTags.filter((tag) => tag.toLowerCase().includes(query)) : availableTags;
  }, [availableTags, tagQuery]);
  const color = projectColor(selectedNotebook ?? selectedProject);
  const notebookPageLookup = useMemo(() => {
    const lookup = new Map<string, { page: PageEntry; project: Project; notebook: Notebook }>();
    if (selectedProject && selectedNotebook) {
      selectedNotebook.pages.forEach((page) => lookup.set(page.id, { page, project: selectedProject, notebook: selectedNotebook }));
    }
    return lookup;
  }, [selectedNotebook, selectedProject]);
  const hydratedNotebookSearchResults = useMemo<HydratedSearchResult[]>(() => {
    return notebookSearchResults.map((result) => ({ ...result, ...notebookPageLookup.get(result.pageId) }));
  }, [notebookPageLookup, notebookSearchResults]);

  if (searchNotebookId !== selectedNotebook?.id) {
    setSearchNotebookId(selectedNotebook?.id);
    setNotebookQuery("");
    setNotebookSearchFilters(emptySearchAdvancedFilters());
    setNotebookSearchResults([]);
    setNotebookSearchLoading(false);
    setNotebookSearchApproxLoading(false);
    setNotebookSearchOpen(false);
  }

  useEffect(() => {
    lastNotebookSearchKeyRef.current = "";
  }, [searchNotebookId]);

  useEffect(() => {
    writeStoredSortKey(PAGE_SORT_STORAGE_KEY, sortKey);
  }, [sortKey]);

  useEffect(() => {
    if (!sortOptionsOpen) return;

    function isInsideSortOptions(target: EventTarget | null) {
      return target instanceof Element && Boolean(sortOptionsRef.current?.contains(target));
    }

    function closeSortOptions() {
      setSortOptionsOpen(false);
    }

    function onPointerDown(event: PointerEvent) {
      if (!isInsideSortOptions(event.target)) closeSortOptions();
    }

    function onFocusIn(event: FocusEvent) {
      if (!isInsideSortOptions(event.target)) closeSortOptions();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeSortOptions();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [sortOptionsOpen]);

  useEffect(() => {
    if (!filterOptionsOpen) return;

    function isInsideFilterOptions(target: EventTarget | null) {
      return target instanceof Element && Boolean(filterOptionsRef.current?.contains(target));
    }

    function closeFilterOptions() {
      setFilterOptionsOpen(false);
    }

    function onPointerDown(event: PointerEvent) {
      if (!isInsideFilterOptions(event.target)) closeFilterOptions();
    }

    function onFocusIn(event: FocusEvent) {
      if (!isInsideFilterOptions(event.target)) closeFilterOptions();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeFilterOptions();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [filterOptionsOpen]);

  useEffect(() => {
    if (!notebookSearchOpen) return;
    const notebookId = selectedNotebook?.id;
    const trimmed = notebookQuery.trim();
    const filterActive = hasSearchResultCriteria(notebookSearchFilters);
    const searchKey = searchCacheKey({ query: trimmed, filters: notebookSearchFilters, notebookId });
    if (lastNotebookSearchKeyRef.current === searchKey) {
      setNotebookSearchLoading(false);
      setNotebookSearchApproxLoading(false);
      return;
    }
    let active = true;
    const fastController = new AbortController();
    const approxController = new AbortController();
    const timeout = window.setTimeout(async () => {
      if (!notebookId || (!trimmed && !filterActive)) {
        setNotebookSearchResults([]);
        setNotebookSearchLoading(false);
        setNotebookSearchApproxLoading(false);
        lastNotebookSearchKeyRef.current = searchKey;
        return;
      }

      setNotebookSearchLoading(true);
      setNotebookSearchApproxLoading(false);
      try {
        const response = await fetch(searchApiUrl({ query: trimmed, limit: 20, mode: "fast", notebookId, filters: notebookSearchFilters }), { signal: fastController.signal });
        if (!active) return;
        if (!response.ok) {
          setNotebookSearchResults([]);
          return;
        }
        const body = (await response.json()) as { results: SearchResult[] };
        setNotebookSearchResults(body.results);
        lastNotebookSearchKeyRef.current = searchKey;
      } catch {
        if (!fastController.signal.aborted) setNotebookSearchResults([]);
        return;
      } finally {
        if (active) setNotebookSearchLoading(false);
      }

      if (!active) return;
      if (!hasApproximateSearchBasis(trimmed, notebookSearchFilters)) return;
      setNotebookSearchApproxLoading(true);
      try {
        const response = await fetch(searchApiUrl({ query: trimmed, limit: 20, mode: "approx", notebookId, filters: notebookSearchFilters }), { signal: approxController.signal });
        if (!active || !response.ok) return;
        const body = (await response.json()) as { results: SearchResult[] };
        setNotebookSearchResults((current) => mergeSearchResultLists(current, body.results).slice(0, 20));
      } catch {
        // Approximate search is best-effort; keep the fast indexed results visible.
      } finally {
        if (active) setNotebookSearchApproxLoading(false);
      }
    }, 180);

    return () => {
      active = false;
      fastController.abort();
      approxController.abort();
      window.clearTimeout(timeout);
    };
  }, [notebookQuery, notebookSearchFilters, notebookSearchOpen, selectedNotebook?.id]);

  useEffect(() => {
    if (collapsed || !selectedProject || !selectedNotebook || sortedPages.length < 2) return;

    const project = selectedProject;
    const notebook = selectedNotebook;

    function shouldIgnorePageArrowNavigation(target: EventTarget | null) {
      if (!(target instanceof Element)) return false;
      if (target.closest("[contenteditable='true'], input, textarea, select, [role='textbox'], [data-transient-menu], [data-search-dialog], dialog")) return true;
      const pageCard = target.closest("[data-page-card-id]");
      return Boolean(target.closest("button, a, [role='button']")) && !pageCard;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      if (sortOptionsOpen || filterOptionsOpen || notebookSearchOpen || pageMenuId) return;
      if (shouldIgnorePageArrowNavigation(event.target)) return;

      const activeElement = document.activeElement;
      const focusIsOnPageList = activeElement instanceof Element && Boolean(pageListRef.current?.contains(activeElement));
      const focusIsPlainPage = activeElement === document.body || activeElement === document.documentElement;
      if (!focusIsOnPageList && !focusIsPlainPage) return;

      const currentIndex = sortedPages.findIndex((page) => page.id === selectedPage?.id);
      if (currentIndex < 0) return;
      const nextIndex = event.key === "ArrowDown"
        ? Math.min(currentIndex + 1, sortedPages.length - 1)
        : Math.max(currentIndex - 1, 0);
      if (nextIndex === currentIndex) return;

      event.preventDefault();
      selectPage(project, notebook, sortedPages[nextIndex]);
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [collapsed, filterOptionsOpen, notebookSearchOpen, pageMenuId, selectPage, selectedNotebook, selectedPage?.id, selectedProject, sortOptionsOpen, sortedPages]);

  useEffect(() => {
    if (collapsed || !selectedPage?.id) return;
    const list = pageListRef.current;
    if (!list) return;
    const selectedCard = list.querySelector<HTMLElement>(`[data-page-card-id="${CSS.escape(selectedPage.id)}"]`);
    if (!selectedCard) return;
    const frame = window.requestAnimationFrame(() => {
      selectedCard.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [collapsed, selectedNotebook?.id, selectedPage?.id]);

  function toggleTagFilter(tag: string) {
    setSelectedTags((current) => current.some((selected) => selected.toLowerCase() === tag.toLowerCase()) ? current.filter((selected) => selected.toLowerCase() !== tag.toLowerCase()) : [...current, tag]);
  }

  function toggleStatusFilter(status: PageStatus) {
    setSelectedStatuses((current) => current.includes(status) ? current.filter((selected) => selected !== status) : [...current, status]);
  }

  function clearFilters() {
    setSelectedTags([]);
    setSelectedStatuses([]);
    setTagQuery("");
  }

  function selectNotebookSearchResult(result: HydratedSearchResult) {
    if (!result.project || !result.notebook || !result.page) return;
    selectPage(result.project, result.notebook, result.page);
    closeNotebookSearch();
  }

  function closeNotebookSearch() {
    setNotebookSearchOpen(false);
    setNotebookSearchLoading(false);
    setNotebookSearchApproxLoading(false);
  }

  if (collapsed) {
    return (
      <aside className="flex min-h-screen justify-center overflow-hidden bg-slate-50 px-0 py-4 text-slate-900">
        <button
          type="button"
          onClick={toggleCollapsed}
          className="grid h-8 w-8 place-items-center border border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-950"
          aria-label="Expand page manager"
          title={`Expand pages for ${selectedNotebook?.name ?? "notebook"}`}
        >
          <ChevronRight size={16} />
        </button>
      </aside>
    );
  }

  return (
    <>
    <aside className="relative z-30 grid min-h-screen min-w-0 grid-rows-[auto_1fr] overflow-visible bg-slate-50 text-slate-900">
      <div className="min-w-0 border-b border-slate-200 px-4 py-4">
        <div className="mb-3 min-w-0">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <h2 className="min-w-0 flex-1 break-words text-lg font-semibold leading-6 [overflow-wrap:anywhere]">{selectedNotebook?.name ?? "Notebook"}</h2>
            <button
              type="button"
              onClick={toggleCollapsed}
              className="grid h-7 w-7 shrink-0 place-items-center text-slate-500 hover:bg-slate-100 hover:text-slate-950"
              aria-label="Collapse page manager"
              title="Collapse page manager"
            >
              <ChevronLeft size={16} />
            </button>
          </div>
          <p className="mt-1 text-sm text-slate-500">{pageCountLabel}</p>
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button onClick={createNewPage} disabled={creatingPage || !selectedNotebook || !canEdit} className="inline-flex h-8 items-center gap-1.5 border bg-white px-2.5 text-sm font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60" style={{ borderColor: color, color }} title={canEdit ? "Create page" : "Viewer access cannot create pages"}>
              {creatingPage ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              {creatingPage ? "Creating" : "Page"}
            </button>
            <button
              type="button"
              onClick={() => setNotebookSearchOpen(true)}
              disabled={!selectedNotebook}
              className="grid h-8 w-8 place-items-center border bg-white hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              style={{ borderColor: color, color }}
              aria-label="Search pages in this notebook"
              title="Search pages"
            >
              <Search size={15} />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <div ref={sortOptionsRef} data-transient-menu="true" className="relative">
              <button
                type="button"
                onClick={() => setSortOptionsOpen((open) => !open)}
                className="grid h-8 w-8 place-items-center border border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-900"
                aria-label="Sort pages"
                aria-haspopup="dialog"
                aria-expanded={sortOptionsOpen}
                title={`Sort: ${PAGE_SORT_OPTIONS.find((option) => option.key === sortKey)?.label}`}
              >
                <SlidersHorizontal size={16} />
              </button>
              {sortOptionsOpen ? (
                <section
                  role="dialog"
                  aria-label="Sort pages"
                  className="absolute right-0 top-10 z-30 w-52 border border-slate-200 bg-white p-1 text-slate-900 shadow-2xl shadow-slate-950/15"
                >
                  <p className="px-3 pb-1.5 pt-2 text-xs font-semibold text-slate-500">Sort by</p>
                  <div className="space-y-1">
                    {PAGE_SORT_OPTIONS.map((option) => {
                      const selected = option.key === sortKey;
                      return (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => {
                            setSortKey(option.key);
                            setSortOptionsOpen(false);
                          }}
                          className={`flex h-9 w-full items-center justify-between gap-3 px-3 text-left text-sm font-medium ${selected ? "bg-slate-100 text-slate-950" : "text-slate-700 hover:bg-slate-50 hover:text-slate-950"}`}
                        >
                          <span>{option.label}</span>
                          {selected ? <Check size={14} style={{ color }} /> : null}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ) : null}
            </div>

            <div ref={filterOptionsRef} data-transient-menu="true" className="relative">
              <button
                type="button"
                onClick={() => {
                  setFilterOptionsOpen((open) => !open);
                  setActiveFilterPanel("tags");
                }}
                className={`relative grid h-8 w-8 place-items-center border bg-white text-slate-600 hover:border-slate-400 hover:text-slate-900 ${filterActive ? "border-slate-500" : "border-slate-300"}`}
                aria-label="Filter pages"
                aria-haspopup="dialog"
                aria-expanded={filterOptionsOpen}
                title="Filter pages"
              >
                <Filter size={15} />
                {filterCount ? <span className="absolute -right-1 -top-1 grid min-w-4 place-items-center bg-slate-950 px-1 text-[10px] font-semibold leading-4 text-white">{filterCount}</span> : null}
              </button>
              {filterOptionsOpen ? (
                <section
                  role="dialog"
                  aria-label="Filter pages"
                  className="absolute left-0 top-10 z-50 flex items-start gap-2 text-slate-900"
                >
                  <div className="w-52 border border-slate-200 bg-white p-1 shadow-2xl shadow-slate-950/15">
                    <div className="flex items-center justify-between gap-3 px-3 pb-1.5 pt-2">
                      <p className="text-xs font-semibold text-slate-500">Filter by</p>
                      {filterActive ? <button type="button" onClick={clearFilters} className="text-xs font-medium text-cyan-700 hover:text-cyan-900">Clear all</button> : null}
                    </div>
                    <button
                      type="button"
                      onMouseEnter={() => setActiveFilterPanel("tags")}
                      onFocus={() => setActiveFilterPanel("tags")}
                      onClick={() => setActiveFilterPanel("tags")}
                      className={`flex h-10 w-full items-center gap-2 px-3 text-left text-sm font-medium ${activeFilterPanel === "tags" ? "bg-slate-100 text-slate-950" : "text-slate-700 hover:bg-slate-50 hover:text-slate-950"}`}
                    >
                      <Tag size={15} style={{ color }} />
                      <span className="min-w-0 flex-1">Tags</span>
                      {selectedTags.length ? <span className="text-xs text-slate-500">{selectedTags.length}</span> : null}
                      <ChevronRight size={15} className="text-slate-400" />
                    </button>
                    <button
                      type="button"
                      onMouseEnter={() => setActiveFilterPanel("status")}
                      onFocus={() => setActiveFilterPanel("status")}
                      onClick={() => setActiveFilterPanel("status")}
                      className={`flex h-10 w-full items-center gap-2 px-3 text-left text-sm font-medium ${activeFilterPanel === "status" ? "bg-slate-100 text-slate-950" : "text-slate-700 hover:bg-slate-50 hover:text-slate-950"}`}
                    >
                      <Flag size={15} style={{ color }} />
                      <span className="min-w-0 flex-1">Status</span>
                      {selectedStatuses.length ? <span className="text-xs text-slate-500">{selectedStatuses.length}</span> : null}
                      <ChevronRight size={15} className="text-slate-400" />
                    </button>
                  </div>

                  <div className="w-80 border border-slate-200 bg-white p-3 shadow-2xl shadow-slate-950/15">
                    {activeFilterPanel === "tags" ? (
                      <>
                        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900"><Tag size={15} style={{ color }} />Tags</div>
                        <input
                          value={tagQuery}
                          onChange={(event) => setTagQuery(event.target.value)}
                          className="mb-2 h-9 w-full border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-cyan-500"
                          placeholder="Search tags..."
                        />
                        <div className="max-h-64 space-y-1 overflow-y-auto scroll-contained pr-1">
                          {visibleTags.map((tag) => {
                            const selected = selectedTags.some((candidate) => candidate.toLowerCase() === tag.toLowerCase());
                            return (
                              <button
                                key={tag}
                                type="button"
                                onClick={() => toggleTagFilter(tag)}
                                className={`flex h-9 w-full items-center gap-2 px-2 text-left text-sm ${selected ? "bg-slate-100 text-slate-950" : "text-slate-700 hover:bg-slate-50 hover:text-slate-950"}`}
                              >
                                <span className={`grid size-5 shrink-0 place-items-center border ${selected ? "border-cyan-500 bg-cyan-500 text-white" : "border-slate-300"}`}>{selected ? <Check size={13} /> : null}</span>
                                <span className="truncate">{tag}</span>
                              </button>
                            );
                          })}
                          {visibleTags.length === 0 ? <p className="px-2 py-2 text-sm text-slate-500">No matching tags.</p> : null}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900"><Flag size={15} style={{ color }} />Status</div>
                        <div className="space-y-1">
                          {PAGE_STATUS_OPTIONS.map((option) => {
                            const selected = selectedStatuses.includes(option.value);
                            return (
                              <button
                                key={option.label}
                                type="button"
                                onClick={() => toggleStatusFilter(option.value)}
                                className={`flex h-9 w-full items-center gap-2 px-2 text-left text-sm ${selected ? "bg-slate-100 text-slate-950" : "text-slate-700 hover:bg-slate-50 hover:text-slate-950"}`}
                              >
                                <span className={`grid size-5 shrink-0 place-items-center border ${selected ? "border-cyan-500 bg-cyan-500 text-white" : "border-slate-300"}`}>{selected ? <Check size={13} /> : null}</span>
                                <StatusDot status={option.value} />
                                <span>{option.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        </div>

        {filterActive ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {selectedTags.map((tag) => (
              <button key={tag} type="button" onClick={() => toggleTagFilter(tag)} className="inline-flex h-7 max-w-full items-center gap-1 border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700 hover:border-slate-500">
                <Tag size={12} />
                <span className="truncate">{tag}</span>
                <X size={12} />
              </button>
            ))}
            {selectedStatuses.map((status) => (
              <button key={status || "no-status"} type="button" onClick={() => toggleStatusFilter(status)} className="inline-flex h-7 items-center gap-1 rounded-full border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:border-slate-500">
                <StatusDot status={status} />
                {getPageStatusLabel(status)}
                <X size={12} />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div ref={pageListRef} className="min-w-0 max-w-full overflow-y-auto overflow-x-hidden scroll-contained py-3">
        <div className="min-w-0 max-w-full space-y-2 overflow-visible px-4">
          {sortedPages.map((page) => (
            <PageCard
              key={page.id}
              page={page}
              active={selectedPage?.id === page.id}
              accentColor={color}
              menuOpen={pageMenuId === page.id}
              setMenuOpen={(open) => setPageMenuId(open ? page.id : null)}
              onClick={() => selectedProject && selectedNotebook && selectPage(selectedProject, selectedNotebook, page)}
              onDuplicate={canEdit ? () => duplicatePage(page) : undefined}
              duplicating={duplicatingPageId === page.id}
              onMove={canEdit ? () => movePage(page) : undefined}
              moveDisabled={Boolean(page.lockedAt || page.finalizedAt)}
              onDelete={canEdit ? () => deletePage(page) : undefined}
              deleteDisabled={Boolean(page.lockedAt || page.finalizedAt)}
            />
          ))}
          {sortedPages.length === 0 ? <p className="p-3 text-sm text-slate-500">{filterActive ? "No pages match these filters." : "No pages yet."}</p> : null}
        </div>
      </div>
    </aside>
    {notebookSearchOpen ? (
      <SearchOverlay
        query={notebookQuery}
        setQuery={setNotebookQuery}
        advancedFilters={notebookSearchFilters}
        setAdvancedFilters={setNotebookSearchFilters}
        availableTags={searchTagSuggestions}
        loading={notebookSearchLoading}
        approxLoading={notebookSearchApproxLoading}
        results={hydratedNotebookSearchResults}
        scopeNotebook={selectedNotebook}
        onClose={closeNotebookSearch}
        selectResult={selectNotebookSearchResult}
      />
    ) : null}
    </>
  );
}

function filterNotebookPages(pages: PageEntry[], selectedTags: string[], selectedStatuses: PageStatus[]) {
  const tagKeys = selectedTags.map((tag) => tag.toLowerCase());
  return pages.filter((page) => {
    const pageTagKeys = new Set(page.tags.map((tag) => tag.toLowerCase()));
    const matchesTags = tagKeys.every((tag) => pageTagKeys.has(tag));
    const matchesStatus = selectedStatuses.length === 0 || selectedStatuses.includes(page.status);
    return matchesTags && matchesStatus;
  });
}

function readStoredPageSortKey() {
  return readStoredSortKey(PAGE_SORT_STORAGE_KEY, PAGE_SORT_OPTIONS, "updated");
}

function sortNotebookPages(pages: PageEntry[], sortKey: PageSortKey) {
  return pages
    .map((page, index) => ({ page, index }))
    .sort((left, right) => {
      if (sortKey === "title") {
        const titleCompare = (left.page.title || "Untitled").localeCompare(right.page.title || "Untitled", undefined, { sensitivity: "base", numeric: true });
        return titleCompare || left.index - right.index;
      }

      const field = sortKey === "created" ? "createdAt" : "updatedAt";
      const timestampCompare = timestampForSort(right.page[field]) - timestampForSort(left.page[field]);
      return timestampCompare || left.index - right.index;
    })
    .map(({ page }) => page);
}
