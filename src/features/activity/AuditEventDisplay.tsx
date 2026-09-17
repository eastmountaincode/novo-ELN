import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { AuditEvent } from "@/lib/types";
import { userInitials } from "@/lib/workspaceDisplay";

type TextDiffLine = {
  type: "context" | "added" | "removed" | "omitted";
  text: string;
  count?: number;
};

type TextDiffMetadata = {
  format: "novo-plain-text-diff-v1";
  truncated?: boolean;
  reason?: string;
  lines?: TextDiffLine[];
};

type RetainedComment = {
  id?: string;
  userId?: string;
  userFirstName?: string;
  userLastName?: string;
  userEmail?: string;
  body: string;
};

export function auditActorName(event: AuditEvent) {
  const firstName = event.actorFirstName.trim();
  const lastInitial = event.actorLastName.trim()[0];
  if (firstName && lastInitial) return `${firstName} ${lastInitial.toUpperCase()}.`;
  return firstName || event.actorLastName.trim() || event.actorEmail || "Unknown user";
}

export function adminActivitySummary(event: AuditEvent) {
  if (event.action === "notebook.deleted" && typeof event.metadata?.name === "string" && event.metadata.name.trim()) {
    return `deleted notebook "${event.metadata.name.trim()}"`;
  }
  return event.summary;
}

export function AdminActivityContext({ event }: { event: AuditEvent }) {
  if (event.entityType === "user") {
    const targetEmail = typeof event.metadata?.targetEmail === "string" ? event.metadata.targetEmail.trim() : "";
    return <>{targetEmail || "User administration"}</>;
  }
  const pageTitle = event.pageTitle?.trim();
  const notebookName = event.notebookName?.trim();
  if (pageTitle) {
    return (
      <>
        <a href={`/?page=${encodeURIComponent(event.pageId)}`} className="text-slate-600 underline-offset-2 hover:text-blue-700 hover:underline">
          {pageTitle}
        </a>
        {notebookName ? <span> · {notebookName}</span> : null}
      </>
    );
  }
  if (notebookName) return <>{notebookName}</>;
  return <>No longer attached to an active page or notebook</>;
}

