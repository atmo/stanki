import { describe, it, expect } from 'vitest';
import { computeStats, bucketize, rangeStartFor, startOfDay, retentionBucket, RETENTION_BUCKETS, DAY, MATURE_DAYS } from './compute';
import type { Card, Deck, Grade, ReviewLog } from '@shared/types';

// Midday of a local date, so day-boundary math never lands on a DST edge.
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const NOW = at(2025, 6, 15);
const TODAY = startOfDay(NOW);

function deck(id: string, extra: Partial<Deck> = {}): Deck {
  return { id, name: id, createdAt: 0, updatedAt: 0, ...extra };
}
function card(id: string, deckId: string, extra: Partial<Card> = {}): Card {
  return { id, deckId, front: id, back: id, interval: 0, easeFactor: 2.5, repetitions: 0, dueDate: 0, createdAt: TODAY, updatedAt: 0, ...extra };
}
function review(id: string, cardId: string, ts: number, prevInterval: number, grade: Grade): ReviewLog {
  return { id, cardId, ts, grade, prevInterval, newInterval: prevInterval || 1 };
}

const run = (cards: Card[], decks: Deck[], reviews: ReviewLog[], days = 30) =>
  computeStats(cards, decks, reviews, rangeStartFor(TODAY, days), NOW);

describe('bucketize', () => {
  it('is daily up to a 35-day span, one column per day', () => {
    const b = bucketize(rangeStartFor(TODAY, 35), TODAY);
    expect(b.granularity).toBe('day');
    expect(b.buckets).toHaveLength(35);
    expect(b.indexOf(rangeStartFor(TODAY, 35))).toBe(0);
    expect(b.indexOf(TODAY)).toBe(34);
  });

  it('switches to weekly past 35 days and stays within range', () => {
    const b = bucketize(rangeStartFor(TODAY, 90), TODAY);
    expect(b.granularity).toBe('week');
    expect(b.indexOf(TODAY)).toBe(b.buckets.length - 1);
    expect(b.indexOf(rangeStartFor(TODAY, 90))).toBe(0);
  });

  it('boundaries: 35d daily, 36d weekly, 190d weekly, 191d monthly', () => {
    expect(bucketize(rangeStartFor(TODAY, 35), TODAY).granularity).toBe('day');
    expect(bucketize(rangeStartFor(TODAY, 36), TODAY).granularity).toBe('week');
    expect(bucketize(rangeStartFor(TODAY, 190), TODAY).granularity).toBe('week');
    expect(bucketize(rangeStartFor(TODAY, 191), TODAY).granularity).toBe('month');
  });

  it('monthly spans one column per calendar month', () => {
    const b = bucketize(startOfDay(at(2024, 1, 10)), startOfDay(at(2024, 12, 20)));
    expect(b.granularity).toBe('month');
    expect(b.buckets).toHaveLength(12); // Jan..Dec
    expect(b.indexOf(at(2024, 1, 31))).toBe(0);
    expect(b.indexOf(at(2024, 12, 1))).toBe(11);
  });
});

describe('computeStats — maturity', () => {
  it('buckets new / young / mature by interval', () => {
    const s = run(
      [
        card('new', 'd', { interval: 0 }),
        card('young', 'd', { interval: 5 }),
        card('mature', 'd', { interval: MATURE_DAYS }),
      ],
      [deck('d')],
      [],
    );
    expect([s.nw, s.young, s.mature]).toEqual([1, 1, 1]);
  });

  it('counts each direction of a two-sided card separately', () => {
    // forward interval 10 (young); reverse missing -> reads as new.
    const s = run([card('x', 'd', { interval: 10 })], [deck('d', { reviewDirection: 'both' })], []);
    expect([s.nw, s.young, s.mature]).toEqual([1, 1, 0]);
    expect(s.byDeck[0]).toMatchObject({ id: 'd', dir: 'both', total: 2, nw: 1, young: 1 });
  });
});

describe('computeStats — forecast', () => {
  it('buckets by day, folds overdue into today, and ignores new cards', () => {
    const s = run(
      [
        card('due', 'd', { interval: 5, dueDate: TODAY }),
        card('in3', 'd', { interval: 5, dueDate: TODAY + 3 * DAY }),
        card('overdue', 'd', { interval: 5, dueDate: TODAY - 2 * DAY }),
        card('new', 'd', { interval: 0, dueDate: TODAY }), // unscheduled
      ],
      [deck('d')],
      [],
    );
    expect(s.forecast[0]).toBe(2); // due today + overdue
    expect(s.forecast[3]).toBe(1);
    expect(s.forecast.reduce((a, b) => a + b, 0)).toBe(3);
  });
});

