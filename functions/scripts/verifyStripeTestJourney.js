/* eslint-disable no-console, max-len, require-jsdoc */

/**
 * Read-only post-Checkout verifier. It checks a real Stripe test Session and
 * Subscription, then bounded-polls the isolated Firestore emulator for exact
 * webhook fulfilment, membership and confirmation-outbox correlation.
 */

const admin = require("firebase-admin");
const Stripe = require("stripe");
const {
  EXISTING_MEMBER_OFFER,
  PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
  PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS,
} = require("../lib/membershipPlans");
const {redactProviderSecrets, stripeCliTestKey} = require("./stripeCliTestKey");

const TEST_PROJECT_ID = "demo-alphawod-stripe";
const LOCAL_SUCCESS_ORIGIN = "http://localhost:3002";
const LOCAL_SUCCESS_PATH = "/memberships/success";
const CHECKOUT_SESSION_TEMPLATE = "{CHECKOUT_SESSION_ID}";
const PLAN_KEYS = new Set([
  "adult_unlimited",
  "adult_ladies",
  "adult_gym",
  "youth_youngstars",
  "youth_teenstars",
]);
const POLL_TIMEOUT_MILLISECONDS = 30000;
const POLL_INTERVAL_MILLISECONDS = 750;

function isValidRedemptionCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function argument(name) {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : "";
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assertEnvironment() {
  if (process.env.MEMBERSHIP_FIREBASE_PROJECT_ID !== TEST_PROJECT_ID ||
    process.env.STRIPE_EXPECTED_MODE !== "test" ||
    process.env.MEMBERSHIP_TEST_JOURNEY_ENABLED !== "true") {
    throw new Error("The verifier requires the demo Firebase project and Stripe test journey.");
  }
  const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
  if (firestoreHost !== "127.0.0.1:8080" && firestoreHost !== "localhost:8080") {
    throw new Error("FIRESTORE_EMULATOR_HOST must be the local port 8080 emulator.");
  }
  process.env.FIRESTORE_EMULATOR_HOST = firestoreHost;
}

function isLocalSuccessUrl(session) {
  const planKey = session.metadata?.planKey;
  if (typeof session.success_url !== "string" || !PLAN_KEYS.has(planKey)) return false;

  try {
    const url = new URL(session.success_url);
    const queryKeys = [...url.searchParams.keys()].sort();
    return url.origin === LOCAL_SUCCESS_ORIGIN &&
      url.pathname === LOCAL_SUCCESS_PATH &&
      url.username === "" &&
      url.password === "" &&
      url.hash === "" &&
      queryKeys.length === 2 &&
      queryKeys[0] === "plan" &&
      queryKeys[1] === "session_id" &&
      url.searchParams.get("plan") === planKey &&
      url.searchParams.get("session_id") === CHECKOUT_SESSION_TEMPLATE;
  } catch {
    return false;
  }
}

function assertLocalSession(session) {
  if (session.livemode !== false || session.mode !== "subscription" ||
    session.status !== "complete" ||
    (session.payment_status !== "paid" &&
      session.payment_status !== "no_payment_required")) {
    throw new Error("The Stripe test Checkout Session is not a completed subscription.");
  }
  if (!isLocalSuccessUrl(session) || !session.metadata?.intentId) {
    throw new Error("The Checkout Session does not belong to this local test journey.");
  }
}

function subscriptionIdFor(session) {
  const subscriptionId = typeof session.subscription === "string" ?
    session.subscription : session.subscription?.id;
  if (!subscriptionId) throw new Error("The Checkout Session has no subscription.");
  return subscriptionId;
}

async function inspectFulfilment(db, session) {
  const intents = await db.collection("membershipIntents")
    .where("checkoutSessionId", "==", session.id)
    .limit(2)
    .get();
  if (intents.size > 1) {
    throw new Error(`Session ${session.id} maps to more than one checkout intent.`);
  }
  if (intents.empty) return {ready: false, state: "no correlated intent yet"};

  const intent = intents.docs[0];
  if (intent.id !== session.metadata.intentId) {
    throw new Error(`Session ${session.id} is bound to a different checkout intent.`);
  }
  if (intent.get("status") !== "fulfilled") {
    return {ready: false, state: `intent status ${intent.get("status")}`};
  }

  const subscriptionId = subscriptionIdFor(session);
  const [membership, outbox] = await Promise.all([
    db.collection("memberships").doc(subscriptionId).get(),
    db.collection("membershipEmailOutbox").doc(subscriptionId).get(),
  ]);
  if (!membership.exists) return {ready: false, state: "membership not written yet"};
  if (!outbox.exists) return {ready: false, state: "confirmation outbox not written yet"};
  if (membership.get("checkoutSessionId") !== session.id ||
    membership.get("stripePriceId") !== intent.get("stripePriceId") ||
    membership.get("providerContractStatus") !== "verified") {
    throw new Error("The fulfilled membership failed its provider binding.");
  }
  return {ready: true, intent, membership, outbox};
}

async function listLocalSessions(stripe) {
  const page = await stripe.checkout.sessions.list({
    created: {gte: Math.floor(Date.now() / 1000) - 24 * 60 * 60},
    limit: 25,
  });
  return page.data.filter((session) =>
    session.livemode === false &&
    session.mode === "subscription" &&
    session.status === "complete" &&
    (session.payment_status === "paid" ||
      session.payment_status === "no_payment_required") &&
    isLocalSuccessUrl(session) &&
    Boolean(session.metadata?.intentId)
  );
}

async function waitForExplicitFulfilment(db, session) {
  const deadline = Date.now() + POLL_TIMEOUT_MILLISECONDS;
  let state = "not checked";
  while (Date.now() < deadline) {
    const result = await inspectFulfilment(db, session);
    if (result.ready) return result;
    state = result.state;
    await delay(POLL_INTERVAL_MILLISECONDS);
  }
  throw new Error(
    `Timed out after ${POLL_TIMEOUT_MILLISECONDS / 1000}s waiting for webhook fulfilment ` +
    `of ${session.id} (${state}).`
  );
}

async function waitForLatestFulfilment(stripe, db) {
  const deadline = Date.now() + POLL_TIMEOUT_MILLISECONDS;
  let state = "no matching local Checkout Session found";
  while (Date.now() < deadline) {
    const sessions = await listLocalSessions(stripe);
    let correlated = false;
    for (const session of sessions) {
      const result = await inspectFulfilment(db, session);
      if (result.state !== "no correlated intent yet") {
        correlated = true;
        state = `${session.id}: ${result.state || "correlated"}`;
        if (result.ready) return {session, fulfilment: result};
        // Stripe returns newest first. Once a Session correlates to this
        // emulator, wait for that newest exact match rather than selecting an
        // older completed run while its webhook is still converging.
        break;
      }
    }
    if (!correlated && sessions.length) {
      state = `${sessions.length} local Session(s), none correlated to this emulator`;
    }
    await delay(POLL_INTERVAL_MILLISECONDS);
  }
  throw new Error(
    `Timed out after ${POLL_TIMEOUT_MILLISECONDS / 1000}s finding the newest unambiguous ` +
    `fulfilled local Session (${state}).`
  );
}

function assertPresaleContract(session, subscription, fulfilment) {
  const {intent, membership, outbox} = fulfilment;
  if (session.payment_status !== "no_payment_required" ||
    session.payment_method_collection !== "always" ||
    session.amount_total !== 0) {
    throw new Error("The presale Session did not complete for £0 with a saved payment method.");
  }
  if (intent.get("billingCycleAnchor") !== PRESALE_BILLING_ANCHOR_UNIX_SECONDS ||
    intent.get("firstPaymentAt") !== PRESALE_BILLING_ANCHOR_UNIX_SECONDS ||
    intent.get("serviceStartsAt") !== PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS ||
    intent.get("initialChargePence") !== 0 ||
    intent.get("prorationBehavior") !== "none") {
    throw new Error("The fulfilled intent does not contain the exact frozen presale policy.");
  }
  if (subscription.status !== "active" ||
    subscription.billing_cycle_anchor !== PRESALE_BILLING_ANCHOR_UNIX_SECONDS ||
    subscription.trial_start !== null || subscription.trial_end !== null ||
    subscription.latest_invoice !== null) {
    throw new Error("The test Subscription is not the expected no-trial deferred subscription.");
  }
  if (membership.get("state") !== "scheduled" ||
    membership.get("billingMode") !== "presale_deferred" ||
    membership.get("serviceStartsAt") !== PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS ||
    membership.get("firstPaymentAt") !== PRESALE_BILLING_ANCHOR_UNIX_SECONDS ||
    membership.get("initialChargePence") !== 0 ||
    membership.get("firstPaymentReceivedAt") !== null ||
    outbox.get("initialChargePence") !== 0) {
    throw new Error("Local fulfilment did not preserve the scheduled £0 presale evidence.");
  }
  const schedule = membership.get("paymentSchedule");
  if (!schedule || schedule.amountDueTodayPence !== 0 ||
    schedule.firstPaymentAt !== PRESALE_BILLING_ANCHOR_UNIX_SECONDS ||
    schedule.standardMonthlyPence !== 6000 &&
      membership.get("planKey") === EXISTING_MEMBER_OFFER.planKey) {
    throw new Error("The membership payment schedule does not match its frozen presale.");
  }
  if (membership.get("planKey") === EXISTING_MEMBER_OFFER.planKey &&
    session.allow_promotion_codes === true) {
    throw new Error("Adult Unlimited presale Checkout exposed unbounded hosted Promotion Codes.");
  }
}

async function assertAppliedDiscount(stripe, fulfilment, required) {
  const discount = fulfilment.membership.get("discount");
  if (!discount) {
    if (required) {
      throw new Error("No existing-member Promotion Code was applied to this journey.");
    }
    return false;
  }

  const configuredCouponId = process.env.STRIPE_EXISTING_MEMBER_COUPON_ID?.trim();
  const configuredPromotionCodeId =
    process.env.STRIPE_EXISTING_MEMBER_PROMOTION_CODE_ID?.trim();
  const schedule = fulfilment.membership.get("paymentSchedule");
  if (!configuredCouponId || !configuredPromotionCodeId ||
    discount.couponId !== configuredCouponId ||
    discount.promotionCodeId !== configuredPromotionCodeId ||
    discount.amountOffPence !== EXISTING_MEMBER_OFFER.amountOffPence ||
    discount.currency !== EXISTING_MEMBER_OFFER.currency ||
    discount.durationInMonths !== EXISTING_MEMBER_OFFER.durationMonths ||
    schedule?.discountedMonthlyPence !== 5500 ||
    schedule?.discountedPaymentCount !== 3 ||
    schedule?.fullPriceFrom !== 1796083200) {
    throw new Error("The frozen existing-member discount schedule is not £55 x 3 then £60.");
  }

  const [coupon, promotionCode] = await Promise.all([
    stripe.coupons.retrieve(discount.couponId),
    stripe.promotionCodes.retrieve(discount.promotionCodeId),
  ]);
  const promotionCoupon = typeof promotionCode.promotion?.coupon === "string" ?
    promotionCode.promotion.coupon : promotionCode.promotion?.coupon?.id;
  const currencyOptions = promotionCode.restrictions?.currency_options ?? {};
  if (coupon.deleted === true || coupon.livemode !== false ||
    coupon.id !== configuredCouponId || coupon.redeem_by !== null ||
    promotionCode.livemode !== false ||
    promotionCoupon !== configuredCouponId ||
    promotionCode.id !== configuredPromotionCodeId ||
    promotionCode.max_redemptions !== null ||
    !isValidRedemptionCount(promotionCode.times_redeemed) ||
    promotionCode.expires_at !== PRESALE_BILLING_ANCHOR_UNIX_SECONDS ||
    promotionCode.customer !== null || promotionCode.customer_account !== null ||
    promotionCode.restrictions?.first_time_transaction !== false ||
    promotionCode.restrictions?.minimum_amount !== null ||
    promotionCode.restrictions?.minimum_amount_currency !== null ||
    Object.keys(currencyOptions).length !== 0) {
    throw new Error("The applied Promotion Code is not the approved shared reusable code.");
  }
  return true;
}

async function main() {
  assertEnvironment();
  const stripe = new Stripe(stripeCliTestKey(), {maxNetworkRetries: 2, timeout: 20000});
  const requestedSession = argument("session");
  const requireDiscountValue = argument("require-discount");
  if (requireDiscountValue && requireDiscountValue !== "true" &&
    requireDiscountValue !== "false") {
    throw new Error("Pass --require-discount=true or --require-discount=false.");
  }
  const requireDiscount = requireDiscountValue === "true";
  if (requestedSession && requestedSession !== "latest" &&
    !requestedSession.startsWith("cs_test_")) {
    throw new Error("Pass --session=cs_test_..., --session=latest, or omit it.");
  }

  admin.initializeApp({projectId: TEST_PROJECT_ID});
  const db = admin.firestore();
  let session;
  let fulfilment;
  if (requestedSession && requestedSession !== "latest") {
    session = await stripe.checkout.sessions.retrieve(requestedSession);
    assertLocalSession(session);
    fulfilment = await waitForExplicitFulfilment(db, session);
  } else {
    const latest = await waitForLatestFulfilment(stripe, db);
    session = latest.session;
    fulfilment = latest.fulfilment;
  }

  assertLocalSession(session);
  session = await stripe.checkout.sessions.retrieve(session.id);
  assertLocalSession(session);
  const subscription = await stripe.subscriptions.retrieve(subscriptionIdFor(session), {
    expand: ["discounts", "discounts.source.coupon", "discounts.promotion_code"],
  });
  if (subscription.livemode !== false) {
    throw new Error("The subscription is not a Stripe test-mode object.");
  }

  const billingMode = fulfilment.intent.get("billingMode") || "standard";
  if (billingMode === "presale_deferred") {
    assertPresaleContract(session, subscription, fulfilment);
  } else if (session.payment_status !== "paid") {
    throw new Error("A standard-billing journey must complete with paid status.");
  }
  const discountApplied = await assertAppliedDiscount(stripe, fulfilment, requireDiscount);

  console.log("Real Stripe test journey verified:");
  console.log(`- Checkout Session: ${session.id} (${session.payment_status})`);
  console.log(`- Subscription: ${subscription.id} (${subscription.status})`);
  console.log(`- Membership: ${fulfilment.membership.id} (${fulfilment.membership.get("state")})`);
  console.log(`- Billing mode: ${billingMode}`);
  console.log(discountApplied ?
    "- Existing-member offer: £55 for three payments, then £60" :
    "- Existing-member offer: no code applied");
  console.log(`- Confirmation outbox: ${fulfilment.outbox.get("status")}`);
}

main()
  .catch((error) => {
    console.error(
      `Stripe test journey verification failed: ${redactProviderSecrets(error.message)}`
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all(admin.apps.map((app) => app.delete()));
  });
