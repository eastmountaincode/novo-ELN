export type PageReferenceSuggestion = {
  id: string;
  title: string;
  notebookName: string;
  updatedAt: string;
};

export function pageReferenceHref(id: string) {
  return `/?page=${encodeURIComponent(id)}`;
}
