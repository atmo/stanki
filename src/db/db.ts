import Dexie, { type EntityTable } from 'dexie';
import type { Card, Deck, ReviewLog } from '@shared/types';

// Key-value bag for app metadata (deviceId, settings, lastSync, ...).
export interface Meta {
  key: string;
  value: unknown;
}

export class StankiDB extends Dexie {
  decks!: EntityTable<Deck, 'id'>;
  cards!: EntityTable<Card, 'id'>;
  reviews!: EntityTable<ReviewLog, 'id'>;
  meta!: EntityTable<Meta, 'key'>;

  constructor() {
    super('stanki');
    this.version(1).stores({
      // Index the fields we query/sort on. `&id` = unique primary key.
      decks: '&id, updatedAt, deleted',
      cards: '&id, deckId, dueDate, updatedAt, deleted, [deckId+dueDate]',
      reviews: '&id, cardId, ts',
      meta: '&key',
    });
  }
}

export const db = new StankiDB();
