/* eslint-disable no-console, max-len, require-jsdoc */

const PRODUCTION_FIREBASE_PROJECT_ID = "alphawod-d1f2f";
const {
  APPROVED_LIVE_STRIPE_CATALOGUE,
} = require("../lib/stripeLiveCatalog");

const PRICE_ENV_KEYS = Object.values(APPROVED_LIVE_STRIPE_CATALOGUE)
  .map(({priceEnvKey}) => priceEnvKey);

const REQUIRED_PARAMETER_KEYS = [
  "APP_PUBLIC_ORIGIN",
  "MEMBERSHIP_CHECKOUT_APP_ID",
  "MEMBERSHIP_FIREBASE_PROJECT_ID",
  "MEMBERSHIP_FROM_EMAIL",
  "MEMBERSHIP_PURCHASE_ENABLED",
  "MEMBERSHIP_TEST_JOURNEY_ENABLED",
  "STRIPE_EXPECTED_MODE",
  "STRIPE_PORTAL_CONFIGURATION_ID",
  "STRIPE_EXISTING_MEMBER_COUPON_ID",
  "STRIPE_EXISTING_MEMBER_PROMOTION_CODE_ID",
  "STRIPE_YOUTH_FAMILY_COUPON_ID",
  ...PRICE_ENV_KEYS,
];

// These provider IDs are checked into the isolated sandbox example. Stripe's
// opaque IDs do not otherwise reveal their mode, so reject every known value
// offline and still retrieve every configured live object in the API preflight.
const KNOWN_TEST_PROVIDER_IDS = new Set([
  "bpc_1U5sNqFzNDZoGGA0gY8sswiI",
  "price_1U5PS5FzNDZoGGA0rPLiyQ2Q",
  "price_1U5PKZFzNDZoGGA0xsnNcV2m",
  "price_1U5PJHFzNDZoGGA0izMSvHP1",
  "price_1U5PFZFzNDZoGGA06T2ggw4M",
  "price_1U7akwFzNDZoGGA0zOcCZthI",
  "price_1U5PEwFzNDZoGGA0d24UJaZd",
  "zaf_existing_member_5off_3mo_2026_test_v2",
  "zaf_youth_family_15pct_2026_test",
  "zaf_youth_family_10pct_2026_test",
  "promo_1U6AJYFzNDZoGGA0ybHPTeU6",
  "promo_1U6ThDFzNDZoGGA0OT0EaV8Z",
]);

function required(environment, name) {
  const value = environment[name]?.trim();
  if (!value || /^replace(_with)?_/i.test(value)) {
    throw new Error(`${name} is required and cannot be a placeholder.`);
  }
  return value;
}

function assertExact(environment, name, expected) {
  const value = required(environment, name);
  if (value !== expected) {
    throw new Error(`${name} must be ${expected}.`);
  }
  return value;
}

function assertId(value, name, prefix) {
  if (!new RegExp(`^${prefix}_[A-Za-z0-9_]+$`).test(value)) {
    throw new Error(`${name} must be a ${prefix}_... identifier.`);
  }
  if (KNOWN_TEST_PROVIDER_IDS.has(value) || /(^|_)test($|_)/i.test(value)) {
    throw new Error(`${name} must not use a known or labelled test-mode object.`);
  }
}

function assertProductionOrigin(rawOrigin) {
  let origin;
  try {
    origin = new URL(rawOrigin);
  } catch {
    throw new Error("APP_PUBLIC_ORIGIN must be a valid absolute URL.");
  }
  if (origin.protocol !== "https:" || origin.username || origin.password ||
    origin.search || origin.hash || (origin.pathname !== "/" && origin.pathname !== "")) {
    throw new Error("APP_PUBLIC_ORIGIN must be a bare HTTPS origin.");
  }
  const hostname = origin.hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1" ||
    hostname.endsWith(".localhost") || hostname.endsWith(".local") ||
    hostname.includes("-git-")) {
    throw new Error("APP_PUBLIC_ORIGIN must not be local or a preview deployment.");
  }
}

function assertOptionalSecrets(environment) {
  const stripeKey = environment.STRIPE_SECRET_KEY?.trim();
  if (stripeKey && !/^(sk|rk)_live_[A-Za-z0-9]+$/.test(stripeKey)) {
    throw new Error("STRIPE_SECRET_KEY, when supplied, must be a live-mode key.");
  }
  const webhookSecret = environment.STRIPE_WEBHOOK_SECRET?.trim();
  if (webhookSecret && (!/^whsec_[A-Za-z0-9]+$/.test(webhookSecret) ||
    /replace|test/i.test(webhookSecret))) {
    throw new Error("STRIPE_WEBHOOK_SECRET, when supplied, must be a non-placeholder whsec_ value.");
  }
  const resendKey = environment.RESEND_API_KEY?.trim();
  if (resendKey && (!/^re_[A-Za-z0-9_]+$/.test(resendKey) ||
    /^re_test/i.test(resendKey) || /replace/i.test(resendKey))) {
    throw new Error("RESEND_API_KEY, when supplied, must not be a test or placeholder key.");
  }
}

