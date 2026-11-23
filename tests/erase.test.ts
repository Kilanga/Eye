import { describe, expect, it } from 'vitest';
import { eraseBrowserData } from '../src/core/erase';

/** A fake browser with the storage Firebase and reCAPTCHA leave behind. */
function fakeBrowser(opts: { blocked?: string[]; failCaches?: boolean } = {}) {
  const local = new Map<string, string>([
    ['underwriters-eye.snapshot', '{}'],
    ['underwriters-eye.personal-rules', '{}'],
    ['_grecaptcha', 'x'],
  ]);
  const session = new Map<string, string>([['k', 'v']]);
  const dbs = new Set(['firebase-installations-database', 'firebase_remote_config', 'firebase-app-check-database', 'firebase-heartbeat-database']);
  const cacheNames = new Set(['underwriters-eye-v1']);
  let registrations = 1;
  const g = {
    localStorage: { clear: () => local.clear() },
    sessionStorage: { clear: () => session.clear() },
    indexedDB: {
      databases: async () => [...dbs].map((name) => ({ name, version: 1 })),
      deleteDatabase(name: string) {
        const req: { onsuccess?: () => void; onerror?: () => void } = {};
        // A database still open in the tab never answers before the reload.
        if (!opts.blocked?.includes(name)) setTimeout(() => (dbs.delete(name), req.onsuccess?.()), 0);
        return req;
      },
    },
    caches: {
      keys: async () => {
        if (opts.failCaches) throw new Error('no caches here');
        return [...cacheNames];
      },
      delete: async (k: string) => cacheNames.delete(k),
    },
    navigator: {
      serviceWorker: {
        getRegistrations: async () => Array.from({ length: registrations }, () => ({ unregister: async () => (registrations--, true) })),
      },
    },
  };
  return { g: g as unknown as typeof globalThis, local, session, dbs, cacheNames, registrations: () => registrations };
}

describe('Erase everything from this browser', () => {
  it('removes localStorage, IndexedDB (Firebase), Cache Storage and the service worker', async () => {
    const b = fakeBrowser();
    const report = await eraseBrowserData(b.g);
    expect(b.local.size).toBe(0);
    expect(b.session.size).toBe(0);
    expect(b.dbs.size).toBe(0);
    expect(b.cacheNames.size).toBe(0);
    expect(b.registrations()).toBe(0);
    expect(report).toEqual({ databases: 4, caches: 1, serviceWorkers: 1 });
  });

  it('does not hang on a database still open in this tab, and keeps going after a failure', async () => {
    const b = fakeBrowser({ blocked: ['firebase-heartbeat-database'], failCaches: true });
    const started = Date.now();
    await eraseBrowserData(b.g);
    expect(Date.now() - started).toBeLessThan(5000);
    expect([...b.dbs]).toEqual(['firebase-heartbeat-database']);
    expect(b.registrations()).toBe(0);
  });

  it('works where storage APIs are missing', async () => {
    await expect(eraseBrowserData({} as typeof globalThis)).resolves.toEqual({ databases: 0, caches: 0, serviceWorkers: 0 });
  });
});
