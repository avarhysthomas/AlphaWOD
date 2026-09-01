/* eslint-disable @typescript-eslint/no-var-requires, max-len, require-jsdoc */

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  __testing: paygTesting,
  APPROVED_PAYG_STRIPE_CATALOGUE_IDS,
  PAYG_AMOUNT_PENCE,
  PAYG_CHECKOUT_SCHEMA_VERSION,
  PAYG_CHECKOUT_ADMISSION_COLLECTION,
  PAYG_CHECKOUT_RATE_LIMIT_COLLECTION,
  PAYG_CURRENCY,
  PAYG_DUPLICATE_LOCK_COLLECTION,
  PAYG_BOOKING_PII_FIELDS,
  PAYG_INTENT_PII_FIELDS,
  PAYG_IDEMPOTENT_RETRY_POLICY,
  PAYG_MAX_CONCURRENT_UNPAID_HOLDS_PER_CLASS,
  PAYG_OFFERING_KEY,
  PAYG_ORDER_PII_FIELDS,
  PAYG_ORDER_PII_RETENTION_DAYS,
  PAYG_OUTBOX_PII_FIELDS,
  PAYG_PAYMENT_REVIEW_COLLECTION,
  PAYG_PII_REDACTION_IMPLEMENTED,
  PAYG_PII_REDACTION_BATCH_SIZE,
  PAYG_PII_REDACTION_RETRY_FIELD,
  PAYG_PII_RETENTION_CUTOFF_FIELD,
  PAYG_PRODUCT_NAME,
  PAYG_PURCHASE_KIND,
  PAYG_UNPAID_INTENT_RETENTION_DAYS,
  PAYG_WAIVER_PII_FIELDS,
  PAYG_WAIVER_PII_RETENTION_DAYS,
  assertPaygCheckoutAppCheck,
  assertPaygStripeCatalogueShape,
  buildPaygCheckoutSessionParams,
  buildPaygCancellationPreviewPayload,
  buildPaygConfirmationEmail,
  buildPaygConfirmationCorrectionEmail,
  buildPaygConfirmationCorrectionOutboxPayload,
  buildPaygConfirmationOutboxPayload,
  canonicalizePaygSourceAddress,
  classifyPaygDisputeStatus,
  collectPaygPaidContractMismatches,
  derivePaygAcceptanceEvidenceDigest,
  derivePaygAbuseKeys,
  derivePaygDuplicateLockCandidates,
  derivePaygDuplicateLockId,
  isPaygMetadata,
  isPaygOrderPiiClosed,
  isPaygDuplicateLockKeyringConfigured,
  isActivePaygEmailLease,
  isPaygEmailFailureAmbiguous,
  hasPaygSucceededRefundEvidence,
  isPaygPaymentRefundSafe,
  isPaygTerminalDisputeStatus,
  normalizePaygCheckoutRequest,
  paygIntentIdFromCheckoutSession,
  paygConfirmationCorrectionOutboxId,
  paygCheckoutRequestFingerprint,
  paygEmailLeaseCorrelation,
  paygPaymentCompletedBeforePiiCutoff,
  paygPiiRedactionDeadline,
  parsePaygPiiRetentionConfig,
  publicPaygAttendeeName,
  publicPaygPaymentReviewState,
  resolveAgeAtMillis,
  resolvePaygCancellationDecision,
  resolvePaygCancellationRefundPendingDisposition,
  resolvePaygCancellationSigningKey,
  resolvePaygCanonicalOrderReviewDisposition,
  resolvePaygCatalogueIds,
  resolvePaygPaymentReviewDisposition,
  resolvePaygConfirmationPostSend,
  resolvePaygEmailFailureAfterStateChange,
  resolvePaygDisputeObservation,
  resolvePaygDisputeOwnerStatus,
  resolvePaygIdempotentRetryAdmission,
  resolvePaygLinkedReviewRefundStatus,
  resolvePaygPendingRefundBinding,
  resolvePaygPostStartCancellationDisposition,
  resolvePaygTombstoneLeaseCorrelation,
  resolvePaygRefundState,
  resolvePaygUnpaidHoldLimit,
  resolveStoredPaygPiiRetentionConfig,
  sanitizePublicPaygClass,
  shouldSendPaygConfirmation,
  shouldEnqueuePaygConfirmationCorrection,
  shouldRecoverPaygConfirmationAcceptance,
  shouldReleasePaygDuplicateLockForAttendance,
  shouldPreservePaygSucceededRefund,
  signPaygCancellationToken,
  verifyPaygCancellationToken,
  verifyPaygCancellationTokenWithKeyring,
} = require("../lib/payg");

const LEGAL = Object.freeze({
  waiver: Object.freeze({
    version: "ZAF-PAYG-WAIVER-2026-01",
    publicUrl: "/legal/payg/waiver.txt",
    sha256: "a".repeat(64),
  }),
  terms: Object.freeze({
    version: "ZAF-PAYG-TERMS-2026-01",
    publicUrl: "/legal/payg/terms.txt",
    sha256: "b".repeat(64),
  }),
});

const ATTEMPT_ID = "paygAttempt_0123456789abcdef0123456789";
const INTENT_ID = `payg_${"c".repeat(64)}`;
const TOKEN_SECRET = "payg-test-secret-that-is-at-least-thirty-two-bytes";

function checkoutRequest(overrides = {}) {
  return {
    checkoutSchemaVersion: PAYG_CHECKOUT_SCHEMA_VERSION,
    checkoutAttemptId: ATTEMPT_ID,
    classId: "template_2026-09-10_1800",
    attendee: {
      fullName: "  Ava   Rhys Thomas  ",
      dateOfBirth: "1995-03-02",
    },
    contact: {
      email: " AVA@example.test ",
      phone: "+44 (7700) 900123",
    },
    acceptances: {
      adultConfirmed: true,
      waiverAccepted: true,
      termsAccepted: true,
      cancellationPolicyAccepted: true,
      waiverVersion: LEGAL.waiver.version,
      termsVersion: LEGAL.terms.version,
    },
    ...overrides,
  };
}

function exactPrice(mode = "test") {
  return {
    id: APPROVED_PAYG_STRIPE_CATALOGUE_IDS[mode].priceId,
    livemode: mode === "live",
    active: true,
    currency: "gbp",
    unit_amount: 700,
    type: "one_time",
    billing_scheme: "per_unit",
    recurring: null,
    custom_unit_amount: null,
    transform_quantity: null,
    tax_behavior: "unspecified",
    metadata: {},
  };
}

function exactProduct(mode = "test") {
  return {
    id: APPROVED_PAYG_STRIPE_CATALOGUE_IDS[mode].productId,
    livemode: mode === "live",
    active: true,
    name: "Adult Pay as You Go Class",
    tax_code: "txcd_50021001",
    metadata: {},
  };
}

test("the PAYG offering is one £7 GBP class and freezes both mode allowlists", () => {
  assert.equal(PAYG_OFFERING_KEY, "adult_payg_class");
  assert.equal(PAYG_PURCHASE_KIND, "payg_class");
  assert.equal(PAYG_AMOUNT_PENCE, 700);
  assert.equal(PAYG_CURRENCY, "gbp");
  assert.equal(PAYG_PRODUCT_NAME, "Adult Pay as You Go Class");
  assert.deepEqual(APPROVED_PAYG_STRIPE_CATALOGUE_IDS, {
    test: {
      productId: "prod_VAOxXxpax1MuRt",
      priceId: "price_1UAmVVFzNDZoGGA04z8hX10N",
    },
    live: {
      productId: "prod_VAOGG2ZsBQ65Qt",
      priceId: "price_1UAmoCFzNDZoGGA0lKDwjbBU",
    },
  });
});

test("catalogue validation accepts only the exact active one-time Product and Price", () => {
  for (const mode of ["test", "live"]) {
    assert.doesNotThrow(() => assertPaygStripeCatalogueShape(
      exactPrice(mode),
      exactProduct(mode),
      APPROVED_PAYG_STRIPE_CATALOGUE_IDS[mode],
      mode,
      "txcd_50021001"
    ));
  }

  for (const mutate of [
    (price) => Object.assign(price, {unit_amount: 751}),
    (price) => Object.assign(price, {currency: "usd"}),
    (price) => Object.assign(price, {type: "recurring", recurring: {interval: "month"}}),
    (price) => Object.assign(price, {active: false}),
    (price) => Object.assign(price, {livemode: true}),
    (price) => Object.assign(price, {id: APPROVED_PAYG_STRIPE_CATALOGUE_IDS.live.priceId}),
  ]) {
    const price = exactPrice();
    mutate(price);
    assert.throws(
      () => assertPaygStripeCatalogueShape(
        price,
        exactProduct(),
        APPROVED_PAYG_STRIPE_CATALOGUE_IDS.test,
        "test",
        "txcd_50021001"
      ),
      /approved one-time catalogue/i
    );
  }
  for (const product of [
    {...exactProduct(), id: APPROVED_PAYG_STRIPE_CATALOGUE_IDS.live.productId},
    {...exactProduct(), name: "Pay as you want"},
    {...exactProduct(), tax_code: null},
    {...exactProduct(), active: false},
    null,
  ]) {
    assert.throws(
      () => assertPaygStripeCatalogueShape(
        exactPrice(),
        product,
        APPROVED_PAYG_STRIPE_CATALOGUE_IDS.test,
        "test",
        "txcd_50021001"
      ),
      /approved one-time catalogue/i
    );
  }
});

