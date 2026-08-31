/* eslint-disable @typescript-eslint/no-var-requires, require-jsdoc */

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  assertConditioningContract,
  isLocalSuccessUrl,
} = require("../scripts/verifyStripeTestJourney");
const {
  CONDITIONING_BOOKING_POLICY,
} = require("../lib/membershipPlans");

const expectedPolicy = {
  ...CONDITIONING_BOOKING_POLICY,
  eligibleSlotKeys: [...CONDITIONING_BOOKING_POLICY.eligibleSlotKeys],
};
const metadata = {
  planKey: "adult_conditioning",
  appAccessTier: "limited",
  conditioningPolicyVersion: "1",
  conditioningWeeklyLimit: "2",
  conditioningEligibleSlots:
    "monday_0600,tuesday_1800,thursday_1800,friday_0530",
};

function snapshot(fields) {
  return {
    get(path) {
      return path.split(".").reduce((value, key) => value?.[key], fields);
    },
  };
}

function persistedCommercialTerms(overrides = {}) {
  return {
    planKey: "adult_conditioning",
    planName: "Adult Conditioning Only Membership",
    amountPence: 3000,
    appAccessTier: "limited",
    conditioningBookingPolicy: {
      ...expectedPolicy,
      eligibleSlotKeys: [...expectedPolicy.eligibleSlotKeys],
    },
    ...overrides,
  };
}

function contract() {
  const session = {metadata};
  const subscription = {
    metadata,
    items: {data: [{price: "price_conditioning"}]},
  };
  const fulfilment = {
    intent: snapshot({
      planKey: "adult_conditioning",
      stripePriceId: "price_conditioning",
      commercialTerms: persistedCommercialTerms(),
    }),
    membership: snapshot({
      planKey: "adult_conditioning",
      commercialTerms: persistedCommercialTerms(),
    }),
    outbox: snapshot({commercialTerms: persistedCommercialTerms()}),
  };
  return {session, subscription, fulfilment};
}

test(
  "post-Checkout verifier accepts the flexible Conditioning contract",
  () => {
    const {session, subscription, fulfilment} = contract();
    assert.equal(
      assertConditioningContract(session, subscription, fulfilment),
      true
    );
  }
);

test(
  "post-Checkout verifier uses the persisted nested commercial terms",
  () => {
    const {session, subscription, fulfilment} = contract();
    assert.equal(fulfilment.membership.get("appAccessTier"), undefined);
    assert.equal(fulfilment.outbox.get("planKey"), undefined);
    assert.equal(
      assertConditioningContract(session, subscription, fulfilment),
      true
    );
  }
);

test("post-Checkout verifier rejects local Conditioning contract drift", () => {
  const mutations = [
    ({fulfilment}) => {
      fulfilment.membership = snapshot({
        planKey: "adult_conditioning",
        commercialTerms: persistedCommercialTerms({appAccessTier: "full"}),
      });
    },
    ({fulfilment}) => {
      fulfilment.outbox = snapshot({
        commercialTerms: persistedCommercialTerms({amountPence: 3100}),
      });
    },
    ({fulfilment}) => {
      fulfilment.outbox = snapshot({
        commercialTerms: persistedCommercialTerms({
          conditioningBookingPolicy: {
            ...expectedPolicy,
            weeklyBookingLimit: 3,
            eligibleSlotKeys: [...expectedPolicy.eligibleSlotKeys],
          },
        }),
      });
    },
  ];
  for (const mutate of mutations) {
    const candidate = contract();
    mutate(candidate);
    assert.throws(() => assertConditioningContract(
      candidate.session,
      candidate.subscription,
      candidate.fulfilment
    ), /Local fulfilment did not preserve the Conditioning contract/);
  }
});

test("post-Checkout verifier rejects Conditioning provider drift", () => {
  const mutations = [
    ({session}) => {
      session.metadata = {...metadata, conditioningSlots: "monday_0600"};
    },
    ({subscription}) => {
      subscription.metadata = {...metadata, conditioningWeeklyLimit: "3"};
    },
    ({subscription}) => {
      subscription.items.data[0].price = "price_wrong";
    },
  ];
  for (const mutate of mutations) {
    const candidate = contract();
    mutate(candidate);
    assert.throws(() => assertConditioningContract(
      candidate.session,
      candidate.subscription,
      candidate.fulfilment
    ), /Conditioning|verified Price/i);
  }
});

test("local success URL recognises Adult Conditioning", () => {
  assert.equal(isLocalSuccessUrl({
    metadata: {planKey: "adult_conditioning"},
    success_url:
      "http://localhost:3002/memberships/success?session_id={CHECKOUT_SESSION_ID}&plan=adult_conditioning",
  }), true);
});
