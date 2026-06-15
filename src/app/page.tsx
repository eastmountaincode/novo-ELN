"use client";

import {
  Beaker,
  CalendarClock,
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Crown,
  Database,
  Download,
  Eye,
  EyeOff,
  FileArchive,
  FileImage,
  Filter,
  Flag,
  FileSpreadsheet,
  FileText,
  GripVertical,
  History,
  Home as HomeIcon,
  Image as ImageIcon,
  KeyRound,
  Lock,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  MoveRight,
  Notebook as NotebookIcon,
  Palette,
  Paperclip,
  Plus,
  Pencil,
  RefreshCw,
  Search,
  Settings,
  Shield,
  SlidersHorizontal,
  Tag,
  Trash2,
  Unlock,
  Users,
  X,
  UserCircle,
} from "lucide-react";
import type { JSONContent } from "@tiptap/react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PresentationModal } from "@/components/PresentationModal";
import { PrintPageDocument } from "@/components/PrintPageDocument";
import { INLINE_ATTACHMENT_DRAG_TYPE, RichTextEditor, attachmentToInlineAttrs, type InlineAttachmentAttrs } from "@/components/RichTextEditor";
import { SpreadsheetModal } from "@/components/SpreadsheetModal";
import { bodyToEditorText } from "@/lib/editor";
import type { AccessRole, AdminActivityOverview, AdminAppSettings, AdminDataOverview, AdminUser, AppUser, Attachment, AuditEvent, BlockType, Notebook, PageCommentThread, PageEntry, PageStatus, Project, SearchResult, ShareMember, Workspace } from "@/lib/types";

const blockIcons: Record<BlockType, typeof ImageIcon> = {
  image: ImageIcon,
  sheet: FileSpreadsheet,
  pdf: FileText,
  slides: FileArchive,
  sequence: Beaker,
  file: FileImage,
};

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

type PageSortKey = "updated" | "created" | "title";
type NotebookSortKey = "updated" | "created" | "title";

const PAGE_SORT_OPTIONS: Array<{ key: PageSortKey; label: string }> = [
  { key: "updated", label: "Date updated" },
  { key: "created", label: "Date created" },
  { key: "title", label: "Title" },
];

const NOTEBOOK_SORT_OPTIONS: Array<{ key: NotebookSortKey; label: string }> = [
  { key: "updated", label: "Date updated" },
  { key: "created", label: "Date created" },
  { key: "title", label: "Title" },
];

const PAGE_SORT_STORAGE_KEY = "novo.pageSortKey";
const NOTEBOOK_SORT_STORAGE_KEY = "novo.notebookSortKey";

const PAGE_ACTIVITY_PAGE_SIZE = 25;
const SUCCESS_STATUS_CLEAR_AFTER_MS = 4400;
const UPDATE_CHECK_INTERVAL_MS = 2 * 60 * 1000;
const WORDMARK_TEXT = process.env.NODE_ENV === "development" ? "novo-dev" : "novo";

const PAGE_STATUS_OPTIONS: Array<{ value: PageStatus; label: string }> = [
  { value: "", label: "No status" },
  { value: "Working", label: "Working" },
  { value: "Needs review", label: "Needs review" },
  { value: "Completed", label: "Completed" },
  { value: "Failed", label: "Failed" },
];

const passwordRequirementText = "At least 12 characters with uppercase, lowercase, number, and symbol characters.";

type NameDialogState =
  | { kind: "createProject" }
  | { kind: "createNotebook"; projectId: string; projectName: string; initialMode?: "blank" | "import" }
  | { kind: "renameProject"; project: Project }
  | { kind: "renameNotebook"; notebook: Notebook };

type HydratedSearchResult = SearchResult & {
  page?: PageEntry;
  project?: Project;
  notebook?: Notebook;
};

type SearchAdvancedFilters = {
  include: string[];
  exclude: string[];
  tags: string[];
  fields: SearchFieldKey[];
};

type SearchFieldKey = "title" | "body" | "tags" | "attachments";

const DEFAULT_SEARCH_FIELDS: SearchFieldKey[] = ["title", "body", "tags", "attachments"];

const SEARCH_FIELD_OPTIONS: Array<{ key: SearchFieldKey; label: string; icon: typeof FileText }> = [
  { key: "title", label: "Page titles", icon: FileText },
  { key: "body", label: "Page text", icon: FileText },
  { key: "tags", label: "Tags", icon: Tag },
  { key: "attachments", label: "Attachment names", icon: Paperclip },
];

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

  async function uploadAttachment(file: File | undefined) {
    if (!file || !selectedPage || !selectedPageCanEdit) return;
    const form = new FormData();
    form.set("file", file);
    setSaveStatus("Uploading");
    const response = await fetch(`/api/pages/${selectedPage.id}/attachments`, { method: "POST", body: form });
    setSaveStatus(response.ok ? "Uploaded" : "Upload failed", response.ok ? { clearAfterMs: SUCCESS_STATUS_CLEAR_AFTER_MS } : {});
    if (response.ok) await refreshWorkspace({ projectId: selectedProject?.id, notebookId: selectedNotebook?.id, pageId: selectedPage.id });
  }

  async function deletePageAttachment(attachment: Attachment) {
    if (!selectedPage || !selectedPageCanEdit) return;
    const response = await fetch(`/api/attachments/${attachment.id}`, { method: "DELETE" });
    if (!response.ok) {
      setSaveStatus("Delete failed");
      return;
    }
    setSaveStatus("Deleted", { clearAfterMs: SUCCESS_STATUS_CLEAR_AFTER_MS });
    await refreshWorkspace({ projectId: selectedProject?.id, notebookId: selectedNotebook?.id, pageId: selectedPage.id });
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
          <div className="novo-wordmark select-none text-7xl leading-none tracking-normal text-slate-950">{WORDMARK_TEXT}</div>
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
            <div className="mb-4 flex items-center gap-3">
              <div className="grid size-10 place-items-center border border-slate-200 bg-white">
                <img src="/novo-n-mark.png" alt="Novo" className="size-7 object-contain brightness-0" />
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500">Novo</p>
                {authMode === "register" ? <h1 className="text-xl font-semibold">Create an account</h1> : null}
              </div>
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

  return (
    <main className="app-scroll-root overflow-x-auto bg-white text-slate-950">
      <input ref={fileInputRef} type="file" className="hidden" onChange={(event) => void uploadAttachment(event.target.files?.[0])} />
      {(updateAvailable || previewKeys.has("update-banner")) && !updateBannerDismissed ? (
        <UpdateAvailableBanner preview={previewKeys.has("update-banner")} onDismiss={() => setUpdateBannerDismissed(true)} />
      ) : null}

      <div className="grid h-dvh min-w-[980px]" style={{ gridTemplateColumns: activeView === "project" ? `${effectiveSidebarWidth}px 1px minmax(0,${effectivePagesWidth}px) 1px minmax(560px, 1fr)` : `${effectiveSidebarWidth}px 1px minmax(560px, 1fr)` } as React.CSSProperties}>
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
          <HomeView recentPages={recentPages} members={workspace.members} selectPage={selectPage} importEnexNotebook={() => createNewNotebook(undefined, "import")} />
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

function ModalFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-6">
      <div className="w-full max-w-md border border-white/10 bg-slate-900 p-5 shadow-2xl shadow-slate-950/50">
        {children}
      </div>
    </div>
  );
}

