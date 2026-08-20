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

/**
 * Founding presale commercial boundary.
 *
 * The recurring Stripe anchor is deliberately midnight UTC. During BST this
 * is 01:00 in London, but it keeps Stripe's recurring day-of-month on the
 * first instead of encoding 31 August and drifting onto month-end. Customer
 * copy therefore presents the date only: 1 September 2026.
 */
export const PRESALE_BILLING_ANCHOR_AT_ISO = "2026-09-01T00:00:00.000Z";
export const PRESALE_BILLING_ANCHOR_UNIX_SECONDS = 1788220800;

/** New presale intents stop at midnight London on opening day. */
export const PRESALE_SIGNUP_CUTOFF_AT_ISO = "2026-08-31T23:00:00.000Z";
export const PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS = 1788217200;

/** Approved existing-member offer. Stripe Coupon/Promotion Codes are mode-specific. */
export const EXISTING_MEMBER_OFFER = {
  planKey: "adult_unlimited",
  amountOffPence: 500,
  currency: BILLING_CURRENCY,
  durationMonths: 3,
  // The app, rather than a provider timestamp, closes new redemptions at local
  // midnight. Staff deactivate the shared Promotion Code when the campaign is
  // finished; keeping provider expiry unset also preserves frozen Sessions.
  redemptionClosesAtUnixSeconds: PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS,
  promotionCodeExpiresAtUnixSeconds: null,
} as const;

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
  registeredOffice: "PENDING_VERIFICATION",
  registrationJurisdiction: "PENDING_VERIFICATION",
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
  adultPayerMustBeParticipant: true,
} as const;

/** ---------------------------------------------------------------
 * Approved customer-facing copy
 * -------------------------------------------------------------- */
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

export type CheckoutDocumentKey =
  | "membershipTerms"
  | "cancellationPolicy"
  | "privacyNotice"
  | "adultWaiver"
  | "guardianAddendum";

export type CheckoutDocument = {
  key: CheckoutDocumentKey;
  title: string;
  version: string;
  effectiveDate: string;
  publicUrl: string;
  contentType: "text/plain; charset=utf-8";
  hashCovers: "UTF-8 bytes of content";
  sha256: string;
  content: string;
};

/**
 * Aggregate canonical UTF-8 copy budget for every checkout document. The
 * checkout outbox also stores rendered HTML and base64 attachments, so this
 * deliberately leaves ample headroom below Firestore's document-size limit.
 */
export const CHECKOUT_DOCUMENT_CONTENT_BUDGET_BYTES = 96 * 1024;

/**
 * Immutable legal-copy registry used by checkout, acceptance evidence and the
 * confirmation email. The content and hashes are deliberate legal-review
 * placeholders: the publication gate below cannot be opened until counsel's
 * final text replaces them and each real SHA-256 digest has been recorded.
 */
