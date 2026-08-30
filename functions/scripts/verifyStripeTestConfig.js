/* eslint-disable no-console, max-len, require-jsdoc */

/**
 * Read-only preflight for the real Stripe test catalogue. It deliberately
 * refuses live credentials and the production Firebase project, then retrieves
 * (but never mutates) the configured Prices, Products, existing-member offer
 * and optional Portal configuration.
 */

const Stripe = require("stripe");
const {
  EXISTING_MEMBER_OFFER,
  MEMBERSHIP_PLANS,
  PLAN_KEYS,
  PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS,
  YOUTH_FAMILY_OFFER,
} = require("../lib/membershipPlans");
const {
  APPROVED_TEST_PAYG_CATALOGUE,
  matchesApprovedLivePaygCatalogueEntry,
} = require("../lib/stripeLiveCatalog");
const {redactProviderSecrets, stripeCliTestKey} = require("./stripeCliTestKey");

const TEST_PROJECT_ID = "demo-alphawod-stripe";
const PRICE_ENV_KEYS = {
  adult_unlimited: "STRIPE_PRICE_ADULT_UNLIMITED",
  adult_conditioning: "STRIPE_PRICE_ADULT_CONDITIONING",
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

function isValidRedemptionCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function couponIdForPromotionCode(promotionCode) {
  return typeof promotionCode.promotion?.coupon === "string" ?
    promotionCode.promotion.coupon : promotionCode.promotion?.coupon?.id;
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
  const productsByPlan = new Map();

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
    productsByPlan.set(planKey, product.id);
  }

  const paygApproved = APPROVED_TEST_PAYG_CATALOGUE;
  const paygPrice = await stripe.prices.retrieve(
    required(paygApproved.priceEnvKey),
    {expand: ["product"]}
  );
  const paygProduct = typeof paygPrice.product === "object" &&
    paygPrice.product && !paygPrice.product.deleted ? paygPrice.product : null;
  if (paygPrice.livemode !== false || paygPrice.active !== true ||
    paygPrice.currency.toLowerCase() !== paygApproved.currency ||
    paygPrice.unit_amount !== paygApproved.amountPence ||
    paygProduct?.livemode !== false || paygProduct.active !== true ||
    !matchesApprovedLivePaygCatalogueEntry(
      paygPrice,
      paygProduct,
      paygApproved
    )) {
    throw new Error("adult_payg_class does not match the approved test catalogue.");
  }

  const couponId = process.env.STRIPE_EXISTING_MEMBER_COUPON_ID?.trim();
  const promotionCodeId = process.env.STRIPE_EXISTING_MEMBER_PROMOTION_CODE_ID?.trim();
  let sharedPromotionCodeVerified = false;
  if (!couponId && Date.now() < PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS * 1000) {
    throw new Error("STRIPE_EXISTING_MEMBER_COUPON_ID is required during the presale.");
  }
  if (!couponId && promotionCodeId) {
    throw new Error(
      "STRIPE_EXISTING_MEMBER_PROMOTION_CODE_ID requires STRIPE_EXISTING_MEMBER_COUPON_ID."
    );
  }
  if (couponId) {
    if (!promotionCodeId || promotionCodeId.startsWith("replace_")) {
      throw new Error(
        "STRIPE_EXISTING_MEMBER_PROMOTION_CODE_ID is required with the presale Coupon."
      );
    }
    const coupon = await stripe.coupons.retrieve(couponId, {
      expand: ["applies_to"],
    });
    const allowedProductId = productsByPlan.get(EXISTING_MEMBER_OFFER.planKey);
    const appliesToProducts = coupon.applies_to?.products ?? [];
    const validCoupon = coupon.deleted !== true &&
      coupon.livemode === false &&
      coupon.valid === true &&
      coupon.amount_off === EXISTING_MEMBER_OFFER.amountOffPence &&
      coupon.currency?.toLowerCase() === EXISTING_MEMBER_OFFER.currency &&
      coupon.percent_off === null &&
      coupon.duration === "repeating" &&
      coupon.duration_in_months === EXISTING_MEMBER_OFFER.durationMonths &&
      coupon.redeem_by === null &&
      coupon.max_redemptions === null &&
      appliesToProducts.length === 1 &&
      appliesToProducts[0] === allowedProductId;
    if (!validCoupon) {
      throw new Error(
        "STRIPE_EXISTING_MEMBER_COUPON_ID does not match the approved test offer."
      );
    }

    const promotionCode = await stripe.promotionCodes.retrieve(promotionCodeId);
    const restrictions = promotionCode.restrictions;
    const currencyOptions = restrictions.currency_options ?? {};
    const validPromotionCode = promotionCode.livemode === false &&
      promotionCode.active === true &&
      couponIdForPromotionCode(promotionCode) === coupon.id &&
      promotionCode.max_redemptions === null &&
      isValidRedemptionCount(promotionCode.times_redeemed) &&
      promotionCode.expires_at === null &&
      promotionCode.customer === null &&
      promotionCode.customer_account === null &&
      restrictions.first_time_transaction === false &&
      restrictions.minimum_amount === null &&
      restrictions.minimum_amount_currency === null &&
      Object.keys(currencyOptions).length === 0;
    if (!validPromotionCode) {
      throw new Error(
        `Promotion Code ${promotionCode.id} is not the approved shared reusable code.`
      );
    }

    const activePromotionCodeIds = [];
    for await (const activePromotionCode of stripe.promotionCodes.list({
      active: true,
      coupon: coupon.id,
      limit: 100,
    })) {
      activePromotionCodeIds.push(activePromotionCode.id);
    }
    if (activePromotionCodeIds.length !== 1 ||
      activePromotionCodeIds[0] !== promotionCode.id) {
      throw new Error(
        "The allowlisted Promotion Code must be the Coupon's only active Promotion Code."
      );
    }
    sharedPromotionCodeVerified = true;
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
  console.log(`- adult_payg_class: ${paygPrice.id} -> ${paygProduct.id}`);
  console.log(portalConfigurationId ?
    `- Customer Portal: ${portalConfigurationId}` :
    "- Customer Portal: not configured (Checkout can run; management cannot)");
  console.log(couponId ?
    `- Existing-member Coupon: ${couponId}` :
    "- Existing-member offer: disabled (STRIPE_EXISTING_MEMBER_COUPON_ID is unset)");
  if (sharedPromotionCodeVerified) {
    console.log(`- Shared reusable Promotion Code: ${promotionCodeId}`);
  }

  const familyCouponId = required("STRIPE_YOUTH_FAMILY_COUPON_ID");
  const familyCoupon = await stripe.coupons.retrieve(familyCouponId, {
    expand: ["applies_to"],
  });
  const expectedYouthProducts = YOUTH_FAMILY_OFFER.eligiblePlanKeys
    .map((planKey) => productsByPlan.get(planKey)).sort();
  const familyProducts = [...(familyCoupon.applies_to?.products ?? [])].sort();
  if (familyCoupon.deleted === true || familyCoupon.livemode !== false ||
    familyCoupon.valid !== true ||
    familyCoupon.percent_off !== YOUTH_FAMILY_OFFER.percentOff ||
    familyCoupon.amount_off !== null || familyCoupon.currency !== null ||
    familyCoupon.duration !== "forever" ||
    familyCoupon.duration_in_months !== null ||
    familyCoupon.redeem_by !== null || familyCoupon.max_redemptions !== null ||
    familyProducts.length !== expectedYouthProducts.length ||
    familyProducts.some((productId, index) =>
      productId !== expectedYouthProducts[index])) {
    throw new Error(
      "STRIPE_YOUTH_FAMILY_COUPON_ID does not match the approved test offer."
    );
  }
  console.log(`- Youth family Coupon: ${familyCoupon.id}`);
}

main().catch((error) => {
  console.error(`Stripe test preflight failed: ${redactProviderSecrets(error.message)}`);
  process.exitCode = 1;
});
