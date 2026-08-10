# Novo Postgres Migration

Novo still defaults to SQLite. Postgres is opt-in with:

```text
ELN_DATABASE_CLIENT=postgres
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE
```

Do not cut production over until the same snapshot has been rehearsed on staging.

## Local Or Staging Rehearsal

Start a Postgres-backed development stack:

```bash
docker compose -f docker-compose.dev.yml -f docker-compose.postgres.yml up -d --build
```

Wait for Novo to become ready. Server startup initializes the Postgres schema before accepting requests. The compose override exposes Postgres on localhost port `55432` by default, so the matching local migration URL is:

```bash
export DATABASE_URL="postgresql://novo:novo-dev-password@127.0.0.1:${NOVO_POSTGRES_HOST_PORT:-55432}/novo"
```

Copy a SQLite snapshot into the initialized Postgres database:

```bash
npm run db:migrate:postgres -- \
  --sqlite runtime/data/eln.sqlite3 \
  --database-url "$DATABASE_URL" \
  --truncate-target
```

Then restart Novo with Postgres enabled. The migration clears derived search tables; the first database-backed request rebuilds `search_pages_fts` from pages, tags, and attachment metadata. During cutover, keep traffic closed until a warm-up request has completed and `search_pages_fts` has the same row count as `pages`.

## Production Cutover Shape

Create an ignored `.env.postgres` from `.env.postgres.example`, use a unique
URL-safe password, and set `ELN_DATABASE_CLIENT=postgres` in the service
environment only when the target database is ready. The deployment scripts
then include `docker-compose.postgres.yml` automatically.

1. Stop write traffic or put the current instance in maintenance.
2. Run `scripts/backup-sqlite.sh` and keep the manifest plus snapshot.
3. Create the Postgres database and set the production `DATABASE_URL`.
4. Start Novo with `ELN_DATABASE_CLIENT=postgres` and wait for readiness so schema creation runs.
5. Run `npm run db:migrate:postgres -- --sqlite <snapshot> --database-url "$DATABASE_URL" --truncate-target`.
6. Start the production container with `ELN_DATABASE_CLIENT=postgres`.
7. Run one authenticated warm-up request while traffic is still closed, then confirm `SELECT COUNT(*) FROM search_pages_fts` matches `SELECT COUNT(*) FROM pages`.
8. Verify login, workspace load, page read/write on an unfinalized page, attachment download, search, admin schema, ER Flow sync, and finalization package download.

After cutover, run the Borg job with the Postgres environment so it creates a
validated custom-format dump and archives it with uploads, previews, and proofs:

```bash
docker compose --env-file .env.postgres -f docker-compose.backup.yml run --rm novo-borg-backup
```

For a staging backup rehearsal, set `NOVO_RUNTIME_HOST_DIR=./runtime-staging` so
the job archives the staging file runtime instead of the production default.

Restore that dump into a disposable database and compare table counts before
considering the cutover complete.

Rollback is switching the service environment back to `ELN_DATABASE_CLIENT=sqlite` and the preserved SQLite runtime data. Do not delete the SQLite snapshot until Postgres has survived a full backup cycle and a restore test.

## Current Limits

The first Postgres runtime uses Novo's existing synchronous database boundary through `psql`, so it removes SQLite's file-level write lock but is not yet a pooled Node Postgres client. The search path is functional but does not yet reproduce SQLite FTS5 fuzzy vocabulary ranking. A later pass should replace this with a pooled `pg` client and Postgres full-text vectors.
