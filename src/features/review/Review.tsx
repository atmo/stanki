import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { lemmatize } from '@shared/lemma';
import { wordMatcher, NO_MATCH, type Matcher } from '@shared/wordmatch';
import { type Card, type CardContext, type Grade, cardContexts } from '@shared/types';
import { previewIntervals, directionSchedule, DEFAULT_SETTINGS, type ReviewItem, type SrSettings } from '@shared/sm2';
import { reviewQueue, gradeCard, undoGrade, getDeckSettings, getDeck, updateCard, deleteCard } from '../../db/repo';
import { LookupResults } from '../lookup/LookupResults';
import { useLookup } from '../lookup/useLookup';
import { ContextsField } from '../../components/ContextsField';

interface UndoSnapshot {
  prior: Card; // card state before the grade
  reviewId: string; // logged review to delete
  queue: ReviewItem[]; // session queue before the grade
  done: number; // done count before the grade
}

type CardPatch = Pick<Card, 'front' | 'back' | 'explanation' | 'contexts'>;

/** Inline editor for the card under review. Keyed by card id so it resets per card. */
function CardEdit({ card, onSave, onCancel }: { card: Card; onSave: (patch: CardPatch) => void; onCancel: () => void }) {
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  const [contexts, setContexts] = useState<CardContext[]>(cardContexts(card));
  const [explanation, setExplanation] = useState(card.explanation ?? '');
  const { term: lookupTerm, lookups, lookup } = useLookup();

  async function save() {
    const patch: CardPatch = {
      front: front.trim(),
      back: back.trim(),
      explanation: explanation.trim() || undefined,
      contexts: contexts.map((c) => ({ ...c, text: c.text.trim() })).filter((c) => c.text),
    };
    await updateCard(card.id, patch);
    onSave(patch);
  }

  return (
    <div className="card-form">
      <div className="row">
        <input className="input" placeholder="Front" value={front} onChange={(e) => setFront(e.target.value)} />
        <button className="btn" type="button" onClick={() => lookup(front.trim())} disabled={!front.trim()}>
          Look up
        </button>
      </div>
      <textarea className="input" placeholder="Back" rows={2} value={back} onChange={(e) => setBack(e.target.value)} />
      <textarea className="input" placeholder="Explanation" rows={2} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
      <label className="field-label">Context</label>
      <ContextsField contexts={contexts} onChange={setContexts} />
      <div className="row">
        <button className="btn btn-primary" onClick={() => void save()}>Save</button>
        <button className="btn" onClick={onCancel}>Cancel</button>
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

/** Render `context` with the card's word highlighted — lemma-aware (inflections),
 * and separable-verb-aware. */
function Context({ ctx, match }: { ctx: CardContext; match: Matcher }) {
  return (
    <p className="context">
      {mapWord(ctx.text, match, (w, k) => (
        <mark key={k}>{w}</mark>
      ))}
      {ctx.url && (
        <>
          {' '}
          <a className="ctx-src" href={ctx.url} target="_blank" rel="noreferrer" title={ctx.url}>↗</a>
        </>
      )}
    </p>
  );
}

/** Spoiler hiding the target word so an example doesn't give it away. Uncovered
 * automatically once the answer is revealed, or by clicking to peek beforehand. */
function Spoiler({ children, reveal }: { children: ReactNode; reveal: boolean }) {
  const [clicked, setClicked] = useState(false);
  const shown = reveal || clicked;
  return (
    <span
      className={'spoiler' + (shown ? ' shown' : '')}
      onClick={() => setClicked(true)}
      role="button"
      tabIndex={0}
      title={shown ? undefined : 'Reveal'}
    >
      {children}
    </span>
  );
}

/** Split text and wrap each word the sentence's matcher accepts (lemma-aware, so
 * inflections and separable-verb parts are caught, not just the exact word). */
function mapWord(
  text: string,
  matcher: Matcher,
  wrap: (word: string, key: number) => ReactNode,
): ReactNode {
  const match = matcher(text);
  return text
    .split(/([\p{L}][\p{L}'’-]*)/u)
    .map((part, i) => (i % 2 === 1 && match(part) ? wrap(part, i) : part));
}

/** Wrap occurrences of the card's word in a spoiler. */
function maskText(text: string, match: Matcher, reveal: boolean): ReactNode {
  return mapWord(text, match, (w, k) => (
    <Spoiler key={k} reveal={reveal}>{w}</Spoiler>
  ));
}

/** Render an answer, styling example lines (marked „…” inside the back)
 * italic/muted like the extension bubble. The card's word is spoiler-blocked in
 * every line (uncovered once `reveal` is true) so that when the back is the
 * reverse-review prompt, a word sitting in a plain definition or an un-quoted
 * example isn't a clue. In forward review `match` is NO_MATCH, so nothing masks. */
function Answer({ text, match, reveal }: { text: string; match: Matcher; reveal: boolean }) {
  return (
    <>
      {text.split('\n').map((line, i) => (
        <div key={i} className={line.trim().startsWith('„') ? 'card-ex' : undefined}>
          {maskText(line, match, reveal)}
        </div>
      ))}
    </>
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
  const [more, setMore] = useState<ReviewItem[] | null>(null); // extra over-limit reviews
  const [clue, setClue] = useState(false); // show a context (word spoilered) before the answer

  useEffect(() => {
    void (async () => {
      const s = await getDeckSettings(id);
      setSettings(s);
      setDeckName((await getDeck(id))?.name ?? '');
      setQueue(await reviewQueue(id, s));
    })();
  }, [id]);

  // When the session empties, look for due reviews beyond the daily cap to offer.
  useEffect(() => {
    if (queue && queue.length === 0) {
      void reviewQueue(id, settings, Date.now(), true).then(setMore);
    }
  }, [queue, id, settings]);

  function studyMore() {
    if (more && more.length) {
      setQueue(more);
      setMore(null);
      setRevealed(false);
      setEditing(false);
    }
  }

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

  // Predicate matching the card's word (and, for separable verbs, its parts) to
  // spoiler-block / highlight inside sentences. Matches nothing for phrase cards.
  const matchWord = useMemo(() => (card ? wordMatcher(card.front) : NO_MATCH), [card]);
  // Hide the clue again whenever we move to a new card / direction.
  useEffect(() => setClue(false), [card?.id, direction]);

  // Answer timing, in refs so ticking the clock never re-renders the card.
  const shownAt = useRef(Date.now());
  const revealedAt = useRef<number | null>(null);
  // Position within this sitting: counts every grade from opening the deck,
  // including undone ones and any over-limit continuation, so it measures how
  // far into the sitting you were rather than how much progress you made.
  const pos = useRef(0);
  useEffect(() => {
    pos.current = 0;
  }, [id]);
  useEffect(() => {
    shownAt.current = Date.now();
    revealedAt.current = null;
  }, [card?.id, direction]);

  function reveal() {
    revealedAt.current = Date.now();
    setRevealed(true);
  }

  async function grade(g: Grade) {
    if (!item || !card || !queue) return;
    const ctx = {
      thinkMs: revealedAt.current ? revealedAt.current - shownAt.current : undefined,
      durationMs: Date.now() - shownAt.current,
      posInSession: (pos.current += 1),
    };
    const { card: updated, reviewId } = await gradeCard(card, direction, g, ctx);
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
    // Restart the clock explicitly: with a single-card queue, "Again" re-queues
    // the same card, so the card-change effect above wouldn't fire.
    shownAt.current = Date.now();
    revealedAt.current = null;
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

  async function deleteCurrent() {
    if (!card) return;
    if (!confirm(`Delete card “${card.front}”? This cannot be undone.`)) return;
    const cardId = card.id;
    await deleteCard(cardId);
    setUndoSnap(null); // the grade-undo no longer applies to a deleted card
    setEditing(false);
    setRevealed(false);
    // Drop every queue item for this card (both directions can be queued).
    setQueue((q) => (q ? q.filter((it) => it.card.id !== cardId) : q));
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
        {more && more.length > 0 && (
          <p className="muted">
            {more.length} more review{more.length === 1 ? '' : 's'} due beyond today’s limit.
          </p>
        )}
        <div className="row">
          <Link className="btn btn-primary" to="/">Back to decks</Link>
          {more && more.length > 0 && (
            <button className="btn" onClick={studyMore}>Study {more.length} more</button>
          )}
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
          <button className="btn btn-link danger" onClick={() => void deleteCurrent()}>Delete</button>
        </span>
      </div>

      <div className="card-face">
        {/* Reverse review: the prompt is the back, whose examples must not reveal
            the word — spoiler it. Forward: prompt is just the word, nothing to mask. */}
        <div className="card-front">
          <Answer text={prompt} match={direction === 'reverse' ? matchWord : NO_MATCH} reveal={revealed} />
        </div>

        {!revealed && clue && (
          <div className="clue">
            {/* Contexts with the word covered — a usage hint that doesn't give the
                answer away (tap the block to peek at the word itself). */}
            {cardContexts(card).map((c, i) => (
              <p key={i} className="context">{maskText(c.text, matchWord, false)}</p>
            ))}
          </div>
        )}

        {revealed && (
          <>
            <hr className="divider" />
            <div className="card-back">
              {answer ? <Answer text={answer} match={NO_MATCH} reveal /> : <span className="muted">(no answer yet)</span>}
            </div>
            {card.explanation && <p className="explanation">{card.explanation}</p>}
            {cardContexts(card).map((c, i) => (
              <Context key={i} ctx={c} match={matchWord} />
            ))}
          </>
        )}
      </div>

      {!revealed ? (
        <>
          {cardContexts(card).length > 0 && (
            <button className="btn btn-block btn-clue" onClick={() => setClue((v) => !v)}>
              {clue ? 'Hide clue' : '💡 Show clue'}
            </button>
          )}
          <button className="btn btn-primary btn-block" onClick={reveal}>
            Show answer
          </button>
        </>
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
