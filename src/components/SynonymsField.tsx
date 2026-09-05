import { useEffect, useState } from 'react';
import type { Card } from '@shared/types';
import { getLinkedCards, linkCards, unlinkCards, searchDeckCards } from '../db/repo';

/** Pick synonyms for a card. Search is deck-scoped: a synonym across two
 * languages is not one, and it keeps the list to something scannable. */
export function SynonymsField({ card }: { card: Card }) {
  const [linked, setLinked] = useState<Card[]>([]);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Card[]>([]);

  const refresh = () => void getLinkedCards(card.id).then(setLinked);
  useEffect(refresh, [card.id]);

  useEffect(() => {
    let live = true; // a slower earlier query must not overwrite a newer one
    void searchDeckCards(card.deckId, q, [card.id, ...linked.map((c) => c.id)]).then(
      (r) => live && setHits(r),
    );
    return () => { live = false; };
  }, [q, card.id, card.deckId, linked]);

  async function add(id: string) {
    await linkCards(card.id, id);
    setQ('');
    refresh();
  }

  async function remove(id: string) {
    await unlinkCards(card.id, id);
    refresh();
  }

  return (
    <div className="synonyms">
      {linked.length > 0 && (
        <div className="chips">
          {linked.map((c) => (
            <span key={c.id} className="chip">
              {c.front}
              <button type="button" className="chip-x" onClick={() => void remove(c.id)} aria-label={`Unlink ${c.front}`}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        className="input"
        placeholder="Link a synonym…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {hits.length > 0 && (
        <ul className="lookup-list">
          {hits.map((c) => (
            <li key={c.id}>
              <button type="button" className="lookup-hit" onClick={() => void add(c.id)}>
                <b>{c.front}</b> <span className="muted small">{c.back.split('\n')[0]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
