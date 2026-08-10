import { execSql } from "./sqlite";

export function ensurePostgresDatabase() {
  execSql(`
    CREATE OR REPLACE FUNCTION novo_now_text(offset_seconds integer DEFAULT 0)
    RETURNS text
    LANGUAGE sql
    STABLE
    AS $$
      SELECT to_char((clock_timestamp() AT TIME ZONE 'UTC') + make_interval(secs => offset_seconds), 'YYYY-MM-DD HH24:MI:SS')
    $$;

    CREATE OR REPLACE FUNCTION novo_datetime_text(value text)
    RETURNS timestamptz
    LANGUAGE sql
    IMMUTABLE
    AS $$
      SELECT CASE
        WHEN value IS NULL OR btrim(value) = '' THEN NULL
        ELSE value::timestamptz
      END
    $$;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      last_login_at TEXT,
      created_at TEXT NOT NULL DEFAULT novo_now_text()
    );

    CREATE TABLE IF NOT EXISTS login_attempts (
      email TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      failed_count INTEGER NOT NULL,
      first_failed_at BIGINT NOT NULL,
      last_failed_at BIGINT NOT NULL,
      PRIMARY KEY (email, ip_address)
    );

    CREATE TABLE IF NOT EXISTS user_signing_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      algorithm TEXT NOT NULL,
      public_key TEXT NOT NULL,
      public_key_fingerprint TEXT NOT NULL,
      encrypted_private_key TEXT,
      kdf TEXT NOT NULL,
      kdf_salt TEXT NOT NULL,
      encryption_nonce TEXT NOT NULL,
      encryption_tag TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT novo_now_text(),
      revoked_at TEXT,
      revocation_reason TEXT
    );

    CREATE INDEX IF NOT EXISTS user_signing_keys_user_idx ON user_signing_keys(user_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS user_signing_keys_one_active_idx ON user_signing_keys(user_id) WHERE revoked_at IS NULL;

    CREATE TABLE IF NOT EXISTS notebooks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      color TEXT NOT NULL DEFAULT '#0891b2',
      page_title_template TEXT NOT NULL DEFAULT '',
      page_title_template_enabled INTEGER NOT NULL DEFAULT 0,
      content_revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT novo_now_text(),
      updated_at TEXT NOT NULL DEFAULT novo_now_text()
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
      created_at TEXT NOT NULL DEFAULT novo_now_text(),
      updated_at TEXT NOT NULL DEFAULT novo_now_text()
    );

    CREATE TABLE IF NOT EXISTS page_signatures (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
      signer_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      signer_email TEXT NOT NULL,
      signer_first_name TEXT NOT NULL DEFAULT '',
      signer_last_name TEXT NOT NULL DEFAULT '',
      signing_key_id TEXT NOT NULL REFERENCES user_signing_keys(id) ON DELETE RESTRICT,
      signing_key_algorithm TEXT NOT NULL,
      signing_public_key TEXT NOT NULL,
      signing_public_key_fingerprint TEXT NOT NULL,
      record_hash_algorithm TEXT NOT NULL,
      record_hash TEXT NOT NULL,
      signature_algorithm TEXT NOT NULL,
      signature_payload TEXT NOT NULL,
      signature TEXT NOT NULL,
      record_manifest_json TEXT NOT NULL,
      record_package_storage_key TEXT NOT NULL DEFAULT '',
      record_package_bytes INTEGER NOT NULL DEFAULT 0,
      record_package_sha256 TEXT NOT NULL DEFAULT '',
      finalization_package_storage_key TEXT NOT NULL DEFAULT '',
      finalization_package_bytes INTEGER NOT NULL DEFAULT 0,
      finalization_package_sha256 TEXT NOT NULL DEFAULT '',
      proof_hash_algorithm TEXT NOT NULL DEFAULT '',
      proof_hash TEXT NOT NULL DEFAULT '',
      proof_package_json TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT novo_now_text()
    );

    CREATE INDEX IF NOT EXISTS page_signatures_page_idx ON page_signatures(page_id, created_at);
    CREATE INDEX IF NOT EXISTS page_signatures_notebook_idx ON page_signatures(notebook_id, created_at);
    CREATE INDEX IF NOT EXISTS page_signatures_signer_idx ON page_signatures(signer_user_id, created_at);
    CREATE INDEX IF NOT EXISTS page_signatures_key_idx ON page_signatures(signing_key_id, created_at);
    CREATE INDEX IF NOT EXISTS page_signatures_record_hash_idx ON page_signatures(record_hash);
    CREATE INDEX IF NOT EXISTS page_signatures_proof_hash_idx ON page_signatures(proof_hash);

    CREATE TABLE IF NOT EXISTS page_signature_timestamps (
      id TEXT PRIMARY KEY,
      page_signature_id TEXT NOT NULL REFERENCES page_signatures(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      tsa_url TEXT NOT NULL,
      hash_algorithm TEXT NOT NULL,
      message_imprint TEXT NOT NULL,
      request_der_base64 TEXT NOT NULL,
      response_der_base64 TEXT NOT NULL,
      status TEXT NOT NULL,
      status_message TEXT NOT NULL DEFAULT '',
      policy_oid TEXT NOT NULL DEFAULT '',
      serial_number TEXT NOT NULL DEFAULT '',
      tsa_time TEXT NOT NULL DEFAULT '',
      tsa_subject TEXT NOT NULL DEFAULT '',
      tsa_cert_fingerprint TEXT NOT NULL DEFAULT '',
      verified_at TEXT,
      error_message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT novo_now_text()
    );

    CREATE INDEX IF NOT EXISTS page_signature_timestamps_signature_idx ON page_signature_timestamps(page_signature_id, created_at);
    CREATE INDEX IF NOT EXISTS page_signature_timestamps_message_imprint_idx ON page_signature_timestamps(message_imprint);

    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS tags_label_unique_idx ON tags ((lower(label)));

    CREATE TABLE IF NOT EXISTS page_tags (
      page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (page_id, tag_id)
    );

    CREATE INDEX IF NOT EXISTS page_tags_page_idx ON page_tags(page_id);
    CREATE INDEX IF NOT EXISTS page_tags_tag_idx ON page_tags(tag_id);

    CREATE TABLE IF NOT EXISTS page_comment_threads (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      created_by TEXT REFERENCES users(id),
      selected_text TEXT NOT NULL DEFAULT '',
      resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT novo_now_text(),
      updated_at TEXT NOT NULL DEFAULT novo_now_text()
    );

    CREATE INDEX IF NOT EXISTS page_comment_threads_page_idx ON page_comment_threads(page_id, updated_at);

    CREATE TABLE IF NOT EXISTS page_comments (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES page_comment_threads(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id),
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT novo_now_text(),
      updated_at TEXT NOT NULL DEFAULT novo_now_text()
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
      created_at TEXT NOT NULL DEFAULT novo_now_text()
    );

    CREATE INDEX IF NOT EXISTS attachments_evernote_hash_idx ON attachments(evernote_hash);

    CREATE TABLE IF NOT EXISTS attachment_annotations (
      attachment_id TEXT PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
      page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      data_json TEXT NOT NULL DEFAULT '{"items":[]}',
      updated_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT novo_now_text(),
      updated_at TEXT NOT NULL DEFAULT novo_now_text()
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
      created_at TEXT NOT NULL DEFAULT novo_now_text(),
      updated_at TEXT NOT NULL DEFAULT novo_now_text()
    );

    CREATE INDEX IF NOT EXISTS audit_events_page_idx ON audit_events(page_id, updated_at);
    CREATE INDEX IF NOT EXISTS audit_events_notebook_idx ON audit_events(notebook_id, updated_at);
    CREATE INDEX IF NOT EXISTS audit_events_actor_idx ON audit_events(actor_user_id, updated_at);
    CREATE INDEX IF NOT EXISTS audit_events_updated_idx ON audit_events(updated_at);

    CREATE TABLE IF NOT EXISTS search_index_queue (
      page_id TEXT PRIMARY KEY,
      queued_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS search_pages_fts (
      page_id TEXT PRIMARY KEY,
      notebook_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '',
      attachments TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS search_pages_fts_notebook_idx ON search_pages_fts(notebook_id);
    CREATE INDEX IF NOT EXISTS search_pages_fts_updated_idx ON search_pages_fts(updated_at);

    CREATE TABLE IF NOT EXISTS search_pages_vocab (
      term TEXT PRIMARY KEY,
      doc INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT novo_now_text()
    );

    INSERT INTO app_settings (key, value)
    VALUES ('prepend_date_to_new_pages', '1')
    ON CONFLICT (key) DO NOTHING;

    INSERT INTO app_settings (key, value)
    VALUES ('suggest_tags_globally', '1')
    ON CONFLICT (key) DO NOTHING;
  `);

  ensurePostgresContentRevisionTriggers();
}

