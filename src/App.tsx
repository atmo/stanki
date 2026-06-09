import { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
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

export function App() {
  const init = useStore((s) => s.init);
  const syncNow = useStore((s) => s.syncNow);

  useEffect(() => {
    void ensureInboxDeck();
    void init();
  }, [init]);

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
      <Routes>
        <Route path="/" element={<DeckList />} />
        <Route path="/add" element={<AddWord />} />
        <Route path="/deck/:id" element={<DeckEditor />} />
        <Route path="/review/:id" element={<Review />} />
        <Route path="/stats" element={<Stats />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/about" element={<About />} />
      </Routes>
    </Layout>
  );
}
