/* eslint-disable no-console, max-len, require-jsdoc */

/**
 * Read-only preflight for the LIVE Stripe catalogue. It validates the closed
 * production boundary before making any API call, then retrieves every Price,
 * Product, Coupon, Promotion Code and Portal configuration. It never creates,
 * updates or deletes a Stripe object.
 */

const Stripe = require("stripe");
const {
  CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION,
  EXISTING_MEMBER_OFFER,
  MEMBERSHIP_PLANS,
  PLAN_KEYS,
  PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
} = require("../lib/membershipPlans");
const {
  PRICE_ENV_KEYS,
  assertProductionPreparationConfig,
} = require("./verifyProductionConfig");
const {redactProviderSecrets} = require("./stripeCliTestKey");

const PRICE_ENV_BY_PLAN = Object.fromEntries(
  PLAN_KEYS.map((planKey, index) => [planKey, PRICE_ENV_KEYS[index]])
);

function couponIdForPromotionCode(promotionCode) {
  return typeof promotionCode.promotion?.coupon === "string" ?
    promotionCode.promotion.coupon : promotionCode.promotion?.coupon?.id;
}

function isValidRedemptionCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

async function main() {
  const environment = assertProductionPreparationConfig(process.env, {
    documentsApproved: CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION,
  });
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key || !/^(sk|rk)_live_[A-Za-z0-9]+$/.test(key)) {
    throw new Error(
      "STRIPE_SECRET_KEY must be supplied securely as a live-mode key for this read-only check."
    );
  }

  const stripe = new Stripe(key, {maxNetworkRetries: 2, timeout: 20000});
  const verified = [];
  const productsByPlan = new Map();

  for (const planKey of PLAN_KEYS) {
    const plan = MEMBERSHIP_PLANS[planKey];
    const priceId = environment[PRICE_ENV_BY_PLAN[planKey]];
    const price = await stripe.prices.retrieve(priceId, {expand: ["product"]});
    const product = typeof price.product === "object" && price.product &&
      !price.product.deleted ? price.product : null;
    const valid = price.livemode === true &&
      price.active === true &&
      price.currency.toLowerCase() === plan.currency &&
      price.unit_amount === plan.amountPence &&
      price.type === "recurring" &&
      price.recurring?.interval === "month" &&
      price.recurring?.interval_count === 1 &&
      product?.livemode === true &&
      product.active === true &&
      product.name === plan.name;
    if (!valid) {
      throw new Error(`${planKey} does not match the approved LIVE catalogue.`);
    }
    verified.push({planKey, priceId: price.id, productId: product.id});
    productsByPlan.set(planKey, product.id);
  }

  const couponId = environment.STRIPE_EXISTING_MEMBER_COUPON_ID;
  const promotionCodeId = environment.STRIPE_EXISTING_MEMBER_PROMOTION_CODE_ID;
  const coupon = await stripe.coupons.retrieve(couponId, {expand: ["applies_to"]});
  const allowedProductId = productsByPlan.get(EXISTING_MEMBER_OFFER.planKey);
  const appliesToProducts = coupon.applies_to?.products ?? [];
  if (coupon.deleted === true || coupon.livemode !== true || coupon.valid !== true ||
    coupon.amount_off !== EXISTING_MEMBER_OFFER.amountOffPence ||
    coupon.currency?.toLowerCase() !== EXISTING_MEMBER_OFFER.currency ||
    coupon.percent_off !== null || coupon.duration !== "repeating" ||
    coupon.duration_in_months !== EXISTING_MEMBER_OFFER.durationMonths ||
    coupon.redeem_by !== null || coupon.max_redemptions !== null ||
    appliesToProducts.length !== 1 || appliesToProducts[0] !== allowedProductId) {
    throw new Error("The LIVE existing-member Coupon does not match the approved offer.");
  }

  const promotionCode = await stripe.promotionCodes.retrieve(promotionCodeId);
  const restrictions = promotionCode.restrictions;
  const currencyOptions = restrictions.currency_options ?? {};
  if (promotionCode.livemode !== true || promotionCode.active !== true ||
    couponIdForPromotionCode(promotionCode) !== coupon.id ||
    promotionCode.max_redemptions !== null ||
    !isValidRedemptionCount(promotionCode.times_redeemed) ||
    promotionCode.expires_at !== PRESALE_BILLING_ANCHOR_UNIX_SECONDS ||
    promotionCode.customer !== null || promotionCode.customer_account !== null ||
    restrictions.first_time_transaction !== false ||
    restrictions.minimum_amount !== null ||
    restrictions.minimum_amount_currency !== null ||
    Object.keys(currencyOptions).length !== 0) {
    throw new Error(
      "The LIVE Promotion Code is not the approved shared reusable code."
    );
  }

  const activePromotionCodeIds = [];
  for await (const activeCode of stripe.promotionCodes.list({
    active: true,
    coupon: coupon.id,
    limit: 100,
  })) {
    activePromotionCodeIds.push(activeCode.id);
  }
  if (activePromotionCodeIds.length !== 1 ||
    activePromotionCodeIds[0] !== promotionCode.id) {
    throw new Error(
      "The allowlisted LIVE Promotion Code must be the Coupon's only active Promotion Code."
    );
  }

  const portal = await stripe.billingPortal.configurations.retrieve(
    environment.STRIPE_PORTAL_CONFIGURATION_ID
  );
  if (portal.livemode !== true || portal.active !== true ||
    portal.login_page.enabled !== false ||
    portal.features.customer_update.enabled !== false ||
    portal.features.invoice_history.enabled !== true ||
    portal.features.payment_method_update.enabled !== true ||
    portal.features.subscription_cancel.enabled !== false ||
    portal.features.subscription_update.enabled !== false ||
    portal.features.subscription_pause?.enabled === true) {
    throw new Error("The LIVE Customer Portal configuration is not locked down.");
  }

  console.log("Stripe LIVE catalogue verified (read-only; purchase gates remain closed):");
  verified.forEach(({planKey, priceId, productId}) =>
    console.log(`- ${planKey}: ${priceId} -> ${productId}`)
  );
  console.log(`- Existing-member Coupon: ${coupon.id}`);
  console.log(`- Shared reusable Promotion Code: ${promotionCode.id}`);
  console.log(`- Customer Portal: ${portal.id}`);
}

main().catch((error) => {
  console.error(
    `Stripe LIVE preflight failed: ${redactProviderSecrets(error.message)}`
  );
  process.exitCode = 1;
});
