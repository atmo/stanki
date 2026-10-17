import { describe, it, expect } from 'vitest';
import { groupLinks } from './LinksSection';
import type { Card } from '@shared/types';

const card = (id: string, deckId: string, urls: { url: string; displayUrl?: string }[]): Card => ({
  id, deckId, front: id, back: 'b', interval: 0, easeFactor: 2.5, repetitions: 0,
  dueDate: 0, createdAt: 0, updatedAt: 0,
  contexts: urls.map((u, i) => ({ text: `${id}-${i}`, ...u })),
});
const names = new Map([['d1', 'Nederlands'], ['d2', 'KNM']]);

describe('groupLinks', () => {
  it('counts an address once per deck, however many cards cite it', () => {
    // The KNM case: one url on every card in the deck.
    const cards = Array.from({ length: 5 }, (_, i) => card(`c${i}`, 'd2', [{ url: 'https://x.nl/reg' }]));
    const [deck] = groupLinks(cards, names);
    expect(deck.total).toBe(1);
    expect(deck.sites[0].links[0].cards).toHaveLength(5);
  });

  it('collapses every capture of one page into a single row', () => {
    // 249 archive links on real cards are 17 articles; the difference is the
    // #selection anchor the extension adds per captured sentence.
    const cards = Array.from({ length: 4 }, (_, i) =>
      card(`c${i}`, 'd1', [{ url: `https://archive.ph/JtsB0#selection-${i}.0-${i}.5` }]),
    );
    const [deck] = groupLinks(cards, names);
    expect(deck.total).toBe(1);
    expect(deck.sites[0].links[0].url).toBe('https://archive.ph/JtsB0');
    expect(deck.sites[0].links[0].cards).toHaveLength(4);
  });

  it('groups by the display label, so a mirror files under its source', () => {
    const cards = [
      card('a', 'd1', [{ url: 'https://archive.is/1', displayUrl: 'https://nos.nl/a' }]),
      card('b', 'd1', [{ url: 'https://nos.nl/b' }]),
    ];
    const [deck] = groupLinks(cards, names);
    expect(deck.sites.map((s) => s.site)).toEqual(['nos.nl']);
    expect(deck.sites[0].links).toHaveLength(2); // distinct addresses, same site
  });

  it('keeps the same address in separate decks apart', () => {
    const groups = groupLinks(
      [card('a', 'd1', [{ url: 'https://x.nl/1' }]), card('b', 'd2', [{ url: 'https://x.nl/1' }])],
      names,
    );
    expect(groups.map((g) => g.deck)).toEqual(['KNM', 'Nederlands']); // decks alphabetical
    expect(groups.every((g) => g.total === 1)).toBe(true);
  });

  it('sorts sites and links alphabetically, with unhostable labels last', () => {
    const cards = [
      card('a', 'd1', [
        { url: 'https://zzz.nl/1' },
        { url: 'https://aaa.nl/2' },
        { url: 'https://aaa.nl/1' },
        { url: 'https://q.nl/x', displayUrl: 'my own notes' },
      ]),
    ];
    const [deck] = groupLinks(cards, names);
    expect(deck.sites.map((s) => s.site)).toEqual(['aaa.nl', 'zzz.nl', 'no site']);
    expect(deck.sites[0].links.map((l) => l.label)).toEqual(['https://aaa.nl/1', 'https://aaa.nl/2']);
  });

  it('lists each citing card once, however many sentences it captured', () => {
    // One card can quote the same article several times; it is still one card.
    const cards = [
      card('a', 'd1', [
        { url: 'https://nos.nl/x#selection-1.0-1.5' },
        { url: 'https://nos.nl/x#selection-9.0-9.5' },
      ]),
      card('b', 'd1', [{ url: 'https://nos.nl/x' }]),
    ];
    const [deck] = groupLinks(cards, names);
    const row = deck.sites[0].links[0];
    expect(row.cards.map((c) => c.front)).toEqual(['a', 'b']);
  });

  it('carries the deck id on each card, so the editor can be reached', () => {
    const [deck] = groupLinks([card('a', 'd2', [{ url: 'https://nos.nl/x' }])], names);
    expect(deck.sites[0].links[0].cards[0]).toMatchObject({ id: 'a', deckId: 'd2', front: 'a' });
  });

  it('ignores contexts with no url at all', () => {
    expect(groupLinks([card('a', 'd1', [])], names)).toEqual([]);
  });
});
