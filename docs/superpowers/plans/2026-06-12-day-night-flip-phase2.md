# Day/Night Flip Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the four phase-2 features from `docs/superpowers/specs/2026-06-12-day-night-flip-phase2-design.md`: wizards, FAQ bank, live-adapted schedule view, and HA flip-state exposure.

**Architecture:** Engine-outward. Extend the pure layer first (`rescueTiming` + exported helpers in `engine.ts`, wizard trees in `wizards.ts`, `FLIP_FAQ` in `protocol.ts`, `projectDay` in `schedule.ts`), then the surfaces (WizardPanel, FlipFaq, FlipSchedule, three-view toggle), then the server-side reuse (status route). All new logic is pure and table-tested with `node:test` via `tsx`.

**Tech Stack:** Same as MVP — Next.js 16, TypeScript, Prisma 6 + SQLite, `npx tsx --test` for tests. **Never run plain `npm install`** (sharp race — see MVP plan); no new dependencies are needed.

**Conventions:** commits `flip: <message>`, no Co-Authored-By; all static strings through `t()` (en.json key===value); tests use relative imports only. Dev server is already running on :3000.

---

### Task 1: engine.ts — export time helpers, `sleepState`, `rescueTiming` (TDD)

**Files:**
- Modify: `src/components/DayNightFlip/engine.ts`
- Test: append to `src/components/DayNightFlip/engine.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
// append to engine.test.ts
import { rescueTiming, sleepState } from './engine';

test('rescueTiming: before 16:00 is not the final nap', () => {
  const r = rescueTiming(CFG, at(11, 0));
  assert.equal(r.isFinalNap, false);
  assert.equal(r.wakeBy, null);
});

test('rescueTiming: after 16:00 caps the nap and computes early bedtime', () => {
  const r = rescueTiming(CFG, at(16, 30));
  assert.equal(r.isFinalNap, true);
  // wakeBy = 16:30 + 90m = 18:00
  assert.equal(r.wakeBy!.getHours(), 18);
  assert.equal(r.wakeBy!.getMinutes(), 0);
  // routineStart = min(18:00 + 60m target, 19:15 anchor) = 19:00
  assert.equal(r.routineStart!.getHours(), 19);
  assert.equal(r.routineStart!.getMinutes(), 0);
});

test('sleepState matches resolveNow semantics', () => {
  const napping = sleepState(facts({ napStartTime: at(9, 30), lastWakeTime: at(8, 30) }), at(10, 0));
  assert.equal(napping.sleeping, true);
  const stale = sleepState(facts({ lastWakeTime: at(21, 0, -1) }), at(10, 0));
  assert.equal(stale.wakeKnown, false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test src/components/DayNightFlip/engine.test.ts`
Expected: FAIL — `rescueTiming` not exported.

- [ ] **Step 3: Implement in engine.ts**

Export the private helpers (change `const minutesOfDay/parseHHMM/minutesBetween/addMinutes/fmt/fmtMin` declarations to `export const`, renaming `fmt` → `fmtClock` everywhere in the file). Extract the staleness logic into an exported `sleepState` and refactor `resolveNow` to call it (same semantics, incl. the −2 min skew clamp):

```ts
export type SleepState = {
  sleeping: boolean;
  wakeKnown: boolean;
  napElapsedMin: number | null;
  rawWakeElapsed: number | null;
};

export function sleepState(facts: ActivityFacts, now: Date): SleepState {
  const clampSkew = (min: number | null) =>
    min !== null && min >= -2 ? Math.max(0, min) : min;
  const rawNapElapsed = clampSkew(facts.napStartTime ? minutesBetween(now, facts.napStartTime) : null);
  const sleeping = rawNapElapsed !== null && rawNapElapsed >= 0 && rawNapElapsed < STALE_FACT_MIN;
  const rawWakeElapsed = clampSkew(facts.lastWakeTime ? minutesBetween(now, facts.lastWakeTime) : null);
  const wakeKnown = rawWakeElapsed !== null && rawWakeElapsed >= 0 && rawWakeElapsed < STALE_FACT_MIN;
  return { sleeping, wakeKnown, napElapsedMin: sleeping ? rawNapElapsed : null, rawWakeElapsed };
}

const RESCUE_FINAL_NAP_AFTER_MIN = 16 * 60; // R-20: rescue at/after ~16:00

export type RescueTiming = {
  isFinalNap: boolean;
  wakeBy: Date | null;        // rescue nap cap (R-20)
  routineStart: Date | null;  // early bedtime (R-21)
};

export function rescueTiming(config: FlipConfig, now: Date): RescueTiming {
  if (minutesOfDay(now) < RESCUE_FINAL_NAP_AFTER_MIN) {
    return { isFinalNap: false, wakeBy: null, routineStart: null };
  }
  const wakeBy = addMinutes(now, config.durations.rescueNapMaxMin);
  const projected = addMinutes(wakeBy, config.dayMode.wakeWindowTargetMin[1]);
  const anchorMin = parseHHMM(config.anchors.bedtimeRoutine);
  const anchor = new Date(now);
  anchor.setHours(Math.floor(anchorMin / 60), anchorMin % 60, 0, 0);
  return { isFinalNap: true, wakeBy, routineStart: projected < anchor ? projected : anchor };
}
```

Inside `resolveNow`, replace the inline staleness block with:
```ts
  const { sleeping, wakeKnown, napElapsedMin, rawWakeElapsed } = sleepState(facts, now);
  const wakeWindowElapsedMin = !sleeping && wakeKnown ? rawWakeElapsed : null;
```

- [ ] **Step 4: Run all tests** — `npx tsx --test src/components/DayNightFlip/*.test.ts` → 24 pass.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "flip: export engine helpers, add sleepState and rescueTiming"`

---

### Task 2: wizards.ts — four decision trees + integrity tests (TDD)

**Files:**
- Create: `src/components/DayNightFlip/wizards.ts`
- Test: `src/components/DayNightFlip/wizards.test.ts`

- [ ] **Step 1: Write the failing integrity tests**

```ts
// src/components/DayNightFlip/wizards.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLIP_WIZARDS, WizardNode } from './wizards';

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
```

- [ ] **Step 2: Run to verify failure** — module missing.

- [ ] **Step 3: Write the wizard data**

```ts
// src/components/DayNightFlip/wizards.ts
// "When it goes sideways" decision trees (ruleset R-13/15/16/17/18/20/21/30/31).
// Data only — WizardPanel.tsx walks these. Strings double as en.json keys.

export type WizardId = 'rescue' | 'pacifier' | 'gas' | 'bottle';

export type WizardNode =
  | { kind: 'question'; prompt: string; help?: string;
      options: { label: string; to: string }[] }   // to: node key or '@wizardId'
  | { kind: 'outcome'; title: string; actions: string[]; why: string;
      ruleIds: string[]; dynamic?: 'rescue-timing';
      links?: { label: string; to: string }[] };

export type Wizard = {
  id: WizardId; title: string; entry: string;
  nodes: Record<string, WizardNode>;
};

