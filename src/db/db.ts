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
    // v2: sources became an array and example sentences moved out of `back` into
    // their own `examples` array. Normalize existing cards in place.
    this.version(2)
      .stores(stores)
      .upgrade((tx) =>
        tx
          .table('cards')
          .toCollection()
          .modify((c: Card) => {
            if (c.source && !c.sources) c.sources = [c.source as CardSource];
            delete c.source;
            if (typeof c.back === 'string' && c.back.includes('„')) {
              const exs: string[] = [];
              const kept: string[] = [];
              for (const line of c.back.split('\n')) {
                const t = line.trim();
                if (/^„.*”$/.test(t)) exs.push(t.slice(1, -1));
                else kept.push(line);
              }
              if (exs.length) {
                c.examples = [...(c.examples ?? []), ...exs];
                c.back = kept.join('\n').trim();
              }
            }
          }),
      );
  }
}

export const db = new StankiDB();
