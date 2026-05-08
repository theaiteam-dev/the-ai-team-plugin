---
missionId: ~
---

# SQLite Migration System

**Author:** Josh / Claude  **Date:** 2026-03-29 (revised 2026-05-07)  **Status:** Ready

## 1. Context & Background

The kanban-viewer uses SQLite via Prisma. The repo already contains **10 timestamped migration files** under `packages/kanban-viewer/prisma/migrations/` in Prisma's standard format (`<YYYYMMDDHHMMSS>_<name>/migration.sql`, plus `migration_lock.toml`), so the convention is in place.

What is **not** in place is a runner. The Docker entrypoint (`packages/kanban-viewer/docker-entrypoint.sh`) handles two paths:

```sh
if [ ! -f /app/prisma/data/ateam.db ]; then
  cp /app/prisma/data.init/ateam.db /app/prisma/data/ateam.db    # first boot: copy seed
else
  npx prisma db push --url "$DATABASE_URL" 2>&1 || {
    echo "[ateam] WARNING: Schema push failed, starting with existing schema"
  }
fi
```

Two structural problems:

1. **`prisma db push` ignores the `migrations/` directory.** It diffs `schema.prisma` against the live DB and applies whatever it thinks is needed. The 10 hand-authored migration files sit unused.
2. **Migration failures are silently swallowed.** The `|| WARN` at the end means the container keeps booting on a partially-applied schema — exactly the failure mode this PRD wants to eliminate.

**Real cost so far:** the `retroReport` migration on the agent-quality-skills mission required replacing the live DB with a fresh init copy, wiping all mission tracking data. The `finalReview` migration was missing entirely until 29 tests across 7 files started failing with `SQLITE_ERROR: no such column: main.Mission.finalReview` (CHANGELOG, line 84). Both are symptoms of the entrypoint not running migrations.

**Why now:** several upcoming PRDs (`mission-phase-lifecycle`, `commit-provenance`, possibly `slim-hannibal-playbook`) introduce schema changes. Today the only way to honor `feedback_db_migrations.md` ("never replace the live DB") is by hand. Wiring the runner makes future schema work safe by default.

## 2. Problem Statement

The Docker entrypoint applies schema changes via `prisma db push` and silently swallows failures. The hand-authored migration files in `prisma/migrations/` are not executed, so any schema change that requires explicit SQL (data migration, index, partial unique constraint, default backfill) silently misses production. This causes data loss, missing columns, and corrupted schema state — and there is no CI check that schema.prisma stays in lock-step with the migrations directory.

## 3. Target Users & Use Cases

**Primary users:**
- **Operators deploying the kanban-viewer** to OVH Cloud or local Docker — they get safe, observable upgrades on every release.
- **Pipeline agents introducing schema changes** (Murdock writing tests against new columns, B.A. implementing) — they get a documented workflow that produces a migration file alongside the schema edit.
- **Future schema authors (humans or agents)** — CI catches the missing-migration case before merge.

**Key use cases:**
- Container boot on an existing database with N pending migrations applies all N in order, atomically.
- Container boot on a fresh database initializes from the baked seed and ends in the same `_prisma_migrations` state as an upgraded one.
- Schema author edits `schema.prisma`, runs `npm run migrate:create -- --name <description>`, commits both files. CI fails if the schema and migrations are out of sync.
- A migration fails partway through. Container fails to start; operator runs the documented recovery procedure (`prisma migrate resolve`).

## 4. Goals & Success Metrics

| Goal | Metric | Current | Target |
|------|--------|---------|--------|
| Zero data loss on schema upgrades | Mission rows preserved across deploy with new column | Sometimes (only when `db push` happens to work non-destructively) | Always |
| Visible migration failures | Container starts on partially-applied schema? | Yes (silently warns and continues) | No (hard fails, surfaces the failed migration name) |
| Schema/migration parity enforced | CI catches schema.prisma changes without a matching migration file | No | Yes |
| Per-deploy backup retained | Number of pre-migration `ateam.db.backup-*` files retained | 0 | Last 5 |
| Container startup overhead | Cold-start time added by migration check | ~2s for `db push` | < 1s when no pending migrations |

