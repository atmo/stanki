// Drive access for the extension: OAuth via the browser identity API (no GIS),
// plus a pending-queue buffer so captures are never lost when offline/unauthed.

import { storageLocal } from './browserApi';
import { DEFAULT_CLIENT_ID, DRIVE_SCOPE, OAUTH_REDIRECT } from './config';
import type { Card, Deck, DeckSnapshot } from '@shared/types';
import { INBOX_DECK_ID, INBOX_DECK_NAME } from '@shared/types';
import { buildSnapshot, mergeCards } from '@shared/snapshot';
import {
  listAppFiles,
  findFileByDeckId,
  downloadSnapshot,
  updateSnapshot,
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

  const decks: DeckRef[] = [];
  for (const f of files) {
    const snap = await downloadSnapshot(getTok, f.id);
    if (!snap.deck.deleted) decks.push({ id: snap.deck.id, name: snap.deck.name });
  }
  decks.sort((a, b) => a.name.localeCompare(b.name));

  const list = withInbox(decks);
  await storageLocal.set({ deckCache: list });
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
 */
export async function flushPending(): Promise<{ pushed: number }> {
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
    const current: DeckSnapshot | undefined = file
      ? await downloadSnapshot(getTok, file.id)
      : undefined;

    const deck = current?.deck ?? newDeck({ id: deckId, name: nameById.get(deckId) ?? deckId });
    const merged = mergeCards(current?.cards ?? [], cards);
    const snapshot = buildSnapshot(deck, merged, deviceId);

    if (file) await updateSnapshot(getTok, file.id, snapshot);
    else await createSnapshot(getTok, deckId, `deck-${deckId}.json`, snapshot);
  }

  await setPending([]);
  return { pushed: pending.length };
}
