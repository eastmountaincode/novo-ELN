"use client";

import {
  Beaker,
  CalendarClock,
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
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
  Home as HomeIcon,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  MoreHorizontal,
  Notebook as NotebookIcon,
  Palette,
  Paperclip,
  Plus,
  Pencil,
  Search,
  Settings,
  Shield,
  SlidersHorizontal,
  Tag,
  Trash2,
  Users,
  X,
  UserCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PresentationModal } from "@/components/PresentationModal";
import { INLINE_ATTACHMENT_DRAG_TYPE, RichTextEditor, attachmentToInlineAttrs, type InlineAttachmentAttrs } from "@/components/RichTextEditor";
import { SpreadsheetModal } from "@/components/SpreadsheetModal";
import { bodyToEditorText } from "@/lib/editor";
import type { AccessRole, AdminDataOverview, AdminUser, AppUser, Attachment, BlockType, Notebook, PageEntry, PageStatus, Project, SearchResult, ShareMember, Workspace } from "@/lib/types";

const blockIcons: Record<BlockType, typeof ImageIcon> = {
  image: ImageIcon,
  sheet: FileSpreadsheet,
  pdf: FileText,
  slides: FileArchive,
  sequence: Beaker,
  file: FileImage,
};

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

const PAGE_SORT_OPTIONS: Array<{ key: PageSortKey; label: string }> = [
  { key: "updated", label: "Date updated" },
  { key: "created", label: "Date created" },
  { key: "title", label: "Title" },
];


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

