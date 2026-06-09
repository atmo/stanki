import { db } from './db';
import type { Card, CardDirection, Deck, Grade, ReviewDirection } from '@shared/types';
import { INBOX_DECK_ID, INBOX_DECK_NAME } from '@shared/types';
import {
  scheduleState,
  newCardState,
  selectDue,
  directionSchedule,
  itemsForCard,
  startOfDay,
  DEFAULT_SETTINGS,
  type ReviewItem,
  type SrSettings,
} from '@shared/sm2';

const uid = () => crypto.randomUUID();

// ---- meta / settings -------------------------------------------------------

async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key);
  return row ? (row.value as T) : fallback;
}
async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

export async function getDeviceId(): Promise<string> {
  let id = await getMeta<string | null>('deviceId', null);
  if (!id) {
    id = uid();
    await setMeta('deviceId', id);
  }
  return id;
}

export async function getSettings(): Promise<SrSettings> {
  // Merge with defaults so settings saved before a field existed get its default.
  const stored = await getMeta<Partial<SrSettings>>('srSettings', {});
  return { ...DEFAULT_SETTINGS, ...stored };
}
export const saveSettings = (s: SrSettings) => setMeta('srSettings', s);

export const getLastSync = () => getMeta<number | null>('lastSync', null);
export const setLastSync = (ts: number) => setMeta('lastSync', ts);

// Remembered target deck for the "Add word" screen.
export const getLastAddDeck = () => getMeta<string | null>('lastAddDeckId', null);
export const setLastAddDeck = (id: string) => setMeta('lastAddDeckId', id);

// ---- decks -----------------------------------------------------------------

export function listDecks(): Promise<Deck[]> {
  return db.decks.filter((d) => !d.deleted).toArray();
}

export const getDeck = (id: string) => db.decks.get(id);

export async function createDeck(name: string): Promise<Deck> {
  const now = Date.now();
  const deck: Deck = { id: uid(), name: name.trim() || 'Untitled', createdAt: now, updatedAt: now };
  await db.decks.put(deck);
  return deck;
}

export async function renameDeck(id: string, name: string): Promise<void> {
  await db.decks.update(id, { name: name.trim(), updatedAt: Date.now() });
}

export async function setReviewDirection(id: string, direction: ReviewDirection): Promise<void> {
  await db.decks.update(id, { reviewDirection: direction, updatedAt: Date.now() });
}

/** Soft-delete a deck and all its cards (tombstones, so the delete syncs). */
export async function deleteDeck(id: string): Promise<void> {
  const now = Date.now();
  await db.transaction('rw', db.decks, db.cards, async () => {
    await db.decks.update(id, { deleted: true, updatedAt: now });
    const cards = await db.cards.where('deckId').equals(id).toArray();
    await db.cards.bulkPut(cards.map((c) => ({ ...c, deleted: true, updatedAt: now })));
  });
}

/** Ensure the special Inbox deck exists (shared with the extension). */
export async function ensureInboxDeck(): Promise<Deck> {
  const existing = await db.decks.get(INBOX_DECK_ID);
  if (existing && !existing.deleted) return existing;
  const now = Date.now();
  const deck: Deck = {
    id: INBOX_DECK_ID,
    name: INBOX_DECK_NAME,
    createdAt: now,
    updatedAt: existing?.updatedAt ?? now,
  };
  await db.decks.put(deck);
  return deck;
}

// ---- cards -----------------------------------------------------------------

export function listCards(deckId: string): Promise<Card[]> {
  return db.cards.where('deckId').equals(deckId).filter((c) => !c.deleted).toArray();
}

export async function dueCards(deckId: string, now = Date.now()): Promise<Card[]> {
  const cards = await db.cards.where('deckId').equals(deckId).toArray();
  return cards
    .filter((c) => !c.deleted && c.dueDate <= now)
    .sort((a, b) => a.dueDate - b.dueDate);
}

export async function dueCount(deckId: string, now = Date.now()): Promise<number> {
  return (await dueCards(deckId, now)).length;
}

/** Today's new-card introductions and review count for a deck. */
export async function dailyCounts(deckId: string, now = Date.now()) {
  const [cards, reviews] = await Promise.all([
    db.cards.where('deckId').equals(deckId).primaryKeys() as Promise<string[]>,
    db.reviews.where('ts').aboveOrEqual(startOfDay(now)).toArray(),
  ]);
  const ids = new Set(cards);
  let newToday = 0;
  let reviewsToday = 0;
  for (const r of reviews) {
    if (!ids.has(r.cardId)) continue;
    if (r.prevInterval === 0) newToday++;
    else reviewsToday++;
  }
  return { newToday, reviewsToday };
}