export const FLIP_WIZARDS: Record<WizardId, Wizard> = {
  rescue: {
    id: 'rescue',
    title: 'Putdown isn’t working',
    entry: 'duration',
    nodes: {
      duration: {
        kind: 'question',
        prompt: 'How long has this putdown attempt been going?',
        options: [
          { label: 'Under 10 minutes — she’s fussing in the crib', to: 'fussType' },
          { label: '20+ minutes, or this is the second failed attempt', to: 'gasCheck' },
          { label: 'She’s been awake past the 75-minute ceiling', to: 'gasCheck' },
        ],
      },
      fussType: {
        kind: 'question',
        prompt: 'What does the fussing look like?',
        help: 'Newborn active sleep looks alarmingly like waking.',
        options: [
          { label: 'Grunting, squirming, intermittent — eyes closed or half-closed', to: 'wait' },
          { label: 'Sustained, escalating, genuine crying', to: 'gasCheck' },
        ],
      },
      wait: {
        kind: 'outcome',
        title: 'Wait 5–10 minutes — this is often active sleep',
        actions: [
          'Stay out of the room; watch, don’t touch',
          'Set a 10-minute timer before you intervene',
          'If it escalates into real crying, come back here',
        ],
        why: 'Intervening interrupts a baby who is mid-descent into sleep. And you cannot spoil a baby this young — if it becomes real crying, helping costs nothing.',
        ruleIds: ['R-13'],
        links: [{ label: 'It became real crying', to: 'gasCheck' }],
      },
      gasCheck: {
        kind: 'question',
        prompt: 'Any gas signs? Arching her back, farting, calm upright on your chest but raging when laid flat?',
        options: [
          { label: 'Yes — that sounds like her right now', to: '@gas' },
          { label: 'No gas signs', to: 'pacifierCheck' },
        ],
      },
      pacifierCheck: {
        kind: 'question',
        prompt: 'Is the pacifier looping? In → spit out → cry → replace → repeat?',
        options: [
          { label: 'Yes, that exact loop', to: '@pacifier' },
          { label: 'No pacifier involved', to: 'rescueNow' },
        ],
      },
      rescueNow: {
        kind: 'outcome',
        title: 'Rescue this nap — abandon the crib for this cycle',
        actions: [
          'Fastest means wins: contact nap, motion (carrier, stroller), rocking, or feeding down',
          'White noise and contact napping are legal rescue tools for one nap',
          'Don’t let the rescue become the default — the daytime feeds and the nap cap are what matter',
        ],
        why: 'An overtired baby sleeps worse at night, so a rescued nap beats ideological purity. One held nap doesn’t break the protocol.',
        ruleIds: ['R-15', 'R-16'],
        dynamic: 'rescue-timing',
      },
    },
  },
  pacifier: {
    id: 'pacifier',
    title: 'Pacifier keeps failing',
    entry: 'confirm',
    nodes: {
      confirm: {
        kind: 'question',
        prompt: 'What’s the pattern?',
        options: [
          { label: 'In → spit out → cry → replace → repeat', to: 'dropIt' },
          { label: 'She takes it and settles', to: 'keepIt' },
        ],
      },
      dropIt: {
        kind: 'outcome',
        title: 'Abandon the pacifier for this settling attempt',
        actions: [
          'Switch to motion or contact — they demand nothing from her',
          'Try the pacifier again another time, when she’s less tired',
        ],
        why: 'A pacifier requires active sucking to retain; an overtired baby can’t sustain it, so it becomes a wake-up loop rather than a soother.',
        ruleIds: ['R-17'],
        links: [{ label: 'Back to the rescue flow', to: '@rescue' }],
      },
      keepIt: {
        kind: 'outcome',
        title: 'The pacifier is doing its job',
        actions: [
          'Carry on — it’s a soothing tool',
          'Never use it to stall a hungry baby; a pacifier stall produces a worked-up baby who then feeds poorly',
        ],
        why: 'The pacifier only fails when the baby is too tired to suck. Settled means it’s working.',
        ruleIds: ['R-17', 'R-10'],
      },
    },
  },
  gas: {
    id: 'gas',
    title: 'Gas check',
    entry: 'signs',
    nodes: {
      signs: {
        kind: 'question',
        prompt: 'Which of these fits?',
        options: [
          { label: 'Sleepy but screams when laid flat; calm upright on a chest', to: 'protocol' },
          { label: 'Arching, farting, nap resistance running past 30–45 minutes', to: 'protocol' },
          { label: 'None of these, actually', to: 'noGas' },
        ],
      },
      protocol: {
        kind: 'outcome',
        title: 'Run the gas protocol',
        actions: [
          'Bicycle her legs, then clockwise tummy massage',
          'Belly-down across your forearm during awake time',
          'Make mid-feed burps mandatory for the next several feeds — a burp captured mid-feed is a fart she doesn’t fight at naptime',
        ],
        why: 'Lying flat worsens trapped-gas discomfort — which is why chest = calm, crib = rage. Fast, frantic bottle feeds are the #1 source of swallowed air.',
        ruleIds: ['R-18'],
        links: [{ label: 'Bottle feeds emptying too fast?', to: '@bottle' }],
      },
      noGas: {
        kind: 'outcome',
        title: 'Probably not gas',
        actions: ['Go back to settling — classify the fussing and rescue if needed'],
        why: 'Without the upright-vs-flat pattern or visible signs, gas is unlikely to be the blocker.',
        ruleIds: ['R-18'],
        links: [{ label: 'Back to the rescue flow', to: '@rescue' }],
      },
    },
  },
  bottle: {
    id: 'bottle',
    title: 'Finished the bottle, still hungry?',
    entry: 'cues',
    nodes: {
      cues: {
        kind: 'question',
        prompt: 'The bottle’s empty and she still seems hungry. What is she doing?',
        options: [
          { label: 'Rooting, lip-smacking, agitated — and gulps eagerly if offered more', to: 'realHunger' },
          { label: 'Turns away, comfort-sucks without swallowing, settles when held', to: 'comfort' },
        ],
      },
      realHunger: {
        kind: 'outcome',
        title: 'Real hunger — offer more',
        actions: [
          'Offer about 1 oz at a time until she settles',
          'Keep it paced: slow-flow nipple, bottle horizontal, pause every ounce, 15–20 minute feeds',
          'Burp mid-feed',
          'Draining bottles feed after feed for days → pediatrician conversation (usually “size up”); the growth curve confirms it',
        ],
        why: 'Babies don’t read charts — catch-up gainers routinely exceed rule-of-thumb math. Daily total beats per-feed numbers.',
        ruleIds: ['R-31', 'R-30'],
      },
      comfort: {
        kind: 'outcome',
        title: 'Non-nutritive sucking — don’t add milk',
        actions: [
          'She wants sucking, not calories — a pacifier or pinky is fine here (she isn’t hungry)',
          'Overfilling causes spit-up and gas',
          'Next feed: slow-flow + paced, so fullness registers before the bottle empties',
        ],
        why: 'The suck reflex outlasts hunger, and “still hungry” is sometimes a gas bubble taking up room.',
        ruleIds: ['R-31'],
        links: [{ label: 'Gas protocol', to: '@gas' }],
      },
    },
  },
};
```

- [ ] **Step 4: Run all wizard tests** — 4 pass.
- [ ] **Step 5: Commit** — `flip: add wizard decision trees with graph integrity tests`

---

### Task 3: WizardPanel.tsx

**Files:**
- Create: `src/components/DayNightFlip/WizardPanel.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/components/DayNightFlip/WizardPanel.tsx
'use client';

import React, { useState } from 'react';
import { Button } from '@/src/components/ui/button';
import { useLocalization } from '@/src/context/localization';
import { FLIP_WIZARDS, WizardId } from './wizards';
import { FlipConfig } from './protocol';
import { rescueTiming, fmtClock } from './engine';
import { flipStyles as s } from './day-night-flip.styles';

interface WizardPanelProps {
  wizardId: WizardId;
  config: FlipConfig;
  now: Date;
  onClose: () => void;
}

type Pos = { wizard: WizardId; node: string };

