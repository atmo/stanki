// Leeches: cards you keep failing. Derived from the review log rather than
// stored on the card, because this is a display flag, not a scheduling decision
// — nothing depends on every device agreeing, so a device that has not synced
// the log simply shows fewer flags instead of scheduling differently.
import type { CardDirection, ReviewLog } from './types';

/**
 * Only recent failures count. Most of a long-standing collection's lapses were
 * accrued under whatever the scheduler used to do, and a card that has since
 * settled should stop being branded — with a window that happens on its own,
 * where an all-time count would need a manual "reset leeches" action.
 */
export const LEECH_WINDOW_DAYS = 90;

const DAY = 86_400_000;

export const leechKey = (cardId: string, direction: CardDirection) => `${cardId}\n${direction}`;

/**
 * Lapses per card *and direction*, over the recent window. Keyed per direction
 * because a word you can recognise but not produce is a leech one way only, and
 * a combined count would point you at editing a card that is working fine.
 *
 * A lapse is "Again" on a card that had reached a day-scale interval: failing a
 * learning step is part of learning, and Hard is a pass, not a failure.
 */
export function leechCounts(reviews: ReviewLog[], now = Date.now()): Map<string, number> {
  const since = now - LEECH_WINDOW_DAYS * DAY;
  const out = new Map<string, number>();
  for (const r of reviews) {
    if (r.ts < since || r.prevInterval < 1 || r.grade !== 'again') continue;
    const k = leechKey(r.cardId, r.direction ?? 'forward');
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

/** How many times this side of the card has lapsed recently. */
export const leechCount = (
  counts: Map<string, number>,
  cardId: string,
  direction: CardDirection,
): number => counts.get(leechKey(cardId, direction)) ?? 0;

/** The worst of a card's directions, for a per-card badge. */
export function worstLeech(counts: Map<string, number>, cardId: string): number {
  return Math.max(leechCount(counts, cardId, 'forward'), leechCount(counts, cardId, 'reverse'));
}

/** A threshold of 0 turns the flag off entirely. */
export const isLeech = (count: number, threshold: number) => threshold > 0 && count >= threshold;
