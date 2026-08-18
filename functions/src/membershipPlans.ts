/* eslint-disable require-jsdoc, valid-jsdoc, max-len */

/**
 * Canonical membership catalogue, billing policy, and pure policy maths for
 * the public purchase flow.
 *
 * This module is the single source of truth referenced by the Phase 1
 * handover. It deliberately contains no Stripe SDK import and no Firebase
 * import so that every rule below stays unit-testable in isolation.
 *
 * The frontend mirror lives at `src/lib/membershipPlans.ts` and is held
 * identical by `src/lib/membershipPlans.parity.test.ts`.
 */

import {DateTime} from "luxon";

export const BILLING_TIMEZONE = "Europe/London";
export const BILLING_CURRENCY = "gbp";

/** Catalogue schema version stored on every membership document. */
export const MEMBERSHIP_SCHEMA_VERSION = 1;

/** ---------------------------------------------------------------
 * Company and contact identity (Membership Terms sections 1 and 14)
 * -------------------------------------------------------------- */
export const COMPANY = {
  legalName: "ZERO ALPHA FITNESS LTD",
  tradingName: "Zero Alpha Fitness",
  companyNumber: "15978998",
  address: "Unit 3, Felinfoel Business Hub, Llanelli, SA14 8BE",
  supportEmail: "support@zeroalphafitness.co.uk",
  confirmationSender: "hello@zeroalphafitness.co.uk",
} as const;

/** ---------------------------------------------------------------
 * Plan catalogue
 *
 * Prices are presentational only. The amount Stripe displays at checkout is
 * authoritative (Membership Terms 5). Price IDs are never stored here; they
 * are resolved from server configuration by `stripePriceEnvKey`.
 * -------------------------------------------------------------- */
export const PLAN_KEYS = [
  "adult_unlimited",
  "adult_ladies",
  "adult_gym",
  "youth_youngstars",
  "youth_teenstars",
] as const;

export type PlanKey = typeof PLAN_KEYS[number];

export type PlanAudience = "adult" | "youth";

export type MembershipPlan = {
  key: PlanKey;
  audience: PlanAudience;
  /** Customer-facing plan name; must match the Stripe product name. */
  name: string;
  /** Display-only monthly price in pence. */
  amountPence: number;
  currency: typeof BILLING_CURRENCY;
  /**
   * Inclusive participant age range. Adult plans are 18+ with no upper bound.
   */
  minAge: number;
  maxAge: number | null;
  /**
   * Whether a paid, eligible subscription on this plan automatically grants
   * AlphaWOD access (Membership Terms 8). Only Adult Unlimited does.
   */
  grantsAlphaWodAccess: boolean;
  /** Environment/config key holding this plan's Stripe price ID. */
  stripePriceEnvKey: string;
  /** Youth options are presented inside one catalogue card. */
  cardGroup: "adult" | "youth";
  summary: string;
};

