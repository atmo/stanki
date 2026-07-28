import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { itemsForCard } from '@shared/sm2';
import { db } from '../../db/db';

const DAY = 86_400_000;
const MATURE_DAYS = 21; // Anki convention: interval >= 21d counts as "mature"
const FORECAST_DAYS = 21;

const RANGE_PRESETS = [
  { key: 'week', label: 'Last week', days: 7 },
  { key: 'month', label: 'Last month', days: 30 }, // default
  { key: '3m', label: 'Last 3 months', days: 90 },
  { key: '6m', label: 'Last 6 months', days: 180 },
  { key: 'year', label: 'Last year', days: 365 },
];
const DEFAULT_RANGE_DAYS = 30;

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
/** Local start-of-day `days` days before today (today counts as day 1). */
const rangeStartFor = (today: number, days: number) => today - (days - 1) * DAY;

const pct = (pass: number, total: number) => (total ? `${Math.round((pass / total) * 100)}%` : '—');

const fmtDay = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const monthShort = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short' });
const toDateInput = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

type Bucket = { label: string; sub: string; full: string };
/** Split [start, today] into readable columns: daily for short spans, weekly for
 * medium, monthly for long — so a year is 12 bars, not 365. Returns the columns
 * plus a function mapping a timestamp to its column index (-1 if out of range). */
function bucketize(start: number, today: number): { buckets: Bucket[]; granularity: string; indexOf: (ts: number) => number } {
  const span = Math.round((today - start) / DAY) + 1;
  const buckets: Bucket[] = [];

  if (span <= 35) {
    for (let d = start; d <= today; d += DAY) {
      const showMonth = d === start || new Date(d).getMonth() !== new Date(d - DAY).getMonth();
      buckets.push({ label: String(new Date(d).getDate()), sub: showMonth ? monthShort(d) : '', full: fmtDay(d) });
    }
    return { buckets, granularity: 'day', indexOf: (ts) => Math.floor((startOfDay(ts) - start) / DAY) };
  }
  if (span <= 190) {
    const W = 7 * DAY;
    for (let d = start; d <= today; d += W) {
      const showMonth = d === start || new Date(d).getMonth() !== new Date(d - W).getMonth();
      buckets.push({ label: String(new Date(d).getDate()), sub: showMonth ? monthShort(d) : '', full: `Week of ${fmtDay(d)}` });
    }
    return { buckets, granularity: 'week', indexOf: (ts) => Math.floor((startOfDay(ts) - start) / W) };
  }
  // monthly (calendar months)
  const first = new Date(start);
  first.setDate(1);
  first.setHours(0, 0, 0, 0);
  const startMK = first.getFullYear() * 12 + first.getMonth();
  const endMK = new Date(today).getFullYear() * 12 + new Date(today).getMonth();
  for (let cur = new Date(first); cur.getFullYear() * 12 + cur.getMonth() <= endMK; cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)) {
    const t = cur.getTime();
    buckets.push({
      label: monthShort(t),
      sub: cur.getMonth() === 0 ? String(cur.getFullYear()) : '',
      full: new Date(t).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    });
  }
  return { buckets, granularity: 'month', indexOf: (ts) => new Date(ts).getFullYear() * 12 + new Date(ts).getMonth() - startMK };
}

/** Deck-scope chips for the per-panel charts. */
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

/** Date-range presets + a custom "from" date. Drives retention, history and added. */
function RangeFilter({ start, today, onChange }: { start: number; today: number; onChange: (start: number) => void }) {
  return (
    <div className="range-filter">
      {RANGE_PRESETS.map((p) => (
        <button
          key={p.key}
          type="button"
          className={`chip${start === rangeStartFor(today, p.days) ? ' chip-on' : ''}`}
          onClick={() => onChange(rangeStartFor(today, p.days))}
        >
          {p.label}
        </button>
      ))}
      <label className="range-date">
        From
        <input
          type="date"
          value={toDateInput(start)}
          max={toDateInput(today)}
          onChange={(e) => {
            const [y, m, d] = e.target.value.split('-').map(Number);
            if (y && m && d) onChange(new Date(y, m - 1, d).getTime());
          }}
        />
      </label>
    </div>
  );
}

/** A single-series vertical-bar chart; every panel's chart shares it. Columns
 * carry their own label/sub so day, week and month axes all render the same way.
 * Value on top of each bar; exact detail on hover. */
