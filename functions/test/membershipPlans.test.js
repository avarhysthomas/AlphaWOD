/* eslint-disable @typescript-eslint/no-var-requires, max-len, valid-jsdoc */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BILLING_POLICY,
  CHECKOUT_ANCHOR_MARGIN_SECONDS,
  CHECKOUT_CREATION_MARGIN_SECONDS,
  CHECKOUT_DOCUMENT_CONTENT_BUDGET_BYTES,
  CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION,
  CHECKOUT_DOCUMENTS,
  EXISTING_MEMBER_OFFER,
  SUPPORTED_YOUTH_FAMILY_DISCOUNT_PERCENTAGES,
  YOUTH_FAMILY_OFFER,
  MEMBERSHIP_SCHEMA_VERSION,
  MEMBERSHIP_PLANS,
  PLAN_KEYS,
  PRESALE_CHECKOUT_ANCHOR_MARGIN_SECONDS,
  PRESALE_BILLING_ANCHOR_AT_ISO,
  PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
  PRESALE_SIGNUP_CUTOFF_AT_ISO,
  PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS,
  isAgeEligibleForPlan,
  isMembershipStateBlockingDuplicate,
  isMembershipStateEntitled,
  isPlanKey,
  isSupportedYouthFamilyDiscountPercent,
  isWithinPastDueGrace,
  resolveAgeFromDateOfBirth,
  resolveBillingCycleAnchor,
  resolveCheckoutBillingPolicy,
  resolveCancellationOutcome,
  resolveCheckoutSessionExpiry,
  resolveCoolingOffEnd,
  resolveEntitlementForMembership,
  resolveMembershipState,
  resolvePastDueGraceEndMillis,
  resolveYouthPlanForAge,
  formatPence,
  formatBillingDate,
  formatUnixBillingDate,
  formatUnixBillingIsoDate,
  createCommercialPlanSnapshot,
  resolveCheckoutAcceptanceStatements,
  resolveCheckoutDocuments,
  resolveCheckoutSignerRole,
} = require("../lib/membershipPlans");

/** Europe/London instant helper: builds a UTC millis value for a London date. */
function londonMillis(iso) {
  return new Date(iso).getTime();
}

test("schema v4 catalogue keeps the youth keys, new copy, and approved prices", () => {
  assert.equal(MEMBERSHIP_SCHEMA_VERSION, 4);
  assert.deepEqual([...PLAN_KEYS], [
    "adult_unlimited",
    "adult_ladies",
    "adult_gym",
    "youth_youngstars",
    "youth_teenstars",
  ]);

  assert.equal(MEMBERSHIP_PLANS.adult_unlimited.amountPence, 6000);
  assert.equal(MEMBERSHIP_PLANS.adult_ladies.amountPence, 5000);
  assert.equal(MEMBERSHIP_PLANS.adult_gym.amountPence, 4500);
  assert.deepEqual(
    {
      key: MEMBERSHIP_PLANS.youth_youngstars.key,
      name: MEMBERSHIP_PLANS.youth_youngstars.name,
      amountPence: MEMBERSHIP_PLANS.youth_youngstars.amountPence,
      minAge: MEMBERSHIP_PLANS.youth_youngstars.minAge,
      maxAge: MEMBERSHIP_PLANS.youth_youngstars.maxAge,
      summary: MEMBERSHIP_PLANS.youth_youngstars.summary,
    },
    {
      key: "youth_youngstars",
      name: "Mini Alphas",
      amountPence: 3000,
      minAge: 0,
      maxAge: 10,
      summary: "A strength and conditioning class for 10 and under! Fun, progressive, and challenging.",
    }
  );
  assert.deepEqual(
    {
      key: MEMBERSHIP_PLANS.youth_teenstars.key,
      name: MEMBERSHIP_PLANS.youth_teenstars.name,
      amountPence: MEMBERSHIP_PLANS.youth_teenstars.amountPence,
      minAge: MEMBERSHIP_PLANS.youth_teenstars.minAge,
      maxAge: MEMBERSHIP_PLANS.youth_teenstars.maxAge,
      summary: MEMBERSHIP_PLANS.youth_teenstars.summary,
    },
    {
      key: "youth_teenstars",
      name: "Teen Alphas",
      amountPence: 3500,
      minAge: 11,
      maxAge: null,
      summary: "Strength and conditioning for 11 and up! Develop athletic qualities in a supportive environment.",
    }
  );
});

