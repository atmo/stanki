import { describe, it, expect } from 'vitest';
import { schedule, newCardState, previewIntervals, DEFAULT_SETTINGS } from './sm2';
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

describe('previewIntervals', () => {
  it('returns an interval for every grade', () => {
    const c = run(['good', 'good']); // interval 6, reps 2
    const p = previewIntervals(c);
    expect(p.again).toBe(1);
    expect(p.good).toBe(15); // round(6 * 2.5)
    expect(p.easy).toBeGreaterThanOrEqual(p.good);
  });
});