type EnexImportJob = {
  id: string;
  state: "queued" | "running" | "canceling" | "canceled" | "succeeded" | "failed";
  error?: string;
  notebookId?: string;
  importedResources: number;
  workerCount: number;
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

export default function Home() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [authError, setAuthError] = useState("");
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<"signin" | "register">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(false);
  const [name, setName] = useState("");
  const [activeView, setActiveView] = useState<"home" | "projectHome" | "project" | "notebookSettings" | "account">("home");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedNotebookId, setSelectedNotebookId] = useState("");
  const [selectedPageId, setSelectedPageId] = useState("");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [saving, setSaving] = useState("");
  const [creatingPage, setCreatingPage] = useState(false);
  const [deletingPage, setDeletingPage] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_MIN_WIDTH);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [pagesWidth, setPagesWidth] = useState(340);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(new Set());
  const [accountOpen, setAccountOpen] = useState(false);
  const [projectMenuId, setProjectMenuId] = useState<string | null>(null);
  const [notebookMenuId, setNotebookMenuId] = useState<string | null>(null);
  const [pageMenuId, setPageMenuId] = useState<string | null>(null);
  const [projectPendingDelete, setProjectPendingDelete] = useState<Project | null>(null);
  const [notebookPendingDelete, setNotebookPendingDelete] = useState<Notebook | null>(null);
  const [pagePendingDelete, setPagePendingDelete] = useState<PageEntry | null>(null);
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);
  const [spreadsheetModal, setSpreadsheetModal] = useState<InlineAttachmentAttrs | null>(null);
  const [presentationModal, setPresentationModal] = useState<InlineAttachmentAttrs | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const spreadsheetSavedRef = useRef<((attachment: InlineAttachmentAttrs) => void) | null>(null);

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
    function updateViewportWidth() {
      setViewportWidth(window.innerWidth);
    }
    updateViewportWidth();
    window.addEventListener("resize", updateViewportWidth);
    return () => window.removeEventListener("resize", updateViewportWidth);
  }, []);

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
    setQuery("");
    setSearchResults([]);
    setSearchLoading(false);
  }, []);

  useEffect(() => {
    if (!searchOpen) return;
    const trimmed = query.trim();
    let active = true;
    const timeout = window.setTimeout(async () => {
      if (!trimmed) {
        setSearchResults([]);
        setSearchLoading(false);
        return;
      }

      setSearchLoading(true);
      const response = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}&limit=30`);
      if (!active) return;
      if (!response.ok) {
        setSearchResults([]);
        setSearchLoading(false);
        return;
      }
      const body = (await response.json()) as { results: SearchResult[] };
      setSearchResults(body.results);
      setSearchLoading(false);
    }, 180);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [query, searchOpen]);

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
    setAuthError("");
    const response = await fetch(authMode === "register" ? "/api/auth/register" : "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(authMode === "register" ? { email, name, password } : { email, password, rememberDevice }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setAuthError(body?.error ?? (authMode === "register" ? "Registration failed." : "Login failed."));
      return;
    }
    await refreshWorkspace();
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

  function patchSelectedPage(patch: Partial<PageEntry>) {
    if (!workspace || !selectedPage) return;
    const pageId = selectedPage.id;
    setWorkspace((current) => current ? {
      ...current,
      projects: current.projects.map((project) => ({
        ...project,
        notebooks: project.notebooks.map((notebook) => ({
          ...notebook,
          pages: notebook.pages.map((page) => (page.id === pageId ? { ...page, ...patch, updatedAt: "Just now" } : page)),
        })),
      })),
    } : current);
  }

  async function savePage(patch: { title?: string; body?: string; status?: PageStatus }) {
    if (!selectedPage) return;
    const pageId = selectedPage.id;
    setSaving("Saving");
    const response = await fetch(`/api/pages/${pageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setSaving(response.ok ? "Saved" : "Save failed");
    if (response.ok) patchSelectedPage({ ...patch, updatedAt: "Just now" });
  }

  async function setSelectedPageTags(tags: string[]) {
    if (!selectedPage) return;
    const normalizedTags = normalizeTagList(tags);
    patchSelectedPage({ tags: normalizedTags });
    setSaving("Saving tags");
    const response = await fetch(`/api/pages/${selectedPage.id}/tags`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: normalizedTags }),
    });
    setSaving(response.ok ? "Saved" : "Tag save failed");
    if (!response.ok) await refreshWorkspace({ projectId: selectedProject?.id, notebookId: selectedNotebook?.id, pageId: selectedPage.id });
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
    writePageUrl(null, "push");
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

  async function confirmPageDelete() {
    if (!pagePendingDelete || !selectedNotebook || deletingPage) return;
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

  async function confirmNotebookDelete() {
    if (!notebookPendingDelete) return;
    const response = await fetch(`/api/notebooks/${notebookPendingDelete.id}`, { method: "DELETE" });
    if (!response.ok) return;
    setNotebookPendingDelete(null);
    setSelectedNotebookId("");
    setSelectedPageId("");
    writePageUrl(null, "replace");
    await refreshWorkspace({ projectId: selectedProject?.id });
  }

  async function confirmProjectDelete() {
    if (!projectPendingDelete) return;
    const response = await fetch(`/api/projects/${projectPendingDelete.id}`, { method: "DELETE" });
    if (!response.ok) return;
    setProjectPendingDelete(null);
    setSelectedProjectId("");
    setSelectedNotebookId("");
    setSelectedPageId("");
    setActiveView("home");
    writePageUrl(null, "replace");
    await refreshWorkspace();
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
    if (!selectedNotebook || creatingPage) return;
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
    if (!file || !selectedPage) return;
    const form = new FormData();
    form.set("file", file);
    setSaving("Uploading");
    const response = await fetch(`/api/pages/${selectedPage.id}/attachments`, { method: "POST", body: form });
    setSaving(response.ok ? "Uploaded" : "Upload failed");
    if (response.ok) await refreshWorkspace({ projectId: selectedProject?.id, notebookId: selectedNotebook?.id, pageId: selectedPage.id });
  }

  async function deletePageAttachment(attachment: Attachment) {
    if (!selectedPage) return;
    const response = await fetch(`/api/attachments/${attachment.id}`, { method: "DELETE" });
    if (!response.ok) {
      setSaving("Delete failed");
      return;
    }
    setSaving("Deleted");
    await refreshWorkspace({ projectId: selectedProject?.id, notebookId: selectedNotebook?.id, pageId: selectedPage.id });
  }

  async function uploadInlineFile(file: File, blockType: BlockType) {
    if (!selectedPage) return null;
    const pageId = selectedPage.id;
    const form = new FormData();
    form.set("file", file);
    form.set("blockType", blockType);
    setSaving("Uploading");
    const response = await fetch(`/api/pages/${pageId}/attachments`, { method: "POST", body: form });
    setSaving(response.ok ? "Uploaded" : "Upload failed");
    if (!response.ok) return null;
    const body = (await response.json()) as { attachment: Attachment };
    return body.attachment;
  }

  function markInlineAttachmentInserted(attachment: Attachment, body: string) {
    if (!selectedPage) return;
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
            return {
              ...page,
              body,
              attachments: exists ? page.attachments : [...page.attachments, attachment],
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

  if (loading) return <main className="grid min-h-screen place-items-center bg-slate-50 text-slate-600">Loading...</main>;
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
                <h1 className="text-xl font-semibold">{authMode === "register" ? "Create an account" : "Welcome back"}</h1>
              </div>
            </div>
            <div className="grid grid-cols-2 border border-slate-200 p-1 text-sm font-medium">
              <button
                type="button"
                onClick={() => {
                  setAuthError("");
                  setAuthMode("signin");
                }}
                className={`h-8 ${authMode === "signin" ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"}`}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthError("");
                  setAuthMode("register");
                }}
                className={`h-8 ${authMode === "register" ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"}`}
              >
                Register
              </button>
            </div>
          </div>
          {authMode === "register" ? (
            <label className="mb-3 block text-sm font-medium text-slate-700">Name<input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 h-10 w-full border border-slate-300 px-3 outline-none focus:border-cyan-600" autoComplete="name" /></label>
          ) : null}
          <label className="mb-3 block text-sm font-medium text-slate-700">Email<input value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 h-10 w-full border border-slate-300 px-3 outline-none focus:border-cyan-600" /></label>
          <label className="mb-2 block text-sm font-medium text-slate-700">
            Password
            <div className="relative mt-1">
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type={showPassword ? "text" : "password"}
                className="h-10 w-full border border-slate-300 px-3 pr-10 outline-none focus:border-cyan-600"
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
              <input checked={rememberDevice} onChange={(event) => setRememberDevice(event.target.checked)} type="checkbox" className="size-4 border border-slate-300 accent-slate-950" />
              Remember this device for 14 days
            </label>
          ) : null}
          {authError ? <p className="mb-3 border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{authError}</p> : null}
          <button className="h-10 w-full bg-slate-950 text-sm font-semibold text-white hover:bg-slate-800">{authMode === "register" ? "Create account" : "Sign in"}</button>
        </form>
      </main>
    );
  }

  const expandedLayoutWidth = activeView === "project" ? sidebarWidth + 1 + pagesWidth + 1 + 560 : sidebarWidth + 1 + 560;
  const sidebarAutoCollapsed = viewportWidth > 0 && viewportWidth < expandedLayoutWidth;
  const effectiveSidebarCollapsed = sidebarCollapsed || sidebarAutoCollapsed;
  const effectiveSidebarWidth = effectiveSidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth;

  return (
    <main className="app-scroll-root overflow-x-auto bg-white text-slate-950">
      <input ref={fileInputRef} type="file" className="hidden" onChange={(event) => void uploadAttachment(event.target.files?.[0])} />

      <div className="grid h-dvh min-w-[980px]" style={{ gridTemplateColumns: activeView === "project" ? `${effectiveSidebarWidth}px 1px ${pagesWidth}px 1px minmax(560px, 1fr)` : `${effectiveSidebarWidth}px 1px minmax(560px, 1fr)` } as React.CSSProperties}>
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
          <AccountView user={workspace.user} />
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
              deletePage={requestPageDelete}
            />

            <ResizeHandle onPointerDown={(event) => setDragState({ pane: "pages", startX: event.clientX, startWidth: pagesWidth })} />

            {selectedPage ? (
              <EditorPane
                key={selectedPage.id}
                page={selectedPage}
                selectedProject={selectedProject}
                selectedNotebook={selectedNotebook}
                saving={saving}
                uploadInlineFile={uploadInlineFile}
                onInlineAttachmentInserted={markInlineAttachmentInserted}
                openSpreadsheet={openSpreadsheetModal}
                openPresentation={setPresentationModal}
                deleteAttachment={deletePageAttachment}
                patchSelectedPage={patchSelectedPage}
                savePage={savePage}
                setPageTags={setSelectedPageTags}
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
            onCancel={() => setProjectPendingDelete(null)}
            onConfirm={confirmProjectDelete}
          />
        ) : null}

        {notebookPendingDelete ? (
          <NotebookDeleteModal
            notebook={notebookPendingDelete}
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
            loading={searchLoading}
            results={hydratedSearchResults}
            onClose={closeSearch}
            selectResult={selectSearchResult}
          />
        ) : null}
    </main>
  );
}