test("only Adult Unlimited automatically includes AlphaWOD access", () => {
  const granting = PLAN_KEYS.filter((key) => MEMBERSHIP_PLANS[key].grantsAlphaWodAccess);
  assert.deepEqual(granting, ["adult_unlimited"]);
});

test("registry freezes the approved mixed checkout document bundle", () => {
  assert.equal(CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION, true);
  assert.deepEqual(
    Object.fromEntries(Object.entries(CHECKOUT_DOCUMENTS).map(
      ([key, document]) => [key, [document.version, document.effectiveDate]]
    )),
    {
      membershipTerms: ["ZAF-TERMS-2026-08-25-02", "2026-08-25"],
      cancellationPolicy: ["ZAF-CANCEL-2026-08-23-01", "2026-08-23"],
      privacyNotice: ["ZAF-PRIVACY-2026-08-25-01", "2026-08-25"],
      adultWaiver: ["ZAF-ADULT-WAIVER-2026-08-23-01", "2026-08-23"],
      guardianAddendum: ["ZAF-GUARDIAN-2026-08-25-02", "2026-08-25"],
    }
  );
  for (const document of Object.values(CHECKOUT_DOCUMENTS)) {
    assert.match(document.sha256, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(document), /\b(?:DRAFT|PENDING)\b/i);
  }
});

test("canonical checkout documents stay within the outbox byte budget", () => {
  const bytes = Object.values(CHECKOUT_DOCUMENTS).reduce(
    (total, document) => total + Buffer.byteLength(document.content, "utf8"),
    0
  );
  assert.ok(bytes > 0);
  assert.ok(
    bytes <= CHECKOUT_DOCUMENT_CONTENT_BUDGET_BYTES,
    `${bytes} canonical document bytes exceed the ${CHECKOUT_DOCUMENT_CONTENT_BUDGET_BYTES}-byte budget`
  );
});

test("checkout legal requirements are exact for adult self-signers and youth guardians", () => {
  assert.deepEqual(
    resolveCheckoutDocuments("adult_unlimited").map(({key}) => key),
    ["membershipTerms", "cancellationPolicy", "privacyNotice", "adultWaiver"]
  );
  assert.deepEqual(
    resolveCheckoutAcceptanceStatements("adult_unlimited").map(({id}) => id),
    [
      "membership_contract", "privacy_notice", "adult_participant_waiver",
      "recurring_payment_authority", "immediate_performance",
    ]
  );
  assert.equal(
    resolveCheckoutSignerRole("adult_unlimited"),
    "adult_participant_and_payer"
  );
  assert.deepEqual(
    resolveCheckoutDocuments("youth_youngstars").map(({key}) => key),
    ["membershipTerms", "cancellationPolicy", "privacyNotice", "guardianAddendum"]
  );
  assert.deepEqual(
    resolveCheckoutAcceptanceStatements("youth_youngstars").map(({id}) => id),
    [
      "membership_contract", "privacy_notice", "guardian_authority",
      "guardian_youth_addendum", "recurring_payment_authority",
      "immediate_performance",
    ]
  );
});

test("commercial snapshots contain the complete customer-facing plan contract", () => {
  assert.deepEqual(createCommercialPlanSnapshot("adult_unlimited"), {
    catalogueSchemaVersion: 4,
    planKey: "adult_unlimited",
    planName: "Adult Unlimited Membership",
    audience: "adult",
    summary: MEMBERSHIP_PLANS.adult_unlimited.summary,
    amountPence: 6000,
    currency: "gbp",
    billingInterval: "month",
    billingIntervalCount: 1,
    monthlyAnchorDayOfMonth: 1,
    joiningFeePence: 0,
    minimumTermMonths: 0,
    trialDays: 0,
    vatRegistered: false,
    automaticTaxEnabled: false,
    grantsAlphaWodAccess: true,
    minAge: 18,
    maxAge: null,
    cancellationNoticeDays: 14,
    pauseAllowed: false,
  });
});

