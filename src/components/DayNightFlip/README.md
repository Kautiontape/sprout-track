# DayNightFlip (user-facing name: **Rhythm**)

In-app tool guiding parents through the newborn day/night-confusion protocol
(spec: docs/superpowers/specs/2026-06-11-day-night-flip-design.md).

Naming: the feature is presented to users as **Rhythm** (sidebar, route
`/rhythm`, settings tab). Internal identifiers keep the protocol's original
name — this folder, the `Baby.dayNightFlipConfig` column, and the
`dayNightFlip` section on the status hook — because renaming them buys nothing
user-visible and would force a migration plus HA sensor changes.

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

Phase 2 additions:
- `wizards.ts` + `WizardPanel` — "when it goes sideways" decision trees (R-15/17/18/31).
- `FLIP_FAQ` + `FlipFaq` — the 11-entry rationale bank.
- `schedule.ts` (`projectDay`) + `FlipSchedule` — live-adapted day timeline
  (actual past, projected future, anchors fixed; template fallback).
- The status hook (`/api/hooks/v1/babies/:id/status`) exposes a `dayNightFlip`
  section when enabled — reflects logged data only (no local override) and uses
  the server TZ. Staged HA sensors:
  `~/documents/apps/homeassistant-config/.local-backups/sprouty-flip-sensors.yaml`.
