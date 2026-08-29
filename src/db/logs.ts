// Error log: a short local history so a failure that happened on a phone, or
// overnight, is still readable afterwards. Deliberately local-only — it is not
// synced, because which device produced an error is half the diagnosis.
import { db } from './db';
import type { LogEntry } from '@shared/types';

export const LOG_TTL_MS = 7 * 86_400_000; // keep a week
const LOG_MAX = 500; // guard against a burst of distinct errors
const DEDUP_MS = 10_000; // a loop throwing should not evict the interesting entry

const errMsg = (e: unknown): string =>
  e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e);

async function prune(now: number): Promise<void> {
  await db.logs.where('ts').below(now - LOG_TTL_MS).delete();
  const count = await db.logs.count();
  if (count > LOG_MAX) {
    const oldest = await db.logs.orderBy('ts').limit(count - LOG_MAX).primaryKeys();
    await db.logs.bulkDelete(oldest as string[]);
  }
}

/**
 * Record an error, and mirror it to the console for anyone who has one open.
 * Never throws: a logger that can fail turns one bug into two, and this runs
 * from the global handlers where there is nothing left to catch it.
 */
export async function logError(
  scope: string,
  err: unknown,
  context?: Record<string, unknown>,
): Promise<void> {
  const message = errMsg(err);
  console.error(`[Stanki:${scope}]`, err, context ?? '');
  try {
    const now = Date.now();
    const recent = await db.logs.where('ts').above(now - DEDUP_MS).toArray();
    const same = recent.find((l) => l.scope === scope && l.message === message);
    if (same) {
      await db.logs.update(same.id, { count: (same.count ?? 1) + 1, ts: now });
      return;
    }
    await db.logs.put({
      id: crypto.randomUUID(),
      ts: now,
      scope,
      message,
      stack: err instanceof Error ? err.stack?.slice(0, 2000) : undefined,
      context: { route: location.hash || '/', online: navigator.onLine, ...context },
    });
    await prune(now);
  } catch {
    // Storage unavailable (private mode, quota). The console line above still ran.
  }
}

/** Recent errors, newest first. */
export const listLogs = (): Promise<LogEntry[]> => db.logs.orderBy('ts').reverse().toArray();
export const clearLogs = (): Promise<void> => db.logs.clear();
