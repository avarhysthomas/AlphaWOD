const assert = require("node:assert/strict");
const test = require("node:test");

const {
  assertFrontendProductionEnvironment,
  parseExpectedPurchaseEnabled,
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
    REACT_APP_MEMBERSHIP_PURCHASE_ENABLED: "false",
  };
}

test("accepts the production Firebase browser config with local gates closed", () => {
  assert.equal(
    assertFrontendProductionEnvironment(validEnvironment()),
    false
  );
});

test("requires an exact explicit public purchase gate", () => {
  for (const value of [undefined, "", "TRUE", " true", "1"]) {
    assert.throws(
      () => assertFrontendProductionEnvironment({
        ...validEnvironment(),
        REACT_APP_MEMBERSHIP_PURCHASE_ENABLED: value,
      }),
      /must be explicitly set to true or false/i
    );
  }

  assert.equal(assertFrontendProductionEnvironment({
    ...validEnvironment(),
    REACT_APP_MEMBERSHIP_PURCHASE_ENABLED: "true",
  }), true);
});

test("checks the requested armed, rollback and open frontend state", () => {
  assert.doesNotThrow(() =>
    assertFrontendProductionEnvironment(validEnvironment(), false)
  );
  assert.throws(
    () => assertFrontendProductionEnvironment({
      ...validEnvironment(),
      REACT_APP_MEMBERSHIP_PURCHASE_ENABLED: "true",
    }, false),
    /must be false/i
  );
  assert.throws(
    () => assertFrontendProductionEnvironment(validEnvironment(), true),
    /must be true/i
  );
  assert.doesNotThrow(() =>
    assertFrontendProductionEnvironment({
      ...validEnvironment(),
      REACT_APP_MEMBERSHIP_PURCHASE_ENABLED: "true",
    }, true)
  );
});

test("parses only the two explicit frontend state checks", () => {
  assert.equal(parseExpectedPurchaseEnabled([]), undefined);
  assert.equal(
    parseExpectedPurchaseEnabled(["--expect-purchase-closed"]),
    false
  );
  assert.equal(
    parseExpectedPurchaseEnabled(["--expect-purchase-open"]),
    true
  );
  assert.throws(() => parseExpectedPurchaseEnabled(["--unknown"]));
  assert.throws(() => parseExpectedPurchaseEnabled([
    "--expect-purchase-closed",
    "--expect-purchase-open",
  ]));
});

test("rejects placeholders, emulator use and the local membership journey", () => {
  for (const mutation of [
    {REACT_APP_FIREBASE_API_KEY: "replace_with_production_web_api_key"},
    {REACT_APP_FIREBASE_APPCHECK_SITE_KEY: ""},
    {REACT_APP_USE_EMULATORS: "true"},
    {REACT_APP_MEMBERSHIP_TEST_JOURNEY_ENABLED: "true"},
    {REACT_APP_FIREBASE_PROJECT_ID: "demo-alphawod-stripe"},
    {REACT_APP_FIREBASE_MESSAGING_SENDER_ID: "not-numeric"},
    {REACT_APP_FIREBASE_APP_ID: "1:987654321:web:abcdef"},
    {REACT_APP_FIREBASE_AUTH_DOMAIN: "other-project.firebaseapp.com"},
    {REACT_APP_FIREBASE_STORAGE_BUCKET: "other-project.appspot.com"},
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

test("accepts a Vercel preview wired to a separate Firebase project", () => {
  assert.doesNotThrow(
    () => assertFrontendProductionEnvironment({
      ...validEnvironment(),
      REACT_APP_FIREBASE_AUTH_DOMAIN: "alphawod-staging.firebaseapp.com",
      REACT_APP_FIREBASE_PROJECT_ID: "alphawod-staging",
      REACT_APP_FIREBASE_STORAGE_BUCKET: "alphawod-staging.firebasestorage.app",
      REACT_APP_FIREBASE_MESSAGING_SENDER_ID: "987654321",
      REACT_APP_FIREBASE_APP_ID: "1:987654321:web:fedcba",
      VERCEL: "1",
      VERCEL_ENV: "preview",
    })
  );
});