function NameModal({ dialog, onCancel, onSubmit, onImportComplete }: { dialog: NameDialogState; onCancel: () => void; onSubmit: (name: string) => Promise<void>; onImportComplete?: (projectId: string, notebookId: string) => Promise<void> }) {
  const initialValue = dialog.kind === "renameProject" ? dialog.project.name : dialog.kind === "renameNotebook" ? dialog.notebook.name : "";
  const [name, setName] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);
  const [mode] = useState<"blank" | "import">(dialog.kind === "createNotebook" ? dialog.initialMode ?? "blank" : "blank");
  const [serverPath, setServerPath] = useState("");
  const [workerCount, setWorkerCount] = useState(4);
  const [inspection, setInspection] = useState<EnexInspection | null>(null);
  const [inspectionError, setInspectionError] = useState("");
  const [inspecting, setInspecting] = useState(false);
  const [job, setJob] = useState<EnexImportJob | null>(null);
  const [importError, setImportError] = useState("");
  const [openingImportedNotebook, setOpeningImportedNotebook] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const title = getNameModalTitle(dialog);
  const description = getNameModalDescription(dialog);
  const submitLabel = dialog.kind.startsWith("rename") ? "Rename" : "Create";
  const isNotebookCreate = dialog.kind === "createNotebook";
  const importing = job?.state === "queued" || job?.state === "running" || job?.state === "canceling";
  const cancelingImport = job?.state === "canceling";
  const disabled = !name.trim() || submitting || importing;
  const importDisabled = !isNotebookCreate || !serverPath.trim() || !name.trim() || inspecting || importing;
  const progressTotal = job?.progress.totalNotes ?? inspection?.noteCount ?? null;
  const resourceProgressTotal = job?.progress.totalResources ?? inspection?.resourceCount ?? null;
  const byteProgressPercent = job?.progress.totalBytes ? Math.min(100, Math.round((job.progress.processedBytes / job.progress.totalBytes) * 100)) : 0;
  const progressPercent = byteProgressPercent || (progressTotal && job ? Math.min(100, Math.round((job.progress.importedNotes / progressTotal) * 100)) : 0);
  const elapsedSeconds = job ? secondsBetween(job.startedAt, job.finishedAt) : 0;
  const predictedRemainingSeconds = job ? estimateRemainingSeconds(elapsedSeconds, progressPercent) : 0;
  const importFinished = job?.state === "succeeded";
  const importCanceled = job?.state === "canceled";
  const importTerminal = importFinished || importCanceled || job?.state === "failed";

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    if (!job || (job.state !== "queued" && job.state !== "running" && job.state !== "canceling")) return;
    let active = true;
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/import/enex/jobs/${job.id}`);
      if (!active || !response.ok) return;
      const nextJob = (await response.json()) as EnexImportJob;
      setJob(nextJob);
      if (nextJob.state === "succeeded" || nextJob.state === "failed" || nextJob.state === "canceled") window.clearInterval(timer);
    }, 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [dialog, job, onImportComplete]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    setSubmitting(true);
    await onSubmit(name);
    setSubmitting(false);
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
    const response = await fetch("/api/import/enex", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        notebookName: name.trim(),
        path: serverPath.trim(),
        totalNotes: inspection?.noteCount,
        totalResources: inspection?.resourceCount,
        workerCount,
      }),
    });
    const body = await response.json().catch(() => null) as { job?: EnexImportJob; error?: string } | null;
    if (!response.ok || !body?.job) {
      setImportError(body?.error || "Unable to start ENEX import.");
      return;
    }
    setJob(body.job);
  }

  async function openImportedNotebook() {
    if (dialog.kind !== "createNotebook" || !job?.notebookId) return;
    setOpeningImportedNotebook(true);
    await onImportComplete?.(dialog.projectId, job.notebookId);
    setOpeningImportedNotebook(false);
  }

  async function handleCancel() {
    if (job && (job.state === "queued" || job.state === "running")) {
      setImportError("");
      const response = await fetch(`/api/import/enex/jobs/${job.id}`, { method: "DELETE" });
      const body = await response.json().catch(() => null) as EnexImportJob | { error?: string } | null;
      if (!response.ok || !body || "error" in body) {
        setImportError((body as { error?: string } | null)?.error || "Unable to cancel import.");
        return;
      }
      setJob(body as EnexImportJob);
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
            <label className="flex items-center gap-4 text-sm font-medium text-slate-200">
              <span>Cores to use</span>
              <input
                type="number"
                min={1}
                max={16}
                value={workerCount}
                onChange={(event) => setWorkerCount(clampImportWorkerCount(event.target.value))}
                disabled={importing}
                className="h-10 w-28 border border-white/10 bg-white/10 px-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400 disabled:cursor-not-allowed disabled:text-slate-500"
              />
            </label>
            {inspectionError ? <p className="text-sm text-rose-300">{inspectionError}</p> : null}
            {inspection ? (
              <div className="border border-white/10 bg-white/5 p-3 text-sm text-slate-300">
                <div className="grid grid-cols-2 gap-3">
                  <ImportMetric label="Notes" value={inspection.noteCount.toLocaleString()} />
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
                  <span>{job.progress.importedNotes.toLocaleString()}{progressTotal ? ` / ${progressTotal.toLocaleString()}` : ""} notes</span>
                </div>
                <div className="h-2 overflow-hidden bg-slate-800">
                  <div className="h-full bg-cyan-400 transition-all" style={{ width: `${progressPercent}%` }} />
                </div>
                <div className="grid gap-1 text-xs text-slate-400">
                  <ImportProgressRow label="Elapsed time" value={formatDuration(elapsedSeconds)} />
                  <ImportProgressRow label="Predicted remaining time" value={predictedRemainingSeconds ? formatDuration(predictedRemainingSeconds) : "Calculating"} />
                  <ImportProgressRow label="Cores" value={(job.workerCount || workerCount).toLocaleString()} />
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
            <button type="submit" disabled={disabled} className="h-9 bg-cyan-500 px-3 text-sm font-medium text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400">
              {submitting ? "Saving" : submitLabel}
            </button>
          )}
        </div>
      </form>
    </ModalFrame>
  );
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

function ImportFinishedSummary({ notebookName, serverPath, inspection, job, elapsedSeconds }: { notebookName: string; serverPath: string; inspection: EnexInspection | null; job: EnexImportJob; elapsedSeconds: number }) {
  const resourceTotal = job.progress.totalResources ?? inspection?.resourceCount ?? null;
  const noteTotal = job.progress.totalNotes ?? inspection?.noteCount ?? null;
  return (
    <div className="mt-5 space-y-4">
      <div className="border border-emerald-400/30 bg-emerald-400/10 p-3">
        <p className="text-sm font-semibold text-emerald-200">Notebook created</p>
        <p className="mt-1 text-sm text-slate-300">{notebookName || job.notebookId || "Imported notebook"}</p>
      </div>
      <div className="grid gap-1 border border-white/10 bg-white/5 p-3 text-xs text-slate-400">
        <ImportProgressRow label="Notes imported" value={`${job.progress.importedNotes.toLocaleString()}${noteTotal ? ` / ${noteTotal.toLocaleString()}` : ""}`} />
        <ImportProgressRow label="ENEX resources" value={`${job.progress.importedResources.toLocaleString()}${resourceTotal ? ` / ${resourceTotal.toLocaleString()}` : ""}`} />
        {inspection ? <ImportProgressRow label="Inline media refs" value={inspection.inlineMediaCount.toLocaleString()} /> : null}
        <ImportProgressRow label="Elapsed time" value={formatDuration(elapsedSeconds)} />
        <ImportProgressRow label="Data" value={formatBytes(job.progress.processedBytes || job.progress.totalBytes)} />
        <ImportProgressRow label="Source file" value={serverPath || job.id} />
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

function NotebookDeleteModal({ notebook, onCancel, onConfirm }: { notebook: Notebook; onCancel: () => void; onConfirm: () => void }) {
  return (
    <ModalFrame>
      <h2 className="text-lg font-semibold text-white">Delete notebook?</h2>
      <p className="mt-3 text-sm leading-6 text-slate-400">
        This will delete <span className="font-semibold text-white">{notebook.name}</span>, including its pages and attachment records. This cannot be undone.
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onCancel} className="h-9 border border-white/10 px-3 text-sm text-slate-200 hover:bg-white/10">Cancel</button>
        <button onClick={onConfirm} className="h-9 bg-rose-500 px-3 text-sm font-medium text-white hover:bg-rose-400">Delete notebook</button>
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

function ProjectDeleteModal({ project, onCancel, onConfirm }: { project: Project; onCancel: () => void; onConfirm: () => void }) {
  return (
    <ModalFrame>
      <h2 className="text-lg font-semibold text-white">Delete project?</h2>
      <p className="mt-3 text-sm leading-6 text-slate-400">
        This will delete <span className="font-semibold text-white">{project.name}</span>, including its notebooks, pages, and attachment records. This cannot be undone.
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onCancel} className="h-9 border border-white/10 px-3 text-sm text-slate-200 hover:bg-white/10">Cancel</button>
        <button onClick={onConfirm} className="h-9 bg-rose-500 px-3 text-sm font-medium text-white hover:bg-rose-400">Delete project</button>
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
  const ownNotebooks = workspace.notebooks.filter((notebook) => notebook.ownerId === workspace.user.id);
  const sharedNotebooks = workspace.notebooks.filter((notebook) => notebook.ownerId !== workspace.user.id);
  const [myNotebooksCollapsed, setMyNotebooksCollapsed] = useState(false);
  const [sharedNotebooksCollapsed, setSharedNotebooksCollapsed] = useState(false);

  function renderNotebook(notebook: Notebook) {
    const selected = selectedNotebook?.id === notebook.id;
    const color = projectColor(notebook);
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
              <label className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm text-slate-200 hover:bg-white/10">
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
              </label>
              <button onClick={() => { setNotebookMenuId(null); renameNotebook(notebook); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/10">
                <Pencil size={15} className="shrink-0 text-slate-400" />
                <span>Rename</span>
              </button>
              <button onClick={() => { setNotebookMenuId(null); deleteNotebook(notebook); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-300 hover:bg-white/10">
                <Trash2 size={15} className="shrink-0 text-rose-400" />
                <span>Delete</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <aside className={`relative z-30 grid min-h-screen grid-rows-[auto_1fr_auto] bg-slate-950 text-slate-200 ${sidebarCollapsed ? "sidebar-collapsed overflow-visible" : "overflow-hidden"}`}>
      <div className="space-y-2 border-b border-white/10 py-4">
        <div className={sidebarCollapsed ? "px-3" : "px-4"}>
          <div className={`flex min-w-0 items-start ${sidebarCollapsed ? "justify-center" : "justify-between gap-3"}`}>
            <div className="novo-wordmark sidebar-wide min-w-0 select-none px-1 py-1 text-6xl leading-none tracking-normal text-slate-100">
              novo
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
          <button onClick={openHome} className={`flex w-full min-w-0 items-center overflow-hidden py-2 text-left text-sm ${sidebarCollapsed ? "justify-center px-0" : "gap-2 px-2"} ${activeView === "home" ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5"}`} title="Home">
            <HomeIcon size={16} className="shrink-0" />
            <span className="sidebar-wide min-w-0 truncate font-medium">Home</span>
          </button>
        </div>
        <SidebarSection label="My Notebooks" collapsed={myNotebooksCollapsed} onToggle={() => setMyNotebooksCollapsed((current) => !current)} onAdd={() => createNewNotebook(workspaceProject?.id)} />
        {!myNotebooksCollapsed ? (
          <div className="mt-2 space-y-1">
            {ownNotebooks.map(renderNotebook)}
            {ownNotebooks.length === 0 && !sidebarCollapsed ? <p className="sidebar-wide px-6 py-2 text-xs text-slate-500">No notebooks yet.</p> : null}
          </div>
        ) : null}
        <div className="mt-5">
          <SidebarSection label="Shared with Me" collapsed={sharedNotebooksCollapsed} onToggle={() => setSharedNotebooksCollapsed((current) => !current)} />
        </div>
        {!sharedNotebooksCollapsed ? (
          <div className="mt-2 space-y-1">
            {sharedNotebooks.map(renderNotebook)}
            {sharedNotebooks.length === 0 && !sidebarCollapsed ? <p className="sidebar-wide px-6 py-2 text-xs text-slate-500">No shared notebooks.</p> : null}
          </div>
        ) : null}
      </div>

      <div className="relative border-t border-white/10 py-4">
        {accountOpen ? (
          <div
            data-transient-menu="true"
            className={`${sidebarCollapsed ? "absolute bottom-4 left-[calc(100%+8px)] z-50 w-64 border border-white/10 bg-slate-900 p-3 shadow-2xl shadow-slate-950/40" : "sidebar-wide absolute bottom-16 left-4 right-4 border border-white/10 bg-slate-900 p-3 shadow-lg"}`}
          >
            <p className="text-sm font-medium text-white">{workspace.user.name}</p>
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

function PagesSidebar({ selectedProject, selectedNotebook, selectedPage, pageMenuId, setPageMenuId, selectPage, createNewPage, creatingPage, deletePage }: { selectedProject?: Project; selectedNotebook?: Notebook; selectedPage?: PageEntry; pageMenuId: string | null; setPageMenuId: (id: string | null) => void; selectPage: (project: Project, notebook: Notebook, page: PageEntry) => void; createNewPage: () => void; creatingPage: boolean; deletePage: (page: PageEntry) => void }) {
  const pages = useMemo(() => selectedNotebook?.pages ?? [], [selectedNotebook]);
  const [sortKey, setSortKey] = useState<PageSortKey>("updated");
  const [sortOptionsOpen, setSortOptionsOpen] = useState(false);
  const [filterOptionsOpen, setFilterOptionsOpen] = useState(false);
  const [activeFilterPanel, setActiveFilterPanel] = useState<"tags" | "status">("tags");
  const [tagQuery, setTagQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<PageStatus[]>([]);
  const sortOptionsRef = useRef<HTMLDivElement>(null);
  const filterOptionsRef = useRef<HTMLDivElement>(null);
  const availableTags = useMemo(() => normalizeTagList(pages.flatMap((page) => page.tags)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })), [pages]);
  const filteredPages = useMemo(() => filterNotebookPages(pages, selectedTags, selectedStatuses), [pages, selectedTags, selectedStatuses]);
  const sortedPages = useMemo(() => sortNotebookPages(filteredPages, sortKey), [filteredPages, sortKey]);
  const filterActive = selectedTags.length > 0 || selectedStatuses.length > 0;
  const filterCount = selectedTags.length + selectedStatuses.length;
  const visibleTags = useMemo(() => {
    const query = tagQuery.trim().toLowerCase();
    return query ? availableTags.filter((tag) => tag.toLowerCase().includes(query)) : availableTags;
  }, [availableTags, tagQuery]);
  const color = projectColor(selectedNotebook ?? selectedProject);

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

  return (
    <aside className="grid min-h-screen grid-rows-[auto_1fr] overflow-visible bg-slate-50 text-slate-900">
      <div className="border-b border-slate-200 px-4 py-4">
        <div className="mb-3 min-w-0">
          <p className="text-xs font-semibold" style={{ color }}>Notebook</p>
          <div className="flex min-w-0 items-center justify-between gap-3">
            <h2 className="truncate text-lg font-semibold">{selectedNotebook?.name ?? "Notebook"}</h2>
            <span className="shrink-0 text-sm font-medium text-slate-500">{filterActive ? `${sortedPages.length} / ${pages.length}` : sortedPages.length}</span>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <button onClick={createNewPage} disabled={creatingPage || !selectedNotebook} className="inline-flex h-8 items-center gap-1.5 border bg-white px-2.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-60" style={{ borderColor: color, color }}>
            {creatingPage ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {creatingPage ? "Creating" : "Page"}
          </button>
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
                  className="absolute left-0 top-10 z-30 flex items-start gap-2 text-slate-900"
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
              <button key={status || "no-status"} type="button" onClick={() => toggleStatusFilter(status)} className="inline-flex h-7 items-center gap-1 border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700 hover:border-slate-500">
                {getPageStatusLabel(status)}
                <X size={12} />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="overflow-y-auto scroll-contained py-3">
        <div className="space-y-2 px-4">
          {sortedPages.map((page) => (
            <PageCard
              key={page.id}
              page={page}
              active={selectedPage?.id === page.id}
              accentColor={color}
              menuOpen={pageMenuId === page.id}
              setMenuOpen={(open) => setPageMenuId(open ? page.id : null)}
              onClick={() => selectedProject && selectedNotebook && selectPage(selectedProject, selectedNotebook, page)}
              onDelete={() => deletePage(page)}
            />
          ))}
          {sortedPages.length === 0 ? <p className="p-3 text-sm text-slate-500">{filterActive ? "No pages match these filters." : "No pages yet."}</p> : null}
        </div>
      </div>
    </aside>
  );
}

function SearchOverlay({ query, setQuery, loading, results, onClose, selectResult }: { query: string; setQuery: (value: string) => void; loading: boolean; results: HydratedSearchResult[]; onClose: () => void; selectResult: (result: HydratedSearchResult) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmedQuery = query.trim();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="fixed inset-0 z-40 bg-slate-950/55 p-6" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Search notes"
        onMouseDown={(event) => event.stopPropagation()}
        className="mx-auto mt-12 grid max-h-[78vh] w-full max-w-4xl grid-rows-[auto_1fr] border border-white/10 bg-slate-950 text-slate-100 shadow-2xl shadow-slate-950/50"
      >
        <div className="border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-3">
            <Search className="shrink-0 text-slate-400" size={18} />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search notes, attachments, and notebooks"
              className="h-9 min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-slate-500"
            />
            {query ? (
              <button onClick={() => setQuery("")} className="grid size-8 place-items-center text-slate-500 hover:bg-white/10 hover:text-white" title="Clear search">
                <X size={16} />
              </button>
            ) : null}
          </div>
        </div>
        <div className="overflow-y-auto scroll-contained p-5">
          {trimmedQuery ? (
            <SearchResultList loading={loading} results={results} selectResult={selectResult} />
          ) : (
            <div className="border border-white/10 bg-white/[0.03] p-5 text-sm text-slate-400">
              Start typing to search page titles, note text, and attachment names.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function SearchResultList({ loading, results, selectedPageId, selectResult, compact = false }: { loading: boolean; results: HydratedSearchResult[]; selectedPageId?: string; selectResult: (result: HydratedSearchResult) => void; compact?: boolean }) {
  if (loading) return <p className="p-3 text-sm text-slate-400">Searching...</p>;
  if (!results.length) return <p className="p-3 text-sm text-slate-400">No matching pages.</p>;
  return (
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
  );
}

function SearchResultButton({ result, active, compact, onClick }: { result: HydratedSearchResult; active: boolean; compact: boolean; onClick: () => void }) {
  const label = result.matchType === "title" ? "Title" : result.matchType === "attachment" ? "Attachment" : result.matchType === "fuzzy" ? "Fuzzy" : "Text";
  const color = projectColor(result.project);
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

function PageCard({ page, active = false, contextLabel, accentColor = "#0891b2", tinted = false, menuOpen = false, setMenuOpen, onClick, onDelete }: { page: PageEntry; active?: boolean; contextLabel?: string; accentColor?: string; tinted?: boolean; menuOpen?: boolean; setMenuOpen?: (open: boolean) => void; onClick: () => void; onDelete?: () => void }) {
  const fileLabel = page.attachments.length ? `${page.attachments.length} files` : "No files";
  const color = normalizeColor(accentColor);
  const cardStyle = active ? pageCardActiveStyle(color) : tinted ? pageCardTintStyle(color) : undefined;
  const visibleTags = page.tags.slice(0, 3);
  return (
    <div className="group relative min-w-0">
      <button
        onClick={onClick}
        className={`block min-w-0 w-full border p-3 pr-10 text-left ${active ? "" : "border-slate-200 bg-white hover:border-slate-400"}`}
        style={cardStyle}
      >
        <div className="flex min-w-0 items-start justify-between gap-3">
          <h3 className="min-w-0 break-words text-sm font-semibold leading-5 text-slate-900">{page.title || "Untitled"}</h3>
        </div>
        <p className="mt-2 max-h-10 min-w-0 overflow-hidden break-words text-sm leading-5 text-slate-500">{bodyToEditorText(page.body) || "Empty page"}</p>
        {(page.status || visibleTags.length > 0) ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {page.status ? <span className="inline-flex h-6 items-center border px-2 text-[11px] font-medium" style={pageStatusStyle(page.status)}>{getPageStatusLabel(page.status)}</span> : null}
            {visibleTags.map((tag) => <span key={tag} className="inline-flex h-6 max-w-full items-center truncate border border-slate-200 bg-slate-100 px-2 text-[11px] font-medium text-slate-600">{tag}</span>)}
            {page.tags.length > visibleTags.length ? <span className="inline-flex h-6 items-center px-1 text-[11px] font-medium text-slate-400">+{page.tags.length - visibleTags.length}</span> : null}
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
      {setMenuOpen && onDelete ? (
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
            <div className="absolute right-0 top-8 z-20 w-36 border border-slate-800 bg-slate-950 py-1 text-slate-100 shadow-xl">
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
        <div className="mb-8">
          <p className="text-xs font-semibold text-slate-500">Home</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950">Overview</h1>
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
              {recentPages.length === 0 ? <p className="p-3 text-sm text-slate-500">No recent notes yet.</p> : null}
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
                  <div key={member.id} className="border border-slate-100 px-3 py-2">
                    <div className="text-sm font-medium text-slate-950">{member.name}</div>
                    <div className="mt-1 truncate text-xs text-slate-500">{member.email}</div>
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
  const canManage = user.role === "admin" || notebook.accessRole === "owner";
  const canEdit = canManage || notebook.accessRole === "editor";
  const attachmentCount = notebook.pages.reduce((total, page) => total + page.attachments.length, 0);
  const attachmentBytes = notebook.pages.reduce((total, page) => total + page.attachments.reduce((sum, attachment) => sum + attachment.size, 0), 0);
  const memberCount = notebook.members.length;

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

        <section className="border border-slate-200 bg-white p-4">
          <h2 className="text-base font-semibold text-slate-950">Summary</h2>
          <dl className="mt-3 max-w-md divide-y divide-slate-100 text-sm">
            <SummaryRow label="Pages" value={notebook.pages.length.toLocaleString()} />
            <SummaryRow label="Attachments" value={attachmentCount.toLocaleString()} />
            <SummaryRow label="Storage" value={formatBytes(attachmentBytes)} />
            <SummaryRow label="Members" value={memberCount.toLocaleString()} />
          </dl>
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="border border-slate-200 bg-white p-4">
            <div className="mb-4 flex items-center gap-2">
              <Users size={17} className="text-slate-500" />
              <h2 className="text-base font-semibold text-slate-950">Notebook access</h2>
            </div>
            <NotebookAccessList members={notebook.members} notebookOwnerId={notebook.ownerId} canManage={canManage} onRoleChange={updateNotebookMemberRole} onRemove={removeMember} />
          </section>

          <aside className="space-y-6">
            <section className="border border-slate-200 bg-white p-4">
              <h2 className="text-base font-semibold text-slate-950">Share notebook</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">Add a group member and choose their notebook role.</p>
              <div className="mt-4">
                {canManage ? <ShareForm members={members} existingMembers={notebook.members} submitLabel="Share" onSubmit={addNotebookMember} /> : <p className="text-sm text-slate-500">Only notebook owners can manage sharing.</p>}
              </div>
            </section>

            <section className="border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-500">
              <h2 className="text-base font-semibold text-slate-950">Details</h2>
              <dl className="mt-3 space-y-2">
                <div className="flex justify-between gap-3"><dt>Created</dt><dd className="text-right text-slate-700">{formatDateTime(notebook.createdAt)}</dd></div>
                <div className="flex justify-between gap-3"><dt>Updated</dt><dd className="text-right text-slate-700">{formatDateTime(notebook.updatedAt)}</dd></div>
                <div className="flex justify-between gap-3"><dt>Your role</dt><dd className="text-right capitalize text-slate-700">{notebook.accessRole}</dd></div>
              </dl>
            </section>
          </aside>
        </div>
      </div>
    </section>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(120px,auto)] gap-6 py-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-left font-medium text-slate-950">{value}</dd>
    </div>
  );
}

function NotebookAccessList({ members, notebookOwnerId, canManage, onRoleChange, onRemove }: { members: ShareMember[]; notebookOwnerId: string; canManage: boolean; onRoleChange: (member: ShareMember, role: AccessRole) => Promise<void>; onRemove: (member: ShareMember) => Promise<void> }) {
  if (!members.length) return <p className="text-sm text-slate-500">No members have access yet.</p>;
  return (
    <div className="space-y-2">
      {members.map((member) => {
        const isNotebookOwner = member.userId === notebookOwnerId;
        return (
        <div key={member.userId} className="grid gap-3 border border-slate-200 bg-white p-3 sm:grid-cols-[minmax(0,1fr)_140px_36px] sm:items-center">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-950">{member.name}</p>
            <p className="truncate text-xs text-slate-500">{member.email}</p>
          </div>
          {canManage ? (
            <select value={member.role} onChange={(event) => void onRoleChange(member, event.target.value as AccessRole)} disabled={isNotebookOwner} className="h-9 cursor-pointer border border-slate-300 bg-white px-2 text-sm text-slate-950 outline-none focus:border-cyan-600 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500">
              <option value="owner">Owner</option>
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
          ) : (
            <span className="text-sm capitalize text-slate-600">{member.role}</span>
          )}
          {canManage && !isNotebookOwner ? (
            <button type="button" onClick={() => void onRemove(member)} className="grid size-9 place-items-center border border-slate-200 text-slate-500 hover:bg-slate-100" title="Remove access">
              <X size={14} />
            </button>
          ) : null}
        </div>
        );
      })}
    </div>
  );
}

function ShareForm({ members, existingMembers, submitLabel, onSubmit }: { members: AppUser[]; existingMembers: ShareMember[]; submitLabel: string; onSubmit: (input: { email: string; role: AccessRole }) => Promise<void> }) {
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
      ? availableMembers.filter((member) => `${member.name} ${member.email}`.toLowerCase().includes(normalizedQuery))
      : availableMembers;
    return filtered.slice(0, 8);
  }, [availableMembers, normalizedQuery]);
  const disabled = submitting || !selectedMember;

  function selectMember(member: AppUser) {
    setSelectedMember(member);
    setQuery(member.name);
    setFocused(false);
    setError("");
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || !selectedMember) return;
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
            onFocus={() => setFocused(true)}
            onBlur={() => window.setTimeout(() => setFocused(false), 120)}
            type="text"
            autoComplete="off"
            placeholder="Search by name or email"
            className="h-9 w-full border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none focus:border-cyan-600"
          />
          {focused ? (
            <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto border border-slate-300 bg-white py-1 shadow-lg">
              {suggestions.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectMember(member)}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100"
                >
                  <span className="block truncate font-medium text-slate-950">{member.name}</span>
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
          className="h-9 flex-1 cursor-pointer border border-slate-300 bg-white px-2 text-sm text-slate-950 outline-none"
        >
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
          <option value="owner">Owner</option>
        </select>
        <button disabled={disabled} className="h-9 bg-slate-950 px-3 text-sm font-semibold text-white disabled:bg-slate-300">
          {submitting ? "Saving..." : submitLabel}
        </button>
      </div>
      {selectedMember ? <p className="text-xs text-slate-500">Sharing with {selectedMember.name} ({selectedMember.email})</p> : null}
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

function AccountView({ user }: { user: AppUser }) {
  const [activeTab, setActiveTab] = useState<"profile" | "security" | "users" | "data">("profile");
  const tabs = [
    { id: "profile" as const, label: "Profile", icon: UserCircle },
    { id: "security" as const, label: "Security", icon: KeyRound },
    ...(user.role === "admin" ? [{ id: "users" as const, label: "Users", icon: Users }] : []),
    ...(user.role === "admin" ? [{ id: "data" as const, label: "Data", icon: Database }] : []),
  ];

  return (
    <section className="min-h-screen overflow-y-auto scroll-contained bg-white p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8">
          <p className="text-xs font-semibold text-slate-500">Account</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950">Settings</h1>
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

        {activeTab === "profile" ? <AccountProfile user={user} /> : null}
        {activeTab === "security" ? <PasswordPanel /> : null}
        {activeTab === "users" && user.role === "admin" ? <UsersAdminPanel currentUserId={user.id} /> : null}
        {activeTab === "data" && user.role === "admin" ? <DataAdminPanel /> : null}
      </div>
    </section>
  );
}

function AccountProfile({ user }: { user: AppUser }) {
  return (
    <section className="max-w-2xl border border-slate-200 bg-white p-5">
      <div className="mb-5 flex items-start gap-3">
        <div className="grid size-10 place-items-center border border-slate-200 bg-slate-50 text-slate-600">
          <UserCircle size={22} />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-950">{user.name}</h2>
          <p className="mt-1 truncate text-sm text-slate-500">{user.email}</p>
        </div>
      </div>
      <dl className="grid gap-3 text-sm">
        <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 border-t border-slate-100 pt-3">
          <dt className="text-slate-500">Role</dt>
          <dd className="capitalize text-slate-950">{user.role}</dd>
        </div>
        <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 border-t border-slate-100 pt-3">
          <dt className="text-slate-500">User ID</dt>
          <dd className="truncate font-mono text-xs text-slate-600">{user.id}</dd>
        </div>
      </dl>
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
          <p className="mt-1 text-sm text-slate-500">Use this when you already know your current password.</p>
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
            <p className="mt-1 text-sm text-slate-500">Admin-only account management.</p>
          </div>
        </div>
        <button onClick={() => void loadUsers()} className="h-9 border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-50">Refresh</button>
      </div>
      {error ? <p className="m-5 border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      {loading ? (
        <p className="p-5 text-sm text-slate-500">Loading users...</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">User</th>
                <th className="px-4 py-3 font-semibold">Role</th>
                <th className="px-4 py-3 font-semibold">Notebooks</th>
                <th className="px-4 py-3 font-semibold">Created</th>
                <th className="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-950">{user.name}</div>
                    <div className="mt-1 text-xs text-slate-500">{user.email}</div>
                  </td>
                  <td className="px-4 py-3 capitalize text-slate-700">{user.role}</td>
                  <td className="px-4 py-3 text-slate-700">{user.notebookCount}</td>
                  <td className="px-4 py-3 text-slate-500">{formatDateTime(user.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setResetUser(user)}
                      className="h-8 border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
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

function DataAdminPanel() {
  const [overview, setOverview] = useState<AdminDataOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadData() {
    setLoading(true);
    setError("");
    const response = await fetch("/api/admin/data");
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
    fetch("/api/admin/data")
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

  const metrics = overview
    ? [
        { label: "Users", value: overview.counts.users.toLocaleString() },
        { label: "Notebooks", value: overview.counts.notebooks.toLocaleString() },
        { label: "Pages", value: overview.counts.pages.toLocaleString() },
        { label: "Attachments", value: overview.counts.attachments.toLocaleString() },
        { label: "Attachment data", value: formatBytes(overview.storage.attachmentBytes) },
        { label: "Files on disk", value: overview.storage.uploadFileCount.toLocaleString() },
        { label: "Disk usage", value: formatBytes(overview.storage.uploadBytes) },
        { label: "Orphan files", value: overview.storage.orphanUploadCount.toLocaleString() },
        { label: "Orphan storage", value: formatBytes(overview.storage.orphanUploadBytes) },
        { label: "Missing files", value: overview.storage.missingUploadCount.toLocaleString() },
        { label: "Import jobs", value: overview.counts.importJobs.toLocaleString() },
      ]
    : [];

  return (
    <section className="max-w-6xl border border-slate-200 bg-white">
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
        <div className="flex items-start gap-3">
          <div className="grid size-10 place-items-center border border-slate-200 bg-slate-50 text-slate-600">
            <Database size={21} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Data</h2>
            <p className="mt-1 text-sm text-slate-500">Database totals, attachment inventory, and upload storage use.</p>
          </div>
        </div>
        <button onClick={() => void loadData()} className="h-9 border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-50">Refresh</button>
      </div>

      {error ? <p className="m-5 border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      {loading ? <p className="p-5 text-sm text-slate-500">Loading data...</p> : null}

      {!loading && overview ? (
        <>
          <div className="grid gap-px border-b border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
            {metrics.map((metric) => (
              <div key={metric.label} className="bg-white p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{metric.label}</div>
                <div className="mt-2 text-2xl font-semibold text-slate-950">{metric.value}</div>
              </div>
            ))}
          </div>

          <div className="border-b border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-950">Files</h3>
            <p className="mt-1 text-sm text-slate-500">{overview.files.length.toLocaleString()} attachment records currently referenced by pages.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
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
                      <div className="mt-1 text-xs text-slate-500">{file.ownerEmail}</div>
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

function EditorPane({ page, selectedProject, selectedNotebook, saving, uploadInlineFile, onInlineAttachmentInserted, openSpreadsheet, openPresentation, deleteAttachment, patchSelectedPage, savePage, setPageTags, openFilePicker }: { page: PageEntry; selectedProject?: Project; selectedNotebook?: Notebook; saving: string; uploadInlineFile: (file: File, blockType: BlockType) => Promise<Attachment | null>; onInlineAttachmentInserted: (attachment: Attachment, body: string) => void; openSpreadsheet: (attachment: InlineAttachmentAttrs, onSaved?: (attachment: InlineAttachmentAttrs) => void) => void; openPresentation: (attachment: InlineAttachmentAttrs) => void; deleteAttachment: (attachment: Attachment) => Promise<void>; patchSelectedPage: (patch: Partial<PageEntry>) => void; savePage: (patch: { title?: string; body?: string; status?: PageStatus }) => Promise<void>; setPageTags: (tags: string[]) => Promise<void>; openFilePicker: () => void }) {
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const attachmentCount = page.attachments.length;
  const attachmentLabel = `${attachmentCount} file${attachmentCount === 1 ? "" : "s"}`;
  const color = projectColor(selectedNotebook ?? selectedProject);

  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-white">
      <header className="border-b border-slate-200 px-6 py-4">
        <div className="mb-2 flex items-center gap-2 text-sm text-slate-500"><span>{selectedNotebook?.name}</span>{saving ? <span className="ml-2 px-2 py-0.5 text-xs" style={{ backgroundColor: colorWithAlpha(color, 0.1), color }}>{saving}</span> : null}</div>
        <div className="flex items-center gap-3">
          <input value={page.title} onChange={(event) => patchSelectedPage({ title: event.target.value })} onBlur={(event) => void savePage({ title: event.target.value })} className="min-w-0 flex-1 bg-transparent py-1 text-4xl font-semibold leading-tight tracking-normal text-slate-950 outline-none" />
        </div>
        <PageTagsBar tags={page.tags} setPageTags={setPageTags} />
        <PageStatusRow
          status={page.status}
          setStatus={(status) => {
            patchSelectedPage({ status });
            void savePage({ status });
          }}
        />
      </header>
      <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] bg-white px-6 pb-6 pt-4">
        <RichTextEditor
          pageId={page.id}
          value={page.body}
          onChange={(body) => patchSelectedPage({ body })}
          onBlur={(body) => void savePage({ body })}
          uploadInlineFile={uploadInlineFile}
          onInlineAttachmentInserted={onInlineAttachmentInserted}
          openSpreadsheet={openSpreadsheet}
          openPresentation={openPresentation}
        />
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
            <button onClick={openFilePicker} className="inline-flex h-7 items-center gap-1 border border-slate-300 bg-white px-2 text-sm text-slate-700 hover:bg-slate-100"><Plus size={14} />File</button>
          </div>
          {attachmentsOpen ? (
            page.attachments.length ? (
              <div className="mt-3 grid max-h-80 gap-2 overflow-y-auto scroll-contained pr-1">
                {page.attachments.map((attachment, index) => <AttachmentRow key={attachment.id} index={index + 1} attachment={attachment} onDelete={() => void deleteAttachment(attachment)} />)}
              </div>
            ) : (
              <p className="mt-3 border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">No files attached yet.</p>
            )
          ) : null}
        </div>
      </div>
    </section>
  );
}

function PageTagsBar({ tags, setPageTags }: { tags: string[]; setPageTags: (tags: string[]) => Promise<void> }) {
  const [tagInput, setTagInput] = useState("");
  const normalizedTags = useMemo(() => normalizeTagList(tags), [tags]);

  function addTagInput() {
    const nextTags = normalizeTagList([...normalizedTags, tagInput]);
    setTagInput("");
    if (nextTags.length !== normalizedTags.length) void setPageTags(nextTags);
  }

  function removeTag(tag: string) {
    void setPageTags(normalizedTags.filter((candidate) => candidate !== tag));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addTagInput();
    }
    if (event.key === "Backspace" && !tagInput && normalizedTags.length) {
      event.preventDefault();
      removeTag(normalizedTags[normalizedTags.length - 1]);
    }
  }

  return (
    <div className="mt-2 flex min-h-8 flex-wrap items-center gap-1.5">
      <Tag size={15} className="mr-1 shrink-0 text-slate-400" />
      {normalizedTags.map((tag) => (
        <span key={tag} className="inline-flex h-7 items-center gap-1 border border-slate-200 bg-slate-100 px-2 text-sm text-slate-700">
          {tag}
          <button type="button" onClick={() => removeTag(tag)} className="-mr-1 grid size-5 place-items-center text-slate-400 hover:text-slate-900" aria-label={`Remove ${tag} tag`}>
            <X size={13} />
          </button>
        </span>
      ))}
      <input
        value={tagInput}
        onChange={(event) => setTagInput(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={addTagInput}
        className="h-7 min-w-36 flex-1 border-0 bg-transparent px-1 text-sm text-slate-700 outline-none placeholder:text-slate-400"
        placeholder="Type to add..."
      />
    </div>
  );
}

function PageStatusRow({ status, setStatus }: { status: PageStatus; setStatus: (status: PageStatus) => void }) {
  return (
    <div className="mt-1 flex min-h-8 flex-wrap items-center gap-1.5 text-sm">
      <Flag size={15} className="mr-1 shrink-0 text-slate-400" />
      <select
        value={status}
        onChange={(event) => setStatus(event.target.value as PageStatus)}
        className="h-8 w-40 border border-slate-300 bg-white px-2 text-sm font-medium text-slate-700 outline-none hover:border-slate-400 focus:border-cyan-500"
        aria-label="Page status"
      >
        {PAGE_STATUS_OPTIONS.map((option) => <option key={option.label} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  );
}

function AttachmentRow({ attachment, index, onDelete }: { attachment: Attachment; index: number; onDelete: () => void }) {
  const Icon = blockIcons[attachment.blockType];

  function handleDragStart(event: React.DragEvent<HTMLDivElement>) {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(INLINE_ATTACHMENT_DRAG_TYPE, JSON.stringify(attachmentToInlineAttrs(attachment)));
    event.dataTransfer.setData("text/plain", attachment.originalName);
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className="flex cursor-grab items-center justify-between gap-4 border border-slate-200 bg-white px-3 py-2 active:cursor-grabbing"
      title="Drag into the note to place this attachment inline"
    >
      <div className="flex min-w-0 items-center gap-2">
        <GripVertical className="shrink-0 text-slate-400" size={15} aria-hidden="true" />
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
        <button onClick={onDelete} className="grid size-8 place-items-center border border-slate-300 bg-white text-slate-500 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700" title="Delete attachment"><X size={14} /></button>
      </div>
    </div>
  );
}

function formatAttachmentDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
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

function secondsBetween(startedAt: string, finishedAt?: string) {
  const start = parseServerTimestamp(startedAt);
  const end = finishedAt ? parseServerTimestamp(finishedAt) : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.floor((end - start) / 1000));
}

function estimateRemainingSeconds(elapsedSeconds: number, progressPercent: number) {
  if (!elapsedSeconds || progressPercent <= 0 || progressPercent >= 100) return 0;
  const estimatedTotalSeconds = Math.round(elapsedSeconds / (progressPercent / 100));
  return Math.max(0, estimatedTotalSeconds - elapsedSeconds);
}

function clampImportWorkerCount(value: string | number) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return 4;
  return Math.min(16, Math.max(1, parsed));
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

function SidebarSection({ label, onAdd, collapsed, onToggle }: { label: string; onAdd?: () => void; collapsed?: boolean; onToggle?: () => void }) {
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
        {onAdd ? <button onClick={onAdd} className="grid size-6 shrink-0 place-items-center text-slate-400 hover:bg-white/10 hover:text-white" title={`Create ${label.toLowerCase()}`}><Plus size={14} /></button> : null}
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

const PAGE_CARD_TINT_ALPHA = 0.075;

function pageCardTintStyle(value: string | undefined) {
  return {
    backgroundColor: colorWithAlpha(value, PAGE_CARD_TINT_ALPHA),
    borderColor: "#e2e8f0",
  };
}

function pageCardActiveStyle(value: string | undefined) {
  const color = normalizeColor(value);
  return {
    backgroundColor: colorWithAlpha(color, PAGE_CARD_TINT_ALPHA),
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

function getPageStatusLabel(status: PageStatus) {
  return PAGE_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? "No status";
}

function pageStatusStyle(status: PageStatus) {
  if (status === "Failed") return { borderColor: "#fecdd3", backgroundColor: "#fff1f2", color: "#be123c" };
  if (status === "Needs review") return { borderColor: "#fde68a", backgroundColor: "#fffbeb", color: "#a16207" };
  if (status === "Completed") return { borderColor: "#bbf7d0", backgroundColor: "#f0fdf4", color: "#15803d" };
  if (status === "Working") return { borderColor: "#bfdbfe", backgroundColor: "#eff6ff", color: "#1d4ed8" };
  return { borderColor: "#e2e8f0", backgroundColor: "#f8fafc", color: "#64748b" };
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

function writePageUrl(pageId: string | null, mode: "push" | "replace") {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
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
