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

/** New presale intents stop at midnight London on opening day. */
export const PRESALE_SIGNUP_CUTOFF_AT_ISO = "2026-08-31T23:00:00.000Z";
export const PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS = 1788217200;

export const EXISTING_MEMBER_OFFER = {
  planKey: "adult_unlimited",
  amountOffPence: 500,
  currency: BILLING_CURRENCY,
  durationMonths: 3,
  redemptionClosesAtUnixSeconds: PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS,
  promotionCodeExpiresAtUnixSeconds: null,
} as const;

/** Catalogue schema version frozen into every checkout commercial snapshot. */
export const MEMBERSHIP_SCHEMA_VERSION = 1;

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

/** Formats pence exactly as the server does in stored acceptance statements. */
export function formatPence(amountPence: number): string {
  return `£${(amountPence / 100).toFixed(2)}`;
}
