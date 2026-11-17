// Row building for the leech worklist, split out so the (per-deck threshold,
// per-direction, active-sides-only) selection can be tested without React.
import { effectiveSettings, itemsForCard } from '@shared/sm2';
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
      }))
      .filter((r) => isLeech(r.lapses, r.threshold));
  });
  // Ties broken by the lower ease: that is the card the scheduler has already
  // given up the most ground on.
  return rows.sort((a, b) => b.lapses - a.lapses || a.ease - b.ease);
}
