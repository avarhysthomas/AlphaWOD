import {
  EXISTING_MEMBER_OFFER,
  YOUTH_FAMILY_OFFER,
  SUPPORTED_YOUTH_FAMILY_DISCOUNT_PERCENTAGES,
  MEMBERSHIP_SCHEMA_VERSION,
  MEMBERSHIP_PLANS,
  POLICY_TEXT,
  PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
  PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS,
  formatPlanPrice,
  isSupportedYouthFamilyDiscountPercent,
  isAgeEligibleForPlan,
  isFoundingPresale,
  isPlanKey,
  resolveDisplayAge,
  resolveCheckoutAcceptanceStatements,
  resolveYouthPlanForAge,
  resolveYouthMonthlyPricing,
  canonicalConditioningSlots,
  createCommercialPlanSnapshot,
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
  it("recommends MINI ALPHAS - 10 & Under through age 10 and TEEN ALPHAS - 11 & UP from age 11", () => {
    expect(resolveYouthPlanForAge(0)).toBe("youth_youngstars");
    expect(resolveYouthPlanForAge(10)).toBe("youth_youngstars");
    expect(resolveYouthPlanForAge(11)).toBe("youth_teenstars");
    expect(resolveYouthPlanForAge(92)).toBe("youth_teenstars");
  });

  it("does not recommend a youth plan for invalid ages", () => {
    expect(resolveYouthPlanForAge(-1)).toBeNull();
    expect(resolveYouthPlanForAge(10.5)).toBeNull();
  });

  it("keeps adult plans at 18 and over with no upper bound", () => {
    const plan = MEMBERSHIP_PLANS.adult_unlimited;
    expect(isAgeEligibleForPlan(plan, 17)).toBe(false);
    expect(isAgeEligibleForPlan(plan, 18)).toBe(true);
    expect(isAgeEligibleForPlan(plan, 92)).toBe(true);
  });

  it("accepts every valid nonnegative age on either youth plan", () => {
    expect(isAgeEligibleForPlan(MEMBERSHIP_PLANS.youth_youngstars, 0)).toBe(true);
    expect(isAgeEligibleForPlan(MEMBERSHIP_PLANS.youth_youngstars, 17)).toBe(true);
    expect(isAgeEligibleForPlan(MEMBERSHIP_PLANS.youth_teenstars, 6)).toBe(true);
    expect(isAgeEligibleForPlan(MEMBERSHIP_PLANS.youth_teenstars, 92)).toBe(true);
    expect(isAgeEligibleForPlan(MEMBERSHIP_PLANS.youth_teenstars, -1)).toBe(false);
    expect(isAgeEligibleForPlan(MEMBERSHIP_PLANS.youth_teenstars, 6.5)).toBe(false);
  });

  it("validates plan keys", () => {
    expect(isPlanKey("adult_unlimited")).toBe(true);
    expect(isPlanKey("commercial")).toBe(false);
    expect(isPlanKey(null)).toBe(false);
  });
});

describe("youth catalogue", () => {
  it("keeps schema v6, the current names and descriptions, and the existing prices", () => {
    expect(MEMBERSHIP_SCHEMA_VERSION).toBe(6);
    expect(MEMBERSHIP_PLANS.youth_youngstars).toMatchObject({
      key: "youth_youngstars",
      name: "MINI ALPHAS - 10 & Under",
      amountPence: 3000,
      minAge: 0,
      maxAge: 10,
      summary: "A strength and conditioning class for 10 and under! Fun, progressive, and challenging.",
    });
    expect(MEMBERSHIP_PLANS.youth_teenstars).toMatchObject({
      key: "youth_teenstars",
      name: "TEEN ALPHAS - 11 & UP",
      amountPence: 3500,
      minAge: 11,
      maxAge: null,
      summary: "Strength and conditioning for 11 and up! Develop athletic qualities in a supportive environment.",
    });
  });
});

describe("formatPlanPrice", () => {
  it("renders whole pound amounts without decimals", () => {
    expect(formatPlanPrice(MEMBERSHIP_PLANS.adult_unlimited)).toBe("£60");
    expect(formatPlanPrice(MEMBERSHIP_PLANS.youth_teenstars)).toBe("£35");
    expect(formatPlanPrice(MEMBERSHIP_PLANS.youth_youngstars)).toBe("£30");
  });
});

describe("Adult Conditioning Only", () => {
  it("freezes the £30 limited-access plan and exactly two canonical slots", () => {
    expect(MEMBERSHIP_PLANS.adult_conditioning).toMatchObject({
      name: "Adult Conditioning Only Membership",
      amountPence: 3000,
      grantsAlphaWodAccess: true,
      appAccessTier: "limited",
    });
    expect(canonicalConditioningSlots(["thursday_1800", "monday_0600"]))
      .toEqual(["monday_0600", "thursday_1800"]);
    expect(canonicalConditioningSlots(["monday_0600", "monday_0600"]))
      .toBeNull();
    expect(createCommercialPlanSnapshot("adult_conditioning", [
      "friday_0530",
      "tuesday_1800",
    ])).toMatchObject({
      appAccessTier: "limited",
      selectedConditioningSlots: ["tuesday_1800", "friday_0530"],
    });
  });
});

describe("youth family pricing", () => {
  it("discounts the full same-plan subtotal by 15% from two children", () => {
    expect(YOUTH_FAMILY_OFFER).toMatchObject({
      minimumParticipants: 2,
      percentOff: 15,
      maximumParticipants: 10,
    });
    expect(POLICY_TEXT.youthFamilyOffer).toContain("receive 15% off");
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

  it("keeps frozen 10% records explicitly supported without making them current", () => {
    expect(SUPPORTED_YOUTH_FAMILY_DISCOUNT_PERCENTAGES).toEqual([15, 10]);
    expect(isSupportedYouthFamilyDiscountPercent(10)).toBe(true);
    expect(isSupportedYouthFamilyDiscountPercent(15)).toBe(true);
    expect(isSupportedYouthFamilyDiscountPercent(12)).toBe(false);
    expect(isSupportedYouthFamilyDiscountPercent("15")).toBe(false);
  });

  it("freezes the current 15% total in a multi-child payment authority", () => {
    const authority = resolveCheckoutAcceptanceStatements("youth_youngstars", 2)
      .find(({id}) => id === "recurring_payment_authority");

    expect(authority?.statement).toContain("automatic 15% family discount");
    expect(authority?.statement).toContain("recurring total £51.00");
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
