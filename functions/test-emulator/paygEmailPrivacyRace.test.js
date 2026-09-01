/* eslint-disable @typescript-eslint/no-var-requires, max-len, require-jsdoc */

const test = require("node:test");
const assert = require("node:assert/strict");
const admin = require("firebase-admin");

const projectId = process.env.GCLOUD_PROJECT || "alpha-wod-functions-test";
process.env.FUNCTIONS_EMULATOR = "true";
process.env.PAYG_FROM_EMAIL = "Zero Alpha Fitness <hello@zeroalphafitness.co.uk>";
process.env.PAYG_REPLY_TO_EMAIL = "support@zeroalphafitness.co.uk";
if (admin.apps.length === 0) admin.initializeApp({projectId});
const db = admin.firestore();
const {Timestamp} = admin.firestore;
const {
  __testing: paygTesting,
  paygConfirmationCorrectionOutboxId,
  runPaygPiiRedactionSweep,
} = require("../lib/payg");

const CLASS = Object.freeze({
  classId: "class_email_privacy_race",
  title: "Adult Conditioning",
  startTime: "2026-09-10T17:00:00.000Z",
  endTime: "2026-09-10T18:00:00.000Z",
  timezone: "Europe/London",
  location: "Zero Alpha Fitness",
});

async function clearFirestore() {
  const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
  assert.ok(firestoreHost, "FIRESTORE_EMULATOR_HOST is required");
  await fetch(
    `http://${firestoreHost}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    {method: "DELETE"}
  );
}

function confirmationPayload(orderId) {
  return paygTesting.buildPaygConfirmationOutboxPayload({
    orderId,
    recipientEmail: "privacy-race@example.test",
    attendeeName: "Privacy Race",
    class: CLASS,
    amountPence: 700,
    currency: "gbp",
    publicOrigin: "https://alpha-wod.vercel.app",
    cancellationToken: "private-cancellation-token",
    cancellationCutoffAtMillis: Date.parse("2026-09-09T17:00:00.000Z"),
  });
}

function orderRecord(orderId, piiRetentionCutoffAt) {
  return {
    schemaVersion: 1,
    purchaseKind: "payg_class",
    orderId,
    status: "confirmed",
    capacityState: "held",
    amountPence: 700,
    currency: "gbp",
    attendee: {fullName: "Privacy Race", dateOfBirth: "1990-01-01"},
    contact: {email: "privacy-race@example.test"},
    acceptances: {waiverAccepted: true},
    privacy: {policyVersion: "payg-retention-v1"},
    class: CLASS,
    bookingId: null,
    duplicateLockId: null,
    confirmationEmailStatus: "pending",
    piiRetentionCutoffAt: Timestamp.fromMillis(piiRetentionCutoffAt),
    piiRedactionRetryAt: Timestamp.fromMillis(piiRetentionCutoffAt),
  };
}

function outboxRecord(orderId, piiRetentionCutoffAt, overrides = {}) {
  return {
    ...confirmationPayload(orderId),
    status: "pending",
    attemptCount: 0,
    nextAttemptAt: Timestamp.fromMillis(piiRetentionCutoffAt - 1),
    piiRetentionCutoffAt: Timestamp.fromMillis(piiRetentionCutoffAt),
    piiRedactionRetryAt: Timestamp.fromMillis(piiRetentionCutoffAt),
    lastError: "delivery to privacy-race@example.test failed",
    ...overrides,
  };
}

function assertOutboxPiiRedacted(outbox) {
  assert.equal(outbox.get("to"), undefined);
  assert.equal(outbox.get("templateData"), undefined);
  assert.equal(outbox.get("lastError"), undefined);
  assert.equal(outbox.get("piiRedactionRetryAt"), undefined);
  assert.ok(outbox.get("piiRedactedAt"));
  assert.equal(outbox.get("leaseToken"), undefined);
  assert.equal(outbox.get("leaseExpiresAt"), undefined);
  assert.equal(outbox.get("nextAttemptAt"), undefined);
}

test.beforeEach(clearFirestore);

test("email worker never leases or sends PII at the exact redaction deadline", async () => {
  const nowMillis = Date.now() + 1_000;
  const orderId = `payg_${"2".repeat(64)}`;
  const orderRef = db.collection("paygOrders").doc(orderId);
  const outboxRef = db.collection("paygEmailOutbox").doc(orderId);
  await Promise.all([
    orderRef.set(orderRecord(orderId, nowMillis)),
    outboxRef.set(outboxRecord(orderId, nowMillis)),
  ]);
  let sendCount = 0;

  const outcome = await paygTesting.processPaygConfirmationOutbox(
    orderId,
    nowMillis,
    async () => {
      sendCount += 1;
      return "email_must_not_send";
    }
  );

  const [order, outbox] = await Promise.all([
    orderRef.get(),
    outboxRef.get(),
  ]);
  assert.equal(outcome, "terminal");
  assert.equal(sendCount, 0);
  assert.equal(outbox.get("status"), "tombstoned");
  assert.equal(outbox.get("piiRedactionReason"), "retention_expired");
  assertOutboxPiiRedacted(outbox);
  assert.equal(order.get("confirmationEmailStatus"), "not_required");
});

test("email worker fails closed when a PII outbox has no retention deadline", async () => {
  const nowMillis = Date.now();
  const orderDeadline = nowMillis + 60 * 60 * 1000;
  const orderId = `payg_${"3".repeat(64)}`;
  const orderRef = db.collection("paygOrders").doc(orderId);
  const outboxRef = db.collection("paygEmailOutbox").doc(orderId);
  const outbox = outboxRecord(orderId, orderDeadline);
  delete outbox.piiRetentionCutoffAt;
  await Promise.all([
    orderRef.set(orderRecord(orderId, orderDeadline)),
    outboxRef.set(outbox),
  ]);
  let sendCount = 0;

  const outcome = await paygTesting.processPaygConfirmationOutbox(
    orderId,
    nowMillis,
    async () => {
      sendCount += 1;
      return "email_must_not_send";
    }
  );

  const outboxAfter = await outboxRef.get();
  assert.equal(outcome, "terminal");
  assert.equal(sendCount, 0);
  assert.equal(outboxAfter.get("status"), "tombstoned");
  assert.equal(
    outboxAfter.get("piiRedactionReason"),
    "retention_deadline_missing"
  );
  assertOutboxPiiRedacted(outboxAfter);
});

test("email failure reads crossing the cutoff tombstone instead of requeueing", {timeout: 15_000}, async () => {
  const nowMillis = Date.now();
  const cutoff = nowMillis + 1_500;
  const orderId = `payg_${"8".repeat(64)}`;
  const orderRef = db.collection("paygOrders").doc(orderId);
  const outboxRef = db.collection("paygEmailOutbox").doc(orderId);
  await Promise.all([
    orderRef.set(orderRecord(orderId, cutoff)),
    outboxRef.set(outboxRecord(orderId, cutoff, {
      nextAttemptAt: Timestamp.fromMillis(nowMillis - 1),
    })),
  ]);

  const barrier = paygTesting.pauseNextPaygEmailFailureAfterReads();
  const processing = paygTesting.processPaygConfirmationOutbox(
    orderId,
    nowMillis,
    async () => {
      throw new Error("Injected provider failure before retention cutoff");
    }
  );
  await barrier.reached;
  await new Promise((resolve) => setTimeout(
    resolve,
    Math.max(0, cutoff - Date.now() + 20)
  ));
  barrier.release();

  assert.equal(await processing, "terminal");
  const [order, outbox] = await Promise.all([
    orderRef.get(),
    outboxRef.get(),
  ]);
  assert.equal(outbox.get("status"), "tombstoned");
  assert.equal(outbox.get("piiRedactionReason"), "retention_expired");
  assertOutboxPiiRedacted(outbox);
  assert.equal(order.get("confirmationEmailStatus"), "not_required");
});

test("email preflight honors reintroduced outbox and order closure markers", async () => {
  const nowMillis = Date.now();
  const futureCutoff = nowMillis + 60 * 60 * 1000;
  const outboxClosedOrderId = `payg_${"6".repeat(64)}`;
  const orderClosedOrderId = `payg_${"7".repeat(64)}`;
  const outboxClosedRef = db.collection("paygEmailOutbox")
    .doc(outboxClosedOrderId);
  const orderClosedOutboxRef = db.collection("paygEmailOutbox")
    .doc(orderClosedOrderId);
  const orderClosedRef = db.collection("paygOrders").doc(orderClosedOrderId);
  await Promise.all([
    db.collection("paygOrders").doc(outboxClosedOrderId).set(
      orderRecord(outboxClosedOrderId, futureCutoff)
    ),
    outboxClosedRef.set(outboxRecord(outboxClosedOrderId, futureCutoff, {
      nextAttemptAt: Timestamp.fromMillis(nowMillis - 1),
      piiRedactedAt: "malformed-legacy-closure-marker",
    })),
    orderClosedRef.set(orderRecord(orderClosedOrderId, futureCutoff)),
    orderClosedOutboxRef.set(outboxRecord(orderClosedOrderId, futureCutoff, {
      nextAttemptAt: Timestamp.fromMillis(nowMillis - 1),
    })),
  ]);
  let sendCount = 0;
  const sender = async () => {
    sendCount += 1;
    return "email_must_not_send";
  };

  assert.equal(
    await paygTesting.processPaygConfirmationOutbox(
      outboxClosedOrderId,
      nowMillis,
      sender
    ),
    "terminal"
  );

  const barrier = paygTesting.pauseNextPaygEmailPreflight();
  const processing = paygTesting.processPaygConfirmationOutbox(
    orderClosedOrderId,
    nowMillis,
    sender
  );
  await barrier.reached;
  await orderClosedRef.set({
    piiRedactedAt: "malformed-legacy-closure-marker",
    attendee: {fullName: "Reintroduced Closed Name"},
  }, {merge: true});
  barrier.release();
  assert.equal(await processing, "terminal");
  assert.equal(sendCount, 0);

  for (const ref of [outboxClosedRef, orderClosedOutboxRef]) {
    const outbox = await ref.get();
    assert.equal(outbox.get("status"), "tombstoned");
    assertOutboxPiiRedacted(outbox);
  }
});

test("privacy closure during an active send cannot recreate correction PII", {timeout: 15_000}, async () => {
  const nowMillis = Date.now();
  const piiDeadline = nowMillis + 2_000;
  const redactionNow = piiDeadline + 1;
  const orderId = `payg_${"4".repeat(64)}`;
  const bookingId = "conflicting_email_privacy_booking";
  const correctionId = paygConfirmationCorrectionOutboxId(orderId);
  const orderRef = db.collection("paygOrders").doc(orderId);
  const outboxRef = db.collection("paygEmailOutbox").doc(orderId);
  const correctionRef = db.collection("paygEmailOutbox").doc(correctionId);
  await Promise.all([
    orderRef.set({...orderRecord(orderId, piiDeadline), bookingId}),
    outboxRef.set(outboxRecord(orderId, piiDeadline, {
      nextAttemptAt: Timestamp.fromMillis(nowMillis - 1),
    })),
    db.collection("bookings").doc(bookingId).set({
      bookingKind: "member",
      paygOrderId: orderId,
      userName: "Must Remain For Failed Redaction",
    }),
  ]);

  let releaseSender;
  let markSenderReached;
  const senderReached = new Promise((resolve) => {
    markSenderReached = resolve;
  });
  const senderReleased = new Promise((resolve) => {
    releaseSender = resolve;
  });
  const processing = paygTesting.processPaygConfirmationOutbox(
    orderId,
    nowMillis,
    async () => {
      markSenderReached();
      await senderReleased;
      return "email_provider_privacy_race";
    }
  );
  await senderReached;

  await orderRef.set({status: "cancelled"}, {merge: true});
  const redaction = await runPaygPiiRedactionSweep(redactionNow, 50);
  assert.equal(redaction.orders.redacted, 1);
  assert.equal(redaction.orders.failed, 0);
  assert.equal(redaction.outbox.deferred, 1);
  const deferred = await outboxRef.get();
  assert.equal(deferred.get("status"), "sending");
  assert.equal(deferred.get("piiRedactionDeferredReason"), "active_email_lease");
  const redactedOrder = await orderRef.get();
  assert.equal(
    redactedOrder.get("piiRetentionCutoffAt").toMillis(),
    piiDeadline
  );
  assert.equal(redactedOrder.get("piiRedactionRetryAt"), undefined);
  assert.equal(redactedOrder.get("attendee"), undefined);
  assert.equal(
    redactedOrder.get("piiRedactionBookingWarning"),
    "conflicting_booking_binding"
  );

  await new Promise((resolve) => setTimeout(
    resolve,
    Math.max(0, piiDeadline - Date.now() + 20)
  ));

  releaseSender();
  const outcome = await processing;
  const [order, outbox, correction] = await Promise.all([
    orderRef.get(),
    outboxRef.get(),
    correctionRef.get(),
  ]);

  assert.equal(outcome, "sent");
  assert.equal(correction.exists, false);
  assert.equal(outbox.get("status"), "tombstoned");
  assert.equal(outbox.get("providerMessageId"), "email_provider_privacy_race");
  assert.equal(outbox.get("providerAcceptanceState"), "accepted_after_state_change");
  assert.equal(outbox.get("piiRedactionReason"), "retention_expired");
  assertOutboxPiiRedacted(outbox);
  assert.equal(order.get("status"), "cancelled");
  assert.equal(order.get("attendee"), undefined);
  assert.equal(order.get("piiRetentionCutoffAt").toMillis(), piiDeadline);
  assert.equal(order.get("piiRedactionRetryAt"), undefined);
  assert.equal(order.get("confirmationEmailStatus"), "not_required");
  assert.equal(order.get("confirmationCorrectionEmailStatus"), "not_required");
  assert.equal(order.get("confirmationCorrectionOutboxId"), undefined);

  let replaySendCount = 0;
  const replay = await paygTesting.processPaygConfirmationOutbox(
    orderId,
    piiDeadline + 1,
    async () => {
      replaySendCount += 1;
      return "must_not_replay";
    }
  );
  assert.equal(replay, "terminal");
  assert.equal(replaySendCount, 0);
});

test("privacy closure cannot authorize a post-cutoff email requeue", {timeout: 15_000}, async () => {
  const nowMillis = Date.now();
  const piiDeadline = nowMillis + 2_000;
  const redactionNow = piiDeadline + 1;
  const orderId = `payg_${"5".repeat(64)}`;
  const bookingId = "conflicting_email_requeue_booking";
  const orderRef = db.collection("paygOrders").doc(orderId);
  const outboxRef = db.collection("paygEmailOutbox").doc(orderId);
  await Promise.all([
    orderRef.set({...orderRecord(orderId, piiDeadline), bookingId}),
    outboxRef.set(outboxRecord(orderId, piiDeadline, {
      nextAttemptAt: Timestamp.fromMillis(nowMillis - 1),
    })),
    db.collection("bookings").doc(bookingId).set({
      bookingKind: "member",
      paygOrderId: orderId,
      userName: "Must Remain For Failed Redaction",
    }),
  ]);

  let releaseSender;
  let markSenderReached;
  const senderReached = new Promise((resolve) => {
    markSenderReached = resolve;
  });
  const senderReleased = new Promise((resolve) => {
    releaseSender = resolve;
  });
  const processing = paygTesting.processPaygConfirmationOutbox(
    orderId,
    nowMillis,
    async () => {
      markSenderReached();
      await senderReleased;
      throw new Error("Injected provider uncertainty after cutoff");
    }
  );
  await senderReached;

  await orderRef.set({status: "cancelled"}, {merge: true});
  const redaction = await runPaygPiiRedactionSweep(redactionNow, 50);
  assert.equal(redaction.orders.redacted, 1);
  assert.equal(redaction.orders.failed, 0);
  assert.equal(redaction.outbox.deferred, 1);
  await new Promise((resolve) => setTimeout(
    resolve,
    Math.max(0, piiDeadline - Date.now() + 20)
  ));

  releaseSender();
  const outcome = await processing;
  const [order, outbox] = await Promise.all([
    orderRef.get(),
    outboxRef.get(),
  ]);
  assert.equal(outcome, "terminal");
  assert.equal(outbox.get("status"), "tombstoned");
  assert.equal(outbox.get("nextAttemptAt"), undefined);
  assert.equal(outbox.get("leaseToken"), undefined);
  assert.equal(outbox.get("piiRedactionRetryAt"), undefined);
  assert.equal(outbox.get("piiRetentionCutoffAt").toMillis(), piiDeadline);
  assert.equal(order.get("piiRetentionCutoffAt").toMillis(), piiDeadline);
  assert.equal(order.get("piiRedactionRetryAt"), undefined);
  assert.equal(order.get("attendee"), undefined);

  let replaySendCount = 0;
  const replay = await paygTesting.processPaygConfirmationOutbox(
    orderId,
    piiDeadline + 1,
    async () => {
      replaySendCount += 1;
      return "must_not_requeue";
    }
  );
  assert.equal(replay, "terminal");
  assert.equal(replaySendCount, 0);
});
