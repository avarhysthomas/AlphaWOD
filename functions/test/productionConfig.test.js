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
  APPROVED_LIVE_PAYG_CATALOGUE,
  APPROVED_LIVE_STRIPE_CATALOGUE,
} = require("../lib/stripeLiveCatalog");

function validEnvironment() {
  return {
    APP_PUBLIC_ORIGIN: "https://alpha-wod.vercel.app",
    ADULT_CONDITIONING_LEGAL_APPROVED: "false",
    ADULT_CONDITIONING_PURCHASE_ENABLED: "false",
    MEMBERSHIP_CHECKOUT_APP_ID: "1:123456789:web:abcdef123456",
    MEMBERSHIP_FIREBASE_PROJECT_ID: "alphawod-d1f2f",
    MEMBERSHIP_FROM_EMAIL: "hello@zeroalphafitness.co.uk",
    MEMBERSHIP_PURCHASE_ENABLED: "false",
    MEMBERSHIP_TEST_JOURNEY_ENABLED: "false",
    PAYG_AVAILABILITY_ENABLED: "false",
    PAYG_FIREBASE_PROJECT_ID: "alphawod-d1f2f",
    PAYG_FROM_EMAIL: "Zero Alpha Fitness <hello@zeroalphafitness.co.uk>",
    PAYG_LEGAL_APPROVED: "false",
    PAYG_PII_REDACTION_IMPLEMENTED: "true",
    PAYG_PII_RETENTION_APPROVED: "false",
    PAYG_PII_RETENTION_POLICY_VERSION: "payg-retention-2026-01",
    PAYG_ORDER_PII_RETENTION_DAYS: "90",
    PAYG_WAIVER_PII_RETENTION_DAYS: "2190",
    PAYG_PRODUCT_TAX_CODE: "txcd_50021001",
    PAYG_REPLY_TO_EMAIL: "support@zeroalphafitness.co.uk",
    PAYG_CANCELLATION_TOKEN_KEY_ID: "cancel-v1",
    PAYG_CANCELLATION_TOKEN_PREVIOUS_KEY_ID: "",
    PAYG_CANCELLATION_TOKEN_PREVIOUS_VALID_UNTIL: "",
    PAYG_DUPLICATE_LOCK_KEY_ID: "lock-v1",
    PAYG_DUPLICATE_LOCK_PREVIOUS_KEY_ID: "",
    PAYG_DUPLICATE_LOCK_PREVIOUS_VALID_UNTIL: "",
    PAYG_WAIVER_VERSION: "PAYG-WAIVER-2026-01",
    PAYG_WAIVER_PUBLIC_URL: "/legal/PAYG-WAIVER-2026-01.txt",
    PAYG_WAIVER_SHA256: "a".repeat(64),
    PAYG_TERMS_VERSION: "PAYG-TERMS-2026-01",
    PAYG_TERMS_PUBLIC_URL: "/legal/PAYG-TERMS-2026-01.txt",
    PAYG_TERMS_SHA256: "b".repeat(64),
    STRIPE_EXPECTED_MODE: "live",
    STRIPE_PORTAL_CONFIGURATION_ID: "bpc_LivePortal",
    STRIPE_PRICE_ADULT_UNLIMITED:
      APPROVED_LIVE_STRIPE_CATALOGUE.adult_unlimited.priceId,
    STRIPE_PRICE_ADULT_CONDITIONING:
      APPROVED_LIVE_STRIPE_CATALOGUE.adult_conditioning.priceId,
    STRIPE_PRICE_ADULT_LADIES:
      APPROVED_LIVE_STRIPE_CATALOGUE.adult_ladies.priceId,
    STRIPE_PRICE_ADULT_GYM:
      APPROVED_LIVE_STRIPE_CATALOGUE.adult_gym.priceId,
    STRIPE_PRICE_YOUTH_YOUNGSTARS:
      APPROVED_LIVE_STRIPE_CATALOGUE.youth_youngstars.priceId,
    STRIPE_PRICE_YOUTH_TEENSTARS:
      APPROVED_LIVE_STRIPE_CATALOGUE.youth_teenstars.priceId,
    STRIPE_PRICE_ADULT_PAYG_CLASS: APPROVED_LIVE_PAYG_CATALOGUE.priceId,
    STRIPE_EXISTING_MEMBER_COUPON_ID: "zaf_existing_member_live_2026",
    STRIPE_EXISTING_MEMBER_PROMOTION_CODE_ID: "promo_LiveSharedCode",
    STRIPE_YOUTH_FAMILY_COUPON_ID: "zaf_youth_family_15pct_2026",
  };
}

