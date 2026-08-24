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
  mergeJsonFile,
  createSnapshot,
  createFile,
  deleteFile,
  type DriveFile,
  type TokenProvider,
} from '@shared/drive';
import type { Card, Deck, DeckSnapshot, ReviewLog, ReviewSnapshot } from '@shared/types';
import { INBOX_DECK_ID, INBOX_DECK_NAME, SCHEMA_VERSION } from '@shared/types';

// appProperties tag identifying the single shared review-log file.
const REVIEWS_KIND = 'reviews';

// Rolling backups: a full decks+cards snapshot kept in separate files, written
// only when the content changed since the last one, keeping the newest few.
const BACKUP_KIND = 'backup';
const MAX_BACKUPS = 5;
// Don't write a fresh backup more than once per this interval, even if the data
// changed — a full decks+cards dump every sync is the main sync-time cost.
const BACKUP_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

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
  reviews: ReviewLog[],
): Promise<void> {
  if (cards.length === 0) return; // never back up (and rotate out) an empty state
  const hash = await contentHash(decks, cards);
  const backups = files
    .filter((f) => f.appProperties?.kind === BACKUP_KIND)
    .sort((a, b) => (a.modifiedTime < b.modifiedTime ? 1 : -1)); // newest first
  if (backups[0]?.appProperties?.hash === hash) return; // unchanged since last backup
  // Throttle: skip if the newest backup is still recent (the per-deck snapshots
  // already hold the live data; backups are just rollback points).
  if (backups[0] && Date.now() - new Date(backups[0].modifiedTime).getTime() < BACKUP_MIN_INTERVAL_MS) {
    return;
  }

  // The full local review history rides along — reviews sync only within a
  // 14-day window, so a backup is the only durable copy of older study history.
  // Not part of `hash`: any new review also mutates its card, so the hash moves.
  const bundle = { app: 'stanki', schemaVersion: SCHEMA_VERSION, exportedAt: Date.now(), decks, cards, reviews };
  await createFile(
    getToken,
    `backup-${new Date().toISOString()}.json`,
    { kind: BACKUP_KIND, hash, cards: String(cards.length) },
    bundle,
  );
  // Keep the newest MAX_BACKUPS (the new one + MAX_BACKUPS-1 existing); drop the rest.
  for (const f of backups.slice(MAX_BACKUPS - 1)) await deleteFile(getToken, f.id);
}

export interface BackupRef {
  id: string;
  at: string; // ISO modified time
  cards: number;
}

/** The available backups, newest first. */
export async function listBackups(getToken: TokenProvider): Promise<BackupRef[]> {
  const files = await listAppFiles(getToken);
  return files
    .filter((f) => f.appProperties?.kind === BACKUP_KIND)
    .sort((a, b) => (a.modifiedTime < b.modifiedTime ? 1 : -1))
    .map((f) => ({ id: f.id, at: f.modifiedTime, cards: Number(f.appProperties?.cards ?? 0) }));
}

/** A backup's raw contents, for saving to a file. */
export async function fetchBackup(getToken: TokenProvider, fileId: string): Promise<unknown> {
  return downloadJson<unknown>(getToken, fileId);
}

/**
 * Restore a backup: overwrite local decks+cards with the snapshot's versions
 * (cards added since the backup are kept). Bumps updatedAt so the restore wins
 * the next sync and propagates to other devices. Caller should sync afterwards.
 */
export async function restoreBackup(getToken: TokenProvider, fileId: string): Promise<void> {
  const bundle = await downloadJson<{ decks: Deck[]; cards: Card[]; reviews?: ReviewLog[] }>(getToken, fileId);
  const now = Date.now();
  const decks = (bundle.decks ?? []).map((d) => ({ ...d, updatedAt: now }));
  // Authoritative: bump rev so the snapshot's arrays replace (not union) on sync.
  const cards = (bundle.cards ?? []).map((c) => ({ ...c, updatedAt: now, rev: now }));
  // Reviews are immutable and id-keyed, so this restores lost history without
  // discarding study done since the backup was taken.
  const reviews = bundle.reviews ?? [];
  await db.transaction('rw', db.decks, db.cards, db.reviews, async () => {
    await db.decks.bulkPut(decks);
    await db.cards.bulkPut(cards);
    if (reviews.length) await db.reviews.bulkPut(reviews);
  });
}

