import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';

const DAY = 86_400_000;
const MATURE_DAYS = 21; // Anki convention: interval >= 21d counts as "mature"

type Maturity = { nw: number; young: number; mature: number };

function bucketCard(c: { interval: number }, m: Maturity) {
  if (c.interval === 0) m.nw++;
  else if (c.interval < MATURE_DAYS) m.young++;
  else m.mature++;
}

export function Stats() {
  const data = useLiveQuery(async () => {
    const [cards, decks, reviews] = await Promise.all([
      db.cards.filter((c) => !c.deleted).toArray(),
      db.decks.filter((d) => !d.deleted).toArray(),
      db.reviews.toArray(),
    ]);

    // Per-day study history from the review log: new-card introductions
    // (prevInterval === 0) vs. repeats, keyed by local day.
    const byDay = new Map<number, { nw: number; rv: number }>();
    for (const r of reviews) {
      const d = new Date(r.ts);
      d.setHours(0, 0, 0, 0);
      const key = d.getTime();
      const e = byDay.get(key) ?? { nw: 0, rv: 0 };
      if (r.prevInterval === 0) e.nw++;
      else e.rv++;
      byDay.set(key, e);
    }
    const history = [...byDay.entries()]
      .map(([day, c]) => ({ day, ...c }))
      .sort((a, b) => b.day - a.day)
      .slice(0, 14);

    const now = Date.now();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const localStart = today.getTime();

    const maturity: Maturity = { nw: 0, young: 0, mature: 0 };
    // Review forecast (scheduled cards only; new cards aren't scheduled): when
    // each one next comes due, bucketed relative to local midnight. "today"
    // includes overdue.
    const due = { today: 0, tomorrow: 0, week: 0, month: 0, later: 0 };
    let dueNow = 0;

    for (const c of cards) {
      bucketCard(c, maturity);
      if (c.dueDate <= now) dueNow++;
      if (c.interval === 0) continue; // new cards are introduced on demand, not scheduled
      const days = (c.dueDate - localStart) / DAY; // negative = overdue
      if (days < 1) due.today++;
      else if (days < 2) due.tomorrow++;
      else if (days < 7) due.week++;
      else if (days < 30) due.month++;
      else due.later++;
    }

    const byDeck = decks
      .map((deck) => {
        const m: Maturity = { nw: 0, young: 0, mature: 0 };
        let total = 0;
        for (const c of cards) {
          if (c.deckId !== deck.id) continue;
          bucketCard(c, m);
          total++;
        }
        return { id: deck.id, name: deck.name, total, ...m };
      })
      .filter((d) => d.total > 0)
      .sort((a, b) => b.total - a.total);

    return { total: cards.length, ...maturity, dueNow, due, byDeck, history };
  }, []);

  if (!data) return <p className="muted">Loading…</p>;
  if (data.total === 0) {
    return <p className="muted empty">No cards yet — add some and your stats will appear here.</p>;
  }

  const { total, nw, young, mature, dueNow, due, byDeck, history } = data;
  const fcRows = [
    { label: 'Today', value: due.today },
    { label: 'Tomorrow', value: due.tomorrow },
    { label: 'Next week', value: due.week },
    { label: 'Next month', value: due.month },
    { label: 'Later', value: due.later },
  ];
  const fcMax = Math.max(1, ...fcRows.map((r) => r.value));

  return (
    <div className="settings">
      <section className="panel">
        <h2>Overview</h2>
        <div className="stat-summary">
          <div>
            <div className="stat-num">{total}</div>
            <div className="stat-label">cards</div>
          </div>
          <div>
            <div className="stat-num">{byDeck.length}</div>
            <div className="stat-label">decks</div>
          </div>
          <div>
            <div className="stat-num">{dueNow}</div>
            <div className="stat-label">due now</div>
          </div>
        </div>
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
        <p className="muted small">New = never reviewed · Young = interval &lt; {MATURE_DAYS}d · Mature = interval ≥ {MATURE_DAYS}d</p>
      </section>

      <section className="panel">
        <h2>Reviews due</h2>
        <div className="forecast">
          {fcRows.map((r) => (
            <div className="fc-row" key={r.label}>
              <span>{r.label}</span>
              <span className="fc-track">
                <span className="fc-fill" style={{ width: `${(r.value / fcMax) * 100}%` }} />
              </span>
              <span className="fc-num">{r.value}</span>
            </div>
          ))}
        </div>
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
        <h2>Study history</h2>
        <p className="muted small">New cards introduced vs. repeats reviewed, per day (from the review log).</p>
        {history.length === 0 ? (
          <p className="muted">No reviews logged yet.</p>
        ) : (
          <div className="deck-stats">
            <div className="deck-stat deck-stat-head">
              <span>Day</span>
              <span className="ds-cols2"><span>new</span><span>review</span></span>
            </div>
            {history.map((h) => (
              <div className="deck-stat" key={h.day}>
                <span>{new Date(h.day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                <span className="ds-cols2">
                  <span className="ds-new">{h.nw}</span>
                  <span className="ds-young">{h.rv}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
