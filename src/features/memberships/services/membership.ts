import { getFunctions, httpsCallable } from "firebase/functions";
import app from "../../../firebaseApp";
import {
  CHECKOUT_DOCUMENTS,
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
  promotionCodeId: string;
  amountOffPence: number;
  currency: "gbp";
  durationInMonths: number;
  startsAt: number;
  endsAt: number | null;
};

export type MembershipPaymentSchedule = {
  amountDueTodayPence: number | null;
  firstPaymentAt: number;
  standardMonthlyPence: number;
  discountedMonthlyPence: number | null;
  discountedPaymentCount: number;
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

export type CancellationRequestStatus = "pending" | "applied" | "manual_review";

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
  participantFullName: string;
  participantIsPayer: boolean;
  currentPeriodEnd: number | null;
  cancelAt: number | null;
  cancellationOutcome: CancellationOutcome | null;
  cancellationMode?: "cancel_before_start" | "standard";
  cancellationPreview?: CancellationOutcome | null;
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
  participantIsPayer: boolean;
  signedName: string;
  acceptedDocuments: boolean;
  immediatePerformanceRequested: boolean;
  /** Optional shared campaign code. Included in the digest, never stored as plaintext. */
  promotionCode?: string;
  guardianFullName?: string;
  guardianRelationship?: string;
  guardianConfirmsAuthority?: boolean;
};

export type CheckoutDetails = Omit<CheckoutRequest, "checkoutAttemptId">;
export type CheckoutAttempt = {id: string; fingerprint: string};
export type CheckoutAttemptContext = {payerUid: string | null};

const CHECKOUT_ATTEMPT_KEY = "zaf.membershipCheckoutAttempt.v1";

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
      documents: CHECKOUT_DOCUMENTS,
    }))
  );
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0")
  ).join("");
}

/**
 * Reuses one opaque attempt across retries and page reloads without storing
 * names, dates of birth, signatures, or other checkout details in the browser.
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

  try {
    const saved = JSON.parse(
      window.sessionStorage.getItem(CHECKOUT_ATTEMPT_KEY) || "null"
    ) as Partial<CheckoutAttempt> | null;
    if (saved?.fingerprint === fingerprint && isCheckoutAttemptId(saved.id)) {
      return {id: saved.id, fingerprint};
    }
  } catch {
    // A same-page retry still reuses `current` when storage is unavailable.
  }

  const attempt = {id: createCheckoutAttemptId(), fingerprint};
  try {
    window.sessionStorage.setItem(CHECKOUT_ATTEMPT_KEY, JSON.stringify(attempt));
  } catch {
    // Private browsing can deny storage; the in-memory attempt remains safe.
  }
  return attempt;
}

export function clearCheckoutAttempt(attemptId?: string): void {
  try {
    if (attemptId) {
      const saved = JSON.parse(
        window.sessionStorage.getItem(CHECKOUT_ATTEMPT_KEY) || "null"
      ) as Partial<CheckoutAttempt> | null;
      if (saved?.id !== attemptId) return;
    }
    window.sessionStorage.removeItem(CHECKOUT_ATTEMPT_KEY);
  } catch {
    // Nothing to clear when browser storage is unavailable.
  }
}

/** Returns the browser-held verifier for the checkout that just redirected. */
export function readCheckoutAttemptId(): string | null {
  try {
    const saved = JSON.parse(
      window.sessionStorage.getItem(CHECKOUT_ATTEMPT_KEY) || "null"
    ) as Partial<CheckoutAttempt> | null;
    const attemptId = saved?.id;
    return isCheckoutAttemptId(attemptId) ? attemptId : null;
  } catch {
    return null;
  }
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
  }>(functions, "createMembershipCheckoutSession");

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
  expectedCancelAtUnixSeconds: number
) {
  const invoke = httpsCallable<{
    subscriptionId: string;
    expectedCancelAtUnixSeconds: number;
  }, {
    ok: boolean;
    outcome: CancellationOutcome;
  }>(functions, "requestMembershipCancellation");

  const result = await invoke({subscriptionId, expectedCancelAtUnixSeconds});
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
  payerUid: string;
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
  stripeStatus: string;
  grantsAlphaWodAccess: boolean;
  entitlementTargetUid: string | null;
  participantFullName: string;
  participantAge: number | null;
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
  cancellationRequestError: string | null;
  entitlementProjectionStatus: "applied" | "manual_review" | null;
  entitlementProjectionError: string | null;
};

export async function listMemberships() {
  const invoke = httpsCallable<Record<string, never>, {
    ok: boolean;
    memberships: AdminMembership[];
  }>(functions, "listMemberships");

  const result = await invoke({});
  return result.data;
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
