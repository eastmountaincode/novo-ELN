import {
  decodeIntegrationCursor,
  defaultIntegrationPageLimit,
  encodeIntegrationCursor,
  getIntegrationNotebookPageBatch,
  maximumIntegrationPageLimit,
  novoIntegrationApiVersion,
  parseIntegrationIfMatch,
  quoteContentRevision,
} from "@/lib/novoIntegration";
import { authenticateIntegrationRequest, integrationJson } from "@/lib/novoIntegrationHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ notebookId: string }> },
) {
  const authentication = await authenticateIntegrationRequest(request);
  if (!authentication.authorized) return authentication.response;

  const { notebookId } = await params;
  if (!notebookId || notebookId.length > 512) {
    return integrationJson({ error: "Not found" }, { status: 404 });
  }

  const precondition = parseIntegrationIfMatch(request.headers.get("if-match"));
  if (precondition.status === "missing") {
    return integrationJson({ error: "If-Match is required" }, { status: 428 });
  }
  if (precondition.status === "invalid") {
    return integrationJson({ error: "If-Match is invalid" }, { status: 400 });
  }

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  if (limit === null) {
    return integrationJson({ error: "limit must be a positive integer" }, { status: 400 });
  }
  const cursor = decodeIntegrationCursor(url.searchParams.get("cursor"), {
    notebookId,
    contentRevision: precondition.contentRevision,
  });
  if (!cursor.valid) {
    return integrationJson({ error: "cursor is invalid" }, { status: 400 });
  }

  const batch = getIntegrationNotebookPageBatch({
    userId: authentication.user.id,
    notebookId,
    expectedContentRevision: precondition.contentRevision,
    afterPageId: cursor.afterPageId,
    limit,
  });
  if (batch.status === "not-found") {
    return integrationJson({ error: "Not found" }, { status: 404 });
  }
  if (batch.status === "stale") {
    return integrationJson(
      { error: "Content revision changed", contentRevision: batch.contentRevision },
      {
        status: 412,
        headers: { ETag: quoteContentRevision(batch.contentRevision) },
      },
    );
  }

  const nextCursor = batch.nextAfterPageId
    ? encodeIntegrationCursor({
        notebookId,
        contentRevision: batch.notebook.contentRevision,
        afterPageId: batch.nextAfterPageId,
      })
    : null;
  return integrationJson(
    {
      apiVersion: novoIntegrationApiVersion,
      notebook: {
        id: batch.notebook.id,
        name: batch.notebook.name,
        contentRevision: batch.notebook.contentRevision,
      },
      pages: batch.pages,
      nextCursor,
      complete: batch.complete,
    },
    { headers: { ETag: quoteContentRevision(batch.notebook.contentRevision) } },
  );
}

function parseLimit(value: string | null) {
  if (value === null || value === "") return defaultIntegrationPageLimit;
  if (!/^[0-9]+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return null;
  return Math.min(parsed, maximumIntegrationPageLimit);
}
