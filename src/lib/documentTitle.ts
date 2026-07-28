import type { NovoBrand } from "./novoInstance";

export function getNovoDocumentTitle(wordmark: NovoBrand["wordmark"], pageTitle: string | null) {
  if (pageTitle === null) return wordmark;

  const normalizedPageTitle = pageTitle.trim() || "Untitled";
  return `${wordmark} - ${normalizedPageTitle}`;
}
