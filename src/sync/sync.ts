// Sync orchestration: reconcile every deck against Google Drive.
//
// Cards are merged GLOBALLY by id (last-write-wins + tombstones), then
// partitioned back into per-deck snapshots. Merging globally (rather than
// per-deck) is what makes moving a card between decks correct: the moved card
// has one canonical record whose newer deckId wins, so it lands in exactly one
// deck instead of being duplicated or resurrected in its old deck.

import { db } from '../db/db';
import { getDeviceId, setLastSync } from '../db/repo';
import {
  buildSnapshot,
  mergeCards,
  mergeDeck,
  gcTombstones,
  mergeReviews,
  gcReviews,
} from '@shared/snapshot';
import {
  listAppFiles,
  downloadSnapshot,
  downloadJson,
  updateSnapshot,
  createSnapshot,
  updateFile,
  createFile,
  deleteFile,
  type DriveFile,
  type TokenProvider,
} from '@shared/drive';
import type { Card, Deck, ReviewLog, ReviewSnapshot } from '@shared/types';
import { INBOX_DECK_ID, INBOX_DECK_NAME, SCHEMA_VERSION } from '@shared/types';

// appProperties tag identifying the single shared review-log file.
const REVIEWS_KIND = 'reviews';

// Rolling backups: a full decks+cards snapshot kept in separate files, written
// only when the content changed since the last one, keeping the newest few.
const BACKUP_KIND = 'backup';
const MAX_BACKUPS = 5;