export const MEMBERSHIP_PLANS: Record<PlanKey, MembershipPlan> = {
  adult_unlimited: {
    key: "adult_unlimited",
    audience: "adult",
    name: "Adult Unlimited Membership",
    amountPence: 6000,
    currency: BILLING_CURRENCY,
    minAge: 18,
    maxAge: null,
    grantsAlphaWodAccess: true,
    stripePriceEnvKey: "STRIPE_PRICE_ADULT_UNLIMITED",
    cardGroup: "adult",
    summary: "Full access to sessions and the gym floor. The only membership that automatically includes eligible AlphaWOD access.",
  },
  adult_ladies: {
    key: "adult_ladies",
    audience: "adult",
    name: "Adult Ladies Only Membership",
    amountPence: 5000,
    currency: BILLING_CURRENCY,
    minAge: 18,
    maxAge: null,
    grantsAlphaWodAccess: false,
    stripePriceEnvKey: "STRIPE_PRICE_ADULT_LADIES",
    cardGroup: "adult",
    summary: "Ladies only sessions and gym access. Does not include AlphaWOD access.",
  },
  adult_gym: {
    key: "adult_gym",
    audience: "adult",
    name: "Adult Gym Only",
    amountPence: 4500,
    currency: BILLING_CURRENCY,
    minAge: 18,
    maxAge: null,
    grantsAlphaWodAccess: false,
    stripePriceEnvKey: "STRIPE_PRICE_ADULT_GYM",
    cardGroup: "adult",
    summary: "Gym floor access only. Does not include coached sessions or AlphaWOD access.",
  },
  youth_youngstars: {
    key: "youth_youngstars",
    audience: "youth",
    name: "HYROX Youngstars",
    amountPence: 3500,
    currency: BILLING_CURRENCY,
    minAge: 4,
    maxAge: 11,
    grantsAlphaWodAccess: false,
    stripePriceEnvKey: "STRIPE_PRICE_YOUTH_YOUNGSTARS",
    cardGroup: "youth",
    summary: "Coached HYROX training for ages 4 to 11. Does not include AlphaWOD access.",
  },
  youth_teenstars: {
    key: "youth_teenstars",
    audience: "youth",
    name: "HYROX Teenstars",
    amountPence: 3500,
    currency: BILLING_CURRENCY,
    minAge: 12,
    maxAge: 16,
    grantsAlphaWodAccess: false,
    stripePriceEnvKey: "STRIPE_PRICE_YOUTH_TEENSTARS",
    cardGroup: "youth",
    summary: "Coached HYROX training for ages 12 to 16. Does not include AlphaWOD access.",
  },
};

export function isPlanKey(value: unknown): value is PlanKey {
  return typeof value === "string" && (PLAN_KEYS as readonly string[]).includes(value);
}

export function getPlan(key: PlanKey): MembershipPlan {
  return MEMBERSHIP_PLANS[key];
}

/**
 * Resolves the youth plan for an age, mirroring the approved funnel rule:
 * under 12 routes to Youngstars, 12 and over routes to Teenstars. Ages
 * outside 4-16 have no youth plan.
 */
export function resolveYouthPlanForAge(age: number): PlanKey | null {
  if (!Number.isInteger(age)) return null;
  if (age >= MEMBERSHIP_PLANS.youth_youngstars.minAge && age < MEMBERSHIP_PLANS.youth_teenstars.minAge) {
    return "youth_youngstars";
  }
  if (age >= MEMBERSHIP_PLANS.youth_teenstars.minAge &&
    age <= (MEMBERSHIP_PLANS.youth_teenstars.maxAge as number)) {
    return "youth_teenstars";
  }
  return null;
}

export function isAgeEligibleForPlan(plan: MembershipPlan, age: number): boolean {
  if (!Number.isInteger(age) || age < 0) return false;
  if (age < plan.minAge) return false;
  if (plan.maxAge !== null && age > plan.maxAge) return false;
  return true;
}

/** ---------------------------------------------------------------
 * Billing policy constants (Membership Terms 5, 9, 11)
 * -------------------------------------------------------------- */
export const BILLING_POLICY = {
  /** Every membership renews on the first of the calendar month. */
  monthlyAnchorDayOfMonth: 1,
  /** Calendar days of notice required to stop the next first-of-month charge. */
  cancellationNoticeDays: 14,
  /** Calendar days a past-due subscription keeps access while payment recovers. */
  pastDueGraceDays: 3,
  /** Statutory distance-selling cooling-off window. */
  coolingOffDays: 14,
  joiningFeePence: 0,
  minimumTermMonths: 0,
  trialDays: 0,
  pauseAllowed: false,
  /** Stripe Customer Portal cancel/pause controls stay disabled. */
  portalCancellationEnabled: false,
  portalPauseEnabled: false,
  /** The business is not VAT registered; displayed price is the total price. */
  vatRegistered: false,
  automaticTaxEnabled: false,
  collectBillingAddress: false,
  collectPhoneNumber: false,
  blockDuplicateActiveSubscriptions: true,
  guardianMustBePayerForYouth: true,
  adultPayerMustBeParticipant: false,
} as const;

