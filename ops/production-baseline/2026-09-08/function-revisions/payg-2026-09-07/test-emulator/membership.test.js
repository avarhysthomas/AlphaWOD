/* eslint-disable @typescript-eslint/no-var-requires, max-len, require-jsdoc, valid-jsdoc */

/**
 * Billing handler/emulator coverage. These tests run selected real handlers
 * against Firestore/Auth emulators, with a fake Stripe API for network seams.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const admin = require("firebase-admin");
const Stripe = require("stripe");
const {createHash} = require("node:crypto");
const {
  createFakeStripe,
  membershipCommercialMetadata,
} = require("./fakeStripe");

const STRIPE_PORT = Number(process.env.MEMBERSHIP_TEST_STRIPE_PORT || 12111);
process.env.STRIPE_API_HOST = "127.0.0.1";
process.env.STRIPE_API_PORT = String(STRIPE_PORT);
process.env.STRIPE_API_PROTOCOL = "http";
process.env.STRIPE_SECRET_KEY = "sk_test_fake";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_fake";
process.env.STRIPE_EXPECTED_MODE = "test";
process.env.MEMBERSHIP_FIREBASE_PROJECT_ID = process.env.GCLOUD_PROJECT ||
  process.env.GOOGLE_CLOUD_PROJECT || "alpha-wod-functions-test";
process.env.FUNCTIONS_EMULATOR = "true";
process.env.RESEND_API_KEY = "re_test_fake";
process.env.APP_PUBLIC_ORIGIN = "https://alpha-wod.vercel.app";
process.env.MEMBERSHIP_PURCHASE_ENABLED = "true";
process.env.STRIPE_PORTAL_CONFIGURATION_ID = "bpc_fake";
process.env.STRIPE_PRICE_ADULT_UNLIMITED = "price_unlimited";
process.env.STRIPE_PRICE_ADULT_CONDITIONING = "price_conditioning";
process.env.STRIPE_PRICE_ADULT_LADIES = "price_ladies";
process.env.STRIPE_PRICE_ADULT_GYM = "price_gym";
process.env.STRIPE_PRICE_YOUTH_YOUNGSTARS = "price_youngstars";
process.env.STRIPE_PRICE_YOUTH_TEENSTARS = "price_teenstars";
process.env.STRIPE_EXISTING_MEMBER_COUPON_ID = "coupon_existing_member_5x3";
process.env.STRIPE_EXISTING_MEMBER_PROMOTION_CODE_ID =
  "promo_existing_member_shared";
process.env.STRIPE_YOUTH_FAMILY_COUPON_ID = "coupon_youth_family_15pct";

const functionsTest = require("firebase-functions-test")();
// firebase-functions-test installs its own synthetic runtime project id. Bind
// the billing guard to that exact id before importing the Functions module.
process.env.MEMBERSHIP_FIREBASE_PROJECT_ID = process.env.GCLOUD_PROJECT ||
  process.env.GOOGLE_CLOUD_PROJECT || "alpha-wod-functions-test";
const functions = require("../lib/index");
const {__testing: membershipTesting} = require("../lib/membership");
const {
  checkoutRecoveryIdempotencyKey,
  checkoutRecoveryOutboxId,
} = require("../lib/membershipCheckoutRecovery");
const {
  PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
  PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS,
  MEMBERSHIP_SCHEMA_VERSION,
  createCommercialPlanSnapshot,
  resolveCheckoutAcceptanceStatements,
  resolveCheckoutDocuments,
  resolveCheckoutSignerRole,
  resolveCancellationOutcome,
  resolveCoolingOffEnd,
} = require("../lib/membershipPlans");

function checkoutAcceptanceSnapshot(planKey, signedName) {
  const statements = resolveCheckoutAcceptanceStatements(planKey);
  return {
    signedName,
    signerRole: resolveCheckoutSignerRole(planKey),
    documents: resolveCheckoutDocuments(planKey),
    statements,
    acceptedStatementIds: statements.map(({id}) => id),
    immediatePerformanceRequested: true,
  };
}

const projectId = process.env.GCLOUD_PROJECT || "alpha-wod-functions-test";
const db = admin.firestore();

const claimMembership = functionsTest.wrap(functions.claimMembership);
const createMembershipCheckoutSession = functionsTest.wrap(
  functions.createMembershipCheckoutSession
);
const createMembershipCheckoutSessionV2 = functionsTest.wrap(
  functions.createMembershipCheckoutSessionV2
);
const createCustomerPortalSession = functionsTest.wrap(
  functions.createCustomerPortalSession
);
const requestMembershipCancellation = functionsTest.wrap(functions.requestMembershipCancellation);
const getMyMemberships = functionsTest.wrap(functions.getMyMemberships);
const listMemberships = functionsTest.wrap(functions.listMemberships);
const linkMembershipParticipant = functionsTest.wrap(functions.linkMembershipParticipant);
const releaseAbandonedMembershipCheckout = functionsTest.wrap(
  functions.releaseAbandonedMembershipCheckout
);

let fakeStripe;

function checkoutVerifierForSession(sessionId) {
  return `claim:${sessionId}:0123456789abcdef`;
}

function request(data, uid) {
  const payload = data?.sessionId && data.checkoutAttemptId === undefined ? {
    ...data,
    checkoutAttemptId: checkoutVerifierForSession(data.sessionId),
  } : data;
  return {
    data: payload,
    ...(uid ? {auth: {uid, token: {auth_time: 1, firebase: {sign_in_provider: "password"}}}} : {}),
    rawRequest: {get: () => "phase-1-emulator-test"},
    acceptsStreaming: false,
  };
}

async function invokeStripeWebhook(payload, signature) {
  const response = {
    statusCode: 200,
    body: "",
    headers: {},
    listeners: {},
    on(name, listener) {
      this.listeners[name] = listener;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    getHeader(name) {
      return this.headers[name];
    },
    send(body) {
      this.body = String(body);
      if (this.listeners.finish) this.listeners.finish();
      return this;
    },
  };
  const req = {
    method: "POST",
    headers: {"stripe-signature": signature},
    rawBody: Buffer.from(payload),
    get(name) {
      return name.toLowerCase() === "stripe-signature" ? signature : undefined;
    },
  };
  await functions.stripeWebhook(req, response);
  return response;
}

/** Seeds the fake provider's authoritative object before sending its trigger. */
async function handleStripeEvent(event, converge = async () => undefined) {
  const object = event.data?.object;
  if ((event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded") && object?.id) {
    const existing = fakeStripe.state.checkoutSessions.get(object.id) ?? {};
    fakeStripe.state.checkoutSessions.set(object.id, {
      ...existing,
      ...object,
      metadata: membershipCommercialMetadata({
        ...(existing.metadata ?? {}),
        ...(object.metadata ?? {}),
      }),
    });
  }
  if (event.type === "invoice.paid" && object?.id) {
    const existing = fakeStripe.state.invoices.get(object.id) ?? {};
    fakeStripe.state.invoices.set(object.id, {...existing, ...object});
  }
  return membershipTesting.handleStripeEvent(event, converge);
}

async function clearEmulators() {
  const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  assert.ok(firestoreHost, "FIRESTORE_EMULATOR_HOST is required");
  assert.ok(authHost, "FIREBASE_AUTH_EMULATOR_HOST is required");
  await fetch(
    `http://${firestoreHost}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    {method: "DELETE"}
  );
  await fetch(`http://${authHost}/emulator/v1/projects/${projectId}/accounts`, {method: "DELETE"});
}

async function createMember(uid, {email = `${uid}@example.test`, emailVerified = true, profile = {}} = {}) {
  await admin.auth().createUser({uid, email, emailVerified});
  await db.collection("users").doc(uid).set({
    role: "user",
    approvalStatus: "pending",
    entitlementStatus: "none",
    entitlementSource: "none",
    alphaWodAccess: false,
    email,
    ...profile,
  });
  return uid;
}

/** Writes a fulfilled membership the way the webhook would leave it. */
async function seedMembership(subscriptionId, overrides = {}) {
  const checkoutSessionId = overrides.checkoutSessionId ?? `cs_${subscriptionId}`;
  const planKey = overrides.planKey ?? "adult_unlimited";
  const commercialTerms = overrides.commercialTerms ??
    createCommercialPlanSnapshot(planKey);
  const selectedConditioningSlots = overrides.selectedConditioningSlots ??
    commercialTerms.selectedConditioningSlots;
  const stripePriceId = overrides.stripePriceId ?? {
    adult_unlimited: "price_unlimited",
    adult_conditioning: "price_conditioning",
    adult_ladies: "price_ladies",
    adult_gym: "price_gym",
    youth_youngstars: "price_youngstars",
    youth_teenstars: "price_teenstars",
  }[planKey];
  const doc = {
    schemaVersion: commercialTerms.catalogueSchemaVersion,
    subscriptionId,
    stripeCustomerId: "cus_fake_1",
    checkoutSessionId,
    checkoutAttemptHash: createHash("sha256")
      .update(`membership-checkout:${checkoutVerifierForSession(checkoutSessionId)}`)
      .digest("hex"),
    payerUid: null,
    payerEmail: "buyer@example.test",
    fulfilledAt: admin.firestore.Timestamp.now(),
    claimedAt: null,
    planKey,
    stripePriceId,
    commercialTerms,
    ...(selectedConditioningSlots ? {selectedConditioningSlots} : {}),
    planName: commercialTerms.planName,
    grantsAlphaWodAccess: commercialTerms.grantsAlphaWodAccess,
    participant: {
      fullName: "Buyer One",
      dateOfBirth: "1990-01-01",
      age: 36,
      isPayer: true,
      participantKey: `key_${subscriptionId}`,
    },
    guardian: null,
    acceptances: {
      ...checkoutAcceptanceSnapshot(planKey, "Buyer One"),
      contractMadeAt: admin.firestore.Timestamp.fromDate(
        new Date("2026-01-01T12:00:00Z")
      ),
      coolingOffEndsAt: "2026-01-15T23:59:59.999Z",
      acceptedAt: admin.firestore.Timestamp.now(),
      userAgent: "test",
    },
    state: "active",
    stripeStatus: "active",
    entitlementTargetUid: null,
    preMembershipEntitlement: null,
    currentPeriodEnd: 1788220800,
    billingCycleAnchor: 1788220800,
    pastDueSince: null,
    pastDueGraceEndsAt: null,
    nextReconcileAt: null,
    openDisputeIds: [],
    disputeOpen: false,
    accessRevoked: false,
    providerContractStatus: "verified",
    cancelAt: null,
    cancellationRequestedAt: null,
    cancellationOutcome: null,
    confirmationEmailSentAt: admin.firestore.Timestamp.now(),
    ...overrides,
  };
  await db.collection("memberships").doc(subscriptionId).set(doc);
  fakeStripe.setSubscription(subscriptionId, {
    customer: doc.stripeCustomerId,
    billing_cycle_anchor: doc.billingCycleAnchor,
    metadata: {
      planKey: doc.planKey,
      appAccessTier: doc.commercialTerms.appAccessTier,
      ...(doc.planKey === "adult_conditioning" &&
        doc.commercialTerms.conditioningBookingPolicy ? {
          conditioningPolicyVersion: String(
            doc.commercialTerms.conditioningBookingPolicy.version
          ),
          conditioningWeeklyLimit: String(
            doc.commercialTerms.conditioningBookingPolicy.weeklyBookingLimit
          ),
          conditioningEligibleSlots:
            doc.commercialTerms.conditioningBookingPolicy.eligibleSlotKeys.join(","),
        } : doc.planKey === "adult_conditioning" ? {
          conditioningSlots: doc.selectedConditioningSlots.join(","),
        } : {}),
    },
    items: {
      object: "list",
      data: [{
        id: `si_${subscriptionId}`,
        current_period_end: doc.currentPeriodEnd,
        price: doc.stripePriceId,
        quantity: 1,
      }],
    },
  });
  return doc;
}

function reservationIntent(id, overrides = {}) {
  const now = Date.now();
  const billingCycleAnchor = overrides.billingCycleAnchor ??
    Math.floor(now / 1000) + 7200;
  const payerUid = overrides.payerUid ?? null;
  const planKey = overrides.planKey ?? "adult_unlimited";
  const stripePriceId = overrides.stripePriceId ?? {
    adult_unlimited: "price_unlimited",
    adult_conditioning: "price_conditioning",
    adult_ladies: "price_ladies",
    adult_gym: "price_gym",
    youth_youngstars: "price_youngstars",
    youth_teenstars: "price_teenstars",
  }[planKey];
  const participantKey = overrides.participantKey ?? `participant_${id}`;
  const selectedConditioningSlots = overrides.selectedConditioningSlots;
  const reservationLockIds = membershipTesting.checkoutLockSpecs(
    payerUid,
    planKey,
    participantKey
  ).map((spec) => spec.id);
  return {
    schemaVersion: MEMBERSHIP_SCHEMA_VERSION,
    checkoutAttemptHash: `attempt_hash_${id}`,
    requestFingerprint: overrides.requestFingerprint ?? `fingerprint_${id}`,
    payerUid,
    payerEmail: payerUid ? `${payerUid}@example.test` : null,
    planKey,
    stripeMode: "test",
    stripePriceId,
    commercialTerms: createCommercialPlanSnapshot(planKey),
    ...(selectedConditioningSlots ? {selectedConditioningSlots} : {}),
    participant: {
      fullName: overrides.participantName ?? "Reserved Athlete",
      dateOfBirth: "1990-01-01",
      age: 36,
      isPayer: true,
      participantKey,
    },
    guardian: null,
    acceptances: {
      ...checkoutAcceptanceSnapshot(planKey, "Reserved Athlete"),
      acceptedAt: admin.firestore.Timestamp.now(),
      userAgent: "test",
    },
    checkoutSessionId: null,
    checkoutSessionUrl: null,
    status: "reserved",
    billingMode: overrides.billingMode ?? "standard",
    billingCycleAnchor,
    serviceStartsAt: overrides.serviceStartsAt ?? Math.floor(now / 1000),
    firstPaymentAt: overrides.firstPaymentAt ?? billingCycleAnchor,
    initialChargePence: overrides.initialChargePence ?? null,
    prorationBehavior: overrides.prorationBehavior ?? "create_prorations",
    promotionCodeId: overrides.promotionCodeId ?? null,
    firstFullChargeDate: "2026-09-01",
    checkoutExpiresAt: Math.floor(now / 1000) + 3600,
    reservationExpiresAt: overrides.reservationExpiresAt ??
      admin.firestore.Timestamp.fromMillis(now + 2 * 3600 * 1000),
    reservationLockIds,
    createdAt: admin.firestore.Timestamp.now(),
  };
}

function presaleIntent(id, overrides = {}) {
  return reservationIntent(id, {
    ...overrides,
    billingMode: "presale_deferred",
    billingCycleAnchor: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
    serviceStartsAt: PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS,
    firstPaymentAt: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
    initialChargePence: 0,
    prorationBehavior: "none",
    promotionCodeId: overrides.promotionCodeId ?? null,
  });
}

async function accessOf(uid) {
  const snap = await db.collection("users").doc(uid).get();
  const user = snap.data();
  return {
    approvalStatus: user.approvalStatus,
    entitlementStatus: user.entitlementStatus,
    entitlementSource: user.entitlementSource,
    alphaWodAccess: user.alphaWodAccess,
  };
}

async function waitForConvergenceLease(subscriptionId, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snapshot = await db.collection("memberships").doc(subscriptionId).get();
    const token = snapshot.get("convergenceLeaseToken");
    const expiresAt = snapshot.get("convergenceLeaseExpiresAt");
    if (typeof token === "string" && expiresAt) return {token, expiresAt};
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${subscriptionId} convergence lease.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test.before(async () => {
  fakeStripe = createFakeStripe();
  await fakeStripe.listen(STRIPE_PORT);
});

test.after(async () => {
  await fakeStripe.close();
});

test.beforeEach(clearEmulators);

function validCheckoutData(attemptId = "attempt_checkout_test_123456") {
  return {
    checkoutAttemptId: attemptId,
    checkoutSchemaVersion: 6,
    expectedBillingMode: "presale_deferred",
    planKey: "adult_unlimited",
    participantFullName: "Checkout Athlete",
    participantDateOfBirth: "1990-01-01",
    participantIsPayer: true,
    signedName: "Checkout Athlete",
    acceptedStatementIds: resolveCheckoutAcceptanceStatements("adult_unlimited")
      .map(({id}) => id),
  };
}

function conditioningCheckoutData(
  attemptId = "attempt_conditioning_checkout_123456"
) {
  return {
    ...validCheckoutData(attemptId),
    planKey: "adult_conditioning",
    acceptedStatementIds: resolveCheckoutAcceptanceStatements(
      "adult_conditioning"
    ).map(({id}) => id),
  };
}

function youthCheckoutData({planKey, attemptId, children}) {
  const [participant, ...additionalParticipants] = children;
  return {
    ...validCheckoutData(attemptId),
    planKey,
    participantFullName: participant.fullName,
    participantDateOfBirth: participant.dateOfBirth,
    participantIsPayer: false,
    additionalParticipants,
    signedName: "Paying Adult",
    guardianFullName: "Paying Adult",
    guardianRelationship: "Parent",
    acceptedStatementIds: resolveCheckoutAcceptanceStatements(
      planKey,
      children.length
    ).map(({id}) => id),
  };
}

function legacyParticipantKeyFor(fullName, dateOfBirth) {
  return createHash("sha256")
    .update(`${fullName.trim().toLowerCase()}|${dateOfBirth}`)
    .digest("hex");
}

test("both deployed checkout exports require the version 6 request contract", async () => {
  const originalPurchaseEnabled = process.env.MEMBERSHIP_PURCHASE_ENABLED;
  const sessionsBefore = fakeStripe.state.checkoutSessions.size;
  process.env.MEMBERSHIP_PURCHASE_ENABLED = "false";
  try {
    for (const [handlerIndex, checkoutHandler] of [
      createMembershipCheckoutSession,
      createMembershipCheckoutSessionV2,
    ].entries()) {
      for (const checkoutSchemaVersion of [undefined, 1, 2, 3, 4, 5]) {
        const data = validCheckoutData(
          `attempt_schema_${handlerIndex}_${checkoutSchemaVersion ?? "missing"}`
        );
        if (checkoutSchemaVersion === undefined) delete data.checkoutSchemaVersion;
        else data.checkoutSchemaVersion = checkoutSchemaVersion;

        await assert.rejects(
          () => checkoutHandler(request(data)),
          /Refresh the membership page/i
        );
      }

      await assert.rejects(
        () => checkoutHandler(request(validCheckoutData(
          `attempt_schema_${handlerIndex}_current_contract`
        ))),
        /not enabled for this environment/i
      );
    }
    assert.equal(fakeStripe.state.checkoutSessions.size, sessionsBefore);
    assert.equal((await db.collection("membershipIntents").get()).size, 0);
    assert.equal((await db.collection("membershipCheckoutLocks").get()).size, 0);
  } finally {
    if (originalPurchaseEnabled === undefined) {
      delete process.env.MEMBERSHIP_PURCHASE_ENABLED;
    } else {
      process.env.MEMBERSHIP_PURCHASE_ENABLED = originalPurchaseEnabled;
    }
  }
});

test("the runtime gate stays closed in the isolated local test journey", async () => {
  const original = {
    MEMBERSHIP_PURCHASE_ENABLED: process.env.MEMBERSHIP_PURCHASE_ENABLED,
    MEMBERSHIP_TEST_JOURNEY_ENABLED: process.env.MEMBERSHIP_TEST_JOURNEY_ENABLED,
    APP_PUBLIC_ORIGIN: process.env.APP_PUBLIC_ORIGIN,
  };
  try {
    process.env.MEMBERSHIP_PURCHASE_ENABLED = "false";
    process.env.MEMBERSHIP_TEST_JOURNEY_ENABLED = "true";
    process.env.APP_PUBLIC_ORIGIN = "http://127.0.0.1:3000";
    await assert.rejects(
      () => createMembershipCheckoutSession(request(validCheckoutData())),
      /not enabled for this environment/i
    );
  } finally {
    Object.entries(original).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
});

test("the local test flag cannot bypass the normal purchase gate", () => {
  const original = {
    MEMBERSHIP_PURCHASE_ENABLED: process.env.MEMBERSHIP_PURCHASE_ENABLED,
    MEMBERSHIP_TEST_JOURNEY_ENABLED: process.env.MEMBERSHIP_TEST_JOURNEY_ENABLED,
    APP_PUBLIC_ORIGIN: process.env.APP_PUBLIC_ORIGIN,
  };
  try {
    process.env.MEMBERSHIP_PURCHASE_ENABLED = "false";
    process.env.MEMBERSHIP_TEST_JOURNEY_ENABLED = "true";
    process.env.APP_PUBLIC_ORIGIN = "http://127.0.0.1:3000";
    assert.throws(
      () => membershipTesting.requirePurchaseFlowOpen(),
      /not enabled for this environment/i
    );
    process.env.MEMBERSHIP_PURCHASE_ENABLED = "true";
    assert.doesNotThrow(() => membershipTesting.requirePurchaseFlowOpen());
  } finally {
    Object.entries(original).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
});

test("Adult Conditioning has independent availability and legal gates", () => {
  const original = {
    ADULT_CONDITIONING_PURCHASE_ENABLED:
      process.env.ADULT_CONDITIONING_PURCHASE_ENABLED,
    ADULT_CONDITIONING_LEGAL_APPROVED:
      process.env.ADULT_CONDITIONING_LEGAL_APPROVED,
    MEMBERSHIP_TEST_JOURNEY_ENABLED:
      process.env.MEMBERSHIP_TEST_JOURNEY_ENABLED,
    APP_PUBLIC_ORIGIN: process.env.APP_PUBLIC_ORIGIN,
  };
  try {
    process.env.ADULT_CONDITIONING_PURCHASE_ENABLED = "false";
    process.env.ADULT_CONDITIONING_LEGAL_APPROVED = "false";
    process.env.MEMBERSHIP_TEST_JOURNEY_ENABLED = "false";
    assert.throws(
      () => membershipTesting.requirePlanPurchaseFlowOpen("adult_conditioning"),
      (error) => error.details?.reason ===
        "adult_conditioning_purchase_unavailable"
    );

    process.env.ADULT_CONDITIONING_PURCHASE_ENABLED = "true";
    assert.throws(
      () => membershipTesting.requirePlanPurchaseFlowOpen("adult_conditioning"),
      (error) => error.details?.reason ===
        "adult_conditioning_legal_not_approved"
    );

    process.env.MEMBERSHIP_TEST_JOURNEY_ENABLED = "true";
    process.env.APP_PUBLIC_ORIGIN = "http://127.0.0.1:3000";
    assert.doesNotThrow(
      () => membershipTesting.requirePlanPurchaseFlowOpen("adult_conditioning")
    );

    process.env.MEMBERSHIP_TEST_JOURNEY_ENABLED = "false";
    process.env.APP_PUBLIC_ORIGIN = "https://alpha-wod.vercel.app";
    process.env.ADULT_CONDITIONING_LEGAL_APPROVED = "true";
    assert.doesNotThrow(
      () => membershipTesting.requirePlanPurchaseFlowOpen("adult_conditioning")
    );
    assert.doesNotThrow(
      () => membershipTesting.requirePlanPurchaseFlowOpen("adult_unlimited")
    );
  } finally {
    Object.entries(original).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
});

test("Secret Manager bindings are omitted only for the exact isolated demo emulator", () => {
  const original = {
    FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST,
    FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
    FUNCTIONS_EMULATOR: process.env.FUNCTIONS_EMULATOR,
    GCLOUD_PROJECT: process.env.GCLOUD_PROJECT,
  };
  const marker = {name: "sentinel-secret"};
  try {
    process.env.FUNCTIONS_EMULATOR = "true";
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

    process.env.GCLOUD_PROJECT = "alpha-wod-functions-test";
    assert.deepEqual(membershipTesting.secretsForRuntime([marker]), [marker]);

    process.env.GCLOUD_PROJECT = "demo-alphawod-stripe";
    assert.deepEqual(membershipTesting.secretsForRuntime([marker]), []);

    process.env.FIREBASE_AUTH_EMULATOR_HOST = "auth.example.test:9099";
    assert.deepEqual(membershipTesting.secretsForRuntime([marker]), [marker]);
  } finally {
    Object.entries(original).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
});

test("a forbidden project and Stripe mode fails before cancellation writes", async () => {
  const original = {
    GCLOUD_PROJECT: process.env.GCLOUD_PROJECT,
    MEMBERSHIP_FIREBASE_PROJECT_ID: process.env.MEMBERSHIP_FIREBASE_PROJECT_ID,
    STRIPE_EXPECTED_MODE: process.env.STRIPE_EXPECTED_MODE,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  };
  try {
    process.env.GCLOUD_PROJECT = "alphawod-d1f2f";
    process.env.MEMBERSHIP_FIREBASE_PROJECT_ID = "alphawod-d1f2f";
    process.env.STRIPE_EXPECTED_MODE = "test";
    process.env.STRIPE_SECRET_KEY = "rk_test_restricted_fake";
    await assert.rejects(
      () => requestMembershipCancellation(request({
        subscriptionId: "sub_forbidden_environment",
        expectedCancelAtUnixSeconds: 1800000000,
      }, "payer")),
      /test mode is forbidden in the production Firebase project/i
    );
    assert.equal((await db.collection("memberships").get()).size, 0);
  } finally {
    Object.entries(original).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
});

test("the checkout core creates one Stripe session and reuses it on retry", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  try {
    const sessionsBefore = fakeStripe.state.checkoutSessions.size;
    const first = await handler(request(validCheckoutData("attempt_stable_handler_1")));
    const retry = await handler(request(validCheckoutData("attempt_stable_handler_1")));

    assert.equal(first.sessionId, retry.sessionId);
    assert.equal(first.sessionUrl, retry.sessionUrl);
    assert.equal(fakeStripe.state.checkoutSessions.size, sessionsBefore + 1);
    const intent = (await db.collection("membershipIntents").get()).docs[0];
    assert.equal(intent.get("status"), "created");
    assert.equal(intent.get("stripeMode"), "test");
    assert.equal(intent.get("checkoutSessionId"), first.sessionId);
    assert.equal((await db.collection("membershipCheckoutLocks").get()).size, 1);

    const sent = fakeStripe.lastUpdateTo("/v1/checkout/sessions");
    assert.ok(sent);
    assert.equal(
      sent.payload.success_url,
      "https://alpha-wod.vercel.app/memberships/success?" +
        "session_id={CHECKOUT_SESSION_ID}&plan=adult_unlimited"
    );
    assert.equal(sent.payload.payment_method_collection, "always");
    assert.equal(sent.payload["adaptive_pricing[enabled]"], "false");
    assert.equal(sent.payload.allow_promotion_codes, undefined);
    assert.equal(sent.payload["discounts[0][promotion_code]"], undefined);
    assert.equal(sent.payload["subscription_data[proration_behavior]"], "none");
    assert.equal(sent.payload["metadata[appAccessTier]"], "full");
    assert.equal(
      sent.payload["subscription_data[metadata][appAccessTier]"],
      "full"
    );
    const providerSession = fakeStripe.state.checkoutSessions.get(first.sessionId);
    assert.equal(providerSession.metadata.appAccessTier, "full");
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        providerSession.metadata,
        "conditioningSlots"
      ),
      false
    );
    assert.equal(
      Number(sent.payload["subscription_data[billing_cycle_anchor]"]),
      1788220800
    );
    assert.equal(intent.get("billingMode"), "presale_deferred");
    assert.equal(intent.get("serviceStartsAt"), 1788217200);
    assert.equal(intent.get("firstPaymentAt"), 1788220800);
    assert.equal(intent.get("initialChargePence"), 0);
    assert.equal(intent.get("promotionCodeId"), null);
    assert.deepEqual(
      intent.get("acceptances.acceptedStatementIds"),
      validCheckoutData().acceptedStatementIds
    );
    assert.deepEqual(
      intent.get("acceptances.documents").map(({key}) => key),
      ["membershipTerms", "cancellationPolicy", "privacyNotice", "adultWaiver"]
    );
    assert.equal(intent.get("acceptances.signerRole"), "adult_participant_and_payer");
    assert.equal(intent.get("commercialTerms.planName"), "Adult Unlimited Membership");
    assert.equal(intent.get("commercialTerms.amountPence"), 6000);
    assert.equal(first.initialChargePence, 0);
    assert.equal(first.promotionCodesEnabled, true);
    assert.ok(Number(sent.payload.expires_at) <
      Number(sent.payload["subscription_data[billing_cycle_anchor]"]));
  } finally {
    Date.now = realNow;
  }
});

test("Adult Conditioning checkout freezes the flexible weekly policy into intent and Stripe metadata", async () => {
  const original = {
    ADULT_CONDITIONING_PURCHASE_ENABLED:
      process.env.ADULT_CONDITIONING_PURCHASE_ENABLED,
    ADULT_CONDITIONING_LEGAL_APPROVED:
      process.env.ADULT_CONDITIONING_LEGAL_APPROVED,
  };
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  process.env.ADULT_CONDITIONING_PURCHASE_ENABLED = "true";
  process.env.ADULT_CONDITIONING_LEGAL_APPROVED = "true";
  try {
    await assert.rejects(
      () => handler(request({
        ...conditioningCheckoutData(
          "attempt_conditioning_legacy_slots_123456"
        ),
        selectedConditioningSlots: ["monday_0600", "tuesday_1800"],
      })),
      (error) => error.details?.reason ===
        "conditioning_slots_no_longer_supported"
    );

    const data = conditioningCheckoutData(
      "attempt_conditioning_flexible_policy_123456"
    );
    const result = await handler(request(data));
    const intentSnap = (await db.collection("membershipIntents").get()).docs[0];
    assert.equal(intentSnap.get("selectedConditioningSlots"), undefined);
    assert.equal(
      intentSnap.get("commercialTerms.selectedConditioningSlots"),
      undefined
    );
    assert.deepEqual(intentSnap.get("commercialTerms.conditioningBookingPolicy"), {
      version: 1,
      timezone: "Europe/London",
      weekStartsOn: "monday",
      weeklyBookingLimit: 2,
      eligibleSlotKeys: [
        "monday_0600",
        "tuesday_1800",
        "thursday_1800",
        "friday_0530",
      ],
    });
    assert.equal(intentSnap.get("commercialTerms.appAccessTier"), "limited");
    const sent = fakeStripe.lastUpdateTo("/v1/checkout/sessions");
    assert.equal(sent.payload["metadata[appAccessTier]"], "limited");
    assert.equal(
      sent.payload["subscription_data[metadata][appAccessTier]"],
      "limited"
    );
    assert.equal(
      sent.payload["metadata[conditioningWeeklyLimit]"],
      "2"
    );
    assert.equal(
      sent.payload["subscription_data[metadata][conditioningEligibleSlots]"],
      "monday_0600,tuesday_1800,thursday_1800,friday_0530"
    );
    assert.equal(sent.payload["metadata[conditioningSlots]"], undefined);

    await assert.rejects(
      () => handler(request({
        ...data,
        selectedConditioningSlots: ["tuesday_1800", "thursday_1800"],
      })),
      (error) => error.details?.reason ===
        "conditioning_slots_no_longer_supported"
    );
    assert.ok(result.sessionId);
  } finally {
    Date.now = realNow;
    Object.entries(original).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
});

test("an anonymous same-attempt retry returns Stripe's current open Session URL", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  try {
    const data = validCheckoutData("attempt_same_anonymous_current_url_123456");
    const sessionsBefore = fakeStripe.state.checkoutSessions.size;
    const first = await handler(request(data));
    const providerSession = fakeStripe.state.checkoutSessions.get(first.sessionId);
    providerSession.url = `${first.sessionUrl}?provider=current`;
    // Stripe can assign a Customer after the visitor enters Checkout details;
    // this does not turn an anonymous attempt into an authenticated one.
    providerSession.customer = "cus_created_during_anonymous_checkout";
    fakeStripe.state.checkoutSessions.set(first.sessionId, providerSession);

    const retry = await handler(request(data));

    assert.equal(retry.disposition, "created");
    assert.equal(retry.sessionId, first.sessionId);
    assert.equal(retry.sessionUrl, providerSession.url);
    assert.notEqual(retry.sessionUrl, first.sessionUrl);
    assert.equal(fakeStripe.state.checkoutSessions.size, sessionsBefore + 1);
    assert.equal((await db.collection("membershipIntents").get()).size, 1);
    const locks = await db.collection("membershipCheckoutLocks").get();
    assert.equal(locks.size, 1);
  } finally {
    Date.now = realNow;
  }
});

test("an anonymous same-attempt retry rejects authenticated Stripe bindings", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  try {
    const data = validCheckoutData("attempt_same_anonymous_binding_123456");
    const first = await handler(request(data));
    const session = fakeStripe.state.checkoutSessions.get(first.sessionId);
    session.metadata.firebaseUid = "unexpected-account";
    fakeStripe.state.checkoutSessions.set(first.sessionId, session);

    const assertReview = (error) => {
      assert.equal(error.code, "failed-precondition");
      assert.equal(error.details?.reason, "checkout_recovery_review");
      return true;
    };
    await assert.rejects(() => handler(request(data)), assertReview);

    delete session.metadata.firebaseUid;
    session.client_reference_id = "unexpected-account";
    fakeStripe.state.checkoutSessions.set(first.sessionId, session);
    await assert.rejects(() => handler(request(data)), assertReview);

    const intent = (await db.collection("membershipIntents").get()).docs[0];
    assert.equal(intent.get("status"), "created");
    const locks = await db.collection("membershipCheckoutLocks").get();
    assert.equal(locks.size, 1);
    assert.ok(locks.docs.every((lock) => lock.get("intentId") === intent.id));
  } finally {
    Date.now = realNow;
  }
});

test("a completed same-attempt retry reports processing and never reuses its URL", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  try {
    await createMember("sameattemptprocessing");
    const data = validCheckoutData("attempt_same_complete_processing_123456");
    const first = await handler(request(data, "sameattemptprocessing"));
    const session = fakeStripe.state.checkoutSessions.get(first.sessionId);
    session.status = "complete";
    session.payment_status = "paid";
    fakeStripe.state.checkoutSessions.set(first.sessionId, session);

    const assertProcessing = (error) => {
      assert.equal(error.code, "failed-precondition");
      assert.equal(error.details?.reason, "checkout_processing");
      return true;
    };
    await assert.rejects(
      () => handler(request(data, "sameattemptprocessing")),
      assertProcessing
    );

    const intent = (await db.collection("membershipIntents").get()).docs[0];
    assert.equal(intent.get("status"), "payment_pending");
    const locks = await db.collection("membershipCheckoutLocks").get();
    assert.equal(locks.size, 2);
    assert.ok(locks.docs.every((lock) => lock.get("intentId") === intent.id));

    // Once the webhook-facing state is already processing or fulfilled, the
    // handler must not need a hosted Session URL to avoid redirecting back to
    // a completed Checkout page.
    fakeStripe.state.checkoutSessions.delete(first.sessionId);
    await assert.rejects(
      () => handler(request(data, "sameattemptprocessing")),
      assertProcessing
    );
    await intent.ref.update({status: "fulfilled"});
    await assert.rejects(
      () => handler(request(data, "sameattemptprocessing")),
      assertProcessing
    );
  } finally {
    Date.now = realNow;
  }
});

test("an expired same-attempt Session is terminalized before its locks release", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  try {
    const data = validCheckoutData("attempt_same_expired_terminal_123456");
    const first = await handler(request(data));
    const session = fakeStripe.state.checkoutSessions.get(first.sessionId);
    session.status = "expired";
    fakeStripe.state.checkoutSessions.set(first.sessionId, session);

    await assert.rejects(
      () => handler(request(data)),
      (error) => {
        assert.equal(error.code, "deadline-exceeded");
        assert.equal(error.details?.reason, "checkout_expired");
        return true;
      }
    );

    const intent = (await db.collection("membershipIntents").get()).docs[0];
    assert.equal(intent.get("status"), "expired");
    assert.equal((await db.collection("membershipCheckoutLocks").get()).size, 0);
  } finally {
    Date.now = realNow;
  }
});

test("provider uncertainty on a same-attempt retry fails closed with locks retained", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  try {
    const data = validCheckoutData("attempt_same_provider_uncertain_123456");
    const first = await handler(request(data));
    fakeStripe.state.checkoutSessions.delete(first.sessionId);

    await assert.rejects(
      () => handler(request(data)),
      (error) => {
        assert.equal(error.code, "unavailable");
        assert.equal(error.details?.reason, "checkout_recovery_unavailable");
        return true;
      }
    );

    const intent = (await db.collection("membershipIntents").get()).docs[0];
    assert.equal(intent.get("status"), "created");
    const locks = await db.collection("membershipCheckoutLocks").get();
    assert.equal(locks.size, 1);
    assert.ok(locks.docs.every((lock) => lock.get("intentId") === intent.id));
  } finally {
    Date.now = realNow;
  }
});

test("a new checkout attempt resumes the exact signed-in owner's open Stripe Session", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  try {
    await createMember("resumeowner");
    const sessionsBefore = fakeStripe.state.checkoutSessions.size;
    const first = await handler(request(
      validCheckoutData("attempt_owned_resume_first_123456"),
      "resumeowner"
    ));
    const providerSession = fakeStripe.state.checkoutSessions.get(first.sessionId);
    providerSession.url = `${first.sessionUrl}?provider=current`;
    fakeStripe.state.checkoutSessions.set(first.sessionId, providerSession);
    const resumed = await handler(request(
      validCheckoutData("attempt_owned_resume_second_123456"),
      "resumeowner"
    ));

    assert.equal(resumed.disposition, "resumed");
    assert.equal(resumed.sessionId, first.sessionId);
    assert.equal(resumed.sessionUrl, providerSession.url);
    assert.notEqual(resumed.sessionUrl, first.sessionUrl);
    assert.equal(fakeStripe.state.checkoutSessions.size, sessionsBefore + 1);
    const intents = await db.collection("membershipIntents").get();
    assert.equal(intents.size, 1);
    const locks = await db.collection("membershipCheckoutLocks").get();
    assert.equal(locks.size, 2);
    assert.ok(locks.docs.every((lock) => lock.get("intentId") === intents.docs[0].id));
    assert.equal(
      intents.docs[0].get("checkoutAttemptHash"),
      createHash("sha256")
        .update("membership-checkout:attempt_owned_resume_first_123456")
        .digest("hex")
    );
  } finally {
    Date.now = realNow;
  }
});

