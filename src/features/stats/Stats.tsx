import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { itemsForCard } from '@shared/sm2';
import { db } from '../../db/db';

const DAY = 86_400_000;
const MATURE_DAYS = 21; // Anki convention: interval >= 21d counts as "mature"
const FORECAST_DAYS = 21;
const HISTORY_DAYS = 21;

type Maturity = { nw: number; young: number; mature: number };

function bucketInterval(interval: number, m: Maturity) {
  if (interval === 0) m.nw++;
  else if (interval < MATURE_DAYS) m.young++;
  else m.mature++;
}

const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const pct = (pass: number, total: number) => (total ? `${Math.round((pass / total) * 100)}%` : '—');

const dayLabel = (t: number) => new Date(t).getDate();

/** A stacked vertical-bar chart; forecast and history share it so they read as a pair.
 * Each column's segments are heights relative to `max`; labels show only every 3rd
 * column to stay legible, with the full breakdown on hover. */
function BarChart({
  bars,
  max,
}: {
  bars: { label: string; title: string; segs: { cls: string; value: number }[] }[];
  max: number;
}) {
  return (
    <div className="bar-chart">
      {bars.map((b, i) => (
        <div className="bar-col" key={i} title={b.title}>
          <div className="bar-stack">
            {b.segs.map((s, j) =>
              s.value > 0 ? (
                <div key={j} className={`bar-seg ${s.cls}`} style={{ height: `${(s.value / max) * 100}%` }} />
              ) : null,
            )}
          </div>
          <span className="bar-label">{i % 3 === 0 ? b.label : ''}</span>
        </div>
      ))}
    </div>
  );
}

