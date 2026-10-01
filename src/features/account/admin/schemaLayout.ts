import type { DatabaseSchemaRelationship, DatabaseSchemaTable } from "@/lib/types";

export const TABLE_WIDTH = 360;
export const HEADER_HEIGHT = 42;
export const COLUMN_HEIGHT = 27;
export const RELATIONSHIP_END_LENGTH = 34;
const GAP_X = 130;
const GAP_Y = 90;
const MARGIN = 60;

export type TableBox = { x: number; y: number; width: number; height: number };
export type SchemaLayout = { boxes: Map<string, TableBox>; width: number; height: number };
export type Cardinality = { min: 0 | 1; max: 1 | "many" };

export function relationshipCardinality(relationship: DatabaseSchemaRelationship, tables: Map<string, DatabaseSchemaTable>): { from: Cardinality; to: Cardinality } {
  const table = tables.get(relationship.fromTable);
  const members = table?.foreignKeys.filter((key) => key.id === relationship.id && key.toTable === relationship.toTable) ?? [];
  const columns = new Set((members.length ? members : [relationship]).map((key) => key.fromColumn));
  const primaryKey = table?.columns.filter((column) => column.primaryKey).map((column) => column.name) ?? [];
  const includesKey = (key: string[]) => key.length > 0 && key.every((name) => columns.has(name));
  const unique = includesKey(primaryKey) || table?.indexes.some((index) => index.unique && !index.partial && includesKey(index.columns));
  const required = Array.from(columns).every((name) => table?.columns.find((column) => column.name === name)?.notNull);
  // A foreign key requires a parent only when non-null. It never requires a parent to have children.
  return { from: { min: 0, max: unique ? 1 : "many" }, to: { min: required ? 1 : 0, max: 1 } };
}

export function cardinalityLabel(cardinality: Cardinality) {
  return cardinality.max === "many" ? (cardinality.min ? "one or more" : "zero or more") : (cardinality.min ? "exactly one" : "zero or one");
}

export function layoutSchema(tables: DatabaseSchemaTable[], relationships: DatabaseSchemaRelationship[]): SchemaLayout {
  const names = new Set(tables.map((table) => table.name));
  const parents = new Map(tables.map((table) => [table.name, new Set<string>()]));
  for (const relationship of relationships) {
    if (relationship.fromTable !== relationship.toTable && names.has(relationship.toTable)) {
      parents.get(relationship.fromTable)?.add(relationship.toTable);
    }
  }
  const depths = new Map<string, number>();
  function depth(name: string, visiting = new Set<string>()): number {
    if (visiting.has(name)) return 0;
    const cached = depths.get(name);
    if (cached !== undefined) return cached;
    const next = new Set(visiting).add(name);
    const value = Math.min(4, Math.max(-1, ...Array.from(parents.get(name) ?? [], (parent) => depth(parent, next))) + 1);
    depths.set(name, value);
    return value;
  }
  const boxes = new Map<string, TableBox>();
  const bottoms = Array.from({ length: 5 }, () => MARGIN);
  for (const table of tables) {
    const column = depth(table.name);
    const height = HEADER_HEIGHT + Math.max(1, table.columns.length) * COLUMN_HEIGHT + 8;
    boxes.set(table.name, { x: MARGIN + column * (TABLE_WIDTH + GAP_X), y: bottoms[column], width: TABLE_WIDTH, height });
    bottoms[column] += height + GAP_Y;
  }
  return {
    boxes,
    width: Math.max(TABLE_WIDTH, ...Array.from(boxes.values(), (box) => box.x + box.width)) + MARGIN,
    height: Math.max(0, ...Array.from(boxes.values(), (box) => box.y + box.height)) + MARGIN,
  };
}

export function relationshipPath(relationship: DatabaseSchemaRelationship, layout: SchemaLayout, tables: Map<string, DatabaseSchemaTable>) {
  const from = layout.boxes.get(relationship.fromTable);
  const to = layout.boxes.get(relationship.toTable);
  const sourceRow = tables.get(relationship.fromTable)?.columns.findIndex((column) => column.name === relationship.fromColumn) ?? -1;
  const targetRow = tables.get(relationship.toTable)?.columns.findIndex((column) => column.name === relationship.toColumn) ?? -1;
  if (!from || !to || sourceRow < 0 || targetRow < 0) return null;
  const y1 = from.y + HEADER_HEIGHT + (sourceRow + 0.5) * COLUMN_HEIGHT;
  const y2 = to.y + HEADER_HEIGHT + (targetRow + 0.5) * COLUMN_HEIGHT;
  const sameColumn = from.x === to.x;
  const sourceOnLeft = from.x < to.x;
  const x1 = sameColumn || sourceOnLeft ? from.x + from.width : from.x;
  const x2 = sameColumn || !sourceOnLeft ? to.x + to.width : to.x;
  const direction1 = sameColumn || sourceOnLeft ? 1 : -1;
  const direction2 = sameColumn || !sourceOnLeft ? 1 : -1;
  const start = x1 + direction1 * RELATIONSHIP_END_LENGTH;
  const end = x2 + direction2 * RELATIONSHIP_END_LENGTH;
  const bend = sameColumn ? 70 : Math.max(25, Math.abs(end - start) * 0.5);
  const control1 = start + direction1 * bend;
  const control2 = end + direction2 * bend;
  return { d: `M ${start} ${y1} C ${control1} ${y1}, ${control2} ${y2}, ${end} ${y2}`, x1, y1, x2, y2, direction1, direction2 };
}
