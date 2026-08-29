import { useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary';
import { logError } from './db/logs';
import { Layout } from './components/Layout';
import { DeckList } from './features/decks/DeckList';
import { DeckEditor } from './features/editor/DeckEditor';
import { Review } from './features/review/Review';
import { Settings } from './features/settings/Settings';
import { AddWord } from './features/add/AddWord';
import { Stats } from './features/stats/Stats';
import { About } from './features/about/About';
import { useStore } from './store/store';
import { ensureInboxDeck } from './db/repo';

/** Shown instead of a blank page when a screen throws. The error is already
 * recorded by the time this renders; the link points at where to read it. */
function Crashed({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div className="empty">
      <h2>Something broke</h2>
      <p className="muted">{error instanceof Error ? error.message : String(error)}</p>
      <p className="muted small">Already recorded — see About → Recent errors for the stack.</p>
      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="btn btn-primary" onClick={resetErrorBoundary}>Try again</button>
        <a className="btn" href="#/about">Diagnostics</a>
      </div>
    </div>
  );
}

export function App() {
  const init = useStore((s) => s.init);
  const syncNow = useStore((s) => s.syncNow);

  useEffect(() => {
    void ensureInboxDeck();
    void init();
  }, [init]);

  const { pathname } = useLocation();

  // Sync when the app regains focus (covers iOS returning to the PWA).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void syncNow();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [syncNow]);

  return (
    <Layout>
      {/* A render throw would otherwise blank the page with nothing recorded.
          Keyed by route so navigating away clears a crashed screen. */}
      <ErrorBoundary
        key={pathname}
        FallbackComponent={Crashed}
        onError={(err, info) => void logError('render', err, { componentStack: info.componentStack })}
      >
      <Routes>
        <Route path="/" element={<DeckList />} />
        <Route path="/add" element={<AddWord />} />
        <Route path="/deck/:id" element={<DeckEditor />} />
        <Route path="/review/:id" element={<Review />} />
        <Route path="/stats" element={<Stats />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/about" element={<About />} />
      </Routes>
      </ErrorBoundary>
    </Layout>
  );
}