test("an anonymous new attempt cannot recover another anonymous checkout URL", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  try {
    const sessionsBefore = fakeStripe.state.checkoutSessions.size;
    await handler(request(validCheckoutData("attempt_anonymous_owner_first_123456")));

    await assert.rejects(
      () => handler(request(validCheckoutData("attempt_anonymous_owner_second_123456"))),
      (error) => {
        assert.equal(error.code, "already-exists");
        assert.equal(error.details?.reason, "checkout_in_progress");
        assert.match(error.message, /checkout or membership setup is already in progress/i);
        return true;
      }
    );
    assert.equal(fakeStripe.state.checkoutSessions.size, sessionsBefore + 1);
    assert.equal((await db.collection("membershipIntents").get()).size, 1);
  } finally {
    Date.now = realNow;
  }
});

test("signing in does not adopt an anonymous open checkout", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  try {
    await createMember("anonymousadopter");
    await handler(request(validCheckoutData("attempt_anonymous_adopt_first_123456")));

    await assert.rejects(
      () => handler(request(
        validCheckoutData("attempt_anonymous_adopt_second_123456"),
        "anonymousadopter"
      )),
      (error) => {
        assert.equal(error.code, "already-exists");
        assert.equal(error.details?.reason, "checkout_in_progress");
        return true;
      }
    );
    assert.equal((await db.collection("membershipIntents").get()).size, 1);
  } finally {
    Date.now = realNow;
  }
});

test("a different signed-in account cannot recover an owner's checkout URL", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  try {
    await createMember("checkoutowner");
    await createMember("checkoutstranger");
    const sessionsBefore = fakeStripe.state.checkoutSessions.size;
    await handler(request(
      validCheckoutData("attempt_different_uid_first_123456"),
      "checkoutowner"
    ));

    await assert.rejects(
      () => handler(request(
        validCheckoutData("attempt_different_uid_second_123456"),
        "checkoutstranger"
      )),
      (error) => {
        assert.equal(error.code, "already-exists");
        assert.equal(error.details?.reason, "checkout_in_progress");
        return true;
      }
    );
    assert.equal(fakeStripe.state.checkoutSessions.size, sessionsBefore + 1);
    assert.equal((await db.collection("membershipIntents").get()).size, 1);
  } finally {
    Date.now = realNow;
  }
});

test("anonymous callers cannot distinguish a membership from a checkout reservation", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  const captureRejection = async (operation) => {
    try {
      await operation();
      assert.fail("Expected checkout admission to be rejected.");
    } catch (error) {
      return error;
    }
  };
  const adultData = (checkoutAttemptId, participantFullName, participantDateOfBirth) => ({
    ...validCheckoutData(checkoutAttemptId),
    participantFullName,
    participantDateOfBirth,
    signedName: participantFullName,
  });
  try {
    const memberData = adultData(
      "attempt_private_anonymous_membership_123456",
      "Private Existing Member",
      "1990-02-03"
    );
    await seedMembership("sub_private_anonymous_membership", {
      participant: {
        fullName: memberData.participantFullName,
        dateOfBirth: memberData.participantDateOfBirth,
        age: 36,
        isPayer: true,
        participantKey: membershipTesting.participantKeyFor(
          memberData.participantFullName,
          memberData.participantDateOfBirth
        ),
      },
    });
    const membershipError = await captureRejection(
      () => handler(request(memberData))
    );

    const reservationData = adultData(
      "attempt_private_anonymous_reservation_first_123456",
      "Private Pending Buyer",
      "1991-03-04"
    );
    await handler(request(reservationData));
    const reservationError = await captureRejection(() => handler(request({
      ...reservationData,
      checkoutAttemptId: "attempt_private_anonymous_reservation_second_123456",
    })));

    for (const error of [membershipError, reservationError]) {
      assert.equal(error.code, "already-exists");
      assert.equal(error.details?.reason, "checkout_in_progress");
      assert.match(
        error.message,
        /checkout or membership setup is already in progress/i
      );
    }
    assert.equal(membershipError.message, reservationError.message);
  } finally {
    Date.now = realNow;
  }
});

test("a different UID cannot distinguish a membership from an owner's reservation", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  const captureRejection = async (operation) => {
    try {
      await operation();
      assert.fail("Expected checkout admission to be rejected.");
    } catch (error) {
      return error;
    }
  };
  const adultData = (checkoutAttemptId, participantFullName, participantDateOfBirth) => ({
    ...validCheckoutData(checkoutAttemptId),
    participantFullName,
    participantDateOfBirth,
    signedName: participantFullName,
  });
  try {
    await createMember("privacyactualowner");
    await createMember("privacyreservationowner");
    await createMember("privacystranger");
    const memberData = adultData(
      "attempt_private_uid_membership_123456",
      "UID Existing Member",
      "1990-04-05"
    );
    await seedMembership("sub_private_uid_membership", {
      payerUid: "privacyactualowner",
      entitlementTargetUid: "privacyactualowner",
      participant: {
        fullName: memberData.participantFullName,
        dateOfBirth: memberData.participantDateOfBirth,
        age: 36,
        isPayer: true,
        participantKey: membershipTesting.participantKeyFor(
          memberData.participantFullName,
          memberData.participantDateOfBirth
        ),
      },
    });
    const membershipError = await captureRejection(
      () => handler(request(memberData, "privacystranger"))
    );

    const reservationData = adultData(
      "attempt_private_uid_reservation_first_123456",
      "UID Pending Buyer",
      "1991-05-06"
    );
    await handler(request(reservationData, "privacyreservationowner"));
    const reservationError = await captureRejection(() => handler(request({
      ...reservationData,
      checkoutAttemptId: "attempt_private_uid_reservation_second_123456",
    }, "privacystranger")));

    for (const error of [membershipError, reservationError]) {
      assert.equal(error.code, "already-exists");
      assert.equal(error.details?.reason, "checkout_in_progress");
    }
    assert.equal(membershipError.message, reservationError.message);
  } finally {
    Date.now = realNow;
  }
});

test("a signed payer or entitlement target receives membership_exists", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  const adultData = (checkoutAttemptId, participantFullName, participantDateOfBirth) => ({
    ...validCheckoutData(checkoutAttemptId),
    participantFullName,
    participantDateOfBirth,
    signedName: participantFullName,
  });
  try {
    await createMember("privacyboundpayer");
    await createMember("privacyboundtarget");
    const payerData = adultData(
      "attempt_private_bound_payer_123456",
      "Bound Membership Payer",
      "1990-06-07"
    );
    await seedMembership("sub_private_bound_payer", {
      payerUid: "privacyboundpayer",
      participant: {
        fullName: payerData.participantFullName,
        dateOfBirth: payerData.participantDateOfBirth,
        age: 36,
        isPayer: true,
        participantKey: membershipTesting.participantKeyFor(
          payerData.participantFullName,
          payerData.participantDateOfBirth
        ),
      },
    });
    const targetData = adultData(
      "attempt_private_bound_target_123456",
      "Bound Entitlement Target",
      "1991-07-08"
    );
    await seedMembership("sub_private_bound_target", {
      payerUid: "another-payer",
      entitlementTargetUid: "privacyboundtarget",
      participant: {
        fullName: targetData.participantFullName,
        dateOfBirth: targetData.participantDateOfBirth,
        age: 35,
        isPayer: true,
        participantKey: membershipTesting.participantKeyFor(
          targetData.participantFullName,
          targetData.participantDateOfBirth
        ),
      },
    });

    for (const [data, uid] of [
      [payerData, "privacyboundpayer"],
      [targetData, "privacyboundtarget"],
    ]) {
      await assert.rejects(
        () => handler(request(data, uid)),
        (error) => {
          assert.equal(error.code, "already-exists");
          assert.equal(error.details?.reason, "membership_exists");
          assert.match(
            error.message,
            /already has an active or scheduled membership/i
          );
          return true;
        }
      );
    }
  } finally {
    Date.now = realNow;
  }
});

test("an owner cannot resume a Session after changing frozen checkout details", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  try {
    await createMember("youthresumeowner");
    const youthData = {
      ...validCheckoutData("attempt_changed_details_first_123456"),
      planKey: "youth_teenstars",
      participantFullName: "Same Young Athlete",
      participantDateOfBirth: "2012-05-05",
      participantIsPayer: false,
      signedName: "Same Paying Adult",
      guardianFullName: "Same Paying Adult",
      guardianRelationship: "Parent",
      acceptedStatementIds: resolveCheckoutAcceptanceStatements("youth_teenstars")
        .map(({id}) => id),
    };
    const sessionsBefore = fakeStripe.state.checkoutSessions.size;
    await handler(request(youthData, "youthresumeowner"));

    await assert.rejects(
      () => handler(request({
        ...youthData,
        checkoutAttemptId: "attempt_changed_details_second_123456",
        guardianRelationship: "Legal guardian",
      }, "youthresumeowner")),
      (error) => {
        assert.equal(error.code, "already-exists");
        assert.equal(error.details?.reason, "checkout_in_progress");
        return true;
      }
    );
    assert.equal(fakeStripe.state.checkoutSessions.size, sessionsBefore + 1);
  } finally {
    Date.now = realNow;
  }
});

test("a completed owned Session stays locked and reports checkout_processing", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  try {
    await createMember("processingowner");
    const first = await handler(request(
      validCheckoutData("attempt_processing_first_123456"),
      "processingowner"
    ));
    const session = fakeStripe.state.checkoutSessions.get(first.sessionId);
    session.status = "complete";
    session.payment_status = "paid";
    fakeStripe.state.checkoutSessions.set(first.sessionId, session);

    await assert.rejects(
      () => handler(request(
        validCheckoutData("attempt_processing_second_123456"),
        "processingowner"
      )),
      (error) => {
        assert.equal(error.code, "failed-precondition");
        assert.equal(error.details?.reason, "checkout_processing");
        return true;
      }
    );
    const intent = (await db.collection("membershipIntents").get()).docs[0];
    assert.equal(intent.get("status"), "payment_pending");
    const locks = await db.collection("membershipCheckoutLocks").get();
    assert.ok(locks.size > 0);
    assert.ok(locks.docs.every((lock) => lock.get("intentId") === intent.id));
  } finally {
    Date.now = realNow;
  }
});

test("an expired owned Session releases only its locks and creates a fresh checkout", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  try {
    await createMember("expiredresumeowner");
    const sessionsBefore = fakeStripe.state.checkoutSessions.size;
    const first = await handler(request(
      validCheckoutData("attempt_expired_resume_first_123456"),
      "expiredresumeowner"
    ));
    const oldSession = fakeStripe.state.checkoutSessions.get(first.sessionId);
    oldSession.status = "expired";
    fakeStripe.state.checkoutSessions.set(first.sessionId, oldSession);

    const replacement = await handler(request(
      validCheckoutData("attempt_expired_resume_second_123456"),
      "expiredresumeowner"
    ));

    assert.equal(replacement.disposition, "created");
    assert.notEqual(replacement.sessionId, first.sessionId);
    assert.equal(fakeStripe.state.checkoutSessions.size, sessionsBefore + 2);
    const intents = await db.collection("membershipIntents").get();
    assert.equal(intents.size, 2);
    assert.deepEqual(
      intents.docs.map((intent) => intent.get("status")).sort(),
      ["created", "expired"]
    );
    const replacementIntent = intents.docs.find((intent) =>
      intent.get("checkoutSessionId") === replacement.sessionId
    );
    const locks = await db.collection("membershipCheckoutLocks").get();
    assert.ok(replacementIntent);
    assert.ok(locks.docs.every((lock) =>
      lock.get("intentId") === replacementIntent.id
    ));
  } finally {
    Date.now = realNow;
  }
});

test("provider uncertainty during owned resume fails closed and retains the locks", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  try {
    await createMember("uncertainresumeowner");
    const first = await handler(request(
      validCheckoutData("attempt_uncertain_resume_first_123456"),
      "uncertainresumeowner"
    ));
    fakeStripe.state.checkoutSessions.delete(first.sessionId);

    await assert.rejects(
      () => handler(request(
        validCheckoutData("attempt_uncertain_resume_second_123456"),
        "uncertainresumeowner"
      )),
      (error) => {
        assert.equal(error.code, "unavailable");
        assert.equal(error.details?.reason, "checkout_recovery_unavailable");
        return true;
      }
    );
    const intent = (await db.collection("membershipIntents").get()).docs[0];
    assert.equal(intent.get("status"), "created");
    const locks = await db.collection("membershipCheckoutLocks").get();
    assert.ok(locks.size > 0);
    assert.ok(locks.docs.every((lock) => lock.get("intentId") === intent.id));
  } finally {
    Date.now = realNow;
  }
});

test("an authenticated Stripe binding mismatch never returns the stored checkout URL", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  try {
    await createMember("bindingresumeowner");
    const first = await handler(request(
      validCheckoutData("attempt_binding_resume_first_123456"),
      "bindingresumeowner"
    ));
    const session = fakeStripe.state.checkoutSessions.get(first.sessionId);
    session.metadata.firebaseUid = "another-account";
    fakeStripe.state.checkoutSessions.set(first.sessionId, session);

    await assert.rejects(
      () => handler(request(
        validCheckoutData("attempt_binding_resume_second_123456"),
        "bindingresumeowner"
      )),
      (error) => {
        assert.equal(error.code, "failed-precondition");
        assert.equal(error.details?.reason, "checkout_recovery_review");
        return true;
      }
    );
    const intent = (await db.collection("membershipIntents").get()).docs[0];
    assert.equal(intent.get("status"), "created");
    const locks = await db.collection("membershipCheckoutLocks").get();
    assert.ok(locks.docs.every((lock) => lock.get("intentId") === intent.id));
  } finally {
    Date.now = realNow;
  }
});

test("checkout converges a stale terminal duplicate before admission", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  try {
    const data = validCheckoutData("attempt_authoritative_duplicate_checkout");
    await seedMembership("sub_authoritative_duplicate_checkout", {
      state: "cancelled",
      stripeStatus: "canceled",
      participant: {
        fullName: data.participantFullName,
        dateOfBirth: data.participantDateOfBirth,
        age: 36,
        isPayer: true,
        participantKey: membershipTesting.participantKeyFor(
          data.participantFullName,
          data.participantDateOfBirth
        ),
      },
    });
    // seedMembership leaves Stripe active. The stale Firestore terminal state
    // must be healed before the duplicate transaction is allowed to decide.
    await assert.rejects(
      () => handler(request(data)),
      (error) => {
        assert.equal(error.code, "already-exists");
        assert.equal(error.details?.reason, "checkout_in_progress");
        assert.match(
          error.message,
          /checkout or membership setup is already in progress/i
        );
        return true;
      }
    );

    assert.equal(
      (await db.collection("memberships")
        .doc("sub_authoritative_duplicate_checkout").get()).get("state"),
      "active"
    );
    assert.equal((await db.collection("membershipIntents").get()).size, 0);
  } finally {
    Date.now = realNow;
  }
});

test("checkout fails closed when a relevant Stripe subscription is uncertain", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  try {
    const data = validCheckoutData("attempt_uncertain_duplicate_checkout");
    await seedMembership("sub_uncertain_duplicate_checkout", {
      state: "cancelled",
      stripeStatus: "canceled",
      participant: {
        fullName: data.participantFullName,
        dateOfBirth: data.participantDateOfBirth,
        age: 36,
        isPayer: true,
        participantKey: membershipTesting.participantKeyFor(
          data.participantFullName,
          data.participantDateOfBirth
        ),
      },
    });
    fakeStripe.state.subscriptions.delete("sub_uncertain_duplicate_checkout");

    await assert.rejects(
      () => handler(request(data)),
      (error) => {
        assert.equal(error.code, "unavailable");
        assert.match(error.message, /could not be verified with Stripe/i);
        return true;
      }
    );
    assert.equal((await db.collection("membershipIntents").get()).size, 0);
    assert.equal((await db.collection("membershipCheckoutLocks").get()).size, 0);
  } finally {
    Date.now = realNow;
  }
});

test("signed checkout converges the payer's stale terminal membership", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  try {
    await createMember("signedduplicate", {
      email: "signedduplicate@example.test",
      emailVerified: true,
    });
    await seedMembership("sub_signed_payer_duplicate", {
      payerUid: "signedduplicate",
      entitlementTargetUid: "signedduplicate",
      state: "cancelled",
      stripeStatus: "canceled",
      participant: {
        fullName: "Earlier Participant Name",
        dateOfBirth: "1985-01-01",
        age: 41,
        isPayer: true,
        participantKey: "different_participant_identity",
      },
    });

    await assert.rejects(
      () => handler(request(
        validCheckoutData("attempt_signed_payer_duplicate"),
        "signedduplicate"
      )),
      /already has an active or scheduled membership/i
    );
    assert.equal(
      (await db.collection("memberships")
        .doc("sub_signed_payer_duplicate").get()).get("state"),
      "active"
    );
    assert.equal((await db.collection("membershipIntents").get()).size, 0);
  } finally {
    Date.now = realNow;
  }
});

test("checkout rejects every non-exact legal acceptance set before reserving", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const base = validCheckoutData("attempt_non_exact_acceptance_123456");
  const missing = base.acceptedStatementIds.slice(0, -1);
  const duplicated = [...base.acceptedStatementIds, base.acceptedStatementIds[0]];
  const extra = [...base.acceptedStatementIds, "guardian_authority"];

  for (const [index, acceptedStatementIds] of [missing, duplicated, extra].entries()) {
    await assert.rejects(
      () => handler(request({
        ...base,
        checkoutAttemptId: `${base.checkoutAttemptId}_${index}`,
        acceptedStatementIds,
      })),
      /accept every required checkout statement separately/i
    );
  }
  assert.equal((await db.collection("membershipIntents").get()).size, 0);
  assert.equal((await db.collection("membershipCheckoutLocks").get()).size, 0);
});

test("the approved shared code is explicitly bound and remains reusable", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  const promotion = fakeStripe.state.promotionCodes.get(
    "promo_existing_member_shared"
  );
  const originalPromotion = {...promotion};
  try {
    const data = {
      ...validCheckoutData("attempt_shared_code_idempotent_123456"),
      promotionCode: "  existing-fake  ",
    };
    // Previous redemptions must not turn a shared campaign into a single-use
    // offer. The exact Promotion Code id is still frozen onto this attempt.
    promotion.times_redeemed = 7;
    const first = await handler(request(data));
    const intent = (await db.collection("membershipIntents").get()).docs[0];
    const sent = fakeStripe.lastUpdateTo("/v1/checkout/sessions");

    assert.equal(
      sent.payload["discounts[0][promotion_code]"],
      "promo_existing_member_shared"
    );
    assert.equal(sent.payload.allow_promotion_codes, undefined);
    assert.equal(intent.get("promotionCodeId"), "promo_existing_member_shared");
    assert.equal(JSON.stringify(intent.data()).includes("EXISTING-FAKE"), false);

    // A lost response can be retried after more campaign redemptions. The
    // frozen Session is returned without looking the raw code up again.
    promotion.active = false;
    promotion.times_redeemed = 11;
    const sessionsBeforeRetry = fakeStripe.state.checkoutSessions.size;
    const retry = await handler(request({
      ...data,
      promotionCode: "existing-fake",
    }));
    assert.equal(retry.sessionId, first.sessionId);
    assert.equal(fakeStripe.state.checkoutSessions.size, sessionsBeforeRetry);
  } finally {
    Object.assign(promotion, originalPromotion);
    Date.now = realNow;
  }
});

test("capped and malformed shared campaign counters fail closed", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  const promotion = fakeStripe.state.promotionCodes.get(
    "promo_existing_member_shared"
  );
  const originalPromotion = {...promotion};
  const sessionsBefore = fakeStripe.state.checkoutSessions.size;
  try {
    for (const [suffix, maximum, redeemed] of [
      ["single_use", 1, 0],
      ["finite_cap", 25, 24],
      ["negative_count", null, -1],
      ["fractional_count", null, 0.5],
    ]) {
      promotion.max_redemptions = maximum;
      promotion.times_redeemed = redeemed;
      await assert.rejects(
        () => handler(request({
          ...validCheckoutData(`attempt_shared_code_${suffix}_123456`),
          promotionCode: "EXISTING-FAKE",
        })),
        /not valid for the founding-member offer/i
      );
    }
    assert.equal(fakeStripe.state.checkoutSessions.size, sessionsBefore);
    assert.equal((await db.collection("membershipIntents").get()).size, 0);
    assert.equal((await db.collection("membershipCheckoutLocks").get()).size, 0);
  } finally {
    Object.assign(promotion, originalPromotion);
    Date.now = realNow;
  }
});

test("shared campaign objects reject automatic provider expiry", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  const coupon = fakeStripe.state.coupons.get("coupon_existing_member_5x3");
  const promotion = fakeStripe.state.promotionCodes.get(
    "promo_existing_member_shared"
  );
  const originalCoupon = {...coupon};
  const originalPromotion = {...promotion};
  const sessionsBefore = fakeStripe.state.checkoutSessions.size;
  try {
    coupon.redeem_by = PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS;
    await assert.rejects(
      () => handler(request({
        ...validCheckoutData("attempt_coupon_expiry_before_anchor_123456"),
        promotionCode: "EXISTING-FAKE",
      })),
      /configured existing-member Coupon does not match/i
    );

    Object.assign(coupon, originalCoupon);
    promotion.expires_at = PRESALE_BILLING_ANCHOR_UNIX_SECONDS;
    await assert.rejects(
      () => handler(request({
        ...validCheckoutData("attempt_promotion_automatic_expiry_123456"),
        promotionCode: "EXISTING-FAKE",
      })),
      /not valid for the founding-member offer/i
    );

    assert.equal(fakeStripe.state.checkoutSessions.size, sessionsBefore);
    assert.equal((await db.collection("membershipIntents").get()).size, 0);
    assert.equal((await db.collection("membershipCheckoutLocks").get()).size, 0);
  } finally {
    Object.assign(coupon, originalCoupon);
    Object.assign(promotion, originalPromotion);
    Date.now = realNow;
  }
});

test("fake Stripe reproduces coupon_expired at a deferred billing anchor", async () => {
  const coupon = fakeStripe.state.coupons.get("coupon_existing_member_5x3");
  const originalCoupon = {...coupon};
  const realNow = Date.now;
  const client = new Stripe("sk_test_fake", {
    apiVersion: "2024-06-20",
    host: "127.0.0.1",
    port: STRIPE_PORT,
    protocol: "http",
  });
  try {
    Date.now = () => (PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS - 3600) * 1000;
    coupon.redeem_by = PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS;
    await assert.rejects(
      () => client.checkout.sessions.create({
        mode: "subscription",
        line_items: [{price: "price_unlimited", quantity: 1}],
        discounts: [{promotion_code: "promo_existing_member_shared"}],
        expires_at: PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS - 60,
        success_url: "https://example.test/success",
        cancel_url: "https://example.test/cancel",
        subscription_data: {
          billing_cycle_anchor: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
          proration_behavior: "none",
        },
      }),
      (error) => {
        assert.equal(error.code, "coupon_expired");
        return true;
      }
    );
  } finally {
    Object.assign(coupon, originalCoupon);
    Date.now = realNow;
  }
});

test("the shared Promotion Code id allowlist is required before reservation", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  const configuredId = process.env.STRIPE_EXISTING_MEMBER_PROMOTION_CODE_ID;
  const sessionsBefore = fakeStripe.state.checkoutSessions.size;
  try {
    process.env.STRIPE_EXISTING_MEMBER_PROMOTION_CODE_ID = "";
    await assert.rejects(
      () => handler(request({
        ...validCheckoutData("attempt_shared_code_missing_allowlist_123456"),
        promotionCode: "EXISTING-FAKE",
      })),
      /Promotion Code allowlist is not configured/i
    );
    assert.equal(fakeStripe.state.checkoutSessions.size, sessionsBefore);
    assert.equal((await db.collection("membershipIntents").get()).size, 0);
  } finally {
    process.env.STRIPE_EXISTING_MEMBER_PROMOTION_CODE_ID = configuredId;
    Date.now = realNow;
  }
});

test("unknown and unrelated campaign codes fail before reservation or Stripe", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  const sessionsBefore = fakeStripe.state.checkoutSessions.size;
  fakeStripe.state.promotionCodes.set("promo_unrelated_campaign", {
    id: "promo_unrelated_campaign",
    object: "promotion_code",
    livemode: false,
    active: true,
    code: "UNRELATED-FAKE",
    max_redemptions: null,
    expires_at: null,
    times_redeemed: 0,
    promotion: {type: "coupon", coupon: "coupon_unrelated_campaign"},
    restrictions: {
      first_time_transaction: false,
      minimum_amount: null,
      minimum_amount_currency: null,
    },
  });
  fakeStripe.state.promotionCodes.set("promo_currency_minimum", {
    id: "promo_currency_minimum",
    object: "promotion_code",
    livemode: false,
    active: true,
    code: "CURRENCY-MINIMUM-FAKE",
    max_redemptions: null,
    expires_at: null,
    times_redeemed: 0,
    promotion: {type: "coupon", coupon: "coupon_existing_member_5x3"},
    restrictions: {
      first_time_transaction: false,
      minimum_amount: null,
      minimum_amount_currency: null,
      currency_options: {gbp: {minimum_amount: 5000}},
    },
  });
  fakeStripe.state.promotionCodes.set("promo_matching_not_allowlisted", {
    id: "promo_matching_not_allowlisted",
    object: "promotion_code",
    livemode: false,
    active: true,
    code: "MATCHING-NOT-ALLOWLISTED",
    max_redemptions: null,
    expires_at: null,
    times_redeemed: 0,
    promotion: {type: "coupon", coupon: "coupon_existing_member_5x3"},
    restrictions: {
      first_time_transaction: false,
      minimum_amount: null,
      minimum_amount_currency: null,
      currency_options: {},
    },
  });
  try {
    for (const [attempt, promotionCode] of [
      ["attempt_unknown_personal_code_123456", "DOES-NOT-EXIST"],
      ["attempt_unrelated_personal_code_123456", "UNRELATED-FAKE"],
      ["attempt_currency_minimum_code_123456", "CURRENCY-MINIMUM-FAKE"],
      ["attempt_matching_not_allowlisted_123456", "MATCHING-NOT-ALLOWLISTED"],
    ]) {
      await assert.rejects(
        () => handler(request({
          ...validCheckoutData(attempt),
          promotionCode,
        })),
        /not valid for the founding-member offer/i
      );
    }
    assert.equal(fakeStripe.state.checkoutSessions.size, sessionsBefore);
    assert.equal((await db.collection("membershipIntents").get()).size, 0);
    assert.equal((await db.collection("membershipCheckoutLocks").get()).size, 0);
  } finally {
    fakeStripe.state.promotionCodes.delete("promo_unrelated_campaign");
    fakeStripe.state.promotionCodes.delete("promo_currency_minimum");
    fakeStripe.state.promotionCodes.delete("promo_matching_not_allowlisted");
    Date.now = realNow;
  }
});

test("the shared code is rejected outside the Adult Unlimited presale", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  try {
    await assert.rejects(
      () => handler(request({
        ...validCheckoutData("attempt_code_wrong_plan_123456"),
        planKey: "adult_ladies",
        promotionCode: "EXISTING-FAKE",
      })),
      /only for the Adult Unlimited founding presale/i
    );

    Date.now = () => PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS * 1000;
    await assert.rejects(
      () => handler(request({
        ...validCheckoutData("attempt_code_after_presale_123456"),
        expectedBillingMode: "standard",
        promotionCode: "EXISTING-FAKE",
      })),
      /only for the Adult Unlimited founding presale/i
    );
    await assert.rejects(
      () => handler(request({
        ...validCheckoutData("attempt_stale_code_page_123456"),
        promotionCode: "EXISTING-FAKE",
      })),
      (error) => {
        assert.equal(error.details?.reason, "billing_policy_changed");
        return true;
      }
    );
    assert.equal((await db.collection("membershipIntents").get()).size, 0);
    assert.equal((await db.collection("membershipCheckoutLocks").get()).size, 0);
  } finally {
    Date.now = realNow;
  }
});

test("a frozen discounted Session remains retryable after the app cutoff", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  const checkoutAt = PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS - 1;
  const data = {
    ...validCheckoutData("attempt_discount_retry_after_cutoff_123456"),
    promotionCode: "EXISTING-FAKE",
  };
  try {
    Date.now = () => checkoutAt * 1000;
    const first = await handler(request(data));

    Date.now = () => (PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS + 60) * 1000;
    const retry = await handler(request(data));

    assert.equal(retry.sessionId, first.sessionId);
    assert.equal(retry.sessionUrl, first.sessionUrl);
    assert.equal((await db.collection("membershipIntents").get()).size, 1);
  } finally {
    Date.now = realNow;
  }
});

test("a presale opened at 23:59:59 can complete after local midnight before its frozen expiry", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  const checkoutAt = PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS - 1;
  Date.now = () => checkoutAt * 1000;
  try {
    const result = await handler(request(
      validCheckoutData("attempt_presale_final_second_123456")
    ));
    const intentSnap = (await db.collection("membershipIntents").get()).docs[0];
    const intent = intentSnap.data();

    assert.equal(intent.billingMode, "presale_deferred");
    assert.equal(intent.checkoutExpiresAt, PRESALE_BILLING_ANCHOR_UNIX_SECONDS - 300);
    assert.ok(intent.checkoutExpiresAt > PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS);

    const subscriptionId = "sub_presale_final_second";
    const customerId = "cus_presale_final_second";
    fakeStripe.setSubscription(subscriptionId, {
      status: "active",
      customer: customerId,
      billing_cycle_anchor: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
      metadata: {intentId: intentSnap.id, planKey: intent.planKey},
    });

    const completedAt = PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS + 60;
    Date.now = () => completedAt * 1000;
    await handleStripeEvent({
      id: "evt_presale_final_second_completed",
      type: "checkout.session.completed",
      created: completedAt,
      data: {object: {
        id: result.sessionId,
        object: "checkout.session",
        livemode: false,
        mode: "subscription",
        status: "complete",
        expires_at: intent.checkoutExpiresAt,
        metadata: {intentId: intentSnap.id, planKey: intent.planKey},
        payment_status: "no_payment_required",
        payment_method_collection: "always",
        subscription: subscriptionId,
        customer: customerId,
        customer_details: {email: "lastsecond@example.test"},
        amount_total: 0,
        discounts: [],
      }},
    }, async () => undefined);

    const membership = await db.collection("memberships")
      .doc(subscriptionId).get();
    assert.equal(membership.get("state"), "scheduled");
    assert.equal(membership.get("firstPaymentReceivedAt"), null);
  } finally {
    Date.now = realNow;
  }
});

test("a presale completion after its frozen expiry is rejected", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  const checkoutAt = PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS - 1;
  Date.now = () => checkoutAt * 1000;
  try {
    const result = await handler(request(
      validCheckoutData("attempt_presale_expired_completion_123456")
    ));
    const intentSnap = (await db.collection("membershipIntents").get()).docs[0];
    const intent = intentSnap.data();
    const subscriptionId = "sub_presale_expired_completion";
    const customerId = "cus_presale_expired_completion";
    fakeStripe.setSubscription(subscriptionId, {
      status: "active",
      customer: customerId,
      billing_cycle_anchor: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
      metadata: {intentId: intentSnap.id, planKey: intent.planKey},
    });

    const completedAt = intent.checkoutExpiresAt + 1;
    Date.now = () => completedAt * 1000;
    await assert.rejects(
      () => handleStripeEvent({
        id: "evt_presale_expired_completion",
        type: "checkout.session.completed",
        created: completedAt,
        data: {object: {
          id: result.sessionId,
          object: "checkout.session",
          livemode: false,
          mode: "subscription",
          status: "complete",
          expires_at: intent.checkoutExpiresAt,
          metadata: {intentId: intentSnap.id, planKey: intent.planKey},
          payment_status: "no_payment_required",
          payment_method_collection: "always",
          subscription: subscriptionId,
          customer: customerId,
          customer_details: {email: "expired@example.test"},
          amount_total: 0,
          discounts: [],
        }},
      }, async () => undefined),
      /frozen £0 presale contract/i
    );
    assert.equal(
      (await db.collection("memberships").doc(subscriptionId).get()).exists,
      false
    );
  } finally {
    Date.now = realNow;
  }
});

test("a stale presale form is rejected after cutoff before reservation or Stripe", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS * 1000;
  try {
    const sessionsBefore = fakeStripe.state.checkoutSessions.size;
    await assert.rejects(
      () => handler(request(
        validCheckoutData("attempt_stale_presale_terms_123456")
      )),
      (error) => {
        assert.equal(error.code, "failed-precondition");
        assert.equal(error.details?.reason, "billing_policy_changed");
        assert.equal(error.details?.expectedBillingMode, "presale_deferred");
        assert.equal(error.details?.currentBillingMode, "standard");
        assert.match(error.message, /terms changed|review them/i);
        return true;
      }
    );
    assert.equal(fakeStripe.state.checkoutSessions.size, sessionsBefore);
    assert.equal((await db.collection("membershipIntents").get()).size, 0);
    assert.equal((await db.collection("membershipCheckoutLocks").get()).size, 0);
  } finally {
    Date.now = realNow;
  }
});

test("checkout after the presale cutoff restores immediate proration", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS * 1000;
  try {
    const result = await handler(request(
      {
        ...validCheckoutData("attempt_postlaunch_standard_123456"),
        expectedBillingMode: "standard",
      }
    ));
    const intent = (await db.collection("membershipIntents").get()).docs[0];
    const sent = fakeStripe.lastUpdateTo("/v1/checkout/sessions");

    assert.equal(intent.get("billingMode"), "standard");
    assert.equal(intent.get("prorationBehavior"), "create_prorations");
    assert.equal(intent.get("initialChargePence"), null);
    assert.equal(sent.payload["subscription_data[proration_behavior]"], "create_prorations");
    assert.equal(sent.payload.allow_promotion_codes, undefined);
    assert.equal(result.promotionCodesEnabled, false);
  } finally {
    Date.now = realNow;
  }
});

test("a youth checkout preserves the child and paying adult and redirects with its plan", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  try {
    const result = await handler(request({
      ...validCheckoutData("attempt_youth_details_123456"),
      planKey: "youth_teenstars",
      participantFullName: "Young Athlete",
      participantDateOfBirth: "2012-05-05",
      participantIsPayer: false,
      signedName: "Paying Adult",
      guardianFullName: "Paying Adult",
      guardianRelationship: "Parent",
      acceptedStatementIds: resolveCheckoutAcceptanceStatements("youth_teenstars")
        .map(({id}) => id),
    }));

    const intent = (await db.collection("membershipIntents").get()).docs[0];
    assert.deepEqual(intent.get("participant"), {
      fullName: "Young Athlete",
      dateOfBirth: "2012-05-05",
      age: 14,
      isPayer: false,
      participantKey: membershipTesting.participantKeyFor(
        "Young Athlete",
        "2012-05-05"
      ),
    });
    assert.deepEqual(intent.get("guardian"), {
      fullName: "Paying Adult",
      relationship: "Parent",
      confirmedAuthority: true,
    });
    assert.equal(intent.get("checkoutSessionId"), result.sessionId);

    const sent = fakeStripe.lastUpdateTo("/v1/checkout/sessions");
    assert.ok(sent);
    assert.equal(
      sent.payload.success_url,
      "https://alpha-wod.vercel.app/memberships/success?" +
        "session_id={CHECKOUT_SESSION_ID}&plan=youth_teenstars"
    );
    assert.equal(sent.payload["metadata[planKey]"], "youth_teenstars");
  } finally {
    Date.now = realNow;
  }
});

