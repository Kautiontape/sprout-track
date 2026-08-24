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