/** The review queue for a deck: due items capped by the per-day limits. */
export async function reviewQueue(
  deckId: string,
  settings: SrSettings,
  now = Date.now(),
): Promise<ReviewItem[]> {
  const [deck, cards, daily] = await Promise.all([
    db.decks.get(deckId),
    db.cards.where('deckId').equals(deckId).toArray(),
    dailyCounts(deckId, now),
  ]);
  const direction = deck?.reviewDirection ?? 'forward';
  const items = cards.flatMap((c) => itemsForCard(c, direction, settings));
  return selectDue(items, daily, settings, now);
}

export interface NewCardInput {
  deckId: string;
  front: string;
  back: string;
  context?: string;
  explanation?: string;
  source?: Card['source'];
}

export async function createCard(input: NewCardInput): Promise<Card> {
  const now = Date.now();
  const card: Card = {
    id: uid(),
    deckId: input.deckId,
    front: input.front,
    back: input.back,
    context: input.context,
    explanation: input.explanation,
    source: input.source,
    createdAt: now,
    updatedAt: now,
    ...newCardState(now),
  };
  await db.cards.put(card);
  return card;
}

export async function updateCard(
  id: string,
  patch: Partial<Pick<Card, 'front' | 'back' | 'context' | 'explanation'>>,
): Promise<void> {
  await db.cards.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deleteCard(id: string): Promise<void> {
  await db.cards.update(id, { deleted: true, updatedAt: Date.now() });
}

/** Move cards to another deck (bumps updatedAt so the move syncs). */
export async function moveCards(ids: string[], toDeckId: string): Promise<void> {
  if (!ids.length) return;
  await db.cards.where('id').anyOf(ids).modify({ deckId: toDeckId, updatedAt: Date.now() });
}

/** Soft-delete several cards at once. */
export async function deleteCards(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await db.cards.where('id').anyOf(ids).modify({ deleted: true, updatedAt: Date.now() });
}

export interface GradeResult {
  card: Card; // the updated card
  reviewId: string; // id of the logged review (for undo)
}

/** Apply a review grade to one direction of a card: reschedule, persist, log it. */
export async function gradeCard(
  card: Card,
  direction: CardDirection,
  grade: Grade,
): Promise<GradeResult> {
  const settings = await getSettings();
  const now = Date.now();
  const prev = directionSchedule(card, direction, settings);
  const next = scheduleState(prev, grade, now, settings);
  const patch: Partial<Card> =
    direction === 'forward' ? { ...next, updatedAt: now } : { reverse: next, updatedAt: now };
  const reviewId = uid();
  await db.transaction('rw', db.cards, db.reviews, async () => {
    await db.cards.update(card.id, patch);
    await db.reviews.put({
      id: reviewId,
      cardId: card.id,
      ts: now,
      grade,
      prevInterval: prev.interval,
      newInterval: next.interval,
      direction,
    });
  });
  return { card: { ...card, ...patch }, reviewId };
}

/** Reverse a grade: restore the card's prior state and drop its review-log entry. */
export async function undoGrade(priorCard: Card, reviewId: string): Promise<void> {
  await db.transaction('rw', db.cards, db.reviews, async () => {
    await db.cards.put(priorCard);
    await db.reviews.delete(reviewId);
  });
}

// ---- export / import (offline sync fallback) ------------------------------

export interface ExportBundle {
  app: 'stanki';
  schemaVersion: 1;
  exportedAt: number;
  decks: Deck[];
  cards: Card[];
}

export async function exportAll(): Promise<ExportBundle> {
  const [decks, cards] = await Promise.all([db.decks.toArray(), db.cards.toArray()]);
  return { app: 'stanki', schemaVersion: 1, exportedAt: Date.now(), decks, cards };
}

export async function importBundle(bundle: ExportBundle): Promise<void> {
  if (bundle.app !== 'stanki') throw new Error('Not a Stanki export file');
  await db.transaction('rw', db.decks, db.cards, async () => {
    await db.decks.bulkPut(bundle.decks);
    await db.cards.bulkPut(bundle.cards);
  });
}
