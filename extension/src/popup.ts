import { runtime } from './browserApi';
import { getClientId, setClientId, getPending } from './drive-ext';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const countEl = $('count');
const statusEl = $('status');
const clientIdEl = $<HTMLInputElement>('clientId');

function setStatus(text: string, kind: '' | 'ok' | 'err' = '') {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
}

async function refresh() {
  countEl.textContent = String((await getPending()).length);
  clientIdEl.value = await getClientId();
}

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

void refresh();
