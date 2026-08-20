/* eslint-disable no-console */

const PRODUCTION_FIREBASE_PROJECT_ID = "alphawod-d1f2f";
const FRONTEND_PURCHASE_GATE_NAME =
  "REACT_APP_MEMBERSHIP_PURCHASE_ENABLED";
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

function requiredBoolean(environment, name) {
  const value = environment[name];
  if (value !== "true" && value !== "false") {
    throw new Error(`${name} must be explicitly set to true or false.`);
  }
  return value === "true";
}

function assertFirebaseWebConfigShape(values) {
  const projectId = values.REACT_APP_FIREBASE_PROJECT_ID;
  const senderId = values.REACT_APP_FIREBASE_MESSAGING_SENDER_ID;
  const appIdMatch = values.REACT_APP_FIREBASE_APP_ID.match(
    /^1:(\d+):web:[a-f0-9]+$/i
  );
  if (!/^\d+$/.test(senderId) || !appIdMatch || appIdMatch[1] !== senderId) {
    throw new Error(
      "Firebase sender ID must be numeric and match the web App ID."
    );
  }
  if (values.REACT_APP_FIREBASE_AUTH_DOMAIN !== `${projectId}.firebaseapp.com`) {
    throw new Error("Firebase Auth domain must belong to the configured project.");
  }
  const approvedBuckets = new Set([
    `${projectId}.appspot.com`,
    `${projectId}.firebasestorage.app`,
  ]);
  if (!approvedBuckets.has(values.REACT_APP_FIREBASE_STORAGE_BUCKET)) {
    throw new Error("Firebase Storage bucket must belong to the configured project.");
  }
}

/**
 * Refuses a browser build that could use an emulator, the local Stripe journey,
 * a placeholder Firebase app, or production Firebase from a Vercel preview.
 *
 * @param {NodeJS.ProcessEnv|Record<string, string|undefined>} environment Env.
 * @param {boolean|undefined} expectedPurchaseEnabled Optional required state.
 * @return {boolean} Whether the frontend purchase gate is open.
 */
function assertFrontendProductionEnvironment(
  environment,
  expectedPurchaseEnabled = undefined
) {
  const values = Object.fromEntries(
    REQUIRED_FIREBASE_WEB_KEYS.map((name) => [name, required(environment, name)])
  );
  assertFirebaseWebConfigShape(values);

  const isVercelNonProduction = environment.VERCEL === "1" &&
    environment.VERCEL_ENV !== "production";
  if (isVercelNonProduction &&
    values.REACT_APP_FIREBASE_PROJECT_ID === PRODUCTION_FIREBASE_PROJECT_ID) {
    throw new Error(
      "A Vercel preview/development build may not connect to production Firebase."
    );
  }
  if (!isVercelNonProduction &&
    values.REACT_APP_FIREBASE_PROJECT_ID !== PRODUCTION_FIREBASE_PROJECT_ID) {
    throw new Error(
      `REACT_APP_FIREBASE_PROJECT_ID must be ${PRODUCTION_FIREBASE_PROJECT_ID}.`
    );
  }

  assertFalseOrUnset(environment, "REACT_APP_USE_EMULATORS");
  assertFalseOrUnset(
    environment,
    "REACT_APP_MEMBERSHIP_TEST_JOURNEY_ENABLED"
  );

  const purchaseEnabled = requiredBoolean(
    environment,
    FRONTEND_PURCHASE_GATE_NAME
  );
  if (expectedPurchaseEnabled !== undefined &&
    purchaseEnabled !== expectedPurchaseEnabled) {
    throw new Error(
      `${FRONTEND_PURCHASE_GATE_NAME} must be ${expectedPurchaseEnabled}.`
    );
  }

  return purchaseEnabled;
}

function parseExpectedPurchaseEnabled(argumentsList) {
  const allowed = new Set([
    "--expect-purchase-closed",
    "--expect-purchase-open",
  ]);
  const unknown = argumentsList.filter((argument) => !allowed.has(argument));
  if (unknown.length > 0 || argumentsList.length > 1) {
    throw new Error(
      "Use at most one of --expect-purchase-closed or --expect-purchase-open."
    );
  }
  if (argumentsList[0] === "--expect-purchase-closed") return false;
  if (argumentsList[0] === "--expect-purchase-open") return true;
  return undefined;
}

if (require.main === module) {
  try {
    const expectedPurchaseEnabled = parseExpectedPurchaseEnabled(
      process.argv.slice(2)
    );
    const purchaseEnabled = assertFrontendProductionEnvironment(
      process.env,
      expectedPurchaseEnabled
    );
    console.log(
      "Frontend production environment verified; emulator and test-journey " +
      `switches are closed and the frontend purchase gate is ${
        purchaseEnabled ? "open" : "closed"
      }.`
    );
  } catch (error) {
    console.error(`Frontend production preflight failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  FRONTEND_PURCHASE_GATE_NAME,
  PRODUCTION_FIREBASE_PROJECT_ID,
  REQUIRED_FIREBASE_WEB_KEYS,
  assertFrontendProductionEnvironment,
  parseExpectedPurchaseEnabled,
};
