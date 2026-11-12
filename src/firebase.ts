import { initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';

declare global {
  // eslint-disable-next-line no-var
  var FIREBASE_APPCHECK_DEBUG_TOKEN: boolean | string | undefined;
}
/** Set by vite.config.ts for the dev server only; always empty in a production build. */
declare const __APPCHECK_DEBUG_TOKEN__: string;

// Each variable is read as import.meta.env.VITE_..., never through the whole import.meta.env
// object: Vite would otherwise copy every VITE_ variable into the published bundle.

/** Returns null when no Firebase config is provided: the app then runs in offline demo mode. */
export function initFirebase(): FirebaseApp | null {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  const appId = import.meta.env.VITE_FIREBASE_APP_ID;
  if (!apiKey || !projectId || !appId) return null;

  const app = initializeApp({ apiKey, authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN, projectId, appId });

  // App Check is required by Firebase AI Logic. Debug tokens are accepted in local development.
  if (import.meta.env.DEV) {
    globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN = __APPCHECK_DEBUG_TOKEN__ || true;
  }
  const siteKey = import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY;
  if (siteKey || import.meta.env.DEV) {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(siteKey || 'debug-mode'),
      isTokenAutoRefreshEnabled: true,
    });
  }
  return app;
}
