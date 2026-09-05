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
- [ ] **Resume a lapse from where it was** (M) — probably the largest remaining
      cut in review volume. A miss overwrites the card's interval with a sub-day
      value, so a 60-day card that slips restarts at 1 day and re-climbs
      `1 → 4 → 10 → 25`; roughly 400 cards did that over the analysed period. The
      pre-lapse interval survives in the log as the miss's `prevInterval`, so
      carrying it on the card (a `lapsedFrom`) would let relearning resume at a
      fraction of it, as Anki's "new interval" percentage does.
- [ ] **Put held-over cards near the front of the next day's queue** (S) —
      `reviewQueue` shuffles, so a card carried over lands anywhere. Landing late
      means too few cards remain to re-queue it, so it is held over again and can
      ping-pong for days without ever getting a same-day retry.
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
