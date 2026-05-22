# MGH ELN Workspace

A focused Evernote replacement prototype for lab notebooks. The app uses notebooks and pages, with editable notes, inline file/data blocks, attachments, metadata, sharing, page locking, and activity history.

## Current Foundation

- Next.js App Router + Tailwind UI
- Cookie-based credential auth
- SQLite relational database for users, notebooks, pages, permissions, attachments, tags, and audit events
- Local filesystem attachment storage under `runtime/uploads`
- ENEX import endpoint that creates a notebook from Evernote notes
- Vitest tests for ENEX parsing and database repository behavior

## Docker

The normal way to run Novo is Docker Compose. This avoids installing Node, LibreOffice, Poppler, or SQLite on the host.

```bash
git clone https://github.com/eastmountaincode/novo-ELN.git
cd novo-ELN
cp .env.example .env.local
# Edit .env.local so ELN_SESSION_SECRET is at least 32 random characters.
docker compose up -d --build
```

Then open:

```text
http://localhost:3155
```

Stop the container:

```bash
docker compose down
```

Update after pulling new code:

```bash
git pull
docker compose up -d --build
```

Novo does not create a bootstrap admin account. Register a real user through the app, then explicitly promote that account when admin access is needed:

```bash
docker compose exec novo sqlite3 /app-data/data/eln.sqlite3 \
  "UPDATE users SET role='admin' WHERE lower(email)=lower('you@example.com');"
```

Runtime state is stored in `runtime/`, which is git-ignored. Rebuilding or replacing the container keeps that data.

From your local machine, tunnel the remote app:

```bash
ssh -L 3155:127.0.0.1:3155 aboylan@ccib-aorus2.partners.org
```

Then open http://localhost:3155.

## Runtime Data

By default, local runtime state stays in this project directory and is git-ignored:

```text
runtime/data/eln.sqlite3
runtime/uploads/
runtime/previews/
```

Inside Docker these are mounted at `/app-data`. Override with `ELN_DATABASE_PATH`, `ELN_DATA_DIR`, and `ELN_UPLOAD_DIR` only if you are deliberately running outside the provided compose file.

## Checks

```bash
npm run lint
npm test
npm run build
```

Next implementation steps: export workflows, production backup automation, import validation for large ENEX files, and continued audit-log hardening.
