/* eslint-disable @typescript-eslint/no-var-requires, max-len, require-jsdoc */

const test = require("node:test");
const assert = require("node:assert/strict");
const {createFakeStripe} = require("./fakeStripe");

const PROJECT_ID = "demo-alphawod-stripe";
const STRIPE_PORT = Number(
  process.env.PAYG_FULFILMENT_PRIVACY_STRIPE_PORT || 12113
);
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.PAYG_FIREBASE_PROJECT_ID = PROJECT_ID;
process.env.STRIPE_API_HOST = "127.0.0.1";
process.env.STRIPE_API_PORT = String(STRIPE_PORT);
process.env.STRIPE_API_PROTOCOL = "http";
process.env.STRIPE_SECRET_KEY = "sk_test_fake";
process.env.STRIPE_EXPECTED_MODE = "test";
process.env.FUNCTIONS_EMULATOR = "true";
process.env.PAYG_CANCELLATION_TOKEN_SECRET =
  "local-payg-cancellation-secret-32-bytes";
process.env.PAYG_CANCELLATION_TOKEN_KEY_ID = "cancel-v1";

const admin = require("firebase-admin");
if (admin.apps.length === 0) admin.initializeApp({projectId: PROJECT_ID});
const db = admin.firestore();
const {
  __testing: {recoverPaygHold},
  dispatchPaygStripeEvent,
  fulfilPaygCheckoutSession,
} = require("../lib/payg");

const PAYG_PRICE_ID = "price_1UAmVVFzNDZoGGA04z8hX10N";
const PAYG_PRODUCT_ID = "prod_VAOxXxpax1MuRt";
const LOCAL_CANCELLATION_SECRET =
  "local-payg-cancellation-secret-32-bytes";
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
    "checkoutSessions",
    "paymentIntents",
    "refunds",
    "refundByIdempotencyKey",
    "pausedPaymentIntentRetrieves",
  ]) {
    fakeStripe.state[field].clear();
  }
  fakeStripe.state.updates.length = 0;
}

function legalEvidence() {
  return {
    adultConfirmed: true,
    waiverAccepted: true,
    termsAccepted: true,
    cancellationPolicyAccepted: true,
    waiverVersion: "payg-waiver-test-v1",
    termsVersion: "payg-terms-test-v1",
    privacyNoticeVersionPresented: "payg-privacy-test-v1",
    legal: {
      waiver: {
        version: "payg-waiver-test-v1",
        publicUrl: "https://example.test/legal/payg-waiver",
        sha256: "a".repeat(64),
      },
      terms: {
        version: "payg-terms-test-v1",
        publicUrl: "https://example.test/legal/payg-terms",
        sha256: "b".repeat(64),
      },
      privacyNotice: {
        version: "payg-privacy-test-v1",
        publicUrl: "https://example.test/legal/payg-privacy",
        sha256: "c".repeat(64),
      },
    },
    acceptedAt: admin.firestore.Timestamp.now(),
  };
}

function seedPaidProvider({
  intentId,
  classId,
  sessionId,
  paymentIntentId,
  chargeId,
  chargeCreatedSecond = Math.floor(Date.now() / 1000) - 60,
}) {
  const metadata = {
    purchaseKind: "payg_class",
    offeringKey: "adult_payg_class",
    paygIntentId: intentId,
    classId,
    schemaVersion: "1",
  };
  const session = {
    id: sessionId,
    object: "checkout.session",
    livemode: false,
    url: `https://checkout.stripe.test/${sessionId}`,
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    client_reference_id: intentId,
    metadata,
    customer_email: "late-payment@example.test",
    customer_details: {email: "late-payment@example.test"},
    payment_intent: paymentIntentId,
    subscription: null,
    amount_total: 700,
    currency: "gbp",
    total_details: {amount_discount: 0},
    line_items: [{price: PAYG_PRICE_ID, quantity: 1}],
  };
  const paymentIntent = {
    id: paymentIntentId,
    object: "payment_intent",
    livemode: false,
    status: "succeeded",
    amount: 700,
    amount_received: 700,
    currency: "gbp",
    latest_charge: chargeId,
    metadata,
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
    created: chargeCreatedSecond,
    disputed: false,
    refunded: false,
  };
  fakeStripe.state.checkoutSessions.set(sessionId, session);
  fakeStripe.state.paymentIntents.set(paymentIntentId, paymentIntent);
  fakeStripe.state.charges.set(chargeId, charge);
  return session;
}

