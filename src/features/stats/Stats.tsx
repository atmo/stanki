import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../../db/db';
import { computeStats, emptyRecall, emptyBacklog, rangeStartFor, startOfDay, fmtDay, monthShort, RETENTION_BUCKETS, LATE_BUCKETS, DAY, MATURE_DAYS, FORECAST_DAYS } from './compute';

// Anki's conventional target; bars are coloured against it so the curve reads at
// a glance. A bucket with few reviews is dimmed rather than trusted.
const TARGET_RETENTION = 90;
const THIN_SAMPLE = 10;

const RANGE_PRESETS = [
  { key: 'week', label: 'Last week', days: 7 },
  { key: 'month', label: 'Last month', days: 30 }, // default
  { key: '3m', label: 'Last 3 months', days: 90 },
  { key: '6m', label: 'Last 6 months', days: 180 },
  { key: 'year', label: 'Last year', days: 365 },
];
const DEFAULT_RANGE_DAYS = 30;

const pct = (pass: number, total: number) => (total ? `${Math.round((pass / total) * 100)}%` : '—');
const toDateInput = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

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
function BarChart({ bars, max, className = '' }: { bars: { value: number; cls: string; title: string; label: string; sub: string; text?: string }[]; max: number; className?: string }) {
  return (
    <div className={`bar-chart ${className}`}>
      {bars.map((b, i) => (
        <div className="bar-col" key={i} title={b.title}>
          <div className="bar-stack">
            {b.value > 0 ? (
              <>
                <span className="bar-value">{b.text ?? b.value}</span>
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
    return computeStats(cards, decks, reviews, rangeStart, Date.now());
  }, [rangeStart]);

  if (!data) return <p className="muted">Loading…</p>;
  if (data.cards === 0) {
    return <p className="muted empty">No cards yet — add some and your stats will appear here.</p>;
  }

  const { cards, decks, nw, young, mature, dueNow, today, forecast, forecastByDeck, byDeck, buckets, granularity, history, historyByDeck, added, addedByDeck, recall, recallByDeck, backlog, backlogByDeck, hardest } = data;

  const deckOptions = byDeck.map((d) => ({ id: d.id, name: d.name })).sort((a, b) => a.name.localeCompare(b.name));
  // Fall back to "all" if the scoped deck no longer exists.
  const scopeId = scope !== 'all' && byDeck.some((d) => d.id === scope) ? scope : 'all';

  const activeMaturity = scopeId === 'all' ? { nw, young, mature } : (byDeck.find((d) => d.id === scopeId) ?? { nw: 0, young: 0, mature: 0 });
  const rec = scopeId === 'all' ? recall : (recallByDeck.get(scopeId) ?? emptyRecall());
  const { ret, answers, lapses } = rec;
  const youngRet = rec.young;
  const matureRet = rec.mature;
  const answerTotal = answers.again + answers.hard + answers.good + answers.easy;

  // Forgetting curve: retention per interval bucket, on a fixed 0–100 scale.
  const curveTotal = rec.curve.reduce((s, b) => s + b.t, 0);
  const curveBars = rec.curve.map((b, i) => {
    const value = b.t ? Math.round((b.p / b.t) * 100) : 0;
    const tone = value >= TARGET_RETENTION ? 'bar-ret-ok' : value >= 80 ? 'bar-ret-mid' : 'bar-ret-low';
    return {
      value,
      cls: `${tone}${b.t > 0 && b.t < THIN_SAMPLE ? ' bar-thin' : ''}`,
      text: `${value}%`,
      title: b.t
        ? `Interval ${RETENTION_BUCKETS[i].label}: ${value}% of ${b.t} review${b.t === 1 ? '' : 's'} passed`
        : `Interval ${RETENTION_BUCKETS[i].label}: no reviews`,
      label: RETENTION_BUCKETS[i].label,
      sub: b.t ? String(b.t) : '',
    };
  });

  const bl = scopeId === 'all' ? backlog : (backlogByDeck.get(scopeId) ?? emptyBacklog());
  // Days of study to clear the backlog at recent throughput. A floor, not a
  // forecast: more cards fall due every day it isn't cleared.
  const daysToClear = bl.pace > 0 ? bl.late / bl.pace : 0;

  const activeForecast = scopeId === 'all' ? forecast : (forecastByDeck.get(scopeId) ?? new Array<number>(forecast.length).fill(0));
  const dueToday = activeForecast[0];
  const dueWeek = activeForecast.slice(0, 7).reduce((s, n) => s + n, 0);
  const forecastMax = Math.max(1, ...activeForecast);
  const forecastBars = activeForecast.map((n, i) => {
    const day = today + i * DAY;
    const showMonth = i === 0 || new Date(day).getMonth() !== new Date(day - DAY).getMonth();
    return { value: n, cls: 'bar-due', title: `${fmtDay(day)}${i === 0 ? ' (incl. overdue)' : ''}: ${n} due`, label: String(new Date(day).getDate()), sub: showMonth ? monthShort(day) : '' };
  });

  const activeHistory = scopeId === 'all' ? history : (historyByDeck.get(scopeId) ?? buckets.map(() => ({ nw: 0, rv: 0, held: 0 })));
  const introMax = Math.max(1, ...activeHistory.map((h) => h.nw));
  const introBars = buckets.map((b, i) => ({ value: activeHistory[i].nw, cls: 'bar-new', title: `${b.full}: ${activeHistory[i].nw} introduced`, label: b.label, sub: b.sub }));
  const reviewMax = Math.max(1, ...activeHistory.map((h) => h.rv));
  const reviewBars = buckets.map((b, i) => ({ value: activeHistory[i].rv, cls: 'bar-rev', title: `${b.full}: ${activeHistory[i].rv} reviewed`, label: b.label, sub: b.sub }));

  const heldMax = Math.max(1, ...activeHistory.map((h) => h.held));
  const heldBars = buckets.map((b, i) => ({ value: activeHistory[i].held, cls: 'bar-held', title: `${b.full}: ${activeHistory[i].held} held over`, label: b.label, sub: b.sub }));
  const heldTotal = activeHistory.reduce((n, h) => n + h.held, 0);

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
            <div className="stat-bar" role="img" aria-label={`${answers.again} again, ${answers.hard} hard, ${answers.good} good, ${answers.easy} easy`}>
              <div className="seg seg-again" style={{ flexGrow: answers.again }} title={`Again: ${answers.again}`} />
              <div className="seg seg-hard" style={{ flexGrow: answers.hard }} title={`Hard: ${answers.hard}`} />
              <div className="seg seg-good" style={{ flexGrow: answers.good }} title={`Good: ${answers.good}`} />
              <div className="seg seg-easy" style={{ flexGrow: answers.easy }} title={`Easy: ${answers.easy}`} />
            </div>
            <ul className="stat-legend">
              <li><span className="dot dot-again" /> Again <b>{answers.again}</b></li>
              <li><span className="dot dot-hard" /> Hard <b>{answers.hard}</b></li>
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
        <h2>Retention by interval</h2>
        {showFilter && <DeckFilter options={deckOptions} value={scopeId} onChange={setScope} />}
        {curveTotal === 0 ? (
          <p className="muted">No graduated reviews in the selected range.</p>
        ) : (
          <>
            <BarChart bars={curveBars} max={100} className="bar-chart-ret" />
            <p className="muted small">
              Your forgetting curve: how often you recalled a card, grouped by the interval it had
              waited. Below each bar is how many reviews it rests on; faded bars have fewer than{' '}
              {THIN_SAMPLE} and are noise. Green ≥ {TARGET_RETENTION}%, amber ≥ 80%, red below.
              Where the bars fall away is where the schedule outruns your memory — widen the date
              range for a steadier curve.
            </p>
          </>
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
        <h2>Backlog</h2>
        {showFilter && <DeckFilter options={deckOptions} value={scopeId} onChange={setScope} />}
        {bl.late === 0 ? (
          <p className="muted">
            Nothing overdue{bl.dueToday > 0 ? ` — ${bl.dueToday} due today` : ''}. Cards are arriving on schedule.
          </p>
        ) : (
          <>
            <div className="stat-summary">
              <div>
                <div className="stat-num">{bl.late}</div>
                <div className="stat-label">overdue</div>
              </div>
              <div>
                <div className="stat-num">{bl.dueToday}</div>
                <div className="stat-label">due today</div>
              </div>
              <div>
                <div className="stat-num">{bl.oldest}d</div>
                <div className="stat-label">oldest</div>
              </div>
              {bl.relearning > 0 && (
                <div>
                  <div className="stat-num">{bl.relearning}</div>
                  <div className="stat-label">relearning</div>
                </div>
              )}
            </div>
            <div className="deck-stats">
              {LATE_BUCKETS.map((b, i) => (
                bl.buckets[i] > 0 && (
                  <div className="deck-stat" key={b.label}>
                    <span className={i >= 2 ? 'ds-again' : undefined}>{b.label} late</span>
                    <span className="ds-cols2"><span /><span><b>{bl.buckets[i]}</b></span></span>
                  </div>
                )
              ))}
            </div>
            <p className="muted small">
              {daysToClear >= 1
                ? `About ${Math.ceil(daysToClear)} day${Math.ceil(daysToClear) === 1 ? '' : 's'} of study to clear at your recent pace of ${Math.round(bl.pace)}/day — a floor, since more fall due meanwhile. `
                : ''}
              A late card is a harder card: waiting twice the scheduled interval costs roughly as much
              retention as doubling the interval would. The forecast below folds these into “today”,
              so this is the only place the delay shows.
            </p>
          </>
        )}
      </section>

      <section className="panel">
        <h2>Held over</h2>
        {showFilter && <DeckFilter options={deckOptions} value={scopeId} onChange={setScope} />}
        {heldTotal === 0 ? (
          <p className="muted">
            Nothing held over in this range. Cards are being missed and recalled within the session,
            or not missed at all.
          </p>
        ) : (
          <>
            <p className="muted small">
              Cards pushed to the next day per {granularity} — missed with too little of the session
              left to space the retry, or out of the day's allowance. <b>{heldTotal}</b> in this range.
              A downward trend means less work being carried forward.
            </p>
            <BarChart bars={heldBars} max={heldMax} />
          </>
        )}
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
