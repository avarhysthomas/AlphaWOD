/* eslint-disable @typescript-eslint/no-var-requires, max-len, require-jsdoc */

const test = require("node:test");
const assert = require("node:assert/strict");
const admin = require("firebase-admin");

const projectId = process.env.GCLOUD_PROJECT || "alpha-wod-functions-test";
if (admin.apps.length === 0) admin.initializeApp({projectId});
const db = admin.firestore();
const {Timestamp} = admin.firestore;
const {runPaygPiiRedactionSweep} = require("../lib/payg");

const DISCOVERY_COLLECTION = "paygPiiRedactionDiscovery";
const COLLECTIONS = Object.freeze([
  "paygIntents",
  "paygOrders",
  "paygEmailOutbox",
  "paygWaiverAcceptances",
]);
const PII_FIELDS = Object.freeze({
  paygIntents: [
    "attendee",
    "contact",
    "acceptances",
    "requestFingerprint",
    "checkoutSessionUrl",
  ],
  paygOrders: ["attendee", "contact", "acceptances"],
  paygEmailOutbox: ["to", "templateData", "lastError"],
  paygWaiverAcceptances: ["attendee", "acceptances"],
});

const ATTENDEE = Object.freeze({
  fullName: "Privacy Discovery",
  dateOfBirth: "1990-01-01",
});
const CONTACT = Object.freeze({
  email: "privacy-discovery@example.test",
  phone: "+447700900000",
});
const ACCEPTANCES = Object.freeze({
  adultConfirmed: true,
  waiverAccepted: true,
  termsAccepted: true,
  cancellationPolicyAccepted: true,
});