async function seedPaygPurchase({
  intentId,
  classId,
  duplicateLockId,
  sessionId,
  nowMillis,
  intentPiiCutoffMillis,
}) {
  const classStartMillis = nowMillis + 14 * 24 * 60 * 60 * 1000;
  const classEndMillis = classStartMillis + 60 * 60 * 1000;
  await db.collection("classes").doc(classId).set({
    templateId: `template_${classId}`,
    title: "Adult Conditioning",
    timezone: "Europe/London",
    startTime: admin.firestore.Timestamp.fromMillis(classStartMillis),
    endTime: admin.firestore.Timestamp.fromMillis(classEndMillis),
    coachId: "coach",
    coachName: "Coach",
    capacity: 12,
    bookedCount: 1,
    paygUnpaidHoldCount: 1,
    paygEligible: true,
    location: "Zero Alpha Fitness",
    status: "scheduled",
    createdAt: admin.firestore.Timestamp.now(),
  });
  await db.collection("paygCheckoutLocks").doc(duplicateLockId).set({
    duplicateLockId,
    intentId,
    status: "held",
    activeUntil: admin.firestore.Timestamp.fromMillis(classEndMillis),
  });
  await db.collection("paygIntents").doc(intentId).set({
    schemaVersion: 1,
    checkoutSchemaVersion: 1,
    offeringKey: "adult_payg_class",
    purchaseKind: "payg_class",
    status: "checkout_created",
    capacityState: "held",
    unpaidHoldState: "counted",
    stripeMode: "test",
    stripePriceId: PAYG_PRICE_ID,
    stripeProductId: PAYG_PRODUCT_ID,
    checkoutAttemptHash: "c".repeat(64),
    requestFingerprint: "e".repeat(64),
    duplicateLockId,
    attendee: {
      fullName: "Late Payment Guest",
      dateOfBirth: "1990-01-01",
      ageAtClass: 36,
    },
    contact: {
      email: "late-payment@example.test",
      phone: "+447700900123",
    },
    acceptances: legalEvidence(),
    acceptanceEvidenceDigest: "9".repeat(64),
    privacy: {
      policyVersion: "payg-retention-v1",
      orderPiiRetentionDays: 90,
      waiverPiiRetentionDays: 2190,
    },
    class: {
      classId,
      title: "Adult Conditioning",
      startTime: new Date(classStartMillis).toISOString(),
      endTime: new Date(classEndMillis).toISOString(),
      timezone: "Europe/London",
      location: "Zero Alpha Fitness",
    },
    classStartMillis,
    classEndMillis,
    amountPence: 700,
    currency: "gbp",
    publicOrigin: "https://example.test",
    checkoutExpiresAt: Math.floor(nowMillis / 1000) + 30 * 60,
    checkoutSessionId: sessionId,
    checkoutSessionUrl: `https://checkout.stripe.test/${sessionId}`,
    paymentIntentId: null,
    orderId: null,
    holdExpiresAt: admin.firestore.Timestamp.fromMillis(nowMillis + 30 * 60 * 1000),
    piiRetentionCutoffAt: admin.firestore.Timestamp.fromMillis(
      intentPiiCutoffMillis
    ),
    piiRedactionRetryAt: admin.firestore.Timestamp.fromMillis(
      intentPiiCutoffMillis
    ),
    createdAt: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now(),
  });
  return {classStartMillis, classEndMillis};
}