export default function WizardPanel({ wizardId, config, now, onClose }: WizardPanelProps) {
  const { t } = useLocalization();
  const [stack, setStack] = useState<Pos[]>([
    { wizard: wizardId, node: FLIP_WIZARDS[wizardId].entry },
  ]);

  const pos = stack[stack.length - 1];
  const wizard = FLIP_WIZARDS[pos.wizard];
  const node = wizard.nodes[pos.node];

  const go = (to: string) => {
    if (to.startsWith('@')) {
      const w = to.slice(1) as WizardId;
      setStack(st => [...st, { wizard: w, node: FLIP_WIZARDS[w].entry }]);
    } else {
      setStack(st => [...st, { wizard: pos.wizard, node: to }]);
    }
  };
  const back = () => setStack(st => (st.length > 1 ? st.slice(0, -1) : st));

  const timing = node.kind === 'outcome' && node.dynamic === 'rescue-timing'
    ? rescueTiming(config, now)
    : null;

  return (
    <div className={s.wizard.panel}>
      <div className={s.wizard.header}>
        <span className={s.wizard.title}>{t(wizard.title)}</span>
        <div className="flex gap-2">
          {stack.length > 1 && (
            <Button size="sm" variant="ghost" onClick={back}>{t('Back')}</Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClose}>{t('Close')}</Button>
        </div>
      </div>

      {node.kind === 'question' ? (
        <div>
          <p className={s.wizard.prompt}>{t(node.prompt)}</p>
          {node.help && <p className={s.wizard.help}>{t(node.help)}</p>}
          <div className={s.wizard.options}>
            {node.options.map(o => (
              <button key={o.label} type="button" className={s.wizard.option} onClick={() => go(o.to)}>
                {t(o.label)}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <p className={s.wizard.outcomeTitle}>{t(node.title)}</p>
          <ul className={s.wizard.actions}>
            {node.actions.map(a => <li key={a}>{t(a)}</li>)}
          </ul>
          {timing?.isFinalNap && timing.wakeBy && timing.routineStart && (
            <p className={s.wizard.timing}>
              {t('This late, the rescue nap becomes the day’s final nap.')}{' '}
              {t('Wake her by')} <strong>{fmtClock(timing.wakeBy)}</strong>{' '}
              ({config.durations.rescueNapMaxMin}m {t('max')}), {t('then start the bedtime routine around')}{' '}
              <strong>{fmtClock(timing.routineStart)}</strong>. {t('One-night adjustment — the normal anchor resumes tomorrow.')}
            </p>
          )}
          <p className={s.wizard.why}><strong>{t('Why')}:</strong> {t(node.why)}</p>
          <div className={s.wizard.ruleRow}>
            {node.ruleIds.map(id => <span key={id} className={s.wizard.ruleChip}>{id}</span>)}
          </div>
          {(node.links ?? []).map(l => (
            <Button key={l.label} size="sm" variant="outline" className="mt-2 mr-2" onClick={() => go(l.to)}>
              {t(l.label)}
            </Button>
          ))}
          <div className="mt-3">
            <Button size="sm" variant="outline" onClick={onClose}>{t('Done')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add wizard styles** — append to `day-night-flip.styles.ts` inside `flipStyles`:

```ts
  wizard: {
    panel: 'flip-wizard-panel rounded-xl border-2 border-teal-300 bg-white p-4 shadow-md',
    header: 'flex items-center justify-between mb-2',
    title: 'text-sm font-semibold text-teal-800',
    prompt: 'text-base font-medium',
    help: 'text-xs text-gray-500 mt-1',
    options: 'mt-3 flex flex-col gap-2',
    option: 'flip-wizard-option text-left rounded-lg border border-gray-300 bg-gray-50 px-3 py-2.5 text-sm hover:border-teal-400 hover:bg-teal-50 cursor-pointer',
    outcomeTitle: 'text-base font-semibold',
    actions: 'list-disc ml-5 mt-2 space-y-1 text-sm',
    timing: 'mt-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900',
    why: 'mt-3 text-sm text-gray-600',
    ruleRow: 'mt-2 flex gap-1.5',
    ruleChip: 'font-mono text-[10px] rounded bg-gray-100 border border-gray-300 px-1.5 py-0.5 text-gray-600',
    entryGrid: 'grid grid-cols-1 sm:grid-cols-2 gap-2',
    entryBtn: 'flip-wizard-entry text-left rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm font-medium hover:border-teal-400 hover:bg-teal-50 cursor-pointer',
  },
```

And dark overrides in `day-night-flip.css`:

```css
html.dark .flip-wizard-panel { background-color: #1f2937 !important; border-color: #0f766e !important; color: #e5e7eb; }
html.dark .flip-wizard-option, html.dark .flip-wizard-entry { background-color: #111827 !important; border-color: #4b5563 !important; color: #e5e7eb !important; }
```

- [ ] **Step 3: `npx tsc --noEmit`** — clean.
- [ ] **Step 4: Commit** — `flip: add generic WizardPanel renderer`

---

### Task 4: FLIP_FAQ + FlipFaq.tsx

**Files:**
- Modify: `src/components/DayNightFlip/protocol.ts` (append)
- Create: `src/components/DayNightFlip/FlipFaq.tsx`
- Test: append one case to `protocol.test.ts`

- [ ] **Step 1: Failing test**

```ts
// append to protocol.test.ts
import { FLIP_FAQ } from './protocol';

test('FAQ bank has the 11 ruleset entries', () => {
  assert.equal(FLIP_FAQ.length, 11);
  for (const f of FLIP_FAQ) {
    assert.ok(f.question.endsWith('?'), `${f.id} is a question`);
    assert.ok(f.answer.length > 40, `${f.id} has a real answer`);
  }
});
```

- [ ] **Step 2: Append `FLIP_FAQ` to protocol.ts** (ruleset §5, condensed):

```ts
export type FlipFaqEntry = { id: string; question: string; answer: string };

export const FLIP_FAQ: FlipFaqEntry[] = [
  { id: 'faq-1', question: 'Why does this work at all?',
    answer: 'No circadian rhythm exists before ~6–10 weeks; the baby’s clock is trained by environmental contrast — light, noise, stimulation, and calorie timing. Day/night confusion is the most fixable newborn sleep problem.' },
  { id: 'faq-2', question: 'Why wake a sleeping baby?',
    answer: 'Daytime sleep and daytime calories displace nighttime wakefulness and night hunger. The nap cap and forced day feeds are the two levers doing the flipping; skip them and the night stays broken.' },
  { id: 'faq-3', question: 'Why are worse daytime naps good?',
    answer: 'Light, noisy, shallow day sleep sharpens the contrast with deep night sleep. Counterintuitive but central — the contrast is the mechanism.' },
  { id: 'faq-4', question: 'Why no sleep training yet?',
    answer: 'Self-settling emerges around 3–4 months. Before that, “letting her figure it out” isn’t on the menu — and you can’t spoil a newborn, so helping is free.' },
  { id: 'faq-5', question: 'Why swaddle only for sleep?',
    answer: 'Cues work by exclusivity. Swaddle-only-for-sleep makes wrapping mean “we’re going down now.” The same logic gates white noise to nights.' },
  { id: 'faq-6', question: 'Why does she scream in the crib but sleep on my chest?',
    answer: 'Flat position worsens gas discomfort; a chest is upright with warm belly pressure. Add normal newborn contact preference and the Moro reflex on transfer. Counters: deep-sleep transfer via the limp-arm test, feet-first lay-down, a pre-warmed bassinet, and a hand on her chest for 30 seconds.' },
  { id: 'faq-7', question: 'Won’t early bedtime cause a 5am start?',
    answer: 'Sleep isn’t a fixed tank. Overtired produces a fragmented night; well-rested produces a better night. Sleep begets sleep at this age.' },
  { id: 'faq-8', question: 'Why does the pacifier keep failing?',
    answer: 'It needs active sucking; an overtired baby can’t sustain it, so you get the spit–cry–replace loop. It’s a soothing tool, not a stalling tool — never use it to delay a hungry baby.' },
  { id: 'faq-9', question: 'Why does eating count as awake time?',
    answer: 'The window measures time out of sleep, not play. A 40-minute feed plus a change is a complete window for a slow eater.' },
  { id: 'faq-10', question: 'Why estimates instead of exact feed amounts?',
    answer: 'Intake targets derive from weight, vary feed to feed, and the growth curve — the pediatrician’s data — always outranks rules of thumb.' },
  { id: 'faq-11', question: 'Why anchors AND windows?',
    answer: 'Two independent systems: anchors (fixed clock times) train the circadian rhythm via light; windows (elapsed timers) prevent overtiredness via sleep pressure. They drift apart on early-wake days — the window wins for when, the anchor wins for environment.' },
];
```

- [ ] **Step 3: FlipFaq.tsx**

```tsx
// src/components/DayNightFlip/FlipFaq.tsx
'use client';

import React from 'react';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/src/components/ui/accordion';
import { useLocalization } from '@/src/context/localization';
import { FLIP_FAQ } from './protocol';
import { flipStyles as s } from './day-night-flip.styles';

export default function FlipFaq() {
  const { t } = useLocalization();
  return (
    <div className={s.section}>
      <div className={s.sectionTitle}>{t('Why does this work?')}</div>
      <Accordion type="single" collapsible>
        {FLIP_FAQ.map(f => (
          <AccordionItem key={f.id} value={f.id}>
            <AccordionTrigger>
              <span className="text-sm font-medium text-left">{t(f.question)}</span>
            </AccordionTrigger>
            <AccordionContent>
              <p className="text-sm text-gray-600 leading-relaxed">{t(f.answer)}</p>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
```

- [ ] **Step 4: tests + tsc** — protocol tests pass (4), tsc clean.
- [ ] **Step 5: Commit** — `flip: add FAQ rationale bank`

---

### Task 5: schedule.ts — projectDay (TDD)

**Files:**
- Create: `src/components/DayNightFlip/schedule.ts`
- Test: `src/components/DayNightFlip/schedule.test.ts`

- [ ] **Step 1: Failing tests**

```ts
// src/components/DayNightFlip/schedule.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectDay, ScheduleBlock } from './schedule';
import { DEFAULT_FLIP_CONFIG, FlipConfig } from './protocol';
import { ActivityFacts } from './engine';

const CFG: FlipConfig = { ...DEFAULT_FLIP_CONFIG, enabled: true };
const at = (h: number, m = 0, dayOffset = 0) => new Date(2026, 5, 12 + dayOffset, h, m, 0, 0);
const BIRTH = new Date(2026, 4, 14);

function facts(over: Partial<ActivityFacts> = {}): ActivityFacts {
  return {
    lastWakeTime: null, napStartTime: null, lastFeedTime: null,
    wetDiapersLast24h: null, dirtyDiapersLast24h: null,
    latestWeight: null, previousWeight: null, birthDate: BIRTH, ...over,
  };
}
const noLogs = { sleeps: [], feeds: [] };
const kindAt = (blocks: ScheduleBlock[], kind: string) => blocks.filter(b => b.kind === kind);

test('awake at 10:00 (woke 9:40): nap projected at 10:40, anchors hold', () => {
  const f = facts({ lastWakeTime: at(9, 40), lastFeedTime: at(9, 45) });
  const { blocks, isTemplate } = projectDay(CFG, f, noLogs, at(10, 0));
  assert.equal(isTemplate, false);
  const nap = kindAt(blocks, 'nap').find(b => b.source === 'projected')!;
  assert.equal(nap.start.getHours(), 10);
  assert.equal(nap.start.getMinutes(), 40); // 9:40 + 60m target
  const routine = kindAt(blocks, 'bedtime-routine')[0];
  assert.equal(routine.start.getHours(), 19);
  assert.equal(routine.start.getMinutes(), 15); // anchor holds
  const night = kindAt(blocks, 'night-sleep')[0];
  assert.equal(night.start.getHours(), 20);
});

test('D-2 bounds a projected nap: wake-to-feed beats the cap', () => {
  // sleeping since 9:30, last feed 7:30 -> feed due 10:30 < cap 11:30
  const f = facts({ napStartTime: at(9, 30), lastWakeTime: at(9, 0), lastFeedTime: at(7, 30) });
  const { blocks } = projectDay(CFG, f, { sleeps: [{ start: at(9, 30), end: null }], feeds: [at(7, 30)] }, at(10, 0));
  const current = blocks.find(b => b.isNow)!;
  assert.equal(current.kind, 'nap');
  assert.equal(current.end!.getHours(), 10);
  assert.equal(current.end!.getMinutes(), 30);
});

test('late final wake pulls the routine early (R-21)', () => {
  const f = facts({ lastWakeTime: at(17, 30), lastFeedTime: at(17, 40) });
  const { blocks } = projectDay(CFG, f, noLogs, at(17, 45));
  const routine = kindAt(blocks, 'bedtime-routine')[0];
  assert.equal(routine.start.getHours(), 18);
  assert.equal(routine.start.getMinutes(), 30); // 17:30 + 60m < 19:15
});

test('actual logged sleeps and feeds appear as actual blocks', () => {
  const logs = {
    sleeps: [{ start: at(9, 0), end: at(10, 30) }],
    feeds: [at(8, 5), at(11, 0)],
  };
  const f = facts({ lastWakeTime: at(13, 0), lastFeedTime: at(11, 0) });
  const { blocks } = projectDay(CFG, f, logs, at(13, 30));
  const actualNaps = blocks.filter(b => b.kind === 'nap' && b.source === 'actual');
  assert.equal(actualNaps.length, 1);
  assert.equal(blocks.filter(b => b.kind === 'feed' && b.source === 'actual').length, 2);
});

test('night scheduled feeds render as projected estimates and wrap midnight', () => {
  const f = facts({ lastWakeTime: at(19, 0), lastFeedTime: at(19, 0) });
  const { blocks } = projectDay(CFG, f, noLogs, at(19, 30));
  const nightFeeds = kindAt(blocks, 'night-feed');
  assert.equal(nightFeeds.length, 3); // ~23:00, ~02:00, ~05:00
  assert.equal(nightFeeds[1].start.getDate(), 13); // 02:00 lands tomorrow
  const hold = kindAt(blocks, 'night-hold')[0];
  assert.equal(hold.end!.getHours(), 8); // until tomorrow's day_start
});

test('early-morning now (02:00): window starts at yesterday’s day_start, isNow in the night', () => {
  const f = facts({ lastWakeTime: at(1, 30), lastFeedTime: at(1, 30) });
  const { blocks } = projectDay(CFG, f, noLogs, at(2, 0));
  assert.equal(blocks[0].start.getDate(), 11); // window began yesterday 08:00
  const nowBlock = blocks.find(b => b.isNow)!;
  assert.ok(['night-hold', 'night-feed', 'night-sleep'].includes(nowBlock.kind));
});

test('needs-input facts fall back to the template', () => {
  const { blocks, isTemplate } = projectDay(CFG, facts(), noLogs, at(10, 0));
  assert.equal(isTemplate, true);
  assert.equal(blocks[0].start.getHours(), 8); // template opens at day_start
  assert.ok(blocks.every(b => b.source !== 'actual'));
});
```

- [ ] **Step 2: Run to verify failure** — module missing.

- [ ] **Step 3: Implement projectDay**

```ts
// src/components/DayNightFlip/schedule.ts
// Pure projection of the rest of the day from the baby's real current state.
// Past = actual logs; future = simulated protocol cycle; anchors never move (R-22).

import { FlipConfig } from './protocol';
import {
  ActivityFacts, sleepState, minutesOfDay, parseHHMM, addMinutes,
} from './engine';

export type ScheduleBlock = {
  start: Date;
  end: Date | null;            // null => point event (feed) or open-ended
  kind: 'wake-feed' | 'awake' | 'nap' | 'catnap' | 'bedtime-routine'
      | 'night-sleep' | 'night-feed' | 'night-hold' | 'feed';
  label: string;
  note?: string;
  source: 'actual' | 'projected' | 'anchor';
  isNow: boolean;
};

export type TodayLogs = {
  sleeps: { start: Date; end: Date | null }[];
  feeds: Date[];
};

export type ProjectedDay = { blocks: ScheduleBlock[]; isTemplate: boolean };

const atTime = (ref: Date, minOfDay: number, dayOffset = 0) => {
  const d = new Date(ref);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(Math.floor(minOfDay / 60), minOfDay % 60, 0, 0);
  return d;
};

export function projectDay(
  config: FlipConfig,
  facts: ActivityFacts,
  todayLogs: TodayLogs,
  now: Date,
): ProjectedDay {
  const dayStartMin = parseHHMM(config.anchors.dayStart);
  const nightStartMin = parseHHMM(config.anchors.nightStart);
  const bedtimeMin = parseHHMM(config.anchors.bedtimeRoutine);
  const [, targetHi] = config.dayMode.wakeWindowTargetMin;
  const capMin = config.dayMode.napCapHr * 60;
  const feedMaxMin = config.dayMode.feedIntervalMaxHr * 60;
  const catnapStartMin = parseHHMM(config.dayMode.catnapSlot[0]);
  const lastWakeByMin = parseHHMM(config.dayMode.lastWakeBy);

  // The display window starts at the most recent day_start.
  const windowStart = minutesOfDay(now) >= dayStartMin
    ? atTime(now, dayStartMin)
    : atTime(now, dayStartMin, -1);
  const windowEnd = addMinutes(windowStart, 24 * 60); // next day_start
  const bedtimeAnchor = atTime(windowStart, bedtimeMin);
  const nightStart = atTime(windowStart, nightStartMin);

  const st = sleepState(facts, now);
  const isTemplate = !st.sleeping && !st.wakeKnown;

  const blocks: ScheduleBlock[] = [];

  // --- past: actual logs inside the window ---
  if (!isTemplate) {
    for (const sl of todayLogs.sleeps) {
      if ((sl.end ?? now) <= windowStart || sl.start >= now) continue;
      const start = sl.start < windowStart ? windowStart : sl.start;
      const isNight = minutesOfDay(start) >= nightStartMin || minutesOfDay(start) < dayStartMin;
      blocks.push({
        start, end: sl.end ?? null,
        kind: isNight ? 'night-sleep' : 'nap',
        label: isNight ? 'Night sleep (logged)' : 'Nap (logged)',
        source: 'actual', isNow: false,
      });
    }
    for (const f of todayLogs.feeds) {
      if (f < windowStart || f > now) continue;
      blocks.push({ start: f, end: null, kind: 'feed', label: 'Feed (logged)', source: 'actual', isNow: false });
    }
  }

  // --- simulation seed ---
  let cursor: Date;            // sim "last wake"
  let lastFeed: Date | null;
  let sleepingUntil: Date | null = null;

  if (isTemplate) {
    cursor = windowStart;       // idealized day starts at the anchor
    lastFeed = windowStart;
    blocks.push({
      start: windowStart, end: null, kind: 'wake-feed',
      label: 'Wake + feed', note: 'Lights on, curtains open — the day starts now no matter how the night went.',
      source: 'anchor', isNow: false,
    });
  } else if (st.sleeping && facts.napStartTime) {
    lastFeed = facts.lastFeedTime;
    // current sleep: ends at cap or wake-to-feed (D-2), whichever first
    const capEnd = addMinutes(facts.napStartTime, capMin);
    const feedEnd = lastFeed ? addMinutes(lastFeed, feedMaxMin) : capEnd;
    const isNight = minutesOfDay(now) >= nightStartMin || minutesOfDay(now) < dayStartMin;
    const end = isNight ? null : (capEnd < feedEnd ? capEnd : feedEnd);
    blocks.push({
      start: facts.napStartTime < windowStart ? windowStart : facts.napStartTime,
      end,
      kind: isNight ? 'night-sleep' : 'nap',
      label: isNight ? 'Night sleep' : 'Napping now',
      note: isNight ? undefined : 'Wake her at the marked time — cap or feed, whichever comes first.',
      source: 'projected', isNow: true,
    });
    cursor = end ?? now;
    sleepingUntil = end;
  } else {
    cursor = facts.lastWakeTime!;
    lastFeed = facts.lastFeedTime;
    if (minutesOfDay(now) >= dayStartMin && minutesOfDay(now) < nightStartMin) {
      blocks.push({
        start: cursor, end: addMinutes(cursor, targetHi), kind: 'awake',
        label: 'Awake window', source: 'projected', isNow: true,
      });
    }
  }

  // --- simulate forward through the day ---
  let guard = 0;
  let simWake = sleepingUntil ?? cursor;
  while (guard++ < 12) {
    // R-21: a final wake at/after the catnap slot pulls the routine early
    const wakeMin = minutesOfDay(simWake);
    const routineAt = wakeMin >= catnapStartMin && wakeMin + targetHi < bedtimeMin
      ? addMinutes(simWake, targetHi)
      : bedtimeAnchor;
    const napStart = addMinutes(simWake, targetHi);
    if (napStart >= routineAt || simWake >= bedtimeAnchor) break;

    // feed on wake (projected) when due
    const feedAt = lastFeed ? addMinutes(lastFeed, feedMaxMin) : simWake;
    if (feedAt <= napStart && feedAt > now) {
      blocks.push({ start: feedAt < simWake ? simWake : feedAt, end: null, kind: 'feed', label: 'Feed', note: 'Full, unhurried, paced — daytime calories are the lever.', source: 'projected', isNow: false });
      lastFeed = feedAt < simWake ? simWake : feedAt;
    }

    const inCatnap = minutesOfDay(napStart) >= catnapStartMin;
    const capEnd = addMinutes(napStart, inCatnap ? 45 : capMin);
    const feedBound = lastFeed ? addMinutes(lastFeed, feedMaxMin) : capEnd;
    const lastWakeBound = atTime(windowStart, lastWakeByMin);
    let napEnd = capEnd < feedBound ? capEnd : feedBound;
    if (inCatnap && napEnd > lastWakeBound) napEnd = lastWakeBound;
    if (napEnd > bedtimeAnchor) napEnd = bedtimeAnchor;

    if (napStart > now) {
      blocks.push({
        start: napStart, end: napEnd,
        kind: inCatnap ? 'catnap' : 'nap',
        label: inCatnap ? 'Catnap — short!' : 'Nap',
        note: inCatnap ? `Wake by ${config.dayMode.lastWakeBy} to protect bedtime.` : `Cap ${config.dayMode.napCapHr}h — wake her.`,
        source: 'projected', isNow: false,
      });
    }
    simWake = napEnd;
    if (inCatnap) break;
  }

  // --- evening anchors + night ---
  const wakeMin = minutesOfDay(simWake);
  const earlyRoutine = wakeMin >= catnapStartMin && wakeMin + targetHi < bedtimeMin
    ? addMinutes(simWake, targetHi) : bedtimeAnchor;
  const routineStart = earlyRoutine < bedtimeAnchor ? earlyRoutine : bedtimeAnchor;
  if (routineStart >= now || isTemplate) {
    blocks.push({
      start: routineStart, end: nightStart, kind: 'bedtime-routine',
      label: 'Bedtime routine',
      note: routineStart < bedtimeAnchor
        ? 'Early tonight (R-21) — never stretch an overtired baby to a clock time. Normal anchor resumes tomorrow.'
        : 'Feed, fresh swaddle, dim lights, white noise on.',
      source: 'anchor', isNow: false,
    });
  }
  blocks.push({
    start: nightStart, end: null, kind: 'night-sleep',
    label: 'Down for the night',
    note: 'Robot mode — dark, silent, boring. Shifts start.',
    source: 'anchor', isNow: false,
  });
  for (const sf of config.nightMode.scheduledFeeds) {
    const m = parseHHMM(sf);
    const when = m >= nightStartMin ? atTime(windowStart, m) : atTime(windowStart, m, 1);
    if (when < now && !isTemplate) continue; // already past
    blocks.push({
      start: when, end: null, kind: 'night-feed',
      label: `~ Night feed`, note: 'Estimate, never an alarm — feed when she asks.',
      source: 'projected', isNow: false,
    });
  }
  const lastSf = config.nightMode.scheduledFeeds[config.nightMode.scheduledFeeds.length - 1];
  const holdStart = lastSf
    ? (parseHHMM(lastSf) >= nightStartMin ? atTime(windowStart, parseHHMM(lastSf)) : atTime(windowStart, parseHHMM(lastSf), 1))
    : nightStart;
  blocks.push({
    start: holdStart, end: windowEnd, kind: 'night-hold',
    label: 'Hold the line',
    note: `Even if she fusses after a feed, keep it dark. The day starts at ${config.anchors.dayStart}, not before.`,
    source: 'anchor', isNow: false,
  });

  // --- sort, clip to window, mark NOW ---
  const sorted = blocks
    .filter(b => b.start >= windowStart && b.start < windowEnd)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  if (!sorted.some(b => b.isNow)) {
    // mark the last range block whose span contains now
    for (let i = sorted.length - 1; i >= 0; i--) {
      const b = sorted[i];
      const end = b.end ?? (i + 1 < sorted.length ? sorted[i + 1].start : windowEnd);
      if (b.kind !== 'feed' && b.kind !== 'night-feed' && b.start <= now && now < end) {
        b.isNow = true;
        break;
      }
    }
  }

  return { blocks: sorted, isTemplate };
}
```

- [ ] **Step 4: Run schedule tests** — 7 pass (iterate on simulation edge cases until table passes; the tests are the contract).
- [ ] **Step 5: Commit** — `flip: add projectDay live schedule projection`

---

### Task 6: FlipSchedule.tsx + prototype CSS

**Files:**
- Create: `src/components/DayNightFlip/FlipSchedule.tsx`
- Modify: `src/components/DayNightFlip/day-night-flip.css` (append schedule palette)

- [ ] **Step 1: Component**

```tsx
// src/components/DayNightFlip/FlipSchedule.tsx
'use client';

import React, { useEffect, useRef } from 'react';
import { cn } from '@/src/lib/utils';
import { useLocalization } from '@/src/context/localization';
import { FlipConfig } from './protocol';
import { ActivityFacts, fmtClock, parseHHMM, minutesOfDay } from './engine';
import { projectDay, TodayLogs, ScheduleBlock } from './schedule';

interface FlipScheduleProps {
  config: FlipConfig;
  facts: ActivityFacts;
  todayLogs: TodayLogs;
  now: Date;
}

const NIGHT_KINDS = new Set(['night-sleep', 'night-feed', 'night-hold']);

function Row({ b, nowRef }: { b: ScheduleBlock; nowRef: React.RefObject<HTMLDivElement | null> }) {
  const { t } = useLocalization();
  return (
    <div ref={b.isNow ? nowRef : undefined} className={cn('flip-sched-block', b.isNow && 'now')}>
      <div className="flip-sched-time">
        {b.kind === 'night-feed' ? '~' : ''}{fmtClock(b.start)}
      </div>
      <div>
        <div className="flip-sched-act">
          {b.source === 'actual' ? '✓ ' : ''}{t(b.label)}
          {b.isNow && <span className="flip-sched-nowtag">NOW</span>}
          {b.end && <span className="flip-sched-until"> → {fmtClock(b.end)}</span>}
        </div>
        {b.note && <div className="flip-sched-note">{t(b.note)}</div>}
      </div>
    </div>
  );
}

export default function FlipSchedule({ config, facts, todayLogs, now }: FlipScheduleProps) {
  const { t } = useLocalization();
  const nowRef = useRef<HTMLDivElement | null>(null);
  const { blocks, isTemplate } = projectDay(config, facts, todayLogs, now);

  const nightStartMin = parseHHMM(config.anchors.nightStart);
  const dayStartMin = parseHHMM(config.anchors.dayStart);
  const isNightBlock = (b: ScheduleBlock) =>
    NIGHT_KINDS.has(b.kind) ||
    minutesOfDay(b.start) >= nightStartMin || minutesOfDay(b.start) < dayStartMin;

  const dayBlocks = blocks.filter(b => !isNightBlock(b));
  const nightBlocks = blocks.filter(isNightBlock);

  const jump = () => nowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  useEffect(() => { const id = setTimeout(jump, 300); return () => clearTimeout(id); }, []);

  return (
    <div className="flip-sched">
      {isTemplate && (
        <div className="flip-sched-template-note">
          {t('Showing the template day — set the actual wake time on the Now tab and the schedule adapts to it.')}
        </div>
      )}
      <button type="button" className="flip-sched-nowbtn" onClick={jump}>
        <span className="dot" /> {t('Jump to now')}
      </button>

      <section className="flip-sched-day">
        <div className="flip-sched-eyebrow">{t('Day mode')}</div>
        <h3>{config.anchors.dayStart} – {config.anchors.nightStart}</h3>
        {dayBlocks.map((b, i) => <Row key={`${b.kind}-${i}`} b={b} nowRef={nowRef} />)}
      </section>

      <div className="flip-sched-dusk" />

      <section className="flip-sched-night">
        <div className="flip-sched-eyebrow">{t('Night mode')}</div>
        <h3>{config.anchors.nightStart} – {config.anchors.dayStart}</h3>
        {nightBlocks.map((b, i) => <Row key={`${b.kind}-${i}`} b={b} nowRef={nowRef} />)}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Append schedule CSS** (prototype palette, intentionally theme-invariant):

```css
/* --- schedule view: "the page is the day" (palette from sylvie-schedule.html) --- */
.flip-sched { border-radius: 16px; overflow: hidden; }
.flip-sched-day { background: #FBF6EC; color: #3D3320; padding: 16px; }
.flip-sched-night { background: #15132B; color: #E6E3F7; padding: 16px; }
.flip-sched-dusk { height: 48px; background: linear-gradient(to bottom, #FBF6EC, #15132B); }
.flip-sched-eyebrow {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;
}
.flip-sched-day .flip-sched-eyebrow { color: #C07A1E; }
.flip-sched-night .flip-sched-eyebrow { color: #A89BF0; }
.flip-sched section h3, .flip-sched-day h3, .flip-sched-night h3 { font-size: 17px; font-weight: 650; margin: 2px 0 10px; }
.flip-sched-block {
  display: grid; grid-template-columns: 64px 1fr; gap: 12px;
  padding: 10px; border-radius: 12px; border: 1.5px solid transparent;
}
.flip-sched-time {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 12.5px; font-weight: 600; text-align: right; padding-top: 2px;
}
.flip-sched-day .flip-sched-time { color: #C07A1E; }
.flip-sched-night .flip-sched-time { color: #A89BF0; }
.flip-sched-act { font-size: 14.5px; font-weight: 600; line-height: 1.35; }
.flip-sched-until { font-weight: 500; opacity: 0.65; font-size: 13px; }
.flip-sched-note { font-size: 12.5px; line-height: 1.5; margin-top: 2px; }
.flip-sched-day .flip-sched-note { color: #8A7A5C; }
.flip-sched-night .flip-sched-note { color: #9D97C9; }
.flip-sched-block.now { border-color: currentColor; }
.flip-sched-day .flip-sched-block.now { background: #FFFFFF; border-color: #C07A1E; box-shadow: 0 2px 12px rgba(192,122,30,0.15); }
.flip-sched-night .flip-sched-block.now { background: #201D3F; border-color: #A89BF0; }
.flip-sched-nowtag {
  font-family: ui-monospace, Menlo, monospace; font-size: 10px; font-weight: 700;
  letter-spacing: 0.1em; border-radius: 5px; padding: 2px 6px; margin-left: 8px;
  background: #C07A1E; color: #FFF8EC; vertical-align: 2px;
}
.flip-sched-night .flip-sched-nowtag { background: #A89BF0; color: #1A1735; }
.flip-sched-nowbtn {
  display: inline-flex; align-items: center; gap: 7px; margin: 0 0 10px;
  font-family: ui-monospace, Menlo, monospace; font-size: 12.5px; font-weight: 600;
  border: 1.5px solid #C07A1E; border-radius: 99px; padding: 7px 14px;
  background: #FFFFFF; color: #3D3320; cursor: pointer;
}
.flip-sched-nowbtn .dot { width: 8px; height: 8px; border-radius: 50%; background: #C07A1E; }
@media (prefers-reduced-motion: no-preference) {
  .flip-sched-nowbtn .dot { animation: flip-pulse 2s ease-in-out infinite; }
  @keyframes flip-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
}
.flip-sched-template-note {
  border: 1px solid #EADFC8; background: #FFF; border-radius: 10px;
  padding: 8px 12px; font-size: 13px; color: #8A7A5C; margin-bottom: 10px;
}
html.dark .flip-sched-nowbtn { background: #201D3F; color: #E6E3F7; border-color: #A89BF0; }
html.dark .flip-sched-nowbtn .dot { background: #A89BF0; }
html.dark .flip-sched-template-note { background: #1f2937; border-color: #374151; color: #9ca3af; }
```

- [ ] **Step 3: tsc clean.**
- [ ] **Step 4: Commit** — `flip: add FlipSchedule view with day-dusk-night styling`

---

### Task 7: View toggle, wizard entry points, todayLogs

**Files:**
- Modify: `src/components/DayNightFlip/useFlipData.ts`
- Modify: `src/components/DayNightFlip/index.tsx`
- Modify: `src/components/DayNightFlip/day-night-flip.styles.ts` (toggle styles)

- [ ] **Step 1: useFlipData — fetch today's feeds, expose todayLogs**

Add to the `Promise.all` in `refresh` (4th entry already exists; add a 5th):
```ts
        getJson<{ time: string }[]>(
          `/api/feed-log?babyId=${babyId}&startDate=${new Date(now.getTime() - 36 * 3600 * 1000).toISOString()}&endDate=${end}`),
```
Destructure as `feedsRecent`; extend `RawActivityData` usage by storing it in new state:
```ts
  const [todayLogs, setTodayLogs] = useState<TodayLogs>({ sleeps: [], feeds: [] });
  // inside refresh, after setRaw(...):
  setTodayLogs({
    sleeps: (sleepLogs ?? []).map(l => ({ start: new Date(l.startTime), end: l.endTime ? new Date(l.endTime) : null })),
    feeds: (feedsRecent ?? []).map(f => new Date(f.time)),
  });
```
Import `TodayLogs` from `./schedule`; return `todayLogs` from the hook.

- [ ] **Step 2: styles — view toggle + sideways section**

Append inside `flipStyles`:
```ts
  toggle: {
    row: 'flex gap-1 rounded-full border border-gray-300 bg-gray-100 p-1 w-fit',
    btn: 'flip-toggle-btn rounded-full px-4 py-1.5 text-sm font-medium text-gray-600 cursor-pointer',
    btnActive: 'bg-white text-teal-700 shadow-sm border border-teal-300',
  },
```
CSS dark overrides:
```css
html.dark .flip-toggle-btn { color: #9ca3af; }
html.dark .flip-toggle-btn.active-dark { background: #1f2937 !important; color: #5eead4 !important; border-color: #0f766e !important; }
```
(The active button also gets the `active-dark` class.)

- [ ] **Step 3: index.tsx — wire it together**

New imports: `WizardPanel`, `FlipSchedule`, `FlipFaq`, `WizardId`. New state:
```ts
  const [view, setView] = useState<'now' | 'schedule' | 'why'>('now');
  const [activeWizard, setActiveWizard] = useState<WizardId | null>(null);
```
Toggle UI directly under the phase banners:
```tsx
      <div className={s.toggle.row} role="tablist">
        {([['now', t('Now')], ['schedule', t('Schedule')], ['why', t('Why')]] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={view === id}
            className={cn(s.toggle.btn, view === id && cn(s.toggle.btnActive, 'active-dark'))}
            onClick={() => setView(id)}>
            {label}
          </button>
        ))}
      </div>
```
View bodies:
- `view === 'schedule'` → `<FlipSchedule config={config} facts={facts} todayLogs={todayLogs} now={now} />`
- `view === 'why'` → `<FlipFaq />`
- `view === 'now'` → existing NowBanner/nudges/FlipTimers/ModeRules/EscalationBanner, plus:

"When it goes sideways" section (between nudges and FlipTimers):
```tsx
      {activeWizard ? (
        <WizardPanel wizardId={activeWizard} config={config} now={now} onClose={() => setActiveWizard(null)} />
      ) : (
        <div className={s.section}>
          <div className={s.sectionTitle}>{t('When it goes sideways')}</div>
          <div className={s.wizard.entryGrid}>
            <button type="button" className={s.wizard.entryBtn} onClick={() => setActiveWizard('rescue')}>{t('Putdown isn’t working')}</button>
            <button type="button" className={s.wizard.entryBtn} onClick={() => setActiveWizard('pacifier')}>{t('Pacifier keeps failing')}</button>
            <button type="button" className={s.wizard.entryBtn} onClick={() => setActiveWizard('gas')}>{t('Gas check')}</button>
            <button type="button" className={s.wizard.entryBtn} onClick={() => setActiveWizard('bottle')}>{t('Finished the bottle, still hungry?')}</button>
          </div>
        </div>
      )}
```
Nudge deep-link: in the nudges map, after the text, render for `n.id === 'R-16'`:
```tsx
              {n.id === 'R-16' && (
                <button type="button" className="underline ml-1 font-medium" onClick={() => setActiveWizard('rescue')}>
                  {t('Rescue →')}
                </button>
              )}
```
Destructure `todayLogs` from `useFlipData()`; import `cn`.

- [ ] **Step 4: tsc + all tests + quick manual check** (dev server hot-reloads — load `/squire/day-night-flip`, click through the three views).
- [ ] **Step 5: Commit** — `flip: add three-view toggle, wizard entry points, nudge deep-links`

---

### Task 8: Status route — dayNightFlip section

**Files:**
- Modify: `app/api/hooks/v1/babies/[babyId]/status/route.ts`

- [ ] **Step 1: Extend the route**

1. Baby select gains the column: `select: { id: true, firstName: true, birthDate: true, feedWarningTime: true, diaperWarningTime: true, dayNightFlipConfig: true }`.
2. Imports (top of file — these modules are pure, server-safe):
```ts
import { mergeFlipConfig } from '@/src/components/DayNightFlip/protocol';
import { resolveNow } from '@/src/components/DayNightFlip/engine';
import { deriveFacts } from '@/src/components/DayNightFlip/facts';
```
3. After `ageInDays` is computed, add:
```ts
  // Day/Night Flip state (phase 2): same pure engine the app runs client-side.
  // Reflects logged data only — the phone-local manual override is not visible here.
  const flipConfig = mergeFlipConfig(baby?.dayNightFlipConfig);
  let dayNightFlip: any = { enabled: false };
  if (baby && flipConfig.enabled) {
    const nowDate = new Date();
    const [flipSleeps, flipDiapers, flipWeights] = await Promise.all([
      prisma.sleepLog.findMany({
        where: { babyId, deletedAt: null, startTime: { gte: new Date(nowDate.getTime() - 7 * 86400000) } },
        select: { startTime: true, endTime: true },
      }),
      prisma.diaperLog.findMany({
        where: { babyId, deletedAt: null, time: { gte: new Date(nowDate.getTime() - 24 * 3600000) } },
        select: { time: true, type: true },
      }),
      prisma.measurement.findMany({
        where: { babyId, deletedAt: null, type: 'WEIGHT' },
        orderBy: { date: 'desc' }, take: 2,
        select: { date: true, value: true, unit: true },
      }),
    ]);
    const flipFacts = deriveFacts({
      sleepLogs: flipSleeps.map(s => ({ startTime: s.startTime.toISOString(), endTime: s.endTime?.toISOString() ?? null })),
      lastFeed: lastFeed ? { time: lastFeed.time.toISOString(), endTime: lastFeed.endTime?.toISOString() ?? null } : null,
      diaperLogs: flipDiapers.map(d => ({ time: d.time.toISOString(), type: d.type as 'WET' | 'DIRTY' | 'BOTH' })),
      weights: flipWeights.map(w => ({ date: w.date.toISOString(), value: w.value, unit: w.unit ?? '' })),
      birthDate: baby.birthDate.toISOString(),
    }, null, nowDate);
    const state = resolveNow(flipConfig, flipFacts, nowDate);
    const napCapAt = state.currentBlock === 'nap' && flipFacts.napStartTime
      ? new Date(flipFacts.napStartTime.getTime() + flipConfig.dayMode.napCapHr * 3600000).toISOString()
      : null;
    dayNightFlip = {
      enabled: true,
      phase: state.phase, mode: state.mode,
      block: state.currentBlock, blockLabel: state.blockLabel, nextAction: state.nextAction,
      wakeWindowMin: state.timers.wakeWindowElapsedMin,
      napElapsedMin: state.timers.napElapsedMin,
      sinceLastFeedMin: state.timers.sinceLastFeedMin,
      napCapAt,
      nextFeedEstimate: state.timers.nextFeedEstimate
        ? { from: state.timers.nextFeedEstimate.from.toISOString(), to: state.timers.nextFeedEstimate.to?.toISOString() ?? null }
        : null,
      escalations: state.escalations.map(e => e.id),
    };
  }
```
4. Add `dayNightFlip,` to the `data` object (after `warnings`).

Check the Measurement model field name for soft delete (`deletedAt`) and `unit` nullability before relying on them — adjust the `where`/mapping if the schema differs.

- [ ] **Step 2: Verify live with curl**

Get a key from the local DB and hit the endpoint:
```bash
node -e "
const db = require('better-sqlite3')('db/baby-tracker.db', { readonly: true });
console.log(JSON.stringify(db.prepare('SELECT * FROM ApiKey LIMIT 1').get()));
"
# then with the key value and Sylvie's babyId:
curl -s -H "Authorization: Bearer <key>" "http://localhost:3000/api/hooks/v1/babies/<babyId>/status" | python3 -m json.tool | grep -A14 dayNightFlip
```
Expected: `dayNightFlip.enabled: true`, a sensible `block`, `nextAction`, and `escalations`.

- [ ] **Step 3: tsc + tests + commit** — `flip: expose dayNightFlip state on the status hook`

---

### Task 9: HA staged sensors (homeassistant-config repo, NOT applied)

**Files:**
- Create: `/home/shawn/documents/apps/homeassistant-config/.local-backups/sprouty-flip-sensors.yaml` (gitignored by that repo's design; the live box is untouched)

- [ ] **Step 1: Write the staged file** — sensor entries to append under the existing `rest:` resource's `sensor:` list in the box's `rest.yaml`, with an apply checklist and example automations as comments:

```yaml
# sprouty-flip-sensors.yaml — STAGED, not applied.
# Day/Night Flip sensors for the existing Sprout Track REST resource.
#
# APPLY CHECKLIST (guarded procedure — see repo CLAUDE.md):
#   1. ssh root@192.168.1.101 'cp /config/rest.yaml /config/rest.yaml.bak.$(date +%Y%m%d)'
#   2. Append the sensor entries below under the EXISTING
#      "- resource: !secret sprout_track_status_url" block's sensor: list.
#   3. ssh root@192.168.1.101 'ha core check'
#   4. HA UI -> Developer tools -> YAML -> Reload REST entities (or restart core).
#   5. ./sync-from-ha.sh && git commit -m "sync: add sprouty flip sensors"
#
# All sensors go unavailable when Day/Night Flip is disabled for the baby.

    - name: "Sprouty Flip Block"
      unique_id: sprouty_flip_block
      value_template: "{{ value_json.data.dayNightFlip.block }}"
      availability: "{{ value_json.data.dayNightFlip.enabled }}"

    - name: "Sprouty Flip Mode"
      unique_id: sprouty_flip_mode
      value_template: "{{ value_json.data.dayNightFlip.mode }}"
      availability: "{{ value_json.data.dayNightFlip.enabled }}"

    - name: "Sprouty Flip Next Action"
      unique_id: sprouty_flip_next_action
      value_template: "{{ value_json.data.dayNightFlip.nextAction[:255] }}"
      availability: "{{ value_json.data.dayNightFlip.enabled }}"

    - name: "Sprouty Flip Wake Window"
      unique_id: sprouty_flip_wake_window_min
      unit_of_measurement: "min"
      value_template: "{{ value_json.data.dayNightFlip.wakeWindowMin }}"
      availability: "{{ value_json.data.dayNightFlip.enabled and value_json.data.dayNightFlip.wakeWindowMin is not none }}"

    - name: "Sprouty Flip Nap Cap At"
      unique_id: sprouty_flip_nap_cap_at
      device_class: timestamp
      value_template: "{{ value_json.data.dayNightFlip.napCapAt }}"
      availability: "{{ value_json.data.dayNightFlip.enabled and value_json.data.dayNightFlip.napCapAt is not none }}"

    - name: "Sprouty Flip Escalations"
      unique_id: sprouty_flip_escalations
      value_template: "{{ value_json.data.dayNightFlip.escalations | join(', ') if value_json.data.dayNightFlip.escalations else 'none' }}"
      availability: "{{ value_json.data.dayNightFlip.enabled }}"

# EXAMPLE AUTOMATIONS (for automations via the HA UI, not this file):
#
# Nap-cap alarm: trigger platform: time, at: sensor.sprouty_flip_nap_cap_at
#   -> action: announce on kitchen speaker "Nap cap — time to wake her."
#
# Day start: trigger time 08:00 -> lights on in nursery, white noise off.
# Night start: trigger time 20:00 -> nursery lights off, white noise on.
#   (Times match the flip config anchors; or trigger on sprouty_flip_mode changing.)
#
# Escalation notice: trigger state sensor.sprouty_flip_escalations from "none"
#   -> notify phones.
```

- [ ] **Step 2: Commit nothing in that repo** (`.local-backups/` is gitignored there by design). In *this* repo, note the staged file path in `src/components/DayNightFlip/README.md` (one line under a new "HA integration" heading) and commit: `flip: document staged HA sensor file`

---

### Task 10: Localization strings

- [ ] **Step 1: Collect + add** — same script as the MVP plan, with the file list extended to `wizards.ts` (`prompt|help|label|title|why` and `actions` array strings), `WizardPanel.tsx`, `FlipFaq.tsx`, `FlipSchedule.tsx`, `schedule.ts` (`label|note` strings), and the modified `index.tsx`. For protocol.ts also collect `question`/`answer` of FLIP_FAQ. Add key===value entries to en.json with the node script, then `node scripts/check-missing-translations.js`.
- [ ] **Step 2: Commit** — `flip: add phase 2 localization strings`

---

### Task 11: Full verification

- [ ] **Step 1:** `npx tsx --test src/components/DayNightFlip/*.test.ts && npx tsc --noEmit` — all pass.
- [ ] **Step 2: Playwright E2E** (dev server hot-reloads; browser is UTC — assert accordingly):
  1. `/squire/day-night-flip` → three-pill toggle renders; Now view unchanged.
  2. Schedule view: day section (warm) → dusk → night section (indigo); NOW block highlighted; jump-to-now scrolls; actual logged blocks show ✓.
  3. Why view: 11 accordion entries; open one, text renders.
  4. Now view: "When it goes sideways" grid → open rescue wizard → answer to an outcome → Back works → Close.
  5. Screenshots: `flip2-schedule.png` (full page), `flip2-wizard.png`, `flip2-faq.png`.
- [ ] **Step 3: curl re-check of the status hook** (Task 8 Step 2 command) after any fixes.
- [ ] **Step 4: Fix → re-test → commit** — `flip: phase 2 E2E fixes`

---

## Self-review

1. **Spec coverage:** wizards §3 → Tasks 2-3; FAQ §4 → Task 4; schedule §5 → Tasks 5-7 (projectDay returns `{blocks, isTemplate}` — a refinement over the spec's bare array, noted); HA §6 → Tasks 8-9; testing §7 → Tasks 1-2, 5, 8, 11; localization → Task 10.
2. **Known judgment calls:** `projectDay`'s simulation is the hardest piece — its tests are the contract; iterate the implementation until the table passes, don't weaken the table. Status-route Measurement field names are verified in-task before use.
3. **Type consistency:** `fmtClock`/`sleepState`/`rescueTiming` exported in Task 1 and consumed in Tasks 3, 5, 6, 8; `TodayLogs` defined in Task 5, consumed in Tasks 6-7; `WizardId` defined in Task 2, consumed in Tasks 3, 7.