test("past-due grace persists an exact London-calendar deadline across DST", () => {
  // Failure is on the Saturday before the UK clocks move back. Three calendar
  // days of grace end at the final millisecond of Tuesday in Europe/London.
  const failedAt = Math.floor(new Date("2026-10-24T10:00:00Z").getTime() / 1000);
  const graceEnd = resolvePastDueGraceEndMillis(failedAt);

  assert.equal(
    new Date(graceEnd).toISOString(),
    "2026-10-27T23:59:59.999Z"
  );
  assert.equal(isWithinPastDueGrace(failedAt, graceEnd), true);
  assert.equal(isWithinPastDueGrace(failedAt, graceEnd + 1), false);
});

test("youth routing recommends Mini Alphas through 10 and Teen Alphas from 11", () => {
  assert.equal(resolveYouthPlanForAge(-1), null);
  assert.equal(resolveYouthPlanForAge(0), "youth_youngstars");
  assert.equal(resolveYouthPlanForAge(10), "youth_youngstars");
  assert.equal(resolveYouthPlanForAge(11), "youth_teenstars");
  assert.equal(resolveYouthPlanForAge(120), "youth_teenstars");
  assert.equal(resolveYouthPlanForAge(10.5), null);
});

test("multi-child youth acceptance freezes the full recurring family price", () => {
  assert.equal(YOUTH_FAMILY_OFFER.minimumParticipants, 2);
  assert.equal(YOUTH_FAMILY_OFFER.percentOff, 10);
  assert.equal(YOUTH_FAMILY_OFFER.maximumParticipants, 10);
  const youngstars = resolveCheckoutAcceptanceStatements("youth_youngstars", 2)
    .find(({id}) => id === "recurring_payment_authority").statement;
  const teenstars = resolveCheckoutAcceptanceStatements("youth_teenstars", 3)
    .find(({id}) => id === "recurring_payment_authority").statement;
  assert.match(youngstars, /standard total is £60\.00 per month/i);
  assert.match(youngstars, /automatic 10% family discount/i);
  assert.match(youngstars, /recurring total £54\.00/i);
  assert.match(teenstars, /standard total is £105\.00 per month/i);
  assert.match(teenstars, /recurring total £94\.50/i);
});

test("only the current 10% and frozen legacy 15% family policies are supported", () => {
  assert.deepEqual([...SUPPORTED_YOUTH_FAMILY_DISCOUNT_PERCENTAGES], [10, 15]);
  assert.equal(isSupportedYouthFamilyDiscountPercent(10), true);
  assert.equal(isSupportedYouthFamilyDiscountPercent(15), true);
  assert.equal(isSupportedYouthFamilyDiscountPercent(12), false);
  assert.equal(isSupportedYouthFamilyDiscountPercent("15"), false);
});

test("adult plans require 18 while youth plans accept any valid nonnegative age", () => {
  assert.equal(isAgeEligibleForPlan(MEMBERSHIP_PLANS.adult_unlimited, 17), false);
  assert.equal(isAgeEligibleForPlan(MEMBERSHIP_PLANS.adult_unlimited, 18), true);
  assert.equal(isAgeEligibleForPlan(MEMBERSHIP_PLANS.adult_unlimited, 92), true);
  assert.equal(isAgeEligibleForPlan(MEMBERSHIP_PLANS.youth_youngstars, 17), true);
  assert.equal(isAgeEligibleForPlan(MEMBERSHIP_PLANS.youth_teenstars, 6), true);
  assert.equal(isAgeEligibleForPlan(MEMBERSHIP_PLANS.youth_youngstars, -1), false);
  assert.equal(isAgeEligibleForPlan(MEMBERSHIP_PLANS.youth_teenstars, 6.5), false);
  assert.equal(isPlanKey("commercial"), false);
});

test("billing cycle anchors on the first of the next calendar month", () => {
  const anchor = resolveBillingCycleAnchor(londonMillis("2026-08-18T09:30:00Z"));
  assert.equal(anchor.firstFullChargeDate, "2026-09-01");

  // Stripe remains on UTC day 1 even while the UK is on British Summer Time.
  assert.equal(
    new Date(anchor.anchorUnixSeconds * 1000).toISOString(),
    "2026-09-01T00:00:00.000Z"
  );
});

