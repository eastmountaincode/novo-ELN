import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import type { AccessRole, AdminDataOverview, AdminUser, AppUser, Attachment, AuditEvent, BlockType, Notebook, PageEntry, PageStatus, Project, ShareMember, UserRole, Workspace } from "./types";
import { bodyToEditorDocument, editorDocumentToBody, removeAttachmentCardsFromBody } from "./editor";
import { uploadDir } from "./paths";
import { rebuildSearchIndex } from "./search";
import { execSql, queryOne, querySql, sql } from "./sqlite";

let initialized = false;

const bootstrapEmail = process.env.ELN_BOOTSTRAP_EMAIL ?? "andrew@example.local";
const bootstrapPassword = process.env.ELN_BOOTSTRAP_PASSWORD ?? "Development-only-password-2026!";
const passwordRequirementMessage = "Password must be at least 12 characters and include uppercase, lowercase, number, and symbol characters.";
const loginRateLimitWindowMs = 15 * 60 * 1000;
const loginRateLimitMaxFailures = 10;
const loginAttemptRetentionMs = 24 * 60 * 60 * 1000;
export const pageBodyEditAuditCoalesceSeconds = 5 * 60;

function validatePassword(password: string) {
  if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    throw new Error(passwordRequirementMessage);
  }
}

function normalizeLoginEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeLoginIp(ipAddress: string) {
  return ipAddress.trim() || "unknown";
}

