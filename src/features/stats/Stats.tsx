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
    const [cards, decks] = await Promise.all([
      db.cards.filter((c) => !c.deleted).toArray(),
      db.decks.filter((d) => !d.deleted).toArray(),
    ]);

    const now = Date.now();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const localStart = today.getTime();

    const maturity: Maturity = { nw: 0, young: 0, mature: 0 };
    const forecast = new Array(7).fill(0) as number[];
    let dueNow = 0;
    let later = 0;

    for (const c of cards) {
      bucketCard(c, maturity);
      if (c.dueDate <= now) {
        dueNow++;
      } else {
        const idx = Math.floor((c.dueDate - localStart) / DAY);
        if (idx < 7) forecast[idx]++;
        else later++;
      }
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

    return { total: cards.length, ...maturity, dueNow, forecast, later, byDeck };
  }, []);

  if (!data) return <p className="muted">Loading…</p>;
  if (data.total === 0) {
    return <p className="muted empty">No cards yet — add some and your stats will appear here.</p>;
  }

  const { total, nw, young, mature, dueNow, forecast, later, byDeck } = data;
  const fcLabels = Array.from({ length: 7 }, (_, i) => {
    if (i === 0) return 'Today';
    if (i === 1) return 'Tomorrow';
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return new Date(d.getTime() + i * DAY).toLocaleDateString(undefined, { weekday: 'short' });
  });
  const fcRows = [...forecast.map((v, i) => ({ label: fcLabels[i], value: v })), { label: 'Later', value: later }];
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
        <h2>Due in the next week</h2>
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
    </div>
  );
}