test("UTC day-one anchors do not drift to month-end across UK clock changes", () => {
  const summer = resolveBillingCycleAnchor(londonMillis("2026-06-30T22:30:00Z"));
  assert.equal(summer.firstFullChargeDate, "2026-07-01");
  assert.equal(
    new Date(summer.anchorUnixSeconds * 1000).toISOString(),
    "2026-07-01T00:00:00.000Z"
  );

  const localMonthCrossover = resolveBillingCycleAnchor(londonMillis("2026-08-31T23:30:00Z"));
  assert.equal(localMonthCrossover.firstFullChargeDate, "2026-10-01");
  assert.equal(
    new Date(localMonthCrossover.anchorUnixSeconds * 1000).toISOString(),
    "2026-10-01T00:00:00.000Z"
  );

  const afterClockChange = resolveBillingCycleAnchor(londonMillis("2026-10-31T23:30:00Z"));
  assert.equal(afterClockChange.firstFullChargeDate, "2026-11-01");
  assert.equal(
    new Date(afterClockChange.anchorUnixSeconds * 1000).toISOString(),
    "2026-11-01T00:00:00.000Z"
  );
});

test("billing anchor stays in the future when joining on the first", () => {
  const anchor = resolveBillingCycleAnchor(londonMillis("2026-09-01T00:00:00Z"));
  assert.equal(anchor.firstFullChargeDate, "2026-10-01");
});

test("winter anchor lands at midnight UTC when London is on GMT", () => {
  const anchor = resolveBillingCycleAnchor(londonMillis("2026-12-09T12:00:00Z"));
  assert.equal(anchor.firstFullChargeDate, "2027-01-01");
  assert.equal(
    new Date(anchor.anchorUnixSeconds * 1000).toISOString(),
    "2027-01-01T00:00:00.000Z"
  );
});

test("presale freezes £0 today, local opening and the UTC first-payment anchor", () => {
  assert.equal(PRESALE_SIGNUP_CUTOFF_AT_ISO, "2026-08-31T23:00:00.000Z");
  assert.equal(PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS, 1788217200);
  assert.equal(PRESALE_BILLING_ANCHOR_AT_ISO, "2026-09-01T00:00:00.000Z");
  assert.equal(PRESALE_BILLING_ANCHOR_UNIX_SECONDS, 1788220800);

  assert.deepEqual(
    resolveCheckoutBillingPolicy(londonMillis("2026-08-19T12:00:00Z")),
    {
      kind: "presale",
      billingMode: "presale_deferred",
      billingCycleAnchor: 1788220800,
      firstFullChargeDate: "2026-09-01",
      serviceStartsAtUnixSeconds: 1788217200,
      firstPaymentAtUnixSeconds: 1788220800,
      prorationBehavior: "none",
      paymentDueToday: false,
    }
  );
});

test("standard immediate proration resumes at local opening midnight", () => {
  const cutoffMillis = PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS * 1000;
  const policy = resolveCheckoutBillingPolicy(cutoffMillis);

  assert.equal(policy.kind, "standard");
  assert.equal(policy.billingMode, "standard");
  assert.equal(policy.firstFullChargeDate, "2026-10-01");
  assert.equal(policy.billingCycleAnchor, 1790812800);
  assert.equal(policy.serviceStartsAtUnixSeconds, PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS);
  assert.equal(policy.firstPaymentAtUnixSeconds, PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS);
  assert.equal(policy.prorationBehavior, "create_prorations");
  assert.equal(policy.paymentDueToday, true);
});

test("existing-member offer is fixed to Adult Unlimited and three £5 discounts", () => {
  assert.deepEqual(EXISTING_MEMBER_OFFER, {
    planKey: "adult_unlimited",
    amountOffPence: 500,
    currency: "gbp",
    durationMonths: 3,
    redemptionClosesAtUnixSeconds: 1788217200,
    promotionCodeExpiresAtUnixSeconds: null,
  });
});

test("a checkout session never outlives the anchor it was created against", () => {
  const now = londonMillis("2026-08-31T20:00:00Z");
  const expiry = resolveCheckoutSessionExpiry(now);
  const {anchorUnixSeconds} = resolveBillingCycleAnchor(now);

  assert.ok(expiry < anchorUnixSeconds, "expiry must precede the anchor");
  assert.equal(anchorUnixSeconds - expiry, PRESALE_CHECKOUT_ANCHOR_MARGIN_SECONDS);
  assert.ok(
    expiry >= Math.floor(now / 1000) + 1800 + CHECKOUT_CREATION_MARGIN_SECONDS,
    "expiry must preserve Stripe's floor after network/clock delay"
  );
});

