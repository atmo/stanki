// Thin Google Drive REST v3 wrappers, scoped to the hidden `appDataFolder`.
// Shared by the PWA and the extension. Network only — no app logic here.
// A token provider is injected so each host (browser GIS vs. extension identity)
// can supply access tokens its own way.

import type { DeckSnapshot } from './types';

export type TokenProvider = () => Promise<string>;

const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
  appProperties?: Record<string, string>;
}

async function authHeader(getToken: TokenProvider): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await getToken()}` };
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new DriveError(res.status, `Drive ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

export class DriveError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'DriveError';
  }
}

/** List all snapshot files this app has stored in appDataFolder. */
export async function listAppFiles(getToken: TokenProvider): Promise<DriveFile[]> {
  const params = new URLSearchParams({
    spaces: 'appDataFolder',
    fields: 'files(id,name,modifiedTime,appProperties)',
    pageSize: '1000',
  });
  const res = await fetch(`${FILES}?${params}`, { headers: await authHeader(getToken) });
  const data = await asJson<{ files: DriveFile[] }>(res);
  return data.files ?? [];
}

export async function findFileByDeckId(
  getToken: TokenProvider,
  deckId: string,
): Promise<DriveFile | undefined> {
  const files = await listAppFiles(getToken);
  return files.find((f) => f.appProperties?.deckId === deckId);
}

export async function downloadSnapshot(
  getToken: TokenProvider,
  fileId: string,
): Promise<DeckSnapshot> {
  const res = await fetch(`${FILES}/${fileId}?alt=media`, {
    headers: await authHeader(getToken),
  });
  return asJson<DeckSnapshot>(res);
}

function multipartBody(metadata: object, snapshot: DeckSnapshot, boundary: string): string {
  return [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(snapshot),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

/** Create a new snapshot file in appDataFolder, tagged with its deckId. */
export async function createSnapshot(
  getToken: TokenProvider,
  deckId: string,
  name: string,
  snapshot: DeckSnapshot,
): Promise<DriveFile> {
  const boundary = `stanki-${Math.random().toString(36).slice(2)}`;
  const metadata = {
    name,
    parents: ['appDataFolder'],
    appProperties: { deckId },
  };
  const res = await fetch(`${UPLOAD}?uploadType=multipart&fields=id,name,modifiedTime,appProperties`, {
    method: 'POST',
    headers: {
      ...(await authHeader(getToken)),
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody(metadata, snapshot, boundary),
  });
  return asJson<DriveFile>(res);
}

/** Overwrite an existing snapshot file's contents. */
export async function updateSnapshot(
  getToken: TokenProvider,
  fileId: string,
  snapshot: DeckSnapshot,
): Promise<DriveFile> {
  const res = await fetch(
    `${UPLOAD}/${fileId}?uploadType=media&fields=id,name,modifiedTime,appProperties`,
    {
      method: 'PATCH',
      headers: {
        ...(await authHeader(getToken)),
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify(snapshot),
    },
  );
  return asJson<DriveFile>(res);
}

/** Create or overwrite the snapshot for a deck in one call. */
export async function upsertSnapshot(
  getToken: TokenProvider,
  deckId: string,
  name: string,
  snapshot: DeckSnapshot,
): Promise<DriveFile> {
  const existing = await findFileByDeckId(getToken, deckId);
  return existing
    ? updateSnapshot(getToken, existing.id, snapshot)
    : createSnapshot(getToken, deckId, name, snapshot);
}
