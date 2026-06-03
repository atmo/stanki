import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Card, Grade } from '@shared/types';
import { previewIntervals, DEFAULT_SETTINGS, type SrSettings } from '@shared/sm2';
import { dueCards, gradeCard, getSettings, getDeck } from '../../db/repo';

function fmt(days: number): string {
  if (days < 1) return '<1d';
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
  const [settings, setSettings] = useState<SrSettings>(DEFAULT_SETTINGS);
  const [deckName, setDeckName] = useState('');

  useEffect(() => {
    void (async () => {
      setSettings(await getSettings());
      setDeckName((await getDeck(id))?.name ?? '');
      setQueue(await dueCards(id));
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
    setPos((p) => p + 1);
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

  return (
    <div className="review">
      <div className="review-progress">
        {pos + 1} / {queue.length} · {deckName}
      </div>

      <div className="card-face">
        <div className="card-front">{card.front}</div>

        {revealed && (
          <>
            <hr className="divider" />
            <div className="card-back">{card.back || <span className="muted">(no answer yet)</span>}</div>
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
