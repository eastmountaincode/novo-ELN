import type { DatabaseSchemaOverview, DatabaseSchemaRelationship, DatabaseSchemaTable, ErflowAdminStatus, ErflowSyncResult } from "./types";

const erflowDefaultPositions: Record<string, { x: number; y: number }> = {
  users: { x: 80, y: 80 },
  login_attempts: { x: 80, y: 520 },
  user_signing_keys: { x: 80, y: 840 },
  notebooks: { x: 560, y: 80 },
  notebook_members: { x: 560, y: 500 },
  pages: { x: 1040, y: 80 },
  tags: { x: 1040, y: 560 },
  page_tags: { x: 1040, y: 860 },
  page_comment_threads: { x: 1520, y: 80 },
  page_comments: { x: 1520, y: 460 },
  attachments: { x: 2000, y: 80 },
  attachment_annotations: { x: 2000, y: 500 },
  audit_events: { x: 2480, y: 80 },
  app_settings: { x: 2480, y: 520 },
};

export function getErflowAdminStatus(): ErflowAdminStatus {
  return {
    configured: Boolean(erflowEndpoint()),
    viewUrl: process.env.ELN_ERFLOW_VIEW_URL?.trim() ?? "",
  };
}

export async function syncSchemaToErflow(schema: DatabaseSchemaOverview, options: { dryRun?: boolean; includeInternal?: boolean } = {}): Promise<ErflowSyncResult> {
  const endpoint = erflowEndpoint();
  if (!endpoint) throw new Error("ER Flow is not configured.");

  const syncTables = schema.tables.filter((table) => options.includeInternal || !table.internal);
  const syncTableNames = new Set(syncTables.map((table) => table.name));
  const relationships = schema.relationships.filter((relationship) => syncTableNames.has(relationship.fromTable) && syncTableNames.has(relationship.toTable));

  const activeDiagram = await getActiveDiagram(endpoint);
  const existingTables = await listExistingTables(endpoint);
  const operations = [
    ...existingTables.map((table) => ({ op: "delete-table", tableId: table.tableId })),
    ...syncTables.map((table) => buildCreateTableOperation(table, activeDiagram.id)),
    ...relationships.map(buildForeignKeyOperation),
  ];

  const responseText = await callErflowTool(endpoint, "batch-operations", {
    dryRun: options.dryRun === true,
    operations,
  });
  return {
    syncedAt: new Date().toISOString(),
    dryRun: options.dryRun === true,
    tableCount: syncTables.length,
    relationshipCount: relationships.length,
    operationCount: operations.length,
    responseText,
  };
}

async function getActiveDiagram(endpoint: string) {
  const result = parseToolJson(await callErflowTool(endpoint, "list-diagrams", {}));
  const diagrams = Array.isArray(result) ? result : Array.isArray(result.diagrams) ? result.diagrams : [];
  const diagram = diagrams.find((item) => item?.active) ?? diagrams[0];
  if (!diagram?.id) throw new Error("ER Flow model has no active diagram.");
  return { id: String(diagram.id) };
}

async function listExistingTables(endpoint: string) {
  const result = parseToolJson(await callErflowTool(endpoint, "list-tables", {}));
  const tables = Array.isArray(result) ? result : Array.isArray(result.tables) ? result.tables : [];
  return tables.flatMap((table) => {
    const tableId = table?.id ?? table?.tableId;
    return tableId ? [{ tableId: String(tableId) }] : [];
  });
}

function buildCreateTableOperation(table: DatabaseSchemaTable, diagramId: string) {
  return {
    op: "create-table",
    tableId: tableId(table.name),
    name: table.name,
    kind: "table",
    diagramId,
    position: erflowDefaultPositions[table.name] ?? fallbackPosition(table.name),
    columns: table.columns.map((column) => ({
      id: columnId(table.name, column.name),
      name: column.name,
      type: normalizeType(column.type),
      nullable: !column.notNull && !column.primaryKey,
      isPrimaryKey: column.primaryKey,
    })),
  };
}

function buildForeignKeyOperation(relationship: DatabaseSchemaRelationship) {
  return {
    op: "create-foreign-key",
    tableId: tableId(relationship.fromTable),
    fkId: foreignKeyId(relationship.fromTable, relationship.fromColumn, relationship.toTable, relationship.toColumn),
    data: {
      name: foreignKeyName(relationship.fromTable, relationship.fromColumn, relationship.toTable, relationship.toColumn),
      columnIds: [columnId(relationship.fromTable, relationship.fromColumn)],
      referencedTableId: tableId(relationship.toTable),
      referencedColumnIds: [columnId(relationship.toTable, relationship.toColumn)],
      onDelete: relationship.onDelete,
      onUpdate: relationship.onUpdate,
    },
  };
}

async function callErflowTool(endpoint: string, name: string, toolArguments: Record<string, unknown>) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      method: "tools/call",
      params: {
        name,
        arguments: toolArguments,
      },
    }),
  });
  const body = await response.json().catch(() => null) as { error?: { message?: string }; result?: { isError?: boolean; content?: Array<{ type?: string; text?: string }> } } | null;
  if (!response.ok || body?.error) throw new Error(body?.error?.message ?? `ER Flow request failed with ${response.status}.`);
  const text = body?.result?.content?.find((item) => item.type === "text")?.text ?? "";
  if (body?.result?.isError) throw new Error(text || `ER Flow tool ${name} failed.`);
  return text;
}

function parseToolJson(text: string) {
  try {
    return JSON.parse(text) as { diagrams?: Array<Record<string, unknown>>; tables?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
  } catch {
    throw new Error(`ER Flow returned non-JSON tool output: ${text.slice(0, 200)}`);
  }
}

function erflowEndpoint() {
  return normalizeEndpoint(process.env.ELN_ERFLOW_MODEL ?? "");
}

function normalizeEndpoint(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^https:\/\/app\.erflow\.io\/mcp\/data-model\/[a-f0-9-]+$/i.test(trimmed)) return trimmed;
  const uuid = trimmed.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i)?.[0];
  if (!uuid) throw new Error("ELN_ERFLOW_MODEL must be an ER Flow MCP endpoint or model UUID.");
  return `https://app.erflow.io/mcp/data-model/${uuid}`;
}

function fallbackPosition(tableName: string) {
  const hash = Array.from(tableName).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const column = 2 + (hash % 4);
  const row = Math.floor(hash / 4) % 5;
  return { x: 80 + column * 480, y: 80 + row * 360 };
}

function normalizeType(type: string) {
  const upper = String(type || "TEXT").trim().toUpperCase();
  if (upper.includes("INT")) return "INTEGER";
  if (upper.includes("REAL") || upper.includes("FLOA") || upper.includes("DOUB")) return "REAL";
  if (upper.includes("BLOB")) return "BLOB";
  if (upper.includes("NUM")) return "NUMERIC";
  return "TEXT";
}

function tableId(name: string) {
  return `tbl_${slug(name)}`;
}

function columnId(tableName: string, columnName: string) {
  return `col_${slug(tableName)}_${slug(columnName)}`;
}

function foreignKeyId(tableName: string, columnName: string, referencedTable: string, referencedColumn: string) {
  return `fk_${slug(tableName)}_${slug(columnName)}_${slug(referencedTable)}_${slug(referencedColumn)}`;
}

function foreignKeyName(tableName: string, columnName: string, referencedTable: string, referencedColumn: string) {
  return `${tableName}_${columnName}_${referencedTable}_${referencedColumn}_fk`;
}

function slug(value: string) {
  return String(value).replace(/[^a-zA-Z0-9_]/g, "_");
}
