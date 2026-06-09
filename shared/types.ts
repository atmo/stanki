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
  back: string;
  context?: string; // sentence/paragraph captured from a webpage
  explanation?: string; // dictionary explanation (e.g. ANW), filled via lookup
  source?: CardSource; // provenance when added via the extension

  // Inline CardSchedule fields above are the *forward* schedule (prompt = front).
  reverse?: CardSchedule; // independent schedule for the reverse direction (prompt = back)

  createdAt: number;
  updatedAt: number; // last edit OR last review (drives LWW merge)
  deleted?: boolean; // tombstone
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

// The special deck the extension appends captured words to.
export const INBOX_DECK_ID = 'inbox';
export const INBOX_DECK_NAME = 'Inbox';
