"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PresentationModal } from "@/components/PresentationModal";
import type { InlineAttachmentAttrs } from "@/components/RichTextEditor";
import { SpreadsheetModal } from "@/components/SpreadsheetModal";
import { AccountView } from "@/features/account/AccountView";
import { AppLoadingView } from "@/features/app/AppLoadingView";
import { ResizeHandle } from "@/features/app/ResizeHandle";
import { UpdateAvailableBanner } from "@/features/app/UpdateAvailableBanner";
import { AuthView, type AuthMode } from "@/features/auth/AuthView";
import { EditorPane, type PendingAttachmentUpload } from "@/features/editor/EditorPane";
import { HomeView } from "@/features/home/HomeView";
import { NotebookSettingsView } from "@/features/notebooks/settings/NotebookSettingsView";
import { PagesSidebar } from "@/features/pages/PagesSidebar";
import { addPageToWorkspace, removePageFromWorkspace } from "@/features/pages/workspacePageState";
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
import { UnifiedSidebar } from "@/features/sidebar/UnifiedSidebar";
import { bodyToEditorText } from "@/lib/editor";
import { normalizeTagList, tagListsEqual } from "@/lib/tags";
import type { Attachment, BlockType, Notebook, PageEntry, PageStatus, Project, SearchResult, Workspace } from "@/lib/types";
import { NameModal, type NameDialogState } from "@/features/workspace/NameModal";
import { NotebookDeleteModal } from "@/features/workspace/modals/NotebookDeleteModal";
import { PageDeleteModal } from "@/features/workspace/modals/PageDeleteModal";
import { PageMoveModal } from "@/features/workspace/modals/PageMoveModal";
import { ProjectDeleteModal } from "@/features/workspace/modals/ProjectDeleteModal";
import { canEditNotebook, normalizeColor } from "@/lib/workspaceDisplay";

const SIDEBAR_MIN_WIDTH = 320;
const SIDEBAR_MAX_WIDTH = 460;
const SIDEBAR_COLLAPSED_WIDTH = 64;
const PAGES_MIN_WIDTH = 320;
const PAGES_MAX_WIDTH = 520;

type DragState = {
  pane: "sidebar" | "pages";
  startX: number;
  startWidth: number;
};

const SUCCESS_STATUS_CLEAR_AFTER_MS = 4400;
const UPDATE_CHECK_INTERVAL_MS = 2 * 60 * 1000;

type PageSelection = {
  project: Project;
  notebook: Notebook;
  page: PageEntry;
};

type NotebookSelection = {
  project: Project;
  notebook: Notebook;
};

type ProjectSelection = {
  project: Project;
};

