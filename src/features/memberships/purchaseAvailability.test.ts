import {
  isFrontendConditioningPurchaseEnabled,
  isFrontendMembershipPurchaseEnabled,
  resolveMembershipPurchaseAvailability,
} from "./purchaseAvailability";

describe("membership purchase availability", () => {
  it("requires the exact explicit frontend gate in a production build", () => {
    expect(isFrontendMembershipPurchaseEnabled({
      NODE_ENV: "production",
      REACT_APP_MEMBERSHIP_PURCHASE_ENABLED: "true",
    })).toBe(true);

    for (const value of [undefined, "false", "TRUE", " true", "1"]) {
      expect(isFrontendMembershipPurchaseEnabled({
        NODE_ENV: "production",
        REACT_APP_MEMBERSHIP_PURCHASE_ENABLED: value,
      })).toBe(false);
    }

    expect(isFrontendMembershipPurchaseEnabled({
      NODE_ENV: "development",
      REACT_APP_MEMBERSHIP_PURCHASE_ENABLED: "true",
    })).toBe(false);
  });

  it("requires a separate exact gate for Adult Conditioning", () => {
    expect(isFrontendConditioningPurchaseEnabled({
      REACT_APP_ADULT_CONDITIONING_PURCHASE_ENABLED: "true",
    })).toBe(true);
    for (const value of [undefined, "false", "TRUE", "1"]) {
      expect(isFrontendConditioningPurchaseEnabled({
        REACT_APP_ADULT_CONDITIONING_PURCHASE_ENABLED: value,
      })).toBe(false);
    }
  });

  it("keeps the public flow closed until legal and frontend gates are open", () => {
    expect(resolveMembershipPurchaseAvailability({
      documentsApproved: false,
      frontendPurchaseEnabled: true,
      localTestJourneyEnabled: false,
      frontendConditioningPurchaseEnabled: false,
    }).checkoutEnabled).toBe(false);

    expect(resolveMembershipPurchaseAvailability({
      documentsApproved: true,
      frontendPurchaseEnabled: false,
      localTestJourneyEnabled: false,
      frontendConditioningPurchaseEnabled: false,
    }).checkoutEnabled).toBe(false);

    expect(resolveMembershipPurchaseAvailability({
      documentsApproved: true,
      frontendPurchaseEnabled: true,
      localTestJourneyEnabled: false,
      frontendConditioningPurchaseEnabled: false,
    })).toEqual(expect.objectContaining({
      publicPurchaseEnabled: true,
      checkoutEnabled: true,
    }));
  });

  it("keeps the isolated local test journey usable without opening public sales", () => {
    expect(resolveMembershipPurchaseAvailability({
      documentsApproved: false,
      frontendPurchaseEnabled: false,
      localTestJourneyEnabled: true,
      frontendConditioningPurchaseEnabled: false,
    })).toEqual(expect.objectContaining({
      publicPurchaseEnabled: false,
      checkoutEnabled: true,
    }));
  });

  it("opens Conditioning only when both checkout and its separate gate are open", () => {
    expect(resolveMembershipPurchaseAvailability({
      documentsApproved: true,
      frontendPurchaseEnabled: true,
      localTestJourneyEnabled: false,
      frontendConditioningPurchaseEnabled: false,
    }).conditioningCheckoutEnabled).toBe(false);
    expect(resolveMembershipPurchaseAvailability({
      documentsApproved: true,
      frontendPurchaseEnabled: true,
      localTestJourneyEnabled: false,
      frontendConditioningPurchaseEnabled: true,
    }).conditioningCheckoutEnabled).toBe(true);
    expect(resolveMembershipPurchaseAvailability({
      documentsApproved: false,
      frontendPurchaseEnabled: false,
      localTestJourneyEnabled: true,
      frontendConditioningPurchaseEnabled: true,
    }).conditioningCheckoutEnabled).toBe(true);
  });
});