async function clearFirestore() {
  const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
  assert.ok(firestoreHost, "FIRESTORE_EMULATOR_HOST is required");
  await fetch(
    `http://${firestoreHost}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    {method: "DELETE"}
  );
}

function paygId(character) {
  return `payg_${character.repeat(64)}`;
}

function bookingId(character) {
  return `payg_guest_${character.repeat(64)}`;
}

function legacyMarkerlessDocuments(id, pageCharacter, nowMillis) {
  return {
    paygIntents: {
      status: "expired",
      attendee: ATTENDEE,
      contact: CONTACT,
      acceptances: ACCEPTANCES,
      requestFingerprint: pageCharacter.repeat(64),
      checkoutSessionUrl: "https://checkout.stripe.test/privacy-discovery",
      checkoutSessionId: `cs_test_privacy_discovery_${pageCharacter}`,
      piiScrubAt: Timestamp.fromMillis(nowMillis + 86_400_000),
    },
    paygOrders: {
      orderId: id,
      status: "attended",
      bookingId: bookingId(pageCharacter),
      attendee: ATTENDEE,
      contact: CONTACT,
      acceptances: ACCEPTANCES,
      paymentIntentId: `pi_test_privacy_discovery_${pageCharacter}`,
      piiRedactAt: Timestamp.fromMillis(nowMillis + 86_400_000),
    },
    paygEmailOutbox: {
      orderId: id,
      kind: "payg_guest_confirmation",
      status: "sending",
      to: [CONTACT.email],
      templateData: {
        attendeeName: ATTENDEE.fullName,
        cancellationUrl: "https://example.test/pay-as-you-go/cancel?token=secret",
      },
      lastError: `Delivery to ${CONTACT.email} failed`,
      leaseToken: `lease-token-discovery-${pageCharacter.repeat(16)}`,
      lastAttemptAt: Timestamp.fromMillis(nowMillis - 1_000),
      leaseExpiresAt: Timestamp.fromMillis(nowMillis + 10 * 60 * 1_000),
      piiRedactAt: Timestamp.fromMillis(nowMillis + 86_400_000),
    },
    paygWaiverAcceptances: {
      orderId: id,
      attendee: ATTENDEE,
      acceptances: ACCEPTANCES,
      acceptanceEvidenceDigest: pageCharacter.repeat(64),
      piiRedactAt: Timestamp.fromMillis(nowMillis + 86_400_000),
    },
  };
}

function futureCutoffDocuments(id, character, cutoffMillis) {
  return {
    paygIntents: {
      status: "expired",
      attendee: ATTENDEE,
      contact: CONTACT,
      acceptances: ACCEPTANCES,
      requestFingerprint: character.repeat(64),
      checkoutSessionUrl: "https://checkout.stripe.test/privacy-future",
      piiRetentionCutoffAt: Timestamp.fromMillis(cutoffMillis),
    },
    paygOrders: {
      orderId: id,
      status: "attended",
      bookingId: bookingId(character),
      attendee: ATTENDEE,
      contact: CONTACT,
      acceptances: ACCEPTANCES,
      piiRetentionCutoffAt: Timestamp.fromMillis(cutoffMillis),
    },
    paygEmailOutbox: {
      orderId: id,
      kind: "payg_guest_confirmation",
      status: "pending",
      to: [CONTACT.email],
      templateData: {attendeeName: ATTENDEE.fullName},
      lastError: "Transient provider failure",
      piiRetentionCutoffAt: Timestamp.fromMillis(cutoffMillis),
    },
    paygWaiverAcceptances: {
      orderId: id,
      attendee: ATTENDEE,
      acceptances: ACCEPTANCES,
      piiRetentionCutoffAt: Timestamp.fromMillis(cutoffMillis),
    },
  };
}

async function seedDocumentSet(id, character, documents) {
  await Promise.all([
    ...COLLECTIONS.map((collectionId) =>
      db.collection(collectionId).doc(id).set(documents[collectionId])
    ),
    db.collection("bookings").doc(bookingId(character)).set({
      bookingKind: "payg_guest",
      paygOrderId: id,
      userName: ATTENDEE.fullName,
      status: "booked",
    }),
  ]);
}

function assertNoFields(snapshot, fields) {
  for (const field of fields) {
    assert.equal(snapshot.get(field), undefined, `${snapshot.ref.path}.${field}`);
  }
}

function emptySweepResult() {
  return {
    intents: {redacted: 0, deferred: 0, skipped: 0, failed: 0},
    orders: {redacted: 0, deferred: 0, skipped: 0, failed: 0},
    outbox: {redacted: 0, deferred: 0, skipped: 0, failed: 0},
    waivers: {redacted: 0, deferred: 0, skipped: 0, failed: 0},
  };
}

test.beforeEach(clearFirestore);

test("PAYG PII discovery is bounded, resumable, fail-closed, and wraps its cursor", async () => {
  const nowMillis = Date.parse("2026-12-10T12:00:00.000Z");
  const firstId = paygId("1");
  const secondId = paygId("2");
  await Promise.all([
    seedDocumentSet(
      firstId,
      "1",
      legacyMarkerlessDocuments(firstId, "1", nowMillis)
    ),
    seedDocumentSet(
      secondId,
      "2",
      legacyMarkerlessDocuments(secondId, "2", nowMillis)
    ),
  ]);

  const first = await runPaygPiiRedactionSweep(nowMillis, 1);
  for (const result of Object.values(first)) {
    assert.deepEqual(result, {redacted: 1, deferred: 0, skipped: 0, failed: 0});
  }

  for (const collectionId of COLLECTIONS) {
    const [redacted, pending, state] = await Promise.all([
      db.collection(collectionId).doc(firstId).get(),
      db.collection(collectionId).doc(secondId).get(),
      db.collection(DISCOVERY_COLLECTION).doc(collectionId).get(),
    ]);
    assertNoFields(redacted, PII_FIELDS[collectionId]);
    assert.ok(pending.get(PII_FIELDS[collectionId][0]));
    assert.equal(redacted.get("piiRedactionRetryAt"), undefined);
    assert.equal(redacted.get("piiRedactionDiscoveryReason"), "retention_cutoff_missing");
    assert.equal(state.get("cursorDocumentId"), firstId);
    assert.equal(state.get("scannedCount"), 1);
    assert.equal(state.get("scheduledCount"), 1);
  }
  const firstBooking = await db.collection("bookings").doc(bookingId("1")).get();
  assert.equal(firstBooking.get("userName"), undefined);

  const second = await runPaygPiiRedactionSweep(nowMillis, 1);
  for (const result of Object.values(second)) {
    assert.deepEqual(result, {redacted: 1, deferred: 0, skipped: 0, failed: 0});
  }
  for (const collectionId of COLLECTIONS) {
    const [redacted, state] = await Promise.all([
      db.collection(collectionId).doc(secondId).get(),
      db.collection(DISCOVERY_COLLECTION).doc(collectionId).get(),
    ]);
    assertNoFields(redacted, PII_FIELDS[collectionId]);
    assert.equal(state.get("cursorDocumentId"), secondId);
    assert.equal(state.get("scannedCount"), 2);
    assert.equal(state.get("scheduledCount"), 2);
  }
  const secondBooking = await db.collection("bookings").doc(bookingId("2")).get();
  assert.equal(secondBooking.get("userName"), undefined);

  assert.deepEqual(
    await runPaygPiiRedactionSweep(nowMillis, 1),
    emptySweepResult()
  );
  for (const collectionId of COLLECTIONS) {
    const state = await db.collection(DISCOVERY_COLLECTION).doc(collectionId).get();
    assert.equal(state.get("cursorDocumentId"), null);
    assert.equal(state.get("completedCycleCount"), 1);
  }

  assert.deepEqual(
    await runPaygPiiRedactionSweep(nowMillis, 1),
    emptySweepResult()
  );
  for (const collectionId of COLLECTIONS) {
    const state = await db.collection(DISCOVERY_COLLECTION).doc(collectionId).get();
    assert.equal(state.get("cursorDocumentId"), firstId);
    assert.equal(state.get("scheduledCount"), 2);
  }
});

test("PAYG PII discovery seeds a future immutable cutoff and redacts when due", async () => {
  const nowMillis = Date.parse("2026-12-10T12:00:00.000Z");
  const cutoffMillis = nowMillis + 60 * 60 * 1_000;
  const id = paygId("a");
  await seedDocumentSet(
    id,
    "a",
    futureCutoffDocuments(id, "a", cutoffMillis)
  );

  assert.deepEqual(
    await runPaygPiiRedactionSweep(nowMillis, 1),
    emptySweepResult()
  );
  for (const collectionId of COLLECTIONS) {
    const candidate = await db.collection(collectionId).doc(id).get();
    assert.ok(candidate.get(PII_FIELDS[collectionId][0]));
    assert.equal(
      candidate.get("piiRedactionRetryAt").toMillis(),
      cutoffMillis
    );
    assert.equal(candidate.get("piiRedactionDiscoveryReason"), "retry_marker_missing");
    assert.equal(
      candidate.get("piiRetentionCutoffAt").toMillis(),
      cutoffMillis
    );
  }

  const due = await runPaygPiiRedactionSweep(cutoffMillis, 1);
  for (const result of Object.values(due)) {
    assert.deepEqual(result, {redacted: 1, deferred: 0, skipped: 0, failed: 0});
  }
  for (const collectionId of COLLECTIONS) {
    const redacted = await db.collection(collectionId).doc(id).get();
    assertNoFields(redacted, PII_FIELDS[collectionId]);
    assert.equal(redacted.get("piiRedactionRetryAt"), undefined);
    assert.equal(
      redacted.get("piiRetentionCutoffAt").toMillis(),
      cutoffMillis
    );
  }
  const booking = await db.collection("bookings").doc(bookingId("a")).get();
  assert.equal(booking.get("userName"), undefined);

  assert.deepEqual(
    await runPaygPiiRedactionSweep(cutoffMillis + 1, 1),
    emptySweepResult()
  );
});

test("PAYG PII discovery removes only an exact-bound reintroduced booking name", async () => {
  const nowMillis = Date.parse("2026-12-10T12:00:00.000Z");
  const futureCutoff = nowMillis + 24 * 60 * 60 * 1_000;
  const redactedAt = Timestamp.fromMillis(nowMillis - 1_000);
  const exactOrderId = paygId("3");
  const conflictingOrderId = paygId("4");
  const exactBookingId = bookingId("3");
  const conflictingBookingId = bookingId("4");
  await Promise.all([
    db.collection("paygOrders").doc(exactOrderId).set({
      orderId: exactOrderId,
      status: "attended",
      bookingId: exactBookingId,
      piiRetentionCutoffAt: Timestamp.fromMillis(futureCutoff),
      piiRedactedAt: redactedAt,
    }),
    db.collection("bookings").doc(exactBookingId).set({
      bookingKind: "payg_guest",
      paygOrderId: exactOrderId,
      userName: "Reintroduced Guest Name",
      status: "booked",
    }),
    db.collection("paygOrders").doc(conflictingOrderId).set({
      orderId: conflictingOrderId,
      status: "attended",
      bookingId: conflictingBookingId,
      piiRetentionCutoffAt: Timestamp.fromMillis(futureCutoff),
      piiRedactedAt: redactedAt,
    }),
    db.collection("bookings").doc(conflictingBookingId).set({
      bookingKind: "member",
      paygOrderId: conflictingOrderId,
      userName: "Unrelated Member Name",
      status: "booked",
    }),
  ]);

  const first = await runPaygPiiRedactionSweep(nowMillis, 1);
  assert.deepEqual(
    first.orders,
    {redacted: 1, deferred: 0, skipped: 0, failed: 0}
  );
  const [exactOrder, exactBooking, firstState] = await Promise.all([
    db.collection("paygOrders").doc(exactOrderId).get(),
    db.collection("bookings").doc(exactBookingId).get(),
    db.collection(DISCOVERY_COLLECTION).doc("paygOrders").get(),
  ]);
  assert.equal(exactBooking.get("userName"), undefined);
  assert.equal(exactOrder.get("piiRedactionRetryAt"), undefined);
  assert.equal(
    exactOrder.get("piiRedactionDiscoveryReason"),
    "pii_reintroduced_after_redaction"
  );
  assert.equal(firstState.get("cursorDocumentId"), exactOrderId);

  const second = await runPaygPiiRedactionSweep(nowMillis, 1);
  assert.deepEqual(second.orders, emptySweepResult().orders);
  const [conflictingOrder, conflictingBooking, secondState] = await Promise.all([
    db.collection("paygOrders").doc(conflictingOrderId).get(),
    db.collection("bookings").doc(conflictingBookingId).get(),
    db.collection(DISCOVERY_COLLECTION).doc("paygOrders").get(),
  ]);
  assert.equal(conflictingBooking.get("userName"), "Unrelated Member Name");
  assert.equal(conflictingOrder.get("piiRedactionRetryAt"), undefined);
  assert.equal(conflictingOrder.get("piiRedactionDiscoveredAt"), undefined);
  assert.equal(secondState.get("cursorDocumentId"), conflictingOrderId);

  assert.deepEqual(
    (await runPaygPiiRedactionSweep(nowMillis, 1)).orders,
    emptySweepResult().orders
  );
  let state = await db.collection(DISCOVERY_COLLECTION).doc("paygOrders").get();
  assert.equal(state.get("cursorDocumentId"), null);
  assert.equal(state.get("completedCycleCount"), 1);

  assert.deepEqual(
    (await runPaygPiiRedactionSweep(nowMillis, 1)).orders,
    emptySweepResult().orders
  );
  state = await db.collection(DISCOVERY_COLLECTION).doc("paygOrders").get();
  assert.equal(state.get("cursorDocumentId"), exactOrderId);
  assert.equal(state.get("scheduledCount"), 1);
  assert.equal((await db.collection("bookings").doc(exactBookingId).get())
    .get("userName"), undefined);
});