test("youth q1, q2, and q3 checkout derives exact quantity, subtotal, and family Coupon", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  const planCases = [
    {
      planKey: "youth_youngstars",
      priceId: "price_youngstars",
      planName: "MINI ALPHAS - 10 & Under",
      unitAmountPence: 3000,
      datesOfBirth: ["2017-05-05", "2018-06-06", "2019-07-07"],
    },
    {
      planKey: "youth_teenstars",
      priceId: "price_teenstars",
      planName: "TEEN ALPHAS - 11 & UP",
      unitAmountPence: 3500,
      datesOfBirth: ["2012-05-05", "2011-06-06", "2010-07-07"],
    },
  ];
  const sessionsBefore = fakeStripe.state.checkoutSessions.size;

  try {
    for (const planCase of planCases) {
      assert.equal(
        fakeStripe.state.prices.get(planCase.priceId).unit_amount,
        planCase.unitAmountPence
      );
      assert.equal(
        fakeStripe.state.prices.get(planCase.priceId).product.name,
        planCase.planName
      );
      for (const participantCount of [1, 2, 3]) {
        const children = planCase.datesOfBirth
          .slice(0, participantCount)
          .map((dateOfBirth, index) => ({
            fullName: `${planCase.planKey} q${participantCount} Child ${index + 1}`,
            dateOfBirth,
          }));
        const checkout = await handler(request(youthCheckoutData({
          planKey: planCase.planKey,
          attemptId: `attempt_${planCase.planKey}_q${participantCount}_billing`,
          children,
        })));
        const intentQuery = await db.collection("membershipIntents")
          .where("checkoutSessionId", "==", checkout.sessionId)
          .get();
        assert.equal(intentQuery.size, 1);
        const intent = intentQuery.docs[0];
        const familyDiscountApplies = participantCount >= 2;
        const standardMonthlyPence =
          planCase.unitAmountPence * participantCount;
        const recurringMonthlyPence = familyDiscountApplies ?
          Math.round(standardMonthlyPence * 0.85) : standardMonthlyPence;

        assert.equal(intent.get("participantCount"), participantCount);
        assert.equal(intent.get("participants").length, participantCount);
        assert.equal(intent.get("participantKeys").length, participantCount);
        assert.equal(new Set(intent.get("participantKeys")).size, participantCount);
        assert.deepEqual(intent.get("order"), {
          participantCount,
          unitAmountPence: planCase.unitAmountPence,
          standardMonthlyPence,
          familyDiscountPercent: familyDiscountApplies ? 15 : null,
          recurringMonthlyPence,
        });
        assert.equal(
          intent.get("familyDiscountCouponId"),
          familyDiscountApplies ? "coupon_youth_family_15pct" : null
        );

        const sent = fakeStripe.lastUpdateTo("/v1/checkout/sessions");
        assert.equal(sent.payload["line_items[0][price]"], planCase.priceId);
        assert.equal(
          sent.payload["line_items[0][quantity]"],
          String(participantCount)
        );
        assert.equal(
          sent.payload["discounts[0][coupon]"],
          familyDiscountApplies ? "coupon_youth_family_15pct" : undefined
        );
        assert.equal(sent.payload["discounts[0][promotion_code]"], undefined);
        assert.equal(sent.payload.allow_promotion_codes, undefined);
        assert.equal(
          sent.payload["metadata[participantCount]"],
          String(participantCount)
        );

        const providerSession = fakeStripe.state.checkoutSessions.get(
          checkout.sessionId
        );
        assert.deepEqual(providerSession.line_items, [{
          price: planCase.priceId,
          quantity: participantCount,
        }]);
        assert.deepEqual(providerSession.discounts, familyDiscountApplies ? [{
          coupon: "coupon_youth_family_15pct",
          promotion_code: null,
        }] : []);

        const locks = await db.collection("membershipCheckoutLocks")
          .where("intentId", "==", intent.id)
          .get();
        assert.equal(locks.size, participantCount);
      }
    }
    assert.equal(
      fakeStripe.state.checkoutSessions.size,
      sessionsBefore + planCases.length * 3
    );
  } finally {
    Date.now = realNow;
  }
});

test("the backend accepts ten youth participants and rejects eleven", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  const sessionsBefore = fakeStripe.state.checkoutSessions.size;
  const children = Array.from({length: 11}, (_, index) => ({
    fullName: `Youngstars Boundary Child ${index + 1}`,
    dateOfBirth: "2018-05-05",
  }));

  try {
    const accepted = await handler(request(youthCheckoutData({
      planKey: "youth_youngstars",
      attemptId: "attempt_youngstars_ten_children",
      children: children.slice(0, 10),
    })));
    const acceptedIntent = await db.collection("membershipIntents")
      .where("checkoutSessionId", "==", accepted.sessionId)
      .get();
    assert.equal(acceptedIntent.size, 1);
    assert.equal(acceptedIntent.docs[0].get("participantCount"), 10);
    assert.equal(
      fakeStripe.state.checkoutSessions.get(accepted.sessionId).line_items[0].quantity,
      10
    );

    await assert.rejects(
      () => handler(request(youthCheckoutData({
        planKey: "youth_youngstars",
        attemptId: "attempt_youngstars_eleven_children",
        children,
      }))),
      /at most 10 children/i
    );
    assert.equal(fakeStripe.state.checkoutSessions.size, sessionsBefore + 1);
  } finally {
    Date.now = realNow;
  }
});

test("q2 MINI ALPHAS and TEEN ALPHAS fulfil with a forever 15% recurring schedule", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  const fixedNow = new Date("2026-08-18T10:00:00Z").getTime();
  Date.now = () => fixedNow;
  const planCases = [
    {
      planKey: "youth_youngstars",
      priceId: "price_youngstars",
      planName: "MINI ALPHAS - 10 & Under",
      unitAmountPence: 3000,
      standardMonthlyPence: 6000,
      recurringMonthlyPence: 5100,
      datesOfBirth: ["2017-05-05", "2018-06-06"],
    },
    {
      planKey: "youth_teenstars",
      priceId: "price_teenstars",
      planName: "TEEN ALPHAS - 11 & UP",
      unitAmountPence: 3500,
      standardMonthlyPence: 7000,
      recurringMonthlyPence: 5950,
      datesOfBirth: ["2012-05-05", "2011-06-06"],
    },
  ];

  try {
    for (const planCase of planCases) {
      const children = planCase.datesOfBirth.map((dateOfBirth, index) => ({
        fullName: `${planCase.planKey} Fulfil Child ${index + 1}`,
        dateOfBirth,
      }));
      const checkout = await handler(request(youthCheckoutData({
        planKey: planCase.planKey,
        attemptId: `attempt_${planCase.planKey}_q2_fulfil`,
        children,
      })));
      const intentQuery = await db.collection("membershipIntents")
        .where("checkoutSessionId", "==", checkout.sessionId)
        .get();
      assert.equal(intentQuery.size, 1);
      const intent = intentQuery.docs[0];
      const subscriptionId = `sub_${planCase.planKey}_q2_family`;
      const customerId = `cus_${planCase.planKey}_q2_family`;
      const completedAt = Math.floor(fixedNow / 1000);
      fakeStripe.setSubscription(subscriptionId, {
        status: "active",
        customer: customerId,
        billing_cycle_anchor: intent.get("billingCycleAnchor"),
        metadata: {
          intentId: intent.id,
          planKey: planCase.planKey,
          participantCount: "2",
        },
        discounts: [{
          id: `di_${planCase.planKey}_q2_family`,
          object: "discount",
          source: {type: "coupon", coupon: "coupon_youth_family_15pct"},
          promotion_code: null,
          start: completedAt,
          end: null,
        }],
        items: {
          object: "list",
          data: [{
            id: `si_${planCase.planKey}_q2_family`,
            current_period_end: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
            price: planCase.priceId,
            quantity: 2,
          }],
        },
      });
      const providerSession = fakeStripe.state.checkoutSessions.get(
        checkout.sessionId
      );
      Object.assign(providerSession, {
        status: "complete",
        payment_status: "no_payment_required",
        payment_method_collection: "always",
        subscription: subscriptionId,
        customer: customerId,
        customer_details: {
          email: `${planCase.planKey}@example.test`,
        },
        amount_total: 0,
      });
      fakeStripe.state.checkoutSessions.set(checkout.sessionId, providerSession);

      await handleStripeEvent({
        id: `evt_${planCase.planKey}_q2_family`,
        type: "checkout.session.completed",
        created: completedAt,
        data: {object: {id: checkout.sessionId}},
      }, async () => undefined);

      const membership = await db.collection("memberships")
        .doc(subscriptionId)
        .get();
      assert.equal(membership.get("providerContractStatus"), "verified");
      assert.equal(
        membership.get("commercialTerms.planName"),
        planCase.planName
      );
      assert.equal(membership.get("state"), "scheduled");
      assert.equal(membership.get("participantCount"), 2);
      assert.equal(membership.get("participants").length, 2);
      assert.deepEqual(membership.get("order"), {
        participantCount: 2,
        unitAmountPence: planCase.unitAmountPence,
        standardMonthlyPence: planCase.standardMonthlyPence,
        familyDiscountPercent: 15,
        recurringMonthlyPence: planCase.recurringMonthlyPence,
      });
      assert.deepEqual(membership.get("discount"), {
        kind: "youth_family",
        couponId: "coupon_youth_family_15pct",
        promotionCodeId: null,
        amountOffPence: null,
        percentOff: 15,
        currency: null,
        duration: "forever",
        durationInMonths: null,
        startsAt: completedAt,
        endsAt: null,
      });
      assert.deepEqual(membership.get("paymentSchedule"), {
        amountDueTodayPence: 0,
        firstPaymentAt: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
        standardMonthlyPence: planCase.standardMonthlyPence,
        discountedMonthlyPence: planCase.recurringMonthlyPence,
        discountedPaymentCount: null,
        fullPriceFrom: null,
      });
      const confirmationOutbox = await db.collection("membershipEmailOutbox")
        .doc(subscriptionId)
        .get();
      assert.equal(confirmationOutbox.exists, true);
      assert.equal(confirmationOutbox.get("kind"), "membership_confirmation");
      const [agreementAttachment] = confirmationOutbox.get("payload.attachments");
      assert.equal(agreementAttachment.filename, "membership-agreement.html");
      const confirmationHtml = Buffer.from(
        agreementAttachment.content,
        "base64"
      ).toString("utf8");
      const discountAmountPence = planCase.standardMonthlyPence -
        planCase.recurringMonthlyPence;
      const standardTotal = `£${(planCase.standardMonthlyPence / 100).toFixed(2)}`;
      const discountAmount = `£${(discountAmountPence / 100).toFixed(2)}`;
      const recurringTotal = `£${(planCase.recurringMonthlyPence / 100).toFixed(2)}`;
      assert.match(
        confirmationHtml,
        />Contracted quantity<\/td><td[^>]*><strong>2 children<\/strong>/
      );
      assert.match(
        confirmationHtml,
        new RegExp(
          ">Price per child<\\/td><td[^>]*><strong>" +
          `£${(planCase.unitAmountPence / 100).toFixed(2)} per month` +
          "<\\/strong>"
        )
      );
      assert.match(confirmationHtml, />Undiscounted monthly subtotal<\/td>/);
      assert.ok(confirmationHtml.includes(
        `<strong>${standardTotal} per month</strong>`
      ));
      assert.match(confirmationHtml, />Family discount<\/td>/);
      assert.ok(confirmationHtml.includes(
        `<strong>15% (−${discountAmount}) off the ${standardTotal} subtotal; ` +
        `${recurringTotal} per month while this subscription covers at least two children</strong>`
      ));
      assert.match(
        confirmationHtml,
        new RegExp(
          ">Recurring monthly total<\\/td><td[^>]*><strong>" +
          `${recurringTotal} per month<\\/strong>`
        )
      );
      const welcomePayload = membershipTesting.buildWelcomePayload(
        membership.data()
      );
      assert.ok(welcomePayload);
      assert.match(welcomePayload.html, /15% family discount/i);
      assert.doesNotMatch(welcomePayload.html, /10% family discount/i);
    }
  } finally {
    Date.now = realNow;
  }
});

test("fulfilment preserves a frozen in-flight 10% youth family checkout", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  const fixedNow = new Date("2026-08-18T10:00:00Z").getTime();
  Date.now = () => fixedNow;

  try {
    const checkout = await handler(request(youthCheckoutData({
      planKey: "youth_youngstars",
      attemptId: "attempt_frozen_10pct_q2_fulfil",
      children: [
        {fullName: "Legacy Child One", dateOfBirth: "2017-05-05"},
        {fullName: "Legacy Child Two", dateOfBirth: "2018-06-06"},
      ],
    })));
    const intentQuery = await db.collection("membershipIntents")
      .where("checkoutSessionId", "==", checkout.sessionId)
      .get();
    assert.equal(intentQuery.size, 1);
    const intentRef = intentQuery.docs[0].ref;
    await intentRef.update({
      "schemaVersion": 3,
      "familyDiscountCouponId": "coupon_youth_family_10pct",
      "order.familyDiscountPercent": 10,
      "order.recurringMonthlyPence": 5400,
    });
    const intent = await intentRef.get();
    const subscriptionId = "sub_frozen_youth_family_10pct";
    const customerId = "cus_frozen_youth_family_10pct";
    const completedAt = Math.floor(fixedNow / 1000);
    fakeStripe.setSubscription(subscriptionId, {
      status: "active",
      customer: customerId,
      billing_cycle_anchor: intent.get("billingCycleAnchor"),
      metadata: {
        intentId: intent.id,
        planKey: "youth_youngstars",
        participantCount: "2",
      },
      discounts: [{
        id: "di_frozen_youth_family_10pct",
        object: "discount",
        source: {type: "coupon", coupon: "coupon_youth_family_10pct"},
        promotion_code: null,
        start: completedAt,
        end: null,
      }],
      items: {
        object: "list",
        data: [{
          id: "si_frozen_youth_family_10pct",
          current_period_end: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
          price: "price_youngstars",
          quantity: 2,
        }],
      },
    });
    const providerSession = fakeStripe.state.checkoutSessions.get(
      checkout.sessionId
    );
    Object.assign(providerSession, {
      status: "complete",
      payment_status: "no_payment_required",
      payment_method_collection: "always",
      subscription: subscriptionId,
      customer: customerId,
      customer_details: {email: "frozen-family@example.test"},
      amount_total: 0,
      discounts: [{
        coupon: "coupon_youth_family_10pct",
        promotion_code: null,
      }],
    });
    fakeStripe.state.checkoutSessions.set(checkout.sessionId, providerSession);

    await handleStripeEvent({
      id: "evt_frozen_youth_family_10pct",
      type: "checkout.session.completed",
      created: completedAt,
      data: {object: {id: checkout.sessionId}},
    }, async () => undefined);

    const membershipSnapshot = await db.collection("memberships")
      .doc(subscriptionId)
      .get();
    assert.equal(membershipSnapshot.get("providerContractStatus"), "verified");
    assert.deepEqual(membershipSnapshot.get("order"), {
      participantCount: 2,
      unitAmountPence: 3000,
      standardMonthlyPence: 6000,
      familyDiscountPercent: 10,
      recurringMonthlyPence: 5400,
    });
    assert.deepEqual(membershipSnapshot.get("discount"), {
      kind: "youth_family",
      couponId: "coupon_youth_family_10pct",
      promotionCodeId: null,
      amountOffPence: null,
      percentOff: 10,
      currency: null,
      duration: "forever",
      durationInMonths: null,
      startsAt: completedAt,
      endsAt: null,
    });
    assert.deepEqual(membershipSnapshot.get("paymentSchedule"), {
      amountDueTodayPence: 0,
      firstPaymentAt: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
      standardMonthlyPence: 6000,
      discountedMonthlyPence: 5400,
      discountedPaymentCount: null,
      fullPriceFrom: null,
    });

    const confirmationOutbox = await db.collection("membershipEmailOutbox")
      .doc(subscriptionId)
      .get();
    const [agreementAttachment] = confirmationOutbox.get("payload.attachments");
    const confirmationHtml = Buffer.from(
      agreementAttachment.content,
      "base64"
    ).toString("utf8");
    assert.match(confirmationHtml, /10% \(−£6\.00\).*£54\.00 per month/i);
    assert.doesNotMatch(confirmationHtml, /15% \(−£9\.00\)/i);

    const welcomePayload = membershipTesting.buildWelcomePayload(
      membershipSnapshot.data()
    );
    assert.ok(welcomePayload);
    assert.match(welcomePayload.html, /10% family discount/i);
    assert.doesNotMatch(welcomePayload.html, /15% family discount/i);
  } finally {
    Date.now = realNow;
  }
});

test("every adult plan rejects a purchase made for another adult before Stripe", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const sessionsBefore = fakeStripe.state.checkoutSessions.size;
  const adultPlanKeys = ["adult_unlimited", "adult_ladies", "adult_gym"];

  for (const planKey of adultPlanKeys) {
    await assert.rejects(
      () => handler(request({
        ...validCheckoutData(`attempt_third_party_${planKey}`),
        planKey,
        participantFullName: "Adult Participant",
        participantIsPayer: false,
        signedName: "Paying Adult",
      })),
      /adult membership must be purchased by the participant for themselves/i
    );
  }

  assert.equal(fakeStripe.state.checkoutSessions.size, sessionsBefore);
  assert.equal((await db.collection("membershipIntents").get()).size, 0);
  assert.equal((await db.collection("membershipCheckoutLocks").get()).size, 0);
});

test("adult checkout rejects additional participants before Stripe", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const sessionsBefore = fakeStripe.state.checkoutSessions.size;

  await assert.rejects(
    () => handler(request({
      ...validCheckoutData("attempt_adult_additional_participant"),
      additionalParticipants: [{
        fullName: "Another Adult",
        dateOfBirth: "1991-02-02",
      }],
    })),
    /additional participants are available only for youth memberships/i
  );

  assert.equal(fakeStripe.state.checkoutSessions.size, sessionsBefore);
  assert.equal((await db.collection("membershipIntents").get()).size, 0);
  assert.equal((await db.collection("membershipCheckoutLocks").get()).size, 0);
});

test("TEEN ALPHAS accepts a six-year-old as either primary or additional child", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  const sessionsBefore = fakeStripe.state.checkoutSessions.size;
  const crossProgrammeCases = [
    youthCheckoutData({
      planKey: "youth_teenstars",
      attemptId: "attempt_teen_alphas_primary_age_six",
      children: [
        {fullName: "Six Year Old Primary", dateOfBirth: "2020-08-18"},
        {fullName: "Teen Additional", dateOfBirth: "2012-05-05"},
      ],
    }),
    youthCheckoutData({
      planKey: "youth_teenstars",
      attemptId: "attempt_teen_alphas_additional_age_six",
      children: [
        {fullName: "Teen Primary", dateOfBirth: "2011-06-06"},
        {fullName: "Six Year Old Additional", dateOfBirth: "2020-08-18"},
      ],
    }),
  ];

  try {
    for (const data of crossProgrammeCases) {
      const result = await handler(request(data));
      assert.ok(result.sessionId);
    }

    assert.equal(fakeStripe.state.checkoutSessions.size, sessionsBefore + 2);
    const intents = await db.collection("membershipIntents").get();
    assert.equal(intents.size, 2);
    for (const intent of intents.docs) {
      assert.equal(intent.get("planKey"), "youth_teenstars");
      assert.equal(
        intent.get("commercialTerms.planName"),
        "TEEN ALPHAS - 11 & UP"
      );
      assert.equal(intent.get("commercialTerms.amountPence"), 3500);
      assert.equal(intent.get("participantCount"), 2);
      assert.ok(intent.get("participants").some(({age}) => age === 6));
    }
  } finally {
    Date.now = realNow;
  }
});

test("youth checkout still rejects future and malformed dates of birth", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  const sessionsBefore = fakeStripe.state.checkoutSessions.size;
  const invalidCases = [
    {
      data: youthCheckoutData({
        planKey: "youth_teenstars",
        attemptId: "attempt_teen_alphas_future_primary_dob",
        children: [{fullName: "Future Child", dateOfBirth: "2026-08-19"}],
      }),
      message: /valid participant date of birth/i,
    },
    {
      data: youthCheckoutData({
        planKey: "youth_teenstars",
        attemptId: "attempt_teen_alphas_malformed_additional_dob",
        children: [
          {fullName: "Valid Primary", dateOfBirth: "2012-05-05"},
          {fullName: "Invalid Additional", dateOfBirth: "2020-02-30"},
        ],
      }),
      message: /valid date of birth for child 2/i,
    },
  ];

  try {
    for (const {data, message} of invalidCases) {
      await assert.rejects(() => handler(request(data)), message);
    }
    assert.equal(fakeStripe.state.checkoutSessions.size, sessionsBefore);
    assert.equal((await db.collection("membershipIntents").get()).size, 0);
    assert.equal((await db.collection("membershipCheckoutLocks").get()).size, 0);
  } finally {
    Date.now = realNow;
  }
});

test("the same child cannot bypass a youth checkout lock with name variants", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  const sessionsBefore = fakeStripe.state.checkoutSessions.size;

  try {
    const variants = [
      " duplicate child ",
      "Duplicate   Child",
      "Ｄｕｐｌｉｃａｔｅ Child",
    ];
    for (const [index, variant] of variants.entries()) {
      await assert.rejects(
        () => handler(request(youthCheckoutData({
          planKey: "youth_youngstars",
          attemptId: `attempt_duplicate_youngstar_child_${index}`,
          children: [
            {fullName: "Duplicate Child", dateOfBirth: "2018-05-05"},
            {fullName: variant, dateOfBirth: "2018-05-05"},
          ],
        }))),
        /each child can be included only once/i
      );
    }
    assert.equal(fakeStripe.state.checkoutSessions.size, sessionsBefore);
    assert.equal((await db.collection("membershipIntents").get()).size, 0);
    assert.equal((await db.collection("membershipCheckoutLocks").get()).size, 0);
  } finally {
    Date.now = realNow;
  }
});

test("checkout rejects unsafe characters in every person-name field", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  const sessionsBefore = fakeStripe.state.checkoutSessions.size;
  const checkoutFor = (attemptId) => youthCheckoutData({
    planKey: "youth_youngstars",
    attemptId,
    children: [
      {fullName: "Primary Child", dateOfBirth: "2018-05-05"},
      {fullName: "Additional Child", dateOfBirth: "2017-06-06"},
    ],
  });
  const cases = [
    {
      data: {...checkoutFor("attempt_unsafe_primary_name"),
        participantFullName: "Primary\u200b Child"},
      field: "participantFullName",
    },
    {
      data: (() => {
        const data = checkoutFor("attempt_unsafe_additional_name");
        data.additionalParticipants[0].fullName = "Additional\u00ad Child";
        return data;
      })(),
      field: "additionalParticipants[0].fullName",
    },
    {
      data: {...checkoutFor("attempt_unsafe_guardian_name"),
        guardianFullName: "Paying\u202e Adult"},
      field: "guardianFullName",
    },
    {
      data: {...checkoutFor("attempt_unsafe_signed_name"),
        signedName: "Paying\u2060 Adult"},
      field: "signedName",
    },
    {
      data: {...checkoutFor("attempt_control_signed_name"),
        signedName: "Paying\nAdult"},
      field: "signedName",
    },
  ];

  try {
    for (const {data, field} of cases) {
      await assert.rejects(
        () => handler(request(data)),
        (error) => {
          assert.equal(error.code, "invalid-argument");
          assert.match(error.message, /unsupported invisible or control characters/i);
          assert.ok(error.message.includes(field));
          return true;
        }
      );
    }
    assert.equal(
      membershipTesting.participantKeyFor(
        "Invisible\u200b Child",
        "2018-05-05"
      ),
      membershipTesting.participantKeyFor("Invisible Child", "2018-05-05")
    );
    assert.equal(
      membershipTesting.participantKeyFor(
        "Invisible\nChild",
        "2018-05-05"
      ),
      membershipTesting.participantKeyFor("Invisible Child", "2018-05-05")
    );
    assert.equal(fakeStripe.state.checkoutSessions.size, sessionsBefore);
    assert.equal((await db.collection("membershipIntents").get()).size, 0);
    assert.equal((await db.collection("membershipCheckoutLocks").get()).size, 0);
  } finally {
    Date.now = realNow;
  }
});

test("pre-v2 singular memberships block canonically equivalent new checkouts", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  const legacyCases = [
    {
      id: "spaces",
      storedName: "Legacy   Child",
      requestedName: "Legacy Child",
      dateOfBirth: "2018-05-05",
    },
    {
      id: "fullwidth",
      storedName: "Ｆｕｌｌｗｉｄｔｈ Child",
      requestedName: "Fullwidth Child",
      dateOfBirth: "2017-06-06",
    },
  ];

  try {
    for (const legacyCase of legacyCases) {
      await seedMembership(`sub_legacy_${legacyCase.id}`, {
        planKey: "youth_youngstars",
        stripePriceId: "price_youngstars",
        participant: {
          fullName: legacyCase.storedName,
          dateOfBirth: legacyCase.dateOfBirth,
          age: 9,
          isPayer: false,
          participantKey: legacyParticipantKeyFor(
            legacyCase.storedName,
            legacyCase.dateOfBirth
          ),
        },
      });
    }
    const sessionsBefore = fakeStripe.state.checkoutSessions.size;

    for (const legacyCase of legacyCases) {
      await assert.rejects(
        () => handler(request(youthCheckoutData({
          planKey: "youth_youngstars",
          attemptId: `attempt_legacy_${legacyCase.id}_bypass`,
          children: [{
            fullName: legacyCase.requestedName,
            dateOfBirth: legacyCase.dateOfBirth,
          }],
        }))),
        (error) => {
          assert.equal(error.code, "already-exists");
          assert.equal(error.details?.reason, "checkout_in_progress");
          return true;
        }
      );
    }
    assert.equal(fakeStripe.state.checkoutSessions.size, sessionsBefore);
    assert.equal((await db.collection("membershipIntents").get()).size, 0);
    assert.equal((await db.collection("membershipCheckoutLocks").get()).size, 0);
  } finally {
    Date.now = realNow;
  }
});

test("a legacy singular DOB match does not block a different sibling", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  const dateOfBirth = "2018-05-05";

  try {
    await seedMembership("sub_legacy_same_birthday_sibling", {
      planKey: "youth_youngstars",
      stripePriceId: "price_youngstars",
      participant: {
        fullName: "Existing Sibling",
        dateOfBirth,
        age: 8,
        isPayer: false,
        participantKey: legacyParticipantKeyFor("Existing Sibling", dateOfBirth),
      },
    });
    const sessionsBefore = fakeStripe.state.checkoutSessions.size;
    const checkout = await handler(request(youthCheckoutData({
      planKey: "youth_youngstars",
      attemptId: "attempt_same_birthday_different_sibling",
      children: [{fullName: "Different Sibling", dateOfBirth}],
    })));

    assert.ok(checkout.sessionId);
    assert.equal(fakeStripe.state.checkoutSessions.size, sessionsBefore + 1);
    const intents = await db.collection("membershipIntents").get();
    assert.equal(intents.size, 1);
    assert.equal(intents.docs[0].get("participant.fullName"), "Different Sibling");
  } finally {
    Date.now = realNow;
  }
});

test("a retry never returns a Checkout Session frozen in another Stripe mode", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  try {
    const data = validCheckoutData("attempt_cross_mode_retry_123456");
    await handler(request(data));
    const intents = await db.collection("membershipIntents").get();
    assert.equal(intents.size, 1);
    await intents.docs[0].ref.set({stripeMode: "live"}, {merge: true});

    await assert.rejects(
      () => handler(request(data)),
      /another Stripe environment/i
    );
  } finally {
    Date.now = realNow;
  }
});

test("a signed-in buyer without a profile cannot leave a checkout lock", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );

  await assert.rejects(
    () => handler(request(
      validCheckoutData("attempt_missing_profile_preflight"),
      "profilelessbuyer"
    )),
    /Create your profile before purchasing/i
  );

  assert.equal((await db.collection("membershipIntents").get()).size, 0);
  assert.equal((await db.collection("membershipCheckoutLocks").get()).size, 0);
});

test("a mismatched Stripe price is rejected before checkout reserves identity", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  const price = fakeStripe.state.prices.get("price_unlimited");
  const originalAmount = price.unit_amount;
  price.unit_amount = 1;
  try {
    await assert.rejects(
      () => handler(request(validCheckoutData("attempt_bad_price_preflight"))),
      /does not match the approved catalogue/i
    );
    assert.equal((await db.collection("membershipIntents").get()).size, 0);
    assert.equal((await db.collection("membershipCheckoutLocks").get()).size, 0);
  } finally {
    price.unit_amount = originalAmount;
    Date.now = realNow;
  }
});

test("an elapsed same-attempt retry keeps a completed Stripe session processing", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  const fixedNow = new Date("2026-08-18T10:00:00Z").getTime();
  Date.now = () => fixedNow;
  try {
    const data = validCheckoutData("attempt_elapsed_paid_handler");
    const first = await handler(request(data));
    const intentQuery = await db.collection("membershipIntents").get();
    assert.equal(intentQuery.size, 1);
    const intentRef = intentQuery.docs[0].ref;
    const session = fakeStripe.state.checkoutSessions.get(first.sessionId);
    session.status = "complete";
    session.payment_status = "paid";
    fakeStripe.state.checkoutSessions.set(first.sessionId, session);
    Date.now = () => (session.expires_at + 1) * 1000;

    await assert.rejects(
      () => handler(request(data)),
      (error) => {
        assert.equal(error.code, "failed-precondition");
        assert.equal(error.details?.reason, "checkout_processing");
        return true;
      }
    );

    assert.equal((await intentRef.get()).get("status"), "payment_pending");
    const locks = await db.collection("membershipCheckoutLocks").get();
    assert.equal(locks.size, 1);
    assert.equal(locks.docs[0].get("intentId"), intentRef.id);
    assert.equal(locks.docs[0].get("status"), "payment_pending");
  } finally {
    Date.now = realNow;
  }
});

test("an expired reserved attempt without a Stripe session releases after validation", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  const fixedNow = new Date("2026-08-18T10:00:00Z").getTime();
  Date.now = () => fixedNow;
  try {
    const data = validCheckoutData("attempt_reserved_without_session");
    const attemptHash = createHash("sha256")
      .update(`membership-checkout:${data.checkoutAttemptId}`)
      .digest("hex");
    const participantKey = membershipTesting.participantKeyFor(
      data.participantFullName,
      data.participantDateOfBirth
    );
    const intentRef = db.collection("membershipIntents")
      .doc(`attempt_${attemptHash}`);
    const intent = reservationIntent("reserved_without_session", {
      participantKey,
      participantName: data.participantFullName,
    });
    intent.checkoutAttemptHash = attemptHash;
    intent.acceptances.signedName = data.signedName;
    intent.checkoutExpiresAt = Math.floor(fixedNow / 1000) - 60;
    intent.billingCycleAnchor = Math.floor(fixedNow / 1000) + 3600;
    intent.reservationExpiresAt = admin.firestore.Timestamp.fromMillis(fixedNow - 1000);
    intent.requestFingerprint = membershipTesting.checkoutRequestFingerprint({
      payerUid: null,
      planKey: data.planKey,
      expectedBillingMode: data.expectedBillingMode,
      promotionCode: data.promotionCode ?? null,
      participant: intent.participant,
      guardian: null,
      signedName: data.signedName,
      commercialTerms: intent.commercialTerms,
      acceptances: {
        signerRole: intent.acceptances.signerRole,
        documents: intent.acceptances.documents,
        statements: intent.acceptances.statements,
        acceptedStatementIds: intent.acceptances.acceptedStatementIds,
        immediatePerformanceRequested: true,
      },
    });
    await membershipTesting.reserveCheckoutAttempt(intentRef, intent, fixedNow);

    await assert.rejects(
      () => handler(request(data)),
      (error) => {
        assert.match(error.message, /checkout attempt expired/i);
        assert.equal(error.code, "deadline-exceeded");
        return true;
      }
    );

    const failedIntent = await intentRef.get();
    assert.equal(failedIntent.get("status"), "failed");
    assert.equal(failedIntent.get("failureKind"), "checkout_attempt_expired");
    assert.equal((await db.collection("membershipCheckoutLocks").get()).size, 0);
  } finally {
    Date.now = realNow;
  }
});

test("a reserved attempt below Stripe's minimum window ends as an attempt expiry", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  const fixedNow = new Date("2026-08-18T10:00:00Z").getTime();
  Date.now = () => fixedNow;
  try {
    const data = validCheckoutData("attempt_reserved_below_stripe_minimum");
    const attemptHash = createHash("sha256")
      .update(`membership-checkout:${data.checkoutAttemptId}`)
      .digest("hex");
    const participantKey = membershipTesting.participantKeyFor(
      data.participantFullName,
      data.participantDateOfBirth
    );
    const intentRef = db.collection("membershipIntents")
      .doc(`attempt_${attemptHash}`);
    const intent = reservationIntent("reserved_below_stripe_minimum", {
      participantKey,
      participantName: data.participantFullName,
    });
    intent.checkoutAttemptHash = attemptHash;
    intent.acceptances.signedName = data.signedName;
    intent.checkoutExpiresAt = Math.floor(fixedNow / 1000) + 10 * 60;
    intent.billingCycleAnchor = Math.floor(fixedNow / 1000) + 60 * 60;
    intent.reservationExpiresAt = admin.firestore.Timestamp.fromMillis(
      fixedNow + 70 * 60 * 1000
    );
    intent.requestFingerprint = membershipTesting.checkoutRequestFingerprint({
      payerUid: null,
      planKey: data.planKey,
      expectedBillingMode: data.expectedBillingMode,
      promotionCode: data.promotionCode ?? null,
      participant: intent.participant,
      guardian: null,
      signedName: data.signedName,
      commercialTerms: intent.commercialTerms,
      acceptances: {
        signerRole: intent.acceptances.signerRole,
        documents: intent.acceptances.documents,
        statements: intent.acceptances.statements,
        acceptedStatementIds: intent.acceptances.acceptedStatementIds,
        immediatePerformanceRequested: true,
      },
    });
    await membershipTesting.reserveCheckoutAttempt(intentRef, intent, fixedNow);

    await assert.rejects(
      () => handler(request(data)),
      (error) => {
        assert.match(error.message, /checkout attempt expired/i);
        assert.equal(error.code, "deadline-exceeded");
        return true;
      }
    );

    const failedIntent = await intentRef.get();
    assert.equal(failedIntent.get("status"), "failed");
    assert.equal(failedIntent.get("failureKind"), "checkout_attempt_expired");
    assert.equal((await db.collection("membershipCheckoutLocks").get()).size, 0);
  } finally {
    Date.now = realNow;
  }
});

test("the customer portal handler uses the locked-down portal configuration", async () => {
  await createMember("portalbuyer");
  await seedMembership("sub_portal_test", {
    payerUid: "portalbuyer",
    stripeCustomerId: "cus_portal_test",
  });

  const result = await createCustomerPortalSession(request({
    subscriptionId: "sub_portal_test",
  }, "portalbuyer"));
  assert.equal(result.portalUrl, "https://portal.stripe.test/session");
  const payload = fakeStripe.state.portalSessions.at(-1);
  assert.equal(payload.customer, "cus_portal_test");
  assert.equal(payload.configuration, "bpc_fake");
  assert.equal(payload.return_url, "https://alpha-wod.vercel.app/account/membership");
});

test("the customer portal refuses drift from every locked-down feature", async () => {
  await createMember("unsafeportalbuyer");
  await seedMembership("sub_unsafe_portal", {
    payerUid: "unsafeportalbuyer",
    stripeCustomerId: "cus_unsafe_portal",
  });
  const configuration = fakeStripe.state.portalConfigurations.get("bpc_fake");
  const sessionsBefore = fakeStripe.state.portalSessions.length;
  const unsafeMutations = [
    ["hosted login", configuration.login_page, true],
    ["customer updates", configuration.features.customer_update, true],
    ["invoice history", configuration.features.invoice_history, false],
    ["payment-method updates", configuration.features.payment_method_update, false],
    ["subscription cancellation", configuration.features.subscription_cancel, true],
    ["subscription pause", configuration.features.subscription_pause, true],
    ["subscription updates", configuration.features.subscription_update, true],
  ];

  for (const [label, feature, unsafeValue] of unsafeMutations) {
    const original = feature.enabled;
    feature.enabled = unsafeValue;
    try {
      await assert.rejects(
        () => createCustomerPortalSession(request({
          subscriptionId: "sub_unsafe_portal",
        }, "unsafeportalbuyer")),
        (error) => error.code === "failed-precondition" &&
          /configuration is unsafe/i.test(error.message),
        label
      );
      assert.equal(fakeStripe.state.portalSessions.length, sessionsBefore, label);
    } finally {
      feature.enabled = original;
    }
  }
});

test("the public webhook verifies Stripe signatures before durable processing", async () => {
  const event = {
    id: "evt_signed_webhook",
    object: "event",
    api_version: "2026-07-29.basil",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: null,
    type: "customer.created",
    data: {object: {id: "cus_signed", object: "customer"}},
  };
  const payload = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET,
  });

  const accepted = await invokeStripeWebhook(payload, signature);
  assert.equal(accepted.statusCode, 200);
  assert.equal(
    (await db.collection("stripeEvents").doc(event.id).get()).get("status"),
    "processed"
  );

  const rejected = await invokeStripeWebhook(
    payload.replace("cus_signed", "cus_tampered"),
    signature
  );
  assert.equal(rejected.statusCode, 400);

  const wrongModeEvent = {
    ...event,
    id: "evt_wrong_mode_webhook",
    livemode: true,
  };
  const wrongModePayload = JSON.stringify(wrongModeEvent);
  const wrongModeSignature = Stripe.webhooks.generateTestHeaderString({
    payload: wrongModePayload,
    secret: process.env.STRIPE_WEBHOOK_SECRET,
  });
  const wrongMode = await invokeStripeWebhook(wrongModePayload, wrongModeSignature);
  assert.equal(wrongMode.statusCode, 400);
  assert.equal(
    (await db.collection("stripeEvents").doc(wrongModeEvent.id).get()).exists,
    false
  );
});

