// Leeches: cards you keep failing. Derived from the review log rather than
// stored on the card, because this is a display flag, not a scheduling decision
// — nothing depends on every device agreeing, so a device that has not synced
// the log simply shows fewer flags instead of scheduling differently.
import type { Card, CardDirection, ReviewLog } from './types';

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
 *
 * A miss that ended the card's day counts too, whatever interval it was at.
 * Those keep a sub-day interval, so without this a card missed and postponed
 * every single day would never register a lapse at all — leaving exactly the
 * cards most worth editing as the ones the flag cannot see.
 *
 * `resets` carries each side's "I have fixed this" stamp (see `leechResets`):
 * lapses up to it are forgiven, so the count starts again from the moment of the
 * fix and the flag comes back only on fresh evidence.
 */
export function leechCounts(
  reviews: ReviewLog[],
  now = Date.now(),
  resets?: Map<string, number>,
): Map<string, number> {
  const since = now - LEECH_WINDOW_DAYS * DAY;
  const out = new Map<string, number>();
  for (const r of reviews) {
    if (r.deleted || r.ts < since || r.grade !== 'again') continue;
    if (r.prevInterval < 1 && !r.deferred) continue;
    const k = leechKey(r.cardId, r.direction ?? 'forward');
    if (r.ts <= (resets?.get(k) ?? 0)) continue;
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

/** Per-side "fixed at" stamps, in the shape `leechCounts` wants. */
export function leechResets(
  cards: Pick<Card, 'id' | 'leechResetAt' | 'reverse'>[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of cards) {
    if (c.leechResetAt) out.set(leechKey(c.id, 'forward'), c.leechResetAt);
    if (c.reverse?.leechResetAt) out.set(leechKey(c.id, 'reverse'), c.reverse.leechResetAt);
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

/** What a side was worth at the moment being sampled. Undefined means "not a
 * side to count" — the card is gone, or its deck no longer reviews that way. */
export type SideInfo = { threshold: number; resetAt?: number } | undefined;

/**
 * How many sides were flagged at each of the given instants.
 *
 * Replayed from the log rather than sampled daily like the held-over level,
 * because a leech *is* a function of the log: the whole history is available
 * from the first review, with nothing to backfill.
 *
 * A "fixed" stamp only applies from the moment it was made. Evaluating last
 * September with a stamp made in November has to count September's lapses, or
 * marking one card fixed today would quietly rewrite months of the chart — and
 * the drop belongs on the day you acted.
 */
export function leechLevels(
  reviews: ReviewLog[],
  sideInfo: (cardId: string, direction: CardDirection) => SideInfo,
  ats: number[],
): number[] {
  const events: { key: string; ts: number; threshold: number; resetAt: number }[] = [];
  for (const r of reviews) {
    if (r.deleted || r.grade !== 'again') continue;
    if (r.prevInterval < 1 && !r.deferred) continue;
    const direction = r.direction ?? 'forward';
    const info = sideInfo(r.cardId, direction);
    if (!info) continue;
    events.push({ key: leechKey(r.cardId, direction), ts: r.ts, threshold: info.threshold, resetAt: info.resetAt ?? 0 });
  }

  return ats.map((at) => {
    const since = at - LEECH_WINDOW_DAYS * DAY;
    const counts = new Map<string, number>();
    const thresholds = new Map<string, number>();
    for (const e of events) {
      if (e.ts > at || e.ts < since) continue;
      if (e.resetAt <= at && e.ts <= e.resetAt) continue;
      counts.set(e.key, (counts.get(e.key) ?? 0) + 1);
      thresholds.set(e.key, e.threshold);
    }
    let n = 0;
    for (const [k, c] of counts) if (isLeech(c, thresholds.get(k) ?? 0)) n++;
    return n;
  });
}
