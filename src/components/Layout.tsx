import type { ClipboardEvent, ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useStore } from '../store/store';

/** Copy as plain text so pasting a word/sentence elsewhere (e.g. Google Docs)
 * doesn't carry the card's fonts, colours, highlights, or spoiler blocks. */
function plainCopy(e: ClipboardEvent) {
  const text = window.getSelection()?.toString();
  if (!text) return;
  e.clipboardData.setData('text/plain', text);
  e.preventDefault();
}

function SyncBadge() {
  const { connected, syncStatus, configured, syncNow } = useStore();
  if (!configured) {
    return <span className="badge badge-muted" title="Set VITE_GOOGLE_CLIENT_ID">offline</span>;
  }
  if (!connected) return <span className="badge badge-muted">not synced</span>;
  const label = syncStatus === 'syncing' ? 'syncing…' : syncStatus === 'error' ? 'sync error' : 'synced';
  const cls = syncStatus === 'error' ? 'badge-error' : 'badge-ok';
  return (
    <button className={`badge ${cls}`} onClick={() => void syncNow()} title="Sync now">
      {label}
    </button>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">📚 Stanki</Link>
        <nav className="nav">
          <Link to="/" className={pathname === '/' ? 'active' : ''}>Decks</Link>
          <Link to="/add" className={pathname === '/add' ? 'active' : ''}>Add</Link>
          <Link to="/stats" className={pathname === '/stats' ? 'active' : ''}>Stats</Link>
          <Link to="/settings" className={pathname === '/settings' ? 'active' : ''}>Settings</Link>
          <Link to="/about" className={pathname === '/about' ? 'active' : ''}>About</Link>
          <SyncBadge />
        </nav>
      </header>
      <main className="content" onCopy={plainCopy}>{children}</main>
    </div>
  );
}
