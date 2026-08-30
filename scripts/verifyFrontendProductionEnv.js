/* eslint-disable no-console */

const PRODUCTION_FIREBASE_PROJECT_ID = "alphawod-d1f2f";
const FRONTEND_PURCHASE_GATE_NAME =
  "REACT_APP_MEMBERSHIP_PURCHASE_ENABLED";
const CONDITIONING_PURCHASE_GATE_NAME =
  "REACT_APP_ADULT_CONDITIONING_PURCHASE_ENABLED";
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
 * @param {boolean} expectedConditioningEnabled Required Conditioning state.
 * @return {boolean} Whether the frontend purchase gate is open.
 */
function assertFrontendProductionEnvironment(
  environment,
  expectedPurchaseEnabled = undefined,
  expectedConditioningEnabled = false
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
  const conditioningPurchaseEnabled = requiredBoolean(
    environment,
    CONDITIONING_PURCHASE_GATE_NAME
  );
  if (conditioningPurchaseEnabled && !purchaseEnabled) {
    throw new Error(
      `${CONDITIONING_PURCHASE_GATE_NAME} requires ${FRONTEND_PURCHASE_GATE_NAME}.`
    );
  }
  if (expectedPurchaseEnabled !== undefined &&
    purchaseEnabled !== expectedPurchaseEnabled) {
    throw new Error(
      `${FRONTEND_PURCHASE_GATE_NAME} must be ${expectedPurchaseEnabled}.`
    );
  }
  if (conditioningPurchaseEnabled !== expectedConditioningEnabled) {
    throw new Error(
      `${CONDITIONING_PURCHASE_GATE_NAME} must be ${expectedConditioningEnabled}.`
    );
  }

  return purchaseEnabled;
}

function parseExpectedPurchaseStates(argumentsList) {
  const allowed = new Set([
    "--expect-purchase-closed",
    "--expect-purchase-open",
    "--expect-conditioning-closed",
    "--expect-conditioning-open",
  ]);
  const unknown = argumentsList.filter((argument) => !allowed.has(argument));
  const purchaseArguments = argumentsList.filter((argument) =>
    argument.startsWith("--expect-purchase-"));
  const conditioningArguments = argumentsList.filter((argument) =>
    argument.startsWith("--expect-conditioning-"));
  if (unknown.length > 0 || purchaseArguments.length > 1 ||
    conditioningArguments.length > 1) {
    throw new Error(
      "Use at most one open/closed expectation for each frontend purchase gate."
    );
  }
  return {
    purchaseEnabled: purchaseArguments[0] === "--expect-purchase-open" ? true :
      purchaseArguments[0] === "--expect-purchase-closed" ? false : undefined,
    conditioningEnabled:
      conditioningArguments[0] === "--expect-conditioning-open",
  };
}

if (require.main === module) {
  try {
    const expected = parseExpectedPurchaseStates(
      process.argv.slice(2)
    );
    const purchaseEnabled = assertFrontendProductionEnvironment(
      process.env,
      expected.purchaseEnabled,
      expected.conditioningEnabled
    );
    console.log(
      "Frontend production environment verified; emulator and test-journey " +
      `switches are closed and the frontend purchase gate is ${
        purchaseEnabled ? "open" : "closed"
      }; Adult Conditioning is ${
        expected.conditioningEnabled ? "open" : "closed"
      }.`
    );
  } catch (error) {
    console.error(`Frontend production preflight failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  CONDITIONING_PURCHASE_GATE_NAME,
  FRONTEND_PURCHASE_GATE_NAME,
  PRODUCTION_FIREBASE_PROJECT_ID,
  REQUIRED_FIREBASE_WEB_KEYS,
  assertFrontendProductionEnvironment,
  parseExpectedPurchaseStates,
};
