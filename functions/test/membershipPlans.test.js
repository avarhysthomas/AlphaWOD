/* eslint-disable @typescript-eslint/no-var-requires, max-len, valid-jsdoc */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BILLING_POLICY,
  CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION,
  MEMBERSHIP_PLANS,
  PLAN_KEYS,
  isAgeEligibleForPlan,
  isMembershipStateBlockingDuplicate,
  isMembershipStateEntitled,
  isPlanKey,
  isWithinPastDueGrace,
  resolveAgeFromDateOfBirth,
  resolveBillingCycleAnchor,
  resolveCancellationOutcome,
  resolveCheckoutSessionExpiry,
  resolveCoolingOffEnd,
  resolveEntitlementForMembership,
  resolveMembershipState,
  resolveYouthPlanForAge,
  formatPence,
  formatBillingDate,
  formatUnixBillingDate,
} = require("../lib/membershipPlans");

/** Europe/London instant helper: builds a UTC millis value for a London date. */
function londonMillis(iso) {
  return new Date(iso).getTime();
}

test("catalogue matches the approved public price list", () => {
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
  assert.equal(MEMBERSHIP_PLANS.youth_youngstars.amountPence, 3500);
  assert.equal(MEMBERSHIP_PLANS.youth_teenstars.amountPence, 3500);
});

test("only Adult Unlimited automatically includes AlphaWOD access", () => {
  const granting = PLAN_KEYS.filter((key) => MEMBERSHIP_PLANS[key].grantsAlphaWodAccess);
  assert.deepEqual(granting, ["adult_unlimited"]);
});

test("purchase stays closed while the checkout documents are drafts", () => {
  assert.equal(CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION, false);
});

test("youth age routing follows the approved boundaries", () => {
  assert.equal(resolveYouthPlanForAge(3), null);
  assert.equal(resolveYouthPlanForAge(4), "youth_youngstars");
  assert.equal(resolveYouthPlanForAge(11), "youth_youngstars");
  assert.equal(resolveYouthPlanForAge(12), "youth_teenstars");
  assert.equal(resolveYouthPlanForAge(16), "youth_teenstars");
  assert.equal(resolveYouthPlanForAge(17), null);
});

test("adult plans require 18 and youth plans are bounded at both ends", () => {
  assert.equal(isAgeEligibleForPlan(MEMBERSHIP_PLANS.adult_unlimited, 17), false);
  assert.equal(isAgeEligibleForPlan(MEMBERSHIP_PLANS.adult_unlimited, 18), true);
  assert.equal(isAgeEligibleForPlan(MEMBERSHIP_PLANS.youth_youngstars, 12), false);
  assert.equal(isAgeEligibleForPlan(MEMBERSHIP_PLANS.youth_teenstars, 17), false);
  assert.equal(isPlanKey("commercial"), false);
});

test("billing cycle anchors on the first of the next calendar month", () => {
  const anchor = resolveBillingCycleAnchor(londonMillis("2026-08-18T09:30:00Z"));
  assert.equal(anchor.firstFullChargeDate, "2026-09-01");

  // British Summer Time: 1 September 2026 00:00 London is 23:00 UTC on 31 Aug.
  assert.equal(
    new Date(anchor.anchorUnixSeconds * 1000).toISOString(),
    "2026-08-31T23:00:00.000Z"
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

test("a checkout session never outlives the anchor it was created against", () => {
  const now = londonMillis("2026-08-31T20:00:00Z");
  const expiry = resolveCheckoutSessionExpiry(now);
  const {anchorUnixSeconds} = resolveBillingCycleAnchor(now);

  assert.ok(expiry < anchorUnixSeconds, "expiry must precede the anchor");
  assert.ok(expiry >= Math.floor(now / 1000) + 1800, "expiry must respect Stripe's 30 minute floor");
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

  // 1 September 2026 00:00 London is 23:00 UTC on 31 August during BST; the
  // date shown must still be the 1st.
  const bstAnchor = resolveBillingCycleAnchor(new Date("2026-08-18T09:30:00Z").getTime());
  assert.equal(formatUnixBillingDate(bstAnchor.anchorUnixSeconds), "1 September 2026");

  const gmtAnchor = resolveBillingCycleAnchor(new Date("2026-12-09T12:00:00Z").getTime());
  assert.equal(formatUnixBillingDate(gmtAnchor.anchorUnixSeconds), "1 January 2027");
});
