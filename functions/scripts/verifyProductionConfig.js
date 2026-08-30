/* eslint-disable no-console, max-len, require-jsdoc */

const PRODUCTION_FIREBASE_PROJECT_ID = "alphawod-d1f2f";
const {
  APPROVED_LIVE_PAYG_CATALOGUE,
  APPROVED_LIVE_STRIPE_CATALOGUE,
  APPROVED_TEST_PAYG_CATALOGUE,
} = require("../lib/stripeLiveCatalog");

const PRICE_ENV_KEYS = Object.values(APPROVED_LIVE_STRIPE_CATALOGUE)
  .map(({priceEnvKey}) => priceEnvKey);

const REQUIRED_PARAMETER_KEYS = [
  "APP_PUBLIC_ORIGIN",
  "ADULT_CONDITIONING_LEGAL_APPROVED",
  "ADULT_CONDITIONING_PURCHASE_ENABLED",
  "MEMBERSHIP_CHECKOUT_APP_ID",
  "MEMBERSHIP_FIREBASE_PROJECT_ID",
  "MEMBERSHIP_FROM_EMAIL",
  "MEMBERSHIP_PURCHASE_ENABLED",
  "MEMBERSHIP_TEST_JOURNEY_ENABLED",
  "PAYG_AVAILABILITY_ENABLED",
  "PAYG_FIREBASE_PROJECT_ID",
  "PAYG_FROM_EMAIL",
  "PAYG_LEGAL_APPROVED",
  "PAYG_PII_REDACTION_IMPLEMENTED",
  "PAYG_PII_RETENTION_APPROVED",
  "PAYG_PRODUCT_TAX_CODE",
  "PAYG_REPLY_TO_EMAIL",
  "PAYG_CANCELLATION_TOKEN_KEY_ID",
  "PAYG_DUPLICATE_LOCK_KEY_ID",
  "STRIPE_EXPECTED_MODE",
  "STRIPE_PORTAL_CONFIGURATION_ID",
  "STRIPE_EXISTING_MEMBER_COUPON_ID",
  "STRIPE_EXISTING_MEMBER_PROMOTION_CODE_ID",
  "STRIPE_YOUTH_FAMILY_COUPON_ID",
  APPROVED_LIVE_PAYG_CATALOGUE.priceEnvKey,
  ...PRICE_ENV_KEYS,
];

const PAYG_LEGAL_EVIDENCE_KEYS = [
  "PAYG_WAIVER_VERSION",
  "PAYG_WAIVER_PUBLIC_URL",
  "PAYG_WAIVER_SHA256",
  "PAYG_TERMS_VERSION",
  "PAYG_TERMS_PUBLIC_URL",
  "PAYG_TERMS_SHA256",
];

const PAYG_RETENTION_EVIDENCE_KEYS = [
  "PAYG_PII_RETENTION_POLICY_VERSION",
  "PAYG_ORDER_PII_RETENTION_DAYS",
  "PAYG_WAIVER_PII_RETENTION_DAYS",
];

// These provider IDs are checked into the isolated sandbox example. Stripe's
// opaque IDs do not otherwise reveal their mode, so reject every known value
// offline and still retrieve every configured live object in the API preflight.
const KNOWN_TEST_PROVIDER_IDS = new Set([
  "bpc_1U5sNqFzNDZoGGA0gY8sswiI",
  "price_1U5PS5FzNDZoGGA0rPLiyQ2Q",
  "price_1UA47fFzNDZoGGA0lgyZPUZ9",
  APPROVED_TEST_PAYG_CATALOGUE.priceId,
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

function assertBooleanParameter(environment, name) {
  const value = required(environment, name);
  if (value !== "true" && value !== "false") {
    throw new Error(`${name} must be explicitly true or false.`);
  }
  return value === "true";
}

function assertKeyRotationParameters(environment, prefix) {
  const currentKid = required(environment, `${prefix}_KEY_ID`);
  if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(currentKid)) {
    throw new Error(`${prefix}_KEY_ID must be a stable lowercase key ID.`);
  }
  const previousKid = environment[`${prefix}_PREVIOUS_KEY_ID`]?.trim() ?? "";
  const previousValidUntil =
    environment[`${prefix}_PREVIOUS_VALID_UNTIL`]?.trim() ?? "";
  if (Boolean(previousKid) !== Boolean(previousValidUntil)) {
    throw new Error(
      `${prefix}_PREVIOUS_KEY_ID and ${prefix}_PREVIOUS_VALID_UNTIL ` +
      "must be configured together."
    );
  }
  if (previousKid) {
    if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(previousKid) ||
      previousKid === currentKid) {
      throw new Error(`${prefix} previous key ID must be valid and distinct.`);
    }
    if (!Number.isFinite(Date.parse(previousValidUntil))) {
      throw new Error(`${prefix}_PREVIOUS_VALID_UNTIL must be ISO-8601.`);
    }
  }
}