test("checkout completion fulfils membership and queues its durable confirmation", async () => {
  const intentRef = db.collection("membershipIntents").doc("intent_fulfil_handler");
  const intent = reservationIntent("fulfil_handler", {
    participantKey: "participant_fulfil_handler",
  });
  await membershipTesting.reserveCheckoutAttempt(intentRef, intent, Date.now());
  fakeStripe.setSubscription("sub_fulfil_handler", {
    status: "active",
    customer: "cus_fulfil_handler",
    billing_cycle_anchor: intent.billingCycleAnchor,
    metadata: membershipCommercialMetadata({
      intentId: intentRef.id,
      planKey: intent.planKey,
    }),
  });

  const eventCreated = Math.floor(Date.now() / 1000) - 90;
  const event = {
    id: "evt_checkout_fulfil",
    object: "event",
    api_version: "2026-07-29.basil",
    created: eventCreated,
    livemode: false,
    pending_webhooks: 0,
    request: null,
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_fulfil_handler",
        object: "checkout.session",
        livemode: false,
        mode: "subscription",
        metadata: {intentId: intentRef.id, planKey: "adult_unlimited"},
        payment_status: "paid",
        subscription: "sub_fulfil_handler",
        customer: "cus_fulfil_handler",
        customer_details: {email: "fulfilled@example.test"},
        amount_total: 2500,
      },
    },
  };
  await handleStripeEvent(event, async () => undefined);

  const membership = await db.collection("memberships").doc("sub_fulfil_handler").get();
  assert.equal(membership.get("state"), "active");
  assert.equal(membership.get("payerEmail"), "fulfilled@example.test");
  assert.equal(membership.get("confirmationEmailStatus"), "pending");
  assert.equal(membership.get("confirmationEmailSentAt"), undefined);
  const acceptances = membership.get("acceptances");
  assert.equal(acceptances.contractMadeAt.seconds, eventCreated);
  assert.equal(
    acceptances.coolingOffEndsAt,
    resolveCoolingOffEnd(eventCreated * 1000)
  );
  const outbox = await db.collection("membershipEmailOutbox")
    .doc("sub_fulfil_handler").get();
  assert.equal(outbox.get("status"), "pending");
  assert.equal(outbox.get("initialChargePence"), 2500);
  assert.match(outbox.get("payload.subject"), /Welcome to Zero Alpha/);
  assert.equal(outbox.get("payload.attachments").length, 5);
  assert.equal((await intentRef.get()).get("status"), "fulfilled");
  assert.equal((await intentRef.get()).get("checkoutSessionId"), "cs_fulfil_handler");
  assert.equal((await db.collection("membershipCheckoutLocks").get()).size, 0);
});

test("checkout fulfilment uses the current Session instead of an old webhook snapshot", async () => {
  const intentRef = db.collection("membershipIntents")
    .doc("intent_authoritative_session");
  const intent = reservationIntent("authoritative_session", {
    participantKey: "participant_authoritative_session",
  });
  await membershipTesting.reserveCheckoutAttempt(intentRef, intent, Date.now());
  fakeStripe.setSubscription("sub_authoritative_session", {
    status: "active",
    customer: "cus_authoritative_session",
    billing_cycle_anchor: intent.billingCycleAnchor,
    metadata: {intentId: intentRef.id, planKey: intent.planKey},
  });
  fakeStripe.state.checkoutSessions.set("cs_authoritative_session", {
    id: "cs_authoritative_session",
    object: "checkout.session",
    livemode: false,
    mode: "subscription",
    status: "complete",
    metadata: membershipCommercialMetadata({
      intentId: intentRef.id,
      planKey: intent.planKey,
    }),
    payment_status: "paid",
    subscription: "sub_authoritative_session",
    customer: "cus_authoritative_session",
    customer_details: {email: "authoritative-session@example.test"},
    amount_total: 2500,
    discounts: [],
  });

  // This deliberately resembles an old endpoint-version snapshot with none of
  // the fields needed to fulfil. The current Session GET above is authoritative.
  await membershipTesting.handleStripeEvent({
    id: "evt_authoritative_session",
    type: "checkout.session.completed",
    created: Math.floor(Date.now() / 1000),
    data: {object: {
      id: "cs_authoritative_session",
      object: "checkout.session",
      livemode: false,
      payment_status: "unpaid",
      metadata: {},
    }},
  }, async () => undefined);

  const membership = await db.collection("memberships")
    .doc("sub_authoritative_session").get();
  assert.equal(membership.get("state"), "active");
  assert.equal(membership.get("payerEmail"), "authoritative-session@example.test");
});

test("a £0 presale completion stays scheduled until its first paid invoice", async () => {
  const fixedCheckout = new Date("2026-08-20T10:00:00Z").getTime();
  const realNow = Date.now;
  Date.now = () => fixedCheckout;
  try {
    await createMember("presalebuyer", {
      email: "presalebuyer@example.test",
      emailVerified: true,
    });
    const intentRef = db.collection("membershipIntents").doc("intent_presale_scheduled");
    const intent = presaleIntent("presale_scheduled", {
      payerUid: "presalebuyer",
      participantKey: "participant_presale_scheduled",
    });
    await membershipTesting.reserveCheckoutAttempt(intentRef, intent, fixedCheckout);
    fakeStripe.setSubscription("sub_presale_scheduled", {
      status: "active",
      customer: "cus_presale_scheduled",
      billing_cycle_anchor: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
      metadata: {intentId: intentRef.id, planKey: intent.planKey},
    });

    await handleStripeEvent({
      id: "evt_presale_completed",
      type: "checkout.session.completed",
      created: Math.floor(fixedCheckout / 1000),
      data: {object: {
        id: "cs_presale_scheduled",
        object: "checkout.session",
        livemode: false,
        mode: "subscription",
        status: "complete",
        expires_at: intent.checkoutExpiresAt,
        metadata: {intentId: intentRef.id, planKey: "adult_unlimited"},
        payment_status: "no_payment_required",
        payment_method_collection: "always",
        subscription: "sub_presale_scheduled",
        customer: "cus_presale_scheduled",
        customer_details: {email: "presalebuyer@example.test"},
        amount_total: 0,
        discounts: [],
      }},
    }, async () => undefined);

    let membership = await db.collection("memberships")
      .doc("sub_presale_scheduled").get();
    assert.equal(membership.get("state"), "scheduled");
    assert.equal(membership.get("initialChargePence"), 0);
    assert.equal(membership.get("firstPaymentReceivedAt"), null);
    assert.equal(
      membership.get("nextReconcileAt").seconds,
      PRESALE_BILLING_ANCHOR_UNIX_SECONDS
    );
    assert.equal((await accessOf("presalebuyer")).alphaWodAccess, false);
    assert.equal(
      (await db.collection("membershipEmailOutbox")
        .doc("sub_presale_scheduled").get()).get("initialChargePence"),
      0
    );

    const paidAt = PRESALE_BILLING_ANCHOR_UNIX_SECONDS + 60;
    Date.now = () => paidAt * 1000;
    await handleStripeEvent({
      id: "evt_presale_first_invoice_paid",
      type: "invoice.paid",
      created: paidAt,
      data: {object: {
        id: "in_presale_first_paid",
        object: "invoice",
        livemode: false,
        status: "paid",
        amount_paid: 6000,
        currency: "gbp",
        period_start: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
        status_transitions: {paid_at: paidAt},
        parent: {
          type: "subscription_details",
          subscription_details: {subscription: "sub_presale_scheduled"},
        },
        lines: {object: "list", data: [{
          id: "il_presale_first_paid",
          object: "line_item",
          parent: {
            type: "subscription_item_details",
            invoice_item_details: null,
            subscription_item_details: {
              subscription: "sub_presale_scheduled",
              subscription_item: "si_sub_presale_scheduled",
              invoice_item: null,
              proration: false,
              proration_details: null,
            },
          },
          period: {
            start: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
            end: 1790812800,
          },
          pricing: {
            type: "price_details",
            price_details: {
              price: "price_unlimited",
              product: "prod_price_unlimited",
            },
          },
          quantity: 1,
          subscription: "sub_presale_scheduled",
        }]},
      }},
    }, async () => undefined);

    membership = await db.collection("memberships")
      .doc("sub_presale_scheduled").get();
    assert.equal(membership.get("state"), "active");
    assert.equal(membership.get("firstPaymentReceivedAt"), paidAt);
    assert.equal(membership.get("firstPaidInvoiceId"), "in_presale_first_paid");
    assert.equal((await accessOf("presalebuyer")).alphaWodAccess, true);
  } finally {
    Date.now = realNow;
  }
});

test("first-payment activation uses the current Invoice instead of an old webhook snapshot", async () => {
  const subscriptionId = "sub_authoritative_invoice";
  const paidAt = PRESALE_BILLING_ANCHOR_UNIX_SECONDS + 60;
  await seedMembership(subscriptionId, {
    state: "scheduled",
    stripeStatus: "active",
    billingMode: "presale_deferred",
    serviceStartsAt: PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS,
    firstPaymentAt: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
    billingCycleAnchor: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
    initialChargePence: 0,
    firstPaymentReceivedAt: null,
    firstPaidInvoiceId: null,
    discount: null,
    paymentSchedule: {
      amountDueTodayPence: 0,
      firstPaymentAt: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
      standardMonthlyPence: 6000,
      discountedMonthlyPence: null,
      discountedPaymentCount: 0,
      fullPriceFrom: null,
    },
    nextReconcileAt: admin.firestore.Timestamp.fromMillis(
      PRESALE_BILLING_ANCHOR_UNIX_SECONDS * 1000
    ),
  });
  fakeStripe.setSubscription(subscriptionId, {
    status: "active",
    billing_cycle_anchor: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
  });
  fakeStripe.state.invoices.set("in_authoritative_invoice", {
    id: "in_authoritative_invoice",
    object: "invoice",
    livemode: false,
    status: "paid",
    amount_paid: 6000,
    currency: "gbp",
    status_transitions: {paid_at: paidAt},
    parent: {
      type: "subscription_details",
      subscription_details: {subscription: subscriptionId},
    },
    lines: {object: "list", data: [{
      id: "il_authoritative_invoice",
      object: "line_item",
      parent: {
        type: "subscription_item_details",
        subscription_item_details: {
          subscription: subscriptionId,
          subscription_item: `si_${subscriptionId}`,
          invoice_item: null,
          proration: false,
          proration_details: null,
        },
      },
      period: {
        start: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
        end: 1790812800,
      },
      pricing: {
        type: "price_details",
        price_details: {
          price: "price_unlimited",
          product: "prod_price_unlimited",
        },
      },
      quantity: 1,
      subscription: subscriptionId,
    }]},
  });

  // The signed trigger carries deliberately stale/non-paying fields. Only the
  // authoritative Invoice GET is permitted to construct activation evidence.
  const realNow = Date.now;
  Date.now = () => paidAt * 1000;
  try {
    await membershipTesting.handleStripeEvent({
      id: "evt_authoritative_invoice",
      type: "invoice.paid",
      created: paidAt,
      data: {object: {
        id: "in_authoritative_invoice",
        object: "invoice",
        livemode: false,
        status: "draft",
        amount_paid: 0,
        currency: "usd",
        lines: {object: "list", data: []},
      }},
    }, async () => undefined);

    const membership = await db.collection("memberships").doc(subscriptionId).get();
    assert.equal(membership.get("state"), "active");
    assert.equal(membership.get("firstPaymentReceivedAt"), paidAt);
    assert.equal(membership.get("firstPaidInvoiceId"), "in_authoritative_invoice");
  } finally {
    Date.now = realNow;
  }
});

function legacyPresaleActivationInvoice(subscriptionId, invoiceId, amountPaidPence) {
  const paidAt = PRESALE_BILLING_ANCHOR_UNIX_SECONDS + 60;
  return {
    id: invoiceId,
    object: "invoice",
    livemode: false,
    status: "paid",
    amount_paid: amountPaidPence,
    currency: "gbp",
    status_transitions: {paid_at: paidAt},
    parent: {
      type: "subscription_details",
      subscription_details: {subscription: subscriptionId},
    },
    lines: {object: "list", data: [{
      id: `il_${invoiceId}`,
      object: "line_item",
      parent: {
        type: "subscription_item_details",
        subscription_item_details: {
          subscription: subscriptionId,
          subscription_item: `si_${subscriptionId}`,
          invoice_item: null,
          proration: false,
          proration_details: null,
        },
      },
      period: {
        start: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
        end: 1790812800,
      },
      pricing: {
        type: "price_details",
        price_details: {
          price: "price_unlimited",
          product: "prod_price_unlimited",
        },
      },
      quantity: 1,
      subscription: subscriptionId,
    }]},
  };
}

async function seedLegacyPresaleDiscountGap(
  subscriptionId,
  discountOverrides = {},
  membershipOverrides = {}
) {
  await seedMembership(subscriptionId, {
    schemaVersion: 1,
    state: "scheduled",
    stripeStatus: "active",
    billingMode: "presale_deferred",
    serviceStartsAt: PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS,
    firstPaymentAt: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
    billingCycleAnchor: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
    initialChargePence: 0,
    firstPaymentReceivedAt: null,
    firstPaidInvoiceId: null,
    discount: null,
    paymentSchedule: {
      amountDueTodayPence: 0,
      firstPaymentAt: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
      standardMonthlyPence: 6000,
      discountedMonthlyPence: null,
      discountedPaymentCount: 0,
      fullPriceFrom: null,
    },
    nextReconcileAt: admin.firestore.Timestamp.fromMillis(
      PRESALE_BILLING_ANCHOR_UNIX_SECONDS * 1000
    ),
    ...membershipOverrides,
  });
  fakeStripe.setSubscription(subscriptionId, {
    status: "active",
    billing_cycle_anchor: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
    discounts: [{
      id: `di_${subscriptionId}`,
      object: "discount",
      coupon: "coupon_existing_member_5x3",
      promotion_code: null,
      source: null,
      start: 1787487297,
      end: 1795436097,
      subscription: subscriptionId,
      subscription_item: null,
      ...discountOverrides,
    }],
  });
}

test("an exact provider discount recovers a schema-v1 presale and accepts £55", async () => {
  const subscriptionId = "sub_legacy_discount_recovery";
  const invoiceId = "in_legacy_discount_recovery";
  const paidAt = PRESALE_BILLING_ANCHOR_UNIX_SECONDS + 60;
  await seedLegacyPresaleDiscountGap(subscriptionId);

  const realNow = Date.now;
  Date.now = () => paidAt * 1000;
  try {
    const invoice = legacyPresaleActivationInvoice(
      subscriptionId,
      invoiceId,
      5500
    );
    await handleStripeEvent({
      id: "evt_legacy_discount_recovery",
      type: "invoice.paid",
      created: paidAt,
      data: {object: invoice},
    }, async () => undefined);

    const membership = await db.collection("memberships").doc(subscriptionId).get();
    assert.equal(membership.get("schemaVersion"), 1);
    assert.equal(membership.get("state"), "active");
    assert.equal(membership.get("firstPaymentReceivedAt"), paidAt);
    assert.equal(membership.get("firstPaidInvoiceId"), invoiceId);
    assert.deepEqual(membership.get("discount"), {
      couponId: "coupon_existing_member_5x3",
      promotionCodeId: null,
      amountOffPence: 500,
      currency: "gbp",
      durationInMonths: 3,
      startsAt: 1787487297,
      endsAt: 1795436097,
    });
    assert.deepEqual(membership.get("paymentSchedule"), {
      amountDueTodayPence: 0,
      firstPaymentAt: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
      standardMonthlyPence: 6000,
      discountedMonthlyPence: 5500,
      discountedPaymentCount: 3,
      fullPriceFrom: 1796083200,
    });
    assert.equal(membership.get("legacyPresaleDiscountRecoveryVersion"), 1);
    assert.ok(membership.get("legacyPresaleDiscountRecoveredAt"));
    assert.equal(membership.get("providerContractStatus"), "verified");
    const recoveryAudit = await db.collection("membershipAudit")
      .doc(`legacy-presale-discount-recovery-${invoiceId}`)
      .get();
    assert.equal(recoveryAudit.exists, true);
    assert.equal(recoveryAudit.get("type"), "legacy_presale_discount_recovered");
    assert.equal(recoveryAudit.get("subscriptionId"), subscriptionId);
    assert.equal(recoveryAudit.get("invoiceId"), invoiceId);
    assert.equal(recoveryAudit.get("recoveryVersion"), 1);
  } finally {
    Date.now = realNow;
  }
});

test("schema-v1 presale recovery rejects a provider discount outside the allowlist", async () => {
  const subscriptionId = "sub_legacy_unapproved_discount";
  const paidAt = PRESALE_BILLING_ANCHOR_UNIX_SECONDS + 60;
  await seedLegacyPresaleDiscountGap(subscriptionId, {
    coupon: "coupon_not_approved",
  });

  const realNow = Date.now;
  Date.now = () => paidAt * 1000;
  try {
    const invoice = legacyPresaleActivationInvoice(
      subscriptionId,
      "in_legacy_unapproved_discount",
      5500
    );
    await assert.rejects(
      () => handleStripeEvent({
        id: "evt_legacy_unapproved_discount",
        type: "invoice.paid",
        created: paidAt,
        data: {object: invoice},
      }, async () => undefined),
      /unapproved discount/i
    );

    const membership = await db.collection("memberships").doc(subscriptionId).get();
    assert.equal(membership.get("state"), "scheduled");
    assert.equal(membership.get("firstPaymentReceivedAt"), null);
    assert.equal(membership.get("discount"), null);
    assert.equal(membership.get("legacyPresaleDiscountRecoveryVersion"), undefined);
  } finally {
    Date.now = realNow;
  }
});

test("schema-v1 presale recovery rejects the wrong amount for an approved discount", async () => {
  const subscriptionId = "sub_legacy_discount_wrong_amount";
  const paidAt = PRESALE_BILLING_ANCHOR_UNIX_SECONDS + 60;
  await seedLegacyPresaleDiscountGap(subscriptionId);

  const realNow = Date.now;
  Date.now = () => paidAt * 1000;
  try {
    const invoice = legacyPresaleActivationInvoice(
      subscriptionId,
      "in_legacy_discount_wrong_amount",
      5400
    );
    await assert.rejects(
      () => handleStripeEvent({
        id: "evt_legacy_discount_wrong_amount",
        type: "invoice.paid",
        created: paidAt,
        data: {object: invoice},
      }, async () => undefined),
      /unexpected first-payment amount/i
    );

    const membership = await db.collection("memberships").doc(subscriptionId).get();
    assert.equal(membership.get("state"), "scheduled");
    assert.equal(membership.get("firstPaymentReceivedAt"), null);
    assert.equal(membership.get("discount"), null);
    assert.equal(membership.get("legacyPresaleDiscountRecoveryVersion"), undefined);
  } finally {
    Date.now = realNow;
  }
});

test("schema-v1 presale recovery stays closed after any payment progression", async () => {
  const paidAt = PRESALE_BILLING_ANCHOR_UNIX_SECONDS + 60;
  const progressedCases = [
    {suffix: "active", overrides: {state: "active"}},
    {
      suffix: "received",
      overrides: {firstPaymentReceivedAt: PRESALE_BILLING_ANCHOR_UNIX_SECONDS + 30},
    },
    {suffix: "invoice", overrides: {firstPaidInvoiceId: "in_already_recorded"}},
  ];
  const realNow = Date.now;
  Date.now = () => paidAt * 1000;
  try {
    for (const {suffix, overrides} of progressedCases) {
      const subscriptionId = `sub_legacy_progressed_${suffix}`;
      await seedLegacyPresaleDiscountGap(subscriptionId, {}, overrides);
      await assert.rejects(
        () => handleStripeEvent({
          id: `evt_legacy_progressed_${suffix}`,
          type: "invoice.paid",
          created: paidAt,
          data: {object: legacyPresaleActivationInvoice(
            subscriptionId,
            `in_legacy_progressed_${suffix}`,
            5500
          )},
        }, async () => undefined),
        /unexpected first-payment amount/i
      );

      const membership = await db.collection("memberships").doc(subscriptionId).get();
      assert.equal(membership.get("discount"), null);
      assert.equal(membership.get("legacyPresaleDiscountRecoveryVersion"), undefined);
      const recoveryAudit = await db.collection("membershipAudit")
        .doc(`legacy-presale-discount-recovery-in_legacy_progressed_${suffix}`)
        .get();
      assert.equal(recoveryAudit.exists, false);
      for (const [field, value] of Object.entries(overrides)) {
        assert.equal(membership.get(field), value);
      }
    }
  } finally {
    Date.now = realNow;
  }
});

test("an approved existing-member code freezes the three-payment £55 schedule", async () => {
  const fixedCheckout = new Date("2026-08-21T10:00:00Z").getTime();
  const realNow = Date.now;
  const promotion = fakeStripe.state.promotionCodes.get(
    "promo_existing_member_shared"
  );
  const originalPromotion = {...promotion};
  Date.now = () => fixedCheckout;
  try {
    // Other customers may have redeemed the same campaign code before Stripe
    // delivers this member's webhook.
    promotion.times_redeemed = 19;
    const intentRef = db.collection("membershipIntents").doc("intent_presale_discount");
    const intent = presaleIntent("presale_discount", {
      participantKey: "participant_presale_discount",
      promotionCodeId: "promo_existing_member_shared",
    });
    await membershipTesting.reserveCheckoutAttempt(intentRef, intent, fixedCheckout);
    fakeStripe.setSubscription("sub_presale_discount", {
      status: "active",
      customer: "cus_presale_discount",
      billing_cycle_anchor: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
      metadata: {intentId: intentRef.id, planKey: intent.planKey},
      discounts: [{
        id: "di_presale_discount",
        object: "discount",
        coupon: "coupon_existing_member_5x3",
        promotion_code: "promo_existing_member_shared",
        start: Math.floor(fixedCheckout / 1000),
        end: Math.floor(new Date("2026-11-21T10:00:00Z").getTime() / 1000),
      }],
    });

    await handleStripeEvent({
      id: "evt_presale_discount",
      type: "checkout.session.completed",
      created: Math.floor(fixedCheckout / 1000),
      data: {object: {
        id: "cs_presale_discount",
        object: "checkout.session",
        livemode: false,
        mode: "subscription",
        status: "complete",
        expires_at: intent.checkoutExpiresAt,
        metadata: {intentId: intentRef.id, planKey: "adult_unlimited"},
        payment_status: "no_payment_required",
        payment_method_collection: "always",
        subscription: "sub_presale_discount",
        customer: "cus_presale_discount",
        customer_details: {email: "discount@example.test"},
        amount_total: 0,
        discounts: [{
          coupon: null,
          promotion_code: "promo_existing_member_shared",
        }],
      }},
    }, async () => undefined);

    const membership = await db.collection("memberships")
      .doc("sub_presale_discount").get();
    assert.deepEqual(membership.get("discount"), {
      couponId: "coupon_existing_member_5x3",
      promotionCodeId: "promo_existing_member_shared",
      amountOffPence: 500,
      currency: "gbp",
      durationInMonths: 3,
      startsAt: Math.floor(fixedCheckout / 1000),
      endsAt: Math.floor(new Date("2026-11-21T10:00:00Z").getTime() / 1000),
    });
    assert.deepEqual(membership.get("paymentSchedule"), {
      amountDueTodayPence: 0,
      firstPaymentAt: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
      standardMonthlyPence: 6000,
      discountedMonthlyPence: 5500,
      discountedPaymentCount: 3,
      fullPriceFrom: 1796083200,
    });
  } finally {
    Object.assign(promotion, originalPromotion);
    Date.now = realNow;
  }
});

test("a discounted Session can complete after cutoff and fulfil after manual code deactivation", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  const promotion = fakeStripe.state.promotionCodes.get(
    "promo_existing_member_shared"
  );
  const originalPromotion = {...promotion};
  Date.now = () => (PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS - 2) * 1000;
  try {
    const checkout = await handler(request(
      {
        ...validCheckoutData("attempt_discount_delayed_webhook_123456"),
        promotionCode: "EXISTING-FAKE",
      }
    ));
    const intentSnap = (await db.collection("membershipIntents").get()).docs[0];
    const intent = intentSnap.data();
    const subscriptionId = "sub_discount_delayed_webhook";
    const customerId = "cus_discount_delayed_webhook";
    const completedAt = PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS + 60;
    assert.ok(completedAt < intent.checkoutExpiresAt);
    fakeStripe.setSubscription(subscriptionId, {
      status: "active",
      customer: customerId,
      billing_cycle_anchor: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
      metadata: {intentId: intentSnap.id, planKey: intent.planKey},
      discounts: [{
        id: "di_discount_delayed_webhook",
        object: "discount",
        source: {type: "coupon", coupon: "coupon_existing_member_5x3"},
        promotion_code: "promo_existing_member_shared",
        start: completedAt,
        end: 1796083200,
      }],
    });

    // Staff have now deactivated the Promotion Code. This is a delayed
    // delivery of an already-applied redemption, not a new redemption.
    promotion.active = false;
    promotion.times_redeemed = 1;
    Date.now = () => (PRESALE_BILLING_ANCHOR_UNIX_SECONDS + 60) * 1000;
    await handleStripeEvent({
      id: "evt_discount_delayed_webhook",
      type: "checkout.session.completed",
      created: completedAt,
      data: {object: {
        id: checkout.sessionId,
        object: "checkout.session",
        livemode: false,
        mode: "subscription",
        status: "complete",
        expires_at: intent.checkoutExpiresAt,
        metadata: {intentId: intentSnap.id, planKey: intent.planKey},
        payment_status: "no_payment_required",
        payment_method_collection: "always",
        subscription: subscriptionId,
        customer: customerId,
        customer_details: {email: "delayed-discount@example.test"},
        amount_total: 0,
        discounts: [{
          coupon: "coupon_existing_member_5x3",
          promotion_code: "promo_existing_member_shared",
        }],
      }},
    }, async () => undefined);

    const membership = await db.collection("memberships")
      .doc(subscriptionId).get();
    assert.equal(membership.get("state"), "scheduled");
    assert.equal(membership.get("discount.amountOffPence"), 500);
    assert.equal(membership.get("paymentSchedule.discountedMonthlyPence"), 5500);
  } finally {
    Object.assign(promotion, originalPromotion);
    Date.now = realNow;
  }
});

test("a Session promotion cannot be confirmed without its Subscription discount", async () => {
  const intent = presaleIntent("missing_subscription_discount", {
    participantKey: "participant_missing_subscription_discount",
    promotionCodeId: "promo_existing_member_shared",
  });
  const subscription = fakeStripe.setSubscription(
    "sub_missing_subscription_discount",
    {
      customer: "cus_missing_subscription_discount",
      billing_cycle_anchor: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
      discounts: [],
    }
  );
  await assert.rejects(
    () => membershipTesting.resolveApprovedCheckoutDiscount({
      id: "cs_missing_subscription_discount",
      discounts: [{
        coupon: "coupon_existing_member_5x3",
        promotion_code: "promo_existing_member_shared",
      }],
    }, subscription, intent, Math.floor(Date.now() / 1000)),
    /does not carry the approved Checkout discount/i
  );
});

test("fulfilment rejects a different Promotion Code on the approved Coupon", async () => {
  const intent = presaleIntent("different_campaign_promotion", {
    participantKey: "participant_different_campaign_promotion",
    promotionCodeId: "promo_matching_not_allowlisted",
  });
  const subscription = fakeStripe.setSubscription(
    "sub_different_campaign_promotion",
    {
      customer: "cus_different_campaign_promotion",
      billing_cycle_anchor: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
      discounts: [{
        id: "di_different_campaign_promotion",
        object: "discount",
        source: {type: "coupon", coupon: "coupon_existing_member_5x3"},
        promotion_code: "promo_matching_not_allowlisted",
      }],
    }
  );
  await assert.rejects(
    () => membershipTesting.resolveApprovedCheckoutDiscount({
      id: "cs_different_campaign_promotion",
      discounts: [{
        coupon: "coupon_existing_member_5x3",
        promotion_code: "promo_matching_not_allowlisted",
      }],
    }, subscription, intent, Math.floor(Date.now() / 1000)),
    /used an unapproved promotion/i
  );
});

test("paid fulfilment stays bound to the Price frozen before a config rotation", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-09-02T10:00:00Z").getTime();
  const checkout = await handler(request(
    {
      ...validCheckoutData("attempt_price_rotation_after_payment"),
      expectedBillingMode: "standard",
    }
  ));
  const intentQuery = await db.collection("membershipIntents").get();
  assert.equal(intentQuery.size, 1);
  const intentRef = intentQuery.docs[0].ref;
  const frozenIntent = intentQuery.docs[0].data();
  assert.equal(intentQuery.docs[0].get("stripePriceId"), "price_unlimited");

  fakeStripe.setSubscription("sub_price_rotation", {
    status: "active",
    customer: "cus_price_rotation",
    billing_cycle_anchor: frozenIntent.billingCycleAnchor,
    metadata: {intentId: intentRef.id, planKey: frozenIntent.planKey},
  });
  const originalConfiguredPrice = process.env.STRIPE_PRICE_ADULT_UNLIMITED;
  const replacement = {
    ...fakeStripe.state.prices.get("price_unlimited"),
    id: "price_unlimited_replacement",
    product: {
      ...fakeStripe.state.prices.get("price_unlimited").product,
      id: "prod_price_unlimited_replacement",
    },
  };
  fakeStripe.state.prices.set(replacement.id, replacement);
  process.env.STRIPE_PRICE_ADULT_UNLIMITED = replacement.id;
  try {
    await handleStripeEvent({
      id: "evt_price_rotation",
      type: "checkout.session.completed",
      created: Math.floor(Date.now() / 1000),
      data: {object: {
        id: checkout.sessionId,
        object: "checkout.session",
        livemode: false,
        mode: "subscription",
        metadata: {intentId: intentRef.id, planKey: "adult_unlimited"},
        payment_status: "paid",
        subscription: "sub_price_rotation",
        customer: "cus_price_rotation",
        customer_details: {email: "rotation@example.test"},
        amount_total: 6000,
      }},
    }, async () => undefined);
    const membership = await db.collection("memberships")
      .doc("sub_price_rotation").get();
    assert.equal(membership.get("stripePriceId"), "price_unlimited");
    assert.equal(membership.get("state"), "active");
  } finally {
    Date.now = realNow;
    process.env.STRIPE_PRICE_ADULT_UNLIMITED = originalConfiguredPrice;
    fakeStripe.state.prices.delete(replacement.id);
  }
});

test("missing confirmation evidence is escalated instead of marked not required", async () => {
  const intentRef = db.collection("membershipIntents").doc("intent_missing_confirmation");
  const intent = reservationIntent("missing_confirmation", {
    participantKey: "participant_missing_confirmation",
  });
  await membershipTesting.reserveCheckoutAttempt(intentRef, intent, Date.now());
  fakeStripe.setSubscription("sub_missing_confirmation", {
    status: "active",
    customer: "cus_missing_confirmation",
    billing_cycle_anchor: intent.billingCycleAnchor,
    metadata: {intentId: intentRef.id, planKey: intent.planKey},
  });

  await handleStripeEvent({
    id: "evt_missing_confirmation",
    type: "checkout.session.completed",
    created: Math.floor(Date.now() / 1000),
    data: {object: {
      id: "cs_missing_confirmation",
      object: "checkout.session",
      livemode: false,
      mode: "subscription",
      metadata: {intentId: intentRef.id, planKey: "adult_unlimited"},
      payment_status: "paid",
      subscription: "sub_missing_confirmation",
      customer: "cus_missing_confirmation",
      customer_details: {},
      amount_total: null,
    }},
  }, async () => undefined);

  const membership = await db.collection("memberships")
    .doc("sub_missing_confirmation").get();
  const outbox = await db.collection("membershipEmailOutbox")
    .doc("sub_missing_confirmation").get();
  assert.equal(membership.get("confirmationEmailStatus"), "manual_review");
  assert.match(membership.get("confirmationEmailError"), /email was unavailable/i);
  assert.equal(outbox.get("status"), "manual_review");
  assert.equal(outbox.get("nextAttemptAt"), undefined);
});

test("a late paid session cannot fulfil after its uniqueness lock was reclaimed", async () => {
  const intentRef = db.collection("membershipIntents").doc("intent_late_payment");
  const intent = reservationIntent("late_payment", {
    participantKey: "participant_late_payment",
  });
  await membershipTesting.reserveCheckoutAttempt(intentRef, intent, Date.now());
  const [lockId] = intent.reservationLockIds;
  await db.collection("membershipCheckoutLocks").doc(lockId).set({
    intentId: "newer_checkout_attempt",
    status: "reserved",
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 3600 * 1000),
  }, {merge: true});
  fakeStripe.setSubscription("sub_late_payment", {
    status: "active",
    customer: "cus_late_payment",
    billing_cycle_anchor: intent.billingCycleAnchor,
    metadata: {intentId: intentRef.id, planKey: intent.planKey},
  });

  await assert.rejects(
    () => handleStripeEvent({
      id: "evt_late_payment",
      type: "checkout.session.async_payment_succeeded",
      created: Math.floor(Date.now() / 1000),
      data: {object: {
        id: "cs_late_payment",
        object: "checkout.session",
        livemode: false,
        mode: "subscription",
        metadata: {intentId: intentRef.id, planKey: "adult_unlimited"},
        payment_status: "paid",
        subscription: "sub_late_payment",
        customer: "cus_late_payment",
        customer_details: {email: "late@example.test"},
        amount_total: 2500,
      }},
    }, async () => undefined),
    /unique fulfilment reservation/i
  );
  assert.equal(
    (await db.collection("memberships").doc("sub_late_payment").get()).exists,
    false
  );
});

test("fulfilment rechecks a canonically equivalent pre-v2 membership", async () => {
  const participantName = "Legacy Athlete";
  const dateOfBirth = "1990-01-01";
  const intentRef = db.collection("membershipIntents")
    .doc("intent_legacy_membership_race");
  const intent = reservationIntent("legacy_membership_race", {
    participantName,
    participantKey: membershipTesting.participantKeyFor(
      participantName,
      dateOfBirth
    ),
  });
  await membershipTesting.reserveCheckoutAttempt(intentRef, intent, Date.now());
  const storedName = "Legacy   Athlete";
  await seedMembership("sub_pre_v2_fulfilment_race", {
    participant: {
      fullName: storedName,
      dateOfBirth,
      age: 36,
      isPayer: true,
      participantKey: legacyParticipantKeyFor(storedName, dateOfBirth),
    },
  });
  fakeStripe.setSubscription("sub_legacy_membership_race", {
    status: "active",
    customer: "cus_legacy_membership_race",
    billing_cycle_anchor: intent.billingCycleAnchor,
    metadata: {intentId: intentRef.id, planKey: intent.planKey},
  });

  await assert.rejects(
    () => handleStripeEvent({
      id: "evt_legacy_membership_race",
      type: "checkout.session.async_payment_succeeded",
      created: Math.floor(Date.now() / 1000),
      data: {object: {
        id: "cs_legacy_membership_race",
        object: "checkout.session",
        livemode: false,
        mode: "subscription",
        metadata: {intentId: intentRef.id, planKey: intent.planKey},
        payment_status: "paid",
        subscription: "sub_legacy_membership_race",
        customer: "cus_legacy_membership_race",
        customer_details: {email: "legacy-race@example.test"},
        amount_total: 2500,
      }},
    }, async () => undefined),
    /unique fulfilment reservation/i
  );
  assert.equal(
    (await db.collection("memberships").doc("sub_legacy_membership_race").get())
      .exists,
    false
  );
  assert.equal(
    (await db.collection("memberships").doc("sub_pre_v2_fulfilment_race").get())
      .exists,
    true
  );
});

test("claiming by checkout session grants AlphaWOD access and approves the account", async () => {
  await createMember("buyer", {email: "buyer@example.test", emailVerified: false});
  await seedMembership("sub_claim_session");

  const result = await claimMembership(
    request({sessionId: "cs_sub_claim_session"}, "buyer")
  );
  assert.deepEqual(result.claimed, ["sub_claim_session"]);

  // A paid Adult Unlimited membership is the one non-admin route to approval.
  assert.deepEqual(await accessOf("buyer"), {
    approvalStatus: "approved",
    entitlementStatus: "active",
    entitlementSource: "stripe",
    alphaWodAccess: true,
  });

  const membership = await db.collection("memberships").doc("sub_claim_session").get();
  assert.equal(membership.get("payerUid"), "buyer");
  assert.equal(membership.get("claimedVia"), "checkout_session");
});

test("an active real schema-v5 Adult Unlimited snapshot remains full access", async () => {
  const uid = "legacyv5full";
  await createMember(uid, {
    email: "legacyv5full@example.test",
    emailVerified: true,
  });
  const legacyCommercialTerms = {
    ...createCommercialPlanSnapshot("adult_unlimited"),
    catalogueSchemaVersion: 5,
  };
  delete legacyCommercialTerms.appAccessTier;
  delete legacyCommercialTerms.selectedConditioningSlots;
  delete legacyCommercialTerms.conditioningBookingPolicy;
  await seedMembership("sub_legacy_v5_full", {
    payerUid: uid,
    payerEmail: "legacyv5full@example.test",
    entitlementTargetUid: uid,
    commercialTerms: legacyCommercialTerms,
  });

  await membershipTesting.convergeMembershipFromStripe(
    "sub_legacy_v5_full",
    async () => undefined
  );

  const profile = (await db.collection("users").doc(uid).get()).data();
  assert.equal(profile.entitlementStatus, "active");
  assert.equal(profile.entitlementSource, "stripe");
  assert.equal(profile.appAccessTier, "full");
  assert.equal(profile.alphaWodAccess, true);
});

test("Adult Conditioning projects flexible quota and restores the prior fixed policy", async () => {
  const uid = "conditioningrestore";
  await createMember(uid, {
    email: "buyer@example.test",
    emailVerified: true,
    profile: {
      approvalStatus: "approved",
      entitlementStatus: "active",
      entitlementSource: "manual",
      appAccessTier: "limited",
      entitlementPlanKey: "prior_manual_limited",
      entitlementClassSlots: ["tuesday_1800", "thursday_1800"],
      alphaWodAccess: true,
    },
  });
  await seedMembership("sub_conditioning_restore", {
    planKey: "adult_conditioning",
    payerUid: uid,
    entitlementTargetUid: uid,
  });

  await membershipTesting.convergeMembershipFromStripe(
    "sub_conditioning_restore",
    async () => undefined
  );
  let profile = (await db.collection("users").doc(uid).get()).data();
  assert.equal(profile.entitlementSource, "stripe");
  assert.equal(profile.entitlementPlanKey, "adult_conditioning");
  assert.equal(profile.appAccessTier, "limited");
  assert.deepEqual(profile.entitlementClassSlots, [
    "monday_0600", "tuesday_1800", "thursday_1800", "friday_0530",
  ]);
  assert.equal(profile.entitlementWeeklyBookingLimit, 2);
  assert.equal(profile.alphaWodAccess, true);

  const subscription = fakeStripe.state.subscriptions.get(
    "sub_conditioning_restore"
  );
  subscription.status = "canceled";
  subscription.ended_at = Math.floor(Date.now() / 1000);
  fakeStripe.state.subscriptions.set(subscription.id, subscription);
  await membershipTesting.convergeMembershipFromStripe(
    "sub_conditioning_restore",
    async () => undefined
  );

  profile = (await db.collection("users").doc(uid).get()).data();
  assert.equal(profile.entitlementStatus, "active");
  assert.equal(profile.entitlementSource, "manual");
  assert.equal(profile.entitlementPlanKey, "prior_manual_limited");
  assert.equal(profile.appAccessTier, "limited");
  assert.deepEqual(profile.entitlementClassSlots, [
    "tuesday_1800", "thursday_1800",
  ]);
  assert.equal(profile.entitlementWeeklyBookingLimit, null);
  assert.equal(profile.alphaWodAccess, true);
  const cleanupJob = await db.collection("membershipBookingCleanupJobs")
    .doc("sub_conditioning_restore").get();
  assert.equal(cleanupJob.get("status"), "pending");
  assert.equal(cleanupJob.get("legacyUnboundEligible"), true);
});

