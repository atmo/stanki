import { describe, it, expect } from 'vitest';
import { leechCounts, leechResets, leechCount, leechLevels, worstLeech, isLeech, LEECH_WINDOW_DAYS } from './leech';
import type { Card, Grade, ReviewLog } from './types';

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

function log(cardId: string, grade: Grade, prevInterval: number, extra: Partial<ReviewLog> = {}): ReviewLog {
  return { id: Math.random().toString(), cardId, ts: NOW, grade, prevInterval, newInterval: 1, ...extra };
}

const card = (id: string, extra: Partial<Card> = {}): Card =>
  ({ id, deckId: 'd', front: id, back: id, interval: 1, easeFactor: 2.5, repetitions: 1, dueDate: NOW, createdAt: 0, updatedAt: 0, ...extra }) as Card;

describe('leechResets', () => {
  it('reads a stamp from either side, and skips cards with none', () => {
    const r = leechResets([
      card('a', { leechResetAt: NOW }),
      card('b', { reverse: { interval: 1, easeFactor: 2.5, repetitions: 1, dueDate: 0, leechResetAt: NOW - DAY } }),
      card('c'),
    ]);
    expect([...r.keys()].sort()).toEqual(['a\nforward', 'b\nreverse']);
    expect(r.get('b\nreverse')).toBe(NOW - DAY);
  });
});

describe('leechCounts — "fixed" stamps', () => {
  it('forgives lapses up to the stamp and counts the ones after it', () => {
    const reviews = [
      log('a', 'again', 5, { ts: NOW - 10 * DAY }),
      log('a', 'again', 5, { ts: NOW - 5 * DAY }),
      log('a', 'again', 5, { ts: NOW - DAY }),
    ];
    const resets = leechResets([card('a', { leechResetAt: NOW - 5 * DAY })]);
    expect(leechCount(leechCounts(reviews, NOW, resets), 'a', 'forward')).toBe(1);
  });

  it('clears the side it was stamped on and leaves the other alone', () => {
    const reviews = [
      log('a', 'again', 5, { direction: 'forward' }),
      log('a', 'again', 5, { direction: 'reverse' }),
    ];
    const resets = leechResets([card('a', { leechResetAt: NOW })]);
    const c = leechCounts(reviews, NOW, resets);
    expect(leechCount(c, 'a', 'forward')).toBe(0);
    expect(leechCount(c, 'a', 'reverse')).toBe(1);
  });

  it('is a no-op without a stamp', () => {
    const reviews = [log('a', 'again', 5)];
    expect(leechCount(leechCounts(reviews, NOW, new Map()), 'a', 'forward')).toBe(1);
  });
});

describe('leechCounts', () => {
  it('counts Again on a day-scale card', () => {
    const c = leechCounts([log('a', 'again', 5), log('a', 'again', 30)], NOW);
    expect(leechCount(c, 'a', 'forward')).toBe(2);
  });

  it('ignores passes — including Hard, which is a pass', () => {
    const c = leechCounts([log('a', 'good', 5), log('a', 'hard', 5), log('a', 'easy', 5)], NOW);
    expect(leechCount(c, 'a', 'forward')).toBe(0);
  });

  it('counts a miss that ended the day for that card, whatever its interval', () => {
    // Deferred cards keep a sub-day interval, so without the flag a card missed
    // and postponed every day would never register a lapse.
    const c = leechCounts([log('a', 'again', 5 / 1440, { deferred: true })], NOW);
    expect(leechCount(c, 'a', 'forward')).toBe(1);
  });

  it('ignores an undone lapse', () => {
    // Tombstoned rather than removed, so it is still in the table.
    const c = leechCounts([{ ...log('a', 'again', 5), deleted: true }], NOW);
    expect(leechCount(c, 'a', 'forward')).toBe(0);
  });

  it('ignores failures while learning or relearning', () => {
    // A new card, and a sub-day relearning step: failing those is just learning.
    const c = leechCounts([log('a', 'again', 0), log('a', 'again', 5 / 1440)], NOW);
    expect(leechCount(c, 'a', 'forward')).toBe(0);
  });

  it('separates the two directions', () => {
    const c = leechCounts(
      [
        log('a', 'again', 5, { direction: 'reverse' }),
        log('a', 'again', 5, { direction: 'reverse' }),
        log('a', 'again', 5, { direction: 'forward' }),
      ],
      NOW,
    );
    expect(leechCount(c, 'a', 'reverse')).toBe(2);
    expect(leechCount(c, 'a', 'forward')).toBe(1);
    expect(worstLeech(c, 'a')).toBe(2);
  });

  it('treats a log with no direction as forward (older entries)', () => {
    expect(leechCount(leechCounts([log('a', 'again', 5)], NOW), 'a', 'forward')).toBe(1);
  });

  it('ages lapses out of the window, so a settled card un-flags itself', () => {
    const old = log('a', 'again', 5, { ts: NOW - (LEECH_WINDOW_DAYS + 1) * DAY });
    const recent = log('a', 'again', 5, { ts: NOW - DAY });
    const c = leechCounts([old, recent], NOW);
    expect(leechCount(c, 'a', 'forward')).toBe(1);
  });
});

