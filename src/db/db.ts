import Dexie, { type EntityTable } from 'dexie';
import type { Card, CardSource, Deck, ReviewLog } from '@shared/types';
import { cardContexts } from '@shared/types';

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
    // v3: the `examples` array is retired and the single `context` becomes an
    // array. Page captures (previously in `examples`) and any `context` fold into
    // `contexts`. Dictionary examples are unaffected — they live inline in `back`.
    this.version(3)
      .stores(stores)
      .upgrade((tx) =>
        tx
          .table('cards')
          .toCollection()
          .modify((c: Card) => {
            const contexts = [...new Set([...(c.examples ?? []), ...(c.context ? [c.context] : [])])];
            if (contexts.length) c.contexts = contexts as unknown as Card['contexts'];
            delete c.examples;
            delete c.context;
          }),
      );
    // v4: contexts and the separate `sources[]` fold into a single array of
    // {text, url?} objects — each captured sentence carries its own URL, and a
    // url-only capture (no sentence) becomes a context whose text is the source
    // title (e.g. an imported eindterm reference).
    this.version(4)
      .stores(stores)
      .upgrade((tx) =>
        tx
          .table('cards')
          .toCollection()
          .modify((c: Card) => {
            const contexts = cardContexts(c);
            if (contexts.length) c.contexts = contexts;
            else delete c.contexts;
            delete c.sources;
            delete c.source;
            delete c.context;
            delete c.examples;
          }),
      );
  }
}

export const db = new StankiDB();