export function ActivityTextDiff({ event }: { event: AuditEvent }) {
  const [open, setOpen] = useState(false);

  if (event.action !== "page.body.updated") return null;
  const textDiff = readTextDiffMetadata(event.metadata?.textDiff);
  if (!textDiff) return null;
  if (!textDiff.lines?.length) {
    if (!textDiff.reason) return null;
    return <p className="mt-2 border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-500">{textDiff.reason}</p>;
  }

  const counts = textDiff.lines.reduce(
    (total, line) => ({
      added: total.added + (line.type === "added" ? 1 : 0),
      removed: total.removed + (line.type === "removed" ? 1 : 0),
    }),
    { added: 0, removed: 0 },
  );

  return (
    <div className="mt-2 text-xs">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-7 items-center gap-1.5 border border-slate-200 bg-white px-2 font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-950"
        aria-expanded={open}
        aria-label={open ? "Hide text changes" : "Show text changes"}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span>Text changes</span>
        <span className="text-emerald-700">+{counts.added}</span>
        <span className="text-rose-700">-{counts.removed}</span>
        {textDiff.truncated ? <span className="text-slate-400">shortened</span> : null}
      </button>
      {open ? (
        <div className="mt-2 max-h-80 overflow-x-hidden overflow-y-auto border border-slate-200 bg-slate-50">
          <div className="font-mono leading-5">
            {textDiff.lines.map((line, index) => (
              <div key={`${index}-${line.type}`} className={`grid grid-cols-[1.5rem_minmax(0,1fr)] ${diffLineClassName(line.type)}`}>
                <span className="select-none text-center">{diffLinePrefix(line.type)}</span>
                <span className="whitespace-pre-wrap break-words pr-2 [overflow-wrap:anywhere]">{line.text || " "}</span>
              </div>
            ))}
          </div>
          {textDiff.reason ? <div className="border-t border-slate-200 px-2 py-1 text-slate-500">{textDiff.reason}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

export function ActivityCommentHistory({ event }: { event: AuditEvent }) {
  const retained = retainedComments(event);
  if (!retained.comments.length) return null;

  if (event.action !== "page.comment.deleted") {
    return (
      <blockquote className="mt-2 whitespace-pre-wrap break-words border-l-2 border-slate-300 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-700 [overflow-wrap:anywhere]">
        {retained.comments[0].body}
      </blockquote>
    );
  }

  return (
    <details className="mt-2 border border-slate-200 bg-slate-50 text-xs text-slate-700">
      <summary className="cursor-pointer px-3 py-2 font-medium text-slate-600">
        Retained comment history ({retained.comments.length})
      </summary>
      <div className="space-y-3 border-t border-slate-200 px-3 py-3">
        {retained.selectedText ? (
          <p className="whitespace-pre-wrap break-words text-slate-500 [overflow-wrap:anywhere]">
            Commented text: “{retained.selectedText}”
          </p>
        ) : null}
        {retained.comments.map((comment, index) => (
          <div key={comment.id || `${index}-${comment.body}`}>
            <p className="font-medium text-slate-600">{retainedCommentAuthor(comment)}</p>
            <p className="mt-1 whitespace-pre-wrap break-words leading-5 text-slate-700 [overflow-wrap:anywhere]">{comment.body}</p>
          </div>
        ))}
      </div>
    </details>
  );
}

export function auditInitials(event: AuditEvent) {
  return userInitials({ firstName: event.actorFirstName, lastName: event.actorLastName, email: event.actorEmail });
}

function readTextDiffMetadata(value: unknown): TextDiffMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<TextDiffMetadata>;
  if (candidate.format !== "novo-plain-text-diff-v1") return null;
  if (candidate.lines !== undefined && !Array.isArray(candidate.lines)) return null;
  return candidate as TextDiffMetadata;
}

function retainedComments(event: AuditEvent): { selectedText: string; comments: RetainedComment[] } {
  if (event.action === "page.comment.created" || event.action === "page.comment.replied") {
    const comment = readRetainedComment(event.metadata?.comment);
    return {
      selectedText: typeof event.metadata?.selectedText === "string" ? event.metadata.selectedText : "",
      comments: comment ? [comment] : [],
    };
  }
  if (event.action !== "page.comment.deleted") return { selectedText: "", comments: [] };
  const deletedThread = readRecord(event.metadata?.deletedThread);
  const comments = Array.isArray(deletedThread?.comments)
    ? deletedThread.comments.map(readRetainedComment).filter((comment): comment is RetainedComment => Boolean(comment))
    : [];
  return {
    selectedText: typeof deletedThread?.selectedText === "string" ? deletedThread.selectedText : "",
    comments,
  };
}

function readRetainedComment(value: unknown): RetainedComment | null {
  const comment = readRecord(value);
  if (!comment || typeof comment.body !== "string") return null;
  return {
    id: typeof comment.id === "string" ? comment.id : undefined,
    userId: typeof comment.userId === "string" ? comment.userId : undefined,
    userFirstName: typeof comment.userFirstName === "string" ? comment.userFirstName : undefined,
    userLastName: typeof comment.userLastName === "string" ? comment.userLastName : undefined,
    userEmail: typeof comment.userEmail === "string" ? comment.userEmail : undefined,
    body: comment.body,
  };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function retainedCommentAuthor(comment: RetainedComment) {
  const fullName = [comment.userFirstName?.trim(), comment.userLastName?.trim()].filter(Boolean).join(" ");
  return fullName || comment.userEmail?.trim() || "Unknown user";
}

function diffLinePrefix(type: TextDiffLine["type"]) {
  if (type === "added") return "+";
  if (type === "removed") return "-";
  return "";
}

function diffLineClassName(type: TextDiffLine["type"]) {
  if (type === "added") return "bg-emerald-50 text-emerald-900";
  if (type === "removed") return "bg-rose-50 text-rose-900";
  if (type === "omitted") return "bg-white text-slate-400";
  return "text-slate-600";
}
