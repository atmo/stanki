import { runtime, identity } from './browserApi';
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

// Show this extension's OAuth redirect URI so the user can register it.
redirectEl.value = identity.getRedirectURL();
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
    const decks = await listRemoteDecks(true);
    renderDecks(decks, currentTarget?.id ?? decks[0].id);
    setStatus(`Loaded ${decks.length} deck(s).`, 'ok');
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), 'err');
  }
});

// ---- client id + push ------------------------------------------------------

$('saveId').addEventListener('click', async () => {
  await setClientId(clientIdEl.value);
  setStatus('Client ID saved.', 'ok');
});

$('push').addEventListener('click', () => {
  setStatus('Connecting…');
  runtime.sendMessage({ type: 'flush' }, (resp: { ok: boolean; pushed?: number; error?: string }) => {
    if (resp?.ok) {
      setStatus(`Pushed ${resp.pushed ?? 0} card(s) to Drive.`, 'ok');
      void refresh();
    } else {
      setStatus(resp?.error ?? 'Failed', 'err');
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
