// Core domain types shared between the PWA and the browser extension.

export type Grade = 'again' | 'good' | 'easy';

// Which way a card is shown during review.
//  forward = prompt with front, guess back; reverse = prompt with back, guess front.
export type CardDirection = 'forward' | 'reverse';
export type ReviewDirection = CardDirection | 'both';

export interface Deck {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  reviewDirection?: ReviewDirection; // default 'forward'
  deleted?: boolean; // soft-delete tombstone for sync convergence
}

export interface CardSource {
  url: string;
  title: string;
  addedAt: number;
}

// SM-2 scheduling state for one review direction.
export interface CardSchedule {
  interval: number; // days until next review (fraction of a day for sub-day lapses)
  easeFactor: number; // starts at 2.5
  repetitions: number; // consecutive correct count
  dueDate: number; // epoch ms
}

export interface Card extends CardSchedule {
  id: string;
  deckId: string;
  front: string;
  back: string; // definitions, with any dictionary examples inline
  explanation?: string; // dictionary explanation (e.g. ANW), filled via lookup
  contexts?: string[]; // sentences captured from pages, one per capture (accumulate)
  sources?: CardSource[]; // provenance URL, one per capture (accumulate)
  // Legacy shapes, read via cardContexts()/cardSources() and migrated away locally.
  context?: string;
  examples?: string[];
  source?: CardSource;
  // Monotonic authority for the arrays above: on merge, a higher `rev` *replaces*
  // contexts/sources (rather than unioning), so an authoritative import/restore
  // can drop entries. Equal `rev` still unions, so normal accumulation works.
  rev?: number;

  // Inline CardSchedule fields above are the *forward* schedule (prompt = front).
  reverse?: CardSchedule; // independent schedule for the reverse direction (prompt = back)

  createdAt: number;
  updatedAt: number; // last edit OR last review (drives LWW merge)
  deleted?: boolean; // tombstone
}

/** Provenance list, tolerating both the new `sources[]` and the old single `source`. */
export function cardSources(card: Pick<Card, 'sources' | 'source'>): CardSource[] {
  return card.sources ?? (card.source ? [card.source] : []);
}

/**
 * Captured context sentences, tolerating legacy shapes: the old single `context`
 * and the retired `examples[]` (which held page captures) both fold in here.
 */
export function cardContexts(card: Pick<Card, 'contexts' | 'context' | 'examples'>): string[] {
  if (card.contexts) return card.contexts;
  const legacy = [...(card.examples ?? []), ...(card.context ? [card.context] : [])];
  return [...new Set(legacy)];
}

export interface ReviewLog {
  id: string;
  cardId: string;
  ts: number;
  grade: Grade;
  prevInterval: number;
  newInterval: number;
  direction?: CardDirection; // omitted on old logs == forward
}

export const SCHEMA_VERSION = 1 as const;

// One snapshot file per deck, stored in Google Drive's appDataFolder.
export interface DeckSnapshot {
  schemaVersion: typeof SCHEMA_VERSION;
  deck: Deck;
  cards: Card[]; // includes tombstones
  exportedAt: number;
  deviceId: string;
}

// A single shared file holding recent review-log entries across all decks, so
// the per-day new/review limits are tracked across devices. Kept separate from
// the per-deck snapshots (which the extension rewrites) so it is never clobbered.
export interface ReviewSnapshot {
  schemaVersion: typeof SCHEMA_VERSION;
  reviews: ReviewLog[]; // recent only — trimmed to a rolling window on upload
  exportedAt: number;
  deviceId: string;
}

// The special deck the extension appends captured words to.
export const INBOX_DECK_ID = 'inbox';
export const INBOX_DECK_NAME = 'Inbox';
