import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import './styles.css';

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
