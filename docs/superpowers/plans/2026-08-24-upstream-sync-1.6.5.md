# Upstream Sync 1.3.4 → 1.6.5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge 484 upstream commits (tags 1.3.5 → 1.6.5) into our fork across eight staged rungs, preserving all four of our features unchanged, and deploy the result to ktn.

**Architecture:** A branch `sync/upstream-1.6.5` receives one `git merge <tag>` per upstream release. Three conflict classes are resolved by fixed policy — locale JSON by a purpose-built script, upstream's nursery tree by always taking theirs, Dockerfile by always keeping ours — leaving only a small hand-merge surface per rung. Verification tightens from typecheck-and-build on light rungs to migration dry-runs and browser smoke tests on deep rungs.

**Tech Stack:** git, Node 22, Next.js App Router, Prisma (SQLite), vitest (arrives at rung 1.4.0), TypeScript.

**Spec:** `docs/superpowers/specs/2026-08-24-upstream-sync-design.md`

---

## File Structure

**Created:**
- `scripts/merge-locale-conflict.js` — resolves conflicted translation JSON files from git's three merge stages. Pure merge function + git plumbing, kept in one file because they are one responsibility.
- `scripts/merge-locale-conflict.test.js` — tests for the pure merge function.
- `documentation/upstream-sync.md` — the runbook for future syncs.

**Modified:**
- `app/(nursery)/[slug]/nursery-mode/page.tsx` — gains the nursery variant toggle.
- `app/api/hooks/v1/babies/[babyId]/activities/route.ts` — potty re-registered against upstream's validator (rung 1.6.2).
- `package.json` — test script (arrives from upstream at 1.4.0).
- Our six `*.test.ts` files — ported from `node:test` to `vitest`.

**Restored from upstream (not authored by us):**
- `src/components/features/nursery-mode/*`, `app/api/nursery-mode-settings/route.ts`.

**Untouched by this plan:**
- `src/components/NurseryMode/` — our nursery implementation. No edits at any rung.

## Scratch database canaries

`db/sync-test.db` is a **read-only snapshot of the live ktn production database**,
pulled 2026-08-24 and current through that afternoon. The repo's own
`db/baby-tracker.db` is a stale June dev copy and is NOT what the dry runs use.

Baseline, measured before the ladder started:

| Measure | Value | Why it matters |
| --- | ---: | --- |
| `PottyLog` rows | **24** | The invariant canary. No upstream migration may change this. |
| `FeedLog` rows | **701** | Total must survive both row-rewriting migrations. |
| `FeedLog` with `type='SOLIDS'` | **0** | Upstream's 1.6.0 solid-to-food conversion is a **no-op** for this family. |
| `FeedLog` with `bottleType='Formula\Breast'` | **156** | Upstream's 1.6.2 migration **does** rewrite these. Real canary. |

Two consequences worth knowing:

- The scariest-sounding migration (1.6.0, solid feeds to food logs) touches nothing
  here, because this family never logged a solid feed. The dry run proves the
  migration executes cleanly against our merged schema, not that it converts
  correctly — there is nothing to convert.
- The 1.6.2 bottle-type migration is the one that actually rewrites production
  rows: 156 of them. That is the migration to watch.

The datasource URL is a literal in `schema.prisma` — Prisma requires it, see
`scripts/prisma-provider.js` — so `DATABASE_URL` is ignored. Every dry run
regenerates a scratch schema pointing at `db/sync-test.db`. `prisma/sync-test.prisma`
is gitignored so it cannot pollute a merge.

---

### Task 1: Setup — remote, backups, branch

**Files:**
- Modify: `.git/config` (via `git remote add`)

- [ ] **Step 1: Add the upstream remote and fetch tags**

```bash
git remote add upstream https://github.com/Oak-and-Sprout/sprout-track.git
git fetch upstream --tags
git remote -v
```

Expected: `upstream` appears with fetch and push URLs. Tags `1.3.5` through `1.6.5` are now local.

- [ ] **Step 2: Verify the tags resolve to the expected commits**

```bash
for t in 1.3.5 1.4.0 1.5.0 1.6.0 1.6.2 1.6.3 1.6.4 1.6.5; do echo "$t $(git rev-parse --short $t)"; done
```

Expected, exactly:
```
1.3.5 4630c8df
1.4.0 6b362287
1.5.0 25500031
1.6.0 f2cb119b
1.6.2 85bf8f5e
1.6.3 d3865e12
1.6.4 59122b81
1.6.5 4a15d12c
```

If any SHA differs, STOP — upstream has moved or retagged since this plan was written, and the rung table needs recomputing.

- [ ] **Step 3: Back up the real database**

The database at `db/baby-tracker.db` is real family data, not test data.

```bash
STAMP=$(date +%Y%m%d-%H%M%S)
cp db/baby-tracker.db "db/baby-tracker.db.pre-upstream-${STAMP}.bak"
cp db/baby-tracker-logs.db "db/baby-tracker-logs.db.pre-upstream-${STAMP}.bak"
ls -la db/*.bak | tail -4
```

Expected: two new `.bak` files with today's date, each roughly the size of its source (~1.6M and ~29K).

- [ ] **Step 4: Create the scratch database for migration dry-runs**

```bash
cp db/baby-tracker.db db/sync-test.db
ls -la db/sync-test.db
```

Expected: `db/sync-test.db` exists at ~1.6M. This copy — never the real database — receives every `prisma migrate deploy` in this plan until cutover.

- [ ] **Step 5: Create the sync branch**

```bash
git checkout main
git status --porcelain
git checkout -b sync/upstream-1.6.5
git status -sb | head -1
```

Expected: `git status --porcelain` prints nothing (clean tree) before branching; final line reads `## sync/upstream-1.6.5`.

Do NOT push this branch to `origin` yet and do NOT merge to `main` before Task 15. A push to `main` triggers `build & publish` → `deploy-ktn`.

---

### Task 2: Locale conflict merge script

Our `en.json` adds 350 keys and modifies zero existing ones, so for every translation file the correct resolution is "take upstream's file, then re-add the keys we introduced." This script reads git's three merge stages and does exactly that.

**Files:**
- Create: `scripts/merge-locale-conflict.js`
- Test: `scripts/merge-locale-conflict.test.js`

- [ ] **Step 1: Write the failing test**

Create `scripts/merge-locale-conflict.test.js`:

```javascript
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mergeLocale } = require('./merge-locale-conflict');

test('keeps upstream values for keys that existed at the merge base', () => {
  const base = { Hello: 'Hello' };
  const ours = { Hello: 'Hello' };
  const theirs = { Hello: 'Hello there' };
  assert.deepEqual(mergeLocale(base, ours, theirs), { Hello: 'Hello there' });
});

test('re-adds keys we introduced since the merge base', () => {
  const base = { Hello: 'Hello' };
  const ours = { Hello: 'Hello', Potty: 'Potty' };
  const theirs = { Hello: 'Hello', Food: 'Food' };
  assert.deepEqual(mergeLocale(base, ours, theirs), {
    Hello: 'Hello',
    Food: 'Food',
    Potty: 'Potty',
  });
});

test('upstream wins when both sides added the same key', () => {
  const base = {};
  const ours = { Shared: 'ours' };
  const theirs = { Shared: 'theirs' };
  assert.deepEqual(mergeLocale(base, ours, theirs), { Shared: 'theirs' });
});

test('treats a missing base as empty (file added on both sides)', () => {
  const ours = { OnlyOurs: 'x' };
  const theirs = { OnlyTheirs: 'y' };
  assert.deepEqual(mergeLocale(null, ours, theirs), {
    OnlyTheirs: 'y',
    OnlyOurs: 'x',
  });
});

test('drops keys upstream deleted that we never touched', () => {
  const base = { Gone: 'Gone' };
  const ours = { Gone: 'Gone' };
  const theirs = {};
  assert.deepEqual(mergeLocale(base, ours, theirs), {});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/merge-locale-conflict.test.js`

