// Thin Google Drive REST v3 wrappers, scoped to the hidden `appDataFolder`.
// Shared by the PWA and the extension. Network only — no app logic here.
// A token provider is injected so each host (browser GIS vs. extension identity)
// can supply access tokens its own way.

import type { DeckSnapshot } from './types';

export type AppProperties = Record<string, string>;

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

/** Download and parse any appDataFolder JSON file. */
export async function downloadJson<T>(getToken: TokenProvider, fileId: string): Promise<T> {
  return (await downloadJsonWithTag<T>(getToken, fileId)).data;
}

/** Like downloadJson, but also returns the content ETag for optimistic locking. */
export async function downloadJsonWithTag<T>(
  getToken: TokenProvider,
  fileId: string,
): Promise<{ data: T; etag: string | null }> {
  const res = await fetch(`${FILES}/${fileId}?alt=media`, {
    headers: await authHeader(getToken),
  });
  const etag = res.headers.get('ETag');
  return { data: await asJson<T>(res), etag };
}

export const downloadSnapshot = (getToken: TokenProvider, fileId: string) =>
  downloadJson<DeckSnapshot>(getToken, fileId);

function multipartBody(metadata: object, body: object, boundary: string): string {
  return [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(body),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

/** Create a new appDataFolder JSON file with the given appProperties tag. */
export async function createFile(
  getToken: TokenProvider,
  name: string,
  appProperties: AppProperties,
  body: object,
): Promise<DriveFile> {
  const boundary = `stanki-${Math.random().toString(36).slice(2)}`;
  const metadata = { name, parents: ['appDataFolder'], appProperties };
  const res = await fetch(`${UPLOAD}?uploadType=multipart&fields=id,name,modifiedTime,appProperties`, {
    method: 'POST',
    headers: {
      ...(await authHeader(getToken)),
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody(metadata, body, boundary),
  });
  return asJson<DriveFile>(res);
}

/**
 * Overwrite an existing appDataFolder file's contents. With `ifMatch`, the write
 * is conditional on the file still having that ETag — the server rejects it with
 * 412 if another writer changed the file first (optimistic locking).
 */
export async function updateFile(
  getToken: TokenProvider,
  fileId: string,
  body: object,
  ifMatch?: string,
): Promise<DriveFile> {
  const headers: Record<string, string> = {
    ...(await authHeader(getToken)),
    'Content-Type': 'application/json; charset=UTF-8',
  };
  if (ifMatch) headers['If-Match'] = ifMatch;
  const res = await fetch(
    `${UPLOAD}/${fileId}?uploadType=media&fields=id,name,modifiedTime,appProperties`,
    { method: 'PATCH', headers, body: JSON.stringify(body) },
  );
  return asJson<DriveFile>(res);
}

/** Create a new snapshot file in appDataFolder, tagged with its deckId. */
export const createSnapshot = (
  getToken: TokenProvider,
  deckId: string,
  name: string,
  snapshot: DeckSnapshot,
) => createFile(getToken, name, { deckId }, snapshot);

/** Overwrite an existing snapshot file's contents. */
export const updateSnapshot = (getToken: TokenProvider, fileId: string, snapshot: DeckSnapshot) =>
  updateFile(getToken, fileId, snapshot);

/**
 * Read-merge-write an appDataFolder JSON file with optimistic locking, so a
 * concurrent writer's changes are never silently clobbered: download the current
 * contents (with their ETag), apply `merge`, and write the result back guarded by
 * If-Match. If another writer changed the file first the server returns 412, so
 * re-download and re-merge, up to `retries` times. When the server returns no
 * ETag the write is unconditional — no regression on backends without precondition
 * support, just no protection.
 */
export async function mergeJsonFile<T extends object>(
  getToken: TokenProvider,
  fileId: string,
  merge: (current: T) => T,
  retries = 4,
): Promise<DriveFile> {
  for (let attempt = 0; ; attempt++) {
    const { data, etag } = await downloadJsonWithTag<T>(getToken, fileId);
    const next = merge(data);
    try {
      return await updateFile(getToken, fileId, next, etag ?? undefined);
    } catch (e) {
      if (e instanceof DriveError && e.status === 412 && attempt < retries) continue;
      throw e;
    }
  }
}

/** Delete an appDataFolder file. A 404 is treated as already-gone. */
export async function deleteFile(getToken: TokenProvider, fileId: string): Promise<void> {
  const res = await fetch(`${FILES}/${fileId}`, {
    method: 'DELETE',
    headers: await authHeader(getToken),
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => '');
    throw new DriveError(res.status, `Drive ${res.status}: ${body.slice(0, 300)}`);
  }
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