test("standard checkout fails closed when the Stripe minimum cannot fit before its anchor margin", () => {
  // 23:25:01 London leaves 34m59s before the one-hour anchor margin. That is
  // below Stripe's 30-minute floor plus the five-minute creation allowance.
  const tooLate = londonMillis("2026-09-30T22:25:01Z");
  assert.throws(
    () => resolveCheckoutSessionExpiry(tooLate),
    /monthly billing boundary/i
  );
});

test("standard checkout permits the exact safe boundary but never reaches the anchor", () => {
  const lastSafeInstant = londonMillis("2026-09-30T22:25:00Z");
  const expiry = resolveCheckoutSessionExpiry(lastSafeInstant);
  const anchorUnixSeconds = resolveCheckoutBillingPolicy(lastSafeInstant).billingCycleAnchor;

  assert.equal(
    expiry,
    Math.floor(lastSafeInstant / 1000) + 30 * 60 +
      CHECKOUT_CREATION_MARGIN_SECONDS
  );
  assert.equal(anchorUnixSeconds - expiry, CHECKOUT_ANCHOR_MARGIN_SECONDS);
  assert.ok(expiry < anchorUnixSeconds);
});

test("a presale intent can start one second before cutoff and finish before billing", () => {
  const lastPresaleInstant = PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS * 1000 - 1000;
  const policy = resolveCheckoutBillingPolicy(lastPresaleInstant);
  const expiry = resolveCheckoutSessionExpiry(lastPresaleInstant);

  assert.equal(policy.kind, "presale");
  assert.equal(expiry, PRESALE_BILLING_ANCHOR_UNIX_SECONDS -
    PRESALE_CHECKOUT_ANCHOR_MARGIN_SECONDS);
  assert.ok(
    expiry >= Math.floor(lastPresaleInstant / 1000) + 30 * 60 +
      CHECKOUT_CREATION_MARGIN_SECONDS
  );
  assert.ok(expiry < PRESALE_BILLING_ANCHOR_UNIX_SECONDS);
});

test("the exact local opening cutoff switches new sessions to standard billing", () => {
  const cutoffMillis = PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS * 1000;
  const policy = resolveCheckoutBillingPolicy(cutoffMillis);
  const expiry = resolveCheckoutSessionExpiry(cutoffMillis);

  assert.equal(policy.kind, "standard");
  assert.equal(policy.billingCycleAnchor, 1790812800);
  assert.equal(expiry, PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS + 24 * 60 * 60);
});

test("a checkout session is capped at Stripe's 24 hour maximum", () => {
  const now = londonMillis("2026-08-05T10:00:00Z");
  const expiry = resolveCheckoutSessionExpiry(now);
  assert.equal(expiry, Math.floor(now / 1000) + 24 * 3600);
});

test("cancellation worked example: 18 May is on time for 1 June", () => {
  const outcome = resolveCancellationOutcome(londonMillis("2027-05-18T10:00:00Z"));

  assert.equal(outcome.nextBillingDate, "2027-06-01");
  assert.equal(outcome.noticeDaysGiven, 14);
  assert.equal(outcome.noticeDeadlineMet, true);
  assert.equal(outcome.finalPaymentDate, null);
  assert.equal(outcome.accessEndsOnDate, "2027-05-31");
});

test("cancellation worked example: 19 May is late for 1 June", () => {
  const outcome = resolveCancellationOutcome(londonMillis("2027-05-19T10:00:00Z"));

  assert.equal(outcome.nextBillingDate, "2027-06-01");
  assert.equal(outcome.noticeDaysGiven, 13);
  assert.equal(outcome.noticeDeadlineMet, false);
  assert.equal(outcome.finalPaymentDate, "2027-06-01");
  assert.equal(outcome.accessEndsOnDate, "2027-06-30");
});

test("a late request cancels only after the extra paid month", () => {
  const outcome = resolveCancellationOutcome(londonMillis("2027-05-19T10:00:00Z"));
  assert.equal(
    new Date(outcome.cancelAtUnixSeconds * 1000).toISOString(),
    "2027-06-30T23:00:00.000Z" // 1 July 2027 00:00 London (BST)
  );
});

