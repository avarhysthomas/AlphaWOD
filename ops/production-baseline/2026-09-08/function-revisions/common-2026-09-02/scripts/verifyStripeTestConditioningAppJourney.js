/* eslint-disable no-console, max-len, require-jsdoc, @typescript-eslint/no-var-requires */

const admin = require("firebase-admin");
const crypto = require("node:crypto");
const {isDeepStrictEqual} = require("node:util");
const {
  ACCESS_SCHEMA_VERSION,
  CURRENT_WAIVER_VERSION,
  isCanonicalCurrentWaiverAcceptance,
  resolveUserAuthorisation,
} = require("../lib/authz");
const {
  CONDITIONING_BOOKING_POLICY,
  MEMBERSHIP_SCHEMA_VERSION,
} = require("../lib/membershipPlans");
const {redactProviderSecrets} = require("./stripeCliTestKey");
const {
  CONDITIONING_FIXTURE_CAPACITY,
  CONDITIONING_FIXTURE_KIND,
  CONDITIONING_FIXTURE_SCHEMA_VERSION,
  CONDITIONING_SCOPE,
  CONDITIONING_TIMEZONE,
  assertLocalConditioningTarget,
  buildLocalConditioningClassDocuments,
} = require("./localStripeConditioningJourney");

const TEST_PROJECT_ID = "demo-alphawod-stripe";
const EXPECTED_ACTIVE_LABELS = Object.freeze(["Thursday A", "Friday B"]);
const EXPECTED_CANCELLED_LABELS = Object.freeze(["Friday A"]);
const EXPECTED_ABSENT_LABELS = Object.freeze(["Thursday B"]);
const EXPECTED_CLASS_COUNTS = Object.freeze({
  "Thursday A": 1,
  "Thursday B": 0,
  "Friday A": 0,
  "Friday B": 1,
});

