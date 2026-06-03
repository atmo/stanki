# Flashcards App — Implementation Plan

A local-first, Anki-like spaced-repetition flashcard app built in React, installable as a PWA on iPhone and desktop, with deck synchronization through the user's own **Google Drive**. No backend server is operated by us — Google Drive *is* the sync layer.

---

## 1. Goals & Constraints

| Requirement | How it's met |
|---|---|
| Anki-like spaced repetition, 3 grades | SM-2 algorithm with `Again` / `Good` / `Easy` buttons |
| Works on iPhone **and** desktop | Single PWA (Progressive Web App), installable via "Add to Home Screen" |
| Web technologies, React | React + Vite + TypeScript |
| Sync decks across devices | Google Drive `appDataFolder` holds a JSON snapshot per deck |
| No hosting / client-side | 100% static frontend; OAuth runs in-browser; user's Drive stores data |

**Non-goals (v1):** multi-user sharing, media/audio cards, FSRS algorithm, real-time collaborative editing.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────┐
│              React PWA (static)             │
│                                             │
│  UI Layer ── Review ── Deck Editor ── Stats │
│      │                                      │
│  State (Zustand)                            │
│      │                                      │
│  ┌───────────────┐      ┌────────────────┐  │
│  │ Local Store   │◄────►│ Sync Engine    │  │
│  │ (Dexie /      │      │ (merge + LWW)  │  │
│  │  IndexedDB)   │      └───────┬────────┘  │
│  └───────────────┘              │           │
│  ┌───────────────┐              ▼           │
│  │ SM-2 Scheduler│      Google Drive REST   │
│  └───────────────┘      (appDataFolder)     │
└─────────────────────────────────────────────┘
```

- **Local-first:** every read/write hits IndexedDB. The app is fully usable offline.
- **Sync is a background reconciliation:** pull remote → merge → push merged result.
- Google Drive is treated as dumb file storage; all logic lives client-side.

---

## 3. Tech Stack

| Concern | Choice | Why |
|---|---|---|
| Build / dev | **Vite** | Fast, first-class PWA plugin |
| Language | **TypeScript** | Safety for scheduling/merge logic |
| UI | **React 18** | Required |
| PWA | **vite-plugin-pwa** (Workbox) | Service worker, manifest, offline cache |
| Local DB | **Dexie.js** (IndexedDB) | Ergonomic, indexed queries, large capacity |
| State | **Zustand** | Minimal, no boilerplate |
| Routing | **React Router** | Review / Decks / Settings views |
| Styling | **Tailwind CSS** (or CSS Modules) | Fast iteration; pick one |
| Google auth | **Google Identity Services (GIS)** | Browser token flow, no client secret |
| Drive access | **Drive REST v3** via `fetch` | No heavy `gapi` dependency needed |

---

## 4. Data Model

```ts
interface Deck {
  id: string;            // uuid
  name: string;
  createdAt: number;
  updatedAt: number;     // for sync conflict resolution
  deleted?: boolean;     // soft delete (tombstone) for sync
}

interface Card {
  id: string;            // uuid
  deckId: string;
  front: string;
  back: string;
  context?: string;      // sentence/paragraph captured from a webpage (browser extension)
  source?: {             // provenance when added via extension
    url: string;
    title: string;
    addedAt: number;
  };
  // SM-2 scheduling state
  interval: number;      // days until next review
  easeFactor: number;    // starts at 2.5
  repetitions: number;   // consecutive correct count
  dueDate: number;       // epoch ms
  // bookkeeping
  createdAt: number;
  updatedAt: number;     // last edit OR last review
  deleted?: boolean;     // tombstone
}