describe('computeStats — backlog', () => {
  const deckId = 'd';
  const at = (daysLate: number) => card(`c${daysLate}`, deckId, { interval: 10, dueDate: TODAY - daysLate * DAY });

  it('buckets waiting cards by how many whole days late they are', () => {
    const s = run([at(0), at(1), at(3), at(10), at(90)], [deck(deckId)], []);
    expect(s.backlog.dueToday).toBe(1); // due at today's midnight is due, not late
    expect(s.backlog.late).toBe(4);
    expect(s.backlog.buckets).toEqual([1, 1, 1, 1]); // 1d, 2-7d, 8-30d, 30d+
    expect(s.backlog.oldest).toBe(90);
  });

  it('ignores new cards and anything not yet due', () => {
    const s = run(
      [
        card('new', deckId, { interval: 0, dueDate: TODAY - 5 * DAY }), // unscheduled
        card('future', deckId, { interval: 10, dueDate: TODAY + 3 * DAY }),
      ],
      [deck(deckId)],
      [],
    );
    expect([s.backlog.late, s.backlog.dueToday]).toEqual([0, 0]);
  });

  it('counts both directions of a two-sided card', () => {
    const c = card('x', deckId, {
      interval: 10, dueDate: TODAY - 2 * DAY,
      reverse: { interval: 5, easeFactor: 2.5, repetitions: 1, dueDate: TODAY - 2 * DAY },
    });
    expect(run([c], [deck(deckId, { reviewDirection: 'both' })], []).backlog.late).toBe(2);
  });

  it('measures pace from day-scale reviews only, over a fixed window', () => {
    const reviews = [
      review('a', 'c1', TODAY - 2 * DAY, 5, 'good'), // counts
      review('b', 'c1', TODAY - 3 * DAY, 0, 'good'), // an introduction, not a review
      review('c', 'c1', TODAY - 40 * DAY, 5, 'good'), // outside the pace window
    ];
    const s = run([at(1)], [deck(deckId)], reviews, 365);
    expect(s.backlog.pace).toBeCloseTo(1 / 14, 6);
  });

  it('keeps each deck backlog separate', () => {
    const s = run(
      [card('a', 'd1', { interval: 10, dueDate: TODAY - 4 * DAY }), card('b', 'd2', { interval: 10, dueDate: TODAY })],
      [deck('d1'), deck('d2')],
      [],
    );
    expect(s.backlogByDeck.get('d1')!.late).toBe(1);
    expect(s.backlogByDeck.get('d2')!.late).toBe(0);
    expect(s.backlogByDeck.get('d2')!.dueToday).toBe(1);
  });
});

describe('computeStats — recall', () => {
  const cards = [card('a', 'd'), card('b', 'd'), card('c', 'd')];
  const decks = [deck('d')];
  const reviews = [
    review('r1', 'a', TODAY, 5, 'good'), // young graduated, passed
    review('r2', 'b', TODAY, 30, 'again'), // mature graduated, lapsed
    review('r3', 'c', TODAY, 0, 'good'), // learning step (not graduated)
    review('r4', 'a', TODAY - 40 * DAY, 10, 'good'), // before the 30d range
  ];

  it('true retention counts only in-range graduated reviews', () => {
    const s = run(cards, decks, reviews);
    expect(s.recall.ret).toEqual({ p: 1, t: 2 }); // r1 pass, r2 fail; r3 learning & r4 out-of-range excluded
    expect(s.recall.lapses).toBe(1);
  });

  it('splits retention by maturity at review time (prevInterval)', () => {
    const s = run(cards, decks, reviews);
    expect(s.recall.young).toEqual({ p: 1, t: 1 }); // r1 (prevInterval 5)
    expect(s.recall.mature).toEqual({ p: 0, t: 1 }); // r2 (prevInterval 30)
  });

  it('answer breakdown counts every in-range press, including learning steps', () => {
    const s = run(cards, decks, reviews);
    expect(s.recall.answers).toEqual({ again: 1, hard: 0, good: 2, easy: 0 }); // r1,r3 good; r2 again; r4 excluded
  });

  it('records study history in the day bucket, split new vs review', () => {
    const s = run(cards, decks, reviews);
    const last = s.history[s.history.length - 1]; // "today"
    expect(last).toEqual({ nw: 1, rv: 2 }); // r3 is new; r1,r2 are reviews
  });
});

