import { describe, it, expect } from 'vitest';
import { effectiveSettings, deferToTomorrow, scheduleState, directionSchedule, schedule, newCardState, previewIntervals, selectDue, itemsForCard, startOfLocalDay, fuzzSchedule, DEFAULT_SETTINGS, type ReviewItem } from './sm2';
import type { Card, Grade, SrSettings } from './types';

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

function makeCard(): Card {
  return {
    id: 'c1',
    deckId: 'd1',
    front: 'q',
    back: 'a',
    createdAt: NOW,
    updatedAt: NOW,
    ...newCardState(NOW),
  };
}

function run(seq: Grade[]): Card {
  let card = makeCard();
  for (const g of seq) card = schedule(card, g, NOW);
  return card;
}

describe('schedule', () => {
  it('first Good -> 1 day', () => {
    const c = run(['good']);
    expect(c.repetitions).toBe(1);
    expect(c.interval).toBe(1);
    expect(c.dueDate).toBe(startOfLocalDay(NOW + 1 * DAY)); // due at local midnight
  });

  it('day-scheduled reviews are due at local midnight', () => {
    const due = new Date(run(['good']).dueDate);
    expect([due.getHours(), due.getMinutes(), due.getSeconds()]).toEqual([0, 0, 0]);
  });

  it('second Good -> 4 days', () => {
    expect(run(['good', 'good']).interval).toBe(4);
  });

  it('third Good -> interval * ease (10 days)', () => {
    const c = run(['good', 'good', 'good']);
    expect(c.easeFactor).toBeCloseTo(2.5, 5); // q=4 leaves ease unchanged
    expect(c.interval).toBe(10); // 4 * 2.5
  });

  it('Again resets reps, drops ease, schedules minutes out', () => {
    const c = run(['good', 'good', 'again']);
    expect(c.repetitions).toBe(0);
    expect(c.interval).toBeCloseTo(DEFAULT_SETTINGS.againInterval / 1440, 9); // minutes -> days
    expect(c.dueDate).toBe(NOW + DEFAULT_SETTINGS.againInterval * 60_000);
    expect(c.easeFactor).toBeCloseTo(2.3, 5);
  });

  it('Easy raises ease and graduates a new card to the easy first interval', () => {
    const c = run(['easy']);
    expect(c.easeFactor).toBeCloseTo(2.6, 5);
    expect(c.repetitions).toBe(1);
    expect(c.interval).toBe(DEFAULT_SETTINGS.easyFirstInterval);
  });

  it('Good and Easy differ on a new card', () => {
    expect(run(['good']).interval).toBe(1);
    expect(run(['easy']).interval).toBe(DEFAULT_SETTINGS.easyFirstInterval);
  });

  it('Again while learning keeps ease (no thrash) and resets reps', () => {
    const c = run(['again', 'again', 'again']);
    expect(c.easeFactor).toBe(DEFAULT_SETTINGS.startingEase);
    expect(c.repetitions).toBe(0);
  });

  it('Good after Again graduates to at least the next day', () => {
    const c = run(['again', 'good']);
    expect(c.interval).toBe(1);
    expect(c.dueDate).toBe(startOfLocalDay(NOW + 1 * DAY));
  });

  it('a mature lapse lowers ease but never below 1.3', () => {
    const c = run(['good', 'good', 'again']); // interval 4 before the lapse
    expect(c.easeFactor).toBeLessThan(DEFAULT_SETTINGS.startingEase);
    expect(c.easeFactor).toBeGreaterThanOrEqual(1.3);
  });

  it('Hard nudges the interval instead of taking the full ease step', () => {
    const good = run(['good', 'good', 'good']); // 1 -> 4 -> 10 (4 * 2.5)
    const hard = run(['good', 'good', 'hard']); // 1 -> 4 -> 5  (4 * 1.2)
    expect(good.interval).toBe(10);
    expect(hard.interval).toBe(5);
    expect(hard.interval).toBeGreaterThan(4); // still moves forward — it was recalled
  });

  it('Hard lowers ease, so repeated struggle slows the card by itself', () => {
    expect(run(['good', 'hard']).easeFactor).toBeCloseTo(2.36, 2); // q=3 -> -0.14
    expect(run(['good', 'hard', 'hard']).easeFactor).toBeCloseTo(2.22, 2);
    expect(run(['good', 'good']).easeFactor).toBeCloseTo(2.5, 5); // Good leaves it be
  });

  it('Hard never lands below a day, from a new or a relearning card', () => {
    expect(run(['hard']).interval).toBe(1); // new card graduates
    expect(run(['good', 'again', 'hard']).interval).toBe(1); // sub-day relearning step
  });

  it('Hard counts as a pass: it advances repetitions rather than resetting them', () => {
    const c = run(['good', 'hard']);
    expect(c.repetitions).toBe(2);
    expect(run(['good', 'again']).repetitions).toBe(0); // unlike Again
  });

  it('previewIntervals orders the four grades', () => {
    const p = previewIntervals(run(['good', 'good']));
    expect(p.again).toBeLessThan(p.hard);
    expect(p.hard).toBeLessThan(p.good);
    expect(p.good).toBeLessThanOrEqual(p.easy);
  });

  it('does not mutate the input card', () => {
    const card = makeCard();
    const snapshot = { ...card };
    schedule(card, 'good', NOW);
    expect(card).toEqual(snapshot);
  });
});