interface ReviewLog {     // optional, for stats
  cardId: string;
  ts: number;
  grade: 'again' | 'good' | 'easy';
  prevInterval: number;
  newInterval: number;
}
```

**Sync snapshot file** (one JSON per deck, stored in Drive `appDataFolder`):

```json
{
  "schemaVersion": 1,
  "deck": { /* Deck */ },
  "cards": [ /* Card[] including tombstones */ ],
  "exportedAt": 1730000000000,
  "deviceId": "uuid-of-this-device"
}
```

> Per-deck files keep payloads small and let syncs touch only changed decks.

---

## 5. Spaced Repetition — SM-2 with 3 Buttons

Map the three grades onto SM-2:

```ts
function schedule(card: Card, grade: 'again' | 'good' | 'easy'): Card {
  let { interval, easeFactor, repetitions } = card;

  if (grade === 'again') {
    repetitions = 0;
    interval = 1;                                   // relearn tomorrow
    easeFactor = Math.max(1.3, easeFactor - 0.2);
  } else {
    const q = grade === 'easy' ? 5 : 4;             // quality score
    repetitions += 1;
    if (repetitions === 1) interval = 1;
    else if (repetitions === 2) interval = 6;
    else interval = Math.round(interval * easeFactor);

    easeFactor = Math.max(
      1.3,
      easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
    );
    if (grade === 'easy') interval = Math.round(interval * 1.3); // easy bonus
  }

  return {
    ...card,
    interval,
    easeFactor,
    repetitions,
    dueDate: Date.now() + interval * 86_400_000,
    updatedAt: Date.now(),
  };
}
```

**Customization knobs** (Settings screen, persisted locally): starting ease, easy bonus, again-interval, new-cards-per-day, max-reviews-per-day.

**Due query:** `cards.where('dueDate').belowOrEqual(Date.now())` filtered by deck and `!deleted`.

---

## 6. Google Drive Synchronization

### 6.1 Why `appDataFolder`
- A **hidden, per-app folder** in the user's Drive — invisible in their normal Drive UI, no clutter.
- Requires only the narrow **`https://www.googleapis.com/auth/drive.appdata`** scope → a far less alarming consent screen than full Drive access.
- Perfect for app-managed state the user shouldn't hand-edit.

> Alternative: `drive.file` scope + a visible "Flashcards" folder if you want users to see/back-up files directly. Trade-off: scarier consent, but user-visible. Default to `appDataFolder`.

### 6.2 One-time Google Cloud setup (manual, documented in README)
1. Create a Google Cloud project.
2. Configure the **OAuth consent screen** (External, add yourself as a test user while in "Testing" mode — sufficient for personal use; publishing requires verification only if you go public).
3. Create an **OAuth 2.0 Client ID** of type **Web application**.
4. Add authorized JavaScript origins (e.g. `http://localhost:5173`, and your GitHub Pages / Netlify URL).
5. Copy the **Client ID** into the app config (`.env`: `VITE_GOOGLE_CLIENT_ID`). **No client secret** — the browser token flow doesn't use one.

### 6.3 Auth flow (Google Identity Services)
- Load `https://accounts.google.com/gsi/client`.
- Use the **token model**:
  ```ts
  const client = google.accounts.oauth2.initTokenClient({
    client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
    scope: 'https://www.googleapis.com/auth/drive.appdata',
    callback: (resp) => { accessToken = resp.access_token; },
  });
  client.requestAccessToken();
  ```
- Access tokens are short-lived (~1h). Re-request silently on expiry (`prompt: ''`). Persist nothing sensitive beyond the token in memory; re-auth on app load.

### 6.4 Drive REST calls (all via `fetch` with `Authorization: Bearer <token>`)

| Operation | Endpoint |
|---|---|
| List app files | `GET /drive/v3/files?spaces=appDataFolder&fields=files(id,name,modifiedTime,appProperties)` |
| Create file | `POST /upload/drive/v3/files?uploadType=multipart` with `parents:['appDataFolder']` |
| Update file | `PATCH /upload/drive/v3/files/{id}?uploadType=media` |
| Download file | `GET /drive/v3/files/{id}?alt=media` |

Store a `deckId` in the file's `appProperties` so we can map Drive files ↔ local decks without parsing contents.

### 6.5 Sync algorithm (per deck, last-write-wins at card granularity)

```
function syncDeck(localDeck):
    remoteFile = findDriveFileFor(localDeck.id)   // via appProperties
    remote = remoteFile ? download(remoteFile) : null

    merged = mergeCards(local.cards, remote?.cards)   // see below
    mergedDeck = newerOf(local.deck, remote?.deck)

    writeLocal(mergedDeck, merged)                    // update IndexedDB
    snapshot = buildSnapshot(mergedDeck, merged)
    if remoteFile: update(remoteFile.id, snapshot)
    else:          create(snapshot, appProperties={deckId})
```

**Card merge (LWW with tombstones):**
```
for each cardId in union(localIds, remoteIds):
    l = local[cardId]; r = remote[cardId]
    if only one exists -> take it
    else -> take the one with greater updatedAt
            (tombstone wins ties to converge deletes)
```