function paidCheckoutEvent(session, eventId, created) {
  return {
    id: eventId,
    object: "event",
    type: "checkout.session.completed",
    created,
    livemode: session.livemode,
    data: {object: {...session}},
  };
}

test.before(async () => {
  fakeStripe = createFakeStripe();
  await fakeStripe.listen(STRIPE_PORT);
});

test.after(async () => {
  await fakeStripe.close();
});

test.beforeEach(async () => {
  // Loading Firebase Functions test helpers may rebuild the parameter
  // environment, so restore this local-only secret after module import too.
  process.env.PAYG_CANCELLATION_TOKEN_SECRET = LOCAL_CANCELLATION_SECRET;
  process.env.PAYG_CANCELLATION_TOKEN_KEY_ID = "cancel-v1";
  await clearFirestore();
  resetFakeStripe();
});

test("fulfilment cannot resurrect PII after a concurrent intent scrub", {timeout: 15_000}, async () => {
  const intentId = `payg_${"f".repeat(64)}`;
  const classId = "class_late_fulfilment_privacy";
  const duplicateLockId = "d".repeat(64);
  const sessionId = "cs_test_late_fulfilment_privacy";
  const paymentIntentId = "pi_late_fulfilment_privacy";
  const chargeId = "ch_late_fulfilment_privacy";
  const bookingId = `payg_guest_${"f".repeat(64)}`;
  const now = Date.now();
  const classStartMillis = now + 14 * 24 * 60 * 60 * 1000;
  const classEndMillis = classStartMillis + 60 * 60 * 1000;
  const intentPiiCutoffMillis = now + 24 * 60 * 60 * 1000;
  const intentRef = db.collection("paygIntents").doc(intentId);

  await db.collection("classes").doc(classId).set({
    templateId: "template_late_fulfilment_privacy",
    title: "Adult Conditioning",
    timezone: "Europe/London",
    startTime: admin.firestore.Timestamp.fromMillis(classStartMillis),
    endTime: admin.firestore.Timestamp.fromMillis(classEndMillis),
    coachId: "coach",
    coachName: "Coach",
    capacity: 12,
    bookedCount: 1,
    paygUnpaidHoldCount: 1,
    paygEligible: true,
    location: "Zero Alpha Fitness",
    status: "scheduled",
    createdAt: admin.firestore.Timestamp.now(),
  });
  await db.collection("paygCheckoutLocks").doc(duplicateLockId).set({
    duplicateLockId,
    intentId,
    status: "held",
    activeUntil: admin.firestore.Timestamp.fromMillis(classEndMillis),
  });
  await intentRef.set({
    schemaVersion: 1,
    checkoutSchemaVersion: 1,
    offeringKey: "adult_payg_class",
    purchaseKind: "payg_class",
    status: "checkout_created",
    capacityState: "held",
    unpaidHoldState: "counted",
    stripeMode: "test",
    stripePriceId: PAYG_PRICE_ID,
    stripeProductId: PAYG_PRODUCT_ID,
    checkoutAttemptHash: "c".repeat(64),
    requestFingerprint: "e".repeat(64),
    duplicateLockId,
    attendee: {
      fullName: "Late Payment Guest",
      dateOfBirth: "1990-01-01",
      ageAtClass: 36,
    },
    contact: {
      email: "late-payment@example.test",
      phone: "+447700900123",
    },
    acceptances: legalEvidence(),
    acceptanceEvidenceDigest: "9".repeat(64),
    privacy: {
      policyVersion: "payg-retention-v1",
      orderPiiRetentionDays: 90,
      waiverPiiRetentionDays: 2190,
    },
    class: {
      classId,
      title: "Adult Conditioning",
      startTime: new Date(classStartMillis).toISOString(),
      endTime: new Date(classEndMillis).toISOString(),
      timezone: "Europe/London",
      location: "Zero Alpha Fitness",
    },
    classStartMillis,
    classEndMillis,
    amountPence: 700,
    currency: "gbp",
    publicOrigin: "https://example.test",
    checkoutExpiresAt: Math.floor(now / 1000) + 30 * 60,
    checkoutSessionId: sessionId,
    checkoutSessionUrl: `https://checkout.stripe.test/${sessionId}`,
    paymentIntentId: null,
    orderId: null,
    holdExpiresAt: admin.firestore.Timestamp.fromMillis(now + 30 * 60 * 1000),
    piiRetentionCutoffAt: admin.firestore.Timestamp.fromMillis(
      intentPiiCutoffMillis
    ),
    piiRedactionRetryAt: admin.firestore.Timestamp.fromMillis(
      intentPiiCutoffMillis
    ),
    createdAt: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now(),
  });

  const session = seedPaidProvider({
    intentId,
    classId,
    sessionId,
    paymentIntentId,
    chargeId,
  });
  const successEvidence = {
    providerEventId: "evt_test_late_fulfilment_privacy",
    providerEventType: "checkout.session.completed",
    providerEventCreatedSecond: Math.floor(now / 1000) - 30,
    checkoutSessionId: sessionId,
    paymentIntentId,
    intentId,
    livemode: false,
  };
  const barrier = fakeStripe.pauseNextPaymentIntentRetrieve(paymentIntentId);
  const fulfilment = fulfilPaygCheckoutSession(session, successEvidence);
  await barrier.reached;

  await intentRef.update({
    attendee: admin.firestore.FieldValue.delete(),
    contact: admin.firestore.FieldValue.delete(),
    acceptances: admin.firestore.FieldValue.delete(),
    requestFingerprint: admin.firestore.FieldValue.delete(),
    checkoutSessionUrl: admin.firestore.FieldValue.delete(),
    piiScrubbedAt: admin.firestore.Timestamp.now(),
    piiScrubReason: "retention_expired",
    piiRedactionRetryAt: admin.firestore.FieldValue.delete(),
    updatedAt: admin.firestore.Timestamp.now(),
  });
  barrier.release();
  await fulfilment;

  for (const [collection, id] of [
    ["paygOrders", intentId],
    ["paygWaiverAcceptances", intentId],
    ["paygEmailOutbox", intentId],
    ["bookings", bookingId],
  ]) {
    assert.equal(
      (await db.collection(collection).doc(id).get()).exists,
      false,
      `${collection}/${id} must not be created from stale intent PII`
    );
  }

  const scrubbedIntent = await intentRef.get();
  assert.equal(scrubbedIntent.exists, true);
  for (const field of [
    "attendee",
    "contact",
    "acceptances",
    "requestFingerprint",
    "checkoutSessionUrl",
  ]) {
    assert.equal(scrubbedIntent.get(field), undefined, field);
  }
  assert.ok(scrubbedIntent.get("piiScrubbedAt"));

  const paymentReviews = await db.collection("paygPaymentReviews")
    .where("intentId", "==", intentId).get();
  assert.equal(paymentReviews.size, 1);
  const paymentReview = paymentReviews.docs[0].data();
  for (const field of ["attendee", "contact", "acceptances", "to", "templateData"]) {
    assert.equal(paymentReview[field], undefined, field);
  }
  assert.ok(paymentReview.mismatches.includes("intent_pii_already_scrubbed"));
  assert.equal(
    fakeStripe.state.updates.filter(({path}) => path === "/v1/refunds").length,
    1
  );
});