test("the notice deadline is reported so the flow can show it before submission", () => {
  const outcome = resolveCancellationOutcome(londonMillis("2027-05-19T10:00:00Z"));
  assert.equal(outcome.noticeDeadlineDate, "2027-05-18");
  assert.equal(BILLING_POLICY.cancellationNoticeDays, 14);
});

test("a request late on the deadline day still counts as on time", () => {
  // The rule counts calendar days, so the time of day cannot lose a day.
  const outcome = resolveCancellationOutcome(londonMillis("2027-05-18T22:59:00Z"));
  assert.equal(outcome.noticeDeadlineMet, true);
});

test("February and leap years keep the first-of-month anchor", () => {
  const outcome = resolveCancellationOutcome(londonMillis("2028-01-18T10:00:00Z"));
  assert.equal(outcome.nextBillingDate, "2028-02-01");
  assert.equal(outcome.noticeDeadlineMet, true);
  assert.equal(outcome.accessEndsOnDate, "2028-01-31");

  const leap = resolveCancellationOutcome(londonMillis("2028-02-20T10:00:00Z"));
  assert.equal(leap.nextBillingDate, "2028-03-01");
  assert.equal(leap.noticeDeadlineMet, false);
  assert.equal(leap.accessEndsOnDate, "2028-03-31");
});

test("cooling-off runs to the end of the fourteenth day after the contract", () => {
  const end = resolveCoolingOffEnd(londonMillis("2026-08-18T09:00:00Z"));
  assert.match(end, /^2026-09-01T23:59:59/);
});

test("past-due grace lasts three calendar days from the failed due date", () => {
  const dueDate = Math.floor(londonMillis("2026-09-01T00:00:00Z") / 1000);

  assert.equal(isWithinPastDueGrace(dueDate, londonMillis("2026-09-01T12:00:00Z")), true);
  assert.equal(isWithinPastDueGrace(dueDate, londonMillis("2026-09-04T21:00:00Z")), true);
  assert.equal(isWithinPastDueGrace(dueDate, londonMillis("2026-09-05T09:00:00Z")), false);
});

test("membership state reduces Stripe status per the approved policy", () => {
  const now = londonMillis("2026-09-10T10:00:00Z");
  const recentFailure = Math.floor(londonMillis("2026-09-09T00:00:00Z") / 1000);
  const oldFailure = Math.floor(londonMillis("2026-09-01T00:00:00Z") / 1000);

  assert.equal(resolveMembershipState({stripeStatus: "active"}, now), "active");
  assert.equal(
    resolveMembershipState({stripeStatus: "past_due", pastDueSinceUnixSeconds: recentFailure}, now),
    "past_due_grace"
  );
  assert.equal(
    resolveMembershipState({stripeStatus: "past_due", pastDueSinceUnixSeconds: oldFailure}, now),
    "past_due_suspended"
  );
  assert.equal(resolveMembershipState({stripeStatus: "unpaid"}, now), "past_due_suspended");
  assert.equal(resolveMembershipState({stripeStatus: "canceled"}, now), "cancelled");
  assert.equal(resolveMembershipState({stripeStatus: "incomplete"}, now), "incomplete");
});

test("presale stays scheduled until service time and first-payment proof", () => {
  const beforeService = PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS * 1000 - 1;
  const afterFirstPayment = PRESALE_BILLING_ANCHOR_UNIX_SECONDS * 1000 + 1;

  assert.equal(resolveMembershipState({
    stripeStatus: "active",
    serviceStartsAtUnixSeconds: PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS,
  }, beforeService), "scheduled");
  assert.equal(resolveMembershipState({
    stripeStatus: "active",
    serviceStartsAtUnixSeconds: PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS,
    activationPendingFirstPayment: true,
  }, afterFirstPayment), "scheduled");
  assert.equal(resolveMembershipState({
    stripeStatus: "active",
    serviceStartsAtUnixSeconds: PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS,
    activationPendingFirstPayment: false,
  }, afterFirstPayment), "active");
  assert.equal(resolveMembershipState({
    stripeStatus: "past_due",
    pastDueSinceUnixSeconds: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
    activationPendingFirstPayment: true,
  }, afterFirstPayment), "past_due_suspended");
});

