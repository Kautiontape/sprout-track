# DayNightFlip

In-app tool guiding parents through the newborn day/night-confusion protocol
(spec: docs/superpowers/specs/2026-06-11-day-night-flip-design.md).

- `engine.ts` — pure `resolveNow(config, facts, now)`; no React, no fetch.
- `facts.ts` — pure derivation of ActivityFacts from raw API data + manual override.
- `protocol.ts` — FlipConfig type, source-run defaults, merge, rule bank.
- `useFlipData.ts` — fetches sleep/feed/diaper/weight data, manages the
  localStorage override (`flipOverride_<familyId>_<babyId>`).
- `NowBanner` / `FlipTimers` / `ModeRules` / `EscalationBanner` — UI sections.

Tests: `npx tsx --test src/components/DayNightFlip/*.test.ts`

Config persists per-baby as `Baby.dayNightFlipConfig` (JSON string), edited via
the Day/Night Flip tab in the Edit Baby form. A missing/partial column merges
over `DEFAULT_FLIP_CONFIG`.
