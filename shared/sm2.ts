import type { Card, CardDirection, CardSchedule, Grade, ReviewDirection, SrSettings } from './types';

export type { SrSettings }; // re-export so existing '@shared/sm2' importers keep working

const DAY_MS = 86_400_000;
const MIN_MS = 60_000;
const MINS_PER_DAY = 1440;
const MIN_EASE = 1.3;

export const DEFAULT_SETTINGS: SrSettings = {
  startingEase: 2.5,
  easyBonus: 1.3,
  easyFirstInterval: 4,
  againInterval: 1,
  newCardsPerDay: 20,
  maxReviewsPerDay: 50,
};

export interface DailyReviewCounts {
  newToday: number; // new cards already introduced today (this deck)
  reviewsToday: number; // review cards already done today (this deck)
}

/**
 * Start of the day for `now`, in UTC — the day boundary for the daily limits.
 * Deliberately timezone-independent so every device agrees which reviews count
 * as "today"; a local-midnight boundary diverged across devices in different
 * timezones (or with a skewed clock), breaking the cross-device daily limit.
 */
export function startOfDay(now = Date.now()): number {
  return Math.floor(now / 86_400_000) * 86_400_000;
}

/** Local midnight for `now` — when a day-scheduled review card becomes due. */
export function startOfLocalDay(now = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Next local midnight — the cutoff for "due today" (cards due any time today). */
export function endOfLocalDay(now = Date.now()): number {
  return startOfLocalDay(now) + DAY_MS;
}

/** One thing to review: a card shown in a particular direction, with its schedule. */
export interface ReviewItem {
  card: Card;
  direction: CardDirection;
  schedule: CardSchedule;
}

/** The schedule for a given direction; a missing reverse schedule reads as new+due. */
export function directionSchedule(
  card: Card,
  direction: CardDirection,
  settings: SrSettings = DEFAULT_SETTINGS,
): CardSchedule {
  if (direction === 'forward') {
    const { interval, easeFactor, repetitions, dueDate } = card;
    return { interval, easeFactor, repetitions, dueDate };
  }
  return card.reverse ?? { ...newCardState(card.createdAt, settings) };
}

/** Expand a card into the review items its deck direction calls for. */
export function itemsForCard(
  card: Card,
  direction: ReviewDirection,
  settings: SrSettings = DEFAULT_SETTINGS,
): ReviewItem[] {
  if (card.deleted) return [];
  const dirs: CardDirection[] = direction === 'both' ? ['forward', 'reverse'] : [direction];
  return dirs.map((d) => ({ card, direction: d, schedule: directionSchedule(card, d, settings) }));
}

/**
 * Review items due now, capped by the per-day new/review limits. An item is
 * "new" until its first review (interval === 0). Reviews come first, then new.
 *
 * Buries siblings (Anki-style): a card's two directions never appear in the same
 * session — reviews are picked first, so a due review wins over introducing that
 * card's other side, and the buried side simply becomes due again another day.
 */
export function selectDue(
  items: ReviewItem[],
  daily: DailyReviewCounts,
  settings: SrSettings,
  now = Date.now(),
): ReviewItem[] {
  // Day-level scheduling: a card due any time today is due today (not only once
  // its exact timestamp passes), matching the local-midnight due dates.
  const cutoff = endOfLocalDay(now);
  const due = items
    .filter((i) => !i.card.deleted && i.schedule.dueDate < cutoff)
    .sort((a, b) => a.schedule.dueDate - b.schedule.dueDate);
  const newRemaining = Math.max(0, settings.newCardsPerDay - daily.newToday);
  const reviewRemaining = Math.max(0, settings.maxReviewsPerDay - daily.reviewsToday);

  const seen = new Set<string>(); // card ids already chosen — bury the sibling
  const reviewItems: ReviewItem[] = [];
  for (const it of due) {
    if (it.schedule.interval === 0 || seen.has(it.card.id)) continue;
    if (reviewItems.length >= reviewRemaining) continue;
    reviewItems.push(it);
    seen.add(it.card.id);
  }
  const newItems: ReviewItem[] = [];
  for (const it of due) {
    if (it.schedule.interval > 0 || seen.has(it.card.id)) continue;
    if (newItems.length >= newRemaining) continue;
    newItems.push(it);
    seen.add(it.card.id);
  }
  return [...reviewItems, ...newItems];
}

// Fresh scheduling state for a brand-new card (due immediately).
export function newCardState(now = Date.now(), settings = DEFAULT_SETTINGS): CardSchedule {
  return {
    interval: 0,
    easeFactor: settings.startingEase,
    repetitions: 0,
    dueDate: now,
  };
}

/**
 * SM-2 adapted to three grades, operating on a single direction's schedule.
 * Pure: returns the next schedule without mutating the input.
 */
export function scheduleState(
  s: CardSchedule,
  grade: Grade,
  now = Date.now(),
  settings: SrSettings = DEFAULT_SETTINGS,
): CardSchedule {
  let { interval, easeFactor, repetitions } = s;

  if (grade === 'again') {
    // Re-show within the session. Interval is kept as a fraction of a day so it
    // stays > 0 (a "review", not "new") while expressing sub-day time. Ease is
    // only dented for a genuine lapse of an already-graduated card (interval
    // >= 1 day) — repeatedly pressing Again while learning shouldn't thrash it.
    repetitions = 0;
    if (interval >= 1) easeFactor = Math.max(MIN_EASE, easeFactor - 0.2);
    const mins = Math.max(1, settings.againInterval);
    return { interval: mins / MINS_PER_DAY, easeFactor, repetitions, dueDate: now + mins * MIN_MS };
  }

  const q = grade === 'easy' ? 5 : 4; // quality score
  repetitions += 1;

  if (repetitions === 1) {
    // Graduating interval: Easy jumps ahead of Good so the two differ on a new
    // card (otherwise the easy bonus rounds 1d back to 1d).
    interval = grade === 'easy' ? settings.easyFirstInterval : 1;
  } else {
    interval = repetitions === 2 ? 4 : Math.round(interval * easeFactor);
    if (grade === 'easy') interval = Math.round(interval * settings.easyBonus);
  }

  easeFactor = Math.max(
    MIN_EASE,
    easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)),
  );

  interval = Math.max(1, interval);

  // Day-scheduled reviews become due at local midnight of the target day, so the
  // card is available all that day rather than only after the exact review time.
  return { interval, easeFactor, repetitions, dueDate: startOfLocalDay(now + interval * DAY_MS) };
}