test("deployment Price selection must equal the frozen allowlist for its Stripe mode", () => {
  assert.deepEqual(
    resolvePaygCatalogueIds(
      "test",
      APPROVED_PAYG_STRIPE_CATALOGUE_IDS.test.priceId,
      APPROVED_PAYG_STRIPE_CATALOGUE_IDS
    ),
    APPROVED_PAYG_STRIPE_CATALOGUE_IDS.test
  );
  assert.throws(
    () => resolvePaygCatalogueIds(
      "live",
      APPROVED_PAYG_STRIPE_CATALOGUE_IDS.test.priceId,
      APPROVED_PAYG_STRIPE_CATALOGUE_IDS
    ),
    /allowlist is incomplete/i
  );
  assert.throws(
    () => resolvePaygCatalogueIds("test", "", {
      test: {priceId: "", productId: ""},
      live: APPROVED_PAYG_STRIPE_CATALOGUE_IDS.live,
    }),
    /allowlist is incomplete/i
  );
});

test("checkout input normalizes identity/contact and rejects stale or incomplete evidence", () => {
  const normalized = normalizePaygCheckoutRequest(checkoutRequest(), LEGAL);
  assert.equal(normalized.attendee.fullName, "Ava Rhys Thomas");
  assert.equal(normalized.contact.email, "ava@example.test");
  assert.equal(normalized.contact.phone, "+447700900123");
  assert.equal(normalized.acceptances.waiverVersion, LEGAL.waiver.version);
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.acceptances), true);

  for (const contact of [
    {email: "ava@example.test"},
    {email: "ava@example.test", phone: ""},
    {email: "ava@example.test", phone: "   "},
  ]) {
    const withoutPhone = normalizePaygCheckoutRequest(
      checkoutRequest({contact}),
      LEGAL
    );
    assert.deepEqual(withoutPhone.contact, {email: "ava@example.test"});
    assert.equal("phone" in withoutPhone.contact, false);
  }

  assert.throws(
    () => normalizePaygCheckoutRequest(checkoutRequest({
      checkoutSchemaVersion: 0,
    }), LEGAL),
    /out of date/i
  );
  assert.throws(
    () => normalizePaygCheckoutRequest(checkoutRequest({
      acceptances: {
        ...checkoutRequest().acceptances,
        waiverVersion: "stale",
      },
    }), LEGAL),
    /changed/i
  );
  assert.throws(
    () => normalizePaygCheckoutRequest(checkoutRequest({
      contact: {email: "ava@example.test", phone: "07700900123"},
    }), LEGAL),
    /international format/i
  );
  assert.throws(
    () => normalizePaygCheckoutRequest(checkoutRequest({
      acceptances: {
        ...checkoutRequest().acceptances,
        waiverAccepted: false,
      },
    }), LEGAL),
    /must be accepted/i
  );
});

test("PAYG checkout App Check accepts only a fresh token from the exact web app", () => {
  const expectedAppId = "1:123456789:web:abcdef123456";
  assert.doesNotThrow(() => assertPaygCheckoutAppCheck({
    app: {appId: expectedAppId, alreadyConsumed: false},
  }, true, expectedAppId));
  assert.doesNotThrow(() => assertPaygCheckoutAppCheck({}, false, ""));

  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = () => undefined;
  console.error = () => undefined;
  try {
    for (const request of [
      {},
      {app: {appId: "1:987654321:web:anotherapp", alreadyConsumed: false}},
      {app: {appId: expectedAppId, alreadyConsumed: true}},
    ]) {
      assert.throws(
        () => assertPaygCheckoutAppCheck(request, true, expectedAppId),
        (error) => error.code === "permission-denied"
      );
    }
    assert.throws(
      () => assertPaygCheckoutAppCheck({
        app: {appId: expectedAppId, alreadyConsumed: false},
      }, true, ""),
      (error) => error.code === "unavailable"
    );
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }
});

test("request fingerprint is deterministic and binds every guest/class/legal field", () => {
  const first = normalizePaygCheckoutRequest(checkoutRequest(), LEGAL);
  const same = normalizePaygCheckoutRequest(checkoutRequest(), LEGAL);
  const otherClass = normalizePaygCheckoutRequest(checkoutRequest({
    classId: "template_2026-09-11_1800",
  }), LEGAL);
  assert.equal(
    paygCheckoutRequestFingerprint(first, LEGAL),
    paygCheckoutRequestFingerprint(same, LEGAL)
  );
  assert.notEqual(
    paygCheckoutRequestFingerprint(first, LEGAL),
    paygCheckoutRequestFingerprint(otherClass, LEGAL)
  );
  assert.notEqual(
    paygCheckoutRequestFingerprint(first, LEGAL),
    paygCheckoutRequestFingerprint(first, {
      ...LEGAL,
      waiver: {...LEGAL.waiver, sha256: "f".repeat(64)},
    })
  );
});

test("guest PII retention enforces the exact owner-approved schedule", () => {
  assert.equal(
    PAYG_PII_REDACTION_IMPLEMENTED,
    true,
    "the code marker changes only with the tested redaction worker"
  );
  assert.equal(PAYG_UNPAID_INTENT_RETENTION_DAYS, 30);
  assert.equal(PAYG_ORDER_PII_RETENTION_DAYS, 90);
  assert.equal(PAYG_WAIVER_PII_RETENTION_DAYS, 2190);
  assert.equal(PAYG_PII_REDACTION_BATCH_SIZE, 50);
  assert.equal(PAYG_PII_RETENTION_CUTOFF_FIELD, "piiRetentionCutoffAt");
  assert.equal(PAYG_PII_REDACTION_RETRY_FIELD, "piiRedactionRetryAt");
  assert.deepEqual(parsePaygPiiRetentionConfig({
    approved: true,
    policyVersion: "payg-retention-v1",
    orderPiiRetentionDays: "90",
    waiverPiiRetentionDays: "2190",
  }), {
    policyVersion: "payg-retention-v1",
    orderPiiRetentionDays: 90,
    waiverPiiRetentionDays: 2190,
  });
  for (const invalid of [
    {approved: false, policyVersion: "payg-v1", orderPiiRetentionDays: "90", waiverPiiRetentionDays: "2190"},
    {approved: true, policyVersion: "", orderPiiRetentionDays: "90", waiverPiiRetentionDays: "2190"},
    {approved: true, policyVersion: "payg-v1", orderPiiRetentionDays: "", waiverPiiRetentionDays: "2190"},
    {approved: true, policyVersion: "payg-v1", orderPiiRetentionDays: "30", waiverPiiRetentionDays: "2190"},
    {approved: true, policyVersion: "payg-v1", orderPiiRetentionDays: "90", waiverPiiRetentionDays: "2555"},
  ]) {
    assert.throws(() => parsePaygPiiRetentionConfig(invalid), /not explicitly approved/);
  }
  const classEnd = Date.parse("2026-09-10T19:00:00.000Z");
  assert.equal(
    paygPiiRedactionDeadline(classEnd, 90),
    classEnd + 90 * 24 * 60 * 60 * 1000
  );
  assert.deepEqual(resolveStoredPaygPiiRetentionConfig({
    policyVersion: "payg-retention-v1",
    orderPiiRetentionDays: 90,
    waiverPiiRetentionDays: 2190,
  }), {
    policyVersion: "payg-retention-v1",
    orderPiiRetentionDays: 90,
    waiverPiiRetentionDays: 2190,
  });
  assert.equal(resolveStoredPaygPiiRetentionConfig({policyVersion: "payg-v1"}), null);

  const normalized = normalizePaygCheckoutRequest(checkoutRequest(), LEGAL);
  const secret = "payg-evidence-secret-that-is-at-least-thirty-two-bytes";
  const digest = derivePaygAcceptanceEvidenceDigest(secret, normalized, LEGAL);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(digest, /ava|1995|example/i);
  assert.notEqual(
    digest,
    derivePaygAcceptanceEvidenceDigest(secret, {
      ...normalized,
      attendee: {...normalized.attendee, dateOfBirth: "1995-03-03"},
    }, LEGAL)
  );
});