test("claiming a scheduled presale restores an approved historical member immediately", async () => {
  const uid = "historicalpresalemember";
  const email = "historicalpresalemember@example.test";
  await admin.auth().createUser({uid, email, emailVerified: true});
  // Historical approved profiles predate the entitlement schema. Explicitly
  // pending or restricted profiles are not eligible for this restoration.
  await db.collection("users").doc(uid).set({
    role: "user",
    approvalStatus: "approved",
    alphaWodAccess: false,
    email,
  });
  await seedMembership("sub_historical_presale_claim", {
    payerEmail: email,
    state: "scheduled",
    stripeStatus: "active",
    billingMode: "presale_deferred",
    serviceStartsAt: PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS,
    firstPaymentAt: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
    billingCycleAnchor: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
    initialChargePence: 0,
    firstPaymentReceivedAt: null,
    nextReconcileAt: admin.firestore.Timestamp.fromMillis(
      PRESALE_BILLING_ANCHOR_UNIX_SECONDS * 1000
    ),
  });

  const result = await claimMembership(request({
    sessionId: "cs_sub_historical_presale_claim",
  }, uid));

  assert.deepEqual(result.claimed, ["sub_historical_presale_claim"]);
  assert.deepEqual(await accessOf(uid), {
    approvalStatus: "approved",
    entitlementStatus: "active",
    entitlementSource: "legacy",
    alphaWodAccess: true,
  });
  const membership = await db.collection("memberships")
    .doc("sub_historical_presale_claim").get();
  assert.equal(membership.get("state"), "scheduled");
  assert.equal(membership.get("initialChargePence"), 0);
  assert.equal(membership.get("firstPaymentReceivedAt"), null);
  assert.ok(membership.get("existingMemberAccessRestoredAt"));
});

test("claiming a scheduled presale does not unlock a pending account", async () => {
  const uid = "newpresalemember";
  const email = "newpresalemember@example.test";
  await createMember(uid, {email, emailVerified: true});
  await seedMembership("sub_new_presale_claim", {
    payerEmail: email,
    state: "scheduled",
    stripeStatus: "active",
    billingMode: "presale_deferred",
    serviceStartsAt: PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS,
    firstPaymentAt: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
    billingCycleAnchor: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
    initialChargePence: 0,
    firstPaymentReceivedAt: null,
  });

  await claimMembership(request({sessionId: "cs_sub_new_presale_claim"}, uid));

  assert.deepEqual(await accessOf(uid), {
    approvalStatus: "pending",
    entitlementStatus: "none",
    entitlementSource: "none",
    alphaWodAccess: false,
  });
});

test("a leaked Stripe session id cannot claim without the browser verifier", async () => {
  await createMember("linkattacker", {
    email: "attacker@example.test",
    emailVerified: false,
  });
  await seedMembership("sub_stolen_session");

  await assert.rejects(
    () => claimMembership(request({
      sessionId: "cs_sub_stolen_session",
      checkoutAttemptId: "wrong_claim_verifier_0123456789",
    }, "linkattacker")),
    /cannot prove ownership|verified email/i
  );

  const membership = await db.collection("memberships")
    .doc("sub_stolen_session").get();
  assert.equal(membership.get("payerUid"), null);
  assert.equal((await accessOf("linkattacker")).alphaWodAccess, false);
});

test("claiming the same checkout session twice is idempotent for its owner", async () => {
  await createMember("buyer", {email: "buyer@example.test", emailVerified: false});
  await seedMembership("sub_claim_retry");

  const first = await claimMembership(
    request({sessionId: "cs_sub_claim_retry"}, "buyer")
  );
  await db.collection("memberships").doc("sub_claim_retry").set({
    fulfilledAt: admin.firestore.Timestamp.fromMillis(
      Date.now() - 25 * 60 * 60 * 1000
    ),
  }, {merge: true});
  const retry = await claimMembership(
    request({sessionId: "cs_sub_claim_retry"}, "buyer")
  );

  assert.deepEqual(first.claimed, ["sub_claim_retry"]);
  assert.deepEqual(retry.claimed, ["sub_claim_retry"]);
  assert.equal(retry.alreadyClaimed, true);
  assert.equal((await accessOf("buyer")).alphaWodAccess, true);
});

test("session claims fail closed on malformed or duplicated fulfilment evidence", async () => {
  await createMember("evidencebuyer", {
    email: "buyer@example.test",
    emailVerified: false,
  });
  await seedMembership("sub_bad_evidence", {
    fulfilledAt: "not-a-timestamp",
  });

  await assert.rejects(
    () => claimMembership(
      request({sessionId: "cs_sub_bad_evidence"}, "evidencebuyer")
    ),
    /support review/i
  );
  assert.equal(
    (await db.collection("memberships").doc("sub_bad_evidence").get()).get("payerUid"),
    null
  );

  await seedMembership("sub_duplicate_evidence_one", {
    checkoutSessionId: "cs_duplicate_evidence",
  });
  await seedMembership("sub_duplicate_evidence_two", {
    checkoutSessionId: "cs_duplicate_evidence",
  });
  await assert.rejects(
    () => claimMembership(
      request({sessionId: "cs_duplicate_evidence"}, "evidencebuyer")
    ),
    /support review/i
  );
});

test("a self-payer claim cannot overwrite another entitlement target", async () => {
  await createMember("selfpayer", {
    email: "buyer@example.test",
    emailVerified: false,
  });
  await seedMembership("sub_wrong_self_target", {
    entitlementTargetUid: "different-account",
  });

  await assert.rejects(
    () => claimMembership(
      request({sessionId: "cs_sub_wrong_self_target"}, "selfpayer")
    ),
    /already linked to another account/i
  );
  const membership = await db.collection("memberships")
    .doc("sub_wrong_self_target").get();
  assert.equal(membership.get("payerUid"), null);
  assert.equal(membership.get("entitlementTargetUid"), "different-account");
});

test("concurrent same-session claims are both idempotent for one owner", async () => {
  await createMember("concurrentbuyer", {
    email: "buyer@example.test",
    emailVerified: false,
  });
  await seedMembership("sub_claim_concurrent");
  fakeStripe.delayNextSubscriptionRetrieve("sub_claim_concurrent", 250);

  const claims = await Promise.all([
    claimMembership(
      request({sessionId: "cs_sub_claim_concurrent"}, "concurrentbuyer")
    ),
    claimMembership(
      request({sessionId: "cs_sub_claim_concurrent"}, "concurrentbuyer")
    ),
  ]);

  for (const result of claims) {
    assert.deepEqual(result.claimed, ["sub_claim_concurrent"]);
  }
  const matching = await db.collection("memberships")
    .where("checkoutSessionId", "==", "cs_sub_claim_concurrent")
    .get();
  assert.equal(matching.size, 1);
  assert.equal(matching.docs[0].get("payerUid"), "concurrentbuyer");
  assert.equal(matching.docs[0].get("entitlementTargetUid"), "concurrentbuyer");
  assert.equal((await accessOf("concurrentbuyer")).alphaWodAccess, true);
});

test("eligibility contention accepts its exact completion near the wait deadline", async () => {
  const subscriptionId = "sub_contention_completed";
  await seedMembership(subscriptionId);
  fakeStripe.delayNextSubscriptionRetrieve(subscriptionId, 300);

  const owner = membershipTesting.convergeMembershipFromStripe(
    subscriptionId,
    async () => undefined
  );
  const collision = await waitForConvergenceLease(subscriptionId);
  const waiter = membershipTesting.convergeEligibilityMembershipFromStripe(
    subscriptionId,
    async () => undefined,
    {waitMs: 500, initialBackoffMs: 10, maxBackoffMs: 25}
  );

  await Promise.all([owner, waiter]);
  const completed = await db.collection("memberships").doc(subscriptionId).get();
  assert.equal(
    completed.get("convergenceCompletedLeaseToken"),
    collision.token
  );
  assert.equal(completed.get("convergenceLeaseToken"), undefined);
  assert.equal(fakeStripe.state.subscriptionRetrieveCounts.get(subscriptionId), 1);
});

test("eligibility contention fails closed when its exact lease is released", async () => {
  const subscriptionId = "sub_contention_failed";
  await seedMembership(subscriptionId);
  fakeStripe.failNextSubscriptionRetrieve(subscriptionId, {
    delayMs: 150,
    message: "Injected authoritative retrieval failure",
  });

  const owner = membershipTesting.convergeMembershipFromStripe(
    subscriptionId,
    async () => undefined
  );
  const collision = await waitForConvergenceLease(subscriptionId);
  const waiterStartedAt = Date.now();
  const waiter = membershipTesting.convergeEligibilityMembershipFromStripe(
    subscriptionId,
    async () => undefined,
    {waitMs: 1000, initialBackoffMs: 10, maxBackoffMs: 25}
  );
  const [ownerResult, waiterResult] = await Promise.allSettled([owner, waiter]);

  assert.equal(ownerResult.status, "rejected");
  assert.match(ownerResult.reason.message, /Injected authoritative retrieval failure/);
  assert.equal(waiterResult.status, "rejected");
  assert.match(waiterResult.reason.message, /without completing/i);
  assert.ok(Date.now() - waiterStartedAt < 1000);
  const released = await db.collection("memberships").doc(subscriptionId).get();
  assert.equal(released.get("convergenceLeaseToken"), undefined);
  assert.notEqual(
    released.get("convergenceCompletedLeaseToken"),
    collision.token
  );
  assert.equal(fakeStripe.state.subscriptionRetrieveCounts.get(subscriptionId), 1);
});

test("eligibility contention rejects a stale completion marker", async () => {
  const subscriptionId = "sub_contention_stale_completion";
  const staleToken = "stale_completed_lease";
  await seedMembership(subscriptionId, {
    convergenceCompletedLeaseToken: staleToken,
  });
  fakeStripe.failNextSubscriptionRetrieve(subscriptionId, {
    delayMs: 150,
    message: "Injected authoritative retrieval failure after stale marker",
  });

  const owner = membershipTesting.convergeMembershipFromStripe(
    subscriptionId,
    async () => undefined
  );
  const collision = await waitForConvergenceLease(subscriptionId);
  assert.notEqual(collision.token, staleToken);
  const waiter = membershipTesting.convergeEligibilityMembershipFromStripe(
    subscriptionId,
    async () => undefined,
    {waitMs: 1000, initialBackoffMs: 10, maxBackoffMs: 25}
  );
  const [ownerResult, waiterResult] = await Promise.allSettled([owner, waiter]);

  assert.equal(ownerResult.status, "rejected");
  assert.equal(waiterResult.status, "rejected");
  assert.match(waiterResult.reason.message, /without completing/i);
  const released = await db.collection("memberships").doc(subscriptionId).get();
  assert.equal(released.get("convergenceCompletedLeaseToken"), staleToken);
  assert.equal(released.get("convergenceLeaseToken"), undefined);
  assert.equal(fakeStripe.state.subscriptionRetrieveCounts.get(subscriptionId), 1);
});

test("eligibility contention rejects a replacement lease", async () => {
  const subscriptionId = "sub_contention_replacement";
  const originalToken = "original_active_lease";
  const originalExpiresAtMillis = Date.now() + 2000;
  await seedMembership(subscriptionId, {
    convergenceLeaseToken: originalToken,
    convergenceLeaseExpiresAt: admin.firestore.Timestamp.fromMillis(
      originalExpiresAtMillis
    ),
  });

  const rejection = assert.rejects(
    membershipTesting.convergeEligibilityMembershipFromStripe(
      subscriptionId,
      async () => undefined,
      {waitMs: 1000, initialBackoffMs: 5, maxBackoffMs: 10}
    ),
    /without completing/i
  );
  await new Promise((resolve) => setTimeout(resolve, 75));
  const replacementToken = "replacement_active_lease";
  await db.collection("memberships").doc(subscriptionId).set({
    convergenceLeaseToken: replacementToken,
    convergenceLeaseExpiresAt: admin.firestore.Timestamp.fromMillis(
      Date.now() + 2000
    ),
  }, {merge: true});

  await rejection;
  const replaced = await db.collection("memberships").doc(subscriptionId).get();
  assert.equal(replaced.get("convergenceLeaseToken"), replacementToken);
  assert.notEqual(replaced.get("convergenceCompletedLeaseToken"), originalToken);
  assert.equal(
    fakeStripe.state.subscriptionRetrieveCounts.get(subscriptionId),
    undefined
  );
});

test("eligibility contention stays bounded by the colliding lease expiry", async () => {
  const subscriptionId = "sub_contention_expired";
  await seedMembership(subscriptionId);
  const leaseToken = "lease_that_never_completes";
  const leaseExpiresAtMillis = Date.now() + 250;
  await db.collection("memberships").doc(subscriptionId).set({
    convergenceLeaseToken: leaseToken,
    convergenceLeaseExpiresAt: admin.firestore.Timestamp.fromMillis(
      leaseExpiresAtMillis
    ),
  }, {merge: true});

  const startedAt = Date.now();
  await assert.rejects(
    () => membershipTesting.convergeEligibilityMembershipFromStripe(
      subscriptionId,
      async () => undefined,
      {waitMs: 1000, initialBackoffMs: 10, maxBackoffMs: 25}
    ),
    /contention deadline/i
  );

  assert.ok(Date.now() - startedAt < 1000);
  const expired = await db.collection("memberships").doc(subscriptionId).get();
  assert.equal(expired.get("convergenceLeaseToken"), leaseToken);
  assert.notEqual(expired.get("convergenceCompletedLeaseToken"), leaseToken);
  assert.equal(
    fakeStripe.state.subscriptionRetrieveCounts.get(subscriptionId),
    undefined
  );
});

test("an unverified email cannot claim a purchase without the session id", async () => {
  await createMember("attacker", {email: "buyer@example.test", emailVerified: false});
  await seedMembership("sub_unverified");
  // If the handler touched Stripe before verifying the email this missing
  // provider object would surface as an availability error instead.
  fakeStripe.state.subscriptions.delete("sub_unverified");

  await assert.rejects(
    () => claimMembership(request({}, "attacker")),
    (error) => {
      assert.match(error.message, /Verify the email/i);
      return true;
    }
  );

  assert.equal((await accessOf("attacker")).alphaWodAccess, false);
  assert.equal(
    (await db.collection("memberships").doc("sub_unverified").get()).get("payerUid"),
    null
  );
});

test("a verified matching email can claim without the session id", async () => {
  await createMember("buyer", {email: "buyer@example.test", emailVerified: true});
  await seedMembership("sub_verified");

  const result = await claimMembership(request({}, "buyer"));
  assert.deepEqual(result.claimed, ["sub_verified"]);
  assert.equal((await accessOf("buyer")).alphaWodAccess, true);
});

test("a verified-email claim retry finishes entitlement after an attach crash", async () => {
  const uid = "emailclaimretry";
  await createMember(uid, {email: "buyer@example.test", emailVerified: true});
  await seedMembership("sub_email_claim_retry", {
    payerUid: uid,
    entitlementTargetUid: uid,
    claimedVia: "verified_email",
  });
  const ownerId = createHash("sha256").update(uid).digest("hex");
  await db.collection("membershipEntitlementOwners").doc(ownerId).set({
    schemaVersion: 1,
    subscriptionId: "sub_email_claim_retry",
    userIdHash: ownerId,
    state: "active",
    createdAt: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now(),
  });

  const result = await claimMembership(request({}, uid));

  assert.deepEqual(result.claimed, ["sub_email_claim_retry"]);
  assert.equal(result.alreadyClaimed, true);
  assert.equal((await accessOf(uid)).alphaWodAccess, true);
});

test("a different verified account cannot claim someone else's purchase", async () => {
  await createMember("stranger", {email: "stranger@example.test", emailVerified: true});
  await seedMembership("sub_other");

  await assert.rejects(() => claimMembership(request({}, "stranger")));
  assert.equal((await accessOf("stranger")).alphaWodAccess, false);
});

test("a purchase can only be claimed once", async () => {
  // The realistic race is two people holding the same success link, so the
  // second account is a different identity; the session route does not check
  // the email, which is exactly why single-use matters.
  await createMember("first", {email: "buyer@example.test", emailVerified: true});
  await createMember("second", {email: "second@example.test", emailVerified: true});
  await seedMembership("sub_race");

  await claimMembership(request({sessionId: "cs_sub_race"}, "first"));
  await assert.rejects(() => claimMembership(request({sessionId: "cs_sub_race"}, "second")));

  assert.equal((await accessOf("first")).alphaWodAccess, true);
  assert.equal((await accessOf("second")).alphaWodAccess, false);
});

test("an expired session link is refused", async () => {
  await createMember("late", {email: "buyer@example.test", emailVerified: false});
  const twoDaysAgo = admin.firestore.Timestamp.fromMillis(Date.now() - 48 * 3600 * 1000);
  await seedMembership("sub_expired", {fulfilledAt: twoDaysAgo});

  await assert.rejects(
    () => claimMembership(request({sessionId: "cs_sub_expired"}, "late")),
    (error) => {
      assert.match(error.message, /expired/i);
      return true;
    }
  );
});

test("plans without app access never move a member's entitlement", async () => {
  await createMember("youthpayer", {email: "buyer@example.test", emailVerified: true});
  await seedMembership("sub_youth", {
    planKey: "youth_teenstars",
    planName: "TEEN ALPHAS - 11 & UP",
    grantsAlphaWodAccess: false,
    participant: {
      fullName: "Young Athlete",
      dateOfBirth: "2012-05-05",
      age: 14,
      isPayer: false,
      participantKey: "key_youth",
    },
  });

  await claimMembership(request({sessionId: "cs_sub_youth"}, "youthpayer"));

  // Payment confirmed, but a youth membership grants the payer nothing.
  assert.deepEqual(await accessOf("youthpayer"), {
    approvalStatus: "pending",
    entitlementStatus: "none",
    entitlementSource: "none",
    alphaWodAccess: false,
  });
});

test("staff keep role-based access when they buy a membership", async () => {
  await createMember("coach", {
    email: "buyer@example.test",
    emailVerified: true,
    profile: {
      role: "sgpt",
      approvalStatus: "approved",
      entitlementStatus: "active",
      entitlementSource: "staff",
      alphaWodAccess: true,
    },
  });
  await seedMembership("sub_staff");

  await claimMembership(request({sessionId: "cs_sub_staff"}, "coach"));

  // Staff entitlement is independent of any consumer membership.
  assert.deepEqual(await accessOf("coach"), {
    approvalStatus: "approved",
    entitlementStatus: "active",
    entitlementSource: "staff",
    alphaWodAccess: true,
  });
});

test("cancellation sends the policy's cancel_at to Stripe and records the outcome", async () => {
  await createMember("buyer", {email: "buyer@example.test", emailVerified: true});
  await seedMembership("sub_cancel", {payerUid: "buyer"});
  const expected = resolveCancellationOutcome(Date.now());
  const receivedNoEarlierThan = Date.now();

  const result = await requestMembershipCancellation(
    request({
      subscriptionId: "sub_cancel",
      expectedCancelAtUnixSeconds: expected.cancelAtUnixSeconds,
    }, "buyer")
  );

  assert.equal(result.outcome.cancelAtUnixSeconds, expected.cancelAtUnixSeconds);
  assert.equal(result.outcome.nextBillingDate, expected.nextBillingDate);
  assert.equal(result.receipt.kind, "contractual");
  assert.ok(result.receipt.reference);
  const receivedAtMillis = Date.parse(result.receipt.receivedAt);
  assert.ok(receivedAtMillis >= receivedNoEarlierThan);
  assert.ok(receivedAtMillis <= Date.now());

  // The date the policy computed is the date Stripe actually received.
  const sent = fakeStripe.lastUpdateTo("/v1/subscriptions/sub_cancel");
  assert.ok(sent, "expected a subscription update to reach Stripe");
  assert.equal(Number(sent.payload.cancel_at), expected.cancelAtUnixSeconds);
  assert.equal(sent.payload.proration_behavior, "none");

  const stored = await db.collection("memberships").doc("sub_cancel").get();
  assert.equal(stored.get("cancelAt"), expected.cancelAtUnixSeconds);
  assert.equal(
    stored.get("cancellationOutcome").accessEndsOnDate,
    expected.accessEndsOnDate
  );
  assert.equal(stored.get("cancellationRequest.id"), result.receipt.reference);
  assert.equal(
    stored.get("cancellationRequest.receivedAt").toMillis(),
    receivedAtMillis
  );

  const projected = await getMyMemberships(request({}, "buyer"));
  assert.deepEqual(projected.memberships[0].cancellationReceipt, result.receipt);
});

test("one youth-family cancellation receipt covers the subscription for every child", async () => {
  const nowMillis = new Date("2026-08-23T09:15:00Z").getTime();
  const subscriptionId = "sub_youngstars_family_cancel";
  const participants = [{
    fullName: "Sam Family",
    dateOfBirth: "2018-05-05",
    age: 8,
    isPayer: false,
    participantKey: "key_family_sam",
  }, {
    fullName: "Alex Family",
    dateOfBirth: "2017-04-04",
    age: 9,
    isPayer: false,
    participantKey: "key_family_alex",
  }];
  await createMember("familycancel", {
    email: "familycancel@example.test",
    emailVerified: true,
  });
  await seedMembership(subscriptionId, {
    payerUid: "familycancel",
    payerEmail: "familycancel@example.test",
    planKey: "youth_youngstars",
    stripePriceId: "price_youngstars",
    participant: participants[0],
    participants,
    participantKeys: participants.map(({participantKey}) => participantKey),
    participantCount: participants.length,
    guardian: {
      fullName: "Taylor Family",
      email: "familycancel@example.test",
      relationshipToParticipant: "Parent",
    },
  });
  fakeStripe.setSubscription(subscriptionId, {
    items: {
      object: "list",
      data: [{
        id: `si_${subscriptionId}`,
        current_period_end: 1788220800,
        price: "price_youngstars",
        quantity: 2,
      }],
    },
  });

  const realNow = Date.now;
  Date.now = () => nowMillis;
  try {
    const expected = resolveCancellationOutcome(nowMillis);
    const result = await requestMembershipCancellation(request({
      subscriptionId,
      expectedCancelAtUnixSeconds: expected.cancelAtUnixSeconds,
    }, "familycancel"));

    assert.equal(result.receipt.kind, "contractual");
    assert.equal(result.receipt.receivedAt, new Date(nowMillis).toISOString());
    assert.equal(
      fakeStripe.state.subscriptions.get(subscriptionId).cancel_at,
      expected.cancelAtUnixSeconds
    );

    const stored = await db.collection("memberships").doc(subscriptionId).get();
    assert.equal(stored.get("cancellationRequest.id"), result.receipt.reference);
    assert.equal(stored.get("participantCount"), 2);
    assert.deepEqual(
      stored.get("participants").map(({fullName}) => fullName),
      ["Sam Family", "Alex Family"]
    );

    const projected = await getMyMemberships(request({}, "familycancel"));
    assert.equal(projected.memberships.length, 1);
    assert.deepEqual(
      projected.memberships[0].participantFullNames,
      ["Sam Family", "Alex Family"]
    );
    assert.equal(projected.memberships[0].participantCount, 2);
    assert.deepEqual(projected.memberships[0].cancellationReceipt, result.receipt);
  } finally {
    Date.now = realNow;
  }
});

test("cooling-off cancellation records an immutable receipt before stopping Stripe", async () => {
  const nowMillis = new Date("2026-08-18T10:00:00Z").getTime();
  await createMember("coolingoffbuyer", {
    email: "coolingoffbuyer@example.test",
    emailVerified: true,
  });
  await seedMembership("sub_cooling_off", {
    payerUid: "coolingoffbuyer",
    billingMode: "standard",
    serviceStartsAt: Math.floor(new Date("2026-09-01T00:00:00Z").getTime() / 1000),
    firstPaymentAt: Math.floor(new Date("2026-09-01T00:00:00Z").getTime() / 1000),
    firstPaymentReceivedAt: null,
  });
  await db.collection("memberships").doc("sub_cooling_off").update({
    "acceptances.contractMadeAt": admin.firestore.Timestamp.fromDate(
      new Date("2026-08-17T10:00:00Z")
    ),
    "acceptances.coolingOffEndsAt": "2026-08-31T23:59:59.999+01:00",
  });

  const realNow = Date.now;
  Date.now = () => nowMillis;
  try {
    const preview = resolveCancellationOutcome(nowMillis);
    const result = await requestMembershipCancellation(request({
      subscriptionId: "sub_cooling_off",
      expectedCancelAtUnixSeconds: preview.cancelAtUnixSeconds,
      kind: "cooling_off",
    }, "coolingoffbuyer"));

    assert.equal(result.ok, true);
    assert.equal(result.requestStatus, "applied");
    assert.equal(result.receipt.kind, "cooling_off");
    assert.equal(result.receipt.receivedAt, new Date(nowMillis).toISOString());
    assert.equal(result.receipt.refundReviewRequired, false);
    assert.equal(
      fakeStripe.lastUpdateTo("/v1/subscriptions/sub_cooling_off").method,
      "DELETE"
    );

    let stored = await db.collection("memberships").doc("sub_cooling_off").get();
    assert.equal(stored.get("cancellationRequest.kind"), "cooling_off");
    assert.equal(stored.get("cancellationRequest.status"), "applied");
    assert.equal(stored.get("cancellationRequest.collectFuturePayments"), false);
    assert.equal(stored.get("cancellationRequest.futurePaymentDuePence"), 0);
    assert.equal(stored.get("cancellationRequest.refundAmountPence"), null);
    assert.equal(
      stored.get("cancellationRequest.cancellationEffectiveAtMillis"),
      nowMillis
    );
    assert.equal(
      stored.get("cancellationOutcome.cancelAtUnixSeconds"),
      Math.floor(nowMillis / 1000)
    );

    // Stripe's provider completion may be later than the legal receipt. It is
    // recorded separately and cannot move the effective/access stop.
    fakeStripe.setSubscription("sub_cooling_off", {
      status: "canceled",
      ended_at: Math.floor(nowMillis / 1000) + 45,
      cancel_at: null,
    });
    await membershipTesting.convergeMembershipFromStripe(
      "sub_cooling_off",
      async () => undefined,
      {},
      nowMillis + 60_000
    );
    stored = await db.collection("memberships").doc("sub_cooling_off").get();
    assert.equal(stored.get("cancellationRequest.status"), "applied");
    assert.equal(
      stored.get("cancellationRequest.providerEndedAtMillis"),
      nowMillis + 45_000
    );
    assert.equal(
      stored.get("cancellationRequest.cancellationEffectiveAtMillis"),
      nowMillis
    );
    assert.equal(
      stored.get("cancellationOutcome.cancelAtUnixSeconds"),
      Math.floor(nowMillis / 1000)
    );
    assert.equal(stored.get("cancellationRequest.lastError"), undefined);

    const receipt = await db.collection("membershipCancellationReceipts")
      .doc(result.receipt.reference).get();
    assert.equal(receipt.exists, true);
    assert.equal(receipt.get("receivedAtMillis"), nowMillis);
    assert.equal(receipt.get("outcome.collectFuturePayments"), false);
    assert.equal(receipt.get("outcome.refundAmountPence"), null);
    const outbox = await db.collection("membershipEmailOutbox")
      .doc(`cancellation-${result.receipt.reference}`).get();
    assert.equal(outbox.get("kind"), "membership_cancellation_acknowledgement");
    assert.equal(outbox.get("subscriptionId"), "sub_cooling_off");
    assert.match(outbox.get("payload.html"), /No further recurring membership payment/);

    const projected = await getMyMemberships(request({}, "coolingoffbuyer"));
    assert.equal(
      projected.memberships[0].cancellationReceipt.reference,
      result.receipt.reference
    );
    assert.equal(projected.memberships[0].cancellationRequestStatus, "applied");
    assert.equal(
      projected.memberships[0].cancellationReceipt.acknowledgementStatus,
      "pending"
    );
  } finally {
    Date.now = realNow;
  }
});

test("a Stripe outage cannot undo an accepted cooling-off receipt", async () => {
  const nowMillis = new Date("2026-08-18T11:00:00Z").getTime();
  const subscriptionId = "sub_cooling_off_outage";
  await createMember("coolingoffoutage", {
    email: "coolingoffoutage@example.test",
    emailVerified: true,
  });
  await seedMembership(subscriptionId, {
    payerUid: "coolingoffoutage",
    payerEmail: "coolingoffoutage@example.test",
    billingMode: "standard",
    serviceStartsAt: Math.floor(new Date("2026-09-01T00:00:00Z").getTime() / 1000),
    firstPaymentAt: Math.floor(new Date("2026-09-01T00:00:00Z").getTime() / 1000),
    firstPaymentReceivedAt: null,
  });
  await db.collection("memberships").doc(subscriptionId).update({
    "acceptances.contractMadeAt": admin.firestore.Timestamp.fromDate(
      new Date("2026-08-17T11:00:00Z")
    ),
    "acceptances.coolingOffEndsAt": "2026-08-31T23:59:59.999+01:00",
  });
  fakeStripe.state.subscriptions.delete(subscriptionId);

  const realNow = Date.now;
  Date.now = () => nowMillis;
  try {
    const preview = resolveCancellationOutcome(nowMillis);
    const result = await requestMembershipCancellation(request({
      subscriptionId,
      expectedCancelAtUnixSeconds: preview.cancelAtUnixSeconds,
      kind: "cooling_off",
    }, "coolingoffoutage"));

    assert.equal(result.ok, true);
    assert.equal(result.outcome, null);
    assert.equal(result.requestStatus, "accepted");
    assert.ok(result.receipt.reference);
    const receiptBefore = (await db.collection("membershipCancellationReceipts")
      .doc(result.receipt.reference).get()).data();
    const pending = await db.collection("memberships").doc(subscriptionId).get();
    assert.equal(pending.get("cancellationRequest.status"), "pending");
    assert.ok(pending.get("cancellationRequest.nextAttemptAt"));

    const projectedPending = await getMyMemberships(
      request({}, "coolingoffoutage")
    );
    assert.equal(
      projectedPending.memberships[0].cancellationRequestStatus,
      "accepted"
    );
    assert.equal(
      projectedPending.memberships[0].cancellationReceipt.reference,
      result.receipt.reference
    );

    fakeStripe.setSubscription(subscriptionId, {
      status: "active",
      customer: "cus_fake_1",
    });
    const recovery = await membershipTesting.recoverPendingCancellationsOnce(
      nowMillis + 11 * 60 * 1000
    );
    assert.deepEqual(recovery, {processed: 1, failed: 0, skipped: 0});
    assert.equal(
      fakeStripe.state.subscriptions.get(subscriptionId).status,
      "canceled"
    );
    const recovered = await db.collection("memberships").doc(subscriptionId).get();
    assert.equal(recovered.get("cancellationRequest.status"), "applied");
    assert.equal(
      recovered.get("cancellationRequest.cancellationEffectiveAtMillis"),
      nowMillis
    );
    assert.deepEqual(
      (await db.collection("membershipCancellationReceipts")
        .doc(result.receipt.reference).get()).data(),
      receiptBefore
    );
  } finally {
    Date.now = realNow;
  }
});

test("cooling-off acknowledgement retries update only acknowledgement state", async () => {
  const nowMillis = new Date("2026-08-18T12:00:00Z").getTime();
  const subscriptionId = "sub_cooling_off_ack";
  await createMember("coolingoffack", {
    email: "coolingoffack@example.test",
    emailVerified: true,
  });
  await seedMembership(subscriptionId, {
    payerUid: "coolingoffack",
    payerEmail: "coolingoffack@example.test",
    billingMode: "standard",
    serviceStartsAt: Math.floor(new Date("2026-09-01T00:00:00Z").getTime() / 1000),
    firstPaymentAt: Math.floor(new Date("2026-09-01T00:00:00Z").getTime() / 1000),
    firstPaymentReceivedAt: null,
  });
  await db.collection("memberships").doc(subscriptionId).update({
    "acceptances.contractMadeAt": admin.firestore.Timestamp.fromDate(
      new Date("2026-08-17T12:00:00Z")
    ),
    "acceptances.coolingOffEndsAt": "2026-08-31T23:59:59.999+01:00",
  });

  const realNow = Date.now;
  Date.now = () => nowMillis;
  try {
    const preview = resolveCancellationOutcome(nowMillis);
    const cancellation = await requestMembershipCancellation(request({
      subscriptionId,
      expectedCancelAtUnixSeconds: preview.cancelAtUnixSeconds,
      kind: "cooling_off",
    }, "coolingoffack"));
    const outboxId = `cancellation-${cancellation.receipt.reference}`;
    const outboxReadyAt = (await db.collection("membershipEmailOutbox")
      .doc(outboxId).get()).get("nextAttemptAt").toMillis() + 1;
    const sends = [];
    assert.equal(
      await membershipTesting.processMembershipConfirmationOutbox(
        outboxId,
        outboxReadyAt,
        async (payload, idempotencyKey) => {
          sends.push({payload, idempotencyKey});
          throw new Error("provider accepted but response was lost");
        }
      ),
      "failed"
    );
    let membership = await db.collection("memberships").doc(subscriptionId).get();
    assert.equal(membership.get("cancellationAcknowledgementStatus"), "pending");
    assert.match(
      membership.get("cancellationAcknowledgementError"),
      /response was lost/
    );
    assert.ok(membership.get("confirmationEmailSentAt"));

    assert.equal(
      await membershipTesting.processMembershipConfirmationOutbox(
        outboxId,
        outboxReadyAt + 6 * 60 * 1000,
        async (payload, idempotencyKey) => {
          sends.push({payload, idempotencyKey});
          return {providerMessageId: "email_cancel_ack_1"};
        }
      ),
      "sent"
    );
    assert.equal(sends.length, 2);
    assert.deepEqual(sends[0], sends[1]);
    assert.equal(sends[0].payload.reply_to, "support@zeroalphafitness.co.uk");
    assert.match(sends[0].payload.subject, /Cancellation received/);
    membership = await db.collection("memberships").doc(subscriptionId).get();
    assert.equal(membership.get("cancellationAcknowledgementStatus"), "sent");
    assert.equal(
      membership.get("cancellationAcknowledgementProviderId"),
      "email_cancel_ack_1"
    );
    assert.equal(membership.get("cancellationAcknowledgementError"), undefined);
    assert.ok(membership.get("confirmationEmailSentAt"));

    const projected = await getMyMemberships(request({}, "coolingoffack"));
    assert.equal(
      projected.memberships[0].cancellationReceipt.acknowledgementStatus,
      "sent"
    );
  } finally {
    Date.now = realNow;
  }
});

test("cooling-off keeps cancellation acceptance separate from refund review", async () => {
  const nowMillis = new Date("2026-08-18T13:00:00Z").getTime();
  const contractMillis = new Date("2026-08-17T13:00:00Z").getTime();
  const subscriptionId = "sub_cooling_off_refund_review";
  await createMember("coolingoffrefund", {
    email: "coolingoffrefund@example.test",
    emailVerified: true,
  });
  await seedMembership(subscriptionId, {
    payerUid: "coolingoffrefund",
    payerEmail: "coolingoffrefund@example.test",
    billingMode: "standard",
    serviceStartsAt: Math.floor(contractMillis / 1000),
    firstPaymentAt: Math.floor(contractMillis / 1000),
    firstPaymentReceivedAt: Math.floor(contractMillis / 1000),
  });
  await db.collection("memberships").doc(subscriptionId).update({
    "acceptances.contractMadeAt": admin.firestore.Timestamp.fromMillis(
      contractMillis
    ),
    "acceptances.coolingOffEndsAt": "2026-08-31T23:59:59.999+01:00",
  });

  const realNow = Date.now;
  Date.now = () => nowMillis;
  try {
    const preview = resolveCancellationOutcome(nowMillis);
    const result = await requestMembershipCancellation(request({
      subscriptionId,
      expectedCancelAtUnixSeconds: preview.cancelAtUnixSeconds,
      kind: "cooling_off",
    }, "coolingoffrefund"));

    assert.equal(result.ok, true);
    assert.equal(result.requestStatus, "refund_review");
    assert.equal(result.receipt.refundReviewRequired, true);
    const receipt = await db.collection("membershipCancellationReceipts")
      .doc(result.receipt.reference).get();
    assert.equal(receipt.get("outcome.refundReviewRequired"), true);
    assert.equal(receipt.get("outcome.refundAmountPence"), null);
    const projected = await getMyMemberships(
      request({}, "coolingoffrefund")
    );
    assert.equal(
      projected.memberships[0].cancellationRequestStatus,
      "refund_review"
    );
    assert.equal(
      projected.memberships[0].cancellationReceipt.refundReviewRequired,
      true
    );
  } finally {
    Date.now = realNow;
  }
});

