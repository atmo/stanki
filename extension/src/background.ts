import { contextMenus, scripting, action, runtime } from './browserApi';
import { extract } from '@shared/sentence';
import { newCardState } from '@shared/sm2';
import { INBOX_DECK_ID } from '@shared/types';
import type { Card } from '@shared/types';
import { addPending, flushPending, getPending } from './drive-ext';

const MENU_ID = 'stanki-add-word';

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

function makeCard(word: string, context: string, url: string, title: string): Card {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    deckId: INBOX_DECK_ID,
    front: word,
    back: '',
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
  const [{ result }] = await scripting.executeScript({
    target: { tabId },
    func: grabSelectionInfo,
  });
  const info = result as ReturnType<typeof grabSelectionInfo>;
  if (!info?.selectedText.trim()) return;

  const { word, context } = extract(info.selectedText, info.blockText || info.selectedText);
  await addPending(makeCard(word, context, info.url, info.title));
  await updateBadge();

  // Best-effort silent push; if not yet authorized it stays queued for the popup.
  void flushPending(false).then(updateBadge).catch(() => {});
}

runtime.onInstalled.addListener(() => {
  contextMenus.create({
    id: MENU_ID,
    title: 'Add “%s” to Stanki',
    contexts: ['selection'],
  });
  void updateBadge();
});

contextMenus.onClicked.addListener((info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => {
  if (info.menuItemId === MENU_ID && tab?.id != null) {
    void capture(tab.id);
  }
});

// Let the popup trigger an interactive push and badge refresh.
runtime.onMessage.addListener((msg: { type?: string }, _sender: unknown, sendResponse: (r: unknown) => void) => {
  if (msg?.type === 'flush') {
    flushPending(true)
      .then((r) => updateBadge().then(() => sendResponse({ ok: true, ...r })))
      .catch((e: unknown) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    return true; // async response
  }
  if (msg?.type === 'refreshBadge') {
    void updateBadge();
  }
  return undefined;
});
