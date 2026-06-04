// Drive access for the extension: OAuth via the browser identity API (no GIS),
// plus a pending-queue buffer so captures are never lost when offline/unauthed.

import { identity, storageLocal } from './browserApi';
import { DEFAULT_CLIENT_ID, DRIVE_SCOPE } from './config';
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

// ---- OAuth (identity.launchWebAuthFlow implicit token flow) ----------------

export async function getToken(interactive: boolean): Promise<string> {
  if (token && Date.now() < tokenExp) return token;

  const clientId = await getClientId();
  if (!clientId) throw new Error('Set your Google OAuth Client ID in the popup first.');

  const redirectUri = identity.getRedirectURL();
  const authUrl =
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    new URLSearchParams({
      client_id: clientId,
      response_type: 'token',
      redirect_uri: redirectUri,
      scope: DRIVE_SCOPE,
      prompt: interactive ? 'consent' : 'none',
    }).toString();

  const redirectResp: string = await identity.launchWebAuthFlow({ url: authUrl, interactive });
  const frag = new URL(redirectResp).hash.slice(1);
  const params = new URLSearchParams(frag);
  const accessToken = params.get('access_token');
  const expiresIn = Number(params.get('expires_in') ?? '0');
  if (!accessToken) throw new Error(params.get('error') ?? 'No access token returned');

  token = accessToken;
  tokenExp = Date.now() + (expiresIn - 60) * 1000;
  return token;
}

export function isConnected(): boolean {
  return !!token && Date.now() < tokenExp;
}

// ---- deck listing ----------------------------------------------------------

/** Fetch the user's decks from Drive (downloads each snapshot for its name). */
export async function listRemoteDecks(interactive: boolean): Promise<DeckRef[]> {
  const getTok: TokenProvider = () => getToken(interactive);
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
export async function flushPending(interactive: boolean): Promise<{ pushed: number }> {
  const pending = await getPending();
  if (pending.length === 0) return { pushed: 0 };

  const getTok: TokenProvider = () => getToken(interactive);
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
