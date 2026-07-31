import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import type { AccessRole, AdminActivityOverview, AdminAppSettings, AdminDataOverview, AdminTag, AdminUser, AppUser, Attachment, AuditEvent, BlockType, Notebook, PageComment, PageCommentThread, PageEntry, PageStatus, Project, ShareMember, UserRole, Workspace } from "./types";
import { bodyToEditorDocument, bodyToEditorText, commentThreadIdsFromBody, editorDocumentToBody, remapAttachmentCardsInBody, removeAttachmentCardsFromBody, removeCommentMarksFromBody, removeUnknownCommentMarksFromBody } from "./editor";
import { uploadDir } from "./paths";
import { deleteSearchIndexForNotebook, deleteSearchIndexForPage, queueSearchIndexForNotebook, queueSearchIndexForPage, rebuildSearchIndex, scheduleSearchIndexDrain } from "./search";
import { execSql, queryOne, querySql, sql } from "./sqlite";

let initialized = false;

const passwordRequirementMessage = "Password must be at least 12 characters and include uppercase, lowercase, number, and symbol characters.";
const loginRateLimitWindowMs = 15 * 60 * 1000;
const loginRateLimitMaxFailures = 10;
const loginAttemptRetentionMs = 24 * 60 * 60 * 1000;
export const auditEventCoalesceSeconds = 5 * 60;
export const pageBodyEditAuditCoalesceSeconds = auditEventCoalesceSeconds;

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