describe('retentionBucket / forgetting curve', () => {
  it('maps an interval to its bucket, with the last one open-ended', () => {
    expect(RETENTION_BUCKETS.map((b) => b.label)).toEqual(['1–2d', '2–4d', '4–8d', '8–16d', '16–32d', '32–64d', '64d+']);
    expect(retentionBucket(1)).toBe(0);
    expect(retentionBucket(1.9)).toBe(0);
    expect(retentionBucket(2)).toBe(1); // lower edge is inclusive
    expect(retentionBucket(15)).toBe(3);
    expect(retentionBucket(64)).toBe(6);
    expect(retentionBucket(9999)).toBe(6); // open-ended top bucket
  });

  it('tallies pass/total per bucket and excludes learning steps', () => {
    const cards = [card('a', 'd'), card('b', 'd'), card('c', 'd')];
    const s = run(cards, [deck('d')], [
      review('r1', 'a', TODAY, 1, 'good'), // bucket 0, pass
      review('r2', 'b', TODAY, 1.5, 'again'), // bucket 0, fail
      review('r3', 'c', TODAY, 30, 'good'), // bucket 4, pass
      review('r4', 'a', TODAY, 0, 'again'), // learning step — not on the curve
    ]);
    expect(s.recall.curve[0]).toEqual({ p: 1, t: 2 });
    expect(s.recall.curve[4]).toEqual({ p: 1, t: 1 });
    expect(s.recall.curve.reduce((n, b) => n + b.t, 0)).toBe(3); // r4 excluded
  });
});

describe('computeStats — hardest cards', () => {
  it('ranks by in-range lapses then lowest ease, min ease over both directions', () => {
    const cards = [
      card('leech', 'd', { easeFactor: 2.5, reverse: { interval: 1, easeFactor: 1.8, repetitions: 1, dueDate: 0 } }),
      card('lowease', 'd', { easeFactor: 2.1 }),
      card('fine', 'd', { easeFactor: 2.5 }),
    ];
    const reviews = [
      review('l1', 'leech', TODAY, 30, 'again'),
      review('l2', 'leech', TODAY, 25, 'again'),
      review('old', 'leech', TODAY - 60 * DAY, 30, 'again'), // out of range, not counted
    ];
    const s = run(cards, [deck('d')], reviews);
    expect(s.hardest.map((h) => h.id)).toEqual(['leech', 'lowease']); // 'fine' filtered out
    expect(s.hardest[0]).toMatchObject({ lapses: 2, ease: 1.8 }); // reverse ease wins
  });
});

describe('computeStats — added & deck scope', () => {
  it('buckets cards added within range and drops older ones', () => {
    const s = run(
      [card('n1', 'd', { createdAt: TODAY }), card('old', 'd', { createdAt: TODAY - 40 * DAY })],
      [deck('d')],
      [],
    );
    expect(s.added[s.added.length - 1]).toBe(1); // n1 today
    expect(s.added.reduce((a, b) => a + b, 0)).toBe(1); // 'old' excluded
  });

  it("attributes a deleted card's review via the log's own deckId", () => {
    // The card is gone from the collection, so the cardId -> deck map can't help.
    const reviews = [{ ...review('x', 'gone', TODAY, 5, 'good'), deckId: 'd1' }];
    const s = run([card('a', 'd1')], [deck('d1')], reviews);
    expect(s.recallByDeck.get('d1')!.ret).toEqual({ p: 1, t: 1 });
    expect(s.historyByDeck.get('d1')!.at(-1)).toEqual({ nw: 0, rv: 1 });
  });

  it('keeps per-deck history and recall separate', () => {
    const cards = [card('a', 'd1'), card('b', 'd2')];
    const decks = [deck('d1'), deck('d2')];
    const reviews = [review('x', 'a', TODAY, 5, 'good'), review('y', 'b', TODAY, 5, 'again')];
    const s = run(cards, decks, reviews);
    expect(s.recallByDeck.get('d1')!.ret).toEqual({ p: 1, t: 1 });
    expect(s.recallByDeck.get('d2')!.ret).toEqual({ p: 0, t: 1 });
    expect(s.historyByDeck.get('d1')!.at(-1)).toEqual({ nw: 0, rv: 1 });
  });
});