export function ensureDatabase() {
  if (initialized) return;
  execSql(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS login_attempts (
      email TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      failed_count INTEGER NOT NULL,
      first_failed_at INTEGER NOT NULL,
      last_failed_at INTEGER NOT NULL,
      PRIMARY KEY (email, ip_address)
    );

    CREATE TABLE IF NOT EXISTS notebooks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      color TEXT NOT NULL DEFAULT '#0891b2',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notebook_members (
      notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'editor',
      PRIMARY KEY (notebook_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS pages (
      id TEXT PRIMARY KEY,
      notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      owner_id TEXT NOT NULL REFERENCES users(id),
      locked_at TEXT,
      locked_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS page_tags (
      page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      PRIMARY KEY (page_id, tag)
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      storage_key TEXT NOT NULL,
      block_type TEXT NOT NULL DEFAULT 'file',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      page_id TEXT,
      notebook_id TEXT,
      actor_user_id TEXT,
      action TEXT NOT NULL,
      summary TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      event_count INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS audit_events_page_idx ON audit_events(page_id, updated_at);
    CREATE INDEX IF NOT EXISTS audit_events_notebook_idx ON audit_events(notebook_id, updated_at);
    CREATE INDEX IF NOT EXISTS audit_events_actor_idx ON audit_events(actor_user_id, updated_at);

    DROP TABLE IF EXISTS import_jobs;
    DROP TABLE IF EXISTS page_versions;
  `);
  migrateUserNameColumns();
  migrateProjectsToTopLevelNotebooks();
  ensureNotebookColumns();
  ensurePageLockColumns();
  migrateAttachmentPreviewTextColumn();
  execSql(`
    DROP TABLE IF EXISTS search_pages_fts;
    CREATE VIRTUAL TABLE search_pages_fts USING fts5(
      page_id UNINDEXED,
      notebook_id UNINDEXED,
      title,
      body,
      tags,
      attachments,
      notebook UNINDEXED,
      updated_at UNINDEXED,
      tokenize='unicode61'
    );
  `);
  migratePageStatusValues();
  migrateGroupedTagsToPageTags();
  seedIfEmpty();
  rebuildSearchIndex();
  initialized = true;
}

function migrateProjectsToTopLevelNotebooks() {
  const notebookColumns = querySql("PRAGMA table_info(notebooks);");
  if (notebookColumns.some((column) => column.name === "project_id")) {
    execSql(`
      PRAGMA foreign_keys=OFF;

      CREATE TABLE IF NOT EXISTS notebooks_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        color TEXT NOT NULL DEFAULT '#0891b2',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT OR IGNORE INTO notebooks_new (id, name, owner_id, color, created_at, updated_at)
      SELECT
        n.id,
        n.name,
        COALESCE(p.owner_id, (SELECT id FROM users ORDER BY datetime(created_at) ASC LIMIT 1)),
        COALESCE(p.color, '#0891b2'),
        n.created_at,
        n.updated_at
      FROM notebooks n
      LEFT JOIN projects p ON p.id = n.project_id
      WHERE COALESCE(p.owner_id, (SELECT id FROM users ORDER BY datetime(created_at) ASC LIMIT 1)) IS NOT NULL;

      INSERT OR IGNORE INTO notebook_members (notebook_id, user_id, role)
      SELECT n.id, pm.user_id, pm.role
      FROM notebooks n
      JOIN project_members pm ON pm.project_id = n.project_id;

      INSERT OR IGNORE INTO notebook_members (notebook_id, user_id, role)
      SELECT id, owner_id, 'owner'
      FROM notebooks_new;

      DROP TABLE notebooks;
      ALTER TABLE notebooks_new RENAME TO notebooks;
      DROP TABLE IF EXISTS project_members;
      DROP TABLE IF EXISTS projects;

      PRAGMA foreign_keys=ON;
    `);
  } else {
    execSql(`
      DROP TABLE IF EXISTS project_members;
      DROP TABLE IF EXISTS projects;
    `);
  }

  execSql(`
    DROP TABLE IF EXISTS import_jobs;
    DROP TABLE IF EXISTS page_versions;
  `);
}

function migrateUserNameColumns() {
  const columns = querySql("PRAGMA table_info(users);");
  const columnNames = new Set(columns.map((column) => column.name));
  if (!columnNames.has("first_name")) {
    execSql("ALTER TABLE users ADD COLUMN first_name TEXT NOT NULL DEFAULT '';");
  }
  if (!columnNames.has("last_name")) {
    execSql("ALTER TABLE users ADD COLUMN last_name TEXT NOT NULL DEFAULT '';");
  }
  if (!columnNames.has("name")) return;

  const rows = querySql(`
    SELECT id, name
    FROM users
    WHERE COALESCE(first_name, '') = ''
  `);

  for (const row of rows) {
    const { firstName, lastName } = splitDisplayName(row.name);
    execSql(`
      UPDATE users
      SET first_name = ${sql(firstName)}, last_name = ${sql(lastName)}
      WHERE id = ${sql(row.id)};
    `);
  }
}

function ensureNotebookColumns() {
  const columns = querySql("PRAGMA table_info(notebooks);");
  const names = new Set(columns.map((column) => column.name));
  if (!names.has("owner_id")) {
    execSql(`
      ALTER TABLE notebooks ADD COLUMN owner_id TEXT;
      UPDATE notebooks SET owner_id = (SELECT id FROM users ORDER BY datetime(created_at) ASC LIMIT 1) WHERE owner_id IS NULL;
    `);
  }
  if (!names.has("color")) execSql("ALTER TABLE notebooks ADD COLUMN color TEXT NOT NULL DEFAULT '#0891b2';");
}

function ensurePageLockColumns() {
  const columns = querySql("PRAGMA table_info(pages);");
  const names = new Set(columns.map((column) => column.name));
  if (!names.has("locked_at")) execSql("ALTER TABLE pages ADD COLUMN locked_at TEXT;");
  if (!names.has("locked_by")) execSql("ALTER TABLE pages ADD COLUMN locked_by TEXT REFERENCES users(id);");
}

function migrateAttachmentPreviewTextColumn() {
  const columns = querySql("PRAGMA table_info(attachments);");
  const names = new Set(columns.map((column) => column.name));
  if (!names.has("preview_text")) return;

  execSql(`
    PRAGMA foreign_keys=OFF;

    CREATE TABLE attachments_new (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      storage_key TEXT NOT NULL,
      block_type TEXT NOT NULL DEFAULT 'file',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT INTO attachments_new (id, page_id, original_name, mime_type, size, storage_key, block_type, created_at)
    SELECT id, page_id, original_name, mime_type, size, storage_key, block_type, created_at
    FROM attachments;

    DROP TABLE attachments;
    ALTER TABLE attachments_new RENAME TO attachments;

    PRAGMA foreign_keys=ON;
  `);
}

function migratePageStatusValues() {
  execSql(`
    UPDATE pages SET status = '' WHERE status = 'Draft';
    UPDATE pages SET status = 'Completed' WHERE status = 'Final';
  `);
}

function migrateGroupedTagsToPageTags() {
  const tables = querySql("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('tag_groups', 'tag_values', 'page_tag_values');");
  const tableNames = new Set(tables.map((table) => table.name));
  if (!tableNames.has("tag_groups") || !tableNames.has("tag_values") || !tableNames.has("page_tag_values")) return;

  execSql(`
    INSERT OR IGNORE INTO page_tags (page_id, tag)
    SELECT ptv.page_id, tv.label
    FROM page_tag_values ptv
    JOIN tag_values tv ON tv.id = ptv.tag_value_id
    WHERE tv.archived_at IS NULL
      AND trim(tv.label) <> '';

    DROP TABLE page_tag_values;
    DROP TABLE tag_values;
    DROP TABLE tag_groups;
  `);
}

function seedIfEmpty() {
  const count = Number(queryOne("SELECT COUNT(*) AS count FROM users")?.count ?? 0);
  if (count > 0) return;

  const userId = randomUUID();
  const constructNotebookId = randomUUID();
  const meetingNotebookId = randomUUID();
  const pageOneId = randomUUID();
  const pageTwoId = randomUUID();
  const pageThreeId = randomUUID();

  execSql(`
    INSERT INTO users (id, email, first_name, last_name, password_hash, role)
    VALUES (${sql(userId)}, ${sql(bootstrapEmail)}, 'Andrew', '', ${sql(bcrypt.hashSync(bootstrapPassword, 10))}, 'admin');

    INSERT INTO notebooks (id, name, owner_id, color)
    VALUES (${sql(constructNotebookId)}, 'Construct Design', ${sql(userId)}, ${sql(defaultNotebookColor(constructNotebookId))}),
           (${sql(meetingNotebookId)}, 'Meetings', ${sql(userId)}, ${sql(defaultNotebookColor(meetingNotebookId))});

    INSERT INTO notebook_members (notebook_id, user_id, role)
    VALUES (${sql(constructNotebookId)}, ${sql(userId)}, 'owner'),
           (${sql(meetingNotebookId)}, ${sql(userId)}, 'owner');

    INSERT INTO pages (id, notebook_id, title, body, status, owner_id)
    VALUES
      (${sql(pageOneId)}, ${sql(constructNotebookId)}, 'SortSeq plasmid assembly', ${sql("Summary of the SortSeq construct changes. The key need is keeping protocol text, source files, and analysis artifacts together without turning this into a full LIMS.")}, '', ${sql(userId)}),
      (${sql(pageTwoId)}, ${sql(constructNotebookId)}, 'Competent cell prep', ${sql("Prep pages should behave like normal pages, not special experiments. A lightweight checklist is enough for repeatable work; scheduling and bookable resources are intentionally out of scope.")}, '', ${sql(userId)}),
      (${sql(pageThreeId)}, ${sql(meetingNotebookId)}, 'ELN requirements from Slim', ${sql("The replacement should preserve Evernote-like workflows: notebooks, pages, inline images, attachments, search, and history.")}, '', ${sql(userId)});

    INSERT INTO page_tags (page_id, tag)
    VALUES
      (${sql(pageOneId)}, 'plasmid'),
      (${sql(pageOneId)}, 'sortseq'),
      (${sql(pageOneId)}, 'Running'),
      (${sql(pageOneId)}, 'Cloning'),
      (${sql(pageTwoId)}, 'prep'),
      (${sql(pageTwoId)}, 'Running'),
      (${sql(pageThreeId)}, 'requirements'),
      (${sql(pageThreeId)}, 'Meeting');
  `);
}

export function findUserByEmail(email: string) {
  ensureDatabase();
  const row = queryOne(`SELECT id, email, first_name, last_name, password_hash, role FROM users WHERE lower(email) = lower(${sql(email)}) LIMIT 1`);
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    passwordHash: row.password_hash,
    role: row.role as UserRole,
  };
}

export function findUserById(id: string): AppUser | null {
  ensureDatabase();
  const row = queryOne(`SELECT id, email, first_name, last_name, role FROM users WHERE id = ${sql(id)} LIMIT 1`);
  if (!row) return null;
  return { id: row.id, email: row.email, firstName: row.first_name, lastName: row.last_name, role: row.role as UserRole };
}

export function verifyCredentials(email: string, password: string): AppUser | null {
  const user = findUserByEmail(email);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) return null;
  return { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role };
}

export function getLoginRateLimit(email: string, ipAddress: string, now = Date.now()) {
  ensureDatabase();
  pruneLoginAttempts(now);
  const normalizedEmail = normalizeLoginEmail(email);
  const normalizedIp = normalizeLoginIp(ipAddress);
  const row = queryOne(`SELECT failed_count, first_failed_at FROM login_attempts WHERE email = ${sql(normalizedEmail)} AND ip_address = ${sql(normalizedIp)} LIMIT 1`);
  if (!row) return { limited: false, retryAfterSeconds: 0 };

  const firstFailedAt = Number(row.first_failed_at);
  const failedCount = Number(row.failed_count);
  if (!Number.isFinite(firstFailedAt) || firstFailedAt <= now - loginRateLimitWindowMs) {
    return { limited: false, retryAfterSeconds: 0 };
  }

  if (failedCount < loginRateLimitMaxFailures) return { limited: false, retryAfterSeconds: 0 };
  return { limited: true, retryAfterSeconds: Math.max(1, Math.ceil((firstFailedAt + loginRateLimitWindowMs - now) / 1000)) };
}

export function recordFailedLogin(email: string, ipAddress: string, now = Date.now()) {
  ensureDatabase();
  pruneLoginAttempts(now);
  const normalizedEmail = normalizeLoginEmail(email);
  const normalizedIp = normalizeLoginIp(ipAddress);
  const row = queryOne(`SELECT failed_count, first_failed_at FROM login_attempts WHERE email = ${sql(normalizedEmail)} AND ip_address = ${sql(normalizedIp)} LIMIT 1`);
  const firstFailedAt = Number(row?.first_failed_at);
  const withinWindow = row && Number.isFinite(firstFailedAt) && firstFailedAt > now - loginRateLimitWindowMs;

  if (withinWindow) {
    execSql(`
      UPDATE login_attempts
      SET failed_count = failed_count + 1, last_failed_at = ${sql(now)}
      WHERE email = ${sql(normalizedEmail)} AND ip_address = ${sql(normalizedIp)};
    `);
    return;
  }

  execSql(`
    INSERT INTO login_attempts (email, ip_address, failed_count, first_failed_at, last_failed_at)
    VALUES (${sql(normalizedEmail)}, ${sql(normalizedIp)}, 1, ${sql(now)}, ${sql(now)})
    ON CONFLICT(email, ip_address) DO UPDATE SET
      failed_count = 1,
      first_failed_at = excluded.first_failed_at,
      last_failed_at = excluded.last_failed_at;
  `);
}

export function clearFailedLogins(email: string, ipAddress: string) {
  ensureDatabase();
  execSql(`DELETE FROM login_attempts WHERE email = ${sql(normalizeLoginEmail(email))} AND ip_address = ${sql(normalizeLoginIp(ipAddress))};`);
}

function pruneLoginAttempts(now = Date.now()) {
  execSql(`DELETE FROM login_attempts WHERE last_failed_at <= ${sql(now - loginAttemptRetentionMs)};`);
}

export function createUser(input: { email: string; firstName: string; lastName?: string; password: string; role?: UserRole }): AppUser {
  ensureDatabase();
  const email = input.email.trim().toLowerCase();
  const firstName = normalizeUserNamePart(input.firstName);
  const lastName = normalizeUserNamePart(input.lastName ?? "");
  const password = input.password;
  const role = input.role ?? "member";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
  if (!firstName) throw new Error("First name is required.");
  validatePassword(password);
  if (!["admin", "member", "viewer"].includes(role)) throw new Error("Invalid role.");
  if (findUserByEmail(email)) throw new Error("An account with that email already exists.");

  const userId = randomUUID();
  const notebookId = randomUUID();
  const pageId = randomUUID();

  execSql(`
    INSERT INTO users (id, email, first_name, last_name, password_hash, role)
    VALUES (${sql(userId)}, ${sql(email)}, ${sql(firstName)}, ${sql(lastName)}, ${sql(bcrypt.hashSync(password, 10))}, ${sql(role)});

    INSERT INTO notebooks (id, name, owner_id, color)
    VALUES (${sql(notebookId)}, 'Notebook', ${sql(userId)}, ${sql(defaultNotebookColor(notebookId))});

    INSERT INTO notebook_members (notebook_id, user_id, role)
    VALUES (${sql(notebookId)}, ${sql(userId)}, 'owner');

    INSERT INTO pages (id, notebook_id, title, body, status, owner_id)
    VALUES (${sql(pageId)}, ${sql(notebookId)}, 'Untitled', '', '', ${sql(userId)});
  `);
  rebuildSearchIndex();
  return { id: userId, email, firstName, lastName, role };
}

export function listUsersForAdmin(adminUserId: string): AdminUser[] {
  ensureDatabase();
  assertAdmin(adminUserId);
  return querySql(`
    SELECT
      u.id,
      u.email,
      u.first_name,
      u.last_name,
      u.role,
      u.created_at,
      COUNT(DISTINCT nm.notebook_id) AS notebook_count
    FROM users u
    LEFT JOIN notebook_members nm ON nm.user_id = u.id AND nm.role = 'owner'
    GROUP BY u.id
    ORDER BY lower(u.first_name) ASC, lower(u.last_name) ASC, lower(u.email) ASC
  `).map((row) => ({
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    role: row.role as UserRole,
    createdAt: row.created_at,
    notebookCount: Number(row.notebook_count),
  }));
}

export function getAdminDataOverview(adminUserId: string, options: { fileLimit?: number; fileOffset?: number } = {}): AdminDataOverview {
  ensureDatabase();
  assertAdmin(adminUserId);
  const fileLimit = clampInteger(options.fileLimit, 1, 100, 25);
  const fileOffset = clampInteger(options.fileOffset, 0, 1_000_000_000, 0);

  const counts = {
    users: countRows("users"),
    notebooks: countRows("notebooks"),
    pages: countRows("pages"),
    attachments: countRows("attachments"),
  };
  const files = querySql(`
    SELECT
      a.id,
      a.original_name,
      a.mime_type,
      a.size,
      a.block_type,
      a.storage_key,
      a.created_at,
      p.title AS page_title,
      n.name AS notebook_name,
      u.email AS owner_email
    FROM attachments a
    JOIN pages p ON p.id = a.page_id
    JOIN notebooks n ON n.id = p.notebook_id
    JOIN users u ON u.id = n.owner_id
    ORDER BY a.created_at DESC, lower(a.original_name) ASC
    LIMIT ${fileLimit} OFFSET ${fileOffset}
  `).map((row) => ({
    id: row.id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    size: Number(row.size),
    blockType: row.block_type as BlockType,
    storageKey: row.storage_key,
    createdAt: row.created_at,
    notebookName: row.notebook_name,
    pageTitle: row.page_title,
    ownerEmail: row.owner_email,
  }));

  const attachmentBytes = Number(queryOne(`SELECT COALESCE(SUM(size), 0) AS total FROM attachments`)?.total ?? 0);
  const attachmentRows = querySql("SELECT storage_key FROM attachments");
  const uploadFiles = listUploadFiles();
  const uploadFileKeys = new Set(uploadFiles.map((file) => file.relativePath));
  const attachmentKeys = new Set(attachmentRows.map((file) => file.storage_key));
  const orphanUploadBytes = uploadFiles.reduce((total, file) => total + (attachmentKeys.has(file.relativePath) ? 0 : file.size), 0);
  const orphanUploadCount = uploadFiles.filter((file) => !attachmentKeys.has(file.relativePath)).length;
  const missingUploadCount = attachmentRows.filter((file) => !uploadFileKeys.has(file.storage_key)).length;

  return {
    counts,
    storage: {
      attachmentBytes,
      uploadFileCount: uploadFiles.length,
      uploadBytes: uploadFiles.reduce((total, file) => total + file.size, 0),
      orphanUploadCount,
      orphanUploadBytes,
      missingUploadCount,
    },
    filePage: {
      total: counts.attachments,
      limit: fileLimit,
      offset: fileOffset,
    },
    files,
  };
}

export function changeOwnPassword(userId: string, currentPassword: string, nextPassword: string) {
  ensureDatabase();
  const user = queryOne(`SELECT password_hash FROM users WHERE id = ${sql(userId)} LIMIT 1`);
  if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) throw new Error("Current password is incorrect.");
  updateUserPassword(userId, nextPassword);
}

export function adminSetUserPassword(adminUserId: string, targetUserId: string, nextPassword: string) {
  ensureDatabase();
  assertAdmin(adminUserId);
  if (!findUserById(targetUserId)) throw new Error("User not found.");
  updateUserPassword(targetUserId, nextPassword);
}

export function getWorkspace(userId: string): Workspace {
  ensureDatabase();
  const user = findUserById(userId);
  if (!user) throw new Error("User not found");

  const notebookRows = querySql(`
    SELECT
      n.id,
      n.name,
      n.owner_id,
      n.color,
      n.created_at,
      n.updated_at,
      CASE
        WHEN nm.role = 'owner' THEN 'owner'
        WHEN nm.role = 'editor' THEN 'editor'
        ELSE 'viewer'
      END AS access_role
    FROM notebooks n
    JOIN notebook_members nm ON nm.notebook_id = n.id AND nm.user_id = ${sql(userId)}
    GROUP BY n.id
    ORDER BY datetime(n.updated_at) DESC, lower(n.name) ASC
  `);
  const notebookIds = notebookRows.map((notebook) => notebook.id);
  const pageRows = notebookIds.length
    ? querySql(`
        SELECT
          p.id,
          p.notebook_id,
          p.title,
          p.body,
          p.status,
          p.owner_id,
          u.first_name AS owner_first_name,
          u.last_name AS owner_last_name,
          COALESCE(p.locked_at, '') AS locked_at,
          COALESCE(p.locked_by, '') AS locked_by,
          COALESCE(locker.first_name, '') AS locked_by_first_name,
          COALESCE(locker.last_name, '') AS locked_by_last_name,
          p.created_at,
          p.updated_at
        FROM pages p
        JOIN users u ON u.id = p.owner_id
        LEFT JOIN users locker ON locker.id = p.locked_by
        WHERE p.notebook_id IN (${inList(notebookIds)})
        ORDER BY datetime(p.created_at) DESC, lower(p.title) ASC
      `)
    : [];
  const pageIds = pageRows.map((page) => page.id);
  const tagRows = pageIds.length ? querySql(`SELECT page_id, tag FROM page_tags WHERE page_id IN (${inList(pageIds)}) ORDER BY rowid ASC`) : [];
  const attachmentRows = pageIds.length
    ? querySql(`SELECT id, page_id, original_name, mime_type, size, storage_key, block_type, created_at FROM attachments WHERE page_id IN (${inList(pageIds)}) ORDER BY created_at DESC`)
    : [];
  const notebookMemberRows = notebookIds.length
    ? querySql(`
        SELECT nm.notebook_id, nm.user_id, nm.role, u.email, u.first_name, u.last_name
        FROM notebook_members nm
        JOIN users u ON u.id = nm.user_id
        WHERE nm.notebook_id IN (${inList(notebookIds)})
        ORDER BY lower(u.first_name) ASC, lower(u.last_name) ASC, lower(u.email) ASC
      `)
    : [];
  const memberRows = querySql(`SELECT id, email, first_name, last_name, role FROM users ORDER BY lower(first_name) ASC, lower(last_name) ASC, lower(email) ASC`);

  const tagsByPage = groupBy(tagRows, "page_id");
  const attachmentsByPage = groupBy(attachmentRows, "page_id");
  const pagesByNotebook = groupBy(pageRows, "notebook_id");
  const membersByNotebook = groupBy(notebookMemberRows, "notebook_id");

  const notebooks: Notebook[] = notebookRows.map((notebook) => ({
    id: notebook.id,
    name: notebook.name,
    color: normalizeNotebookColor(notebook.color),
    ownerId: notebook.owner_id,
    createdAt: notebook.created_at,
    updatedAt: notebook.updated_at,
    accessRole: normalizeAccessRole(notebook.access_role),
    members: (membersByNotebook[notebook.id] ?? []).map(toShareMember),
    pages: (pagesByNotebook[notebook.id] ?? []).map((page): PageEntry => ({
      id: page.id,
      notebookId: page.notebook_id,
      title: page.title,
      body: page.body,
      status: normalizePageStatus(page.status),
      ownerId: page.owner_id,
      ownerFirstName: page.owner_first_name,
      ownerLastName: page.owner_last_name,
      lockedAt: page.locked_at,
      lockedBy: page.locked_by,
      lockedByFirstName: page.locked_by_first_name,
      lockedByLastName: page.locked_by_last_name,
      createdAt: page.created_at,
      updatedAt: page.updated_at,
      tags: pageTagRowsToList(tagsByPage[page.id] ?? []),
      attachments: (attachmentsByPage[page.id] ?? []).map(toAttachment),
    })),
  }));

  const workspaceProject: Project = {
    id: "workspace",
    name: "Notebooks",
    description: "Top-level notebook workspace.",
    color: notebooks[0]?.color ?? "#0891b2",
    ownerId: user.id,
    createdAt: notebooks[0]?.createdAt ?? new Date().toISOString(),
    updatedAt: notebooks[0]?.updatedAt ?? new Date().toISOString(),
    accessScope: "notebook",
    accessRole: "owner",
    members: [],
    notebooks,
  };

  return {
    user,
    members: memberRows.map((row) => ({ id: row.id, email: row.email, firstName: row.first_name, lastName: row.last_name, role: row.role as UserRole })),
    notebooks,
    projects: [workspaceProject],
  };
}

export function getPageActivityEvents(userId: string, pageId: string, options: { limit?: number; offset?: number } = {}) {
  ensureDatabase();
  assertPageReadAccess(userId, pageId);
  const limit = clampInteger(options.limit, 1, 100, 25);
  const offset = clampInteger(options.offset, 0, 1_000_000_000, 0);
  const total = Number(queryOne(`SELECT COUNT(*) AS count FROM audit_events WHERE page_id = ${sql(pageId)}`)?.count ?? 0);
  const events = querySql(`
    SELECT
      ae.id,
      ae.entity_type,
      ae.entity_id,
      COALESCE(ae.page_id, '') AS page_id,
      COALESCE(ae.notebook_id, '') AS notebook_id,
      COALESCE(ae.actor_user_id, '') AS actor_user_id,
      COALESCE(u.first_name, '') AS actor_first_name,
      COALESCE(u.last_name, '') AS actor_last_name,
      COALESCE(u.email, '') AS actor_email,
      ae.action,
      ae.summary,
      ae.metadata_json,
      ae.event_count,
      ae.created_at,
      ae.updated_at
    FROM audit_events ae
    LEFT JOIN users u ON u.id = ae.actor_user_id
    WHERE ae.page_id = ${sql(pageId)}
    ORDER BY datetime(ae.updated_at) DESC, datetime(ae.created_at) DESC, ae.rowid DESC
    LIMIT ${limit} OFFSET ${offset}
  `).map(toAuditEvent);
  return {
    events,
    total,
    limit,
    offset,
    hasMore: offset + events.length < total,
  };
}

export function createNotebook(userId: string, name = "New Notebook") {
  ensureDatabase();
  const notebookId = randomUUID();
  const pageId = randomUUID();
  execSql(`
    INSERT INTO notebooks (id, name, owner_id, color)
    VALUES (${sql(notebookId)}, ${sql(name)}, ${sql(userId)}, ${sql(defaultNotebookColor(notebookId))});
    INSERT INTO notebook_members (notebook_id, user_id, role)
    VALUES (${sql(notebookId)}, ${sql(userId)}, 'owner');
    INSERT INTO pages (id, notebook_id, title, body, status, owner_id)
    VALUES (${sql(pageId)}, ${sql(notebookId)}, 'Untitled', '', '', ${sql(userId)});
  `);
  recordNotebookAuditEvent(userId, notebookId, "notebook.created", `created notebook ${quoteAuditValue(name)}`, { name });
  recordPageAuditEvent(userId, pageId, "page.created", "created page", { source: "notebook.create" });
  rebuildSearchIndex();
  return { notebookId, pageId };
}

export function renameNotebook(userId: string, notebookId: string, name: string) {
  ensureDatabase();
  assertNotebookEditAccess(userId, notebookId);
  const current = queryOne(`SELECT name FROM notebooks WHERE id = ${sql(notebookId)} LIMIT 1`);
  const nextName = name.trim();
  if (!nextName) throw new Error("Notebook name is required");
  if (current?.name === nextName) return;
  execSql(`UPDATE notebooks SET name = ${sql(nextName)}, updated_at = datetime('now') WHERE id = ${sql(notebookId)};`);
  recordNotebookAuditEvent(userId, notebookId, "notebook.renamed", `renamed notebook from ${quoteAuditValue(current?.name ?? "Untitled")} to ${quoteAuditValue(nextName)}`, {
    oldName: current?.name ?? "",
    newName: nextName,
  });
  rebuildSearchIndex();
}

export function updateNotebookColor(userId: string, notebookId: string, color: string) {
  ensureDatabase();
  assertNotebookEditAccess(userId, notebookId);
  const nextColor = normalizeNotebookColor(color);
  const current = queryOne(`SELECT color FROM notebooks WHERE id = ${sql(notebookId)} LIMIT 1`);
  if (normalizeNotebookColor(current?.color) === nextColor) return;
  execSql(`UPDATE notebooks SET color = ${sql(nextColor)}, updated_at = datetime('now') WHERE id = ${sql(notebookId)};`);
  recordNotebookAuditEvent(userId, notebookId, "notebook.color.updated", "changed notebook color", {
    oldColor: normalizeNotebookColor(current?.color),
    newColor: nextColor,
  });
}

export function deleteNotebook(userId: string, notebookId: string) {
  ensureDatabase();
  assertNotebookManageAccess(userId, notebookId);
  const notebook = queryOne(`SELECT name FROM notebooks WHERE id = ${sql(notebookId)} LIMIT 1`);
  recordNotebookAuditEvent(userId, notebookId, "notebook.deleted", `deleted notebook ${quoteAuditValue(notebook?.name ?? "Untitled")}`, {
    name: notebook?.name ?? "",
  });
  execSql(`DELETE FROM notebooks WHERE id = ${sql(notebookId)};`);
  rebuildSearchIndex();
}

export function createPage(userId: string, notebookId: string) {
  ensureDatabase();
  assertNotebookEditAccess(userId, notebookId);
  const pageId = randomUUID();
  execSql(`
    INSERT INTO pages (id, notebook_id, title, body, status, owner_id)
    VALUES (${sql(pageId)}, ${sql(notebookId)}, 'Untitled', '', '', ${sql(userId)});
    UPDATE notebooks SET updated_at = datetime('now') WHERE id = ${sql(notebookId)};
  `);
  recordPageAuditEvent(userId, pageId, "page.created", "created page");
  rebuildSearchIndex();
  return pageId;
}

export function updatePage(userId: string, pageId: string, patch: { title?: string; body?: string; status?: PageStatus }) {
  ensureDatabase();
  assertPageEditAccess(userId, pageId);
  const row = queryOne(`SELECT notebook_id, title, body, status FROM pages WHERE id = ${sql(pageId)} LIMIT 1`);
  if (!row) throw new Error("Page not found");
  const assignments: string[] = [];
  const normalizedStatus = patch.status !== undefined ? normalizePageStatus(patch.status) : undefined;
  const previousTitle = String(row.title ?? "");
  const previousBody = String(row.body ?? "");
  const previousStatus = normalizePageStatus(row.status);
  const titleChanged = patch.title !== undefined && patch.title !== previousTitle;
  const bodyChanged = patch.body !== undefined && normalizePageBody(patch.body) !== normalizePageBody(previousBody);
  const statusChanged = normalizedStatus !== undefined && normalizedStatus !== previousStatus;
  if (titleChanged) assignments.push(`title = ${sql(patch.title)}`);
  if (bodyChanged) assignments.push(`body = ${sql(patch.body)}`);
  if (statusChanged) assignments.push(`status = ${sql(normalizedStatus)}`);
  if (!assignments.length) return false;
  assignments.push("updated_at = datetime('now')");

  execSql(`
    UPDATE pages SET ${assignments.join(", ")} WHERE id = ${sql(pageId)};
    UPDATE notebooks SET updated_at = datetime('now') WHERE id = (SELECT notebook_id FROM pages WHERE id = ${sql(pageId)});
  `);
  if (titleChanged) {
    recordAuditEvent({
      entityType: "page",
      entityId: pageId,
      pageId,
      notebookId: row.notebook_id,
      actorUserId: userId,
      action: "page.title.updated",
      summary: `renamed page from ${quoteAuditValue(previousTitle || "Untitled")} to ${quoteAuditValue(patch.title || "Untitled")}`,
      metadata: { oldTitle: previousTitle, newTitle: patch.title ?? "" },
    });
  }
  if (statusChanged) {
    recordAuditEvent({
      entityType: "page",
      entityId: pageId,
      pageId,
      notebookId: row.notebook_id,
      actorUserId: userId,
      action: "page.status.updated",
      summary: `changed status from ${quoteAuditValue(statusLabel(previousStatus))} to ${quoteAuditValue(statusLabel(normalizedStatus))}`,
      metadata: { oldStatus: previousStatus, newStatus: normalizedStatus },
    });
  }
  if (bodyChanged) {
    recordAuditEvent({
      entityType: "page",
      entityId: pageId,
      pageId,
      notebookId: row.notebook_id,
      actorUserId: userId,
      action: "page.body.updated",
      summary: "edited page body",
      metadata: {
        oldHash: hashAuditValue(normalizePageBody(previousBody)),
        newHash: hashAuditValue(normalizePageBody(patch.body ?? "")),
        oldLength: normalizePageBody(previousBody).length,
        newLength: normalizePageBody(patch.body ?? "").length,
      },
      coalesce: true,
    });
  }
  rebuildSearchIndex();
  return true;
}

export function setPageLocked(userId: string, pageId: string, locked: boolean) {
  ensureDatabase();
  assertPageManageAccess(userId, pageId);
  const page = queryOne(`SELECT notebook_id, locked_at FROM pages WHERE id = ${sql(pageId)} LIMIT 1`);
  if (!page) throw new Error("Page not found");
  const currentlyLocked = Boolean(page.locked_at);
  if (currentlyLocked === locked) return;

  execSql(`
    UPDATE pages
    SET locked_at = ${locked ? "datetime('now')" : "NULL"},
        locked_by = ${locked ? sql(userId) : "NULL"},
        updated_at = datetime('now')
    WHERE id = ${sql(pageId)};
    UPDATE notebooks SET updated_at = datetime('now') WHERE id = ${sql(page.notebook_id)};
  `);
  recordAuditEvent({
    entityType: "page",
    entityId: pageId,
    pageId,
    notebookId: page.notebook_id,
    actorUserId: userId,
    action: locked ? "page.locked" : "page.unlocked",
    summary: locked ? "locked page" : "unlocked page",
    metadata: { locked },
  });
  rebuildSearchIndex();
}

export function setPageTags(userId: string, pageId: string, tags: string[]) {
  ensureDatabase();
  assertPageEditAccess(userId, pageId);
  const normalizedTags = normalizePageTags(tags);
  const currentTags = pageTagRowsToList(querySql(`SELECT tag FROM page_tags WHERE page_id = ${sql(pageId)} ORDER BY rowid ASC`));
  if (tagListsEqual(normalizedTags, currentTags)) return false;
  const page = queryOne(`SELECT notebook_id FROM pages WHERE id = ${sql(pageId)} LIMIT 1`);
  execSql(`
    DELETE FROM page_tags WHERE page_id = ${sql(pageId)};
    ${normalizedTags.map((tag) => `INSERT INTO page_tags (page_id, tag) VALUES (${sql(pageId)}, ${sql(tag)});`).join("\n")}
    UPDATE pages SET updated_at = datetime('now') WHERE id = ${sql(pageId)};
    UPDATE notebooks SET updated_at = datetime('now') WHERE id = (SELECT notebook_id FROM pages WHERE id = ${sql(pageId)});
  `);
  recordAuditEvent({
    entityType: "page",
    entityId: pageId,
    pageId,
    notebookId: page?.notebook_id ?? "",
    actorUserId: userId,
    action: "page.tags.updated",
    summary: tagAuditSummary(currentTags, normalizedTags),
    metadata: {
      oldTags: currentTags,
      newTags: normalizedTags,
      addedTags: normalizedTags.filter((tag) => !currentTags.includes(tag)),
      removedTags: currentTags.filter((tag) => !normalizedTags.includes(tag)),
    },
  });
  rebuildSearchIndex();
  return true;
}

export function deletePage(userId: string, pageId: string) {
  ensureDatabase();
  assertPageEditAccess(userId, pageId);
  const page = queryOne(`SELECT notebook_id, title FROM pages WHERE id = ${sql(pageId)} LIMIT 1`);
  if (!page) throw new Error("Page not found");
  recordAuditEvent({
    entityType: "page",
    entityId: pageId,
    pageId,
    notebookId: page.notebook_id,
    actorUserId: userId,
    action: "page.deleted",
    summary: `deleted page ${quoteAuditValue(page.title || "Untitled")}`,
    metadata: { title: page.title ?? "" },
  });
  execSql(`
    UPDATE notebooks SET updated_at = datetime('now') WHERE id = ${sql(page.notebook_id)};
    DELETE FROM pages WHERE id = ${sql(pageId)};
  `);
  rebuildSearchIndex();
}

export function createAttachment(input: {
  userId: string;
  pageId: string;
  originalName: string;
  mimeType: string;
  size: number;
  storageKey: string;
  blockType: BlockType;
}) {
  ensureDatabase();
  assertPageEditAccess(input.userId, input.pageId);
  const id = randomUUID();
  execSql(`
    INSERT INTO attachments (id, page_id, original_name, mime_type, size, storage_key, block_type)
    VALUES (${sql(id)}, ${sql(input.pageId)}, ${sql(input.originalName)}, ${sql(input.mimeType)}, ${input.size}, ${sql(input.storageKey)}, ${sql(input.blockType)});
    UPDATE pages SET updated_at = datetime('now') WHERE id = ${sql(input.pageId)};
    UPDATE notebooks SET updated_at = datetime('now') WHERE id = (SELECT notebook_id FROM pages WHERE id = ${sql(input.pageId)});
  `);
  recordPageAuditEvent(input.userId, input.pageId, "attachment.created", `added attachment ${quoteAuditValue(input.originalName)}`, {
    attachmentId: id,
    originalName: input.originalName,
    mimeType: input.mimeType,
    size: input.size,
    blockType: input.blockType,
  });
  rebuildSearchIndex();
  return id;
}

export function getAttachmentForUser(userId: string, attachmentId: string): Attachment | null {
  ensureDatabase();
  const row = queryOne(`
    SELECT a.id, a.page_id, a.original_name, a.mime_type, a.size, a.storage_key, a.block_type, a.created_at
    FROM attachments a
    JOIN pages p ON p.id = a.page_id
    JOIN notebooks n ON n.id = p.notebook_id
    JOIN notebook_members nm ON nm.notebook_id = n.id AND nm.user_id = ${sql(userId)}
    WHERE a.id = ${sql(attachmentId)}
    LIMIT 1
  `);
  return row ? toAttachment(row) : null;
}

export function updateAttachmentFile(input: {
  userId: string;
  attachmentId: string;
  mimeType: string;
  size: number;
  storageKey: string;
}) {
  ensureDatabase();
  assertAttachmentEditAccess(input.userId, input.attachmentId);
  const attachment = getAttachmentForUser(input.userId, input.attachmentId);
  if (!attachment) throw new Error("Attachment not found");
  execSql(`
    UPDATE attachments
    SET mime_type = ${sql(input.mimeType)}, size = ${input.size}, storage_key = ${sql(input.storageKey)}
    WHERE id = ${sql(input.attachmentId)};
    UPDATE pages SET updated_at = datetime('now') WHERE id = ${sql(attachment.pageId)};
    UPDATE notebooks SET updated_at = datetime('now') WHERE id = (SELECT notebook_id FROM pages WHERE id = ${sql(attachment.pageId)});
  `);
  recordPageAuditEvent(input.userId, attachment.pageId, "attachment.updated", `updated attachment ${quoteAuditValue(attachment.originalName)}`, {
    attachmentId: input.attachmentId,
    originalName: attachment.originalName,
    oldSize: attachment.size,
    newSize: input.size,
    mimeType: input.mimeType,
  });
  rebuildSearchIndex();
  return getAttachmentForUser(input.userId, input.attachmentId);
}

export function createImportedNotebook(input: { userId: string; name: string }) {
  ensureDatabase();
  const notebookId = randomUUID();
  execSql(`
    INSERT INTO notebooks (id, name, owner_id, color)
    VALUES (${sql(notebookId)}, ${sql(input.name || "Evernote Import")}, ${sql(input.userId)}, ${sql(defaultNotebookColor(notebookId))});
    INSERT INTO notebook_members (notebook_id, user_id, role)
    VALUES (${sql(notebookId)}, ${sql(input.userId)}, 'owner');
  `);
  return notebookId;
}

export function createImportedPage(input: {
  userId: string;
  notebookId: string;
  pageId?: string;
  title: string;
  body: string;
  tags: string[];
  createdAt?: string;
  updatedAt?: string;
  replaceExisting?: boolean;
}) {
  ensureDatabase();
  assertNotebookEditAccess(input.userId, input.notebookId);
  const pageId = input.pageId ?? randomUUID();
  const createdAt = input.createdAt ?? new Date().toISOString();
  const updatedAt = input.updatedAt ?? createdAt;
  const title = input.title || "Untitled Evernote page";
  const normalizedTags = normalizePageTags(input.tags);

  if (input.replaceExisting) {
    execSql(`
      UPDATE pages
      SET title = ${sql(title)}, body = ${sql(input.body)}, created_at = ${sql(createdAt)}, updated_at = ${sql(updatedAt)}
      WHERE id = ${sql(pageId)};
      DELETE FROM page_tags WHERE page_id = ${sql(pageId)};
      ${normalizedTags.map((tag) => `INSERT INTO page_tags (page_id, tag) VALUES (${sql(pageId)}, ${sql(tag)});`).join("\n")}
    `);
    return pageId;
  }

  execSql(`
    INSERT INTO pages (id, notebook_id, title, body, status, owner_id, created_at, updated_at)
    VALUES (${sql(pageId)}, ${sql(input.notebookId)}, ${sql(title)}, ${sql(input.body)}, '', ${sql(input.userId)}, ${sql(createdAt)}, ${sql(updatedAt)});
    ${normalizedTags.map((tag) => `INSERT INTO page_tags (page_id, tag) VALUES (${sql(pageId)}, ${sql(tag)});`).join("\n")}
  `);
  return pageId;
}

export function createImportedAttachment(input: {
  pageId: string;
  originalName: string;
  mimeType: string;
  size: number;
  storageKey: string;
  blockType: BlockType;
  createdAt?: string;
}): Attachment {
  ensureDatabase();
  const id = randomUUID();
  const createdAt = input.createdAt ?? new Date().toISOString();
  execSql(`
    INSERT INTO attachments (id, page_id, original_name, mime_type, size, storage_key, block_type, created_at)
    VALUES (${sql(id)}, ${sql(input.pageId)}, ${sql(input.originalName)}, ${sql(input.mimeType)}, ${input.size}, ${sql(input.storageKey)}, ${sql(input.blockType)}, ${sql(createdAt)});
  `);
  return {
    id,
    pageId: input.pageId,
    originalName: input.originalName,
    mimeType: input.mimeType,
    size: input.size,
    storageKey: input.storageKey,
    blockType: input.blockType,
    createdAt,
    updatedAt: createdAt,
  };
}

export function finishImportedNotebook(notebookId: string) {
  ensureDatabase();
  execSql(`UPDATE notebooks SET updated_at = datetime('now') WHERE id = ${sql(notebookId)};`);
  rebuildSearchIndex();
}

export function removeImportedNotebook(notebookId: string) {
  ensureDatabase();
  execSql(`DELETE FROM notebooks WHERE id = ${sql(notebookId)};`);
  rebuildSearchIndex();
}

export function deleteAttachment(userId: string, attachmentId: string) {
  ensureDatabase();
  assertAttachmentEditAccess(userId, attachmentId);
  const attachment = getAttachmentForUser(userId, attachmentId);
  if (!attachment) throw new Error("Attachment not found");
  const page = queryOne(`SELECT body FROM pages WHERE id = ${sql(attachment.pageId)} LIMIT 1`);
  const nextBody = removeAttachmentCardsFromBody(page?.body ?? "", attachmentId);
  execSql(`
    DELETE FROM attachments WHERE id = ${sql(attachmentId)};
    UPDATE pages SET body = ${sql(nextBody)}, updated_at = datetime('now') WHERE id = ${sql(attachment.pageId)};
    UPDATE notebooks SET updated_at = datetime('now') WHERE id = (SELECT notebook_id FROM pages WHERE id = ${sql(attachment.pageId)});
  `);
  recordPageAuditEvent(userId, attachment.pageId, "attachment.deleted", `deleted attachment ${quoteAuditValue(attachment.originalName)}`, {
    attachmentId,
    originalName: attachment.originalName,
    size: attachment.size,
    blockType: attachment.blockType,
  });
  rebuildSearchIndex();
  return attachment;
}

export function shareNotebook(input: { actorUserId: string; notebookId: string; email: string; role: AccessRole }) {
  ensureDatabase();
  assertNotebookManageAccess(input.actorUserId, input.notebookId);
  const user = findUserByEmail(input.email.trim().toLowerCase());
  if (!user) throw new Error("User not found");
  if (user.id === input.actorUserId) throw new Error("Owners cannot change their own role.");
  const role = normalizeInputAccessRole(input.role);
  const currentRole = normalizeAccessRole(queryOne(`SELECT role FROM notebook_members WHERE notebook_id = ${sql(input.notebookId)} AND user_id = ${sql(user.id)} LIMIT 1`)?.role);
  const hadExistingRole = Boolean(queryOne(`SELECT 1 AS exists_flag FROM notebook_members WHERE notebook_id = ${sql(input.notebookId)} AND user_id = ${sql(user.id)} LIMIT 1`));
  if (hadExistingRole && currentRole === role) return user;
  if (currentRole === "owner" && role !== "owner" && countNotebookOwners(input.notebookId) <= 1) throw new Error("Notebooks need at least one owner.");
  execSql(`
    INSERT INTO notebook_members (notebook_id, user_id, role)
    VALUES (${sql(input.notebookId)}, ${sql(user.id)}, ${sql(role)})
    ON CONFLICT(notebook_id, user_id) DO UPDATE SET role = excluded.role;
  `);
  recordNotebookAuditEvent(
    input.actorUserId,
    input.notebookId,
    hadExistingRole ? "notebook.member.role.updated" : "notebook.member.added",
    hadExistingRole
      ? `changed ${displayName(user)} from ${currentRole} to ${role}`
      : `shared notebook with ${displayName(user)} as ${role}`,
    { targetUserId: user.id, targetEmail: user.email, oldRole: hadExistingRole ? currentRole : null, newRole: role },
  );
  return user;
}

export function unshareNotebook(actorUserId: string, notebookId: string, targetUserId: string) {
  ensureDatabase();
  assertNotebookManageAccess(actorUserId, notebookId);
  if (actorUserId === targetUserId) throw new Error("Owners cannot remove themselves.");
  const targetRole = queryOne(`SELECT role FROM notebook_members WHERE notebook_id = ${sql(notebookId)} AND user_id = ${sql(targetUserId)} LIMIT 1`)?.role;
  if (targetRole === "owner" && countNotebookOwners(notebookId) <= 1) throw new Error("Notebooks need at least one owner.");
  const targetUser = findUserById(targetUserId);
  execSql(`DELETE FROM notebook_members WHERE notebook_id = ${sql(notebookId)} AND user_id = ${sql(targetUserId)};`);
  recordNotebookAuditEvent(actorUserId, notebookId, "notebook.member.removed", `removed ${targetUser ? displayName(targetUser) : "a member"} from notebook`, {
    targetUserId,
    targetEmail: targetUser?.email ?? "",
    oldRole: targetRole ?? "",
  });
}

export function importNotebook(input: {
  userId: string;
  notebookName: string;
  pages: Array<{ title: string; body: string; tags: string[] }>;
}) {
  ensureDatabase();
  const notebookId = createImportedNotebook({ userId: input.userId, name: input.notebookName });
  for (const note of input.pages) {
    const pageId = randomUUID();
    execSql(`
      INSERT INTO pages (id, notebook_id, title, body, status, owner_id)
      VALUES (${sql(pageId)}, ${sql(notebookId)}, ${sql(note.title || "Untitled Evernote page")}, ${sql(note.body)}, '', ${sql(input.userId)});
      ${note.tags.map((tag) => `INSERT OR IGNORE INTO page_tags (page_id, tag) VALUES (${sql(pageId)}, ${sql(tag)});`).join("\n")}
    `);
  }
  finishImportedNotebook(notebookId);
  return notebookId;
}

function normalizePageStatus(value: unknown): PageStatus {
  if (value === "Final") return "Completed";
  if (value === "Draft" || value === null || value === undefined) return "";
  if (value === "Working" || value === "Needs review" || value === "Completed" || value === "Failed") return value;
  return "";
}

function normalizePageBody(body: string) {
  return editorDocumentToBody(bodyToEditorDocument(body));
}

function getNotebookRole(userId: string, notebookId: string): AccessRole | null {
  const row = queryOne(`SELECT role FROM notebook_members WHERE notebook_id = ${sql(notebookId)} AND user_id = ${sql(userId)} LIMIT 1`);
  return row ? normalizeAccessRole(row.role) : null;
}

export function assertNotebookReadAccess(userId: string, notebookId: string) {
  if (!getNotebookRole(userId, notebookId)) throw new Error("Forbidden");
}

export function assertNotebookEditAccess(userId: string, notebookId: string) {
  const role = getNotebookRole(userId, notebookId);
  if (!role || roleRank(role) < roleRank("editor")) throw new Error("Forbidden");
}

export function assertNotebookManageAccess(userId: string, notebookId: string) {
  const role = getNotebookRole(userId, notebookId);
  if (role !== "owner") throw new Error("Only owners can manage sharing.");
}

export function assertPageReadAccess(userId: string, pageId: string) {
  const row = queryOne(`
    SELECT nm.role AS role
    FROM pages p
    JOIN notebooks n ON n.id = p.notebook_id
    JOIN notebook_members nm ON nm.notebook_id = n.id AND nm.user_id = ${sql(userId)}
    WHERE p.id = ${sql(pageId)}
    LIMIT 1
  `);
  if (!row) throw new Error("Forbidden");
}

export function assertPageEditAccess(userId: string, pageId: string) {
  const row = queryOne(`
    SELECT CASE
      WHEN nm.role = 'owner' THEN 'owner'
      WHEN nm.role = 'editor' THEN 'editor'
      ELSE 'viewer'
    END AS role,
    COALESCE(p.locked_at, '') AS locked_at
    FROM pages p
    JOIN notebooks n ON n.id = p.notebook_id
    JOIN notebook_members nm ON nm.notebook_id = n.id AND nm.user_id = ${sql(userId)}
    WHERE p.id = ${sql(pageId)}
    LIMIT 1
  `);
  if (roleRank(normalizeAccessRole(row?.role)) < roleRank("editor")) throw new Error("Forbidden");
  if (row?.locked_at) throw new Error("Page is locked.");
}

export function assertPageManageAccess(userId: string, pageId: string) {
  const row = queryOne(`
    SELECT CASE
      WHEN nm.role = 'owner' THEN 'owner'
      WHEN nm.role = 'editor' THEN 'editor'
      ELSE 'viewer'
    END AS role
    FROM pages p
    JOIN notebooks n ON n.id = p.notebook_id
    JOIN notebook_members nm ON nm.notebook_id = n.id AND nm.user_id = ${sql(userId)}
    WHERE p.id = ${sql(pageId)}
    LIMIT 1
  `);
  if (normalizeAccessRole(row?.role) !== "owner") throw new Error("Only owners can lock pages.");
}

function countNotebookOwners(notebookId: string) {
  return Number(queryOne(`SELECT COUNT(*) AS count FROM notebook_members WHERE notebook_id = ${sql(notebookId)} AND role = 'owner'`)?.count ?? 0);
}

export function assertAttachmentReadAccess(userId: string, attachmentId: string) {
  const row = queryOne(`SELECT page_id FROM attachments WHERE id = ${sql(attachmentId)} LIMIT 1`);
  if (!row) throw new Error("Attachment not found");
  assertPageReadAccess(userId, row.page_id);
}

export function assertAttachmentEditAccess(userId: string, attachmentId: string) {
  const row = queryOne(`SELECT page_id FROM attachments WHERE id = ${sql(attachmentId)} LIMIT 1`);
  if (!row) throw new Error("Attachment not found");
  assertPageEditAccess(userId, row.page_id);
}

function assertAdmin(userId: string) {
  if (!isAdmin(userId)) throw new Error("Forbidden");
}

function isAdmin(userId: string) {
  const role = queryOne(`SELECT role FROM users WHERE id = ${sql(userId)} LIMIT 1`)?.role;
  return role === "admin";
}

function updateUserPassword(userId: string, nextPassword: string) {
  validatePassword(nextPassword);
  execSql(`UPDATE users SET password_hash = ${sql(bcrypt.hashSync(nextPassword, 10))} WHERE id = ${sql(userId)};`);
}

function inList(values: string[]) {
  return values.map(sql).join(", ");
}

function normalizeNotebookColor(value: string | undefined) {
  return /^#[0-9a-f]{6}$/i.test(value ?? "") ? value!.toLowerCase() : "#0891b2";
}

function normalizeAccessRole(value: string | undefined | null): AccessRole {
  return value === "owner" || value === "editor" ? value : "viewer";
}

function normalizeInputAccessRole(value: AccessRole): AccessRole {
  return value === "owner" || value === "viewer" ? value : "editor";
}

function roleRank(role: AccessRole) {
  return role === "owner" ? 3 : role === "editor" ? 2 : 1;
}

type AuditEventInput = {
  entityType: AuditEvent["entityType"];
  entityId: string;
  pageId?: string;
  notebookId?: string;
  actorUserId: string;
  action: string;
  summary: string;
  metadata?: Record<string, unknown>;
  coalesce?: boolean;
};

function recordPageAuditEvent(userId: string, pageId: string, action: string, summary: string, metadata: Record<string, unknown> = {}) {
  const page = queryOne(`SELECT notebook_id FROM pages WHERE id = ${sql(pageId)} LIMIT 1`);
  recordAuditEvent({
    entityType: action.startsWith("attachment.") ? "attachment" : "page",
    entityId: metadata.attachmentId && typeof metadata.attachmentId === "string" ? metadata.attachmentId : pageId,
    pageId,
    notebookId: page?.notebook_id ?? "",
    actorUserId: userId,
    action,
    summary,
    metadata,
  });
}

function recordNotebookAuditEvent(userId: string, notebookId: string, action: string, summary: string, metadata: Record<string, unknown> = {}) {
  recordAuditEvent({
    entityType: "notebook",
    entityId: notebookId,
    notebookId,
    actorUserId: userId,
    action,
    summary,
    metadata,
  });
}

function recordAuditEvent(input: AuditEventInput) {
  const metadataJson = JSON.stringify(input.metadata ?? {});
  if (input.coalesce && input.pageId) {
    const existing = queryOne(`
      SELECT id, metadata_json, event_count
      FROM audit_events
      WHERE page_id = ${sql(input.pageId)}
        AND actor_user_id = ${sql(input.actorUserId)}
        AND action = ${sql(input.action)}
        AND datetime(updated_at) >= datetime('now', '-${pageBodyEditAuditCoalesceSeconds} seconds')
      ORDER BY datetime(updated_at) DESC, rowid DESC
      LIMIT 1
    `);
    if (existing?.id) {
      const previousMetadata = parseAuditMetadata(existing.metadata_json);
      const eventCount = Number(existing.event_count || 1) + 1;
      const nextMetadata = {
        ...previousMetadata,
        ...input.metadata,
        coalescedEditCount: eventCount,
      };
      execSql(`
        UPDATE audit_events
        SET summary = ${sql(input.summary)},
            metadata_json = ${sql(JSON.stringify(nextMetadata))},
            event_count = ${eventCount},
            updated_at = datetime('now')
        WHERE id = ${sql(existing.id)};
      `);
      return;
    }
  }

  execSql(`
    INSERT INTO audit_events (
      id,
      entity_type,
      entity_id,
      page_id,
      notebook_id,
      actor_user_id,
      action,
      summary,
      metadata_json,
      event_count
    ) VALUES (
      ${sql(randomUUID())},
      ${sql(input.entityType)},
      ${sql(input.entityId)},
      ${sql(input.pageId ?? null)},
      ${sql(input.notebookId ?? null)},
      ${sql(input.actorUserId)},
      ${sql(input.action)},
      ${sql(input.summary)},
      ${sql(metadataJson)},
      1
    );
  `);
}

function parseAuditMetadata(value: string | undefined) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function toAuditEvent(row: Record<string, string>): AuditEvent {
  return {
    id: row.id,
    entityType: auditEntityType(row.entity_type),
    entityId: row.entity_id,
    pageId: row.page_id,
    notebookId: row.notebook_id,
    actorUserId: row.actor_user_id,
    actorFirstName: row.actor_first_name,
    actorLastName: row.actor_last_name,
    actorEmail: row.actor_email,
    action: row.action,
    summary: row.summary,
    metadata: parseAuditMetadata(row.metadata_json),
    eventCount: Number(row.event_count || 1),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function auditEntityType(value: string): AuditEvent["entityType"] {
  if (value === "notebook" || value === "attachment") return value;
  return "page";
}

function statusLabel(status: PageStatus | undefined) {
  return status || "No status";
}

function quoteAuditValue(value: string) {
  const normalized = value.trim() || "Untitled";
  return `"${normalized.length > 72 ? `${normalized.slice(0, 69)}...` : normalized}"`;
}

function hashAuditValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function tagAuditSummary(oldTags: string[], newTags: string[]) {
  const added = newTags.filter((tag) => !oldTags.includes(tag));
  const removed = oldTags.filter((tag) => !newTags.includes(tag));
  if (added.length && !removed.length) return `added ${added.length === 1 ? "tag" : "tags"} ${added.map(quoteAuditValue).join(", ")}`;
  if (removed.length && !added.length) return `removed ${removed.length === 1 ? "tag" : "tags"} ${removed.map(quoteAuditValue).join(", ")}`;
  return "updated tags";
}

function displayName(user: Pick<AppUser, "email" | "firstName" | "lastName">) {
  return [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
}

function toShareMember(row: Record<string, string>): ShareMember {
  return {
    userId: row.user_id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    role: normalizeAccessRole(row.role),
  };
}

function normalizeUserNamePart(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function splitDisplayName(value: string) {
  const normalized = normalizeUserNamePart(value);
  if (!normalized) return { firstName: "", lastName: "" };
  const [firstName, ...rest] = normalized.split(" ");
  return { firstName, lastName: rest.join(" ") };
}

function defaultNotebookColor(seed: string) {
  const colors = ["#0891b2", "#2563eb", "#7c3aed", "#16a34a", "#ca8a04", "#dc2626", "#0f766e", "#9333ea"];
  const score = Array.from(seed).reduce((total, char) => total + char.charCodeAt(0), 0);
  return colors[score % colors.length];
}

function groupBy<T extends Record<string, unknown>>(rows: T[], key: string) {
  return rows.reduce<Record<string, T[]>>((groups, row) => {
    const value = row[key];
    if (typeof value !== "string") return groups;
    groups[value] = groups[value] ?? [];
    groups[value].push(row);
    return groups;
  }, {});
}

function pageTagRowsToList(rows: Record<string, string>[]) {
  return normalizePageTags(rows.map((row) => row.tag));
}

function tagListsEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((tag, index) => tag === right[index]);
}

function normalizePageTags(tags: string[]) {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const tag of tags) {
    const value = tag.trim().replace(/\s+/g, " ");
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
  }
  return normalized;
}

function countRows(tableName: string) {
  const row = queryOne(`SELECT COUNT(*) AS count FROM ${tableName}`);
  return Number(row?.count ?? 0);
}

function clampInteger(value: number | undefined, min: number, max: number, fallback: number) {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function listUploadFiles() {
  const files: Array<{ relativePath: string; size: number }> = [];
  if (!fs.existsSync(uploadDir)) return files;

  function visit(directory: string) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = path.relative(uploadDir, absolutePath).split(path.sep).join("/");
      files.push({ relativePath, size: fs.statSync(absolutePath).size });
    }
  }

  visit(uploadDir);
  return files;
}

function toAttachment(row: Record<string, string>): Attachment {
  return {
    id: row.id,
    pageId: row.page_id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    size: Number(row.size),
    storageKey: row.storage_key,
    blockType: row.block_type as BlockType,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}
