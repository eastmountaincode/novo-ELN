import { describe, expect, it } from "vitest";
import {
  addPageToWorkspace,
  removePageFromWorkspace,
  updatePageInWorkspace,
} from "../src/features/pages/workspacePageState";
import type { Notebook, PageEntry, Workspace } from "../src/lib/types";

function page(id: string, notebookId: string): PageEntry {
  return {
    id,
    notebookId,
    title: id,
    body: "",
    bodyLoaded: true,
    status: "",
    ownerId: "user-1",
    ownerFirstName: "Test",
    ownerLastName: "User",
    lockedAt: "",
    lockedBy: "",
    lockedByFirstName: "",
    lockedByLastName: "",
    createdAt: "2026-07-27T12:00:00.000Z",
    updatedAt: "2026-07-27T12:00:00.000Z",
    tags: [],
    attachments: [],
    attachmentCount: 0,
    attachmentBytes: 0,
  };
}

function notebook(id: string, pages: PageEntry[]): Notebook {
  return {
    id,
    name: id,
    color: "#0891b2",
    pageTitleTemplate: "",
    pageTitleTemplateEnabled: false,
    ownerId: "user-1",
    createdAt: "2026-07-27T11:00:00.000Z",
    updatedAt: "2026-07-27T11:00:00.000Z",
    accessRole: "owner",
    members: [],
    pages,
  };
}

function workspace(): Workspace {
  const firstNotebook = notebook("notebook-1", [page("page-1", "notebook-1")]);
  const secondNotebook = notebook("notebook-2", [page("page-2", "notebook-2")]);
  return {
    user: {
      id: "user-1",
      email: "test@example.local",
      firstName: "Test",
      lastName: "User",
      role: "admin",
    },
    appSettings: {
      prependDateToNewPages: false,
      suggestTagsGlobally: true,
    },
    members: [],
    notebooks: [firstNotebook, secondNotebook],
    projects: [{
      id: "workspace",
      name: "Notebooks",
      description: "",
      color: "#0891b2",
      ownerId: "user-1",
      createdAt: "2026-07-27T10:00:00.000Z",
      updatedAt: "2026-07-27T11:00:00.000Z",
      accessScope: "notebook",
      accessRole: "owner",
      members: [],
      notebooks: [firstNotebook, secondNotebook],
    }],
  };
}

describe("workspace page state", () => {
  it("adds a created page to both notebook views without reloading the workspace", () => {
    const current = workspace();
    const created = page("page-3", "notebook-1");
    const next = addPageToWorkspace(current, created);

    expect(next.notebooks[0].pages.map((candidate) => candidate.id)).toEqual(["page-3", "page-1"]);
    expect(next.projects[0].notebooks[0].pages.map((candidate) => candidate.id)).toEqual(["page-3", "page-1"]);
    expect(next.notebooks[1]).toBe(current.notebooks[1]);
  });

  it("removes a deleted page from both notebook views and leaves unrelated notebooks intact", () => {
    const current = workspace();
    const next = removePageFromWorkspace(current, "page-1", "2026-07-27T12:30:00.000Z");

    expect(next.notebooks[0].pages).toEqual([]);
    expect(next.projects[0].notebooks[0].pages).toEqual([]);
    expect(next.notebooks[0].updatedAt).toBe("2026-07-27T12:30:00.000Z");
    expect(next.notebooks[1]).toBe(current.notebooks[1]);
  });

  it("updates a page in both notebook views without replacing unrelated notebooks", () => {
    const current = workspace();
    const next = updatePageInWorkspace(current, "page-1", (candidate) => ({ ...candidate, title: "Updated" }));

    expect(next.notebooks[0].pages[0].title).toBe("Updated");
    expect(next.projects[0].notebooks[0].pages[0].title).toBe("Updated");
    expect(next.notebooks[1]).toBe(current.notebooks[1]);
    expect(next.projects[0].notebooks[1]).toBe(current.projects[0].notebooks[1]);
  });

  it("returns the existing workspace when the requested page is absent", () => {
    const current = workspace();
    const next = updatePageInWorkspace(current, "missing", (candidate) => ({ ...candidate, title: "Updated" }));

    expect(next).toBe(current);
  });
});