export const CHECKOUT_DOCUMENTS = {
  membershipTerms: {
    key: "membershipTerms",
    title: "Membership Terms",
    version: "ZAF-TERMS-DRAFT-2026-08-17-01",
    effectiveDate: "PENDING_LEGAL_APPROVAL",
    publicUrl: "/legal/memberships/ZAF-TERMS-DRAFT-2026-08-17-01.txt",
    contentType: "text/plain; charset=utf-8",
    hashCovers: "UTF-8 bytes of content",
    sha256: "PENDING_LEGAL_APPROVAL",
    content: "DRAFT FOR LEGAL REVIEW — NOT APPROVED FOR PUBLICATION\n\nThis immutable placeholder identifies the Membership Terms working draft ZAF-TERMS-DRAFT-2026-08-17-01. The approved customer-facing text and its SHA-256 digest must replace this placeholder before public checkout is enabled.\n",
  },
  cancellationPolicy: {
    key: "cancellationPolicy",
    title: "Cancellation, Refund and Cooling-off Policy",
    version: "ZAF-CANCEL-DRAFT-2026-08-17-01",
    effectiveDate: "PENDING_LEGAL_APPROVAL",
    publicUrl: "/legal/memberships/ZAF-CANCEL-DRAFT-2026-08-17-01.txt",
    contentType: "text/plain; charset=utf-8",
    hashCovers: "UTF-8 bytes of content",
    sha256: "PENDING_LEGAL_APPROVAL",
    content: "DRAFT FOR LEGAL REVIEW — NOT APPROVED FOR PUBLICATION\n\nThis immutable placeholder identifies the Cancellation, Refund and Cooling-off Policy working draft ZAF-CANCEL-DRAFT-2026-08-17-01. The approved customer-facing text and its SHA-256 digest must replace this placeholder before public checkout is enabled.\n",
  },
  privacyNotice: {
    key: "privacyNotice",
    title: "Privacy Notice",
    version: "ZAF-PRIVACY-DRAFT-2026-08-17-01",
    effectiveDate: "PENDING_LEGAL_APPROVAL",
    publicUrl: "/legal/memberships/ZAF-PRIVACY-DRAFT-2026-08-17-01.txt",
    contentType: "text/plain; charset=utf-8",
    hashCovers: "UTF-8 bytes of content",
    sha256: "PENDING_LEGAL_APPROVAL",
    content: "DRAFT FOR LEGAL REVIEW — NOT APPROVED FOR PUBLICATION\n\nThis immutable placeholder identifies the Privacy Notice working draft ZAF-PRIVACY-DRAFT-2026-08-17-01. The approved customer-facing text and its SHA-256 digest must replace this placeholder before public checkout is enabled.\n",
  },
  adultWaiver: {
    key: "adultWaiver",
    title: "Adult Participant Waiver and Risk Acknowledgement",
    version: "ZAF-ADULT-WAIVER-DRAFT-2026-08-17-01",
    effectiveDate: "PENDING_LEGAL_APPROVAL",
    publicUrl: "/legal/memberships/ZAF-ADULT-WAIVER-DRAFT-2026-08-17-01.txt",
    contentType: "text/plain; charset=utf-8",
    hashCovers: "UTF-8 bytes of content",
    sha256: "PENDING_LEGAL_APPROVAL",
    content: "DRAFT FOR LEGAL REVIEW — NOT APPROVED FOR PUBLICATION\n\nThis immutable placeholder identifies the Adult Participant Waiver and Risk Acknowledgement working draft ZAF-ADULT-WAIVER-DRAFT-2026-08-17-01. The approved customer-facing text and its SHA-256 digest must replace this placeholder before public checkout is enabled.\n",
  },
  guardianAddendum: {
    key: "guardianAddendum",
    title: "Parent/Guardian Consent and Youth Membership Addendum",
    version: "ZAF-GUARDIAN-DRAFT-2026-08-17-01",
    effectiveDate: "PENDING_LEGAL_APPROVAL",
    publicUrl: "/legal/memberships/ZAF-GUARDIAN-DRAFT-2026-08-17-01.txt",
    contentType: "text/plain; charset=utf-8",
    hashCovers: "UTF-8 bytes of content",
    sha256: "PENDING_LEGAL_APPROVAL",
    content: "DRAFT FOR LEGAL REVIEW — NOT APPROVED FOR PUBLICATION\n\nThis immutable placeholder identifies the Parent/Guardian Consent and Youth Membership Addendum working draft ZAF-GUARDIAN-DRAFT-2026-08-17-01. The approved customer-facing text and its SHA-256 digest must replace this placeholder before public checkout is enabled.\n",
  },
} as const;

export type CheckoutAcceptanceId =
  | "membership_contract"
  | "privacy_notice"
  | "adult_participant_waiver"
  | "guardian_youth_addendum"
  | "guardian_authority"
  | "recurring_payment_authority"
  | "immediate_performance";

