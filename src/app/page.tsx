"use client";

import {
  CalendarPlus,
  Crown,
  Eye,
  EyeOff,
  Loader2,
  Notebook as NotebookIcon,
  Pencil,
  RefreshCw,
  Shield,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModalFrame } from "@/components/ModalFrame";
import { PresentationModal } from "@/components/PresentationModal";
import { NovoDeploymentLabel, NovoWordmark } from "@/components/NovoInstanceProvider";
import type { InlineAttachmentAttrs } from "@/components/RichTextEditor";
import { SpreadsheetModal } from "@/components/SpreadsheetModal";
import { AccountView } from "@/features/account/AccountView";
import { EditorPane, type PendingAttachmentUpload } from "@/features/editor/EditorPane";
import { PageCard } from "@/features/pages/PageCard";
import { PagesSidebar } from "@/features/pages/PagesSidebar";
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
import { formatDateTime } from "@/lib/dateTime";
import { bodyToEditorText } from "@/lib/editor";
import { formatBytes } from "@/lib/formatBytes";
import { passwordRequirementText } from "@/lib/passwordRequirements";
import { normalizeTagList, tagListsEqual } from "@/lib/tags";
import type { AccessRole, AppUser, Attachment, BlockType, Notebook, PageEntry, PageStatus, Project, SearchResult, ShareMember, Workspace } from "@/lib/types";
import { canEditNotebook, normalizeColor, userDisplayName, userInitials } from "@/lib/workspaceDisplay";

const accessRoleIcons = {
  owner: Crown,
  editor: Pencil,
  viewer: Eye,
} satisfies Record<AccessRole, typeof Eye>;

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

type NameDialogState =
  | { kind: "createProject" }
  | { kind: "createNotebook"; projectId: string; projectName: string; initialMode?: "blank" | "import" }
  | { kind: "renameProject"; project: Project }
  | { kind: "renameNotebook"; notebook: Notebook };

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

type EnexInspection = {
  path: string;
  fileName: string;
  suggestedNotebookName: string;
  sizeBytes: number;
  noteCount: number;
  resourceCount: number;
  inlineMediaCount: number;
  notesWithResources: number;
  tags: Array<{ tag: string; count: number }>;
  mimeTypes: Array<{ mimeType: string; count: number }>;
  elapsedMs: number;
};

type EnexImportRun = {
  state: "running" | "canceling" | "canceled" | "succeeded" | "failed";
  error?: string;
  notebookId?: string;
  importedResources: number;
  startedAt: string;
  finishedAt?: string;
  progress: {
    processedBytes: number;
    totalBytes: number;
    importedNotes: number;
    totalNotes: number | null;
    importedResources: number;
    totalResources: number | null;
  };
};

type EnexImportStreamEvent =
  | { type: "started"; startedAt: string; progress: EnexImportRun["progress"] }
  | { type: "progress"; progress: EnexImportRun["progress"] }
  | { type: "complete"; finishedAt: string; result: { notebookId: string; importedNotes: number; importedResources: number; progress: EnexImportRun["progress"] } }
  | { type: "error"; finishedAt: string; error?: string }
  | { type: "canceled"; finishedAt: string; error?: string };

