/* eslint-disable @typescript-eslint/no-var-requires, require-jsdoc */

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  APPROVED_LIVE_STRIPE_CATALOGUE,
  matchesApprovedLiveStripeCatalogueEntry,
} = require("../lib/stripeLiveCatalog");
const {
  MEMBERSHIP_PLANS,
  PLAN_KEYS,
} = require("../lib/membershipPlans");

test("approved LIVE Stripe catalogue matches every plan", () => {
  assert.deepEqual(Object.keys(APPROVED_LIVE_STRIPE_CATALOGUE), PLAN_KEYS);
  const productIds = new Set();
  const priceIds = new Set();
  const priceEnvKeys = new Set();

  for (const planKey of PLAN_KEYS) {
    const plan = MEMBERSHIP_PLANS[planKey];
    const approved = APPROVED_LIVE_STRIPE_CATALOGUE[planKey];
    assert.equal(approved.priceEnvKey, plan.stripePriceEnvKey);
    assert.equal(approved.amountPence, plan.amountPence);
    assert.equal(approved.currency, plan.currency);
    assert.equal(approved.interval, "month");
    assert.equal(approved.intervalCount, 1);
    assert.equal(approved.transformQuantity, null);
    assert.equal(approved.trialPeriodDays, null);
    assert.match(approved.productId, /^prod_[A-Za-z0-9]+$/);
    assert.match(approved.priceId, /^price_[A-Za-z0-9]+$/);
    productIds.add(approved.productId);
    priceIds.add(approved.priceId);
    priceEnvKeys.add(approved.priceEnvKey);
  }

  assert.equal(productIds.size, PLAN_KEYS.length);
  assert.equal(priceIds.size, PLAN_KEYS.length);
  assert.equal(priceEnvKeys.size, PLAN_KEYS.length);
});

function approvedProviderObjects(approved) {
  return {
    price: {
      id: approved.priceId,
      billing_scheme: approved.billingScheme,
      tax_behavior: approved.taxBehavior,
      transform_quantity: approved.transformQuantity,
      recurring: {
        usage_type: approved.usageType,
        trial_period_days: approved.trialPeriodDays,
      },
    },
    product: {
      id: approved.productId,
      name: approved.productName,
      tax_code: approved.productTaxCode,
    },
  };
}

test("approved LIVE catalogue accepts the exact frozen provider shape", () => {
  const approved = APPROVED_LIVE_STRIPE_CATALOGUE.adult_unlimited;
  const {price, product} = approvedProviderObjects(approved);

  assert.equal(matchesApprovedLiveStripeCatalogueEntry(
    price,
    product,
    approved
  ), true);
});

test("approved LIVE catalogue rejects drift in every frozen field", () => {
  const approved = APPROVED_LIVE_STRIPE_CATALOGUE.adult_unlimited;
  const {price, product} = approvedProviderObjects(approved);
  const mutations = [
    {label: "Price ID", price: {id: "price_unapproved"}},
    {label: "billing scheme", price: {billing_scheme: "tiered"}},
    {label: "usage type", recurring: {usage_type: "metered"}},
    {label: "tax behavior", price: {tax_behavior: "inclusive"}},
    {
      label: "quantity transform",
      price: {transform_quantity: {divide_by: 10, round: "down"}},
    },
    {label: "trial period", recurring: {trial_period_days: 14}},
    {label: "Product ID", product: {id: "prod_unapproved"}},
    {label: "Product name", product: {name: "Other product"}},
    {label: "Product tax code", product: {tax_code: "txcd_99999999"}},
  ];

  for (const mutation of mutations) {
    const candidatePrice = {
      ...price,
      ...mutation.price,
      ...(mutation.recurring ? {
        recurring: {...price.recurring, ...mutation.recurring},
      } : {}),
    };
    const candidateProduct = {...product, ...mutation.product};
    assert.equal(
      matchesApprovedLiveStripeCatalogueEntry(
        candidatePrice,
        candidateProduct,
        approved
      ),
      false,
      mutation.label
    );
  }
});