**Must NOT degrade:**
- First-boot path (fresh container, no volume) ends with a working schema and pre-seeded stages.
- `npm run dev` from `packages/kanban-viewer` continues to work for local development.
- The vitest suite (no Prisma actually invoked) is untouched.

## 5. Scope

### In Scope

- **Adopt `prisma migrate deploy`** as the runtime migration applier. Replace the `db push` call in `docker-entrypoint.sh`. Hard fail on error.
- **One-time backfill of `_prisma_migrations`** for existing production DBs that were built by `db push` and have no migration history. The backfill marks all 10 existing migrations as already applied, idempotently. Implemented as a script run before the first `migrate deploy` on each existing volume; the script is a no-op on fresh volumes (where the seed DB will already have the rows).
- **Pre-migration backup** of `ateam.db` to `ateam.db.backup-<UTC-timestamp>` in the same directory. Retain the last 5; older backups are pruned automatically by the entrypoint.
- **Switch the build-time seed DB to `migrate deploy`** instead of `db push`. The Dockerfile multi-stage build runs `npx prisma migrate deploy` against `prisma/data.init/ateam.db` so the baked seed has a populated `_prisma_migrations` table. Fresh and upgraded DBs end in identical migration state.
- **`npm run migrate:create -- --name <name>`** script in `packages/kanban-viewer/package.json` wrapping `npx prisma migrate dev --name <name>` (creates the migration file and applies it to the local dev DB in one step).
- **CI guardrail** — a workflow step that runs `npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --config prisma/prisma.config.ts --exit-code` and fails the PR if there is a diff. (`--exit-code` returns non-zero when schemas differ; `--config` is required so Prisma 7 resolves the datasource URL from `prisma.config.ts` rather than failing with "datasource.url property is required". `--to-schema-datamodel` was removed in Prisma 7.)
- **Dev workflow auto-apply** — `npm run dev` in `packages/kanban-viewer` runs `prisma migrate deploy` first as a prelude so local databases stay in sync without manual steps.
- **Recovery documentation** — add a "Migration Failure Recovery" section to `docs/PLUGIN-DEV.md` covering the `_prisma_migrations` failed-state table, the `prisma migrate resolve --applied <name>` and `--rolled-back <name>` commands, and the backup-restore procedure using the `ateam.db.backup-*` files.
- **Migration authoring documentation** — same doc, "Adding a Schema Change" section: edit `schema.prisma` → `npm run migrate:create -- --name <description>` → review the generated SQL → commit both files. Reference from `packages/kanban-viewer/CLAUDE.md` and root `CLAUDE.md`.

### Out of Scope

- **Rollback automation.** SQLite `ALTER TABLE` is limited; rollback is opt-in via the documented restore-from-backup procedure.
- **Automated retroactive migration audit.** We trust the existing 10 files match the current schema; the CI guardrail catches future drift.
- **Cross-database support.** SQLite only. The migration files use SQLite-specific syntax (`PRAGMA`, `ALTER TABLE` limitations) and we are not preparing for Postgres or libSQL.
- **Online migrations.** Container restarts are required for schema changes. Zero-downtime is not a goal at this scale.

## 6. Requirements

### Functional

