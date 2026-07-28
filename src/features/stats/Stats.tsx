import { useState } from 'react';
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

/** Deck-scope chips for the forecast / study-history charts. */
function DeckFilter({ options, value, onChange }: { options: { id: string; name: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="deck-filter">
      <button type="button" className={`chip${value === 'all' ? ' chip-on' : ''}`} onClick={() => onChange('all')}>All decks</button>
      {options.map((o) => (
        <button type="button" key={o.id} className={`chip${value === o.id ? ' chip-on' : ''}`} onClick={() => onChange(o.id)}>
          {o.name}
        </button>
      ))}
    </div>
  );
}

const fmtDay = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const monthShort = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short' });

/** A single-series vertical-bar chart; forecast and both history charts share it
 * so they read as one system. Every column shows its day-of-month; the month name
 * is printed at the first column and wherever the month rolls over. Exact values on
 * hover. */
function BarChart({ bars, max }: { bars: { day: number; value: number; cls: string; title: string }[]; max: number }) {
  return (
    <div className="bar-chart">
      {bars.map((b, i) => {
        const showMonth = i === 0 || new Date(b.day).getMonth() !== new Date(bars[i - 1].day).getMonth();
        return (
          <div className="bar-col" key={b.day} title={b.title}>
            <div className="bar-stack">
              {b.value > 0 ? (
                <>
                  <span className="bar-value">{b.value}</span>
                  <div className={`bar-seg ${b.cls}`} style={{ height: `${(b.value / max) * 85}%` }} />
                </>
              ) : null}
            </div>
            <span className="bar-day">{new Date(b.day).getDate()}</span>
            <span className="bar-month">{showMonth ? monthShort(b.day) : ''}</span>
          </div>
        );
      })}
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
    const cardDeck = new Map(cards.map((c) => [c.id, c.deckId] as const));

    // Review *units* = one per active direction of each card (a two-sided deck
    // yields a forward and a reverse unit). Reusing itemsForCard keeps maturity,
    // due counts and the forecast in step with what the reviewer actually queues,
    // so the reverse side of two-sided decks is no longer invisible.
    const units = cards.flatMap((c) => itemsForCard(c, dirOf.get(c.deckId) ?? 'forward'));

    const maturity: Maturity = { nw: 0, young: 0, mature: 0 };
    let dueNow = 0;
    const forecast = new Array<number>(FORECAST_DAYS).fill(0);
    const forecastByDeck = new Map<string, number[]>();
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
        if (offset < FORECAST_DAYS) {
          const idx = Math.max(0, offset); // overdue folds into today
          forecast[idx]++;
          let fd = forecastByDeck.get(card.deckId);
          if (!fd) forecastByDeck.set(card.deckId, (fd = new Array<number>(FORECAST_DAYS).fill(0)));
          fd[idx]++;
        }
      }
    }

    const byDeck = [...perDeck.entries()]
      .map(([id, m]) => ({ id, name: deckName.get(id) ?? '(deck)', dir: dirOf.get(id) ?? 'forward', ...m }))
      .sort((a, b) => b.total - a.total);

    // Per-day study history (introductions vs repeats), from the review log —
    // both overall and per deck (so the chart can be scoped to one deck).
    const byDay = new Map<number, { nw: number; rv: number }>();
    const byDayByDeck = new Map<string, Map<number, { nw: number; rv: number }>>();
    // Recall: true retention counts only genuine recall of graduated cards
    // (prevInterval >= 1 day, i.e. not learning/relearning steps). Answer
    // breakdown counts every button press in the last 30 days. Accumulated
    // overall and per deck so the panel can be scoped.
    const win7 = now - 7 * DAY;
    const win30 = now - 30 * DAY;
    const emptyRecall = () => ({
      ret: { d7: { p: 0, t: 0 }, d30: { p: 0, t: 0 }, all: { p: 0, t: 0 } },
      // 30-day retention split by the card's maturity *at review time* (prevInterval).
      young: { p: 0, t: 0 }, // prevInterval in [1, MATURE_DAYS)
      mature: { p: 0, t: 0 }, // prevInterval >= MATURE_DAYS
      answers: { again: 0, good: 0, easy: 0 },
      lapses30: 0,
    });
    type Recall = ReturnType<typeof emptyRecall>;
    const recall = emptyRecall();
    const recallByDeck = new Map<string, Recall>();
    const lapsesByCard = new Map<string, number>();

    const foldRecall = (acc: Recall, r: (typeof reviews)[number], graduated: boolean, passed: boolean) => {
      if (graduated) {
        acc.ret.all.t++;
        if (passed) acc.ret.all.p++;
        if (r.ts >= win30) {
          acc.ret.d30.t++;
          if (passed) acc.ret.d30.p++;
          else acc.lapses30++;
          const bucket = r.prevInterval >= MATURE_DAYS ? acc.mature : acc.young;
          bucket.t++;
          if (passed) bucket.p++;
        }
        if (r.ts >= win7) {
          acc.ret.d7.t++;
          if (passed) acc.ret.d7.p++;
        }
      }
      if (r.ts >= win30) acc.answers[r.grade]++;
    };

    for (const r of reviews) {
      const day = startOfDay(r.ts);
      const isNew = r.prevInterval === 0;
      const deckId = cardDeck.get(r.cardId);

      const e = byDay.get(day) ?? { nw: 0, rv: 0 };
      if (isNew) e.nw++;
      else e.rv++;
      byDay.set(day, e);
      if (deckId) {
        let bd = byDayByDeck.get(deckId);
        if (!bd) byDayByDeck.set(deckId, (bd = new Map()));
        const de = bd.get(day) ?? { nw: 0, rv: 0 };
        if (isNew) de.nw++;
        else de.rv++;
        bd.set(day, de);
      }

      const graduated = r.prevInterval >= 1; // a real recall test, not a learning step
      const passed = r.grade !== 'again';
      if (graduated && !passed) lapsesByCard.set(r.cardId, (lapsesByCard.get(r.cardId) ?? 0) + 1);

      foldRecall(recall, r, graduated, passed);
      if (deckId) {
        let dr = recallByDeck.get(deckId);
        if (!dr) recallByDeck.set(deckId, (dr = emptyRecall()));
        foldRecall(dr, r, graduated, passed);
      }
    }

    const buildHistory = (bd: Map<number, { nw: number; rv: number }>) =>
      Array.from({ length: HISTORY_DAYS }, (_, i) => {
        const day = today - (HISTORY_DAYS - 1 - i) * DAY;
        return { day, ...(bd.get(day) ?? { nw: 0, rv: 0 }) };
      });
    const history = buildHistory(byDay);
    const historyByDeck = new Map([...byDayByDeck].map(([id, bd]) => [id, buildHistory(bd)] as const));

    // Cards added per day, from each card's createdAt — overall and per deck.
    const addedByDay = new Map<number, number>();
    const addedByDayByDeck = new Map<string, Map<number, number>>();
    for (const c of cards) {
      const day = startOfDay(c.createdAt);
      addedByDay.set(day, (addedByDay.get(day) ?? 0) + 1);
      let ad = addedByDayByDeck.get(c.deckId);
      if (!ad) addedByDayByDeck.set(c.deckId, (ad = new Map()));
      ad.set(day, (ad.get(day) ?? 0) + 1);
    }
    const buildAdded = (m: Map<number, number>) =>
      Array.from({ length: HISTORY_DAYS }, (_, i) => {
        const day = today - (HISTORY_DAYS - 1 - i) * DAY;
        return { day, value: m.get(day) ?? 0 };
      });
    const added = buildAdded(addedByDay);
    const addedByDeck = new Map([...addedByDayByDeck].map(([id, m]) => [id, buildAdded(m)] as const));

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

    return {
      cards: cards.length,
      decks: byDeck.length,
      ...maturity,
      dueNow,
      today,
      forecast,
      forecastByDeck,
      byDeck,
      history,
      historyByDeck,
      added,
      addedByDeck,
      recall,
      recallByDeck,
      hardest,
    };
  }, []);

  // Deck scope for the forecast + study-history charts; "all" == aggregate (default).
  const [scope, setScope] = useState('all');

  if (!data) return <p className="muted">Loading…</p>;
  if (data.cards === 0) {
    return <p className="muted empty">No cards yet — add some and your stats will appear here.</p>;
  }

  const { cards, decks, nw, young, mature, dueNow, today, forecast, forecastByDeck, byDeck, history, historyByDeck, added, addedByDeck, recall, recallByDeck, hardest } = data;

  const deckOptions = byDeck.map((d) => ({ id: d.id, name: d.name })).sort((a, b) => a.name.localeCompare(b.name));
  // Fall back to "all" if the scoped deck no longer exists.
  const scopeId = scope !== 'all' && byDeck.some((d) => d.id === scope) ? scope : 'all';

  // Maturity and recall follow the same deck scope as the charts.
  const activeMaturity = scopeId === 'all' ? { nw, young, mature } : (byDeck.find((d) => d.id === scopeId) ?? { nw: 0, young: 0, mature: 0 });
  const rec = scopeId === 'all' ? recall : (recallByDeck.get(scopeId) ?? { ret: { d7: { p: 0, t: 0 }, d30: { p: 0, t: 0 }, all: { p: 0, t: 0 } }, young: { p: 0, t: 0 }, mature: { p: 0, t: 0 }, answers: { again: 0, good: 0, easy: 0 }, lapses30: 0 });
  const { ret, answers, lapses30 } = rec;
  const youngRet = rec.young;
  const matureRet = rec.mature;
  const answerTotal = answers.again + answers.good + answers.easy;
  const activeForecast = scopeId === 'all' ? forecast : (forecastByDeck.get(scopeId) ?? new Array<number>(forecast.length).fill(0));
  const activeHistory = scopeId === 'all' ? history : (historyByDeck.get(scopeId) ?? history.map((h) => ({ day: h.day, nw: 0, rv: 0 })));
  const dueToday = activeForecast[0];
  const dueWeek = activeForecast.slice(0, 7).reduce((s, n) => s + n, 0);

  const forecastMax = Math.max(1, ...activeForecast);
  const forecastBars = activeForecast.map((n, i) => {
    const day = today + i * DAY;
    return { day, value: n, cls: 'bar-due', title: `${fmtDay(day)}${i === 0 ? ' (incl. overdue)' : ''}: ${n} due` };
  });

  const introMax = Math.max(1, ...activeHistory.map((h) => h.nw));
  const introBars = activeHistory.map((h) => ({ day: h.day, value: h.nw, cls: 'bar-new', title: `${fmtDay(h.day)}: ${h.nw} introduced` }));
  const reviewMax = Math.max(1, ...activeHistory.map((h) => h.rv));
  const reviewBars = activeHistory.map((h) => ({ day: h.day, value: h.rv, cls: 'bar-rev', title: `${fmtDay(h.day)}: ${h.rv} reviewed` }));

  const activeAdded = scopeId === 'all' ? added : (addedByDeck.get(scopeId) ?? added.map((a) => ({ day: a.day, value: 0 })));
  const addedMax = Math.max(1, ...activeAdded.map((a) => a.value));
  const addedBars = activeAdded.map((a) => ({ day: a.day, value: a.value, cls: 'bar-add', title: `${fmtDay(a.day)}: ${a.value} added` }));
  const addedSum = activeAdded.reduce((s, a) => s + a.value, 0);

  const showFilter = deckOptions.length > 1;

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
        {showFilter && <DeckFilter options={deckOptions} value={scopeId} onChange={setScope} />}
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
        {youngRet.t + matureRet.t > 0 && (
          <>
            <div className="stat-summary">
              <div>
                <div className="stat-num">{pct(youngRet.p, youngRet.t)}</div>
                <div className="stat-label">young · 30d ({youngRet.t})</div>
              </div>
              <div>
                <div className="stat-num">{pct(matureRet.p, matureRet.t)}</div>
                <div className="stat-label">mature · 30d ({matureRet.t})</div>
              </div>
            </div>
            <p className="muted small">
              Retention by the card’s maturity when reviewed — young (interval &lt; {MATURE_DAYS}d) vs
              mature (≥ {MATURE_DAYS}d). Low young points at weak encoding; low mature at intervals that are too long.
            </p>
          </>
        )}
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
        {showFilter && <DeckFilter options={deckOptions} value={scopeId} onChange={setScope} />}
        <div className="stat-bar" role="img" aria-label={`${activeMaturity.nw} new, ${activeMaturity.young} young, ${activeMaturity.mature} mature`}>
          <div className="seg seg-new" style={{ flexGrow: activeMaturity.nw }} title={`New: ${activeMaturity.nw}`} />
          <div className="seg seg-young" style={{ flexGrow: activeMaturity.young }} title={`Young: ${activeMaturity.young}`} />
          <div className="seg seg-mature" style={{ flexGrow: activeMaturity.mature }} title={`Mature: ${activeMaturity.mature}`} />
        </div>
        <ul className="stat-legend">
          <li><span className="dot dot-new" /> New <b>{activeMaturity.nw}</b></li>
          <li><span className="dot dot-young" /> Young <b>{activeMaturity.young}</b></li>
          <li><span className="dot dot-mature" /> Mature <b>{activeMaturity.mature}</b></li>
        </ul>
        <p className="muted small">
          New = never reviewed · Young = interval &lt; {MATURE_DAYS}d · Mature = interval ≥ {MATURE_DAYS}d.
          Each direction of a two-sided card is counted separately.
        </p>
      </section>

      <section className="panel">
        <h2>Forecast</h2>
        {showFilter && <DeckFilter options={deckOptions} value={scopeId} onChange={setScope} />}
        <p className="muted small">
          Reviews coming due per day (next {FORECAST_DAYS} days). <b>{dueToday}</b> due today · <b>{dueWeek}</b> in the next 7 days.
        </p>
        <BarChart bars={forecastBars} max={forecastMax} />
      </section>

      <section className="panel">
        <h2>Study history</h2>
        {showFilter && <DeckFilter options={deckOptions} value={scopeId} onChange={setScope} />}
        <p className="muted small">
          Per day, last {HISTORY_DAYS} days. A two-sided deck introduces each card twice —
          once per direction.
        </p>
        <div className="chart-title"><span className="dot bar-new" /> Introduced</div>
        <BarChart bars={introBars} max={introMax} />
        <div className="chart-title"><span className="dot bar-rev" /> Reviewed</div>
        <BarChart bars={reviewBars} max={reviewMax} />
      </section>

      <section className="panel">
        <h2>Cards added</h2>
        {showFilter && <DeckFilter options={deckOptions} value={scopeId} onChange={setScope} />}
        <p className="muted small">
          New cards added per day (last {HISTORY_DAYS} days). <b>{addedSum}</b> added in this window.
        </p>
        <BarChart bars={addedBars} max={addedMax} />
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
              <span className="ds-deck">
                <span className="deck-stat-name">{d.name}</span>
                {d.dir === 'both' && <span className="tag-2s" title="Two-sided — both directions counted">↔</span>}
                {d.dir === 'reverse' && <span className="tag-2s" title="Reverse only">←</span>}
              </span>
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
