"use client";

import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Home as HomeIcon,
  MessageSquareText,
  MoreHorizontal,
  Notebook as NotebookIcon,
  Palette,
  Pencil,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
  UserCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NovoDeploymentLabel, NovoWordmark } from "@/components/NovoInstanceProvider";
import { appBuildId, appVersion } from "@/generated/app-version";
import { readStoredSortKey, timestampForSort, writeStoredSortKey } from "@/lib/clientSorting";
import type { Notebook, Project, Workspace } from "@/lib/types";
import { canEditNotebook, colorWithAlpha, projectColor, userDisplayName } from "@/lib/workspaceDisplay";

type NotebookSortKey = "updated" | "created" | "title";

type UnifiedSidebarProps = {
  workspace: Workspace;
  activeView: "home" | "projectHome" | "project" | "notebookSettings" | "account";
  selectedProject?: Project;
  selectedNotebook?: Notebook;
  sidebarCollapsed: boolean;
  accountOpen: boolean;
  projectMenuId: string | null;
  notebookMenuId: string | null;
  expandedProjectIds: Set<string>;
  openSearch: () => void;
  toggleSidebarCollapsed: () => void;
  setAccountOpen: (value: boolean) => void;
  setProjectMenuId: (value: string | null) => void;
  setNotebookMenuId: (value: string | null) => void;
  openHome: () => void;
  openAccount: () => void;
  selectProject: (project: Project) => void;
  toggleProject: (project: Project) => void;
  selectNotebook: (project: Project, notebook: Notebook) => void;
  createNewProject: () => void;
  renameProject: (project: Project) => void;
  updateProjectColor: (project: Project, color: string) => void;
  deleteProject: (project: Project) => void;
  renameNotebook: (notebook: Notebook) => void;
  deleteNotebook: (notebook: Notebook) => void;
  updateNotebookColor: (notebook: Notebook, color: string) => void;
  openNotebookSettings: (notebook: Notebook) => void;
  createNewNotebook: (projectId?: string) => void;
  handleLogout: () => void;
};

const NOTEBOOK_SORT_OPTIONS: Array<{ key: NotebookSortKey; label: string }> = [
  { key: "updated", label: "Date updated" },
  { key: "created", label: "Date created" },
  { key: "title", label: "Title" },
];

const NOTEBOOK_SORT_STORAGE_KEY = "novo.notebookSortKey";
const SIDEBAR_VERSION_TEXT =
  appBuildId && appBuildId !== "unknown" && appBuildId !== appVersion
    ? `${appVersion} · ${appBuildId}`
    : appVersion;