function assertPaygLegalEvidence(environment, origin) {
  const values = Object.fromEntries(
    PAYG_LEGAL_EVIDENCE_KEYS.map((name) => [name, required(environment, name)])
  );
  for (const kind of ["WAIVER", "TERMS"]) {
    const version = values[`PAYG_${kind}_VERSION`];
    const digest = values[`PAYG_${kind}_SHA256`];
    if (!/^[A-Za-z0-9._-]{3,120}$/.test(version) ||
      !/^[a-f0-9]{64}$/.test(digest)) {
      throw new Error(`PAYG ${kind.toLowerCase()} publication evidence is invalid.`);
    }
    let url;
    try {
      url = new URL(values[`PAYG_${kind}_PUBLIC_URL`], origin);
    } catch {
      throw new Error(`PAYG ${kind.toLowerCase()} publication URL is invalid.`);
    }
    if (url.origin !== origin || !url.pathname.startsWith("/legal/") ||
      url.search || url.hash) {
      throw new Error(
        `PAYG ${kind.toLowerCase()} must use an immutable same-origin /legal/ URL.`
      );
    }
  }
}

function assertPaygRetentionEvidence(environment) {
  const values = Object.fromEntries(
    PAYG_RETENTION_EVIDENCE_KEYS.map((name) => [name, required(environment, name)])
  );
  if (!/^[A-Za-z0-9._-]{3,120}$/.test(
    values.PAYG_PII_RETENTION_POLICY_VERSION
  )) {
    throw new Error("PAYG PII retention policy version is invalid.");
  }
  for (const name of [
    "PAYG_ORDER_PII_RETENTION_DAYS",
    "PAYG_WAIVER_PII_RETENTION_DAYS",
  ]) {
    if (!/^(0|[1-9]\d{0,4})$/.test(values[name]) ||
      Number(values[name]) > 36_500) {
      throw new Error(`${name} must be an approved whole-day value.`);
    }
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
  const cancellationTokenSecret =
    environment.PAYG_CANCELLATION_TOKEN_SECRET?.trim();
  if (cancellationTokenSecret &&
    (cancellationTokenSecret.length < 32 || /replace|example|test/i.test(
      cancellationTokenSecret
    ))) {
    throw new Error(
      "PAYG_CANCELLATION_TOKEN_SECRET, when supplied, must be a strong non-placeholder secret."
    );
  }
  const checkoutRateLimitSecret =
    environment.PAYG_CHECKOUT_RATE_LIMIT_SECRET?.trim();
  if (checkoutRateLimitSecret &&
    (checkoutRateLimitSecret.length < 32 || /replace|example|test/i.test(
      checkoutRateLimitSecret
    ))) {
    throw new Error(
      "PAYG_CHECKOUT_RATE_LIMIT_SECRET, when supplied, must be a strong non-placeholder secret."
    );
  }
  for (const name of [
    "PAYG_CANCELLATION_TOKEN_PREVIOUS_SECRET",
    "PAYG_DUPLICATE_LOCK_SECRET",
    "PAYG_DUPLICATE_LOCK_PREVIOUS_SECRET",
  ]) {
    const value = environment[name]?.trim();
    if (value && (value.length < 32 || /replace|example|test/i.test(value))) {
      throw new Error(`${name}, when supplied, must be a strong non-placeholder secret.`);
    }
  }
}

function routingEmailAddress(value, name) {
  const address = value.match(/<([^<>]+)>$/)?.[1] ?? value;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ||
    /@(example\.(com|invalid)|test)$/i.test(address)) {
    throw new Error(`${name} must be a real production email address.`);
  }
}