function assertValid(environment = validEnvironment()) {
  return assertProductionPreparationConfig(environment, {documentsApproved: false});
}

test("accepts complete production parameters only while both gates are closed", () => {
  assert.doesNotThrow(() => assertValid());
});

test("supports independent existing-membership and Conditioning opening checks", () => {
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
  assert.doesNotThrow(() => assertProductionOpeningConfig({
    ...validEnvironment(),
    MEMBERSHIP_PURCHASE_ENABLED: "true",
    ADULT_CONDITIONING_PURCHASE_ENABLED: "true",
    ADULT_CONDITIONING_LEGAL_APPROVED: "true",
  }, {
    conditioningEnabled: true,
    documentsApproved: true,
  }));
  assert.throws(() => assertProductionOpeningConfig({
    ...validEnvironment(),
    MEMBERSHIP_PURCHASE_ENABLED: "true",
    ADULT_CONDITIONING_PURCHASE_ENABLED: "true",
  }, {
    conditioningEnabled: true,
    documentsApproved: true,
  }), /updated membership documents are approved/i);
});

test("PAYG opening requires the implemented worker and exact approved retention", () => {
  const paygOpening = {
    ...validEnvironment(),
    PAYG_AVAILABILITY_ENABLED: "true",
    PAYG_LEGAL_APPROVED: "true",
    PAYG_PII_RETENTION_APPROVED: "true",
  };
  assert.doesNotThrow(() => assertProductionOpeningConfig(paygOpening, {
    documentsApproved: false,
    membershipEnabled: false,
    paygEnabled: true,
  }));
  assert.throws(() => assertProductionOpeningConfig({
    ...paygOpening,
    PAYG_PII_REDACTION_IMPLEMENTED: "false",
  }, {
    documentsApproved: false,
    membershipEnabled: false,
    paygEnabled: true,
  }), /PAYG_PII_REDACTION_IMPLEMENTED must be true/i);
  for (const mutation of [
    {PAYG_ORDER_PII_RETENTION_DAYS: "89"},
    {PAYG_WAIVER_PII_RETENTION_DAYS: "2191"},
  ]) {
    assert.throws(() => assertProductionOpeningConfig({
      ...paygOpening,
      ...mutation,
    }, {
      documentsApproved: false,
      membershipEnabled: false,
      paygEnabled: true,
    }), /must match the approved/i);
  }
});

