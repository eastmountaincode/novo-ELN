import type { Notebook, PageEntry, Workspace } from "@/lib/types";

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
