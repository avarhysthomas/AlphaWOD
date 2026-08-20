/* eslint-disable
  require-jsdoc,
  valid-jsdoc,
  max-len,
  @typescript-eslint/no-explicit-any
*/

/**
 * Phase 1: public membership purchase, Stripe Billing, and the membership
 * state that drives AlphaWOD entitlement.
 *
 * Design rules carried over from Phase 0 and the approved policy documents:
 *
 * - Firestore documents, never client input and never ID-token claims, are
 *   authoritative for access. Every entitlement change here goes through the
 *   same `resolveUserAuthorisation` derivation the rest of the app uses.
 * - Stripe is the authority for subscription state. Webhook payloads are
 *   treated only as a signal to re-read the subscription, so an out-of-order
 *   delivery can never install stale access.
 * - The browser never computes a chargeable amount or a billing date. Stripe
 *   calculates the proration; the server calculates every cancellation date.
 * - Participant and guardian details are written by the server only and are
 *   never exposed to client rules.
 */

import {onCall, onRequest, HttpsError} from "firebase-functions/v2/https";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {defineSecret, defineString} from "firebase-functions/params";
import * as admin from "firebase-admin";
import {
  DocumentReference,
  DocumentSnapshot,
  FieldValue,
  Firestore,
  QueryDocumentSnapshot,
  QuerySnapshot,
  Timestamp,
  Transaction,
} from "firebase-admin/firestore";
import {createHash, randomUUID} from "crypto";
import Stripe from "stripe";
import {
  BILLING_POLICY,
  CheckoutAcceptanceId,
  CheckoutAcceptanceStatement,
  CheckoutDocument,
  CheckoutSignerRole,
  CommercialPlanSnapshot,
  CHECKOUT_DOCUMENT_CONTENT_BUDGET_BYTES,
  CHECKOUT_DOCUMENTS,
  COMPANY,
  EXISTING_MEMBER_OFFER,
  formatBillingDate,
  formatPence,
  formatUnixBillingDate,
  formatUnixBillingIsoDate,
  CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION,
  MEMBERSHIP_SCHEMA_VERSION,
  MembershipState,
  PLAN_KEYS,
  PRESALE_BILLING_ANCHOR_UNIX_SECONDS,
  PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS,
  PlanKey,
  POLICY_TEXT,
  createCommercialPlanSnapshot,
  getPlan,
  isAgeEligibleForPlan,
  isMembershipStateBlockingDuplicate,
  isPlanKey,
  resolveAgeFromDateOfBirth,
  resolveCancellationOutcome,
  resolveCheckoutBillingPolicy,
  resolveCheckoutAcceptanceStatements,
  resolveCheckoutDocuments,
  resolveCheckoutSignerRole,
  resolveCheckoutSessionExpiry,
  resolveCoolingOffEnd,
  resolveEntitlementForMembership,
  resolveMembershipState,
  resolvePastDueGraceEndMillis,
} from "./membershipPlans";
import {
  ACCESS_SCHEMA_VERSION,
  EntitlementSource,
  EntitlementStatus,
  isApprovalStatus,
  isEntitlementCompatibleWithRole,
  isUserRole,
  resolveUserAuthorisation,
} from "./authz";
import {
  CheckoutAttemptFingerprintMismatchError,
  CheckoutRateLimitExceededError,
  CheckoutRateLimitStateError,
  admitEarlyMembershipCheckoutRequest,
  admitMembershipCheckoutAttempt,
  deriveCheckoutSourceHash,
} from "./membershipCheckoutAbuse";
import {
  MEMBERSHIP_CANCELLATION_RECEIPT_COLLECTION,
  MembershipCancellationReceipt,
  assertMembershipCancellationReceipt,
  buildCancellationAcknowledgementPayload,
  buildCoolingOffCancellationReceipt,
  buildMembershipCancellationProjection,
  cancellationAcknowledgementIdempotencyKey,
  cancellationAcknowledgementOutboxId,
} from "./membershipCancellation";
import {
  APPROVED_LIVE_STRIPE_CATALOGUE,
  matchesApprovedLiveStripeCatalogueEntry,
} from "./stripeLiveCatalog";

const REGION = "europe-west1";

/**
 * Region is set explicitly on every definition rather than relying on the
 * global option in index.ts, because module import order decides whether that
 * global has been applied when these definitions are evaluated.
 */
const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");
const resendApiKey = defineSecret("RESEND_API_KEY");
const membershipCheckoutRateLimitSecret = defineSecret(
  "MEMBERSHIP_CHECKOUT_RATE_LIMIT_SECRET"
);
const membershipFromEmail = defineString("MEMBERSHIP_FROM_EMAIL", {
  default: COMPANY.confirmationSender,
});

const appPublicOrigin = defineString("APP_PUBLIC_ORIGIN", {
  default: "https://alpha-wod.vercel.app",
});
const stripePortalConfigurationId = defineString("STRIPE_PORTAL_CONFIGURATION_ID", {
  default: "",
});
const membershipPurchaseEnabled = defineString("MEMBERSHIP_PURCHASE_ENABLED", {
  default: "false",
});
const membershipTestJourneyEnabled = defineString("MEMBERSHIP_TEST_JOURNEY_ENABLED", {
  default: "false",
});
const membershipFirebaseProjectId = defineString("MEMBERSHIP_FIREBASE_PROJECT_ID", {
  default: "",
});
const membershipCheckoutAppId = defineString("MEMBERSHIP_CHECKOUT_APP_ID", {
  default: "",
});
const stripeExpectedMode = defineString("STRIPE_EXPECTED_MODE", {
  default: "",
});
const stripeExistingMemberCouponId = defineString(
  "STRIPE_EXISTING_MEMBER_COUPON_ID",
  {default: ""}
);
const stripeExistingMemberPromotionCodeId = defineString(
  "STRIPE_EXISTING_MEMBER_PROMOTION_CODE_ID",
  {default: ""}
);

const priceParams: Record<PlanKey, ReturnType<typeof defineString>> = {
  adult_unlimited: defineString("STRIPE_PRICE_ADULT_UNLIMITED", {default: ""}),
  adult_ladies: defineString("STRIPE_PRICE_ADULT_LADIES", {default: ""}),
  adult_gym: defineString("STRIPE_PRICE_ADULT_GYM", {default: ""}),
  youth_youngstars: defineString("STRIPE_PRICE_YOUTH_YOUNGSTARS", {default: ""}),
  youth_teenstars: defineString("STRIPE_PRICE_YOUTH_TEENSTARS", {default: ""}),
};

const PRODUCTION_FIREBASE_PROJECT_ID = "alphawod-d1f2f";
const LOCAL_TEST_FIREBASE_PROJECT_ID = "demo-alphawod-stripe";
const LOCAL_TEST_JOURNEY_ORIGINS = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3002",
  "http://127.0.0.1:3002",
]);

/**
 * The emulator receives short-lived test credentials from its parent process.
 * Bindings are omitted only for the exact demo project with both data-plane
 * emulators on loopback. A production or partially configured process keeps
 * its normal Secret Manager bindings even if FUNCTIONS_EMULATOR is injected.
 */
function secretsForRuntime<T>(secrets: T[]): T[] {
  return isIsolatedLocalTestEmulatorProcess() ? [] : secrets;
}

export const MEMBERSHIP_SECRETS = secretsForRuntime([stripeSecretKey]);
export const MEMBERSHIP_CHECKOUT_SECRETS = secretsForRuntime([
  stripeSecretKey,
  membershipCheckoutRateLimitSecret,
]);
export const MEMBERSHIP_WEBHOOK_SECRETS = secretsForRuntime([
  stripeSecretKey,
  stripeWebhookSecret,
]);
export const MEMBERSHIP_STRIPE_WORKER_SECRETS = secretsForRuntime([stripeSecretKey]);
export const MEMBERSHIP_EMAIL_WORKER_SECRETS = secretsForRuntime([resendApiKey]);

/**
 * Firestore and Stripe clients are resolved lazily. `admin.initializeApp()`
 * runs in the body of index.ts, which executes after this module is imported.
 */
function db(): Firestore {
  return admin.firestore();
}

let stripeClient: Stripe | null = null;

type StripeMode = "test" | "live";

type BillingEnvironment = {
  projectId: string;
  stripeMode: StripeMode;
  expectedLivemode: boolean;
};

function isFirebaseFunctionsEmulatorProcess(): boolean {
  return process.env.FUNCTIONS_EMULATOR === "true";
}

function isLoopbackEmulatorHost(value: string | undefined): boolean {
  return typeof value === "string" &&
    /^(127\.0\.0\.1|localhost):\d+$/.test(value);
}

function hasLoopbackFirebaseEmulatorDataPlane(): boolean {
  return isFirebaseFunctionsEmulatorProcess() &&
    isLoopbackEmulatorHost(process.env.FIRESTORE_EMULATOR_HOST) &&
    isLoopbackEmulatorHost(process.env.FIREBASE_AUTH_EMULATOR_HOST);
}

/** Resolves the Firebase project identity Cloud Functions actually supplied. */
function runtimeFirebaseProjectId(): string {
  const direct = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  if (direct?.trim()) return direct.trim();

  try {
    const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG || "{}") as {
      projectId?: unknown;
    };
    return typeof firebaseConfig.projectId === "string" ?
      firebaseConfig.projectId.trim() : "";
  } catch {
    return "";
  }
}

/** The only runtime allowed to receive memory-only local test credentials. */
function isIsolatedLocalTestEmulatorProcess(): boolean {
  return hasLoopbackFirebaseEmulatorDataPlane() &&
    runtimeFirebaseProjectId() === LOCAL_TEST_FIREBASE_PROJECT_ID;
}

/**
 * Binds one Firebase data plane to one explicit Stripe mode before any Stripe
 * network call. This prevents a test key being aimed at production Firestore,
 * or a live key being used from the isolated test project.
 */
function assertBillingEnvironment(): BillingEnvironment {
  const expectedProjectId = membershipFirebaseProjectId.value().trim();
  const projectId = runtimeFirebaseProjectId();
  if (!expectedProjectId || !projectId || expectedProjectId !== projectId) {
    throw new HttpsError(
      "failed-precondition",
      "Billing is disabled because the Firebase project identity is not explicitly matched."
    );
  }

  const rawMode = stripeExpectedMode.value().trim().toLowerCase();
  if (rawMode !== "test" && rawMode !== "live") {
    throw new HttpsError(
      "failed-precondition",
      "Billing is disabled because the expected Stripe mode is not configured."
    );
  }
  const stripeMode = rawMode as StripeMode;
  const key = stripeSecretKey.value().trim();
  const keyMode: StripeMode | null =
    key.startsWith("sk_test_") || key.startsWith("rk_test_") ? "test" :
      key.startsWith("sk_live_") || key.startsWith("rk_live_") ? "live" : null;
  if (keyMode !== stripeMode) {
    throw new HttpsError(
      "failed-precondition",
      "Billing is disabled because the Stripe key does not match the configured mode."
    );
  }
  if (projectId === PRODUCTION_FIREBASE_PROJECT_ID && stripeMode === "test") {
    throw new HttpsError(
      "failed-precondition",
      "Stripe test mode is forbidden in the production Firebase project."
    );
  }
  if (projectId === LOCAL_TEST_FIREBASE_PROJECT_ID && stripeMode !== "test") {
    throw new HttpsError(
      "failed-precondition",
      "Stripe live mode is forbidden in the isolated local Firebase project."
    );
  }
  if (isFirebaseFunctionsEmulatorProcess() && stripeMode === "live") {
    throw new HttpsError(
      "failed-precondition",
      "Stripe live mode is forbidden in every Firebase emulator process."
    );
  }

  return {
    projectId,
    stripeMode,
    expectedLivemode: stripeMode === "live",
  };
}

/** Refuses a provider object from the other half of Stripe's test/live split. */
function assertStripeObjectMode(
  objectType: string,
  objectId: string,
  livemode: unknown
): void {
  const environment = assertBillingEnvironment();
  if (typeof livemode !== "boolean" ||
    livemode !== environment.expectedLivemode) {
    console.error("CRITICAL_BILLING_STRIPE_MODE_MISMATCH", {
      projectId: environment.projectId,
      expectedStripeMode: environment.stripeMode,
      objectType,
      objectId,
      livemode: typeof livemode === "boolean" ? livemode : null,
    });
    throw new HttpsError(
      "failed-precondition",
      `Billing refused a ${objectType} from the wrong Stripe mode.`
    );
  }
}

/**
 * Optional API host override.
 *
 * Stripe documents host/port/protocol so an integration suite can run against
 * a local mock instead of the live API. It is read from the environment and is
 * never set in a deployed environment, so production always talks to Stripe.
 */
function stripeHostOptions(): Partial<Stripe.StripeConfig> {
  const host = process.env.STRIPE_API_HOST;
  if (!host) return {};

  if (!hasLoopbackFirebaseEmulatorDataPlane() ||
    stripeExpectedMode.value().trim().toLowerCase() !== "test") {
    throw new HttpsError(
      "failed-precondition",
      "The Stripe API host override is allowed only in the isolated emulator suite."
    );
  }

  return {
    host,
    port: Number(process.env.STRIPE_API_PORT || 12111),
    protocol: (process.env.STRIPE_API_PROTOCOL as "http" | "https") || "http",
  };
}

function stripe(): Stripe {
  assertBillingEnvironment();
  const key = stripeSecretKey.value();
  if (!key) {
    throw new HttpsError("failed-precondition", "Billing is not configured.");
  }
  if (!stripeClient) {
    stripeClient = new Stripe(key, {
      maxNetworkRetries: 2,
      timeout: 20000,
      ...stripeHostOptions(),
    });
  }
  return stripeClient;
}

const serverTimestamp = () => FieldValue.serverTimestamp();

/** ---------------------------------------------------------------
 * Stored document shapes (all server-owned)
 * -------------------------------------------------------------- */

type ParticipantRecord = {
  fullName: string;
  dateOfBirth: string;
  age: number;
  isPayer: boolean;
  /** Stable, non-reversible identity used for the duplicate-membership guard. */
  participantKey: string;
};

type GuardianRecord = {
  fullName: string;
  relationship: string;
  confirmedAuthority: true;
};

type CheckoutAcceptanceRecord = {
  signedName: string;
  signerRole: CheckoutSignerRole;
  /** Exact server-owned document contents shown for this plan and role. */
  documents: CheckoutDocument[];
  /** Exact server-owned statements individually accepted by the signer. */
  statements: CheckoutAcceptanceStatement[];
  acceptedStatementIds: CheckoutAcceptanceId[];
  /** Derived from the required exact statement set; never trusted client data. */
  immediatePerformanceRequested: true;
  acceptedAt: FieldValue | Timestamp;
  userAgent: string;
};

type MembershipAcceptanceRecord = CheckoutAcceptanceRecord & {
  /** Stripe event time at which the paid contract was formed. */
  contractMadeAt: Timestamp;
  coolingOffEndsAt: string;
};

type MembershipIntentDoc = {
  schemaVersion: number;
  /** Hash of the client-generated retry key; the raw key is never persisted. */
  checkoutAttemptHash: string;
  /** Binds one retry key to one immutable, normalised checkout request. */
  requestFingerprint: string;
  /** Null until the buyer claims the purchase with an account. */
  payerUid: string | null;
  payerEmail: string | null;
  planKey: PlanKey;
  /** Complete customer-facing commercial plan frozen before Stripe opens. */
  commercialTerms: CommercialPlanSnapshot;
  /** Stripe mode frozen with this retryable attempt. */
  stripeMode: StripeMode;
  /** Exact validated Price frozen for this attempt, even if config later rotates. */
  stripePriceId: string;
  participant: ParticipantRecord;
  guardian: GuardianRecord | null;
  acceptances: CheckoutAcceptanceRecord;
  checkoutSessionId: string | null;
  checkoutSessionUrl: string | null;
  status: "reserved" | "created" | "payment_pending" | "fulfilled" | "expired" | "failed";
  /** Frozen commercial policy; missing only on legacy, standard-billing intents. */
  billingMode: "presale_deferred" | "standard";
  billingCycleAnchor: number;
  serviceStartsAt: number;
  firstPaymentAt: number;
  initialChargePence: number | null;
  prorationBehavior: "none" | "create_prorations";
  /** Resolved Stripe id only; the customer-entered code is never persisted. */
  promotionCodeId: string | null;
  firstFullChargeDate: string;
  checkoutExpiresAt: number;
  reservationExpiresAt: Timestamp;
  reservationLockIds: string[];
  createdAt: FieldValue | Timestamp;
};

type MembershipDiscount = {
  couponId: string;
  promotionCodeId: string;
  amountOffPence: number;
  currency: "gbp";
  durationInMonths: number;
  startsAt: number;
  endsAt: number | null;
};

type MembershipPaymentSchedule = {
  amountDueTodayPence: number | null;
  firstPaymentAt: number;
  standardMonthlyPence: number;
  discountedMonthlyPence: number | null;
  discountedPaymentCount: number;
  fullPriceFrom: number | null;
};

type MembershipDoc = {
  schemaVersion: number;
  subscriptionId: string;
  stripeCustomerId: string;
  checkoutSessionId: string;
  /** Hash of the browser-held one-time verifier for an anonymous claim. */
  checkoutAttemptHash: string;
  /**
   * The account that owns this membership, or null while it is unclaimed.
   * A membership is bought before an account exists, so this is populated by
   * `claimMembership` rather than at fulfilment.
   */
  payerUid: string | null;
  /** Billing email Stripe collected. The identity a claim is matched against. */
  payerEmail: string | null;
  fulfilledAt: FieldValue | Timestamp | null;
  claimedAt: FieldValue | Timestamp | null;
  planKey: PlanKey;
  stripePriceId: string;
  commercialTerms: CommercialPlanSnapshot;
  planName: string;
  grantsAlphaWodAccess: boolean;
  participant: ParticipantRecord;
  guardian: GuardianRecord | null;
  acceptances: MembershipAcceptanceRecord;
  state: MembershipState;
  stripeStatus: string;
  entitlementTargetUid: string | null;
  /**
   * Entitlement the target held before this membership first granted access.
   * Restored on revocation so a grandfathered legacy member is never demoted
   * to no access by cancelling a later paid membership.
   */
  preMembershipEntitlement: {
    entitlementStatus: EntitlementStatus;
    entitlementSource: EntitlementSource;
  } | null;
  currentPeriodEnd: number | null;
  billingMode: "presale_deferred" | "standard";
  billingCycleAnchor: number;
  serviceStartsAt: number;
  firstPaymentAt: number;
  initialChargePence: number | null;
  firstPaymentReceivedAt: number | null;
  firstPaidInvoiceId: string | null;
  discount: MembershipDiscount | null;
  paymentSchedule: MembershipPaymentSchedule;
  pastDueSince: number | null;
  pastDueGraceEndsAt: Timestamp | null;
  nextReconcileAt?: Timestamp | null;
  /** Open Stripe dispute ids; the derived boolean remains for simple queries. */
  openDisputeIds: string[];
  disputeOpen: boolean;
  accessRevoked: boolean;
  providerContractStatus?: "verified" | "manual_review";
  providerContractError?: string;
  cancelAt: number | null;
  cancellationRequestedAt: Timestamp | FieldValue | null;
  cancellationOutcome: ReturnType<typeof resolveCancellationOutcome> | null;
  cancellationRequest?: {
    id: string;
    kind?: "presale_withdrawal" | "cooling_off" | "contractual";
    status: "pending" | "applied" | "manual_review";
    receivedAt: Timestamp;
    /** Starts/resets when automatic application or a later drift repair begins. */
    recoveryStartedAt?: Timestamp;
    outcome: ReturnType<typeof resolveCancellationOutcome>;
    stripeCancelAt?: number;
    attemptCount?: number;
    repairGeneration?: number;
    nextAttemptAt?: Timestamp;
    leaseToken?: string;
    leaseExpiresAt?: Timestamp;
    lastError?: string;
    /** Immutable cooling-off receipt; absent on legacy/contractual requests. */
    receiptId?: string;
    cancellationEffectiveAtMillis?: number;
    accessEndsAtMillis?: number;
    collectFuturePayments?: false;
    futurePaymentDuePence?: 0;
    providerEndedAtMillis?: number | null;
    refundReviewRequired?: boolean;
    refundAmountPence?: null;
    acknowledgementOutboxId?: string;
    acknowledgementIdempotencyKey?: string;
  };
  entitlementProjectionStatus?: "applied" | "manual_review";
  entitlementProjectionError?: string;
  confirmationEmailStatus?: string;
  confirmationEmailError?: string;
  confirmationEmailProviderId?: string;
  confirmationEmailSentAt?: Timestamp | FieldValue | null;
  cancellationAcknowledgementStatus?: string;
  cancellationAcknowledgementError?: string;
  cancellationAcknowledgementProviderId?: string;
  cancellationAcknowledgementSentAt?: Timestamp | FieldValue | null;
  createdAt: FieldValue | Timestamp;
  updatedAt: FieldValue | Timestamp;
};

type CancellationOutcome = ReturnType<typeof resolveCancellationOutcome>;

/**
 * Compatibility projection for the existing Stripe cancellation recovery.
 * The immutable cooling-off receipt remains authoritative for the legal
 * effective/access stop; this shape only lets the established worker perform
 * and verify an immediate provider cancellation.
 */
function resolveCoolingOffCancellationOutcome(
  receivedAtMillis: number
): CancellationOutcome {
  const receivedAtUnixSeconds = Math.floor(receivedAtMillis / 1000);
  return {
    ...resolveCancellationOutcome(receivedAtMillis),
    noticeDeadlineMet: true,
    finalPaymentDate: null,
    accessEndsOnDate: formatUnixBillingIsoDate(receivedAtUnixSeconds),
    cancelAtUnixSeconds: receivedAtUnixSeconds,
  };
}

function cancellationAcknowledgementStatusForClient(
  status: unknown
): "pending" | "sent" | "failed" | null {
  if (status === "sent") return "sent";
  if (status === "pending" || status === "sending") return "pending";
  if (status === "dead_letter" || status === "manual_review") return "failed";
  return null;
}

function isPresaleIntent(
  intent: Pick<MembershipIntentDoc, "billingMode">
): boolean {
  return intent.billingMode === "presale_deferred";
}

function addUtcMonths(unixSeconds: number, months: number): number {
  const date = new Date(unixSeconds * 1000);
  return Math.floor(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() + months,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds()
  ) / 1000);
}

function resolvePresaleCancellationOutcome(
  receivedAtMillis: number,
  membership: Pick<MembershipDoc, "serviceStartsAt" | "firstPaymentAt">
): CancellationOutcome {
  const receivedAt = Math.floor(receivedAtMillis / 1000);
  const firstPaymentDate = formatUnixBillingIsoDate(membership.firstPaymentAt);
  const noticeDaysGiven = Math.max(
    0,
    Math.floor((membership.firstPaymentAt * 1000 - receivedAtMillis) /
      (24 * 60 * 60 * 1000))
  );
  return {
    nextBillingDate: firstPaymentDate,
    noticeDeadlineMet: true,
    noticeDaysGiven,
    noticeDeadlineDate: formatUnixBillingIsoDate(
      membership.firstPaymentAt - BILLING_POLICY.cancellationNoticeDays * 24 * 60 * 60
    ),
    finalPaymentDate: null,
    accessEndsOnDate: formatUnixBillingIsoDate(membership.serviceStartsAt - 1),
    // This request withdraws a not-yet-started service. Freezing receipt time
    // makes recovery cancel immediately and guarantees no opening-day invoice.
    cancelAtUnixSeconds: receivedAt,
  };
}

function paymentScheduleFor(
  intent: MembershipIntentDoc,
  discount: MembershipDiscount | null,
  observedInitialChargePence: number | null
): MembershipPaymentSchedule {
  const commercialTerms = intent.commercialTerms ??
    createCommercialPlanSnapshot(intent.planKey);
  const firstPaymentAt = intent.firstPaymentAt ?? intent.billingCycleAnchor;
  return {
    amountDueTodayPence: intent.initialChargePence ?? observedInitialChargePence,
    firstPaymentAt,
    standardMonthlyPence: commercialTerms.amountPence,
    discountedMonthlyPence: discount ?
      Math.max(0, commercialTerms.amountPence - discount.amountOffPence) : null,
    discountedPaymentCount: discount?.durationInMonths ?? 0,
    fullPriceFrom: discount ?
      addUtcMonths(firstPaymentAt, discount.durationInMonths) : null,
  };
}

async function retrieveApprovedExistingMemberCoupon(
  billingStripe: Stripe,
  productId: string,
  requireCurrentlyRedeemable = true
): Promise<Stripe.Coupon> {
  const configuredCouponId = stripeExistingMemberCouponId.value().trim();
  if (!configuredCouponId) {
    throw new HttpsError(
      "failed-precondition",
      "The existing-member Coupon allowlist is not configured."
    );
  }
  // Stripe omits `applies_to` from the default representation. Expanding it
  // keeps this on the typed SDK path while making the Product allowlist
  // available for the fail-closed preflight and fulfilment checks.
  const coupon = await billingStripe.coupons.retrieve(configuredCouponId, {
    expand: ["applies_to"],
  });
  assertStripeObjectMode("Coupon", coupon.id, coupon.livemode);
  const applicableProducts = coupon.applies_to?.products ?? [];
  if (coupon.deleted || (requireCurrentlyRedeemable && coupon.valid !== true) ||
    coupon.amount_off !== EXISTING_MEMBER_OFFER.amountOffPence ||
    coupon.currency !== EXISTING_MEMBER_OFFER.currency || coupon.percent_off !== null ||
    coupon.duration !== "repeating" ||
    coupon.duration_in_months !== EXISTING_MEMBER_OFFER.durationMonths ||
    // Stripe validates an amount-off Coupon against this deferred
    // subscription's future billing anchor. A Coupon that expires at the
    // earlier local-midnight signup cutoff is rejected as `coupon_expired`
    // even while `coupon.valid` is still true. Eligibility is bounded by the
    // exact allowlisted Promotion Code and app cutoff instead.
    coupon.redeem_by !== null ||
    coupon.max_redemptions !== null ||
    applicableProducts.length !== 1 || applicableProducts[0] !== productId) {
    throw new HttpsError(
      "failed-precondition",
      "The configured existing-member Coupon does not match the approved £5 offer."
    );
  }
  return coupon;
}

function promotionCodeMatchesApprovedOffer(
  promotionCode: Stripe.PromotionCode,
  couponId: string
): boolean {
  const currencyOptions = promotionCode.restrictions?.currency_options;
  return idOf(promotionCode.promotion?.coupon) === couponId &&
    promotionCode.max_redemptions === null &&
    promotionCode.expires_at ===
      EXISTING_MEMBER_OFFER.promotionCodeExpiresAtUnixSeconds &&
    promotionCode.customer == null && promotionCode.customer_account == null &&
    promotionCode.restrictions?.first_time_transaction !== true &&
    promotionCode.restrictions?.minimum_amount === null &&
    promotionCode.restrictions?.minimum_amount_currency === null &&
    (!currencyOptions || Object.keys(currencyOptions).length === 0);
}

/**
 * Validates Stripe's campaign-wide redemption counter without treating a
 * reusable code as if it belonged to one customer. The count may increase
 * between Checkout and fulfilment because the same campaign code is shared.
 */
function promotionCodeRedemptionCountIsCredible(
  promotionCode: Stripe.PromotionCode
): boolean {
  const redeemed = promotionCode.times_redeemed;
  return Number.isSafeInteger(redeemed) && redeemed >= 0;
}

async function resolveApprovedPromotionCodeForCheckout(
  billingStripe: Stripe,
  normalizedCode: string
): Promise<string> {
  const configuredCouponId = stripeExistingMemberCouponId.value().trim();
  const configuredPromotionCodeId =
    stripeExistingMemberPromotionCodeId.value().trim();
  if (!configuredPromotionCodeId) {
    throw new HttpsError(
      "failed-precondition",
      "The existing-member Promotion Code allowlist is not configured."
    );
  }
  const matches = await billingStripe.promotionCodes.list({
    active: true,
    code: normalizedCode,
    limit: 10,
  });
  const exactMatches = matches.data.filter((promotionCode) =>
    promotionCode.code.normalize("NFKC").trim().toUpperCase() === normalizedCode
  );
  if (exactMatches.length !== 1) {
    throw new HttpsError(
      "failed-precondition",
      "This promotion code is not valid for the founding-member offer."
    );
  }
  const promotionCode = exactMatches[0];
  assertStripeObjectMode("Promotion Code", promotionCode.id, promotionCode.livemode);
  if (promotionCode.id !== configuredPromotionCodeId ||
    !promotionCodeMatchesApprovedOffer(promotionCode, configuredCouponId) ||
    promotionCode.active !== true ||
    !promotionCodeRedemptionCountIsCredible(promotionCode)) {
    throw new HttpsError(
      "failed-precondition",
      "This promotion code is not valid for the founding-member offer."
    );
  }
  return promotionCode.id;
}

async function resolveApprovedCheckoutDiscount(
  session: Stripe.Checkout.Session,
  subscription: Stripe.Subscription,
  intent: MembershipIntentDoc,
  completionUnixSeconds: number
): Promise<MembershipDiscount | null> {
  const applied = session.discounts ?? [];
  if (applied.length === 0) {
    if (intent.promotionCodeId || (subscription.discounts ?? []).length > 0) {
      throw new Error(`Subscription ${subscription.id} has an unapproved discount.`);
    }
    return null;
  }
  if (!isPresaleIntent(intent) || intent.planKey !== EXISTING_MEMBER_OFFER.planKey ||
    !intent.promotionCodeId) {
    throw new Error(`Checkout Session ${session.id} has an unapproved discount.`);
  }
  if (applied.length !== 1) {
    throw new Error(`Checkout Session ${session.id} has multiple discounts.`);
  }

  const configuredCouponId = stripeExistingMemberCouponId.value().trim();
  const configuredPromotionCodeId =
    stripeExistingMemberPromotionCodeId.value().trim();
  const couponId = idOf(applied[0].coupon);
  const promotionCodeId = idOf(applied[0].promotion_code);
  if (!configuredPromotionCodeId || couponId !== configuredCouponId ||
    promotionCodeId !== configuredPromotionCodeId ||
    promotionCodeId !== intent.promotionCodeId) {
    throw new Error(`Checkout Session ${session.id} used an unapproved promotion.`);
  }

  const billingStripe = stripe();
  const itemPrice = subscription.items.data[0]?.price;
  let productId = itemPrice && typeof itemPrice !== "string" ?
    idOf(itemPrice.product) : null;
  if (!productId) {
    const price = await billingStripe.prices.retrieve(intent.stripePriceId);
    assertStripeObjectMode("Price", price.id, price.livemode);
    productId = idOf(price.product);
  }
  if (!productId) {
    throw new Error(`Subscription ${subscription.id} has no membership Product.`);
  }
  const [coupon, promotionCode] = await Promise.all([
    // Once Stripe has authoritatively applied the Coupon and Promotion Code to
    // both Session and Subscription, delayed webhook/recovery processing must
    // validate the frozen offer terms without pretending it is a new
    // redemption or requiring the code to remain active.
    retrieveApprovedExistingMemberCoupon(billingStripe, productId, false),
    billingStripe.promotionCodes.retrieve(promotionCodeId),
  ]);
  assertStripeObjectMode("Promotion Code", promotionCode.id, promotionCode.livemode);
  if (promotionCode.id !== configuredPromotionCodeId || coupon.id !== couponId ||
    !promotionCodeMatchesApprovedOffer(promotionCode, coupon.id) ||
    !promotionCodeRedemptionCountIsCredible(promotionCode)) {
    throw new Error(
      `Promotion Code ${promotionCode.id} is not the approved reusable campaign code.`
    );
  }

  const subscriptionDiscounts = (subscription.discounts ?? []).filter(
    (value): value is Stripe.Discount =>
      typeof value !== "string" && idOf(value.source?.coupon) === coupon.id &&
      idOf(value.promotion_code) === promotionCode.id
  );
  if (subscriptionDiscounts.length !== 1 || subscription.discounts.length !== 1) {
    throw new Error(
      `Subscription ${subscription.id} does not carry the approved Checkout discount.`
    );
  }
  const [subscriptionDiscount] = subscriptionDiscounts;
  return {
    couponId: coupon.id,
    promotionCodeId: promotionCode.id,
    amountOffPence: EXISTING_MEMBER_OFFER.amountOffPence,
    currency: "gbp",
    durationInMonths: EXISTING_MEMBER_OFFER.durationMonths,
    startsAt: subscriptionDiscount?.start ?? completionUnixSeconds,
    endsAt: subscriptionDiscount?.end ?? null,
  };
}

/** Keeps stored customer-facing dates aligned with an earlier Stripe schedule. */
function alignCancellationOutcome(
  proposed: CancellationOutcome,
  effectiveCancelAt: number
): CancellationOutcome {
  if (effectiveCancelAt === proposed.cancelAtUnixSeconds) return proposed;
  const accessEndsOnDate = formatUnixBillingIsoDate(Math.max(0, effectiveCancelAt - 1));
  return {
    ...proposed,
    cancelAtUnixSeconds: effectiveCancelAt,
    // An earlier provider schedule does not necessarily remove the next
    // payment. If access crosses the next billing day, that payment remains
    // part of the frozen customer-facing outcome.
    finalPaymentDate: accessEndsOnDate >= proposed.nextBillingDate ?
      proposed.nextBillingDate : null,
    accessEndsOnDate,
  };
}

/** Future cancel_at, or the actual ended_at once Stripe has canceled it. */
function authoritativeSubscriptionCancellationEnd(
  subscription: Stripe.Subscription
): number | null {
  if (subscription.status === "canceled") {
    return subscription.ended_at ?? subscription.cancel_at ?? null;
  }
  return subscription.cancel_at ?? null;
}

/** ---------------------------------------------------------------
 * Input validation
 * -------------------------------------------------------------- */

function requireAuthUid(request: any): string {
  if (!request.auth) throw new HttpsError("unauthenticated", "Login required.");
  return request.auth.uid as string;
}

/** Uid when the caller happens to be signed in, null for a public visitor. */
function optionalAuthUid(request: any): string | null {
  return request.auth ? (request.auth.uid as string) : null;
}

function requireBoundedString(value: unknown, field: string, min: number, max: number): string {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (text.length < min || text.length > max) {
    throw new HttpsError(
      "invalid-argument",
      `${field} must be between ${min} and ${max} characters.`
    );
  }
  return text;
}

function normalizePromotionCode(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", "promotionCode must be text.");
  }
  const normalized = value.normalize("NFKC").trim().toUpperCase();
  const hasControlCharacter = [...normalized].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  if (!normalized || normalized.length > 64 || hasControlCharacter) {
    throw new HttpsError("invalid-argument", "Enter a valid promotion code.");
  }
  return normalized;
}

function optionalBoundedText(
  value: unknown,
  min: number,
  max: number
): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length >= min && text.length <= max ? text : null;
}

function requirePlanKey(value: unknown): PlanKey {
  if (!isPlanKey(value)) {
    throw new HttpsError("invalid-argument", "Unknown membership plan.");
  }
  return value;
}

