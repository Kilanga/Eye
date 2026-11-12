import { initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';

declare global {
  // eslint-disable-next-line no-var
  var FIREBASE_APPCHECK_DEBUG_TOKEN: boolean | string | undefined;
}

const env = import.meta.env;

/** Returns null when no Firebase config is provided: the app then runs in offline demo mode. */
export function initFirebase(): FirebaseApp | null {
  if (!env.VITE_FIREBASE_API_KEY || !env.VITE_FIREBASE_PROJECT_ID || !env.VITE_FIREBASE_APP_ID) return null;

  const app = initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  });

  // App Check is required by Firebase AI Logic. Debug tokens are accepted in local development.
  if (env.DEV) {
    globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN = env.VITE_APPCHECK_DEBUG_TOKEN || true;
  }
  const siteKey = env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY;
  if (siteKey || env.DEV) {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(siteKey || 'debug-mode'),
      isTokenAutoRefreshEnabled: true,
    });
  }
  return app;
}
