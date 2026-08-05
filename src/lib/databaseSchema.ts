import { databasePath } from "./paths";
import { querySql } from "./sqlite";
import type { DatabaseSchemaOverview, DatabaseSchemaRelationship, DatabaseSchemaTable } from "./types";

const preferredTables = [
  "users",
  "login_attempts",
  "user_signing_keys",
  "notebooks",
  "notebook_members",
  "pages",
  "page_signatures",
  "page_signature_timestamps",
  "tags",
  "page_tags",
  "page_comment_threads",
  "page_comments",
  "attachments",
  "attachment_annotations",
  "audit_events",
  "app_settings",
  "search_index_queue",
  "search_pages_fts",
  "search_pages_vocab",
];

const preferredTableOrder = new Map(preferredTables.map((name, index) => [name, index]));

export function readDatabaseSchema(): DatabaseSchemaOverview {
  const tableRows = querySql(`
    SELECT name, type, sql
    FROM sqlite_master
    WHERE type IN ('table', 'view')
      AND name NOT LIKE 'sqlite_%'
    ORDER BY name;
  `);
  const tableNames = new Set(tableRows.map((table) => table.name));
  const tables = tableRows.map((table) => readTableSchema(table.name, table.type, table.sql ?? "")).sort(compareTables);
  const relationships = tables
    .flatMap((table) => table.foreignKeys)
    .filter((relationship) => tableNames.has(relationship.toTable));
  return {
    generatedAt: new Date().toISOString(),
    databasePath,
    tables,
    relationships,
    tableCount: tables.length,
    columnCount: tables.reduce((sum, table) => sum + table.columns.length, 0),
    relationshipCount: relationships.length,
    internalTableCount: tables.filter((table) => table.internal).length,
  };
}

function readTableSchema(name: string, type: string, createSql: string): DatabaseSchemaTable {
  const columns = querySql(`PRAGMA table_info(${quoteIdentifier(name)});`).map((column) => ({
    name: column.name,
    type: column.type || "TEXT",
    notNull: column.notnull === "1",
    defaultValue: column.dflt_value ?? "",
    primaryKey: column.pk !== "0",
  }));
  const foreignKeys: DatabaseSchemaRelationship[] = querySql(`PRAGMA foreign_key_list(${quoteIdentifier(name)});`).map((fk) => ({
    id: Number(fk.id),
    sequence: Number(fk.seq),
    fromTable: name,
    fromColumn: fk.from,
    toTable: fk.table,
    toColumn: fk.to || "id",
    onUpdate: fk.on_update,
    onDelete: fk.on_delete,
  }));
  const indexes = querySql(`PRAGMA index_list(${quoteIdentifier(name)});`)
    .filter((index) => index.origin !== "pk")
    .map((index) => ({
      name: index.name,
      unique: index.unique === "1",
      columns: querySql(`PRAGMA index_info(${quoteIdentifier(index.name)});`).map((column) => column.name),
    }));
  return {
    name,
    type,
    sql: createSql,
    internal: isInternalTable(name, createSql),
    columns,
    foreignKeys,
    indexes,
  };
}

function isInternalTable(name: string, createSql: string) {
  return (
    name === "search_index_queue" ||
    name === "search_pages_vocab" ||
    name.startsWith("search_pages_fts_") ||
    /CREATE\s+VIRTUAL\s+TABLE\s+["']?search_pages_fts["']?\s+USING\s+fts/i.test(createSql)
  );
}

function compareTables(left: DatabaseSchemaTable, right: DatabaseSchemaTable) {
  const leftOrder = preferredTableOrder.get(left.name) ?? 1000;
  const rightOrder = preferredTableOrder.get(right.name) ?? 1000;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  if (left.internal !== right.internal) return left.internal ? 1 : -1;
  return left.name.localeCompare(right.name);
}

function quoteIdentifier(value: string) {
  return `"${String(value).replace(/"/g, '""')}"`;
}