function participantKeyFor(fullName: string, dateOfBirth: string): string {
  return createHash("sha256")
    .update(`${fullName.trim().toLowerCase()}|${dateOfBirth}`)
    .digest("hex");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * The client keeps this opaque attempt id stable while retrying one checkout.
 * It is intentionally stricter than a general string because it also feeds a
 * Stripe idempotency key. The hash, rather than the raw value, is persisted.
 */
function requireCheckoutAttemptId(value: unknown): string {
  const attemptId = typeof value === "string" ? value.trim() : "";
  if (attemptId.length < 8 || attemptId.length > 255 ||
    !/^[A-Za-z0-9._:-]+$/.test(attemptId)) {
    throw new HttpsError(
      "invalid-argument",
      "checkoutAttemptId must be an 8–255 character opaque identifier."
    );
  }
  return attemptId;
}

type CheckoutFingerprintInput = {
  payerUid: string | null;
  planKey: PlanKey;
  expectedBillingMode: "presale_deferred" | "standard";
  promotionCode: string | null;
  participant: ParticipantRecord;
  guardian: GuardianRecord | null;
  signedName: string;
  commercialTerms: CommercialPlanSnapshot;
  acceptances: Pick<CheckoutAcceptanceRecord,
    "signerRole" | "documents" | "statements" | "acceptedStatementIds" |
    "immediatePerformanceRequested">;
};

/** Prevents a stable attempt id being replayed with materially different data. */
function checkoutRequestFingerprint(input: CheckoutFingerprintInput): string {
  return sha256(JSON.stringify({
    schemaVersion: MEMBERSHIP_SCHEMA_VERSION,
    payerUid: input.payerUid,
    planKey: input.planKey,
    expectedBillingMode: input.expectedBillingMode,
    promotionCode: input.promotionCode,
    participant: {
      fullName: input.participant.fullName,
      dateOfBirth: input.participant.dateOfBirth,
      isPayer: input.participant.isPayer,
      participantKey: input.participant.participantKey,
    },
    guardian: input.guardian,
    signedName: input.signedName,
    commercialTerms: input.commercialTerms,
    acceptances: input.acceptances,
  }));
}

/**
 * The browser submits ids only. The server independently resolves the exact
 * plan/role set and rejects missing, duplicate, unknown or extra ids before it
 * stores the canonical statements and immutable document contents.
 */
function requireExactCheckoutAcceptanceIds(
  value: unknown,
  expected: readonly CheckoutAcceptanceStatement[]
): CheckoutAcceptanceId[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string")) {
    throw new HttpsError(
      "invalid-argument",
      "Each required checkout statement must be accepted separately."
    );
  }
  const submitted = value as string[];
  const expectedIds = expected.map(({id}) => id);
  const submittedSet = new Set(submitted);
  const exact = submittedSet.size === submitted.length &&
    submittedSet.size === expectedIds.length &&
    expectedIds.every((id) => submittedSet.has(id));
  if (!exact) {
    throw new HttpsError(
      "failed-precondition",
      "Review and accept every required checkout statement separately."
    );
  }
  return [...expectedIds];
}

/**
 * Stripe does not cache validation failures under an idempotency key because
 * request execution never began. A validation response therefore proves that
 * no Checkout Session was created for this attempt; connection/5xx failures
 * remain ambiguous and deliberately keep their uniqueness locks.
 */
function isDefinitiveCheckoutCreateFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    type?: unknown;
    rawType?: unknown;
  };
  return candidate.type === "StripeInvalidRequestError" ||
    candidate.rawType === "invalid_request_error" ||
    candidate.type === "StripeAuthenticationError" ||
    candidate.rawType === "authentication_error" ||
    candidate.type === "StripePermissionError";
}

/**
 * Only the approved public origin is accepted for Stripe return URLs. An
 * attacker-supplied origin would otherwise turn checkout completion into an
 * open redirect carrying a session id.
 */
function resolveReturnOrigin(): string {
  const configured = appPublicOrigin.value().trim();
  try {
    return new URL(configured).origin;
  } catch {
    throw new HttpsError("failed-precondition", "The public app origin is misconfigured.");
  }
}

/**
 * Price IDs verified directly against the Stripe sandbox on 18 August 2026.
 * Products, prices, portal configurations and webhook secrets are all
 * mode-specific, so these can never be correct in live mode.
 */
const KNOWN_TEST_PRICE_IDS = new Set([
  "price_1U5PS5FzNDZoGGA0rPLiyQ2Q",
  "price_1U5PKZFzNDZoGGA0xsnNcV2m",
  "price_1U5PJHFzNDZoGGA0izMSvHP1",
  "price_1U5PFZFzNDZoGGA06T2ggw4M",
  "price_1U5PEwFzNDZoGGA0d24UJaZd",
]);

function resolvePriceId(planKey: PlanKey): string {
  const priceId = priceParams[planKey].value().trim();
  if (!priceId) {
    throw new HttpsError(
      "failed-precondition",
      `No Stripe price is configured for ${planKey}.`
    );
  }

  // Stripe would reject this anyway, but only once a real customer was part
  // way through checkout. Failing here makes the misconfiguration obvious
  // before anyone is asked to pay.
  const stripeMode = assertBillingEnvironment().stripeMode;
  if (stripeMode === "live" && KNOWN_TEST_PRICE_IDS.has(priceId)) {
    throw new HttpsError(
      "failed-precondition",
      `${planKey} is still pointing at a Stripe test-mode price. Create the live ` +
      "catalogue and set the live price IDs before taking payments."
    );
  }
  if (stripeMode === "live" &&
    priceId !== APPROVED_LIVE_STRIPE_CATALOGUE[planKey].priceId) {
    throw new HttpsError(
      "failed-precondition",
      `${planKey} is not pointing at the approved live Stripe Price.`
    );
  }

  return priceId;
}

/** Refuses a swapped, inactive, wrongly priced, or wrongly named Stripe Price. */
async function assertStripePriceMatchesPlan(
  client: Stripe,
  priceId: string,
  plan: ReturnType<typeof getPlan>
): Promise<string> {
  let price: Stripe.Price;
  try {
    price = await client.prices.retrieve(priceId, {expand: ["product"]});
  } catch (error) {
    console.error("Stripe membership price preflight failed", {planKey: plan.key, error});
    if (isDefinitiveCheckoutCreateFailure(error)) {
      throw new HttpsError(
        "failed-precondition",
        `The billing price for ${plan.name} is not available. Contact support before paying.`
      );
    }
    // A transient provider outage must preserve the browser's stable attempt
    // id. It may be the only way to recover a Session accepted immediately
    // before a process/network failure.
    throw new HttpsError(
      "unavailable",
      "Stripe is temporarily unavailable. Retry this same checkout attempt."
    );
  }

  const product = typeof price.product === "object" && price.product &&
      !("deleted" in price.product) ? price.product : null;
  const stripeMode = assertBillingEnvironment().stripeMode;
  const approvedLive = stripeMode === "live" ?
    APPROVED_LIVE_STRIPE_CATALOGUE[plan.key] : null;
  assertStripeObjectMode("Price", price.id, price.livemode);
  if (product) {
    assertStripeObjectMode("Product", product.id, product.livemode);
  }
  const valid = price.active === true &&
    price.currency.toLowerCase() === plan.currency &&
    price.unit_amount === plan.amountPence &&
    price.type === "recurring" &&
    price.recurring?.interval === "month" &&
    price.recurring.interval_count === 1 &&
    product?.active === true &&
    product.name === (approvedLive?.productName ?? plan.name) &&
    (!approvedLive || matchesApprovedLiveStripeCatalogueEntry(
      price,
      product,
      approvedLive
    ));
  if (!valid) {
    console.error("CRITICAL_BILLING_PRICE_MISMATCH", {
      planKey: plan.key,
      priceId,
      active: price.active,
      livemode: price.livemode,
      currency: price.currency,
      unitAmount: price.unit_amount,
      type: price.type,
      interval: price.recurring?.interval,
      intervalCount: price.recurring?.interval_count,
      productName: product?.name ?? null,
      productActive: product?.active ?? null,
      expectedLiveProductId: approvedLive?.productId ?? null,
      expectedLiveProductName: approvedLive?.productName ?? null,
    });
    throw new HttpsError(
      "failed-precondition",
      `The billing price for ${plan.name} does not match the approved catalogue.`
    );
  }
  return product.id;
}

/** Prevents an operator-selected portal configuration bypassing cancellation policy. */
async function assertPortalConfigurationIsLockedDown(
  client: Stripe,
  configurationId: string
): Promise<void> {
  let configuration: Stripe.BillingPortal.Configuration;
  try {
    configuration = await client.billingPortal.configurations.retrieve(configurationId);
  } catch (error) {
    console.error("Stripe portal configuration preflight failed", {
      configurationId,
      error,
    });
    if (isDefinitiveCheckoutCreateFailure(error)) {
      throw new HttpsError("failed-precondition", "The billing portal is not configured.");
    }
    throw new HttpsError("unavailable", "The billing portal is temporarily unavailable.");
  }
  assertStripeObjectMode(
    "Customer Portal configuration",
    configuration.id,
    configuration.livemode
  );
  const subscriptionPauseEnabled = (
    configuration.features as typeof configuration.features & {
      subscription_pause?: {enabled?: boolean};
    }
  ).subscription_pause?.enabled;
  if (configuration.active !== true ||
    configuration.login_page?.enabled !== false ||
    configuration.features.customer_update?.enabled !== false ||
    configuration.features.invoice_history?.enabled !== true ||
    configuration.features.payment_method_update?.enabled !== true ||
    configuration.features.subscription_cancel.enabled !== false ||
    configuration.features.subscription_update.enabled !== false ||
    subscriptionPauseEnabled === true) {
    console.error("CRITICAL_BILLING_PORTAL_CONFIGURATION_MISMATCH", {
      configurationId,
      active: configuration.active,
      hostedLoginEnabled: configuration.login_page?.enabled,
      customerUpdateEnabled:
        configuration.features.customer_update?.enabled,
      invoiceHistoryEnabled:
        configuration.features.invoice_history?.enabled,
      paymentMethodUpdateEnabled:
        configuration.features.payment_method_update?.enabled,
      subscriptionCancellationEnabled:
        configuration.features.subscription_cancel.enabled,
      subscriptionUpdateEnabled:
        configuration.features.subscription_update.enabled,
      subscriptionPauseEnabled: subscriptionPauseEnabled ?? null,
    });
    throw new HttpsError(
      "failed-precondition",
      "The billing portal is unavailable because its configuration is unsafe."
    );
  }
}

/** Fail closed if a future gate flip leaves draft or internally inconsistent legal copy. */
function assertCheckoutDocumentModel(publicationReadyRequired: boolean): void {
  if (publicationReadyRequired) {
    const companyPublicationFields = {
      legalName: COMPANY.legalName,
      tradingName: COMPANY.tradingName,
      companyNumber: COMPANY.companyNumber,
      address: COMPANY.address,
      registeredOffice: COMPANY.registeredOffice,
      registrationJurisdiction: COMPANY.registrationJurisdiction,
      supportEmail: COMPANY.supportEmail,
      confirmationSender: COMPANY.confirmationSender,
    };
    if (Object.values(companyPublicationFields).some((value) => !value.trim()) ||
      /\b(?:PENDING|DRAFT)\b/i.test(JSON.stringify(companyPublicationFields))) {
      throw new HttpsError(
        "failed-precondition",
        "Company disclosures are not ready for publication."
      );
    }
    const aggregateDocumentBytes = Object.values(CHECKOUT_DOCUMENTS).reduce(
      (total, document) => total + Buffer.byteLength(document.content, "utf8"),
      0
    );
    if (aggregateDocumentBytes > CHECKOUT_DOCUMENT_CONTENT_BUDGET_BYTES) {
      throw new HttpsError(
        "failed-precondition",
        "Checkout documents exceed the safe publication byte budget."
      );
    }
  }
  const exactRequirements: Record<PlanKey, {
    documents: string[];
    statements: CheckoutAcceptanceId[];
    signerRole: CheckoutSignerRole;
  }> = {
    adult_unlimited: {
      documents: ["membershipTerms", "cancellationPolicy", "privacyNotice", "adultWaiver"],
      statements: [
        "membership_contract", "privacy_notice", "adult_participant_waiver",
        "recurring_payment_authority", "immediate_performance",
      ],
      signerRole: "adult_participant_and_payer",
    },
    adult_ladies: {
      documents: ["membershipTerms", "cancellationPolicy", "privacyNotice", "adultWaiver"],
      statements: [
        "membership_contract", "privacy_notice", "adult_participant_waiver",
        "recurring_payment_authority", "immediate_performance",
      ],
      signerRole: "adult_participant_and_payer",
    },
    adult_gym: {
      documents: ["membershipTerms", "cancellationPolicy", "privacyNotice", "adultWaiver"],
      statements: [
        "membership_contract", "privacy_notice", "adult_participant_waiver",
        "recurring_payment_authority", "immediate_performance",
      ],
      signerRole: "adult_participant_and_payer",
    },
    youth_youngstars: {
      documents: ["membershipTerms", "cancellationPolicy", "privacyNotice", "guardianAddendum"],
      statements: [
        "membership_contract", "privacy_notice", "guardian_authority",
        "guardian_youth_addendum", "recurring_payment_authority", "immediate_performance",
      ],
      signerRole: "youth_guardian_and_payer",
    },
    youth_teenstars: {
      documents: ["membershipTerms", "cancellationPolicy", "privacyNotice", "guardianAddendum"],
      statements: [
        "membership_contract", "privacy_notice", "guardian_authority",
        "guardian_youth_addendum", "recurring_payment_authority", "immediate_performance",
      ],
      signerRole: "youth_guardian_and_payer",
    },
  };

  for (const planKey of PLAN_KEYS) {
    const documents = resolveCheckoutDocuments(planKey);
    const statements = resolveCheckoutAcceptanceStatements(planKey);
    const requirement = exactRequirements[planKey];
    const documentKeys = documents.map(({key}) => key);
    const statementIds = statements.map(({id}) => id);
    if (JSON.stringify(documentKeys) !== JSON.stringify(requirement.documents) ||
      JSON.stringify(statementIds) !== JSON.stringify(requirement.statements) ||
      resolveCheckoutSignerRole(planKey) !== requirement.signerRole ||
      new Set(documentKeys).size !== documentKeys.length ||
      new Set(statementIds).size !== statementIds.length) {
      throw new HttpsError(
        "failed-precondition",
        `Checkout legal requirements are invalid for ${planKey}.`
      );
    }
    const availableKeys = new Set(documentKeys);
    if (statements.some((statement) =>
      !statement.statement.trim() ||
      new Set(statement.documentKeys).size !== statement.documentKeys.length ||
      statement.documentKeys.some((key) => !availableKeys.has(key)))) {
      throw new HttpsError(
        "failed-precondition",
        `A checkout statement is incomplete or references an unavailable document for ${planKey}.`
      );
    }

    if (!publicationReadyRequired) continue;
    for (const document of documents) {
      const serialized = JSON.stringify(document);
      const immutableUrl = (() => {
        try {
          const parsed = new URL(document.publicUrl, "https://same-origin.invalid");
          const sameOriginPath = document.publicUrl.startsWith("/") &&
            parsed.origin === "https://same-origin.invalid";
          const absoluteHttps = /^https:\/\//.test(document.publicUrl);
          return (sameOriginPath || absoluteHttps) &&
            !parsed.search && !parsed.hash && parsed.pathname.includes(document.version);
        } catch {
          return false;
        }
      })();
      const effectiveDate = document.effectiveDate.trim();
      const parsedEffectiveDate = new Date(`${effectiveDate}T00:00:00.000Z`);
      const validEffectiveDate = /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) &&
        Number.isFinite(parsedEffectiveDate.getTime()) &&
        parsedEffectiveDate.toISOString().slice(0, 10) === effectiveDate;
      if (/\b(?:PENDING|DRAFT)\b/i.test(serialized) ||
        document.contentType !== "text/plain; charset=utf-8" ||
        document.hashCovers !== "UTF-8 bytes of content" ||
        !document.title.trim() ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{2,159}$/.test(document.version) ||
        !validEffectiveDate ||
        !document.content.trim() ||
        !/^[a-f0-9]{64}$/.test(document.sha256) ||
        sha256(document.content) !== document.sha256 ||
        !immutableUrl) {
        throw new HttpsError(
          "failed-precondition",
          `Checkout document ${document.key} is not ready for publication.`
        );
      }
    }
  }
}

/**
 * The purchase flow stays closed until the checkout documents are approved for
 * publication *and* the deployment explicitly enables purchasing. Both gates
 * are required: approved source content alone must never open a deployment,
 * and an unapproved future version must never reach a paying customer.
 */
function requirePurchaseFlowOpen(): void {
  const testJourneyRequested =
    membershipTestJourneyEnabled.value().trim().toLowerCase() === "true";
  if (!CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION && !testJourneyRequested) {
    throw new HttpsError(
      "failed-precondition",
      "Membership purchase is not open yet: the checkout documents are not approved for publication."
    );
  }
  if (!CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION) {
    const environment = assertBillingEnvironment();
    const origin = resolveReturnOrigin();
    if (environment.stripeMode !== "test" ||
      environment.projectId === PRODUCTION_FIREBASE_PROJECT_ID ||
      !hasLoopbackFirebaseEmulatorDataPlane() ||
      !LOCAL_TEST_JOURNEY_ORIGINS.has(origin)) {
      throw new HttpsError(
        "failed-precondition",
        "The unpublished checkout can run only in the isolated local Stripe test journey."
      );
    }
  }
  assertCheckoutDocumentModel(CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION);
  if (membershipPurchaseEnabled.value().trim().toLowerCase() !== "true") {
    throw new HttpsError(
      "failed-precondition",
      "Membership purchase is not enabled for this environment."
    );
  }
  assertBillingEnvironment();
}

/** ---------------------------------------------------------------
 * Customer and membership lookup
 * -------------------------------------------------------------- */

async function resolveStripeCustomerId(userId: string): Promise<string> {
  const userRef = db().collection("users").doc(userId);
  const snap = await userRef.get();
  if (!snap.exists) {
    throw new HttpsError("failed-precondition", "Create your profile before purchasing.");
  }

  const existing = snap.get("stripeCustomerId");
  if (typeof existing === "string" && existing) return existing;

  const authUser = await admin.auth().getUser(userId);
  const customer = await stripe().customers.create(
    {
      email: authUser.email?.trim().toLowerCase() || undefined,
      name: (snap.get("name") as string | undefined) || authUser.displayName || undefined,
      metadata: {firebaseUid: userId},
    },
    // Retrying a create with the same key returns the original customer rather
    // than duplicating one if this call is replayed.
    {idempotencyKey: `customer:${userId}`}
  );
  assertStripeObjectMode("Customer", customer.id, customer.livemode);

  await userRef.set(
    {stripeCustomerId: customer.id, updatedAt: serverTimestamp()},
    {merge: true}
  );
  return customer.id;
}

/** ---------------------------------------------------------------
 * Atomic checkout reservations
 * -------------------------------------------------------------- */

const CHECKOUT_LOCK_COLLECTION = "membershipCheckoutLocks";
const ENTITLEMENT_OWNER_COLLECTION = "membershipEntitlementOwners";
const CHECKOUT_SETTLEMENT_GRACE_SECONDS = 60 * 60;
const ASYNC_PAYMENT_RESERVATION_MS = 7 * 24 * 60 * 60 * 1000;

type CheckoutLockKind = "participant" | "alpha_wod_payer";

type CheckoutLockSpec = {
  id: string;
  kind: CheckoutLockKind;
  identityHash: string;
};

type CheckoutReservationResult = {
  created: boolean;
  intent: MembershipIntentDoc;
};

/**
 * A purchase can be anonymous, so participant identity is always locked. A
 * signed-in payer also gets a second deterministic lock when the selected plan
 * grants AlphaWOD access. Hashes keep UIDs and participant details out of doc
 * paths while ensuring concurrent transactions contend on the same documents.
 */
function checkoutLockSpecs(
  payerUid: string | null,
  planKey: PlanKey,
  participantKey: string
): CheckoutLockSpec[] {
  const specs: CheckoutLockSpec[] = [{
    id: `participant_${participantKey}`,
    kind: "participant",
    identityHash: participantKey,
  }];

  if (payerUid && getPlan(planKey).grantsAlphaWodAccess) {
    const payerHash = sha256(payerUid);
    specs.push({
      id: `alpha_wod_payer_${payerHash}`,
      kind: "alpha_wod_payer",
      identityHash: payerHash,
    });
  }
  return specs;
}

function timestampMillis(value: unknown): number | null {
  return value instanceof Timestamp ? value.toMillis() : null;
}

function isBlockingMembershipDoc(
  doc: QueryDocumentSnapshot
): boolean {
  if (isMembershipStateBlockingDuplicate(doc.get("state") as MembershipState)) {
    return true;
  }
  const stripeStatus = doc.get("stripeStatus");
  // Revocation describes access, not whether Stripe has stopped billing. A
  // refunded/disputed membership can remain provider-active, so it must block
  // a replacement sale until Stripe is authoritatively terminal. Unknown
  // provider state also fails closed for legacy/malformed rows.
  return typeof stripeStatus !== "string" ||
    (stripeStatus !== "canceled" && stripeStatus !== "incomplete_expired");
}

function entitlementOwnerRef(userId: string): DocumentReference {
  return db().collection(ENTITLEMENT_OWNER_COLLECTION).doc(sha256(userId));
}

function alphaWodPayerCheckoutLockRef(
  userId: string
): DocumentReference {
  return db().collection(CHECKOUT_LOCK_COLLECTION)
    .doc(`alpha_wod_payer_${sha256(userId)}`);
}

async function hasBlockingPayerCheckoutReservation(
  tx: Transaction,
  userId: string
): Promise<boolean> {
  const lock = await tx.get(alphaWodPayerCheckoutLockRef(userId));
  if (!lock.exists) return false;
  const intentId = lock.get("intentId");
  if (typeof intentId !== "string") return true;
  const intent = await tx.get(db().collection("membershipIntents").doc(intentId));
  if (!intent.exists) return true;
  const status = intent.get("status") as MembershipIntentDoc["status"];
  return status !== "expired" && status !== "failed";
}

type EntitlementOwnerRead = {
  ref: DocumentReference;
  ownerSubscriptionId: string | null;
  ownerState: "active" | "released" | null;
  ownerMembershipBlocks: boolean;
};

/**
 * Reads the deterministic entitlement generation. An active generation stays
 * authoritative until its entitlement transaction has either projected access
 * or restored the prior grant and marked the generation released.
 */
async function readEntitlementOwner(
  tx: Transaction,
  userId: string,
  requestedSubscriptionId: string
): Promise<EntitlementOwnerRead> {
  const ref = entitlementOwnerRef(userId);
  const owner = await tx.get(ref);
  const ownerSubscriptionId = owner.exists &&
      typeof owner.get("subscriptionId") === "string" ?
    owner.get("subscriptionId") as string : null;
  const ownerState = ownerSubscriptionId ?
    (owner.get("state") === "released" ? "released" : "active") : null;
  if (!ownerSubscriptionId || ownerSubscriptionId === requestedSubscriptionId) {
    return {ref, ownerSubscriptionId, ownerState, ownerMembershipBlocks: false};
  }
  if (ownerState === "released") {
    return {ref, ownerSubscriptionId, ownerState, ownerMembershipBlocks: false};
  }
  // An active generation remains authoritative until its entitlement
  // transaction restores the user and atomically marks this row released.
  // Looking only at the membership state would open a gap where a replacement
  // snapshots the old Stripe grant instead of the original manual/legacy one.
  return {
    ref,
    ownerSubscriptionId,
    ownerState,
    ownerMembershipBlocks: true,
  };
}

function acquireEntitlementOwner(
  tx: Transaction,
  owner: EntitlementOwnerRead,
  userId: string,
  subscriptionId: string
): void {
  if (owner.ownerSubscriptionId &&
    owner.ownerSubscriptionId !== subscriptionId &&
    owner.ownerMembershipBlocks) {
    throw new HttpsError("already-exists", POLICY_TEXT.duplicateBlocked);
  }
  tx.set(owner.ref, {
    schemaVersion: MEMBERSHIP_SCHEMA_VERSION,
    subscriptionId,
    userIdHash: sha256(userId),
    state: "active",
    releasedAt: FieldValue.delete(),
    updatedAt: serverTimestamp(),
    ...(owner.ownerSubscriptionId ? {} : {createdAt: serverTimestamp()}),
  }, {merge: true});
}

/**
 * Atomically reserves every uniqueness key and checks existing memberships.
 * Stripe is deliberately called only after this transaction has committed.
 */
