import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../../db/db';
import { getSettings, markLeechFixed } from '../../db/repo';
import { effectiveSettings } from '@shared/sm2';
import { leechCounts, leechResets, LEECH_WINDOW_DAYS } from '@shared/leech';
import { leechRows } from './rows';
import type { CardDirection } from '@shared/types';

const DAY = 86_400_000;

const DIR_TAG: Record<CardDirection, { tag: string; title: string }> = {
  forward: { tag: '→', title: 'Forward — shown the word, recalling the meaning' },
  reverse: { tag: '←', title: 'Reverse — shown the meaning, recalling the word' },
};

/** Days until due, as a short label. Negative reads as overdue. */
function dueLabel(dueDate: number, now: number): string {
  const days = Math.round((dueDate - now) / DAY);
  if (days <= -1) return `${-days}d late`;
  if (days <= 0) return 'today';
  return `in ${days}d`;
}

/**
 * The leech worklist: every side of every card that has lapsed past its deck's
 * threshold, worst first, across all decks.
 *
 * Deliberately not part of Stats. A leech is defined by a fixed 90-day window,
 * so a date filter there does not narrow the figure, it contradicts it — and the
 * question this answers is not "how many" but "which one do I fix next".
 */
export function Leeches() {
  const data = useLiveQuery(async () => {
    const now = Date.now();
    const [cards, decks, reviews, global] = await Promise.all([
      db.cards.filter((c) => !c.deleted).toArray(),
      db.decks.filter((d) => !d.deleted).toArray(),
      db.reviews.where('ts').aboveOrEqual(now - LEECH_WINDOW_DAYS * DAY).filter((r) => !r.deleted).toArray(),
      getSettings(),
    ]);
    const counts = leechCounts(reviews, now, leechResets(cards));
    return {
      rows: leechRows(cards, decks, counts, global),
      now,
      anyThreshold: decks.some((d) => effectiveSettings(d, global).leechThreshold > 0),
    };
  }, []);

  if (!data) return <p className="muted">Loading…</p>;
  const { rows, now, anyThreshold } = data;

  return (
    <div className="settings">
      <section className="panel">
        <h2>Leeches</h2>
        {!anyThreshold ? (
          <p className="muted">
            The leech flag is off — set a lapse threshold in Settings to start tracking cards you
            keep failing.
          </p>
        ) : rows.length === 0 ? (
          <p className="muted">
            Nothing is being failed repeatedly. A side appears here once it has lapsed as many times
            as its deck's threshold within {LEECH_WINDOW_DAYS} days.
          </p>
        ) : (
          <>
            <p className="muted small">
              <b>{rows.length}</b> side{rows.length === 1 ? '' : 's'} failed past the threshold in the
              last {LEECH_WINDOW_DAYS} days, worst first. More repetitions are the one thing that
              reliably does not help: rewrite the back, add a context, or link the word you keep
              confusing it with. <b>Fixed</b> starts the count again from now, so the flag returns
              only if it is missed again.
            </p>
            <div className="deck-stats">
              <div className="deck-stat deck-stat-head">
                <span>Card</span>
                <span className="ds-cols3"><span>lapses</span><span>ease</span><span>due</span><span /></span>
              </div>
              {rows.map((r) => (
                <div className="deck-stat" key={`${r.card.id}-${r.direction}`}>
                  <span className="ds-deck">
                    <Link
                      className="deck-stat-name"
                      to={`/deck/${r.card.deckId}?q=${encodeURIComponent(r.card.front)}`}
                      title={`${r.card.front} — ${r.card.back}`}
                    >
                      {r.card.front}
                    </Link>
                    <span className="tag-2s" title={DIR_TAG[r.direction].title}>{DIR_TAG[r.direction].tag}</span>
                    <span className="leech-deck">{r.deckName}</span>
                  </span>
                  <span className="ds-cols3">
                    <span className="ds-again">{r.lapses}<span className="muted">/{r.threshold}</span></span>
                    <span>{r.ease.toFixed(2)}</span>
                    <span className="muted">{dueLabel(r.dueDate, now)}</span>
                    <button
                      className="btn btn-link"
                      title="Start this side's lapse count again from now"
                      onClick={() => void markLeechFixed(r.card.id, r.direction)}
                    >
                      Fixed
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