describe('isLeech', () => {
  it('flags at or above the threshold', () => {
    expect(isLeech(4, 5)).toBe(false);
    expect(isLeech(5, 5)).toBe(true);
  });

  it('a threshold of 0 disables flagging entirely', () => {
    expect(isLeech(99, 0)).toBe(false);
  });
});

describe('leechLevels', () => {
  const side = () => ({ threshold: 3 });
  const lapses = (cardId: string, days: number[]) =>
    days.map((d) => log(cardId, 'again', 5, { ts: NOW - d * DAY }));

  it('counts a side only from the review that reaches the threshold', () => {
    const reviews = lapses('a', [30, 20, 10]);
    const ats = [NOW - 25 * DAY, NOW - 15 * DAY, NOW];
    expect(leechLevels(reviews, side, ats)).toEqual([0, 0, 1]);
  });

  it('drops a side again once its lapses age out of the window', () => {
    const reviews = lapses('a', [100, 99, 98]);
    expect(leechLevels(reviews, side, [NOW - 95 * DAY, NOW])).toEqual([1, 0]);
  });

  it('counts the two sides of one card separately', () => {
    const reviews = [
      ...lapses('a', [5, 4, 3]).map((r) => ({ ...r, direction: 'forward' as const })),
      ...lapses('a', [5, 4, 3]).map((r) => ({ ...r, direction: 'reverse' as const })),
    ];
    expect(leechLevels(reviews, side, [NOW])).toEqual([2]);
  });

  it('skips sides the caller does not recognise', () => {
    const reviews = lapses('gone', [5, 4, 3]);
    expect(leechLevels(reviews, () => undefined, [NOW])).toEqual([0]);
  });

  it('applies a "fixed" stamp from the day it was made, not backwards', () => {
    // Flagged a month ago, marked fixed a week ago: the past must keep its flag.
    const reviews = lapses('a', [40, 35, 30]);
    const info = () => ({ threshold: 3, resetAt: NOW - 7 * DAY });
    expect(leechLevels(reviews, info, [NOW - 20 * DAY, NOW])).toEqual([1, 0]);
  });

  it('re-flags a side that keeps failing after it was marked fixed', () => {
    const reviews = [...lapses('a', [40, 35, 30]), ...lapses('a', [5, 4, 3])];
    const info = () => ({ threshold: 3, resetAt: NOW - 7 * DAY });
    expect(leechLevels(reviews, info, [NOW - 6 * DAY, NOW])).toEqual([0, 1]);
  });

  it('respects a threshold of 0 as "flag off"', () => {
    expect(leechLevels(lapses('a', [5, 4, 3]), () => ({ threshold: 0 }), [NOW])).toEqual([0]);
  });
});
