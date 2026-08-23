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
  YOUTH_FAMILY_OFFER,
} = require("../lib/membershipPlans");
const {
  assertProductionClosedConfig,
} = require("./verifyProductionConfig");
const {
  APPROVED_LIVE_STRIPE_CATALOGUE,
  matchesApprovedLiveStripeCatalogueEntry,
} = require("../lib/stripeLiveCatalog");
const {redactProviderSecrets} = require("./stripeCliTestKey");

function couponIdForPromotionCode(promotionCode) {
  return typeof promotionCode.promotion?.coupon === "string" ?
    promotionCode.promotion.coupon : promotionCode.promotion?.coupon?.id;
}

function isValidRedemptionCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

async function main() {
  const environment = assertProductionClosedConfig(process.env, {
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
    const approved = APPROVED_LIVE_STRIPE_CATALOGUE[planKey];
    const priceId = environment[approved.priceEnvKey];
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
      matchesApprovedLiveStripeCatalogueEntry(price, product, approved);
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
    promotionCode.expires_at !== null ||
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

  const familyCoupon = await stripe.coupons.retrieve(
    environment.STRIPE_YOUTH_FAMILY_COUPON_ID,
    {expand: ["applies_to"]}
  );
  const expectedYouthProducts = YOUTH_FAMILY_OFFER.eligiblePlanKeys
    .map((planKey) => productsByPlan.get(planKey)).sort();
  const familyProducts = [...(familyCoupon.applies_to?.products ?? [])].sort();
  if (familyCoupon.deleted === true || familyCoupon.livemode !== true ||
    familyCoupon.valid !== true ||
    familyCoupon.percent_off !== YOUTH_FAMILY_OFFER.percentOff ||
    familyCoupon.amount_off !== null || familyCoupon.currency !== null ||
    familyCoupon.duration !== "forever" ||
    familyCoupon.duration_in_months !== null ||
    familyCoupon.redeem_by !== null || familyCoupon.max_redemptions !== null ||
    familyProducts.length !== expectedYouthProducts.length ||
    familyProducts.some((productId, index) =>
      productId !== expectedYouthProducts[index])) {
    throw new Error("The LIVE youth family Coupon does not match the approved offer.");
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
  console.log(`- Youth family Coupon: ${familyCoupon.id}`);
  console.log(`- Customer Portal: ${portal.id}`);
}

main().catch((error) => {
  console.error(
    `Stripe LIVE preflight failed: ${redactProviderSecrets(error.message)}`
  );
  process.exitCode = 1;
});