async function reserveCheckoutAttempt(
  intentRef: DocumentReference,
  proposedIntent: MembershipIntentDoc,
  nowMillis: number,
  convergedMembershipIds?: ReadonlySet<string>
): Promise<CheckoutReservationResult> {
  const lockSpecs = checkoutLockSpecs(
    proposedIntent.payerUid,
    proposedIntent.planKey,
    proposedIntent.participant.participantKey
  );
  const lockRefs = lockSpecs.map((spec) =>
    db().collection(CHECKOUT_LOCK_COLLECTION).doc(spec.id)
  );
  const participantQuery = db().collection("memberships")
    .where("participant.participantKey", "==", proposedIntent.participant.participantKey);
  const payerQuery = proposedIntent.payerUid &&
      proposedIntent.commercialTerms.grantsAlphaWodAccess ?
    db().collection("memberships").where("payerUid", "==", proposedIntent.payerUid) :
    null;
  const targetQuery = proposedIntent.payerUid &&
      proposedIntent.commercialTerms.grantsAlphaWodAccess ?
    db().collection("memberships")
      .where("entitlementTargetUid", "==", proposedIntent.payerUid) : null;

  return db().runTransaction(async (tx) => {
    const existingIntent = await tx.get(intentRef);
    if (existingIntent.exists) {
      const stored = existingIntent.data() as MembershipIntentDoc;
      if (stored.requestFingerprint !== proposedIntent.requestFingerprint) {
        throw new HttpsError(
          "failed-precondition",
          "This checkout attempt was already used with different membership details."
        );
      }
      return {created: false, intent: stored};
    }

    // All reads precede every write, as Firestore transactions require.
    const lockSnaps = await Promise.all(lockRefs.map((ref) => tx.get(ref)));
    const byParticipant = await tx.get(participantQuery);
    const byPayer = payerQuery ? await tx.get(payerQuery) : null;
    const byTarget = targetQuery ? await tx.get(targetQuery) : null;
    const entitlementOwner = proposedIntent.payerUid && payerQuery ?
      await readEntitlementOwner(tx, proposedIntent.payerUid, intentRef.id) : null;
    if (convergedMembershipIds) {
      assertEligibilityDocsWereConverged([
        ...byParticipant.docs,
        ...(byPayer?.docs ?? []).filter((doc) =>
          doc.get("grantsAlphaWodAccess") === true
        ),
        ...(byTarget?.docs ?? []).filter((doc) =>
          doc.get("grantsAlphaWodAccess") === true
        ),
      ], convergedMembershipIds);
      if (entitlementOwner?.ownerState === "active" &&
        entitlementOwner.ownerSubscriptionId &&
        !convergedMembershipIds.has(entitlementOwner.ownerSubscriptionId)) {
        throw new HttpsError(
          "unavailable",
          AUTHORITATIVE_ELIGIBILITY_UNAVAILABLE,
          {reason: "membership_state_changed"}
        );
      }
    }
    const priorIntentIds = [...new Set(lockSnaps.flatMap((snap) =>
      snap.exists && typeof snap.get("intentId") === "string" ?
        [snap.get("intentId") as string] : []
    ))];
    const priorIntentSnaps = await Promise.all(priorIntentIds.map((id) =>
      tx.get(db().collection("membershipIntents").doc(id))
    ));
    const priorIntentStatus = new Map(priorIntentSnaps.map((snap) => [
      snap.id,
      snap.exists ? snap.get("status") as MembershipIntentDoc["status"] : null,
    ]));

    const sameParticipant = byParticipant.docs.some(isBlockingMembershipDoc);
    const sameAlphaWodPayer = Boolean(byPayer?.docs.some((doc) =>
      isBlockingMembershipDoc(doc) && doc.get("grantsAlphaWodAccess") === true
    )) || Boolean(byTarget?.docs.some((doc) =>
      isBlockingMembershipDoc(doc) && doc.get("grantsAlphaWodAccess") === true
    )) || entitlementOwner?.ownerMembershipBlocks === true;
    const unsafeReservation = lockSnaps.some((snap) => {
      if (!snap.exists) return false;
      const expiresAt = timestampMillis(snap.get("expiresAt"));
      if (expiresAt === null || expiresAt > nowMillis) return true;
      const ownerIntentId = snap.get("intentId");
      if (typeof ownerIntentId !== "string") return true;
      const ownerStatus = priorIntentStatus.get(ownerIntentId);
      // Time alone never proves a Checkout Session is unpaid. Only a terminal
      // intent, normally driven by Stripe's expired/async-failed event, may be
      // reclaimed. This prevents a delayed paid webhook being stranded behind
      // a replacement sale.
      return ownerStatus !== "expired" && ownerStatus !== "failed";
    });

    if (sameParticipant || sameAlphaWodPayer || unsafeReservation) {
      throw new HttpsError("already-exists", POLICY_TEXT.duplicateBlocked);
    }

    tx.create(intentRef, proposedIntent);
    lockSpecs.forEach((spec, index) => {
      tx.set(lockRefs[index], {
        schemaVersion: MEMBERSHIP_SCHEMA_VERSION,
        kind: spec.kind,
        identityHash: spec.identityHash,
        intentId: intentRef.id,
        status: "reserved",
        expiresAt: proposedIntent.reservationExpiresAt,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    return {created: true, intent: proposedIntent};
  });
}

/**
 * Releases only locks still owned by this intent. The ownership check matters
 * when an old webhook arrives after an expired lock has been reused.
 */
async function transitionCheckoutReservation(
  intentRef: DocumentReference,
  status: MembershipIntentDoc["status"],
  updates: Record<string, unknown> = {},
  releaseLocks = true,
  stripeSessionBinding?: {
    sessionId: string;
    mode: string | null;
    planKey: string | null;
  }
): Promise<boolean> {
  return db().runTransaction(async (tx) => {
    const intentSnap = await tx.get(intentRef);
    if (!intentSnap.exists) return false;
    if (intentSnap.get("stripeMode") !== assertBillingEnvironment().stripeMode) {
      throw new Error(
        `Checkout intent ${intentRef.id} belongs to another Stripe environment.`
      );
    }

    if (stripeSessionBinding) {
      const storedSessionId = intentSnap.get("checkoutSessionId");
      const storedPlanKey = intentSnap.get("planKey");
      if (!stripeSessionBinding.sessionId ||
        stripeSessionBinding.mode !== "subscription" ||
        stripeSessionBinding.planKey !== storedPlanKey ||
        (storedSessionId !== null && storedSessionId !== undefined &&
          storedSessionId !== stripeSessionBinding.sessionId)) {
        throw new Error(
          `Stripe Checkout Session does not match membership intent ${intentRef.id}.`
        );
      }
    }

    const current = intentSnap.get("status") as MembershipIntentDoc["status"];
    const allowed: Record<MembershipIntentDoc["status"], MembershipIntentDoc["status"][]> = {
      reserved: ["reserved", "created", "payment_pending", "fulfilled", "expired", "failed"],
      created: ["created", "payment_pending", "fulfilled", "expired", "failed"],
      payment_pending: ["payment_pending", "fulfilled", "expired", "failed"],
      fulfilled: ["fulfilled"],
      expired: ["expired"],
      failed: ["failed"],
    };
    if (!allowed[current]?.includes(status)) return false;

    const lockIds = Array.isArray(intentSnap.get("reservationLockIds")) ?
      intentSnap.get("reservationLockIds") as string[] : [];
    const lockRefs = lockIds.map((id) =>
      db().collection(CHECKOUT_LOCK_COLLECTION).doc(id)
    );
    const lockSnaps = await Promise.all(lockRefs.map((ref) => tx.get(ref)));

    if (releaseLocks) {
      lockSnaps.forEach((snap, index) => {
        if (snap.exists && snap.get("intentId") === intentRef.id) {
          tx.delete(lockRefs[index]);
        }
      });
    }

    tx.set(intentRef, {
      status,
      ...updates,
      ...(stripeSessionBinding ? {
        checkoutSessionId: stripeSessionBinding.sessionId,
      } : {}),
      updatedAt: serverTimestamp(),
    }, {merge: true});
    return true;
  });
}

/** Keeps a completed-but-delayed payment from losing its duplicate guard. */
async function extendCheckoutReservationForAsyncPayment(
  intentRef: DocumentReference
): Promise<void> {
  const expiresAt = Timestamp.fromMillis(
    Date.now() + ASYNC_PAYMENT_RESERVATION_MS
  );
  await db().runTransaction(async (tx) => {
    const intentSnap = await tx.get(intentRef);
    if (!intentSnap.exists) return;
    const current = intentSnap.get("status") as MembershipIntentDoc["status"];
    if (current !== "reserved" && current !== "created" &&
      current !== "payment_pending") return;
    const lockIds = Array.isArray(intentSnap.get("reservationLockIds")) ?
      intentSnap.get("reservationLockIds") as string[] : [];
    const lockRefs = lockIds.map((id) =>
      db().collection(CHECKOUT_LOCK_COLLECTION).doc(id)
    );
    const lockSnaps = await Promise.all(lockRefs.map((ref) => tx.get(ref)));

    const ownsEveryLock = lockRefs.length > 0 && lockSnaps.every((snap) =>
      snap.exists && snap.get("intentId") === intentRef.id
    );
    if (!ownsEveryLock) {
      throw new Error(`Checkout ${intentRef.id} lost its payment reservation.`);
    }
    lockSnaps.forEach((_snap, index) => tx.set(lockRefs[index], {
      status: "payment_pending",
      expiresAt,
      updatedAt: serverTimestamp(),
    }, {merge: true}));
    tx.set(intentRef, {
      status: "payment_pending",
      reservationExpiresAt: expiresAt,
      updatedAt: serverTimestamp(),
    }, {merge: true});
  });
}

/**
 * Gives an expired local reservation one authoritative Stripe check before a
 * replacement purchase is attempted. A timestamp never releases a lock by
 * itself: terminal intent/Session state does. Paid or uncertain Sessions stay
 * blocked for webhook/manual recovery.
 */
async function reconcileExpiredCheckoutReservations(
  lockIds: string[],
  nowMillis = Date.now(),
  verifyRegardlessOfLockExpiry = false
): Promise<void> {
  const lockSnaps = await Promise.all(lockIds.map((id) =>
    db().collection(CHECKOUT_LOCK_COLLECTION).doc(id).get()
  ));
  const ownerIds = [...new Set(lockSnaps.flatMap((snap) => {
    if (!snap.exists) return [];
    const expiresAt = timestampMillis(snap.get("expiresAt"));
    if (!verifyRegardlessOfLockExpiry &&
      (expiresAt === null || expiresAt > nowMillis)) return [];
    return typeof snap.get("intentId") === "string" ?
      [snap.get("intentId") as string] : [];
  }))];

  for (const ownerId of ownerIds) {
    const intentRef = db().collection("membershipIntents").doc(ownerId);
    const intent = await intentRef.get();
    if (!intent.exists) {
      console.error("CRITICAL_BILLING_ORPHAN_CHECKOUT_LOCK", {intentId: ownerId});
      continue;
    }
    if (intent.get("stripeMode") !== assertBillingEnvironment().stripeMode) {
      console.error("CRITICAL_BILLING_CHECKOUT_LOCK_MODE_MISMATCH", {
        intentId: ownerId,
        storedStripeMode: intent.get("stripeMode") ?? null,
      });
      continue;
    }
    const status = intent.get("status") as MembershipIntentDoc["status"];
    if (status === "expired" || status === "failed") {
      await transitionCheckoutReservation(intentRef, status);
      continue;
    }
    const sessionId = intent.get("checkoutSessionId");
    if (typeof sessionId !== "string" || !sessionId) {
      console.error("CRITICAL_BILLING_UNVERIFIED_CHECKOUT_LOCK", {intentId: ownerId});
      continue;
    }

    try {
      let session = await stripe().checkout.sessions.retrieve(sessionId);
      assertStripeObjectMode("Checkout Session", session.id, session.livemode);
      if (session.status === "open" &&
        typeof session.expires_at === "number" &&
        session.expires_at * 1000 <= nowMillis) {
        session = await stripe().checkout.sessions.expire(sessionId);
        assertStripeObjectMode("Checkout Session", session.id, session.livemode);
      }
      if (session.status === "expired") {
        await transitionCheckoutReservation(intentRef, "expired", {
          verifiedTerminalAt: serverTimestamp(),
        });
      } else if (session.status === "complete") {
        await extendCheckoutReservationForAsyncPayment(intentRef);
        if (session.payment_status !== "unpaid") {
          console.error("CRITICAL_BILLING_PAID_SESSION_AWAITING_FULFILMENT", {
            intentId: ownerId,
            checkoutSessionId: sessionId,
          });
          await writeAudit({
            type: "paid_checkout_awaiting_fulfilment",
            severity: "critical",
            intentId: ownerId,
            checkoutSessionId: sessionId,
          }).catch((auditError) =>
            console.error("Could not write paid-checkout audit", ownerId, auditError)
          );
        }
      }
    } catch (error) {
      // Retrieval uncertainty is deliberately fail-closed; reserveCheckoutAttempt
      // will keep rejecting the replacement while this owner remains nonterminal.
      console.error("Checkout reservation verification failed", ownerId, error);
    }
  }
}

/** ---------------------------------------------------------------
 * Entitlement application
 * -------------------------------------------------------------- */

async function writeAudit(entry: Record<string, unknown>): Promise<void> {
  await db().collection("membershipAudit").add({
    ...entry,
    createdAt: serverTimestamp(),
  });
}

/**
 * Applies a membership's entitlement decision to the target profile, then
 * converges derived markers and Auth claims through the caller-supplied
 * Phase 0 routine.
 *
 * Staff roles are deliberately untouched: admin and SGPT access is granted by
 * role with a `staff` source and must remain independent of any consumer
 * membership. A banned role is never granted anything.
 */
async function applyMembershipEntitlement(
  membershipRef: DocumentReference,
  converge: (userId: string) => Promise<void>
): Promise<void> {
  const outcome = await db().runTransaction(async (tx) => {
    const membershipSnap = await tx.get(membershipRef);
    if (!membershipSnap.exists) return null;

    const membership = membershipSnap.data() as MembershipDoc;
    const uid = membership.entitlementTargetUid;
    if (!uid) return null;
    // A blocking presale owns the duplicate lock but must not change an
    // existing legacy/manual entitlement, approval, or Auth claims before first
    // payment, including when its first invoice has failed and is suspended.
    // Once that prepayment membership becomes terminal, release only its owner
    // generation; the profile still must remain completely untouched.
    if (membership.billingMode === "presale_deferred" &&
      membership.firstPaymentReceivedAt === null) {
      if (isMembershipStateBlockingDuplicate(membership.state)) return null;
      const owner = await readEntitlementOwner(tx, uid, membershipRef.id);
      if (owner.ownerSubscriptionId === membershipRef.id &&
        owner.ownerState === "active") {
        tx.set(owner.ref, {
          schemaVersion: MEMBERSHIP_SCHEMA_VERSION,
          subscriptionId: membershipRef.id,
          userIdHash: sha256(uid),
          state: "released",
          releasedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, {merge: true});
      }
      return null;
    }

    const decision = membership.providerContractStatus === "manual_review" &&
      isMembershipStateBlockingDuplicate(membership.state) ? {
        entitlementStatus: "restricted" as const,
        entitlementSource: "stripe" as const,
        reason: "Stripe subscription contract requires manual review.",
      } : resolveEntitlementForMembership(membership.planKey, membership.state);
    if (!decision) return null;

    const userRef = db().collection("users").doc(uid);
    const userSnap = await tx.get(userRef);
    const owner = await readEntitlementOwner(tx, uid, membershipRef.id);

    // Once a replacement membership owns this account, an older cancelled or
    // revoked membership is no longer authoritative for its entitlement. A
    // delayed convergence of the old subscription must not erase the valid
    // replacement grant or restore the old pre-membership snapshot.
    const membershipBlocks = isMembershipStateBlockingDuplicate(membership.state);
    if (!membershipBlocks &&
      (owner.ownerSubscriptionId !== membershipRef.id || owner.ownerState !== "active")) {
      return null;
    }

    const releaseOwnerWithoutProjection = (reason: string) => {
      if (!membershipBlocks && owner.ownerSubscriptionId === membershipRef.id &&
        owner.ownerState === "active") {
        tx.set(owner.ref, {
          schemaVersion: MEMBERSHIP_SCHEMA_VERSION,
          subscriptionId: membershipRef.id,
          userIdHash: sha256(uid),
          state: "released",
          releasedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, {merge: true});
      }
      tx.set(membershipRef, {
        entitlementProjectionStatus: "manual_review",
        entitlementProjectionError: reason,
        updatedAt: serverTimestamp(),
      }, {merge: true});
      return {convergeUid: null, reviewReason: reason, reviewUidHash: sha256(uid)};
    };

    // An ended membership must release its active generation even when the
    // target profile can no longer be safely projected. Otherwise a deleted,
    // malformed or staff-converted profile would block every replacement
    // membership forever. The profile itself remains untouched for review.
    if (!userSnap.exists) {
      return releaseOwnerWithoutProjection("The entitlement target profile is missing.");
    }

    const user = userSnap.data() as Record<string, unknown>;
    if (!isUserRole(user.role) || !isApprovalStatus(user.approvalStatus)) {
      return releaseOwnerWithoutProjection(
        "The entitlement target profile has an invalid role or approval status."
      );
    }
    if (user.role !== "user") {
      return releaseOwnerWithoutProjection(
        "The entitlement target is now a staff or banned profile and was left unchanged."
      );
    }

    const current = resolveUserAuthorisation(user as any);
    let nextStatus: EntitlementStatus = decision.entitlementStatus;
    let nextSource: EntitlementSource = decision.entitlementSource;

    // Remember what the member held before a paid membership first moved them,
    // so cancelling a purchase restores a grandfathered grant instead of
    // removing access the purchase never created.
    const preMembership = membership.preMembershipEntitlement ?? {
      entitlementStatus: current.entitlementStatus,
      entitlementSource: current.entitlementSource,
    };

    if (nextStatus === "none" &&
      preMembership.entitlementStatus === "active" &&
      (preMembership.entitlementSource === "legacy" ||
        preMembership.entitlementSource === "manual")) {
      nextStatus = preMembership.entitlementStatus;
      nextSource = preMembership.entitlementSource;
    }

    if (!isEntitlementCompatibleWithRole(user.role, nextStatus, nextSource)) {
      return releaseOwnerWithoutProjection(
        "The resolved membership entitlement is incompatible with the target profile."
      );
    }

    // A purchase that grants app access also completes approval for that
    // account. This is the only non-admin approval path and it exists solely
    // on the server-side fulfilment route.
    const approvalStatus = nextStatus === "active" ? "approved" : user.approvalStatus;
    const next = {
      role: user.role,
      approvalStatus,
      entitlementStatus: nextStatus,
      entitlementSource: nextSource,
    };
    const access = resolveUserAuthorisation(next);

    if (membershipBlocks) {
      acquireEntitlementOwner(tx, owner, uid, membershipRef.id);
    } else {
      // Keep a released generation as a tombstone. Otherwise a later webhook
      // for this same ended subscription would see no owner and could replay
      // the old entitlement restoration over a newer membership/manual grant.
      tx.set(owner.ref, {
        schemaVersion: MEMBERSHIP_SCHEMA_VERSION,
        subscriptionId: membershipRef.id,
        userIdHash: sha256(uid),
        state: "released",
        releasedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, {merge: true});
    }

    tx.set(userRef, {
      ...next,
      alphaWodAccess: access.alphaWodAccess,
      accessSchemaVersion: ACCESS_SCHEMA_VERSION,
      entitlementPlanKey: membership.planKey,
      entitlementReason: decision.reason,
      entitlementUpdatedAt: serverTimestamp(),
      entitlementUpdatedBy: "stripe_membership",
      ...(approvalStatus === "approved" && user.approvalStatus !== "approved" ?
        {approvedAt: serverTimestamp(), approvedBy: "stripe_membership"} :
        {}),
      updatedAt: serverTimestamp(),
    }, {merge: true});

    tx.set(membershipRef, {
      preMembershipEntitlement: preMembership,
      entitlementProjectionStatus: "applied",
      entitlementProjectionError: FieldValue.delete(),
      updatedAt: serverTimestamp(),
    }, {merge: true});

    return {convergeUid: uid, reviewReason: null, reviewUidHash: null};
  });

  if (outcome?.reviewReason) {
    console.error("CRITICAL_BILLING_ENTITLEMENT_PROJECTION_REVIEW", {
      subscriptionId: membershipRef.id,
      targetUidHash: outcome.reviewUidHash,
      reason: outcome.reviewReason,
    });
    await writeAudit({
      type: "entitlement_projection_manual_review",
      severity: "critical",
      subscriptionId: membershipRef.id,
      targetUidHash: outcome.reviewUidHash,
      reason: outcome.reviewReason,
    }).catch((error) =>
      console.error("Could not write entitlement projection audit", membershipRef.id, error)
    );
  }
  if (outcome?.convergeUid) await converge(outcome.convergeUid);
}

/** ---------------------------------------------------------------
 * Subscription convergence
 * -------------------------------------------------------------- */

function resolveCurrentPeriodEnd(subscription: Stripe.Subscription): number | null {
  // Recent Stripe API versions expose the period on the subscription item.
  const item = subscription.items?.data?.[0] as {current_period_end?: number} | undefined;
  if (typeof item?.current_period_end === "number") return item.current_period_end;

  const legacy = (subscription as unknown as {current_period_end?: unknown}).current_period_end;
  return typeof legacy === "number" ? legacy : null;
}

const MEMBERSHIP_CONVERGENCE_LEASE_MS = 2 * 60 * 1000;
// One Stripe request may use the configured 20-second timeout three times
// (the initial request plus two network retries). Leave headroom for retry
// backoff while staying below the two-minute Firestore lease.
const ELIGIBILITY_CONVERGENCE_CONTENTION_WAIT_MS = 75 * 1000;
const ELIGIBILITY_CONVERGENCE_CONTENTION_MAX_BACKOFF_MS = 250;
// Eligibility-aware callables may wait behind that lease and then still need
// further provider reads or a Checkout create. Override Firebase's 60-second
// default so the platform cannot terminate the intended bounded path first.
const MEMBERSHIP_INTERACTIVE_TIMEOUT_SECONDS = 540;
const SUSPENDED_RECONCILE_INTERVAL_MS = 15 * 60 * 1000;

class MembershipConvergenceInProgressError extends Error {
  constructor(
    subscriptionId: string,
    readonly leaseToken: string,
    readonly leaseExpiresAtMillis: number
  ) {
    super(`Membership ${subscriptionId} is already converging.`);
    this.name = "MembershipConvergenceInProgressError";
  }
}

type MembershipConvergenceOverrides = {
  pastDueSince?: number | null;
  accessRevoked?: boolean;
  dispute?: {id: string; status: Stripe.Dispute.Status};
  activationPayment?: {
    invoiceId: string;
    paidAt: number;
    amountPaidPence: number;
    currency: string;
    lines: Array<{
      subscriptionId: string;
      priceId: string;
      periodStart: number;
      quantity: number | null;
      proration: boolean;
    }>;
  };
};

function subscriptionLineEvidence(invoice: Stripe.Invoice): Array<{
  subscriptionId: string;
  priceId: string;
  periodStart: number;
  quantity: number | null;
  proration: boolean;
}> {
  return (invoice.lines?.data ?? []).flatMap((line) => {
    const details = line.parent?.subscription_item_details;
    const subscriptionId = details?.subscription ?? idOf(line.subscription);
    const priceId = idOf(line.pricing?.price_details?.price);
    if (line.parent?.type !== "subscription_item_details" || !details ||
      !subscriptionId || !priceId || typeof line.period?.start !== "number") {
      return [];
    }
    return [{
      subscriptionId,
      priceId,
      periodStart: line.period.start,
      quantity: line.quantity,
      proration: details.proration,
    }];
  });
}

function isOpenDisputeStatus(status: Stripe.Dispute.Status): boolean {
  return status !== "won" && status !== "lost" &&
    status !== "warning_closed" && status !== "prevented";
}

type MembershipConvergenceLease =
  | {state: "acquired"; token: string; expiresAtMillis: number}
  | {state: "missing"}
  | {state: "in_progress"; token: string; expiresAtMillis: number};

async function acquireMembershipConvergenceLease(
  membershipRef: DocumentReference,
  nowMillis = Date.now(),
  token = randomUUID()
): Promise<MembershipConvergenceLease> {
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(membershipRef);
    if (!snap.exists) return {state: "missing"} as const;
    const leaseExpiresAt = timestampMillis(snap.get("convergenceLeaseExpiresAt"));
    const activeToken = snap.get("convergenceLeaseToken");
    if (typeof activeToken === "string" &&
      leaseExpiresAt !== null && leaseExpiresAt > nowMillis) {
      return {
        state: "in_progress",
        token: activeToken,
        expiresAtMillis: leaseExpiresAt,
      } as const;
    }
    const expiresAtMillis = nowMillis + MEMBERSHIP_CONVERGENCE_LEASE_MS;
    tx.set(membershipRef, {
      convergenceLeaseToken: token,
      convergenceLeaseExpiresAt: Timestamp.fromMillis(
        expiresAtMillis
      ),
      updatedAt: serverTimestamp(),
    }, {merge: true});
    return {state: "acquired", token, expiresAtMillis} as const;
  });
}

async function releaseMembershipConvergenceLease(
  membershipRef: DocumentReference,
  token: string
): Promise<void> {
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(membershipRef);
    if (!snap.exists || snap.get("convergenceLeaseToken") !== token) return;
    tx.set(membershipRef, {
      convergenceLeaseToken: FieldValue.delete(),
      convergenceLeaseExpiresAt: FieldValue.delete(),
      updatedAt: serverTimestamp(),
    }, {merge: true});
  });
}

/**
 * Re-reads the subscription from Stripe and converges the stored membership.
 *
 * Webhook payloads are never trusted as the state authority: Stripe does not
 * guarantee delivery order, so a delayed `updated` event carrying an older
 * snapshot could otherwise restore access that has since been withdrawn.
 */
async function convergeMembershipFromStripe(
  subscriptionId: string,
  converge: (userId: string) => Promise<void>,
  overrides: MembershipConvergenceOverrides = {},
  nowMillis = Date.now()
): Promise<void> {
  // Fail before acquiring a Firestore lease: a mixed Firebase/Stripe
  // deployment must not mutate even local billing state before it is refused.
  assertBillingEnvironment();
  const membershipRef = db().collection("memberships").doc(subscriptionId);
  const lease = await acquireMembershipConvergenceLease(membershipRef);
  if (lease.state === "in_progress") {
    throw new MembershipConvergenceInProgressError(
      subscriptionId,
      lease.token,
      lease.expiresAtMillis
    );
  }

  let subscription: Stripe.Subscription;
  try {
    subscription = await stripe().subscriptions.retrieve(subscriptionId);
    assertStripeObjectMode("Subscription", subscription.id, subscription.livemode);
  } catch (error) {
    if (lease.state === "acquired") {
      await releaseMembershipConvergenceLease(membershipRef, lease.token).catch(() => undefined);
    }
    throw error;
  }

  let authoritativeActivationPayment = overrides.activationPayment;
  if (!authoritativeActivationPayment) {
    const presaleSnapshot = await membershipRef.get();
    const firstPaymentAt = presaleSnapshot.get("firstPaymentAt");
    if (presaleSnapshot.exists &&
      presaleSnapshot.get("billingMode") === "presale_deferred" &&
      presaleSnapshot.get("firstPaymentReceivedAt") == null &&
      typeof firstPaymentAt === "number" && nowMillis >= firstPaymentAt * 1000) {
      let latestInvoice = typeof subscription.latest_invoice === "string" ?
        await stripe().invoices.retrieve(subscription.latest_invoice) :
        subscription.latest_invoice;
      if (latestInvoice && typeof latestInvoice !== "string" &&
        "id" in latestInvoice) {
        latestInvoice = latestInvoice as Stripe.Invoice;
        if (typeof latestInvoice.livemode === "boolean") {
          assertStripeObjectMode("Invoice", latestInvoice.id, latestInvoice.livemode);
        }
        const paidAt = latestInvoice.status_transitions?.paid_at;
        if (resolveInvoiceSubscriptionId(latestInvoice) === subscriptionId &&
          latestInvoice.status === "paid" && latestInvoice.amount_paid > 0 &&
          typeof paidAt === "number" && typeof latestInvoice.currency === "string") {
          authoritativeActivationPayment = {
            invoiceId: latestInvoice.id,
            paidAt,
            amountPaidPence: latestInvoice.amount_paid,
            currency: latestInvoice.currency,
            lines: subscriptionLineEvidence(latestInvoice),
          };
        }
      }
    }
  }

  if (lease.state === "missing") {
    // Stripe can deliver subscription/invoice/refund events before Checkout
    // completion. App-owned subscriptions must be retried after fulfilment;
    // unrelated Stripe objects are intentionally ignored.
    if (subscription.metadata?.intentId) {
      throw new Error(
        `Membership ${subscriptionId} is waiting for Checkout intent ` +
        `${subscription.metadata.intentId} to fulfil.`
      );
    }
    return;
  }

  let convergenceOutcome: {
    state: MembershipState;
    disputeOpen: boolean;
    accessRevoked: boolean;
    settledCancellation: {
      requestId: string;
      payerUid: string | null;
      outcome: CancellationOutcome;
    } | null;
    cancellationDrift: {
      requestId: string;
      reason: string;
      repairQueued: boolean;
    } | null;
    providerContractError: string | null;
  };
  try {
    convergenceOutcome = await db().runTransaction(async (tx) => {
      const fresh = await tx.get(membershipRef);
      if (!fresh.exists || fresh.get("convergenceLeaseToken") !== lease.token) {
        throw new Error(`Membership ${subscriptionId} lost its convergence lease.`);
      }
      const stored = fresh.data() as MembershipDoc;
      const currentContractMismatch = stripeSubscriptionContractMismatch(
        subscription,
        {
          planKey: stored.planKey,
          stripePriceId: stored.stripePriceId,
          stripeCustomerId: stored.stripeCustomerId,
          billingCycleAnchor: stored.billingCycleAnchor,
        }
      );
      const providerNeedsManualReview = Boolean(currentContractMismatch);
      const openDisputeIds = Array.isArray(stored.openDisputeIds) ?
        [...new Set(stored.openDisputeIds.filter((id) => typeof id === "string"))] : [];
      if (overrides.dispute) {
        const index = openDisputeIds.indexOf(overrides.dispute.id);
        if (isOpenDisputeStatus(overrides.dispute.status) && index < 0) {
          openDisputeIds.push(overrides.dispute.id);
        } else if (!isOpenDisputeStatus(overrides.dispute.status) && index >= 0) {
          openDisputeIds.splice(index, 1);
        }
      }
      const disputeOpen = overrides.dispute ?
        openDisputeIds.length > 0 :
        openDisputeIds.length > 0 || stored.disputeOpen === true;
      // A full refund or lost dispute is irreversible automatically. Support
      // can correct an exceptional case explicitly, but a delayed event can
      // never clear revocation and restore access.
      const accessRevoked = stored.accessRevoked === true ||
        overrides.accessRevoked === true || overrides.dispute?.status === "lost";

      let firstPaymentReceivedAt = typeof stored.firstPaymentReceivedAt === "number" ?
        stored.firstPaymentReceivedAt : null;
      let firstPaidInvoiceId = typeof stored.firstPaidInvoiceId === "string" ?
        stored.firstPaidInvoiceId : null;
      const activationPayment = authoritativeActivationPayment;
      if (stored.billingMode === "presale_deferred" && activationPayment) {
        const matchingLines = activationPayment.lines.filter((line) =>
          line.subscriptionId === subscriptionId &&
          line.priceId === stored.stripePriceId &&
          line.quantity === 1 && line.proration === false
        );
        if (matchingLines.length !== 1) {
          throw new Error(
            `Invoice ${activationPayment.invoiceId} has no unique approved membership line.`
          );
        }
        const [membershipLine] = matchingLines;
        if (activationPayment.paidAt < stored.firstPaymentAt ||
          membershipLine.periodStart < stored.firstPaymentAt ||
          activationPayment.amountPaidPence <= 0 ||
          activationPayment.currency !== "gbp") {
          throw new Error(
            `Invoice ${activationPayment.invoiceId} is not an approved recurring payment.`
          );
        }
        const discountedPeriod = Boolean(stored.discount) &&
          typeof stored.paymentSchedule?.fullPriceFrom === "number" &&
          membershipLine.periodStart < stored.paymentSchedule.fullPriceFrom;
        const expectedAmount = discountedPeriod ?
          stored.paymentSchedule?.discountedMonthlyPence :
          (stored.paymentSchedule?.standardMonthlyPence ??
            getPlan(stored.planKey).amountPence);
        if (typeof expectedAmount !== "number" ||
          activationPayment.amountPaidPence !== expectedAmount) {
          throw new Error(
            `Invoice ${activationPayment.invoiceId} paid an unexpected first-payment amount.`
          );
        }
        if (firstPaymentReceivedAt === null ||
          activationPayment.paidAt < firstPaymentReceivedAt) {
          firstPaymentReceivedAt = activationPayment.paidAt;
          firstPaidInvoiceId = activationPayment.invoiceId;
        }
      }

      let pastDueSince: number | null = null;
      if (subscription.status === "past_due") {
        const detectedAt = Math.floor(nowMillis / 1000);
        const incoming = typeof overrides.pastDueSince === "number" ?
          overrides.pastDueSince : null;
        const storedFailure = typeof stored.pastDueSince === "number" ?
          stored.pastDueSince : null;
        const candidates = [incoming, storedFailure].filter(
          (value): value is number => value !== null
        );
        pastDueSince = candidates.length > 0 ? Math.min(...candidates) : detectedAt;
      }
      const graceEndMillis = resolvePastDueGraceEndMillis(pastDueSince);
      const pastDueGraceEndsAt = graceEndMillis === null ?
        null : Timestamp.fromMillis(graceEndMillis);
      let state = resolveMembershipState({
        stripeStatus: subscription.status,
        pastDueSinceUnixSeconds: pastDueSince,
        disputeOpen,
        accessRevoked,
        cancelAtUnixSeconds: subscription.cancel_at,
        serviceStartsAtUnixSeconds: stored.serviceStartsAt,
        activationPendingFirstPayment:
          stored.billingMode === "presale_deferred" && firstPaymentReceivedAt === null,
      }, nowMillis);
      if (stored.billingMode === "presale_deferred" &&
        firstPaymentReceivedAt === null && state === "past_due_grace") {
        // Past-due grace preserves already-earned access. A founding presale
        // has no earned access until its first recurring invoice is paid.
        state = "past_due_suspended";
      }
      const nextReconcileAt = state === "scheduled" ?
        Timestamp.fromMillis(Math.max(
          stored.firstPaymentAt * 1000,
          nowMillis + SUSPENDED_RECONCILE_INTERVAL_MS
        )) : state === "past_due_grace" ?
          pastDueGraceEndsAt : state === "past_due_suspended" ?
            Timestamp.fromMillis(
              nowMillis + SUSPENDED_RECONCILE_INTERVAL_MS
            ) : null;

      const pendingCancellation = stored.cancellationRequest;
      const authoritativeCancelAt = authoritativeSubscriptionCancellationEnd(subscription);
      let projectedCancelAt = authoritativeCancelAt;
      let settledCancellation: {
        requestId: string;
        payerUid: string | null;
        outcome: CancellationOutcome;
      } | null = null;
      let cancellationDrift: {
        requestId: string;
        reason: string;
        repairQueued: boolean;
      } | null = null;
      let cancellationUpdate: Record<string, unknown> = {};
      const validRequest = typeof pendingCancellation?.id === "string" &&
        pendingCancellation.receivedAt instanceof Timestamp &&
        typeof pendingCancellation.outcome?.cancelAtUnixSeconds === "number";
      const successfulPresaleWithdrawal = validRequest &&
        pendingCancellation.kind === "presale_withdrawal" &&
        subscription.status === "canceled" && authoritativeCancelAt !== null &&
        pendingCancellation.receivedAt.toMillis() < stored.serviceStartsAt * 1000 &&
        authoritativeCancelAt < stored.firstPaymentAt &&
        stored.firstPaymentReceivedAt === null;
      const successfulCoolingOffCancellation = validRequest &&
        pendingCancellation.kind === "cooling_off" &&
        typeof pendingCancellation.receiptId === "string" &&
        subscription.status === "canceled" && authoritativeCancelAt !== null;

      if (stored.cancellationOutcome) {
        const promisedCancelAt = stored.cancellationOutcome.cancelAtUnixSeconds;
        if (successfulCoolingOffCancellation) {
          // Stripe normally records `ended_at` a little after the notice was
          // received. That provider completion time must not replace, delay,
          // or invalidate the immutable cooling-off effective/access stop.
          projectedCancelAt = promisedCancelAt;
          cancellationUpdate = {
            cancellationOutcome: stored.cancellationOutcome,
            cancellationRequest: {
              ...pendingCancellation,
              status: "applied",
              outcome: stored.cancellationOutcome,
              stripeCancelAt: authoritativeCancelAt,
              providerEndedAtMillis: authoritativeCancelAt * 1000,
              nextAttemptAt: FieldValue.delete(),
              leaseToken: FieldValue.delete(),
              leaseExpiresAt: FieldValue.delete(),
              lastError: FieldValue.delete(),
            },
          };
        } else if (successfulPresaleWithdrawal) {
          projectedCancelAt = authoritativeCancelAt;
          cancellationUpdate = {
            cancellationOutcome: stored.cancellationOutcome,
            cancellationRequest: {
              ...pendingCancellation,
              status: "applied",
              outcome: stored.cancellationOutcome,
              stripeCancelAt: authoritativeCancelAt,
              nextAttemptAt: FieldValue.delete(),
              leaseToken: FieldValue.delete(),
              leaseExpiresAt: FieldValue.delete(),
              lastError: FieldValue.delete(),
            },
          };
        } else if (authoritativeCancelAt !== null &&
          authoritativeCancelAt <= promisedCancelAt) {
          const aligned = alignCancellationOutcome(
            stored.cancellationOutcome,
            authoritativeCancelAt
          );
          projectedCancelAt = authoritativeCancelAt;
          cancellationUpdate = {
            cancellationOutcome: aligned,
            ...(validRequest ? {
              cancellationRequest: {
                ...pendingCancellation,
                status: "applied",
                outcome: aligned,
                stripeCancelAt: authoritativeCancelAt,
                nextAttemptAt: FieldValue.delete(),
                leaseToken: FieldValue.delete(),
                leaseExpiresAt: FieldValue.delete(),
                lastError: FieldValue.delete(),
              },
            } : {}),
          };
        } else if (subscription.status === "canceled" &&
          authoritativeCancelAt !== null &&
          promisedCancelAt <= Math.floor(nowMillis / 1000)) {
          const reason =
            "Stripe ended this subscription after the cancellation date promised to the member. " +
            "Review charges after that date and issue any required refund.";
          projectedCancelAt = promisedCancelAt;
          cancellationDrift = {
            requestId: validRequest ? pendingCancellation.id : `repair-${subscriptionId}`,
            reason,
            repairQueued: false,
          };
          cancellationUpdate = {
            cancellationOutcome: stored.cancellationOutcome,
            ...(validRequest ? {
              cancellationRequest: {
                ...pendingCancellation,
                status: "manual_review",
                outcome: stored.cancellationOutcome,
                stripeCancelAt: authoritativeCancelAt,
                lastError: reason,
                manualReviewAt: serverTimestamp(),
                nextAttemptAt: FieldValue.delete(),
                leaseToken: FieldValue.delete(),
                leaseExpiresAt: FieldValue.delete(),
              },
            } : {}),
          };
        } else {
          const repairQueued = subscription.status !== "canceled";
          const requestId = validRequest ?
            pendingCancellation.id : `repair-${subscriptionId}`;
          const repairGeneration = typeof pendingCancellation?.repairGeneration === "number" ?
            pendingCancellation.repairGeneration : 0;
          const reason = authoritativeCancelAt === null ?
            "Stripe no longer has the confirmed cancellation schedule." :
            "Stripe has a later cancellation schedule than the member confirmed.";
          projectedCancelAt = promisedCancelAt;
          cancellationDrift = {requestId, reason, repairQueued};
          cancellationUpdate = {
            cancellationOutcome: null,
            cancellationRequest: {
              ...(pendingCancellation ?? {}),
              id: requestId,
              status: repairQueued ? "pending" : "manual_review",
              receivedAt: validRequest ? pendingCancellation.receivedAt :
                (stored.cancellationRequestedAt instanceof Timestamp ?
                  stored.cancellationRequestedAt :
                  Timestamp.fromMillis(nowMillis)),
              outcome: stored.cancellationOutcome,
              repairGeneration: pendingCancellation?.status === "pending" ?
                repairGeneration : repairGeneration + 1,
              recoveryStartedAt: pendingCancellation?.status === "pending" &&
                pendingCancellation.recoveryStartedAt instanceof Timestamp ?
                pendingCancellation.recoveryStartedAt :
                Timestamp.fromMillis(nowMillis),
              attemptCount: pendingCancellation?.status === "pending" ?
                (pendingCancellation.attemptCount ?? 0) : 0,
              lastError: reason,
              ...(repairQueued ? {
                nextAttemptAt: Timestamp.fromMillis(nowMillis),
              } : {
                nextAttemptAt: FieldValue.delete(),
                manualReviewAt: serverTimestamp(),
              }),
              leaseToken: FieldValue.delete(),
              leaseExpiresAt: FieldValue.delete(),
            },
          };
        }
      } else if (successfulCoolingOffCancellation) {
        settledCancellation = {
          requestId: pendingCancellation.id,
          payerUid: stored.payerUid,
          outcome: pendingCancellation.outcome,
        };
        projectedCancelAt = pendingCancellation.outcome.cancelAtUnixSeconds;
        cancellationUpdate = {
          cancellationRequestedAt: pendingCancellation.receivedAt,
          cancellationOutcome: settledCancellation.outcome,
          cancellationRequest: {
            ...pendingCancellation,
            status: "applied",
            outcome: settledCancellation.outcome,
            stripeCancelAt: authoritativeCancelAt,
            providerEndedAtMillis: authoritativeCancelAt * 1000,
            appliedAt: serverTimestamp(),
            nextAttemptAt: FieldValue.delete(),
            leaseToken: FieldValue.delete(),
            leaseExpiresAt: FieldValue.delete(),
            lastError: FieldValue.delete(),
          },
        };
      } else if (successfulPresaleWithdrawal) {
        settledCancellation = {
          requestId: pendingCancellation.id,
          payerUid: stored.payerUid,
          outcome: pendingCancellation.outcome,
        };
        projectedCancelAt = authoritativeCancelAt;
        cancellationUpdate = {
          cancellationRequestedAt: pendingCancellation.receivedAt,
          cancellationOutcome: settledCancellation.outcome,
          cancellationRequest: {
            ...pendingCancellation,
            status: "applied",
            outcome: settledCancellation.outcome,
            stripeCancelAt: authoritativeCancelAt,
            appliedAt: serverTimestamp(),
            nextAttemptAt: FieldValue.delete(),
            leaseToken: FieldValue.delete(),
            leaseExpiresAt: FieldValue.delete(),
            lastError: FieldValue.delete(),
          },
        };
      } else if ((pendingCancellation?.status === "pending" ||
        pendingCancellation?.status === "manual_review") && validRequest &&
        authoritativeCancelAt !== null &&
        authoritativeCancelAt <= pendingCancellation.outcome.cancelAtUnixSeconds) {
        settledCancellation = {
          requestId: pendingCancellation.id,
          payerUid: stored.payerUid,
          outcome: alignCancellationOutcome(
            pendingCancellation.outcome,
            authoritativeCancelAt
          ),
        };
        projectedCancelAt = authoritativeCancelAt;
        cancellationUpdate = {
          cancellationRequestedAt: pendingCancellation.receivedAt,
          cancellationOutcome: settledCancellation.outcome,
          cancellationRequest: {
            ...pendingCancellation,
            status: "applied",
            outcome: settledCancellation.outcome,
            stripeCancelAt: authoritativeCancelAt,
            appliedAt: serverTimestamp(),
            nextAttemptAt: FieldValue.delete(),
            leaseToken: FieldValue.delete(),
            leaseExpiresAt: FieldValue.delete(),
            lastError: FieldValue.delete(),
          },
        };
      } else if (validRequest && subscription.status === "canceled" &&
        authoritativeCancelAt !== null &&
        authoritativeCancelAt > pendingCancellation.outcome.cancelAtUnixSeconds &&
        pendingCancellation.outcome.cancelAtUnixSeconds <= Math.floor(nowMillis / 1000)) {
        const reason =
          "Stripe ended this subscription after the cancellation date promised to the member. " +
          "Review charges after that date and issue any required refund.";
        projectedCancelAt = pendingCancellation.outcome.cancelAtUnixSeconds;
        cancellationDrift = {
          requestId: pendingCancellation.id,
          reason,
          repairQueued: false,
        };
        cancellationUpdate = {
          cancellationRequestedAt: pendingCancellation.receivedAt,
          cancellationOutcome: pendingCancellation.outcome,
          cancellationRequest: {
            ...pendingCancellation,
            status: "manual_review",
            stripeCancelAt: authoritativeCancelAt,
            lastError: reason,
            manualReviewAt: serverTimestamp(),
            nextAttemptAt: FieldValue.delete(),
            leaseToken: FieldValue.delete(),
            leaseExpiresAt: FieldValue.delete(),
          },
        };
      } else if (!stored.cancellationOutcome && validRequest &&
        subscription.status === "canceled" && authoritativeCancelAt === null) {
        const reason = "Stripe canceled the subscription without an authoritative end time.";
        cancellationDrift = {
          requestId: pendingCancellation.id,
          reason,
          repairQueued: false,
        };
        cancellationUpdate = {
          cancellationRequest: {
            ...pendingCancellation,
            status: "manual_review",
            lastError: reason,
            manualReviewAt: serverTimestamp(),
            nextAttemptAt: FieldValue.delete(),
            leaseToken: FieldValue.delete(),
            leaseExpiresAt: FieldValue.delete(),
          },
        };
      }

      tx.set(membershipRef, {
        state,
        stripeStatus: subscription.status,
        firstPaymentReceivedAt,
        firstPaidInvoiceId,
        currentPeriodEnd: resolveCurrentPeriodEnd(subscription),
        cancelAt: projectedCancelAt,
        openDisputeIds,
        disputeOpen,
        accessRevoked,
        providerContractStatus: providerNeedsManualReview ?
          "manual_review" : "verified",
        providerContractError: currentContractMismatch ??
          FieldValue.delete(),
        pastDueSince,
        pastDueGraceEndsAt,
        nextReconcileAt,
        ...cancellationUpdate,
        // This marker and the authoritative membership projection commit in
        // the same transaction. A waiter can therefore accept this exact
        // lease's result without issuing a second Stripe read. A failed lease
        // is merely released and never writes a completion token.
        convergenceCompletedLeaseToken: lease.token,
        convergenceCompletedAt: serverTimestamp(),
        convergenceLeaseToken: FieldValue.delete(),
        convergenceLeaseExpiresAt: FieldValue.delete(),
        updatedAt: serverTimestamp(),
      }, {merge: true});
      return {
        state,
        disputeOpen,
        accessRevoked,
        settledCancellation,
        cancellationDrift,
        providerContractError: currentContractMismatch,
      };
    });
  } catch (error) {
    await releaseMembershipConvergenceLease(membershipRef, lease.token).catch(() => undefined);
    throw error;
  }

  await applyMembershipEntitlement(membershipRef, converge);
  await writeAudit({
    type: "membership_converged",
    subscriptionId,
    state: convergenceOutcome.state,
    stripeStatus: subscription.status,
    disputeOpen: convergenceOutcome.disputeOpen,
    accessRevoked: convergenceOutcome.accessRevoked,
  });
  if (convergenceOutcome.providerContractError) {
    console.error("CRITICAL_BILLING_PROVIDER_CONTRACT_MISMATCH", {
      subscriptionId,
      error: convergenceOutcome.providerContractError,
    });
    await writeAudit({
      type: "provider_contract_mismatch",
      severity: "critical",
      subscriptionId,
      error: convergenceOutcome.providerContractError,
    });
  }
  if (convergenceOutcome.settledCancellation) {
    await writeAudit({
      type: "cancellation_requested",
      subscriptionId,
      payerUid: convergenceOutcome.settledCancellation.payerUid,
      requestId: convergenceOutcome.settledCancellation.requestId,
      outcome: convergenceOutcome.settledCancellation.outcome,
      settledBy: "stripe_convergence",
    });
  }
  if (convergenceOutcome.cancellationDrift) {
    console.error("CRITICAL_BILLING_CANCELLATION_DRIFT", {
      subscriptionId,
      ...convergenceOutcome.cancellationDrift,
    });
    await writeAudit({
      type: "cancellation_schedule_drift",
      severity: "critical",
      subscriptionId,
      ...convergenceOutcome.cancellationDrift,
    });
  }
}

type AuthoritativeEligibilityContext =
  | "checkout_duplicate_admission"
  | "membership_claim"
  | "participant_link_or_repair";

const AUTHORITATIVE_ELIGIBILITY_UNAVAILABLE =
  "Current membership status could not be verified with Stripe. No new purchase, claim or link was made. Try again later.";

type EligibilityConvergenceContentionOptions = {
  waitMs?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
};

async function waitForMembershipConvergenceCompletion(
  subscriptionId: string,
  collision: MembershipConvergenceInProgressError,
  options: EligibilityConvergenceContentionOptions = {}
): Promise<void> {
  const membershipRef = db().collection("memberships").doc(subscriptionId);
  const waitMs = options.waitMs ??
    ELIGIBILITY_CONVERGENCE_CONTENTION_WAIT_MS;
  const deadlineMillis = Math.min(
    Date.now() + Math.max(0, waitMs),
    collision.leaseExpiresAtMillis
  );
  let backoffMs = Math.max(1, options.initialBackoffMs ?? 25);
  const maxBackoffMs = Math.max(
    backoffMs,
    options.maxBackoffMs ??
      ELIGIBILITY_CONVERGENCE_CONTENTION_MAX_BACKOFF_MS
  );

  for (;;) {
    const snapshot = await membershipRef.get();
    if (!snapshot.exists) {
      throw new Error(
        `Membership ${subscriptionId} disappeared during convergence contention.`
      );
    }
    if (snapshot.get("convergenceCompletedLeaseToken") ===
      collision.leaseToken) {
      return;
    }

    const activeToken = snapshot.get("convergenceLeaseToken");
    const activeExpiresAtMillis = timestampMillis(
      snapshot.get("convergenceLeaseExpiresAt")
    );
    if (activeToken !== collision.leaseToken ||
      activeExpiresAtMillis !== collision.leaseExpiresAtMillis) {
      throw new Error(
        `Membership ${subscriptionId} released its convergence lease ` +
        "without completing it."
      );
    }

    const nowMillis = Date.now();
    if (nowMillis >= deadlineMillis || nowMillis >= activeExpiresAtMillis) {
      throw new Error(
        `Membership ${subscriptionId} convergence did not complete before ` +
        "its contention deadline."
      );
    }
    await new Promise((resolve) => setTimeout(
      resolve,
      Math.min(backoffMs, deadlineMillis - nowMillis)
    ));
    backoffMs = Math.min(backoffMs * 2, maxBackoffMs);
  }
}

/**
 * Serialises eligibility reads behind a concurrent authoritative convergence.
 * A lease collision is local contention, not evidence that Stripe is
 * unavailable. The waiter accepts only the exact colliding lease's committed
 * completion marker, so it does not amplify Stripe traffic and cannot mistake
 * a failed, expired or replacement lease for authoritative success.
 */
async function convergeEligibilityMembershipFromStripe(
  subscriptionId: string,
  converge: (userId: string) => Promise<void>,
  contentionOptions: EligibilityConvergenceContentionOptions = {}
): Promise<void> {
  try {
    await convergeMembershipFromStripe(subscriptionId, converge);
  } catch (error) {
    if (!(error instanceof MembershipConvergenceInProgressError)) throw error;
    await waitForMembershipConvergenceCompletion(
      subscriptionId,
      error,
      contentionOptions
    );
  }
}

/**
 * Converges every stored subscription that can affect a state-sensitive
 * eligibility decision. A local terminal state is not proof that Stripe has
 * stopped billing: delayed/dead-lettered lifecycle events must therefore be
 * healed before the final Firestore transaction is allowed to decide.
 */
async function convergeEligibilityMemberships(
  snapshots: DocumentSnapshot[],
  converge: (userId: string) => Promise<void>,
  context: AuthoritativeEligibilityContext
): Promise<Set<string>> {
  const memberships = new Map<string, DocumentSnapshot>();
  snapshots.forEach((snapshot) => {
    if (snapshot.exists) memberships.set(snapshot.id, snapshot);
  });

  for (const snapshot of [...memberships.values()].sort((left, right) =>
    left.id.localeCompare(right.id)
  )) {
    const storedSubscriptionId = snapshot.get("subscriptionId");
    if (storedSubscriptionId !== snapshot.id) {
      console.error("CRITICAL_BILLING_ELIGIBILITY_STATE_UNCERTAIN", {
        context,
        subscriptionId: snapshot.id,
        reason: "subscription_id_mismatch",
      });
      await writeAudit({
        type: "membership_eligibility_state_uncertain",
        severity: "critical",
        context,
        subscriptionId: snapshot.id,
        reason: "subscription_id_mismatch",
      }).catch((error) =>
        console.error("Could not write eligibility-state audit", snapshot.id, error)
      );
      throw new HttpsError(
        "unavailable",
        AUTHORITATIVE_ELIGIBILITY_UNAVAILABLE,
        {reason: "membership_state_unavailable"}
      );
    }

    try {
      await convergeEligibilityMembershipFromStripe(snapshot.id, converge);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("CRITICAL_BILLING_ELIGIBILITY_STATE_UNCERTAIN", {
        context,
        subscriptionId: snapshot.id,
        reason: message.slice(0, 500),
      });
      await writeAudit({
        type: "membership_eligibility_state_uncertain",
        severity: "critical",
        context,
        subscriptionId: snapshot.id,
        reason: message.slice(0, 500),
      }).catch((auditError) =>
        console.error("Could not write eligibility-state audit", snapshot.id, auditError)
      );
      throw new HttpsError(
        "unavailable",
        AUTHORITATIVE_ELIGIBILITY_UNAVAILABLE,
        {reason: "membership_state_unavailable"}
      );
    }
  }
  return new Set(memberships.keys());
}

/** Existing AlphaWOD memberships that can block a grant to this account. */
async function alphaWodMembershipsForAccount(
  userId: string
): Promise<DocumentSnapshot[]> {
  const [byPayer, byTarget] = await Promise.all([
    db().collection("memberships").where("payerUid", "==", userId).get(),
    db().collection("memberships").where("entitlementTargetUid", "==", userId).get(),
  ]);
  const relevant = new Map<string, DocumentSnapshot>();
  [...byPayer.docs, ...byTarget.docs].forEach((snapshot) => {
    if (snapshot.get("grantsAlphaWodAccess") === true) {
      relevant.set(snapshot.id, snapshot);
    }
  });
  const owner = await entitlementOwnerRef(userId).get();
  if (owner.exists && owner.get("state") !== "released") {
    const ownerSubscriptionId = owner.get("subscriptionId");
    if (typeof ownerSubscriptionId !== "string" || !ownerSubscriptionId) {
      console.error("CRITICAL_BILLING_ELIGIBILITY_STATE_UNCERTAIN", {
        context: "entitlement_owner",
        targetUidHash: sha256(userId),
        reason: "invalid_active_owner",
      });
      throw new HttpsError(
        "unavailable",
        AUTHORITATIVE_ELIGIBILITY_UNAVAILABLE,
        {reason: "membership_state_unavailable"}
      );
    }
    if (!relevant.has(ownerSubscriptionId)) {
      const ownerMembership = await db().collection("memberships")
        .doc(ownerSubscriptionId).get();
      if (!ownerMembership.exists) {
        console.error("CRITICAL_BILLING_ELIGIBILITY_STATE_UNCERTAIN", {
          context: "entitlement_owner",
          subscriptionId: ownerSubscriptionId,
          targetUidHash: sha256(userId),
          reason: "active_owner_membership_missing",
        });
        throw new HttpsError(
          "unavailable",
          AUTHORITATIVE_ELIGIBILITY_UNAVAILABLE,
          {reason: "membership_state_unavailable"}
        );
      }
      relevant.set(ownerMembership.id, ownerMembership);
    }
  }
  return [...relevant.values()];
}

function assertEligibilityDocsWereConverged(
  snapshots: QueryDocumentSnapshot[],
  convergedMembershipIds: ReadonlySet<string>
): void {
  const unconverged = snapshots.find((snapshot) =>
    !convergedMembershipIds.has(snapshot.id)
  );
  if (unconverged) {
    console.error("CRITICAL_BILLING_ELIGIBILITY_NEW_MEMBERSHIP_RACE", {
      subscriptionId: unconverged.id,
    });
    throw new HttpsError(
      "unavailable",
      AUTHORITATIVE_ELIGIBILITY_UNAVAILABLE,
      {reason: "membership_state_changed"}
    );
  }
}

/**
 * Reconciles every stored membership considered by a new checkout's duplicate
 * guard. The following reservation transaction performs the final re-read, so
 * concurrent local claims/links/checkouts still contend atomically.
 */
async function convergeCheckoutDuplicateScope(
  participantKey: string,
  payerUid: string | null,
  grantsAlphaWodAccess: boolean,
  converge: (userId: string) => Promise<void>
): Promise<Set<string>> {
  const byParticipant = await db().collection("memberships")
    .where("participant.participantKey", "==", participantKey).get();
  const accountMemberships = payerUid && grantsAlphaWodAccess ?
    await alphaWodMembershipsForAccount(payerUid) : [];
  return convergeEligibilityMemberships(
    [...byParticipant.docs, ...accountMemberships],
    converge,
    "checkout_duplicate_admission"
  );
}

/** Re-checks memberships whose activation or payment-recovery deadline is due. */
async function reconcilePastDueMembershipsOnce(
  converge: (userId: string) => Promise<void>,
  nowMillis = Date.now(),
  limit = 100
): Promise<{processed: number; failed: number}> {
  assertBillingEnvironment();
  const due = await db().collection("memberships")
    .where("state", "in", ["scheduled", "past_due_grace", "past_due_suspended"])
    .where("nextReconcileAt", "<=", Timestamp.fromMillis(nowMillis))
    .orderBy("nextReconcileAt", "asc")
    .limit(limit)
    .get();
  const result = {processed: 0, failed: 0};

  for (const membership of due.docs) {
    try {
      // Stripe is re-read immediately before mutation. A payment that recovered
      // just before this sweep therefore restores active state instead of being
      // suspended by a stale Firestore snapshot.
      await convergeMembershipFromStripe(
        membership.id,
        converge,
        {},
        Math.max(nowMillis, Date.now())
      );
      result.processed += 1;
    } catch (error) {
      console.error("Past-due membership reconciliation failed", membership.id, error);
      result.failed += 1;
    }
  }

  return result;
}

export function buildReconcilePastDueMemberships(
  converge: (userId: string) => Promise<void>
) {
  return onSchedule({
    region: REGION,
    schedule: "every 15 minutes",
    timeZone: "UTC",
    secrets: MEMBERSHIP_STRIPE_WORKER_SECRETS,
    timeoutSeconds: 540,
  }, async () => {
    const result = await reconcilePastDueMembershipsOnce(converge);
    console.log("Past-due membership reconciliation result", result);
  });
}

/** ---------------------------------------------------------------
 * Callables
 * -------------------------------------------------------------- */

/**
 * App Check enforcement rejects invalid tokens before the handler. This
 * second check binds the anonymous sale to the intended web app and rejects a
 * valid token that replay protection reports as already consumed.
 */
function assertCheckoutAppCheck(
  request: any,
  enforce = !isFirebaseFunctionsEmulatorProcess(),
  expectedAppId?: string
): void {
  if (!enforce) return;
  const configuredAppId = expectedAppId?.trim() ||
    membershipCheckoutAppId.value().trim();
  if (!configuredAppId) {
    console.error("CRITICAL_BILLING_CHECKOUT_ABUSE_CONFIGURATION", {
      reason: "missing_app_id",
    });
    throw new HttpsError(
      "unavailable",
      "Checkout security is not configured. Try again later.",
      {reason: "checkout_security_unavailable"}
    );
  }

  const app = request?.app;
  if (app?.alreadyConsumed === true) {
    console.warn("MEMBERSHIP_CHECKOUT_APP_CHECK_REPLAY", {
      reason: "already_consumed",
    });
    throw new HttpsError(
      "permission-denied",
      "Checkout security verification could not be completed. Refresh and try again.",
      {reason: "app_check_replay"}
    );
  }
  if (!app || app.appId !== configuredAppId) {
    console.warn("MEMBERSHIP_CHECKOUT_APP_CHECK_REJECTED", {
      reason: app ? "app_id_mismatch" : "missing_context",
    });
    throw new HttpsError(
      "permission-denied",
      "Checkout security verification could not be completed. Refresh and try again.",
      {reason: "app_check_rejected"}
    );
  }
}

/**
 * Bounds even malformed App-Check-verified traffic before request or Auth
 * parsing. These generous request-volume buckets are independent from the
 * stricter stable-attempt admission below, so legitimate provider/network
 * retries retain their existing idempotent allowance.
 */
async function admitEarlyCheckoutRequest(
  request: any,
  nowMillis = Date.now()
): Promise<void> {
  try {
    const sourceHash = deriveCheckoutSourceHash(
      request?.rawRequest?.ip,
      membershipCheckoutRateLimitSecret.value()
    );
    await admitEarlyMembershipCheckoutRequest({
      firestore: db(),
      sourceHash,
      nowMillis,
    });
  } catch (error) {
    if (error instanceof CheckoutRateLimitExceededError) {
      console.warn("MEMBERSHIP_CHECKOUT_RATE_LIMITED", {
        stage: "pre_parse",
        windows: error.windows,
        retryAfterSeconds: error.retryAfterSeconds,
      });
      throw new HttpsError(
        "resource-exhausted",
        "Too many checkout requests. Wait before trying again.",
        {
          reason: "checkout_rate_limited",
          retryAfterSeconds: error.retryAfterSeconds,
        }
      );
    }
    if (error instanceof CheckoutRateLimitStateError) {
      console.error("CRITICAL_BILLING_CHECKOUT_ABUSE_CONFIGURATION", {
        reason: "early_rate_limit_state_unavailable",
      });
      throw new HttpsError(
        "unavailable",
        "Checkout security could not be verified. Try again later.",
        {reason: "checkout_security_unavailable"}
      );
    }
    throw error;
  }
}

async function admitCheckoutRequest(input: {
  request: any;
  intentRef: DocumentReference;
  checkoutAttemptHash: string;
  requestFingerprint: string;
  nowMillis: number;
}): Promise<void> {
  try {
    const sourceHash = deriveCheckoutSourceHash(
      input.request?.rawRequest?.ip,
      membershipCheckoutRateLimitSecret.value()
    );
    await admitMembershipCheckoutAttempt({
      firestore: db(),
      intentRef: input.intentRef,
      checkoutAttemptHash: input.checkoutAttemptHash,
      requestFingerprint: input.requestFingerprint,
      sourceHash,
      nowMillis: input.nowMillis,
    });
  } catch (error) {
    if (error instanceof CheckoutAttemptFingerprintMismatchError) {
      throw new HttpsError(
        "failed-precondition",
        "This checkout attempt was already used with different membership details."
      );
    }
    if (error instanceof CheckoutRateLimitExceededError) {
      console.warn("MEMBERSHIP_CHECKOUT_RATE_LIMITED", {
        windows: error.windows,
        retryAfterSeconds: error.retryAfterSeconds,
      });
      throw new HttpsError(
        "resource-exhausted",
        "Too many new checkout attempts. Wait before trying again.",
        {
          reason: "checkout_rate_limited",
          retryAfterSeconds: error.retryAfterSeconds,
        }
      );
    }
    if (error instanceof CheckoutRateLimitStateError) {
      console.error("CRITICAL_BILLING_CHECKOUT_ABUSE_CONFIGURATION", {
        reason: "rate_limit_state_unavailable",
      });
      throw new HttpsError(
        "unavailable",
        "Checkout security could not be verified. Try again later.",
        {reason: "checkout_security_unavailable"}
      );
    }
    throw error;
  }
}

function buildCreateMembershipCheckoutHandler(
  assertPurchaseOpen: () => void,
  enforceAppCheck = !isFirebaseFunctionsEmulatorProcess(),
  converge: (userId: string) => Promise<void> = async () => undefined
) {
  return async (request: any) => {
    assertCheckoutAppCheck(request, enforceAppCheck);
    if (!isFirebaseFunctionsEmulatorProcess()) {
      await admitEarlyCheckoutRequest(request);
    }
    // Membership is bought before signing in. A visitor with no account can
    // complete checkout; the purchase is attached to an account afterwards by
    // `claimMembership`. A signed-in buyer is linked immediately instead.
    const payerUid = optionalAuthUid(request);
    assertPurchaseOpen();

    const checkoutAttemptId = requireCheckoutAttemptId(request.data?.checkoutAttemptId);
    const checkoutAttemptHash = sha256(`membership-checkout:${checkoutAttemptId}`);
    const intentRef = db().collection("membershipIntents")
      .doc(`attempt_${checkoutAttemptHash}`);
    if (payerUid) {
      const profile = await db().collection("users").doc(payerUid).get();
      if (!profile.exists) {
        const existing = await intentRef.get();
        if (existing.exists && existing.get("status") === "reserved" &&
          !existing.get("checkoutSessionId")) {
          await transitionCheckoutReservation(intentRef, "failed", {
            failureKind: "missing_payer_profile",
            failedAt: serverTimestamp(),
          });
        }
        throw new HttpsError("failed-precondition", "Create your profile before purchasing.");
      }
    }
    const planKey = requirePlanKey(request.data?.planKey);
    const plan = getPlan(planKey);
    const participantName = requireBoundedString(
      request.data?.participantFullName, "participantFullName", 2, 160
    );
    const dateOfBirth = requireBoundedString(request.data?.participantDateOfBirth, "participantDateOfBirth", 10, 10);
    const signedName = requireBoundedString(request.data?.signedName, "signedName", 2, 160);
    const participantIsPayer = request.data?.participantIsPayer === true;

    const now = Date.now();
    const billingPolicy = resolveCheckoutBillingPolicy(now);
    const expectedBillingMode = request.data?.expectedBillingMode;
    if (expectedBillingMode !== "presale_deferred" && expectedBillingMode !== "standard") {
      throw new HttpsError(
        "invalid-argument",
        "expectedBillingMode must identify the billing terms shown before checkout."
      );
    }
    const promotionCode = normalizePromotionCode(request.data?.promotionCode);
    const age = resolveAgeFromDateOfBirth(dateOfBirth, now);
    if (age === null) {
      throw new HttpsError("invalid-argument", "Enter a valid participant date of birth.");
    }
    if (!isAgeEligibleForPlan(plan, age)) {
      throw new HttpsError(
        "failed-precondition",
        `The participant's age (${age}) is not eligible for ${plan.name}.`
      );
    }
    if (plan.audience === "adult" && !participantIsPayer) {
      throw new HttpsError(
        "failed-precondition",
        "An adult membership must be purchased by the participant for themselves."
      );
    }

    // Guardian rules: for a youth plan the payer must be the guardian and can
    // never be the participant.
    let guardian: GuardianRecord | null = null;
    if (plan.audience === "youth") {
      if (participantIsPayer) {
        throw new HttpsError("failed-precondition", POLICY_TEXT.guardianRequirement);
      }
      guardian = {
        fullName: requireBoundedString(request.data?.guardianFullName, "guardianFullName", 2, 160),
        relationship: requireBoundedString(request.data?.guardianRelationship, "guardianRelationship", 2, 80),
        confirmedAuthority: true,
      };
    }

    const expectedSignedName = guardian?.fullName ?? participantName;
    const comparableName = (value: string) => value.normalize("NFKC")
      .trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB");
    if (comparableName(signedName) !== comparableName(expectedSignedName)) {
      throw new HttpsError(
        "failed-precondition",
        `Type ${plan.audience === "youth" ? "the paying adult's" : "your"} full name exactly to sign.`
      );
    }

    const commercialTerms = createCommercialPlanSnapshot(planKey);
    const documents = resolveCheckoutDocuments(planKey);
    const statements = resolveCheckoutAcceptanceStatements(planKey);
    const acceptedStatementIds = requireExactCheckoutAcceptanceIds(
      request.data?.acceptedStatementIds,
      statements
    );
    const acceptanceEvidence = {
      signerRole: resolveCheckoutSignerRole(planKey),
      documents,
      statements,
      acceptedStatementIds,
      immediatePerformanceRequested: true as const,
    };

    const participantKey = participantKeyFor(participantName, dateOfBirth);
    const participant: ParticipantRecord = {
      fullName: participantName,
      dateOfBirth,
      age,
      isPayer: participantIsPayer,
      participantKey,
    };

    const requestFingerprint = checkoutRequestFingerprint({
      payerUid,
      planKey,
      expectedBillingMode,
      promotionCode,
      participant,
      guardian,
      signedName,
      commercialTerms,
      acceptances: acceptanceEvidence,
    });
    const payerEmail = payerUid ?
      (await admin.auth().getUser(payerUid)).email?.trim().toLowerCase() || null :
      null;

    // Existing attempts and admitted fingerprints retry for free. A brand-new
    // anonymous attempt must be admitted before any Stripe object is retrieved
    // or created, so abuse cannot turn provider validation into an unbounded
    // public endpoint.
    if (!isFirebaseFunctionsEmulatorProcess()) {
      await admitCheckoutRequest({
        request,
        intentRef,
        checkoutAttemptHash,
        requestFingerprint,
        nowMillis: now,
      });
    }

    let checkoutConfig: {
      client: Stripe;
      priceId: string;
      productId: string;
      origin: string;
    } | null = null;
    const ensureCheckoutConfig = async (frozenPriceId?: string) => {
      if (checkoutConfig) {
        if (frozenPriceId && checkoutConfig.priceId !== frozenPriceId) {
          throw new Error("Checkout attempt changed its frozen Stripe Price.");
        }
        return checkoutConfig;
      }
      const priceId = frozenPriceId ?? resolvePriceId(planKey);
      const origin = resolveReturnOrigin();
      const client = stripe();
      const productId = await assertStripePriceMatchesPlan(client, priceId, plan);
      if (billingPolicy.kind === "presale" &&
        planKey === EXISTING_MEMBER_OFFER.planKey) {
        await retrieveApprovedExistingMemberCoupon(client, productId);
      }
      checkoutConfig = {client, priceId, productId, origin};
      return checkoutConfig;
    };

    let reservation: CheckoutReservationResult;
    const existingSnap = await intentRef.get();
    let convergedMembershipIds: ReadonlySet<string> | undefined;
    if (!existingSnap.exists) {
      // Stripe, not a potentially delayed Firestore projection, decides
      // whether an older subscription is terminal. The reservation
      // transaction below re-runs every duplicate query after convergence.
      convergedMembershipIds = await convergeCheckoutDuplicateScope(
        participantKey,
        payerUid,
        commercialTerms.grantsAlphaWodAccess,
        converge
      );
    }
    if (!existingSnap.exists && expectedBillingMode !== billingPolicy.billingMode) {
      // A page left open across the presale cutoff must never display £0 terms
      // and then silently create an immediately chargeable standard Checkout.
      // Existing frozen attempts remain retryable under their recorded terms.
      throw new HttpsError(
        "failed-precondition",
        "The membership billing terms changed while this page was open. Refresh and review them before continuing.",
        {
          reason: "billing_policy_changed",
          expectedBillingMode,
          currentBillingMode: billingPolicy.billingMode,
        }
      );
    }
    if (!existingSnap.exists && promotionCode &&
      (billingPolicy.kind !== "presale" ||
        planKey !== EXISTING_MEMBER_OFFER.planKey)) {
      throw new HttpsError(
        "failed-precondition",
        "Promotion codes are available only for the Adult Unlimited founding presale."
      );
    }
    if (existingSnap.exists) {
      const existing = existingSnap.data() as MembershipIntentDoc;
      if (existing.requestFingerprint !== requestFingerprint) {
        throw new HttpsError(
          "failed-precondition",
          "This checkout attempt was already used with different membership details."
        );
      }
      reservation = {created: false, intent: existing};
    } else {
      // Validate provider configuration before taking a new reservation. An
      // existing recorded Session can still be returned during a later Stripe
      // outage without risking its recovery verifier.
      const validatedConfig = await ensureCheckoutConfig();
      const promotionCodeId = promotionCode ?
        await resolveApprovedPromotionCodeForCheckout(
          validatedConfig.client,
          promotionCode
        ) : null;
      let checkoutExpiresAt: number;
      try {
        checkoutExpiresAt = resolveCheckoutSessionExpiry(now);
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        throw new HttpsError(
          "failed-precondition",
          "Membership checkout pauses briefly at the monthly billing boundary. Please try again after midnight."
        );
      }

      const reservationLockIds = checkoutLockSpecs(
        payerUid,
        planKey,
        participantKey
      ).map((spec) => spec.id);
      const proposedIntent: MembershipIntentDoc = {
        schemaVersion: MEMBERSHIP_SCHEMA_VERSION,
        checkoutAttemptHash,
        requestFingerprint,
        payerUid,
        payerEmail,
        planKey,
        commercialTerms,
        stripeMode: assertBillingEnvironment().stripeMode,
        stripePriceId: validatedConfig.priceId,
        participant,
        guardian,
        acceptances: {
          signedName,
          ...acceptanceEvidence,
          acceptedAt: serverTimestamp(),
          userAgent: String(request.rawRequest.get("user-agent") || "").slice(0, 500),
        },
        checkoutSessionId: null,
        checkoutSessionUrl: null,
        status: "reserved",
        billingMode: billingPolicy.billingMode,
        billingCycleAnchor: billingPolicy.billingCycleAnchor,
        serviceStartsAt: billingPolicy.serviceStartsAtUnixSeconds,
        firstPaymentAt: billingPolicy.firstPaymentAtUnixSeconds,
        initialChargePence: billingPolicy.paymentDueToday ? null : 0,
        prorationBehavior: billingPolicy.prorationBehavior,
        promotionCodeId,
        firstFullChargeDate: billingPolicy.firstFullChargeDate,
        checkoutExpiresAt,
        reservationExpiresAt: Timestamp.fromMillis(
          (checkoutExpiresAt + CHECKOUT_SETTLEMENT_GRACE_SECONDS) * 1000
        ),
        reservationLockIds,
        createdAt: serverTimestamp(),
      };
      await reconcileExpiredCheckoutReservations(reservationLockIds, now);
      reservation = await reserveCheckoutAttempt(
        intentRef,
        proposedIntent,
        now,
        convergedMembershipIds
      );
    }

    let intent = reservation.intent;
    if (intent.requestFingerprint !== requestFingerprint) {
      throw new HttpsError(
        "failed-precondition",
        "This checkout attempt was already used with different membership details."
      );
    }
    if (intent.stripeMode !== assertBillingEnvironment().stripeMode) {
      throw new HttpsError(
        "failed-precondition",
        "This checkout attempt belongs to another Stripe environment. Start again."
      );
    }
    const checkoutWindowEnded = () =>
      intent.checkoutExpiresAt <= Math.floor(Date.now() / 1000) ||
      intent.checkoutExpiresAt >= intent.billingCycleAnchor;

    // A local clock can tell us to verify a Session, but it can never prove
    // that payment did not complete. Re-read Stripe before deciding whether a
    // recorded Session is terminal; this keeps a delayed paid webhook behind
    // its original uniqueness lock.
    if (intent.status === "created" && checkoutWindowEnded()) {
      await reconcileExpiredCheckoutReservations(
        intent.reservationLockIds,
        Date.now(),
        true
      );
      const refreshed = await intentRef.get();
      if (!refreshed.exists) {
        throw new HttpsError("internal", "The checkout reservation was lost.");
      }
      intent = refreshed.data() as MembershipIntentDoc;
    }
    if ((intent.status === "created" || intent.status === "payment_pending" ||
        intent.status === "fulfilled") && intent.checkoutSessionId &&
      intent.checkoutSessionUrl) {
      return {
        ok: true,
        sessionUrl: intent.checkoutSessionUrl,
        sessionId: intent.checkoutSessionId,
        firstFullChargeDate: intent.firstFullChargeDate,
        billingMode: intent.billingMode ?? "standard",
        serviceStartsAt: intent.serviceStartsAt ?? null,
        firstPaymentAt: intent.firstPaymentAt ?? intent.billingCycleAnchor,
        initialChargePence: intent.initialChargePence ?? null,
        promotionCodesEnabled: isPresaleIntent(intent) &&
          intent.planKey === EXISTING_MEMBER_OFFER.planKey,
      };
    }
    if (intent.status !== "reserved") {
      throw new HttpsError(
        "deadline-exceeded",
        "This checkout attempt has ended. Start again with a new checkout attempt."
      );
    }

    if (typeof intent.stripePriceId !== "string" || !intent.stripePriceId) {
      throw new HttpsError(
        "failed-precondition",
        "This checkout attempt predates the frozen billing-price safety check. Contact support."
      );
    }
    const {client: checkoutStripe, priceId, origin} = await ensureCheckoutConfig(
      intent.stripePriceId
    );

    // Only a signed-in buyer gets a pre-resolved Stripe customer. Stripe calls
    // remain outside the reservation transaction. A retry uses the same hashed
    // client attempt id, so Stripe returns the same Checkout Session.
    let customerId: string | null = null;
    try {
      customerId = payerUid ? await resolveStripeCustomerId(payerUid) : null;
    } catch (error) {
      // Customer setup happens before Checkout creation. It is therefore safe
      // to terminalise this attempt: no payment Session can exist yet, even if
      // Stripe created the idempotent Customer before a response was lost.
      await transitionCheckoutReservation(intentRef, "failed", {
        failureKind: "stripe_customer_setup",
        failedAt: serverTimestamp(),
      });
      console.error("Membership customer setup failed", {payerUid, error});
      throw new HttpsError(
        "deadline-exceeded",
        "Billing setup could not be completed. Start again with a new checkout attempt."
      );
    }
    let session: Stripe.Checkout.Session;
    try {
      session = await checkoutStripe.checkout.sessions.create({
        mode: "subscription",
        // The public catalogue and frozen contract are denominated in GBP.
        // Override Stripe's mutable Dashboard default so Adaptive Pricing
        // cannot localise this or future subscription payments.
        adaptive_pricing: {enabled: false},
        ...(customerId ? {customer: customerId} : {}),
        ...(payerUid ? {client_reference_id: payerUid} : {}),
        line_items: [{price: priceId, quantity: 1}],
        payment_method_collection: "always",
        ...(intent.promotionCodeId ? {
          discounts: [{promotion_code: intent.promotionCodeId}],
        } : {}),
        // Dynamic payment methods are managed from the Stripe Dashboard, so
        // `payment_method_types` is deliberately omitted.
        billing_address_collection: BILLING_POLICY.collectBillingAddress ? "required" : "auto",
        phone_number_collection: {enabled: BILLING_POLICY.collectPhoneNumber},
        automatic_tax: {enabled: BILLING_POLICY.automaticTaxEnabled},
        submit_type: "subscribe",
        locale: "en-GB",
        expires_at: intent.checkoutExpiresAt,
        success_url: `${origin}/memberships/success?session_id={CHECKOUT_SESSION_ID}` +
          `&plan=${encodeURIComponent(plan.key)}`,
        cancel_url: `${origin}/memberships?checkout=cancelled`,
        subscription_data: {
          description: intent.commercialTerms.planName,
          // The frozen policy is either the one-off £0 presale period or the
          // normal immediate-start proration. Stripe remains the amount
          // authority in both cases.
          billing_cycle_anchor: intent.billingCycleAnchor,
          proration_behavior: intent.prorationBehavior ?? "create_prorations",
          metadata: {
            ...(payerUid ? {firebaseUid: payerUid} : {}),
            planKey,
            intentId: intentRef.id,
          },
        },
        metadata: {
          ...(payerUid ? {firebaseUid: payerUid} : {}),
          planKey,
          intentId: intentRef.id,
        },
      }, {idempotencyKey: `checkout:${checkoutAttemptHash}`});
      assertStripeObjectMode("Checkout Session", session.id, session.livemode);
    } catch (error) {
      if (isDefinitiveCheckoutCreateFailure(error)) {
        const stripeFailure = error as {
          type?: unknown;
          code?: unknown;
          param?: unknown;
          statusCode?: unknown;
          requestId?: unknown;
        };
        // `expires_at` is fully server-generated. Any definitive provider
        // rejection of it means this frozen attempt can no longer produce a
        // Session (including Stripe's 30-minute minimum window), not that the
        // operator's billing catalogue is broken.
        const expiredAttempt = stripeFailure.param === "expires_at";
        await transitionCheckoutReservation(intentRef, "failed", {
          failureKind: expiredAttempt ?
            "checkout_attempt_expired" : "stripe_checkout_validation",
          failedAt: serverTimestamp(),
        });
        const safeDiagnostic = (value: unknown) =>
          typeof value === "string" ? value.slice(0, 120) : null;
        console.error("Stripe Checkout Session creation was rejected", {
          planKey,
          hasPromotion: Boolean(intent.promotionCodeId),
          type: safeDiagnostic(stripeFailure.type),
          code: safeDiagnostic(stripeFailure.code),
          param: safeDiagnostic(stripeFailure.param),
          statusCode: typeof stripeFailure.statusCode === "number" ?
            stripeFailure.statusCode : null,
          requestId: safeDiagnostic(stripeFailure.requestId),
        });
        if (expiredAttempt) {
          throw new HttpsError(
            "deadline-exceeded",
            "This checkout attempt expired before Stripe created it. Start again with a new checkout attempt."
          );
        }
        throw new HttpsError(
          "failed-precondition",
          "Stripe could not start checkout because the billing setup needs attention. No checkout was created or charged. Please contact us.",
          {reason: "stripe_checkout_configuration"}
        );
      }
      // A timeout, connection loss or Stripe 5xx may have happened after the
      // Session was accepted. Retain the reservation so the same attempt can
      // replay its idempotency key and recover the exact response.
      throw error;
    }

    if (!session.url) {
      throw new HttpsError("internal", "Stripe did not return a Checkout URL.");
    }

    const newlyRecorded = await db().runTransaction(async (tx) => {
      const fresh = await tx.get(intentRef);
      if (!fresh.exists) {
        throw new HttpsError("internal", "The checkout reservation was lost.");
      }
      const storedSessionId = fresh.get("checkoutSessionId");
      if (typeof storedSessionId === "string" && storedSessionId !== session.id) {
        throw new HttpsError(
          "failed-precondition",
          "This checkout attempt is already bound to another Stripe session."
        );
      }
      const currentStatus = fresh.get("status") as MembershipIntentDoc["status"];
      if (currentStatus === "expired" || currentStatus === "failed") {
        throw new HttpsError(
          "deadline-exceeded",
          "This checkout attempt ended before Stripe returned. Start again."
        );
      }
      const alreadyRecorded = storedSessionId === session.id;
      tx.set(intentRef, {
        checkoutSessionId: session.id,
        checkoutSessionUrl: session.url,
        ...(currentStatus === "reserved" ? {status: "created"} : {}),
        updatedAt: serverTimestamp(),
      }, {merge: true});
      return !alreadyRecorded;
    });

    // A `reserved` row can mean Stripe accepted the idempotent create request
    // but the process died before recording its response. Replaying the create
    // above recovers that exact Session. If its window has since ended, verify
    // the recovered Session now; release occurs only on Stripe-confirmed
    // terminal state, never on the browser/server clock alone.
    if (checkoutWindowEnded()) {
      await reconcileExpiredCheckoutReservations(
        intent.reservationLockIds,
        Date.now(),
        true
      );
      const refreshed = await intentRef.get();
      if (!refreshed.exists) {
        throw new HttpsError("internal", "The checkout reservation was lost.");
      }
      const refreshedStatus = refreshed.get("status") as MembershipIntentDoc["status"];
      if (refreshedStatus === "expired" || refreshedStatus === "failed") {
        throw new HttpsError(
          "deadline-exceeded",
          "This checkout attempt has ended. Start again after the billing boundary."
        );
      }
    }

    if (newlyRecorded) {
      await writeAudit({
        type: "checkout_session_created",
        payerUid,
        planKey,
        intentId: intentRef.id,
        checkoutSessionId: session.id,
      });
    }

    return {
      ok: true,
      sessionUrl: session.url,
      sessionId: session.id,
      firstFullChargeDate: intent.firstFullChargeDate,
      billingMode: intent.billingMode ?? "standard",
      serviceStartsAt: intent.serviceStartsAt ?? null,
      firstPaymentAt: intent.firstPaymentAt ?? intent.billingCycleAnchor,
      initialChargePence: intent.initialChargePence ?? null,
      promotionCodesEnabled: isPresaleIntent(intent) &&
        intent.planKey === EXISTING_MEMBER_OFFER.planKey,
    };
  };
}

export function buildCreateMembershipCheckoutSession(
  converge: (userId: string) => Promise<void>
) {
  return onCall(
    {
      region: REGION,
      secrets: MEMBERSHIP_CHECKOUT_SECRETS,
      enforceAppCheck: !isFirebaseFunctionsEmulatorProcess(),
      consumeAppCheckToken: !isFirebaseFunctionsEmulatorProcess(),
      timeoutSeconds: MEMBERSHIP_INTERACTIVE_TIMEOUT_SECONDS,
    },
    buildCreateMembershipCheckoutHandler(
      requirePurchaseFlowOpen,
      !isFirebaseFunctionsEmulatorProcess(),
      converge
    )
  );
}

export const createCustomerPortalSession = onCall(
  {region: REGION, secrets: MEMBERSHIP_SECRETS},
  async (request) => {
    // Refuse a mixed project/key deployment before reading billing records.
    assertBillingEnvironment();
    const userId = requireAuthUid(request);
    const subscriptionId = requireBoundedString(
      request.data?.subscriptionId,
      "subscriptionId",
      3,
      255
    );
    const membership = await db().collection("memberships").doc(subscriptionId).get();
    if (!membership.exists) {
      throw new HttpsError("not-found", "Membership not found.");
    }
    if (membership.get("payerUid") !== userId) {
      throw new HttpsError(
        "permission-denied",
        "Only the payer can open this membership's billing portal."
      );
    }
    const customerId = membership.get("stripeCustomerId");
    if (typeof customerId !== "string" || !customerId) {
      throw new HttpsError("failed-precondition", "This account has no billing profile yet.");
    }

    const configuration = stripePortalConfigurationId.value().trim();
    if (!configuration) {
      // Without an explicit configuration Stripe falls back to the account
      // default, which has cancellation enabled. That would let a member
      // cancel without the 14-day notice rule being applied or the receipt
      // time being recorded, so an unconfigured portal is refused outright.
      throw new HttpsError("failed-precondition", "The billing portal is not configured.");
    }

    const portalStripe = stripe();
    await assertPortalConfigurationIsLockedDown(portalStripe, configuration);
    const session = await portalStripe.billingPortal.sessions.create({
      customer: customerId,
      configuration,
      return_url: `${resolveReturnOrigin()}/account/membership`,
    });

    return {ok: true, portalUrl: session.url};
  }
);

export const getMyMemberships = onCall({region: REGION}, async (request) => {
  const userId = requireAuthUid(request);
  const snap = await db().collection("memberships").where("payerUid", "==", userId).get();
  const preview = resolveCancellationOutcome(Date.now());
  const receiptIds = Array.from(new Set(snap.docs.flatMap((doc) => {
    const receiptId = (doc.data() as MembershipDoc).cancellationRequest?.receiptId;
    return typeof receiptId === "string" && receiptId ? [receiptId] : [];
  })));
  const receiptSnaps = await Promise.all(receiptIds.map((receiptId) =>
    db().collection(MEMBERSHIP_CANCELLATION_RECEIPT_COLLECTION)
      .doc(receiptId).get()
  ));
  const receipts = new Map(receiptSnaps
    .filter((receipt) => receipt.exists)
    .map((receipt) => [receipt.id, receipt.data()]));

  const memberships = snap.docs.map((doc) => {
    const membership = doc.data() as MembershipDoc;
    const cancellationRequest = membership.cancellationRequest;
    const cancellationKind = cancellationRequest?.kind ??
      (cancellationRequest ? "contractual" : null);
    let coolingOffReceipt: MembershipCancellationReceipt | null = null;
    let coolingOffProjection: ReturnType<
      typeof buildMembershipCancellationProjection
    > | null = null;
    let coolingOffProjectionError: string | null = null;
    if (cancellationKind === "cooling_off" && cancellationRequest?.receiptId) {
      const storedReceipt = receipts.get(cancellationRequest.receiptId);
      try {
        assertMembershipCancellationReceipt(storedReceipt);
        coolingOffReceipt = storedReceipt;
        coolingOffProjection = buildMembershipCancellationProjection(
          storedReceipt,
          {
            status: cancellationRequest.status,
            endedAtMillis: cancellationRequest.providerEndedAtMillis ?? null,
          }
        );
      } catch {
        coolingOffProjectionError =
          "This cancellation receipt needs support because its stored evidence is incomplete.";
      }
    } else if (cancellationKind === "cooling_off") {
      coolingOffProjectionError =
        "This cancellation receipt needs support because its stored evidence is incomplete.";
    }
    const presaleWithdrawalAvailable =
      membership.billingMode === "presale_deferred" &&
      membership.firstPaymentReceivedAt === null &&
      Date.now() < membership.serviceStartsAt * 1000 &&
      isMembershipStateBlockingDuplicate(membership.state);
    const coolingOffEndsAt = membership.acceptances?.coolingOffEndsAt ?? null;
    const coolingOffEndMillis = typeof coolingOffEndsAt === "string" ?
      Date.parse(coolingOffEndsAt) : Number.NaN;
    return {
      subscriptionId: membership.subscriptionId,
      planKey: membership.planKey,
      planName: membership.planName,
      state: membership.state,
      grantsAlphaWodAccess: membership.grantsAlphaWodAccess,
      participantFullName: membership.participant?.fullName ?? "",
      participantIsPayer: membership.participant?.isPayer ?? false,
      billingMode: membership.billingMode ?? "standard",
      serviceStartsAt: membership.serviceStartsAt ?? null,
      firstPaymentAt: membership.firstPaymentAt ?? membership.billingCycleAnchor ?? null,
      billingCycleAnchor: membership.billingCycleAnchor ?? null,
      initialChargePence: membership.initialChargePence ?? null,
      firstPaymentReceivedAt: membership.firstPaymentReceivedAt ?? null,
      discount: membership.discount ?? null,
      paymentSchedule: membership.paymentSchedule ?? null,
      currentPeriodEnd: membership.currentPeriodEnd ?? null,
      cancelAt: membership.cancelAt ?? null,
      cancellationOutcome: membership.cancellationOutcome ?? null,
      cancellationRequestStatus: coolingOffProjection?.status ??
        (coolingOffProjectionError ? "manual_review" :
          cancellationRequest?.status ?? null),
      cancellationRequestKind: cancellationKind,
      cancellationReceipt: coolingOffReceipt ? {
        reference: coolingOffReceipt.receiptId,
        receivedAt: new Date(coolingOffReceipt.receivedAtMillis).toISOString(),
        kind: coolingOffReceipt.kind,
        acknowledgementStatus: cancellationAcknowledgementStatusForClient(
          membership.cancellationAcknowledgementStatus
        ) ?? "pending",
        refundReviewRequired: coolingOffReceipt.outcome.refundReviewRequired,
      } : null,
      cancellationPending: cancellationRequest?.status === "pending",
      cancellationManualReview: cancellationRequest?.status === "manual_review" ||
        coolingOffProjectionError !== null,
      cancellationRequestError: coolingOffProjectionError ??
        cancellationRequest?.lastError ?? null,
      cancellationMode: presaleWithdrawalAvailable ? "cancel_before_start" : "standard",
      cancellationPreview: presaleWithdrawalAvailable ? {
        ...resolvePresaleCancellationOutcome(Date.now(), membership),
        // The receipt-time cancellation instant is recomputed and frozen only
        // when the member submits. This stable boundary is display-only.
        cancelAtUnixSeconds: membership.serviceStartsAt,
      } : preview,
      providerContractStatus: membership.providerContractStatus ?? null,
      providerContractError: membership.providerContractError ?? null,
      entitlementProjectionStatus: membership.entitlementProjectionStatus ?? null,
      entitlementProjectionError: membership.entitlementProjectionError ?? null,
      coolingOffEndsAt,
      coolingOffActive: Number.isFinite(coolingOffEndMillis) &&
        Date.now() <= coolingOffEndMillis,
    };
  });

  return {ok: true, memberships, cancellationPreview: preview};
});

const CANCELLATION_RECOVERY_LEASE_MS = 10 * 60 * 1000;
const CANCELLATION_RECOVERY_MAX_ATTEMPTS = 24;
const CANCELLATION_RECOVERY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type PreparedCancellation = {
  requestId: string;
  kind: "presale_withdrawal" | "cooling_off" | "contractual";
  receivedAt: Timestamp;
  outcome: CancellationOutcome;
  repairGeneration: number;
};

function cancellationRetryAtMillis(attemptCount: number, nowMillis: number): number {
  const delay = Math.min(60 * 60 * 1000, 60 * 1000 * (2 ** Math.min(attemptCount - 1, 6)));
  return nowMillis + delay;
}

/** Applies one frozen cancellation request without ever extending Stripe's date. */
async function settlePreparedCancellation(
  membershipRef: DocumentReference,
  payerUid: string,
  prepared: PreparedCancellation,
  converge: (userId: string) => Promise<void>
): Promise<{outcome: CancellationOutcome; newlyFinalized: boolean}> {
  const subscriptionId = membershipRef.id;
  const before = await membershipRef.get();
  if (!before.exists) {
    throw new Error(`Membership ${subscriptionId} disappeared during cancellation.`);
  }
  const currentRequest = before.get("cancellationRequest") as {id?: unknown} | undefined;
  if (currentRequest?.id !== prepared.requestId) {
    throw new Error(`Membership ${subscriptionId} changed cancellation request.`);
  }
  const hadOutcome = Boolean(before.get("cancellationOutcome"));

  const currentSubscription = await stripe().subscriptions.retrieve(subscriptionId);
  assertStripeObjectMode(
    "Subscription",
    currentSubscription.id,
    currentSubscription.livemode
  );
  const currentObservedEnd = currentSubscription.status === "canceled" ?
    (currentSubscription.ended_at ?? currentSubscription.cancel_at ?? null) :
    (currentSubscription.cancel_at ?? null);
  const overdue = prepared.outcome.cancelAtUnixSeconds <= Math.floor(Date.now() / 1000);
  const cancelImmediately = prepared.kind === "cooling_off" || overdue;
  if (currentSubscription.status !== "canceled" && cancelImmediately) {
    // Stripe cannot accept a cancel_at in the past. Honour the member's frozen
    // request by stopping billing immediately, then route any charges taken
    // after the promised date to audited refund review.
    await stripe().subscriptions.cancel(subscriptionId, {
      prorate: false,
      invoice_now: false,
    }, {
      idempotencyKey:
        `cancel-now:${subscriptionId}:${prepared.requestId}:g${prepared.repairGeneration}`,
    });
  } else if (currentSubscription.status !== "canceled" &&
    (currentObservedEnd === null ||
      currentObservedEnd > prepared.outcome.cancelAtUnixSeconds)) {
    await stripe().subscriptions.update(subscriptionId, {
      cancel_at: prepared.outcome.cancelAtUnixSeconds,
      proration_behavior: "none",
      metadata: {
        cancellationRequestedBy: payerUid,
        cancellationNoticeMet: String(prepared.outcome.noticeDeadlineMet),
        cancellationRequestId: prepared.requestId,
        cancellationRepairGeneration: String(prepared.repairGeneration),
      },
    }, {
      idempotencyKey:
        `cancel:${subscriptionId}:${prepared.requestId}:g${prepared.repairGeneration}`,
    });
  }

  // Re-read after the idempotent update. Stripe can cache an idempotency result;
  // only current authoritative state proves that the schedule is now in place.
  const verifiedSubscription = await stripe().subscriptions.retrieve(subscriptionId);
  assertStripeObjectMode(
    "Subscription",
    verifiedSubscription.id,
    verifiedSubscription.livemode
  );
  const verifiedEnd = verifiedSubscription.status === "canceled" ?
    (verifiedSubscription.ended_at ?? verifiedSubscription.cancel_at ?? null) :
    (verifiedSubscription.cancel_at ?? null);
  const verified = cancelImmediately ?
    verifiedSubscription.status === "canceled" && verifiedEnd !== null :
    verifiedEnd !== null && verifiedEnd <= prepared.outcome.cancelAtUnixSeconds;
  if (!verified) {
    throw new Error(
      `Stripe has not applied cancellation request ${prepared.requestId}.`
    );
  }

  // The convergence transaction both records the frozen cancellation outcome
  // and brings state/entitlement up to date, including already-canceled rows.
  await convergeMembershipFromStripe(subscriptionId, converge);
  const finalized = await membershipRef.get();
  const outcome = finalized.get("cancellationOutcome") as CancellationOutcome | null;
  const finalRequestStatus = finalized.get("cancellationRequest.status");
  if (!outcome || (finalRequestStatus !== "applied" &&
    finalRequestStatus !== "manual_review")) {
    throw new Error(`Membership ${subscriptionId} did not settle its cancellation.`);
  }
  return {outcome, newlyFinalized: !hadOutcome};
}

async function markPendingCancellationFailed(
  membershipRef: DocumentReference,
  requestId: string,
  error: unknown,
  nowMillis = Date.now()
): Promise<boolean> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
  const terminal = await db().runTransaction(async (tx) => {
    const snap = await tx.get(membershipRef);
    if (!snap.exists || snap.get("cancellationOutcome")) return false;
    const pending = snap.get("cancellationRequest") as {
      id?: unknown;
      kind?: unknown;
      status?: unknown;
      receivedAt?: unknown;
      recoveryStartedAt?: unknown;
      attemptCount?: unknown;
      repairGeneration?: unknown;
    } | undefined;
    if (pending?.id !== requestId || pending.status !== "pending") return false;
    const attemptCount = typeof pending.attemptCount === "number" ? pending.attemptCount : 1;
    const receivedAt = timestampMillis(pending.receivedAt) ?? nowMillis;
    const recoveryStartedAt = timestampMillis(pending.recoveryStartedAt) ?? receivedAt;
    const isTerminal = attemptCount >= CANCELLATION_RECOVERY_MAX_ATTEMPTS ||
      nowMillis - recoveryStartedAt >= CANCELLATION_RECOVERY_MAX_AGE_MS;
    tx.update(membershipRef, {
      "cancellationRequest.status": isTerminal ? "manual_review" : "pending",
      "cancellationRequest.lastError": message,
      // Each retry retrieves current Stripe state first. Rotating only after a
      // failed verification lets it reassert a schedule that was removed after
      // Stripe cached the prior idempotent update.
      "cancellationRequest.repairGeneration":
        typeof pending.repairGeneration === "number" ?
          pending.repairGeneration + 1 : 1,
      "cancellationRequest.failedAt": serverTimestamp(),
      "cancellationRequest.leaseToken": FieldValue.delete(),
      "cancellationRequest.leaseExpiresAt": FieldValue.delete(),
      "cancellationRequest.nextAttemptAt": isTerminal ?
        FieldValue.delete() :
        Timestamp.fromMillis(
          cancellationRetryAtMillis(attemptCount, nowMillis)
        ),
      ...(isTerminal ? {"cancellationRequest.manualReviewAt": serverTimestamp()} : {}),
      "updatedAt": serverTimestamp(),
    });
    return isTerminal;
  });
  if (terminal) {
    console.error("CRITICAL_BILLING_CANCELLATION_MANUAL_REVIEW", {
      subscriptionId: membershipRef.id,
      requestId,
      error: message,
    });
    await writeAudit({
      type: "cancellation_manual_review",
      severity: "critical",
      subscriptionId: membershipRef.id,
      requestId,
      error: message,
    }).catch((auditError) =>
      console.error("Could not write cancellation manual-review audit", membershipRef.id, auditError)
    );
  }
  return terminal;
}

type CancellationRecoveryLease = {
  token: string;
  payerUid: string;
  prepared: PreparedCancellation;
};

async function acquireCancellationRecoveryLease(
  membershipRef: DocumentReference,
  nowMillis = Date.now()
): Promise<CancellationRecoveryLease | null> {
  const token = randomUUID();
  const result = await db().runTransaction(async (tx) => {
    const snap = await tx.get(membershipRef);
    if (!snap.exists || snap.get("cancellationOutcome")) {
      return {state: "skipped" as const};
    }
    const payerUid = snap.get("payerUid");
    const pending = snap.get("cancellationRequest") as {
      id?: unknown;
      kind?: unknown;
      status?: unknown;
      receivedAt?: unknown;
      recoveryStartedAt?: unknown;
      outcome?: unknown;
      attemptCount?: unknown;
      repairGeneration?: unknown;
      nextAttemptAt?: unknown;
      leaseExpiresAt?: unknown;
    } | undefined;
    const outcome = pending?.outcome as CancellationOutcome | undefined;
    if (pending?.status !== "pending") return {state: "skipped" as const};
    if (typeof pending.id !== "string" || typeof payerUid !== "string" || !payerUid ||
      !(pending.receivedAt instanceof Timestamp) ||
      typeof outcome?.cancelAtUnixSeconds !== "number") {
      const reason = "Pending cancellation evidence is malformed.";
      tx.update(membershipRef, {
        "cancellationRequest.status": "manual_review",
        "cancellationRequest.lastError": reason,
        "cancellationRequest.manualReviewAt": serverTimestamp(),
        "cancellationRequest.nextAttemptAt": FieldValue.delete(),
        "cancellationRequest.leaseToken": FieldValue.delete(),
        "cancellationRequest.leaseExpiresAt": FieldValue.delete(),
        "updatedAt": serverTimestamp(),
      });
      return {
        state: "terminal" as const,
        requestId: typeof pending.id === "string" ? pending.id : "malformed",
        reason,
      };
    }
    const nextAttemptAt = timestampMillis(pending.nextAttemptAt);
    const leaseExpiresAt = timestampMillis(pending.leaseExpiresAt);
    if ((nextAttemptAt !== null && nextAttemptAt > nowMillis) ||
      (leaseExpiresAt !== null && leaseExpiresAt > nowMillis)) {
      return {state: "skipped" as const};
    }
    const attemptCount = typeof pending.attemptCount === "number" ?
      pending.attemptCount : 1;
    const recoveryStartedAtMillis = timestampMillis(pending.recoveryStartedAt) ??
      pending.receivedAt.toMillis();
    if (attemptCount >= CANCELLATION_RECOVERY_MAX_ATTEMPTS ||
      nowMillis - recoveryStartedAtMillis >= CANCELLATION_RECOVERY_MAX_AGE_MS) {
      tx.update(membershipRef, {
        "cancellationRequest.status": "manual_review",
        "cancellationRequest.lastError": "Automatic cancellation recovery exhausted.",
        "cancellationRequest.manualReviewAt": serverTimestamp(),
        "cancellationRequest.nextAttemptAt": FieldValue.delete(),
        "cancellationRequest.leaseToken": FieldValue.delete(),
        "cancellationRequest.leaseExpiresAt": FieldValue.delete(),
        "updatedAt": serverTimestamp(),
      });
      return {
        state: "terminal" as const,
        requestId: pending.id,
        reason: "Automatic cancellation recovery exhausted.",
      };
    }
    tx.update(membershipRef, {
      "cancellationRequest.attemptCount": attemptCount + 1,
      "cancellationRequest.lastAttemptAt": serverTimestamp(),
      "cancellationRequest.leaseToken": token,
      "cancellationRequest.leaseExpiresAt": Timestamp.fromMillis(
        nowMillis + CANCELLATION_RECOVERY_LEASE_MS
      ),
      "cancellationRequest.nextAttemptAt": Timestamp.fromMillis(
        nowMillis + CANCELLATION_RECOVERY_LEASE_MS
      ),
      "updatedAt": serverTimestamp(),
    });
    return {
      state: "acquired" as const,
      token,
      payerUid,
      prepared: {
        requestId: pending.id,
        kind: pending.kind === "presale_withdrawal" ||
          pending.kind === "cooling_off" ?
          pending.kind as PreparedCancellation["kind"] : "contractual",
        receivedAt: pending.receivedAt,
        outcome,
        repairGeneration: typeof pending.repairGeneration === "number" ?
          pending.repairGeneration : 0,
      },
    };
  });
  if (result.state === "terminal") {
    console.error("CRITICAL_BILLING_CANCELLATION_MANUAL_REVIEW", {
      subscriptionId: membershipRef.id,
      requestId: result.requestId,
      error: result.reason,
    });
    await writeAudit({
      type: "cancellation_manual_review",
      severity: "critical",
      subscriptionId: membershipRef.id,
      requestId: result.requestId,
      error: result.reason,
    }).catch((auditError) =>
      console.error("Could not write cancellation manual-review audit", membershipRef.id, auditError)
    );
    return null;
  }
  if (result.state !== "acquired") return null;
  return {
    token: result.token,
    payerUid: result.payerUid,
    prepared: result.prepared,
  };
}

/** Retries frozen cancellation receipts independently of a customer returning. */
async function recoverPendingCancellationsOnce(
  nowMillis = Date.now(),
  limit = 50,
  converge: (userId: string) => Promise<void> = async () => undefined
): Promise<{processed: number; failed: number; skipped: number}> {
  assertBillingEnvironment();
  const due = await db().collection("memberships")
    .where(
      "cancellationRequest.nextAttemptAt",
      "<=",
      Timestamp.fromMillis(nowMillis)
    )
    .orderBy("cancellationRequest.nextAttemptAt", "asc")
    .limit(limit)
    .get();
  const result = {processed: 0, failed: 0, skipped: 0};
  for (const membership of due.docs) {
    const itemNow = Math.max(nowMillis, Date.now());
    const lease = await acquireCancellationRecoveryLease(membership.ref, itemNow);
    if (!lease) {
      result.skipped += 1;
      continue;
    }
    try {
      await settlePreparedCancellation(
        membership.ref,
        lease.payerUid,
        lease.prepared,
        converge
      );
      result.processed += 1;
    } catch (error) {
      await markPendingCancellationFailed(
        membership.ref,
        lease.prepared.requestId,
        error,
        Math.max(itemNow, Date.now())
      );
      console.error("Scheduled cancellation recovery failed", membership.id, error);
      result.failed += 1;
    }
  }
  return result;
}

export function buildRecoverMembershipCancellations(
  converge: (userId: string) => Promise<void>
) {
  return onSchedule({
    region: REGION,
    schedule: "every 5 minutes",
    timeZone: "UTC",
    secrets: MEMBERSHIP_STRIPE_WORKER_SECRETS,
    timeoutSeconds: 540,
  }, async () => {
    const result = await recoverPendingCancellationsOnce(Date.now(), 50, converge);
    console.log("Membership cancellation recovery result", result);
  });
}

export function buildRequestMembershipCancellation(
  converge: (userId: string) => Promise<void>
) {
  return onCall(
    {region: REGION, secrets: MEMBERSHIP_SECRETS},
    async (request) => {
      // The receipt transaction is legally significant. Never write it until
      // the Firebase project and Stripe key are proven to be paired.
      assertBillingEnvironment();
      const userId = requireAuthUid(request);
      const subscriptionId = requireBoundedString(request.data?.subscriptionId, "subscriptionId", 3, 255);
      const requestedKind = request.data?.kind;
      if (requestedKind !== undefined && requestedKind !== "cooling_off" &&
        requestedKind !== "contractual") {
        throw new HttpsError(
          "invalid-argument",
          "kind must be cooling_off or contractual when supplied."
        );
      }
      const expectedCancelAtUnixSeconds = request.data?.expectedCancelAtUnixSeconds;
      if (typeof expectedCancelAtUnixSeconds !== "number" ||
      !Number.isSafeInteger(expectedCancelAtUnixSeconds) || expectedCancelAtUnixSeconds <= 0) {
        throw new HttpsError(
          "invalid-argument",
          "expectedCancelAtUnixSeconds must be the cancellation date currently shown to you."
        );
      }

      const membershipRef = db().collection("memberships").doc(subscriptionId);
      const receivedAtMillis = Date.now();
      const proposedRequestId = randomUUID();

      // Freeze the legally decisive receipt time and outcome before calling
      // Stripe. A crash after Stripe accepts the update can then replay this same
      // request rather than recomputing it across a notice/month boundary.
      const prepared = await db().runTransaction(async (tx) => {
        const snap = await tx.get(membershipRef);
        if (!snap.exists) throw new HttpsError("not-found", "Membership not found.");
        const membership = snap.data() as MembershipDoc;
        if (membership.payerUid !== userId) {
          throw new HttpsError("permission-denied", "Only the payer can cancel this membership.");
        }
        const pending = snap.get("cancellationRequest") as {
          id?: unknown;
          kind?: unknown;
          status?: unknown;
          receivedAt?: unknown;
          recoveryStartedAt?: unknown;
          outcome?: unknown;
          repairGeneration?: unknown;
          attemptCount?: unknown;
          receiptId?: unknown;
          providerEndedAtMillis?: unknown;
        } | undefined;
        const pendingOutcome = pending?.outcome as ReturnType<
          typeof resolveCancellationOutcome
        > | undefined;

        if (pending?.kind === "cooling_off" &&
          typeof pending.id === "string" &&
          pending.receivedAt instanceof Timestamp &&
          typeof pendingOutcome?.cancelAtUnixSeconds === "number" &&
          typeof pending.receiptId === "string") {
          const receiptSnap = await tx.get(
            db().collection(MEMBERSHIP_CANCELLATION_RECEIPT_COLLECTION)
              .doc(pending.receiptId)
          );
          const receipt = receiptSnap.data();
          try {
            assertMembershipCancellationReceipt(receipt);
          } catch {
            throw new HttpsError(
              "failed-precondition",
              "This cancellation needs support because its receipt evidence is incomplete."
            );
          }
          if (receipt.subscriptionId !== subscriptionId ||
            receipt.requestId !== pending.id) {
            throw new HttpsError(
              "failed-precondition",
              "This cancellation needs support because its receipt does not match the membership."
            );
          }
          return {
            alreadyFinalized: Boolean(membership.cancellationOutcome) ||
              pending.status === "applied",
            requestId: pending.id,
            kind: "cooling_off" as const,
            receivedAt: pending.receivedAt,
            outcome: pendingOutcome,
            repairGeneration: typeof pending.repairGeneration === "number" ?
              pending.repairGeneration : 0,
            receipt,
          };
        }
        if (membership.cancellationOutcome) {
          if (typeof pending?.id !== "string" ||
          !(pending.receivedAt instanceof Timestamp)) {
            throw new HttpsError(
              "failed-precondition",
              "This cancellation needs support because its recovery evidence is incomplete."
            );
          }
          const repairGeneration = typeof pending.repairGeneration === "number" ?
            pending.repairGeneration + 1 : 1;
          const nextAttemptAt = Timestamp.fromMillis(
            receivedAtMillis + CANCELLATION_RECOVERY_LEASE_MS
          );
          tx.set(membershipRef, {
            cancellationOutcome: null,
            cancellationRequest: {
              ...pending,
              status: "pending",
              outcome: membership.cancellationOutcome,
              repairGeneration,
              recoveryStartedAt: Timestamp.fromMillis(receivedAtMillis),
              attemptCount: 1,
              lastAttemptAt: Timestamp.fromMillis(receivedAtMillis),
              nextAttemptAt,
              leaseToken: FieldValue.delete(),
              leaseExpiresAt: FieldValue.delete(),
              lastError: FieldValue.delete(),
            },
            updatedAt: serverTimestamp(),
          }, {merge: true});
          return {
            alreadyFinalized: true as const,
            requestId: pending.id,
            kind: pending.kind === "presale_withdrawal" ?
              "presale_withdrawal" as const : "contractual" as const,
            receivedAt: pending.receivedAt,
            outcome: membership.cancellationOutcome,
            repairGeneration,
            receipt: null,
          };
        }
        if (pending?.status === "pending" && typeof pending.id === "string" &&
        pending.receivedAt instanceof Timestamp &&
        typeof pendingOutcome?.cancelAtUnixSeconds === "number") {
          return {
            alreadyFinalized: false as const,
            requestId: pending.id,
            kind: pending.kind === "presale_withdrawal" ?
              "presale_withdrawal" as const : "contractual" as const,
            receivedAt: pending.receivedAt,
            outcome: pendingOutcome,
            repairGeneration: typeof pending.repairGeneration === "number" ?
              pending.repairGeneration : 0,
            receipt: null,
          };
        }
        if (pending?.status === "manual_review") {
          throw new HttpsError(
            "failed-precondition",
            "This cancellation is already with support for manual review."
          );
        }
        if (membership.billingMode === "presale_deferred" &&
          membership.firstPaymentReceivedAt === null &&
          receivedAtMillis < membership.serviceStartsAt * 1000) {
          const receivedAt = Timestamp.fromMillis(receivedAtMillis);
          const outcome = resolvePresaleCancellationOutcome(
            receivedAtMillis,
            membership
          );
          tx.set(membershipRef, {
            cancellationRequest: {
              id: proposedRequestId,
              status: "pending",
              receivedAt,
              recoveryStartedAt: receivedAt,
              outcome,
              attemptCount: 1,
              repairGeneration: 0,
              lastAttemptAt: receivedAt,
              nextAttemptAt: Timestamp.fromMillis(
                receivedAtMillis + CANCELLATION_RECOVERY_LEASE_MS
              ),
              kind: "presale_withdrawal",
            },
            updatedAt: serverTimestamp(),
          }, {merge: true});
          return {
            alreadyFinalized: false as const,
            requestId: proposedRequestId,
            kind: "presale_withdrawal" as const,
            receivedAt,
            outcome,
            repairGeneration: 0,
            receipt: null,
          };
        }
        const coolingOffEndsAt = membership.acceptances?.coolingOffEndsAt;
        const coolingOffEndMillis = typeof coolingOffEndsAt === "string" ?
          Date.parse(coolingOffEndsAt) : Number.NaN;
        if (Number.isFinite(coolingOffEndMillis) &&
          receivedAtMillis <= coolingOffEndMillis) {
          if (requestedKind !== "cooling_off") {
            throw new HttpsError(
              "failed-precondition",
              "This membership is still within its cooling-off period. Review and submit the cooling-off cancellation option.",
              {reason: "cooling_off_confirmation_required", coolingOffEndsAt}
            );
          }
          const contractMadeAt = membership.acceptances?.contractMadeAt;
          if (!(contractMadeAt instanceof Timestamp) ||
            !Number.isSafeInteger(membership.serviceStartsAt) ||
            membership.serviceStartsAt <= 0 ||
            membership.acceptances.immediatePerformanceRequested !== true) {
            throw new HttpsError(
              "failed-precondition",
              "This cancellation needs support because its contract evidence is incomplete."
            );
          }
          const receivedAt = Timestamp.fromMillis(receivedAtMillis);
          const receipt = buildCoolingOffCancellationReceipt({
            requestId: proposedRequestId,
            subscriptionId,
            channel: "membership_portal",
            receivedAtMillis,
            recordedAtMillis: receivedAtMillis,
            actorUid: userId,
            staffActorUid: null,
            payer: {
              uid: userId,
              fullName: membership.guardian?.fullName ??
                membership.participant.fullName,
              email: membership.payerEmail,
            },
            sender: {
              uid: userId,
              fullName: membership.guardian?.fullName ??
                membership.participant.fullName,
              email: membership.payerEmail,
            },
            sourceEvidence: {
              externalMessageIdSha256: null,
              contentSha256: null,
            },
            membership: {
              planKey: membership.planKey,
              planName: membership.planName,
              participantFullName: membership.participant.fullName,
              contractMadeAtMillis: contractMadeAt.toMillis(),
              coolingOffEndsAtMillis: coolingOffEndMillis,
              serviceStartsAtMillis: membership.serviceStartsAt * 1000,
              firstPaymentReceivedAtMillis:
                typeof membership.firstPaymentReceivedAt === "number" ?
                  membership.firstPaymentReceivedAt * 1000 : null,
              immediatePerformanceRequested:
                membership.acceptances.immediatePerformanceRequested,
            },
          });
          const projection = buildMembershipCancellationProjection(receipt);
          const outcome = resolveCoolingOffCancellationOutcome(receivedAtMillis);
          const receiptRef = db()
            .collection(MEMBERSHIP_CANCELLATION_RECEIPT_COLLECTION)
            .doc(receipt.receiptId);
          const outboxId = cancellationAcknowledgementOutboxId(receipt.requestId);
          const outboxRef = db().collection(CONFIRMATION_OUTBOX_COLLECTION)
            .doc(outboxId);
          let acknowledgementPayload: ConfirmationEmailPayload | null = null;
          let acknowledgementError: string | null = null;
          if (membership.payerEmail) {
            try {
              acknowledgementPayload = buildCancellationAcknowledgementPayload({
                receipt,
                company: {
                  legalName: COMPANY.legalName,
                  tradingName: COMPANY.tradingName,
                  supportEmail: COMPANY.supportEmail,
                  fromEmail: membershipFromEmail.value().trim() ||
                    COMPANY.confirmationSender,
                  postalAddress: COMPANY.address,
                },
                membership: {
                  subscriptionId,
                  planName: membership.planName,
                  participantFullName: membership.participant.fullName,
                },
                recipient: {
                  fullName: membership.guardian?.fullName ??
                    membership.participant.fullName,
                  email: membership.payerEmail,
                },
              });
            } catch {
              acknowledgementError =
                "The payer email could not be used for the cancellation acknowledgement.";
            }
          } else {
            acknowledgementError =
              "The payer email was unavailable for the cancellation acknowledgement.";
          }

          // Receipt, provider-recovery request, safe member projection and the
          // durable acknowledgement are accepted atomically before Stripe.
          tx.create(receiptRef, receipt);
          tx.set(membershipRef, {
            cancellationRequest: {
              id: proposedRequestId,
              kind: "cooling_off",
              status: "pending",
              receivedAt,
              recoveryStartedAt: receivedAt,
              outcome,
              attemptCount: 1,
              repairGeneration: 0,
              lastAttemptAt: receivedAt,
              nextAttemptAt: Timestamp.fromMillis(
                receivedAtMillis + CANCELLATION_RECOVERY_LEASE_MS
              ),
              receiptId: receipt.receiptId,
              cancellationEffectiveAtMillis:
                projection.cancellationEffectiveAtMillis,
              accessEndsAtMillis: projection.accessEndsAtMillis,
              collectFuturePayments: false,
              futurePaymentDuePence: 0,
              providerEndedAtMillis: null,
              refundReviewRequired: projection.refundReviewRequired,
              refundAmountPence: null,
              acknowledgementOutboxId: projection.acknowledgementOutboxId,
              acknowledgementIdempotencyKey:
                projection.acknowledgementIdempotencyKey,
            },
            cancellationAcknowledgementStatus: acknowledgementPayload ?
              "pending" : "manual_review",
            ...(acknowledgementError ? {
              cancellationAcknowledgementError: acknowledgementError,
            } : {
              cancellationAcknowledgementError: FieldValue.delete(),
            }),
            updatedAt: serverTimestamp(),
          }, {merge: true});
          tx.create(outboxRef, {
            schemaVersion: MEMBERSHIP_SCHEMA_VERSION,
            kind: "membership_cancellation_acknowledgement",
            subscriptionId,
            requestId: receipt.requestId,
            receiptId: receipt.receiptId,
            status: acknowledgementPayload ? "pending" : "manual_review",
            ...(acknowledgementPayload ? {
              payload: acknowledgementPayload,
              idempotencyKey: cancellationAcknowledgementIdempotencyKey(
                receipt.requestId
              ),
              nextAttemptAt: serverTimestamp(),
            } : {
              deadLetterReason: acknowledgementError,
              deadLetteredAt: serverTimestamp(),
            }),
            attemptCount: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          return {
            alreadyFinalized: false as const,
            requestId: proposedRequestId,
            kind: "cooling_off" as const,
            receivedAt,
            outcome,
            repairGeneration: 0,
            receipt,
            acknowledgementError,
          };
        }
        if (requestedKind === "cooling_off") {
          throw new HttpsError(
            "failed-precondition",
            "The cooling-off period ended before this request was submitted. Review the current cancellation dates and confirm again.",
            {reason: "cooling_off_expired", coolingOffEndsAt: coolingOffEndsAt ?? null}
          );
        }
        const receivedAt = Timestamp.fromMillis(receivedAtMillis);
        const outcome = resolveCancellationOutcome(receivedAtMillis);
        if (outcome.cancelAtUnixSeconds !== expectedCancelAtUnixSeconds) {
          throw new HttpsError(
            "failed-precondition",
            "The cancellation dates have changed. Review the updated dates and confirm again.",
            {cancellationPreview: outcome}
          );
        }
        tx.set(membershipRef, {
          cancellationRequest: {
            id: proposedRequestId,
            kind: "contractual",
            status: "pending",
            receivedAt,
            recoveryStartedAt: receivedAt,
            outcome,
            attemptCount: 1,
            repairGeneration: 0,
            lastAttemptAt: receivedAt,
            nextAttemptAt: Timestamp.fromMillis(
              receivedAtMillis + CANCELLATION_RECOVERY_LEASE_MS
            ),
          },
          updatedAt: serverTimestamp(),
        }, {merge: true});
        return {
          alreadyFinalized: false as const,
          requestId: proposedRequestId,
          kind: "contractual" as const,
          receivedAt,
          outcome,
          repairGeneration: 0,
          receipt: null,
        };
      });

      if (prepared.kind === "cooling_off" && prepared.receipt &&
        "acknowledgementError" in prepared && prepared.acknowledgementError) {
        console.error(
          "CRITICAL_BILLING_CANCELLATION_ACKNOWLEDGEMENT_MANUAL_REVIEW",
          {
            subscriptionId,
            requestId: prepared.requestId,
            outboxId: cancellationAcknowledgementOutboxId(
              prepared.requestId
            ),
            error: prepared.acknowledgementError,
          }
        );
        await writeAudit({
          type: "cancellation_acknowledgement_terminal",
          severity: "critical",
          subscriptionId,
          requestId: prepared.requestId,
          outboxId: cancellationAcknowledgementOutboxId(prepared.requestId),
          error: prepared.acknowledgementError,
        }).catch((auditError) =>
          console.error(
            "Could not write cancellation-acknowledgement terminal audit",
            subscriptionId,
            auditError
          )
        );
      }

      try {
        const settled = await settlePreparedCancellation(
          membershipRef,
          userId,
          prepared,
          converge
        );
        if (prepared.receipt) {
          const finalized = await membershipRef.get();
          const providerStatus = finalized.get("cancellationRequest.status");
          const providerEndedAtMillis = finalized.get(
            "cancellationRequest.providerEndedAtMillis"
          );
          const projection = buildMembershipCancellationProjection(
            prepared.receipt,
            {
              status: providerStatus === "applied" ||
                providerStatus === "manual_review" ?
                providerStatus : "pending",
              endedAtMillis: typeof providerEndedAtMillis === "number" ?
                providerEndedAtMillis : null,
            }
          );
          return {
            ok: true,
            outcome: settled.outcome,
            requestStatus: projection.status,
            receipt: {
              reference: prepared.receipt.receiptId,
              receivedAt: new Date(
                prepared.receipt.receivedAtMillis
              ).toISOString(),
              kind: prepared.receipt.kind,
              acknowledgementStatus: cancellationAcknowledgementStatusForClient(
                finalized.get("cancellationAcknowledgementStatus")
              ) ?? "pending",
              refundReviewRequired: projection.refundReviewRequired,
            },
            alreadyCancelled: prepared.alreadyFinalized ||
              !settled.newlyFinalized,
          };
        }
        return {
          ok: true,
          outcome: settled.outcome,
          alreadyCancelled: prepared.alreadyFinalized || !settled.newlyFinalized,
        };
      } catch (error) {
        await markPendingCancellationFailed(
          membershipRef,
          prepared.requestId,
          error
        ).catch((recordError) =>
          console.error("Could not schedule cancellation recovery", subscriptionId, recordError)
        );
        if (prepared.receipt) {
          const current = await membershipRef.get();
          const providerStatus = current.get("cancellationRequest.status");
          const projection = buildMembershipCancellationProjection(
            prepared.receipt,
            {
              status: providerStatus === "manual_review" ?
                "manual_review" : "pending",
              endedAtMillis: null,
            }
          );
          console.error("Cooling-off provider cancellation queued for recovery", {
            subscriptionId,
            requestId: prepared.requestId,
            error: error instanceof Error ? error.message : String(error),
          });
          return {
            ok: true,
            outcome: null,
            requestStatus: projection.status,
            receipt: {
              reference: prepared.receipt.receiptId,
              receivedAt: new Date(
                prepared.receipt.receivedAtMillis
              ).toISOString(),
              kind: prepared.receipt.kind,
              acknowledgementStatus: cancellationAcknowledgementStatusForClient(
                current.get("cancellationAcknowledgementStatus")
              ) ?? "pending",
              refundReviewRequired: projection.refundReviewRequired,
            },
            alreadyCancelled: prepared.alreadyFinalized,
          };
        }
        throw error;
      }
    }
  );
}

/**
 * Window in which the checkout session plus browser-held verifier can attach a
 * purchase for the buyer who creates their account straight after paying.
 */
const SESSION_CLAIM_WINDOW_MS = 24 * 60 * 60 * 1000;

function toMillis(
  value: FieldValue | Timestamp | null | undefined
): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  return null;
}

/**
 * Attaches a membership bought before sign-up to the account that now owns it.
 *
 * Two routes, deliberately different in what they demand:
 *
 * - By checkout session id plus the separate browser-held attempt verifier:
 *   both must identify the same fulfilled membership. The verifier is accepted
 *   without a verified email only inside a 24 hour window and is consumed by
 *   the ownership transaction. A leaked Stripe URL is therefore insufficient.
 * - By email: no window, but the account's email must be verified and must
 *   match the address Stripe billed. Without the verification requirement,
 *   anyone could register a victim's address and take their membership.
 *
 * The attach itself is transactional and asserts the membership is still
 * unclaimed, so two accounts racing on the same purchase cannot both win.
 */
export function buildClaimMembership(converge: (userId: string) => Promise<void>) {
  return onCall({
    region: REGION,
    secrets: MEMBERSHIP_SECRETS,
    timeoutSeconds: MEMBERSHIP_INTERACTIVE_TIMEOUT_SECONDS,
  }, async (request) => {
    const userId = requireAuthUid(request);
    const sessionId = optionalBoundedText(request.data?.sessionId, 3, 255);
    const checkoutAttemptId = sessionId && request.data?.checkoutAttemptId !== undefined ?
      requireCheckoutAttemptId(request.data.checkoutAttemptId) : null;
    const presentedAttemptHash = checkoutAttemptId ?
      sha256(`membership-checkout:${checkoutAttemptId}`) : null;

    const authUser = await admin.auth().getUser(userId);
    const email = authUser.email?.trim().toLowerCase() || null;
    if (!sessionId && (!authUser.emailVerified || !email)) {
      throw new HttpsError(
        "permission-denied",
        "Verify the email address you paid with before claiming this membership."
      );
    }

    const userRef = db().collection("users").doc(userId);
    if (!(await userRef.get()).exists) {
      throw new HttpsError(
        "failed-precondition",
        "Set up your member profile before claiming a purchase."
      );
    }

    let candidates = sessionId ?
      await db().collection("memberships")
        .where("checkoutSessionId", "==", sessionId).get() :
      await (email ?
        db().collection("memberships").where("payerEmail", "==", email).get() :
        Promise.resolve({docs: []} as unknown as QuerySnapshot));

    if (sessionId && candidates.docs.length > 1) {
      const checkoutSessionIdHash = sha256(sessionId);
      console.error("CRITICAL_BILLING_DUPLICATE_CHECKOUT_SESSION", {
        checkoutSessionIdHash,
        membershipIds: candidates.docs.map((doc) => doc.id),
      });
      await writeAudit({
        type: "duplicate_checkout_session_claim",
        severity: "critical",
        checkoutSessionIdHash,
        membershipIds: candidates.docs.map((doc) => doc.id),
        claimantUid: userId,
      });
      throw new HttpsError(
        "failed-precondition",
        "This purchase link needs support review before it can be claimed."
      );
    }

    const initiallyOwned = candidates.docs.filter((doc) =>
      doc.get("payerUid") === userId &&
      (Boolean(sessionId) || (authUser.emailVerified && Boolean(email)))
    );

    // Reject an unowned session link before it is allowed to trigger any
    // provider reads. Exact-owner retries deliberately remain idempotent even
    // after the original verifier window has elapsed.
    if (sessionId && candidates.docs.length === 1 && initiallyOwned.length === 0) {
      if (!presentedAttemptHash ||
        candidates.docs[0].get("checkoutAttemptHash") !== presentedAttemptHash) {
        const checkoutSessionIdHash = sha256(sessionId);
        await writeAudit({
          type: "invalid_checkout_claim_verifier",
          severity: "critical",
          checkoutSessionIdHash,
          membershipId: candidates.docs[0].id,
          claimantUid: userId,
        });
        throw new HttpsError(
          "permission-denied",
          "This checkout link cannot prove ownership. Sign in with the verified email used to pay."
        );
      }
      const fulfilledAt = toMillis(candidates.docs[0].get("fulfilledAt"));
      const claimNow = Date.now();
      const maxClockSkewMs = 5 * 60 * 1000;
      if (fulfilledAt === null || fulfilledAt > claimNow + maxClockSkewMs) {
        const checkoutSessionIdHash = sha256(sessionId);
        await writeAudit({
          type: "invalid_checkout_session_claim_evidence",
          severity: "critical",
          checkoutSessionIdHash,
          membershipId: candidates.docs[0].id,
          claimantUid: userId,
        });
        throw new HttpsError(
          "failed-precondition",
          "This purchase link needs support review before it can be claimed."
        );
      }
      if (claimNow - fulfilledAt > SESSION_CLAIM_WINDOW_MS) {
        throw new HttpsError(
          "deadline-exceeded",
          "This purchase link has expired. Sign in with the email you paid with to claim it."
        );
      }
    }

    let convergedMembershipIds = new Set<string>();
    if (candidates.docs.length > 0) {
      const candidateCanGrant = candidates.docs.some((doc) =>
        doc.get("grantsAlphaWodAccess") === true &&
        doc.get("participant.isPayer") === true
      );
      const accountMemberships = candidateCanGrant ?
        await alphaWodMembershipsForAccount(userId) : [];
      convergedMembershipIds = await convergeEligibilityMemberships(
        [...candidates.docs, ...accountMemberships],
        converge,
        "membership_claim"
      );

      // Convergence can make a stale local terminal membership blocking (or
      // vice versa). Refresh claim candidates before the final transaction,
      // which independently rechecks all account-level duplicates.
      candidates = sessionId ?
        await db().collection("memberships")
          .where("checkoutSessionId", "==", sessionId).get() :
        await (email ?
          db().collection("memberships").where("payerEmail", "==", email).get() :
          Promise.resolve({docs: []} as unknown as QuerySnapshot));
      if (sessionId && candidates.docs.length > 1) {
        console.error("CRITICAL_BILLING_DUPLICATE_CHECKOUT_SESSION_AFTER_CONVERGENCE", {
          checkoutSessionIdHash: sha256(sessionId),
          membershipIds: candidates.docs.map((doc) => doc.id),
        });
        throw new HttpsError(
          "failed-precondition",
          "This purchase link needs support review before it can be claimed."
        );
      }
      assertEligibilityDocsWereConverged(
        candidates.docs,
        convergedMembershipIds
      );
    }
    // A success page can call this more than once (navigation retries, Strict
    // Mode, or a network response lost after the transaction committed). Once
    // this exact session already belongs to the caller, treat the repeat as a
    // successful no-op and re-run entitlement convergence in case the first
    // attempt committed the attach but failed before convergence completed.
    const alreadyOwned = candidates.docs.filter((doc) =>
      doc.get("payerUid") === userId &&
      (Boolean(sessionId) || (authUser.emailVerified && Boolean(email)))
    );
    if (sessionId && alreadyOwned.length > 0) {
      await Promise.all(alreadyOwned.map((doc) =>
        applyMembershipEntitlement(doc.ref, converge)
      ));
      return {
        ok: true,
        claimed: alreadyOwned.map((doc) => doc.id),
        alreadyClaimed: true,
      };
    }

    const unclaimed = candidates.docs.filter((doc) => !doc.get("payerUid"));
    if (unclaimed.length === 0) {
      if (alreadyOwned.length > 0) {
        await Promise.all(alreadyOwned.map((doc) =>
          applyMembershipEntitlement(doc.ref, converge)
        ));
        return {
          ok: true,
          claimed: alreadyOwned.map((doc) => doc.id),
          alreadyClaimed: true,
        };
      }
      throw new HttpsError(
        "not-found",
        "No unclaimed membership was found for this account."
      );
    }

    // A verified-email retry may find both a membership attached just before a
    // prior invocation crashed and another still-unclaimed membership for the
    // same payer. Re-converge the owned rows, then continue claiming the rest.
    await Promise.all(alreadyOwned.map((doc) =>
      applyMembershipEntitlement(doc.ref, converge)
    ));
    const claimed: string[] = alreadyOwned.map((doc) => doc.id);

    for (const candidate of unclaimed) {
      const membershipRef = candidate.ref;
      const payerEmail = candidate.get("payerEmail") as string | null;

      if (!sessionId && (!authUser.emailVerified || !email || email !== payerEmail)) {
        throw new HttpsError(
          "permission-denied",
          "Verify the email address you paid with before claiming this membership."
        );
      }

      const plan = getPlan(candidate.get("planKey") as PlanKey);

      const attached = await db().runTransaction(async (tx) => {
        const fresh = await tx.get(membershipRef);
        const freshUser = await tx.get(userRef);
        if (!fresh.exists) return {state: "taken" as const, customerConflict: false};
        if (!freshUser.exists) {
          throw new HttpsError(
            "failed-precondition",
            "Set up your member profile before claiming a purchase."
          );
        }
        const currentPayerUid = fresh.get("payerUid");
        if (currentPayerUid && currentPayerUid !== userId) {
          return {state: "taken" as const, customerConflict: false};
        }
        if (sessionId && fresh.get("checkoutAttemptHash") !== presentedAttemptHash) {
          throw new HttpsError(
            "permission-denied",
            "This checkout link cannot prove ownership."
          );
        }

        const participantIsPayer = fresh.get("participant.isPayer") === true;
        const currentTargetUid = fresh.get("entitlementTargetUid");
        if (participantIsPayer && currentTargetUid !== null &&
          currentTargetUid !== undefined && currentTargetUid !== userId) {
          throw new HttpsError(
            "failed-precondition",
            "This self-payer membership is already linked to another account."
          );
        }
        const shouldOwnEntitlement = plan.grantsAlphaWodAccess && participantIsPayer &&
          isMembershipStateBlockingDuplicate(fresh.get("state") as MembershipState);
        const payerMemberships = shouldOwnEntitlement ? await tx.get(
          db().collection("memberships").where("payerUid", "==", userId)
        ) : null;
        const targetMemberships = shouldOwnEntitlement ? await tx.get(
          db().collection("memberships").where("entitlementTargetUid", "==", userId)
        ) : null;
        const duplicate = [...(payerMemberships?.docs ?? []),
          ...(targetMemberships?.docs ?? [])].some((doc) =>
          doc.id !== membershipRef.id &&
          doc.get("grantsAlphaWodAccess") === true &&
          isBlockingMembershipDoc(doc)
        );
        if (shouldOwnEntitlement) {
          assertEligibilityDocsWereConverged([
            ...(payerMemberships?.docs ?? []).filter((doc) =>
              doc.get("grantsAlphaWodAccess") === true
            ),
            ...(targetMemberships?.docs ?? []).filter((doc) =>
              doc.get("grantsAlphaWodAccess") === true
            ),
          ], convergedMembershipIds);
        }
        if (duplicate) {
          throw new HttpsError("already-exists", POLICY_TEXT.duplicateBlocked);
        }
        if (shouldOwnEntitlement &&
          await hasBlockingPayerCheckoutReservation(tx, userId)) {
          throw new HttpsError("already-exists", POLICY_TEXT.duplicateBlocked);
        }
        const owner = shouldOwnEntitlement ?
          await readEntitlementOwner(tx, userId, membershipRef.id) : null;

        if (owner?.ownerState === "active" && owner.ownerSubscriptionId &&
          !convergedMembershipIds.has(owner.ownerSubscriptionId)) {
          throw new HttpsError(
            "unavailable",
            AUTHORITATIVE_ELIGIBILITY_UNAVAILABLE,
            {reason: "membership_state_changed"}
          );
        }

        if (owner) acquireEntitlementOwner(tx, owner, userId, membershipRef.id);
        tx.set(membershipRef, {
          payerUid: userId,
          payerEmail: (fresh.get("payerEmail") as string | null) ?? payerEmail ?? email,
          ...(currentPayerUid === userId ? {} : {
            claimedAt: serverTimestamp(),
            claimedVia: sessionId ? "checkout_session" : "verified_email",
          }),
          ...(sessionId ? {checkoutClaimVerifierConsumedAt: serverTimestamp()} : {}),
          ...(shouldOwnEntitlement ?
            {entitlementTargetUid: userId} :
            {}),
          updatedAt: serverTimestamp(),
        }, {merge: true});

        const customerId = fresh.get("stripeCustomerId");
        const currentCustomerId = freshUser.get("stripeCustomerId");
        if (typeof customerId === "string" && customerId && !currentCustomerId) {
          tx.set(userRef, {
            stripeCustomerId: customerId,
            updatedAt: serverTimestamp(),
          }, {merge: true});
        }
        return {
          state: currentPayerUid === userId ? "already_mine" as const : "attached" as const,
          customerConflict: typeof customerId === "string" && Boolean(customerId) &&
            typeof currentCustomerId === "string" && Boolean(currentCustomerId) &&
            currentCustomerId !== customerId,
        };
      });

      if (attached.state === "taken") continue;

      if (attached.customerConflict) {
        console.error("CRITICAL_BILLING_CUSTOMER_CONFLICT", {
          subscriptionId: membershipRef.id,
          userId,
        });
        await writeAudit({
          type: "billing_customer_conflict",
          severity: "critical",
          subscriptionId: membershipRef.id,
          payerUid: userId,
        });
      }

      await applyMembershipEntitlement(membershipRef, converge);
      claimed.push(membershipRef.id);
      if (attached.state === "attached") {
        await writeAudit({
          type: "membership_claimed",
          subscriptionId: membershipRef.id,
          payerUid: userId,
          claimedVia: sessionId ? "checkout_session" : "verified_email",
        });
      }
    }

    if (claimed.length === 0) {
      throw new HttpsError(
        "already-exists",
        "That membership has already been claimed by another account."
      );
    }

    return {ok: true, claimed};
  });
}

/** ---------------------------------------------------------------
 * Webhook
 * -------------------------------------------------------------- */

async function fulfilCheckoutSession(
  session: Stripe.Checkout.Session,
  converge: (userId: string) => Promise<void>,
  completionUnixSeconds: number
): Promise<void> {
  assertStripeObjectMode("Checkout Session", session.id, session.livemode);
  const intentId = session.metadata?.intentId;
  const subscriptionId = typeof session.subscription === "string" ?
    session.subscription :
    session.subscription?.id;

  if (!intentId) return;
  const intentRef = db().collection("membershipIntents").doc(intentId);
  const intentSnap = await intentRef.get();
  if (!intentSnap.exists) {
    throw new Error(`Checkout intent ${intentId} was not found for ${session.id}.`);
  }
  const intent = intentSnap.data() as MembershipIntentDoc;
  if (intent.stripeMode !== assertBillingEnvironment().stripeMode) {
    throw new Error(`Checkout intent ${intentId} belongs to another Stripe environment.`);
  }
  if (session.mode !== "subscription") {
    throw new Error(`Checkout Session ${session.id} is not a subscription checkout.`);
  }
  if (intent.checkoutSessionId && intent.checkoutSessionId !== session.id) {
    throw new Error(
      `Checkout Session ${session.id} does not match intent ${intentRef.id}.`
    );
  }
  if (session.metadata?.planKey !== intent.planKey) {
    throw new Error(`Checkout Session ${session.id} has the wrong membership plan.`);
  }

  const presale = isPresaleIntent(intent);
  // Some dynamic payment methods complete standard Checkout before funds
  // settle. Keep uniqueness locks alive for its async success/failure event.
  if (session.payment_status === "unpaid") {
    await extendCheckoutReservationForAsyncPayment(intentRef);
    return;
  }
  if (presale) {
    const exactPresaleContract =
      intent.billingCycleAnchor === PRESALE_BILLING_ANCHOR_UNIX_SECONDS &&
      intent.firstPaymentAt === PRESALE_BILLING_ANCHOR_UNIX_SECONDS &&
      intent.serviceStartsAt === PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS &&
      intent.initialChargePence === 0 &&
      intent.prorationBehavior === "none" &&
      session.status === "complete" &&
      session.payment_status === "no_payment_required" &&
      session.payment_method_collection === "always" &&
      session.amount_total === 0 &&
      session.expires_at === intent.checkoutExpiresAt &&
      completionUnixSeconds <= intent.checkoutExpiresAt &&
      completionUnixSeconds < intent.billingCycleAnchor;
    if (!exactPresaleContract) {
      throw new Error(
        `Checkout Session ${session.id} does not match the frozen £0 presale contract.`
      );
    }
  } else if (session.payment_status !== "paid") {
    throw new Error(
      `Checkout Session ${session.id} is not paid (${session.payment_status}).`
    );
  }
  if (!subscriptionId) {
    throw new Error(`Completed Checkout Session ${session.id} has no subscription.`);
  }

  const commercialTerms = intent.commercialTerms ??
    createCommercialPlanSnapshot(intent.planKey);
  const subscription = await stripe().subscriptions.retrieve(subscriptionId, {
    expand: ["discounts"],
  });
  assertStripeObjectMode("Subscription", subscription.id, subscription.livemode);
  const sessionCustomerId = idOf(session.customer);
  if (!sessionCustomerId) {
    throw new Error(
      `Checkout Session ${session.id} has no Stripe customer.`
    );
  }
  const contractMismatch = stripeSubscriptionContractMismatch(subscription, {
    planKey: intent.planKey,
    stripePriceId: intent.stripePriceId,
    stripeCustomerId: sessionCustomerId,
    billingCycleAnchor: intent.billingCycleAnchor,
    intentId: intentRef.id,
  });
  if (contractMismatch) throw new Error(contractMismatch);
  const discount = await resolveApprovedCheckoutDiscount(
    session,
    subscription,
    intent,
    completionUnixSeconds
  );
  const membershipRef = db().collection("memberships").doc(subscriptionId);

  const fulfilmentNow = Date.now();
  const contractMadeMillis = Number.isFinite(completionUnixSeconds) &&
      completionUnixSeconds > 0 ?
    completionUnixSeconds * 1000 : fulfilmentNow;
  const pastDueSince = subscription.status === "past_due" ?
    Math.floor(fulfilmentNow / 1000) : null;
  const graceEndMillis = resolvePastDueGraceEndMillis(pastDueSince);
  const pastDueGraceEndsAt = graceEndMillis === null ?
    null : Timestamp.fromMillis(graceEndMillis);
  const providerState = resolveMembershipState({
    stripeStatus: subscription.status,
    pastDueSinceUnixSeconds: pastDueSince,
    cancelAtUnixSeconds: subscription.cancel_at,
  }, fulfilmentNow);
  const state: MembershipState = presale && providerState === "active" ?
    "scheduled" : providerState;

  // Stripe collected the billing email during checkout. It is the identity a
  // later claim is matched against, so it takes precedence over anything the
  // intent captured before payment.
  const stripeEmail = session.customer_details?.email?.trim().toLowerCase() ||
    intent.payerEmail ||
    null;

  const membership: MembershipDoc = {
    schemaVersion: MEMBERSHIP_SCHEMA_VERSION,
    subscriptionId,
    stripeCustomerId: typeof session.customer === "string" ?
      session.customer :
      session.customer?.id ?? "",
    checkoutSessionId: session.id,
    checkoutAttemptHash: intent.checkoutAttemptHash,
    payerUid: intent.payerUid,
    payerEmail: stripeEmail,
    fulfilledAt: serverTimestamp(),
    claimedAt: intent.payerUid ? serverTimestamp() : null,
    planKey: intent.planKey,
    stripePriceId: intent.stripePriceId,
    commercialTerms,
    planName: commercialTerms.planName,
    grantsAlphaWodAccess: commercialTerms.grantsAlphaWodAccess,
    participant: intent.participant,
    guardian: intent.guardian,
    acceptances: {
      ...intent.acceptances,
      contractMadeAt: Timestamp.fromMillis(contractMadeMillis),
      coolingOffEndsAt: resolveCoolingOffEnd(contractMadeMillis),
    },
    state,
    stripeStatus: subscription.status,
    // Access is granted only to an account that bought this for itself. An
    // unclaimed purchase has no account yet, so the target stays null until
    // `claimMembership` attaches one. A purchase made for another person is
    // linked by an administrator instead.
    entitlementTargetUid: commercialTerms.grantsAlphaWodAccess && intent.participant.isPayer ?
      intent.payerUid :
      null,
    preMembershipEntitlement: null,
    currentPeriodEnd: resolveCurrentPeriodEnd(subscription),
    billingMode: intent.billingMode ?? "standard",
    billingCycleAnchor: intent.billingCycleAnchor,
    serviceStartsAt: intent.serviceStartsAt ?? Math.floor(contractMadeMillis / 1000),
    firstPaymentAt: intent.firstPaymentAt ?? intent.billingCycleAnchor,
    initialChargePence: session.amount_total ?? null,
    firstPaymentReceivedAt: presale ? null : Math.floor(contractMadeMillis / 1000),
    firstPaidInvoiceId: null,
    discount,
    paymentSchedule: paymentScheduleFor(intent, discount, session.amount_total ?? null),
    pastDueSince,
    pastDueGraceEndsAt,
    nextReconcileAt: state === "scheduled" ?
      Timestamp.fromMillis((intent.firstPaymentAt ?? intent.billingCycleAnchor) * 1000) :
      state === "past_due_grace" ? pastDueGraceEndsAt :
        state === "past_due_suspended" ? Timestamp.fromMillis(
          fulfilmentNow + SUSPENDED_RECONCILE_INTERVAL_MS
        ) : null,
    openDisputeIds: [],
    disputeOpen: false,
    accessRevoked: false,
    providerContractStatus: "verified",
    cancelAt: subscription.cancel_at ?? null,
    cancellationRequestedAt: null,
    cancellationOutcome: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  // Membership state and its durable confirmation are accepted atomically.
  // A replay never overwrites a membership that has moved on, but it can heal
  // a missing outbox row from an interrupted earlier version of the handler.
  await ensureMembershipAndConfirmationOutbox(
    membershipRef,
    membership,
    session.amount_total ?? null,
    intentRef,
    intent
  );

  await transitionCheckoutReservation(intentRef, "fulfilled", {
    subscriptionId,
    fulfilledAt: serverTimestamp(),
  });
  // Re-read authoritative Stripe state after the membership exists. This also
  // heals an invoice/subscription event that arrived before Checkout fulfilment
  // and guarantees a past-due membership has a bounded grace deadline.
  await convergeMembershipFromStripe(subscriptionId, converge, {}, fulfilmentNow);
  // The scheduled sender owns delivery. Webhook completion therefore never
  // depends on Resend availability, and every retry uses the frozen outbox
  // payload rather than waiting for another unrelated Stripe event.
  await writeAudit({
    type: "checkout_fulfilled",
    subscriptionId,
    payerUid: intent.payerUid,
    planKey: intent.planKey,
    state,
  });
}

/**
 * Resolves the membership a charge belongs to.
 *
 * `Charge` no longer carries an `invoice` field, so the link runs through the
 * charge's PaymentIntent and the invoice payment recorded against it. If that
 * Customer identity alone is never enough: a customer can have sequential
 * subscriptions and unrelated one-off charges. If invoice linkage is missing,
 * an app-owned customer is sent through durable retry/manual review instead of
 * guessing and revoking the wrong membership.
 */
async function findMembershipIdForCharge(charge: Stripe.Charge): Promise<string | null> {
  const paymentIntentId = idOf(charge.payment_intent);

  if (paymentIntentId) {
    const payments = await stripe().invoicePayments.list({
      payment: {type: "payment_intent", payment_intent: paymentIntentId},
      limit: 10,
    });

    for (const payment of payments.data) {
      const invoiceId = idOf(payment.invoice);
      if (!invoiceId) continue;
      const invoice = await stripe().invoices.retrieve(invoiceId);
      assertStripeObjectMode("Invoice", invoice.id, invoice.livemode);
      const subscriptionId = resolveInvoiceSubscriptionId(invoice);
      if (subscriptionId) return subscriptionId;
    }
  }

  const customerId = idOf(charge.customer);
  if (!customerId) return null;

  const byCustomer = await db()
    .collection("memberships")
    .where("stripeCustomerId", "==", customerId)
    .get();
  if (byCustomer.empty) return null;
  console.error("CRITICAL_BILLING_UNRESOLVED_CHARGE_MEMBERSHIP", {
    chargeId: charge.id,
    customerId,
    membershipIds: byCustomer.docs.map((doc) => doc.id),
  });
  // Retrying may heal a temporarily unavailable invoice-payment link. If it
  // never becomes resolvable, the durable Stripe event reaches manual review.
  throw new Error(
    `Charge ${charge.id} has no authoritative invoice-to-membership link.`
  );
}

function idOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in (value as any)) {
    return String((value as any).id);
  }
  return null;
}

type SubscriptionContractExpectation = {
  planKey: PlanKey;
  stripePriceId: string;
  stripeCustomerId: string;
  billingCycleAnchor: number;
  intentId?: string;
};

/** Returns the first immutable provider-contract mismatch, or null when safe. */
function stripeSubscriptionContractMismatch(
  subscription: Stripe.Subscription,
  expected: SubscriptionContractExpectation
): string | null {
  if (subscription.collection_method !== "charge_automatically") {
    return `Subscription ${subscription.id} is not collected automatically.`;
  }
  if (subscription.pause_collection !== null) {
    return `Subscription ${subscription.id} has payment collection paused.`;
  }
  if (subscription.status === "trialing" || subscription.trial_start !== null ||
    subscription.trial_end !== null) {
    return `Subscription ${subscription.id} has an unapproved trial.`;
  }
  if (subscription.metadata?.planKey !== expected.planKey) {
    return `Subscription ${subscription.id} has the wrong plan metadata.`;
  }
  if (expected.intentId && subscription.metadata?.intentId !== expected.intentId) {
    return `Subscription ${subscription.id} has the wrong checkout intent metadata.`;
  }
  if (idOf(subscription.customer) !== expected.stripeCustomerId) {
    return `Subscription ${subscription.id} has the wrong Stripe customer.`;
  }
  if (subscription.billing_cycle_anchor !== expected.billingCycleAnchor) {
    return `Subscription ${subscription.id} has a different billing-cycle anchor.`;
  }
  const items = subscription.items.data;
  if (items.length !== 1) {
    return `Subscription ${subscription.id} does not have exactly one membership item.`;
  }
  if (idOf(items[0].price) !== expected.stripePriceId) {
    return `Subscription ${subscription.id} has a different membership Price.`;
  }
  if (items[0].quantity !== 1) {
    return `Subscription ${subscription.id} does not have quantity one.`;
  }
  return null;
}

/**
 * Resolves the subscription an invoice belongs to.
 *
 * The current API exposes this on `invoice.parent.subscription_details`. The
 * line-item and legacy top-level paths are kept as fallbacks so an account
 * pinned to an older API version still resolves.
 */
function resolveInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const fromParent = idOf(invoice.parent?.subscription_details?.subscription);
  if (fromParent) return fromParent;

  for (const line of invoice.lines?.data ?? []) {
    const parent = (line as unknown as {
      parent?: {subscription_item_details?: {subscription?: unknown}};
    }).parent;
    const fromLine = idOf(parent?.subscription_item_details?.subscription);
    if (fromLine) return fromLine;
  }

  return idOf((invoice as unknown as {subscription?: unknown}).subscription);
}

const STRIPE_EVENT_LEASE_MS = 10 * 60 * 1000;
const STRIPE_EVENT_MAX_ATTEMPTS = 12;
const STRIPE_EVENT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type StripeEventLeaseResult =
  | {state: "acquired"; leaseToken: string}
  | {state: "processed"}
  | {state: "in_progress"}
  | {state: "deferred"}
  | {state: "terminal"};

function stripeEventRetryAtMillis(attemptCount: number, nowMillis: number): number {
  const exponent = Math.max(0, Math.min(attemptCount - 1, 6));
  return nowMillis + Math.min(60 * 60 * 1000, 60 * 1000 * (2 ** exponent));
}

/**
 * Claims a recoverable processing lease for one Stripe event. A plain
 * create-if-absent ledger loses an event forever if the process dies after the
 * create but before handling. Status plus an expiring lease lets a later
 * delivery distinguish completed work from an abandoned attempt.
 */
async function acquireStripeEventLease(
  event: Pick<Stripe.Event, "id" | "type" | "created">,
  nowMillis = Date.now(),
  leaseToken = randomUUID()
): Promise<StripeEventLeaseResult> {
  const ledgerRef = db().collection("stripeEvents").doc(event.id);
  let newlyTerminal = false;
  const result = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ledgerRef);
    if (snap.exists && snap.get("status") === "processed") {
      return {state: "processed"} as const;
    }
    if (snap.exists && snap.get("status") === "dead_letter") {
      return {state: "terminal"} as const;
    }

    const activeLeaseExpiresAt = snap.exists ?
      timestampMillis(snap.get("leaseExpiresAt")) : null;
    if (snap.exists && snap.get("status") === "processing" &&
      activeLeaseExpiresAt !== null && activeLeaseExpiresAt > nowMillis) {
      return {state: "in_progress"} as const;
    }
    const nextAttemptAt = snap.exists ?
      timestampMillis(snap.get("nextAttemptAt")) : null;
    if (snap.exists && snap.get("status") === "failed" &&
      nextAttemptAt !== null && nextAttemptAt > nowMillis) {
      return {state: "deferred"} as const;
    }

    const attemptCount = snap.exists && typeof snap.get("attemptCount") === "number" ?
      snap.get("attemptCount") as number : 0;
    const stripeCreated = snap.exists && typeof snap.get("stripeCreated") === "number" ?
      snap.get("stripeCreated") as number : event.created;
    if (attemptCount >= STRIPE_EVENT_MAX_ATTEMPTS ||
      nowMillis - stripeCreated * 1000 >= STRIPE_EVENT_MAX_AGE_MS) {
      newlyTerminal = true;
      tx.set(ledgerRef, {
        type: event.type,
        stripeCreated,
        status: "dead_letter",
        deadLetteredAt: serverTimestamp(),
        deadLetterReason: "Stripe event retry budget exhausted.",
        leaseToken: FieldValue.delete(),
        leaseExpiresAt: FieldValue.delete(),
        nextAttemptAt: FieldValue.delete(),
        updatedAt: serverTimestamp(),
      }, {merge: true});
      return {state: "terminal"} as const;
    }
    const leaseExpiresAt = Timestamp.fromMillis(
      nowMillis + STRIPE_EVENT_LEASE_MS
    );
    tx.set(ledgerRef, {
      type: event.type,
      stripeCreated: event.created,
      status: "processing",
      leaseToken,
      leaseExpiresAt,
      // A crashed invocation becomes discoverable by the scheduled worker as
      // soon as its lease expires.
      nextAttemptAt: leaseExpiresAt,
      attemptCount: attemptCount + 1,
      lastAttemptAt: serverTimestamp(),
      ...(snap.exists ? {} : {receivedAt: serverTimestamp()}),
      lastError: FieldValue.delete(),
      failedAt: FieldValue.delete(),
    }, {merge: true});
    return {state: "acquired", leaseToken} as const;
  });
  if (newlyTerminal) {
    console.error("CRITICAL_BILLING_STRIPE_EVENT_DEAD_LETTER", {
      eventId: event.id,
      eventType: event.type,
    });
    await writeAudit({
      type: "stripe_event_dead_lettered",
      severity: "critical",
      stripeEventId: event.id,
      stripeEventType: event.type,
      reason: "retry_budget_exhausted",
    }).catch((error) => console.error("Could not write dead-letter audit", event.id, error));
  }
  return result;
}

