# EC Reports (Phase 2) — What Stats an EC Family Actually Wants

**Date:** 2026-07-30
**Feeds into:** `docs/superpowers/specs/2026-07-29-ec-potty-tracking-design.md`, Phase 2 ("PottyStatsSection with the time-of-day distribution, heatmap integration, monthly report card section")
**Ground rule respected throughout:** only catches (wins) are logged. No attempts, no misses. Anything needing an attempt denominator is out (see §3).

---

## 0. What the literature says EC families chart, in one paragraph

Every major EC tradition converges on the same three observables. **Ingrid Bauer** (*Diaper Free!*) teaches watching "natural rhythms": elimination happens after sleep, after/during feeding, and at transitions — "many babies pee as soon as they awaken, and at regular intervals after nursing," and she tells parents to record those intervals to learn the pattern. **Laurie Boucke** (*Infant Potty Training*) has parents chart elimination frequency *in relation to waking and feeding* — not in relation to the clock. **Andrea Olson** (Go Diaper Free) canonizes the "Four Easy Catches" — (1) upon waking, (2) at diaper changes, (3) poops, (4) transition times — and her Baby Care Cycle is *wake → pottytunity → nurse → awake time → pottytunity before nap → nap → repeat*. Her own app ("The Log") has exactly one analytical output: the baby's **natural timing intervals**, shown as a graph, used to set a "potty time alarm." The **Montessori** tradition adds the developmental arc: growing dryness awareness and lengthening dry intervals through the 12–18-month sensitive period. A clinical case report on an EC infant documents the developmental curve everyone is intuiting: voiding intervals and bladder capacity grow steadily (first-morning void volume doubling from 8 to 20 months), with bowel continence arriving far earlier than bladder continence.

Translated to our schema: **the app's unfair advantage over every paper log and every dedicated EC app is that we already have timestamped sleep and feed data for the same baby.** Paper logs make you write "woke 9:40, peed 9:45" by hand; we can join `PottyLog.time` against `SleepLog.endTime` and `FeedLog.time` for free. The best Phase 2 stats are the ones that exploit that join.

Data reality check: the family has ~0 rows today and will accumulate roughly 2–5 catches/day (plus their existing diaper/sleep/feed logging). Every proposal below states when it becomes meaningful at that rate.

---

## 1. Ranked proposals

### #1 — Catches per day, split pee/poop, with rolling average («the momentum chart»)

**What it shows.** A daily bar chart over the selected date range: one bar per day, stacked pee/poop (BOTH contributes to each), with a 7-day rolling average line. Headline stat cards above it, mirroring `DiaperStatsSection`'s card grid: **Total catches**, **Catches/day (avg)**, **Poops caught**, **Pees caught**.

```
catches
 6 |            ▂▂
 4 |    ▂▂  ▄▄  ██  ▄▄      ── 7-day avg
 2 | ▄▄ ██  ██  ██  ██  ▂▂
 0 +─────────────────────────
    M   T   W   T   F   S ...
```

**Why EC values it.** It is the fundamental unit of EC morale. Since the family deliberately logs only wins, the honest progress curve is simply "are we catching more than we used to." Go Diaper Free's beginner guidance is explicitly volume-first ("increase your odds at getting a catch"); r/ECers success posts are phrased as counts ("no poopy diaper changes by 7 months"). This is also the stat that pairs with Phase 3 streaks.

**Computation.** `PottyLog` where `deletedAt IS NULL`, grouped by family-timezone calendar day (same `getCalendarDayKey` pattern StatsTab already uses via `useTimezone().toLocalDate`). Pee count = `type IN (WET, BOTH)`; poop count = `type IN (DIRTY, BOTH)`; total = row count (a BOTH is one catch, two eliminations — display rule: cards count *catches*, the pee/poop split counts *eliminations*; label accordingly). The Reports page already receives potty rows — `/api/timeline` fetches `pottyLog` since Phase 1 — so this is pure client-side aggregation in `StatsTab`'s existing `useMemo`, exactly like `DiaperStats`.

**Data needed.** Meaningful on day 1. This is the only proposal that is.

---