export type CheckoutAcceptanceStatement = {
  id: CheckoutAcceptanceId;
  statement: string;
  documentKeys: readonly CheckoutDocumentKey[];
};

export type CheckoutSignerRole =
  | "adult_participant_and_payer"
  | "youth_guardian_and_payer";

export type CommercialPlanSnapshot = {
  catalogueSchemaVersion: number;
  planKey: PlanKey;
  planName: string;
  audience: PlanAudience;
  summary: string;
  amountPence: number;
  currency: typeof BILLING_CURRENCY;
  billingInterval: "month";
  billingIntervalCount: 1;
  monthlyAnchorDayOfMonth: number;
  joiningFeePence: number;
  minimumTermMonths: number;
  trialDays: number;
  vatRegistered: boolean;
  automaticTaxEnabled: boolean;
  grantsAlphaWodAccess: boolean;
  minAge: number;
  maxAge: number | null;
  cancellationNoticeDays: number;
  pauseAllowed: boolean;
};

export function resolveCheckoutDocuments(planKey: PlanKey): CheckoutDocument[] {
  const plan = getPlan(planKey);
  const keys: CheckoutDocumentKey[] = [
    "membershipTerms",
    "cancellationPolicy",
    "privacyNotice",
    plan.audience === "youth" ? "guardianAddendum" : "adultWaiver",
  ];
  return keys.map((key) => ({...CHECKOUT_DOCUMENTS[key]}));
}

export function resolveCheckoutAcceptanceStatements(
  planKey: PlanKey
): CheckoutAcceptanceStatement[] {
  const plan = getPlan(planKey);
  const common: CheckoutAcceptanceStatement[] = [
    {
      id: "membership_contract",
      statement: "I have read and agree to the Membership Terms and the Cancellation, Refund and Cooling-off Policy. I confirm that the participant and payer or guardian details I supplied are accurate.",
      documentKeys: ["membershipTerms", "cancellationPolicy"],
    },
    {
      id: "privacy_notice",
      statement: "I acknowledge that I have received and read the Privacy Notice explaining how personal information is used.",
      documentKeys: ["privacyNotice"],
    },
    ...(plan.audience === "youth" ? [
      {
        id: "guardian_authority" as const,
        statement: "I confirm that I am aged 18 or over, I am the named child's parent or legal guardian or otherwise have lawful authority to enrol them, and I am the payer.",
        documentKeys: [] as CheckoutDocumentKey[],
      },
      {
        id: "guardian_youth_addendum" as const,
        statement: "I have read and agree to the Parent/Guardian Consent and Youth Membership Addendum. I understand the activities and inherent risks and consent to the child's participation, subject to their statutory rights and Zero Alpha Fitness's duty to take reasonable care.",
        documentKeys: ["guardianAddendum"] as CheckoutDocumentKey[],
      },
    ] : [
      {
        id: "adult_participant_waiver" as const,
        statement: "I confirm that I am the named participant, I am aged 18 or over, and I have read and understood the Adult Participant Waiver and Risk Acknowledgement. I understand the activities and inherent risks and choose to participate, subject to my statutory rights and Zero Alpha Fitness's duty to take reasonable care.",
        documentKeys: ["adultWaiver"] as CheckoutDocumentKey[],
      },
    ]),
    {
      id: "recurring_payment_authority",
      statement: `I authorise the amount Stripe shows today and future recurring monthly payments for ${plan.name} on the billing schedule shown at checkout. The standard monthly price is ${formatPence(plan.amountPence)}; Stripe will show any verified promotion and when the standard price resumes. This authority is subject to my cancellation and statutory rights.`,
      documentKeys: [],
    },
    {
      id: "immediate_performance",
      statement: POLICY_TEXT.coolingOffConsent,
      documentKeys: [],
    },
  ];
  return common;
}