async function markStripeEventProcessed(
  eventId: string,
  leaseToken: string
): Promise<boolean> {
  const ledgerRef = db().collection("stripeEvents").doc(eventId);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ledgerRef);
    if (!snap.exists || snap.get("status") !== "processing" ||
      snap.get("leaseToken") !== leaseToken) return false;
    tx.set(ledgerRef, {
      status: "processed",
      processedAt: serverTimestamp(),
      leaseToken: FieldValue.delete(),
      leaseExpiresAt: FieldValue.delete(),
      nextAttemptAt: FieldValue.delete(),
      lastError: FieldValue.delete(),
    }, {merge: true});
    return true;
  });
}

async function markStripeEventFailed(
  eventId: string,
  leaseToken: string,
  error: unknown,
  nowMillis = Date.now()
): Promise<boolean> {
  const ledgerRef = db().collection("stripeEvents").doc(eventId);
  const outcome = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ledgerRef);
    if (!snap.exists || snap.get("status") !== "processing" ||
      snap.get("leaseToken") !== leaseToken) return null;
    const message = error instanceof Error ? error.message : String(error);
    const attemptCount = typeof snap.get("attemptCount") === "number" ?
      snap.get("attemptCount") as number : 1;
    const stripeCreated = typeof snap.get("stripeCreated") === "number" ?
      snap.get("stripeCreated") as number : Math.floor(nowMillis / 1000);
    const terminal = attemptCount >= STRIPE_EVENT_MAX_ATTEMPTS ||
      nowMillis - stripeCreated * 1000 >= STRIPE_EVENT_MAX_AGE_MS;
    const terminalMessage = message.slice(0, 1000);
    tx.set(ledgerRef, {
      status: terminal ? "dead_letter" : "failed",
      failedAt: serverTimestamp(),
      lastError: message.slice(0, 1000),
      leaseToken: FieldValue.delete(),
      leaseExpiresAt: FieldValue.delete(),
      ...(terminal ? {
        deadLetteredAt: serverTimestamp(),
        nextAttemptAt: FieldValue.delete(),
      } : {
        nextAttemptAt: Timestamp.fromMillis(
          stripeEventRetryAtMillis(attemptCount, nowMillis)
        ),
      }),
    }, {merge: true});
    return {terminal, terminalMessage};
  });
  if (outcome?.terminal) {
    console.error("CRITICAL_BILLING_STRIPE_EVENT_DEAD_LETTER", {
      eventId,
      error: outcome.terminalMessage,
    });
    await writeAudit({
      type: "stripe_event_dead_lettered",
      severity: "critical",
      stripeEventId: eventId,
      error: outcome.terminalMessage,
    }).catch((auditError) =>
      console.error("Could not write dead-letter audit", eventId, auditError)
    );
  }
  return outcome?.terminal ?? false;
}