export default function Home() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [authError, setAuthError] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [activeView, setActiveView] = useState<"home" | "projectHome" | "project" | "notebookSettings" | "account">("home");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedNotebookId, setSelectedNotebookId] = useState("");
  const [selectedPageId, setSelectedPageId] = useState("");
  const [query, setQuery] = useState("");
  const [searchFilters, setSearchFilters] = useState<SearchAdvancedFilters>(emptySearchAdvancedFilters);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchApproxLoading, setSearchApproxLoading] = useState(false);
  const lastSearchKeyRef = useRef("");
  const [saving, setSaving] = useState("");
  const [loadingPageId, setLoadingPageId] = useState("");
  const [pendingAttachmentUploads, setPendingAttachmentUploads] = useState<PendingAttachmentUpload[]>([]);
  const saveStatusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedPageIdRef = useRef("");
  const latestBodyDraftsRef = useRef(new Map<string, string>());
  const bodySaveStatesRef = useRef(new Map<string, { inFlight: boolean; pendingBody: string | null }>());
  const [creatingPage, setCreatingPage] = useState(false);
  const [deletingPage, setDeletingPage] = useState(false);
  const [deletingNotebook, setDeletingNotebook] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);
  const [movingPage, setMovingPage] = useState(false);
  const [duplicatingPageId, setDuplicatingPageId] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_MIN_WIDTH);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [pagesWidth, setPagesWidth] = useState(340);
  const [pagesCollapsed, setPagesCollapsed] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(new Set());
  const [accountOpen, setAccountOpen] = useState(false);
  const [projectMenuId, setProjectMenuId] = useState<string | null>(null);
  const [notebookMenuId, setNotebookMenuId] = useState<string | null>(null);
  const [pageMenuId, setPageMenuId] = useState<string | null>(null);
  const [projectPendingDelete, setProjectPendingDelete] = useState<Project | null>(null);
  const [notebookPendingDelete, setNotebookPendingDelete] = useState<Notebook | null>(null);
  const [pagePendingDelete, setPagePendingDelete] = useState<PageEntry | null>(null);
  const [pagePendingMove, setPagePendingMove] = useState<PageEntry | null>(null);
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);
  const [spreadsheetModal, setSpreadsheetModal] = useState<InlineAttachmentAttrs | null>(null);
  const [presentationModal, setPresentationModal] = useState<InlineAttachmentAttrs | null>(null);
  const [previewKeys, setPreviewKeys] = useState<Set<string>>(new Set());
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateBannerDismissed, setUpdateBannerDismissed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const spreadsheetSavedRef = useRef<((attachment: InlineAttachmentAttrs) => void) | null>(null);
  const loadedVersionRef = useRef("");

  const applyPageSelection = useCallback((selection: PageSelection, urlMode: "none" | "push" | "replace" = "none") => {
    setPageMenuId(null);
    setActiveView("project");
    setSelectedProjectId(selection.project.id);
    setSelectedNotebookId(selection.notebook.id);
    setSelectedPageId(selection.page.id);
    setExpandedProjectIds((current) => new Set(current).add(selection.project.id));
    if (urlMode !== "none") writePageUrl(selection.page.id, urlMode);
  }, []);

  const applyNotebookSelection = useCallback((selection: NotebookSelection, urlMode: "none" | "push" | "replace" = "none") => {
    setPageMenuId(null);
    setActiveView("project");
    setSelectedProjectId(selection.project.id);
    setSelectedNotebookId(selection.notebook.id);
    setSelectedPageId(selection.notebook.pages[0]?.id ?? "");
    setExpandedProjectIds((current) => new Set(current).add(selection.project.id));
    if (urlMode !== "none") writeNotebookUrl(selection.notebook.id, urlMode);
  }, []);

  const applyNotebookSettingsSelection = useCallback((selection: NotebookSelection, urlMode: "none" | "push" | "replace" = "none") => {
    setPageMenuId(null);
    setActiveView("notebookSettings");
    setSelectedProjectId(selection.project.id);
    setSelectedNotebookId(selection.notebook.id);
    setSelectedPageId("");
    setExpandedProjectIds((current) => new Set(current).add(selection.project.id));
    if (urlMode !== "none") writeNotebookSettingsUrl(selection.notebook.id, urlMode);
  }, []);

  const applyProjectSelection = useCallback((selection: ProjectSelection, urlMode: "none" | "push" | "replace" = "none") => {
    setPageMenuId(null);
    setActiveView("projectHome");
    setSelectedProjectId(selection.project.id);
    setSelectedNotebookId("");
    setSelectedPageId("");
    setExpandedProjectIds((current) => new Set(current).add(selection.project.id));
    if (urlMode !== "none") writeProjectUrl(selection.project.id, urlMode);
  }, []);

  const selectFirstAvailable = useCallback((data: Workspace) => {
    if (readAccountViewFromUrl()) {
      setActiveView("account");
      setPageMenuId(null);
      return;
    }

    const linkedSettingsNotebook = findNotebookSelection(data, readNotebookSettingsIdFromUrl());
    if (linkedSettingsNotebook) {
      applyNotebookSettingsSelection(linkedSettingsNotebook, "replace");
      return;
    }

    const linkedSelection = findPageSelection(data, readPageIdFromUrl());
    if (linkedSelection) {
      applyPageSelection(linkedSelection, "replace");
      return;
    }

    const linkedNotebook = findNotebookSelection(data, readNotebookIdFromUrl());
    if (linkedNotebook) {
      applyNotebookSelection(linkedNotebook, "replace");
      return;
    }

    const linkedProject = findProjectSelection(data, readProjectIdFromUrl());
    if (linkedProject) {
      applyProjectSelection(linkedProject, "replace");
      return;
    }

    if (readNotebookSettingsIdFromUrl() || readPageIdFromUrl() || readNotebookIdFromUrl() || readProjectIdFromUrl()) writePageUrl(null, "replace");
    const project = data.projects[0];
    const notebook = project?.notebooks[0];
    const page = notebook?.pages[0];
    setSelectedProjectId((current) => current || project?.id || "");
    setSelectedNotebookId((current) => current || notebook?.id || "");
    setSelectedPageId((current) => current || page?.id || "");
    if (project) setExpandedProjectIds((current) => new Set(current).add(project.id));
  }, [applyNotebookSelection, applyNotebookSettingsSelection, applyPageSelection, applyProjectSelection]);

  useEffect(() => {
    setPreviewKeys(readPreviewKeysFromUrl());
    cleanupUpdateCacheBusterFromUrl();
  }, []);

  useEffect(() => {
    if (previewKeys.has("update-banner")) return;
    let active = true;

    async function checkVersion() {
      try {
        const response = await fetch("/api/version", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json().catch(() => null)) as { version?: string } | null;
        if (!active || !body?.version) return;
        if (!loadedVersionRef.current) {
          loadedVersionRef.current = body.version;
          return;
        }
        if (body.version !== loadedVersionRef.current) setUpdateAvailable(true);
      } catch {
        // Version checks should never interrupt editing.
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") void checkVersion();
    }

    void checkVersion();
    const timer = window.setInterval(checkVersion, UPDATE_CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [previewKeys]);

  useEffect(() => {
    let active = true;
    async function load() {
      const response = await fetch("/api/workspace");
      if (!active) return;
      if (response.status === 401) {
        setWorkspace(null);
        setLoading(false);
        return;
      }
      const data = (await response.json()) as Workspace;
      setWorkspace(data);
      selectFirstAvailable(data);
      setLoading(false);
    }
    void load();
    return () => {
      active = false;
    };
  }, [selectFirstAvailable]);

  useEffect(() => {
    if (!workspace) return;
    const currentWorkspace = workspace;

    function onPopState() {
      if (readAccountViewFromUrl()) {
        setActiveView("account");
        setPageMenuId(null);
        setAccountOpen(false);
        return;
      }

      const notebookSettingsSelection = findNotebookSelection(currentWorkspace, readNotebookSettingsIdFromUrl());
      if (notebookSettingsSelection) {
        applyNotebookSettingsSelection(notebookSettingsSelection);
        return;
      }
      const selection = findPageSelection(currentWorkspace, readPageIdFromUrl());
      if (selection) {
        applyPageSelection(selection);
        return;
      }
      const notebookSelection = findNotebookSelection(currentWorkspace, readNotebookIdFromUrl());
      if (notebookSelection) {
        applyNotebookSelection(notebookSelection);
        return;
      }
      const projectSelection = findProjectSelection(currentWorkspace, readProjectIdFromUrl());
      if (projectSelection) {
        applyProjectSelection(projectSelection);
        return;
      }
      setActiveView("home");
      setPageMenuId(null);
    }

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [applyNotebookSelection, applyNotebookSettingsSelection, applyPageSelection, applyProjectSelection, workspace]);

  useEffect(() => {
    if (!dragState) return;
    const activeDrag = dragState;
    const root = document.documentElement;
    const previousUserSelect = root.style.userSelect;
    const previousCursor = root.style.cursor;
    root.style.userSelect = "none";
    root.style.cursor = "col-resize";

    function onPointerMove(event: PointerEvent) {
      const nextWidth = activeDrag.startWidth + event.clientX - activeDrag.startX;
      if (activeDrag.pane === "sidebar") setSidebarWidth(clamp(nextWidth, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH));
      if (activeDrag.pane === "pages") setPagesWidth(clamp(nextWidth, PAGES_MIN_WIDTH, PAGES_MAX_WIDTH));
    }

    function finishDrag() {
      setDragState(null);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
    return () => {
      root.style.userSelect = previousUserSelect;
      root.style.cursor = previousCursor;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
    };
  }, [dragState]);

  useEffect(() => {
    function isInsideTransientMenu(target: EventTarget | null) {
      return target instanceof Element && Boolean(target.closest("[data-transient-menu]"));
    }

    function closeTransientMenus() {
      setProjectMenuId(null);
      setNotebookMenuId(null);
      setPageMenuId(null);
      setAccountOpen(false);
    }

    function onPointerDown(event: PointerEvent) {
      if (!isInsideTransientMenu(event.target)) closeTransientMenus();
    }

    function onFocusIn(event: FocusEvent) {
      if (!isInsideTransientMenu(event.target)) closeTransientMenus();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeTransientMenus();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const selectedProject = workspace?.projects.find((project) => project.id === selectedProjectId) ?? workspace?.projects[0];
  const selectedNotebook = selectedProject?.notebooks.find((notebook) => notebook.id === selectedNotebookId) ?? selectedProject?.notebooks[0];
  const selectedPage = selectedNotebook?.pages.find((page) => page.id === selectedPageId) ?? selectedNotebook?.pages[0];
  selectedPageIdRef.current = selectedPage?.id ?? "";
  const selectedNotebookCanEdit = canEditNotebook(workspace?.user, selectedNotebook);
  const selectedPageCanEdit = selectedNotebookCanEdit && !selectedPage?.lockedAt;
  const selectedPageCanManageLock = selectedNotebookCanEdit;

  useEffect(() => {
    setPendingAttachmentUploads([]);
  }, [selectedPage?.id]);

  const selectedNotebookTagSuggestions = useMemo(
    () => normalizeTagList(selectedNotebook?.pages.flatMap((page) => page.tags) ?? []).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    [selectedNotebook],
  );
  const globalSearchTagSuggestions = useMemo(
    () => normalizeTagList(workspace?.projects.flatMap((project) => project.notebooks.flatMap((notebook) => notebook.pages.flatMap((page) => page.tags))) ?? []).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    [workspace],
  );
  const editorTagSuggestions =
    workspace?.appSettings?.suggestTagsGlobally !== false ? globalSearchTagSuggestions : selectedNotebookTagSuggestions;
  const searchTagSuggestions = editorTagSuggestions;

  const recentPages = useMemo(() => {
    return (
      workspace?.projects
        .flatMap((project) =>
          project.notebooks.flatMap((notebook) =>
            notebook.pages.map((page) => ({ page, project, notebook })),
          ),
        )
        .sort((a, b) => Date.parse(b.page.updatedAt) - Date.parse(a.page.updatedAt))
        .slice(0, 24) ?? []
    );
  }, [workspace]);

  const pageLookup = useMemo(() => {
    const lookup = new Map<string, { page: PageEntry; project: Project; notebook: Notebook }>();
    workspace?.projects.forEach((project) => {
      project.notebooks.forEach((notebook) => {
        notebook.pages.forEach((page) => lookup.set(page.id, { page, project, notebook }));
      });
    });
    return lookup;
  }, [workspace]);

  const hydratedSearchResults = useMemo<HydratedSearchResult[]>(() => {
    return searchResults.map((result) => ({ ...result, ...pageLookup.get(result.pageId) }));
  }, [pageLookup, searchResults]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchLoading(false);
    setSearchApproxLoading(false);
  }, []);

  useEffect(() => {
    if (!searchOpen) return;
    const trimmed = query.trim();
    const filterActive = hasSearchResultCriteria(searchFilters);
    const searchKey = searchCacheKey({ query: trimmed, filters: searchFilters });
    if (lastSearchKeyRef.current === searchKey) {
      setSearchLoading(false);
      setSearchApproxLoading(false);
      return;
    }
    let active = true;
    const fastController = new AbortController();
    const approxController = new AbortController();
    const timeout = window.setTimeout(async () => {
      if (!trimmed && !filterActive) {
        setSearchResults([]);
        setSearchLoading(false);
        setSearchApproxLoading(false);
        lastSearchKeyRef.current = searchKey;
        return;
      }

      setSearchLoading(true);
      setSearchApproxLoading(false);
      try {
        const response = await fetch(searchApiUrl({ query: trimmed, limit: 30, mode: "fast", filters: searchFilters }), { signal: fastController.signal });
        if (!active) return;
        if (!response.ok) {
          setSearchResults([]);
          return;
        }
        const body = (await response.json()) as { results: SearchResult[] };
        setSearchResults(body.results);
        lastSearchKeyRef.current = searchKey;
      } catch (error) {
        if (!fastController.signal.aborted) setSearchResults([]);
        return;
      } finally {
        if (active) setSearchLoading(false);
      }

      if (!active) return;
      if (!hasApproximateSearchBasis(trimmed, searchFilters)) return;
      setSearchApproxLoading(true);
      try {
        const response = await fetch(searchApiUrl({ query: trimmed, limit: 30, mode: "approx", filters: searchFilters }), { signal: approxController.signal });
        if (!active || !response.ok) return;
        const body = (await response.json()) as { results: SearchResult[] };
        setSearchResults((current) => mergeSearchResultLists(current, body.results).slice(0, 30));
      } catch {
        // Approximate search is best-effort; keep the fast indexed results visible.
      } finally {
        if (active) setSearchApproxLoading(false);
      }
    }, 180);

    return () => {
      active = false;
      fastController.abort();
      approxController.abort();
      window.clearTimeout(timeout);
    };
  }, [query, searchFilters, searchOpen]);

  useEffect(() => {
    if (!searchOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeSearch();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeSearch, searchOpen]);

  async function refreshWorkspace(selection?: { projectId?: string; notebookId?: string; pageId?: string; view?: "notebookSettings" }) {
    const response = await fetch("/api/workspace");
    if (!response.ok) return;
    const data = (await response.json()) as Workspace;
    setWorkspace(data);
    if (!selection) {
      selectFirstAvailable(data);
      return;
    }

    if (selection.view === "notebookSettings" && selection.notebookId) {
      const linkedNotebook = findNotebookSelection(data, selection.notebookId);
      if (linkedNotebook) {
        applyNotebookSettingsSelection(linkedNotebook, "replace");
        return;
      }
    }

    if (selection.pageId) {
      const linkedSelection = findPageSelection(data, selection.pageId);
      if (linkedSelection) {
        applyPageSelection(linkedSelection, "replace");
        return;
      }
    }

    if (selection.notebookId) {
      const linkedNotebook = findNotebookSelection(data, selection.notebookId);
      if (linkedNotebook) {
        applyNotebookSelection(linkedNotebook, "replace");
        return;
      }
    }

    if (selection.projectId) {
      const linkedProject = findProjectSelection(data, selection.projectId);
      if (linkedProject) {
        applyProjectSelection(linkedProject, "replace");
        return;
      }
      setSelectedProjectId(selection.projectId);
    }
    if (selection.notebookId) setSelectedNotebookId(selection.notebookId);
    setSelectedPageId("");
    writePageUrl(null, "replace");
  }

  async function handleAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authSubmitting) return;
    setAuthError("");
    setAuthSubmitting(true);
    try {
      const response = await fetch(authMode === "register" ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(authMode === "register" ? { email, firstName, lastName, password } : { email, password, rememberDevice }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setAuthError(body?.error ?? (authMode === "register" ? "Registration failed." : "Login failed."));
        return;
      }
      await refreshWorkspace();
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setWorkspace(null);
    setAccountOpen(false);
  }

  function selectProject(project: Project) {
    applyProjectSelection({ project }, "push");
  }

  function selectNotebook(project: Project, notebook: Notebook) {
    setPageMenuId(null);
    setActiveView("project");
    setSelectedProjectId(project.id);
    setSelectedNotebookId(notebook.id);
    setSelectedPageId(notebook.pages[0]?.id ?? "");
    setExpandedProjectIds((current) => new Set(current).add(project.id));
    writeNotebookUrl(notebook.id, "push");
  }

  function toggleProject(project: Project) {
    setExpandedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(project.id)) next.delete(project.id);
      else next.add(project.id);
      return next;
    });
  }

  function selectPage(project: Project, notebook: Notebook, page: PageEntry) {
    applyPageSelection({ project, notebook, page }, "push");
  }

  function selectSearchResult(result: HydratedSearchResult) {
    if (result.project && result.notebook && result.page) {
      selectPage(result.project, result.notebook, result.page);
      closeSearch();
      return;
    }
    setActiveView("project");
    setSelectedProjectId(result.projectId);
    setSelectedNotebookId(result.notebookId);
    setSelectedPageId(result.pageId);
    writePageUrl(result.pageId, "push");
    closeSearch();
  }

  function patchPage(pageId: string, patch: Partial<PageEntry>) {
    setWorkspace((current) => current ? {
      ...current,
      projects: current.projects.map((project) => ({
        ...project,
        notebooks: project.notebooks.map((notebook) => ({
          ...notebook,
          pages: notebook.pages.map((page) => (page.id === pageId ? { ...page, ...patch } : page)),
        })),
      })),
    } : current);
  }

  function patchSelectedPage(patch: Partial<PageEntry>) {
    if (!workspace || !selectedPage || !selectedNotebookCanEdit) return;
    patchPage(selectedPage.id, patch);
  }

  useEffect(() => {
    if (!selectedPage?.id || selectedPage.bodyLoaded) return;
    let active = true;
    const pageId = selectedPage.id;
    setLoadingPageId(pageId);
    async function loadPage() {
      const response = await fetch(`/api/pages/${pageId}`);
      if (!active) return;
      if (!response.ok) {
        setLoadingPageId("");
        return;
      }
      const body = (await response.json()) as { page?: PageEntry };
      if (!active) return;
      if (body.page) patchPage(pageId, body.page);
      setLoadingPageId("");
    }
    void loadPage();
    return () => {
      active = false;
    };
  }, [selectedPage?.id, selectedPage?.bodyLoaded]);

  function setSaveStatus(status: string, options: { clearAfterMs?: number } = {}) {
    if (saveStatusTimer.current) {
      clearTimeout(saveStatusTimer.current);
      saveStatusTimer.current = null;
    }
    setSaving(status);
    if (options.clearAfterMs && status) {
      saveStatusTimer.current = setTimeout(() => {
        setSaving("");
        saveStatusTimer.current = null;
      }, options.clearAfterMs);
    }
  }

  useEffect(() => {
    return () => {
      if (saveStatusTimer.current) clearTimeout(saveStatusTimer.current);
    };
  }, []);

  function setPageSaveStatus(pageId: string, status: string, options: { clearAfterMs?: number } = {}) {
    if (selectedPageIdRef.current !== pageId) return;
    setSaveStatus(status, options);
  }

  function markBodyUnsaved(pageId: string, body: string) {
    latestBodyDraftsRef.current.set(pageId, body);
    setPageSaveStatus(pageId, "Unsaved");
  }

  async function saveBodyPage(pageId: string, body: string) {
    const states = bodySaveStatesRef.current;
    const state = states.get(pageId) ?? { inFlight: false, pendingBody: null };
    state.pendingBody = body;
    states.set(pageId, state);
    if (state.inFlight) return;

    state.inFlight = true;
    try {
      while (state.pendingBody !== null) {
        const bodyToSave = state.pendingBody;
        state.pendingBody = null;
        setPageSaveStatus(pageId, "Saving...");
        const response = await fetch(`/api/pages/${pageId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: bodyToSave }),
        });
        const result = (await response.json().catch(() => null)) as { changed?: boolean } | null;
        const latestBody = latestBodyDraftsRef.current.get(pageId);
        if (!response.ok) {
          setPageSaveStatus(pageId, "Save failed");
          return;
        }
        if (latestBody !== bodyToSave) continue;
        if (result?.changed) patchPage(pageId, { body: bodyToSave, updatedAt: "Just now" });
        else patchPage(pageId, { body: bodyToSave });
        setPageSaveStatus(pageId, "Saved", { clearAfterMs: SUCCESS_STATUS_CLEAR_AFTER_MS });
      }
    } finally {
      state.inFlight = false;
      if (state.pendingBody !== null) void saveBodyPage(pageId, state.pendingBody);
    }
  }

  async function savePage(patch: { title?: string; body?: string; status?: PageStatus }) {
    if (!selectedPage || !selectedPageCanEdit) return;
    const pageId = selectedPage.id;
    if (Object.prototype.hasOwnProperty.call(patch, "body")) {
      await saveBodyPage(pageId, patch.body ?? "");
      return;
    }
    setPageSaveStatus(pageId, "Saving...");
    const response = await fetch(`/api/pages/${pageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const result = (await response.json().catch(() => null)) as { changed?: boolean } | null;
    if (!response.ok) {
      setPageSaveStatus(pageId, "Save failed");
      return;
    }
    if (!result?.changed) {
      setPageSaveStatus(pageId, "");
      return;
    }
    patchPage(pageId, { ...patch, updatedAt: "Just now" });
    setPageSaveStatus(pageId, "Saved", { clearAfterMs: SUCCESS_STATUS_CLEAR_AFTER_MS });
  }

  async function setSelectedPageTags(tags: string[]) {
    if (!selectedPage || !selectedPageCanEdit) return;
    const normalizedTags = normalizeTagList(tags);
    if (tagListsEqual(normalizedTags, normalizeTagList(selectedPage.tags))) return;
    patchSelectedPage({ tags: normalizedTags });
    setSaveStatus("Saving...");
    const response = await fetch(`/api/pages/${selectedPage.id}/tags`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: normalizedTags }),
    });
    const result = (await response.json().catch(() => null)) as { changed?: boolean } | null;
    setSaveStatus(response.ok ? "Saved" : "Tag save failed", response.ok ? { clearAfterMs: SUCCESS_STATUS_CLEAR_AFTER_MS } : {});
    if (response.ok && result?.changed) patchSelectedPage({ updatedAt: "Just now" });
    if (!response.ok) await refreshWorkspace({ projectId: selectedProject?.id, notebookId: selectedNotebook?.id, pageId: selectedPage.id });
  }

  async function setSelectedPageLocked(locked: boolean) {
    if (!selectedPage || !selectedPageCanManageLock) return;
    const response = await fetch(`/api/pages/${selectedPage.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locked }),
    });
    if (!response.ok) throw new Error("Could not update page lock.");
    await refreshWorkspace({ projectId: selectedProject?.id, notebookId: selectedNotebook?.id, pageId: selectedPage.id });
  }

  function openHome() {
    setActiveView("home");
    setAccountOpen(false);
    setPageMenuId(null);
    writePageUrl(null, "push");
  }

  function openAccount() {
    setActiveView("account");
    setAccountOpen(false);
    setProjectMenuId(null);
    setNotebookMenuId(null);
    setPageMenuId(null);
    writeAccountUrl("push");
  }

  function renameExistingProject(project: Project) {
    setProjectMenuId(null);
    setNotebookMenuId(null);
    setPageMenuId(null);
    setAccountOpen(false);
    setNameDialog({ kind: "renameProject", project });
  }

  function requestProjectDelete(project: Project) {
    setProjectMenuId(null);
    setNotebookMenuId(null);
    setPageMenuId(null);
    setAccountOpen(false);
    setProjectPendingDelete(project);
  }

  async function updateExistingProjectColor(project: Project, color: string) {
    const nextColor = normalizeColor(color);
    setWorkspace((current) => current ? {
      ...current,
      projects: current.projects.map((candidate) => candidate.id === project.id ? { ...candidate, color: nextColor } : candidate),
    } : current);
    const response = await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ color: nextColor }),
    });
    if (!response.ok) await refreshWorkspace({ projectId: selectedProject?.id, notebookId: selectedNotebook?.id, pageId: selectedPage?.id });
  }

  function renameExistingNotebook(notebook: Notebook) {
    setProjectMenuId(null);
    setNotebookMenuId(null);
    setPageMenuId(null);
    setAccountOpen(false);
    setNameDialog({ kind: "renameNotebook", notebook });
  }

  function requestNotebookDelete(notebook: Notebook) {
    setProjectMenuId(null);
    setNotebookMenuId(null);
    setPageMenuId(null);
    setAccountOpen(false);
    setNotebookPendingDelete(notebook);
  }

  function openNotebookSettings(notebook: Notebook) {
    setProjectMenuId(null);
    setNotebookMenuId(null);
    setPageMenuId(null);
    setAccountOpen(false);
    const notebookSelection = workspace ? findNotebookSelection(workspace, notebook.id) : null;
    if (notebookSelection) {
      applyNotebookSettingsSelection(notebookSelection, "push");
      return;
    }
    setSelectedProjectId(selectedProject?.id ?? workspace?.projects[0]?.id ?? "");
    setSelectedNotebookId(notebook.id);
    setSelectedPageId("");
    setActiveView("notebookSettings");
    writeNotebookSettingsUrl(notebook.id, "push");
  }

  async function updateExistingNotebookColor(notebook: Notebook, color: string) {
    const nextColor = normalizeColor(color);
    setWorkspace((current) => current ? {
      ...current,
      projects: current.projects.map((project) => ({
        ...project,
        notebooks: project.notebooks.map((candidate) => candidate.id === notebook.id ? { ...candidate, color: nextColor } : candidate),
      })),
      notebooks: current.notebooks.map((candidate) => candidate.id === notebook.id ? { ...candidate, color: nextColor } : candidate),
    } : current);
    const response = await fetch(`/api/notebooks/${notebook.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ color: nextColor }),
    });
    if (!response.ok) await refreshWorkspace({ projectId: selectedProject?.id, notebookId: selectedNotebook?.id, pageId: selectedPage?.id });
  }

  function requestPageDelete(page: PageEntry) {
    setProjectMenuId(null);
    setNotebookMenuId(null);
    setPageMenuId(null);
    setAccountOpen(false);
    setPagePendingDelete(page);
  }

  function requestPageMove(page: PageEntry) {
    setProjectMenuId(null);
    setNotebookMenuId(null);
    setPageMenuId(null);
    setAccountOpen(false);
    setPagePendingMove(page);
  }

  async function confirmPageDelete() {
    if (!pagePendingDelete || !selectedNotebook || !selectedNotebookCanEdit || pagePendingDelete.lockedAt || deletingPage) return;
    const pageToDelete = pagePendingDelete;
    const workspaceBeforeDelete = workspace;
    const selectionBeforeDelete = {
      projectId: selectedProject?.id ?? "",
      notebookId: selectedNotebook.id,
      pageId: selectedPage?.id ?? "",
    };
    const remainingPages = selectedNotebook.pages.filter((page) => page.id !== pageToDelete.id);
    const deletedIndex = selectedNotebook.pages.findIndex((page) => page.id === pageToDelete.id);
    const nextPage = remainingPages[Math.min(Math.max(deletedIndex, 0), remainingPages.length - 1)];
    const nextPageId = selectedPage?.id === pageToDelete.id ? nextPage?.id ?? "" : selectedPage?.id;

    function rollbackDelete() {
      setWorkspace(workspaceBeforeDelete);
      setSelectedProjectId(selectionBeforeDelete.projectId);
      setSelectedNotebookId(selectionBeforeDelete.notebookId);
      setSelectedPageId(selectionBeforeDelete.pageId);
      setPagePendingDelete(pageToDelete);
      if (selectionBeforeDelete.pageId) writePageUrl(selectionBeforeDelete.pageId, "replace");
      else writeNotebookUrl(selectionBeforeDelete.notebookId, "replace");
    }

    setDeletingPage(true);
    setPagePendingDelete(null);
    setWorkspace((current) => current ? removePageFromWorkspace(current, pageToDelete.id, new Date().toISOString()) : current);
    if (selectedPage?.id === pageToDelete.id) setSelectedPageId(nextPageId ?? "");
    if (nextPageId) writePageUrl(nextPageId, "replace");
    else writeNotebookUrl(selectedNotebook.id, "replace");
    try {
      const response = await fetch(`/api/pages/${pageToDelete.id}`, { method: "DELETE" });
      if (!response.ok) rollbackDelete();
    } catch {
      rollbackDelete();
    } finally {
      setDeletingPage(false);
    }
  }

  async function confirmPageMove(targetNotebookId: string) {
    if (!pagePendingMove || !selectedNotebook || !selectedNotebookCanEdit || pagePendingMove.lockedAt || movingPage) return;
    setMovingPage(true);
    try {
      const response = await fetch(`/api/pages/${pagePendingMove.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notebookId: targetNotebookId }),
      });
      if (!response.ok) return;
      setPagePendingMove(null);
      writePageUrl(pagePendingMove.id, "replace");
      await refreshWorkspace({ projectId: selectedProject?.id, notebookId: targetNotebookId, pageId: pagePendingMove.id });
    } finally {
      setMovingPage(false);
    }
  }

  async function duplicateExistingPage(page: PageEntry) {
    if (!selectedNotebook || !selectedNotebookCanEdit || page.lockedAt || duplicatingPageId) return;
    setProjectMenuId(null);
    setNotebookMenuId(null);
    setPageMenuId(null);
    setAccountOpen(false);
    setDuplicatingPageId(page.id);
    try {
      const response = await fetch(`/api/pages/${page.id}/duplicate`, { method: "POST" });
      if (!response.ok) return;
      const body = (await response.json()) as { pageId: string; notebookId: string };
      writePageUrl(body.pageId, "replace");
      await refreshWorkspace({ projectId: selectedProject?.id, notebookId: body.notebookId, pageId: body.pageId });
    } finally {
      setDuplicatingPageId("");
    }
  }

  async function confirmNotebookDelete() {
    if (!notebookPendingDelete || deletingNotebook) return;
    setDeletingNotebook(true);
    try {
      const response = await fetch(`/api/notebooks/${notebookPendingDelete.id}`, { method: "DELETE" });
      if (!response.ok) return;
      setNotebookPendingDelete(null);
      setSelectedNotebookId("");
      setSelectedPageId("");
      writePageUrl(null, "replace");
      await refreshWorkspace({ projectId: selectedProject?.id });
    } finally {
      setDeletingNotebook(false);
    }
  }

  async function confirmProjectDelete() {
    if (!projectPendingDelete || deletingProject) return;
    setDeletingProject(true);
    try {
      const response = await fetch(`/api/projects/${projectPendingDelete.id}`, { method: "DELETE" });
      if (!response.ok) return;
      setProjectPendingDelete(null);
      setSelectedProjectId("");
      setSelectedNotebookId("");
      setSelectedPageId("");
      setActiveView("home");
      writePageUrl(null, "replace");
      await refreshWorkspace();
    } finally {
      setDeletingProject(false);
    }
  }

  function createNewProject() {
    setProjectMenuId(null);
    setNotebookMenuId(null);
    setPageMenuId(null);
    setAccountOpen(false);
    setNameDialog({ kind: "createProject" });
  }

  function createNewNotebook(projectId = selectedProject?.id ?? workspace?.projects[0]?.id) {
    if (!projectId) return;
    setProjectMenuId(null);
    setNotebookMenuId(null);
    setPageMenuId(null);
    setAccountOpen(false);
    const projectName = "Novo";
    setNameDialog({ kind: "createNotebook", projectId, projectName });
  }

  async function submitNameDialog(name: string) {
    if (!nameDialog) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    if (nameDialog.kind === "createProject") {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!response.ok) return;
      const body = (await response.json()) as { projectId: string; notebookId: string; pageId: string };
      setNameDialog(null);
      setActiveView("project");
      writeNotebookUrl(body.notebookId, "push");
      await refreshWorkspace({ projectId: body.projectId, notebookId: body.notebookId });
      return;
    }

    if (nameDialog.kind === "createNotebook") {
      const response = await fetch("/api/notebooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: nameDialog.projectId, name: trimmed }),
      });
      if (!response.ok) return;
      const body = (await response.json()) as { notebookId: string; pageId: string };
      setNameDialog(null);
      setActiveView("project");
      writeNotebookUrl(body.notebookId, "push");
      await refreshWorkspace({ projectId: nameDialog.projectId, notebookId: body.notebookId });
      return;
    }

    if (nameDialog.kind === "renameProject") {
      if (trimmed === nameDialog.project.name) {
        setNameDialog(null);
        return;
      }
      const response = await fetch(`/api/projects/${nameDialog.project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!response.ok) return;
      setNameDialog(null);
      await refreshWorkspace({ projectId: nameDialog.project.id, notebookId: selectedNotebook?.id, pageId: selectedPage?.id });
      return;
    }

    if (trimmed === nameDialog.notebook.name) {
      setNameDialog(null);
      return;
    }
    const response = await fetch(`/api/notebooks/${nameDialog.notebook.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    if (!response.ok) return;
    setNameDialog(null);
    await refreshWorkspace({ projectId: selectedProject?.id, notebookId: nameDialog.notebook.id, pageId: selectedPage?.id });
  }

  async function createNewPage() {
    if (!selectedNotebook || !selectedNotebookCanEdit || creatingPage) return;
    setCreatingPage(true);
    try {
      const response = await fetch("/api/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notebookId: selectedNotebook.id }),
      });
      if (!response.ok) return;
      const body = (await response.json()) as { pageId: string; page?: PageEntry };
      const createdPage = body.page;
      if (!createdPage) {
        await refreshWorkspace({ projectId: selectedProject?.id, notebookId: selectedNotebook.id, pageId: body.pageId });
        return;
      }
      setWorkspace((current) => current ? addPageToWorkspace(current, createdPage) : current);
      setActiveView("project");
      setSelectedProjectId(selectedProject?.id ?? "workspace");
      setSelectedNotebookId(selectedNotebook.id);
      setSelectedPageId(createdPage.id);
      writePageUrl(createdPage.id, "push");
    } finally {
      setCreatingPage(false);
    }
  }

  async function uploadAttachments(files: FileList | File[] | undefined) {
    if (!selectedPage || !selectedPageCanEdit) return;
    const uploadFiles = Array.from(files ?? []).filter((file) => file.size >= 0);
    if (!uploadFiles.length) return;
    const pageId = selectedPage.id;
    const projectId = selectedProject?.id;
    const notebookId = selectedNotebook?.id;
    const pendingUploads = uploadFiles.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: file.name,
      size: file.size,
      status: "uploading" as const,
    }));
    setPendingAttachmentUploads((current) => [...current, ...pendingUploads]);

    let shouldRefresh = false;
    for (const [index, file] of uploadFiles.entries()) {
      const pendingId = pendingUploads[index].id;
      const form = new FormData();
      form.set("file", file);
      const response = await fetch(`/api/pages/${pageId}/attachments`, { method: "POST", body: form });
      if (!response.ok) {
        setPendingAttachmentUploads((current) =>
          current.map((upload) => upload.id === pendingId ? { ...upload, status: "failed" } : upload),
        );
        continue;
      }
      shouldRefresh = true;
      setPendingAttachmentUploads((current) => current.filter((upload) => upload.id !== pendingId));
    }
    if (shouldRefresh) {
      await refreshWorkspace({ projectId, notebookId, pageId });
    }
  }

  async function deletePageAttachment(attachment: Attachment) {
    if (!selectedPage || !selectedPageCanEdit) return false;
    const response = await fetch(`/api/attachments/${attachment.id}`, { method: "DELETE" });
    if (!response.ok) {
      return false;
    }
    await refreshWorkspace({ projectId: selectedProject?.id, notebookId: selectedNotebook?.id, pageId: selectedPage.id });
    return true;
  }

  async function uploadInlineFile(file: File, blockType: BlockType) {
    if (!selectedPage || !selectedPageCanEdit) return null;
    const pageId = selectedPage.id;
    const form = new FormData();
    form.set("file", file);
    form.set("blockType", blockType);
    setSaveStatus("Uploading");
    const response = await fetch(`/api/pages/${pageId}/attachments`, { method: "POST", body: form });
    setSaveStatus(response.ok ? "Uploaded" : "Upload failed", response.ok ? { clearAfterMs: SUCCESS_STATUS_CLEAR_AFTER_MS } : {});
    if (!response.ok) return null;
    const body = (await response.json()) as { attachment: Attachment };
    return body.attachment;
  }

  function markInlineAttachmentInserted(attachment: Attachment, body: string) {
    if (!selectedPage || !selectedPageCanEdit) return;
    const pageId = selectedPage.id;
    setWorkspace((current) => current ? {
      ...current,
      projects: current.projects.map((project) => ({
        ...project,
        notebooks: project.notebooks.map((notebook) => ({
          ...notebook,
          pages: notebook.pages.map((page) => {
            if (page.id !== pageId) return page;
            const exists = page.attachments.some((candidate) => candidate.id === attachment.id);
            const currentAttachmentCount = page.attachmentCount ?? page.attachments.length;
            const currentAttachmentBytes = page.attachmentBytes ?? page.attachments.reduce((total, candidate) => total + candidate.size, 0);
            return {
              ...page,
              body,
              bodyLoaded: true,
              bodyPreview: bodyToEditorText(body),
              attachments: exists ? page.attachments : [...page.attachments, attachment],
              attachmentCount: exists ? currentAttachmentCount : currentAttachmentCount + 1,
              attachmentBytes: exists ? currentAttachmentBytes : currentAttachmentBytes + attachment.size,
              updatedAt: "Just now",
            };
          }),
        })),
      })),
    } : current);
  }

  function openSpreadsheetModal(attachment: InlineAttachmentAttrs, onSaved?: (attachment: InlineAttachmentAttrs) => void) {
    spreadsheetSavedRef.current = onSaved ?? null;
    setSpreadsheetModal(attachment);
  }

  if (loading) return <AppLoadingView />;
  if (!workspace) {
    return (
      <AuthView
        mode={authMode}
        submitting={authSubmitting}
        error={authError}
        email={email}
        password={password}
        showPassword={showPassword}
        rememberDevice={rememberDevice}
        firstName={firstName}
        lastName={lastName}
        onSubmit={handleAuth}
        onModeChange={(mode) => {
          setAuthError("");
          setAuthMode(mode);
        }}
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
        onShowPasswordChange={setShowPassword}
        onRememberDeviceChange={setRememberDevice}
        onFirstNameChange={setFirstName}
        onLastNameChange={setLastName}
      />
    );
  }

  const effectivePagesWidth = pagesCollapsed ? SIDEBAR_COLLAPSED_WIDTH : pagesWidth;
  const effectiveSidebarCollapsed = sidebarCollapsed;
  const effectiveSidebarWidth = effectiveSidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth;
  const pagesColumnWidth = pagesCollapsed ? `${SIDEBAR_COLLAPSED_WIDTH}px` : `minmax(${PAGES_MIN_WIDTH}px, ${effectivePagesWidth}px)`;

  return (
    <main className="app-scroll-root overflow-x-auto bg-white text-slate-950">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          void uploadAttachments(event.target.files ?? undefined);
          event.currentTarget.value = "";
        }}
      />
      {(updateAvailable || previewKeys.has("update-banner")) && !updateBannerDismissed ? (
        <UpdateAvailableBanner preview={previewKeys.has("update-banner")} onDismiss={() => setUpdateBannerDismissed(true)} />
      ) : null}

      <div className="grid h-dvh min-w-[980px]" style={{ gridTemplateColumns: activeView === "project" ? `${effectiveSidebarWidth}px 1px ${pagesColumnWidth} 1px minmax(560px, 1fr)` : `${effectiveSidebarWidth}px 1px minmax(560px, 1fr)` } as React.CSSProperties}>
        <UnifiedSidebar
          workspace={workspace}
          activeView={activeView}
          selectedProject={selectedProject}
          selectedNotebook={selectedNotebook}
          sidebarCollapsed={effectiveSidebarCollapsed}
          accountOpen={accountOpen}
          projectMenuId={projectMenuId}
          notebookMenuId={notebookMenuId}
          expandedProjectIds={expandedProjectIds}
          openSearch={() => setSearchOpen(true)}
          toggleSidebarCollapsed={() => setSidebarCollapsed((current) => !current)}
          setAccountOpen={setAccountOpen}
          setProjectMenuId={setProjectMenuId}
          setNotebookMenuId={setNotebookMenuId}
          openHome={openHome}
          openAccount={openAccount}
          selectProject={selectProject}
          toggleProject={toggleProject}
          selectNotebook={selectNotebook}
          createNewProject={createNewProject}
          renameProject={renameExistingProject}
          updateProjectColor={updateExistingProjectColor}
          deleteProject={requestProjectDelete}
          renameNotebook={renameExistingNotebook}
          deleteNotebook={requestNotebookDelete}
          updateNotebookColor={updateExistingNotebookColor}
          openNotebookSettings={openNotebookSettings}
          createNewNotebook={createNewNotebook}
          handleLogout={handleLogout}
        />

        <ResizeHandle disabled={effectiveSidebarCollapsed} onPointerDown={(event) => setDragState({ pane: "sidebar", startX: event.clientX, startWidth: sidebarWidth })} />

        {activeView === "home" || activeView === "projectHome" ? (
          <HomeView recentPages={recentPages} members={workspace.members} selectPage={selectPage} />
        ) : activeView === "account" ? (
          <AccountView user={workspace.user} notebooks={workspace.notebooks} onChanged={() => refreshWorkspace()} />
        ) : activeView === "notebookSettings" ? (
          selectedNotebook ? (
            <NotebookSettingsView
              notebook={selectedNotebook}
              user={workspace.user}
              members={workspace.members}
              renameNotebook={renameExistingNotebook}
              deleteNotebook={requestNotebookDelete}
              onChanged={() => refreshWorkspace({ projectId: selectedProject?.id, notebookId: selectedNotebook.id, view: "notebookSettings" })}
            />
          ) : (
            <section className="grid place-items-center bg-white p-8 text-slate-500">Select a notebook to view settings.</section>
          )
        ) : (
          <>
            <PagesSidebar
              selectedProject={selectedProject}
              selectedNotebook={selectedNotebook}
              selectedPage={selectedPage}
              pageMenuId={pageMenuId}
              setPageMenuId={setPageMenuId}
              selectPage={selectPage}
              createNewPage={createNewPage}
              creatingPage={creatingPage}
              canEdit={selectedNotebookCanEdit}
              deletePage={requestPageDelete}
              movePage={requestPageMove}
              duplicatePage={duplicateExistingPage}
              duplicatingPageId={duplicatingPageId}
              searchTagSuggestions={searchTagSuggestions}
              collapsed={pagesCollapsed}
              toggleCollapsed={() => setPagesCollapsed((current) => !current)}
            />

            <ResizeHandle disabled={pagesCollapsed} onPointerDown={(event) => setDragState({ pane: "pages", startX: event.clientX, startWidth: pagesWidth })} />

            {selectedPage ? (
              <EditorPane
                key={selectedPage.id}
                page={selectedPage}
                selectedProject={selectedProject}
                selectedNotebook={selectedNotebook}
                saving={saving}
                pageLoading={!selectedPage.bodyLoaded || loadingPageId === selectedPage.id}
                canEdit={selectedPageCanEdit}
                canManageLock={selectedPageCanManageLock}
                uploadInlineFile={uploadInlineFile}
                onInlineAttachmentInserted={markInlineAttachmentInserted}
                openSpreadsheet={openSpreadsheetModal}
                openPresentation={setPresentationModal}
                deleteAttachment={deletePageAttachment}
                patchSelectedPage={patchSelectedPage}
                savePage={savePage}
                markUnsaved={(body) => markBodyUnsaved(selectedPage.id, body)}
                setPageTags={setSelectedPageTags}
                tagSuggestions={editorTagSuggestions}
                setPageLocked={setSelectedPageLocked}
                uploadAttachments={uploadAttachments}
                pendingAttachmentUploads={pendingAttachmentUploads}
                openFilePicker={() => fileInputRef.current?.click()}
              />
            ) : (
              <section className="grid place-items-center border-l border-slate-200 bg-white p-8 text-slate-500">Create a page to start writing.</section>
            )}
          </>
        )}
      </div>
        {projectPendingDelete ? (
          <ProjectDeleteModal
            project={projectPendingDelete}
            deleting={deletingProject}
            onCancel={() => setProjectPendingDelete(null)}
            onConfirm={confirmProjectDelete}
          />
        ) : null}

        {notebookPendingDelete ? (
          <NotebookDeleteModal
            notebook={notebookPendingDelete}
            deleting={deletingNotebook}
            onCancel={() => setNotebookPendingDelete(null)}
            onConfirm={confirmNotebookDelete}
          />
        ) : null}

        {pagePendingDelete ? (
          <PageDeleteModal
            page={pagePendingDelete}
            deleting={deletingPage}
            onCancel={() => setPagePendingDelete(null)}
            onConfirm={confirmPageDelete}
          />
        ) : null}

        {pagePendingMove && workspace ? (
          <PageMoveModal
            page={pagePendingMove}
            currentNotebookId={selectedNotebook?.id ?? ""}
            notebooks={workspace.notebooks}
            moving={movingPage}
            onCancel={() => setPagePendingMove(null)}
            onConfirm={confirmPageMove}
          />
        ) : null}

        {nameDialog ? (
          <NameModal
            dialog={nameDialog}
            onCancel={() => setNameDialog(null)}
            onSubmit={submitNameDialog}
          />
        ) : null}

        {spreadsheetModal ? (
          <SpreadsheetModal
            attachment={spreadsheetModal}
            onClose={() => {
              spreadsheetSavedRef.current = null;
              setSpreadsheetModal(null);
            }}
            onSaved={(attachment) => {
              spreadsheetSavedRef.current?.({ ...spreadsheetModal, ...attachment, kind: "sheet", createdAt: attachment.createdAt ?? spreadsheetModal.createdAt });
              if (selectedPage) void refreshWorkspace({ projectId: selectedProject?.id, notebookId: selectedNotebook?.id, pageId: selectedPage.id });
            }}
          />
        ) : null}

        {presentationModal ? (
          <PresentationModal
            attachment={presentationModal}
            onClose={() => setPresentationModal(null)}
          />
        ) : null}

        {searchOpen ? (
          <SearchOverlay
            query={query}
            setQuery={setQuery}
            advancedFilters={searchFilters}
            setAdvancedFilters={setSearchFilters}
            availableTags={searchTagSuggestions}
            loading={searchLoading}
            approxLoading={searchApproxLoading}
            results={hydratedSearchResults}
            onClose={closeSearch}
            selectResult={selectSearchResult}
          />
        ) : null}
    </main>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function findPageSelection(workspace: Workspace, pageId: string | null): PageSelection | null {
  if (!pageId) return null;
  for (const project of workspace.projects) {
    for (const notebook of project.notebooks) {
      const page = notebook.pages.find((candidate) => candidate.id === pageId);
      if (page) return { project, notebook, page };
    }
  }
  return null;
}

function findNotebookSelection(workspace: Workspace, notebookId: string | null): NotebookSelection | null {
  if (!notebookId) return null;
  for (const project of workspace.projects) {
    const notebook = project.notebooks.find((candidate) => candidate.id === notebookId);
    if (notebook) return { project, notebook };
  }
  return null;
}

function findProjectSelection(workspace: Workspace, projectId: string | null): ProjectSelection | null {
  if (!projectId) return null;
  const project = workspace.projects.find((candidate) => candidate.id === projectId);
  return project ? { project } : null;
}

function readAccountViewFromUrl() {
  if (typeof window === "undefined") return false;
  return new URL(window.location.href).pathname === "/settings";
}

function readNotebookSettingsIdFromUrl() {
  if (typeof window === "undefined") return null;
  return new URL(window.location.href).searchParams.get("notebookSettings");
}

function readPageIdFromUrl() {
  if (typeof window === "undefined") return null;
  return new URL(window.location.href).searchParams.get("page");
}

function readNotebookIdFromUrl() {
  if (typeof window === "undefined") return null;
  return new URL(window.location.href).searchParams.get("notebook");
}

function readProjectIdFromUrl() {
  if (typeof window === "undefined") return null;
  return new URL(window.location.href).searchParams.get("project");
}

function readPreviewKeysFromUrl() {
  if (typeof window === "undefined") return new Set<string>();
  const url = new URL(window.location.href);
  const values = url.searchParams.getAll("preview").flatMap((value) => value.split(","));
  return new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean));
}

function cleanupUpdateCacheBusterFromUrl() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("_novoUpdate")) return;
  url.searchParams.delete("_novoUpdate");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function writePageUrl(pageId: string | null, mode: "push" | "replace") {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.pathname = "/";
  if (pageId) {
    url.searchParams.set("page", pageId);
    url.searchParams.delete("notebookSettings");
    url.searchParams.delete("notebook");
    url.searchParams.delete("project");
  } else {
    url.searchParams.delete("page");
    url.searchParams.delete("notebookSettings");
    url.searchParams.delete("notebook");
    url.searchParams.delete("project");
  }
  writeUrl(url, mode);
}

function writeNotebookSettingsUrl(notebookId: string | null, mode: "push" | "replace") {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.pathname = "/";
  if (notebookId) {
    url.searchParams.set("notebookSettings", notebookId);
    url.searchParams.delete("page");
    url.searchParams.delete("notebook");
    url.searchParams.delete("project");
  } else {
    url.searchParams.delete("notebookSettings");
    url.searchParams.delete("page");
    url.searchParams.delete("notebook");
    url.searchParams.delete("project");
  }
  writeUrl(url, mode);
}

function writeNotebookUrl(notebookId: string | null, mode: "push" | "replace") {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.pathname = "/";
  if (notebookId) {
    url.searchParams.set("notebook", notebookId);
    url.searchParams.delete("notebookSettings");
    url.searchParams.delete("page");
    url.searchParams.delete("project");
  } else {
    url.searchParams.delete("notebook");
    url.searchParams.delete("notebookSettings");
    url.searchParams.delete("page");
    url.searchParams.delete("project");
  }
  writeUrl(url, mode);
}

function writeProjectUrl(projectId: string | null, mode: "push" | "replace") {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.pathname = "/";
  if (projectId) {
    url.searchParams.set("project", projectId);
    url.searchParams.delete("notebookSettings");
    url.searchParams.delete("page");
    url.searchParams.delete("notebook");
  } else {
    url.searchParams.delete("project");
    url.searchParams.delete("notebookSettings");
    url.searchParams.delete("page");
    url.searchParams.delete("notebook");
  }
  writeUrl(url, mode);
}

function writeAccountUrl(mode: "push" | "replace") {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.pathname = "/settings";
  url.searchParams.delete("project");
  url.searchParams.delete("notebook");
  url.searchParams.delete("notebookSettings");
  url.searchParams.delete("page");
  writeUrl(url, mode);
}

function writeUrl(url: URL, mode: "push" | "replace") {
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next === current) return;
  window.history[mode === "replace" ? "replaceState" : "pushState"](null, "", next);
}
