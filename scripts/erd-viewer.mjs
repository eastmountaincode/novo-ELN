#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cwd = process.cwd();
const args = parseArgs(process.argv.slice(2));
const databasePath = args.db ?? process.env.ELN_DATABASE_PATH ?? path.join(cwd, "data", "eln.sqlite3");
const host = args.host ?? process.env.ELN_ERD_HOST ?? "127.0.0.1";
const port = Number(args.port ?? process.env.ELN_ERD_PORT ?? 3188);

const appTables = [
  "users",
  "login_attempts",
  "notebooks",
  "notebook_members",
  "pages",
  "tags",
  "page_tags",
  "attachments",
  "audit_events",
];

const preferredTableOrder = new Map(appTables.map((name, index) => [name, index]));

if (!fs.existsSync(databasePath)) {
  console.error(`Database not found: ${databasePath}`);
  process.exit(1);
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${host}:${port}`);

  try {
    if (url.pathname === "/") {
      sendHtml(response, renderPage());
      return;
    }

    if (url.pathname === "/schema.json") {
      sendJson(response, readSchema());
      return;
    }

    if (url.pathname === "/healthz") {
      sendText(response, "ok");
      return;
    }

    sendText(response, "Not found", 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    sendJson(response, { error: message }, 500);
  }
});

server.listen(port, host, () => {
  console.log(`Novo ERD viewer: http://${host}:${port}`);
  console.log(`Database: ${databasePath}`);
});

