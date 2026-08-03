# Novo

Novo is an electronic lab notebook for organizing notebooks, pages, attachments, metadata, sharing, page locking, search, and activity history.

## Features

- Notebook and page organization
- Rich-text page editing
- Inline file and data blocks
- Attachment storage and previews
- Tags and page status
- Notebook sharing with owner, editor, and viewer roles
- Page locking
- Audit/activity history
- Docker-based deployment

## Technology

- Next.js App Router
- Tailwind CSS
- Cookie-based credential authentication
- SQLite relational database
- Local filesystem attachment storage under `runtime/uploads`
- Docker Compose for repeatable setup

## Docker

The normal way to run Novo is Docker Compose. This avoids installing Node, LibreOffice, Poppler, or SQLite directly on the host.

```bash
git clone <repo-url>
cd <repo-directory>
cp .env.example .env.local
```

Edit `.env.local` and set `ELN_SESSION_SECRET` to a long random value of at least 32 characters.
Set `NOVO_INSTANCE=prod` for a production instance.

Then start the app:

```bash
docker compose up -d --build
```

Open:

```text
http://localhost:3148
```

Stop the container:

```bash
docker compose down
```

Update after pulling new code:

```bash
git pull
scripts/deploy-production.sh <tested-git-commit-sha>
```

For active development with hot reload and `Novo-dev` branding:

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

The development server listens on `127.0.0.1:3155`. See `ops/deployment/README.md` for the AORUS to GitHub to CCIB staging and production promotion workflow.

## Admin Access

Novo does not create a bootstrap admin account. Register a real user through the app, then explicitly promote that account when admin access is needed:

```bash
docker compose exec novo sqlite3 /app-data/data/eln.sqlite3 \
  "UPDATE users SET role='admin' WHERE lower(email)=lower('you@example.com');"
```

## Runtime Data

Runtime state is stored in `runtime/`, which is git-ignored. Rebuilding or replacing the container keeps that data.

Default runtime paths:

```text
runtime/data/eln.sqlite3
runtime/uploads/
runtime/previews/
```

Inside Docker these are mounted at `/app-data`. Override with `ELN_DATABASE_PATH`, `ELN_DATA_DIR`, and `ELN_UPLOAD_DIR` only if you are deliberately running outside the provided compose file.

## Optional Novo Chat integration

Novo Chat is an optional companion service. Ordinary Novo deployments leave
`NOVO_INTEGRATION_SECRET_FILE` and `NOVO_CHAT_URL` unset. To enable the narrow,
read-only integration API in a deployed container, set
`NOVO_INTEGRATION_SECRET_FILE=/run/secrets/novo-integration` in that instance's
service environment file. Keep the actual secret in a readable, non-empty file
outside the Git checkout and export only its host path as
`NOVO_INTEGRATION_SECRET_HOST_FILE` before running the deployment script. The
script then adds `docker-compose.chat.yml`, which mounts the file as a Compose
secret without copying its contents into an environment variable or image.

Set `NOVO_CHAT_URL` to a same-origin path such as `/chat/` only when the
companion route is deployed and should appear in Novo navigation. If all Chat
settings remain unset, deployment uses only the base Compose file exactly as
before. Never expose `/api/integrations/` through the public reverse proxy.

## Optional ER Flow schema diagrams

Admins can sync the current SQLite schema from Account Settings -> Schema. ER
Flow sync is optional. To connect it, create an ER Flow data model in your own
ER Flow account and set:

```text
ELN_ERFLOW_MODEL=https://app.erflow.io/mcp/data-model/YOUR_MODEL_UUID
ELN_ERFLOW_VIEW_URL=https://app.erflow.io/share/YOUR_VIEW_ONLY_LINK
```

`ELN_ERFLOW_MODEL` can also be just the model UUID. Treat it as a write
credential for that ER Flow model and keep it server-side. Do not commit it.
`ELN_ERFLOW_VIEW_URL` is the admin-facing URL shown by the Open ER Flow button.
Without these variables, Novo disables ER Flow sync.

## Backups

Backups should include both the SQLite database and uploaded attachment files. See `ops/backup/README.md` for the Dockerized BorgBackup workflow and restore-test notes.

## Checks

```bash
npm run lint
npm test
npm run build
```