async function processStripeEventUnderLease(
  event: Stripe.Event,
  leaseToken: string,
  converge: (userId: string) => Promise<void>
): Promise<void> {
  try {
    await handleStripeEvent(event, converge);
    const marked = await markStripeEventProcessed(event.id, leaseToken);
    if (!marked) {
      throw new Error("The Stripe event processing lease changed before completion.");
    }
  } catch (error) {
    await markStripeEventFailed(event.id, leaseToken, error).catch((ledgerError) =>
      console.error(
        "Could not record Stripe webhook failure",
        event.id,
        ledgerError
      )
    );
    throw error;
  }
}

/**
 * Stripe webhook endpoint.
 *
 * The signature is verified against the raw body before anything is read, and
 * every event is recorded in a recoverable lease ledger so redelivery cannot
 * apply completed work twice while a crashed handler can still be retried.
 */
export function buildStripeWebhook(converge: (userId: string) => Promise<void>) {
  return onRequest(
    {region: REGION, secrets: MEMBERSHIP_WEBHOOK_SECRETS, cors: false},
    async (req, res) => {
      if (req.method !== "POST") {
        res.status(405).send("Method Not Allowed");
        return;
      }

      try {
        // Fail before writing the webhook receipt/lease in Firestore.
        assertBillingEnvironment();
      } catch (error) {
        console.error("Rejected Stripe webhook in an invalid billing environment", error);
        res.status(503).send("Billing environment unavailable.");
        return;
      }

      const signature = req.get("stripe-signature");
      const webhookSecret = stripeWebhookSecret.value();
      if (!signature || !webhookSecret) {
        res.status(400).send("Missing signature.");
        return;
      }

      let event: Stripe.Event;
      try {
        event = stripe().webhooks.constructEvent(req.rawBody, signature, webhookSecret);
      } catch (error) {
        console.error("Rejected Stripe webhook signature", error);
        res.status(400).send("Invalid signature.");
        return;
      }
      try {
        assertStripeObjectMode("Event", event.id, event.livemode);
      } catch (error) {
        console.error("Rejected Stripe webhook from the wrong mode", event.id, error);
        res.status(400).send("Wrong Stripe mode.");
        return;
      }

      let lease: StripeEventLeaseResult;
      try {
        lease = await acquireStripeEventLease(event);
      } catch (error) {
        console.error("Stripe webhook lease acquisition failed", event.id, error);
        res.status(500).send("Ledger error.");
        return;
      }
      if (lease.state === "processed") {
        res.status(200).send("Already processed.");
        return;
      }
      if (lease.state === "terminal") {
        res.status(200).send("Accepted for manual review.");
        return;
      }
      if (lease.state === "in_progress" || lease.state === "deferred") {
        res.set("Retry-After", "5");
        res.status(409).send("Event processing is deferred; retry.");
        return;
      }

      try {
        await processStripeEventUnderLease(event, lease.leaseToken, converge);
        res.status(200).send("ok");
      } catch (error) {
        console.error("Stripe webhook handling failed", event.id, event.type, error);
        res.status(500).send("Handler error.");
      }
    }
  );
}

