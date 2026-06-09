import { runtime } from './browserApi';
import { OAUTH_REDIRECT } from './config';
import {
  getClientId,
  setClientId,
  getPending,
  getDeckCache,
  getTargetDeck,
  setTargetDeck,
  listRemoteDecks,
  type DeckRef,
} from './drive-ext';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const countEl = $('count');
const statusEl = $('status');
const clientIdEl = $<HTMLInputElement>('clientId');
const redirectEl = $<HTMLInputElement>('redirect');
const deckEl = $<HTMLSelectElement>('deck');

function setStatus(text: string, kind: '' | 'ok' | 'err' = '') {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
}

// The fixed redirect URI to register on the OAuth client (same for everyone).
redirectEl.value = OAUTH_REDIRECT;
redirectEl.addEventListener('click', () => {
  redirectEl.select();
  void navigator.clipboard?.writeText(redirectEl.value);
  setStatus('Redirect URI copied.', 'ok');
});

// ---- deck picker -----------------------------------------------------------

function renderDecks(decks: DeckRef[], selectedId: string) {
  // Ensure the remembered deck is selectable even if it's not in the cache yet.
  if (!decks.some((d) => d.id === selectedId)) {
    const t = currentTarget;
    if (t && t.id === selectedId) decks = [...decks, t];
  }
  deckEl.innerHTML = '';
  for (const d of decks) {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.name;
    opt.selected = d.id === selectedId;
    deckEl.appendChild(opt);
  }
}

let currentTarget: DeckRef | null = null;

deckEl.addEventListener('change', async () => {
  const id = deckEl.value;
  const name = deckEl.options[deckEl.selectedIndex]?.text ?? id;
  currentTarget = { id, name };
  await setTargetDeck(currentTarget);
  runtime.sendMessage({ type: 'targetChanged' });
  setStatus(`Words will be added to “${name}”.`, 'ok');
});

$('refreshDecks').addEventListener('click', async () => {
  setStatus('Loading decks from Drive…');
  try {
    const decks = await listRemoteDecks();
    renderDecks(decks, currentTarget?.id ?? decks[0].id);
    setStatus(`Loaded ${decks.length} deck(s).`, 'ok');
  } catch {
    setStatus('Connect to Google Drive first (button above), then refresh.', 'err');
  }
});

// ---- client id + connect ---------------------------------------------------

$('saveId').addEventListener('click', async () => {
  await setClientId(clientIdEl.value);
  setStatus('Client ID saved.', 'ok');
});

$('connect').addEventListener('click', () => {
  setStatus('Opening Google sign-in…');
  // The background opens sign-in in a real tab (so the multi-account chooser
  // works); after you approve, it stores the token, pushes pending cards, and
  // closes the tab.
  runtime.sendMessage({ type: 'connect' }, (resp: { ok?: boolean; error?: string }) => {
    if (resp?.ok) {
      setStatus('Finish sign-in in the new tab — your cards sync automatically.', 'ok');
    } else {
      setStatus(resp?.error ?? 'Could not start sign-in', 'err');
    }
  });
});

$('push').addEventListener('click', () => {
  setStatus('Pushing…');
  // Pushes whatever is pending using the stored token (no sign-in window).
  runtime.sendMessage({ type: 'flush' }, (resp: { ok?: boolean; pushed?: number; error?: string }) => {
    if (resp?.ok) {
      setStatus(`Pushed ${resp.pushed ?? 0} card(s) to Drive.`, 'ok');
      void refresh();
    } else {
      setStatus(resp?.error ?? 'Push failed', 'err');
    }
  });
});

// ---- init ------------------------------------------------------------------

async function refresh() {
  countEl.textContent = String((await getPending()).length);
  clientIdEl.value = await getClientId();
}

async function init() {
  currentTarget = await getTargetDeck();
  renderDecks(await getDeckCache(), currentTarget.id);
  await refresh();
}

void init();
