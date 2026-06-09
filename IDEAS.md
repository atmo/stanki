# Stanki — Ideas / Backlog

Candidate features beyond what's already built (SM-2 + daily limits + bidirectional
review + in-session Again + Drive/review-log sync + Dutch lookup + Stats). Effort is
a rough guess: **S** small, **M** medium, **L** large.

## Top picks (high value, low risk)
- [ ] **Undo last review** (S) — restore the previous card + its pre-grade schedule on an Undo button / `z` key. `gradeCard` already returns the updated card.
- [ ] **Keyboard shortcuts in review** (S) — Space/Enter = show, `1/2/3` = Again/Good/Easy, `e` = edit, `z` = undo.
- [ ] **Text-to-speech for the word** (S–M) — `SpeechSynthesis` with a Dutch (`nl-NL`) voice, 🔊 button, optional auto-play on reveal. No API, fits a Dutch vocab app.
- [ ] **Review heatmap + streak** (M) — calendar heatmap of reviews/day and current streak (review log is now synced). Also reviews-per-day and **true retention** (% correct on mature cards).

## Review & scheduling
- [ ] **Suspend / bury a card** (S) — skip for now or for the session; `suspended` flag that syncs like `deleted`.
- [ ] **Leech detection** (S–M) — auto-flag/suspend cards failed N times; surface in Stats.
- [ ] **Custom study / cram** (M) — review ahead of schedule or re-drill without touching real due dates.
- [ ] **Type-in answer mode** (M) — type the back and get checked; per-deck option, good for spelling.

## Content & editing
- [ ] **Tags on cards + filter** (M) — cross-deck organization and study-by-tag.
- [ ] **Cloze deletions** (M) — `{{c1::…}}` style cards for sentences.
- [ ] **Duplicate detection on add** (S) — warn if the front already exists (handy with the extension Inbox).
- [ ] **Images on cards** (M) — stored as blobs; consider sync cost.

## Sync, accounts & data
- [ ] **Show the signed-in Google account** (S) — surface the email in Settings/About (addresses the multi-account confusion hit while debugging daily limits).
- [ ] **Local review-log GC** (S) — `db.reviews` grows unbounded locally; prune old entries (the synced file is already windowed).
- [ ] **Force full re-sync / repair** button (S).

## UX & PWA
- [ ] **Responsive nav** (S) — top nav is crowded on mobile; bottom tab bar or overflow menu.
- [ ] **Light/dark theme toggle** (S) — dark-only today.

## Dutch-specific niceties
- [ ] **de/het article + part-of-speech** auto-fill from the lookup (S–M).
- [ ] **Inflections / conjugations** shown on the card back (M).

---

**Suggested next sprint:** Undo + keyboard shortcuts + TTS (all small, immediately felt),
then heatmap/streak + true retention to pay off the review-log work.