test("a missing payer email accepts cooling-off but immediately audits acknowledgement review", async () => {
  const nowMillis = new Date("2026-08-18T13:30:00Z").getTime();
  const subscriptionId = "sub_cooling_off_missing_email";
  await createMember("coolingoffmissingemail", {
    email: "coolingoffmissingemail@example.test",
    emailVerified: true,
  });
  await seedMembership(subscriptionId, {
    payerUid: "coolingoffmissingemail",
    payerEmail: null,
    billingMode: "standard",
    serviceStartsAt: Math.floor(new Date("2026-09-01T00:00:00Z").getTime() / 1000),
    firstPaymentAt: Math.floor(new Date("2026-09-01T00:00:00Z").getTime() / 1000),
    firstPaymentReceivedAt: null,
  });
  await db.collection("memberships").doc(subscriptionId).update({
    "acceptances.contractMadeAt": admin.firestore.Timestamp.fromDate(
      new Date("2026-08-17T13:30:00Z")
    ),
    "acceptances.coolingOffEndsAt": "2026-08-31T23:59:59.999+01:00",
  });

  const realNow = Date.now;
  Date.now = () => nowMillis;
  try {
    const preview = resolveCancellationOutcome(nowMillis);
    const result = await requestMembershipCancellation(request({
      subscriptionId,
      expectedCancelAtUnixSeconds: preview.cancelAtUnixSeconds,
      kind: "cooling_off",
    }, "coolingoffmissingemail"));

    assert.equal(result.ok, true);
    assert.equal(result.requestStatus, "applied");
    assert.equal(result.receipt.acknowledgementStatus, "failed");
    const membership = await db.collection("memberships").doc(subscriptionId).get();
    assert.equal(
      membership.get("cancellationAcknowledgementStatus"),
      "manual_review"
    );
    assert.match(
      membership.get("cancellationAcknowledgementError"),
      /payer email was unavailable/i
    );
    const outbox = await db.collection("membershipEmailOutbox")
      .doc(`cancellation-${result.receipt.reference}`).get();
    assert.equal(outbox.get("status"), "manual_review");
    assert.equal(outbox.get("nextAttemptAt"), undefined);
    const audits = await db.collection("membershipAudit")
      .where("subscriptionId", "==", subscriptionId)
      .where("type", "==", "cancellation_acknowledgement_terminal")
      .get();
    assert.equal(audits.size, 1);
    assert.equal(audits.docs[0].get("severity"), "critical");
    assert.match(audits.docs[0].get("error"), /payer email was unavailable/i);
  } finally {
    Date.now = realNow;
  }
});

test("an expired cooling-off confirmation cannot become a contractual cancellation", async () => {
  const nowMillis = new Date("2026-08-18T14:00:00Z").getTime();
  const subscriptionId = "sub_cooling_off_expired";
  await createMember("coolingoffexpired", {
    email: "coolingoffexpired@example.test",
    emailVerified: true,
  });
  await seedMembership(subscriptionId, {
    payerUid: "coolingoffexpired",
    billingMode: "standard",
    serviceStartsAt: Math.floor(nowMillis / 1000),
    firstPaymentAt: Math.floor(nowMillis / 1000),
    firstPaymentReceivedAt: Math.floor(nowMillis / 1000),
  });
  await db.collection("memberships").doc(subscriptionId).update({
    "acceptances.contractMadeAt": admin.firestore.Timestamp.fromMillis(
      nowMillis - 15 * 24 * 60 * 60 * 1000
    ),
    "acceptances.coolingOffEndsAt": new Date(nowMillis - 1).toISOString(),
  });

  const realNow = Date.now;
  Date.now = () => nowMillis;
  try {
    const preview = resolveCancellationOutcome(nowMillis);
    await assert.rejects(
      () => requestMembershipCancellation(request({
        subscriptionId,
        expectedCancelAtUnixSeconds: preview.cancelAtUnixSeconds,
        kind: "cooling_off",
      }, "coolingoffexpired")),
      (error) => {
        assert.match(error.message, /cooling-off period ended/i);
        assert.equal(error.details?.reason, "cooling_off_expired");
        return true;
      }
    );
    const membership = await db.collection("memberships").doc(subscriptionId).get();
    assert.equal(membership.get("cancellationRequest"), undefined);
    assert.equal(
      fakeStripe.lastUpdateTo(`/v1/subscriptions/${subscriptionId}`),
      null
    );
  } finally {
    Date.now = realNow;
  }
});

test("a scheduled presale can cancel before service and prevent its first charge", async () => {
  const nowMillis = new Date("2026-08-20T10:00:00Z").getTime();
  await createMember("presalecancel", {
    email: "presalecancel@example.test",
    emailVerified: true,
  });
  await seedMembership("sub_presale_cancel", {
    payerUid: "presalecancel",
    state: "scheduled",
    billingMode: "presale_deferred",
    serviceStartsAt: PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS,
    firstPaymentAt: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
    billingCycleAnchor: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
    initialChargePence: 0,
    firstPaymentReceivedAt: null,
    firstPaidInvoiceId: null,
    discount: null,
    paymentSchedule: {
      amountDueTodayPence: 0,
      firstPaymentAt: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
      standardMonthlyPence: 6000,
      discountedMonthlyPence: null,
      discountedPaymentCount: 0,
      fullPriceFrom: null,
    },
  });
  await db.collection("memberships").doc("sub_presale_cancel").update({
    "acceptances.coolingOffEndsAt": "2026-09-03T23:59:59.999+01:00",
  });

  const realNow = Date.now;
  Date.now = () => nowMillis;
  try {
    const ordinaryPreview = resolveCancellationOutcome(nowMillis);
    const result = await requestMembershipCancellation(request({
      subscriptionId: "sub_presale_cancel",
      expectedCancelAtUnixSeconds: ordinaryPreview.cancelAtUnixSeconds,
    }, "presalecancel"));

    assert.equal(result.outcome.finalPaymentDate, null);
    assert.equal(result.outcome.cancelAtUnixSeconds, Math.floor(nowMillis / 1000));
    assert.equal(result.receipt.kind, "presale_withdrawal");
    assert.equal(result.receipt.receivedAt, new Date(nowMillis).toISOString());
    assert.ok(result.receipt.reference);
    assert.equal(
      fakeStripe.state.subscriptions.get("sub_presale_cancel").status,
      "canceled"
    );
    const membership = await db.collection("memberships")
      .doc("sub_presale_cancel").get();
    assert.equal(membership.get("state"), "cancelled");
    assert.equal(membership.get("cancellationRequest.kind"), "presale_withdrawal");
    assert.equal(membership.get("cancellationRequest.id"), result.receipt.reference);
    assert.equal(membership.get("firstPaymentReceivedAt"), null);
    const projected = await getMyMemberships(request({}, "presalecancel"));
    assert.deepEqual(projected.memberships[0].cancellationReceipt, result.receipt);
  } finally {
    Date.now = realNow;
  }
});

test("a cancelled signed-in presale releases its owner without changing legacy access", async () => {
  const nowMillis = new Date("2026-08-20T10:00:00Z").getTime();
  const uid = "presalelegacyreplacement";
  await createMember(uid, {
    email: "presalelegacyreplacement@example.test",
    emailVerified: true,
    profile: {
      approvalStatus: "approved",
      entitlementStatus: "active",
      entitlementSource: "legacy",
      alphaWodAccess: true,
    },
  });
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => nowMillis;
  try {
    const firstCheckout = await handler(request(
      validCheckoutData("attempt_presale_legacy_owner_first"),
      uid
    ));
    const intentSnap = (await db.collection("membershipIntents").get()).docs[0];
    const intent = intentSnap.data();
    const subscriptionId = "sub_presale_legacy_owner";
    const customerId = "cus_presale_legacy_owner";
    fakeStripe.setSubscription(subscriptionId, {
      status: "active",
      customer: customerId,
      billing_cycle_anchor: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
      metadata: {intentId: intentSnap.id, planKey: intent.planKey},
    });
    await handleStripeEvent({
      id: "evt_presale_legacy_owner_completed",
      type: "checkout.session.completed",
      created: Math.floor(nowMillis / 1000),
      data: {object: {
        id: firstCheckout.sessionId,
        object: "checkout.session",
        livemode: false,
        mode: "subscription",
        status: "complete",
        expires_at: intent.checkoutExpiresAt,
        metadata: {intentId: intentSnap.id, planKey: intent.planKey},
        payment_status: "no_payment_required",
        payment_method_collection: "always",
        subscription: subscriptionId,
        customer: customerId,
        customer_details: {email: "presalelegacyreplacement@example.test"},
        amount_total: 0,
        discounts: [],
      }},
    }, async () => undefined);

    const ownerRef = db.collection("membershipEntitlementOwners").doc(
      createHash("sha256").update(uid).digest("hex")
    );
    assert.equal((await ownerRef.get()).get("state"), "active");
    assert.deepEqual(await accessOf(uid), {
      approvalStatus: "approved",
      entitlementStatus: "active",
      entitlementSource: "legacy",
      alphaWodAccess: true,
    });

    const ordinaryPreview = resolveCancellationOutcome(nowMillis);
    await requestMembershipCancellation(request({
      subscriptionId,
      expectedCancelAtUnixSeconds: ordinaryPreview.cancelAtUnixSeconds,
    }, uid));

    assert.equal((await ownerRef.get()).get("state"), "released");
    assert.equal(
      (await db.collection("memberships").doc(subscriptionId).get()).get("state"),
      "cancelled"
    );
    assert.deepEqual(await accessOf(uid), {
      approvalStatus: "approved",
      entitlementStatus: "active",
      entitlementSource: "legacy",
      alphaWodAccess: true,
    });

    const replacement = await handler(request(
      validCheckoutData("attempt_presale_legacy_owner_replacement"),
      uid
    ));
    assert.notEqual(replacement.sessionId, firstCheckout.sessionId);
    assert.equal((await db.collection("membershipIntents").get()).size, 2);
  } finally {
    Date.now = realNow;
  }
});

test("presale cancellation tolerates provider end-time latency before service", async () => {
  const receivedAtMillis = (PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS - 1) * 1000;
  const receivedAt = Math.floor(receivedAtMillis / 1000);
  await createMember("presalelatency", {
    email: "presalelatency@example.test",
    emailVerified: true,
  });
  await seedMembership("sub_presale_latency", {
    payerUid: "presalelatency",
    state: "scheduled",
    billingMode: "presale_deferred",
    serviceStartsAt: PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS,
    firstPaymentAt: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
    billingCycleAnchor: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
    initialChargePence: 0,
    firstPaymentReceivedAt: null,
    firstPaidInvoiceId: null,
    discount: null,
    paymentSchedule: {
      amountDueTodayPence: 0,
      firstPaymentAt: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
      standardMonthlyPence: 6000,
      discountedMonthlyPence: null,
      discountedPaymentCount: 0,
      fullPriceFrom: null,
    },
  });
  const outcome = {
    nextBillingDate: "2026-09-01",
    noticeDeadlineMet: true,
    noticeDaysGiven: 11,
    noticeDeadlineDate: "2026-08-18",
    finalPaymentDate: null,
    accessEndsOnDate: "2026-08-31",
    cancelAtUnixSeconds: receivedAt,
  };
  await db.collection("memberships").doc("sub_presale_latency").set({
    cancellationRequest: {
      id: "cancel_presale_latency",
      kind: "presale_withdrawal",
      status: "pending",
      receivedAt: admin.firestore.Timestamp.fromMillis(receivedAtMillis),
      outcome,
      attemptCount: 1,
      repairGeneration: 0,
    },
  }, {merge: true});
  fakeStripe.setSubscription("sub_presale_latency", {
    status: "canceled",
    ended_at: receivedAt + 5,
    cancel_at: null,
  });

  await membershipTesting.convergeMembershipFromStripe(
    "sub_presale_latency",
    async () => undefined,
    {},
    (receivedAt + 10) * 1000
  );

  const membership = await db.collection("memberships")
    .doc("sub_presale_latency").get();
  assert.equal(membership.get("cancellationRequest.status"), "applied");
  assert.equal(membership.get("cancellationRequest.stripeCancelAt"), receivedAt + 5);
  assert.ok(membership.get("cancellationRequest.stripeCancelAt") >=
    PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS);
  assert.equal(membership.get("cancellationOutcome.cancelAtUnixSeconds"), receivedAt);
  assert.equal(membership.get("cancellationRequest.lastError"), undefined);
});

test("a cancellation retry reuses its frozen receipt after Stripe success", async () => {
  const earlyReceipt = new Date("2026-08-17T10:00:00Z").getTime();
  const retryTime = new Date("2026-08-20T10:00:00Z").getTime();
  const frozenOutcome = resolveCancellationOutcome(earlyReceipt);
  await createMember("cancelretry", {
    email: "cancelretry@example.test",
    emailVerified: true,
  });
  await seedMembership("sub_cancel_retry", {payerUid: "cancelretry"});
  await db.collection("memberships").doc("sub_cancel_retry").set({
    cancellationRequest: {
      id: "cancel_request_before_crash",
      status: "pending",
      receivedAt: admin.firestore.Timestamp.fromMillis(earlyReceipt),
      outcome: frozenOutcome,
    },
  }, {merge: true});
  fakeStripe.setSubscription("sub_cancel_retry", {
    status: "active",
    cancel_at: frozenOutcome.cancelAtUnixSeconds,
  });

  const realNow = Date.now;
  Date.now = () => retryTime;
  try {
    const result = await requestMembershipCancellation(
      request({
        subscriptionId: "sub_cancel_retry",
        expectedCancelAtUnixSeconds: frozenOutcome.cancelAtUnixSeconds,
      }, "cancelretry")
    );
    assert.equal(result.outcome.cancelAtUnixSeconds, frozenOutcome.cancelAtUnixSeconds);
    assert.equal(
      fakeStripe.state.subscriptions.get("sub_cancel_retry").cancel_at,
      frozenOutcome.cancelAtUnixSeconds
    );
    const stored = await db.collection("memberships").doc("sub_cancel_retry").get();
    assert.equal(stored.get("cancelAt"), frozenOutcome.cancelAtUnixSeconds);
    assert.equal(stored.get("cancellationRequest.status"), "applied");
    assert.equal(
      stored.get("cancellationRequestedAt").toMillis(),
      earlyReceipt
    );
  } finally {
    Date.now = realNow;
  }
});

test("Stripe convergence settles a cancellation that crashed before final storage", async () => {
  const receivedAtMillis = new Date("2026-08-20T10:00:00Z").getTime();
  const frozenOutcome = resolveCancellationOutcome(receivedAtMillis);
  await createMember("cancelconverge", {
    email: "cancelconverge@example.test",
    emailVerified: true,
  });
  await seedMembership("sub_cancel_converge", {payerUid: "cancelconverge"});
  await db.collection("memberships").doc("sub_cancel_converge").set({
    cancellationRequest: {
      id: "cancel_request_before_webhook",
      status: "pending",
      receivedAt: admin.firestore.Timestamp.fromMillis(receivedAtMillis),
      outcome: frozenOutcome,
    },
    cancellationOutcome: null,
  }, {merge: true});
  fakeStripe.setSubscription("sub_cancel_converge", {
    status: "active",
    cancel_at: frozenOutcome.cancelAtUnixSeconds,
  });

  await membershipTesting.convergeMembershipFromStripe(
    "sub_cancel_converge",
    async () => undefined,
    {},
    receivedAtMillis
  );

  const stored = await db.collection("memberships").doc("sub_cancel_converge").get();
  assert.equal(stored.get("cancellationRequest.status"), "applied");
  assert.equal(
    stored.get("cancellationOutcome.cancelAtUnixSeconds"),
    frozenOutcome.cancelAtUnixSeconds
  );
  assert.equal(
    stored.get("cancellationOutcome.finalPaymentDate"),
    frozenOutcome.finalPaymentDate
  );
});

test("scheduled recovery applies a frozen cancellation without the payer returning", async () => {
  const recoveryNow = new Date("2026-08-17T10:00:00Z").getTime();
  const frozenOutcome = resolveCancellationOutcome(recoveryNow);
  await createMember("cancelworker", {
    email: "cancelworker@example.test",
    emailVerified: true,
  });
  await seedMembership("sub_cancel_worker", {payerUid: "cancelworker"});
  await db.collection("memberships").doc("sub_cancel_worker").set({
    cancellationRequest: {
      id: "cancel_request_for_worker",
      status: "pending",
      receivedAt: admin.firestore.Timestamp.fromMillis(recoveryNow - 60_000),
      outcome: frozenOutcome,
      attemptCount: 1,
      nextAttemptAt: admin.firestore.Timestamp.fromMillis(recoveryNow - 1),
    },
  }, {merge: true});

  const realNow = Date.now;
  Date.now = () => recoveryNow;
  try {
    const result = await membershipTesting.recoverPendingCancellationsOnce(recoveryNow);

    assert.deepEqual(result, {processed: 1, failed: 0, skipped: 0});
    const stored = await db.collection("memberships").doc("sub_cancel_worker").get();
    assert.equal(stored.get("cancellationRequest.status"), "applied");
    assert.equal(
      stored.get("cancellationOutcome.cancelAtUnixSeconds"),
      frozenOutcome.cancelAtUnixSeconds
    );
    assert.equal(
      fakeStripe.state.subscriptions.get("sub_cancel_worker").cancel_at,
      frozenOutcome.cancelAtUnixSeconds
    );
  } finally {
    Date.now = realNow;
  }
});

test("scheduled cancellation recovery keeps a provider failure retryable", async () => {
  const recoveryNow = new Date("2026-08-17T10:00:00Z").getTime();
  const frozenOutcome = resolveCancellationOutcome(recoveryNow);
  await createMember("canceloutage", {
    email: "canceloutage@example.test",
    emailVerified: true,
  });
  await seedMembership("sub_cancel_outage", {payerUid: "canceloutage"});
  fakeStripe.state.subscriptions.delete("sub_cancel_outage");
  await db.collection("memberships").doc("sub_cancel_outage").set({
    cancellationRequest: {
      id: "cancel_request_during_outage",
      status: "pending",
      receivedAt: admin.firestore.Timestamp.fromMillis(recoveryNow - 60_000),
      outcome: frozenOutcome,
      attemptCount: 1,
      nextAttemptAt: admin.firestore.Timestamp.fromMillis(recoveryNow - 1),
    },
  }, {merge: true});

  const realNow = Date.now;
  Date.now = () => recoveryNow;
  try {
    const result = await membershipTesting.recoverPendingCancellationsOnce(recoveryNow);

    assert.deepEqual(result, {processed: 0, failed: 1, skipped: 0});
    const stored = await db.collection("memberships").doc("sub_cancel_outage").get();
    assert.equal(stored.get("cancellationRequest.status"), "pending");
    assert.equal(stored.get("cancellationRequest.repairGeneration"), 1);
    assert.ok(stored.get("cancellationRequest.nextAttemptAt").toMillis() > recoveryNow);
    assert.match(stored.get("cancellationRequest.lastError"), /No such subscription/i);
  } finally {
    Date.now = realNow;
  }
});

test("convergence requeues and repairs a confirmed schedule removed in Stripe", async () => {
  const nowMillis = new Date("2026-08-17T10:00:00Z").getTime();
  const frozenOutcome = resolveCancellationOutcome(nowMillis);
  await createMember("canceldrift", {
    email: "canceldrift@example.test",
    emailVerified: true,
  });
  await seedMembership("sub_cancel_drift", {payerUid: "canceldrift"});
  await db.collection("memberships").doc("sub_cancel_drift").set({
    cancelAt: frozenOutcome.cancelAtUnixSeconds,
    cancellationRequestedAt: admin.firestore.Timestamp.fromMillis(nowMillis),
    cancellationOutcome: frozenOutcome,
    cancellationRequest: {
      id: "cancel_request_drifted",
      status: "applied",
      receivedAt: admin.firestore.Timestamp.fromMillis(nowMillis),
      outcome: frozenOutcome,
      attemptCount: 1,
      repairGeneration: 0,
    },
  }, {merge: true});
  fakeStripe.setSubscription("sub_cancel_drift", {
    status: "active",
    cancel_at: null,
  });

  const realNow = Date.now;
  Date.now = () => nowMillis;
  try {
    await membershipTesting.convergeMembershipFromStripe(
      "sub_cancel_drift",
      async () => undefined,
      {},
      nowMillis
    );
    const queued = await db.collection("memberships").doc("sub_cancel_drift").get();
    assert.equal(queued.get("cancellationOutcome"), null);
    assert.equal(queued.get("cancellationRequest.status"), "pending");
    assert.equal(queued.get("cancellationRequest.repairGeneration"), 1);
    assert.equal(queued.get("cancelAt"), frozenOutcome.cancelAtUnixSeconds);

    const result = await membershipTesting.recoverPendingCancellationsOnce(
      nowMillis + 1
    );
    assert.deepEqual(result, {processed: 1, failed: 0, skipped: 0});
    const repaired = await db.collection("memberships").doc("sub_cancel_drift").get();
    assert.equal(repaired.get("cancellationRequest.status"), "applied");
    assert.equal(
      repaired.get("cancellationOutcome.cancelAtUnixSeconds"),
      frozenOutcome.cancelAtUnixSeconds
    );
    assert.equal(
      fakeStripe.state.subscriptions.get("sub_cancel_drift").cancel_at,
      frozenOutcome.cancelAtUnixSeconds
    );
  } finally {
    Date.now = realNow;
  }
});

test("an overdue cancellation stops billing and preserves refund-review evidence", async () => {
  const receivedAt = new Date("2026-05-18T10:00:00Z").getTime();
  const recoveryNow = new Date("2026-08-18T10:00:00Z").getTime();
  const frozenOutcome = resolveCancellationOutcome(receivedAt);
  assert.ok(frozenOutcome.cancelAtUnixSeconds < Math.floor(recoveryNow / 1000));
  await createMember("canceloverdue", {
    email: "canceloverdue@example.test",
    emailVerified: true,
  });
  await seedMembership("sub_cancel_overdue", {payerUid: "canceloverdue"});
  await db.collection("memberships").doc("sub_cancel_overdue").set({
    cancelAt: frozenOutcome.cancelAtUnixSeconds,
    cancellationRequestedAt: admin.firestore.Timestamp.fromMillis(receivedAt),
    cancellationOutcome: frozenOutcome,
    cancellationRequest: {
      id: "cancel_request_overdue_drift",
      status: "applied",
      receivedAt: admin.firestore.Timestamp.fromMillis(receivedAt),
      outcome: frozenOutcome,
      attemptCount: 1,
      repairGeneration: 0,
    },
  }, {merge: true});
  fakeStripe.setSubscription("sub_cancel_overdue", {
    status: "active",
    cancel_at: null,
  });

  const realNow = Date.now;
  Date.now = () => recoveryNow;
  try {
    await membershipTesting.convergeMembershipFromStripe(
      "sub_cancel_overdue",
      async () => undefined,
      {},
      recoveryNow
    );
    const queued = await db.collection("memberships")
      .doc("sub_cancel_overdue").get();
    assert.equal(queued.get("cancellationRequest.status"), "pending");
    assert.equal(
      queued.get("cancellationRequest.recoveryStartedAt").toMillis(),
      recoveryNow
    );

    const result = await membershipTesting.recoverPendingCancellationsOnce(
      recoveryNow
    );
    assert.deepEqual(result, {processed: 1, failed: 0, skipped: 0});
    const stopped = fakeStripe.state.subscriptions.get("sub_cancel_overdue");
    assert.equal(stopped.status, "canceled");
    assert.equal(
      fakeStripe.lastUpdateTo("/v1/subscriptions/sub_cancel_overdue").method,
      "DELETE"
    );

    const stored = await db.collection("memberships")
      .doc("sub_cancel_overdue").get();
    assert.equal(stored.get("stripeStatus"), "canceled");
    assert.equal(stored.get("cancellationRequest.status"), "manual_review");
    assert.equal(
      stored.get("cancellationOutcome.cancelAtUnixSeconds"),
      frozenOutcome.cancelAtUnixSeconds
    );
    assert.match(stored.get("cancellationRequest.lastError"), /required refund/i);
  } finally {
    Date.now = realNow;
  }
});

test("convergence does not claim a later Stripe schedule applied an earlier request", async () => {
  const requestedAt = new Date("2026-08-17T10:00:00Z").getTime();
  const laterPolicyAt = new Date("2026-08-20T10:00:00Z").getTime();
  const requestedOutcome = resolveCancellationOutcome(requestedAt);
  const laterOutcome = resolveCancellationOutcome(laterPolicyAt);
  assert.ok(laterOutcome.cancelAtUnixSeconds > requestedOutcome.cancelAtUnixSeconds);
  await createMember("cancellater", {
    email: "cancellater@example.test",
    emailVerified: true,
  });
  await seedMembership("sub_cancel_later", {payerUid: "cancellater"});
  await db.collection("memberships").doc("sub_cancel_later").set({
    cancellationRequest: {
      id: "cancel_request_earlier_than_stripe",
      status: "pending",
      receivedAt: admin.firestore.Timestamp.fromMillis(requestedAt),
      outcome: requestedOutcome,
      attemptCount: 1,
      nextAttemptAt: admin.firestore.Timestamp.fromMillis(requestedAt + 600_000),
    },
  }, {merge: true});
  fakeStripe.setSubscription("sub_cancel_later", {
    status: "active",
    cancel_at: laterOutcome.cancelAtUnixSeconds,
  });

  await membershipTesting.convergeMembershipFromStripe(
    "sub_cancel_later",
    async () => undefined,
    {},
    laterPolicyAt
  );

  const stored = await db.collection("memberships").doc("sub_cancel_later").get();
  assert.equal(stored.get("cancellationRequest.status"), "pending");
  assert.equal(stored.get("cancellationOutcome"), null);
  assert.equal(stored.get("cancelAt"), laterOutcome.cancelAtUnixSeconds);
});

test("cancellation never lengthens an earlier Stripe end date", async () => {
  const lateReceipt = new Date("2026-08-20T10:00:00Z").getTime();
  const earlierOutcome = resolveCancellationOutcome(
    new Date("2026-08-17T10:00:00Z").getTime()
  );
  await createMember("cancelclamp", {
    email: "cancelclamp@example.test",
    emailVerified: true,
  });
  await seedMembership("sub_cancel_clamp", {payerUid: "cancelclamp"});
  fakeStripe.setSubscription("sub_cancel_clamp", {
    status: "active",
    cancel_at: earlierOutcome.cancelAtUnixSeconds,
  });

  const realNow = Date.now;
  Date.now = () => lateReceipt;
  try {
    const displayedOutcome = resolveCancellationOutcome(lateReceipt);
    const result = await requestMembershipCancellation(
      request({
        subscriptionId: "sub_cancel_clamp",
        expectedCancelAtUnixSeconds: displayedOutcome.cancelAtUnixSeconds,
      }, "cancelclamp")
    );
    assert.equal(result.outcome.cancelAtUnixSeconds, earlierOutcome.cancelAtUnixSeconds);
    assert.equal(
      fakeStripe.state.subscriptions.get("sub_cancel_clamp").cancel_at,
      earlierOutcome.cancelAtUnixSeconds
    );
  } finally {
    Date.now = realNow;
  }
});

test("an earlier mid-month Stripe end preserves a payment already crossed", async () => {
  const lateReceipt = new Date("2026-08-20T10:00:00Z").getTime();
  const midSeptemberEnd = Math.floor(
    new Date("2026-09-14T23:00:00Z").getTime() / 1000
  );
  await createMember("cancelmidmonth", {
    email: "cancelmidmonth@example.test",
    emailVerified: true,
  });
  await seedMembership("sub_cancel_midmonth", {payerUid: "cancelmidmonth"});
  fakeStripe.setSubscription("sub_cancel_midmonth", {
    status: "active",
    cancel_at: midSeptemberEnd,
  });

  const realNow = Date.now;
  Date.now = () => lateReceipt;
  try {
    const displayedOutcome = resolveCancellationOutcome(lateReceipt);
    const result = await requestMembershipCancellation(
      request({
        subscriptionId: "sub_cancel_midmonth",
        expectedCancelAtUnixSeconds: displayedOutcome.cancelAtUnixSeconds,
      }, "cancelmidmonth")
    );
    assert.equal(result.outcome.cancelAtUnixSeconds, midSeptemberEnd);
    assert.equal(result.outcome.finalPaymentDate, "2026-09-01");
    assert.equal(result.outcome.accessEndsOnDate, "2026-09-14");
  } finally {
    Date.now = realNow;
  }
});

test("cancellation rejects a preview that crossed the notice deadline", async () => {
  const displayedAt = new Date("2026-08-17T10:00:00Z").getTime();
  const submittedAt = new Date("2026-08-20T10:00:00Z").getTime();
  const displayedOutcome = resolveCancellationOutcome(displayedAt);
  const submittedOutcome = resolveCancellationOutcome(submittedAt);
  assert.notEqual(
    displayedOutcome.cancelAtUnixSeconds,
    submittedOutcome.cancelAtUnixSeconds
  );
  await createMember("stalepreview", {
    email: "stalepreview@example.test",
    emailVerified: true,
  });
  await seedMembership("sub_stale_preview", {payerUid: "stalepreview"});

  const realNow = Date.now;
  Date.now = () => submittedAt;
  try {
    await assert.rejects(
      () => requestMembershipCancellation(request({
        subscriptionId: "sub_stale_preview",
        expectedCancelAtUnixSeconds: displayedOutcome.cancelAtUnixSeconds,
      }, "stalepreview")),
      /dates have changed/i
    );
    const stored = await db.collection("memberships").doc("sub_stale_preview").get();
    assert.equal(stored.get("cancellationRequest"), undefined);
    assert.equal(stored.get("cancelAt"), null);
  } finally {
    Date.now = realNow;
  }
});

test("a payer can stop billing for a revoked but still-active subscription", async () => {
  await createMember("revokedpayer", {
    email: "revokedpayer@example.test",
    emailVerified: true,
  });
  await seedMembership("sub_revoked_cancel", {
    payerUid: "revokedpayer",
    state: "revoked",
    accessRevoked: true,
  });
  fakeStripe.setSubscription("sub_revoked_cancel", {status: "active"});
  const expected = resolveCancellationOutcome(Date.now());

  const result = await requestMembershipCancellation(request({
    subscriptionId: "sub_revoked_cancel",
    expectedCancelAtUnixSeconds: expected.cancelAtUnixSeconds,
  }, "revokedpayer"));

  assert.equal(result.outcome.cancelAtUnixSeconds, expected.cancelAtUnixSeconds);
  assert.equal(
    fakeStripe.state.subscriptions.get("sub_revoked_cancel").cancel_at,
    expected.cancelAtUnixSeconds
  );
});

test("only the payer can cancel a membership", async () => {
  await createMember("buyer", {email: "buyer@example.test", emailVerified: true});
  await createMember("someone", {email: "someone@example.test", emailVerified: true});
  await seedMembership("sub_guard", {payerUid: "buyer"});

  await assert.rejects(
    () => requestMembershipCancellation(request({
      subscriptionId: "sub_guard",
      expectedCancelAtUnixSeconds: resolveCancellationOutcome(Date.now()).cancelAtUnixSeconds,
    }, "someone")),
    (error) => {
      assert.match(error.message, /Only the payer/i);
      return true;
    }
  );
});

test("a member only sees their own memberships", async () => {
  await createMember("buyer", {email: "buyer@example.test", emailVerified: true});
  await createMember("other", {email: "other@example.test", emailVerified: true});
  await seedMembership("sub_mine", {payerUid: "buyer"});
  await seedMembership("sub_theirs", {payerUid: "other", participant: {
    fullName: "Other Person",
    dateOfBirth: "1991-01-01",
    age: 35,
    isPayer: true,
    participantKey: "key_other",
  }});

  const result = await getMyMemberships(request({}, "buyer"));
  assert.deepEqual(result.memberships.map((m) => m.subscriptionId), ["sub_mine"]);
  assert.ok(result.cancellationPreview.nextBillingDate);
});

test("a claim cannot give one account a second AlphaWOD membership", async () => {
  await createMember("buyer", {email: "buyer@example.test", emailVerified: true});
  await seedMembership("sub_first", {payerUid: "buyer", state: "active"});
  await seedMembership("sub_second", {participant: {
    fullName: "Buyer One",
    dateOfBirth: "1990-01-01",
    age: 36,
    isPayer: true,
    participantKey: "key_second",
  }});

  await assert.rejects(
    () => claimMembership(request({sessionId: "cs_sub_second"}, "buyer")),
    (error) => {
      assert.match(error.message, /already has an active or scheduled membership/i);
      return true;
    }
  );
});

test("a claim converges a stale terminal account membership before granting", async () => {
  await createMember("authoritativeclaim", {
    email: "buyer@example.test",
    emailVerified: true,
  });
  await seedMembership("sub_authoritative_claim_existing", {
    payerUid: "authoritativeclaim",
    entitlementTargetUid: "authoritativeclaim",
    state: "cancelled",
    stripeStatus: "canceled",
    participant: {
      fullName: "Existing Buyer",
      dateOfBirth: "1990-01-01",
      age: 36,
      isPayer: true,
      participantKey: "key_authoritative_claim_existing",
    },
  });
  await seedMembership("sub_authoritative_claim_new", {
    participant: {
      fullName: "Buyer One",
      dateOfBirth: "1990-01-01",
      age: 36,
      isPayer: true,
      participantKey: "key_authoritative_claim_new",
    },
  });

  await assert.rejects(
    () => claimMembership(request({
      sessionId: "cs_sub_authoritative_claim_new",
    }, "authoritativeclaim")),
    /already has an active or scheduled membership/i
  );

  assert.equal(
    (await db.collection("memberships")
      .doc("sub_authoritative_claim_existing").get()).get("state"),
    "active"
  );
  assert.equal(
    (await db.collection("memberships")
      .doc("sub_authoritative_claim_new").get()).get("payerUid"),
    null
  );
});

test("verified-email claim fails closed when Stripe state is unavailable", async () => {
  await createMember("uncertainemailclaim", {
    email: "buyer@example.test",
    emailVerified: true,
  });
  await seedMembership("sub_uncertain_email_claim");
  fakeStripe.state.subscriptions.delete("sub_uncertain_email_claim");

  await assert.rejects(
    () => claimMembership(request({}, "uncertainemailclaim")),
    (error) => {
      assert.equal(error.code, "unavailable");
      assert.match(error.message, /could not be verified with Stripe/i);
      return true;
    }
  );
  assert.equal(
    (await db.collection("memberships")
      .doc("sub_uncertain_email_claim").get()).get("payerUid"),
    null
  );
  assert.equal((await accessOf("uncertainemailclaim")).alphaWodAccess, false);
});

test("session claim does not grant when Stripe has already canceled", async () => {
  await createMember("canceledsessionclaim", {
    email: "buyer@example.test",
    emailVerified: false,
  });
  await seedMembership("sub_canceled_session_claim", {
    state: "active",
    stripeStatus: "active",
  });
  fakeStripe.setSubscription("sub_canceled_session_claim", {
    status: "canceled",
    ended_at: Math.floor(Date.now() / 1000),
    cancel_at: null,
  });

  const result = await claimMembership(request({
    sessionId: "cs_sub_canceled_session_claim",
  }, "canceledsessionclaim"));

  assert.deepEqual(result.claimed, ["sub_canceled_session_claim"]);
  assert.equal((await accessOf("canceledsessionclaim")).alphaWodAccess, false);
  const membership = await db.collection("memberships")
    .doc("sub_canceled_session_claim").get();
  assert.equal(membership.get("state"), "cancelled");
  assert.equal(membership.get("entitlementTargetUid"), null);
});