function assertProductionConfig(
  environment,
  {
    conditioningPurchaseEnabled,
    documentsApproved,
    expectedDocumentsApproved,
    membershipPurchaseEnabled,
    paygEnabled,
    phase,
    productApprovalsAllowed,
  }
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
    membershipPurchaseEnabled ? "true" : "false"
  );
  assertExact(environment, "MEMBERSHIP_TEST_JOURNEY_ENABLED", "false");
  assertExact(
    environment,
    "ADULT_CONDITIONING_PURCHASE_ENABLED",
    conditioningPurchaseEnabled ? "true" : "false"
  );
  assertExact(
    environment,
    "PAYG_AVAILABILITY_ENABLED",
    paygEnabled ? "true" : "false"
  );
  const conditioningLegalApproved = assertBooleanParameter(
    environment,
    "ADULT_CONDITIONING_LEGAL_APPROVED"
  );
  const paygLegalApproved = assertBooleanParameter(
    environment,
    "PAYG_LEGAL_APPROVED"
  );
  const paygRetentionApproved = assertBooleanParameter(
    environment,
    "PAYG_PII_RETENTION_APPROVED"
  );
  assertExact(environment, "PAYG_PII_REDACTION_IMPLEMENTED", "false");
  if (conditioningPurchaseEnabled && !membershipPurchaseEnabled) {
    throw new Error(
      "Adult Conditioning purchase requires the shared membership purchase gate."
    );
  }
  if (conditioningPurchaseEnabled && !conditioningLegalApproved) {
    throw new Error(
      "Adult Conditioning cannot open until its updated membership documents are approved."
    );
  }
  if (!productApprovalsAllowed) {
    if (conditioningLegalApproved !== conditioningPurchaseEnabled) {
      throw new Error(
        "ADULT_CONDITIONING_LEGAL_APPROVED does not match this production phase."
      );
    }
    if (paygLegalApproved || paygRetentionApproved) {
      throw new Error(
        "PAYG legal and retention approvals must remain false during preparation."
      );
    }
  }
  assertExact(
    environment,
    "PAYG_FIREBASE_PROJECT_ID",
    PRODUCTION_FIREBASE_PROJECT_ID
  );
  assertExact(
    environment,
    "PAYG_PRODUCT_TAX_CODE",
    APPROVED_LIVE_PAYG_CATALOGUE.productTaxCode
  );
  if (expectedDocumentsApproved !== null &&
    documentsApproved !== expectedDocumentsApproved) {
    throw new Error(
      `CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION must be ` +
      `${expectedDocumentsApproved} during production ${phase}.`
    );
  }

  assertProductionOrigin(values.APP_PUBLIC_ORIGIN);
  assertKeyRotationParameters(environment, "PAYG_CANCELLATION_TOKEN");
  assertKeyRotationParameters(environment, "PAYG_DUPLICATE_LOCK");
  if (paygLegalApproved) {
    assertPaygLegalEvidence(environment, new URL(values.APP_PUBLIC_ORIGIN).origin);
  }
  if (paygRetentionApproved) {
    assertPaygRetentionEvidence(environment);
  }
  if (paygEnabled) {
    if (!paygLegalApproved || !paygRetentionApproved) {
      throw new Error(
        "PAYG opening requires approved legal and PII-retention evidence."
      );
    }
    throw new Error(
      "PAYG cannot open: approved automated PII redaction has not been implemented."
    );
  }
  if (!/^1:\d+:web:[a-f0-9]+$/i.test(values.MEMBERSHIP_CHECKOUT_APP_ID)) {
    throw new Error(
      "MEMBERSHIP_CHECKOUT_APP_ID must be the production Firebase web app ID."
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.MEMBERSHIP_FROM_EMAIL) ||
    /@(example\.(com|invalid)|test)$/i.test(values.MEMBERSHIP_FROM_EMAIL)) {
    throw new Error("MEMBERSHIP_FROM_EMAIL must be a real production sender address.");
  }
  routingEmailAddress(values.PAYG_FROM_EMAIL, "PAYG_FROM_EMAIL");
  routingEmailAddress(values.PAYG_REPLY_TO_EMAIL, "PAYG_REPLY_TO_EMAIL");

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

  const priceIds = [
    ...PRICE_ENV_KEYS.map((name) => values[name]),
    values[APPROVED_LIVE_PAYG_CATALOGUE.priceEnvKey],
  ];
  PRICE_ENV_KEYS.forEach((name) => assertId(values[name], name, "price"));
  assertId(
    values[APPROVED_LIVE_PAYG_CATALOGUE.priceEnvKey],
    APPROVED_LIVE_PAYG_CATALOGUE.priceEnvKey,
    "price"
  );
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
  if (values[APPROVED_LIVE_PAYG_CATALOGUE.priceEnvKey] !==
    APPROVED_LIVE_PAYG_CATALOGUE.priceId) {
    throw new Error(
      `${APPROVED_LIVE_PAYG_CATALOGUE.priceEnvKey} must use the approved LIVE PAYG Price.`
    );
  }

  assertOptionalSecrets(environment);
  return values;
}

