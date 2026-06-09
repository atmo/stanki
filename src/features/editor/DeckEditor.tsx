import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { lookupWord, anwExplanation, type Lookups } from '@shared/lookup';
import { LookupResults } from '../lookup/LookupResults';
import {
  createCard,
  updateCard,
  deleteCard,
  deleteCards,
  moveCards,
  renameDeck,
  setReviewDirection,
} from '../../db/repo';
import type { Card, Deck, ReviewDirection } from '@shared/types';

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
  const [explanation, setExplanation] = useState(card.explanation ?? '');

  async function save() {
    await updateCard(card.id, {
      front,
      back,
      context: context || undefined,
      explanation: explanation || undefined,
    });
    setEditing(false);
  }

  if (editing) {
    return (
      <li className="card-row editing">
        <input className="input" value={front} onChange={(e) => setFront(e.target.value)} placeholder="Front" />
        <input className="input" value={back} onChange={(e) => setBack(e.target.value)} placeholder="Back" />
        <textarea className="input" value={explanation} onChange={(e) => setExplanation(e.target.value)} placeholder="Explanation" rows={2} />
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
        {card.explanation && <p className="explanation small">{card.explanation}</p>}
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
  const [explanation, setExplanation] = useState('');
  const [bulk, setBulk] = useState('');
  const [showBulk, setShowBulk] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [lookupTerm, setLookupTerm] = useState('');
  const [lookups, setLookups] = useState<Lookups | null>(null);

  const data = useLiveQuery(async () => {
    const deck = await db.decks.get(id);
    const cards = await db.cards.where('deckId').equals(id).filter((c) => !c.deleted).toArray();
    cards.sort((a, b) => b.createdAt - a.createdAt);
    const allDecks = (await db.decks.filter((d) => !d.deleted).toArray()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    return { deck, cards, allDecks };
  }, [id]);

  // Run the dictionary lookup and pre-fill empty Back/Explanation fields.
  useEffect(() => {
    if (!lookupTerm) {
      setLookups(null);
      return;
    }
    let cancelled = false;
    setLookups(null);
    void lookupWord(lookupTerm).then((l) => {
      if (cancelled) return;
      setLookups(l);
      setBack((p) => p || (l.free?.senses[0]?.definition ?? ''));
      setExplanation((p) => p || anwExplanation(l.anw));
    });
    return () => {
      cancelled = true;
    };
  }, [lookupTerm]);

  function toggle(cardId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  }

  function toggleAll(cards: Card[]) {
    setSelected((prev) => {
      const allOn = cards.length > 0 && cards.every((c) => prev.has(c.id));
      const next = new Set(prev);
      for (const c of cards) {
        if (allOn) next.delete(c.id);
        else next.add(c.id);
      }
      return next;
    });
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!front.trim()) return;
    await createCard({
      deckId: id,
      front: front.trim(),
      back: back.trim(),
      explanation: explanation.trim() || undefined,
      context: context.trim() || undefined,
    });
    setFront('');
    setBack('');
    setExplanation('');
    setContext('');
    setLookupTerm('');
    setLookups(null);
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
  const q = search.trim().toLowerCase();
  const visibleCards = q
    ? data.cards.filter((c) =>
        [c.front, c.back, c.explanation, c.context].some((f) => f?.toLowerCase().includes(q)),
      )
    : data.cards;
  const allSelected = visibleCards.length > 0 && visibleCards.every((c) => selected.has(c.id));

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

      <label className="field">
        <span>Review direction</span>
        <select
          className="input"
          value={data.deck.reviewDirection ?? 'forward'}
          onChange={(e) => void setReviewDirection(id, e.target.value as ReviewDirection)}
        >
          <option value="forward">Front → back</option>
          <option value="reverse">Back → front</option>
          <option value="both">Both ways</option>
        </select>
      </label>

      <form className="card-form" onSubmit={add}>
        <div className="row">
          <input className="input" placeholder="Front (word / question)" value={front} onChange={(e) => setFront(e.target.value)} />
          <button className="btn" type="button" onClick={() => setLookupTerm(front.trim())} disabled={!front.trim()}>
            Look up
          </button>
        </div>
        <input className="input" placeholder="Back (answer / translation)" value={back} onChange={(e) => setBack(e.target.value)} />
        <textarea className="input" placeholder="Explanation (optional)" rows={2} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
        <textarea className="input" placeholder="Context (optional)" rows={2} value={context} onChange={(e) => setContext(e.target.value)} />
        <div className="row">
          <button className="btn btn-primary" type="submit">Add card</button>
          <button className="btn" type="button" onClick={() => setShowBulk((s) => !s)}>
            {showBulk ? 'Hide bulk import' : 'Bulk import'}
          </button>
        </div>
      </form>

      {lookupTerm && (
        <LookupResults
          lookups={lookups}
          term={lookups?.anw?.lemma || lookups?.free?.lemma || lookupTerm}
          front={front}
          onUseLemma={(lemma) => {
            setFront(lemma);
            setLookupTerm(lemma);
          }}
        />
      )}

      {showBulk && (
        <div className="card-form">
          <p className="muted small">One card per line, <code>front⇥back</code> (tab-separated).</p>
          <textarea className="input" rows={5} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={'hello\thola\nworld\tmundo'} />
          <button className="btn btn-primary" onClick={() => void importBulk()}>Import</button>
        </div>
      )}

      {data.cards.length > 0 && (
        <input
          className="input"
          type="search"
          placeholder="Search cards…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}

      <div className="cards-head">
        {visibleCards.length > 0 && (
          <label className="select-all">
            <input type="checkbox" className="card-check" checked={allSelected} onChange={() => toggleAll(visibleCards)} />
            Select all
          </label>
        )}
        <span className="muted">
          {q ? `${visibleCards.length} of ${data.cards.length}` : data.cards.length} cards
        </span>
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
        {visibleCards.map((c) => (
          <CardRow key={c.id} card={c} selected={selected.has(c.id)} onToggle={toggle} />
        ))}
      </ul>
      {q && visibleCards.length === 0 && <p className="muted empty">No cards match “{search.trim()}”.</p>}
    </div>
  );
}