/** ---------------------------------------------------------------
 * Approved customer-facing copy
 * -------------------------------------------------------------- */
export const POLICY_TEXT = {
  refund: "Payments are non-refundable except where required by law.",
  rollingTerm: "There is no joining fee, free trial or minimum term. Each membership is a rolling monthly contract until cancelled.",
  cancellationRule: "To avoid the next first-of-month payment, your cancellation request must reach us at least 14 calendar days before that billing date. If it reaches us less than 14 days before the next first, that payment remains due and your membership ends at the end of the additional paid month.",
  prorationRule: "All memberships bill on the first of each calendar month. If your membership starts after the first, Stripe calculates and displays an initial prorated charge for the period until the next first of the month, payable immediately.",
  prorationAuthority: "The amount Stripe displays before payment is authoritative for that checkout. We do not calculate a separate proration in the browser. If the displayed initial charge or billing date appears wrong, do not pay; contact us first.",
  pastDue: "A failed payment enters a three-calendar-day past-due grace period, during which related access continues.",
  dispute: "An open payment dispute suspends related access. A dispute resolved in our favour restores eligible access promptly. A lost dispute or full refund revokes related access.",
  noPause: "Membership cannot be paused, frozen or placed on holiday hold.",
  coolingOffConsent: "I expressly request that the membership and any eligible AlphaWOD access begin immediately, before the 14-day cooling-off period ends. I understand that, if I cancel during that period, Zero Alpha Fitness may retain or charge only the proportionate amount permitted by law for services supplied before cancellation.",
  youthSuccess: "Payment confirmed. Zero Alpha Fitness will contact you by email to arrange onboarding and your first session. Questions: support@zeroalphafitness.co.uk.",
  adultUnlimitedSuccess: "Payment confirmed. Your Adult Unlimited membership is active and eligible AlphaWOD access has been unlocked.",
  adultOtherSuccess: "Payment confirmed. Zero Alpha Fitness will contact you by email to arrange onboarding and your first session. Questions: support@zeroalphafitness.co.uk.",
  duplicateBlocked: "This account already has an active membership. Manage or cancel the existing membership before buying another one.",
  portalScope: "The secure Customer Portal is for updating your payment method and viewing invoices. Cancellation is handled by the request flow on this page.",
  guardianRequirement: "For a participant under 18, the payer must be their parent or legal guardian, or another adult with lawful authority to enter this arrangement for them.",
} as const;

/** Legal document versions presented and evidenced at checkout. */
export const CHECKOUT_DOCUMENTS = {
  membershipTerms: "ZAF-TERMS-DRAFT-2026-08-17-01",
  cancellationPolicy: "ZAF-CANCEL-DRAFT-2026-08-17-01",
  privacyNotice: "ZAF-PRIVACY-DRAFT-2026-08-17-01",
  adultWaiver: "ZAF-ADULT-WAIVER-DRAFT-2026-08-17-01",
  guardianAddendum: "ZAF-GUARDIAN-DRAFT-2026-08-17-01",
} as const;

/**
 * Every checkout document above is still a legal-review draft. The purchase
 * flow refuses to run while this is false, so an unapproved version can never
 * be presented to a paying customer.
 */
export const CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION = false;

/** ---------------------------------------------------------------
 * Billing-cycle maths
 * -------------------------------------------------------------- */

export type BillingAnchor = {
  /** Unix seconds of the next first-of-month boundary in Europe/London. */
  anchorUnixSeconds: number;
  /** ISO date (YYYY-MM-DD) of the first full monthly charge. */
  firstFullChargeDate: string;
};

