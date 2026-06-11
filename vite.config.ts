/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

// Short commit hash, shown on the About screen. Falls back to the CI-provided
// SHA, then 'dev' when git isn't available (e.g. a tarball build).
function commitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return (process.env.GITHUB_SHA ?? 'dev').slice(0, 7);
  }
}

export default defineConfig({
  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  // Base path. Locally './' works anywhere; CI sets VITE_BASE=/<repo>/ so the
  // PWA's assets and service-worker scope are correct on GitHub Project Pages.
  base: process.env.VITE_BASE ?? './',
  // Pin the dev port so it always matches the registered OAuth origin
  // (http://localhost:5173). strictPort fails loudly instead of silently
  // moving to 5174 if the port is busy.
  server: { port: 5173, strictPort: true },
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  build: {
    // The Wiktionary lemma map is large; keep it in its own chunk so its hash
    // stays stable across code changes (the SW re-downloads only the small app
    // bundle on most deploys, not the multi-MB data).
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('lemma-data') ? 'lemma-data' : undefined),
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Stanki Flashcards',
        short_name: 'Stanki',
        description: 'Spaced-repetition flashcards with Google Drive sync',
        theme_color: '#2563eb',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
        // Android: register as a share target so "Share → Stanki" opens the
        // add screen (bridged to #/add in main.tsx). iOS uses a Shortcut instead.
        share_target: {
          action: '.',
          method: 'GET',
          params: { text: 'text', title: 'title', url: 'url' },
        },
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // The app is local-first; cache the shell so it runs fully offline.
        navigateFallback: 'index.html',
        // Allow precaching the large lemma-data chunk (~4 MB).
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  test: {
    environment: 'node',
    include: ['shared/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