/** Reclaims due failed/crashed events and retrieves the signed object from Stripe. */
async function recoverDueStripeEventsOnce(
  converge: (userId: string) => Promise<void>,
  nowMillis = Date.now(),
  limit = 50
): Promise<{processed: number; failed: number; skipped: number}> {
  assertBillingEnvironment();
  const due = await db().collection("stripeEvents")
    .where("nextAttemptAt", "<=", Timestamp.fromMillis(nowMillis))
    .orderBy("nextAttemptAt", "asc")
    .limit(limit)
    .get();
  const result = {processed: 0, failed: 0, skipped: 0};

  for (const ledger of due.docs) {
    const itemNow = Math.max(nowMillis, Date.now());
    const eventStub = {
      id: ledger.id,
      type: String(ledger.get("type") || "unknown") as Stripe.Event["type"],
      created: typeof ledger.get("stripeCreated") === "number" ?
        ledger.get("stripeCreated") as number : Math.floor(itemNow / 1000),
    };
    const lease = await acquireStripeEventLease(eventStub, itemNow);
    if (lease.state !== "acquired") {
      result.skipped += 1;
      continue;
    }

    try {
      const event = await stripe().events.retrieve(ledger.id);
      assertStripeObjectMode("Event", event.id, event.livemode);
      await processStripeEventUnderLease(event, lease.leaseToken, converge);
      result.processed += 1;
    } catch (error) {
      // Retrieval and handler failures are already recorded by the shared
      // processor only after retrieval. Record retrieval failures here too.
      const fresh = await ledger.ref.get();
      if (fresh.get("status") === "processing" &&
        fresh.get("leaseToken") === lease.leaseToken) {
        await markStripeEventFailed(
          ledger.id,
          lease.leaseToken,
          error,
          Math.max(itemNow, Date.now())
        );
      }
      console.error("Scheduled Stripe event recovery failed", ledger.id, error);
      result.failed += 1;
    }
  }

  return result;
}

