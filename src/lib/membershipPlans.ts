/**
 * Frontend mirror of the canonical membership catalogue and billing policy.
 *
 * The authoritative copy is `functions/src/membershipPlans.ts`.
 * `membershipPlans.parity.test.ts` parses that file and fails this build if
 * the two ever drift, so plan pricing, ages, access rules, and customer-facing
 * policy text can only be changed in one place.
 *
 * Deliberately constants-only: every billing date, proration amount, and
 * cancellation deadline shown to a customer is computed server-side and
 * returned by a callable. The browser never calculates a chargeable amount.
 */

export const BILLING_TIMEZONE = "Europe/London";
export const BILLING_CURRENCY = "gbp";

/** Stripe's recurring anchor; customer copy presents the calendar date only. */
export const PRESALE_BILLING_ANCHOR_AT_ISO = "2026-09-01T00:00:00.000Z";
export const PRESALE_BILLING_ANCHOR_UNIX_SECONDS = 1788220800;

/** Presale and promotion redemption close at midnight London on opening day. */
export const PRESALE_SIGNUP_CUTOFF_AT_ISO = "2026-08-31T23:00:00.000Z";
export const PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS = 1788217200;

export const EXISTING_MEMBER_OFFER = {
  planKey: "adult_unlimited",
  amountOffPence: 500,
  currency: BILLING_CURRENCY,
  durationMonths: 3,
  redemptionClosesAtUnixSeconds: PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS,
} as const;

export const COMPANY = {
  legalName: "ZERO ALPHA FITNESS LTD",
  tradingName: "Zero Alpha Fitness",
  companyNumber: "15978998",
  address: "Unit 3, Felinfoel Business Hub, Llanelli, SA14 8BE",
  supportEmail: "support@zeroalphafitness.co.uk",
  confirmationSender: "hello@zeroalphafitness.co.uk",
} as const;

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
  name: string;
  amountPence: number;
  currency: typeof BILLING_CURRENCY;
  minAge: number;
  maxAge: number | null;
  grantsAlphaWodAccess: boolean;
  stripePriceEnvKey: string;
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

export const BILLING_POLICY = {
  monthlyAnchorDayOfMonth: 1,
  cancellationNoticeDays: 14,
  pastDueGraceDays: 3,
  coolingOffDays: 14,
  joiningFeePence: 0,
  minimumTermMonths: 0,
  trialDays: 0,
  pauseAllowed: false,
  portalCancellationEnabled: false,
  portalPauseEnabled: false,
  vatRegistered: false,
  automaticTaxEnabled: false,
  collectBillingAddress: false,
  collectPhoneNumber: false,
  blockDuplicateActiveSubscriptions: true,
  guardianMustBePayerForYouth: true,
  adultPayerMustBeParticipant: true,
} as const;

export const POLICY_TEXT = {
  refund: "Payments are non-refundable except where required by law.",
  rollingTerm: "There is no joining fee, free trial or minimum term. Each membership is a rolling monthly contract until cancelled.",
  cancellationRule: "To avoid the next first-of-month payment, your cancellation request must reach us at least 14 calendar days before that billing date. If it reaches us less than 14 days before the next first, that payment remains due and your membership ends at the end of the additional paid month.",
  presaleRule: "Join before opening and nothing is charged today. Stripe securely saves your payment method, your membership starts on 1 September 2026, and the first monthly payment is taken then.",
  existingMemberOffer: "Eligible existing members can use the discount code for £5 off each of the first three monthly payments on Adult Unlimited Membership. The standard £60 monthly price applies after that.",
  prorationRule: "After opening, all memberships bill on the first of each calendar month. If your membership starts after the first, Stripe calculates and displays an initial prorated charge for the period until the next first of the month, payable immediately.",
  prorationAuthority: "The amount Stripe displays before confirmation is authoritative for that checkout. A presale checkout must show £0 due today and a first payment date of 1 September 2026. We do not calculate a separate charge in the browser. If the displayed amount or billing date appears wrong, do not confirm; contact us first.",
  pastDue: "After a membership has started, a failed payment enters a three-calendar-day past-due grace period and existing access continues temporarily. If the first scheduled payment fails, the membership and AlphaWOD access do not start.",
  dispute: "An open payment dispute suspends related access. A dispute resolved in our favour restores eligible access promptly. A lost dispute or full refund revokes related access.",
  noPause: "Membership cannot be paused, frozen or placed on holiday hold.",
  coolingOffConsent: "I expressly request that the membership and any eligible AlphaWOD access begin on the service start date shown, even if that is before the 14-day cooling-off period ends. I understand that, if I cancel during that period, Zero Alpha Fitness may retain or charge only the proportionate amount permitted by law for services supplied before cancellation.",
  scheduledYouthSuccess: "You're signed up. Nothing has been charged today. This membership starts and the first monthly payment is taken on 1 September 2026. Zero Alpha Fitness will contact you by email to arrange onboarding and the first session.",
  scheduledAdultUnlimitedSuccess: "You're signed up. Nothing has been charged today. Your Adult Unlimited membership starts, the first monthly payment is taken, and eligible AlphaWOD access can begin on 1 September 2026.",
  scheduledAdultOtherSuccess: "You're signed up. Nothing has been charged today. This membership starts and the first monthly payment is taken on 1 September 2026. Zero Alpha Fitness will contact you by email to arrange onboarding and the first session.",
  youthSuccess: "Payment confirmed. Zero Alpha Fitness will contact you by email to arrange onboarding and your first session. Questions: support@zeroalphafitness.co.uk.",
  adultUnlimitedSuccess: "Payment confirmed. Your Adult Unlimited membership is active and eligible AlphaWOD access has been unlocked.",
  adultOtherSuccess: "Payment confirmed. Zero Alpha Fitness will contact you by email to arrange onboarding and your first session. Questions: support@zeroalphafitness.co.uk.",
  duplicateBlocked: "This account already has an active or scheduled membership. Manage or cancel the existing membership before buying another one.",
  portalScope: "The secure Customer Portal is for updating your payment method and viewing invoices. Cancellation is handled by the request flow on this page.",
  guardianRequirement: "For a participant under 18, the payer must be their parent or legal guardian, or another adult with lawful authority to enter this arrangement for them.",
} as const;