test("PAYG PII promotion requires an exact provider success event before cutoff", () => {
  const intentId = `payg_${"a".repeat(64)}`;
  const checkoutSessionId = "cs_test_privacy_cutoff";
  const paymentIntent = {
    id: "pi_privacy_cutoff",
    livemode: false,
    status: "succeeded",
    amount_received: 700,
    currency: "gbp",
    latest_charge: "ch_privacy_cutoff",
    metadata: {
      purchaseKind: "payg_class",
      offeringKey: "adult_payg_class",
      paygIntentId: intentId,
      schemaVersion: "1",
    },
  };
  const charge = {
    id: "ch_privacy_cutoff",
    livemode: false,
    payment_intent: paymentIntent.id,
    paid: true,
    status: "succeeded",
    created: 1_800_000_000,
  };
  const successEvidence = {
    providerEventId: "evt_test_privacy_cutoff",
    providerEventType: "checkout.session.completed",
    providerEventCreatedSecond: charge.created + 10,
    checkoutSessionId,
    paymentIntentId: paymentIntent.id,
    intentId,
    livemode: false,
  };
  const base = {
    paymentIntent,
    charge,
    successEvidence,
    checkoutSessionId,
    intentId,
    expectedLivemode: false,
  };
  assert.equal(paygPaymentCompletedBeforePiiCutoff({
    ...base,
    piiRetentionCutoffAtMillis:
      (successEvidence.providerEventCreatedSecond + 1) * 1000,
  }), true);
  assert.equal(paygPaymentCompletedBeforePiiCutoff({
    ...base,
    piiRetentionCutoffAtMillis:
      successEvidence.providerEventCreatedSecond * 1000,
  }), false, "the success-event cutoff second itself is privacy-closed");
  assert.equal(paygPaymentCompletedBeforePiiCutoff({
    ...base,
    piiRetentionCutoffAtMillis: (charge.created + 5) * 1000,
  }), false, "an earlier Charge creation cannot prove pre-cutoff success");
  for (const invalid of [
    {charge: {...charge, paid: false}},
    {charge: {...charge, status: "failed"}},
    {charge: {...charge, payment_intent: "pi_other"}},
    {charge: null},
    {successEvidence: null},
    {successEvidence: {...successEvidence, paymentIntentId: "pi_other"}},
    {successEvidence: {...successEvidence, checkoutSessionId: "cs_other"}},
    {successEvidence: {...successEvidence, providerEventCreatedSecond: 0}},
    {piiRetentionCutoffAtMillis: null},
  ]) {
    assert.equal(paygPaymentCompletedBeforePiiCutoff({
      ...base,
      piiRetentionCutoffAtMillis:
        (successEvidence.providerEventCreatedSecond + 2) * 1000,
      ...invalid,
    }), false);
  }
});

test("PII promotion closes on any scrub marker and at the destination deadline", () => {
  const classEndMillis = Date.parse("2026-09-01T18:00:00.000Z");
  const destinationCutoff = classEndMillis +
    PAYG_ORDER_PII_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const intentId = `payg_${"a".repeat(64)}`;
  const paymentIntent = {
    id: "pi_promotion_privacy",
    livemode: false,
    status: "succeeded",
    amount_received: 700,
    currency: "gbp",
    latest_charge: "ch_promotion_privacy",
    metadata: {
      purchaseKind: "payg_class",
      offeringKey: "adult_payg_class",
      paygIntentId: intentId,
      schemaVersion: "1",
    },
  };
  const charge = {
    id: "ch_promotion_privacy",
    livemode: false,
    payment_intent: paymentIntent.id,
    paid: true,
    status: "succeeded",
    created: Math.floor(classEndMillis / 1000) - 3_600,
  };
  const checkoutSessionId = "cs_test_promotion_privacy";
  const successEvidence = {
    providerEventId: "evt_test_promotion_privacy",
    providerEventType: "checkout.session.completed",
    providerEventCreatedSecond: charge.created + 1,
    checkoutSessionId,
    paymentIntentId: paymentIntent.id,
    intentId,
    livemode: false,
  };
  const intent = {
    attendee: {fullName: "Privacy Test", dateOfBirth: "1990-01-01"},
    contact: {email: "privacy@example.test"},
    acceptances: {
      legal: {
        waiver: {sha256: "a".repeat(64)},
        terms: {sha256: "b".repeat(64)},
      },
    },
    acceptanceEvidenceDigest: "c".repeat(64),
    privacy: {
      policyVersion: "payg-retention-v1",
      orderPiiRetentionDays: 90,
      waiverPiiRetentionDays: 2190,
    },
    classEndMillis,
    piiRetentionCutoffAt: {
      toMillis: () => (successEvidence.providerEventCreatedSecond + 1) * 1000,
    },
  };
  const base = {
    intent,
    paymentIntent,
    charge,
    successEvidence,
    checkoutSessionId,
    intentId,
    expectedLivemode: false,
  };

  assert.equal(paygTesting.paygPiiPromotionMismatch({
    ...base,
    processingNowMillis: destinationCutoff - 1,
  }), null);
  assert.equal(paygTesting.paygPiiPromotionMismatch({
    ...base,
    intent: {...intent, piiScrubbedAt: "malformed-legacy-closure-marker"},
    processingNowMillis: destinationCutoff - 1,
  }), "intent_pii_already_scrubbed");
  assert.equal(paygTesting.paygPiiPromotionMismatch({
    ...base,
    processingNowMillis: destinationCutoff,
  }), "destination_pii_retention_cutoff_reached");
});

test("adult age is resolved in London on the class date", () => {
  const classDate = Date.parse("2026-09-10T17:00:00.000Z");
  assert.equal(resolveAgeAtMillis("2008-09-10", classDate), 18);
  assert.equal(resolveAgeAtMillis("2008-09-11", classDate), 17);
  assert.equal(resolveAgeAtMillis("2027-01-01", classDate), -1);
});

test("PII redaction defers only an email worker's unexpired active lease", () => {
  const nowMillis = Date.parse("2026-12-10T12:00:00.000Z");
  const retentionCutoffAtMillis = nowMillis - 1;
  const leaseStartedAtMillis = nowMillis - 1_000;
  const activeLease = {
    leaseToken: "lease-token-privacy-1234",
    leaseStartedAtMillis,
    leaseExpiresAtMillis: leaseStartedAtMillis + 10 * 60 * 1000,
    retentionCutoffAtMillis,
    nowMillis,
  };
  for (const status of ["sending", "reconciling"]) {
    assert.equal(isActivePaygEmailLease({
      ...activeLease,
      status,
    }), true);
    assert.equal(isActivePaygEmailLease({
      ...activeLease,
      status,
      leaseExpiresAtMillis: nowMillis,
    }), false);
  }
  for (const status of ["pending", "sent", "manual_review", "tombstoned"]) {
    assert.equal(isActivePaygEmailLease({
      ...activeLease,
      status,
    }), false, status);
  }
  for (const invalidEvidence of [
    {leaseToken: ""},
    {leaseStartedAtMillis: retentionCutoffAtMillis},
    {retentionCutoffAtMillis: null},
  ]) {
    assert.equal(isActivePaygEmailLease({
      ...activeLease,
      status: "sending",
      ...invalidEvidence,
    }), false);
  }
  assert.equal(isActivePaygEmailLease({
    ...activeLease,
    status: "sending",
    leaseExpiresAtMillis: leaseStartedAtMillis + 365 * 24 * 60 * 60 * 1000,
  }), false);
});

test("public schedule rows expose only sanitized fields and default PAYG on", () => {
  const now = Date.parse("2026-09-01T10:00:00.000Z");
  const source = {
    title: " Adult Conditioning ",
    timezone: "Europe/London",
    startTime: {toMillis: () => Date.parse("2026-09-02T18:00:00.000Z")},
    endTime: {toMillis: () => Date.parse("2026-09-02T19:00:00.000Z")},
    coachId: "private-coach-id",
    coachName: "Coach A",
    capacity: 12,
    bookedCount: 5,
    location: "Unit 3",
    status: "scheduled",
    internalNotes: "never public",
  };
  const row = sanitizePublicPaygClass("class_1", source, now);
  assert.deepEqual(row, {
    classId: "class_1",
    title: "Adult Conditioning",
    startTime: "2026-09-02T18:00:00.000Z",
    endTime: "2026-09-02T19:00:00.000Z",
    timezone: "Europe/London",
    coachName: "Coach A",
    location: "Unit 3",
    spacesRemaining: 7,
    availability: "available",
  });
  assert.equal(Object.hasOwn(row, "coachId"), false);
  assert.equal(Object.hasOwn(row, "capacity"), false);
  assert.equal(Object.hasOwn(row, "bookedCount"), false);
  assert.equal(
    sanitizePublicPaygClass("class_1", {...source, paygEligible: false}, now).availability,
    "unavailable"
  );
  assert.equal(
    sanitizePublicPaygClass("class_1", {...source, bookedCount: 12}, now).availability,
    "full"
  );
  assert.equal(
    sanitizePublicPaygClass("class_1", {...source, status: "cancelled"}, now),
    null
  );
});