export function buildRecoverStripeEvents(
  converge: (userId: string) => Promise<void>
) {
  return onSchedule({
    region: REGION,
    schedule: "every 5 minutes",
    timeZone: "UTC",
    secrets: MEMBERSHIP_STRIPE_WORKER_SECRETS,
    timeoutSeconds: 540,
  }, async () => {
    const result = await recoverDueStripeEventsOnce(converge);
    console.log("Stripe event recovery result", result);
  });
}

async function handleStripeEvent(
  event: Stripe.Event,
  converge: (userId: string) => Promise<void>
): Promise<void> {
  switch (event.type) {
  case "checkout.session.completed":
  case "checkout.session.async_payment_succeeded": {
    const trigger = event.data.object as Stripe.Checkout.Session;
    if (typeof trigger.id !== "string" || !trigger.id) {
      throw new Error(`Stripe event ${event.id} has no Checkout Session id.`);
    }
    // Webhook endpoint versions can lag the deployed SDK schema. Treat the
    // signed payload only as a trigger, then fulfil from Stripe's authoritative
    // current-API representation with its applied discounts expanded.
    const session = await stripe().checkout.sessions.retrieve(trigger.id, {
      expand: ["discounts.coupon", "discounts.promotion_code"],
    });
    assertStripeObjectMode("Checkout Session", session.id, session.livemode);
    await fulfilCheckoutSession(
      session,
      converge,
      event.created
    );
    return;
  }

  case "checkout.session.expired":
  case "checkout.session.async_payment_failed": {
    const session = event.data.object as Stripe.Checkout.Session;
    assertStripeObjectMode("Checkout Session", session.id, session.livemode);
    const intentId = session.metadata?.intentId;
    if (intentId) {
      const status = event.type === "checkout.session.expired" ? "expired" : "failed";
      await transitionCheckoutReservation(
        db().collection("membershipIntents").doc(intentId),
        status,
        {
          endedByStripeEvent: event.type,
          endedAt: serverTimestamp(),
        },
        true,
        {
          sessionId: session.id,
          mode: session.mode,
          planKey: session.metadata?.planKey ?? null,
        }
      );
    }
    return;
  }

  case "customer.subscription.created":
  case "customer.subscription.updated":
  case "customer.subscription.deleted":
  case "customer.subscription.paused":
  case "customer.subscription.resumed": {
    const subscription = event.data.object as Stripe.Subscription;
    await convergeMembershipFromStripe(subscription.id, converge);
    return;
  }

  case "invoice.paid": {
    const trigger = event.data.object as Stripe.Invoice;
    if (typeof trigger.id !== "string" || !trigger.id) {
      throw new Error(`Stripe event ${event.id} has no Invoice id.`);
    }
    // Line parent/pricing shapes changed across Stripe API versions. Retrieve
    // the current invoice before constructing activation evidence so an older
    // webhook snapshot can never falsely grant or withhold access.
    const invoice = await stripe().invoices.retrieve(trigger.id);
    assertStripeObjectMode("Invoice", invoice.id, invoice.livemode);
    const subscriptionId = resolveInvoiceSubscriptionId(invoice);
    if (subscriptionId) {
      const paidAt = invoice.status_transitions?.paid_at ?? event.created;
      const activationPayment = invoice.status === "paid" &&
          typeof invoice.amount_paid === "number" && invoice.amount_paid > 0 &&
          typeof paidAt === "number" && typeof invoice.currency === "string" ? {
          invoiceId: invoice.id,
          paidAt,
          amountPaidPence: invoice.amount_paid,
          currency: invoice.currency,
          lines: subscriptionLineEvidence(invoice),
        } : undefined;
      await convergeMembershipFromStripe(subscriptionId, converge, {
        pastDueSince: null,
        ...(activationPayment ? {activationPayment} : {}),
      });
    }
    return;
  }

  case "invoice.payment_failed": {
    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionId = resolveInvoiceSubscriptionId(invoice);
    if (subscriptionId) {
      // `due_date` is meaningful only for manually sent invoices. Automatic
      // invoices can be created/finalised well before the failed collection
      // attempt, so their grace period starts at the signed failure event.
      const pastDueSince = invoice.collection_method === "send_invoice" &&
          typeof invoice.due_date === "number" ?
        invoice.due_date : event.created;
      await convergeMembershipFromStripe(subscriptionId, converge, {pastDueSince});
    }
    return;
  }

  case "charge.dispute.created":
  case "charge.dispute.closed": {
    const delivered = event.data.object as Stripe.Dispute;
    // The event snapshot may be older than another delivered event. Retrieve
    // the current Dispute so a delayed `created` can never reopen a won/closed
    // dispute or undo a lost-dispute revocation.
    const dispute = await stripe().disputes.retrieve(delivered.id);
    assertStripeObjectMode("Dispute", dispute.id, dispute.livemode);
    const subscriptionId = await findMembershipIdForDispute(dispute);
    if (!subscriptionId) return;
    await convergeMembershipFromStripe(subscriptionId, converge, {
      dispute: {id: dispute.id, status: dispute.status},
      ...(dispute.status === "lost" ? {accessRevoked: true} : {}),
    });
    return;
  }

  case "charge.refunded": {
    const charge = event.data.object as Stripe.Charge;
    const fullyRefunded = charge.amount_refunded >= charge.amount;
    if (!fullyRefunded) return;

    const subscriptionId = await findMembershipIdForCharge(charge);
    if (subscriptionId) {
      await convergeMembershipFromStripe(subscriptionId, converge, {accessRevoked: true});
    }
    return;
  }

  default:
    return;
  }
}

async function findMembershipIdForDispute(dispute: Stripe.Dispute): Promise<string | null> {
  const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
  if (!chargeId) return null;

  const charge = await stripe().charges.retrieve(chargeId);
  assertStripeObjectMode("Charge", charge.id, charge.livemode);
  return findMembershipIdForCharge(charge);
}

/** ---------------------------------------------------------------
 * Admin
 * -------------------------------------------------------------- */

export function buildListMemberships(requireAdmin: (request: any) => Promise<void>) {
  return onCall({region: REGION}, async (request) => {
    requireAuthUid(request);
    await requireAdmin(request);

    const snap = await db().collection("memberships").orderBy("createdAt", "desc").limit(500).get();
    const receiptIds = Array.from(new Set(snap.docs.flatMap((doc) => {
      const receiptId = (doc.data() as MembershipDoc).cancellationRequest?.receiptId;
      return typeof receiptId === "string" && receiptId ? [receiptId] : [];
    })));
    const receiptSnaps = await Promise.all(receiptIds.map((receiptId) =>
      db().collection(MEMBERSHIP_CANCELLATION_RECEIPT_COLLECTION)
        .doc(receiptId).get()
    ));
    const receipts = new Map(receiptSnaps
      .filter((receipt) => receipt.exists)
      .map((receipt) => [receipt.id, receipt.data()]));
    const memberships = snap.docs.map((doc) => {
      const membership = doc.data() as MembershipDoc;
      const requestReceiptId = membership.cancellationRequest?.receiptId;
      let receipt: MembershipCancellationReceipt | null = null;
      if (requestReceiptId) {
        try {
          const storedReceipt = receipts.get(requestReceiptId);
          assertMembershipCancellationReceipt(storedReceipt);
          receipt = storedReceipt;
        } catch {
          receipt = null;
        }
      }
      return {
        subscriptionId: membership.subscriptionId,
        payerUid: membership.payerUid,
        payerEmail: membership.payerEmail,
        planKey: membership.planKey,
        planName: membership.planName,
        state: membership.state,
        stripeStatus: membership.stripeStatus,
        grantsAlphaWodAccess: membership.grantsAlphaWodAccess,
        entitlementTargetUid: membership.entitlementTargetUid,
        participantFullName: membership.participant?.fullName ?? "",
        participantAge: membership.participant?.age ?? null,
        participantIsPayer: membership.participant?.isPayer ?? false,
        guardianFullName: membership.guardian?.fullName ?? null,
        billingMode: membership.billingMode ?? "standard",
        serviceStartsAt: membership.serviceStartsAt ?? null,
        firstPaymentAt: membership.firstPaymentAt ?? membership.billingCycleAnchor ?? null,
        billingCycleAnchor: membership.billingCycleAnchor ?? null,
        initialChargePence: membership.initialChargePence ?? null,
        firstPaymentReceivedAt: membership.firstPaymentReceivedAt ?? null,
        discount: membership.discount ?? null,
        paymentSchedule: membership.paymentSchedule ?? null,
        currentPeriodEnd: membership.currentPeriodEnd ?? null,
        cancelAt: membership.cancelAt ?? null,
        disputeOpen: membership.disputeOpen ?? false,
        accessRevoked: membership.accessRevoked ?? false,
        providerContractStatus: membership.providerContractStatus ?? null,
        providerContractError: membership.providerContractError ?? null,
        pastDueSince: membership.pastDueSince ?? null,
        confirmationEmailStatus: typeof membership.confirmationEmailStatus === "string" ?
          membership.confirmationEmailStatus : null,
        confirmationEmailError: typeof membership.confirmationEmailError === "string" ?
          membership.confirmationEmailError : null,
        confirmationEmailProviderId: typeof membership.confirmationEmailProviderId === "string" ?
          membership.confirmationEmailProviderId : null,
        cancellationRequestStatus: membership.cancellationRequest?.status ?? null,
        cancellationRequestKind: membership.cancellationRequest?.kind ??
          (membership.cancellationRequest ? "contractual" : null),
        cancellationReceipt: receipt ? {
          reference: receipt.receiptId,
          receivedAt: new Date(receipt.receivedAtMillis).toISOString(),
          kind: receipt.kind,
          channel: receipt.channel,
        } : null,
        refundReviewRequired: receipt?.outcome.refundReviewRequired ??
          membership.cancellationRequest?.refundReviewRequired ?? false,
        cancellationRequestError: membership.cancellationRequest?.lastError ?? null,
        cancellationAcknowledgementStatus:
          membership.cancellationAcknowledgementStatus ?? null,
        cancellationAcknowledgementError:
          membership.cancellationAcknowledgementError ?? null,
        cancellationAcknowledgementProviderId:
          membership.cancellationAcknowledgementProviderId ?? null,
        entitlementProjectionStatus: membership.entitlementProjectionStatus ?? null,
        entitlementProjectionError: membership.entitlementProjectionError ?? null,
      };
    });

    return {ok: true, memberships, planKeys: PLAN_KEYS};
  });
}

/**
 * Links a membership bought for another person to that person's account, so a
 * purchase where the payer is not the participant can still grant access.
 */