export default function Home() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [authError, setAuthError] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<"signin" | "register">("signin");
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
    function onPointerMove(event: PointerEvent) {
      const nextWidth = activeDrag.startWidth + event.clientX - activeDrag.startX;
      if (activeDrag.pane === "sidebar") setSidebarWidth(clamp(nextWidth, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH));
      if (activeDrag.pane === "pages") setPagesWidth(clamp(nextWidth, PAGES_MIN_WIDTH, PAGES_MAX_WIDTH));
    }
    function onPointerUp() {
      setDragState(null);
    }
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
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
    const remainingPages = selectedNotebook.pages.filter((page) => page.id !== pagePendingDelete.id);
    const deletedIndex = selectedNotebook.pages.findIndex((page) => page.id === pagePendingDelete.id);
    const nextPage = remainingPages[Math.min(Math.max(deletedIndex, 0), remainingPages.length - 1)];
    const nextPageId = selectedPage?.id === pagePendingDelete.id ? nextPage?.id ?? "" : selectedPage?.id;
    setDeletingPage(true);
    try {
      const response = await fetch(`/api/pages/${pagePendingDelete.id}`, { method: "DELETE" });
      if (!response.ok) return;
      setPagePendingDelete(null);
      if (nextPageId) writePageUrl(nextPageId, "replace");
      else writeNotebookUrl(selectedNotebook.id, "replace");
      await refreshWorkspace({ projectId: selectedProject?.id, notebookId: selectedNotebook.id, pageId: nextPageId });
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

  function createNewNotebook(projectId = selectedProject?.id ?? workspace?.projects[0]?.id, initialMode: "blank" | "import" = "blank") {
    if (!projectId) return;
    setProjectMenuId(null);
    setNotebookMenuId(null);
    setPageMenuId(null);
    setAccountOpen(false);
    const projectName = "Novo";
    setNameDialog({ kind: "createNotebook", projectId, projectName, initialMode });
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
      const body = (await response.json()) as { pageId: string };
      setActiveView("project");
      writePageUrl(body.pageId, "push");
      await refreshWorkspace({ projectId: selectedProject?.id, notebookId: selectedNotebook.id, pageId: body.pageId });
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

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 text-slate-600">
        <div className="flex flex-col items-center gap-4">
          <div className="flex flex-col items-center">
            <div className="novo-wordmark select-none text-7xl leading-none tracking-normal text-slate-950"><NovoWordmark /></div>
            <NovoDeploymentLabel className="mt-2 text-xs font-medium leading-none text-slate-500" />
          </div>
          <span className="inline-flex items-center gap-2 text-sm"><Loader2 size={16} className="animate-spin" />Loading...</span>
        </div>
      </main>
    );
  }
  if (!workspace) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 px-6 text-slate-950">
        <form onSubmit={handleAuth} className="w-full max-w-sm border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-6">
            <div className="mb-4">
              <p className="novo-wordmark select-none text-3xl leading-none tracking-normal text-slate-950"><NovoWordmark /></p>
              <NovoDeploymentLabel className="mt-1 text-xs font-medium leading-none text-slate-500" />
              {authMode === "register" ? <h1 className="mt-2 text-base font-semibold text-slate-700">Create an account</h1> : null}
            </div>
            <div className="grid grid-cols-2 border border-slate-200 p-1 text-sm font-medium">
              <button
                type="button"
                onClick={() => {
                  setAuthError("");
                  setAuthMode("signin");
                }}
                disabled={authSubmitting}
                className={`h-8 disabled:cursor-not-allowed disabled:opacity-60 ${authMode === "signin" ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"}`}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthError("");
                  setAuthMode("register");
                }}
                disabled={authSubmitting}
                className={`h-8 disabled:cursor-not-allowed disabled:opacity-60 ${authMode === "register" ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"}`}
              >
                Register
              </button>
            </div>
          </div>
          {authMode === "register" ? (
            <div className="mb-3 grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium text-slate-700">First name<input value={firstName} onChange={(event) => setFirstName(event.target.value)} disabled={authSubmitting} className="mt-1 h-10 w-full border border-slate-300 px-3 outline-none focus:border-cyan-600 disabled:cursor-not-allowed disabled:bg-slate-50" autoComplete="given-name" /></label>
              <label className="block text-sm font-medium text-slate-700">Last name<input value={lastName} onChange={(event) => setLastName(event.target.value)} disabled={authSubmitting} className="mt-1 h-10 w-full border border-slate-300 px-3 outline-none focus:border-cyan-600 disabled:cursor-not-allowed disabled:bg-slate-50" autoComplete="family-name" /></label>
            </div>
          ) : null}
          <label className="mb-3 block text-sm font-medium text-slate-700">Email<input value={email} onChange={(event) => setEmail(event.target.value)} disabled={authSubmitting} className="mt-1 h-10 w-full border border-slate-300 px-3 outline-none focus:border-cyan-600 disabled:cursor-not-allowed disabled:bg-slate-50" /></label>
          <label className="mb-2 block text-sm font-medium text-slate-700">
            Password
            <div className="relative mt-1">
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type={showPassword ? "text" : "password"}
                disabled={authSubmitting}
                className="h-10 w-full border border-slate-300 px-3 pr-10 outline-none focus:border-cyan-600 disabled:cursor-not-allowed disabled:bg-slate-50"
                autoComplete={authMode === "register" ? "new-password" : "current-password"}
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                aria-label={showPassword ? "Hide password" : "Show password"}
                title={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>
          {authMode === "register" ? <p className="mb-4 text-xs leading-5 text-slate-500">{passwordRequirementText}</p> : null}
          {authMode === "signin" ? (
            <label className="mb-4 flex items-center gap-2 text-sm text-slate-600">
              <input checked={rememberDevice} onChange={(event) => setRememberDevice(event.target.checked)} disabled={authSubmitting} type="checkbox" className="size-4 border border-slate-300 accent-slate-950 disabled:cursor-not-allowed" />
              Remember this device for 14 days
            </label>
          ) : null}
          {authError ? <p className="mb-3 border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{authError}</p> : null}
          <button disabled={authSubmitting} className="inline-flex h-10 w-full items-center justify-center gap-2 bg-slate-950 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-500">
            {authSubmitting ? <Loader2 size={16} className="animate-spin" /> : null}
            {authSubmitting ? (authMode === "register" ? "Creating account..." : "Signing in...") : (authMode === "register" ? "Create account" : "Sign in")}
          </button>
        </form>
      </main>
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
            onImportComplete={async (projectId, notebookId) => {
              setNameDialog(null);
              setActiveView("project");
              writeNotebookUrl(notebookId, "push");
              await refreshWorkspace({ projectId, notebookId });
            }}
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

function UpdateAvailableBanner({ preview, onDismiss }: { preview: boolean; onDismiss: () => void }) {
  return (
    <div className="fixed right-5 top-5 z-[70] w-[min(380px,calc(100vw-2.5rem))] border border-slate-200 bg-white p-4 shadow-xl shadow-slate-950/15">
      <div className="flex items-start gap-3">
        <RefreshCw size={18} className="mt-0.5 shrink-0 text-slate-600" />
        <div className="min-w-0 flex-1 pr-6">
          <p className="text-sm font-semibold text-slate-950">A new version of Novo is available.</p>
          {preview ? <p className="mt-1 text-xs text-slate-400">Preview mode</p> : null}
        </div>
        <button type="button" onClick={onDismiss} className="grid size-7 shrink-0 place-items-center border border-transparent text-slate-400 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-700" aria-label="Dismiss update notice">
          <X size={15} />
        </button>
      </div>
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={() => void performAppUpdate()} className="inline-flex h-9 items-center gap-2 bg-slate-950 px-3 text-sm font-medium text-white hover:bg-slate-800">
          <RefreshCw size={15} />
          Update now
        </button>
      </div>
    </div>
  );
}

function NameModal({ dialog, onCancel, onSubmit, onImportComplete }: { dialog: NameDialogState; onCancel: () => void; onSubmit: (name: string) => Promise<void>; onImportComplete?: (projectId: string, notebookId: string) => Promise<void> }) {
  const initialValue = dialog.kind === "renameProject" ? dialog.project.name : dialog.kind === "renameNotebook" ? dialog.notebook.name : "";
  const [name, setName] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);
  const [mode] = useState<"blank" | "import">(dialog.kind === "createNotebook" ? dialog.initialMode ?? "blank" : "blank");
  const [serverPath, setServerPath] = useState("");
  const [inspection, setInspection] = useState<EnexInspection | null>(null);
  const [inspectionError, setInspectionError] = useState("");
  const [inspecting, setInspecting] = useState(false);
  const [job, setJob] = useState<EnexImportRun | null>(null);
  const [importNow, setImportNow] = useState(Date.now());
  const [importError, setImportError] = useState("");
  const [openingImportedNotebook, setOpeningImportedNotebook] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const importAbortRef = useRef<AbortController | null>(null);
  const title = getNameModalTitle(dialog);
  const description = getNameModalDescription(dialog);
  const submitLabel = dialog.kind.startsWith("rename") ? "Rename" : "Create";
  const pendingSubmitLabel = dialog.kind.startsWith("rename") ? "Renaming..." : "Creating...";
  const isNotebookCreate = dialog.kind === "createNotebook";
  const importing = job?.state === "running" || job?.state === "canceling";
  const cancelingImport = job?.state === "canceling";
  const disabled = !name.trim() || submitting || importing;
  const importDisabled = !isNotebookCreate || !serverPath.trim() || !name.trim() || inspecting || importing;
  const progressTotal = job?.progress.totalNotes ?? inspection?.noteCount ?? null;
  const resourceProgressTotal = job?.progress.totalResources ?? inspection?.resourceCount ?? null;
  const byteProgressPercent = job?.progress.totalBytes ? Math.min(100, Math.round((job.progress.processedBytes / job.progress.totalBytes) * 100)) : 0;
  const progressPercent = byteProgressPercent || (progressTotal && job ? Math.min(100, Math.round((job.progress.importedNotes / progressTotal) * 100)) : 0);
  const elapsedSeconds = job ? secondsBetween(job.startedAt, job.finishedAt, importNow) : 0;
  const predictedRemainingSeconds = job ? estimateRemainingSeconds(elapsedSeconds, progressPercent) : 0;
  const importFinished = job?.state === "succeeded";
  const importCanceled = job?.state === "canceled";
  const importTerminal = importFinished || importCanceled || job?.state === "failed";

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    if (!importing) return;
    const timer = window.setInterval(() => setImportNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [importing]);

  useEffect(() => () => importAbortRef.current?.abort(), []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    setSubmitting(true);
    try {
      await onSubmit(name);
    } finally {
      setSubmitting(false);
    }
  }

  async function inspectEnex() {
    if (!serverPath.trim()) return;
    setInspecting(true);
    setInspection(null);
    setInspectionError("");
    setImportError("");
    const response = await fetch("/api/import/enex/inspect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: serverPath.trim() }),
    });
    const body = await response.json().catch(() => null) as EnexInspection | { error?: string } | null;
    setInspecting(false);
    if (!response.ok || !body || "error" in body) {
      setInspectionError((body as { error?: string } | null)?.error || "Unable to inspect ENEX file.");
      return;
    }
    const inspected = body as EnexInspection;
    setInspection(inspected);
    setServerPath(inspected.path);
    if (!name.trim()) setName(inspected.suggestedNotebookName);
  }

  async function startImport() {
    if (dialog.kind !== "createNotebook" || importDisabled) return;
    setImportError("");
    const startedAt = new Date().toISOString();
    const controller = new AbortController();
    importAbortRef.current = controller;
    setImportNow(Date.now());
    setJob({
      state: "running",
      importedResources: 0,
      startedAt,
      progress: {
        processedBytes: 0,
        totalBytes: inspection?.sizeBytes ?? 0,
        importedNotes: 0,
        totalNotes: inspection?.noteCount ?? null,
        importedResources: 0,
        totalResources: inspection?.resourceCount ?? null,
      },
    });

    try {
      const response = await fetch("/api/import/enex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          notebookName: name.trim(),
          path: serverPath.trim(),
          totalNotes: inspection?.noteCount,
          totalResources: inspection?.resourceCount,
        }),
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || "Unable to import ENEX file.");
      }

      await readEnexImportStream(response, {
        onEvent: (event) => {
          if (event.type === "started") {
            setJob((current) => current ? { ...current, startedAt: event.startedAt, progress: { ...current.progress, ...event.progress } } : current);
            return;
          }
          if (event.type === "progress") {
            setJob((current) => current ? { ...current, progress: event.progress, importedResources: event.progress.importedResources } : current);
            return;
          }
          if (event.type === "complete") {
            setJob((current) => current ? {
              ...current,
              state: "succeeded",
              notebookId: event.result.notebookId,
              importedResources: event.result.importedResources,
              finishedAt: event.finishedAt,
              progress: event.result.progress,
            } : current);
            return;
          }
          setJob((current) => current ? {
            ...current,
            state: event.type === "canceled" ? "canceled" : "failed",
            error: event.error,
            finishedAt: event.finishedAt,
          } : current);
        },
      });
    } catch (error) {
      if (controller.signal.aborted) {
        setJob((current) => current ? { ...current, state: "canceled", error: "Import canceled. Partial import was rolled back.", finishedAt: new Date().toISOString() } : current);
      } else {
        setJob((current) => current ? { ...current, state: "failed", error: error instanceof Error ? error.message : "Unable to import ENEX file.", finishedAt: new Date().toISOString() } : current);
      }
    } finally {
      if (importAbortRef.current === controller) importAbortRef.current = null;
    }
  }

  async function openImportedNotebook() {
    if (dialog.kind !== "createNotebook" || !job?.notebookId) return;
    setOpeningImportedNotebook(true);
    await onImportComplete?.(dialog.projectId, job.notebookId);
    setOpeningImportedNotebook(false);
  }

  async function handleCancel() {
    if (job && job.state === "running") {
      setImportError("");
      setJob({ ...job, state: "canceling", error: "Cancel requested. Rolling back partial import." });
      importAbortRef.current?.abort();
      return;
    }
    onCancel();
  }

  return (
    <ModalFrame>
      <form onSubmit={(event) => void handleSubmit(event)}>
        <h2 className="text-lg font-semibold text-white">{importFinished ? "Import complete" : importCanceled ? "Import canceled" : title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-400">{importFinished ? "Review the imported notebook before opening it." : importCanceled ? "The partial notebook and imported files were rolled back." : description}</p>
        {importFinished ? (
          <ImportFinishedSummary
            notebookName={name}
            serverPath={serverPath}
            inspection={inspection}
            job={job}
            elapsedSeconds={elapsedSeconds}
          />
        ) : null}
        {!importFinished ? <label className="mt-5 block text-sm font-medium text-slate-200">
          {mode === "import" && isNotebookCreate ? "Notebook name" : "Name"}
          <input
            ref={inputRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-2 h-10 w-full border border-white/10 bg-white/10 px-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400"
            placeholder="Name"
          />
        </label> : null}
        {!importFinished && mode === "import" && isNotebookCreate ? (
          <div className="mt-4 space-y-4">
            <label className="block text-sm font-medium text-slate-200">
              ENEX server path
              <input
                value={serverPath}
                onChange={(event) => {
                  setServerPath(event.target.value);
                  setInspection(null);
                  setInspectionError("");
                }}
                className="mt-2 h-10 w-full border border-white/10 bg-white/10 px-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400"
                placeholder="/mnt/speedy/aboylan/local_llm_2026_03_31/ctDNA_test_2026_05_05/ctDNA.enex"
              />
            </label>
            <button type="button" onClick={() => void inspectEnex()} disabled={!serverPath.trim() || inspecting || importing} className="h-9 border border-white/10 px-3 text-sm text-slate-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500">
              {inspecting ? "Inspecting" : "Inspect file"}
            </button>
            {inspectionError ? <p className="text-sm text-rose-300">{inspectionError}</p> : null}
            {inspection ? (
              <div className="border border-white/10 bg-white/5 p-3 text-sm text-slate-300">
                <div className="grid grid-cols-2 gap-3">
                  <ImportMetric label="Pages" value={inspection.noteCount.toLocaleString()} />
                  <ImportMetric label="ENEX resources" value={inspection.resourceCount.toLocaleString()} />
                  <ImportMetric label="Inline media refs" value={inspection.inlineMediaCount.toLocaleString()} />
                  <ImportMetric label="File size" value={formatBytes(inspection.sizeBytes)} />
                </div>
                {inspection.tags.length ? <p className="mt-3 text-xs text-slate-400">Top tags: {inspection.tags.slice(0, 6).map((tag) => `${tag.tag} (${tag.count})`).join(", ")}</p> : null}
              </div>
            ) : null}
            {job ? (
              <div className="space-y-2 border border-white/10 bg-white/5 p-3 text-sm text-slate-300">
                <div className="flex items-center justify-between gap-3">
                  <span className="capitalize">{job.state}</span>
                  <span>{job.progress.importedNotes.toLocaleString()}{progressTotal ? ` / ${progressTotal.toLocaleString()}` : ""} pages</span>
                </div>
                <div className="h-2 overflow-hidden bg-slate-800">
                  <div className="h-full bg-cyan-400 transition-all" style={{ width: `${progressPercent}%` }} />
                </div>
                <div className="grid gap-1 text-xs text-slate-400">
                  <ImportProgressRow label="Elapsed time" value={formatDuration(elapsedSeconds)} />
                  <ImportProgressRow label="Predicted remaining time" value={predictedRemainingSeconds ? formatDuration(predictedRemainingSeconds) : "Calculating"} />
                  <ImportProgressRow label="ENEX resources" value={`${job.progress.importedResources.toLocaleString()}${resourceProgressTotal ? ` / ${resourceProgressTotal.toLocaleString()}` : ""}`} />
                  <ImportProgressRow label="Data" value={`${formatBytes(job.progress.processedBytes)} / ${formatBytes(job.progress.totalBytes)}`} />
                </div>
                {job.state === "failed" ? <p className="text-sm text-rose-300">{job.error || "Import failed. Partial notebook and files were rolled back."}</p> : null}
                {job.state === "canceling" ? <p className="text-sm text-amber-200">Canceling import and rolling back partial data...</p> : null}
                {job.state === "canceled" ? <p className="text-sm text-slate-300">{job.error || "Import canceled. Partial notebook and files were rolled back."}</p> : null}
              </div>
            ) : null}
            {importError ? <p className="text-sm text-rose-300">{importError}</p> : null}
          </div>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => void handleCancel()} disabled={cancelingImport} className="h-9 border border-white/10 px-3 text-sm text-slate-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500">{importTerminal ? "Close" : cancelingImport ? "Canceling" : importing ? "Cancel import" : "Cancel"}</button>
          {importFinished ? (
            <button type="button" onClick={() => void openImportedNotebook()} disabled={openingImportedNotebook || !job?.notebookId} className="h-9 bg-cyan-500 px-3 text-sm font-medium text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400">
              {openingImportedNotebook ? "Opening" : "Open notebook"}
            </button>
          ) : mode === "import" && isNotebookCreate ? (
            <button type="button" onClick={() => void startImport()} disabled={importDisabled} className="h-9 bg-cyan-500 px-3 text-sm font-medium text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400">
              {importing ? "Importing" : "Import"}
            </button>
          ) : (
            <button type="submit" disabled={disabled} className="inline-flex h-9 items-center gap-2 bg-cyan-500 px-3 text-sm font-medium text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400">
              {submitting ? <Loader2 size={15} className="animate-spin" /> : null}
              {submitting ? pendingSubmitLabel : submitLabel}
            </button>
          )}
        </div>
      </form>
    </ModalFrame>
  );
}

async function readEnexImportStream(response: Response, input: { onEvent: (event: EnexImportStreamEvent) => void }) {
  if (!response.body) throw new Error("Import response did not include a progress stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      input.onEvent(JSON.parse(line) as EnexImportStreamEvent);
    }
  }

  const finalLine = `${buffer}${decoder.decode()}`.trim();
  if (finalLine) input.onEvent(JSON.parse(finalLine) as EnexImportStreamEvent);
}

function ImportMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 font-medium text-white">{value}</p>
    </div>
  );
}

function ImportProgressRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(170px,1fr)_minmax(0,1fr)] gap-3">
      <span>{label}</span>
      <span className="truncate text-right font-medium text-slate-200" title={value}>{value}</span>
    </div>
  );
}

function ImportFinishedSummary({ notebookName, serverPath, inspection, job, elapsedSeconds }: { notebookName: string; serverPath: string; inspection: EnexInspection | null; job: EnexImportRun; elapsedSeconds: number }) {
  const resourceTotal = job.progress.totalResources ?? inspection?.resourceCount ?? null;
  const noteTotal = job.progress.totalNotes ?? inspection?.noteCount ?? null;
  return (
    <div className="mt-5 space-y-4">
      <div className="border border-emerald-400/30 bg-emerald-400/10 p-3">
        <p className="text-sm font-semibold text-emerald-200">Notebook created</p>
        <p className="mt-1 text-sm text-slate-300">{notebookName || job.notebookId || "Imported notebook"}</p>
      </div>
      <div className="grid gap-1 border border-white/10 bg-white/5 p-3 text-xs text-slate-400">
        <ImportProgressRow label="Pages imported" value={`${job.progress.importedNotes.toLocaleString()}${noteTotal ? ` / ${noteTotal.toLocaleString()}` : ""}`} />
        <ImportProgressRow label="ENEX resources" value={`${job.progress.importedResources.toLocaleString()}${resourceTotal ? ` / ${resourceTotal.toLocaleString()}` : ""}`} />
        {inspection ? <ImportProgressRow label="Inline media refs" value={inspection.inlineMediaCount.toLocaleString()} /> : null}
        <ImportProgressRow label="Elapsed time" value={formatDuration(elapsedSeconds)} />
        <ImportProgressRow label="Data" value={formatBytes(job.progress.processedBytes || job.progress.totalBytes)} />
        <ImportProgressRow label="Source file" value={serverPath || "ENEX import"} />
      </div>
      {inspection?.tags.length ? (
        <p className="text-xs leading-5 text-slate-400">Top tags: {inspection.tags.slice(0, 6).map((tag) => `${tag.tag} (${tag.count})`).join(", ")}</p>
      ) : null}
    </div>
  );
}