test("cancellation boundary is refundable at exactly 24 hours and late after it", () => {
  const start = Date.parse("2026-09-10T18:00:00.000Z");
  const day = 24 * 60 * 60 * 1000;
  assert.deepEqual(resolvePaygCancellationDecision(start, start - day), {
    kind: "refundable",
    refundEligible: true,
    releaseCapacity: true,
    cutoffAtMillis: start - day,
  });
  assert.equal(resolvePaygCancellationDecision(start, start - day + 1).kind, "late");
  assert.equal(resolvePaygCancellationDecision(start, start - 1).releaseCapacity, true);
  assert.deepEqual(resolvePaygCancellationDecision(start, start), {
    kind: "no_show",
    refundEligible: false,
    releaseCapacity: false,
    cutoffAtMillis: start - day,
  });
});

test("post-start cancellation defers no-show until staff attendance review", () => {
  assert.equal(
    resolvePaygPostStartCancellationDisposition(false),
    "pending_attendance_review"
  );
  assert.equal(resolvePaygPostStartCancellationDisposition(true), "attended");
  assert.deepEqual(
    resolvePaygCancellationRefundPendingDisposition("guest_cancellation"),
    {refundEligible: true, issueRefund: true}
  );
  for (const reason of ["hold_released_before_payment", "paid_contract_mismatch", null]) {
    assert.deepEqual(resolvePaygCancellationRefundPendingDisposition(reason), {
      refundEligible: false,
      issueRefund: false,
    });
  }
  const classEndMillis = Date.parse("2026-09-10T19:00:00.000Z");
  assert.equal(shouldReleasePaygDuplicateLockForAttendance({
    attendanceStatus: "checked_in",
    nowMillis: classEndMillis - 30 * 60 * 1000,
    classEndMillis,
  }), false, "early check-in must keep duplicate purchase protection active");
  assert.equal(shouldReleasePaygDuplicateLockForAttendance({
    attendanceStatus: "dip",
    nowMillis: classEndMillis,
    classEndMillis,
  }), true);
});

test("cancellation bearer token is signed, URL safe, tamper evident, and expiring", () => {
  const payload = {v: 1, orderId: INTENT_ID, exp: 2_000_000_000};
  const token = signPaygCancellationToken(payload, TOKEN_SECRET);
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(verifyPaygCancellationToken(token, TOKEN_SECRET, 1_900_000_000), payload);
  assert.throws(
    () => verifyPaygCancellationToken(`${token.slice(0, -1)}x`, TOKEN_SECRET, 1_900_000_000),
    /invalid or expired/i
  );
  assert.throws(
    () => verifyPaygCancellationToken(token, TOKEN_SECRET, payload.exp + 1),
    /invalid or expired/i
  );
  assert.throws(
    () => signPaygCancellationToken(payload, "too-short"),
    /too short/i
  );
});

test("cancellation key IDs select current or bounded previous verification keys", () => {
  const now = Math.floor(Date.parse("2026-09-01T10:00:00Z") / 1000);
  const currentSecret = "current-cancellation-secret-that-is-at-least-32-bytes";
  const previousSecret = "previous-cancellation-secret-that-is-at-least-32-bytes";
  const payload = {v: 1, orderId: INTENT_ID, exp: now + 3600};
  const keyring = [
    {kid: "cancel-v2", secret: currentSecret},
    {
      kid: "cancel-v1",
      secret: previousSecret,
      verifyUntilUnixSeconds: now + 7200,
    },
  ];
  const current = signPaygCancellationToken(payload, currentSecret, "cancel-v2");
  assert.equal(current.split(".").length, 3);
  assert.deepEqual(verifyPaygCancellationTokenWithKeyring(current, keyring, now), payload);

  const previous = signPaygCancellationToken(payload, previousSecret, "cancel-v1");
  assert.deepEqual(verifyPaygCancellationTokenWithKeyring(previous, keyring, now), payload);
  const legacyPrevious = signPaygCancellationToken(payload, previousSecret);
  assert.deepEqual(
    verifyPaygCancellationTokenWithKeyring(legacyPrevious, keyring, now),
    payload,
    "pre-kid links remain valid while the previous key is retained"
  );
  assert.throws(
    () => verifyPaygCancellationTokenWithKeyring(
      signPaygCancellationToken(payload, previousSecret, "unknown-v1"),
      keyring,
      now
    ),
    /invalid or expired/i
  );
  const overHorizon = signPaygCancellationToken(
    {...payload, exp: now + 7201},
    previousSecret,
    "cancel-v1"
  );
  assert.throws(
    () => verifyPaygCancellationTokenWithKeyring(overHorizon, keyring, now),
    /invalid or expired/i
  );
});

test("cancellation fulfilment signing depends only on the current rotation key", () => {
  const currentSecret = "current-cancellation-secret-that-is-more-than-32-bytes";
  assert.deepEqual(
    resolvePaygCancellationSigningKey("cancel-v2", currentSecret),
    {kid: "cancel-v2", secret: currentSecret}
  );
  assert.throws(
    () => resolvePaygCancellationSigningKey("cancel-v2", "too-short"),
    /signing key is invalid/
  );
  assert.throws(
    () => resolvePaygCancellationSigningKey("INVALID KID", currentSecret),
    /signing key is invalid/
  );
});

test("cancellation preview exposes class policy only and never guest PII", () => {
  const classStartMillis = Date.parse("2026-09-10T17:00:00.000Z");
  const cutoff = classStartMillis - 24 * 60 * 60 * 1000;
  const preview = buildPaygCancellationPreviewPayload({
    orderId: INTENT_ID,
    status: "confirmed",
    class: {
      classId: "class_1",
      title: "Conditioning",
      startTime: "2026-09-10T18:00:00.000+01:00",
      endTime: "2026-09-10T19:00:00.000+01:00",
      timezone: "Europe/London",
      location: "Unit 3",
    },
    classStartMillis,
    cancellationCutoffAtMillis: cutoff,
    nowMillis: cutoff,
  });
  assert.equal(preview.currentOrderState, "confirmed");
  assert.equal(preview.refundEligibleNow, true);
  assert.equal(preview.cancellationCutoffAt, new Date(cutoff).toISOString());
  assert.deepEqual(Object.keys(preview).sort(), [
    "cancellationCutoffAt",
    "class",
    "currentOrderState",
    "ok",
    "refundEligibleNow",
  ]);
  assert.doesNotMatch(
    JSON.stringify(preview),
    /attendee|dateOfBirth|email|phone|waiver|token/i
  );
});

test("public order projection remains safe after attendee PII redaction", () => {
  assert.equal(publicPaygAttendeeName({fullName: "Ava Rhys Thomas"}), "Ava Rhys Thomas");
  assert.equal(
    publicPaygAttendeeName(
      {fullName: "Reintroduced Closed Name"},
      "malformed-legacy-closure-marker"
    ),
    "PAYG guest"
  );
  for (const redactedOrMalformed of [undefined, null, {}, {fullName: ""}, {
    fullName: 42,
  }]) {
    assert.equal(publicPaygAttendeeName(redactedOrMalformed), "PAYG guest");
  }
  const nowMillis = Date.parse("2026-12-10T12:00:00.000Z");
  const timestamp = (millis) => ({toMillis: () => millis});
  assert.equal(isPaygOrderPiiClosed({
    piiRedactedAt: null,
    piiRetentionCutoffAt: timestamp(nowMillis + 1),
    nowMillis,
  }), false);
  for (const closed of [
    {piiRedactedAt: "malformed-legacy-closure-marker", piiRetentionCutoffAt: timestamp(nowMillis + 1)},
    {piiRedactedAt: null, piiRetentionCutoffAt: timestamp(nowMillis)},
    {piiRedactedAt: null, piiRetentionCutoffAt: undefined},
  ]) {
    assert.equal(isPaygOrderPiiClosed({...closed, nowMillis}), true);
  }
});

test("Checkout is one card payment and copies non-PII routing metadata to PaymentIntent", () => {
  const params = buildPaygCheckoutSessionParams({
    intentId: INTENT_ID,
    classId: "class_1",
    classTitle: "Adult Conditioning",
    email: "ava@example.test",
    priceId: APPROVED_PAYG_STRIPE_CATALOGUE_IDS.test.priceId,
    publicOrigin: "https://alpha-wod.vercel.app",
    checkoutExpiresAt: 2_000_000_000,
  });
  assert.equal(params.mode, "payment");
  assert.deepEqual(params.line_items, [{
    price: APPROVED_PAYG_STRIPE_CATALOGUE_IDS.test.priceId,
    quantity: 1,
  }]);
  assert.deepEqual(params.payment_method_types, ["card"]);
  assert.equal(params.automatic_tax.enabled, false);
  assert.deepEqual(params.metadata, params.payment_intent_data.metadata);
  assert.deepEqual(params.metadata, {
    purchaseKind: "payg_class",
    offeringKey: "adult_payg_class",
    paygIntentId: INTENT_ID,
    classId: "class_1",
    schemaVersion: "1",
  });
  assert.equal(isPaygMetadata(params.metadata), true);
  assert.equal(isPaygMetadata({...params.metadata, purchaseKind: "membership"}), false);
  assert.equal(JSON.stringify(params.metadata).includes("ava@example.test"), false);
  assert.equal(
    params.success_url,
    "https://alpha-wod.vercel.app/pay-as-you-go/success?session_id={CHECKOUT_SESSION_ID}"
  );
});