### #2 — Poop scoreboard: caught vs. in-diaper («the honest catch-rate»)

**What it shows.** For poops only, a two-number card pair plus a weekly stacked-bar trend:

- **Poops caught:** `PottyLog` where `type IN (DIRTY, BOTH)`
- **Poopy diapers:** `DiaperLog` where `type IN (DIRTY, BOTH)`
- **Share caught:** caught ÷ (caught + poopy diapers), as a percentage, per week

```
100%|                    ▁▁▁ caught
    |        ▄▄▄  ▆▆▆    ███
 50%|  ▂▂▂   ███  ███    ███
    |  ███   ▒▒▒  ▒▒▒    ▒▒▒ in diaper
  0%+──wk1───wk2───wk3───wk4──
```

**Why EC values it.** Poop continence is EC's first big win — the case report infant was "nearly 100% continent for bowel movements" in month one, years before bladder continence; Go Diaper Free lists poops among the easy catches because they're signaled (grunting, straining); parents across r/ECers and the practitioner blogs measure progress as "we haven't changed a poopy diaper in weeks." Critically, **this ratio is honest for poops in a way it is not for pees**: poops are discrete events, families change dirty diapers promptly, and one dirty diaper ≈ one poop. So `caught/(caught + diapered)` genuinely approximates the bowel catch rate *without any attempt logging*. (The pee analogue is misleading — see §3.)

**Computation.** Both tables, `deletedAt IS NULL`, `type IN (DIRTY, BOTH)`, family-timezone week bucketing. Edge cases: a `BOTH` diaper and a `BOTH` catch each count once toward poop; a blowout flag on `DiaperLog` is irrelevant here; twins/multiple babies already scoped by `babyId` in the timeline fetch.

**Data needed.** ~2 weeks for the weekly trend to have 2 points; the cards are meaningful within days because the diaper side of the denominator is already being logged at full volume.

---

### #3 — The wake-up catch panel («the app's unfair advantage»)

**What it shows.** A small panel joining catches to sleep:

- **Wake-up catches:** catches within *N* minutes after a `SleepLog.endTime` (N default 20)
- **Wake-ups with a catch:** share of sleep-session endings followed by a catch within N min, split naps vs. night
- **Median wake→catch gap:** e.g. "typically 6 min after waking"

```
Wake-up catches        31        (58% of all catches)
Naps with a wake catch ████████░░  8 of 12 this week
Night wake with catch  ██░░░░░░░░  2 of 7
Typical gap            6 min after waking
```

**Why EC values it.** The wake-up pee is **Easy Catch #1** in Go Diaper Free's canon, and the mechanism is physiological: antidiuretic hormone suppresses elimination during sleep, wears off at waking, "the bladder fills and you need to pee" — Olson calls it near-guaranteed for newborns. Bauer: "many babies pee as soon as they awaken." Boucke charts elimination relative to waking. No paper log or standalone EC app can compute this, because none of them know when the baby actually woke — we have `SleepLog.endTime` to the minute.