function ensurePostgresContentRevisionTriggers() {
  execSql(`
    CREATE OR REPLACE FUNCTION novo_increment_notebook_revision(target_notebook_id text)
    RETURNS void
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF target_notebook_id IS NULL OR target_notebook_id = '' THEN
        RETURN;
      END IF;

      UPDATE notebooks
      SET content_revision = content_revision + 1
      WHERE id = target_notebook_id;
    END;
    $$;

    CREATE OR REPLACE FUNCTION novo_touch_notebook_revision_for_notebook()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF OLD.name IS DISTINCT FROM NEW.name THEN
        PERFORM novo_increment_notebook_revision(NEW.id);
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE OR REPLACE FUNCTION novo_touch_notebook_revision_for_page()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        PERFORM novo_increment_notebook_revision(NEW.notebook_id);
        RETURN NEW;
      ELSIF TG_OP = 'DELETE' THEN
        PERFORM novo_increment_notebook_revision(OLD.notebook_id);
        RETURN OLD;
      ELSIF OLD.notebook_id IS DISTINCT FROM NEW.notebook_id
        OR OLD.title IS DISTINCT FROM NEW.title
        OR OLD.body IS DISTINCT FROM NEW.body
        OR OLD.status IS DISTINCT FROM NEW.status
        OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
        PERFORM novo_increment_notebook_revision(OLD.notebook_id);
        PERFORM novo_increment_notebook_revision(NEW.notebook_id);
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE OR REPLACE FUNCTION novo_touch_notebook_revision_for_page_tag()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      target_page_id text;
    BEGIN
      IF TG_OP = 'INSERT' THEN
        target_page_id := NEW.page_id;
      ELSE
        target_page_id := OLD.page_id;
      END IF;

      PERFORM novo_increment_notebook_revision(p.notebook_id)
      FROM pages p
      WHERE p.id = target_page_id;

      IF TG_OP = 'UPDATE' AND OLD.page_id IS DISTINCT FROM NEW.page_id THEN
        PERFORM novo_increment_notebook_revision(p.notebook_id)
        FROM pages p
        WHERE p.id = NEW.page_id;
      END IF;

      IF TG_OP = 'DELETE' THEN
        RETURN OLD;
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE OR REPLACE FUNCTION novo_touch_notebook_revision_for_tag()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF OLD.label IS DISTINCT FROM NEW.label THEN
        UPDATE notebooks
        SET content_revision = content_revision + 1
        WHERE id IN (
          SELECT DISTINCT p.notebook_id
          FROM page_tags pt
          JOIN pages p ON p.id = pt.page_id
          WHERE pt.tag_id = NEW.id
        );
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE OR REPLACE FUNCTION novo_touch_notebook_revision_for_attachment()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      target_page_id text;
    BEGIN
      IF TG_OP = 'INSERT' THEN
        target_page_id := NEW.page_id;
      ELSE
        target_page_id := OLD.page_id;
      END IF;

      PERFORM novo_increment_notebook_revision(p.notebook_id)
      FROM pages p
      WHERE p.id = target_page_id;

      IF TG_OP = 'UPDATE' AND OLD.page_id IS DISTINCT FROM NEW.page_id THEN
        PERFORM novo_increment_notebook_revision(p.notebook_id)
        FROM pages p
        WHERE p.id = NEW.page_id;
      END IF;

      IF TG_OP = 'DELETE' THEN
        RETURN OLD;
      END IF;
      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS novo_content_revision_notebook_name ON notebooks;
    DROP TRIGGER IF EXISTS novo_content_revision_page_insert ON pages;
    DROP TRIGGER IF EXISTS novo_content_revision_page_delete ON pages;
    DROP TRIGGER IF EXISTS novo_content_revision_page_update ON pages;
    DROP TRIGGER IF EXISTS novo_content_revision_page_tag_insert ON page_tags;
    DROP TRIGGER IF EXISTS novo_content_revision_page_tag_delete ON page_tags;
    DROP TRIGGER IF EXISTS novo_content_revision_page_tag_update ON page_tags;
    DROP TRIGGER IF EXISTS novo_content_revision_tag_label ON tags;
    DROP TRIGGER IF EXISTS novo_content_revision_attachment_insert ON attachments;
    DROP TRIGGER IF EXISTS novo_content_revision_attachment_delete ON attachments;
    DROP TRIGGER IF EXISTS novo_content_revision_attachment_update ON attachments;

    CREATE TRIGGER novo_content_revision_notebook_name
    AFTER UPDATE OF name ON notebooks
    FOR EACH ROW
    EXECUTE FUNCTION novo_touch_notebook_revision_for_notebook();

    CREATE TRIGGER novo_content_revision_page_insert
    AFTER INSERT ON pages
    FOR EACH ROW
    EXECUTE FUNCTION novo_touch_notebook_revision_for_page();

    CREATE TRIGGER novo_content_revision_page_delete
    AFTER DELETE ON pages
    FOR EACH ROW
    EXECUTE FUNCTION novo_touch_notebook_revision_for_page();

    CREATE TRIGGER novo_content_revision_page_update
    AFTER UPDATE OF notebook_id, title, body, status, created_at ON pages
    FOR EACH ROW
    EXECUTE FUNCTION novo_touch_notebook_revision_for_page();

    CREATE TRIGGER novo_content_revision_page_tag_insert
    AFTER INSERT ON page_tags
    FOR EACH ROW
    EXECUTE FUNCTION novo_touch_notebook_revision_for_page_tag();

    CREATE TRIGGER novo_content_revision_page_tag_delete
    AFTER DELETE ON page_tags
    FOR EACH ROW
    EXECUTE FUNCTION novo_touch_notebook_revision_for_page_tag();

    CREATE TRIGGER novo_content_revision_page_tag_update
    AFTER UPDATE OF page_id, tag_id ON page_tags
    FOR EACH ROW
    EXECUTE FUNCTION novo_touch_notebook_revision_for_page_tag();

    CREATE TRIGGER novo_content_revision_tag_label
    AFTER UPDATE OF label ON tags
    FOR EACH ROW
    EXECUTE FUNCTION novo_touch_notebook_revision_for_tag();

    CREATE TRIGGER novo_content_revision_attachment_insert
    AFTER INSERT ON attachments
    FOR EACH ROW
    EXECUTE FUNCTION novo_touch_notebook_revision_for_attachment();

    CREATE TRIGGER novo_content_revision_attachment_delete
    AFTER DELETE ON attachments
    FOR EACH ROW
    EXECUTE FUNCTION novo_touch_notebook_revision_for_attachment();

    CREATE TRIGGER novo_content_revision_attachment_update
    AFTER UPDATE OF page_id, original_name, mime_type, size, storage_key, block_type ON attachments
    FOR EACH ROW
    EXECUTE FUNCTION novo_touch_notebook_revision_for_attachment();
  `);
}
