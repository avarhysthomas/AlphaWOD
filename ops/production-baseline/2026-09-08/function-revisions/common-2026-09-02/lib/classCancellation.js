"use strict";
/* eslint-disable require-jsdoc, max-len */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.__testing = exports.CLASS_CANCELLATION_AUDIT_SCHEMA_VERSION = exports.CLASS_CANCELLATION_AUDIT_COLLECTION = void 0;
exports.classCancellationOperationId = classCancellationOperationId;
exports.buildBeginClassCancellation = buildBeginClassCancellation;
exports.buildFinalizeClassCancellation = buildFinalizeClassCancellation;
const crypto_1 = require("crypto");
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const conditioningQuota_1 = require("./conditioningQuota");
const payg_1 = require("./payg");
exports.CLASS_CANCELLATION_AUDIT_COLLECTION = "classCancellationOperations";
exports.CLASS_CANCELLATION_AUDIT_SCHEMA_VERSION = 1;
const CLASS_CANCELLATION_CALLABLE_OPTIONS = {
    region: "europe-west1",
    secrets: payg_1.PAYG_WORKER_SECRETS,
    enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true",
    consumeAppCheckToken: process.env.FUNCTIONS_EMULATOR !== "true",
    timeoutSeconds: 540,
};
function firestore() {
    return admin.firestore();
}
function sha256(value) {
    return (0, crypto_1.createHash)("sha256").update(value).digest("hex");
}
function classCancellationOperationId(classId) {
    return `class_cancel_${sha256(`class-cancellation:v1:${classId}`)}`;
}
function requireClassId(value) {
    const classId = typeof value === "string" ? value.trim() : "";
    if (!classId || classId.length > 512 || classId.includes("/") ||
        classId === "." || classId === "..") {
        throw new https_1.HttpsError("invalid-argument", "A valid classId is required.");
    }
    return classId;
}
function stringOrNull(value) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}
function numberOrNull(value) {
    return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}
