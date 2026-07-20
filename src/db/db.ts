import Dexie, { type EntityTable } from 'dexie';
import type { Card, CardSource, Deck, ReviewLog } from '@shared/types';

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
    const stores = {
      // Index the fields we query/sort on. `&id` = unique primary key.
      decks: '&id, updatedAt, deleted',
      cards: '&id, deckId, dueDate, updatedAt, deleted, [deckId+dueDate]',
      reviews: '&id, cardId, ts',
      meta: '&key',
    };
    this.version(1).stores(stores);
    // v2: provenance became an array. Dictionary examples deliberately stay
    // inline in `back`; the `examples` array holds sentences the extension
    // captures from real pages.
    this.version(2)
      .stores(stores)
      .upgrade((tx) =>
        tx
          .table('cards')
          .toCollection()
          .modify((c: Card) => {
            if (c.source && !c.sources) c.sources = [c.source as CardSource];
            delete c.source;
          }),
      );
  }
}

export const db = new StankiDB();
