// Sync orchestration: reconcile every local deck against its Drive snapshot.
// Pull remote -> merge (LWW + tombstones) -> write local -> push merged result.

import { db } from '../db/db';
import { getDeviceId, setLastSync } from '../db/repo';
import { buildSnapshot, mergeSnapshot } from '@shared/snapshot';
import {
  listAppFiles,
  downloadSnapshot,
  updateSnapshot,
  createSnapshot,
  type DriveFile,
  type TokenProvider,
} from '@shared/drive';
import type { Card } from '@shared/types';

async function syncOneDeck(
  getToken: TokenProvider,
  deckId: string,
  remoteFile: DriveFile | undefined,
  deviceId: string,
): Promise<void> {
  const [localDeck, localCards] = await Promise.all([
    db.decks.get(deckId),
    db.cards.where('deckId').equals(deckId).toArray(),
  ]);

  const remote = remoteFile ? await downloadSnapshot(getToken, remoteFile.id) : undefined;
  const merged = mergeSnapshot(localDeck, localCards, remote);

  // Persist the merged result locally (replacing this deck's cards).
  await db.transaction('rw', db.decks, db.cards, async () => {
    await db.decks.put(merged.deck);
    const staleIds = localCards
      .filter((c) => !merged.cards.some((m: Card) => m.id === c.id))
      .map((c) => c.id);
    if (staleIds.length) await db.cards.bulkDelete(staleIds);
    await db.cards.bulkPut(merged.cards);
  });

  // Push the merged snapshot back to Drive.
  const snapshot = buildSnapshot(merged.deck, merged.cards, deviceId);
  if (remoteFile) {
    await updateSnapshot(getToken, remoteFile.id, snapshot);
  } else {
    await createSnapshot(getToken, deckId, `deck-${deckId}.json`, snapshot);
  }
}

/** Reconcile all decks (local + remote) with Google Drive. */
export async function syncAll(getToken: TokenProvider): Promise<void> {
  const deviceId = await getDeviceId();

  const remoteFiles = await listAppFiles(getToken);
  const remoteByDeck = new Map<string, DriveFile>();
  for (const f of remoteFiles) {
    const id = f.appProperties?.deckId;
    if (id) remoteByDeck.set(id, f);
  }

  const localDecks = await db.decks.toArray();
  const deckIds = new Set<string>([
    ...localDecks.map((d) => d.id),
    ...remoteByDeck.keys(),
  ]);

  // Sequential to keep Drive request volume low and avoid 429s.
  for (const deckId of deckIds) {
    await syncOneDeck(getToken, deckId, remoteByDeck.get(deckId), deviceId);
  }

  await setLastSync(Date.now());
}