export function buildLinkMembershipParticipant(
  requireAdmin: (request: any) => Promise<void>,
  converge: (userId: string) => Promise<void>
) {
  return onCall({
    region: REGION,
    secrets: MEMBERSHIP_SECRETS,
    timeoutSeconds: MEMBERSHIP_INTERACTIVE_TIMEOUT_SECONDS,
  }, async (request) => {
    const callerUid = requireAuthUid(request);
    await requireAdmin(request);

    const subscriptionId = requireBoundedString(request.data?.subscriptionId, "subscriptionId", 3, 255);
    const targetUid = requireBoundedString(request.data?.participantUid, "participantUid", 3, 128);

    const membershipRef = db().collection("memberships").doc(subscriptionId);
    const targetRef = db().collection("users").doc(targetUid);
    const [initialMembership, initialTarget] = await Promise.all([
      membershipRef.get(),
      targetRef.get(),
    ]);
    if (!initialMembership.exists) {
      throw new HttpsError("not-found", "Membership not found.");
    }
    if (!initialTarget.exists) {
      throw new HttpsError("not-found", "Participant account not found.");
    }
    const requestedPriorProjectionStatus =
      initialMembership.get("entitlementProjectionStatus") ?? null;
    const requestedPriorProjectionError =
      initialMembership.get("entitlementProjectionError") ?? null;
    const accountMemberships = initialMembership.get("grantsAlphaWodAccess") === true ?
      await alphaWodMembershipsForAccount(targetUid) : [];
    const convergedMembershipIds = await convergeEligibilityMemberships(
      [initialMembership, ...accountMemberships],
      converge,
      "participant_link_or_repair"
    );

    const decision = await db().runTransaction(async (tx) => {
      const membershipSnap = await tx.get(membershipRef);
      const userSnap = await tx.get(targetRef);
      if (!membershipSnap.exists) throw new HttpsError("not-found", "Membership not found.");
      if (!userSnap.exists) throw new HttpsError("not-found", "Participant account not found.");

      const membership = membershipSnap.data() as MembershipDoc;
      if (!convergedMembershipIds.has(membershipRef.id)) {
        throw new HttpsError(
          "unavailable",
          AUTHORITATIVE_ELIGIBILITY_UNAVAILABLE,
          {reason: "membership_state_changed"}
        );
      }
      if (!membership.grantsAlphaWodAccess) {
        throw new HttpsError(
          "failed-precondition",
          "This plan does not include AlphaWOD access."
        );
      }
      const target = userSnap.data() as Record<string, unknown>;
      if (target.role !== "user") {
        throw new HttpsError(
          "failed-precondition",
          "Only a member account can be linked to a membership."
        );
      }
      const alreadyLinked = membership.entitlementTargetUid === targetUid;
      const selfPayer = membership.participant?.isPayer === true;
      if (selfPayer && (!alreadyLinked || membership.payerUid !== targetUid)) {
        throw new HttpsError(
          "failed-precondition",
          "A self-payer membership must be claimed by its payer and can only be repaired on that same account."
        );
      }
      if (membership.entitlementTargetUid &&
        membership.entitlementTargetUid !== targetUid) {
        // A transfer needs explicit restoration of the old target's snapshot.
        // Until that workflow exists, fail closed instead of leaking access.
        throw new HttpsError(
          "failed-precondition",
          "This membership is already linked. Contact support to review a transfer."
        );
      }

      const membershipBlocks = isMembershipStateBlockingDuplicate(membership.state);
      if (!alreadyLinked && !membershipBlocks) {
        throw new HttpsError(
          "failed-precondition",
          "This membership is no longer eligible to grant AlphaWOD access."
        );
      }
      if (!alreadyLinked && membership.participant?.isPayer !== false) {
        throw new HttpsError(
          "failed-precondition",
          "A self-payer membership must be claimed by its payer account."
        );
      }

      if (membershipBlocks) {
        const targetMemberships = await tx.get(
          db().collection("memberships").where("entitlementTargetUid", "==", targetUid)
        );
        const payerMemberships = await tx.get(
          db().collection("memberships").where("payerUid", "==", targetUid)
        );
        const duplicate = [...targetMemberships.docs, ...payerMemberships.docs].some((doc) =>
          doc.id !== membershipRef.id &&
          doc.get("grantsAlphaWodAccess") === true &&
          isBlockingMembershipDoc(doc)
        );
        assertEligibilityDocsWereConverged([
          ...targetMemberships.docs.filter((doc) =>
            doc.get("grantsAlphaWodAccess") === true
          ),
          ...payerMemberships.docs.filter((doc) =>
            doc.get("grantsAlphaWodAccess") === true
          ),
        ], convergedMembershipIds);
        if (duplicate) {
          throw new HttpsError("already-exists", POLICY_TEXT.duplicateBlocked);
        }
        if (await hasBlockingPayerCheckoutReservation(tx, targetUid)) {
          throw new HttpsError("already-exists", POLICY_TEXT.duplicateBlocked);
        }
        const owner = await readEntitlementOwner(tx, targetUid, subscriptionId);
        if (owner.ownerState === "active" && owner.ownerSubscriptionId &&
          !convergedMembershipIds.has(owner.ownerSubscriptionId)) {
          throw new HttpsError(
            "unavailable",
            AUTHORITATIVE_ELIGIBILITY_UNAVAILABLE,
            {reason: "membership_state_changed"}
          );
        }
        acquireEntitlementOwner(tx, owner, targetUid, subscriptionId);
      }

      if (!alreadyLinked) {
        tx.set(membershipRef, {
          entitlementTargetUid: targetUid,
          entitlementTargetLinkedBy: callerUid,
          entitlementTargetLinkedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, {merge: true});
      }
      return {
        kind: alreadyLinked ? "repair" as const : "link" as const,
      };
    });

    // Linking is the action that makes this paid membership authoritative for
    // the participant. Apply it now; waiting for a later Stripe webhook can
    // leave a fully paid member without access indefinitely.
    await applyMembershipEntitlement(membershipRef, converge);

    if (decision.kind === "link") {
      await writeAudit({
        type: "membership_participant_linked",
        subscriptionId,
        targetUid,
        linkedBy: callerUid,
      });
    } else {
      const repaired = await membershipRef.get();
      await writeAudit({
        type: "membership_entitlement_projection_repair",
        subscriptionId,
        targetUid,
        repairedBy: callerUid,
        priorProjectionStatus: requestedPriorProjectionStatus,
        priorProjectionError: requestedPriorProjectionError,
        projectionStatus: repaired.get("entitlementProjectionStatus") ?? null,
        projectionError: repaired.get("entitlementProjectionError") ?? null,
      });
    }

    return {
      ok: true,
      subscriptionId,
      participantUid: targetUid,
      alreadyLinked: decision.kind === "repair",
      repaired: decision.kind === "repair",
    };
  });
}

export const __testing = {
  secretsForRuntime,
  assertBillingEnvironment,
  assertStripeObjectMode,
  requirePurchaseFlowOpen,
  assertCheckoutDocumentModel,
  requireExactCheckoutAcceptanceIds,
  participantKeyFor,
  checkoutLockSpecs,
  checkoutRequestFingerprint,
  assertCheckoutAppCheck,
  buildCreateMembershipCheckoutHandler,
  reserveCheckoutAttempt,
  transitionCheckoutReservation,
  reconcileExpiredCheckoutReservations,
  settlePreparedCancellation,
  recoverPendingCancellationsOnce,
  cancellationRetryAtMillis,
  acquireStripeEventLease,
  markStripeEventProcessed,
  markStripeEventFailed,
  processStripeEventUnderLease,
  recoverDueStripeEventsOnce,
  stripeEventRetryAtMillis,
  reconcilePastDueMembershipsOnce,
  convergeMembershipFromStripe,
  convergeEligibilityMembershipFromStripe,
  handleStripeEvent,
  buildConfirmationPayload,
  ensureMembershipAndConfirmationOutbox,
  acquireConfirmationEmailLease,
  processMembershipConfirmationOutbox,
  retryDueMembershipConfirmationsOnce,
  confirmationEmailRetryAtMillis,
  isPermanentConfirmationFailure,
  isSystemicResendFailure,
  resolveCurrentPeriodEnd,
  resolveInvoiceSubscriptionId,
  resolveApprovedCheckoutDiscount,
};

/** ---------------------------------------------------------------
 * Durable confirmation email (Membership Terms 4)
 *
 * The Terms require an emailed durable copy carrying the agreed plan, amounts,
 * next payment date, cancellation information, signed acceptance evidence, and
 * the actual immutable documents accepted by the buyer. The outbox freezes the
 * complete commercial snapshot, exact statements, inline document text and
 * one plain-text attachment per document before any delivery attempt begins.
 * -------------------------------------------------------------- */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type ConfirmationDetails = {
  membership: MembershipDoc;
  initialChargePence: number | null;
  claimUrl: string | null;
};

function buildConfirmationHtml(details: ConfirmationDetails): string {
  const {membership, initialChargePence, claimUrl} = details;
  const commercialTerms = membership.commercialTerms ??
    createCommercialPlanSnapshot(membership.planKey);
  const isYouthPlan = commercialTerms.audience === "youth";
  const isPresale = membership.billingMode === "presale_deferred";
  const firstFullCharge = formatUnixBillingDate(membership.billingCycleAnchor);
  const documents = membership.acceptances.documents
    .map((document) =>
      `<li><strong>${escapeHtml(document.title)}</strong> — ` +
      `<code>${escapeHtml(document.version)}</code><br>` +
      `SHA-256: <code>${escapeHtml(document.sha256)}</code></li>`)
    .join("");
  const statements = membership.acceptances.statements
    .map(({statement}) => `<li>${escapeHtml(statement)}</li>`)
    .join("");
  const documentContents = membership.acceptances.documents
    .map((document) =>
      "<section style=\"margin:28px 0;page-break-before:always;\">" +
      `<h3 style="font-size:15px;margin:0 0 4px;">${escapeHtml(document.title)}</h3>` +
      "<p style=\"font-size:12px;color:#666;margin:0 0 12px;\">" +
      `${escapeHtml(document.version)} · SHA-256 ${escapeHtml(document.sha256)}</p>` +
      "<div style=\"white-space:pre-wrap;font:13px/1.55 Arial,Helvetica,sans-serif;" +
      `border:1px solid #ddd;padding:14px;">${escapeHtml(document.content)}</div>` +
      "</section>")
    .join("");

  const rows: Array<[string, string]> = [
    ["Plan", commercialTerms.planName],
    [isYouthPlan ? "Child" : "Participant", membership.participant.fullName],
    ["Monthly price", `${formatPence(commercialTerms.amountPence)} per month`],
    [
      "Paid today",
      isPresale && initialChargePence === 0 ?
        "£0.00 — no payment has been taken" : initialChargePence === null ?
          "See your Stripe receipt" :
          `${formatPence(initialChargePence)} (pro rata to ${firstFullCharge})`,
    ],
    [isPresale ? "First monthly payment" : "First full monthly payment", firstFullCharge],
    ["Then", "The first of each month"],
  ];

  if (membership.discount) {
    rows.splice(3, 0, [
      "Existing-member offer",
      `${formatPence(commercialTerms.amountPence - membership.discount.amountOffPence)} for the ` +
      `first ${membership.discount.durationInMonths} monthly payments; ` +
      `${formatPence(commercialTerms.amountPence)} from ` +
      `${formatUnixBillingDate(membership.paymentSchedule.fullPriceFrom as number)}`,
    ]);
  }

  if (membership.guardian) {
    rows.splice(2, 0, [
      isYouthPlan ? "Paying adult" : "Parent or guardian",
      `${membership.guardian.fullName} (${membership.guardian.relationship})`,
    ]);
  }

  const tableRows = rows
    .map(([label, value]) =>
      `<tr><td style="padding:6px 16px 6px 0;color:#666;">${escapeHtml(label)}</td>` +
      `<td style="padding:6px 0;"><strong>${escapeHtml(value)}</strong></td></tr>`)
    .join("");

  const claimBlock = claimUrl ?
    `<div style="margin:24px 0;padding:16px;background:#fff8e6;border:1px solid #e6c67a;">
      <p style="margin:0 0 10px;"><strong>One step left: claim your membership</strong></p>
      <p style="margin:0 0 12px;">Sign in, or create and verify an account with this email
      address, to link this membership to it.</p>
      <p style="margin:0;"><a href="${escapeHtml(claimUrl)}">${escapeHtml(claimUrl)}</a></p>
    </div>` :
    "";

  return `<!doctype html>
<html><body style="font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.6;">
  <h1 style="font-size:20px;margin:0 0 6px;">Your ${escapeHtml(commercialTerms.planName)} is confirmed</h1>
  <p style="margin:0 0 20px;color:#555;">Keep this email. It is your durable copy of this
  agreement.</p>

  ${isPresale ? `<p style="margin:0 0 20px;"><strong>Your membership is scheduled to start on
  ${escapeHtml(formatUnixBillingDate(membership.serviceStartsAt))}. Nothing has been charged
  today.</strong></p>` : ""}

  ${claimBlock}

  <table style="border-collapse:collapse;margin:0 0 24px;">${tableRows}</table>

  <h2 style="font-size:15px;margin:24px 0 8px;">Cancelling</h2>
  <p style="margin:0 0 8px;">${escapeHtml(isPresale ?
    `You can cancel before ${formatUnixBillingDate(membership.serviceStartsAt)} and no first ` +
      `payment will be taken. After service starts, ${POLICY_TEXT.cancellationRule}` :
    POLICY_TEXT.cancellationRule)}</p>
  <p style="margin:0 0 8px;">Request cancellation from your membership page when signed in,
  or email ${escapeHtml(COMPANY.supportEmail)} from this address if the page is unavailable.
  Your request is treated as received when it reaches that request flow or inbox; a later
  acknowledgement is evidence of receipt, not a condition that makes the request valid. Keep
  the acknowledgement and contact us promptly if it does not arrive.</p>
  <p style="margin:0 0 8px;">${escapeHtml(POLICY_TEXT.refund)}</p>
  <p style="margin:0 0 8px;">${escapeHtml(POLICY_TEXT.noPause)}</p>

  <h2 style="font-size:15px;margin:24px 0 8px;">Cooling-off</h2>
  <p style="margin:0 0 8px;">You may cancel within
  ${BILLING_POLICY.coolingOffDays} days of the day this contract was made. Your period ends
  ${escapeHtml(formatBillingDate(membership.acceptances.coolingOffEndsAt.slice(0, 10)))}.
  ${membership.acceptances.immediatePerformanceRequested ?
    `You expressly requested that the membership begin ${isPresale ?
      `on ${formatUnixBillingDate(membership.serviceStartsAt)}` : "immediately"}, so if you cancel within ` +
    "that period we may charge only the proportionate amount permitted by law for services " +
    "already supplied." :
    "You did not request service to begin before the cooling-off period ends."}</p>

  <h2 style="font-size:15px;margin:24px 0 8px;">Documents you accepted</h2>
  <ul style="margin:0 0 8px;padding-left:20px;">${documents}</ul>

  <h2 style="font-size:15px;margin:24px 0 8px;">Statements you accepted separately</h2>
  <ul style="margin:0 0 8px;padding-left:20px;">${statements}</ul>

  <h2 style="font-size:15px;margin:24px 0 8px;">Your signature</h2>
  <p style="margin:0 0 8px;">Signed by typing the name
  <strong>${escapeHtml(membership.acceptances.signedName)}</strong> at checkout as
  ${escapeHtml(membership.acceptances.signerRole)}.</p>

  <h2 style="font-size:15px;margin:28px 0 8px;">Complete immutable document copies</h2>
  <p style="margin:0 0 8px;">The complete text accepted at checkout appears below and is
  also attached as separate plain-text files.</p>
  ${documentContents}

  <hr style="border:none;border-top:1px solid #ddd;margin:28px 0 12px;">
  <p style="margin:0;font-size:12px;color:#666;">
    ${escapeHtml(COMPANY.legalName)} · Company number ${escapeHtml(COMPANY.companyNumber)}<br>
    ${escapeHtml(COMPANY.address)}<br>
    Registered office: ${escapeHtml(COMPANY.registeredOffice)}<br>
    Registered in: ${escapeHtml(COMPANY.registrationJurisdiction)}<br>
    Questions: ${escapeHtml(COMPANY.supportEmail)}<br>
    We are not VAT registered; the price shown is the total price.
  </p>
</body></html>`;
}

const CONFIRMATION_OUTBOX_COLLECTION = "membershipEmailOutbox";
const CONFIRMATION_EMAIL_LEASE_MS = 10 * 60 * 1000;
// Resend's idempotency guarantee lasts 24 hours. Stop automatic uncertain
// retries with an hour to spare so a late retry cannot create a duplicate.
const CONFIRMATION_EMAIL_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;

type ConfirmationEmailPayload = {
  from: string;
  to: string[];
  reply_to?: string;
  subject: string;
  html: string;
  attachments?: Array<{
    filename: string;
    /** Base64-encoded UTF-8 canonical document content for Resend. */
    content: string;
  }>;
};

type ConfirmationEmailSender = (
  payload: ConfirmationEmailPayload,
  idempotencyKey: string
) => Promise<{providerMessageId: string | null}>;

type MembershipEmailKind =
  | "membership_confirmation"
  | "membership_cancellation_acknowledgement";

type ConfirmationEmailLeaseResult =
  | {
    state: "acquired";
    outboxId: string;
    subscriptionId: string;
    kind: MembershipEmailKind;
    leaseToken: string;
    payload: ConfirmationEmailPayload;
    idempotencyKey: string;
    attemptCount: number;
  }
  | {state: "sent" | "in_progress" | "deferred" | "terminal" | "missing"};

function isMembershipEmailKind(value: unknown): value is MembershipEmailKind {
  return value === "membership_confirmation" ||
    value === "membership_cancellation_acknowledgement";
}

function membershipEmailProjectionFields(
  kind: MembershipEmailKind,
  status: "pending" | "sent" | "manual_review" | "dead_letter",
  error: string | null = null,
  providerMessageId: string | null = null
): Record<string, unknown> {
  if (kind === "membership_cancellation_acknowledgement") {
    return {
      cancellationAcknowledgementStatus: status,
      cancellationAcknowledgementError: error ?? FieldValue.delete(),
      ...(status === "sent" ? {
        cancellationAcknowledgementSentAt: serverTimestamp(),
        cancellationAcknowledgementProviderId: providerMessageId,
      } : {}),
      updatedAt: serverTimestamp(),
    };
  }
  return {
    confirmationEmailStatus: status,
    confirmationEmailError: error ?? FieldValue.delete(),
    ...(status === "sent" ? {
      confirmationEmailSentAt: serverTimestamp(),
      confirmationEmailProviderId: providerMessageId,
    } : {}),
    updatedAt: serverTimestamp(),
  };
}

function buildConfirmationPayload(
  membership: MembershipDoc,
  initialChargePence: number | null
): ConfirmationEmailPayload | null {
  if (!membership.payerEmail || initialChargePence === null) return null;
  const fromEmail = membershipFromEmail.value().trim() || COMPANY.confirmationSender;
  const commercialTerms = membership.commercialTerms ??
    createCommercialPlanSnapshot(membership.planKey);
  // The Stripe Session id is not an ownership credential and must never be
  // copied into email. The recipient can claim through verified-email matching;
  // same-browser post-checkout claiming additionally uses a one-time verifier.
  const claimUrl = membership.payerUid ?
    null : `${resolveReturnOrigin()}/account/membership?claim=email`;
  return {
    from: `${COMPANY.tradingName} <${fromEmail}>`,
    to: [membership.payerEmail],
    subject: `Your ${commercialTerms.planName} is confirmed`,
    html: buildConfirmationHtml({
      membership,
      initialChargePence,
      claimUrl,
    }),
    attachments: membership.acceptances.documents.map((document) => ({
      filename: `${document.version}.txt`,
      content: Buffer.from(document.content, "utf8").toString("base64"),
    })),
  };
}

/** Atomically creates a first membership and its immutable email outbox row. */
async function ensureMembershipAndConfirmationOutbox(
  membershipRef: DocumentReference,
  proposedMembership: MembershipDoc,
  initialChargePence: number | null,
  intentRef: DocumentReference,
  intent: MembershipIntentDoc
): Promise<void> {
  const outboxRef = db().collection(CONFIRMATION_OUTBOX_COLLECTION)
    .doc(membershipRef.id);
  const lockRefs = intent.reservationLockIds.map((id) =>
    db().collection(CHECKOUT_LOCK_COLLECTION).doc(id)
  );
  const participantQuery = db().collection("memberships")
    .where(
      "participant.participantKey",
      "==",
      intent.participant.participantKey
    );
  const frozenGrantsAlphaWodAccess = intent.commercialTerms?.grantsAlphaWodAccess ??
    getPlan(intent.planKey).grantsAlphaWodAccess;
  const payerQuery = intent.payerUid && frozenGrantsAlphaWodAccess ?
    db().collection("memberships").where("payerUid", "==", intent.payerUid) :
    null;
  const targetQuery = intent.payerUid && frozenGrantsAlphaWodAccess ?
    db().collection("memberships").where("entitlementTargetUid", "==", intent.payerUid) :
    null;
  const transactionOutcome = await db().runTransaction(async (tx) => {
    // Every read precedes every write. The deterministic lock ownership check
    // is the final paid-session guard: even if an unusually late asynchronous
    // payment arrives after its reservation was reclaimed, two subscriptions
    // cannot both fulfil for the same participant/account.
    const freshIntent = await tx.get(intentRef);
    const membershipSnap = await tx.get(membershipRef);
    const outboxSnap = await tx.get(outboxRef);
    const lockSnaps = await Promise.all(lockRefs.map((ref) => tx.get(ref)));
    const byParticipant = await tx.get(participantQuery);
    const byPayer = payerQuery ? await tx.get(payerQuery) : null;
    const byTarget = targetQuery ? await tx.get(targetQuery) : null;
    const effectiveTargetUid = membershipSnap.exists ?
      membershipSnap.get("entitlementTargetUid") as string | null :
      proposedMembership.entitlementTargetUid;
    const effectiveState = membershipSnap.exists ?
      membershipSnap.get("state") as MembershipState : proposedMembership.state;
    const entitlementOwner = effectiveTargetUid &&
        isMembershipStateBlockingDuplicate(effectiveState) ?
      await readEntitlementOwner(tx, effectiveTargetUid, membershipRef.id) : null;

    if (!freshIntent.exists) {
      throw new Error(`Checkout intent ${intentRef.id} disappeared during fulfilment.`);
    }
    const storedSessionId = freshIntent.get("checkoutSessionId");
    if (typeof storedSessionId === "string" &&
      storedSessionId !== proposedMembership.checkoutSessionId) {
      throw new Error(
        `Checkout intent ${intentRef.id} is bound to another Session.`
      );
    }
    const intentStatus = freshIntent.get("status") as MembershipIntentDoc["status"];
    if ((intentStatus === "failed" || intentStatus === "expired") &&
      !membershipSnap.exists) {
      throw new Error(`Checkout intent ${intentRef.id} ended before fulfilment.`);
    }
    if (!storedSessionId) {
      tx.set(intentRef, {
        checkoutSessionId: proposedMembership.checkoutSessionId,
        ...(intentStatus === "reserved" || intentStatus === "created" ?
          {status: "payment_pending"} : {}),
        updatedAt: serverTimestamp(),
      }, {merge: true});
    }

    if (!membershipSnap.exists) {
      const ownsEveryLock = lockRefs.length > 0 && lockSnaps.every((lock) =>
        lock.exists && lock.get("intentId") === intentRef.id
      );
      const duplicateParticipant = byParticipant.docs.some((doc) =>
        doc.id !== membershipRef.id && isBlockingMembershipDoc(doc)
      );
      const duplicatePayer = Boolean(byPayer?.docs.some((doc) =>
        doc.id !== membershipRef.id &&
        doc.get("grantsAlphaWodAccess") === true &&
        isBlockingMembershipDoc(doc)
      )) || Boolean(byTarget?.docs.some((doc) =>
        doc.id !== membershipRef.id &&
        doc.get("grantsAlphaWodAccess") === true &&
        isBlockingMembershipDoc(doc)
      ));
      if (!ownsEveryLock || duplicateParticipant || duplicatePayer) {
        throw new Error(
          `Checkout ${intentRef.id} no longer owns a unique fulfilment reservation.`
        );
      }
    }

    const membership = membershipSnap.exists ?
      membershipSnap.data() as MembershipDoc : proposedMembership;
    const alreadySent = membershipSnap.exists &&
      Boolean(membershipSnap.get("confirmationEmailSentAt"));
    const payload = alreadySent ? null :
      buildConfirmationPayload(membership, initialChargePence);
    const manualReviewReason = alreadySent ? null :
      !membership.payerEmail ?
        "Payer email was unavailable at fulfilment." :
        initialChargePence === null ?
          "Stripe did not provide the amount charged at fulfilment." : null;

    if (!membershipSnap.exists) {
      if (effectiveTargetUid && entitlementOwner) {
        acquireEntitlementOwner(
          tx,
          entitlementOwner,
          effectiveTargetUid,
          membershipRef.id
        );
      }
      tx.create(membershipRef, {
        ...proposedMembership,
        confirmationEmailStatus: payload ? "pending" : "manual_review",
        ...(manualReviewReason ? {confirmationEmailError: manualReviewReason} : {}),
      });
    } else if (alreadySent) {
      tx.set(membershipRef, {confirmationEmailStatus: "sent"}, {merge: true});
    } else if (payload && !outboxSnap.exists) {
      tx.set(membershipRef, {
        confirmationEmailStatus: "pending",
        updatedAt: serverTimestamp(),
      }, {merge: true});
    } else if (manualReviewReason) {
      tx.set(membershipRef, {
        confirmationEmailStatus: "manual_review",
        confirmationEmailError: manualReviewReason,
        updatedAt: serverTimestamp(),
      }, {merge: true});
    }

    if (payload && !outboxSnap.exists) {
      tx.create(outboxRef, {
        schemaVersion: MEMBERSHIP_SCHEMA_VERSION,
        kind: "membership_confirmation",
        subscriptionId: membershipRef.id,
        commercialTerms: membership.commercialTerms,
        acceptedDocuments: membership.acceptances.documents,
        acceptedStatements: membership.acceptances.statements,
        signerRole: membership.acceptances.signerRole,
        status: "pending",
        payload,
        idempotencyKey: `membership-confirmation/${membershipRef.id}/v1`,
        initialChargePence,
        attemptCount: 0,
        nextAttemptAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return {manualReviewCreated: false, manualReviewReason: null};
    }
    if (manualReviewReason && !outboxSnap.exists) {
      tx.create(outboxRef, {
        schemaVersion: MEMBERSHIP_SCHEMA_VERSION,
        kind: "membership_confirmation",
        subscriptionId: membershipRef.id,
        commercialTerms: membership.commercialTerms,
        acceptedDocuments: membership.acceptances.documents,
        acceptedStatements: membership.acceptances.statements,
        signerRole: membership.acceptances.signerRole,
        status: "manual_review",
        initialChargePence,
        deadLetterReason: manualReviewReason,
        deadLetteredAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return {manualReviewCreated: true, manualReviewReason};
    }
    return {manualReviewCreated: false, manualReviewReason: null};
  });
  if (transactionOutcome.manualReviewCreated) {
    console.error("CRITICAL_BILLING_CONFIRMATION_MANUAL_REVIEW", {
      subscriptionId: membershipRef.id,
      reason: transactionOutcome.manualReviewReason,
    });
    await writeAudit({
      type: "confirmation_email_terminal",
      severity: "critical",
      subscriptionId: membershipRef.id,
      reason: transactionOutcome.manualReviewReason,
    }).catch((error) =>
      console.error("Could not write confirmation terminal audit", membershipRef.id, error)
    );
  }
}

function confirmationEmailRetryAtMillis(
  attemptCount: number,
  nowMillis: number
): number {
  const exponent = Math.max(0, Math.min(attemptCount - 1, 4));
  return nowMillis + Math.min(60 * 60 * 1000, 5 * 60 * 1000 * (2 ** exponent));
}

const PERMANENT_RESEND_ERROR_NAMES = new Set([
  "invalid_attachment",
  "invalid_idempotency_key",
  "invalid_idempotent_request",
  "invalid_parameter",
  "invalid_to_address",
  "missing_required_field",
]);

const SYSTEMIC_RESEND_ERROR_NAMES = new Set([
  "missing_api_key",
  "invalid_api_key",
  "restricted_api_key",
  "invalid_from_address",
  "invalid_region",
  "validation_error",
  "daily_quota_exceeded",
  "monthly_quota_exceeded",
  "rate_limit_exceeded",
]);

function isPermanentConfirmationFailure(
  _status: number | null,
  providerErrorName: string | null = null
): boolean {
  return providerErrorName !== null &&
    PERMANENT_RESEND_ERROR_NAMES.has(providerErrorName);
}

function isSystemicResendFailure(
  status: number | null,
  providerErrorName: string | null
): boolean {
  return (providerErrorName !== null &&
      SYSTEMIC_RESEND_ERROR_NAMES.has(providerErrorName)) || status === 429;
}

async function acquireConfirmationEmailLease(
  outboxId: string,
  nowMillis = Date.now(),
  leaseToken = randomUUID()
): Promise<ConfirmationEmailLeaseResult> {
  const outboxRef = db().collection(CONFIRMATION_OUTBOX_COLLECTION)
    .doc(outboxId);
  const outcome = await db().runTransaction(async (tx) => {
    const snap = await tx.get(outboxRef);
    if (!snap.exists) {
      return {
        result: {state: "missing"} as const,
        terminalReason: null,
        kind: null,
        subscriptionId: null,
      };
    }
    const kind = snap.get("kind");
    const subscriptionId = snap.get("subscriptionId");
    if (!isMembershipEmailKind(kind) || typeof subscriptionId !== "string" ||
      !subscriptionId) {
      const terminalReason =
        "Membership email outbox routing evidence is missing or invalid.";
      tx.set(outboxRef, {
        status: "dead_letter",
        deadLetteredAt: serverTimestamp(),
        deadLetterReason: terminalReason,
        leaseToken: FieldValue.delete(),
        leaseExpiresAt: FieldValue.delete(),
        nextAttemptAt: FieldValue.delete(),
        updatedAt: serverTimestamp(),
      }, {merge: true});
      return {
        result: {state: "terminal"} as const,
        terminalReason,
        kind: null,
        subscriptionId: typeof subscriptionId === "string" ?
          subscriptionId : null,
      };
    }
    const membershipRef = db().collection("memberships").doc(subscriptionId);
    const membership = await tx.get(membershipRef);
    if (!membership.exists) {
      const terminalReason = "Membership email outbox has no membership document.";
      tx.set(outboxRef, {
        status: "manual_review",
        deadLetteredAt: serverTimestamp(),
        deadLetterReason: terminalReason,
        leaseToken: FieldValue.delete(),
        leaseExpiresAt: FieldValue.delete(),
        nextAttemptAt: FieldValue.delete(),
        updatedAt: serverTimestamp(),
      }, {merge: true});
      return {
        result: {state: "terminal"} as const,
        terminalReason,
        kind,
        subscriptionId,
      };
    }
    const status = snap.get("status");
    if (status === "sent") {
      return {
        result: {state: "sent"} as const,
        terminalReason: null,
        kind,
        subscriptionId,
      };
    }
    if (status === "dead_letter" || status === "manual_review") {
      return {
        result: {state: "terminal"} as const,
        terminalReason: null,
        kind,
        subscriptionId,
      };
    }

    const leaseExpiresAt = timestampMillis(snap.get("leaseExpiresAt"));
    if (status === "sending" && leaseExpiresAt !== null &&
      leaseExpiresAt > nowMillis) {
      return {
        result: {state: "in_progress"} as const,
        terminalReason: null,
        kind,
        subscriptionId,
      };
    }
    const nextAttemptAt = timestampMillis(snap.get("nextAttemptAt"));
    if (status !== "sending" && nextAttemptAt !== null &&
      nextAttemptAt > nowMillis) {
      return {
        result: {state: "deferred"} as const,
        terminalReason: null,
        kind,
        subscriptionId,
      };
    }

    const firstAttemptAt = timestampMillis(snap.get("firstAttemptAt"));
    const retryDeadlineAt = timestampMillis(snap.get("retryDeadlineAt"));
    if (retryDeadlineAt !== null && nowMillis >= retryDeadlineAt) {
      const terminalReason =
        "Resend idempotency window expired before confirmed delivery.";
      tx.set(outboxRef, {
        status: "manual_review",
        deadLetteredAt: serverTimestamp(),
        deadLetterReason: terminalReason,
        leaseToken: FieldValue.delete(),
        leaseExpiresAt: FieldValue.delete(),
        nextAttemptAt: FieldValue.delete(),
        updatedAt: serverTimestamp(),
      }, {merge: true});
      tx.update(membershipRef, membershipEmailProjectionFields(
        kind,
        "manual_review",
        "Delivery requires manual review."
      ));
      return {
        result: {state: "terminal"} as const,
        terminalReason,
        kind,
        subscriptionId,
      };
    }

    const payload = snap.get("payload") as ConfirmationEmailPayload | undefined;
    const idempotencyKey = snap.get("idempotencyKey");
    if (!payload || typeof idempotencyKey !== "string") {
      const terminalReason = "Membership email payload is missing or invalid.";
      tx.set(outboxRef, {
        status: "dead_letter",
        deadLetteredAt: serverTimestamp(),
        deadLetterReason: terminalReason,
        leaseToken: FieldValue.delete(),
        leaseExpiresAt: FieldValue.delete(),
        nextAttemptAt: FieldValue.delete(),
        updatedAt: serverTimestamp(),
      }, {merge: true});
      tx.update(membershipRef, membershipEmailProjectionFields(
        kind,
        "dead_letter",
        terminalReason
      ));
      return {
        result: {state: "terminal"} as const,
        terminalReason,
        kind,
        subscriptionId,
      };
    }

    const attemptCount = typeof snap.get("attemptCount") === "number" ?
      snap.get("attemptCount") as number : 0;
    const newLeaseExpiresAt = Timestamp.fromMillis(
      nowMillis + CONFIRMATION_EMAIL_LEASE_MS
    );
    tx.set(outboxRef, {
      status: "sending",
      leaseToken,
      leaseExpiresAt: newLeaseExpiresAt,
      nextAttemptAt: newLeaseExpiresAt,
      attemptCount: attemptCount + 1,
      lastAttemptAt: serverTimestamp(),
      ...(firstAttemptAt === null ? {
        firstAttemptAt: Timestamp.fromMillis(nowMillis),
        retryDeadlineAt: Timestamp.fromMillis(
          nowMillis + CONFIRMATION_EMAIL_RETRY_WINDOW_MS
        ),
      } : {}),
      updatedAt: serverTimestamp(),
    }, {merge: true});
    return {
      result: {
        state: "acquired",
        outboxId,
        subscriptionId,
        kind,
        leaseToken,
        payload,
        idempotencyKey,
        attemptCount: attemptCount + 1,
      } as const,
      terminalReason: null,
      kind,
      subscriptionId,
    };
  });
  if (outcome.terminalReason) {
    const cancellationAcknowledgement = outcome.kind ===
      "membership_cancellation_acknowledgement";
    console.error(cancellationAcknowledgement ?
      "CRITICAL_BILLING_CANCELLATION_ACKNOWLEDGEMENT_MANUAL_REVIEW" :
      "CRITICAL_BILLING_CONFIRMATION_MANUAL_REVIEW", {
      outboxId,
      subscriptionId: outcome.subscriptionId,
      reason: outcome.terminalReason,
    });
    await writeAudit({
      type: cancellationAcknowledgement ?
        "cancellation_acknowledgement_terminal" :
        "confirmation_email_terminal",
      severity: "critical",
      outboxId,
      subscriptionId: outcome.subscriptionId,
      reason: outcome.terminalReason,
    }).catch((error) =>
      console.error("Could not write membership-email terminal audit", outboxId, error)
    );
  }
  return outcome.result;
}

class ConfirmationDeliveryError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly providerErrorName: string | null
  ) {
    super(message);
  }
}

const sendConfirmationViaResend: ConfirmationEmailSender = async (
  payload,
  idempotencyKey
) => {
  const apiKey = resendApiKey.value().trim();
  if (!apiKey) {
    throw new ConfirmationDeliveryError(
      "RESEND_API_KEY is not configured.",
      null,
      "missing_api_key"
    );
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      "User-Agent": "AlphaWOD-membership/1.0",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });
  const body = await response.text();
  if (!response.ok) {
    let providerErrorName: string | null = null;
    let providerMessage = body;
    try {
      const parsed = JSON.parse(body) as {name?: unknown; message?: unknown};
      providerErrorName = typeof parsed.name === "string" ? parsed.name : null;
      providerMessage = typeof parsed.message === "string" ? parsed.message : body;
    } catch {
      // Keep the provider body as diagnostic context when it is not JSON.
    }
    throw new ConfirmationDeliveryError(
      providerMessage || response.statusText || `Resend returned ${response.status}.`,
      response.status,
      providerErrorName
    );
  }
  let providerMessageId: string | null = null;
  try {
    const parsed = JSON.parse(body) as {id?: unknown};
    providerMessageId = typeof parsed.id === "string" ? parsed.id : null;
  } catch {
    // A 2xx response is authoritative even if its optional metadata is absent.
  }
  return {providerMessageId};
};

async function processMembershipConfirmationOutbox(
  outboxId: string,
  nowMillis = Date.now(),
  sender: ConfirmationEmailSender = sendConfirmationViaResend
): Promise<ConfirmationEmailLeaseResult["state"] | "failed" | "systemic_failure"> {
  const lease = await acquireConfirmationEmailLease(outboxId, nowMillis);
  if (lease.state !== "acquired") return lease.state;

  const outboxRef = db().collection(CONFIRMATION_OUTBOX_COLLECTION)
    .doc(outboxId);
  const {subscriptionId, kind} = lease;
  const membershipRef = db().collection("memberships").doc(subscriptionId);
  try {
    const delivery = await sender(lease.payload, lease.idempotencyKey);
    const markOutcome = await db().runTransaction(async (tx) => {
      const snap = await tx.get(outboxRef);
      const membership = await tx.get(membershipRef);
      if (!snap.exists || snap.get("status") !== "sending" ||
        snap.get("leaseToken") !== lease.leaseToken) {
        return {marked: false, missingMembership: false};
      }
      tx.set(outboxRef, {
        status: "sent",
        sentAt: serverTimestamp(),
        providerMessageId: delivery.providerMessageId,
        leaseToken: FieldValue.delete(),
        leaseExpiresAt: FieldValue.delete(),
        nextAttemptAt: FieldValue.delete(),
        lastError: FieldValue.delete(),
        updatedAt: serverTimestamp(),
      }, {merge: true});
      if (membership.exists) {
        tx.update(membershipRef, membershipEmailProjectionFields(
          kind,
          "sent",
          null,
          delivery.providerMessageId
        ));
      }
      return {marked: true, missingMembership: !membership.exists};
    });
    if (!markOutcome.marked) return "in_progress";
    if (markOutcome.missingMembership) {
      console.error(kind === "membership_cancellation_acknowledgement" ?
        "CRITICAL_BILLING_SENT_CANCELLATION_ACKNOWLEDGEMENT_ORPHAN" :
        "CRITICAL_BILLING_SENT_CONFIRMATION_ORPHAN", {
        outboxId,
        subscriptionId,
      });
      await writeAudit({
        type: kind === "membership_cancellation_acknowledgement" ?
          "cancellation_acknowledgement_orphaned_after_send" :
          "confirmation_email_orphaned_after_send",
        severity: "critical",
        outboxId,
        subscriptionId,
        providerMessageId: delivery.providerMessageId,
      }).catch((error) =>
        console.error("Could not write sent-orphan audit", subscriptionId, error)
      );
    }
    await writeAudit({
      type: kind === "membership_cancellation_acknowledgement" ?
        "cancellation_acknowledgement_sent" : "confirmation_email_sent",
      outboxId,
      subscriptionId,
      providerMessageId: delivery.providerMessageId,
    }).catch((error) =>
      console.error("Could not write membership email audit", outboxId, error)
    );
    return "sent";
  } catch (error) {
    const errorStatus = error instanceof ConfirmationDeliveryError ?
      error.status : null;
    const providerErrorName = error instanceof ConfirmationDeliveryError ?
      error.providerErrorName : null;
    const message = error instanceof Error ? error.message : String(error);
    const failureNow = Math.max(nowMillis, Date.now());
    const failureOutcome = await db().runTransaction(async (tx) => {
      const snap = await tx.get(outboxRef);
      const membership = await tx.get(membershipRef);
      if (!snap.exists || snap.get("status") !== "sending" ||
        snap.get("leaseToken") !== lease.leaseToken) return null;
      const retryDeadlineAt = timestampMillis(snap.get("retryDeadlineAt"));
      const permanent = isPermanentConfirmationFailure(errorStatus, providerErrorName);
      const windowExpired = retryDeadlineAt !== null && failureNow >= retryDeadlineAt;
      const terminalStatus = permanent ? "dead_letter" : "manual_review";
      const orphan = !membership.exists;
      const terminal = permanent || windowExpired || orphan;
      tx.set(outboxRef, {
        status: terminal ? (orphan ? "manual_review" : terminalStatus) : "pending",
        lastError: message.slice(0, 1000),
        lastHttpStatus: errorStatus,
        lastProviderErrorName: providerErrorName,
        failedAt: serverTimestamp(),
        leaseToken: FieldValue.delete(),
        leaseExpiresAt: FieldValue.delete(),
        ...(terminal ? {
          deadLetteredAt: serverTimestamp(),
          nextAttemptAt: FieldValue.delete(),
        } : {
          nextAttemptAt: Timestamp.fromMillis(
            confirmationEmailRetryAtMillis(lease.attemptCount, failureNow)
          ),
        }),
        updatedAt: serverTimestamp(),
      }, {merge: true});
      if (membership.exists) {
        tx.update(membershipRef, membershipEmailProjectionFields(
          kind,
          terminal ? terminalStatus : "pending",
          message.slice(0, 500)
        ));
      }
      return {terminal, orphan};
    });
    if (!failureOutcome) return "in_progress";
    const {terminal, orphan} = failureOutcome;
    if (terminal || orphan) {
      console.error(kind === "membership_cancellation_acknowledgement" ?
        "CRITICAL_BILLING_CANCELLATION_ACKNOWLEDGEMENT_MANUAL_REVIEW" :
        "CRITICAL_BILLING_CONFIRMATION_MANUAL_REVIEW", {
        outboxId,
        subscriptionId,
        providerErrorName,
        error: message,
        orphan,
      });
      await writeAudit({
        type: kind === "membership_cancellation_acknowledgement" ?
          "cancellation_acknowledgement_terminal" :
          "confirmation_email_terminal",
        severity: "critical",
        outboxId,
        subscriptionId,
        providerErrorName,
        error: message.slice(0, 1000),
        orphan,
      }).catch((auditError) =>
        console.error("Could not write membership-email terminal audit", outboxId, auditError)
      );
    } else {
      console.error("Membership email delivery failed", outboxId, error);
    }
    if (!terminal && isSystemicResendFailure(errorStatus, providerErrorName)) {
      console.error("CRITICAL_BILLING_RESEND_CONFIGURATION", {
        providerErrorName,
        status: errorStatus,
      });
      return "systemic_failure";
    }
    return "failed";
  }
}

async function retryDueMembershipConfirmationsOnce(
  nowMillis = Date.now(),
  limit = 50,
  sender: ConfirmationEmailSender = sendConfirmationViaResend
): Promise<{sent: number; failed: number; skipped: number}> {
  const due = await db().collection(CONFIRMATION_OUTBOX_COLLECTION)
    .where("nextAttemptAt", "<=", Timestamp.fromMillis(nowMillis))
    .orderBy("nextAttemptAt", "asc")
    .limit(limit)
    .get();
  const result = {sent: 0, failed: 0, skipped: 0};
  for (const outbox of due.docs) {
    const itemNow = Math.max(nowMillis, Date.now());
    const status = await processMembershipConfirmationOutbox(
      outbox.id,
      itemNow,
      sender
    );
    if (status === "sent") result.sent += 1;
    else if (status === "failed" || status === "systemic_failure") result.failed += 1;
    else result.skipped += 1;
    // A bad key, unverified sender/domain, or provider-wide quota applies to
    // every row. Stop this batch so one configuration incident cannot churn all
    // confirmations; the next schedule retries after operators are alerted.
    if (status === "systemic_failure") break;
  }
  return result;
}

export function buildRetryMembershipConfirmations() {
  return onSchedule({
    region: REGION,
    schedule: "every 5 minutes",
    timeZone: "UTC",
    secrets: MEMBERSHIP_EMAIL_WORKER_SECRETS,
    timeoutSeconds: 540,
  }, async () => {
    const result = await retryDueMembershipConfirmationsOnce();
    console.log("Membership confirmation retry result", result);
  });
}
