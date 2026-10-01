"use client";

import { Maximize, Minus, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { DatabaseSchemaOverview } from "@/lib/types";
import { COLUMN_HEIGHT, HEADER_HEIGHT, RELATIONSHIP_END_LENGTH, cardinalityLabel, layoutSchema, relationshipCardinality, relationshipPath } from "./schemaLayout";
import type { Cardinality } from "./schemaLayout";

type View = { x: number; y: number; scale: number };
type Drag = { pointer: number; x: number; y: number; view: View; table?: string; moved: boolean };
const MIN_ZOOM = 0.08;
const MAX_ZOOM = 2;
const controlClass = "inline-flex h-8 min-w-8 items-center justify-center border border-slate-300 bg-white px-2 text-slate-600 hover:bg-slate-50 disabled:opacity-40";

function zoomAt(view: View, factor: number, x: number, y: number): View {
  const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.scale * factor));
  return { scale, x: x - (x - view.x) * scale / view.scale, y: y - (y - view.y) * scale / view.scale };
}

function RelationshipEnd({ cardinality, x = 0, y = 0, direction = 1 }: { cardinality: Cardinality; x?: number; y?: number; direction?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${direction} 1)`} fill="none" strokeLinecap="round" strokeLinejoin="round">
    <path d={`M 2 0 H ${RELATIONSHIP_END_LENGTH}`} />
    {cardinality.max === "many" ? <path d="M 2 -7 L 15 0 L 2 7" /> : <path d="M 8 -7 V 7" />}
    {cardinality.min === 0 ? <circle cx={24} cy={0} r={4} fill="#f8fafc" /> : <path d="M 24 -7 V 7" />}
  </g>;
}

const legendCardinalities: Cardinality[] = [{ min: 1, max: 1 }, { min: 0, max: 1 }, { min: 0, max: "many" }];

export function SchemaDiagram({ schema }: { schema: DatabaseSchemaOverview }) {
  const [query, setQuery] = useState("");
  const [showInternal, setShowInternal] = useState(false);
  const [selectedName, setSelectedName] = useState("");
  const [view, setView] = useState<View | null>(null);
  const [size, setSize] = useState({ width: 900, height: 650 });
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);

  const tables = useMemo(() => schema.tables.filter((table) => showInternal || !table.internal), [schema, showInternal]);
  const tableMap = useMemo(() => new Map(tables.map((table) => [table.name, table])), [tables]);
  const relationships = useMemo(() => schema.relationships.filter((relationship) =>
    tableMap.has(relationship.fromTable) && tableMap.has(relationship.toTable)), [schema, tableMap]);
  const layout = useMemo(() => layoutSchema(tables, relationships), [tables, relationships]);
  const selected = tableMap.get(selectedName);
  const connected = useMemo(() => new Set(relationships.flatMap((relationship) =>
    relationship.fromTable === selectedName || relationship.toTable === selectedName
      ? [relationship.fromTable, relationship.toTable] : [])), [relationships, selectedName]);
  const selectedRelationships = selected ? relationships.filter((relationship) =>
    relationship.fromTable === selected.name || relationship.toTable === selected.name) : [];
  const search = query.trim().toLowerCase();
  const matches = tables.filter((table) => table.name.toLowerCase().includes(search) ||
    table.columns.some((column) => column.name.toLowerCase().includes(search)));
  const initialView = useMemo(() => ({ x: 20, y: 20, scale: Math.min(0.85, size.width / 850) }), [size.width]);
  const currentView = view ?? initialView;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
      setView((previous) => {
        const current = previous ?? initialView;
        if (event.ctrlKey || event.metaKey) {
          return zoomAt(current, Math.exp(-event.deltaY * unit * 0.01), event.clientX - rect.left, event.clientY - rect.top);
        }
        return { ...current, x: current.x - event.deltaX * unit, y: current.y - event.deltaY * unit };
      });
    };
    svg.addEventListener("wheel", wheel, { passive: false });
    return () => svg.removeEventListener("wheel", wheel);
  }, [initialView]);

  function focusTable(name: string) {
    const box = layout.boxes.get(name);
    if (!box) return;
    setSelectedName(name);
    const scale = Math.min(1, (size.width - 64) / box.width, (size.height - 64) / box.height);
    setView({ scale, x: (size.width - box.width * scale) / 2 - box.x * scale, y: (size.height - box.height * scale) / 2 - box.y * scale });
  }

  function fitAll() {
    const scale = Math.max(MIN_ZOOM, Math.min(1, (size.width - 40) / layout.width, (size.height - 40) / layout.height));
    setView({ scale, x: (size.width - layout.width * scale) / 2, y: (size.height - layout.height * scale) / 2 });
    setSelectedName("");
  }

  function zoom(factor: number) {
    setView((previous) => zoomAt(previous ?? initialView, factor, size.width / 2, size.height / 2));
  }

  function startPan(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || drag.current) return;
    const target = event.target as Element;
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, view: currentView,
      table: target.closest("[data-schema-table]")?.getAttribute("data-schema-table") ?? undefined, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePan(event: ReactPointerEvent<SVGSVGElement>) {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId) return;
    const dx = event.clientX - active.x;
    const dy = event.clientY - active.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) active.moved = true;
    if (active.moved) setView({ ...active.view, x: active.view.x + dx, y: active.view.y + dy });
  }

  function endPan(event: ReactPointerEvent<SVGSVGElement>) {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId) return;
    if (!active.moved) setSelectedName(active.table ?? "");
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <p className="text-sm text-slate-500">{tables.length} tables · {relationships.length} connections</p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex select-none items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={showInternal} onChange={(event) => { setShowInternal(event.target.checked); setView(null); setSelectedName(""); }} />
            Internal tables
          </label>
          <div className="flex items-center gap-1">
            <button type="button" className={controlClass} aria-label="Zoom out" title="Zoom out" disabled={currentView.scale <= MIN_ZOOM} onClick={() => zoom(1 / 1.25)}><Minus size={15} /></button>
            <button type="button" className={controlClass + " min-w-14 tabular-nums text-xs"} title="Reset to 100%" onClick={() => zoom(1 / currentView.scale)}>{Math.round(currentView.scale * 100)}%</button>
            <button type="button" className={controlClass} aria-label="Zoom in" title="Zoom in" disabled={currentView.scale >= MAX_ZOOM} onClick={() => zoom(1.25)}><Plus size={15} /></button>
            <button type="button" className={controlClass + " gap-1.5 ml-1 text-xs"} onClick={fitAll}><Maximize size={14} /> Fit all</button>
          </div>
        </div>
      </div>
      <div className="grid min-w-0 sm:grid-cols-[210px_minmax(0,1fr)]">
        <aside className="flex max-h-48 min-w-0 flex-col border-b border-slate-200 sm:max-h-none sm:border-b-0 sm:border-r">
          <div className="relative m-3">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-3 text-slate-400" />
            <input aria-label="Find a table or column" placeholder="Find table or column" value={query} onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && matches[0]) focusTable(matches[0].name); }}
              className="h-9 w-full min-w-0 border border-slate-300 py-1 pl-8 pr-2 text-xs outline-none focus:border-slate-600" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 sm:max-h-[calc(72vh-100px)]" aria-label="Tables">
            {matches.map((table) => (
              <button key={table.name} type="button" title={table.name} aria-pressed={selectedName === table.name} onClick={() => focusTable(table.name)}
                className={"flex w-full items-center justify-between gap-2 px-2 py-2 text-left text-xs " +
                  (selectedName === table.name ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100")}>
                <span className="truncate font-mono">{table.name}</span><span className="shrink-0 opacity-60">{table.columns.length}</span>
              </button>
            ))}
            {!matches.length ? <p className="px-2 py-3 text-sm text-slate-500">No matching tables.</p> : null}
          </div>
        </aside>
        <div className="relative min-w-0 bg-slate-50">
          <svg ref={svgRef} role="group" aria-label="Database schema whiteboard" tabIndex={0}
            className="block h-[72vh] min-h-[460px] max-h-[900px] w-full touch-none select-none cursor-grab active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-500"
            style={{ backgroundImage: "radial-gradient(#cbd5e1 1px, transparent 1px)", backgroundSize: "20px 20px" }}
            onPointerDown={startPan} onPointerMove={movePan} onPointerUp={endPan}
            onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === "+" || event.key === "=") { event.preventDefault(); zoom(1.25); }
              if (event.key === "-") { event.preventDefault(); zoom(1 / 1.25); }
              if (event.key === "0") { event.preventDefault(); fitAll(); }
              if (event.key === "Escape") setSelectedName("");
              const offsets: Record<string, [number, number]> = { ArrowLeft: [80, 0], ArrowRight: [-80, 0], ArrowUp: [0, 80], ArrowDown: [0, -80] };
              const offset = offsets[event.key];
              if (offset) { event.preventDefault(); setView((previous) => ({ ...(previous ?? initialView), x: (previous ?? initialView).x + offset[0], y: (previous ?? initialView).y + offset[1] })); }
            }}>
            <g transform={"translate(" + currentView.x + " " + currentView.y + ") scale(" + currentView.scale + ")"}>
              {relationships.map((relationship, index) => {
                const path = relationshipPath(relationship, layout, tableMap);
                if (!path) return null;
                const highlighted = selected && (relationship.fromTable === selected.name || relationship.toTable === selected.name);
                const cardinality = relationshipCardinality(relationship, tableMap);
                const label = `${relationship.fromTable}.${relationship.fromColumn} (${cardinalityLabel(cardinality.from)}) — ${relationship.toTable}.${relationship.toColumn} (${cardinalityLabel(cardinality.to)})`;
                return <g key={index} opacity={selected && !highlighted ? 0.12 : 1}
                  stroke={highlighted ? "#0891b2" : "#94a3b8"} strokeWidth={highlighted ? 2 : 1.5}>
                  <title>{label}</title>
                  <path d={path.d} fill="none" />
                  <RelationshipEnd cardinality={cardinality.from} x={path.x1} y={path.y1} direction={path.direction1} />
                  <RelationshipEnd cardinality={cardinality.to} x={path.x2} y={path.y2} direction={path.direction2} />
                </g>;
              })}
              {tables.map((table) => {
                const box = layout.boxes.get(table.name)!;
                const active = selectedName === table.name;
                const dimmed = selected && !active && !connected.has(table.name);
                const foreignColumns = new Set(table.foreignKeys.map((relationship) => relationship.fromColumn));
                return <g key={table.name} data-schema-table={table.name} transform={"translate(" + box.x + " " + box.y + ")"}
                  opacity={dimmed ? 0.35 : 1} role="button" tabIndex={0} aria-label={"Table " + table.name + ", " + table.columns.length + " columns"} aria-pressed={active}
                  className="outline-none focus-visible:[&>rect]:stroke-cyan-600 focus-visible:[&>rect]:stroke-[3]"
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); focusTable(table.name); } }}>
                  <rect width={box.width} height={box.height} fill="white" stroke={active ? "#0891b2" : "#cbd5e1"} strokeWidth={active ? 2.5 : 1} />
                  <rect x={1} y={1} width={box.width - 2} height={HEADER_HEIGHT - 1} fill={active ? "#ecfeff" : "#f1f5f9"} />
                  <text x={14} y={26} fontSize={14} fontWeight={600} fill="#0f172a" fontFamily="monospace">{shorten(table.name, 35)}<title>{table.name}</title></text>
                  {table.columns.map((column, index) => {
                    const y = HEADER_HEIGHT + index * COLUMN_HEIGHT;
                    const badges = (column.primaryKey ? "PK" : "") + (foreignColumns.has(column.name) ? (column.primaryKey ? " FK" : "FK") : "");
                    return <g key={column.name}>
                      <title>{column.name + " · " + column.type + (column.notNull ? " · required" : " · nullable") + (column.defaultValue ? " · default: " + column.defaultValue : "")}</title>
                      {index % 2 === 1 ? <rect x={1} y={y} width={box.width - 2} height={COLUMN_HEIGHT} fill="#f8fafc" /> : null}
                      <text x={12} y={y + 18} fontSize={9} fontWeight={600} fill={column.primaryKey ? "#b45309" : "#0891b2"}>{badges}</text>
                      <text x={52} y={y + 18} fontSize={12} fill="#334155" fontFamily="monospace">{shorten(column.name, 27)}</text>
                      <text x={box.width - 12} y={y + 18} fontSize={10} fill="#64748b" textAnchor="end">{shorten(column.type.toLowerCase(), 12)}</text>
                    </g>;
                  })}
                </g>;
              })}
            </g>
          </svg>
          {!tables.length ? <p className="pointer-events-none absolute inset-x-0 top-1/2 text-center text-sm text-slate-500">No tables to display.</p> : null}
          <p className="pointer-events-none absolute bottom-3 left-3 border border-slate-200 bg-white/95 px-2 py-1 text-[11px] text-slate-500">Drag to pan · Ctrl/⌘ + scroll to zoom</p>
        </div>
      </div>
      <div className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
        <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2" aria-label="Crow’s-foot notation legend">
          {legendCardinalities.map((cardinality) => <span key={`${cardinality.min}-${cardinality.max}`} className="inline-flex items-center gap-1.5">
            <svg width="38" height="18" viewBox="0 -9 38 18" aria-hidden="true" stroke="currentColor" strokeWidth={1.5}>
              <RelationshipEnd cardinality={cardinality} />
            </svg>
            {cardinalityLabel(cardinality)}
          </span>)}
        </div>
        {selected ? (
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="font-mono font-semibold text-slate-800">{selected.name}</span>
              <span>{selected.columns.length} columns · {selectedRelationships.length} connections</span>
              <button type="button" aria-label="Clear table selection" className="ml-auto p-1 hover:text-slate-900" onClick={() => setSelectedName("")}><X size={14} /></button>
            </div>
            <div className="flex max-h-32 flex-wrap gap-x-5 gap-y-2 overflow-y-auto">
              {selectedRelationships.map((relationship, index) => {
                const other = relationship.fromTable === selected.name ? relationship.toTable : relationship.fromTable;
                return <button key={index} type="button" className="break-all text-left font-mono text-cyan-700 hover:underline" onClick={() => focusTable(other)}
                  title={"On delete: " + relationship.onDelete + "; on update: " + relationship.onUpdate}>
                  {relationship.fromTable}.{relationship.fromColumn} → {relationship.toTable}.{relationship.toColumn}
                </button>;
              })}
              {!selectedRelationships.length ? <span>No foreign-key connections.</span> : null}
            </div>
          </div>
        ) : <p>PK: primary key · FK: foreign key · Select a table to highlight its connections.</p>}
      </div>
    </div>
  );
}

function shorten(value: string, length: number) {
  return value.length > length ? value.slice(0, length - 1) + "…" : value;
}
