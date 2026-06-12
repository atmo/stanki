import { describe, it, expect, vi, afterEach } from 'vitest';
import { mergeJsonFile } from './drive';

const token = async () => 'tok';

function jsonRes(body: unknown, init: { status?: number; etag?: string } = {}): Response {
  const headers = new Headers();
  if (init.etag) headers.set('ETag', init.etag);
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

afterEach(() => vi.restoreAllMocks());

describe('mergeJsonFile (optimistic locking)', () => {
  it('sends If-Match with the downloaded ETag and writes the merged result', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonRes({ n: 1 }, { etag: 'v1' })) // download
      .mockResolvedValueOnce(jsonRes({ id: 'f' })); // update OK

    await mergeJsonFile<{ n: number }>(token, 'f', (cur) => ({ n: cur.n + 10 }));

    const [, updateInit] = fetchMock.mock.calls[1];
    const headers = new Headers(updateInit?.headers);
    expect(headers.get('If-Match')).toBe('v1');
    expect(updateInit?.method).toBe('PATCH');
    expect(JSON.parse(updateInit?.body as string)).toEqual({ n: 11 }); // merged onto current
  });

  it('re-downloads and re-merges when the write hits a 412 conflict', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonRes({ n: 1 }, { etag: 'v1' })) // download #1
      .mockResolvedValueOnce(jsonRes({ error: 'conflict' }, { status: 412 })) // update #1 -> 412
      .mockResolvedValueOnce(jsonRes({ n: 5 }, { etag: 'v2' })) // download #2 (someone else wrote 5)
      .mockResolvedValueOnce(jsonRes({ id: 'f' })); // update #2 OK

    await mergeJsonFile<{ n: number }>(token, 'f', (cur) => ({ n: cur.n + 10 }));

    expect(fetchMock).toHaveBeenCalledTimes(4);
    // Second write re-merged onto the *fresh* value (5), not the stale one (1).
    expect(JSON.parse(fetchMock.mock.calls[3][1]?.body as string)).toEqual({ n: 15 });
    const retryHeaders = new Headers(fetchMock.mock.calls[3][1]?.headers);
    expect(retryHeaders.get('If-Match')).toBe('v2');
  });

  it('writes unconditionally when the server returns no ETag', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonRes({ n: 1 })) // download, no ETag
      .mockResolvedValueOnce(jsonRes({ id: 'f' }));

    await mergeJsonFile<{ n: number }>(token, 'f', (cur) => ({ n: cur.n + 10 }));

    const headers = new Headers(fetchMock.mock.calls[1][1]?.headers);
    expect(headers.has('If-Match')).toBe(false);
  });

  it('gives up after the retry budget and propagates the conflict', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) =>
      init?.method === 'PATCH'
        ? jsonRes({ error: 'conflict' }, { status: 412 })
        : jsonRes({ n: 1 }, { etag: 'v1' }),
    );
    await expect(
      mergeJsonFile<{ n: number }>(token, 'f', (cur) => ({ n: cur.n + 1 }), 2),
    ).rejects.toThrow(/412/);
  });
});