function assertProductionConfig(
  environment,
  {documentsApproved, expectedDocumentsApproved, purchaseEnabled, phase}
) {
  const values = Object.fromEntries(
    REQUIRED_PARAMETER_KEYS.map((name) => [name, required(environment, name)])
  );

  assertExact(
    environment,
    "MEMBERSHIP_FIREBASE_PROJECT_ID",
    PRODUCTION_FIREBASE_PROJECT_ID
  );
  assertExact(environment, "STRIPE_EXPECTED_MODE", "live");
  assertExact(
    environment,
    "MEMBERSHIP_PURCHASE_ENABLED",
    purchaseEnabled ? "true" : "false"
  );
  assertExact(environment, "MEMBERSHIP_TEST_JOURNEY_ENABLED", "false");
  if (expectedDocumentsApproved !== null &&
    documentsApproved !== expectedDocumentsApproved) {
    throw new Error(
      `CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION must be ` +
      `${expectedDocumentsApproved} during production ${phase}.`
    );
  }

  assertProductionOrigin(values.APP_PUBLIC_ORIGIN);
  if (!/^1:\d+:web:[a-f0-9]+$/i.test(values.MEMBERSHIP_CHECKOUT_APP_ID)) {
    throw new Error(
      "MEMBERSHIP_CHECKOUT_APP_ID must be the production Firebase web app ID."
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.MEMBERSHIP_FROM_EMAIL) ||
    /@(example\.(com|invalid)|test)$/i.test(values.MEMBERSHIP_FROM_EMAIL)) {
    throw new Error("MEMBERSHIP_FROM_EMAIL must be a real production sender address.");
  }

  if (environment.STRIPE_API_HOST || environment.STRIPE_API_PORT ||
    environment.STRIPE_API_PROTOCOL) {
    throw new Error("Stripe API host/port/protocol overrides are forbidden in production.");
  }

  assertId(values.STRIPE_PORTAL_CONFIGURATION_ID, "STRIPE_PORTAL_CONFIGURATION_ID", "bpc");
  assertId(values.STRIPE_EXISTING_MEMBER_PROMOTION_CODE_ID,
    "STRIPE_EXISTING_MEMBER_PROMOTION_CODE_ID", "promo");
  if (KNOWN_TEST_PROVIDER_IDS.has(values.STRIPE_EXISTING_MEMBER_COUPON_ID) ||
    /(^|_)test($|_)/i.test(values.STRIPE_EXISTING_MEMBER_COUPON_ID)) {
    throw new Error("STRIPE_EXISTING_MEMBER_COUPON_ID must not be a test Coupon.");
  }
  if (KNOWN_TEST_PROVIDER_IDS.has(values.STRIPE_YOUTH_FAMILY_COUPON_ID) ||
    /(^|_)test($|_)/i.test(values.STRIPE_YOUTH_FAMILY_COUPON_ID)) {
    throw new Error("STRIPE_YOUTH_FAMILY_COUPON_ID must not be a test Coupon.");
  }

  const priceIds = PRICE_ENV_KEYS.map((name) => values[name]);
  PRICE_ENV_KEYS.forEach((name) => assertId(values[name], name, "price"));
  if (new Set(priceIds).size !== priceIds.length) {
    throw new Error("Every membership plan must use its own Stripe Price ID.");
  }
  for (const [planKey, approved] of
    Object.entries(APPROVED_LIVE_STRIPE_CATALOGUE)) {
    if (values[approved.priceEnvKey] !== approved.priceId) {
      throw new Error(
        `${approved.priceEnvKey} must use the approved LIVE Price for ${planKey}.`
      );
    }
  }

  assertOptionalSecrets(environment);
  return values;
}

function assertProductionPreparationConfig(environment, {documentsApproved}) {
  return assertProductionConfig(environment, {
    documentsApproved,
    expectedDocumentsApproved: false,
    purchaseEnabled: false,
    phase: "preparation",
  });
}

function assertProductionArmedConfig(environment, {documentsApproved}) {
  return assertProductionConfig(environment, {
    documentsApproved,
    expectedDocumentsApproved: true,
    purchaseEnabled: false,
    phase: "armed rollout or rollback",
  });
}

function assertProductionClosedConfig(environment, {documentsApproved}) {
  return assertProductionConfig(environment, {
    documentsApproved,
    expectedDocumentsApproved: null,
    purchaseEnabled: false,
    phase: "closed provider verification",
  });
}

function assertProductionOpeningConfig(environment, {documentsApproved}) {
  return assertProductionConfig(environment, {
    documentsApproved,
    expectedDocumentsApproved: true,
    purchaseEnabled: true,
    phase: "opening",
  });
}

if (require.main === module) {
  try {
    const {
      CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION,
    } = require("../lib/membershipPlans");
    const opening = process.argv.includes("--opening");
    const armed = process.argv.includes("--armed");
    if (opening && armed) {
      throw new Error("Choose only one production configuration phase.");
    }
    const assertConfig = opening ? assertProductionOpeningConfig :
      armed ? assertProductionArmedConfig : assertProductionPreparationConfig;
    assertConfig(process.env, {
      documentsApproved: CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION,
    });
    console.log(
      opening ?
        "Production opening preflight passed with both membership purchase gates open." :
        armed ?
          "Production armed preflight passed with published documents and purchasing closed." :
          "Production preparation preflight passed with both membership purchase gates closed."
    );
  } catch (error) {
    console.error(`Production parameter preflight failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  KNOWN_TEST_PROVIDER_IDS,
  PRICE_ENV_KEYS,
  PRODUCTION_FIREBASE_PROJECT_ID,
  REQUIRED_PARAMETER_KEYS,
  assertProductionArmedConfig,
  assertProductionClosedConfig,
  assertProductionOpeningConfig,
  assertProductionPreparationConfig,
};