export function resolveCheckoutSignerRole(planKey: PlanKey): CheckoutSignerRole {
  return getPlan(planKey).audience === "youth" ?
    "youth_guardian_and_payer" : "adult_participant_and_payer";
}

export function createCommercialPlanSnapshot(planKey: PlanKey): CommercialPlanSnapshot {
  const plan = getPlan(planKey);
  return {
    catalogueSchemaVersion: MEMBERSHIP_SCHEMA_VERSION,
    planKey: plan.key,
    planName: plan.name,
    audience: plan.audience,
    summary: plan.summary,
    amountPence: plan.amountPence,
    currency: plan.currency,
    billingInterval: "month",
    billingIntervalCount: 1,
    monthlyAnchorDayOfMonth: BILLING_POLICY.monthlyAnchorDayOfMonth,
    joiningFeePence: BILLING_POLICY.joiningFeePence,
    minimumTermMonths: BILLING_POLICY.minimumTermMonths,
    trialDays: BILLING_POLICY.trialDays,
    vatRegistered: BILLING_POLICY.vatRegistered,
    automaticTaxEnabled: BILLING_POLICY.automaticTaxEnabled,
    grantsAlphaWodAccess: plan.grantsAlphaWodAccess,
    minAge: plan.minAge,
    maxAge: plan.maxAge,
    cancellationNoticeDays: BILLING_POLICY.cancellationNoticeDays,
    pauseAllowed: BILLING_POLICY.pauseAllowed,
  };
}

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
  /** Unix seconds of the next first-of-month boundary at 00:00 UTC. */
  anchorUnixSeconds: number;
  /** ISO date (YYYY-MM-DD) of the first full monthly charge. */
  firstFullChargeDate: string;
};

/** Stripe requires Checkout Sessions to remain open for at least 30 minutes. */
export const STRIPE_MIN_CHECKOUT_WINDOW_SECONDS = 30 * 60;

/** Network/clock allowance so Stripe still receives at least its 30m floor. */
export const CHECKOUT_CREATION_MARGIN_SECONDS = 5 * 60;

/** A presale Session may finish shortly before its fixed first-payment anchor. */
export const PRESALE_CHECKOUT_ANCHOR_MARGIN_SECONDS = 5 * 60;

/**
 * Keep a full hour between standard Checkout expiry and its recurring anchor.
 * Besides ensuring the anchor is still in the future when payment completes,
 * this leaves a small operational buffer for Stripe to finalise the session.
 */
export const CHECKOUT_ANCHOR_MARGIN_SECONDS = 60 * 60;

function londonNow(nowMillis: number): DateTime {
  return DateTime.fromMillis(nowMillis, {zone: BILLING_TIMEZONE});
}

/**
 * Derives the next calendar month from the Europe/London business date, then
 * constructs its first day at 00:00 UTC. Keeping the provider timestamp on UTC
 * day 1 prevents a BST London-midnight anchor from becoming UTC day 31 and
 * drifting onto month-end in Stripe.
 */
export function resolveBillingCycleAnchor(nowMillis: number): BillingAnchor {
  const nextLocalMonth = londonNow(nowMillis)
    .plus({months: 1})
    .startOf("month");
  const anchor = DateTime.utc(nextLocalMonth.year, nextLocalMonth.month, 1);

  return {
    anchorUnixSeconds: Math.floor(anchor.toSeconds()),
    firstFullChargeDate: nextLocalMonth.toISODate() as string,
  };
}

export type CheckoutBillingPolicy = {
  kind: "presale" | "standard";
  billingMode: "presale_deferred" | "standard";
  billingCycleAnchor: number;
  firstFullChargeDate: string;
  serviceStartsAtUnixSeconds: number;
  firstPaymentAtUnixSeconds: number;
  prorationBehavior: "none" | "create_prorations";
  paymentDueToday: boolean;
};

