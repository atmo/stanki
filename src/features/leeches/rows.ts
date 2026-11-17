// Row building for the leech worklist, split out so the (per-deck threshold,
// per-direction, active-sides-only) selection can be tested without React.
import { effectiveSettings, itemsForCard, buriedUntilDate } from '@shared/sm2';
import { leechCount, isLeech } from '@shared/leech';
import type { Card, CardDirection, Deck, SrSettings } from '@shared/types';

export type LeechRow = {
  card: Card;
  direction: CardDirection;
  deckName: string;
  threshold: number;
  lapses: number;
  ease: number;
  dueDate: number;
  // Set while the side is out of rotation; its lapse count reads zero meanwhile,
  // which is why a buried card has to be kept on the list deliberately — it
  // would otherwise look like a card that had been dealt with and vanish.
  buriedUntil?: number;
  cycles: number;
};

/**
 * Every side that has lapsed past its deck's threshold, worst first.
 *
 * Only the sides the deck actually reviews are considered: a flag on a direction
 * that is no longer served is not work, it is residue. Thresholds come from the
 * deck's own settings, so a deck that tolerates more failures is not judged by
 * the global number.
 */
export function leechRows(
  cards: Card[],
  decks: Deck[],
  counts: Map<string, number>,
  global: SrSettings,
  now = Date.now(),
): LeechRow[] {
  const deckById = new Map(decks.map((d) => [d.id, d] as const));
  const rows = cards.flatMap((card) => {
    const deck = deckById.get(card.deckId);
    if (!deck) return []; // orphan: its deck is gone, so there is nothing to open
    const threshold = effectiveSettings(deck, global).leechThreshold;
    return itemsForCard(card, deck.reviewDirection ?? 'forward')
      .map(({ direction, schedule }) => ({
        card,
        direction,
        deckName: deck.name,
        threshold,
        lapses: leechCount(counts, card.id, direction),
        ease: schedule.easeFactor,
        dueDate: schedule.dueDate,
        buriedUntil: buriedUntilDate(schedule, now),
        cycles: schedule.buriedCycles ?? 0,
      }))
      .filter((r) => isLeech(r.lapses, r.threshold) || r.buriedUntil !== undefined);
  });
  // Cards still in rotation first — those are the ones there is anything to do
  // about. Ties broken by the lower ease: the card the scheduler has already
  // given up the most ground on. Buried ones follow, soonest back first.
  return rows.sort((a, b) => {
    if (!a.buriedUntil !== !b.buriedUntil) return a.buriedUntil ? 1 : -1;
    if (a.buriedUntil && b.buriedUntil) return a.buriedUntil - b.buriedUntil;
    return b.lapses - a.lapses || a.ease - b.ease;
  });
}
