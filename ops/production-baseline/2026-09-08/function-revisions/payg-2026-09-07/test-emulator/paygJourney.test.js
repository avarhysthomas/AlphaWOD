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
} = require("../lib/payg");

const db = admin.firestore();
const createPaygCheckoutSession = functionsTest.wrap(
  functions.createPaygCheckoutSession
);
const requestPaygCancellation = functionsTest.wrap(
  functions.requestPaygCancellation
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

async function seedClass(classId, capacity) {
  const startMillis = Date.now() + 7 * 24 * 60 * 60 * 1000;
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
  assert.equal(order.get("cancellation.policyOutcome"), "at_least_24_hours_refundable");
  assert.equal(fakeStripe.state.refunds.size, 1);
  assert.equal((await bookingRef.get()).get("status"), "cancelled");
  assert.deepEqual(await classCounts(classId), {booked: 0, unpaid: 0});

  const closedOutbox = await db.collection("paygEmailOutbox").doc(orderId).get();
  assert.equal(closedOutbox.get("status"), "tombstoned");
  assert.equal(closedOutbox.get("providerAcceptanceState"), "accepted_before_state_change");

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
