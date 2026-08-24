// Pure stats aggregation, split out from the Stats component so the (convoluted)
// bucketing / retention / maturity logic can be unit-tested without React.
import { itemsForCard } from '@shared/sm2';
import type { Card, Deck, ReviewLog } from '@shared/types';

export const DAY = 86_400_000;
export const MATURE_DAYS = 21; // Anki convention: interval >= 21d counts as "mature"
export const FORECAST_DAYS = 21;

export type Maturity = { nw: number; young: number; mature: number };

export const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
/** Local start-of-day `days` days before today (today counts as day 1). Steps by
 * calendar days, not fixed ms, so a DST transition can't shift it off midnight. */
export const rangeStartFor = (today: number, days: number) => {
  const d = new Date(today);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - (days - 1)).getTime();
};

/** Integer local-calendar day number — DST-proof basis for day/week bucketing. */
const dayNum = (t: number) => {
  const d = new Date(t);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
};

export const fmtDay = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
export const monthShort = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short' });

export function bucketInterval(interval: number, m: Maturity) {
  if (interval === 0) m.nw++;
  else if (interval < MATURE_DAYS) m.young++;
  else m.mature++;
}

export type Bucket = { label: string; sub: string; full: string };
/** Split [start, today] into readable columns: daily for short spans, weekly for
 * medium, monthly for long — so a year is 12 bars, not 365. Returns the columns
 * plus a function mapping a timestamp to its column index (-1/out-of-range possible). */
export function bucketize(start: number, today: number): { buckets: Bucket[]; granularity: 'day' | 'week' | 'month'; indexOf: (ts: number) => number } {
  const s = new Date(start);
  const startNum = dayNum(start);
  const span = dayNum(today) - startNum + 1; // calendar days, inclusive
  const buckets: Bucket[] = [];
  const atDay = (i: number) => new Date(s.getFullYear(), s.getMonth(), s.getDate() + i).getTime();

  if (span <= 35) {
    let prevMonth = -1;
    for (let i = 0; i < span; i++) {
      const t = atDay(i);
      const mo = new Date(t).getMonth();
      buckets.push({ label: String(new Date(t).getDate()), sub: mo !== prevMonth ? monthShort(t) : '', full: fmtDay(t) });
      prevMonth = mo;
    }
    return { buckets, granularity: 'day', indexOf: (ts) => dayNum(ts) - startNum };
  }
  if (span <= 190) {
    let prevMonth = -1;
    for (let i = 0; i * 7 < span; i++) {
      const t = atDay(i * 7);
      const mo = new Date(t).getMonth();
      buckets.push({ label: String(new Date(t).getDate()), sub: mo !== prevMonth ? monthShort(t) : '', full: `Week of ${fmtDay(t)}` });
      prevMonth = mo;
    }
    return { buckets, granularity: 'week', indexOf: (ts) => Math.floor((dayNum(ts) - startNum) / 7) };
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

export type Recall = {
  ret: { p: number; t: number };
  young: { p: number; t: number };
  mature: { p: number; t: number };
  answers: { again: number; good: number; easy: number };
  lapses: number;
};
export const emptyRecall = (): Recall => ({
  ret: { p: 0, t: 0 },
  young: { p: 0, t: 0 },
  mature: { p: 0, t: 0 },
  answers: { again: 0, good: 0, easy: 0 },
  lapses: 0,
});

/** Everything the Stats view renders, computed purely from the stored data plus
 * the selected date range. `now` is injected so it's deterministic in tests. */
export function computeStats(cards: Card[], decks: Deck[], reviews: ReviewLog[], rangeStart: number, now: number) {
  const today = startOfDay(now);
  const dirOf = new Map(decks.map((d) => [d.id, d.reviewDirection ?? 'forward'] as const));
  const deckName = new Map(decks.map((d) => [d.id, d.name] as const));
  const cardDeck = new Map(cards.map((c) => [c.id, c.deckId] as const));

  // Review *units* = one per active direction of each card (a two-sided deck yields
  // a forward and a reverse unit) — the reverse side is no longer invisible.
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

  const history = mkHist();
  const historyByDeck = new Map<string, { nw: number; rv: number }[]>();
  const recall = emptyRecall();
  const recallByDeck = new Map<string, Recall>();
  const lapsesByCard = new Map<string, number>();

  const foldRecall = (acc: Recall, r: ReviewLog, graduated: boolean, passed: boolean) => {
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
    // Prefer the review's own deckId: it still attributes the review once the
    // card is deleted (the card map only holds live cards). Older logs lack it.
    const deckId = r.deckId ?? cardDeck.get(r.cardId);

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
}
