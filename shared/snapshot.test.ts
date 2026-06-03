import { describe, it, expect } from 'vitest';
import { mergeCards, mergeDeck, gcTombstones } from './snapshot';
import type { Card, Deck } from './types';

function card(id: string, updatedAt: number, extra: Partial<Card> = {}): Card {
  return {
    id,
    deckId: 'd1',
    front: `front-${id}`,
    back: `back-${id}`,
    interval: 1,
    easeFactor: 2.5,
    repetitions: 0,
    dueDate: 0,
    createdAt: 0,
    updatedAt,
    ...extra,
  };
}

describe('mergeCards (last-write-wins + tombstones)', () => {
  it('keeps the newer version of a card', () => {
    const local = [card('a', 100, { back: 'old' })];
    const remote = [card('a', 200, { back: 'new' })];
    const merged = mergeCards(local, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0].back).toBe('new');
  });

  it('unions cards that exist on only one side', () => {
    const merged = mergeCards([card('a', 1)], [card('b', 1)]);
    expect(merged.map((c) => c.id).sort()).toEqual(['a', 'b']);
  });

  it('a delete on one device propagates (tombstone wins by recency)', () => {
    const local = [card('a', 100)];
    const remote = [card('a', 200, { deleted: true })];
    expect(mergeCards(local, remote)[0].deleted).toBe(true);
  });

  it('a tombstone wins ties so deletes converge', () => {
    const local = [card('a', 100, { deleted: true })];
    const remote = [card('a', 100, { back: 'resurrected' })];
    expect(mergeCards(local, remote)[0].deleted).toBe(true);
  });

  it('is order-independent (converges regardless of side)', () => {
    const l = [card('a', 100), card('b', 300, { deleted: true })];
    const r = [card('a', 200), card('b', 100)];
    const ab = mergeCards(l, r);
    const ba = mergeCards(r, l);
    expect(new Map(ab.map((c) => [c.id, c.updatedAt]))).toEqual(
      new Map(ba.map((c) => [c.id, c.updatedAt])),
    );
  });
});

describe('mergeDeck', () => {
  const base = (updatedAt: number, name: string): Deck => ({
    id: 'd1',
    name,
    createdAt: 0,
    updatedAt,
  });
  it('takes the newer deck metadata', () => {
    expect(mergeDeck(base(1, 'old'), base(2, 'new')).name).toBe('new');
  });
  it('handles a missing side', () => {
    expect(mergeDeck(base(1, 'only'), undefined).name).toBe('only');
    expect(mergeDeck(undefined, base(1, 'only')).name).toBe('only');
  });
});

describe('gcTombstones', () => {
  const now = 1_000 * 86_400_000;
  it('drops tombstones older than the TTL', () => {
    const old = card('a', now - 61 * 86_400_000, { deleted: true });
    expect(gcTombstones([old], now)).toHaveLength(0);
  });
  it('keeps recent tombstones and all live cards', () => {
    const recent = card('a', now - 1 * 86_400_000, { deleted: true });
    const live = card('b', now - 999 * 86_400_000);
    expect(gcTombstones([recent, live], now).map((c) => c.id).sort()).toEqual(['a', 'b']);
  });
});
