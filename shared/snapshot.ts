import type { Card, Deck, DeckSnapshot } from './types';
import { SCHEMA_VERSION } from './types';

const TOMBSTONE_TTL_MS = 60 * 86_400_000; // GC deleted records after ~60 days

export function buildSnapshot(deck: Deck, cards: Card[], deviceId: string): DeckSnapshot {
  return {
    schemaVersion: SCHEMA_VERSION,
    deck,
    cards,
    exportedAt: Date.now(),
    deviceId,
  };
}

/** Newer of two records by updatedAt; tombstone wins ties so deletes converge. */
function pickNewer<T extends { updatedAt: number; deleted?: boolean }>(a: T, b: T): T {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  if (a.deleted && !b.deleted) return a;
  if (b.deleted && !a.deleted) return b;
  return a;
}

export function mergeDeck(local: Deck | undefined, remote: Deck | undefined): Deck {
  if (local && remote) return pickNewer(local, remote);
  // Non-null assertion is safe: callers always pass at least one side.
  return (local ?? remote)!;
}

/**
 * Last-write-wins card merge keyed on `updatedAt`, with tombstone support so
 * deletions propagate instead of being resurrected.
 */
export function mergeCards(local: Card[] = [], remote: Card[] = []): Card[] {
  const byId = new Map<string, Card>();
  for (const c of local) byId.set(c.id, c);
  for (const c of remote) {
    const existing = byId.get(c.id);
    byId.set(c.id, existing ? pickNewer(existing, c) : c);
  }
  return [...byId.values()];
}

/** Drop tombstones that are older than the TTL to keep snapshots small. */
export function gcTombstones(cards: Card[], now = Date.now()): Card[] {
  return cards.filter((c) => !(c.deleted && now - c.updatedAt > TOMBSTONE_TTL_MS));
}

export interface MergeResult {
  deck: Deck;
  cards: Card[];
}

/** Merge a local deck+cards against a remote snapshot (either side may be absent). */
export function mergeSnapshot(
  localDeck: Deck | undefined,
  localCards: Card[],
  remote: DeckSnapshot | undefined,
): MergeResult {
  const deck = mergeDeck(localDeck, remote?.deck);
  const cards = gcTombstones(mergeCards(localCards, remote?.cards));
  return { deck, cards };
}