- **Conflict policy:** per-card `updatedAt` last-write-wins. Simple, converges, good enough for single-user-multi-device. Editing the *same* card on two offline devices loses one edit — acceptable for v1; note it in docs.
- **Deletes:** soft-delete tombstones (`deleted: true`) so a delete on device A propagates to device B instead of being resurrected. Garbage-collect tombstones older than ~60 days.
- **Device clock skew:** rely on local `Date.now()`; acceptable for personal use. Optionally stamp with Drive `modifiedTime` as a tiebreak.

### 6.6 When sync runs
- On app launch (after auth).
- On app foreground / `visibilitychange` (covers iOS returning to PWA).
- After a review session ends and after deck edits (debounced ~5s).
- Manual **"Sync now"** button with status (idle / syncing / error / last-synced time).
- **Never** rely on iOS background sync — it's unreliable. Sync on open/close instead.

---

## 7. PWA / iOS Considerations

- `vite-plugin-pwa` generates manifest + service worker; precache the app shell for offline use.
- iOS install: user taps Share → "Add to Home Screen." Document this; iOS gives no install prompt.
- **Storage eviction:** iOS may evict IndexedDB for unused PWAs. Mitigation: Google Drive holds the canonical copy, so a wiped local store re-hydrates on next sync/login. Optionally call `navigator.storage.persist()`.
- Use `viewport-fit=cover` + safe-area insets for iPhone notch/home-bar.
- Test the OAuth popup on iOS Safari early — popups inside PWAs can be finicky; fall back to redirect flow if needed.

---

## 8. UI Screens

1. **Deck list** — decks with due-count badges; create/rename/delete; sync status bar.
2. **Review** — show front → tap to reveal back → 3 buttons (`Again` / `Good` / `Easy`) with the resulting interval previewed on each button (e.g. "Good · 6d"). If a card has a **Context** field, render it under the answer (selected word highlighted), with a link back to `source.url`.
3. **Deck editor** — add/edit/delete cards; bulk import (paste TSV / Anki-style `front<tab>back`).
4. **Settings** — Google account connect/disconnect, sync controls, SR tuning knobs, export/import JSON (offline fallback).
5. **Stats (optional)** — reviews/day, due forecast, retention.

---

## 9. Project Structure

```
src/
  main.tsx
  app/            # routing, layout, providers
  db/
    schema.ts     # Dexie definitions
    repo.ts       # CRUD helpers
  scheduler/
    sm2.ts        # schedule() + tests
  sync/
    googleAuth.ts # GIS token client
    driveApi.ts   # REST wrappers
    sync.ts       # merge + reconcile
  features/
    decks/
    review/
    settings/
    stats/
  store/          # zustand stores
  components/     # shared UI
```

---

## 10. Implementation Phases

**Phase 0 — Scaffold**
Vite + React + TS + Tailwind + Dexie + Zustand + router. PWA plugin wired. App runs offline.

**Phase 1 — Core flashcards (local only)**
Data model, deck CRUD, card CRUD, SM-2 scheduler + unit tests, review screen with 3 buttons, due-card queue. *Fully usable, no sync.*

**Phase 2 — Offline portability**
Export/import deck as JSON file (manual sync fallback + backup). De-risks Phase 3.

**Phase 3 — Google Drive sync**
GIS auth, Drive REST wrappers, per-deck snapshot files in `appDataFolder`, merge engine with tombstones, sync triggers, status UI.

**Phase 4 — Polish**
iOS install/QA, storage-persistence, settings/customization knobs, bulk import, stats, error states & retry/backoff for Drive 401/429/5xx.

**Phase 5 — Deploy**
Static build → GitHub Pages / Netlify / Cloudflare Pages (free). Add the deployed origin to Google OAuth authorized origins. Document install steps.

**Phase 6 — Browser extensions (Chrome + Firefox)**
Shared WebExtension codebase: context-menu capture, sentence/paragraph extraction, and write-to-Drive inbox. See §14.

---

## 11. Testing Strategy

- **Unit:** `sm2.ts` (interval/ease progression across grade sequences); `merge` (LWW, tombstones, clock-skew ties).
- **Integration:** mock Drive REST; simulate two devices editing/deleting → assert convergence.
- **Manual:** real two-device test (desktop + iPhone), offline-then-sync, eviction recovery.

---

## 12. Key Risks & Mitigations

