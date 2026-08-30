import { getFunctions, httpsCallable } from "firebase/functions";
import app from "../../../firebaseApp";
import {
  createCommercialPlanSnapshot,
  resolveCheckoutAcceptanceStatements,
  resolveCheckoutDocuments,
  resolveCheckoutSignerRole,
  type CheckoutAcceptanceId,
  type ConditioningBookingPolicy,
  type ConditioningSlotKey,
  type PlanKey,
} from "../../../lib/membershipPlans";

const functions = getFunctions(app, "europe-west1");

export type MembershipState =
  | "incomplete"
  | "scheduled"
  | "active"
  | "past_due_grace"
  | "past_due_suspended"
  | "disputed"
  | "cancelled"
  | "revoked";

export type MembershipBillingMode = "presale_deferred" | "standard";

/**
 * Frozen Stripe discount details returned by the server. Every field is
 * optional at the membership level so older records continue to render
 * safely after this projection is introduced.
 */
export type MembershipDiscount = {
  couponId: string;
  promotionCodeId: string | null;
  amountOffPence: number | null;
  currency: "gbp" | null;
  durationInMonths: number | null;
  startsAt: number;
  endsAt: number | null;
  kind?: "existing_member" | "youth_family";
  percentOff?: number | null;
  duration?: "repeating" | "forever";
};

export type MembershipPaymentSchedule = {
  amountDueTodayPence: number | null;
  firstPaymentAt: number;
  standardMonthlyPence: number;
  discountedMonthlyPence: number | null;
  discountedPaymentCount: number | null;
  fullPriceFrom: number | null;
};

export type CancellationOutcome = {
  nextBillingDate: string;
  noticeDeadlineMet: boolean;
  noticeDaysGiven: number;
  noticeDeadlineDate: string;
  finalPaymentDate: string | null;
  accessEndsOnDate: string;
  cancelAtUnixSeconds: number;
};

export type CancellationRequestKind =
  | "presale_withdrawal"
  | "cooling_off"
  | "contractual";

export type CancellationRequestStatus =
  | "accepted"
  | "pending"
  | "applied"
  | "refund_review"
  | "manual_review";

/**
 * Safe server projection of a recorded cancellation request, for every request
 * kind. Raw evidence remains private; the payer sees only the fields needed to
 * prove when and how their request was recorded.
 */
export type CancellationReceipt = {
  reference: string;
  receivedAt: string;
  kind: CancellationRequestKind;
  acknowledgementStatus?: "pending" | "sent" | "failed" | null;
  refundReviewRequired?: boolean;
};

export type MyMembership = {
  subscriptionId: string;
  planKey: PlanKey;
  planName: string;
  state: MembershipState;
  billingMode?: MembershipBillingMode;
  serviceStartsAt?: number | null;
  firstPaymentAt?: number | null;
  billingCycleAnchor?: number | null;
  initialChargePence?: number | null;
  firstPaymentReceivedAt?: number | null;
  discount?: MembershipDiscount | null;
  paymentSchedule?: MembershipPaymentSchedule | null;
  grantsAlphaWodAccess: boolean;
  appAccessTier?: "none" | "limited" | "full";
  conditioningBookingPolicy?: ConditioningBookingPolicy | null;
  entitlementClassSlots?: ConditioningSlotKey[];
  selectedConditioningSlots?: ConditioningSlotKey[];
  entitlementWeeklyBookingLimit?: number | null;
  participantFullName: string;
  participantFullNames?: string[];
  participantCount?: number;
  participantIsPayer: boolean;
  currentPeriodEnd: number | null;
  cancelAt: number | null;
  cancellationOutcome: CancellationOutcome | null;
  cancellationMode?: "cancel_before_start" | "standard";
  cancellationPreview?: CancellationOutcome | null;
  cancellationRequestStatus?: CancellationRequestStatus | null;
  cancellationRequestKind?: CancellationRequestKind | null;
  cancellationReceipt?: CancellationReceipt | null;
  /** Legacy projections retained until every deployed backend returns status. */
  cancellationPending: boolean;
  cancellationManualReview: boolean;
  cancellationRequestError: string | null;
  providerContractStatus: "verified" | "manual_review" | null;
  providerContractError: string | null;
  entitlementProjectionStatus: "applied" | "manual_review" | null;
  entitlementProjectionError: string | null;
  coolingOffEndsAt: string | null;
  coolingOffActive: boolean;
};