/** Stable SHA-256 of the decks+cards content, for change detection. */
async function contentHash(decks: Deck[], cards: Card[]): Promise<string> {
  const byId = <T extends { id: string }>(a: T[]) => [...a].sort((x, y) => (x.id < y.id ? -1 : 1));
  const json = JSON.stringify({ decks: byId(decks), cards: byId(cards) });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Write a backup file if the data changed since the last one; keep MAX_BACKUPS. */
async function maybeBackup(
  getToken: TokenProvider,
  files: DriveFile[],
  decks: Deck[],
  cards: Card[],
): Promise<void> {
  if (cards.length === 0) return; // never back up (and rotate out) an empty state
  const hash = await contentHash(decks, cards);
  const backups = files
    .filter((f) => f.appProperties?.kind === BACKUP_KIND)
    .sort((a, b) => (a.modifiedTime < b.modifiedTime ? 1 : -1)); // newest first
  if (backups[0]?.appProperties?.hash === hash) return; // unchanged since last backup

  const bundle = { app: 'stanki', schemaVersion: SCHEMA_VERSION, exportedAt: Date.now(), decks, cards };
  await createFile(getToken, `backup-${new Date().toISOString()}.json`, { kind: BACKUP_KIND, hash }, bundle);
  // Keep the newest MAX_BACKUPS (the new one + MAX_BACKUPS-1 existing); drop the rest.
  for (const f of backups.slice(MAX_BACKUPS - 1)) await deleteFile(getToken, f.id);
}

function synthDeck(id: string): Deck {
  const now = Date.now();
  return { id, name: id === INBOX_DECK_ID ? INBOX_DECK_NAME : id, createdAt: now, updatedAt: now };
}

export async function syncAll(getToken: TokenProvider): Promise<void> {
  const deviceId = await getDeviceId();

  // --- pull every remote snapshot ---------------------------------------
  const files = await listAppFiles(getToken);
  const fileByDeck = new Map<string, DriveFile>();
  const remoteDecks = new Map<string, Deck>();
  let remoteCards: Card[] = [];
  for (const f of files) {
    const id = f.appProperties?.deckId;
    if (!id) continue;
    fileByDeck.set(id, f);
    const snap = await downloadSnapshot(getToken, f.id);
    remoteDecks.set(id, snap.deck);
    remoteCards = remoteCards.concat(snap.cards);
  }

  // --- pull the shared review log ---------------------------------------
  // A first-sync race can create more than one reviews file (each device makes
  // its own before seeing the other's). Union them ALL on read, sorted by id so
  // every device agrees which one is canonical, then collapse to that one below.
  const reviewsFiles = files
    .filter((f) => f.appProperties?.kind === REVIEWS_KIND)
    .sort((a, b) => a.id.localeCompare(b.id));
  let remoteReviews: ReviewLog[] = [];
  for (const f of reviewsFiles) {
    const snap = await downloadJson<ReviewSnapshot>(getToken, f.id);
    remoteReviews = mergeReviews(remoteReviews, snap.reviews ?? []);
  }

  // --- local snapshot ----------------------------------------------------
  const localDecks = await db.decks.toArray();
  const localCards = await db.cards.toArray();
  const localReviews = await db.reviews.toArray();
  const localDeckById = new Map(localDecks.map((d) => [d.id, d]));

  // --- merge cards globally by id, and deck metadata per id --------------
  const mergedCards = gcTombstones(mergeCards(localCards, remoteCards));

  const deckIds = new Set<string>([
    ...localDecks.map((d) => d.id),
    ...remoteDecks.keys(),
    ...mergedCards.map((c) => c.deckId),
  ]);
  const mergedDecks = new Map<string, Deck>();
  for (const id of deckIds) {
    const l = localDeckById.get(id);
    const r = remoteDecks.get(id);
    mergedDecks.set(id, l || r ? mergeDeck(l, r) : synthDeck(id));
  }

  // --- merge the review log (immutable union by id) ---------------------
  const localReviewIds = new Set(localReviews.map((r) => r.id));
  const newReviews = remoteReviews.filter((r) => !localReviewIds.has(r.id));

  // --- persist the merged result locally --------------------------------
  const mergedIds = new Set(mergedCards.map((c) => c.id));
  const dropIds = localCards.map((c) => c.id).filter((id) => !mergedIds.has(id));
  await db.transaction('rw', db.decks, db.cards, db.reviews, async () => {
    if (dropIds.length) await db.cards.bulkDelete(dropIds);
    await db.cards.bulkPut(mergedCards);
    await db.decks.bulkPut([...mergedDecks.values()]);
    if (newReviews.length) await db.reviews.bulkPut(newReviews);
  });

  // --- partition cards by deck and push each snapshot -------------------
  const cardsByDeck = new Map<string, Card[]>();
  for (const id of mergedDecks.keys()) cardsByDeck.set(id, []);
  for (const c of mergedCards) {
    const arr = cardsByDeck.get(c.deckId);
    if (arr) arr.push(c);
    else cardsByDeck.set(c.deckId, [c]);
  }

  // Sequential to keep Drive request volume low and avoid 429s.
  for (const [id, deck] of mergedDecks) {
    const snapshot = buildSnapshot(deck, cardsByDeck.get(id) ?? [], deviceId);
    const file = fileByDeck.get(id);
    if (file) await updateSnapshot(getToken, file.id, snapshot);
    else await createSnapshot(getToken, id, `deck-${id}.json`, snapshot);
  }

  // --- push the shared review log (trimmed to the rolling window) -------
  const now = Date.now();
  const recentReviews = gcReviews(mergeReviews(localReviews, remoteReviews), now);
  const reviewSnapshot: ReviewSnapshot = {
    schemaVersion: SCHEMA_VERSION,
    reviews: recentReviews,
    exportedAt: now,
    deviceId,
  };
  const canonical = reviewsFiles[0];
  if (canonical) await updateFile(getToken, canonical.id, reviewSnapshot);
  else await createFile(getToken, 'reviews.json', { kind: REVIEWS_KIND }, reviewSnapshot);
  // Collapse any duplicate reviews files into the canonical one.
  for (const f of reviewsFiles.slice(1)) await deleteFile(getToken, f.id);

  // Best-effort rolling backup of the merged data (never fails the sync).
  try {
    await maybeBackup(getToken, files, [...mergedDecks.values()], mergedCards);
  } catch (e) {
    console.warn('[Stanki] backup failed', e);
  }

  await setLastSync(now);
}
