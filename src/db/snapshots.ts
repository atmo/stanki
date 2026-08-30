// A once-a-day tally of things that only exist as current state. Card state has
// no history — a card held over in September and recalled since leaves no trace
// of ever having been in that condition — so a level like "how many are
// outstanding" cannot be reconstructed from the review log the way a flow can.
// Recording it as it happens is the only way to have the series later.
import { db } from './db';
import { getSettings } from './repo';
import { startOfDay, itemsForCard, effectiveSettings } from '@shared/sm2';

const KEY = 'dailySnapshots';
const KEEP_DAYS = 400;

export interface DaySnapshot {
  day: number; // local start of day
  /** Per deck: cards carrying a held-over side, and cards past due. */
  decks: Record<string, { held: number; late: number }>;
}

async function read(): Promise<DaySnapshot[]> {
  const row = await db.meta.get(KEY);
  return (row?.value as DaySnapshot[]) ?? [];
}

export const listSnapshots = read;

/**
 * Record today's levels, unless today is already recorded. Cheap enough to call
 * on every start: one read of the cards table and a single meta write per day.
 */
export async function recordDailySnapshot(now = Date.now()): Promise<void> {
  const day = startOfDay(now);
  const existing = await read();
  if (existing.some((s) => s.day === day)) return;

  const [cards, decks, settings] = await Promise.all([
    db.cards.filter((c) => !c.deleted).toArray(),
    db.decks.filter((d) => !d.deleted).toArray(),
    getSettings(), // merged with defaults, so a partial stored set can't leak through
  ]);
  const byId = new Map(decks.map((d) => [d.id, d]));

  const out: DaySnapshot = { day, decks: {} };
  for (const c of cards) {
    const deck = byId.get(c.deckId);
    const eff = effectiveSettings(deck, settings);
    const bucket = (out.decks[c.deckId] ??= { held: 0, late: 0 });
    for (const { schedule } of itemsForCard(c, deck?.reviewDirection ?? 'forward', eff)) {
      if (schedule.heldOver) bucket.held++;
      if (schedule.interval > 0 && schedule.dueDate < day) bucket.late++;
    }
  }

  const kept = [...existing, out].filter((s) => s.day > day - KEEP_DAYS * 86_400_000);
  await db.meta.put({ key: KEY, value: kept });
}
