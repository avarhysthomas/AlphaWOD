/* eslint-disable @typescript-eslint/no-var-requires, max-len, require-jsdoc */

const test = require("node:test");
const assert = require("node:assert/strict");
const {createFakeStripe} = require("./fakeStripe");

const PROJECT_ID = "demo-alphawod-stripe";
const STRIPE_PORT = Number(process.env.PAYG_REFUND_RACE_STRIPE_PORT || 12112);
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.PAYG_FIREBASE_PROJECT_ID = PROJECT_ID;
process.env.STRIPE_API_HOST = "127.0.0.1";
process.env.STRIPE_API_PORT = String(STRIPE_PORT);
process.env.STRIPE_API_PROTOCOL = "http";
process.env.STRIPE_SECRET_KEY = "sk_test_fake";
process.env.STRIPE_EXPECTED_MODE = "test";
process.env.FUNCTIONS_EMULATOR = "true";

const admin = require("firebase-admin");
if (admin.apps.length === 0) admin.initializeApp({projectId: PROJECT_ID});
const db = admin.firestore();
const {__testing: paygTesting} = require("../lib/payg");

let fakeStripe;

async function clearFirestore() {
  const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
  assert.ok(firestoreHost, "FIRESTORE_EMULATOR_HOST is required");
  await fetch(
    `http://${firestoreHost}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    {method: "DELETE"}
  );
}

function resetFakeStripe() {
  for (const field of [
    "charges",
    "paymentIntents",
    "refunds",
    "refundByIdempotencyKey",
    "pausedPaymentIntentRetrieves",
  ]) {
    fakeStripe.state[field].clear();
  }
  fakeStripe.state.updates.length = 0;
}

function seedProvider(paymentIntentId, chargeId, overrides = {}) {
  const paymentIntent = {
    id: paymentIntentId,
    object: "payment_intent",
    livemode: false,
    status: "succeeded",
    amount: 700,
    amount_received: 700,
    currency: "gbp",
    latest_charge: chargeId,
    metadata: {},
    ...overrides.paymentIntent,
  };
  const charge = {
    id: chargeId,
    object: "charge",
    livemode: false,
    amount: 700,
    amount_refunded: 0,
    currency: "gbp",
    payment_intent: paymentIntentId,
    paid: true,
    status: "succeeded",
    disputed: false,
    refunded: false,
    ...overrides.charge,
  };
  fakeStripe.state.paymentIntents.set(paymentIntentId, paymentIntent);
  fakeStripe.state.charges.set(chargeId, charge);
  return {paymentIntent, charge};
}

function orderRecord(paymentIntentId, chargeId, overrides = {}) {
  return {
    schemaVersion: 1,
    purchaseKind: "payg_class",
    status: "refund_pending",
    capacityState: "released",
    paymentIntentId,
    chargeId,
    amountPence: 700,
    currency: "gbp",
    bookingId: null,
    duplicateLockId: null,
    confirmationEmailStatus: "not_required",
    class: {
      classId: "class_refund_race",
      title: "Adult Conditioning",
      startTime: "2026-09-10T17:00:00.000Z",
      endTime: "2026-09-10T18:00:00.000Z",
      timezone: "Europe/London",
      location: "Zero Alpha Fitness",
    },
    ...overrides,
  };
}

function reviewRecord(intentId, paymentIntentId, overrides = {}) {
  return {
    schemaVersion: 1,
    status: "refund_pending",
    automaticRefundSafe: true,
    disputeOpen: false,
    intentId,
    paymentIntentId,
    refundExpectedAmountPence: 700,
    providerCurrency: "gbp",
    ...overrides,
  };
}

function refundPostCount() {
  return fakeStripe.state.updates.filter(
    ({path}) => path === "/v1/refunds"
  ).length;
}

function assertClaimCleared(snapshot) {
  for (const field of [
    "refundAutomationClaimToken",
    "refundAutomationClaimExpiresAt",
    "refundAutomationClaimedAt",
    "refundAutomationClaimPaymentIntentId",
    "refundAutomationClaimProviderCheckedAt",
  ]) {
    assert.equal(snapshot.get(field), undefined, field);
  }
}

test.before(async () => {
  fakeStripe = createFakeStripe();
  await fakeStripe.listen(STRIPE_PORT);
});

test.after(async () => {
  await fakeStripe.close();
});

test.beforeEach(async () => {
  await clearFirestore();
  resetFakeStripe();
});

test("order refund refresh catches a provider dispute that opens after the claim", {timeout: 15_000}, async () => {
  const orderId = `payg_${"a".repeat(64)}`;
  const paymentIntentId = "pi_order_provider_dispute";
  const chargeId = "ch_order_provider_dispute";
  const orderRef = db.collection("paygOrders").doc(orderId);
  const {charge} = seedProvider(paymentIntentId, chargeId);
  await orderRef.set(orderRecord(paymentIntentId, chargeId));

  const barrier = fakeStripe.pauseNextPaymentIntentRetrieve(paymentIntentId);
  const issuing = paygTesting.issuePaygRefund(orderId, "guest_cancellation");
  await barrier.reached;
  const claimed = await orderRef.get();
  assert.match(claimed.get("refundAutomationClaimToken"), /^[A-Za-z0-9-]{16,128}$/);

  charge.disputed = true;
  fakeStripe.state.charges.set(chargeId, charge);
  barrier.release();
  await issuing;

  const order = await orderRef.get();
  assert.equal(refundPostCount(), 0);
  assert.equal(order.get("status"), "manual_review");
  assert.equal(order.get("refundAutomationStatus"), "suspended_dispute");
  assert.equal(order.get("refundStatus"), "provider_dispute_detected");
  assertClaimCleared(order);
});

test("payment-review dispute transition beats a stale unsafe provider preflight", {timeout: 15_000}, async () => {
  const intentId = `payg_${"b".repeat(64)}`;
  const reviewId = `${intentId}_${"c".repeat(24)}`;
  const paymentIntentId = "pi_review_dispute_race";
  const chargeId = "ch_review_dispute_race";
  const reviewRef = db.collection("paygPaymentReviews").doc(reviewId);
  const {paymentIntent} = seedProvider(paymentIntentId, chargeId);
  await reviewRef.set(reviewRecord(intentId, paymentIntentId));

  const barrier = fakeStripe.pauseNextPaymentIntentRetrieve(paymentIntentId);
  const issuing = paygTesting.issuePaygPaymentReviewRefund(reviewId);
  await barrier.reached;
  const claimed = await reviewRef.get();
  assert.match(claimed.get("refundAutomationClaimToken"), /^[A-Za-z0-9-]{16,128}$/);

  await reviewRef.set({
    status: "disputed",
    disputeOpen: true,
    disputeId: "dp_review_race",
    disputeStatus: "needs_response",
    refundAutomationStatus: "suspended_dispute",
    refundStatus: "dispute_open",
  }, {merge: true});
  paymentIntent.status = "processing";
  fakeStripe.state.paymentIntents.set(paymentIntentId, paymentIntent);
  barrier.release();
  await issuing;

  const review = await reviewRef.get();
  assert.equal(refundPostCount(), 0);
  assert.equal(review.get("status"), "disputed");
  assert.equal(review.get("disputeId"), "dp_review_race");
  assert.equal(review.get("refundStatus"), "dispute_open");
  assert.equal(review.get("refundAutomationStatus"), "suspended_dispute");
  assertClaimCleared(review);
});

test("refunded order evidence beats a stale unsafe provider preflight", {timeout: 15_000}, async () => {
  const orderId = `payg_${"d".repeat(64)}`;
  const paymentIntentId = "pi_order_refunded_race";
  const chargeId = "ch_order_refunded_race";
  const orderRef = db.collection("paygOrders").doc(orderId);
  const {paymentIntent} = seedProvider(paymentIntentId, chargeId);
  await orderRef.set(orderRecord(paymentIntentId, chargeId));

  const barrier = fakeStripe.pauseNextPaymentIntentRetrieve(paymentIntentId);
  const issuing = paygTesting.issuePaygRefund(orderId, "guest_cancellation");
  await barrier.reached;
  await orderRef.set({
    status: "refunded",
    refundId: "re_webhook_won",
    refundStatus: "succeeded",
    refundedAmountPence: 700,
  }, {merge: true});
  paymentIntent.status = "processing";
  fakeStripe.state.paymentIntents.set(paymentIntentId, paymentIntent);
  barrier.release();
  await issuing;

  const order = await orderRef.get();
  assert.equal(refundPostCount(), 0);
  assert.equal(order.get("status"), "refunded");
  assert.equal(order.get("refundId"), "re_webhook_won");
  assert.equal(order.get("refundStatus"), "succeeded");
  assert.equal(order.get("refundedAmountPence"), 700);
  assertClaimCleared(order);
});

test("order refund claim serializes callers and repeated recovery is idempotent", {timeout: 15_000}, async () => {
  const orderId = `payg_${"e".repeat(64)}`;
  const paymentIntentId = "pi_order_claim_once";
  const chargeId = "ch_order_claim_once";
  const orderRef = db.collection("paygOrders").doc(orderId);
  seedProvider(paymentIntentId, chargeId);
  await orderRef.set(orderRecord(paymentIntentId, chargeId));

  const barrier = fakeStripe.pauseNextPaymentIntentRetrieve(paymentIntentId);
  const first = paygTesting.issuePaygRefund(orderId, "guest_cancellation");
  await barrier.reached;
  await paygTesting.issuePaygRefund(orderId, "guest_cancellation");
  assert.equal(refundPostCount(), 0);
  barrier.release();
  await first;
  await paygTesting.issuePaygRefund(orderId, "guest_cancellation");

  const order = await orderRef.get();
  assert.equal(refundPostCount(), 1);
  assert.equal(fakeStripe.state.refunds.size, 1);
  assert.equal(order.get("status"), "refunded");
  assert.equal(order.get("refundStatus"), "succeeded");
  assert.match(order.get("refundId"), /^re_fake_/);
  assertClaimCleared(order);
});

test("payment-review refund claim serializes callers and converges once", {timeout: 15_000}, async () => {
  const intentId = `payg_${"f".repeat(64)}`;
  const reviewId = `${intentId}_${"1".repeat(24)}`;
  const paymentIntentId = "pi_review_claim_once";
  const chargeId = "ch_review_claim_once";
  const reviewRef = db.collection("paygPaymentReviews").doc(reviewId);
  seedProvider(paymentIntentId, chargeId);
  await reviewRef.set(reviewRecord(intentId, paymentIntentId));

  const barrier = fakeStripe.pauseNextPaymentIntentRetrieve(paymentIntentId);
  const first = paygTesting.issuePaygPaymentReviewRefund(reviewId);
  await barrier.reached;
  await paygTesting.issuePaygPaymentReviewRefund(reviewId);
  barrier.release();
  await first;
  await paygTesting.issuePaygPaymentReviewRefund(reviewId);

  const review = await reviewRef.get();
  assert.equal(refundPostCount(), 1);
  assert.equal(fakeStripe.state.refunds.size, 1);
  assert.equal(review.get("status"), "refunded");
  assert.equal(review.get("refundStatus"), "succeeded");
  assert.match(review.get("refundId"), /^re_fake_/);
  assertClaimCleared(review);
});
