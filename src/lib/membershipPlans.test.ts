import {
  EXISTING_MEMBER_OFFER,
  YOUTH_FAMILY_OFFER,
  MEMBERSHIP_PLANS,
  POLICY_TEXT,
  PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
  PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS,
  formatPlanPrice,
  isAgeEligibleForPlan,
  isFoundingPresale,
  isPlanKey,
  resolveDisplayAge,
  resolveYouthPlanForAge,
  resolveYouthMonthlyPricing,
} from "./membershipPlans";

describe("founding presale", () => {
  it("closes at London midnight while keeping Stripe billing on the UTC first", () => {
    expect(isFoundingPresale((PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS * 1000) - 1))
      .toBe(true);
    expect(isFoundingPresale(PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS * 1000))
      .toBe(false);
    expect(PRESALE_BILLING_ANCHOR_UNIX_SECONDS)
      .toBe(PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS + 3600);
  });

  it("scopes the £5 three-payment offer to Adult Unlimited", () => {
    expect(EXISTING_MEMBER_OFFER).toMatchObject({
      planKey: "adult_unlimited",
      amountOffPence: 500,
      currency: "gbp",
      durationMonths: 3,
    });
  });
});

describe("resolveDisplayAge", () => {
  const now = new Date(2026, 7, 18); // 18 August 2026, local

  it("returns whole years for a past date of birth", () => {
    expect(resolveDisplayAge("2010-08-18", now)).toBe(16);
    expect(resolveDisplayAge("2010-08-19", now)).toBe(15);
    expect(resolveDisplayAge("2014-01-01", now)).toBe(12);
  });

  it("rejects malformed, impossible, and future dates", () => {
    expect(resolveDisplayAge("18-08-2010", now)).toBeNull();
    expect(resolveDisplayAge("2010-02-30", now)).toBeNull();
    expect(resolveDisplayAge("2027-01-01", now)).toBeNull();
    expect(resolveDisplayAge("", now)).toBeNull();
  });
});

describe("plan eligibility", () => {
  it("routes youth ages to the approved plan", () => {
    expect(resolveYouthPlanForAge(6)).toBe("youth_youngstars");
    expect(resolveYouthPlanForAge(11)).toBe("youth_youngstars");
    expect(resolveYouthPlanForAge(12)).toBe("youth_teenstars");
    expect(resolveYouthPlanForAge(16)).toBe("youth_teenstars");
  });

  it("has no youth plan outside 6 to 16", () => {
    expect(resolveYouthPlanForAge(5)).toBeNull();
    expect(resolveYouthPlanForAge(17)).toBeNull();
    expect(resolveYouthPlanForAge(0)).toBeNull();
  });

  it("keeps adult plans at 18 and over with no upper bound", () => {
    const plan = MEMBERSHIP_PLANS.adult_unlimited;
    expect(isAgeEligibleForPlan(plan, 17)).toBe(false);
    expect(isAgeEligibleForPlan(plan, 18)).toBe(true);
    expect(isAgeEligibleForPlan(plan, 92)).toBe(true);
  });

  it("bounds youth plans on both ends", () => {
    expect(isAgeEligibleForPlan(MEMBERSHIP_PLANS.youth_youngstars, 5)).toBe(false);
    expect(isAgeEligibleForPlan(MEMBERSHIP_PLANS.youth_youngstars, 12)).toBe(false);
    expect(isAgeEligibleForPlan(MEMBERSHIP_PLANS.youth_teenstars, 11)).toBe(false);
    expect(isAgeEligibleForPlan(MEMBERSHIP_PLANS.youth_teenstars, 17)).toBe(false);
  });

  it("validates plan keys", () => {
    expect(isPlanKey("adult_unlimited")).toBe(true);
    expect(isPlanKey("commercial")).toBe(false);
    expect(isPlanKey(null)).toBe(false);
  });
});

describe("formatPlanPrice", () => {
  it("renders whole pound amounts without decimals", () => {
    expect(formatPlanPrice(MEMBERSHIP_PLANS.adult_unlimited)).toBe("£60");
    expect(formatPlanPrice(MEMBERSHIP_PLANS.youth_teenstars)).toBe("£35");
    expect(formatPlanPrice(MEMBERSHIP_PLANS.youth_youngstars)).toBe("£30");
  });
});

describe("youth family pricing", () => {
  it("discounts the full same-plan subtotal by 15% from two children", () => {
    expect(YOUTH_FAMILY_OFFER).toMatchObject({
      minimumParticipants: 2,
      percentOff: 15,
      maximumParticipants: 10,
    });
    expect(resolveYouthMonthlyPricing(MEMBERSHIP_PLANS.youth_youngstars, 1))
      .toEqual({
        standardMonthlyPence: 3000,
        recurringMonthlyPence: 3000,
        familyDiscountApplies: false,
      });
    expect(resolveYouthMonthlyPricing(MEMBERSHIP_PLANS.youth_youngstars, 3))
      .toEqual({
        standardMonthlyPence: 9000,
        recurringMonthlyPence: 7650,
        familyDiscountApplies: true,
      });
    expect(resolveYouthMonthlyPricing(MEMBERSHIP_PLANS.youth_teenstars, 2))
      .toEqual({
        standardMonthlyPence: 7000,
        recurringMonthlyPence: 5950,
        familyDiscountApplies: true,
      });
  });
});

describe("customer-facing app name", () => {
  it("uses Zero Alpha App in membership catalogue and status copy", () => {
    const displayCopy = [
      ...Object.values(MEMBERSHIP_PLANS).map((plan) => plan.summary),
      POLICY_TEXT.pastDue,
      POLICY_TEXT.scheduledAdultUnlimitedSuccess,
      POLICY_TEXT.adultUnlimitedSuccess,
    ];

    expect(displayCopy.join(" ")).toContain("Zero Alpha App");
    expect(displayCopy.join(" ")).not.toContain("AlphaWOD");
  });
});
