import type { Notebook, PageEntry, Workspace } from "@/lib/types";

export type PageUpdater = (page: PageEntry) => PageEntry;

function addPageToNotebooks(notebooks: Notebook[], page: PageEntry) {
  return notebooks.map((notebook) => {
    if (notebook.id !== page.notebookId) return notebook;
    return {
      ...notebook,
      updatedAt: page.updatedAt,
      pages: [page, ...notebook.pages.filter((candidate) => candidate.id !== page.id)],
    };
  });
}

function removePageFromNotebooks(notebooks: Notebook[], pageId: string, updatedAt: string) {
  return notebooks.map((notebook) => {
    if (!notebook.pages.some((page) => page.id === pageId)) return notebook;
    return {
      ...notebook,
      updatedAt,
      pages: notebook.pages.filter((page) => page.id !== pageId),
    };
  });
}

function updatePageInNotebooks(notebooks: Notebook[], pageId: string, updater: PageUpdater) {
  let changed = false;
  const nextNotebooks = notebooks.map((notebook) => {
    const pageIndex = notebook.pages.findIndex((page) => page.id === pageId);
    if (pageIndex < 0) return notebook;
    const currentPage = notebook.pages[pageIndex];
    const nextPage = updater(currentPage);
    if (nextPage === currentPage) return notebook;
    const pages = [...notebook.pages];
    pages[pageIndex] = nextPage;
    changed = true;
    return { ...notebook, pages };
  });
  return changed ? nextNotebooks : notebooks;
}

export function addPageToWorkspace(workspace: Workspace, page: PageEntry): Workspace {
  return {
    ...workspace,
    notebooks: addPageToNotebooks(workspace.notebooks, page),
    projects: workspace.projects.map((project) => ({
      ...project,
      notebooks: addPageToNotebooks(project.notebooks, page),
    })),
  };
}

export function updatePageInWorkspace(workspace: Workspace, pageId: string, updater: PageUpdater): Workspace {
  const notebooks = updatePageInNotebooks(workspace.notebooks, pageId, updater);
  let projectsChanged = false;
  const projects = workspace.projects.map((project) => {
    const projectNotebooks = updatePageInNotebooks(project.notebooks, pageId, updater);
    if (projectNotebooks === project.notebooks) return project;
    projectsChanged = true;
    return { ...project, notebooks: projectNotebooks };
  });
  if (notebooks === workspace.notebooks && !projectsChanged) return workspace;
  return { ...workspace, notebooks, projects };
}

export function removePageFromWorkspace(workspace: Workspace, pageId: string, updatedAt: string): Workspace {
  return {
    ...workspace,
    notebooks: removePageFromNotebooks(workspace.notebooks, pageId, updatedAt),
    projects: workspace.projects.map((project) => ({
      ...project,
      notebooks: removePageFromNotebooks(project.notebooks, pageId, updatedAt),
    })),
  };
}