test("an open dispute suspends and a lost dispute or full refund revokes", () => {
  const now = londonMillis("2026-09-10T10:00:00Z");

  assert.equal(
    resolveMembershipState({stripeStatus: "active", disputeOpen: true}, now),
    "disputed"
  );
  assert.equal(
    resolveMembershipState({stripeStatus: "active", accessRevoked: true}, now),
    "revoked"
  );
  // Revocation outranks an open dispute so a lost dispute cannot be softened.
  assert.equal(
    resolveMembershipState(
      {stripeStatus: "active", disputeOpen: true, accessRevoked: true},
      now
    ),
    "revoked"
  );
});

test("entitlement follows membership state for the AlphaWOD plan only", () => {
  assert.deepEqual(resolveEntitlementForMembership("adult_unlimited", "active"), {
    entitlementStatus: "active",
    entitlementSource: "stripe",
    reason: "membership_active",
  });
  assert.deepEqual(resolveEntitlementForMembership("adult_unlimited", "past_due_grace"), {
    entitlementStatus: "active",
    entitlementSource: "stripe",
    reason: "membership_past_due_grace",
  });
  assert.equal(
    resolveEntitlementForMembership("adult_unlimited", "disputed").entitlementStatus,
    "restricted"
  );
  assert.equal(
    resolveEntitlementForMembership("adult_unlimited", "revoked").entitlementStatus,
    "none"
  );

  // Plans without app access must never move a member's entitlement.
  for (const key of ["adult_ladies", "adult_gym", "youth_youngstars", "youth_teenstars"]) {
    assert.equal(resolveEntitlementForMembership(key, "active"), null);
    assert.equal(resolveEntitlementForMembership(key, "revoked"), null);
  }
});

test("entitled and duplicate-blocking states are distinct sets", () => {
  assert.equal(isMembershipStateEntitled("scheduled"), false);
  assert.equal(isMembershipStateBlockingDuplicate("scheduled"), true);
  assert.equal(resolveEntitlementForMembership("adult_unlimited", "scheduled"), null);
  assert.equal(isMembershipStateEntitled("past_due_suspended"), false);
  assert.equal(isMembershipStateBlockingDuplicate("past_due_suspended"), true);
  assert.equal(isMembershipStateBlockingDuplicate("cancelled"), false);
  assert.equal(isMembershipStateBlockingDuplicate("revoked"), false);
});

test("age is derived from the date of birth in London", () => {
  const now = londonMillis("2026-08-18T10:00:00Z");

  assert.equal(resolveAgeFromDateOfBirth("2008-08-18", now), 18);
  assert.equal(resolveAgeFromDateOfBirth("2008-08-19", now), 17);
  assert.equal(resolveAgeFromDateOfBirth("2014-08-19", now), 11);
  assert.equal(resolveAgeFromDateOfBirth("2027-01-01", now), null);
  assert.equal(resolveAgeFromDateOfBirth("18-08-2008", now), null);
  assert.equal(resolveAgeFromDateOfBirth("2008-02-30", now), null);
});

test("confirmation amounts always render two decimal places", () => {
  // These appear in the durable confirmation email, so a stray "£60" or a
  // floating point tail would be a customer-facing money error.
  assert.equal(formatPence(6000), "£60.00");
  assert.equal(formatPence(3500), "£35.00");
  assert.equal(formatPence(2903), "£29.03");
  assert.equal(formatPence(1), "£0.01");
  assert.equal(formatPence(0), "£0.00");
});

test("confirmation dates render in London regardless of server timezone", () => {
  assert.equal(formatBillingDate("2026-09-01"), "1 September 2026");
  assert.equal(formatBillingDate("2027-01-01"), "1 January 2027");

  // The provider timestamp is UTC midnight (01:00 London during BST); the
  // customer-facing billing date remains the 1st.
  const bstAnchor = resolveBillingCycleAnchor(new Date("2026-08-18T09:30:00Z").getTime());
  assert.equal(formatUnixBillingDate(bstAnchor.anchorUnixSeconds), "1 September 2026");
  assert.equal(formatUnixBillingIsoDate(bstAnchor.anchorUnixSeconds), "2026-09-01");

  const gmtAnchor = resolveBillingCycleAnchor(new Date("2026-12-09T12:00:00Z").getTime());
  assert.equal(formatUnixBillingDate(gmtAnchor.anchorUnixSeconds), "1 January 2027");
  assert.equal(formatUnixBillingIsoDate(gmtAnchor.anchorUnixSeconds), "2027-01-01");
});
