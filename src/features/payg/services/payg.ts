import { getFunctions, httpsCallable } from "firebase/functions";
import app from "../../../firebaseApp";

const functions = getFunctions(app, "europe-west1");

export type PaygClass = {
  classId: string;
  title: string;
  startTime: string;
  endTime: string;
  timezone: string;
  coachName: string | null;
  location: string | null;
  spacesRemaining: number;
  availability: "available" | "full" | "unavailable";
};

export type PaygLegalDocument = {
  version: string;
  publicUrl: string;
};

export type PaygLegalRelease = {
  waiver: PaygLegalDocument;
  terms: PaygLegalDocument;
};

export type PublicPaygSchedule = {
  ok: true;
  available: boolean;
  checkoutAvailable: boolean;
  offering: {
    key: "adult_payg_class";
    displayName: "Adult Pay as You Go Class";
    amountPence: 750;
    currency: "gbp";
    cancellationCutoffHours: 24;
  };
  legal: PaygLegalRelease | null;
  classes: PaygClass[];
};

export type CreatePaygCheckoutRequest = {
  checkoutSchemaVersion: 1;
  checkoutAttemptId: string;
  classId: string;
  attendee: {
    fullName: string;
    dateOfBirth: string;
  };
  contact: {
    email: string;
    phone: string;
  };
  acceptances: {
    adultConfirmed: true;
    waiverAccepted: true;
    termsAccepted: true;
    cancellationPolicyAccepted: true;
    waiverVersion: string;
    termsVersion: string;
  };
};

export type PaygClassReceipt = Pick<
  PaygClass,
  "classId" | "title" | "startTime" | "endTime" | "timezone" | "location"
>;

export type CreatePaygCheckoutResult = {
  ok: true;
  disposition: "created" | "resumed";
  sessionUrl: string;
  sessionId: string;
  holdExpiresAt: string;
  class: PaygClassReceipt;
};

export type PaygOrderState =
  | "confirmed"
  | "cancelled"
  | "refund_pending"
  | "refunded"
  | "disputed"
  | "no_show";

export type PaygCheckoutStatus =
  | { ok: true; state: "processing" }
  | {
      ok: true;
      state: PaygOrderState;
      order: {
        reference: string;
        attendeeName: string;
        amountPence: number;
        currency: "gbp";
        class: PaygClassReceipt;
        cancellationCutoffAt: string;
      };
      cancellation: {
        token: string;
        refundEligible: boolean;
        refundDeadline: string;
      };
    }
  | {
      ok: true;
      state: "refund_pending" | "refunded" | "disputed";
      review: {
        reference: string;
        supportRequired: boolean;
      };
    };

export type PaygCancellationPreview = {
  ok: true;
  currentOrderState: PaygOrderState;
  class: PaygClassReceipt;
  cancellationCutoffAt: string;
  refundEligibleNow: boolean;
};

export type PaygCancellationResult = {
  ok: true;
  outcome: "refund_pending" | "cancelled_non_refundable" | "already_cancelled";
  refundEligible: boolean;
  capacityReleased: boolean;
};

export async function getPublicPaygSchedule() {
  const invoke = httpsCallable<Record<string, never>, PublicPaygSchedule>(
    functions,
    "getPublicPaygSchedule"
  );
  const result = await invoke({});
  return result.data;
}

export async function createPaygCheckoutSession(
  request: CreatePaygCheckoutRequest
) {
  const invoke = httpsCallable<CreatePaygCheckoutRequest, CreatePaygCheckoutResult>(
    functions,
    "createPaygCheckoutSession",
    { limitedUseAppCheckTokens: true }
  );
  const result = await invoke(request);
  return result.data;
}

export async function getPaygCheckoutStatus(sessionId: string) {
  const invoke = httpsCallable<{ sessionId: string }, PaygCheckoutStatus>(
    functions,
    "getPaygCheckoutStatus"
  );
  const result = await invoke({ sessionId });
  return result.data;
}

export async function getPaygCancellationPreview(token: string) {
  const invoke = httpsCallable<{ token: string }, PaygCancellationPreview>(
    functions,
    "getPaygCancellationPreview",
    { limitedUseAppCheckTokens: true }
  );
  const result = await invoke({ token });
  return result.data;
}

export async function requestPaygCancellation(token: string) {
  const invoke = httpsCallable<
    { token: string; confirm: true },
    PaygCancellationResult
  >(functions, "requestPaygCancellation", { limitedUseAppCheckTokens: true });
  const result = await invoke({ token, confirm: true });
  return result.data;
}

export function createPaygCheckoutAttemptId() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  if (!cryptoApi?.getRandomValues) {
    throw new Error("Secure checkout identifiers are unavailable in this browser.");
  }
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
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

export function paygErrorMessage(error: unknown) {
  const reason = (error as { details?: { reason?: unknown } } | null)?.details?.reason;
  switch (reason) {
    case "payg_unavailable":
    case "payg_legal_unavailable":
      return "Pay As You Go checkout is not open yet.";
    case "stale_legal_terms":
      return "The terms changed while this page was open. Refresh and review them again.";
    case "class_unavailable":
      return "That class is no longer available. Choose another session.";
    case "class_full":
      return "That class has just filled. Choose another session.";
    case "checkout_processing":
      return "Your checkout is still being prepared. Please try again in a moment.";
    default:
      return error instanceof Error && error.message
        ? error.message
        : "Something went wrong. Please try again.";
  }
}
