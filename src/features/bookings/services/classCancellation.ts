import { getFunctions, httpsCallable } from "firebase/functions";

export type ClassCancellationState =
  | "processing"
  | "awaiting_payg_refunds"
  | "ready_to_finalize"
  | "cancelled";

export type ClassCancellationOperation = {
  id: string;
  classId: string;
  state: ClassCancellationState;
  bookingOpen: false;
  memberBookingsReleased: number;
  activeMemberBookingsRemaining: number;
  paidPaygGuestCount: number;
  refundedPaygGuestCount: number;
  unresolvedPaygGuestCount: number;
  activeBookingCount: number;
  unpaidHoldCount: number;
};

export type ClassCancellationPaygGuest = {
  orderId: string;
  bookingId: string | null;
  paymentIntentId: string | null;
  chargeId: string | null;
  refundId: string | null;
  orderStatus: string;
  refundStatus: string | null;
  amountPence: number;
  currency: string;
  confirmationSuppressed: boolean;
  confirmationResolved: boolean;
  confirmationDisposition:
    | "suppressed_before_send"
    | "accepted_before_change"
    | "accepted_after_change_corrected"
    | "accepted_after_change_unresolved"
    | "ambiguous";
};

export type ClassCancellationBlockers = {
  activeBookingCount: number;
  activeMemberBookingCount: number;
  activePaygBookingCount: number;
  malformedActiveBookingCount: number;
  bookedCount: number | null;
  unpaidHoldCount: number | null;
  activePaygIntentIds: string[];
  unreleasedPaygIntentIds: string[];
  activePaygLockIds: string[];
  unresolvedPaymentReviewIds: string[];
  unresolvedPaygOrderIds: string[];
  unboundPaygOrderIds: string[];
  unresolvedConfirmationOrderIds: string[];
  malformedPaygOrderIds: string[];
};

export type ClassCancellationResult = {
  ok: true;
  alreadyFinalized: boolean;
  operation: ClassCancellationOperation;
  paygGuests: ClassCancellationPaygGuest[];
};

type ClassCancellationRequest = { classId: string };

async function callClassCancellation(
  callableName: "beginClassCancellation" | "finalizeClassCancellation",
  request: ClassCancellationRequest
) {
  const invoke = httpsCallable<ClassCancellationRequest, ClassCancellationResult>(
    getFunctions(undefined, "europe-west1"),
    callableName
  );
  const response = await invoke(request);
  return response.data;
}

export function beginClassCancellation(request: ClassCancellationRequest) {
  return callClassCancellation("beginClassCancellation", request);
}

export function finalizeClassCancellation(request: ClassCancellationRequest) {
  return callClassCancellation("finalizeClassCancellation", request);
}