export function UnifiedSidebar({
  workspace,
  activeView,
  selectedNotebook,
  sidebarCollapsed,
  accountOpen,
  notebookMenuId,
  openSearch,
  toggleSidebarCollapsed,
  setAccountOpen,
  setProjectMenuId,
  setNotebookMenuId,
  openHome,
  openAccount,
  selectNotebook,
  renameNotebook,
  deleteNotebook,
  updateNotebookColor,
  openNotebookSettings,
  createNewNotebook,
  handleLogout,
}: UnifiedSidebarProps) {
  const workspaceProject = workspace.projects[0];
  const [myNotebooksCollapsed, setMyNotebooksCollapsed] = useState(false);
  const [sharedNotebooksCollapsed, setSharedNotebooksCollapsed] = useState(false);
  const [notebookSortKey, setNotebookSortKey] = useState<NotebookSortKey>(readStoredNotebookSortKey);
  const [notebookSortOpen, setNotebookSortOpen] = useState(false);
  const notebookSortRef = useRef<HTMLDivElement>(null);
  const sortedOwnNotebooks = useMemo(
    () => sortNotebooks(workspace.notebooks.filter((notebook) => notebook.accessRole === "owner"), notebookSortKey),
    [workspace.notebooks, notebookSortKey],
  );
  const sortedSharedNotebooks = useMemo(
    () => sortNotebooks(workspace.notebooks.filter((notebook) => notebook.accessRole !== "owner"), notebookSortKey),
    [workspace.notebooks, notebookSortKey],
  );

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
    const selected =
      (activeView === "project" || activeView === "notebookSettings") &&
      selectedNotebook?.id === notebook.id;
    const color = projectColor(notebook);
    const canEditNotebookActions = canEditNotebook(workspace.user, notebook);
    const canDeleteNotebookAction = notebook.accessRole === "owner";

    return (
      <div key={notebook.id} className={sidebarCollapsed ? "px-3" : "px-4"}>
        <div
          className={`relative flex w-full min-w-0 items-center gap-1 px-2 py-1.5 text-sm ${
            selected ? "text-white" : "text-slate-300 hover:bg-white/5"
          }`}
          style={{ backgroundColor: selected ? colorWithAlpha(color, 0.1) : undefined }}
        >
          <button
            onClick={() => workspaceProject && selectNotebook(workspaceProject, notebook)}
            className={`flex min-w-0 flex-1 items-center overflow-hidden text-left ${
              sidebarCollapsed ? "justify-center" : "gap-2"
            }`}
            title={notebook.name}
          >
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
            <div
              data-transient-menu="true"
              className="sidebar-wide absolute right-1 top-8 z-20 w-44 border border-white/10 bg-slate-900 py-1 shadow-lg"
            >
              <button
                onClick={() => {
                  setNotebookMenuId(null);
                  openNotebookSettings(notebook);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/10"
              >
                <Settings size={15} className="shrink-0 text-slate-400" />
                <span>Settings</span>
              </button>
              {canEditNotebookActions ? (
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
              ) : null}
              {canEditNotebookActions ? (
                <button
                  onClick={() => {
                    setNotebookMenuId(null);
                    renameNotebook(notebook);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/10"
                >
                  <Pencil size={15} className="shrink-0 text-slate-400" />
                  <span>Rename</span>
                </button>
              ) : null}
              {canDeleteNotebookAction ? (
                <button
                  onClick={() => {
                    setNotebookMenuId(null);
                    deleteNotebook(notebook);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-300 hover:bg-white/10"
                >
                  <Trash2 size={15} className="shrink-0 text-rose-400" />
                  <span>Delete</span>
                </button>
              ) : null}
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
                  className={`flex h-9 w-full items-center justify-between gap-3 px-3 text-left text-sm font-medium ${
                    selected
                      ? "bg-white/10 text-white"
                      : "text-slate-300 hover:bg-white/5 hover:text-white"
                  }`}
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
    <aside
      className={`relative z-30 grid min-h-screen grid-rows-[auto_1fr_auto] bg-slate-950 text-slate-200 ${
        sidebarCollapsed ? "sidebar-collapsed overflow-visible" : "overflow-hidden"
      }`}
    >
      <div className="space-y-2 border-b border-white/10 py-4">
        <div className={sidebarCollapsed ? "px-3" : "px-4"}>
          <div
            className={`flex min-w-0 items-start ${
              sidebarCollapsed ? "justify-center" : "justify-between gap-3"
            }`}
          >
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
              className="sidebar-wide min-w-0 cursor-pointer select-none px-1 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              aria-label="Go to home"
              title="Overview"
            >
              <div className="novo-wordmark text-5xl leading-none tracking-normal text-slate-100">
                <NovoWordmark />
              </div>
              <NovoDeploymentLabel className="mt-1 max-w-full truncate text-xs font-medium leading-none text-slate-400" />
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
            className={`flex h-10 w-full items-center border border-white/10 bg-white/10 text-sm text-slate-400 hover:border-cyan-400 hover:text-slate-200 ${
              sidebarCollapsed ? "justify-center px-0" : "gap-2 px-3 text-left"
            }`}
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
          <button
            onClick={openHome}
            className={`flex w-full min-w-0 items-center overflow-hidden py-2 text-left text-sm ${
              sidebarCollapsed ? "justify-center px-0" : "gap-2 px-2"
            } ${
              activeView === "home"
                ? "bg-white/10 text-white"
                : "text-slate-300 hover:bg-white/5"
            }`}
            title="Overview"
          >
            <HomeIcon size={16} className="shrink-0" />
            <span className="sidebar-wide min-w-0 truncate font-medium">Overview</span>
          </button>
        </div>
        {workspace.integrations?.chat ? (
          <div className={`mb-3 ${sidebarCollapsed ? "px-3" : "px-4"}`}>
            <a
              href={workspace.integrations.chat.url}
              className={`flex w-full min-w-0 items-center overflow-hidden py-2 text-left text-sm text-slate-300 hover:bg-white/5 ${
                sidebarCollapsed ? "justify-center px-0" : "gap-2 px-2"
              }`}
              title="Novo Chat"
            >
              <MessageSquareText size={16} className="shrink-0" />
              <span className="sidebar-wide min-w-0 truncate font-medium">Novo Chat</span>
            </a>
          </div>
        ) : null}
        {!sidebarCollapsed ? (
          <>
            <SidebarSection
              label="My Notebooks"
              collapsed={myNotebooksCollapsed}
              onToggle={() => setMyNotebooksCollapsed((current) => !current)}
              action={notebookSortControl}
              onAdd={() => createNewNotebook(workspaceProject?.id)}
            />
            {!myNotebooksCollapsed ? (
              <div className="mt-2 space-y-1">
                {sortedOwnNotebooks.map(renderNotebook)}
                {sortedOwnNotebooks.length === 0 ? (
                  <p className="sidebar-wide px-6 py-2 text-xs text-slate-500">No notebooks yet.</p>
                ) : null}
              </div>
            ) : null}
            <div className="mt-5">
              <SidebarSection
                label="Shared with Me"
                collapsed={sharedNotebooksCollapsed}
                onToggle={() => setSharedNotebooksCollapsed((current) => !current)}
              />
            </div>
            {!sharedNotebooksCollapsed ? (
              <div className="mt-2 space-y-1">
                {sortedSharedNotebooks.map(renderNotebook)}
                {sortedSharedNotebooks.length === 0 ? (
                  <p className="sidebar-wide px-6 py-2 text-xs text-slate-500">No shared notebooks.</p>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
        {!sidebarCollapsed ? (
          <div
            className="sidebar-wide mt-5 px-6 text-[11px] leading-tight text-slate-500"
            title={`Version ${SIDEBAR_VERSION_TEXT}`}
          >
            <span className="select-text">Novo Version {SIDEBAR_VERSION_TEXT}</span>
          </div>
        ) : null}
      </div>

      <div className="relative border-t border-white/10 py-4">
        {accountOpen ? (
          <div
            data-transient-menu="true"
            className={`${
              sidebarCollapsed
                ? "absolute bottom-4 left-[calc(100%+8px)] z-50 w-64 border border-white/10 bg-slate-900 p-3 shadow-2xl shadow-slate-950/40"
                : "sidebar-wide absolute bottom-16 left-4 right-4 border border-white/10 bg-slate-900 p-3 shadow-lg"
            }`}
          >
            <p className="text-sm font-medium text-white">{userDisplayName(workspace.user)}</p>
            <p className="mt-1 truncate text-xs text-slate-400">{workspace.user.email}</p>
            <p className="mt-2 text-xs capitalize text-slate-500">{workspace.user.role}</p>
            <button
              onClick={openAccount}
              className="mt-3 h-8 w-full border border-white/10 text-sm text-slate-200 hover:bg-white/10"
            >
              Account settings
            </button>
            <button
              onClick={handleLogout}
              className="mt-3 h-8 w-full border border-white/10 text-sm text-slate-200 hover:bg-white/10"
            >
              Sign out
            </button>
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
            className={`flex h-11 w-full min-w-0 items-center overflow-hidden text-left text-sm ${
              sidebarCollapsed ? "justify-center px-0" : "gap-2 px-2"
            } ${
              activeView === "account"
                ? "bg-white/10 text-white"
                : "text-slate-200 hover:bg-white/5"
            }`}
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

function SidebarSection({
  label,
  onAdd,
  action,
  collapsed,
  onToggle,
}: {
  label: string;
  onAdd?: () => void;
  action?: ReactNode;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div className="sidebar-wide px-4">
      <div className="flex min-w-0 items-center justify-between gap-2 px-2 text-xs font-semibold text-slate-500">
        {onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs font-semibold text-slate-500 hover:text-slate-300"
            title={collapsed ? `Expand ${label}` : `Collapse ${label}`}
          >
            {collapsed ? (
              <ChevronRight size={13} className="shrink-0" />
            ) : (
              <ChevronDown size={13} className="shrink-0" />
            )}
            <span className="min-w-0 truncate">{label}</span>
          </button>
        ) : (
          <span className="min-w-0 truncate">{label}</span>
        )}
        <span className="flex shrink-0 items-center gap-1">
          {action}
          {onAdd ? (
            <button
              onClick={onAdd}
              className="grid size-6 shrink-0 place-items-center text-slate-400 hover:bg-white/10 hover:text-white"
              title={`Create ${label.toLowerCase()}`}
            >
              <Plus size={14} />
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
}

function readStoredNotebookSortKey() {
  return readStoredSortKey(NOTEBOOK_SORT_STORAGE_KEY, NOTEBOOK_SORT_OPTIONS, "updated");
}

function sortNotebooks(notebooks: Notebook[], sortKey: NotebookSortKey) {
  return notebooks
    .map((notebook, index) => ({ notebook, index }))
    .sort((left, right) => {
      if (sortKey === "title") {
        const titleCompare = left.notebook.name.localeCompare(right.notebook.name, undefined, {
          sensitivity: "base",
          numeric: true,
        });
        return titleCompare || left.index - right.index;
      }

      const field = sortKey === "created" ? "createdAt" : "updatedAt";
      const timestampCompare =
        timestampForSort(right.notebook[field]) - timestampForSort(left.notebook[field]);
      return timestampCompare || left.index - right.index;
    })
    .map(({ notebook }) => notebook);
}
