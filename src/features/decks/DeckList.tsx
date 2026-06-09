import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { createDeck, deleteDeck, getSettings } from '../../db/repo';
import { selectDue, itemsForCard, startOfDay } from '@shared/sm2';
import type { Card } from '@shared/types';

export function DeckList() {
  const [name, setName] = useState('');

  const data = useLiveQuery(async () => {
    const now = Date.now();
    const [decks, cards, settings, reviews] = await Promise.all([
      db.decks.filter((d) => !d.deleted).toArray(),
      db.cards.filter((c) => !c.deleted).toArray(),
      getSettings(),
      db.reviews.where('ts').aboveOrEqual(startOfDay(now)).toArray(),
    ]);

    // Today's new/review counts per deck (via cardId -> deckId).
    const cardDeck = new Map(cards.map((c) => [c.id, c.deckId]));
    const daily = new Map<string, { newToday: number; reviewsToday: number }>();
    for (const r of reviews) {
      const deckId = cardDeck.get(r.cardId);
      if (!deckId) continue;
      const d = daily.get(deckId) ?? { newToday: 0, reviewsToday: 0 };
      if (r.prevInterval === 0) d.newToday++;
      else d.reviewsToday++;
      daily.set(deckId, d);
    }

    const cardsByDeck = new Map<string, Card[]>();
    for (const c of cards) {
      const arr = cardsByDeck.get(c.deckId) ?? [];
      arr.push(c);
      cardsByDeck.set(c.deckId, arr);
    }

    const byDeck = new Map<string, { total: number; newDue: number; reviewDue: number }>();
    for (const deck of decks) {
      const dc = cardsByDeck.get(deck.id) ?? [];
      const d = daily.get(deck.id) ?? { newToday: 0, reviewsToday: 0 };
      const direction = deck.reviewDirection ?? 'forward';
      const items = dc.flatMap((c) => itemsForCard(c, direction, settings));
      const due = selectDue(items, d, settings, now);
      const newDue = due.filter((i) => i.schedule.interval === 0).length;
      byDeck.set(deck.id, { total: dc.length, newDue, reviewDue: due.length - newDue });
    }

    decks.sort((a, b) => a.name.localeCompare(b.name));
    return { decks, byDeck };
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await createDeck(name);
    setName('');
  }

  if (!data) return <p className="muted">Loading…</p>;

  return (
    <div>
      <form className="row" onSubmit={onCreate}>
        <input
          className="input"
          placeholder="New deck name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn btn-primary" type="submit">Add deck</button>
      </form>

      {data.decks.length === 0 && (
        <p className="muted empty">No decks yet. Create one above, or add words via the browser extension.</p>
      )}

      <ul className="deck-list">
        {data.decks.map((deck) => {
          const stats = data.byDeck.get(deck.id) ?? { total: 0, newDue: 0, reviewDue: 0 };
          const due = stats.newDue + stats.reviewDue;
          return (
            <li key={deck.id} className="deck-item">
              <div className="deck-main">
                <span className="deck-name">{deck.name}</span>
                <span className="deck-meta">
                  {stats.total} cards
                  {stats.newDue > 0 && (
                    <span className="badge badge-new" title="New cards to learn">{stats.newDue} new</span>
                  )}
                  {stats.reviewDue > 0 && (
                    <span className="badge badge-due" title="Cards to revisit">{stats.reviewDue} review</span>
                  )}
                </span>
              </div>
              <div className="deck-actions">
                <Link className="btn" to={`/deck/${deck.id}`}>Edit</Link>
                <Link
                  className={`btn ${due > 0 ? 'btn-primary' : 'btn-disabled'}`}
                  to={due > 0 ? `/review/${deck.id}` : '#'}
                  aria-disabled={due === 0}
                >
                  Review
                </Link>
                <button
                  className="btn btn-danger"
                  onClick={() => {
                    if (confirm(`Delete deck "${deck.name}"?`)) void deleteDeck(deck.id);
                  }}
                >
                  ✕
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
