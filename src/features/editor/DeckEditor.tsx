import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { lookupWord, anwExplanation, joinSenses, type Lookups } from '@shared/lookup';
import { lemmatize } from '@shared/lemma';
import { LookupResults } from '../lookup/LookupResults';
import { useLookup } from '../lookup/useLookup';
import {
  createCard,
  updateCard,
  deleteCard,
  deleteCards,
  deleteDeck,
  exportDeck,
  moveCards,
  renameDeck,
  setReviewDirection,
  setDeckDescription,
  setDeckSettings,
  effectiveSettings,
  getSettings,
} from '../../db/repo';
import { type Card, type Deck, type ReviewDirection, cardSources, cardContexts } from '@shared/types';
import { DEFAULT_SETTINGS, type SrSettings } from '@shared/sm2';
import { ContextsField } from '../../components/ContextsField';
import { SettingsFields } from '../../components/SettingsFields';

const fmtDate = (ts: number | undefined): string => (ts ? new Date(ts).toLocaleDateString() : '—');

/** Read-only provenance + scheduling info shown while editing a card. */
function CardMeta({ card }: { card: Card }) {
  const sched = (
    label: string,
    s: { interval: number; repetitions: number; easeFactor: number; dueDate: number },
  ) =>
    s.interval > 0
      ? `${label}: due ${fmtDate(s.dueDate)} · interval ${s.interval}d · reviews ${s.repetitions} · ease ${s.easeFactor.toFixed(2)}`
      : `${label}: new (not yet reviewed)`;
  return (
    <div className="card-meta muted small">
      {cardSources(card).map((s, i) => (
        <div key={i}>
          Source:{' '}
          <a href={s.url} target="_blank" rel="noreferrer">
            {s.title || s.url}
          </a>
          {s.addedAt ? ` · added ${fmtDate(s.addedAt)}` : ''}
        </div>
      ))}
      <div>{sched('Forward', card)}</div>
      {card.reverse && <div>{sched('Reverse', card.reverse)}</div>}
      <div>Created {fmtDate(card.createdAt)}</div>
    </div>
  );
}

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
  const [contexts, setContexts] = useState<string[]>(cardContexts(card));
  const [explanation, setExplanation] = useState(card.explanation ?? '');
  const { term: lookupTerm, lookups, lookup } = useLookup();

  async function save() {
    await updateCard(card.id, {
      front,
      back,
      explanation: explanation || undefined,
      contexts: contexts.map((c) => c.trim()).filter(Boolean),
    });
    setEditing(false);
  }

  if (editing) {
    return (
      <li className="card-row editing">
        <div className="row">
          <input className="input" value={front} onChange={(e) => setFront(e.target.value)} placeholder="Front" />
          <button className="btn" type="button" onClick={() => lookup(front.trim())} disabled={!front.trim()}>
            Look up
          </button>
        </div>
        <textarea className="input" rows={2} value={back} onChange={(e) => setBack(e.target.value)} placeholder="Back" />
        <textarea className="input" value={explanation} onChange={(e) => setExplanation(e.target.value)} placeholder="Explanation" rows={2} />
        <label className="field-label">Context</label>
        <ContextsField contexts={contexts} onChange={setContexts} />
        <CardMeta card={card} />
        <div className="row">
          <button className="btn btn-primary" onClick={() => void save()}>Save</button>
          <button className="btn" onClick={() => setEditing(false)}>Cancel</button>
        </div>
        {lookupTerm && (
          <LookupResults
            lookups={lookups}
            term={lemmatize(lookupTerm || front)}
            front={front}
            onUseLemma={(lemma, frontForm) => {
              setFront(frontForm);
              lookup(lemma);
            }}
          />
        )}
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
        {cardContexts(card).map((c, i) => (
          <p key={i} className="context small">{c}</p>
        ))}
        {cardSources(card).map((s, i) => (
          <a key={i} className="source-link small" href={s.url} target="_blank" rel="noreferrer">
            {s.title || s.url}
          </a>
        ))}
      </div>
      <div className="row">
        <button className="btn" onClick={() => setEditing(true)}>Edit</button>
        <button
          className="btn btn-danger"
          onClick={() => {
            if (confirm(`Delete card “${card.front}”?`)) void deleteCard(card.id);
          }}
        >
          ✕
        </button>
      </div>
    </li>
  );
}

