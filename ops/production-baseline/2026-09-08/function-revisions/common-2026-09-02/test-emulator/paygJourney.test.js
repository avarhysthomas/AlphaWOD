/* eslint-disable @typescript-eslint/no-var-requires, max-len, require-jsdoc */

/**
 * Closed-gate PAYG release journey.
 *
 * This invokes the real callable handlers and Firestore transactions while
 * substituting only the external providers: Stripe is a loopback HTTP fake and
 * the confirmation sender is injected in memory. No account, charge, email,
 * deployment, or production data is touched.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const {createFakeStripe} = require("./fakeStripe");

const PROJECT_ID = "demo-alphawod-stripe";
const STRIPE_PORT = Number(process.env.PAYG_JOURNEY_STRIPE_PORT || 12113);
const TEST_PRICE_ID = "price_1UAmVVFzNDZoGGA04z8hX10N";
const WAIVER_VERSION = "ZAF-PAYG-WAIVER-LOCAL-2026-01";
const TERMS_VERSION = "ZAF-PAYG-TERMS-LOCAL-2026-01";
const PRIVACY_NOTICE_VERSION = "ZAF-PAYG-PRIVACY-LOCAL-2026-01";

Object.assign(process.env, {
  GCLOUD_PROJECT: PROJECT_ID,
  GOOGLE_CLOUD_PROJECT: PROJECT_ID,
  PAYG_FIREBASE_PROJECT_ID: PROJECT_ID,
  FUNCTIONS_EMULATOR: "true",
  STRIPE_API_HOST: "127.0.0.1",
  STRIPE_API_PORT: String(STRIPE_PORT),
  STRIPE_API_PROTOCOL: "http",
  STRIPE_SECRET_KEY: "sk_test_fake",
  STRIPE_EXPECTED_MODE: "test",
  STRIPE_PRICE_ADULT_PAYG_CLASS: TEST_PRICE_ID,
  PAYG_PRODUCT_TAX_CODE: "txcd_50021001",
  PAYG_AVAILABILITY_ENABLED: "true",
  PAYG_LEGAL_APPROVED: "true",
  PAYG_WAIVER_VERSION: WAIVER_VERSION,
  PAYG_WAIVER_PUBLIC_URL: "/legal/payg-waiver-local.txt",
  PAYG_WAIVER_SHA256: "a".repeat(64),
  PAYG_TERMS_VERSION: TERMS_VERSION,
  PAYG_TERMS_PUBLIC_URL: "/legal/payg-terms-local.txt",
  PAYG_TERMS_SHA256: "b".repeat(64),
  PAYG_PRIVACY_NOTICE_VERSION: PRIVACY_NOTICE_VERSION,
  PAYG_PRIVACY_NOTICE_PUBLIC_URL: "/legal/payg-privacy-local.txt",
  PAYG_PRIVACY_NOTICE_SHA256: "c".repeat(64),
  PAYG_PII_RETENTION_APPROVED: "true",
  PAYG_PII_RETENTION_POLICY_VERSION: "payg-local-journey-2026-01",
  PAYG_ORDER_PII_RETENTION_DAYS: "90",
  PAYG_WAIVER_PII_RETENTION_DAYS: "2190",
  PAYG_CANCELLATION_TOKEN_KEY_ID: "cancel-local-v1",
  PAYG_CANCELLATION_TOKEN_SECRET:
    "payg-local-cancellation-secret-0123456789abcdef",
  PAYG_CHECKOUT_RATE_LIMIT_SECRET:
    "payg-local-admission-secret-0123456789abcdef",
  PAYG_DUPLICATE_LOCK_KEY_ID: "lock-local-v1",
  PAYG_DUPLICATE_LOCK_SECRET:
    "payg-local-duplicate-secret-0123456789abcdef",
  APP_PUBLIC_ORIGIN: "http://127.0.0.1:3002",
  PAYG_FROM_EMAIL: "Zero Alpha Fitness <hello@zeroalphafitness.co.uk>",
  PAYG_REPLY_TO_EMAIL: "hello@zeroalphafitness.co.uk",
  // Deliberately blank: this journey can prove email convergence only through
  // the injected local sender below, never by falling through to Resend.
  RESEND_API_KEY: "",
});

const functionsTest = require("firebase-functions-test")({projectId: PROJECT_ID});
const admin = require("firebase-admin");
const functions = require("../lib/index");
const {
  PAYG_AMOUNT_PENCE,
  PAYG_CHECKOUT_SCHEMA_VERSION,
  __testing: paygTesting,
  dispatchPaygStripeEvent,
  paygDisputeOutboxId,
  paygRefundOutboxId,
} = require("../lib/payg");

const db = admin.firestore();
const createPaygCheckoutSession = functionsTest.wrap(
  functions.createPaygCheckoutSession
);
const requestPaygCancellation = functionsTest.wrap(
  functions.requestPaygCancellation
);
const beginClassCancellation = functionsTest.wrap(
  functions.beginClassCancellation
);
const finalizeClassCancellation = functionsTest.wrap(
  functions.finalizeClassCancellation
);

let fakeStripe;

function callableRequest(data, ipAddress) {
  return {
    data,
    rawRequest: {
      ip: ipAddress,
      socket: {remoteAddress: ipAddress},
      headers: {},
      get: () => "payg-local-journey",
    },
    acceptsStreaming: false,
  };
}

function adminCallableRequest(data) {
  return {
    ...callableRequest(data, "127.0.0.88"),
    auth: {uid: "class-cancel-admin", token: {auth_time: 1, firebase: {
      sign_in_provider: "password",
    }}},
  };
}

async function seedClassCancellationAdmin() {
  await db.collection("users").doc("class-cancel-admin").set({
    role: "admin",
    approvalStatus: "approved",
    entitlementStatus: "active",
    entitlementSource: "staff",
    appAccessTier: "full",
    entitlementClassSlots: [],
    alphaWodAccess: true,
    name: "Class Cancellation Admin",
  });
}

function checkoutRequest({attemptId, classId, name, dateOfBirth, email}) {
  return {
    checkoutSchemaVersion: PAYG_CHECKOUT_SCHEMA_VERSION,
    checkoutAttemptId: attemptId,
    classId,
    attendee: {fullName: name, dateOfBirth},
    contact: {email, phone: "+447700900123"},
    acceptances: {
      adultConfirmed: true,
      waiverAccepted: true,
      termsAccepted: true,
      cancellationPolicyAccepted: true,
      waiverVersion: WAIVER_VERSION,
      termsVersion: TERMS_VERSION,
      privacyNoticeVersionPresented: PRIVACY_NOTICE_VERSION,
    },
  };
}

async function clearFirestore() {
  const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
  assert.ok(firestoreHost, "FIRESTORE_EMULATOR_HOST is required");
  await fetch(
    `http://${firestoreHost}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    {method: "DELETE"}
  );
}

async function seedClass(
  classId,
  capacity,
  startOffsetMillis = 7 * 24 * 60 * 60 * 1000
) {
  const startMillis = Date.now() + startOffsetMillis;
  await db.collection("classes").doc(classId).set({
    title: "Adult Conditioning",
    startTime: admin.firestore.Timestamp.fromMillis(startMillis),
    endTime: admin.firestore.Timestamp.fromMillis(startMillis + 60 * 60 * 1000),
    timezone: "Europe/London",
    location: "Zero Alpha Fitness",
    coachName: "Local Test Coach",
    status: "scheduled",
    paygEligible: true,
    capacity,
    bookedCount: 0,
    paygUnpaidHoldCount: 0,
  });
}

async function classCounts(classId) {
  const snapshot = await db.collection("classes").doc(classId).get();
  return {
    booked: snapshot.get("bookedCount"),
    unpaid: snapshot.get("paygUnpaidHoldCount"),
  };
}

test.before(async () => {
  fakeStripe = createFakeStripe();
  await fakeStripe.listen(STRIPE_PORT);
});

test.after(async () => {
  await fakeStripe.close();
  functionsTest.cleanup();
});

test.beforeEach(async () => {
  await clearFirestore();
});

test("PAYG checkout holds one place, admits no duplicate or over-capacity sale, sends locally, and converges a £7 refund", {timeout: 30_000}, async () => {
  const classId = "payg_journey_class";
  const capacityClassId = "payg_journey_capacity_class";
  await seedClass(classId, 4);
  await seedClass(capacityClassId, 1);

  const first = await createPaygCheckoutSession(callableRequest(checkoutRequest({
    attemptId: "paygJourneyAttemptAlpha000001",
    classId,
    name: "Alex Journey",
    dateOfBirth: "1990-02-03",
    email: "alex.journey@example.test",
  }), "127.0.0.21"));

  assert.equal(first.ok, true);
  assert.equal(first.disposition, "created");
  assert.deepEqual(await classCounts(classId), {booked: 1, unpaid: 1});
  assert.equal(fakeStripe.state.checkoutSessions.size, 1);
  const firstSession = fakeStripe.state.checkoutSessions.get(first.sessionId);
  assert.ok(firstSession);
  assert.equal(firstSession.mode, "payment");
  assert.equal(firstSession.amount_total, PAYG_AMOUNT_PENCE);
  assert.equal(firstSession.currency, "gbp");
  assert.deepEqual(firstSession.line_items, [{price: TEST_PRICE_ID, quantity: 1}]);
  assert.equal(firstSession.metadata.purchaseKind, "payg_class");
  const intentId = firstSession.metadata.paygIntentId;
  const acceptedIntent = await db.collection("paygIntents").doc(intentId).get();
  const acceptedAt = acceptedIntent.get("acceptances.acceptedAt");
  assert.ok(acceptedAt);
  const acceptedAtIso = acceptedAt.toDate().toISOString();
  assert.equal(acceptedIntent.get("acceptances.waiverVersion"), WAIVER_VERSION);
  assert.equal(acceptedIntent.get("acceptances.termsVersion"), TERMS_VERSION);
  assert.equal(
    acceptedIntent.get("acceptances.privacyNoticeVersionPresented"),
    PRIVACY_NOTICE_VERSION
  );

  await assert.rejects(
    createPaygCheckoutSession(callableRequest(checkoutRequest({
      attemptId: "paygJourneyAttemptDuplicate01",
      classId,
      name: "Alex Journey",
      dateOfBirth: "1990-02-03",
      email: "alex.journey@example.test",
    }), "127.0.0.22")),
    (error) => error.code === "already-exists" &&
      error.details?.reason === "payg_duplicate_class_attendee"
  );
  assert.equal(fakeStripe.state.checkoutSessions.size, 1);
  assert.deepEqual(await classCounts(classId), {booked: 1, unpaid: 1});

  const capacityHold = await createPaygCheckoutSession(callableRequest(checkoutRequest({
    attemptId: "paygJourneyAttemptBravo000001",
    classId: capacityClassId,
    name: "Blair Journey",
    dateOfBirth: "1992-04-05",
    email: "blair.journey@example.test",
  }), "127.0.0.23"));
  assert.equal(capacityHold.ok, true);
  assert.deepEqual(await classCounts(capacityClassId), {booked: 1, unpaid: 1});

  await assert.rejects(
    createPaygCheckoutSession(callableRequest(checkoutRequest({
      attemptId: "paygJourneyAttemptCapacity001",
      classId: capacityClassId,
      name: "Casey Journey",
      dateOfBirth: "1994-06-07",
      email: "casey.journey@example.test",
    }), "127.0.0.24")),
    (error) => error.code === "failed-precondition" &&
      error.details?.reason === "class_full"
  );
  assert.equal(fakeStripe.state.checkoutSessions.size, 2);
  assert.deepEqual(await classCounts(capacityClassId), {booked: 1, unpaid: 1});

  const completed = fakeStripe.completePaygCheckout(first.sessionId);
  const event = {
    id: "evt_payg_local_journey_completed",
    object: "event",
    type: "checkout.session.completed",
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: {object: {...completed.session}},
  };
  assert.equal(await dispatchPaygStripeEvent(event), true);

  const orderId = completed.session.metadata.paygIntentId;
  assert.equal(orderId, intentId);
  let order = await db.collection("paygOrders").doc(orderId).get();
  assert.equal(order.exists, true);
  assert.equal(order.get("status"), "confirmed");
  assert.equal(order.get("amountPence"), PAYG_AMOUNT_PENCE);
  assert.equal(order.get("currency"), "gbp");
  assert.equal(order.get("confirmationEmailStatus"), "pending");
  assert.equal(order.get("acceptances.legal.waiver.version"), WAIVER_VERSION);
  assert.equal(order.get("acceptances.legal.terms.version"), TERMS_VERSION);
  assert.equal(
    order.get("acceptances.legal.privacyNotice.version"),
    PRIVACY_NOTICE_VERSION
  );
  assert.equal(order.get("acceptances.acceptedAt").toMillis(), acceptedAt.toMillis());
  assert.equal(
    order.get("retainedAcceptanceEvidence.waiver.version"),
    WAIVER_VERSION
  );
  assert.equal(
    order.get("retainedAcceptanceEvidence.terms.version"),
    TERMS_VERSION
  );
  assert.equal(
    order.get("retainedAcceptanceEvidence.acceptedAt").toMillis(),
    acceptedAt.toMillis()
  );
  assert.deepEqual(await classCounts(classId), {booked: 1, unpaid: 0});

  const bookingRef = db.collection("bookings").doc(order.get("bookingId"));
  const booking = await bookingRef.get();
  assert.equal(booking.get("bookingKind"), "payg_guest");
  assert.equal(booking.get("status"), "booked");
  assert.equal(
    booking.get("retainedAcceptanceEvidence.waiver.version"),
    WAIVER_VERSION
  );
  assert.equal(
    booking.get("retainedAcceptanceEvidence.terms.version"),
    TERMS_VERSION
  );
  assert.equal(
    booking.get("retainedAcceptanceEvidence.privacyNotice.version"),
    PRIVACY_NOTICE_VERSION
  );
  assert.equal(
    booking.get("retainedAcceptanceEvidence.privacyNoticePresented"),
    true
  );
  assert.equal(
    booking.get("retainedAcceptanceEvidence.acceptedAt").toMillis(),
    acceptedAt.toMillis()
  );

  const pendingOutbox = await db.collection("paygEmailOutbox").doc(orderId).get();
  assert.equal(
    pendingOutbox.get("templateData.legalAcceptance.waiver.version"),
    WAIVER_VERSION
  );
  assert.equal(
    pendingOutbox.get("templateData.legalAcceptance.terms.version"),
    TERMS_VERSION
  );
  assert.equal(
    pendingOutbox.get("templateData.legalAcceptance.privacyNotice.version"),
    PRIVACY_NOTICE_VERSION
  );
  assert.equal(
    pendingOutbox.get("templateData.legalAcceptance.waiver.sha256"),
    "a".repeat(64)
  );
  assert.equal(
    pendingOutbox.get("templateData.legalAcceptance.terms.sha256"),
    "b".repeat(64)
  );
  assert.equal(
    pendingOutbox.get("templateData.legalAcceptance.privacyNotice.sha256"),
    "c".repeat(64)
  );
  assert.equal(
    pendingOutbox.get("templateData.legalAcceptance.acceptedAt"),
    acceptedAtIso
  );
  assert.equal(
    pendingOutbox.get("templateData.legalAcceptance.waiver.publicUrl"),
    "http://127.0.0.1:3002/legal/payg-waiver-local.txt"
  );
  assert.equal(
    pendingOutbox.get("templateData.legalAcceptance.terms.publicUrl"),
    "http://127.0.0.1:3002/legal/payg-terms-local.txt"
  );
  assert.equal(
    pendingOutbox.get("templateData.legalAcceptance.privacyNotice.publicUrl"),
    "http://127.0.0.1:3002/legal/payg-privacy-local.txt"
  );

  const deliveries = [];
  const deliveryOutcome = await paygTesting.processPaygConfirmationOutbox(
    orderId,
    Date.now() + 1_000,
    async (email, idempotencyKey) => {
      deliveries.push({email, idempotencyKey});
      return "email_local_not_sent_1";
    }
  );
  assert.equal(deliveryOutcome, "sent");
  assert.equal(deliveries.length, 1);
  assert.deepEqual(deliveries[0].email.to, ["alex.journey@example.test"]);
  assert.match(deliveries[0].email.text, /Paid: £7\.00 GBP/);
  assert.match(deliveries[0].email.text, new RegExp(`PAYG Terms: ${TERMS_VERSION}`));
  assert.match(deliveries[0].email.text, new RegExp(`Participant Waiver: ${WAIVER_VERSION}`));
  assert.match(deliveries[0].email.text, new RegExp(`Privacy Notice shown: ${PRIVACY_NOTICE_VERSION}`));
  assert.doesNotMatch(deliveries[0].email.text, /Privacy Notice accepted/i);
  assert.match(deliveries[0].email.text, new RegExp(`Acceptance time: ${acceptedAtIso.replace(/\./g, "\\.")}`));
  assert.match(deliveries[0].email.text, /Cancel this booking: http:\/\/127\.0\.0\.1:3002\/pay-as-you-go\/cancel\?token=/);
  assert.equal(deliveries[0].idempotencyKey, `payg-confirmation/${orderId}/v1`);

  const deliveredOutbox = await db.collection("paygEmailOutbox").doc(orderId).get();
  assert.equal(deliveredOutbox.get("status"), "sent");
  assert.equal(deliveredOutbox.get("providerMessageId"), "email_local_not_sent_1");
  order = await db.collection("paygOrders").doc(orderId).get();
  assert.equal(order.get("confirmationEmailStatus"), "sent");

  const cancellationUrl = new URL(
    deliveredOutbox.get("templateData.cancellationUrl")
  );
  const token = cancellationUrl.searchParams.get("token");
  assert.ok(token, "the confirmation must contain the server-signed cancellation token");
  const cancellation = await requestPaygCancellation(callableRequest({
    token,
    confirm: true,
  }, "127.0.0.21"));
  assert.deepEqual(cancellation, {
    ok: true,
    outcome: "refund_pending",
    refundEligible: true,
    capacityReleased: true,
  });

  order = await db.collection("paygOrders").doc(orderId).get();
  assert.equal(order.get("status"), "refunded");
  assert.equal(order.get("capacityState"), "released");
  assert.equal(order.get("refundStatus"), "succeeded");
  assert.equal(order.get("refundedAmountPence"), PAYG_AMOUNT_PENCE);
  assert.equal(order.get("refundEmailStatus"), "pending");
  assert.equal(
    order.get("refundEmailOutboxId"),
    paygRefundOutboxId(orderId)
  );
  assert.equal(order.get("cancellation.policyOutcome"), "at_least_24_hours_refundable");
  assert.equal(fakeStripe.state.refunds.size, 1);
  assert.equal((await bookingRef.get()).get("status"), "cancelled");
  assert.deepEqual(await classCounts(classId), {booked: 0, unpaid: 0});

  const closedOutbox = await db.collection("paygEmailOutbox").doc(orderId).get();
  assert.equal(closedOutbox.get("status"), "tombstoned");
  assert.equal(closedOutbox.get("providerAcceptanceState"), "accepted_before_state_change");

  const refundDeliveries = [];
  const refundOutboxId = paygRefundOutboxId(orderId);
  const refundOutcome = await paygTesting.processPaygConfirmationOutbox(
    refundOutboxId,
    Date.now() + 2_000,
    async (email, idempotencyKey) => {
      refundDeliveries.push({email, idempotencyKey});
      return "email_local_refund_not_sent_1";
    }
  );
  assert.equal(refundOutcome, "sent");
  assert.equal(refundDeliveries.length, 1);
  assert.match(refundDeliveries[0].email.text, /Stripe has confirmed your £7\.00 GBP refund/i);
  assert.equal(
    refundDeliveries[0].idempotencyKey,
    `payg-refund-confirmed/${orderId}/v1`
  );
  const deliveredRefundOutbox = await db.collection("paygEmailOutbox")
    .doc(refundOutboxId).get();
  assert.equal(deliveredRefundOutbox.get("status"), "sent");
  order = await db.collection("paygOrders").doc(orderId).get();
  assert.equal(order.get("refundEmailStatus"), "sent");
  assert.equal(
    order.get("refundEmailProviderId"),
    "email_local_refund_not_sent_1"
  );

  console.log("PAYG_LOCAL_JOURNEY_EVIDENCE", JSON.stringify({
    checkout: "created",
    amountPence: PAYG_AMOUNT_PENCE,
    stripeMode: "test-loopback",
    holdCountedOnce: true,
    duplicateRejected: true,
    capacityRejected: true,
    guestBookingCreated: true,
    emailTransport: "injected-local-no-send",
    signedCancellationAccepted: true,
    refundStatus: order.get("refundStatus"),
    productionGatesChanged: false,
  }));
});

test("privacy closure preserves an active refund send until its provider acceptance is audited", {timeout: 30_000}, async () => {
  const classId = "payg_privacy_active_refund_class";
  await seedClass(classId, 2);
  const checkout = await createPaygCheckoutSession(callableRequest(checkoutRequest({
    attemptId: "paygPrivacyActiveRefund0001",
    classId,
    name: "Privacy Race Journey",
    dateOfBirth: "1989-09-10",
    email: "privacy.race@example.test",
  }), "127.0.0.51"));
  const completed = fakeStripe.completePaygCheckout(checkout.sessionId);
  assert.equal(await dispatchPaygStripeEvent({
    id: "evt_payg_privacy_active_refund_completed",
    object: "event",
    type: "checkout.session.completed",
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: {object: {...completed.session}},
  }), true);

  const orderId = completed.session.metadata.paygIntentId;
  const confirmationRef = db.collection("paygEmailOutbox").doc(orderId);
  const cancellationUrl = new URL(
    (await confirmationRef.get()).get("templateData.cancellationUrl")
  );
  const token = cancellationUrl.searchParams.get("token");
  assert.ok(token);

  let releaseConfirmationSender;
  let confirmationSenderReached;
  const confirmationReached = new Promise((resolve) => {
    confirmationSenderReached = resolve;
  });
  const confirmationRelease = new Promise((resolve) => {
    releaseConfirmationSender = resolve;
  });
  const confirmationDelivery = paygTesting.processPaygConfirmationOutbox(
    orderId,
    Date.now(),
    async () => {
      confirmationSenderReached();
      await confirmationRelease;
      return "email_local_privacy_confirmation_not_sent_1";
    }
  );
  await confirmationReached;

  assert.deepEqual(await requestPaygCancellation(callableRequest({
    token,
    confirm: true,
  }, "127.0.0.51")), {
    ok: true,
    outcome: "refund_pending",
    refundEligible: true,
    capacityReleased: true,
  });

  const refundOutboxId = paygRefundOutboxId(orderId);
  const refundRef = db.collection("paygEmailOutbox").doc(refundOutboxId);
  let releaseRefundSender;
  let refundSenderReached;
  const refundReached = new Promise((resolve) => {
    refundSenderReached = resolve;
  });
  const refundRelease = new Promise((resolve) => {
    releaseRefundSender = resolve;
  });
  const refundDelivery = paygTesting.processPaygConfirmationOutbox(
    refundOutboxId,
    Date.now(),
    async () => {
      refundSenderReached();
      await refundRelease;
      return "email_local_privacy_refund_not_sent_1";
    }
  );
  await refundReached;

  const [confirmationLease, refundLease] = await Promise.all([
    confirmationRef.get(),
    refundRef.get(),
  ]);
  assert.equal(confirmationLease.get("status"), "tombstoned");
  assert.equal(refundLease.get("status"), "sending");
  const refundLeaseToken = refundLease.get("leaseToken");
  const refundLeaseExpiresAt = refundLease.get("leaseExpiresAt");
  const cutoffMillis = Math.max(
    confirmationLease.get("lastAttemptAt").toMillis(),
    refundLease.get("lastAttemptAt").toMillis()
  ) + 1;
  if (cutoffMillis >= Date.now()) {
    await new Promise((resolve) => setTimeout(
      resolve,
      cutoffMillis - Date.now() + 5
    ));
  }
  const expiredCutoff = admin.firestore.Timestamp.fromMillis(cutoffMillis);
  const privacyBatch = db.batch();
  for (const ref of [
    db.collection("paygOrders").doc(orderId),
    confirmationRef,
    refundRef,
  ]) {
    privacyBatch.set(ref, {
      piiRetentionCutoffAt: expiredCutoff,
      piiRedactionRetryAt: expiredCutoff,
    }, {merge: true});
  }
  await privacyBatch.commit();

  releaseConfirmationSender();
  assert.equal(await confirmationDelivery, "sent");

  const deferredRefund = await refundRef.get();
  assert.equal(deferredRefund.get("status"), "sending");
  assert.equal(deferredRefund.get("leaseToken"), refundLeaseToken);
  assert.equal(
    deferredRefund.get("piiRedactionRetryAt").toMillis(),
    refundLeaseExpiresAt.toMillis()
  );
  assert.equal(
    deferredRefund.get("piiRedactionDeferredReason"),
    "active_email_lease"
  );
  assert.deepEqual(deferredRefund.get("to"), ["privacy.race@example.test"]);

  releaseRefundSender();
  assert.equal(await refundDelivery, "sent");
  const [closedRefund, order] = await Promise.all([
    refundRef.get(),
    db.collection("paygOrders").doc(orderId).get(),
  ]);
  assert.equal(closedRefund.get("status"), "tombstoned");
  assert.equal(closedRefund.get("providerAcceptanceState"), "accepted");
  assert.equal(
    closedRefund.get("providerMessageId"),
    "email_local_privacy_refund_not_sent_1"
  );
  assert.equal(closedRefund.get("to"), undefined);
  assert.equal(closedRefund.get("templateData"), undefined);
  assert.equal(order.get("refundEmailStatus"), "sent");
  assert.equal(
    order.get("refundEmailProviderId"),
    "email_local_privacy_refund_not_sent_1"
  );
});

test("PAYG dispute replays enqueue and deliver one exact inactive-booking notice", {timeout: 30_000}, async () => {
  const classId = "payg_dispute_journey_class";
  await seedClass(classId, 3);
  const checkout = await createPaygCheckoutSession(callableRequest(checkoutRequest({
    attemptId: "paygDisputeJourneyAttempt0001",
    classId,
    name: "Dispute Journey",
    dateOfBirth: "1991-03-04",
    email: "dispute.journey@example.test",
  }), "127.0.0.31"));
  const completed = fakeStripe.completePaygCheckout(checkout.sessionId);
  assert.equal(await dispatchPaygStripeEvent({
    id: "evt_payg_dispute_journey_completed",
    object: "event",
    type: "checkout.session.completed",
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: {object: {...completed.session}},
  }), true);

  const orderId = completed.session.metadata.paygIntentId;
  const disputeId = "du_fake_payg_dispute_1";
  const chargeId = completed.charge.id;
  const dispatchDispute = async (type, status, sequence) => {
    const dispute = fakeStripe.setDispute(disputeId, {
      status,
      charge: chargeId,
      amount: PAYG_AMOUNT_PENCE,
      currency: "gbp",
    });
    assert.equal(await dispatchPaygStripeEvent({
      id: `evt_payg_dispute_journey_${sequence}`,
      object: "event",
      type,
      livemode: false,
      created: Math.floor(Date.now() / 1000) + sequence,
      data: {object: {...dispute}},
    }), true);
  };

  await dispatchDispute("charge.dispute.created", "needs_response", 1);
  await dispatchDispute("charge.dispute.updated", "under_review", 2);
  await dispatchDispute("charge.dispute.closed", "lost", 3);
  // Model an older provider read completing after the terminal handler. The
  // transaction must preserve the already-committed terminal evidence and use
  // that stored binding for the one deterministic lifecycle notice.
  await dispatchDispute("charge.dispute.updated", "needs_response", 4);

  const disputeOutboxId = paygDisputeOutboxId(orderId);
  const [order, originalOutbox, disputeOutbox, lifecycleRows] = await Promise.all([
    db.collection("paygOrders").doc(orderId).get(),
    db.collection("paygEmailOutbox").doc(orderId).get(),
    db.collection("paygEmailOutbox").doc(disputeOutboxId).get(),
    db.collection("paygEmailOutbox")
      .where("kind", "==", "payg_guest_dispute_notice")
      .get(),
  ]);
  assert.equal(order.get("status"), "disputed");
  assert.equal(order.get("capacityState"), "released");
  assert.equal(order.get("disputeId"), disputeId);
  assert.equal(order.get("disputeStatus"), "lost");
  assert.equal(order.get("disputeAmountPence"), PAYG_AMOUNT_PENCE);
  assert.equal(order.get("disputeCurrency"), "gbp");
  assert.equal(order.get("disputeEmailStatus"), "pending");
  assert.equal(order.get("disputeEmailOutboxId"), disputeOutboxId);
  assert.equal(originalOutbox.get("status"), "tombstoned");
  assert.equal(disputeOutbox.get("status"), "pending");
  assert.equal(
    lifecycleRows.size,
    1,
    "created/updated/closed and a stale replay must share one notice"
  );
  assert.deepEqual(await classCounts(classId), {booked: 0, unpaid: 0});

  const deliveries = [];
  const deliveryOutcome = await paygTesting.processPaygConfirmationOutbox(
    disputeOutboxId,
    Date.now() + 4_000,
    async (email, idempotencyKey) => {
      deliveries.push({email, idempotencyKey});
      return "email_local_dispute_not_sent_1";
    }
  );
  assert.equal(deliveryOutcome, "sent");
  assert.equal(deliveries.length, 1);
  assert.match(deliveries[0].email.text, /Stripe reported a dispute on the £7\.00 GBP payment/i);
  assert.match(deliveries[0].email.text, /booking is inactive/i);
  assert.doesNotMatch(deliveries[0].email.text, /we (won|lost)|final outcome/i);
  assert.equal(
    deliveries[0].idempotencyKey,
    `payg-dispute-detected/${orderId}/v1`
  );
  const deliveredOrder = await db.collection("paygOrders").doc(orderId).get();
  assert.equal(deliveredOrder.get("disputeEmailStatus"), "sent");
  assert.equal(
    deliveredOrder.get("disputeEmailProviderId"),
    "email_local_dispute_not_sent_1"
  );
});

test("charge-first refund convergence waits for one canonical Refund before enqueueing", {timeout: 30_000}, async () => {
  const classId = "payg_charge_first_refund_class";
  await seedClass(classId, 2);
  const checkout = await createPaygCheckoutSession(callableRequest(checkoutRequest({
    attemptId: "paygChargeFirstRefundAttempt01",
    classId,
    name: "Charge First Journey",
    dateOfBirth: "1988-05-06",
    email: "charge.first@example.test",
  }), "127.0.0.41"));
  const completed = fakeStripe.completePaygCheckout(checkout.sessionId);
  assert.equal(await dispatchPaygStripeEvent({
    id: "evt_payg_charge_first_completed",
    object: "event",
    type: "checkout.session.completed",
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: {object: {...completed.session}},
  }), true);

  const orderId = completed.session.metadata.paygIntentId;
  const refundId = "re_fake_charge_first_1";
  const refund = {
    id: refundId,
    object: "refund",
    livemode: false,
    amount: PAYG_AMOUNT_PENCE,
    currency: "gbp",
    payment_intent: completed.paymentIntent.id,
    charge: completed.charge.id,
    status: "succeeded",
    failure_reason: null,
    metadata: {paygOrderId: orderId},
  };
  fakeStripe.state.refunds.set(refundId, refund);
  const charge = fakeStripe.state.charges.get(completed.charge.id);
  charge.amount_refunded = PAYG_AMOUNT_PENCE;
  charge.refunded = true;

  assert.equal(await dispatchPaygStripeEvent({
    id: "evt_payg_charge_first_refunded",
    object: "event",
    type: "charge.refunded",
    livemode: false,
    created: Math.floor(Date.now() / 1000) + 1,
    data: {object: {...charge}},
  }), true);
  const refundOutboxRef = db.collection("paygEmailOutbox")
    .doc(paygRefundOutboxId(orderId));
  assert.equal(
    (await refundOutboxRef.get()).exists,
    false,
    "charge.refunded without a canonical Refund ID must not freeze a null binding"
  );
  let order = await db.collection("paygOrders").doc(orderId).get();
  assert.equal(order.get("refundStatus"), "succeeded");
  assert.equal(order.get("refundEmailStatus"), "not_required");
  assert.equal(
    order.get("refundEmailClosureReason"),
    "canonical_refund_reference_pending"
  );

  assert.equal(await dispatchPaygStripeEvent({
    id: "evt_payg_refund_after_charge",
    object: "event",
    type: "refund.updated",
    livemode: false,
    created: Math.floor(Date.now() / 1000) + 2,
    data: {object: {...refund}},
  }), true);
  let refundOutbox = await refundOutboxRef.get();
  assert.equal(refundOutbox.exists, true);
  assert.equal(refundOutbox.get("templateData.refundId"), refundId);
  assert.equal(refundOutbox.get("status"), "pending");
  order = await db.collection("paygOrders").doc(orderId).get();
  assert.equal(order.get("refundId"), refundId);
  assert.equal(order.get("refundEmailStatus"), "pending");
  assert.equal(order.get("refundEmailError"), undefined);

  assert.equal(await dispatchPaygStripeEvent({
    id: "evt_payg_charge_first_replay",
    object: "event",
    type: "charge.refunded",
    livemode: false,
    created: Math.floor(Date.now() / 1000) + 3,
    data: {object: {...charge}},
  }), true);
  refundOutbox = await refundOutboxRef.get();
  assert.equal(refundOutbox.get("templateData.refundId"), refundId);
  order = await db.collection("paygOrders").doc(orderId).get();
  assert.equal(
    order.get("refundEmailStatus"),
    "pending",
    "a charge replay without embedded Refund data must preserve the queued notice"
  );
  assert.equal(
    (await db.collection("paygEmailOutbox")
      .where("kind", "==", "payg_guest_refund_confirmation")
      .get()).size,
    1
  );

  assert.equal(await paygTesting.processPaygConfirmationOutbox(
    refundOutboxRef.id,
    Date.now() + 4_000,
    async () => "email_local_charge_first_not_sent_1"
  ), "sent");
  assert.equal(await dispatchPaygStripeEvent({
    id: "evt_payg_charge_first_after_delivery_replay",
    object: "event",
    type: "charge.refunded",
    livemode: false,
    created: Math.floor(Date.now() / 1000) + 4,
    data: {object: {...charge}},
  }), true);
  order = await db.collection("paygOrders").doc(orderId).get();
  assert.equal(
    order.get("refundEmailStatus"),
    "sent",
    "a charge replay must preserve the delivered lifecycle projection"
  );
});

test("charge.refunded with one exact embedded Refund persists the canonical binding and delivers once", {timeout: 30_000}, async () => {
  const classId = "payg_embedded_refund_class";
  await seedClass(classId, 2);
  const checkout = await createPaygCheckoutSession(callableRequest(checkoutRequest({
    attemptId: "paygEmbeddedRefundAttempt0001",
    classId,
    name: "Embedded Refund Journey",
    dateOfBirth: "1987-07-08",
    email: "embedded.refund@example.test",
  }), "127.0.0.42"));
  const completed = fakeStripe.completePaygCheckout(checkout.sessionId);
  assert.equal(await dispatchPaygStripeEvent({
    id: "evt_payg_embedded_refund_completed",
    object: "event",
    type: "checkout.session.completed",
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: {object: {...completed.session}},
  }), true);

  const orderId = completed.session.metadata.paygIntentId;
  const refundId = "re_fake_embedded_full_1";
  const embeddedRefund = {
    id: refundId,
    object: "refund",
    livemode: false,
    amount: PAYG_AMOUNT_PENCE,
    currency: "gbp",
    payment_intent: completed.paymentIntent.id,
    charge: completed.charge.id,
    status: "succeeded",
    failure_reason: null,
    metadata: {paygOrderId: orderId},
  };
  const charge = fakeStripe.state.charges.get(completed.charge.id);
  charge.amount_refunded = PAYG_AMOUNT_PENCE;
  charge.refunded = true;
  charge.refunds = {
    object: "list",
    data: [embeddedRefund],
    has_more: false,
    url: `/v1/charges/${charge.id}/refunds`,
  };
  assert.equal(await dispatchPaygStripeEvent({
    id: "evt_payg_embedded_refund_charge",
    object: "event",
    type: "charge.refunded",
    livemode: false,
    created: Math.floor(Date.now() / 1000) + 1,
    data: {object: {...charge}},
  }), true);

  const refundOutboxId = paygRefundOutboxId(orderId);
  let order = await db.collection("paygOrders").doc(orderId).get();
  assert.equal(order.get("refundId"), refundId);
  assert.equal(order.get("refundStatus"), "succeeded");
  assert.equal(order.get("refundEmailStatus"), "pending");
  assert.equal(
    (await db.collection("paygEmailOutbox").doc(refundOutboxId).get())
      .get("templateData.refundId"),
    refundId
  );

  const deliveries = [];
  assert.equal(await paygTesting.processPaygConfirmationOutbox(
    refundOutboxId,
    Date.now() + 2_000,
    async (email, idempotencyKey) => {
      deliveries.push({email, idempotencyKey});
      return "email_local_embedded_refund_not_sent_1";
    }
  ), "sent");
  assert.equal(deliveries.length, 1);
  assert.match(deliveries[0].email.text, /£7\.00 GBP refund/i);
  order = await db.collection("paygOrders").doc(orderId).get();
  assert.equal(order.get("refundEmailStatus"), "sent");
});

test("an aggregate full Charge made from partial Refunds never gets full-refund wording", {timeout: 30_000}, async () => {
  const classId = "payg_aggregate_partial_refund_class";
  await seedClass(classId, 2);
  const checkout = await createPaygCheckoutSession(callableRequest(checkoutRequest({
    attemptId: "paygAggregatePartialAttempt01",
    classId,
    name: "Aggregate Partial Journey",
    dateOfBirth: "1986-08-09",
    email: "aggregate.partial@example.test",
  }), "127.0.0.43"));
  const completed = fakeStripe.completePaygCheckout(checkout.sessionId);
  assert.equal(await dispatchPaygStripeEvent({
    id: "evt_payg_aggregate_partial_completed",
    object: "event",
    type: "checkout.session.completed",
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: {object: {...completed.session}},
  }), true);

  const orderId = completed.session.metadata.paygIntentId;
  const firstPartialId = "re_fake_partial_first_1";
  await db.collection("paygOrders").doc(orderId).set({
    status: "manual_review",
    refundId: firstPartialId,
    refundStatus: "partial_refund_manual_review",
    refundedAmountPence: 350,
  }, {merge: true});
  const partialRefund = (id) => ({
    id,
    object: "refund",
    livemode: false,
    amount: 350,
    currency: "gbp",
    payment_intent: completed.paymentIntent.id,
    charge: completed.charge.id,
    status: "succeeded",
    failure_reason: null,
    metadata: {paygOrderId: orderId},
  });
  const charge = fakeStripe.state.charges.get(completed.charge.id);
  charge.amount_refunded = PAYG_AMOUNT_PENCE;
  charge.refunded = true;
  charge.refunds = {
    object: "list",
    data: [
      partialRefund(firstPartialId),
      partialRefund("re_fake_partial_second_2"),
    ],
    has_more: false,
    url: `/v1/charges/${charge.id}/refunds`,
  };
  assert.equal(await dispatchPaygStripeEvent({
    id: "evt_payg_aggregate_partial_charge",
    object: "event",
    type: "charge.refunded",
    livemode: false,
    created: Math.floor(Date.now() / 1000) + 1,
    data: {object: {...charge}},
  }), true);

  const order = await db.collection("paygOrders").doc(orderId).get();
  assert.equal(order.get("status"), "manual_review");
  assert.equal(order.get("refundId"), firstPartialId);
  assert.notEqual(order.get("refundEmailStatus"), "pending");
  assert.equal(
    (await db.collection("paygEmailOutbox")
      .doc(paygRefundOutboxId(orderId)).get()).exists,
    false,
    "two partial Refunds must never be represented as one exact £7 Refund"
  );
});

test("an embedded full Refund conflicting with a stored Refund ID fails closed", {timeout: 30_000}, async () => {
  const classId = "payg_refund_id_conflict_class";
  await seedClass(classId, 2);
  const checkout = await createPaygCheckoutSession(callableRequest(checkoutRequest({
    attemptId: "paygRefundConflictAttempt0001",
    classId,
    name: "Refund Conflict Journey",
    dateOfBirth: "1985-09-10",
    email: "refund.conflict@example.test",
  }), "127.0.0.44"));
  const completed = fakeStripe.completePaygCheckout(checkout.sessionId);
  assert.equal(await dispatchPaygStripeEvent({
    id: "evt_payg_refund_conflict_completed",
    object: "event",
    type: "checkout.session.completed",
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: {object: {...completed.session}},
  }), true);

  const orderId = completed.session.metadata.paygIntentId;
  const storedRefundId = "re_fake_stored_pending_1";
  const incomingRefundId = "re_fake_embedded_conflict_2";
  await db.collection("paygOrders").doc(orderId).set({
    status: "refund_pending",
    refundId: storedRefundId,
    refundStatus: "pending",
  }, {merge: true});
  const charge = fakeStripe.state.charges.get(completed.charge.id);
  charge.amount_refunded = PAYG_AMOUNT_PENCE;
  charge.refunded = true;
  charge.refunds = {
    object: "list",
    data: [{
      id: incomingRefundId,
      object: "refund",
      livemode: false,
      amount: PAYG_AMOUNT_PENCE,
      currency: "gbp",
      payment_intent: completed.paymentIntent.id,
      charge: completed.charge.id,
      status: "succeeded",
      failure_reason: null,
      metadata: {paygOrderId: orderId},
    }],
    has_more: false,
    url: `/v1/charges/${charge.id}/refunds`,
  };
  assert.equal(await dispatchPaygStripeEvent({
    id: "evt_payg_refund_conflict_charge",
    object: "event",
    type: "charge.refunded",
    livemode: false,
    created: Math.floor(Date.now() / 1000) + 1,
    data: {object: {...charge}},
  }), true);

  const order = await db.collection("paygOrders").doc(orderId).get();
  assert.equal(order.get("status"), "manual_review");
  assert.equal(order.get("refundId"), storedRefundId);
  assert.equal(order.get("conflictingRefundId"), incomingRefundId);
  assert.equal(order.get("refundStatus"), "conflicting_refund_id");
  assert.equal(order.get("refundEmailStatus"), "manual_review");
  assert.equal(
    (await db.collection("paygEmailOutbox")
      .doc(paygRefundOutboxId(orderId)).get()).exists,
    false
  );
});

test("linked payment-review orders never enqueue ordinary refund or dispute emails", {timeout: 30_000}, async () => {
  const classId = "payg_review_lifecycle_class";
  await seedClass(classId, 2);
  const checkout = await createPaygCheckoutSession(callableRequest(checkoutRequest({
    attemptId: "paygReviewLifecycleAttempt001",
    classId,
    name: "Review Lifecycle Journey",
    dateOfBirth: "1989-06-07",
    email: "review.lifecycle@example.test",
  }), "127.0.0.51"));
  const completed = fakeStripe.completePaygCheckout(checkout.sessionId);
  assert.equal(await dispatchPaygStripeEvent({
    id: "evt_payg_review_lifecycle_completed",
    object: "event",
    type: "checkout.session.completed",
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: {object: {...completed.session}},
  }), true);

  const orderId = completed.session.metadata.paygIntentId;
  const paymentReviewId = `${orderId}_${"c".repeat(24)}`;
  await Promise.all([
    db.collection("paygOrders").doc(orderId).set({
      paymentReviewId,
      providerContractStatus: "mismatch",
      providerContractMismatches: ["test_payment_review"],
      refundExpectedAmountPence: PAYG_AMOUNT_PENCE,
    }, {merge: true}),
    db.collection("paygPaymentReviews").doc(paymentReviewId).set({
      orderId,
      paymentIntentId: completed.paymentIntent.id,
      status: "refund_pending",
      providerCurrency: "gbp",
    }),
  ]);

  const refundId = "re_fake_review_lifecycle_1";
  const refund = {
    id: refundId,
    object: "refund",
    livemode: false,
    amount: PAYG_AMOUNT_PENCE,
    currency: "gbp",
    payment_intent: completed.paymentIntent.id,
    charge: completed.charge.id,
    status: "succeeded",
    failure_reason: null,
    metadata: {paygOrderId: orderId},
  };
  fakeStripe.state.refunds.set(refundId, refund);
  assert.equal(await dispatchPaygStripeEvent({
    id: "evt_payg_review_lifecycle_refunded",
    object: "event",
    type: "refund.updated",
    livemode: false,
    created: Math.floor(Date.now() / 1000) + 1,
    data: {object: refund},
  }), true);
  assert.equal(
    (await db.collection("paygEmailOutbox")
      .doc(paygRefundOutboxId(orderId)).get()).exists,
    false
  );

  const disputeId = "du_fake_review_lifecycle_1";
  const dispute = fakeStripe.setDispute(disputeId, {
    status: "needs_response",
    charge: completed.charge.id,
    amount: PAYG_AMOUNT_PENCE,
    currency: "gbp",
  });
  assert.equal(await dispatchPaygStripeEvent({
    id: "evt_payg_review_lifecycle_disputed",
    object: "event",
    type: "charge.dispute.created",
    livemode: false,
    created: Math.floor(Date.now() / 1000) + 2,
    data: {object: {...dispute}},
  }), true);
  assert.equal(
    (await db.collection("paygEmailOutbox")
      .doc(paygDisputeOutboxId(orderId)).get()).exists,
    false
  );

  const order = await db.collection("paygOrders").doc(orderId).get();
  assert.equal(order.get("paymentReviewId"), paymentReviewId);
  assert.equal(order.get("providerContractStatus"), "mismatch");
  assert.notEqual(order.get("refundEmailStatus"), "pending");
  assert.notEqual(order.get("disputeEmailStatus"), "pending");
});

test("class cancellation expires one exact open Checkout and releases its hold once", {timeout: 30_000}, async () => {
  const classId = "payg_whole_class_open_checkout";
  await Promise.all([
    seedClass(classId, 3),
    seedClassCancellationAdmin(),
  ]);
  const checkout = await createPaygCheckoutSession(callableRequest(checkoutRequest({
    attemptId: "paygWholeClassOpenCheckout001",
    classId,
    name: "Open Checkout Guest",
    dateOfBirth: "1991-04-05",
    email: "open.checkout@example.test",
  }), "127.0.0.81"));
  assert.deepEqual(await classCounts(classId), {booked: 1, unpaid: 1});
  const expirePath = `/v1/checkout/sessions/${checkout.sessionId}/expire`;
  const expiresBefore = fakeStripe.state.updates.filter(
    ({path}) => path === expirePath
  ).length;

  const begun = await beginClassCancellation(adminCallableRequest({classId}));
  assert.equal(begun.operation.state, "ready_to_finalize");
  assert.deepEqual(await classCounts(classId), {booked: 0, unpaid: 0});
  const intentId = fakeStripe.state.checkoutSessions
    .get(checkout.sessionId).metadata.paygIntentId;
  assert.equal(
    fakeStripe.state.checkoutSessions.get(checkout.sessionId).status,
    "expired"
  );
  assert.equal(fakeStripe.state.updates.filter(
    ({path}) => path === expirePath
  ).length, expiresBefore + 1);
  const intentAfterFreeze = await db.collection("paygIntents").doc(intentId).get();
  assert.equal(intentAfterFreeze.get("capacityState"), "released");
  assert.equal(intentAfterFreeze.get("unpaidHoldState"), "released");
  assert.equal(
    intentAfterFreeze.get("classCancellationProviderDisposition"),
    "session_expired"
  );
  assert.equal(
    intentAfterFreeze.get("classCancellationProviderTerminalNonpayment"),
    true
  );
  assert.equal(
    intentAfterFreeze.get("classCancellationCheckoutExpirySessionId"),
    checkout.sessionId
  );

  await assert.rejects(
    createPaygCheckoutSession(callableRequest(checkoutRequest({
      attemptId: "paygWholeClassFrozenAttempt02",
      classId,
      name: "Blocked Guest",
      dateOfBirth: "1990-01-01",
      email: "blocked.guest@example.test",
    }), "127.0.0.82")),
    (error) => error.code === "failed-precondition" &&
      error.details?.reason === "class_unavailable"
  );
  const resumed = await beginClassCancellation(adminCallableRequest({classId}));
  assert.equal(resumed.operation.state, "ready_to_finalize");
  assert.equal(resumed.paygGuests.length, 0);
  assert.equal(fakeStripe.state.updates.filter(
    ({path}) => path === expirePath
  ).length, expiresBefore + 1, "resume must not expire twice");
  const finalized = await finalizeClassCancellation(
    adminCallableRequest({classId})
  );
  assert.equal(finalized.operation.state, "cancelled");
  assert.equal(finalized.alreadyFinalized, false);
  assert.equal(
    (await finalizeClassCancellation(adminCallableRequest({classId})))
      .alreadyFinalized,
    true
  );
});

test("payment winning the Checkout-expiry race creates one privacy-safe exact £7 review refund", {timeout: 30_000}, async () => {
  const classId = "payg_whole_class_expiry_payment_race";
  await Promise.all([
    seedClass(classId, 3),
    seedClassCancellationAdmin(),
  ]);
  const checkout = await createPaygCheckoutSession(callableRequest(checkoutRequest({
    attemptId: "paygWholeClassExpiryRace001",
    classId,
    name: "Expiry Race Guest",
    dateOfBirth: "1991-04-06",
    email: "expiry.race@example.test",
  }), "127.0.0.89"));
  const barrier = fakeStripe.pauseNextCheckoutExpire(checkout.sessionId);
  const beginning = beginClassCancellation(adminCallableRequest({classId}));
  await barrier.reached;
  const completed = fakeStripe.completePaygCheckout(checkout.sessionId);
  barrier.release();
  const begun = await beginning;
  assert.equal(begun.operation.state, "ready_to_finalize");

  const intentId = completed.session.metadata.paygIntentId;
  assert.equal(
    (await db.collection("paygOrders").doc(intentId).get()).exists,
    false,
    "provider readback without signed event time must not promote guest PII"
  );
  const reviews = await db.collection("paygPaymentReviews")
    .where("intentId", "==", intentId).get();
  assert.equal(reviews.size, 1);
  const review = reviews.docs[0];
  assert.equal(review.get("status"), "refunded");
  assert.equal(review.get("refundStatus"), "succeeded");
  assert.equal(review.get("refundedAmountPence"), PAYG_AMOUNT_PENCE);
  assert.equal(review.get("classCancellationOperationId"), begun.operation.id);
  assert.equal(review.get("classCancellationRefundAuthorized"), true);
  assert.deepEqual(await classCounts(classId), {booked: 0, unpaid: 0});

  const refundWrites = fakeStripe.state.updates.filter(
    ({path}) => path === "/v1/refunds"
  );
  const refundWrite = refundWrites.find(({payload}) =>
    payload.payment_intent === completed.paymentIntent.id
  );
  assert.ok(refundWrite);
  assert.equal(refundWrite.payload.amount, String(PAYG_AMOUNT_PENCE));
  assert.equal(
    refundWrite.idempotencyKey,
    `payg-review-refund:${review.id}`
  );
  assert.equal(
    refundWrite.payload["metadata[refundReason]"],
    "paid_contract_mismatch"
  );
  assert.equal(
    refundWrite.payload["metadata[classCancellationOperationId]"],
    begun.operation.id
  );
  assert.equal(
    fakeStripe.state.refundByIdempotencyKey.get(
      `payg-review-refund:${review.id}`
    ),
    review.get("refundId")
  );

  const refundCount = fakeStripe.state.refunds.size;
  const resumed = await beginClassCancellation(adminCallableRequest({classId}));
  assert.equal(resumed.operation.state, "ready_to_finalize");
  assert.equal(fakeStripe.state.refunds.size, refundCount);
  assert.equal(
    (await finalizeClassCancellation(adminCallableRequest({classId})))
      .operation.state,
    "cancelled"
  );
});

test("Checkout expiry transport ambiguity stays frozen and resumes without leaking capacity", {timeout: 30_000}, async () => {
  const classId = "payg_whole_class_expiry_transport";
  await Promise.all([
    seedClass(classId, 2),
    seedClassCancellationAdmin(),
  ]);
  const checkout = await createPaygCheckoutSession(callableRequest(checkoutRequest({
    attemptId: "paygWholeClassExpiryTransport01",
    classId,
    name: "Expiry Transport Guest",
    dateOfBirth: "1992-04-07",
    email: "expiry.transport@example.test",
  }), "127.0.0.90"));
  fakeStripe.failNextCheckoutExpire(checkout.sessionId, {status: 400});
  await assert.rejects(
    beginClassCancellation(adminCallableRequest({classId})),
    /Injected Checkout expiry transport failure/
  );
  assert.equal(
    fakeStripe.state.checkoutSessions.get(checkout.sessionId).status,
    "open"
  );
  assert.deepEqual(await classCounts(classId), {booked: 1, unpaid: 1});
  const intentId = fakeStripe.state.checkoutSessions
    .get(checkout.sessionId).metadata.paygIntentId;
  const blockedIntent = await db.collection("paygIntents").doc(intentId).get();
  assert.equal(
    blockedIntent.get("classCancellationProviderTerminalNonpayment"),
    undefined
  );

  const resumed = await beginClassCancellation(adminCallableRequest({classId}));
  assert.equal(resumed.operation.state, "ready_to_finalize");
  assert.equal(
    fakeStripe.state.checkoutSessions.get(checkout.sessionId).status,
    "expired"
  );
  assert.deepEqual(await classCounts(classId), {booked: 0, unpaid: 0});

  const lostResponseClassId = "payg_whole_class_expiry_lost_response";
  await seedClass(lostResponseClassId, 2);
  const lostResponseCheckout = await createPaygCheckoutSession(
    callableRequest(checkoutRequest({
      attemptId: "paygWholeClassExpiryLostResponse1",
      classId: lostResponseClassId,
      name: "Expiry Lost Response Guest",
      dateOfBirth: "1992-04-08",
      email: "expiry.lost@example.test",
    }), "127.0.0.91")
  );
  fakeStripe.failNextCheckoutExpire(lostResponseCheckout.sessionId, {
    afterExpire: true,
  });
  const converged = await beginClassCancellation(
    adminCallableRequest({classId: lostResponseClassId})
  );
  assert.equal(converged.operation.state, "ready_to_finalize");
  assert.equal(
    fakeStripe.state.checkoutSessions.get(lostResponseCheckout.sessionId).status,
    "expired"
  );
  assert.deepEqual(
    await classCounts(lostResponseClassId),
    {booked: 0, unpaid: 0}
  );
});

test("existing paid PAYG booking is refunded once with exact class-cancellation evidence", {timeout: 30_000}, async () => {
  const classId = "payg_whole_class_existing_paid";
  await Promise.all([
    seedClass(classId, 3),
    seedClassCancellationAdmin(),
  ]);
  const checkout = await createPaygCheckoutSession(callableRequest(checkoutRequest({
    attemptId: "paygWholeClassExistingPaid001",
    classId,
    name: "Existing Paid Guest",
    dateOfBirth: "1990-08-09",
    email: "existing.paid@example.test",
  }), "127.0.0.92"));
  const completed = fakeStripe.completePaygCheckout(checkout.sessionId);
  assert.equal(await dispatchPaygStripeEvent({
    id: "evt_payg_whole_class_existing_paid",
    object: "event",
    type: "checkout.session.completed",
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: {object: {...completed.session}},
  }), true);
  const orderId = completed.session.metadata.paygIntentId;
  const refundWritesBefore = fakeStripe.state.updates.filter(
    ({path}) => path === "/v1/refunds"
  ).length;

  const begun = await beginClassCancellation(adminCallableRequest({classId}));
  assert.equal(begun.operation.state, "ready_to_finalize");
  const order = await db.collection("paygOrders").doc(orderId).get();
  assert.equal(order.get("status"), "refunded");
  assert.equal(order.get("refundReason"), "class_cancellation");
  assert.equal(order.get("refundExpectedAmountPence"), PAYG_AMOUNT_PENCE);
  assert.equal(order.get("refundedAmountPence"), PAYG_AMOUNT_PENCE);
  assert.equal(order.get("classCancellationRefundStatus"), "reconciled");
  assert.equal(
    order.get("classCancellationRefundProviderAmountPence"),
    PAYG_AMOUNT_PENCE
  );
  assert.equal(
    order.get("classCancellationRefundProviderCurrency"),
    "gbp"
  );
  assert.equal(
    order.get("classCancellationRefundProviderOperationId"),
    begun.operation.id
  );
  assert.deepEqual(await classCounts(classId), {booked: 0, unpaid: 0});
  assert.equal(
    fakeStripe.state.updates.filter(({path}) => path === "/v1/refunds").length,
    refundWritesBefore + 1
  );
  const exactWrite = [...fakeStripe.state.updates].reverse().find(
    ({path, payload}) => path === "/v1/refunds" &&
      payload.payment_intent === completed.paymentIntent.id
  );
  assert.ok(exactWrite);
  assert.equal(exactWrite.payload.amount, String(PAYG_AMOUNT_PENCE));
  assert.equal(exactWrite.idempotencyKey, `payg-refund:${orderId}`);

  const refundCount = fakeStripe.state.refunds.size;
  const resumed = await beginClassCancellation(adminCallableRequest({classId}));
  assert.equal(resumed.operation.state, "ready_to_finalize");
  assert.equal(fakeStripe.state.refunds.size, refundCount);
  assert.equal(
    (await finalizeClassCancellation(adminCallableRequest({classId})))
      .operation.state,
    "cancelled"
  );
});

test("concurrent class-cancellation begins share one exact provider refund", {timeout: 30_000}, async () => {
  const classId = "payg_whole_class_concurrent_begin";
  await Promise.all([
    seedClass(classId, 3),
    seedClassCancellationAdmin(),
  ]);
  const checkout = await createPaygCheckoutSession(callableRequest(checkoutRequest({
    attemptId: "paygWholeClassConcurrentBegin01",
    classId,
    name: "Concurrent Begin Guest",
    dateOfBirth: "1990-08-13",
    email: "concurrent.begin@example.test",
  }), "127.0.0.96"));
  const completed = fakeStripe.completePaygCheckout(checkout.sessionId);
  assert.equal(await dispatchPaygStripeEvent({
    id: "evt_payg_whole_class_concurrent_begin",
    object: "event",
    type: "checkout.session.completed",
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: {object: {...completed.session}},
  }), true);
  const orderId = completed.session.metadata.paygIntentId;
  const refundWritesBefore = fakeStripe.state.updates.filter(
    ({path}) => path === "/v1/refunds"
  ).length;
  const refundCountBefore = fakeStripe.state.refunds.size;
  const barrier = fakeStripe.pauseNextPaymentIntentRetrieve(
    completed.paymentIntent.id
  );
  const first = beginClassCancellation(adminCallableRequest({classId}));
  await barrier.reached;

  const concurrent = await beginClassCancellation(
    adminCallableRequest({classId})
  );
  assert.notEqual(concurrent.operation.state, "ready_to_finalize");
  assert.equal(
    fakeStripe.state.updates.filter(({path}) => path === "/v1/refunds").length,
    refundWritesBefore,
    "the second caller must observe the active refund claim"
  );

  barrier.release();
  const completedBegin = await first;
  assert.equal(completedBegin.operation.state, "ready_to_finalize");
  const resumed = await beginClassCancellation(adminCallableRequest({classId}));
  assert.equal(resumed.operation.state, "ready_to_finalize");
  const refundWrites = fakeStripe.state.updates.filter(
    ({path, payload}) => path === "/v1/refunds" &&
      payload.payment_intent === completed.paymentIntent.id
  );
  assert.equal(refundWrites.length, 1);
  assert.equal(refundWrites[0].payload.amount, String(PAYG_AMOUNT_PENCE));
  assert.equal(refundWrites[0].idempotencyKey, `payg-refund:${orderId}`);
  assert.equal(
    refundWrites[0].payload["metadata[classCancellationOperationId]"],
    completedBegin.operation.id
  );
  const order = await db.collection("paygOrders").doc(orderId).get();
  assert.equal(order.get("status"), "refunded");
  assert.equal(order.get("refundStatus"), "succeeded");
  assert.equal(order.get("refundedAmountPence"), PAYG_AMOUNT_PENCE);
  assert.equal(fakeStripe.state.refunds.size, refundCountBefore + 1);
  assert.equal(
    (await finalizeClassCancellation(adminCallableRequest({classId})))
      .operation.state,
    "cancelled"
  );
});

test("class refund final gate rejects a contract change after provider preflight starts", {timeout: 30_000}, async () => {
  const classId = "payg_whole_class_refund_final_gate";
  await Promise.all([
    seedClass(classId, 3),
    seedClassCancellationAdmin(),
  ]);
  const checkout = await createPaygCheckoutSession(callableRequest(checkoutRequest({
    attemptId: "paygWholeClassFinalGateRace01",
    classId,
    name: "Final Gate Race Guest",
    dateOfBirth: "1990-08-15",
    email: "final.gate@example.test",
  }), "127.0.0.98"));
  const completed = fakeStripe.completePaygCheckout(checkout.sessionId);
  await dispatchPaygStripeEvent({
    id: "evt_payg_whole_class_final_gate",
    object: "event",
    type: "checkout.session.completed",
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: {object: {...completed.session}},
  });
  const orderId = completed.session.metadata.paygIntentId;
  const refundWritesBefore = fakeStripe.state.updates.filter(
    ({path}) => path === "/v1/refunds"
  ).length;
  const barrier = fakeStripe.pauseNextPaymentIntentRetrieve(
    completed.paymentIntent.id
  );
  const beginning = beginClassCancellation(adminCallableRequest({classId}));
  await barrier.reached;
  await db.collection("paygOrders").doc(orderId).set({
    providerContractStatus: "mismatch",
    providerContractMismatches: ["concurrent_test_conflict"],
  }, {merge: true});
  barrier.release();

  const begun = await beginning;
  assert.notEqual(begun.operation.state, "ready_to_finalize");
  assert.equal(
    fakeStripe.state.updates.filter(({path}) => path === "/v1/refunds").length,
    refundWritesBefore
  );
  const conflicted = await db.collection("paygOrders").doc(orderId).get();
  assert.equal(conflicted.get("providerContractStatus"), "mismatch");
  assert.equal(conflicted.get("refundId"), undefined);

  const resumed = await beginClassCancellation(adminCallableRequest({classId}));
  assert.equal(resumed.operation.state, "awaiting_payg_refunds");
  const blocked = await db.collection("paygOrders").doc(orderId).get();
  assert.equal(blocked.get("status"), "refund_pending");
  assert.equal(blocked.get("classCancellationRefundStatus"), "manual_review");
  assert.equal(
    fakeStripe.state.updates.filter(({path}) => path === "/v1/refunds").length,
    refundWritesBefore
  );
});

test("class refund readback converges an exact provider success after the local receipt is lost", {timeout: 30_000}, async () => {
  const classId = "payg_whole_class_refund_readback";
  await Promise.all([
    seedClass(classId, 3),
    seedClassCancellationAdmin(),
  ]);
  const checkout = await createPaygCheckoutSession(callableRequest(checkoutRequest({
    attemptId: "paygWholeClassRefundReadback001",
    classId,
    name: "Refund Readback Guest",
    dateOfBirth: "1990-08-16",
    email: "refund.readback@example.test",
  }), "127.0.0.99"));
  const completed = fakeStripe.completePaygCheckout(checkout.sessionId);
  await dispatchPaygStripeEvent({
    id: "evt_payg_whole_class_refund_readback",
    object: "event",
    type: "checkout.session.completed",
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: {object: {...completed.session}},
  });
  const orderId = completed.session.metadata.paygIntentId;
  const barrier = fakeStripe.pauseNextPaymentIntentRetrieve(
    completed.paymentIntent.id
  );
  const first = beginClassCancellation(adminCallableRequest({classId}));
  await barrier.reached;
  fakeStripe.state.paymentIntents.delete(completed.paymentIntent.id);
  barrier.release();
  const firstResult = await first;
  assert.equal(firstResult.operation.state, "awaiting_payg_refunds");
  fakeStripe.state.paymentIntents.set(
    completed.paymentIntent.id,
    completed.paymentIntent
  );

  const operationId = (await db.collection("classes").doc(classId).get())
    .get("cancellationOperationId");
  assert.match(operationId, /^class_cancel_[a-f0-9]{64}$/);
  const refundId = "re_fake_class_cancellation_readback";
  const providerRefund = {
    id: refundId,
    object: "refund",
    livemode: false,
    amount: PAYG_AMOUNT_PENCE,
    currency: "gbp",
    payment_intent: completed.paymentIntent.id,
    charge: completed.charge.id,
    status: "succeeded",
    failure_reason: null,
    metadata: {
      purchaseKind: "payg_class",
      offeringKey: "adult_payg_class",
      paygOrderId: orderId,
      refundReason: "class_cancellation",
      classCancellationOperationId: operationId,
      schemaVersion: "1",
    },
  };
  completed.charge.amount_refunded = PAYG_AMOUNT_PENCE;
  completed.charge.refunded = true;
  completed.charge.refunds.data = [providerRefund];
  fakeStripe.state.charges.set(completed.charge.id, completed.charge);
  fakeStripe.state.refunds.set(refundId, providerRefund);
  fakeStripe.state.refundByIdempotencyKey.set(
    `payg-refund:${orderId}`,
    refundId
  );
  await db.collection("paygOrders").doc(orderId).set({
    classCancellationRefundProviderRequestPreparedAt:
      admin.firestore.Timestamp.now(),
    classCancellationRefundProviderIdempotencyKey: `payg-refund:${orderId}`,
    classCancellationRefundProviderAmountPence: PAYG_AMOUNT_PENCE,
    classCancellationRefundProviderCurrency: "gbp",
    classCancellationRefundProviderOperationId: operationId,
  }, {merge: true});
  const refundWritesBefore = fakeStripe.state.updates.filter(
    ({path}) => path === "/v1/refunds"
  ).length;

  const resumed = await beginClassCancellation(adminCallableRequest({classId}));
  assert.equal(resumed.operation.state, "ready_to_finalize");
  assert.equal(
    fakeStripe.state.updates.filter(({path}) => path === "/v1/refunds").length,
    refundWritesBefore,
    "exact Charge refund readback must not create another refund"
  );
  const order = await db.collection("paygOrders").doc(orderId).get();
  assert.equal(order.get("status"), "refunded");
  assert.equal(order.get("refundId"), refundId);
  assert.equal(order.get("refundedAmountPence"), PAYG_AMOUNT_PENCE);
});

test("a prepared class refund with an unrelated provider partial routes to manual review", {timeout: 30_000}, async () => {
  const classId = "payg_whole_class_prepared_external_partial";
  await Promise.all([
    seedClass(classId, 3),
    seedClassCancellationAdmin(),
  ]);
  const checkout = await createPaygCheckoutSession(callableRequest(checkoutRequest({
    attemptId: "paygWholeClassPreparedPartial01",
    classId,
    name: "Prepared Partial Guest",
    dateOfBirth: "1990-08-17",
    email: "prepared.partial@example.test",
  }), "127.0.0.100"));
  const completed = fakeStripe.completePaygCheckout(checkout.sessionId);
  await dispatchPaygStripeEvent({
    id: "evt_payg_whole_class_prepared_partial",
    object: "event",
    type: "checkout.session.completed",
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: {object: {...completed.session}},
  });
  const orderId = completed.session.metadata.paygIntentId;
  const barrier = fakeStripe.pauseNextPaymentIntentRetrieve(
    completed.paymentIntent.id
  );
  const first = beginClassCancellation(adminCallableRequest({classId}));
  await barrier.reached;
  fakeStripe.state.paymentIntents.delete(completed.paymentIntent.id);
  barrier.release();
  const firstResult = await first;
  assert.equal(firstResult.operation.state, "awaiting_payg_refunds");
  fakeStripe.state.paymentIntents.set(
    completed.paymentIntent.id,
    completed.paymentIntent
  );
  const operationId = (await db.collection("classes").doc(classId).get())
    .get("cancellationOperationId");
  const externalRefund = {
    id: "re_fake_unrelated_partial",
    object: "refund",
    livemode: false,
    amount: 100,
    currency: "gbp",
    payment_intent: completed.paymentIntent.id,
    charge: completed.charge.id,
    status: "succeeded",
    failure_reason: null,
    metadata: {source: "external_operator"},
  };
  completed.charge.amount_refunded = 100;
  completed.charge.refunds.data = [externalRefund];
  fakeStripe.state.charges.set(completed.charge.id, completed.charge);
  fakeStripe.state.refunds.set(externalRefund.id, externalRefund);
  await db.collection("paygOrders").doc(orderId).set({
    classCancellationRefundProviderRequestPreparedAt:
      admin.firestore.Timestamp.now(),
    classCancellationRefundProviderIdempotencyKey: `payg-refund:${orderId}`,
    classCancellationRefundProviderAmountPence: PAYG_AMOUNT_PENCE,
    classCancellationRefundProviderCurrency: "gbp",
    classCancellationRefundProviderOperationId: operationId,
  }, {merge: true});
  const refundWritesBefore = fakeStripe.state.updates.filter(
    ({path}) => path === "/v1/refunds"
  ).length;

  const resumed = await beginClassCancellation(adminCallableRequest({classId}));
  assert.equal(resumed.operation.state, "awaiting_payg_refunds");
  const order = await db.collection("paygOrders").doc(orderId).get();
  assert.equal(order.get("status"), "manual_review");
  assert.equal(order.get("refundStatus"), "provider_prior_refund");
  assert.equal(
    fakeStripe.state.updates.filter(({path}) => path === "/v1/refunds").length,
    refundWritesBefore,
    "ambiguous provider refund history must block before refunds.create"
  );

  const exactLookingRefund = {
    id: "re_fake_exact_but_truncated",
    object: "refund",
    livemode: false,
    amount: PAYG_AMOUNT_PENCE,
    currency: "gbp",
    payment_intent: completed.paymentIntent.id,
    charge: completed.charge.id,
    status: "succeeded",
    failure_reason: null,
    metadata: {
      purchaseKind: "payg_class",
      offeringKey: "adult_payg_class",
      paygOrderId: orderId,
      refundReason: "class_cancellation",
      classCancellationOperationId: operationId,
      schemaVersion: "1",
    },
  };
  completed.charge.amount_refunded = PAYG_AMOUNT_PENCE;
  completed.charge.refunded = true;
  completed.charge.refunds = {
    ...completed.charge.refunds,
    data: [exactLookingRefund],
    has_more: true,
  };
  fakeStripe.state.charges.set(completed.charge.id, completed.charge);
  fakeStripe.state.refunds.set(exactLookingRefund.id, exactLookingRefund);
  await db.collection("paygOrders").doc(orderId).set({
    status: "refund_pending",
    classCancellationRefundStatus: "refund_pending",
    refundStatus: admin.firestore.FieldValue.delete(),
    refundAutomationStatus: admin.firestore.FieldValue.delete(),
    refundRecoveryAt: admin.firestore.Timestamp.now(),
  }, {merge: true});

  const truncated = await beginClassCancellation(
    adminCallableRequest({classId})
  );
  assert.equal(truncated.operation.state, "awaiting_payg_refunds");
  const truncatedOrder = await db.collection("paygOrders").doc(orderId).get();
  assert.equal(truncatedOrder.get("status"), "manual_review");
  assert.match(
    truncatedOrder.get("refundStatus"),
    /provider_refund_history_truncated/
  );
  assert.equal(truncatedOrder.get("refundId"), undefined);
  assert.equal(
    fakeStripe.state.updates.filter(({path}) => path === "/v1/refunds").length,
    refundWritesBefore,
    "an exact-looking row in a truncated history is not safe evidence"
  );
});

test("a canonical late-cancelled paid booking receives the later whole-class £7 refund", {timeout: 30_000}, async () => {
  const classId = "payg_whole_class_existing_late_cancel";
  await Promise.all([
    seedClass(classId, 2, 2 * 60 * 60 * 1000),
    seedClassCancellationAdmin(),
  ]);
  const checkout = await createPaygCheckoutSession(callableRequest(checkoutRequest({
    attemptId: "paygWholeClassLateCancelled001",
    classId,
    name: "Late Cancelled Guest",
    dateOfBirth: "1990-08-10",
    email: "late.cancelled@example.test",
  }), "127.0.0.93"));
  const completed = fakeStripe.completePaygCheckout(checkout.sessionId);
  assert.equal(await dispatchPaygStripeEvent({
    id: "evt_payg_whole_class_late_cancelled",
    object: "event",
    type: "checkout.session.completed",
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: {object: {...completed.session}},
  }), true);
  const orderId = completed.session.metadata.paygIntentId;
  const confirmation = await db.collection("paygEmailOutbox").doc(orderId).get();
  const cancellationToken = new URL(
    confirmation.get("templateData.cancellationUrl")
  ).searchParams.get("token");
  assert.ok(cancellationToken);
  const cancelled = await requestPaygCancellation(callableRequest({
    token: cancellationToken,
    confirm: true,
  }, "127.0.0.93"));
  assert.equal(cancelled.outcome, "cancelled_non_refundable");
  assert.equal(
    (await db.collection("paygOrders").doc(orderId).get()).get("status"),
    "cancelled"
  );

  const begun = await beginClassCancellation(adminCallableRequest({classId}));
  assert.equal(begun.operation.state, "ready_to_finalize");
  const refunded = await db.collection("paygOrders").doc(orderId).get();
  assert.equal(refunded.get("status"), "refunded");
  assert.equal(refunded.get("refundReason"), "class_cancellation");
  assert.equal(refunded.get("refundedAmountPence"), PAYG_AMOUNT_PENCE);
  assert.deepEqual(await classCounts(classId), {booked: 0, unpaid: 0});
});

test("malformed or disputed paid orders stay fail-closed without a class refund", {timeout: 30_000}, async () => {
  const malformedClassId = "payg_whole_class_malformed_paid";
  await Promise.all([
    seedClass(malformedClassId, 2),
    seedClassCancellationAdmin(),
  ]);
  const malformedCheckout = await createPaygCheckoutSession(
    callableRequest(checkoutRequest({
      attemptId: "paygWholeClassMalformedPaid001",
      classId: malformedClassId,
      name: "Malformed Paid Guest",
      dateOfBirth: "1990-08-11",
      email: "malformed.paid@example.test",
    }), "127.0.0.94")
  );
  const malformedCompleted = fakeStripe.completePaygCheckout(
    malformedCheckout.sessionId
  );
  await dispatchPaygStripeEvent({
    id: "evt_payg_whole_class_malformed_paid",
    object: "event",
    type: "checkout.session.completed",
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: {object: {...malformedCompleted.session}},
  });
  const malformedOrderId = malformedCompleted.session.metadata.paygIntentId;
  await db.collection("paygOrders").doc(malformedOrderId).set({
    amountPence: 800,
  }, {merge: true});
  const refundCountBeforeMalformed = fakeStripe.state.refunds.size;
  await assert.rejects(
    beginClassCancellation(adminCallableRequest({classId: malformedClassId})),
    /not exactly bound/
  );
  assert.equal(fakeStripe.state.refunds.size, refundCountBeforeMalformed);

  const disputedClassId = "payg_whole_class_disputed_paid";
  await seedClass(disputedClassId, 2);
  const disputedCheckout = await createPaygCheckoutSession(
    callableRequest(checkoutRequest({
      attemptId: "paygWholeClassDisputedPaid001",
      classId: disputedClassId,
      name: "Disputed Paid Guest",
      dateOfBirth: "1990-08-12",
      email: "disputed.paid@example.test",
    }), "127.0.0.95")
  );
  const disputedCompleted = fakeStripe.completePaygCheckout(
    disputedCheckout.sessionId
  );
  await dispatchPaygStripeEvent({
    id: "evt_payg_whole_class_disputed_paid",
    object: "event",
    type: "checkout.session.completed",
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: {object: {...disputedCompleted.session}},
  });
  disputedCompleted.charge.disputed = true;
  fakeStripe.state.charges.set(
    disputedCompleted.charge.id,
    disputedCompleted.charge
  );
  const refundCountBeforeDispute = fakeStripe.state.refunds.size;
  const disputedBegin = await beginClassCancellation(
    adminCallableRequest({classId: disputedClassId})
  );
  assert.equal(disputedBegin.operation.state, "awaiting_payg_refunds");
  const disputedOrder = await db.collection("paygOrders")
    .doc(disputedCompleted.session.metadata.paygIntentId).get();
  assert.equal(disputedOrder.get("status"), "manual_review");
  assert.equal(
    disputedOrder.get("refundAutomationStatus"),
    "suspended_dispute"
  );
  assert.equal(fakeStripe.state.refunds.size, refundCountBeforeDispute);

  const partialClassId = "payg_whole_class_prior_partial_refund";
  await seedClass(partialClassId, 2);
  const partialCheckout = await createPaygCheckoutSession(
    callableRequest(checkoutRequest({
      attemptId: "paygWholeClassPriorPartial001",
      classId: partialClassId,
      name: "Prior Partial Refund Guest",
      dateOfBirth: "1990-08-14",
      email: "prior.partial@example.test",
    }), "127.0.0.97")
  );
  const partialCompleted = fakeStripe.completePaygCheckout(
    partialCheckout.sessionId
  );
  await dispatchPaygStripeEvent({
    id: "evt_payg_whole_class_prior_partial",
    object: "event",
    type: "checkout.session.completed",
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: {object: {...partialCompleted.session}},
  });
  partialCompleted.charge.amount_refunded = 100;
  fakeStripe.state.charges.set(
    partialCompleted.charge.id,
    partialCompleted.charge
  );
  const refundWritesBeforePartial = fakeStripe.state.updates.filter(
    ({path}) => path === "/v1/refunds"
  ).length;
  const partialBegin = await beginClassCancellation(
    adminCallableRequest({classId: partialClassId})
  );
  assert.equal(partialBegin.operation.state, "awaiting_payg_refunds");
  const partialOrder = await db.collection("paygOrders")
    .doc(partialCompleted.session.metadata.paygIntentId).get();
  assert.equal(partialOrder.get("status"), "manual_review");
  assert.equal(partialOrder.get("refundStatus"), "provider_prior_refund");
  assert.equal(
    fakeStripe.state.updates.filter(({path}) => path === "/v1/refunds").length,
    refundWritesBeforePartial,
    "an unrelated partial refund must prevent any new provider request"
  );
});

test("class cancellation keeps missing Session identity and async processing fail closed", {timeout: 30_000}, async () => {
  await seedClassCancellationAdmin();
  const missingClassId = "payg_whole_class_missing_session";
  await seedClass(missingClassId, 2);
  const missingCheckout = await createPaygCheckoutSession(callableRequest(checkoutRequest({
    attemptId: "paygWholeClassMissingSession01",
    classId: missingClassId,
    name: "Missing Session Guest",
    dateOfBirth: "1992-05-06",
    email: "missing.session@example.test",
  }), "127.0.0.83"));
  const missingIntentId = fakeStripe.state.checkoutSessions
    .get(missingCheckout.sessionId).metadata.paygIntentId;
  await db.collection("paygIntents").doc(missingIntentId).set({
    checkoutSessionId: null,
    checkoutSessionUrl: null,
  }, {merge: true});
  const missing = await beginClassCancellation(
    adminCallableRequest({classId: missingClassId})
  );
  assert.equal(missing.operation.state, "processing");
  assert.deepEqual(await classCounts(missingClassId), {booked: 1, unpaid: 1});
  const missingIntent = await db.collection("paygIntents")
    .doc(missingIntentId).get();
  assert.equal(missingIntent.get("capacityState"), "held");
  assert.equal(missingIntent.get("unpaidHoldState"), "counted");
  assert.equal(
    missingIntent.get("classCancellationProviderDisposition"),
    "session_reference_missing"
  );
  assert.equal(
    missingIntent.get("classCancellationProviderTerminalNonpayment"),
    false
  );
  await assert.rejects(
    finalizeClassCancellation(adminCallableRequest({classId: missingClassId})),
    (error) => error.code === "failed-precondition" &&
      error.details.blockers.activePaygIntentIds.includes(missingIntentId) &&
      error.details.blockers.unreleasedPaygIntentIds.includes(missingIntentId)
  );

  const processingClassId = "payg_whole_class_processing";
  await seedClass(processingClassId, 2);
  const processingCheckout = await createPaygCheckoutSession(callableRequest(checkoutRequest({
    attemptId: "paygWholeClassProcessing001",
    classId: processingClassId,
    name: "Processing Guest",
    dateOfBirth: "1993-06-07",
    email: "processing.guest@example.test",
  }), "127.0.0.84"));
  const processing = fakeStripe.completePaygCheckout(
    processingCheckout.sessionId,
    {
      session: {status: "expired", payment_status: "unpaid"},
      paymentIntent: {status: "processing", amount_received: 0},
      charge: {paid: false, status: "pending", amount: 0},
    }
  );
  const processingIntentId = processing.session.metadata.paygIntentId;
  const processingBegin = await beginClassCancellation(
    adminCallableRequest({classId: processingClassId})
  );
  assert.equal(processingBegin.operation.state, "processing");
  const observedProcessing = await db.collection("paygIntents")
    .doc(processingIntentId).get();
  assert.equal(
    observedProcessing.get("classCancellationProviderTerminalNonpayment"),
    false
  );
  assert.equal(
    observedProcessing.get("classCancellationProviderPaymentIntentStatus"),
    "processing"
  );
  await assert.rejects(
    finalizeClassCancellation(adminCallableRequest({classId: processingClassId})),
    (error) => error.code === "failed-precondition" &&
      error.details.blockers.activePaygIntentIds.includes(processingIntentId)
  );
});

test("class cancellation blocks ambiguous confirmation acceptance until corrective communication is delivered", {timeout: 30_000}, async () => {
  const classId = "payg_whole_class_confirmation_race";
  const orderId = `payg_${"e".repeat(64)}`;
  await Promise.all([
    seedClass(classId, 2),
    seedClassCancellationAdmin(),
  ]);
  await Promise.all([
    db.collection("paygOrders").doc(orderId).set({
      schemaVersion: 1,
      orderId,
      offeringKey: "adult_payg_class",
      purchaseKind: "payg_class",
      status: "refunded",
      capacityState: "released",
      class: {classId},
      amountPence: PAYG_AMOUNT_PENCE,
      currency: "gbp",
      checkoutSessionId: "cs_confirmation_race_1234",
      paymentIntentId: "pi_confirmation_race_1234",
      chargeId: "ch_confirmation_race_1234",
      refundId: "re_confirmation_race_1234",
      refundStatus: "succeeded",
      refundedAmountPence: PAYG_AMOUNT_PENCE,
      confirmationEmailStatus: "pending",
    }),
    db.collection("paygEmailOutbox").doc(orderId).set({
      kind: "payg_guest_confirmation",
      orderId,
      status: "sending",
      leaseToken: "confirmation-race-lease-0001",
      leaseExpiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 60_000),
    }),
  ]);
  const begun = await beginClassCancellation(adminCallableRequest({classId}));
  assert.equal(begun.operation.state, "processing");
  assert.equal(begun.paygGuests[0].confirmationSuppressed, false);
  assert.equal(begun.paygGuests[0].confirmationResolved, false);
  assert.equal(begun.paygGuests[0].confirmationDisposition, "ambiguous");
  await assert.rejects(
    finalizeClassCancellation(adminCallableRequest({classId})),
    (error) => error.code === "failed-precondition" &&
      error.details.blockers.unresolvedConfirmationOrderIds.includes(orderId)
  );

  const refundOutboxId = paygRefundOutboxId(orderId);
  await Promise.all([
    db.collection("paygEmailOutbox").doc(orderId).set({
      status: "tombstoned",
      providerAcceptanceState: "accepted_after_state_change",
      providerMessageId: "email_confirmation_race",
      tombstonedLeaseCorrelation: admin.firestore.FieldValue.delete(),
      reconcileAfterStateChange: admin.firestore.FieldValue.delete(),
    }, {merge: true}),
    db.collection("paygEmailOutbox").doc(refundOutboxId).set({
      kind: "payg_guest_refund_confirmation",
      orderId,
      status: "sent",
      providerAcceptanceState: "accepted",
      providerMessageId: "email_refund_race",
    }),
  ]);
  const resumed = await beginClassCancellation(adminCallableRequest({classId}));
  assert.equal(resumed.operation.state, "ready_to_finalize");
  assert.equal(resumed.paygGuests[0].confirmationSuppressed, false);
  assert.equal(resumed.paygGuests[0].confirmationResolved, true);
  assert.equal(
    resumed.paygGuests[0].confirmationDisposition,
    "accepted_after_change_corrected"
  );
  assert.equal(
    (await finalizeClassCancellation(adminCallableRequest({classId})))
      .operation.state,
    "cancelled"
  );
});

test("class cancellation accepts only durable definitive no-Session rejection evidence", {timeout: 30_000}, async () => {
  const classId = "payg_whole_class_definitive_no_session";
  const intentId = `payg_${"f".repeat(64)}`;
  await Promise.all([
    seedClass(classId, 2),
    seedClassCancellationAdmin(),
  ]);
  await db.collection("paygIntents").doc(intentId).set({
    status: "failed",
    capacityState: "released",
    unpaidHoldState: "released",
    releaseReason: "checkout_create_failed",
    releasedAt: admin.firestore.Timestamp.now(),
    checkoutSessionId: null,
    paymentIntentId: null,
    duplicateLockId: "a".repeat(64),
    class: {classId},
  });
  const begun = await beginClassCancellation(adminCallableRequest({classId}));
  assert.equal(begun.operation.state, "ready_to_finalize");
  const observed = await db.collection("paygIntents").doc(intentId).get();
  assert.equal(
    observed.get("classCancellationProviderDisposition"),
    "provider_create_definitively_failed"
  );
  assert.equal(
    observed.get("classCancellationProviderTerminalNonpayment"),
    true
  );
  assert.equal(
    (await finalizeClassCancellation(adminCallableRequest({classId})))
      .operation.state,
    "cancelled"
  );
});
