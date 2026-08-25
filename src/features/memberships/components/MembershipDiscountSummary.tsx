import React from "react";
import {
  MEMBERSHIP_PLANS,
  YOUTH_FAMILY_OFFER,
  isSupportedYouthFamilyDiscountPercent,
  type PlanKey,
} from "../../../lib/membershipPlans";
import {
  formatUnixDate,
  type MembershipDiscount,
  type MembershipPaymentSchedule,
} from "../services/membership";

type MembershipDiscountSummaryProps = {
  planKey: PlanKey;
  discount?: MembershipDiscount | null;
  paymentSchedule?: MembershipPaymentSchedule | null;
  firstPaymentAt?: number | null;
  participantCount?: number;
  className?: string;
};

function formatGbp(amountPence: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: amountPence % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amountPence / 100);
}

function addUtcMonths(unixSeconds: number, months: number): number {
  const date = new Date(unixSeconds * 1000);
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() + months,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds()
  ) / 1000;
}

function formatPaymentMonths(firstPaymentAt: number, count: number): string {
  const dates = Array.from({length: count}, (_, index) =>
    new Date(addUtcMonths(firstPaymentAt, index) * 1000).toLocaleDateString("en-GB", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    })
  );
  if (dates.length <= 1) return dates[0] ?? "";
  return `${dates.slice(0, -1).join(", ")} and ${dates[dates.length - 1]}`;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * Shows only complete, economically valid discount data. A partially migrated
 * or malformed backend record is omitted instead of promising the wrong price.
 */
export default function MembershipDiscountSummary({
  planKey,
  discount,
  paymentSchedule,
  firstPaymentAt,
  participantCount,
  className = "",
}: MembershipDiscountSummaryProps) {
  const plan = MEMBERSHIP_PLANS[planKey];
  if (!discount) return null;

  const standardPrice = paymentSchedule &&
    isPositiveInteger(paymentSchedule.standardMonthlyPence)
    ? paymentSchedule.standardMonthlyPence
    : plan.amountPence;
  const scheduledDiscountedPrice = paymentSchedule?.discountedMonthlyPence;
  const inferredParticipantCount = standardPrice % plan.amountPence === 0 ?
    standardPrice / plan.amountPence : null;
  const familyParticipantCount = isPositiveInteger(participantCount) ?
    participantCount : inferredParticipantCount;
  const familyDiscountPercent = isSupportedYouthFamilyDiscountPercent(
    discount.percentOff
  ) ? discount.percentOff : null;
  const expectedFamilyPrice = familyDiscountPercent === null ? null : Math.round(
    standardPrice * (100 - familyDiscountPercent) / 100
  );
  const familyDiscountIsDisplayable =
    discount.kind === "youth_family" &&
    plan.audience === "youth" &&
    (YOUTH_FAMILY_OFFER.eligiblePlanKeys as readonly PlanKey[]).includes(planKey) &&
    familyDiscountPercent !== null &&
    discount.duration === "forever" &&
    discount.amountOffPence === null &&
    discount.durationInMonths === null &&
    discount.endsAt === null &&
    isPositiveInteger(familyParticipantCount) &&
    familyParticipantCount >= YOUTH_FAMILY_OFFER.minimumParticipants &&
    familyParticipantCount <= YOUTH_FAMILY_OFFER.maximumParticipants &&
    standardPrice === plan.amountPence * familyParticipantCount &&
    isPositiveInteger(scheduledDiscountedPrice) &&
    scheduledDiscountedPrice === expectedFamilyPrice;

  if (familyDiscountIsDisplayable) {
    return (
      <div
        className={`rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-5 text-sm leading-7 text-emerald-50/90 ${className}`.trim()}
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-200">
          Family discount applied
        </p>
        <p className="mt-3">
          {familyDiscountPercent}% off the full monthly total for{" "}
          {familyParticipantCount} children. You&rsquo;ll pay{" "}
          {formatGbp(scheduledDiscountedPrice)} per month instead of{" "}
          {formatGbp(standardPrice)} while this membership includes at least two children.
        </p>
      </div>
    );
  }

  const amountOffPence = discount.amountOffPence;
  const durationInMonths = discount.durationInMonths;
  const fixedDiscountIsDisplayable =
    (discount.kind === undefined || discount.kind === "existing_member") &&
    discount.currency === "gbp" &&
    isPositiveInteger(amountOffPence) &&
    amountOffPence < plan.amountPence &&
    isPositiveInteger(durationInMonths) &&
    durationInMonths <= 36;

  if (!fixedDiscountIsDisplayable) return null;

  const discountedPrice = isPositiveInteger(scheduledDiscountedPrice) &&
    scheduledDiscountedPrice < standardPrice
    ? scheduledDiscountedPrice
    : standardPrice - amountOffPence;
  const scheduledDiscountedPaymentCount = paymentSchedule?.discountedPaymentCount;
  const discountedPaymentCount = isPositiveInteger(scheduledDiscountedPaymentCount)
    ? scheduledDiscountedPaymentCount
    : durationInMonths;
  const projectedFirstPaymentAt = paymentSchedule?.firstPaymentAt ?? firstPaymentAt;
  const safeFirstPaymentAt = typeof projectedFirstPaymentAt === "number" &&
    Number.isFinite(projectedFirstPaymentAt) && projectedFirstPaymentAt > 0
    ? projectedFirstPaymentAt
    : null;
  const scheduledFullPriceFrom = paymentSchedule?.fullPriceFrom;
  const firstStandardPaymentAt = typeof scheduledFullPriceFrom === "number" &&
    Number.isFinite(scheduledFullPriceFrom) && scheduledFullPriceFrom > 0
    ? scheduledFullPriceFrom
    : safeFirstPaymentAt !== null
      ? addUtcMonths(safeFirstPaymentAt, discountedPaymentCount)
      : null;
  const displayedAmountOffPence = standardPrice - discountedPrice;
  const paymentWord = discountedPaymentCount === 1 ? "payment" : "payments";

  return (
    <div
      className={`rounded-2xl border border-amber-500/25 bg-amber-500/10 p-5 text-sm leading-7 text-amber-50/90 ${className}`.trim()}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-200">
        Existing-member discount applied
      </p>
      <p className="mt-3">
        {formatGbp(displayedAmountOffPence)} off each of your first{" "}
        {discountedPaymentCount} monthly {paymentWord}. You&rsquo;ll pay{" "}
        {formatGbp(discountedPrice)} per month while the offer applies, then{" "}
        {formatGbp(standardPrice)} per month.
      </p>
      {safeFirstPaymentAt !== null && firstStandardPaymentAt !== null && (
        <p className="mt-2 text-xs leading-6 text-amber-100/70">
          Discounted payments: {formatPaymentMonths(
            safeFirstPaymentAt,
            discountedPaymentCount
          )}. The standard price resumes on {formatUnixDate(firstStandardPaymentAt)}.
        </p>
      )}
    </div>
  );
}
