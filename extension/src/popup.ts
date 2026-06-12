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

// ---- sync (one button: sign in if needed, else push + refresh decks) -------

// The background opens sign-in in a real tab (so the multi-account chooser
// works); after you approve, it stores the token, pushes pending cards, refreshes
// the deck list, and closes the tab.
function startSignIn() {
  setStatus('Opening Google sign-in…');
  runtime.sendMessage({ type: 'connect' }, (resp: { ok?: boolean; error?: string }) => {
    if (resp?.ok) {
      setStatus('Finish sign-in in the new tab — your cards sync automatically.', 'ok');
    } else {
      setStatus(resp?.error ?? 'Could not start sign-in', 'err');
    }
  });
}

$('sync').addEventListener('click', () => {
  setStatus('Syncing…');
  // Push pending via the background (it owns the stored token and auto-push
  // de-dupe). If we're not connected yet, fall back to sign-in.
  runtime.sendMessage({ type: 'flush' }, (resp: { ok?: boolean; pushed?: number; error?: string }) => {
    if (!resp?.ok) {
      if ((resp?.error ?? '').includes('Not connected')) startSignIn();
      else setStatus(resp?.error ?? 'Sync failed', 'err');
      return;
    }
    // Connected and pushed — pull the deck list (also rebuilds the duplicate index).
    void (async () => {
      const n = resp.pushed ?? 0;
      try {
        const decks = await listRemoteDecks();
        renderDecks(decks, currentTarget?.id ?? decks[0]?.id ?? '');
        await refresh();
        setStatus(`Synced — ${n > 0 ? `pushed ${n} card(s), ` : ''}${decks.length} deck(s).`, 'ok');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setStatus(`Pushed, but couldn't refresh decks: ${msg}`, 'err');
      }
    })();
  });
});

// ---- client id (one-time setup) --------------------------------------------

$('saveId').addEventListener('click', async () => {
  await setClientId(clientIdEl.value);
  setStatus('Client ID saved.', 'ok');
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