test("confirmation outbox freezes class, amount, policy, and signed cancellation URL", () => {
  const payload = buildPaygConfirmationOutboxPayload({
    orderId: INTENT_ID,
    recipientEmail: "ava@example.test",
    attendeeName: "Ava Rhys Thomas",
    class: {
      classId: "class_1",
      title: "Adult Conditioning",
      startTime: "2026-09-10T18:00:00.000Z",
      endTime: "2026-09-10T19:00:00.000Z",
      timezone: "Europe/London",
      location: "Unit 3",
    },
    amountPence: 700,
    currency: "gbp",
    publicOrigin: "https://alpha-wod.vercel.app",
    cancellationToken: "signed.token",
    cancellationCutoffAtMillis: Date.parse("2026-09-09T18:00:00.000Z"),
  });
  assert.equal(payload.idempotencyKey, `payg-confirmation/${INTENT_ID}/v1`);
  assert.deepEqual(payload.to, ["ava@example.test"]);
  assert.equal(payload.templateData.class.title, "Adult Conditioning");
  assert.equal(payload.templateData.amountPence, 700);
  assert.equal(payload.templateData.currency, "gbp");
  assert.equal(payload.templateData.cancellationPolicy.cutoffHours, 24);
  assert.match(payload.templateData.cancellationPolicy.beforeCutoff, /refundable/i);
  assert.match(payload.templateData.cancellationPolicy.afterCutoff, /non-refundable/i);
  assert.equal(
    payload.templateData.cancellationUrl,
    "https://alpha-wod.vercel.app/pay-as-you-go/cancel?token=signed.token"
  );
  assert.equal(Object.isFrozen(payload), true);
  assert.equal(Object.isFrozen(payload.templateData), true);
});

test("confirmation email is deterministic, escaped, and carries the guest cancellation link", () => {
  const outbox = buildPaygConfirmationOutboxPayload({
    orderId: INTENT_ID,
    recipientEmail: "ava@example.test",
    attendeeName: "Ava <Admin>",
    class: {
      classId: "class_1",
      title: "Conditioning <script>",
      startTime: "2026-09-10T18:00:00.000+01:00",
      endTime: "2026-09-10T19:00:00.000+01:00",
      timezone: "Europe/London",
      location: "Unit 3 & Studio",
    },
    amountPence: 700,
    currency: "gbp",
    publicOrigin: "https://alpha-wod.vercel.app",
    cancellationToken: "signed.token",
    cancellationCutoffAtMillis: Date.parse("2026-09-09T17:00:00.000Z"),
  });
  const email = buildPaygConfirmationEmail(
    outbox,
    "Zero Alpha Fitness <hello@zeroalphafitness.co.uk>",
    "support@zeroalphafitness.co.uk"
  );
  assert.equal(email.subject, "Your PAYG class is confirmed — Conditioning <script>");
  assert.match(email.text, /Paid: £7\.00 GBP/);
  assert.match(email.text, /Cancel this booking: https:\/\/alpha-wod\.vercel\.app\/pay-as-you-go\/cancel\?token=signed\.token/);
  assert.match(email.html, /Ava &lt;Admin&gt;/);
  assert.match(email.html, /Conditioning &lt;script&gt;/);
  assert.match(email.html, /Unit 3 &amp; Studio/);
  assert.doesNotMatch(email.html, /<script>/);
  assert.equal(email.reply_to, "support@zeroalphafitness.co.uk");
  assert.throws(
    () => buildPaygConfirmationEmail(outbox, "hello@example.test\nBcc:x@y.test", "support@example.test"),
    /configured safely/i
  );
});