/**
 * Freezes the one-off founding presale without changing the ongoing policy.
 * Before local opening midnight Checkout saves a payment method and charges
 * £0. Service starts at that London boundary and recurring billing follows on
 * the fixed midnight-UTC anchor one hour later. At and after the cutoff, the
 * normal immediate-start, prorated-to-next-first policy resumes.
 */
export function resolveCheckoutBillingPolicy(nowMillis: number): CheckoutBillingPolicy {
  if (nowMillis < PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS * 1000) {
    return {
      kind: "presale",
      billingMode: "presale_deferred",
      billingCycleAnchor: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
      firstFullChargeDate: "2026-09-01",
      serviceStartsAtUnixSeconds: PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS,
      firstPaymentAtUnixSeconds: PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
      prorationBehavior: "none",
      paymentDueToday: false,
    };
  }

  const anchor = resolveBillingCycleAnchor(nowMillis);
  return {
    kind: "standard",
    billingMode: "standard",
    billingCycleAnchor: anchor.anchorUnixSeconds,
    firstFullChargeDate: anchor.firstFullChargeDate,
    serviceStartsAtUnixSeconds: Math.floor(nowMillis / 1000),
    firstPaymentAtUnixSeconds: Math.floor(nowMillis / 1000),
    prorationBehavior: "create_prorations",
    paymentDueToday: true,
  };
}

/**
 * Latest moment a Checkout Session may stay open. Stripe rejects a
 * `billing_cycle_anchor` that is no longer in the future, so a session must
 * never survive past the anchor it was created against.
 */
export function resolveCheckoutSessionExpiry(nowMillis: number): number {
  const now = londonNow(nowMillis);
  const policy = resolveCheckoutBillingPolicy(nowMillis);
  const anchorUnixSeconds = policy.billingCycleAnchor;
  const maxStripeExpiry = Math.floor(now.plus({hours: 24}).toSeconds());
  const safeMinStripeExpiry = Math.floor(now.toSeconds()) +
    STRIPE_MIN_CHECKOUT_WINDOW_SECONDS + CHECKOUT_CREATION_MARGIN_SECONDS;
  const anchorMargin = policy.kind === "presale" ?
    PRESALE_CHECKOUT_ANCHOR_MARGIN_SECONDS : CHECKOUT_ANCHOR_MARGIN_SECONDS;
  const beforeAnchor = anchorUnixSeconds - anchorMargin;

  // Never force Stripe's minimum beyond the frozen safe provider boundary.
  // The presale's one-hour gap between cutoff and billing, less its five-minute
  // provider margin, deliberately lets every intent created before cutoff fit.
  // A standard checkout can still fall too close to its monthly anchor and is
  // refused rather than being given an unsafe expiry.
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
  "scheduled",
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
  /** Service boundary for a paid-method-collected presale subscription. */
  serviceStartsAtUnixSeconds?: number | null;
  /** A presale remains scheduled until the first recurring invoice is paid. */
  activationPendingFirstPayment?: boolean;
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
  if (signal.activationPendingFirstPayment &&
    (signal.stripeStatus === "past_due" || signal.stripeStatus === "unpaid")) {
    // Grace preserves access that was previously earned. A presale whose first
    // invoice failed has never earned access, so it must remain suspended.
    return "past_due_suspended";
  }

  switch (signal.stripeStatus) {
  case "trialing":
  case "active":
    if (signal.cancelAtUnixSeconds && signal.cancelAtUnixSeconds * 1000 <= nowMillis) {
      return "cancelled";
    }
    if (signal.activationPendingFirstPayment ||
      (signal.serviceStartsAtUnixSeconds &&
      signal.serviceStartsAtUnixSeconds * 1000 > nowMillis)) {
      return "scheduled";
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
  return state === "scheduled" ||
    state === "active" ||
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

  // A presale reserves ownership but must not project any entitlement before
  // the first invoice is paid. Returning null also preserves an existing
  // legacy/manual grant instead of prematurely replacing it with restricted.
  if (state === "scheduled") return null;

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