Expected: FAIL — `Cannot find module './merge-locale-conflict'`.

- [ ] **Step 3: Write the script**

Create `scripts/merge-locale-conflict.js`:

```javascript
#!/usr/bin/env node

/**
 * Resolve conflicted translation JSON files during an upstream merge.
 *
 * Policy (see docs/superpowers/specs/2026-08-24-upstream-sync-design.md):
 * take upstream's file wholesale, then re-add the keys our fork introduced
 * since the merge base. Our fork adds keys and never modifies upstream's
 * existing values, so this is lossless in both directions.
 *
 * Usage, from a conflicted merge:
 *   node scripts/merge-locale-conflict.js
 * Resolves every conflicted file under src/localization/translations/ and
 * stages it. Follow with: node scripts/check-missing-translations.js
 */

const { execFileSync } = require('child_process');

const TRANSLATIONS_PREFIX = 'src/localization/translations/';

/**
 * @param {Record<string,string>|null} base   merge-base version (stage 1)
 * @param {Record<string,string>} ours        our version (stage 2)
 * @param {Record<string,string>} theirs      upstream version (stage 3)
 * @returns {Record<string,string>}
 */
function mergeLocale(base, ours, theirs) {
  const baseKeys = new Set(Object.keys(base || {}));
  const merged = { ...theirs };
  for (const [key, value] of Object.entries(ours)) {
    if (!baseKeys.has(key) && !(key in merged)) {
      merged[key] = value;
    }
  }
  return merged;
}

function readStage(stage, filePath) {
  try {
    const raw = execFileSync('git', ['show', `:${stage}:${filePath}`], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function conflictedTranslationFiles() {
  const out = execFileSync('git', ['diff', '--name-only', '--diff-filter=U'], {
    encoding: 'utf8',
  });
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith(TRANSLATIONS_PREFIX) && line.endsWith('.json'));
}

function main() {
  const files = conflictedTranslationFiles();
  if (files.length === 0) {
    console.log('No conflicted translation files.');
    return;
  }

  const fs = require('fs');
  for (const filePath of files) {
    const base = readStage(1, filePath);
    const ours = readStage(2, filePath);
    const theirs = readStage(3, filePath);

    if (!ours || !theirs) {
      console.error(`SKIPPED ${filePath}: missing our side or upstream's side; resolve by hand.`);
      continue;
    }

    const merged = mergeLocale(base, ours, theirs);
    const readded = Object.keys(merged).length - Object.keys(theirs).length;
    fs.writeFileSync(filePath, JSON.stringify(merged, null, 2) + '\n');
    execFileSync('git', ['add', filePath]);
    console.log(`resolved ${filePath} (upstream ${Object.keys(theirs).length} keys + ${readded} of ours)`);
  }

  console.log('\nNow run: node scripts/check-missing-translations.js');
}

module.exports = { mergeLocale };

