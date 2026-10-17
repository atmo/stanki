# Stanki — Ideas / Backlog

Candidate features beyond what's already built. Effort is a rough guess:
**S** small, **M** medium, **L** large.

Already shipped, so not repeated below: SM-2 with four grades and per-deck
settings, interval fuzz, daily limits, bidirectional review with sibling burying,
undo, Drive sync of decks and the full review log, monthly archives, local error
logging, Dutch lookup with lemma-aware highlighting, leech flagging, and a Stats
tab covering retention, the forgetting curve, backlog, forecast and history.

Relearning works by queue position: a missed card returns at a random spot at
least `againGapCards` (50) ahead, and is held over until tomorrow when fewer
cards than that remain or the day's allowance for it runs out. Held-over cards
are flagged on the card, exempt from the review cap, and counted apart from
cards falling due.

Studying one side of a two-sided card buries the other until the next day, so a
deck is one sitting rather than two. `bothDirectionsPerSession` turns that off
for a deck that would rather have everything in one queue.

## What the data already ruled out

Findings from analysing a real 8,656-review export (`scripts/analyze-export.py`),
kept here so they don't get re-proposed:

- **An interval modifier is the wrong lever.** Retention *rose* with interval
  (61.7% at 1–2d, 86.5% mature) — long intervals were fine. Shortening them would
  add load to an already-oversubscribed queue.
- **Lateness, not interval length, was the cost.** One-day cards were arriving at
  ~4× their interval; feeding that delay into a forgetting curve predicts almost
  exactly the retention observed.
- **New-card learning is fine; relearning was broken.** First day after
  introduction 82.6%, first day after a relearn 55.7% — so learning steps for
  *new* cards are not needed. Only the relearning path was, and it has been
  rebuilt around queue position.
- **Spacing is real but small, and waiting is the wrong way to buy it.** Holding
  card maturity fixed, a longer gap before the retry is worth ~9–10 points, not
  the ~39 the raw buckets suggested. Five minutes beats two by about a point,
  while leaving a card until tomorrow beats both — so spacing should come from
  work you were going to do anyway, never from a timer that can strand you.
- **Fast answers are good answers.** Failures were the slowest grade; sub-2s
  answers went on to pass 87.4% against 69.6% for 15s+ ones. Rushing was not the
  problem — but latency is a strong difficulty signal the scheduler still ignores.

## Top picks (high value, low risk)

- [ ] **Keyboard shortcuts in review** (S) — Space/Enter = show, `1/2/3/4` =
      Again/Hard/Good/Easy, `e` = edit, `z` = undo.
- [ ] **Text-to-speech for the word** (S–M) — `SpeechSynthesis` with a Dutch
      (`nl-NL`) voice, 🔊 button, optional auto-play on reveal. No API, fits a
      Dutch vocab app.
- [ ] **Review heatmap + streak** (M) — calendar heatmap of reviews/day plus
      current and longest streak. The per-day data is already computed for the
      history charts; this is presentation.
- [ ] **Use `thinkMs` to modulate the interval** (M) — the automatic version of
      the Hard grade, and the best-evidenced idea here: an 18-point spread in
      next-review success between fast and slow passes, currently scheduled
      identically. Needs a few weeks of logged timing to calibrate against.

## Review & scheduling

- [ ] **Suspend a card** (S) — take a card out of the queue without deleting it;
      a `suspended` flag on `CardSchedule` (per direction, like the rest of the
      schedule) that syncs like `deleted`. Leech flagging deliberately stops short
      of this, but manual suspend is still missing.
- [ ] **Soften the ease penalty on Hard** (S, decide with data) — Hard costs
      -0.14 ease, which falls out of the SM-2 quality formula at q=3. Softening it
      (say -0.05, as an explicit step or a `hardEasePenalty` setting) means no
      longer deriving it from `q`, so this is a deliberate departure from
      textbook SM-2 — unlike exempting learning steps, which only makes Hard
      match what the Again path already does.

      The case for: Hard now grows the interval by `max(x1.2, +1)` rather than
      `x ease`, so it already schedules the card sooner. Ease is a *second*
      penalty, and it keeps applying to every later Good. A card graded Hard five
      times over its life then Good from 10 days reaches 104d at -0.14 against
      252d at -0.05 — identical study history, and review frequency is inversely
      proportional to interval, so roughly 2.5x the lifetime reviews.

      The case against: ease exists to encode "this card is hard for me", and
      -0.05 may under-signal. Note Good is neutral and Easy is pressed 1% of the
      time, so ease only ratchets downward: over four months it ran -857
      ease-points against +22 recovered, median ease 2.50 -> 2.30, units on the
      1.30 floor 1.9% -> 9.4%.

      Deliberately parked for a month: flooring Hard's interval gain (scheduler
      v6) may stop the floor filling on its own, which settles the question. Watch
      the share of units at 1.30 — if it is still climbing, soften; if it has
      flattened, leave SM-2 alone. Separately, units already on the floor never
      recover, since only Easy lifts ease — a repair pass or a higher MIN_EASE is
      its own decision.
- [ ] **Resume a lapse from where it was** (M) — a miss overwrites the card's
      interval with a sub-day value, so a 60-day card that slips restarts at 1 day
      and re-climbs `1 → 4 → 10 → 25`. Measured over four months: 2,646 lapses
      gave up 11,028 card-days. Worth less than first estimated, though — 1,618 of
      those were already at 1 day, where there is nothing to preserve, so the
      prize is the ~970 lapses from 2d and up, perhaps 10% of volume rather than
      "the largest remaining cut". The pre-lapse interval survives in the log as
      the miss's `prevInterval`, so carrying it on the card (a `lapsedFrom`) would
      let relearning resume at a fraction of it, as Anki's "new interval"
      percentage does.
