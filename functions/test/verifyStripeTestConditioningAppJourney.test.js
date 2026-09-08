/* eslint-disable @typescript-eslint/no-var-requires, max-len, require-jsdoc */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  CURRENT_WAIVER_ACKNOWLEDGEMENTS,
  CURRENT_WAIVER_TITLE,
  CURRENT_WAIVER_VERSION,
} = require("../lib/authz");
const {
  CONDITIONING_BOOKING_POLICY,
  MEMBERSHIP_SCHEMA_VERSION,
} = require("../lib/membershipPlans");
const {
  assertConditioningAppJourneyState,
  formatConditioningAppJourneySummary,
} = require("../scripts/verifyStripeTestConditioningAppJourney");
const {
  buildLocalConditioningClassDocuments,
} = require("../scripts/localStripeConditioningJourney");

const NOW = Date.parse("2026-09-02T12:00:00.000Z");
const UID = "conditioning-browser-member";
const EMAIL = "conditioning-browser@example.test";
const SESSION_ID = "cs_test_conditioning_browser";
const MEMBERSHIP_ID = "sub_conditioning_browser";

function timestamp(value = "2026-09-02T12:00:00.000Z") {
  const millis = Date.parse(value);
  return {
    seconds: Math.floor(millis / 1000),
    nanoseconds: (millis % 1000) * 1e6,
    toMillis: () => millis,
    toDate: () => new Date(millis),
  };
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function plainClass(fixture, bookedCount) {
  return {
    templateId: `local_${fixture.classId}`,
    title: fixture.title,
    timezone: "Europe/London",
    startTime: timestamp(fixture.startTime),
    endTime: timestamp(fixture.endTime),
    coachId: "local-conditioning-test",
    coachName: "Local Test Coach",
    capacity: 10,
    bookedCount,
    location: "Local emulator — no real booking",
    status: "scheduled",
    conditioningSlotKey: fixture.conditioningSlotKey,
    paygEligible: false,
    localTestFixture: true,
    localTestFixtureKind: "adult_conditioning_full_app_journey",
    localTestFixtureSchemaVersion: 1,
    localTestFixtureLabel: fixture.fixtureLabel,
    localTestFixtureWeekKey: fixture.weekKey,
    createdAt: timestamp(),
  };
}

function journeyState() {
  const expectedJourney = buildLocalConditioningClassDocuments(NOW);
  const expectedByLabel = Object.fromEntries(
    expectedJourney.fixtures.map((fixture) => [fixture.fixtureLabel, fixture])
  );
  const usageId = hash(`conditioning-week:${UID}:${expectedJourney.weekKey}`);
  const makeBinding = (fixture, status) => {
    const bookingId = `${fixture.classId}_${UID}`;
    return {
      bookingId,
      booking: {
        classId: fixture.classId,
        userId: UID,
        userName: "Synthetic Member",
        status,
        bookingKind: "member",
        entitlementSubscriptionId: MEMBERSHIP_ID,
        conditioningQuotaUsageId: usageId,
        conditioningQuotaWeekKey: expectedJourney.weekKey,
        conditioningQuotaPolicyVersion: 1,
        conditioningQuotaWeeklyLimit: 2,
        createdAt: timestamp(),
        ...(status === "cancelled" ? {cancelledAt: timestamp()} : {}),
      },
    };
  };
  const waiverAcceptedAt = timestamp();
  const classes = Object.fromEntries(expectedJourney.fixtures.map((fixture) => [
    fixture.classId,
    plainClass(fixture, {
      "Thursday A": 1,
      "Thursday B": 0,
      "Friday A": 0,
      "Friday B": 1,
    }[fixture.fixtureLabel]),
  ]));
  const bookings = {
    [expectedByLabel["Thursday A"].classId]:
      makeBinding(expectedByLabel["Thursday A"], "booked"),
    [expectedByLabel["Thursday B"].classId]: {
      bookingId: `${expectedByLabel["Thursday B"].classId}_${UID}`,
      booking: null,
    },
    [expectedByLabel["Friday A"].classId]:
      makeBinding(expectedByLabel["Friday A"], "cancelled"),
    [expectedByLabel["Friday B"].classId]:
      makeBinding(expectedByLabel["Friday B"], "booked"),
  };
  const activeBookingIds = [
    bookings[expectedByLabel["Thursday A"].classId].bookingId,
    bookings[expectedByLabel["Friday B"].classId].bookingId,
  ].sort();

  return {
    sessionId: SESSION_ID,
    membershipId: MEMBERSHIP_ID,
    uid: UID,
    membership: {
      schemaVersion: MEMBERSHIP_SCHEMA_VERSION,
      subscriptionId: MEMBERSHIP_ID,
      checkoutSessionId: SESSION_ID,
      planKey: "adult_conditioning",
      state: "active",
      stripeStatus: "active",
      providerContractStatus: "verified",
      entitlementProjectionStatus: "applied",
      payerUid: UID,
      payerEmail: EMAIL,
      entitlementTargetUid: UID,
      claimedVia: "checkout_session",
      claimedAt: timestamp(),
      checkoutClaimVerifierConsumedAt: timestamp(),
      grantsAlphaWodAccess: true,
      participant: {isPayer: true},
      commercialTerms: {
        appAccessTier: "limited",
        conditioningBookingPolicy: {
          ...CONDITIONING_BOOKING_POLICY,
          eligibleSlotKeys: [
            ...CONDITIONING_BOOKING_POLICY.eligibleSlotKeys,
          ],
        },
      },
    },
    owner: {
      schemaVersion: MEMBERSHIP_SCHEMA_VERSION,
      subscriptionId: MEMBERSHIP_ID,
      userIdHash: hash(UID),
      state: "active",
      updatedAt: timestamp(),
    },
    profile: {
      role: "user",
      approvalStatus: "approved",
      entitlementStatus: "active",
      entitlementSource: "stripe",
      entitlementPlanKey: "adult_conditioning",
      appAccessTier: "limited",
      entitlementClassSlots: [
        ...CONDITIONING_BOOKING_POLICY.eligibleSlotKeys,
      ],
      entitlementWeeklyBookingLimit: 2,
      alphaWodAccess: true,
      accessSchemaVersion: 3,
      entitlementUpdatedBy: "stripe_membership",
      email: EMAIL,
      waiverAcceptedVersion: CURRENT_WAIVER_VERSION,
      waiverAcceptedAt,
    },
    waiver: {
      acceptanceSchemaVersion: 1,
      userId: UID,
      version: CURRENT_WAIVER_VERSION,
      agreementTitle: CURRENT_WAIVER_TITLE,
      acceptedAt: waiverAcceptedAt,
      acceptedName: "Synthetic Member",
      acceptedEmail: EMAIL,
      acceptedEmailVerified: false,
      acknowledgements: [...CURRENT_WAIVER_ACKNOWLEDGEMENTS],
      mediaConsent: false,
      authenticatedAt: 1,
      signInProvider: "password",
      userAgent: "local-test",
      source: "authenticated_callable",
    },
    expectedJourney,
    classes,
    bookings,
    usageId,
    usage: {
      schemaVersion: 1,
      userId: UID,
      weekKey: expectedJourney.weekKey,
      timezone: "Europe/London",
      weekStartsOn: "monday",
      weeklyBookingLimit: 2,
      bookedCount: 2,
      activeBookingIds,
      subscriptionIds: [MEMBERSHIP_ID],
      createdAt: timestamp(),
      updatedAt: timestamp(),
    },
  };
}

test("post-journey verifier accepts the exact claimed Conditioning sequence", () => {
  const result = assertConditioningAppJourneyState(journeyState());
  assert.equal(result.planKey, "adult_conditioning");
  assert.equal(result.weekKey, "2026-08-31");
  assert.deepEqual(result.activeFixtureLabels, ["Thursday A", "Friday B"]);
  assert.deepEqual(result.cancelledFixtureLabels, ["Friday A"]);
  assert.deepEqual(result.absentFixtureLabels, ["Thursday B"]);
  assert.equal(result.quotaBookedCount, 2);
});

test("post-journey verifier requires the consumed Checkout claim verifier", () => {
  const state = journeyState();
  delete state.membership.checkoutClaimVerifierConsumedAt;
  assert.throws(
    () => assertConditioningAppJourneyState(state),
    /membership is incomplete/
  );
});

test("post-journey verifier rejects full or malformed account access", () => {
  const state = journeyState();
  state.profile.appAccessTier = "full";
  assert.throws(
    () => assertConditioningAppJourneyState(state),
    /limited Conditioning entitlement/
  );
});

test("post-journey verifier requires canonical current waiver evidence", () => {
  const state = journeyState();
  state.waiver.acknowledgements = ["different statement"];
  assert.throws(
    () => assertConditioningAppJourneyState(state),
    /current waiver evidence/
  );
});

test("post-journey verifier proves the third candidate has no booking mutation", () => {
  const state = journeyState();
  const binding = state.bookings.conditioning_browser_thursday_b;
  binding.booking = {
    ...state.bookings.conditioning_browser_thursday_a.booking,
    classId: "conditioning_browser_thursday_b",
  };
  assert.throws(
    () => assertConditioningAppJourneyState(state),
    /rejected third Conditioning candidate/
  );
});

test("post-journey verifier requires cancellation capacity release", () => {
  const state = journeyState();
  state.classes.conditioning_browser_friday_a.bookedCount = 1;
  assert.throws(
    () => assertConditioningAppJourneyState(state),
    /Friday A.*drifted/
  );
});

test("post-journey verifier requires final quota to bind only active bookings", () => {
  const state = journeyState();
  state.usage.activeBookingIds = [
    ...state.usage.activeBookingIds,
    state.bookings.conditioning_browser_friday_a.bookingId,
  ];
  assert.throws(
    () => assertConditioningAppJourneyState(state),
    /weekly quota/
  );
});

test("successful verifier output is PII- and provider-reference-free", () => {
  const result = assertConditioningAppJourneyState(journeyState());
  const output = formatConditioningAppJourneySummary(result).join("\n");
  for (const prohibited of [UID, EMAIL, SESSION_ID, MEMBERSHIP_ID]) {
    assert.equal(output.includes(prohibited), false);
  }
  assert.doesNotMatch(output, /@|cs_test_|sub_/);
  assert.match(output, /Email transport: disabled/);
});
