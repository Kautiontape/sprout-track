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
