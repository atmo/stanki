import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { getLastSync } from '../../db/repo';
import { startOfDay } from '@shared/sm2';
import { listAppFiles, downloadJson } from '@shared/drive';
import { getToken } from '../../sync/googleAuth';
import { useStore } from '../../store/store';
import type { ReviewSnapshot } from '@shared/types';

const REPO_URL = 'https://github.com/atmo/stanki';
const commitUrl = (hash: string) => `${REPO_URL}/commit/${hash}`;

function fmtBuild(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function About() {
  const connected = useStore((s) => s.connected);
  const [report, setReport] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const stats = useLiveQuery(async () => {
    const reviews = await db.reviews.where('ts').aboveOrEqual(startOfDay()).toArray();
    let newToday = 0;
    let reviewsToday = 0;
    for (const r of reviews) {
      if (r.prevInterval === 0) newToday++;
      else reviewsToday++;
    }
    return { newToday, reviewsToday, total: reviews.length, lastSync: await getLastSync() };
  }, []);

  async function inspect() {
    setBusy(true);
    setReport('Reading Drive…');
    try {
      const files = await listAppFiles(getToken);
      const reviewsFiles = files.filter((f) => f.appProperties?.kind === 'reviews');
      const deckFiles = files.filter((f) => f.appProperties?.deckId);
      const lines: string[] = [
        `${files.length} files total — ${deckFiles.length} deck, ${reviewsFiles.length} reviews`,
      ];
      const start = startOfDay();
      for (const f of reviewsFiles) {
        const snap = await downloadJson<ReviewSnapshot>(getToken, f.id);
        const all = snap.reviews ?? [];
        const today = all.filter((r) => r.ts >= start).length;
        lines.push(`reviews ${f.id.slice(0, 6)}…: ${all.length} entries, ${today} today (dev ${(snap.deviceId ?? '?').slice(0, 6)})`);
      }
      if (!reviewsFiles.length) lines.push('No reviews file on Drive yet.');
      setReport(lines.join('\n'));
    } catch (e) {
      setReport(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings">
      <section className="panel">
        <h2>About Stanki</h2>
        <p className="muted">Spaced-repetition flashcards with Google Drive sync. Local-first, no backend.</p>
        <dl className="about-list">
          <dt>Version</dt>
          <dd>
            <a href={commitUrl(__COMMIT_HASH__)} target="_blank" rel="noreferrer">
              <code>{__COMMIT_HASH__}</code> ↗
            </a>
          </dd>
          <dt>Built</dt>
          <dd>{fmtBuild(__BUILD_TIME__)}</dd>
        </dl>
        <p>
          <a href={REPO_URL} target="_blank" rel="noreferrer">Source on GitHub ↗</a>
        </p>
      </section>

      <section className="panel">
        <h2>Diagnostics (this device)</h2>
        <p className="muted small">
          Counts come from the local review log. Compare across devices to check that the daily
          limits are converging via sync.
        </p>
        <dl className="about-list">
          <dt>Reviews today</dt>
          <dd>
            {stats ? `${stats.newToday} new · ${stats.reviewsToday} review (${stats.total} total)` : '…'}
          </dd>
          <dt>Last sync</dt>
          <dd>{stats ? (stats.lastSync ? new Date(stats.lastSync).toLocaleString() : 'never') : '…'}</dd>
          <dt>Device clock</dt>
          <dd>{new Date().toString()}</dd>
        </dl>
        {connected && (
          <>
            <button className="btn" onClick={() => void inspect()} disabled={busy}>
              {busy ? 'Reading…' : 'Inspect Drive review log'}
            </button>
            {report && <pre className="diag-report">{report}</pre>}
          </>
        )}
      </section>
    </div>
  );
}
