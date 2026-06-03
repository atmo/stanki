import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { createCard, updateCard, deleteCard, renameDeck } from '../../db/repo';
import type { Card } from '@shared/types';

function CardRow({ card }: { card: Card }) {
  const [editing, setEditing] = useState(false);
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  const [context, setContext] = useState(card.context ?? '');

  async function save() {
    await updateCard(card.id, { front, back, context: context || undefined });
    setEditing(false);
  }

  if (editing) {
    return (
      <li className="card-row editing">
        <input className="input" value={front} onChange={(e) => setFront(e.target.value)} placeholder="Front" />
        <input className="input" value={back} onChange={(e) => setBack(e.target.value)} placeholder="Back" />
        <textarea className="input" value={context} onChange={(e) => setContext(e.target.value)} placeholder="Context" rows={2} />
        <div className="row">
          <button className="btn btn-primary" onClick={() => void save()}>Save</button>
          <button className="btn" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </li>
    );
  }

  return (
    <li className="card-row">
      <div className="card-row-main">
        <strong>{card.front}</strong>
        <span className="muted"> — {card.back || '(no answer)'}</span>
        {card.context && <p className="context small">{card.context}</p>}
      </div>
      <div className="row">
        <button className="btn" onClick={() => setEditing(true)}>Edit</button>
        <button className="btn btn-danger" onClick={() => void deleteCard(card.id)}>✕</button>
      </div>
    </li>
  );
}

export function DeckEditor() {
  const { id = '' } = useParams();
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [context, setContext] = useState('');
  const [bulk, setBulk] = useState('');
  const [showBulk, setShowBulk] = useState(false);

  const data = useLiveQuery(async () => {
    const deck = await db.decks.get(id);
    const cards = await db.cards.where('deckId').equals(id).filter((c) => !c.deleted).toArray();
    cards.sort((a, b) => b.createdAt - a.createdAt);
    return { deck, cards };
  }, [id]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!front.trim()) return;
    await createCard({ deckId: id, front: front.trim(), back: back.trim(), context: context.trim() || undefined });
    setFront('');
    setBack('');
    setContext('');
  }

  async function importBulk() {
    const lines = bulk.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const [f, b = ''] = line.split('\t');
      if (f?.trim()) await createCard({ deckId: id, front: f.trim(), back: b.trim() });
    }
    setBulk('');
    setShowBulk(false);
  }

  if (!data) return <p className="muted">Loading…</p>;
  if (!data.deck) return <p className="muted">Deck not found. <Link to="/">Back</Link></p>;

  return (
    <div>
      <div className="row editor-head">
        <input
          className="input title-input"
          value={data.deck.name}
          onChange={(e) => void renameDeck(id, e.target.value)}
        />
        <Link className="btn" to="/">Done</Link>
      </div>

      <form className="card-form" onSubmit={add}>
        <input className="input" placeholder="Front (word / question)" value={front} onChange={(e) => setFront(e.target.value)} />
        <input className="input" placeholder="Back (answer / translation)" value={back} onChange={(e) => setBack(e.target.value)} />
        <textarea className="input" placeholder="Context (optional)" rows={2} value={context} onChange={(e) => setContext(e.target.value)} />
        <div className="row">
          <button className="btn btn-primary" type="submit">Add card</button>
          <button className="btn" type="button" onClick={() => setShowBulk((s) => !s)}>
            {showBulk ? 'Hide bulk import' : 'Bulk import'}
          </button>
        </div>
      </form>

      {showBulk && (
        <div className="card-form">
          <p className="muted small">One card per line, <code>front⇥back</code> (tab-separated).</p>
          <textarea className="input" rows={5} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={'hello\thola\nworld\tmundo'} />
          <button className="btn btn-primary" onClick={() => void importBulk()}>Import</button>
        </div>
      )}

      <p className="muted">{data.cards.length} cards</p>
      <ul className="card-list">
        {data.cards.map((c) => <CardRow key={c.id} card={c} />)}
      </ul>
    </div>
  );
}
