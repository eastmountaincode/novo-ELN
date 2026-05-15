"use client";

import {
  Beaker,
  CalendarClock,
  CalendarPlus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  Folder,
  GripVertical,
  Home as HomeIcon,
  Image as ImageIcon,
  KeyRound,
  MoreHorizontal,
  Notebook as NotebookIcon,
  Paperclip,
  Plus,
  Search,
  Shield,
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
import type { AccessRole, AdminDataOverview, AdminUser, AppUser, Attachment, BlockType, Notebook, PageEntry, Project, SearchResult, ShareMember, Workspace } from "@/lib/types";

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

type NameDialogState =
  | { kind: "createProject" }
  | { kind: "createNotebook"; projectId: string; projectName: string }
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
  const [name, setName] = useState("");
  const [activeView, setActiveView] = useState<"home" | "projectHome" | "project" | "account">("home");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedNotebookId, setSelectedNotebookId] = useState("");
  const [selectedPageId, setSelectedPageId] = useState("");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [saving, setSaving] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_MIN_WIDTH);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
  const [notebookShareDialog, setNotebookShareDialog] = useState<Notebook | null>(null);
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

    if (readPageIdFromUrl() || readNotebookIdFromUrl() || readProjectIdFromUrl()) writePageUrl(null, "replace");
    const project = data.projects[0];
    const notebook = project?.notebooks[0];
    const page = notebook?.pages[0];
    setSelectedProjectId((current) => current || project?.id || "");
    setSelectedNotebookId((current) => current || notebook?.id || "");
    setSelectedPageId((current) => current || page?.id || "");
    if (project) setExpandedProjectIds((current) => new Set(current).add(project.id));
  }, [applyNotebookSelection, applyPageSelection, applyProjectSelection]);

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
  }, [applyNotebookSelection, applyPageSelection, applyProjectSelection, workspace]);

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

  async function refreshWorkspace(selection?: { projectId?: string; notebookId?: string; pageId?: string }) {
    const response = await fetch("/api/workspace");
    if (!response.ok) return;
    const data = (await response.json()) as Workspace;
    setWorkspace(data);
    if (!selection) {
      selectFirstAvailable(data);
      return;
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
      body: JSON.stringify(authMode === "register" ? { email, name, password } : { email, password }),
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

  async function savePage(patch: { title?: string; body?: string; status?: "Draft" | "Final" }) {
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

  function shareExistingNotebook(notebook: Notebook) {
    setProjectMenuId(null);
    setNotebookMenuId(null);
    setPageMenuId(null);
    setAccountOpen(false);
    setNotebookShareDialog(notebook);
  }

  function requestPageDelete(page: PageEntry) {
    setProjectMenuId(null);
    setNotebookMenuId(null);
    setPageMenuId(null);
    setAccountOpen(false);
    setPagePendingDelete(page);
  }

  async function confirmPageDelete() {
    if (!pagePendingDelete || !selectedNotebook) return;
    const remainingPages = selectedNotebook.pages.filter((page) => page.id !== pagePendingDelete.id);
    const deletedIndex = selectedNotebook.pages.findIndex((page) => page.id === pagePendingDelete.id);
    const nextPage = remainingPages[Math.min(Math.max(deletedIndex, 0), remainingPages.length - 1)];
    const nextPageId = selectedPage?.id === pagePendingDelete.id ? nextPage?.id ?? "" : selectedPage?.id;
    const response = await fetch(`/api/pages/${pagePendingDelete.id}`, { method: "DELETE" });
    if (!response.ok) return;
    setPagePendingDelete(null);
    if (nextPageId) writePageUrl(nextPageId, "replace");
    else writeNotebookUrl(selectedNotebook.id, "replace");
    await refreshWorkspace({ projectId: selectedProject?.id, notebookId: selectedNotebook.id, pageId: nextPageId });
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

  function createNewNotebook(projectId = selectedProject?.id) {
    if (!projectId) return;
    setProjectMenuId(null);
    setNotebookMenuId(null);
    setPageMenuId(null);
    setAccountOpen(false);
    const projectName = workspace?.projects.find((project) => project.id === projectId)?.name ?? "Project";
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
    if (!selectedNotebook) return;
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
              <div className="grid size-10 place-items-center bg-slate-950 text-cyan-300"><FlaskConical size={22} /></div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Novo</p>
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
          <label className="mb-4 block text-sm font-medium text-slate-700">Password<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" className="mt-1 h-10 w-full border border-slate-300 px-3 outline-none focus:border-cyan-600" autoComplete={authMode === "register" ? "new-password" : "current-password"} /></label>
          {authError ? <p className="mb-3 border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{authError}</p> : null}
          <button className="h-10 w-full bg-slate-950 text-sm font-semibold text-white hover:bg-slate-800">{authMode === "register" ? "Create account" : "Sign in"}</button>
        </form>
      </main>
    );
  }

  const effectiveSidebarWidth = sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth;

  return (
    <main className="app-scroll-root overflow-x-auto bg-white text-slate-950">
      <input ref={fileInputRef} type="file" className="hidden" onChange={(event) => void uploadAttachment(event.target.files?.[0])} />

      <div className="grid h-dvh min-w-[980px]" style={{ gridTemplateColumns: activeView === "project" ? `${effectiveSidebarWidth}px 1px ${pagesWidth}px 1px minmax(560px, 1fr)` : `${effectiveSidebarWidth}px 1px minmax(560px, 1fr)` } as React.CSSProperties}>
        <UnifiedSidebar
          workspace={workspace}
          activeView={activeView}
          selectedProject={selectedProject}
          selectedNotebook={selectedNotebook}
          sidebarCollapsed={sidebarCollapsed}
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
          shareNotebook={shareExistingNotebook}
          createNewNotebook={createNewNotebook}
          handleLogout={handleLogout}
        />

        <ResizeHandle disabled={sidebarCollapsed} onPointerDown={(event) => setDragState({ pane: "sidebar", startX: event.clientX, startWidth: sidebarWidth })} />

        {activeView === "home" ? (
          <HomeView recentPages={recentPages} selectPage={selectPage} />
        ) : activeView === "account" ? (
          <AccountView user={workspace.user} />
        ) : activeView === "projectHome" && selectedProject ? (
          <ProjectHomeView
            user={workspace.user}
            project={selectedProject}
            recentPages={recentPages.filter((entry) => entry.project.id === selectedProject.id)}
            selectNotebook={selectNotebook}
            selectPage={selectPage}
            refreshWorkspace={() => refreshWorkspace({ projectId: selectedProject.id })}
          />
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

        {notebookShareDialog ? (
          <NotebookShareModal
            notebook={notebookShareDialog}
            user={workspace.user}
            onCancel={() => setNotebookShareDialog(null)}
            onChanged={async () => {
              if (!selectedProject) return;
              await refreshWorkspace({ projectId: selectedProject.id, notebookId: notebookShareDialog.id });
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
  const [mode, setMode] = useState<"blank" | "import">("blank");
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
        projectId: dialog.projectId,
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
        ) : isNotebookCreate ? (
          <div className="mt-5 grid grid-cols-2 border border-white/10 bg-white/5 p-1 text-sm">
            <button type="button" onClick={() => setMode("blank")} className={`h-9 ${mode === "blank" ? "bg-cyan-500 text-slate-950" : "text-slate-300 hover:bg-white/10"}`}>Blank</button>
            <button type="button" onClick={() => setMode("import")} className={`h-9 ${mode === "import" ? "bg-cyan-500 text-slate-950" : "text-slate-300 hover:bg-white/10"}`}>Import ENEX</button>
          </div>
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
            <label className="block text-sm font-medium text-slate-200">
              Cores to use
              <input
                type="number"
                min={1}
                max={16}
                value={workerCount}
                onChange={(event) => setWorkerCount(clampImportWorkerCount(event.target.value))}
                disabled={importing}
                className="mt-2 h-10 w-28 border border-white/10 bg-white/10 px-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400 disabled:cursor-not-allowed disabled:text-slate-500"
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
      <p className="text-xs uppercase tracking-[0.14em] text-slate-500">{label}</p>
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
  if (dialog.kind === "createNotebook") return "New notebook";
  if (dialog.kind === "renameProject") return "Rename project";
  return "Rename notebook";
}

function getNameModalDescription(dialog: NameDialogState) {
  if (dialog.kind === "createProject") return "Create a project to group related notebooks.";
  if (dialog.kind === "createNotebook") return `Create a notebook inside ${dialog.projectName}.`;
  if (dialog.kind === "renameProject") return "Update the project name shown in the sidebar.";
  return "Update the notebook name shown under its project.";
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

function PageDeleteModal({ page, onCancel, onConfirm }: { page: PageEntry; onCancel: () => void; onConfirm: () => void }) {
  return (
    <ModalFrame>
      <h2 className="text-lg font-semibold text-white">Delete page?</h2>
      <p className="mt-3 text-sm leading-6 text-slate-400">
        This will delete <span className="font-semibold text-white">{page.title || "Untitled page"}</span>, including its attachment records. This cannot be undone.
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onCancel} className="h-9 border border-white/10 px-3 text-sm text-slate-200 hover:bg-white/10">Cancel</button>
        <button onClick={onConfirm} className="h-9 bg-rose-500 px-3 text-sm font-medium text-white hover:bg-rose-400">Delete page</button>
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

function UnifiedSidebar({ workspace, activeView, selectedProject, selectedNotebook, sidebarCollapsed, accountOpen, projectMenuId, notebookMenuId, expandedProjectIds, openSearch, toggleSidebarCollapsed, setAccountOpen, setProjectMenuId, setNotebookMenuId, openHome, openAccount, selectProject, toggleProject, selectNotebook, createNewProject, renameProject, updateProjectColor, deleteProject, renameNotebook, deleteNotebook, shareNotebook, createNewNotebook, handleLogout }: { workspace: Workspace; activeView: "home" | "projectHome" | "project" | "account"; selectedProject?: Project; selectedNotebook?: Notebook; sidebarCollapsed: boolean; accountOpen: boolean; projectMenuId: string | null; notebookMenuId: string | null; expandedProjectIds: Set<string>; openSearch: () => void; toggleSidebarCollapsed: () => void; setAccountOpen: (value: boolean) => void; setProjectMenuId: (value: string | null) => void; setNotebookMenuId: (value: string | null) => void; openHome: () => void; openAccount: () => void; selectProject: (project: Project) => void; toggleProject: (project: Project) => void; selectNotebook: (project: Project, notebook: Notebook) => void; createNewProject: () => void; renameProject: (project: Project) => void; updateProjectColor: (project: Project, color: string) => void; deleteProject: (project: Project) => void; renameNotebook: (notebook: Notebook) => void; deleteNotebook: (notebook: Notebook) => void; shareNotebook: (notebook: Notebook) => void; createNewNotebook: (projectId?: string) => void; handleLogout: () => void }) {
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
        <SidebarSection label="Projects" onAdd={createNewProject} />
        <div className="mt-2 space-y-1">
          {workspace.projects.map((project) => {
            const expanded = expandedProjectIds.has(project.id);
            const color = projectColor(project);
            const selected = selectedProject?.id === project.id;
            return (
              <div key={project.id}>
                <div className={sidebarCollapsed ? "px-3" : "px-4"}>
                  <div
                    className={`relative flex w-full min-w-0 items-center gap-1 py-1 text-sm ${sidebarCollapsed ? "justify-center px-0" : "px-1"} ${selected ? "text-white" : "text-slate-300 hover:bg-white/5"}`}
                    style={{ backgroundColor: selected ? colorWithAlpha(color, 0.1) : undefined }}
                  >
                    <button onClick={() => toggleProject(project)} className="sidebar-wide grid size-7 shrink-0 place-items-center text-slate-400 hover:text-white" title={expanded ? "Collapse project" : "Expand project"}>
                      {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </button>
                    <button onClick={() => selectProject(project)} className={`flex min-w-0 items-center overflow-hidden text-left ${sidebarCollapsed ? "justify-center" : "flex-1 gap-2"}`} title={project.name}>
                      <Folder size={16} className="shrink-0" style={{ color }} />
                      <span className="sidebar-wide min-w-0 truncate font-medium">{project.name}</span>
                    </button>
                    <div className="sidebar-wide flex shrink-0 items-center">
                      <button onClick={() => createNewNotebook(project.id)} className="grid size-7 place-items-center text-slate-400 hover:bg-white/10 hover:text-white" title="Create notebook">
                        <Plus size={15} />
                      </button>
                      <button
                        data-transient-menu="true"
                        onClick={() => {
                          setNotebookMenuId(null);
                          setAccountOpen(false);
                          setProjectMenuId(projectMenuId === project.id ? null : project.id);
                        }}
                        className="grid size-7 place-items-center text-slate-400 hover:bg-white/10 hover:text-white"
                        title="Project actions"
                      >
                        <MoreHorizontal size={15} />
                      </button>
                    </div>
                    {projectMenuId === project.id ? (
                      <div data-transient-menu="true" className="sidebar-wide absolute right-1 top-9 z-20 w-40 border border-white/10 bg-slate-900 py-1 shadow-lg">
                        <label className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm text-slate-200 hover:bg-white/10">
                          <span>Color</span>
                          <input
                            type="color"
                            value={color}
                            onChange={(event) => updateProjectColor(project, event.target.value)}
                            className="size-6 cursor-pointer border-0 bg-transparent p-0"
                            title="Project color"
                          />
                        </label>
                        <button onClick={() => { setProjectMenuId(null); renameProject(project); }} className="block w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/10">Rename</button>
                        <button onClick={() => { setProjectMenuId(null); deleteProject(project); }} className="block w-full px-3 py-2 text-left text-sm text-rose-300 hover:bg-white/10">Delete</button>
                      </div>
                    ) : null}
                  </div>
                </div>

                {expanded && !sidebarCollapsed ? (
                  <div className="sidebar-wide mt-1 space-y-1 pl-7">
                    {project.notebooks.map((notebook) => (
                      <div key={notebook.id} className="pr-4">
                        <div
                          className={`relative flex w-full min-w-0 items-center gap-1 px-2 py-1.5 text-sm ${selectedNotebook?.id === notebook.id ? "text-white" : "text-slate-300 hover:bg-white/5"}`}
                          style={{ backgroundColor: selectedNotebook?.id === notebook.id ? colorWithAlpha(color, 0.08) : undefined }}
                        >
                          <button onClick={() => selectNotebook(project, notebook)} className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-left">
                            <NotebookIcon size={15} className="shrink-0" style={{ color }} />
                            <span className="min-w-0 truncate">{notebook.name}</span>
                          </button>
                          <button
                            data-transient-menu="true"
                            onClick={() => {
                              setProjectMenuId(null);
                              setAccountOpen(false);
                              setNotebookMenuId(notebookMenuId === notebook.id ? null : notebook.id);
                            }}
                            className="grid size-6 shrink-0 place-items-center text-slate-400 hover:bg-white/10 hover:text-white"
                            title="Notebook actions"
                          >
                            <MoreHorizontal size={14} />
                          </button>
                          {notebookMenuId === notebook.id ? (
                            <div data-transient-menu="true" className="absolute right-1 top-8 z-20 w-32 border border-white/10 bg-slate-900 py-1 shadow-lg">
	                              <button onClick={() => { setNotebookMenuId(null); shareNotebook(notebook); }} className="block w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/10">Share</button>
	                              <button onClick={() => { setNotebookMenuId(null); renameNotebook(notebook); }} className="block w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/10">Rename</button>
                              <button onClick={() => { setNotebookMenuId(null); deleteNotebook(notebook); }} className="block w-full px-3 py-2 text-left text-sm text-rose-300 hover:bg-white/10">Delete</button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
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

function PagesSidebar({ selectedProject, selectedNotebook, selectedPage, pageMenuId, setPageMenuId, selectPage, createNewPage, deletePage }: { selectedProject?: Project; selectedNotebook?: Notebook; selectedPage?: PageEntry; pageMenuId: string | null; setPageMenuId: (id: string | null) => void; selectPage: (project: Project, notebook: Notebook, page: PageEntry) => void; createNewPage: () => void; deletePage: (page: PageEntry) => void }) {
  const pages = selectedNotebook?.pages ?? [];
  const color = projectColor(selectedProject);
  return (
    <aside className="grid min-h-screen grid-rows-[auto_1fr] overflow-hidden bg-slate-50 text-slate-900">
      <div className="border-b border-slate-200 px-4 py-4">
        <div className="mb-3 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color }}>{selectedProject?.name ?? "Project"}</p>
          <h2 className="truncate text-lg font-semibold">{selectedNotebook?.name ?? "Notebook"}</h2>
        </div>
        <button onClick={createNewPage} className="inline-flex h-9 items-center gap-2 px-3 text-sm font-medium text-white hover:opacity-90" style={{ backgroundColor: color }}><Plus size={15} />Page</button>
      </div>

      <div className="overflow-y-auto scroll-contained py-3">
        <div className="space-y-2 px-4">
            {pages.map((page) => (
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
          {pages.length === 0 ? <p className="p-3 text-sm text-slate-500">No pages yet.</p> : null}
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
  const cardStyle = active || tinted ? pageCardTintStyle(color) : undefined;
  return (
    <div className="group relative">
      <button
        onClick={onClick}
        className={`w-full border p-3 pr-10 text-left ${active ? "" : "border-slate-200 bg-white hover:border-slate-400"}`}
        style={cardStyle}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-semibold leading-5 text-slate-900">{page.title || "Untitled"}</h3>
        </div>
        <p className="mt-2 max-h-10 overflow-hidden text-sm leading-5 text-slate-500">{bodyToEditorText(page.body) || "Empty page"}</p>
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

function HomeView({ recentPages, selectPage }: { recentPages: Array<{ page: PageEntry; project: Project; notebook: Notebook }>; selectPage: (project: Project, notebook: Notebook, page: PageEntry) => void }) {
  return (
    <section className="min-h-screen overflow-y-auto scroll-contained bg-white p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Home</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950">Overview</h1>
        </div>

        <section className="max-w-3xl border border-slate-200 bg-white p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-950">Recently edited notes</h2>
              <p className="mt-1 text-sm text-slate-500">Latest pages across projects and notebooks.</p>
            </div>
          </div>
          <div className="grid gap-2">
            {recentPages.slice(0, 6).map(({ page, project, notebook }) => (
              <PageCard
                key={page.id}
                page={page}
                accentColor={project.color}
                tinted
                contextLabel={`${project.name} / ${notebook.name}`}
                onClick={() => selectPage(project, notebook, page)}
              />
            ))}
            {recentPages.length === 0 ? <p className="p-3 text-sm text-slate-500">No recent notes yet.</p> : null}
          </div>
        </section>
      </div>
    </section>
  );
}

function ProjectHomeView({ user, project, recentPages, selectNotebook, selectPage, refreshWorkspace }: { user: AppUser; project: Project; recentPages: Array<{ page: PageEntry; project: Project; notebook: Notebook }>; selectNotebook: (project: Project, notebook: Notebook) => void; selectPage: (project: Project, notebook: Notebook, page: PageEntry) => void; refreshWorkspace: () => Promise<void> }) {
  const canManageProject = user.role === "admin" || project.accessRole === "owner";
  const color = projectColor(project);
  const totalPages = project.notebooks.reduce((sum, notebook) => sum + notebook.pages.length, 0);
  const totalAttachments = project.notebooks.reduce((sum, notebook) => sum + notebook.pages.reduce((pageSum, page) => pageSum + page.attachments.length, 0), 0);
  const associatedTags = new Map<string, string>();
  project.notebooks.forEach((notebook) => {
    notebook.pages.forEach((page) => {
      page.tags.forEach((tag) => associatedTags.set(tag, "#64748b"));
    });
  });

  return (
    <section className="min-h-screen overflow-y-auto scroll-contained bg-white p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex items-start justify-between gap-6">
          <div className="min-w-0 border-l-4 pl-4" style={{ borderColor: color }}>
            <p className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color }}>Project</p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950">{project.name}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{project.description || "Project workspace for notebooks, pages, members, and templates."}</p>
          </div>
          <div className="border px-3 py-2 text-sm" style={{ borderColor: colorWithAlpha(color, 0.25), backgroundColor: colorWithAlpha(color, 0.06), color }}>
            {project.accessScope === "project" ? `${project.accessRole ?? "viewer"} project access` : "Notebook-only access"}
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-6">
            <ProjectSummary
              notebooks={project.notebooks.length}
              pages={totalPages}
              attachments={totalAttachments}
              createdAt={project.createdAt}
              updatedAt={project.updatedAt}
              accentColor={color}
              tags={Array.from(associatedTags, ([label, color]) => ({ label, color }))}
            />

            <section className="border bg-white p-4" style={{ borderColor: colorWithAlpha(color, 0.22) }}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-950">Notebooks</h2>
                  <p className="mt-1 text-sm text-slate-500">{project.accessScope === "notebook" ? "Only notebooks shared with you are shown." : "All notebooks in this project."}</p>
                </div>
              </div>
              <div className="grid gap-2">
                {project.notebooks.map((notebook) => (
                  <button
                    key={notebook.id}
                    onClick={() => selectNotebook(project, notebook)}
                    className="flex items-center justify-between gap-3 border border-l-4 bg-white p-3 text-left hover:border-slate-400"
                    style={{ borderColor: colorWithAlpha(color, 0.24), borderLeftColor: color, backgroundColor: colorWithAlpha(color, 0.025) }}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <NotebookIcon size={16} className="shrink-0" style={{ color }} />
                        <span className="truncate text-sm font-semibold text-slate-950">{notebook.name}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{notebook.pages.length} pages · {notebook.accessRole} access</p>
                    </div>
                    <ChevronRight size={16} className="shrink-0 text-slate-400" />
                  </button>
                ))}
                {project.notebooks.length === 0 ? <p className="p-3 text-sm text-slate-500">No visible notebooks.</p> : null}
              </div>
            </section>

            <section className="border bg-white p-4" style={{ borderColor: colorWithAlpha(color, 0.22) }}>
              <div className="mb-4">
                <h2 className="text-base font-semibold text-slate-950">Recent pages</h2>
                <p className="mt-1 text-sm text-slate-500">Latest edits inside this project.</p>
              </div>
              <div className="grid gap-2">
                {recentPages.slice(0, 5).map(({ page, notebook }) => (
                  <PageCard
                    key={page.id}
                    page={page}
                    accentColor={color}
                    tinted
                    contextLabel={notebook.name}
                    onClick={() => selectPage(project, notebook, page)}
                  />
                ))}
                {recentPages.length === 0 ? <p className="p-3 text-sm text-slate-500">No recent pages yet.</p> : null}
              </div>
            </section>
          </div>

          <aside className="space-y-6">
            {canManageProject ? (
              <section className="border bg-white p-4" style={{ borderColor: colorWithAlpha(color, 0.22) }}>
                <div className="mb-4 flex items-center gap-2">
                  <Users size={17} style={{ color }} />
                  <h2 className="text-base font-semibold text-slate-950">Share project</h2>
                </div>
                <ShareProjectPanel project={project} refreshWorkspace={refreshWorkspace} />
              </section>
            ) : null}

            <section className="border bg-white p-4" style={{ borderColor: colorWithAlpha(color, 0.22) }}>
              <div className="mb-4 flex items-center gap-2">
                <Users size={17} style={{ color }} />
                <h2 className="text-base font-semibold text-slate-950">Project members</h2>
              </div>
              {project.accessScope === "notebook" ? (
                <p className="mb-4 border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">You have access through shared notebooks, not the full project.</p>
              ) : null}
              <MemberList members={project.members} emptyText="No project members." onRemove={canManageProject ? async (member) => {
                await removeProjectMember(project.id, member.userId);
                await refreshWorkspace();
              } : undefined} />
            </section>
          </aside>
        </div>
      </div>
    </section>
  );
}

function ProjectSummary({ notebooks, pages, attachments, createdAt, updatedAt, accentColor, tags }: { notebooks: number; pages: number; attachments: number; createdAt: string; updatedAt: string; accentColor: string; tags: Array<{ label: string; color: string }> }) {
  return (
    <section className="border border-l-4 bg-white p-4" style={{ borderColor: colorWithAlpha(accentColor, 0.22), borderLeftColor: accentColor, backgroundColor: colorWithAlpha(accentColor, 0.018) }}>
      <div className="mb-4 flex items-center gap-2">
        <span className="block size-2.5 shrink-0" style={{ backgroundColor: accentColor }} />
        <h2 className="text-base font-semibold text-slate-950">Summary</h2>
      </div>
      <dl className="space-y-2.5">
        <div className="grid grid-cols-[120px_minmax(0,1fr)] items-start gap-3">
          <dt className="text-sm text-slate-600">Notebooks</dt>
          <dd className="text-sm font-semibold tabular-nums text-slate-950">{notebooks}</dd>
        </div>
        <div className="grid grid-cols-[120px_minmax(0,1fr)] items-start gap-3">
          <dt className="text-sm text-slate-600">Total pages</dt>
          <dd className="text-sm font-semibold tabular-nums text-slate-950">{pages}</dd>
        </div>
        <div className="grid grid-cols-[120px_minmax(0,1fr)] items-start gap-3">
          <dt className="text-sm text-slate-600">Attachments</dt>
          <dd className="text-sm font-semibold tabular-nums text-slate-950">{attachments}</dd>
        </div>
        <div className="grid grid-cols-[120px_minmax(0,1fr)] items-start gap-3">
          <dt className="text-sm text-slate-600">Created on</dt>
          <dd className="text-sm text-slate-950">{formatDateTime(createdAt)}</dd>
        </div>
        <div className="grid grid-cols-[120px_minmax(0,1fr)] items-start gap-3">
          <dt className="text-sm text-slate-600">Last updated</dt>
          <dd className="text-sm text-slate-950">{formatDateTime(updatedAt)}</dd>
        </div>
        <div className="grid grid-cols-[120px_minmax(0,1fr)] items-start gap-3">
          <dt className="pt-0.5 text-sm text-slate-600">Tags</dt>
          <dd className="flex min-w-0 flex-wrap gap-1.5">
            {tags.length ? (
              tags.slice(0, 12).map((tag) => (
                <span key={tag.label} className="inline-flex h-6 max-w-full items-center truncate border px-2 text-xs font-medium text-slate-700" style={{ borderColor: colorWithAlpha(tag.color, 0.25), backgroundColor: colorWithAlpha(tag.color, 0.08) }}>
                  {tag.label}
                </span>
              ))
            ) : (
              <span className="text-sm text-slate-400">None</span>
            )}
            {tags.length > 12 ? <span className="text-sm text-slate-400">+{tags.length - 12} more</span> : null}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function ShareProjectPanel({ project, refreshWorkspace }: { project: Project; refreshWorkspace: () => Promise<void> }) {
  return (
    <ShareForm
      label="User email"
      submitLabel="Add member"
      onSubmit={async ({ email, role }) => {
        await fetch(`/api/projects/${project.id}/members`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, role }),
        }).then(assertOk);
        await refreshWorkspace();
      }}
    />
  );
}

function NotebookShareModal({ notebook, user, onCancel, onChanged }: { notebook: Notebook; user: AppUser; onCancel: () => void; onChanged: () => Promise<void> }) {
  const canManage = user.role === "admin" || notebook.accessRole === "owner";
  return (
    <ModalFrame>
      <div className="space-y-5">
        <div>
          <h2 className="text-lg font-semibold text-white">Share notebook</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">{notebook.name}</p>
        </div>
        {canManage ? (
          <ShareForm
            label="User email"
            submitLabel="Share"
            dark
            onSubmit={async ({ email, role }) => {
              await fetch(`/api/notebooks/${notebook.id}/members`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, role }),
              }).then(assertOk);
              await onChanged();
            }}
          />
        ) : null}
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-200">Notebook-only members</h3>
          <MemberList members={notebook.members} dark emptyText="No notebook-only members." onRemove={canManage ? async (member) => {
            await removeNotebookMember(notebook.id, member.userId);
            await onChanged();
          } : undefined} />
        </div>
        <div className="flex justify-end">
          <button onClick={onCancel} className="h-9 border border-white/10 px-3 text-sm text-slate-200 hover:bg-white/10">Close</button>
        </div>
      </div>
    </ModalFrame>
  );
}

function ShareForm({ label, submitLabel, dark = false, onSubmit }: { label: string; submitLabel: string; dark?: boolean; onSubmit: (input: { email: string; role: AccessRole }) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AccessRole>("editor");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const disabled = submitting || !email.trim();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    setError("");
    setSubmitting(true);
    try {
      await onSubmit({ email: email.trim(), role });
      setEmail("");
      setRole("editor");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to share.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label className={`block text-sm font-medium ${dark ? "text-slate-200" : "text-slate-700"}`}>
        {label}
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          type="email"
          className={`mt-1 h-9 w-full border px-3 text-sm outline-none ${dark ? "border-white/10 bg-slate-950 text-white focus:border-cyan-400" : "border-slate-300 bg-white text-slate-950 focus:border-cyan-600"}`}
        />
      </label>
      <div className="flex gap-2">
        <select
          value={role}
          onChange={(event) => setRole(event.target.value as AccessRole)}
          className={`h-9 flex-1 border px-2 text-sm outline-none ${dark ? "border-white/10 bg-slate-950 text-white" : "border-slate-300 bg-white text-slate-950"}`}
        >
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
          <option value="owner">Owner</option>
        </select>
        <button disabled={disabled} className={`h-9 px-3 text-sm font-semibold ${dark ? "bg-cyan-400 text-slate-950 disabled:bg-slate-700 disabled:text-slate-400" : "bg-slate-950 text-white disabled:bg-slate-300"}`}>
          {submitting ? "Saving..." : submitLabel}
        </button>
      </div>
      {error ? <p className={`text-sm ${dark ? "text-rose-300" : "text-rose-600"}`}>{error}</p> : null}
    </form>
  );
}

function MemberList({ members, emptyText, dark = false, onRemove }: { members: ShareMember[]; emptyText: string; dark?: boolean; onRemove?: (member: ShareMember) => Promise<void> }) {
  if (!members.length) return <p className={`text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}>{emptyText}</p>;
  return (
    <div className="space-y-2">
      {members.map((member) => (
        <div key={member.userId} className={`flex items-center justify-between gap-3 border p-2 ${dark ? "border-white/10 bg-slate-950" : "border-slate-200 bg-white"}`}>
          <div className="min-w-0">
            <p className={`truncate text-sm font-medium ${dark ? "text-slate-100" : "text-slate-950"}`}>{member.name}</p>
            <p className={`truncate text-xs ${dark ? "text-slate-500" : "text-slate-500"}`}>{member.email} · {member.role}</p>
          </div>
          {onRemove ? (
            <button
              onClick={() => void onRemove(member)}
              className={`grid size-7 shrink-0 place-items-center border ${dark ? "border-white/10 text-slate-300 hover:bg-white/10" : "border-slate-200 text-slate-500 hover:bg-slate-100"}`}
              title="Remove access"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

async function removeProjectMember(projectId: string, userId: string) {
  await fetch(`/api/projects/${projectId}/members/${userId}`, { method: "DELETE" }).then(assertOk);
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
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Account</p>
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
        <div className="grid size-10 place-items-center bg-slate-950 text-cyan-300">
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
        <div className="grid size-10 place-items-center bg-slate-950 text-cyan-300">
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
          <div className="grid size-10 place-items-center bg-slate-950 text-cyan-300">
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
                <th className="px-4 py-3 font-semibold">Projects</th>
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
                  <td className="px-4 py-3 text-slate-700">{user.projectCount}</td>
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
        { label: "Projects", value: overview.counts.projects.toLocaleString() },
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
          <div className="grid size-10 place-items-center bg-slate-950 text-cyan-300">
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
                  <th className="px-4 py-3 font-semibold">Project</th>
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
                      <div className="mt-1 text-xs text-slate-500">{file.notebookName}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-slate-700">{file.projectName}</div>
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

function EditorPane({ page, selectedProject, selectedNotebook, saving, uploadInlineFile, onInlineAttachmentInserted, openSpreadsheet, openPresentation, deleteAttachment, patchSelectedPage, savePage, setPageTags, openFilePicker }: { page: PageEntry; selectedProject?: Project; selectedNotebook?: Notebook; saving: string; uploadInlineFile: (file: File, blockType: BlockType) => Promise<Attachment | null>; onInlineAttachmentInserted: (attachment: Attachment, body: string) => void; openSpreadsheet: (attachment: InlineAttachmentAttrs, onSaved?: (attachment: InlineAttachmentAttrs) => void) => void; openPresentation: (attachment: InlineAttachmentAttrs) => void; deleteAttachment: (attachment: Attachment) => Promise<void>; patchSelectedPage: (patch: Partial<PageEntry>) => void; savePage: (patch: { title?: string; body?: string; status?: "Draft" | "Final" }) => Promise<void>; setPageTags: (tags: string[]) => Promise<void>; openFilePicker: () => void }) {
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const attachmentCount = page.attachments.length;
  const attachmentLabel = `${attachmentCount} file${attachmentCount === 1 ? "" : "s"}`;
  const color = projectColor(selectedProject);

  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-white">
      <header className="border-b border-slate-200 px-6 py-4">
        <div className="mb-2 flex items-center gap-2 text-sm text-slate-500"><span>{selectedProject?.name}</span><ChevronRight size={14} /><span>{selectedNotebook?.name}</span>{saving ? <span className="ml-2 px-2 py-0.5 text-xs" style={{ backgroundColor: colorWithAlpha(color, 0.1), color }}>{saving}</span> : null}</div>
        <div className="flex items-center gap-3">
          <input value={page.title} onChange={(event) => patchSelectedPage({ title: event.target.value })} onBlur={(event) => void savePage({ title: event.target.value })} className="min-w-0 flex-1 bg-transparent py-1 text-4xl font-semibold leading-tight tracking-normal text-slate-950 outline-none" />
        </div>
        <PageTagsBar tags={page.tags} setPageTags={setPageTags} />
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
  const [draft, setDraft] = useState("");
  const normalizedTags = useMemo(() => normalizeTagList(tags), [tags]);

  function addDraftTag() {
    const nextTags = normalizeTagList([...normalizedTags, draft]);
    setDraft("");
    if (nextTags.length !== normalizedTags.length) void setPageTags(nextTags);
  }

  function removeTag(tag: string) {
    void setPageTags(normalizedTags.filter((candidate) => candidate !== tag));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addDraftTag();
    }
    if (event.key === "Backspace" && !draft && normalizedTags.length) {
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
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={addDraftTag}
        className="h-7 min-w-36 flex-1 border-0 bg-transparent px-1 text-sm text-slate-700 outline-none placeholder:text-slate-400"
        placeholder="Type to add..."
      />
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

function SidebarSection({ label, onAdd }: { label: string; onAdd: () => void }) {
  return (
    <div className="sidebar-wide px-4">
      <div className="flex min-w-0 items-center justify-between gap-2 px-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
        <span className="min-w-0 truncate">{label}</span>
        <button onClick={onAdd} className="grid size-6 shrink-0 place-items-center text-slate-400 hover:bg-white/10 hover:text-white" title={`Create ${label.toLowerCase()}`}><Plus size={14} /></button>
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function projectColor(project: Pick<Project, "color"> | undefined) {
  return normalizeColor(project?.color);
}

const PAGE_CARD_TINT_ALPHA = 0.075;

function pageCardTintStyle(value: string | undefined) {
  return {
    backgroundColor: colorWithAlpha(value, PAGE_CARD_TINT_ALPHA),
    borderColor: "#e2e8f0",
  };
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
    url.searchParams.delete("notebook");
    url.searchParams.delete("project");
  } else {
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
    url.searchParams.delete("page");
    url.searchParams.delete("project");
  } else {
    url.searchParams.delete("notebook");
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
    url.searchParams.delete("page");
    url.searchParams.delete("notebook");
  } else {
    url.searchParams.delete("project");
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