test("a pre-cutoff Charge creation cannot promote PII after the paid event cutoff", async () => {
  const intentId = `payg_${"1".repeat(64)}`;
  const classId = "class_payment_event_after_privacy_cutoff";
  const duplicateLockId = "2".repeat(64);
  const sessionId = "cs_test_payment_event_after_privacy_cutoff";
  const paymentIntentId = "pi_payment_event_after_privacy_cutoff";
  const chargeId = "ch_payment_event_after_privacy_cutoff";
  const bookingId = `payg_guest_${"1".repeat(64)}`;
  const nowMillis = Date.now();
  const cutoffSecond = Math.floor(nowMillis / 1000) - 20;
  await seedPaygPurchase({
    intentId,
    classId,
    duplicateLockId,
    sessionId,
    nowMillis,
    intentPiiCutoffMillis: cutoffSecond * 1000,
  });
  const session = seedPaidProvider({
    intentId,
    classId,
    sessionId,
    paymentIntentId,
    chargeId,
    chargeCreatedSecond: cutoffSecond - 60,
  });

  await dispatchPaygStripeEvent(paidCheckoutEvent(
    session,
    "evt_test_payment_event_after_privacy_cutoff",
    cutoffSecond + 10
  ));

  for (const [collection, id] of [
    ["paygOrders", intentId],
    ["paygWaiverAcceptances", intentId],
    ["paygEmailOutbox", intentId],
    ["bookings", bookingId],
  ]) {
    assert.equal(
      (await db.collection(collection).doc(id).get()).exists,
      false,
      `${collection}/${id} must not be created from Charge.created`
    );
  }
  const reviews = await db.collection("paygPaymentReviews")
    .where("intentId", "==", intentId).get();
  assert.equal(reviews.size, 1);
  assert.ok(reviews.docs[0].get("mismatches").includes(
    "payment_completed_at_or_after_pii_cutoff"
  ));
  assert.equal(
    fakeStripe.state.updates.filter(({path}) => path === "/v1/refunds").length,
    1
  );
});

