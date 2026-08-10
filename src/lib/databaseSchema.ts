import { querySql, sql } from "./sqlite";
import { databaseDisplayName, isPostgresDatabase } from "./sqlite";
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
  if (isPostgresDatabase()) return readPostgresDatabaseSchema();
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
    databasePath: databaseDisplayName(),
    tables,
    relationships,
    tableCount: tables.length,
    columnCount: tables.reduce((sum, table) => sum + table.columns.length, 0),
    relationshipCount: relationships.length,
    internalTableCount: tables.filter((table) => table.internal).length,
  };
}

function readPostgresDatabaseSchema(): DatabaseSchemaOverview {
  const tableRows = querySql(`
    SELECT
      table_name AS name,
      CASE WHEN table_type = 'VIEW' THEN 'view' ELSE 'table' END AS type,
      '' AS sql
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type IN ('BASE TABLE', 'VIEW')
    ORDER BY table_name;
  `);
  const tableNames = new Set(tableRows.map((table) => table.name));
  const tables = tableRows.map((table) => readPostgresTableSchema(table.name, table.type, table.sql ?? "")).sort(compareTables);
  const relationships = tables
    .flatMap((table) => table.foreignKeys)
    .filter((relationship) => tableNames.has(relationship.toTable));
  return {
    generatedAt: new Date().toISOString(),
    databasePath: databaseDisplayName(),
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

function readPostgresTableSchema(name: string, type: string, createSql: string): DatabaseSchemaTable {
  const columns = querySql(`
    SELECT
      c.column_name AS name,
      upper(c.data_type) AS type,
      CASE WHEN c.is_nullable = 'NO' THEN '1' ELSE '0' END AS notnull,
      COALESCE(c.column_default, '') AS dflt_value,
      CASE WHEN pk.column_name IS NULL THEN '0' ELSE '1' END AS pk
    FROM information_schema.columns c
    LEFT JOIN (
      SELECT kcu.table_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_schema = tc.constraint_schema
       AND kcu.constraint_name = tc.constraint_name
       AND kcu.table_name = tc.table_name
      WHERE tc.table_schema = 'public'
        AND tc.constraint_type = 'PRIMARY KEY'
    ) pk ON pk.table_name = c.table_name AND pk.column_name = c.column_name
    WHERE c.table_schema = 'public'
      AND c.table_name = ${sql(name)}
    ORDER BY c.ordinal_position;
  `).map((column) => ({
    name: column.name,
    type: column.type || "TEXT",
    notNull: column.notnull === "1",
    defaultValue: column.dflt_value ?? "",
    primaryKey: column.pk !== "0",
  }));
  const foreignKeys: DatabaseSchemaRelationship[] = querySql(`
    SELECT
      row_number() OVER (ORDER BY tc.constraint_name, kcu.ordinal_position) AS id,
      kcu.ordinal_position AS seq,
      kcu.table_name AS from_table,
      kcu.column_name AS from_column,
      ccu.table_name AS to_table,
      ccu.column_name AS to_column,
      rc.update_rule AS on_update,
      rc.delete_rule AS on_delete
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_schema = tc.constraint_schema
     AND kcu.constraint_name = tc.constraint_name
     AND kcu.table_name = tc.table_name
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_schema = tc.constraint_schema
     AND ccu.constraint_name = tc.constraint_name
    JOIN information_schema.referential_constraints rc
      ON rc.constraint_schema = tc.constraint_schema
     AND rc.constraint_name = tc.constraint_name
    WHERE tc.table_schema = 'public'
      AND tc.table_name = ${sql(name)}
      AND tc.constraint_type = 'FOREIGN KEY'
    ORDER BY tc.constraint_name, kcu.ordinal_position;
  `).map((fk) => ({
    id: Number(fk.id),
    sequence: Number(fk.seq),
    fromTable: fk.from_table,
    fromColumn: fk.from_column,
    toTable: fk.to_table,
    toColumn: fk.to_column || "id",
    onUpdate: fk.on_update,
    onDelete: fk.on_delete,
  }));
  const indexes = querySql(`
    SELECT indexname AS name, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = ${sql(name)}
    ORDER BY indexname;
  `)
    .filter((index) => !index.name.endsWith("_pkey"))
    .map((index) => ({
      name: index.name,
      unique: /^CREATE UNIQUE INDEX/i.test(index.indexdef ?? ""),
      columns: postgresIndexColumns(index.indexdef ?? ""),
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

function postgresIndexColumns(indexDef: string) {
  const match = indexDef.match(/\((.*)\)\s*$/);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((column) => column.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}
