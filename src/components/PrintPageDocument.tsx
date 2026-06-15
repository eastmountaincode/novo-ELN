"use client";

import type { JSONContent } from "@tiptap/react";
import type { ReactNode } from "react";
import { bodyToEditorDocument } from "@/lib/editor";
import type { Notebook, PageEntry } from "@/lib/types";

type Mark = NonNullable<JSONContent["marks"]>[number];

export function PrintPageDocument({ page, notebook, content }: { page: PageEntry; notebook?: Notebook; content?: JSONContent[] }) {
  const document = bodyToEditorDocument(page.body);
  const printContent = content ?? document.content;

  return (
    <article className="print-page-root" aria-hidden="true">
      <header className="print-page-header">
        {notebook?.name ? <p className="print-page-notebook">Notebook: {notebook.name}</p> : null}
        <h1>{page.title || "Untitled"}</h1>
        <dl>
          <div>
            <dt>Created</dt>
            <dd>{formatPrintDate(page.createdAt)}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{formatPrintDate(page.updatedAt)}</dd>
          </div>
          <div>
            <dt>Printed</dt>
            <dd>{formatPrintDate(new Date().toISOString())}</dd>
          </div>
          {page.status ? (
            <div>
              <dt>Status</dt>
              <dd>{page.status}</dd>
            </div>
          ) : null}
        </dl>
        {page.tags.length ? (
          <div className="print-page-tags">
            {page.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        ) : null}
      </header>
      <div className="print-rich-text">{renderContent(printContent)}</div>
    </article>
  );
}

function renderContent(content?: JSONContent[]) {
  return content?.map((node, index) => renderNode(node, index)) ?? null;
}

function renderNode(node: JSONContent, index: number): ReactNode {
  switch (node.type) {
    case "paragraph":
      return <p key={index}>{renderContent(node.content)}</p>;
    case "heading": {
      const level = Number(node.attrs?.level ?? 1);
      const className = level === 2 ? "print-heading print-heading-2" : "print-heading print-heading-1";
      return level === 2 ? <h2 key={index} className={className}>{renderContent(node.content)}</h2> : <h1 key={index} className={className}>{renderContent(node.content)}</h1>;
    }
    case "text":
      return applyMarks(node.text ?? "", node.marks ?? [], index);
    case "hardBreak":
      return <br key={index} />;
    case "bulletList":
      return <ul key={index}>{renderContent(node.content)}</ul>;
    case "orderedList":
      return <ol key={index}>{renderContent(node.content)}</ol>;
    case "listItem":
      return <li key={index}>{renderContent(node.content)}</li>;
    case "blockquote":
      return <blockquote key={index}>{renderContent(node.content)}</blockquote>;
    case "codeBlock":
      return <pre key={index}><code>{node.content?.map((child) => child.text ?? "").join("")}</code></pre>;
    case "table":
      return <table key={index}><tbody>{renderContent(node.content)}</tbody></table>;
    case "tableRow":
      return <tr key={index}>{renderContent(node.content)}</tr>;
    case "tableHeader":
      return <th key={index}>{renderContent(node.content)}</th>;
    case "tableCell":
      return <td key={index}>{renderContent(node.content)}</td>;
    case "attachmentCard":
      return <PrintAttachment key={index} attrs={node.attrs ?? {}} />;
    default:
      return renderContent(node.content);
  }
}

function applyMarks(text: string, marks: Mark[], key: number): ReactNode {
  return marks.reduce<ReactNode>((content, mark) => {
    if (mark.type === "bold") return <strong>{content}</strong>;
    if (mark.type === "italic") return <em>{content}</em>;
    if (mark.type === "underline") return <u>{content}</u>;
    if (mark.type === "strike") return <s>{content}</s>;
    if (mark.type === "code") return <code>{content}</code>;
    if (mark.type === "link") {
      const href = String(mark.attrs?.href ?? "");
      return <a href={href}>{content}</a>;
    }
    if (mark.type === "textStyle" && mark.attrs?.color) {
      return <span style={{ color: String(mark.attrs.color) }}>{content}</span>;
    }
    return content;
  }, <span key={key}>{text}</span>);
}

function PrintAttachment({ attrs }: { attrs: Record<string, unknown> }) {
  const attachmentId = String(attrs.attachmentId ?? "");
  const filename = String(attrs.filename ?? "Attachment");
  const kind = String(attrs.kind ?? "file");
  const mimeType = String(attrs.mimeType ?? "");
  const size = Number(attrs.size ?? 0);
  const viewUrl = attachmentId ? `/api/attachments/${encodeURIComponent(attachmentId)}/view` : "";

  if (kind === "image" && viewUrl) {
    return (
      <figure className="print-inline-image">
        <img src={viewUrl} alt={filename} />
        <figcaption>{filename}</figcaption>
      </figure>
    );
  }

  return (
    <div className="print-inline-attachment">
      <span className="print-inline-attachment-label">Inline attachment</span>
      <strong>{filename}</strong>
      <span>{formatAttachmentKind(kind, mimeType)}{size > 0 ? ` · ${formatBytes(size)}` : ""}</span>
    </div>
  );
}

function formatAttachmentKind(kind: string, mimeType: string) {
  const labels: Record<string, string> = {
    sheet: "Spreadsheet",
    pdf: "PDF",
    slides: "Presentation",
    sequence: "Sequence",
    file: "File",
  };
  return labels[kind] ?? (mimeType || "File");
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatPrintDate(value: string) {
  const parsed = Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(parsed)) return value || "Unknown";
  const date = new Date(parsed);
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
