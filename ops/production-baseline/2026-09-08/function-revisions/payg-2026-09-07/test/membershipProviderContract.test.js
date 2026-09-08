/* eslint-disable @typescript-eslint/no-var-requires, require-jsdoc, max-len */

const test = require("node:test");
const assert = require("node:assert/strict");
process.env.FUNCTIONS_EMULATOR = "true";
const {__testing} = require("../lib/membership");
const {
  CONDITIONING_BOOKING_POLICY,
  createCommercialPlanSnapshot,
} = require("../lib/membershipPlans");

function subscription(metadata) {
  return {
    id: "sub_conditioning_policy",
    collection_method: "charge_automatically",
    pause_collection: null,
    status: "active",
    trial_start: null,
    trial_end: null,
    metadata,
    customer: "cus_conditioning_policy",
    billing_cycle_anchor: 1788220800,
    items: {
      data: [{price: "price_conditioning", quantity: 1}],
    },
  };
}

const expected = {
  planKey: "adult_conditioning",
  stripePriceId: "price_conditioning",
  stripeCustomerId: "cus_conditioning_policy",
  billingCycleAnchor: 1788220800,
  appAccessTier: "limited",
  conditioningBookingPolicy: CONDITIONING_BOOKING_POLICY,
};

const exactMetadata = {
  planKey: "adult_conditioning",
  appAccessTier: "limited",
  conditioningPolicyVersion: "1",
  conditioningWeeklyLimit: "2",
  conditioningEligibleSlots:
    "monday_0600,tuesday_1800,thursday_1800,friday_0530",
};

test("Stripe subscription contract freezes the exact flexible Conditioning policy", () => {
  assert.equal(
    __testing.stripeSubscriptionContractMismatch(
      subscription(exactMetadata),
      expected
    ),
    null
  );
  for (const metadata of [
    {...exactMetadata, conditioningPolicyVersion: "2"},
    {...exactMetadata, conditioningWeeklyLimit: "3"},
    {...exactMetadata, conditioningEligibleSlots:
      "tuesday_1800,monday_0600,thursday_1800,friday_0530"},
    {...exactMetadata, conditioningSlots: "monday_0600,tuesday_1800"},
    {...exactMetadata, conditioningEligibleSlots: undefined},
  ]) {
    assert.match(
      __testing.stripeSubscriptionContractMismatch(
        subscription(metadata),
        expected
      ),
      /different conditioning booking policy/i
    );
  }
});

test("safe projections expose selected slots only for historical schema v6", () => {
  const current = createCommercialPlanSnapshot("adult_conditioning");
  assert.deepEqual(
    __testing.conditioningEntitlementProjection(
      current,
      "adult_conditioning"
    ),
    {
      conditioningBookingPolicy: CONDITIONING_BOOKING_POLICY,
      entitlementClassSlots: CONDITIONING_BOOKING_POLICY.eligibleSlotKeys,
      entitlementWeeklyBookingLimit: 2,
    }
  );

  const legacy = {
    ...current,
    catalogueSchemaVersion: 6,
    selectedConditioningSlots: ["monday_0600", "friday_0530"],
  };
  delete legacy.conditioningBookingPolicy;
  assert.deepEqual(
    __testing.conditioningEntitlementProjection(
      legacy,
      "adult_conditioning"
    ),
    {
      conditioningBookingPolicy: null,
      entitlementClassSlots: ["monday_0600", "friday_0530"],
      entitlementWeeklyBookingLimit: null,
      selectedConditioningSlots: ["monday_0600", "friday_0530"],
    }
  );
});
