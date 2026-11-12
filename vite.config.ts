import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    // Lets the service worker precache every file for offline use (public/sw.js).
    manifest: 'asset-manifest.json',
    rollupOptions: {
      input: { main: resolve(__dirname, 'index.html'), eval: resolve(__dirname, 'eval.html') },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
