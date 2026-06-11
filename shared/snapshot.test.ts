import { describe, it, expect } from 'vitest';
import { mergeCards, mergeDeck, gcTombstones, mergeReviews, gcReviews, REVIEW_SYNC_TTL_MS } from './snapshot';
import type { Card, Deck, ReviewLog } from './types';

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

  it('never reverts a reviewed card to "new", even if the new copy is newer', () => {
    const reviewed = card('a', 100, { interval: 6, repetitions: 2 });
    const fresh = card('a', 200, { interval: 0, repetitions: 0 }); // newer but unreviewed
    expect(mergeCards([reviewed], [fresh])[0].interval).toBe(6);
    expect(mergeCards([fresh], [reviewed])[0].interval).toBe(6); // order-independent
  });

  it('a delete still wins over a reviewed card', () => {
    const reviewed = card('a', 100, { interval: 6 });
    const del = card('a', 200, { deleted: true });
    expect(mergeCards([reviewed], [del])[0].deleted).toBe(true);
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

describe('mergeReviews / gcReviews', () => {
  const log = (id: string, ts: number): ReviewLog => ({
    id, cardId: 'c1', ts, grade: 'good', prevInterval: 0, newInterval: 1,
  });

  it('unions review logs by id without duplicating', () => {
    const local = [log('a', 1), log('b', 2)];
    const remote = [log('b', 2), log('c', 3)];
    const merged = mergeReviews(local, remote);
    expect(merged.map((r) => r.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('keeps the local copy of an id (logs are immutable)', () => {
    const merged = mergeReviews([log('a', 100)], [log('a', 999)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].ts).toBe(100);
  });

  it('gcReviews drops entries older than the sync window', () => {
    const now = 1_000 * 86_400_000;
    const fresh = log('fresh', now - 1000);
    const old = log('old', now - REVIEW_SYNC_TTL_MS - 1000);
    expect(gcReviews([fresh, old], now).map((r) => r.id)).toEqual(['fresh']);
  });
});
