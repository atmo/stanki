import { describe, it, expect } from 'vitest';
import { schedule, newCardState, previewIntervals, selectDue, DEFAULT_SETTINGS } from './sm2';
import type { Card, Grade } from './types';

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

function makeCard(): Card {
  return {
    id: 'c1',
    deckId: 'd1',
    front: 'q',
    back: 'a',
    createdAt: NOW,
    updatedAt: NOW,
    ...newCardState(NOW),
  };
}

function run(seq: Grade[]): Card {
  let card = makeCard();
  for (const g of seq) card = schedule(card, g, NOW);
  return card;
}

describe('schedule', () => {
  it('first Good -> 1 day', () => {
    const c = run(['good']);
    expect(c.repetitions).toBe(1);
    expect(c.interval).toBe(1);
    expect(c.dueDate).toBe(NOW + 1 * DAY);
  });

  it('second Good -> 6 days', () => {
    expect(run(['good', 'good']).interval).toBe(6);
  });

  it('third Good -> interval * ease (15 days)', () => {
    const c = run(['good', 'good', 'good']);
    expect(c.easeFactor).toBeCloseTo(2.5, 5); // q=4 leaves ease unchanged
    expect(c.interval).toBe(15);
  });

  it('Again resets reps, drops ease, short interval', () => {
    const c = run(['good', 'good', 'again']);
    expect(c.repetitions).toBe(0);
    expect(c.interval).toBe(DEFAULT_SETTINGS.againInterval);
    expect(c.easeFactor).toBeCloseTo(2.3, 5);
  });

  it('Easy raises ease and applies the easy bonus', () => {
    const c = run(['easy']);
    expect(c.easeFactor).toBeCloseTo(2.6, 5);
    expect(c.repetitions).toBe(1);
  });

  it('ease never drops below 1.3', () => {
    const c = run(['again', 'again', 'again', 'again', 'again', 'again', 'again']);
    expect(c.easeFactor).toBeGreaterThanOrEqual(1.3);
  });

  it('does not mutate the input card', () => {
    const card = makeCard();
    const snapshot = { ...card };
    schedule(card, 'good', NOW);
    expect(card).toEqual(snapshot);
  });
});

describe('selectDue (daily limits)', () => {
  const c = (id: string, interval: number, dueDate: number): Card => ({
    id, deckId: 'd', front: '', back: '', interval, easeFactor: 2.5,
    repetitions: 0, dueDate, createdAt: 0, updatedAt: 0,
  });
  const settings = { ...DEFAULT_SETTINGS, newCardsPerDay: 2, maxReviewsPerDay: 3 };
  const at = 1000;

  it('caps new and review cards separately, and excludes not-yet-due', () => {
    const cards = [
      c('n1', 0, 0), c('n2', 0, 0), c('n3', 0, 0), // 3 new, due
      c('r1', 5, 0), c('r2', 5, 0), c('r3', 5, 0), c('r4', 5, 0), // 4 review, due
      c('future', 0, 5000), // not due
    ];
    const q = selectDue(cards, { newToday: 0, reviewsToday: 0 }, settings, at);
    expect(q.filter((x) => x.interval === 0)).toHaveLength(2); // newCardsPerDay
    expect(q.filter((x) => x.interval > 0)).toHaveLength(3); // maxReviewsPerDay
    expect(q.some((x) => x.id === 'future')).toBe(false);
  });

  it('subtracts cards already done today', () => {
    const cards = [c('n1', 0, 0), c('n2', 0, 0), c('r1', 5, 0), c('r2', 5, 0)];
    const q = selectDue(cards, { newToday: 1, reviewsToday: 2 }, settings, at);
    expect(q.filter((x) => x.interval === 0)).toHaveLength(1); // 2 - 1
    expect(q.filter((x) => x.interval > 0)).toHaveLength(1); // 3 - 2
  });

  it('orders reviews before new cards', () => {
    const q = selectDue([c('n', 0, 0), c('r', 5, 0)], { newToday: 0, reviewsToday: 0 }, settings, at);
    expect(q[0].interval).toBeGreaterThan(0);
    expect(q[1].interval).toBe(0);
  });
});

describe('previewIntervals', () => {
  it('returns an interval for every grade', () => {
    const c = run(['good', 'good']); // interval 6, reps 2
    const p = previewIntervals(c);
    expect(p.again).toBe(1);
    expect(p.good).toBe(15); // round(6 * 2.5)
    expect(p.easy).toBeGreaterThanOrEqual(p.good);
  });
});
