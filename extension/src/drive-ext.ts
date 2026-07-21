// Drive access for the extension: OAuth via the browser identity API (no GIS),
// plus a pending-queue buffer so captures are never lost when offline/unauthed.

import { storageLocal } from './browserApi';
import { DEFAULT_CLIENT_ID, DRIVE_SCOPE, OAUTH_REDIRECT } from './config';
import type { Card, CardSource, Deck, DeckSnapshot } from '@shared/types';
import { INBOX_DECK_ID, INBOX_DECK_NAME, cardSources, cardContexts } from '@shared/types';
import { buildSnapshot, mergeCards } from '@shared/snapshot';
import { dedupKey } from '@shared/dedup';
import {
  listAppFiles,
  findFileByDeckId,
  downloadSnapshot,
  mergeJsonFile,
  createSnapshot,
  type TokenProvider,
} from '@shared/drive';

export interface DeckRef {
  id: string;
  name: string;
}

const INBOX: DeckRef = { id: INBOX_DECK_ID, name: INBOX_DECK_NAME };

let token: string | null = null;
let tokenExp = 0;

const uid = () => crypto.randomUUID();

// Persist the token in storage.local so it survives the MV3 service worker
// being torn down (and browser restarts), mirroring the PWA. There's no refresh
// token for this flow, so it still expires after ~1h and needs a reconnect then.
async function loadToken(): Promise<void> {
  if (token && Date.now() < tokenExp) return;
  const { googleToken } = await storageLocal.get('googleToken');
  const saved = googleToken as { token: string; exp: number } | null | undefined;
  if (saved && Date.now() < saved.exp) {
    token = saved.token;
    tokenExp = saved.exp;
  }
}
async function saveToken(): Promise<void> {
  await storageLocal.set({ googleToken: token ? { token, exp: tokenExp } : null });
}

// ---- small storage helpers -------------------------------------------------

export async function getClientId(): Promise<string> {
  const { clientId } = await storageLocal.get('clientId');
  return (clientId as string) || DEFAULT_CLIENT_ID;
}
export async function setClientId(clientId: string): Promise<void> {
  await storageLocal.set({ clientId: clientId.trim() });
}

async function getDeviceId(): Promise<string> {
  const { deviceId } = await storageLocal.get('deviceId');
  if (deviceId) return deviceId as string;
  const id = uid();
  await storageLocal.set({ deviceId: id });
  return id;
}

// The remembered "add words to this deck by default" choice.
export async function getTargetDeck(): Promise<DeckRef> {
  const { targetDeck } = await storageLocal.get('targetDeck');
  return (targetDeck as DeckRef) ?? INBOX;
}
export async function setTargetDeck(deck: DeckRef): Promise<void> {
  await storageLocal.set({ targetDeck: deck });
}

// Cached deck list so the popup can render the picker without a network round-trip.
export async function getDeckCache(): Promise<DeckRef[]> {
  const { deckCache } = await storageLocal.get('deckCache');
  const list = (deckCache as DeckRef[]) ?? [];
  return withInbox(list);
}

function withInbox(list: DeckRef[]): DeckRef[] {
  return list.some((d) => d.id === INBOX_DECK_ID) ? list : [INBOX, ...list];
}

export async function getPending(): Promise<Card[]> {
  const { pending } = await storageLocal.get('pending');
  return (pending as Card[]) ?? [];
}
async function setPending(cards: Card[]): Promise<void> {
  await storageLocal.set({ pending: cards });
}
export async function addPending(card: Card): Promise<number> {
  const pending = await getPending();
  pending.push(card);
  await setPending(pending);
  return pending.length;
}

// ---- duplicate detection ---------------------------------------------------
// The extension has no local card DB, so it keeps a lightweight index of every
// existing card's front + deck name, rebuilt whenever decks are refreshed
// (listRemoteDecks downloads each snapshot anyway). Used to warn, in the bubble,
// that a word is already saved somewhere.

/** An existing card, enough to show its fields in the bubble and update it. */
export interface WordEntry {
  id: string;
  deckId: string;
  deck: string; // deck name
  front: string;
  back: string;
  explanation?: string;
  contexts?: string[];
  sources?: CardSource[];
  rev?: number; // array-merge authority, carried so an update keeps accumulating
}

/** Project a Card into an index entry (normalizing legacy shapes into arrays). */
export function cardEntry(c: Card, deckId: string, deckName: string): WordEntry {
  return {
    id: c.id,
    deckId,
    deck: deckName,
    front: c.front,
    back: c.back,
    explanation: c.explanation,
    contexts: cardContexts(c),
    sources: cardSources(c),
    rev: c.rev,
  };
}

async function getCardIndex(): Promise<WordEntry[]> {
  const { cardIndex } = await storageLocal.get('cardIndex');
  return (cardIndex as WordEntry[]) ?? [];
}

/** Existing entries (synced cards + not-yet-pushed captures) for the same word. */
export async function getWordMatches(front: string): Promise<WordEntry[]> {
  const key = dedupKey(front);
  if (!key) return [];
  const cache = await getDeckCache();
  const nameById = new Map(cache.map((d) => [d.id, d.name]));
  const pending = (await getPending())
    .filter((c) => !c.deleted)
    .map((c) => cardEntry(c, c.deckId, nameById.get(c.deckId) ?? 'pending'));
  const matches = [...pending, ...(await getCardIndex())].filter((e) => dedupKey(e.front) === key);
  // De-dupe by id (a pending capture already pushed and re-indexed).
  const seen = new Set<string>();
  return matches.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
}