export type CheckoutRequest = {
  /** Versioned request contract for the multi-participant checkout implementation. */
  checkoutSchemaVersion: 6;
  /** Stable across retries of the same form submission for Stripe idempotency. */
  checkoutAttemptId: string;
  /**
   * Billing policy the customer reviewed before submitting. The server rejects
   * the request if the launch cutoff changed that policy while the page was open.
   */
  expectedBillingMode: MembershipBillingMode;
  planKey: PlanKey;
  participantFullName: string;
  participantDateOfBirth: string;
  /** Additional children in the same youth plan; adults and mixed plans are rejected. */
  additionalParticipants?: Array<{
    fullName: string;
    dateOfBirth: string;
  }>;
  participantIsPayer: boolean;
  signedName: string;
  /** Exact ids checked individually; the server rejects any non-exact set. */
  acceptedStatementIds: CheckoutAcceptanceId[];
  /** Optional shared campaign code. Included in the digest, never stored as plaintext. */
  promotionCode?: string;
  guardianFullName?: string;
  guardianRelationship?: string;
};

export type CheckoutDetails = Omit<CheckoutRequest, "checkoutAttemptId">;
export type CheckoutAttempt = {id: string; fingerprint: string};
export type CheckoutAttemptContext = {payerUid: string | null};

const CHECKOUT_ATTEMPT_KEY = "zaf.membershipCheckoutAttempt.v1";
const CHECKOUT_ATTEMPT_TTL_MS = 24 * 60 * 60 * 1000;

type StoredCheckoutAttempt = CheckoutAttempt & {expiresAt: number};

function checkoutAttemptStorages(): Storage[] {
  const storages: Storage[] = [];
  // Accessing a Storage getter can itself throw in a sandboxed or privacy-
  // restricted browser, before getItem/setItem is reached.
  try {
    storages.push(window.sessionStorage);
  } catch {
    // Continue with localStorage or the in-memory attempt.
  }
  try {
    storages.push(window.localStorage);
  } catch {
    // Continue with sessionStorage or the in-memory attempt.
  }
  return storages;
}

function storedCheckoutAttempt(
  storage: Storage,
  expectedFingerprint?: string
): StoredCheckoutAttempt | null {
  try {
    const saved = JSON.parse(
      storage.getItem(CHECKOUT_ATTEMPT_KEY) || "null"
    ) as Partial<StoredCheckoutAttempt> | null;
    if (!isCheckoutAttemptId(saved?.id) ||
      typeof saved?.fingerprint !== "string" ||
      (expectedFingerprint !== undefined &&
        saved.fingerprint !== expectedFingerprint)) {
      return null;
    }

    // Older same-tab entries did not have a TTL. Migrate them once and apply
    // the same short lifetime used by the cross-tab recovery copy.
    const expiresAt = typeof saved.expiresAt === "number" ?
      saved.expiresAt : Date.now() + CHECKOUT_ATTEMPT_TTL_MS;
    if (expiresAt <= Date.now()) {
      storage.removeItem(CHECKOUT_ATTEMPT_KEY);
      return null;
    }
    return {id: saved.id, fingerprint: saved.fingerprint, expiresAt};
  } catch {
    return null;
  }
}