export const CHECKOUT_DOCUMENTS = {
  membershipTerms: "ZAF-TERMS-DRAFT-2026-08-17-01",
  cancellationPolicy: "ZAF-CANCEL-DRAFT-2026-08-17-01",
  privacyNotice: "ZAF-PRIVACY-DRAFT-2026-08-17-01",
  adultWaiver: "ZAF-ADULT-WAIVER-DRAFT-2026-08-17-01",
  guardianAddendum: "ZAF-GUARDIAN-DRAFT-2026-08-17-01",
} as const;

export const CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION = false;

export const PLAN_LIST: MembershipPlan[] = PLAN_KEYS.map((key) => MEMBERSHIP_PLANS[key]);

export function isPlanKey(value: unknown): value is PlanKey {
  return typeof value === "string" && (PLAN_KEYS as readonly string[]).includes(value);
}

export function getPlan(key: PlanKey): MembershipPlan {
  return MEMBERSHIP_PLANS[key];
}

/** One-off founding presale boundary used only to choose truthful UI copy. */
export function isFoundingPresale(nowMillis: number = Date.now()): boolean {
  return nowMillis < PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS * 1000;
}

/** Mirrors the server funnel rule: under 12 is Youngstars, 12+ is Teenstars. */
export function resolveYouthPlanForAge(age: number): PlanKey | null {
  if (!Number.isInteger(age)) return null;
  if (age >= 4 && age < 12) return "youth_youngstars";
  if (age >= 12 && age <= 16) return "youth_teenstars";
  return null;
}

export function isAgeEligibleForPlan(plan: MembershipPlan, age: number): boolean {
  if (!Number.isInteger(age) || age < 0) return false;
  if (age < plan.minAge) return false;
  if (plan.maxAge !== null && age > plan.maxAge) return false;
  return true;
}

/**
 * Age used only to steer the form and show an early warning. The callable
 * recomputes it from the same date of birth and is the authority for
 * eligibility.
 */
export function resolveDisplayAge(dateOfBirthIso: string, now: Date = new Date()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirthIso)) return null;

  const [year, month, day] = dateOfBirthIso.split("-").map(Number);
  const dob = new Date(Date.UTC(year, month - 1, day));
  if (
    dob.getUTCFullYear() !== year ||
    dob.getUTCMonth() !== month - 1 ||
    dob.getUTCDate() !== day
  ) {
    return null;
  }

  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  if (dob > today) return null;

  let age = today.getUTCFullYear() - year;
  const hadBirthday =
    today.getUTCMonth() > dob.getUTCMonth() ||
    (today.getUTCMonth() === dob.getUTCMonth() && today.getUTCDate() >= dob.getUTCDate());
  if (!hadBirthday) age -= 1;

  return age >= 0 && age <= 120 ? age : null;
}

export function formatPlanPrice(plan: MembershipPlan): string {
  const pounds = plan.amountPence / 100;
  const formatted = Number.isInteger(pounds) ? String(pounds) : pounds.toFixed(2);
  return `£${formatted}`;
}
