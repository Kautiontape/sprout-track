#!/usr/bin/env node

/**
 * Normalize FeedLog.bottleType values to the canonical casing used across the app.
 *
 * Older records created by nursery mode were stored lowercase (e.g. 'formula',
 * 'breast milk'), which broke exact-match reads in the reports, the timeline,
 * the daily summary breakdown, and the breast-milk balance. The feed-log API
 * now canonicalizes on write; this script fixes records saved before that change.
 *
 * Usage:
 *   node scripts/normalize-bottle-types.js --dry-run   # preview, no writes
 *   node scripts/normalize-bottle-types.js             # apply changes
 *
 * Works for both SQLite and PostgreSQL (uses the generated Prisma client +
 * DATABASE_URL). Run it from the project root on the host where the database lives.
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Must match normalizeBottleType() in app/api/utils/bottleType.ts
const CANONICAL = {
  'formula': 'Formula',
  'breast milk': 'Breast Milk',
  'formula\\breast': 'Formula\\Breast',
  'formula/breast': 'Formula\\Breast',
  'milk': 'Milk',
  'other': 'Other',
};

function normalize(value) {
  if (!value || !value.trim()) return null;
  const trimmed = value.trim();
  return CANONICAL[trimmed.toLowerCase()] || trimmed;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const groups = await prisma.feedLog.groupBy({
    by: ['bottleType'],
    _count: { _all: true },
  });

  console.log(`\nFound ${groups.length} distinct bottleType value(s):`);
  let totalToFix = 0;

  for (const g of groups) {
    const current = g.bottleType;
    const count = g._count._all;

    if (current == null) {
      console.log(`  (null)  ${count}`);
      continue;
    }

    const target = normalize(current);
    if (target === current) {
      console.log(`  "${current}"  ${count}  - already canonical`);
      continue;
    }

    totalToFix += count;
    console.log(`  "${current}" -> "${target}"  ${count}  ${dryRun ? '(would update)' : '(updating)'}`);

    if (!dryRun) {
      const res = await prisma.feedLog.updateMany({
        where: { bottleType: current },
        data: { bottleType: target },
      });
      if (res.count !== count) {
        console.log(`    note: updated ${res.count} (expected ${count})`);
      }
    }
  }

  console.log(
    `\n${dryRun ? 'DRY RUN - no changes written. ' : 'Done. '}` +
    `${totalToFix} record(s) ${dryRun ? 'would be' : 'were'} normalized.\n`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