- [ ] **Put held-over cards near the front of the next day's queue** (S) —
      `reviewQueue` shuffles, so a card carried over lands anywhere. Landing late
      means too few cards remain to re-queue it, so it is held over again and can
      ping-pong for days without ever getting a same-day retry.
- [ ] **Study every deck in one session** (M) — one queue across all decks rather
      than opening each in turn. Build each deck's queue with its own settings and
      its own daily counts, then merge and shuffle: selection still runs per deck,
      so limits, review direction, burying and sibling rules all keep their
      meaning. Needs a separate route (`/review-all`) — deck ids are not all
      uuids, `inbox` and the KNM imports use literal ones — and the card's deck
      shown per card, since a Dutch word and a civics question are different
      tasks.

      Prerequisite: `Review.tsx` resolves settings once per session, but the
      *defer decision* reads `againGapCards`/`againMaxPerDay` from them, so a
      mixed queue would apply one deck's rules to another's cards. Wants a
      `Map<deckId, SrSettings>`; a no-op for a single deck, so it can land first
      on its own. `gradeCard` is already per-card and needs nothing.

      Blocked on one decision: **per-deck limits add up**. 50 + 50 + 20 + 20 + 20
      is up to 160 new cards a day, and De/het and Irregular verbs hold 1,613
      unseen cards between them — decks that are parked, not abandoned (Irregular
      verbs has 2 studied cards). So a deck needs a way to sit out a combined
      session: either `newCardsPerDay: 0`, which also stops it being studied
      directly, or an "include in all-decks review" flag, which does not. The flag
      is the better answer; it is one more setting.

      Side effect worth expecting: hold-overs drop sharply. Tail deferrals are a
      property of a session's *end* (~`gap` x miss-rate, confirmed across gap
      values), so merging three sittings into one replaces three tails with one —
      roughly 57 held-over cards a day becoming 19.
- [ ] **Reschedule tool** (M) — recompute due dates under current settings, so a
      settings change reaches the existing backlog instead of only new reviews.
- [ ] **Max-interval cap + configurable graduating/second interval** (S each) —
      intervals grow unbounded, and the graduating `1` and second `4` are
      hardcoded.
- [ ] **Custom study / cram** (M) — review ahead of schedule or re-drill without
      touching real due dates.
- [ ] **Type-in answer mode** (M) — type the back and get checked; per-deck
      option, good for spelling.
- [ ] **FSRS as an optional scheduler** (L) — targets a chosen retention directly,
      superseding the hand-tuned knobs. The review log now records what an
      optimizer needs (`prevEase`, `prevDue`, `reps`, timing, `schedVer`).
- [ ] **DST edge in `scheduleState`** (S) — `startOfLocalDay(now + interval *
      DAY_MS)` uses fixed-ms day math, so a target crossing a DST boundary can land
      a day off. Calendar-day arithmetic is exact (already fixed in stats bucketing).

## Stats & analysis

- [ ] **Overdue ratio in-app** (S–M) — actual elapsed ÷ scheduled interval. The
      analysis script does this by chaining reviews; `prevDue` now makes it exact
      without chaining, and it is the number that explains retention best.
- [ ] **Bucket the forgetting curve by *actual* elapsed days** (S) — it currently
      buckets by scheduled interval, which mislabels the axis whenever reviews run
      late.
- [ ] **Retention vs ease** (S) — `prevEase` is logged now; tests whether ease
      predicts anything at all, or whether the collection is in "ease hell".
- [ ] **Fatigue curve** (S) — retention by `posInSession`. If accuracy decays
      within a sitting, the fix is splitting sessions, which costs nothing.
- [ ] **Daily backlog snapshot** (S) — historical backlog can't be reconstructed
      from the log, so a small daily counter in `meta` is the only way to watch it
      actually drain.

## Content & editing

- [ ] **Cloze deletions** (M) — fill-in-the-blank from the captured contexts,
      reusing the existing word matcher to place the blank. Best-encoding card type
      and most of the machinery already exists.
- [ ] **Tags on cards + filter** (M) — cross-deck organization and study-by-tag.
      The KNM import had nowhere to put its themes.
- [ ] **Duplicate detection on add** (S) — the PWA Add screen doesn't warn when the
      front already exists; the extension does.
- [ ] **Images on cards** (M) — stored as blobs; consider sync cost.

## Sync, accounts & data

- [ ] **Show the signed-in Google account** (S) — surface the email in
      Settings/About (addresses the multi-account confusion hit while debugging
      daily limits).
- [ ] **Shard the review log by month** (M) — only if sync gets slow. The whole log
      is downloaded each sync (~250 bytes/review); sharding lets a device fetch only
      what it lacks. Do *not* reinstate a TTL — the history is what the diagnostics
      run on.
- [ ] **Force full re-sync / repair** button (S).

## UX & PWA

- [ ] **Responsive nav** (S) — top nav is crowded on mobile; bottom tab bar or
      overflow menu.
- [ ] **Light/dark theme toggle** (S) — dark-only today.
- [ ] **Daily review reminder** (M) — genuinely constrained: Web Push needs a
      backend (the only option on iOS), and Periodic Background Sync is
      Chrome/Android-only and approximate. An in-app "N due" banner works
      everywhere but only once you open the app.

## Dutch-specific niceties

- [ ] **de/het article + part-of-speech** auto-fill from the lookup (S–M).
- [ ] **de/het article drill** (M) — quiz just the article for noun cards, with its
      own stat. `dedupKey` already strips articles.
- [ ] **Inflections / conjugations** shown on the card back (M).

---

**Suggested next:** keyboard shortcuts + TTS (both small, immediately felt), then
the `thinkMs` interval modulation once a few weeks of timing data exist — it is
the best-evidenced improvement left, and the field is already logging.