test("a delayed paid event converges to the recovery payment-review owner", async () => {
  const intentId = `payg_${"5".repeat(64)}`;
  const classId = "class_payment_review_then_paid_event";
  const duplicateLockId = "6".repeat(64);
  const sessionId = "cs_test_payment_review_then_paid_event";
  const paymentIntentId = "pi_payment_review_then_paid_event";
  const chargeId = "ch_payment_review_then_paid_event";
  const bookingId = `payg_guest_${"5".repeat(64)}`;
  const nowMillis = Date.now();
  const successSecond = Math.floor(nowMillis / 1000) - 10;
  await seedPaygPurchase({
    intentId,
    classId,
    duplicateLockId,
    sessionId,
    nowMillis,
    intentPiiCutoffMillis: (successSecond + 60) * 1000,
  });
  const session = seedPaidProvider({
    intentId,
    classId,
    sessionId,
    paymentIntentId,
    chargeId,
    chargeCreatedSecond: successSecond - 10,
  });

  const event = paidCheckoutEvent(
    session,
    "evt_test_payment_review_then_paid_event",
    successSecond
  );
  const barrier = fakeStripe.pauseNextPaymentIntentRetrieve(paymentIntentId);
  const delayedEvent = dispatchPaygStripeEvent(event);
  await barrier.reached;
  const recoveryIntent = await db.collection("paygIntents").doc(intentId).get();
  assert.equal(await recoverPaygHold(recoveryIntent, nowMillis), "fulfilled");

  const reviewsAfterRecovery = await db.collection("paygPaymentReviews")
    .where("intentId", "==", intentId).get();
  assert.equal(reviewsAfterRecovery.size, 1);
  const reviewId = reviewsAfterRecovery.docs[0].id;
  const refundId = reviewsAfterRecovery.docs[0].get("refundId");
  assert.equal(reviewsAfterRecovery.docs[0].get("status"), "refunded");
  assert.equal(reviewsAfterRecovery.docs[0].get("paymentIntentId"), paymentIntentId);
  assert.match(refundId, /^re_/);

  barrier.release();
  assert.equal(await delayedEvent, true);
  assert.equal(await dispatchPaygStripeEvent(event), true);

  for (const [collection, id] of [
    ["paygOrders", intentId],
    ["paygWaiverAcceptances", intentId],
    ["paygEmailOutbox", intentId],
    ["bookings", bookingId],
  ]) {
    assert.equal(
      (await db.collection(collection).doc(id).get()).exists,
      false,
      `${collection}/${id} must not be created beside the payment review`
    );
  }

  const [intent, classSnap, lock, reviewsAfterEvent] = await Promise.all([
    db.collection("paygIntents").doc(intentId).get(),
    db.collection("classes").doc(classId).get(),
    db.collection("paygCheckoutLocks").doc(duplicateLockId).get(),
    db.collection("paygPaymentReviews").where("intentId", "==", intentId).get(),
  ]);
  assert.equal(intent.get("status"), "manual_review");
  assert.equal(intent.get("capacityState"), "released");
  assert.equal(classSnap.get("bookedCount"), 0);
  assert.equal(classSnap.get("paygUnpaidHoldCount"), 0);
  assert.equal(lock.exists, false);
  assert.equal(reviewsAfterEvent.size, 1);
  assert.equal(reviewsAfterEvent.docs[0].id, reviewId);
  assert.equal(reviewsAfterEvent.docs[0].get("refundId"), refundId);
  for (const field of ["attendee", "contact", "acceptances", "to", "templateData"]) {
    assert.equal(reviewsAfterEvent.docs[0].get(field), undefined, field);
  }
  assert.equal(fakeStripe.state.refunds.size, 1);
  assert.equal(fakeStripe.state.refundByIdempotencyKey.size, 1);
  assert.equal(
    fakeStripe.state.updates.filter(({path}) => path === "/v1/refunds").length,
    1
  );
});