describe('selectDue (daily limits)', () => {
  const item = (id: string, interval: number, dueDate: number): ReviewItem => ({
    card: {
      id, deckId: 'd', front: '', back: '', interval, easeFactor: 2.5,
      repetitions: 0, dueDate, createdAt: 0, updatedAt: 0,
    },
    direction: 'forward',
    schedule: { interval, easeFactor: 2.5, repetitions: 0, dueDate },
  });
  const settings = { ...DEFAULT_SETTINGS, newCardsPerDay: 2, maxReviewsPerDay: 3 };
  const at = 10 * DAY;

  it('caps new and review items separately, and excludes not-yet-due', () => {
    const items = [
      item('n1', 0, 0), item('n2', 0, 0), item('n3', 0, 0), // 3 new, due
      item('r1', 5, 0), item('r2', 5, 0), item('r3', 5, 0), item('r4', 5, 0), // 4 review, due
      item('future', 0, at + 2 * DAY), // due in 2 days — not today
    ];
    const q = selectDue(items, { newToday: 0, reviewsToday: 0 }, settings, at);
    expect(q.filter((x) => x.schedule.interval === 0)).toHaveLength(2); // newCardsPerDay
    expect(q.filter((x) => x.schedule.interval > 0)).toHaveLength(3); // maxReviewsPerDay
    expect(q.some((x) => x.card.id === 'future')).toBe(false);
  });

  it('subtracts items already done today', () => {
    const items = [item('n1', 0, 0), item('n2', 0, 0), item('r1', 5, 0), item('r2', 5, 0)];
    const q = selectDue(items, { newToday: 1, reviewsToday: 2 }, settings, at);
    expect(q.filter((x) => x.schedule.interval === 0)).toHaveLength(1); // 2 - 1
    expect(q.filter((x) => x.schedule.interval > 0)).toHaveLength(1); // 3 - 2
  });

  it('orders reviews before new items', () => {
    const q = selectDue([item('n', 0, 0), item('r', 5, 0)], { newToday: 0, reviewsToday: 0 }, settings, at);
    expect(q[0].schedule.interval).toBeGreaterThan(0);
    expect(q[1].schedule.interval).toBe(0);
  });

  it('buries siblings: only one direction of a card per session', () => {
    const fwd = { ...item('c', 0, 0), direction: 'forward' as const };
    const rev = { ...item('c', 0, 0), direction: 'reverse' as const };
    expect(selectDue([fwd, rev], { newToday: 0, reviewsToday: 0 }, settings, at)).toHaveLength(1);
  });

  it('bury prefers the due review over introducing the card’s other side', () => {
    const fwdReview = { ...item('c', 5, 0), direction: 'forward' as const }; // reviewed, due
    const revNew = { ...item('c', 0, 0), direction: 'reverse' as const }; // new side
    const q = selectDue([fwdReview, revNew], { newToday: 0, reviewsToday: 0 }, settings, at);
    expect(q).toHaveLength(1);
    expect(q[0].schedule.interval).toBeGreaterThan(0); // the review, not the new sibling
  });
});