function readSchema() {
  const tableRows = querySql(`
    SELECT name, type, sql
    FROM sqlite_master
    WHERE type IN ('table', 'view')
      AND name NOT LIKE 'sqlite_%'
    ORDER BY name;
  `);

  const tables = tableRows.map((table) => {
    const columns = querySql(`PRAGMA table_info(${quoteIdentifier(table.name)});`).map((column) => ({
      name: column.name,
      type: column.type || "TEXT",
      notNull: column.notnull === "1",
      defaultValue: column.dflt_value,
      primaryKey: column.pk !== "0",
    }));

    const foreignKeys = querySql(`PRAGMA foreign_key_list(${quoteIdentifier(table.name)});`).map((fk) => ({
      id: Number(fk.id),
      sequence: Number(fk.seq),
      fromTable: table.name,
      fromColumn: fk.from,
      toTable: fk.table,
      toColumn: fk.to || "id",
      onUpdate: fk.on_update,
      onDelete: fk.on_delete,
    }));

    const indexes = querySql(`PRAGMA index_list(${quoteIdentifier(table.name)});`)
      .filter((index) => index.origin !== "pk")
      .map((index) => ({
        name: index.name,
        unique: index.unique === "1",
        columns: querySql(`PRAGMA index_info(${quoteIdentifier(index.name)});`).map((column) => column.name),
      }));

    return {
      name: table.name,
      type: table.type,
      sql: table.sql ?? "",
      internal: isInternalTable(table.name, table.sql ?? ""),
      columns,
      foreignKeys,
      indexes,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    databasePath,
    tables: tables.sort(compareTables),
    relationships: tables.flatMap((table) => table.foreignKeys).filter((fk) => tableRows.some((table) => table.name === fk.toTable)),
  };
}

function isInternalTable(name, sql) {
  return (
    name.startsWith("search_pages_fts_") ||
    /CREATE\s+VIRTUAL\s+TABLE\s+["']?search_pages_fts["']?\s+USING\s+fts/i.test(sql)
  );
}

function compareTables(left, right) {
  const leftOrder = preferredTableOrder.get(left.name) ?? 1000;
  const rightOrder = preferredTableOrder.get(right.name) ?? 1000;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  if (left.internal !== right.internal) return left.internal ? 1 : -1;
  return left.name.localeCompare(right.name);
}

function querySql(statement) {
  const output = execFileSync("sqlite3", ["-batch", databasePath], {
    input: `.timeout 30000\n.bail on\n.headers on\n.mode csv\nPRAGMA foreign_keys=ON;\n${statement}`,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return parseCsv(output);
}

function parseCsv(input) {
  const clean = input.trimEnd();
  if (!clean) return [];
  const rows = parseCsvRows(clean);
  const [headers, ...dataRows] = rows;
  return dataRows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function parseCsvRows(input) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  row.push(field);
  rows.push(row);
  return rows;
}

function renderPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Novo ERD</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #0f172a;
      --muted: #64748b;
      --line: #cbd5e1;
      --panel: #ffffff;
      --bg: #f8fafc;
      --accent: #0891b2;
      --accent-soft: #e0f2fe;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    header {
      position: sticky;
      top: 0;
      z-index: 5;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      border-bottom: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.94);
      padding: 16px 22px;
      backdrop-filter: blur(12px);
    }

    h1 {
      margin: 0;
      font-size: 22px;
      line-height: 1.2;
    }

    .subhead {
      margin-top: 4px;
      color: var(--muted);
      font-size: 13px;
    }

    .toolbar {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    button,
    label.toggle {
      display: inline-flex;
      height: 34px;
      cursor: pointer;
      align-items: center;
      gap: 8px;
      border: 1px solid var(--line);
      background: var(--panel);
      padding: 0 12px;
      color: var(--ink);
      font-size: 14px;
    }

    button:hover,
    label.toggle:hover {
      border-color: #94a3b8;
      background: #f1f5f9;
    }

    input[type="checkbox"] { margin: 0; }

    main {
      padding: 22px;
    }

    .summary {
      display: grid;
      grid-template-columns: repeat(4, minmax(140px, 1fr));
      gap: 10px;
      margin-bottom: 18px;
      max-width: 960px;
    }

    .summary-card {
      border: 1px solid var(--line);
      background: var(--panel);
      padding: 10px 12px;
    }

    .summary-card span {
      display: block;
      color: var(--muted);
      font-size: 12px;
    }

    .summary-card strong {
      display: block;
      margin-top: 4px;
      font-size: 18px;
    }

    .diagram-wrap {
      position: relative;
      min-height: 680px;
      overflow: auto;
      border: 1px solid var(--line);
      background: #eef2f7;
    }

    .diagram {
      position: relative;
      min-width: 1800px;
      min-height: 960px;
    }

    svg.relationships {
      position: absolute;
      inset: 0;
      pointer-events: none;
      overflow: visible;
    }

    .table-card {
      position: absolute;
      overflow: hidden;
      border: 1px solid #94a3b8;
      background: var(--panel);
      box-shadow: 0 10px 28px rgba(15, 23, 42, 0.08);
      user-select: none;
      z-index: 2;
    }

    .table-card.dragging {
      box-shadow: 0 18px 40px rgba(15, 23, 42, 0.18);
      outline: 2px solid var(--accent);
      z-index: 3;
    }

    .table-card.internal {
      opacity: 0.72;
    }

    .table-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      border-bottom: 1px solid var(--line);
      background: var(--accent-soft);
      cursor: grab;
      padding: 9px 11px;
    }

    .table-card.dragging .table-header {
      cursor: grabbing;
    }

    .table-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 700;
    }

    .table-kind {
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
    }

    .columns {
      display: grid;
    }

    .column {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      border-bottom: 1px solid #e2e8f0;
      padding: 7px 11px;
      font-size: 13px;
    }

    .column:last-child {
      border-bottom: 0;
    }

    .column-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .column-type {
      color: var(--muted);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      font-size: 11px;
      white-space: nowrap;
    }

    .badge {
      margin-right: 5px;
      border: 1px solid #bae6fd;
      background: #f0f9ff;
      padding: 1px 4px;
      color: #0369a1;
      font-size: 10px;
      font-weight: 700;
    }

    .fk-label {
      paint-order: stroke;
      stroke: #eef2f7;
      stroke-width: 6px;
      fill: #475569;
      font-size: 11px;
    }

    .relationship-line {
      stroke: #475569;
      stroke-width: 1.8;
    }

    .relationship-port {
      fill: #ffffff;
      stroke: #475569;
      stroke-width: 1.8;
    }

    .error {
      border: 1px solid #fecdd3;
      background: #fff1f2;
      padding: 12px;
      color: #be123c;
    }

    @media (max-width: 900px) {
      header { align-items: flex-start; flex-direction: column; }
      .summary { grid-template-columns: repeat(2, minmax(140px, 1fr)); }
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Novo Entity Relationship Diagram</h1>
      <div id="db-path" class="subhead"></div>
    </div>
    <div class="toolbar">
      <label class="toggle"><input id="show-internal" type="checkbox" /> Show search/index tables</label>
      <button id="reset-layout" type="button">Reset layout</button>
      <button id="refresh" type="button">Refresh schema</button>
    </div>
  </header>
  <main>
    <section id="summary" class="summary"></section>
    <section id="diagram-wrap" class="diagram-wrap">
      <div id="diagram" class="diagram"></div>
    </section>
  </main>
  <script>
    const tableWidth = 320;
    const headerHeight = 42;
    const rowHeight = 32;
    const gapX = 180;
    const gapY = 96;
    const margin = 56;
    const defaultPositions = {
      users: { x: 70, y: 90 },
      login_attempts: { x: 70, y: 560 },
      notebooks: { x: 560, y: 90 },
      notebook_members: { x: 560, y: 500 },
      pages: { x: 1080, y: 90 },
      tags: { x: 1080, y: 500 },
      page_tags: { x: 1080, y: 860 },
      attachments: { x: 1600, y: 90 },
      audit_events: { x: 1600, y: 560 },
      search_pages_fts: { x: 1600, y: 1040 },
    };

    let schema = null;
    let currentTables = [];
    let currentRelationships = [];
    let currentLayout = {};
    let dragState = null;

    document.getElementById("refresh").addEventListener("click", loadSchema);
    document.getElementById("show-internal").addEventListener("change", render);
    document.getElementById("reset-layout").addEventListener("click", resetLayout);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);

    loadSchema();

    async function loadSchema() {
      const button = document.getElementById("refresh");
      button.disabled = true;
      button.textContent = "Refreshing...";
      try {
        const response = await fetch("/schema.json", { cache: "no-store" });
        schema = await response.json();
        if (!response.ok) throw new Error(schema.error || "Could not load schema");
        render();
      } catch (error) {
        document.getElementById("diagram").innerHTML = '<div class="error">' + escapeHtml(error.message) + '</div>';
      } finally {
        button.disabled = false;
        button.textContent = "Refresh schema";
      }
    }

    function render() {
      if (!schema) return;
      const showInternal = document.getElementById("show-internal").checked;
      const tables = schema.tables.filter((table) => showInternal || !table.internal);
      const tableNames = new Set(tables.map((table) => table.name));
      const relationships = schema.relationships.filter((relationship) => tableNames.has(relationship.fromTable) && tableNames.has(relationship.toTable));
      const layout = applySavedPositions(layoutTables(tables));

      document.getElementById("db-path").textContent = schema.databasePath + " • generated " + new Date(schema.generatedAt).toLocaleString();
      document.getElementById("summary").innerHTML = [
        ["Tables", tables.length],
        ["Relationships", relationships.length],
        ["Columns", tables.reduce((sum, table) => sum + table.columns.length, 0)],
        ["Hidden internal tables", schema.tables.filter((table) => table.internal).length],
      ].map(([label, value]) => '<div class="summary-card"><span>' + label + '</span><strong>' + value + '</strong></div>').join("");

      currentTables = tables;
      currentRelationships = relationships;
      currentLayout = layout;
      renderDiagram();
    }

    function renderDiagram() {
      const diagram = document.getElementById("diagram");
      const width = Math.max(1800, Math.max(...Object.values(currentLayout).map((box) => box.x + box.width + margin), 0));
      const height = Math.max(960, Math.max(...Object.values(currentLayout).map((box) => box.y + box.height + margin), 0));
      diagram.style.width = width + "px";
      diagram.style.height = height + "px";
      diagram.innerHTML = renderSvg(width, height, currentRelationships, currentLayout) + currentTables.map((table) => renderTable(table, currentLayout[table.name])).join("");
      attachDragHandlers();
    }

    function layoutTables(tables) {
      const columns = new Map();
      const layout = {};
      let fallbackIndex = 0;

      for (const table of tables) {
        const height = headerHeight + Math.max(1, table.columns.length) * rowHeight;
        const defaultPosition = defaultPositions[table.name];
        if (defaultPosition) {
          layout[table.name] = { x: defaultPosition.x, y: defaultPosition.y, width: tableWidth, height };
          continue;
        }
        const column = 4;
        const stack = columns.get(column) ?? [];
        const x = margin + column * (tableWidth + gapX);
        const y = margin + stack.reduce((sum, item) => sum + item.height + gapY, 0);
        const box = { x, y, width: tableWidth, height };
        layout[table.name] = box;
        stack.push(box);
        columns.set(column, stack);
      }

      return layout;
    }

    function applySavedPositions(layout) {
      const saved = readSavedLayout();
      for (const [tableName, position] of Object.entries(saved)) {
        if (!layout[tableName]) continue;
        layout[tableName] = {
          ...layout[tableName],
          x: Number.isFinite(position.x) ? position.x : layout[tableName].x,
          y: Number.isFinite(position.y) ? position.y : layout[tableName].y,
        };
      }
      return layout;
    }

    function renderSvg(width, height, relationships, layout) {
      const paths = relationships.map((relationship, index) => {
        const from = layout[relationship.fromTable];
        const to = layout[relationship.toTable];
        if (!from || !to) return "";
        const fromPoint = anchorPoint(from, relationship.fromColumn, relationship.fromTable, relationship.toTable, true);
        const toPoint = anchorPoint(to, relationship.toColumn, relationship.fromTable, relationship.toTable, false);
        const x1 = fromPoint.x;
        const y1 = fromPoint.y;
        const x2 = toPoint.x;
        const y2 = toPoint.y;
        const curve = Math.max(44, Math.abs(x2 - x1) * 0.45);
        const c1 = fromPoint.side === "right" ? x1 + curve : x1 - curve;
        const c2 = toPoint.side === "left" ? x2 - curve : x2 + curve;
        const labelX = (x1 + x2) / 2;
        const labelY = (y1 + y2) / 2 - 10 + (index % 4) * 16;
        const label = relationship.fromTable + "." + relationship.fromColumn + " → " + relationship.toTable + "." + relationship.toColumn;
        return '<path class="relationship-line" d="M ' + x1 + ' ' + y1 + ' C ' + c1 + ' ' + y1 + ', ' + c2 + ' ' + y2 + ', ' + x2 + ' ' + y2 + '" fill="none" marker-end="url(#arrow)" />' +
          '<circle class="relationship-port" cx="' + x1 + '" cy="' + y1 + '" r="4" />' +
          '<circle class="relationship-port" cx="' + x2 + '" cy="' + y2 + '" r="4" />' +
          '<text class="fk-label" x="' + labelX + '" y="' + labelY + '" text-anchor="middle">' + escapeHtml(label) + '</text>';
      }).join("");

      return '<svg class="relationships" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">' +
        '<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="#64748b" /></marker></defs>' +
        paths +
      '</svg>';
    }

    function anchorPoint(box, columnName, fromTable, toTable, isSource) {
      const table = currentTables.find((item) => item.name === (isSource ? fromTable : toTable));
      const columnIndex = Math.max(0, table?.columns.findIndex((column) => column.name === columnName) ?? 0);
      const y = box.y + headerHeight + columnIndex * rowHeight + rowHeight / 2;
      const sourceBox = currentLayout[fromTable];
      const targetBox = currentLayout[toTable];
      const sourceCenter = sourceBox ? sourceBox.x + sourceBox.width / 2 : 0;
      const targetCenter = targetBox ? targetBox.x + targetBox.width / 2 : 0;
      const sourceIsLeft = sourceCenter <= targetCenter;
      const side = isSource ? (sourceIsLeft ? "right" : "left") : (sourceIsLeft ? "left" : "right");
      return {
        side,
        x: side === "right" ? box.x + box.width : box.x,
        y: Math.min(box.y + box.height - 12, Math.max(box.y + headerHeight + 12, y)),
      };
    }

    function renderTable(table, box) {
      return '<article class="table-card ' + (table.internal ? "internal" : "") + '" data-table="' + escapeHtml(table.name) + '" style="left:' + box.x + 'px;top:' + box.y + 'px;width:' + box.width + 'px;height:' + box.height + 'px">' +
        '<div class="table-header" data-drag-handle><div class="table-name">' + escapeHtml(table.name) + '</div><div class="table-kind">' + escapeHtml(table.type) + '</div></div>' +
        '<div class="columns">' +
        table.columns.map((column) => {
          const badges = (column.primaryKey ? '<span class="badge">PK</span>' : '') + (isForeignKey(table, column.name) ? '<span class="badge">FK</span>' : '');
          return '<div class="column"><div class="column-name" title="' + escapeHtml(column.name) + '">' + badges + escapeHtml(column.name) + '</div><div class="column-type">' + escapeHtml(column.type) + '</div></div>';
        }).join("") +
        '</div></article>';
    }

    function isForeignKey(table, columnName) {
      return table.foreignKeys.some((relationship) => relationship.fromColumn === columnName);
    }

    function attachDragHandlers() {
      for (const handle of document.querySelectorAll("[data-drag-handle]")) {
        handle.addEventListener("pointerdown", startDrag);
      }
    }

    function startDrag(event) {
      const card = event.currentTarget.closest("[data-table]");
      const tableName = card?.dataset.table;
      if (!tableName || !currentLayout[tableName]) return;
      event.preventDefault();
      card.setPointerCapture?.(event.pointerId);
      card.classList.add("dragging");
      dragState = {
        tableName,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startLeft: currentLayout[tableName].x,
        startTop: currentLayout[tableName].y,
      };
    }

    function onPointerMove(event) {
      if (!dragState) return;
      const nextX = Math.max(12, dragState.startLeft + event.clientX - dragState.startX);
      const nextY = Math.max(12, dragState.startTop + event.clientY - dragState.startY);
      currentLayout[dragState.tableName] = {
        ...currentLayout[dragState.tableName],
        x: nextX,
        y: nextY,
      };
      renderDiagram();
      const card = document.querySelector('[data-table="' + cssEscape(dragState.tableName) + '"]');
      card?.classList.add("dragging");
    }

    function endDrag() {
      if (!dragState) return;
      saveLayout();
      dragState = null;
      for (const card of document.querySelectorAll(".table-card.dragging")) card.classList.remove("dragging");
    }

    function resetLayout() {
      window.localStorage.removeItem(layoutStorageKey());
      render();
    }

    function readSavedLayout() {
      try {
        return JSON.parse(window.localStorage.getItem(layoutStorageKey()) || "{}");
      } catch {
        return {};
      }
    }

    function saveLayout() {
      const saved = {};
      for (const [name, box] of Object.entries(currentLayout)) saved[name] = { x: Math.round(box.x), y: Math.round(box.y) };
      window.localStorage.setItem(layoutStorageKey(), JSON.stringify(saved));
    }

    function layoutStorageKey() {
      return "novo-erd-layout-v2:" + (schema?.databasePath || "default");
    }

    function cssEscape(value) {
      return String(value).replace(/["\\\\]/g, "\\\\$&");
    }

    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
    }
  </script>
</body>
</html>`;
}

function sendHtml(response, body, status = 200) {
  response.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  response.end(body);
}

function sendJson(response, body, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body, null, 2));
}

function sendText(response, body, status = 200) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(body);
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--db") parsed.db = values[++index];
    else if (value === "--host") parsed.host = values[++index];
    else if (value === "--port") parsed.port = values[++index];
    else if (value === "--help" || value === "-h") {
      const scriptName = path.basename(fileURLToPath(import.meta.url));
      console.log(`Usage: node scripts/${scriptName} [--db path/to/eln.sqlite3] [--host 127.0.0.1] [--port 3188]`);
      process.exit(0);
    }
  }
  return parsed;
}
