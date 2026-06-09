import { describe, it, expect } from 'vitest';
import { schedule, newCardState, previewIntervals, selectDue, itemsForCard, DEFAULT_SETTINGS, type ReviewItem } from './sm2';
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

  it('Again resets reps, drops ease, schedules minutes out', () => {
    const c = run(['good', 'good', 'again']);
    expect(c.repetitions).toBe(0);
    expect(c.interval).toBeCloseTo(DEFAULT_SETTINGS.againInterval / 1440, 9); // minutes -> days
    expect(c.dueDate).toBe(NOW + DEFAULT_SETTINGS.againInterval * 60_000);
    expect(c.easeFactor).toBeCloseTo(2.3, 5);
  });

  it('Easy raises ease and applies the easy bonus', () => {
    const c = run(['easy']);
    expect(c.easeFactor).toBeCloseTo(2.6, 5);
    expect(c.repetitions).toBe(1);
  });

  it('Again while learning keeps ease (no thrash) and resets reps', () => {
    const c = run(['again', 'again', 'again']);
    expect(c.easeFactor).toBe(DEFAULT_SETTINGS.startingEase);
    expect(c.repetitions).toBe(0);
  });

  it('Good after Again graduates to at least the next day', () => {
    const c = run(['again', 'good']);
    expect(c.interval).toBe(1);
    expect(c.dueDate).toBe(NOW + 1 * DAY);
  });

  it('a mature lapse lowers ease but never below 1.3', () => {
    const c = run(['good', 'good', 'again']); // interval 6 before the lapse
    expect(c.easeFactor).toBeLessThan(DEFAULT_SETTINGS.startingEase);
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
  const item = (id: string, interval: number, dueDate: number): ReviewItem => ({
    card: {
      id, deckId: 'd', front: '', back: '', interval, easeFactor: 2.5,
      repetitions: 0, dueDate, createdAt: 0, updatedAt: 0,
    },
    direction: 'forward',
    schedule: { interval, easeFactor: 2.5, repetitions: 0, dueDate },
  });
  const settings = { ...DEFAULT_SETTINGS, newCardsPerDay: 2, maxReviewsPerDay: 3 };
  const at = 1000;

  it('caps new and review items separately, and excludes not-yet-due', () => {
    const items = [
      item('n1', 0, 0), item('n2', 0, 0), item('n3', 0, 0), // 3 new, due
      item('r1', 5, 0), item('r2', 5, 0), item('r3', 5, 0), item('r4', 5, 0), // 4 review, due
      item('future', 0, 5000), // not due
    ];
    const q = selectDue(items, { newToday: 0, reviewsToday: 0 }, settings, at);
    expect(q.filter((x) => x.schedule.interval === 0)).toHaveLength(2); // newCardsPerDay
    expect(q.filter((x) => x.schedule.interval > 0)).toHaveLength(3); // maxReviewsPerDay
    expect(q.some((x) => x.card.id === 'future')).toBe(false);
  });

  it('subtracts items already done today', () => {
    const items = [item('n1', 0, 0), item('n2', 0, 0), item('r1', 5, 0), item('r2', 5, 0)];
    const q = selectDue(items, { newToday: 1, reviewsToday: 2 }, settings, at);
    expect(q.filter((x) => x.schedule.interval === 0)).toHaveLength(1); // 2 - 1
    expect(q.filter((x) => x.schedule.interval > 0)).toHaveLength(1); // 3 - 2
  });

  it('orders reviews before new items', () => {
    const q = selectDue([item('n', 0, 0), item('r', 5, 0)], { newToday: 0, reviewsToday: 0 }, settings, at);
    expect(q[0].schedule.interval).toBeGreaterThan(0);
    expect(q[1].schedule.interval).toBe(0);
  });
});

describe('itemsForCard (review directions)', () => {
  const card: Card = {
    id: 'c', deckId: 'd', front: 'hond', back: 'dog',
    interval: 3, easeFactor: 2.5, repetitions: 2, dueDate: 100,
    createdAt: 50, updatedAt: 50,
  };

  it('forward yields one item using the inline schedule', () => {
    const items = itemsForCard(card, 'forward');
    expect(items).toHaveLength(1);
    expect(items[0].direction).toBe('forward');
    expect(items[0].schedule.interval).toBe(3);
  });

  it('reverse with no reverse schedule yields a new item due at creation', () => {
    const items = itemsForCard(card, 'reverse');
    expect(items).toHaveLength(1);
    expect(items[0].direction).toBe('reverse');
    expect(items[0].schedule.interval).toBe(0); // new
    expect(items[0].schedule.dueDate).toBe(card.createdAt);
  });

  it('both yields a forward and a reverse item', () => {
    const items = itemsForCard({ ...card, reverse: { interval: 6, easeFactor: 2.5, repetitions: 2, dueDate: 200 } }, 'both');
    expect(items.map((i) => i.direction)).toEqual(['forward', 'reverse']);
    expect(items[1].schedule.interval).toBe(6); // uses the stored reverse schedule
  });

  it('skips deleted cards', () => {
    expect(itemsForCard({ ...card, deleted: true }, 'both')).toHaveLength(0);
  });
});

describe('previewIntervals', () => {
  it('returns an interval for every grade', () => {
    const c = run(['good', 'good']); // interval 6, reps 2
    const p = previewIntervals(c);
    expect(p.again).toBeCloseTo(DEFAULT_SETTINGS.againInterval / 1440, 9); // 1 minute, in days
    expect(p.good).toBe(15); // round(6 * 2.5)
    expect(p.easy).toBeGreaterThanOrEqual(p.good);
  });
});
