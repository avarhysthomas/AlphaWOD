/* eslint-disable @typescript-eslint/no-var-requires, max-len, require-jsdoc, valid-jsdoc */

/**
 * End-to-end billing tests: the flows where money and access actually change
 * hands. They run the real handlers against the Firestore and Auth emulators,
 * with a fake Stripe API standing in for the network.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const admin = require("firebase-admin");
const {createFakeStripe} = require("./fakeStripe");

const STRIPE_PORT = 12111;
process.env.STRIPE_API_HOST = "127.0.0.1";
process.env.STRIPE_API_PORT = String(STRIPE_PORT);
process.env.STRIPE_API_PROTOCOL = "http";
process.env.STRIPE_SECRET_KEY = "sk_test_fake";
process.env.APP_PUBLIC_ORIGIN = "https://alpha-wod.vercel.app";
process.env.MEMBERSHIP_PURCHASE_ENABLED = "true";
process.env.STRIPE_PORTAL_CONFIGURATION_ID = "bpc_fake";
process.env.STRIPE_PRICE_ADULT_UNLIMITED = "price_unlimited";
process.env.STRIPE_PRICE_ADULT_LADIES = "price_ladies";
process.env.STRIPE_PRICE_ADULT_GYM = "price_gym";
process.env.STRIPE_PRICE_YOUTH_YOUNGSTARS = "price_youngstars";
process.env.STRIPE_PRICE_YOUTH_TEENSTARS = "price_teenstars";

const functionsTest = require("firebase-functions-test")();
const functions = require("../lib/index");
const {resolveCancellationOutcome} = require("../lib/membershipPlans");

const projectId = process.env.GCLOUD_PROJECT || "alpha-wod-functions-test";
const db = admin.firestore();

const claimMembership = functionsTest.wrap(functions.claimMembership);
const requestMembershipCancellation = functionsTest.wrap(functions.requestMembershipCancellation);
const getMyMemberships = functionsTest.wrap(functions.getMyMemberships);

let fakeStripe;

function request(data, uid) {
  return {
    data,
    ...(uid ? {auth: {uid, token: {auth_time: 1, firebase: {sign_in_provider: "password"}}}} : {}),
    rawRequest: {get: () => "phase-1-emulator-test"},
    acceptsStreaming: false,
  };
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
  const doc = {
    schemaVersion: 1,
    subscriptionId,
    stripeCustomerId: "cus_fake_1",
    checkoutSessionId: `cs_${subscriptionId}`,
    payerUid: null,
    payerEmail: "buyer@example.test",
    fulfilledAt: admin.firestore.Timestamp.now(),
    claimedAt: null,
    planKey: "adult_unlimited",
    planName: "Adult Unlimited Membership",
    grantsAlphaWodAccess: true,
    participant: {
      fullName: "Buyer One",
      dateOfBirth: "1990-01-01",
      age: 36,
      isPayer: true,
      participantKey: `key_${subscriptionId}`,
    },
    guardian: null,
    acceptances: {
      signedName: "Buyer One",
      documents: {membershipTerms: "ZAF-TERMS-DRAFT-2026-08-17-01"},
      immediatePerformanceRequested: true,
      coolingOffEndsAt: "2026-09-01T23:59:59.999+01:00",
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
    disputeOpen: false,
    accessRevoked: false,
    cancelAt: null,
    cancellationRequestedAt: null,
    cancellationOutcome: null,
    confirmationEmailSentAt: admin.firestore.Timestamp.now(),
    ...overrides,
  };
  await db.collection("memberships").doc(subscriptionId).set(doc);
  fakeStripe.setSubscription(subscriptionId);
  return doc;
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

test.before(async () => {
  fakeStripe = createFakeStripe();
  await fakeStripe.listen(STRIPE_PORT);
});

test.after(async () => {
  await fakeStripe.close();
});

test.beforeEach(clearEmulators);

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

test("an unverified email cannot claim a purchase without the session id", async () => {
  await createMember("attacker", {email: "buyer@example.test", emailVerified: false});
  await seedMembership("sub_unverified");

  await assert.rejects(
    () => claimMembership(request({}, "attacker")),
    (error) => {
      assert.match(error.message, /Verify the email/i);
      return true;
    }
  );

  assert.equal((await accessOf("attacker")).alphaWodAccess, false);
});

test("a verified matching email can claim without the session id", async () => {
  await createMember("buyer", {email: "buyer@example.test", emailVerified: true});
  await seedMembership("sub_verified");

  const result = await claimMembership(request({}, "buyer"));
  assert.deepEqual(result.claimed, ["sub_verified"]);
  assert.equal((await accessOf("buyer")).alphaWodAccess, true);
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
    planName: "HYROX Teenstars",
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

  const result = await requestMembershipCancellation(
    request({subscriptionId: "sub_cancel"}, "buyer")
  );

  const expected = resolveCancellationOutcome(Date.now());
  assert.equal(result.outcome.cancelAtUnixSeconds, expected.cancelAtUnixSeconds);
  assert.equal(result.outcome.nextBillingDate, expected.nextBillingDate);

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
});

test("only the payer can cancel a membership", async () => {
  await createMember("buyer", {email: "buyer@example.test", emailVerified: true});
  await createMember("someone", {email: "someone@example.test", emailVerified: true});
  await seedMembership("sub_guard", {payerUid: "buyer"});

  await assert.rejects(
    () => requestMembershipCancellation(request({subscriptionId: "sub_guard"}, "someone")),
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
      assert.match(error.message, /already has an active membership/i);
      return true;
    }
  );
});