function rememberCheckoutAttempt(attempt: CheckoutAttempt): void {
  const stored: StoredCheckoutAttempt = {
    ...attempt,
    expiresAt: Date.now() + CHECKOUT_ATTEMPT_TTL_MS,
  };
  const serialized = JSON.stringify(stored);
  // sessionStorage preserves the normal same-tab flow. localStorage is the
  // recovery copy for mobile bank-app redirects that reopen the site in a new
  // tab or browser activity. It contains no checkout PII or Stripe identifier.
  for (const storage of checkoutAttemptStorages()) {
    try {
      storage.setItem(CHECKOUT_ATTEMPT_KEY, serialized);
    } catch {
      // The other store or the in-memory attempt may still be available.
    }
  }
}

/**
 * Creates a high-entropy attempt identifier in the browser. The checkout page
 * keeps this stable while retrying an unchanged request, then rotates it when
 * any submitted detail changes.
 */
export function createCheckoutAttemptId(): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new Error("Secure checkout identifiers are unavailable in this browser.");
  }
  if (typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();

  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  // RFC 4122 version 4 / variant bits keep the fallback in the same shape as
  // randomUUID while retaining browser-provided cryptographic entropy.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10).join(""),
  ].join("-");
}

function isCheckoutAttemptId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 255 &&
    /^[A-Za-z0-9._:-]+$/.test(value);
}

async function fingerprintCheckoutDetails(
  details: CheckoutDetails,
  context: CheckoutAttemptContext
): Promise<string> {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) {
    throw new Error("Secure checkout identifiers are unavailable in this browser.");
  }
  const digest = await cryptoApi.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify({
      schemaVersion: 1,
      payerUid: context.payerUid,
      details,
      legalAndCommercialSnapshot: {
        commercialTerms: createCommercialPlanSnapshot(details.planKey),
        signerRole: resolveCheckoutSignerRole(details.planKey),
        documents: resolveCheckoutDocuments(details.planKey),
        statements: resolveCheckoutAcceptanceStatements(
          details.planKey,
          1 + (details.additionalParticipants?.length ?? 0)
        ),
      },
    }))
  );
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0")
  ).join("");
}

/**
 * Reuses one opaque attempt across retries, page reloads and mobile bank-app
 * tab switches without storing names, dates of birth, signatures, or other
 * checkout details in the browser.
 */
export async function resolveCheckoutAttempt(
  details: CheckoutDetails,
  current: CheckoutAttempt | null = null,
  context: CheckoutAttemptContext = {payerUid: null}
): Promise<CheckoutAttempt> {
  const fingerprint = await fingerprintCheckoutDetails(details, context);
  if (current?.fingerprint === fingerprint && isCheckoutAttemptId(current.id)) {
    return current;
  }

  for (const storage of checkoutAttemptStorages()) {
    const saved = storedCheckoutAttempt(storage, fingerprint);
    if (saved) {
      const recovered = {id: saved.id, fingerprint};
      // Mirror a legacy or cross-tab value into both stores so the success
      // return and any later same-device retry see the same verifier.
      rememberCheckoutAttempt(recovered);
      return recovered;
    }
  }

  const attempt = {id: createCheckoutAttemptId(), fingerprint};
  rememberCheckoutAttempt(attempt);
  return attempt;
}

export function clearCheckoutAttempt(attemptId?: string): void {
  for (const storage of checkoutAttemptStorages()) {
    try {
      if (attemptId) {
        const saved = storedCheckoutAttempt(storage);
        if (saved?.id !== attemptId) continue;
      }
      storage.removeItem(CHECKOUT_ATTEMPT_KEY);
    } catch {
      // A stale opaque verifier expires naturally and cannot create a charge.
    }
  }
}

/** Returns the browser-held verifier for the checkout that just redirected. */
export function readCheckoutAttemptId(): string | null {
  for (const storage of checkoutAttemptStorages()) {
    const saved = storedCheckoutAttempt(storage);
    if (saved) return saved.id;
  }
  return null;
}

