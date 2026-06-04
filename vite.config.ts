/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

export default defineConfig({
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
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // The app is local-first; cache the shell so it runs fully offline.
        navigateFallback: 'index.html',
      },
      devOptions: { enabled: false },
    }),
  ],
  test: {
    environment: 'node',
    include: ['shared/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
