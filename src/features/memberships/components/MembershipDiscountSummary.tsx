import React from "react";
import {
  MEMBERSHIP_PLANS,
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

/**
 * Shows only complete, economically valid discount data. A partially migrated
 * or malformed backend record is omitted instead of promising the wrong price.
 */
export default function MembershipDiscountSummary({
  planKey,
  discount,
  paymentSchedule,
  firstPaymentAt,
  className = "",
}: MembershipDiscountSummaryProps) {
  const plan = MEMBERSHIP_PLANS[planKey];
  const discountIsDisplayable = Boolean(
    discount &&
    discount.currency === "gbp" &&
    Number.isInteger(discount.amountOffPence) &&
    discount.amountOffPence > 0 &&
    discount.amountOffPence < plan.amountPence &&
    Number.isInteger(discount.durationInMonths) &&
    discount.durationInMonths > 0 &&
    discount.durationInMonths <= 36
  );

  if (!discount || !discountIsDisplayable) return null;

  const standardPrice = paymentSchedule &&
    Number.isInteger(paymentSchedule.standardMonthlyPence) &&
    paymentSchedule.standardMonthlyPence > 0
    ? paymentSchedule.standardMonthlyPence
    : plan.amountPence;
  const scheduledDiscountedPrice = paymentSchedule?.discountedMonthlyPence;
  const discountedPrice = typeof scheduledDiscountedPrice === "number" &&
    Number.isInteger(scheduledDiscountedPrice) &&
    scheduledDiscountedPrice > 0 &&
    scheduledDiscountedPrice < standardPrice
    ? scheduledDiscountedPrice
    : standardPrice - discount.amountOffPence;
  const discountedPaymentCount = paymentSchedule &&
    Number.isInteger(paymentSchedule.discountedPaymentCount) &&
    paymentSchedule.discountedPaymentCount > 0
    ? paymentSchedule.discountedPaymentCount
    : discount.durationInMonths;
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
  const amountOffPence = standardPrice - discountedPrice;
  const paymentWord = discountedPaymentCount === 1 ? "payment" : "payments";

  return (
    <div
      className={`rounded-2xl border border-amber-500/25 bg-amber-500/10 p-5 text-sm leading-7 text-amber-50/90 ${className}`.trim()}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-200">
        Existing-member discount applied
      </p>
      <p className="mt-3">
        {formatGbp(amountOffPence)} off each of your first{" "}
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
