import React from "react";
import {render, screen} from "@testing-library/react";
import MembershipDiscountSummary from "./MembershipDiscountSummary";
import {resolveParticipantFullNames} from "./membershipPresentation";

jest.mock("../services/membership", () => ({
  formatUnixDate: (value: number | null) => {
    if (value === 1_796_083_200) return "1 December 2026";
    return String(value ?? "—");
  },
}));

describe("MembershipDiscountSummary", () => {
  it("preserves the legacy fixed repeating existing-member offer", () => {
    render(
      <MembershipDiscountSummary
        planKey="adult_unlimited"
        discount={{
          couponId: "coupon_existing_5",
          promotionCodeId: "promo_1",
          amountOffPence: 500,
          currency: "gbp",
          durationInMonths: 3,
          startsAt: 1_787_149_200,
          endsAt: 1_795_035_600,
        }}
        paymentSchedule={{
          amountDueTodayPence: 0,
          firstPaymentAt: 1_788_217_200,
          standardMonthlyPence: 6000,
          discountedMonthlyPence: 5500,
          discountedPaymentCount: 3,
          fullPriceFrom: 1_796_083_200,
        }}
      />
    );

    expect(screen.getByText("Existing-member discount applied")).toBeInTheDocument();
    expect(screen.getByText(/£5 off each of your first 3 monthly payments/i))
      .toBeInTheDocument();
    expect(screen.getByText(/standard price resumes on 1 December 2026/i))
      .toBeInTheDocument();
  });

  it.each([
    ["youth_youngstars" as const, 6000, 5100, "£51", "£60"],
    ["youth_teenstars" as const, 7000, 5950, "£59.50", "£70"],
  ])(
    "renders a safe forever family discount for %s",
    (planKey, standardMonthlyPence, discountedMonthlyPence, discounted, standard) => {
      render(
        <MembershipDiscountSummary
          planKey={planKey}
          participantCount={2}
          discount={{
            couponId: "coupon_family_15",
            promotionCodeId: null,
            amountOffPence: null,
            currency: null,
            durationInMonths: null,
            startsAt: 1_787_149_200,
            endsAt: null,
            kind: "youth_family",
            percentOff: 15,
            duration: "forever",
          }}
          paymentSchedule={{
            amountDueTodayPence: 0,
            firstPaymentAt: 1_788_217_200,
            standardMonthlyPence,
            discountedMonthlyPence,
            discountedPaymentCount: null,
            fullPriceFrom: null,
          }}
        />
      );

      expect(screen.getByText("Family discount applied")).toBeInTheDocument();
      expect(screen.getByText(new RegExp(
        `15% off the full monthly total for 2 children.*${discounted}.*instead of ${standard}`,
        "i"
      ))).toBeInTheDocument();
      expect(screen.queryByText(/standard price resumes/i)).not.toBeInTheDocument();
    }
  );

  it("omits a family projection whose amount does not match 15%", () => {
    render(
      <MembershipDiscountSummary
        planKey="youth_youngstars"
        participantCount={2}
        discount={{
          couponId: "coupon_family_15",
          promotionCodeId: null,
          amountOffPence: null,
          currency: null,
          durationInMonths: null,
          startsAt: 1_787_149_200,
          endsAt: null,
          kind: "youth_family",
          percentOff: 15,
          duration: "forever",
        }}
        paymentSchedule={{
          amountDueTodayPence: 0,
          firstPaymentAt: 1_788_217_200,
          standardMonthlyPence: 6000,
          discountedMonthlyPence: 5200,
          discountedPaymentCount: null,
          fullPriceFrom: null,
        }}
      />
    );

    expect(screen.queryByText(/discount applied/i)).not.toBeInTheDocument();
  });
});

describe("resolveParticipantFullNames", () => {
  it("uses all valid projected names and falls back from malformed data", () => {
    expect(resolveParticipantFullNames("Alex Child", [
      "Alex Child",
      "Sam Child",
    ])).toEqual(["Alex Child", "Sam Child"]);
    expect(resolveParticipantFullNames("Alex Child", [
      "Sam Child",
      "Sam Child",
    ])).toEqual(["Alex Child"]);
  });
});