| Risk | Mitigation |
|---|---|
| iOS evicts local data | Drive is canonical; re-hydrate on login. `storage.persist()`. |
| OAuth consent friction / "unverified app" | Personal use: stay in Testing mode + add self as test user. Publish + verify only if going public. |
| Concurrent edit of same card | Per-card LWW; document the edge case. Upgrade to CRDT/field-merge later if needed. |
| Token expiry mid-session | Silent re-request via GIS; queue pending writes locally. |
| Drive rate limits (429) | Debounce syncs; exponential backoff; batch per-deck. |
| Clock skew across devices | Tolerable for single user; optional `modifiedTime` tiebreak. |

---

## 14. Browser Extensions (Chrome + Firefox) — "Add Word from Webpage"

Let the user select a word (or phrase) on any webpage, right-click → **"Add to Flashcards"**, and have a card created with the word as the **front** and the surrounding **sentence/paragraph** captured into the **Context** field.

### 14.1 One codebase, both browsers
- Target **Manifest V3** (supported by both Chrome and Firefox ≥115).
- Use the **`webextension-polyfill`** so a single `browser.*` (promise-based) API works on both.
- Build with Vite, emitting two zip artifacts from the same source. Differences are isolated to the manifest and the OAuth method (§14.5):

| Concern | Chrome | Firefox |
|---|---|---|
| Background | MV3 **service worker** | MV3 **event page** (`background.scripts`) |
| OAuth | `chrome.identity.getAuthToken` (or `launchWebAuthFlow`) | `browser.identity.launchWebAuthFlow` |
| Manifest key | `background.service_worker` | `background.scripts` + `browser_specific_settings.gecko.id` |
| Packaging | `.zip` → Chrome Web Store | `.zip` → AMO (addons.mozilla.org) |

> Keep a single `manifest.base.json` and merge per-target overrides at build time.

### 14.2 Components
```
extension/
  manifest.base.json
  src/
    background.ts     # creates context menu, orchestrates capture → Drive
    content.ts        # extracts selection + sentence/paragraph from the DOM
    popup.html/.ts    # connect Google account, pick target deck, view status
    drive.ts          # SHARED with PWA: Drive REST + appDataFolder inbox
    extract.ts        # sentence/paragraph algorithm (pure, unit-tested)
```

- **`background.ts`** registers a `contextMenus` item with `contexts: ['selection']`. On click it sends a message to the active tab's content script asking for the captured payload, then writes it to Drive.
- **`content.ts`** runs the extraction in page context (it has the live `Selection`/DOM). Returns `{ word, context, url, title }`.
- **Permissions:** `contextMenus`, `activeTab`, `identity`, `storage`, and host permission for `https://www.googleapis.com/*` (Drive). No broad `<all_urls>` content-script injection needed — inject on demand via `activeTab` when the menu item is clicked.

### 14.3 Capture flow
```
user selects text → right-click → "Add to Flashcards"
  → background.contextMenus.onClicked
  → inject/message content script
  → content.extractSelection()  → { word, context, source }
  → background writes a Card to the Drive "Inbox" deck snapshot
  → toast: "Added ‘<word>’ to Flashcards"
  → (optional) open popup to edit the back/translation before saving
```
The new card is created with `front = word`, `context = <sentence|paragraph>`, `back = ""` (filled later in the PWA or the popup), `source = { url, title, addedAt }`, and full SM-2 defaults so it's immediately reviewable.

### 14.4 Sentence / paragraph extraction algorithm (`extract.ts`)

**Rules requested:**
- A **sentence** = a substring that **starts with a capital letter AND ends with a dot** (`.`).
- If the user selected **a word** → Context = the **sentence** containing it.
- If the user selected **a (whole) sentence** → Context = the **whole paragraph** containing it.

```ts
interface Capture { word: string; context: string; }

// A selection counts as "a sentence" if, trimmed, it begins with an
// uppercase letter and ends with a period.
function isSentence(sel: string): boolean {
  const s = sel.trim();
  return /^[A-Z\p{Lu}]/u.test(s) && s.endsWith('.');
}

function extract(selectedText: string, blockText: string): Capture {
  const sel = selectedText.trim();

  if (isSentence(sel)) {
    // Selected text is itself a sentence → context is the whole paragraph.
    return { word: sel, context: normalize(blockText) };
  }
  // Otherwise treat selection as a word/phrase → find enclosing sentence.
  return { word: sel, context: enclosingSentence(sel, blockText) };
}
```