describe('itemsForCard (review directions)', () => {
  const card: Card = {
    id: 'c', deckId: 'd', front: 'hond', back: 'dog',
    interval: 3, easeFactor: 2.5, repetitions: 2, dueDate: 100,
    createdAt: 50, updatedAt: 50,
  };

  it('forward yields one item using the inline schedule', () => {
    const items = itemsForCard(card, 'forward');
    expect(items).toHaveLength(1);
    expect(items[0].direction).toBe('forward');
    expect(items[0].schedule.interval).toBe(3);
  });

  it('reverse with no reverse schedule yields a new item due at creation', () => {
    const items = itemsForCard(card, 'reverse');
    expect(items).toHaveLength(1);
    expect(items[0].direction).toBe('reverse');
    expect(items[0].schedule.interval).toBe(0); // new
    expect(items[0].schedule.dueDate).toBe(card.createdAt);
  });

  it('both yields a forward and a reverse item', () => {
    const items = itemsForCard({ ...card, reverse: { interval: 6, easeFactor: 2.5, repetitions: 2, dueDate: 200 } }, 'both');
    expect(items.map((i) => i.direction)).toEqual(['forward', 'reverse']);
    expect(items[1].schedule.interval).toBe(6); // uses the stored reverse schedule
  });

  it('skips deleted cards', () => {
    expect(itemsForCard({ ...card, deleted: true }, 'both')).toHaveLength(0);
  });
});

describe('previewIntervals', () => {
  it('returns an interval for every grade', () => {
    const c = run(['good', 'good']); // interval 4, reps 2
    const p = previewIntervals(c);
    expect(p.again).toBeCloseTo(DEFAULT_SETTINGS.againInterval / 1440, 9); // 1 minute, in days
    expect(p.good).toBe(10); // round(4 * 2.5)
    expect(p.easy).toBeGreaterThanOrEqual(p.good);
  });
});

describe('fuzzSchedule', () => {
  const sched = (interval: number) => ({ interval, easeFactor: 2.5, repetitions: 3, dueDate: 0 });
  // rand() in [0,1) maps to a spread of [-1,+1]: 0 = shortest, 0.5 = unchanged, ~1 = longest.
  const LOW = () => 0;
  const MID = () => 0.5;
  const HIGH = () => 0.999;

  it('leaves learning steps and 1-day intervals alone (no room to spread)', () => {
    expect(fuzzSchedule(sched(1 / 1440), NOW, LOW)).toEqual(sched(1 / 1440)); // "Again"
    expect(fuzzSchedule(sched(1), NOW, HIGH).interval).toBe(1);
  });

  it('spreads a long interval by at most ±15%', () => {
    expect(fuzzSchedule(sched(100), NOW, LOW).interval).toBe(85);
    expect(fuzzSchedule(sched(100), NOW, MID).interval).toBe(100); // midpoint = unchanged
    expect(fuzzSchedule(sched(100), NOW, HIGH).interval).toBe(115);
  });

  it('still moves short intervals, where 15% would round to nothing', () => {
    expect(fuzzSchedule(sched(4), NOW, LOW).interval).toBe(3); // at least a day either way
    expect(fuzzSchedule(sched(4), NOW, HIGH).interval).toBe(5);
  });

  it('never schedules below a day, however unlucky the draw', () => {
    expect(fuzzSchedule(sched(2), NOW, LOW).interval).toBe(1);
  });

  it('moves dueDate to match the fuzzed interval, at local midnight', () => {
    const f = fuzzSchedule(sched(100), NOW, HIGH);
    expect(f.dueDate).toBe(startOfLocalDay(NOW + 115 * DAY));
  });

  it('leaves the rest of the schedule untouched', () => {
    const f = fuzzSchedule(sched(50), NOW, HIGH);
    expect([f.easeFactor, f.repetitions]).toEqual([2.5, 3]);
  });

  it('stays within bounds across many random draws', () => {
    for (let i = 0; i < 500; i++) {
      const { interval } = fuzzSchedule(sched(20), NOW); // real Math.random
      expect(interval).toBeGreaterThanOrEqual(17);
      expect(interval).toBeLessThanOrEqual(23);
    }
  });
});

