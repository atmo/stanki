import { contextMenus, scripting, action, runtime, tabs } from './browserApi';
import { extract } from '@shared/sentence';
import { newCardState } from '@shared/sm2';
import type { Card } from '@shared/types';
import {
  addPending,
  flushPending,
  getPending,
  getTargetDeck,
  getAuthUrl,
  storeOAuthToken,
} from './drive-ext';
import { lookupWord, joinSenses, anwExplanation, type Lookups, type Sense } from '@shared/lookup';
import { lemmaCandidates, withArticle } from '@shared/lemma';

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

  let rect = { left: 16, top: 16, bottom: 16 };
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
    const r = sel.getRangeAt(0).getBoundingClientRect();
    if (r && (r.width || r.height)) rect = { left: r.left, top: r.top, bottom: r.bottom };
  }

  return { selectedText, blockText, url: location.href, title: document.title, rect };
}

interface Candidate {
  lemma: string; // bare base form, for the dictionary lookup ("huis")
  label: string; // display + card front, with article for nouns ("het huis")
}
interface BubblePayload {
  word: string;
  lemma: string; // base form currently looked up
  front: string; // card front: the chosen candidate's label
  candidates: Candidate[]; // base-form readings to choose from, default first
  context: string;
  url: string;
  title: string;
  rect?: { left: number; top: number; bottom: number }; // anchor, kept across re-lookups
  loading?: boolean;
  lookups: Lookups;
  back: string; // card back: Wiktionary senses (with examples), from the lookup
  explanation: string; // card explanation: ANW senses
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

