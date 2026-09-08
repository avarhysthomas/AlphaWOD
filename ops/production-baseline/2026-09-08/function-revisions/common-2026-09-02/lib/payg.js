"use strict";
/* eslint-disable
  require-jsdoc,
  valid-jsdoc,
  max-len,
  @typescript-eslint/no-explicit-any
*/
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.__testing = exports.PAYG_EMAIL_WORKER_SECRETS = exports.PAYG_WEBHOOK_SECRETS = exports.PAYG_WORKER_SECRETS = exports.PAYG_CANCELLATION_PREVIEW_SECRETS = exports.PAYG_CANCELLATION_SECRETS = exports.PAYG_STATUS_SECRETS = exports.PAYG_CHECKOUT_SECRETS = exports.PAYG_REFUND_ISSUANCE_CLAIM_MS = exports.PAYG_DUPLICATE_LOCK_PREVIOUS_SECRET = exports.PAYG_DUPLICATE_LOCK_SECRET = exports.PAYG_CHECKOUT_RATE_LIMIT_SECRET = exports.PAYG_CANCELLATION_TOKEN_PREVIOUS_SECRET = exports.PAYG_CANCELLATION_TOKEN_SECRET = exports.PAYG_NO_SHOW_REVIEW_DELAY_MS = exports.APPROVED_PAYG_STRIPE_CATALOGUE_IDS = exports.PAYG_PII_REDACTION_IMPLEMENTED = exports.PAYG_MAX_CONCURRENT_UNPAID_HOLDS_PER_CLASS = exports.PAYG_IDEMPOTENT_RETRY_POLICY = exports.PAYG_RATE_LIMITS = exports.PAYG_BOOKING_PII_FIELDS = exports.PAYG_OUTBOX_PII_FIELDS = exports.PAYG_WAIVER_PII_FIELDS = exports.PAYG_ORDER_PII_FIELDS = exports.PAYG_INTENT_PII_FIELDS = exports.PAYG_PII_REDACTION_RETRY_FIELD = exports.PAYG_PII_RETENTION_CUTOFF_FIELD = exports.PAYG_PII_REDACTION_BATCH_SIZE = exports.PAYG_UNPAID_INTENT_RETENTION_MS = exports.PAYG_WAIVER_PII_RETENTION_DAYS = exports.PAYG_ORDER_PII_RETENTION_DAYS = exports.PAYG_UNPAID_INTENT_RETENTION_DAYS = exports.PAYG_PAYMENT_REVIEW_COLLECTION = exports.PAYG_DUPLICATE_LOCK_COLLECTION = exports.PAYG_CHECKOUT_ADMISSION_COLLECTION = exports.PAYG_CHECKOUT_RATE_LIMIT_COLLECTION = exports.PAYG_PRICE_ENV_KEY = exports.PAYG_PRODUCT_NAME = exports.PAYG_MINIMUM_CHECKOUT_WINDOW_SECONDS = exports.PAYG_HOLD_DURATION_SECONDS = exports.PAYG_CANCELLATION_CUTOFF_HOURS = exports.PAYG_CURRENCY = exports.PAYG_AMOUNT_PENCE = exports.PAYG_PURCHASE_KIND = exports.PAYG_OFFERING_KEY = exports.PAYG_CHECKOUT_SCHEMA_VERSION = exports.PAYG_SCHEMA_VERSION = void 0;
exports.resolvePaygClassCancellationRefundAction = resolvePaygClassCancellationRefundAction;
exports.hasPaygSucceededRefundEvidence = hasPaygSucceededRefundEvidence;
exports.classifyPaygDisputeStatus = classifyPaygDisputeStatus;
exports.isPaygTerminalDisputeStatus = isPaygTerminalDisputeStatus;
exports.resolvePaygDisputeOwnerStatus = resolvePaygDisputeOwnerStatus;
exports.resolvePaygDisputeObservation = resolvePaygDisputeObservation;
exports.shouldPreservePaygSucceededRefund = shouldPreservePaygSucceededRefund;
exports.canonicalizePaygSourceAddress = canonicalizePaygSourceAddress;
exports.derivePaygAbuseKeys = derivePaygAbuseKeys;
exports.derivePaygDuplicateLockId = derivePaygDuplicateLockId;
exports.derivePaygDuplicateLockCandidates = derivePaygDuplicateLockCandidates;
exports.isPaygDuplicateLockKeyringConfigured = isPaygDuplicateLockKeyringConfigured;
exports.resolvePaygIdempotentRetryAdmission = resolvePaygIdempotentRetryAdmission;
exports.resolvePaygRefundState = resolvePaygRefundState;
exports.resolvePaygPendingRefundBinding = resolvePaygPendingRefundBinding;
exports.resolvePaygLinkedReviewRefundStatus = resolvePaygLinkedReviewRefundStatus;
exports.shouldSendPaygConfirmation = shouldSendPaygConfirmation;
exports.resolvePaygPaymentReviewDisposition = resolvePaygPaymentReviewDisposition;
exports.resolvePaygCanonicalOrderReviewDisposition = resolvePaygCanonicalOrderReviewDisposition;
exports.resolvePaygUnpaidHoldLimit = resolvePaygUnpaidHoldLimit;
exports.parsePaygPiiRetentionConfig = parsePaygPiiRetentionConfig;
exports.paygPiiRedactionDeadline = paygPiiRedactionDeadline;
exports.resolveStoredPaygPiiRetentionConfig = resolveStoredPaygPiiRetentionConfig;
exports.assertPaygCheckoutAppCheck = assertPaygCheckoutAppCheck;
exports.normalizePaygCheckoutRequest = normalizePaygCheckoutRequest;
exports.resolveAgeAtMillis = resolveAgeAtMillis;
exports.resolvePaygCancellationDecision = resolvePaygCancellationDecision;
exports.resolvePaygPostStartCancellationDisposition = resolvePaygPostStartCancellationDisposition;
exports.shouldReleasePaygDuplicateLockForAttendance = shouldReleasePaygDuplicateLockForAttendance;
exports.resolvePaygCancellationRefundPendingDisposition = resolvePaygCancellationRefundPendingDisposition;
exports.sanitizePublicPaygClass = sanitizePublicPaygClass;
exports.paygCheckoutRequestFingerprint = paygCheckoutRequestFingerprint;
exports.derivePaygAcceptanceEvidenceDigest = derivePaygAcceptanceEvidenceDigest;
exports.assertPaygStripeCatalogueShape = assertPaygStripeCatalogueShape;
exports.resolvePaygCatalogueIds = resolvePaygCatalogueIds;
exports.isPaygMetadata = isPaygMetadata;
exports.paygIntentIdFromCheckoutSession = paygIntentIdFromCheckoutSession;
exports.signPaygCancellationToken = signPaygCancellationToken;
exports.verifyPaygCancellationTokenWithKeyring = verifyPaygCancellationTokenWithKeyring;
exports.verifyPaygCancellationToken = verifyPaygCancellationToken;
exports.resolvePaygCancellationSigningKey = resolvePaygCancellationSigningKey;
exports.buildPaygCheckoutSessionParams = buildPaygCheckoutSessionParams;
exports.publicLegalConfig = publicLegalConfig;
exports.buildGetPublicPaygSchedule = buildGetPublicPaygSchedule;
exports.releasePaygHoldForClassCancellation = releasePaygHoldForClassCancellation;
exports.observePaygCheckoutForClassCancellation = observePaygCheckoutForClassCancellation;
exports.reconcilePaygCheckoutForClassCancellation = reconcilePaygCheckoutForClassCancellation;
exports.buildCreatePaygCheckoutSession = buildCreatePaygCheckoutSession;
exports.collectPaygPaidContractMismatches = collectPaygPaidContractMismatches;
exports.isPaygPaymentRefundSafe = isPaygPaymentRefundSafe;
exports.paygPaymentCompletedBeforePiiCutoff = paygPaymentCompletedBeforePiiCutoff;
exports.buildPaygConfirmationOutboxPayload = buildPaygConfirmationOutboxPayload;
exports.shouldEnqueuePaygConfirmationCorrection = shouldEnqueuePaygConfirmationCorrection;
exports.paygEmailLeaseCorrelation = paygEmailLeaseCorrelation;
exports.paygConfirmationCorrectionOutboxId = paygConfirmationCorrectionOutboxId;
exports.buildPaygConfirmationCorrectionOutboxPayload = buildPaygConfirmationCorrectionOutboxPayload;
exports.paygRefundOutboxId = paygRefundOutboxId;
exports.paygDisputeOutboxId = paygDisputeOutboxId;
exports.buildPaygRefundOutboxPayload = buildPaygRefundOutboxPayload;
exports.buildPaygDisputeOutboxPayload = buildPaygDisputeOutboxPayload;
exports.resolvePaygConfirmationPostSend = resolvePaygConfirmationPostSend;
exports.shouldRecoverPaygConfirmationAcceptance = shouldRecoverPaygConfirmationAcceptance;
exports.resolvePaygEmailFailureAfterStateChange = resolvePaygEmailFailureAfterStateChange;
exports.isPaygEmailFailureAmbiguous = isPaygEmailFailureAmbiguous;
exports.resolvePaygTombstoneLeaseCorrelation = resolvePaygTombstoneLeaseCorrelation;
exports.suppressPaygConfirmationForClassCancellation = suppressPaygConfirmationForClassCancellation;
exports.initiatePaygOrderRefundForClassCancellation = initiatePaygOrderRefundForClassCancellation;
exports.fulfilPaygCheckoutSession = fulfilPaygCheckoutSession;
exports.publicPaygPaymentReviewState = publicPaygPaymentReviewState;
exports.publicPaygAttendeeName = publicPaygAttendeeName;
exports.isPaygOrderPiiClosed = isPaygOrderPiiClosed;
exports.buildPaygCancellationPreviewPayload = buildPaygCancellationPreviewPayload;
exports.buildGetPaygCancellationPreview = buildGetPaygCancellationPreview;
exports.buildGetPaygCheckoutStatus = buildGetPaygCheckoutStatus;
exports.buildRequestPaygCancellation = buildRequestPaygCancellation;
exports.dispatchPaygStripeEvent = dispatchPaygStripeEvent;
exports.isActivePaygEmailLease = isActivePaygEmailLease;
exports.runPaygPiiRedactionSweep = runPaygPiiRedactionSweep;
exports.buildPaygConfirmationEmail = buildPaygConfirmationEmail;
exports.buildPaygConfirmationCorrectionEmail = buildPaygConfirmationCorrectionEmail;
exports.buildPaygRefundEmail = buildPaygRefundEmail;
exports.buildPaygDisputeEmail = buildPaygDisputeEmail;
exports.isPaygLifecycleEmailBindingValid = isPaygLifecycleEmailBindingValid;
exports.shouldSuppressPaygConfirmationCorrectionForLifecycle = shouldSuppressPaygConfirmationCorrectionForLifecycle;
exports.buildRetryPaygConfirmations = buildRetryPaygConfirmations;
exports.buildRecoverPaygOperations = buildRecoverPaygOperations;
exports.buildRedactPaygPii = buildRedactPaygPii;
/**
 * Public, account-free Pay As You Go class purchases.
 *
 * This domain deliberately does not reuse membership intents, subscriptions,
 * entitlement state, or membership webhook convergence. A short Firestore
 * hold owns one class place while Stripe Checkout is open; successful payment
 * turns that same held place into a guest booking without incrementing
 * capacity a second time.
 */
const crypto_1 = require("crypto");
const net_1 = require("net");
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const params_1 = require("firebase-functions/params");
const https_1 = require("firebase-functions/v2/https");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const luxon_1 = require("luxon");
const stripe_1 = __importDefault(require("stripe"));
const stripeLiveCatalog_1 = require("./stripeLiveCatalog");
exports.PAYG_SCHEMA_VERSION = 1;
exports.PAYG_CHECKOUT_SCHEMA_VERSION = 2;
exports.PAYG_OFFERING_KEY = "adult_payg_class";
exports.PAYG_PURCHASE_KIND = "payg_class";
exports.PAYG_AMOUNT_PENCE = 700;
exports.PAYG_CURRENCY = "gbp";
exports.PAYG_CANCELLATION_CUTOFF_HOURS = 24;
exports.PAYG_HOLD_DURATION_SECONDS = 35 * 60;
exports.PAYG_MINIMUM_CHECKOUT_WINDOW_SECONDS = 30 * 60;
exports.PAYG_PRODUCT_NAME = "Adult Pay as You Go Class";
exports.PAYG_PRICE_ENV_KEY = "STRIPE_PRICE_ADULT_PAYG_CLASS";
exports.PAYG_CHECKOUT_RATE_LIMIT_COLLECTION = "paygCheckoutRateLimits";
exports.PAYG_CHECKOUT_ADMISSION_COLLECTION = "paygCheckoutAdmissions";
exports.PAYG_DUPLICATE_LOCK_COLLECTION = "paygCheckoutLocks";
exports.PAYG_PAYMENT_REVIEW_COLLECTION = "paygPaymentReviews";
exports.PAYG_UNPAID_INTENT_RETENTION_DAYS = 30;
exports.PAYG_ORDER_PII_RETENTION_DAYS = 90;
exports.PAYG_WAIVER_PII_RETENTION_DAYS = 2190;
exports.PAYG_UNPAID_INTENT_RETENTION_MS = exports.PAYG_UNPAID_INTENT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
exports.PAYG_PII_REDACTION_BATCH_SIZE = 50;
exports.PAYG_PII_RETENTION_CUTOFF_FIELD = "piiRetentionCutoffAt";
exports.PAYG_PII_REDACTION_RETRY_FIELD = "piiRedactionRetryAt";
exports.PAYG_INTENT_PII_FIELDS = Object.freeze([
    "attendee",
    "contact",
    "acceptances",
    "requestFingerprint",
    "checkoutSessionUrl",
]);
exports.PAYG_ORDER_PII_FIELDS = Object.freeze([
    "attendee",
    "contact",
    "acceptances",
]);
exports.PAYG_WAIVER_PII_FIELDS = Object.freeze([
    "attendee",
    "acceptances",
]);
exports.PAYG_OUTBOX_PII_FIELDS = Object.freeze([
    "to",
    "templateData",
    "lastError",
]);
exports.PAYG_BOOKING_PII_FIELDS = Object.freeze(["userName"]);
exports.PAYG_RATE_LIMITS = Object.freeze({
    attemptsPerMinute: 8,
    attemptsPerHour: 24,
});
exports.PAYG_IDEMPOTENT_RETRY_POLICY = Object.freeze({
    maxRetriesPerWindow: 5,
    windowMs: 10 * 60 * 1000,
    minimumSpacingMs: 1000,
});
exports.PAYG_MAX_CONCURRENT_UNPAID_HOLDS_PER_CLASS = 4;
// Code-owned release evidence. Runtime availability still independently
// requires the legal, catalogue, project and owner-approved policy gates.
exports.PAYG_PII_REDACTION_IMPLEMENTED = true;
exports.APPROVED_PAYG_STRIPE_CATALOGUE_IDS = Object.freeze({
    test: Object.freeze({
        productId: stripeLiveCatalog_1.APPROVED_TEST_PAYG_CATALOGUE.productId,
        priceId: stripeLiveCatalog_1.APPROVED_TEST_PAYG_CATALOGUE.priceId,
    }),
    live: Object.freeze({
        productId: stripeLiveCatalog_1.APPROVED_LIVE_PAYG_CATALOGUE.productId,
        priceId: stripeLiveCatalog_1.APPROVED_LIVE_PAYG_CATALOGUE.priceId,
    }),
});
const REGION = "europe-west1";
const LONDON_TIMEZONE = "Europe/London";
const PRODUCTION_FIREBASE_PROJECT_ID = "alphawod-d1f2f";
const LOCAL_TEST_FIREBASE_PROJECT_ID = "demo-alphawod-stripe";
const MAX_PUBLIC_CLASSES = 250;
exports.PAYG_NO_SHOW_REVIEW_DELAY_MS = 6 * 60 * 60 * 1000;
const paygAvailabilityEnabled = (0, params_1.defineString)("PAYG_AVAILABILITY_ENABLED", {
    default: "false",
});
const paygLegalApproved = (0, params_1.defineString)("PAYG_LEGAL_APPROVED", {
    default: "false",
});
const paygFirebaseProjectId = (0, params_1.defineString)("PAYG_FIREBASE_PROJECT_ID", {
    default: "",
});
const stripeExpectedMode = (0, params_1.defineString)("STRIPE_EXPECTED_MODE", {
    default: "",
});
const appPublicOrigin = (0, params_1.defineString)("APP_PUBLIC_ORIGIN", {
    default: "https://alpha-wod.vercel.app",
});
const stripePriceId = (0, params_1.defineString)(exports.PAYG_PRICE_ENV_KEY, { default: "" });
const paygProductTaxCode = (0, params_1.defineString)("PAYG_PRODUCT_TAX_CODE", {
    default: "",
});
const paygWaiverVersion = (0, params_1.defineString)("PAYG_WAIVER_VERSION", { default: "" });
const paygWaiverPublicUrl = (0, params_1.defineString)("PAYG_WAIVER_PUBLIC_URL", { default: "" });
const paygWaiverSha256 = (0, params_1.defineString)("PAYG_WAIVER_SHA256", { default: "" });
const paygTermsVersion = (0, params_1.defineString)("PAYG_TERMS_VERSION", { default: "" });
const paygTermsPublicUrl = (0, params_1.defineString)("PAYG_TERMS_PUBLIC_URL", { default: "" });
const paygTermsSha256 = (0, params_1.defineString)("PAYG_TERMS_SHA256", { default: "" });
const paygPrivacyNoticeVersion = (0, params_1.defineString)("PAYG_PRIVACY_NOTICE_VERSION", {
    default: "",
});
const paygPrivacyNoticePublicUrl = (0, params_1.defineString)("PAYG_PRIVACY_NOTICE_PUBLIC_URL", { default: "" });
const paygPrivacyNoticeSha256 = (0, params_1.defineString)("PAYG_PRIVACY_NOTICE_SHA256", {
    default: "",
});
// PAYG is served by the same Firebase web app as membership checkout. Reuse
// the already-verified production app ID instead of introducing a second
// security identity that could drift.
const paygCheckoutAppId = (0, params_1.defineString)("MEMBERSHIP_CHECKOUT_APP_ID", {
    default: "",
});
const paygPiiRetentionApproved = (0, params_1.defineString)("PAYG_PII_RETENTION_APPROVED", {
    default: "false",
});
const paygPiiRetentionPolicyVersion = (0, params_1.defineString)("PAYG_PII_RETENTION_POLICY_VERSION", { default: "" });
const paygOrderPiiRetentionDays = (0, params_1.defineString)("PAYG_ORDER_PII_RETENTION_DAYS", { default: "" });
const paygWaiverPiiRetentionDays = (0, params_1.defineString)("PAYG_WAIVER_PII_RETENTION_DAYS", { default: "" });
const paygFromEmail = (0, params_1.defineString)("PAYG_FROM_EMAIL", {
    default: "Zero Alpha Fitness <hello@zeroalphafitness.co.uk>",
});
const paygReplyToEmail = (0, params_1.defineString)("PAYG_REPLY_TO_EMAIL", {
    default: "support@zeroalphafitness.co.uk",
});
const paygCancellationTokenKeyId = (0, params_1.defineString)("PAYG_CANCELLATION_TOKEN_KEY_ID", { default: "cancel-v1" });
const paygCancellationTokenPreviousKeyId = (0, params_1.defineString)("PAYG_CANCELLATION_TOKEN_PREVIOUS_KEY_ID", { default: "" });
const paygCancellationTokenPreviousValidUntil = (0, params_1.defineString)("PAYG_CANCELLATION_TOKEN_PREVIOUS_VALID_UNTIL", { default: "" });
const paygDuplicateLockKeyId = (0, params_1.defineString)("PAYG_DUPLICATE_LOCK_KEY_ID", {
    default: "lock-v1",
});
const paygDuplicateLockPreviousKeyId = (0, params_1.defineString)("PAYG_DUPLICATE_LOCK_PREVIOUS_KEY_ID", { default: "" });
const paygDuplicateLockPreviousValidUntil = (0, params_1.defineString)("PAYG_DUPLICATE_LOCK_PREVIOUS_VALID_UNTIL", { default: "" });
const stripeSecretKey = (0, params_1.defineSecret)("STRIPE_SECRET_KEY");
const paygCancellationTokenSecret = (0, params_1.defineSecret)("PAYG_CANCELLATION_TOKEN_SECRET");
const paygCancellationTokenPreviousSecret = (0, params_1.defineSecret)("PAYG_CANCELLATION_TOKEN_PREVIOUS_SECRET");
const paygCheckoutRateLimitSecret = (0, params_1.defineSecret)("PAYG_CHECKOUT_RATE_LIMIT_SECRET");
const paygDuplicateLockSecret = (0, params_1.defineSecret)("PAYG_DUPLICATE_LOCK_SECRET");
const paygDuplicateLockPreviousSecret = (0, params_1.defineSecret)("PAYG_DUPLICATE_LOCK_PREVIOUS_SECRET");
const resendApiKey = (0, params_1.defineSecret)("RESEND_API_KEY");
exports.PAYG_CANCELLATION_TOKEN_SECRET = paygCancellationTokenSecret;
exports.PAYG_CANCELLATION_TOKEN_PREVIOUS_SECRET = paygCancellationTokenPreviousSecret;
exports.PAYG_CHECKOUT_RATE_LIMIT_SECRET = paygCheckoutRateLimitSecret;
exports.PAYG_DUPLICATE_LOCK_SECRET = paygDuplicateLockSecret;
exports.PAYG_DUPLICATE_LOCK_PREVIOUS_SECRET = paygDuplicateLockPreviousSecret;
function resolvePaygClassCancellationRefundAction(input) {
    const blocked = input.disputeOpen === true ||
        typeof input.paymentReviewId === "string" ||
        typeof input.providerContractStatus === "string" ||
        typeof input.conflictingRefundId === "string";
    if (blocked)
        return Object.freeze({ action: "blocked", refundReason: null });
    if (input.status === "refunded") {
        return input.refundStatus === "succeeded" &&
            typeof input.refundId === "string" ?
            Object.freeze({ action: "already_refunded", refundReason: null }) :
            Object.freeze({ action: "blocked", refundReason: null });
    }
    if (input.status === "confirmed" || input.status === "cancelled") {
        return Object.freeze({
            action: "prepare",
            refundReason: "class_cancellation",
        });
    }
    if (input.status !== "refund_pending") {
        return Object.freeze({ action: "blocked", refundReason: null });
    }
    const storedReason = input.refundReason;
    const resumableReason = storedReason === "guest_cancellation" ||
        storedReason === "class_cancellation" ||
        storedReason === "hold_released_before_payment" ? storedReason : null;
    return Object.freeze({
        action: "resume",
        // Once an earlier provider attempt may have started, replay its exact
        // request shape and idempotency key. Otherwise this operation owns the
        // first provider request and records its approved reason explicitly.
        refundReason: input.hasProviderAttemptEvidence && resumableReason ?
            resumableReason : "class_cancellation",
    });
}
exports.PAYG_REFUND_ISSUANCE_CLAIM_MS = 2 * 60 * 1000;
function hasPaygSucceededRefundEvidence(ownerStatus, storedRefundStatus) {
    return ownerStatus === "refunded" || storedRefundStatus === "succeeded";
}
function classifyPaygDisputeStatus(value) {
    switch (value) {
        case "warning_needs_response":
        case "warning_under_review":
        case "needs_response":
        case "under_review":
            return "open";
        case "won":
            return "won";
        case "lost":
            return "lost";
        case "warning_closed":
        case "prevented":
            return "closed_without_chargeback";
        default:
            return "unknown";
    }
}
function isPaygTerminalDisputeStatus(value) {
    const lifecycle = classifyPaygDisputeStatus(value);
    return lifecycle === "won" || lifecycle === "lost" ||
        lifecycle === "closed_without_chargeback";
}
function resolvePaygDisputeOwnerStatus(currentStatus, exactProviderBinding, disputeStatus) {
    const lifecycle = classifyPaygDisputeStatus(disputeStatus);
    return !exactProviderBinding || currentStatus === "manual_review" ||
        lifecycle === "won" || lifecycle === "closed_without_chargeback" ||
        lifecycle === "unknown" ? "manual_review" : "disputed";
}
function resolvePaygDisputeObservation(input) {
    const storedId = typeof input.storedDisputeId === "string" ?
        input.storedDisputeId : null;
    const incomingId = typeof input.incomingDisputeId === "string" ?
        input.incomingDisputeId : null;
    if (!incomingId)
        return "conflict_manual_review";
    if (storedId && storedId !== incomingId)
        return "conflict_manual_review";
    if (storedId === incomingId &&
        isPaygTerminalDisputeStatus(input.storedDisputeStatus) &&
        input.storedDisputeStatus !== input.incomingDisputeStatus) {
        return "preserve_terminal";
    }
    return "apply";
}
function shouldPreservePaygSucceededRefund(input) {
    const storedIdAbsent = input.storedRefundId === null ||
        input.storedRefundId === undefined || input.storedRefundId === "";
    const sameRefund = input.storedRefundId === input.incomingRefundId ||
        (storedIdAbsent && input.exactProviderBinding === true);
    return input.incomingRefundStatus !== "succeeded" &&
        sameRefund &&
        hasPaygSucceededRefundEvidence(input.ownerStatus, input.storedRefundStatus);
}
function db() {
    return admin.firestore();
}
let stripeClient = null;
function serverTimestamp() {
    return firestore_1.FieldValue.serverTimestamp();
}
function sha256(value) {
    return (0, crypto_1.createHash)("sha256").update(value).digest("hex");
}
function hmacSha256(secret, value) {
    if (secret.length < 32) {
        throw new Error("PAYG checkout rate-limit secret is too short.");
    }
    return (0, crypto_1.createHmac)("sha256", secret).update(value).digest("hex");
}
function ipv6Hextets(value) {
    var _a;
    let source = value;
    const embeddedIpv4 = (_a = source.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/)) === null || _a === void 0 ? void 0 : _a[1];
    if (embeddedIpv4) {
        if ((0, net_1.isIP)(embeddedIpv4) !== 4)
            return null;
        const octets = embeddedIpv4.split(".").map(Number);
        const replacement = `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
        source = source.slice(0, -embeddedIpv4.length) + replacement;
    }
    const halves = source.split("::");
    if (halves.length > 2)
        return null;
    const left = halves[0] ? halves[0].split(":") : [];
    const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
    const missing = 8 - left.length - right.length;
    if ((halves.length === 1 && missing !== 0) ||
        (halves.length === 2 && missing < 1))
        return null;
    const values = [
        ...left,
        ...Array.from({ length: Math.max(0, missing) }, () => "0"),
        ...right,
    ].map((part) => /^[a-f0-9]{1,4}$/.test(part) ? parseInt(part, 16) : NaN);
    return values.length === 8 && values.every(Number.isInteger) ? values : null;
}
function canonicalizePaygSourceAddress(value) {
    var _a;
    let source = typeof value === "string" ? value.split(",")[0].trim().toLowerCase() : "";
    const bracketed = source.match(/^\[([^\]]+)](?::\d+)?$/);
    if (bracketed)
        source = bracketed[1];
    if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(source)) {
        source = source.slice(0, source.lastIndexOf(":"));
    }
    source = source.split("%")[0];
    // This helper is intentionally idempotent because the callable request
    // adapter also normalizes provider-supplied addresses before admission.
    // Re-mask an already canonical /64 instead of collapsing it to the shared
    // "unavailable" bucket on the second pass.
    const ipv6Prefix = source.endsWith("/64") ? source.slice(0, -3) : null;
    if (ipv6Prefix && (0, net_1.isIP)(ipv6Prefix) === 6) {
        const prefixHextets = ipv6Hextets(ipv6Prefix);
        if (prefixHextets) {
            return `${prefixHextets.slice(0, 4).map((part) => part.toString(16).padStart(4, "0")).join(":")}::/64`;
        }
    }
    const mappedIpv4 = (_a = source.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)) === null || _a === void 0 ? void 0 : _a[1];
    if (mappedIpv4 && (0, net_1.isIP)(mappedIpv4) === 4)
        return mappedIpv4;
    if ((0, net_1.isIP)(source) === 4)
        return source;
    if ((0, net_1.isIP)(source) !== 6)
        return "unavailable";
    const hextets = ipv6Hextets(source);
    if (!hextets)
        return "unavailable";
    if (hextets.slice(0, 5).every((part) => part === 0) &&
        hextets[5] === 0xffff) {
        return [
            hextets[6] >> 8,
            hextets[6] & 0xff,
            hextets[7] >> 8,
            hextets[7] & 0xff,
        ].join(".");
    }
    // Anonymous IPv6 clients commonly rotate privacy addresses inside one /64.
    // Rate-admission binds to the stable network prefix, never the full address.
    return `${hextets.slice(0, 4).map((part) => part.toString(16).padStart(4, "0")).join(":")}::/64`;
}
function normalizePaygAttendeeIdentity(fullName) {
    return fullName.normalize("NFKC")
        .replace(/\p{Default_Ignorable_Code_Point}/gu, "")
        .replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu, "")
        .replace(/\s+/gu, " ")
        .trim()
        .toLocaleLowerCase("en-GB");
}
function derivePaygAbuseKeys(secret, sourceAddress, checkoutAttemptId, requestFingerprint, nowMillis) {
    if (!Number.isSafeInteger(nowMillis) || nowMillis <= 0) {
        throw new Error("PAYG admission time must be positive integer milliseconds.");
    }
    const sourcePseudonym = hmacSha256(secret, `payg-source:v1:${canonicalizePaygSourceAddress(sourceAddress)}`);
    const attemptId = hmacSha256(secret, `payg-attempt:v1:${checkoutAttemptId}`);
    const requestBinding = hmacSha256(secret, `payg-request:v1:${requestFingerprint}`);
    const minute = Math.floor(nowMillis / 60000);
    const hour = Math.floor(nowMillis / 3600000);
    return Object.freeze({
        sourcePseudonym,
        attemptId,
        requestBinding,
        minuteBucketId: hmacSha256(secret, `payg-minute:v1:${sourcePseudonym}:${minute}`),
        hourBucketId: hmacSha256(secret, `payg-hour:v1:${sourcePseudonym}:${hour}`),
    });
}
function derivePaygDuplicateLockId(secret, classId, fullName, dateOfBirth) {
    return hmacSha256(secret, `payg-class-attendee:v1:${classId}:${normalizePaygAttendeeIdentity(fullName)}:${dateOfBirth}`);
}
function derivePaygDuplicateLockCandidates(keys, classId, fullName, dateOfBirth) {
    if (keys.length < 1 || keys.length > 2 ||
        new Set(keys.map((key) => key.kid)).size !== keys.length ||
        keys.some((key) => !/^[a-z0-9][a-z0-9_-]{1,31}$/.test(key.kid) ||
            key.secret.length < 32)) {
        throw new Error("PAYG duplicate-lock keyring is invalid.");
    }
    const seen = new Set();
    return Object.freeze(keys.flatMap((key) => {
        const lockId = derivePaygDuplicateLockId(key.secret, classId, fullName, dateOfBirth);
        if (seen.has(lockId))
            return [];
        seen.add(lockId);
        return [Object.freeze({ kid: key.kid, lockId })];
    }));
}
function isPaygDuplicateLockKeyringConfigured(keys) {
    return keys.length >= 1 && keys.length <= 2 &&
        new Set(keys.map((key) => key.kid)).size === keys.length &&
        keys.every((key) => /^[a-z0-9][a-z0-9_-]{1,31}$/.test(key.kid) &&
            key.secret.length >= 32);
}
function resolvePaygIdempotentRetryAdmission(input) {
    const invalid = !Number.isSafeInteger(input.nowMillis) || input.nowMillis <= 0 ||
        !Number.isSafeInteger(input.currentRetryCount) ||
        Number(input.currentRetryCount) < 0 ||
        input.windowStartedAtMillis === null ||
        !Number.isSafeInteger(input.windowStartedAtMillis) ||
        input.windowStartedAtMillis <= 0 ||
        input.windowStartedAtMillis > input.nowMillis ||
        input.lastAttemptAtMillis === null ||
        !Number.isSafeInteger(input.lastAttemptAtMillis) ||
        input.lastAttemptAtMillis <= 0 ||
        input.lastAttemptAtMillis > input.nowMillis;
    if (invalid) {
        return Object.freeze({
            allowed: false,
            reason: "invalid_state",
            retryCount: 0,
            windowStartedAtMillis: input.nowMillis,
        });
    }
    const retryCount = Number(input.currentRetryCount);
    const windowExpired = input.nowMillis - input.windowStartedAtMillis >=
        exports.PAYG_IDEMPOTENT_RETRY_POLICY.windowMs;
    if (windowExpired) {
        return Object.freeze({
            allowed: true,
            reason: "allowed",
            retryCount: 1,
            windowStartedAtMillis: input.nowMillis,
        });
    }
    if (input.nowMillis - input.lastAttemptAtMillis <
        exports.PAYG_IDEMPOTENT_RETRY_POLICY.minimumSpacingMs) {
        return Object.freeze({
            allowed: false,
            reason: "too_soon",
            retryCount,
            windowStartedAtMillis: input.windowStartedAtMillis,
        });
    }
    if (retryCount >= exports.PAYG_IDEMPOTENT_RETRY_POLICY.maxRetriesPerWindow) {
        return Object.freeze({
            allowed: false,
            reason: "window_exhausted",
            retryCount,
            windowStartedAtMillis: input.windowStartedAtMillis,
        });
    }
    return Object.freeze({
        allowed: true,
        reason: "allowed",
        retryCount: retryCount + 1,
        windowStartedAtMillis: input.windowStartedAtMillis,
    });
}
function resolvePaygRefundState(currentStatus, refundStatus) {
    if (currentStatus === "refunded") {
        return Object.freeze({
            orderStatus: "refunded",
            scheduleRecovery: false,
            terminal: true,
        });
    }
    const precedence = currentStatus === "disputed" || currentStatus === "manual_review";
    if (refundStatus === "pending") {
        return Object.freeze({
            orderStatus: precedence ? currentStatus : "refund_pending",
            scheduleRecovery: true,
            terminal: false,
        });
    }
    if (refundStatus === "succeeded") {
        return Object.freeze({
            orderStatus: precedence ? currentStatus : "refunded",
            scheduleRecovery: false,
            terminal: true,
        });
    }
    return Object.freeze({
        orderStatus: precedence ? currentStatus : "manual_review",
        scheduleRecovery: false,
        terminal: true,
    });
}
function resolvePaygPendingRefundBinding(input) {
    const incoming = typeof input.incomingRefundId === "string" &&
        input.incomingRefundId.startsWith("re_") ? input.incomingRefundId : null;
    const stored = typeof input.storedRefundId === "string" &&
        input.storedRefundId.startsWith("re_") ? input.storedRefundId : null;
    if (!incoming)
        return "conflict_manual_review";
    if (stored && stored !== incoming)
        return "conflict_manual_review";
    const canRecover = input.ownerStatus === "refund_pending" &&
        input.disputeOpen !== true &&
        input.refundAutomationStatus !== "suspended_dispute";
    if (!canRecover)
        return "not_recoverable";
    return stored === incoming ? "recover_bound" : "bind_and_recover";
}
function resolvePaygLinkedReviewRefundStatus(currentStatus, refundStatus, exactProviderBinding) {
    if (currentStatus === "refunded")
        return "refunded";
    if (currentStatus === "disputed")
        return "disputed";
    if (currentStatus === "manual_review")
        return "manual_review";
    if (!exactProviderBinding || refundStatus === null)
        return "manual_review";
    if (refundStatus === "pending")
        return "refund_pending";
    if (refundStatus === "succeeded")
        return "refunded";
    return "manual_review";
}
function shouldSendPaygConfirmation(status) {
    return status === "confirmed";
}
function resolvePaygPaymentReviewDisposition(automaticRefundSafe, amountReceivedPence) {
    const issueRefund = automaticRefundSafe &&
        Number.isSafeInteger(amountReceivedPence) && Number(amountReceivedPence) > 0;
    return Object.freeze({
        status: issueRefund ? "refund_pending" : "manual_review",
        issueRefund,
        scheduleRecovery: issueRefund,
    });
}
function resolvePaygCanonicalOrderReviewDisposition(input) {
    const extraPayment = typeof input.observedPaymentIntentId === "string" &&
        input.observedPaymentIntentId.startsWith("pi_") &&
        typeof input.canonicalPaymentIntentId === "string" &&
        input.canonicalPaymentIntentId.startsWith("pi_") &&
        input.observedPaymentIntentId !== input.canonicalPaymentIntentId;
    return Object.freeze(Object.assign({ canonicalServicePreserved: true, extraPayment }, resolvePaygPaymentReviewDisposition(extraPayment && input.automaticRefundSafe, input.amountReceivedPence)));
}
function resolvePaygUnpaidHoldLimit(classCapacity) {
    if (!Number.isSafeInteger(classCapacity) || classCapacity < 1)
        return 0;
    return Math.max(1, Math.min(exports.PAYG_MAX_CONCURRENT_UNPAID_HOLDS_PER_CLASS, Math.floor(classCapacity / 2)));
}
function isEnabled(value) {
    return value.trim().toLowerCase() === "true";
}
function parsePaygPiiRetentionConfig(input) {
    const version = typeof input.policyVersion === "string" ?
        input.policyVersion.trim() : "";
    const parseDays = (value) => {
        if (typeof value !== "string" || !/^(0|[1-9]\d{0,4})$/.test(value.trim())) {
            return -1;
        }
        const days = Number(value.trim());
        return Number.isSafeInteger(days) && days <= 36500 ? days : -1;
    };
    const orderDays = parseDays(input.orderPiiRetentionDays);
    const waiverDays = parseDays(input.waiverPiiRetentionDays);
    if (input.approved !== true ||
        !/^[A-Za-z0-9._-]{3,120}$/.test(version) ||
        orderDays !== exports.PAYG_ORDER_PII_RETENTION_DAYS ||
        waiverDays !== exports.PAYG_WAIVER_PII_RETENTION_DAYS) {
        throw new Error("PAYG PII retention policy is not explicitly approved.");
    }
    return Object.freeze({
        policyVersion: version,
        orderPiiRetentionDays: orderDays,
        waiverPiiRetentionDays: waiverDays,
    });
}
function paygPiiRedactionDeadline(classEndMillis, retentionDays) {
    if (!Number.isSafeInteger(classEndMillis) || classEndMillis <= 0 ||
        !Number.isSafeInteger(retentionDays) || retentionDays < 0 ||
        retentionDays > 36500) {
        throw new Error("PAYG PII redaction deadline is invalid.");
    }
    const deadline = classEndMillis + retentionDays * 24 * 60 * 60 * 1000;
    if (!Number.isSafeInteger(deadline)) {
        throw new Error("PAYG PII redaction deadline is invalid.");
    }
    return deadline;
}
function resolveStoredPaygPiiRetentionConfig(value) {
    if (!value || typeof value !== "object")
        return null;
    const candidate = value;
    const policyVersion = typeof candidate.policyVersion === "string" ?
        candidate.policyVersion.trim() : "";
    const orderDays = candidate.orderPiiRetentionDays;
    const waiverDays = candidate.waiverPiiRetentionDays;
    if (!/^[A-Za-z0-9._-]{3,120}$/.test(policyVersion) ||
        orderDays !== exports.PAYG_ORDER_PII_RETENTION_DAYS ||
        waiverDays !== exports.PAYG_WAIVER_PII_RETENTION_DAYS)
        return null;
    return Object.freeze({
        policyVersion,
        orderPiiRetentionDays: Number(orderDays),
        waiverPiiRetentionDays: Number(waiverDays),
    });
}
function paygError(code, message, reason) {
    return new https_1.HttpsError(code, message, reason ? { reason } : undefined);
}
/**
 * App Check validates the token signature before the callable runs. This
 * second check binds anonymous purchase mutations to the intended Firebase
 * web app and rejects a token replay reported as already consumed.
 */
function assertPaygCheckoutAppCheck(request, enforce = !isFirebaseFunctionsEmulatorProcess(), expectedAppId) {
    var _a;
    if (!enforce)
        return;
    const configuredAppId = (expectedAppId === null || expectedAppId === void 0 ? void 0 : expectedAppId.trim()) || paygCheckoutAppId.value().trim();
    if (!configuredAppId) {
        console.error("CRITICAL_PAYG_CHECKOUT_ABUSE_CONFIGURATION", {
            reason: "missing_app_id",
        });
        throw paygError("unavailable", "Checkout security is not configured. Try again later.", "checkout_security_unavailable");
    }
    if (((_a = request === null || request === void 0 ? void 0 : request.app) === null || _a === void 0 ? void 0 : _a.alreadyConsumed) === true) {
        console.warn("PAYG_CHECKOUT_APP_CHECK_REPLAY", { reason: "already_consumed" });
        throw paygError("permission-denied", "Checkout security verification could not be completed. Refresh and try again.", "app_check_replay");
    }
    if (!(request === null || request === void 0 ? void 0 : request.app) || request.app.appId !== configuredAppId) {
        console.warn("PAYG_CHECKOUT_APP_CHECK_REJECTED", {
            reason: (request === null || request === void 0 ? void 0 : request.app) ? "app_id_mismatch" : "missing_context",
        });
        throw paygError("permission-denied", "Checkout security verification could not be completed. Refresh and try again.", "app_check_rejected");
    }
}
function requireBoundedString(value, field, min, max) {
    const text = typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : "";
    if (text.length < min || text.length > max) {
        throw paygError("invalid-argument", `${field} must be between ${min} and ${max} characters.`);
    }
    return text;
}
const UNSAFE_PERSON_NAME_CHARACTER = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u;
function requirePersonName(value) {
    const raw = typeof value === "string" ? value : "";
    if (UNSAFE_PERSON_NAME_CHARACTER.test(raw) ||
        UNSAFE_PERSON_NAME_CHARACTER.test(raw.normalize("NFKC"))) {
        throw paygError("invalid-argument", "attendee.fullName contains unsupported invisible or control characters.");
    }
    return requireBoundedString(raw.normalize("NFKC"), "attendee.fullName", 2, 160);
}
function requireEmail(value) {
    const email = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        email.includes("..")) {
        throw paygError("invalid-argument", "contact.email must be a valid email address.");
    }
    return email;
}
function optionalE164Phone(value) {
    const phone = typeof value === "string" ? value.trim().replace(/[\s()-]/g, "") : "";
    if (!phone)
        return null;
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
        throw paygError("invalid-argument", "When provided, contact.phone must use international format, for example +447700900123.");
    }
    return phone;
}
function requireIsoDate(value) {
    const date = typeof value === "string" ? value.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw paygError("invalid-argument", "attendee.dateOfBirth must use YYYY-MM-DD.");
    }
    const parsed = luxon_1.DateTime.fromISO(date, { zone: LONDON_TIMEZONE }).startOf("day");
    if (!parsed.isValid || parsed.toISODate() !== date) {
        throw paygError("invalid-argument", "attendee.dateOfBirth is not a valid date.");
    }
    return date;
}
function requireCheckoutAttemptId(value) {
    const attemptId = typeof value === "string" ? value.trim() : "";
    if (attemptId.length < 24 || attemptId.length > 128 ||
        !/^[A-Za-z0-9_-]+$/.test(attemptId)) {
        throw paygError("invalid-argument", "checkoutAttemptId must be a 24–128 character opaque identifier.");
    }
    return attemptId;
}
function requireClassId(value) {
    const classId = requireBoundedString(value, "classId", 3, 200);
    if (!/^[A-Za-z0-9._:-]+$/.test(classId)) {
        throw paygError("invalid-argument", "classId contains unsupported characters.");
    }
    return classId;
}
function requireTrue(value, field) {
    if (value !== true) {
        throw paygError("failed-precondition", `${field} must be accepted.`);
    }
    return true;
}
function normalizePaygCheckoutRequest(value, legal) {
    const data = value && typeof value === "object" ? value : {};
    if (data.checkoutSchemaVersion !== exports.PAYG_CHECKOUT_SCHEMA_VERSION) {
        throw paygError("failed-precondition", "This checkout page is out of date. Refresh before continuing.", "checkout_schema_mismatch");
    }
    const attendee = data.attendee && typeof data.attendee === "object" ? data.attendee : {};
    const contact = data.contact && typeof data.contact === "object" ? data.contact : {};
    const acceptances = data.acceptances && typeof data.acceptances === "object" ?
        data.acceptances : {};
    const waiverVersion = requireBoundedString(acceptances.waiverVersion, "acceptances.waiverVersion", 1, 120);
    const termsVersion = requireBoundedString(acceptances.termsVersion, "acceptances.termsVersion", 1, 120);
    const privacyNoticeVersionPresented = requireBoundedString(acceptances.privacyNoticeVersionPresented, "acceptances.privacyNoticeVersionPresented", 1, 120);
    if (waiverVersion !== legal.waiver.version ||
        termsVersion !== legal.terms.version ||
        privacyNoticeVersionPresented !== legal.privacyNotice.version) {
        throw paygError("failed-precondition", "A PAYG document or Privacy Notice changed. Review the current documents before continuing.", "stale_legal_terms");
    }
    const phone = optionalE164Phone(contact.phone);
    return Object.freeze({
        checkoutAttemptId: requireCheckoutAttemptId(data.checkoutAttemptId),
        classId: requireClassId(data.classId),
        attendee: Object.freeze({
            fullName: requirePersonName(attendee.fullName),
            dateOfBirth: requireIsoDate(attendee.dateOfBirth),
        }),
        contact: Object.freeze(Object.assign({ email: requireEmail(contact.email) }, (phone ? { phone } : {}))),
        acceptances: Object.freeze({
            adultConfirmed: requireTrue(acceptances.adultConfirmed, "acceptances.adultConfirmed"),
            waiverAccepted: requireTrue(acceptances.waiverAccepted, "acceptances.waiverAccepted"),
            termsAccepted: requireTrue(acceptances.termsAccepted, "acceptances.termsAccepted"),
            cancellationPolicyAccepted: requireTrue(acceptances.cancellationPolicyAccepted, "acceptances.cancellationPolicyAccepted"),
            waiverVersion,
            termsVersion,
            privacyNoticeVersionPresented,
        }),
    });
}
function resolveAgeAtMillis(dateOfBirth, atMillis) {
    const dob = luxon_1.DateTime.fromISO(dateOfBirth, { zone: LONDON_TIMEZONE }).startOf("day");
    const at = luxon_1.DateTime.fromMillis(atMillis, { zone: LONDON_TIMEZONE }).startOf("day");
    if (!dob.isValid || !at.isValid || dob > at)
        return -1;
    let age = at.year - dob.year;
    const birthdayPassed = at.month > dob.month ||
        (at.month === dob.month && at.day >= dob.day);
    if (!birthdayPassed)
        age -= 1;
    return age;
}
function resolvePaygCancellationDecision(classStartMillis, nowMillis) {
    if (!Number.isFinite(classStartMillis) || !Number.isFinite(nowMillis)) {
        throw new Error("Cancellation times must be finite milliseconds.");
    }
    const cutoffAtMillis = classStartMillis -
        exports.PAYG_CANCELLATION_CUTOFF_HOURS * 60 * 60 * 1000;
    if (nowMillis <= cutoffAtMillis) {
        return Object.freeze({
            kind: "refundable",
            refundEligible: true,
            releaseCapacity: true,
            cutoffAtMillis,
        });
    }
    if (nowMillis < classStartMillis) {
        return Object.freeze({
            kind: "late",
            refundEligible: false,
            releaseCapacity: true,
            cutoffAtMillis,
        });
    }
    return Object.freeze({
        kind: "no_show",
        refundEligible: false,
        releaseCapacity: false,
        cutoffAtMillis,
    });
}
function resolvePaygPostStartCancellationDisposition(attendanceRecorded) {
    return attendanceRecorded ? "attended" : "pending_attendance_review";
}
function shouldReleasePaygDuplicateLockForAttendance(input) {
    if (!Number.isSafeInteger(input.nowMillis) ||
        !Number.isSafeInteger(input.classEndMillis))
        return false;
    return input.attendanceStatus !== "booked" &&
        input.nowMillis >= input.classEndMillis;
}
function resolvePaygCancellationRefundPendingDisposition(refundReason) {
    const guestCancellation = refundReason === "guest_cancellation";
    return Object.freeze({
        refundEligible: guestCancellation,
        issueRefund: guestCancellation,
    });
}
function timestampMillis(value) {
    if (value instanceof firestore_1.Timestamp)
        return value.toMillis();
    if (value && typeof value === "object" &&
        typeof value.toMillis === "function") {
        const millis = value.toMillis();
        return Number.isFinite(millis) ? millis : null;
    }
    return null;
}
function hasNonNullDocumentField(snapshot, field) {
    const value = snapshot.get(field);
    return value !== undefined && value !== null;
}
function existingPaygIntentPrivacySchedule(snapshot) {
    const cutoff = timestampMillis(snapshot.get(exports.PAYG_PII_RETENTION_CUTOFF_FIELD));
    const retryAt = timestampMillis(snapshot.get(exports.PAYG_PII_REDACTION_RETRY_FIELD));
    const privacyAlreadyClosed = hasNonNullDocumentField(snapshot, "piiScrubbedAt");
    const piiReintroduced = exports.PAYG_INTENT_PII_FIELDS.some((field) => {
        const value = snapshot.get(field);
        return value !== undefined && value !== null;
    });
    return Object.assign({ 
        // Remove the ambiguous pre-launch field. It must never authorize recovery
        // or be mistaken for immutable retention evidence again.
        piiScrubAt: firestore_1.FieldValue.delete() }, (privacyAlreadyClosed && piiReintroduced ? {
        // A stale/manual write reintroduced identity after closure. Ensure the
        // review-only path itself schedules immediate cleanup instead of waiting
        // for the bounded collection discovery cursor to revisit this row.
        [exports.PAYG_PII_REDACTION_RETRY_FIELD]: serverTimestamp(),
        piiRedactionReintroducedAt: serverTimestamp(),
    } : privacyAlreadyClosed ? {
        [exports.PAYG_PII_REDACTION_RETRY_FIELD]: firestore_1.FieldValue.delete(),
    } : cutoff === null ? {
        [exports.PAYG_PII_REDACTION_RETRY_FIELD]: serverTimestamp(),
    } : retryAt === null ? {
        [exports.PAYG_PII_REDACTION_RETRY_FIELD]: firestore_1.Timestamp.fromMillis(cutoff),
    } : {}));
}
function sanitizePublicPaygClass(classId, value, nowMillis) {
    const startMillis = timestampMillis(value.startTime);
    const endMillis = timestampMillis(value.endTime);
    if (value.status !== "scheduled" || startMillis === null || endMillis === null ||
        endMillis <= startMillis || startMillis <= nowMillis)
        return null;
    const title = typeof value.title === "string" ? value.title.trim().slice(0, 160) : "";
    const timezone = typeof value.timezone === "string" && value.timezone.trim() ?
        value.timezone.trim().slice(0, 80) : LONDON_TIMEZONE;
    const location = typeof value.location === "string" ?
        value.location.trim().slice(0, 200) : "";
    const coachName = typeof value.coachName === "string" ?
        value.coachName.trim().slice(0, 160) : "";
    if (!title || !location)
        return null;
    const capacity = Number.isSafeInteger(value.capacity) && Number(value.capacity) > 0 ?
        Number(value.capacity) : 0;
    const bookedCount = Number.isSafeInteger(value.bookedCount) && Number(value.bookedCount) > 0 ?
        Number(value.bookedCount) : 0;
    const spacesRemaining = Math.max(0, capacity - bookedCount);
    const checkoutWindowOpen = startMillis - nowMillis >=
        exports.PAYG_MINIMUM_CHECKOUT_WINDOW_SECONDS * 1000;
    // PAYG covers the whole adult schedule. An explicit false is the operational
    // escape hatch for a special occurrence; legacy occurrences default on.
    const eligible = value.bookingOpen !== false && value.paygEligible !== false &&
        checkoutWindowOpen && capacity > 0;
    const availability = !eligible ?
        "unavailable" : spacesRemaining > 0 ? "available" : "full";
    return Object.freeze({
        classId,
        title,
        startTime: new Date(startMillis).toISOString(),
        endTime: new Date(endMillis).toISOString(),
        timezone,
        coachName,
        location,
        spacesRemaining,
        availability,
    });
}
function paygCheckoutRequestFingerprint(request, legal) {
    return sha256(JSON.stringify({
        schemaVersion: exports.PAYG_CHECKOUT_SCHEMA_VERSION,
        offeringKey: exports.PAYG_OFFERING_KEY,
        classId: request.classId,
        attendee: request.attendee,
        contact: request.contact,
        acceptances: request.acceptances,
        legal,
    }));
}
function derivePaygAcceptanceEvidenceDigest(secret, request, legal) {
    return hmacSha256(secret, JSON.stringify({
        domain: "payg-acceptance-evidence:v1",
        classId: request.classId,
        attendee: request.attendee,
        contact: request.contact,
        acceptances: request.acceptances,
        legal,
    }));
}
function canonicalTaxCode(value) {
    const normalized = value.trim();
    if (normalized.toLowerCase() === "none")
        return null;
    if (!/^txcd_\d+$/.test(normalized)) {
        throw paygError("failed-precondition", "PAYG is unavailable because its Product tax code is not approved.");
    }
    return normalized;
}
function assertPaygStripeCatalogueShape(price, product, expectedIds, mode, expectedProductTaxCode) {
    const expectedLivemode = mode === "live";
    const exact = price.id === expectedIds.priceId &&
        price.livemode === expectedLivemode &&
        price.active === true &&
        price.currency === exports.PAYG_CURRENCY &&
        price.unit_amount === exports.PAYG_AMOUNT_PENCE &&
        price.type === "one_time" &&
        price.billing_scheme === "per_unit" &&
        price.recurring === null &&
        price.custom_unit_amount === null &&
        price.transform_quantity === null &&
        price.tax_behavior === "unspecified" &&
        product !== null &&
        product.id === expectedIds.productId &&
        product.livemode === expectedLivemode &&
        product.active === true &&
        product.name === exports.PAYG_PRODUCT_NAME &&
        product.tax_code === expectedProductTaxCode;
    if (!exact) {
        throw paygError("failed-precondition", "PAYG is unavailable because Stripe does not match the approved one-time catalogue.", "stripe_catalogue_mismatch");
    }
}
function resolvePaygCatalogueIds(mode, configuredPriceId, allowlists) {
    const expected = allowlists[mode];
    const pricePrefix = mode === "live" ? "price_" : "price_";
    if (!expected.priceId.startsWith(pricePrefix) ||
        !expected.productId.startsWith("prod_") ||
        configuredPriceId !== expected.priceId) {
        throw paygError("failed-precondition", "PAYG is unavailable because its exact Stripe Product and Price allowlist is incomplete.", "stripe_catalogue_unapproved");
    }
    return Object.freeze(Object.assign({}, expected));
}
function isPaygMetadata(metadata) {
    if (!metadata || typeof metadata !== "object")
        return false;
    const value = metadata;
    return value.purchaseKind === exports.PAYG_PURCHASE_KIND &&
        value.offeringKey === exports.PAYG_OFFERING_KEY &&
        typeof value.paygIntentId === "string" &&
        /^payg_[a-f0-9]{64}$/.test(value.paygIntentId);
}
function paygIntentIdFromCheckoutSession(session) {
    var _a, _b;
    // client_reference_id is fixed when Checkout is created, while Session
    // metadata can be updated later. Prefer the immutable binding if they ever
    // disagree so a mutated Session cannot point at another guest's intent.
    const candidates = [session.client_reference_id, (_a = session.metadata) === null || _a === void 0 ? void 0 : _a.paygIntentId];
    return (_b = candidates.find((value) => typeof value === "string" && /^payg_[a-f0-9]{64}$/.test(value))) !== null && _b !== void 0 ? _b : null;
}
function base64UrlEncode(value) {
    return Buffer.from(value).toString("base64url");
}
function base64UrlDecode(value) {
    return Buffer.from(value, "base64url");
}
function signPaygCancellationToken(payload, secret, kid) {
    if (secret.length < 32)
        throw new Error("PAYG cancellation token secret is too short.");
    if (kid !== undefined && !/^[a-z0-9][a-z0-9_-]{1,31}$/.test(kid)) {
        throw new Error("PAYG cancellation token key ID is invalid.");
    }
    if (payload.v !== 1 || !/^payg_[a-f0-9]{64}$/.test(payload.orderId) ||
        !Number.isSafeInteger(payload.exp) || payload.exp <= 0) {
        throw new Error("Invalid PAYG cancellation token payload.");
    }
    const body = base64UrlEncode(JSON.stringify(payload));
    const signed = kid ? `${kid}.${body}` : body;
    const signature = (0, crypto_1.createHmac)("sha256", secret).update(signed).digest();
    return kid ? `${kid}.${body}.${base64UrlEncode(signature)}` :
        `${body}.${base64UrlEncode(signature)}`;
}
function verifyPaygCancellationTokenWithKeyring(token, keyring, nowUnixSeconds = Math.floor(Date.now() / 1000)) {
    const parts = token.split(".");
    const versioned = parts.length === 3;
    if ((!versioned && parts.length !== 2) || parts.some((part) => !part)) {
        throw paygError("permission-denied", "This cancellation link is invalid or expired.");
    }
    if (keyring.length < 1 || keyring.length > 2) {
        throw new Error("PAYG cancellation token keyring is invalid.");
    }
    const kids = new Set();
    for (const key of keyring) {
        if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(key.kid) ||
            key.secret.length < 32 || kids.has(key.kid) ||
            (key.verifyUntilUnixSeconds !== undefined &&
                (!Number.isSafeInteger(key.verifyUntilUnixSeconds) ||
                    key.verifyUntilUnixSeconds <= 0))) {
            throw new Error("PAYG cancellation token keyring is invalid.");
        }
        kids.add(key.kid);
    }
    const tokenKid = versioned ? parts[0] : null;
    const body = versioned ? parts[1] : parts[0];
    const signaturePart = versioned ? parts[2] : parts[1];
    const candidates = tokenKid ? keyring.filter((key) => key.kid === tokenKid) :
        [...keyring];
    let supplied;
    try {
        supplied = base64UrlDecode(signaturePart);
    }
    catch (_a) {
        throw paygError("permission-denied", "This cancellation link is invalid or expired.");
    }
    let matchedKey = null;
    for (const key of candidates) {
        const signed = tokenKid ? `${tokenKid}.${body}` : body;
        const expected = (0, crypto_1.createHmac)("sha256", key.secret).update(signed).digest();
        if (supplied.length === expected.length && (0, crypto_1.timingSafeEqual)(supplied, expected)) {
            matchedKey = key;
        }
    }
    if (!matchedKey) {
        throw paygError("permission-denied", "This cancellation link is invalid or expired.");
    }
    let payload;
    try {
        payload = JSON.parse(base64UrlDecode(body).toString("utf8"));
    }
    catch (_b) {
        throw paygError("permission-denied", "This cancellation link is invalid or expired.");
    }
    if (!payload || typeof payload !== "object") {
        throw paygError("permission-denied", "This cancellation link is invalid or expired.");
    }
    const candidate = payload;
    if (candidate.v !== 1 ||
        typeof candidate.orderId !== "string" ||
        !/^payg_[a-f0-9]{64}$/.test(candidate.orderId) ||
        !Number.isSafeInteger(candidate.exp) ||
        Number(candidate.exp) < nowUnixSeconds ||
        (matchedKey.verifyUntilUnixSeconds !== undefined &&
            (nowUnixSeconds > matchedKey.verifyUntilUnixSeconds ||
                Number(candidate.exp) > matchedKey.verifyUntilUnixSeconds))) {
        throw paygError("permission-denied", "This cancellation link is invalid or expired.");
    }
    return Object.freeze({
        v: 1,
        orderId: candidate.orderId,
        exp: Number(candidate.exp),
    });
}
function verifyPaygCancellationToken(token, secret, nowUnixSeconds = Math.floor(Date.now() / 1000)) {
    const parts = token.split(".");
    const kid = parts.length === 3 ? parts[0] : "legacy";
    return verifyPaygCancellationTokenWithKeyring(token, [{ kid, secret }], nowUnixSeconds);
}
function isFirebaseFunctionsEmulatorProcess() {
    return process.env.FUNCTIONS_EMULATOR === "true";
}
function isLoopbackHost(value) {
    return typeof value === "string" &&
        /^(127\.0\.0\.1|localhost):\d+$/.test(value);
}
function isIsolatedLocalTestEmulatorProcess() {
    return isFirebaseFunctionsEmulatorProcess() &&
        isLoopbackHost(process.env.FIRESTORE_EMULATOR_HOST) &&
        isLoopbackHost(process.env.FIREBASE_AUTH_EMULATOR_HOST) &&
        runtimeFirebaseProjectId() === LOCAL_TEST_FIREBASE_PROJECT_ID;
}
function secretsForRuntime(secrets) {
    return isIsolatedLocalTestEmulatorProcess() ? [] : secrets;
}
function rotationHorizonUnixSeconds(value, field) {
    const millis = Date.parse(value.trim());
    if (!Number.isSafeInteger(millis) || millis <= 0) {
        throw new Error(`${field} must be an ISO-8601 timestamp.`);
    }
    return Math.floor(millis / 1000);
}
function cancellationVerificationKeyring() {
    const current = Object.freeze({
        kid: paygCancellationTokenKeyId.value().trim(),
        secret: paygCancellationTokenSecret.value().trim(),
    });
    const previousKid = paygCancellationTokenPreviousKeyId.value().trim();
    if (!previousKid)
        return Object.freeze([current]);
    return Object.freeze([
        current,
        Object.freeze({
            kid: previousKid,
            secret: paygCancellationTokenPreviousSecret.value().trim(),
            verifyUntilUnixSeconds: rotationHorizonUnixSeconds(paygCancellationTokenPreviousValidUntil.value(), "PAYG_CANCELLATION_TOKEN_PREVIOUS_VALID_UNTIL"),
        }),
    ]);
}
function resolvePaygCancellationSigningKey(kid, secret) {
    if (typeof kid !== "string" ||
        !/^[a-z0-9][a-z0-9_-]{1,31}$/.test(kid) ||
        typeof secret !== "string" || secret.length < 32) {
        throw new Error("PAYG cancellation signing key is invalid.");
    }
    return Object.freeze({ kid, secret });
}
function cancellationSigningKey() {
    // Signing a new link must depend only on the current key. In particular,
    // webhook/recovery runtimes do not need the previous verify-only secret just
    // because a rotation is in progress.
    return resolvePaygCancellationSigningKey(paygCancellationTokenKeyId.value().trim(), paygCancellationTokenSecret.value().trim());
}
function duplicateLockKeyring(nowMillis = Date.now()) {
    const current = Object.freeze({
        kid: paygDuplicateLockKeyId.value().trim(),
        secret: paygDuplicateLockSecret.value().trim(),
    });
    const previousKid = paygDuplicateLockPreviousKeyId.value().trim();
    if (!previousKid)
        return Object.freeze([current]);
    const previousValidUntil = rotationHorizonUnixSeconds(paygDuplicateLockPreviousValidUntil.value(), "PAYG_DUPLICATE_LOCK_PREVIOUS_VALID_UNTIL") * 1000;
    return Object.freeze([
        current,
        ...(nowMillis <= previousValidUntil ? [Object.freeze({
                kid: previousKid,
                secret: paygDuplicateLockPreviousSecret.value().trim(),
            })] : []),
    ]);
}
exports.PAYG_CHECKOUT_SECRETS = secretsForRuntime([
    stripeSecretKey,
    paygCancellationTokenSecret,
    paygCancellationTokenPreviousSecret,
    paygCheckoutRateLimitSecret,
    paygDuplicateLockSecret,
    paygDuplicateLockPreviousSecret,
]);
exports.PAYG_STATUS_SECRETS = secretsForRuntime([
    paygCancellationTokenSecret,
    paygCancellationTokenPreviousSecret,
    paygCheckoutRateLimitSecret,
    paygDuplicateLockSecret,
    paygDuplicateLockPreviousSecret,
]);
exports.PAYG_CANCELLATION_SECRETS = secretsForRuntime([
    stripeSecretKey,
    paygCancellationTokenSecret,
    paygCancellationTokenPreviousSecret,
]);
exports.PAYG_CANCELLATION_PREVIEW_SECRETS = secretsForRuntime([
    paygCancellationTokenSecret,
    paygCancellationTokenPreviousSecret,
]);
exports.PAYG_WORKER_SECRETS = secretsForRuntime([
    stripeSecretKey,
    paygCancellationTokenSecret,
    paygCancellationTokenPreviousSecret,
]);
exports.PAYG_WEBHOOK_SECRETS = secretsForRuntime([
    stripeSecretKey,
    paygCancellationTokenSecret,
    paygCancellationTokenPreviousSecret,
]);
exports.PAYG_EMAIL_WORKER_SECRETS = secretsForRuntime([resendApiKey]);
function runtimeFirebaseProjectId() {
    const direct = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
    if (direct === null || direct === void 0 ? void 0 : direct.trim())
        return direct.trim();
    try {
        const config = JSON.parse(process.env.FIREBASE_CONFIG || "{}");
        return typeof config.projectId === "string" ? config.projectId.trim() : "";
    }
    catch (_a) {
        return "";
    }
}
function assertPaygFirebaseProject() {
    const expectedProjectId = paygFirebaseProjectId.value().trim();
    const projectId = runtimeFirebaseProjectId();
    if (!expectedProjectId || !projectId || expectedProjectId !== projectId) {
        throw paygError("failed-precondition", "PAYG is disabled because the Firebase project identity is not explicitly matched.");
    }
    return projectId;
}
function assertPaygDataPlaneEnvironment() {
    const projectId = assertPaygFirebaseProject();
    const rawMode = stripeExpectedMode.value().trim().toLowerCase();
    if (rawMode !== "test" && rawMode !== "live") {
        throw paygError("failed-precondition", "PAYG is disabled because the expected Stripe mode is not configured.");
    }
    const mode = rawMode;
    if (projectId === PRODUCTION_FIREBASE_PROJECT_ID && mode !== "live") {
        throw paygError("failed-precondition", "Stripe test mode is forbidden for PAYG in the production Firebase project.");
    }
    if (projectId === LOCAL_TEST_FIREBASE_PROJECT_ID && mode !== "test") {
        throw paygError("failed-precondition", "Stripe live mode is forbidden for PAYG in the isolated test project.");
    }
    if (isFirebaseFunctionsEmulatorProcess() && mode === "live") {
        throw paygError("failed-precondition", "Stripe live mode is forbidden for PAYG in every emulator process.");
    }
    return Object.freeze({
        projectId,
        stripeMode: mode,
        expectedLivemode: mode === "live",
    });
}
function assertPaygBillingEnvironment() {
    const environment = assertPaygDataPlaneEnvironment();
    const key = stripeSecretKey.value().trim();
    const keyMode = key.startsWith("sk_test_") || key.startsWith("rk_test_") ? "test" :
        key.startsWith("sk_live_") || key.startsWith("rk_live_") ? "live" : null;
    if (keyMode !== environment.stripeMode) {
        throw paygError("failed-precondition", "PAYG is disabled because the Stripe credential does not match the configured mode.");
    }
    return environment;
}
function stripeHostOptions() {
    const host = process.env.STRIPE_API_HOST;
    if (!host)
        return {};
    if (!isIsolatedLocalTestEmulatorProcess() ||
        stripeExpectedMode.value().trim().toLowerCase() !== "test") {
        throw paygError("failed-precondition", "The Stripe API host override is allowed only in the isolated PAYG emulator.");
    }
    return {
        host,
        port: Number(process.env.STRIPE_API_PORT || 12111),
        protocol: process.env.STRIPE_API_PROTOCOL || "http",
    };
}
function stripe() {
    assertPaygBillingEnvironment();
    const key = stripeSecretKey.value().trim();
    if (!stripeClient) {
        stripeClient = new stripe_1.default(key, Object.assign({ maxNetworkRetries: 2, timeout: 20000 }, stripeHostOptions()));
    }
    return stripeClient;
}
function assertStripeObjectMode(objectType, objectId, livemode) {
    const environment = assertPaygBillingEnvironment();
    if (typeof livemode !== "boolean" || livemode !== environment.expectedLivemode) {
        console.error("CRITICAL_BILLING_PAYG_STRIPE_MODE_MISMATCH", {
            projectId: environment.projectId,
            expectedStripeMode: environment.stripeMode,
            objectType,
            objectId,
            livemode: typeof livemode === "boolean" ? livemode : null,
        });
        throw paygError("failed-precondition", `PAYG refused a ${objectType} from the wrong Stripe mode.`);
    }
}
function configuredAllowlists() {
    return exports.APPROVED_PAYG_STRIPE_CATALOGUE_IDS;
}
function resolveConfiguredCatalogueIds(mode) {
    return resolvePaygCatalogueIds(mode, stripePriceId.value().trim(), configuredAllowlists());
}
function resolvePublicOrigin() {
    const raw = appPublicOrigin.value().trim().replace(/\/$/, "");
    let parsed;
    try {
        parsed = new URL(raw);
    }
    catch (_a) {
        throw paygError("failed-precondition", "PAYG is unavailable because its public origin is invalid.");
    }
    const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (parsed.origin !== raw || (parsed.protocol !== "https:" &&
        !(isIsolatedLocalTestEmulatorProcess() && loopback && parsed.protocol === "http:"))) {
        throw paygError("failed-precondition", "PAYG is unavailable because its public origin is invalid.");
    }
    return raw;
}
function readLegalDocument(kind, versionValue, publicUrlValue, sha256Value, origin) {
    const version = versionValue.trim();
    const publicUrl = publicUrlValue.trim();
    const digest = sha256Value.trim().toLowerCase();
    if (!/^[A-Za-z0-9._-]{3,120}$/.test(version) ||
        !/^[a-f0-9]{64}$/.test(digest)) {
        throw paygError("failed-precondition", `PAYG ${kind} publication evidence is incomplete.`, "payg_legal_unavailable");
    }
    let resolved;
    try {
        resolved = new URL(publicUrl, origin);
    }
    catch (_a) {
        throw paygError("failed-precondition", `PAYG ${kind} publication URL is invalid.`, "payg_legal_unavailable");
    }
    if (resolved.origin !== origin || !resolved.pathname.startsWith("/legal/") ||
        resolved.search || resolved.hash) {
        throw paygError("failed-precondition", `PAYG ${kind} publication URL is invalid.`, "payg_legal_unavailable");
    }
    return Object.freeze({
        version,
        publicUrl: `${resolved.pathname}`,
        sha256: digest,
    });
}
function resolveLegalConfig(requireApproval = true) {
    if (requireApproval && !isEnabled(paygLegalApproved.value())) {
        throw paygError("failed-precondition", "PAYG checkout is closed until its legal documents are approved.", "payg_legal_unavailable");
    }
    const origin = resolvePublicOrigin();
    return Object.freeze({
        waiver: readLegalDocument("waiver", paygWaiverVersion.value(), paygWaiverPublicUrl.value(), paygWaiverSha256.value(), origin),
        terms: readLegalDocument("terms", paygTermsVersion.value(), paygTermsPublicUrl.value(), paygTermsSha256.value(), origin),
        privacyNotice: readLegalDocument("privacy notice", paygPrivacyNoticeVersion.value(), paygPrivacyNoticePublicUrl.value(), paygPrivacyNoticeSha256.value(), origin),
    });
}
function resolvePiiRetentionConfig() {
    try {
        return parsePaygPiiRetentionConfig({
            approved: isEnabled(paygPiiRetentionApproved.value()),
            policyVersion: paygPiiRetentionPolicyVersion.value(),
            orderPiiRetentionDays: paygOrderPiiRetentionDays.value(),
            waiverPiiRetentionDays: paygWaiverPiiRetentionDays.value(),
        });
    }
    catch (_a) {
        throw paygError("failed-precondition", "PAYG is unavailable until its guest-data retention policy is approved.", "payg_privacy_unavailable");
    }
}
function requirePaygAvailability() {
    if (!isEnabled(paygAvailabilityEnabled.value())) {
        throw paygError("failed-precondition", "Pay As You Go class booking is not currently available.", "payg_unavailable");
    }
    if (!exports.PAYG_PII_REDACTION_IMPLEMENTED) {
        throw paygError("failed-precondition", "PAYG is not yet available because guest-data redaction is not implemented.", "payg_privacy_launch_blocked");
    }
    assertCancellationTokenSecretConfigured();
    assertCheckoutRateLimitSecretConfigured();
    assertDuplicateLockKeyringConfigured();
    resolvePiiRetentionConfig();
}
function assertCancellationTokenSecretConfigured() {
    let configured = false;
    try {
        const keys = cancellationVerificationKeyring();
        configured = keys.length >= 1 && keys.length <= 2 &&
            new Set(keys.map((key) => key.kid)).size === keys.length &&
            keys.every((key) => /^[a-z0-9][a-z0-9_-]{1,31}$/.test(key.kid) &&
                key.secret.length >= 32);
    }
    catch (_a) {
        configured = false;
    }
    if (!configured) {
        throw paygError("failed-precondition", "PAYG is unavailable because guest cancellation links are not configured.");
    }
}
function assertDuplicateLockKeyringConfigured() {
    let configured = false;
    try {
        configured = isPaygDuplicateLockKeyringConfigured(duplicateLockKeyring());
    }
    catch (_a) {
        configured = false;
    }
    if (!configured) {
        throw paygError("failed-precondition", "PAYG is unavailable because duplicate-booking protection is not configured.");
    }
}
function assertCheckoutRateLimitSecretConfigured() {
    if (paygCheckoutRateLimitSecret.value().trim().length < 32) {
        throw paygError("failed-precondition", "PAYG is unavailable because anonymous checkout admission is not configured.");
    }
}
async function loadApprovedPaygPrice() {
    const environment = assertPaygBillingEnvironment();
    const ids = resolveConfiguredCatalogueIds(environment.stripeMode);
    const client = stripe();
    let price;
    try {
        price = await client.prices.retrieve(ids.priceId, { expand: ["product"] });
    }
    catch (error) {
        console.error("PAYG Stripe catalogue preflight failed", {
            offeringKey: exports.PAYG_OFFERING_KEY,
            error,
        });
        throw paygError("unavailable", "PAYG billing is temporarily unavailable. Retry this same checkout attempt.");
    }
    assertStripeObjectMode("Price", price.id, price.livemode);
    const product = typeof price.product === "object" &&
        price.product !== null && !("deleted" in price.product) ?
        price.product : null;
    if (product)
        assertStripeObjectMode("Product", product.id, product.livemode);
    assertPaygStripeCatalogueShape(price, product, ids, environment.stripeMode, canonicalTaxCode(paygProductTaxCode.value()));
    return { client, environment, ids };
}
function classSnapshotFromPublic(value) {
    return Object.freeze({
        classId: value.classId,
        title: value.title,
        startTime: value.startTime,
        endTime: value.endTime,
        timezone: value.timezone,
        location: value.location,
    });
}
function paygIntentId(checkoutAttemptId) {
    return `payg_${sha256(`payg-checkout:${checkoutAttemptId}`)}`;
}
function paygGuestBookingId(intentId) {
    return `payg_guest_${intentId.slice("payg_".length)}`;
}
function paygGuestUserId(intentId) {
    return `payg_guest_${sha256(intentId).slice(0, 40)}`;
}
function metadataForIntent(intentId, classId) {
    return {
        purchaseKind: exports.PAYG_PURCHASE_KIND,
        offeringKey: exports.PAYG_OFFERING_KEY,
        paygIntentId: intentId,
        classId,
        schemaVersion: String(exports.PAYG_SCHEMA_VERSION),
    };
}
function buildPaygCheckoutSessionParams(input) {
    const metadata = metadataForIntent(input.intentId, input.classId);
    return {
        mode: "payment",
        adaptive_pricing: { enabled: false },
        line_items: [{ price: input.priceId, quantity: 1 }],
        customer_email: input.email,
        customer_creation: "if_required",
        client_reference_id: input.intentId,
        payment_method_types: ["card"],
        billing_address_collection: "auto",
        phone_number_collection: { enabled: false },
        automatic_tax: { enabled: false },
        submit_type: "book",
        locale: "en-GB",
        expires_at: input.checkoutExpiresAt,
        success_url: `${input.publicOrigin}/pay-as-you-go/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${input.publicOrigin}/pay-as-you-go?checkout=cancelled`,
        payment_intent_data: {
            description: `${exports.PAYG_PRODUCT_NAME}: ${input.classTitle}`.slice(0, 500),
            metadata,
        },
        metadata,
    };
}
function isDefinitiveStripeCreateFailure(error) {
    if (!error || typeof error !== "object")
        return false;
    const candidate = error;
    return candidate.type === "StripeInvalidRequestError" ||
        candidate.rawType === "invalid_request_error" ||
        candidate.type === "StripeAuthenticationError" ||
        candidate.rawType === "authentication_error" ||
        candidate.type === "StripePermissionError";
}
function idOf(value) {
    if (typeof value === "string")
        return value;
    if (value && typeof value === "object" && "id" in value) {
        return String(value.id);
    }
    return null;
}
function publicOffering() {
    return Object.freeze({
        key: exports.PAYG_OFFERING_KEY,
        displayName: exports.PAYG_PRODUCT_NAME,
        amountPence: exports.PAYG_AMOUNT_PENCE,
        currency: exports.PAYG_CURRENCY,
        cancellationCutoffHours: exports.PAYG_CANCELLATION_CUTOFF_HOURS,
    });
}
function publicLegalConfig(legal) {
    return Object.freeze({
        waiver: Object.freeze({
            version: legal.waiver.version,
            publicUrl: legal.waiver.publicUrl,
        }),
        terms: Object.freeze({
            version: legal.terms.version,
            publicUrl: legal.terms.publicUrl,
        }),
        privacyNotice: Object.freeze({
            version: legal.privacyNotice.version,
            publicUrl: legal.privacyNotice.publicUrl,
        }),
    });
}
function paygPublicGates() {
    if (!isEnabled(paygAvailabilityEnabled.value())) {
        return { available: false, checkoutAvailable: false, legal: null };
    }
    if (!exports.PAYG_PII_REDACTION_IMPLEMENTED) {
        return { available: true, checkoutAvailable: false, legal: null };
    }
    let legal;
    try {
        legal = resolveLegalConfig(true);
    }
    catch (_a) {
        return { available: true, checkoutAvailable: false, legal: null };
    }
    try {
        const environment = assertPaygDataPlaneEnvironment();
        resolveConfiguredCatalogueIds(environment.stripeMode);
        canonicalTaxCode(paygProductTaxCode.value());
        assertCancellationTokenSecretConfigured();
        assertCheckoutRateLimitSecretConfigured();
        assertDuplicateLockKeyringConfigured();
        resolvePiiRetentionConfig();
    }
    catch (_b) {
        return {
            available: true,
            checkoutAvailable: false,
            legal: publicLegalConfig(legal),
        };
    }
    return {
        available: true,
        checkoutAvailable: true,
        legal: publicLegalConfig(legal),
    };
}
function buildGetPublicPaygSchedule() {
    return (0, https_1.onCall)({
        region: REGION,
        secrets: exports.PAYG_STATUS_SECRETS,
        enforceAppCheck: !isFirebaseFunctionsEmulatorProcess(),
    }, async () => {
        const gates = paygPublicGates();
        if (!gates.available) {
            return Object.assign(Object.assign({ ok: true }, gates), { offering: publicOffering(), classes: [] });
        }
        assertPaygFirebaseProject();
        const nowMillis = Date.now();
        const snapshot = await db().collection("classes")
            .where("startTime", ">=", firestore_1.Timestamp.fromMillis(nowMillis))
            .orderBy("startTime", "asc")
            .limit(MAX_PUBLIC_CLASSES)
            .get();
        const classes = snapshot.docs
            .map((doc) => sanitizePublicPaygClass(doc.id, doc.data(), nowMillis))
            .filter((value) => value !== null);
        return Object.assign(Object.assign({ ok: true }, gates), { offering: publicOffering(), classes });
    });
}
function checkoutResponse(disposition, session, intent) {
    if (!session.url) {
        throw paygError("internal", "Stripe did not return a PAYG Checkout URL.");
    }
    return {
        ok: true,
        disposition,
        sessionUrl: session.url,
        sessionId: session.id,
        holdExpiresAt: new Date(intent.checkoutExpiresAt * 1000).toISOString(),
        class: intent.class,
    };
}
function assertSessionBinding(session, intentId, intent) {
    var _a, _b, _c, _d;
    assertStripeObjectMode("Checkout Session", session.id, session.livemode);
    if (session.mode !== "payment" ||
        session.client_reference_id !== intentId ||
        ((_a = session.metadata) === null || _a === void 0 ? void 0 : _a.purchaseKind) !== exports.PAYG_PURCHASE_KIND ||
        ((_b = session.metadata) === null || _b === void 0 ? void 0 : _b.offeringKey) !== exports.PAYG_OFFERING_KEY ||
        ((_c = session.metadata) === null || _c === void 0 ? void 0 : _c.paygIntentId) !== intentId ||
        ((_d = session.metadata) === null || _d === void 0 ? void 0 : _d.classId) !== intent.class.classId) {
        throw new Error(`Checkout Session ${session.id} does not match PAYG intent ${intentId}.`);
    }
}
async function releasePaygHold(intentRef, reason, expectedSessionId) {
    return db().runTransaction(async (tx) => {
        var _a, _b, _c;
        const intentSnap = await tx.get(intentRef);
        if (!intentSnap.exists)
            return false;
        const intent = intentSnap.data();
        if (expectedSessionId && intent.checkoutSessionId &&
            intent.checkoutSessionId !== expectedSessionId) {
            throw new Error(`PAYG intent ${intentRef.id} belongs to another Checkout Session.`);
        }
        if (intent.status === "fulfilled") {
            if (intent.holdExpiresAt) {
                tx.set(intentRef, { holdExpiresAt: firestore_1.FieldValue.delete() }, { merge: true });
            }
            return false;
        }
        const classRef = ((_a = intent.class) === null || _a === void 0 ? void 0 : _a.classId) ?
            db().collection("classes").doc(intent.class.classId) : null;
        const lockRef = typeof intent.duplicateLockId === "string" &&
            /^[a-f0-9]{64}$/.test(intent.duplicateLockId) ?
            db().collection(exports.PAYG_DUPLICATE_LOCK_COLLECTION).doc(intent.duplicateLockId) : null;
        const [classSnap, lockSnap] = await Promise.all([
            classRef ? tx.get(classRef) : Promise.resolve(null),
            lockRef ? tx.get(lockRef) : Promise.resolve(null),
        ]);
        const releaseBookedPlace = intent.capacityState !== "released";
        const releaseUnpaidHold = intent.unpaidHoldState === "counted";
        if ((releaseBookedPlace || releaseUnpaidHold) && (classSnap === null || classSnap === void 0 ? void 0 : classSnap.exists)) {
            const bookedCount = Number((_b = classSnap.get("bookedCount")) !== null && _b !== void 0 ? _b : 0);
            const unpaidHoldCount = Number((_c = classSnap.get("paygUnpaidHoldCount")) !== null && _c !== void 0 ? _c : 0);
            tx.set(classSnap.ref, Object.assign(Object.assign(Object.assign({}, (releaseBookedPlace ? {
                bookedCount: firestore_1.FieldValue.increment(bookedCount > 0 ? -1 : 0),
            } : {})), (releaseUnpaidHold ? {
                paygUnpaidHoldCount: firestore_1.FieldValue.increment(unpaidHoldCount > 0 ? -1 : 0),
            } : {})), { updatedAt: serverTimestamp() }), { merge: true });
        }
        if (lockRef && (lockSnap === null || lockSnap === void 0 ? void 0 : lockSnap.exists) && lockSnap.get("intentId") === intentRef.id) {
            tx.delete(lockRef);
        }
        const piiAlreadyScrubbed = hasNonNullDocumentField(intentSnap, "piiScrubbedAt");
        const piiReintroduced = exports.PAYG_INTENT_PII_FIELDS.some((field) => hasNonNullDocumentField(intentSnap, field));
        const piiRetentionCutoff = timestampMillis(intentSnap.get(exports.PAYG_PII_RETENTION_CUTOFF_FIELD));
        const piiRedactionRetry = timestampMillis(intentSnap.get(exports.PAYG_PII_REDACTION_RETRY_FIELD));
        tx.set(intentRef, Object.assign(Object.assign({ status: reason === "checkout_create_failed" ? "failed" : "expired", capacityState: "released", unpaidHoldState: "released", releaseReason: reason, releasedAt: serverTimestamp(), holdExpiresAt: firestore_1.FieldValue.delete() }, (piiAlreadyScrubbed && piiReintroduced ? {
            [exports.PAYG_PII_REDACTION_RETRY_FIELD]: serverTimestamp(),
            piiRedactionReintroducedAt: serverTimestamp(),
        } : piiAlreadyScrubbed ? {
            [exports.PAYG_PII_REDACTION_RETRY_FIELD]: firestore_1.FieldValue.delete(),
        } : piiRetentionCutoff === null ? {
            // Legacy/pre-launch rows without immutable evidence fail closed into
            // immediate redaction; never invent a later retention cutoff.
            [exports.PAYG_PII_REDACTION_RETRY_FIELD]: serverTimestamp(),
        } : piiRedactionRetry === null ? {
            [exports.PAYG_PII_REDACTION_RETRY_FIELD]: firestore_1.Timestamp.fromMillis(piiRetentionCutoff),
        } : {})), { piiScrubAt: firestore_1.FieldValue.delete(), checkoutRecoveryToken: firestore_1.FieldValue.delete(), checkoutRecoveryLeaseExpiresAt: firestore_1.FieldValue.delete(), 
            // Older pre-launch documents may carry the abandoned whole-document
            // TTL proposal. Explicitly disarm it so provider and audit state remains.
            piiDeleteAt: firestore_1.FieldValue.delete(), updatedAt: serverTimestamp() }), { merge: true });
        return intent.capacityState !== "released";
    });
}
/**
 * Releases an unpaid local reservation when staff freeze its whole class. The
 * exact provider Session remains a cancellation blocker until read-only Stripe
 * observation proves terminal nonpayment or normal webhook recovery records
 * and refunds a payment.
 */
async function releasePaygHoldForClassCancellation(intentRef, classId, operationId) {
    const snapshot = await intentRef.get();
    if (!snapshot.exists) {
        throw new Error(`PAYG intent ${intentRef.id} does not match class cancellation ${operationId}.`);
    }
    const intentClass = snapshot.get("class");
    if (!intentClass || intentClass.classId !== classId) {
        throw new Error(`PAYG intent ${intentRef.id} does not match class cancellation ${operationId}.`);
    }
    const released = await releasePaygHold(intentRef, "class_cancellation");
    await intentRef.set({
        classCancellationOperationId: operationId,
        classCancellationRequestedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    }, { merge: true });
    return released;
}
/**
 * Re-reads the exact Stripe Session (and PaymentIntent when present) for a
 * frozen class. This is deliberately read-only: ordinary signed webhooks and
 * the existing recovery worker remain the only paths that create paid orders
 * or issue refunds. A local expiry clock is never accepted as nonpayment proof.
 */
async function observePaygCheckoutForClassCancellation(intentRef, classId, operationId) {
    var _a, _b;
    const initial = await intentRef.get();
    if (!initial.exists) {
        throw new Error(`PAYG intent ${intentRef.id} disappeared during class cancellation.`);
    }
    const intent = initial.data();
    if (((_a = intent.class) === null || _a === void 0 ? void 0 : _a.classId) !== classId ||
        initial.get("classCancellationOperationId") !== operationId) {
        throw new Error(`PAYG intent ${intentRef.id} is not owned by class cancellation ${operationId}.`);
    }
    const rawSessionId = intent.checkoutSessionId;
    const sessionId = typeof rawSessionId === "string" && rawSessionId.trim() ?
        rawSessionId.trim() : null;
    const persist = async (evidence) => {
        const classRef = db().collection("classes").doc(classId);
        await db().runTransaction(async (tx) => {
            const [freshIntent, frozenClass] = await Promise.all([
                tx.get(intentRef),
                tx.get(classRef),
            ]);
            const freshClass = freshIntent.get("class");
            const freshSessionId = freshIntent.get("checkoutSessionId");
            const freshPaymentIntentId = freshIntent.get("paymentIntentId");
            if (!freshIntent.exists || !frozenClass.exists ||
                frozenClass.get("status") !== "scheduled" ||
                frozenClass.get("bookingOpen") !== false ||
                frozenClass.get("bookingClosedReason") !== "class_cancellation" ||
                frozenClass.get("cancellationOperationId") !== operationId ||
                freshIntent.get("classCancellationOperationId") !== operationId ||
                (freshClass === null || freshClass === void 0 ? void 0 : freshClass.classId) !== classId ||
                (typeof freshSessionId === "string" && freshSessionId.trim() ?
                    freshSessionId.trim() : null) !== evidence.checkoutSessionId ||
                (typeof freshPaymentIntentId === "string" && freshPaymentIntentId &&
                    freshPaymentIntentId !== evidence.paymentIntentId)) {
                throw new Error(`Class cancellation ${operationId} changed during Stripe observation.`);
            }
            tx.set(intentRef, Object.assign(Object.assign({ classCancellationProviderObservationVersion: 1, classCancellationProviderSessionId: evidence.checkoutSessionId, classCancellationProviderSessionStatus: evidence.checkoutStatus, classCancellationProviderPaymentStatus: evidence.paymentStatus, classCancellationProviderPaymentIntentId: evidence.paymentIntentId, classCancellationProviderPaymentIntentStatus: evidence.paymentIntentStatus, classCancellationProviderTerminalNonpayment: evidence.terminalNonpayment, classCancellationProviderDisposition: evidence.disposition, classCancellationProviderObservedAt: serverTimestamp() }, (evidence.paymentIntentId && !freshPaymentIntentId ? {
                paymentIntentId: evidence.paymentIntentId,
            } : {})), { updatedAt: serverTimestamp() }), { merge: true });
        });
        return Object.freeze(Object.assign({ intentId: intentRef.id }, evidence));
    };
    if (!sessionId) {
        const definitiveCreateFailure = (intent.status === "failed" &&
            initial.get("releaseReason") === "checkout_create_failed" ||
            initial.get("releaseReason") === "recovery_confirmed_no_session") &&
            intent.capacityState === "released" &&
            intent.unpaidHoldState === "released" &&
            timestampMillis(initial.get("releasedAt")) !== null;
        return persist({
            checkoutSessionId: null,
            checkoutStatus: null,
            paymentStatus: null,
            paymentIntentId: null,
            paymentIntentStatus: null,
            // Stripe may have accepted an idempotent create before local Session
            // persistence failed. Missing local identity is therefore ambiguous.
            terminalNonpayment: definitiveCreateFailure,
            disposition: definitiveCreateFailure ?
                "provider_create_definitively_failed" : "session_reference_missing",
        });
    }
    const client = stripe();
    const session = await client.checkout.sessions.retrieve(sessionId);
    assertSessionBinding(session, intentRef.id, intent);
    const paymentIntentId = idOf(session.payment_intent);
    const paymentIntent = paymentIntentId ?
        await client.paymentIntents.retrieve(paymentIntentId) : null;
    if (paymentIntent) {
        assertStripeObjectMode("PaymentIntent", paymentIntent.id, paymentIntent.livemode);
    }
    const providerHasPayment = session.payment_status === "paid" ||
        Boolean(paymentIntent &&
            (paymentIntent.status === "succeeded" || paymentIntent.amount_received > 0));
    const paymentIntentCanceled = session.payment_status === "unpaid" &&
        (paymentIntent === null || paymentIntent === void 0 ? void 0 : paymentIntent.status) === "canceled" && paymentIntent.amount_received === 0;
    const sessionExpired = session.status === "expired" &&
        session.payment_status === "unpaid" && !providerHasPayment &&
        (paymentIntent === null || paymentIntentCanceled);
    return persist({
        checkoutSessionId: session.id,
        checkoutStatus: session.status,
        paymentStatus: session.payment_status,
        paymentIntentId,
        paymentIntentStatus: (_b = paymentIntent === null || paymentIntent === void 0 ? void 0 : paymentIntent.status) !== null && _b !== void 0 ? _b : null,
        terminalNonpayment: sessionExpired || paymentIntentCanceled,
        disposition: providerHasPayment ? "paid_observed" :
            sessionExpired ? "session_expired" :
                paymentIntentCanceled ? "payment_intent_canceled" : "payment_pending",
    });
}
async function recordPaygClassCancellationCheckoutExpiryRequest(intentRef, classId, operationId, checkoutSessionId) {
    const classRef = db().collection("classes").doc(classId);
    await db().runTransaction(async (tx) => {
        const [intent, frozenClass] = await Promise.all([
            tx.get(intentRef),
            tx.get(classRef),
        ]);
        const intentClass = intent.get("class");
        if (!intent.exists || !frozenClass.exists ||
            (intentClass === null || intentClass === void 0 ? void 0 : intentClass.classId) !== classId ||
            intent.get("checkoutSessionId") !== checkoutSessionId ||
            intent.get("classCancellationOperationId") !== operationId ||
            frozenClass.get("status") !== "scheduled" ||
            frozenClass.get("bookingOpen") !== false ||
            frozenClass.get("bookingClosedReason") !== "class_cancellation" ||
            frozenClass.get("cancellationOperationId") !== operationId) {
            throw new Error(`Class cancellation ${operationId} changed before Checkout expiry.`);
        }
        tx.set(intentRef, {
            classCancellationCheckoutExpiryVersion: 1,
            classCancellationCheckoutExpirySessionId: checkoutSessionId,
            classCancellationCheckoutExpiryRequestedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        }, { merge: true });
    });
}
/**
 * Expires the exact still-open Stripe Checkout Session owned by a frozen class.
 * A completion race is re-read and routed through canonical paid fulfilment;
 * local capacity is released only after irreversible provider nonpayment.
 */
async function reconcilePaygCheckoutForClassCancellation(intentRef, classId, operationId) {
    var _a;
    const initial = await intentRef.get();
    if (!initial.exists) {
        throw new Error(`PAYG intent ${intentRef.id} disappeared.`);
    }
    const intent = initial.data();
    if (((_a = intent.class) === null || _a === void 0 ? void 0 : _a.classId) !== classId ||
        initial.get("classCancellationOperationId") !== operationId) {
        throw new Error(`PAYG intent ${intentRef.id} is not owned by ${operationId}.`);
    }
    const sessionId = typeof intent.checkoutSessionId === "string" &&
        intent.checkoutSessionId.trim() ? intent.checkoutSessionId.trim() : null;
    if (!sessionId) {
        // Missing local identity can be an accepted create whose response was
        // lost. It remains held and blocked for exact idempotent recovery.
        return observePaygCheckoutForClassCancellation(intentRef, classId, operationId);
    }
    const client = stripe();
    let session = await client.checkout.sessions.retrieve(sessionId);
    assertSessionBinding(session, intentRef.id, intent);
    if (session.status === "open") {
        await recordPaygClassCancellationCheckoutExpiryRequest(intentRef, classId, operationId, session.id);
        try {
            session = await client.checkout.sessions.expire(session.id);
            assertSessionBinding(session, intentRef.id, intent);
        }
        catch (error) {
            // Stripe may have accepted expiry while the response was lost, or a
            // payment may have completed first. Re-read the exact Session; only a
            // still-open result preserves the original ambiguity/error.
            session = await client.checkout.sessions.retrieve(sessionId);
            assertSessionBinding(session, intentRef.id, intent);
            if (session.status === "open")
                throw error;
        }
    }
    const paymentIntentId = idOf(session.payment_intent);
    const paymentIntent = paymentIntentId ?
        await client.paymentIntents.retrieve(paymentIntentId) : null;
    if (paymentIntent) {
        assertStripeObjectMode("PaymentIntent", paymentIntent.id, paymentIntent.livemode);
    }
    const providerHasPayment = session.payment_status === "paid" ||
        Boolean(paymentIntent && (paymentIntent.status === "succeeded" ||
            paymentIntent.amount_received > 0));
    if (providerHasPayment) {
        await fulfilPaygCheckoutSession(session);
        return observePaygCheckoutForClassCancellation(intentRef, classId, operationId);
    }
    let observation = await observePaygCheckoutForClassCancellation(intentRef, classId, operationId);
    if (observation.terminalNonpayment) {
        await releasePaygHoldForClassCancellation(intentRef, classId, operationId);
        // Re-observe after the local release so finalization is tied to fresh
        // provider evidence rather than a wall-clock or pre-release snapshot.
        observation = await observePaygCheckoutForClassCancellation(intentRef, classId, operationId);
    }
    return observation;
}
async function resumeExistingPaygCheckout(client, intentRef) {
    const readResumableIntent = async () => {
        const snapshot = await intentRef.get();
        if (!snapshot.exists) {
            throw paygError("deadline-exceeded", "This PAYG checkout ended. Start again with a new checkout attempt.");
        }
        const current = snapshot.data();
        const cutoff = timestampMillis(snapshot.get(exports.PAYG_PII_RETENTION_CUTOFF_FIELD));
        const privacyAlreadyClosed = hasNonNullDocumentField(snapshot, "piiScrubbedAt");
        if (!privacyAlreadyClosed && cutoff !== null && cutoff > Date.now()) {
            return current;
        }
        const piiPresent = exports.PAYG_INTENT_PII_FIELDS.some((field) => hasNonNullDocumentField(snapshot, field));
        await intentRef.set(Object.assign(Object.assign({ [exports.PAYG_PII_REDACTION_RETRY_FIELD]: piiPresent ?
                serverTimestamp() : firestore_1.FieldValue.delete() }, (privacyAlreadyClosed && piiPresent ? {
            piiRedactionReintroducedAt: serverTimestamp(),
        } : {})), { piiScrubAt: firestore_1.FieldValue.delete(), piiDeleteAt: firestore_1.FieldValue.delete(), updatedAt: serverTimestamp() }), { merge: true });
        throw paygError("deadline-exceeded", "This PAYG checkout ended. Start again with a new checkout attempt.");
    };
    let intent = await readResumableIntent();
    if (!intent.checkoutSessionId) {
        throw paygError("unavailable", "This PAYG checkout is being recovered. Retry the same attempt shortly.");
    }
    let session;
    try {
        session = await client.checkout.sessions.retrieve(intent.checkoutSessionId);
    }
    catch (_a) {
        throw paygError("unavailable", "This PAYG checkout could not be verified. Retry the same attempt shortly.");
    }
    assertSessionBinding(session, intentRef.id, intent);
    if (session.status === "open" && session.expires_at > Math.floor(Date.now() / 1000)) {
        // Provider I/O can outlive the privacy window. Re-read immediately before
        // returning the customer-bearing URL and fail closed if closure won.
        intent = await readResumableIntent();
        return checkoutResponse("resumed", session, intent);
    }
    if (session.status === "complete") {
        throw paygError("failed-precondition", "This checkout has already been submitted and payment is processing.", "checkout_processing");
    }
    await releasePaygHold(intentRef, "stripe_session_ended", session.id);
    throw paygError("deadline-exceeded", "This PAYG checkout expired. Start again with a new checkout attempt.");
}
function paygRequestSourceAddress(request) {
    var _a, _b, _c, _d, _e, _f, _g;
    return canonicalizePaygSourceAddress((_e = (_b = (_a = request === null || request === void 0 ? void 0 : request.rawRequest) === null || _a === void 0 ? void 0 : _a.ip) !== null && _b !== void 0 ? _b : (_d = (_c = request === null || request === void 0 ? void 0 : request.rawRequest) === null || _c === void 0 ? void 0 : _c.socket) === null || _d === void 0 ? void 0 : _d.remoteAddress) !== null && _e !== void 0 ? _e : (_g = (_f = request === null || request === void 0 ? void 0 : request.rawRequest) === null || _f === void 0 ? void 0 : _f.headers) === null || _g === void 0 ? void 0 : _g["x-forwarded-for"]);
}
async function admitPaygCheckoutAttempt(request, normalized, requestFingerprint, nowMillis) {
    const secret = paygCheckoutRateLimitSecret.value().trim();
    const keys = derivePaygAbuseKeys(secret, paygRequestSourceAddress(request), normalized.checkoutAttemptId, requestFingerprint, nowMillis);
    const duplicateLockCandidates = derivePaygDuplicateLockCandidates(duplicateLockKeyring(nowMillis), normalized.classId, normalized.attendee.fullName, normalized.attendee.dateOfBirth);
    const currentDuplicateLock = duplicateLockCandidates[0];
    if (!currentDuplicateLock) {
        throw new Error("PAYG duplicate-lock keyring has no signing key.");
    }
    const admissionRef = db().collection(exports.PAYG_CHECKOUT_ADMISSION_COLLECTION)
        .doc(keys.attemptId);
    const minuteRef = db().collection(exports.PAYG_CHECKOUT_RATE_LIMIT_COLLECTION)
        .doc(keys.minuteBucketId);
    const hourRef = db().collection(exports.PAYG_CHECKOUT_RATE_LIMIT_COLLECTION)
        .doc(keys.hourBucketId);
    await db().runTransaction(async (tx) => {
        var _a, _b, _c;
        const [admission, minute, hour] = await Promise.all([
            tx.get(admissionRef),
            tx.get(minuteRef),
            tx.get(hourRef),
        ]);
        if (admission.exists) {
            if (admission.get("requestBinding") !== keys.requestBinding) {
                throw paygError("failed-precondition", "This PAYG checkout attempt was already used with different details.");
            }
            const retryDecision = resolvePaygIdempotentRetryAdmission({
                currentRetryCount: (_a = admission.get("retryCount")) !== null && _a !== void 0 ? _a : 0,
                windowStartedAtMillis: (_b = timestampMillis(admission.get("retryWindowStartedAt"))) !== null && _b !== void 0 ? _b : timestampMillis(admission.get("createdAt")),
                lastAttemptAtMillis: (_c = timestampMillis(admission.get("lastAttemptAt"))) !== null && _c !== void 0 ? _c : timestampMillis(admission.get("createdAt")),
                nowMillis,
            });
            if (!retryDecision.allowed) {
                if (retryDecision.reason === "invalid_state") {
                    console.error("CRITICAL_PAYG_RETRY_ADMISSION_INVALID", {
                        attemptId: keys.attemptId,
                    });
                }
                throw paygError("resource-exhausted", retryDecision.reason === "too_soon" ?
                    "Wait a moment before retrying this PAYG checkout." :
                    "This PAYG checkout has been retried too many times. Wait before trying again.", "payg_attempt_retry_limited");
            }
            tx.set(admissionRef, {
                retryCount: retryDecision.retryCount,
                retryWindowStartedAt: firestore_1.Timestamp.fromMillis(retryDecision.windowStartedAtMillis),
                lastAttemptAt: firestore_1.Timestamp.fromMillis(nowMillis),
                updatedAt: serverTimestamp(),
                expiresAt: firestore_1.Timestamp.fromMillis(nowMillis + 48 * 60 * 60 * 1000),
            }, { merge: true });
            return;
        }
        const minuteCount = typeof minute.get("count") === "number" ?
            Number(minute.get("count")) : 0;
        const hourCount = typeof hour.get("count") === "number" ?
            Number(hour.get("count")) : 0;
        if (minuteCount >= exports.PAYG_RATE_LIMITS.attemptsPerMinute ||
            hourCount >= exports.PAYG_RATE_LIMITS.attemptsPerHour) {
            throw paygError("resource-exhausted", "Too many PAYG checkout attempts. Wait before trying again.", "payg_rate_limited");
        }
        tx.create(admissionRef, {
            schemaVersion: exports.PAYG_SCHEMA_VERSION,
            requestBinding: keys.requestBinding,
            sourcePseudonym: keys.sourcePseudonym,
            retryCount: 0,
            retryWindowStartedAt: firestore_1.Timestamp.fromMillis(nowMillis),
            lastAttemptAt: firestore_1.Timestamp.fromMillis(nowMillis),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            expiresAt: firestore_1.Timestamp.fromMillis(nowMillis + 48 * 60 * 60 * 1000),
        });
        tx.set(minuteRef, {
            schemaVersion: exports.PAYG_SCHEMA_VERSION,
            kind: "minute",
            count: firestore_1.FieldValue.increment(1),
            updatedAt: serverTimestamp(),
            expiresAt: firestore_1.Timestamp.fromMillis(nowMillis + 2 * 60 * 60 * 1000),
        }, { merge: true });
        tx.set(hourRef, {
            schemaVersion: exports.PAYG_SCHEMA_VERSION,
            kind: "hour",
            count: firestore_1.FieldValue.increment(1),
            updatedAt: serverTimestamp(),
            expiresAt: firestore_1.Timestamp.fromMillis(nowMillis + 48 * 60 * 60 * 1000),
        }, { merge: true });
    });
    return {
        duplicateLockId: currentDuplicateLock.lockId,
        duplicateLockKeyId: currentDuplicateLock.kid,
        duplicateLockCandidates,
    };
}
function buildCreatePaygCheckoutSession() {
    return (0, https_1.onCall)({
        region: REGION,
        secrets: exports.PAYG_CHECKOUT_SECRETS,
        enforceAppCheck: !isFirebaseFunctionsEmulatorProcess(),
        consumeAppCheckToken: !isFirebaseFunctionsEmulatorProcess(),
        timeoutSeconds: 120,
    }, async (request) => {
        assertPaygCheckoutAppCheck(request);
        requirePaygAvailability();
        const legal = resolveLegalConfig(true);
        const privacy = resolvePiiRetentionConfig();
        const normalized = normalizePaygCheckoutRequest(request.data, legal);
        const fingerprint = paygCheckoutRequestFingerprint(normalized, legal);
        const acceptanceEvidenceDigest = derivePaygAcceptanceEvidenceDigest(paygDuplicateLockSecret.value().trim(), normalized, legal);
        const nowMillis = Date.now();
        assertPaygDataPlaneEnvironment();
        const admission = await admitPaygCheckoutAttempt(request, normalized, fingerprint, nowMillis);
        const { client, environment, ids } = await loadApprovedPaygPrice();
        const origin = resolvePublicOrigin();
        const nowUnixSeconds = Math.floor(nowMillis / 1000);
        const intentRef = db().collection("paygIntents")
            .doc(paygIntentId(normalized.checkoutAttemptId));
        const duplicateLockRefs = admission.duplicateLockCandidates.map((candidate) => db().collection(exports.PAYG_DUPLICATE_LOCK_COLLECTION).doc(candidate.lockId));
        const duplicateLockRef = duplicateLockRefs[0];
        if (!duplicateLockRef) {
            throw paygError("failed-precondition", "PAYG duplicate protection is unavailable.");
        }
        const checkoutAttemptHash = sha256(`payg-checkout-attempt:${normalized.checkoutAttemptId}`);
        const reservation = await db().runTransaction(async (tx) => {
            const reservationNowMillis = Math.max(nowMillis, Date.now());
            const [existing, classSnap, duplicateLocks] = await Promise.all([
                tx.get(intentRef),
                tx.get(db().collection("classes").doc(normalized.classId)),
                Promise.all(duplicateLockRefs.map((ref) => tx.get(ref))),
            ]);
            if (existing.exists) {
                const intent = existing.data();
                const piiRetentionCutoff = timestampMillis(existing.get(exports.PAYG_PII_RETENTION_CUTOFF_FIELD));
                const privacyAlreadyClosed = hasNonNullDocumentField(existing, "piiScrubbedAt");
                const piiPresent = exports.PAYG_INTENT_PII_FIELDS.some((field) => hasNonNullDocumentField(existing, field));
                if (privacyAlreadyClosed || piiRetentionCutoff === null ||
                    piiRetentionCutoff <= reservationNowMillis) {
                    tx.set(existing.ref, Object.assign(Object.assign({ [exports.PAYG_PII_REDACTION_RETRY_FIELD]: piiPresent ?
                            serverTimestamp() : firestore_1.FieldValue.delete() }, (privacyAlreadyClosed && piiPresent ? {
                        piiRedactionReintroducedAt: serverTimestamp(),
                    } : {})), { piiScrubAt: firestore_1.FieldValue.delete(), piiDeleteAt: firestore_1.FieldValue.delete(), updatedAt: serverTimestamp() }), { merge: true });
                    return { kind: "ended", intent };
                }
                if (intent.requestFingerprint !== fingerprint ||
                    intent.checkoutAttemptHash !== checkoutAttemptHash) {
                    throw paygError("failed-precondition", "This checkout attempt was already used with different PAYG details.");
                }
                if (!admission.duplicateLockCandidates.some((candidate) => candidate.lockId === intent.duplicateLockId)) {
                    throw paygError("failed-precondition", "This PAYG attempt does not match its class-attendee reservation.");
                }
                if (intent.stripeMode !== environment.stripeMode ||
                    intent.stripePriceId !== ids.priceId ||
                    intent.stripeProductId !== ids.productId) {
                    throw paygError("failed-precondition", "This PAYG attempt belongs to a different approved Stripe catalogue.");
                }
                if (intent.status === "fulfilled" || intent.status === "payment_pending") {
                    return { kind: "processing", intent };
                }
                if (intent.status === "expired" || intent.status === "failed" ||
                    intent.capacityState === "released") {
                    return { kind: "ended", intent };
                }
                if (intent.status === "checkout_created") {
                    return { kind: "resume", intent };
                }
                return { kind: "reserved", intent };
            }
            if (!classSnap.exists) {
                throw paygError("not-found", "That class was not found.", "class_unavailable");
            }
            const publicClass = sanitizePublicPaygClass(classSnap.id, classSnap.data(), nowMillis);
            if (!publicClass || publicClass.availability === "unavailable") {
                throw paygError("failed-precondition", "That class is not available for Pay As You Go booking.", "class_unavailable");
            }
            if (publicClass.availability === "full") {
                throw paygError("failed-precondition", "That class is full.", "class_full");
            }
            const classCapacity = Number(classSnap.get("capacity"));
            const unpaidHoldLimit = resolvePaygUnpaidHoldLimit(classCapacity);
            const storedUnpaidHolds = classSnap.get("paygUnpaidHoldCount");
            if (unpaidHoldLimit < 1 || (storedUnpaidHolds !== undefined &&
                (!Number.isSafeInteger(storedUnpaidHolds) || storedUnpaidHolds < 0))) {
                console.error("CRITICAL_PAYG_UNPAID_HOLD_COUNTER_INVALID", {
                    classId: classSnap.id,
                    storedUnpaidHolds: typeof storedUnpaidHolds === "number" ?
                        storedUnpaidHolds : null,
                });
                throw paygError("failed-precondition", "That class is temporarily unavailable for PAYG checkout.", "payg_class_hold_counter_invalid");
            }
            const activeUnpaidHolds = Number(storedUnpaidHolds !== null && storedUnpaidHolds !== void 0 ? storedUnpaidHolds : 0);
            if (activeUnpaidHolds >= unpaidHoldLimit) {
                throw paygError("resource-exhausted", "That class has several PAYG checkouts in progress. Try again shortly.", "payg_class_checkout_busy");
            }
            const classStartMillis = Date.parse(publicClass.startTime);
            const classEndMillis = Date.parse(publicClass.endTime);
            const ageAtClass = resolveAgeAtMillis(normalized.attendee.dateOfBirth, classStartMillis);
            if (ageAtClass < 18 || ageAtClass > 120) {
                throw paygError("failed-precondition", "Pay As You Go class checkout is available only to adults aged 18 or over.", "adult_attendee_required");
            }
            const checkoutExpiresAt = Math.min(nowUnixSeconds + exports.PAYG_HOLD_DURATION_SECONDS, Math.floor(classStartMillis / 1000) - 60);
            if (checkoutExpiresAt - nowUnixSeconds < exports.PAYG_MINIMUM_CHECKOUT_WINDOW_SECONDS) {
                throw paygError("failed-precondition", "That class is too close to its start time for a new PAYG checkout.", "class_unavailable");
            }
            const activeDuplicateLock = duplicateLocks.find((lock) => {
                const activeUntil = timestampMillis(lock.get("activeUntil"));
                return lock.exists && lock.get("intentId") !== intentRef.id &&
                    (lock.get("status") === "held" || lock.get("status") === "booked") &&
                    activeUntil !== null && activeUntil > nowMillis;
            });
            if (activeDuplicateLock) {
                throw paygError("already-exists", "This attendee already has an active place or checkout for that class.", "payg_duplicate_class_attendee");
            }
            const attendee = Object.freeze(Object.assign(Object.assign({}, normalized.attendee), { ageAtClass }));
            const classSnapshot = classSnapshotFromPublic(publicClass);
            const intentPiiRetentionCutoffAt = firestore_1.Timestamp.fromMillis(checkoutExpiresAt * 1000 + exports.PAYG_UNPAID_INTENT_RETENTION_MS);
            const intent = {
                schemaVersion: exports.PAYG_SCHEMA_VERSION,
                checkoutSchemaVersion: exports.PAYG_CHECKOUT_SCHEMA_VERSION,
                offeringKey: exports.PAYG_OFFERING_KEY,
                purchaseKind: exports.PAYG_PURCHASE_KIND,
                status: "reserved",
                capacityState: "held",
                unpaidHoldState: "counted",
                stripeMode: environment.stripeMode,
                stripePriceId: ids.priceId,
                stripeProductId: ids.productId,
                checkoutAttemptHash,
                requestFingerprint: fingerprint,
                duplicateLockId: admission.duplicateLockId,
                attendee,
                contact: normalized.contact,
                acceptances: Object.assign(Object.assign({}, normalized.acceptances), { legal, acceptedAt: serverTimestamp() }),
                acceptanceEvidenceDigest,
                privacy,
                class: classSnapshot,
                classStartMillis,
                classEndMillis,
                amountPence: exports.PAYG_AMOUNT_PENCE,
                currency: exports.PAYG_CURRENCY,
                publicOrigin: origin,
                checkoutExpiresAt,
                checkoutSessionId: null,
                checkoutSessionUrl: null,
                paymentIntentId: null,
                orderId: null,
                holdExpiresAt: firestore_1.Timestamp.fromMillis(checkoutExpiresAt * 1000),
                // The cutoff is immutable legal/privacy evidence. Only the separate
                // retry timestamp may move after a transient redaction failure.
                piiRetentionCutoffAt: intentPiiRetentionCutoffAt,
                piiRedactionRetryAt: intentPiiRetentionCutoffAt,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            };
            tx.create(intentRef, intent);
            tx.set(duplicateLockRef, {
                schemaVersion: exports.PAYG_SCHEMA_VERSION,
                status: "held",
                intentId: intentRef.id,
                lockKeyId: admission.duplicateLockKeyId,
                classIdHash: hmacSha256(paygCheckoutRateLimitSecret.value().trim(), `payg-class:v1:${normalized.classId}`),
                activeUntil: firestore_1.Timestamp.fromMillis(checkoutExpiresAt * 1000),
                deleteAt: firestore_1.Timestamp.fromMillis(classEndMillis + exports.PAYG_UNPAID_INTENT_RETENTION_MS),
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
            tx.set(classSnap.ref, {
                bookedCount: firestore_1.FieldValue.increment(1),
                paygUnpaidHoldCount: firestore_1.FieldValue.increment(1),
                paygUnpaidHoldLimit: unpaidHoldLimit,
                updatedAt: serverTimestamp(),
            }, { merge: true });
            return { kind: "reserved", intent };
        });
        if (reservation.kind === "processing") {
            throw paygError("failed-precondition", "This checkout has already been submitted and payment is processing.", "checkout_processing");
        }
        if (reservation.kind === "ended") {
            throw paygError("deadline-exceeded", "This PAYG checkout ended. Start again with a new checkout attempt.");
        }
        if (reservation.kind === "resume") {
            return resumeExistingPaygCheckout(client, intentRef);
        }
        const intent = reservation.intent;
        const params = buildPaygCheckoutSessionParams({
            intentId: intentRef.id,
            classId: intent.class.classId,
            classTitle: intent.class.title,
            email: intent.contact.email,
            priceId: intent.stripePriceId,
            publicOrigin: intent.publicOrigin,
            checkoutExpiresAt: intent.checkoutExpiresAt,
        });
        let session;
        try {
            session = await client.checkout.sessions.create(params, {
                idempotencyKey: `payg-checkout:${intent.checkoutAttemptHash}`,
            });
            assertSessionBinding(session, intentRef.id, intent);
        }
        catch (error) {
            if (isDefinitiveStripeCreateFailure(error)) {
                await releasePaygHold(intentRef, "checkout_create_failed");
                console.error("Stripe rejected PAYG Checkout creation", {
                    intentId: intentRef.id,
                    error,
                });
                throw paygError("failed-precondition", "PAYG Checkout could not start because its billing setup needs attention.", "stripe_checkout_configuration");
            }
            // The provider may have accepted an idempotent request before a timeout.
            // Keep the hold so this exact attempt or the recovery worker can replay it.
            throw error;
        }
        if (!session.url) {
            throw paygError("internal", "Stripe did not return a PAYG Checkout URL.");
        }
        const sessionWrite = await db().runTransaction(async (tx) => {
            const fresh = await tx.get(intentRef);
            if (!fresh.exists)
                throw new Error(`PAYG intent ${intentRef.id} disappeared.`);
            const current = fresh.data();
            if (current.checkoutSessionId && current.checkoutSessionId !== session.id) {
                throw new Error(`PAYG intent ${intentRef.id} is bound to another Session.`);
            }
            if (current.capacityState !== "held" ||
                current.status === "expired" || current.status === "failed") {
                throw paygError("deadline-exceeded", "This PAYG hold ended before Stripe returned. Start again.");
            }
            const cutoff = timestampMillis(fresh.get(exports.PAYG_PII_RETENTION_CUTOFF_FIELD));
            const privacyAlreadyClosed = hasNonNullDocumentField(fresh, "piiScrubbedAt");
            if (privacyAlreadyClosed || cutoff === null || cutoff <= Date.now()) {
                const piiPresent = exports.PAYG_INTENT_PII_FIELDS.some((field) => hasNonNullDocumentField(fresh, field));
                tx.set(intentRef, Object.assign(Object.assign({ checkoutSessionId: session.id, checkoutSessionUrl: firestore_1.FieldValue.delete(), [exports.PAYG_PII_REDACTION_RETRY_FIELD]: piiPresent ?
                        serverTimestamp() : firestore_1.FieldValue.delete() }, (privacyAlreadyClosed && piiPresent ? {
                    piiRedactionReintroducedAt: serverTimestamp(),
                } : {})), { piiScrubAt: firestore_1.FieldValue.delete(), piiDeleteAt: firestore_1.FieldValue.delete(), privacyRecoveryBlockedAt: serverTimestamp(), updatedAt: serverTimestamp() }), { merge: true });
                return "privacy_closed";
            }
            tx.set(intentRef, {
                status: "checkout_created",
                checkoutSessionId: session.id,
                checkoutSessionUrl: session.url,
                updatedAt: serverTimestamp(),
            }, { merge: true });
            return "recorded";
        });
        if (sessionWrite === "privacy_closed") {
            let finalSession = session;
            if (finalSession.status === "open") {
                try {
                    finalSession = await client.checkout.sessions.expire(finalSession.id);
                }
                catch (error) {
                    finalSession = await client.checkout.sessions.retrieve(finalSession.id);
                    if (finalSession.status === "open")
                        throw error;
                }
            }
            if (finalSession.status === "complete" &&
                finalSession.payment_status === "paid") {
                await fulfilPaygCheckoutSession(finalSession);
            }
            else {
                await releasePaygHold(intentRef, "privacy_redacted_during_checkout_creation", finalSession.id);
            }
            throw paygError("deadline-exceeded", "This PAYG checkout ended before Stripe returned. Start again.");
        }
        return checkoutResponse("created", session, Object.assign(Object.assign({}, intent), { status: "checkout_created", checkoutSessionId: session.id, checkoutSessionUrl: session.url }));
    });
}
function exactPaygLineItem(items, intent) {
    if (items.has_more || items.data.length !== 1)
        return false;
    const item = items.data[0];
    const price = typeof item.price === "object" && item.price ? item.price : null;
    return item.quantity === 1 &&
        item.amount_total === exports.PAYG_AMOUNT_PENCE &&
        item.currency === exports.PAYG_CURRENCY &&
        (price === null || price === void 0 ? void 0 : price.id) === intent.stripePriceId &&
        idOf(price === null || price === void 0 ? void 0 : price.product) === intent.stripeProductId;
}
function collectPaygPaidContractMismatches(input) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
    const { session, paymentIntent } = input;
    const sessionEmail = ((_b = (_a = session.customer_details) === null || _a === void 0 ? void 0 : _a.email) === null || _b === void 0 ? void 0 : _b.trim().toLowerCase()) ||
        ((_c = session.customer_email) === null || _c === void 0 ? void 0 : _c.trim().toLowerCase()) || null;
    const mismatches = [];
    if (session.livemode !== input.expectedLivemode)
        mismatches.push("session_mode");
    if (session.mode !== "payment" || session.client_reference_id !== input.intentId ||
        ((_d = session.metadata) === null || _d === void 0 ? void 0 : _d.purchaseKind) !== exports.PAYG_PURCHASE_KIND ||
        ((_e = session.metadata) === null || _e === void 0 ? void 0 : _e.offeringKey) !== exports.PAYG_OFFERING_KEY ||
        ((_f = session.metadata) === null || _f === void 0 ? void 0 : _f.paygIntentId) !== input.intentId ||
        ((_g = session.metadata) === null || _g === void 0 ? void 0 : _g.classId) !== input.expectedClassId) {
        mismatches.push("session_binding");
    }
    if (session.status !== "complete" || session.payment_status !== "paid") {
        mismatches.push("session_payment_state");
    }
    if (session.amount_total !== exports.PAYG_AMOUNT_PENCE ||
        session.currency !== exports.PAYG_CURRENCY ||
        ((_j = (_h = session.total_details) === null || _h === void 0 ? void 0 : _h.amount_discount) !== null && _j !== void 0 ? _j : 0) !== 0 ||
        session.subscription !== null) {
        mismatches.push("session_commercial_contract");
    }
    if (sessionEmail !== input.expectedEmail)
        mismatches.push("session_email");
    if (paymentIntent.livemode !== input.expectedLivemode) {
        mismatches.push("payment_intent_mode");
    }
    if (paymentIntent.status !== "succeeded" ||
        paymentIntent.amount !== exports.PAYG_AMOUNT_PENCE ||
        paymentIntent.amount_received !== exports.PAYG_AMOUNT_PENCE ||
        paymentIntent.currency !== exports.PAYG_CURRENCY) {
        mismatches.push("payment_intent_commercial_contract");
    }
    if (((_k = paymentIntent.metadata) === null || _k === void 0 ? void 0 : _k.purchaseKind) !== exports.PAYG_PURCHASE_KIND ||
        ((_l = paymentIntent.metadata) === null || _l === void 0 ? void 0 : _l.offeringKey) !== exports.PAYG_OFFERING_KEY ||
        ((_m = paymentIntent.metadata) === null || _m === void 0 ? void 0 : _m.paygIntentId) !== input.intentId ||
        ((_o = paymentIntent.metadata) === null || _o === void 0 ? void 0 : _o.classId) !== input.expectedClassId ||
        ((_p = paymentIntent.metadata) === null || _p === void 0 ? void 0 : _p.schemaVersion) !== String(exports.PAYG_SCHEMA_VERSION)) {
        mismatches.push("payment_intent_binding");
    }
    if (!input.exactLineItem)
        mismatches.push("line_item_contract");
    // Keep these parameters in the pure contract even though exactLineItem is
    // calculated from them by the runtime helper.
    if (!input.expectedPriceId || !input.expectedProductId) {
        mismatches.push("catalogue_evidence");
    }
    return [...new Set(mismatches)];
}
function isPaygPaymentRefundSafe(paymentIntent, intentId, expectedLivemode) {
    var _a, _b, _c, _d;
    return paymentIntent.livemode === expectedLivemode &&
        paymentIntent.status === "succeeded" &&
        paymentIntent.amount_received > 0 &&
        paymentIntent.currency === exports.PAYG_CURRENCY &&
        ((_a = paymentIntent.metadata) === null || _a === void 0 ? void 0 : _a.purchaseKind) === exports.PAYG_PURCHASE_KIND &&
        ((_b = paymentIntent.metadata) === null || _b === void 0 ? void 0 : _b.offeringKey) === exports.PAYG_OFFERING_KEY &&
        ((_c = paymentIntent.metadata) === null || _c === void 0 ? void 0 : _c.paygIntentId) === intentId &&
        ((_d = paymentIntent.metadata) === null || _d === void 0 ? void 0 : _d.schemaVersion) === String(exports.PAYG_SCHEMA_VERSION);
}
function paygSuccessfulPaymentCompletedSecond(input) {
    const { paymentIntent, charge, successEvidence } = input;
    if (!charge || !successEvidence ||
        !isPaygPaymentRefundSafe(paymentIntent, input.intentId, input.expectedLivemode) ||
        idOf(paymentIntent.latest_charge) !== charge.id ||
        idOf(charge.payment_intent) !== paymentIntent.id ||
        charge.livemode !== input.expectedLivemode ||
        charge.paid !== true || charge.status !== "succeeded" ||
        successEvidence.intentId !== input.intentId ||
        successEvidence.checkoutSessionId !== input.checkoutSessionId ||
        successEvidence.paymentIntentId !== paymentIntent.id ||
        successEvidence.livemode !== input.expectedLivemode ||
        !/^evt_[A-Za-z0-9_]{4,250}$/.test(successEvidence.providerEventId) ||
        (successEvidence.providerEventType !== "checkout.session.completed" &&
            successEvidence.providerEventType !==
                "checkout.session.async_payment_succeeded") ||
        !Number.isSafeInteger(successEvidence.providerEventCreatedSecond) ||
        successEvidence.providerEventCreatedSecond <= 0 ||
        !Number.isSafeInteger((successEvidence.providerEventCreatedSecond + 1) * 1000))
        return null;
    return successEvidence.providerEventCreatedSecond;
}
function paygPaymentCompletedBeforePiiCutoff(input) {
    const paymentCompletedSecond = paygSuccessfulPaymentCompletedSecond(input);
    return paymentCompletedSecond !== null &&
        input.piiRetentionCutoffAtMillis !== null &&
        Number.isSafeInteger(input.piiRetentionCutoffAtMillis) &&
        // Stripe timestamps have whole-second precision. Accept only when the
        // entire recorded success second precedes the immutable privacy boundary;
        // a success event in the cutoff second is intentionally rejected.
        (paymentCompletedSecond + 1) * 1000 <= input.piiRetentionCutoffAtMillis;
}
function hasCompletePaygIntentPiiEvidence(intent) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r;
    return Boolean(
    // Once privacy has closed, a stale/manual write that puts identity fields
    // back on the intent must never reopen promotion into paid-record PII.
    (intent.piiScrubbedAt === undefined || intent.piiScrubbedAt === null) &&
        ((_a = intent.attendee) === null || _a === void 0 ? void 0 : _a.fullName) && ((_b = intent.attendee) === null || _b === void 0 ? void 0 : _b.dateOfBirth) &&
        ((_c = intent.contact) === null || _c === void 0 ? void 0 : _c.email) &&
        ((_f = (_e = (_d = intent.acceptances) === null || _d === void 0 ? void 0 : _d.legal) === null || _e === void 0 ? void 0 : _e.waiver) === null || _f === void 0 ? void 0 : _f.sha256) &&
        ((_j = (_h = (_g = intent.acceptances) === null || _g === void 0 ? void 0 : _g.legal) === null || _h === void 0 ? void 0 : _h.terms) === null || _j === void 0 ? void 0 : _j.sha256) &&
        ((_m = (_l = (_k = intent.acceptances) === null || _k === void 0 ? void 0 : _k.legal) === null || _l === void 0 ? void 0 : _l.privacyNotice) === null || _m === void 0 ? void 0 : _m.sha256) &&
        ((_o = intent.acceptances) === null || _o === void 0 ? void 0 : _o.privacyNoticeVersionPresented) ===
            ((_r = (_q = (_p = intent.acceptances) === null || _p === void 0 ? void 0 : _p.legal) === null || _q === void 0 ? void 0 : _q.privacyNotice) === null || _r === void 0 ? void 0 : _r.version) &&
        /^[a-f0-9]{64}$/.test(intent.acceptanceEvidenceDigest || "") &&
        resolveStoredPaygPiiRetentionConfig(intent.privacy));
}
function paygPiiPromotionMismatch(input) {
    if (input.intent.piiScrubbedAt !== undefined &&
        input.intent.piiScrubbedAt !== null) {
        return "intent_pii_already_scrubbed";
    }
    if (!hasCompletePaygIntentPiiEvidence(input.intent)) {
        return "intent_evidence_missing";
    }
    const privacy = resolveStoredPaygPiiRetentionConfig(input.intent.privacy);
    if (!privacy)
        return "intent_evidence_missing";
    if (!Number.isSafeInteger(input.processingNowMillis) ||
        input.processingNowMillis <= 0) {
        return "destination_pii_processing_time_invalid";
    }
    let destinationCutoff;
    try {
        destinationCutoff = paygPiiRedactionDeadline(input.intent.classEndMillis, privacy.orderPiiRetentionDays);
    }
    catch (_a) {
        return "destination_pii_retention_cutoff_invalid";
    }
    if (destinationCutoff <= input.processingNowMillis) {
        return "destination_pii_retention_cutoff_reached";
    }
    const cutoff = timestampMillis(input.intent.piiRetentionCutoffAt);
    if (cutoff === null)
        return "intent_pii_retention_cutoff_missing";
    const paymentCompletedSecond = paygSuccessfulPaymentCompletedSecond(input);
    if (paymentCompletedSecond === null) {
        return "payment_completion_evidence_missing";
    }
    return (paymentCompletedSecond + 1) * 1000 <= cutoff ? null :
        "payment_completed_at_or_after_pii_cutoff";
}
class PaygPiiPromotionClosedError extends Error {
    constructor(mismatch) {
        super(`PAYG PII promotion is closed: ${mismatch}.`);
        this.mismatch = mismatch;
    }
}
function buildPaygOrder(intentRef, intent, session, paymentIntent, status, capacityState, bookingId) {
    var _a, _b;
    const privacy = (_a = resolveStoredPaygPiiRetentionConfig(intent.privacy)) !== null && _a !== void 0 ? _a : Object.freeze({
        policyVersion: "unrecorded-v1",
        orderPiiRetentionDays: exports.PAYG_ORDER_PII_RETENTION_DAYS,
        waiverPiiRetentionDays: exports.PAYG_WAIVER_PII_RETENTION_DAYS,
    });
    const piiRetentionCutoffAt = firestore_1.Timestamp.fromMillis(paygPiiRedactionDeadline(intent.classEndMillis, privacy.orderPiiRetentionDays));
    return Object.assign(Object.assign({ schemaVersion: exports.PAYG_SCHEMA_VERSION, orderId: intentRef.id, offeringKey: exports.PAYG_OFFERING_KEY, purchaseKind: exports.PAYG_PURCHASE_KIND, status,
        capacityState, stripeMode: intent.stripeMode, stripePriceId: intent.stripePriceId, stripeProductId: intent.stripeProductId, checkoutSessionId: session.id, paymentIntentId: (_b = paymentIntent === null || paymentIntent === void 0 ? void 0 : paymentIntent.id) !== null && _b !== void 0 ? _b : idOf(session.payment_intent), chargeId: paymentIntent ? idOf(paymentIntent.latest_charge) : null, amountPence: exports.PAYG_AMOUNT_PENCE, currency: exports.PAYG_CURRENCY, attendee: intent.attendee, contact: intent.contact, acceptances: intent.acceptances, acceptanceEvidenceDigest: intent.acceptanceEvidenceDigest, retainedAcceptanceEvidence: retainedPaygAcceptanceEvidence(intent), privacy, class: intent.class, classStartMillis: intent.classStartMillis, classEndMillis: intent.classEndMillis, bookingId, duplicateLockId: intent.duplicateLockId, confirmationEmailStatus: status === "confirmed" ? "pending" : "not_required", refundEmailStatus: "not_required", disputeEmailStatus: "not_required", cancellationCutoffAt: firestore_1.Timestamp.fromMillis(intent.classStartMillis - exports.PAYG_CANCELLATION_CUTOFF_HOURS * 60 * 60 * 1000), piiRetentionCutoffAt, piiRedactionRetryAt: piiRetentionCutoffAt }, (status === "confirmed" ? {
        noShowReviewAt: firestore_1.Timestamp.fromMillis(intent.classEndMillis + exports.PAYG_NO_SHOW_REVIEW_DELAY_MS),
    } : status === "refund_pending" ? {
        refundRecoveryAt: firestore_1.Timestamp.fromMillis(Date.now()),
    } : {})), { createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
}
function retainedPaygAcceptanceEvidence(intent) {
    var _a, _b;
    return Object.freeze({
        adultConfirmed: intent.acceptances.adultConfirmed,
        waiverAccepted: intent.acceptances.waiverAccepted,
        termsAccepted: intent.acceptances.termsAccepted,
        cancellationPolicyAccepted: intent.acceptances.cancellationPolicyAccepted,
        waiver: Object.freeze({
            version: intent.acceptances.legal.waiver.version,
            publicUrl: intent.acceptances.legal.waiver.publicUrl,
            sha256: intent.acceptances.legal.waiver.sha256,
        }),
        terms: Object.freeze({
            version: intent.acceptances.legal.terms.version,
            publicUrl: intent.acceptances.legal.terms.publicUrl,
            sha256: intent.acceptances.legal.terms.sha256,
        }),
        privacyNoticePresented: true,
        privacyNotice: Object.freeze({
            version: intent.acceptances.legal.privacyNotice.version,
            publicUrl: intent.acceptances.legal.privacyNotice.publicUrl,
            sha256: intent.acceptances.legal.privacyNotice.sha256,
        }),
        acceptedAt: intent.acceptances.acceptedAt,
        retentionPolicyVersion: (_b = (_a = resolveStoredPaygPiiRetentionConfig(intent.privacy)) === null || _a === void 0 ? void 0 : _a.policyVersion) !== null && _b !== void 0 ? _b : "unrecorded-v1",
    });
}
function normalizePaygConfirmationLegalAcceptance(value) {
    const acceptedAtMillis = Date.parse(value.acceptedAt);
    if (!Number.isSafeInteger(acceptedAtMillis) || acceptedAtMillis <= 0 ||
        new Date(acceptedAtMillis).toISOString() !== value.acceptedAt) {
        throw new Error("PAYG legal acceptance time is invalid.");
    }
    const normalizeDocument = (kind, document) => {
        if (!/^[A-Za-z0-9._-]{3,120}$/.test(document.version) ||
            !/^[a-f0-9]{64}$/.test(document.sha256)) {
            throw new Error(`PAYG ${kind} confirmation evidence is invalid.`);
        }
        let publicUrl;
        try {
            publicUrl = new URL(document.publicUrl);
        }
        catch (_a) {
            throw new Error(`PAYG ${kind} confirmation URL is invalid.`);
        }
        const loopback = publicUrl.hostname === "localhost" ||
            publicUrl.hostname === "127.0.0.1";
        if ((publicUrl.protocol !== "https:" &&
            !(loopback && publicUrl.protocol === "http:")) ||
            publicUrl.username || publicUrl.password ||
            !publicUrl.pathname.startsWith("/legal/") ||
            publicUrl.search || publicUrl.hash) {
            throw new Error(`PAYG ${kind} confirmation URL is invalid.`);
        }
        return Object.freeze({
            version: document.version,
            publicUrl: publicUrl.href,
            sha256: document.sha256,
        });
    };
    return Object.freeze({
        acceptedAt: value.acceptedAt,
        waiver: normalizeDocument("waiver", value.waiver),
        terms: normalizeDocument("terms", value.terms),
        privacyNotice: normalizeDocument("privacy notice", value.privacyNotice),
    });
}
function validPaygConfirmationLegalAcceptance(value) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    if (!value || typeof value !== "object")
        return false;
    try {
        const candidate = value;
        const normalized = normalizePaygConfirmationLegalAcceptance(candidate);
        return candidate.acceptedAt === normalized.acceptedAt &&
            ((_a = candidate.waiver) === null || _a === void 0 ? void 0 : _a.version) === normalized.waiver.version &&
            ((_b = candidate.waiver) === null || _b === void 0 ? void 0 : _b.publicUrl) === normalized.waiver.publicUrl &&
            ((_c = candidate.waiver) === null || _c === void 0 ? void 0 : _c.sha256) === normalized.waiver.sha256 &&
            ((_d = candidate.terms) === null || _d === void 0 ? void 0 : _d.version) === normalized.terms.version &&
            ((_e = candidate.terms) === null || _e === void 0 ? void 0 : _e.publicUrl) === normalized.terms.publicUrl &&
            ((_f = candidate.terms) === null || _f === void 0 ? void 0 : _f.sha256) === normalized.terms.sha256 &&
            ((_g = candidate.privacyNotice) === null || _g === void 0 ? void 0 : _g.version) === normalized.privacyNotice.version &&
            ((_h = candidate.privacyNotice) === null || _h === void 0 ? void 0 : _h.publicUrl) ===
                normalized.privacyNotice.publicUrl &&
            ((_j = candidate.privacyNotice) === null || _j === void 0 ? void 0 : _j.sha256) === normalized.privacyNotice.sha256;
    }
    catch (_k) {
        return false;
    }
}
function paygConfirmationLegalAcceptance(intent) {
    const acceptedAtMillis = timestampMillis(intent.acceptances.acceptedAt);
    if (acceptedAtMillis === null ||
        !Number.isSafeInteger(acceptedAtMillis) || acceptedAtMillis <= 0 ||
        intent.acceptances.waiverVersion !==
            intent.acceptances.legal.waiver.version ||
        intent.acceptances.termsVersion !== intent.acceptances.legal.terms.version ||
        intent.acceptances.privacyNoticeVersionPresented !==
            intent.acceptances.legal.privacyNotice.version) {
        throw new Error("PAYG stored legal acceptance evidence is invalid.");
    }
    let origin;
    try {
        origin = new URL(intent.publicOrigin);
    }
    catch (_a) {
        throw new Error("PAYG stored public origin is invalid.");
    }
    if (origin.origin !== intent.publicOrigin) {
        throw new Error("PAYG stored public origin is invalid.");
    }
    return normalizePaygConfirmationLegalAcceptance({
        acceptedAt: new Date(acceptedAtMillis).toISOString(),
        waiver: Object.assign(Object.assign({}, intent.acceptances.legal.waiver), { publicUrl: new URL(intent.acceptances.legal.waiver.publicUrl, origin).href }),
        terms: Object.assign(Object.assign({}, intent.acceptances.legal.terms), { publicUrl: new URL(intent.acceptances.legal.terms.publicUrl, origin).href }),
        privacyNotice: Object.assign(Object.assign({}, intent.acceptances.legal.privacyNotice), { publicUrl: new URL(intent.acceptances.legal.privacyNotice.publicUrl, origin).href }),
    });
}
function paygWaiverPiiRetentionCutoffAt(intent) {
    var _a;
    const privacy = (_a = resolveStoredPaygPiiRetentionConfig(intent.privacy)) !== null && _a !== void 0 ? _a : Object.freeze({
        policyVersion: "unrecorded-v1",
        orderPiiRetentionDays: exports.PAYG_ORDER_PII_RETENTION_DAYS,
        waiverPiiRetentionDays: exports.PAYG_WAIVER_PII_RETENTION_DAYS,
    });
    return firestore_1.Timestamp.fromMillis(paygPiiRedactionDeadline(intent.classEndMillis, privacy.waiverPiiRetentionDays));
}
function paygOrderPiiRetentionCutoffAt(intent) {
    var _a;
    const privacy = (_a = resolveStoredPaygPiiRetentionConfig(intent.privacy)) !== null && _a !== void 0 ? _a : Object.freeze({
        policyVersion: "unrecorded-v1",
        orderPiiRetentionDays: exports.PAYG_ORDER_PII_RETENTION_DAYS,
        waiverPiiRetentionDays: exports.PAYG_WAIVER_PII_RETENTION_DAYS,
    });
    return firestore_1.Timestamp.fromMillis(paygPiiRedactionDeadline(intent.classEndMillis, privacy.orderPiiRetentionDays));
}
function buildPaygConfirmationOutboxPayload(input) {
    const origin = input.publicOrigin.replace(/\/$/, "");
    const cancellationUrl = `${origin}/pay-as-you-go/cancel?token=${encodeURIComponent(input.cancellationToken)}`;
    return Object.freeze({
        schemaVersion: exports.PAYG_SCHEMA_VERSION,
        kind: "payg_guest_confirmation",
        orderId: input.orderId,
        idempotencyKey: `payg-confirmation/${input.orderId}/v1`,
        to: Object.freeze([input.recipientEmail]),
        templateData: Object.freeze({
            attendeeName: input.attendeeName,
            class: input.class,
            amountPence: input.amountPence,
            currency: input.currency,
            cancellationPolicy: Object.freeze({
                refundableUntil: new Date(input.cancellationCutoffAtMillis).toISOString(),
                cutoffHours: exports.PAYG_CANCELLATION_CUTOFF_HOURS,
                beforeCutoff: "A cancellation made at least 24 hours before the class is refundable and releases the place.",
                afterCutoff: "A cancellation made under 24 hours before the class, or a no-show, is non-refundable.",
            }),
            cancellationUrl,
            legalAcceptance: normalizePaygConfirmationLegalAcceptance(input.legalAcceptance),
        }),
    });
}
function shouldEnqueuePaygConfirmationCorrection(status) {
    return status === "cancelled" || status === "refund_pending" ||
        status === "refunded" || status === "disputed" ||
        status === "manual_review" || status === "no_show";
}
function paygEmailLeaseCorrelation(leaseToken) {
    if (!/^[A-Za-z0-9-]{16,128}$/.test(leaseToken)) {
        throw new Error("PAYG email lease token is invalid.");
    }
    return sha256(`payg-email-lease:v1:${leaseToken}`);
}
function paygConfirmationCorrectionOutboxId(orderId) {
    if (!/^payg_[a-f0-9]{64}$/.test(orderId)) {
        throw new Error("PAYG correction order ID is invalid.");
    }
    return `payg_correction_${sha256(`payg-confirmation-correction:v1:${orderId}`)}`;
}
function buildPaygConfirmationCorrectionOutboxPayload(input) {
    const outboxId = paygConfirmationCorrectionOutboxId(input.orderId);
    return Object.freeze({
        schemaVersion: exports.PAYG_SCHEMA_VERSION,
        kind: "payg_guest_confirmation_correction",
        orderId: input.orderId,
        outboxId,
        idempotencyKey: `payg-confirmation-correction/${input.orderId}/v1`,
        to: Object.freeze([input.recipientEmail]),
        templateData: Object.freeze({
            attendeeName: input.attendeeName,
            class: input.class,
            amountPence: exports.PAYG_AMOUNT_PENCE,
            currency: exports.PAYG_CURRENCY,
            orderStatus: input.orderStatus,
        }),
    });
}
function assertPaygLifecycleStripeId(value, prefix, field) {
    if (!value.startsWith(prefix) ||
        !/^[A-Za-z0-9_]{7,255}$/.test(value)) {
        throw new Error(`PAYG lifecycle ${field} is invalid.`);
    }
    return value;
}
function paygRefundOutboxId(orderId) {
    if (!/^payg_[a-f0-9]{64}$/.test(orderId)) {
        throw new Error("PAYG refund email order ID is invalid.");
    }
    return `payg_refund_${sha256(`payg-refund-confirmed:v1:${orderId}`)}`;
}
function paygDisputeOutboxId(orderId) {
    if (!/^payg_[a-f0-9]{64}$/.test(orderId)) {
        throw new Error("PAYG dispute email order ID is invalid.");
    }
    return `payg_dispute_${sha256(`payg-dispute-detected:v1:${orderId}`)}`;
}
function buildPaygRefundOutboxPayload(input) {
    const outboxId = paygRefundOutboxId(input.orderId);
    const paymentIntentId = assertPaygLifecycleStripeId(input.paymentIntentId, "pi_", "PaymentIntent ID");
    const chargeId = assertPaygLifecycleStripeId(input.chargeId, "ch_", "Charge ID");
    const refundId = assertPaygLifecycleStripeId(input.refundId, "re_", "Refund ID");
    return Object.freeze({
        schemaVersion: exports.PAYG_SCHEMA_VERSION,
        kind: "payg_guest_refund_confirmation",
        orderId: input.orderId,
        outboxId,
        idempotencyKey: `payg-refund-confirmed/${input.orderId}/v1`,
        to: Object.freeze([input.recipientEmail]),
        templateData: Object.freeze({
            attendeeName: input.attendeeName,
            class: input.class,
            amountPence: exports.PAYG_AMOUNT_PENCE,
            currency: exports.PAYG_CURRENCY,
            paymentIntentId,
            chargeId,
            refundId,
        }),
    });
}
function buildPaygDisputeOutboxPayload(input) {
    const outboxId = paygDisputeOutboxId(input.orderId);
    return Object.freeze({
        schemaVersion: exports.PAYG_SCHEMA_VERSION,
        kind: "payg_guest_dispute_notice",
        orderId: input.orderId,
        outboxId,
        idempotencyKey: `payg-dispute-detected/${input.orderId}/v1`,
        to: Object.freeze([input.recipientEmail]),
        templateData: Object.freeze({
            attendeeName: input.attendeeName,
            class: input.class,
            amountPence: exports.PAYG_AMOUNT_PENCE,
            currency: exports.PAYG_CURRENCY,
            paymentIntentId: assertPaygLifecycleStripeId(input.paymentIntentId, "pi_", "PaymentIntent ID"),
            chargeId: assertPaygLifecycleStripeId(input.chargeId, "ch_", "Charge ID"),
            disputeId: assertPaygLifecycleStripeId(input.disputeId, "du_", "Dispute ID"),
        }),
    });
}
function resolvePaygConfirmationPostSend(input) {
    const correlation = paygEmailLeaseCorrelation(input.leaseToken);
    const ownsActiveLease = (input.outboxStatus === "sending" ||
        input.outboxStatus === "reconciling") &&
        input.activeLeaseToken === input.leaseToken;
    const ownsTombstonedLease = input.outboxStatus === "tombstoned" &&
        input.tombstonedLeaseCorrelation === correlation;
    if (!ownsActiveLease && !ownsTombstonedLease) {
        return Object.freeze({ disposition: "lost", enqueueCorrection: false });
    }
    if (input.orderStatus === "confirmed") {
        return Object.freeze({ disposition: "sent", enqueueCorrection: false });
    }
    return Object.freeze({
        disposition: "accepted_after_state_change",
        enqueueCorrection: input.orderStatus !== null &&
            shouldEnqueuePaygConfirmationCorrection(input.orderStatus) &&
            !input.correctionExists,
    });
}
function shouldRecoverPaygConfirmationAcceptance(input) {
    return input.kind === "payg_guest_confirmation" &&
        (input.status === "tombstoned" || input.status === "reconciling") &&
        input.providerAcceptanceState === "unknown_in_flight" &&
        typeof input.tombstonedLeaseCorrelation === "string" &&
        /^[a-f0-9]{64}$/.test(input.tombstonedLeaseCorrelation);
}
function resolvePaygEmailFailureAfterStateChange(input) {
    if (!input.ownsTombstonedLease && !input.reconcileAfterStateChange) {
        return "normal";
    }
    // A timeout, throttling response, or provider 5xx can occur after Resend has
    // accepted the idempotent request but before the response reaches us. Keep
    // replaying the same key until acceptance is durably reconciled. Only an
    // explicit request/configuration rejection proves that no email was sent.
    const definitive = input.providerErrorName === "missing_api_key" ||
        input.httpStatus === 400 || input.httpStatus === 401 ||
        input.httpStatus === 403 || input.httpStatus === 404 ||
        input.httpStatus === 422;
    return definitive ? "definitive_rejection" : "reconcile_unknown";
}
function isPaygEmailFailureAmbiguous(httpStatus, providerErrorName) {
    if (providerErrorName === "missing_api_key")
        return false;
    return httpStatus === null || httpStatus === 408 || httpStatus === 429 ||
        (typeof httpStatus === "number" && httpStatus >= 500);
}
function resolvePaygTombstoneLeaseCorrelation(input) {
    if ((input.status === "sending" || input.status === "reconciling") &&
        typeof input.leaseToken === "string" && input.leaseToken) {
        return paygEmailLeaseCorrelation(input.leaseToken);
    }
    if (input.providerAcceptanceState === "unknown_in_flight" &&
        typeof input.ambiguousLeaseCorrelation === "string" &&
        /^[a-f0-9]{64}$/.test(input.ambiguousLeaseCorrelation)) {
        return input.ambiguousLeaseCorrelation;
    }
    return null;
}
function confirmationOutboxFor(intentRef, intent) {
    const signingKey = cancellationSigningKey();
    const token = signPaygCancellationToken({
        v: 1,
        orderId: intentRef.id,
        exp: Math.floor((intent.classEndMillis + 24 * 60 * 60 * 1000) / 1000),
    }, signingKey.secret, signingKey.kid);
    const piiRetentionCutoffAt = paygOrderPiiRetentionCutoffAt(intent);
    return Object.assign(Object.assign({}, buildPaygConfirmationOutboxPayload({
        orderId: intentRef.id,
        recipientEmail: intent.contact.email,
        attendeeName: intent.attendee.fullName,
        class: intent.class,
        amountPence: exports.PAYG_AMOUNT_PENCE,
        currency: exports.PAYG_CURRENCY,
        publicOrigin: intent.publicOrigin,
        cancellationToken: token,
        cancellationCutoffAtMillis: intent.classStartMillis -
            exports.PAYG_CANCELLATION_CUTOFF_HOURS * 60 * 60 * 1000,
        legalAcceptance: paygConfirmationLegalAcceptance(intent),
    })), { piiRetentionCutoffAt, piiRedactionRetryAt: piiRetentionCutoffAt });
}
function tombstonePaygConfirmation(tx, outbox, reason) {
    var _a;
    if (!(outbox === null || outbox === void 0 ? void 0 : outbox.exists) || outbox.get("status") === "tombstoned")
        return;
    const leaseToken = outbox.get("leaseToken");
    const inFlightCorrelation = outbox.get("kind") === "payg_guest_confirmation" ?
        resolvePaygTombstoneLeaseCorrelation({
            status: outbox.get("status"),
            leaseToken,
            providerAcceptanceState: outbox.get("providerAcceptanceState"),
            ambiguousLeaseCorrelation: outbox.get("ambiguousLeaseCorrelation"),
        }) : null;
    const leaseExpiresAt = timestampMillis(outbox.get("leaseExpiresAt"));
    const existingNextAttemptAt = timestampMillis(outbox.get("nextAttemptAt"));
    const recoveryAt = inFlightCorrelation ? firestore_1.Timestamp.fromMillis(Math.max(Date.now() + 60000, leaseExpiresAt !== null && leaseExpiresAt !== void 0 ? leaseExpiresAt : 0, existingNextAttemptAt !== null && existingNextAttemptAt !== void 0 ? existingNextAttemptAt : 0)) : null;
    tx.set(outbox.ref, {
        status: "tombstoned",
        deliveryStateBeforeTombstone: (_a = outbox.get("status")) !== null && _a !== void 0 ? _a : null,
        tombstoneReason: reason,
        tombstonedAt: serverTimestamp(),
        tombstonedLeaseCorrelation: inFlightCorrelation !== null && inFlightCorrelation !== void 0 ? inFlightCorrelation : firestore_1.FieldValue.delete(),
        ambiguousLeaseCorrelation: firestore_1.FieldValue.delete(),
        providerAcceptanceState: inFlightCorrelation ?
            "unknown_in_flight" : outbox.get("status") === "sent" ?
            "accepted_before_state_change" : "not_sent",
        reconcileAfterStateChange: inFlightCorrelation ? true : firestore_1.FieldValue.delete(),
        leaseToken: firestore_1.FieldValue.delete(),
        leaseExpiresAt: firestore_1.FieldValue.delete(),
        nextAttemptAt: recoveryAt !== null && recoveryAt !== void 0 ? recoveryAt : firestore_1.FieldValue.delete(),
        updatedAt: serverTimestamp(),
    }, { merge: true });
}
/**
 * Stops the original guest confirmation as soon as an administrator freezes a
 * whole class. Provider refund convergence remains authoritative for releasing
 * the paid booking and recording the final refund binding.
 */
function suppressPaygConfirmationForClassCancellation(tx, outbox, orderRef, operationId) {
    tombstonePaygConfirmation(tx, outbox, "class_cancellation_pending");
    tx.set(orderRef, {
        confirmationEmailStatus: "not_required",
        classCancellationOperationId: operationId,
        classCancellationRequestedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    }, { merge: true });
}
/**
 * Durably prepares and resumes the approved whole-class £7 refund. Every
 * provider mutation remains behind exact local order/class/audit bindings and
 * the ordinary refund claim/idempotency machinery.
 */
async function initiatePaygOrderRefundForClassCancellation(orderRef, classId, operationId) {
    if (!/^payg_[a-f0-9]{64}$/.test(orderRef.id) ||
        !/^class_cancel_[a-f0-9]{64}$/.test(operationId)) {
        throw new Error("Class-cancellation PAYG refund identity is invalid.");
    }
    const classRef = db().collection("classes").doc(classId);
    const auditRef = db().collection("classCancellationOperations")
        .doc(operationId);
    const prepared = await db().runTransaction(async (tx) => {
        var _a, _b;
        const [order, frozenClass, audit] = await Promise.all([
            tx.get(orderRef),
            tx.get(classRef),
            tx.get(auditRef),
        ]);
        if (!order.exists) {
            throw new Error(`PAYG order ${orderRef.id} disappeared.`);
        }
        const value = order.data();
        const orderClass = value.class;
        const existingOperationId = typeof value.classCancellationOperationId ===
            "string" ? value.classCancellationOperationId : null;
        const auditState = audit.get("state");
        const exactOperation = frozenClass.exists &&
            frozenClass.get("status") === "scheduled" &&
            frozenClass.get("bookingOpen") === false &&
            frozenClass.get("bookingClosedReason") === "class_cancellation" &&
            frozenClass.get("cancellationOperationId") === operationId &&
            audit.exists && audit.get("schemaVersion") === 1 &&
            audit.get("operationId") === operationId &&
            audit.get("classId") === classId &&
            (auditState === "processing" ||
                auditState === "awaiting_payg_refunds" ||
                auditState === "ready_to_finalize");
        const exactOrder = value.schemaVersion === exports.PAYG_SCHEMA_VERSION &&
            value.orderId === orderRef.id &&
            value.purchaseKind === exports.PAYG_PURCHASE_KIND &&
            value.offeringKey === exports.PAYG_OFFERING_KEY &&
            (orderClass === null || orderClass === void 0 ? void 0 : orderClass.classId) === classId &&
            value.amountPence === exports.PAYG_AMOUNT_PENCE &&
            value.currency === exports.PAYG_CURRENCY &&
            typeof value.checkoutSessionId === "string" &&
            /^cs_[A-Za-z0-9_]{4,252}$/.test(value.checkoutSessionId) &&
            typeof value.paymentIntentId === "string" &&
            /^pi_[A-Za-z0-9_]{4,252}$/.test(value.paymentIntentId) &&
            typeof value.chargeId === "string" &&
            /^ch_[A-Za-z0-9_]{4,252}$/.test(value.chargeId);
        if (!exactOperation || !exactOrder ||
            existingOperationId && existingOperationId !== operationId) {
            throw new Error(`PAYG order ${orderRef.id} is not exactly bound to ${operationId}.`);
        }
        const refundId = typeof value.refundId === "string" ? value.refundId : null;
        const hasInvalidRefundId = refundId !== null &&
            !/^re_[A-Za-z0-9_]{4,252}$/.test(refundId);
        const storedExpectedAmount = value.refundExpectedAmountPence;
        const expectedAmountConflict = storedExpectedAmount !== undefined &&
            storedExpectedAmount !== null && storedExpectedAmount !==
            exports.PAYG_AMOUNT_PENCE;
        const providerRequestEvidencePresent = [
            "classCancellationRefundProviderRequestPreparedAt",
            "classCancellationRefundProviderIdempotencyKey",
            "classCancellationRefundProviderAmountPence",
            "classCancellationRefundProviderCurrency",
            "classCancellationRefundProviderOperationId",
        ].some((field) => value[field] !== undefined);
        const providerRequestEvidenceExact = timestampMillis(value.classCancellationRefundProviderRequestPreparedAt) !== null && value.classCancellationRefundProviderIdempotencyKey ===
            `payg-refund:${orderRef.id}` &&
            value.classCancellationRefundProviderAmountPence === exports.PAYG_AMOUNT_PENCE &&
            value.classCancellationRefundProviderCurrency === exports.PAYG_CURRENCY &&
            value.classCancellationRefundProviderOperationId === operationId;
        const hasProviderAttemptEvidence = refundId !== null ||
            typeof value.refundAutomationClaimToken === "string" ||
            providerRequestEvidencePresent;
        const decision = resolvePaygClassCancellationRefundAction({
            status: value.status,
            refundStatus: value.refundStatus,
            refundId: value.refundId,
            refundReason: value.refundReason,
            hasProviderAttemptEvidence,
            disputeOpen: value.disputeOpen,
            paymentReviewId: value.paymentReviewId,
            providerContractStatus: value.providerContractStatus,
            conflictingRefundId: value.conflictingRefundId,
        });
        const contradictoryRefundEvidence = (value.status === "confirmed" || value.status === "cancelled") &&
            (refundId !== null || value.refundStatus !== undefined &&
                value.refundStatus !== null);
        const blocked = decision.action === "blocked" || hasInvalidRefundId ||
            expectedAmountConflict || contradictoryRefundEvidence ||
            providerRequestEvidencePresent && !providerRequestEvidenceExact ||
            typeof value.disputeId === "string";
        const operationFields = {
            classCancellationOperationId: operationId,
            classCancellationRequestedAt: (_a = value.classCancellationRequestedAt) !== null && _a !== void 0 ? _a : serverTimestamp(),
            classCancellationRefundRequestedAt: (_b = value.classCancellationRefundRequestedAt) !== null && _b !== void 0 ? _b : serverTimestamp(),
            updatedAt: serverTimestamp(),
        };
        if (blocked) {
            tx.set(orderRef, Object.assign(Object.assign({}, operationFields), { classCancellationRefundStatus: "manual_review", classCancellationRefundBlockedAt: serverTimestamp() }), { merge: true });
            return { action: "blocked", refundReason: null };
        }
        if (decision.action === "already_refunded") {
            tx.set(orderRef, Object.assign(Object.assign({}, operationFields), { classCancellationRefundStatus: "reconciled", classCancellationRefundReconciledAt: serverTimestamp() }), { merge: true });
            return { action: decision.action, refundReason: null };
        }
        const refundReason = decision.refundReason;
        if (!refundReason) {
            throw new Error(`PAYG order ${orderRef.id} has no refund reason.`);
        }
        tx.set(orderRef, Object.assign(Object.assign({}, operationFields), { status: "refund_pending", refundReason, refundExpectedAmountPence: exports.PAYG_AMOUNT_PENCE, refundRecoveryAt: firestore_1.Timestamp.fromMillis(Date.now()), classCancellationRefundStatus: "refund_pending" }), { merge: true });
        return { action: decision.action, refundReason };
    });
    if (!prepared.refundReason) {
        return Object.freeze({
            orderId: orderRef.id,
            action: prepared.action,
            providerAttempted: false,
        });
    }
    try {
        await issuePaygRefund(orderRef.id, prepared.refundReason);
    }
    catch (error) {
        // The refund_pending receipt and recovery marker are durable. An admin
        // resume or the scheduled recovery worker will replay the same provider
        // idempotency key; ambiguous provider state never permits finalization.
        console.error("PAYG class-cancellation refund queued for recovery", {
            orderId: orderRef.id,
            operationId,
            error,
        });
    }
    return Object.freeze({
        orderId: orderRef.id,
        action: prepared.action,
        providerAttempted: true,
    });
}
function isPaygOrdinaryLifecycleEmailOrder(value) {
    if (!value || typeof value !== "object")
        return false;
    const order = value;
    // A paid contract-mismatch order can retain the same customer/provider
    // identifiers as an ordinary order while also being linked to the fail-closed
    // payment-review workflow. Customer lifecycle wording is never authorized by
    // review evidence, even if a later provider event has the expected amount.
    return (order.paymentReviewId === undefined || order.paymentReviewId === null) &&
        (order.providerContractStatus === undefined ||
            order.providerContractStatus === null);
}
function validPaygLifecycleClass(value) {
    if (!value || typeof value !== "object")
        return false;
    const candidate = value;
    return typeof candidate.classId === "string" && candidate.classId.length > 0 &&
        typeof candidate.title === "string" && candidate.title.length > 0 &&
        typeof candidate.startTime === "string" &&
        Number.isFinite(Date.parse(candidate.startTime)) &&
        typeof candidate.endTime === "string" &&
        Number.isFinite(Date.parse(candidate.endTime)) &&
        typeof candidate.timezone === "string" && candidate.timezone.length > 0 &&
        typeof candidate.location === "string" && candidate.location.length > 0;
}
function paygLifecycleExistingOutboxMatches(outbox, payload) {
    if (!outbox.exists || !validPaygOutboxPayload(outbox.id, outbox.data())) {
        return false;
    }
    const existing = outbox.data();
    if (existing.kind !== payload.kind || existing.orderId !== payload.orderId ||
        existing.outboxId !== payload.outboxId ||
        existing.idempotencyKey !== payload.idempotencyKey ||
        existing.to.length !== 1 || existing.to[0] !== payload.to[0] ||
        existing.templateData.attendeeName !== payload.templateData.attendeeName ||
        existing.templateData.amountPence !== payload.templateData.amountPence ||
        existing.templateData.currency !== payload.templateData.currency ||
        !paygLifecycleClassMatches(existing.templateData.class, payload.templateData.class))
        return false;
    if (payload.kind === "payg_guest_refund_confirmation") {
        if (existing.kind !== payload.kind)
            return false;
        return existing.templateData.paymentIntentId ===
            payload.templateData.paymentIntentId &&
            existing.templateData.chargeId === payload.templateData.chargeId &&
            existing.templateData.refundId === payload.templateData.refundId;
    }
    if (existing.kind !== payload.kind)
        return false;
    return existing.templateData.paymentIntentId ===
        payload.templateData.paymentIntentId &&
        existing.templateData.chargeId === payload.templateData.chargeId &&
        existing.templateData.disputeId === payload.templateData.disputeId;
}
function paygLifecycleExistingStatus(value) {
    if (value === "sent")
        return "sent";
    if (value === "manual_review" || value === "dead_letter") {
        return "manual_review";
    }
    if (value === "tombstoned")
        return "not_required";
    return "pending";
}
function buildPaygLifecyclePayloadForOrder(order, binding) {
    if (hasNonNullDocumentField(order, "piiRedactedAt"))
        return null;
    const contact = order.get("contact");
    const attendee = order.get("attendee");
    const classSnapshot = order.get("class");
    const recipientEmail = contact && typeof contact.email === "string" ?
        contact.email.trim() : "";
    const attendeeName = attendee && typeof attendee.fullName === "string" ?
        attendee.fullName.trim() : "";
    if (!recipientEmail || recipientEmail.length > 320 ||
        /[\r\n]/.test(recipientEmail) ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail) ||
        !attendeeName || !validPaygLifecycleClass(classSnapshot))
        return null;
    return binding.kind === "refund" ? buildPaygRefundOutboxPayload({
        orderId: order.id,
        recipientEmail,
        attendeeName,
        class: classSnapshot,
        paymentIntentId: binding.paymentIntentId,
        chargeId: binding.chargeId,
        refundId: binding.refundId,
    }) : buildPaygDisputeOutboxPayload({
        orderId: order.id,
        recipientEmail,
        attendeeName,
        class: classSnapshot,
        paymentIntentId: binding.paymentIntentId,
        chargeId: binding.chargeId,
        disputeId: binding.disputeId,
    });
}
function enqueuePaygLifecycleEmail(tx, order, outbox, binding, nowMillis = Date.now()) {
    const projectionPrefix = binding.kind;
    const statusField = `${projectionPrefix}EmailStatus`;
    const outboxIdField = `${projectionPrefix}EmailOutboxId`;
    const errorField = `${projectionPrefix}EmailError`;
    const closureField = `${projectionPrefix}EmailClosureReason`;
    const cutoff = timestampMillis(order.get(exports.PAYG_PII_RETENTION_CUTOFF_FIELD));
    const payload = cutoff !== null && cutoff > nowMillis ?
        buildPaygLifecyclePayloadForOrder(order, binding) : null;
    if (!payload) {
        const reason = hasNonNullDocumentField(order, "piiRedactedAt") ?
            "pii_already_redacted" : cutoff === null ?
            "pii_retention_cutoff_missing" : cutoff <= nowMillis ?
            "pii_retention_cutoff_reached" : "recipient_unavailable";
        tx.set(order.ref, {
            [statusField]: "not_required",
            [closureField]: reason,
            [errorField]: firestore_1.FieldValue.delete(),
            updatedAt: serverTimestamp(),
        }, { merge: true });
        return;
    }
    if (outbox.exists) {
        if (!paygLifecycleExistingOutboxMatches(outbox, payload)) {
            tx.set(order.ref, {
                [statusField]: "manual_review",
                [outboxIdField]: outbox.id,
                [errorField]: "lifecycle_outbox_binding_mismatch",
                updatedAt: serverTimestamp(),
            }, { merge: true });
            console.error("CRITICAL_BILLING_PAYG_LIFECYCLE_OUTBOX_MISMATCH", {
                orderId: order.id,
                lifecycle: binding.kind,
                outboxId: outbox.id,
            });
            return;
        }
        tx.set(order.ref, {
            [statusField]: paygLifecycleExistingStatus(outbox.get("status")),
            [outboxIdField]: outbox.id,
            [errorField]: firestore_1.FieldValue.delete(),
            [closureField]: firestore_1.FieldValue.delete(),
            updatedAt: serverTimestamp(),
        }, { merge: true });
        return;
    }
    if (cutoff === null) {
        throw new Error("PAYG lifecycle email retention cutoff disappeared.");
    }
    tx.create(outbox.ref, Object.assign(Object.assign({}, payload), { status: "pending", attemptCount: 0, nextAttemptAt: serverTimestamp(), piiRetentionCutoffAt: firestore_1.Timestamp.fromMillis(cutoff), piiRedactionRetryAt: firestore_1.Timestamp.fromMillis(cutoff), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    tx.set(order.ref, {
        [statusField]: "pending",
        [outboxIdField]: outbox.id,
        [errorField]: firestore_1.FieldValue.delete(),
        [closureField]: firestore_1.FieldValue.delete(),
        updatedAt: serverTimestamp(),
    }, { merge: true });
}
function paygDuplicateLockRef(lockId) {
    return typeof lockId === "string" && /^[a-f0-9]{64}$/.test(lockId) ?
        db().collection(exports.PAYG_DUPLICATE_LOCK_COLLECTION).doc(lockId) : null;
}
function paygPaymentReviewRef(reviewId) {
    return typeof reviewId === "string" &&
        /^payg_[a-f0-9]{64}_[a-f0-9]{24}$/.test(reviewId) ?
        db().collection(exports.PAYG_PAYMENT_REVIEW_COLLECTION).doc(reviewId) : null;
}
function releasePaygDuplicateLock(tx, lock, orderId) {
    if ((lock === null || lock === void 0 ? void 0 : lock.exists) && lock.get("intentId") === orderId)
        tx.delete(lock.ref);
}
async function paygOrderRefForRefund(refund) {
    var _a;
    const refundMatches = await db().collection("paygOrders")
        .where("refundId", "==", refund.id)
        .limit(2)
        .get();
    if (refundMatches.size > 1) {
        throw new Error(`Refund ${refund.id} belongs to multiple PAYG orders.`);
    }
    if (refundMatches.size === 1)
        return refundMatches.docs[0].ref;
    const paymentIntentId = idOf(refund.payment_intent);
    if (paymentIntentId) {
        const paymentMatches = await db().collection("paygOrders")
            .where("paymentIntentId", "==", paymentIntentId)
            .limit(2)
            .get();
        if (paymentMatches.size > 1) {
            throw new Error(`PaymentIntent ${paymentIntentId} has multiple PAYG orders.`);
        }
        if (paymentMatches.size === 1)
            return paymentMatches.docs[0].ref;
    }
    const metadataOrderId = (_a = refund.metadata) === null || _a === void 0 ? void 0 : _a.paygOrderId;
    if (typeof metadataOrderId !== "string" ||
        !/^payg_[a-f0-9]{64}$/.test(metadataOrderId))
        return null;
    const metadataOrder = await db().collection("paygOrders").doc(metadataOrderId).get();
    return metadataOrder.exists ? metadataOrder.ref : null;
}
async function convergePaygRefund(refund) {
    const compatibleRefund = refund;
    if (typeof compatibleRefund.livemode === "boolean") {
        assertStripeObjectMode("Refund", refund.id, compatibleRefund.livemode);
    }
    const orderRef = await paygOrderRefForRefund(refund);
    if (!orderRef)
        return false;
    await db().runTransaction(async (tx) => {
        var _a, _b, _c, _d, _e;
        const orderSnap = await tx.get(orderRef);
        if (!orderSnap.exists)
            throw new Error(`PAYG order ${orderRef.id} disappeared.`);
        const order = orderSnap.data();
        const bookingRef = order.bookingId ?
            db().collection("bookings").doc(order.bookingId) : null;
        const classRef = db().collection("classes").doc(order.class.classId);
        const outboxRef = db().collection("paygEmailOutbox").doc(orderRef.id);
        const refundOutboxRef = db().collection("paygEmailOutbox")
            .doc(paygRefundOutboxId(orderRef.id));
        const lockRef = paygDuplicateLockRef(order.duplicateLockId);
        const reviewRef = paygPaymentReviewRef(orderSnap.get("paymentReviewId"));
        const [bookingSnap, classSnap, outboxSnap, refundOutboxSnap, lockSnap, reviewSnap,] = await Promise.all([
            bookingRef ? tx.get(bookingRef) : Promise.resolve(null),
            tx.get(classRef),
            tx.get(outboxRef),
            tx.get(refundOutboxRef),
            lockRef ? tx.get(lockRef) : Promise.resolve(null),
            reviewRef ? tx.get(reviewRef) : Promise.resolve(null),
        ]);
        const storedExpectedAmount = Number(order
            .refundExpectedAmountPence);
        const expectedAmount = Number.isSafeInteger(storedExpectedAmount) &&
            storedExpectedAmount > 0 ? storedExpectedAmount : order.amountPence;
        const paymentIntentId = idOf(refund.payment_intent);
        const refundChargeId = idOf(refund.charge);
        const storedRefundId = orderSnap.get("refundId");
        const lifecycleRefundIdUnconflicted = storedRefundId === null ||
            storedRefundId === undefined || storedRefundId === "" ||
            storedRefundId === refund.id;
        const exactProviderBinding = order.purchaseKind === exports.PAYG_PURCHASE_KIND &&
            order.paymentIntentId !== null &&
            paymentIntentId === order.paymentIntentId &&
            refund.currency === order.currency &&
            refund.amount === expectedAmount;
        const exactLifecycleEmailBinding = exactProviderBinding &&
            /^re_[A-Za-z0-9_]{4,252}$/.test(refund.id) &&
            isPaygOrdinaryLifecycleEmailOrder(orderSnap.data()) &&
            expectedAmount === exports.PAYG_AMOUNT_PENCE &&
            order.amountPence === exports.PAYG_AMOUNT_PENCE &&
            order.currency === exports.PAYG_CURRENCY &&
            refund.amount === exports.PAYG_AMOUNT_PENCE &&
            refund.currency === exports.PAYG_CURRENCY &&
            refundChargeId !== null && order.chargeId === refundChargeId &&
            lifecycleRefundIdUnconflicted &&
            !orderSnap.get("conflictingRefundId");
        const knownStatus = refund.status === "pending" ||
            refund.status === "succeeded" || refund.status === "failed" ||
            refund.status === "canceled";
        const linkedReview = (reviewSnap === null || reviewSnap === void 0 ? void 0 : reviewSnap.exists) &&
            reviewSnap.get("orderId") === orderRef.id &&
            reviewSnap.get("paymentIntentId") === order.paymentIntentId;
        if ((reviewSnap === null || reviewSnap === void 0 ? void 0 : reviewSnap.exists) && !linkedReview) {
            console.error("CRITICAL_BILLING_PAYG_ORDER_REVIEW_LINK_MISMATCH", {
                orderId: orderRef.id,
                paymentReviewId: reviewSnap.id,
            });
        }
        if (!exactProviderBinding || !knownStatus) {
            const preserved = order.status === "refunded" ||
                order.status === "disputed" || order.status === "manual_review" ?
                order.status : "manual_review";
            await releasePaidOrderCapacity(tx, orderRef, order, bookingSnap, classSnap, outboxSnap, lockSnap, {
                status: preserved,
                cancelledReason: "refund_manual_review",
                refundId: refund.id,
                refundStatus: exactProviderBinding ?
                    `unsupported_${String(refund.status)}` :
                    "provider_contract_mismatch",
                refundRecoveryAt: firestore_1.FieldValue.delete(),
                refundFailureReason: (_a = refund.failure_reason) !== null && _a !== void 0 ? _a : null,
            });
            if (linkedReview) {
                tx.set(reviewSnap.ref, Object.assign(Object.assign({ status: resolvePaygLinkedReviewRefundStatus(reviewSnap.get("status"), null, false), refundId: refund.id, refundStatus: exactProviderBinding ?
                        `unsupported_${String(refund.status)}` :
                        "provider_contract_mismatch", refundRecoveryAt: firestore_1.FieldValue.delete(), refundFailureReason: (_b = refund.failure_reason) !== null && _b !== void 0 ? _b : null }, paygRefundClaimCleanup()), { updatedAt: serverTimestamp() }), { merge: true });
            }
            console.error("CRITICAL_BILLING_PAYG_REFUND_MANUAL_REVIEW", {
                orderId: orderRef.id,
                refundId: refund.id,
                exactProviderBinding,
                refundStatus: refund.status,
            });
            return;
        }
        const status = refund.status;
        if (shouldPreservePaygSucceededRefund({
            ownerStatus: order.status,
            storedRefundId: orderSnap.get("refundId"),
            storedRefundStatus: orderSnap.get("refundStatus"),
            incomingRefundId: refund.id,
            incomingRefundStatus: status,
            exactProviderBinding: true,
        })) {
            const preservedStatus = resolvePaygRefundState(order.status, "succeeded")
                .orderStatus;
            await releasePaidOrderCapacity(tx, orderRef, order, bookingSnap, classSnap, outboxSnap, lockSnap, {
                status: preservedStatus,
                cancelledReason: "payg_refunded",
                refundId: refund.id,
                refundStatus: "succeeded",
                refundRecoveryAt: firestore_1.FieldValue.delete(),
            });
            if (linkedReview) {
                tx.set(reviewSnap.ref, Object.assign(Object.assign({ status: resolvePaygLinkedReviewRefundStatus(reviewSnap.get("status"), "succeeded", true), refundId: refund.id, refundStatus: "succeeded", refundRecoveryAt: firestore_1.FieldValue.delete() }, paygRefundClaimCleanup()), { updatedAt: serverTimestamp() }), { merge: true });
            }
            const storedRefundedAmount = Number(orderSnap.get("refundedAmountPence"));
            if (exactLifecycleEmailBinding &&
                orderSnap.get("refundStatus") === "succeeded" &&
                storedRefundedAmount === exports.PAYG_AMOUNT_PENCE &&
                paymentIntentId !== null && refundChargeId !== null) {
                enqueuePaygLifecycleEmail(tx, orderSnap, refundOutboxSnap, {
                    kind: "refund",
                    paymentIntentId,
                    chargeId: refundChargeId,
                    refundId: refund.id,
                });
            }
            return;
        }
        const decision = resolvePaygRefundState(order.status, status);
        const pendingBinding = status === "pending" ?
            resolvePaygPendingRefundBinding({
                ownerStatus: order.status,
                storedRefundId: orderSnap.get("refundId"),
                incomingRefundId: refund.id,
                disputeOpen: orderSnap.get("disputeOpen"),
                refundAutomationStatus: orderSnap.get("refundAutomationStatus"),
            }) : null;
        if (pendingBinding === "conflict_manual_review") {
            await releasePaidOrderCapacity(tx, orderRef, order, bookingSnap, classSnap, outboxSnap, lockSnap, {
                status: order.status === "disputed" ? "disputed" : "manual_review",
                cancelledReason: "refund_id_conflict_manual_review",
                refundStatus: "conflicting_refund_id",
                conflictingRefundId: refund.id,
                refundRecoveryAt: firestore_1.FieldValue.delete(),
            });
            if (linkedReview) {
                tx.set(reviewSnap.ref, Object.assign(Object.assign({ status: reviewSnap.get("status") === "disputed" ?
                        "disputed" : "manual_review", refundStatus: "conflicting_refund_id", conflictingRefundId: refund.id, refundRecoveryAt: firestore_1.FieldValue.delete() }, paygRefundClaimCleanup()), { updatedAt: serverTimestamp() }), { merge: true });
            }
            console.error("CRITICAL_BILLING_PAYG_REFUND_ID_CONFLICT", {
                orderId: orderRef.id,
                storedRefundId: (_c = orderSnap.get("refundId")) !== null && _c !== void 0 ? _c : null,
                incomingRefundId: refund.id,
            });
            return;
        }
        const deliberatePendingPoll = pendingBinding === "bind_and_recover" ||
            pendingBinding === "recover_bound";
        if (linkedReview) {
            const reviewStatus = resolvePaygLinkedReviewRefundStatus(reviewSnap.get("status"), status, true);
            tx.set(reviewSnap.ref, Object.assign(Object.assign(Object.assign({ status: reviewStatus, refundId: refund.id, refundStatus: status, refundedAmountPence: status === "succeeded" ?
                    refund.amount : firestore_1.FieldValue.delete(), refundedAt: status === "succeeded" ?
                    serverTimestamp() : firestore_1.FieldValue.delete(), refundFailureReason: (_d = refund.failure_reason) !== null && _d !== void 0 ? _d : firestore_1.FieldValue.delete() }, (deliberatePendingPoll && reviewStatus === "refund_pending" ? {
                refundRecoveryAt: firestore_1.Timestamp.fromMillis(Date.now() + 5 * 60 * 1000),
            } : {
                refundRecoveryAt: firestore_1.FieldValue.delete(),
            })), paygRefundClaimCleanup()), { updatedAt: serverTimestamp() }), { merge: true });
        }
        if (status === "succeeded") {
            await releasePaidOrderCapacity(tx, orderRef, order, bookingSnap, classSnap, outboxSnap, lockSnap, {
                status: decision.orderStatus,
                cancelledReason: "payg_refunded",
                refundId: refund.id,
                refundStatus: status,
                refundedAmountPence: refund.amount,
                refundRecoveryAt: firestore_1.FieldValue.delete(),
                refundedAt: serverTimestamp(),
            });
            if (exactLifecycleEmailBinding && paymentIntentId !== null &&
                refundChargeId !== null) {
                enqueuePaygLifecycleEmail(tx, orderSnap, refundOutboxSnap, {
                    kind: "refund",
                    paymentIntentId,
                    chargeId: refundChargeId,
                    refundId: refund.id,
                });
            }
            else {
                tx.set(orderRef, {
                    refundEmailStatus: "manual_review",
                    refundEmailError: "provider_contract_mismatch",
                    updatedAt: serverTimestamp(),
                }, { merge: true });
            }
            return;
        }
        await releasePaidOrderCapacity(tx, orderRef, order, bookingSnap, classSnap, outboxSnap, lockSnap, Object.assign({ status: decision.orderStatus, cancelledReason: `payg_refund_${status}`, refundId: refund.id, refundStatus: status, refundFailureReason: (_e = refund.failure_reason) !== null && _e !== void 0 ? _e : firestore_1.FieldValue.delete() }, (decision.scheduleRecovery && deliberatePendingPoll ? {
            refundRecoveryAt: firestore_1.Timestamp.fromMillis(Date.now() + 5 * 60 * 1000),
        } : {
            refundRecoveryAt: firestore_1.FieldValue.delete(),
        })));
    });
    return true;
}
function paygRefundClaimEligible(snapshot, kind) {
    return snapshot.get("status") === "refund_pending" &&
        snapshot.get("disputeOpen") !== true &&
        snapshot.get("refundAutomationStatus") !== "suspended_dispute" &&
        (kind === "order" || snapshot.get("automaticRefundSafe") === true);
}
function paygRefundClaimCleanup() {
    return {
        refundAutomationClaimToken: firestore_1.FieldValue.delete(),
        refundAutomationClaimExpiresAt: firestore_1.FieldValue.delete(),
        refundAutomationClaimedAt: firestore_1.FieldValue.delete(),
        refundAutomationClaimPaymentIntentId: firestore_1.FieldValue.delete(),
        refundAutomationClaimProviderCheckedAt: firestore_1.FieldValue.delete(),
    };
}
async function acquirePaygRefundIssuanceClaim(ref, kind, requestedReason = null, nowMillis = Date.now(), token = (0, crypto_1.randomUUID)()) {
    if (!Number.isSafeInteger(nowMillis) || nowMillis <= 0 ||
        !/^[A-Za-z0-9-]{16,128}$/.test(token)) {
        throw new Error("PAYG refund issuance claim input is invalid.");
    }
    return db().runTransaction(async (tx) => {
        var _a;
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) {
            throw new Error(`PAYG ${kind.replace("_", " ")} ${ref.id} was not found.`);
        }
        if (snapshot.get("status") === "refunded" ||
            snapshot.get("refundStatus") === "succeeded") {
            return { state: "complete" };
        }
        const refundId = snapshot.get("refundId");
        if (typeof refundId === "string" && refundId.startsWith("re_")) {
            return { state: "existing", refundId };
        }
        if (!paygRefundClaimEligible(snapshot, kind)) {
            return { state: "blocked" };
        }
        const storedClassCancellationOperationId = typeof snapshot.get("classCancellationOperationId") === "string" ? snapshot.get("classCancellationOperationId") : null;
        const classCancellationOperationId = (kind === "order" && requestedReason === "class_cancellation" ||
            kind === "payment_review" &&
                snapshot.get("classCancellationRefundAuthorized") === true) &&
            /^class_cancel_[a-f0-9]{64}$/.test(storedClassCancellationOperationId !== null && storedClassCancellationOperationId !== void 0 ? storedClassCancellationOperationId : "") ? storedClassCancellationOperationId : null;
        const expectedAmount = Number(snapshot.get("refundExpectedAmountPence"));
        const classCancellationIntentId = kind === "payment_review" &&
            classCancellationOperationId &&
            /^payg_[a-f0-9]{64}$/.test((_a = snapshot.get("intentId")) !== null && _a !== void 0 ? _a : "") ?
            snapshot.get("intentId") : null;
        const cancellationIntent = classCancellationIntentId ? await tx.get(db().collection("paygIntents").doc(classCancellationIntentId)) : null;
        const intentClass = cancellationIntent === null || cancellationIntent === void 0 ? void 0 : cancellationIntent.get("class");
        const classCancellationClassId = kind === "order" &&
            requestedReason === "class_cancellation" &&
            typeof snapshot.get("class.classId") === "string" ?
            snapshot.get("class.classId") :
            kind === "payment_review" && typeof (intentClass === null || intentClass === void 0 ? void 0 : intentClass.classId) === "string" ?
                intentClass.classId : null;
        const [frozenClass, cancellationAudit] = classCancellationClassId &&
            classCancellationOperationId ? await Promise.all([
            tx.get(db().collection("classes").doc(classCancellationClassId)),
            tx.get(db().collection("classCancellationOperations")
                .doc(classCancellationOperationId)),
        ]) : [null, null];
        const providerRequestEvidencePresent = [
            "classCancellationRefundProviderRequestPreparedAt",
            "classCancellationRefundProviderIdempotencyKey",
            "classCancellationRefundProviderAmountPence",
            "classCancellationRefundProviderCurrency",
            "classCancellationRefundProviderOperationId",
        ].some((field) => snapshot.get(field) !== undefined);
        const expectedProviderRequestKey = kind === "order" ?
            `payg-refund:${ref.id}` : `payg-review-refund:${ref.id}`;
        const classCancellationProviderRequestPreviouslyPrepared = timestampMillis(snapshot.get("classCancellationRefundProviderRequestPreparedAt")) !== null && snapshot.get("classCancellationRefundProviderIdempotencyKey") === expectedProviderRequestKey && snapshot.get("classCancellationRefundProviderAmountPence") === expectedAmount && snapshot.get("classCancellationRefundProviderCurrency") === exports.PAYG_CURRENCY && snapshot.get("classCancellationRefundProviderOperationId") === classCancellationOperationId;
        const exactFrozenOperation = frozenClass !== null &&
            cancellationAudit !== null && frozenClass.exists &&
            frozenClass.get("status") === "scheduled" &&
            frozenClass.get("bookingOpen") === false &&
            frozenClass.get("bookingClosedReason") === "class_cancellation" &&
            frozenClass.get("cancellationOperationId") ===
                classCancellationOperationId && cancellationAudit.exists &&
            cancellationAudit.get("schemaVersion") === 1 &&
            cancellationAudit.get("operationId") === classCancellationOperationId &&
            cancellationAudit.get("classId") === classCancellationClassId &&
            ["processing", "awaiting_payg_refunds", "ready_to_finalize"].includes(String(cancellationAudit.get("state")));
        const exactClassCancellationReview = kind === "payment_review" &&
            snapshot.get("classCancellationRefundAuthorized") === true &&
            exactFrozenOperation && cancellationIntent !== null &&
            cancellationIntent.exists &&
            cancellationIntent.get("classCancellationOperationId") ===
                classCancellationOperationId &&
            cancellationIntent.get("checkoutSessionId") ===
                snapshot.get("checkoutSessionId") &&
            cancellationIntent.get("paymentIntentId") ===
                snapshot.get("paymentIntentId") &&
            expectedAmount === exports.PAYG_AMOUNT_PENCE &&
            snapshot.get("providerAmountReceivedPence") === exports.PAYG_AMOUNT_PENCE &&
            snapshot.get("providerCurrency") === exports.PAYG_CURRENCY &&
            (!providerRequestEvidencePresent ||
                classCancellationProviderRequestPreviouslyPrepared);
        const exactClassCancellationRefund = requestedReason ===
            "class_cancellation" && kind === "order" &&
            /^class_cancel_[a-f0-9]{64}$/.test(classCancellationOperationId !== null && classCancellationOperationId !== void 0 ? classCancellationOperationId : "") && exactFrozenOperation && snapshot.get("orderId") === ref.id &&
            snapshot.get("purchaseKind") === exports.PAYG_PURCHASE_KIND &&
            snapshot.get("offeringKey") === exports.PAYG_OFFERING_KEY &&
            snapshot.get("amountPence") === exports.PAYG_AMOUNT_PENCE &&
            snapshot.get("currency") === exports.PAYG_CURRENCY &&
            snapshot.get("refundExpectedAmountPence") === exports.PAYG_AMOUNT_PENCE &&
            snapshot.get("refundReason") === "class_cancellation" &&
            snapshot.get("disputeOpen") !== true &&
            snapshot.get("paymentReviewId") == null &&
            snapshot.get("providerContractStatus") == null &&
            snapshot.get("conflictingRefundId") == null &&
            (!providerRequestEvidencePresent ||
                classCancellationProviderRequestPreviouslyPrepared);
        if (requestedReason === "class_cancellation" &&
            !exactClassCancellationRefund) {
            tx.set(ref, Object.assign(Object.assign({ status: "manual_review", classCancellationRefundStatus: "manual_review", refundStatus: "class_cancellation_binding_mismatch", refundRecoveryAt: firestore_1.FieldValue.delete() }, paygRefundClaimCleanup()), { updatedAt: serverTimestamp() }), { merge: true });
            return { state: "blocked" };
        }
        const expectedProviderCurrency = snapshot.get("providerCurrency");
        if (kind === "payment_review" &&
            (!Number.isSafeInteger(expectedAmount) || expectedAmount <= 0 ||
                expectedProviderCurrency !== exports.PAYG_CURRENCY ||
                snapshot.get("classCancellationRefundAuthorized") === true &&
                    !exactClassCancellationReview)) {
            tx.set(ref, Object.assign(Object.assign({ status: "manual_review", refundStatus: "refund_contract_invalid", refundRecoveryAt: firestore_1.FieldValue.delete() }, paygRefundClaimCleanup()), { updatedAt: serverTimestamp() }), { merge: true });
            return { state: "blocked" };
        }
        const paymentIntentId = snapshot.get("paymentIntentId");
        if (typeof paymentIntentId !== "string" ||
            !paymentIntentId.startsWith("pi_")) {
            tx.set(ref, Object.assign(Object.assign({ status: snapshot.get("status") === "disputed" ?
                    "disputed" : "manual_review", refundStatus: "missing_payment_intent", refundRecoveryAt: firestore_1.FieldValue.delete() }, paygRefundClaimCleanup()), { updatedAt: serverTimestamp() }), { merge: true });
            return { state: "blocked" };
        }
        const existingToken = snapshot.get("refundAutomationClaimToken");
        const existingExpiry = timestampMillis(snapshot.get("refundAutomationClaimExpiresAt"));
        if (typeof existingToken === "string" && existingToken !== token &&
            existingExpiry !== null && existingExpiry > nowMillis) {
            return { state: "in_progress" };
        }
        const claimExpiresAt = nowMillis + exports.PAYG_REFUND_ISSUANCE_CLAIM_MS;
        tx.set(ref, {
            refundAutomationClaimToken: token,
            refundAutomationClaimExpiresAt: firestore_1.Timestamp.fromMillis(claimExpiresAt),
            refundAutomationClaimedAt: serverTimestamp(),
            refundAutomationClaimPaymentIntentId: paymentIntentId,
            // A crashed owner becomes recoverable when its bounded claim expires.
            refundRecoveryAt: firestore_1.Timestamp.fromMillis(claimExpiresAt),
            updatedAt: serverTimestamp(),
        }, { merge: true });
        return {
            state: "acquired",
            token,
            paymentIntentId,
            expectedChargeId: typeof snapshot.get("chargeId") === "string" ?
                snapshot.get("chargeId") : null,
            expectedAmountPence: (kind === "payment_review" ||
                exactClassCancellationRefund) &&
                Number.isSafeInteger(expectedAmount) && expectedAmount > 0 ?
                expectedAmount : null,
            expectedCurrency: typeof snapshot.get("providerCurrency") === "string" ?
                snapshot.get("providerCurrency") :
                typeof snapshot.get("currency") === "string" ?
                    snapshot.get("currency") : null,
            intentId: typeof snapshot.get("intentId") === "string" ?
                snapshot.get("intentId") : null,
            refundOwnerId: ref.id,
            refundClaimKind: kind,
            refundReason: requestedReason,
            classCancellationOperationId,
            classCancellationProviderRequestPreviouslyPrepared,
        };
    });
}
async function refreshPaygRefundProviderState(input) {
    var _a, _b, _c;
    const paymentIntent = await stripe().paymentIntents.retrieve(input.paymentIntentId, { expand: ["latest_charge"] });
    assertStripeObjectMode("PaymentIntent", paymentIntent.id, paymentIntent.livemode);
    const chargeId = idOf(paymentIntent.latest_charge);
    if (!chargeId) {
        return {
            disputed: false,
            safe: false,
            reason: "missing_latest_charge",
            existingExactRefund: null,
        };
    }
    const charge = await stripe().charges.retrieve(chargeId, {
        expand: ["refunds"],
    });
    assertStripeObjectMode("Charge", charge.id, charge.livemode);
    if (charge.disputed === true) {
        return {
            disputed: true,
            safe: false,
            reason: "provider_dispute_open",
            existingExactRefund: null,
        };
    }
    const providerRefunds = (_b = (_a = charge.refunds) === null || _a === void 0 ? void 0 : _a.data) !== null && _b !== void 0 ? _b : [];
    const expectedRefundReason = input.refundClaimKind === "order" ?
        input.refundReason : "paid_contract_mismatch";
    const exactExistingRefunds = input.classCancellationOperationId &&
        input.classCancellationProviderRequestPreviouslyPrepared === true &&
        input.expectedAmountPence !== null && input.expectedCurrency &&
        input.refundOwnerId && input.refundClaimKind ? providerRefunds.filter((refund) => {
        var _a, _b, _c, _d;
        return refund.amount === input.expectedAmountPence &&
            refund.currency === input.expectedCurrency &&
            idOf(refund.payment_intent) === input.paymentIntentId &&
            idOf(refund.charge) === charge.id &&
            ((_a = refund.metadata) === null || _a === void 0 ? void 0 : _a.refundReason) === expectedRefundReason &&
            ((_b = refund.metadata) === null || _b === void 0 ? void 0 : _b.classCancellationOperationId) ===
                input.classCancellationOperationId &&
            (input.refundClaimKind === "order" ?
                ((_c = refund.metadata) === null || _c === void 0 ? void 0 : _c.paygOrderId) === input.refundOwnerId :
                ((_d = refund.metadata) === null || _d === void 0 ? void 0 : _d.paygPaymentReviewId) === input.refundOwnerId) &&
            (refund.status === "pending" && charge.amount_refunded === 0 ||
                refund.status === "succeeded" &&
                    charge.amount_refunded === input.expectedAmountPence);
    }) : [];
    const existingExactRefund = exactExistingRefunds.length === 1 ?
        exactExistingRefunds[0] : null;
    const mismatches = [
        paymentIntent.id !== input.paymentIntentId ? "payment_intent_id" : null,
        paymentIntent.status !== "succeeded" ? "payment_intent_status" : null,
        !Number.isSafeInteger(paymentIntent.amount_received) ||
            paymentIntent.amount_received <= 0 ? "payment_intent_amount" : null,
        idOf(charge.payment_intent) !== paymentIntent.id ?
            "charge_payment_intent" : null,
        input.expectedChargeId && input.expectedChargeId !== charge.id ?
            "charge_id" : null,
        input.expectedAmountPence !== null &&
            paymentIntent.amount_received !== input.expectedAmountPence ?
            "expected_amount" : null,
        input.expectedAmountPence !== null &&
            charge.amount !== input.expectedAmountPence ? "charge_amount" : null,
        input.expectedCurrency &&
            paymentIntent.currency !== input.expectedCurrency ? "currency" : null,
        input.expectedCurrency && charge.currency !== input.expectedCurrency ?
            "charge_currency" : null,
        input.expectedAmountPence !== null && charge.paid !== true ?
            "charge_not_paid" : null,
        input.expectedAmountPence !== null && charge.status !== "succeeded" ?
            "charge_status" : null,
        input.classCancellationOperationId !== null &&
            input.classCancellationOperationId !== undefined &&
            existingExactRefund === null &&
            (!Number.isSafeInteger(charge.amount_refunded) ||
                charge.amount_refunded !== 0) ? "prior_refund" : null,
        exactExistingRefunds.length > 1 ? "multiple_exact_refunds" : null,
        ((_c = charge.refunds) === null || _c === void 0 ? void 0 : _c.has_more) === true ? "refund_history_truncated" : null,
    ].filter((value) => Boolean(value));
    return {
        disputed: false,
        safe: mismatches.length === 0,
        reason: mismatches.length ? `provider_${mismatches.join("_")}` : null,
        existingExactRefund,
    };
}
async function confirmPaygRefundIssuanceClaim(ref, kind, claim, nowMillis = Date.now()) {
    return db().runTransaction(async (tx) => {
        var _a;
        const snapshot = await tx.get(ref);
        const classCancellationOperationId = claim.classCancellationOperationId;
        const classCancellationIntentId = classCancellationOperationId &&
            kind === "payment_review" &&
            /^payg_[a-f0-9]{64}$/.test((_a = snapshot.get("intentId")) !== null && _a !== void 0 ? _a : "") ?
            snapshot.get("intentId") : null;
        const cancellationIntent = classCancellationIntentId ? await tx.get(db().collection("paygIntents").doc(classCancellationIntentId)) : null;
        const intentClass = cancellationIntent === null || cancellationIntent === void 0 ? void 0 : cancellationIntent.get("class");
        const classCancellationClassId = classCancellationOperationId ?
            kind === "order" && typeof snapshot.get("class.classId") === "string" ?
                snapshot.get("class.classId") :
                kind === "payment_review" &&
                    typeof (intentClass === null || intentClass === void 0 ? void 0 : intentClass.classId) === "string" ? intentClass.classId :
                    null : null;
        const [frozenClass, cancellationAudit] = classCancellationClassId &&
            classCancellationOperationId ? await Promise.all([
            tx.get(db().collection("classes").doc(classCancellationClassId)),
            tx.get(db().collection("classCancellationOperations")
                .doc(classCancellationOperationId)),
        ]) : [null, null];
        const providerRequestEvidencePresent = [
            "classCancellationRefundProviderRequestPreparedAt",
            "classCancellationRefundProviderIdempotencyKey",
            "classCancellationRefundProviderAmountPence",
            "classCancellationRefundProviderCurrency",
            "classCancellationRefundProviderOperationId",
        ].some((field) => snapshot.get(field) !== undefined);
        const exactProviderRequestEvidence = timestampMillis(snapshot.get("classCancellationRefundProviderRequestPreparedAt")) !== null && snapshot.get("classCancellationRefundProviderIdempotencyKey") === (kind === "order" ? `payg-refund:${ref.id}` :
            `payg-review-refund:${ref.id}`) && snapshot.get("classCancellationRefundProviderAmountPence") === exports.PAYG_AMOUNT_PENCE && snapshot.get("classCancellationRefundProviderCurrency") === exports.PAYG_CURRENCY && snapshot.get("classCancellationRefundProviderOperationId") === classCancellationOperationId;
        const exactFrozenOperation = classCancellationOperationId !== null &&
            frozenClass !== null && cancellationAudit !== null &&
            frozenClass.exists && frozenClass.get("status") === "scheduled" &&
            frozenClass.get("bookingOpen") === false &&
            frozenClass.get("bookingClosedReason") === "class_cancellation" &&
            frozenClass.get("cancellationOperationId") ===
                classCancellationOperationId && cancellationAudit.exists &&
            cancellationAudit.get("schemaVersion") === 1 &&
            cancellationAudit.get("operationId") === classCancellationOperationId &&
            cancellationAudit.get("classId") === classCancellationClassId &&
            ["processing", "awaiting_payg_refunds", "ready_to_finalize"].includes(String(cancellationAudit.get("state")));
        const noConflictingRefundState = snapshot.get("refundId") == null &&
            snapshot.get("disputeOpen") !== true &&
            snapshot.get("disputeId") == null &&
            snapshot.get("conflictingRefundId") == null &&
            snapshot.get("refundStatus") !== "succeeded";
        const exactClassCancellationOrder = kind === "order" &&
            classCancellationOperationId !== null && exactFrozenOperation &&
            snapshot.get("schemaVersion") === exports.PAYG_SCHEMA_VERSION &&
            snapshot.get("orderId") === ref.id &&
            snapshot.get("purchaseKind") === exports.PAYG_PURCHASE_KIND &&
            snapshot.get("offeringKey") === exports.PAYG_OFFERING_KEY &&
            snapshot.get("class.classId") === classCancellationClassId &&
            snapshot.get("amountPence") === exports.PAYG_AMOUNT_PENCE &&
            snapshot.get("currency") === exports.PAYG_CURRENCY &&
            snapshot.get("paymentIntentId") === claim.paymentIntentId &&
            snapshot.get("chargeId") === claim.expectedChargeId &&
            snapshot.get("refundReason") === "class_cancellation" &&
            snapshot.get("refundExpectedAmountPence") === exports.PAYG_AMOUNT_PENCE &&
            snapshot.get("classCancellationRefundStatus") === "refund_pending" &&
            snapshot.get("classCancellationOperationId") ===
                classCancellationOperationId &&
            timestampMillis(snapshot.get("classCancellationRequestedAt")) !== null &&
            timestampMillis(snapshot.get("classCancellationRefundRequestedAt")) !== null && snapshot.get("paymentReviewId") == null &&
            snapshot.get("providerContractStatus") == null &&
            noConflictingRefundState &&
            (!providerRequestEvidencePresent || exactProviderRequestEvidence);
        const exactClassCancellationReview = kind === "payment_review" &&
            classCancellationOperationId !== null && exactFrozenOperation &&
            cancellationIntent !== null && cancellationIntent.exists &&
            cancellationIntent.get("classCancellationOperationId") ===
                classCancellationOperationId &&
            cancellationIntent.get("checkoutSessionId") ===
                snapshot.get("checkoutSessionId") &&
            cancellationIntent.get("paymentIntentId") === claim.paymentIntentId &&
            snapshot.get("schemaVersion") === exports.PAYG_SCHEMA_VERSION &&
            snapshot.get("classCancellationRefundAuthorized") === true &&
            snapshot.get("classCancellationOperationId") ===
                classCancellationOperationId &&
            snapshot.get("paymentIntentId") === claim.paymentIntentId &&
            snapshot.get("providerAmountReceivedPence") === exports.PAYG_AMOUNT_PENCE &&
            snapshot.get("providerCurrency") === exports.PAYG_CURRENCY &&
            snapshot.get("refundExpectedAmountPence") === exports.PAYG_AMOUNT_PENCE &&
            snapshot.get("refundReason") === "paid_contract_mismatch" &&
            snapshot.get("automaticRefundSafe") === true &&
            noConflictingRefundState &&
            (!providerRequestEvidencePresent || exactProviderRequestEvidence);
        const exactClassCancellationBinding = classCancellationOperationId === null ||
            exactClassCancellationOrder || exactClassCancellationReview;
        const claimExpiresAt = snapshot.exists ? timestampMillis(snapshot.get("refundAutomationClaimExpiresAt")) : null;
        const valid = snapshot.exists &&
            snapshot.get("refundAutomationClaimToken") === claim.token &&
            snapshot.get("refundAutomationClaimPaymentIntentId") ===
                claim.paymentIntentId &&
            claimExpiresAt !== null && claimExpiresAt > nowMillis &&
            paygRefundClaimEligible(snapshot, kind) &&
            exactClassCancellationBinding;
        if (!valid) {
            if (snapshot.exists &&
                snapshot.get("refundAutomationClaimToken") === claim.token) {
                tx.set(ref, Object.assign(Object.assign(Object.assign({}, paygRefundClaimCleanup()), (snapshot.get("disputeOpen") === true ||
                    snapshot.get("refundAutomationStatus") === "suspended_dispute" ? {
                    refundRecoveryAt: firestore_1.FieldValue.delete(),
                } : {})), { updatedAt: serverTimestamp() }), { merge: true });
            }
            return false;
        }
        tx.set(ref, Object.assign(Object.assign({ refundAutomationClaimProviderCheckedAt: serverTimestamp() }, (claim.classCancellationOperationId &&
            claim.expectedAmountPence === exports.PAYG_AMOUNT_PENCE &&
            claim.expectedCurrency === exports.PAYG_CURRENCY ? {
            classCancellationRefundProviderRequestPreparedAt: serverTimestamp(),
            classCancellationRefundProviderIdempotencyKey: kind === "order" ? `payg-refund:${ref.id}` :
                `payg-review-refund:${ref.id}`,
            classCancellationRefundProviderAmountPence: claim.expectedAmountPence,
            classCancellationRefundProviderCurrency: claim.expectedCurrency,
            classCancellationRefundProviderOperationId: claim.classCancellationOperationId,
        } : {})), { updatedAt: serverTimestamp() }), { merge: true });
        return true;
    });
}
async function finishPaygRefundIssuanceClaim(ref, kind, claimToken, update) {
    return db().runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists)
            return false;
        const ownsClaim = snapshot.get("refundAutomationClaimToken") === claimToken;
        if (!ownsClaim)
            return false;
        if (!paygRefundClaimEligible(snapshot, kind)) {
            // A dispute/refund terminal transition won the race. Revoke only this
            // stale claim and preserve every newer status/provider fact.
            tx.set(ref, Object.assign(Object.assign({}, paygRefundClaimCleanup()), { updatedAt: serverTimestamp() }), { merge: true });
            return false;
        }
        tx.set(ref, Object.assign(Object.assign(Object.assign({}, update), paygRefundClaimCleanup()), { updatedAt: serverTimestamp() }), { merge: true });
        return true;
    });
}
async function persistCreatedPaygRefund(ref, claimToken, refundId, reason) {
    await db().runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists)
            return;
        const ownsClaim = snapshot.get("refundAutomationClaimToken") === claimToken;
        const storedRefundId = snapshot.get("refundId");
        const conflictingRefundId = typeof storedRefundId === "string" &&
            storedRefundId.startsWith("re_") && storedRefundId !== refundId;
        tx.set(ref, Object.assign(Object.assign(Object.assign(Object.assign({}, (conflictingRefundId ? {
            conflictingRefundId: refundId,
        } : {
            refundId,
        })), (reason ? { refundReason: reason } : {})), (ownsClaim ? paygRefundClaimCleanup() : {})), { updatedAt: serverTimestamp() }), { merge: true });
    });
}
async function recordPaygRefundProviderDispute(ref, kind, claimToken) {
    const suspended = await finishPaygRefundIssuanceClaim(ref, kind, claimToken, {
        status: "manual_review",
        refundAutomationStatus: "suspended_dispute",
        refundStatus: "provider_dispute_detected",
        providerDisputeDetectedAt: serverTimestamp(),
        refundRecoveryAt: firestore_1.FieldValue.delete(),
    });
    if (!suspended) {
        return;
    }
    console.error(kind === "order" ?
        "CRITICAL_BILLING_PAYG_REFUND_PROVIDER_DISPUTE" :
        "CRITICAL_BILLING_PAYG_REVIEW_REFUND_PROVIDER_DISPUTE", {
        [`${kind === "order" ? "order" : "paymentReview"}Id`]: ref.id,
    });
}
async function recordPaygRefundIssuanceFailure(ref, kind, claimToken, error) {
    await db().runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists ||
            snapshot.get("refundAutomationClaimToken") !== claimToken)
            return;
        const canRetry = paygRefundClaimEligible(snapshot, kind);
        if (!canRetry) {
            tx.set(ref, Object.assign(Object.assign({}, paygRefundClaimCleanup()), { updatedAt: serverTimestamp() }), { merge: true });
            return;
        }
        tx.set(ref, Object.assign(Object.assign({}, paygRefundClaimCleanup()), { refundRecoveryAt: firestore_1.Timestamp.fromMillis(Date.now() + 5 * 60 * 1000), refundLastError: error instanceof Error ?
                error.message.slice(0, 500) : String(error).slice(0, 500), updatedAt: serverTimestamp() }), { merge: true });
    });
}
async function issuePaygRefund(orderId, reason) {
    var _a;
    const orderRef = db().collection("paygOrders").doc(orderId);
    const claim = await acquirePaygRefundIssuanceClaim(orderRef, "order", reason);
    if (claim.state === "complete" || claim.state === "in_progress")
        return;
    if (claim.state === "blocked") {
        throw new Error(`PAYG order ${orderId} is not awaiting a refund.`);
    }
    let refund;
    if (claim.state === "existing") {
        refund = await stripe().refunds.retrieve(claim.refundId);
        if (!await convergePaygRefund(refund)) {
            throw new Error(`Refund ${refund.id} has no matching PAYG order.`);
        }
        return;
    }
    let provider;
    try {
        provider = await refreshPaygRefundProviderState(claim);
    }
    catch (error) {
        await recordPaygRefundIssuanceFailure(orderRef, "order", claim.token, error);
        throw error;
    }
    if (provider.disputed) {
        await recordPaygRefundProviderDispute(orderRef, "order", claim.token);
        return;
    }
    if (!provider.safe) {
        const failed = await finishPaygRefundIssuanceClaim(orderRef, "order", claim.token, {
            status: "manual_review",
            refundAutomationStatus: "provider_preflight_failed",
            refundStatus: (_a = provider.reason) !== null && _a !== void 0 ? _a : "provider_preflight_failed",
            refundRecoveryAt: firestore_1.FieldValue.delete(),
        });
        if (failed) {
            console.error("CRITICAL_BILLING_PAYG_REFUND_PROVIDER_PREFLIGHT", {
                orderId,
                reason: provider.reason,
            });
        }
        return;
    }
    if (provider.existingExactRefund) {
        if (!await confirmPaygRefundIssuanceClaim(orderRef, "order", claim))
            return;
        await persistCreatedPaygRefund(orderRef, claim.token, provider.existingExactRefund.id, reason);
        if (!await convergePaygRefund(provider.existingExactRefund)) {
            throw new Error(`Refund ${provider.existingExactRefund.id} has no matching PAYG order.`);
        }
        return;
    }
    if (!await confirmPaygRefundIssuanceClaim(orderRef, "order", claim))
        return;
    try {
        // Omitting amount requests the full remaining PaymentIntent amount. This
        // is essential for a paid-contract mismatch, where the captured amount
        // itself may differ from the approved PAYG price. The stable key recovers
        // a provider-success/local-crash window without issuing a second refund.
        refund = await stripe().refunds.create(Object.assign(Object.assign({ payment_intent: claim.paymentIntentId }, (reason === "class_cancellation" ? {
            amount: exports.PAYG_AMOUNT_PENCE,
        } : {})), { metadata: Object.assign(Object.assign({ purchaseKind: exports.PAYG_PURCHASE_KIND, offeringKey: exports.PAYG_OFFERING_KEY, paygOrderId: orderId, refundReason: reason }, (claim.classCancellationOperationId ? {
                classCancellationOperationId: claim.classCancellationOperationId,
            } : {})), { schemaVersion: String(exports.PAYG_SCHEMA_VERSION) }) }), { idempotencyKey: `payg-refund:${orderId}` });
    }
    catch (error) {
        await recordPaygRefundIssuanceFailure(orderRef, "order", claim.token, error);
        throw error;
    }
    await persistCreatedPaygRefund(orderRef, claim.token, refund.id, reason);
    if (!await convergePaygRefund(refund)) {
        throw new Error(`Refund ${refund.id} has no matching PAYG order.`);
    }
}
function paygPaymentReviewId(intentId, sessionId, paymentIntentId) {
    return `${intentId}_${sha256(paymentIntentId || sessionId).slice(0, 24)}`;
}
function isExactPaygPaymentReviewOwner(review, intentId, checkoutSessionId, paymentIntentId) {
    if (!review.exists)
        return false;
    const exact = review.get("intentId") === intentId &&
        review.get("checkoutSessionId") === checkoutSessionId &&
        review.get("paymentIntentId") === paymentIntentId;
    if (!exact) {
        throw new Error(`PAYG payment review ${review.id} conflicts with its deterministic owner binding.`);
    }
    return true;
}
async function paygPaymentReviewRefForRefund(refund) {
    var _a;
    const refundMatches = await db().collection(exports.PAYG_PAYMENT_REVIEW_COLLECTION)
        .where("refundId", "==", refund.id)
        .limit(2)
        .get();
    if (refundMatches.size > 1) {
        throw new Error(`Refund ${refund.id} belongs to multiple PAYG payment reviews.`);
    }
    if (refundMatches.size === 1)
        return refundMatches.docs[0].ref;
    const metadataReviewId = (_a = refund.metadata) === null || _a === void 0 ? void 0 : _a.paygPaymentReviewId;
    if (typeof metadataReviewId === "string" &&
        /^payg_[a-f0-9]{64}_[a-f0-9]{24}$/.test(metadataReviewId)) {
        const direct = await db().collection(exports.PAYG_PAYMENT_REVIEW_COLLECTION)
            .doc(metadataReviewId)
            .get();
        if (direct.exists)
            return direct.ref;
    }
    const paymentIntentId = idOf(refund.payment_intent);
    if (!paymentIntentId)
        return null;
    const paymentMatches = await db().collection(exports.PAYG_PAYMENT_REVIEW_COLLECTION)
        .where("paymentIntentId", "==", paymentIntentId)
        .limit(2)
        .get();
    if (paymentMatches.size > 1) {
        throw new Error(`PaymentIntent ${paymentIntentId} has multiple PAYG payment reviews.`);
    }
    return paymentMatches.size === 1 ? paymentMatches.docs[0].ref : null;
}
async function convergePaygPaymentReviewRefund(refund) {
    const reviewRef = await paygPaymentReviewRefForRefund(refund);
    if (!reviewRef)
        return false;
    await db().runTransaction(async (tx) => {
        var _a, _b, _c;
        const review = await tx.get(reviewRef);
        if (!review.exists)
            return;
        const paymentIntentId = idOf(refund.payment_intent);
        const expectedAmount = Number(review.get("refundExpectedAmountPence"));
        const exact = review.get("automaticRefundSafe") === true &&
            typeof review.get("paymentIntentId") === "string" &&
            paymentIntentId === review.get("paymentIntentId") &&
            Number.isSafeInteger(expectedAmount) && expectedAmount > 0 &&
            refund.amount === expectedAmount &&
            refund.currency === review.get("providerCurrency");
        const knownStatus = refund.status === "pending" ||
            refund.status === "succeeded" || refund.status === "failed" ||
            refund.status === "canceled";
        const currentReviewStatus = review.get("status");
        const manualPrecedence = currentReviewStatus === "manual_review" ||
            currentReviewStatus === "disputed";
        if (!exact || !knownStatus) {
            tx.set(reviewRef, Object.assign(Object.assign({ status: "manual_review", refundId: refund.id, refundStatus: exact ?
                    `unsupported_${String(refund.status)}` : "provider_contract_mismatch", refundRecoveryAt: firestore_1.FieldValue.delete(), refundFailureReason: (_a = refund.failure_reason) !== null && _a !== void 0 ? _a : null }, paygRefundClaimCleanup()), { updatedAt: serverTimestamp() }), { merge: true });
            console.error("CRITICAL_BILLING_PAYG_REVIEW_REFUND_MANUAL_REVIEW", {
                paymentReviewId: reviewRef.id,
                refundId: refund.id,
                exact,
                refundStatus: refund.status,
            });
            return;
        }
        const status = refund.status;
        if (shouldPreservePaygSucceededRefund({
            ownerStatus: review.get("status"),
            storedRefundId: review.get("refundId"),
            storedRefundStatus: review.get("refundStatus"),
            incomingRefundId: refund.id,
            incomingRefundStatus: status,
            exactProviderBinding: true,
        })) {
            tx.set(reviewRef, Object.assign(Object.assign({ status: review.get("status") === "disputed" ? "disputed" :
                    review.get("status") === "manual_review" ? "manual_review" : "refunded", refundId: refund.id, refundStatus: "succeeded", refundRecoveryAt: firestore_1.FieldValue.delete() }, paygRefundClaimCleanup()), { updatedAt: serverTimestamp() }), { merge: true });
            return;
        }
        const terminalSuccess = status === "succeeded";
        const terminalFailure = status === "failed" || status === "canceled";
        const pendingBinding = status === "pending" ?
            resolvePaygPendingRefundBinding({
                ownerStatus: review.get("status"),
                storedRefundId: review.get("refundId"),
                incomingRefundId: refund.id,
                disputeOpen: review.get("disputeOpen"),
                refundAutomationStatus: review.get("refundAutomationStatus"),
            }) : null;
        if (pendingBinding === "conflict_manual_review") {
            tx.set(reviewRef, Object.assign(Object.assign({ status: currentReviewStatus === "disputed" ? "disputed" : "manual_review", refundStatus: "conflicting_refund_id", conflictingRefundId: refund.id, refundRecoveryAt: firestore_1.FieldValue.delete() }, paygRefundClaimCleanup()), { updatedAt: serverTimestamp() }), { merge: true });
            console.error("CRITICAL_BILLING_PAYG_REVIEW_REFUND_ID_CONFLICT", {
                paymentReviewId: reviewRef.id,
                storedRefundId: (_b = review.get("refundId")) !== null && _b !== void 0 ? _b : null,
                incomingRefundId: refund.id,
            });
            return;
        }
        const deliberatePendingPoll = pendingBinding === "bind_and_recover" ||
            pendingBinding === "recover_bound";
        tx.set(reviewRef, Object.assign(Object.assign(Object.assign({ status: manualPrecedence ? currentReviewStatus :
                terminalSuccess ? "refunded" : terminalFailure ?
                    "manual_review" : "refund_pending", refundId: refund.id, refundStatus: status, refundedAmountPence: terminalSuccess ? refund.amount : firestore_1.FieldValue.delete(), refundedAt: terminalSuccess ? serverTimestamp() : firestore_1.FieldValue.delete(), refundFailureReason: (_c = refund.failure_reason) !== null && _c !== void 0 ? _c : firestore_1.FieldValue.delete() }, (deliberatePendingPoll && !manualPrecedence ? {
            refundRecoveryAt: firestore_1.Timestamp.fromMillis(Date.now() + 5 * 60 * 1000),
        } : {
            refundRecoveryAt: firestore_1.FieldValue.delete(),
        })), paygRefundClaimCleanup()), { updatedAt: serverTimestamp() }), { merge: true });
    });
    return true;
}
async function issuePaygPaymentReviewRefund(reviewId) {
    var _a, _b, _c;
    const reviewRef = db().collection(exports.PAYG_PAYMENT_REVIEW_COLLECTION).doc(reviewId);
    const claim = await acquirePaygRefundIssuanceClaim(reviewRef, "payment_review");
    if (claim.state === "complete" || claim.state === "in_progress")
        return;
    if (claim.state === "blocked") {
        throw new Error(`PAYG payment review ${reviewId} is not refund-safe.`);
    }
    let refund;
    if (claim.state === "existing") {
        refund = await stripe().refunds.retrieve(claim.refundId);
        if (!await convergePaygPaymentReviewRefund(refund)) {
            throw new Error(`Refund ${refund.id} has no matching PAYG payment review.`);
        }
        return;
    }
    let provider;
    try {
        provider = await refreshPaygRefundProviderState(claim);
    }
    catch (error) {
        await recordPaygRefundIssuanceFailure(reviewRef, "payment_review", claim.token, error);
        throw error;
    }
    if (provider.disputed) {
        await recordPaygRefundProviderDispute(reviewRef, "payment_review", claim.token);
        return;
    }
    if (!provider.safe) {
        const failed = await finishPaygRefundIssuanceClaim(reviewRef, "payment_review", claim.token, {
            status: "manual_review",
            refundAutomationStatus: "provider_preflight_failed",
            refundStatus: (_a = provider.reason) !== null && _a !== void 0 ? _a : "provider_preflight_failed",
            refundRecoveryAt: firestore_1.FieldValue.delete(),
        });
        if (failed) {
            console.error("CRITICAL_BILLING_PAYG_REVIEW_REFUND_PROVIDER_PREFLIGHT", {
                paymentReviewId: reviewId,
                reason: provider.reason,
            });
        }
        return;
    }
    if (provider.existingExactRefund) {
        if (!await confirmPaygRefundIssuanceClaim(reviewRef, "payment_review", claim))
            return;
        await persistCreatedPaygRefund(reviewRef, claim.token, provider.existingExactRefund.id);
        if (!await convergePaygPaymentReviewRefund(provider.existingExactRefund)) {
            throw new Error(`Refund ${provider.existingExactRefund.id} has no matching PAYG payment review.`);
        }
        return;
    }
    if (!await confirmPaygRefundIssuanceClaim(reviewRef, "payment_review", claim))
        return;
    try {
        refund = await stripe().refunds.create({
            payment_intent: claim.paymentIntentId,
            amount: (_b = claim.expectedAmountPence) !== null && _b !== void 0 ? _b : undefined,
            metadata: Object.assign(Object.assign({ purchaseKind: exports.PAYG_PURCHASE_KIND, offeringKey: exports.PAYG_OFFERING_KEY, paygIntentId: (_c = claim.intentId) !== null && _c !== void 0 ? _c : "unrecorded", paygPaymentReviewId: reviewId, refundReason: "paid_contract_mismatch" }, (claim.classCancellationOperationId ? {
                classCancellationOperationId: claim.classCancellationOperationId,
            } : {})), { schemaVersion: String(exports.PAYG_SCHEMA_VERSION) }),
        }, { idempotencyKey: `payg-review-refund:${reviewId}` });
    }
    catch (error) {
        await recordPaygRefundIssuanceFailure(reviewRef, "payment_review", claim.token, error);
        throw error;
    }
    await persistCreatedPaygRefund(reviewRef, claim.token, refund.id);
    if (!await convergePaygPaymentReviewRefund(refund)) {
        throw new Error(`Refund ${refund.id} has no matching PAYG payment review.`);
    }
}
async function persistPaygPaymentReviewOnly(input) {
    var _a, _b;
    const { intentRef, intent, session, paymentIntent, mismatches } = input;
    const paymentIntentId = (_a = paymentIntent === null || paymentIntent === void 0 ? void 0 : paymentIntent.id) !== null && _a !== void 0 ? _a : idOf(session.payment_intent);
    const reviewRef = db().collection(exports.PAYG_PAYMENT_REVIEW_COLLECTION).doc(paygPaymentReviewId(intentRef.id, session.id, paymentIntentId));
    const disposition = resolvePaygPaymentReviewDisposition(input.automaticRefundSafe, (_b = paymentIntent === null || paymentIntent === void 0 ? void 0 : paymentIntent.amount_received) !== null && _b !== void 0 ? _b : null);
    const { issueRefund } = disposition;
    const orderRef = db().collection("paygOrders").doc(intentRef.id);
    const classRef = db().collection("classes").doc(intent.class.classId);
    const lockRef = paygDuplicateLockRef(intent.duplicateLockId);
    const outcome = await db().runTransaction(async (tx) => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
        const [freshIntent, canonicalOrder, existingReview, classSnap, lockSnap] = await Promise.all([
            tx.get(intentRef),
            tx.get(orderRef),
            tx.get(reviewRef),
            tx.get(classRef),
            lockRef ? tx.get(lockRef) : Promise.resolve(null),
        ]);
        if (!freshIntent.exists)
            throw new Error(`PAYG intent ${intentRef.id} disappeared.`);
        const current = freshIntent.data();
        const classCancellationOperationId = typeof freshIntent.get("classCancellationOperationId") === "string" ? freshIntent.get("classCancellationOperationId") : null;
        const classCancellationFields = classCancellationOperationId &&
            /^class_cancel_[a-f0-9]{64}$/.test(classCancellationOperationId) &&
            classSnap.exists && classSnap.get("status") === "scheduled" &&
            classSnap.get("bookingOpen") === false &&
            classSnap.get("bookingClosedReason") === "class_cancellation" &&
            classSnap.get("cancellationOperationId") ===
                classCancellationOperationId ? {
            classCancellationOperationId,
            classCancellationRequestedAt: (_a = freshIntent.get("classCancellationRequestedAt")) !== null && _a !== void 0 ? _a : serverTimestamp(),
            classCancellationRefundAuthorized: true,
        } : {};
        const exactCanonicalOrder = canonicalOrder.exists &&
            canonicalOrder.get("purchaseKind") === exports.PAYG_PURCHASE_KIND &&
            canonicalOrder.get("orderId") === intentRef.id &&
            canonicalOrder.get("checkoutSessionId") === session.id &&
            typeof paymentIntentId === "string" &&
            canonicalOrder.get("paymentIntentId") === paymentIntentId;
        if (exactCanonicalOrder) {
            return { reviewWritten: false, issueRefund: false };
        }
        if (typeof paymentIntentId === "string" &&
            isExactPaygPaymentReviewOwner(existingReview, intentRef.id, session.id, paymentIntentId)) {
            return { reviewWritten: false, issueRefund: false };
        }
        if (canonicalOrder.exists) {
            const reviewDisposition = resolvePaygCanonicalOrderReviewDisposition({
                canonicalPaymentIntentId: canonicalOrder.get("paymentIntentId"),
                observedPaymentIntentId: paymentIntentId,
                automaticRefundSafe: input.automaticRefundSafe,
                amountReceivedPence: (_b = paymentIntent === null || paymentIntent === void 0 ? void 0 : paymentIntent.amount_received) !== null && _b !== void 0 ? _b : null,
            });
            tx.set(reviewRef, Object.assign(Object.assign({ schemaVersion: exports.PAYG_SCHEMA_VERSION, status: reviewDisposition.status, intentId: intentRef.id, checkoutSessionId: session.id, paymentIntentId, canonicalOrderId: orderRef.id, canonicalOrderStatusAtDetection: canonicalOrder.get("status"), canonicalCheckoutSessionId: canonicalOrder.get("checkoutSessionId"), canonicalPaymentIntentId: canonicalOrder.get("paymentIntentId"), canonicalServicePreserved: true, mismatches: [...mismatches, "canonical_order_already_exists"], refundRecommended: Boolean(paymentIntent && paymentIntent.amount_received > 0), automaticRefundSafe: reviewDisposition.issueRefund, providerAmountReceivedPence: (_c = paymentIntent === null || paymentIntent === void 0 ? void 0 : paymentIntent.amount_received) !== null && _c !== void 0 ? _c : null, providerCurrency: (_e = (_d = paymentIntent === null || paymentIntent === void 0 ? void 0 : paymentIntent.currency) !== null && _d !== void 0 ? _d : session.currency) !== null && _e !== void 0 ? _e : null, refundExpectedAmountPence: reviewDisposition.issueRefund ?
                    paymentIntent === null || paymentIntent === void 0 ? void 0 : paymentIntent.amount_received : firestore_1.FieldValue.delete(), refundReason: reviewDisposition.issueRefund ?
                    "paid_contract_mismatch" : firestore_1.FieldValue.delete(), refundRecoveryAt: reviewDisposition.scheduleRecovery ?
                    firestore_1.Timestamp.fromMillis(Date.now()) : firestore_1.FieldValue.delete() }, classCancellationFields), { updatedAt: serverTimestamp(), createdAt: serverTimestamp() }), { merge: true });
            return {
                reviewWritten: true,
                issueRefund: reviewDisposition.issueRefund,
            };
        }
        if ((current.capacityState === "held" ||
            current.unpaidHoldState === "counted") && classSnap.exists) {
            const bookedCount = Number((_f = classSnap.get("bookedCount")) !== null && _f !== void 0 ? _f : 0);
            const unpaidHoldCount = Number((_g = classSnap.get("paygUnpaidHoldCount")) !== null && _g !== void 0 ? _g : 0);
            tx.set(classSnap.ref, Object.assign(Object.assign(Object.assign({}, (current.capacityState === "held" ? {
                bookedCount: firestore_1.FieldValue.increment(bookedCount > 0 ? -1 : 0),
            } : {})), (current.unpaidHoldState === "counted" ? {
                paygUnpaidHoldCount: firestore_1.FieldValue.increment(unpaidHoldCount > 0 ? -1 : 0),
            } : {})), { updatedAt: serverTimestamp() }), { merge: true });
        }
        releasePaygDuplicateLock(tx, lockSnap, intentRef.id);
        tx.set(intentRef, Object.assign(Object.assign({ status: "manual_review", paymentReviewStatus: disposition.status, capacityState: "released", unpaidHoldState: "released", checkoutSessionId: session.id, paymentIntentId, holdExpiresAt: firestore_1.FieldValue.delete(), paidContractMismatches: [...mismatches], paymentReviewId: reviewRef.id }, existingPaygIntentPrivacySchedule(freshIntent)), { piiDeleteAt: firestore_1.FieldValue.delete(), updatedAt: serverTimestamp() }), { merge: true });
        tx.set(reviewRef, Object.assign(Object.assign({ schemaVersion: exports.PAYG_SCHEMA_VERSION, status: disposition.status, intentId: intentRef.id, checkoutSessionId: session.id, paymentIntentId, mismatches: [...mismatches], refundRecommended: Boolean(paymentIntent && paymentIntent.amount_received > 0), automaticRefundSafe: issueRefund, providerAmountReceivedPence: (_h = paymentIntent === null || paymentIntent === void 0 ? void 0 : paymentIntent.amount_received) !== null && _h !== void 0 ? _h : null, providerCurrency: (_k = (_j = paymentIntent === null || paymentIntent === void 0 ? void 0 : paymentIntent.currency) !== null && _j !== void 0 ? _j : session.currency) !== null && _k !== void 0 ? _k : null, refundExpectedAmountPence: issueRefund ?
                paymentIntent === null || paymentIntent === void 0 ? void 0 : paymentIntent.amount_received : firestore_1.FieldValue.delete(), refundReason: issueRefund ?
                "paid_contract_mismatch" : firestore_1.FieldValue.delete(), refundRecoveryAt: disposition.scheduleRecovery ?
                firestore_1.Timestamp.fromMillis(Date.now()) : firestore_1.FieldValue.delete() }, classCancellationFields), { updatedAt: serverTimestamp(), createdAt: serverTimestamp() }), { merge: true });
        return { reviewWritten: true, issueRefund };
    });
    if (!outcome.reviewWritten) {
        return { reviewId: reviewRef.id, issueRefund: false };
    }
    console.error("CRITICAL_BILLING_PAYG_PAYMENT_REVIEW_REQUIRED", {
        intentId: intentRef.id,
        checkoutSessionId: session.id,
        paymentIntentId,
        mismatches,
        automaticRefundSafe: outcome.issueRefund,
    });
    return { reviewId: reviewRef.id, issueRefund: outcome.issueRefund };
}
async function persistPaygPaidContractMismatch(input) {
    const { intentRef, intent, session, paymentIntent, mismatches } = input;
    const orderRef = db().collection("paygOrders").doc(intentRef.id);
    const bookingId = paygGuestBookingId(intentRef.id);
    const bookingRef = db().collection("bookings").doc(bookingId);
    const waiverRef = db().collection("paygWaiverAcceptances").doc(intentRef.id);
    const outboxRef = db().collection("paygEmailOutbox").doc(intentRef.id);
    const classRef = db().collection("classes").doc(intent.class.classId);
    const lockRef = paygDuplicateLockRef(intent.duplicateLockId);
    const reviewRef = db().collection(exports.PAYG_PAYMENT_REVIEW_COLLECTION).doc(paygPaymentReviewId(intentRef.id, session.id, paymentIntent.id));
    return db().runTransaction(async (tx) => {
        var _a, _b;
        const [freshIntentSnap, existingOrderSnap, bookingSnap, waiverSnap, outboxSnap, classSnap, lockSnap, existingReviewSnap] = await Promise.all([
            tx.get(intentRef),
            tx.get(orderRef),
            tx.get(bookingRef),
            tx.get(waiverRef),
            tx.get(outboxRef),
            tx.get(classRef),
            lockRef ? tx.get(lockRef) : Promise.resolve(null),
            tx.get(reviewRef),
        ]);
        if (!freshIntentSnap.exists) {
            throw new Error(`PAYG intent ${intentRef.id} disappeared.`);
        }
        const freshIntent = freshIntentSnap.data();
        const transactionPiiProcessingAtMillis = Math.max(input.processingNowMillis, Date.now());
        const existingOrder = existingOrderSnap.exists ?
            existingOrderSnap.data() : null;
        const exactCanonicalOrder = existingOrder !== null &&
            existingOrder.purchaseKind === exports.PAYG_PURCHASE_KIND &&
            existingOrder.orderId === intentRef.id &&
            existingOrder.checkoutSessionId === session.id &&
            existingOrder.paymentIntentId === paymentIntent.id;
        if (exactCanonicalOrder) {
            return { issueRefund: false, paymentReviewRefundId: null };
        }
        if (isExactPaygPaymentReviewOwner(existingReviewSnap, intentRef.id, session.id, paymentIntent.id)) {
            return { issueRefund: false, paymentReviewRefundId: null };
        }
        const conflictingExistingOrder = existingOrder !== null &&
            (existingOrder.checkoutSessionId !== session.id ||
                existingOrder.paymentIntentId !== paymentIntent.id);
        if (conflictingExistingOrder) {
            const reviewDisposition = resolvePaygCanonicalOrderReviewDisposition({
                canonicalPaymentIntentId: existingOrder.paymentIntentId,
                observedPaymentIntentId: paymentIntent.id,
                automaticRefundSafe: input.automaticRefundSafe,
                amountReceivedPence: paymentIntent.amount_received,
            });
            const reviewRefundSafe = reviewDisposition.issueRefund;
            tx.set(reviewRef, {
                schemaVersion: exports.PAYG_SCHEMA_VERSION,
                status: reviewDisposition.status,
                intentId: intentRef.id,
                checkoutSessionId: session.id,
                paymentIntentId: paymentIntent.id,
                canonicalOrderId: orderRef.id,
                canonicalOrderStatusAtDetection: existingOrder.status,
                canonicalCheckoutSessionId: existingOrder.checkoutSessionId,
                canonicalPaymentIntentId: existingOrder.paymentIntentId,
                canonicalServicePreserved: true,
                mismatches: [...mismatches, "conflicting_existing_order"],
                refundRecommended: paymentIntent.amount_received > 0,
                automaticRefundSafe: reviewRefundSafe,
                providerAmountReceivedPence: paymentIntent.amount_received,
                providerCurrency: paymentIntent.currency,
                refundExpectedAmountPence: reviewRefundSafe ?
                    paymentIntent.amount_received : firestore_1.FieldValue.delete(),
                refundReason: reviewRefundSafe ?
                    "paid_contract_mismatch" : firestore_1.FieldValue.delete(),
                refundRecoveryAt: reviewDisposition.scheduleRecovery ?
                    firestore_1.Timestamp.fromMillis(Date.now()) : firestore_1.FieldValue.delete(),
                updatedAt: serverTimestamp(),
                createdAt: serverTimestamp(),
            }, { merge: true });
            return {
                issueRefund: false,
                paymentReviewRefundId: reviewRefundSafe ? reviewRef.id : null,
            };
        }
        const privacyPromotionMismatch = paygPiiPromotionMismatch({
            intent: freshIntent,
            paymentIntent,
            charge: input.charge,
            successEvidence: input.successEvidence,
            checkoutSessionId: session.id,
            intentId: intentRef.id,
            expectedLivemode: input.expectedLivemode,
            processingNowMillis: transactionPiiProcessingAtMillis,
        });
        const preserveRefunded = (existingOrder === null || existingOrder === void 0 ? void 0 : existingOrder.status) === "refunded";
        const precedence = (existingOrder === null || existingOrder === void 0 ? void 0 : existingOrder.status) === "disputed" ||
            (existingOrder === null || existingOrder === void 0 ? void 0 : existingOrder.status) === "manual_review";
        const fulfilledService = (existingOrder === null || existingOrder === void 0 ? void 0 : existingOrder.status) === "attended" ||
            (existingOrder === null || existingOrder === void 0 ? void 0 : existingOrder.status) === "no_show" || (existingOrder === null || existingOrder === void 0 ? void 0 : existingOrder.status) === "cancelled";
        const targetStatus = preserveRefunded ? "refunded" :
            precedence ? existingOrder.status : fulfilledService ? "manual_review" :
                input.automaticRefundSafe ? "refund_pending" : "manual_review";
        const issueRefund = targetStatus === "refund_pending" &&
            existingOrderSnap.get("refundStatus") !== "succeeded";
        if (existingOrder) {
            await releasePaidOrderCapacity(tx, orderRef, existingOrder, bookingSnap, classSnap, outboxSnap, lockSnap, Object.assign({ status: targetStatus, cancelledReason: "payg_paid_contract_mismatch", providerContractStatus: "mismatch", providerContractMismatches: [...mismatches], providerAmountReceivedPence: paymentIntent.amount_received, refundExpectedAmountPence: paymentIntent.amount_received, refundRecommended: paymentIntent.amount_received > 0, automaticRefundSafe: input.automaticRefundSafe, paymentReviewId: reviewRef.id }, (issueRefund ? {
                refundRecoveryAt: firestore_1.Timestamp.fromMillis(Date.now()),
                refundReason: "paid_contract_mismatch",
            } : {
                refundRecoveryAt: firestore_1.FieldValue.delete(),
            })));
        }
        else {
            if (privacyPromotionMismatch !== null) {
                throw new PaygPiiPromotionClosedError(privacyPromotionMismatch);
            }
            if ((freshIntent.capacityState === "held" ||
                freshIntent.unpaidHoldState === "counted") && classSnap.exists) {
                const bookedCount = Number((_a = classSnap.get("bookedCount")) !== null && _a !== void 0 ? _a : 0);
                const unpaidHoldCount = Number((_b = classSnap.get("paygUnpaidHoldCount")) !== null && _b !== void 0 ? _b : 0);
                tx.set(classSnap.ref, Object.assign(Object.assign(Object.assign({}, (freshIntent.capacityState === "held" ? {
                    bookedCount: firestore_1.FieldValue.increment(bookedCount > 0 ? -1 : 0),
                } : {})), (freshIntent.unpaidHoldState === "counted" ? {
                    paygUnpaidHoldCount: firestore_1.FieldValue.increment(unpaidHoldCount > 0 ? -1 : 0),
                } : {})), { updatedAt: serverTimestamp() }), { merge: true });
            }
            if (bookingSnap.exists && bookingSnap.get("status") === "booked") {
                tx.set(bookingRef, {
                    status: "cancelled",
                    cancelledAt: serverTimestamp(),
                    cancelledReason: "payg_paid_contract_mismatch",
                    updatedAt: serverTimestamp(),
                }, { merge: true });
            }
            releasePaygDuplicateLock(tx, lockSnap, intentRef.id);
            tombstonePaygConfirmation(tx, outboxSnap, "payg_paid_contract_mismatch");
            const order = buildPaygOrder(intentRef, freshIntent, session, paymentIntent, targetStatus === "refund_pending" ? "refund_pending" : "manual_review", "released", null);
            tx.create(orderRef, Object.assign(Object.assign(Object.assign({}, order), { providerContractStatus: "mismatch", providerContractMismatches: [...mismatches], providerAmountReceivedPence: paymentIntent.amount_received, refundExpectedAmountPence: paymentIntent.amount_received, refundRecommended: paymentIntent.amount_received > 0, automaticRefundSafe: input.automaticRefundSafe, paymentReviewId: reviewRef.id }), (issueRefund ? { refundReason: "paid_contract_mismatch" } : {})));
        }
        if (!waiverSnap.exists && privacyPromotionMismatch === null) {
            const waiverPiiRetentionCutoffAt = paygWaiverPiiRetentionCutoffAt(freshIntent);
            tx.create(waiverRef, {
                schemaVersion: exports.PAYG_SCHEMA_VERSION,
                orderId: intentRef.id,
                attendee: freshIntent.attendee,
                acceptances: freshIntent.acceptances,
                retainedAcceptanceEvidence: retainedPaygAcceptanceEvidence(freshIntent),
                acceptanceEvidenceDigest: freshIntent.acceptanceEvidenceDigest,
                privacy: resolveStoredPaygPiiRetentionConfig(freshIntent.privacy),
                class: freshIntent.class,
                checkoutSessionId: session.id,
                paymentIntentId: paymentIntent.id,
                piiRetentionCutoffAt: waiverPiiRetentionCutoffAt,
                piiRedactionRetryAt: waiverPiiRetentionCutoffAt,
                recordedAt: serverTimestamp(),
            });
        }
        tx.set(intentRef, Object.assign(Object.assign({ status: targetStatus === "manual_review" ? "manual_review" : "fulfilled", capacityState: "released", unpaidHoldState: "released", checkoutSessionId: session.id, paymentIntentId: paymentIntent.id, orderId: intentRef.id, holdExpiresAt: firestore_1.FieldValue.delete(), paidContractMismatches: [...mismatches], paymentReviewId: reviewRef.id, fulfilledAt: serverTimestamp() }, existingPaygIntentPrivacySchedule(freshIntentSnap)), { piiDeleteAt: firestore_1.FieldValue.delete(), updatedAt: serverTimestamp() }), { merge: true });
        tx.set(reviewRef, {
            schemaVersion: exports.PAYG_SCHEMA_VERSION,
            status: targetStatus,
            intentId: intentRef.id,
            orderId: intentRef.id,
            checkoutSessionId: session.id,
            paymentIntentId: paymentIntent.id,
            mismatches: [...mismatches],
            refundRecommended: paymentIntent.amount_received > 0,
            automaticRefundSafe: input.automaticRefundSafe,
            providerAmountReceivedPence: paymentIntent.amount_received,
            providerCurrency: paymentIntent.currency,
            updatedAt: serverTimestamp(),
            createdAt: serverTimestamp(),
        }, { merge: true });
        return { issueRefund, paymentReviewRefundId: null };
    });
}
/**
 * Idempotently turns a paid PAYG Checkout Session into one order and one guest
 * booking. Exported so the shared Stripe event ledger can dispatch here first.
 */
async function fulfilPaygCheckoutSession(session, successEvidence = null) {
    var _a, _b;
    const intentId = paygIntentIdFromCheckoutSession(session);
    if (!intentId) {
        throw new Error(`Checkout Session ${session.id} is not a PAYG class purchase.`);
    }
    const intentRef = db().collection("paygIntents").doc(intentId);
    const intentSnap = await intentRef.get();
    if (!intentSnap.exists) {
        throw new Error(`PAYG intent ${intentId} was not found for ${session.id}.`);
    }
    const intent = intentSnap.data();
    const environment = assertPaygBillingEnvironment();
    if (intent.stripeMode !== environment.stripeMode) {
        throw new Error(`PAYG intent ${intentId} belongs to another Stripe environment.`);
    }
    const paymentIntentId = idOf(session.payment_intent);
    const existingOrder = await db().collection("paygOrders").doc(intentId).get();
    if (existingOrder.exists &&
        existingOrder.get("purchaseKind") === exports.PAYG_PURCHASE_KIND &&
        existingOrder.get("orderId") === intentId &&
        existingOrder.get("checkoutSessionId") === session.id &&
        typeof paymentIntentId === "string" &&
        existingOrder.get("paymentIntentId") === paymentIntentId &&
        session.livemode === environment.expectedLivemode &&
        session.mode === "payment") {
        // A webhook replay can arrive after the retention worker has removed the
        // intent's guest evidence. The exact immutable provider bindings and the
        // canonical order are sufficient to treat that replay as converged.
        return;
    }
    if (!paymentIntentId) {
        await persistPaygPaymentReviewOnly({
            intentRef,
            intent,
            session,
            paymentIntent: null,
            mismatches: ["missing_payment_intent"],
            automaticRefundSafe: false,
        });
        return;
    }
    const paymentReviewRef = db().collection(exports.PAYG_PAYMENT_REVIEW_COLLECTION).doc(paygPaymentReviewId(intentId, session.id, paymentIntentId));
    const existingPaymentReview = await paymentReviewRef.get();
    if (isExactPaygPaymentReviewOwner(existingPaymentReview, intentId, session.id, paymentIntentId)) {
        // A recovery path already made the fail-closed payment review the durable
        // owner. A delayed success event must not create a second owner or refund.
        return;
    }
    const [paymentIntent, lineItems] = await Promise.all([
        stripe().paymentIntents.retrieve(paymentIntentId),
        stripe().checkout.sessions.listLineItems(session.id, {
            limit: 10,
            expand: ["data.price.product"],
        }),
    ]);
    const chargeId = idOf(paymentIntent.latest_charge);
    const charge = chargeId ? await stripe().charges.retrieve(chargeId) : null;
    // Capture once after provider evidence is available. Firestore transactions
    // may retry, so every privacy check in this fulfillment attempt uses the same
    // processing instant rather than moving the retention boundary mid-retry.
    const piiPromotionProcessingAtMillis = Date.now();
    const hasIntentEvidence = hasCompletePaygIntentPiiEvidence(intent);
    const automaticRefundSafe = isPaygPaymentRefundSafe(paymentIntent, intentId, environment.expectedLivemode);
    const mismatches = collectPaygPaidContractMismatches({
        session,
        paymentIntent,
        intentId,
        expectedClassId: intent.class.classId,
        expectedEmail: ((_a = intent.contact) === null || _a === void 0 ? void 0 : _a.email) || "",
        expectedPriceId: intent.stripePriceId,
        expectedProductId: intent.stripeProductId,
        exactLineItem: exactPaygLineItem(lineItems, intent),
        expectedLivemode: environment.expectedLivemode,
    });
    const privacyPromotionMismatch = paygPiiPromotionMismatch({
        intent,
        paymentIntent,
        charge,
        successEvidence,
        checkoutSessionId: session.id,
        intentId,
        expectedLivemode: environment.expectedLivemode,
        processingNowMillis: piiPromotionProcessingAtMillis,
    });
    if (intent.checkoutSessionId && intent.checkoutSessionId !== session.id) {
        mismatches.push("intent_checkout_session_conflict");
    }
    if (!hasIntentEvidence)
        mismatches.push("intent_evidence_missing");
    if (privacyPromotionMismatch)
        mismatches.push(privacyPromotionMismatch);
    const uniqueMismatches = [...new Set(mismatches)];
    const routeToPaymentReview = async (reviewMismatches) => {
        const paymentReview = await persistPaygPaymentReviewOnly({
            intentRef,
            intent,
            session,
            paymentIntent,
            mismatches: [...new Set(reviewMismatches)],
            automaticRefundSafe,
        });
        if (paymentReview.issueRefund) {
            try {
                await issuePaygPaymentReviewRefund(paymentReview.reviewId);
            }
            catch (error) {
                console.error("PAYG payment-review refund queued for recovery", {
                    paymentReviewId: paymentReview.reviewId,
                    error,
                });
            }
        }
    };
    if (uniqueMismatches.length > 0) {
        if (!hasIntentEvidence || privacyPromotionMismatch !== null) {
            await routeToPaymentReview(uniqueMismatches);
            return;
        }
        let review;
        try {
            review = await persistPaygPaidContractMismatch({
                intentRef,
                intent,
                session,
                paymentIntent,
                charge,
                successEvidence,
                expectedLivemode: environment.expectedLivemode,
                processingNowMillis: piiPromotionProcessingAtMillis,
                mismatches: uniqueMismatches,
                automaticRefundSafe,
            });
        }
        catch (error) {
            if (!(error instanceof PaygPiiPromotionClosedError))
                throw error;
            await routeToPaymentReview([...uniqueMismatches, error.mismatch]);
            return;
        }
        console.error("CRITICAL_BILLING_PAYG_PAID_CONTRACT_MISMATCH", {
            intentId,
            checkoutSessionId: session.id,
            paymentIntentId: paymentIntent.id,
            mismatches: uniqueMismatches,
            automaticRefundSafe,
        });
        if (review.issueRefund) {
            try {
                await issuePaygRefund(intentId, "paid_contract_mismatch");
            }
            catch (error) {
                // The order and retry timestamp are durable before the provider call.
                console.error("PAYG paid-contract refund queued for recovery", {
                    orderId: intentId,
                    error,
                });
            }
        }
        if (review.paymentReviewRefundId) {
            try {
                await issuePaygPaymentReviewRefund(review.paymentReviewRefundId);
            }
            catch (error) {
                console.error("PAYG conflicting-payment refund queued for recovery", {
                    paymentReviewId: review.paymentReviewRefundId,
                    error,
                });
            }
        }
        return;
    }
    const orderRef = db().collection("paygOrders").doc(intentId);
    const bookingId = paygGuestBookingId(intentId);
    const bookingRef = db().collection("bookings").doc(bookingId);
    const waiverRef = db().collection("paygWaiverAcceptances").doc(intentId);
    const outboxRef = db().collection("paygEmailOutbox").doc(intentId);
    const duplicateLockRef = db().collection(exports.PAYG_DUPLICATE_LOCK_COLLECTION)
        .doc(intent.duplicateLockId);
    let outcome;
    try {
        outcome = await db().runTransaction(async (tx) => {
            var _a, _b, _c;
            const [freshIntentSnap, existingOrder, classSnap, bookingSnap, waiverSnap, outboxSnap, duplicateLockSnap, freshPaymentReview] = await Promise.all([
                tx.get(intentRef),
                tx.get(orderRef),
                tx.get(db().collection("classes").doc(intent.class.classId)),
                tx.get(bookingRef),
                tx.get(waiverRef),
                tx.get(outboxRef),
                tx.get(duplicateLockRef),
                tx.get(paymentReviewRef),
            ]);
            if (!freshIntentSnap.exists)
                throw new Error(`PAYG intent ${intentId} disappeared.`);
            const freshIntent = freshIntentSnap.data();
            const transactionPiiProcessingAtMillis = Math.max(piiPromotionProcessingAtMillis, Date.now());
            const freshPrivacyPromotionMismatch = paygPiiPromotionMismatch({
                intent: freshIntent,
                paymentIntent,
                charge,
                successEvidence,
                checkoutSessionId: session.id,
                intentId,
                expectedLivemode: environment.expectedLivemode,
                processingNowMillis: transactionPiiProcessingAtMillis,
            });
            if (existingOrder.exists) {
                const existing = existingOrder.data();
                const exactCanonicalOrder = existing.purchaseKind === exports.PAYG_PURCHASE_KIND &&
                    existing.orderId === intentId &&
                    existing.checkoutSessionId === session.id &&
                    existing.paymentIntentId === paymentIntent.id &&
                    existing.class.classId === freshIntent.class.classId;
                if (exactCanonicalOrder) {
                    // Exact canonical replay is converged. A missing outbox may be the
                    // result of privacy closure; never reconstruct its recipient/template.
                    return { status: existing.status, alreadyFulfilled: true };
                }
                if (isExactPaygPaymentReviewOwner(freshPaymentReview, intentId, session.id, paymentIntent.id)) {
                    return { status: "payment_review", alreadyFulfilled: true };
                }
                throw new Error(`PAYG order ${intentId} conflicts with a replayed payment.`);
            }
            if (isExactPaygPaymentReviewOwner(freshPaymentReview, intentId, session.id, paymentIntent.id)) {
                return { status: "payment_review", alreadyFulfilled: true };
            }
            if (freshPrivacyPromotionMismatch !== null) {
                throw new PaygPiiPromotionClosedError(freshPrivacyPromotionMismatch);
            }
            const classCancellationOperationId = classSnap.exists &&
                classSnap.get("bookingOpen") === false &&
                classSnap.get("bookingClosedReason") === "class_cancellation" &&
                typeof classSnap.get("cancellationOperationId") === "string" ?
                classSnap.get("cancellationOperationId") : null;
            const classUnavailable = !classSnap.exists ||
                classSnap.get("status") !== "scheduled" ||
                classSnap.get("bookingOpen") === false ||
                classSnap.get("paygEligible") === false;
            const duplicateLockInvalid = !duplicateLockSnap.exists ||
                duplicateLockSnap.get("intentId") !== intentId ||
                duplicateLockSnap.get("status") !== "held";
            const cannotUseHeldPlace = freshIntent.capacityState !== "held" ||
                classUnavailable || duplicateLockInvalid;
            if (cannotUseHeldPlace) {
                if ((freshIntent.capacityState === "held" ||
                    freshIntent.unpaidHoldState === "counted") && classSnap.exists) {
                    const bookedCount = Number((_a = classSnap.get("bookedCount")) !== null && _a !== void 0 ? _a : 0);
                    const unpaidHoldCount = Number((_b = classSnap.get("paygUnpaidHoldCount")) !== null && _b !== void 0 ? _b : 0);
                    tx.set(classSnap.ref, Object.assign(Object.assign(Object.assign({}, (freshIntent.capacityState === "held" ? {
                        bookedCount: firestore_1.FieldValue.increment(bookedCount > 0 ? -1 : 0),
                    } : {})), (freshIntent.unpaidHoldState === "counted" ? {
                        paygUnpaidHoldCount: firestore_1.FieldValue.increment(unpaidHoldCount > 0 ? -1 : 0),
                    } : {})), { updatedAt: serverTimestamp() }), { merge: true });
                }
                if (duplicateLockSnap.exists &&
                    duplicateLockSnap.get("intentId") === intentId) {
                    tx.delete(duplicateLockRef);
                }
                const order = buildPaygOrder(intentRef, freshIntent, session, paymentIntent, "refund_pending", "released", null);
                tx.create(orderRef, Object.assign(Object.assign(Object.assign({}, order), { refundReason: classCancellationOperationId ?
                        "class_cancellation" : "hold_released_before_payment" }), (classCancellationOperationId ? {
                    classCancellationOperationId,
                    classCancellationRequestedAt: serverTimestamp(),
                } : {})));
                if (!waiverSnap.exists) {
                    const waiverPiiRetentionCutoffAt = paygWaiverPiiRetentionCutoffAt(freshIntent);
                    tx.create(waiverRef, {
                        schemaVersion: exports.PAYG_SCHEMA_VERSION,
                        orderId: intentId,
                        attendee: freshIntent.attendee,
                        acceptances: freshIntent.acceptances,
                        retainedAcceptanceEvidence: retainedPaygAcceptanceEvidence(freshIntent),
                        acceptanceEvidenceDigest: freshIntent.acceptanceEvidenceDigest,
                        privacy: resolveStoredPaygPiiRetentionConfig(freshIntent.privacy),
                        class: freshIntent.class,
                        checkoutSessionId: session.id,
                        paymentIntentId: paymentIntent.id,
                        piiRetentionCutoffAt: waiverPiiRetentionCutoffAt,
                        piiRedactionRetryAt: waiverPiiRetentionCutoffAt,
                        recordedAt: serverTimestamp(),
                    });
                }
                tx.set(intentRef, Object.assign(Object.assign({ status: "fulfilled", capacityState: "released", unpaidHoldState: "released", checkoutSessionId: session.id, paymentIntentId: paymentIntent.id, orderId: intentId, holdExpiresAt: firestore_1.FieldValue.delete(), fulfilledAt: serverTimestamp() }, existingPaygIntentPrivacySchedule(freshIntentSnap)), { piiDeleteAt: firestore_1.FieldValue.delete(), updatedAt: serverTimestamp() }), { merge: true });
                return {
                    status: "refund_pending",
                    alreadyFulfilled: false,
                    refundReason: classCancellationOperationId ?
                        "class_cancellation" :
                        "hold_released_before_payment",
                };
            }
            if (bookingSnap.exists) {
                throw new Error(`PAYG guest booking ${bookingId} already exists without its order.`);
            }
            const order = buildPaygOrder(intentRef, freshIntent, session, paymentIntent, "confirmed", "held", bookingId);
            tx.create(orderRef, order);
            tx.create(bookingRef, {
                classId: freshIntent.class.classId,
                userId: paygGuestUserId(intentId),
                userName: freshIntent.attendee.fullName,
                status: "booked",
                bookingKind: "payg_guest",
                isGuestBooking: true,
                paygOrderId: intentId,
                retainedAcceptanceEvidence: retainedPaygAcceptanceEvidence(freshIntent),
                attendanceStatus: "none",
                attended: false,
                checkedInAt: null,
                checkedInBy: null,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
            if (freshIntent.unpaidHoldState === "counted") {
                const unpaidHoldCount = Number((_c = classSnap.get("paygUnpaidHoldCount")) !== null && _c !== void 0 ? _c : 0);
                tx.set(classSnap.ref, {
                    paygUnpaidHoldCount: firestore_1.FieldValue.increment(unpaidHoldCount > 0 ? -1 : 0),
                    updatedAt: serverTimestamp(),
                }, { merge: true });
            }
            tx.set(duplicateLockRef, {
                status: "booked",
                activeUntil: firestore_1.Timestamp.fromMillis(freshIntent.classEndMillis),
                updatedAt: serverTimestamp(),
            }, { merge: true });
            if (!waiverSnap.exists) {
                const waiverPiiRetentionCutoffAt = paygWaiverPiiRetentionCutoffAt(freshIntent);
                tx.create(waiverRef, {
                    schemaVersion: exports.PAYG_SCHEMA_VERSION,
                    orderId: intentId,
                    attendee: freshIntent.attendee,
                    acceptances: freshIntent.acceptances,
                    retainedAcceptanceEvidence: retainedPaygAcceptanceEvidence(freshIntent),
                    acceptanceEvidenceDigest: freshIntent.acceptanceEvidenceDigest,
                    privacy: resolveStoredPaygPiiRetentionConfig(freshIntent.privacy),
                    class: freshIntent.class,
                    checkoutSessionId: session.id,
                    paymentIntentId: paymentIntent.id,
                    piiRetentionCutoffAt: waiverPiiRetentionCutoffAt,
                    piiRedactionRetryAt: waiverPiiRetentionCutoffAt,
                    recordedAt: serverTimestamp(),
                });
            }
            if (!outboxSnap.exists) {
                const confirmationOutbox = confirmationOutboxFor(intentRef, freshIntent);
                tx.create(outboxRef, Object.assign(Object.assign({}, confirmationOutbox), { status: "pending", attemptCount: 0, nextAttemptAt: serverTimestamp(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
            }
            tx.set(intentRef, Object.assign(Object.assign({ status: "fulfilled", unpaidHoldState: "released", checkoutSessionId: session.id, paymentIntentId: paymentIntent.id, orderId: intentId, holdExpiresAt: firestore_1.FieldValue.delete(), fulfilledAt: serverTimestamp() }, existingPaygIntentPrivacySchedule(freshIntentSnap)), { piiDeleteAt: firestore_1.FieldValue.delete(), updatedAt: serverTimestamp() }), { merge: true });
            return { status: "confirmed", alreadyFulfilled: false };
        });
    }
    catch (error) {
        if (!(error instanceof PaygPiiPromotionClosedError))
            throw error;
        await routeToPaymentReview([...uniqueMismatches, error.mismatch]);
        return;
    }
    if (outcome.status === "refund_pending") {
        await issuePaygRefund(intentId, (_b = outcome.refundReason) !== null && _b !== void 0 ? _b : "hold_released_before_payment");
    }
}
async function retrieveAndFulfilPaygCheckout(sessionId) {
    const session = await stripe().checkout.sessions.retrieve(sessionId);
    assertStripeObjectMode("Checkout Session", session.id, session.livemode);
    await fulfilPaygCheckoutSession(session);
}
function requireCheckoutSessionId(value) {
    const id = typeof value === "string" ? value.trim() : "";
    if (id.length < 12 || id.length > 255 || !/^cs_[A-Za-z0-9_]+$/.test(id)) {
        throw paygError("invalid-argument", "sessionId is invalid.");
    }
    return id;
}
function publicOrderState(status) {
    if (status === "attended")
        return "confirmed";
    if (status === "manual_review")
        return "disputed";
    return status;
}
function publicPaygPaymentReviewState(status, refundStatus) {
    if (status === "refunded" || refundStatus === "succeeded")
        return "refunded";
    if (status === "refund_pending" || refundStatus === "pending") {
        return "refund_pending";
    }
    return "disputed";
}
function publicPaygAttendeeName(value, piiRedactedAt) {
    if (piiRedactedAt !== undefined && piiRedactedAt !== null) {
        return "PAYG guest";
    }
    if (!value || typeof value !== "object")
        return "PAYG guest";
    const name = value.fullName;
    return typeof name === "string" && name.length >= 2 && name.length <= 160 ?
        name : "PAYG guest";
}
function isPaygOrderPiiClosed(input) {
    const cutoff = timestampMillis(input.piiRetentionCutoffAt);
    return input.piiRedactedAt !== undefined && input.piiRedactedAt !== null ||
        cutoff === null || cutoff <= input.nowMillis;
}
function buildPaygCancellationPreviewPayload(input) {
    const expectedCutoff = input.classStartMillis -
        exports.PAYG_CANCELLATION_CUTOFF_HOURS * 60 * 60 * 1000;
    if (!/^payg_[a-f0-9]{64}$/.test(input.orderId) ||
        !Number.isSafeInteger(input.classStartMillis) ||
        !Number.isSafeInteger(input.cancellationCutoffAtMillis) ||
        input.cancellationCutoffAtMillis !== expectedCutoff ||
        !Number.isSafeInteger(input.nowMillis)) {
        throw new Error("PAYG cancellation preview evidence is invalid.");
    }
    const decision = resolvePaygCancellationDecision(input.classStartMillis, input.nowMillis);
    return Object.freeze({
        ok: true,
        currentOrderState: publicOrderState(input.status),
        class: input.class,
        cancellationCutoffAt: new Date(input.cancellationCutoffAtMillis).toISOString(),
        refundEligibleNow: input.status === "confirmed" && decision.refundEligible,
    });
}
function buildGetPaygCancellationPreview() {
    return (0, https_1.onCall)({
        region: REGION,
        secrets: exports.PAYG_CANCELLATION_PREVIEW_SECRETS,
        enforceAppCheck: !isFirebaseFunctionsEmulatorProcess(),
        consumeAppCheckToken: !isFirebaseFunctionsEmulatorProcess(),
    }, async (request) => {
        var _a;
        assertPaygCheckoutAppCheck(request);
        assertPaygFirebaseProject();
        assertCancellationTokenSecretConfigured();
        const token = requireBoundedString((_a = request.data) === null || _a === void 0 ? void 0 : _a.token, "token", 40, 2048);
        const payload = verifyPaygCancellationTokenWithKeyring(token, cancellationVerificationKeyring());
        const order = await db().collection("paygOrders").doc(payload.orderId).get();
        if (!order.exists || order.get("purchaseKind") !== exports.PAYG_PURCHASE_KIND ||
            order.get("orderId") !== payload.orderId) {
            throw paygError("not-found", "This PAYG order was not found.");
        }
        const value = order.data();
        const cutoff = timestampMillis(order.get("cancellationCutoffAt"));
        if (cutoff === null) {
            throw paygError("failed-precondition", "This PAYG booking needs support review before cancellation.");
        }
        try {
            return buildPaygCancellationPreviewPayload({
                orderId: value.orderId,
                status: value.status,
                class: value.class,
                classStartMillis: value.classStartMillis,
                cancellationCutoffAtMillis: cutoff,
                nowMillis: Date.now(),
            });
        }
        catch (_b) {
            throw paygError("failed-precondition", "This PAYG booking needs support review before cancellation.");
        }
    });
}
function publicOrderProjection(order, signingKey, nowMillis = Date.now()) {
    const privacyClosed = isPaygOrderPiiClosed({
        piiRedactedAt: order.piiRedactedAt,
        piiRetentionCutoffAt: order.piiRetentionCutoffAt,
        nowMillis,
    });
    const decision = resolvePaygCancellationDecision(order.classStartMillis, nowMillis);
    const tokenExpiresAt = Math.floor((order.classEndMillis + 24 * 60 * 60 * 1000) / 1000);
    const token = signPaygCancellationToken({
        v: 1,
        orderId: order.orderId,
        exp: tokenExpiresAt,
    }, signingKey.secret, signingKey.kid);
    const state = publicOrderState(order.status);
    return {
        ok: true,
        state,
        order: {
            reference: order.orderId,
            attendeeName: publicPaygAttendeeName(order.attendee, privacyClosed ? true : null),
            amountPence: order.amountPence,
            currency: order.currency,
            class: order.class,
            cancellationCutoffAt: new Date(decision.cutoffAtMillis).toISOString(),
        },
        cancellation: {
            token,
            refundEligible: order.status === "confirmed" && decision.refundEligible,
            refundDeadline: new Date(decision.cutoffAtMillis).toISOString(),
        },
    };
}
function buildGetPaygCheckoutStatus() {
    return (0, https_1.onCall)({
        region: REGION,
        secrets: exports.PAYG_STATUS_SECRETS,
        enforceAppCheck: !isFirebaseFunctionsEmulatorProcess(),
    }, async (request) => {
        var _a;
        assertPaygFirebaseProject();
        const sessionId = requireCheckoutSessionId((_a = request.data) === null || _a === void 0 ? void 0 : _a.sessionId);
        const orders = await db().collection("paygOrders")
            .where("checkoutSessionId", "==", sessionId)
            .limit(2)
            .get();
        if (orders.size > 1) {
            console.error("CRITICAL_BILLING_PAYG_DUPLICATE_CHECKOUT_SESSION", {
                checkoutSessionIdHash: sha256(sessionId),
                orderIds: orders.docs.map((doc) => doc.id),
            });
            throw paygError("failed-precondition", "This PAYG purchase needs support review before it can be shown.");
        }
        if (orders.size === 1) {
            const order = orders.docs[0].data();
            let signingKey;
            try {
                signingKey = cancellationSigningKey();
            }
            catch (_b) {
                throw paygError("failed-precondition", "PAYG cancellation links are not configured.");
            }
            return publicOrderProjection(order, signingKey);
        }
        const reviews = await db().collection(exports.PAYG_PAYMENT_REVIEW_COLLECTION)
            .where("checkoutSessionId", "==", sessionId)
            .limit(2)
            .get();
        if (reviews.size > 1) {
            console.error("CRITICAL_BILLING_PAYG_DUPLICATE_REVIEW_SESSION", {
                checkoutSessionIdHash: sha256(sessionId),
                paymentReviewIds: reviews.docs.map((doc) => doc.id),
            });
            throw paygError("failed-precondition", "This PAYG purchase needs support review before it can be shown.");
        }
        if (reviews.size === 1) {
            const review = reviews.docs[0];
            return {
                ok: true,
                state: publicPaygPaymentReviewState(review.get("status"), review.get("refundStatus")),
                review: {
                    reference: review.id,
                    supportRequired: review.get("status") === "manual_review" ||
                        review.get("status") === "disputed",
                },
            };
        }
        const intents = await db().collection("paygIntents")
            .where("checkoutSessionId", "==", sessionId)
            .limit(2)
            .get();
        if (intents.size > 1) {
            console.error("CRITICAL_BILLING_PAYG_DUPLICATE_INTENT_SESSION", {
                checkoutSessionIdHash: sha256(sessionId),
                intentIds: intents.docs.map((doc) => doc.id),
            });
            throw paygError("failed-precondition", "This PAYG purchase needs support review before it can be shown.");
        }
        if (intents.empty) {
            throw paygError("not-found", "No PAYG checkout was found for that session.");
        }
        return { ok: true, state: "processing" };
    });
}
async function preparePaygCancellation(orderRef, nowMillis) {
    return db().runTransaction(async (tx) => {
        var _a;
        const orderSnap = await tx.get(orderRef);
        if (!orderSnap.exists) {
            throw paygError("not-found", "This PAYG order was not found.");
        }
        const order = orderSnap.data();
        const bookingRef = order.bookingId ?
            db().collection("bookings").doc(order.bookingId) : null;
        const classRef = db().collection("classes").doc(order.class.classId);
        const outboxRef = db().collection("paygEmailOutbox").doc(orderRef.id);
        const lockRef = paygDuplicateLockRef(order.duplicateLockId);
        const [bookingSnap, classSnap, outboxSnap, lockSnap] = await Promise.all([
            bookingRef ? tx.get(bookingRef) : Promise.resolve(null),
            tx.get(classRef),
            tx.get(outboxRef),
            lockRef ? tx.get(lockRef) : Promise.resolve(null),
        ]);
        const terminal = order.status === "cancelled" ||
            order.status === "refunded" || order.status === "no_show" ||
            order.status === "disputed" || order.status === "manual_review" ||
            order.status === "attended";
        if (terminal) {
            if (order.status !== "attended") {
                tombstonePaygConfirmation(tx, outboxSnap, `order_${order.status}`);
                releasePaygDuplicateLock(tx, lockSnap, orderRef.id);
                tx.set(orderRef, {
                    confirmationEmailStatus: "not_required",
                    updatedAt: serverTimestamp(),
                }, { merge: true });
            }
            return {
                outcome: "already_cancelled",
                refundEligible: order.status === "refunded",
                capacityReleased: order.capacityState === "released",
                issueRefund: false,
            };
        }
        if (order.status === "refund_pending") {
            const pending = resolvePaygCancellationRefundPendingDisposition(orderSnap.get("refundReason"));
            tombstonePaygConfirmation(tx, outboxSnap, "order_refund_pending");
            releasePaygDuplicateLock(tx, lockSnap, orderRef.id);
            tx.set(orderRef, {
                confirmationEmailStatus: "not_required",
                updatedAt: serverTimestamp(),
            }, { merge: true });
            return {
                outcome: "refund_pending",
                refundEligible: pending.refundEligible,
                capacityReleased: order.capacityState === "released",
                issueRefund: pending.issueRefund,
            };
        }
        if (order.status !== "confirmed") {
            throw paygError("failed-precondition", "This PAYG order cannot be cancelled automatically.");
        }
        const decision = resolvePaygCancellationDecision(order.classStartMillis, nowMillis);
        if (decision.kind === "no_show") {
            const attendanceRecorded = (bookingSnap === null || bookingSnap === void 0 ? void 0 : bookingSnap.get("attended")) === true ||
                (bookingSnap === null || bookingSnap === void 0 ? void 0 : bookingSnap.get("attendanceStatus")) === "checked_in" ||
                timestampMillis(bookingSnap === null || bookingSnap === void 0 ? void 0 : bookingSnap.get("checkedInAt")) !== null;
            const disposition = resolvePaygPostStartCancellationDisposition(attendanceRecorded);
            if (disposition === "attended") {
                releasePaygDuplicateLock(tx, lockSnap, orderRef.id);
                tx.set(orderRef, {
                    status: "attended",
                    capacityState: "consumed",
                    noShowReviewAt: firestore_1.FieldValue.delete(),
                    attendanceResolvedAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                }, { merge: true });
                if (bookingRef && (bookingSnap === null || bookingSnap === void 0 ? void 0 : bookingSnap.exists)) {
                    tx.set(bookingRef, {
                        paygAttendanceOutcome: "attended",
                        updatedAt: serverTimestamp(),
                    }, { merge: true });
                }
                return {
                    outcome: "already_cancelled",
                    refundEligible: false,
                    capacityReleased: false,
                    issueRefund: false,
                };
            }
            // A guest may submit this request after arriving but before staff record
            // check-in. Keep the canonical order/booking open for attendance until
            // the scheduled post-class review instead of irreversibly declaring a
            // no-show at class start. The cancellation remains non-refundable.
            tombstonePaygConfirmation(tx, outboxSnap, "guest_cancellation_post_start");
            tx.set(orderRef, {
                confirmationEmailStatus: "not_required",
                postStartCancellationReviewPending: true,
                cancellation: {
                    requestedAt: serverTimestamp(),
                    policyOutcome: "post_start_non_refundable_attendance_pending",
                    refundEligible: false,
                },
                updatedAt: serverTimestamp(),
            }, { merge: true });
            return {
                outcome: "cancelled_non_refundable",
                refundEligible: false,
                capacityReleased: false,
                issueRefund: false,
            };
        }
        const shouldRelease = order.capacityState === "held";
        if (shouldRelease && classSnap.exists) {
            const bookedCount = Number((_a = classSnap.get("bookedCount")) !== null && _a !== void 0 ? _a : 0);
            tx.set(classRef, {
                bookedCount: firestore_1.FieldValue.increment(bookedCount > 0 ? -1 : 0),
                updatedAt: serverTimestamp(),
            }, { merge: true });
        }
        if (bookingRef && (bookingSnap === null || bookingSnap === void 0 ? void 0 : bookingSnap.exists) && bookingSnap.get("status") === "booked") {
            tx.set(bookingRef, {
                status: "cancelled",
                cancelledAt: serverTimestamp(),
                cancelledReason: decision.refundEligible ?
                    "payg_guest_refundable" : "payg_guest_late",
                updatedAt: serverTimestamp(),
            }, { merge: true });
        }
        tombstonePaygConfirmation(tx, outboxSnap, decision.refundEligible ? "guest_cancellation_refund" : "guest_cancellation_late");
        releasePaygDuplicateLock(tx, lockSnap, orderRef.id);
        tx.set(orderRef, Object.assign(Object.assign({ status: decision.refundEligible ? "refund_pending" : "cancelled", capacityState: "released", confirmationEmailStatus: "not_required", noShowReviewAt: firestore_1.FieldValue.delete() }, (decision.refundEligible ? {
            refundRecoveryAt: firestore_1.Timestamp.fromMillis(nowMillis),
            refundReason: "guest_cancellation",
        } : {})), { cancellation: {
                requestedAt: serverTimestamp(),
                policyOutcome: decision.refundEligible ?
                    "at_least_24_hours_refundable" : "under_24_hours_non_refundable",
                refundEligible: decision.refundEligible,
                cutoffAt: firestore_1.Timestamp.fromMillis(decision.cutoffAtMillis),
            }, updatedAt: serverTimestamp() }), { merge: true });
        return {
            outcome: decision.refundEligible ?
                "refund_pending" : "cancelled_non_refundable",
            refundEligible: decision.refundEligible,
            capacityReleased: shouldRelease,
            issueRefund: decision.refundEligible,
        };
    });
}
function buildRequestPaygCancellation() {
    return (0, https_1.onCall)({
        region: REGION,
        secrets: exports.PAYG_CANCELLATION_SECRETS,
        enforceAppCheck: !isFirebaseFunctionsEmulatorProcess(),
        consumeAppCheckToken: !isFirebaseFunctionsEmulatorProcess(),
        timeoutSeconds: 120,
    }, async (request) => {
        var _a, _b;
        assertPaygCheckoutAppCheck(request);
        if (((_a = request.data) === null || _a === void 0 ? void 0 : _a.confirm) !== true) {
            throw paygError("failed-precondition", "Confirm the PAYG cancellation before submitting it.");
        }
        assertPaygDataPlaneEnvironment();
        const token = requireBoundedString((_b = request.data) === null || _b === void 0 ? void 0 : _b.token, "token", 40, 2048);
        const payload = verifyPaygCancellationTokenWithKeyring(token, cancellationVerificationKeyring());
        const orderRef = db().collection("paygOrders").doc(payload.orderId);
        const prepared = await preparePaygCancellation(orderRef, Date.now());
        if (prepared.issueRefund) {
            try {
                await issuePaygRefund(payload.orderId, "guest_cancellation");
            }
            catch (error) {
                // Capacity and the legal cancellation receipt are already durable.
                // The scheduled worker replays the provider idempotency key.
                console.error("PAYG refund queued for recovery", {
                    orderId: payload.orderId,
                    error,
                });
            }
        }
        return {
            ok: true,
            outcome: prepared.outcome,
            refundEligible: prepared.refundEligible,
            capacityReleased: prepared.capacityReleased,
        };
    });
}
async function markPaygPaymentPending(session) {
    var _a;
    if (!isPaygMetadata(session.metadata))
        return;
    const intentId = String((_a = session.metadata) === null || _a === void 0 ? void 0 : _a.paygIntentId);
    const intentRef = db().collection("paygIntents").doc(intentId);
    await db().runTransaction(async (tx) => {
        const snap = await tx.get(intentRef);
        if (!snap.exists)
            throw new Error(`PAYG intent ${intentId} was not found.`);
        const intent = snap.data();
        assertSessionBinding(session, intentId, intent);
        if (intent.status === "fulfilled" || intent.capacityState === "released")
            return;
        const nextCheckMillis = Math.min(intent.classStartMillis, Date.now() + 5 * 60 * 1000);
        tx.set(intentRef, {
            status: "payment_pending",
            checkoutSessionId: session.id,
            holdExpiresAt: firestore_1.Timestamp.fromMillis(nextCheckMillis),
            updatedAt: serverTimestamp(),
        }, { merge: true });
    });
}
async function releasePaygSession(session, reason) {
    var _a;
    if (!isPaygMetadata(session.metadata))
        return;
    const intentId = String((_a = session.metadata) === null || _a === void 0 ? void 0 : _a.paygIntentId);
    const intentRef = db().collection("paygIntents").doc(intentId);
    const snap = await intentRef.get();
    if (!snap.exists)
        throw new Error(`PAYG intent ${intentId} was not found.`);
    assertSessionBinding(session, intentId, snap.data());
    await releasePaygHold(intentRef, reason, session.id);
}
async function paygPaymentOwnerForPaymentIntent(paymentIntent) {
    var _a;
    let orders = await db().collection("paygOrders")
        .where("paymentIntentId", "==", paymentIntent.id)
        .limit(2)
        .get();
    if (orders.size > 1) {
        console.error("CRITICAL_BILLING_PAYG_DUPLICATE_PAYMENT_INTENT", {
            paymentIntentId: paymentIntent.id,
            orderIds: orders.docs.map((doc) => doc.id),
        });
        throw new Error(`PaymentIntent ${paymentIntent.id} belongs to multiple PAYG orders.`);
    }
    if (orders.size === 1)
        return { kind: "order", doc: orders.docs[0] };
    let reviews = await db().collection(exports.PAYG_PAYMENT_REVIEW_COLLECTION)
        .where("paymentIntentId", "==", paymentIntent.id)
        .limit(2)
        .get();
    if (reviews.size > 1) {
        throw new Error(`PaymentIntent ${paymentIntent.id} belongs to multiple PAYG payment reviews.`);
    }
    if (reviews.size === 1)
        return { kind: "review", doc: reviews.docs[0] };
    if (orders.empty && reviews.empty) {
        const intentId = (_a = paymentIntent.metadata) === null || _a === void 0 ? void 0 : _a.paygIntentId;
        if (typeof intentId === "string" && /^payg_[a-f0-9]{64}$/.test(intentId)) {
            const intent = await db().collection("paygIntents").doc(intentId).get();
            const sessionId = intent.exists ? intent.get("checkoutSessionId") : null;
            if (typeof sessionId === "string" && sessionId) {
                await retrieveAndFulfilPaygCheckout(sessionId);
                [orders, reviews] = await Promise.all([
                    db().collection("paygOrders")
                        .where("paymentIntentId", "==", paymentIntent.id)
                        .limit(2)
                        .get(),
                    db().collection(exports.PAYG_PAYMENT_REVIEW_COLLECTION)
                        .where("paymentIntentId", "==", paymentIntent.id)
                        .limit(2)
                        .get(),
                ]);
                if (orders.size > 1 || reviews.size > 1 ||
                    (orders.size === 1 && reviews.size === 1 &&
                        reviews.docs[0].get("orderId") !== orders.docs[0].id)) {
                    throw new Error(`PaymentIntent ${paymentIntent.id} has conflicting PAYG owners.`);
                }
                if (orders.size === 1)
                    return { kind: "order", doc: orders.docs[0] };
                if (reviews.size === 1)
                    return { kind: "review", doc: reviews.docs[0] };
            }
        }
    }
    throw new Error(`PAYG owner for PaymentIntent ${paymentIntent.id} was not found.`);
}
async function releasePaidOrderCapacity(tx, orderRef, order, bookingSnap, classSnap, outboxSnap, duplicateLockSnap, update) {
    var _a, _b;
    const classCancellationOperationId = order
        .classCancellationOperationId;
    const classCancellationRefundedAmount = (_a = update.refundedAmountPence) !== null && _a !== void 0 ? _a : order
        .refundedAmountPence;
    const classCancellationRefundReconciled = typeof classCancellationOperationId === "string" &&
        /^class_cancel_[a-f0-9]{64}$/.test(classCancellationOperationId) &&
        update.refundStatus === "succeeded" &&
        classCancellationRefundedAmount === exports.PAYG_AMOUNT_PENCE;
    if (order.capacityState === "held" && classSnap.exists) {
        const bookedCount = Number((_b = classSnap.get("bookedCount")) !== null && _b !== void 0 ? _b : 0);
        tx.set(classSnap.ref, {
            bookedCount: firestore_1.FieldValue.increment(bookedCount > 0 ? -1 : 0),
            updatedAt: serverTimestamp(),
        }, { merge: true });
    }
    if (order.bookingId && (bookingSnap === null || bookingSnap === void 0 ? void 0 : bookingSnap.exists) && bookingSnap.get("status") === "booked") {
        tx.set(bookingSnap.ref, {
            status: "cancelled",
            cancelledAt: serverTimestamp(),
            cancelledReason: String(update.cancelledReason || "payg_provider_reversal"),
            updatedAt: serverTimestamp(),
        }, { merge: true });
    }
    releasePaygDuplicateLock(tx, duplicateLockSnap, orderRef.id);
    tombstonePaygConfirmation(tx, outboxSnap, String(update.cancelledReason || "payg_provider_reversal"));
    tx.set(orderRef, Object.assign(Object.assign(Object.assign(Object.assign({ capacityState: "released", confirmationEmailStatus: "not_required", noShowReviewAt: firestore_1.FieldValue.delete() }, update), (classCancellationRefundReconciled ? {
        classCancellationRefundStatus: "reconciled",
        classCancellationRefundReconciledAt: serverTimestamp(),
    } : {})), paygRefundClaimCleanup()), { updatedAt: serverTimestamp() }), { merge: true });
}
async function applyPaygPaymentReviewChargeRefund(reviewDoc, charge, paymentIntent) {
    await db().runTransaction(async (tx) => {
        const review = await tx.get(reviewDoc.ref);
        if (!review.exists) {
            throw new Error(`PAYG payment review ${reviewDoc.id} disappeared.`);
        }
        const expectedAmount = Number(review.get("refundExpectedAmountPence"));
        const exact = review.get("automaticRefundSafe") === true &&
            review.get("paymentIntentId") === paymentIntent.id &&
            idOf(charge.payment_intent) === paymentIntent.id &&
            Number.isSafeInteger(expectedAmount) && expectedAmount > 0 &&
            charge.amount === expectedAmount &&
            charge.currency === review.get("providerCurrency");
        const fullyRefunded = exact && charge.amount_refunded >= charge.amount;
        const currentStatus = review.get("status");
        if (hasPaygSucceededRefundEvidence(currentStatus, review.get("refundStatus"))) {
            tx.set(review.ref, Object.assign(Object.assign({ refundRecoveryAt: firestore_1.FieldValue.delete() }, paygRefundClaimCleanup()), { updatedAt: serverTimestamp() }), { merge: true });
            return;
        }
        const precedence = currentStatus === "manual_review" ||
            currentStatus === "disputed";
        tx.set(review.ref, Object.assign(Object.assign({ status: precedence ? currentStatus : fullyRefunded ?
                "refunded" : "manual_review", chargeId: charge.id, refundStatus: fullyRefunded ? "succeeded" :
                exact ? "partial_refund_manual_review" : "provider_contract_mismatch", refundedAmountPence: charge.amount_refunded, refundRecoveryAt: firestore_1.FieldValue.delete(), refundedAt: fullyRefunded ? serverTimestamp() : firestore_1.FieldValue.delete() }, paygRefundClaimCleanup()), { updatedAt: serverTimestamp() }), { merge: true });
        if (!fullyRefunded) {
            console.error("CRITICAL_BILLING_PAYG_REVIEW_CHARGE_REFUND", {
                paymentReviewId: review.id,
                chargeId: charge.id,
                exact,
                amountRefunded: charge.amount_refunded,
            });
        }
    });
}
function canonicalPaygRefundIdFromCharge(charge, paymentIntentId) {
    var _a;
    const refunds = (_a = charge.refunds) === null || _a === void 0 ? void 0 : _a.data;
    if (!Array.isArray(refunds))
        return null;
    const exact = refunds.filter((refund) => /^re_[A-Za-z0-9_]{4,252}$/.test(refund.id) &&
        refund.status === "succeeded" &&
        refund.amount === exports.PAYG_AMOUNT_PENCE &&
        refund.currency === exports.PAYG_CURRENCY &&
        idOf(refund.payment_intent) === paymentIntentId &&
        idOf(refund.charge) === charge.id);
    return exact.length === 1 ? exact[0].id : null;
}
async function applyPaygChargeRefund(charge, paymentIntent) {
    const owner = await paygPaymentOwnerForPaymentIntent(paymentIntent);
    if (owner.kind === "review") {
        await applyPaygPaymentReviewChargeRefund(owner.doc, charge, paymentIntent);
        return;
    }
    const orderDoc = owner.doc;
    const orderRef = orderDoc.ref;
    await db().runTransaction(async (tx) => {
        const freshOrder = await tx.get(orderRef);
        if (!freshOrder.exists)
            throw new Error(`PAYG order ${orderRef.id} disappeared.`);
        const order = freshOrder.data();
        const bookingRef = order.bookingId ?
            db().collection("bookings").doc(order.bookingId) : null;
        const outboxRef = db().collection("paygEmailOutbox").doc(orderRef.id);
        const refundOutboxRef = db().collection("paygEmailOutbox")
            .doc(paygRefundOutboxId(orderRef.id));
        const lockRef = paygDuplicateLockRef(order.duplicateLockId);
        const reviewRef = paygPaymentReviewRef(freshOrder.get("paymentReviewId"));
        const [bookingSnap, classSnap, outboxSnap, refundOutboxSnap, lockSnap, reviewSnap,] = await Promise.all([
            bookingRef ? tx.get(bookingRef) : Promise.resolve(null),
            tx.get(db().collection("classes").doc(order.class.classId)),
            tx.get(outboxRef),
            tx.get(refundOutboxRef),
            lockRef ? tx.get(lockRef) : Promise.resolve(null),
            reviewRef ? tx.get(reviewRef) : Promise.resolve(null),
        ]);
        const storedExpectedAmount = Number(freshOrder.get("refundExpectedAmountPence"));
        const expectedAmount = Number.isSafeInteger(storedExpectedAmount) &&
            storedExpectedAmount > 0 ? storedExpectedAmount : order.amountPence;
        const fullyRefunded = charge.amount_refunded >= charge.amount &&
            charge.amount === expectedAmount && charge.currency === order.currency &&
            idOf(charge.payment_intent) === order.paymentIntentId;
        const canonicalRefundId = canonicalPaygRefundIdFromCharge(charge, paymentIntent.id);
        const storedRefundId = freshOrder.get("refundId");
        const hasStoredRefundId = storedRefundId !== undefined &&
            storedRefundId !== null && storedRefundId !== "";
        const canonicalRefundConflictId = canonicalRefundId !== null &&
            hasStoredRefundId && storedRefundId !== canonicalRefundId ?
            canonicalRefundId : null;
        const exactLifecycleEmailBinding = fullyRefunded &&
            canonicalRefundConflictId === null &&
            isPaygOrdinaryLifecycleEmailOrder(freshOrder.data()) &&
            charge.amount_refunded === exports.PAYG_AMOUNT_PENCE &&
            charge.amount === exports.PAYG_AMOUNT_PENCE &&
            charge.currency === exports.PAYG_CURRENCY &&
            order.amountPence === exports.PAYG_AMOUNT_PENCE &&
            order.currency === exports.PAYG_CURRENCY &&
            order.paymentIntentId === paymentIntent.id &&
            order.chargeId === charge.id &&
            !freshOrder.get("conflictingRefundId");
        const linkedReview = (reviewSnap === null || reviewSnap === void 0 ? void 0 : reviewSnap.exists) &&
            reviewSnap.get("orderId") === orderRef.id &&
            reviewSnap.get("paymentIntentId") === paymentIntent.id;
        const orderRefundSucceeded = hasPaygSucceededRefundEvidence(order.status, freshOrder.get("refundStatus"));
        const linkedReviewRefundSucceeded = linkedReview &&
            hasPaygSucceededRefundEvidence(reviewSnap.get("status"), reviewSnap.get("refundStatus"));
        if (orderRefundSucceeded) {
            tx.set(orderRef, Object.assign(Object.assign(Object.assign(Object.assign({}, (canonicalRefundConflictId ? {
                status: order.status === "disputed" ? "disputed" : "manual_review",
                refundStatus: "conflicting_refund_id",
                conflictingRefundId: canonicalRefundConflictId,
                refundEmailStatus: "manual_review",
                refundEmailError: "refund_id_conflict",
            } : exactLifecycleEmailBinding ? Object.assign({ chargeId: charge.id, refundedAmountPence: exports.PAYG_AMOUNT_PENCE, refundStatus: "succeeded" }, (canonicalRefundId ? { refundId: canonicalRefundId } : {})) : {})), { refundRecoveryAt: firestore_1.FieldValue.delete() }), paygRefundClaimCleanup()), { updatedAt: serverTimestamp() }), { merge: true });
            if (linkedReview && !linkedReviewRefundSucceeded) {
                tx.set(reviewSnap.ref, Object.assign(Object.assign(Object.assign(Object.assign({ status: canonicalRefundConflictId ? "manual_review" : "refunded", refundStatus: canonicalRefundConflictId ?
                        "conflicting_refund_id" : "succeeded" }, (canonicalRefundConflictId ? {
                    conflictingRefundId: canonicalRefundConflictId,
                } : {})), { refundRecoveryAt: firestore_1.FieldValue.delete() }), paygRefundClaimCleanup()), { updatedAt: serverTimestamp() }), { merge: true });
            }
            if (exactLifecycleEmailBinding && canonicalRefundId) {
                enqueuePaygLifecycleEmail(tx, freshOrder, refundOutboxSnap, {
                    kind: "refund",
                    paymentIntentId: paymentIntent.id,
                    chargeId: charge.id,
                    refundId: canonicalRefundId,
                });
            }
            else if (exactLifecycleEmailBinding && !refundOutboxSnap.exists) {
                tx.set(orderRef, {
                    refundEmailStatus: "not_required",
                    refundEmailClosureReason: "canonical_refund_reference_pending",
                    updatedAt: serverTimestamp(),
                }, { merge: true });
            }
            if (canonicalRefundConflictId) {
                console.error("CRITICAL_BILLING_PAYG_REFUND_ID_CONFLICT", {
                    orderId: orderRef.id,
                    storedRefundId,
                    incomingRefundId: canonicalRefundConflictId,
                });
            }
            return;
        }
        if (linkedReview && !linkedReviewRefundSucceeded) {
            tx.set(reviewSnap.ref, Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ status: resolvePaygLinkedReviewRefundStatus(reviewSnap.get("status"), fullyRefunded ? "succeeded" : null, fullyRefunded), chargeId: charge.id }, (canonicalRefundId && !canonicalRefundConflictId ?
                { refundId: canonicalRefundId } : {})), { refundStatus: canonicalRefundConflictId ?
                    "conflicting_refund_id" : fullyRefunded ?
                    "succeeded" : "partial_refund_manual_review" }), (canonicalRefundConflictId ? {
                conflictingRefundId: canonicalRefundConflictId,
            } : {})), { refundedAmountPence: charge.amount_refunded, refundedAt: fullyRefunded ? serverTimestamp() : firestore_1.FieldValue.delete(), refundRecoveryAt: firestore_1.FieldValue.delete() }), paygRefundClaimCleanup()), { updatedAt: serverTimestamp() }), { merge: true });
        }
        if (!fullyRefunded) {
            const preserved = order.status === "refunded" ||
                order.status === "disputed" || order.status === "manual_review" ?
                order.status : "manual_review";
            await releasePaidOrderCapacity(tx, orderRef, order, bookingSnap, classSnap, outboxSnap, lockSnap, {
                status: preserved,
                cancelledReason: "partial_refund_manual_review",
                refundStatus: "partial_refund_manual_review",
                refundedAmountPence: charge.amount_refunded,
            });
            console.error("CRITICAL_BILLING_PAYG_PARTIAL_REFUND", {
                orderId: orderRef.id,
                chargeId: charge.id,
                amountRefunded: charge.amount_refunded,
            });
            return;
        }
        await releasePaidOrderCapacity(tx, orderRef, order, bookingSnap, classSnap, outboxSnap, lockSnap, Object.assign(Object.assign(Object.assign({ status: canonicalRefundConflictId ?
                order.status === "disputed" ? "disputed" : "manual_review" :
                order.status === "refunded" || order.status === "disputed" ||
                    order.status === "manual_review" ? order.status : "refunded", cancelledReason: canonicalRefundConflictId ?
                "refund_id_conflict_manual_review" : "payg_refunded", chargeId: charge.id }, (canonicalRefundId && !canonicalRefundConflictId ?
            { refundId: canonicalRefundId } : {})), (canonicalRefundConflictId ? {
            conflictingRefundId: canonicalRefundConflictId,
        } : {})), { refundedAmountPence: charge.amount_refunded, refundStatus: canonicalRefundConflictId ?
                "conflicting_refund_id" : "succeeded", refundRecoveryAt: firestore_1.FieldValue.delete(), refundedAt: serverTimestamp() }));
        if (exactLifecycleEmailBinding && canonicalRefundId) {
            enqueuePaygLifecycleEmail(tx, freshOrder, refundOutboxSnap, {
                kind: "refund",
                paymentIntentId: paymentIntent.id,
                chargeId: charge.id,
                refundId: canonicalRefundId,
            });
        }
        else if (exactLifecycleEmailBinding && !refundOutboxSnap.exists) {
            tx.set(orderRef, {
                refundEmailStatus: "not_required",
                refundEmailClosureReason: "canonical_refund_reference_pending",
                updatedAt: serverTimestamp(),
            }, { merge: true });
        }
        else {
            tx.set(orderRef, {
                refundEmailStatus: "manual_review",
                refundEmailError: canonicalRefundConflictId ?
                    "refund_id_conflict" : "provider_contract_mismatch",
                updatedAt: serverTimestamp(),
            }, { merge: true });
        }
        if (canonicalRefundConflictId) {
            console.error("CRITICAL_BILLING_PAYG_REFUND_ID_CONFLICT", {
                orderId: orderRef.id,
                storedRefundId,
                incomingRefundId: canonicalRefundConflictId,
            });
        }
    });
}
function isOpenDispute(status) {
    const lifecycle = classifyPaygDisputeStatus(status);
    // Unknown future provider states remain fail-closed: automation stays
    // suspended until an operator or a code update classifies them.
    return lifecycle === "open" || lifecycle === "unknown";
}
async function applyPaygPaymentReviewDispute(reviewDoc, dispute, paymentIntent) {
    await db().runTransaction(async (tx) => {
        const review = await tx.get(reviewDoc.ref);
        if (!review.exists) {
            throw new Error(`PAYG payment review ${reviewDoc.id} disappeared.`);
        }
        const exact = review.get("paymentIntentId") === paymentIntent.id &&
            review.get("providerCurrency") === paymentIntent.currency;
        const observation = resolvePaygDisputeObservation({
            storedDisputeId: review.get("disputeId"),
            storedDisputeStatus: review.get("disputeStatus"),
            incomingDisputeId: dispute.id,
            incomingDisputeStatus: dispute.status,
        });
        if (observation === "preserve_terminal") {
            tx.set(review.ref, Object.assign(Object.assign({ refundRecoveryAt: firestore_1.FieldValue.delete(), refundAutomationStatus: "suspended_dispute" }, paygRefundClaimCleanup()), { updatedAt: serverTimestamp() }), { merge: true });
            return;
        }
        if (observation === "conflict_manual_review") {
            tx.set(review.ref, Object.assign(Object.assign({ status: "manual_review", conflictingDisputeId: dispute.id, conflictingDisputeStatus: dispute.status, refundRecoveryAt: firestore_1.FieldValue.delete(), refundAutomationStatus: "suspended_dispute", refundObligationReviewRequired: true }, paygRefundClaimCleanup()), { updatedAt: serverTimestamp() }), { merge: true });
            return;
        }
        const currentStatus = review.get("status");
        const status = resolvePaygDisputeOwnerStatus(currentStatus, exact, dispute.status);
        tx.set(review.ref, Object.assign(Object.assign({ status, disputeId: dispute.id, disputeStatus: dispute.status, disputeOpen: isOpenDispute(dispute.status), disputeUpdatedAt: serverTimestamp(), refundRecoveryAt: firestore_1.FieldValue.delete(), refundAutomationStatus: "suspended_dispute", refundObligationReviewRequired: true }, paygRefundClaimCleanup()), { updatedAt: serverTimestamp() }), { merge: true });
        if (!exact) {
            console.error("CRITICAL_BILLING_PAYG_REVIEW_DISPUTE_MISMATCH", {
                paymentReviewId: review.id,
                disputeId: dispute.id,
            });
        }
    });
}
async function applyPaygDispute(dispute, paymentIntent) {
    const owner = await paygPaymentOwnerForPaymentIntent(paymentIntent);
    if (owner.kind === "review") {
        await applyPaygPaymentReviewDispute(owner.doc, dispute, paymentIntent);
        return;
    }
    const orderDoc = owner.doc;
    const orderRef = orderDoc.ref;
    await db().runTransaction(async (tx) => {
        const freshOrder = await tx.get(orderRef);
        if (!freshOrder.exists)
            throw new Error(`PAYG order ${orderRef.id} disappeared.`);
        const order = freshOrder.data();
        const bookingRef = order.bookingId ?
            db().collection("bookings").doc(order.bookingId) : null;
        const outboxRef = db().collection("paygEmailOutbox").doc(orderRef.id);
        const disputeOutboxRef = db().collection("paygEmailOutbox")
            .doc(paygDisputeOutboxId(orderRef.id));
        const lockRef = paygDuplicateLockRef(order.duplicateLockId);
        const reviewRef = paygPaymentReviewRef(freshOrder.get("paymentReviewId"));
        const [bookingSnap, classSnap, outboxSnap, disputeOutboxSnap, lockSnap, reviewSnap,] = await Promise.all([
            bookingRef ? tx.get(bookingRef) : Promise.resolve(null),
            tx.get(db().collection("classes").doc(order.class.classId)),
            tx.get(outboxRef),
            tx.get(disputeOutboxRef),
            lockRef ? tx.get(lockRef) : Promise.resolve(null),
            reviewRef ? tx.get(reviewRef) : Promise.resolve(null),
        ]);
        const observation = resolvePaygDisputeObservation({
            storedDisputeId: freshOrder.get("disputeId"),
            storedDisputeStatus: freshOrder.get("disputeStatus"),
            incomingDisputeId: dispute.id,
            incomingDisputeStatus: dispute.status,
        });
        const linkedReview = (reviewSnap === null || reviewSnap === void 0 ? void 0 : reviewSnap.exists) &&
            reviewSnap.get("orderId") === orderRef.id &&
            reviewSnap.get("paymentIntentId") === paymentIntent.id;
        const disputeChargeId = idOf(dispute.charge);
        const disputeLifecycle = classifyPaygDisputeStatus(dispute.status);
        const exactLifecycleEmailBinding = disputeLifecycle !== "unknown" &&
            /^du_[A-Za-z0-9_]{4,252}$/.test(dispute.id) &&
            isPaygOrdinaryLifecycleEmailOrder(freshOrder.data()) &&
            order.purchaseKind === exports.PAYG_PURCHASE_KIND &&
            order.amountPence === exports.PAYG_AMOUNT_PENCE &&
            order.currency === exports.PAYG_CURRENCY &&
            order.paymentIntentId === paymentIntent.id &&
            paymentIntent.currency === exports.PAYG_CURRENCY &&
            disputeChargeId !== null && order.chargeId === disputeChargeId &&
            dispute.amount === exports.PAYG_AMOUNT_PENCE &&
            dispute.currency === exports.PAYG_CURRENCY &&
            !freshOrder.get("conflictingDisputeId");
        if (observation === "preserve_terminal") {
            // This handler may have retrieved an older open provider snapshot before
            // another handler committed the terminal state. The fresh Firestore row
            // is authoritative in this branch: never copy the stale incoming status
            // or its lifecycle fields back over terminal evidence.
            const storedDisputeId = freshOrder.get("disputeId");
            const storedDisputeChargeId = freshOrder.get("disputeChargeId");
            const storedLifecycleEmailBinding = /^du_[A-Za-z0-9_]{4,252}$/.test(storedDisputeId || "") &&
                isPaygTerminalDisputeStatus(freshOrder.get("disputeStatus")) &&
                isPaygOrdinaryLifecycleEmailOrder(freshOrder.data()) &&
                order.purchaseKind === exports.PAYG_PURCHASE_KIND &&
                order.amountPence === exports.PAYG_AMOUNT_PENCE &&
                order.currency === exports.PAYG_CURRENCY &&
                order.paymentIntentId === paymentIntent.id &&
                paymentIntent.currency === exports.PAYG_CURRENCY &&
                typeof storedDisputeChargeId === "string" &&
                order.chargeId === storedDisputeChargeId &&
                freshOrder.get("disputeAmountPence") === exports.PAYG_AMOUNT_PENCE &&
                freshOrder.get("disputeCurrency") === exports.PAYG_CURRENCY &&
                !freshOrder.get("conflictingDisputeId");
            await releasePaidOrderCapacity(tx, orderRef, order, bookingSnap, classSnap, outboxSnap, lockSnap, {
                status: order.status,
                cancelledReason: "payg_dispute",
                refundRecoveryAt: firestore_1.FieldValue.delete(),
                refundAutomationStatus: "suspended_dispute",
            });
            if (linkedReview) {
                tx.set(reviewSnap.ref, Object.assign(Object.assign({ refundRecoveryAt: firestore_1.FieldValue.delete(), refundAutomationStatus: "suspended_dispute" }, paygRefundClaimCleanup()), { updatedAt: serverTimestamp() }), { merge: true });
            }
            if (storedLifecycleEmailBinding) {
                enqueuePaygLifecycleEmail(tx, freshOrder, disputeOutboxSnap, {
                    kind: "dispute",
                    paymentIntentId: paymentIntent.id,
                    chargeId: storedDisputeChargeId,
                    disputeId: storedDisputeId,
                });
            }
            else if (!disputeOutboxSnap.exists) {
                tx.set(orderRef, {
                    disputeEmailStatus: "manual_review",
                    disputeEmailError: "stored_terminal_provider_binding_mismatch",
                    updatedAt: serverTimestamp(),
                }, { merge: true });
            }
            return;
        }
        if (observation === "conflict_manual_review") {
            await releasePaidOrderCapacity(tx, orderRef, order, bookingSnap, classSnap, outboxSnap, lockSnap, {
                status: "manual_review",
                cancelledReason: "payg_dispute_conflict",
                conflictingDisputeId: dispute.id,
                conflictingDisputeStatus: dispute.status,
                refundRecoveryAt: firestore_1.FieldValue.delete(),
                refundAutomationStatus: "suspended_dispute",
                refundObligationReviewRequired: true,
            });
            if (linkedReview) {
                tx.set(reviewSnap.ref, Object.assign(Object.assign({ status: "manual_review", conflictingDisputeId: dispute.id, conflictingDisputeStatus: dispute.status, refundRecoveryAt: firestore_1.FieldValue.delete(), refundAutomationStatus: "suspended_dispute", refundObligationReviewRequired: true }, paygRefundClaimCleanup()), { updatedAt: serverTimestamp() }), { merge: true });
            }
            return;
        }
        if (linkedReview) {
            tx.set(reviewSnap.ref, Object.assign(Object.assign({ status: resolvePaygDisputeOwnerStatus(reviewSnap.get("status"), true, dispute.status), disputeId: dispute.id, disputeStatus: dispute.status, disputeOpen: isOpenDispute(dispute.status), disputeUpdatedAt: serverTimestamp(), refundRecoveryAt: firestore_1.FieldValue.delete(), refundAutomationStatus: "suspended_dispute", refundObligationReviewRequired: true }, paygRefundClaimCleanup()), { updatedAt: serverTimestamp() }), { merge: true });
        }
        await releasePaidOrderCapacity(tx, orderRef, order, bookingSnap, classSnap, outboxSnap, lockSnap, Object.assign(Object.assign({ status: resolvePaygDisputeOwnerStatus(order.status, true, dispute.status), cancelledReason: "payg_dispute", disputeId: dispute.id, disputeStatus: dispute.status }, (exactLifecycleEmailBinding ? {
            disputeAmountPence: dispute.amount,
            disputeCurrency: dispute.currency,
            disputeChargeId,
        } : {})), { disputeOpen: isOpenDispute(dispute.status), disputeUpdatedAt: serverTimestamp(), refundRecoveryAt: firestore_1.FieldValue.delete(), refundAutomationStatus: "suspended_dispute", refundObligationReviewRequired: true }));
        if (exactLifecycleEmailBinding && disputeChargeId !== null) {
            enqueuePaygLifecycleEmail(tx, freshOrder, disputeOutboxSnap, {
                kind: "dispute",
                paymentIntentId: paymentIntent.id,
                chargeId: disputeChargeId,
                disputeId: dispute.id,
            });
        }
        else {
            tx.set(orderRef, {
                disputeEmailStatus: "manual_review",
                disputeEmailError: "provider_contract_mismatch",
                updatedAt: serverTimestamp(),
            }, { merge: true });
        }
    });
}
async function paygPaymentIntentForCharge(charge) {
    const paymentIntentId = idOf(charge.payment_intent);
    if (!paymentIntentId)
        return null;
    const paymentIntent = await stripe().paymentIntents.retrieve(paymentIntentId);
    assertStripeObjectMode("PaymentIntent", paymentIntent.id, paymentIntent.livemode);
    if (isPaygMetadata(paymentIntent.metadata))
        return paymentIntent;
    // A paid contract-mismatch review may intentionally exist because the final
    // PaymentIntent metadata was missing or altered. The private, unique stored
    // provider binding remains authoritative for later refund/dispute events.
    const [orders, reviews] = await Promise.all([
        db().collection("paygOrders")
            .where("paymentIntentId", "==", paymentIntent.id)
            .limit(2)
            .get(),
        db().collection(exports.PAYG_PAYMENT_REVIEW_COLLECTION)
            .where("paymentIntentId", "==", paymentIntent.id)
            .limit(2)
            .get(),
    ]);
    if (orders.size > 1 || reviews.size > 1 ||
        (orders.size === 1 && reviews.size === 1 &&
            reviews.docs[0].get("orderId") !== orders.docs[0].id)) {
        throw new Error(`PaymentIntent ${paymentIntent.id} has conflicting PAYG owners.`);
    }
    return orders.size === 1 || reviews.size === 1 ? paymentIntent : null;
}
function paygPaymentSuccessEvidenceFromEvent(event) {
    if (event.type !== "checkout.session.completed" &&
        event.type !== "checkout.session.async_payment_succeeded")
        return null;
    const session = event.data.object;
    const intentId = paygIntentIdFromCheckoutSession(session);
    const paymentIntentId = idOf(session.payment_intent);
    if (!intentId || !paymentIntentId ||
        session.object !== "checkout.session" ||
        session.mode !== "payment" || session.status !== "complete" ||
        session.payment_status !== "paid" ||
        session.livemode !== event.livemode ||
        typeof event.id !== "string" ||
        !/^evt_[A-Za-z0-9_]{4,250}$/.test(event.id) ||
        !Number.isSafeInteger(event.created) || event.created <= 0)
        return null;
    return Object.freeze({
        providerEventId: event.id,
        providerEventType: event.type,
        providerEventCreatedSecond: event.created,
        checkoutSessionId: session.id,
        paymentIntentId,
        intentId,
        livemode: event.livemode,
    });
}
/**
 * Dispatches PAYG-owned events before the membership webhook switch. Returns
 * false for unrelated events so the existing subscription domain can handle
 * them without a one-off Charge ever entering membership convergence.
 */
async function dispatchPaygStripeEvent(event) {
    switch (event.type) {
        case "checkout.session.completed":
        case "checkout.session.async_payment_succeeded": {
            const trigger = event.data.object;
            if (!paygIntentIdFromCheckoutSession(trigger))
                return false;
            const successEvidence = paygPaymentSuccessEvidenceFromEvent(event);
            const session = await stripe().checkout.sessions.retrieve(trigger.id);
            if (session.payment_status === "unpaid" ||
                (successEvidence === null && event.type === "checkout.session.completed" &&
                    trigger.payment_status === "unpaid")) {
                await markPaygPaymentPending(session);
            }
            else {
                await fulfilPaygCheckoutSession(session, successEvidence);
            }
            return true;
        }
        case "checkout.session.expired":
        case "checkout.session.async_payment_failed": {
            const session = event.data.object;
            if (!isPaygMetadata(session.metadata))
                return false;
            assertStripeObjectMode("Checkout Session", session.id, session.livemode);
            await releasePaygSession(session, event.type);
            return true;
        }
        case "charge.refunded": {
            const delivered = event.data.object;
            const charge = await stripe().charges.retrieve(delivered.id);
            assertStripeObjectMode("Charge", charge.id, charge.livemode);
            const paymentIntent = await paygPaymentIntentForCharge(charge);
            if (!paymentIntent)
                return false;
            await applyPaygChargeRefund(charge, paymentIntent);
            return true;
        }
        case "refund.created":
        case "refund.updated":
        case "refund.failed": {
            const delivered = event.data.object;
            const refund = await stripe().refunds.retrieve(delivered.id);
            if (await convergePaygRefund(refund))
                return true;
            return convergePaygPaymentReviewRefund(refund);
        }
        case "charge.dispute.created":
        case "charge.dispute.updated":
        case "charge.dispute.closed": {
            const delivered = event.data.object;
            const dispute = await stripe().disputes.retrieve(delivered.id);
            assertStripeObjectMode("Dispute", dispute.id, dispute.livemode);
            const chargeId = idOf(dispute.charge);
            if (!chargeId)
                return false;
            const charge = await stripe().charges.retrieve(chargeId);
            assertStripeObjectMode("Charge", charge.id, charge.livemode);
            const paymentIntent = await paygPaymentIntentForCharge(charge);
            if (!paymentIntent)
                return false;
            await applyPaygDispute(dispute, paymentIntent);
            return true;
        }
        default:
            return false;
    }
}
const PAYG_CHECKOUT_RECOVERY_LEASE_MS = 5 * 60 * 1000;
let paygSessionRecoveryAfterReadTestBarrier = null;
function pauseNextPaygSessionRecoveryAfterRead() {
    if (!isFirebaseFunctionsEmulatorProcess()) {
        throw new Error("PAYG session recovery read pause is emulator-only.");
    }
    if (paygSessionRecoveryAfterReadTestBarrier !== null) {
        throw new Error("A PAYG session recovery read pause is already active.");
    }
    let markReached;
    let release;
    const reached = new Promise((resolve) => {
        markReached = resolve;
    });
    const waitForRelease = new Promise((resolve) => {
        release = resolve;
    });
    paygSessionRecoveryAfterReadTestBarrier = { markReached, waitForRelease };
    return Object.freeze({ reached, release });
}
async function maybePausePaygSessionRecoveryAfterReadForTest() {
    const barrier = paygSessionRecoveryAfterReadTestBarrier;
    if (!barrier)
        return;
    paygSessionRecoveryAfterReadTestBarrier = null;
    barrier.markReached();
    await barrier.waitForRelease;
}
function hasRecoverablePaygIntentPii(intent, nowMillis) {
    var _a;
    const piiRetentionCutoffMillis = timestampMillis(intent.piiRetentionCutoffAt);
    return (intent.piiScrubbedAt === undefined || intent.piiScrubbedAt === null) &&
        typeof ((_a = intent.contact) === null || _a === void 0 ? void 0 : _a.email) === "string" &&
        intent.contact.email.trim().length > 0 &&
        piiRetentionCutoffMillis !== null &&
        piiRetentionCutoffMillis > nowMillis;
}
async function claimPaygSessionRecovery(intentRef, nowMillis) {
    const token = (0, crypto_1.randomUUID)();
    return db().runTransaction(async (tx) => {
        const snap = await tx.get(intentRef);
        await maybePausePaygSessionRecoveryAfterReadForTest();
        // Re-evaluate after the transactional read on every attempt. A slow read
        // or retry that crosses the immutable cutoff must never create a late
        // provider-recovery claim from the stale pre-read time.
        const checkedAt = Math.max(nowMillis, Date.now());
        if (!snap.exists)
            throw new Error(`PAYG intent ${intentRef.id} disappeared.`);
        const intent = snap.data();
        if (intent.status === "fulfilled")
            return { outcome: "fulfilled", intent };
        if (intent.capacityState === "released")
            return { outcome: "released", intent };
        if (intent.checkoutSessionId)
            return { outcome: "session_recorded", intent };
        if (!hasRecoverablePaygIntentPii(intent, checkedAt)) {
            return { outcome: "privacy_expired", intent };
        }
        const activeLeaseToken = snap.get("checkoutRecoveryToken");
        const activeLeaseExpiresAt = timestampMillis(snap.get("checkoutRecoveryLeaseExpiresAt"));
        if (typeof activeLeaseToken === "string" && activeLeaseToken.length > 0 &&
            activeLeaseExpiresAt !== null && activeLeaseExpiresAt > checkedAt) {
            return { outcome: "deferred", intent };
        }
        tx.set(intentRef, {
            checkoutRecoveryToken: token,
            checkoutRecoveryClaimedAt: serverTimestamp(),
            checkoutRecoveryLeaseExpiresAt: firestore_1.Timestamp.fromMillis(checkedAt + PAYG_CHECKOUT_RECOVERY_LEASE_MS),
            updatedAt: serverTimestamp(),
        }, { merge: true });
        return { outcome: "claimed", intent, token };
    });
}
async function recordRecoveredSession(intentRef, session, recoveryToken, nowMillis) {
    return db().runTransaction(async (tx) => {
        const snap = await tx.get(intentRef);
        if (!snap.exists)
            throw new Error(`PAYG intent ${intentRef.id} disappeared.`);
        const intent = snap.data();
        if (intent.checkoutSessionId && intent.checkoutSessionId !== session.id) {
            throw new Error(`PAYG intent ${intentRef.id} has conflicting Checkout Sessions.`);
        }
        if (intent.status === "fulfilled" || intent.capacityState === "released") {
            if (snap.get("checkoutRecoveryToken") === recoveryToken) {
                tx.set(intentRef, {
                    checkoutRecoveryToken: firestore_1.FieldValue.delete(),
                    checkoutRecoveryLeaseExpiresAt: firestore_1.FieldValue.delete(),
                    updatedAt: serverTimestamp(),
                }, { merge: true });
            }
            return "terminal";
        }
        if (snap.get("checkoutRecoveryToken") !== recoveryToken) {
            return "claim_lost";
        }
        if (!hasRecoverablePaygIntentPii(intent, Math.max(nowMillis, Date.now()))) {
            // Privacy redaction can win after the recovery query but before Stripe
            // answers. Retain only the provider identifier needed for reconciliation;
            // never recreate the customer-bearing Checkout URL from that stale read.
            tx.set(intentRef, {
                checkoutSessionId: session.id,
                checkoutSessionUrl: firestore_1.FieldValue.delete(),
                checkoutRecoveryToken: firestore_1.FieldValue.delete(),
                checkoutRecoveryLeaseExpiresAt: firestore_1.FieldValue.delete(),
                privacyRecoveryBlockedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            }, { merge: true });
            return "privacy_expired";
        }
        tx.set(intentRef, {
            status: "checkout_created",
            checkoutSessionId: session.id,
            checkoutSessionUrl: session.url,
            checkoutRecoveryToken: firestore_1.FieldValue.delete(),
            checkoutRecoveryLeaseExpiresAt: firestore_1.FieldValue.delete(),
            updatedAt: serverTimestamp(),
        }, { merge: true });
        return "recorded";
    });
}
async function recoverPaygHold(intentDoc, nowMillis) {
    const intentRef = intentDoc.ref;
    let intent = intentDoc.data();
    if (intent.status === "fulfilled" || intent.capacityState === "released") {
        await intentRef.set({ holdExpiresAt: firestore_1.FieldValue.delete() }, { merge: true });
        return intent.status === "fulfilled" ? "fulfilled" : "released";
    }
    let privacyExpiredDuringRecovery = false;
    let session = null;
    try {
        if (intent.checkoutSessionId) {
            session = await stripe().checkout.sessions.retrieve(intent.checkoutSessionId);
        }
        else {
            const claim = await claimPaygSessionRecovery(intentRef, nowMillis);
            intent = claim.intent;
            if (claim.outcome === "fulfilled" || claim.outcome === "released") {
                await intentRef.set({ holdExpiresAt: firestore_1.FieldValue.delete() }, { merge: true });
                return claim.outcome;
            }
            if (claim.outcome === "deferred")
                return "deferred";
            if (claim.outcome === "privacy_expired") {
                // The approved privacy deadline can outlive a persistently failed
                // create/recovery attempt. Once its PII is redacted, no new Checkout
                // may be reconstructed; release the stale hold while preserving the
                // non-PII recovery/audit record. A provider event for a payment that
                // somehow completed still follows the missing-evidence review/refund
                // path in fulfilPaygCheckoutSession.
                await releasePaygHold(intentRef, "privacy_redacted_before_session_recovery");
                return "released";
            }
            if (claim.outcome === "session_recorded") {
                session = await stripe().checkout.sessions.retrieve(String(intent.checkoutSessionId));
            }
            else if (claim.outcome === "claimed") {
                // Replaying the exact create request recovers an accepted response after
                // a process crash. If Stripe never accepted it, the worker creates an
                // unreachable Session and expires it immediately before releasing.
                const params = buildPaygCheckoutSessionParams({
                    intentId: intentRef.id,
                    classId: intent.class.classId,
                    classTitle: intent.class.title,
                    email: intent.contact.email,
                    priceId: intent.stripePriceId,
                    publicOrigin: intent.publicOrigin,
                    checkoutExpiresAt: intent.checkoutExpiresAt,
                });
                session = await stripe().checkout.sessions.create(params, {
                    idempotencyKey: `payg-checkout:${intent.checkoutAttemptHash}`,
                });
                assertSessionBinding(session, intentRef.id, intent);
                const writeOutcome = await recordRecoveredSession(intentRef, session, claim.token, nowMillis);
                if (writeOutcome === "claim_lost")
                    return "deferred";
                privacyExpiredDuringRecovery = writeOutcome === "privacy_expired";
            }
        }
    }
    catch (error) {
        if (isDefinitiveStripeCreateFailure(error)) {
            await releasePaygHold(intentRef, "recovery_confirmed_no_session");
            return "released";
        }
        throw error;
    }
    if (!session) {
        throw new Error(`PAYG intent ${intentRef.id} recovery produced no Checkout Session.`);
    }
    assertSessionBinding(session, intentRef.id, intent);
    if (session.status === "complete" && session.payment_status === "paid") {
        await fulfilPaygCheckoutSession(session);
        return "fulfilled";
    }
    if (!privacyExpiredDuringRecovery &&
        session.status === "complete" && session.payment_status === "unpaid" &&
        intent.classStartMillis > nowMillis) {
        await markPaygPaymentPending(session);
        return "deferred";
    }
    if (session.status === "open") {
        try {
            session = await stripe().checkout.sessions.expire(session.id);
            assertStripeObjectMode("Checkout Session", session.id, session.livemode);
        }
        catch (error) {
            // It may have completed between retrieve and expire. Re-read before any
            // capacity release so a paid class is never silently dropped.
            session = await stripe().checkout.sessions.retrieve(session.id);
            assertSessionBinding(session, intentRef.id, intent);
            if (session.status === "complete" && session.payment_status === "paid") {
                await fulfilPaygCheckoutSession(session);
                return "fulfilled";
            }
            if (session.status === "open")
                throw error;
        }
    }
    await releasePaygHold(intentRef, privacyExpiredDuringRecovery ?
        "privacy_redacted_during_session_recovery" :
        "recovery_confirmed_session_ended", session.id);
    return "released";
}
async function recoverDuePaygHolds(nowMillis, limit) {
    const due = await db().collection("paygIntents")
        .where("holdExpiresAt", "<=", firestore_1.Timestamp.fromMillis(nowMillis))
        .limit(limit)
        .get();
    const result = { fulfilled: 0, released: 0, deferred: 0, failed: 0 };
    for (const intent of due.docs) {
        try {
            result[await recoverPaygHold(intent, nowMillis)] += 1;
        }
        catch (error) {
            result.failed += 1;
            console.error("PAYG hold recovery failed", { intentId: intent.id, error });
        }
    }
    return result;
}
const PAYG_PII_REDACTION_FAILURE_RETRY_MS = 60 * 60 * 1000;
const PAYG_PII_DISCOVERY_STATE_COLLECTION = "paygPiiRedactionDiscovery";
const PAYG_PII_DISCOVERY_LEASE_MS = 5 * 60 * 1000;
const injectedPaygPiiRedactionFailures = new Set();
function injectPaygPiiRedactionFailureOnce(collectionId, documentId) {
    if (!isFirebaseFunctionsEmulatorProcess()) {
        throw new Error("PAYG PII redaction failure injection is emulator-only.");
    }
    if (!PAYG_PII_DISCOVERY_CONFIGS.some((config) => config.collectionId === collectionId) || !documentId || documentId.includes("/")) {
        throw new Error("PAYG PII redaction failure injection target is invalid.");
    }
    injectedPaygPiiRedactionFailures.add(`${collectionId}/${documentId}`);
}
function maybeThrowInjectedPaygPiiRedactionFailure(collectionId, documentId) {
    const key = `${collectionId}/${documentId}`;
    if (!injectedPaygPiiRedactionFailures.delete(key))
        return;
    throw new Error(`Injected PAYG PII redaction failure for ${key}.`);
}
const PAYG_PII_DISCOVERY_CONFIGS = Object.freeze([
    Object.freeze({
        collectionId: "paygIntents",
        piiFields: exports.PAYG_INTENT_PII_FIELDS,
        legacyScheduleField: "piiScrubAt",
        redactedAtField: "piiScrubbedAt",
    }),
    Object.freeze({
        collectionId: "paygOrders",
        piiFields: exports.PAYG_ORDER_PII_FIELDS,
        legacyScheduleField: "piiRedactAt",
        redactedAtField: "piiRedactedAt",
        discoversBookingBinding: true,
    }),
    Object.freeze({
        collectionId: "paygEmailOutbox",
        piiFields: exports.PAYG_OUTBOX_PII_FIELDS,
        legacyScheduleField: "piiRedactAt",
        redactedAtField: "piiRedactedAt",
    }),
    Object.freeze({
        collectionId: "paygWaiverAcceptances",
        piiFields: exports.PAYG_WAIVER_PII_FIELDS,
        legacyScheduleField: "piiRedactAt",
        redactedAtField: "piiRedactedAt",
    }),
]);
function emptyPaygPiiRedactionResult() {
    return { redacted: 0, deferred: 0, skipped: 0, failed: 0 };
}
function assertPaygPiiSweepInput(nowMillis, limit) {
    if (!Number.isSafeInteger(nowMillis) || nowMillis <= 0 ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw new Error("PAYG PII redaction sweep bounds are invalid.");
    }
}
const PAYG_EMAIL_LEASE_MS = 10 * 60 * 1000;
function isActivePaygEmailLease(input) {
    return (input.status === "sending" || input.status === "reconciling") &&
        typeof input.leaseToken === "string" &&
        /^[A-Za-z0-9-]{16,128}$/.test(input.leaseToken) &&
        input.leaseStartedAtMillis !== null &&
        Number.isSafeInteger(input.leaseStartedAtMillis) &&
        input.leaseStartedAtMillis > 0 &&
        input.leaseStartedAtMillis <= Number.MAX_SAFE_INTEGER -
            PAYG_EMAIL_LEASE_MS &&
        input.retentionCutoffAtMillis !== null &&
        Number.isSafeInteger(input.retentionCutoffAtMillis) &&
        input.leaseStartedAtMillis < input.retentionCutoffAtMillis &&
        input.leaseExpiresAtMillis !== null &&
        Number.isSafeInteger(input.leaseExpiresAtMillis) &&
        input.leaseExpiresAtMillis > input.leaseStartedAtMillis &&
        input.leaseExpiresAtMillis <= input.leaseStartedAtMillis +
            PAYG_EMAIL_LEASE_MS &&
        input.leaseExpiresAtMillis > input.nowMillis;
}
function paygPiiDiscoveryStateRef(config) {
    return db().collection(PAYG_PII_DISCOVERY_STATE_COLLECTION)
        .doc(config.collectionId);
}
async function acquirePaygPiiDiscoveryLease(config, nowMillis) {
    const stateRef = paygPiiDiscoveryStateRef(config);
    return db().runTransaction(async (tx) => {
        const state = await tx.get(stateRef);
        const leaseExpiresAt = timestampMillis(state.get("leaseExpiresAt"));
        if (leaseExpiresAt !== null && leaseExpiresAt > nowMillis)
            return null;
        const storedCursor = state.get("cursorDocumentId");
        const cursorDocumentId = typeof storedCursor === "string" && storedCursor ?
            storedCursor : null;
        const token = (0, crypto_1.randomUUID)();
        tx.set(stateRef, Object.assign(Object.assign({ schemaVersion: 1, collectionId: config.collectionId, cursorDocumentId, leaseToken: token, leaseExpiresAt: firestore_1.Timestamp.fromMillis(nowMillis + PAYG_PII_DISCOVERY_LEASE_MS), lastStartedAt: serverTimestamp() }, (state.exists ? {} : { createdAt: serverTimestamp() })), { updatedAt: serverTimestamp() }), { merge: true });
        return { token, cursorDocumentId };
    });
}
function paygDocumentHasDiscoverablePii(snapshot, config) {
    return config.piiFields.some((field) => {
        const value = snapshot.get(field);
        return value !== undefined && value !== null;
    });
}
async function hasExactBoundPaygBookingPii(tx, order, config) {
    if (config.discoversBookingBinding !== true)
        return false;
    const bookingId = order.get("bookingId");
    if (typeof bookingId !== "string" || !bookingId ||
        bookingId.includes("/"))
        return false;
    const booking = await tx.get(db().collection("bookings").doc(bookingId));
    return booking.exists && booking.get("bookingKind") === "payg_guest" &&
        booking.get("paygOrderId") === order.id &&
        hasNonNullDocumentField(booking, "userName");
}
function hasLegitimatePaygPiiRetryDeferral(candidate, config, cutoff, retryAt, nowMillis) {
    if (timestampMillis(candidate.get("piiRedactionLastFailedAt")) !== null &&
        retryAt <= nowMillis + PAYG_PII_REDACTION_FAILURE_RETRY_MS)
        return true;
    if (config.collectionId !== "paygEmailOutbox" || cutoff === null ||
        candidate.get("piiRedactionDeferredReason") !== "active_email_lease") {
        return false;
    }
    const leaseExpiresAt = timestampMillis(candidate.get("leaseExpiresAt"));
    return leaseExpiresAt === retryAt && isActivePaygEmailLease({
        status: candidate.get("status"),
        leaseToken: candidate.get("leaseToken"),
        leaseStartedAtMillis: timestampMillis(candidate.get("lastAttemptAt")),
        leaseExpiresAtMillis: leaseExpiresAt,
        retentionCutoffAtMillis: cutoff,
        nowMillis,
    });
}
async function scheduleDiscoveredPaygPiiCandidate(candidateRef, config, nowMillis) {
    return db().runTransaction(async (tx) => {
        const candidate = await tx.get(candidateRef);
        if (!candidate.exists)
            return false;
        const hasInlinePii = paygDocumentHasDiscoverablePii(candidate, config);
        const hasBookingPii = hasInlinePii ? false :
            await hasExactBoundPaygBookingPii(tx, candidate, config);
        if (!hasInlinePii && !hasBookingPii)
            return false;
        const retryAt = timestampMillis(candidate.get(exports.PAYG_PII_REDACTION_RETRY_FIELD));
        const cutoff = timestampMillis(candidate.get(exports.PAYG_PII_RETENTION_CUTOFF_FIELD));
        const privacyAlreadyClosed = hasNonNullDocumentField(candidate, config.redactedAtField);
        let normalizedRetryAt = null;
        if (privacyAlreadyClosed) {
            if (retryAt === null || retryAt > nowMillis)
                normalizedRetryAt = nowMillis;
        }
        else if (cutoff !== null && cutoff > nowMillis) {
            if (retryAt !== cutoff)
                normalizedRetryAt = cutoff;
        }
        else if (retryAt === null) {
            normalizedRetryAt = nowMillis;
        }
        else if (retryAt > nowMillis && !hasLegitimatePaygPiiRetryDeferral(candidate, config, cutoff, retryAt, nowMillis)) {
            normalizedRetryAt = nowMillis;
        }
        const hasLegacySchedule = candidate.get(config.legacyScheduleField) !== undefined;
        const hasAbandonedIntentTtl = config.collectionId === "paygIntents" &&
            candidate.get("piiDeleteAt") !== undefined;
        if (normalizedRetryAt === null && !hasLegacySchedule &&
            !hasAbandonedIntentTtl)
            return false;
        tx.set(candidateRef, Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, (normalizedRetryAt === null ? {} : {
            [exports.PAYG_PII_REDACTION_RETRY_FIELD]: firestore_1.Timestamp.fromMillis(normalizedRetryAt),
        })), { [config.legacyScheduleField]: firestore_1.FieldValue.delete() }), (config.collectionId === "paygIntents" ? {
            // Disarm the abandoned whole-document TTL proposal as soon as an old
            // row is encountered, even if its canonical cutoff is still future.
            piiDeleteAt: firestore_1.FieldValue.delete(),
        } : {})), { piiRedactionDiscoveredAt: serverTimestamp(), piiRedactionDiscoveryReason: privacyAlreadyClosed ?
                "pii_reintroduced_after_redaction" : cutoff === null ?
                "retention_cutoff_missing" : retryAt === null ?
                "retry_marker_missing" : normalizedRetryAt !== null ?
                "retry_marker_normalized" : "legacy_schedule_removed" }), (privacyAlreadyClosed ? {
            piiRedactionReintroducedAt: serverTimestamp(),
        } : {})), { updatedAt: serverTimestamp() }), { merge: true });
        return true;
    });
}
async function finishPaygPiiDiscoveryPage(config, lease, pageSize, limit, lastDocumentId, scheduledCount) {
    const stateRef = paygPiiDiscoveryStateRef(config);
    await db().runTransaction(async (tx) => {
        const state = await tx.get(stateRef);
        if (!state.exists || state.get("leaseToken") !== lease.token)
            return;
        const cycleComplete = pageSize < limit;
        tx.set(stateRef, Object.assign(Object.assign({ cursorDocumentId: cycleComplete ? null : lastDocumentId, scannedCount: firestore_1.FieldValue.increment(pageSize), scheduledCount: firestore_1.FieldValue.increment(scheduledCount) }, (cycleComplete ? { completedCycleCount: firestore_1.FieldValue.increment(1) } : {})), { leaseToken: firestore_1.FieldValue.delete(), leaseExpiresAt: firestore_1.FieldValue.delete(), lastError: firestore_1.FieldValue.delete(), lastCompletedAt: serverTimestamp(), updatedAt: serverTimestamp() }), { merge: true });
    });
}
async function releaseFailedPaygPiiDiscoveryLease(config, lease, error) {
    const stateRef = paygPiiDiscoveryStateRef(config);
    const message = error instanceof Error ? error.message : String(error);
    await db().runTransaction(async (tx) => {
        const state = await tx.get(stateRef);
        if (!state.exists || state.get("leaseToken") !== lease.token)
            return;
        tx.set(stateRef, {
            leaseToken: firestore_1.FieldValue.delete(),
            leaseExpiresAt: firestore_1.FieldValue.delete(),
            lastError: message.slice(0, 1000),
            lastFailedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        }, { merge: true });
    });
}
async function discoverPaygPiiCandidates(config, nowMillis, limit) {
    const lease = await acquirePaygPiiDiscoveryLease(config, nowMillis);
    if (!lease)
        return;
    try {
        const baseQuery = db().collection(config.collectionId)
            .orderBy(firestore_1.FieldPath.documentId())
            .limit(limit);
        const page = lease.cursorDocumentId ?
            await baseQuery.startAfter(lease.cursorDocumentId).get() :
            await baseQuery.get();
        let scheduledCount = 0;
        for (const candidate of page.docs) {
            if (await scheduleDiscoveredPaygPiiCandidate(candidate.ref, config, nowMillis))
                scheduledCount += 1;
        }
        await finishPaygPiiDiscoveryPage(config, lease, page.size, limit, page.docs.length > 0 ? page.docs[page.docs.length - 1].id : null, scheduledCount);
    }
    catch (error) {
        await releaseFailedPaygPiiDiscoveryLease(config, lease, error)
            .catch((releaseError) => console.error("Could not release PAYG PII discovery lease", { collectionId: config.collectionId, releaseError }));
        throw error;
    }
}
async function deferPaygPiiRedactionAfterFailure(ref, nowMillis) {
    await ref.set({
        [exports.PAYG_PII_REDACTION_RETRY_FIELD]: firestore_1.Timestamp.fromMillis(nowMillis + PAYG_PII_REDACTION_FAILURE_RETRY_MS),
        piiRedactionFailureCount: firestore_1.FieldValue.increment(1),
        piiRedactionLastFailedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    }, { merge: true });
}
async function recoverDuePaygIntentPrivacy(nowMillis, limit) {
    const due = await db().collection("paygIntents")
        .where(exports.PAYG_PII_REDACTION_RETRY_FIELD, "<=", firestore_1.Timestamp.fromMillis(nowMillis))
        .limit(limit)
        .get();
    const result = emptyPaygPiiRedactionResult();
    for (const intent of due.docs) {
        try {
            const outcome = await db().runTransaction(async (tx) => {
                var _a;
                const fresh = await tx.get(intent.ref);
                const retryAt = fresh.exists ? timestampMillis(fresh.get(exports.PAYG_PII_REDACTION_RETRY_FIELD)) : null;
                if (!fresh.exists || retryAt === null || retryAt > nowMillis) {
                    return "skipped";
                }
                const cutoff = timestampMillis(fresh.get(exports.PAYG_PII_RETENTION_CUTOFF_FIELD));
                const privacyAlreadyClosed = hasNonNullDocumentField(fresh, "piiScrubbedAt");
                if (!privacyAlreadyClosed && cutoff !== null && cutoff > nowMillis) {
                    tx.set(intent.ref, {
                        [exports.PAYG_PII_REDACTION_RETRY_FIELD]: firestore_1.Timestamp.fromMillis(cutoff),
                        updatedAt: serverTimestamp(),
                    }, { merge: true });
                    return "skipped";
                }
                const status = fresh.get("status");
                const knownOperationalStatus = status === "reserved" ||
                    status === "checkout_created" ||
                    status === "payment_pending" || status === "expired" ||
                    status === "failed" || status === "fulfilled" ||
                    status === "manual_review";
                maybeThrowInjectedPaygPiiRedactionFailure("paygIntents", intent.id);
                tx.set(intent.ref, Object.assign(Object.assign({ attendee: firestore_1.FieldValue.delete(), contact: firestore_1.FieldValue.delete(), acceptances: firestore_1.FieldValue.delete(), requestFingerprint: firestore_1.FieldValue.delete(), checkoutSessionUrl: firestore_1.FieldValue.delete(), [exports.PAYG_PII_REDACTION_RETRY_FIELD]: firestore_1.FieldValue.delete(), piiScrubAt: firestore_1.FieldValue.delete(), piiDeleteAt: firestore_1.FieldValue.delete(), piiScrubbedAt: serverTimestamp(), piiScrubReason: cutoff === null ?
                        "retention_cutoff_missing" : "retention_expired", piiRedactionPolicyVersion: (_a = fresh.get("privacy.policyVersion")) !== null && _a !== void 0 ? _a : "unrecorded-v1", piiRedactionDeferredAt: firestore_1.FieldValue.delete(), piiRedactionDeferredReason: firestore_1.FieldValue.delete(), piiRedactionLastFailedAt: firestore_1.FieldValue.delete() }, (knownOperationalStatus ? {
                    piiRedactionOperationalWarning: firestore_1.FieldValue.delete(),
                    piiRedactionOperationalWarningAt: firestore_1.FieldValue.delete(),
                } : {
                    // Operational corruption must not become authority to retain guest
                    // identity. Preserve a non-PII warning while redacting regardless.
                    piiRedactionOperationalWarning: "unknown_intent_status",
                    piiRedactionOperationalWarningAt: serverTimestamp(),
                })), { updatedAt: serverTimestamp() }), { merge: true });
                return knownOperationalStatus ?
                    "redacted" : "redacted_operational_warning";
            });
            if (outcome === "redacted_operational_warning") {
                result.redacted += 1;
                console.error("PAYG intent privacy state requires manual review", {
                    intentId: intent.id,
                    warning: "unknown_intent_status",
                });
            }
            else {
                result[outcome] += 1;
            }
        }
        catch (error) {
            result.failed += 1;
            console.error("PAYG intent privacy recovery failed", {
                intentId: intent.id,
                error,
            });
            await deferPaygPiiRedactionAfterFailure(intent.ref, nowMillis).catch(() => undefined);
        }
    }
    return result;
}
async function recoverDuePaygOrderPrivacy(nowMillis, limit) {
    const due = await db().collection("paygOrders")
        .where(exports.PAYG_PII_REDACTION_RETRY_FIELD, "<=", firestore_1.Timestamp.fromMillis(nowMillis))
        .limit(limit)
        .get();
    const result = emptyPaygPiiRedactionResult();
    for (const order of due.docs) {
        try {
            const outcome = await db().runTransaction(async (tx) => {
                var _a;
                const fresh = await tx.get(order.ref);
                const retryAt = fresh.exists ? timestampMillis(fresh.get(exports.PAYG_PII_REDACTION_RETRY_FIELD)) : null;
                if (!fresh.exists || retryAt === null || retryAt > nowMillis) {
                    return "skipped";
                }
                const cutoff = timestampMillis(fresh.get(exports.PAYG_PII_RETENTION_CUTOFF_FIELD));
                const privacyAlreadyClosed = hasNonNullDocumentField(fresh, "piiRedactedAt");
                if (!privacyAlreadyClosed && cutoff !== null && cutoff > nowMillis) {
                    tx.set(order.ref, {
                        [exports.PAYG_PII_REDACTION_RETRY_FIELD]: firestore_1.Timestamp.fromMillis(cutoff),
                        updatedAt: serverTimestamp(),
                    }, { merge: true });
                    return "skipped";
                }
                const bookingId = fresh.get("bookingId");
                const bookingIdIsAbsent = bookingId === null || bookingId === undefined;
                const bookingIdIsValid = typeof bookingId === "string" &&
                    bookingId.length > 0 && !bookingId.includes("/");
                const bookingRef = bookingIdIsValid ?
                    db().collection("bookings").doc(bookingId) : null;
                const booking = bookingRef ? await tx.get(bookingRef) : null;
                const bookingBindingConflict = (booking === null || booking === void 0 ? void 0 : booking.exists) === true &&
                    (booking.get("bookingKind") !== "payg_guest" ||
                        booking.get("paygOrderId") !== order.id);
                const bookingWarning = !bookingIdIsAbsent && !bookingIdIsValid ?
                    "invalid_booking_binding" : bookingBindingConflict ?
                    "conflicting_booking_binding" : null;
                maybeThrowInjectedPaygPiiRedactionFailure("paygOrders", order.id);
                tx.set(order.ref, {
                    attendee: firestore_1.FieldValue.delete(),
                    contact: firestore_1.FieldValue.delete(),
                    acceptances: firestore_1.FieldValue.delete(),
                    [exports.PAYG_PII_REDACTION_RETRY_FIELD]: firestore_1.FieldValue.delete(),
                    piiRedactAt: firestore_1.FieldValue.delete(),
                    piiRedactedAt: serverTimestamp(),
                    piiRedactionReason: cutoff === null ?
                        "retention_cutoff_missing" : "retention_expired",
                    piiRedactionPolicyVersion: (_a = fresh.get("privacy.policyVersion")) !== null && _a !== void 0 ? _a : "unrecorded-v1",
                    piiRedactionLastFailedAt: firestore_1.FieldValue.delete(),
                    piiRedactionBookingWarning: bookingWarning !== null && bookingWarning !== void 0 ? bookingWarning : firestore_1.FieldValue.delete(),
                    piiRedactionBookingWarningAt: bookingWarning ?
                        serverTimestamp() : firestore_1.FieldValue.delete(),
                    updatedAt: serverTimestamp(),
                }, { merge: true });
                if ((booking === null || booking === void 0 ? void 0 : booking.exists) && bookingRef && !bookingBindingConflict) {
                    tx.set(bookingRef, {
                        userName: firestore_1.FieldValue.delete(),
                        paygPiiRedactedAt: serverTimestamp(),
                        paygPiiRedactionReason: cutoff === null ?
                            "retention_cutoff_missing" : "retention_expired",
                        updatedAt: serverTimestamp(),
                    }, { merge: true });
                }
                return bookingWarning ?
                    "redacted_booking_warning" : "redacted";
            });
            if (outcome === "redacted_booking_warning") {
                result.redacted += 1;
                console.error("PAYG order booking privacy binding requires manual review", {
                    orderId: order.id,
                });
            }
            else {
                result[outcome] += 1;
            }
        }
        catch (error) {
            result.failed += 1;
            console.error("PAYG order privacy redaction failed", {
                orderId: order.id,
                error,
            });
            await deferPaygPiiRedactionAfterFailure(order.ref, nowMillis).catch(() => undefined);
        }
    }
    return result;
}
async function recoverDuePaygOutboxPrivacy(nowMillis, limit) {
    const due = await db().collection("paygEmailOutbox")
        .where(exports.PAYG_PII_REDACTION_RETRY_FIELD, "<=", firestore_1.Timestamp.fromMillis(nowMillis))
        .limit(limit)
        .get();
    const result = emptyPaygPiiRedactionResult();
    for (const outbox of due.docs) {
        try {
            const outcome = await db().runTransaction(async (tx) => {
                const fresh = await tx.get(outbox.ref);
                const retryAt = fresh.exists ? timestampMillis(fresh.get(exports.PAYG_PII_REDACTION_RETRY_FIELD)) : null;
                if (!fresh.exists || retryAt === null || retryAt > nowMillis) {
                    return "skipped";
                }
                const cutoff = timestampMillis(fresh.get(exports.PAYG_PII_RETENTION_CUTOFF_FIELD));
                const privacyAlreadyClosed = hasNonNullDocumentField(fresh, "piiRedactedAt");
                if (cutoff === null) {
                    // Missing immutable evidence is already privacy-closed. Unlike an
                    // approved canonical cutoff, an active or stale lease cannot justify
                    // retaining or using this payload for another moment.
                    maybeThrowInjectedPaygPiiRedactionFailure("paygEmailOutbox", outbox.id);
                    redactAndTombstonePaygOutbox(tx, fresh, "retention_deadline_missing");
                    return "redacted";
                }
                if (!privacyAlreadyClosed && cutoff > nowMillis) {
                    tx.set(outbox.ref, {
                        [exports.PAYG_PII_REDACTION_RETRY_FIELD]: firestore_1.Timestamp.fromMillis(cutoff),
                        updatedAt: serverTimestamp(),
                    }, { merge: true });
                    return "skipped";
                }
                const leaseStartedAt = timestampMillis(fresh.get("lastAttemptAt"));
                const leaseExpiresAt = timestampMillis(fresh.get("leaseExpiresAt"));
                if (!privacyAlreadyClosed && isActivePaygEmailLease({
                    status: fresh.get("status"),
                    leaseToken: fresh.get("leaseToken"),
                    leaseStartedAtMillis: leaseStartedAt,
                    leaseExpiresAtMillis: leaseExpiresAt,
                    retentionCutoffAtMillis: cutoff,
                    nowMillis,
                })) {
                    tx.set(outbox.ref, {
                        [exports.PAYG_PII_REDACTION_RETRY_FIELD]: firestore_1.Timestamp.fromMillis(leaseExpiresAt),
                        piiRedactionDeferredAt: serverTimestamp(),
                        piiRedactionDeferredReason: "active_email_lease",
                        updatedAt: serverTimestamp(),
                    }, { merge: true });
                    return "deferred";
                }
                maybeThrowInjectedPaygPiiRedactionFailure("paygEmailOutbox", outbox.id);
                tx.set(outbox.ref, {
                    to: firestore_1.FieldValue.delete(),
                    templateData: firestore_1.FieldValue.delete(),
                    lastError: firestore_1.FieldValue.delete(),
                    [exports.PAYG_PII_REDACTION_RETRY_FIELD]: firestore_1.FieldValue.delete(),
                    piiRedactAt: firestore_1.FieldValue.delete(),
                    piiRedactedAt: serverTimestamp(),
                    piiRedactionReason: cutoff === null ?
                        "retention_cutoff_missing" : "retention_expired",
                    piiRedactionDeferredAt: firestore_1.FieldValue.delete(),
                    piiRedactionDeferredReason: firestore_1.FieldValue.delete(),
                    piiRedactionLastFailedAt: firestore_1.FieldValue.delete(),
                    updatedAt: serverTimestamp(),
                }, { merge: true });
                return "redacted";
            });
            result[outcome] += 1;
        }
        catch (error) {
            result.failed += 1;
            console.error("PAYG outbox privacy redaction failed", {
                outboxId: outbox.id,
                error,
            });
            await deferPaygPiiRedactionAfterFailure(outbox.ref, nowMillis).catch(() => undefined);
        }
    }
    return result;
}
async function recoverDuePaygWaiverPrivacy(nowMillis, limit) {
    const due = await db().collection("paygWaiverAcceptances")
        .where(exports.PAYG_PII_REDACTION_RETRY_FIELD, "<=", firestore_1.Timestamp.fromMillis(nowMillis))
        .limit(limit)
        .get();
    const result = emptyPaygPiiRedactionResult();
    for (const waiver of due.docs) {
        try {
            const outcome = await db().runTransaction(async (tx) => {
                var _a;
                const fresh = await tx.get(waiver.ref);
                const retryAt = fresh.exists ? timestampMillis(fresh.get(exports.PAYG_PII_REDACTION_RETRY_FIELD)) : null;
                if (!fresh.exists || retryAt === null || retryAt > nowMillis) {
                    return "skipped";
                }
                const cutoff = timestampMillis(fresh.get(exports.PAYG_PII_RETENTION_CUTOFF_FIELD));
                const privacyAlreadyClosed = hasNonNullDocumentField(fresh, "piiRedactedAt");
                if (!privacyAlreadyClosed && cutoff !== null && cutoff > nowMillis) {
                    tx.set(waiver.ref, {
                        [exports.PAYG_PII_REDACTION_RETRY_FIELD]: firestore_1.Timestamp.fromMillis(cutoff),
                        updatedAt: serverTimestamp(),
                    }, { merge: true });
                    return "skipped";
                }
                maybeThrowInjectedPaygPiiRedactionFailure("paygWaiverAcceptances", waiver.id);
                tx.set(waiver.ref, {
                    attendee: firestore_1.FieldValue.delete(),
                    acceptances: firestore_1.FieldValue.delete(),
                    [exports.PAYG_PII_REDACTION_RETRY_FIELD]: firestore_1.FieldValue.delete(),
                    piiRedactAt: firestore_1.FieldValue.delete(),
                    piiRedactedAt: serverTimestamp(),
                    piiRedactionReason: cutoff === null ?
                        "retention_cutoff_missing" : "retention_expired",
                    piiRedactionPolicyVersion: (_a = fresh.get("privacy.policyVersion")) !== null && _a !== void 0 ? _a : "unrecorded-v1",
                    piiRedactionLastFailedAt: firestore_1.FieldValue.delete(),
                    updatedAt: serverTimestamp(),
                }, { merge: true });
                return "redacted";
            });
            result[outcome] += 1;
        }
        catch (error) {
            result.failed += 1;
            console.error("PAYG waiver privacy redaction failed", {
                waiverId: waiver.id,
                error,
            });
            await deferPaygPiiRedactionAfterFailure(waiver.ref, nowMillis).catch(() => undefined);
        }
    }
    return result;
}
async function runPaygPiiRedactionSweep(nowMillis = Date.now(), limit = exports.PAYG_PII_REDACTION_BATCH_SIZE) {
    assertPaygPiiSweepInput(nowMillis, limit);
    const recoverWithDiscovery = async (config, recoverDue) => {
        let discoveryFailures = 0;
        try {
            await discoverPaygPiiCandidates(config, nowMillis, limit);
        }
        catch (error) {
            discoveryFailures = 1;
            console.error("PAYG PII discovery failed", {
                collectionId: config.collectionId,
                error,
            });
        }
        const result = await recoverDue(nowMillis, limit);
        result.failed += discoveryFailures;
        return result;
    };
    const [intents, orders, outbox, waivers] = await Promise.all([
        recoverWithDiscovery(PAYG_PII_DISCOVERY_CONFIGS[0], recoverDuePaygIntentPrivacy),
        recoverWithDiscovery(PAYG_PII_DISCOVERY_CONFIGS[1], recoverDuePaygOrderPrivacy),
        recoverWithDiscovery(PAYG_PII_DISCOVERY_CONFIGS[2], recoverDuePaygOutboxPrivacy),
        recoverWithDiscovery(PAYG_PII_DISCOVERY_CONFIGS[3], recoverDuePaygWaiverPrivacy),
    ]);
    return Object.freeze({ intents, orders, outbox, waivers });
}
async function recoverDuePaygRefunds(nowMillis, limit) {
    const due = await db().collection("paygOrders")
        .where("refundRecoveryAt", "<=", firestore_1.Timestamp.fromMillis(nowMillis))
        .limit(limit)
        .get();
    const result = { processed: 0, failed: 0 };
    for (const order of due.docs) {
        try {
            const storedReason = order.get("refundReason");
            const reason = storedReason === "guest_cancellation" ||
                storedReason === "class_cancellation" ||
                storedReason === "hold_released_before_payment" ||
                storedReason === "paid_contract_mismatch" ? storedReason :
                order.get("cancellation") ? "guest_cancellation" :
                    "hold_released_before_payment";
            await issuePaygRefund(order.id, reason);
            result.processed += 1;
        }
        catch (error) {
            result.failed += 1;
            console.error("PAYG refund recovery failed", { orderId: order.id, error });
        }
    }
    return result;
}
async function recoverDuePaygPaymentReviewRefunds(nowMillis, limit) {
    const due = await db().collection(exports.PAYG_PAYMENT_REVIEW_COLLECTION)
        .where("refundRecoveryAt", "<=", firestore_1.Timestamp.fromMillis(nowMillis))
        .limit(limit)
        .get();
    const result = { processed: 0, failed: 0 };
    for (const review of due.docs) {
        try {
            await issuePaygPaymentReviewRefund(review.id);
            result.processed += 1;
        }
        catch (error) {
            result.failed += 1;
            console.error("PAYG payment-review refund recovery failed", {
                paymentReviewId: review.id,
                error,
            });
        }
    }
    return result;
}
async function convergePaygAttendanceOutcome(orderDoc) {
    return db().runTransaction(async (tx) => {
        const freshOrder = await tx.get(orderDoc.ref);
        if (!freshOrder.exists)
            return "skipped";
        const order = freshOrder.data();
        const bookingRef = order.bookingId ?
            db().collection("bookings").doc(order.bookingId) : null;
        const outboxRef = db().collection("paygEmailOutbox").doc(orderDoc.id);
        const lockRef = paygDuplicateLockRef(order.duplicateLockId);
        const [booking, outbox, lock] = await Promise.all([
            bookingRef ? tx.get(bookingRef) : Promise.resolve(null),
            tx.get(outboxRef),
            lockRef ? tx.get(lockRef) : Promise.resolve(null),
        ]);
        if (order.status !== "confirmed") {
            if (order.status === "no_show" || order.status === "cancelled" ||
                order.status === "refunded" || order.status === "disputed" ||
                order.status === "manual_review") {
                tombstonePaygConfirmation(tx, outbox, `order_${order.status}`);
                releasePaygDuplicateLock(tx, lock, orderDoc.id);
            }
            tx.set(orderDoc.ref, { noShowReviewAt: firestore_1.FieldValue.delete() }, { merge: true });
            return "skipped";
        }
        const attended = (booking === null || booking === void 0 ? void 0 : booking.get("attended")) === true ||
            (booking === null || booking === void 0 ? void 0 : booking.get("attendanceStatus")) === "checked_in" ||
            timestampMillis(booking === null || booking === void 0 ? void 0 : booking.get("checkedInAt")) !== null;
        const status = attended ? "attended" : "no_show";
        releasePaygDuplicateLock(tx, lock, orderDoc.id);
        if (status === "no_show") {
            tombstonePaygConfirmation(tx, outbox, "order_no_show");
        }
        tx.set(orderDoc.ref, Object.assign(Object.assign({ status, capacityState: "consumed" }, (status === "no_show" ? { confirmationEmailStatus: "not_required" } : {})), { postStartCancellationReviewPending: firestore_1.FieldValue.delete(), noShowReviewAt: firestore_1.FieldValue.delete(), attendanceResolvedAt: serverTimestamp(), updatedAt: serverTimestamp() }), { merge: true });
        if (bookingRef && (booking === null || booking === void 0 ? void 0 : booking.exists)) {
            tx.set(bookingRef, Object.assign(Object.assign({}, (status === "no_show" ? { attendanceStatus: "dip" } : {})), { paygAttendanceOutcome: status, updatedAt: serverTimestamp() }), { merge: true });
        }
        return status;
    });
}
async function recoverDuePaygNoShows(nowMillis, limit) {
    const due = await db().collection("paygOrders")
        .where("noShowReviewAt", "<=", firestore_1.Timestamp.fromMillis(nowMillis))
        .limit(limit)
        .get();
    const result = { attended: 0, noShow: 0, skipped: 0, failed: 0 };
    for (const order of due.docs) {
        try {
            const outcome = await convergePaygAttendanceOutcome(order);
            if (outcome === "attended")
                result.attended += 1;
            else if (outcome === "no_show")
                result.noShow += 1;
            else
                result.skipped += 1;
        }
        catch (error) {
            result.failed += 1;
            console.error("PAYG attendance convergence failed", { orderId: order.id, error });
        }
    }
    return result;
}
function escapeHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
function assertEmailRoutingAddress(value, field) {
    var _a, _b;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 320 || /[\r\n]/.test(trimmed)) {
        throw new Error(`${field} is not configured safely.`);
    }
    const address = (_b = (_a = trimmed.match(/<([^<>]+)>$/)) === null || _a === void 0 ? void 0 : _a[1]) !== null && _b !== void 0 ? _b : trimmed;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
        throw new Error(`${field} is not configured safely.`);
    }
    return trimmed;
}
function buildPaygConfirmationEmail(outbox, from, replyTo) {
    const data = outbox.templateData;
    const classStart = luxon_1.DateTime.fromISO(data.class.startTime, { setZone: true })
        .setZone(data.class.timezone);
    if (!classStart.isValid)
        throw new Error("PAYG confirmation class time is invalid.");
    const when = classStart.toFormat("cccc d LLLL yyyy 'at' HH:mm ZZZZ");
    const amount = `£${(data.amountPence / 100).toFixed(2)}`;
    const subject = `Your PAYG class is confirmed — ${data.class.title}`;
    const text = [
        `Hi ${data.attendeeName},`,
        "",
        `Your ${data.class.title} class is confirmed.`,
        `When: ${when}`,
        `Where: ${data.class.location}`,
        `Paid: ${amount} GBP`,
        "",
        "Booking documents:",
        `PAYG Terms: ${data.legalAcceptance.terms.version}`,
        `Terms copy: ${data.legalAcceptance.terms.publicUrl}`,
        `Participant Waiver: ${data.legalAcceptance.waiver.version}`,
        `Waiver copy: ${data.legalAcceptance.waiver.publicUrl}`,
        `Privacy Notice shown: ${data.legalAcceptance.privacyNotice.version}`,
        `Privacy Notice copy: ${data.legalAcceptance.privacyNotice.publicUrl}`,
        `Acceptance time: ${data.legalAcceptance.acceptedAt}`,
        "",
        data.cancellationPolicy.beforeCutoff,
        data.cancellationPolicy.afterCutoff,
        `Refund deadline: ${data.cancellationPolicy.refundableUntil}`,
        "",
        `Cancel this booking: ${data.cancellationUrl}`,
    ].join("\n");
    const html = `<!doctype html>
<html lang="en"><body style="margin:0;background:#f4f4f2;color:#111;font-family:Arial,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border:1px solid #ddd">
      <tr><td style="padding:32px">
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:.16em;font-weight:700">ZERO ALPHA FITNESS</p>
        <h1 style="margin:0 0 24px;font-size:28px">Your class is confirmed</h1>
        <p>Hi ${escapeHtml(data.attendeeName)},</p>
        <p><strong>${escapeHtml(data.class.title)}</strong><br>
          ${escapeHtml(when)}<br>${escapeHtml(data.class.location)}</p>
        <p><strong>Paid:</strong> ${escapeHtml(amount)} GBP</p>
        <p><strong>Booking documents</strong><br>
          PAYG Terms (accepted): <a href="${escapeHtml(data.legalAcceptance.terms.publicUrl)}">${escapeHtml(data.legalAcceptance.terms.version)}</a><br>
          Participant Waiver (accepted): <a href="${escapeHtml(data.legalAcceptance.waiver.publicUrl)}">${escapeHtml(data.legalAcceptance.waiver.version)}</a><br>
          Privacy Notice (shown, not consent): <a href="${escapeHtml(data.legalAcceptance.privacyNotice.publicUrl)}">${escapeHtml(data.legalAcceptance.privacyNotice.version)}</a><br>
          Acceptance time: ${escapeHtml(data.legalAcceptance.acceptedAt)}</p>
        <p>${escapeHtml(data.cancellationPolicy.beforeCutoff)}
          ${escapeHtml(data.cancellationPolicy.afterCutoff)}</p>
        <p><strong>Refund deadline:</strong>
          ${escapeHtml(data.cancellationPolicy.refundableUntil)}</p>
        <p style="margin:28px 0"><a href="${escapeHtml(data.cancellationUrl)}"
          style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:14px 20px;font-weight:700">Manage or cancel this booking</a></p>
        <p style="font-size:13px;color:#555">Keep this email: the cancellation link is your private guest booking link.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
    return Object.freeze({
        from: assertEmailRoutingAddress(from, "PAYG_FROM_EMAIL"),
        to: Object.freeze([...outbox.to]),
        reply_to: assertEmailRoutingAddress(replyTo, "PAYG_REPLY_TO_EMAIL"),
        subject,
        text,
        html,
    });
}
function paygCorrectionMessage(paid) {
    return `Your booking is no longer active. The ${paid} payment or refund status may still be updating. If a refund is due, it will be returned to the original payment method; contact support for the latest status.`;
}
function buildPaygConfirmationCorrectionEmail(outbox, from, replyTo) {
    const data = outbox.templateData;
    const classStart = luxon_1.DateTime.fromISO(data.class.startTime, { setZone: true })
        .setZone(data.class.timezone);
    if (!classStart.isValid)
        throw new Error("PAYG correction class time is invalid.");
    const when = classStart.toFormat("cccc d LLLL yyyy 'at' HH:mm ZZZZ");
    const paid = `£${(data.amountPence / 100).toFixed(2)} ${data.currency.toUpperCase()}`;
    const update = paygCorrectionMessage(paid);
    const subject = `Important update to your PAYG class — ${data.class.title}`;
    const text = [
        `Hi ${data.attendeeName},`,
        "",
        "A confirmation email may have reached you while your booking status was changing.",
        update,
        `Class: ${data.class.title}`,
        `When: ${when}`,
        `Where: ${data.class.location}`,
        "",
        "Please use this update instead of the earlier confirmation email.",
    ].join("\n");
    const html = `<!doctype html>
<html lang="en"><body style="margin:0;background:#f4f4f2;color:#111;font-family:Arial,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border:1px solid #ddd">
      <tr><td style="padding:32px">
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:.16em;font-weight:700">ZERO ALPHA FITNESS</p>
        <h1 style="margin:0 0 24px;font-size:28px">Important booking update</h1>
        <p>Hi ${escapeHtml(data.attendeeName)},</p>
        <p>A confirmation email may have reached you while your booking status was changing.</p>
        <p><strong>${escapeHtml(update)}</strong></p>
        <p>${escapeHtml(data.class.title)}<br>${escapeHtml(when)}<br>
          ${escapeHtml(data.class.location)}</p>
        <p>Please use this update instead of the earlier confirmation email.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
    return Object.freeze({
        from: assertEmailRoutingAddress(from, "PAYG_FROM_EMAIL"),
        to: Object.freeze([...outbox.to]),
        reply_to: assertEmailRoutingAddress(replyTo, "PAYG_REPLY_TO_EMAIL"),
        subject,
        text,
        html,
    });
}
function assertPaygEmailSubject(value) {
    if (!value || value.length > 998 || /[\r\n]/.test(value)) {
        throw new Error("PAYG email subject is not configured safely.");
    }
    return value;
}
function paygLifecycleClassWhen(classSnapshot, label) {
    const classStart = luxon_1.DateTime.fromISO(classSnapshot.startTime, { setZone: true })
        .setZone(classSnapshot.timezone);
    if (!classStart.isValid)
        throw new Error(`PAYG ${label} class time is invalid.`);
    return classStart.toFormat("cccc d LLLL yyyy 'at' HH:mm ZZZZ");
}
function validatedPaygEmailRecipients(recipients) {
    if (recipients.length !== 1) {
        throw new Error("PAYG email recipient is not configured safely.");
    }
    return Object.freeze([
        assertEmailRoutingAddress(recipients[0], "PAYG recipient"),
    ]);
}
function buildPaygRefundEmail(outbox, from, replyTo) {
    const data = outbox.templateData;
    const when = paygLifecycleClassWhen(data.class, "refund");
    const paid = `£${(data.amountPence / 100).toFixed(2)} ${data.currency.toUpperCase()}`;
    const subject = assertPaygEmailSubject(`Your PAYG refund is confirmed — ${data.class.title}`);
    const text = [
        `Hi ${data.attendeeName},`,
        "",
        `Stripe has confirmed your ${paid} refund to the original payment method.`,
        "Your bank may take additional time to display the refund.",
        "",
        `Class: ${data.class.title}`,
        `When: ${when}`,
        `Where: ${data.class.location}`,
    ].join("\n");
    const html = `<!doctype html>
<html lang="en"><body style="margin:0;background:#f4f4f2;color:#111;font-family:Arial,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border:1px solid #ddd">
      <tr><td style="padding:32px">
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:.16em;font-weight:700">ZERO ALPHA FITNESS</p>
        <h1 style="margin:0 0 24px;font-size:28px">Your refund is confirmed</h1>
        <p>Hi ${escapeHtml(data.attendeeName)},</p>
        <p><strong>Stripe has confirmed your ${escapeHtml(paid)} refund to the original payment method.</strong></p>
        <p>Your bank may take additional time to display the refund.</p>
        <p>${escapeHtml(data.class.title)}<br>${escapeHtml(when)}<br>
          ${escapeHtml(data.class.location)}</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
    return Object.freeze({
        from: assertEmailRoutingAddress(from, "PAYG_FROM_EMAIL"),
        to: validatedPaygEmailRecipients(outbox.to),
        reply_to: assertEmailRoutingAddress(replyTo, "PAYG_REPLY_TO_EMAIL"),
        subject,
        text,
        html,
    });
}
function buildPaygDisputeEmail(outbox, from, replyTo) {
    const data = outbox.templateData;
    const when = paygLifecycleClassWhen(data.class, "dispute");
    const paid = `£${(data.amountPence / 100).toFixed(2)} ${data.currency.toUpperCase()}`;
    const subject = assertPaygEmailSubject(`Important: dispute reported for your PAYG class — ${data.class.title}`);
    const notice = `Stripe reported a dispute on the ${paid} payment for this booking. The booking is inactive and automated refund handling has been stopped.`;
    const contact = "If you did not expect this, reply to this email so we can review it with you.";
    const text = [
        `Hi ${data.attendeeName},`,
        "",
        notice,
        contact,
        "",
        `Class: ${data.class.title}`,
        `When: ${when}`,
        `Where: ${data.class.location}`,
    ].join("\n");
    const html = `<!doctype html>
<html lang="en"><body style="margin:0;background:#f4f4f2;color:#111;font-family:Arial,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border:1px solid #ddd">
      <tr><td style="padding:32px">
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:.16em;font-weight:700">ZERO ALPHA FITNESS</p>
        <h1 style="margin:0 0 24px;font-size:28px">Important payment update</h1>
        <p>Hi ${escapeHtml(data.attendeeName)},</p>
        <p><strong>${escapeHtml(notice)}</strong></p>
        <p>${escapeHtml(contact)}</p>
        <p>${escapeHtml(data.class.title)}<br>${escapeHtml(when)}<br>
          ${escapeHtml(data.class.location)}</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
    return Object.freeze({
        from: assertEmailRoutingAddress(from, "PAYG_FROM_EMAIL"),
        to: validatedPaygEmailRecipients(outbox.to),
        reply_to: assertEmailRoutingAddress(replyTo, "PAYG_REPLY_TO_EMAIL"),
        subject,
        text,
        html,
    });
}
function buildPaygOutboxEmail(outbox, from, replyTo) {
    switch (outbox.kind) {
        case "payg_guest_confirmation":
            return buildPaygConfirmationEmail(outbox, from, replyTo);
        case "payg_guest_confirmation_correction":
            return buildPaygConfirmationCorrectionEmail(outbox, from, replyTo);
        case "payg_guest_refund_confirmation":
            return buildPaygRefundEmail(outbox, from, replyTo);
        case "payg_guest_dispute_notice":
            return buildPaygDisputeEmail(outbox, from, replyTo);
    }
}
function paygLifecycleClassMatches(left, right) {
    if (!validPaygLifecycleClass(left) || !validPaygLifecycleClass(right)) {
        return false;
    }
    return left.classId === right.classId && left.title === right.title &&
        left.startTime === right.startTime && left.endTime === right.endTime &&
        left.timezone === right.timezone && left.location === right.location;
}
function isPaygLifecycleEmailBindingValid(payload, orderValue) {
    if (!payload || typeof payload !== "object" ||
        !orderValue || typeof orderValue !== "object")
        return false;
    const message = payload;
    const order = orderValue;
    if (message.kind !== "payg_guest_refund_confirmation" &&
        message.kind !== "payg_guest_dispute_notice")
        return false;
    const data = message.templateData;
    const contact = order.contact;
    const attendee = order.attendee;
    const common = order.purchaseKind === exports.PAYG_PURCHASE_KIND &&
        isPaygOrdinaryLifecycleEmailOrder(order) &&
        order.orderId === message.orderId &&
        order.amountPence === exports.PAYG_AMOUNT_PENCE &&
        order.currency === exports.PAYG_CURRENCY &&
        order.paymentIntentId === data.paymentIntentId &&
        order.chargeId === data.chargeId &&
        data.amountPence === exports.PAYG_AMOUNT_PENCE &&
        data.currency === exports.PAYG_CURRENCY &&
        Array.isArray(message.to) && message.to.length === 1 &&
        contact && contact.email === message.to[0] &&
        attendee && attendee.fullName === data.attendeeName &&
        paygLifecycleClassMatches(order.class, data.class);
    if (!common)
        return false;
    if (message.kind === "payg_guest_refund_confirmation") {
        const refundData = message.templateData;
        return typeof refundData.refundId === "string" &&
            order.refundId === refundData.refundId &&
            order.refundStatus === "succeeded" &&
            !order.conflictingRefundId &&
            order.refundedAmountPence === exports.PAYG_AMOUNT_PENCE;
    }
    const disputeData = message.templateData;
    return order.disputeId === disputeData.disputeId &&
        order.disputeChargeId === disputeData.chargeId &&
        order.disputeAmountPence === exports.PAYG_AMOUNT_PENCE &&
        order.disputeCurrency === exports.PAYG_CURRENCY &&
        !order.conflictingDisputeId &&
        classifyPaygDisputeStatus(order.disputeStatus) !== "unknown" &&
        order.refundAutomationStatus === "suspended_dispute";
}
function isPaygEmailPayloadDeliverable(payload, order) {
    const status = order.get("status");
    if (payload.kind === "payg_guest_confirmation") {
        return shouldSendPaygConfirmation(status);
    }
    if (payload.kind === "payg_guest_confirmation_correction") {
        return shouldEnqueuePaygConfirmationCorrection(status);
    }
    return isPaygLifecycleEmailBindingValid(payload, order.data());
}
const PAYG_EMAIL_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
let paygEmailPreflightTestBarrier = null;
let paygEmailFailureAfterReadsTestBarrier = null;
function pauseNextPaygEmailPreflight() {
    if (!isFirebaseFunctionsEmulatorProcess()) {
        throw new Error("PAYG email preflight pause is emulator-only.");
    }
    if (paygEmailPreflightTestBarrier !== null) {
        throw new Error("A PAYG email preflight pause is already active.");
    }
    let markReached;
    let release;
    const reached = new Promise((resolve) => {
        markReached = resolve;
    });
    const waitForRelease = new Promise((resolve) => {
        release = resolve;
    });
    paygEmailPreflightTestBarrier = { markReached, waitForRelease };
    return Object.freeze({ reached, release });
}
async function maybePausePaygEmailPreflightForTest() {
    const barrier = paygEmailPreflightTestBarrier;
    if (!barrier)
        return;
    paygEmailPreflightTestBarrier = null;
    barrier.markReached();
    await barrier.waitForRelease;
}
function pauseNextPaygEmailFailureAfterReads() {
    if (!isFirebaseFunctionsEmulatorProcess()) {
        throw new Error("PAYG email failure read pause is emulator-only.");
    }
    if (paygEmailFailureAfterReadsTestBarrier !== null) {
        throw new Error("A PAYG email failure read pause is already active.");
    }
    let markReached;
    let release;
    const reached = new Promise((resolve) => {
        markReached = resolve;
    });
    const waitForRelease = new Promise((resolve) => {
        release = resolve;
    });
    paygEmailFailureAfterReadsTestBarrier = { markReached, waitForRelease };
    return Object.freeze({ reached, release });
}
async function maybePausePaygEmailFailureAfterReadsForTest() {
    const barrier = paygEmailFailureAfterReadsTestBarrier;
    if (!barrier)
        return;
    paygEmailFailureAfterReadsTestBarrier = null;
    barrier.markReached();
    await barrier.waitForRelease;
}
function paygOutboxPrivacyClosureReason(outbox, nowMillis) {
    if (hasNonNullDocumentField(outbox, "piiRedactedAt")) {
        return "retention_expired";
    }
    const deadline = timestampMillis(outbox.get(exports.PAYG_PII_RETENTION_CUTOFF_FIELD));
    if (deadline === null)
        return "retention_deadline_missing";
    return deadline <= nowMillis ? "retention_expired" : null;
}
function redactAndTombstonePaygOutbox(tx, outbox, reason, auditUpdate = {}) {
    var _a, _b;
    tx.set(outbox.ref, Object.assign(Object.assign({ status: "tombstoned", deliveryStateBeforeTombstone: (_b = (_a = outbox.get("deliveryStateBeforeTombstone")) !== null && _a !== void 0 ? _a : outbox.get("status")) !== null && _b !== void 0 ? _b : null, tombstoneReason: `pii_${reason}`, tombstonedAt: serverTimestamp() }, auditUpdate), { 
        // These fields can contain guest PII. Privacy closure always wins over a
        // stale worker payload, including an expired or malformed legacy lease.
        to: firestore_1.FieldValue.delete(), templateData: firestore_1.FieldValue.delete(), lastError: firestore_1.FieldValue.delete(), [exports.PAYG_PII_REDACTION_RETRY_FIELD]: firestore_1.FieldValue.delete(), piiRedactAt: firestore_1.FieldValue.delete(), piiRedactedAt: serverTimestamp(), piiRedactionReason: reason, piiRedactionDeferredAt: firestore_1.FieldValue.delete(), piiRedactionDeferredReason: firestore_1.FieldValue.delete(), piiRedactionLastFailedAt: firestore_1.FieldValue.delete(), leaseToken: firestore_1.FieldValue.delete(), leaseExpiresAt: firestore_1.FieldValue.delete(), nextAttemptAt: firestore_1.FieldValue.delete(), tombstonedLeaseCorrelation: firestore_1.FieldValue.delete(), ambiguousLeaseCorrelation: firestore_1.FieldValue.delete(), reconcileAfterStateChange: firestore_1.FieldValue.delete(), updatedAt: serverTimestamp() }), { merge: true });
}
function redactOrDeferActivePaygSiblingOutbox(tx, outbox, reason, nowMillis) {
    const privacyAlreadyClosed = hasNonNullDocumentField(outbox, "piiRedactedAt");
    const cutoff = timestampMillis(outbox.get(exports.PAYG_PII_RETENTION_CUTOFF_FIELD));
    const leaseStartedAt = timestampMillis(outbox.get("lastAttemptAt"));
    const leaseExpiresAt = timestampMillis(outbox.get("leaseExpiresAt"));
    // A worker that acquired a valid lease before the approved cutoff may have
    // already handed the message to the provider. Preserve that lease until the
    // worker records the provider result; its own completion path immediately
    // redacts the payload. Missing cutoff evidence or an already-closed privacy
    // record can never authorize this short deferral.
    if (!privacyAlreadyClosed && cutoff !== null && cutoff <= nowMillis &&
        isActivePaygEmailLease({
            status: outbox.get("status"),
            leaseToken: outbox.get("leaseToken"),
            leaseStartedAtMillis: leaseStartedAt,
            leaseExpiresAtMillis: leaseExpiresAt,
            retentionCutoffAtMillis: cutoff,
            nowMillis,
        })) {
        tx.set(outbox.ref, {
            [exports.PAYG_PII_REDACTION_RETRY_FIELD]: firestore_1.Timestamp.fromMillis(leaseExpiresAt),
            piiRedactionDeferredAt: serverTimestamp(),
            piiRedactionDeferredReason: "active_email_lease",
            updatedAt: serverTimestamp(),
        }, { merge: true });
        return;
    }
    redactAndTombstonePaygOutbox(tx, outbox, reason);
}
function paygEmailOrderProjection(kind) {
    switch (kind) {
        case "payg_guest_confirmation":
            return Object.freeze({
                status: "confirmationEmailStatus",
                error: "confirmationEmailError",
                sentAt: "confirmationEmailSentAt",
                providerId: "confirmationEmailProviderId",
            });
        case "payg_guest_confirmation_correction":
            return Object.freeze({
                status: "confirmationCorrectionEmailStatus",
                error: "confirmationCorrectionEmailError",
                sentAt: "confirmationCorrectionEmailSentAt",
                providerId: "confirmationCorrectionEmailProviderId",
            });
        case "payg_guest_refund_confirmation":
            return Object.freeze({
                status: "refundEmailStatus",
                error: "refundEmailError",
                sentAt: "refundEmailSentAt",
                providerId: "refundEmailProviderId",
            });
        case "payg_guest_dispute_notice":
            return Object.freeze({
                status: "disputeEmailStatus",
                error: "disputeEmailError",
                sentAt: "disputeEmailSentAt",
                providerId: "disputeEmailProviderId",
            });
    }
}
function paygOrderEmailStatusUpdate(kind, status, error = null) {
    const projection = paygEmailOrderProjection(kind);
    return {
        [projection.status]: status,
        [projection.error]: error === null ? firestore_1.FieldValue.delete() : error,
    };
}
function paygUndeliverableOrderEmailUpdate(kind) {
    return kind === "payg_guest_refund_confirmation" ||
        kind === "payg_guest_dispute_notice" ?
        paygOrderEmailStatusUpdate(kind, "manual_review", "provider_binding_mismatch") : paygOrderEmailStatusUpdate(kind, "not_required");
}
function paygOrderEmailSentUpdate(kind, providerMessageId) {
    const projection = paygEmailOrderProjection(kind);
    return {
        [projection.status]: "sent",
        [projection.sentAt]: serverTimestamp(),
        [projection.providerId]: providerMessageId,
        [projection.error]: firestore_1.FieldValue.delete(),
    };
}
function paygPrivacyClosedOrderEmailUpdate(kind) {
    return kind === "payg_guest_confirmation" ||
        kind === "payg_guest_confirmation_correction" ||
        kind === "payg_guest_refund_confirmation" ||
        kind === "payg_guest_dispute_notice" ?
        paygOrderEmailStatusUpdate(kind, "not_required") : {};
}
function paygEmailRetryAt(attemptCount, nowMillis) {
    const delay = Math.min(60, 5 * Math.pow(2, Math.max(0, attemptCount - 1)));
    return nowMillis + delay * 60 * 1000;
}
function validPaygOutboxPayload(outboxId, value) {
    if (!value || typeof value !== "object")
        return false;
    const payload = value;
    const common = payload.schemaVersion === exports.PAYG_SCHEMA_VERSION &&
        typeof payload.orderId === "string" &&
        /^payg_[a-f0-9]{64}$/.test(payload.orderId) &&
        Array.isArray(payload.to) && payload.to.length === 1 &&
        typeof payload.to[0] === "string" &&
        payload.templateData && typeof payload.templateData === "object";
    if (!common)
        return false;
    if (payload.kind === "payg_guest_confirmation") {
        return payload.orderId === outboxId &&
            payload.idempotencyKey === `payg-confirmation/${payload.orderId}/v1` &&
            payload.templateData.amountPence === exports.PAYG_AMOUNT_PENCE &&
            payload.templateData.currency === exports.PAYG_CURRENCY &&
            validPaygConfirmationLegalAcceptance(payload.templateData.legalAcceptance) &&
            typeof payload.templateData.cancellationUrl === "string" &&
            payload.templateData.cancellationUrl.includes("/pay-as-you-go/cancel?token=");
    }
    const lifecycleCommon = payload.templateData.amountPence ===
        exports.PAYG_AMOUNT_PENCE &&
        payload.templateData.currency === exports.PAYG_CURRENCY &&
        typeof payload.templateData.attendeeName === "string" &&
        validPaygLifecycleClass(payload.templateData.class);
    if (payload.kind === "payg_guest_confirmation_correction") {
        return payload.outboxId === outboxId &&
            outboxId === paygConfirmationCorrectionOutboxId(payload.orderId) &&
            payload.idempotencyKey ===
                `payg-confirmation-correction/${payload.orderId}/v1` &&
            shouldEnqueuePaygConfirmationCorrection(payload.templateData.orderStatus) &&
            lifecycleCommon;
    }
    const validPaymentIntentId = typeof payload.templateData.paymentIntentId ===
        "string" && /^pi_[A-Za-z0-9_]{4,252}$/.test(payload.templateData.paymentIntentId);
    const validChargeId = typeof payload.templateData.chargeId === "string" &&
        /^ch_[A-Za-z0-9_]{4,252}$/.test(payload.templateData.chargeId);
    if (!lifecycleCommon || !validPaymentIntentId || !validChargeId)
        return false;
    if (payload.kind === "payg_guest_refund_confirmation") {
        const refundId = payload.templateData.refundId;
        return payload.outboxId === outboxId &&
            outboxId === paygRefundOutboxId(payload.orderId) &&
            payload.idempotencyKey ===
                `payg-refund-confirmed/${payload.orderId}/v1` &&
            typeof refundId === "string" &&
            /^re_[A-Za-z0-9_]{4,252}$/.test(refundId);
    }
    return payload.kind === "payg_guest_dispute_notice" &&
        payload.outboxId === outboxId &&
        outboxId === paygDisputeOutboxId(payload.orderId) &&
        payload.idempotencyKey ===
            `payg-dispute-detected/${payload.orderId}/v1` &&
        typeof payload.templateData.disputeId === "string" &&
        /^du_[A-Za-z0-9_]{4,252}$/.test(payload.templateData.disputeId);
}
function paygOutboxPayloadValue(outbox) {
    return {
        schemaVersion: outbox.get("schemaVersion"),
        kind: outbox.get("kind"),
        orderId: outbox.get("orderId"),
        outboxId: outbox.get("outboxId"),
        idempotencyKey: outbox.get("idempotencyKey"),
        to: outbox.get("to"),
        templateData: outbox.get("templateData"),
    };
}
function shouldSuppressPaygConfirmationCorrectionForLifecycle(input) {
    if (input.status !== "pending" && input.status !== "sending" &&
        input.status !== "reconciling" && input.status !== "sent")
        return false;
    if (!validPaygOutboxPayload(input.outboxId, input.payload))
        return false;
    if (input.payload.kind !== "payg_guest_refund_confirmation" &&
        input.payload.kind !== "payg_guest_dispute_notice")
        return false;
    return isPaygLifecycleEmailBindingValid(input.payload, input.order);
}
async function acquirePaygEmailLease(outboxId, nowMillis, leaseToken = (0, crypto_1.randomUUID)()) {
    const outboxRef = db().collection("paygEmailOutbox").doc(outboxId);
    return db().runTransaction(async (tx) => {
        const outbox = await tx.get(outboxRef);
        if (!outbox.exists)
            return { state: "missing" };
        const effectiveNow = Math.max(nowMillis, Date.now());
        const privacyClosure = paygOutboxPrivacyClosureReason(outbox, effectiveNow);
        if (privacyClosure !== null) {
            const orderId = outbox.get("orderId");
            const orderRef = typeof orderId === "string" &&
                /^payg_[a-f0-9]{64}$/.test(orderId) ?
                db().collection("paygOrders").doc(orderId) : null;
            const order = orderRef ? await tx.get(orderRef) : null;
            redactAndTombstonePaygOutbox(tx, outbox, privacyClosure);
            if (orderRef && (order === null || order === void 0 ? void 0 : order.exists) &&
                order.get("purchaseKind") === exports.PAYG_PURCHASE_KIND &&
                order.get("orderId") === orderId) {
                tx.set(orderRef, Object.assign(Object.assign({}, paygPrivacyClosedOrderEmailUpdate(outbox.get("kind"))), { updatedAt: serverTimestamp() }), { merge: true });
            }
            return { state: "terminal" };
        }
        const rawPayload = paygOutboxPayloadValue(outbox);
        if (!validPaygOutboxPayload(outboxId, rawPayload)) {
            const reason = "PAYG email outbox payload is missing or invalid.";
            tx.set(outboxRef, {
                status: "dead_letter",
                deadLetterReason: reason,
                deadLetteredAt: serverTimestamp(),
                nextAttemptAt: firestore_1.FieldValue.delete(),
                updatedAt: serverTimestamp(),
            }, { merge: true });
            return { state: "terminal" };
        }
        const payload = rawPayload;
        const orderRef = db().collection("paygOrders").doc(payload.orderId);
        const order = await tx.get(orderRef);
        if (!order.exists || order.get("purchaseKind") !== exports.PAYG_PURCHASE_KIND ||
            order.get("orderId") !== payload.orderId) {
            tx.set(outboxRef, {
                status: "manual_review",
                deadLetterReason: "PAYG email outbox has no matching order.",
                deadLetteredAt: serverTimestamp(),
                nextAttemptAt: firestore_1.FieldValue.delete(),
                updatedAt: serverTimestamp(),
            }, { merge: true });
            return { state: "terminal" };
        }
        const orderPiiDeadline = timestampMillis(order.get(exports.PAYG_PII_RETENTION_CUTOFF_FIELD));
        if (hasNonNullDocumentField(order, "piiRedactedAt") ||
            orderPiiDeadline === null || orderPiiDeadline <= effectiveNow) {
            const privacyClosure = orderPiiDeadline !== null ||
                hasNonNullDocumentField(order, "piiRedactedAt") ?
                "retention_expired" : "retention_deadline_missing";
            redactAndTombstonePaygOutbox(tx, outbox, privacyClosure);
            tx.set(orderRef, Object.assign(Object.assign({}, paygPrivacyClosedOrderEmailUpdate(payload.kind)), { updatedAt: serverTimestamp() }), { merge: true });
            return { state: "terminal" };
        }
        const orderStatus = order.get("status");
        const status = outbox.get("status");
        const reconcileAfterStateChange = shouldRecoverPaygConfirmationAcceptance({
            kind: payload.kind,
            status,
            providerAcceptanceState: outbox.get("providerAcceptanceState"),
            tombstonedLeaseCorrelation: outbox.get("tombstonedLeaseCorrelation"),
        });
        const deliverable = isPaygEmailPayloadDeliverable(payload, order);
        if (!deliverable && !reconcileAfterStateChange) {
            tombstonePaygConfirmation(tx, outbox, `order_${String(orderStatus)}`);
            tx.set(orderRef, Object.assign(Object.assign({}, paygUndeliverableOrderEmailUpdate(payload.kind)), { updatedAt: serverTimestamp() }), { merge: true });
            return { state: "terminal" };
        }
        if (status === "sent") {
            const orderEmailField = paygEmailOrderProjection(payload.kind).status;
            if (order.get(orderEmailField) !== "sent") {
                tx.set(orderRef, {
                    [orderEmailField]: "sent",
                    updatedAt: serverTimestamp(),
                }, { merge: true });
            }
            return { state: "sent" };
        }
        if (status === "manual_review" || status === "dead_letter" ||
            (status === "tombstoned" && !reconcileAfterStateChange)) {
            return { state: "terminal" };
        }
        const leaseExpiresAt = timestampMillis(outbox.get("leaseExpiresAt"));
        if ((status === "sending" || status === "reconciling") &&
            leaseExpiresAt !== null &&
            leaseExpiresAt > nowMillis)
            return { state: "in_progress" };
        const nextAttemptAt = timestampMillis(outbox.get("nextAttemptAt"));
        if ((status === "pending" || reconcileAfterStateChange) &&
            nextAttemptAt !== null && nextAttemptAt > nowMillis) {
            return { state: "deferred" };
        }
        const retryDeadlineAt = timestampMillis(outbox.get("retryDeadlineAt"));
        if (retryDeadlineAt !== null && nowMillis >= retryDeadlineAt) {
            const reason = "Resend idempotency window expired before PAYG email delivery.";
            tx.set(outboxRef, {
                status: "manual_review",
                deadLetterReason: reason,
                deadLetteredAt: serverTimestamp(),
                leaseToken: firestore_1.FieldValue.delete(),
                leaseExpiresAt: firestore_1.FieldValue.delete(),
                nextAttemptAt: firestore_1.FieldValue.delete(),
                updatedAt: serverTimestamp(),
            }, { merge: true });
            tx.set(orderRef, Object.assign(Object.assign({}, (reconcileAfterStateChange ? {
                confirmationEmailStatus: "not_required",
                confirmationCorrectionEmailStatus: "manual_review",
                confirmationAcceptanceState: "manual_review",
            } : paygOrderEmailStatusUpdate(payload.kind, "manual_review", reason))), { updatedAt: serverTimestamp() }), { merge: true });
            console.error("CRITICAL_BILLING_PAYG_CONFIRMATION_MANUAL_REVIEW", {
                orderId: payload.orderId,
                reason,
            });
            return { state: "terminal" };
        }
        const attemptCount = typeof outbox.get("attemptCount") === "number" ?
            Number(outbox.get("attemptCount")) : 0;
        const firstAttemptAt = timestampMillis(outbox.get("firstAttemptAt"));
        tx.set(outboxRef, Object.assign(Object.assign(Object.assign(Object.assign({ status: reconcileAfterStateChange ? "reconciling" : "sending", leaseToken, leaseExpiresAt: firestore_1.Timestamp.fromMillis(effectiveNow + PAYG_EMAIL_LEASE_MS), nextAttemptAt: firestore_1.Timestamp.fromMillis(effectiveNow + PAYG_EMAIL_LEASE_MS) }, (reconcileAfterStateChange ? {
            providerAcceptanceState: "unknown_in_flight",
            reconcileAfterStateChange: true,
            tombstonedLeaseCorrelation: paygEmailLeaseCorrelation(leaseToken),
        } : {})), { attemptCount: attemptCount + 1, lastAttemptAt: serverTimestamp() }), (firstAttemptAt === null ? {
            firstAttemptAt: firestore_1.Timestamp.fromMillis(effectiveNow),
            retryDeadlineAt: firestore_1.Timestamp.fromMillis(effectiveNow + PAYG_EMAIL_RETRY_WINDOW_MS),
        } : {})), { updatedAt: serverTimestamp() }), { merge: true });
        return {
            state: "acquired",
            outboxId,
            orderId: payload.orderId,
            leaseToken,
            attemptCount: attemptCount + 1,
            payload,
            idempotencyKey: payload.idempotencyKey,
            reconcileAfterStateChange,
        };
    });
}
class PaygEmailDeliveryError extends Error {
    constructor(message, status, providerErrorName) {
        super(message);
        this.status = status;
        this.providerErrorName = providerErrorName;
    }
}
async function sendPaygEmailViaResend(email, idempotencyKey) {
    const apiKey = resendApiKey.value().trim();
    if (!apiKey) {
        throw new PaygEmailDeliveryError("RESEND_API_KEY is not configured.", null, "missing_api_key");
    }
    const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
            "User-Agent": "AlphaWOD-payg/1.0",
        },
        body: JSON.stringify(email),
        signal: AbortSignal.timeout(20000),
    });
    const body = await response.text();
    if (!response.ok) {
        let name = null;
        let message = body;
        try {
            const parsed = JSON.parse(body);
            name = typeof parsed.name === "string" ? parsed.name : null;
            message = typeof parsed.message === "string" ? parsed.message : body;
        }
        catch (_a) {
            // Keep the non-JSON provider response as bounded diagnostic context.
        }
        throw new PaygEmailDeliveryError((message || response.statusText || `Resend returned ${response.status}.`).slice(0, 1000), response.status, name);
    }
    try {
        const parsed = JSON.parse(body);
        return typeof parsed.id === "string" ? parsed.id : null;
    }
    catch (_b) {
        return null;
    }
}
async function processPaygConfirmationOutbox(outboxId, nowMillis, sender = sendPaygEmailViaResend) {
    const lease = await acquirePaygEmailLease(outboxId, nowMillis);
    if (lease.state !== "acquired")
        return lease.state;
    await maybePausePaygEmailPreflightForTest();
    const outboxRef = db().collection("paygEmailOutbox").doc(outboxId);
    const orderRef = db().collection("paygOrders").doc(lease.orderId);
    const preflight = await db().runTransaction(async (tx) => {
        const [outbox, order] = await Promise.all([
            tx.get(outboxRef),
            tx.get(orderRef),
        ]);
        const expectedStatus = lease.reconcileAfterStateChange ?
            "reconciling" : "sending";
        if (!outbox.exists || outbox.get("status") !== expectedStatus ||
            outbox.get("leaseToken") !== lease.leaseToken)
            return "lost";
        const matchingOrder = order.exists &&
            order.get("purchaseKind") === exports.PAYG_PURCHASE_KIND &&
            order.get("orderId") === lease.orderId;
        const privacyClosure = paygOutboxPrivacyClosureReason(outbox, Math.max(nowMillis, Date.now()));
        if (privacyClosure !== null) {
            redactAndTombstonePaygOutbox(tx, outbox, privacyClosure);
            if (matchingOrder) {
                tx.set(orderRef, Object.assign(Object.assign({}, paygPrivacyClosedOrderEmailUpdate(lease.payload.kind)), { updatedAt: serverTimestamp() }), { merge: true });
            }
            return "terminal";
        }
        const preflightNow = Math.max(nowMillis, Date.now());
        const orderPiiDeadline = matchingOrder ? timestampMillis(order.get(exports.PAYG_PII_RETENTION_CUTOFF_FIELD)) : null;
        const orderPrivacyClosed = matchingOrder &&
            (hasNonNullDocumentField(order, "piiRedactedAt") ||
                orderPiiDeadline === null || orderPiiDeadline <= preflightNow);
        if (orderPrivacyClosed) {
            const orderPrivacyClosure = orderPiiDeadline !== null ||
                hasNonNullDocumentField(order, "piiRedactedAt") ?
                "retention_expired" : "retention_deadline_missing";
            redactAndTombstonePaygOutbox(tx, outbox, orderPrivacyClosure);
            tx.set(orderRef, Object.assign(Object.assign({}, paygPrivacyClosedOrderEmailUpdate(lease.payload.kind)), { updatedAt: serverTimestamp() }), { merge: true });
            return "terminal";
        }
        const currentlyDeliverable = matchingOrder && isPaygEmailPayloadDeliverable(lease.payload, order);
        if (!matchingOrder || (!lease.reconcileAfterStateChange &&
            !currentlyDeliverable)) {
            tombstonePaygConfirmation(tx, outbox, `order_${String(order.exists ? order.get("status") : "missing")}`);
            if (matchingOrder) {
                tx.set(orderRef, Object.assign(Object.assign({}, paygUndeliverableOrderEmailUpdate(lease.payload.kind)), { updatedAt: serverTimestamp() }), { merge: true });
            }
            return "terminal";
        }
        return "send";
    });
    if (preflight !== "send") {
        return preflight === "terminal" ? "terminal" : "in_progress";
    }
    let providerAccepted = false;
    try {
        const email = buildPaygOutboxEmail(lease.payload, paygFromEmail.value(), paygReplyToEmail.value());
        const providerMessageId = await sender(email, lease.idempotencyKey);
        providerAccepted = true;
        const persistProviderAcceptance = () => db().runTransaction(async (tx) => {
            const correctionRef = lease.payload.kind === "payg_guest_confirmation" ?
                db().collection("paygEmailOutbox").doc(paygConfirmationCorrectionOutboxId(lease.orderId)) : null;
            const refundNoticeRef = lease.payload.kind === "payg_guest_confirmation" ?
                db().collection("paygEmailOutbox").doc(paygRefundOutboxId(lease.orderId)) : null;
            const disputeNoticeRef = lease.payload.kind === "payg_guest_confirmation" ?
                db().collection("paygEmailOutbox").doc(paygDisputeOutboxId(lease.orderId)) : null;
            const [outbox, order, correction, refundNotice, disputeNotice] = await Promise.all([
                tx.get(outboxRef),
                tx.get(orderRef),
                correctionRef ? tx.get(correctionRef) : Promise.resolve(null),
                refundNoticeRef ? tx.get(refundNoticeRef) : Promise.resolve(null),
                disputeNoticeRef ? tx.get(disputeNoticeRef) : Promise.resolve(null),
            ]);
            if (!outbox.exists)
                return "lost";
            const orderStatus = order.exists ?
                order.get("status") : null;
            const decision = lease.payload.kind === "payg_guest_confirmation" ?
                resolvePaygConfirmationPostSend({
                    outboxStatus: outbox.get("status"),
                    activeLeaseToken: outbox.get("leaseToken"),
                    tombstonedLeaseCorrelation: outbox.get("tombstonedLeaseCorrelation"),
                    leaseToken: lease.leaseToken,
                    orderStatus,
                    correctionExists: Boolean((correction === null || correction === void 0 ? void 0 : correction.exists) || (order.exists && (refundNotice === null || refundNotice === void 0 ? void 0 : refundNotice.exists) &&
                        shouldSuppressPaygConfirmationCorrectionForLifecycle({
                            outboxId: refundNotice.id,
                            status: refundNotice.get("status"),
                            payload: paygOutboxPayloadValue(refundNotice),
                            order: order.data(),
                        })) || (order.exists && (disputeNotice === null || disputeNotice === void 0 ? void 0 : disputeNotice.exists) &&
                        shouldSuppressPaygConfirmationCorrectionForLifecycle({
                            outboxId: disputeNotice.id,
                            status: disputeNotice.get("status"),
                            payload: paygOutboxPayloadValue(disputeNotice),
                            order: order.data(),
                        }))),
                }) : outbox.get("status") === "sending" &&
                outbox.get("leaseToken") === lease.leaseToken ? Object.freeze({
                disposition: order.exists &&
                    isPaygEmailPayloadDeliverable(lease.payload, order) ?
                    "sent" : "accepted_after_state_change",
                enqueueCorrection: false,
            }) : Object.freeze({
                disposition: "lost",
                enqueueCorrection: false,
            });
            if (decision.disposition === "lost")
                return "lost";
            const acceptanceNow = Date.now();
            const outboxPrivacyClosure = paygOutboxPrivacyClosureReason(outbox, acceptanceNow);
            const orderPiiDeadline = order.exists ? timestampMillis(order.get(exports.PAYG_PII_RETENTION_CUTOFF_FIELD)) : null;
            const orderPrivacyClosed = !order.exists || orderPiiDeadline === null ||
                hasNonNullDocumentField(order, "piiRedactedAt") ||
                orderPiiDeadline <= acceptanceNow;
            if (outboxPrivacyClosure !== null || orderPrivacyClosed) {
                const privacyClosure = outboxPrivacyClosure !== null && outboxPrivacyClosure !== void 0 ? outboxPrivacyClosure : (order.exists && (hasNonNullDocumentField(order, "piiRedactedAt") ||
                    (orderPiiDeadline !== null && orderPiiDeadline <= acceptanceNow)) ?
                    "retention_expired" : "retention_deadline_missing");
                const acceptedAfterStateChange = decision.disposition === "accepted_after_state_change";
                redactAndTombstonePaygOutbox(tx, outbox, privacyClosure, Object.assign({ deliveryStateBeforeTombstone: "sent", deliveredAfterStateChange: acceptedAfterStateChange ||
                        firestore_1.FieldValue.delete(), providerAcceptanceState: acceptedAfterStateChange ?
                        "accepted_after_state_change" : "accepted", providerMessageId, providerAcceptedAt: serverTimestamp(), acceptedLeaseCorrelation: paygEmailLeaseCorrelation(lease.leaseToken) }, (acceptedAfterStateChange ? {} : {
                    sentAt: serverTimestamp(),
                })));
                if (correctionRef && (correction === null || correction === void 0 ? void 0 : correction.exists)) {
                    redactOrDeferActivePaygSiblingOutbox(tx, correction, privacyClosure, acceptanceNow);
                }
                if (refundNoticeRef && (refundNotice === null || refundNotice === void 0 ? void 0 : refundNotice.exists)) {
                    redactOrDeferActivePaygSiblingOutbox(tx, refundNotice, privacyClosure, acceptanceNow);
                }
                if (disputeNoticeRef && (disputeNotice === null || disputeNotice === void 0 ? void 0 : disputeNotice.exists)) {
                    redactOrDeferActivePaygSiblingOutbox(tx, disputeNotice, privacyClosure, acceptanceNow);
                }
                if (order.exists) {
                    const privacyOrderEmailUpdate = lease.payload.kind ===
                        "payg_guest_confirmation" ? acceptedAfterStateChange ? {
                        confirmationEmailStatus: "not_required",
                        confirmationAcceptedAfterStateChange: true,
                        confirmationCorrectionEmailStatus: "not_required",
                    } : {
                        confirmationEmailStatus: "sent",
                        confirmationEmailSentAt: serverTimestamp(),
                        confirmationEmailProviderId: providerMessageId,
                        confirmationEmailError: firestore_1.FieldValue.delete(),
                        confirmationCorrectionEmailStatus: "not_required",
                    } : lease.payload.kind ===
                        "payg_guest_confirmation_correction" ?
                        acceptedAfterStateChange ? {
                            confirmationCorrectionEmailStatus: "not_required",
                            confirmationCorrectionAcceptedAfterStateChange: true,
                        } : {
                            confirmationCorrectionEmailStatus: "sent",
                            confirmationCorrectionEmailSentAt: serverTimestamp(),
                            confirmationCorrectionEmailProviderId: providerMessageId,
                            confirmationCorrectionEmailError: firestore_1.FieldValue.delete(),
                        } : acceptedAfterStateChange ?
                        paygOrderEmailStatusUpdate(lease.payload.kind, "not_required") : paygOrderEmailSentUpdate(lease.payload.kind, providerMessageId);
                    tx.set(orderRef, Object.assign(Object.assign({}, privacyOrderEmailUpdate), { updatedAt: serverTimestamp() }), { merge: true });
                }
                return acceptedAfterStateChange ?
                    "state_changed" : "sent";
            }
            if (decision.disposition === "accepted_after_state_change") {
                let correctionOutboxId = (correction === null || correction === void 0 ? void 0 : correction.exists) ? correction.id : null;
                if (decision.enqueueCorrection && correctionRef && orderStatus !== null &&
                    shouldEnqueuePaygConfirmationCorrection(orderStatus) &&
                    lease.payload.kind === "payg_guest_confirmation" &&
                    orderPiiDeadline !== null && orderPiiDeadline > acceptanceNow) {
                    const correctionPayload = buildPaygConfirmationCorrectionOutboxPayload({
                        orderId: lease.orderId,
                        recipientEmail: lease.payload.to[0],
                        attendeeName: lease.payload.templateData.attendeeName,
                        class: lease.payload.templateData.class,
                        orderStatus,
                    });
                    tx.create(correctionRef, Object.assign(Object.assign({}, correctionPayload), { status: "pending", attemptCount: 0, nextAttemptAt: serverTimestamp(), piiRetentionCutoffAt: firestore_1.Timestamp.fromMillis(orderPiiDeadline), piiRedactionRetryAt: firestore_1.Timestamp.fromMillis(orderPiiDeadline), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
                    correctionOutboxId = correctionRef.id;
                }
                tx.set(outboxRef, Object.assign(Object.assign({ status: "tombstoned", deliveredAfterStateChange: true, providerAcceptanceState: "accepted_after_state_change", providerMessageId, providerAcceptedAt: serverTimestamp(), acceptedLeaseCorrelation: paygEmailLeaseCorrelation(lease.leaseToken), tombstonedLeaseCorrelation: firestore_1.FieldValue.delete(), ambiguousLeaseCorrelation: firestore_1.FieldValue.delete(), reconcileAfterStateChange: firestore_1.FieldValue.delete(), leaseToken: firestore_1.FieldValue.delete(), leaseExpiresAt: firestore_1.FieldValue.delete(), nextAttemptAt: firestore_1.FieldValue.delete() }, (correctionOutboxId ? { correctionOutboxId } : {})), { updatedAt: serverTimestamp() }), { merge: true });
                if (order.exists) {
                    const stateChangedOrderEmailUpdate = lease.payload.kind ===
                        "payg_guest_confirmation" ? Object.assign({ confirmationEmailStatus: "not_required", confirmationAcceptedAfterStateChange: true, confirmationCorrectionEmailStatus: (correction === null || correction === void 0 ? void 0 : correction.exists) ?
                            correction.get("status") : correctionOutboxId ? "pending" :
                            "not_required" }, (correctionOutboxId ? {
                        confirmationCorrectionOutboxId: correctionOutboxId,
                    } : {})) : lease.payload.kind ===
                        "payg_guest_confirmation_correction" ? {
                        confirmationCorrectionEmailStatus: "not_required",
                        confirmationCorrectionAcceptedAfterStateChange: true,
                    } : paygOrderEmailStatusUpdate(lease.payload.kind, "not_required");
                    tx.set(orderRef, Object.assign(Object.assign({}, stateChangedOrderEmailUpdate), { updatedAt: serverTimestamp() }), { merge: true });
                }
                return "state_changed";
            }
            tx.set(outboxRef, {
                status: "sent",
                providerAcceptanceState: "accepted",
                sentAt: serverTimestamp(),
                providerMessageId,
                leaseToken: firestore_1.FieldValue.delete(),
                leaseExpiresAt: firestore_1.FieldValue.delete(),
                nextAttemptAt: firestore_1.FieldValue.delete(),
                tombstonedLeaseCorrelation: firestore_1.FieldValue.delete(),
                ambiguousLeaseCorrelation: firestore_1.FieldValue.delete(),
                reconcileAfterStateChange: firestore_1.FieldValue.delete(),
                lastError: firestore_1.FieldValue.delete(),
                updatedAt: serverTimestamp(),
            }, { merge: true });
            tx.set(orderRef, Object.assign(Object.assign({}, paygOrderEmailSentUpdate(lease.payload.kind, providerMessageId)), { updatedAt: serverTimestamp() }), { merge: true });
            return "sent";
        });
        let marked;
        try {
            marked = await persistProviderAcceptance();
        }
        catch (error) {
            // Resend has already accepted this idempotent delivery. Retry only the
            // Firestore convergence step so a transient commit/ack failure can never
            // be misclassified as a provider rejection.
            console.error("PAYG provider acceptance persistence retry", {
                orderId: lease.orderId,
                error: error instanceof Error ? error.message.slice(0, 500) :
                    String(error).slice(0, 500),
            });
            marked = await persistProviderAcceptance();
        }
        if (marked === "state_changed") {
            console.error("CRITICAL_BILLING_PAYG_CONFIRMATION_SENT_AFTER_STATE_CHANGE", {
                orderId: lease.orderId,
                providerMessageId,
            });
            return "sent";
        }
        return marked === "sent" ? "sent" : "in_progress";
    }
    catch (error) {
        if (providerAccepted) {
            // Do not write a false `providerRejectedAfterStateChange` marker after an
            // accepted delivery. The lease/idempotency key remains available for a
            // safe worker replay when the active outbox has not been tombstoned.
            console.error("CRITICAL_PAYG_PROVIDER_ACCEPTANCE_PERSISTENCE_FAILED", {
                orderId: lease.orderId,
                error: error instanceof Error ? error.message.slice(0, 500) :
                    String(error).slice(0, 500),
            });
            return "systemic_failure";
        }
        const status = error instanceof PaygEmailDeliveryError ? error.status : null;
        const providerName = error instanceof PaygEmailDeliveryError ?
            error.providerErrorName : null;
        const message = (error instanceof Error ? error.message : String(error))
            .replace(/[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+/g, "[redacted-email]")
            .slice(0, 1000);
        const failureNow = Math.max(nowMillis, Date.now());
        const permanent = status === 400 || status === 404 || status === 422;
        const systemic = status === 401 || status === 403 || status === 429 ||
            providerName === "missing_api_key";
        const ambiguous = isPaygEmailFailureAmbiguous(status, providerName);
        const outcome = await db().runTransaction(async (tx) => {
            const [outbox, order] = await Promise.all([
                tx.get(outboxRef),
                tx.get(orderRef),
            ]);
            await maybePausePaygEmailFailureAfterReadsForTest();
            // Recompute after both transactional reads on every callback attempt.
            // A slow read or Firestore retry that crosses the retention deadline
            // must tombstone PII instead of authorizing a late requeue.
            const transactionFailureNow = Math.max(failureNow, Date.now());
            if (!outbox.exists)
                return null;
            const ownsActiveLease = (outbox.get("status") === "sending" ||
                outbox.get("status") === "reconciling") &&
                outbox.get("leaseToken") === lease.leaseToken;
            const ownsTombstonedLease = lease.payload.kind ===
                "payg_guest_confirmation" && outbox.get("status") === "tombstoned" &&
                outbox.get("tombstonedLeaseCorrelation") ===
                    paygEmailLeaseCorrelation(lease.leaseToken);
            if (!ownsActiveLease && !ownsTombstonedLease)
                return null;
            const outboxPrivacyClosure = paygOutboxPrivacyClosureReason(outbox, transactionFailureNow);
            const orderPiiDeadline = order.exists ? timestampMillis(order.get(exports.PAYG_PII_RETENTION_CUTOFF_FIELD)) : null;
            const orderPrivacyClosed = !order.exists || orderPiiDeadline === null ||
                hasNonNullDocumentField(order, "piiRedactedAt") ||
                orderPiiDeadline <= transactionFailureNow;
            if (outboxPrivacyClosure !== null || orderPrivacyClosed) {
                const privacyClosure = outboxPrivacyClosure !== null && outboxPrivacyClosure !== void 0 ? outboxPrivacyClosure : (order.exists && (hasNonNullDocumentField(order, "piiRedactedAt") ||
                    (orderPiiDeadline !== null &&
                        orderPiiDeadline <= transactionFailureNow)) ?
                    "retention_expired" : "retention_deadline_missing");
                redactAndTombstonePaygOutbox(tx, outbox, privacyClosure, {
                    providerAcceptanceState: ambiguous ?
                        "unknown_at_privacy_deadline" : "rejected",
                    lastHttpStatus: status,
                    lastProviderErrorName: providerName,
                    failedAt: serverTimestamp(),
                });
                if (order.exists) {
                    tx.set(orderRef, Object.assign(Object.assign({}, paygPrivacyClosedOrderEmailUpdate(lease.payload.kind)), { updatedAt: serverTimestamp() }), { merge: true });
                }
                return { terminal: true, privacyExpired: true };
            }
            const failureAfterStateChange = resolvePaygEmailFailureAfterStateChange({
                ownsTombstonedLease,
                reconcileAfterStateChange: lease.reconcileAfterStateChange,
                httpStatus: status,
                providerErrorName: providerName,
            });
            if (failureAfterStateChange === "reconcile_unknown") {
                const retryDeadline = timestampMillis(outbox.get("retryDeadlineAt"));
                const terminal = retryDeadline !== null &&
                    transactionFailureNow >= retryDeadline;
                tx.set(outboxRef, Object.assign(Object.assign({ status: terminal ? "manual_review" : "tombstoned", providerAcceptanceState: terminal ?
                        "manual_review" : "unknown_in_flight", reconcileAfterStateChange: terminal ?
                        firestore_1.FieldValue.delete() : true, tombstonedLeaseCorrelation: terminal ? firestore_1.FieldValue.delete() :
                        paygEmailLeaseCorrelation(lease.leaseToken), ambiguousLeaseCorrelation: firestore_1.FieldValue.delete(), lastError: message, lastHttpStatus: status, lastProviderErrorName: providerName, failedAt: serverTimestamp(), leaseToken: firestore_1.FieldValue.delete(), leaseExpiresAt: firestore_1.FieldValue.delete() }, (terminal ? {
                    deadLetteredAt: serverTimestamp(),
                    nextAttemptAt: firestore_1.FieldValue.delete(),
                } : {
                    nextAttemptAt: firestore_1.Timestamp.fromMillis(paygEmailRetryAt(lease.attemptCount, transactionFailureNow)),
                })), { updatedAt: serverTimestamp() }), { merge: true });
                if (order.exists) {
                    tx.set(orderRef, {
                        confirmationEmailStatus: "not_required",
                        confirmationCorrectionEmailStatus: terminal ?
                            "manual_review" : "pending",
                        confirmationAcceptanceState: terminal ?
                            "manual_review" : "unknown_in_flight",
                        updatedAt: serverTimestamp(),
                    }, { merge: true });
                }
                return { terminal };
            }
            if (!order.exists || !isPaygEmailPayloadDeliverable(lease.payload, order)) {
                tombstonePaygConfirmation(tx, outbox, `order_${String(order.exists ? order.get("status") : "missing")}`);
                tx.set(outboxRef, {
                    providerRejectedAfterStateChange: true,
                    providerAcceptanceState: "rejected_after_state_change",
                    tombstonedLeaseCorrelation: firestore_1.FieldValue.delete(),
                    ambiguousLeaseCorrelation: firestore_1.FieldValue.delete(),
                    leaseToken: firestore_1.FieldValue.delete(),
                    leaseExpiresAt: firestore_1.FieldValue.delete(),
                    nextAttemptAt: firestore_1.FieldValue.delete(),
                    lastError: message,
                    updatedAt: serverTimestamp(),
                }, { merge: true });
                if (order.exists) {
                    tx.set(orderRef, Object.assign(Object.assign({}, paygUndeliverableOrderEmailUpdate(lease.payload.kind)), { updatedAt: serverTimestamp() }), { merge: true });
                }
                return { terminal: true };
            }
            const retryDeadline = timestampMillis(outbox.get("retryDeadlineAt"));
            const terminal = permanent ||
                (retryDeadline !== null && transactionFailureNow >= retryDeadline);
            tx.set(outboxRef, Object.assign(Object.assign({ status: terminal ? "manual_review" : "pending", providerAcceptanceState: terminal ? "manual_review" : ambiguous ?
                    "unknown_in_flight" : "rejected", ambiguousLeaseCorrelation: ambiguous && !terminal ?
                    paygEmailLeaseCorrelation(lease.leaseToken) : firestore_1.FieldValue.delete(), lastError: message, lastHttpStatus: status, lastProviderErrorName: providerName, failedAt: serverTimestamp(), leaseToken: firestore_1.FieldValue.delete(), leaseExpiresAt: firestore_1.FieldValue.delete() }, (terminal ? {
                deadLetteredAt: serverTimestamp(),
                nextAttemptAt: firestore_1.FieldValue.delete(),
            } : {
                nextAttemptAt: firestore_1.Timestamp.fromMillis(paygEmailRetryAt(lease.attemptCount, transactionFailureNow)),
            })), { updatedAt: serverTimestamp() }), { merge: true });
            if (order.exists) {
                tx.set(orderRef, Object.assign(Object.assign({}, paygOrderEmailStatusUpdate(lease.payload.kind, terminal ? "manual_review" : "pending", message.slice(0, 500))), { updatedAt: serverTimestamp() }), { merge: true });
            }
            return { terminal };
        });
        if (outcome === null || outcome === void 0 ? void 0 : outcome.privacyExpired)
            return "terminal";
        if (outcome === null || outcome === void 0 ? void 0 : outcome.terminal) {
            console.error("CRITICAL_BILLING_PAYG_CONFIRMATION_MANUAL_REVIEW", {
                orderId: lease.orderId,
                providerName,
                status,
                error: message,
            });
        }
        else {
            console.error("PAYG confirmation delivery failed", {
                orderId: lease.orderId,
                providerName,
                status,
                error: message,
            });
        }
        return !outcome ? "in_progress" : systemic ? "systemic_failure" : "failed";
    }
}
async function retryDuePaygConfirmations(nowMillis = Date.now(), limit = 50) {
    const due = await db().collection("paygEmailOutbox")
        .where("nextAttemptAt", "<=", firestore_1.Timestamp.fromMillis(nowMillis))
        .orderBy("nextAttemptAt", "asc")
        .limit(limit)
        .get();
    const result = { sent: 0, failed: 0, skipped: 0, systemicFailure: false };
    for (const outbox of due.docs) {
        const outcome = await processPaygConfirmationOutbox(outbox.id, Math.max(nowMillis, Date.now()));
        if (outcome === "sent")
            result.sent += 1;
        else if (outcome === "failed" || outcome === "systemic_failure") {
            result.failed += 1;
        }
        else
            result.skipped += 1;
        if (outcome === "systemic_failure") {
            result.systemicFailure = true;
            break;
        }
    }
    return result;
}
function buildRetryPaygConfirmations() {
    return (0, scheduler_1.onSchedule)({
        region: REGION,
        schedule: "every 5 minutes",
        timeZone: "UTC",
        secrets: exports.PAYG_EMAIL_WORKER_SECRETS,
        timeoutSeconds: 540,
        retryCount: 3,
        minBackoffSeconds: 60,
        maxBackoffSeconds: 300,
    }, async () => {
        assertPaygFirebaseProject();
        const result = await retryDuePaygConfirmations();
        console.log("PAYG confirmation retry result", result);
        if (result.systemicFailure) {
            throw new Error("PAYG confirmation delivery has a systemic failure.");
        }
    });
}
function buildRecoverPaygOperations() {
    return (0, scheduler_1.onSchedule)({
        region: REGION,
        schedule: "every 5 minutes",
        timeZone: "UTC",
        secrets: exports.PAYG_WORKER_SECRETS,
        timeoutSeconds: 540,
    }, async () => {
        assertPaygBillingEnvironment();
        const nowMillis = Date.now();
        const holds = await recoverDuePaygHolds(nowMillis, 50);
        const [refunds, paymentReviewRefunds, attendance] = await Promise.all([
            recoverDuePaygRefunds(nowMillis, 50),
            recoverDuePaygPaymentReviewRefunds(nowMillis, 50),
            recoverDuePaygNoShows(nowMillis, 50),
        ]);
        console.log("PAYG recovery result", {
            holds,
            refunds,
            paymentReviewRefunds,
            attendance,
        });
    });
}
function buildRedactPaygPii() {
    return (0, scheduler_1.onSchedule)({
        region: REGION,
        schedule: "every 60 minutes",
        timeZone: "UTC",
        timeoutSeconds: 540,
        retryCount: 3,
        minBackoffSeconds: 60,
        maxBackoffSeconds: 300,
    }, async () => {
        // Redaction must continue while checkout is closed and does not need
        // Stripe or Resend. Bind only to the configured Firebase data plane.
        assertPaygFirebaseProject();
        const result = await runPaygPiiRedactionSweep();
        console.log("PAYG PII redaction result", result);
        const failures = Object.values(result)
            .reduce((total, item) => total + item.failed, 0);
        if (failures > 0) {
            throw new Error(`PAYG PII redaction failed for ${failures} record(s).`);
        }
    });
}
exports.__testing = Object.freeze({
    buildPaygCheckoutSessionParams,
    buildPaygConfirmationOutboxPayload,
    claimPaygSessionRecovery,
    hasRecoverablePaygIntentPii,
    injectPaygPiiRedactionFailureOnce,
    issuePaygPaymentReviewRefund,
    issuePaygRefund,
    normalizePaygCheckoutRequest,
    paygCheckoutRequestFingerprint,
    paygPiiPromotionMismatch,
    pauseNextPaygEmailFailureAfterReads,
    pauseNextPaygEmailPreflight,
    pauseNextPaygSessionRecoveryAfterRead,
    processPaygConfirmationOutbox,
    recordRecoveredSession,
    recoverPaygHold,
    resolveAgeAtMillis,
    resolvePaygCancellationDecision,
    resolvePaygCatalogueIds,
    sanitizePublicPaygClass,
    signPaygCancellationToken,
    verifyPaygCancellationToken,
});
//# sourceMappingURL=payg.js.map