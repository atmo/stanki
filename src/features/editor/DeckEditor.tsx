import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import {
  createCard,
  updateCard,
  deleteCard,
  deleteCards,
  moveCards,
  renameDeck,
} from '../../db/repo';
import type { Card, Deck } from '@shared/types';

function CardRow({
  card,
  selected,
  onToggle,
}: {
  card: Card;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
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
      <input
        type="checkbox"
        className="card-check"
        checked={selected}
        onChange={() => onToggle(card.id)}
        aria-label="Select card"
      />
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
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const data = useLiveQuery(async () => {
    const deck = await db.decks.get(id);
    const cards = await db.cards.where('deckId').equals(id).filter((c) => !c.deleted).toArray();
    cards.sort((a, b) => b.createdAt - a.createdAt);
    const allDecks = (await db.decks.filter((d) => !d.deleted).toArray()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    return { deck, cards, allDecks };
  }, [id]);

  function toggle(cardId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  }

  function toggleAll(cards: Card[]) {
    setSelected((prev) =>
      prev.size === cards.length ? new Set() : new Set(cards.map((c) => c.id)),
    );
  }

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

  async function moveSelected(toDeckId: string) {
    if (!toDeckId) return;
    await moveCards([...selected], toDeckId);
    setSelected(new Set());
  }

  async function deleteSelected() {
    if (!confirm(`Delete ${selected.size} selected card(s)?`)) return;
    await deleteCards([...selected]);
    setSelected(new Set());
  }

  if (!data) return <p className="muted">Loading…</p>;
  if (!data.deck) return <p className="muted">Deck not found. <Link to="/">Back</Link></p>;

  const otherDecks: Deck[] = data.allDecks.filter((d) => d.id !== id);
  const allSelected = data.cards.length > 0 && selected.size === data.cards.length;

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

      <div className="cards-head">
        {data.cards.length > 0 && (
          <label className="select-all">
            <input type="checkbox" className="card-check" checked={allSelected} onChange={() => toggleAll(data.cards)} />
            Select all
          </label>
        )}
        <span className="muted">{data.cards.length} cards</span>
      </div>

      {selected.size > 0 && (
        <div className="sel-bar">
          <span><strong>{selected.size}</strong> selected</span>
          <select
            className="input sel-move"
            value=""
            onChange={(e) => void moveSelected(e.target.value)}
            disabled={otherDecks.length === 0}
          >
            <option value="" disabled>
              {otherDecks.length ? 'Move to…' : 'No other decks'}
            </option>
            {otherDecks.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <button className="btn btn-danger" onClick={() => void deleteSelected()}>Delete</button>
          <button className="btn" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      <ul className="card-list">
        {data.cards.map((c) => (
          <CardRow key={c.id} card={c} selected={selected.has(c.id)} onToggle={toggle} />
        ))}
      </ul>
    </div>
  );
}
