# Novo deployment workflow

GitHub is the source of truth for application code. Runtime databases, uploaded files, previews, and environment secrets are never promoted through Git.

## Instance identity

`NOVO_INSTANCE` controls the visible identity independently of `NODE_ENV`:

- `NOVO_INSTANCE=dev` shows `Novo-dev` in development and staging.
- `NOVO_INSTANCE=prod` shows `Novo` in production.

The production Docker image always runs the optimized Next.js server. Its visible identity is read from the container environment at runtime, so one immutable image can be tested as `Novo-dev` in staging and promoted as `Novo` in production.

## 1. Develop on AORUS

Create `.env.local` from `.env.example`, use a unique session secret, and set `NOVO_INSTANCE=dev`.

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

Tunnel port 3155 to a workstation when needed:

```bash
ssh -N -L 3155:127.0.0.1:3155 aboylan@ccib-aorus2.partners.org
```

Before pushing, run:

```bash
npm run lint
npm test
npm run build
```

Commit changes on a feature branch and push that exact commit to GitHub.

## 2. Refresh the isolated CCIB staging data

On CCIB Web 2, keep staging in a clean checkout at `/export/home/aboylan/novo-eln-staging`. Do not deploy staging from or modify the production checkout at `/export/home/aboylan/novo-eln-prod`.

In the staging checkout, create `.env.staging` with a separate session secret and `NOVO_INSTANCE=dev`. Keep production explicit with `NOVO_INSTANCE=prod` in the production checkout's `.env.local`.

Refresh the disposable staging database from a transactionally consistent production snapshot:

```bash
scripts/refresh-staging-snapshot.sh
```

By default, the refresh reads the sibling production database at `../novo-eln-prod/runtime/data/eln.sqlite3`. Override `NOVO_PRODUCTION_DATABASE` if the production checkout lives elsewhere. The refresh stops staging while replacing its database. It does not copy attachments or previews. Copy only the individual files needed for a file-specific test.

## 3. Deploy one GitHub commit to CCIB staging

From an authenticated checkout, pass the full or abbreviated SHA:

```bash
scripts/trigger-ccib-staging.sh <git-commit-sha>
```

The CCIB deployment script fetches GitHub, checks out that exact commit, builds `novo-eln:<full-sha>`, records the SHA in the image metadata, starts the isolated `novo-staging` container on loopback port 3155, and verifies both `Novo-dev` branding and SQLite integrity.

Tunnel CCIB staging to a different local port if AORUS development is already using 3155:

```bash
ssh -N -L 3156:127.0.0.1:3155 -J aboylan@ccibprod0.mgh.harvard.edu aboylan@clustweb2
```

## 4. Promote the tested image to production

Promotion is a separate, explicit action on CCIB Web 2:

```bash
scripts/promote-production.sh <git-commit-sha>
```

Run promotion from the clean staging checkout. By default, it reads production configuration and runtime data from the sibling `../novo-eln-prod` checkout while using the exact image already built and verified in staging.

Promotion refuses to proceed unless all of the following are true:

- the commit is contained in `origin/main`;
- the image label matches the requested commit;
- staging is currently running that same image and answers with `Novo-dev` branding;
- `.env.local` explicitly sets `NOVO_INSTANCE=prod`;
- the production database passes SQLite `quick_check`.

The production container then starts the already-tested image without rebuilding it. A failed `Novo` health check attempts to restore the previous image.

## Runtime boundaries

| Instance | Container | Loopback port | Runtime directory | Identity |
| --- | --- | --- | --- | --- |
| AORUS development | `novo-dev` | 3155 | `runtime/` on AORUS | `Novo-dev` |
| CCIB staging | `novo-staging` | 3155 | `runtime-staging/` on CCIB | `Novo-dev` |
| CCIB production | `novo-eln` | 3148 | `runtime/` on CCIB | `Novo` |

Never mount the production runtime directory into staging. When reproducing a data-specific problem, refresh the staging snapshot and treat it as disposable.
