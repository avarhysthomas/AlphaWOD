/* eslint-disable @typescript-eslint/no-var-requires */

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  resolveStripeTestCatalogueScope,
} = require("../scripts/stripeTestCatalogueScope");
const {PLAN_KEYS} = require("../lib/membershipPlans");

test(
  "default Stripe test preflight keeps the complete catalogue and offers",
  () => {
    assert.deepEqual(resolveStripeTestCatalogueScope(""), {
      name: "full",
      planKeys: PLAN_KEYS,
      includePayg: true,
      verifyExistingMemberOffer: true,
      verifyYouthFamilyOffer: true,
    });
  }
);

test("Conditioning scope verifies only Conditioning", () => {
  assert.deepEqual(resolveStripeTestCatalogueScope(" adult_conditioning "), {
    name: "adult_conditioning",
    planKeys: ["adult_conditioning"],
    includePayg: false,
    verifyExistingMemberOffer: false,
    verifyYouthFamilyOffer: false,
  });
});

test("PAYG scope verifies no recurring plan or promotion offer", () => {
  assert.deepEqual(resolveStripeTestCatalogueScope(" adult_payg_class "), {
    name: "adult_payg_class",
    planKeys: [],
    includePayg: true,
    verifyExistingMemberOffer: false,
    verifyYouthFamilyOffer: false,
  });
});

test("scoped Stripe test preflight cannot widen to another plan", () => {
  for (const invalid of ["adult_unlimited", "adult_ladies", "all", "*"]) {
    assert.throws(() => resolveStripeTestCatalogueScope(invalid),
      /must be empty, adult_conditioning, or adult_payg_class/i);
  }
});