**One framing rule keeps it honest:** "wake-ups with a catch" is *not* a success rate — a wake-up without a catch usually means nobody offered, not that baby missed. Label it as **opportunity coverage** ("you're capitalizing on 8 of 12 nap wake-ups"), never as a percentage of successes. The denominator here is wake-ups (which we fully observe), not attempts (which we don't), so it doesn't violate the no-miss rule — but the copy must say "wake-ups followed by a catch," not "success rate."

**Computation.** For each `PottyLog.time`, find the most recent `SleepLog` (`deletedAt IS NULL`) with `endTime <= time` and `time - endTime <= N minutes`; tag the catch `wake-up` and inherit the sleep `type` (NAP vs NIGHT_SLEEP). For coverage: iterate sleep sessions **with non-null `endTime`** ending inside the date range, test for a catch in `(endTime, endTime + N]`. Edge cases: open-ended sleeps (`endTime IS NULL`) are excluded from the denominator; a catch logged *during* a sleep window (timestamp fudging) counts as wake-up if within N of the end, else "in between"; two sleeps ending close together — attribute to the nearer.

**Data needed.** ~1–2 weeks (2–4 wake-ups/day gives ~20–50 denominators). The median-gap stat needs ~10 wake-up catches.

---

### #4 — Catch context breakdown («which easy catch is working»)

**What it shows.** Every catch classified into the Four Easy Catches vocabulary, shown as a donut or horizontal stacked bar:

- **Wake-up** — within N min of a `SleepLog.endTime` (same join as #3)
- **Feed-linked** — during a feed (`FeedLog.startTime..endTime` for breast) or within M min after `FeedLog.time` (M default 20)
- **Diaper-change** — within 10 min of a `DiaperLog.time` (the "diaper change pottytunity": diaper came off, offered the potty, caught one)
- **In between / timing** — none of the above

```
Wake-up      ██████████████ 42%
Feed-linked  ████████ 24%
Diaper chg   ████ 12%
In between   ███████ 22%
```

**Why EC values it.** This is Olson's Four Easy Catches (waking / diaper change / poops / transitions) turned into a mirror: it shows the family which windows their wins actually come from, and — more usefully — which easy window is contributing *nothing*, i.e. the cheapest place to add offers. Bauer's transition list (before/after nursing, waking, in/out of car seat) is the same taxonomy. Poops aren't a bucket here (they're a `type`, orthogonal to context — the panel can be filtered pee/poop). "Transition times" (car seat, carrier) are not in our data; they fall into "in between," which is fine — that bucket doubles as the "pure natural-timing catch" count, which is its own achievement.

**Computation.** Pure client-side classification over the already-fetched timeline arrays. Precedence when windows overlap (common: wake → nurse → catch): classify by the *nearest preceding trigger*, tie-break wake-up > feed > diaper (wake-up is the physiologically dominant explanation, per the ADH mechanism). Deterministic and cheap: sort three event arrays once, binary-search per catch. Edge cases: breast feeds have `startTime/endTime` (catch inside the interval = feed-linked); bottle/solids only have `time`, use the after-window; `BOTH` catches classify once, by time, like any other row.

**Data needed.** ~30–50 catches (≈ 2–3 weeks) before the proportions stop jumping around. Show raw counts, not just percentages, below that threshold.

---

### #5 — Time-of-day rhythm (the spec's distribution, designed right) + heatmap lane

**What it shows.** Two things sharing one section:

1. **A potty lane in the existing `HeatmapsTab`** — one more vertical 24h lane beside Wake / Bed / Sleep / Feeds / Diapers / Pumps. This is nearly free: add `'potty'` to `HeatmapType`, a slot-count branch keyed on `'pottyLocation' in activity` (the collision-free duck-type the spec already established), the same ±30-min smoothing window diapers use in `buildHeatmapDataForActivities`, a color, an icon, a label. Placing the lane **adjacent to Wake and Feeds** makes correlation visible for free — you see the potty hot-band sitting just under the wake band.
2. **In `PottyStatsSection`, an hour-of-day histogram** (24 bins or 2h bins while data is thin), pee/poop split, for the selected range — the "when does she go" chart the spec asked for.

```
        12a   6a      12p     6p     12a
Wake     ░░░░▓█▓░░░░░░░▓▓░░░░░░░░░░░░░
Potty    ░░░░░▓█▓░░▓▓░░░█▓░░▓░░▓▓░░░░░
Feeds    ░░░▓▓██▓░░▓█▓░░▓█▓░░░██▓░░░░░
```

**Why EC values it — and why it's ranked below the joins.** Practitioners do watch "generic timing," and as babies age a real circadian pattern emerges (morning pee cluster, post-lunch poop, etc.); The Log app's core report is exactly a timing graph. But the literature is blunt that the underlying rhythm is anchored to **sleep and feeds, not the clock** (Bauer: after sleep, feeding, activity; Olson's Baby Care Cycle is event-relative; Boucke charts relative to waking/feeding). While naps drift daily, clock-time histograms smear the true pattern. See §5 for the design consequence — the clock view should be kept (it matures well and is what the existing machinery renders) but the *anchored* views (#3, #4, #6) are the ones that reflect how EC actually predicts the next pee. Ranked #5, not #1, for exactly that reason, despite being the item the spec names.

**Computation.** Timeline potty rows → local hour via `useTimezone`; heatmap lane via the existing 288-slot utils. Edge case: none beyond timezone. **Data needed:** the honest weakness — ~50+ catches (3–4 weeks) before a 24-bin histogram looks like signal instead of noise; use 2-hour bins under ~50 rows and let the bin width tighten as data accumulates.

---

### #6 — Typical interval & longest dry stretch («the developmental curve»)

**What it shows.** Combining `PottyLog` and `DiaperLog` into one "elimination evidence" stream (catches at their true time; diaper changes as *upper-bound* markers, since the pee happened at some unknown point before the change):

- **Typical daytime interval:** median gap between consecutive elimination-evidence events, daytime only (between first wake and night sleep start), per week — plotted as a slowly rising line across months
- **Longest dry stretch this week:** the max daytime gap
- **Nap dryness:** naps where a catch occurred within N min after `endTime` *and* no wet diaper (`WET`/`BOTH`) was logged from sleep start to end+N — i.e., she held it through the nap and released it in the potty. Count per week.

```
interval
 90m |                        ●
 60m |            ●    ●
 30m |  ●    ●
     +──feb──mar──apr──may──jun──
```

**Why EC values it.** Lengthening intervals are the developmental signal every tradition celebrates: Montessori's dryness-awareness arc through the 12–18-month sensitive period; the clinical case report's doubling void volumes and lengthening intervals; Go Diaper Free noting babies range from "every 15 minutes" to long dry stretches as early as 3–4 months. The Log app's entire premise is "learn the interval, set an alarm." Nap dryness specifically is the precursor milestone to night dryness (nap dryness typically arrives months or years earlier). And the interval directly answers the operational question: *she last went 50 minutes ago and her typical gap is 60 — offer soon.*

**Computation and its honesty caveat.** Gaps computed between consecutive events in the merged stream, restricted to daytime, excluding gaps that span an unlogged stretch (cap: ignore gaps > 6h as logging gaps, not continence). The caveat to print in the UI: a diaper-change timestamp lags the actual pee by up to the change interval, so absolute interval values are overestimates; the *trend* is still real because the logging lag is roughly stationary. Nap-dryness edge cases: open-ended naps excluded; if no diaper log exists at all in the window, require the wake-up catch to still count it (absence of a wet-diaper log alone is not evidence of dryness — could just be unlogged).

**Data needed.** The weekly median needs consistent diaper+potty logging; trend line needs 4–6 weeks to show anything. Ship the "longest dry stretch" and nap-dryness counts first (meaningful in ~2 weeks); the multi-month line becomes the payoff later.

---

### #7 — Receptacle mix (`pottyLocation` breakdown)

**What it shows.** A simple count-by-receptacle bar list for the range: Potty Chair 34, Toilet 12, Outside 3 … optionally trended by month.

**Why EC values it.** Weak analytically, but it's the only stat using the field the family taps on every log, and Montessori's toilet-learning arc gives it one real use: watching the mix shift from potty chair toward the toilet is a legible independence signal for an older baby. Also zero-cost to compute and it fills the section's accordion nicely.

**Computation.** `GROUP BY pottyLocation` client-side; null → "Unspecified." **Data needed:** day 1 (it's just counts). Rank it last and give it the least screen area.

---

## 2. What to explicitly NOT build

- **Catch rate / success percentage (catches ÷ attempts).** The canonical potty-training-app stat and the first thing a generic dashboard designer reaches for. Requires attempt logging, which this family has deliberately rejected (spec: "We do not want to track attempts or misses — only wins"). Nothing in our schema can fake it, and nothing should try.
- **Miss counts, misses-by-time-of-day, "missed signals."** Same reason. Also note: we don't log signals at all (Bauer/Boucke's cue-observation charts have no schema backing beyond free-text `notes`); don't build anything that pretends we do.
- **A pee "catch rate" via `caught ÷ (caught + wet diapers)`.** Tempting symmetry with #2, but misleading enough to actively avoid: a single wet diaper in a young baby routinely absorbs several pees (newborns pee up to ~every 15 minutes; nobody changes 20 diapers a day), so the denominator undercounts eliminations by an unknown, age-varying factor and the "rate" would flatter wildly and then appear to *regress* as diaper changes get less frequent. The honest pee-side progress stat is the pair of raw trends: catches/day rising (#1) while **wet diapers/day** falls (already computable in `DiaperStats`; worth surfacing side-by-side in the potty section as "diapers saved" framing, without dividing one by the other).
- **Night-dryness percentage.** The milestone practitioners most celebrate, but `DiaperType` has no "dry" value — a dry-diaper check is unrecordable, so a dry night is indistinguishable from an unlogged night. Building it on "no wet diaper logged before 7am" would reward forgetting to log. If the family ever wants it, the right fix is schema-level (a dry-check log), not a proxy. Note as future work only.
- **Predictive "next pee at 2:47pm" alerts.** The Log app's alarm feature is fine for a phone-native observation tool, but with a few catches/day of accumulation our interval estimates will carry ±30min+ error for months; a confident-looking prediction would erode trust. Show the typical-interval *range* (#6) and let the humans predict.
- **Location "success" comparisons** (e.g., "toilet catches are 40% of potty-chair catches — use the toilet less"). Receptacle choice is caused by context (wake-up catches happen near the bedroom potty chair), so any implied causality would be spurious.

## 3. MVP cut — if Phase 2 ships only three things

1. **#1 Catches per day + cards** — meaningful from the first row, structurally a clone of `DiaperStatsSection` + `DiaperChartModal` (accordion section, stat cards, tap-through bar chart), so it's also the cheapest. It is the section's skeleton; everything else hangs off it.
2. **#5 Time-of-day rhythm + heatmap lane** — it's the item the approved spec names for Phase 2, and the heatmap lane is a ~30-line addition to existing machinery (`timeline-heatmap.utils.ts` + `HeatmapsTab` constants). Ship the histogram with adaptive (2h → 1h) bins so it degrades gracefully during the low-data months.
3. **#3 Wake-up catch panel** — one join, and it's the feature no paper log or dedicated EC app can replicate; it's also the one that will actually change behavior in week two ("we're only catching 2 of 7 night wake-ups — start offering then"). If the panel is too much UI, ship just the two cards: *wake-up catches* and *typical gap after waking*.

**#2 (poop scoreboard) is the first follow-up** — arguably it beats #3 on emotional payoff, but it needs a couple of weeks of parallel diaper data before the weekly trend exists, and its two cards can be added to the #1 grid cheaply later. #4 and #6 are the month-two additions once data density supports them. The monthly report card (spec's third Phase 2 item) should take: total catches, catches/day, poop-catch share, and longest dry stretch — all computable from the four numbers above.

## 4. How the literature should change the spec'd time-of-day design

The spec says "a time-of-day pattern in Reports … reveals her rhythm and lets us predict the next window." The literature's correction: **for a baby this age, the rhythm is event-anchored, not clock-anchored.** Bauer's rhythm list is "after sleep, feeding, or activity"; Boucke charts frequency *in relation to waking and feeding*; Olson's Baby Care Cycle is entirely relative ("wake → pottytunity → nurse → pottytunity before nap"), and her Easy Catch #1 has a physiological clock — ADH wears off *at waking*, whenever waking happens. A 9:40am nap-end and an 11:15am nap-end both produce a wake-pee; on a clock histogram those smear into two mild bumps, while on a "minutes since waking" axis they stack into one sharp spike.

Concrete design consequences:

1. **Keep the clock view, but as a heatmap lane placed next to Wake and Feeds** (see #5) so the correlation is at least visually available. Clock views also *improve with age* as circadian regularity and consolidated naps emerge, so it's the right long-term chart.
2. **Add the anchored complements** — the wake-up panel (#3) and context breakdown (#4) are the analytical form; if only one anchored *chart* fits, make it a "minutes since last wake" histogram (0–10, 10–20, … 60+), which is where the predictive value the spec wants actually lives.
3. **Bin adaptively.** At 2–5 catches/day, a 24-bin clock histogram is noise for the first month. Start at 2-hour bins below ~50 catches, 1-hour above; the heatmap lane's ±30-min smoothing (already the diaper-lane convention) handles this automatically.
4. **Split pee/poop everywhere.** Poop timing (often one predictable daily slot — post-breakfast is the cliché, and constipation-managed babies are near-100% caught) is a different and usually *stronger* pattern than pee timing; merging them buries the strongest signal the family has. `BOTH` rows count in each split.

## 5. Computability appendix (schema ↔ stat matrix)

| # | Stat | Tables | Fields | Meaningful after |
|---|------|--------|--------|------------------|
| 1 | Catches/day | PottyLog | time, type, deletedAt | day 1 |
| 2 | Poop scoreboard | PottyLog, DiaperLog | time, type both tables | ~2 weeks |
| 3 | Wake-up panel | PottyLog, SleepLog | time; endTime, type (NAP/NIGHT_SLEEP) | 1–2 weeks |
| 4 | Context breakdown | PottyLog, SleepLog, FeedLog, DiaperLog | time; endTime; startTime/endTime/time; time | 2–3 weeks |
| 5 | Time-of-day + lane | PottyLog | time, type | 3–4 weeks |
| 6 | Intervals / dry stretch | PottyLog, DiaperLog, SleepLog | time, type; time, type; start/endTime | 2 wks (cards), 6 wks (trend) |
| 7 | Receptacle mix | PottyLog | pottyLocation | day 1 |

All computations: exclude `deletedAt != NULL`, scope by `babyId`, resolve days/weeks in the family timezone via `useTimezone().toLocalDate` (the `getCalendarDayKey` pattern in `StatsTab.tsx`). All are client-side over the `/api/timeline` payload the Reports page already fetches — potty rows are already in it (`app/api/timeline/route.ts` fetches `pottyLog` since Phase 1); #3/#4/#6 need the sleep/feed/diaper rows that same payload already contains. No new API endpoints required for any proposal.

## Sources

- Andrea Olson, Easy Catch #1 (wake-up pee, ADH mechanism): https://godiaperfree.com/easy-catch-1-the-wake-up-pee-whats-so-magical-about-rising-and-shining/ and https://godiaperfree.com/easy-catch-1-wake-up-pee/
- Andrea Olson, Easy Catch #2 (diaper change) and the four easy catches: https://godiaperfree.com/easy-catch-2-the-diaper-change-the-magic-behind-this-perfect-pottytunity/
- Andrea Olson, How to begin EC (Baby Care Cycle, four easy catches, natural-timing logging, "every 15 minutes" to long dry stretches): https://godiaperfree.com/how-to-begin-elimination-communication-a-little-recap-of-how-to-start-ec-at-each-stage-and-age/
- "The Log: Potty Training + EC" app (intervals report, potty-time alarm from actual timing intervals): https://apps.apple.com/us/app/id1592014976
- Ingrid Bauer, *Diaper Free!* — natural rhythms (after sleep/feeding/activity, regular intervals after nursing, transition times): https://www.naturalchild.org/articles/guest/ingrid_bauer.html and https://continuumconcept.org/articles/elimination-communication
- Laurie Boucke, *Infant Potty Training* — charting elimination patterns relative to waking and feeding: https://kellymom.com/parenting/parenting-faq/infantpottytraining/ and https://en.wikipedia.org/wiki/Infant_Potty_Training
- Bladder capacity in an EC infant, case report (intervals/capacity growth; early bowel continence; nap/night dryness sequence): https://jmedicalcasereports.biomedcentral.com/articles/10.1186/s13256-023-04267-4
- Montessori toileting (12–18-month sensitive period, dryness awareness): https://www.montessori.org/toileting-the-montessori-way/ and https://www.dailymontessori.com/self-development/the-montessori-approach-to-toilet-learning-timing-and-techniques/
- Nap dryness precedes night dryness: https://www.chooniez.com/blogs/leak-less-library/potty-training-at-nap-time-complete-2025-guide-to-dry-afternoons
- Community practice (r/ECers; poop-continence milestones): https://reddit.com/r/ECers/comments/1oj9a17/if_duolingo_did_an_ec_app/ and https://cafemom.com/parenting/223119-mom-shares-elimination-communication-method
