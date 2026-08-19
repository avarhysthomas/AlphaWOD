/* eslint-disable no-console, max-len, require-jsdoc */

/**
 * Read-only preflight for the real Stripe test catalogue. It deliberately
 * refuses live credentials and the production Firebase project, then retrieves
 * (but never mutates) the configured Prices, Products and optional Portal
 * configuration.
 */

const Stripe = require("stripe");
const {MEMBERSHIP_PLANS, PLAN_KEYS} = require("../lib/membershipPlans");
const {redactProviderSecrets, stripeCliTestKey} = require("./stripeCliTestKey");

const TEST_PROJECT_ID = "demo-alphawod-stripe";
const PRICE_ENV_KEYS = {
  adult_unlimited: "STRIPE_PRICE_ADULT_UNLIMITED",
  adult_ladies: "STRIPE_PRICE_ADULT_LADIES",
  adult_gym: "STRIPE_PRICE_ADULT_GYM",
  youth_youngstars: "STRIPE_PRICE_YOUTH_YOUNGSTARS",
  youth_teenstars: "STRIPE_PRICE_YOUTH_TEENSTARS",
};

function required(name) {
  const value = process.env[name]?.trim();
  if (!value || value.startsWith("replace_")) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function assertLocalTestBoundary() {
  if (process.env.MEMBERSHIP_FIREBASE_PROJECT_ID !== TEST_PROJECT_ID) {
    throw new Error(`MEMBERSHIP_FIREBASE_PROJECT_ID must be ${TEST_PROJECT_ID}.`);
  }
  if (process.env.STRIPE_EXPECTED_MODE !== "test") {
    throw new Error("STRIPE_EXPECTED_MODE must be test.");
  }
  if (process.env.MEMBERSHIP_TEST_JOURNEY_ENABLED !== "true") {
    throw new Error("MEMBERSHIP_TEST_JOURNEY_ENABLED must be true.");
  }
  const approvedOrigins = new Set([
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3002",
    "http://127.0.0.1:3002",
  ]);
  if (!approvedOrigins.has(process.env.APP_PUBLIC_ORIGIN)) {
    throw new Error("APP_PUBLIC_ORIGIN must be an approved local test origin.");
  }
  if (process.env.STRIPE_API_HOST) {
    throw new Error("Unset STRIPE_API_HOST: this preflight must reach Stripe test mode.");
  }
  return stripeCliTestKey();
}

async function main() {
  const key = assertLocalTestBoundary();
  const stripe = new Stripe(key, {maxNetworkRetries: 2, timeout: 20000});
  const verified = [];

  for (const planKey of PLAN_KEYS) {
    const plan = MEMBERSHIP_PLANS[planKey];
    const priceId = required(PRICE_ENV_KEYS[planKey]);
    const price = await stripe.prices.retrieve(priceId, {expand: ["product"]});
    const product = typeof price.product === "object" && price.product &&
      !price.product.deleted ? price.product : null;
    const valid = price.livemode === false &&
      price.active === true &&
      price.currency.toLowerCase() === plan.currency &&
      price.unit_amount === plan.amountPence &&
      price.type === "recurring" &&
      price.recurring?.interval === "month" &&
      price.recurring?.interval_count === 1 &&
      product?.livemode === false &&
      product.active === true &&
      product.name === plan.name;
    if (!valid) {
      throw new Error(`${planKey} does not match the approved test catalogue.`);
    }
    verified.push({planKey, priceId: price.id, productId: product.id});
  }

  const portalConfigurationId = process.env.STRIPE_PORTAL_CONFIGURATION_ID?.trim();
  if (portalConfigurationId) {
    const configuration = await stripe.billingPortal.configurations.retrieve(
      portalConfigurationId
    );
    if (configuration.livemode !== false || configuration.active !== true ||
      configuration.login_page.enabled !== false ||
      configuration.features.customer_update.enabled !== false ||
      configuration.features.invoice_history.enabled !== true ||
      configuration.features.payment_method_update.enabled !== true ||
      configuration.features.subscription_cancel.enabled !== false ||
      configuration.features.subscription_update.enabled !== false ||
      configuration.features.subscription_pause?.enabled === true) {
      throw new Error("The test Customer Portal configuration is not locked down.");
    }
  }

  console.log("Stripe test catalogue verified (read-only):");
  verified.forEach(({planKey, priceId, productId}) =>
    console.log(`- ${planKey}: ${priceId} -> ${productId}`)
  );
  console.log(portalConfigurationId ?
    `- Customer Portal: ${portalConfigurationId}` :
    "- Customer Portal: not configured (Checkout can run; management cannot)");
}

main().catch((error) => {
  console.error(`Stripe test preflight failed: ${redactProviderSecrets(error.message)}`);
  process.exitCode = 1;
});
