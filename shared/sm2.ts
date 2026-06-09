import type { Card, CardDirection, CardSchedule, Grade, ReviewDirection } from './types';

const DAY_MS = 86_400_000;
const MIN_MS = 60_000;
const MINS_PER_DAY = 1440;
const MIN_EASE = 1.3;

export interface SrSettings {
  startingEase: number; // default 2.5
  easyBonus: number; // multiplier applied to interval on "easy"
  againInterval: number; // minutes to wait after "again" (min 1)
  newCardsPerDay: number; // max brand-new cards introduced per deck per day
  maxReviewsPerDay: number; // max review (non-new) cards per deck per day
}

export const DEFAULT_SETTINGS: SrSettings = {
  startingEase: 2.5,
  easyBonus: 1.3,
  againInterval: 1,
  newCardsPerDay: 20,
  maxReviewsPerDay: 50,
};

export interface DailyReviewCounts {
  newToday: number; // new cards already introduced today (this deck)
  reviewsToday: number; // review cards already done today (this deck)
}

/** Local midnight for `now` — the day boundary for the daily limits. */
export function startOfDay(now = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
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
 */
export function selectDue(
  items: ReviewItem[],
  daily: DailyReviewCounts,
  settings: SrSettings,
  now = Date.now(),
): ReviewItem[] {
  const due = items
    .filter((i) => !i.card.deleted && i.schedule.dueDate <= now)
    .sort((a, b) => a.schedule.dueDate - b.schedule.dueDate);
  const newRemaining = Math.max(0, settings.newCardsPerDay - daily.newToday);
  const reviewRemaining = Math.max(0, settings.maxReviewsPerDay - daily.reviewsToday);
  const newItems = due.filter((i) => i.schedule.interval === 0).slice(0, newRemaining);
  const reviewItems = due.filter((i) => i.schedule.interval > 0).slice(0, reviewRemaining);
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
    // Lapse: re-show after a few minutes. Interval is kept as a fraction of a
    // day so it stays > 0 (a "review", not "new") while expressing sub-day time.
    repetitions = 0;
    easeFactor = Math.max(MIN_EASE, easeFactor - 0.2);
    const mins = Math.max(1, settings.againInterval);
    return { interval: mins / MINS_PER_DAY, easeFactor, repetitions, dueDate: now + mins * MIN_MS };
  }

  const q = grade === 'easy' ? 5 : 4; // quality score
  repetitions += 1;

  if (repetitions === 1) interval = 1;
  else if (repetitions === 2) interval = 6;
  else interval = Math.round(interval * easeFactor);

  easeFactor = Math.max(
    MIN_EASE,
    easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)),
  );

  if (grade === 'easy') interval = Math.round(interval * settings.easyBonus);

  interval = Math.max(1, interval);

  return { interval, easeFactor, repetitions, dueDate: now + interval * DAY_MS };
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