export async function createMembershipCheckoutSession(request: CheckoutRequest) {
  const invoke = httpsCallable<CheckoutRequest, {
    ok: boolean;
    sessionUrl: string | null;
    sessionId: string;
    billingMode: MembershipBillingMode;
    serviceStartsAt: number | null;
    firstPaymentAt: number | null;
    firstFullChargeDate: string;
    initialChargePence: number | null;
    promotionCodesEnabled: boolean;
  }>(functions, "createMembershipCheckoutSessionV2", {
    limitedUseAppCheckTokens: true,
  });

  const result = await invoke(request);
  return result.data;
}

export async function getMyMemberships() {
  const invoke = httpsCallable<Record<string, never>, {
    ok: boolean;
    memberships: MyMembership[];
    cancellationPreview: CancellationOutcome;
  }>(functions, "getMyMemberships");

  const result = await invoke({});
  return result.data;
}

export async function createCustomerPortalSession(subscriptionId: string) {
  const invoke = httpsCallable<{subscriptionId: string}, {ok: boolean; portalUrl: string}>(
    functions,
    "createCustomerPortalSession"
  );

  const result = await invoke({subscriptionId});
  return result.data;
}

export async function requestMembershipCancellation(
  subscriptionId: string,
  expectedCancelAtUnixSeconds: number,
  kind?: CancellationRequestKind
) {
  const invoke = httpsCallable<{
    subscriptionId: string;
    expectedCancelAtUnixSeconds: number;
    kind?: CancellationRequestKind;
  }, {
    ok: boolean;
    outcome?: CancellationOutcome | null;
    requestStatus?: CancellationRequestStatus;
    receipt?: CancellationReceipt | null;
  }>(functions, "requestMembershipCancellation");

  const result = await invoke({
    subscriptionId,
    expectedCancelAtUnixSeconds,
    ...(kind ? {kind} : {}),
  });
  return result.data;
}

export async function claimMembership(sessionId?: string, checkoutAttemptId?: string) {
  const invoke = httpsCallable<{
    sessionId?: string;
    checkoutAttemptId?: string;
  }, {ok: boolean; claimed: string[]}>(
    functions,
    "claimMembership"
  );

  const result = await invoke(sessionId ? {
    sessionId,
    ...(checkoutAttemptId ? {checkoutAttemptId} : {}),
  } : {});
  return result.data;
}

/**
 * A membership is bought before the buyer has an account, so the checkout
 * session id and the separate checkout-attempt verifier are held in this tab
 * until they sign up or sign in. Neither survives the browser session or the
 * 24-hour server claim window; the Session id alone cannot transfer ownership.
 */
const PENDING_CLAIM_KEY = "zaf.pendingMembershipClaim";
const PENDING_CLAIM_TTL_MS = 24 * 60 * 60 * 1000;

type PendingClaim = {
  sessionId: string;
  checkoutAttemptId: string | null;
  expiresAt: number;
};

export function rememberPendingClaim(
  sessionId: string,
  checkoutAttemptId: string | null = null
): void {
  try {
    const pending: PendingClaim = {
      sessionId,
      checkoutAttemptId: isCheckoutAttemptId(checkoutAttemptId) ? checkoutAttemptId : null,
      expiresAt: Date.now() + PENDING_CLAIM_TTL_MS,
    };
    window.sessionStorage.setItem(PENDING_CLAIM_KEY, JSON.stringify(pending));
    window.localStorage.removeItem(PENDING_CLAIM_KEY);
  } catch {
    // Private browsing can refuse storage; the verified-email claim still works.
  }
}

export function readPendingClaimVerifier(): string | null {
  try {
    const pending = JSON.parse(
      window.sessionStorage.getItem(PENDING_CLAIM_KEY) || "null"
    ) as Partial<PendingClaim> | null;
    if (typeof pending?.expiresAt !== "number" || pending.expiresAt <= Date.now()) {
      clearPendingClaim();
      return null;
    }
    const checkoutAttemptId = pending?.checkoutAttemptId;
    return isCheckoutAttemptId(checkoutAttemptId) ? checkoutAttemptId : null;
  } catch {
    return null;
  }
}