  // Prefer the anchor carried in the payload (so re-lookups keep position even
  // if the page selection was cleared); else read the current selection.
  let rect = payload.rect ?? { left: 16, top: 16, bottom: 16 };
  if (!payload.rect) {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (r && (r.width || r.height)) rect = { left: r.left, top: r.top, bottom: r.bottom };
    }
  }

  const host = document.createElement('div');
  host.id = 'stanki-lookup-host';
  host.style.cssText =
    `position:fixed;z-index:2147483647;left:${rect.left}px;top:${rect.bottom + 8}px;`;
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent =
    ".card{all:initial;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
    'display:block;width:300px;max-height:calc(100vh - 16px);overflow:auto;background:#0f172a;color:#e2e8f0;' +
    'border:1px solid #334155;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.5);' +
    'padding:12px 14px;font-size:13px;line-height:1.45;box-sizing:border-box;}' +
    '.hd{display:flex;align-items:baseline;gap:8px;margin-bottom:4px;}' +
    '.lemma{font-weight:700;font-size:15px;color:#fff;}' +
    '.x{margin-left:auto;cursor:pointer;color:#94a3b8;font-size:15px;line-height:1;background:none;border:none;}' +
    '.slabel{display:flex;align-items:center;gap:6px;font-size:10px;text-transform:uppercase;' +
    'letter-spacing:.04em;color:#93c5fd;font-weight:700;margin:10px 0 3px;}' +
    '.slink{margin-left:auto;font-size:11px;text-transform:none;letter-spacing:0;font-weight:600;' +
    'color:#93c5fd;text-decoration:none;}.slink:hover{text-decoration:underline;}' +
    '.sense{margin:5px 0;}.n{color:#64748b;font-weight:700;margin-right:5px;}' +
    '.ex{color:#94a3b8;font-style:italic;margin-top:2px;}.muted{color:#94a3b8;}' +
    '.basef{font-size:13px;color:#86efac;font-weight:600;margin:8px 0 2px;}' +
    '.basef-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:8px 0 2px;}' +
    '.basef-label{font-size:11px;color:#94a3b8;}' +
    '.basef-chip{padding:3px 10px;border-radius:999px;cursor:pointer;font-size:12px;' +
    'background:rgba(22,163,74,.12);color:#86efac;border:1px solid rgba(22,163,74,.35);}' +
    '.basef-chip.on{background:rgba(22,163,74,.3);font-weight:600;}' +
    '.frow{display:flex;gap:6px;}.frow .finput{flex:1;min-width:0;}' +
    '.look{background:#334155;color:#e2e8f0;border:none;border-radius:6px;padding:5px 10px;' +
    'font-size:12px;cursor:pointer;white-space:nowrap;}.look:hover{background:#3f4d63;}' +
    '.form{display:flex;flex-direction:column;gap:3px;margin-top:12px;}' +
    '.flabel{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#93c5fd;' +
    'font-weight:700;margin-top:5px;}' +
    '.finput,.ftext{width:100%;box-sizing:border-box;background:#1e293b;color:#e2e8f0;' +
    'border:1px solid #334155;border-radius:6px;padding:5px 7px;font-size:12px;font-family:inherit;}' +
    '.ftext{resize:vertical;line-height:1.4;}' +
    '.add{margin-top:12px;width:100%;padding:7px;border:none;border-radius:8px;' +
    'background:#2563eb;color:#fff;font-size:13px;cursor:pointer;}.add:disabled{opacity:.6;cursor:default;}' +
    '.vd{display:block;margin-top:10px;font-size:11px;color:#93c5fd;text-decoration:none;}.vd:hover{text-decoration:underline;}';
  shadow.appendChild(style);

  const card = document.createElement('div');
  card.className = 'card';
  const { anw, free } = payload.lookups;
  const term = payload.lemma || payload.word; // offline base form, computed by the background

  const hd = document.createElement('div');
  hd.className = 'hd';
  const lemma = document.createElement('span');
  lemma.className = 'lemma';
  lemma.textContent = payload.word;
  hd.appendChild(lemma);
  const x = document.createElement('button');
  x.className = 'x';
  x.textContent = '✕';
  hd.appendChild(x);
  card.appendChild(hd);

  const addSection = (label: string, senses: Sense[], url: string) => {
    const lab = document.createElement('div');
    lab.className = 'slabel';
    const name = document.createElement('span');
    name.textContent = label;
    lab.appendChild(name);
    const link = document.createElement('a');
    link.className = 'slink';
    link.href = url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = 'open ↗';
    lab.appendChild(link);
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

  const addNote = (text: string) => {
    const p = document.createElement('div');
    p.className = 'muted';
    p.textContent = text;
    card.appendChild(p);
  };

  if (payload.loading) {
    addNote(`Looking up “${term}”…`);
  } else {
    if (anw) {
      addSection('ANW', anw.senses, `https://anw.ivdnt.org/article/${encodeURIComponent(anw.lemma)}`);
    } else {
      addNote(`No ANW entry for “${term}”.`);
    }
    if (free) {
      addSection(
        'Wiktionary (EN)',
        free.senses,
        `https://en.wiktionary.org/wiki/${encodeURIComponent(free.lemma)}#Dutch`,
      );
    } else {
      addNote(`No Wiktionary entry for “${term}”.`);
    }
  }

  if (!payload.loading) {
    // Back (Wiktionary senses with examples) and Explanation (ANW) are formatted
    // in the background via the shared joinSenses/anwExplanation helpers.
    const back = payload.back;
    const explanation = payload.explanation;
    const vd = document.createElement('a');
    vd.className = 'vd';
    vd.href = `https://zoeken.vandale.nl/?query=${encodeURIComponent(term)}`;
    vd.target = '_blank';
    vd.rel = 'noreferrer';
    vd.textContent = 'Look up in Van Dale ↗';
    card.appendChild(vd);

    // Editable card fields, pre-filled from the lookup; tweak before saving.
    const form = document.createElement('div');
    form.className = 'form';
    const addField = (
      label: string,
      value: string,
      multiline: boolean,
    ): HTMLInputElement | HTMLTextAreaElement => {
      const lab = document.createElement('div');
      lab.className = 'flabel';
      lab.textContent = label;
      form.appendChild(lab);
      const el = document.createElement(multiline ? 'textarea' : 'input') as
        | HTMLInputElement
        | HTMLTextAreaElement;
      el.className = multiline ? 'ftext' : 'finput';
      el.value = value;
      if (multiline) (el as HTMLTextAreaElement).rows = 2;
      form.appendChild(el);
      return el;
    };
    // Front + a "Look up" button that re-runs the dictionary lookup on whatever
    // is currently in the Front field (after editing it). Defaults to the base
    // form (with article for nouns).
    const flab = document.createElement('div');
    flab.className = 'flabel';
    flab.textContent = 'Front';
    form.appendChild(flab);
    const frow = document.createElement('div');
    frow.className = 'frow';
    const frontInput = document.createElement('input');
    frontInput.className = 'finput';
    frontInput.value = payload.front;
    const lookBtn = document.createElement('button');
    lookBtn.className = 'look';
    lookBtn.type = 'button';
    lookBtn.textContent = 'Look up';
    lookBtn.addEventListener('click', () => {
      const word = frontInput.value.trim().replace(/^(de|het)\s+/i, ''); // drop article
      if (!word) return;
      chrome.runtime.sendMessage({
        type: 'lookupTyped',
        typed: {
          word,
          context: payload.context,
          url: payload.url,
          title: payload.title,
          rect: payload.rect,
        },
      });
    });
    frow.appendChild(frontInput);
    frow.appendChild(lookBtn);
    form.appendChild(frow);

    const backInput = addField('Back', back, true);
    const explInput = addField('Explanation', explanation, true);
    const ctxInput = addField('Context', payload.context, true);
    card.appendChild(form);

    // Base-form choice above the fields: pick the reading you mean (e.g. noun
    // plural vs. verb). Clicking re-runs the lookup on that base form (and fills
    // the Front field). Single reading -> a note.
    const cands = payload.candidates ?? [];
    if (cands.length > 1) {
      const row = document.createElement('div');
      row.className = 'basef-row';
      const labEl = document.createElement('span');
      labEl.className = 'basef-label';
      labEl.textContent = 'Base form:';
      row.appendChild(labEl);
      for (const cand of cands) {
        const chip = document.createElement('button');
        chip.className = 'basef-chip' + (cand.label === payload.front ? ' on' : '');
        chip.textContent = cand.label;
        chip.addEventListener('click', () => {
          if (cand.label === payload.front) return; // already showing this one
          chrome.runtime.sendMessage({
            type: 'lookupBase',
            base: {
              word: payload.word,
              lemma: cand.lemma,
              front: cand.label,
              candidates: payload.candidates,
              context: payload.context,
              url: payload.url,
              title: payload.title,
              rect: payload.rect,
            },
          });
        });
        row.appendChild(chip);
      }
      card.insertBefore(row, form);
    } else if (payload.front.trim().toLowerCase() !== payload.word.trim().toLowerCase()) {
      const bf = document.createElement('div');
      bf.className = 'basef';
      bf.textContent = `→ ${payload.front}`;
      card.insertBefore(bf, form);
    }

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
            word: frontInput.value.trim() || payload.word,
            context: ctxInput.value.trim(),
            back: backInput.value.trim(),
            explanation: explInput.value.trim(),
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
  explanation: string,
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
    explanation: explanation || undefined,
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

type LookupBase = Omit<BubblePayload, 'loading' | 'lookups' | 'back' | 'explanation'>;

/** Show a loading bubble, look up base.lemma in both dictionaries, show results. */
async function showLookup(tabId: number, base: LookupBase): Promise<void> {
  await scripting.executeScript({
    target: { tabId },
    func: renderBubble,
    args: [{ ...base, loading: true, lookups: { anw: null, free: null }, back: '', explanation: '' }],
  });
  const lookups = await lookupWord(base.lemma);
  await scripting.executeScript({
    target: { tabId },
    func: renderBubble,
    args: [
      {
        ...base,
        loading: false,
        lookups,
        back: joinSenses(lookups.free),
        explanation: anwExplanation(lookups.anw),
      },
    ],
  });
}

/** Build a lookup base (word + offline base-form candidates) for a word. */
function baseForWord(
  word: string,
  context: string,
  url: string,
  title: string,
  rect?: BubblePayload['rect'],
): LookupBase {
  const candidates = lemmaCandidates(word).map((l) => ({ lemma: l, label: withArticle(l) }));
  return { word, lemma: candidates[0].lemma, front: candidates[0].label, candidates, context, url, title, rect };
}

/** Look up the selection and show the result bubble anchored to the word. */
async function lookupAndShow(tabId: number): Promise<void> {
  const [{ result }] = await scripting.executeScript({ target: { tabId }, func: grabSelectionInfo });
  const info = result as ReturnType<typeof grabSelectionInfo>;
  if (!info?.selectedText.trim()) return;

  const { word, context } = extract(info.selectedText, info.blockText || info.selectedText);
  await showLookup(tabId, baseForWord(word, context, info.url, info.title, info.rect));
}

runtime.onInstalled.addListener(async () => {
  // Single top-level item, so the browser shows it directly in the context menu
  // (two or more items would nest under a "Stanki" submenu).
  contextMenus.create({ id: LOOKUP_MENU_ID, title: 'Look up “%s”', contexts: ['selection'] });
  void updateBadge();
});

contextMenus.onClicked.addListener((info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => {
  if (tab?.id == null) return;
  if (info.menuItemId === LOOKUP_MENU_ID) void lookupAndShow(tab.id);
});

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface Msg {
  type?: string;
  payload?: { word: string; context: string; back: string; explanation: string; url: string; title: string };
  base?: LookupBase; // for 'lookupBase' (re-run lookup on a chosen base form)
  typed?: { word: string; context: string; url: string; title: string; rect?: BubblePayload['rect'] };
  accessToken?: string | null;
  expiresIn?: number;
  error?: string | null;
}

runtime.onMessage.addListener(
  (msg: Msg, sender: { tab?: { id?: number } }, sendResponse: (r: unknown) => void) => {
    // Popup → open the Google sign-in in a real tab (multi-account chooser works).
    if (msg?.type === 'connect') {
      getAuthUrl()
        .then((url) => tabs.create({ url }))
        .then(() => sendResponse({ ok: true }))
        .catch((e: unknown) => sendResponse({ ok: false, error: errMsg(e) }));
      return true; // async response
    }
    // Redirect content script → hand back the captured token, then push + close.
    if (msg?.type === 'oauthRedirect') {
      const tabId = sender?.tab?.id;
      void (async () => {
        if (msg.accessToken) {
          await storeOAuthToken(msg.accessToken, msg.expiresIn ?? 0);
          await flushPending();
          await updateBadge();
        } else {
          console.error('[Stanki] OAuth redirect error:', msg.error);
        }
        if (tabId != null) await tabs.remove(tabId).catch(() => {});
      })().catch((e) => console.error('[Stanki] oauthRedirect failed', e));
      return undefined;
    }
    // Popup → push whatever is pending (uses the stored token).
    if (msg?.type === 'flush') {
      flushPending()
        .then((r) => updateBadge().then(() => sendResponse({ ok: true, ...r })))
        .catch((e: unknown) => sendResponse({ ok: false, error: errMsg(e) }));
      return true; // async response
    }
    if (msg?.type === 'addFromLookup' && msg.payload) {
      const p = msg.payload;
      (async () => {
        const target = await getTargetDeck();
        await addPending(makeCard(target.id, p.word, p.back, p.context, p.explanation, p.url, p.title));
        await updateBadge();
        void flushPending().then(updateBadge).catch(() => {});
      })()
        .then(() => sendResponse({ ok: true }))
        .catch((e: unknown) => sendResponse({ ok: false, error: errMsg(e) }));
      return true; // async response
    }
    // Bubble base-form chip → re-run the lookup on the chosen base form.
    if (msg?.type === 'lookupBase' && msg.base && sender?.tab?.id != null) {
      void showLookup(sender.tab.id, msg.base).catch((e) =>
        console.error('[Stanki] lookupBase failed', e),
      );
      return undefined;
    }
    // Bubble "Look up" button → re-run the lookup on the edited Front word.
    if (msg?.type === 'lookupTyped' && msg.typed?.word && sender?.tab?.id != null) {
      const t = msg.typed;
      void showLookup(sender.tab.id, baseForWord(t.word, t.context, t.url, t.title, t.rect)).catch(
        (e) => console.error('[Stanki] lookupTyped failed', e),
      );
      return undefined;
    }
    if (msg?.type === 'refreshBadge') {
      void updateBadge();
    }
    return undefined;
  },
);
