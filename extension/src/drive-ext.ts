// Drive access for the extension: OAuth via the browser identity API (no GIS),
// plus a pending-queue buffer so captures are never lost when offline/unauthed.

import { identity, storageLocal } from './browserApi';
import { DEFAULT_CLIENT_ID, DRIVE_SCOPE } from './config';
import type { Card, Deck, DeckSnapshot } from '@shared/types';
import { INBOX_DECK_ID, INBOX_DECK_NAME } from '@shared/types';
import { buildSnapshot, mergeCards } from '@shared/snapshot';
import {
  findFileByDeckId,
  downloadSnapshot,
  updateSnapshot,
  createSnapshot,
  type TokenProvider,
} from '@shared/drive';

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

// ---- push pending captures to the Drive "Inbox" snapshot -------------------

function inboxDeck(): Deck {
  const now = Date.now();
  return { id: INBOX_DECK_ID, name: INBOX_DECK_NAME, createdAt: now, updatedAt: now };
}

/**
 * Append all pending captures to the Drive Inbox snapshot, then clear the queue.
 * Read-modify-write keeps concurrent captures from clobbering each other.
 */
export async function flushPending(interactive: boolean): Promise<{ pushed: number }> {
  const pending = await getPending();
  if (pending.length === 0) return { pushed: 0 };

  const getTok: TokenProvider = () => getToken(interactive);
  const deviceId = await getDeviceId();

  const file = await findFileByDeckId(getTok, INBOX_DECK_ID);
  const current: DeckSnapshot | undefined = file
    ? await downloadSnapshot(getTok, file.id)
    : undefined;

  const deck = current?.deck ?? inboxDeck();
  const cards = mergeCards(current?.cards ?? [], pending);
  const snapshot = buildSnapshot(deck, cards, deviceId);

  if (file) await updateSnapshot(getTok, file.id, snapshot);
  else await createSnapshot(getTok, INBOX_DECK_ID, `deck-${INBOX_DECK_ID}.json`, snapshot);

  await setPending([]);
  return { pushed: pending.length };
}