export function readPendingClaim(): string | null {
  try {
    const pending = JSON.parse(
      window.sessionStorage.getItem(PENDING_CLAIM_KEY) || "null"
    ) as Partial<PendingClaim> | null;
    if (typeof pending?.sessionId !== "string" ||
      typeof pending.expiresAt !== "number" || pending.expiresAt <= Date.now()) {
      clearPendingClaim();
      return null;
    }
    return pending.sessionId;
  } catch {
    clearPendingClaim();
    return null;
  }
}

export function clearPendingClaim(): void {
  try {
    window.sessionStorage.removeItem(PENDING_CLAIM_KEY);
    window.localStorage.removeItem(PENDING_CLAIM_KEY);
  } catch {
    // Nothing to do; a stale key only causes one redundant claim attempt.
  }
}

export type AdminMembership = {
  subscriptionId: string;
  payerUid: string | null;
  payerEmail: string | null;
  planKey: PlanKey;
  planName: string;
  state: MembershipState;
  billingMode?: MembershipBillingMode;
  serviceStartsAt?: number | null;
  firstPaymentAt?: number | null;
  billingCycleAnchor?: number | null;
  initialChargePence?: number | null;
  firstPaymentReceivedAt?: number | null;
  discount?: MembershipDiscount | null;
  paymentSchedule?: MembershipPaymentSchedule | null;
  /** Current contracted monthly value, calculated by the server. */
  monthlyRecurringPence: number;
  /** Whether that value is healthy projected income, at risk, or excluded. */
  revenueState: "projected" | "at_risk" | "excluded";
  stripeStatus: string;
  grantsAlphaWodAccess: boolean;
  appAccessTier?: "none" | "limited" | "full";
  conditioningBookingPolicy?: ConditioningBookingPolicy | null;
  entitlementClassSlots?: ConditioningSlotKey[];
  selectedConditioningSlots?: ConditioningSlotKey[];
  entitlementWeeklyBookingLimit?: number | null;
  entitlementTargetUid: string | null;
  participantFullName: string;
  participantFullNames?: string[];
  participantCount?: number;
  participantAge: number | null;
  participantAges?: number[];
  participantIsPayer: boolean;
  guardianFullName: string | null;
  currentPeriodEnd: number | null;
  cancelAt: number | null;
  disputeOpen: boolean;
  accessRevoked: boolean;
  providerContractStatus: "verified" | "manual_review" | null;
  providerContractError: string | null;
  pastDueSince: number | null;
  confirmationEmailStatus: string | null;
  confirmationEmailError: string | null;
  confirmationEmailProviderId: string | null;
  cancellationRequestStatus: CancellationRequestStatus | null;
  cancellationRequestKind?: CancellationRequestKind | null;
  cancellationReceipt?: (CancellationReceipt & {
    channel?: "membership_portal" | "support_email" | "staff_recorded";
  }) | null;
  refundReviewRequired?: boolean;
  cancellationRequestError: string | null;
  cancellationAcknowledgementStatus?: string | null;
  cancellationAcknowledgementError?: string | null;
  cancellationAcknowledgementProviderId?: string | null;
  entitlementProjectionStatus: "applied" | "manual_review" | null;
  entitlementProjectionError: string | null;
};

export type AdminMembershipSummaryBucket = {
  totalSubscriptions: number;
  openSubscriptions: number;
  openParticipants: number;
  currentSubscriptions: number;
  scheduledSubscriptions: number;
  paymentIssueSubscriptions: number;
  awaitingPaymentSubscriptions: number;
  endedSubscriptions: number;
  projectedMonthlyPence: number;
  atRiskMonthlyPence: number;
};

export type AdminMembershipPlanSummary = AdminMembershipSummaryBucket & {
  planKey: PlanKey;
  planName: string;
};

export type AdminMembershipSummary = AdminMembershipSummaryBucket & {
  asOf: string;
  plans: AdminMembershipPlanSummary[];
  isComplete: boolean;
  reportingLimit: number;
};

