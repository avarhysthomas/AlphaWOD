/* eslint-disable @typescript-eslint/no-var-requires */

const assert = require("node:assert/strict");
const test = require("node:test");

const {__testing: membershipTesting} = require("../lib/membership");

/**
 * Builds the smallest stored-membership shape needed by reporting helpers.
 * @param {Object} input Membership projection fields.
 * @return {Object} Reporting fixture.
 */
function membershipFixture({
  planKey,
  state,
  participantCount = 1,
  standardMonthlyPence,
  discountedMonthlyPence = null,
  fullPriceFrom = null,
  discount = null,
}) {
  return {
    planKey,
    state,
    participantCount,
    accessRevoked: false,
    disputeOpen: state === "disputed",
    paymentSchedule: {
      amountDueTodayPence: 0,
      firstPaymentAt: 1_000,
      standardMonthlyPence,
      discountedMonthlyPence,
      discountedPaymentCount: discountedMonthlyPence === null ? 0 : 3,
      fullPriceFrom,
    },
    discount,
  };
}

test(
  "admin membership summary separates projected and at-risk recurring income",
  () => {
    const memberships = [
      membershipFixture({
        planKey: "adult_unlimited",
        state: "active",
        standardMonthlyPence: 6_000,
        discountedMonthlyPence: 5_500,
        fullPriceFrom: 2_000,
        discount: {
          amountOffPence: 500,
          endsAt: 2_000,
          duration: "repeating",
        },
      }),
      membershipFixture({
        planKey: "youth_teenstars",
        state: "scheduled",
        participantCount: 2,
        standardMonthlyPence: 7_000,
        discountedMonthlyPence: 5_950,
        discount: {
          amountOffPence: null,
          endsAt: null,
          duration: "forever",
        },
      }),
      membershipFixture({
        planKey: "adult_gym",
        state: "past_due_suspended",
        standardMonthlyPence: 4_500,
      }),
      membershipFixture({
        planKey: "adult_ladies",
        state: "cancelled",
        standardMonthlyPence: 5_000,
      }),
    ];

    const summary = membershipTesting.buildAdminMembershipFinancialSummary(
      memberships,
      1_500
    );

    assert.equal(summary.totalSubscriptions, 4);
    assert.equal(summary.openSubscriptions, 3);
    assert.equal(summary.openParticipants, 4);
    assert.equal(summary.currentSubscriptions, 1);
    assert.equal(summary.scheduledSubscriptions, 1);
    assert.equal(summary.paymentIssueSubscriptions, 1);
    assert.equal(summary.endedSubscriptions, 1);
    assert.equal(summary.projectedMonthlyPence, 11_450);
    assert.equal(summary.atRiskMonthlyPence, 4_500);
    assert.equal(
      summary.plans.find(({planKey}) => planKey === "youth_teenstars")
        .openParticipants,
      2
    );
  }
);

test(
  "admin recurring projection returns to full price after a finite discount",
  () => {
    const membership = membershipFixture({
      planKey: "adult_unlimited",
      state: "active",
      standardMonthlyPence: 6_000,
      discountedMonthlyPence: 5_500,
      fullPriceFrom: 2_000,
      discount: {
        amountOffPence: 500,
        endsAt: 2_000,
        duration: "repeating",
      },
    });

    assert.deepEqual(
      membershipTesting.adminMembershipFinancialProjectionFor(
        membership,
        2_500
      ),
      {monthlyRecurringPence: 6_000, revenueState: "projected"}
    );
  }
);

