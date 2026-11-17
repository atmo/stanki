import { describe, it, expect } from 'vitest';
import { leechRows } from './rows';
import { leechKey } from '@shared/leech';
import { DEFAULT_SETTINGS } from '@shared/sm2';
import type { Card, Deck } from '@shared/types';

const deck = (id: string, extra: Partial<Deck> = {}): Deck =>
  ({ id, name: id, createdAt: 0, updatedAt: 0, ...extra });
const card = (id: string, deckId: string, extra: Partial<Card> = {}): Card =>
  ({ id, deckId, front: id, back: id, interval: 10, easeFactor: 2.5, repetitions: 3, dueDate: 0, createdAt: 0, updatedAt: 0, ...extra });

const counts = (pairs: [string, 'forward' | 'reverse', number][]) =>
  new Map(pairs.map(([id, dir, n]) => [leechKey(id, dir), n]));

const settings = { ...DEFAULT_SETTINGS, leechThreshold: 5 };

describe('leechRows', () => {
  it('keeps only sides at or past the threshold', () => {
    const rows = leechRows(
      [card('a', 'd'), card('b', 'd')],
      [deck('d')],
      counts([['a', 'forward', 5], ['b', 'forward', 4]]),
      settings,
    );
    expect(rows.map((r) => r.card.id)).toEqual(['a']);
  });

  it('ignores a side the deck no longer reviews', () => {
    // Forward-only deck: the reverse side's old lapses are residue, not work.
    const rows = leechRows(
      [card('a', 'd', { reverse: { interval: 10, easeFactor: 2.5, repetitions: 3, dueDate: 0 } })],
      [deck('d', { reviewDirection: 'forward' })],
      counts([['a', 'reverse', 9]]),
      settings,
    );
    expect(rows).toEqual([]);
  });

  it('reports both sides of a two-sided deck separately', () => {
    const rows = leechRows(
      [card('a', 'd', { reverse: { interval: 2, easeFactor: 1.8, repetitions: 1, dueDate: 0 } })],
      [deck('d', { reviewDirection: 'both' })],
      counts([['a', 'forward', 5], ['a', 'reverse', 7]]),
      settings,
    );
    expect(rows.map((r) => [r.direction, r.lapses, r.ease])).toEqual([
      ['reverse', 7, 1.8],
      ['forward', 5, 2.5],
    ]);
  });

  it("uses the deck's own threshold over the global one", () => {
    const tolerant = deck('d', { settings: { ...settings, leechThreshold: 20 } });
    const rows = leechRows([card('a', 'd')], [tolerant], counts([['a', 'forward', 9]]), settings);
    expect(rows).toEqual([]);
  });

  it('a threshold of 0 turns the list off for that deck', () => {
    const off = deck('d', { settings: { ...settings, leechThreshold: 0 } });
    const rows = leechRows([card('a', 'd')], [off], counts([['a', 'forward', 99]]), settings);
    expect(rows).toEqual([]);
  });

  it('sorts worst first, breaking ties on the lower ease', () => {
    const rows = leechRows(
      [card('a', 'd'), card('b', 'd', { easeFactor: 1.4 }), card('c', 'd')],
      [deck('d')],
      counts([['a', 'forward', 6], ['b', 'forward', 6], ['c', 'forward', 9]]),
      settings,
    );
    expect(rows.map((r) => r.card.id)).toEqual(['c', 'b', 'a']);
  });

  it('skips a card whose deck is gone', () => {
    expect(leechRows([card('a', 'missing')], [deck('d')], counts([['a', 'forward', 9]]), settings)).toEqual([]);
  });
});

describe('leechRows — buried sides', () => {
  const NOW = 1_800_000_000_000;
  const buried = (until: number, cycles = 1) =>
    card('a', 'd', { leechResetAt: until, buriedCycles: cycles, dueDate: until, interval: 1 });

  it('keeps a buried side on the list although its count reads zero', () => {
    const rows = leechRows([buried(NOW + 20 * 86_400_000)], [deck('d')], counts([]), settings, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].buriedUntil).toBe(NOW + 20 * 86_400_000);
    expect(rows[0].cycles).toBe(1);
  });

  it('drops it again once it has come back and is behaving', () => {
    const rows = leechRows([buried(NOW - 86_400_000)], [deck('d')], counts([]), settings, NOW);
    expect(rows).toEqual([]);
  });

  it('shows a returned side that is failing again, with its cycle count', () => {
    const rows = leechRows(
      [buried(NOW - 86_400_000, 1)],
      [deck('d')],
      counts([['a', 'forward', 5]]),
      settings,
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].buriedUntil).toBeUndefined();
    expect(rows[0].cycles).toBe(1);
  });

  it('puts cards still in rotation above buried ones, soonest back first', () => {
    const rows = leechRows(
      [
        card('live', 'd'),
        card('far', 'd', { leechResetAt: NOW + 30 * 86_400_000, buriedCycles: 1 }),
        card('soon', 'd', { leechResetAt: NOW + 2 * 86_400_000, buriedCycles: 1 }),
      ],
      [deck('d')],
      counts([['live', 'forward', 6]]),
      settings,
      NOW,
    );
    expect(rows.map((r) => r.card.id)).toEqual(['live', 'soon', 'far']);
  });
});