/** Stripe requires Checkout Sessions to remain open for at least 30 minutes. */
export const STRIPE_MIN_CHECKOUT_WINDOW_SECONDS = 30 * 60;

/** Network/clock allowance so Stripe still receives at least its 30m floor. */
export const CHECKOUT_CREATION_MARGIN_SECONDS = 5 * 60;

/**
 * Keep a full hour between Checkout expiry and the first recurring anchor.
 * Besides ensuring the anchor is still in the future when payment completes,
 * this leaves a small operational buffer for Stripe to finalise the session.
 */
export const CHECKOUT_ANCHOR_MARGIN_SECONDS = 60 * 60;

function londonNow(nowMillis: number): DateTime {
  return DateTime.fromMillis(nowMillis, {zone: BILLING_TIMEZONE});
}

/**
 * The first day of the next calendar month at 00:00 Europe/London.
 * Always strictly in the future, which `subscription_data.billing_cycle_anchor`
 * requires.
 */
export function resolveBillingCycleAnchor(nowMillis: number): BillingAnchor {
  const anchor = londonNow(nowMillis)
    .plus({months: 1})
    .startOf("month");

  return {
    anchorUnixSeconds: Math.floor(anchor.toSeconds()),
    firstFullChargeDate: anchor.toISODate() as string,
  };
}

/**
 * Latest moment a Checkout Session may stay open. Stripe rejects a
 * `billing_cycle_anchor` that is no longer in the future, so a session must
 * never survive past the anchor it was created against.
 */
export function resolveCheckoutSessionExpiry(nowMillis: number): number {
  const now = londonNow(nowMillis);
  const {anchorUnixSeconds} = resolveBillingCycleAnchor(nowMillis);
  const maxStripeExpiry = Math.floor(now.plus({hours: 24}).toSeconds());
  const safeMinStripeExpiry = Math.floor(now.toSeconds()) +
    STRIPE_MIN_CHECKOUT_WINDOW_SECONDS + CHECKOUT_CREATION_MARGIN_SECONDS;
  const beforeAnchor = anchorUnixSeconds - CHECKOUT_ANCHOR_MARGIN_SECONDS;

  // The old implementation used Math.max here. Close to midnight that chose
  // Stripe's 30-minute minimum even when it landed at or beyond the billing
  // anchor. Refuse to create a session instead: the buyer can start again just
  // after midnight, when the following month's anchor is safely in the future.
  if (beforeAnchor < safeMinStripeExpiry) {
    throw new RangeError(
      "Checkout is temporarily unavailable this close to the monthly billing boundary."
    );
  }

  return Math.min(maxStripeExpiry, beforeAnchor);
}

export type CancellationOutcome = {
  /** ISO date of the next first-of-month billing date. */
  nextBillingDate: string;
  /** Whether the request met the 14 calendar day notice deadline. */
  noticeDeadlineMet: boolean;
  /** Calendar days between the request and the next billing date. */
  noticeDaysGiven: number;
  /** Latest ISO date a request would still be on time for `nextBillingDate`. */
  noticeDeadlineDate: string;
  /** ISO date of the final payment that remains due, or null if none. */
  finalPaymentDate: string | null;
  /** ISO date of the last day the membership is available. */
  accessEndsOnDate: string;
  /** Unix seconds to set as the Stripe subscription `cancel_at`. */
  cancelAtUnixSeconds: number;
};

/**
 * Applies the approved renewal-notice rule (Cancellation Policy 3).
 *
 * A request is on time when it arrives at least 14 calendar days before the
 * next first of the month. On time: no charge on that first, access ends at
 * the end of the preceding day. Late: that charge stands, access ends at the
 * end of the day before the following first.
 *
 * Calendar days are counted between London calendar dates, so British Summer
 * Time transitions cannot move a deadline by an hour.
 */
