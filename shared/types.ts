// Core domain types shared between the PWA and the browser extension.

export type Grade = 'again' | 'good' | 'easy';

export interface Deck {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean; // soft-delete tombstone for sync convergence
}

export interface CardSource {
  url: string;
  title: string;
  addedAt: number;
}

export interface Card {
  id: string;
  deckId: string;
  front: string;
  back: string;
  context?: string; // sentence/paragraph captured from a webpage
  source?: CardSource; // provenance when added via the extension

  // SM-2 scheduling state
  interval: number; // days until next review
  easeFactor: number; // starts at 2.5
  repetitions: number; // consecutive correct count
  dueDate: number; // epoch ms

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