if (require.main === module) {
  main();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/merge-locale-conflict.test.js`

Expected: PASS, `# pass 5`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add scripts/merge-locale-conflict.js scripts/merge-locale-conflict.test.js
git commit -m "sync: Add locale conflict merge helper"
```

---

### Task 3: Rung 1.3.5 — security patch (light)

5 upstream commits, 35 files, 11 overlapping, no locale conflicts. Overlap is in `auth/route.ts`, `caretaker/route.ts`, `settings/route.ts`, `types.ts`, `Dockerfile`, `CaretakerForm`, `SettingsForm/index.tsx`, `CaretakerModal`, `ChangePinModal`, `SettingsModal`, `SetupWizard/index.tsx`.

This release fixes an auth-forgery vulnerability and stops sending PINs and secrets to the browser. When a conflict here pits our `ktn:` change against their security change, **upstream's security behavior wins** — that is the point of the release. Keep our change only where it is orthogonal (naming, layout, ktn-specific config).

- [ ] **Step 1: Start the merge**

```bash
git merge 1.3.5 --no-commit --no-ff
git diff --name-only --diff-filter=U
```

Expected: a conflict list drawn from the 11 files above. If it merges cleanly with no conflicts, skip to Step 4.

- [ ] **Step 2: Take upstream's Dockerfile changes by hand, keeping our ktn base**

Our `Dockerfile` is a ktn-specific rewrite. Policy for every rung: keep our structure, hand-port upstream's substantive changes only.

```bash
git diff 1.3.4 1.3.5 -- Dockerfile
```

Read that diff, apply anything substantive into our Dockerfile with an editor, then:

```bash
git add Dockerfile
```

- [ ] **Step 3: Resolve the remaining conflicts by hand**

For each remaining file from Step 1's list, open it, resolve the `<<<<<<<`/`=======`/`>>>>>>>` markers, and stage it. Upstream's security logic wins; our ktn-specific changes survive only where they don't weaken it.

```bash
grep -rn '<<<<<<<' --include='*.ts' --include='*.tsx' app src | head
```

Expected: no output once every conflict is resolved.

- [ ] **Step 4: Verify typecheck and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: `tsc` prints nothing. `npm run build` ends with `✓ Compiled successfully` and a route table. Do not proceed on a failure.

- [ ] **Step 5: Commit the merge**

```bash
git commit -m "sync: Merge upstream 1.3.5"
git log --oneline -1
```

---

### Task 4: Rung 1.4.0 — accessibility, bath types, feed timers (deep)

18 upstream commits, 251 files, 44 overlapping plus all 9 locale files. Blast radius includes `DailyStats/index.tsx` (our stats feature), the hooks API and report route (our potty feature), `prisma/schema.prisma`, and `ActivityTileGroup/index.tsx` (our potty tile).

Watch for one deliberate non-change: upstream switched report-card averages to divide by days since birth. **Our potty stats keep their first-catch anchor.** Both live in `MonthlyReportCard`; do not re-base ours on theirs.

- [ ] **Step 1: Start the merge**

```bash
git merge 1.4.0 --no-commit --no-ff
git diff --name-only --diff-filter=U
```

- [ ] **Step 2: Resolve the 9 locale files with the script**

```bash
node scripts/merge-locale-conflict.js
node scripts/check-missing-translations.js
git add src/localization/translations/
```

Expected: the script prints one `resolved …` line per conflicted locale file, each reporting upstream's key count plus roughly 350 of ours.

- [ ] **Step 3: Restore upstream's nursery tree**

Our fork deleted these files, so they surface as delete-vs-modify conflicts. Policy: always take theirs.

```bash
git checkout MERGE_HEAD -- src/components/features/nursery-mode app/api/nursery-mode-settings 2>/dev/null || true
git add -A src/components/features/nursery-mode app/api/nursery-mode-settings 2>/dev/null || true
```

- [ ] **Step 4: Keep our Dockerfile, hand-porting upstream's changes**

```bash
git diff 1.3.5 1.4.0 -- Dockerfile
```

Apply anything substantive, then `git add Dockerfile`.

- [ ] **Step 5: Union-merge the schema and shared types**

`prisma/schema.prisma` and `app/api/types.ts` are additive on both sides. Keep every upstream model and field, and keep our `PottyLog` model and our baby config fields. Resolve, then:

```bash
git add prisma/schema.prisma app/api/types.ts
npx prisma validate
```

Expected: `The schema at prisma/schema.prisma is valid 🚀`.

- [ ] **Step 6: Resolve the remaining conflicts by hand**

```bash
git diff --name-only --diff-filter=U
```

Work that list, then confirm nothing is left:

```bash
grep -rn '<<<<<<<' --include='*.ts' --include='*.tsx' --include='*.prisma' app src prisma | head
```

Expected: no output.

- [ ] **Step 7: Verify typecheck and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: no `tsc` output; build ends with `✓ Compiled successfully`.

- [ ] **Step 8: Dry-run the migrations against the scratch database**

```bash
sed 's|url      = "file:../db/baby-tracker.db"|url      = "file:../db/sync-test.db"|' prisma/schema.prisma > prisma/sync-test.prisma
npx prisma migrate deploy --schema=prisma/sync-test.prisma
```

Expected: Prisma reports applying upstream's pending migrations (`20260711000000_add_feed_session_id`, `20260711000001_add_feed_timer_from`, `20260711000002_add_bath_type`) and ends with `All migrations have been successfully applied.` Our already-applied migrations are left alone despite sorting later by date.

- [ ] **Step 9: Smoke-test the affected features**

```bash
npm run dev
```

In the browser, confirm: the daily stats summary renders with our running average intact; the log-entry screen shows our potty tile in the activity tile group; opening the monthly report card shows both upstream's averages and our potty section. Stop the dev server when done.

- [ ] **Step 10: Commit the merge**

```bash
git commit -m "sync: Merge upstream 1.4.0"
```

---

### Task 5: Port our tests to vitest

Rung 1.4.0 brought vitest and a `test` script. Our six test files use `node:test` and have never had a runner. Porting them costs one import line each and gives every later rung automated regression coverage of the flip engine and potty stats.

**Files:**
- Modify: `src/components/DayNightFlip/engine.test.ts`
- Modify: `src/components/DayNightFlip/facts.test.ts`
- Modify: `src/components/DayNightFlip/protocol.test.ts`
- Modify: `src/components/DayNightFlip/schedule.test.ts`
- Modify: `src/components/DayNightFlip/wizards.test.ts`
- Modify: `src/components/Reports/potty-stats.utils.test.ts`

- [ ] **Step 1: Confirm vitest arrived and our tests are currently unrunnable**

```bash
grep -E '"test"|vitest' package.json
npm run test
```

Expected: `"test": "vitest run"` is present. The run either fails on our six files or reports zero tests from them, because `import { test } from 'node:test'` registers with Node's runner, not vitest.

- [ ] **Step 2: Switch the test import in all six files**

```bash
sed -i "s|import { test } from 'node:test';|import { test } from 'vitest';|" \
  src/components/DayNightFlip/engine.test.ts \
  src/components/DayNightFlip/facts.test.ts \
  src/components/DayNightFlip/protocol.test.ts \
  src/components/DayNightFlip/schedule.test.ts \
  src/components/DayNightFlip/wizards.test.ts \
  src/components/Reports/potty-stats.utils.test.ts
grep -rn "from 'node:test'" src/components/ | head
```

Expected: the grep prints nothing. `node:assert/strict` imports stay as they are — vitest runs them unchanged.

- [ ] **Step 3: Run the suite**

```bash
npm run test
```

Expected: PASS. All six of our files execute alongside upstream's, and the flip engine and potty stats assertions pass. If any of our tests fail, that is a real regression introduced by the 1.4.0 merge — fix it before continuing, do not skip the test.

- [ ] **Step 4: Commit**

```bash
git add src/components/DayNightFlip/*.test.ts src/components/Reports/potty-stats.utils.test.ts
git commit -m "sync: Run our tests under vitest"
```

---

### Task 6: Rung 1.5.0 — nursery redesign, photos, Baby Buddy import (deep)

112 upstream commits, 288 files, 37 overlapping plus 9 locale files. The nursery redesign lands here, but our nursery is fully decoupled, so those conflicts are mechanical. Real overlap: `activity-settings/route.ts`, `family/manage/route.ts`, `timeline/route.ts`, `prisma/schema.prisma`, `ActivityTileGroup/index.tsx`.

- [ ] **Step 1: Start the merge**

```bash
git merge 1.5.0 --no-commit --no-ff
git diff --name-only --diff-filter=U
```

- [ ] **Step 2: Resolve the locale files**

```bash
node scripts/merge-locale-conflict.js
node scripts/check-missing-translations.js
git add src/localization/translations/
```

- [ ] **Step 3: Restore upstream's nursery tree**

```bash
git checkout MERGE_HEAD -- src/components/features/nursery-mode app/api/nursery-mode-settings 2>/dev/null || true
git add -A src/components/features/nursery-mode app/api/nursery-mode-settings 2>/dev/null || true
```

- [ ] **Step 4: Keep our Dockerfile, hand-porting upstream's changes**

```bash
git diff 1.4.0 1.5.0 -- Dockerfile
```

Apply anything substantive, then `git add Dockerfile`.

- [ ] **Step 5: Union-merge the schema, then resolve the rest by hand**

Keep every upstream model (photos, import records, sleep-location changes) and our `PottyLog` and baby config fields.

```bash
git add prisma/schema.prisma
npx prisma validate
git diff --name-only --diff-filter=U
```

Work the remaining list, then confirm:

```bash
grep -rn '<<<<<<<' --include='*.ts' --include='*.tsx' --include='*.prisma' app src prisma | head
```

Expected: no output.

- [ ] **Step 6: Verify typecheck, build, and tests**

```bash
npx tsc --noEmit
npm run build
npm run test
```

Expected: no `tsc` output; `✓ Compiled successfully`; all tests pass including our six files.

- [ ] **Step 7: Dry-run the migrations**

```bash
sed 's|url      = "file:../db/baby-tracker.db"|url      = "file:../db/sync-test.db"|' prisma/schema.prisma > prisma/sync-test.prisma
npx prisma migrate deploy --schema=prisma/sync-test.prisma
```

Expected: `All migrations have been successfully applied.`

- [ ] **Step 8: Smoke-test**

```bash
npm run dev
```

Confirm: our nursery mode still loads at `/<slug>/nursery-mode` (the page still points at our component at this stage); potty logging from the nursery screen works; the timeline renders potty entries. Stop the dev server.

- [ ] **Step 9: Commit the merge**

```bash
git commit -m "sync: Merge upstream 1.5.0"
```

---

### Task 7: Rung 1.6.0 — foods and allergens (deep)

68 upstream commits, 160 files, 42 overlapping plus 9 locale files. This release **rewrites existing rows**: solid feeds are converted into food logs. The scratch-database dry run is the point of this task.

Overlap: the report route, `timeline/route.ts`, `timeline/export/route.ts`, `ActivityTileGroup/index.tsx`, `log-entry/page.tsx`, `client-layout.tsx`, `prisma/schema.prisma`.

- [ ] **Step 1: Start the merge**

```bash
git merge 1.6.0 --no-commit --no-ff
git diff --name-only --diff-filter=U
```

- [ ] **Step 2: Resolve the locale files**

```bash
node scripts/merge-locale-conflict.js
node scripts/check-missing-translations.js
git add src/localization/translations/
```

- [ ] **Step 3: Restore upstream's nursery tree**

```bash
git checkout MERGE_HEAD -- src/components/features/nursery-mode app/api/nursery-mode-settings 2>/dev/null || true
git add -A src/components/features/nursery-mode app/api/nursery-mode-settings 2>/dev/null || true
```

- [ ] **Step 4: Keep our Dockerfile, hand-porting upstream's changes**

```bash
git diff 1.5.0 1.6.0 -- Dockerfile
```

Apply anything substantive, then `git add Dockerfile`.

- [ ] **Step 5: Union-merge the schema, then resolve the rest by hand**

In `ActivityTileGroup/index.tsx` upstream adds a food tile while we have a potty tile — keep both. In the report route and report card, keep upstream's new food and allergen sections alongside our potty section.

```bash
git add prisma/schema.prisma
npx prisma validate
git diff --name-only --diff-filter=U
```

Work the remaining list, then confirm:

```bash
grep -rn '<<<<<<<' --include='*.ts' --include='*.tsx' --include='*.prisma' app src prisma | head
```

Expected: no output.

- [ ] **Step 6: Verify typecheck, build, and tests**

```bash
npx tsc --noEmit
npm run build
npm run test
```

- [ ] **Step 7: Record the pre-migration row counts on the scratch database**

```bash
sqlite3 db/sync-test.db "SELECT COUNT(*) AS solid_feeds FROM FeedLog WHERE type = 'SOLIDS';"
sqlite3 db/sync-test.db "SELECT COUNT(*) AS potty_logs FROM PottyLog;"
```

Expected: `solid_feeds` is **0** and `potty_logs` is **24**. This family never logged a solid feed, so upstream's conversion has nothing to convert — the dry run here proves the migration *executes* against our merged schema, not that it converts correctly.

- [ ] **Step 8: Run the migration and verify the conversion**

```bash
sed 's|url      = "file:../db/baby-tracker.db"|url      = "file:../db/sync-test.db"|' prisma/schema.prisma > prisma/sync-test.prisma
npx prisma migrate deploy --schema=prisma/sync-test.prisma
sqlite3 db/sync-test.db "SELECT COUNT(*) FROM FoodLog;"
sqlite3 db/sync-test.db "SELECT COUNT(*) FROM PottyLog;"
```

Expected: `All migrations have been successfully applied.` `FoodLog` is **0** (nothing to convert). **`PottyLog` is still 24 and `FeedLog` is still 701** — if either moved, stop and investigate before going further.

```bash
sqlite3 db/sync-test.db "SELECT COUNT(*) FROM FeedLog;"
sqlite3 db/sync-test.db "SELECT type, COUNT(*) FROM PottyLog GROUP BY type;"
```

Expected: 701 feeds; potty breakdown `DIRTY|1` and `WET|23`.

- [ ] **Step 9: Smoke-test**

```bash
npm run dev
```

Confirm: the log-entry screen shows both the new food tile and our potty tile; a potty entry still saves; the monthly report card renders our potty section next to upstream's new food section. Stop the dev server.

- [ ] **Step 10: Commit the merge**

```bash
git commit -m "sync: Merge upstream 1.6.0"
```

---

### Task 8: Rung 1.6.2 — WHO data, breastfeed pauses, webhook edit/delete, security (deep)

129 upstream commits, 236 files, 29 overlapping plus 9 locale files. Upstream never tagged 1.6.1, so this rung carries 1.6.1's content too. It ships a second row-rewriting migration (mixed bottle-type values) and a family-scoping security fix.

The hooks route is heavily restructured here. Task 9 handles re-registering potty with the new validator; this task's job is to land the merge with upstream's version of that file as the base.

- [ ] **Step 1: Start the merge**

```bash
git merge 1.6.2 --no-commit --no-ff
git diff --name-only --diff-filter=U
```

- [ ] **Step 2: Resolve the locale files**

```bash
node scripts/merge-locale-conflict.js
node scripts/check-missing-translations.js
git add src/localization/translations/
```

- [ ] **Step 3: Restore upstream's nursery tree**

```bash
git checkout MERGE_HEAD -- src/components/features/nursery-mode app/api/nursery-mode-settings 2>/dev/null || true
git add -A src/components/features/nursery-mode app/api/nursery-mode-settings 2>/dev/null || true
```

- [ ] **Step 4: Take upstream's hooks routes wholesale**

Upstream rewrote these files to add `PUT`/`DELETE` and strict validation. Hand-merging our potty additions into that rewrite is error-prone; take their version now and re-add potty deliberately in Task 9.

```bash
git checkout MERGE_HEAD -- "app/api/hooks/v1/babies/[babyId]/activities/route.ts" "app/api/hooks/v1/babies/[babyId]/status/route.ts"
git add "app/api/hooks/v1/babies/[babyId]/activities/route.ts" "app/api/hooks/v1/babies/[babyId]/status/route.ts"
```

Potty support in the webhook API is intentionally broken between here and Task 9. Do not deploy from this commit.

- [ ] **Step 5: Keep our Dockerfile, hand-porting upstream's changes**

```bash
git diff 1.6.0 1.6.2 -- Dockerfile
```

Apply anything substantive, then `git add Dockerfile`.

- [ ] **Step 6: Union-merge the schema, then resolve the rest by hand**

Where a conflict pits our change against their family-scoping security fix, **upstream's security behavior wins.**

```bash
git add prisma/schema.prisma
npx prisma validate
git diff --name-only --diff-filter=U
```

Work the remaining list, then confirm:

```bash
grep -rn '<<<<<<<' --include='*.ts' --include='*.tsx' --include='*.prisma' app src prisma | head
```

Expected: no output.

- [ ] **Step 7: Verify typecheck and build**

```bash
npx tsc --noEmit
npm run build
npm run test
```

- [ ] **Step 7b: Point our bottle-type normalizer at upstream's canonical value**

**Do this before the migration dry-run, or the dry run will look fine and production will silently drift.**

Upstream's `20260720120000_fix_mixed_bottle_type_slash` migration rewrites the mixed-bottle value from `Formula\Breast` (backslash) to `Formula/Breast` (forward slash), so it matches its translation key. In this database that is **156 of 701 feed rows**.

Our fork has a `normalizeBottleType` helper upstream does not have. It runs on every write path — `app/api/feed-log/route.ts` (create and update) and the hooks API — and it currently coerces the *correct* value back to the broken one:

```typescript
'formula\\breast': 'Formula\\Breast',
'formula/breast': 'Formula\\Breast',
```

Left alone, the migration fixes history while every new mixed bottle is written back as `Formula\Breast`. That is not cosmetic: upstream 1.6.2 filters on the string in `app/api/breast-milk-balance/route.ts` (`bottleType: { in: ['Breast Milk', 'Formula/Breast'] }`) and branches on it in four places in `src/components/Timeline/utils.tsx`. New mixed bottles would drop out of the breast-milk inventory silently.

This is mechanical conformance to upstream's data contract, the same category as the webhook validator in Task 9. Our decision to normalize on write stands; only the canonical target changes.

In `app/api/utils/bottleType.ts`, change both mixed-bottle entries to the forward-slash value:

```typescript
  'formula\\breast': 'Formula/Breast',
  'formula/breast': 'Formula/Breast',
```

Add a test at `tests/bottleType.test.ts` (the project's tests live in the top-level `tests/` folder):

```typescript
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { normalizeBottleType } from '@/app/api/utils/bottleType';

test('mixed bottles normalize to upstream canonical forward-slash form', () => {
  assert.equal(normalizeBottleType('Formula\\Breast'), 'Formula/Breast');
  assert.equal(normalizeBottleType('formula/breast'), 'Formula/Breast');
  assert.equal(normalizeBottleType('FORMULA/BREAST'), 'Formula/Breast');
});

test('other bottle types keep their canonical casing', () => {
  assert.equal(normalizeBottleType('formula'), 'Formula');
  assert.equal(normalizeBottleType('breast milk'), 'Breast Milk');
  assert.equal(normalizeBottleType('  '), null);
  assert.equal(normalizeBottleType(null), null);
  assert.equal(normalizeBottleType('Homemade'), 'Homemade');
});
```

Run it:

```bash
npm run test
```

Expected: PASS, including the two new tests.

- [ ] **Step 8: Dry-run the migrations and verify potty rows are untouched**

```bash
sqlite3 db/sync-test.db "SELECT COUNT(*) FROM PottyLog;"
sed 's|url      = "file:../db/baby-tracker.db"|url      = "file:../db/sync-test.db"|' prisma/schema.prisma > prisma/sync-test.prisma
npx prisma migrate deploy --schema=prisma/sync-test.prisma
sqlite3 db/sync-test.db "SELECT COUNT(*) FROM PottyLog;"
sqlite3 db/sync-test.db "SELECT DISTINCT bottleType FROM FeedLog WHERE bottleType IS NOT NULL;"
```

Expected: `All migrations have been successfully applied.` `PottyLog` is **24** both before and after, and `FeedLog` is still **701**.

This is the migration that actually rewrites production rows — 156 of them. Verify the rewrite happened and lost nothing:

```bash
sqlite3 db/sync-test.db "SELECT COALESCE(bottleType,'(null)'), COUNT(*) FROM FeedLog GROUP BY bottleType;"
```

Expected: **no `Formula\Breast` rows remain**, those 156 have moved to upstream's canonical mixed value, and the group counts still total 701.

- [ ] **Step 9: Commit the merge**

```bash
git commit -m "sync: Merge upstream 1.6.2"
```

---

### Task 9: Re-register potty with upstream's webhook validator

Upstream's hooks route now rejects any field not listed in `TYPE_FIELDS` for the activity type. Our potty fields flow through that validator, so they must be registered or every potty webhook call fails. This is mechanical conformance forced by their code path — the shape and semantics of our potty webhook API do not change.

**Files:**
- Modify: `app/api/hooks/v1/babies/[babyId]/activities/route.ts`

- [ ] **Step 1: Confirm potty is currently absent**

```bash
grep -n "potty" "app/api/hooks/v1/babies/[babyId]/activities/route.ts" | head
```

Expected: no output — Task 8 replaced this file with upstream's version.

- [ ] **Step 2: Add `potty` to the valid activity types**

Find the line beginning `const VALID_TYPES = [` and add `'potty'` after `'diaper'`, so it reads:

```typescript
const VALID_TYPES = ['sleep', 'feed', 'diaper', 'potty', 'note', 'pump', 'play', 'bath', 'measurement', 'medicine', 'supplement'] as const;
```

- [ ] **Step 3: Register potty's fields with the unknown-field validator**

In the `TYPE_FIELDS` object, add this entry after the `diaper` line:

```typescript
  potty: ['type', 'time', 'caretakerName', 'pottyType', 'pottyLocation', 'notes'],
```

`pottyLocation` stays a free-form string. It mirrors `SleepLog.location`, which upstream also stores as a human-readable string, so no enum validation is added for it.

- [ ] **Step 4: Add the POST handler case**

In the `switch (type as ActivityType)` block inside the POST handler, add this case after the `diaper` case. `normalizeRequiredEnumIfPresent` is upstream's helper — it accepts values case-insensitively and returns the canonical casing, which is how every other enum field in this file now behaves.

```typescript
      case 'potty': {
        const { pottyLocation, notes } = body;
        const pottyTypeResult = normalizeRequiredEnumIfPresent(body.pottyType, 'pottyType', ['WET', 'DIRTY', 'BOTH']);
        if (pottyTypeResult.error) return hookError('INVALID_POTTY_TYPE', pottyTypeResult.error, 400, rl.headers);
        const pottyType = pottyTypeResult.value;
        if (!pottyType) {
          return hookError('INVALID_POTTY_TYPE', 'pottyType must be WET, DIRTY, or BOTH', 400, rl.headers);
        }
        const notesResult = requireStringIfPresent(notes, 'notes');
        if (notesResult.error) return hookError('INVALID_FIELD', notesResult.error, 400, rl.headers);
        result = await prisma.pottyLog.create({
          data: { time, type: pottyType, pottyLocation: (pottyLocation as string) || null, notes: (notes as string) || null, babyId, caretakerId, familyId },
        });
        notifyActivityCreated(babyId, 'potty', { caretakerId }, { type: pottyType }).catch(console.error);
        return hookSuccess({ activityType: 'potty', id: result.id, time: result.time.toISOString(), details: { type: pottyType, pottyLocation, notes } }, { familyId, babyId }, rl.headers);
      }
```

- [ ] **Step 5: Restore potty in the GET handler**

In the GET handler, add this block alongside the other activity-type queries:

```typescript
  if (types.includes('potty')) {
    queries.push(
      prisma.pottyLog.findMany({
        where: { babyId, familyId, deletedAt: null, ...timeWhere },
        orderBy: { time: 'desc' },
        take: limit,
      }).then((rows) => rows.map((r) => ({
        activityType: 'potty',
        id: r.id,
        time: r.time.toISOString(),
        details: { type: r.type, pottyLocation: r.pottyLocation, notes: r.notes },
      })))
    );
  }
```

Match the surrounding queries' exact variable names and `where` shape — upstream may have renamed `queries` or changed the time filter in the rewrite. Read the `diaper` block directly above and mirror it.

- [ ] **Step 6: Verify typecheck and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: no `tsc` output; `✓ Compiled successfully`.

- [ ] **Step 7: Test the webhook end to end**

Start the dev server, then with a valid API key for a family and baby:

```bash
curl -s -X POST "http://localhost:3000/api/hooks/v1/babies/<babyId>/activities" \
  -H "X-API-Key: <key>" -H "Content-Type: application/json" \
  -d '{"type":"potty","pottyType":"wet","pottyLocation":"Toilet","notes":"webhook test"}'
```

Expected: a success response with `"activityType":"potty"` and `"type":"WET"` — lowercase input normalized to canonical casing by upstream's helper.

Then confirm the unknown-field rejection is active:

```bash
curl -s -X POST "http://localhost:3000/api/hooks/v1/babies/<babyId>/activities" \
  -H "X-API-Key: <key>" -H "Content-Type: application/json" \
  -d '{"type":"potty","pottyType":"WET","bogusField":"x"}'
```

Expected: a 400 with `INVALID_FIELD` naming `bogusField`.

Delete the test entries from the app afterward.

- [ ] **Step 8: Update the webhook documentation**

Our potty section in `documentation/Admin-Documentation/webhook-api.md` may have been overwritten by the merge. Confirm it documents `pottyType`, `pottyLocation`, and `notes`, and restore it from `git show 1.6.0~1:documentation/Admin-Documentation/webhook-api.md` if needed.

```bash
grep -n "potty" documentation/Admin-Documentation/webhook-api.md | head
```

Expected: our potty documentation is present.

- [ ] **Step 9: Commit**

```bash
git add "app/api/hooks/v1/babies/[babyId]/activities/route.ts" documentation/Admin-Documentation/webhook-api.md
git commit -m "potty: Conform webhook potty support to upstream validator"
```

`PUT`/`DELETE` support for potty entries is new functionality upstream introduced for its own types. It is out of scope here — potty `PUT`/`DELETE` requests return upstream's unknown-type error, which is correct behavior, not a regression.

---

### Task 10: Rung 1.6.3 — hotfix (light)

5 upstream commits, 12 files, 2 overlapping — `Dockerfile` and `.dockerignore` only. Upstream adds WHO data files to the Docker build and fixes breastfeed session link times.

- [ ] **Step 1: Start the merge**

```bash
git merge 1.6.3 --no-commit --no-ff
git diff --name-only --diff-filter=U
```

- [ ] **Step 2: Port the Docker changes into our ktn Dockerfile**

```bash
git diff 1.6.2 1.6.3 -- Dockerfile .dockerignore
```

The substantive change is including the WHO growth data files in the image. Our Dockerfile must include them or growth charts break in the ktn container. Apply the change, then:

```bash
git add Dockerfile .dockerignore
```

- [ ] **Step 3: Verify typecheck and build**

```bash
npx tsc --noEmit
npm run build
npm run test
```

- [ ] **Step 4: Commit the merge**

```bash
git commit -m "sync: Merge upstream 1.6.3"
```

---

### Task 11: Rung 1.6.4 — QoL and the native app layer (deep)

113 upstream commits, 238 files, 35 overlapping plus 9 locale files. Blast radius: `notifications/preferences/route.ts` (our potty notifications), `timeline/export/route.ts`, `db-backup.ts` (our ktn work), the report route, `client-layout.tsx`, `log-entry/page.tsx`, `prisma/schema.prisma`.

Upstream adds activity icons and caretaker badges to the timeline here, which touches the same components our stats feature edits. Upstream also adds dry-diaper logging — **we are not reworking our diaper-count invariant around it.** Merge it as an upstream feature and leave our potty/diaper relationship exactly as designed.

- [ ] **Step 1: Start the merge**

```bash
git merge 1.6.4 --no-commit --no-ff
git diff --name-only --diff-filter=U
```

- [ ] **Step 2: Resolve the locale files**

```bash
node scripts/merge-locale-conflict.js
node scripts/check-missing-translations.js
git add src/localization/translations/
```

- [ ] **Step 3: Restore upstream's nursery tree**

```bash
git checkout MERGE_HEAD -- src/components/features/nursery-mode app/api/nursery-mode-settings 2>/dev/null || true
git add -A src/components/features/nursery-mode app/api/nursery-mode-settings 2>/dev/null || true
```

- [ ] **Step 4: Keep our Dockerfile, hand-porting upstream's changes**

```bash
git diff 1.6.3 1.6.4 -- Dockerfile
```

Apply anything substantive, then `git add Dockerfile`.

- [ ] **Step 5: Preserve our potty notification preferences**

Upstream reworks notification preference ownership here. Our potty notification preference must survive.

```bash
grep -n "potty" app/api/notifications/preferences/route.ts | head
```

Expected after resolving: our potty preference entries are still present alongside upstream's changes.

- [ ] **Step 6: Union-merge the schema, then resolve the rest by hand**

In the timeline components, keep upstream's new activity icons and caretaker badges **and** our potty timeline entries and stats edits.

```bash
git add prisma/schema.prisma
npx prisma validate
git diff --name-only --diff-filter=U
```

Work the remaining list, then confirm:

```bash
grep -rn '<<<<<<<' --include='*.ts' --include='*.tsx' --include='*.prisma' app src prisma | head
```

Expected: no output.

- [ ] **Step 7: Verify typecheck, build, and tests**

```bash
npx tsc --noEmit
npm run build
npm run test
```

- [ ] **Step 8: Dry-run the migrations**

```bash
sqlite3 db/sync-test.db "SELECT COUNT(*) FROM PottyLog;"
sed 's|url      = "file:../db/baby-tracker.db"|url      = "file:../db/sync-test.db"|' prisma/schema.prisma > prisma/sync-test.prisma
npx prisma migrate deploy --schema=prisma/sync-test.prisma
sqlite3 db/sync-test.db "SELECT COUNT(*) FROM PottyLog;"
```

Expected: `All migrations have been successfully applied.` and a potty count of **24** both before and after.

- [ ] **Step 9: Smoke-test**

```bash
npm run dev
```

Confirm: the timeline shows upstream's activity icons and caretaker badges **and** our potty entries; potty notification preferences still appear in settings; the timeline export still includes potty rows. Stop the dev server.

- [ ] **Step 10: Commit the merge**

```bash
git commit -m "sync: Merge upstream 1.6.4"
```

---

### Task 12: Rung 1.6.5 and upstream main — polish (full)

33 upstream commits plus one trailing `main` commit. 95 files, 6 overlapping plus 9 locale files: `types.ts`, `Dockerfile`, two nursery files, `TimelineV2ActivityList.tsx`, `Timeline/utils.tsx`.

- [ ] **Step 1: Merge 1.6.5**

```bash
git merge 1.6.5 --no-commit --no-ff
git diff --name-only --diff-filter=U
```

- [ ] **Step 2: Resolve the locale files**

```bash
node scripts/merge-locale-conflict.js
node scripts/check-missing-translations.js
git add src/localization/translations/
```

- [ ] **Step 3: Restore upstream's nursery tree**

```bash
git checkout MERGE_HEAD -- src/components/features/nursery-mode app/api/nursery-mode-settings 2>/dev/null || true
git add -A src/components/features/nursery-mode app/api/nursery-mode-settings 2>/dev/null || true
```

- [ ] **Step 4: Keep our Dockerfile and resolve the rest by hand**

```bash
git diff 1.6.4 1.6.5 -- Dockerfile
```

Apply anything substantive, `git add Dockerfile`, then resolve `types.ts`, `TimelineV2ActivityList.tsx`, and `Timeline/utils.tsx`, keeping our potty entries and stats edits alongside upstream's sleep-location sorting.

```bash
grep -rn '<<<<<<<' --include='*.ts' --include='*.tsx' app src | head
```

Expected: no output.

- [ ] **Step 5: Verify and commit**

```bash
npx tsc --noEmit
npm run build
npm run test
git commit -m "sync: Merge upstream 1.6.5"
```

- [ ] **Step 6: Merge the trailing upstream main commit**

```bash
git fetch upstream main
git merge upstream/main -m "sync: Merge upstream main"
git diff --name-only --diff-filter=U
```

Expected: a clean merge of one CI workflow commit, or a trivial conflict in `.github/workflows/`. Our `build-publish.yml` and `deploy-ktn.yml` are ktn-specific — keep ours.

- [ ] **Step 7: Confirm the version landed**

```bash
grep '"version"' package.json
```

Expected: `"version": "1.6.5",`

---

### Task 13: Nursery mode variant toggle

Both implementations now coexist. This makes ours the default and upstream's reachable, without a schema change: the choice is device-local, matching upstream's own per-device nursery personalization. `?nursery=upstream` or `?nursery=ktn` sets and persists it.

**Files:**
- Modify: `app/(nursery)/[slug]/nursery-mode/page.tsx`

- [ ] **Step 1: Confirm both components exist and export what the page needs**

```bash
grep -n "export" src/components/NurseryMode/index.tsx | grep -i "NurseryMode" | head -3
grep -n "export" src/components/features/nursery-mode/NurseryModeContainer.tsx | grep -i "NurseryModeContainer" | head -3
```

Expected: a named export `NurseryMode` from ours and a named export `NurseryModeContainer` from upstream's. If either is a default export, adjust the dynamic imports in Step 2 accordingly.

- [ ] **Step 2: Replace the page with the toggle**

Write `app/(nursery)/[slug]/nursery-mode/page.tsx`:

```tsx
'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';

// Which nursery implementation renders. Ours is the default; upstream's is kept
// available so its ideas can be evaluated in place rather than reconstructed
// from a changelog. Device-local, matching upstream's own per-device nursery
// personalization — no schema change, no migration.
const NURSERY_VARIANT_KEY = 'nurseryModeVariant';

type NurseryVariant = 'ktn' | 'upstream';

function NurseryFallback() {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#0a0a1a]">
      <div className="text-white/50 text-sm">Loading...</div>
    </div>
  );
}

const KtnNurseryMode = dynamic(
  () => import('@/src/components/NurseryMode').then((m) => m.NurseryMode),
  { ssr: false, loading: NurseryFallback }
);

const UpstreamNurseryMode = dynamic(
  () => import('@/src/components/features/nursery-mode/NurseryModeContainer').then((m) => m.NurseryModeContainer),
  { ssr: false, loading: NurseryFallback }
);

export default function NurseryModePage() {
  const [variant, setVariant] = useState<NurseryVariant | null>(null);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('nursery');
    if (requested === 'upstream' || requested === 'ktn') {
      localStorage.setItem(NURSERY_VARIANT_KEY, requested);
    }
    setVariant(localStorage.getItem(NURSERY_VARIANT_KEY) === 'upstream' ? 'upstream' : 'ktn');
  }, []);

  if (variant === null) return <NurseryFallback />;
  return variant === 'upstream' ? <UpstreamNurseryMode /> : <KtnNurseryMode />;
}
```

Reading `localStorage` inside `useEffect` behind a `null` initial state avoids a hydration mismatch: the server and the first client render both produce the fallback.

- [ ] **Step 3: Verify typecheck and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: no `tsc` output; `✓ Compiled successfully`.

- [ ] **Step 4: Verify both variants render**

```bash
npm run dev
```

Visit `/<slug>/nursery-mode` — our nursery loads (the default, with potty logging present). Visit `/<slug>/nursery-mode?nursery=upstream` — upstream's redesigned nursery loads. Visit `/<slug>/nursery-mode` again with no query string — upstream's is still showing, because the choice persisted. Visit `/<slug>/nursery-mode?nursery=ktn` — ours returns and persists.

Leave the setting on `ktn` before stopping the dev server.

- [ ] **Step 5: Commit**

```bash
git add "app/(nursery)/[slug]/nursery-mode/page.tsx"
git commit -m "nursery: Add device-local variant toggle defaulting to ours"
```

---

### Task 14: Full verification pass

Everything below runs against the completed branch before anything touches the real database or `main`.

- [ ] **Step 1: Confirm the branch state**

```bash
git log --oneline main..HEAD | grep -c '^'
grep '"version"' package.json
git status --porcelain
```

Expected: the commit count covers all eight merges plus our task commits, version is `1.6.5`, and the tree is clean.

- [ ] **Step 2: Full clean build and test**

```bash
rm -rf .next
npx tsc --noEmit
npm run build
npm run test
node scripts/check-missing-translations.js
```

Expected: no `tsc` output; `✓ Compiled successfully`; all tests pass; the translation script reports no missing keys added (or adds only empties for languages upstream introduced, which is fine).

`npm run lint` is known-broken in this fork and is not a gate.

- [ ] **Step 3: Confirm our 350 translation keys survived all eight rungs**

```bash
node -e "
const base = require('child_process').execFileSync('git',['show','1.3.4:src/localization/translations/en.json'],{encoding:'utf8',maxBuffer:33554432});
const ours = require('child_process').execFileSync('git',['show','main:src/localization/translations/en.json'],{encoding:'utf8',maxBuffer:33554432});
const now = require('./src/localization/translations/en.json');
const b = JSON.parse(base), o = JSON.parse(ours);
const added = Object.keys(o).filter(k => !(k in b));
const lost = added.filter(k => !(k in now));
console.log('our keys:', added.length, '| lost in merge:', lost.length);
if (lost.length) console.log(lost.slice(0,20));
"
```

Expected: `our keys: 350 | lost in merge: 0`. Any lost key means the locale script missed a rung — restore it before continuing.

- [ ] **Step 4: Full-feature smoke test**

```bash
npm run dev
```

Walk all four of our features plus the headline upstream ones:

- **Potty** — log a catch from the log-entry screen; confirm the daily count increments and the **diaper count does not**; check the timeline entry, the Reports potty section, the heatmap lane, and the monthly report card section.
- **Day-night flip** — open the flip settings and confirm the schedule and wizard screens render with our config intact.
- **Daily summary running average** — confirm the running average renders in daily stats.
- **Nursery (ours)** — loads by default, potty logging works from it.
- **Nursery (upstream)** — `?nursery=upstream` loads their redesign.
- **Upstream features** — log a food entry, confirm the foods/allergens screens work, open a growth chart (WHO data), and confirm timeline icons and caretaker badges render.

Stop the dev server. Delete any test entries created.

- [ ] **Step 4b: Dry-run the startup data converter**

Prisma migrations are not the only thing that mutates production data on deploy.
`docker-startup.sh:130` runs `node scripts/convert-solids-feeds.js` on **every**
container start, and the same code runs from `/api/database/migrate*` after a backup
restore. It is not a Prisma migration, so the migration dry-runs in the rung tasks
never exercise it.

Unlike the Prisma CLI, this script honours `DATABASE_URL` — it passes a `datasources`
override to `PrismaClient` when the variable is set. Point it at the scratch copy with
an **absolute** path:

```bash
md5sum db/baby-tracker.db
sqlite3 db/sync-test.db "SELECT activitySettings FROM Settings WHERE activitySettings IS NOT NULL;"
DATABASE_URL="file:$(pwd)/db/sync-test.db" node scripts/convert-solids-feeds.js
sqlite3 db/sync-test.db "SELECT activitySettings FROM Settings WHERE activitySettings IS NOT NULL;"
sqlite3 db/sync-test.db "SELECT 'potty', COUNT(*) FROM PottyLog UNION ALL SELECT 'feed', COUNT(*) FROM FeedLog UNION ALL SELECT 'food', COUNT(*) FROM FoodLog;"
md5sum db/baby-tracker.db
```

Expected, verified 2026-08-24 against the production snapshot:

- Output reads `no SOLIDS feeds found, nothing to do. Food tile placed for 1 caretaker setting(s).`
- `activitySettings` gains `"food"` spliced into `order` directly after `"feed"`, and
  appended to `visible`. **`"potty"` keeps its position relative to `"diaper"`** — its
  index shifts by one, nothing more.
- Row counts unchanged: potty **24**, feed **701**, food **0**.
- The two `md5sum` values match, proving `db/baby-tracker.db` was never opened.

**Consequence for cutover:** on the first boot after deploy a **Food tile appears on
the log-entry screen, visible by default**. That is the only change this release makes
to live data for this family — there are no SOLIDS feeds to convert. Hiding the tile
is a manual toggle in settings afterwards; the merge cannot pre-empt it.

- [ ] **Step 5: Verify the Docker image builds**

The ktn deploy builds this image. A broken Dockerfile fails after cutover, not before.

```bash
docker build -t sprout-track:sync-test .
```

Expected: the build completes. Confirm the WHO data files from 1.6.3 made it in:

```bash
docker run --rm sprout-track:sync-test sh -c "ls /app/public 2>/dev/null | head; find /app -iname '*who*' -maxdepth 4 | head"
```

Expected: the WHO growth data files are present in the image.

---

### Task 15: Cutover to main and deploy

**Read this before running anything in this task.**

The ktn container runs `npx prisma migrate deploy` on every startup
(`docker-startup.sh:80`) against the live database in the `sprout-track_db-data`
volume, with **no backup step of its own**. So the push in Step 5 is what actually
migrates production — unattended, seconds after the image lands. The local
`db/baby-tracker.db` is a stale June dev copy and is not the data at risk.

Two consequences of the 1.3.5 security patch that land at this same moment:

- **Everyone is logged out.** Upstream replaced the hardcoded JWT fallback with a
  generated per-deployment `JWT_SECRET`. Existing sessions were signed with the old
  hardcoded secret and become invalid. This is upstream's intent, not a defect.
- `env:ensure` generates that secret inside the container on first boot, so no
  manual step is needed — but the first request after deploy may lag while it seeds.

- [ ] **Step 1: Back up the LIVE ktn volumes — this is the gate**

```bash
./ktn-scripts/backup-db.sh
```

Expected: three `.tar.gz` files (db, env, files) listed on both ktn and this laptop,
under `/tmp/sprout-track-backup-<timestamp>`. **Write that path down** — it is the
rollback. Do not proceed to any later step until this has succeeded.

- [ ] **Step 2: Record the LIVE database's baseline counts**

```bash
SNAP=$(mktemp -d)
ssh ktn "docker run --rm -v sprout-track_db-data:/data:ro -v /tmp:/out alpine cp /data/baby-tracker.db /out/pre-cutover.db"
scp -q ktn:/tmp/pre-cutover.db "$SNAP/"
ssh ktn "rm -f /tmp/pre-cutover.db"
sqlite3 "$SNAP/pre-cutover.db" "SELECT 'potty', COUNT(*) FROM PottyLog UNION ALL SELECT 'feed', COUNT(*) FROM FeedLog UNION ALL SELECT 'diaper', COUNT(*) FROM DiaperLog UNION ALL SELECT 'sleep', COUNT(*) FROM SleepLog;"
echo "baseline snapshot kept at $SNAP/pre-cutover.db"
```

Write all four numbers down and keep that snapshot until Step 6 confirms the deploy.
As of 2026-08-24 the baseline was potty 24, feed 701, diaper 759, sleep 327; expect
these to have grown by cutover time, since the family is actively logging.

- [ ] **Step 2b: Back up the local dev database too**

Secondary, but cheap:

```bash
STAMP=$(date +%Y%m%d-%H%M%S)
cp db/baby-tracker.db "db/baby-tracker.db.pre-cutover-${STAMP}.bak"
cp db/baby-tracker-logs.db "db/baby-tracker-logs.db.pre-cutover-${STAMP}.bak"
ls -la db/*pre-cutover*
```

Expected: two fresh `.bak` files.

- [ ] **Step 3: Merge to main**

```bash
git checkout main
git merge --no-ff sync/upstream-1.6.5 -m "sync: Merge upstream 1.3.4 to 1.6.5"
git log --oneline -1
```

- [ ] **Step 4: Migrate the real database**

```bash
npx prisma migrate deploy
sqlite3 db/baby-tracker.db "SELECT COUNT(*) AS potty FROM PottyLog;"
sqlite3 db/baby-tracker.db "SELECT COUNT(*) AS food FROM FoodLog;"
```

Expected: `All migrations have been successfully applied.` The potty count matches Step 2 exactly. The food count reflects the converted solid feeds from Step 2.

If the potty count moved, restore from the Step 1 backup and stop.

- [ ] **Step 5: Push and deploy**

This push triggers `build & publish` → `deploy-ktn`.

```bash
git push origin main
```

Watch the run:

```bash
gh run list --limit 3
```

Expected: `build & publish` succeeds, then `Deploy to ktn` succeeds.

Watch the container migrate the live database as it starts:

```bash
./ktn-scripts/logs.sh
```

Expected: `Running database migrations...` followed by Prisma applying upstream's
pending migrations and `All migrations have been successfully applied.` Ctrl-C once
the app is serving.

- [ ] **Step 6: Verify the live data survived**

Before touching the UI, prove the migration did not lose rows:

```bash
SNAP2=$(mktemp -d)
ssh ktn "docker run --rm -v sprout-track_db-data:/data:ro -v /tmp:/out alpine cp /data/baby-tracker.db /out/post-cutover.db"
scp -q ktn:/tmp/post-cutover.db "$SNAP2/"
ssh ktn "rm -f /tmp/post-cutover.db"
sqlite3 "$SNAP2/post-cutover.db" "SELECT 'potty', COUNT(*) FROM PottyLog UNION ALL SELECT 'feed', COUNT(*) FROM FeedLog UNION ALL SELECT 'diaper', COUNT(*) FROM DiaperLog UNION ALL SELECT 'sleep', COUNT(*) FROM SleepLog;"
sqlite3 "$SNAP2/post-cutover.db" "SELECT COALESCE(bottleType,'(null)'), COUNT(*) FROM FeedLog GROUP BY bottleType;"
```

Expected: potty, feed, diaper, and sleep counts all **match or exceed** the Step 2
baseline (they can only grow — the family may have logged during the deploy). No
`Formula\Breast` rows remain; those have moved to upstream's canonical mixed value.

**If any count dropped, roll back immediately** using the backup from Step 1:

```bash
ssh ktn "docker compose -f /opt/services/sprout-track/docker-compose.yml -f /opt/services/sprout-track/docker-compose.ktn.yml down"
ssh ktn "docker run --rm -v sprout-track_db-data:/data -v <backup-path>:/backup:ro alpine sh -c 'rm -rf /data/* && tar xzf /backup/sprout-track_db-data.tar.gz -C /data'"
```

Then revert the merge on `main` and re-deploy before investigating.

- [ ] **Step 7: Verify the app**

Open the deployed app and confirm: login works (**you will have to log in again — the
JWT secret changed**), the log-entry screen renders, a potty entry saves, our nursery
mode loads, and the version shows 1.6.5.

- [ ] **Step 8: Clean up**

Only after Step 6 and Step 7 both pass:

```bash
rm -f db/sync-test.db prisma/sync-test.prisma
git branch -d sync/upstream-1.6.5
```

`db/sync-test.db` holds a copy of production data — delete it once the sync is
confirmed. Keep the `.bak` files and the ktn backup tarballs until you are confident
the deploy is healthy; `backup-db.sh` prints its own cleanup command.

---

### Task 16: Write the sync runbook

Written now, while the conflict knowledge is fresh.

**Files:**
- Create: `documentation/upstream-sync.md`

- [ ] **Step 1: Write the runbook**

Create `documentation/upstream-sync.md`:

```markdown
# Syncing with upstream

We fork `Oak-and-Sprout/sprout-track`. This is how we pull their releases in
without losing potty/EC tracking, day-night flip, the daily-summary running
average, or the ktn deployment setup.

## Cadence

**Sync at every upstream tag.** One release is a coffee break. We once let eight
accumulate and it became a multi-day project — see
`docs/superpowers/plans/2026-08-24-upstream-sync-1.6.5.md`.

## Procedure

1. `git fetch upstream --tags` and list what is new:
   `git tag --sort=-v:refname | head`
2. Branch: `git checkout -b sync/upstream-<version>`
3. Back up the real database before any migration:
   `cp db/baby-tracker.db db/baby-tracker.db.pre-upstream-$(date +%Y%m%d-%H%M%S).bak`
4. Merge one tag at a time: `git merge <tag> --no-commit --no-ff`
5. Resolve using the recipes below.
6. Verify: `npx tsc --noEmit && npm run build && npm run test`
7. Migrate a copy first: `cp db/baby-tracker.db db/sync-test.db` then
   The datasource URL is a literal in `schema.prisma` (Prisma requires it — see
   `scripts/prisma-provider.js`), so `DATABASE_URL` is ignored. Use a scratch schema:
   `sed 's|url      = "file:../db/baby-tracker.db"|url      = "file:../db/sync-test.db"|' prisma/schema.prisma > prisma/sync-test.prisma`
   then `npx prisma migrate deploy --schema=prisma/sync-test.prisma`
8. Merge to `main` only when done — a push to `main` deploys to ktn.

## Conflict recipes

| What | Recipe |
| --- | --- |
| `src/localization/translations/*.json` | `node scripts/merge-locale-conflict.js` then `node scripts/check-missing-translations.js`. Takes upstream's file and re-adds the keys we introduced. |
| `src/components/features/nursery-mode/*`, `app/api/nursery-mode-settings/` | Always take theirs: `git checkout MERGE_HEAD -- <paths>`. Our nursery lives at `src/components/NurseryMode/` and is fully decoupled. |
| `Dockerfile`, `.dockerignore` | Keep ours (ktn-specific) and hand-port upstream's substantive changes. Check `git diff <prev-tag> <tag> -- Dockerfile`. |
| `prisma/schema.prisma` | Union. Keep every upstream model plus our `PottyLog` and baby config fields. Verify with `npx prisma validate`. |
| `app/api/types.ts` | Union. Our potty types are additive. |
| `app/api/hooks/v1/.../activities/route.ts` | If upstream restructured it, take theirs and re-add potty: `'potty'` in `VALID_TYPES`, a `potty` entry in `TYPE_FIELDS`, the `case 'potty'` POST branch, and the GET query block. |
| Anything touching security | Upstream's security behavior wins over our convenience changes. |

## Hotspots

Files upstream touches in nearly every release that we have also modified:
`app/api/types.ts`, `Dockerfile`, `prisma/schema.prisma`, the nine translation
files, `app/api/timeline/route.ts`, the monthly report route, and
`src/components/ActivityTileGroup/index.tsx`.

## Principle

**Our decisions stand; upstream is absorbed, not adopted.** Where upstream made a
different call than we did, ours survives the merge. We conform to upstream only
where their code path mechanically requires it — for example, registering our
potty fields with their webhook field validator.

Two exceptions: security fixes always win, and their migrations always run.
```

- [ ] **Step 2: Verify the referenced paths exist**

```bash
ls scripts/merge-locale-conflict.js scripts/check-missing-translations.js src/components/NurseryMode docs/superpowers/plans/2026-08-24-upstream-sync-1.6.5.md
```

Expected: every path listed, no errors.

- [ ] **Step 3: Commit**

```bash
git add documentation/upstream-sync.md
git commit -m "docs: Add upstream sync runbook"
```

---

## Follow-up plan (not this plan)

The isolation refactor from the spec's Phase 2 — pulling our logic in `DailyStats`,
`TimelineV2`, and `ActivityTileGroup` behind seams so upstream files carry a call
site rather than scattered edits — gets its own plan after this one lands. It is
deliberately sequenced after the merge, since refactoring against code that is
about to shift underneath is wasted work. Nursery needs nothing: it is already
fully isolated.