export function Stats() {
  const data = useLiveQuery(async () => {
    const [cards, decks, reviews] = await Promise.all([
      db.cards.filter((c) => !c.deleted).toArray(),
      db.decks.filter((d) => !d.deleted).toArray(),
      db.reviews.toArray(),
    ]);

    const now = Date.now();
    const today = startOfDay(now);
    const dirOf = new Map(decks.map((d) => [d.id, d.reviewDirection ?? 'forward'] as const));
    const deckName = new Map(decks.map((d) => [d.id, d.name] as const));

    // Review *units* = one per active direction of each card (a two-sided deck
    // yields a forward and a reverse unit). Reusing itemsForCard keeps maturity,
    // due counts and the forecast in step with what the reviewer actually queues,
    // so the reverse side of two-sided decks is no longer invisible.
    const units = cards.flatMap((c) => itemsForCard(c, dirOf.get(c.deckId) ?? 'forward'));

    const maturity: Maturity = { nw: 0, young: 0, mature: 0 };
    let dueNow = 0;
    const forecast = new Array<number>(FORECAST_DAYS).fill(0);
    const perDeck = new Map<string, Maturity & { total: number }>();

    for (const { card, schedule } of units) {
      const { interval, dueDate } = schedule;
      bucketInterval(interval, maturity);
      if (dueDate <= now) dueNow++;

      let dm = perDeck.get(card.deckId);
      if (!dm) perDeck.set(card.deckId, (dm = { nw: 0, young: 0, mature: 0, total: 0 }));
      bucketInterval(interval, dm);
      dm.total++;

      if (interval > 0) {
        const offset = Math.round((dueDate - today) / DAY); // negative = overdue
        if (offset < FORECAST_DAYS) forecast[Math.max(0, offset)]++; // overdue folds into today
      }
    }

    const byDeck = [...perDeck.entries()]
      .map(([id, m]) => ({ id, name: deckName.get(id) ?? '(deck)', ...m }))
      .sort((a, b) => b.total - a.total);

    // Per-day study history (introductions vs repeats), from the review log.
    const byDay = new Map<number, { nw: number; rv: number }>();
    // Recall: true retention counts only genuine recall of graduated cards
    // (prevInterval >= 1 day, i.e. not learning/relearning steps). Answer
    // breakdown counts every button press in the last 30 days.
    const ret = { d7: { p: 0, t: 0 }, d30: { p: 0, t: 0 }, all: { p: 0, t: 0 } };
    const answers = { again: 0, good: 0, easy: 0 };
    const lapsesByCard = new Map<string, number>();
    let lapses30 = 0;
    const win7 = now - 7 * DAY;
    const win30 = now - 30 * DAY;

    for (const r of reviews) {
      const day = startOfDay(r.ts);
      const e = byDay.get(day) ?? { nw: 0, rv: 0 };
      if (r.prevInterval === 0) e.nw++;
      else e.rv++;
      byDay.set(day, e);

      const graduated = r.prevInterval >= 1; // a real recall test, not a learning step
      const passed = r.grade !== 'again';
      if (graduated) {
        ret.all.t++;
        if (passed) ret.all.p++;
        if (r.ts >= win30) {
          ret.d30.t++;
          if (passed) ret.d30.p++;
        }
        if (r.ts >= win7) {
          ret.d7.t++;
          if (passed) ret.d7.p++;
        }
        if (!passed) {
          lapsesByCard.set(r.cardId, (lapsesByCard.get(r.cardId) ?? 0) + 1);
          if (r.ts >= win30) lapses30++;
        }
      }
      if (r.ts >= win30) answers[r.grade]++;
    }

    const history = Array.from({ length: HISTORY_DAYS }, (_, i) => {
      const day = today - (HISTORY_DAYS - 1 - i) * DAY;
      return { day, ...(byDay.get(day) ?? { nw: 0, rv: 0 }) };
    });

    // Hardest cards: most-lapsed first, then lowest ease (min over both
    // directions). Only surface cards that have actually struggled.
    const hardest = cards
      .map((c) => ({
        id: c.id,
        deckId: c.deckId,
        front: c.front,
        deck: deckName.get(c.deckId) ?? '',
        ease: Math.min(c.easeFactor, c.reverse?.easeFactor ?? c.easeFactor),
        lapses: lapsesByCard.get(c.id) ?? 0,
      }))
      .filter((c) => c.lapses > 0 || c.ease < 2.5)
      .sort((a, b) => b.lapses - a.lapses || a.ease - b.ease)
      .slice(0, 8);

    const dueToday = forecast[0];
    const dueWeek = forecast.slice(0, 7).reduce((s, n) => s + n, 0);

    return {
      cards: cards.length,
      decks: byDeck.length,
      ...maturity,
      dueNow,
      forecast,
      dueToday,
      dueWeek,
      byDeck,
      history,
      ret,
      answers,
      lapses30,
      hardest,
    };
  }, []);

  if (!data) return <p className="muted">Loading…</p>;
  if (data.cards === 0) {
    return <p className="muted empty">No cards yet — add some and your stats will appear here.</p>;
  }

  const { cards, decks, nw, young, mature, dueNow, forecast, dueToday, dueWeek, byDeck, history, ret, answers, lapses30, hardest } = data;

  const answerTotal = answers.again + answers.good + answers.easy;

  const forecastMax = Math.max(1, ...forecast);
  const forecastBars = forecast.map((n, i) => {
    const day = startOfDay(Date.now()) + i * DAY;
    return {
      label: String(dayLabel(day)),
      title: `${new Date(day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}${i === 0 ? ' (incl. overdue)' : ''}: ${n} due`,
      segs: [{ cls: 'bar-due', value: n }],
    };
  });

  const historyMax = Math.max(1, ...history.map((h) => h.nw + h.rv));
  const historyBars = history.map((h) => ({
    label: String(dayLabel(h.day)),
    title: `${new Date(h.day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}: ${h.nw} introduced, ${h.rv} review`,
    segs: [
      { cls: 'bar-rev', value: h.rv },
      { cls: 'bar-new', value: h.nw },
    ],
  }));

  return (
    <div className="settings">
      <section className="panel">
        <h2>Overview</h2>
        <div className="stat-summary">
          <div>
            <div className="stat-num">{cards}</div>
            <div className="stat-label">cards</div>
          </div>
          <div>
            <div className="stat-num">{decks}</div>
            <div className="stat-label">decks</div>
          </div>
          <div>
            <div className="stat-num">{dueNow}</div>
            <div className="stat-label">due now</div>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Recall</h2>
        <div className="stat-summary">
          <div>
            <div className="stat-num">{pct(ret.d30.p, ret.d30.t)}</div>
            <div className="stat-label">retention · 30d</div>
          </div>
          <div>
            <div className="stat-num">{pct(ret.d7.p, ret.d7.t)}</div>
            <div className="stat-label">7 days</div>
          </div>
          <div>
            <div className="stat-num">{pct(ret.all.p, ret.all.t)}</div>
            <div className="stat-label">all time</div>
          </div>
        </div>
        <p className="muted small">
          True retention = share of reviews of graduated cards (interval ≥ 1d) answered without “Again”.
          {ret.d30.t > 0 ? ` ${ret.d30.t} such reviews in 30d, ${lapses30} lapse${lapses30 === 1 ? '' : 's'}.` : ' No qualifying reviews yet.'}
        </p>
        {answerTotal > 0 ? (
          <>
            <div className="stat-bar" role="img" aria-label={`${answers.again} again, ${answers.good} good, ${answers.easy} easy`}>
              <div className="seg seg-again" style={{ flexGrow: answers.again }} title={`Again: ${answers.again}`} />
              <div className="seg seg-good" style={{ flexGrow: answers.good }} title={`Good: ${answers.good}`} />
              <div className="seg seg-easy" style={{ flexGrow: answers.easy }} title={`Easy: ${answers.easy}`} />
            </div>
            <ul className="stat-legend">
              <li><span className="dot dot-again" /> Again <b>{answers.again}</b></li>
              <li><span className="dot dot-good" /> Good <b>{answers.good}</b></li>
              <li><span className="dot dot-easy" /> Easy <b>{answers.easy}</b></li>
            </ul>
            <p className="muted small">Answer buttons pressed in the last 30 days.</p>
          </>
        ) : (
          <p className="muted">No reviews in the last 30 days.</p>
        )}
      </section>

      <section className="panel">
        <h2>Card maturity</h2>
        <div className="stat-bar" role="img" aria-label={`${nw} new, ${young} young, ${mature} mature`}>
          <div className="seg seg-new" style={{ flexGrow: nw }} title={`New: ${nw}`} />
          <div className="seg seg-young" style={{ flexGrow: young }} title={`Young: ${young}`} />
          <div className="seg seg-mature" style={{ flexGrow: mature }} title={`Mature: ${mature}`} />
        </div>
        <ul className="stat-legend">
          <li><span className="dot dot-new" /> New <b>{nw}</b></li>
          <li><span className="dot dot-young" /> Young <b>{young}</b></li>
          <li><span className="dot dot-mature" /> Mature <b>{mature}</b></li>
        </ul>
        <p className="muted small">
          New = never reviewed · Young = interval &lt; {MATURE_DAYS}d · Mature = interval ≥ {MATURE_DAYS}d.
          Each direction of a two-sided card is counted separately.
        </p>
      </section>

      <section className="panel">
        <h2>Forecast</h2>
        <p className="muted small">
          Reviews coming due per day (next {FORECAST_DAYS} days). <b>{dueToday}</b> due today · <b>{dueWeek}</b> in the next 7 days.
        </p>
        <BarChart bars={forecastBars} max={forecastMax} />
      </section>

      <section className="panel">
        <h2>Study history</h2>
        <p className="muted small">
          Cards introduced vs. reviewed per day (last {HISTORY_DAYS} days). A two-sided deck
          introduces each card twice — once per direction.
        </p>
        <BarChart bars={historyBars} max={historyMax} />
        <ul className="stat-legend">
          <li><span className="dot bar-new" /> Introduced</li>
          <li><span className="dot bar-rev" /> Review</li>
        </ul>
      </section>

      <section className="panel">
        <h2>By deck</h2>
        <div className="deck-stats">
          <div className="deck-stat deck-stat-head">
            <span>Deck</span>
            <span className="ds-cols"><span>new</span><span>young</span><span>mature</span><span>total</span></span>
          </div>
          {byDeck.map((d) => (
            <div className="deck-stat" key={d.id}>
              <span className="deck-stat-name">{d.name}</span>
              <span className="ds-cols">
                <span className="ds-new">{d.nw}</span>
                <span className="ds-young">{d.young}</span>
                <span className="ds-mature">{d.mature}</span>
                <span><b>{d.total}</b></span>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Hardest cards</h2>
        {hardest.length === 0 ? (
          <p className="muted">No problem cards — nicely done.</p>
        ) : (
          <>
            <div className="deck-stats">
              <div className="deck-stat deck-stat-head">
                <span>Card</span>
                <span className="ds-cols2"><span>lapses</span><span>ease</span></span>
              </div>
              {hardest.map((c) => (
                <div className="deck-stat" key={c.id}>
                  <Link className="deck-stat-name" to={`/deck/${c.deckId}`} title={`${c.front} — ${c.deck}`}>
                    {c.front}
                  </Link>
                  <span className="ds-cols2">
                    <span className="ds-again">{c.lapses}</span>
                    <span>{c.ease.toFixed(2)}</span>
                  </span>
                </div>
              ))}
            </div>
            <p className="muted small">Most-lapsed first, then lowest ease. Tap a card to open its deck.</p>
          </>
        )}
      </section>
    </div>
  );
}
