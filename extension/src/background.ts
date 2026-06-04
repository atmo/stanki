import { contextMenus, scripting, action, runtime } from './browserApi';
import { extract } from '@shared/sentence';
import { newCardState } from '@shared/sm2';
import type { Card } from '@shared/types';
import { addPending, flushPending, getPending, getTargetDeck } from './drive-ext';
import { lookupWord, type Lookups, type Sense } from './lookup';

const ADD_MENU_ID = 'stanki-add-word';
const LOOKUP_MENU_ID = 'stanki-lookup';

/**
 * Runs in the *page* context (serialized by scripting.executeScript), so it
 * must be fully self-contained — only DOM APIs, no imports/closures.
 * Returns the raw selection plus the text of its nearest block ("paragraph").
 */
function grabSelectionInfo() {
  const sel = window.getSelection();
  const selectedText = sel ? sel.toString() : '';
  let blockText = '';

  if (sel && sel.rangeCount > 0) {
    let node: Node | null = sel.getRangeAt(0).commonAncestorContainer;
    if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    const BLOCKS = new Set([
      'P', 'LI', 'DIV', 'TD', 'BLOCKQUOTE', 'ARTICLE', 'SECTION',
      'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DD', 'DT', 'FIGCAPTION', 'MAIN',
    ]);
    let el = node as HTMLElement | null;
    while (el && el.parentElement && !BLOCKS.has(el.tagName)) el = el.parentElement;
    blockText = (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  return { selectedText, blockText, url: location.href, title: document.title };
}

interface BubblePayload {
  word: string;
  context: string;
  url: string;
  title: string;
  loading?: boolean;
  lookups: Lookups;
}

/**
 * Renders both lookup sources (ANW + Wiktionary) as a small Shadow-DOM card
 * anchored to the selected word. Self-contained (serialized into the page);
 * only DOM + chrome messaging. "Add" fills the card back from the Wiktionary
 * (English) gloss.
 */
function renderBubble(payload: BubblePayload) {
  const w = window as unknown as { __stankiBubbleClose?: () => void };
  if (typeof w.__stankiBubbleClose === 'function') w.__stankiBubbleClose();

  const sel = window.getSelection();
  let rect = { left: 16, top: 16, bottom: 16 };
  if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
    const r = sel.getRangeAt(0).getBoundingClientRect();
    if (r && (r.width || r.height)) rect = { left: r.left, top: r.top, bottom: r.bottom };
  }

  const host = document.createElement('div');
  host.id = 'stanki-lookup-host';
  host.style.cssText =
    `position:fixed;z-index:2147483647;left:${rect.left}px;top:${rect.bottom + 8}px;`;
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent =
    ".card{all:initial;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
    'display:block;width:300px;max-height:360px;overflow:auto;background:#0f172a;color:#e2e8f0;' +
    'border:1px solid #334155;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.5);' +
    'padding:12px 14px;font-size:13px;line-height:1.45;box-sizing:border-box;}' +
    '.hd{display:flex;align-items:baseline;gap:8px;margin-bottom:4px;}' +
    '.lemma{font-weight:700;font-size:15px;color:#fff;}' +
    '.x{margin-left:auto;cursor:pointer;color:#94a3b8;font-size:15px;line-height:1;background:none;border:none;}' +
    '.slabel{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#93c5fd;' +
    'font-weight:700;margin:10px 0 3px;}' +
    '.sense{margin:5px 0;}.n{color:#64748b;font-weight:700;margin-right:5px;}' +
    '.ex{color:#94a3b8;font-style:italic;margin-top:2px;}.muted{color:#94a3b8;}' +
    '.add{margin-top:12px;width:100%;padding:7px;border:none;border-radius:8px;' +
    'background:#2563eb;color:#fff;font-size:13px;cursor:pointer;}.add:disabled{opacity:.6;cursor:default;}';
  shadow.appendChild(style);

  const card = document.createElement('div');
  card.className = 'card';
  const { anw, free } = payload.lookups;

  const hd = document.createElement('div');
  hd.className = 'hd';
  const lemma = document.createElement('span');
  lemma.className = 'lemma';
  lemma.textContent = anw?.lemma || free?.lemma || payload.word;
  hd.appendChild(lemma);
  const x = document.createElement('button');
  x.className = 'x';
  x.textContent = '✕';
  hd.appendChild(x);
  card.appendChild(hd);

  const addSection = (label: string, senses: Sense[]) => {
    const lab = document.createElement('div');
    lab.className = 'slabel';
    lab.textContent = label;
    card.appendChild(lab);
    senses.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'sense';
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = (s.sense ? s.sense.replace(/\.0$/, '') : String(i + 1)) + '.';
      row.appendChild(n);
      row.appendChild(document.createTextNode(s.definition));
      if (s.examples && s.examples.length) {
        const ex = document.createElement('div');
        ex.className = 'ex';
        ex.textContent = `„${s.examples[0]}”`;
        row.appendChild(ex);
      }
      card.appendChild(row);
    });
  };

  if (payload.loading) {
    const p = document.createElement('div');
    p.className = 'muted';
    p.textContent = `Looking up “${payload.word}”…`;
    card.appendChild(p);
  } else if (!anw && !free) {
    const p = document.createElement('div');
    p.className = 'muted';
    p.textContent = `No definition found for “${payload.word}”.`;
    card.appendChild(p);
  } else {
    if (anw) addSection('ANW', anw.senses);
    if (free) addSection('Wiktionary (EN)', free.senses);
  }

  if (!payload.loading) {
    const back = free?.senses[0]?.definition ?? ''; // card back = Wiktionary gloss
    const add = document.createElement('button');
    add.className = 'add';
    add.textContent = 'Add to Stanki';
    add.addEventListener('click', () => {
      add.disabled = true;
      add.textContent = 'Adding…';
      chrome.runtime.sendMessage(
        {
          type: 'addFromLookup',
          payload: {
            word: payload.word,
            context: payload.context,
            back,
            url: payload.url,
            title: payload.title,
          },
        },
        (resp: { ok?: boolean } | undefined) => {
          const ok = !!resp?.ok;
          add.textContent = ok ? 'Added ✓' : 'Error — try again';
          if (!ok) add.disabled = false;
        },
      );
    });
    card.appendChild(add);
  }

  shadow.appendChild(card);
  document.body.appendChild(host);

  // Reposition within the viewport now that the size is known.
  const bw = host.offsetWidth;
  const bh = host.offsetHeight;
  let left = rect.left;
  let top = rect.bottom + 8;
  if (top + bh > window.innerHeight - 8) top = Math.max(8, rect.top - bh - 8);
  left = Math.min(Math.max(8, left), window.innerWidth - bw - 8);
  host.style.left = `${left}px`;
  host.style.top = `${top}px`;

  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mousedown', onDown, true);
    window.removeEventListener('resize', close, true);
    host.remove();
    w.__stankiBubbleClose = undefined;
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  const onDown = (e: MouseEvent) => {
    if (!e.composedPath().includes(host)) close();
  };
  x.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('mousedown', onDown, true);
  window.addEventListener('resize', close, true);
  w.__stankiBubbleClose = close;
}

