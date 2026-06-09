import type { Card, Grade } from './types';

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

/**
 * Cards due now, capped by the per-day new/review limits. A card is "new" until
 * its first review (interval === 0). Review cards come first, then new cards.
 */
export function selectDue(
  cards: Card[],
  daily: DailyReviewCounts,
  settings: SrSettings,
  now = Date.now(),
): Card[] {
  const due = cards
    .filter((c) => !c.deleted && c.dueDate <= now)
    .sort((a, b) => a.dueDate - b.dueDate);
  const newRemaining = Math.max(0, settings.newCardsPerDay - daily.newToday);
  const reviewRemaining = Math.max(0, settings.maxReviewsPerDay - daily.reviewsToday);
  const newCards = due.filter((c) => c.interval === 0).slice(0, newRemaining);
  const reviewCards = due.filter((c) => c.interval > 0).slice(0, reviewRemaining);
  return [...reviewCards, ...newCards];
}

// Fresh scheduling state for a brand-new card (due immediately).
export function newCardState(now = Date.now(), settings = DEFAULT_SETTINGS) {
  return {
    interval: 0,
    easeFactor: settings.startingEase,
    repetitions: 0,
    dueDate: now,
  };
}

/**
 * SM-2 adapted to three grades. Pure: returns the next scheduling state
 * without mutating the input card.
 */
export function schedule(
  card: Card,
  grade: Grade,
  now = Date.now(),
  settings: SrSettings = DEFAULT_SETTINGS,
): Card {
  let { interval, easeFactor, repetitions } = card;

  if (grade === 'again') {
    // Lapse: re-show after a few minutes. Interval is kept as a fraction of a
    // day so it stays > 0 (a "review", not "new") while expressing sub-day time.
    repetitions = 0;
    easeFactor = Math.max(MIN_EASE, easeFactor - 0.2);
    const mins = Math.max(1, settings.againInterval);
    return {
      ...card,
      interval: mins / MINS_PER_DAY,
      easeFactor,
      repetitions,
      dueDate: now + mins * MIN_MS,
      updatedAt: now,
    };
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

  return {
    ...card,
    interval,
    easeFactor,
    repetitions,
    dueDate: now + interval * DAY_MS,
    updatedAt: now,
  };
}

/** Interval (in days) each button would produce — for the review UI labels. */
export function previewIntervals(
  card: Card,
  settings: SrSettings = DEFAULT_SETTINGS,
): Record<Grade, number> {
  const at = card.updatedAt; // stable reference time for the preview
  return {
    again: schedule(card, 'again', at, settings).interval,
    good: schedule(card, 'good', at, settings).interval,
    easy: schedule(card, 'easy', at, settings).interval,
  };
}