function getNameModalTitle(dialog: NameDialogState) {
  if (dialog.kind === "createProject") return "New project";
  if (dialog.kind === "createNotebook") return dialog.initialMode === "import" ? "Import ENEX notebook" : "New notebook";
  if (dialog.kind === "renameProject") return "Rename project";
  return "Rename notebook";
}

function getNameModalDescription(dialog: NameDialogState) {
  if (dialog.kind === "createProject") return "Create a project to group related notebooks.";
  if (dialog.kind === "createNotebook") return dialog.initialMode === "import" ? "Create a new notebook from an Evernote ENEX export." : "Create a notebook.";
  if (dialog.kind === "renameProject") return "Update the project name shown in the sidebar.";
  return "Update the notebook name shown in the sidebar.";
}

function NotebookDeleteModal({ notebook, deleting, onCancel, onConfirm }: { notebook: Notebook; deleting: boolean; onCancel: () => void; onConfirm: () => void }) {
  const [confirmationName, setConfirmationName] = useState("");
  const canDelete = confirmationName.trim() === notebook.name && !deleting;

  return (
    <ModalFrame>
      <h2 className="text-lg font-semibold text-white">Delete notebook?</h2>
      <p className="mt-3 text-sm leading-6 text-slate-400">
        This will delete <span className="font-semibold text-white">{notebook.name}</span>, including its pages and attachment records. This cannot be undone.
      </p>
      <label className="mt-5 block text-sm font-medium text-slate-200" htmlFor="delete-notebook-confirmation">
        Type the notebook name to confirm
      </label>
      <input
        id="delete-notebook-confirmation"
        value={confirmationName}
        onChange={(event) => setConfirmationName(event.target.value)}
        disabled={deleting}
        className="mt-2 h-10 w-full border border-white/15 bg-slate-950 px-3 text-sm text-white outline-none focus:border-cyan-400 disabled:opacity-60"
        placeholder={notebook.name}
      />
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onCancel} disabled={deleting} className="h-9 border border-white/10 px-3 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-60">Cancel</button>
        <button onClick={onConfirm} disabled={!canDelete} className="inline-flex h-9 items-center gap-2 bg-rose-500 px-3 text-sm font-medium text-white hover:bg-rose-400 disabled:bg-rose-800 disabled:text-rose-200">
          {deleting ? <Loader2 size={15} className="animate-spin" /> : null}
          {deleting ? "Deleting..." : "Delete notebook"}
        </button>
      </div>
    </ModalFrame>
  );
}

