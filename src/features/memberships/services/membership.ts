import { getFunctions, httpsCallable } from "firebase/functions";
import app from "../../../firebaseApp";
import type { PlanKey } from "../../../lib/membershipPlans";

const functions = getFunctions(app, "europe-west1");

export type MembershipState =
  | "incomplete"
  | "active"
  | "past_due_grace"
  | "past_due_suspended"
  | "disputed"
  | "cancelled"
  | "revoked";

export type CancellationOutcome = {
  nextBillingDate: string;
  noticeDeadlineMet: boolean;
  noticeDaysGiven: number;
  noticeDeadlineDate: string;
  finalPaymentDate: string | null;
  accessEndsOnDate: string;
  cancelAtUnixSeconds: number;
};

export type MyMembership = {
  subscriptionId: string;
  planKey: PlanKey;
  planName: string;
  state: MembershipState;
  grantsAlphaWodAccess: boolean;
  participantFullName: string;
  participantIsPayer: boolean;
  currentPeriodEnd: number | null;
  cancelAt: number | null;
  cancellationOutcome: CancellationOutcome | null;
};

export type CheckoutRequest = {
  planKey: PlanKey;
  participantFullName: string;
  participantDateOfBirth: string;
  participantIsPayer: boolean;
  signedName: string;
  acceptedDocuments: boolean;
  immediatePerformanceRequested: boolean;
  guardianFullName?: string;
  guardianRelationship?: string;
  guardianConfirmsAuthority?: boolean;
};

export async function createMembershipCheckoutSession(request: CheckoutRequest) {
  const invoke = httpsCallable<CheckoutRequest, {
    ok: boolean;
    sessionUrl: string | null;
    sessionId: string;
    firstFullChargeDate: string;
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

export async function createCustomerPortalSession() {
  const invoke = httpsCallable<Record<string, never>, {ok: boolean; portalUrl: string}>(
    functions,
    "createCustomerPortalSession"
  );

  const result = await invoke({});
  return result.data;
}

export async function requestMembershipCancellation(subscriptionId: string) {
  const invoke = httpsCallable<{subscriptionId: string}, {
    ok: boolean;
    outcome: CancellationOutcome;
  }>(functions, "requestMembershipCancellation");

  const result = await invoke({ subscriptionId });
  return result.data;
}

export async function claimMembership(sessionId?: string) {
  const invoke = httpsCallable<{sessionId?: string}, {ok: boolean; claimed: string[]}>(
    functions,
    "claimMembership"
  );

  const result = await invoke(sessionId ? { sessionId } : {});
  return result.data;
}

/**
 * A membership is bought before the buyer has an account, so the checkout
 * session id is held locally until they sign up or sign in and can claim it.
 */
const PENDING_CLAIM_KEY = "zaf.pendingMembershipClaim";

export function rememberPendingClaim(sessionId: string): void {
  try {
    window.localStorage.setItem(PENDING_CLAIM_KEY, sessionId);
  } catch {
    // Private browsing can refuse storage; the verified-email claim still works.
  }
}

export function readPendingClaim(): string | null {
  try {
    return window.localStorage.getItem(PENDING_CLAIM_KEY);
  } catch {
    return null;
  }
}

export function clearPendingClaim(): void {
  try {
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
  pastDueSince: number | null;
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
