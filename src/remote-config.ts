import { SDK_VERSION, type FirebaseApp } from 'firebase/app';
import { ensureInitialized, fetchAndActivate, getRemoteConfig, getValue } from 'firebase/remote-config';
import type { OutboundLedger } from './core/ledger';
import { DEFAULT_SETTINGS, parseSettings, SETTING_KEYS, settingsDefaults, type AppSettings } from './core/settings';

export interface LoadedSettings {
  settings: AppSettings;
  /** 'firebase' when at least one value came from the Remote Config template. */
  from: 'firebase' | 'built-in';
}

/**
 * Reads the three app settings from Firebase Remote Config. Never blocks the app: offline, on
 * timeout or on any error, the built-in defaults are used. When a request actually leaves the
 * device (not served from the browser cache), it is written to the outbound ledger with what
 * the SDK sends: a random install ID created by Firebase, the app ID, the browser language and
 * the SDK version. No statement data, no custom signals.
 */
export async function loadSettings(app: FirebaseApp, ledger: OutboundLedger): Promise<LoadedSettings> {
  const fallback: LoadedSettings = { settings: DEFAULT_SETTINGS, from: 'built-in' };
  try {
    const rc = getRemoteConfig(app);
    rc.settings.fetchTimeoutMillis = 4000;
    rc.settings.minimumFetchIntervalMillis = import.meta.env.DEV ? 60_000 : 3_600_000;
    rc.defaultConfig = settingsDefaults();
    await ensureInitialized(rc);
    const before = rc.fetchTimeMillis;
    if (navigator.onLine) {
      try {
        await fetchAndActivate(rc);
      } catch {
        /* keep the cached or default values */
      }
    }
    if (rc.fetchTimeMillis !== before && rc.fetchTimeMillis > 0) {
      const entry = ledger.record('app_settings', {
        asks_for: [...SETTING_KEYS],
        app_instance_id: 'random ID created by Firebase for this browser',
        app_id: 'this app',
        language_code: navigator.language,
        sdk_version: SDK_VERSION,
        statement_data: 'none',
      });
      ledger.setSource(entry, 'firebase');
    }
    const raw: Record<string, string> = {};
    let remote = false;
    for (const key of SETTING_KEYS) {
      const v = getValue(rc, key);
      raw[key] = v.asString();
      remote ||= v.getSource() === 'remote';
    }
    return { settings: parseSettings(raw), from: remote ? 'firebase' : 'built-in' };
  } catch {
    return fallback;
  }
}