test("a paid event preserves an in-flight payment-review refund claim", async () => {
  const intentId = `payg_${"7".repeat(64)}`;
  const classId = "class_payment_review_claim_then_paid_event";
  const duplicateLockId = "8".repeat(64);
  const sessionId = "cs_test_payment_review_claim_then_paid_event";
  const paymentIntentId = "pi_payment_review_claim_then_paid_event";
  const chargeId = "ch_payment_review_claim_then_paid_event";
  const bookingId = `payg_guest_${"7".repeat(64)}`;
  const nowMillis = Date.now();
  const successSecond = Math.floor(nowMillis / 1000) - 10;
  await seedPaygPurchase({
    intentId,
    classId,
    duplicateLockId,
    sessionId,
    nowMillis,
    intentPiiCutoffMillis: (successSecond + 60) * 1000,
  });
  const session = seedPaidProvider({
    intentId,
    classId,
    sessionId,
    paymentIntentId,
    chargeId,
    chargeCreatedSecond: successSecond - 10,
  });
  const event = paidCheckoutEvent(
    session,
    "evt_test_payment_review_claim_then_paid_event",
    successSecond
  );

  const recoveryIntent = await db.collection("paygIntents").doc(intentId).get();
  const initialProviderRead = fakeStripe.pauseNextPaymentIntentRetrieve(
    paymentIntentId
  );
  const recovery = recoverPaygHold(recoveryIntent, nowMillis);
  await initialProviderRead.reached;
  const refundProviderRead = fakeStripe.pauseNextPaymentIntentRetrieve(
    paymentIntentId
  );
  initialProviderRead.release();
  await refundProviderRead.reached;

  const reviews = await db.collection("paygPaymentReviews")
    .where("intentId", "==", intentId).get();
  assert.equal(reviews.size, 1);
  const reviewRef = reviews.docs[0].ref;
  const beforeEvent = await reviewRef.get();
  assert.equal(beforeEvent.get("status"), "refund_pending");
  assert.equal(beforeEvent.get("paymentIntentId"), paymentIntentId);
  assert.equal(typeof beforeEvent.get("refundAutomationClaimToken"), "string");
  assert.equal(
    beforeEvent.get("refundAutomationClaimPaymentIntentId"),
    paymentIntentId
  );
  assert.ok(beforeEvent.get("refundAutomationClaimExpiresAt"));
  assert.equal(beforeEvent.get("refundId"), undefined);

  try {
    assert.equal(await dispatchPaygStripeEvent(event), true);
    const afterEvent = await reviewRef.get();
    assert.deepEqual(afterEvent.data(), beforeEvent.data());
    assert.equal(fakeStripe.state.refunds.size, 0);
    assert.equal(
      fakeStripe.state.updates.filter(({path}) => path === "/v1/refunds").length,
      0
    );
  } finally {
    refundProviderRead.release();
  }

  assert.equal(await recovery, "fulfilled");
  const completedReview = await reviewRef.get();
  assert.equal(completedReview.get("status"), "refunded");
  assert.match(completedReview.get("refundId"), /^re_/);
  assert.equal(completedReview.get("refundAutomationClaimToken"), undefined);
  assert.equal(fakeStripe.state.refunds.size, 1);
  assert.equal(fakeStripe.state.refundByIdempotencyKey.size, 1);
  assert.equal(
    fakeStripe.state.updates.filter(({path}) => path === "/v1/refunds").length,
    1
  );
  for (const [collection, id] of [
    ["paygOrders", intentId],
    ["paygWaiverAcceptances", intentId],
    ["paygEmailOutbox", intentId],
    ["bookings", bookingId],
  ]) {
    assert.equal(
      (await db.collection(collection).doc(id).get()).exists,
      false,
      `${collection}/${id} must not be created beside the active refund claim`
    );
  }
});

