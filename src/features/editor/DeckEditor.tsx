import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
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
  moveCards,
  getDeckSettings,
  getLeechCounts,
} from '../../db/repo';
import { type Card, type CardContext, type Deck, cardContexts } from '@shared/types';
import { worstLeech, isLeech, LEECH_WINDOW_DAYS } from '@shared/leech';
import { ContextsField } from '../../components/ContextsField';
import { SynonymsField } from '../../components/SynonymsField';
import { AutoTextarea } from '../../components/AutoTextarea';

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
      {cardContexts(card).filter((c) => c.url).map((c, i) => (
        <div key={i}>
          Source:{' '}
          <a href={c.url} target="_blank" rel="noreferrer">{c.url}</a>
          {c.addedAt ? ` · added ${fmtDate(c.addedAt)}` : ''}
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
  leech,
}: {
  card: Card;
  selected: boolean;
  onToggle: (id: string) => void;
  leech: number;
}) {
  const [editing, setEditing] = useState(false);
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  const [contexts, setContexts] = useState<CardContext[]>(cardContexts(card));
  const [explanation, setExplanation] = useState(card.explanation ?? '');
  const { term: lookupTerm, lookups, lookup } = useLookup();

  async function save() {
    await updateCard(card.id, {
      front,
      back,
      explanation: explanation || undefined,
      contexts: contexts.map((c) => ({ ...c, text: c.text.trim() })).filter((c) => c.text),
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
        <AutoTextarea className="input" value={back} onChange={(e) => setBack(e.target.value)} placeholder="Back" />
        <AutoTextarea className="input" value={explanation} onChange={(e) => setExplanation(e.target.value)} placeholder="Explanation" />
        <label className="field-label">Context</label>
        <ContextsField contexts={contexts} onChange={setContexts} />
        <label className="field-label">Synonyms</label>
        {/* Links save immediately rather than on Save: they are writes to two
            cards' relationship, not part of this card's draft. */}
        <SynonymsField card={card} />
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
        {leech > 0 && (
          <span className="tag-leech" title={`Missed ${leech}x in the last ${LEECH_WINDOW_DAYS} days — worth an example or a clearer definition`}>
            ⚠ {leech}
          </span>
        )}
        <span className="muted"> — {card.back || '(no answer)'}</span>
        {card.explanation && <p className="explanation small">{card.explanation}</p>}
        {cardContexts(card).map((c, i) => (
          <p key={i} className="context small">
            {c.text}
            {c.url && <> <a className="ctx-src" href={c.url} target="_blank" rel="noreferrer" title={c.url}>↗</a></>}
          </p>
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
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [contexts, setContexts] = useState<CardContext[]>([]);
  const [explanation, setExplanation] = useState('');
  const [bulk, setBulk] = useState('');
  const [showBulk, setShowBulk] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Seeded from ?q= so a link elsewhere can open the deck already filtered to
  // one card — the links index uses it to reach the cards citing a url.
  const [params] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [lookupTerm, setLookupTerm] = useState('');
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const data = useLiveQuery(async () => {
    const deck = await db.decks.get(id);
    const cards = await db.cards.where('deckId').equals(id).filter((c) => !c.deleted).toArray();
    cards.sort((a, b) => b.createdAt - a.createdAt);
    const allDecks = (await db.decks.filter((d) => !d.deleted).toArray()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    const [leeches, settings] = await Promise.all([getLeechCounts(), getDeckSettings(id)]);
    return { deck, cards, allDecks, leeches, settings };
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
      contexts: contexts.map((c) => ({ ...c, text: c.text.trim() })).filter((c) => c.text),
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


  if (!data) return <p className="muted">Loading…</p>;
  if (!data.deck) return <p className="muted">Deck not found. <Link to="/">Back</Link></p>;

  const otherDecks: Deck[] = data.allDecks.filter((d) => d.id !== id);
  const q = search.trim().toLowerCase();
  const visibleCards = q
    ? data.cards.filter((c) =>
        [c.front, c.back, c.explanation, ...cardContexts(c).map((x) => x.text)].some((f) => f?.toLowerCase().includes(q)),
      )
    : data.cards;
  const allSelected = visibleCards.length > 0 && visibleCards.every((c) => selected.has(c.id));

  return (
    <div>
      <div className="row editor-head">
        {/* The name is shown, not edited: renaming belongs with the rest of the
            deck's configuration, and this is the page's heading. */}
        <h1 className="deck-title">{data.deck.name}</h1>
        <Link className="btn" to={`/deck/${id}/settings`}>Settings</Link>
        <Link className="btn" to="/">Done</Link>
      </div>

      <form className="card-form" onSubmit={add}>
        <div className="row">
          <input className="input" placeholder="Front (word / question)" value={front} onChange={(e) => setFront(e.target.value)} />
          <button className="btn" type="button" onClick={() => setLookupTerm(front.trim())} disabled={!front.trim()}>
            Look up
          </button>
        </div>
        <AutoTextarea className="input" placeholder="Back (answer / translation)" value={back} onChange={(e) => setBack(e.target.value)} />
        <AutoTextarea className="input" placeholder="Explanation (optional)" value={explanation} onChange={(e) => setExplanation(e.target.value)} />
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
          <AutoTextarea className="input" value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={'hello\thola\nworld\tmundo'} />
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
          <CardRow
            key={c.id}
            card={c}
            selected={selected.has(c.id)}
            onToggle={toggle}
            leech={isLeech(worstLeech(data.leeches, c.id), data.settings.leechThreshold) ? worstLeech(data.leeches, c.id) : 0}
          />
        ))}
      </ul>
      {q && visibleCards.length === 0 && <p className="muted empty">No cards match “{search.trim()}”.</p>}
    </div>
  );
}
