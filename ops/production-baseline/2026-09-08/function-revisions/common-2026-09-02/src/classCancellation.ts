/* eslint-disable require-jsdoc, max-len */

import {createHash} from "crypto";
import * as admin from "firebase-admin";
import {
  DocumentReference,
  DocumentSnapshot,
  FieldValue,
  Firestore,
  QueryDocumentSnapshot,
  Transaction,
} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import {
  applyConditioningQuotaRelease,
  prepareConditioningQuotaRelease,
} from "./conditioningQuota";
import {
  PAYG_AMOUNT_PENCE,
  PAYG_CURRENCY,
  PAYG_DUPLICATE_LOCK_COLLECTION,
  PAYG_PAYMENT_REVIEW_COLLECTION,
  PAYG_WORKER_SECRETS,
  initiatePaygOrderRefundForClassCancellation,
  paygConfirmationCorrectionOutboxId,
  paygRefundOutboxId,
  reconcilePaygCheckoutForClassCancellation,
  suppressPaygConfirmationForClassCancellation,
} from "./payg";

export const CLASS_CANCELLATION_AUDIT_COLLECTION =
  "classCancellationOperations";
export const CLASS_CANCELLATION_AUDIT_SCHEMA_VERSION = 1;

type AdminGuard = (request: {
  auth?: {uid?: string; token?: Record<string, unknown>} | null;
}) => Promise<void>;

type CancellationState =
  | "processing"
  | "awaiting_payg_refunds"
  | "ready_to_finalize"
  | "cancelled";

type PaygGuestReference = Readonly<{
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
}>;

type CancellationBlockers = Readonly<{
  activeBookingCount: number;
  activeMemberBookingCount: number;
  activePaygBookingCount: number;
  malformedActiveBookingCount: number;
  bookedCount: number | null;
  unpaidHoldCount: number | null;
  activePaygIntentIds: readonly string[];
  unreleasedPaygIntentIds: readonly string[];
  activePaygLockIds: readonly string[];
  unresolvedPaymentReviewIds: readonly string[];
  unresolvedPaygOrderIds: readonly string[];
  unresolvedConfirmationOrderIds: readonly string[];
  malformedPaygOrderIds: readonly string[];
  unboundPaygOrderIds: readonly string[];
}>;

type CancellationAssessment = Readonly<{
  classId: string;
  classStatus: string;
  bookingOpen: boolean;
  operationId: string;
  operationState: CancellationState;
  memberBookingsReleased: number;
  activeMemberBookingsRemaining: number;
  paidPaygGuestCount: number;
  refundedPaygGuestCount: number;
  unresolvedPaygGuestCount: number;
  activeBookingCount: number;
  unpaidHoldCount: number;
  ready: boolean;
  paygGuests: readonly PaygGuestReference[];
  blockers: CancellationBlockers;
}>;

type CancellationDocuments = Readonly<{
  classSnapshot: DocumentSnapshot;
  auditSnapshot: DocumentSnapshot;
  bookings: readonly QueryDocumentSnapshot[];
  orders: readonly QueryDocumentSnapshot[];
  intents: readonly QueryDocumentSnapshot[];
  reviews: readonly QueryDocumentSnapshot[];
  outboxes: readonly DocumentSnapshot[];
  locks: readonly DocumentSnapshot[];
}>;

const CLASS_CANCELLATION_CALLABLE_OPTIONS = {
  region: "europe-west1",
  secrets: PAYG_WORKER_SECRETS,
  enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true",
  consumeAppCheckToken: process.env.FUNCTIONS_EMULATOR !== "true",
  timeoutSeconds: 540,
} as const;