export function DeckEditor() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [contexts, setContexts] = useState<string[]>([]);
  const [explanation, setExplanation] = useState('');
  const [bulk, setBulk] = useState('');
  const [showBulk, setShowBulk] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [lookupTerm, setLookupTerm] = useState('');
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [globalSettings, setGlobalSettings] = useState<SrSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    void getSettings().then(setGlobalSettings);
  }, []);

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
      // Dictionary examples stay inline in the back; the examples array is for
      // sentences captured from real pages by the extension.
      setBack((p) => p || joinSenses(l.free));
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
      contexts: contexts.map((c) => c.trim()).filter(Boolean),
    });
    setFront('');
    setBack('');
    setExplanation('');
    setContexts([]);
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

  async function removeDeck(name: string, count: number) {
    if (!confirm(`Delete deck “${name}” and its ${count} card(s)? This cannot be undone.`)) return;
    await deleteDeck(id);
    navigate('/');
  }

  async function doExport() {
    const bundle = await exportDeck(id);
    const name = bundle.decks[0]?.name ?? 'deck';
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'deck';
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stanki-deck-${slug}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!data) return <p className="muted">Loading…</p>;
  if (!data.deck) return <p className="muted">Deck not found. <Link to="/">Back</Link></p>;

  const deck = data.deck;
  const otherDecks: Deck[] = data.allDecks.filter((d) => d.id !== id);
  const q = search.trim().toLowerCase();
  const visibleCards = q
    ? data.cards.filter((c) =>
        [c.front, c.back, c.explanation, ...cardContexts(c)].some((f) => f?.toLowerCase().includes(q)),
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
        <button className="btn" onClick={() => void doExport()}>Export</button>
        <button
          className="btn btn-danger"
          onClick={() => void removeDeck(deck.name, data.cards.length)}
        >
          Delete deck
        </button>
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

      <label className="field">
        <span>Description</span>
        <textarea
          className="input"
          rows={2}
          placeholder="Optional notes about this deck"
          defaultValue={data.deck.description ?? ''}
          onBlur={(e) => void setDeckDescription(id, e.target.value)}
        />
      </label>

      <div className="field">
        <label className="checkline">
          <input
            type="checkbox"
            checked={!!deck.settings}
            onChange={(e) => void setDeckSettings(id, e.target.checked ? effectiveSettings(deck, globalSettings) : undefined)}
          />
          <span>Custom scheduling &amp; limits for this deck</span>
        </label>
        {deck.settings ? (
          <div className="deck-settings">
            <SettingsFields value={deck.settings} onChange={(key, v) => void setDeckSettings(id, { ...deck.settings!, [key]: v })} />
          </div>
        ) : (
          <p className="muted small">Using the global settings.</p>
        )}
      </div>

      <form className="card-form" onSubmit={add}>
        <div className="row">
          <input className="input" placeholder="Front (word / question)" value={front} onChange={(e) => setFront(e.target.value)} />
          <button className="btn" type="button" onClick={() => setLookupTerm(front.trim())} disabled={!front.trim()}>
            Look up
          </button>
        </div>
        <textarea className="input" placeholder="Back (answer / translation)" rows={2} value={back} onChange={(e) => setBack(e.target.value)} />
        <textarea className="input" placeholder="Explanation (optional)" rows={2} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
        <ContextsField contexts={contexts} onChange={setContexts} />
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
          term={lemmatize(lookupTerm)}
          front={front}
          onUseLemma={(lemma, frontForm) => {
            setFront(frontForm);
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
