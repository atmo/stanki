import { describe, it, expect } from 'vitest';
import { leechCounts, leechCount, worstLeech, isLeech, LEECH_WINDOW_DAYS } from './leech';
import type { Grade, ReviewLog } from './types';

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

function log(cardId: string, grade: Grade, prevInterval: number, extra: Partial<ReviewLog> = {}): ReviewLog {
  return { id: Math.random().toString(), cardId, ts: NOW, grade, prevInterval, newInterval: 1, ...extra };
}

describe('leechCounts', () => {
  it('counts Again on a day-scale card', () => {
    const c = leechCounts([log('a', 'again', 5), log('a', 'again', 30)], NOW);
    expect(leechCount(c, 'a', 'forward')).toBe(2);
  });

  it('ignores passes — including Hard, which is a pass', () => {
    const c = leechCounts([log('a', 'good', 5), log('a', 'hard', 5), log('a', 'easy', 5)], NOW);
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
