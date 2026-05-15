# MGH ELN Workspace

A focused Evernote replacement prototype for lab notebooks. The app intentionally uses a simple hierarchy:

1. Project or binder
2. Notebook
3. Page

Pages contain editable notes, inline file/data blocks, attachments, basic metadata, and version history. The MVP is scoped around replacing Evernote workflows, not cloning eLabFTW features such as schedulers, bookable resources, procurement, inventory, or blockchain timestamping.

## Current Foundation

- Next.js App Router + Tailwind UI
- Cookie-based credential auth
- SQLite relational database for users, projects, notebooks, pages, permissions, attachments, tags, and versions
- Local filesystem attachment storage under `storage/uploads`
- ENEX import endpoint that creates a notebook from Evernote notes
- Vitest tests for ENEX parsing and database repository behavior

Default local bootstrap login:

```text
andrew@example.local
development-only-password
```

Override these before any shared deployment with `ELN_BOOTSTRAP_EMAIL`, `ELN_BOOTSTRAP_PASSWORD`, and `ELN_SESSION_SECRET`.

## Development

```bash
npm run dev -- --hostname 127.0.0.1 --port 3155
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

Next implementation steps: project/notebook creation screens, user administration, attachment download/preview routes, richer ENEX resource import, and real spreadsheet/PDF/sequence previewers.