function BarChart({ bars, max }: { bars: { value: number; cls: string; title: string; label: string; sub: string }[]; max: number }) {
  return (
    <div className="bar-chart">
      {bars.map((b, i) => (
        <div className="bar-col" key={i} title={b.title}>
          <div className="bar-stack">
            {b.value > 0 ? (
              <>
                <span className="bar-value">{b.value}</span>
                <div className={`bar-seg ${b.cls}`} style={{ height: `${(b.value / max) * 85}%` }} />
              </>
            ) : null}
          </div>
          <span className="bar-day">{b.label}</span>
          <span className="bar-month">{b.sub}</span>
        </div>
      ))}
    </div>
  );
}

export function Stats() {
  const [rangeStart, setRangeStart] = useState(() => rangeStartFor(startOfDay(Date.now()), DEFAULT_RANGE_DAYS));
  const [scope, setScope] = useState('all');

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

    // --- Everything below is scoped to the selected date range [rangeStart, today]. ---
    const { buckets, granularity, indexOf } = bucketize(rangeStart, today);
    const nb = buckets.length;
    const mkHist = () => Array.from({ length: nb }, () => ({ nw: 0, rv: 0 }));

    // Study history (introductions vs repeats) per bucket, overall and per deck.
    const history = mkHist();
    const historyByDeck = new Map<string, { nw: number; rv: number }[]>();

    // Recall over the range. True retention counts only genuine recall of graduated
    // cards (prevInterval >= 1d, not learning steps); young/mature split it by the
    // card's interval at review time; answers count every button press.
    const emptyRecall = () => ({
      ret: { p: 0, t: 0 },
      young: { p: 0, t: 0 }, // prevInterval in [1, MATURE_DAYS)
      mature: { p: 0, t: 0 }, // prevInterval >= MATURE_DAYS
      answers: { again: 0, good: 0, easy: 0 },
      lapses: 0,
    });
    type Recall = ReturnType<typeof emptyRecall>;
    const recall = emptyRecall();
    const recallByDeck = new Map<string, Recall>();
    const lapsesByCard = new Map<string, number>();

    const foldRecall = (acc: Recall, r: (typeof reviews)[number], graduated: boolean, passed: boolean) => {
      if (graduated) {
        acc.ret.t++;
        if (passed) acc.ret.p++;
        else acc.lapses++;
        const bucket = r.prevInterval >= MATURE_DAYS ? acc.mature : acc.young;
        bucket.t++;
        if (passed) bucket.p++;
      }
      acc.answers[r.grade]++;
    };

    for (const r of reviews) {
      if (r.ts < rangeStart) continue;
      const idx = indexOf(r.ts);
      const isNew = r.prevInterval === 0;
      const deckId = cardDeck.get(r.cardId);

      if (idx >= 0 && idx < nb) {
        if (isNew) history[idx].nw++;
        else history[idx].rv++;
        if (deckId) {
          let bd = historyByDeck.get(deckId);
          if (!bd) historyByDeck.set(deckId, (bd = mkHist()));
          if (isNew) bd[idx].nw++;
          else bd[idx].rv++;
        }
      }

      const graduated = r.prevInterval >= 1;
      const passed = r.grade !== 'again';
      if (graduated && !passed) lapsesByCard.set(r.cardId, (lapsesByCard.get(r.cardId) ?? 0) + 1);

      foldRecall(recall, r, graduated, passed);
      if (deckId) {
        let dr = recallByDeck.get(deckId);
        if (!dr) recallByDeck.set(deckId, (dr = emptyRecall()));
        foldRecall(dr, r, graduated, passed);
      }
    }

    // Cards added per bucket, from each card's createdAt — overall and per deck.
    const added = new Array<number>(nb).fill(0);
    const addedByDeck = new Map<string, number[]>();
    for (const c of cards) {
      if (c.createdAt < rangeStart) continue;
      const idx = indexOf(c.createdAt);
      if (idx < 0 || idx >= nb) continue;
      added[idx]++;
      let ad = addedByDeck.get(c.deckId);
      if (!ad) addedByDeck.set(c.deckId, (ad = new Array<number>(nb).fill(0)));
      ad[idx]++;
    }

    // Hardest cards: most-lapsed (within the range) first, then lowest ease.
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
      buckets,
      granularity,
      history,
      historyByDeck,
      added,
      addedByDeck,
      recall,
      recallByDeck,
      hardest,
    };
  }, [rangeStart]);

  if (!data) return <p className="muted">Loading…</p>;
  if (data.cards === 0) {
    return <p className="muted empty">No cards yet — add some and your stats will appear here.</p>;
  }

  const { cards, decks, nw, young, mature, dueNow, today, forecast, forecastByDeck, byDeck, buckets, granularity, history, historyByDeck, added, addedByDeck, recall, recallByDeck, hardest } = data;

  const deckOptions = byDeck.map((d) => ({ id: d.id, name: d.name })).sort((a, b) => a.name.localeCompare(b.name));
  // Fall back to "all" if the scoped deck no longer exists.
  const scopeId = scope !== 'all' && byDeck.some((d) => d.id === scope) ? scope : 'all';

  const activeMaturity = scopeId === 'all' ? { nw, young, mature } : (byDeck.find((d) => d.id === scopeId) ?? { nw: 0, young: 0, mature: 0 });
  const rec = scopeId === 'all' ? recall : (recallByDeck.get(scopeId) ?? { ret: { p: 0, t: 0 }, young: { p: 0, t: 0 }, mature: { p: 0, t: 0 }, answers: { again: 0, good: 0, easy: 0 }, lapses: 0 });
  const { ret, answers, lapses } = rec;
  const youngRet = rec.young;
  const matureRet = rec.mature;
  const answerTotal = answers.again + answers.good + answers.easy;

  const activeForecast = scopeId === 'all' ? forecast : (forecastByDeck.get(scopeId) ?? new Array<number>(forecast.length).fill(0));
  const dueToday = activeForecast[0];
  const dueWeek = activeForecast.slice(0, 7).reduce((s, n) => s + n, 0);
  const forecastMax = Math.max(1, ...activeForecast);
  const forecastBars = activeForecast.map((n, i) => {
    const day = today + i * DAY;
    const showMonth = i === 0 || new Date(day).getMonth() !== new Date(day - DAY).getMonth();
    return { value: n, cls: 'bar-due', title: `${fmtDay(day)}${i === 0 ? ' (incl. overdue)' : ''}: ${n} due`, label: String(new Date(day).getDate()), sub: showMonth ? monthShort(day) : '' };
  });

  const activeHistory = scopeId === 'all' ? history : (historyByDeck.get(scopeId) ?? buckets.map(() => ({ nw: 0, rv: 0 })));
  const introMax = Math.max(1, ...activeHistory.map((h) => h.nw));
  const introBars = buckets.map((b, i) => ({ value: activeHistory[i].nw, cls: 'bar-new', title: `${b.full}: ${activeHistory[i].nw} introduced`, label: b.label, sub: b.sub }));
  const reviewMax = Math.max(1, ...activeHistory.map((h) => h.rv));
  const reviewBars = buckets.map((b, i) => ({ value: activeHistory[i].rv, cls: 'bar-rev', title: `${b.full}: ${activeHistory[i].rv} reviewed`, label: b.label, sub: b.sub }));

  const activeAdded = scopeId === 'all' ? added : (addedByDeck.get(scopeId) ?? buckets.map(() => 0));
  const addedMax = Math.max(1, ...activeAdded);
  const addedBars = buckets.map((b, i) => ({ value: activeAdded[i], cls: 'bar-add', title: `${b.full}: ${activeAdded[i]} added`, label: b.label, sub: b.sub }));
  const addedSum = activeAdded.reduce((s, n) => s + n, 0);

  const showFilter = deckOptions.length > 1;

  return (
    <div className="settings">
      <section className="range-panel">
        <RangeFilter start={rangeStart} today={today} onChange={setRangeStart} />
        <p className="muted small">Date range for retention, study history and cards added.</p>
      </section>

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
            <div className="stat-num">{pct(ret.p, ret.t)}</div>
            <div className="stat-label">retention ({ret.t})</div>
          </div>
          <div>
            <div className="stat-num">{pct(youngRet.p, youngRet.t)}</div>
            <div className="stat-label">young ({youngRet.t})</div>
          </div>
          <div>
            <div className="stat-num">{pct(matureRet.p, matureRet.t)}</div>
            <div className="stat-label">mature ({matureRet.t})</div>
          </div>
        </div>
        <p className="muted small">
          True retention = reviews of graduated cards (interval ≥ 1d) answered without “Again”, over the selected range
          {ret.t > 0 ? ` (${ret.t} reviews, ${lapses} lapse${lapses === 1 ? '' : 's'}).` : '.'} Young (interval &lt; {MATURE_DAYS}d)
          vs mature (≥ {MATURE_DAYS}d) splits it by the card’s maturity when reviewed — low young points at weak encoding,
          low mature at intervals that are too long.
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
            <p className="muted small">Answer buttons pressed in the selected range.</p>
          </>
        ) : (
          <p className="muted">No reviews in the selected range.</p>
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
          Cards introduced vs. reviewed per {granularity}, over the selected range. A two-sided deck
          introduces each card twice — once per direction.
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
          New cards added per {granularity}, over the selected range. <b>{addedSum}</b> added.
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
          <p className="muted">No problem cards in this range — nicely done.</p>
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
            <p className="muted small">Most-lapsed (in range) first, then lowest ease. Tap a card to open its deck.</p>
          </>
        )}
      </section>
    </div>
  );
}