test("admin recovery expires only a verified open unpaid checkout and releases its locks", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  try {
    await createMember("checkoutreleaseadmin", {
      profile: {
        role: "admin",
        approvalStatus: "approved",
        entitlementStatus: "active",
        entitlementSource: "staff",
        alphaWodAccess: true,
      },
    });
    const checkout = await handler(request(
      validCheckoutData("attempt_staff_release_open_unpaid_123456")
    ));
    const intents = await db.collection("membershipIntents").get();
    assert.equal(intents.size, 1);
    const intent = intents.docs[0];
    const providerSession = fakeStripe.state.checkoutSessions.get(checkout.sessionId);
    providerSession.customer_details = {email: "Recovery.Buyer@Example.test"};
    fakeStripe.state.checkoutSessions.set(checkout.sessionId, providerSession);
    const checkoutSessionUrl = intent.get("checkoutSessionUrl");
    await intent.ref.update({
      createdAt: admin.firestore.Timestamp.fromMillis(
        Date.now() - 20 * 60 * 1000
      ),
    });

    await intent.ref.update({checkoutSessionUrl: admin.firestore.FieldValue.delete()});
    const withoutSessionUrl = await listMemberships(request(
      {},
      "checkoutreleaseadmin"
    ));
    assert.equal(withoutSessionUrl.checkoutIssues[0].canRelease, false);
    await intent.ref.update({checkoutSessionUrl});

    const beforeRelease = await listMemberships(request(
      {},
      "checkoutreleaseadmin"
    ));
    assert.equal(beforeRelease.checkoutIssues.length, 1);
    assert.equal(beforeRelease.checkoutIssues[0].intentId, intent.id);
    assert.deepEqual(
      beforeRelease.checkoutIssues[0].participantFullNames,
      ["Checkout Athlete"]
    );
    assert.equal(beforeRelease.checkoutIssues[0].canRelease, true);

    const result = await releaseAbandonedMembershipCheckout(request(
      {intentId: intent.id},
      "checkoutreleaseadmin"
    ));

    assert.equal(result.outcome, "released");
    assert.equal(result.recoveryEmailStatus, "queued");
    assert.equal(result.recoveryEmailRecipient, "r***@example.test");
    assert.equal("manualReviewReason" in result, false);
    assert.equal(
      fakeStripe.state.checkoutSessions.get(checkout.sessionId).status,
      "expired"
    );
    const released = await intent.ref.get();
    assert.equal(released.get("status"), "expired");
    assert.equal(released.get("manualRecoveryBy"), "checkoutreleaseadmin");
    assert.equal(
      released.get("manualRecoveryReason"),
      "staff_verified_open_unpaid"
    );
    const outboxId = checkoutRecoveryOutboxId(intent.id);
    const queuedOutbox = await db.collection("membershipEmailOutbox")
      .doc(outboxId).get();
    assert.equal(queuedOutbox.get("schemaVersion"), 1);
    assert.equal(queuedOutbox.get("kind"), "checkout_recovery");
    assert.equal(queuedOutbox.get("intentId"), intent.id);
    assert.equal(queuedOutbox.get("checkoutSessionId"), checkout.sessionId);
    assert.equal(queuedOutbox.get("providerSessionStatus"), "expired");
    assert.equal(queuedOutbox.get("providerPaymentStatus"), "unpaid");
    assert.equal(queuedOutbox.get("recipientSource"), "stripe_session_customer_details");
    assert.equal(queuedOutbox.get("payload").to[0], "recovery.buyer@example.test");
    assert.equal(
      queuedOutbox.get("idempotencyKey"),
      checkoutRecoveryIdempotencyKey(intent.id)
    );
    assert.match(queuedOutbox.get("payload.html"), /Restart my signup/);
    assert.match(queuedOutbox.get("payload.text"), /No payment was taken/);
    assert.equal(released.get("checkoutRecoveryEmailStatus"), "pending");
    assert.equal(released.get("checkoutRecoveryEmailOutboxId"), outboxId);
    assert.equal(released.get("checkoutRecoveryEmailRecipientMasked"), "r***@example.test");
    assert.equal((await db.collection("membershipCheckoutLocks").get()).size, 0);
    const audits = await db.collection("membershipAudit")
      .where("type", "==", "abandoned_checkout_released").get();
    assert.equal(audits.size, 1);
    assert.equal(audits.docs[0].get("releasedBy"), "checkoutreleaseadmin");

    const repeat = await releaseAbandonedMembershipCheckout(request(
      {intentId: intent.id},
      "checkoutreleaseadmin"
    ));
    assert.equal(repeat.outcome, "already_released");
    assert.equal(repeat.recoveryEmailStatus, "already_queued");
    assert.equal(repeat.recoveryEmailRecipient, "r***@example.test");
    assert.equal(
      (await db.collection("membershipEmailOutbox")
        .where("intentId", "==", intent.id).get()).size,
      1
    );
    assert.deepEqual(
      (await db.collection("membershipEmailOutbox").doc(outboxId).get())
        .get("payload"),
      queuedOutbox.get("payload")
    );

    const sends = [];
    const dispatchNow = queuedOutbox.get("nextAttemptAt").toMillis() + 1000;
    const workerStripeSecret = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    try {
      assert.equal(
        await membershipTesting.processMembershipConfirmationOutbox(
          outboxId,
          dispatchNow,
          async (payload, idempotencyKey) => {
            sends.push({payload, idempotencyKey});
            throw new Error(
              "provider response for recovery.buyer@example.test was lost"
            );
          }
        ),
        "failed"
      );
    } finally {
      if (workerStripeSecret === undefined) {
        delete process.env.STRIPE_SECRET_KEY;
      } else {
        process.env.STRIPE_SECRET_KEY = workerStripeSecret;
      }
    }
    const failedOutbox = await db.collection("membershipEmailOutbox")
      .doc(outboxId).get();
    assert.match(failedOutbox.get("lastError"), /\[redacted-email\]/);
    assert.doesNotMatch(failedOutbox.get("lastError"), /recovery\.buyer@example\.test/);
    assert.equal(
      await membershipTesting.processMembershipConfirmationOutbox(
        outboxId,
        dispatchNow + 6 * 60 * 1000,
        async (payload, idempotencyKey) => {
          sends.push({payload, idempotencyKey});
          return {providerMessageId: "recovery_email_1"};
        }
      ),
      "sent"
    );
    assert.equal(sends.length, 2);
    assert.deepEqual(sends[0], sends[1]);
    assert.equal(
      (await db.collection("membershipEmailOutbox").doc(outboxId).get())
        .get("providerMessageId"),
      "recovery_email_1"
    );
    const sentIntent = await intent.ref.get();
    assert.equal(sentIntent.get("checkoutRecoveryEmailStatus"), "sent");
    assert.equal(sentIntent.get("checkoutRecoveryEmailProviderId"), "recovery_email_1");
    assert.ok(sentIntent.get("checkoutRecoveryEmailSentAt"));
    assert.equal((await db.collection("memberships").get()).size, 0);
    const afterRelease = await listMemberships(request(
      {},
      "checkoutreleaseadmin"
    ));
    assert.equal(afterRelease.checkoutIssues.length, 0);
  } finally {
    Date.now = realNow;
  }
});

test("admin recovery resumes exactly once after an expiry webhook wins the finalize race", async () => {
  const createCheckout = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  try {
    await createMember("checkoutraceretryadmin", {
      profile: {
        role: "admin",
        approvalStatus: "approved",
        entitlementStatus: "active",
        entitlementSource: "staff",
        alphaWodAccess: true,
      },
    });
    const checkout = await createCheckout(request(
      validCheckoutData("attempt_staff_release_webhook_race_retry_123456")
    ));
    const intent = (await db.collection("membershipIntents").get()).docs[0];
    await intent.ref.update({
      createdAt: admin.firestore.Timestamp.fromMillis(
        Date.now() - 20 * 60 * 1000
      ),
    });
    const providerSession = fakeStripe.state.checkoutSessions.get(
      checkout.sessionId
    );
    providerSession.customer_details = {email: "race.retry@example.test"};
    fakeStripe.state.checkoutSessions.set(checkout.sessionId, providerSession);

    let interleavings = 0;
    const crashingRelease = membershipTesting.buildReleaseAbandonedCheckoutHandler(
      async () => undefined,
      async () => {
        interleavings += 1;
        const expiredSession = fakeStripe.state.checkoutSessions.get(
          checkout.sessionId
        );
        assert.equal(expiredSession.status, "expired");
        assert.equal(await membershipTesting.transitionCheckoutReservation(
          intent.ref,
          "expired",
          {
            endedByStripeEvent: "checkout.session.expired",
            endedAt: admin.firestore.Timestamp.now(),
          },
          true,
          {
            sessionId: expiredSession.id,
            mode: expiredSession.mode,
            planKey: expiredSession.metadata.planKey,
          }
        ), true);
        throw new Error("simulated function crash after Stripe expiry");
      }
    );

    await assert.rejects(
      () => crashingRelease(request(
        {intentId: intent.id},
        "checkoutraceretryadmin"
      )),
      /simulated function crash/
    );
    assert.equal(interleavings, 1);
    const interrupted = await intent.ref.get();
    assert.equal(interrupted.get("status"), "expired");
    assert.equal(
      interrupted.get("checkoutRecoveryReleaseClaimId"),
      checkoutRecoveryOutboxId(intent.id)
    );
    assert.equal(
      interrupted.get("checkoutRecoveryReleaseClaimedBy"),
      "checkoutraceretryadmin"
    );
    assert.equal((await db.collection("membershipCheckoutLocks").get()).size, 0);
    assert.equal((await db.collection("membershipEmailOutbox").get()).size, 0);
    assert.equal((await db.collection("membershipAudit")
      .where("type", "==", "abandoned_checkout_released").get()).size, 0);
    const resumableList = await listMemberships(request(
      {},
      "checkoutraceretryadmin"
    ));
    assert.equal(resumableList.checkoutIssues.length, 1);
    assert.equal(resumableList.checkoutIssues[0].intentId, intent.id);
    assert.equal(resumableList.checkoutIssues[0].status, "release_claimed");
    assert.equal(resumableList.checkoutIssues[0].canRelease, true);

    const resumed = await releaseAbandonedMembershipCheckout(request(
      {intentId: intent.id},
      "checkoutraceretryadmin"
    ));
    assert.equal(resumed.outcome, "released");
    assert.equal(resumed.recoveryEmailStatus, "queued");
    assert.equal(resumed.recoveryEmailRecipient, "r***@example.test");

    const replay = await releaseAbandonedMembershipCheckout(request(
      {intentId: intent.id},
      "checkoutraceretryadmin"
    ));
    assert.equal(replay.outcome, "already_released");
    assert.equal(replay.recoveryEmailStatus, "already_queued");
    const finalized = await intent.ref.get();
    assert.equal(finalized.get("manualRecoveryBy"), "checkoutraceretryadmin");
    assert.equal(
      finalized.get("checkoutRecoveryEmailOutboxId"),
      checkoutRecoveryOutboxId(intent.id)
    );
    assert.equal((await db.collection("membershipEmailOutbox")
      .where("intentId", "==", intent.id).get()).size, 1);
    assert.equal((await db.collection("membershipAudit")
      .where("type", "==", "abandoned_checkout_released").get()).size, 1);
  } finally {
    Date.now = realNow;
  }
});

test("admin recovery queues a provider-expired checkout from its exact Stripe Customer", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  try {
    await createMember("checkoutcustomerfallbackadmin", {
      profile: {
        role: "admin",
        approvalStatus: "approved",
        entitlementStatus: "active",
        entitlementSource: "staff",
        alphaWodAccess: true,
      },
    });
    const checkout = await handler(request(
      validCheckoutData("attempt_provider_expired_customer_fallback_123456")
    ));
    const intent = (await db.collection("membershipIntents").get()).docs[0];
    await intent.ref.update({
      createdAt: admin.firestore.Timestamp.fromMillis(
        Date.now() - 20 * 60 * 1000
      ),
    });
    fakeStripe.state.customers.set("cus_recovery_fallback", {
      id: "cus_recovery_fallback",
      object: "customer",
      livemode: false,
      email: "Provider.Customer@Example.test",
    });
    const session = fakeStripe.state.checkoutSessions.get(checkout.sessionId);
    session.status = "expired";
    session.payment_status = "unpaid";
    session.customer = "cus_recovery_fallback";
    delete session.customer_details;
    delete session.customer_email;
    fakeStripe.state.checkoutSessions.set(checkout.sessionId, session);

    const result = await releaseAbandonedMembershipCheckout(request(
      {intentId: intent.id},
      "checkoutcustomerfallbackadmin"
    ));

    assert.equal(result.outcome, "released");
    assert.equal(result.recoveryEmailStatus, "queued");
    assert.equal(result.recoveryEmailRecipient, "p***@example.test");
    const released = await intent.ref.get();
    assert.equal(
      released.get("manualRecoveryReason"),
      "staff_verified_provider_expired"
    );
    assert.equal(
      released.get("checkoutRecoveryEmailRecipientSource"),
      "stripe_customer"
    );
    const outbox = await db.collection("membershipEmailOutbox")
      .doc(checkoutRecoveryOutboxId(intent.id)).get();
    assert.equal(outbox.get("status"), "pending");
    assert.equal(outbox.get("recipientSource"), "stripe_customer");
    assert.equal(outbox.get("payload").to[0], "provider.customer@example.test");
    assert.equal(outbox.get("releaseReason"), "staff_verified_provider_expired");
    assert.equal((await db.collection("membershipCheckoutLocks").get()).size, 0);
  } finally {
    Date.now = realNow;
  }
});

test("admin recovery releases without an address into durable manual review", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  try {
    await createMember("checkoutmanualreviewadmin", {
      profile: {
        role: "admin",
        approvalStatus: "approved",
        entitlementStatus: "active",
        entitlementSource: "staff",
        alphaWodAccess: true,
      },
    });
    await handler(request(
      validCheckoutData("attempt_staff_release_no_email_123456")
    ));
    const intent = (await db.collection("membershipIntents").get()).docs[0];
    await intent.ref.update({
      createdAt: admin.firestore.Timestamp.fromMillis(
        Date.now() - 20 * 60 * 1000
      ),
    });

    const result = await releaseAbandonedMembershipCheckout(request(
      {intentId: intent.id},
      "checkoutmanualreviewadmin"
    ));

    assert.equal(result.outcome, "released");
    assert.equal(result.recoveryEmailStatus, "manual_review");
    assert.equal(result.recoveryEmailRecipient, null);
    const outboxId = checkoutRecoveryOutboxId(intent.id);
    const outbox = await db.collection("membershipEmailOutbox").doc(outboxId).get();
    assert.equal(outbox.get("kind"), "checkout_recovery");
    assert.equal(outbox.get("status"), "manual_review");
    assert.match(outbox.get("deadLetterReason"), /no verified recovery email/i);
    assert.equal(outbox.get("payload"), undefined);
    assert.equal(outbox.get("idempotencyKey"), undefined);
    assert.equal(outbox.get("nextAttemptAt"), undefined);
    const released = await intent.ref.get();
    assert.equal(released.get("status"), "expired");
    assert.equal(released.get("checkoutRecoveryEmailStatus"), "manual_review");
    assert.match(released.get("checkoutRecoveryEmailError"), /no verified recovery email/i);
    let sends = 0;
    assert.equal(
      await membershipTesting.processMembershipConfirmationOutbox(
        outboxId,
        Date.now() + 1000,
        async () => {
          sends += 1;
          return {providerMessageId: "must_not_send"};
        }
      ),
      "terminal"
    );
    assert.equal(sends, 0);
    assert.equal((await db.collection("membershipCheckoutLocks").get()).size, 0);
  } finally {
    Date.now = realNow;
  }
});

test("admin recovery quarantines a pre-existing deterministic outbox conflict", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  try {
    await createMember("checkoutconflictadmin", {
      profile: {
        role: "admin",
        approvalStatus: "approved",
        entitlementStatus: "active",
        entitlementSource: "staff",
        alphaWodAccess: true,
      },
    });
    const checkout = await handler(request(
      validCheckoutData("attempt_preexisting_recovery_outbox_123456")
    ));
    const intent = (await db.collection("membershipIntents").get()).docs[0];
    await intent.ref.update({
      createdAt: admin.firestore.Timestamp.fromMillis(
        Date.now() - 20 * 60 * 1000
      ),
    });
    const session = fakeStripe.state.checkoutSessions.get(checkout.sessionId);
    session.customer_details = {email: "conflict@example.test"};
    fakeStripe.state.checkoutSessions.set(checkout.sessionId, session);
    const outboxId = checkoutRecoveryOutboxId(intent.id);
    await db.collection("membershipEmailOutbox").doc(outboxId).set({
      kind: "checkout_recovery",
      intentId: intent.id,
      checkoutSessionId: checkout.sessionId,
      status: "pending",
      payload: {
        from: "Zero Alpha Fitness <support@example.test>",
        to: ["conflict@example.test"],
        reply_to: "support@example.test",
        subject: "Untrusted pre-existing row",
        text: "Untrusted",
        html: "<p>Untrusted</p>",
      },
      idempotencyKey: checkoutRecoveryIdempotencyKey(intent.id),
      nextAttemptAt: admin.firestore.Timestamp.fromMillis(Date.now() - 1000),
    });

    const result = await releaseAbandonedMembershipCheckout(request(
      {intentId: intent.id},
      "checkoutconflictadmin"
    ));
    assert.equal(result.outcome, "released");
    assert.equal(result.recoveryEmailStatus, "manual_review");
    assert.equal(result.recoveryEmailRecipient, "c***@example.test");
    assert.equal(
      (await intent.ref.get()).get("checkoutRecoveryEmailStatus"),
      "manual_review"
    );

    let sends = 0;
    assert.equal(
      await membershipTesting.processMembershipConfirmationOutbox(
        outboxId,
        Date.now() + 1000,
        async () => {
          sends += 1;
          return {providerMessageId: "must_not_send"};
        }
      ),
      "terminal"
    );
    assert.equal(sends, 0);
    const quarantined = await db.collection("membershipEmailOutbox")
      .doc(outboxId).get();
    assert.equal(quarantined.get("status"), "manual_review");
    assert.match(quarantined.get("deadLetterReason"), /release evidence is invalid/i);
  } finally {
    Date.now = realNow;
  }
});

test("admin recovery never retro-queues naturally terminal checkout intents", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  try {
    await createMember("checkoutterminaladmin", {
      profile: {
        role: "admin",
        approvalStatus: "approved",
        entitlementStatus: "active",
        entitlementSource: "staff",
        alphaWodAccess: true,
      },
    });
    const checkout = await handler(request(
      validCheckoutData("attempt_natural_terminal_no_retro_email_123456")
    ));
    const intent = (await db.collection("membershipIntents").get()).docs[0];
    const session = fakeStripe.state.checkoutSessions.get(checkout.sessionId);
    session.status = "expired";
    session.customer_details = {email: "natural@example.test"};
    fakeStripe.state.checkoutSessions.set(checkout.sessionId, session);
    assert.equal(await membershipTesting.transitionCheckoutReservation(
      intent.ref,
      "expired",
      {verifiedTerminalAt: admin.firestore.Timestamp.now()},
      true,
      {
        sessionId: session.id,
        mode: session.mode,
        planKey: session.metadata.planKey,
      }
    ), true);

    const result = await releaseAbandonedMembershipCheckout(request(
      {intentId: intent.id},
      "checkoutterminaladmin"
    ));

    assert.equal(result.outcome, "already_released");
    assert.equal(result.recoveryEmailStatus, "not_applicable");
    assert.equal(result.recoveryEmailRecipient, null);
    assert.equal(
      (await db.collection("membershipEmailOutbox")
        .where("intentId", "==", intent.id).get()).size,
      0
    );
    assert.equal(
      (await db.collection("membershipAudit")
        .where("type", "==", "abandoned_checkout_released").get()).size,
      0
    );
    await db.collection("membershipIntents").doc().set({
      status: "expired",
      createdAt: admin.firestore.Timestamp.now(),
      checkoutRecoveryReleaseClaimId: "legacy-noncanonical-claim",
    });
    const listWithLegacyIntent = await listMemberships(request(
      {},
      "checkoutterminaladmin"
    ));
    assert.equal(listWithLegacyIntent.checkoutIssues.length, 0);
  } finally {
    Date.now = realNow;
  }
});

test("admin recovery never queues an expired checkout with paid evidence", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  try {
    await createMember("checkoutpaidexpiredadmin", {
      profile: {
        role: "admin",
        approvalStatus: "approved",
        entitlementStatus: "active",
        entitlementSource: "staff",
        alphaWodAccess: true,
      },
    });
    const checkout = await handler(request(
      validCheckoutData("attempt_paid_expired_no_recovery_email_123456")
    ));
    const intent = (await db.collection("membershipIntents").get()).docs[0];
    await intent.ref.update({
      createdAt: admin.firestore.Timestamp.fromMillis(
        Date.now() - 20 * 60 * 1000
      ),
    });
    const session = fakeStripe.state.checkoutSessions.get(checkout.sessionId);
    session.status = "expired";
    session.payment_status = "paid";
    session.customer_details = {email: "paid@example.test"};
    fakeStripe.state.checkoutSessions.set(checkout.sessionId, session);

    await assert.rejects(
      () => releaseAbandonedMembershipCheckout(request(
        {intentId: intent.id},
        "checkoutpaidexpiredadmin"
      )),
      (error) => {
        assert.equal(error.code, "failed-precondition");
        assert.equal(error.details?.reason, "checkout_processing");
        return true;
      }
    );
    assert.equal((await intent.ref.get()).get("status"), "created");
    assert.equal(
      (await db.collection("membershipEmailOutbox")
        .where("intentId", "==", intent.id).get()).size,
      0
    );
    assert.ok((await db.collection("membershipCheckoutLocks").get()).size > 0);
  } finally {
    Date.now = realNow;
  }
});

test("admin recovery keeps a completed checkout locked for fulfilment", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  try {
    await createMember("checkoutprocessingadmin", {
      profile: {
        role: "admin",
        approvalStatus: "approved",
        entitlementStatus: "active",
        entitlementSource: "staff",
        alphaWodAccess: true,
      },
    });
    const checkout = await handler(request(
      validCheckoutData("attempt_staff_release_complete_123456")
    ));
    const intents = await db.collection("membershipIntents").get();
    const intent = intents.docs[0];
    await intent.ref.update({
      createdAt: admin.firestore.Timestamp.fromMillis(
        Date.now() - 20 * 60 * 1000
      ),
    });
    const session = fakeStripe.state.checkoutSessions.get(checkout.sessionId);
    session.status = "complete";
    session.payment_status = "no_payment_required";
    fakeStripe.state.checkoutSessions.set(checkout.sessionId, session);

    await assert.rejects(
      () => releaseAbandonedMembershipCheckout(request(
        {intentId: intent.id},
        "checkoutprocessingadmin"
      )),
      (error) => {
        assert.equal(error.code, "failed-precondition");
        assert.equal(error.details?.reason, "checkout_processing");
        return true;
      }
    );
    assert.equal((await intent.ref.get()).get("status"), "payment_pending");
    assert.ok((await db.collection("membershipCheckoutLocks").get()).size > 0);
    assert.equal(
      fakeStripe.state.checkoutSessions.get(checkout.sessionId).status,
      "complete"
    );
    assert.equal(
      (await db.collection("membershipEmailOutbox")
        .where("intentId", "==", intent.id).get()).size,
      0
    );
  } finally {
    Date.now = realNow;
  }
});

test("admin recovery cannot release a checkout during its ten-minute safety window", async () => {
  const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
    () => undefined
  );
  const realNow = Date.now;
  Date.now = () => new Date("2026-08-18T10:00:00Z").getTime();
  try {
    await createMember("checkoutrecentadmin", {
      profile: {
        role: "admin",
        approvalStatus: "approved",
        entitlementStatus: "active",
        entitlementSource: "staff",
        alphaWodAccess: true,
      },
    });
    const checkout = await handler(request(
      validCheckoutData("attempt_staff_release_recent_123456")
    ));
    const intent = (await db.collection("membershipIntents").get()).docs[0];
    await intent.ref.update({
      createdAt: admin.firestore.Timestamp.fromMillis(
        Date.now() - 5 * 60 * 1000
      ),
    });

    await assert.rejects(
      () => releaseAbandonedMembershipCheckout(request(
        {intentId: intent.id},
        "checkoutrecentadmin"
      )),
      (error) => {
        assert.equal(error.code, "failed-precondition");
        assert.equal(error.details?.reason, "checkout_still_recent");
        return true;
      }
    );
    assert.equal((await intent.ref.get()).get("status"), "created");
    assert.equal(
      (await db.collection("membershipEmailOutbox")
        .where("intentId", "==", intent.id).get()).size,
      0
    );
    assert.ok((await db.collection("membershipCheckoutLocks").get()).size > 0);
    assert.equal(
      fakeStripe.state.checkoutSessions.get(checkout.sessionId).status,
      "open"
    );
  } finally {
    Date.now = realNow;
  }
});

test("admin participant linking grants and converges access immediately", async () => {
  await createMember("admin", {
    profile: {
      role: "admin",
      approvalStatus: "approved",
      entitlementStatus: "active",
      entitlementSource: "staff",
      alphaWodAccess: true,
    },
  });
  await createMember("participant", {email: "participant@example.test"});
  await seedMembership("sub_admin_link", {
    payerUid: "buyer",
    participant: {
      fullName: "Participant Person",
      dateOfBirth: "1990-01-01",
      age: 36,
      isPayer: false,
      participantKey: "key_admin_link",
    },
  });

  await linkMembershipParticipant(
    request({subscriptionId: "sub_admin_link", participantUid: "participant"}, "admin")
  );

  assert.deepEqual(await accessOf("participant"), {
    approvalStatus: "approved",
    entitlementStatus: "active",
    entitlementSource: "stripe",
    alphaWodAccess: true,
  });
  const membership = await db.collection("memberships").doc("sub_admin_link").get();
  assert.equal(membership.get("entitlementTargetUid"), "participant");

  const linkedAt = membership.get("entitlementTargetLinkedAt").toMillis();
  const auditsBefore = await db.collection("membershipAudit")
    .where("type", "==", "membership_participant_linked").get();
  const repeat = await linkMembershipParticipant(
    request({subscriptionId: "sub_admin_link", participantUid: "participant"}, "admin")
  );
  const afterRepeat = await db.collection("memberships").doc("sub_admin_link").get();
  const auditsAfter = await db.collection("membershipAudit")
    .where("type", "==", "membership_participant_linked").get();
  assert.equal(repeat.alreadyLinked, true);
  assert.equal(afterRepeat.get("entitlementTargetLinkedAt").toMillis(), linkedAt);
  assert.equal(auditsAfter.size, auditsBefore.size);
});

test("admin link callable repairs a self-payer projection on the same target", async () => {
  await createMember("repairadmin", {
    profile: {
      role: "admin",
      approvalStatus: "approved",
      entitlementStatus: "active",
      entitlementSource: "staff",
      alphaWodAccess: true,
    },
  });
  await createMember("repairtarget", {email: "repairtarget@example.test"});
  await seedMembership("sub_self_projection_repair", {
    payerUid: "repairtarget",
    payerEmail: "repairtarget@example.test",
    entitlementTargetUid: "repairtarget",
    entitlementProjectionStatus: "manual_review",
    entitlementProjectionError: "Interrupted before access projection.",
  });

  const result = await linkMembershipParticipant(request({
    subscriptionId: "sub_self_projection_repair",
    participantUid: "repairtarget",
  }, "repairadmin"));

  assert.equal(result.alreadyLinked, true);
  assert.equal(result.repaired, true);
  assert.deepEqual(await accessOf("repairtarget"), {
    approvalStatus: "approved",
    entitlementStatus: "active",
    entitlementSource: "stripe",
    alphaWodAccess: true,
  });
  const membership = await db.collection("memberships")
    .doc("sub_self_projection_repair").get();
  assert.equal(membership.get("entitlementTargetUid"), "repairtarget");
  assert.equal(membership.get("entitlementProjectionStatus"), "applied");
  assert.equal(membership.get("entitlementProjectionError"), undefined);
  const audits = await db.collection("membershipAudit")
    .where("type", "==", "membership_entitlement_projection_repair").get();
  assert.equal(audits.size, 1);
  assert.equal(audits.docs[0].get("subscriptionId"), "sub_self_projection_repair");
  assert.equal(audits.docs[0].get("repairedBy"), "repairadmin");
  assert.equal(audits.docs[0].get("priorProjectionStatus"), "manual_review");
  assert.equal(
    audits.docs[0].get("priorProjectionError"),
    "Interrupted before access projection."
  );
});

test("admin participant link rechecks the candidate and fails closed on uncertainty", async () => {
  await createMember("boundaryadmin", {
    profile: {
      role: "admin",
      approvalStatus: "approved",
      entitlementStatus: "active",
      entitlementSource: "staff",
      alphaWodAccess: true,
    },
  });
  await createMember("boundarytarget", {email: "boundarytarget@example.test"});
  await seedMembership("sub_admin_provider_canceled", {
    payerUid: "different-payer",
    participant: {
      fullName: "Delegated Participant",
      dateOfBirth: "1990-01-01",
      age: 36,
      isPayer: false,
      participantKey: "key_admin_provider_canceled",
    },
  });
  fakeStripe.setSubscription("sub_admin_provider_canceled", {
    status: "canceled",
    ended_at: Math.floor(Date.now() / 1000),
    cancel_at: null,
  });

  await assert.rejects(
    () => linkMembershipParticipant(request({
      subscriptionId: "sub_admin_provider_canceled",
      participantUid: "boundarytarget",
    }, "boundaryadmin")),
    /no longer eligible/i
  );
  assert.equal(
    (await db.collection("memberships")
      .doc("sub_admin_provider_canceled").get()).get("state"),
    "cancelled"
  );
  assert.equal((await accessOf("boundarytarget")).alphaWodAccess, false);

  await seedMembership("sub_admin_provider_uncertain", {
    payerUid: "different-payer",
    participant: {
      fullName: "Another Delegated Participant",
      dateOfBirth: "1991-01-01",
      age: 35,
      isPayer: false,
      participantKey: "key_admin_provider_uncertain",
    },
  });
  fakeStripe.state.subscriptions.delete("sub_admin_provider_uncertain");
  await assert.rejects(
    () => linkMembershipParticipant(request({
      subscriptionId: "sub_admin_provider_uncertain",
      participantUid: "boundarytarget",
    }, "boundaryadmin")),
    (error) => {
      assert.equal(error.code, "unavailable");
      return true;
    }
  );
  assert.equal(
    (await db.collection("memberships")
      .doc("sub_admin_provider_uncertain").get()).get("entitlementTargetUid"),
    null
  );
  assert.equal((await accessOf("boundarytarget")).alphaWodAccess, false);
});

test("admin linking refuses a membership bought by its participant", async () => {
  await createMember("selflinkadmin", {
    profile: {
      role: "admin",
      approvalStatus: "approved",
      entitlementStatus: "active",
      entitlementSource: "staff",
      alphaWodAccess: true,
    },
  });
  await createMember("selflinktarget");
  await seedMembership("sub_self_link");

  await assert.rejects(
    () => linkMembershipParticipant(request({
      subscriptionId: "sub_self_link",
      participantUid: "selflinktarget",
    }, "selflinkadmin")),
    /must be claimed by its payer/i
  );
  assert.equal(
    (await db.collection("memberships").doc("sub_self_link").get())
      .get("entitlementTargetUid"),
    null
  );
});

