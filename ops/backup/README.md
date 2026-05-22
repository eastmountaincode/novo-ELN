# Novo Backups

Novo backups run outside the Next.js app as a separate process. The app can keep running while backups happen.

The backup must include:

- a consistent SQLite database snapshot
- uploaded attachment files in `runtime/uploads`

Derived preview files in `runtime/previews` are included when present so a restored app is ready to inspect immediately.

## Current No-Sudo Workflow

On `ccibweb2`, `aboylan` does not have sudo/root access but does have Docker access. The current practical backup path is therefore a one-shot Dockerized BorgBackup job:

```bash
cd /export/home/aboylan/novo-eln-prod
NOVO_BORG_REPOSITORY=/path/to/novo-borg-repo \
NOVO_BORG_PASSPHRASE='use-a-long-random-passphrase' \
docker compose -f docker-compose.backup.yml run --rm novo-borg-backup
```

This starts a short-lived container, creates a SQLite `.backup` snapshot, stores uploads/previews plus a manifest in a Borg archive, applies retention, compacts the repository, and exits.

Retention is:

- 30 daily backups
- 12 weekly backups
- 6 monthly backups

`NOVO_BORG_REPOSITORY` is required. It should point to storage outside the app runtime directory when possible.

## Secret Handling

Do not commit the Borg passphrase. For manual runs, provide the required values inline:

```bash
cd /export/home/aboylan/novo-eln-prod
NOVO_BORG_REPOSITORY=/path/to/novo-borg-repo \
NOVO_BORG_PASSPHRASE='replace-with-a-long-random-passphrase' \
docker compose -f docker-compose.backup.yml run --rm novo-borg-backup
```

## Scheduling Without Root

If user crontab is allowed on the production host, schedule the same one-shot Docker command:

```bash
crontab -e
```

Example nightly entry:

```cron
30 2 * * * cd /export/home/aboylan/novo-eln-prod && NOVO_BORG_REPOSITORY=/path/to/novo-borg-repo NOVO_BORG_PASSPHRASE='replace-with-a-long-random-passphrase' docker compose -f docker-compose.backup.yml run --rm novo-borg-backup >> runtime/backups/borg.log 2>&1
```

This does not require root if the user can run Docker and cron.

If cron is not allowed, run the command manually before imports and ask Marc/IT for either user cron support or a root-managed systemd timer.

## Inspecting Backups

List archives:

```bash
cd /export/home/aboylan/novo-eln-prod
NOVO_BORG_REPOSITORY=/path/to/novo-borg-repo \
NOVO_BORG_PASSPHRASE='replace-with-a-long-random-passphrase' \
docker compose -f docker-compose.backup.yml run --rm --entrypoint borg novo-borg-backup list /borg-repo
```

Check the repository:

```bash
cd /export/home/aboylan/novo-eln-prod
NOVO_BORG_REPOSITORY=/path/to/novo-borg-repo \
NOVO_BORG_PASSPHRASE='replace-with-a-long-random-passphrase' \
docker compose -f docker-compose.backup.yml run --rm --entrypoint borg novo-borg-backup check /borg-repo
```

## Restore Test

A backup is not proven until restore has been tested. Restore into a separate directory first; do not overwrite production data directly.

```bash
mkdir -p /tmp/novo-restore-test
docker run --rm \
  --entrypoint borg \
  -e BORG_PASSPHRASE="$NOVO_BORG_PASSPHRASE" \
  -v "$NOVO_BORG_REPOSITORY:/borg-repo:ro" \
  -v /tmp/novo-restore-test:/restore \
  novo-eln-borg-backup:latest \
  extract --target /restore /borg-repo::ARCHIVE_NAME
```

The restored archive contains:

- `backup-staging/eln.sqlite3`
- `backup-staging/manifest.txt`
- `uploads/`
- `previews/` when previews existed

Point a test Novo instance at the restored SQLite file and uploads directory before trusting the backup strategy.

## Later Admin-Managed Option

The cleaner long-term institutional setup is still:

- Borg or borgmatic installed on the production host by Marc/IT
- a backup repository on institutional storage, NAS, or another server/volume
- a root-managed systemd timer
- documented restore tests

That version needs root/IT involvement. The Dockerized Borg job is the no-sudo path we can run now.
