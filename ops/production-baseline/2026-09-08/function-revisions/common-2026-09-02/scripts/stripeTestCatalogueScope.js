/* eslint-disable require-jsdoc */

const {PLAN_KEYS} = require("../lib/membershipPlans");

const CONDITIONING_SCOPE = "adult_conditioning";
const PAYG_SCOPE = "adult_payg_class";

function resolveStripeTestCatalogueScope(rawScope) {
  const scope = typeof rawScope === "string" ? rawScope.trim() : "";
  if (!scope) {
    return Object.freeze({
      name: "full",
      planKeys: Object.freeze([...PLAN_KEYS]),
      includePayg: true,
      verifyExistingMemberOffer: true,
      verifyYouthFamilyOffer: true,
    });
  }
  if (scope !== CONDITIONING_SCOPE && scope !== PAYG_SCOPE) {
    throw new Error(
      "STRIPE_TEST_PLAN_SCOPE must be empty, " +
      `${CONDITIONING_SCOPE}, or ${PAYG_SCOPE}.`
    );
  }
  if (scope === PAYG_SCOPE) {
    return Object.freeze({
      name: PAYG_SCOPE,
      planKeys: Object.freeze([]),
      includePayg: true,
      verifyExistingMemberOffer: false,
      verifyYouthFamilyOffer: false,
    });
  }
  return Object.freeze({
    name: CONDITIONING_SCOPE,
    planKeys: Object.freeze([CONDITIONING_SCOPE]),
    includePayg: false,
    verifyExistingMemberOffer: false,
    verifyYouthFamilyOffer: false,
  });
}

module.exports = {
  CONDITIONING_SCOPE,
  PAYG_SCOPE,
  resolveStripeTestCatalogueScope,
};
