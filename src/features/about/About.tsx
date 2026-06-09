const REPO_URL = 'https://github.com/atmo/stanki';
const commitUrl = (hash: string) => `${REPO_URL}/commit/${hash}`;

function fmtBuild(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function About() {
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
    </div>
  );
}