function assertProductionPreparationConfig(environment, {documentsApproved}) {
  return assertProductionConfig(environment, {
    conditioningPurchaseEnabled: false,
    documentsApproved,
    expectedDocumentsApproved: false,
    membershipPurchaseEnabled: false,
    paygEnabled: false,
    phase: "preparation",
    productApprovalsAllowed: false,
  });
}

function assertProductionArmedConfig(environment, {documentsApproved}) {
  return assertProductionConfig(environment, {
    conditioningPurchaseEnabled: false,
    documentsApproved,
    expectedDocumentsApproved: true,
    membershipPurchaseEnabled: false,
    paygEnabled: false,
    phase: "armed rollout or rollback",
    productApprovalsAllowed: true,
  });
}

function assertProductionClosedConfig(environment, {documentsApproved}) {
  return assertProductionConfig(environment, {
    conditioningPurchaseEnabled: false,
    documentsApproved,
    expectedDocumentsApproved: null,
    membershipPurchaseEnabled: false,
    paygEnabled: false,
    phase: "closed provider verification",
    productApprovalsAllowed: true,
  });
}

function assertProductionOpeningConfig(environment, {
  conditioningEnabled = false,
  documentsApproved,
  membershipEnabled = true,
  paygEnabled = false,
}) {
  return assertProductionConfig(environment, {
    conditioningPurchaseEnabled: conditioningEnabled,
    documentsApproved,
    expectedDocumentsApproved:
      membershipEnabled || conditioningEnabled ? true : null,
    membershipPurchaseEnabled: membershipEnabled,
    paygEnabled,
    phase: "opening",
    productApprovalsAllowed: true,
  });
}

if (require.main === module) {
  try {
    const {
      CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION,
    } = require("../lib/membershipPlans");
    const argumentsList = process.argv.slice(2);
    const allowedArguments = new Set([
      "--armed",
      "--open-conditioning",
      "--open-payg",
      "--opening",
    ]);
    if (argumentsList.some((argument) => !allowedArguments.has(argument)) ||
      new Set(argumentsList).size !== argumentsList.length) {
      throw new Error("Production configuration arguments are invalid.");
    }
    const opening = argumentsList.includes("--opening");
    const openConditioning = argumentsList.includes("--open-conditioning");
    const openPayg = argumentsList.includes("--open-payg");
    const armed = argumentsList.includes("--armed");
    if (armed && (opening || openConditioning || openPayg)) {
      throw new Error("Choose only one production configuration phase.");
    }
    if (openConditioning && !opening) {
      throw new Error("Adult Conditioning opening requires --opening.");
    }
    if (opening || openPayg) {
      assertProductionOpeningConfig(process.env, {
        conditioningEnabled: openConditioning,
        documentsApproved: CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION,
        membershipEnabled: opening,
        paygEnabled: openPayg,
      });
    } else {
      const assertConfig = armed ?
        assertProductionArmedConfig : assertProductionPreparationConfig;
      assertConfig(process.env, {
        documentsApproved: CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION,
      });
    }
    console.log(
      opening || openPayg ?
        "Production opening preflight passed for the explicitly selected products." :
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
