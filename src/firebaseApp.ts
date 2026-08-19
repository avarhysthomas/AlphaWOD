import { initializeApp } from "firebase/app";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
} from "firebase/app-check";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
  measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID,
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

export const useEmulators = process.env.REACT_APP_USE_EMULATORS === "true";

const appCheckSiteKey = process.env.REACT_APP_FIREBASE_APPCHECK_SITE_KEY?.trim();
if (!useEmulators) {
  if (process.env.NODE_ENV === "production" && !appCheckSiteKey) {
    throw new Error(
      "REACT_APP_FIREBASE_APPCHECK_SITE_KEY is required for a production build."
    );
  }
  if (appCheckSiteKey) {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  }
}

/**
 * Local development against the Firebase emulators.
 *
 * Off unless `REACT_APP_USE_EMULATORS=true`, so a production build can never
 * pick this up: the variable is inlined at build time and is absent from the
 * deployment. Without it, `npm start` talks to the live project, which is
 * rarely what you want while testing a purchase flow.
 *
 * Auth and Functions are connected here because this module is imported before
 * any call is made through either. Firestore is connected where its instance is
 * created, in `firebase.ts`.
 */
export const FUNCTIONS_REGION = "europe-west1";

if (useEmulators) {
  // Every caller resolves the same cached instance for this app and region, so
  // connecting once here covers all of them.
  connectFunctionsEmulator(getFunctions(app, FUNCTIONS_REGION), "127.0.0.1", 5001);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });

  // eslint-disable-next-line no-console
  console.warn(
    "[AlphaWOD] Firebase emulators are in use. No production data is being read or written."
  );
}

export default app;
