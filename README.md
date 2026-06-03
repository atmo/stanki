# 📚 Stanki

An Anki-like, spaced-repetition flashcard **PWA** with three grade buttons, installable on **iPhone and desktop**, that syncs decks through **your own Google Drive** — no backend to host. A companion **browser extension** (Chrome + Firefox) lets you add words from any webpage, capturing the surrounding sentence/paragraph as context.

See [PLAN.md](PLAN.md) for the full design rationale.

## Features

- **Spaced repetition** — SM-2 with `Again` / `Good` / `Easy`; each button previews its next interval.
- **Local-first** — everything is stored in IndexedDB (Dexie) and works fully offline.
- **Google Drive sync** — one hidden snapshot file per deck in the `appDataFolder` (narrow `drive.appdata` scope). The app is 100% static; your Drive is the sync layer.
- **PWA** — installable on iOS/Android/desktop, runs standalone, offline-capable.
- **Context field** — cards can carry the sentence a word came from, shown (highlighted) during review.
- **Browser extension** — right-click a selection → *Add to Stanki*; the word + its sentence/paragraph land in your Drive **Inbox** deck.
- **Backup** — export/import the whole collection as JSON (offline portability, independent of Drive).

## Project layout

```
shared/        Pure, unit-tested core (no DOM): SM-2, sentence extraction,
               sync merge, Drive REST. Shared by the app and the extension.
src/           The React PWA (Vite).
extension/     The Chrome + Firefox WebExtension (esbuild).
PLAN.md        Design document.
```

## Prerequisites

- Node 20+ and npm.

## Run the app (local-only, no setup)

```bash
npm install
npm run dev        # http://localhost:5173
```

The app is fully usable without Google sign-in. Use **Settings → Export/Import JSON** to move decks between devices manually.

Other scripts:

```bash
npm run build      # type-check + production build to dist/
npm run preview    # serve the production build
npm test           # run the unit tests (vitest)
```

## Enable Google Drive sync (optional)

1. In the [Google Cloud Console](https://console.cloud.google.com/): create a project and **enable the Google Drive API**.
2. Configure the **OAuth consent screen** (User type *External*). While in *Testing*, add your Google account under **Test users** — that's enough for personal use; publishing/verification is only needed to share it publicly.
3. Create an **OAuth Client ID** → *Web application*. Under **Authorized JavaScript origins** add:
   - `http://localhost:5173`
   - your deployed URL (e.g. `https://<you>.github.io`)
4. Copy `.env.example` to `.env` and set the Client ID:
   ```
   VITE_GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
   ```
5. Restart `npm run dev`. **Settings → Connect Google Drive** now appears. The app syncs on launch, on tab focus, and via the toolbar badge / "Sync now".

> Scope used is `drive.appdata` — a hidden, per-app folder. Stanki cannot see the rest of your Drive.

## Install as a PWA

- **iPhone (Safari):** open the site → Share → **Add to Home Screen**. Launches standalone and works offline. (iOS may evict local storage if the app is unused for weeks — Drive holds the canonical copy, so signing in re-hydrates it.)
- **Desktop (Chrome/Edge):** click the install icon in the address bar.

## Build the browser extension

```bash
cd extension
npm install
npm run build      # outputs dist/chrome and dist/firefox
```

**Load it:**
- **Chrome:** `chrome://extensions` → enable *Developer mode* → *Load unpacked* → select `extension/dist/chrome`.
- **Firefox:** `about:debugging` → *This Firefox* → *Load Temporary Add-on* → pick any file in `extension/dist/firefox`.

**Use it:** select a word on a page → right-click → **Add "…" to Stanki**. Captured cards queue locally (badge count). Open the popup to paste your **Google OAuth Client ID** once and **push to Drive**; they appear in the app's **Inbox** deck on next sync.

> The extension uses the browser `identity` OAuth flow. Register its redirect URL (`https://<extension-id>.chromiumapp.org/` on Chrome; the generated URL on Firefox) as an authorized redirect URI on a *Web application* OAuth client with the `drive.appdata` scope. See [PLAN.md §14.5](PLAN.md).

### Context extraction rule

- A **sentence** = starts with a capital letter **and** ends with a dot.
- Select a **word** → its **enclosing sentence** becomes the card's context.
- Select a whole **sentence** → the **entire paragraph** becomes the context.

## Deploy (free static hosting)

`npm run build` emits a static `dist/`. Host it on GitHub Pages, Netlify, or Cloudflare Pages. Routing uses `HashRouter`, so no server rewrites are needed. Remember to add the deployed origin to your Google OAuth **Authorized JavaScript origins**.

## Tech

React 18 · TypeScript · Vite · vite-plugin-pwa (Workbox) · Dexie (IndexedDB) · Zustand · React Router · esbuild (extension).