// ---- OAuth (tab-based implicit flow) ---------------------------------------
// Interactive sign-in opens the Google URL in a real browser tab (so the
// multi-account chooser works); the redirect page's content script forwards the
// token to the background, which calls storeOAuthToken. getToken itself is
// silent — it only ever returns an already-stored token.

/** Build the Google authorization URL (the background opens it in a tab). */
export async function getAuthUrl(): Promise<string> {
  const clientId = await getClientId();
  if (!clientId) throw new Error('Set your Google OAuth Client ID in the popup first.');
  return (
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    new URLSearchParams({
      client_id: clientId,
      response_type: 'token',
      redirect_uri: OAUTH_REDIRECT,
      scope: DRIVE_SCOPE,
      prompt: 'consent',
    }).toString()
  );
}

/** Store a token captured from the redirect page by the content script. */
export async function storeOAuthToken(accessToken: string, expiresIn: number): Promise<void> {
  token = accessToken;
  tokenExp = Date.now() + (expiresIn - 60) * 1000;
  await saveToken();
}

/** Silent token provider for Drive calls; never opens a window. */
async function getToken(): Promise<string> {
  await loadToken();
  if (token && Date.now() < tokenExp) return token;
  throw new Error('Not connected to Google Drive — open the Stanki popup and click Connect.');
}

export function isConnected(): boolean {
  return !!token && Date.now() < tokenExp;
}

// ---- deck listing ----------------------------------------------------------

/** Fetch the user's decks from Drive (downloads each snapshot for its name). */
export async function listRemoteDecks(): Promise<DeckRef[]> {
  const getTok: TokenProvider = getToken;
  const files = await listAppFiles(getTok);

  // Dedup by deck id — Drive can hold more than one snapshot file per deck
  // (e.g. a sync race created a duplicate), which would otherwise list twice.
  const byId = new Map<string, DeckRef>();
  const index: WordEntry[] = []; // rebuild the duplicate-detection index as we go
  for (const f of files) {
    // Skip non-deck files (e.g. the PWA's reviews.json), which have no `deck`.
    if (!f.appProperties?.deckId) continue;
    const snap = await downloadSnapshot(getTok, f.id);
    if (snap.deck && !snap.deck.deleted) {
      byId.set(snap.deck.id, { id: snap.deck.id, name: snap.deck.name });
      for (const c of snap.cards ?? []) {
        if (!c.deleted && c.front.trim()) index.push(cardEntry(c, snap.deck.id, snap.deck.name));
      }
    }
  }
  const decks = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));

  const list = withInbox(decks);
  await storageLocal.set({ deckCache: list, cardIndex: index });
  return list;
}

// ---- push pending captures to their target deck's Drive snapshot -----------

function newDeck(ref: DeckRef): Deck {
  const now = Date.now();
  return { id: ref.id, name: ref.name, createdAt: now, updatedAt: now };
}

/**
 * Append pending captures to Drive, grouped by their target deck, then clear
 * the queue. Read-modify-write per deck keeps concurrent captures from
 * clobbering each other.
 *
 * Dedupe concurrent calls (the auto-push on capture vs. the popup's Push button)
 * so they share one operation and report the same count, instead of one racing
 * ahead, clearing the queue, and leaving the other to report 0 pushed.
 */
let flushing: Promise<{ pushed: number }> | null = null;
export function flushPending(): Promise<{ pushed: number }> {
  if (!flushing) flushing = doFlush().finally(() => { flushing = null; });
  return flushing;
}

async function doFlush(): Promise<{ pushed: number }> {
  const pending = await getPending();
  if (pending.length === 0) return { pushed: 0 };

  const getTok: TokenProvider = getToken;
  const deviceId = await getDeviceId();

  // Resolve deck names for any decks we may need to create (e.g. Inbox).
  const nameById = new Map<string, string>([[INBOX_DECK_ID, INBOX_DECK_NAME]]);
  for (const d of await getDeckCache()) nameById.set(d.id, d.name);
  const target = await getTargetDeck();
  nameById.set(target.id, target.name);

  // Group captures by target deck.
  const groups = new Map<string, Card[]>();
  for (const card of pending) {
    const g = groups.get(card.deckId) ?? [];
    g.push(card);
    groups.set(card.deckId, g);
  }

  for (const [deckId, cards] of groups) {
    const file = await findFileByDeckId(getTok, deckId);
    if (file) {
      // Read-merge-write under optimistic locking: if a concurrent sync (e.g. the
      // PWA pushing reviews) changed the snapshot between our read and write, we
      // re-download and re-merge instead of clobbering it.
      await mergeJsonFile<DeckSnapshot>(getTok, file.id, (current) => {
        const deck = current.deck ?? newDeck({ id: deckId, name: nameById.get(deckId) ?? deckId });
        return buildSnapshot(deck, mergeCards(current.cards ?? [], cards), deviceId);
      });
    } else {
      const deck = newDeck({ id: deckId, name: nameById.get(deckId) ?? deckId });
      const snapshot = buildSnapshot(deck, mergeCards([], cards), deviceId);
      await createSnapshot(getTok, deckId, `deck-${deckId}.json`, snapshot);
    }
  }

  await setPending([]);
  return { pushed: pending.length };
}
