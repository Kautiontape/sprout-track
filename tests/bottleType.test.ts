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
