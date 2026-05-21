# Novo Backups

Novo backups run outside the Next.js app as a scheduled operating-system task. The app can keep running while backups happen.

The backup must include both:

- the SQLite database snapshot
- uploaded attachment files in `storage/uploads`

Derived preview files in `data/previews` are included by default so restores are ready immediately, but they are less important than the DB and uploads.

## Recommended Tool

Use borgmatic, which wraps BorgBackup. Borg deduplicates data, so unchanged attachments are not stored again for every daily/weekly/monthly backup. This matters once ENEX imports create many large attachments.

Recommended retention:

- 30 daily backups
- 12 weekly backups
- 6 monthly backups

## Runtime Model

Backups should run as a separate process using cron or systemd timers. Do not run them from the web app request lifecycle.

The nightly job should:

1. Run `scripts/backup-sqlite.sh`.
2. Borgmatic backs up `data/backup-staging`, `storage/uploads`, `data/previews`, and required config.
3. Borgmatic prunes old archives according to retention policy.
4. A periodic restore test verifies the backup actually works.

`scripts/backup-sqlite.sh` uses SQLite's `.backup` command, which creates a consistent SQLite snapshot while the app is online. The snapshot is written to:

```text
data/backup-staging/eln.sqlite3
data/backup-staging/manifest.json
```

The manifest records counts, sizes, and the app git commit at backup time.

## Consistency Notes

SQLite `.backup` is safe while the app is running.

Attachment files are stored separately on disk. Novo writes attachment files before inserting their database row, so normal upload activity is compatible with live backups. The most conservative production setup would still use either:

- a filesystem snapshot of the database and upload directories, or
- a brief write-maintenance window around the backup.

For the current single-lab deployment, the practical borgmatic setup is:

- live SQLite `.backup`
- borgmatic backup of the SQLite snapshot and upload directory
- regular restore tests

Restore tests are mandatory. A backup strategy is not proven until a restored copy can open notebooks, pages, and attachments.

## Install Sketch

Install Borg and borgmatic on the server, then initialize a repository:

```bash
borg init --encryption=repokey /mnt/backup/novo-borg
```

Copy and edit the example config:

```bash
sudo mkdir -p /etc/borgmatic /etc/novo
sudo cp ops/backup/borgmatic.yaml.example /etc/borgmatic/novo.yaml
sudo editor /etc/borgmatic/novo.yaml
```

For systemd scheduling:

```bash
sudo cp ops/backup/systemd/novo-borgmatic.service /etc/systemd/system/
sudo cp ops/backup/systemd/novo-borgmatic.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now novo-borgmatic.timer
```

Manual run:

```bash
sudo systemctl start novo-borgmatic.service
```

Check schedule and logs:

```bash
systemctl list-timers novo-borgmatic.timer
journalctl -u novo-borgmatic.service
```

Validate the borgmatic config before relying on it:

```bash
borgmatic --config /etc/borgmatic/novo.yaml config validate
```

## Restore Sketch

Restore into a separate test directory first:

```bash
borgmatic --config /etc/borgmatic/novo.yaml extract --archive latest --destination /tmp/novo-restore-test
```

Then point Novo at the restored database and uploads using:

```bash
ELN_DATABASE_PATH=/tmp/novo-restore-test/.../data/backup-staging/eln.sqlite3
ELN_UPLOAD_DIR=/tmp/novo-restore-test/.../storage/uploads
ELN_PREVIEW_DIR=/tmp/novo-restore-test/.../data/previews
```

Do not overwrite production data until a restore has been verified in a separate location.
