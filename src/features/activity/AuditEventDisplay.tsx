import type { AuditEvent } from "@/lib/types";
import { userInitials } from "@/lib/workspaceDisplay";

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

export function auditInitials(event: AuditEvent) {
  return userInitials({ firstName: event.actorFirstName, lastName: event.actorLastName, email: event.actorEmail });
}