export function resolveCancellationOutcome(requestMillis: number): CancellationOutcome {
  const requestDay = londonNow(requestMillis).startOf("day");
  const nextFirst = londonNow(requestMillis).plus({months: 1}).startOf("month");
  const followingFirst = nextFirst.plus({months: 1});

  const noticeDaysGiven = Math.floor(nextFirst.diff(requestDay, "days").days);
  const noticeDeadlineMet = noticeDaysGiven >= BILLING_POLICY.cancellationNoticeDays;
  const effectiveEnd = noticeDeadlineMet ? nextFirst : followingFirst;

  return {
    nextBillingDate: nextFirst.toISODate() as string,
    noticeDeadlineMet,
    noticeDaysGiven,
    noticeDeadlineDate: nextFirst
      .minus({days: BILLING_POLICY.cancellationNoticeDays})
      .toISODate() as string,
    finalPaymentDate: noticeDeadlineMet ? null : (nextFirst.toISODate() as string),
    accessEndsOnDate: effectiveEnd.minus({days: 1}).toISODate() as string,
    cancelAtUnixSeconds: Math.floor(effectiveEnd.toSeconds()),
  };
}

/**
 * End of the statutory cooling-off period: 14 days after the day the contract
 * was made (Cancellation Policy 4).
 */
export function resolveCoolingOffEnd(contractMillis: number): string {
  return londonNow(contractMillis)
    .startOf("day")
    .plus({days: BILLING_POLICY.coolingOffDays + 1})
    .minus({milliseconds: 1})
    .toISO() as string;
}

/** Whole years between a date of birth and a reference instant, in London. */
export function resolveAgeFromDateOfBirth(
  dateOfBirthIso: string,
  nowMillis: number
): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirthIso)) return null;
  const dob = DateTime.fromISO(dateOfBirthIso, {zone: BILLING_TIMEZONE}).startOf("day");
  if (!dob.isValid) return null;

  const today = londonNow(nowMillis).startOf("day");
  if (dob > today) return null;

  const age = Math.floor(today.diff(dob, "years").years);
  return age >= 0 && age <= 120 ? age : null;
}

/** Formats pence as a GBP amount for customer-facing confirmation copy. */
export function formatPence(amountPence: number): string {
  return `£${(amountPence / 100).toFixed(2)}`;
}

/** Formats an ISO date as a long UK date in the billing timezone. */
export function formatBillingDate(isoDate: string): string {
  return DateTime.fromISO(isoDate, {zone: BILLING_TIMEZONE})
    .toFormat("d LLLL yyyy");
}

/** Formats a unix seconds instant as a long UK date. */
export function formatUnixBillingDate(unixSeconds: number): string {
  return DateTime.fromSeconds(unixSeconds, {zone: BILLING_TIMEZONE})
    .toFormat("d LLLL yyyy");
}

/** Formats a unix seconds instant as an ISO calendar date in London. */
export function formatUnixBillingIsoDate(unixSeconds: number): string {
  return DateTime.fromSeconds(unixSeconds, {zone: BILLING_TIMEZONE})
    .toISODate() as string;
}

/** ---------------------------------------------------------------
 * Subscription state to entitlement mapping (Membership Terms 8 and 11)
 * -------------------------------------------------------------- */

export const MEMBERSHIP_STATES = [
  "incomplete",
  "active",
  "past_due_grace",
  "past_due_suspended",
  "disputed",
  "cancelled",
  "revoked",
] as const;

export type MembershipState = typeof MEMBERSHIP_STATES[number];

export type SubscriptionSignal = {
  /** Raw Stripe subscription status. */
  stripeStatus: string;
  /** Unix seconds the earliest unpaid invoice became due, if past due. */
  pastDueSinceUnixSeconds?: number | null;
  /** An unresolved dispute exists against a payment for this subscription. */
  disputeOpen?: boolean;
  /** A dispute was lost, or a payment was fully refunded. */
  accessRevoked?: boolean;
  /** Scheduled cancellation boundary, if one is set. */
  cancelAtUnixSeconds?: number | null;
};