function argument(name, argv = process.argv.slice(2)) {
  const prefix = `--${name}=`;
  const match = argv.find((value) => value.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : "";
}

function assertEnvironment(environment = process.env) {
  const firestoreHost = environment.FIRESTORE_EMULATOR_HOST ||
    "127.0.0.1:8080";
  assertLocalConditioningTarget({
    projectId: environment.MEMBERSHIP_FIREBASE_PROJECT_ID,
    firestoreHost,
    appOrigin: environment.APP_PUBLIC_ORIGIN,
  });
  if (environment.MEMBERSHIP_FIREBASE_PROJECT_ID !== TEST_PROJECT_ID ||
    environment.STRIPE_EXPECTED_MODE !== "test" ||
    environment.MEMBERSHIP_TEST_JOURNEY_ENABLED !== "true") {
    throw new Error(
      "The Conditioning verifier requires the isolated Stripe test journey."
    );
  }
  process.env.FIRESTORE_EMULATOR_HOST = firestoreHost;
  return firestoreHost;
}

function timestampParts(value) {
  if (!value || typeof value !== "object") return null;
  if (Number.isSafeInteger(value.seconds) &&
    Number.isInteger(value.nanoseconds) &&
    value.nanoseconds >= 0 && value.nanoseconds < 1_000_000_000) {
    return {seconds: value.seconds, nanoseconds: value.nanoseconds};
  }
  if (typeof value.toMillis === "function") {
    const millis = value.toMillis();
    if (!Number.isFinite(millis)) return null;
    const seconds = Math.floor(millis / 1000);
    return {seconds, nanoseconds: Math.round((millis - seconds * 1000) * 1e6)};
  }
  return null;
}

function timestampMillis(value) {
  const parts = timestampParts(value);
  return parts ? parts.seconds * 1000 + parts.nanoseconds / 1e6 : null;
}

function sameTimestamp(left, right) {
  return isDeepStrictEqual(timestampParts(left), timestampParts(right));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fail(message) {
  throw new Error(message);
}

function assertMembershipClaim(state) {
  const {membership, membershipId, sessionId, uid, owner} = state;
  const policy = membership?.commercialTerms?.conditioningBookingPolicy;
  if (!membership || membership.subscriptionId !== membershipId ||
    membership.checkoutSessionId !== sessionId ||
    membership.planKey !== CONDITIONING_SCOPE ||
    membership.schemaVersion !== MEMBERSHIP_SCHEMA_VERSION ||
    membership.state !== "active" || membership.stripeStatus !== "active" ||
    membership.providerContractStatus !== "verified" ||
    membership.entitlementProjectionStatus !== "applied" ||
    membership.entitlementProjectionError !== undefined ||
    membership.payerUid !== uid || membership.entitlementTargetUid !== uid ||
    membership.claimedVia !== "checkout_session" ||
    timestampMillis(membership.claimedAt) === null ||
    timestampMillis(membership.checkoutClaimVerifierConsumedAt) === null ||
    membership.grantsAlphaWodAccess !== true ||
    membership.participant?.isPayer !== true ||
    membership.commercialTerms?.appAccessTier !== "limited" ||
    !isDeepStrictEqual(policy, CONDITIONING_BOOKING_POLICY)) {
    fail("The claimed Conditioning membership is incomplete or not authoritative.");
  }

  if (!owner || owner.schemaVersion !== MEMBERSHIP_SCHEMA_VERSION ||
    owner.subscriptionId !== membershipId ||
    owner.userIdHash !== sha256(uid) || owner.state !== "active" ||
    timestampMillis(owner.updatedAt) === null) {
    fail("The claimed Conditioning membership has no active entitlement owner.");
  }
}

function assertProfileAndWaiver(state) {
  const {membership, profile, uid, waiver} = state;
  const resolved = resolveUserAuthorisation(profile || undefined);
  if (!profile || profile.role !== "user" ||
    profile.approvalStatus !== "approved" ||
    profile.entitlementStatus !== "active" ||
    profile.entitlementSource !== "stripe" ||
    profile.entitlementPlanKey !== CONDITIONING_SCOPE ||
    profile.appAccessTier !== "limited" ||
    !isDeepStrictEqual(
      profile.entitlementClassSlots,
      CONDITIONING_BOOKING_POLICY.eligibleSlotKeys
    ) ||
    profile.entitlementWeeklyBookingLimit !== 2 ||
    profile.alphaWodAccess !== true ||
    profile.accessSchemaVersion !== ACCESS_SCHEMA_VERSION ||
    profile.entitlementUpdatedBy !== "stripe_membership" ||
    !resolved.valid || resolved.appAccessTier !== "limited" ||
    resolved.entitlementWeeklyBookingLimit !== 2) {
    fail("The claimed account does not have the exact limited Conditioning entitlement.");
  }

  if (!isCanonicalCurrentWaiverAcceptance(uid, waiver) ||
    profile.waiverAcceptedVersion !== CURRENT_WAIVER_VERSION ||
    !sameTimestamp(profile.waiverAcceptedAt, waiver.acceptedAt) ||
    typeof membership.payerEmail !== "string" ||
    waiver.acceptedEmail !== membership.payerEmail ||
    profile.email !== membership.payerEmail) {
    fail("The claimed account does not have the exact current waiver evidence.");
  }
}

function assertFixtureClass(actual, expected) {
  if (!actual || actual.templateId !== `local_${expected.classId}` ||
    actual.title !== expected.title ||
    actual.timezone !== CONDITIONING_TIMEZONE ||
    timestampMillis(actual.startTime) !== Date.parse(expected.startTime) ||
    timestampMillis(actual.endTime) !== Date.parse(expected.endTime) ||
    actual.coachId !== "local-conditioning-test" ||
    actual.coachName !== "Local Test Coach" ||
    actual.capacity !== CONDITIONING_FIXTURE_CAPACITY ||
    actual.location !== "Local emulator — no real booking" ||
    actual.status !== "scheduled" ||
    actual.conditioningSlotKey !== expected.conditioningSlotKey ||
    actual.paygEligible !== false || actual.localTestFixture !== true ||
    actual.localTestFixtureKind !== CONDITIONING_FIXTURE_KIND ||
    actual.localTestFixtureSchemaVersion !==
      CONDITIONING_FIXTURE_SCHEMA_VERSION ||
    actual.localTestFixtureLabel !== expected.fixtureLabel ||
    actual.localTestFixtureWeekKey !== expected.weekKey ||
    timestampMillis(actual.createdAt) === null ||
    actual.bookedCount !== EXPECTED_CLASS_COUNTS[expected.fixtureLabel]) {
    fail(`Conditioning fixture ${expected.fixtureLabel} is missing or has drifted.`);
  }
}

function assertBooking(binding, expectedStatus, state, expected) {
  const {booking, bookingId} = binding;
  if (!booking || booking.classId !== expected.classId ||
    booking.userId !== state.uid || booking.status !== expectedStatus ||
    booking.bookingKind !== "member" ||
    booking.entitlementSubscriptionId !== state.membershipId ||
    booking.conditioningQuotaWeekKey !== state.expectedJourney.weekKey ||
    booking.conditioningQuotaPolicyVersion !==
      CONDITIONING_BOOKING_POLICY.version ||
    booking.conditioningQuotaWeeklyLimit !==
      CONDITIONING_BOOKING_POLICY.weeklyBookingLimit ||
    typeof booking.conditioningQuotaUsageId !== "string" ||
    booking.conditioningQuotaUsageId !== state.usageId ||
    timestampMillis(booking.createdAt) === null ||
    (expectedStatus === "cancelled" &&
      timestampMillis(booking.cancelledAt) === null) ||
    bookingId !== `${expected.classId}_${state.uid}`) {
    fail(`Conditioning booking ${expected.fixtureLabel} is incomplete or inconsistent.`);
  }
}

function assertBookingsAndQuota(state) {
  const expectedByLabel = Object.fromEntries(
    state.expectedJourney.fixtures.map((fixture) => [
      fixture.fixtureLabel,
      fixture,
    ])
  );
  for (const expected of state.expectedJourney.fixtures) {
    assertFixtureClass(state.classes[expected.classId], expected);
  }

  const thursdayA = state.bookings[expectedByLabel["Thursday A"].classId];
  const thursdayB = state.bookings[expectedByLabel["Thursday B"].classId];
  const fridayA = state.bookings[expectedByLabel["Friday A"].classId];
  const fridayB = state.bookings[expectedByLabel["Friday B"].classId];
  if (thursdayB?.booking) {
    fail("The rejected third Conditioning candidate unexpectedly has a booking.");
  }
  assertBooking(thursdayA, "booked", state, expectedByLabel["Thursday A"]);
  assertBooking(fridayA, "cancelled", state, expectedByLabel["Friday A"]);
  assertBooking(fridayB, "booked", state, expectedByLabel["Friday B"]);

  const expectedUsageId = sha256(
    `conditioning-week:${state.uid}:${state.expectedJourney.weekKey}`
  );
  const expectedActiveBookingIds = [
    thursdayA.bookingId,
    fridayB.bookingId,
  ].sort();
  if (!state.usage || state.usageId !== expectedUsageId ||
    state.usage.schemaVersion !== 1 || state.usage.userId !== state.uid ||
    state.usage.weekKey !== state.expectedJourney.weekKey ||
    state.usage.timezone !== CONDITIONING_TIMEZONE ||
    state.usage.weekStartsOn !== "monday" ||
    state.usage.weeklyBookingLimit !== 2 || state.usage.bookedCount !== 2 ||
    !isDeepStrictEqual(
      [...(state.usage.activeBookingIds || [])].sort(),
      expectedActiveBookingIds
    ) ||
    !isDeepStrictEqual(state.usage.subscriptionIds, [state.membershipId]) ||
    timestampMillis(state.usage.createdAt) === null ||
    timestampMillis(state.usage.updatedAt) === null) {
    fail("The Conditioning weekly quota does not match the final two bookings.");
  }
}

function assertConditioningAppJourneyState(state) {
  if (!state || typeof state.sessionId !== "string" ||
    !state.sessionId.startsWith("cs_test_") ||
    typeof state.membershipId !== "string" ||
    !state.membershipId.startsWith("sub_") ||
    typeof state.uid !== "string" || !state.uid ||
    state.expectedJourney?.timezone !== CONDITIONING_TIMEZONE ||
    !/^\d{4}-\d{2}-\d{2}$/.test(state.expectedJourney?.weekKey || "")) {
    fail("The Conditioning app-journey state is incomplete.");
  }
  assertMembershipClaim(state);
  assertProfileAndWaiver(state);
  assertBookingsAndQuota(state);
  return Object.freeze({
    planKey: CONDITIONING_SCOPE,
    weekKey: state.expectedJourney.weekKey,
    activeFixtureLabels: EXPECTED_ACTIVE_LABELS,
    cancelledFixtureLabels: EXPECTED_CANCELLED_LABELS,
    absentFixtureLabels: EXPECTED_ABSENT_LABELS,
    quotaBookedCount: 2,
  });
}

function formatConditioningAppJourneySummary(result) {
  return [
    "Adult Conditioning full app journey verified:",
    "- Membership claim: Checkout verifier consumed; entitlement projection applied",
    "- App access: limited; all four eligible slots; 2 bookings per London week",
    `- Current waiver: canonical (${CURRENT_WAIVER_VERSION})`,
    `- Active fixture bookings: ${result.activeFixtureLabels.join(", ")}`,
    `- Cancelled fixture booking: ${result.cancelledFixtureLabels.join(", ")}`,
    `- Rejected third candidate left no booking: ${result.absentFixtureLabels.join(", ")}`,
    `- Weekly quota: ${result.quotaBookedCount} active in week ${result.weekKey}`,
    "- Class booked counts: Thursday A 1; Thursday B 0; Friday A 0; Friday B 1",
    "- Email transport: disabled; this verifier makes no delivery claim",
  ];
}

async function loadConditioningAppJourneyState(db, sessionId, nowMillis = Date.now()) {
  const memberships = await db.collection("memberships")
    .where("checkoutSessionId", "==", sessionId)
    .limit(2)
    .get();
  if (memberships.size !== 1) {
    fail("The Checkout Session does not map to one local membership.");
  }
  const membershipSnap = memberships.docs[0];
  const membership = membershipSnap.data();
  const uid = membership.payerUid;
  if (typeof uid !== "string" || !uid) {
    fail("The Conditioning membership has not been claimed into an account.");
  }
  const expectedJourney = buildLocalConditioningClassDocuments(nowMillis);
  const ownerId = sha256(uid);
  const [profileSnap, waiverSnap, ownerSnap, ...fixtureSnaps] =
    await Promise.all([
      db.collection("users").doc(uid).get(),
      db.collection("waiverAcceptances")
        .doc(`${uid}__${CURRENT_WAIVER_VERSION}`).get(),
      db.collection("membershipEntitlementOwners").doc(ownerId).get(),
      ...expectedJourney.fixtures.flatMap((fixture) => [
        db.collection("classes").doc(fixture.classId).get(),
        db.collection("bookings").doc(`${fixture.classId}_${uid}`).get(),
      ]),
    ]);

  const classes = {};
  const bookings = {};
  expectedJourney.fixtures.forEach((fixture, index) => {
    const classSnap = fixtureSnaps[index * 2];
    const bookingSnap = fixtureSnaps[index * 2 + 1];
    classes[fixture.classId] = classSnap.exists ? classSnap.data() : null;
    bookings[fixture.classId] = {
      bookingId: bookingSnap.id,
      booking: bookingSnap.exists ? bookingSnap.data() : null,
    };
  });
  const usageId = bookings["conditioning_browser_thursday_a"]
    ?.booking?.conditioningQuotaUsageId;
  const usageSnap = typeof usageId === "string" && /^[a-f0-9]{64}$/.test(usageId) ?
    await db.collection("conditioningWeeklyBookingUsage").doc(usageId).get() :
    null;

  return {
    sessionId,
    membershipId: membershipSnap.id,
    membership,
    uid,
    profile: profileSnap.exists ? profileSnap.data() : null,
    waiver: waiverSnap.exists ? waiverSnap.data() : null,
    owner: ownerSnap.exists ? ownerSnap.data() : null,
    expectedJourney,
    classes,
    bookings,
    usageId: typeof usageId === "string" ? usageId : null,
    usage: usageSnap?.exists ? usageSnap.data() : null,
  };
}

async function main() {
  assertEnvironment();
  const sessionId = argument("session");
  if (!sessionId || !/^cs_test_[A-Za-z0-9_]+$/.test(sessionId)) {
    throw new Error("Pass the exact local --session=cs_test_... value.");
  }
  admin.initializeApp({projectId: TEST_PROJECT_ID});
  const state = await loadConditioningAppJourneyState(
    admin.firestore(),
    sessionId
  );
  const result = assertConditioningAppJourneyState(state);
  for (const line of formatConditioningAppJourneySummary(result)) {
    console.log(line);
  }
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(
        "Conditioning app journey verification failed: " +
        redactProviderSecrets(error.message)
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await Promise.all(admin.apps.map((app) => app.delete()));
    });
}

module.exports = {
  EXPECTED_ABSENT_LABELS,
  EXPECTED_ACTIVE_LABELS,
  EXPECTED_CANCELLED_LABELS,
  EXPECTED_CLASS_COUNTS,
  argument,
  assertConditioningAppJourneyState,
  assertEnvironment,
  formatConditioningAppJourneySummary,
  loadConditioningAppJourneyState,
  sameTimestamp,
  timestampMillis,
};