**Getting `blockText` (the paragraph):** from the selection's anchor node, walk up to the nearest block-level container (`P, LI, DIV, TD, BLOCKQUOTE, ARTICLE, SECTION, H1–H6`) and read its `textContent`, collapsing whitespace.

**`enclosingSentence`** — split the paragraph into sentences using the same definition (capital … dot), then return the one spanning the selection offset:
```ts
function enclosingSentence(word: string, paragraph: string): string {
  const text = normalize(paragraph);
  // Sentence = capital-initial run ending at a period (handles ., ?, !, …).
  const re = /[A-Z\p{Lu}][^.?!…]*[.?!…]/gu;
  const matches = [...text.matchAll(re)];
  const idx = text.indexOf(word);
  const hit = matches.find(m =>
    m.index! <= idx && idx < m.index! + m[0].length
  );
  return (hit?.[0] ?? text).trim();   // fall back to whole block if no match
}

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
```

**Edge cases & decisions:**
- **Abbreviations** ("e.g.", "Dr.", "U.S.") will over-split with a naive dot rule. Acceptable for v1 per the stated definition; optionally maintain a small abbreviation skip-list later, or use `Intl.Segmenter('…', {granularity:'sentence'})` as an upgrade.
- **No enclosing sentence found** (e.g. block has no capital/period) → fall back to the whole block text as context.
- **Selection spans multiple blocks** → use the block of the selection's `anchorNode`.
- The requested rule keys on `.` specifically; the regex also tolerates `?!…` as terminators so quotes/questions aren't truncated — narrow it to `.` only if you want the literal rule.
- Preserve the exact selected word for highlighting in the card UI (store `word` separately from `context`).

### 14.5 Delivering cards to the app (no backend)
The extension reuses the **same Google Drive `appDataFolder`** as the PWA (§6). Two viable patterns:

1. **Shared Drive inbox (recommended).** The extension authenticates to Drive with the **same `drive.appdata` scope** and appends the new card to a dedicated **"Inbox" deck** snapshot file (or a per-capture small file). On next sync the PWA merges the Inbox via the normal LWW/tombstone engine (§6.5) and the user can move cards to a real deck. Fully serverless; works even if the PWA isn't open.
   - Reuse `drive.ts` between PWA and extension (shared package).
   - Use a small write-lock pattern (read latest → append → write, retry on `modifiedTime` change) to avoid clobbering concurrent captures.
2. **Local handoff fallback.** If the user hasn't connected Drive in the extension, queue captures in `browser.storage.local`; the popup shows pending items and a "Copy/Export" button, or flushes them to Drive once connected.

**OAuth note:** register a **separate Web OAuth client** (or use `launchWebAuthFlow` with the extension's redirect URL `https://<ext-id>.chromiumapp.org/`). Chrome can alternatively use `getAuthToken` with the extension's own client ID; Firefox always uses `launchWebAuthFlow`. Both request only `drive.appdata`.

### 14.6 Popup UX
- First run: **"Connect Google Drive"** button → OAuth.
- Per capture (optional quick-edit): show `word`, editable `context`, a `back`/translation field, and a **target-deck** selector; **Save**.
- Settings: default target deck, whether to open the editor on every capture or save silently with a toast.

### 14.7 Testing
- **Unit** `extract.ts` against fixtures: single word mid-sentence, word at sentence start/end, selected full sentence → paragraph, abbreviation edge cases, multi-paragraph selection, no-period block.
- **Manual** on real pages (news article, Wikipedia, PDF-in-browser viewer caveat noted).
- **Cross-browser** smoke test of context menu + OAuth on both Chrome and Firefox.

### 14.8 Distribution
- **Chrome:** zip → Chrome Web Store (one-time dev fee) or load unpacked for personal use.
- **Firefox:** zip → AMO (free); self-distribution requires AMO signing. `browser_specific_settings.gecko.id` required.

---

## 15. Possible Future Enhancements

- FSRS scheduler (better retention than SM-2).
- Media cards (images/audio) — store blobs in Drive, reference by file ID.
- End-to-end encryption of snapshots before upload.
- Deck sharing via shared Drive files or export links.
- TinyBase/Yjs CRDT layer for true conflict-free multi-device editing.
- Extension: auto-fill the card `back` from a dictionary/translation API at capture time.
- Extension: capture the word's surrounding **two** sentences, or `Intl.Segmenter`-based sentence splitting for better abbreviation handling.
