import type { Card, Grade } from './types';

const DAY_MS = 86_400_000;
const MIN_EASE = 1.3;

export interface SrSettings {
  startingEase: number; // default 2.5
  easyBonus: number; // multiplier applied to interval on "easy"
  againInterval: number; // days to wait after "again"
}

export const DEFAULT_SETTINGS: SrSettings = {
  startingEase: 2.5,
  easyBonus: 1.3,
  againInterval: 1,
};

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
    repetitions = 0;
    interval = settings.againInterval;
    easeFactor = Math.max(MIN_EASE, easeFactor - 0.2);
  } else {
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
  }

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
