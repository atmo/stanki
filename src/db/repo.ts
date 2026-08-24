import { db } from './db';
import type { Card, CardDirection, Deck, Grade, ReviewDirection, ReviewLog } from '@shared/types';
import { INBOX_DECK_ID, INBOX_DECK_NAME, cardContexts } from '@shared/types';
import { dedupKey } from '@shared/dedup';
import {
  scheduleState,
  newCardState,
  selectDue,
  directionSchedule,
  itemsForCard,
  startOfDay,
  endOfLocalDay,
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

/** A deck's effective settings: its own overrides if present, else the global set. */
export function effectiveSettings(deck: Pick<Deck, 'settings'> | undefined, global: SrSettings): SrSettings {
  return { ...global, ...(deck?.settings ?? {}) };
}

export async function getDeckSettings(deckId: string): Promise<SrSettings> {
  const [global, deck] = await Promise.all([getSettings(), db.decks.get(deckId)]);
  return effectiveSettings(deck, global);
}

/** Set (or clear, with undefined) a deck's scheduling/limit overrides. */
export async function setDeckSettings(id: string, settings: SrSettings | undefined): Promise<void> {
  await db.decks.update(id, { settings, updatedAt: Date.now() });
}

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

export async function setDeckDescription(id: string, description: string): Promise<void> {
  await db.decks.update(id, { description: description.trim() || undefined, updatedAt: Date.now() });
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

/** In-place Fisher-Yates shuffle. */
function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * The review queue for a deck: due items capped by the per-day limits, with due
 * reviews and new cards interleaved in random order.
 *
 * `overLimit` builds an extra, reviews-only queue that ignores the per-day
 * review cap (all due reviews) and introduces no new cards — for studying past
 * the daily limit without exceeding the new-card cap.
 */
export async function reviewQueue(
  deckId: string,
  settings: SrSettings,
  now = Date.now(),
  overLimit = false,
): Promise<ReviewItem[]> {
  const [deck, cards, daily] = await Promise.all([
    db.decks.get(deckId),
    db.cards.where('deckId').equals(deckId).toArray(),
    dailyCounts(deckId, now),
  ]);
  const direction = deck?.reviewDirection ?? 'forward';
  const eff = effectiveSettings(deck, settings); // per-deck overrides win
  const items = cards.flatMap((c) => itemsForCard(c, direction, eff));
  if (overLimit) {
    const cutoff = endOfLocalDay(now);
    const seen = new Set<string>(); // bury siblings here too (one direction per card)
    const due = items.filter((i) => {
      if (i.card.deleted || i.schedule.interval === 0 || i.schedule.dueDate >= cutoff) return false;
      if (seen.has(i.card.id)) return false;
      seen.add(i.card.id);
      return true;
    });
    return shuffle(due);
  }
  return shuffle(selectDue(items, daily, eff, now));
}

export interface NewCardInput {
  deckId: string;
  front: string;
  back: string;
  explanation?: string;
  contexts?: Card['contexts'];
}

export async function createCard(input: NewCardInput): Promise<Card> {
  const now = Date.now();
  const settings = await getDeckSettings(input.deckId); // per-deck starting ease
  const card: Card = {
    id: uid(),
    deckId: input.deckId,
    front: input.front,
    back: input.back,
    explanation: input.explanation,
    contexts: input.contexts?.length ? input.contexts : undefined,
    createdAt: now,
    updatedAt: now,
    ...newCardState(now, settings),
  };
  await db.cards.put(card);
  return card;
}

export async function updateCard(
  id: string,
  patch: Partial<Pick<Card, 'front' | 'back' | 'explanation' | 'contexts'>>,
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

/** Answer timing measured by the review UI. */
export interface ReviewTiming {
  thinkMs?: number; // shown -> revealed
  durationMs?: number; // shown -> graded
}

// A card left on screen (tab in the background, interrupted session) would log
// a meaningless duration, so clamp before storing rather than skew time stats.
const MAX_ANSWER_MS = 120_000;
const capMs = (ms: number | undefined): number | undefined =>
  ms == null || !Number.isFinite(ms) || ms < 0 ? undefined : Math.min(Math.round(ms), MAX_ANSWER_MS);

/** Apply a review grade to one direction of a card: reschedule, persist, log it. */
export async function gradeCard(
  card: Card,
  direction: CardDirection,
  grade: Grade,
  timing?: ReviewTiming,
): Promise<GradeResult> {
  const settings = await getDeckSettings(card.deckId);
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
      // Snapshot the pre-review state: it can't be reconstructed later once the
      // card moves on, and it's what retention-by-interval/ease and lateness
      // analysis need.
      deckId: card.deckId,
      prevDue: prev.dueDate,
      prevEase: prev.easeFactor,
      reps: prev.repetitions,
      thinkMs: capMs(timing?.thinkMs),
      durationMs: capMs(timing?.durationMs),
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
  // Study history. Optional: files written before reviews were exported have
  // none, and a single-deck share (exportDeck) omits them because importDeck
  // regenerates card ids, which would orphan every log entry.
  reviews?: ReviewLog[];
}

export async function exportAll(): Promise<ExportBundle> {
  const [decks, cards, reviews] = await Promise.all([
    db.decks.toArray(),
    db.cards.toArray(),
    db.reviews.toArray(),
  ]);
  return { app: 'stanki', schemaVersion: 1, exportedAt: Date.now(), decks, cards, reviews };
}

export async function importBundle(bundle: ExportBundle): Promise<void> {
  if (bundle.app !== 'stanki') throw new Error('Not a Stanki export file');
  // Import is authoritative: bump updatedAt (wins last-write-wins) and rev (its
  // examples/sources replace, not union, so a corrected file isn't resurrected).
  const now = Date.now();
  const decks = bundle.decks.map((d) => ({ ...d, updatedAt: now }));
  const cards = bundle.cards.map((c) => ({ ...c, updatedAt: now, rev: now }));
  // Reviews are immutable and keyed by id, so restoring them *adds* history
  // rather than replacing it — study done since the file was written is kept.
  const reviews = bundle.reviews ?? [];
  await db.transaction('rw', db.decks, db.cards, db.reviews, async () => {
    await db.decks.bulkPut(decks);
    await db.cards.bulkPut(cards);
    if (reviews.length) await db.reviews.bulkPut(reviews);
  });
}

// ---- single-deck export / import (share a deck as JSON) --------------------

/** Export one deck and its (non-deleted) cards as a portable bundle. */
export async function exportDeck(deckId: string): Promise<ExportBundle> {
  const deck = await db.decks.get(deckId);
  if (!deck) throw new Error('Deck not found');
  const cards = await db.cards.where('deckId').equals(deckId).filter((c) => !c.deleted).toArray();
  return { app: 'stanki', schemaVersion: 1, exportedAt: Date.now(), decks: [deck], cards };
}

export interface ImportResult {
  deck: Deck;
  added: number; // new cards written
  skipped: number; // words already present in the target deck
  merged: boolean; // true = merged into an existing same-named deck
}

/**
 * Import a deck bundle. If a deck with the same name already exists, merge into
 * it — adding only words not already present (matched article-insensitively) and
 * leaving every existing card's study progress untouched. Otherwise create a new
 * deck. Newly added cards start as "new" (unstudied).
 */
export async function importDeck(bundle: ExportBundle): Promise<ImportResult> {
  if (bundle?.app !== 'stanki') throw new Error('Not a Stanki deck file.');
  const src = bundle.decks?.[0];
  const name = src?.name?.trim();
  if (!src || !name) throw new Error('This file has no deck to import.');

  const now = Date.now();
  const decks = await db.decks.filter((d) => !d.deleted).toArray();
  const existing = decks.find((d) => d.name.trim().toLowerCase() === name.toLowerCase());
  const deck: Deck =
    existing ?? {
      id: uid(),
      name,
      reviewDirection: src.reviewDirection, // carry one-sided/both setting from the file
      description: src.description,
      createdAt: now,
      updatedAt: now,
    };

  // Words already in the target deck — skip these so existing progress is kept.
  const have = new Set<string>();
  if (existing) {
    const current = await db.cards.where('deckId').equals(existing.id).filter((c) => !c.deleted).toArray();
    for (const c of current) have.add(dedupKey(c.front));
  }

  // A single-deck export holds just this deck's cards; be lenient about deckId.
  const single = (bundle.decks?.length ?? 0) === 1;
  const incoming = (bundle.cards ?? []).filter((c) => !c.deleted && (single || c.deckId === src.id));

  const toAdd: Card[] = [];
  for (const c of incoming) {
    const key = dedupKey(c.front);
    if (have.has(key)) continue; // already present (or a dup within the file)
    have.add(key);
    toAdd.push({
      id: uid(),
      deckId: deck.id,
      front: c.front,
      back: c.back,
      contexts: cardContexts(c).length ? cardContexts(c) : undefined,
      explanation: c.explanation,
      createdAt: now,
      updatedAt: now,
      ...newCardState(now), // new cards start unstudied
    });
  }

  await db.transaction('rw', db.decks, db.cards, async () => {
    if (!existing) await db.decks.put(deck);
    if (toAdd.length) await db.cards.bulkPut(toAdd);
  });
  return { deck, added: toAdd.length, skipped: incoming.length - toAdd.length, merged: !!existing };
}
