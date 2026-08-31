/* eslint-disable @typescript-eslint/no-var-requires, max-len, require-jsdoc */

const test = require("node:test");
const assert = require("node:assert/strict");
const admin = require("firebase-admin");

const projectId = process.env.GCLOUD_PROJECT || "alpha-wod-functions-test";
process.env.FUNCTIONS_EMULATOR = "true";
if (admin.apps.length === 0) admin.initializeApp({projectId});
const db = admin.firestore();
const {Timestamp} = admin.firestore;
const {
  __testing: paygTesting,
  runPaygPiiRedactionSweep,
} = require("../lib/payg");

const PRIVACY = Object.freeze({
  policyVersion: "payg-retention-v1",
  orderPiiRetentionDays: 90,
  waiverPiiRetentionDays: 2190,
});
const ATTENDEE = Object.freeze({
  fullName: "Ava Test",
  dateOfBirth: "1990-01-01",
  ageAtClass: 36,
});
const ACCEPTANCES = Object.freeze({
  adultConfirmed: true,
  waiverAccepted: true,
  termsAccepted: true,
  cancellationPolicyAccepted: true,
  waiverVersion: "waiver-v1",
  termsVersion: "terms-v1",
  legal: {
    waiver: {version: "waiver-v1", publicUrl: "/legal/waiver", sha256: "a".repeat(64)},
    terms: {version: "terms-v1", publicUrl: "/legal/terms", sha256: "b".repeat(64)},
  },
  acceptedAt: Timestamp.fromMillis(1_700_000_000_000),
});
const CLASS = Object.freeze({
  classId: "class-payg-privacy",
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

function piiRecord(deadline) {
  return {
    attendee: ATTENDEE,
    contact: {email: "ava@example.test", phone: "+447700900000"},
    acceptances: ACCEPTANCES,
    privacy: PRIVACY,
    class: CLASS,
    acceptanceEvidenceDigest: "c".repeat(64),
    retainedAcceptanceEvidence: {
      adultConfirmed: true,
      waiverAccepted: true,
      termsAccepted: true,
      cancellationPolicyAccepted: true,
      waiver: {version: "waiver-v1", sha256: "a".repeat(64)},
      terms: {version: "terms-v1", sha256: "b".repeat(64)},
      acceptedAt: ACCEPTANCES.acceptedAt,
      retentionPolicyVersion: PRIVACY.policyVersion,
    },
    piiRetentionCutoffAt: Timestamp.fromMillis(deadline),
    piiRedactionRetryAt: Timestamp.fromMillis(deadline),
  };
}

test.beforeEach(clearFirestore);

test("PAYG redaction removes only approved PII and waits for an active email lease", async () => {
  const nowMillis = Date.parse("2026-12-10T12:00:00.000Z");
  const dueAt = nowMillis - 1;
  const leaseStartedAt = nowMillis - 1_000;
  const leaseExpiresAt = leaseStartedAt + 10 * 60 * 1000;
  const intentId = `payg_${"1".repeat(64)}`;
  const bookingId = `payg_guest_${"2".repeat(64)}`;

  await Promise.all([
    db.collection("paygIntents").doc(intentId).set({
      status: "expired",
      capacityState: "released",
      unpaidHoldState: "released",
      attendee: ATTENDEE,
      contact: {email: "ava@example.test", phone: "+447700900000"},
      acceptances: ACCEPTANCES,
      requestFingerprint: "d".repeat(64),
      checkoutSessionUrl: "https://checkout.stripe.test/session",
      checkoutSessionId: "cs_test_privacy",
      paymentIntentId: null,
      stripePriceId: "price_test_payg",
      stripeProductId: "prod_test_payg",
      privacy: PRIVACY,
      class: CLASS,
      acceptanceEvidenceDigest: "c".repeat(64),
      piiRetentionCutoffAt: Timestamp.fromMillis(dueAt),
      piiRedactionRetryAt: Timestamp.fromMillis(dueAt),
      piiDeleteAt: Timestamp.fromMillis(dueAt),
    }),
    db.collection("paygOrders").doc(intentId).set({
      ...piiRecord(dueAt),
      orderId: intentId,
      purchaseKind: "payg_class",
      status: "attended",
      bookingId,
      checkoutSessionId: "cs_test_privacy",
      paymentIntentId: "pi_test_privacy",
      chargeId: "ch_test_privacy",
      refundStatus: "succeeded",
      disputeStatus: "won",
      amountPence: 750,
      currency: "gbp",
    }),
    db.collection("bookings").doc(bookingId).set({
      bookingKind: "payg_guest",
      paygOrderId: intentId,
      userId: `payg_guest_${"3".repeat(40)}`,
      userName: "Ava Test",
      classId: CLASS.classId,
      status: "booked",
      attendanceStatus: "checked_in",
    }),
    db.collection("paygEmailOutbox").doc(intentId).set({
      orderId: intentId,
      kind: "payg_guest_confirmation",
      status: "sending",
      to: ["ava@example.test"],
      templateData: {
        attendeeName: "Ava Test",
        cancellationUrl: "https://example.test/pay-as-you-go/cancel?token=secret",
      },
      lastError: "delivery to ava@example.test failed",
      providerMessageId: "email_test_privacy",
      leaseToken: "lease-token-privacy-1234",
      lastAttemptAt: Timestamp.fromMillis(leaseStartedAt),
      leaseExpiresAt: Timestamp.fromMillis(leaseExpiresAt),
      piiRetentionCutoffAt: Timestamp.fromMillis(dueAt),
      piiRedactionRetryAt: Timestamp.fromMillis(dueAt),
    }),
    db.collection("paygWaiverAcceptances").doc(intentId).set({
      ...piiRecord(dueAt),
      orderId: intentId,
      checkoutSessionId: "cs_test_privacy",
      paymentIntentId: "pi_test_privacy",
    }),
  ]);

  const first = await runPaygPiiRedactionSweep(nowMillis, 50);
  assert.deepEqual(first, {
    intents: {redacted: 1, deferred: 0, skipped: 0, failed: 0},
    orders: {redacted: 1, deferred: 0, skipped: 0, failed: 0},
    outbox: {redacted: 0, deferred: 1, skipped: 0, failed: 0},
    waivers: {redacted: 1, deferred: 0, skipped: 0, failed: 0},
  });

  const [intent, order, booking, leasedOutbox, waiver] = await Promise.all([
    db.collection("paygIntents").doc(intentId).get(),
    db.collection("paygOrders").doc(intentId).get(),
    db.collection("bookings").doc(bookingId).get(),
    db.collection("paygEmailOutbox").doc(intentId).get(),
    db.collection("paygWaiverAcceptances").doc(intentId).get(),
  ]);
  for (const field of ["attendee", "contact", "acceptances", "requestFingerprint", "checkoutSessionUrl", "piiDeleteAt"]) {
    assert.equal(intent.get(field), undefined, `intent.${field}`);
  }
  assert.equal(intent.get("checkoutSessionId"), "cs_test_privacy");
  assert.equal(intent.get("stripePriceId"), "price_test_payg");
  assert.equal(intent.get("acceptanceEvidenceDigest"), "c".repeat(64));

  for (const field of ["attendee", "contact", "acceptances"]) {
    assert.equal(order.get(field), undefined, `order.${field}`);
  }
  assert.equal(order.get("paymentIntentId"), "pi_test_privacy");
  assert.equal(order.get("refundStatus"), "succeeded");
  assert.equal(order.get("disputeStatus"), "won");
  assert.deepEqual(order.get("class"), CLASS);
  assert.equal(order.get("retainedAcceptanceEvidence.waiver.sha256"), "a".repeat(64));
  assert.equal(booking.get("userName"), undefined);
  assert.equal(booking.get("attendanceStatus"), "checked_in");

  assert.deepEqual(leasedOutbox.get("to"), ["ava@example.test"]);
  assert.ok(leasedOutbox.get("templateData"));
  assert.equal(
    leasedOutbox.get("piiRetentionCutoffAt").toMillis(),
    dueAt
  );
  assert.equal(
    leasedOutbox.get("piiRedactionRetryAt").toMillis(),
    leaseExpiresAt
  );
  assert.equal(leasedOutbox.get("piiRedactionDeferredReason"), "active_email_lease");
  assert.equal(waiver.get("attendee"), undefined);
  assert.equal(waiver.get("acceptances"), undefined);
  assert.equal(waiver.get("paymentIntentId"), "pi_test_privacy");
  assert.equal(waiver.get("acceptanceEvidenceDigest"), "c".repeat(64));
  assert.equal(waiver.get("retainedAcceptanceEvidence.terms.sha256"), "b".repeat(64));

  const beforeLeaseEnd = await runPaygPiiRedactionSweep(leaseExpiresAt - 1, 50);
  assert.equal(beforeLeaseEnd.outbox.redacted, 0);
  const afterLeaseEnd = await runPaygPiiRedactionSweep(leaseExpiresAt, 50);
  assert.equal(afterLeaseEnd.outbox.redacted, 1);
  const redactedOutbox = await db.collection("paygEmailOutbox").doc(intentId).get();
  for (const field of ["to", "templateData", "lastError", "piiRedactionRetryAt"]) {
    assert.equal(redactedOutbox.get(field), undefined, `outbox.${field}`);
  }
  assert.equal(redactedOutbox.get("piiRetentionCutoffAt").toMillis(), dueAt);
  assert.equal(redactedOutbox.get("providerMessageId"), "email_test_privacy");
  assert.equal(redactedOutbox.get("status"), "sending");

  const idempotent = await runPaygPiiRedactionSweep(leaseExpiresAt + 1, 50);
  assert.deepEqual(idempotent, {
    intents: {redacted: 0, deferred: 0, skipped: 0, failed: 0},
    orders: {redacted: 0, deferred: 0, skipped: 0, failed: 0},
    outbox: {redacted: 0, deferred: 0, skipped: 0, failed: 0},
    waivers: {redacted: 0, deferred: 0, skipped: 0, failed: 0},
  });
});

test("PAYG redaction rejects a malformed far-future email lease", async () => {
  const nowMillis = Date.parse("2026-12-10T12:00:00.000Z");
  const cutoff = nowMillis - 1;
  const leaseStartedAt = nowMillis - 1_000;
  const orderId = `payg_${"0".repeat(64)}`;
  const outboxRef = db.collection("paygEmailOutbox").doc(orderId);
  await outboxRef.set({
    orderId,
    kind: "payg_guest_confirmation",
    status: "sending",
    to: ["far-future-lease@example.test"],
    templateData: {attendeeName: "Far Future Lease"},
    lastError: "far-future-lease@example.test failed",
    leaseToken: "lease-token-far-future-1234",
    lastAttemptAt: Timestamp.fromMillis(leaseStartedAt),
    leaseExpiresAt: Timestamp.fromMillis(
      leaseStartedAt + 365 * 24 * 60 * 60 * 1000
    ),
    piiRetentionCutoffAt: Timestamp.fromMillis(cutoff),
    piiRedactionRetryAt: Timestamp.fromMillis(cutoff),
    piiRedactionDeferredReason: "active_email_lease",
  });

  const result = await runPaygPiiRedactionSweep(nowMillis, 50);
  assert.equal(result.outbox.deferred, 0);
  assert.equal(result.outbox.redacted, 1);
  const outbox = await outboxRef.get();
  assert.equal(outbox.get("to"), undefined);
  assert.equal(outbox.get("templateData"), undefined);
  assert.equal(outbox.get("lastError"), undefined);
  assert.equal(outbox.get("piiRedactionRetryAt"), undefined);
  assert.equal(outbox.get("piiRedactionDeferredReason"), undefined);
  assert.ok(outbox.get("piiRedactedAt"));
});

test("PAYG intent redaction is bounded, resumable, and removes stale unresolved PII", async () => {
  const nowMillis = Date.parse("2026-12-10T12:00:00.000Z");
  const dueAt = nowMillis - 1;
  const terminalIds = [
    `payg_${"4".repeat(64)}`,
    `payg_${"5".repeat(64)}`,
  ];
  const unresolvedId = `payg_${"6".repeat(64)}`;
  const seedIntent = (status) => ({
    status,
    attendee: ATTENDEE,
    contact: {email: "ava@example.test"},
    acceptances: ACCEPTANCES,
    requestFingerprint: "f".repeat(64),
    checkoutSessionUrl: "https://checkout.stripe.test/session",
    checkoutSessionId: "cs_test_bounded",
    privacy: PRIVACY,
    piiRetentionCutoffAt: Timestamp.fromMillis(dueAt),
    piiRedactionRetryAt: Timestamp.fromMillis(dueAt),
    piiDeleteAt: Timestamp.fromMillis(dueAt),
  });
  await Promise.all([
    ...terminalIds.map((id) =>
      db.collection("paygIntents").doc(id).set(seedIntent("expired"))
    ),
    db.collection("paygIntents").doc(unresolvedId).set(
      seedIntent("payment_pending")
    ),
  ]);

  const first = await runPaygPiiRedactionSweep(nowMillis, 1);
  assert.equal(first.intents.redacted + first.intents.deferred, 1);
  const dueAfterOne = await db.collection("paygIntents")
    .where("piiRedactionRetryAt", "<=", Timestamp.fromMillis(nowMillis))
    .get();
  assert.equal(dueAfterOne.size, 2);

  await runPaygPiiRedactionSweep(nowMillis, 1);
  await runPaygPiiRedactionSweep(nowMillis, 1);
  const terminalDocs = await Promise.all(terminalIds.map((id) =>
    db.collection("paygIntents").doc(id).get()
  ));
  for (const intent of terminalDocs) {
    assert.equal(intent.get("attendee"), undefined);
    assert.equal(intent.get("checkoutSessionId"), "cs_test_bounded");
  }
  const unresolved = await db.collection("paygIntents").doc(unresolvedId).get();
  for (const field of [
    "attendee",
    "contact",
    "acceptances",
    "requestFingerprint",
    "checkoutSessionUrl",
    "piiRedactionRetryAt",
  ]) {
    assert.equal(unresolved.get(field), undefined, `unresolved.${field}`);
  }
  assert.equal(unresolved.get("status"), "payment_pending");
  assert.equal(unresolved.get("checkoutSessionId"), "cs_test_bounded");
  assert.equal(unresolved.get("piiDeleteAt"), undefined);
  assert.equal(unresolved.get("piiRedactionDeferredReason"), undefined);
});

test("PAYG discovery resumes across old-only and markerless PII rows", async () => {
  const nowMillis = Date.parse("2026-12-10T12:00:00.000Z");
  const legacyAt = Timestamp.fromMillis(nowMillis + 30 * 24 * 60 * 60 * 1000);
  const cases = [
    {
      resultKey: "intents",
      collection: "paygIntents",
      legacyField: "piiScrubAt",
      piiFields: ["attendee", "contact", "acceptances", "requestFingerprint", "checkoutSessionUrl"],
      data: {
        status: "expired",
        attendee: ATTENDEE,
        contact: {email: "legacy-intent@example.test"},
        acceptances: ACCEPTANCES,
        requestFingerprint: "a".repeat(64),
        checkoutSessionUrl: "https://checkout.stripe.test/legacy-intent",
        piiDeleteAt: legacyAt,
      },
    },
    {
      resultKey: "orders",
      collection: "paygOrders",
      legacyField: "piiRedactAt",
      piiFields: ["attendee", "contact", "acceptances"],
      data: {
        attendee: ATTENDEE,
        contact: {email: "legacy-order@example.test"},
        acceptances: ACCEPTANCES,
        paymentIntentId: "pi_legacy_discovery",
      },
    },
    {
      resultKey: "outbox",
      collection: "paygEmailOutbox",
      legacyField: "piiRedactAt",
      piiFields: ["to", "templateData", "lastError"],
      data: {
        status: "pending",
        to: ["legacy-outbox@example.test"],
        templateData: {attendeeName: "Legacy Outbox"},
        lastError: "legacy-outbox@example.test bounced",
      },
    },
    {
      resultKey: "waivers",
      collection: "paygWaiverAcceptances",
      legacyField: "piiRedactAt",
      piiFields: ["attendee", "acceptances"],
      data: {
        attendee: ATTENDEE,
        acceptances: ACCEPTANCES,
        acceptanceEvidenceDigest: "d".repeat(64),
      },
    },
  ];

  await Promise.all(cases.flatMap((entry) => [
    db.collection(entry.collection).doc("a_legacy_only").set({
      ...entry.data,
      [entry.legacyField]: legacyAt,
    }),
    db.collection(entry.collection).doc("b_markerless").set(entry.data),
  ]));

  const first = await runPaygPiiRedactionSweep(nowMillis, 1);
  for (const entry of cases) {
    assert.equal(first[entry.resultKey].redacted, 1, entry.collection);
    assert.equal(first[entry.resultKey].failed, 0, entry.collection);
    const legacy = await db.collection(entry.collection).doc("a_legacy_only").get();
    const markerless = await db.collection(entry.collection).doc("b_markerless").get();
    for (const field of entry.piiFields) {
      assert.equal(legacy.get(field), undefined, `${entry.collection}.legacy.${field}`);
    }
    assert.ok(markerless.get(entry.piiFields[0]), `${entry.collection}.markerless retained`);
    assert.equal(legacy.get(entry.legacyField), undefined);
    assert.equal(legacy.get("piiRetentionCutoffAt"), undefined);
    assert.equal(legacy.get("piiRedactionRetryAt"), undefined);
  }

  const second = await runPaygPiiRedactionSweep(nowMillis, 1);
  for (const entry of cases) {
    assert.equal(second[entry.resultKey].redacted, 1, entry.collection);
    assert.equal(second[entry.resultKey].failed, 0, entry.collection);
    const markerless = await db.collection(entry.collection).doc("b_markerless").get();
    for (const field of entry.piiFields) {
      assert.equal(markerless.get(field), undefined, `${entry.collection}.markerless.${field}`);
    }
    assert.equal(markerless.get("piiRetentionCutoffAt"), undefined);
    assert.equal(markerless.get("piiRedactionRetryAt"), undefined);
  }

  await runPaygPiiRedactionSweep(nowMillis, 1);
  for (const entry of cases) {
    const state = await db.collection("paygPiiRedactionDiscovery")
      .doc(entry.collection).get();
    assert.equal(state.get("cursorDocumentId"), null, entry.collection);
    assert.equal(state.get("scannedCount"), 2, entry.collection);
    assert.equal(state.get("scheduledCount"), 2, entry.collection);
    assert.equal(state.get("completedCycleCount"), 1, entry.collection);
  }
});

test("PAYG discovery preserves a canonical cutoff and normalizes unsafe retry markers", async () => {
  const nowMillis = Date.parse("2026-12-10T12:00:00.000Z");
  const cutoff = nowMillis + 60 * 60 * 1000;
  const unsafeRetry = cutoff + 24 * 60 * 60 * 1000;
  const canonicalIntent = db.collection("paygIntents").doc("canonical_missing_retry");
  const missingCutoffIntent = db.collection("paygIntents").doc("missing_cutoff_unsafe_retry");
  await Promise.all([
    canonicalIntent.set({
      status: "expired",
      attendee: ATTENDEE,
      contact: {email: "canonical@example.test"},
      acceptances: ACCEPTANCES,
      piiRetentionCutoffAt: Timestamp.fromMillis(cutoff),
      piiRedactionRetryAt: Timestamp.fromMillis(unsafeRetry),
    }),
    missingCutoffIntent.set({
      status: "expired",
      attendee: ATTENDEE,
      contact: {email: "unsafe@example.test"},
      acceptances: ACCEPTANCES,
      piiRedactionRetryAt: Timestamp.fromMillis(unsafeRetry),
    }),
  ]);

  const first = await runPaygPiiRedactionSweep(nowMillis, 50);
  assert.equal(first.intents.redacted, 1);
  const [canonical, missingCutoff] = await Promise.all([
    canonicalIntent.get(),
    missingCutoffIntent.get(),
  ]);
  assert.deepEqual(canonical.get("attendee"), ATTENDEE);
  assert.equal(canonical.get("piiRetentionCutoffAt").toMillis(), cutoff);
  assert.equal(canonical.get("piiRedactionRetryAt").toMillis(), cutoff);
  assert.equal(missingCutoff.get("attendee"), undefined);
  assert.equal(missingCutoff.get("piiRetentionCutoffAt"), undefined);
  assert.equal(missingCutoff.get("piiRedactionRetryAt"), undefined);

  const due = await runPaygPiiRedactionSweep(cutoff, 50);
  assert.equal(due.intents.redacted, 1);
  assert.equal((await canonicalIntent.get()).get("attendee"), undefined);
});

test("PAYG missing-cutoff outbox closes despite apparent active lease", async () => {
  const nowMillis = Date.parse("2026-12-10T12:00:00.000Z");
  const outboxRef = db.collection("paygEmailOutbox").doc("missing_cutoff_active_lease");
  await outboxRef.set({
    status: "sending",
    to: ["must-redact@example.test"],
    templateData: {attendeeName: "Must Redact"},
    lastError: "must-redact@example.test",
    leaseToken: "lease-token-missing-cutoff",
    lastAttemptAt: Timestamp.fromMillis(nowMillis - 1_000),
    leaseExpiresAt: Timestamp.fromMillis(nowMillis + 10 * 60 * 1000),
  });

  const result = await runPaygPiiRedactionSweep(nowMillis, 50);
  assert.equal(result.outbox.redacted, 1);
  assert.equal(result.outbox.deferred, 0);
  const outbox = await outboxRef.get();
  assert.equal(outbox.get("status"), "tombstoned");
  assert.equal(outbox.get("piiRedactionReason"), "retention_deadline_missing");
  for (const field of [
    "to",
    "templateData",
    "lastError",
    "piiRedactionRetryAt",
    "leaseToken",
    "leaseExpiresAt",
  ]) {
    assert.equal(outbox.get(field), undefined, field);
  }
});

test("PAYG reintroduced PII is redacted immediately despite cutoff, backoff, or lease", async () => {
  const nowMillis = Date.parse("2026-12-10T12:00:00.000Z");
  const cutoff = nowMillis + 24 * 60 * 60 * 1000;
  const unsafeRetry = cutoff + 24 * 60 * 60 * 1000;
  const previouslyRedactedAt = Timestamp.fromMillis(nowMillis - 1_000);
  const intentId = `payg_${"b".repeat(64)}`;
  const bookingId = `payg_guest_${"c".repeat(64)}`;

  await Promise.all([
    db.collection("paygIntents").doc(intentId).set({
      status: "expired",
      attendee: ATTENDEE,
      contact: {email: "reintroduced@example.test"},
      acceptances: ACCEPTANCES,
      requestFingerprint: "d".repeat(64),
      checkoutSessionUrl: "https://checkout.stripe.test/reintroduced",
      privacy: PRIVACY,
      piiRetentionCutoffAt: Timestamp.fromMillis(cutoff),
      piiRedactionRetryAt: Timestamp.fromMillis(unsafeRetry),
      piiRedactionLastFailedAt: previouslyRedactedAt,
      piiScrubbedAt: "malformed-legacy-closure-marker",
    }),
    db.collection("paygOrders").doc(intentId).set({
      ...piiRecord(cutoff),
      orderId: intentId,
      status: "attended",
      bookingId,
      piiRedactionRetryAt: Timestamp.fromMillis(unsafeRetry),
      piiRedactionLastFailedAt: previouslyRedactedAt,
      piiRedactedAt: "malformed-legacy-closure-marker",
    }),
    db.collection("bookings").doc(bookingId).set({
      bookingKind: "payg_guest",
      paygOrderId: intentId,
      userName: "Reintroduced Name",
    }),
    db.collection("paygEmailOutbox").doc(intentId).set({
      status: "sending",
      to: ["reintroduced@example.test"],
      templateData: {attendeeName: "Reintroduced Name"},
      lastError: "reintroduced@example.test bounced",
      leaseToken: "lease-token-reintroduced-1234",
      lastAttemptAt: Timestamp.fromMillis(nowMillis - 1_000),
      leaseExpiresAt: Timestamp.fromMillis(nowMillis + 10 * 60 * 1000),
      piiRetentionCutoffAt: Timestamp.fromMillis(cutoff),
      piiRedactionRetryAt: Timestamp.fromMillis(unsafeRetry),
      piiRedactionDeferredReason: "active_email_lease",
      piiRedactionLastFailedAt: previouslyRedactedAt,
      piiRedactedAt: "malformed-legacy-closure-marker",
    }),
    db.collection("paygWaiverAcceptances").doc(intentId).set({
      ...piiRecord(cutoff),
      orderId: intentId,
      piiRedactionRetryAt: Timestamp.fromMillis(unsafeRetry),
      piiRedactionLastFailedAt: previouslyRedactedAt,
      piiRedactedAt: "malformed-legacy-closure-marker",
    }),
  ]);

  const reintroducedIntent = await db.collection("paygIntents")
    .doc(intentId).get();
  assert.equal(
    paygTesting.hasRecoverablePaygIntentPii(
      reintroducedIntent.data(),
      nowMillis
    ),
    false
  );
  assert.equal(
    (await paygTesting.claimPaygSessionRecovery(
      reintroducedIntent.ref,
      nowMillis
    )).outcome,
    "privacy_expired"
  );

  const result = await runPaygPiiRedactionSweep(nowMillis, 50);
  for (const collectionResult of Object.values(result)) {
    assert.deepEqual(
      collectionResult,
      {redacted: 1, deferred: 0, skipped: 0, failed: 0}
    );
  }
  const [intent, order, booking, outbox, waiver] = await Promise.all([
    db.collection("paygIntents").doc(intentId).get(),
    db.collection("paygOrders").doc(intentId).get(),
    db.collection("bookings").doc(bookingId).get(),
    db.collection("paygEmailOutbox").doc(intentId).get(),
    db.collection("paygWaiverAcceptances").doc(intentId).get(),
  ]);
  for (const [snapshot, fields] of [
    [intent, ["attendee", "contact", "acceptances", "requestFingerprint", "checkoutSessionUrl"]],
    [order, ["attendee", "contact", "acceptances"]],
    [outbox, ["to", "templateData", "lastError"]],
    [waiver, ["attendee", "acceptances"]],
  ]) {
    for (const field of fields) assert.equal(snapshot.get(field), undefined);
    assert.equal(snapshot.get("piiRetentionCutoffAt").toMillis(), cutoff);
    assert.equal(snapshot.get("piiRedactionRetryAt"), undefined);
    assert.equal(
      snapshot.get("piiRedactionDiscoveryReason"),
      "pii_reintroduced_after_redaction"
    );
  }
  assert.equal(booking.get("userName"), undefined);
});

test("PAYG redaction failure keeps the cutoff immutable and converges after backoff", async () => {
  const nowMillis = Date.parse("2026-12-10T12:00:00.000Z");
  const cutoff = nowMillis - 1;
  const retryAt = nowMillis + 60 * 60 * 1000;
  const intentId = `payg_${"e".repeat(64)}`;
  const intentRef = db.collection("paygIntents").doc(intentId);
  await intentRef.set({
    status: "expired",
    attendee: ATTENDEE,
    contact: {email: "retry@example.test"},
    acceptances: ACCEPTANCES,
    requestFingerprint: "f".repeat(64),
    checkoutSessionUrl: "https://checkout.stripe.test/retry",
    privacy: PRIVACY,
    piiRetentionCutoffAt: Timestamp.fromMillis(cutoff),
    piiRedactionRetryAt: Timestamp.fromMillis(cutoff),
  });
  paygTesting.injectPaygPiiRedactionFailureOnce("paygIntents", intentId);

  const failed = await runPaygPiiRedactionSweep(nowMillis, 50);
  assert.equal(failed.intents.redacted, 0);
  assert.equal(failed.intents.failed, 1);
  let pending = await intentRef.get();
  assert.deepEqual(pending.get("attendee"), ATTENDEE);
  assert.equal(pending.get("piiRetentionCutoffAt").toMillis(), cutoff);
  assert.equal(pending.get("piiRedactionRetryAt").toMillis(), retryAt);
  assert.equal(pending.get("piiRedactionFailureCount"), 1);
  assert.ok(pending.get("piiRedactionLastFailedAt"));

  const early = await runPaygPiiRedactionSweep(retryAt - 1, 50);
  assert.equal(early.intents.redacted, 0);
  assert.equal(early.intents.failed, 0);
  pending = await intentRef.get();
  assert.deepEqual(pending.get("attendee"), ATTENDEE);
  assert.equal(pending.get("piiRetentionCutoffAt").toMillis(), cutoff);
  assert.equal(pending.get("piiRedactionRetryAt").toMillis(), retryAt);

  const converged = await runPaygPiiRedactionSweep(retryAt, 50);
  assert.equal(converged.intents.redacted, 1);
  assert.equal(converged.intents.failed, 0);
  const redacted = await intentRef.get();
  assert.equal(redacted.get("attendee"), undefined);
  assert.equal(redacted.get("contact"), undefined);
  assert.equal(redacted.get("piiRetentionCutoffAt").toMillis(), cutoff);
  assert.equal(redacted.get("piiRedactionRetryAt"), undefined);
  assert.equal(redacted.get("piiRedactionLastFailedAt"), undefined);
});

test("PAYG recovery cannot restore a Checkout URL after concurrent privacy redaction", async () => {
  const deadline = Date.now() + 60 * 1000;
  const recoveryReadAt = deadline - 1;
  const intentId = `payg_${"9".repeat(64)}`;
  const intentRef = db.collection("paygIntents").doc(intentId);
  await intentRef.set({
    status: "reserved",
    capacityState: "held",
    unpaidHoldState: "counted",
    attendee: ATTENDEE,
    contact: {email: "ava@example.test", phone: "+447700900000"},
    acceptances: ACCEPTANCES,
    requestFingerprint: "e".repeat(64),
    checkoutSessionUrl: null,
    checkoutSessionId: null,
    privacy: PRIVACY,
    class: CLASS,
    piiRetentionCutoffAt: Timestamp.fromMillis(deadline),
    piiRedactionRetryAt: Timestamp.fromMillis(deadline),
  });

  const staleRecoveryRead = await intentRef.get();
  assert.equal(
    paygTesting.hasRecoverablePaygIntentPii(
      staleRecoveryRead.data(),
      recoveryReadAt
    ),
    true
  );
  const recoveryClaim = await paygTesting.claimPaygSessionRecovery(
    intentRef,
    recoveryReadAt
  );
  assert.equal(recoveryClaim.outcome, "claimed");

  const redaction = await runPaygPiiRedactionSweep(deadline, 50);
  assert.equal(redaction.intents.redacted, 1);

  const writeOutcome = await paygTesting.recordRecoveredSession(
    intentRef,
    {
      id: "cs_test_privacy_race",
      url: "https://checkout.stripe.test/privacy-race",
    },
    recoveryClaim.token,
    recoveryReadAt
  );
  assert.equal(writeOutcome, "privacy_expired");

  const recovered = await intentRef.get();
  assert.equal(recovered.get("contact"), undefined);
  assert.equal(recovered.get("checkoutSessionUrl"), undefined);
  assert.equal(recovered.get("checkoutSessionId"), "cs_test_privacy_race");
  assert.equal(recovered.get("piiRedactionRetryAt"), undefined);
  assert.equal(recovered.get("piiRetentionCutoffAt").toMillis(), deadline);
  assert.equal(recovered.get("checkoutRecoveryToken"), undefined);
  assert.equal(recovered.get("checkoutRecoveryLeaseExpiresAt"), undefined);
  assert.ok(recovered.get("privacyRecoveryBlockedAt"));
});

test("PAYG recovery read crossing the cutoff cannot create a provider claim", {timeout: 15_000}, async () => {
  const nowMillis = Date.now();
  const cutoff = nowMillis + 1_000;
  const intentId = `payg_${"6".repeat(64)}`;
  const intentRef = db.collection("paygIntents").doc(intentId);
  await intentRef.set({
    status: "reserved",
    capacityState: "held",
    unpaidHoldState: "counted",
    attendee: ATTENDEE,
    contact: {email: "read-cutoff@example.test"},
    acceptances: ACCEPTANCES,
    requestFingerprint: "6".repeat(64),
    checkoutSessionUrl: null,
    checkoutSessionId: null,
    privacy: PRIVACY,
    class: CLASS,
    piiRetentionCutoffAt: Timestamp.fromMillis(cutoff),
    piiRedactionRetryAt: Timestamp.fromMillis(cutoff),
  });

  const barrier = paygTesting.pauseNextPaygSessionRecoveryAfterRead();
  const claimPromise = paygTesting.claimPaygSessionRecovery(
    intentRef,
    nowMillis
  );
  await barrier.reached;
  await new Promise((resolve) => setTimeout(
    resolve,
    Math.max(0, cutoff - Date.now() + 20)
  ));
  barrier.release();

  const claim = await claimPromise;
  assert.equal(claim.outcome, "privacy_expired");
  const intent = await intentRef.get();
  assert.equal(intent.get("checkoutRecoveryToken"), undefined);
  assert.equal(intent.get("checkoutRecoveryClaimedAt"), undefined);
  assert.equal(intent.get("checkoutRecoveryLeaseExpiresAt"), undefined);
});

test("PAYG order redaction preserves a conflicting non-PAYG booking", async () => {
  const nowMillis = Date.parse("2026-12-10T12:00:00.000Z");
  const orderId = `payg_${"7".repeat(64)}`;
  const bookingId = `payg_guest_${"8".repeat(64)}`;
  await Promise.all([
    db.collection("paygOrders").doc(orderId).set({
      ...piiRecord(nowMillis - 1),
      orderId,
      bookingId,
      checkoutSessionId: "cs_test_conflict",
      paymentIntentId: "pi_test_conflict",
      status: "attended",
    }),
    db.collection("bookings").doc(bookingId).set({
      bookingKind: "member",
      paygOrderId: orderId,
      userName: "Real Member",
    }),
  ]);

  const result = await runPaygPiiRedactionSweep(nowMillis, 50);
  assert.equal(result.orders.redacted, 1);
  assert.equal(result.orders.failed, 0);
  const [order, booking] = await Promise.all([
    db.collection("paygOrders").doc(orderId).get(),
    db.collection("bookings").doc(bookingId).get(),
  ]);
  assert.equal(order.get("attendee"), undefined);
  assert.equal(order.get("contact"), undefined);
  assert.equal(order.get("acceptances"), undefined);
  assert.equal(booking.get("userName"), "Real Member");
  assert.equal(order.get("piiRedactionRetryAt"), undefined);
  assert.equal(
    order.get("piiRetentionCutoffAt").toMillis(),
    nowMillis - 1
  );
  assert.equal(
    order.get("piiRedactionBookingWarning"),
    "conflicting_booking_binding"
  );
  assert.ok(order.get("piiRedactionBookingWarningAt"));
});