function databaseBoolean(value: unknown) {
  return value === true || value === 1 || value === "1";
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
      last_login_at TEXT,
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
      page_title_template TEXT NOT NULL DEFAULT '',
      page_title_template_enabled INTEGER NOT NULL DEFAULT 0,
      content_revision INTEGER NOT NULL DEFAULT 1,
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
      preview_text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      owner_id TEXT NOT NULL REFERENCES users(id),
      locked_at TEXT,
      locked_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY DEFAULT (${tagIdSql()}),
      label TEXT NOT NULL COLLATE NOCASE UNIQUE
    );

    CREATE TABLE IF NOT EXISTS page_tags (
      page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (page_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS page_comment_threads (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      created_by TEXT REFERENCES users(id),
      selected_text TEXT NOT NULL DEFAULT '',
      resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS page_comment_threads_page_idx ON page_comment_threads(page_id, updated_at);

    CREATE TABLE IF NOT EXISTS page_comments (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES page_comment_threads(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id),
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS page_comments_thread_idx ON page_comments(thread_id, created_at);

    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      storage_key TEXT NOT NULL,
      block_type TEXT NOT NULL DEFAULT 'file',
      evernote_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS attachment_annotations (
      attachment_id TEXT PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
      page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      data_json TEXT NOT NULL DEFAULT '{"items":[]}',
      updated_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS attachment_annotations_page_idx ON attachment_annotations(page_id, updated_at);

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
    CREATE INDEX IF NOT EXISTS audit_events_updated_idx ON audit_events(updated_at);

    CREATE TABLE IF NOT EXISTS search_index_queue (
      page_id TEXT PRIMARY KEY,
      queued_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT OR IGNORE INTO app_settings (key, value)
    VALUES ('prepend_date_to_new_pages', '1');

    INSERT OR IGNORE INTO app_settings (key, value)
    VALUES ('suggest_tags_globally', '1');

    DROP TABLE IF EXISTS import_jobs;
    DROP TABLE IF EXISTS page_versions;
  `);
  migrateUserNameColumns();
  ensureUserLastLoginColumn();
  migrateProjectsToTopLevelNotebooks();
  ensureNotebookColumns();
  ensurePageLockColumns();
  ensurePagePreviewColumn();
  migrateAttachmentPreviewTextColumn();
  ensureAttachmentEvernoteHashColumn();
  ensureSearchPagesFtsSchema();
  execSql(`
    CREATE VIRTUAL TABLE IF NOT EXISTS search_pages_fts USING fts5(
      page_id UNINDEXED,
      notebook_id UNINDEXED,
      title,
      body,
      tags,
      attachments,
      updated_at UNINDEXED,
      tokenize='unicode61'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS search_pages_vocab USING fts5vocab(search_pages_fts, 'row');
  `);
  migratePageStatusValues();
  migrateGroupedTagsToPageTags();
  ensureGlobalTagSchema();
  ensureNotebookContentRevisionTriggers();
  const searchIndexCount = Number(queryOne("SELECT COUNT(*) AS count FROM search_pages_fts")?.count ?? 0);
  if (searchIndexCount === 0 && countRows("pages") > 0) rebuildSearchIndex();
  initialized = true;
  scheduleSearchIndexDrain();
}

function ensureSearchPagesFtsSchema() {
  const existing = queryOne("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'search_pages_fts' LIMIT 1");
  const createSql = String(existing?.sql ?? "");
  if (!createSql || !/\bnotebook\b/i.test(createSql)) return;
  execSql(`
    DROP TABLE IF EXISTS search_pages_vocab;
    DROP TABLE IF EXISTS search_pages_fts;
  `);
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

function ensureUserLastLoginColumn() {
  const columns = querySql("PRAGMA table_info(users);");
  const columnNames = new Set(columns.map((column) => column.name));
  if (!columnNames.has("last_login_at")) {
    execSql("ALTER TABLE users ADD COLUMN last_login_at TEXT;");
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
  if (!names.has("page_title_template")) execSql("ALTER TABLE notebooks ADD COLUMN page_title_template TEXT NOT NULL DEFAULT '';");
  if (!names.has("page_title_template_enabled")) execSql("ALTER TABLE notebooks ADD COLUMN page_title_template_enabled INTEGER NOT NULL DEFAULT 0;");
  if (!names.has("content_revision")) execSql("ALTER TABLE notebooks ADD COLUMN content_revision INTEGER NOT NULL DEFAULT 1;");
}

function ensureNotebookContentRevisionTriggers() {
  execSql(`
    -- Recreate these application-owned triggers so a deployed schema upgrade
    -- cannot silently retain an older trigger body.
    DROP TRIGGER IF EXISTS novo_content_revision_notebook_name;
    DROP TRIGGER IF EXISTS novo_content_revision_page_insert;
    DROP TRIGGER IF EXISTS novo_content_revision_page_delete;
    DROP TRIGGER IF EXISTS novo_content_revision_page_update;
    DROP TRIGGER IF EXISTS novo_content_revision_page_tag_insert;
    DROP TRIGGER IF EXISTS novo_content_revision_page_tag_delete;
    DROP TRIGGER IF EXISTS novo_content_revision_page_tag_update;
    DROP TRIGGER IF EXISTS novo_content_revision_tag_label;
    DROP TRIGGER IF EXISTS novo_content_revision_attachment_insert;
    DROP TRIGGER IF EXISTS novo_content_revision_attachment_delete;
    DROP TRIGGER IF EXISTS novo_content_revision_attachment_update;

    CREATE TRIGGER novo_content_revision_notebook_name
    AFTER UPDATE OF name ON notebooks
    WHEN OLD.name IS NOT NEW.name
    BEGIN
      UPDATE notebooks
      SET content_revision = content_revision + 1
      WHERE id = NEW.id;
    END;

    CREATE TRIGGER novo_content_revision_page_insert
    AFTER INSERT ON pages
    BEGIN
      UPDATE notebooks
      SET content_revision = content_revision + 1
      WHERE id = NEW.notebook_id;
    END;

    CREATE TRIGGER novo_content_revision_page_delete
    AFTER DELETE ON pages
    BEGIN
      UPDATE notebooks
      SET content_revision = content_revision + 1
      WHERE id = OLD.notebook_id;
    END;

    CREATE TRIGGER novo_content_revision_page_update
    AFTER UPDATE OF notebook_id, title, body, status, created_at ON pages
    WHEN OLD.notebook_id IS NOT NEW.notebook_id
      OR OLD.title IS NOT NEW.title
      OR OLD.body IS NOT NEW.body
      OR OLD.status IS NOT NEW.status
      OR OLD.created_at IS NOT NEW.created_at
    BEGIN
      UPDATE notebooks
      SET content_revision = content_revision + 1
      WHERE id IN (OLD.notebook_id, NEW.notebook_id);
    END;

    CREATE TRIGGER novo_content_revision_page_tag_insert
    AFTER INSERT ON page_tags
    BEGIN
      UPDATE notebooks
      SET content_revision = content_revision + 1
      WHERE id = (SELECT notebook_id FROM pages WHERE id = NEW.page_id);
    END;

    CREATE TRIGGER novo_content_revision_page_tag_delete
    AFTER DELETE ON page_tags
    BEGIN
      UPDATE notebooks
      SET content_revision = content_revision + 1
      WHERE id = (SELECT notebook_id FROM pages WHERE id = OLD.page_id);
    END;

    CREATE TRIGGER novo_content_revision_page_tag_update
    AFTER UPDATE OF page_id, tag_id ON page_tags
    WHEN OLD.page_id IS NOT NEW.page_id OR OLD.tag_id IS NOT NEW.tag_id
    BEGIN
      UPDATE notebooks
      SET content_revision = content_revision + 1
      WHERE id IN (
        SELECT notebook_id FROM pages WHERE id IN (OLD.page_id, NEW.page_id)
      );
    END;

    CREATE TRIGGER novo_content_revision_tag_label
    AFTER UPDATE OF label ON tags
    WHEN OLD.label IS NOT NEW.label
    BEGIN
      UPDATE notebooks
      SET content_revision = content_revision + 1
      WHERE id IN (
        SELECT DISTINCT p.notebook_id
        FROM page_tags pt
        JOIN pages p ON p.id = pt.page_id
        WHERE pt.tag_id = NEW.id
      );
    END;

    CREATE TRIGGER novo_content_revision_attachment_insert
    AFTER INSERT ON attachments
    BEGIN
      UPDATE notebooks
      SET content_revision = content_revision + 1
      WHERE id = (
        SELECT notebook_id FROM pages WHERE id = NEW.page_id
      );
    END;

    CREATE TRIGGER novo_content_revision_attachment_delete
    AFTER DELETE ON attachments
    BEGIN
      UPDATE notebooks
      SET content_revision = content_revision + 1
      WHERE id = (
        SELECT notebook_id FROM pages WHERE id = OLD.page_id
      );
    END;

    CREATE TRIGGER novo_content_revision_attachment_update
    AFTER UPDATE OF page_id, original_name, mime_type, size, storage_key, block_type ON attachments
    WHEN OLD.page_id IS NOT NEW.page_id
      OR OLD.original_name IS NOT NEW.original_name
      OR OLD.mime_type IS NOT NEW.mime_type
      OR OLD.size IS NOT NEW.size
      OR OLD.storage_key IS NOT NEW.storage_key
      OR OLD.block_type IS NOT NEW.block_type
    BEGIN
      UPDATE notebooks
      SET content_revision = content_revision + 1
      WHERE id IN (
        SELECT notebook_id FROM pages WHERE id IN (OLD.page_id, NEW.page_id)
      );
    END;
  `);
}

function ensurePageLockColumns() {
  const columns = querySql("PRAGMA table_info(pages);");
  const names = new Set(columns.map((column) => column.name));
  if (!names.has("locked_at")) execSql("ALTER TABLE pages ADD COLUMN locked_at TEXT;");
  if (!names.has("locked_by")) execSql("ALTER TABLE pages ADD COLUMN locked_by TEXT REFERENCES users(id);");
}

function ensurePagePreviewColumn() {
  const columns = querySql("PRAGMA table_info(pages);");
  const names = new Set(columns.map((column) => column.name));
  if (!names.has("preview_text")) execSql("ALTER TABLE pages ADD COLUMN preview_text TEXT NOT NULL DEFAULT '';");
  const rows = querySql("SELECT id, body FROM pages WHERE preview_text = '' AND body <> ''");
  if (!rows.length) return;
  execSql(rows.map((row) => `UPDATE pages SET preview_text = ${sql(bodyToEditorText(row.body).slice(0, 500))} WHERE id = ${sql(row.id)};`).join("\n"));
}

function migrateAttachmentPreviewTextColumn() {
  const columns = querySql("PRAGMA table_info(attachments);");
  const names = new Set(columns.map((column) => column.name));
  if (!names.has("preview_text")) return;
  const hasEvernoteHash = names.has("evernote_hash");

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
      evernote_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT INTO attachments_new (id, page_id, original_name, mime_type, size, storage_key, block_type, evernote_hash, created_at)
    SELECT id, page_id, original_name, mime_type, size, storage_key, block_type, ${hasEvernoteHash ? "evernote_hash" : "NULL"}, created_at
    FROM attachments;

    DROP TABLE attachments;
    ALTER TABLE attachments_new RENAME TO attachments;

    PRAGMA foreign_keys=ON;
  `);
}

function ensureAttachmentEvernoteHashColumn() {
  const columns = querySql("PRAGMA table_info(attachments);");
  const names = new Set(columns.map((column) => column.name));
  if (!names.has("evernote_hash")) execSql("ALTER TABLE attachments ADD COLUMN evernote_hash TEXT;");
  execSql("CREATE INDEX IF NOT EXISTS attachments_evernote_hash_idx ON attachments(evernote_hash);");
}

function migratePageStatusValues() {
  execSql(`
    UPDATE pages SET status = '' WHERE status = 'Draft';
    UPDATE pages SET status = 'Completed' WHERE status = 'Final';
  `);
}

function tagIdSql() {
  return "lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))";
}

function ensureGlobalTagSchema() {
  execSql(`
    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY DEFAULT (${tagIdSql()}),
      label TEXT NOT NULL COLLATE NOCASE UNIQUE
    );
  `);

  const columns = querySql("PRAGMA table_info(page_tags);");
  const columnNames = new Set(columns.map((column) => column.name));
  if (columnNames.has("tag_id") && !columnNames.has("tag")) {
    execSql(`
      CREATE INDEX IF NOT EXISTS page_tags_page_idx ON page_tags(page_id);
      CREATE INDEX IF NOT EXISTS page_tags_tag_idx ON page_tags(tag_id);
    `);
    return;
  }

  execSql(`
    PRAGMA foreign_keys=OFF;
    BEGIN;

    DROP TABLE IF EXISTS page_tags_new;

    CREATE TABLE page_tags_new (
      page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (page_id, tag_id)
    );

    INSERT OR IGNORE INTO tags (id, label)
    SELECT ${tagIdSql()}, trim(tag)
    FROM page_tags
    WHERE trim(tag) <> ''
    ORDER BY rowid ASC;

    INSERT OR IGNORE INTO page_tags_new (page_id, tag_id)
    SELECT pt.page_id, t.id
    FROM page_tags pt
    JOIN tags t ON t.label = trim(pt.tag) COLLATE NOCASE
    WHERE trim(pt.tag) <> ''
    ORDER BY pt.rowid ASC;

    DROP TABLE page_tags;
    ALTER TABLE page_tags_new RENAME TO page_tags;
    CREATE INDEX IF NOT EXISTS page_tags_page_idx ON page_tags(page_id);
    CREATE INDEX IF NOT EXISTS page_tags_tag_idx ON page_tags(tag_id);

    COMMIT;
    PRAGMA foreign_keys=ON;
  `);
}

function migrateGroupedTagsToPageTags() {
  const tables = querySql("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('tag_groups', 'tag_values', 'page_tag_values');");
  const tableNames = new Set(tables.map((table) => table.name));
  if (!tableNames.has("tag_groups") || !tableNames.has("tag_values") || !tableNames.has("page_tag_values")) return;

  execSql(`
    BEGIN;

    INSERT OR IGNORE INTO tags (id, label)
    SELECT ${tagIdSql()}, trim(tv.label)
    FROM tag_values tv
    WHERE tv.archived_at IS NULL
      AND trim(tv.label) <> '';

    INSERT OR IGNORE INTO page_tags (page_id, tag_id)
    SELECT ptv.page_id, t.id
    FROM page_tag_values ptv
    JOIN tag_values tv ON tv.id = ptv.tag_value_id
    JOIN tags t ON t.label = trim(tv.label) COLLATE NOCASE
    WHERE tv.archived_at IS NULL
      AND trim(tv.label) <> '';

    DROP TABLE page_tag_values;
    DROP TABLE tag_values;
    DROP TABLE tag_groups;

    COMMIT;
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
  queueSearchIndexForPage(pageId);
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
      COALESCE(u.last_login_at, '') AS last_login_at,
      u.created_at,
      COUNT(DISTINCT nm.notebook_id) AS notebook_count,
      COALESCE(MAX(ae.updated_at), '') AS last_activity_at
    FROM users u
    LEFT JOIN notebook_members nm ON nm.user_id = u.id AND nm.role = 'owner'
    LEFT JOIN audit_events ae ON ae.actor_user_id = u.id
    GROUP BY u.id
    ORDER BY lower(u.first_name) ASC, lower(u.last_name) ASC, lower(u.email) ASC
  `).map((row) => ({
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    role: row.role as UserRole,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    lastActivityAt: row.last_activity_at,
    notebookCount: Number(row.notebook_count),
  }));
}

export function listTagsForAdmin(adminUserId: string): AdminTag[] {
  ensureDatabase();
  assertAdmin(adminUserId);
  pruneUnusedTags();
  return querySql(`
    SELECT
      t.id,
      t.label,
      COUNT(DISTINCT pt.page_id) AS page_count,
      COUNT(DISTINCT p.notebook_id) AS notebook_count,
      COALESCE(MAX(p.updated_at), '') AS updated_at
    FROM tags t
    LEFT JOIN page_tags pt ON pt.tag_id = t.id
    LEFT JOIN pages p ON p.id = pt.page_id
    GROUP BY t.id, t.label
    ORDER BY lower(t.label) ASC
  `).map((row) => ({
    id: row.id,
    label: row.label,
    pageCount: Number(row.page_count),
    notebookCount: Number(row.notebook_count),
    updatedAt: row.updated_at,
  }));
}

export function renameTagForAdmin(adminUserId: string, tagId: string, label: string): AdminTag[] {
  ensureDatabase();
  assertAdmin(adminUserId);
  const normalizedLabel = normalizeGlobalTagLabel(label);
  const tag = queryOne(`SELECT id, label FROM tags WHERE id = ${sql(tagId)} LIMIT 1`);
  if (!tag) throw new Error("Tag not found.");
  if (tag.label === normalizedLabel) return listTagsForAdmin(adminUserId);
  const duplicate = queryOne(`
    SELECT id
    FROM tags
    WHERE label = ${sql(normalizedLabel)} COLLATE NOCASE
      AND id <> ${sql(tagId)}
    LIMIT 1
  `);
  if (duplicate) throw new Error("A tag with that name already exists. Merge the tag instead.");

  const pageRows = tagPageRows(tagId);
  execSql(`UPDATE tags SET label = ${sql(normalizedLabel)} WHERE id = ${sql(tagId)};`);
  recordTagAuditEvent(adminUserId, tagId, "tag.renamed", `renamed tag ${quoteAuditValue(tag.label)} to ${quoteAuditValue(normalizedLabel)}`, {
    oldLabel: tag.label,
    newLabel: normalizedLabel,
    affectedPages: pageRows.length,
  });
  queueSearchIndexForTagPageRows(pageRows);
  return listTagsForAdmin(adminUserId);
}

export function mergeTagForAdmin(adminUserId: string, sourceTagId: string, targetTagId: string): AdminTag[] {
  ensureDatabase();
  assertAdmin(adminUserId);
  if (sourceTagId === targetTagId) throw new Error("Choose two different tags to merge.");
  const source = queryOne(`SELECT id, label FROM tags WHERE id = ${sql(sourceTagId)} LIMIT 1`);
  const target = queryOne(`SELECT id, label FROM tags WHERE id = ${sql(targetTagId)} LIMIT 1`);
  if (!source || !target) throw new Error("Tag not found.");

  const pageRows = tagPageRows(sourceTagId);
  execSql(`
    BEGIN;
    INSERT OR IGNORE INTO page_tags (page_id, tag_id)
    SELECT page_id, ${sql(targetTagId)}
    FROM page_tags
    WHERE tag_id = ${sql(sourceTagId)};
    DELETE FROM page_tags WHERE tag_id = ${sql(sourceTagId)};
    DELETE FROM tags WHERE id = ${sql(sourceTagId)};
    COMMIT;
  `);
  recordTagAuditEvent(adminUserId, sourceTagId, "tag.merged", `merged tag ${quoteAuditValue(source.label)} into ${quoteAuditValue(target.label)}`, {
    sourceTagId,
    sourceLabel: source.label,
    targetTagId,
    targetLabel: target.label,
    affectedPages: pageRows.length,
  });
  queueSearchIndexForTagPageRows(pageRows);
  return listTagsForAdmin(adminUserId);
}

export function deleteTagForAdmin(adminUserId: string, tagId: string): AdminTag[] {
  ensureDatabase();
  assertAdmin(adminUserId);
  const tag = queryOne(`SELECT id, label FROM tags WHERE id = ${sql(tagId)} LIMIT 1`);
  if (!tag) throw new Error("Tag not found.");

  const pageRows = tagPageRows(tagId);
  execSql(`
    BEGIN;
    DELETE FROM page_tags WHERE tag_id = ${sql(tagId)};
    DELETE FROM tags WHERE id = ${sql(tagId)};
    COMMIT;
  `);
  recordTagAuditEvent(adminUserId, tagId, "tag.deleted", `deleted tag ${quoteAuditValue(tag.label)}`, {
    label: tag.label,
    affectedPages: pageRows.length,
  });
  queueSearchIndexForTagPageRows(pageRows);
  return listTagsForAdmin(adminUserId);
}

export function recordUserLogin(userId: string) {
  ensureDatabase();
  execSql(`UPDATE users SET last_login_at = datetime('now') WHERE id = ${sql(userId)};`);
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
      n.name AS notebook_name
    FROM attachments a
    JOIN pages p ON p.id = a.page_id
    JOIN notebooks n ON n.id = p.notebook_id
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

export function getAdminAppSettings(adminUserId: string): AdminAppSettings {
  ensureDatabase();
  assertAdmin(adminUserId);
  return readAppSettings();
}

export function updateAdminAppSettings(adminUserId: string, patch: Partial<AdminAppSettings>) {
  ensureDatabase();
  assertAdmin(adminUserId);
  if (patch.prependDateToNewPages !== undefined) {
    writeAppSetting("prepend_date_to_new_pages", patch.prependDateToNewPages ? "1" : "0");
  }
  if (patch.suggestTagsGlobally !== undefined) {
    writeAppSetting("suggest_tags_globally", patch.suggestTagsGlobally ? "1" : "0");
  }
  return readAppSettings();
}

export function changeOwnPassword(userId: string, currentPassword: string, nextPassword: string) {
  ensureDatabase();
  const user = queryOne(`SELECT password_hash FROM users WHERE id = ${sql(userId)} LIMIT 1`);
  if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) throw new Error("Current password is incorrect.");
  updateUserPassword(userId, nextPassword);
}

export function updateOwnProfile(userId: string, input: { firstName: string; lastName?: string }): AppUser {
  ensureDatabase();
  const firstName = normalizeUserNamePart(input.firstName);
  const lastName = normalizeUserNamePart(input.lastName ?? "");
  if (!firstName) throw new Error("First name is required.");
  execSql(`UPDATE users SET first_name = ${sql(firstName)}, last_name = ${sql(lastName)} WHERE id = ${sql(userId)};`);
  const user = findUserById(userId);
  if (!user) throw new Error("User not found.");
  return user;
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

  const userIsAdmin = user.role === "admin";
  const notebookRows = querySql(`
    SELECT
      n.id,
      n.name,
      n.owner_id,
      n.color,
      COALESCE(n.page_title_template, '') AS page_title_template,
      COALESCE(n.page_title_template_enabled, 0) AS page_title_template_enabled,
      n.created_at,
      n.updated_at,
      CASE
        ${userIsAdmin ? "WHEN 1 THEN 'owner'" : ""}
        WHEN nm.role = 'owner' THEN 'owner'
        WHEN nm.role = 'editor' THEN 'editor'
        ELSE 'viewer'
      END AS access_role
    FROM notebooks n
    LEFT JOIN notebook_members nm ON nm.notebook_id = n.id AND nm.user_id = ${sql(userId)}
    ${userIsAdmin ? "" : "WHERE nm.user_id IS NOT NULL"}
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
          p.preview_text AS body_preview,
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
  const tagRows = pageIds.length
    ? querySql(`
        SELECT pt.page_id, t.label AS tag
        FROM page_tags pt
        JOIN tags t ON t.id = pt.tag_id
        WHERE pt.page_id IN (${inList(pageIds)})
        ORDER BY pt.rowid ASC
      `)
    : [];
  const attachmentStatRows = pageIds.length
    ? querySql(`SELECT page_id, COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes FROM attachments WHERE page_id IN (${inList(pageIds)}) GROUP BY page_id`)
    : [];
  const notebookMemberRows = notebookIds.length
    ? querySql(`
        SELECT nm.notebook_id, nm.user_id, nm.role, u.email, u.first_name, u.last_name, u.role AS user_role
        FROM notebook_members nm
        JOIN users u ON u.id = nm.user_id
        WHERE nm.notebook_id IN (${inList(notebookIds)})
        ORDER BY lower(u.first_name) ASC, lower(u.last_name) ASC, lower(u.email) ASC
      `)
    : [];
  const memberRows = querySql(`SELECT id, email, first_name, last_name, role FROM users ORDER BY lower(first_name) ASC, lower(last_name) ASC, lower(email) ASC`);
  const adminMembers = memberRows.filter((row) => row.role === "admin");

  const tagsByPage = groupBy(tagRows, "page_id");
  const attachmentStatsByPage = Object.fromEntries(attachmentStatRows.map((row) => [row.page_id, row]));
  const pagesByNotebook = groupBy(pageRows, "notebook_id");
  const membersByNotebook = groupBy(notebookMemberRows, "notebook_id");

  const notebooks: Notebook[] = notebookRows.map((notebook) => {
    const pageTitleTemplate = String(notebook.page_title_template ?? "");
    return {
      id: notebook.id,
      name: notebook.name,
      color: normalizeNotebookColor(notebook.color),
      pageTitleTemplate,
      pageTitleTemplateEnabled: databaseBoolean(notebook.page_title_template_enabled) && pageTitleTemplate.trim().length > 0,
      ownerId: notebook.owner_id,
      createdAt: notebook.created_at,
      updatedAt: notebook.updated_at,
      accessRole: normalizeAccessRole(notebook.access_role),
      members: withImplicitAdminMembers((membersByNotebook[notebook.id] ?? []).map(toShareMember), adminMembers),
      pages: (pagesByNotebook[notebook.id] ?? []).map((page): PageEntry => ({
      id: page.id,
      notebookId: page.notebook_id,
      title: page.title,
      body: "",
      bodyPreview: page.body_preview,
      bodyLoaded: false,
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
      tags: tagLabelRowsToList(tagsByPage[page.id] ?? []),
      attachments: [],
      attachmentCount: Number(attachmentStatsByPage[page.id]?.count ?? 0),
      attachmentBytes: Number(attachmentStatsByPage[page.id]?.bytes ?? 0),
      })),
    };
  });

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
    appSettings: readAppSettings(),
    members: memberRows.map((row) => ({ id: row.id, email: row.email, firstName: row.first_name, lastName: row.last_name, role: row.role as UserRole })),
    notebooks,
    projects: [workspaceProject],
  };
}

export function getPage(userId: string, pageId: string): PageEntry {
  ensureDatabase();
  assertPageReadAccess(userId, pageId);
  const page = queryOne(`
    SELECT
      p.id,
      p.notebook_id,
      p.title,
      p.body,
      p.preview_text,
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
    WHERE p.id = ${sql(pageId)}
    LIMIT 1
  `);
  if (!page) throw new Error("Page not found");
  const tagRows = querySql(`
    SELECT pt.page_id, t.label AS tag
    FROM page_tags pt
    JOIN tags t ON t.id = pt.tag_id
    WHERE pt.page_id = ${sql(pageId)}
    ORDER BY pt.rowid ASC
  `);
  const attachmentRows = querySql(`
    SELECT
      a.id,
      a.page_id,
      a.original_name,
      a.mime_type,
      a.size,
      a.storage_key,
      a.block_type,
      COALESCE(a.evernote_hash, '') AS evernote_hash,
      a.created_at,
      aa.data_json AS annotation_data_json,
      COALESCE(aa.updated_at, '') AS annotation_updated_at,
      COALESCE(aa.updated_by, '') AS annotation_updated_by
    FROM attachments a
    LEFT JOIN attachment_annotations aa ON aa.attachment_id = a.id
    WHERE a.page_id = ${sql(pageId)}
    ORDER BY a.created_at DESC
  `);
  const attachmentBytes = attachmentRows.reduce((total, attachment) => total + Number(attachment.size ?? 0), 0);
  return {
    id: page.id,
    notebookId: page.notebook_id,
    title: page.title,
    body: page.body,
    bodyPreview: page.preview_text || bodyToEditorText(page.body),
    bodyLoaded: true,
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
    tags: tagLabelRowsToList(tagRows),
    attachments: attachmentRows.map(toAttachment),
    attachmentCount: attachmentRows.length,
    attachmentBytes,
  };
}

export function getPageNotebook(userId: string, pageId: string): Pick<Notebook, "id" | "name" | "color"> {
  ensureDatabase();
  assertPageReadAccess(userId, pageId);
  const row = queryOne(`
    SELECT n.id, n.name, n.color
    FROM pages p
    JOIN notebooks n ON n.id = p.notebook_id
    WHERE p.id = ${sql(pageId)}
    LIMIT 1
  `);
  if (!row) throw new Error("Page not found");
  return { id: row.id, name: row.name, color: row.color };
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
    ORDER BY ae.updated_at DESC, ae.created_at DESC, ae.rowid DESC
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

export function getPageCommentThreads(userId: string, pageId: string): PageCommentThread[] {
  ensureDatabase();
  assertPageReadAccess(userId, pageId);
  const threadRows = querySql(`
    SELECT
      pct.id,
      pct.page_id,
      COALESCE(pct.created_by, '') AS created_by,
      COALESCE(u.first_name, '') AS created_by_first_name,
      COALESCE(u.last_name, '') AS created_by_last_name,
      COALESCE(u.email, '') AS created_by_email,
      pct.selected_text,
      COALESCE(pct.resolved_at, '') AS resolved_at,
      pct.created_at,
      pct.updated_at
    FROM page_comment_threads pct
    LEFT JOIN users u ON u.id = pct.created_by
    WHERE pct.page_id = ${sql(pageId)}
    ORDER BY COALESCE(pct.resolved_at, '') ASC, pct.updated_at DESC, pct.created_at DESC, pct.rowid DESC
  `);
  if (!threadRows.length) return [];
  const threadIds = threadRows.map((row) => row.id);
  const commentRows = querySql(`
    SELECT
      pc.id,
      pc.thread_id,
      COALESCE(pc.user_id, '') AS user_id,
      COALESCE(u.first_name, '') AS user_first_name,
      COALESCE(u.last_name, '') AS user_last_name,
      COALESCE(u.email, '') AS user_email,
      pc.body,
      pc.created_at,
      pc.updated_at
    FROM page_comments pc
    LEFT JOIN users u ON u.id = pc.user_id
    WHERE pc.thread_id IN (${inList(threadIds)})
    ORDER BY pc.created_at ASC, pc.rowid ASC
  `);
  const commentsByThread = new Map<string, PageComment[]>();
  for (const comment of commentRows.map(toPageComment)) {
    commentsByThread.set(comment.threadId, [...(commentsByThread.get(comment.threadId) ?? []), comment]);
  }
  return threadRows.map((row) => toPageCommentThread(row, commentsByThread.get(row.id) ?? []));
}

export function createPageCommentThread(userId: string, pageId: string, input: { selectedText: string; body: string }): PageCommentThread {
  ensureDatabase();
  assertPageEditAccess(userId, pageId);
  const body = normalizeCommentBody(input.body);
  const selectedText = normalizeSelectedCommentText(input.selectedText);
  const threadId = randomUUID();
  const commentId = randomUUID();
  execSql(`
    INSERT INTO page_comment_threads (id, page_id, created_by, selected_text)
    VALUES (${sql(threadId)}, ${sql(pageId)}, ${sql(userId)}, ${sql(selectedText)});

    INSERT INTO page_comments (id, thread_id, user_id, body)
    VALUES (${sql(commentId)}, ${sql(threadId)}, ${sql(userId)}, ${sql(body)});
  `);
  recordPageAuditEvent(userId, pageId, "page.comment.created", "added comment", { threadId });
  const thread = getPageCommentThreads(userId, pageId).find((candidate) => candidate.id === threadId);
  if (!thread) throw new Error("Comment was not created.");
  return thread;
}

export function addPageComment(userId: string, threadId: string, bodyValue: string): PageCommentThread {
  ensureDatabase();
  const thread = queryOne(`SELECT page_id FROM page_comment_threads WHERE id = ${sql(threadId)} LIMIT 1`);
  if (!thread) throw new Error("Comment thread not found.");
  assertPageEditAccess(userId, thread.page_id);
  const body = normalizeCommentBody(bodyValue);
  execSql(`
    INSERT INTO page_comments (id, thread_id, user_id, body)
    VALUES (${sql(randomUUID())}, ${sql(threadId)}, ${sql(userId)}, ${sql(body)});

    UPDATE page_comment_threads
    SET updated_at = datetime('now')
    WHERE id = ${sql(threadId)};
  `);
  recordPageAuditEvent(userId, thread.page_id, "page.comment.replied", "replied to comment", { threadId });
  const updated = getPageCommentThreads(userId, thread.page_id).find((candidate) => candidate.id === threadId);
  if (!updated) throw new Error("Comment thread not found.");
  return updated;
}

export function setPageCommentThreadResolved(userId: string, threadId: string, resolved: boolean): PageCommentThread {
  ensureDatabase();
  const thread = queryOne(`SELECT page_id, resolved_at FROM page_comment_threads WHERE id = ${sql(threadId)} LIMIT 1`);
  if (!thread) throw new Error("Comment thread not found.");
  assertPageEditAccess(userId, thread.page_id);
  const currentlyResolved = Boolean(thread.resolved_at);
  if (currentlyResolved !== resolved) {
    execSql(`
      UPDATE page_comment_threads
      SET resolved_at = ${resolved ? "datetime('now')" : "NULL"},
          updated_at = datetime('now')
      WHERE id = ${sql(threadId)};
    `);
    recordPageAuditEvent(userId, thread.page_id, resolved ? "page.comment.resolved" : "page.comment.reopened", resolved ? "resolved comment" : "reopened comment", { threadId });
  }
  const updated = getPageCommentThreads(userId, thread.page_id).find((candidate) => candidate.id === threadId);
  if (!updated) throw new Error("Comment thread not found.");
  return updated;
}

export function deletePageCommentThread(userId: string, threadId: string, expectedPageId = "") {
  ensureDatabase();
  const thread = queryOne(`
    SELECT
      pct.page_id,
      p.notebook_id,
      p.body
    FROM page_comment_threads pct
    JOIN pages p ON p.id = pct.page_id
    WHERE pct.id = ${sql(threadId)}
    LIMIT 1
  `);
  if (!thread) {
    if (!expectedPageId) throw new Error("Comment thread not found.");
    assertPageReadAccess(userId, expectedPageId);
    const page = queryOne(`SELECT body FROM pages WHERE id = ${sql(expectedPageId)} LIMIT 1`);
    if (!page) throw new Error("Page not found");
    return { pageId: expectedPageId, body: String(page.body ?? "") };
  }
  if (expectedPageId && thread.page_id !== expectedPageId) throw new Error("Comment thread not found.");
  assertPageEditAccess(userId, thread.page_id);
  const storedBody = String(thread.body ?? "");
  const previousBody = normalizePageBody(storedBody);
  const nextBody = removeCommentMarksFromBody(previousBody, threadId);
  const bodyChanged = nextBody !== previousBody;
  const authoritativeBody = bodyChanged ? nextBody : storedBody;
  const auditMetadata = JSON.stringify({
    threadId,
    markerRemoved: bodyChanged,
    ...(bodyChanged ? {
      oldHash: hashAuditValue(previousBody),
      newHash: hashAuditValue(nextBody),
      oldLength: previousBody.length,
      newLength: nextBody.length,
    } : {}),
  });

  try {
    execSql(`
      BEGIN IMMEDIATE;
      CREATE TEMP TABLE novo_comment_delete_guard (
        value INTEGER NOT NULL CHECK (value = 1)
      );
      INSERT INTO novo_comment_delete_guard (value)
      VALUES (
        CASE WHEN EXISTS (
          SELECT 1
          FROM pages p
          JOIN page_comment_threads pct ON pct.page_id = p.id
          WHERE p.id = ${sql(thread.page_id)}
            AND pct.id = ${sql(threadId)}
            AND COALESCE(p.locked_at, '') = ''
            AND p.body = ${sql(storedBody)}
            AND p.notebook_id = ${sql(thread.notebook_id)}
            AND (
              EXISTS (
                SELECT 1
                FROM users u
                WHERE u.id = ${sql(userId)}
                  AND u.role = 'admin'
              )
              OR EXISTS (
                SELECT 1
                FROM notebook_members nm
                WHERE nm.notebook_id = p.notebook_id
                  AND nm.user_id = ${sql(userId)}
                  AND nm.role IN ('owner', 'editor')
              )
            )
        ) THEN 1 ELSE 0 END
      );
      DELETE FROM page_comment_threads WHERE id = ${sql(threadId)};
      ${bodyChanged ? `
        UPDATE pages
        SET body = ${sql(nextBody)},
            preview_text = ${sql(bodyToEditorText(nextBody).slice(0, 500))},
            updated_at = datetime('now')
        WHERE id = ${sql(thread.page_id)};
        UPDATE notebooks
        SET updated_at = datetime('now')
        WHERE id = ${sql(thread.notebook_id)};
      ` : ""}
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
        'page',
        ${sql(thread.page_id)},
        ${sql(thread.page_id)},
        ${sql(thread.notebook_id)},
        ${sql(userId)},
        'page.comment.deleted',
        'deleted comment',
        ${sql(auditMetadata)},
        1
      );
      INSERT INTO search_index_queue (page_id, queued_at)
      VALUES (${sql(thread.page_id)}, strftime('%s', 'now'))
      ON CONFLICT(page_id) DO UPDATE SET queued_at = excluded.queued_at;
      COMMIT;
    `);
  } catch (error) {
    const currentPage = queryOne(`
      SELECT notebook_id, body, COALESCE(locked_at, '') AS locked_at
      FROM pages
      WHERE id = ${sql(thread.page_id)}
      LIMIT 1
    `);
    const currentThread = queryOne(`
      SELECT 1 AS exists_flag
      FROM page_comment_threads
      WHERE id = ${sql(threadId)}
      LIMIT 1
    `);
    if (!currentPage) throw new Error("Page not found");
    if (!currentThread) throw new Error("Comment thread not found.");
    assertPageEditAccess(userId, thread.page_id);
    if (currentPage.notebook_id !== thread.notebook_id || currentPage.body !== storedBody) {
      throw new Error("Page changed while deleting the comment. Try again.");
    }
    throw error;
  }

  scheduleSearchIndexDrain();
  return { pageId: thread.page_id, body: authoritativeBody };
}

export function getAdminActivityEvents(adminUserId: string, options: { limit?: number; offset?: number } = {}): AdminActivityOverview {
  ensureDatabase();
  assertAdmin(adminUserId);
  const limit = clampInteger(options.limit, 1, 100, 30);
  const offset = clampInteger(options.offset, 0, 1_000_000_000, 0);
  const total = Number(queryOne("SELECT COUNT(*) AS count FROM audit_events")?.count ?? 0);
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
      ae.updated_at,
      COALESCE(p.title, '') AS page_title,
      COALESCE(n_direct.name, n_from_page.name, '') AS notebook_name
    FROM audit_events ae
    LEFT JOIN users u ON u.id = ae.actor_user_id
    LEFT JOIN pages p ON p.id = ae.page_id
    LEFT JOIN notebooks n_from_page ON n_from_page.id = p.notebook_id
    LEFT JOIN notebooks n_direct ON n_direct.id = ae.notebook_id
    ORDER BY ae.updated_at DESC, ae.created_at DESC, ae.rowid DESC
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
  const initialBody = readAppSettings().prependDateToNewPages ? formattedTodayForNewPage() : "";
  execSql(`
    INSERT INTO notebooks (id, name, owner_id, color)
    VALUES (${sql(notebookId)}, ${sql(name)}, ${sql(userId)}, ${sql(defaultNotebookColor(notebookId))});
    INSERT INTO notebook_members (notebook_id, user_id, role)
    VALUES (${sql(notebookId)}, ${sql(userId)}, 'owner');
    INSERT INTO pages (id, notebook_id, title, body, status, owner_id)
    VALUES (${sql(pageId)}, ${sql(notebookId)}, 'Untitled', ${sql(initialBody)}, '', ${sql(userId)});
  `);
  recordNotebookAuditEvent(userId, notebookId, "notebook.created", `created notebook ${quoteAuditValue(name)}`, { name });
  recordPageAuditEvent(userId, pageId, "page.created", "created page", { source: "notebook.create" });
  queueSearchIndexForPage(pageId);
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
  queueSearchIndexForNotebook(notebookId);
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
  }, { coalesce: true });
}

export function updateNotebookPageTitleTemplate(userId: string, notebookId: string, template: string, enabled: boolean) {
  ensureDatabase();
  assertNotebookManageAccess(userId, notebookId);
  const nextTemplate = normalizePageTitleTemplate(template);
  const nextEnabled = Boolean(enabled && nextTemplate);
  const current = queryOne(`SELECT page_title_template, COALESCE(page_title_template_enabled, 0) AS page_title_template_enabled FROM notebooks WHERE id = ${sql(notebookId)} LIMIT 1`);
  const previousTemplate = String(current?.page_title_template ?? "");
  const previousEnabled = databaseBoolean(current?.page_title_template_enabled);
  if (previousTemplate === nextTemplate && previousEnabled === nextEnabled) return;
  execSql(`
    UPDATE notebooks
    SET page_title_template = ${sql(nextTemplate)},
        page_title_template_enabled = ${nextEnabled ? 1 : 0},
        updated_at = datetime('now')
    WHERE id = ${sql(notebookId)};
  `);
  recordNotebookAuditEvent(userId, notebookId, "notebook.page_title_template.updated", nextEnabled ? "updated new page title template" : "paused new page title template", {
    previousTemplate,
    previousEnabled,
    nextTemplate,
    nextEnabled,
  });
  queueSearchIndexForNotebook(notebookId);
}

export function deleteNotebook(userId: string, notebookId: string) {
  ensureDatabase();
  assertNotebookManageAccess(userId, notebookId);
  const notebook = queryOne(`SELECT name FROM notebooks WHERE id = ${sql(notebookId)} LIMIT 1`);
  recordNotebookAuditEvent(userId, notebookId, "notebook.deleted", `deleted notebook ${quoteAuditValue(notebook?.name ?? "Untitled")}`, {
    name: notebook?.name ?? "",
  });
  execSql(`DELETE FROM notebooks WHERE id = ${sql(notebookId)};`);
  deleteSearchIndexForNotebook(notebookId);
}

export function createPage(userId: string, notebookId: string) {
  ensureDatabase();
  assertNotebookEditAccess(userId, notebookId);
  const pageId = randomUUID();
  const initialBody = readAppSettings().prependDateToNewPages ? formattedTodayForNewPage() : "";
  const title = suggestPageTitle(notebookId);
  execSql(`
    INSERT INTO pages (id, notebook_id, title, body, status, owner_id)
    VALUES (${sql(pageId)}, ${sql(notebookId)}, ${sql(title)}, ${sql(initialBody)}, '', ${sql(userId)});
    UPDATE notebooks SET updated_at = datetime('now') WHERE id = ${sql(notebookId)};
  `);
  recordPageAuditEvent(userId, pageId, "page.created", "created page");
  queueSearchIndexForPage(pageId);
  return pageId;
}

export function updatePage(userId: string, pageId: string, patch: { title?: string; body?: string; status?: PageStatus }) {
  ensureDatabase();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    assertPageEditAccess(userId, pageId);
    const row = queryOne(`SELECT notebook_id, title, body, status FROM pages WHERE id = ${sql(pageId)} LIMIT 1`);
    if (!row) throw new Error("Page not found");
    const assignments: string[] = [];
    const normalizedStatus = patch.status !== undefined ? normalizePageStatus(patch.status) : undefined;
    const previousTitle = String(row.title ?? "");
    const previousBody = String(row.body ?? "");
    const previousStatus = normalizePageStatus(row.status);
    const previousNormalizedBody = patch.body !== undefined ? normalizePageBody(previousBody) : "";
    const nextNormalizedBody = patch.body !== undefined
      ? removeUnknownPageCommentMarks(pageId, normalizePageBody(patch.body))
      : "";
    const titleChanged = patch.title !== undefined && patch.title !== previousTitle;
    const bodyChanged = patch.body !== undefined && nextNormalizedBody !== previousNormalizedBody;
    const statusChanged = normalizedStatus !== undefined && normalizedStatus !== previousStatus;
    if (titleChanged) assignments.push(`title = ${sql(patch.title)}`);
    if (bodyChanged) {
      assignments.push(`body = ${sql(nextNormalizedBody)}`);
      assignments.push(`preview_text = ${sql(bodyToEditorText(nextNormalizedBody).slice(0, 500))}`);
    }
    if (statusChanged) assignments.push(`status = ${sql(normalizedStatus)}`);
    if (!assignments.length) return false;
    assignments.push("updated_at = datetime('now')");
    const referencedThreadIds = bodyChanged ? commentThreadIdsFromBody(nextNormalizedBody) : [];
    const referencedThreadGuard = referencedThreadIds.length
      ? `AND (
          SELECT COUNT(*)
          FROM page_comment_threads pct
          WHERE pct.page_id = p.id
            AND pct.id IN (${referencedThreadIds.map(sql).join(", ")})
        ) = ${referencedThreadIds.length}`
      : "";

    try {
      execSql(`
        BEGIN IMMEDIATE;
        CREATE TEMP TABLE novo_page_update_guard (
          value INTEGER NOT NULL CHECK (value = 1)
        );
        INSERT INTO novo_page_update_guard (value)
        VALUES (
          CASE WHEN EXISTS (
            SELECT 1
            FROM pages p
            WHERE p.id = ${sql(pageId)}
              AND p.notebook_id = ${sql(row.notebook_id)}
              AND COALESCE(p.locked_at, '') = ''
              AND (
                EXISTS (
                  SELECT 1
                  FROM users u
                  WHERE u.id = ${sql(userId)}
                    AND u.role = 'admin'
                )
                OR EXISTS (
                  SELECT 1
                  FROM notebook_members nm
                  WHERE nm.notebook_id = p.notebook_id
                    AND nm.user_id = ${sql(userId)}
                    AND nm.role IN ('owner', 'editor')
                )
              )
              ${referencedThreadGuard}
          ) THEN 1 ELSE 0 END
        );
        UPDATE pages SET ${assignments.join(", ")} WHERE id = ${sql(pageId)};
        UPDATE notebooks SET updated_at = datetime('now') WHERE id = ${sql(row.notebook_id)};
        COMMIT;
      `);
    } catch (error) {
      if (attempt === 0 && patch.body !== undefined) continue;
      assertPageEditAccess(userId, pageId);
      throw error;
    }

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
          oldHash: hashAuditValue(previousNormalizedBody),
          newHash: hashAuditValue(nextNormalizedBody),
          oldLength: previousNormalizedBody.length,
          newLength: nextNormalizedBody.length,
        },
        coalesce: true,
      });
    }
    queueSearchIndexForPage(pageId);
    return true;
  }
  return false;
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
  queueSearchIndexForPage(pageId);
}

export function movePage(userId: string, pageId: string, targetNotebookId: string) {
  ensureDatabase();
  assertPageEditAccess(userId, pageId);
  assertNotebookEditAccess(userId, targetNotebookId);
  const page = queryOne(`
    SELECT
      p.notebook_id AS source_notebook_id,
      p.title AS title,
      source.name AS source_notebook_name,
      target.name AS target_notebook_name
    FROM pages p
    JOIN notebooks source ON source.id = p.notebook_id
    JOIN notebooks target ON target.id = ${sql(targetNotebookId)}
    WHERE p.id = ${sql(pageId)}
    LIMIT 1
  `);
  if (!page) throw new Error("Page or destination notebook not found");
  const sourceNotebookId = String(page.source_notebook_id ?? "");
  if (sourceNotebookId === targetNotebookId) return false;

  execSql(`
    UPDATE pages
    SET notebook_id = ${sql(targetNotebookId)},
        updated_at = datetime('now')
    WHERE id = ${sql(pageId)};
    UPDATE notebooks SET updated_at = datetime('now') WHERE id IN (${sql(sourceNotebookId)}, ${sql(targetNotebookId)});
  `);
  recordAuditEvent({
    entityType: "page",
    entityId: pageId,
    pageId,
    notebookId: targetNotebookId,
    actorUserId: userId,
    action: "page.moved",
    summary: `moved page from ${quoteAuditValue(page.source_notebook_name ?? "Untitled")} to ${quoteAuditValue(page.target_notebook_name ?? "Untitled")}`,
    metadata: {
      title: page.title ?? "",
      oldNotebookId: sourceNotebookId,
      newNotebookId: targetNotebookId,
      oldNotebookName: page.source_notebook_name ?? "",
      newNotebookName: page.target_notebook_name ?? "",
    },
  });
  queueSearchIndexForPage(pageId);
  return true;
}

export function setPageTags(userId: string, pageId: string, tags: string[]) {
  ensureDatabase();
  assertPageEditAccess(userId, pageId);
  const normalizedTags = normalizePageTags(tags);
  const currentTags = tagLabelRowsToList(querySql(`
    SELECT t.label AS tag
    FROM page_tags pt
    JOIN tags t ON t.id = pt.tag_id
    WHERE pt.page_id = ${sql(pageId)}
    ORDER BY pt.rowid ASC
  `));
  if (tagListsEqual(normalizedTags, currentTags)) return false;
  const page = queryOne(`SELECT notebook_id FROM pages WHERE id = ${sql(pageId)} LIMIT 1`);
  execSql(`
    DELETE FROM page_tags WHERE page_id = ${sql(pageId)};
    ${pageTagInsertSql(pageId, normalizedTags)}
    UPDATE pages SET updated_at = datetime('now') WHERE id = ${sql(pageId)};
    UPDATE notebooks SET updated_at = datetime('now') WHERE id = (SELECT notebook_id FROM pages WHERE id = ${sql(pageId)});
  `);
  pruneUnusedTags();
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
  queueSearchIndexForPage(pageId);
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
  pruneUnusedTags();
  deleteSearchIndexForPage(pageId);
}

export function duplicatePage(userId: string, pageId: string) {
  ensureDatabase();
  assertPageEditAccess(userId, pageId);
  const page = queryOne(`SELECT notebook_id, title, body, status FROM pages WHERE id = ${sql(pageId)} LIMIT 1`);
  if (!page) throw new Error("Page not found");

  const notebookId = String(page.notebook_id ?? "");
  const title = duplicatePageTitle(notebookId, String(page.title || "Untitled"));
  const tags = tagLabelRowsToList(querySql(`
    SELECT t.label AS tag
    FROM page_tags pt
    JOIN tags t ON t.id = pt.tag_id
    WHERE pt.page_id = ${sql(pageId)}
    ORDER BY pt.rowid ASC
  `));
  const attachments = querySql(`
    SELECT id, original_name, mime_type, size, storage_key, block_type, COALESCE(evernote_hash, '') AS evernote_hash
    FROM attachments
    WHERE page_id = ${sql(pageId)}
    ORDER BY created_at ASC, rowid ASC
  `);

  const newPageId = randomUUID();
  const copiedStorageKeys: string[] = [];
  const attachmentCopies = attachments.map((attachment) => {
    const originalName = attachment.original_name || "attachment.bin";
    const newStorageKey = path.join(newPageId, `${randomUUID()}-${sanitizeStorageFileName(originalName)}`).split(path.sep).join("/");
    return {
      oldId: attachment.id,
      newId: randomUUID(),
      originalName,
      mimeType: attachment.mime_type || "application/octet-stream",
      size: Number(attachment.size || 0),
      oldStorageKey: attachment.storage_key,
      newStorageKey,
      blockType: attachment.block_type || "file",
      evernoteHash: attachment.evernote_hash || "",
    };
  });

  try {
    for (const attachment of attachmentCopies) {
      const sourcePath = path.join(uploadDir, attachment.oldStorageKey);
      const destinationPath = path.join(uploadDir, attachment.newStorageKey);
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.copyFileSync(sourcePath, destinationPath);
      copiedStorageKeys.push(attachment.newStorageKey);
    }

    const attachmentIdMap = Object.fromEntries(attachmentCopies.map((attachment) => [attachment.oldId, attachment.newId]));
    const body = remapAttachmentCardsInBody(String(page.body ?? ""), attachmentIdMap);
    const attachmentAnnotationInserts = attachmentCopies.map((attachment) => {
      const annotation = queryOne(`SELECT data_json, updated_by FROM attachment_annotations WHERE attachment_id = ${sql(attachment.oldId)} LIMIT 1`);
      if (!annotation?.data_json) return "";
      return `
        INSERT INTO attachment_annotations (attachment_id, page_id, data_json, updated_by)
        VALUES (${sql(attachment.newId)}, ${sql(newPageId)}, ${sql(normalizeAttachmentAnnotationDataJson(annotation.data_json))}, ${sql(annotation.updated_by ?? userId)});
      `;
    }).join("\n");
    execSql(`
      BEGIN;
      INSERT INTO pages (id, notebook_id, title, body, preview_text, status, owner_id)
      VALUES (${sql(newPageId)}, ${sql(notebookId)}, ${sql(title)}, ${sql(body)}, ${sql(bodyToEditorText(body).slice(0, 500))}, ${sql(page.status ?? "")}, ${sql(userId)});
      ${pageTagInsertSql(newPageId, tags)}
      ${attachmentCopies.map((attachment) => `
        INSERT INTO attachments (id, page_id, original_name, mime_type, size, storage_key, block_type, evernote_hash)
        VALUES (${sql(attachment.newId)}, ${sql(newPageId)}, ${sql(attachment.originalName)}, ${sql(attachment.mimeType)}, ${attachment.size}, ${sql(attachment.newStorageKey)}, ${sql(attachment.blockType)}, ${sql(attachment.evernoteHash)});
      `).join("\n")}
      ${attachmentAnnotationInserts}
      UPDATE notebooks SET updated_at = datetime('now') WHERE id = ${sql(notebookId)};
      COMMIT;
    `);
  } catch (error) {
    for (const storageKey of copiedStorageKeys) {
      fs.rmSync(path.join(uploadDir, storageKey), { force: true });
    }
    throw error;
  }

  recordAuditEvent({
    entityType: "page",
    entityId: newPageId,
    pageId: newPageId,
    notebookId,
    actorUserId: userId,
    action: "page.duplicated",
    summary: `duplicated page from ${quoteAuditValue(page.title || "Untitled")}`,
    metadata: {
      sourcePageId: pageId,
      sourceTitle: page.title ?? "",
      title,
      attachmentCount: attachmentCopies.length,
    },
  });
  queueSearchIndexForPage(newPageId);
  return { pageId: newPageId, notebookId };
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
  queueSearchIndexForPage(input.pageId);
  return id;
}

export function getAttachmentForUser(userId: string, attachmentId: string): Attachment | null {
  ensureDatabase();
  const row = queryOne(`
    SELECT
      a.id,
      a.page_id,
      a.original_name,
      a.mime_type,
      a.size,
      a.storage_key,
      a.block_type,
      COALESCE(a.evernote_hash, '') AS evernote_hash,
      a.created_at,
      aa.data_json AS annotation_data_json,
      COALESCE(aa.updated_at, '') AS annotation_updated_at,
      COALESCE(aa.updated_by, '') AS annotation_updated_by
    FROM attachments a
    LEFT JOIN attachment_annotations aa ON aa.attachment_id = a.id
    WHERE a.id = ${sql(attachmentId)}
    LIMIT 1
  `);
  if (row) assertPageReadAccess(userId, row.page_id);
  return row ? toAttachment(row) : null;
}

export function getAttachmentAnnotationForUser(userId: string, attachmentId: string) {
  ensureDatabase();
  const attachment = getAttachmentForUser(userId, attachmentId);
  if (!attachment) throw new Error("Attachment not found");
  return {
    attachment,
    annotation: attachment.annotation ?? {
      dataJson: '{"items":[]}',
      updatedAt: "",
      updatedBy: "",
    },
  };
}

export function saveAttachmentAnnotation(input: { userId: string; attachmentId: string; data: unknown }) {
  ensureDatabase();
  assertAttachmentEditAccess(input.userId, input.attachmentId);
  const attachment = getAttachmentForUser(input.userId, input.attachmentId);
  if (!attachment) throw new Error("Attachment not found");
  if (attachment.blockType !== "image") throw new Error("Only image attachments can be annotated.");

  const dataJson = normalizeAttachmentAnnotationDataJson(input.data);
  execSql(`
    INSERT INTO attachment_annotations (attachment_id, page_id, data_json, updated_by, created_at, updated_at)
    VALUES (${sql(input.attachmentId)}, ${sql(attachment.pageId)}, ${sql(dataJson)}, ${sql(input.userId)}, datetime('now'), datetime('now'))
    ON CONFLICT(attachment_id) DO UPDATE SET
      data_json = excluded.data_json,
      updated_by = excluded.updated_by,
      updated_at = datetime('now');
    UPDATE pages SET updated_at = datetime('now') WHERE id = ${sql(attachment.pageId)};
    UPDATE notebooks SET updated_at = datetime('now') WHERE id = (SELECT notebook_id FROM pages WHERE id = ${sql(attachment.pageId)});
  `);
  recordPageAuditEvent(
    input.userId,
    attachment.pageId,
    "attachment.annotated",
    `annotated image ${quoteAuditValue(attachment.originalName)}`,
    {
      attachmentId: input.attachmentId,
      originalName: attachment.originalName,
      itemCount: parseAttachmentAnnotationDataJson(dataJson).items.length,
    },
    { coalesce: true },
  );
  return getAttachmentAnnotationForUser(input.userId, input.attachmentId).annotation;
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
  queueSearchIndexForPage(attachment.pageId);
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
      SET title = ${sql(title)}, body = ${sql(input.body)}, preview_text = ${sql(bodyToEditorText(input.body).slice(0, 500))}, created_at = ${sql(createdAt)}, updated_at = ${sql(updatedAt)}
      WHERE id = ${sql(pageId)};
      DELETE FROM page_tags WHERE page_id = ${sql(pageId)};
      ${pageTagInsertSql(pageId, normalizedTags)}
    `);
    return pageId;
  }

  execSql(`
    INSERT INTO pages (id, notebook_id, title, body, preview_text, status, owner_id, created_at, updated_at)
    VALUES (${sql(pageId)}, ${sql(input.notebookId)}, ${sql(title)}, ${sql(input.body)}, ${sql(bodyToEditorText(input.body).slice(0, 500))}, '', ${sql(input.userId)}, ${sql(createdAt)}, ${sql(updatedAt)});
    ${pageTagInsertSql(pageId, normalizedTags)}
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
  evernoteHash?: string;
  createdAt?: string;
}): Attachment {
  ensureDatabase();
  const id = randomUUID();
  const createdAt = input.createdAt ?? new Date().toISOString();
  execSql(`
    INSERT INTO attachments (id, page_id, original_name, mime_type, size, storage_key, block_type, evernote_hash, created_at)
    VALUES (${sql(id)}, ${sql(input.pageId)}, ${sql(input.originalName)}, ${sql(input.mimeType)}, ${input.size}, ${sql(input.storageKey)}, ${sql(input.blockType)}, ${sql(input.evernoteHash ?? "")}, ${sql(createdAt)});
  `);
  return {
    id,
    pageId: input.pageId,
    originalName: input.originalName,
    mimeType: input.mimeType,
    size: input.size,
    storageKey: input.storageKey,
    blockType: input.blockType,
    evernoteHash: input.evernoteHash ?? "",
    createdAt,
    updatedAt: createdAt,
  };
}

export function finishImportedNotebook(notebookId: string) {
  ensureDatabase();
  execSql(`UPDATE notebooks SET updated_at = datetime('now') WHERE id = ${sql(notebookId)};`);
  queueSearchIndexForNotebook(notebookId);
}

export function removeImportedNotebook(notebookId: string) {
  ensureDatabase();
  execSql(`DELETE FROM notebooks WHERE id = ${sql(notebookId)};`);
  deleteSearchIndexForNotebook(notebookId);
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
  queueSearchIndexForPage(attachment.pageId);
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
  const isLeaving = actorUserId === targetUserId;
  if (isLeaving) assertNotebookReadAccess(actorUserId, notebookId);
  else assertNotebookManageAccess(actorUserId, notebookId);
  const targetRole = queryOne(`SELECT role FROM notebook_members WHERE notebook_id = ${sql(notebookId)} AND user_id = ${sql(targetUserId)} LIMIT 1`)?.role;
  if (targetRole === "owner" && countNotebookOwners(notebookId) <= 1) throw new Error("Notebooks need at least one owner.");
  const targetUser = findUserById(targetUserId);
  execSql(`DELETE FROM notebook_members WHERE notebook_id = ${sql(notebookId)} AND user_id = ${sql(targetUserId)};`);
  recordNotebookAuditEvent(actorUserId, notebookId, isLeaving ? "notebook.member.left" : "notebook.member.removed", isLeaving ? "left notebook" : `removed ${targetUser ? displayName(targetUser) : "a member"} from notebook`, {
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
      ${pageTagInsertSql(pageId, normalizePageTags(note.tags))}
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

function removeUnknownPageCommentMarks(pageId: string, body: string) {
  if (!body.includes('"comment"')) return body;
  const validThreadIds = new Set(
    querySql(`
      SELECT id
      FROM page_comment_threads
      WHERE page_id = ${sql(pageId)}
    `).map((row) => row.id),
  );
  return removeUnknownCommentMarksFromBody(body, validThreadIds);
}

function getNotebookRole(userId: string, notebookId: string): AccessRole | null {
  if (isAdmin(userId)) {
    const notebook = queryOne(`SELECT 1 AS exists_flag FROM notebooks WHERE id = ${sql(notebookId)} LIMIT 1`);
    return notebook ? "owner" : null;
  }
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
  if (isAdmin(userId)) {
    const page = queryOne(`SELECT 1 AS exists_flag FROM pages WHERE id = ${sql(pageId)} LIMIT 1`);
    if (!page) throw new Error("Forbidden");
    return;
  }
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
  if (isAdmin(userId)) {
    const page = queryOne(`SELECT COALESCE(locked_at, '') AS locked_at FROM pages WHERE id = ${sql(pageId)} LIMIT 1`);
    if (!page) throw new Error("Forbidden");
    if (page.locked_at) throw new Error("Page is locked.");
    return;
  }
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
  if (isAdmin(userId)) {
    const page = queryOne(`SELECT 1 AS exists_flag FROM pages WHERE id = ${sql(pageId)} LIMIT 1`);
    if (!page) throw new Error("Forbidden");
    return;
  }
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
  if (roleRank(normalizeAccessRole(row?.role)) < roleRank("editor")) throw new Error("Only editors and owners can lock pages.");
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

function normalizeGlobalTagLabel(label: string) {
  const normalized = label.trim().replace(/\s+/g, " ");
  if (!normalized) throw new Error("Tag name is required.");
  if (normalized.length > 80) throw new Error("Tag name must be 80 characters or fewer.");
  return normalized;
}

function tagPageRows(tagId: string) {
  return querySql(`
    SELECT page_id
    FROM page_tags
    WHERE tag_id = ${sql(tagId)}
  `);
}

function pruneUnusedTags() {
  execSql(`
    DELETE FROM tags
    WHERE NOT EXISTS (
      SELECT 1
      FROM page_tags
      WHERE page_tags.tag_id = tags.id
    );
  `);
}

function queueSearchIndexForTagPageRows(rows: Array<{ page_id?: string }>) {
  const seen = new Set<string>();
  for (const row of rows) {
    const pageId = row.page_id ?? "";
    if (!pageId || seen.has(pageId)) continue;
    seen.add(pageId);
    queueSearchIndexForPage(pageId);
  }
}

function isAdmin(userId: string) {
  const role = queryOne(`SELECT role FROM users WHERE id = ${sql(userId)} LIMIT 1`)?.role;
  return role === "admin";
}

function readAppSettings(): AdminAppSettings {
  return {
    prependDateToNewPages: readAppSetting("prepend_date_to_new_pages", "1") === "1",
    suggestTagsGlobally: readAppSetting("suggest_tags_globally", "1") === "1",
  };
}

function readAppSetting(key: string, fallback: string) {
  return String(queryOne(`SELECT value FROM app_settings WHERE key = ${sql(key)} LIMIT 1`)?.value ?? fallback);
}

function writeAppSetting(key: string, value: string) {
  execSql(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (${sql(key)}, ${sql(value)}, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
  `);
}

function formattedTodayForNewPage() {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date());
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

function normalizePageTitleTemplate(value: string | undefined) {
  const template = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!template) return "";
  if (template.length > 120) throw new Error("Title template must be 120 characters or fewer.");
  const matches = template.match(/\{number\}/g) ?? [];
  if (matches.length !== 1) throw new Error('Title template must include exactly one "{number}" placeholder.');
  return template;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function templateSegmentToRegex(value: string) {
  return escapeRegExp(value).replace(/\\\s+/g, "\\s+").replace(/\\-/g, "[\\s-]*");
}

function pageTitleTemplateRegex(template: string) {
  const [beforeNumber] = template.split("{number}");
  return new RegExp(`^\\s*${templateSegmentToRegex(beforeNumber)}(\\d+)`, "i");
}

function uniquePageTitle(baseTitle: string, existingTitles: Set<string>) {
  if (!existingTitles.has(baseTitle.toLowerCase())) return baseTitle;
  let index = 2;
  while (existingTitles.has(`${baseTitle} (${index})`.toLowerCase())) index += 1;
  return `${baseTitle} (${index})`;
}

function suggestPageTitle(notebookId: string) {
  const row = queryOne(`SELECT page_title_template, COALESCE(page_title_template_enabled, 0) AS page_title_template_enabled FROM notebooks WHERE id = ${sql(notebookId)} LIMIT 1`);
  const titles = querySql(`SELECT title FROM pages WHERE notebook_id = ${sql(notebookId)}`).map((page) => String(page.title ?? ""));
  const existingTitles = new Set(titles.map((title) => title.toLowerCase()));
  if (!databaseBoolean(row?.page_title_template_enabled)) return "Untitled";
  const template = normalizePageTitleTemplate(String(row?.page_title_template ?? ""));
  if (!template) return "Untitled";
  const regex = pageTitleTemplateRegex(template);
  let maxNumber = 0;
  for (const title of titles) {
    const match = title.match(regex);
    if (!match) continue;
    const value = Number.parseInt(match[1], 10);
    if (Number.isFinite(value)) maxNumber = Math.max(maxNumber, value);
  }
  return uniquePageTitle(template.replace("{number}", String(maxNumber + 1)), existingTitles);
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

function recordPageAuditEvent(userId: string, pageId: string, action: string, summary: string, metadata: Record<string, unknown> = {}, options: { coalesce?: boolean } = {}) {
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
    coalesce: options.coalesce,
  });
}

function recordNotebookAuditEvent(userId: string, notebookId: string, action: string, summary: string, metadata: Record<string, unknown> = {}, options: { coalesce?: boolean } = {}) {
  recordAuditEvent({
    entityType: "notebook",
    entityId: notebookId,
    notebookId,
    actorUserId: userId,
    action,
    summary,
    metadata,
    coalesce: options.coalesce,
  });
}

function recordTagAuditEvent(userId: string, tagId: string, action: string, summary: string, metadata: Record<string, unknown> = {}) {
  recordAuditEvent({
    entityType: "tag",
    entityId: tagId,
    actorUserId: userId,
    action,
    summary,
    metadata,
  });
}

function recordAuditEvent(input: AuditEventInput) {
  const metadataJson = JSON.stringify(input.metadata ?? {});
  if (input.coalesce) {
    const existing = queryOne(`
      SELECT id, metadata_json, event_count
      FROM audit_events
      WHERE entity_type = ${sql(input.entityType)}
        AND entity_id = ${sql(input.entityId)}
        AND actor_user_id = ${sql(input.actorUserId)}
        AND action = ${sql(input.action)}
        AND datetime(updated_at) >= datetime('now', '-${auditEventCoalesceSeconds} seconds')
      ORDER BY updated_at DESC, rowid DESC
      LIMIT 1
    `);
    if (existing?.id) {
      const previousMetadata = parseAuditMetadata(existing.metadata_json);
      const eventCount = Number(existing.event_count || 1) + 1;
      const nextMetadata = coalescedAuditMetadata(previousMetadata, input.metadata ?? {}, eventCount);
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

function coalescedAuditMetadata(previousMetadata: Record<string, unknown>, nextMetadata: Record<string, unknown>, eventCount: number) {
  const merged: Record<string, unknown> = {
    ...previousMetadata,
    ...nextMetadata,
    coalescedEditCount: eventCount,
  };
  for (const [key, value] of Object.entries(previousMetadata)) {
    if (key.startsWith("old") && Object.prototype.hasOwnProperty.call(nextMetadata, key)) merged[key] = value;
  }
  return merged;
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

function parseAttachmentAnnotationDataJson(value: unknown): { items: unknown[] } {
  if (!value) return { items: [] };
  if (typeof value === "string") {
    try {
      return parseAttachmentAnnotationDataJson(JSON.parse(value) as unknown);
    } catch {
      return { items: [] };
    }
  }
  if (typeof value !== "object" || Array.isArray(value)) return { items: [] };
  const items = (value as { items?: unknown }).items;
  return { items: Array.isArray(items) ? items.slice(0, 1000) : [] };
}

function normalizeAttachmentAnnotationDataJson(value: unknown) {
  const normalized = parseAttachmentAnnotationDataJson(value);
  const json = JSON.stringify(normalized);
  if (json.length > 1024 * 1024) throw new Error("Annotation is too large.");
  return json;
}

function toPageComment(row: Record<string, string>): PageComment {
  return {
    id: row.id,
    threadId: row.thread_id,
    userId: row.user_id,
    userFirstName: row.user_first_name,
    userLastName: row.user_last_name,
    userEmail: row.user_email,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPageCommentThread(row: Record<string, string>, comments: PageComment[]): PageCommentThread {
  return {
    id: row.id,
    pageId: row.page_id,
    createdBy: row.created_by,
    createdByFirstName: row.created_by_first_name,
    createdByLastName: row.created_by_last_name,
    createdByEmail: row.created_by_email,
    selectedText: row.selected_text,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    comments,
  };
}

function normalizeCommentBody(value: string) {
  const normalized = value.trim().replace(/\r\n/g, "\n").slice(0, 4000);
  if (!normalized) throw new Error("Comment cannot be empty.");
  return normalized;
}

function normalizeSelectedCommentText(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 500);
}

function toAuditEvent(row: Record<string, string>): AuditEvent {
  const event: AuditEvent = {
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
  if (row.page_title) event.pageTitle = row.page_title;
  if (row.notebook_name) event.notebookName = row.notebook_name;
  return event;
}

function auditEntityType(value: string): AuditEvent["entityType"] {
  if (value === "notebook" || value === "attachment" || value === "tag") return value;
  return "page";
}

function statusLabel(status: PageStatus | undefined) {
  return status || "No status";
}

function quoteAuditValue(value: string) {
  const normalized = value.trim() || "Untitled";
  return `"${normalized}"`;
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
    appRole: (row.user_role === "admin" || row.user_role === "viewer" ? row.user_role : "member") as UserRole,
    implicitAdmin: false,
  };
}

function withImplicitAdminMembers(members: ShareMember[], adminRows: Record<string, string>[]): ShareMember[] {
  const byUserId = new Map(members.map((member) => [member.userId, member]));
  for (const admin of adminRows) {
    const existing = byUserId.get(admin.id);
    byUserId.set(admin.id, {
      userId: admin.id,
      email: admin.email,
      firstName: admin.first_name,
      lastName: admin.last_name,
      role: "owner",
      appRole: "admin",
      implicitAdmin: !existing,
    });
  }
  return [...byUserId.values()].sort(compareShareMembers);
}

function compareShareMembers(a: ShareMember, b: ShareMember) {
  return (
    a.firstName.localeCompare(b.firstName, undefined, { sensitivity: "base" })
    || a.lastName.localeCompare(b.lastName, undefined, { sensitivity: "base" })
    || a.email.localeCompare(b.email, undefined, { sensitivity: "base" })
  );
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

function tagLabelRowsToList(rows: Record<string, string>[]) {
  return normalizePageTags(rows.map((row) => row.tag));
}

function pageTagInsertSql(pageId: string, tags: string[]) {
  return tags.map((tag) => `
    INSERT OR IGNORE INTO tags (id, label)
    VALUES (${sql(randomUUID())}, ${sql(tag)});

    INSERT OR IGNORE INTO page_tags (page_id, tag_id)
    SELECT ${sql(pageId)}, id
    FROM tags
    WHERE label = ${sql(tag)} COLLATE NOCASE
    LIMIT 1;
  `).join("\n");
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

function duplicatePageTitle(notebookId: string, sourceTitle: string) {
  const baseTitle = sourceTitle.trim() || "Untitled";
  const existingTitles = new Set(
    querySql(`SELECT title FROM pages WHERE notebook_id = ${sql(notebookId)}`)
      .map((row) => String(row.title ?? "").toLowerCase()),
  );
  for (let index = 1; index < 10000; index += 1) {
    const candidate = `${baseTitle} copy ${index}`;
    if (!existingTitles.has(candidate.toLowerCase())) return candidate;
  }
  return `${baseTitle} copy`;
}

function sanitizeStorageFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "attachment.bin";
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
  const annotationDataJson = row.annotation_data_json;
  return {
    id: row.id,
    pageId: row.page_id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    size: Number(row.size),
    storageKey: row.storage_key,
    blockType: row.block_type as BlockType,
    evernoteHash: row.evernote_hash ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    annotation: annotationDataJson ? {
      dataJson: annotationDataJson,
      updatedAt: row.annotation_updated_at ?? "",
      updatedBy: row.annotation_updated_by ?? "",
    } : null,
  };
}