function makeCard(
  deckId: string,
  word: string,
  back: string,
  context: string,
  url: string,
  title: string,
): Card {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    deckId,
    front: word,
    back,
    context,
    source: { url, title, addedAt: now },
    createdAt: now,
    updatedAt: now,
    ...newCardState(now),
  };
}

async function updateBadge(): Promise<void> {
  try {
    const count = (await getPending()).length;
    await action.setBadgeText({ text: count ? String(count) : '' });
    await action.setBadgeBackgroundColor?.({ color: '#2563eb' });
  } catch {
    /* badge is best-effort */
  }
}

async function capture(tabId: number): Promise<void> {
  const [{ result }] = await scripting.executeScript({ target: { tabId }, func: grabSelectionInfo });
  const info = result as ReturnType<typeof grabSelectionInfo>;
  if (!info?.selectedText.trim()) return;

  const { word, context } = extract(info.selectedText, info.blockText || info.selectedText);
  const target = await getTargetDeck();
  await addPending(makeCard(target.id, word, '', context, info.url, info.title));
  await updateBadge();

  // Best-effort silent push; if not yet authorized it stays queued for the popup.
  void flushPending(false).then(updateBadge).catch(() => {});
}

/** Look up the selection and show the result bubble anchored to the word. */
async function lookupAndShow(tabId: number): Promise<void> {
  const [{ result }] = await scripting.executeScript({ target: { tabId }, func: grabSelectionInfo });
  const info = result as ReturnType<typeof grabSelectionInfo>;
  if (!info?.selectedText.trim()) return;

  const { word, context } = extract(info.selectedText, info.blockText || info.selectedText);
  const base = { word, context, url: info.url, title: info.title };

  // Show a loading bubble immediately, then replace it with the results.
  await scripting.executeScript({
    target: { tabId },
    func: renderBubble,
    args: [{ ...base, loading: true, lookups: { anw: null, free: null } }],
  });

  const lookups = await lookupWord(info.selectedText);
  await scripting.executeScript({
    target: { tabId },
    func: renderBubble,
    args: [{ ...base, loading: false, lookups }],
  });
}

// Reflect the remembered target deck in the "add" menu label.
async function updateMenuTitle(): Promise<void> {
  try {
    const target = await getTargetDeck();
    await contextMenus.update(ADD_MENU_ID, { title: `Add “%s” to ${target.name}` });
  } catch {
    /* menu may not exist yet; best-effort */
  }
}

runtime.onInstalled.addListener(async () => {
  contextMenus.create({ id: ADD_MENU_ID, title: 'Add “%s” to Stanki', contexts: ['selection'] });
  contextMenus.create({ id: LOOKUP_MENU_ID, title: 'Look up “%s” (ANW)', contexts: ['selection'] });
  await updateMenuTitle();
  void updateBadge();
});

contextMenus.onClicked.addListener((info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => {
  if (tab?.id == null) return;
  if (info.menuItemId === ADD_MENU_ID) void capture(tab.id);
  else if (info.menuItemId === LOOKUP_MENU_ID) void lookupAndShow(tab.id);
});

interface Msg {
  type?: string;
  payload?: { word: string; context: string; back: string; url: string; title: string };
}

runtime.onMessage.addListener((msg: Msg, _sender: unknown, sendResponse: (r: unknown) => void) => {
  if (msg?.type === 'flush') {
    flushPending(true)
      .then((r) => updateBadge().then(() => sendResponse({ ok: true, ...r })))
      .catch((e: unknown) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    return true; // async response
  }
  if (msg?.type === 'addFromLookup' && msg.payload) {
    const p = msg.payload;
    (async () => {
      const target = await getTargetDeck();
      await addPending(makeCard(target.id, p.word, p.back, p.context, p.url, p.title));
      await updateBadge();
      void flushPending(false).then(updateBadge).catch(() => {});
    })()
      .then(() => sendResponse({ ok: true }))
      .catch((e: unknown) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    return true; // async response
  }
  if (msg?.type === 'refreshBadge') {
    void updateBadge();
  }
  if (msg?.type === 'targetChanged') {
    void updateMenuTitle();
  }
  return undefined;
});