test("an exactly-bound paid Checkout event wholly before cutoff fulfils once", async () => {
  const intentId = `payg_${"3".repeat(64)}`;
  const classId = "class_payment_event_before_privacy_cutoff";
  const duplicateLockId = "4".repeat(64);
  const sessionId = "cs_test_payment_event_before_privacy_cutoff";
  const paymentIntentId = "pi_payment_event_before_privacy_cutoff";
  const chargeId = "ch_payment_event_before_privacy_cutoff";
  const bookingId = `payg_guest_${"3".repeat(64)}`;
  const nowMillis = Date.now();
  const successSecond = Math.floor(nowMillis / 1000) - 10;
  await seedPaygPurchase({
    intentId,
    classId,
    duplicateLockId,
    sessionId,
    nowMillis,
    intentPiiCutoffMillis: (successSecond + 60) * 1000,
  });
  const session = seedPaidProvider({
    intentId,
    classId,
    sessionId,
    paymentIntentId,
    chargeId,
    chargeCreatedSecond: successSecond - 10,
  });
  const event = paidCheckoutEvent(
    session,
    "evt_test_payment_event_before_privacy_cutoff",
    successSecond
  );

  const recoveryIntent = await db.collection("paygIntents").doc(intentId).get();
  const barrier = fakeStripe.pauseNextPaymentIntentRetrieve(paymentIntentId);
  const staleRecovery = recoverPaygHold(recoveryIntent, nowMillis);
  await barrier.reached;
  assert.equal(await dispatchPaygStripeEvent(event), true);
  barrier.release();
  assert.equal(await staleRecovery, "fulfilled");
  assert.equal(await dispatchPaygStripeEvent(event), true);
  await fulfilPaygCheckoutSession(session);

  const [intent, order, waiver, outbox, booking, classSnap, reviews] =
    await Promise.all([
      db.collection("paygIntents").doc(intentId).get(),
      db.collection("paygOrders").doc(intentId).get(),
      db.collection("paygWaiverAcceptances").doc(intentId).get(),
      db.collection("paygEmailOutbox").doc(intentId).get(),
      db.collection("bookings").doc(bookingId).get(),
      db.collection("classes").doc(classId).get(),
      db.collection("paygPaymentReviews").where("intentId", "==", intentId).get(),
    ]);
  assert.equal(intent.get("status"), "fulfilled");
  assert.equal(order.get("status"), "confirmed");
  assert.equal(waiver.exists, true);
  assert.equal(outbox.get("status"), "pending");
  assert.equal(booking.get("status"), "booked");
  assert.equal(classSnap.get("bookedCount"), 1);
  assert.equal(classSnap.get("paygUnpaidHoldCount"), 0);
  assert.equal(reviews.size, 0);
  assert.equal(
    fakeStripe.state.updates.filter(({path}) => path === "/v1/refunds").length,
    0
  );
});
