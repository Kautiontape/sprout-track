# Syncing with upstream

We fork [`Oak-and-Sprout/sprout-track`](https://github.com/Oak-and-Sprout/sprout-track).
This is how to pull their releases in without losing potty/EC tracking, day-night flip,
the daily-summary running average, or the ktn deployment setup.

Written after the 1.3.4 → 1.6.5 sync (484 upstream commits, eight releases, 2026-08-24).
Full detail in `docs/superpowers/plans/2026-08-24-upstream-sync-1.6.5.md`.

## Cadence

**Sync at every upstream tag.** One release is a coffee break. We let eight accumulate
once and it became a multi-day project that surfaced four silent regressions.

## Procedure

Use the helper, which merges one tag and stops:

```bash
./ktn-scripts/sync-upstream.sh              # list tags newer than HEAD
git checkout -b sync/upstream-<version>
./ktn-scripts/sync-upstream.sh <tag>        # merge the OLDEST unmerged tag first
```

It refuses to run on `main`, refuses a dirty tree, never force-pushes, and prints the
conflict recipes below. Then per rung:

1. Resolve conflicts using the recipes.
2. Verify: `npx tsc --noEmit && npm run build && npm run test`
3. Dry-run migrations against a **copy**, never the real database (see below).
4. `git commit -m "sync: Merge upstream <tag>"`
5. Repeat for the next tag.

Merge to `main` only when the ladder is finished. **A push to `main` auto-deploys and
migrates production** — see Cutover.

## Conflict recipes

| What | Recipe |
| --- | --- |
| `src/localization/translations/*.json` | `node scripts/merge-locale-conflict.js` then `node scripts/check-missing-translations.js`. Takes upstream's file and re-adds the keys we introduced. Never hand-merge these. |
| `src/components/features/nursery-mode/*`, `app/api/nursery-mode-settings/` | Always take theirs: `git checkout MERGE_HEAD -- <paths>`. Our nursery lives at `src/components/NurseryMode/` and is fully decoupled. If upstream's tree references helpers we deleted, restore those from `MERGE_HEAD` too or nothing compiles. |
| `Dockerfile` | Keep ours (ktn-specific). Ours uses a blanket `COPY . .`, so upstream's selective-COPY changes need no port — but **`.dockerignore` changes do matter**, since that gates what our COPY picks up. |
| `prisma/schema.prisma` | Union. Keep every upstream model plus our `PottyLog`, `hueConfig`, `dailyStatsAvgDays`, `pottyLocationSettings`, `dayNightFlipConfig`. Verify with `npx prisma validate`. |
| `app/api/types.ts` | Union. Our potty types are additive. |
| Activity-type lists | Union, consistently ordered: our `'potty'` after `'diaper'`. Since 1.6.4 these derive from `DEFAULT_ACTIVITY_TILE_ORDER` in `src/utils/activityTileOrder.ts` — add potty there, not to each array. |
| `app/api/hooks/v1/.../activities/route.ts` | If upstream restructured it, take theirs wholesale and re-add potty deliberately: `'potty'` in `VALID_TYPES`, a `potty` entry in `TYPE_FIELDS`, the `case 'potty'` POST branch, and the GET query block. Hand-merging their rewrites loses things quietly. |
| Anything touching security | **Upstream's security behavior wins** over our convenience changes. |

## Migration dry-runs

`DATABASE_URL` is **ignored** by the Prisma CLI here — the datasource URL is a literal in
`schema.prisma` (Prisma requires a literal for `provider`; see `scripts/prisma-provider.js`).
Use a scratch schema:

```bash
cp db/baby-tracker.db db/sync-test.db
sed 's|url      = "file:../db/baby-tracker.db"|url      = "file:../db/sync-test.db"|' \
  prisma/schema.prisma > prisma/sync-test.prisma
npx prisma migrate deploy --schema=prisma/sync-test.prisma
```

`prisma/sync-test.prisma` is gitignored.

### Row counts are not sufficient evidence

SQLite cannot `ALTER COLUMN`, so Prisma implements `Settings` changes as a full table
rebuild: `CREATE new_Settings` / `INSERT SELECT` / `DROP` / `RENAME`. Upstream authors
those against **upstream's** column list, which silently drops ours. Five rungs of
dry-runs reported clean while this was happening, because they only counted rows.

**Always run the drift gate:**

```bash
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma --script
```

Expected: **no SQL statements**. Any `CREATE TABLE "new_…"` means a rebuild dropped fork
columns. `20260801000000_restore_fork_settings_columns` repairs the known case; a new
upstream rebuild needs the same treatment, in a migration named to sort after theirs.

Then prove the client can write `Settings`, which is what fails first (`P2022`, and the
container cannot boot):

```bash
DATABASE_URL="file:$(pwd)/db/sync-test.db" node scripts/convert-solids-feeds.js
```

### Prisma migrations are not the only thing that mutates data

`docker-startup.sh` runs `node scripts/convert-solids-feeds.js` on **every** container
start, and `/api/database/migrate*` runs it after a restore. It rewrites
`Settings.activitySettings` regardless of whether any conversion is needed. Unlike the
Prisma CLI, it honours `DATABASE_URL`, so point it at a copy with an absolute path.

## Cutover

The container runs `prisma migrate deploy` on every start against the live volume, with
**no backup of its own**. The push is what migrates production.

1. **Back up first — this is the gate.** `./ktn-scripts/backup-db.sh`. Verify it is
   restorable, not merely present: extract it and check row counts plus
   `PRAGMA integrity_check`.
2. **Capture the three fork `Settings` values.** Upstream's rebuild destroys them before
   the repair migration re-adds the columns. `hueConfig` is the one that holds real data
   (the day-night flip Hue buttons); `dailyStatsAvgDays` and `pottyLocationSettings` have
   been at defaults, but capture them anyway — a before/after value comparison cannot
   tell "preserved" from "reset to the same default".
3. Merge to `main`, push, watch `gh run list` (build & publish → Deploy to ktn) and
   `./ktn-scripts/logs.sh`.
4. **Verify row counts survived**, then restore the captured values.
   `hueConfig` **must be written as TEXT**: `readfile()` alone stores a BLOB and Prisma
   rejects it with a *type* error that looks like an unrelated bug. Use
   `CAST(readfile('/in/hue.txt') AS TEXT)`, trim the trailing newline, and confirm by
   **md5 against the capture** — length alone will not catch the BLOB corruption.
   The `keinos/sqlite3` image runs as uid 100; the volume files are root-owned, so pass
   `--user 0` or the write fails as "readonly database".
5. **Expect everyone to be logged out.** Upstream 1.3.5 replaced the hardcoded JWT
   fallback with a generated per-deployment secret. `JWT verification error: invalid
   signature` in the logs right after deploy is expected, not a fault.

## Known issue: fresh installs fail

Our `20260721201741_add_daily_stats_avg_days` rebuilds `Settings` without upstream's
`bathTypeSettings`, `photoQuotaMB`, and `growthChartStandard` — the mirror of the bug
above. On a database migrated **from empty**, migrations abort:

```
Error: P3018  A migration failed to apply.
The column `growthChartStandard` does not exist in the current database.
```

Existing deployments and the cutover rollback are unaffected: `backup-db.sh` tars the
volume, so a restore returns an already-migrated database with its `_prisma_migrations`
history intact and nothing pending re-runs the offending migration.

A single static migration cannot repair both directions (upstream's rebuild runs *after*
ours on an existing database and *before* ours on a fresh one), and editing the original
breaks Prisma's checksum validation everywhere. The likely fix is an idempotent
ensure-columns step in `docker-startup.sh` ahead of `migrate deploy`, following the
`convert-solids-feeds.js` pattern.

## Principle

**Our decisions stand; upstream is absorbed, not adopted.** Where upstream made a
different call than we did, ours survives the merge. We conform to upstream only where
their code path mechanically requires it — registering potty with their webhook field
validator, or matching their canonical `Formula/Breast` bottle-type string so their
inventory query still sees our rows.

Two standing exceptions: **security fixes always win**, and **their migrations always run**.