function synthDeck(id: string): Deck {
  const now = Date.now();
  return { id, name: id === INBOX_DECK_ID ? INBOX_DECK_NAME : id, createdAt: now, updatedAt: now };
}

/**
 * Order-independent content signature for a deck and its cards. Equal signatures
 * mean the push would be a no-op, so it can be skipped. `updatedAt` changes on
 * any edit or review and the id set changes on add/delete, so any real change
 * shows up here.
 */
function deckSig(deck: Deck | undefined, cards: Card[]): string {
  const cs = cards
    .map((c) => `${c.id}:${c.updatedAt}:${c.deleted ? 1 : 0}`)
    .sort()
    .join(',');
  return `${deck?.updatedAt ?? 0}:${deck?.deleted ? 1 : 0}|${cs}`;
}

export async function syncAll(getToken: TokenProvider): Promise<void> {
  const deviceId = await getDeviceId();

  // --- pull every remote snapshot (concurrently) ------------------------
  const files = await listAppFiles(getToken);
  const fileByDeck = new Map<string, DriveFile>();
  const remoteDecks = new Map<string, Deck>();
  const remoteByDeck = new Map<string, Card[]>();
  const remoteCards: Card[] = [];
  const deckFiles = files.filter((f) => f.appProperties?.deckId);
  const snaps = await Promise.all(
    deckFiles.map((f) => downloadSnapshot(getToken, f.id).then((snap) => ({ f, snap }))),
  );
  for (const { f, snap } of snaps) {
    const id = f.appProperties!.deckId;
    fileByDeck.set(id, f);
    remoteDecks.set(id, snap.deck);
    remoteByDeck.set(id, snap.cards);
    for (const c of snap.cards) remoteCards.push(c);
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

  // Sequential to keep Drive request volume low and avoid 429s. Each existing
  // snapshot is rewritten under optimistic locking (re-merge against the current
  // Drive copy on conflict), so a concurrent push from another device — the
  // extension adding cards, or another client's reviews — is never clobbered.
  // Decks whose merged content matches what we just pulled are skipped entirely,
  // so unchanged decks (e.g. imported reference decks) aren't re-uploaded.
  for (const [id, deck] of mergedDecks) {
    const file = fileByDeck.get(id);
    const intended = cardsByDeck.get(id) ?? [];
    if (file) {
      if (deckSig(remoteDecks.get(id), remoteByDeck.get(id) ?? []) === deckSig(deck, intended)) {
        continue; // our merge adds nothing to the remote copy — no write needed
      }
      await mergeJsonFile<DeckSnapshot>(getToken, file.id, (current) => {
        const cards = gcTombstones(mergeCards(current.cards ?? [], intended));
        return buildSnapshot(mergeDeck(deck, current.deck), cards, deviceId);
      });
    } else {
      await createSnapshot(getToken, id, `deck-${id}.json`, buildSnapshot(deck, intended, deviceId));
    }
  }

  // --- push the shared review log (trimmed to the rolling window) -------
  const now = Date.now();
  // Keep the untrimmed union for the backup; only the pushed copy is windowed.
  const allReviews = mergeReviews(localReviews, remoteReviews);
  const recentReviews = gcReviews(allReviews, now);
  const canonical = reviewsFiles[0];
  if (canonical) {
    // Re-union with the canonical file's current reviews so a concurrently
    // pushed review isn't dropped by our overwrite.
    await mergeJsonFile<ReviewSnapshot>(getToken, canonical.id, (current) => ({
      schemaVersion: SCHEMA_VERSION,
      reviews: gcReviews(mergeReviews(recentReviews, current.reviews ?? []), now),
      exportedAt: now,
      deviceId,
    }));
  } else {
    const reviewSnapshot: ReviewSnapshot = {
      schemaVersion: SCHEMA_VERSION,
      reviews: recentReviews,
      exportedAt: now,
      deviceId,
    };
    await createFile(getToken, 'reviews.json', { kind: REVIEWS_KIND }, reviewSnapshot);
  }
  // Collapse any duplicate reviews files into the canonical one.
  for (const f of reviewsFiles.slice(1)) await deleteFile(getToken, f.id);

  // Best-effort rolling backup of the merged data (never fails the sync).
  try {
    await maybeBackup(getToken, files, [...mergedDecks.values()], mergedCards, allReviews);
  } catch (e) {
    console.warn('[Stanki] backup failed', e);
  }

  await setLastSync(now);
}
