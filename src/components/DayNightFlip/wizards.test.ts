import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLIP_WIZARDS } from './wizards';

const ids = Object.keys(FLIP_WIZARDS);

test('all four wizards exist with entries', () => {
  assert.deepEqual(ids.sort(), ['bottle', 'gas', 'pacifier', 'rescue']);
  for (const id of ids) {
    const w = FLIP_WIZARDS[id as keyof typeof FLIP_WIZARDS];
    assert.ok(w.nodes[w.entry], `${id} entry node exists`);
  }
});

test('every reference resolves (node keys and @wizard jumps)', () => {
  for (const id of ids) {
    const w = FLIP_WIZARDS[id as keyof typeof FLIP_WIZARDS];
    for (const [key, node] of Object.entries(w.nodes)) {
      const refs =
        node.kind === 'question'
          ? node.options.map(o => o.to)
          : (node.links ?? []).map(l => l.to);
      for (const ref of refs) {
        if (ref.startsWith('@')) {
          assert.ok(ids.includes(ref.slice(1)), `${id}/${key} → ${ref} is a wizard`);
        } else {
          assert.ok(w.nodes[ref], `${id}/${key} → ${ref} resolves`);
        }
      }
    }
  }
});

test('every path from entry terminates at an outcome within 10 steps', () => {
  for (const id of ids) {
    const w = FLIP_WIZARDS[id as keyof typeof FLIP_WIZARDS];
    const walk = (key: string, depth: number) => {
      assert.ok(depth <= 10, `${id}/${key} depth ${depth}`);
      const node = w.nodes[key];
      if (node.kind === 'outcome') return;
      for (const o of node.options) {
        if (!o.to.startsWith('@')) walk(o.to, depth + 1);
      }
    };
    walk(w.entry, 0);
  }
});

test('no orphan nodes', () => {
  for (const id of ids) {
    const w = FLIP_WIZARDS[id as keyof typeof FLIP_WIZARDS];
    const reachable = new Set<string>([w.entry]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const key of [...reachable]) {
        const node = w.nodes[key];
        const refs = node.kind === 'question'
          ? node.options.map(o => o.to)
          : (node.links ?? []).map(l => l.to);
        for (const r of refs) {
          if (!r.startsWith('@') && !reachable.has(r)) { reachable.add(r); grew = true; }
        }
      }
    }
    assert.deepEqual([...reachable].sort(), Object.keys(w.nodes).sort(), `${id} all nodes reachable`);
  }
});