describe('effectiveSettings', () => {
  it('applies a deck override on top of the global set', () => {
    const eff = effectiveSettings({ settings: { maxReviewsPerDay: 200 } }, DEFAULT_SETTINGS);
    expect(eff.maxReviewsPerDay).toBe(200);
    expect(eff.startingEase).toBe(DEFAULT_SETTINGS.startingEase);
  });

  it('fills in keys a stored set predates', () => {
    // What a deck saved before hardMultiplier/leechThreshold existed looks like.
    // The type claims a complete SrSettings, so only resolving through here keeps
    // callers from reading undefined off it — which is exactly what crashed the
    // deck editor when it rendered deck.settings directly.
    const stale = { startingEase: 2, easyBonus: 1.3, easyFirstInterval: 4, againInterval: 1,
                    newCardsPerDay: 20, maxReviewsPerDay: 50 } as unknown as SrSettings;
    const eff = effectiveSettings({ settings: stale }, DEFAULT_SETTINGS);
    expect(eff.startingEase).toBe(2); // the override survives
    expect(eff.hardMultiplier).toBe(DEFAULT_SETTINGS.hardMultiplier); // the gap is filled
    expect(eff.leechThreshold).toBe(DEFAULT_SETTINGS.leechThreshold);
  });

  it('falls back to the global set when a deck has no overrides', () => {
    expect(effectiveSettings(undefined, DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(effectiveSettings({}, DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });
});

describe('deferToTomorrow', () => {
  const sched = { interval: 5 / 1440, easeFactor: 2.1, repetitions: 0, dueDate: NOW };

  it('moves the due date to tomorrow and touches nothing else', () => {
    const d = deferToTomorrow(sched, NOW);
    const due = new Date(d.dueDate);
    const today = new Date(NOW);
    expect([due.getHours(), due.getMinutes()]).toEqual([0, 0]);
    expect(due.getDate()).toBe(new Date(NOW + DAY).getDate());
    // Still mid-relearning: recalling it tomorrow is what graduates it.
    expect([d.interval, d.easeFactor, d.repetitions]).toEqual([sched.interval, 2.1, 0]);
    expect(due.getTime()).toBeGreaterThan(today.getTime());
  });

  it('steps a calendar day, so it lands correctly across a month end', () => {
    const lastOfMonth = new Date(2025, 0, 31, 22, 30).getTime(); // 31 Jan, late evening
    const due = new Date(deferToTomorrow(sched, lastOfMonth).dueDate);
    expect([due.getFullYear(), due.getMonth(), due.getDate()]).toEqual([2025, 1, 1]); // 1 Feb
  });

  it('a deferred card still graduates only when it is recalled', () => {
    // repetitions stayed 0, so the next pass takes the graduating branch.
    const passed = schedule({ ...makeCard(), ...deferToTomorrow(sched, NOW) }, 'good', NOW);
    expect(passed.interval).toBe(1);
    expect(passed.repetitions).toBe(1);
  });
});

describe('selectDue — relearning is not charged to the cap', () => {
  const at = 10 * DAY;
  const unit = (id: string, interval: number): ReviewItem => ({
    card: { id, deckId: 'd', front: '', back: '', interval, easeFactor: 2.5,
            repetitions: 0, dueDate: 0, createdAt: 0, updatedAt: 0 },
    direction: 'forward',
    schedule: { interval, easeFactor: 2.5, repetitions: 0, dueDate: 0 },
  });
  const settings = { ...DEFAULT_SETTINGS, newCardsPerDay: 0, maxReviewsPerDay: 2 };

  it('serves part-finished cards even once the allowance is spent', () => {
    const items = [unit('r1', 5), unit('r2', 5), unit('r3', 5), unit('l1', 5 / 1440), unit('l2', 5 / 1440)];
    const q = selectDue(items, { newToday: 0, reviewsToday: 0 }, settings, at);
    expect(q.filter((i) => i.schedule.interval >= 1)).toHaveLength(2); // the cap
    expect(q.filter((i) => i.schedule.interval < 1)).toHaveLength(2); // both, uncapped
  });

  it('still shows them when the allowance is already used up', () => {
    const q = selectDue([unit('r1', 5), unit('l1', 5 / 1440)], { newToday: 0, reviewsToday: 2 }, settings, at);
    expect(q.map((i) => i.card.id)).toEqual(['l1']);
  });
});

describe('heldOver is state, not history', () => {
  const held = { interval: 5 / 1440, easeFactor: 2.3, repetitions: 0, dueDate: NOW, heldOver: true };

  it('survives deferToTomorrow, which only moves the due date', () => {
    expect(deferToTomorrow(held, NOW).heldOver).toBe(true);
  });

  it('reaches review through directionSchedule, which picks fields by hand', () => {
    const card = { ...makeCard(), heldOver: true };
    expect(directionSchedule(card, 'forward').heldOver).toBe(true);
    expect(directionSchedule({ ...card, reverse: held }, 'reverse').heldOver).toBe(true);
  });

  it('is not carried forward by a recall — scheduleState builds a fresh schedule', () => {
    const next = scheduleState(held, 'good', NOW);
    expect(next.interval).toBe(1); // graduated
    expect(next.heldOver).toBeUndefined();
  });
});

describe('selectDue — the capped and uncapped counts attribute siblings alike', () => {
  const at = 10 * DAY;
  // One card, both sides due: forward mid-relearning, reverse a normal review.
  const both = (id: string): ReviewItem[] => [
    { card: { id, deckId: 'd', front: '', back: '', interval: 5 / 1440, easeFactor: 2.5,
              repetitions: 0, dueDate: 0, createdAt: 0, updatedAt: 0 },
      direction: 'forward',
      schedule: { interval: 5 / 1440, easeFactor: 2.5, repetitions: 0, dueDate: 0 } },
    { card: { id, deckId: 'd', front: '', back: '', interval: 5, easeFactor: 2.5,
              repetitions: 3, dueDate: 0, createdAt: 0, updatedAt: 0 },
      direction: 'reverse',
      schedule: { interval: 5, easeFactor: 2.5, repetitions: 3, dueDate: 0 } },
  ];

  it('counts such a card as relearning either way, never as a withheld review', () => {
    const items = [...both('a'), ...both('b')];
    const daily = { newToday: 0, reviewsToday: 0 };
    const capped = selectDue(items, daily, { ...DEFAULT_SETTINGS, maxReviewsPerDay: 1 }, at);
    const uncapped = selectDue(items, daily, { ...DEFAULT_SETTINGS, maxReviewsPerDay: Number.MAX_SAFE_INTEGER }, at);
    const dayScale = (q: ReviewItem[]) => q.filter((i) => i.schedule.interval >= 1).length;

    // Burying picks the relearning side in both passes, so neither counts a
    // day-scale review — the badge's gap stays zero rather than blaming the cap.
    expect(dayScale(uncapped)).toBe(0);
    expect(dayScale(uncapped) - dayScale(capped)).toBe(0);
    expect(uncapped).toHaveLength(2); // both cards served, as relearning
  });

  it('still reports a gap when the cap is what withholds work', () => {
    const rev = (id: string): ReviewItem => ({
      card: { id, deckId: 'd', front: '', back: '', interval: 5, easeFactor: 2.5,
              repetitions: 3, dueDate: 0, createdAt: 0, updatedAt: 0 },
      direction: 'forward',
      schedule: { interval: 5, easeFactor: 2.5, repetitions: 3, dueDate: 0 },
    });
    const items = [rev('a'), rev('b'), rev('c')];
    const daily = { newToday: 0, reviewsToday: 0 };
    const capped = selectDue(items, daily, { ...DEFAULT_SETTINGS, maxReviewsPerDay: 2 }, at);
    const uncapped = selectDue(items, daily, { ...DEFAULT_SETTINGS, maxReviewsPerDay: Number.MAX_SAFE_INTEGER }, at);
    expect(uncapped.length - capped.length).toBe(1);
  });
});