function PageDeleteModal({ page, deleting, onCancel, onConfirm }: { page: PageEntry; deleting: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <ModalFrame>
      <h2 className="text-lg font-semibold text-white">Delete page?</h2>
      <p className="mt-3 text-sm leading-6 text-slate-400">
        This will delete <span className="font-semibold text-white">{page.title || "Untitled page"}</span>, including its attachment records. This cannot be undone.
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onCancel} disabled={deleting} className="h-9 border border-white/10 px-3 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-60">Cancel</button>
        <button onClick={onConfirm} disabled={deleting} className="inline-flex h-9 items-center gap-2 bg-rose-500 px-3 text-sm font-medium text-white hover:bg-rose-400 disabled:bg-rose-800 disabled:text-rose-200">
          {deleting ? <Loader2 size={15} className="animate-spin" /> : null}
          {deleting ? "Deleting..." : "Delete page"}
        </button>
      </div>
    </ModalFrame>
  );
}

function PageMoveModal({ page, currentNotebookId, notebooks, moving, onCancel, onConfirm }: { page: PageEntry; currentNotebookId: string; notebooks: Notebook[]; moving: boolean; onCancel: () => void; onConfirm: (notebookId: string) => void }) {
  const destinationNotebooks = useMemo(
    () => notebooks
      .filter((notebook) => notebook.id !== currentNotebookId && (notebook.accessRole === "owner" || notebook.accessRole === "editor"))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
    [currentNotebookId, notebooks],
  );
  const [targetNotebookId, setTargetNotebookId] = useState(destinationNotebooks[0]?.id ?? "");

  useEffect(() => {
    if (targetNotebookId && destinationNotebooks.some((notebook) => notebook.id === targetNotebookId)) return;
    setTargetNotebookId(destinationNotebooks[0]?.id ?? "");
  }, [destinationNotebooks, targetNotebookId]);

  const canMove = Boolean(targetNotebookId) && !moving;

  return (
    <ModalFrame>
      <h2 className="text-lg font-semibold text-white">Move page</h2>
      <p className="mt-3 text-sm leading-6 text-slate-400">
        Choose the notebook that should contain <span className="font-semibold text-white">{page.title || "Untitled page"}</span>.
      </p>
      {destinationNotebooks.length ? (
        <label className="mt-4 block text-sm font-medium text-slate-200">
          Destination notebook
          <select
            value={targetNotebookId}
            onChange={(event) => setTargetNotebookId(event.target.value)}
            disabled={moving}
            className="mt-2 h-10 w-full cursor-pointer border border-white/10 bg-slate-950 px-3 text-sm text-white outline-none focus:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {destinationNotebooks.map((notebook) => (
              <option key={notebook.id} value={notebook.id}>{notebook.name}</option>
            ))}
          </select>
        </label>
      ) : (
        <p className="mt-4 border border-white/10 bg-white/5 p-3 text-sm text-slate-300">No editable destination notebooks are available.</p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onCancel} disabled={moving} className="h-9 border border-white/10 px-3 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-60">Cancel</button>
        <button onClick={() => onConfirm(targetNotebookId)} disabled={!canMove} className="inline-flex h-9 items-center gap-2 bg-cyan-500 px-3 text-sm font-medium text-slate-950 hover:bg-cyan-400 disabled:bg-slate-700 disabled:text-slate-400">
          {moving ? <Loader2 size={15} className="animate-spin" /> : null}
          {moving ? "Moving..." : "Move page"}
        </button>
      </div>
    </ModalFrame>
  );
}

function ProjectDeleteModal({ project, deleting, onCancel, onConfirm }: { project: Project; deleting: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <ModalFrame>
      <h2 className="text-lg font-semibold text-white">Delete project?</h2>
      <p className="mt-3 text-sm leading-6 text-slate-400">
        This will delete <span className="font-semibold text-white">{project.name}</span>, including its notebooks, pages, and attachment records. This cannot be undone.
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onCancel} disabled={deleting} className="h-9 border border-white/10 px-3 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-60">Cancel</button>
        <button onClick={onConfirm} disabled={deleting} className="inline-flex h-9 items-center gap-2 bg-rose-500 px-3 text-sm font-medium text-white hover:bg-rose-400 disabled:bg-rose-800 disabled:text-rose-200">
          {deleting ? <Loader2 size={15} className="animate-spin" /> : null}
          {deleting ? "Deleting..." : "Delete project"}
        </button>
      </div>
    </ModalFrame>
  );
}

function HomeView({ recentPages, members, selectPage }: { recentPages: Array<{ page: PageEntry; project: Project; notebook: Notebook }>; members: AppUser[]; selectPage: (project: Project, notebook: Notebook, page: PageEntry) => void }) {
  return (
    <section className="min-h-screen overflow-y-auto scroll-contained bg-white p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold text-slate-950">Overview</h1>
          <div className="flex shrink-0 items-center gap-2 text-sm">
            <span className="font-medium text-slate-500">Group:</span>
            <span className="font-semibold text-slate-950">CCIB Therapeutics</span>
          </div>
        </div>

        <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className="min-w-0 border border-slate-200 bg-white p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-950">Recently edited pages</h2>
              </div>
            </div>
            <div className="grid min-w-0 gap-2">
              {recentPages.slice(0, 3).map(({ page, project, notebook }) => (
                <PageCard
                  key={page.id}
                  page={page}
                  accentColor={notebook.color}
                  contextLabel={notebook.name}
                  tinted
                  onClick={() => selectPage(project, notebook, page)}
                />
              ))}
              {recentPages.length === 0 ? <p className="p-3 text-sm text-slate-500">No recent pages yet.</p> : null}
            </div>
          </section>

          <aside className="min-w-0 space-y-6">
            <section className="border border-slate-200 bg-white p-4">
              <div className="mb-4 flex items-center gap-2">
                <Users size={17} className="text-slate-500" />
                <h2 className="text-base font-semibold text-slate-950">Group members</h2>
              </div>
              <div className="space-y-2">
                {members.map((member) => (
                  <div key={member.id} className="grid grid-cols-[32px_minmax(0,1fr)] items-center gap-3 border border-slate-100 px-3 py-2">
                    <div className="grid size-8 place-items-center rounded-full bg-slate-950 text-xs font-semibold text-white">{userInitials(member)}</div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-950">{userDisplayName(member)}</div>
                      <div className="mt-1 truncate text-xs text-slate-500">{member.email}</div>
                    </div>
                  </div>
                ))}
                {members.length === 0 ? <p className="text-sm text-slate-500">No group members yet.</p> : null}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </section>
  );
}

