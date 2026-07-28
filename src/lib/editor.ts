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
  return JSON.stringify(sanitizeEditorNode(document));
}

export function removeAttachmentCardsFromBody(body: string, attachmentId: string) {
  const parsed = parseEditorDocument(body);
  if (!parsed) return body;
  return editorDocumentToBody(removeAttachmentCards(parsed, attachmentId) ?? emptyEditorDocument);
}

export function remapAttachmentCardsInBody(body: string, attachmentIdMap: Record<string, string>) {
  const parsed = parseEditorDocument(body);
  if (!parsed) return body;
  return editorDocumentToBody(remapAttachmentCards(parsed, attachmentIdMap));
}

export function removeCommentMarksFromBody(body: string, threadId: string) {
  const parsed = parseEditorDocument(body);
  if (!parsed) return body;
  return editorDocumentToBody(removeCommentMarks(parsed, threadId));
}

export function removeUnknownCommentMarksFromBody(body: string, validThreadIds: ReadonlySet<string>) {
  const parsed = parseEditorDocument(body);
  if (!parsed) return body;
  return editorDocumentToBody(removeUnknownCommentMarks(parsed, validThreadIds));
}

export function commentThreadIdsFromBody(body: string) {
  const parsed = parseEditorDocument(body);
  if (!parsed) return [];
  const threadIds = new Set<string>();
  collectCommentThreadIds(parsed, threadIds);
  return [...threadIds];
}

export function attachmentIdsFromBody(body: string) {
  const parsed = parseEditorDocument(body);
  if (!parsed) return [];
  const attachmentIds = new Set<string>();
  collectAttachmentIds(parsed, attachmentIds);
  return [...attachmentIds];
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

type EditorAttrs = Record<string, unknown>;
type EditorMark = NonNullable<JSONContent["marks"]>[number];

function sanitizeEditorNode(node: JSONContent): JSONContent {
  const next: JSONContent = { ...node };
  const attrs = sanitizeEditorAttrs(node.type ?? "", node.attrs as EditorAttrs | undefined);
  if (attrs) next.attrs = attrs;
  else delete next.attrs;

  if (node.marks?.length) {
    const marks = node.marks.map(sanitizeEditorMark).filter((mark) => Boolean(mark.type));
    if (marks.length) next.marks = marks;
    else delete next.marks;
  }

  if (node.content?.length) next.content = node.content.map(sanitizeEditorNode);
  else delete next.content;

  return next;
}

function sanitizeEditorMark(mark: EditorMark): EditorMark {
  const next: EditorMark = { ...mark };
  const attrs = sanitizeEditorAttrs(mark.type ?? "", mark.attrs as EditorAttrs | undefined);
  if (attrs) next.attrs = attrs;
  else delete next.attrs;
  return next;
}

function sanitizeEditorAttrs(nodeType: string, attrs?: EditorAttrs): EditorAttrs | undefined {
  if (!attrs) return undefined;
  const next: EditorAttrs = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (shouldDropDefaultEditorAttr(nodeType, key, value)) continue;
    next[key] = value;
  }
  return Object.keys(next).length ? next : undefined;
}

function shouldDropDefaultEditorAttr(nodeType: string, key: string, value: unknown) {
  if (value === null || value === undefined) return true;
  if ((nodeType === "tableCell" || nodeType === "tableHeader") && key === "colspan" && Number(value) === 1) return true;
  if ((nodeType === "tableCell" || nodeType === "tableHeader") && key === "rowspan" && Number(value) === 1) return true;
  if ((nodeType === "tableCell" || nodeType === "tableHeader") && key === "colwidth" && Array.isArray(value) && value.length === 0) return true;
  if (nodeType === "attachmentCard" && key === "displayWidth") {
    const width = Number(value);
    return !Number.isFinite(width) || width <= 0;
  }
  return false;
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

function remapAttachmentCards(node: JSONContent, attachmentIdMap: Record<string, string>): JSONContent {
  const attrs = node.attrs ? { ...node.attrs } : undefined;
  if (node.type === "attachmentCard" && attrs) {
    const attachmentId = String(attrs.attachmentId ?? "");
    if (attachmentIdMap[attachmentId]) attrs.attachmentId = attachmentIdMap[attachmentId];
  }
  return {
    ...node,
    ...(attrs ? { attrs } : {}),
    ...(node.content ? { content: node.content.map((child) => remapAttachmentCards(child, attachmentIdMap)) } : {}),
  };
}

function removeCommentMarks(node: JSONContent, threadId: string): JSONContent {
  const next: JSONContent = { ...node };
  if (node.marks?.length) {
    const marks = node.marks.filter((mark) => mark.type !== "comment" || String(mark.attrs?.threadId ?? "") !== threadId);
    if (marks.length) next.marks = marks;
    else delete next.marks;
  }
  if (node.content?.length) next.content = node.content.map((child) => removeCommentMarks(child, threadId));
  return next;
}

function removeUnknownCommentMarks(node: JSONContent, validThreadIds: ReadonlySet<string>): JSONContent {
  const next: JSONContent = { ...node };
  if (node.marks?.length) {
    const marks = node.marks.filter((mark) => {
      if (mark.type !== "comment") return true;
      return validThreadIds.has(String(mark.attrs?.threadId ?? ""));
    });
    if (marks.length) next.marks = marks;
    else delete next.marks;
  }
  if (node.content?.length) {
    next.content = node.content.map((child) => removeUnknownCommentMarks(child, validThreadIds));
  }
  return next;
}

function collectCommentThreadIds(node: JSONContent, threadIds: Set<string>) {
  for (const mark of node.marks ?? []) {
    if (mark.type !== "comment") continue;
    const threadId = String(mark.attrs?.threadId ?? "");
    if (threadId) threadIds.add(threadId);
  }
  for (const child of node.content ?? []) collectCommentThreadIds(child, threadIds);
}

function collectAttachmentIds(node: JSONContent, attachmentIds: Set<string>) {
  if (node.type === "attachmentCard") {
    const attachmentId = String(node.attrs?.attachmentId ?? "");
    if (attachmentId) attachmentIds.add(attachmentId);
  }
  for (const child of node.content ?? []) {
    collectAttachmentIds(child, attachmentIds);
  }
}
