const assert = require("node:assert/strict");
const test = require("node:test");

const {
  assertFrontendProductionEnvironment,
} = require("./verifyFrontendProductionEnv");

function validEnvironment() {
  return {
    REACT_APP_FIREBASE_API_KEY: "public-web-key",
    REACT_APP_FIREBASE_AUTH_DOMAIN: "alphawod-d1f2f.firebaseapp.com",
    REACT_APP_FIREBASE_PROJECT_ID: "alphawod-d1f2f",
    REACT_APP_FIREBASE_STORAGE_BUCKET: "alphawod-d1f2f.firebasestorage.app",
    REACT_APP_FIREBASE_MESSAGING_SENDER_ID: "123456789",
    REACT_APP_FIREBASE_APP_ID: "1:123456789:web:abcdef",
    REACT_APP_FIREBASE_APPCHECK_SITE_KEY: "6LcProductionSiteKey",
    REACT_APP_USE_EMULATORS: "false",
    REACT_APP_MEMBERSHIP_TEST_JOURNEY_ENABLED: "false",
  };
}

test("accepts the production Firebase browser config with local gates closed", () => {
  assert.doesNotThrow(() =>
    assertFrontendProductionEnvironment(validEnvironment())
  );
});

test("rejects placeholders, emulator use and the local membership journey", () => {
  for (const mutation of [
    {REACT_APP_FIREBASE_API_KEY: "replace_with_production_web_api_key"},
    {REACT_APP_FIREBASE_APPCHECK_SITE_KEY: ""},
    {REACT_APP_USE_EMULATORS: "true"},
    {REACT_APP_MEMBERSHIP_TEST_JOURNEY_ENABLED: "true"},
    {REACT_APP_FIREBASE_PROJECT_ID: "demo-alphawod-stripe"},
  ]) {
    assert.throws(() =>
      assertFrontendProductionEnvironment({...validEnvironment(), ...mutation})
    );
  }
});

test("rejects a Vercel preview wired to production Firebase", () => {
  assert.throws(
    () => assertFrontendProductionEnvironment({
      ...validEnvironment(),
      VERCEL: "1",
      VERCEL_ENV: "preview",
    }),
    /preview\/development build may not connect to production Firebase/i
  );
});