function timestampMillis(value) {
    if (!value || typeof value !== "object")
        return null;
    const toMillis = value.toMillis;
    if (typeof toMillis !== "function")
        return null;
    const millis = toMillis.call(value);
    return Number.isSafeInteger(millis) && millis > 0 ? millis : null;
}
function validAuditBinding(value, classId, operationId) {
    const releasedCount = numberOrNull(value.memberBookingsReleased);
    const releasedHashes = Array.isArray(value.memberBookingIdHashes) ?
        value.memberBookingIdHashes : null;
    const uniqueHashes = releasedHashes ? new Set(releasedHashes) : null;
    return value.schemaVersion === exports.CLASS_CANCELLATION_AUDIT_SCHEMA_VERSION &&
        value.operationId === operationId && value.classId === classId &&
        ["processing", "awaiting_payg_refunds", "ready_to_finalize", "cancelled"]
            .includes(String(value.state)) &&
        typeof value.initiatedBy === "string" && value.initiatedBy.length > 0 &&
        timestampMillis(value.initiatedAt) !== null &&
        timestampMillis(value.bookingStoppedAt) !== null &&
        releasedCount !== null && releasedHashes !== null &&
        releasedHashes.length === releasedCount &&
        (uniqueHashes === null || uniqueHashes === void 0 ? void 0 : uniqueHashes.size) === releasedHashes.length &&
        releasedHashes.every((hash) => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash));
}
function isPaygOrderId(value) {
    return typeof value === "string" && /^payg_[a-f0-9]{64}$/.test(value);
}
function isPaygGuestBooking(value) {
    return value.bookingKind === "payg_guest" &&
        value.isGuestBooking === true && isPaygOrderId(value.paygOrderId);
}
function looksLikePaygGuestBooking(value) {
    return value.bookingKind === "payg_guest" ||
        value.isGuestBooking === true || value.paygOrderId !== undefined;
}
function refundIsFullyReconciled(value) {
    const amount = numberOrNull(value.amountPence);
    return value.status === "refunded" &&
        value.capacityState === "released" &&
        value.refundStatus === "succeeded" &&
        typeof value.refundId === "string" && /^re_[A-Za-z0-9_]{4,252}$/.test(value.refundId) &&
        amount === payg_1.PAYG_AMOUNT_PENCE && value.currency === payg_1.PAYG_CURRENCY &&
        value.refundedAmountPence === amount;
}
function paymentReviewIsReconciled(value) {
    const amount = numberOrNull(value.providerAmountReceivedPence);
    return amount !== null && amount > 0 && value.status === "refunded" &&
        value.refundStatus === "succeeded" &&
        typeof value.paymentIntentId === "string" &&
        /^pi_[A-Za-z0-9_]{4,252}$/.test(value.paymentIntentId) &&
        typeof value.checkoutSessionId === "string" &&
        /^cs_[A-Za-z0-9_]{4,252}$/.test(value.checkoutSessionId) &&
        typeof value.refundId === "string" && /^re_[A-Za-z0-9_]{4,252}$/.test(value.refundId) &&
        value.providerCurrency === payg_1.PAYG_CURRENCY &&
        value.refundedAmountPence === amount;
}
function providerTerminalNonpaymentIsExact(value, operationId) {
    if (value.classCancellationOperationId !== operationId ||
        value.classCancellationProviderObservationVersion !== 1 ||
        value.classCancellationProviderTerminalNonpayment !== true)
        return false;
    const sessionId = stringOrNull(value.checkoutSessionId);
    const observedSessionId = stringOrNull(value.classCancellationProviderSessionId);
    if (sessionId !== observedSessionId)
        return false;
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
        stringOrNull(value.paymentIntentId) === stringOrNull(value.classCancellationProviderPaymentIntentId);
}
function paymentReviewMatchesTerminalNonpayment(review, intentId, intent, operationId) {
    if (!providerTerminalNonpaymentIsExact(intent, operationId) ||
        intent.classCancellationProviderDisposition !== "payment_intent_canceled") {
        return false;
    }
    const amount = numberOrNull(review.providerAmountReceivedPence);
    return review.intentId === intentId &&
        review.checkoutSessionId === intent.classCancellationProviderSessionId &&
        review.paymentIntentId ===
            intent.classCancellationProviderPaymentIntentId &&
        amount === 0 && review.providerCurrency === payg_1.PAYG_CURRENCY;
}
function paymentReviewMatchesObservedProvider(review, intentId, intent) {
    return review.intentId === intentId &&
        review.checkoutSessionId === intent.classCancellationProviderSessionId &&
        review.paymentIntentId ===
            intent.classCancellationProviderPaymentIntentId;
}
function correctiveCommunicationDelivered(order, outboxById) {
    const lifecycleOutboxes = [
        outboxById.get((0, payg_1.paygConfirmationCorrectionOutboxId)(order.id)),
        outboxById.get((0, payg_1.paygRefundOutboxId)(order.id)),
    ];
    return lifecycleOutboxes.some((lifecycle) => (lifecycle === null || lifecycle === void 0 ? void 0 : lifecycle.exists) &&
        lifecycle.get("orderId") === order.id &&
        (lifecycle.get("kind") === "payg_guest_confirmation_correction" ||
            lifecycle.get("kind") === "payg_guest_refund_confirmation") &&
        (lifecycle.get("status") === "sent" ||
            (lifecycle.get("status") === "tombstoned" &&
                lifecycle.get("providerAcceptanceState") === "accepted")) &&
        typeof lifecycle.get("providerMessageId") === "string");
}
function confirmationResolution(order, outboxById) {
    const result = (confirmationSuppressed, confirmationResolved, confirmationDisposition) => Object.freeze({
        confirmationSuppressed,
        confirmationResolved,
        confirmationDisposition,
    });
    const outbox = outboxById.get(order.id);
    if (order.get("confirmationEmailStatus") !== "not_required") {
        return result(false, false, "ambiguous");
    }
    if (!(outbox === null || outbox === void 0 ? void 0 : outbox.exists))
        return result(true, true, "suppressed_before_send");
    const acceptance = stringOrNull(outbox.get("providerAcceptanceState"));
    const hasUnresolvedCorrelation = acceptance === "unknown_in_flight" ||
        acceptance === "unknown_at_privacy_deadline" ||
        acceptance === "manual_review" ||
        typeof outbox.get("tombstonedLeaseCorrelation") === "string" ||
        typeof outbox.get("ambiguousLeaseCorrelation") === "string" ||
        outbox.get("reconcileAfterStateChange") === true;
    if (hasUnresolvedCorrelation)
        return result(false, false, "ambiguous");
    if (acceptance === "accepted_after_state_change") {
        const corrected = correctiveCommunicationDelivered(order, outboxById);
        return result(false, corrected, corrected ? "accepted_after_change_corrected" :
            "accepted_after_change_unresolved");
    }
    if (outbox.get("status") === "sent" && acceptance === "accepted") {
        return result(false, correctiveCommunicationDelivered(order, outboxById), "accepted_before_change");
    }
    if (outbox.get("status") !== "tombstoned") {
        return result(false, false, "ambiguous");
    }
    if (acceptance === "not_sent" || acceptance === "rejected" ||
        acceptance === "rejected_after_state_change") {
        return result(true, true, "suppressed_before_send");
    }
    if (acceptance === "accepted_before_state_change" || acceptance === "accepted") {
        return result(false, correctiveCommunicationDelivered(order, outboxById), "accepted_before_change");
    }
    return result(false, false, "ambiguous");
}
function paygGuestReference(order, outboxById) {
    var _a, _b, _c;
    const amountPence = (_a = numberOrNull(order.get("amountPence"))) !== null && _a !== void 0 ? _a : 0;
    const confirmation = confirmationResolution(order, outboxById);
    return Object.freeze(Object.assign({ orderId: order.id, bookingId: stringOrNull(order.get("bookingId")), paymentIntentId: stringOrNull(order.get("paymentIntentId")), chargeId: stringOrNull(order.get("chargeId")), refundId: stringOrNull(order.get("refundId")), orderStatus: (_b = stringOrNull(order.get("status"))) !== null && _b !== void 0 ? _b : "unknown", refundStatus: stringOrNull(order.get("refundStatus")), amountPence, currency: (_c = stringOrNull(order.get("currency"))) !== null && _c !== void 0 ? _c : "" }, confirmation));
}
function currentOperationState(classStatus, ready, unresolvedPaygGuestCount, activePaygIntentCount, unresolvedPaymentReviewCount) {
    if (classStatus === "cancelled")
        return "cancelled";
    if (ready)
        return "ready_to_finalize";
    if (unresolvedPaygGuestCount > 0 || unresolvedPaymentReviewCount > 0) {
        return "awaiting_payg_refunds";
    }
    return activePaygIntentCount > 0 ? "processing" : "processing";
}
function assessCancellationDocuments(classId, operationId, documents) {
    var _a, _b, _c, _d;
    const classValue = documents.classSnapshot.exists ?
        documents.classSnapshot.data() : {};
    const auditValue = documents.auditSnapshot.exists ?
        documents.auditSnapshot.data() : {};
    const activeBookings = documents.bookings.filter((booking) => booking.get("status") === "booked");
    const activeMemberBookings = activeBookings.filter((booking) => {
        const value = booking.data();
        return !looksLikePaygGuestBooking(value);
    });
    const activePaygBookings = activeBookings.filter((booking) => isPaygGuestBooking(booking.data()));
    const malformedActiveBookings = activeBookings.filter((booking) => {
        const value = booking.data();
        return looksLikePaygGuestBooking(value) && !isPaygGuestBooking(value);
    });
    const outboxById = new Map(documents.outboxes.map((outbox) => [outbox.id, outbox]));
    const paygGuests = documents.orders
        .map((order) => paygGuestReference(order, outboxById))
        .sort((left, right) => left.orderId.localeCompare(right.orderId));
    const malformedPaygOrderIds = documents.orders.filter((order) => {
        const value = order.data();
        return !isPaygOrderId(order.id) || value.orderId !== order.id ||
            value.purchaseKind !== "payg_class" ||
            value.offeringKey !== "adult_payg_class" ||
            value.class === null || typeof value.class !== "object" ||
            value.class.classId !== classId ||
            value.amountPence !== payg_1.PAYG_AMOUNT_PENCE || value.currency !== payg_1.PAYG_CURRENCY ||
            typeof value.paymentIntentId !== "string" ||
            !/^pi_[A-Za-z0-9_]{4,252}$/.test(value.paymentIntentId);
    }).map((order) => order.id).sort();
    const unboundPaygOrderIds = documents.orders.filter((order) => order.get("classCancellationOperationId") !== operationId ||
        timestampMillis(order.get("classCancellationRequestedAt")) === null).map((order) => order.id).sort();
    const unresolvedPaygOrderIds = documents.orders.filter((order) => !refundIsFullyReconciled(order.data())).map((order) => order.id).sort();
    const unresolvedConfirmationOrderIds = documents.orders.filter((order) => !confirmationResolution(order, outboxById).confirmationResolved).map((order) => order.id).sort();
    const orderIds = new Set(documents.orders.map((order) => order.id));
    const intentById = new Map(documents.intents.map((intent) => [intent.id, intent]));
    const reviewsByIntentId = new Map();
    for (const review of documents.reviews) {
        const intentId = stringOrNull(review.get("intentId"));
        if (!intentId)
            continue;
        const existing = (_a = reviewsByIntentId.get(intentId)) !== null && _a !== void 0 ? _a : [];
        existing.push(review);
        reviewsByIntentId.set(intentId, existing);
    }
    const unresolvedPaymentReviewIds = documents.reviews.filter((review) => {
        const value = review.data();
        if (paymentReviewIsReconciled(value))
            return false;
        const intentId = stringOrNull(value.intentId);
        const intent = intentId ? intentById.get(intentId) : null;
        return !intent || !paymentReviewMatchesTerminalNonpayment(value, intent.id, intent.data(), operationId);
    }).map((review) => review.id).sort();
    const activePaygIntentIds = documents.intents.filter((intent) => {
        var _a;
        const value = intent.data();
        if (orderIds.has(intent.id))
            return false;
        const reviews = (_a = reviewsByIntentId.get(intent.id)) !== null && _a !== void 0 ? _a : [];
        if (reviews.length > 0 && reviews.every((review) => {
            const reviewValue = review.data();
            return paymentReviewIsReconciled(reviewValue) &&
                paymentReviewMatchesObservedProvider(reviewValue, intent.id, value);
        })) {
            return false;
        }
        return !providerTerminalNonpaymentIsExact(value, operationId);
    }).map((intent) => intent.id).sort();
    const unreleasedPaygIntentIds = documents.intents.filter((intent) => !orderIds.has(intent.id) &&
        (intent.get("capacityState") !== "released" ||
            intent.get("unpaidHoldState") !== "released")).map((intent) => intent.id).sort();
    const activePaygLockIds = documents.locks.filter((lock) => lock.exists)
        .map((lock) => lock.id).sort();
    const bookedCount = numberOrNull(classValue.bookedCount);
    const unpaidHoldCount = numberOrNull((_b = classValue.paygUnpaidHoldCount) !== null && _b !== void 0 ? _b : 0);
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
        unresolvedConfirmationOrderIds: Object.freeze(unresolvedConfirmationOrderIds),
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
    const classStatus = (_c = stringOrNull(classValue.status)) !== null && _c !== void 0 ? _c : "missing";
    const refundedPaygGuestCount = documents.orders.length -
        unresolvedPaygOrderIds.length;
    return Object.freeze({
        classId,
        classStatus,
        bookingOpen: classValue.bookingOpen !== false,
        operationId,
        operationState: currentOperationState(classStatus, ready, unresolvedPaygOrderIds.length, activePaygIntentIds.length, unresolvedPaymentReviewIds.length),
        memberBookingsReleased: (_d = numberOrNull(auditValue.memberBookingsReleased)) !== null && _d !== void 0 ? _d : 0,
        activeMemberBookingsRemaining: activeMemberBookings.length,
        paidPaygGuestCount: documents.orders.length,
        refundedPaygGuestCount,
        unresolvedPaygGuestCount: unresolvedPaygOrderIds.length,
        activeBookingCount: activeBookings.length,
        unpaidHoldCount: unpaidHoldCount !== null && unpaidHoldCount !== void 0 ? unpaidHoldCount : -1,
        ready,
        paygGuests: Object.freeze(paygGuests),
        blockers,
    });
}
function classQuery(firestore, collection, classId) {
    return firestore.collection(collection).where("class.classId", "==", classId);
}
async function readReviewDocuments(source, firestore, intents) {
    const snapshots = await Promise.all(intents.map((intent) => {
        const query = firestore.collection(payg_1.PAYG_PAYMENT_REVIEW_COLLECTION)
            .where("intentId", "==", intent.id);
        return source instanceof firestore_1.Transaction ? source.get(query) : query.get();
    }));
    return snapshots.flatMap((snapshot) => snapshot.docs);
}
async function readCancellationDocuments(firestore, classId, operationId) {
    const [classSnapshot, auditSnapshot, bookingSnapshot, orderSnapshot, intentSnapshot] = await Promise.all([
        firestore.collection("classes").doc(classId).get(),
        firestore.collection(exports.CLASS_CANCELLATION_AUDIT_COLLECTION)
            .doc(operationId).get(),
        firestore.collection("bookings").where("classId", "==", classId).get(),
        classQuery(firestore, "paygOrders", classId).get(),
        classQuery(firestore, "paygIntents", classId).get(),
    ]);
    const outboxRefs = orderSnapshot.docs.flatMap((order) => [
        firestore.collection("paygEmailOutbox").doc(order.id),
        firestore.collection("paygEmailOutbox")
            .doc((0, payg_1.paygConfirmationCorrectionOutboxId)(order.id)),
        firestore.collection("paygEmailOutbox").doc((0, payg_1.paygRefundOutboxId)(order.id)),
    ]);
    const lockRefs = intentSnapshot.docs.flatMap((intent) => {
        const lockId = stringOrNull(intent.get("duplicateLockId"));
        return lockId && /^[a-f0-9]{64}$/.test(lockId) ? [
            firestore.collection(payg_1.PAYG_DUPLICATE_LOCK_COLLECTION).doc(lockId),
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
async function readCancellationDocumentsInTransaction(tx, firestore, classId, operationId) {
    const [classSnapshot, auditSnapshot, bookingSnapshot, orderSnapshot, intentSnapshot] = await Promise.all([
        tx.get(firestore.collection("classes").doc(classId)),
        tx.get(firestore.collection(exports.CLASS_CANCELLATION_AUDIT_COLLECTION)
            .doc(operationId)),
        tx.get(firestore.collection("bookings").where("classId", "==", classId)),
        tx.get(classQuery(firestore, "paygOrders", classId)),
        tx.get(classQuery(firestore, "paygIntents", classId)),
    ]);
    const reviews = await readReviewDocuments(tx, firestore, intentSnapshot.docs);
    const outboxRefs = orderSnapshot.docs.flatMap((order) => [
        firestore.collection("paygEmailOutbox").doc(order.id),
        firestore.collection("paygEmailOutbox")
            .doc((0, payg_1.paygConfirmationCorrectionOutboxId)(order.id)),
        firestore.collection("paygEmailOutbox").doc((0, payg_1.paygRefundOutboxId)(order.id)),
    ]);
    const lockRefs = intentSnapshot.docs.flatMap((intent) => {
        const lockId = stringOrNull(intent.get("duplicateLockId"));
        return lockId && /^[a-f0-9]{64}$/.test(lockId) ? [
            firestore.collection(payg_1.PAYG_DUPLICATE_LOCK_COLLECTION).doc(lockId),
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
function safeAuditSnapshot(assessment) {
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
function responseFor(assessment, alreadyFinalized, stateOverride) {
    return {
        ok: true,
        alreadyFinalized,
        operation: {
            id: assessment.operationId,
            classId: assessment.classId,
            state: stateOverride !== null && stateOverride !== void 0 ? stateOverride : assessment.operationState,
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
async function openOrResumeCancellation(firestore, classId, operationId, actorUid) {
    const classRef = firestore.collection("classes").doc(classId);
    const auditRef = firestore.collection(exports.CLASS_CANCELLATION_AUDIT_COLLECTION)
        .doc(operationId);
    return firestore.runTransaction(async (tx) => {
        const [classSnapshot, auditSnapshot] = await Promise.all([
            tx.get(classRef),
            tx.get(auditRef),
        ]);
        if (!classSnapshot.exists) {
            throw new https_1.HttpsError("not-found", "Class not found.");
        }
        const classValue = classSnapshot.data();
        const auditValue = auditSnapshot.exists ?
            auditSnapshot.data() : null;
        if (auditValue && !validAuditBinding(auditValue, classId, operationId)) {
            throw new https_1.HttpsError("failed-precondition", "The class cancellation audit binding is invalid.", { reason: "class_cancellation_audit_binding_invalid", operationId });
        }
        if (classValue.status === "cancelled") {
            if ((auditValue === null || auditValue === void 0 ? void 0 : auditValue.state) === "cancelled" &&
                classValue.cancellationOperationId === operationId) {
                return { alreadyFinalized: true };
            }
            throw new https_1.HttpsError("failed-precondition", "This class was cancelled outside the supported operation.", { reason: "class_cancellation_audit_missing", operationId });
        }
        if (classValue.status !== "scheduled") {
            throw new https_1.HttpsError("failed-precondition", "This class cannot begin cancellation.", { reason: "class_unavailable", operationId });
        }
        const existingOperationId = stringOrNull(classValue.cancellationOperationId);
        if (existingOperationId && existingOperationId !== operationId) {
            throw new https_1.HttpsError("failed-precondition", "Another cancellation operation owns this class.", { reason: "class_cancellation_operation_conflict", operationId });
        }
        if (classValue.bookingOpen === false &&
            classValue.bookingClosedReason !== "class_cancellation") {
            throw new https_1.HttpsError("failed-precondition", "This class is already closed for another operational reason.", { reason: "class_booking_already_closed", operationId });
        }
        if (!auditValue && !existingOperationId) {
            const startMillis = timestampMillis(classValue.startTime);
            if (startMillis === null || startMillis <= Date.now()) {
                throw new https_1.HttpsError("failed-precondition", "Whole-class cancellation must begin before the class starts.", { reason: "class_cancellation_already_started", operationId });
            }
        }
        else if (!auditValue || existingOperationId !== operationId ||
            classValue.bookingClosedReason !== "class_cancellation" ||
            classValue.bookingOpen !== false ||
            timestampMillis(classValue.bookingClosedAt) === null ||
            typeof classValue.bookingClosedBy !== "string") {
            throw new https_1.HttpsError("failed-precondition", "The class cancellation freeze binding is invalid.", { reason: "class_cancellation_audit_binding_invalid", operationId });
        }
        tx.set(classRef, Object.assign(Object.assign({ bookingOpen: false, bookingClosedReason: "class_cancellation", cancellationOperationId: operationId, cancellationState: "processing" }, (existingOperationId ? {} : {
            bookingClosedAt: firestore_1.FieldValue.serverTimestamp(),
            bookingClosedBy: actorUid,
        })), { updatedAt: firestore_1.FieldValue.serverTimestamp() }), { merge: true });
        if (auditSnapshot.exists) {
            tx.set(auditRef, {
                state: (auditValue === null || auditValue === void 0 ? void 0 : auditValue.state) === "cancelled" ? "cancelled" : "processing",
                lastResumedAt: firestore_1.FieldValue.serverTimestamp(),
                lastResumedBy: actorUid,
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
            }, { merge: true });
        }
        else {
            tx.create(auditRef, {
                schemaVersion: exports.CLASS_CANCELLATION_AUDIT_SCHEMA_VERSION,
                operationId,
                classId,
                state: "processing",
                initiatedAt: firestore_1.FieldValue.serverTimestamp(),
                initiatedBy: actorUid,
                bookingStoppedAt: firestore_1.FieldValue.serverTimestamp(),
                memberBookingsReleased: 0,
                memberBookingIdHashes: [],
                paygGuests: [],
                createdAt: firestore_1.FieldValue.serverTimestamp(),
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
            });
        }
        return { alreadyFinalized: false };
    });
}
async function releaseMemberBooking(firestore, classId, operationId, actorUid, bookingRef) {
    const classRef = firestore.collection("classes").doc(classId);
    const auditRef = firestore.collection(exports.CLASS_CANCELLATION_AUDIT_COLLECTION)
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
        const booking = bookingSnapshot.data();
        if (booking.classId !== classId || looksLikePaygGuestBooking(booking)) {
            return false;
        }
        const attendanceStatus = stringOrNull(booking.attendanceStatus);
        if (booking.attended === true ||
            (attendanceStatus !== null && attendanceStatus !== "none") ||
            booking.checkedInAt !== undefined && booking.checkedInAt !== null) {
            throw new https_1.HttpsError("failed-precondition", "A booking already has attendance state and requires manual review.", {
                reason: "class_cancellation_attendance_already_recorded",
                operationId,
                bookingIdHash: sha256(`class-cancellation-booking:v1:${bookingSnapshot.id}`),
            });
        }
        if (!classSnapshot.exists || classSnapshot.get("status") !== "scheduled" ||
            classSnapshot.get("bookingOpen") !== false ||
            classSnapshot.get("bookingClosedReason") !== "class_cancellation" ||
            classSnapshot.get("cancellationOperationId") !== operationId ||
            !auditSnapshot.exists || !validAuditBinding(auditSnapshot.data(), classId, operationId) ||
            auditSnapshot.get("state") === "cancelled") {
            throw new https_1.HttpsError("failed-precondition", "The class cancellation operation changed while releasing a booking.", { reason: "class_cancellation_operation_changed", operationId });
        }
        const bookedCount = numberOrNull(classSnapshot.get("bookedCount"));
        if (bookedCount === null || bookedCount < 1) {
            throw new https_1.HttpsError("failed-precondition", "The class capacity counter must be reviewed before cancellation can continue.", { reason: "class_capacity_counter_invalid", operationId });
        }
        const quotaRelease = await (0, conditioningQuota_1.prepareConditioningQuotaRelease)(tx, firestore, bookingSnapshot.id, booking);
        (0, conditioningQuota_1.applyConditioningQuotaRelease)(tx, quotaRelease);
        tx.set(bookingRef, {
            status: "cancelled",
            cancelledAt: firestore_1.FieldValue.serverTimestamp(),
            cancelledReason: "authorised_absence",
            cancelledBy: actorUid,
            cancellationOperationId: operationId,
            attendanceStatus: "none",
            attended: false,
            checkedInAt: null,
            checkedInBy: null,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        tx.set(classRef, {
            bookedCount: firestore_1.FieldValue.increment(-1),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        tx.set(auditRef, {
            memberBookingsReleased: firestore_1.FieldValue.increment(1),
            memberBookingIdHashes: firestore_1.FieldValue.arrayUnion(sha256(`class-cancellation-booking:v1:${bookingSnapshot.id}`)),
            lastMemberReleaseAt: firestore_1.FieldValue.serverTimestamp(),
            lastMemberReleaseBy: actorUid,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        return true;
    });
}
async function suppressOrderConfirmation(firestore, classId, operationId, orderRef) {
    const outboxRef = firestore.collection("paygEmailOutbox").doc(orderRef.id);
    await firestore.runTransaction(async (tx) => {
        const [orderSnapshot, outboxSnapshot] = await Promise.all([
            tx.get(orderRef),
            tx.get(outboxRef),
        ]);
        if (!orderSnapshot.exists)
            return;
        const classSnapshot = orderSnapshot.get("class");
        if (!classSnapshot || classSnapshot.classId !== classId) {
            throw new https_1.HttpsError("failed-precondition", "A PAYG order does not match the class cancellation.", { reason: "class_cancellation_payg_binding_invalid", operationId });
        }
        (0, payg_1.suppressPaygConfirmationForClassCancellation)(tx, outboxSnapshot, orderRef, operationId);
    });
}
async function persistObservation(firestore, assessment, actorUid) {
    const auditRef = firestore.collection(exports.CLASS_CANCELLATION_AUDIT_COLLECTION)
        .doc(assessment.operationId);
    const classRef = firestore.collection("classes").doc(assessment.classId);
    await firestore.runTransaction(async (tx) => {
        const [auditSnapshot, classSnapshot] = await Promise.all([
            tx.get(auditRef),
            tx.get(classRef),
        ]);
        if (!auditSnapshot.exists || !validAuditBinding(auditSnapshot.data(), assessment.classId, assessment.operationId)) {
            throw new https_1.HttpsError("failed-precondition", "The class cancellation audit disappeared.", { reason: "class_cancellation_audit_missing", operationId: assessment.operationId });
        }
        if (auditSnapshot.get("state") === "cancelled")
            return;
        tx.set(auditRef, {
            state: assessment.operationState,
            paygGuests: [...assessment.paygGuests],
            latestSnapshot: safeAuditSnapshot(assessment),
            lastObservedAt: firestore_1.FieldValue.serverTimestamp(),
            lastObservedBy: actorUid,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        if (classSnapshot.exists && classSnapshot.get("status") === "scheduled" &&
            classSnapshot.get("cancellationOperationId") === assessment.operationId) {
            tx.set(classRef, {
                cancellationState: assessment.operationState,
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
            }, { merge: true });
        }
    });
}
async function persistFailure(firestore, operationId, actorUid, error) {
    const message = error instanceof Error ? error.message : String(error);
    const auditRef = firestore.collection(exports.CLASS_CANCELLATION_AUDIT_COLLECTION)
        .doc(operationId);
    await firestore.runTransaction(async (tx) => {
        const snapshot = await tx.get(auditRef);
        if (!snapshot.exists || snapshot.get("state") === "cancelled" ||
            snapshot.get("operationId") !== operationId ||
            snapshot.get("schemaVersion") !==
                exports.CLASS_CANCELLATION_AUDIT_SCHEMA_VERSION)
            return;
        tx.set(auditRef, {
            lastError: message.slice(0, 500),
            lastErrorAt: firestore_1.FieldValue.serverTimestamp(),
            lastErrorObservedBy: actorUid,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
    });
}
async function bindAmbiguousPaygIntentToCancellation(firestore, intentRef, classId, operationId) {
    const classRef = firestore.collection("classes").doc(classId);
    await firestore.runTransaction(async (tx) => {
        const [intent, frozenClass] = await Promise.all([
            tx.get(intentRef),
            tx.get(classRef),
        ]);
        const intentClass = intent.get("class");
        if (!intent.exists || !frozenClass.exists ||
            (intentClass === null || intentClass === void 0 ? void 0 : intentClass.classId) !== classId ||
            frozenClass.get("status") !== "scheduled" ||
            frozenClass.get("bookingOpen") !== false ||
            frozenClass.get("bookingClosedReason") !== "class_cancellation" ||
            frozenClass.get("cancellationOperationId") !== operationId) {
            throw new https_1.HttpsError("failed-precondition", "A PAYG intent cannot be bound to this cancellation operation.", { reason: "class_cancellation_payg_binding_invalid", operationId });
        }
        tx.set(intentRef, {
            classCancellationOperationId: operationId,
            classCancellationRequestedAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
    });
}
async function reconcileClassPaygIntents(firestore, classId, operationId, releaseLocalHold) {
    const [intents, orders] = await Promise.all([
        classQuery(firestore, "paygIntents", classId).get(),
        classQuery(firestore, "paygOrders", classId).get(),
    ]);
    const orderIds = new Set(orders.docs.map((order) => order.id));
    for (const intent of intents.docs) {
        if (orderIds.has(intent.id))
            continue;
        if (releaseLocalHold) {
            await bindAmbiguousPaygIntentToCancellation(firestore, intent.ref, classId, operationId);
        }
        else if (intent.get("classCancellationOperationId") !== operationId) {
            throw new https_1.HttpsError("failed-precondition", "A PAYG intent is not bound to this cancellation operation.", { reason: "class_cancellation_payg_binding_invalid", operationId });
        }
        await (0, payg_1.reconcilePaygCheckoutForClassCancellation)(intent.ref, classId, operationId);
    }
}
async function reconcileClassPaygOrders(firestore, classId, operationId) {
    const orders = await classQuery(firestore, "paygOrders", classId).get();
    for (const order of orders.docs) {
        await suppressOrderConfirmation(firestore, classId, operationId, order.ref);
        await (0, payg_1.initiatePaygOrderRefundForClassCancellation)(order.ref, classId, operationId);
    }
}
function buildBeginClassCancellation(requireAdmin) {
    return (0, https_1.onCall)(CLASS_CANCELLATION_CALLABLE_OPTIONS, async (request) => {
        var _a, _b;
        await requireAdmin(request);
        const actorUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
        if (!actorUid)
            throw new https_1.HttpsError("unauthenticated", "Login required.");
        const classId = requireClassId((_b = request.data) === null || _b === void 0 ? void 0 : _b.classId);
        const operationId = classCancellationOperationId(classId);
        const database = firestore();
        const opened = await openOrResumeCancellation(database, classId, operationId, actorUid);
        if (opened.alreadyFinalized) {
            const documents = await readCancellationDocuments(database, classId, operationId);
            const assessment = assessCancellationDocuments(classId, operationId, documents);
            return responseFor(assessment, true, "cancelled");
        }
        try {
            const activeBookings = await database.collection("bookings")
                .where("classId", "==", classId)
                .where("status", "==", "booked")
                .get();
            for (const booking of activeBookings.docs) {
                const value = booking.data();
                if (!looksLikePaygGuestBooking(value)) {
                    await releaseMemberBooking(database, classId, operationId, actorUid, booking.ref);
                }
            }
            await reconcileClassPaygIntents(database, classId, operationId, true);
            await reconcileClassPaygOrders(database, classId, operationId);
            const documents = await readCancellationDocuments(database, classId, operationId);
            const assessment = assessCancellationDocuments(classId, operationId, documents);
            await persistObservation(database, assessment, actorUid);
            return responseFor(assessment, false);
        }
        catch (error) {
            await persistFailure(database, operationId, actorUid, error);
            throw error;
        }
    });
}
function buildFinalizeClassCancellation(requireAdmin) {
    return (0, https_1.onCall)(CLASS_CANCELLATION_CALLABLE_OPTIONS, async (request) => {
        var _a, _b;
        await requireAdmin(request);
        const actorUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
        if (!actorUid)
            throw new https_1.HttpsError("unauthenticated", "Login required.");
        const classId = requireClassId((_b = request.data) === null || _b === void 0 ? void 0 : _b.classId);
        const operationId = classCancellationOperationId(classId);
        const database = firestore();
        const [initialClass, initialAudit] = await Promise.all([
            database.collection("classes").doc(classId).get(),
            database.collection(exports.CLASS_CANCELLATION_AUDIT_COLLECTION)
                .doc(operationId).get(),
        ]);
        if (!initialClass.exists || !initialAudit.exists) {
            throw new https_1.HttpsError("failed-precondition", "Begin the supported class cancellation before finalizing it.", { reason: "class_cancellation_not_started", operationId });
        }
        const initialAuditValue = initialAudit.data();
        if (!validAuditBinding(initialAuditValue, classId, operationId)) {
            throw new https_1.HttpsError("failed-precondition", "The class cancellation audit binding is invalid.", { reason: "class_cancellation_audit_binding_invalid", operationId });
        }
        if (initialClass.get("status") === "cancelled" &&
            initialAudit.get("state") === "cancelled" &&
            initialClass.get("cancellationOperationId") === operationId) {
            const documents = await readCancellationDocuments(database, classId, operationId);
            return responseFor(assessCancellationDocuments(classId, operationId, documents), true, "cancelled");
        }
        // Re-read exact provider state immediately before the final transaction.
        // Only irreversible provider-terminal evidence can make an intent ready.
        await reconcileClassPaygIntents(database, classId, operationId, false);
        await reconcileClassPaygOrders(database, classId, operationId);
        const outcome = await database.runTransaction(async (tx) => {
            const documents = await readCancellationDocumentsInTransaction(tx, database, classId, operationId);
            if (!documents.classSnapshot.exists || !documents.auditSnapshot.exists) {
                throw new https_1.HttpsError("failed-precondition", "Begin the supported class cancellation before finalizing it.", { reason: "class_cancellation_not_started", operationId });
            }
            const assessment = assessCancellationDocuments(classId, operationId, documents);
            if (documents.classSnapshot.get("status") === "cancelled" &&
                documents.auditSnapshot.get("state") === "cancelled" &&
                documents.classSnapshot.get("cancellationOperationId") === operationId) {
                return { kind: "already_finalized", assessment };
            }
            if (documents.classSnapshot.get("status") !== "scheduled" ||
                documents.classSnapshot.get("bookingOpen") !== false ||
                documents.classSnapshot.get("bookingClosedReason") !== "class_cancellation" ||
                documents.classSnapshot.get("cancellationOperationId") !== operationId ||
                !validAuditBinding(documents.auditSnapshot.data(), classId, operationId)) {
                throw new https_1.HttpsError("failed-precondition", "The supported class cancellation is not the current class state.", { reason: "class_cancellation_operation_changed", operationId });
            }
            if (!assessment.ready) {
                return { kind: "not_ready", assessment };
            }
            tx.set(documents.classSnapshot.ref, {
                status: "cancelled",
                bookingOpen: false,
                cancellationState: "cancelled",
                cancelledAt: firestore_1.FieldValue.serverTimestamp(),
                cancelledBy: actorUid,
                bookedCount: 0,
                paygUnpaidHoldCount: 0,
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
            }, { merge: true });
            tx.set(documents.auditSnapshot.ref, {
                state: "cancelled",
                paygGuests: [...assessment.paygGuests],
                finalSnapshot: safeAuditSnapshot(assessment),
                finalizedAt: firestore_1.FieldValue.serverTimestamp(),
                finalizedBy: actorUid,
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
            }, { merge: true });
            return { kind: "finalized", assessment };
        });
        if (outcome.kind === "not_ready") {
            await persistObservation(database, outcome.assessment, actorUid);
            throw new https_1.HttpsError("failed-precondition", "Class cancellation is waiting for every booking, hold, refund and confirmation to reconcile.", {
                reason: "class_cancellation_not_ready",
                operationId,
                blockers: outcome.assessment.blockers,
                paygGuests: [...outcome.assessment.paygGuests],
            });
        }
        return responseFor(outcome.assessment, outcome.kind === "already_finalized", "cancelled");
    });
}
exports.__testing = Object.freeze({
    assessCancellationDocuments,
    classCancellationOperationId,
});
//# sourceMappingURL=classCancellation.js.map