export type AdminCheckoutIssue = {
  intentId: string;
  planKey: PlanKey;
  planName: string;
  conditioningBookingPolicy?: ConditioningBookingPolicy | null;
  entitlementClassSlots?: ConditioningSlotKey[];
  entitlementWeeklyBookingLimit?: number | null;
  participantFullNames: string[];
  participantCount: number;
  payerUid: string | null;
  payerEmail: string | null;
  status: "reserved" | "created" | "payment_pending" | "release_claimed";
  createdAt: number | null;
  checkoutExpiresAt: number;
  canRelease: boolean;
};

export type CheckoutRecoveryEmailStatus =
  | "queued"
  | "already_queued"
  | "manual_review"
  | "not_applicable";

export type ReleaseAbandonedMembershipCheckoutResult = {
  ok: boolean;
  intentId: string;
  outcome: "released" | "already_released";
  recoveryEmailStatus: CheckoutRecoveryEmailStatus;
  /** Masked by the server; never contains the full recipient address. */
  recoveryEmailRecipient: string | null;
};

type ReleaseAbandonedMembershipCheckoutResponse = Omit<
  ReleaseAbandonedMembershipCheckoutResult,
  "recoveryEmailStatus" | "recoveryEmailRecipient"
> & {
  /** Absent on older deployments that released checkouts without email recovery. */
  recoveryEmailStatus?: unknown;
  recoveryEmailRecipient?: unknown;
};

function isCheckoutRecoveryEmailStatus(
  value: unknown
): value is CheckoutRecoveryEmailStatus {
  return value === "queued" || value === "already_queued" ||
    value === "manual_review" || value === "not_applicable";
}

export async function listMemberships() {
  const invoke = httpsCallable<Record<string, never>, {
    ok: boolean;
    memberships: AdminMembership[];
    summary: AdminMembershipSummary;
    checkoutIssues: AdminCheckoutIssue[];
  }>(functions, "listMemberships");

  const result = await invoke({});
  return result.data;
}

export async function releaseAbandonedMembershipCheckout(
  intentId: string
): Promise<ReleaseAbandonedMembershipCheckoutResult> {
  const invoke = httpsCallable<
    {intentId: string},
    ReleaseAbandonedMembershipCheckoutResponse
  >(functions, "releaseAbandonedMembershipCheckout");

  const result = await invoke({intentId});
  const recoveryEmailRecipient = typeof result.data.recoveryEmailRecipient ===
      "string" && result.data.recoveryEmailRecipient.trim() ?
    result.data.recoveryEmailRecipient.trim() : null;
  return {
    ...result.data,
    recoveryEmailStatus: isCheckoutRecoveryEmailStatus(
      result.data.recoveryEmailStatus
    ) ? result.data.recoveryEmailStatus : "not_applicable",
    recoveryEmailRecipient,
  } satisfies ReleaseAbandonedMembershipCheckoutResult;
}

export async function linkMembershipParticipant(
  subscriptionId: string,
  participantUid: string
) {
  const invoke = httpsCallable<
    {subscriptionId: string; participantUid: string},
    {ok: boolean}
  >(functions, "linkMembershipParticipant");

  const result = await invoke({ subscriptionId, participantUid });
  return result.data;
}

/** Human labels for the membership states shown to members and admins. */
export const MEMBERSHIP_STATE_LABEL: Record<MembershipState, string> = {
  incomplete: "Awaiting payment",
  scheduled: "Scheduled — starts 1 September",
  active: "Active",
  past_due_grace: "Payment failed — in grace period",
  past_due_suspended: "Suspended — payment overdue",
  disputed: "Suspended — payment disputed",
  cancelled: "Cancelled",
  revoked: "Revoked",
};

export function formatIsoDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatUnixDate(seconds: number | null): string {
  if (!seconds) return "—";
  return new Date(seconds * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  });
}