test("accepts the armed state and closed live checks without opening purchase", () => {
  assert.doesNotThrow(() => assertProductionArmedConfig(validEnvironment(), {
    documentsApproved: true,
  }));
  assert.doesNotThrow(() => assertProductionArmedConfig({
    ...validEnvironment(),
    ADULT_CONDITIONING_LEGAL_APPROVED: "true",
    PAYG_LEGAL_APPROVED: "true",
    PAYG_PII_RETENTION_APPROVED: "true",
  }, {documentsApproved: true}));
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

test("never accepts product review drafts as PAYG publication evidence", () => {
  for (const mutation of [
    {
      PAYG_WAIVER_VERSION: "ZAF-PAYG-WAIVER-DRAFT-2026-08-31-01",
      PAYG_WAIVER_PUBLIC_URL:
        "/legal/product-drafts/ZAF-PAYG-WAIVER-DRAFT-2026-08-31-01.txt",
    },
    {
      PAYG_TERMS_PUBLIC_URL: "/legal/other-document.txt",
    },
  ]) {
    assert.throws(() => assertProductionArmedConfig({
      ...validEnvironment(),
      PAYG_LEGAL_APPROVED: "true",
      ...mutation,
    }, {documentsApproved: true}), /publication evidence|immutable same-origin/i);
  }
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
    {ADULT_CONDITIONING_PURCHASE_ENABLED: "true"},
    {ADULT_CONDITIONING_LEGAL_APPROVED: "true"},
    {PAYG_AVAILABILITY_ENABLED: "true"},
    {PAYG_LEGAL_APPROVED: "true"},
    {PAYG_PII_RETENTION_APPROVED: "true"},
    {PAYG_PII_REDACTION_IMPLEMENTED: "false"},
    {MEMBERSHIP_TEST_JOURNEY_ENABLED: "true"},
    {STRIPE_EXPECTED_MODE: "test"},
    {MEMBERSHIP_FIREBASE_PROJECT_ID: "demo-alphawod-stripe"},
    {PAYG_FIREBASE_PROJECT_ID: "demo-alphawod-stripe"},
    {PAYG_PRODUCT_TAX_CODE: "txcd_99999999"},
    {PAYG_CANCELLATION_TOKEN_KEY_ID: "INVALID KEY"},
    {PAYG_DUPLICATE_LOCK_KEY_ID: "lock-v1", PAYG_DUPLICATE_LOCK_PREVIOUS_KEY_ID: "old-lock"},
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
  assert.throws(() => assertValid({
    ...validEnvironment(),
    STRIPE_PRICE_ADULT_PAYG_CLASS: "price_OtherLivePayg",
  }), /approved LIVE PAYG Price/i);
});

test("rejects non-live secrets when an operator supplies them to preflight", () => {
  for (const mutation of [
    {STRIPE_SECRET_KEY: "sk_test_not_allowed"},
    {STRIPE_WEBHOOK_SECRET: "replace_with_webhook_secret"},
    {RESEND_API_KEY: "re_test_local_email_disabled"},
    {PAYG_CANCELLATION_TOKEN_SECRET: "replace_with_a_real_secret"},
    {PAYG_CHECKOUT_RATE_LIMIT_SECRET: "replace_with_a_real_secret"},
    {PAYG_DUPLICATE_LOCK_SECRET: "replace_with_a_real_secret"},
    {PAYG_CANCELLATION_TOKEN_PREVIOUS_SECRET: "test_previous_secret"},
  ]) {
    assert.throws(() => assertValid({...validEnvironment(), ...mutation}));
  }
});

test("validates paired previous-key rotation horizons", () => {
  assert.doesNotThrow(() => assertValid({
    ...validEnvironment(),
    PAYG_CANCELLATION_TOKEN_PREVIOUS_KEY_ID: "cancel-v0",
    PAYG_CANCELLATION_TOKEN_PREVIOUS_VALID_UNTIL: "2099-01-01T00:00:00Z",
    PAYG_DUPLICATE_LOCK_PREVIOUS_KEY_ID: "lock-v0",
    PAYG_DUPLICATE_LOCK_PREVIOUS_VALID_UNTIL: "2099-01-01T00:00:00Z",
  }));
  assert.throws(() => assertValid({
    ...validEnvironment(),
    PAYG_DUPLICATE_LOCK_PREVIOUS_KEY_ID: "lock-v0",
  }), /configured together/i);
  assert.throws(() => assertValid({
    ...validEnvironment(),
    PAYG_CANCELLATION_TOKEN_PREVIOUS_KEY_ID: "cancel-v1",
    PAYG_CANCELLATION_TOKEN_PREVIOUS_VALID_UNTIL: "not-a-date",
  }), /valid and distinct|ISO-8601/i);
});