function NotebookSettingsView({ notebook, user, members, renameNotebook, deleteNotebook, onChanged }: { notebook: Notebook; user: AppUser; members: AppUser[]; renameNotebook: (notebook: Notebook) => void; deleteNotebook: (notebook: Notebook) => void; onChanged: () => Promise<void> }) {
  const canManage = notebook.accessRole === "owner";
  const canEdit = canManage || notebook.accessRole === "editor";
  const effectiveRoleLabel = user.role === "admin" ? "Admin" : capitalizeLabel(notebook.accessRole);
  const [memberPendingRemoval, setMemberPendingRemoval] = useState<ShareMember | null>(null);
  const [removingMember, setRemovingMember] = useState(false);
  const [pageTitleTemplate, setPageTitleTemplate] = useState(notebook.pageTitleTemplate ?? "");
  const [pageTitleTemplateEnabled, setPageTitleTemplateEnabled] = useState(Boolean(notebook.pageTitleTemplateEnabled));
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateError, setTemplateError] = useState("");
  const attachmentCount = notebook.pages.reduce((total, page) => total + (page.attachmentCount ?? page.attachments.length), 0);
  const attachmentBytes = notebook.pages.reduce((total, page) => total + (page.attachmentBytes ?? page.attachments.reduce((sum, attachment) => sum + attachment.size, 0)), 0);
  const memberCount = notebook.members.length;
  const templateDirty = pageTitleTemplate !== (notebook.pageTitleTemplate ?? "") || pageTitleTemplateEnabled !== Boolean(notebook.pageTitleTemplateEnabled);

  useEffect(() => {
    setPageTitleTemplate(notebook.pageTitleTemplate ?? "");
    setPageTitleTemplateEnabled(Boolean(notebook.pageTitleTemplateEnabled));
    setTemplateError("");
    setTemplateSaving(false);
  }, [notebook.id, notebook.pageTitleTemplate, notebook.pageTitleTemplateEnabled]);

  async function addNotebookMember(input: { email: string; role: AccessRole }) {
    await fetch(`/api/notebooks/${notebook.id}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }).then(assertOk);
    await onChanged();
  }

  async function updateNotebookMemberRole(member: ShareMember, role: AccessRole) {
    await addNotebookMember({ email: member.email, role });
  }

  async function removeMember(member: ShareMember) {
    await removeNotebookMember(notebook.id, member.userId);
    await onChanged();
  }

  async function confirmMemberRemoval() {
    if (!memberPendingRemoval || removingMember) return;
    setRemovingMember(true);
    try {
      await removeMember(memberPendingRemoval);
      setMemberPendingRemoval(null);
    } finally {
      setRemovingMember(false);
    }
  }

  async function persistPageTitleTemplate(template: string, enabled: boolean) {
    const trimmedTemplate = template.trim();
    const nextEnabled = enabled && trimmedTemplate.length > 0;
    setTemplateSaving(true);
    setTemplateError("");
    try {
      await fetch(`/api/notebooks/${notebook.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageTitleTemplate: trimmedTemplate, pageTitleTemplateEnabled: nextEnabled }),
      }).then(assertOk);
      await onChanged();
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : "Could not save title template.");
    } finally {
      setTemplateSaving(false);
    }
  }

  async function savePageTitleTemplate() {
    if (!templateDirty || templateSaving || !pageTitleTemplateEnabled) return;
    await persistPageTitleTemplate(pageTitleTemplate, pageTitleTemplateEnabled);
  }

  async function changePageTitleTemplateEnabled(nextEnabled: boolean) {
    setPageTitleTemplateEnabled(nextEnabled);
    if (!nextEnabled || pageTitleTemplate.trim().length > 0) {
      await persistPageTitleTemplate(pageTitleTemplate, nextEnabled);
    }
  }

  return (
    <section className="min-h-screen overflow-y-auto scroll-contained bg-white p-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-500">Notebook</p>
            <div className="mt-1 flex min-w-0 items-center gap-3">
              <span className="size-3 shrink-0" style={{ backgroundColor: notebook.color }} />
              <h1 className="min-w-0 truncate text-2xl font-semibold text-slate-950">{notebook.name}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canEdit ? <button type="button" onClick={() => renameNotebook(notebook)} className="h-9 border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:border-slate-500">Rename</button> : null}
            {canManage ? <button type="button" onClick={() => deleteNotebook(notebook)} className="h-9 border border-rose-200 bg-white px-3 text-sm font-medium text-rose-700 hover:bg-rose-50">Delete</button> : null}
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,680px)_320px] lg:items-start">
          <div className="space-y-6">
          <section className="border border-slate-200 bg-white p-4">
            <div className="mb-4 flex items-center gap-2">
              <NotebookIcon size={17} className="text-slate-500" />
              <h2 className="text-base font-semibold text-slate-950">Notebook overview</h2>
            </div>
            <div className="space-y-5">
              <NotebookOverviewGroup
                title="Identity"
                rows={[
                  { label: "Notebook ID", value: notebook.id },
                ]}
              />
              <NotebookOverviewGroup
                title="Contents"
                rows={[
                  { label: "Pages", value: notebook.pages.length.toLocaleString() },
                  { label: "Attachments", value: attachmentCount.toLocaleString() },
                  { label: "Storage", value: formatBytes(attachmentBytes) },
                ]}
              />
              <NotebookOverviewGroup
                title="Access"
                rows={[
                  { label: "Members", value: memberCount.toLocaleString() },
                  { label: "Your role", value: effectiveRoleLabel },
                ]}
              />
              <NotebookOverviewGroup
                title="Dates"
                rows={[
                  { label: "Created", value: formatDateTime(notebook.createdAt) },
                  { label: "Updated", value: formatDateTime(notebook.updatedAt) },
                ]}
              />
            </div>
          </section>

          <NotebookTitleTemplateSettings
            value={pageTitleTemplate}
            savedValue={notebook.pageTitleTemplate ?? ""}
            enabled={pageTitleTemplateEnabled}
            savedEnabled={Boolean(notebook.pageTitleTemplateEnabled)}
            notebookColor={notebook.color}
            canManage={canManage}
            dirty={templateDirty}
            error={templateError}
            saving={templateSaving}
            onChange={setPageTitleTemplate}
            onEnabledChange={changePageTitleTemplateEnabled}
            onSave={savePageTitleTemplate}
          />

          <section className="border border-slate-200 bg-white p-4">
            <div className="mb-4 flex items-center gap-2">
              <Users size={17} className="text-slate-500" />
              <h2 className="text-base font-semibold text-slate-950">Notebook access</h2>
            </div>
            <NotebookAccessList members={notebook.members} currentUserId={user.id} canManage={canManage} onRoleChange={updateNotebookMemberRole} onRemove={setMemberPendingRemoval} />
          </section>
          </div>

          <section className="border border-slate-200 bg-white p-4">
            <h2 className="text-base font-semibold text-slate-950">Share notebook</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">Add a group member and choose their notebook role.</p>
            <div className="mt-4">
              <ShareForm members={members} existingMembers={notebook.members} submitLabel="Share" disabled={!canManage} disabledReason={!canManage ? "Only notebook owners and admins can share this notebook." : undefined} onSubmit={addNotebookMember} />
            </div>
          </section>
        </div>
      </div>
      {memberPendingRemoval ? (
        <NotebookMemberRemovalModal
          member={memberPendingRemoval}
          isCurrentUser={memberPendingRemoval.userId === user.id}
          removing={removingMember}
          onCancel={() => setMemberPendingRemoval(null)}
          onConfirm={confirmMemberRemoval}
        />
      ) : null}
    </section>
  );
}

