import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import { logError } from './db/logs';
import { initDebugConsole } from './debugConsole';
import './styles.css';

// Catch what never reaches a component: uncaught throws, and rejected promises
// from sync, Dexie and fetch. Without these, a failure on a phone leaves nothing
// behind at all — there is no console to have been watching.
window.addEventListener('error', (e) => {
  void logError('window', e.error ?? e.message, { src: e.filename, line: e.lineno });
});
window.addEventListener('unhandledrejection', (e) => {
  void logError('promise', e.reason);
});
void initDebugConsole();

// Web Share Target (Android) does a GET to the start URL with ?text=...; bridge
// that into the hash route the app actually uses (#/add?text=...).
const search = new URLSearchParams(window.location.search);
if (search.has('text') && !window.location.hash.startsWith('#/add')) {
  window.history.replaceState(null, '', `${window.location.pathname}#/add?${search.toString()}`);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* HashRouter keeps SPA routing working on plain static hosts (GitHub Pages). */}
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