test("post-send correlation recovers only the exact tombstoned confirmation lease", () => {
  const leaseToken = "123e4567-e89b-12d3-a456-426614174000";
  const correlation = paygEmailLeaseCorrelation(leaseToken);
  assert.match(correlation, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(correlation, /123e4567/);
  assert.deepEqual(resolvePaygConfirmationPostSend({
    outboxStatus: "tombstoned",
    activeLeaseToken: null,
    tombstonedLeaseCorrelation: correlation,
    leaseToken,
    orderStatus: "refund_pending",
    correctionExists: false,
  }), {
    disposition: "accepted_after_state_change",
    enqueueCorrection: true,
  });
  assert.deepEqual(resolvePaygConfirmationPostSend({
    outboxStatus: "tombstoned",
    activeLeaseToken: null,
    tombstonedLeaseCorrelation: correlation,
    leaseToken,
    orderStatus: "refund_pending",
    correctionExists: true,
  }), {
    disposition: "accepted_after_state_change",
    enqueueCorrection: false,
  });
  assert.deepEqual(resolvePaygConfirmationPostSend({
    outboxStatus: "tombstoned",
    activeLeaseToken: null,
    tombstonedLeaseCorrelation: "0".repeat(64),
    leaseToken,
    orderStatus: "cancelled",
    correctionExists: false,
  }), {
    disposition: "lost",
    enqueueCorrection: false,
  });
  assert.deepEqual(resolvePaygConfirmationPostSend({
    outboxStatus: "sending",
    activeLeaseToken: leaseToken,
    tombstonedLeaseCorrelation: null,
    leaseToken,
    orderStatus: "confirmed",
    correctionExists: false,
  }), {
    disposition: "sent",
    enqueueCorrection: false,
  });
  assert.deepEqual(resolvePaygConfirmationPostSend({
    outboxStatus: "reconciling",
    activeLeaseToken: leaseToken,
    tombstonedLeaseCorrelation: correlation,
    leaseToken,
    orderStatus: "manual_review",
    correctionExists: false,
  }), {
    disposition: "accepted_after_state_change",
    enqueueCorrection: true,
  });
  assert.equal(shouldRecoverPaygConfirmationAcceptance({
    kind: "payg_guest_confirmation",
    status: "tombstoned",
    providerAcceptanceState: "unknown_in_flight",
    tombstonedLeaseCorrelation: correlation,
  }), true);
  assert.equal(shouldRecoverPaygConfirmationAcceptance({
    kind: "payg_guest_confirmation_correction",
    status: "tombstoned",
    providerAcceptanceState: "unknown_in_flight",
    tombstonedLeaseCorrelation: correlation,
  }), false, "a correction delivery must never recursively create another correction");
  assert.equal(shouldRecoverPaygConfirmationAcceptance({
    kind: "payg_guest_confirmation",
    status: "tombstoned",
    providerAcceptanceState: "accepted_after_state_change",
    tombstonedLeaseCorrelation: correlation,
  }), false, "a durably accepted attempt must not replay");
  assert.equal(
    resolvePaygConfirmationPostSend({
      outboxStatus: "tombstoned",
      activeLeaseToken: null,
      tombstonedLeaseCorrelation: correlation,
      leaseToken,
      orderStatus: "attended",
      correctionExists: false,
    }).enqueueCorrection,
    false,
    "a completed class must not receive a false cancellation/refund correction"
  );
});

test("ambiguous Resend failure after cancellation keeps the exact delivery recoverable", () => {
  for (const httpStatus of [null, 408, 429, 500, 503]) {
    assert.equal(resolvePaygEmailFailureAfterStateChange({
      ownsTombstonedLease: true,
      reconcileAfterStateChange: false,
      httpStatus,
      providerErrorName: null,
    }), "reconcile_unknown");
  }
  assert.equal(resolvePaygEmailFailureAfterStateChange({
    ownsTombstonedLease: true,
    reconcileAfterStateChange: false,
    httpStatus: 422,
    providerErrorName: "validation_error",
  }), "definitive_rejection");
  assert.equal(resolvePaygEmailFailureAfterStateChange({
    ownsTombstonedLease: false,
    reconcileAfterStateChange: false,
    httpStatus: null,
    providerErrorName: null,
  }), "normal");

  const leaseToken = "lease-before-cancellation";
  const correlation = paygEmailLeaseCorrelation(leaseToken);
  for (const httpStatus of [null, 408, 429, 500]) {
    assert.equal(isPaygEmailFailureAmbiguous(httpStatus, null), true);
  }
  assert.equal(isPaygEmailFailureAmbiguous(422, "validation_error"), false);
  assert.equal(resolvePaygTombstoneLeaseCorrelation({
    status: "pending",
    leaseToken: null,
    providerAcceptanceState: "unknown_in_flight",
    ambiguousLeaseCorrelation: correlation,
  }), correlation, "failure-before-cancellation must retain replay correlation");
  assert.equal(resolvePaygTombstoneLeaseCorrelation({
    status: "sending",
    leaseToken,
    providerAcceptanceState: null,
    ambiguousLeaseCorrelation: null,
  }), correlation, "cancellation-before-failure must retain the active lease");
});

test("confirmation correction is one deterministic idempotent outbox message", () => {
  const classSnapshot = {
    classId: "class_1",
    title: "Conditioning <script>",
    startTime: "2026-09-10T18:00:00.000+01:00",
    endTime: "2026-09-10T19:00:00.000+01:00",
    timezone: "Europe/London",
    location: "Unit 3 & Studio",
  };
  const payload = buildPaygConfirmationCorrectionOutboxPayload({
    orderId: INTENT_ID,
    recipientEmail: "ava@example.test",
    attendeeName: "Ava <Admin>",
    class: classSnapshot,
    orderStatus: "refund_pending",
  });
  assert.equal(payload.outboxId, paygConfirmationCorrectionOutboxId(INTENT_ID));
  assert.equal(
    payload.idempotencyKey,
    `payg-confirmation-correction/${INTENT_ID}/v1`
  );
  assert.notEqual(payload.outboxId, INTENT_ID);
  assert.equal(payload.templateData.amountPence, 700);
  assert.equal(payload.templateData.currency, "gbp");
  assert.equal(Object.isFrozen(payload), true);
  const duplicate = buildPaygConfirmationCorrectionOutboxPayload({
    orderId: INTENT_ID,
    recipientEmail: "ava@example.test",
    attendeeName: "Ava <Admin>",
    class: classSnapshot,
    orderStatus: "refund_pending",
  });
  assert.deepEqual(duplicate, payload);

  const email = buildPaygConfirmationCorrectionEmail(
    payload,
    "Zero Alpha Fitness <hello@zeroalphafitness.co.uk>",
    "support@zeroalphafitness.co.uk"
  );
  assert.match(email.subject, /Important update/);
  assert.match(email.text, /£7\.00 GBP payment or refund status may still be updating/i);
  assert.match(email.text, /if a refund is due/i);
  assert.doesNotMatch(email.text, /refund is being processed|has been refunded/i);
  assert.match(email.text, /instead of the earlier confirmation/i);
  assert.match(email.html, /Ava &lt;Admin&gt;/);
  assert.match(email.html, /Conditioning &lt;script&gt;/);
  assert.doesNotMatch(email.html, /<script>/);

  for (const status of [
    "cancelled",
    "refund_pending",
    "refunded",
    "disputed",
    "manual_review",
    "no_show",
  ]) {
    assert.equal(shouldEnqueuePaygConfirmationCorrection(status), true, status);
  }
  assert.equal(shouldEnqueuePaygConfirmationCorrection("confirmed"), false);
  assert.equal(shouldEnqueuePaygConfirmationCorrection("attended"), false);
});

test("anonymous checkout admission keys are secret pseudonyms with no raw source or contact", () => {
  const secret = "payg-abuse-test-secret-that-is-at-least-thirty-two-bytes";
  const now = Date.parse("2026-09-01T10:00:30.000Z");
  const fingerprint = "ava@example.test:+447700900123:class_1";
  const first = derivePaygAbuseKeys(
    secret,
    "::ffff:203.0.113.42",
    ATTEMPT_ID,
    fingerprint,
    now
  );
  const canonicalRetry = derivePaygAbuseKeys(
    secret,
    "203.0.113.42:443",
    ATTEMPT_ID,
    fingerprint,
    now + 1_000
  );
  assert.equal(canonicalizePaygSourceAddress("::ffff:203.0.113.42"), "203.0.113.42");
  assert.equal(first.sourcePseudonym, canonicalRetry.sourcePseudonym);
  assert.equal(first.attemptId, canonicalRetry.attemptId);
  assert.equal(first.requestBinding, canonicalRetry.requestBinding);
  assert.equal(first.minuteBucketId, canonicalRetry.minuteBucketId);
  assert.match(first.sourcePseudonym, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(first), /203\.0\.113\.42|ava@example|447700900123/);
  assert.notEqual(
    first.hourBucketId,
    derivePaygAbuseKeys(
      secret,
      "203.0.113.43",
      ATTEMPT_ID,
      fingerprint,
      now
    ).hourBucketId
  );
  assert.notEqual(
    first.attemptId,
    derivePaygAbuseKeys(
      secret,
      "203.0.113.42",
      `${ATTEMPT_ID}_other`,
      fingerprint,
      now
    ).attemptId
  );
});

test("same-binding retries are atomically bounded while allowing ambiguous-failure recovery", () => {
  const start = Date.parse("2026-09-01T10:00:00.000Z");
  assert.deepEqual(PAYG_IDEMPOTENT_RETRY_POLICY, {
    maxRetriesPerWindow: 5,
    windowMs: 10 * 60 * 1000,
    minimumSpacingMs: 1000,
  });
  assert.deepEqual(resolvePaygIdempotentRetryAdmission({
    currentRetryCount: 0,
    windowStartedAtMillis: start,
    lastAttemptAtMillis: start,
    nowMillis: start + 500,
  }), {
    allowed: false,
    reason: "too_soon",
    retryCount: 0,
    windowStartedAtMillis: start,
  });

  let retryCount = 0;
  for (let retry = 1; retry <= 5; retry += 1) {
    const decision = resolvePaygIdempotentRetryAdmission({
      currentRetryCount: retryCount,
      windowStartedAtMillis: start,
      lastAttemptAtMillis: start + (retry - 1) * 2_000,
      nowMillis: start + retry * 2_000,
    });
    assert.equal(decision.allowed, true, `retry ${retry}`);
    retryCount = decision.retryCount;
  }
  assert.deepEqual(resolvePaygIdempotentRetryAdmission({
    currentRetryCount: retryCount,
    windowStartedAtMillis: start,
    lastAttemptAtMillis: start + 10_000,
    nowMillis: start + 12_000,
  }), {
    allowed: false,
    reason: "window_exhausted",
    retryCount: 5,
    windowStartedAtMillis: start,
  });
  assert.deepEqual(resolvePaygIdempotentRetryAdmission({
    currentRetryCount: retryCount,
    windowStartedAtMillis: start,
    lastAttemptAtMillis: start + 10_000,
    nowMillis: start + PAYG_IDEMPOTENT_RETRY_POLICY.windowMs,
  }), {
    allowed: true,
    reason: "allowed",
    retryCount: 1,
    windowStartedAtMillis: start + PAYG_IDEMPOTENT_RETRY_POLICY.windowMs,
  });
  assert.equal(resolvePaygIdempotentRetryAdmission({
    currentRetryCount: "5",
    windowStartedAtMillis: start,
    lastAttemptAtMillis: start,
    nowMillis: start + 2_000,
  }).reason, "invalid_state");
});

test("source admission groups IPv6 privacy addresses by /64 and preserves IPv4 identity", () => {
  const canonicalPrefix = canonicalizePaygSourceAddress(
    "[2001:db8:abcd:12::1]:443"
  );
  assert.equal(
    canonicalPrefix,
    "2001:0db8:abcd:0012::/64"
  );
  assert.equal(
    canonicalizePaygSourceAddress(canonicalPrefix),
    canonicalPrefix,
    "normalization must remain stable when the request adapter and HMAC layer both apply it"
  );
  assert.equal(
    canonicalizePaygSourceAddress("2001:0db8:abcd:0012:ffff:aaaa:bbbb:cccc"),
    "2001:0db8:abcd:0012::/64"
  );
  assert.notEqual(
    canonicalizePaygSourceAddress("2001:db8:abcd:12::1"),
    canonicalizePaygSourceAddress("2001:db8:abcd:13::1")
  );
  assert.equal(canonicalizePaygSourceAddress("203.0.113.42:443"), "203.0.113.42");
  assert.equal(canonicalizePaygSourceAddress("::ffff:203.0.113.42"), "203.0.113.42");
  assert.equal(canonicalizePaygSourceAddress("::ffff:cb00:712a"), "203.0.113.42");

  const secret = "payg-ipv6-test-secret-that-is-at-least-thirty-two-bytes";
  const first = derivePaygAbuseKeys(
    secret,
    "2001:db8:abcd:12::1",
    ATTEMPT_ID,
    "fingerprint",
    Date.parse("2026-09-01T10:00:00Z")
  );
  const rotated = derivePaygAbuseKeys(
    secret,
    "2001:db8:abcd:12:ffff:aaaa:bbbb:cccc",
    `${ATTEMPT_ID}_rotated`,
    "other-fingerprint",
    Date.parse("2026-09-01T10:00:30Z")
  );
  assert.equal(first.sourcePseudonym, rotated.sourcePseudonym);
  assert.equal(first.minuteBucketId, rotated.minuteBucketId);
});

test("class unpaid-hold breaker leaves capacity for paid or operational bookings", () => {
  assert.equal(PAYG_MAX_CONCURRENT_UNPAID_HOLDS_PER_CLASS, 4);
  assert.deepEqual(
    [0, 1, 2, 3, 4, 8, 12, 100].map(resolvePaygUnpaidHoldLimit),
    [0, 1, 1, 1, 2, 4, 4, 4]
  );
  for (const capacity of [2, 3, 4, 8, 12, 100]) {
    assert.ok(resolvePaygUnpaidHoldLimit(capacity) < capacity);
  }
  assert.equal(resolvePaygUnpaidHoldLimit(2.5), 0);
  assert.equal(resolvePaygUnpaidHoldLimit(Number.NaN), 0);
});

test("duplicate class-attendee locks are deterministic, scoped, and identity opaque", () => {
  const secret = "payg-lock-test-secret-that-is-at-least-thirty-two-bytes";
  const first = derivePaygDuplicateLockId(
    secret,
    "class_1",
    "  Ava   RHYS Thomas ",
    "1995-03-02"
  );
  const normalized = derivePaygDuplicateLockId(
    secret,
    "class_1",
    "ava rhys thomas",
    "1995-03-02"
  );
  assert.equal(first, normalized);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(first, /ava|1995|class/i);
  assert.notEqual(
    first,
    derivePaygDuplicateLockId(secret, "class_2", "ava rhys thomas", "1995-03-02")
  );
  assert.notEqual(
    first,
    derivePaygDuplicateLockId(secret, "class_1", "ava rhys thomas", "1995-03-03")
  );
  const rotated = derivePaygDuplicateLockCandidates([
    {kid: "lock-v2", secret: `${secret}-new-current`},
    {kid: "lock-v1", secret},
  ], "class_1", "Ava RHYS Thomas", "1995-03-02");
  assert.equal(rotated.length, 2);
  assert.equal(rotated[0].kid, "lock-v2");
  assert.equal(rotated[1].kid, "lock-v1");
  assert.equal(rotated[1].lockId, first);
  assert.notEqual(rotated[0].lockId, rotated[1].lockId);
  assert.equal(isPaygDuplicateLockKeyringConfigured([
    {kid: "lock-v2", secret: `${secret}-new-current`},
    {kid: "lock-v1", secret},
  ]), true);
  assert.equal(isPaygDuplicateLockKeyringConfigured([
    {kid: "lock-v1", secret: "too-short"},
  ]), false);
  assert.throws(
    () => derivePaygDuplicateLockCandidates([
      {kid: "lock-v1", secret},
      {kid: "lock-v1", secret: `${secret}-other`},
    ], "class_1", "Ava RHYS Thomas", "1995-03-02"),
    /keyring is invalid/i
  );
});

test("refund lifecycle converges every provider terminal state without erasing precedence", () => {
  assert.deepEqual(resolvePaygRefundState("confirmed", "pending"), {
    orderStatus: "refund_pending",
    scheduleRecovery: true,
    terminal: false,
  });
  assert.deepEqual(resolvePaygRefundState("refund_pending", "succeeded"), {
    orderStatus: "refunded",
    scheduleRecovery: false,
    terminal: true,
  });
  for (const status of ["failed", "canceled"]) {
    assert.deepEqual(resolvePaygRefundState("refund_pending", status), {
      orderStatus: "manual_review",
      scheduleRecovery: false,
      terminal: true,
    });
  }
  assert.equal(resolvePaygRefundState("disputed", "succeeded").orderStatus, "disputed");
  assert.equal(
    resolvePaygRefundState("manual_review", "succeeded").orderStatus,
    "manual_review"
  );
  assert.equal(resolvePaygRefundState("disputed", "pending").scheduleRecovery, true);
  assert.deepEqual(resolvePaygRefundState("refunded", "pending"), {
    orderStatus: "refunded",
    scheduleRecovery: false,
    terminal: true,
  });
  assert.equal(
    resolvePaygLinkedReviewRefundStatus("refund_pending", "succeeded", true),
    "refunded"
  );
  assert.equal(
    resolvePaygLinkedReviewRefundStatus("refund_pending", "failed", true),
    "manual_review"
  );
  assert.equal(
    resolvePaygLinkedReviewRefundStatus("disputed", "succeeded", true),
    "disputed"
  );
  assert.equal(
    resolvePaygLinkedReviewRefundStatus("refund_pending", "pending", false),
    "manual_review"
  );
  assert.equal(publicPaygPaymentReviewState("refund_pending", "pending"), "refund_pending");
  assert.equal(publicPaygPaymentReviewState("refund_pending", "succeeded"), "refunded");
  assert.equal(publicPaygPaymentReviewState("manual_review", "failed"), "disputed");
});

test("pending refund webhooks bind crash-window IDs and reject conflicting refunds", () => {
  const base = {
    ownerStatus: "refund_pending",
    incomingRefundId: "re_provider_1",
    disputeOpen: false,
    refundAutomationStatus: null,
  };
  assert.equal(resolvePaygPendingRefundBinding({
    ...base,
    storedRefundId: null,
  }), "bind_and_recover");
  assert.equal(resolvePaygPendingRefundBinding({
    ...base,
    storedRefundId: "re_provider_1",
  }), "recover_bound");
  assert.equal(resolvePaygPendingRefundBinding({
    ...base,
    storedRefundId: "re_other",
  }), "conflict_manual_review");
  assert.equal(resolvePaygPendingRefundBinding({
    ...base,
    storedRefundId: null,
    disputeOpen: true,
  }), "not_recoverable");
  assert.equal(resolvePaygPendingRefundBinding({
    ...base,
    storedRefundId: null,
    refundAutomationStatus: "suspended_dispute",
  }), "not_recoverable");
});

test("succeeded refund evidence is monotonic across out-of-order provider events", () => {
  for (const incomingRefundStatus of ["pending", "failed", "canceled"]) {
    assert.equal(shouldPreservePaygSucceededRefund({
      ownerStatus: "refunded",
      storedRefundId: "re_provider_1",
      storedRefundStatus: "succeeded",
      incomingRefundId: "re_provider_1",
      incomingRefundStatus,
    }), true);
  }
  assert.equal(shouldPreservePaygSucceededRefund({
    ownerStatus: "refund_pending",
    storedRefundId: "re_provider_1",
    storedRefundStatus: "pending",
    incomingRefundId: "re_provider_1",
    incomingRefundStatus: "succeeded",
  }), false);
  assert.equal(shouldPreservePaygSucceededRefund({
    ownerStatus: "refunded",
    storedRefundId: "re_provider_1",
    storedRefundStatus: "succeeded",
    incomingRefundId: "re_other",
    incomingRefundStatus: "pending",
  }), false, "a different refund ID must take the conflict/manual-review path");
  assert.equal(shouldPreservePaygSucceededRefund({
    ownerStatus: "refunded",
    storedRefundId: null,
    storedRefundStatus: "succeeded",
    incomingRefundId: "re_provider_1",
    incomingRefundStatus: "pending",
    exactProviderBinding: true,
  }), true, "charge-success-first evidence binds a later exact pending refund ID");
  assert.equal(shouldPreservePaygSucceededRefund({
    ownerStatus: "refunded",
    storedRefundId: null,
    storedRefundStatus: "succeeded",
    incomingRefundId: "re_provider_1",
    incomingRefundStatus: "pending",
    exactProviderBinding: false,
  }), false);
  assert.equal(
    resolvePaygLinkedReviewRefundStatus("refunded", "pending", true),
    "refunded"
  );
  assert.equal(hasPaygSucceededRefundEvidence("refunded", "pending"), true);
  assert.equal(hasPaygSucceededRefundEvidence("manual_review", "succeeded"), true);
  assert.equal(hasPaygSucceededRefundEvidence("refund_pending", "pending"), false);
});

test("terminal dispute evidence is monotonic across out-of-order events", () => {
  const expectedLifecycle = new Map([
    ["warning_needs_response", "open"],
    ["warning_under_review", "open"],
    ["needs_response", "open"],
    ["under_review", "open"],
    ["won", "won"],
    ["lost", "lost"],
    ["warning_closed", "closed_without_chargeback"],
    ["prevented", "closed_without_chargeback"],
  ]);
  for (const [status, lifecycle] of expectedLifecycle) {
    assert.equal(classifyPaygDisputeStatus(status), lifecycle);
    assert.equal(
      isPaygTerminalDisputeStatus(status),
      lifecycle !== "open"
    );
  }
  assert.equal(classifyPaygDisputeStatus("future_status"), "unknown");
  assert.equal(isPaygTerminalDisputeStatus("future_status"), false);
  assert.equal(resolvePaygDisputeOwnerStatus(
    "disputed",
    true,
    "warning_closed"
  ), "manual_review");
  assert.equal(resolvePaygDisputeOwnerStatus(
    "disputed",
    true,
    "prevented"
  ), "manual_review");
  assert.equal(resolvePaygDisputeOwnerStatus(
    "disputed",
    true,
    "lost"
  ), "disputed");
  assert.equal(resolvePaygDisputeOwnerStatus(
    "disputed",
    true,
    "future_status"
  ), "manual_review");
  assert.equal(resolvePaygDisputeObservation({
    storedDisputeId: "dp_1",
    storedDisputeStatus: "won",
    incomingDisputeId: "dp_1",
    incomingDisputeStatus: "under_review",
  }), "preserve_terminal");
  assert.equal(resolvePaygDisputeObservation({
    storedDisputeId: "dp_1",
    storedDisputeStatus: "lost",
    incomingDisputeId: "dp_1",
    incomingDisputeStatus: "needs_response",
  }), "preserve_terminal");
  assert.equal(resolvePaygDisputeObservation({
    storedDisputeId: "dp_1",
    storedDisputeStatus: "warning_closed",
    incomingDisputeId: "dp_1",
    incomingDisputeStatus: "warning_under_review",
  }), "preserve_terminal");
  assert.equal(resolvePaygDisputeObservation({
    storedDisputeId: "dp_1",
    storedDisputeStatus: "prevented",
    incomingDisputeId: "dp_1",
    incomingDisputeStatus: "needs_response",
  }), "preserve_terminal");
  assert.equal(resolvePaygDisputeObservation({
    storedDisputeId: "dp_1",
    storedDisputeStatus: "won",
    incomingDisputeId: "dp_2",
    incomingDisputeStatus: "under_review",
  }), "conflict_manual_review");
  assert.equal(resolvePaygDisputeObservation({
    storedDisputeId: "dp_1",
    storedDisputeStatus: "under_review",
    incomingDisputeId: "dp_1",
    incomingDisputeStatus: "won",
  }), "apply");
});

test("refund-safe payment reviews persist in the state required by recovery", () => {
  assert.deepEqual(resolvePaygPaymentReviewDisposition(true, 700), {
    status: "refund_pending",
    issueRefund: true,
    scheduleRecovery: true,
  });
  for (const [automaticRefundSafe, amountReceivedPence] of [
    [false, 700],
    [true, 0],
    [true, null],
    [true, 7.5],
  ]) {
    assert.deepEqual(
      resolvePaygPaymentReviewDisposition(
        automaticRefundSafe,
        amountReceivedPence
      ),
      {
        status: "manual_review",
        issueRefund: false,
        scheduleRecovery: false,
      }
    );
  }
  assert.deepEqual(resolvePaygCanonicalOrderReviewDisposition({
    canonicalPaymentIntentId: "pi_canonical",
    observedPaymentIntentId: "pi_extra",
    automaticRefundSafe: true,
    amountReceivedPence: 700,
  }), {
    canonicalServicePreserved: true,
    extraPayment: true,
    status: "refund_pending",
    issueRefund: true,
    scheduleRecovery: true,
  });
  assert.deepEqual(resolvePaygCanonicalOrderReviewDisposition({
    canonicalPaymentIntentId: "pi_canonical",
    observedPaymentIntentId: "pi_canonical",
    automaticRefundSafe: true,
    amountReceivedPence: 700,
  }), {
    canonicalServicePreserved: true,
    extraPayment: false,
    status: "manual_review",
    issueRefund: false,
    scheduleRecovery: false,
  }, "the canonical service payment must never be auto-refunded as a replay");
});

function exactPaidSession(overrides = {}) {
  const metadata = {
    purchaseKind: PAYG_PURCHASE_KIND,
    offeringKey: PAYG_OFFERING_KEY,
    paygIntentId: INTENT_ID,
    classId: "class_1",
    schemaVersion: "1",
  };
  return {
    id: "cs_test_payg_contract",
    livemode: false,
    mode: "payment",
    client_reference_id: INTENT_ID,
    metadata,
    status: "complete",
    payment_status: "paid",
    amount_total: 700,
    currency: "gbp",
    total_details: {amount_discount: 0},
    subscription: null,
    customer_details: {email: "ava@example.test"},
    customer_email: "ava@example.test",
    ...overrides,
  };
}

function exactPaidPaymentIntent(overrides = {}) {
  return {
    id: "pi_test_payg_contract",
    livemode: false,
    status: "succeeded",
    amount: 700,
    amount_received: 700,
    currency: "gbp",
    metadata: {
      purchaseKind: PAYG_PURCHASE_KIND,
      offeringKey: PAYG_OFFERING_KEY,
      paygIntentId: INTENT_ID,
      classId: "class_1",
      schemaVersion: "1",
    },
    ...overrides,
  };
}

function paidMismatches(session, paymentIntent, exactLineItem = true) {
  return collectPaygPaidContractMismatches({
    session,
    paymentIntent,
    intentId: INTENT_ID,
    expectedClassId: "class_1",
    expectedEmail: "ava@example.test",
    expectedPriceId: APPROVED_PAYG_STRIPE_CATALOGUE_IDS.test.priceId,
    expectedProductId: APPROVED_PAYG_STRIPE_CATALOGUE_IDS.test.productId,
    exactLineItem,
    expectedLivemode: false,
  });
}

test("paid contract mismatches are classified and only app-bound captures are refund-safe", () => {
  const session = exactPaidSession();
  const paymentIntent = exactPaidPaymentIntent();
  assert.deepEqual(paidMismatches(session, paymentIntent), []);
  assert.equal(isPaygPaymentRefundSafe(paymentIntent, INTENT_ID, false), true);

  assert.deepEqual(
    paidMismatches(exactPaidSession({
      customer_details: {email: "other@example.test"},
      customer_email: null,
    }), paymentIntent),
    ["session_email"]
  );
  assert.equal(
    isPaygPaymentRefundSafe({...paymentIntent, amount: 900, amount_received: 900}, INTENT_ID, false),
    true,
    "a captured amount mismatch is safe to fully refund only because app metadata is exact"
  );
  assert.match(
    paidMismatches(session, {...paymentIntent, amount: 900, amount_received: 900})[0],
    /payment_intent_commercial_contract/
  );
  assert.deepEqual(paidMismatches(session, paymentIntent, false), ["line_item_contract"]);
  assert.equal(
    isPaygPaymentRefundSafe({
      ...paymentIntent,
      metadata: {...paymentIntent.metadata, purchaseKind: "membership"},
    }, INTENT_ID, false),
    false
  );
  assert.equal(
    isPaygPaymentRefundSafe({...paymentIntent, livemode: true}, INTENT_ID, false),
    false
  );
});

test("PAYG session ownership survives malformed final metadata for durable review", () => {
  assert.equal(
    paygIntentIdFromCheckoutSession(exactPaidSession({
      metadata: {purchaseKind: "membership"},
    })),
    INTENT_ID
  );
  assert.equal(
    paygIntentIdFromCheckoutSession(exactPaidSession({
      metadata: {...exactPaidSession().metadata, paygIntentId: `payg_${"d".repeat(64)}`},
    })),
    INTENT_ID,
    "the immutable client reference wins over mutable Session metadata"
  );
  assert.equal(
    paygIntentIdFromCheckoutSession({metadata: null, client_reference_id: "membership_1"}),
    null
  );
});

test("confirmation delivery is allowed only while the order remains confirmed", () => {
  assert.equal(shouldSendPaygConfirmation("confirmed"), true);
  for (const status of [
    "cancelled",
    "refund_pending",
    "refunded",
    "disputed",
    "manual_review",
    "attended",
    "no_show",
  ]) {
    assert.equal(shouldSendPaygConfirmation(status), false, status);
  }
});

test("abuse, duplicate, review, and privacy storage contracts stay explicit", () => {
  assert.equal(PAYG_CHECKOUT_RATE_LIMIT_COLLECTION, "paygCheckoutRateLimits");
  assert.equal(PAYG_CHECKOUT_ADMISSION_COLLECTION, "paygCheckoutAdmissions");
  assert.equal(PAYG_DUPLICATE_LOCK_COLLECTION, "paygCheckoutLocks");
  assert.equal(PAYG_PAYMENT_REVIEW_COLLECTION, "paygPaymentReviews");
  assert.deepEqual(PAYG_INTENT_PII_FIELDS, [
    "attendee",
    "contact",
    "acceptances",
    "requestFingerprint",
    "checkoutSessionUrl",
  ]);
  assert.equal(Object.isFrozen(PAYG_INTENT_PII_FIELDS), true);
  assert.deepEqual(PAYG_ORDER_PII_FIELDS, ["attendee", "contact", "acceptances"]);
  assert.deepEqual(PAYG_OUTBOX_PII_FIELDS, ["to", "templateData", "lastError"]);
  assert.deepEqual(PAYG_WAIVER_PII_FIELDS, ["attendee", "acceptances"]);
  assert.deepEqual(PAYG_BOOKING_PII_FIELDS, ["userName"]);
  for (const fields of [
    PAYG_ORDER_PII_FIELDS,
    PAYG_OUTBOX_PII_FIELDS,
    PAYG_WAIVER_PII_FIELDS,
    PAYG_BOOKING_PII_FIELDS,
  ]) {
    assert.equal(Object.isFrozen(fields), true);
  }
});
