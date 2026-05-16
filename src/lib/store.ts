import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import type { AccessRole, AdminDataOverview, AdminUser, AppUser, Attachment, BlockType, Notebook, PageEntry, PageStatus, Project, ShareMember, UserRole, Workspace } from "./types";
import { removeAttachmentCardsFromBody } from "./editor";
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
      name TEXT NOT NULL,
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

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#0891b2',
      owner_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS project_members (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'editor',
      PRIMARY KEY (project_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS notebook_members (
      notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'editor',
      PRIMARY KEY (notebook_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS notebooks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pages (
      id TEXT PRIMARY KEY,
      notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      owner_id TEXT NOT NULL REFERENCES users(id),
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
      preview_text TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS page_versions (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      summary TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS import_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      notebook_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'queued',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      error TEXT,
      notebook_id TEXT,
      total_notes INTEGER,
      total_resources INTEGER,
      imported_notes INTEGER NOT NULL DEFAULT 0,
      imported_resources INTEGER NOT NULL DEFAULT 0,
      processed_bytes INTEGER NOT NULL DEFAULT 0,
      total_bytes INTEGER NOT NULL DEFAULT 0,
      worker_count INTEGER NOT NULL DEFAULT 4,
      worker_pid INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS search_pages_fts USING fts5(
      page_id UNINDEXED,
      project_id UNINDEXED,
      notebook_id UNINDEXED,
      title,
      body,
      tags,
      attachments,
      project,
      notebook,
      updated_at UNINDEXED,
      tokenize='unicode61'
    );
  `);
  ensureProjectColorColumn();
  ensureImportJobsTotalResourcesColumn();
  ensureImportJobsWorkerCountColumn();
  migratePageStatusValues();
  migrateGroupedTagsToPageTags();
  seedIfEmpty();
  rebuildSearchIndex();
  initialized = true;
}

function ensureProjectColorColumn() {
  const columns = querySql("PRAGMA table_info(projects);");
  if (columns.some((column) => column.name === "color")) return;
  execSql("ALTER TABLE projects ADD COLUMN color TEXT NOT NULL DEFAULT '#0891b2';");
}

function ensureImportJobsTotalResourcesColumn() {
  const columns = querySql("PRAGMA table_info(import_jobs);");
  if (columns.some((column) => column.name === "total_resources")) return;
  execSql("ALTER TABLE import_jobs ADD COLUMN total_resources INTEGER;");
}

function ensureImportJobsWorkerCountColumn() {
  const columns = querySql("PRAGMA table_info(import_jobs);");
  if (columns.some((column) => column.name === "worker_count")) return;
  execSql("ALTER TABLE import_jobs ADD COLUMN worker_count INTEGER NOT NULL DEFAULT 4;");
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
  const projectId = randomUUID();
  const constructNotebookId = randomUUID();
  const meetingNotebookId = randomUUID();
  const pageOneId = randomUUID();
  const pageTwoId = randomUUID();
  const pageThreeId = randomUUID();

  execSql(`
    INSERT INTO users (id, email, name, password_hash, role)
    VALUES (${sql(userId)}, ${sql(bootstrapEmail)}, 'Andrew', ${sql(bcrypt.hashSync(bootstrapPassword, 10))}, 'admin');

    INSERT INTO projects (id, name, description, color, owner_id)
    VALUES (${sql(projectId)}, 'Gene Synthesis', 'Evernote replacement workspace for gene synthesis notes.', '#0891b2', ${sql(userId)});

    INSERT INTO project_members (project_id, user_id, role)
    VALUES (${sql(projectId)}, ${sql(userId)}, 'owner');

    INSERT INTO notebooks (id, project_id, name)
    VALUES (${sql(constructNotebookId)}, ${sql(projectId)}, 'Construct Design'),
           (${sql(meetingNotebookId)}, ${sql(projectId)}, 'Meeting Notes');

    INSERT INTO pages (id, notebook_id, title, body, status, owner_id)
    VALUES
      (${sql(pageOneId)}, ${sql(constructNotebookId)}, 'SortSeq plasmid assembly notes', ${sql("Summary of the SortSeq construct changes. The key need is keeping protocol text, source files, and analysis artifacts together without turning this into a full LIMS.")}, '', ${sql(userId)}),
      (${sql(pageTwoId)}, ${sql(constructNotebookId)}, 'Competent cell prep', ${sql("Prep notes should behave like normal pages, not special experiments. A lightweight checklist is enough for repeatable work; scheduling and bookable resources are intentionally out of scope.")}, '', ${sql(userId)}),
      (${sql(pageThreeId)}, ${sql(meetingNotebookId)}, 'ELN requirements from Slim', ${sql("The replacement should preserve Evernote-like workflows: projects, notebooks, pages, inline images, attachments, search, and history.")}, '', ${sql(userId)});

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

    INSERT INTO page_versions (id, page_id, summary, created_by)
    VALUES (${sql(randomUUID())}, ${sql(pageOneId)}, 'Created seed page', ${sql(userId)}),
           (${sql(randomUUID())}, ${sql(pageTwoId)}, 'Created seed page', ${sql(userId)}),
           (${sql(randomUUID())}, ${sql(pageThreeId)}, 'Created seed page', ${sql(userId)});
  `);
}

export function findUserByEmail(email: string) {
  ensureDatabase();
  const row = queryOne(`SELECT id, email, name, password_hash, role FROM users WHERE lower(email) = lower(${sql(email)}) LIMIT 1`);
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.password_hash,
    role: row.role as UserRole,
  };
}

export function findUserById(id: string): AppUser | null {
  ensureDatabase();
  const row = queryOne(`SELECT id, email, name, role FROM users WHERE id = ${sql(id)} LIMIT 1`);
  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role as UserRole };
}

export function verifyCredentials(email: string, password: string): AppUser | null {
  const user = findUserByEmail(email);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role };
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

export function createUser(input: { email: string; name: string; password: string; role?: UserRole }): AppUser {
  ensureDatabase();
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  const password = input.password;
  const role = input.role ?? "member";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
  if (!name) throw new Error("Name is required.");
  validatePassword(password);
  if (!["admin", "member", "viewer"].includes(role)) throw new Error("Invalid role.");
  if (findUserByEmail(email)) throw new Error("An account with that email already exists.");

  const userId = randomUUID();
  const projectId = randomUUID();
  const notebookId = randomUUID();
  const pageId = randomUUID();

  execSql(`
    INSERT INTO users (id, email, name, password_hash, role)
    VALUES (${sql(userId)}, ${sql(email)}, ${sql(name)}, ${sql(bcrypt.hashSync(password, 10))}, ${sql(role)});

    INSERT INTO projects (id, name, description, color, owner_id)
    VALUES (${sql(projectId)}, 'My Project', 'Personal notebook workspace.', ${sql(defaultProjectColor(projectId))}, ${sql(userId)});

    INSERT INTO project_members (project_id, user_id, role)
    VALUES (${sql(projectId)}, ${sql(userId)}, 'owner');

    INSERT INTO notebooks (id, project_id, name)
    VALUES (${sql(notebookId)}, ${sql(projectId)}, 'Notebook');

    INSERT INTO pages (id, notebook_id, title, body, status, owner_id)
    VALUES (${sql(pageId)}, ${sql(notebookId)}, 'Untitled', '', '', ${sql(userId)});

    INSERT INTO page_versions (id, page_id, summary, created_by)
    VALUES (${sql(randomUUID())}, ${sql(pageId)}, 'Created account', ${sql(userId)});
  `);
  rebuildSearchIndex();
  return { id: userId, email, name, role };
}

export function listUsersForAdmin(adminUserId: string): AdminUser[] {
  ensureDatabase();
  assertAdmin(adminUserId);
  return querySql(`
    SELECT
      u.id,
      u.email,
      u.name,
      u.role,
      u.created_at,
      COUNT(DISTINCT pm.project_id) AS project_count
    FROM users u
    LEFT JOIN project_members pm ON pm.user_id = u.id
    GROUP BY u.id
    ORDER BY lower(u.name) ASC, lower(u.email) ASC
  `).map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as UserRole,
    createdAt: row.created_at,
    projectCount: Number(row.project_count),
  }));
}

export function getAdminDataOverview(adminUserId: string): AdminDataOverview {
  ensureDatabase();
  assertAdmin(adminUserId);

  const counts = {
    users: countRows("users"),
    projects: countRows("projects"),
    notebooks: countRows("notebooks"),
    pages: countRows("pages"),
    attachments: countRows("attachments"),
    pageVersions: countRows("page_versions"),
    importJobs: countRows("import_jobs"),
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
      pr.name AS project_name,
      u.email AS owner_email
    FROM attachments a
    JOIN pages p ON p.id = a.page_id
    JOIN notebooks n ON n.id = p.notebook_id
    JOIN projects pr ON pr.id = n.project_id
    JOIN users u ON u.id = pr.owner_id
    ORDER BY a.created_at DESC, lower(a.original_name) ASC
  `).map((row) => ({
    id: row.id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    size: Number(row.size),
    blockType: row.block_type as BlockType,
    storageKey: row.storage_key,
    createdAt: row.created_at,
    projectName: row.project_name,
    notebookName: row.notebook_name,
    pageTitle: row.page_title,
    ownerEmail: row.owner_email,
  }));

  const attachmentBytes = files.reduce((total, file) => total + file.size, 0);
  const uploadFiles = listUploadFiles();
  const uploadFileKeys = new Set(uploadFiles.map((file) => file.relativePath));
  const attachmentKeys = new Set(files.map((file) => file.storageKey));
  const orphanUploadBytes = uploadFiles.reduce((total, file) => total + (attachmentKeys.has(file.relativePath) ? 0 : file.size), 0);
  const orphanUploadCount = uploadFiles.filter((file) => !attachmentKeys.has(file.relativePath)).length;
  const missingUploadCount = files.filter((file) => !uploadFileKeys.has(file.storageKey)).length;

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

  const projectRows = querySql(`
    SELECT
      p.id,
      p.name,
      p.description,
      p.color,
      p.owner_id,
      p.created_at,
      p.updated_at,
      pm.role AS project_role,
      CASE WHEN pm.user_id IS NOT NULL THEN 'project' ELSE 'notebook' END AS access_scope
    FROM projects p
    LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ${sql(userId)}
    LEFT JOIN notebooks shared_n ON shared_n.project_id = p.id
    LEFT JOIN notebook_members nm ON nm.notebook_id = shared_n.id AND nm.user_id = ${sql(userId)}
    WHERE pm.user_id IS NOT NULL OR nm.user_id IS NOT NULL
    GROUP BY p.id
    ORDER BY p.updated_at DESC, p.name ASC
  `);
  const projectIds = projectRows.map((project) => project.id);
  const notebookRows = projectIds.length
    ? querySql(`
        SELECT
          n.id,
          n.project_id,
          n.name,
          n.created_at,
          n.updated_at,
          CASE
            WHEN pm.role = 'owner' OR nm.role = 'owner' THEN 'owner'
            WHEN pm.role = 'editor' OR nm.role = 'editor' THEN 'editor'
            ELSE 'viewer'
          END AS access_role
        FROM notebooks n
        LEFT JOIN project_members pm ON pm.project_id = n.project_id AND pm.user_id = ${sql(userId)}
        LEFT JOIN notebook_members nm ON nm.notebook_id = n.id AND nm.user_id = ${sql(userId)}
        WHERE n.project_id IN (${inList(projectIds)})
          AND (pm.user_id IS NOT NULL OR nm.user_id IS NOT NULL)
        ORDER BY datetime(n.created_at) ASC, n.name ASC
      `)
    : [];
  const notebookIds = notebookRows.map((notebook) => notebook.id);
  const pageRows = notebookIds.length
    ? querySql(`
        SELECT p.id, p.notebook_id, p.title, p.body, p.status, p.owner_id, u.name AS owner_name, p.created_at, p.updated_at
        FROM pages p
        JOIN users u ON u.id = p.owner_id
        WHERE p.notebook_id IN (${inList(notebookIds)})
        ORDER BY datetime(p.created_at) DESC, p.title ASC
      `)
    : [];
  const pageIds = pageRows.map((page) => page.id);
  const tagRows = pageIds.length ? querySql(`SELECT page_id, tag FROM page_tags WHERE page_id IN (${inList(pageIds)}) ORDER BY rowid ASC`) : [];
  const attachmentRows = pageIds.length
    ? querySql(`SELECT id, page_id, original_name, mime_type, size, storage_key, block_type, preview_text, created_at FROM attachments WHERE page_id IN (${inList(pageIds)}) ORDER BY created_at DESC`)
    : [];
  const versionRows = pageIds.length
    ? querySql(`SELECT page_id, summary FROM page_versions WHERE page_id IN (${inList(pageIds)}) ORDER BY datetime(created_at) DESC, rowid DESC LIMIT 250`)
    : [];
  const projectMemberRows = projectIds.length
    ? querySql(`
        SELECT pm.project_id, pm.user_id, pm.role, u.email, u.name
        FROM project_members pm
        JOIN users u ON u.id = pm.user_id
        WHERE pm.project_id IN (${inList(projectIds)})
        ORDER BY lower(u.name) ASC, lower(u.email) ASC
      `)
    : [];
  const notebookMemberRows = notebookIds.length
    ? querySql(`
        SELECT nm.notebook_id, nm.user_id, nm.role, u.email, u.name
        FROM notebook_members nm
        JOIN users u ON u.id = nm.user_id
        WHERE nm.notebook_id IN (${inList(notebookIds)})
        ORDER BY lower(u.name) ASC, lower(u.email) ASC
      `)
    : [];

  const tagsByPage = groupBy(tagRows, "page_id");
  const attachmentsByPage = groupBy(attachmentRows, "page_id");
  const versionsByPage = groupBy(versionRows, "page_id");

  const pagesByNotebook = groupBy(pageRows, "notebook_id");
  const notebooksByProject = groupBy(notebookRows, "project_id");
  const membersByProject = groupBy(projectMemberRows, "project_id");
  const membersByNotebook = groupBy(notebookMemberRows, "notebook_id");

  const projects: Project[] = projectRows.map((project) => ({
    id: project.id,
    name: project.name,
    description: project.description,
    color: normalizeProjectColor(project.color),
    ownerId: project.owner_id,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
    accessScope: project.access_scope === "project" ? "project" : "notebook",
    accessRole: project.project_role ? normalizeAccessRole(project.project_role) : null,
    members: (membersByProject[project.id] ?? []).map(toShareMember),
    notebooks: (notebooksByProject[project.id] ?? []).map((notebook): Notebook => ({
      id: notebook.id,
      projectId: notebook.project_id,
      name: notebook.name,
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
        ownerName: page.owner_name,
        createdAt: page.created_at,
        updatedAt: page.updated_at,
        tags: pageTagRowsToList(tagsByPage[page.id] ?? []),
        attachments: (attachmentsByPage[page.id] ?? []).map(toAttachment),
        versions: (versionsByPage[page.id] ?? []).map((version) => version.summary),
      })),
    })),
  }));

  return { user, projects };
}



export function renameProject(userId: string, projectId: string, name: string) {
  ensureDatabase();
  assertProjectEditAccess(userId, projectId);
  const nextName = name.trim();
  if (!nextName) throw new Error("Project name is required");
  execSql(`UPDATE projects SET name = ${sql(nextName)}, updated_at = datetime('now') WHERE id = ${sql(projectId)};`);
  rebuildSearchIndex();
}

export function updateProjectColor(userId: string, projectId: string, color: string) {
  ensureDatabase();
  assertProjectEditAccess(userId, projectId);
  const nextColor = normalizeProjectColor(color);
  execSql(`UPDATE projects SET color = ${sql(nextColor)}, updated_at = datetime('now') WHERE id = ${sql(projectId)};`);
  rebuildSearchIndex();
}

export function deleteProject(userId: string, projectId: string) {
  ensureDatabase();
  assertProjectManageAccess(userId, projectId);
  execSql(`DELETE FROM projects WHERE id = ${sql(projectId)};`);
  rebuildSearchIndex();
}

export function createProject(userId: string, name = "New Project") {
  ensureDatabase();
  const projectId = randomUUID();
  const notebookId = randomUUID();
  const pageId = randomUUID();
  execSql(`
    INSERT INTO projects (id, name, description, color, owner_id)
    VALUES (${sql(projectId)}, ${sql(name)}, 'New notebook project.', ${sql(defaultProjectColor(projectId))}, ${sql(userId)});
    INSERT INTO project_members (project_id, user_id, role)
    VALUES (${sql(projectId)}, ${sql(userId)}, 'owner');
    INSERT INTO notebooks (id, project_id, name)
    VALUES (${sql(notebookId)}, ${sql(projectId)}, 'Notebook');
    INSERT INTO pages (id, notebook_id, title, body, status, owner_id)
    VALUES (${sql(pageId)}, ${sql(notebookId)}, 'Untitled', '', '', ${sql(userId)});
    INSERT INTO page_versions (id, page_id, summary, created_by)
    VALUES (${sql(randomUUID())}, ${sql(pageId)}, 'Created project', ${sql(userId)});
  `);
  rebuildSearchIndex();
  return { projectId, notebookId, pageId };
}

export function createNotebook(userId: string, projectId: string, name = "New Notebook") {
  ensureDatabase();
  assertProjectEditAccess(userId, projectId);
  const notebookId = randomUUID();
  const pageId = randomUUID();
  execSql(`
    INSERT INTO notebooks (id, project_id, name)
    VALUES (${sql(notebookId)}, ${sql(projectId)}, ${sql(name)});
    INSERT INTO pages (id, notebook_id, title, body, status, owner_id)
    VALUES (${sql(pageId)}, ${sql(notebookId)}, 'Untitled', '', '', ${sql(userId)});
    INSERT INTO page_versions (id, page_id, summary, created_by)
    VALUES (${sql(randomUUID())}, ${sql(pageId)}, 'Created notebook', ${sql(userId)});
    UPDATE projects SET updated_at = datetime('now') WHERE id = ${sql(projectId)};
  `);
  rebuildSearchIndex();
  return { notebookId, pageId };
}


export function renameNotebook(userId: string, notebookId: string, name: string) {
  ensureDatabase();
  assertNotebookEditAccess(userId, notebookId);
  const nextName = name.trim();
  if (!nextName) throw new Error("Notebook name is required");
  execSql(`
    UPDATE notebooks SET name = ${sql(nextName)}, updated_at = datetime('now') WHERE id = ${sql(notebookId)};
    UPDATE projects SET updated_at = datetime('now') WHERE id = (SELECT project_id FROM notebooks WHERE id = ${sql(notebookId)});
  `);
  rebuildSearchIndex();
}

export function deleteNotebook(userId: string, notebookId: string) {
  ensureDatabase();
  assertNotebookManageAccess(userId, notebookId);
  execSql(`
    DELETE FROM notebooks WHERE id = ${sql(notebookId)};
  `);
  rebuildSearchIndex();
}

export function createPage(userId: string, notebookId: string) {
  ensureDatabase();
  assertNotebookEditAccess(userId, notebookId);
  const pageId = randomUUID();
  execSql(`
    INSERT INTO pages (id, notebook_id, title, body, status, owner_id)
    VALUES (${sql(pageId)}, ${sql(notebookId)}, 'Untitled', '', '', ${sql(userId)});
    INSERT INTO page_versions (id, page_id, summary, created_by)
    VALUES (${sql(randomUUID())}, ${sql(pageId)}, 'Created page', ${sql(userId)});
    UPDATE notebooks SET updated_at = datetime('now') WHERE id = ${sql(notebookId)};
    UPDATE projects SET updated_at = datetime('now') WHERE id = (SELECT project_id FROM notebooks WHERE id = ${sql(notebookId)});
  `);
  rebuildSearchIndex();
  return pageId;
}

export function updatePage(userId: string, pageId: string, patch: { title?: string; body?: string; status?: PageStatus }) {
  ensureDatabase();
  assertPageEditAccess(userId, pageId);
  const assignments: string[] = [];
  if (patch.title !== undefined) assignments.push(`title = ${sql(patch.title)}`);
  if (patch.body !== undefined) assignments.push(`body = ${sql(patch.body)}`);
  if (patch.status !== undefined) assignments.push(`status = ${sql(normalizePageStatus(patch.status))}`);
  if (!assignments.length) return;
  assignments.push("updated_at = datetime('now')");

  const summary = patch.status !== undefined ? `Status changed to ${normalizePageStatus(patch.status) || "No status"}` : "Edited page";
  execSql(`
    UPDATE pages SET ${assignments.join(", ")} WHERE id = ${sql(pageId)};
    INSERT INTO page_versions (id, page_id, summary, created_by)
    VALUES (${sql(randomUUID())}, ${sql(pageId)}, ${sql(summary)}, ${sql(userId)});
    UPDATE notebooks SET updated_at = datetime('now') WHERE id = (SELECT notebook_id FROM pages WHERE id = ${sql(pageId)});
    UPDATE projects SET updated_at = datetime('now') WHERE id = (
      SELECT n.project_id FROM notebooks n JOIN pages p ON p.notebook_id = n.id WHERE p.id = ${sql(pageId)}
    );
  `);
  rebuildSearchIndex();
}

export function setPageTags(userId: string, pageId: string, tags: string[]) {
  ensureDatabase();
  assertPageEditAccess(userId, pageId);
  const normalizedTags = normalizePageTags(tags);
  execSql(`
    DELETE FROM page_tags WHERE page_id = ${sql(pageId)};
    ${normalizedTags.map((tag) => `INSERT INTO page_tags (page_id, tag) VALUES (${sql(pageId)}, ${sql(tag)});`).join("\n")}
    UPDATE pages SET updated_at = datetime('now') WHERE id = ${sql(pageId)};
    INSERT INTO page_versions (id, page_id, summary, created_by)
    VALUES (${sql(randomUUID())}, ${sql(pageId)}, 'Updated tags', ${sql(userId)});
    UPDATE notebooks SET updated_at = datetime('now') WHERE id = (SELECT notebook_id FROM pages WHERE id = ${sql(pageId)});
    UPDATE projects SET updated_at = datetime('now') WHERE id = (
      SELECT n.project_id FROM notebooks n JOIN pages p ON p.notebook_id = n.id WHERE p.id = ${sql(pageId)}
    );
  `);
  rebuildSearchIndex();
}

export function deletePage(userId: string, pageId: string) {
  ensureDatabase();
  assertPageEditAccess(userId, pageId);
  const page = queryOne(`
    SELECT p.notebook_id, n.project_id
    FROM pages p
    JOIN notebooks n ON n.id = p.notebook_id
    WHERE p.id = ${sql(pageId)}
    LIMIT 1
  `);
  if (!page) throw new Error("Page not found");
  execSql(`
    UPDATE notebooks SET updated_at = datetime('now') WHERE id = ${sql(page.notebook_id)};
    UPDATE projects SET updated_at = datetime('now') WHERE id = ${sql(page.project_id)};
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
  previewText: string;
}) {
  ensureDatabase();
  assertPageEditAccess(input.userId, input.pageId);
  const id = randomUUID();
  execSql(`
    INSERT INTO attachments (id, page_id, original_name, mime_type, size, storage_key, block_type, preview_text)
    VALUES (${sql(id)}, ${sql(input.pageId)}, ${sql(input.originalName)}, ${sql(input.mimeType)}, ${input.size}, ${sql(input.storageKey)}, ${sql(input.blockType)}, ${sql(input.previewText)});
    INSERT INTO page_versions (id, page_id, summary, created_by)
    VALUES (${sql(randomUUID())}, ${sql(input.pageId)}, ${sql(`Attached ${input.originalName}`)}, ${sql(input.userId)});
    UPDATE pages SET updated_at = datetime('now') WHERE id = ${sql(input.pageId)};
  `);
  rebuildSearchIndex();
  return id;
}

export function getAttachmentForUser(userId: string, attachmentId: string): Attachment | null {
  ensureDatabase();
  const row = queryOne(`
    SELECT a.id, a.page_id, a.original_name, a.mime_type, a.size, a.storage_key, a.block_type, a.preview_text, a.created_at
    FROM attachments a
    JOIN pages p ON p.id = a.page_id
    JOIN notebooks n ON n.id = p.notebook_id
    LEFT JOIN project_members pm ON pm.project_id = n.project_id AND pm.user_id = ${sql(userId)}
    LEFT JOIN notebook_members nm ON nm.notebook_id = n.id AND nm.user_id = ${sql(userId)}
    WHERE (pm.user_id IS NOT NULL OR nm.user_id IS NOT NULL) AND a.id = ${sql(attachmentId)}
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
    INSERT INTO page_versions (id, page_id, summary, created_by)
    VALUES (${sql(randomUUID())}, ${sql(attachment.pageId)}, ${sql(`Updated ${attachment.originalName}`)}, ${sql(input.userId)});
    UPDATE pages SET updated_at = datetime('now') WHERE id = ${sql(attachment.pageId)};
  `);
  rebuildSearchIndex();
  return getAttachmentForUser(input.userId, input.attachmentId);
}

export function createImportedNotebook(input: { userId: string; projectId: string; name: string }) {
  ensureDatabase();
  assertProjectEditAccess(input.userId, input.projectId);
  const notebookId = randomUUID();
  execSql(`
    INSERT INTO notebooks (id, project_id, name)
    VALUES (${sql(notebookId)}, ${sql(input.projectId)}, ${sql(input.name || "Evernote Import")});
    UPDATE projects SET updated_at = datetime('now') WHERE id = ${sql(input.projectId)};
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
  const title = input.title || "Untitled Evernote note";
  const normalizedTags = normalizePageTags(input.tags);

  if (input.replaceExisting) {
    execSql(`
      UPDATE pages
      SET title = ${sql(title)}, body = ${sql(input.body)}, created_at = ${sql(createdAt)}, updated_at = ${sql(updatedAt)}
      WHERE id = ${sql(pageId)};
      DELETE FROM page_tags WHERE page_id = ${sql(pageId)};
      ${normalizedTags.map((tag) => `INSERT INTO page_tags (page_id, tag) VALUES (${sql(pageId)}, ${sql(tag)});`).join("\n")}
      INSERT INTO page_versions (id, page_id, summary, created_by, created_at)
      VALUES (${sql(randomUUID())}, ${sql(pageId)}, 'Imported from ENEX', ${sql(input.userId)}, ${sql(updatedAt)});
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
  previewText: string;
  createdAt?: string;
}): Attachment {
  ensureDatabase();
  const id = randomUUID();
  const createdAt = input.createdAt ?? new Date().toISOString();
  execSql(`
    INSERT INTO attachments (id, page_id, original_name, mime_type, size, storage_key, block_type, preview_text, created_at)
    VALUES (${sql(id)}, ${sql(input.pageId)}, ${sql(input.originalName)}, ${sql(input.mimeType)}, ${input.size}, ${sql(input.storageKey)}, ${sql(input.blockType)}, ${sql(input.previewText)}, ${sql(createdAt)});
  `);
  return {
    id,
    pageId: input.pageId,
    originalName: input.originalName,
    mimeType: input.mimeType,
    size: input.size,
    storageKey: input.storageKey,
    blockType: input.blockType,
    previewText: input.previewText,
    createdAt,
    updatedAt: createdAt,
  };
}

export function finishImportedNotebook(projectId: string, notebookId: string) {
  ensureDatabase();
  execSql(`
    UPDATE notebooks SET updated_at = datetime('now') WHERE id = ${sql(notebookId)};
    UPDATE projects SET updated_at = datetime('now') WHERE id = ${sql(projectId)};
  `);
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
    INSERT INTO page_versions (id, page_id, summary, created_by)
    VALUES (${sql(randomUUID())}, ${sql(attachment.pageId)}, ${sql(`Deleted ${attachment.originalName}`)}, ${sql(userId)});
  `);
  rebuildSearchIndex();
  return attachment;
}

export function shareProject(input: { actorUserId: string; projectId: string; email: string; role: AccessRole }) {
  ensureDatabase();
  assertProjectManageAccess(input.actorUserId, input.projectId);
  const user = findUserByEmail(input.email.trim().toLowerCase());
  if (!user) throw new Error("User not found");
  const role = normalizeInputAccessRole(input.role);
  execSql(`
    INSERT INTO project_members (project_id, user_id, role)
    VALUES (${sql(input.projectId)}, ${sql(user.id)}, ${sql(role)})
    ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role;
  `);
  return user;
}

export function unshareProject(actorUserId: string, projectId: string, targetUserId: string) {
  ensureDatabase();
  assertProjectManageAccess(actorUserId, projectId);
  const ownerCount = Number(queryOne(`SELECT COUNT(*) AS count FROM project_members WHERE project_id = ${sql(projectId)} AND role = 'owner'`)?.count ?? 0);
  const targetRole = queryOne(`SELECT role FROM project_members WHERE project_id = ${sql(projectId)} AND user_id = ${sql(targetUserId)} LIMIT 1`)?.role;
  if (targetRole === "owner" && ownerCount <= 1) throw new Error("Projects need at least one owner.");
  execSql(`DELETE FROM project_members WHERE project_id = ${sql(projectId)} AND user_id = ${sql(targetUserId)};`);
}

export function shareNotebook(input: { actorUserId: string; notebookId: string; email: string; role: AccessRole }) {
  ensureDatabase();
  assertNotebookManageAccess(input.actorUserId, input.notebookId);
  const user = findUserByEmail(input.email.trim().toLowerCase());
  if (!user) throw new Error("User not found");
  const role = normalizeInputAccessRole(input.role);
  execSql(`
    INSERT INTO notebook_members (notebook_id, user_id, role)
    VALUES (${sql(input.notebookId)}, ${sql(user.id)}, ${sql(role)})
    ON CONFLICT(notebook_id, user_id) DO UPDATE SET role = excluded.role;
  `);
  return user;
}

export function unshareNotebook(actorUserId: string, notebookId: string, targetUserId: string) {
  ensureDatabase();
  assertNotebookManageAccess(actorUserId, notebookId);
  execSql(`DELETE FROM notebook_members WHERE notebook_id = ${sql(notebookId)} AND user_id = ${sql(targetUserId)};`);
}

export function importNotebook(input: {
  userId: string;
  projectId: string;
  notebookName: string;
  pages: Array<{ title: string; body: string; tags: string[] }>;
}) {
  ensureDatabase();
  assertProjectEditAccess(input.userId, input.projectId);
  const notebookId = randomUUID();
  execSql(`INSERT INTO notebooks (id, project_id, name) VALUES (${sql(notebookId)}, ${sql(input.projectId)}, ${sql(input.notebookName)});`);
  for (const note of input.pages) {
    const pageId = randomUUID();
    execSql(`
      INSERT INTO pages (id, notebook_id, title, body, status, owner_id)
      VALUES (${sql(pageId)}, ${sql(notebookId)}, ${sql(note.title || "Untitled Evernote note")}, ${sql(note.body)}, '', ${sql(input.userId)});
      ${note.tags.map((tag) => `INSERT OR IGNORE INTO page_tags (page_id, tag) VALUES (${sql(pageId)}, ${sql(tag)});`).join("\n")}
      INSERT INTO page_versions (id, page_id, summary, created_by)
      VALUES (${sql(randomUUID())}, ${sql(pageId)}, 'Imported from ENEX', ${sql(input.userId)});
    `);
  }
  execSql(`UPDATE projects SET updated_at = datetime('now') WHERE id = ${sql(input.projectId)};`);
  rebuildSearchIndex();
  return notebookId;
}

function normalizePageStatus(value: unknown): PageStatus {
  if (value === "Final") return "Completed";
  if (value === "Draft" || value === null || value === undefined) return "";
  if (value === "Working" || value === "Needs review" || value === "Completed" || value === "Failed") return value;
  return "";
}

function assertProjectEditAccess(userId: string, projectId: string) {
  if (isAdmin(userId)) return;
  const role = queryOne(`SELECT role FROM project_members WHERE user_id = ${sql(userId)} AND project_id = ${sql(projectId)} LIMIT 1`)?.role;
  if (roleRank(normalizeAccessRole(role)) < roleRank("editor")) throw new Error("Forbidden");
}

function assertProjectManageAccess(userId: string, projectId: string) {
  if (isAdmin(userId)) return;
  const role = queryOne(`SELECT role FROM project_members WHERE user_id = ${sql(userId)} AND project_id = ${sql(projectId)} LIMIT 1`)?.role;
  if (normalizeAccessRole(role) !== "owner") throw new Error("Only owners can manage sharing.");
}

function assertNotebookEditAccess(userId: string, notebookId: string) {
  if (isAdmin(userId)) return;
  const row = queryOne(`
    SELECT CASE
      WHEN pm.role = 'owner' OR nm.role = 'owner' THEN 'owner'
      WHEN pm.role = 'editor' OR nm.role = 'editor' THEN 'editor'
      ELSE 'viewer'
    END AS role
    FROM notebooks n
    LEFT JOIN project_members pm ON pm.project_id = n.project_id AND pm.user_id = ${sql(userId)}
    LEFT JOIN notebook_members nm ON nm.notebook_id = n.id AND nm.user_id = ${sql(userId)}
    WHERE n.id = ${sql(notebookId)}
    LIMIT 1
  `);
  if (roleRank(normalizeAccessRole(row?.role)) < roleRank("editor")) throw new Error("Forbidden");
}

function assertNotebookManageAccess(userId: string, notebookId: string) {
  if (isAdmin(userId)) return;
  const row = queryOne(`
    SELECT CASE
      WHEN pm.role = 'owner' OR nm.role = 'owner' THEN 'owner'
      WHEN pm.role = 'editor' OR nm.role = 'editor' THEN 'editor'
      ELSE 'viewer'
    END AS role
    FROM notebooks n
    LEFT JOIN project_members pm ON pm.project_id = n.project_id AND pm.user_id = ${sql(userId)}
    LEFT JOIN notebook_members nm ON nm.notebook_id = n.id AND nm.user_id = ${sql(userId)}
    WHERE n.id = ${sql(notebookId)}
    LIMIT 1
  `);
  if (normalizeAccessRole(row?.role) !== "owner") throw new Error("Only owners can manage sharing.");
}

function assertPageEditAccess(userId: string, pageId: string) {
  if (isAdmin(userId)) return;
  const row = queryOne(`
    SELECT CASE
      WHEN pm.role = 'owner' OR nm.role = 'owner' THEN 'owner'
      WHEN pm.role = 'editor' OR nm.role = 'editor' THEN 'editor'
      ELSE 'viewer'
    END AS role
    FROM pages p
    JOIN notebooks n ON n.id = p.notebook_id
    LEFT JOIN project_members pm ON pm.project_id = n.project_id AND pm.user_id = ${sql(userId)}
    LEFT JOIN notebook_members nm ON nm.notebook_id = n.id AND nm.user_id = ${sql(userId)}
    WHERE p.id = ${sql(pageId)}
    LIMIT 1
  `);
  if (roleRank(normalizeAccessRole(row?.role)) < roleRank("editor")) throw new Error("Forbidden");
}

function assertAttachmentEditAccess(userId: string, attachmentId: string) {
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

function normalizeProjectColor(value: string | undefined) {
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

function toShareMember(row: Record<string, string>): ShareMember {
  return {
    userId: row.user_id,
    email: row.email,
    name: row.name,
    role: normalizeAccessRole(row.role),
  };
}

function defaultProjectColor(seed: string) {
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
    previewText: row.preview_text,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}
