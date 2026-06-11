import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveFacts, weightToOz, RawActivityData, FlipOverride } from './facts';

const NOW = new Date('2026-06-11T15:00:00');
const iso = (s: string) => new Date(s).toISOString();

const EMPTY: RawActivityData = {
  sleepLogs: [], lastFeed: null, diaperLogs: [], weights: [],
  birthDate: iso('2026-05-14T12:00:00'),
};

test('weightToOz handles lb, kg, oz, unknown', () => {
  assert.equal(weightToOz(7, 'lb'), 112);
  assert.equal(weightToOz(1, 'oz'), 1);
  assert.ok(Math.abs(weightToOz(3, 'kg')! - 105.82) < 0.1);
  assert.equal(weightToOz(5, 'stone'), null);
});

test('wake = latest endTime; open log = napStartTime', () => {
  const raw: RawActivityData = {
    ...EMPTY,
    sleepLogs: [
      { startTime: iso('2026-06-11T09:00:00'), endTime: iso('2026-06-11T10:30:00') },
      { startTime: iso('2026-06-11T12:00:00'), endTime: iso('2026-06-11T13:15:00') },
      { startTime: iso('2026-06-11T14:30:00'), endTime: null },
    ],
  };
  const f = deriveFacts(raw, null, NOW);
  assert.equal(f.lastWakeTime!.getTime(), new Date('2026-06-11T13:15:00').getTime());
  assert.equal(f.napStartTime!.getTime(), new Date('2026-06-11T14:30:00').getTime());
});

test('override beats derived facts until a newer real log supersedes it', () => {
  const override: FlipOverride = {
    kind: 'wake', time: iso('2026-06-11T14:00:00'), setAt: iso('2026-06-11T14:01:00'),
  };
  // no logs at all -> override wins
  const f1 = deriveFacts(EMPTY, override, NOW);
  assert.equal(f1.lastWakeTime!.getTime(), new Date('2026-06-11T14:00:00').getTime());
  assert.equal(f1.napStartTime, null);
  // a wake logged AFTER setAt supersedes the override
  const raw: RawActivityData = {
    ...EMPTY,
    sleepLogs: [{ startTime: iso('2026-06-11T13:00:00'), endTime: iso('2026-06-11T14:30:00') }],
  };
  const f2 = deriveFacts(raw, override, NOW);
  assert.equal(f2.lastWakeTime!.getTime(), new Date('2026-06-11T14:30:00').getTime());
  // a 'down' override marks the baby as sleeping
  const down: FlipOverride = {
    kind: 'down', time: iso('2026-06-11T14:45:00'), setAt: iso('2026-06-11T14:46:00'),
  };
  const f3 = deriveFacts(raw, down, NOW);
  assert.equal(f3.napStartTime!.getTime(), new Date('2026-06-11T14:45:00').getTime());
});

test('diapers count in trailing 24h; BOTH counts as wet and dirty; no data -> null', () => {
  const raw: RawActivityData = {
    ...EMPTY,
    diaperLogs: [
      { time: iso('2026-06-11T10:00:00'), type: 'WET' },
      { time: iso('2026-06-11T08:00:00'), type: 'BOTH' },
      { time: iso('2026-06-10T20:00:00'), type: 'DIRTY' },
      { time: iso('2026-06-09T10:00:00'), type: 'WET' }, // outside 24h
    ],
  };
  const f = deriveFacts(raw, null, NOW);
  assert.equal(f.wetDiapersLast24h, 2);   // WET + BOTH
  assert.equal(f.dirtyDiapersLast24h, 2); // DIRTY + BOTH
  assert.equal(deriveFacts(EMPTY, null, NOW).wetDiapersLast24h, null);
});

test('two most recent parseable weights, normalized to oz', () => {
  const raw: RawActivityData = {
    ...EMPTY,
    weights: [
      { date: iso('2026-06-01T10:00:00'), value: 7.0, unit: 'lb' },
      { date: iso('2026-06-10T10:00:00'), value: 7.5, unit: 'lb' },
      { date: iso('2026-05-20T10:00:00'), value: 6.5, unit: 'lb' },
    ],
  };
  const f = deriveFacts(raw, null, NOW);
  assert.equal(f.latestWeight!.oz, 120);   // 7.5 lb
  assert.equal(f.previousWeight!.oz, 112); // 7.0 lb
});
