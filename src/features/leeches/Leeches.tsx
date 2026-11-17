import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../../db/db';
import { getSettings, markLeechFixed } from '../../db/repo';
import { effectiveSettings, itemsForCard } from '@shared/sm2';
import { leechCounts, leechResets, leechLevels, leechKey, LEECH_WINDOW_DAYS, type SideInfo } from '@shared/leech';
import { leechRows } from './rows';
import { BarChart } from '../../components/BarChart';
// The calendar axis lives with the stats aggregation, where its tests are; these
// two are pure date helpers, not stats.
import { bucketize, rangeStartFor, startOfDay } from '../stats/compute';
import type { CardDirection } from '@shared/types';

const DAY = 86_400_000;

// How far back the trend goes. One leech window, so every column is a complete
// reading rather than one taken before the window had filled.
const TREND_DAYS = LEECH_WINDOW_DAYS;

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
    // Twice the window: the oldest column of the trend looks a full window back
    // from itself, so the chart needs reviews from before the chart starts.
    const [cards, decks, reviews, global] = await Promise.all([
      db.cards.filter((c) => !c.deleted).toArray(),
      db.decks.filter((d) => !d.deleted).toArray(),
      db.reviews.where('ts').aboveOrEqual(now - (TREND_DAYS + LEECH_WINDOW_DAYS) * DAY).filter((r) => !r.deleted).toArray(),
      getSettings(),
    ]);
    const counts = leechCounts(reviews, now, leechResets(cards));

    // Each side the decks still review, with the threshold it is judged by and
    // its own "fixed" stamp — everything `leechLevels` needs to replay history.
    const sides = new Map<string, Exclude<SideInfo, undefined>>();
    for (const card of cards) {
      const deck = decks.find((d) => d.id === card.deckId);
      if (!deck) continue;
      const threshold = effectiveSettings(deck, global).leechThreshold;
      for (const { direction, schedule } of itemsForCard(card, deck.reviewDirection ?? 'forward')) {
        sides.set(leechKey(card.id, direction), { threshold, resetAt: schedule.leechResetAt });
      }
    }

    const { buckets } = bucketize(rangeStartFor(startOfDay(now), TREND_DAYS), startOfDay(now));
    // A level is read at an instant: the end of each column, or now for the
    // column we are still inside.
    const levels = leechLevels(
      reviews,
      (cardId, direction) => sides.get(leechKey(cardId, direction)),
      buckets.map((b) => Math.min(b.end + DAY - 1, now)),
    );

    return {
      rows: leechRows(cards, decks, counts, global),
      now,
      buckets,
      levels,
      anyThreshold: decks.some((d) => effectiveSettings(d, global).leechThreshold > 0),
    };
  }, []);

  if (!data) return <p className="muted">Loading…</p>;
  const { rows, now, buckets, levels, anyThreshold } = data;

  const trendMax = Math.max(1, ...levels);
  const trendBars = buckets.map((b, i) => ({
    value: levels[i],
    cls: 'bar-leech',
    title: `${b.full}: ${levels[i]} flagged`,
    label: b.label,
    sub: b.sub,
  }));

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

      {levels.some((n) => n > 0) && (
        <section className="panel">
          <h2>Trend</h2>
          <p className="muted small">
            Sides flagged at the end of each week, over the last {TREND_DAYS} days. Replayed from
            the review log, so the whole history is here — a leech <i>is</i> a property of the log,
            unlike the held-over level, which had to be tallied daily. A fall means lapses aged out
            of the window or you marked something fixed; a rise means new words are not sticking.
          </p>
          <BarChart bars={trendBars} max={trendMax} />
        </section>
      )}
    </div>
  );
}
