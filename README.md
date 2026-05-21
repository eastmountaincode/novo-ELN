# MGH ELN Workspace

A focused Evernote replacement prototype for lab notebooks. The app uses notebooks and pages, with editable notes, inline file/data blocks, attachments, metadata, sharing, page locking, and activity history.

## Current Foundation

- Next.js App Router + Tailwind UI
- Cookie-based credential auth
- SQLite relational database for users, notebooks, pages, permissions, attachments, tags, and audit events
- Local filesystem attachment storage under `storage/uploads`
- ENEX import endpoint that creates a notebook from Evernote notes
- Vitest tests for ENEX parsing and database repository behavior

## Docker Development

The easiest way to run a clean clone is Docker Compose. This avoids installing Node, LibreOffice, Poppler, or SQLite on the host.

```bash
git clone https://github.com/eastmountaincode/novo-ELN.git
cd novo-ELN
docker compose -f docker-compose.dev.yml up --build
```

Then open:

```text
http://localhost:3155
```

The dev compose file runs Next.js in development mode and bind-mounts the source tree, so code edits are picked up without rebuilding the image. Local Docker runtime state is stored in `runtime-dev/`, which is git-ignored. It sets an explicit development-only `ELN_SESSION_SECRET`; use your own secret before any shared deployment.

Stop the container:

```bash
docker compose -f docker-compose.dev.yml down
```

Reset local Docker data:

```bash
docker compose -f docker-compose.dev.yml down -v
rm -rf runtime-dev
```

Novo does not create a bootstrap admin account. Register a real user through the app, then explicitly promote that account when admin access is needed:

```bash
docker compose -f docker-compose.dev.yml exec novo sqlite3 /app-data/data/eln.sqlite3 \
  "UPDATE users SET role='admin' WHERE lower(email)=lower('you@example.com');"
```

## Production Docker

The production compose file builds the app and runs `next start`:

```bash
cp .env.example .env.production
# Edit .env.production before using this on a shared server.
# ELN_SESSION_SECRET must be at least 32 random characters.
docker compose -f docker-compose.prod.yml up -d --build

# After registering the first real account, promote it if it should administer Novo.
docker compose -f docker-compose.prod.yml exec novo sqlite3 /app-data/data/eln.sqlite3 \
  "UPDATE users SET role='admin' WHERE lower(email)=lower('you@example.com');"
```

Production runtime state is stored in `runtime/`, which is git-ignored.

## Local NPM Development

Set `ELN_SESSION_SECRET` in `.env.local` or the shell before logging in or registering:

```bash
ELN_SESSION_SECRET=replace-this-with-at-least-32-random-characters npm run dev -- --hostname 127.0.0.1 --port 3155
```

From your local machine, tunnel the remote dev server:

```bash
ssh -L 3155:127.0.0.1:3155 aboylan@ccib-aorus2.partners.org
```

Then open http://localhost:3155.

## Runtime Data

By default, local runtime state stays in this project directory and is git-ignored:

```text
data/eln.sqlite3
storage/uploads/
```

Override with `ELN_DATABASE_PATH`, `ELN_DATA_DIR`, and `ELN_UPLOAD_DIR` if you want persistent data elsewhere.

## Checks

```bash
npm run lint
npm test
npm run build
```

Next implementation steps: export workflows, production backup automation, import validation for large ENEX files, and continued audit-log hardening.
