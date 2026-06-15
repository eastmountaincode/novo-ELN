# ENEX Nested List Repair

This folder tracks the production repair process for ENEX imports that dropped nested lists.

## Problem

Nick found missing nested list content in `SortSeq-Expt705 CH22 and CH-22-GPA33 cells injection into mice`.

The source ENEX contains the missing content. Evernote emitted nested lists as sibling `<ol>` / `<ul>` nodes immediately after a parent `<li>`, for example:

```html
<ol>
  <li>Inject 4 mice...</li>
  <ol>
    <li>2 mice with CH22</li>
    <li>2 mice with CH22-GPA33 pool cells</li>
  </ol>
</ol>
```

The old importer only kept direct `<li>` children of a list, so the sibling nested list was dropped at import time.

## Code Fix

The importer has been updated to attach sibling nested lists to the preceding list item.

Updated paths:

- `src/lib/enex.ts`
- `scripts/import-enex.mjs`
- `tests/enex.test.ts`

Future ENEX imports should preserve this list shape.

## Provenance Fix

Attachments now have a nullable `evernote_hash` column.

Future ENEX imports store the original Evernote resource MD5 hash in `attachments.evernote_hash`. Existing imported attachments will have `NULL` unless a repair/backfill script can match them safely.

## Repair Rules

Do not overwrite any user-edited page body without manual review.

Pages must be classified before repair:

- `safe_auto_repair`: ENEX reconversion differs from Novo, and the page has no `page.body.updated` audit event after import.
- `manual_review`: ENEX reconversion differs from Novo, and the page has one or more body edit audit events.
- `unchanged`: ENEX reconversion matches Novo or has no nested-list repair.
- `ambiguous`: duplicate title/date/resource match, missing ENEX source, or attachment mismatch.

Only `safe_auto_repair` pages can be changed automatically.

## Repair Steps

1. Stop and document current app state:

```bash
cd /export/home/aboylan/novo-eln-prod
docker compose ps
git status --short
```

2. Create a database backup:

```bash
cd /export/home/aboylan/novo-eln-prod
mkdir -p runtime/repair-backups
cp runtime/data/eln.sqlite3 "runtime/repair-backups/eln-before-enex-nested-list-repair-$(date +%Y%m%d-%H%M%S).sqlite3"
```

3. Run dry-run analysis:

```bash
cd /export/home/aboylan/novo-eln-prod
docker compose run --rm \
  -v /export/home/aboylan/evernote-imports:/evernote-imports:ro \
  novo \
  node ops/enex-repair/analyze-nested-list-loss.mjs \
    --database /app-data/data/eln.sqlite3 \
    --enex-root /evernote-imports \
    --report-dir /app-data/enex-repair-reports
```

4. Review report counts before writes:

- total pages scanned
- pages needing repair
- pages safe for automatic repair
- pages requiring manual review
- ambiguous pages

5. Apply only safe repairs:

```bash
cd /export/home/aboylan/novo-eln-prod
docker compose run --rm \
  -v /export/home/aboylan/evernote-imports:/evernote-imports:ro \
  novo \
  node ops/enex-repair/apply-safe-nested-list-repair.mjs \
    --report /app-data/enex-repair-reports/nested-list-loss-20260526T224701Z.json \
    --actor-email andreweboylan@gmail.com
```

That command is a dry run. If the dry run looks right, run the same command with `--apply`:

```bash
cd /export/home/aboylan/novo-eln-prod
docker compose run --rm \
  -v /export/home/aboylan/evernote-imports:/evernote-imports:ro \
  novo \
  node ops/enex-repair/apply-safe-nested-list-repair.mjs \
    --report /app-data/enex-repair-reports/nested-list-loss-20260526T224701Z.json \
    --actor-email andreweboylan@gmail.com \
    --apply
```

6. Rebuild search index for repaired pages.

7. Spot-check known examples:

- `Binders-II` / `SortSeq-Expt705 CH22 and CH-22-GPA33 cells injection into mice`
- `Binders-II` / `SortSeq-Expt701 Fc-IFNg-GPA33scfv GPA33 Tumor Targeting`

8. Manually review edited pages.

As of the initial check, production had 3430 pages and 10 pages with `page.body.updated` audit events. Those edited pages should be treated as manual review unless proven safe.

## First Dry Run

Report:

```text
/app-data/enex-repair-reports/nested-list-loss-20260526T224701Z.json
```

Summary:

```text
ENEX files scanned: 63
Notes scanned: 3558
Notes with sibling nested lists: 1576
safe_auto_repair: 1503
manual_review: 8
ambiguous: 60
unchanged: 5
```

Known flagged examples:

- `Binders-II` / `SortSeq-Expt705 CH22 and CH-22-GPA33 cells injection into mice`: `manual_review`
- `Binders-II` / `SortSeq-Expt701 Fc-IFNg-GPA33scfv GPA33 Tumor Targeting`: `manual_review`

The first version of the analyzer buffered entire `<note>` blocks and failed on huge resource payloads. It has been changed to read only the note title/content and skip the resource tail. Keep that memory-safe streaming behavior.

The first detector also stripped ENML tags before looking for lists. That was wrong; content extraction must preserve ENML tags.

## Apply-Safe Behavior

`apply-safe-nested-list-repair.mjs`:

- reads the dry-run report;
- processes only `safe_auto_repair` pages;
- regenerates the body from the fixed ENML converter;
- preserves inline attachment cards by matching ENEX media hashes to stored attachment files;
- skips pages when any inline media hash cannot be matched to an existing attachment;
- does not change `pages.updated_at`;
- updates `search_pages_fts` for repaired pages;
- writes an audit event: `repaired imported ENEX nested list content`;
- writes a machine-readable apply report listing repaired, skipped, and failed pages.

Do not bulk-overwrite `manual_review` pages. Those need a separate merge/review workflow.

## First Safe Apply

Backup created before applying:

```text
/app-data/repair-backups/eln-before-enex-safe-apply-20260526-232252.sqlite3
```

Full dry-run report:

```text
/app-data/enex-repair-reports/nested-list-apply-20260526T231426Z.json
```

Dry-run result:

```text
would_repair: 1350
skipped: 153
```

Full apply report:

```text
/app-data/enex-repair-reports/nested-list-apply-20260526T232359Z.json
```

Apply result:

```text
repaired: 1349
unchanged_now: 1
skipped: 153
```

The `unchanged_now` page was repaired by the one-page apply smoke test before the full apply. The 153 skipped pages were intentionally left unchanged because the script could not prove the repair safely enough.

## Final Post-Repair Analysis

The analyzer was tightened after the first apply to compare against rendered editor plain text rather than raw JSON. That removed 28 false positives where the fixed converter already matched the current page body.

Final post-repair report:

```text
/app-data/enex-repair-reports/nested-list-loss-20260526T233934Z.json
```

Final post-repair summary:

```text
unchanged: 1355
safe_auto_repair: 153
ambiguous: 60
manual_review: 8
```

The 153 remaining `safe_auto_repair` findings are not automatically repaired by the apply-safe script because its stricter checks still skip them. They require follow-up review.

## Audit Trail

Every automatic repair should write an audit event with a summary like:

```text
repaired imported ENEX nested list content
```

This repair event is not a scientific page edit by the user. Prefer not to modify the user-facing page `updated_at` timestamp unless the repair script has a specific reason to do so.
