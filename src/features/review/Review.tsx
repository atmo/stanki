import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Card, Grade } from '@shared/types';
import { previewIntervals, DEFAULT_SETTINGS, type SrSettings } from '@shared/sm2';
import { reviewQueue, gradeCard, getSettings, getDeck, updateCard } from '../../db/repo';

type CardPatch = Pick<Card, 'front' | 'back' | 'context' | 'explanation'>;

/** Inline editor for the card under review. Keyed by card id so it resets per card. */
function CardEdit({ card, onSave, onCancel }: { card: Card; onSave: (patch: CardPatch) => void; onCancel: () => void }) {
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  const [context, setContext] = useState(card.context ?? '');
  const [explanation, setExplanation] = useState(card.explanation ?? '');

  async function save() {
    const patch: CardPatch = {
      front: front.trim(),
      back: back.trim(),
      context: context.trim() || undefined,
      explanation: explanation.trim() || undefined,
    };
    await updateCard(card.id, patch);
    onSave(patch);
  }

  return (
    <div className="card-form">
      <input className="input" placeholder="Front" value={front} onChange={(e) => setFront(e.target.value)} />
      <input className="input" placeholder="Back" value={back} onChange={(e) => setBack(e.target.value)} />
      <textarea className="input" placeholder="Explanation" rows={2} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
      <textarea className="input" placeholder="Context" rows={2} value={context} onChange={(e) => setContext(e.target.value)} />
      <div className="row">
        <button className="btn btn-primary" onClick={() => void save()}>Save</button>
        <button className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function fmt(days: number): string {
  if (days < 1) {
    const mins = Math.max(1, Math.round(days * 1440));
    return mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h`;
  }
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

/** Render `context` with the captured word highlighted. */
function Context({ text, word }: { text: string; word: string }) {
  const i = word ? text.toLowerCase().indexOf(word.toLowerCase()) : -1;
  if (i < 0) return <p className="context">{text}</p>;
  return (
    <p className="context">
      {text.slice(0, i)}
      <mark>{text.slice(i, i + word.length)}</mark>
      {text.slice(i + word.length)}
    </p>
  );
}

const GRADES: { grade: Grade; label: string; cls: string }[] = [
  { grade: 'again', label: 'Again', cls: 'btn-again' },
  { grade: 'good', label: 'Good', cls: 'btn-good' },
  { grade: 'easy', label: 'Easy', cls: 'btn-easy' },
];

export function Review() {
  const { id = '' } = useParams();
  const [queue, setQueue] = useState<Card[] | null>(null);
  const [pos, setPos] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [settings, setSettings] = useState<SrSettings>(DEFAULT_SETTINGS);
  const [deckName, setDeckName] = useState('');

  useEffect(() => {
    void (async () => {
      const s = await getSettings();
      setSettings(s);
      setDeckName((await getDeck(id))?.name ?? '');
      setQueue(await reviewQueue(id, s));
    })();
  }, [id]);

  const card = queue?.[pos];
  const previews = useMemo(
    () => (card ? previewIntervals(card, settings) : null),
    [card, settings],
  );

  async function grade(g: Grade) {
    if (!card) return;
    await gradeCard(card, g);
    setRevealed(false);
    setEditing(false);
    setPos((p) => p + 1);
  }

  function applyEdit(patch: CardPatch) {
    setQueue((q) => q?.map((c, i) => (i === pos ? { ...c, ...patch } : c)) ?? q);
    setEditing(false);
  }

  if (!queue) return <p className="muted">Loading…</p>;

  if (!card) {
    return (
      <div className="review-done">
        <h2>🎉 All done</h2>
        <p className="muted">No more cards due in “{deckName}”.</p>
        <Link className="btn btn-primary" to="/">Back to decks</Link>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="review">
        <div className="review-progress">
          {pos + 1} / {queue.length} · {deckName}
        </div>
        <CardEdit key={card.id} card={card} onSave={applyEdit} onCancel={() => setEditing(false)} />
      </div>
    );
  }

  return (
    <div className="review">
      <div className="review-progress">
        <span>{pos + 1} / {queue.length} · {deckName}</span>
        <button className="btn btn-link" onClick={() => setEditing(true)}>Edit</button>
      </div>

      <div className="card-face">
        <div className="card-front">{card.front}</div>

        {revealed && (
          <>
            <hr className="divider" />
            <div className="card-back">{card.back || <span className="muted">(no answer yet)</span>}</div>
            {card.explanation && <p className="explanation">{card.explanation}</p>}
            {card.context && <Context text={card.context} word={card.front} />}
            {card.source?.url && (
              <a className="source-link" href={card.source.url} target="_blank" rel="noreferrer">
                {card.source.title || card.source.url}
              </a>
            )}
          </>
        )}
      </div>

      {!revealed ? (
        <button className="btn btn-primary btn-block" onClick={() => setRevealed(true)}>
          Show answer
        </button>
      ) : (
        <div className="grade-row">
          {GRADES.map(({ grade: g, label, cls }) => (
            <button key={g} className={`btn btn-block ${cls}`} onClick={() => void grade(g)}>
              <span>{label}</span>
              <small>{previews ? fmt(previews[g]) : ''}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