function UnifiedSidebar({ workspace, activeView, selectedNotebook, sidebarCollapsed, accountOpen, notebookMenuId, openSearch, toggleSidebarCollapsed, setAccountOpen, setProjectMenuId, setNotebookMenuId, openHome, openAccount, selectNotebook, renameNotebook, deleteNotebook, updateNotebookColor, openNotebookSettings, createNewNotebook, handleLogout }: { workspace: Workspace; activeView: "home" | "projectHome" | "project" | "notebookSettings" | "account"; selectedProject?: Project; selectedNotebook?: Notebook; sidebarCollapsed: boolean; accountOpen: boolean; projectMenuId: string | null; notebookMenuId: string | null; expandedProjectIds: Set<string>; openSearch: () => void; toggleSidebarCollapsed: () => void; setAccountOpen: (value: boolean) => void; setProjectMenuId: (value: string | null) => void; setNotebookMenuId: (value: string | null) => void; openHome: () => void; openAccount: () => void; selectProject: (project: Project) => void; toggleProject: (project: Project) => void; selectNotebook: (project: Project, notebook: Notebook) => void; createNewProject: () => void; renameProject: (project: Project) => void; updateProjectColor: (project: Project, color: string) => void; deleteProject: (project: Project) => void; renameNotebook: (notebook: Notebook) => void; deleteNotebook: (notebook: Notebook) => void; updateNotebookColor: (notebook: Notebook, color: string) => void; openNotebookSettings: (notebook: Notebook) => void; createNewNotebook: (projectId?: string) => void; handleLogout: () => void }) {
  const workspaceProject = workspace.projects[0];
  const [myNotebooksCollapsed, setMyNotebooksCollapsed] = useState(false);
  const [sharedNotebooksCollapsed, setSharedNotebooksCollapsed] = useState(false);
  const [notebookSortKey, setNotebookSortKey] = useState<NotebookSortKey>(readStoredNotebookSortKey);
  const [notebookSortOpen, setNotebookSortOpen] = useState(false);
  const notebookSortRef = useRef<HTMLDivElement>(null);
  const sortedOwnNotebooks = useMemo(() => sortNotebooks(workspace.notebooks.filter((notebook) => notebook.accessRole === "owner"), notebookSortKey), [workspace.notebooks, notebookSortKey]);
  const sortedSharedNotebooks = useMemo(() => sortNotebooks(workspace.notebooks.filter((notebook) => notebook.accessRole !== "owner"), notebookSortKey), [workspace.notebooks, notebookSortKey]);

  useEffect(() => {
    writeStoredSortKey(NOTEBOOK_SORT_STORAGE_KEY, notebookSortKey);
  }, [notebookSortKey]);

  useEffect(() => {
    if (!notebookSortOpen) return;

    function isInsideNotebookSort(target: EventTarget | null) {
      return target instanceof Element && Boolean(notebookSortRef.current?.contains(target));
    }

    function closeNotebookSort() {
      setNotebookSortOpen(false);
    }

    function onPointerDown(event: PointerEvent) {
      if (!isInsideNotebookSort(event.target)) closeNotebookSort();
    }

    function onFocusIn(event: FocusEvent) {
      if (!isInsideNotebookSort(event.target)) closeNotebookSort();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeNotebookSort();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [notebookSortOpen]);

  function renderNotebook(notebook: Notebook) {
    const selected = (activeView === "project" || activeView === "notebookSettings") && selectedNotebook?.id === notebook.id;
    const color = projectColor(notebook);
    const canEditNotebookActions = canEditNotebook(workspace.user, notebook);
    const canDeleteNotebookAction = notebook.accessRole === "owner";
    return (
      <div key={notebook.id} className={sidebarCollapsed ? "px-3" : "px-4"}>
        <div
          className={`relative flex w-full min-w-0 items-center gap-1 px-2 py-1.5 text-sm ${selected ? "text-white" : "text-slate-300 hover:bg-white/5"}`}
          style={{ backgroundColor: selected ? colorWithAlpha(color, 0.1) : undefined }}
        >
          <button onClick={() => workspaceProject && selectNotebook(workspaceProject, notebook)} className={`flex min-w-0 flex-1 items-center overflow-hidden text-left ${sidebarCollapsed ? "justify-center" : "gap-2"}`} title={notebook.name}>
            <NotebookIcon size={15} className="shrink-0" style={{ color }} />
            <span className="sidebar-wide min-w-0 truncate">{notebook.name}</span>
          </button>
          <button
            data-transient-menu="true"
            onClick={() => {
              setProjectMenuId(null);
              setAccountOpen(false);
              setNotebookMenuId(notebookMenuId === notebook.id ? null : notebook.id);
            }}
            className="sidebar-wide grid size-6 shrink-0 place-items-center text-slate-400 hover:bg-white/10 hover:text-white"
            title="Notebook actions"
          >
            <MoreHorizontal size={14} />
          </button>
          {notebookMenuId === notebook.id ? (
            <div data-transient-menu="true" className="sidebar-wide absolute right-1 top-8 z-20 w-44 border border-white/10 bg-slate-900 py-1 shadow-lg">
              <button onClick={() => { setNotebookMenuId(null); openNotebookSettings(notebook); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/10">
                <Settings size={15} className="shrink-0 text-slate-400" />
                <span>Settings</span>
              </button>
              {canEditNotebookActions ? <label className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm text-slate-200 hover:bg-white/10">
                <span className="flex min-w-0 items-center gap-2">
                  <Palette size={15} className="shrink-0 text-slate-400" />
                  <span>Color</span>
                </span>
                <input
                  type="color"
                  value={color}
                  onChange={(event) => updateNotebookColor(notebook, event.target.value)}
                  className="size-6 cursor-pointer border-0 bg-transparent p-0"
                  title="Notebook color"
                />
              </label> : null}
              {canEditNotebookActions ? <button onClick={() => { setNotebookMenuId(null); renameNotebook(notebook); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/10">
                <Pencil size={15} className="shrink-0 text-slate-400" />
                <span>Rename</span>
              </button> : null}
              {canDeleteNotebookAction ? <button onClick={() => { setNotebookMenuId(null); deleteNotebook(notebook); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-300 hover:bg-white/10">
                <Trash2 size={15} className="shrink-0 text-rose-400" />
                <span>Delete</span>
              </button> : null}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const notebookSortControl = (
    <div ref={notebookSortRef} data-transient-menu="true" className="relative">
      <button
        type="button"
        onClick={() => setNotebookSortOpen((open) => !open)}
        className="grid size-6 shrink-0 place-items-center text-slate-400 hover:bg-white/10 hover:text-white"
        aria-label="Sort notebooks"
        aria-haspopup="dialog"
        aria-expanded={notebookSortOpen}
        title={`Sort notebooks: ${NOTEBOOK_SORT_OPTIONS.find((option) => option.key === notebookSortKey)?.label}`}
      >
        <SlidersHorizontal size={14} />
      </button>
      {notebookSortOpen ? (
        <section
          role="dialog"
          aria-label="Sort notebooks"
          className="absolute right-0 top-7 z-30 w-52 border border-white/10 bg-slate-900 p-1 text-slate-100 shadow-2xl shadow-slate-950/30"
        >
          <p className="px-3 pb-1.5 pt-2 text-xs font-semibold text-slate-500">Sort by</p>
          <div className="space-y-1">
            {NOTEBOOK_SORT_OPTIONS.map((option) => {
              const selected = option.key === notebookSortKey;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => {
                    setNotebookSortKey(option.key);
                    setNotebookSortOpen(false);
                  }}
                  className={`flex h-9 w-full items-center justify-between gap-3 px-3 text-left text-sm font-medium ${selected ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white"}`}
                >
                  <span>{option.label}</span>
                  {selected ? <Check size={14} className="text-cyan-300" /> : null}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );

  return (
    <aside className={`relative z-30 grid min-h-screen grid-rows-[auto_1fr_auto] bg-slate-950 text-slate-200 ${sidebarCollapsed ? "sidebar-collapsed overflow-visible" : "overflow-hidden"}`}>
      <div className="space-y-2 border-b border-white/10 py-4">
        <div className={sidebarCollapsed ? "px-3" : "px-4"}>
          <div className={`flex min-w-0 items-start ${sidebarCollapsed ? "justify-center" : "justify-between gap-3"}`}>
            <div
              role="button"
              tabIndex={0}
              onClick={openHome}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openHome();
                }
              }}
              className={`novo-wordmark sidebar-wide min-w-0 cursor-pointer select-none px-1 py-1 leading-none tracking-normal text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${WORDMARK_TEXT === "novo-dev" ? "text-5xl" : "text-6xl"}`}
              aria-label="Go to home"
              title="Overview"
            >
              {WORDMARK_TEXT}
            </div>
            <button
              type="button"
              onClick={toggleSidebarCollapsed}
              className="grid size-8 shrink-0 place-items-center text-slate-400 hover:bg-white/10 hover:text-white"
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {sidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            </button>
          </div>
        </div>
        <div className={sidebarCollapsed ? "px-3" : "px-4"}>
          <button
            type="button"
            onClick={openSearch}
            className={`flex h-10 w-full items-center border border-white/10 bg-white/10 text-sm text-slate-400 hover:border-cyan-400 hover:text-slate-200 ${sidebarCollapsed ? "justify-center px-0" : "gap-2 px-3 text-left"}`}
            aria-haspopup="dialog"
            title="Search"
          >
            <Search size={17} className="shrink-0" />
            <span className="sidebar-wide">Search</span>
          </button>
        </div>
      </div>

      <div className="overflow-y-auto scroll-contained py-3">
        <div className={`mb-3 ${sidebarCollapsed ? "px-3" : "px-4"}`}>
          <button onClick={openHome} className={`flex w-full min-w-0 items-center overflow-hidden py-2 text-left text-sm ${sidebarCollapsed ? "justify-center px-0" : "gap-2 px-2"} ${activeView === "home" ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5"}`} title="Overview">
            <HomeIcon size={16} className="shrink-0" />
            <span className="sidebar-wide min-w-0 truncate font-medium">Overview</span>
          </button>
        </div>
        <SidebarSection label="My Notebooks" collapsed={myNotebooksCollapsed} onToggle={() => setMyNotebooksCollapsed((current) => !current)} action={notebookSortControl} onAdd={() => createNewNotebook(workspaceProject?.id)} />
        {!myNotebooksCollapsed ? (
          <div className="mt-2 space-y-1">
            {sortedOwnNotebooks.map(renderNotebook)}
            {sortedOwnNotebooks.length === 0 && !sidebarCollapsed ? <p className="sidebar-wide px-6 py-2 text-xs text-slate-500">No notebooks yet.</p> : null}
          </div>
        ) : null}
        <div className="mt-5">
          <SidebarSection label="Shared with Me" collapsed={sharedNotebooksCollapsed} onToggle={() => setSharedNotebooksCollapsed((current) => !current)} />
        </div>
        {!sharedNotebooksCollapsed ? (
          <div className="mt-2 space-y-1">
            {sortedSharedNotebooks.map(renderNotebook)}
            {sortedSharedNotebooks.length === 0 && !sidebarCollapsed ? <p className="sidebar-wide px-6 py-2 text-xs text-slate-500">No shared notebooks.</p> : null}
          </div>
        ) : null}
      </div>

      <div className="relative border-t border-white/10 py-4">
        {accountOpen ? (
          <div
            data-transient-menu="true"
            className={`${sidebarCollapsed ? "absolute bottom-4 left-[calc(100%+8px)] z-50 w-64 border border-white/10 bg-slate-900 p-3 shadow-2xl shadow-slate-950/40" : "sidebar-wide absolute bottom-16 left-4 right-4 border border-white/10 bg-slate-900 p-3 shadow-lg"}`}
          >
            <p className="text-sm font-medium text-white">{userDisplayName(workspace.user)}</p>
            <p className="mt-1 truncate text-xs text-slate-400">{workspace.user.email}</p>
            <p className="mt-2 text-xs capitalize text-slate-500">{workspace.user.role}</p>
            <button onClick={openAccount} className="mt-3 h-8 w-full border border-white/10 text-sm text-slate-200 hover:bg-white/10">Account settings</button>
            <button onClick={handleLogout} className="mt-3 h-8 w-full border border-white/10 text-sm text-slate-200 hover:bg-white/10">Sign out</button>
          </div>
        ) : null}
        <div className={sidebarCollapsed ? "px-3" : "px-4"}>
          <button
            data-transient-menu="true"
            onClick={() => {
              setProjectMenuId(null);
              setNotebookMenuId(null);
              setAccountOpen(!accountOpen);
            }}
            className={`flex h-11 w-full min-w-0 items-center overflow-hidden text-left text-sm ${sidebarCollapsed ? "justify-center px-0" : "gap-2 px-2"} ${activeView === "account" ? "bg-white/10 text-white" : "text-slate-200 hover:bg-white/5"}`}
            title={workspace.user.email}
          >
            <UserCircle size={22} className="shrink-0" />
            <span className="sidebar-wide min-w-0 flex-1 truncate">{workspace.user.email}</span>
            <MoreHorizontal size={16} className="sidebar-wide shrink-0 text-slate-500" />
          </button>
        </div>
      </div>
    </aside>
  );
}

function PagesSidebar({ selectedProject, selectedNotebook, selectedPage, pageMenuId, setPageMenuId, selectPage, createNewPage, creatingPage, canEdit, deletePage, movePage, duplicatePage, duplicatingPageId, searchTagSuggestions, collapsed, toggleCollapsed }: { selectedProject?: Project; selectedNotebook?: Notebook; selectedPage?: PageEntry; pageMenuId: string | null; setPageMenuId: (id: string | null) => void; selectPage: (project: Project, notebook: Notebook, page: PageEntry) => void; createNewPage: () => void; creatingPage: boolean; canEdit: boolean; deletePage: (page: PageEntry) => void; movePage: (page: PageEntry) => void; duplicatePage: (page: PageEntry) => void; duplicatingPageId: string; searchTagSuggestions: string[]; collapsed: boolean; toggleCollapsed: () => void }) {
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
    setNotebookQuery("");
    setNotebookSearchFilters(emptySearchAdvancedFilters());
    setNotebookSearchResults([]);
    setNotebookSearchLoading(false);
    setNotebookSearchApproxLoading(false);
    setNotebookSearchOpen(false);
    lastNotebookSearchKeyRef.current = "";
  }, [selectedNotebook?.id]);

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
              onDuplicate={canEdit && !page.lockedAt ? () => duplicatePage(page) : undefined}
              duplicating={duplicatingPageId === page.id}
              onMove={canEdit && !page.lockedAt ? () => movePage(page) : undefined}
              onDelete={canEdit && !page.lockedAt ? () => deletePage(page) : undefined}
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

function SearchOverlay({ query, setQuery, advancedFilters, setAdvancedFilters, availableTags, loading, approxLoading, results, scopeNotebook, onClose, selectResult }: { query: string; setQuery: (value: string) => void; advancedFilters: SearchAdvancedFilters; setAdvancedFilters: (value: SearchAdvancedFilters | ((current: SearchAdvancedFilters) => SearchAdvancedFilters)) => void; availableTags: string[]; loading: boolean; approxLoading: boolean; results: HydratedSearchResult[]; scopeNotebook?: Notebook; onClose: () => void; selectResult: (result: HydratedSearchResult) => void }) {
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

function emptySearchAdvancedFilters(): SearchAdvancedFilters {
  return { include: [], exclude: [], tags: [], fields: DEFAULT_SEARCH_FIELDS };
}

function hasSearchAdvancedFilters(filters: SearchAdvancedFilters) {
  return Boolean(filters.include.length || filters.exclude.length || filters.tags.length || !searchFieldListsEqual(filters.fields ?? DEFAULT_SEARCH_FIELDS, DEFAULT_SEARCH_FIELDS));
}

function hasSearchResultCriteria(filters: SearchAdvancedFilters) {
  return Boolean(filters.include.length || filters.exclude.length || filters.tags.length);
}

function hasApproximateSearchBasis(query: string, filters: SearchAdvancedFilters) {
  return Boolean(query.trim() || filters.include.length);
}

function searchFilterCount(filters: SearchAdvancedFilters) {
  return filters.include.length + filters.exclude.length + filters.tags.length + (searchFieldListsEqual(filters.fields ?? DEFAULT_SEARCH_FIELDS, DEFAULT_SEARCH_FIELDS) ? 0 : 1);
}

function searchApiUrl(input: { query: string; limit: number; mode: "fast" | "approx"; notebookId?: string; filters: SearchAdvancedFilters }) {
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

function searchCacheKey(input: { query: string; notebookId?: string; filters: SearchAdvancedFilters }) {
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

function mergeSearchResultLists(primary: SearchResult[], secondary: SearchResult[]) {
  const merged = new Map<string, SearchResult>();
  for (const result of primary) merged.set(result.pageId, result);
  for (const result of secondary) {
    if (!merged.has(result.pageId)) merged.set(result.pageId, result);
  }
  return [...merged.values()];
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

function PageCard({ page, active = false, contextLabel, accentColor = "#0891b2", tinted = false, menuOpen = false, setMenuOpen, onClick, onDuplicate, duplicating = false, onMove, onDelete }: { page: PageEntry; active?: boolean; contextLabel?: string; accentColor?: string; tinted?: boolean; menuOpen?: boolean; setMenuOpen?: (open: boolean) => void; onClick: () => void; onDuplicate?: () => void; duplicating?: boolean; onMove?: () => void; onDelete?: () => void }) {
  const fileCount = page.attachmentCount ?? page.attachments.length;
  const fileLabel = fileCount ? `${fileCount} files` : "No files";
  const color = normalizeColor(accentColor);
  const cardStyle = active ? pageCardActiveStyle(color) : tinted ? pageCardTintStyle(color) : undefined;
  const visibleTags = page.tags.slice(0, 3);
  const previewText = useMemo(() => (page.bodyLoaded ? bodyToEditorText(page.body) : page.bodyPreview) || "Empty page", [page.body, page.bodyLoaded, page.bodyPreview]);
  return (
    <div data-page-card-id={page.id} className="group relative w-full min-w-0 max-w-full overflow-visible">
      <button
        onClick={onClick}
        className={`block min-w-0 w-full max-w-full overflow-hidden border p-3 pr-10 text-left ${active ? "" : "border-slate-200 bg-white hover:border-slate-400"}`}
        style={cardStyle}
      >
        <h3 className="min-w-0 max-w-full break-words text-sm font-semibold leading-5 text-slate-900 [overflow-wrap:anywhere]">
          {page.lockedAt ? <Lock size={13} strokeWidth={2.2} className="mr-1 inline-block align-[-1px] text-slate-500" aria-label="Locked page" /> : null}
          {page.title || "Untitled"}
        </h3>
        <p className="mt-2 max-h-10 min-w-0 max-w-full overflow-hidden break-words text-sm leading-5 text-slate-500 [overflow-wrap:anywhere]">{previewText}</p>
        {(page.status || visibleTags.length > 0) ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {page.status ? <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-2.5 text-[11px] font-medium text-slate-700"><StatusDot status={page.status} />{getPageStatusLabel(page.status)}</span> : null}
            {visibleTags.map((tag) => <span key={tag} className="inline-flex h-6 max-w-full items-center truncate border border-slate-200 bg-slate-100 px-2 text-[11px] font-medium text-slate-600">{tag}</span>)}
            {page.tags.length > visibleTags.length ? <span className="inline-flex h-6 items-center px-1 text-[11px] font-medium text-slate-400">+{page.tags.length - visibleTags.length} more</span> : null}
          </div>
        ) : null}
        <div className="mt-3 space-y-1 text-[11px] leading-4 text-slate-500">
          {contextLabel ? (
            <div className="truncate font-medium text-slate-600">{contextLabel}</div>
          ) : null}
          <div className="flex items-center gap-1.5">
            <CalendarPlus size={12} className="shrink-0 text-slate-400" />
            <span>Created {formatDateTime(page.createdAt)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CalendarClock size={12} className="shrink-0 text-slate-400" />
            <span>Updated {formatDateTime(page.updatedAt)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Paperclip size={12} className="shrink-0 text-slate-400" />
            <span>{fileLabel}</span>
          </div>
        </div>
      </button>
      {setMenuOpen && (onDuplicate || onMove || onDelete) ? (
        <div data-transient-menu className="absolute right-2 top-2">
          <button
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpen(!menuOpen);
            }}
            className={`grid size-7 place-items-center border text-slate-500 ${menuOpen ? "border-slate-300 bg-white" : "border-transparent bg-transparent opacity-80 hover:border-slate-300 hover:bg-white group-hover:opacity-100"}`}
            title="Page actions"
          >
            <MoreHorizontal size={16} />
          </button>
          {menuOpen ? (
            <div className="absolute right-0 top-8 z-20 w-40 border border-slate-800 bg-slate-950 py-1 text-slate-100 shadow-xl">
              {onDuplicate ? (
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onDuplicate();
                  }}
                  disabled={duplicating}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500"
                >
                  {duplicating ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}
                  {duplicating ? "Duplicating..." : "Duplicate"}
                </button>
              ) : null}
              {onMove ? (
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuOpen(false);
                    onMove();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-100 hover:bg-white/10"
                >
                  <MoveRight size={14} />
                  Move page
                </button>
              ) : null}
              {onDelete ? (
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuOpen(false);
                    onDelete();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-300 hover:bg-white/10"
                >
                  <Trash2 size={14} />
                  Delete page
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function HomeView({ recentPages, members, selectPage, importEnexNotebook }: { recentPages: Array<{ page: PageEntry; project: Project; notebook: Notebook }>; members: AppUser[]; selectPage: (project: Project, notebook: Notebook, page: PageEntry) => void; importEnexNotebook: () => void }) {
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
                <FileArchive size={17} className="text-slate-500" />
                <h2 className="text-base font-semibold text-slate-950">Import</h2>
              </div>
              <p className="mb-4 text-sm leading-6 text-slate-500">Create a new notebook from an Evernote ENEX export.</p>
              <button
                type="button"
                onClick={importEnexNotebook}
                className="flex h-9 w-full items-center justify-center gap-2 border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:border-slate-500"
              >
                <FileArchive size={15} />
                Import ENEX notebook
              </button>
            </section>

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

type AccountTab = "profile" | "notebooks" | "security" | "app" | "users" | "activity" | "data";

function AccountView({ user, notebooks, onChanged }: { user: AppUser; notebooks: Notebook[]; onChanged: () => Promise<void> }) {
  const [activeTab, setActiveTab] = useState<AccountTab>("profile");
  const tabs: Array<{ id: AccountTab; label: string; icon: typeof UserCircle }> = [
    { id: "profile", label: "Profile", icon: UserCircle },
    { id: "notebooks", label: "Notebooks", icon: NotebookIcon },
    { id: "security", label: "Security", icon: KeyRound },
    ...(user.role === "admin" ? [{ id: "users" as AccountTab, label: "Users", icon: Users }] : []),
    ...(user.role === "admin" ? [{ id: "activity" as AccountTab, label: "Activity", icon: History }] : []),
    ...(user.role === "admin" ? [{ id: "data" as AccountTab, label: "Data", icon: Database }] : []),
    ...(user.role === "admin" ? [{ id: "app" as AccountTab, label: "App Settings", icon: Settings }] : []),
  ];

  return (
    <section className="min-h-screen overflow-y-auto scroll-contained bg-white p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-slate-950">Account Settings</h1>
        </div>

        <div className="mb-6 flex flex-wrap gap-2 border-b border-slate-200">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex h-10 items-center gap-2 border-b-2 px-3 text-sm font-medium ${selected ? "border-slate-950 text-slate-950" : "border-transparent text-slate-500 hover:text-slate-900"}`}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {activeTab === "profile" ? <AccountProfile user={user} onChanged={onChanged} /> : null}
        {activeTab === "notebooks" ? <AccountNotebooks notebooks={notebooks} /> : null}
        {activeTab === "security" ? <PasswordPanel /> : null}
        {activeTab === "app" && user.role === "admin" ? <AppSettingsPanel onChanged={onChanged} /> : null}
        {activeTab === "users" && user.role === "admin" ? <UsersAdminPanel currentUserId={user.id} /> : null}
        {activeTab === "activity" && user.role === "admin" ? <AdminActivityPanel /> : null}
        {activeTab === "data" && user.role === "admin" ? <DataAdminPanel /> : null}
      </div>
    </section>
  );
}

function AccountProfile({ user, onChanged }: { user: AppUser; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (editing) return;
    setFirstName(user.firstName);
    setLastName(user.lastName);
  }, [editing, user.firstName, user.lastName]);

  function cancelEditing() {
    setFirstName(user.firstName);
    setLastName(user.lastName);
    setError("");
    setEditing(false);
  }

  async function submitProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const response = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Profile update failed.");
        return;
      }
      setEditing(false);
      await onChanged();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="max-w-2xl border border-slate-200 bg-white p-5">
      <div className="mb-5 flex items-start gap-3">
        <div className="grid size-10 place-items-center border border-slate-200 bg-slate-50 text-slate-600">
          <UserCircle size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-slate-950">{userDisplayName(user)}</h2>
          <p className="mt-1 truncate text-sm text-slate-500">{user.email}</p>
        </div>
        {!editing ? (
          <button type="button" onClick={() => setEditing(true)} className="grid size-9 shrink-0 place-items-center border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-950" title="Edit profile" aria-label="Edit profile">
            <Pencil size={15} />
          </button>
        ) : null}
      </div>
      {editing ? (
        <form onSubmit={(event) => void submitProfile(event)} className="grid gap-4 border-t border-slate-100 pt-4">
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-slate-700">First name</span>
            <input value={firstName} onChange={(event) => setFirstName(event.target.value)} className="h-10 border border-slate-300 bg-white px-3 text-slate-950 outline-none focus:border-cyan-600" autoComplete="given-name" />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-slate-700">Last name</span>
            <input value={lastName} onChange={(event) => setLastName(event.target.value)} className="h-10 border border-slate-300 bg-white px-3 text-slate-950 outline-none focus:border-cyan-600" autoComplete="family-name" />
          </label>
          {error ? <p className="border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={cancelEditing} disabled={submitting} className="h-9 border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60">Cancel</button>
            <button type="submit" disabled={submitting || !firstName.trim()} className="inline-flex h-9 items-center gap-2 bg-slate-950 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:bg-slate-300">
              {submitting ? <Loader2 size={15} className="animate-spin" /> : null}
              {submitting ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      ) : (
        <dl className="grid gap-3 text-sm">
          <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 border-t border-slate-100 pt-3">
            <dt className="text-slate-500">First name</dt>
            <dd className="text-slate-950">{user.firstName || "Not set"}</dd>
          </div>
          <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 border-t border-slate-100 pt-3">
            <dt className="text-slate-500">Last name</dt>
            <dd className="text-slate-950">{user.lastName || "Not set"}</dd>
          </div>
          <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 border-t border-slate-100 pt-3">
            <dt className="text-slate-500">Role</dt>
            <dd className="capitalize text-slate-950">{user.role}</dd>
          </div>
          <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 border-t border-slate-100 pt-3">
            <dt className="text-slate-500">User ID</dt>
            <dd className="truncate font-mono text-xs text-slate-600">{user.id}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}

function AccountNotebooks({ notebooks }: { notebooks: Notebook[] }) {
  const owned = notebooks.filter((notebook) => notebook.accessRole === "owner");
  const editor = notebooks.filter((notebook) => notebook.accessRole === "editor");
  const viewer = notebooks.filter((notebook) => notebook.accessRole === "viewer");
  const rows = [
    { label: "Total associated", value: notebooks.length },
    { label: "Owner", value: owned.length },
    { label: "Shared with me", value: editor.length + viewer.length },
    { label: "Editor", value: editor.length },
    { label: "Viewer", value: viewer.length },
  ];

  return (
    <section className="max-w-4xl space-y-6">
      <div className="border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-slate-950">Notebook access</h2>
        <dl className="mt-4 divide-y divide-slate-100 text-sm">
          {rows.map((row) => (
            <div key={row.label} className="grid grid-cols-[180px_minmax(0,1fr)] gap-4 py-2 first:pt-0 last:pb-0">
              <dt className="text-slate-500">{row.label}</dt>
              <dd className="font-medium text-slate-950">{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-slate-950">Notebooks</h2>
        {notebooks.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-left text-sm">
              <thead className="border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-2 pr-4 font-medium">Notebook</th>
                  <th className="py-2 pr-4 font-medium">Access</th>
                  <th className="py-2 pr-4 font-medium">Pages</th>
                  <th className="py-2 pr-4 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {notebooks.map((notebook) => (
                  <tr key={notebook.id}>
                    <td className="py-2 pr-4">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: notebook.color }} />
                        <span className="min-w-0 truncate font-medium text-slate-950">{notebook.name}</span>
                      </div>
                    </td>
                    <td className="py-2 pr-4 capitalize text-slate-700">{notebook.accessRole}</td>
                    <td className="py-2 pr-4 text-slate-700">{notebook.pages.length}</td>
                    <td className="py-2 pr-4 text-slate-500">{formatDateTime(notebook.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">No notebooks associated with this account.</p>
        )}
      </div>
    </section>
  );
}

function PasswordPanel() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const disabled = submitting || !currentPassword || !nextPassword || !confirmPassword;

  async function submitPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");
    setError("");
    if (nextPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    setSubmitting(true);
    const response = await fetch("/api/account/password", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, nextPassword }),
    });
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    setSubmitting(false);
    if (!response.ok) {
      setError(body?.error ?? "Password change failed.");
      return;
    }
    setCurrentPassword("");
    setNextPassword("");
    setConfirmPassword("");
    setStatus("Password updated.");
  }

  return (
    <section className="max-w-2xl border border-slate-200 bg-white p-5">
      <div className="mb-5 flex items-start gap-3">
        <div className="grid size-10 place-items-center border border-slate-200 bg-slate-50 text-slate-600">
          <KeyRound size={21} />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Change password</h2>
        </div>
      </div>
      <form onSubmit={(event) => void submitPassword(event)} className="grid gap-4">
        <PasswordField label="Current password" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
        <PasswordField label="New password" value={nextPassword} onChange={setNextPassword} autoComplete="new-password" />
        <p className="-mt-2 text-xs leading-5 text-slate-500">{passwordRequirementText}</p>
        <PasswordField label="Confirm new password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />
        {error ? <p className="border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
        {status ? <p className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{status}</p> : null}
        <div>
          <button disabled={disabled} className="h-9 bg-slate-950 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300">
            {submitting ? "Saving" : "Update password"}
          </button>
        </div>
      </form>
    </section>
  );
}

function PasswordField({ label, value, onChange, autoComplete }: { label: string; value: string; onChange: (value: string) => void; autoComplete: string }) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        type="password"
        autoComplete={autoComplete}
        className="mt-1 h-10 w-full border border-slate-300 px-3 text-slate-950 outline-none focus:border-cyan-600"
      />
    </label>
  );
}

function AppSettingsPanel({ onChanged }: { onChanged: () => Promise<void> }) {
  const [settings, setSettings] = useState<AdminAppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/admin/settings")
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { settings?: AdminAppSettings; error?: string } | null;
        if (!active) return;
        setLoading(false);
        if (!response.ok) {
          setError(body?.error ?? "Unable to load app settings.");
          return;
        }
        setSettings(body?.settings ?? null);
      })
      .catch(() => {
        if (!active) return;
        setLoading(false);
        setError("Unable to load app settings.");
      });
    return () => {
      active = false;
    };
  }, []);

  async function updateAppSettings(patch: Partial<AdminAppSettings>) {
    if (!settings || saving) return;
    const previous = settings;
    const optimistic = { ...settings, ...patch };
    setError("");
    setSaving(true);
    setSettings(optimistic);
    const response = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const body = (await response.json().catch(() => null)) as { settings?: AdminAppSettings; error?: string } | null;
    setSaving(false);
    if (!response.ok) {
      setSettings(previous);
      setError(body?.error ?? "Unable to update app settings.");
      return;
    }
    setSettings(body?.settings ?? optimistic);
    await onChanged();
  }

  return (
    <section className="max-w-2xl border border-slate-200 bg-white">
      <div className="flex items-start gap-3 border-b border-slate-200 p-5">
        <div className="grid size-10 place-items-center border border-slate-200 bg-slate-50 text-slate-600">
          <CalendarPlus size={21} />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-950">App Settings</h2>
          <p className="mt-1 text-sm text-slate-500">Defaults for this Novo instance.</p>
        </div>
      </div>
      {error ? <p className="m-5 border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      {loading ? (
        <p className="flex items-center gap-2 p-5 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" />Loading settings...</p>
      ) : (
        <div className="divide-y divide-slate-100">
          <label className="flex cursor-pointer items-start gap-3 p-5">
            <input
              type="checkbox"
              checked={Boolean(settings?.prependDateToNewPages)}
              onChange={(event) => void updateAppSettings({ prependDateToNewPages: event.target.checked })}
              disabled={saving || !settings}
              className="mt-1 size-4 cursor-pointer border-slate-300 disabled:cursor-wait"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-slate-950">Add today&apos;s date to new pages</span>
              <span className="mt-1 block text-sm text-slate-500">New pages start with a first line like "May 28, 2026".</span>
            </span>
            {saving ? <Loader2 size={16} className="mt-1 shrink-0 animate-spin text-slate-400" /> : null}
          </label>
          <label className="flex cursor-pointer items-start gap-3 p-5">
            <input
              type="checkbox"
              checked={Boolean(settings?.suggestTagsGlobally)}
              onChange={(event) => void updateAppSettings({ suggestTagsGlobally: event.target.checked })}
              disabled={saving || !settings}
              className="mt-1 size-4 cursor-pointer border-slate-300 disabled:cursor-wait"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-slate-950">Suggest tags from all notebooks</span>
              <span className="mt-1 block text-sm text-slate-500">Page tag suggestions use tags from every notebook the user can access instead of only the current notebook.</span>
            </span>
            {saving ? <Loader2 size={16} className="mt-1 shrink-0 animate-spin text-slate-400" /> : null}
          </label>
        </div>
      )}
    </section>
  );
}

function UsersAdminPanel({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [resetUser, setResetUser] = useState<AdminUser | null>(null);

  async function loadUsers() {
    setLoading(true);
    setError("");
    const response = await fetch("/api/admin/users");
    const body = (await response.json().catch(() => null)) as { users?: AdminUser[]; error?: string } | null;
    setLoading(false);
    if (!response.ok) {
      setError(body?.error ?? "Unable to load users.");
      return;
    }
    setUsers(body?.users ?? []);
  }

  useEffect(() => {
    let active = true;
    fetch("/api/admin/users")
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { users?: AdminUser[]; error?: string } | null;
        if (!active) return;
        setLoading(false);
        if (!response.ok) {
          setError(body?.error ?? "Unable to load users.");
          return;
        }
        setUsers(body?.users ?? []);
      })
      .catch(() => {
        if (!active) return;
        setLoading(false);
        setError("Unable to load users.");
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="max-w-5xl border border-slate-200 bg-white">
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
        <div className="flex items-start gap-3">
          <div className="grid size-10 place-items-center border border-slate-200 bg-slate-50 text-slate-600">
            <Shield size={21} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Users</h2>
          </div>
        </div>
        <button onClick={() => void loadUsers()} className="h-9 border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-50">Refresh</button>
      </div>
      {error ? <p className="m-5 border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      {loading ? (
        <p className="p-5 text-sm text-slate-500">Loading users...</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full table-fixed border-collapse text-left text-sm">
            <colgroup>
              <col className="w-[22%]" />
              <col className="w-[9%]" />
              <col className="w-[9%]" />
              <col className="w-[15%]" />
              <col className="w-[15%]" />
              <col className="w-[15%]" />
              <col className="w-[15%]" />
            </colgroup>
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-3 font-semibold">User</th>
                <th className="px-3 py-3 font-semibold">Role</th>
                <th className="px-3 py-3 font-semibold">Notebooks</th>
                <th className="px-3 py-3 font-semibold">Last login</th>
                <th className="px-3 py-3 font-semibold">Last activity</th>
                <th className="px-3 py-3 font-semibold">Created</th>
                <th className="px-3 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="px-3 py-3">
                    <div className="truncate font-medium text-slate-950">{userDisplayName(user)}</div>
                    <div className="mt-1 truncate text-xs text-slate-500">{user.email}</div>
                  </td>
                  <td className="px-3 py-3 capitalize text-slate-700">{user.role}</td>
                  <td className="px-3 py-3 text-slate-700">{user.notebookCount}</td>
                  <td className="px-3 py-3 text-xs leading-5 text-slate-500">{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "Never"}</td>
                  <td className="px-3 py-3 text-xs leading-5 text-slate-500">{user.lastActivityAt ? formatDateTime(user.lastActivityAt) : "None"}</td>
                  <td className="px-3 py-3 text-xs leading-5 text-slate-500">{formatDateTime(user.createdAt)}</td>
                  <td className="px-3 py-3">
                    <button
                      onClick={() => setResetUser(user)}
                      className="min-h-8 border border-slate-300 px-3 py-1 text-sm leading-5 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={user.id === currentUserId}
                      title={user.id === currentUserId ? "Use Security to change your own password" : "Set temporary password"}
                    >
                      Set password
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 ? <p className="p-5 text-sm text-slate-500">No users found.</p> : null}
        </div>
      )}
      {resetUser ? (
        <AdminPasswordModal
          user={resetUser}
          onCancel={() => setResetUser(null)}
          onSaved={() => {
            setResetUser(null);
            void loadUsers();
          }}
        />
      ) : null}
    </section>
  );
}

const ADMIN_ACTIVITY_PAGE_SIZE = 30;

function AdminActivityPanel() {
  const [activity, setActivity] = useState<AdminActivityOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  async function loadActivity(offset = 0) {
    const append = offset > 0;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");
    const response = await fetch(`/api/admin/activity?limit=${ADMIN_ACTIVITY_PAGE_SIZE}&offset=${offset}`);
    const body = (await response.json().catch(() => null)) as { activity?: AdminActivityOverview; error?: string } | null;
    if (append) setLoadingMore(false);
    else setLoading(false);
    if (!response.ok) {
      setError(body?.error ?? "Unable to load activity.");
      return;
    }
    const nextActivity = body?.activity ?? null;
    if (!nextActivity) {
      setActivity(null);
      return;
    }
    setActivity((current) => append && current
      ? { ...nextActivity, events: [...current.events, ...nextActivity.events] }
      : nextActivity);
  }

  useEffect(() => {
    void loadActivity(0);
  }, []);

  const events = activity?.events ?? [];

  return (
    <section className="max-w-5xl border border-slate-200 bg-white">
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
        <div className="flex items-start gap-3">
          <div className="grid size-10 place-items-center border border-slate-200 bg-slate-50 text-slate-600">
            <History size={21} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Activity</h2>
          </div>
        </div>
        <button
          onClick={() => void loadActivity(0)}
          disabled={loading}
          className="inline-flex h-9 items-center gap-2 border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:text-slate-400"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          Refresh
        </button>
      </div>
      {error ? <p className="m-5 border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      {loading && !events.length ? (
        <p className="flex items-center gap-2 p-5 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" />Loading activity...</p>
      ) : null}
      {!loading && !events.length && !error ? <p className="p-5 text-sm text-slate-500">No activity recorded yet.</p> : null}
      {events.length ? (
        <div className="divide-y divide-slate-100">
          {events.map((event) => (
            <div key={event.id} className="grid grid-cols-[32px_minmax(0,1fr)] gap-3 px-5 py-4">
              <div className="grid size-8 place-items-center rounded-full bg-slate-950 text-xs font-semibold text-white">{auditInitials(event)}</div>
              <div className="min-w-0">
                <p className="whitespace-normal break-words text-sm leading-5 text-slate-700 [overflow-wrap:anywhere]">
                  <span className="font-semibold text-slate-950">{auditActorName(event)}</span>{" "}
                  {adminActivitySummary(event)}
                </p>
                <p className="mt-1 whitespace-normal break-words text-xs text-slate-500 [overflow-wrap:anywhere]">
                  <AdminActivityContext event={event} />
                </p>
                <p className="mt-1 text-xs font-medium text-blue-700">{formatDateTime(event.updatedAt)}</p>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {activity?.hasMore ? (
        <div className="border-t border-slate-100 p-5">
          <button
            type="button"
            onClick={() => void loadActivity(events.length)}
            disabled={loading || loadingMore}
            className="inline-flex h-9 w-full items-center justify-center gap-2 border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-wait disabled:text-slate-400"
          >
            {loadingMore ? <Loader2 size={14} className="animate-spin" /> : null}
            {loadingMore ? "Loading..." : "Load more activity"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

const DATA_ADMIN_FILE_PAGE_SIZE = 25;

function DataAdminPanel() {
  const [overview, setOverview] = useState<AdminDataOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadData(fileOffset = overview?.filePage.offset ?? 0) {
    setLoading(true);
    setError("");
    const response = await fetch(`/api/admin/data?fileLimit=${DATA_ADMIN_FILE_PAGE_SIZE}&fileOffset=${fileOffset}`);
    const body = (await response.json().catch(() => null)) as { data?: AdminDataOverview; error?: string } | null;
    setLoading(false);
    if (!response.ok) {
      setError(body?.error ?? "Unable to load data overview.");
      return;
    }
    setOverview(body?.data ?? null);
  }

  useEffect(() => {
    let active = true;
    fetch(`/api/admin/data?fileLimit=${DATA_ADMIN_FILE_PAGE_SIZE}&fileOffset=0`)
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { data?: AdminDataOverview; error?: string } | null;
        if (!active) return;
        setLoading(false);
        if (!response.ok) {
          setError(body?.error ?? "Unable to load data overview.");
          return;
        }
        setOverview(body?.data ?? null);
      })
      .catch(() => {
        if (!active) return;
        setLoading(false);
        setError("Unable to load data overview.");
      });
    return () => {
      active = false;
    };
  }, []);

  const metricGroups = overview
    ? [
        {
          title: "Records",
          rows: [
            { label: "Users", value: overview.counts.users.toLocaleString() },
            { label: "Notebooks", value: overview.counts.notebooks.toLocaleString() },
            { label: "Pages", value: overview.counts.pages.toLocaleString() },
          ],
        },
        {
          title: "Attachments",
          rows: [
            { label: "Attachment records", value: overview.counts.attachments.toLocaleString() },
            { label: "Attachment data", value: formatBytes(overview.storage.attachmentBytes) },
            { label: "Missing files", value: overview.storage.missingUploadCount.toLocaleString() },
          ],
        },
        {
          title: "Upload storage",
          rows: [
            { label: "Files on disk", value: overview.storage.uploadFileCount.toLocaleString() },
            { label: "Disk usage", value: formatBytes(overview.storage.uploadBytes) },
            { label: "Orphan files", value: overview.storage.orphanUploadCount.toLocaleString() },
            { label: "Orphan storage", value: formatBytes(overview.storage.orphanUploadBytes) },
          ],
        },
      ]
    : [];
  const filePage = overview?.filePage;
  const fileStart = filePage && filePage.total > 0 ? filePage.offset + 1 : 0;
  const fileEnd = filePage ? Math.min(filePage.offset + overview.files.length, filePage.total) : 0;
  const canPageBackward = Boolean(filePage && filePage.offset > 0);
  const canPageForward = Boolean(filePage && filePage.offset + filePage.limit < filePage.total);

  return (
    <section className="max-w-6xl border border-slate-200 bg-white">
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
        <div className="flex items-start gap-3">
          <div className="grid size-10 place-items-center border border-slate-200 bg-slate-50 text-slate-600">
            <Database size={21} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Data</h2>
          </div>
        </div>
        <button onClick={() => void loadData()} className="h-9 border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-50">Refresh</button>
      </div>

      {error ? <p className="m-5 border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      {loading ? <p className="p-5 text-sm text-slate-500">Loading data...</p> : null}

      {!loading && overview ? (
        <>
          <div className="grid gap-5 border-b border-slate-200 p-5 lg:grid-cols-3">
            {metricGroups.map((group) => <DataMetricGroup key={group.title} title={group.title} rows={group.rows} />)}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-5">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">Files</h3>
              <p className="mt-1 text-sm text-slate-500">
                Showing {fileStart.toLocaleString()}-{fileEnd.toLocaleString()} of {overview.filePage.total.toLocaleString()} attachment records.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => filePage && void loadData(Math.max(0, filePage.offset - filePage.limit))}
                disabled={!canPageBackward}
                className="h-8 border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => filePage && void loadData(filePage.offset + filePage.limit)}
                disabled={!canPageForward}
                className="h-8 border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">File</th>
                  <th className="px-4 py-3 font-semibold">Page</th>
                  <th className="px-4 py-3 font-semibold">Notebook</th>
                  <th className="px-4 py-3 font-semibold">Type</th>
                  <th className="px-4 py-3 text-right font-semibold">Size</th>
                  <th className="px-4 py-3 font-semibold">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {overview.files.map((file) => (
                  <tr key={file.id}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-950">{file.originalName}</div>
                      <div className="mt-1 truncate font-mono text-xs text-slate-500">{file.storageKey}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{file.pageTitle}</div>
                      </td>
                    <td className="px-4 py-3">
                      <div className="text-slate-700">{file.notebookName}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="capitalize text-slate-700">{file.blockType}</div>
                      <div className="mt-1 text-xs text-slate-500">{file.mimeType}</div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{formatBytes(file.size)}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDateTime(file.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {overview.files.length === 0 ? <p className="p-5 text-sm text-slate-500">No attachments found.</p> : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

function DataMetricGroup({ title, rows }: { title: string; rows: Array<{ label: string; value: string }> }) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
      <dl className="mt-2 divide-y divide-slate-100 border-y border-slate-100 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[minmax(0,1fr)_minmax(96px,auto)] gap-4 py-2">
            <dt className="text-slate-500">{row.label}</dt>
            <dd className="text-left font-medium tabular-nums text-slate-950">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function AdminPasswordModal({ user, onCancel, onSaved }: { user: AdminUser; onCancel: () => void; onSaved: () => void }) {
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const disabled = submitting || !nextPassword || !confirmPassword;

  async function submitPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (nextPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    const response = await fetch(`/api/admin/users/${user.id}/password`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nextPassword }),
    });
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    setSubmitting(false);
    if (!response.ok) {
      setError(body?.error ?? "Password reset failed.");
      return;
    }
    onSaved();
  }

  return (
    <ModalFrame>
      <form onSubmit={(event) => void submitPassword(event)}>
        <h2 className="text-lg font-semibold text-white">Set temporary password</h2>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Update the password for <span className="font-semibold text-white">{user.email}</span>. Give them this password directly, then they can change it from their account page.
        </p>
        <div className="mt-5 grid gap-4">
          <label className="block text-sm font-medium text-slate-200">
            New password
            <input
              value={nextPassword}
              onChange={(event) => setNextPassword(event.target.value)}
              type="password"
              className="mt-2 h-10 w-full border border-white/10 bg-white/10 px-3 text-sm text-white outline-none focus:border-cyan-400"
              autoComplete="new-password"
            />
          </label>
          <p className="-mt-2 text-xs leading-5 text-slate-400">{passwordRequirementText}</p>
          <label className="block text-sm font-medium text-slate-200">
            Confirm password
            <input
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              type="password"
              className="mt-2 h-10 w-full border border-white/10 bg-white/10 px-3 text-sm text-white outline-none focus:border-cyan-400"
              autoComplete="new-password"
            />
          </label>
        </div>
        {error ? <p className="mt-4 border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="h-9 border border-white/10 px-3 text-sm text-slate-200 hover:bg-white/10">Cancel</button>
          <button type="submit" disabled={disabled} className="h-9 bg-cyan-500 px-3 text-sm font-medium text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400">
            {submitting ? "Saving" : "Set password"}
          </button>
        </div>
      </form>
    </ModalFrame>
  );
}

function filenameFromContentDisposition(disposition: string | null) {
  if (!disposition) return "";
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }
  const quotedMatch = disposition.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) return quotedMatch[1];
  const bareMatch = disposition.match(/filename=([^;]+)/i);
  return bareMatch?.[1]?.trim() ?? "";
}

function safeDownloadName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 90) || "page";
}

function EditorPane({ page, selectedProject, selectedNotebook, saving, pageLoading, canEdit, canManageLock, uploadInlineFile, onInlineAttachmentInserted, openSpreadsheet, openPresentation, deleteAttachment, patchSelectedPage, savePage, markUnsaved, setPageTags, tagSuggestions, setPageLocked, openFilePicker }: { page: PageEntry; selectedProject?: Project; selectedNotebook?: Notebook; saving: string; pageLoading: boolean; canEdit: boolean; canManageLock: boolean; uploadInlineFile: (file: File, blockType: BlockType) => Promise<Attachment | null>; onInlineAttachmentInserted: (attachment: Attachment, body: string) => void; openSpreadsheet: (attachment: InlineAttachmentAttrs, onSaved?: (attachment: InlineAttachmentAttrs) => void) => void; openPresentation: (attachment: InlineAttachmentAttrs) => void; deleteAttachment: (attachment: Attachment) => Promise<void>; patchSelectedPage: (patch: Partial<PageEntry>) => void; savePage: (patch: { title?: string; body?: string; status?: PageStatus }) => Promise<void>; markUnsaved: (body: string) => void; setPageTags: (tags: string[]) => Promise<void>; tagSuggestions: string[]; setPageLocked: (locked: boolean) => Promise<void>; openFilePicker: () => void }) {
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityEvents, setActivityEvents] = useState<AuditEvent[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityLoadingMore, setActivityLoadingMore] = useState(false);
  const [activityHasMore, setActivityHasMore] = useState(false);
  const [activityError, setActivityError] = useState("");
  const [commentThreads, setCommentThreads] = useState<PageCommentThread[]>([]);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState("");
  const [selectedCommentThreadId, setSelectedCommentThreadId] = useState("");
  const [commentThreadToRemove, setCommentThreadToRemove] = useState("");
  const [printPage, setPrintPage] = useState<PageEntry | null>(null);
  const [printContent, setPrintContent] = useState<JSONContent[] | undefined>(undefined);
  const [exportingPage, setExportingPage] = useState<"pdf" | "archive" | null>(null);
  const attachmentCount = page.attachmentCount ?? page.attachments.length;
  const attachmentLabel = `${attachmentCount} file${attachmentCount === 1 ? "" : "s"}`;
  const color = projectColor(selectedNotebook ?? selectedProject);
  const locked = Boolean(page.lockedAt);
  const titleFieldRef = useRef<HTMLTextAreaElement>(null);

  function resizeTitleField(element: HTMLTextAreaElement | null) {
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }

  useEffect(() => {
    resizeTitleField(titleFieldRef.current);
  }, [page.id, page.title]);

  useEffect(() => {
    setCommentThreads([]);
    setCommentsError("");
    setSelectedCommentThreadId("");
    void loadComments();
  }, [page.id]);

  useEffect(() => {
    if (!printPage) return;

    function clearPrintPage() {
      setPrintPage(null);
      setPrintContent(undefined);
    }

    document.body.classList.add("novo-printing");
    window.addEventListener("afterprint", clearPrintPage);
    return () => {
      document.body.classList.remove("novo-printing");
      window.removeEventListener("afterprint", clearPrintPage);
    };
  }, [printPage]);

  useEffect(() => {
    const element = titleFieldRef.current;
    const container = element?.parentElement;
    if (!element || !container) return;

    function handleResize() {
      resizeTitleField(element);
    }

    handleResize();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }

    const observer = new ResizeObserver(handleResize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [page.id]);

  async function loadActivity(offset: number) {
    const append = offset > 0;
    if (append) setActivityLoadingMore(true);
    else setActivityLoading(true);
    setActivityError("");
    const response = await fetch(`/api/pages/${page.id}/activity?limit=${PAGE_ACTIVITY_PAGE_SIZE}&offset=${offset}`);
    const body = (await response.json().catch(() => null)) as { events?: AuditEvent[]; hasMore?: boolean; error?: string } | null;
    if (append) setActivityLoadingMore(false);
    else setActivityLoading(false);
    if (!response.ok) {
      setActivityError(body?.error ?? "Could not load activity.");
      return;
    }
    setActivityEvents((current) => append ? [...current, ...(body?.events ?? [])] : body?.events ?? []);
    setActivityHasMore(Boolean(body?.hasMore));
  }

  async function openActivity() {
    setActivityOpen(true);
    await loadActivity(0);
  }

  async function loadComments() {
    setCommentsLoading(true);
    setCommentsError("");
    const response = await fetch(`/api/pages/${page.id}/comments`);
    const body = (await response.json().catch(() => null)) as { threads?: PageCommentThread[]; error?: string } | null;
    setCommentsLoading(false);
    if (!response.ok) {
      setCommentsError(body?.error ?? "Could not load comments.");
      return;
    }
    setCommentThreads(body?.threads ?? []);
  }

  function replaceCommentThread(thread: PageCommentThread) {
    setCommentThreads((current) => {
      const exists = current.some((candidate) => candidate.id === thread.id);
      const next = exists ? current.map((candidate) => candidate.id === thread.id ? thread : candidate) : [thread, ...current];
      return next.sort(compareCommentThreads);
    });
    setSelectedCommentThreadId(thread.id);
    setCommentsOpen(true);
  }

  async function createComment(input: { selectedText: string; body: string }) {
    const response = await fetch(`/api/pages/${page.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = (await response.json().catch(() => null)) as { thread?: PageCommentThread; error?: string } | null;
    if (!response.ok || !body?.thread) {
      throw new Error(body?.error ?? "Could not add comment.");
    }
    replaceCommentThread(body.thread);
    return body.thread;
  }

  async function addCommentReply(threadId: string, reply: string) {
    const response = await fetch(`/api/comments/${threadId}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: reply }),
    });
    const body = (await response.json().catch(() => null)) as { thread?: PageCommentThread; error?: string } | null;
    if (!response.ok || !body?.thread) throw new Error(body?.error ?? "Could not add reply.");
    replaceCommentThread(body.thread);
  }

  async function deleteCommentThread(threadId: string) {
    const response = await fetch(`/api/comments/${threadId}`, { method: "DELETE" });
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) throw new Error(body?.error ?? "Could not delete comment.");
    setCommentThreads((current) => current.filter((thread) => thread.id !== threadId));
    setSelectedCommentThreadId("");
    setCommentsOpen(false);
    setCommentThreadToRemove(threadId);
  }

  function printCurrentPage(selection?: { content: JSONContent[] }) {
    openPagePrintDialog(selection);
  }

  async function downloadPageExport(format: "pdf" | "archive") {
    if (exportingPage) return;
    setExportingPage(format);
    try {
      const response = await fetch(`/api/pages/${page.id}/export/${format}`);
      if (!response.ok) throw new Error(`Export failed with ${response.status}`);
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition");
      const fallbackName = `${safeDownloadName(page.title || "page")}.${format === "pdf" ? "pdf" : "zip"}`;
      const filename = filenameFromContentDisposition(disposition) || fallbackName;
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
      window.alert("Export failed. Please try again.");
    } finally {
      setExportingPage(null);
    }
  }

  function openPagePrintDialog(selection?: { content: JSONContent[] }) {
    document.body.classList.add("novo-printing");
    setPrintContent(selection?.content);
    setPrintPage({
      ...page,
      attachments: [...page.attachments],
      tags: [...page.tags],
    });
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => window.print());
    });
  }

  return (
    <>
      <section className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-white">
        <header className="border-b border-slate-200 px-6 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex min-w-0 flex-1 items-start gap-1.5">
              {locked ? <Lock size={16} strokeWidth={2.2} className="mt-1.5 shrink-0 text-slate-500" aria-label="Locked page" /> : null}
              <textarea
                ref={titleFieldRef}
                rows={1}
                value={page.title}
                readOnly={!canEdit}
                onChange={(event) => {
                  if (!canEdit) return;
                  const title = event.target.value.replace(/\s*\n+\s*/g, " ");
                  patchSelectedPage({ title });
                  resizeTitleField(event.currentTarget);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  event.currentTarget.blur();
                }}
                onBlur={(event) => canEdit && void savePage({ title: event.target.value })}
                className={`min-w-0 flex-1 resize-none overflow-hidden break-words bg-transparent py-1 text-4xl font-semibold leading-tight tracking-normal text-slate-950 outline-none [overflow-wrap:anywhere] ${canEdit ? "" : "cursor-default"}`}
              />
            </div>
            {saving ? <span className="shrink-0 px-2 py-0.5 text-xs" style={{ backgroundColor: colorWithAlpha(color, 0.1), color }}>{saving}</span> : null}
            <button
              type="button"
              onClick={() => void openActivity()}
              className="grid size-8 shrink-0 place-items-center border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-950"
              title="Page activity"
              aria-label="Page activity"
            >
              <History size={16} />
            </button>
          </div>
          <PageTagsBar tags={page.tags} canEdit={canEdit} setPageTags={setPageTags} tagSuggestions={tagSuggestions} />
          <div className="flex items-end justify-between gap-3">
            <PageStatusRow
              status={page.status}
              canEdit={canEdit}
              setStatus={(status) => {
                if (!canEdit) return;
                patchSelectedPage({ status });
                void savePage({ status });
              }}
            />
            <PageLockControl locked={locked} canManage={canManageLock} setLocked={setPageLocked} />
          </div>
        </header>
        <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden bg-white px-6 pb-6 pt-4">
          {pageLoading ? (
            <div className="grid min-h-[24rem] place-items-center border border-slate-200 bg-white text-sm text-slate-500">
              <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" />Loading page...</span>
            </div>
          ) : (
            <RichTextEditor
              key={`${page.id}-${canEdit ? "edit" : "read"}`}
              pageId={page.id}
              value={page.body}
              onChange={(body) => {
                if (canEdit) markUnsaved(body);
              }}
              onBlur={(body) => void savePage({ body })}
              uploadInlineFile={uploadInlineFile}
              onInlineAttachmentInserted={onInlineAttachmentInserted}
              openSpreadsheet={openSpreadsheet}
              openPresentation={openPresentation}
              readOnly={!canEdit}
              onPrint={printCurrentPage}
              exporting={Boolean(exportingPage)}
              onExportPdf={() => downloadPageExport("pdf")}
              onExportArchive={() => downloadPageExport("archive")}
              onCreateComment={canEdit ? createComment : undefined}
              onSelectCommentThread={(threadId) => {
                setSelectedCommentThreadId(threadId);
                setCommentsOpen(true);
              }}
              commentThreadToRemove={commentThreadToRemove}
              onCommentThreadRemoved={(body) => {
                setCommentThreadToRemove("");
                if (body) void savePage({ body });
              }}
            />
          )}
          <div className="mt-4 border border-slate-200 bg-slate-50 p-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setAttachmentsOpen((open) => !open)}
              className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-800 hover:text-slate-950"
              aria-expanded={attachmentsOpen}
            >
              {attachmentsOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <Paperclip size={16} />
              <span>Attachments</span>
              <span className="bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">{attachmentLabel}</span>
            </button>
            {canEdit ? <button onClick={openFilePicker} className="inline-flex h-7 items-center gap-1 border border-slate-300 bg-white px-2 text-sm text-slate-700 hover:bg-slate-100"><Plus size={14} />File</button> : null}
            </div>
            {attachmentsOpen ? (
              pageLoading ? (
                <p className="mt-3 border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">Loading files...</p>
              ) : page.attachments.length ? (
                <div className="mt-3 grid max-h-80 gap-2 overflow-y-auto scroll-contained pr-1">
                  {page.attachments.map((attachment, index) => <AttachmentRow key={attachment.id} index={index + 1} attachment={attachment} canEdit={canEdit} onDelete={() => void deleteAttachment(attachment)} />)}
                </div>
              ) : (
                <p className="mt-3 border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">No files attached yet.</p>
              )
            ) : null}
          </div>
        </div>
      </section>
      {activityOpen ? (
        <PageActivityDrawer
          events={activityEvents}
          loading={activityLoading}
          loadingMore={activityLoadingMore}
          hasMore={activityHasMore}
          error={activityError}
          onRefresh={openActivity}
          onLoadMore={() => loadActivity(activityEvents.length)}
          onClose={() => setActivityOpen(false)}
        />
      ) : null}
      {commentsOpen ? (
        <PageCommentPopover
          threads={commentThreads}
          loading={commentsLoading}
          error={commentsError}
          selectedThreadId={selectedCommentThreadId}
          canEdit={canEdit}
          onRefresh={loadComments}
          onReply={addCommentReply}
          onDelete={deleteCommentThread}
          onClose={() => setCommentsOpen(false)}
        />
      ) : null}
      {printPage && typeof document !== "undefined"
        ? createPortal(<PrintPageDocument page={printPage} notebook={selectedNotebook} content={printContent} />, document.body)
        : null}
    </>
  );
}

function PageActivityDrawer({ events, loading, loadingMore, hasMore, error, onRefresh, onLoadMore, onClose }: { events: AuditEvent[]; loading: boolean; loadingMore: boolean; hasMore: boolean; error: string; onRefresh: () => Promise<void>; onLoadMore: () => Promise<void>; onClose: () => void }) {
  return (
    <aside className="fixed inset-y-0 right-0 z-50 flex w-[420px] max-w-[calc(100vw-32px)] flex-col overflow-x-hidden border-l border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <h2 className="text-lg font-semibold text-slate-950">Activity</h2>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void onRefresh()} disabled={loading} className="inline-flex h-8 items-center gap-2 border border-slate-300 bg-white px-3 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-950 disabled:cursor-wait disabled:text-slate-400" aria-label="Refresh activity">
            {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            <span>Refresh</span>
          </button>
          <button type="button" onClick={onClose} className="grid size-8 place-items-center border border-slate-300 bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-950" aria-label="Close activity">
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-5">
        {error ? <p className="mb-4 border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
        {loading && !events.length ? (
          <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" />Loading activity...</div>
        ) : null}
        {!loading && !events.length && !error ? <p className="text-sm text-slate-500">No activity recorded for this page yet.</p> : null}
        <div className="space-y-5">
          {events.map((event) => (
            <div key={event.id} className="grid grid-cols-[32px_minmax(0,1fr)] gap-3">
              <div className="grid size-8 place-items-center rounded-full bg-slate-950 text-xs font-semibold text-white">{auditInitials(event)}</div>
              <div className="min-w-0">
                <p className="whitespace-normal break-words text-sm leading-5 text-slate-700 [overflow-wrap:anywhere]">
                  <span className="font-semibold text-slate-950">{auditActorName(event)}</span>{" "}
                  {event.summary}
                </p>
                <p className="mt-1 text-xs font-medium text-blue-700">{formatDateTime(event.updatedAt)}</p>
              </div>
            </div>
          ))}
        </div>
        {hasMore ? (
          <button
            type="button"
            onClick={() => void onLoadMore()}
            disabled={loading || loadingMore}
            className="mt-5 inline-flex h-9 w-full items-center justify-center gap-2 border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-wait disabled:text-slate-400"
          >
            {loadingMore ? <Loader2 size={14} className="animate-spin" /> : null}
            {loadingMore ? "Loading..." : "Load more activity"}
          </button>
        ) : null}
      </div>
    </aside>
  );
}

function PageCommentPopover({ threads, loading, error, selectedThreadId, canEdit, onRefresh, onReply, onDelete, onClose }: { threads: PageCommentThread[]; loading: boolean; error: string; selectedThreadId: string; canEdit: boolean; onRefresh: () => Promise<void>; onReply: (threadId: string, reply: string) => Promise<void>; onDelete: (threadId: string) => Promise<void>; onClose: () => void }) {
  const [reply, setReply] = useState("");
  const [pending, setPending] = useState("");
  const [localError, setLocalError] = useState("");
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const selectedThread = threads.find((thread) => thread.id === selectedThreadId) ?? null;

  useEffect(() => {
    if (!selectedThreadId) return;

    function positionPopover() {
      const width = 360;
      const margin = 16;
      const selector = `[data-comment-thread-id="${CSS.escape(selectedThreadId)}"]`;
      const mark = document.querySelector<HTMLElement>(selector);
      const rect = mark?.getBoundingClientRect();
      const fallbackTop = 150;
      const fallbackLeft = window.innerWidth - width - margin;
      if (!rect) {
        setPosition({
          top: Math.max(margin, Math.min(fallbackTop, window.innerHeight - 180)),
          left: Math.max(margin, fallbackLeft),
        });
        return;
      }

      const placeRight = rect.right + margin + width <= window.innerWidth - margin;
      const left = placeRight ? rect.right + margin : Math.max(margin, rect.left - width - margin);
      const top = Math.max(margin, Math.min(rect.top - 12, window.innerHeight - 260));
      setPosition({ top, left });
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    function closeOnOutsidePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (popoverRef.current?.contains(target)) return;
      if (target.closest("[data-comment-thread-id]")) return;
      onClose();
    }

    positionPopover();
    window.addEventListener("resize", positionPopover);
    window.addEventListener("scroll", positionPopover, true);
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointerDown);
    return () => {
      window.removeEventListener("resize", positionPopover);
      window.removeEventListener("scroll", positionPopover, true);
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
    };
  }, [onClose, selectedThreadId]);

  useEffect(() => {
    setReply("");
    setLocalError("");
  }, [selectedThreadId]);

  async function submitReply() {
    if (!selectedThread || pending) return;
    const body = reply.trim();
    if (!body) return;
    setPending("reply");
    setLocalError("");
    try {
      await onReply(selectedThread.id, body);
      setReply("");
    } catch (replyError) {
      setLocalError(replyError instanceof Error ? replyError.message : "Could not add reply.");
    } finally {
      setPending("");
    }
  }

  async function deleteSelectedThread() {
    if (!selectedThread || pending) return;
    setPending("delete");
    setLocalError("");
    try {
      await onDelete(selectedThread.id);
    } catch (deleteError) {
      setLocalError(deleteError instanceof Error ? deleteError.message : "Could not delete comment.");
    } finally {
      setPending("");
    }
  }

  if (!position) return null;

  return (
    createPortal(
      <div ref={popoverRef} className="fixed z-[1000] w-[360px] max-w-[calc(100vw-32px)] border border-slate-200 bg-white shadow-2xl" style={{ top: position.top, left: position.left }}>
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <MessageSquare size={16} className="text-amber-600" />
              <h2 className="text-sm font-semibold text-slate-950">Comment</h2>
            </div>
            {selectedThread ? <p className="mt-1 truncate text-xs text-slate-500">{selectedThread.selectedText || "Commented text was removed"}</p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={() => void onRefresh()} disabled={loading} className="grid size-7 place-items-center border border-transparent text-slate-500 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-wait disabled:text-slate-300" aria-label="Refresh comment">
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            </button>
            {selectedThread && canEdit ? (
              <button type="button" onClick={() => void deleteSelectedThread()} disabled={Boolean(pending)} className="grid size-7 place-items-center border border-transparent text-slate-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-wait disabled:text-slate-300" aria-label="Delete comment">
                {pending === "delete" ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={15} />}
              </button>
            ) : null}
            <button type="button" onClick={onClose} className="grid size-7 place-items-center border border-transparent text-slate-500 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900" aria-label="Close comment">
              <X size={15} />
            </button>
          </div>
        </div>
        <div className="max-h-[420px] overflow-y-auto p-4">
          {error ? <p className="mb-3 border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
          {localError ? <p className="mb-3 border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{localError}</p> : null}
          {loading && !selectedThread ? <p className="inline-flex items-center gap-2 text-sm text-slate-500"><Loader2 size={15} className="animate-spin" />Loading comment...</p> : null}
          {!loading && !selectedThread ? <p className="text-sm text-slate-500">This comment could not be found.</p> : null}
          {selectedThread ? (
            <>
              <div className="space-y-4">
                {selectedThread.comments.map((comment) => (
                  <div key={comment.id} className="grid grid-cols-[32px_minmax(0,1fr)] gap-3">
                    <div className="grid size-8 place-items-center rounded-full bg-slate-950 text-xs font-semibold text-white">{userInitials({ firstName: comment.userFirstName, lastName: comment.userLastName, email: comment.userEmail })}</div>
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                        <p className="text-sm font-semibold text-slate-950">{commentAuthorName(comment)}</p>
                        <p className="text-xs font-medium text-blue-700">{formatDateTime(comment.createdAt)}</p>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-slate-700">{comment.body}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 border-t border-slate-200 pt-3">
                {canEdit ? (
                  <>
                    <textarea value={reply} onChange={(event) => setReply(event.target.value)} rows={2} placeholder="Reply..." className="w-full resize-none border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cyan-500" />
                    <div className="mt-2 flex justify-end">
                      <button type="button" onClick={() => void submitReply()} disabled={Boolean(pending) || !reply.trim()} className="inline-flex h-8 items-center gap-1.5 bg-slate-950 px-3 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300">
                        {pending === "reply" ? <Loader2 size={13} className="animate-spin" /> : null}
                        Reply
                      </button>
                    </div>
                  </>
                ) : <p className="text-sm text-slate-500">You can view this comment, but you do not have edit access to reply.</p>}
              </div>
            </>
          ) : null}
        </div>
      </div>,
      document.body,
    )
  );
}

function compareCommentThreads(a: PageCommentThread, b: PageCommentThread) {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

function commentThreadActor(thread: PageCommentThread) {
  return [thread.createdByFirstName, thread.createdByLastName].filter(Boolean).join(" ") || thread.createdByEmail || "Unknown user";
}

function commentAuthorName(comment: PageCommentThread["comments"][number]) {
  return [comment.userFirstName, comment.userLastName].filter(Boolean).join(" ") || comment.userEmail || "Unknown user";
}

function auditActorName(event: AuditEvent) {
  const firstName = event.actorFirstName.trim();
  const lastInitial = event.actorLastName.trim()[0];
  if (firstName && lastInitial) return `${firstName} ${lastInitial.toUpperCase()}.`;
  return firstName || event.actorLastName.trim() || event.actorEmail || "Unknown user";
}

function adminActivitySummary(event: AuditEvent) {
  if (event.action === "notebook.deleted" && typeof event.metadata?.name === "string" && event.metadata.name.trim()) {
    return `deleted notebook "${event.metadata.name.trim()}"`;
  }
  return event.summary;
}

function AdminActivityContext({ event }: { event: AuditEvent }) {
  const pageTitle = event.pageTitle?.trim();
  const notebookName = event.notebookName?.trim();
  if (pageTitle) {
    return (
      <>
        <a href={`/?page=${encodeURIComponent(event.pageId)}`} className="text-slate-600 underline-offset-2 hover:text-blue-700 hover:underline">
          {pageTitle}
        </a>
        {notebookName ? <span> · {notebookName}</span> : null}
      </>
    );
  }
  if (notebookName) return <>{notebookName}</>;
  return <>No longer attached to an active page or notebook</>;
}

function auditInitials(event: AuditEvent) {
  return userInitials({ firstName: event.actorFirstName, lastName: event.actorLastName, email: event.actorEmail });
}

function PageLockControl({ locked, canManage, setLocked }: { locked: boolean; canManage: boolean; setLocked: (locked: boolean) => Promise<void> }) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const Icon = locked ? Lock : Unlock;
  if (!canManage) return null;
  async function toggleLocked() {
    if (pending) return;
    setPending(true);
    setFailed(false);
    try {
      await setLocked(!locked);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }
  return (
    <button
      type="button"
      onClick={() => void toggleLocked()}
      disabled={pending}
      className={`inline-flex h-7 shrink-0 items-center gap-1.5 border bg-white px-2 text-xs font-medium hover:bg-slate-100 disabled:cursor-wait ${failed ? "border-rose-300 text-rose-700" : "border-slate-300 text-slate-700"}`}
      title={locked ? "Unlock page" : "Lock page"}
      aria-label={locked ? "Unlock page" : "Lock page"}
    >
      {pending ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />}
      <span>{pending ? (locked ? "Unlocking" : "Locking") : failed ? "Lock failed" : locked ? "Unlock page" : "Lock page"}</span>
    </button>
  );
}

function PageTagsBar({ tags, canEdit, setPageTags, tagSuggestions }: { tags: string[]; canEdit: boolean; setPageTags: (tags: string[]) => Promise<void>; tagSuggestions: string[] }) {
  const [tagInput, setTagInput] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const [highlightedSuggestion, setHighlightedSuggestion] = useState(0);
  const normalizedTags = useMemo(() => normalizeTagList(tags), [tags]);
  const visibleSuggestions = useMemo(() => {
    if (!canEdit) return [];
    const query = tagInput.trim().toLowerCase();
    const currentTagKeys = new Set(normalizedTags.map((tag) => tag.toLowerCase()));
    return tagSuggestions
      .filter((tag) => !currentTagKeys.has(tag.toLowerCase()))
      .filter((tag) => !query || tag.toLowerCase().includes(query))
      .slice(0, 12);
  }, [canEdit, normalizedTags, tagInput, tagSuggestions]);
  const suggestionsOpen = inputFocused && visibleSuggestions.length > 0;

  function addTag(value: string) {
    if (!canEdit) return;
    const trimmed = value.trim().replace(/\s+/g, " ");
    if (!trimmed) return;
    const canonicalTag = tagSuggestions.find((tag) => tag.toLowerCase() === trimmed.toLowerCase()) ?? trimmed;
    const nextTags = normalizeTagList([...normalizedTags, canonicalTag]);
    setTagInput("");
    if (nextTags.length !== normalizedTags.length) void setPageTags(nextTags);
  }

  function addTagInput() {
    addTag(tagInput);
  }

  function selectSuggestion(tag: string) {
    addTag(tag);
    setInputFocused(false);
  }

  function removeTag(tag: string) {
    if (!canEdit) return;
    void setPageTags(normalizedTags.filter((candidate) => candidate !== tag));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && suggestionsOpen) {
      event.preventDefault();
      setHighlightedSuggestion((index) => (index + 1) % visibleSuggestions.length);
      return;
    }
    if (event.key === "ArrowUp" && suggestionsOpen) {
      event.preventDefault();
      setHighlightedSuggestion((index) => (index - 1 + visibleSuggestions.length) % visibleSuggestions.length);
      return;
    }
    if ((event.key === "Tab" || event.key === "Enter") && suggestionsOpen && visibleSuggestions[highlightedSuggestion]) {
      event.preventDefault();
      selectSuggestion(visibleSuggestions[highlightedSuggestion]);
      return;
    }
    if (event.key === "Escape" && suggestionsOpen) {
      event.preventDefault();
      setInputFocused(false);
      return;
    }
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addTagInput();
    }
  }

  return (
    <div className="mt-2 flex min-h-8 min-w-0 flex-wrap items-center gap-1.5">
      <Tag size={15} className="mr-1 shrink-0 text-slate-400" />
      {normalizedTags.map((tag) => (
        <span key={tag} className="inline-flex h-7 max-w-full min-w-0 items-center gap-1 border border-slate-200 bg-slate-100 px-2 text-sm text-slate-700">
          <span className="min-w-0 truncate">{tag}</span>
          {canEdit ? <button type="button" onClick={() => removeTag(tag)} className="-mr-1 grid size-5 shrink-0 place-items-center text-slate-400 hover:text-slate-900" aria-label={`Remove ${tag} tag`}>
            <X size={13} />
          </button> : null}
        </span>
      ))}
      {canEdit ? (
        <div className="relative min-w-44 flex-1">
          <input
            value={tagInput}
            onChange={(event) => {
              setTagInput(event.target.value);
              setInputFocused(true);
              setHighlightedSuggestion(0);
            }}
            onFocus={() => {
              setInputFocused(true);
              setHighlightedSuggestion(0);
            }}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              addTagInput();
              setInputFocused(false);
            }}
            className="h-7 w-full border-0 bg-transparent px-1 text-sm text-slate-700 outline-none placeholder:text-slate-400"
            placeholder="Type to add..."
            role="combobox"
            aria-expanded={suggestionsOpen}
            aria-controls="page-tag-suggestions"
          />
          {suggestionsOpen ? (
            <div id="page-tag-suggestions" role="listbox" className="absolute left-0 top-full z-30 mt-1 max-h-60 w-72 overflow-y-auto border border-slate-200 bg-white py-1 text-sm shadow-lg">
              {visibleSuggestions.map((tag, index) => (
                <button
                  key={tag}
                  type="button"
                  role="option"
                  aria-selected={index === highlightedSuggestion}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setHighlightedSuggestion(index)}
                  onClick={() => selectSuggestion(tag)}
                  className={`flex h-8 w-full cursor-pointer items-center px-3 text-left ${index === highlightedSuggestion ? "bg-slate-100 text-slate-950" : "text-slate-700 hover:bg-slate-50 hover:text-slate-950"}`}
                >
                  <span className="min-w-0 truncate">{tag}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PageStatusRow({ status, canEdit, setStatus }: { status: PageStatus; canEdit: boolean; setStatus: (status: PageStatus) => void }) {
  return (
    <div className="mt-1 flex min-h-8 flex-wrap items-center gap-1.5 text-sm">
      <Flag size={15} className="mr-1 shrink-0 text-slate-400" />
      <div className="inline-flex h-8 items-center gap-1.5 rounded-full border border-slate-300 bg-white pl-3 pr-1 hover:border-slate-400 focus-within:border-cyan-500">
        <StatusDot status={status} />
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as PageStatus)}
          disabled={!canEdit}
          className="h-7 w-36 cursor-pointer border-0 bg-transparent px-0 text-sm font-medium text-slate-700 outline-none disabled:cursor-not-allowed disabled:text-slate-500"
          aria-label="Page status"
        >
          {PAGE_STATUS_OPTIONS.map((option) => <option key={option.label} value={option.value}>{option.label}</option>)}
        </select>
      </div>
    </div>
  );
}

function AttachmentRow({ attachment, index, canEdit, onDelete }: { attachment: Attachment; index: number; canEdit: boolean; onDelete: () => void }) {
  const Icon = blockIcons[attachment.blockType];

  function handleDragStart(event: React.DragEvent<HTMLDivElement>) {
    if (!canEdit) return;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(INLINE_ATTACHMENT_DRAG_TYPE, JSON.stringify(attachmentToInlineAttrs(attachment)));
    event.dataTransfer.setData("text/plain", attachment.originalName);
  }

  return (
    <div
      draggable={canEdit}
      onDragStart={handleDragStart}
      className={`flex items-center justify-between gap-4 border border-slate-200 bg-white px-3 py-2 ${canEdit ? "cursor-grab active:cursor-grabbing" : ""}`}
      title={canEdit ? "Drag into the page to place this attachment inline" : undefined}
    >
      <div className="flex min-w-0 items-center gap-2">
        {canEdit ? <GripVertical className="shrink-0 text-slate-400" size={15} aria-hidden="true" /> : null}
        <span className="w-5 shrink-0 text-center text-xs font-medium tabular-nums text-slate-400">{index}</span>
        <Icon className="shrink-0 text-slate-500" size={17} />
        <div className="min-w-0">
          <div className="truncate text-sm text-slate-800">{attachment.originalName}</div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
            <span>{attachment.blockType}</span>
            <span>{Math.max(1, Math.round(attachment.size / 1024))} KB</span>
            <span>Added {formatAttachmentDate(attachment.createdAt)}</span>
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-xs">
        <a href={`/api/attachments/${attachment.id}/download`} className="inline-flex h-8 items-center gap-1 border border-slate-300 bg-white px-2 text-slate-700 hover:bg-slate-100"><Download size={13} />Download</a>
        {canEdit ? <button onClick={onDelete} className="grid size-8 place-items-center border border-slate-300 bg-white text-slate-500 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700" title="Delete attachment"><X size={14} /></button> : null}
      </div>
    </div>
  );
}

function formatAttachmentDate(value: string) {
  const parsed = Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(parsed)) return value;
  const date = new Date(parsed);
  return date.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
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

function SidebarSection({ label, onAdd, action, collapsed, onToggle }: { label: string; onAdd?: () => void; action?: React.ReactNode; collapsed?: boolean; onToggle?: () => void }) {
  return (
    <div className="sidebar-wide px-4">
      <div className="flex min-w-0 items-center justify-between gap-2 px-2 text-xs font-semibold text-slate-500">
        {onToggle ? (
          <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs font-semibold text-slate-500 hover:text-slate-300" title={collapsed ? `Expand ${label}` : `Collapse ${label}`}>
            {collapsed ? <ChevronRight size={13} className="shrink-0" /> : <ChevronDown size={13} className="shrink-0" />}
            <span className="min-w-0 truncate">{label}</span>
          </button>
        ) : (
          <span className="min-w-0 truncate">{label}</span>
        )}
        <span className="flex shrink-0 items-center gap-1">
          {action}
          {onAdd ? <button onClick={onAdd} className="grid size-6 shrink-0 place-items-center text-slate-400 hover:bg-white/10 hover:text-white" title={`Create ${label.toLowerCase()}`}><Plus size={14} /></button> : null}
        </span>
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function projectColor(project: Pick<Project | Notebook, "color"> | undefined) {
  return normalizeColor(project?.color);
}

function canEditNotebook(user: AppUser | undefined, notebook: Notebook | undefined) {
  if (!user || !notebook) return false;
  return notebook.accessRole === "owner" || notebook.accessRole === "editor";
}

function userDisplayName(user: Pick<AppUser | ShareMember, "firstName" | "lastName" | "email">) {
  return `${user.firstName} ${user.lastName}`.trim() || user.email;
}

function userInitials(user: Pick<AppUser | ShareMember, "firstName" | "lastName" | "email">) {
  const nameParts = [user.firstName, user.lastName].filter(Boolean);
  if (nameParts.length) return nameParts.map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return (user.email || "?").slice(0, 2).toUpperCase();
}

const PAGE_CARD_TINT_ALPHA = 0.035;
const PAGE_CARD_ACTIVE_ALPHA = 0.075;

function pageCardTintStyle(value: string | undefined) {
  const color = normalizeColor(value);
  return {
    backgroundColor: colorWithAlpha(color, PAGE_CARD_TINT_ALPHA),
    borderColor: colorWithAlpha(color, 0.65),
  };
}

function pageCardActiveStyle(value: string | undefined) {
  const color = normalizeColor(value);
  return {
    backgroundColor: colorWithAlpha(color, PAGE_CARD_ACTIVE_ALPHA),
    borderColor: colorWithAlpha(color, 0.65),
  };
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

function readStoredNotebookSortKey() {
  return readStoredSortKey(NOTEBOOK_SORT_STORAGE_KEY, NOTEBOOK_SORT_OPTIONS, "updated");
}

function readStoredSortKey<T extends string>(storageKey: string, options: Array<{ key: T }>, fallback: T) {
  if (typeof window === "undefined") return fallback;
  try {
    const storedValue = window.localStorage.getItem(storageKey);
    return options.some((option) => option.key === storedValue) ? (storedValue as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredSortKey(storageKey: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, value);
  } catch {
    // Ignore private browsing / storage quota failures; sorting still works for the current session.
  }
}

function getPageStatusLabel(status: PageStatus) {
  return PAGE_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? "No status";
}

function StatusDot({ status }: { status: PageStatus }) {
  return <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: pageStatusColor(status) }} aria-hidden="true" />;
}

function pageStatusColor(status: PageStatus) {
  if (status === "Failed") return "#dc2626";
  if (status === "Needs review") return "#d97706";
  if (status === "Completed") return "#16a34a";
  if (status === "Working") return "#2563eb";
  return "#94a3b8";
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

function sortNotebooks(notebooks: Notebook[], sortKey: NotebookSortKey) {
  return notebooks
    .map((notebook, index) => ({ notebook, index }))
    .sort((left, right) => {
      if (sortKey === "title") {
        const titleCompare = left.notebook.name.localeCompare(right.notebook.name, undefined, { sensitivity: "base", numeric: true });
        return titleCompare || left.index - right.index;
      }

      const field = sortKey === "created" ? "createdAt" : "updatedAt";
      const timestampCompare = timestampForSort(right.notebook[field]) - timestampForSort(left.notebook[field]);
      return timestampCompare || left.index - right.index;
    })
    .map(({ notebook }) => notebook);
}

function timestampForSort(value: string) {
  if (value === "Just now") return Number.POSITIVE_INFINITY;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeTagList(tags: string[]) {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const tag of tags) {
    const value = tag.trim().replace(/\s+/g, " ");
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
  }
  return normalized;
}

function tagListsEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((tag, index) => tag === right[index]);
}

function normalizeColor(value: string | undefined) {
  return /^#[0-9a-f]{6}$/i.test(value ?? "") ? value!.toLowerCase() : "#0891b2";
}

function colorWithAlpha(value: string | undefined, alpha: number) {
  const color = normalizeColor(value).slice(1);
  const red = Number.parseInt(color.slice(0, 2), 16);
  const green = Number.parseInt(color.slice(2, 4), 16);
  const blue = Number.parseInt(color.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
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

function formatDateTime(value: string) {
  const parsed = Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(parsed)) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function capitalizeLabel(value: string) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}
