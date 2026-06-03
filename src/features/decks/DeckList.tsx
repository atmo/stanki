import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { createDeck, deleteDeck } from '../../db/repo';

export function DeckList() {
  const [name, setName] = useState('');

  const data = useLiveQuery(async () => {
    const [decks, cards] = await Promise.all([
      db.decks.filter((d) => !d.deleted).toArray(),
      db.cards.filter((c) => !c.deleted).toArray(),
    ]);
    const now = Date.now();
    const byDeck = new Map<string, { total: number; due: number }>();
    for (const c of cards) {
      const e = byDeck.get(c.deckId) ?? { total: 0, due: 0 };
      e.total += 1;
      if (c.dueDate <= now) e.due += 1;
      byDeck.set(c.deckId, e);
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
          const stats = data.byDeck.get(deck.id) ?? { total: 0, due: 0 };
          return (
            <li key={deck.id} className="deck-item">
              <div className="deck-main">
                <span className="deck-name">{deck.name}</span>
                <span className="deck-meta">
                  {stats.total} cards
                  {stats.due > 0 && <span className="badge badge-due">{stats.due} due</span>}
                </span>
              </div>
              <div className="deck-actions">
                <Link className="btn" to={`/deck/${deck.id}`}>Edit</Link>
                <Link
                  className={`btn ${stats.due > 0 ? 'btn-primary' : 'btn-disabled'}`}
                  to={stats.due > 0 ? `/review/${deck.id}` : '#'}
                  aria-disabled={stats.due === 0}
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
