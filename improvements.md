# Stanki — Scheduler improvements

From a review of `shared/sm2.ts`. The trigger is measured **true retention of ~63%**
against the ~90% that SM-2 nominally targets — i.e. roughly one card in three is
forgotten by the time it comes back, which is both discouraging and wasteful (a lapse
throws away the interval it took to build).

Effort is a rough guess: **S** small, **M** medium, **L** large.

## Measure before tuning

Retention alone doesn't say *why*. One check gates everything below:

- [ ] **Overdue ratio** (S–M) — actual elapsed ÷ `prevInterval`, per review. If cards are
      habitually reviewed late, the *effective* intervals are longer than any setting says,
      and the fix is habit rather than the scheduler. Chain consecutive reviews per
      card+direction for exact timestamps (validate with `b.prevInterval === a.newInterval`
      to detect holes), falling back to `prevDue` where the chain breaks.
- [ ] **Lapse concentration** (S) — what share of lapses come from what share of cards.
      Spread evenly → scheduler too aggressive. Concentrated → a few leeches, fix the cards.

If the overdue ratio is well above 1, the retention-by-interval chart is mislabeled: it
buckets by *scheduled* interval while the real wait was longer. Bucketing that chart by
**actual elapsed days** would be the honest x-axis.

## Prioritized

| # | Change | Why / effort |
|---|---|---|
| 1 | **Interval modifier** (global `×N` on every interval) | The one *retroactive* lever — hits all cards, new and existing, on their next review. `startingEase` only affects new cards. **S** |
| 2 | **Hard grade** (q=3, `×~1.2`, ease −0.15) | The missing pressure valve: today a barely-recalled card still gets the full `×ease` jump, and Good never lowers ease. UI + `scheduleState`. **M** |
| 3 | **Interval fuzz** (±~15%, applied once at grade time) | Intervals are deterministic, so a cohort introduced together comes due together forever. Kills avalanches, smooths the forecast; biggest win for cram decks. **S** |
| 4 | **Reschedule tool** | 1–3 only shorten *future* intervals, so the existing over-scheduled backlog keeps failing for weeks. This recovers it now. **M** |
| 5 | **Learning / relearning steps** | A new card graduates on one Good, and a lapse resets straight to 1 day — no 10-minute consolidation. Attacks young-card (encoding) failures. Needs a learning-state field, since `interval` currently doubles as learning-step storage. **L** |
| 6 | **Leech auto-suspend · max-interval cap · configurable graduating/second interval** | Lapsing cards bottom out at `MIN_EASE` and get stuck with nothing flagging them; intervals grow unbounded; the graduating `1` and second `4` are hardcoded. **S** each |
| 7 | **FSRS as an optional scheduler** | Targets a chosen retention % directly, superseding 1–3 and 5. The review log now records what an optimizer needs. **L** |

## Smaller fixes

- [ ] **DST edge in `scheduleState`** (S) — `startOfLocalDay(now + interval * DAY_MS)` uses
      fixed-ms day math, so a target crossing a DST boundary can land a day off. Calendar-day
      arithmetic is exact (the same class of bug already fixed in the stats bucketing).

## Already done

- Second interval `6 → 4`, shortening the whole mature curve by ~⅓.
- Per-deck scheduling and limit overrides.
- Retention-by-interval chart (the forgetting curve), plus the young/mature split.
- Reviews now record `deckId`, `prevDue`, `prevEase`, `reps`, `thinkMs`, `durationMs`.
- Review log included in exports/backups and synced in full (no 14-day window).
