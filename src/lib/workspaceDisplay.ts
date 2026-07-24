import type { AppUser, Notebook, Project, ShareMember } from "@/lib/types";

export function projectColor(project: Pick<Project | Notebook, "color"> | undefined) {
  return normalizeColor(project?.color);
}

export function canEditNotebook(user: AppUser | undefined, notebook: Notebook | undefined) {
  if (!user || !notebook) return false;
  return notebook.accessRole === "owner" || notebook.accessRole === "editor";
}

export function userDisplayName(user: Pick<AppUser | ShareMember, "firstName" | "lastName" | "email">) {
  return `${user.firstName} ${user.lastName}`.trim() || user.email;
}

export function normalizeColor(value: string | undefined) {
  return /^#[0-9a-f]{6}$/i.test(value ?? "") ? value!.toLowerCase() : "#0891b2";
}

export function colorWithAlpha(value: string | undefined, alpha: number) {
  const color = normalizeColor(value).slice(1);
  const red = Number.parseInt(color.slice(0, 2), 16);
  const green = Number.parseInt(color.slice(2, 4), 16);
  const blue = Number.parseInt(color.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
