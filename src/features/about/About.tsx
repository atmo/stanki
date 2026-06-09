import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { getLastSync } from '../../db/repo';
import { startOfDay } from '@shared/sm2';

const REPO_URL = 'https://github.com/atmo/stanki';
const commitUrl = (hash: string) => `${REPO_URL}/commit/${hash}`;

function fmtBuild(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function About() {
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
        </dl>
      </section>
    </div>
  );
}
