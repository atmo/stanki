import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Card, Grade } from '@shared/types';
import { previewIntervals, directionSchedule, DEFAULT_SETTINGS, type ReviewItem, type SrSettings } from '@shared/sm2';
import { reviewQueue, gradeCard, undoGrade, getSettings, getDeck, updateCard } from '../../db/repo';

interface UndoSnapshot {
  prior: Card; // card state before the grade
  reviewId: string; // logged review to delete
  queue: ReviewItem[]; // session queue before the grade
  done: number; // done count before the grade
}

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
  // The session queue: current card is at the front. "Again" re-queues the card
  // to the back so it returns this session; "Good"/"Easy" graduate and remove it.
  const [queue, setQueue] = useState<ReviewItem[] | null>(null);
  const [done, setDone] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [settings, setSettings] = useState<SrSettings>(DEFAULT_SETTINGS);
  const [deckName, setDeckName] = useState('');
  const [undoSnap, setUndoSnap] = useState<UndoSnapshot | null>(null);

  useEffect(() => {
    void (async () => {
      const s = await getSettings();
      setSettings(s);
      setDeckName((await getDeck(id))?.name ?? '');
      setQueue(await reviewQueue(id, s));
    })();
  }, [id]);

  const item = queue?.[0];
  const card = item?.card;
  const direction = item?.direction ?? 'forward';
  // Forward: prompt with the front, guess the back. Reverse: the other way.
  const prompt = card ? (direction === 'forward' ? card.front : card.back) : '';
  const answer = card ? (direction === 'forward' ? card.back : card.front) : '';

  const previews = useMemo(
    () => (item ? previewIntervals(item.schedule, settings) : null),
    [item, settings],
  );

  async function grade(g: Grade) {
    if (!item || !card || !queue) return;
    const { card: updated, reviewId } = await gradeCard(card, direction, g);
    setUndoSnap({ prior: card, reviewId, queue, done });
    setRevealed(false);
    setEditing(false);
    if (g === 'again') {
      // Keep it in the session until graded something other than Again.
      const refreshed: ReviewItem = {
        ...item,
        card: updated,
        schedule: directionSchedule(updated, direction, settings),
      };
      setQueue((q) => (q ? [...q.slice(1), refreshed] : q));
    } else {
      setDone((n) => n + 1);
      setQueue((q) => (q ? q.slice(1) : q));
    }
  }

  async function undoReview() {
    if (!undoSnap) return;
    await undoGrade(undoSnap.prior, undoSnap.reviewId);
    setQueue(undoSnap.queue);
    setDone(undoSnap.done);
    setUndoSnap(null);
    setEditing(false);
    setRevealed(true); // show the answer so the card can be re-graded immediately
  }

  function applyEdit(patch: CardPatch) {
    if (!card) return;
    const cardId = card.id;
    setQueue((q) =>
      q?.map((it) => (it.card.id === cardId ? { ...it, card: { ...it.card, ...patch } } : it)) ?? q,
    );
    setEditing(false);
  }

  if (!queue) return <p className="muted">Loading…</p>;

  if (!item || !card) {
    return (
      <div className="review-done">
        <h2>🎉 All done</h2>
        <p className="muted">
          {done > 0 ? `${done} card${done === 1 ? '' : 's'} reviewed in ` : 'No more cards due in '}
          “{deckName}”.
        </p>
        <div className="row">
          <Link className="btn btn-primary" to="/">Back to decks</Link>
          {undoSnap && <button className="btn" onClick={() => void undoReview()}>Undo last</button>}
        </div>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="review">
        <div className="review-progress">
          {queue.length} left · {deckName}
        </div>
        <CardEdit key={card.id} card={card} onSave={applyEdit} onCancel={() => setEditing(false)} />
      </div>
    );
  }

  return (
    <div className="review">
      <div className="review-progress">
        <span>
          {queue.length} left · {deckName}
          {direction === 'reverse' && <span className="badge badge-due">reverse</span>}
        </span>
        <span className="review-actions">
          {undoSnap && <button className="btn btn-link" onClick={() => void undoReview()}>Undo</button>}
          <button className="btn btn-link" onClick={() => setEditing(true)}>Edit</button>
        </span>
      </div>

      <div className="card-face">
        <div className="card-front">{prompt}</div>

        {revealed && (
          <>
            <hr className="divider" />
            <div className="card-back">{answer || <span className="muted">(no answer yet)</span>}</div>
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
