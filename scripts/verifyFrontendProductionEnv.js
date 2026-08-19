/* eslint-disable no-console */

const PRODUCTION_FIREBASE_PROJECT_ID = "alphawod-d1f2f";
const REQUIRED_FIREBASE_WEB_KEYS = [
  "REACT_APP_FIREBASE_API_KEY",
  "REACT_APP_FIREBASE_AUTH_DOMAIN",
  "REACT_APP_FIREBASE_PROJECT_ID",
  "REACT_APP_FIREBASE_STORAGE_BUCKET",
  "REACT_APP_FIREBASE_MESSAGING_SENDER_ID",
  "REACT_APP_FIREBASE_APP_ID",
  "REACT_APP_FIREBASE_APPCHECK_SITE_KEY",
];

function required(environment, name) {
  const value = environment[name]?.trim();
  if (!value || /^replace(_with)?_/i.test(value)) {
    throw new Error(`${name} is required and cannot be a placeholder.`);
  }
  return value;
}

function assertFalseOrUnset(environment, name) {
  const value = environment[name]?.trim().toLowerCase();
  if (value && value !== "false") {
    throw new Error(`${name} must be false or unset in production.`);
  }
}

/**
 * Refuses a browser build that could use an emulator, the local Stripe journey,
 * a placeholder Firebase app, or production Firebase from a Vercel preview.
 *
 * @param {NodeJS.ProcessEnv|Record<string, string|undefined>} environment Env.
 * @return {void}
 */
function assertFrontendProductionEnvironment(environment) {
  const values = Object.fromEntries(
    REQUIRED_FIREBASE_WEB_KEYS.map((name) => [name, required(environment, name)])
  );

  if (values.REACT_APP_FIREBASE_PROJECT_ID !== PRODUCTION_FIREBASE_PROJECT_ID) {
    throw new Error(
      `REACT_APP_FIREBASE_PROJECT_ID must be ${PRODUCTION_FIREBASE_PROJECT_ID}.`
    );
  }
  if (environment.VERCEL === "1" && environment.VERCEL_ENV !== "production") {
    throw new Error(
      "A Vercel preview/development build may not connect to production Firebase."
    );
  }

  assertFalseOrUnset(environment, "REACT_APP_USE_EMULATORS");
  assertFalseOrUnset(
    environment,
    "REACT_APP_MEMBERSHIP_TEST_JOURNEY_ENABLED"
  );
}

if (require.main === module) {
  try {
    assertFrontendProductionEnvironment(process.env);
    console.log(
      "Frontend production environment verified; emulator and test-journey switches are closed."
    );
  } catch (error) {
    console.error(`Frontend production preflight failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  PRODUCTION_FIREBASE_PROJECT_ID,
  REQUIRED_FIREBASE_WEB_KEYS,
  assertFrontendProductionEnvironment,
};
