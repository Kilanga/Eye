import { resolve } from 'node:path';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ command, mode }) => {
  // The App Check debug token is read without the VITE_ prefix, so Vite never exposes it, and
  // it is injected only by the dev server: a production build can never contain it.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    define: {
      __APPCHECK_DEBUG_TOKEN__: JSON.stringify(command === 'serve' ? env.APPCHECK_DEBUG_TOKEN ?? '' : ''),
    },
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
  };
});