function firestore(): Firestore {
  return admin.firestore();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function classCancellationOperationId(classId: string): string {
  return `class_cancel_${sha256(`class-cancellation:v1:${classId}`)}`;
}

function requireClassId(value: unknown): string {
  const classId = typeof value === "string" ? value.trim() : "";
  if (!classId || classId.length > 512 || classId.includes("/") ||
    classId === "." || classId === "..") {
    throw new HttpsError("invalid-argument", "A valid classId is required.");
  }
  return classId;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function timestampMillis(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const toMillis = (value as {toMillis?: unknown}).toMillis;
  if (typeof toMillis !== "function") return null;
  const millis = toMillis.call(value);
  return Number.isSafeInteger(millis) && millis > 0 ? millis : null;
}

function validAuditBinding(
  value: Record<string, unknown>,
  classId: string,
  operationId: string
): boolean {
  const releasedCount = numberOrNull(value.memberBookingsReleased);
  const releasedHashes = Array.isArray(value.memberBookingIdHashes) ?
    value.memberBookingIdHashes : null;
  const uniqueHashes = releasedHashes ? new Set(releasedHashes) : null;
  return value.schemaVersion === CLASS_CANCELLATION_AUDIT_SCHEMA_VERSION &&
    value.operationId === operationId && value.classId === classId &&
    ["processing", "awaiting_payg_refunds", "ready_to_finalize", "cancelled"]
      .includes(String(value.state)) &&
    typeof value.initiatedBy === "string" && value.initiatedBy.length > 0 &&
    timestampMillis(value.initiatedAt) !== null &&
    timestampMillis(value.bookingStoppedAt) !== null &&
    releasedCount !== null && releasedHashes !== null &&
    releasedHashes.length === releasedCount &&
    uniqueHashes?.size === releasedHashes.length &&
    releasedHashes.every((hash) =>
      typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash)
    );
}

function isPaygOrderId(value: unknown): value is string {
  return typeof value === "string" && /^payg_[a-f0-9]{64}$/.test(value);
}

function isPaygGuestBooking(value: Record<string, unknown>): boolean {
  return value.bookingKind === "payg_guest" &&
    value.isGuestBooking === true && isPaygOrderId(value.paygOrderId);
}

function looksLikePaygGuestBooking(value: Record<string, unknown>): boolean {
  return value.bookingKind === "payg_guest" ||
    value.isGuestBooking === true || value.paygOrderId !== undefined;
}

function refundIsFullyReconciled(value: Record<string, unknown>): boolean {
  const amount = numberOrNull(value.amountPence);
  return value.status === "refunded" &&
    value.capacityState === "released" &&
    value.refundStatus === "succeeded" &&
    typeof value.refundId === "string" && /^re_[A-Za-z0-9_]{4,252}$/.test(value.refundId) &&
    amount === PAYG_AMOUNT_PENCE && value.currency === PAYG_CURRENCY &&
    value.refundedAmountPence === amount;
}

function paymentReviewIsReconciled(value: Record<string, unknown>): boolean {
  const amount = numberOrNull(value.providerAmountReceivedPence);
  return amount !== null && amount > 0 && value.status === "refunded" &&
    value.refundStatus === "succeeded" &&
    typeof value.paymentIntentId === "string" &&
    /^pi_[A-Za-z0-9_]{4,252}$/.test(value.paymentIntentId) &&
    typeof value.checkoutSessionId === "string" &&
    /^cs_[A-Za-z0-9_]{4,252}$/.test(value.checkoutSessionId) &&
    typeof value.refundId === "string" && /^re_[A-Za-z0-9_]{4,252}$/.test(value.refundId) &&
    value.providerCurrency === PAYG_CURRENCY &&
    value.refundedAmountPence === amount;
}

function providerTerminalNonpaymentIsExact(
  value: Record<string, unknown>,
  operationId: string
): boolean {
  if (value.classCancellationOperationId !== operationId ||
    value.classCancellationProviderObservationVersion !== 1 ||
    value.classCancellationProviderTerminalNonpayment !== true) return false;
  const sessionId = stringOrNull(value.checkoutSessionId);
  const observedSessionId = stringOrNull(
    value.classCancellationProviderSessionId
  );
  if (sessionId !== observedSessionId) return false;
  const disposition = value.classCancellationProviderDisposition;
  if (!sessionId) {
    return disposition === "provider_create_definitively_failed" &&
      (value.status === "failed" &&
        value.releaseReason === "checkout_create_failed" ||
        value.releaseReason === "recovery_confirmed_no_session") &&
      value.capacityState === "released" &&
      value.unpaidHoldState === "released" &&
      timestampMillis(value.releasedAt) !== null;
  }
  if (disposition === "session_expired") {
    return value.classCancellationProviderSessionStatus === "expired" &&
      value.classCancellationProviderPaymentStatus === "unpaid";
  }
  return disposition === "payment_intent_canceled" &&
    value.classCancellationProviderSessionStatus === "complete" &&
    value.classCancellationProviderPaymentStatus === "unpaid" &&
    value.classCancellationProviderPaymentIntentStatus === "canceled" &&
    stringOrNull(value.paymentIntentId) === stringOrNull(
      value.classCancellationProviderPaymentIntentId
    );
}

function paymentReviewMatchesTerminalNonpayment(
  review: Record<string, unknown>,
  intentId: string,
  intent: Record<string, unknown>,
  operationId: string
): boolean {
  if (!providerTerminalNonpaymentIsExact(intent, operationId) ||
    intent.classCancellationProviderDisposition !== "payment_intent_canceled") {
    return false;
  }
  const amount = numberOrNull(review.providerAmountReceivedPence);
  return review.intentId === intentId &&
    review.checkoutSessionId === intent.classCancellationProviderSessionId &&
    review.paymentIntentId ===
      intent.classCancellationProviderPaymentIntentId &&
    amount === 0 && review.providerCurrency === PAYG_CURRENCY;
}

function paymentReviewMatchesObservedProvider(
  review: Record<string, unknown>,
  intentId: string,
  intent: Record<string, unknown>
): boolean {
  return review.intentId === intentId &&
    review.checkoutSessionId === intent.classCancellationProviderSessionId &&
    review.paymentIntentId ===
      intent.classCancellationProviderPaymentIntentId;
}

function correctiveCommunicationDelivered(
  order: QueryDocumentSnapshot,
  outboxById: ReadonlyMap<string, DocumentSnapshot>
): boolean {
  const lifecycleOutboxes = [
    outboxById.get(paygConfirmationCorrectionOutboxId(order.id)),
    outboxById.get(paygRefundOutboxId(order.id)),
  ];
  return lifecycleOutboxes.some((lifecycle) => lifecycle?.exists &&
    lifecycle.get("orderId") === order.id &&
    (lifecycle.get("kind") === "payg_guest_confirmation_correction" ||
      lifecycle.get("kind") === "payg_guest_refund_confirmation") &&
    (lifecycle.get("status") === "sent" ||
      (lifecycle.get("status") === "tombstoned" &&
        lifecycle.get("providerAcceptanceState") === "accepted")) &&
    typeof lifecycle.get("providerMessageId") === "string");
}

function confirmationResolution(
  order: QueryDocumentSnapshot,
  outboxById: ReadonlyMap<string, DocumentSnapshot>
): Pick<PaygGuestReference,
  "confirmationSuppressed" | "confirmationResolved" |
  "confirmationDisposition"> {
  const result = (
    confirmationSuppressed: boolean,
    confirmationResolved: boolean,
    confirmationDisposition: PaygGuestReference["confirmationDisposition"]
  ) => Object.freeze({
    confirmationSuppressed,
    confirmationResolved,
    confirmationDisposition,
  });
  const outbox = outboxById.get(order.id);
  if (order.get("confirmationEmailStatus") !== "not_required") {
    return result(false, false, "ambiguous");
  }
  if (!outbox?.exists) return result(true, true, "suppressed_before_send");
  const acceptance = stringOrNull(outbox.get("providerAcceptanceState"));
  const hasUnresolvedCorrelation =
    acceptance === "unknown_in_flight" ||
    acceptance === "unknown_at_privacy_deadline" ||
    acceptance === "manual_review" ||
    typeof outbox.get("tombstonedLeaseCorrelation") === "string" ||
    typeof outbox.get("ambiguousLeaseCorrelation") === "string" ||
    outbox.get("reconcileAfterStateChange") === true;
  if (hasUnresolvedCorrelation) return result(false, false, "ambiguous");
  if (acceptance === "accepted_after_state_change") {
    const corrected = correctiveCommunicationDelivered(order, outboxById);
    return result(
      false,
      corrected,
      corrected ? "accepted_after_change_corrected" :
        "accepted_after_change_unresolved"
    );
  }
  if (outbox.get("status") === "sent" && acceptance === "accepted") {
    return result(
      false,
      correctiveCommunicationDelivered(order, outboxById),
      "accepted_before_change"
    );
  }
  if (outbox.get("status") !== "tombstoned") {
    return result(false, false, "ambiguous");
  }
  if (acceptance === "not_sent" || acceptance === "rejected" ||
    acceptance === "rejected_after_state_change") {
    return result(true, true, "suppressed_before_send");
  }
  if (acceptance === "accepted_before_state_change" || acceptance === "accepted") {
    return result(
      false,
      correctiveCommunicationDelivered(order, outboxById),
      "accepted_before_change"
    );
  }
  return result(false, false, "ambiguous");
}

function paygGuestReference(
  order: QueryDocumentSnapshot,
  outboxById: ReadonlyMap<string, DocumentSnapshot>
): PaygGuestReference {
  const amountPence = numberOrNull(order.get("amountPence")) ?? 0;
  const confirmation = confirmationResolution(order, outboxById);
  return Object.freeze({
    orderId: order.id,
    bookingId: stringOrNull(order.get("bookingId")),
    paymentIntentId: stringOrNull(order.get("paymentIntentId")),
    chargeId: stringOrNull(order.get("chargeId")),
    refundId: stringOrNull(order.get("refundId")),
    orderStatus: stringOrNull(order.get("status")) ?? "unknown",
    refundStatus: stringOrNull(order.get("refundStatus")),
    amountPence,
    currency: stringOrNull(order.get("currency")) ?? "",
    ...confirmation,
  });
}

function currentOperationState(
  classStatus: string,
  ready: boolean,
  unresolvedPaygGuestCount: number,
  activePaygIntentCount: number,
  unresolvedPaymentReviewCount: number
): CancellationState {
  if (classStatus === "cancelled") return "cancelled";
  if (ready) return "ready_to_finalize";
  if (unresolvedPaygGuestCount > 0 || unresolvedPaymentReviewCount > 0) {
    return "awaiting_payg_refunds";
  }
  return activePaygIntentCount > 0 ? "processing" : "processing";
}

function assessCancellationDocuments(
  classId: string,
  operationId: string,
  documents: CancellationDocuments
): CancellationAssessment {
  const classValue = documents.classSnapshot.exists ?
    documents.classSnapshot.data() as Record<string, unknown> : {};
  const auditValue = documents.auditSnapshot.exists ?
    documents.auditSnapshot.data() as Record<string, unknown> : {};
  const activeBookings = documents.bookings.filter(
    (booking) => booking.get("status") === "booked"
  );
  const activeMemberBookings = activeBookings.filter((booking) => {
    const value = booking.data() as Record<string, unknown>;
    return !looksLikePaygGuestBooking(value);
  });
  const activePaygBookings = activeBookings.filter((booking) =>
    isPaygGuestBooking(booking.data() as Record<string, unknown>)
  );
  const malformedActiveBookings = activeBookings.filter((booking) => {
    const value = booking.data() as Record<string, unknown>;
    return looksLikePaygGuestBooking(value) && !isPaygGuestBooking(value);
  });
  const outboxById = new Map(
    documents.outboxes.map((outbox) => [outbox.id, outbox] as const)
  );
  const paygGuests = documents.orders
    .map((order) => paygGuestReference(order, outboxById))
    .sort((left, right) => left.orderId.localeCompare(right.orderId));
  const malformedPaygOrderIds = documents.orders.filter((order) => {
    const value = order.data() as Record<string, unknown>;
    return !isPaygOrderId(order.id) || value.orderId !== order.id ||
      value.purchaseKind !== "payg_class" ||
      value.offeringKey !== "adult_payg_class" ||
      value.class === null || typeof value.class !== "object" ||
      (value.class as Record<string, unknown>).classId !== classId ||
      value.amountPence !== PAYG_AMOUNT_PENCE || value.currency !== PAYG_CURRENCY ||
      typeof value.paymentIntentId !== "string" ||
      !/^pi_[A-Za-z0-9_]{4,252}$/.test(value.paymentIntentId);
  }).map((order) => order.id).sort();
  const unboundPaygOrderIds = documents.orders.filter((order) =>
    order.get("classCancellationOperationId") !== operationId ||
    timestampMillis(order.get("classCancellationRequestedAt")) === null
  ).map((order) => order.id).sort();
  const unresolvedPaygOrderIds = documents.orders.filter((order) =>
    !refundIsFullyReconciled(order.data() as Record<string, unknown>)
  ).map((order) => order.id).sort();
  const unresolvedConfirmationOrderIds = documents.orders.filter((order) =>
    !confirmationResolution(order, outboxById).confirmationResolved
  ).map((order) => order.id).sort();
  const orderIds = new Set(documents.orders.map((order) => order.id));
  const intentById = new Map(
    documents.intents.map((intent) => [intent.id, intent] as const)
  );
  const reviewsByIntentId = new Map<string, QueryDocumentSnapshot[]>();
  for (const review of documents.reviews) {
    const intentId = stringOrNull(review.get("intentId"));
    if (!intentId) continue;
    const existing = reviewsByIntentId.get(intentId) ?? [];
    existing.push(review);
    reviewsByIntentId.set(intentId, existing);
  }
  const unresolvedPaymentReviewIds = documents.reviews.filter((review) => {
    const value = review.data() as Record<string, unknown>;
    if (paymentReviewIsReconciled(value)) return false;
    const intentId = stringOrNull(value.intentId);
    const intent = intentId ? intentById.get(intentId) : null;
    return !intent || !paymentReviewMatchesTerminalNonpayment(
      value,
      intent.id,
      intent.data() as Record<string, unknown>,
      operationId
    );
  }).map((review) => review.id).sort();
  const activePaygIntentIds = documents.intents.filter((intent) => {
    const value = intent.data() as Record<string, unknown>;
    if (orderIds.has(intent.id)) return false;
    const reviews = reviewsByIntentId.get(intent.id) ?? [];
    if (reviews.length > 0 && reviews.every((review) => {
      const reviewValue = review.data() as Record<string, unknown>;
      return paymentReviewIsReconciled(reviewValue) &&
        paymentReviewMatchesObservedProvider(reviewValue, intent.id, value);
    })) {
      return false;
    }
    return !providerTerminalNonpaymentIsExact(value, operationId);
  }).map((intent) => intent.id).sort();
  const unreleasedPaygIntentIds = documents.intents.filter((intent) =>
    !orderIds.has(intent.id) &&
    (intent.get("capacityState") !== "released" ||
      intent.get("unpaidHoldState") !== "released")
  ).map((intent) => intent.id).sort();
  const activePaygLockIds = documents.locks.filter((lock) => lock.exists)
    .map((lock) => lock.id).sort();
  const bookedCount = numberOrNull(classValue.bookedCount);
  const unpaidHoldCount = numberOrNull(classValue.paygUnpaidHoldCount ?? 0);
  const blockers = Object.freeze({
    activeBookingCount: activeBookings.length,
    activeMemberBookingCount: activeMemberBookings.length,
    activePaygBookingCount: activePaygBookings.length,
    malformedActiveBookingCount: malformedActiveBookings.length,
    bookedCount,
    unpaidHoldCount,
    activePaygIntentIds: Object.freeze(activePaygIntentIds),
    unreleasedPaygIntentIds: Object.freeze(unreleasedPaygIntentIds),
    activePaygLockIds: Object.freeze(activePaygLockIds),
    unresolvedPaymentReviewIds: Object.freeze(unresolvedPaymentReviewIds),
    unresolvedPaygOrderIds: Object.freeze(unresolvedPaygOrderIds),
    unresolvedConfirmationOrderIds: Object.freeze(
      unresolvedConfirmationOrderIds
    ),
    malformedPaygOrderIds: Object.freeze(malformedPaygOrderIds),
    unboundPaygOrderIds: Object.freeze(unboundPaygOrderIds),
  });
  const ready = activeBookings.length === 0 && bookedCount === 0 &&
    unpaidHoldCount === 0 && activePaygIntentIds.length === 0 &&
    unreleasedPaygIntentIds.length === 0 && activePaygLockIds.length === 0 &&
    unresolvedPaymentReviewIds.length === 0 &&
    unresolvedPaygOrderIds.length === 0 &&
    unresolvedConfirmationOrderIds.length === 0 &&
    malformedPaygOrderIds.length === 0 && unboundPaygOrderIds.length === 0;
  const classStatus = stringOrNull(classValue.status) ?? "missing";
  const refundedPaygGuestCount = documents.orders.length -
    unresolvedPaygOrderIds.length;
  return Object.freeze({
    classId,
    classStatus,
    bookingOpen: classValue.bookingOpen !== false,
    operationId,
    operationState: currentOperationState(
      classStatus,
      ready,
      unresolvedPaygOrderIds.length,
      activePaygIntentIds.length,
      unresolvedPaymentReviewIds.length
    ),
    memberBookingsReleased: numberOrNull(auditValue.memberBookingsReleased) ?? 0,
    activeMemberBookingsRemaining: activeMemberBookings.length,
    paidPaygGuestCount: documents.orders.length,
    refundedPaygGuestCount,
    unresolvedPaygGuestCount: unresolvedPaygOrderIds.length,
    activeBookingCount: activeBookings.length,
    unpaidHoldCount: unpaidHoldCount ?? -1,
    ready,
    paygGuests: Object.freeze(paygGuests),
    blockers,
  });
}

function classQuery(firestore: Firestore, collection: string, classId: string) {
  return firestore.collection(collection).where("class.classId", "==", classId);
}

async function readReviewDocuments(
  source: Firestore | Transaction,
  firestore: Firestore,
  intents: readonly QueryDocumentSnapshot[]
): Promise<QueryDocumentSnapshot[]> {
  const snapshots = await Promise.all(intents.map((intent) => {
    const query = firestore.collection(PAYG_PAYMENT_REVIEW_COLLECTION)
      .where("intentId", "==", intent.id);
    return source instanceof Transaction ? source.get(query) : query.get();
  }));
  return snapshots.flatMap((snapshot) => snapshot.docs);
}

async function readCancellationDocuments(
  firestore: Firestore,
  classId: string,
  operationId: string
): Promise<CancellationDocuments> {
  const [classSnapshot, auditSnapshot, bookingSnapshot, orderSnapshot,
    intentSnapshot] = await Promise.all([
    firestore.collection("classes").doc(classId).get(),
    firestore.collection(CLASS_CANCELLATION_AUDIT_COLLECTION)
      .doc(operationId).get(),
    firestore.collection("bookings").where("classId", "==", classId).get(),
    classQuery(firestore, "paygOrders", classId).get(),
    classQuery(firestore, "paygIntents", classId).get(),
  ]);
  const outboxRefs = orderSnapshot.docs.flatMap((order) => [
    firestore.collection("paygEmailOutbox").doc(order.id),
    firestore.collection("paygEmailOutbox")
      .doc(paygConfirmationCorrectionOutboxId(order.id)),
    firestore.collection("paygEmailOutbox").doc(paygRefundOutboxId(order.id)),
  ]);
  const lockRefs = intentSnapshot.docs.flatMap((intent) => {
    const lockId = stringOrNull(intent.get("duplicateLockId"));
    return lockId && /^[a-f0-9]{64}$/.test(lockId) ? [
      firestore.collection(PAYG_DUPLICATE_LOCK_COLLECTION).doc(lockId),
    ] : [];
  });
  const [reviews, outboxes, locks] = await Promise.all([
    readReviewDocuments(firestore, firestore, intentSnapshot.docs),
    Promise.all(outboxRefs.map((ref) => ref.get())),
    Promise.all(lockRefs.map((ref) => ref.get())),
  ]);
  return {
    classSnapshot,
    auditSnapshot,
    bookings: bookingSnapshot.docs,
    orders: orderSnapshot.docs,
    intents: intentSnapshot.docs,
    reviews,
    outboxes,
    locks,
  };
}

async function readCancellationDocumentsInTransaction(
  tx: Transaction,
  firestore: Firestore,
  classId: string,
  operationId: string
): Promise<CancellationDocuments> {
  const [classSnapshot, auditSnapshot, bookingSnapshot, orderSnapshot,
    intentSnapshot] = await Promise.all([
    tx.get(firestore.collection("classes").doc(classId)),
    tx.get(firestore.collection(CLASS_CANCELLATION_AUDIT_COLLECTION)
      .doc(operationId)),
    tx.get(firestore.collection("bookings").where("classId", "==", classId)),
    tx.get(classQuery(firestore, "paygOrders", classId)),
    tx.get(classQuery(firestore, "paygIntents", classId)),
  ]);
  const reviews = await readReviewDocuments(tx, firestore, intentSnapshot.docs);
  const outboxRefs = orderSnapshot.docs.flatMap((order) => [
    firestore.collection("paygEmailOutbox").doc(order.id),
    firestore.collection("paygEmailOutbox")
      .doc(paygConfirmationCorrectionOutboxId(order.id)),
    firestore.collection("paygEmailOutbox").doc(paygRefundOutboxId(order.id)),
  ]);
  const lockRefs = intentSnapshot.docs.flatMap((intent) => {
    const lockId = stringOrNull(intent.get("duplicateLockId"));
    return lockId && /^[a-f0-9]{64}$/.test(lockId) ? [
      firestore.collection(PAYG_DUPLICATE_LOCK_COLLECTION).doc(lockId),
    ] : [];
  });
  const outboxes = outboxRefs.length > 0 ? await tx.getAll(...outboxRefs) : [];
  const locks = lockRefs.length > 0 ? await tx.getAll(...lockRefs) : [];
  return {
    classSnapshot,
    auditSnapshot,
    bookings: bookingSnapshot.docs,
    orders: orderSnapshot.docs,
    intents: intentSnapshot.docs,
    reviews,
    outboxes,
    locks,
  };
}

function safeAuditSnapshot(assessment: CancellationAssessment) {
  return {
    activeMemberBookingsRemaining: assessment.activeMemberBookingsRemaining,
    activeBookingCount: assessment.activeBookingCount,
    paidPaygGuestCount: assessment.paidPaygGuestCount,
    refundedPaygGuestCount: assessment.refundedPaygGuestCount,
    unresolvedPaygGuestCount: assessment.unresolvedPaygGuestCount,
    bookedCount: assessment.blockers.bookedCount,
    unpaidHoldCount: assessment.blockers.unpaidHoldCount,
    activePaygIntentIds: [...assessment.blockers.activePaygIntentIds],
    unreleasedPaygIntentIds: [
      ...assessment.blockers.unreleasedPaygIntentIds,
    ],
    activePaygLockIds: [...assessment.blockers.activePaygLockIds],
    unresolvedPaymentReviewIds: [
      ...assessment.blockers.unresolvedPaymentReviewIds,
    ],
    unresolvedPaygOrderIds: [...assessment.blockers.unresolvedPaygOrderIds],
    unresolvedConfirmationOrderIds: [
      ...assessment.blockers.unresolvedConfirmationOrderIds,
    ],
    malformedPaygOrderIds: [...assessment.blockers.malformedPaygOrderIds],
    unboundPaygOrderIds: [...assessment.blockers.unboundPaygOrderIds],
  };
}

function responseFor(
  assessment: CancellationAssessment,
  alreadyFinalized: boolean,
  stateOverride?: CancellationState
) {
  return {
    ok: true,
    alreadyFinalized,
    operation: {
      id: assessment.operationId,
      classId: assessment.classId,
      state: stateOverride ?? assessment.operationState,
      bookingOpen: false,
      memberBookingsReleased: assessment.memberBookingsReleased,
      activeMemberBookingsRemaining: assessment.activeMemberBookingsRemaining,
      paidPaygGuestCount: assessment.paidPaygGuestCount,
      refundedPaygGuestCount: assessment.refundedPaygGuestCount,
      unresolvedPaygGuestCount: assessment.unresolvedPaygGuestCount,
      activeBookingCount: assessment.activeBookingCount,
      unpaidHoldCount: assessment.unpaidHoldCount,
    },
    paygGuests: [...assessment.paygGuests],
  };
}

async function openOrResumeCancellation(
  firestore: Firestore,
  classId: string,
  operationId: string,
  actorUid: string
): Promise<{alreadyFinalized: boolean}> {
  const classRef = firestore.collection("classes").doc(classId);
  const auditRef = firestore.collection(CLASS_CANCELLATION_AUDIT_COLLECTION)
    .doc(operationId);
  return firestore.runTransaction(async (tx) => {
    const [classSnapshot, auditSnapshot] = await Promise.all([
      tx.get(classRef),
      tx.get(auditRef),
    ]);
    if (!classSnapshot.exists) {
      throw new HttpsError("not-found", "Class not found.");
    }
    const classValue = classSnapshot.data() as Record<string, unknown>;
    const auditValue = auditSnapshot.exists ?
      auditSnapshot.data() as Record<string, unknown> : null;
    if (auditValue && !validAuditBinding(auditValue, classId, operationId)) {
      throw new HttpsError(
        "failed-precondition",
        "The class cancellation audit binding is invalid.",
        {reason: "class_cancellation_audit_binding_invalid", operationId}
      );
    }
    if (classValue.status === "cancelled") {
      if (auditValue?.state === "cancelled" &&
        classValue.cancellationOperationId === operationId) {
        return {alreadyFinalized: true};
      }
      throw new HttpsError(
        "failed-precondition",
        "This class was cancelled outside the supported operation.",
        {reason: "class_cancellation_audit_missing", operationId}
      );
    }
    if (classValue.status !== "scheduled") {
      throw new HttpsError(
        "failed-precondition",
        "This class cannot begin cancellation.",
        {reason: "class_unavailable", operationId}
      );
    }
    const existingOperationId = stringOrNull(classValue.cancellationOperationId);
    if (existingOperationId && existingOperationId !== operationId) {
      throw new HttpsError(
        "failed-precondition",
        "Another cancellation operation owns this class.",
        {reason: "class_cancellation_operation_conflict", operationId}
      );
    }
    if (classValue.bookingOpen === false &&
      classValue.bookingClosedReason !== "class_cancellation") {
      throw new HttpsError(
        "failed-precondition",
        "This class is already closed for another operational reason.",
        {reason: "class_booking_already_closed", operationId}
      );
    }
    if (!auditValue && !existingOperationId) {
      const startMillis = timestampMillis(classValue.startTime);
      if (startMillis === null || startMillis <= Date.now()) {
        throw new HttpsError(
          "failed-precondition",
          "Whole-class cancellation must begin before the class starts.",
          {reason: "class_cancellation_already_started", operationId}
        );
      }
    } else if (!auditValue || existingOperationId !== operationId ||
      classValue.bookingClosedReason !== "class_cancellation" ||
      classValue.bookingOpen !== false ||
      timestampMillis(classValue.bookingClosedAt) === null ||
      typeof classValue.bookingClosedBy !== "string") {
      throw new HttpsError(
        "failed-precondition",
        "The class cancellation freeze binding is invalid.",
        {reason: "class_cancellation_audit_binding_invalid", operationId}
      );
    }
    tx.set(classRef, {
      bookingOpen: false,
      bookingClosedReason: "class_cancellation",
      cancellationOperationId: operationId,
      cancellationState: "processing",
      ...(existingOperationId ? {} : {
        bookingClosedAt: FieldValue.serverTimestamp(),
        bookingClosedBy: actorUid,
      }),
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    if (auditSnapshot.exists) {
      tx.set(auditRef, {
        state: auditValue?.state === "cancelled" ? "cancelled" : "processing",
        lastResumedAt: FieldValue.serverTimestamp(),
        lastResumedBy: actorUid,
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
    } else {
      tx.create(auditRef, {
        schemaVersion: CLASS_CANCELLATION_AUDIT_SCHEMA_VERSION,
        operationId,
        classId,
        state: "processing",
        initiatedAt: FieldValue.serverTimestamp(),
        initiatedBy: actorUid,
        bookingStoppedAt: FieldValue.serverTimestamp(),
        memberBookingsReleased: 0,
        memberBookingIdHashes: [],
        paygGuests: [],
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    return {alreadyFinalized: false};
  });
}

async function releaseMemberBooking(
  firestore: Firestore,
  classId: string,
  operationId: string,
  actorUid: string,
  bookingRef: DocumentReference
): Promise<boolean> {
  const classRef = firestore.collection("classes").doc(classId);
  const auditRef = firestore.collection(CLASS_CANCELLATION_AUDIT_COLLECTION)
    .doc(operationId);
  return firestore.runTransaction(async (tx) => {
    const [bookingSnapshot, classSnapshot, auditSnapshot] = await Promise.all([
      tx.get(bookingRef),
      tx.get(classRef),
      tx.get(auditRef),
    ]);
    if (!bookingSnapshot.exists || bookingSnapshot.get("status") !== "booked") {
      return false;
    }
    const booking = bookingSnapshot.data() as Record<string, unknown>;
    if (booking.classId !== classId || looksLikePaygGuestBooking(booking)) {
      return false;
    }
    const attendanceStatus = stringOrNull(booking.attendanceStatus);
    if (booking.attended === true ||
      (attendanceStatus !== null && attendanceStatus !== "none") ||
      booking.checkedInAt !== undefined && booking.checkedInAt !== null) {
      throw new HttpsError(
        "failed-precondition",
        "A booking already has attendance state and requires manual review.",
        {
          reason: "class_cancellation_attendance_already_recorded",
          operationId,
          bookingIdHash: sha256(
            `class-cancellation-booking:v1:${bookingSnapshot.id}`
          ),
        }
      );
    }
    if (!classSnapshot.exists || classSnapshot.get("status") !== "scheduled" ||
      classSnapshot.get("bookingOpen") !== false ||
      classSnapshot.get("bookingClosedReason") !== "class_cancellation" ||
      classSnapshot.get("cancellationOperationId") !== operationId ||
      !auditSnapshot.exists || !validAuditBinding(
        auditSnapshot.data() as Record<string, unknown>,
        classId,
        operationId
    ) ||
      auditSnapshot.get("state") === "cancelled") {
      throw new HttpsError(
        "failed-precondition",
        "The class cancellation operation changed while releasing a booking.",
        {reason: "class_cancellation_operation_changed", operationId}
      );
    }
    const bookedCount = numberOrNull(classSnapshot.get("bookedCount"));
    if (bookedCount === null || bookedCount < 1) {
      throw new HttpsError(
        "failed-precondition",
        "The class capacity counter must be reviewed before cancellation can continue.",
        {reason: "class_capacity_counter_invalid", operationId}
      );
    }
    const quotaRelease = await prepareConditioningQuotaRelease(
      tx,
      firestore,
      bookingSnapshot.id,
      booking
    );
    applyConditioningQuotaRelease(tx, quotaRelease);
    tx.set(bookingRef, {
      status: "cancelled",
      cancelledAt: FieldValue.serverTimestamp(),
      cancelledReason: "authorised_absence",
      cancelledBy: actorUid,
      cancellationOperationId: operationId,
      attendanceStatus: "none",
      attended: false,
      checkedInAt: null,
      checkedInBy: null,
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    tx.set(classRef, {
      bookedCount: FieldValue.increment(-1),
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    tx.set(auditRef, {
      memberBookingsReleased: FieldValue.increment(1),
      memberBookingIdHashes: FieldValue.arrayUnion(
        sha256(`class-cancellation-booking:v1:${bookingSnapshot.id}`)
      ),
      lastMemberReleaseAt: FieldValue.serverTimestamp(),
      lastMemberReleaseBy: actorUid,
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    return true;
  });
}

async function suppressOrderConfirmation(
  firestore: Firestore,
  classId: string,
  operationId: string,
  orderRef: DocumentReference
): Promise<void> {
  const outboxRef = firestore.collection("paygEmailOutbox").doc(orderRef.id);
  await firestore.runTransaction(async (tx) => {
    const [orderSnapshot, outboxSnapshot] = await Promise.all([
      tx.get(orderRef),
      tx.get(outboxRef),
    ]);
    if (!orderSnapshot.exists) return;
    const classSnapshot = orderSnapshot.get("class") as
      Record<string, unknown> | null;
    if (!classSnapshot || classSnapshot.classId !== classId) {
      throw new HttpsError(
        "failed-precondition",
        "A PAYG order does not match the class cancellation.",
        {reason: "class_cancellation_payg_binding_invalid", operationId}
      );
    }
    suppressPaygConfirmationForClassCancellation(
      tx,
      outboxSnapshot,
      orderRef,
      operationId
    );
  });
}

async function persistObservation(
  firestore: Firestore,
  assessment: CancellationAssessment,
  actorUid: string
): Promise<void> {
  const auditRef = firestore.collection(CLASS_CANCELLATION_AUDIT_COLLECTION)
    .doc(assessment.operationId);
  const classRef = firestore.collection("classes").doc(assessment.classId);
  await firestore.runTransaction(async (tx) => {
    const [auditSnapshot, classSnapshot] = await Promise.all([
      tx.get(auditRef),
      tx.get(classRef),
    ]);
    if (!auditSnapshot.exists || !validAuditBinding(
      auditSnapshot.data() as Record<string, unknown>,
      assessment.classId,
      assessment.operationId
    )) {
      throw new HttpsError(
        "failed-precondition",
        "The class cancellation audit disappeared.",
        {reason: "class_cancellation_audit_missing", operationId: assessment.operationId}
      );
    }
    if (auditSnapshot.get("state") === "cancelled") return;
    tx.set(auditRef, {
      state: assessment.operationState,
      paygGuests: [...assessment.paygGuests],
      latestSnapshot: safeAuditSnapshot(assessment),
      lastObservedAt: FieldValue.serverTimestamp(),
      lastObservedBy: actorUid,
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    if (classSnapshot.exists && classSnapshot.get("status") === "scheduled" &&
      classSnapshot.get("cancellationOperationId") === assessment.operationId) {
      tx.set(classRef, {
        cancellationState: assessment.operationState,
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
    }
  });
}

async function persistFailure(
  firestore: Firestore,
  operationId: string,
  actorUid: string,
  error: unknown
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const auditRef = firestore.collection(CLASS_CANCELLATION_AUDIT_COLLECTION)
    .doc(operationId);
  await firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(auditRef);
    if (!snapshot.exists || snapshot.get("state") === "cancelled" ||
      snapshot.get("operationId") !== operationId ||
      snapshot.get("schemaVersion") !==
        CLASS_CANCELLATION_AUDIT_SCHEMA_VERSION) return;
    tx.set(auditRef, {
      lastError: message.slice(0, 500),
      lastErrorAt: FieldValue.serverTimestamp(),
      lastErrorObservedBy: actorUid,
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
  });
}

async function bindAmbiguousPaygIntentToCancellation(
  firestore: Firestore,
  intentRef: DocumentReference,
  classId: string,
  operationId: string
): Promise<void> {
  const classRef = firestore.collection("classes").doc(classId);
  await firestore.runTransaction(async (tx) => {
    const [intent, frozenClass] = await Promise.all([
      tx.get(intentRef),
      tx.get(classRef),
    ]);
    const intentClass = intent.get("class") as Record<string, unknown> | null;
    if (!intent.exists || !frozenClass.exists ||
      intentClass?.classId !== classId ||
      frozenClass.get("status") !== "scheduled" ||
      frozenClass.get("bookingOpen") !== false ||
      frozenClass.get("bookingClosedReason") !== "class_cancellation" ||
      frozenClass.get("cancellationOperationId") !== operationId) {
      throw new HttpsError(
        "failed-precondition",
        "A PAYG intent cannot be bound to this cancellation operation.",
        {reason: "class_cancellation_payg_binding_invalid", operationId}
      );
    }
    tx.set(intentRef, {
      classCancellationOperationId: operationId,
      classCancellationRequestedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
  });
}

async function reconcileClassPaygIntents(
  firestore: Firestore,
  classId: string,
  operationId: string,
  releaseLocalHold: boolean
): Promise<void> {
  const [intents, orders] = await Promise.all([
    classQuery(firestore, "paygIntents", classId).get(),
    classQuery(firestore, "paygOrders", classId).get(),
  ]);
  const orderIds = new Set(orders.docs.map((order) => order.id));
  for (const intent of intents.docs) {
    if (orderIds.has(intent.id)) continue;
    if (releaseLocalHold) {
      await bindAmbiguousPaygIntentToCancellation(
        firestore,
        intent.ref,
        classId,
        operationId
      );
    } else if (intent.get("classCancellationOperationId") !== operationId) {
      throw new HttpsError(
        "failed-precondition",
        "A PAYG intent is not bound to this cancellation operation.",
        {reason: "class_cancellation_payg_binding_invalid", operationId}
      );
    }
    await reconcilePaygCheckoutForClassCancellation(
      intent.ref,
      classId,
      operationId
    );
  }
}

async function reconcileClassPaygOrders(
  firestore: Firestore,
  classId: string,
  operationId: string
): Promise<void> {
  const orders = await classQuery(firestore, "paygOrders", classId).get();
  for (const order of orders.docs) {
    await suppressOrderConfirmation(
      firestore,
      classId,
      operationId,
      order.ref
    );
    await initiatePaygOrderRefundForClassCancellation(
      order.ref,
      classId,
      operationId
    );
  }
}

export function buildBeginClassCancellation(requireAdmin: AdminGuard) {
  return onCall(CLASS_CANCELLATION_CALLABLE_OPTIONS, async (request) => {
    await requireAdmin(request);
    const actorUid = request.auth?.uid;
    if (!actorUid) throw new HttpsError("unauthenticated", "Login required.");
    const classId = requireClassId(request.data?.classId);
    const operationId = classCancellationOperationId(classId);
    const database = firestore();
    const opened = await openOrResumeCancellation(
      database,
      classId,
      operationId,
      actorUid
    );
    if (opened.alreadyFinalized) {
      const documents = await readCancellationDocuments(
        database,
        classId,
        operationId
      );
      const assessment = assessCancellationDocuments(
        classId,
        operationId,
        documents
      );
      return responseFor(assessment, true, "cancelled");
    }
    try {
      const activeBookings = await database.collection("bookings")
        .where("classId", "==", classId)
        .where("status", "==", "booked")
        .get();
      for (const booking of activeBookings.docs) {
        const value = booking.data() as Record<string, unknown>;
        if (!looksLikePaygGuestBooking(value)) {
          await releaseMemberBooking(
            database,
            classId,
            operationId,
            actorUid,
            booking.ref
          );
        }
      }
      await reconcileClassPaygIntents(
        database,
        classId,
        operationId,
        true
      );
      await reconcileClassPaygOrders(database, classId, operationId);
      const documents = await readCancellationDocuments(
        database,
        classId,
        operationId
      );
      const assessment = assessCancellationDocuments(
        classId,
        operationId,
        documents
      );
      await persistObservation(database, assessment, actorUid);
      return responseFor(assessment, false);
    } catch (error) {
      await persistFailure(database, operationId, actorUid, error);
      throw error;
    }
  });
}

export function buildFinalizeClassCancellation(requireAdmin: AdminGuard) {
  return onCall(CLASS_CANCELLATION_CALLABLE_OPTIONS, async (request) => {
    await requireAdmin(request);
    const actorUid = request.auth?.uid;
    if (!actorUid) throw new HttpsError("unauthenticated", "Login required.");
    const classId = requireClassId(request.data?.classId);
    const operationId = classCancellationOperationId(classId);
    const database = firestore();
    const [initialClass, initialAudit] = await Promise.all([
      database.collection("classes").doc(classId).get(),
      database.collection(CLASS_CANCELLATION_AUDIT_COLLECTION)
        .doc(operationId).get(),
    ]);
    if (!initialClass.exists || !initialAudit.exists) {
      throw new HttpsError(
        "failed-precondition",
        "Begin the supported class cancellation before finalizing it.",
        {reason: "class_cancellation_not_started", operationId}
      );
    }
    const initialAuditValue = initialAudit.data() as Record<string, unknown>;
    if (!validAuditBinding(initialAuditValue, classId, operationId)) {
      throw new HttpsError(
        "failed-precondition",
        "The class cancellation audit binding is invalid.",
        {reason: "class_cancellation_audit_binding_invalid", operationId}
      );
    }
    if (initialClass.get("status") === "cancelled" &&
      initialAudit.get("state") === "cancelled" &&
      initialClass.get("cancellationOperationId") === operationId) {
      const documents = await readCancellationDocuments(
        database,
        classId,
        operationId
      );
      return responseFor(
        assessCancellationDocuments(classId, operationId, documents),
        true,
        "cancelled"
      );
    }
    // Re-read exact provider state immediately before the final transaction.
    // Only irreversible provider-terminal evidence can make an intent ready.
    await reconcileClassPaygIntents(
      database,
      classId,
      operationId,
      false
    );
    await reconcileClassPaygOrders(database, classId, operationId);
    const outcome = await database.runTransaction(async (tx) => {
      const documents = await readCancellationDocumentsInTransaction(
        tx,
        database,
        classId,
        operationId
      );
      if (!documents.classSnapshot.exists || !documents.auditSnapshot.exists) {
        throw new HttpsError(
          "failed-precondition",
          "Begin the supported class cancellation before finalizing it.",
          {reason: "class_cancellation_not_started", operationId}
        );
      }
      const assessment = assessCancellationDocuments(
        classId,
        operationId,
        documents
      );
      if (documents.classSnapshot.get("status") === "cancelled" &&
        documents.auditSnapshot.get("state") === "cancelled" &&
        documents.classSnapshot.get("cancellationOperationId") === operationId) {
        return {kind: "already_finalized" as const, assessment};
      }
      if (documents.classSnapshot.get("status") !== "scheduled" ||
        documents.classSnapshot.get("bookingOpen") !== false ||
        documents.classSnapshot.get("bookingClosedReason") !== "class_cancellation" ||
        documents.classSnapshot.get("cancellationOperationId") !== operationId ||
        !validAuditBinding(
          documents.auditSnapshot.data() as Record<string, unknown>,
          classId,
          operationId
        )) {
        throw new HttpsError(
          "failed-precondition",
          "The supported class cancellation is not the current class state.",
          {reason: "class_cancellation_operation_changed", operationId}
        );
      }
      if (!assessment.ready) {
        return {kind: "not_ready" as const, assessment};
      }
      tx.set(documents.classSnapshot.ref, {
        status: "cancelled",
        bookingOpen: false,
        cancellationState: "cancelled",
        cancelledAt: FieldValue.serverTimestamp(),
        cancelledBy: actorUid,
        bookedCount: 0,
        paygUnpaidHoldCount: 0,
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
      tx.set(documents.auditSnapshot.ref, {
        state: "cancelled",
        paygGuests: [...assessment.paygGuests],
        finalSnapshot: safeAuditSnapshot(assessment),
        finalizedAt: FieldValue.serverTimestamp(),
        finalizedBy: actorUid,
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
      return {kind: "finalized" as const, assessment};
    });
    if (outcome.kind === "not_ready") {
      await persistObservation(database, outcome.assessment, actorUid);
      throw new HttpsError(
        "failed-precondition",
        "Class cancellation is waiting for every booking, hold, refund and confirmation to reconcile.",
        {
          reason: "class_cancellation_not_ready",
          operationId,
          blockers: outcome.assessment.blockers,
          paygGuests: [...outcome.assessment.paygGuests],
        }
      );
    }
    return responseFor(
      outcome.assessment,
      outcome.kind === "already_finalized",
      "cancelled"
    );
  });
}

export const __testing = Object.freeze({
  assessCancellationDocuments,
  classCancellationOperationId,
});