// Random spread applied to a day-scale interval, and the interval below which
// there is no room to spread (a 1-day interval can only stay 1 day).
/**
 * Which set of scheduling rules produced a review. Stamped on every log entry so
 * a later analysis can segment instead of silently averaging across regimes —
 * without it, a retention figure blends rules that no longer exist.
 *
 * Bump this whenever a change alters the intervals the scheduler produces.
 *   1 — original SM-2: second interval 6d, no fuzz
 *   2 — second interval 4d; intervals fuzzed +/-15%
 */
export const SCHEDULER_VERSION = 2;

const FUZZ = 0.15;
const MIN_FUZZ_INTERVAL = 2;

/**
 * Nudge a scheduled interval by up to ±15% (at least a day) so that cards
 * introduced together stop coming due together. Without it intervals are exactly
 * deterministic, so a batch learned on one day stays a batch forever — review
 * avalanches and a spiky forecast, worst on a deck crammed in a few sittings.
 *
 * Deliberately *not* part of `scheduleState`: that stays pure and deterministic,
 * so the grade buttons keep previewing the interval you'd actually reason about
 * rather than a different random draw each render. Applied once here, at the
 * point the schedule is persisted, and stored — so it syncs like any other value
 * and the logged `newInterval` matches what the next review will see as
 * `prevInterval` (which the review-chain integrity check relies on).
 */
export function fuzzSchedule(
  s: CardSchedule,
  now = Date.now(),
  rand: () => number = Math.random,
): CardSchedule {
  if (s.interval < MIN_FUZZ_INTERVAL) return s; // learning steps and 1-day intervals
  const spread = Math.max(1, Math.round(s.interval * FUZZ));
  const interval = Math.max(1, s.interval + Math.round((rand() * 2 - 1) * spread));
  return { ...s, interval, dueDate: startOfLocalDay(now + interval * DAY_MS) };
}

/** Apply a grade to a card's forward schedule (kept for tests/back-compat). */
export function schedule(
  card: Card,
  grade: Grade,
  now = Date.now(),
  settings: SrSettings = DEFAULT_SETTINGS,
): Card {
  return { ...card, ...scheduleState(card, grade, now, settings), updatedAt: now };
}

/** Interval (in days) each button would produce — for the review UI labels. */
export function previewIntervals(
  s: CardSchedule,
  settings: SrSettings = DEFAULT_SETTINGS,
): Record<Grade, number> {
  // Interval is independent of `now`, so any reference time works here.
  return {
    again: scheduleState(s, 'again', 0, settings).interval,
    good: scheduleState(s, 'good', 0, settings).interval,
    easy: scheduleState(s, 'easy', 0, settings).interval,
  };
}
