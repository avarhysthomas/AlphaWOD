/* eslint-disable @typescript-eslint/no-var-requires */

const assert = require("node:assert/strict");
const test = require("node:test");

const {__testing: membershipTesting} = require("../lib/membership");

const ENVIRONMENT_KEYS = [
  "FIREBASE_AUTH_EMULATOR_HOST",
  "FIREBASE_CONFIG",
  "FIRESTORE_EMULATOR_HOST",
  "FUNCTIONS_EMULATOR",
  "GCLOUD_PROJECT",
  "GOOGLE_CLOUD_PROJECT",
  "MEMBERSHIP_FIREBASE_PROJECT_ID",
  "STRIPE_EXPECTED_MODE",
  "STRIPE_SECRET_KEY",
];

/**
 * Captures only the environment variables these boundary tests mutate.
 * @return {Object<string, (string|undefined)>} Captured environment values.
 */
function preserveEnvironment() {
  return Object.fromEntries(
    ENVIRONMENT_KEYS.map((key) => [key, process.env[key]])
  );
}

/**
 * Restores the environment variables captured before a boundary test.
 * @param {Object<string, (string|undefined)>} original Captured values.
 * @return {void}
 */
function restoreEnvironment(original) {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("live Stripe mode is rejected by every Functions emulator process", () => {
  const original = preserveEnvironment();
  try {
    process.env.GCLOUD_PROJECT = "alpha-wod-functions-test";
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.FIREBASE_CONFIG;
    process.env.MEMBERSHIP_FIREBASE_PROJECT_ID = "alpha-wod-functions-test";
    process.env.STRIPE_EXPECTED_MODE = "live";
    process.env.STRIPE_SECRET_KEY = "rk_live_restricted_fake";
    delete process.env.FUNCTIONS_EMULATOR;
    delete process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;

    assert.equal(
      membershipTesting.assertBillingEnvironment().stripeMode,
      "live"
    );

    process.env.FUNCTIONS_EMULATOR = "true";
    assert.throws(
      () => membershipTesting.assertBillingEnvironment(),
      /live mode is forbidden in every Firebase emulator process/i
    );
  } finally {
    restoreEnvironment(original);
  }
});

test("secrets are omitted only for the exact isolated demo emulator", () => {
  const original = preserveEnvironment();
  const marker = {name: "sentinel-secret"};
  try {
    process.env.FUNCTIONS_EMULATOR = "true";
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099";
    process.env.GCLOUD_PROJECT = "demo-alphawod-stripe";
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.FIREBASE_CONFIG;

    assert.deepEqual(membershipTesting.secretsForRuntime([marker]), []);

    process.env.GCLOUD_PROJECT = "alphawod-d1f2f";
    assert.deepEqual(membershipTesting.secretsForRuntime([marker]), [marker]);

    process.env.GCLOUD_PROJECT = "demo-alphawod-stripe";
    delete process.env.FUNCTIONS_EMULATOR;
    assert.deepEqual(membershipTesting.secretsForRuntime([marker]), [marker]);

    process.env.FUNCTIONS_EMULATOR = "true";
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "auth.example.test:9099";
    assert.deepEqual(membershipTesting.secretsForRuntime([marker]), [marker]);
  } finally {
    restoreEnvironment(original);
  }
});