function NotebookTitleTemplateSettings({
  value,
  savedValue,
  enabled,
  savedEnabled,
  notebookColor,
  canManage,
  dirty,
  error,
  saving,
  onChange,
  onEnabledChange,
  onSave,
}: {
  value: string;
  savedValue: string;
  enabled: boolean;
  savedEnabled: boolean;
  notebookColor: string;
  canManage: boolean;
  dirty: boolean;
  error: string;
  saving: boolean;
  onChange: (value: string) => void;
  onEnabledChange: (value: boolean) => void;
  onSave: () => Promise<void>;
}) {
  if (!canManage) {
    return (
      <section className="border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <CalendarPlus size={17} className="text-slate-500" />
          <h2 className="text-base font-semibold text-slate-950">New page title template</h2>
        </div>
        <dl className="space-y-2 text-sm">
          <NotebookOverviewRow label="Status" value={savedEnabled ? "On" : "Off"} />
          <NotebookOverviewRow label="Template" value={savedValue || "Untitled"} />
        </dl>
      </section>
    );
  }

  const saveDisabled = !enabled || !dirty || saving;
  const saveButtonStyle = saveDisabled ? undefined : { borderColor: notebookColor, color: notebookColor };
  const checkboxStyle = { accentColor: notebookColor };

  return (
    <section className="border border-slate-200 bg-white p-4">
      <div className="mb-4 flex items-center gap-2">
        <CalendarPlus size={17} className="text-slate-500" />
        <h2 className="text-base font-semibold text-slate-950">New page title template</h2>
      </div>
      <div className="space-y-3 text-sm">
        <div className="flex items-center gap-2 font-medium text-slate-800">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => onEnabledChange(event.target.checked)}
            aria-label="Use title template for new pages"
            style={checkboxStyle}
            className="size-4 cursor-pointer border-slate-300"
          />
          <span>Use this template for new pages</span>
        </div>
        <div className="mt-2 flex flex-wrap items-start gap-2">
          <input
            id="page-title-template"
            aria-label="New page title template"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Example: ChordBrach-Expt{number}"
            disabled={!enabled}
            className="min-w-[280px] flex-1 border border-slate-300 px-3 py-2 text-slate-950 outline-none focus:border-slate-500 disabled:bg-slate-50 disabled:text-slate-400"
          />
          <button type="button" onClick={onSave} disabled={saveDisabled} style={saveButtonStyle} className="inline-flex h-9 items-center gap-2 border border-slate-300 px-3 font-medium text-slate-700 disabled:border-slate-300 disabled:text-slate-400">
            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
            Save template
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">Use {"{number}"} where Novo should insert the next number. Leave blank to use Untitled.</p>
        {error ? <p className="mt-2 text-xs font-medium text-red-600">{error}</p> : null}
      </div>
    </section>
  );
}

function NotebookOverviewGroup({ title, rows }: { title: string; rows: Array<{ label: string; value: string }> }) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
      <dl className="mt-2 divide-y divide-slate-100 border-y border-slate-100 text-sm">
        {rows.map((row) => <NotebookOverviewRow key={row.label} label={row.label} value={row.value} />)}
      </dl>
    </section>
  );
}

function NotebookOverviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[150px_minmax(0,1fr)] gap-4 py-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="select-text break-words text-left font-medium tabular-nums text-slate-950">{value}</dd>
    </div>
  );
}

function NotebookAccessList({ members, currentUserId, canManage, onRoleChange, onRemove }: { members: ShareMember[]; currentUserId: string; canManage: boolean; onRoleChange: (member: ShareMember, role: AccessRole) => Promise<void>; onRemove: (member: ShareMember) => void }) {
  if (!members.length) return <p className="text-sm text-slate-500">No members have access yet.</p>;
  return (
    <div className="space-y-2">
      {members.map((member) => {
        const isCurrentUser = member.userId === currentUserId;
        const isAppAdmin = member.appRole === "admin";
        const RoleIcon = isAppAdmin ? Shield : accessRoleIcons[member.role];
        const roleIconClass = isAppAdmin ? "text-cyan-700" : member.role === "owner" ? "text-amber-600" : "text-slate-500";
        const roleLabel = isAppAdmin ? "Admin" : member.role;
        const roleCanBeChanged = canManage && !isCurrentUser && !isAppAdmin;
        const roleCanBeRemoved = (canManage || isCurrentUser) && !isAppAdmin;
        return (
        <div key={member.userId} className="grid gap-3 border border-slate-200 bg-white p-3 sm:grid-cols-[minmax(0,1fr)_170px_36px] sm:items-center">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-950">{userDisplayName(member)}{isCurrentUser ? <span className="ml-1 font-normal text-slate-500">(you)</span> : null}</p>
            <p className="truncate text-xs text-slate-500">{member.email}</p>
          </div>
          {roleCanBeChanged ? (
            <div className="flex min-w-0 items-center gap-2">
              <RoleIcon size={15} className={`shrink-0 ${roleIconClass}`} />
              <select value={member.role} onChange={(event) => void onRoleChange(member, event.target.value as AccessRole)} className="h-9 min-w-0 flex-1 cursor-pointer border border-slate-300 bg-white px-2 text-sm text-slate-950 outline-none focus:border-cyan-600">
                <option value="owner">Owner</option>
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>
          ) : (
            <span className="inline-flex items-center gap-2 text-sm capitalize text-slate-600">
              <RoleIcon size={15} className={`shrink-0 ${roleIconClass}`} />
              {roleLabel}
            </span>
          )}
          {roleCanBeRemoved ? (
            <button type="button" onClick={() => onRemove(member)} className="grid size-9 place-items-center border border-slate-200 text-slate-500 hover:bg-slate-100" title={isCurrentUser ? "Leave notebook" : "Remove access"}>
              <X size={14} />
            </button>
          ) : null}
        </div>
        );
      })}
    </div>
  );
}

