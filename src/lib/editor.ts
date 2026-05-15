import type { JSONContent } from "@tiptap/react";

export const emptyEditorDocument: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

export function bodyToEditorDocument(body: string): JSONContent {
  const parsed = parseEditorDocument(body);
  if (parsed) return parsed;

  const text = body.trim();
  if (!text) return emptyEditorDocument;

  return {
    type: "doc",
    content: text.split(/\n{2,}/).map((paragraph) => ({
      type: "paragraph",
      content: paragraph
        .split(/\n/)
        .flatMap((line, index) =>
          index === 0
            ? [{ type: "text", text: line }]
            : [{ type: "hardBreak" }, { type: "text", text: line }],
        ),
    })),
  };
}

export function bodyToEditorText(body: string) {
  const parsed = parseEditorDocument(body);
  if (!parsed) return body;
  return editorDocumentToText(parsed);
}

export function editorDocumentToBody(document: JSONContent) {
  return JSON.stringify(document);
}

export function removeAttachmentCardsFromBody(body: string, attachmentId: string) {
  const parsed = parseEditorDocument(body);
  if (!parsed) return body;
  return editorDocumentToBody(removeAttachmentCards(parsed, attachmentId) ?? emptyEditorDocument);
}

function parseEditorDocument(body: string): JSONContent | null {
  if (!body.trim().startsWith("{")) return null;
  try {
    const parsed = JSON.parse(body) as JSONContent;
    return parsed?.type === "doc" ? parsed : null;
  } catch {
    return null;
  }
}

function editorDocumentToText(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "attachmentCard") return `[${String(node.attrs?.kind ?? "File")}: ${String(node.attrs?.filename ?? "attachment")}]\n`;
  const childText = node.content?.map(editorDocumentToText).join("") ?? "";
  if (["paragraph", "heading", "blockquote", "listItem"].includes(node.type ?? "")) return `${childText}\n`;
  return childText;
}

function removeAttachmentCards(node: JSONContent, attachmentId: string): JSONContent | null {
  if (node.type === "attachmentCard" && String(node.attrs?.attachmentId ?? "") === attachmentId) return null;
  if (!node.content) return node;
  const content = node.content
    .map((child) => removeAttachmentCards(child, attachmentId))
    .filter((child): child is JSONContent => Boolean(child));
  return { ...node, content };
}
