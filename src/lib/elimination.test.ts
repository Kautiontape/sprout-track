// src/lib/elimination.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestElimination } from './elimination';

const EARLY = new Date(2026, 6, 29, 8, 0, 0, 0);
const LATE = new Date(2026, 6, 29, 11, 30, 0, 0);

test('returns the potty time when it is the more recent of the two', () => {
  assert.deepEqual(latestElimination(EARLY, LATE), { time: LATE, source: 'potty' });
});

test('returns the diaper time when it is the more recent of the two', () => {
  assert.deepEqual(latestElimination(LATE, EARLY), { time: LATE, source: 'diaper' });
});

test('returns the diaper time when only a diaper exists', () => {
  assert.deepEqual(latestElimination(EARLY, null), { time: EARLY, source: 'diaper' });
});

test('returns the potty time when only a potty catch exists', () => {
  assert.deepEqual(latestElimination(null, EARLY), { time: EARLY, source: 'potty' });
});

test('returns null when neither exists', () => {
  assert.equal(latestElimination(null, null), null);
});

test('prefers diaper when the two timestamps are identical', () => {
  // Arbitrary but deterministic: a tie must not flip the badge between renders.
  assert.deepEqual(latestElimination(EARLY, new Date(EARLY.getTime())), { time: EARLY, source: 'diaper' });
});

test('accepts ISO strings as well as Date objects', () => {
  assert.deepEqual(
    latestElimination(EARLY.toISOString(), LATE.toISOString()),
    { time: LATE, source: 'potty' }
  );
});

test('accepts epoch milliseconds', () => {
  // NurseryMode holds times as epoch ms (DiaperSnap.time / PottySnap.time),
  // so this overload is load-bearing, not a convenience.
  assert.deepEqual(
    latestElimination(EARLY.getTime(), LATE.getTime()),
    { time: LATE, source: 'potty' }
  );
});

test('treats an invalid date as absent', () => {
  assert.deepEqual(latestElimination('not-a-date', EARLY), { time: EARLY, source: 'potty' });
});