function NotebookMemberRemovalModal({ member, isCurrentUser, removing, onCancel, onConfirm }: { member: ShareMember; isCurrentUser: boolean; removing: boolean; onCancel: () => void; onConfirm: () => void }) {
  const title = isCurrentUser ? "Leave notebook?" : "Remove notebook access?";
  const action = isCurrentUser ? "Leave notebook" : "Remove access";
  return (
    <ModalFrame>
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <p className="mt-3 text-sm leading-6 text-slate-400">
        {isCurrentUser ? (
          <>You will lose access to this notebook unless another owner shares it with you again.</>
        ) : (
          <>This will remove <span className="font-semibold text-white">{userDisplayName(member)}</span> from this notebook.</>
        )}
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onCancel} disabled={removing} className="h-9 border border-white/10 px-3 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-60">Cancel</button>
        <button onClick={onConfirm} disabled={removing} className="inline-flex h-9 items-center gap-2 bg-rose-500 px-3 text-sm font-medium text-white hover:bg-rose-400 disabled:bg-rose-800 disabled:text-rose-200">
          {removing ? <Loader2 size={15} className="animate-spin" /> : null}
          {removing ? "Working..." : action}
        </button>
      </div>
    </ModalFrame>
  );
}

function ShareForm({ members, existingMembers, submitLabel, disabled: disabledByPermission = false, disabledReason, onSubmit }: { members: AppUser[]; existingMembers: ShareMember[]; submitLabel: string; disabled?: boolean; disabledReason?: string; onSubmit: (input: { email: string; role: AccessRole }) => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [selectedMember, setSelectedMember] = useState<AppUser | null>(null);
  const [role, setRole] = useState<AccessRole>("editor");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [focused, setFocused] = useState(false);
  const existingMemberIds = useMemo(() => new Set(existingMembers.map((member) => member.userId)), [existingMembers]);
  const availableMembers = useMemo(() => members.filter((member) => !existingMemberIds.has(member.id)), [existingMemberIds, members]);
  const normalizedQuery = query.trim().toLowerCase();
  const suggestions = useMemo(() => {
    const filtered = normalizedQuery
      ? availableMembers.filter((member) => `${userDisplayName(member)} ${member.email}`.toLowerCase().includes(normalizedQuery))
      : availableMembers;
    return filtered.slice(0, 8);
  }, [availableMembers, normalizedQuery]);
  const formDisabled = disabledByPermission || submitting || !selectedMember;

  function selectMember(member: AppUser) {
    setSelectedMember(member);
    setQuery(userDisplayName(member));
    setFocused(false);
    setError("");
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (formDisabled || !selectedMember) return;
    setError("");
    setSubmitting(true);
    try {
      await onSubmit({ email: selectedMember.email, role });
      setQuery("");
      setSelectedMember(null);
      setRole("editor");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to share.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label className="block text-sm font-medium text-slate-700">
        Group member
        <div className="relative mt-1">
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedMember(null);
              setFocused(true);
            }}
            onFocus={() => !disabledByPermission && setFocused(true)}
            onBlur={() => window.setTimeout(() => setFocused(false), 120)}
            type="text"
            autoComplete="off"
            disabled={disabledByPermission}
            placeholder="Search by full name or email"
            className="h-9 w-full border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none focus:border-cyan-600 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
          />
          {focused && !disabledByPermission ? (
            <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto border border-slate-300 bg-white py-1 shadow-lg">
              {suggestions.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectMember(member)}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100"
                >
                  <span className="block truncate font-medium text-slate-950">{userDisplayName(member)}</span>
                  <span className="block truncate text-xs text-slate-500">{member.email}</span>
                </button>
              ))}
              {suggestions.length === 0 ? <p className="px-3 py-2 text-sm text-slate-500">No available members found.</p> : null}
            </div>
          ) : null}
        </div>
      </label>
      <div className="flex gap-2">
        <select
          value={role}
          onChange={(event) => setRole(event.target.value as AccessRole)}
          disabled={disabledByPermission}
          className="h-9 flex-1 cursor-pointer border border-slate-300 bg-white px-2 text-sm text-slate-950 outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
        >
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
          <option value="owner">Owner</option>
        </select>
        <button disabled={formDisabled} className="inline-flex h-9 items-center gap-2 bg-slate-950 px-3 text-sm font-semibold text-white disabled:bg-slate-300">
          {submitting ? <Loader2 size={15} className="animate-spin" /> : null}
          {submitting ? "Sharing..." : submitLabel}
        </button>
      </div>
      {disabledReason ? <p className="text-xs text-slate-500">{disabledReason}</p> : null}
      {selectedMember ? <p className="text-xs text-slate-500">Sharing with {userDisplayName(selectedMember)} ({selectedMember.email})</p> : null}
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
    </form>
  );
}

async function removeNotebookMember(notebookId: string, userId: string) {
  await fetch(`/api/notebooks/${notebookId}/members/${userId}`, { method: "DELETE" }).then(assertOk);
}

async function assertOk(response: Response) {
  if (response.ok) return;
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  throw new Error(body?.error ?? "Request failed.");
}

function secondsBetween(startedAt: string, finishedAt?: string, now = Date.now()) {
  const start = parseServerTimestamp(startedAt);
  const end = finishedAt ? parseServerTimestamp(finishedAt) : now;
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.floor((end - start) / 1000));
}

function estimateRemainingSeconds(elapsedSeconds: number, progressPercent: number) {
  if (!elapsedSeconds || progressPercent <= 0 || progressPercent >= 100) return 0;
  const estimatedTotalSeconds = Math.round(elapsedSeconds / (progressPercent / 100));
  return Math.max(0, estimatedTotalSeconds - elapsedSeconds);
}

function formatDuration(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "0s";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function parseServerTimestamp(value: string) {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  return Date.parse(normalized);
}

function ResizeHandle({ onPointerDown, disabled = false }: { onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void; disabled?: boolean }) {
  return (
    <div className={`group relative z-20 w-px bg-slate-200 ${disabled ? "" : "hover:bg-cyan-500"}`} title={disabled ? undefined : "Drag to resize"}>
      <div onPointerDown={disabled ? undefined : onPointerDown} className={`absolute -left-[5px] top-0 h-full w-[11px] ${disabled ? "" : "cursor-col-resize"}`} />
    </div>
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

async function performAppUpdate() {
  if (typeof window === "undefined") return;
  if ("caches" in window) {
    try {
      const cacheNames = await window.caches.keys();
      await Promise.all(cacheNames.map((cacheName) => window.caches.delete(cacheName)));
    } catch {
      // Cache cleanup is best-effort; the cache-busted navigation below is the important part.
    }
  }

  const url = new URL(window.location.href);
  url.searchParams.set("_novoUpdate", Date.now().toString());
  window.location.replace(url.toString());
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

function capitalizeLabel(value: string) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}