/**
 * Reduces Stripe state to the membership state the access policy is written
 * against. Revocation outranks every other signal, then an open dispute, then
 * the past-due grace window.
 */
export function resolveMembershipState(
  signal: SubscriptionSignal,
  nowMillis: number
): MembershipState {
  if (signal.accessRevoked) return "revoked";
  if (signal.disputeOpen) return "disputed";

  switch (signal.stripeStatus) {
  case "trialing":
  case "active":
    if (signal.cancelAtUnixSeconds && signal.cancelAtUnixSeconds * 1000 <= nowMillis) {
      return "cancelled";
    }
    return "active";
  case "past_due":
    return isWithinPastDueGrace(signal.pastDueSinceUnixSeconds, nowMillis) ?
      "past_due_grace" :
      "past_due_suspended";
  case "unpaid":
    return "past_due_suspended";
  case "canceled":
    return "cancelled";
  case "incomplete":
    return "incomplete";
  case "incomplete_expired":
    return "cancelled";
  default:
    return "incomplete";
  }
}

/**
 * Three calendar days of grace from the failed due date, counted on London
 * calendar dates so the member is never cut off early by a clock offset.
 */
export function isWithinPastDueGrace(
  pastDueSinceUnixSeconds: number | null | undefined,
  nowMillis: number
): boolean {
  const graceEndMillis = resolvePastDueGraceEndMillis(pastDueSinceUnixSeconds);
  return graceEndMillis === null || nowMillis <= graceEndMillis;
}

/**
 * Absolute end of the approved London-calendar grace period.
 *
 * Persisting this deadline lets a UTC scheduler revoke access even when no
 * later Stripe event arrives. Milliseconds preserve the inclusive final
 * millisecond of the third calendar day across both GMT and BST transitions.
 */
export function resolvePastDueGraceEndMillis(
  pastDueSinceUnixSeconds: number | null | undefined
): number | null {
  if (!pastDueSinceUnixSeconds) return null;

  const failedDay = DateTime.fromSeconds(pastDueSinceUnixSeconds, {zone: BILLING_TIMEZONE})
    .startOf("day");
  return failedDay
    .plus({days: BILLING_POLICY.pastDueGraceDays})
    .endOf("day")
    .toMillis();
}

/** Membership states that keep the purchased service available. */
export function isMembershipStateEntitled(state: MembershipState): boolean {
  return state === "active" || state === "past_due_grace";
}

/** States that block a second purchase (duplicate-subscription guard). */
export function isMembershipStateBlockingDuplicate(state: MembershipState): boolean {
  return state === "active" ||
    state === "past_due_grace" ||
    state === "past_due_suspended" ||
    state === "disputed" ||
    state === "incomplete";
}

export type EntitlementDecision = {
  entitlementStatus: "none" | "active" | "restricted";
  entitlementSource: "none" | "stripe";
  /** Why the decision was made; stored on the audit trail. */
  reason: string;
};

/**
 * Maps a membership to the Phase 0 entitlement pair.
 *
 * Only a plan that grants AlphaWOD access can move a member's entitlement.
 * Every other plan leaves AlphaWOD entitlement untouched, because those
 * memberships do not include app access (Membership Terms 8).
 */
export function resolveEntitlementForMembership(
  planKey: PlanKey,
  state: MembershipState
): EntitlementDecision | null {
  if (!getPlan(planKey).grantsAlphaWodAccess) return null;

  if (isMembershipStateEntitled(state)) {
    return {
      entitlementStatus: "active",
      entitlementSource: "stripe",
      reason: `membership_${state}`,
    };
  }

  if (state === "revoked" || state === "cancelled") {
    return {
      entitlementStatus: "none",
      entitlementSource: "none",
      reason: `membership_${state}`,
    };
  }

  return {
    entitlementStatus: "restricted",
    entitlementSource: "stripe",
    reason: `membership_${state}`,
  };
}
