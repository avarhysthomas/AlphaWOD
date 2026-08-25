/* eslint-disable @typescript-eslint/no-var-requires, require-jsdoc, max-len */

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  KNOWN_TEST_PROVIDER_IDS,
  assertProductionArmedConfig,
  assertProductionClosedConfig,
  assertProductionOpeningConfig,
  assertProductionPreparationConfig,
} = require("../scripts/verifyProductionConfig");
const {
  APPROVED_LIVE_STRIPE_CATALOGUE,
} = require("../lib/stripeLiveCatalog");

function validEnvironment() {
  return {
    APP_PUBLIC_ORIGIN: "https://alpha-wod.vercel.app",
    MEMBERSHIP_CHECKOUT_APP_ID: "1:123456789:web:abcdef123456",
    MEMBERSHIP_FIREBASE_PROJECT_ID: "alphawod-d1f2f",
    MEMBERSHIP_FROM_EMAIL: "hello@zeroalphafitness.co.uk",
    MEMBERSHIP_PURCHASE_ENABLED: "false",
    MEMBERSHIP_TEST_JOURNEY_ENABLED: "false",
    STRIPE_EXPECTED_MODE: "live",
    STRIPE_PORTAL_CONFIGURATION_ID: "bpc_LivePortal",
    STRIPE_PRICE_ADULT_UNLIMITED:
      APPROVED_LIVE_STRIPE_CATALOGUE.adult_unlimited.priceId,
    STRIPE_PRICE_ADULT_LADIES:
      APPROVED_LIVE_STRIPE_CATALOGUE.adult_ladies.priceId,
    STRIPE_PRICE_ADULT_GYM:
      APPROVED_LIVE_STRIPE_CATALOGUE.adult_gym.priceId,
    STRIPE_PRICE_YOUTH_YOUNGSTARS:
      APPROVED_LIVE_STRIPE_CATALOGUE.youth_youngstars.priceId,
    STRIPE_PRICE_YOUTH_TEENSTARS:
      APPROVED_LIVE_STRIPE_CATALOGUE.youth_teenstars.priceId,
    STRIPE_EXISTING_MEMBER_COUPON_ID: "zaf_existing_member_live_2026",
    STRIPE_EXISTING_MEMBER_PROMOTION_CODE_ID: "promo_LiveSharedCode",
    STRIPE_YOUTH_FAMILY_COUPON_ID: "zaf_youth_family_10pct_2026",
  };
}

function assertValid(environment = validEnvironment()) {
  return assertProductionPreparationConfig(environment, {documentsApproved: false});
}

test("accepts complete production parameters only while both gates are closed", () => {
  assert.doesNotThrow(() => assertValid());
});

test("accepts the final opening configuration only while both gates are open", () => {
  assert.doesNotThrow(() => assertProductionOpeningConfig({
    ...validEnvironment(),
    MEMBERSHIP_PURCHASE_ENABLED: "true",
  }, {documentsApproved: true}));
  assert.throws(() => assertProductionOpeningConfig(validEnvironment(), {
    documentsApproved: true,
  }));
  assert.throws(() => assertProductionOpeningConfig({
    ...validEnvironment(),
    MEMBERSHIP_PURCHASE_ENABLED: "true",
  }, {documentsApproved: false}));
});

test("accepts the armed state and closed live checks without opening purchase", () => {
  assert.doesNotThrow(() => assertProductionArmedConfig(validEnvironment(), {
    documentsApproved: true,
  }));
  assert.throws(() => assertProductionArmedConfig(validEnvironment(), {
    documentsApproved: false,
  }));
  assert.doesNotThrow(() => assertProductionClosedConfig(validEnvironment(), {
    documentsApproved: false,
  }));
  assert.doesNotThrow(() => assertProductionClosedConfig(validEnvironment(), {
    documentsApproved: true,
  }));
});

test("rejects missing and placeholder production parameters", () => {
  for (const mutation of [
    {STRIPE_PRICE_ADULT_GYM: ""},
    {STRIPE_PORTAL_CONFIGURATION_ID: "replace_with_live_portal_configuration_id"},
    {MEMBERSHIP_CHECKOUT_APP_ID: "replace_with_production_firebase_web_app_id"},
    {MEMBERSHIP_CHECKOUT_APP_ID: "not-a-firebase-app-id"},
    {MEMBERSHIP_FROM_EMAIL: "local@example.invalid"},
  ]) {
    assert.throws(() => assertValid({...validEnvironment(), ...mutation}));
  }
});

test("rejects open gates, test mode, local origins and provider overrides", () => {
  for (const mutation of [
    {MEMBERSHIP_PURCHASE_ENABLED: "true"},
    {MEMBERSHIP_TEST_JOURNEY_ENABLED: "true"},
    {STRIPE_EXPECTED_MODE: "test"},
    {MEMBERSHIP_FIREBASE_PROJECT_ID: "demo-alphawod-stripe"},
    {APP_PUBLIC_ORIGIN: "http://localhost:3002"},
    {STRIPE_API_HOST: "127.0.0.1"},
  ]) {
    assert.throws(() => assertValid({...validEnvironment(), ...mutation}));
  }
  assert.throws(() =>
    assertProductionPreparationConfig(validEnvironment(), {documentsApproved: true})
  );
});

test("rejects every checked-in Stripe test object ID", () => {
  const assignmentByPrefix = {
    bpc: "STRIPE_PORTAL_CONFIGURATION_ID",
    price: "STRIPE_PRICE_ADULT_UNLIMITED",
    zaf: "STRIPE_EXISTING_MEMBER_COUPON_ID",
    promo: "STRIPE_EXISTING_MEMBER_PROMOTION_CODE_ID",
  };
  for (const testId of KNOWN_TEST_PROVIDER_IDS) {
    const assignment = assignmentByPrefix[testId.split("_", 1)[0]];
    assert.ok(assignment, `No production parameter covers ${testId}.`);
    assert.throws(() => assertValid({
      ...validEnvironment(),
      [assignment]: testId,
    }));
  }
});

test("rejects an unapproved or swapped live Price ID", () => {
  assert.throws(() => assertValid({
    ...validEnvironment(),
    STRIPE_PRICE_ADULT_GYM: "price_OtherLiveGym",
  }), /approved LIVE Price/i);
  assert.throws(() => assertValid({
    ...validEnvironment(),
    STRIPE_PRICE_ADULT_GYM:
      APPROVED_LIVE_STRIPE_CATALOGUE.adult_ladies.priceId,
    STRIPE_PRICE_ADULT_LADIES:
      APPROVED_LIVE_STRIPE_CATALOGUE.adult_gym.priceId,
  }), /approved LIVE Price/i);
});

test("rejects non-live secrets when an operator supplies them to preflight", () => {
  for (const mutation of [
    {STRIPE_SECRET_KEY: "sk_test_not_allowed"},
    {STRIPE_WEBHOOK_SECRET: "replace_with_webhook_secret"},
    {RESEND_API_KEY: "re_test_local_email_disabled"},
  ]) {
    assert.throws(() => assertValid({...validEnvironment(), ...mutation}));
  }
});