1. **`docker-entrypoint.sh`** runs (in order on every boot): (a) backup the live DB to `ateam.db.backup-<timestamp>` if it exists; (b) run the one-time backfill script (no-op when `_prisma_migrations` is already populated); (c) run `npx prisma migrate deploy`; (d) prune old backups, keeping the most recent 5; (e) exec the application.
2. **Fresh volume path:** when `/app/prisma/data/ateam.db` does not exist, copy `data.init/ateam.db` first, then run the same Step 1 flow. Skip the backup step on fresh volumes (nothing to back up).
3. **Hard fail on migration error:** when `prisma migrate deploy` exits non-zero, the entrypoint exits non-zero. The container does NOT start the app on a partially-applied schema. The error message must include the failed migration name.
4. **Backfill script idempotency:** running the backfill on a DB that already has `_prisma_migrations` populated is a no-op. Running it on a DB built by `db push` (no `_prisma_migrations` table) inserts one row per existing migration directory marking each as applied at a synthetic timestamp.
5. **Build-time seed DB:** the Dockerfile builder stage runs `npx prisma migrate deploy --schema prisma/schema.prisma` against `prisma/data.init/ateam.db` instead of `prisma db push`. The resulting baked DB has a populated `_prisma_migrations` table.
6. **`npm run migrate:create -- --name <name>`** in `packages/kanban-viewer/package.json` shells to `prisma migrate dev --name <name>`. Producers of schema changes use only this script — direct `prisma migrate dev` is not banned but the `npm` script is the documented path.
7. **CI guardrail:** a step in `.github/workflows/ci.yml` (or equivalent) runs `npx prisma migrate diff --from-migrations packages/kanban-viewer/prisma/migrations --to-schema packages/kanban-viewer/prisma/schema.prisma --config packages/kanban-viewer/prisma/prisma.config.ts --exit-code` and fails the PR with a clear message ("schema.prisma is out of sync with prisma/migrations/. Run `npm run migrate:create -- <description>` and commit the new file.") when the schemas drift. Note: `--to-schema-datamodel` was removed in Prisma 7; use `--to-schema` plus `--config`.
8. **`npm run dev` in `packages/kanban-viewer`** is updated to run `prisma migrate deploy` first, then start Next.js. Failure of the prelude blocks the dev server, with the same clear error as in production.
9. **Recovery procedure** documented in `docs/PLUGIN-DEV.md` covers: identifying a failed migration via `_prisma_migrations`, manually running the corrective SQL, marking the migration as applied with `prisma migrate resolve --applied`, restoring from `ateam.db.backup-*` files, and pruning the backups.

### Non-Functional

1. Container startup adds < 1s when zero migrations are pending (single `migrate deploy` call against a current DB).
2. Backup file naming follows `ateam.db.backup-<UTC-ISO-8601-no-colons>`, e.g., `ateam.db.backup-2026-05-07T143022Z`. Sortable lexicographically.
3. The CI guardrail runs in under 30 seconds (it does a string-level diff, no DB connection).
4. The migration-applied messages from `prisma migrate deploy` are not suppressed — startup logs show every migration name and outcome.

### Edge Cases & Error States

- **Volume mounted from a backup that is older than the baked seed.** Backfill marks whichever migrations the DB already includes as applied; `migrate deploy` then applies the remaining ones forward.
- **Migration file present, schema.prisma has not caught up.** CI catches this on the PR. At runtime, `migrate deploy` applies the SQL anyway; if the resulting schema diverges from `schema.prisma`, Prisma client queries may fail at runtime — same behavior as today.
- **Migration file removed without the matching schema rollback.** CI catches this on the PR (drift in the other direction).
- **Concurrent containers booting against a shared volume.** Prisma's `_prisma_migrations` insert acts as the lock — the loser sees "already applied" and exits cleanly. No special handling needed beyond the default Prisma behavior.
- **Disk full when writing the backup.** Backup step fails; the entrypoint exits non-zero before invoking `migrate deploy`. Operator sees a clear error and frees space; no schema changes happen.
- **`_prisma_migrations` table corrupt.** Operator restores from `ateam.db.backup-<latest>` per the recovery doc.

## 7. Open Questions

None blocking. Decisions ratified by reviewer:

- ✅ Adopt `prisma migrate deploy` (file format already matches).
- ✅ One-time backfill to mark existing migrations as applied.
- ✅ Drop `db push` from entrypoint; hard fail on errors.
- ✅ Add `npm run migrate:create` and document workflow.
- ✅ CI check in scope (smallest possible).
- ✅ `migrate deploy` for the baked seed DB.
- ✅ Recovery procedure documented.
- ✅ Backup before migrate; retain last 5.

Implementation team decides:
- Exact backup-pruning command (likely `ls -1t ateam.db.backup-* | tail -n +6 | xargs -r rm`).
- Whether the backfill script lives in `packages/kanban-viewer/scripts/` or `prisma/scripts/`.
- Exact wording of the CI failure message.

## 8. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Existing prod DB's actual schema disagrees with what the migration files describe (because `db push` was used) | Medium | Backfill marks migrations as applied; first new migration after backfill assumes a wrong starting state | Backfill script verifies each `migration.sql` against current DB schema via `PRAGMA table_info` before marking applied. If a column the migration adds doesn't exist, the script aborts and surfaces the discrepancy for manual repair. |
| `prisma migrate deploy` requires a DB URL accessible from the schema or env — current entrypoint already sets `DATABASE_URL`, so this should be fine | Low | Container fails to start | Verify the env contract once during implementation; document required env. |
| Adding the dev-server prelude breaks contributor workflow if migrations fail locally | Low | Annoying, blocks `npm run dev` | Default lean: blocking is correct (dev DB out of sync is a worse failure mode). Document the override (`SKIP_MIGRATE=1 npm run dev`) for the unusual case. |
| CI guardrail produces false positives on legitimate `prisma migrate dev` output (e.g., the schema-side comment Prisma adds when it generates) | Low | PRs fail incorrectly | Use `--exit-code` flag specifically on schema diff, not file presence. Test on a known-good PR before merging the workflow. |
| Backup retention pruning mis-globs and deletes the live DB | Very Low | Catastrophic — but `ateam.db` doesn't match `ateam.db.backup-*` glob | Glob is anchored on `ateam.db.backup-*`; live DB is `ateam.db` (no backup suffix). Add a unit test for the prune command. |

## 9. Rollout & Measurement

**Phasing:**
- **Phase 1 (this mission):** ship the runtime + dev + CI changes together. The whole point is the chain working end-to-end; a partial ship leaves the silent-failure path intact.

**Measurement plan:**
- After deploy, on each container boot: confirm the entrypoint logs include `prisma migrate deploy` output (or "No pending migrations to apply"). Watch for `WARNING: Schema push failed` to disappear from logs entirely.
- Open a deliberately-broken PR (edit `schema.prisma` without a migration file) on a branch and confirm CI fails with the documented message before merging the actual sqlite-migration-system PR.
- Run `mission-phase-lifecycle` next (which adds the `MissionPhase` table) and verify mission rows from prior runs are still queryable.

**Rollback criteria:**
- If `prisma migrate deploy` fails on a known-good production deployment with no schema change, revert the entrypoint to `db push` while diagnosing. The migrations dir and CI guardrail can stay; only the runtime path is reverted.
- The pre-migration backups (`ateam.db.backup-*`) are the data-recovery path; the rollback is operationally safe because step 1 of every boot is "back up first."

## 10. Reference: Files Likely Touched

- `packages/kanban-viewer/docker-entrypoint.sh` (rewrite)
- `packages/kanban-viewer/Dockerfile` (build-time seed step + ensure prisma CLI is in runtime image)
- `packages/kanban-viewer/package.json` (`migrate:create`, `dev` prelude)
- `packages/kanban-viewer/prisma/scripts/backfill-migrations.ts` (or `.sh`) — new
- `.github/workflows/ci.yml` — add migration-parity step
- `docs/PLUGIN-DEV.md` — add "Adding a Schema Change" + "Migration Failure Recovery" sections
- `packages/kanban-viewer/CLAUDE.md` — link to the new docs
- `CLAUDE.md` (root) — one-line cross-reference under the schema section if any