test("concurrent admin links have one winner and existing links cannot transfer", async () => {
  await createMember("linkadmin", {
    profile: {
      role: "admin",
      approvalStatus: "approved",
      entitlementStatus: "active",
      entitlementSource: "staff",
      alphaWodAccess: true,
    },
  });
  await createMember("linktarget", {email: "linktarget@example.test"});
  await createMember("othertarget", {email: "othertarget@example.test"});
  await seedMembership("sub_link_race_one", {
    payerUid: "payer_one",
    participant: {
      fullName: "First Participant",
      dateOfBirth: "1990-01-01",
      age: 36,
      isPayer: false,
      participantKey: "key_link_race_one",
    },
  });
  await seedMembership("sub_link_race_two", {
    payerUid: "payer_two",
    participant: {
      fullName: "Second Participant",
      dateOfBirth: "1991-01-01",
      age: 35,
      isPayer: false,
      participantKey: "key_link_race_two",
    },
  });

  const links = await Promise.allSettled([
    linkMembershipParticipant(request({
      subscriptionId: "sub_link_race_one",
      participantUid: "linktarget",
    }, "linkadmin")),
    linkMembershipParticipant(request({
      subscriptionId: "sub_link_race_two",
      participantUid: "linktarget",
    }, "linkadmin")),
  ]);
  assert.equal(links.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(links.filter((result) => result.status === "rejected").length, 1);

  const linked = await db.collection("memberships")
    .where("entitlementTargetUid", "==", "linktarget")
    .get();
  assert.equal(linked.size, 1);
  const winningSubscriptionId = linked.docs[0].id;
  assert.deepEqual(await accessOf("linktarget"), {
    approvalStatus: "approved",
    entitlementStatus: "active",
    entitlementSource: "stripe",
    alphaWodAccess: true,
  });

  await assert.rejects(
    () => linkMembershipParticipant(request({
      subscriptionId: winningSubscriptionId,
      participantUid: "othertarget",
    }, "linkadmin")),
    /already linked|review a transfer/i
  );
  assert.equal(
    (await db.collection("memberships").doc(winningSubscriptionId).get())
      .get("entitlementTargetUid"),
    "linktarget"
  );
  assert.equal((await accessOf("othertarget")).alphaWodAccess, false);
});

test("a stable checkout attempt is idempotent and fingerprint-bound", async () => {
  const intentRef = db.collection("membershipIntents").doc("attempt_stable");
  const intent = reservationIntent("stable", {
    participantKey: "stable_participant",
    requestFingerprint: "same_request",
  });

  const first = await membershipTesting.reserveCheckoutAttempt(intentRef, intent, Date.now());
  const retry = await membershipTesting.reserveCheckoutAttempt(intentRef, intent, Date.now());
  assert.equal(first.created, true);
  assert.equal(retry.created, false);

  await assert.rejects(
    () => membershipTesting.reserveCheckoutAttempt(
      intentRef,
      {...intent, requestFingerprint: "changed_request"},
      Date.now()
    ),
    /different membership details/i
  );
});

test("checkout transaction refuses an unconverged membership discovered after preflight", async () => {
  const intentRef = db.collection("membershipIntents").doc("attempt_new_membership_race");
  const intent = reservationIntent("new_membership_race", {
    participantKey: "participant_new_membership_race",
  });
  await seedMembership("sub_new_membership_race", {
    state: "cancelled",
    stripeStatus: "canceled",
    participant: {
      fullName: "Concurrent Member",
      dateOfBirth: "1990-01-01",
      age: 36,
      isPayer: true,
      participantKey: intent.participant.participantKey,
    },
  });

  await assert.rejects(
    () => membershipTesting.reserveCheckoutAttempt(
      intentRef,
      intent,
      Date.now(),
      new Set()
    ),
    (error) => {
      assert.equal(error.code, "unavailable");
      assert.equal(error.details?.reason, "membership_state_changed");
      return true;
    }
  );
  assert.equal((await intentRef.get()).exists, false);
  assert.equal((await db.collection("membershipCheckoutLocks").get()).size, 0);
});

test("participant checkout reservations close the concurrent duplicate race", async () => {
  const now = Date.now();
  const firstRef = db.collection("membershipIntents").doc("attempt_participant_one");
  const secondRef = db.collection("membershipIntents").doc("attempt_participant_two");
  const first = reservationIntent("participant_one", {participantKey: "same_identity"});
  const second = reservationIntent("participant_two", {participantKey: "same_identity"});

  const results = await Promise.allSettled([
    membershipTesting.reserveCheckoutAttempt(firstRef, first, now),
    membershipTesting.reserveCheckoutAttempt(secondRef, second, now),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
});

test("signed-in AlphaWOD payer reservations block different participants atomically", async () => {
  const now = Date.now();
  const firstRef = db.collection("membershipIntents").doc("attempt_payer_one");
  const secondRef = db.collection("membershipIntents").doc("attempt_payer_two");
  const first = reservationIntent("payer_one", {
    payerUid: "same_payer",
    participantKey: "participant_one",
  });
  const second = reservationIntent("payer_two", {
    payerUid: "same_payer",
    participantKey: "participant_two",
  });

  const results = await Promise.allSettled([
    membershipTesting.reserveCheckoutAttempt(firstRef, first, now),
    membershipTesting.reserveCheckoutAttempt(secondRef, second, now),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
});

test("an expired checkout reservation can be safely replaced", async () => {
  const now = Date.now();
  const expiredRef = db.collection("membershipIntents").doc("attempt_expired_lock");
  const replacementRef = db.collection("membershipIntents").doc("attempt_replacement");
  const expired = reservationIntent("expired_lock", {
    participantKey: "reusable_identity",
    reservationExpiresAt: admin.firestore.Timestamp.fromMillis(now - 1000),
  });
  const replacement = reservationIntent("replacement", {
    participantKey: "reusable_identity",
  });

  await membershipTesting.reserveCheckoutAttempt(expiredRef, expired, now - 2000);
  await membershipTesting.transitionCheckoutReservation(expiredRef, "expired");
  const result = await membershipTesting.reserveCheckoutAttempt(
    replacementRef,
    replacement,
    now
  );
  assert.equal(result.created, true);
  const [lockId] = replacement.reservationLockIds;
  const lock = await db.collection("membershipCheckoutLocks").doc(lockId).get();
  assert.equal(lock.get("intentId"), replacementRef.id);
});

test("an elapsed checkout lock is not reusable without terminal Stripe state", async () => {
  const now = Date.now();
  const oldRef = db.collection("membershipIntents").doc("attempt_elapsed_only");
  const replacementRef = db.collection("membershipIntents").doc("attempt_elapsed_replacement");
  const oldIntent = reservationIntent("elapsed_only", {
    participantKey: "elapsed_identity",
    reservationExpiresAt: admin.firestore.Timestamp.fromMillis(now - 1000),
  });
  const replacement = reservationIntent("elapsed_replacement", {
    participantKey: "elapsed_identity",
  });
  await membershipTesting.reserveCheckoutAttempt(oldRef, oldIntent, now - 2000);

  await assert.rejects(
    () => membershipTesting.reserveCheckoutAttempt(replacementRef, replacement, now),
    (error) => {
      assert.equal(error.code, "already-exists");
      assert.equal(error.details?.reason, "checkout_in_progress");
      assert.match(error.message, /checkout or membership setup is already in progress/i);
      return true;
    }
  );
});

test("revoked access still blocks a replacement while Stripe billing is active", async () => {
  await seedMembership("sub_revoked_still_billing", {
    state: "revoked",
    stripeStatus: "active",
    accessRevoked: true,
    participant: {
      fullName: "Still Billed Athlete",
      dateOfBirth: "1990-01-01",
      age: 36,
      isPayer: true,
      participantKey: "revoked_still_billing_identity",
    },
  });
  const blockedRef = db.collection("membershipIntents")
    .doc("attempt_replacement_while_billing");
  const blockedIntent = reservationIntent("replacement_while_billing", {
    participantKey: "revoked_still_billing_identity",
  });

  await assert.rejects(
    () => membershipTesting.reserveCheckoutAttempt(
      blockedRef,
      blockedIntent,
      Date.now()
    ),
    (error) => {
      assert.equal(error.code, "already-exists");
      assert.equal(error.details?.reason, "checkout_in_progress");
      assert.match(
        error.message,
        /checkout or membership setup is already in progress/i
      );
      return true;
    }
  );

  await db.collection("memberships").doc("sub_revoked_still_billing").set({
    stripeStatus: "canceled",
  }, {merge: true});
  const replacementRef = db.collection("membershipIntents")
    .doc("attempt_replacement_after_billing_ended");
  const replacement = reservationIntent("replacement_after_billing_ended", {
    participantKey: "revoked_still_billing_identity",
  });
  const result = await membershipTesting.reserveCheckoutAttempt(
    replacementRef,
    replacement,
    Date.now()
  );
  assert.equal(result.created, true);
});

test("a terminal Checkout event cannot release a different Session's locks", async () => {
  const intentRef = db.collection("membershipIntents")
    .doc("attempt_terminal_session_binding");
  const intent = reservationIntent("terminal_session_binding", {
    participantKey: "terminal_session_identity",
  });
  await membershipTesting.reserveCheckoutAttempt(intentRef, intent, Date.now());
  await membershipTesting.transitionCheckoutReservation(
    intentRef,
    "created",
    {checkoutSessionId: "cs_expected_terminal"},
    false
  );

  const terminalEvent = (sessionId) => ({
    id: `evt_expired_${sessionId}`,
    type: "checkout.session.expired",
    created: Math.floor(Date.now() / 1000),
    data: {object: {
      id: sessionId,
      object: "checkout.session",
      livemode: false,
      mode: "subscription",
      metadata: {
        intentId: intentRef.id,
        planKey: "adult_unlimited",
      },
    }},
  });

  await assert.rejects(
    () => handleStripeEvent(
      terminalEvent("cs_wrong_terminal"),
      async () => undefined
    ),
    /does not match membership intent/i
  );
  assert.equal((await intentRef.get()).get("status"), "created");
  assert.equal((await db.collection("membershipCheckoutLocks").get()).size, 1);

  await handleStripeEvent(
    terminalEvent("cs_expected_terminal"),
    async () => undefined
  );
  assert.equal((await intentRef.get()).get("status"), "expired");
  assert.equal((await db.collection("membershipCheckoutLocks").get()).size, 0);
});

test("closed disputes stay closed out of order and revocation stays sticky", async () => {
  await createMember("disputebuyer", {
    profile: {
      role: "user",
      approvalStatus: "approved",
      entitlementStatus: "active",
      entitlementSource: "stripe",
      alphaWodAccess: true,
    },
  });
  await seedMembership("sub_dispute_order", {
    payerUid: "disputebuyer",
    entitlementTargetUid: "disputebuyer",
  });
  fakeStripe.linkChargeToSubscription({
    chargeId: "ch_dispute_order",
    paymentIntentId: "pi_dispute_order",
    invoiceId: "in_dispute_order",
    subscriptionId: "sub_dispute_order",
  });
  fakeStripe.setDispute("dp_dispute_order", {
    status: "needs_response",
    charge: "ch_dispute_order",
  });
  const eventCreated = Math.floor(Date.now() / 1000);

  await handleStripeEvent({
    id: "evt_dispute_open",
    type: "charge.dispute.created",
    created: eventCreated,
    data: {object: {
      id: "dp_dispute_order",
      object: "dispute",
      status: "needs_response",
      charge: "ch_dispute_order",
    }},
  }, async () => undefined);
  let membership = await db.collection("memberships").doc("sub_dispute_order").get();
  assert.equal(membership.get("state"), "disputed");
  assert.equal(membership.get("disputeOpen"), true);
  assert.deepEqual(membership.get("openDisputeIds"), ["dp_dispute_order"]);

  fakeStripe.setDispute("dp_dispute_order", {
    status: "won",
    charge: "ch_dispute_order",
  });
  await handleStripeEvent({
    id: "evt_dispute_closed",
    type: "charge.dispute.closed",
    created: eventCreated + 1,
    data: {object: {
      id: "dp_dispute_order",
      object: "dispute",
      status: "won",
      charge: "ch_dispute_order",
    }},
  }, async () => undefined);

  // Delivering the old `created` snapshot after closure must use Stripe's
  // current won state, rather than reopening access from the event payload.
  await handleStripeEvent({
    id: "evt_dispute_created_late",
    type: "charge.dispute.created",
    created: eventCreated,
    data: {object: {
      id: "dp_dispute_order",
      object: "dispute",
      status: "needs_response",
      charge: "ch_dispute_order",
    }},
  }, async () => undefined);
  membership = await db.collection("memberships").doc("sub_dispute_order").get();
  assert.equal(membership.get("state"), "active");
  assert.equal(membership.get("disputeOpen"), false);
  assert.deepEqual(membership.get("openDisputeIds"), []);
  assert.equal((await accessOf("disputebuyer")).alphaWodAccess, true);

  const refundedCharge = fakeStripe.state.charges.get("ch_dispute_order");
  refundedCharge.amount_refunded = refundedCharge.amount;
  await handleStripeEvent({
    id: "evt_refund_sticky",
    type: "charge.refunded",
    created: eventCreated + 2,
    data: {object: {...refundedCharge}},
  }, async () => undefined);
  await handleStripeEvent({
    id: "evt_active_after_refund",
    type: "customer.subscription.updated",
    created: eventCreated + 3,
    data: {object: fakeStripe.state.subscriptions.get("sub_dispute_order")},
  }, async () => undefined);

  membership = await db.collection("memberships").doc("sub_dispute_order").get();
  assert.equal(membership.get("accessRevoked"), true);
  assert.equal(membership.get("state"), "revoked");
  assert.equal((await accessOf("disputebuyer")).alphaWodAccess, false);
});

test("subscription contract drift fails access closed and becomes visible", async () => {
  await createMember("contractdrift", {
    email: "buyer@example.test",
    emailVerified: true,
  });
  await seedMembership("sub_contract_drift", {
    payerUid: "contractdrift",
    entitlementTargetUid: "contractdrift",
  });
  await claimMembership(request({sessionId: "cs_sub_contract_drift"}, "contractdrift"));
  assert.equal((await accessOf("contractdrift")).alphaWodAccess, true);

  const subscription = fakeStripe.state.subscriptions.get("sub_contract_drift");
  subscription.items.data[0].quantity = 2;
  fakeStripe.state.subscriptions.set(subscription.id, subscription);

  await handleStripeEvent({
    id: "evt_contract_quantity_drift",
    type: "customer.subscription.updated",
    created: Math.floor(Date.now() / 1000),
    data: {object: subscription},
  }, async () => undefined);

  const membership = await db.collection("memberships")
    .doc("sub_contract_drift").get();
  assert.equal(membership.get("state"), "active");
  assert.equal(membership.get("accessRevoked"), false);
  assert.equal(membership.get("providerContractStatus"), "manual_review");
  assert.match(membership.get("providerContractError"), /quantity 1/i);
  assert.equal((await accessOf("contractdrift")).alphaWodAccess, false);

  subscription.items.data[0].quantity = 1;
  fakeStripe.state.subscriptions.set(subscription.id, subscription);
  await membershipTesting.convergeMembershipFromStripe(
    "sub_contract_drift",
    async () => undefined
  );
  const repaired = await db.collection("memberships")
    .doc("sub_contract_drift").get();
  assert.equal(repaired.get("providerContractStatus"), "verified");
  assert.equal(repaired.get("providerContractError"), undefined);
  assert.equal((await accessOf("contractdrift")).alphaWodAccess, true);
});

test("paused collection, manual invoicing, and trials fail access closed and heal", async () => {
  await createMember("billingmodedrift", {
    email: "buyer@example.test",
    emailVerified: true,
  });
  await seedMembership("sub_billing_mode_drift", {
    payerUid: "billingmodedrift",
    entitlementTargetUid: "billingmodedrift",
  });
  await claimMembership(request({sessionId: "cs_sub_billing_mode_drift"}, "billingmodedrift"));
  assert.equal((await accessOf("billingmodedrift")).alphaWodAccess, true);

  const subscription = fakeStripe.state.subscriptions.get("sub_billing_mode_drift");
  const forbiddenMutations = [
    {
      apply: () => {
        subscription.pause_collection = {behavior: "void", resumes_at: null};
      },
      repair: () => {
        subscription.pause_collection = null;
      },
      error: /collection paused/i,
    },
    {
      apply: () => {
        subscription.collection_method = "send_invoice";
      },
      repair: () => {
        subscription.collection_method = "charge_automatically";
      },
      error: /not collected automatically/i,
    },
    {
      apply: () => {
        subscription.status = "trialing";
        subscription.trial_start = Math.floor(Date.now() / 1000);
        subscription.trial_end = subscription.trial_start + 7 * 24 * 60 * 60;
      },
      repair: () => {
        subscription.status = "active";
        subscription.trial_start = null;
        subscription.trial_end = null;
      },
      error: /unapproved trial/i,
    },
  ];

  for (const mutation of forbiddenMutations) {
    mutation.apply();
    fakeStripe.state.subscriptions.set(subscription.id, subscription);
    await membershipTesting.convergeMembershipFromStripe(
      subscription.id,
      async () => undefined
    );
    const restricted = await db.collection("memberships").doc(subscription.id).get();
    assert.equal(restricted.get("providerContractStatus"), "manual_review");
    assert.match(restricted.get("providerContractError"), mutation.error);
    assert.equal((await accessOf("billingmodedrift")).alphaWodAccess, false);

    mutation.repair();
    fakeStripe.state.subscriptions.set(subscription.id, subscription);
    await membershipTesting.convergeMembershipFromStripe(
      subscription.id,
      async () => undefined
    );
    const repaired = await db.collection("memberships").doc(subscription.id).get();
    assert.equal(repaired.get("providerContractStatus"), "verified");
    assert.equal(repaired.get("providerContractError"), undefined);
    assert.equal((await accessOf("billingmodedrift")).alphaWodAccess, true);
  }
});

test("automatic-payment grace starts at the failure event, not invoice creation", async () => {
  const failedAt = Math.floor(Date.now() / 1000);
  await seedMembership("sub_payment_failure_time");
  fakeStripe.setSubscription("sub_payment_failure_time", {status: "past_due"});

  await handleStripeEvent({
    id: "evt_payment_failure_time",
    type: "invoice.payment_failed",
    created: failedAt,
    data: {object: {
      id: "in_payment_failure_time",
      object: "invoice",
      collection_method: "charge_automatically",
      due_date: null,
      created: failedAt - 3 * 24 * 60 * 60,
      parent: {
        type: "subscription_details",
        subscription_details: {subscription: "sub_payment_failure_time"},
      },
      lines: {object: "list", data: []},
    }},
  }, async () => undefined);

  const membership = await db.collection("memberships")
    .doc("sub_payment_failure_time").get();
  assert.equal(membership.get("pastDueSince"), failedAt);
  assert.equal(membership.get("state"), "past_due_grace");
});

test("an app-owned failed invoice emits one PII-safe business-owner alert signal", async () => {
  const failedAt = Math.floor(Date.now() / 1000);
  await seedMembership("sub_payment_failed_alert");
  fakeStripe.setSubscription("sub_payment_failed_alert", {status: "past_due"});
  fakeStripe.setSubscription("sub_unowned_payment_failed_alert", {
    status: "past_due",
    metadata: {},
  });
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);

  try {
    await handleStripeEvent({
      id: "evt_payment_failed_alert",
      type: "invoice.payment_failed",
      created: failedAt,
      data: {object: {
        id: "in_payment_failed_alert",
        object: "invoice",
        collection_method: "charge_automatically",
        customer: "cus_payment_failed_private",
        customer_email: "private-buyer@example.test",
        customer_name: "Private Buyer",
        due_date: null,
        parent: {
          type: "subscription_details",
          subscription_details: {subscription: "sub_payment_failed_alert"},
        },
        lines: {object: "list", data: []},
      }},
    }, async () => undefined);
    await handleStripeEvent({
      id: "evt_unowned_payment_failed_alert",
      type: "invoice.payment_failed",
      created: failedAt,
      data: {object: {
        id: "in_unowned_payment_failed_alert",
        object: "invoice",
        collection_method: "charge_automatically",
        due_date: null,
        parent: {
          type: "subscription_details",
          subscription_details: {subscription: "sub_unowned_payment_failed_alert"},
        },
        lines: {object: "list", data: []},
      }},
    }, async () => undefined);
  } finally {
    console.warn = originalWarn;
  }

  const paymentWarnings = warnings.filter(([marker]) =>
    marker === "BILLING_PAYMENT_FAILED"
  );
  assert.deepEqual(paymentWarnings, [[
    "BILLING_PAYMENT_FAILED",
    {
      stripeEventId: "evt_payment_failed_alert",
      stripeInvoiceId: "in_payment_failed_alert",
      stripeSubscriptionId: "sub_payment_failed_alert",
      stripeEventCreated: failedAt,
    },
  ]]);
  assert.doesNotMatch(
    JSON.stringify(paymentWarnings),
    /private-buyer@example\.test|Private Buyer|cus_payment_failed_private/
  );
});

test("a customer fallback never applies an old charge to a replacement", async () => {
  await seedMembership("sub_customer_old", {
    stripeCustomerId: "cus_shared_history",
    state: "cancelled",
    stripeStatus: "canceled",
  });
  await seedMembership("sub_customer_replacement", {
    stripeCustomerId: "cus_shared_history",
    state: "active",
    stripeStatus: "active",
  });

  await assert.rejects(
    () => handleStripeEvent({
      id: "evt_ambiguous_old_refund",
      type: "charge.refunded",
      created: Math.floor(Date.now() / 1000),
      data: {object: {
        id: "ch_ambiguous_old_refund",
        object: "charge",
        payment_intent: null,
        customer: "cus_shared_history",
        amount: 2500,
        amount_refunded: 2500,
      }},
    }, async () => undefined),
    /no authoritative invoice-to-membership link/i
  );

  assert.equal(
    (await db.collection("memberships").doc("sub_customer_old").get())
      .get("accessRevoked"),
    false
  );
  assert.equal(
    (await db.collection("memberships").doc("sub_customer_replacement").get())
      .get("accessRevoked"),
    false
  );
});

test("an unrelated customer charge cannot revoke the sole membership", async () => {
  await seedMembership("sub_customer_only", {
    stripeCustomerId: "cus_with_unrelated_charge",
  });

  await assert.rejects(
    () => handleStripeEvent({
      id: "evt_unrelated_customer_refund",
      type: "charge.refunded",
      created: Math.floor(Date.now() / 1000),
      data: {object: {
        id: "ch_unrelated_customer_refund",
        object: "charge",
        payment_intent: null,
        customer: "cus_with_unrelated_charge",
        amount: 1000,
        amount_refunded: 1000,
      }},
    }, async () => undefined),
    /no authoritative invoice-to-membership link/i
  );

  const membership = await db.collection("memberships")
    .doc("sub_customer_only").get();
  assert.equal(membership.get("accessRevoked"), false);
  assert.equal(membership.get("state"), "active");
});

test("a delayed old cancellation cannot revoke a replacement membership", async () => {
  await createMember("replacementbuyer", {
    profile: {
      role: "user",
      approvalStatus: "pending",
      entitlementStatus: "none",
      entitlementSource: "none",
      alphaWodAccess: false,
    },
  });
  await seedMembership("sub_old_replaced", {
    payerUid: "replacementbuyer",
    entitlementTargetUid: "replacementbuyer",
    preMembershipEntitlement: {
      entitlementStatus: "none",
      entitlementSource: "none",
    },
  });
  await seedMembership("sub_new_replacement", {
    payerUid: "replacementbuyer",
    entitlementTargetUid: "replacementbuyer",
  });

  await membershipTesting.convergeMembershipFromStripe(
    "sub_new_replacement",
    async () => undefined
  );
  assert.equal((await accessOf("replacementbuyer")).alphaWodAccess, true);
  fakeStripe.setSubscription("sub_old_replaced", {status: "canceled"});

  await membershipTesting.convergeMembershipFromStripe(
    "sub_old_replaced",
    async () => undefined
  );

  assert.deepEqual(await accessOf("replacementbuyer"), {
    approvalStatus: "approved",
    entitlementStatus: "active",
    entitlementSource: "stripe",
    alphaWodAccess: true,
  });
  const owners = await db.collection("membershipEntitlementOwners").get();
  assert.equal(owners.size, 1);
  assert.equal(owners.docs[0].get("subscriptionId"), "sub_new_replacement");
});

test("an active entitlement generation blocks replacement until restoration completes", async () => {
  await createMember("handoffbuyer");
  await seedMembership("sub_handoff_old", {
    payerUid: "handoffbuyer",
    entitlementTargetUid: "handoffbuyer",
  });
  await membershipTesting.convergeMembershipFromStripe(
    "sub_handoff_old",
    async () => undefined
  );

  // Simulate the narrow gap after subscription state is stored but before the
  // old entitlement transaction has restored the account and released owner.
  await db.collection("memberships").doc("sub_handoff_old").set({
    state: "canceled",
    stripeStatus: "canceled",
  }, {merge: true});
  await seedMembership("sub_handoff_new", {
    payerUid: "handoffbuyer",
    entitlementTargetUid: "handoffbuyer",
  });
  await assert.rejects(
    () => membershipTesting.convergeMembershipFromStripe(
      "sub_handoff_new",
      async () => undefined
    ),
    /already has an active or scheduled membership|already exists/i
  );

  fakeStripe.setSubscription("sub_handoff_old", {status: "canceled"});
  await membershipTesting.convergeMembershipFromStripe(
    "sub_handoff_old",
    async () => undefined
  );
  await membershipTesting.convergeMembershipFromStripe(
    "sub_handoff_new",
    async () => undefined
  );

  assert.equal((await accessOf("handoffbuyer")).alphaWodAccess, true);
  const owners = await db.collection("membershipEntitlementOwners").get();
  assert.equal(owners.size, 1);
  assert.equal(owners.docs[0].get("subscriptionId"), "sub_handoff_new");
  assert.equal(owners.docs[0].get("state"), "active");
});

test("ending a membership releases its owner when the target profile is missing", async () => {
  await createMember("missingprofilebuyer");
  await seedMembership("sub_missing_profile", {
    payerUid: "missingprofilebuyer",
    entitlementTargetUid: "missingprofilebuyer",
  });
  await membershipTesting.convergeMembershipFromStripe(
    "sub_missing_profile",
    async () => undefined
  );
  await db.collection("users").doc("missingprofilebuyer").delete();
  fakeStripe.setSubscription("sub_missing_profile", {status: "canceled"});

  await membershipTesting.convergeMembershipFromStripe(
    "sub_missing_profile",
    async () => undefined
  );

  const owners = await db.collection("membershipEntitlementOwners").get();
  assert.equal(owners.size, 1);
  assert.equal(owners.docs[0].get("subscriptionId"), "sub_missing_profile");
  assert.equal(owners.docs[0].get("state"), "released");
  const membership = await db.collection("memberships")
    .doc("sub_missing_profile").get();
  assert.equal(membership.get("entitlementProjectionStatus"), "manual_review");
  assert.match(membership.get("entitlementProjectionError"), /profile is missing/i);
});

test("a released membership cannot replay over a later manual grant", async () => {
  await createMember("releasedbuyer");
  await seedMembership("sub_released_once", {
    payerUid: "releasedbuyer",
    entitlementTargetUid: "releasedbuyer",
    preMembershipEntitlement: {
      entitlementStatus: "none",
      entitlementSource: "none",
    },
  });
  await membershipTesting.convergeMembershipFromStripe(
    "sub_released_once",
    async () => undefined
  );
  fakeStripe.setSubscription("sub_released_once", {status: "canceled"});
  await membershipTesting.convergeMembershipFromStripe(
    "sub_released_once",
    async () => undefined
  );

  await db.collection("users").doc("releasedbuyer").set({
    approvalStatus: "approved",
    entitlementStatus: "active",
    entitlementSource: "manual",
    alphaWodAccess: true,
  }, {merge: true});
  await membershipTesting.convergeMembershipFromStripe(
    "sub_released_once",
    async () => undefined
  );

  assert.deepEqual(await accessOf("releasedbuyer"), {
    approvalStatus: "approved",
    entitlementStatus: "active",
    entitlementSource: "manual",
    alphaWodAccess: true,
  });
  const owners = await db.collection("membershipEntitlementOwners").get();
  assert.equal(owners.size, 1);
  assert.equal(owners.docs[0].get("subscriptionId"), "sub_released_once");
  assert.equal(owners.docs[0].get("state"), "released");
});

test("app-owned pre-fulfilment events retry while unrelated events are ignored", async () => {
  const now = Date.now();
  const ownedSubscription = fakeStripe.setSubscription("sub_before_fulfilment", {
    metadata: {intentId: "intent_waiting_for_checkout"},
  });
  const ownedEvent = {
    id: "evt_before_fulfilment",
    type: "customer.subscription.created",
    created: Math.floor(now / 1000),
    data: {object: ownedSubscription},
  };
  const ownedLease = await membershipTesting.acquireStripeEventLease(
    ownedEvent,
    now,
    "lease_before_fulfilment"
  );
  assert.equal(ownedLease.state, "acquired");
  await assert.rejects(
    () => membershipTesting.processStripeEventUnderLease(
      ownedEvent,
      ownedLease.leaseToken,
      async () => undefined
    ),
    /waiting for Checkout intent|to fulfil/i
  );
  const retryableLedger = await db.collection("stripeEvents")
    .doc(ownedEvent.id).get();
  assert.equal(retryableLedger.get("status"), "failed");
  assert.ok(retryableLedger.get("nextAttemptAt"));

  const unrelatedSubscription = fakeStripe.setSubscription("sub_unrelated_missing", {
    metadata: {},
  });
  const unrelatedEvent = {
    id: "evt_unrelated_missing",
    type: "customer.subscription.updated",
    created: Math.floor(now / 1000),
    data: {object: unrelatedSubscription},
  };
  const unrelatedLease = await membershipTesting.acquireStripeEventLease(
    unrelatedEvent,
    now,
    "lease_unrelated_missing"
  );
  assert.equal(unrelatedLease.state, "acquired");
  await membershipTesting.processStripeEventUnderLease(
    unrelatedEvent,
    unrelatedLease.leaseToken,
    async () => undefined
  );
  assert.equal(
    (await db.collection("stripeEvents").doc(unrelatedEvent.id).get()).get("status"),
    "processed"
  );
  assert.equal(
    (await db.collection("memberships").doc("sub_unrelated_missing").get()).exists,
    false
  );
});

test("Stripe event leases recover crashes and failed attempts without replaying processed work", async () => {
  const start = Date.now();
  const event = {
    id: "evt_lease",
    type: "invoice.paid",
    created: Math.floor(start / 1000),
  };
  const first = await membershipTesting.acquireStripeEventLease(event, start, "lease_one");
  const concurrent = await membershipTesting.acquireStripeEventLease(
    event,
    start + 1000,
    "lease_two"
  );
  assert.equal(first.state, "acquired");
  assert.equal(concurrent.state, "in_progress");

  const recovered = await membershipTesting.acquireStripeEventLease(
    event,
    start + 11 * 60 * 1000,
    "lease_recovered"
  );
  assert.equal(recovered.state, "acquired");
  assert.equal(
    await membershipTesting.markStripeEventProcessed(event.id, "lease_recovered"),
    true
  );
  assert.equal(
    (await membershipTesting.acquireStripeEventLease(event, start + 7 * 60 * 1000)).state,
    "processed"
  );

  const failedEvent = {
    id: "evt_failed",
    type: "invoice.payment_failed",
    created: Math.floor(start / 1000),
  };
  await membershipTesting.acquireStripeEventLease(failedEvent, start, "lease_failed");
  await membershipTesting.markStripeEventFailed(
    failedEvent.id,
    "lease_failed",
    new Error("temporary failure")
  );
  assert.equal(
    (await membershipTesting.acquireStripeEventLease(
      failedEvent,
      start + 1000,
      "lease_retry"
    )).state,
    "deferred"
  );
  assert.equal(
    (await membershipTesting.acquireStripeEventLease(
      failedEvent,
      start + 61 * 1000,
      "lease_retry_due"
    )).state,
    "acquired"
  );
});

test("scheduled Stripe recovery replays an abandoned event from Stripe", async () => {
  const now = Date.now();
  await seedMembership("sub_event_recovery", {
    state: "past_due_grace",
    stripeStatus: "past_due",
    pastDueSince: Math.floor((now - 24 * 3600 * 1000) / 1000),
    pastDueGraceEndsAt: admin.firestore.Timestamp.fromMillis(now + 24 * 3600 * 1000),
  });
  fakeStripe.setSubscription("sub_event_recovery", {status: "active"});

  const event = {
    id: "evt_scheduled_recovery",
    object: "event",
    api_version: "2026-07-29.basil",
    created: Math.floor(now / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: null,
    type: "invoice.paid",
    data: {
      object: {
        id: "in_recovered",
        object: "invoice",
        livemode: false,
        parent: {
          type: "subscription_details",
          subscription_details: {subscription: "sub_event_recovery"},
        },
        lines: {object: "list", data: []},
      },
    },
  };
  fakeStripe.setEvent(event);
  await membershipTesting.acquireStripeEventLease(
    event,
    now - 10 * 60 * 1000,
    "abandoned_lease"
  );

  const result = await membershipTesting.recoverDueStripeEventsOnce(
    async () => undefined,
    now
  );
  assert.deepEqual(result, {processed: 1, failed: 0, skipped: 0});
  const ledger = await db.collection("stripeEvents").doc(event.id).get();
  assert.equal(ledger.get("status"), "processed");
  const membership = await db.collection("memberships").doc("sub_event_recovery").get();
  assert.equal(membership.get("state"), "active");
  assert.equal(membership.get("pastDueSince"), null);
  assert.equal(membership.get("pastDueGraceEndsAt"), null);
});

test("scheduled grace reconciliation suspends stale debt but preserves a recovered payment", async () => {
  const now = Date.now();
  await createMember("pastdue", {
    profile: {
      role: "user",
      approvalStatus: "approved",
      entitlementStatus: "active",
      entitlementSource: "stripe",
      alphaWodAccess: true,
    },
  });
  const pastDueSince = Math.floor((now - 5 * 24 * 3600 * 1000) / 1000);
  const dueDeadline = admin.firestore.Timestamp.fromMillis(now - 1000);
  await seedMembership("sub_grace_expired", {
    payerUid: "pastdue",
    entitlementTargetUid: "pastdue",
    state: "past_due_grace",
    stripeStatus: "past_due",
    pastDueSince,
    pastDueGraceEndsAt: dueDeadline,
    nextReconcileAt: dueDeadline,
  });
  fakeStripe.setSubscription("sub_grace_expired", {status: "past_due"});

  await seedMembership("sub_grace_recovered", {
    state: "past_due_grace",
    stripeStatus: "past_due",
    pastDueSince,
    pastDueGraceEndsAt: dueDeadline,
    nextReconcileAt: dueDeadline,
  });
  fakeStripe.setSubscription("sub_grace_recovered", {status: "active"});

  await seedMembership("sub_suspended_recovered", {
    state: "past_due_suspended",
    stripeStatus: "past_due",
    pastDueSince,
    pastDueGraceEndsAt: dueDeadline,
    nextReconcileAt: dueDeadline,
  });
  fakeStripe.setSubscription("sub_suspended_recovered", {status: "active"});

  const result = await membershipTesting.reconcilePastDueMembershipsOnce(
    async () => undefined,
    now
  );
  assert.deepEqual(result, {processed: 3, failed: 0});
  assert.equal(
    (await db.collection("memberships").doc("sub_grace_expired").get()).get("state"),
    "past_due_suspended"
  );
  assert.deepEqual(await accessOf("pastdue"), {
    approvalStatus: "approved",
    entitlementStatus: "restricted",
    entitlementSource: "stripe",
    alphaWodAccess: false,
  });
  const recovered = await db.collection("memberships").doc("sub_grace_recovered").get();
  assert.equal(recovered.get("state"), "active");
  assert.equal(recovered.get("pastDueGraceEndsAt"), null);
  const suspendedRecovered = await db.collection("memberships")
    .doc("sub_suspended_recovered").get();
  assert.equal(suspendedRecovered.get("state"), "active");
  assert.equal(suspendedRecovered.get("nextReconcileAt"), null);
});

test("confirmation outbox freezes one payload and retries with one provider key", async () => {
  await seedMembership("sub_email_retry", {
    confirmationEmailSentAt: null,
    confirmationEmailStatus: "pending",
  });
  const membershipRef = db.collection("memberships").doc("sub_email_retry");
  const membership = (await membershipRef.get()).data();
  const emailIntentRef = db.collection("membershipIntents").doc("intent_email_retry");
  const emailIntent = reservationIntent("email_retry", {
    participantKey: membership.participant.participantKey,
  });
  await emailIntentRef.set(emailIntent);

  await membershipTesting.ensureMembershipAndConfirmationOutbox(
    membershipRef,
    membership,
    1234,
    emailIntentRef,
    emailIntent
  );
  await membershipTesting.ensureMembershipAndConfirmationOutbox(
    membershipRef,
    membership,
    9999,
    emailIntentRef,
    emailIntent
  );
  const before = await db.collection("membershipEmailOutbox").doc("sub_email_retry").get();
  assert.equal(before.get("initialChargePence"), 1234);
  assert.match(before.get("payload.subject"), /Welcome to Zero Alpha/);
  assert.match(before.get("payload.html"), /You’re in\. Let’s get to work\./);
  assert.match(before.get("payload.html"), /signed membership record/);
  assert.doesNotMatch(before.get("payload.html"), /Complete immutable document copies/);
  assert.equal(before.get("commercialTerms.planName"), "Adult Unlimited Membership");
  assert.equal(before.get("commercialTerms.amountPence"), 6000);
  assert.deepEqual(
    before.get("acceptedDocuments").map(({key}) => key),
    ["membershipTerms", "cancellationPolicy", "privacyNotice", "adultWaiver"]
  );
  assert.deepEqual(
    before.get("acceptedStatements").map(({id}) => id),
    membership.acceptances.acceptedStatementIds
  );
  assert.equal(before.get("payload.attachments").length, 5);
  assert.equal(before.get("payload.attachments")[0].filename, "membership-agreement.html");
  const agreementHtml = Buffer.from(
    before.get("payload.attachments")[0].content,
    "base64"
  ).toString("utf8");
  assert.match(agreementHtml, /Complete immutable document copies/);
  assert.match(agreementHtml, /Statements you accepted separately/);
  assert.match(agreementHtml, /acknowledgement is evidence of receipt/);
  assert.match(agreementHtml, /https:\/\/alpha-wod\.vercel\.app\/ZERO-ALPHA\.png/);
  assert.equal(
    Buffer.from(before.get("payload.attachments")[1].content, "base64").toString("utf8"),
    membership.acceptances.documents[0].content
  );
  const dispatchNow = Date.now() + 1000;

  const sends = [];
  const uncertainSender = async (payload, idempotencyKey) => {
    sends.push({payload, idempotencyKey});
    throw new Error("provider accepted but the response was lost");
  };
  assert.equal(
    await membershipTesting.processMembershipConfirmationOutbox(
      "sub_email_retry",
      dispatchNow,
      uncertainSender
    ),
    "failed"
  );
  assert.equal((await membershipRef.get()).get("confirmationEmailSentAt"), null);

  const successfulSender = async (payload, idempotencyKey) => {
    sends.push({payload, idempotencyKey});
    return {providerMessageId: "email_resend_1"};
  };
  assert.equal(
    await membershipTesting.processMembershipConfirmationOutbox(
      "sub_email_retry",
      dispatchNow + 6 * 60 * 1000,
      successfulSender
    ),
    "sent"
  );
  assert.equal(sends.length, 2);
  assert.equal(sends[0].idempotencyKey, sends[1].idempotencyKey);
  assert.deepEqual(sends[0].payload, sends[1].payload);
  const sentOutbox = await db.collection("membershipEmailOutbox")
    .doc("sub_email_retry").get();
  assert.equal(sentOutbox.get("status"), "sent");
  assert.equal(sentOutbox.get("providerMessageId"), "email_resend_1");
  assert.ok((await membershipRef.get()).get("confirmationEmailSentAt"));
  assert.equal((await db.collection("membershipEmailOutbox")
    .where("subscriptionId", "==", "sub_email_retry").get()).size, 1);
});

test("welcome email uses one branded shell with membership-specific variants", async () => {
  const variants = [
    ["adult_unlimited", "You’re in. Let’s get to work.",
      /Zero Alpha App access included/, "Adult Unlimited Membership"],
    ["adult_ladies", "Welcome to Ladies Only.",
      /Ladies-only coached sessions/, "Adult Ladies Only Membership"],
    ["adult_gym", "Your gym membership is ready.",
      /Independent gym-floor training/, "Adult Gym Only"],
    ["youth_youngstars", "A strong start begins here.",
      /strength and conditioning class for 10 and under/i,
      "MINI ALPHAS - 10 & Under"],
    ["youth_teenstars", "Their next level starts here.",
      /Strength and conditioning for 11 and up/i,
      "TEEN ALPHAS - 11 & UP"],
  ];

  for (const [planKey, headline, inclusion, expectedPlanName] of variants) {
    const youth = planKey.startsWith("youth_");
    const subscriptionId = `sub_welcome_${planKey}`;
    await seedMembership(subscriptionId, {
      planKey,
      payerUid: null,
      confirmationEmailSentAt: null,
      participant: youth ? {
        fullName: "Young Athlete",
        dateOfBirth: planKey === "youth_youngstars" ? "2018-05-05" : "2012-05-05",
        age: planKey === "youth_youngstars" ? 8 : 14,
        isPayer: false,
        participantKey: `key_${subscriptionId}`,
      } : {
        fullName: "Adult Athlete",
        dateOfBirth: "1990-01-01",
        age: 36,
        isPayer: true,
        participantKey: `key_${subscriptionId}`,
      },
      guardian: youth ? {
        fullName: "Paying Adult",
        relationship: "Parent",
        confirmedAuthority: true,
      } : null,
    });
    const membership = (await db.collection("memberships").doc(subscriptionId).get()).data();
    const payload = membershipTesting.buildWelcomePayload(membership);

    assert.ok(payload);
    assert.equal(
      payload.subject,
      `Welcome to Zero Alpha — ${expectedPlanName}`
    );
    assert.ok(payload.html.includes(expectedPlanName.replace("&", "&amp;")));
    assert.equal(payload.reply_to, "support@zeroalphafitness.co.uk");
    assert.match(payload.html, new RegExp(headline.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(payload.html, inclusion);
    assert.match(payload.html, /https:\/\/alpha-wod\.vercel\.app\/ZERO-ALPHA\.png/);
    assert.match(payload.html, /alt="Zero Alpha Fitness"/);
    assert.match(payload.html, /signed membership record/);
    assert.equal(payload.attachments, undefined);
    if (planKey === "adult_unlimited") {
      assert.match(payload.html, /Sign up or log into the Zero Alpha app!/);
      assert.match(payload.html, /https:\/\/alpha-wod\.vercel\.app\/login/);
      assert.match(payload.html, /Open the Zero Alpha app/);
    } else {
      assert.doesNotMatch(payload.html, /Sign up or log into the Zero Alpha app!/);
      assert.doesNotMatch(payload.html, /https:\/\/alpha-wod\.vercel\.app\/login/);
      assert.doesNotMatch(payload.html, /Open the Zero Alpha app/);
    }
    if (youth) {
      assert.match(payload.html, /Hi Paying Adult/);
    }
  }
});

test("a youth confirmation clearly labels the child and paying adult", async () => {
  await seedMembership("sub_youth_confirmation_labels", {
    planKey: "youth_teenstars",
    planName: "TEEN ALPHAS - 11 & UP",
    stripePriceId: "price_teenstars",
    grantsAlphaWodAccess: false,
    participant: {
      fullName: "Young Athlete",
      dateOfBirth: "2012-05-05",
      age: 14,
      isPayer: false,
      participantKey: "key_youth_confirmation_labels",
    },
    guardian: {
      fullName: "Paying Adult",
      relationship: "Parent",
      confirmedAuthority: true,
    },
  });
  const membership = (await db.collection("memberships")
    .doc("sub_youth_confirmation_labels").get()).data();
  const payload = membershipTesting.buildConfirmationPayload(membership, 1234);

  assert.ok(payload);
  assert.match(payload.html, /Hi Paying Adult/);
  assert.match(payload.html, /Young Athlete/);
  const agreementHtml = Buffer.from(
    payload.attachments[0].content,
    "base64"
  ).toString("utf8");
  assert.match(agreementHtml, />Child<\/td>/);
  assert.match(agreementHtml, />Young Athlete<\/strong>/);
  assert.match(agreementHtml, />Paying adult<\/td>/);
  assert.match(agreementHtml, />Paying Adult \(Parent\)<\/strong>/);
  assert.doesNotMatch(agreementHtml, />Participant<\/td>/);
  assert.doesNotMatch(agreementHtml, />Parent or guardian<\/td>/);
});

test("an orphan confirmation outbox never recreates its membership", async () => {
  const subscriptionId = "sub_orphan_confirmation";
  await db.collection("membershipEmailOutbox").doc(subscriptionId).set({
    schemaVersion: 1,
    kind: "membership_confirmation",
    subscriptionId,
    status: "pending",
    payload: {
      from: "Zero Alpha Fitness <support@example.test>",
      to: ["buyer@example.test"],
      subject: "Membership confirmed",
      html: "<p>Confirmed</p>",
    },
    idempotencyKey: `membership-confirmation/${subscriptionId}/v1`,
    attemptCount: 0,
    nextAttemptAt: admin.firestore.Timestamp.fromMillis(Date.now() - 1000),
    createdAt: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now(),
  });

  let sends = 0;
  const result = await membershipTesting.processMembershipConfirmationOutbox(
    subscriptionId,
    Date.now(),
    async () => {
      sends += 1;
      return {providerMessageId: "must_not_send"};
    }
  );

  assert.equal(result, "terminal");
  assert.equal(sends, 0);
  assert.equal(
    (await db.collection("memberships").doc(subscriptionId).get()).exists,
    false
  );
  const outbox = await db.collection("membershipEmailOutbox").doc(subscriptionId).get();
  assert.equal(outbox.get("status"), "manual_review");
  assert.match(outbox.get("deadLetterReason"), /no membership document/i);
  assert.equal(outbox.get("leaseToken"), undefined);
  assert.equal(outbox.get("leaseExpiresAt"), undefined);
});
