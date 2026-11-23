/**
 * "Erase everything from this browser": removes every piece of data this site keeps in the
 * browser, not only the app's own two entries (follow-up summary, remembered answers) but also
 * what the Firebase SDK and reCAPTCHA keep for this site (install ID, cached app settings,
 * App Check token, heartbeat dates in IndexedDB; reCAPTCHA's entry in localStorage), the
 * offline copy of the app (Cache Storage) and the service worker.
 *
 * Statements are never stored, so there is nothing else. Each step is best effort: storage can
 * be missing or throw (private mode, sandboxed frames), and one failure must not stop the rest.
 */
export interface EraseReport {
  databases: number;
  caches: number;
  serviceWorkers: number;
}

/** How long to wait for a database that is still open in this tab before moving on. */
const BLOCKED_WAIT_MS = 1500;

export async function eraseBrowserData(g: typeof globalThis = globalThis): Promise<EraseReport> {
  const report: EraseReport = { databases: 0, caches: 0, serviceWorkers: 0 };
  try {
    g.localStorage?.clear();
  } catch {
    /* ignore */
  }
  try {
    g.sessionStorage?.clear();
  } catch {
    /* ignore */
  }
  try {
    const dbs = (await g.indexedDB?.databases?.()) ?? [];
    await Promise.all(
      dbs
        .map((d) => d.name)
        .filter((name): name is string => !!name)
        .map(
          (name) =>
            new Promise<void>((resolve) => {
              // A database Firebase still has open in this tab is deleted once the page reloads
              // and the connection closes: the request stays queued, so do not wait for it forever.
              const timer = setTimeout(resolve, BLOCKED_WAIT_MS);
              const done = () => {
                clearTimeout(timer);
                resolve();
              };
              const req = g.indexedDB.deleteDatabase(name);
              req.onsuccess = done;
              req.onerror = done;
              report.databases++;
            }),
        ),
    );
  } catch {
    /* ignore */
  }
  try {
    const keys = (await g.caches?.keys()) ?? [];
    for (const k of keys) if (await g.caches.delete(k)) report.caches++;
  } catch {
    /* ignore */
  }
  try {
    const regs = (await g.navigator?.serviceWorker?.getRegistrations()) ?? [];
    for (const r of regs) if (await r.unregister()) report.serviceWorkers++;
  } catch {
    /* ignore */
  }
  return report;
}
