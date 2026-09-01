/* eslint-disable
  require-jsdoc,
  valid-jsdoc,
  max-len,
  @typescript-eslint/no-explicit-any
*/

/**
 * Public, account-free Pay As You Go class purchases.
 *
 * This domain deliberately does not reuse membership intents, subscriptions,
 * entitlement state, or membership webhook convergence. A short Firestore
 * hold owns one class place while Stripe Checkout is open; successful payment
 * turns that same held place into a guest booking without incrementing
 * capacity a second time.
 */

import {createHash, createHmac, randomUUID, timingSafeEqual} from "crypto";
import {isIP} from "net";
import * as admin from "firebase-admin";
import {
  DocumentReference,
  DocumentSnapshot,
  FieldPath,
  FieldValue,
  Firestore,
  QueryDocumentSnapshot,
  Timestamp,
  Transaction,
} from "firebase-admin/firestore";
import {defineSecret, defineString} from "firebase-functions/params";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {DateTime} from "luxon";
import Stripe from "stripe";
import {
  APPROVED_LIVE_PAYG_CATALOGUE,
  APPROVED_TEST_PAYG_CATALOGUE,
} from "./stripeLiveCatalog";

export const PAYG_SCHEMA_VERSION = 1;
export const PAYG_CHECKOUT_SCHEMA_VERSION = 2;
export const PAYG_OFFERING_KEY = "adult_payg_class" as const;
export const PAYG_PURCHASE_KIND = "payg_class" as const;
export const PAYG_AMOUNT_PENCE = 700;
export const PAYG_CURRENCY = "gbp" as const;
export const PAYG_CANCELLATION_CUTOFF_HOURS = 24;
export const PAYG_HOLD_DURATION_SECONDS = 35 * 60;
export const PAYG_MINIMUM_CHECKOUT_WINDOW_SECONDS = 30 * 60;
export const PAYG_PRODUCT_NAME = "Adult Pay as You Go Class";
export const PAYG_PRICE_ENV_KEY = "STRIPE_PRICE_ADULT_PAYG_CLASS";
export const PAYG_CHECKOUT_RATE_LIMIT_COLLECTION = "paygCheckoutRateLimits";
export const PAYG_CHECKOUT_ADMISSION_COLLECTION = "paygCheckoutAdmissions";
export const PAYG_DUPLICATE_LOCK_COLLECTION = "paygCheckoutLocks";
export const PAYG_PAYMENT_REVIEW_COLLECTION = "paygPaymentReviews";
export const PAYG_UNPAID_INTENT_RETENTION_DAYS = 30;
export const PAYG_ORDER_PII_RETENTION_DAYS = 90;
export const PAYG_WAIVER_PII_RETENTION_DAYS = 2_190;
export const PAYG_UNPAID_INTENT_RETENTION_MS =
  PAYG_UNPAID_INTENT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
export const PAYG_PII_REDACTION_BATCH_SIZE = 50;
export const PAYG_PII_RETENTION_CUTOFF_FIELD = "piiRetentionCutoffAt";
export const PAYG_PII_REDACTION_RETRY_FIELD = "piiRedactionRetryAt";
export const PAYG_INTENT_PII_FIELDS = Object.freeze([
  "attendee",
  "contact",
  "acceptances",
  "requestFingerprint",
  "checkoutSessionUrl",
]);
export const PAYG_ORDER_PII_FIELDS = Object.freeze([
  "attendee",
  "contact",
  "acceptances",
]);
export const PAYG_WAIVER_PII_FIELDS = Object.freeze([
  "attendee",
  "acceptances",
]);
export const PAYG_OUTBOX_PII_FIELDS = Object.freeze([
  "to",
  "templateData",
  "lastError",
]);
export const PAYG_BOOKING_PII_FIELDS = Object.freeze(["userName"]);
export const PAYG_RATE_LIMITS = Object.freeze({
  attemptsPerMinute: 8,
  attemptsPerHour: 24,
});
export const PAYG_IDEMPOTENT_RETRY_POLICY = Object.freeze({
  maxRetriesPerWindow: 5,
  windowMs: 10 * 60 * 1000,
  minimumSpacingMs: 1000,
});
export const PAYG_MAX_CONCURRENT_UNPAID_HOLDS_PER_CLASS = 4;
// Code-owned release evidence. Runtime availability still independently
// requires the legal, catalogue, project and owner-approved policy gates.
export const PAYG_PII_REDACTION_IMPLEMENTED = true;
export const APPROVED_PAYG_STRIPE_CATALOGUE_IDS = Object.freeze({
  test: Object.freeze({
    productId: APPROVED_TEST_PAYG_CATALOGUE.productId,
    priceId: APPROVED_TEST_PAYG_CATALOGUE.priceId,
  }),
  live: Object.freeze({
    productId: APPROVED_LIVE_PAYG_CATALOGUE.productId,
    priceId: APPROVED_LIVE_PAYG_CATALOGUE.priceId,
  }),
}) satisfies Readonly<Record<"test" | "live", PaygCatalogueIds>>;

const REGION = "europe-west1";
const LONDON_TIMEZONE = "Europe/London";
const PRODUCTION_FIREBASE_PROJECT_ID = "alphawod-d1f2f";
const LOCAL_TEST_FIREBASE_PROJECT_ID = "demo-alphawod-stripe";
const MAX_PUBLIC_CLASSES = 250;
export const PAYG_NO_SHOW_REVIEW_DELAY_MS = 6 * 60 * 60 * 1000;

const paygAvailabilityEnabled = defineString("PAYG_AVAILABILITY_ENABLED", {
  default: "false",
});
const paygLegalApproved = defineString("PAYG_LEGAL_APPROVED", {
  default: "false",
});
const paygFirebaseProjectId = defineString("PAYG_FIREBASE_PROJECT_ID", {
  default: "",
});
const stripeExpectedMode = defineString("STRIPE_EXPECTED_MODE", {
  default: "",
});
const appPublicOrigin = defineString("APP_PUBLIC_ORIGIN", {
  default: "https://alpha-wod.vercel.app",
});
const stripePriceId = defineString(PAYG_PRICE_ENV_KEY, {default: ""});
const paygProductTaxCode = defineString("PAYG_PRODUCT_TAX_CODE", {
  default: "",
});
const paygWaiverVersion = defineString("PAYG_WAIVER_VERSION", {default: ""});
const paygWaiverPublicUrl = defineString("PAYG_WAIVER_PUBLIC_URL", {default: ""});
const paygWaiverSha256 = defineString("PAYG_WAIVER_SHA256", {default: ""});
const paygTermsVersion = defineString("PAYG_TERMS_VERSION", {default: ""});
const paygTermsPublicUrl = defineString("PAYG_TERMS_PUBLIC_URL", {default: ""});
const paygTermsSha256 = defineString("PAYG_TERMS_SHA256", {default: ""});
const paygPrivacyNoticeVersion = defineString("PAYG_PRIVACY_NOTICE_VERSION", {
  default: "",
});
const paygPrivacyNoticePublicUrl = defineString(
  "PAYG_PRIVACY_NOTICE_PUBLIC_URL",
  {default: ""}
);
const paygPrivacyNoticeSha256 = defineString("PAYG_PRIVACY_NOTICE_SHA256", {
  default: "",
});
// PAYG is served by the same Firebase web app as membership checkout. Reuse
// the already-verified production app ID instead of introducing a second
// security identity that could drift.
const paygCheckoutAppId = defineString("MEMBERSHIP_CHECKOUT_APP_ID", {
  default: "",
});
const paygPiiRetentionApproved = defineString("PAYG_PII_RETENTION_APPROVED", {
  default: "false",
});
const paygPiiRetentionPolicyVersion = defineString(
  "PAYG_PII_RETENTION_POLICY_VERSION",
  {default: ""}
);
const paygOrderPiiRetentionDays = defineString(
  "PAYG_ORDER_PII_RETENTION_DAYS",
  {default: ""}
);
const paygWaiverPiiRetentionDays = defineString(
  "PAYG_WAIVER_PII_RETENTION_DAYS",
  {default: ""}
);
const paygFromEmail = defineString("PAYG_FROM_EMAIL", {
  default: "Zero Alpha Fitness <hello@zeroalphafitness.co.uk>",
});
const paygReplyToEmail = defineString("PAYG_REPLY_TO_EMAIL", {
  default: "support@zeroalphafitness.co.uk",
});
const paygCancellationTokenKeyId = defineString(
  "PAYG_CANCELLATION_TOKEN_KEY_ID",
  {default: "cancel-v1"}
);
const paygCancellationTokenPreviousKeyId = defineString(
  "PAYG_CANCELLATION_TOKEN_PREVIOUS_KEY_ID",
  {default: ""}
);
const paygCancellationTokenPreviousValidUntil = defineString(
  "PAYG_CANCELLATION_TOKEN_PREVIOUS_VALID_UNTIL",
  {default: ""}
);
const paygDuplicateLockKeyId = defineString("PAYG_DUPLICATE_LOCK_KEY_ID", {
  default: "lock-v1",
});
const paygDuplicateLockPreviousKeyId = defineString(
  "PAYG_DUPLICATE_LOCK_PREVIOUS_KEY_ID",
  {default: ""}
);
const paygDuplicateLockPreviousValidUntil = defineString(
  "PAYG_DUPLICATE_LOCK_PREVIOUS_VALID_UNTIL",
  {default: ""}
);

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const paygCancellationTokenSecret = defineSecret("PAYG_CANCELLATION_TOKEN_SECRET");
const paygCancellationTokenPreviousSecret = defineSecret(
  "PAYG_CANCELLATION_TOKEN_PREVIOUS_SECRET"
);
const paygCheckoutRateLimitSecret = defineSecret("PAYG_CHECKOUT_RATE_LIMIT_SECRET");
const paygDuplicateLockSecret = defineSecret("PAYG_DUPLICATE_LOCK_SECRET");
const paygDuplicateLockPreviousSecret = defineSecret(
  "PAYG_DUPLICATE_LOCK_PREVIOUS_SECRET"
);
const resendApiKey = defineSecret("RESEND_API_KEY");
export const PAYG_CANCELLATION_TOKEN_SECRET = paygCancellationTokenSecret;
export const PAYG_CANCELLATION_TOKEN_PREVIOUS_SECRET =
  paygCancellationTokenPreviousSecret;
export const PAYG_CHECKOUT_RATE_LIMIT_SECRET = paygCheckoutRateLimitSecret;
export const PAYG_DUPLICATE_LOCK_SECRET = paygDuplicateLockSecret;
export const PAYG_DUPLICATE_LOCK_PREVIOUS_SECRET =
  paygDuplicateLockPreviousSecret;

type StripeMode = "test" | "live";

export type PaygCatalogueIds = Readonly<{
  priceId: string;
  productId: string;
}>;

export type PaygLegalDocument = Readonly<{
  version: string;
  publicUrl: string;
  sha256: string;
}>;

export type PaygLegalConfig = Readonly<{
  waiver: PaygLegalDocument;
  terms: PaygLegalDocument;
  privacyNotice: PaygLegalDocument;
}>;

export type PaygConfirmationLegalAcceptance = Readonly<{
  acceptedAt: string;
  waiver: PaygLegalDocument;
  terms: PaygLegalDocument;
  privacyNotice: PaygLegalDocument;
}>;

export type PaygPiiRetentionConfig = Readonly<{
  policyVersion: string;
  orderPiiRetentionDays: number;
  waiverPiiRetentionDays: number;
}>;

export type PaygClassSnapshot = Readonly<{
  classId: string;
  title: string;
  startTime: string;
  endTime: string;
  timezone: string;
  location: string;
}>;

export type PublicPaygClass = PaygClassSnapshot & Readonly<{
  coachName: string;
  spacesRemaining: number;
  availability: "available" | "full" | "unavailable";
}>;

export type PaygAttendee = Readonly<{
  fullName: string;
  dateOfBirth: string;
  ageAtClass: number;
}>;

export type PaygContact = Readonly<{
  email: string;
  phone?: string;
}>;

export type PaygAcceptances = Readonly<{
  adultConfirmed: true;
  waiverAccepted: true;
  termsAccepted: true;
  cancellationPolicyAccepted: true;
  waiverVersion: string;
  termsVersion: string;
  // The notice is presented, not consented to. Binding the shown version lets
  // the server reject a stale page without misrepresenting privacy as consent.
  privacyNoticeVersionPresented: string;
}>;

export type NormalizedPaygCheckoutRequest = Readonly<{
  checkoutAttemptId: string;
  classId: string;
  attendee: Readonly<{
    fullName: string;
    dateOfBirth: string;
  }>;
  contact: PaygContact;
  acceptances: PaygAcceptances;
}>;

type BillingEnvironment = Readonly<{
  projectId: string;
  stripeMode: StripeMode;
  expectedLivemode: boolean;
}>;

type PaygIntentStatus =
  | "reserved"
  | "checkout_created"
  | "payment_pending"
  | "fulfilled"
  | "manual_review"
  | "expired"
  | "failed";

type PaygOrderStatus =
  | "confirmed"
  | "cancelled"
  | "refund_pending"
  | "refunded"
  | "disputed"
  | "manual_review"
  | "attended"
  | "no_show";

type PaygIntentDoc = {
  schemaVersion: number;
  checkoutSchemaVersion: number;
  offeringKey: typeof PAYG_OFFERING_KEY;
  purchaseKind: typeof PAYG_PURCHASE_KIND;
  status: PaygIntentStatus;
  capacityState: "held" | "released";
  unpaidHoldState: "counted" | "released";
  stripeMode: StripeMode;
  stripePriceId: string;
  stripeProductId: string;
  checkoutAttemptHash: string;
  requestFingerprint: string;
  duplicateLockId: string;
  attendee: PaygAttendee;
  contact: PaygContact;
  acceptances: PaygAcceptances & {
    legal: PaygLegalConfig;
    acceptedAt: FieldValue | Timestamp;
  };
  acceptanceEvidenceDigest: string;
  privacy: PaygPiiRetentionConfig;
  class: PaygClassSnapshot;
  classStartMillis: number;
  classEndMillis: number;
  amountPence: typeof PAYG_AMOUNT_PENCE;
  currency: typeof PAYG_CURRENCY;
  publicOrigin: string;
  checkoutExpiresAt: number;
  checkoutSessionId: string | null;
  checkoutSessionUrl: string | null;
  paymentIntentId: string | null;
  orderId: string | null;
  holdExpiresAt?: FieldValue | Timestamp;
  piiRetentionCutoffAt?: FieldValue | Timestamp;
  piiRedactionRetryAt?: FieldValue | Timestamp;
  piiScrubAt?: FieldValue | Timestamp;
  piiScrubbedAt?: FieldValue | Timestamp;
  piiDeleteAt?: FieldValue | Timestamp;
  createdAt: FieldValue | Timestamp;
  updatedAt: FieldValue | Timestamp;
};

type PaygOrderDoc = {
  schemaVersion: number;
  orderId: string;
  offeringKey: typeof PAYG_OFFERING_KEY;
  purchaseKind: typeof PAYG_PURCHASE_KIND;
  status: PaygOrderStatus;
  capacityState: "held" | "released" | "consumed";
  stripeMode: StripeMode;
  stripePriceId: string;
  stripeProductId: string;
  checkoutSessionId: string;
  paymentIntentId: string | null;
  chargeId: string | null;
  amountPence: typeof PAYG_AMOUNT_PENCE;
  currency: typeof PAYG_CURRENCY;
  attendee: PaygAttendee;
  contact: PaygContact;
  acceptances: PaygIntentDoc["acceptances"];
  acceptanceEvidenceDigest: string;
  retainedAcceptanceEvidence: ReturnType<typeof retainedPaygAcceptanceEvidence>;
  privacy: PaygPiiRetentionConfig;
  class: PaygClassSnapshot;
  classStartMillis: number;
  classEndMillis: number;
  bookingId: string | null;
  duplicateLockId: string;
  confirmationEmailStatus: "pending" | "not_required" | "sent" | "manual_review";
  cancellationCutoffAt: FieldValue | Timestamp;
  noShowReviewAt?: FieldValue | Timestamp;
  refundRecoveryAt?: FieldValue | Timestamp;
  piiRetentionCutoffAt?: FieldValue | Timestamp;
  piiRedactionRetryAt?: FieldValue | Timestamp;
  piiRedactAt?: FieldValue | Timestamp;
  piiRedactedAt?: FieldValue | Timestamp;
  createdAt: FieldValue | Timestamp;
  updatedAt: FieldValue | Timestamp;
};

type PaygRefundStatus = "pending" | "succeeded" | "failed" | "canceled";

type PaygRefundReason =
  | "guest_cancellation"
  | "hold_released_before_payment"
  | "paid_contract_mismatch";

export const PAYG_REFUND_ISSUANCE_CLAIM_MS = 2 * 60 * 1000;

type PaygRefundClaimKind = "order" | "payment_review";

type PaygRefundClaimResult =
  | Readonly<{state: "complete"}>
  | Readonly<{state: "in_progress"}>
  | Readonly<{state: "blocked"}>
  | Readonly<{state: "existing"; refundId: string}>
  | Readonly<{
    state: "acquired";
    token: string;
    paymentIntentId: string;
    expectedChargeId: string | null;
    expectedAmountPence: number | null;
    expectedCurrency: string | null;
    intentId: string | null;
  }>;

export type PaygRefundStateDecision = Readonly<{
  orderStatus: PaygOrderStatus;
  scheduleRecovery: boolean;
  terminal: boolean;
}>;

export type PaygPendingRefundBindingDecision =
  | "bind_and_recover"
  | "recover_bound"
  | "conflict_manual_review"
  | "not_recoverable";

export function hasPaygSucceededRefundEvidence(
  ownerStatus: unknown,
  storedRefundStatus: unknown
): boolean {
  return ownerStatus === "refunded" || storedRefundStatus === "succeeded";
}

export type PaygDisputeLifecycle =
  | "open"
  | "won"
  | "lost"
  | "closed_without_chargeback"
  | "unknown";

export function classifyPaygDisputeStatus(value: unknown): PaygDisputeLifecycle {
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

export function isPaygTerminalDisputeStatus(value: unknown): boolean {
  const lifecycle = classifyPaygDisputeStatus(value);
  return lifecycle === "won" || lifecycle === "lost" ||
    lifecycle === "closed_without_chargeback";
}

export function resolvePaygDisputeOwnerStatus(
  currentStatus: unknown,
  exactProviderBinding: boolean,
  disputeStatus: unknown
): "disputed" | "manual_review" {
  const lifecycle = classifyPaygDisputeStatus(disputeStatus);
  return !exactProviderBinding || currentStatus === "manual_review" ||
    lifecycle === "won" || lifecycle === "closed_without_chargeback" ||
    lifecycle === "unknown" ? "manual_review" : "disputed";
}

export function resolvePaygDisputeObservation(input: Readonly<{
  storedDisputeId: unknown;
  storedDisputeStatus: unknown;
  incomingDisputeId: unknown;
  incomingDisputeStatus: unknown;
}>): "apply" | "preserve_terminal" | "conflict_manual_review" {
  const storedId = typeof input.storedDisputeId === "string" ?
    input.storedDisputeId : null;
  const incomingId = typeof input.incomingDisputeId === "string" ?
    input.incomingDisputeId : null;
  if (!incomingId) return "conflict_manual_review";
  if (storedId && storedId !== incomingId) return "conflict_manual_review";
  if (storedId === incomingId &&
    isPaygTerminalDisputeStatus(input.storedDisputeStatus) &&
    input.storedDisputeStatus !== input.incomingDisputeStatus) {
    return "preserve_terminal";
  }
  return "apply";
}

export function shouldPreservePaygSucceededRefund(input: Readonly<{
  ownerStatus: unknown;
  storedRefundId: unknown;
  storedRefundStatus: unknown;
  incomingRefundId: unknown;
  incomingRefundStatus: unknown;
  exactProviderBinding?: boolean;
}>): boolean {
  const storedIdAbsent = input.storedRefundId === null ||
    input.storedRefundId === undefined || input.storedRefundId === "";
  const sameRefund = input.storedRefundId === input.incomingRefundId ||
    (storedIdAbsent && input.exactProviderBinding === true);
  return input.incomingRefundStatus !== "succeeded" &&
    sameRefund &&
    hasPaygSucceededRefundEvidence(input.ownerStatus, input.storedRefundStatus);
}

export type PaygPaymentReviewDisposition = Readonly<{
  status: "refund_pending" | "manual_review";
  issueRefund: boolean;
  scheduleRecovery: boolean;
}>;

export type PaygPaymentReviewStatus =
  | "refund_pending"
  | "refunded"
  | "disputed"
  | "manual_review";

export type PaygAbuseKeys = Readonly<{
  sourcePseudonym: string;
  attemptId: string;
  requestBinding: string;
  minuteBucketId: string;
  hourBucketId: string;
}>;

export type PaygIdempotentRetryDecision = Readonly<{
  allowed: boolean;
  reason: "allowed" | "too_soon" | "window_exhausted" | "invalid_state";
  retryCount: number;
  windowStartedAtMillis: number;
}>;

type PaygCancellationDecision = Readonly<{
  kind: "refundable" | "late" | "no_show";
  refundEligible: boolean;
  releaseCapacity: boolean;
  cutoffAtMillis: number;
}>;

type PaygCancellationTokenPayload = Readonly<{
  v: 1;
  orderId: string;
  exp: number;
}>;

export type PaygVerificationKey = Readonly<{
  kid: string;
  secret: string;
  verifyUntilUnixSeconds?: number;
}>;

export type PaygDuplicateLockKey = Readonly<{
  kid: string;
  secret: string;
}>;

type StripePriceShape = Readonly<{
  id: string;
  livemode: boolean;
  active: boolean;
  currency: string;
  unit_amount: number | null;
  type: string;
  billing_scheme: string;
  recurring: unknown;
  custom_unit_amount: unknown;
  transform_quantity: unknown;
  tax_behavior: string | null;
  metadata?: Record<string, string>;
}>;

type StripeProductShape = Readonly<{
  id: string;
  livemode: boolean;
  active: boolean;
  name: string;
  tax_code?: unknown;
  metadata?: Record<string, string>;
}>;

function db(): Firestore {
  return admin.firestore();
}

let stripeClient: Stripe | null = null;

function serverTimestamp(): FieldValue {
  return FieldValue.serverTimestamp();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmacSha256(secret: string, value: string): string {
  if (secret.length < 32) {
    throw new Error("PAYG checkout rate-limit secret is too short.");
  }
  return createHmac("sha256", secret).update(value).digest("hex");
}

function ipv6Hextets(value: string): number[] | null {
  let source = value;
  const embeddedIpv4 = source.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (embeddedIpv4) {
    if (isIP(embeddedIpv4) !== 4) return null;
    const octets = embeddedIpv4.split(".").map(Number);
    const replacement = `${((octets[0] << 8) | octets[1]).toString(16)}:${
      ((octets[2] << 8) | octets[3]).toString(16)
    }`;
    source = source.slice(0, -embeddedIpv4.length) + replacement;
  }
  const halves = source.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) ||
    (halves.length === 2 && missing < 1)) return null;
  const values = [
    ...left,
    ...Array.from({length: Math.max(0, missing)}, () => "0"),
    ...right,
  ].map((part) => /^[a-f0-9]{1,4}$/.test(part) ? parseInt(part, 16) : NaN);
  return values.length === 8 && values.every(Number.isInteger) ? values : null;
}

export function canonicalizePaygSourceAddress(value: unknown): string {
  let source = typeof value === "string" ? value.split(",")[0].trim().toLowerCase() : "";
  const bracketed = source.match(/^\[([^\]]+)](?::\d+)?$/);
  if (bracketed) source = bracketed[1];
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(source)) {
    source = source.slice(0, source.lastIndexOf(":"));
  }
  source = source.split("%")[0];
  // This helper is intentionally idempotent because the callable request
  // adapter also normalizes provider-supplied addresses before admission.
  // Re-mask an already canonical /64 instead of collapsing it to the shared
  // "unavailable" bucket on the second pass.
  const ipv6Prefix = source.endsWith("/64") ? source.slice(0, -3) : null;
  if (ipv6Prefix && isIP(ipv6Prefix) === 6) {
    const prefixHextets = ipv6Hextets(ipv6Prefix);
    if (prefixHextets) {
      return `${prefixHextets.slice(0, 4).map((part) =>
        part.toString(16).padStart(4, "0")
      ).join(":")}::/64`;
    }
  }
  const mappedIpv4 = source.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (mappedIpv4 && isIP(mappedIpv4) === 4) return mappedIpv4;
  if (isIP(source) === 4) return source;
  if (isIP(source) !== 6) return "unavailable";
  const hextets = ipv6Hextets(source);
  if (!hextets) return "unavailable";
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
  return `${hextets.slice(0, 4).map((part) =>
    part.toString(16).padStart(4, "0")
  ).join(":")}::/64`;
}

function normalizePaygAttendeeIdentity(fullName: string): string {
  return fullName.normalize("NFKC")
    .replace(/\p{Default_Ignorable_Code_Point}/gu, "")
    .replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-GB");
}

export function derivePaygAbuseKeys(
  secret: string,
  sourceAddress: string,
  checkoutAttemptId: string,
  requestFingerprint: string,
  nowMillis: number
): PaygAbuseKeys {
  if (!Number.isSafeInteger(nowMillis) || nowMillis <= 0) {
    throw new Error("PAYG admission time must be positive integer milliseconds.");
  }
  const sourcePseudonym = hmacSha256(
    secret,
    `payg-source:v1:${canonicalizePaygSourceAddress(sourceAddress)}`
  );
  const attemptId = hmacSha256(secret, `payg-attempt:v1:${checkoutAttemptId}`);
  const requestBinding = hmacSha256(
    secret,
    `payg-request:v1:${requestFingerprint}`
  );
  const minute = Math.floor(nowMillis / 60_000);
  const hour = Math.floor(nowMillis / 3_600_000);
  return Object.freeze({
    sourcePseudonym,
    attemptId,
    requestBinding,
    minuteBucketId: hmacSha256(secret, `payg-minute:v1:${sourcePseudonym}:${minute}`),
    hourBucketId: hmacSha256(secret, `payg-hour:v1:${sourcePseudonym}:${hour}`),
  });
}

export function derivePaygDuplicateLockId(
  secret: string,
  classId: string,
  fullName: string,
  dateOfBirth: string
): string {
  return hmacSha256(
    secret,
    `payg-class-attendee:v1:${classId}:${
      normalizePaygAttendeeIdentity(fullName)
    }:${dateOfBirth}`
  );
}

export function derivePaygDuplicateLockCandidates(
  keys: readonly PaygDuplicateLockKey[],
  classId: string,
  fullName: string,
  dateOfBirth: string
): readonly Readonly<{kid: string; lockId: string}>[] {
  if (keys.length < 1 || keys.length > 2 ||
    new Set(keys.map((key) => key.kid)).size !== keys.length ||
    keys.some((key) => !/^[a-z0-9][a-z0-9_-]{1,31}$/.test(key.kid) ||
      key.secret.length < 32)) {
    throw new Error("PAYG duplicate-lock keyring is invalid.");
  }
  const seen = new Set<string>();
  return Object.freeze(keys.flatMap((key) => {
    const lockId = derivePaygDuplicateLockId(
      key.secret,
      classId,
      fullName,
      dateOfBirth
    );
    if (seen.has(lockId)) return [];
    seen.add(lockId);
    return [Object.freeze({kid: key.kid, lockId})];
  }));
}

export function isPaygDuplicateLockKeyringConfigured(
  keys: readonly PaygDuplicateLockKey[]
): boolean {
  return keys.length >= 1 && keys.length <= 2 &&
    new Set(keys.map((key) => key.kid)).size === keys.length &&
    keys.every((key) => /^[a-z0-9][a-z0-9_-]{1,31}$/.test(key.kid) &&
      key.secret.length >= 32);
}

export function resolvePaygIdempotentRetryAdmission(input: Readonly<{
  currentRetryCount: unknown;
  windowStartedAtMillis: number | null;
  lastAttemptAtMillis: number | null;
  nowMillis: number;
}>): PaygIdempotentRetryDecision {
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
    PAYG_IDEMPOTENT_RETRY_POLICY.windowMs;
  if (windowExpired) {
    return Object.freeze({
      allowed: true,
      reason: "allowed",
      retryCount: 1,
      windowStartedAtMillis: input.nowMillis,
    });
  }
  if (input.nowMillis - input.lastAttemptAtMillis <
    PAYG_IDEMPOTENT_RETRY_POLICY.minimumSpacingMs) {
    return Object.freeze({
      allowed: false,
      reason: "too_soon",
      retryCount,
      windowStartedAtMillis: input.windowStartedAtMillis,
    });
  }
  if (retryCount >= PAYG_IDEMPOTENT_RETRY_POLICY.maxRetriesPerWindow) {
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

export function resolvePaygRefundState(
  currentStatus: PaygOrderStatus,
  refundStatus: PaygRefundStatus
): PaygRefundStateDecision {
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

export function resolvePaygPendingRefundBinding(input: Readonly<{
  ownerStatus: unknown;
  storedRefundId: unknown;
  incomingRefundId: unknown;
  disputeOpen: unknown;
  refundAutomationStatus: unknown;
}>): PaygPendingRefundBindingDecision {
  const incoming = typeof input.incomingRefundId === "string" &&
    input.incomingRefundId.startsWith("re_") ? input.incomingRefundId : null;
  const stored = typeof input.storedRefundId === "string" &&
    input.storedRefundId.startsWith("re_") ? input.storedRefundId : null;
  if (!incoming) return "conflict_manual_review";
  if (stored && stored !== incoming) return "conflict_manual_review";
  const canRecover = input.ownerStatus === "refund_pending" &&
    input.disputeOpen !== true &&
    input.refundAutomationStatus !== "suspended_dispute";
  if (!canRecover) return "not_recoverable";
  return stored === incoming ? "recover_bound" : "bind_and_recover";
}

export function resolvePaygLinkedReviewRefundStatus(
  currentStatus: unknown,
  refundStatus: PaygRefundStatus | null,
  exactProviderBinding: boolean
): PaygPaymentReviewStatus {
  if (currentStatus === "refunded") return "refunded";
  if (currentStatus === "disputed") return "disputed";
  if (currentStatus === "manual_review") return "manual_review";
  if (!exactProviderBinding || refundStatus === null) return "manual_review";
  if (refundStatus === "pending") return "refund_pending";
  if (refundStatus === "succeeded") return "refunded";
  return "manual_review";
}

export function shouldSendPaygConfirmation(status: PaygOrderStatus): boolean {
  return status === "confirmed";
}

export function resolvePaygPaymentReviewDisposition(
  automaticRefundSafe: boolean,
  amountReceivedPence: number | null
): PaygPaymentReviewDisposition {
  const issueRefund = automaticRefundSafe &&
    Number.isSafeInteger(amountReceivedPence) && Number(amountReceivedPence) > 0;
  return Object.freeze({
    status: issueRefund ? "refund_pending" : "manual_review",
    issueRefund,
    scheduleRecovery: issueRefund,
  });
}

export function resolvePaygCanonicalOrderReviewDisposition(input: Readonly<{
  canonicalPaymentIntentId: unknown;
  observedPaymentIntentId: unknown;
  automaticRefundSafe: boolean;
  amountReceivedPence: number | null;
}>) {
  const extraPayment = typeof input.observedPaymentIntentId === "string" &&
    input.observedPaymentIntentId.startsWith("pi_") &&
    typeof input.canonicalPaymentIntentId === "string" &&
    input.canonicalPaymentIntentId.startsWith("pi_") &&
    input.observedPaymentIntentId !== input.canonicalPaymentIntentId;
  return Object.freeze({
    canonicalServicePreserved: true as const,
    extraPayment,
    ...resolvePaygPaymentReviewDisposition(
      extraPayment && input.automaticRefundSafe,
      input.amountReceivedPence
    ),
  });
}

export function resolvePaygUnpaidHoldLimit(classCapacity: number): number {
  if (!Number.isSafeInteger(classCapacity) || classCapacity < 1) return 0;
  return Math.max(1, Math.min(
    PAYG_MAX_CONCURRENT_UNPAID_HOLDS_PER_CLASS,
    Math.floor(classCapacity / 2)
  ));
}

function isEnabled(value: string): boolean {
  return value.trim().toLowerCase() === "true";
}

export function parsePaygPiiRetentionConfig(input: Readonly<{
  approved: unknown;
  policyVersion: unknown;
  orderPiiRetentionDays: unknown;
  waiverPiiRetentionDays: unknown;
}>): PaygPiiRetentionConfig {
  const version = typeof input.policyVersion === "string" ?
    input.policyVersion.trim() : "";
  const parseDays = (value: unknown): number => {
    if (typeof value !== "string" || !/^(0|[1-9]\d{0,4})$/.test(value.trim())) {
      return -1;
    }
    const days = Number(value.trim());
    return Number.isSafeInteger(days) && days <= 36_500 ? days : -1;
  };
  const orderDays = parseDays(input.orderPiiRetentionDays);
  const waiverDays = parseDays(input.waiverPiiRetentionDays);
  if (input.approved !== true ||
    !/^[A-Za-z0-9._-]{3,120}$/.test(version) ||
    orderDays !== PAYG_ORDER_PII_RETENTION_DAYS ||
    waiverDays !== PAYG_WAIVER_PII_RETENTION_DAYS) {
    throw new Error("PAYG PII retention policy is not explicitly approved.");
  }
  return Object.freeze({
    policyVersion: version,
    orderPiiRetentionDays: orderDays,
    waiverPiiRetentionDays: waiverDays,
  });
}

export function paygPiiRedactionDeadline(
  classEndMillis: number,
  retentionDays: number
): number {
  if (!Number.isSafeInteger(classEndMillis) || classEndMillis <= 0 ||
    !Number.isSafeInteger(retentionDays) || retentionDays < 0 ||
    retentionDays > 36_500) {
    throw new Error("PAYG PII redaction deadline is invalid.");
  }
  const deadline = classEndMillis + retentionDays * 24 * 60 * 60 * 1000;
  if (!Number.isSafeInteger(deadline)) {
    throw new Error("PAYG PII redaction deadline is invalid.");
  }
  return deadline;
}

export function resolveStoredPaygPiiRetentionConfig(
  value: unknown
): PaygPiiRetentionConfig | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const policyVersion = typeof candidate.policyVersion === "string" ?
    candidate.policyVersion.trim() : "";
  const orderDays = candidate.orderPiiRetentionDays;
  const waiverDays = candidate.waiverPiiRetentionDays;
  if (!/^[A-Za-z0-9._-]{3,120}$/.test(policyVersion) ||
    orderDays !== PAYG_ORDER_PII_RETENTION_DAYS ||
    waiverDays !== PAYG_WAIVER_PII_RETENTION_DAYS) return null;
  return Object.freeze({
    policyVersion,
    orderPiiRetentionDays: Number(orderDays),
    waiverPiiRetentionDays: Number(waiverDays),
  });
}

function paygError(
  code: "failed-precondition" | "invalid-argument" | "not-found" | "permission-denied" | "deadline-exceeded" | "internal" | "unavailable" | "resource-exhausted" | "already-exists",
  message: string,
  reason?: string
): HttpsError {
  return new HttpsError(code, message, reason ? {reason} : undefined);
}

/**
 * App Check validates the token signature before the callable runs. This
 * second check binds anonymous purchase mutations to the intended Firebase
 * web app and rejects a token replay reported as already consumed.
 */
export function assertPaygCheckoutAppCheck(
  request: any,
  enforce = !isFirebaseFunctionsEmulatorProcess(),
  expectedAppId?: string
): void {
  if (!enforce) return;
  const configuredAppId = expectedAppId?.trim() || paygCheckoutAppId.value().trim();
  if (!configuredAppId) {
    console.error("CRITICAL_PAYG_CHECKOUT_ABUSE_CONFIGURATION", {
      reason: "missing_app_id",
    });
    throw paygError(
      "unavailable",
      "Checkout security is not configured. Try again later.",
      "checkout_security_unavailable"
    );
  }
  if (request?.app?.alreadyConsumed === true) {
    console.warn("PAYG_CHECKOUT_APP_CHECK_REPLAY", {reason: "already_consumed"});
    throw paygError(
      "permission-denied",
      "Checkout security verification could not be completed. Refresh and try again.",
      "app_check_replay"
    );
  }
  if (!request?.app || request.app.appId !== configuredAppId) {
    console.warn("PAYG_CHECKOUT_APP_CHECK_REJECTED", {
      reason: request?.app ? "app_id_mismatch" : "missing_context",
    });
    throw paygError(
      "permission-denied",
      "Checkout security verification could not be completed. Refresh and try again.",
      "app_check_rejected"
    );
  }
}

function requireBoundedString(
  value: unknown,
  field: string,
  min: number,
  max: number
): string {
  const text = typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : "";
  if (text.length < min || text.length > max) {
    throw paygError(
      "invalid-argument",
      `${field} must be between ${min} and ${max} characters.`
    );
  }
  return text;
}

const UNSAFE_PERSON_NAME_CHARACTER =
  /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u;

function requirePersonName(value: unknown): string {
  const raw = typeof value === "string" ? value : "";
  if (UNSAFE_PERSON_NAME_CHARACTER.test(raw) ||
    UNSAFE_PERSON_NAME_CHARACTER.test(raw.normalize("NFKC"))) {
    throw paygError(
      "invalid-argument",
      "attendee.fullName contains unsupported invisible or control characters."
    );
  }
  return requireBoundedString(raw.normalize("NFKC"), "attendee.fullName", 2, 160);
}

function requireEmail(value: unknown): string {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.includes("..")) {
    throw paygError("invalid-argument", "contact.email must be a valid email address.");
  }
  return email;
}

function optionalE164Phone(value: unknown): string | null {
  const phone = typeof value === "string" ? value.trim().replace(/[\s()-]/g, "") : "";
  if (!phone) return null;
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    throw paygError(
      "invalid-argument",
      "When provided, contact.phone must use international format, for example +447700900123."
    );
  }
  return phone;
}

function requireIsoDate(value: unknown): string {
  const date = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw paygError("invalid-argument", "attendee.dateOfBirth must use YYYY-MM-DD.");
  }
  const parsed = DateTime.fromISO(date, {zone: LONDON_TIMEZONE}).startOf("day");
  if (!parsed.isValid || parsed.toISODate() !== date) {
    throw paygError("invalid-argument", "attendee.dateOfBirth is not a valid date.");
  }
  return date;
}

function requireCheckoutAttemptId(value: unknown): string {
  const attemptId = typeof value === "string" ? value.trim() : "";
  if (attemptId.length < 24 || attemptId.length > 128 ||
    !/^[A-Za-z0-9_-]+$/.test(attemptId)) {
    throw paygError(
      "invalid-argument",
      "checkoutAttemptId must be a 24–128 character opaque identifier."
    );
  }
  return attemptId;
}

function requireClassId(value: unknown): string {
  const classId = requireBoundedString(value, "classId", 3, 200);
  if (!/^[A-Za-z0-9._:-]+$/.test(classId)) {
    throw paygError("invalid-argument", "classId contains unsupported characters.");
  }
  return classId;
}

function requireTrue(value: unknown, field: string): true {
  if (value !== true) {
    throw paygError("failed-precondition", `${field} must be accepted.`);
  }
  return true;
}

export function normalizePaygCheckoutRequest(
  value: unknown,
  legal: PaygLegalConfig
): NormalizedPaygCheckoutRequest {
  const data = value && typeof value === "object" ? value as any : {};
  if (data.checkoutSchemaVersion !== PAYG_CHECKOUT_SCHEMA_VERSION) {
    throw paygError(
      "failed-precondition",
      "This checkout page is out of date. Refresh before continuing.",
      "checkout_schema_mismatch"
    );
  }
  const attendee = data.attendee && typeof data.attendee === "object" ? data.attendee : {};
  const contact = data.contact && typeof data.contact === "object" ? data.contact : {};
  const acceptances = data.acceptances && typeof data.acceptances === "object" ?
    data.acceptances : {};
  const waiverVersion = requireBoundedString(
    acceptances.waiverVersion,
    "acceptances.waiverVersion",
    1,
    120
  );
  const termsVersion = requireBoundedString(
    acceptances.termsVersion,
    "acceptances.termsVersion",
    1,
    120
  );
  const privacyNoticeVersionPresented = requireBoundedString(
    acceptances.privacyNoticeVersionPresented,
    "acceptances.privacyNoticeVersionPresented",
    1,
    120
  );
  if (waiverVersion !== legal.waiver.version ||
    termsVersion !== legal.terms.version ||
    privacyNoticeVersionPresented !== legal.privacyNotice.version) {
    throw paygError(
      "failed-precondition",
      "A PAYG document or Privacy Notice changed. Review the current documents before continuing.",
      "stale_legal_terms"
    );
  }
  const phone = optionalE164Phone(contact.phone);
  return Object.freeze({
    checkoutAttemptId: requireCheckoutAttemptId(data.checkoutAttemptId),
    classId: requireClassId(data.classId),
    attendee: Object.freeze({
      fullName: requirePersonName(attendee.fullName),
      dateOfBirth: requireIsoDate(attendee.dateOfBirth),
    }),
    contact: Object.freeze({
      email: requireEmail(contact.email),
      ...(phone ? {phone} : {}),
    }),
    acceptances: Object.freeze({
      adultConfirmed: requireTrue(
        acceptances.adultConfirmed,
        "acceptances.adultConfirmed"
      ),
      waiverAccepted: requireTrue(
        acceptances.waiverAccepted,
        "acceptances.waiverAccepted"
      ),
      termsAccepted: requireTrue(
        acceptances.termsAccepted,
        "acceptances.termsAccepted"
      ),
      cancellationPolicyAccepted: requireTrue(
        acceptances.cancellationPolicyAccepted,
        "acceptances.cancellationPolicyAccepted"
      ),
      waiverVersion,
      termsVersion,
      privacyNoticeVersionPresented,
    }),
  });
}

export function resolveAgeAtMillis(dateOfBirth: string, atMillis: number): number {
  const dob = DateTime.fromISO(dateOfBirth, {zone: LONDON_TIMEZONE}).startOf("day");
  const at = DateTime.fromMillis(atMillis, {zone: LONDON_TIMEZONE}).startOf("day");
  if (!dob.isValid || !at.isValid || dob > at) return -1;
  let age = at.year - dob.year;
  const birthdayPassed = at.month > dob.month ||
    (at.month === dob.month && at.day >= dob.day);
  if (!birthdayPassed) age -= 1;
  return age;
}

export function resolvePaygCancellationDecision(
  classStartMillis: number,
  nowMillis: number
): PaygCancellationDecision {
  if (!Number.isFinite(classStartMillis) || !Number.isFinite(nowMillis)) {
    throw new Error("Cancellation times must be finite milliseconds.");
  }
  const cutoffAtMillis = classStartMillis -
    PAYG_CANCELLATION_CUTOFF_HOURS * 60 * 60 * 1000;
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

export function resolvePaygPostStartCancellationDisposition(
  attendanceRecorded: boolean
): "attended" | "pending_attendance_review" {
  return attendanceRecorded ? "attended" : "pending_attendance_review";
}

export function shouldReleasePaygDuplicateLockForAttendance(input: Readonly<{
  attendanceStatus: "booked" | "checked_in" | "dip";
  nowMillis: number;
  classEndMillis: number;
}>): boolean {
  if (!Number.isSafeInteger(input.nowMillis) ||
    !Number.isSafeInteger(input.classEndMillis)) return false;
  return input.attendanceStatus !== "booked" &&
    input.nowMillis >= input.classEndMillis;
}

export function resolvePaygCancellationRefundPendingDisposition(
  refundReason: unknown
): Readonly<{refundEligible: boolean; issueRefund: boolean}> {
  const guestCancellation = refundReason === "guest_cancellation";
  return Object.freeze({
    refundEligible: guestCancellation,
    issueRefund: guestCancellation,
  });
}

function timestampMillis(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof value === "object" &&
    typeof (value as {toMillis?: unknown}).toMillis === "function") {
    const millis = (value as {toMillis: () => number}).toMillis();
    return Number.isFinite(millis) ? millis : null;
  }
  return null;
}

function hasNonNullDocumentField(
  snapshot: DocumentSnapshot,
  field: string
): boolean {
  const value = snapshot.get(field);
  return value !== undefined && value !== null;
}

function existingPaygIntentPrivacySchedule(
  snapshot: DocumentSnapshot
): Record<string, unknown> {
  const cutoff = timestampMillis(
    snapshot.get(PAYG_PII_RETENTION_CUTOFF_FIELD)
  );
  const retryAt = timestampMillis(
    snapshot.get(PAYG_PII_REDACTION_RETRY_FIELD)
  );
  const privacyAlreadyClosed = hasNonNullDocumentField(
    snapshot,
    "piiScrubbedAt"
  );
  const piiReintroduced = PAYG_INTENT_PII_FIELDS.some((field) => {
    const value = snapshot.get(field);
    return value !== undefined && value !== null;
  });
  return {
    // Remove the ambiguous pre-launch field. It must never authorize recovery
    // or be mistaken for immutable retention evidence again.
    piiScrubAt: FieldValue.delete(),
    ...(privacyAlreadyClosed && piiReintroduced ? {
      // A stale/manual write reintroduced identity after closure. Ensure the
      // review-only path itself schedules immediate cleanup instead of waiting
      // for the bounded collection discovery cursor to revisit this row.
      [PAYG_PII_REDACTION_RETRY_FIELD]: serverTimestamp(),
      piiRedactionReintroducedAt: serverTimestamp(),
    } : privacyAlreadyClosed ? {
      [PAYG_PII_REDACTION_RETRY_FIELD]: FieldValue.delete(),
    } : cutoff === null ? {
      [PAYG_PII_REDACTION_RETRY_FIELD]: serverTimestamp(),
    } : retryAt === null ? {
      [PAYG_PII_REDACTION_RETRY_FIELD]: Timestamp.fromMillis(cutoff),
    } : {}),
  };
}

export function sanitizePublicPaygClass(
  classId: string,
  value: Record<string, unknown>,
  nowMillis: number
): PublicPaygClass | null {
  const startMillis = timestampMillis(value.startTime);
  const endMillis = timestampMillis(value.endTime);
  if (value.status !== "scheduled" || startMillis === null || endMillis === null ||
    endMillis <= startMillis || startMillis <= nowMillis) return null;
  const title = typeof value.title === "string" ? value.title.trim().slice(0, 160) : "";
  const timezone = typeof value.timezone === "string" && value.timezone.trim() ?
    value.timezone.trim().slice(0, 80) : LONDON_TIMEZONE;
  const location = typeof value.location === "string" ?
    value.location.trim().slice(0, 200) : "";
  const coachName = typeof value.coachName === "string" ?
    value.coachName.trim().slice(0, 160) : "";
  if (!title || !location) return null;
  const capacity = Number.isSafeInteger(value.capacity) && Number(value.capacity) > 0 ?
    Number(value.capacity) : 0;
  const bookedCount = Number.isSafeInteger(value.bookedCount) && Number(value.bookedCount) > 0 ?
    Number(value.bookedCount) : 0;
  const spacesRemaining = Math.max(0, capacity - bookedCount);
  const checkoutWindowOpen = startMillis - nowMillis >=
    PAYG_MINIMUM_CHECKOUT_WINDOW_SECONDS * 1000;
  // PAYG covers the whole adult schedule. An explicit false is the operational
  // escape hatch for a special occurrence; legacy occurrences default on.
  const eligible = value.paygEligible !== false && checkoutWindowOpen && capacity > 0;
  const availability: PublicPaygClass["availability"] = !eligible ?
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

export function paygCheckoutRequestFingerprint(
  request: NormalizedPaygCheckoutRequest,
  legal: PaygLegalConfig
): string {
  return sha256(JSON.stringify({
    schemaVersion: PAYG_CHECKOUT_SCHEMA_VERSION,
    offeringKey: PAYG_OFFERING_KEY,
    classId: request.classId,
    attendee: request.attendee,
    contact: request.contact,
    acceptances: request.acceptances,
    legal,
  }));
}

export function derivePaygAcceptanceEvidenceDigest(
  secret: string,
  request: NormalizedPaygCheckoutRequest,
  legal: PaygLegalConfig
): string {
  return hmacSha256(secret, JSON.stringify({
    domain: "payg-acceptance-evidence:v1",
    classId: request.classId,
    attendee: request.attendee,
    contact: request.contact,
    acceptances: request.acceptances,
    legal,
  }));
}

function canonicalTaxCode(value: string): string | null {
  const normalized = value.trim();
  if (normalized.toLowerCase() === "none") return null;
  if (!/^txcd_\d+$/.test(normalized)) {
    throw paygError(
      "failed-precondition",
      "PAYG is unavailable because its Product tax code is not approved."
    );
  }
  return normalized;
}

export function assertPaygStripeCatalogueShape(
  price: StripePriceShape,
  product: StripeProductShape | null,
  expectedIds: PaygCatalogueIds,
  mode: StripeMode,
  expectedProductTaxCode: string | null
): void {
  const expectedLivemode = mode === "live";
  const exact = price.id === expectedIds.priceId &&
    price.livemode === expectedLivemode &&
    price.active === true &&
    price.currency === PAYG_CURRENCY &&
    price.unit_amount === PAYG_AMOUNT_PENCE &&
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
    product.name === PAYG_PRODUCT_NAME &&
    product.tax_code === expectedProductTaxCode;
  if (!exact) {
    throw paygError(
      "failed-precondition",
      "PAYG is unavailable because Stripe does not match the approved one-time catalogue.",
      "stripe_catalogue_mismatch"
    );
  }
}

export function resolvePaygCatalogueIds(
  mode: StripeMode,
  configuredPriceId: string,
  allowlists: Readonly<Record<StripeMode, PaygCatalogueIds>>
): PaygCatalogueIds {
  const expected = allowlists[mode];
  const pricePrefix = mode === "live" ? "price_" : "price_";
  if (!expected.priceId.startsWith(pricePrefix) ||
    !expected.productId.startsWith("prod_") ||
    configuredPriceId !== expected.priceId) {
    throw paygError(
      "failed-precondition",
      "PAYG is unavailable because its exact Stripe Product and Price allowlist is incomplete.",
      "stripe_catalogue_unapproved"
    );
  }
  return Object.freeze({...expected});
}

export function isPaygMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  const value = metadata as Record<string, unknown>;
  return value.purchaseKind === PAYG_PURCHASE_KIND &&
    value.offeringKey === PAYG_OFFERING_KEY &&
    typeof value.paygIntentId === "string" &&
    /^payg_[a-f0-9]{64}$/.test(value.paygIntentId);
}

export function paygIntentIdFromCheckoutSession(
  session: Pick<Stripe.Checkout.Session, "metadata" | "client_reference_id">
): string | null {
  // client_reference_id is fixed when Checkout is created, while Session
  // metadata can be updated later. Prefer the immutable binding if they ever
  // disagree so a mutated Session cannot point at another guest's intent.
  const candidates = [session.client_reference_id, session.metadata?.paygIntentId];
  return candidates.find((value): value is string =>
    typeof value === "string" && /^payg_[a-f0-9]{64}$/.test(value)
  ) ?? null;
}

function base64UrlEncode(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

export function signPaygCancellationToken(
  payload: PaygCancellationTokenPayload,
  secret: string,
  kid?: string
): string {
  if (secret.length < 32) throw new Error("PAYG cancellation token secret is too short.");
  if (kid !== undefined && !/^[a-z0-9][a-z0-9_-]{1,31}$/.test(kid)) {
    throw new Error("PAYG cancellation token key ID is invalid.");
  }
  if (payload.v !== 1 || !/^payg_[a-f0-9]{64}$/.test(payload.orderId) ||
    !Number.isSafeInteger(payload.exp) || payload.exp <= 0) {
    throw new Error("Invalid PAYG cancellation token payload.");
  }
  const body = base64UrlEncode(JSON.stringify(payload));
  const signed = kid ? `${kid}.${body}` : body;
  const signature = createHmac("sha256", secret).update(signed).digest();
  return kid ? `${kid}.${body}.${base64UrlEncode(signature)}` :
    `${body}.${base64UrlEncode(signature)}`;
}

export function verifyPaygCancellationTokenWithKeyring(
  token: string,
  keyring: readonly PaygVerificationKey[],
  nowUnixSeconds = Math.floor(Date.now() / 1000)
): PaygCancellationTokenPayload {
  const parts = token.split(".");
  const versioned = parts.length === 3;
  if ((!versioned && parts.length !== 2) || parts.some((part) => !part)) {
    throw paygError("permission-denied", "This cancellation link is invalid or expired.");
  }
  if (keyring.length < 1 || keyring.length > 2) {
    throw new Error("PAYG cancellation token keyring is invalid.");
  }
  const kids = new Set<string>();
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
  let supplied: Buffer;
  try {
    supplied = base64UrlDecode(signaturePart);
  } catch {
    throw paygError("permission-denied", "This cancellation link is invalid or expired.");
  }
  let matchedKey: PaygVerificationKey | null = null;
  for (const key of candidates) {
    const signed = tokenKid ? `${tokenKid}.${body}` : body;
    const expected = createHmac("sha256", key.secret).update(signed).digest();
    if (supplied.length === expected.length && timingSafeEqual(supplied, expected)) {
      matchedKey = key;
    }
  }
  if (!matchedKey) {
    throw paygError("permission-denied", "This cancellation link is invalid or expired.");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(base64UrlDecode(body).toString("utf8"));
  } catch {
    throw paygError("permission-denied", "This cancellation link is invalid or expired.");
  }
  if (!payload || typeof payload !== "object") {
    throw paygError("permission-denied", "This cancellation link is invalid or expired.");
  }
  const candidate = payload as Record<string, unknown>;
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

export function verifyPaygCancellationToken(
  token: string,
  secret: string,
  nowUnixSeconds = Math.floor(Date.now() / 1000)
): PaygCancellationTokenPayload {
  const parts = token.split(".");
  const kid = parts.length === 3 ? parts[0] : "legacy";
  return verifyPaygCancellationTokenWithKeyring(
    token,
    [{kid, secret}],
    nowUnixSeconds
  );
}

function isFirebaseFunctionsEmulatorProcess(): boolean {
  return process.env.FUNCTIONS_EMULATOR === "true";
}

function isLoopbackHost(value: string | undefined): boolean {
  return typeof value === "string" &&
    /^(127\.0\.0\.1|localhost):\d+$/.test(value);
}

function isIsolatedLocalTestEmulatorProcess(): boolean {
  return isFirebaseFunctionsEmulatorProcess() &&
    isLoopbackHost(process.env.FIRESTORE_EMULATOR_HOST) &&
    isLoopbackHost(process.env.FIREBASE_AUTH_EMULATOR_HOST) &&
    runtimeFirebaseProjectId() === LOCAL_TEST_FIREBASE_PROJECT_ID;
}

function secretsForRuntime<T>(secrets: T[]): T[] {
  return isIsolatedLocalTestEmulatorProcess() ? [] : secrets;
}

function rotationHorizonUnixSeconds(value: string, field: string): number {
  const millis = Date.parse(value.trim());
  if (!Number.isSafeInteger(millis) || millis <= 0) {
    throw new Error(`${field} must be an ISO-8601 timestamp.`);
  }
  return Math.floor(millis / 1000);
}

function cancellationVerificationKeyring(): readonly PaygVerificationKey[] {
  const current: PaygVerificationKey = Object.freeze({
    kid: paygCancellationTokenKeyId.value().trim(),
    secret: paygCancellationTokenSecret.value().trim(),
  });
  const previousKid = paygCancellationTokenPreviousKeyId.value().trim();
  if (!previousKid) return Object.freeze([current]);
  return Object.freeze([
    current,
    Object.freeze({
      kid: previousKid,
      secret: paygCancellationTokenPreviousSecret.value().trim(),
      verifyUntilUnixSeconds: rotationHorizonUnixSeconds(
        paygCancellationTokenPreviousValidUntil.value(),
        "PAYG_CANCELLATION_TOKEN_PREVIOUS_VALID_UNTIL"
      ),
    }),
  ]);
}

export function resolvePaygCancellationSigningKey(
  kid: unknown,
  secret: unknown
): PaygVerificationKey {
  if (typeof kid !== "string" ||
    !/^[a-z0-9][a-z0-9_-]{1,31}$/.test(kid) ||
    typeof secret !== "string" || secret.length < 32) {
    throw new Error("PAYG cancellation signing key is invalid.");
  }
  return Object.freeze({kid, secret});
}

function cancellationSigningKey(): PaygVerificationKey {
  // Signing a new link must depend only on the current key. In particular,
  // webhook/recovery runtimes do not need the previous verify-only secret just
  // because a rotation is in progress.
  return resolvePaygCancellationSigningKey(
    paygCancellationTokenKeyId.value().trim(),
    paygCancellationTokenSecret.value().trim()
  );
}

function duplicateLockKeyring(nowMillis = Date.now()): readonly PaygDuplicateLockKey[] {
  const current: PaygDuplicateLockKey = Object.freeze({
    kid: paygDuplicateLockKeyId.value().trim(),
    secret: paygDuplicateLockSecret.value().trim(),
  });
  const previousKid = paygDuplicateLockPreviousKeyId.value().trim();
  if (!previousKid) return Object.freeze([current]);
  const previousValidUntil = rotationHorizonUnixSeconds(
    paygDuplicateLockPreviousValidUntil.value(),
    "PAYG_DUPLICATE_LOCK_PREVIOUS_VALID_UNTIL"
  ) * 1000;
  return Object.freeze([
    current,
    ...(nowMillis <= previousValidUntil ? [Object.freeze({
      kid: previousKid,
      secret: paygDuplicateLockPreviousSecret.value().trim(),
    })] : []),
  ]);
}

export const PAYG_CHECKOUT_SECRETS = secretsForRuntime([
  stripeSecretKey,
  paygCancellationTokenSecret,
  paygCancellationTokenPreviousSecret,
  paygCheckoutRateLimitSecret,
  paygDuplicateLockSecret,
  paygDuplicateLockPreviousSecret,
]);
export const PAYG_STATUS_SECRETS = secretsForRuntime([
  paygCancellationTokenSecret,
  paygCancellationTokenPreviousSecret,
  paygCheckoutRateLimitSecret,
  paygDuplicateLockSecret,
  paygDuplicateLockPreviousSecret,
]);
export const PAYG_CANCELLATION_SECRETS = secretsForRuntime([
  stripeSecretKey,
  paygCancellationTokenSecret,
  paygCancellationTokenPreviousSecret,
]);
export const PAYG_CANCELLATION_PREVIEW_SECRETS = secretsForRuntime([
  paygCancellationTokenSecret,
  paygCancellationTokenPreviousSecret,
]);
export const PAYG_WORKER_SECRETS = secretsForRuntime([
  stripeSecretKey,
  paygCancellationTokenSecret,
  paygCancellationTokenPreviousSecret,
]);
export const PAYG_WEBHOOK_SECRETS = secretsForRuntime([
  stripeSecretKey,
  paygCancellationTokenSecret,
  paygCancellationTokenPreviousSecret,
]);
export const PAYG_EMAIL_WORKER_SECRETS = secretsForRuntime([resendApiKey]);

function runtimeFirebaseProjectId(): string {
  const direct = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  if (direct?.trim()) return direct.trim();
  try {
    const config = JSON.parse(process.env.FIREBASE_CONFIG || "{}") as {
      projectId?: unknown;
    };
    return typeof config.projectId === "string" ? config.projectId.trim() : "";
  } catch {
    return "";
  }
}

function assertPaygFirebaseProject(): string {
  const expectedProjectId = paygFirebaseProjectId.value().trim();
  const projectId = runtimeFirebaseProjectId();
  if (!expectedProjectId || !projectId || expectedProjectId !== projectId) {
    throw paygError(
      "failed-precondition",
      "PAYG is disabled because the Firebase project identity is not explicitly matched."
    );
  }
  return projectId;
}

function assertPaygDataPlaneEnvironment(): BillingEnvironment {
  const projectId = assertPaygFirebaseProject();
  const rawMode = stripeExpectedMode.value().trim().toLowerCase();
  if (rawMode !== "test" && rawMode !== "live") {
    throw paygError(
      "failed-precondition",
      "PAYG is disabled because the expected Stripe mode is not configured."
    );
  }
  const mode = rawMode as StripeMode;
  if (projectId === PRODUCTION_FIREBASE_PROJECT_ID && mode !== "live") {
    throw paygError(
      "failed-precondition",
      "Stripe test mode is forbidden for PAYG in the production Firebase project."
    );
  }
  if (projectId === LOCAL_TEST_FIREBASE_PROJECT_ID && mode !== "test") {
    throw paygError(
      "failed-precondition",
      "Stripe live mode is forbidden for PAYG in the isolated test project."
    );
  }
  if (isFirebaseFunctionsEmulatorProcess() && mode === "live") {
    throw paygError(
      "failed-precondition",
      "Stripe live mode is forbidden for PAYG in every emulator process."
    );
  }
  return Object.freeze({
    projectId,
    stripeMode: mode,
    expectedLivemode: mode === "live",
  });
}

function assertPaygBillingEnvironment(): BillingEnvironment {
  const environment = assertPaygDataPlaneEnvironment();
  const key = stripeSecretKey.value().trim();
  const keyMode: StripeMode | null =
    key.startsWith("sk_test_") || key.startsWith("rk_test_") ? "test" :
      key.startsWith("sk_live_") || key.startsWith("rk_live_") ? "live" : null;
  if (keyMode !== environment.stripeMode) {
    throw paygError(
      "failed-precondition",
      "PAYG is disabled because the Stripe credential does not match the configured mode."
    );
  }
  return environment;
}

function stripeHostOptions(): Partial<Stripe.StripeConfig> {
  const host = process.env.STRIPE_API_HOST;
  if (!host) return {};
  if (!isIsolatedLocalTestEmulatorProcess() ||
    stripeExpectedMode.value().trim().toLowerCase() !== "test") {
    throw paygError(
      "failed-precondition",
      "The Stripe API host override is allowed only in the isolated PAYG emulator."
    );
  }
  return {
    host,
    port: Number(process.env.STRIPE_API_PORT || 12111),
    protocol: (process.env.STRIPE_API_PROTOCOL as "http" | "https") || "http",
  };
}

function stripe(): Stripe {
  assertPaygBillingEnvironment();
  const key = stripeSecretKey.value().trim();
  if (!stripeClient) {
    stripeClient = new Stripe(key, {
      maxNetworkRetries: 2,
      timeout: 20000,
      ...stripeHostOptions(),
    });
  }
  return stripeClient;
}

function assertStripeObjectMode(
  objectType: string,
  objectId: string,
  livemode: unknown
): void {
  const environment = assertPaygBillingEnvironment();
  if (typeof livemode !== "boolean" || livemode !== environment.expectedLivemode) {
    console.error("CRITICAL_BILLING_PAYG_STRIPE_MODE_MISMATCH", {
      projectId: environment.projectId,
      expectedStripeMode: environment.stripeMode,
      objectType,
      objectId,
      livemode: typeof livemode === "boolean" ? livemode : null,
    });
    throw paygError(
      "failed-precondition",
      `PAYG refused a ${objectType} from the wrong Stripe mode.`
    );
  }
}

function configuredAllowlists(): Readonly<Record<StripeMode, PaygCatalogueIds>> {
  return APPROVED_PAYG_STRIPE_CATALOGUE_IDS;
}

function resolveConfiguredCatalogueIds(mode: StripeMode): PaygCatalogueIds {
  return resolvePaygCatalogueIds(
    mode,
    stripePriceId.value().trim(),
    configuredAllowlists()
  );
}

function resolvePublicOrigin(): string {
  const raw = appPublicOrigin.value().trim().replace(/\/$/, "");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw paygError(
      "failed-precondition",
      "PAYG is unavailable because its public origin is invalid."
    );
  }
  const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.origin !== raw || (parsed.protocol !== "https:" &&
    !(isIsolatedLocalTestEmulatorProcess() && loopback && parsed.protocol === "http:"))) {
    throw paygError(
      "failed-precondition",
      "PAYG is unavailable because its public origin is invalid."
    );
  }
  return raw;
}

function readLegalDocument(
  kind: "waiver" | "terms" | "privacy notice",
  versionValue: string,
  publicUrlValue: string,
  sha256Value: string,
  origin: string
): PaygLegalDocument {
  const version = versionValue.trim();
  const publicUrl = publicUrlValue.trim();
  const digest = sha256Value.trim().toLowerCase();
  if (!/^[A-Za-z0-9._-]{3,120}$/.test(version) ||
    !/^[a-f0-9]{64}$/.test(digest)) {
    throw paygError(
      "failed-precondition",
      `PAYG ${kind} publication evidence is incomplete.`,
      "payg_legal_unavailable"
    );
  }
  let resolved: URL;
  try {
    resolved = new URL(publicUrl, origin);
  } catch {
    throw paygError(
      "failed-precondition",
      `PAYG ${kind} publication URL is invalid.`,
      "payg_legal_unavailable"
    );
  }
  if (resolved.origin !== origin || !resolved.pathname.startsWith("/legal/") ||
    resolved.search || resolved.hash) {
    throw paygError(
      "failed-precondition",
      `PAYG ${kind} publication URL is invalid.`,
      "payg_legal_unavailable"
    );
  }
  return Object.freeze({
    version,
    publicUrl: `${resolved.pathname}`,
    sha256: digest,
  });
}

function resolveLegalConfig(requireApproval = true): PaygLegalConfig {
  if (requireApproval && !isEnabled(paygLegalApproved.value())) {
    throw paygError(
      "failed-precondition",
      "PAYG checkout is closed until its legal documents are approved.",
      "payg_legal_unavailable"
    );
  }
  const origin = resolvePublicOrigin();
  return Object.freeze({
    waiver: readLegalDocument(
      "waiver",
      paygWaiverVersion.value(),
      paygWaiverPublicUrl.value(),
      paygWaiverSha256.value(),
      origin
    ),
    terms: readLegalDocument(
      "terms",
      paygTermsVersion.value(),
      paygTermsPublicUrl.value(),
      paygTermsSha256.value(),
      origin
    ),
    privacyNotice: readLegalDocument(
      "privacy notice",
      paygPrivacyNoticeVersion.value(),
      paygPrivacyNoticePublicUrl.value(),
      paygPrivacyNoticeSha256.value(),
      origin
    ),
  });
}

function resolvePiiRetentionConfig(): PaygPiiRetentionConfig {
  try {
    return parsePaygPiiRetentionConfig({
      approved: isEnabled(paygPiiRetentionApproved.value()),
      policyVersion: paygPiiRetentionPolicyVersion.value(),
      orderPiiRetentionDays: paygOrderPiiRetentionDays.value(),
      waiverPiiRetentionDays: paygWaiverPiiRetentionDays.value(),
    });
  } catch {
    throw paygError(
      "failed-precondition",
      "PAYG is unavailable until its guest-data retention policy is approved.",
      "payg_privacy_unavailable"
    );
  }
}

function requirePaygAvailability(): void {
  if (!isEnabled(paygAvailabilityEnabled.value())) {
    throw paygError(
      "failed-precondition",
      "Pay As You Go class booking is not currently available.",
      "payg_unavailable"
    );
  }
  if (!PAYG_PII_REDACTION_IMPLEMENTED) {
    throw paygError(
      "failed-precondition",
      "PAYG is not yet available because guest-data redaction is not implemented.",
      "payg_privacy_launch_blocked"
    );
  }
  assertCancellationTokenSecretConfigured();
  assertCheckoutRateLimitSecretConfigured();
  assertDuplicateLockKeyringConfigured();
  resolvePiiRetentionConfig();
}

function assertCancellationTokenSecretConfigured(): void {
  let configured = false;
  try {
    const keys = cancellationVerificationKeyring();
    configured = keys.length >= 1 && keys.length <= 2 &&
      new Set(keys.map((key) => key.kid)).size === keys.length &&
      keys.every((key) => /^[a-z0-9][a-z0-9_-]{1,31}$/.test(key.kid) &&
        key.secret.length >= 32);
  } catch {
    configured = false;
  }
  if (!configured) {
    throw paygError(
      "failed-precondition",
      "PAYG is unavailable because guest cancellation links are not configured."
    );
  }
}

function assertDuplicateLockKeyringConfigured(): void {
  let configured = false;
  try {
    configured = isPaygDuplicateLockKeyringConfigured(duplicateLockKeyring());
  } catch {
    configured = false;
  }
  if (!configured) {
    throw paygError(
      "failed-precondition",
      "PAYG is unavailable because duplicate-booking protection is not configured."
    );
  }
}

function assertCheckoutRateLimitSecretConfigured(): void {
  if (paygCheckoutRateLimitSecret.value().trim().length < 32) {
    throw paygError(
      "failed-precondition",
      "PAYG is unavailable because anonymous checkout admission is not configured."
    );
  }
}

async function loadApprovedPaygPrice(): Promise<{
  client: Stripe;
  environment: BillingEnvironment;
  ids: PaygCatalogueIds;
}> {
  const environment = assertPaygBillingEnvironment();
  const ids = resolveConfiguredCatalogueIds(environment.stripeMode);
  const client = stripe();
  let price: Stripe.Price;
  try {
    price = await client.prices.retrieve(ids.priceId, {expand: ["product"]});
  } catch (error) {
    console.error("PAYG Stripe catalogue preflight failed", {
      offeringKey: PAYG_OFFERING_KEY,
      error,
    });
    throw paygError(
      "unavailable",
      "PAYG billing is temporarily unavailable. Retry this same checkout attempt."
    );
  }
  assertStripeObjectMode("Price", price.id, price.livemode);
  const product = typeof price.product === "object" &&
    price.product !== null && !("deleted" in price.product) ?
    price.product as Stripe.Product : null;
  if (product) assertStripeObjectMode("Product", product.id, product.livemode);
  assertPaygStripeCatalogueShape(
    price as unknown as StripePriceShape,
    product as unknown as StripeProductShape | null,
    ids,
    environment.stripeMode,
    canonicalTaxCode(paygProductTaxCode.value())
  );
  return {client, environment, ids};
}

function classSnapshotFromPublic(value: PublicPaygClass): PaygClassSnapshot {
  return Object.freeze({
    classId: value.classId,
    title: value.title,
    startTime: value.startTime,
    endTime: value.endTime,
    timezone: value.timezone,
    location: value.location,
  });
}

function paygIntentId(checkoutAttemptId: string): string {
  return `payg_${sha256(`payg-checkout:${checkoutAttemptId}`)}`;
}

function paygGuestBookingId(intentId: string): string {
  return `payg_guest_${intentId.slice("payg_".length)}`;
}

function paygGuestUserId(intentId: string): string {
  return `payg_guest_${sha256(intentId).slice(0, 40)}`;
}

function metadataForIntent(intentId: string, classId: string): Record<string, string> {
  return {
    purchaseKind: PAYG_PURCHASE_KIND,
    offeringKey: PAYG_OFFERING_KEY,
    paygIntentId: intentId,
    classId,
    schemaVersion: String(PAYG_SCHEMA_VERSION),
  };
}

export function buildPaygCheckoutSessionParams(input: Readonly<{
  intentId: string;
  classId: string;
  classTitle: string;
  email: string;
  priceId: string;
  publicOrigin: string;
  checkoutExpiresAt: number;
}>): Stripe.Checkout.SessionCreateParams {
  const metadata = metadataForIntent(input.intentId, input.classId);
  return {
    mode: "payment",
    adaptive_pricing: {enabled: false},
    line_items: [{price: input.priceId, quantity: 1}],
    customer_email: input.email,
    customer_creation: "if_required",
    client_reference_id: input.intentId,
    payment_method_types: ["card"],
    billing_address_collection: "auto",
    phone_number_collection: {enabled: false},
    automatic_tax: {enabled: false},
    submit_type: "book",
    locale: "en-GB",
    expires_at: input.checkoutExpiresAt,
    success_url: `${input.publicOrigin}/pay-as-you-go/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.publicOrigin}/pay-as-you-go?checkout=cancelled`,
    payment_intent_data: {
      description: `${PAYG_PRODUCT_NAME}: ${input.classTitle}`.slice(0, 500),
      metadata,
    },
    metadata,
  };
}

function isDefinitiveStripeCreateFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {type?: unknown; rawType?: unknown};
  return candidate.type === "StripeInvalidRequestError" ||
    candidate.rawType === "invalid_request_error" ||
    candidate.type === "StripeAuthenticationError" ||
    candidate.rawType === "authentication_error" ||
    candidate.type === "StripePermissionError";
}

function idOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) {
    return String((value as {id: unknown}).id);
  }
  return null;
}

function publicOffering() {
  return Object.freeze({
    key: PAYG_OFFERING_KEY,
    displayName: PAYG_PRODUCT_NAME,
    amountPence: PAYG_AMOUNT_PENCE,
    currency: PAYG_CURRENCY,
    cancellationCutoffHours: PAYG_CANCELLATION_CUTOFF_HOURS,
  });
}

export function publicLegalConfig(legal: PaygLegalConfig) {
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

function paygPublicGates(): {
  available: boolean;
  checkoutAvailable: boolean;
  legal: ReturnType<typeof publicLegalConfig> | null;
  } {
  if (!isEnabled(paygAvailabilityEnabled.value())) {
    return {available: false, checkoutAvailable: false, legal: null};
  }
  if (!PAYG_PII_REDACTION_IMPLEMENTED) {
    return {available: true, checkoutAvailable: false, legal: null};
  }
  let legal: PaygLegalConfig;
  try {
    legal = resolveLegalConfig(true);
  } catch {
    return {available: true, checkoutAvailable: false, legal: null};
  }
  try {
    const environment = assertPaygDataPlaneEnvironment();
    resolveConfiguredCatalogueIds(environment.stripeMode);
    canonicalTaxCode(paygProductTaxCode.value());
    assertCancellationTokenSecretConfigured();
    assertCheckoutRateLimitSecretConfigured();
    assertDuplicateLockKeyringConfigured();
    resolvePiiRetentionConfig();
  } catch {
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

export function buildGetPublicPaygSchedule() {
  return onCall({
    region: REGION,
    secrets: PAYG_STATUS_SECRETS,
    enforceAppCheck: !isFirebaseFunctionsEmulatorProcess(),
  }, async () => {
    const gates = paygPublicGates();
    if (!gates.available) {
      return {
        ok: true,
        ...gates,
        offering: publicOffering(),
        classes: [],
      };
    }
    assertPaygFirebaseProject();
    const nowMillis = Date.now();
    const snapshot = await db().collection("classes")
      .where("startTime", ">=", Timestamp.fromMillis(nowMillis))
      .orderBy("startTime", "asc")
      .limit(MAX_PUBLIC_CLASSES)
      .get();
    const classes = snapshot.docs
      .map((doc) => sanitizePublicPaygClass(doc.id, doc.data(), nowMillis))
      .filter((value): value is PublicPaygClass => value !== null);
    return {
      ok: true,
      ...gates,
      offering: publicOffering(),
      classes,
    };
  });
}

function checkoutResponse(
  disposition: "created" | "resumed",
  session: Stripe.Checkout.Session,
  intent: PaygIntentDoc
) {
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

function assertSessionBinding(
  session: Stripe.Checkout.Session,
  intentId: string,
  intent: PaygIntentDoc
): void {
  assertStripeObjectMode("Checkout Session", session.id, session.livemode);
  if (session.mode !== "payment" ||
    session.client_reference_id !== intentId ||
    session.metadata?.purchaseKind !== PAYG_PURCHASE_KIND ||
    session.metadata?.offeringKey !== PAYG_OFFERING_KEY ||
    session.metadata?.paygIntentId !== intentId ||
    session.metadata?.classId !== intent.class.classId) {
    throw new Error(`Checkout Session ${session.id} does not match PAYG intent ${intentId}.`);
  }
}

async function releasePaygHold(
  intentRef: DocumentReference,
  reason: string,
  expectedSessionId?: string
): Promise<boolean> {
  return db().runTransaction(async (tx) => {
    const intentSnap = await tx.get(intentRef);
    if (!intentSnap.exists) return false;
    const intent = intentSnap.data() as PaygIntentDoc;
    if (expectedSessionId && intent.checkoutSessionId &&
      intent.checkoutSessionId !== expectedSessionId) {
      throw new Error(`PAYG intent ${intentRef.id} belongs to another Checkout Session.`);
    }
    if (intent.status === "fulfilled") {
      if (intent.holdExpiresAt) {
        tx.set(intentRef, {holdExpiresAt: FieldValue.delete()}, {merge: true});
      }
      return false;
    }
    const classRef = intent.class?.classId ?
      db().collection("classes").doc(intent.class.classId) : null;
    const lockRef = typeof intent.duplicateLockId === "string" &&
      /^[a-f0-9]{64}$/.test(intent.duplicateLockId) ?
      db().collection(PAYG_DUPLICATE_LOCK_COLLECTION).doc(intent.duplicateLockId) : null;
    const [classSnap, lockSnap] = await Promise.all([
      classRef ? tx.get(classRef) : Promise.resolve(null),
      lockRef ? tx.get(lockRef) : Promise.resolve(null),
    ]);
    const releaseBookedPlace = intent.capacityState !== "released";
    const releaseUnpaidHold = intent.unpaidHoldState === "counted";
    if ((releaseBookedPlace || releaseUnpaidHold) && classSnap?.exists) {
      const bookedCount = Number(classSnap.get("bookedCount") ?? 0);
      const unpaidHoldCount = Number(classSnap.get("paygUnpaidHoldCount") ?? 0);
      tx.set(classSnap.ref, {
        ...(releaseBookedPlace ? {
          bookedCount: FieldValue.increment(bookedCount > 0 ? -1 : 0),
        } : {}),
        ...(releaseUnpaidHold ? {
          paygUnpaidHoldCount: FieldValue.increment(unpaidHoldCount > 0 ? -1 : 0),
        } : {}),
        updatedAt: serverTimestamp(),
      }, {merge: true});
    }
    if (lockRef && lockSnap?.exists && lockSnap.get("intentId") === intentRef.id) {
      tx.delete(lockRef);
    }
    const piiAlreadyScrubbed = hasNonNullDocumentField(
      intentSnap,
      "piiScrubbedAt"
    );
    const piiReintroduced = PAYG_INTENT_PII_FIELDS.some((field) =>
      hasNonNullDocumentField(intentSnap, field)
    );
    const piiRetentionCutoff = timestampMillis(
      intentSnap.get(PAYG_PII_RETENTION_CUTOFF_FIELD)
    );
    const piiRedactionRetry = timestampMillis(
      intentSnap.get(PAYG_PII_REDACTION_RETRY_FIELD)
    );
    tx.set(intentRef, {
      status: reason === "checkout_create_failed" ? "failed" : "expired",
      capacityState: "released",
      unpaidHoldState: "released",
      releaseReason: reason,
      releasedAt: serverTimestamp(),
      holdExpiresAt: FieldValue.delete(),
      // Keep the frozen checkout evidence for the approved 30-day unpaid
      // support window. The bounded privacy worker removes only the approved
      // PII fields and retains this non-PII provider/capacity audit record.
      ...(piiAlreadyScrubbed && piiReintroduced ? {
        [PAYG_PII_REDACTION_RETRY_FIELD]: serverTimestamp(),
        piiRedactionReintroducedAt: serverTimestamp(),
      } : piiAlreadyScrubbed ? {
        [PAYG_PII_REDACTION_RETRY_FIELD]: FieldValue.delete(),
      } : piiRetentionCutoff === null ? {
        // Legacy/pre-launch rows without immutable evidence fail closed into
        // immediate redaction; never invent a later retention cutoff.
        [PAYG_PII_REDACTION_RETRY_FIELD]: serverTimestamp(),
      } : piiRedactionRetry === null ? {
        [PAYG_PII_REDACTION_RETRY_FIELD]:
          Timestamp.fromMillis(piiRetentionCutoff),
      } : {}),
      piiScrubAt: FieldValue.delete(),
      checkoutRecoveryToken: FieldValue.delete(),
      checkoutRecoveryLeaseExpiresAt: FieldValue.delete(),
      // Older pre-launch documents may carry the abandoned whole-document
      // TTL proposal. Explicitly disarm it so provider and audit state remains.
      piiDeleteAt: FieldValue.delete(),
      updatedAt: serverTimestamp(),
    }, {merge: true});
    return intent.capacityState !== "released";
  });
}

async function resumeExistingPaygCheckout(
  client: Stripe,
  intentRef: DocumentReference
): Promise<ReturnType<typeof checkoutResponse>> {
  const readResumableIntent = async (): Promise<PaygIntentDoc> => {
    const snapshot = await intentRef.get();
    if (!snapshot.exists) {
      throw paygError(
        "deadline-exceeded",
        "This PAYG checkout ended. Start again with a new checkout attempt."
      );
    }
    const current = snapshot.data() as PaygIntentDoc;
    const cutoff = timestampMillis(
      snapshot.get(PAYG_PII_RETENTION_CUTOFF_FIELD)
    );
    const privacyAlreadyClosed = hasNonNullDocumentField(
      snapshot,
      "piiScrubbedAt"
    );
    if (!privacyAlreadyClosed && cutoff !== null && cutoff > Date.now()) {
      return current;
    }
    const piiPresent = PAYG_INTENT_PII_FIELDS.some((field) =>
      hasNonNullDocumentField(snapshot, field)
    );
    await intentRef.set({
      [PAYG_PII_REDACTION_RETRY_FIELD]: piiPresent ?
        serverTimestamp() : FieldValue.delete(),
      ...(privacyAlreadyClosed && piiPresent ? {
        piiRedactionReintroducedAt: serverTimestamp(),
      } : {}),
      piiScrubAt: FieldValue.delete(),
      piiDeleteAt: FieldValue.delete(),
      updatedAt: serverTimestamp(),
    }, {merge: true});
    throw paygError(
      "deadline-exceeded",
      "This PAYG checkout ended. Start again with a new checkout attempt."
    );
  };
  let intent = await readResumableIntent();
  if (!intent.checkoutSessionId) {
    throw paygError(
      "unavailable",
      "This PAYG checkout is being recovered. Retry the same attempt shortly."
    );
  }
  let session: Stripe.Checkout.Session;
  try {
    session = await client.checkout.sessions.retrieve(intent.checkoutSessionId);
  } catch {
    throw paygError(
      "unavailable",
      "This PAYG checkout could not be verified. Retry the same attempt shortly."
    );
  }
  assertSessionBinding(session, intentRef.id, intent);
  if (session.status === "open" && session.expires_at > Math.floor(Date.now() / 1000)) {
    // Provider I/O can outlive the privacy window. Re-read immediately before
    // returning the customer-bearing URL and fail closed if closure won.
    intent = await readResumableIntent();
    return checkoutResponse("resumed", session, intent);
  }
  if (session.status === "complete") {
    throw paygError(
      "failed-precondition",
      "This checkout has already been submitted and payment is processing.",
      "checkout_processing"
    );
  }
  await releasePaygHold(intentRef, "stripe_session_ended", session.id);
  throw paygError(
    "deadline-exceeded",
    "This PAYG checkout expired. Start again with a new checkout attempt."
  );
}

function paygRequestSourceAddress(request: any): string {
  return canonicalizePaygSourceAddress(
    request?.rawRequest?.ip ??
    request?.rawRequest?.socket?.remoteAddress ??
    request?.rawRequest?.headers?.["x-forwarded-for"]
  );
}

async function admitPaygCheckoutAttempt(
  request: any,
  normalized: NormalizedPaygCheckoutRequest,
  requestFingerprint: string,
  nowMillis: number
): Promise<{
  duplicateLockId: string;
  duplicateLockKeyId: string;
  duplicateLockCandidates: readonly Readonly<{kid: string; lockId: string}>[];
}> {
  const secret = paygCheckoutRateLimitSecret.value().trim();
  const keys = derivePaygAbuseKeys(
    secret,
    paygRequestSourceAddress(request),
    normalized.checkoutAttemptId,
    requestFingerprint,
    nowMillis
  );
  const duplicateLockCandidates = derivePaygDuplicateLockCandidates(
    duplicateLockKeyring(nowMillis),
    normalized.classId,
    normalized.attendee.fullName,
    normalized.attendee.dateOfBirth
  );
  const currentDuplicateLock = duplicateLockCandidates[0];
  if (!currentDuplicateLock) {
    throw new Error("PAYG duplicate-lock keyring has no signing key.");
  }
  const admissionRef = db().collection(PAYG_CHECKOUT_ADMISSION_COLLECTION)
    .doc(keys.attemptId);
  const minuteRef = db().collection(PAYG_CHECKOUT_RATE_LIMIT_COLLECTION)
    .doc(keys.minuteBucketId);
  const hourRef = db().collection(PAYG_CHECKOUT_RATE_LIMIT_COLLECTION)
    .doc(keys.hourBucketId);
  await db().runTransaction(async (tx) => {
    const [admission, minute, hour] = await Promise.all([
      tx.get(admissionRef),
      tx.get(minuteRef),
      tx.get(hourRef),
    ]);
    if (admission.exists) {
      if (admission.get("requestBinding") !== keys.requestBinding) {
        throw paygError(
          "failed-precondition",
          "This PAYG checkout attempt was already used with different details."
        );
      }
      const retryDecision = resolvePaygIdempotentRetryAdmission({
        currentRetryCount: admission.get("retryCount") ?? 0,
        windowStartedAtMillis:
          timestampMillis(admission.get("retryWindowStartedAt")) ??
          timestampMillis(admission.get("createdAt")),
        lastAttemptAtMillis:
          timestampMillis(admission.get("lastAttemptAt")) ??
          timestampMillis(admission.get("createdAt")),
        nowMillis,
      });
      if (!retryDecision.allowed) {
        if (retryDecision.reason === "invalid_state") {
          console.error("CRITICAL_PAYG_RETRY_ADMISSION_INVALID", {
            attemptId: keys.attemptId,
          });
        }
        throw paygError(
          "resource-exhausted",
          retryDecision.reason === "too_soon" ?
            "Wait a moment before retrying this PAYG checkout." :
            "This PAYG checkout has been retried too many times. Wait before trying again.",
          "payg_attempt_retry_limited"
        );
      }
      tx.set(admissionRef, {
        retryCount: retryDecision.retryCount,
        retryWindowStartedAt: Timestamp.fromMillis(
          retryDecision.windowStartedAtMillis
        ),
        lastAttemptAt: Timestamp.fromMillis(nowMillis),
        updatedAt: serverTimestamp(),
        expiresAt: Timestamp.fromMillis(nowMillis + 48 * 60 * 60 * 1000),
      }, {merge: true});
      return;
    }
    const minuteCount = typeof minute.get("count") === "number" ?
      Number(minute.get("count")) : 0;
    const hourCount = typeof hour.get("count") === "number" ?
      Number(hour.get("count")) : 0;
    if (minuteCount >= PAYG_RATE_LIMITS.attemptsPerMinute ||
      hourCount >= PAYG_RATE_LIMITS.attemptsPerHour) {
      throw paygError(
        "resource-exhausted",
        "Too many PAYG checkout attempts. Wait before trying again.",
        "payg_rate_limited"
      );
    }
    tx.create(admissionRef, {
      schemaVersion: PAYG_SCHEMA_VERSION,
      requestBinding: keys.requestBinding,
      sourcePseudonym: keys.sourcePseudonym,
      retryCount: 0,
      retryWindowStartedAt: Timestamp.fromMillis(nowMillis),
      lastAttemptAt: Timestamp.fromMillis(nowMillis),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(nowMillis + 48 * 60 * 60 * 1000),
    });
    tx.set(minuteRef, {
      schemaVersion: PAYG_SCHEMA_VERSION,
      kind: "minute",
      count: FieldValue.increment(1),
      updatedAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(nowMillis + 2 * 60 * 60 * 1000),
    }, {merge: true});
    tx.set(hourRef, {
      schemaVersion: PAYG_SCHEMA_VERSION,
      kind: "hour",
      count: FieldValue.increment(1),
      updatedAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(nowMillis + 48 * 60 * 60 * 1000),
    }, {merge: true});
  });
  return {
    duplicateLockId: currentDuplicateLock.lockId,
    duplicateLockKeyId: currentDuplicateLock.kid,
    duplicateLockCandidates,
  };
}

export function buildCreatePaygCheckoutSession() {
  return onCall({
    region: REGION,
    secrets: PAYG_CHECKOUT_SECRETS,
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
    const acceptanceEvidenceDigest = derivePaygAcceptanceEvidenceDigest(
      paygDuplicateLockSecret.value().trim(),
      normalized,
      legal
    );
    const nowMillis = Date.now();
    assertPaygDataPlaneEnvironment();
    const admission = await admitPaygCheckoutAttempt(
      request,
      normalized,
      fingerprint,
      nowMillis
    );
    const {client, environment, ids} = await loadApprovedPaygPrice();
    const origin = resolvePublicOrigin();
    const nowUnixSeconds = Math.floor(nowMillis / 1000);
    const intentRef = db().collection("paygIntents")
      .doc(paygIntentId(normalized.checkoutAttemptId));
    const duplicateLockRefs = admission.duplicateLockCandidates.map((candidate) =>
      db().collection(PAYG_DUPLICATE_LOCK_COLLECTION).doc(candidate.lockId)
    );
    const duplicateLockRef = duplicateLockRefs[0];
    if (!duplicateLockRef) {
      throw paygError("failed-precondition", "PAYG duplicate protection is unavailable.");
    }
    const checkoutAttemptHash = sha256(
      `payg-checkout-attempt:${normalized.checkoutAttemptId}`
    );

    const reservation = await db().runTransaction(async (tx) => {
      const reservationNowMillis = Math.max(nowMillis, Date.now());
      const [existing, classSnap, duplicateLocks] = await Promise.all([
        tx.get(intentRef),
        tx.get(db().collection("classes").doc(normalized.classId)),
        Promise.all(duplicateLockRefs.map((ref) => tx.get(ref))),
      ]);
      if (existing.exists) {
        const intent = existing.data() as PaygIntentDoc;
        const piiRetentionCutoff = timestampMillis(
          existing.get(PAYG_PII_RETENTION_CUTOFF_FIELD)
        );
        const privacyAlreadyClosed = hasNonNullDocumentField(
          existing,
          "piiScrubbedAt"
        );
        const piiPresent = PAYG_INTENT_PII_FIELDS.some((field) =>
          hasNonNullDocumentField(existing, field)
        );
        if (privacyAlreadyClosed || piiRetentionCutoff === null ||
          piiRetentionCutoff <= reservationNowMillis) {
          tx.set(existing.ref, {
            [PAYG_PII_REDACTION_RETRY_FIELD]: piiPresent ?
              serverTimestamp() : FieldValue.delete(),
            ...(privacyAlreadyClosed && piiPresent ? {
              piiRedactionReintroducedAt: serverTimestamp(),
            } : {}),
            piiScrubAt: FieldValue.delete(),
            piiDeleteAt: FieldValue.delete(),
            updatedAt: serverTimestamp(),
          }, {merge: true});
          return {kind: "ended" as const, intent};
        }
        if (intent.requestFingerprint !== fingerprint ||
          intent.checkoutAttemptHash !== checkoutAttemptHash) {
          throw paygError(
            "failed-precondition",
            "This checkout attempt was already used with different PAYG details."
          );
        }
        if (!admission.duplicateLockCandidates.some((candidate) =>
          candidate.lockId === intent.duplicateLockId
        )) {
          throw paygError(
            "failed-precondition",
            "This PAYG attempt does not match its class-attendee reservation."
          );
        }
        if (intent.stripeMode !== environment.stripeMode ||
          intent.stripePriceId !== ids.priceId ||
          intent.stripeProductId !== ids.productId) {
          throw paygError(
            "failed-precondition",
            "This PAYG attempt belongs to a different approved Stripe catalogue."
          );
        }
        if (intent.status === "fulfilled" || intent.status === "payment_pending") {
          return {kind: "processing" as const, intent};
        }
        if (intent.status === "expired" || intent.status === "failed" ||
          intent.capacityState === "released") {
          return {kind: "ended" as const, intent};
        }
        if (intent.status === "checkout_created") {
          return {kind: "resume" as const, intent};
        }
        return {kind: "reserved" as const, intent};
      }

      if (!classSnap.exists) {
        throw paygError("not-found", "That class was not found.", "class_unavailable");
      }
      const publicClass = sanitizePublicPaygClass(
        classSnap.id,
        classSnap.data() as Record<string, unknown>,
        nowMillis
      );
      if (!publicClass || publicClass.availability === "unavailable") {
        throw paygError(
          "failed-precondition",
          "That class is not available for Pay As You Go booking.",
          "class_unavailable"
        );
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
        throw paygError(
          "failed-precondition",
          "That class is temporarily unavailable for PAYG checkout.",
          "payg_class_hold_counter_invalid"
        );
      }
      const activeUnpaidHolds = Number(storedUnpaidHolds ?? 0);
      if (activeUnpaidHolds >= unpaidHoldLimit) {
        throw paygError(
          "resource-exhausted",
          "That class has several PAYG checkouts in progress. Try again shortly.",
          "payg_class_checkout_busy"
        );
      }
      const classStartMillis = Date.parse(publicClass.startTime);
      const classEndMillis = Date.parse(publicClass.endTime);
      const ageAtClass = resolveAgeAtMillis(
        normalized.attendee.dateOfBirth,
        classStartMillis
      );
      if (ageAtClass < 18 || ageAtClass > 120) {
        throw paygError(
          "failed-precondition",
          "Pay As You Go class checkout is available only to adults aged 18 or over.",
          "adult_attendee_required"
        );
      }
      const checkoutExpiresAt = Math.min(
        nowUnixSeconds + PAYG_HOLD_DURATION_SECONDS,
        Math.floor(classStartMillis / 1000) - 60
      );
      if (checkoutExpiresAt - nowUnixSeconds < PAYG_MINIMUM_CHECKOUT_WINDOW_SECONDS) {
        throw paygError(
          "failed-precondition",
          "That class is too close to its start time for a new PAYG checkout.",
          "class_unavailable"
        );
      }
      const activeDuplicateLock = duplicateLocks.find((lock) => {
        const activeUntil = timestampMillis(lock.get("activeUntil"));
        return lock.exists && lock.get("intentId") !== intentRef.id &&
          (lock.get("status") === "held" || lock.get("status") === "booked") &&
          activeUntil !== null && activeUntil > nowMillis;
      });
      if (activeDuplicateLock) {
        throw paygError(
          "already-exists",
          "This attendee already has an active place or checkout for that class.",
          "payg_duplicate_class_attendee"
        );
      }
      const attendee: PaygAttendee = Object.freeze({
        ...normalized.attendee,
        ageAtClass,
      });
      const classSnapshot = classSnapshotFromPublic(publicClass);
      const intentPiiRetentionCutoffAt = Timestamp.fromMillis(
        checkoutExpiresAt * 1000 + PAYG_UNPAID_INTENT_RETENTION_MS
      );
      const intent: PaygIntentDoc = {
        schemaVersion: PAYG_SCHEMA_VERSION,
        checkoutSchemaVersion: PAYG_CHECKOUT_SCHEMA_VERSION,
        offeringKey: PAYG_OFFERING_KEY,
        purchaseKind: PAYG_PURCHASE_KIND,
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
        acceptances: {
          ...normalized.acceptances,
          legal,
          acceptedAt: serverTimestamp(),
        },
        acceptanceEvidenceDigest,
        privacy,
        class: classSnapshot,
        classStartMillis,
        classEndMillis,
        amountPence: PAYG_AMOUNT_PENCE,
        currency: PAYG_CURRENCY,
        publicOrigin: origin,
        checkoutExpiresAt,
        checkoutSessionId: null,
        checkoutSessionUrl: null,
        paymentIntentId: null,
        orderId: null,
        holdExpiresAt: Timestamp.fromMillis(checkoutExpiresAt * 1000),
        // The cutoff is immutable legal/privacy evidence. Only the separate
        // retry timestamp may move after a transient redaction failure.
        piiRetentionCutoffAt: intentPiiRetentionCutoffAt,
        piiRedactionRetryAt: intentPiiRetentionCutoffAt,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      tx.create(intentRef, intent);
      tx.set(duplicateLockRef, {
        schemaVersion: PAYG_SCHEMA_VERSION,
        status: "held",
        intentId: intentRef.id,
        lockKeyId: admission.duplicateLockKeyId,
        classIdHash: hmacSha256(
          paygCheckoutRateLimitSecret.value().trim(),
          `payg-class:v1:${normalized.classId}`
        ),
        activeUntil: Timestamp.fromMillis(checkoutExpiresAt * 1000),
        deleteAt: Timestamp.fromMillis(
          classEndMillis + PAYG_UNPAID_INTENT_RETENTION_MS
        ),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      tx.set(classSnap.ref, {
        bookedCount: FieldValue.increment(1),
        paygUnpaidHoldCount: FieldValue.increment(1),
        paygUnpaidHoldLimit: unpaidHoldLimit,
        updatedAt: serverTimestamp(),
      }, {merge: true});
      return {kind: "reserved" as const, intent};
    });

    if (reservation.kind === "processing") {
      throw paygError(
        "failed-precondition",
        "This checkout has already been submitted and payment is processing.",
        "checkout_processing"
      );
    }
    if (reservation.kind === "ended") {
      throw paygError(
        "deadline-exceeded",
        "This PAYG checkout ended. Start again with a new checkout attempt."
      );
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
    let session: Stripe.Checkout.Session;
    try {
      session = await client.checkout.sessions.create(params, {
        idempotencyKey: `payg-checkout:${intent.checkoutAttemptHash}`,
      });
      assertSessionBinding(session, intentRef.id, intent);
    } catch (error) {
      if (isDefinitiveStripeCreateFailure(error)) {
        await releasePaygHold(intentRef, "checkout_create_failed");
        console.error("Stripe rejected PAYG Checkout creation", {
          intentId: intentRef.id,
          error,
        });
        throw paygError(
          "failed-precondition",
          "PAYG Checkout could not start because its billing setup needs attention.",
          "stripe_checkout_configuration"
        );
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
      if (!fresh.exists) throw new Error(`PAYG intent ${intentRef.id} disappeared.`);
      const current = fresh.data() as PaygIntentDoc;
      if (current.checkoutSessionId && current.checkoutSessionId !== session.id) {
        throw new Error(`PAYG intent ${intentRef.id} is bound to another Session.`);
      }
      if (current.capacityState !== "held" ||
        current.status === "expired" || current.status === "failed") {
        throw paygError(
          "deadline-exceeded",
          "This PAYG hold ended before Stripe returned. Start again."
        );
      }
      const cutoff = timestampMillis(
        fresh.get(PAYG_PII_RETENTION_CUTOFF_FIELD)
      );
      const privacyAlreadyClosed = hasNonNullDocumentField(
        fresh,
        "piiScrubbedAt"
      );
      if (privacyAlreadyClosed || cutoff === null || cutoff <= Date.now()) {
        const piiPresent = PAYG_INTENT_PII_FIELDS.some((field) =>
          hasNonNullDocumentField(fresh, field)
        );
        tx.set(intentRef, {
          checkoutSessionId: session.id,
          checkoutSessionUrl: FieldValue.delete(),
          [PAYG_PII_REDACTION_RETRY_FIELD]: piiPresent ?
            serverTimestamp() : FieldValue.delete(),
          ...(privacyAlreadyClosed && piiPresent ? {
            piiRedactionReintroducedAt: serverTimestamp(),
          } : {}),
          piiScrubAt: FieldValue.delete(),
          piiDeleteAt: FieldValue.delete(),
          privacyRecoveryBlockedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, {merge: true});
        return "privacy_closed" as const;
      }
      tx.set(intentRef, {
        status: "checkout_created",
        checkoutSessionId: session.id,
        checkoutSessionUrl: session.url,
        updatedAt: serverTimestamp(),
      }, {merge: true});
      return "recorded" as const;
    });
    if (sessionWrite === "privacy_closed") {
      let finalSession = session;
      if (finalSession.status === "open") {
        try {
          finalSession = await client.checkout.sessions.expire(finalSession.id);
        } catch (error) {
          finalSession = await client.checkout.sessions.retrieve(finalSession.id);
          if (finalSession.status === "open") throw error;
        }
      }
      if (finalSession.status === "complete" &&
        finalSession.payment_status === "paid") {
        await fulfilPaygCheckoutSession(finalSession);
      } else {
        await releasePaygHold(
          intentRef,
          "privacy_redacted_during_checkout_creation",
          finalSession.id
        );
      }
      throw paygError(
        "deadline-exceeded",
        "This PAYG checkout ended before Stripe returned. Start again."
      );
    }
    return checkoutResponse("created", session, {
      ...intent,
      status: "checkout_created",
      checkoutSessionId: session.id,
      checkoutSessionUrl: session.url,
    });
  });
}

function exactPaygLineItem(
  items: Stripe.ApiList<Stripe.LineItem>,
  intent: PaygIntentDoc
): boolean {
  if (items.has_more || items.data.length !== 1) return false;
  const item = items.data[0];
  const price = typeof item.price === "object" && item.price ? item.price : null;
  return item.quantity === 1 &&
    item.amount_total === PAYG_AMOUNT_PENCE &&
    item.currency === PAYG_CURRENCY &&
    price?.id === intent.stripePriceId &&
    idOf(price?.product) === intent.stripeProductId;
}

export function collectPaygPaidContractMismatches(input: Readonly<{
  session: Stripe.Checkout.Session;
  paymentIntent: Stripe.PaymentIntent;
  intentId: string;
  expectedClassId: string;
  expectedEmail: string;
  expectedPriceId: string;
  expectedProductId: string;
  exactLineItem: boolean;
  expectedLivemode: boolean;
}>): string[] {
  const {session, paymentIntent} = input;
  const sessionEmail = session.customer_details?.email?.trim().toLowerCase() ||
    session.customer_email?.trim().toLowerCase() || null;
  const mismatches: string[] = [];
  if (session.livemode !== input.expectedLivemode) mismatches.push("session_mode");
  if (session.mode !== "payment" || session.client_reference_id !== input.intentId ||
    session.metadata?.purchaseKind !== PAYG_PURCHASE_KIND ||
    session.metadata?.offeringKey !== PAYG_OFFERING_KEY ||
    session.metadata?.paygIntentId !== input.intentId ||
    session.metadata?.classId !== input.expectedClassId) {
    mismatches.push("session_binding");
  }
  if (session.status !== "complete" || session.payment_status !== "paid") {
    mismatches.push("session_payment_state");
  }
  if (session.amount_total !== PAYG_AMOUNT_PENCE ||
    session.currency !== PAYG_CURRENCY ||
    (session.total_details?.amount_discount ?? 0) !== 0 ||
    session.subscription !== null) {
    mismatches.push("session_commercial_contract");
  }
  if (sessionEmail !== input.expectedEmail) mismatches.push("session_email");
  if (paymentIntent.livemode !== input.expectedLivemode) {
    mismatches.push("payment_intent_mode");
  }
  if (paymentIntent.status !== "succeeded" ||
    paymentIntent.amount !== PAYG_AMOUNT_PENCE ||
    paymentIntent.amount_received !== PAYG_AMOUNT_PENCE ||
    paymentIntent.currency !== PAYG_CURRENCY) {
    mismatches.push("payment_intent_commercial_contract");
  }
  if (paymentIntent.metadata?.purchaseKind !== PAYG_PURCHASE_KIND ||
    paymentIntent.metadata?.offeringKey !== PAYG_OFFERING_KEY ||
    paymentIntent.metadata?.paygIntentId !== input.intentId ||
    paymentIntent.metadata?.classId !== input.expectedClassId ||
    paymentIntent.metadata?.schemaVersion !== String(PAYG_SCHEMA_VERSION)) {
    mismatches.push("payment_intent_binding");
  }
  if (!input.exactLineItem) mismatches.push("line_item_contract");
  // Keep these parameters in the pure contract even though exactLineItem is
  // calculated from them by the runtime helper.
  if (!input.expectedPriceId || !input.expectedProductId) {
    mismatches.push("catalogue_evidence");
  }
  return [...new Set(mismatches)];
}

export function isPaygPaymentRefundSafe(
  paymentIntent: Stripe.PaymentIntent,
  intentId: string,
  expectedLivemode: boolean
): boolean {
  return paymentIntent.livemode === expectedLivemode &&
    paymentIntent.status === "succeeded" &&
    paymentIntent.amount_received > 0 &&
    paymentIntent.currency === PAYG_CURRENCY &&
    paymentIntent.metadata?.purchaseKind === PAYG_PURCHASE_KIND &&
    paymentIntent.metadata?.offeringKey === PAYG_OFFERING_KEY &&
    paymentIntent.metadata?.paygIntentId === intentId &&
    paymentIntent.metadata?.schemaVersion === String(PAYG_SCHEMA_VERSION);
}

export type PaygPaymentSuccessEvidence = Readonly<{
  providerEventId: string;
  providerEventType:
    | "checkout.session.completed"
    | "checkout.session.async_payment_succeeded";
  providerEventCreatedSecond: number;
  checkoutSessionId: string;
  paymentIntentId: string;
  intentId: string;
  livemode: boolean;
}>;

function paygSuccessfulPaymentCompletedSecond(input: Readonly<{
  paymentIntent: Stripe.PaymentIntent;
  charge: Stripe.Charge | null;
  successEvidence: PaygPaymentSuccessEvidence | null;
  checkoutSessionId: string;
  intentId: string;
  expectedLivemode: boolean;
}>): number | null {
  const {paymentIntent, charge, successEvidence} = input;
  if (!charge || !successEvidence ||
    !isPaygPaymentRefundSafe(
      paymentIntent,
      input.intentId,
      input.expectedLivemode
    ) ||
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
    !Number.isSafeInteger(
      (successEvidence.providerEventCreatedSecond + 1) * 1000
    )) return null;
  return successEvidence.providerEventCreatedSecond;
}

export function paygPaymentCompletedBeforePiiCutoff(input: Readonly<{
  paymentIntent: Stripe.PaymentIntent;
  charge: Stripe.Charge | null;
  successEvidence: PaygPaymentSuccessEvidence | null;
  checkoutSessionId: string;
  intentId: string;
  expectedLivemode: boolean;
  piiRetentionCutoffAtMillis: number | null;
}>): boolean {
  const paymentCompletedSecond = paygSuccessfulPaymentCompletedSecond(input);
  return paymentCompletedSecond !== null &&
    input.piiRetentionCutoffAtMillis !== null &&
    Number.isSafeInteger(input.piiRetentionCutoffAtMillis) &&
    // Stripe timestamps have whole-second precision. Accept only when the
    // entire recorded success second precedes the immutable privacy boundary;
    // a success event in the cutoff second is intentionally rejected.
    (paymentCompletedSecond + 1) * 1000 <= input.piiRetentionCutoffAtMillis;
}

function hasCompletePaygIntentPiiEvidence(intent: PaygIntentDoc): boolean {
  return Boolean(
    // Once privacy has closed, a stale/manual write that puts identity fields
    // back on the intent must never reopen promotion into paid-record PII.
    (intent.piiScrubbedAt === undefined || intent.piiScrubbedAt === null) &&
    intent.attendee?.fullName && intent.attendee?.dateOfBirth &&
    intent.contact?.email &&
    intent.acceptances?.legal?.waiver?.sha256 &&
    intent.acceptances?.legal?.terms?.sha256 &&
    intent.acceptances?.legal?.privacyNotice?.sha256 &&
    intent.acceptances?.privacyNoticeVersionPresented ===
      intent.acceptances?.legal?.privacyNotice?.version &&
    /^[a-f0-9]{64}$/.test(intent.acceptanceEvidenceDigest || "") &&
    resolveStoredPaygPiiRetentionConfig(intent.privacy)
  );
}

function paygPiiPromotionMismatch(input: Readonly<{
  intent: PaygIntentDoc;
  paymentIntent: Stripe.PaymentIntent;
  charge: Stripe.Charge | null;
  successEvidence: PaygPaymentSuccessEvidence | null;
  checkoutSessionId: string;
  intentId: string;
  expectedLivemode: boolean;
  processingNowMillis: number;
}>): string | null {
  if (input.intent.piiScrubbedAt !== undefined &&
    input.intent.piiScrubbedAt !== null) {
    return "intent_pii_already_scrubbed";
  }
  if (!hasCompletePaygIntentPiiEvidence(input.intent)) {
    return "intent_evidence_missing";
  }
  const privacy = resolveStoredPaygPiiRetentionConfig(input.intent.privacy);
  if (!privacy) return "intent_evidence_missing";
  if (!Number.isSafeInteger(input.processingNowMillis) ||
    input.processingNowMillis <= 0) {
    return "destination_pii_processing_time_invalid";
  }
  let destinationCutoff: number;
  try {
    destinationCutoff = paygPiiRedactionDeadline(
      input.intent.classEndMillis,
      privacy.orderPiiRetentionDays
    );
  } catch {
    return "destination_pii_retention_cutoff_invalid";
  }
  if (destinationCutoff <= input.processingNowMillis) {
    return "destination_pii_retention_cutoff_reached";
  }
  const cutoff = timestampMillis(input.intent.piiRetentionCutoffAt);
  if (cutoff === null) return "intent_pii_retention_cutoff_missing";
  const paymentCompletedSecond = paygSuccessfulPaymentCompletedSecond(input);
  if (paymentCompletedSecond === null) {
    return "payment_completion_evidence_missing";
  }
  return (paymentCompletedSecond + 1) * 1000 <= cutoff ? null :
    "payment_completed_at_or_after_pii_cutoff";
}

class PaygPiiPromotionClosedError extends Error {
  constructor(readonly mismatch: string) {
    super(`PAYG PII promotion is closed: ${mismatch}.`);
  }
}

function buildPaygOrder(
  intentRef: DocumentReference,
  intent: PaygIntentDoc,
  session: Stripe.Checkout.Session,
  paymentIntent: Stripe.PaymentIntent | null,
  status: "confirmed" | "refund_pending" | "manual_review",
  capacityState: "held" | "released",
  bookingId: string | null
): PaygOrderDoc {
  const privacy = resolveStoredPaygPiiRetentionConfig(intent.privacy) ??
    Object.freeze({
      policyVersion: "unrecorded-v1",
      orderPiiRetentionDays: PAYG_ORDER_PII_RETENTION_DAYS,
      waiverPiiRetentionDays: PAYG_WAIVER_PII_RETENTION_DAYS,
    });
  const piiRetentionCutoffAt = Timestamp.fromMillis(paygPiiRedactionDeadline(
    intent.classEndMillis,
    privacy.orderPiiRetentionDays
  ));
  return {
    schemaVersion: PAYG_SCHEMA_VERSION,
    orderId: intentRef.id,
    offeringKey: PAYG_OFFERING_KEY,
    purchaseKind: PAYG_PURCHASE_KIND,
    status,
    capacityState,
    stripeMode: intent.stripeMode,
    stripePriceId: intent.stripePriceId,
    stripeProductId: intent.stripeProductId,
    checkoutSessionId: session.id,
    paymentIntentId: paymentIntent?.id ?? idOf(session.payment_intent),
    chargeId: paymentIntent ? idOf(paymentIntent.latest_charge) : null,
    amountPence: PAYG_AMOUNT_PENCE,
    currency: PAYG_CURRENCY,
    attendee: intent.attendee,
    contact: intent.contact,
    acceptances: intent.acceptances,
    acceptanceEvidenceDigest: intent.acceptanceEvidenceDigest,
    retainedAcceptanceEvidence: retainedPaygAcceptanceEvidence(intent),
    privacy,
    class: intent.class,
    classStartMillis: intent.classStartMillis,
    classEndMillis: intent.classEndMillis,
    bookingId,
    duplicateLockId: intent.duplicateLockId,
    confirmationEmailStatus: status === "confirmed" ? "pending" : "not_required",
    cancellationCutoffAt: Timestamp.fromMillis(
      intent.classStartMillis - PAYG_CANCELLATION_CUTOFF_HOURS * 60 * 60 * 1000
    ),
    piiRetentionCutoffAt,
    piiRedactionRetryAt: piiRetentionCutoffAt,
    ...(status === "confirmed" ? {
      noShowReviewAt: Timestamp.fromMillis(
        intent.classEndMillis + PAYG_NO_SHOW_REVIEW_DELAY_MS
      ),
    } : status === "refund_pending" ? {
      refundRecoveryAt: Timestamp.fromMillis(Date.now()),
    } : {}),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

function retainedPaygAcceptanceEvidence(intent: PaygIntentDoc) {
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
    retentionPolicyVersion: resolveStoredPaygPiiRetentionConfig(intent.privacy)
      ?.policyVersion ?? "unrecorded-v1",
  });
}

function normalizePaygConfirmationLegalAcceptance(
  value: PaygConfirmationLegalAcceptance
): PaygConfirmationLegalAcceptance {
  const acceptedAtMillis = Date.parse(value.acceptedAt);
  if (!Number.isSafeInteger(acceptedAtMillis) || acceptedAtMillis <= 0 ||
    new Date(acceptedAtMillis).toISOString() !== value.acceptedAt) {
    throw new Error("PAYG legal acceptance time is invalid.");
  }
  const normalizeDocument = (
    kind: "waiver" | "terms" | "privacy notice",
    document: PaygLegalDocument
  ): PaygLegalDocument => {
    if (!/^[A-Za-z0-9._-]{3,120}$/.test(document.version) ||
      !/^[a-f0-9]{64}$/.test(document.sha256)) {
      throw new Error(`PAYG ${kind} confirmation evidence is invalid.`);
    }
    let publicUrl: URL;
    try {
      publicUrl = new URL(document.publicUrl);
    } catch {
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

function validPaygConfirmationLegalAcceptance(
  value: unknown
): value is PaygConfirmationLegalAcceptance {
  if (!value || typeof value !== "object") return false;
  try {
    const candidate = value as PaygConfirmationLegalAcceptance;
    const normalized = normalizePaygConfirmationLegalAcceptance(candidate);
    return candidate.acceptedAt === normalized.acceptedAt &&
      candidate.waiver?.version === normalized.waiver.version &&
      candidate.waiver?.publicUrl === normalized.waiver.publicUrl &&
      candidate.waiver?.sha256 === normalized.waiver.sha256 &&
      candidate.terms?.version === normalized.terms.version &&
      candidate.terms?.publicUrl === normalized.terms.publicUrl &&
      candidate.terms?.sha256 === normalized.terms.sha256 &&
      candidate.privacyNotice?.version === normalized.privacyNotice.version &&
      candidate.privacyNotice?.publicUrl ===
        normalized.privacyNotice.publicUrl &&
      candidate.privacyNotice?.sha256 === normalized.privacyNotice.sha256;
  } catch {
    return false;
  }
}

function paygConfirmationLegalAcceptance(
  intent: PaygIntentDoc
): PaygConfirmationLegalAcceptance {
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
  let origin: URL;
  try {
    origin = new URL(intent.publicOrigin);
  } catch {
    throw new Error("PAYG stored public origin is invalid.");
  }
  if (origin.origin !== intent.publicOrigin) {
    throw new Error("PAYG stored public origin is invalid.");
  }
  return normalizePaygConfirmationLegalAcceptance({
    acceptedAt: new Date(acceptedAtMillis).toISOString(),
    waiver: {
      ...intent.acceptances.legal.waiver,
      publicUrl: new URL(
        intent.acceptances.legal.waiver.publicUrl,
        origin
      ).href,
    },
    terms: {
      ...intent.acceptances.legal.terms,
      publicUrl: new URL(
        intent.acceptances.legal.terms.publicUrl,
        origin
      ).href,
    },
    privacyNotice: {
      ...intent.acceptances.legal.privacyNotice,
      publicUrl: new URL(
        intent.acceptances.legal.privacyNotice.publicUrl,
        origin
      ).href,
    },
  });
}

function paygWaiverPiiRetentionCutoffAt(intent: PaygIntentDoc): Timestamp {
  const privacy = resolveStoredPaygPiiRetentionConfig(intent.privacy) ??
    Object.freeze({
      policyVersion: "unrecorded-v1",
      orderPiiRetentionDays: PAYG_ORDER_PII_RETENTION_DAYS,
      waiverPiiRetentionDays: PAYG_WAIVER_PII_RETENTION_DAYS,
    });
  return Timestamp.fromMillis(paygPiiRedactionDeadline(
    intent.classEndMillis,
    privacy.waiverPiiRetentionDays
  ));
}

function paygOrderPiiRetentionCutoffAt(intent: PaygIntentDoc): Timestamp {
  const privacy = resolveStoredPaygPiiRetentionConfig(intent.privacy) ??
    Object.freeze({
      policyVersion: "unrecorded-v1",
      orderPiiRetentionDays: PAYG_ORDER_PII_RETENTION_DAYS,
      waiverPiiRetentionDays: PAYG_WAIVER_PII_RETENTION_DAYS,
    });
  return Timestamp.fromMillis(paygPiiRedactionDeadline(
    intent.classEndMillis,
    privacy.orderPiiRetentionDays
  ));
}

export function buildPaygConfirmationOutboxPayload(input: Readonly<{
  orderId: string;
  recipientEmail: string;
  attendeeName: string;
  class: PaygClassSnapshot;
  amountPence: number;
  currency: string;
  publicOrigin: string;
  cancellationToken: string;
  cancellationCutoffAtMillis: number;
  legalAcceptance: PaygConfirmationLegalAcceptance;
}>) {
  const origin = input.publicOrigin.replace(/\/$/, "");
  const cancellationUrl = `${origin}/pay-as-you-go/cancel?token=${
    encodeURIComponent(input.cancellationToken)
  }`;
  return Object.freeze({
    schemaVersion: PAYG_SCHEMA_VERSION,
    kind: "payg_guest_confirmation" as const,
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
        cutoffHours: PAYG_CANCELLATION_CUTOFF_HOURS,
        beforeCutoff: "A cancellation made at least 24 hours before the class is refundable and releases the place.",
        afterCutoff: "A cancellation made under 24 hours before the class, or a no-show, is non-refundable.",
      }),
      cancellationUrl,
      legalAcceptance: normalizePaygConfirmationLegalAcceptance(
        input.legalAcceptance
      ),
    }),
  });
}

export type PaygConfirmationCorrectionStatus =
  | "cancelled"
  | "refund_pending"
  | "refunded"
  | "disputed"
  | "manual_review"
  | "no_show";

export function shouldEnqueuePaygConfirmationCorrection(
  status: PaygOrderStatus
): status is PaygConfirmationCorrectionStatus {
  return status === "cancelled" || status === "refund_pending" ||
    status === "refunded" || status === "disputed" ||
    status === "manual_review" || status === "no_show";
}

export function paygEmailLeaseCorrelation(leaseToken: string): string {
  if (!/^[A-Za-z0-9-]{16,128}$/.test(leaseToken)) {
    throw new Error("PAYG email lease token is invalid.");
  }
  return sha256(`payg-email-lease:v1:${leaseToken}`);
}

export function paygConfirmationCorrectionOutboxId(orderId: string): string {
  if (!/^payg_[a-f0-9]{64}$/.test(orderId)) {
    throw new Error("PAYG correction order ID is invalid.");
  }
  return `payg_correction_${sha256(`payg-confirmation-correction:v1:${orderId}`)}`;
}

export function buildPaygConfirmationCorrectionOutboxPayload(input: Readonly<{
  orderId: string;
  recipientEmail: string;
  attendeeName: string;
  class: PaygClassSnapshot;
  orderStatus: PaygConfirmationCorrectionStatus;
}>) {
  const outboxId = paygConfirmationCorrectionOutboxId(input.orderId);
  return Object.freeze({
    schemaVersion: PAYG_SCHEMA_VERSION,
    kind: "payg_guest_confirmation_correction" as const,
    orderId: input.orderId,
    outboxId,
    idempotencyKey: `payg-confirmation-correction/${input.orderId}/v1`,
    to: Object.freeze([input.recipientEmail]),
    templateData: Object.freeze({
      attendeeName: input.attendeeName,
      class: input.class,
      amountPence: PAYG_AMOUNT_PENCE,
      currency: PAYG_CURRENCY,
      orderStatus: input.orderStatus,
    }),
  });
}

export type PaygPostSendDecision = Readonly<{
  disposition: "lost" | "sent" | "accepted_after_state_change";
  enqueueCorrection: boolean;
}>;

export function resolvePaygConfirmationPostSend(input: Readonly<{
  outboxStatus: unknown;
  activeLeaseToken: unknown;
  tombstonedLeaseCorrelation: unknown;
  leaseToken: string;
  orderStatus: PaygOrderStatus | null;
  correctionExists: boolean;
}>): PaygPostSendDecision {
  const correlation = paygEmailLeaseCorrelation(input.leaseToken);
  const ownsActiveLease = (input.outboxStatus === "sending" ||
    input.outboxStatus === "reconciling") &&
    input.activeLeaseToken === input.leaseToken;
  const ownsTombstonedLease = input.outboxStatus === "tombstoned" &&
    input.tombstonedLeaseCorrelation === correlation;
  if (!ownsActiveLease && !ownsTombstonedLease) {
    return Object.freeze({disposition: "lost", enqueueCorrection: false});
  }
  if (input.orderStatus === "confirmed") {
    return Object.freeze({disposition: "sent", enqueueCorrection: false});
  }
  return Object.freeze({
    disposition: "accepted_after_state_change",
    enqueueCorrection: input.orderStatus !== null &&
      shouldEnqueuePaygConfirmationCorrection(input.orderStatus) &&
      !input.correctionExists,
  });
}

export function shouldRecoverPaygConfirmationAcceptance(input: Readonly<{
  kind: unknown;
  status: unknown;
  providerAcceptanceState: unknown;
  tombstonedLeaseCorrelation: unknown;
}>): boolean {
  return input.kind === "payg_guest_confirmation" &&
    (input.status === "tombstoned" || input.status === "reconciling") &&
    input.providerAcceptanceState === "unknown_in_flight" &&
    typeof input.tombstonedLeaseCorrelation === "string" &&
    /^[a-f0-9]{64}$/.test(input.tombstonedLeaseCorrelation);
}

export function resolvePaygEmailFailureAfterStateChange(input: Readonly<{
  ownsTombstonedLease: boolean;
  reconcileAfterStateChange: boolean;
  httpStatus: number | null;
  providerErrorName: string | null;
}>): "normal" | "reconcile_unknown" | "definitive_rejection" {
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

export function isPaygEmailFailureAmbiguous(
  httpStatus: number | null,
  providerErrorName: string | null
): boolean {
  if (providerErrorName === "missing_api_key") return false;
  return httpStatus === null || httpStatus === 408 || httpStatus === 429 ||
    (typeof httpStatus === "number" && httpStatus >= 500);
}

export function resolvePaygTombstoneLeaseCorrelation(input: Readonly<{
  status: unknown;
  leaseToken: unknown;
  providerAcceptanceState: unknown;
  ambiguousLeaseCorrelation: unknown;
}>): string | null {
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

function confirmationOutboxFor(
  intentRef: DocumentReference,
  intent: PaygIntentDoc
) {
  const signingKey = cancellationSigningKey();
  const token = signPaygCancellationToken({
    v: 1,
    orderId: intentRef.id,
    exp: Math.floor((intent.classEndMillis + 24 * 60 * 60 * 1000) / 1000),
  }, signingKey.secret, signingKey.kid);
  const piiRetentionCutoffAt = paygOrderPiiRetentionCutoffAt(intent);
  return {
    ...buildPaygConfirmationOutboxPayload({
      orderId: intentRef.id,
      recipientEmail: intent.contact.email,
      attendeeName: intent.attendee.fullName,
      class: intent.class,
      amountPence: PAYG_AMOUNT_PENCE,
      currency: PAYG_CURRENCY,
      publicOrigin: intent.publicOrigin,
      cancellationToken: token,
      cancellationCutoffAtMillis: intent.classStartMillis -
        PAYG_CANCELLATION_CUTOFF_HOURS * 60 * 60 * 1000,
      legalAcceptance: paygConfirmationLegalAcceptance(intent),
    }),
    piiRetentionCutoffAt,
    piiRedactionRetryAt: piiRetentionCutoffAt,
  };
}

function tombstonePaygConfirmation(
  tx: Transaction,
  outbox: DocumentSnapshot | null,
  reason: string
): void {
  if (!outbox?.exists || outbox.get("status") === "tombstoned") return;
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
  const recoveryAt = inFlightCorrelation ? Timestamp.fromMillis(Math.max(
    Date.now() + 60_000,
    leaseExpiresAt ?? 0,
    existingNextAttemptAt ?? 0
  )) : null;
  tx.set(outbox.ref, {
    status: "tombstoned",
    deliveryStateBeforeTombstone: outbox.get("status") ?? null,
    tombstoneReason: reason,
    tombstonedAt: serverTimestamp(),
    tombstonedLeaseCorrelation: inFlightCorrelation ?? FieldValue.delete(),
    ambiguousLeaseCorrelation: FieldValue.delete(),
    providerAcceptanceState: inFlightCorrelation ?
      "unknown_in_flight" : outbox.get("status") === "sent" ?
        "accepted_before_state_change" : "not_sent",
    reconcileAfterStateChange: inFlightCorrelation ? true : FieldValue.delete(),
    leaseToken: FieldValue.delete(),
    leaseExpiresAt: FieldValue.delete(),
    nextAttemptAt: recoveryAt ?? FieldValue.delete(),
    updatedAt: serverTimestamp(),
  }, {merge: true});
}

function paygDuplicateLockRef(lockId: unknown): DocumentReference | null {
  return typeof lockId === "string" && /^[a-f0-9]{64}$/.test(lockId) ?
    db().collection(PAYG_DUPLICATE_LOCK_COLLECTION).doc(lockId) : null;
}

function paygPaymentReviewRef(reviewId: unknown): DocumentReference | null {
  return typeof reviewId === "string" &&
    /^payg_[a-f0-9]{64}_[a-f0-9]{24}$/.test(reviewId) ?
    db().collection(PAYG_PAYMENT_REVIEW_COLLECTION).doc(reviewId) : null;
}

function releasePaygDuplicateLock(
  tx: Transaction,
  lock: DocumentSnapshot | null,
  orderId: string
): void {
  if (lock?.exists && lock.get("intentId") === orderId) tx.delete(lock.ref);
}

async function paygOrderRefForRefund(
  refund: Stripe.Refund
): Promise<DocumentReference | null> {
  const refundMatches = await db().collection("paygOrders")
    .where("refundId", "==", refund.id)
    .limit(2)
    .get();
  if (refundMatches.size > 1) {
    throw new Error(`Refund ${refund.id} belongs to multiple PAYG orders.`);
  }
  if (refundMatches.size === 1) return refundMatches.docs[0].ref;

  const paymentIntentId = idOf(refund.payment_intent);
  if (paymentIntentId) {
    const paymentMatches = await db().collection("paygOrders")
      .where("paymentIntentId", "==", paymentIntentId)
      .limit(2)
      .get();
    if (paymentMatches.size > 1) {
      throw new Error(`PaymentIntent ${paymentIntentId} has multiple PAYG orders.`);
    }
    if (paymentMatches.size === 1) return paymentMatches.docs[0].ref;
  }

  const metadataOrderId = refund.metadata?.paygOrderId;
  if (typeof metadataOrderId !== "string" ||
    !/^payg_[a-f0-9]{64}$/.test(metadataOrderId)) return null;
  const metadataOrder = await db().collection("paygOrders").doc(metadataOrderId).get();
  return metadataOrder.exists ? metadataOrder.ref : null;
}

async function convergePaygRefund(refund: Stripe.Refund): Promise<boolean> {
  const compatibleRefund = refund as Stripe.Refund & {livemode?: unknown};
  if (typeof compatibleRefund.livemode === "boolean") {
    assertStripeObjectMode("Refund", refund.id, compatibleRefund.livemode);
  }
  const orderRef = await paygOrderRefForRefund(refund);
  if (!orderRef) return false;
  await db().runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) throw new Error(`PAYG order ${orderRef.id} disappeared.`);
    const order = orderSnap.data() as PaygOrderDoc;
    const bookingRef = order.bookingId ?
      db().collection("bookings").doc(order.bookingId) : null;
    const classRef = db().collection("classes").doc(order.class.classId);
    const outboxRef = db().collection("paygEmailOutbox").doc(orderRef.id);
    const lockRef = paygDuplicateLockRef(order.duplicateLockId);
    const reviewRef = paygPaymentReviewRef(orderSnap.get("paymentReviewId"));
    const [bookingSnap, classSnap, outboxSnap, lockSnap, reviewSnap] =
      await Promise.all([
        bookingRef ? tx.get(bookingRef) : Promise.resolve(null),
        tx.get(classRef),
        tx.get(outboxRef),
        lockRef ? tx.get(lockRef) : Promise.resolve(null),
        reviewRef ? tx.get(reviewRef) : Promise.resolve(null),
      ]);
    const storedExpectedAmount = Number(
      (order as PaygOrderDoc & {refundExpectedAmountPence?: unknown})
        .refundExpectedAmountPence
    );
    const expectedAmount = Number.isSafeInteger(storedExpectedAmount) &&
      storedExpectedAmount > 0 ? storedExpectedAmount : order.amountPence;
    const paymentIntentId = idOf(refund.payment_intent);
    const exactProviderBinding = order.purchaseKind === PAYG_PURCHASE_KIND &&
      order.paymentIntentId !== null &&
      paymentIntentId === order.paymentIntentId &&
      refund.currency === order.currency &&
      refund.amount === expectedAmount;
    const knownStatus = refund.status === "pending" ||
      refund.status === "succeeded" || refund.status === "failed" ||
      refund.status === "canceled";
    const linkedReview = reviewSnap?.exists &&
      reviewSnap.get("orderId") === orderRef.id &&
      reviewSnap.get("paymentIntentId") === order.paymentIntentId;
    if (reviewSnap?.exists && !linkedReview) {
      console.error("CRITICAL_BILLING_PAYG_ORDER_REVIEW_LINK_MISMATCH", {
        orderId: orderRef.id,
        paymentReviewId: reviewSnap.id,
      });
    }
    if (!exactProviderBinding || !knownStatus) {
      const preserved = order.status === "refunded" ||
        order.status === "disputed" || order.status === "manual_review" ?
        order.status : "manual_review";
      await releasePaidOrderCapacity(
        tx,
        orderRef,
        order,
        bookingSnap,
        classSnap,
        outboxSnap,
        lockSnap,
        {
          status: preserved,
          cancelledReason: "refund_manual_review",
          refundId: refund.id,
          refundStatus: exactProviderBinding ?
            `unsupported_${String(refund.status)}` :
            "provider_contract_mismatch",
          refundRecoveryAt: FieldValue.delete(),
          refundFailureReason: refund.failure_reason ?? null,
        }
      );
      if (linkedReview) {
        tx.set(reviewSnap.ref, {
          status: resolvePaygLinkedReviewRefundStatus(
            reviewSnap.get("status"),
            null,
            false
          ),
          refundId: refund.id,
          refundStatus: exactProviderBinding ?
            `unsupported_${String(refund.status)}` :
            "provider_contract_mismatch",
          refundRecoveryAt: FieldValue.delete(),
          refundFailureReason: refund.failure_reason ?? null,
          ...paygRefundClaimCleanup(),
          updatedAt: serverTimestamp(),
        }, {merge: true});
      }
      console.error("CRITICAL_BILLING_PAYG_REFUND_MANUAL_REVIEW", {
        orderId: orderRef.id,
        refundId: refund.id,
        exactProviderBinding,
        refundStatus: refund.status,
      });
      return;
    }

    const status = refund.status as PaygRefundStatus;
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
      await releasePaidOrderCapacity(
        tx,
        orderRef,
        order,
        bookingSnap,
        classSnap,
        outboxSnap,
        lockSnap,
        {
          status: preservedStatus,
          cancelledReason: "payg_refunded",
          refundId: refund.id,
          refundStatus: "succeeded",
          refundRecoveryAt: FieldValue.delete(),
        }
      );
      if (linkedReview) {
        tx.set(reviewSnap.ref, {
          status: resolvePaygLinkedReviewRefundStatus(
            reviewSnap.get("status"),
            "succeeded",
            true
          ),
          refundId: refund.id,
          refundStatus: "succeeded",
          refundRecoveryAt: FieldValue.delete(),
          ...paygRefundClaimCleanup(),
          updatedAt: serverTimestamp(),
        }, {merge: true});
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
      await releasePaidOrderCapacity(
        tx,
        orderRef,
        order,
        bookingSnap,
        classSnap,
        outboxSnap,
        lockSnap,
        {
          status: order.status === "disputed" ? "disputed" : "manual_review",
          cancelledReason: "refund_id_conflict_manual_review",
          refundStatus: "conflicting_refund_id",
          conflictingRefundId: refund.id,
          refundRecoveryAt: FieldValue.delete(),
        }
      );
      if (linkedReview) {
        tx.set(reviewSnap.ref, {
          status: reviewSnap.get("status") === "disputed" ?
            "disputed" : "manual_review",
          refundStatus: "conflicting_refund_id",
          conflictingRefundId: refund.id,
          refundRecoveryAt: FieldValue.delete(),
          ...paygRefundClaimCleanup(),
          updatedAt: serverTimestamp(),
        }, {merge: true});
      }
      console.error("CRITICAL_BILLING_PAYG_REFUND_ID_CONFLICT", {
        orderId: orderRef.id,
        storedRefundId: orderSnap.get("refundId") ?? null,
        incomingRefundId: refund.id,
      });
      return;
    }
    const deliberatePendingPoll = pendingBinding === "bind_and_recover" ||
      pendingBinding === "recover_bound";
    if (linkedReview) {
      const reviewStatus = resolvePaygLinkedReviewRefundStatus(
        reviewSnap.get("status"),
        status,
        true
      );
      tx.set(reviewSnap.ref, {
        status: reviewStatus,
        refundId: refund.id,
        refundStatus: status,
        refundedAmountPence: status === "succeeded" ?
          refund.amount : FieldValue.delete(),
        refundedAt: status === "succeeded" ?
          serverTimestamp() : FieldValue.delete(),
        refundFailureReason: refund.failure_reason ?? FieldValue.delete(),
        ...(deliberatePendingPoll && reviewStatus === "refund_pending" ? {
          refundRecoveryAt: Timestamp.fromMillis(Date.now() + 5 * 60 * 1000),
        } : {
          refundRecoveryAt: FieldValue.delete(),
        }),
        ...paygRefundClaimCleanup(),
        updatedAt: serverTimestamp(),
      }, {merge: true});
    }
    if (status === "succeeded") {
      await releasePaidOrderCapacity(
        tx,
        orderRef,
        order,
        bookingSnap,
        classSnap,
        outboxSnap,
        lockSnap,
        {
          status: decision.orderStatus,
          cancelledReason: "payg_refunded",
          refundId: refund.id,
          refundStatus: status,
          refundedAmountPence: refund.amount,
          refundRecoveryAt: FieldValue.delete(),
          refundedAt: serverTimestamp(),
        }
      );
      return;
    }

    await releasePaidOrderCapacity(
      tx,
      orderRef,
      order,
      bookingSnap,
      classSnap,
      outboxSnap,
      lockSnap,
      {
        status: decision.orderStatus,
        cancelledReason: `payg_refund_${status}`,
        refundId: refund.id,
        refundStatus: status,
        refundFailureReason: refund.failure_reason ?? FieldValue.delete(),
        ...(decision.scheduleRecovery && deliberatePendingPoll ? {
          refundRecoveryAt: Timestamp.fromMillis(Date.now() + 5 * 60 * 1000),
        } : {
          refundRecoveryAt: FieldValue.delete(),
        }),
      }
    );
  });
  return true;
}

function paygRefundClaimEligible(
  snapshot: DocumentSnapshot,
  kind: PaygRefundClaimKind
): boolean {
  return snapshot.get("status") === "refund_pending" &&
    snapshot.get("disputeOpen") !== true &&
    snapshot.get("refundAutomationStatus") !== "suspended_dispute" &&
    (kind === "order" || snapshot.get("automaticRefundSafe") === true);
}

function paygRefundClaimCleanup() {
  return {
    refundAutomationClaimToken: FieldValue.delete(),
    refundAutomationClaimExpiresAt: FieldValue.delete(),
    refundAutomationClaimedAt: FieldValue.delete(),
    refundAutomationClaimPaymentIntentId: FieldValue.delete(),
    refundAutomationClaimProviderCheckedAt: FieldValue.delete(),
  };
}

async function acquirePaygRefundIssuanceClaim(
  ref: DocumentReference,
  kind: PaygRefundClaimKind,
  nowMillis = Date.now(),
  token = randomUUID()
): Promise<PaygRefundClaimResult> {
  if (!Number.isSafeInteger(nowMillis) || nowMillis <= 0 ||
    !/^[A-Za-z0-9-]{16,128}$/.test(token)) {
    throw new Error("PAYG refund issuance claim input is invalid.");
  }
  return db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) {
      throw new Error(`PAYG ${kind.replace("_", " ")} ${ref.id} was not found.`);
    }
    if (snapshot.get("status") === "refunded" ||
      snapshot.get("refundStatus") === "succeeded") {
      return {state: "complete" as const};
    }
    const refundId = snapshot.get("refundId");
    if (typeof refundId === "string" && refundId.startsWith("re_")) {
      return {state: "existing" as const, refundId};
    }
    if (!paygRefundClaimEligible(snapshot, kind)) {
      return {state: "blocked" as const};
    }
    const paymentIntentId = snapshot.get("paymentIntentId");
    if (typeof paymentIntentId !== "string" ||
      !paymentIntentId.startsWith("pi_")) {
      tx.set(ref, {
        status: snapshot.get("status") === "disputed" ?
          "disputed" : "manual_review",
        refundStatus: "missing_payment_intent",
        refundRecoveryAt: FieldValue.delete(),
        ...paygRefundClaimCleanup(),
        updatedAt: serverTimestamp(),
      }, {merge: true});
      return {state: "blocked" as const};
    }
    const existingToken = snapshot.get("refundAutomationClaimToken");
    const existingExpiry = timestampMillis(
      snapshot.get("refundAutomationClaimExpiresAt")
    );
    if (typeof existingToken === "string" && existingToken !== token &&
      existingExpiry !== null && existingExpiry > nowMillis) {
      return {state: "in_progress" as const};
    }
    const claimExpiresAt = nowMillis + PAYG_REFUND_ISSUANCE_CLAIM_MS;
    tx.set(ref, {
      refundAutomationClaimToken: token,
      refundAutomationClaimExpiresAt: Timestamp.fromMillis(claimExpiresAt),
      refundAutomationClaimedAt: serverTimestamp(),
      refundAutomationClaimPaymentIntentId: paymentIntentId,
      // A crashed owner becomes recoverable when its bounded claim expires.
      refundRecoveryAt: Timestamp.fromMillis(claimExpiresAt),
      updatedAt: serverTimestamp(),
    }, {merge: true});
    const expectedAmount = Number(snapshot.get("refundExpectedAmountPence"));
    return {
      state: "acquired" as const,
      token,
      paymentIntentId,
      expectedChargeId: typeof snapshot.get("chargeId") === "string" ?
        snapshot.get("chargeId") : null,
      expectedAmountPence: kind === "payment_review" &&
        Number.isSafeInteger(expectedAmount) && expectedAmount > 0 ?
        expectedAmount : null,
      expectedCurrency: typeof snapshot.get("providerCurrency") === "string" ?
        snapshot.get("providerCurrency") :
        typeof snapshot.get("currency") === "string" ?
          snapshot.get("currency") : null,
      intentId: typeof snapshot.get("intentId") === "string" ?
        snapshot.get("intentId") : null,
    };
  });
}

type PaygRefundProviderRefresh = Readonly<{
  disputed: boolean;
  safe: boolean;
  reason: string | null;
}>;

async function refreshPaygRefundProviderState(input: Readonly<{
  paymentIntentId: string;
  expectedChargeId: string | null;
  expectedAmountPence: number | null;
  expectedCurrency: string | null;
}>): Promise<PaygRefundProviderRefresh> {
  const paymentIntent = await stripe().paymentIntents.retrieve(
    input.paymentIntentId,
    {expand: ["latest_charge"]}
  );
  assertStripeObjectMode(
    "PaymentIntent",
    paymentIntent.id,
    paymentIntent.livemode
  );
  const chargeId = idOf(paymentIntent.latest_charge);
  if (!chargeId) {
    return {disputed: false, safe: false, reason: "missing_latest_charge"};
  }
  const charge = await stripe().charges.retrieve(chargeId);
  assertStripeObjectMode("Charge", charge.id, charge.livemode);
  if (charge.disputed === true) {
    return {disputed: true, safe: false, reason: "provider_dispute_open"};
  }
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
    input.expectedCurrency &&
      paymentIntent.currency !== input.expectedCurrency ? "currency" : null,
  ].filter((value): value is string => Boolean(value));
  return {
    disputed: false,
    safe: mismatches.length === 0,
    reason: mismatches.length ? `provider_${mismatches.join("_")}` : null,
  };
}

async function confirmPaygRefundIssuanceClaim(
  ref: DocumentReference,
  kind: PaygRefundClaimKind,
  claim: Extract<PaygRefundClaimResult, {state: "acquired"}>,
  nowMillis = Date.now()
): Promise<boolean> {
  return db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const claimExpiresAt = snapshot.exists ? timestampMillis(
      snapshot.get("refundAutomationClaimExpiresAt")
    ) : null;
    const valid = snapshot.exists &&
      snapshot.get("refundAutomationClaimToken") === claim.token &&
      snapshot.get("refundAutomationClaimPaymentIntentId") ===
        claim.paymentIntentId &&
      claimExpiresAt !== null && claimExpiresAt > nowMillis &&
      paygRefundClaimEligible(snapshot, kind);
    if (!valid) {
      if (snapshot.exists &&
        snapshot.get("refundAutomationClaimToken") === claim.token) {
        tx.set(ref, {
          ...paygRefundClaimCleanup(),
          ...(snapshot.get("disputeOpen") === true ||
            snapshot.get("refundAutomationStatus") === "suspended_dispute" ? {
              refundRecoveryAt: FieldValue.delete(),
            } : {}),
          updatedAt: serverTimestamp(),
        }, {merge: true});
      }
      return false;
    }
    tx.set(ref, {
      refundAutomationClaimProviderCheckedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, {merge: true});
    return true;
  });
}

async function finishPaygRefundIssuanceClaim(
  ref: DocumentReference,
  kind: PaygRefundClaimKind,
  claimToken: string,
  update: Record<string, unknown>
): Promise<boolean> {
  return db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return false;
    const ownsClaim = snapshot.get("refundAutomationClaimToken") === claimToken;
    if (!ownsClaim) return false;
    if (!paygRefundClaimEligible(snapshot, kind)) {
      // A dispute/refund terminal transition won the race. Revoke only this
      // stale claim and preserve every newer status/provider fact.
      tx.set(ref, {
        ...paygRefundClaimCleanup(),
        updatedAt: serverTimestamp(),
      }, {merge: true});
      return false;
    }
    tx.set(ref, {
      ...update,
      ...paygRefundClaimCleanup(),
      updatedAt: serverTimestamp(),
    }, {merge: true});
    return true;
  });
}

async function persistCreatedPaygRefund(
  ref: DocumentReference,
  claimToken: string,
  refundId: string,
  reason?: PaygRefundReason
): Promise<void> {
  await db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return;
    const ownsClaim = snapshot.get("refundAutomationClaimToken") === claimToken;
    const storedRefundId = snapshot.get("refundId");
    const conflictingRefundId = typeof storedRefundId === "string" &&
      storedRefundId.startsWith("re_") && storedRefundId !== refundId;
    tx.set(ref, {
      ...(conflictingRefundId ? {
        conflictingRefundId: refundId,
      } : {
        refundId,
      }),
      ...(reason ? {refundReason: reason} : {}),
      ...(ownsClaim ? paygRefundClaimCleanup() : {}),
      updatedAt: serverTimestamp(),
    }, {merge: true});
  });
}

async function recordPaygRefundProviderDispute(
  ref: DocumentReference,
  kind: PaygRefundClaimKind,
  claimToken: string
): Promise<void> {
  const suspended = await finishPaygRefundIssuanceClaim(
    ref,
    kind,
    claimToken,
    {
      status: "manual_review",
      refundAutomationStatus: "suspended_dispute",
      refundStatus: "provider_dispute_detected",
      providerDisputeDetectedAt: serverTimestamp(),
      refundRecoveryAt: FieldValue.delete(),
    }
  );
  if (!suspended) {
    return;
  }
  console.error(kind === "order" ?
    "CRITICAL_BILLING_PAYG_REFUND_PROVIDER_DISPUTE" :
    "CRITICAL_BILLING_PAYG_REVIEW_REFUND_PROVIDER_DISPUTE", {
    [`${kind === "order" ? "order" : "paymentReview"}Id`]: ref.id,
  });
}

async function recordPaygRefundIssuanceFailure(
  ref: DocumentReference,
  kind: PaygRefundClaimKind,
  claimToken: string,
  error: unknown
): Promise<void> {
  await db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists ||
      snapshot.get("refundAutomationClaimToken") !== claimToken) return;
    const canRetry = paygRefundClaimEligible(snapshot, kind);
    if (!canRetry) {
      tx.set(ref, {
        ...paygRefundClaimCleanup(),
        updatedAt: serverTimestamp(),
      }, {merge: true});
      return;
    }
    tx.set(ref, {
      ...paygRefundClaimCleanup(),
      refundRecoveryAt: Timestamp.fromMillis(Date.now() + 5 * 60 * 1000),
      refundLastError: error instanceof Error ?
        error.message.slice(0, 500) : String(error).slice(0, 500),
      updatedAt: serverTimestamp(),
    }, {merge: true});
  });
}

async function issuePaygRefund(
  orderId: string,
  reason: PaygRefundReason
): Promise<void> {
  const orderRef = db().collection("paygOrders").doc(orderId);
  const claim = await acquirePaygRefundIssuanceClaim(orderRef, "order");
  if (claim.state === "complete" || claim.state === "in_progress") return;
  if (claim.state === "blocked") {
    throw new Error(`PAYG order ${orderId} is not awaiting a refund.`);
  }
  let refund: Stripe.Refund;
  if (claim.state === "existing") {
    refund = await stripe().refunds.retrieve(claim.refundId);
    if (!await convergePaygRefund(refund)) {
      throw new Error(`Refund ${refund.id} has no matching PAYG order.`);
    }
    return;
  }

  let provider: PaygRefundProviderRefresh;
  try {
    provider = await refreshPaygRefundProviderState(claim);
  } catch (error) {
    await recordPaygRefundIssuanceFailure(
      orderRef,
      "order",
      claim.token,
      error
    );
    throw error;
  }
  if (provider.disputed) {
    await recordPaygRefundProviderDispute(orderRef, "order", claim.token);
    return;
  }
  if (!provider.safe) {
    const failed = await finishPaygRefundIssuanceClaim(
      orderRef,
      "order",
      claim.token,
      {
        status: "manual_review",
        refundAutomationStatus: "provider_preflight_failed",
        refundStatus: provider.reason ?? "provider_preflight_failed",
        refundRecoveryAt: FieldValue.delete(),
      }
    );
    if (failed) {
      console.error("CRITICAL_BILLING_PAYG_REFUND_PROVIDER_PREFLIGHT", {
        orderId,
        reason: provider.reason,
      });
    }
    return;
  }
  if (!await confirmPaygRefundIssuanceClaim(
    orderRef,
    "order",
    claim
  )) return;
  try {
    // Omitting amount requests the full remaining PaymentIntent amount. This
    // is essential for a paid-contract mismatch, where the captured amount
    // itself may differ from the approved PAYG price. The stable key recovers
    // a provider-success/local-crash window without issuing a second refund.
    refund = await stripe().refunds.create({
      payment_intent: claim.paymentIntentId,
      metadata: {
        purchaseKind: PAYG_PURCHASE_KIND,
        offeringKey: PAYG_OFFERING_KEY,
        paygOrderId: orderId,
        refundReason: reason,
        schemaVersion: String(PAYG_SCHEMA_VERSION),
      },
    }, {idempotencyKey: `payg-refund:${orderId}`});
  } catch (error) {
    await recordPaygRefundIssuanceFailure(
      orderRef,
      "order",
      claim.token,
      error
    );
    throw error;
  }
  await persistCreatedPaygRefund(orderRef, claim.token, refund.id, reason);
  if (!await convergePaygRefund(refund)) {
    throw new Error(`Refund ${refund.id} has no matching PAYG order.`);
  }
}

function paygPaymentReviewId(
  intentId: string,
  sessionId: string,
  paymentIntentId: string | null
): string {
  return `${intentId}_${sha256(paymentIntentId || sessionId).slice(0, 24)}`;
}

function isExactPaygPaymentReviewOwner(
  review: DocumentSnapshot,
  intentId: string,
  checkoutSessionId: string,
  paymentIntentId: string
): boolean {
  if (!review.exists) return false;
  const exact = review.get("intentId") === intentId &&
    review.get("checkoutSessionId") === checkoutSessionId &&
    review.get("paymentIntentId") === paymentIntentId;
  if (!exact) {
    throw new Error(
      `PAYG payment review ${review.id} conflicts with its deterministic owner binding.`
    );
  }
  return true;
}

async function paygPaymentReviewRefForRefund(
  refund: Stripe.Refund
): Promise<DocumentReference | null> {
  const refundMatches = await db().collection(PAYG_PAYMENT_REVIEW_COLLECTION)
    .where("refundId", "==", refund.id)
    .limit(2)
    .get();
  if (refundMatches.size > 1) {
    throw new Error(`Refund ${refund.id} belongs to multiple PAYG payment reviews.`);
  }
  if (refundMatches.size === 1) return refundMatches.docs[0].ref;
  const metadataReviewId = refund.metadata?.paygPaymentReviewId;
  if (typeof metadataReviewId === "string" &&
    /^payg_[a-f0-9]{64}_[a-f0-9]{24}$/.test(metadataReviewId)) {
    const direct = await db().collection(PAYG_PAYMENT_REVIEW_COLLECTION)
      .doc(metadataReviewId)
      .get();
    if (direct.exists) return direct.ref;
  }
  const paymentIntentId = idOf(refund.payment_intent);
  if (!paymentIntentId) return null;
  const paymentMatches = await db().collection(PAYG_PAYMENT_REVIEW_COLLECTION)
    .where("paymentIntentId", "==", paymentIntentId)
    .limit(2)
    .get();
  if (paymentMatches.size > 1) {
    throw new Error(
      `PaymentIntent ${paymentIntentId} has multiple PAYG payment reviews.`
    );
  }
  return paymentMatches.size === 1 ? paymentMatches.docs[0].ref : null;
}

async function convergePaygPaymentReviewRefund(
  refund: Stripe.Refund
): Promise<boolean> {
  const reviewRef = await paygPaymentReviewRefForRefund(refund);
  if (!reviewRef) return false;
  await db().runTransaction(async (tx) => {
    const review = await tx.get(reviewRef);
    if (!review.exists) return;
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
      tx.set(reviewRef, {
        status: "manual_review",
        refundId: refund.id,
        refundStatus: exact ?
          `unsupported_${String(refund.status)}` : "provider_contract_mismatch",
        refundRecoveryAt: FieldValue.delete(),
        refundFailureReason: refund.failure_reason ?? null,
        ...paygRefundClaimCleanup(),
        updatedAt: serverTimestamp(),
      }, {merge: true});
      console.error("CRITICAL_BILLING_PAYG_REVIEW_REFUND_MANUAL_REVIEW", {
        paymentReviewId: reviewRef.id,
        refundId: refund.id,
        exact,
        refundStatus: refund.status,
      });
      return;
    }
    const status = refund.status as PaygRefundStatus;
    if (shouldPreservePaygSucceededRefund({
      ownerStatus: review.get("status"),
      storedRefundId: review.get("refundId"),
      storedRefundStatus: review.get("refundStatus"),
      incomingRefundId: refund.id,
      incomingRefundStatus: status,
      exactProviderBinding: true,
    })) {
      tx.set(reviewRef, {
        status: review.get("status") === "disputed" ? "disputed" :
          review.get("status") === "manual_review" ? "manual_review" : "refunded",
        refundId: refund.id,
        refundStatus: "succeeded",
        refundRecoveryAt: FieldValue.delete(),
        ...paygRefundClaimCleanup(),
        updatedAt: serverTimestamp(),
      }, {merge: true});
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
      tx.set(reviewRef, {
        status: currentReviewStatus === "disputed" ? "disputed" : "manual_review",
        refundStatus: "conflicting_refund_id",
        conflictingRefundId: refund.id,
        refundRecoveryAt: FieldValue.delete(),
        ...paygRefundClaimCleanup(),
        updatedAt: serverTimestamp(),
      }, {merge: true});
      console.error("CRITICAL_BILLING_PAYG_REVIEW_REFUND_ID_CONFLICT", {
        paymentReviewId: reviewRef.id,
        storedRefundId: review.get("refundId") ?? null,
        incomingRefundId: refund.id,
      });
      return;
    }
    const deliberatePendingPoll = pendingBinding === "bind_and_recover" ||
      pendingBinding === "recover_bound";
    tx.set(reviewRef, {
      status: manualPrecedence ? currentReviewStatus :
        terminalSuccess ? "refunded" : terminalFailure ?
          "manual_review" : "refund_pending",
      refundId: refund.id,
      refundStatus: status,
      refundedAmountPence: terminalSuccess ? refund.amount : FieldValue.delete(),
      refundedAt: terminalSuccess ? serverTimestamp() : FieldValue.delete(),
      refundFailureReason: refund.failure_reason ?? FieldValue.delete(),
      ...(deliberatePendingPoll && !manualPrecedence ? {
        refundRecoveryAt: Timestamp.fromMillis(Date.now() + 5 * 60 * 1000),
      } : {
        refundRecoveryAt: FieldValue.delete(),
      }),
      ...paygRefundClaimCleanup(),
      updatedAt: serverTimestamp(),
    }, {merge: true});
  });
  return true;
}

async function issuePaygPaymentReviewRefund(reviewId: string): Promise<void> {
  const reviewRef = db().collection(PAYG_PAYMENT_REVIEW_COLLECTION).doc(reviewId);
  const claim = await acquirePaygRefundIssuanceClaim(
    reviewRef,
    "payment_review"
  );
  if (claim.state === "complete" || claim.state === "in_progress") return;
  if (claim.state === "blocked") {
    throw new Error(`PAYG payment review ${reviewId} is not refund-safe.`);
  }
  let refund: Stripe.Refund;
  if (claim.state === "existing") {
    refund = await stripe().refunds.retrieve(claim.refundId);
    if (!await convergePaygPaymentReviewRefund(refund)) {
      throw new Error(`Refund ${refund.id} has no matching PAYG payment review.`);
    }
    return;
  }

  let provider: PaygRefundProviderRefresh;
  try {
    provider = await refreshPaygRefundProviderState(claim);
  } catch (error) {
    await recordPaygRefundIssuanceFailure(
      reviewRef,
      "payment_review",
      claim.token,
      error
    );
    throw error;
  }
  if (provider.disputed) {
    await recordPaygRefundProviderDispute(
      reviewRef,
      "payment_review",
      claim.token
    );
    return;
  }
  if (!provider.safe) {
    const failed = await finishPaygRefundIssuanceClaim(
      reviewRef,
      "payment_review",
      claim.token,
      {
        status: "manual_review",
        refundAutomationStatus: "provider_preflight_failed",
        refundStatus: provider.reason ?? "provider_preflight_failed",
        refundRecoveryAt: FieldValue.delete(),
      }
    );
    if (failed) {
      console.error("CRITICAL_BILLING_PAYG_REVIEW_REFUND_PROVIDER_PREFLIGHT", {
        paymentReviewId: reviewId,
        reason: provider.reason,
      });
    }
    return;
  }
  if (!await confirmPaygRefundIssuanceClaim(
    reviewRef,
    "payment_review",
    claim
  )) return;
  try {
    refund = await stripe().refunds.create({
      payment_intent: claim.paymentIntentId,
      metadata: {
        purchaseKind: PAYG_PURCHASE_KIND,
        offeringKey: PAYG_OFFERING_KEY,
        paygIntentId: claim.intentId ?? "unrecorded",
        paygPaymentReviewId: reviewId,
        refundReason: "paid_contract_mismatch",
        schemaVersion: String(PAYG_SCHEMA_VERSION),
      },
    }, {idempotencyKey: `payg-review-refund:${reviewId}`});
  } catch (error) {
    await recordPaygRefundIssuanceFailure(
      reviewRef,
      "payment_review",
      claim.token,
      error
    );
    throw error;
  }
  await persistCreatedPaygRefund(reviewRef, claim.token, refund.id);
  if (!await convergePaygPaymentReviewRefund(refund)) {
    throw new Error(`Refund ${refund.id} has no matching PAYG payment review.`);
  }
}

async function persistPaygPaymentReviewOnly(input: Readonly<{
  intentRef: DocumentReference;
  intent: PaygIntentDoc;
  session: Stripe.Checkout.Session;
  paymentIntent: Stripe.PaymentIntent | null;
  mismatches: readonly string[];
  automaticRefundSafe: boolean;
}>): Promise<{reviewId: string; issueRefund: boolean}> {
  const {intentRef, intent, session, paymentIntent, mismatches} = input;
  const paymentIntentId = paymentIntent?.id ?? idOf(session.payment_intent);
  const reviewRef = db().collection(PAYG_PAYMENT_REVIEW_COLLECTION).doc(
    paygPaymentReviewId(intentRef.id, session.id, paymentIntentId)
  );
  const disposition = resolvePaygPaymentReviewDisposition(
    input.automaticRefundSafe,
    paymentIntent?.amount_received ?? null
  );
  const {issueRefund} = disposition;
  const orderRef = db().collection("paygOrders").doc(intentRef.id);
  const classRef = db().collection("classes").doc(intent.class.classId);
  const lockRef = paygDuplicateLockRef(intent.duplicateLockId);
  const outcome = await db().runTransaction(async (tx) => {
    const [freshIntent, canonicalOrder, existingReview, classSnap, lockSnap] =
      await Promise.all([
        tx.get(intentRef),
        tx.get(orderRef),
        tx.get(reviewRef),
        tx.get(classRef),
        lockRef ? tx.get(lockRef) : Promise.resolve(null),
      ]);
    if (!freshIntent.exists) throw new Error(`PAYG intent ${intentRef.id} disappeared.`);
    const current = freshIntent.data() as PaygIntentDoc;
    const exactCanonicalOrder = canonicalOrder.exists &&
      canonicalOrder.get("purchaseKind") === PAYG_PURCHASE_KIND &&
      canonicalOrder.get("orderId") === intentRef.id &&
      canonicalOrder.get("checkoutSessionId") === session.id &&
      typeof paymentIntentId === "string" &&
      canonicalOrder.get("paymentIntentId") === paymentIntentId;
    if (exactCanonicalOrder) {
      return {reviewWritten: false as const, issueRefund: false};
    }
    if (typeof paymentIntentId === "string" &&
      isExactPaygPaymentReviewOwner(
        existingReview,
        intentRef.id,
        session.id,
        paymentIntentId
      )) {
      return {reviewWritten: false as const, issueRefund: false};
    }
    if (canonicalOrder.exists) {
      const reviewDisposition = resolvePaygCanonicalOrderReviewDisposition({
        canonicalPaymentIntentId: canonicalOrder.get("paymentIntentId"),
        observedPaymentIntentId: paymentIntentId,
        automaticRefundSafe: input.automaticRefundSafe,
        amountReceivedPence: paymentIntent?.amount_received ?? null,
      });
      tx.set(reviewRef, {
        schemaVersion: PAYG_SCHEMA_VERSION,
        status: reviewDisposition.status,
        intentId: intentRef.id,
        checkoutSessionId: session.id,
        paymentIntentId,
        canonicalOrderId: orderRef.id,
        canonicalOrderStatusAtDetection: canonicalOrder.get("status"),
        canonicalCheckoutSessionId: canonicalOrder.get("checkoutSessionId"),
        canonicalPaymentIntentId: canonicalOrder.get("paymentIntentId"),
        canonicalServicePreserved: true,
        mismatches: [...mismatches, "canonical_order_already_exists"],
        refundRecommended: Boolean(paymentIntent && paymentIntent.amount_received > 0),
        automaticRefundSafe: reviewDisposition.issueRefund,
        providerAmountReceivedPence: paymentIntent?.amount_received ?? null,
        providerCurrency: paymentIntent?.currency ?? session.currency ?? null,
        refundExpectedAmountPence: reviewDisposition.issueRefund ?
          paymentIntent?.amount_received : FieldValue.delete(),
        refundReason: reviewDisposition.issueRefund ?
          "paid_contract_mismatch" : FieldValue.delete(),
        refundRecoveryAt: reviewDisposition.scheduleRecovery ?
          Timestamp.fromMillis(Date.now()) : FieldValue.delete(),
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      }, {merge: true});
      return {
        reviewWritten: true as const,
        issueRefund: reviewDisposition.issueRefund,
      };
    }
    if ((current.capacityState === "held" ||
      current.unpaidHoldState === "counted") && classSnap.exists) {
      const bookedCount = Number(classSnap.get("bookedCount") ?? 0);
      const unpaidHoldCount = Number(classSnap.get("paygUnpaidHoldCount") ?? 0);
      tx.set(classSnap.ref, {
        ...(current.capacityState === "held" ? {
          bookedCount: FieldValue.increment(bookedCount > 0 ? -1 : 0),
        } : {}),
        ...(current.unpaidHoldState === "counted" ? {
          paygUnpaidHoldCount: FieldValue.increment(unpaidHoldCount > 0 ? -1 : 0),
        } : {}),
        updatedAt: serverTimestamp(),
      }, {merge: true});
    }
    releasePaygDuplicateLock(tx, lockSnap, intentRef.id);
    tx.set(intentRef, {
      status: "manual_review",
      paymentReviewStatus: disposition.status,
      capacityState: "released",
      unpaidHoldState: "released",
      checkoutSessionId: session.id,
      paymentIntentId,
      holdExpiresAt: FieldValue.delete(),
      paidContractMismatches: [...mismatches],
      paymentReviewId: reviewRef.id,
      ...existingPaygIntentPrivacySchedule(freshIntent),
      piiDeleteAt: FieldValue.delete(),
      updatedAt: serverTimestamp(),
    }, {merge: true});
    tx.set(reviewRef, {
      schemaVersion: PAYG_SCHEMA_VERSION,
      status: disposition.status,
      intentId: intentRef.id,
      checkoutSessionId: session.id,
      paymentIntentId,
      mismatches: [...mismatches],
      refundRecommended: Boolean(paymentIntent && paymentIntent.amount_received > 0),
      automaticRefundSafe: issueRefund,
      providerAmountReceivedPence: paymentIntent?.amount_received ?? null,
      providerCurrency: paymentIntent?.currency ?? session.currency ?? null,
      refundExpectedAmountPence: issueRefund ?
        paymentIntent?.amount_received : FieldValue.delete(),
      refundReason: issueRefund ?
        "paid_contract_mismatch" : FieldValue.delete(),
      refundRecoveryAt: disposition.scheduleRecovery ?
        Timestamp.fromMillis(Date.now()) : FieldValue.delete(),
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    }, {merge: true});
    return {reviewWritten: true as const, issueRefund};
  });
  if (!outcome.reviewWritten) {
    return {reviewId: reviewRef.id, issueRefund: false};
  }
  console.error("CRITICAL_BILLING_PAYG_PAYMENT_REVIEW_REQUIRED", {
    intentId: intentRef.id,
    checkoutSessionId: session.id,
    paymentIntentId,
    mismatches,
    automaticRefundSafe: outcome.issueRefund,
  });
  return {reviewId: reviewRef.id, issueRefund: outcome.issueRefund};
}

async function persistPaygPaidContractMismatch(input: Readonly<{
  intentRef: DocumentReference;
  intent: PaygIntentDoc;
  session: Stripe.Checkout.Session;
  paymentIntent: Stripe.PaymentIntent;
  charge: Stripe.Charge | null;
  successEvidence: PaygPaymentSuccessEvidence | null;
  expectedLivemode: boolean;
  processingNowMillis: number;
  mismatches: readonly string[];
  automaticRefundSafe: boolean;
}>): Promise<{issueRefund: boolean; paymentReviewRefundId: string | null}> {
  const {intentRef, intent, session, paymentIntent, mismatches} = input;
  const orderRef = db().collection("paygOrders").doc(intentRef.id);
  const bookingId = paygGuestBookingId(intentRef.id);
  const bookingRef = db().collection("bookings").doc(bookingId);
  const waiverRef = db().collection("paygWaiverAcceptances").doc(intentRef.id);
  const outboxRef = db().collection("paygEmailOutbox").doc(intentRef.id);
  const classRef = db().collection("classes").doc(intent.class.classId);
  const lockRef = paygDuplicateLockRef(intent.duplicateLockId);
  const reviewRef = db().collection(PAYG_PAYMENT_REVIEW_COLLECTION).doc(
    paygPaymentReviewId(intentRef.id, session.id, paymentIntent.id)
  );
  return db().runTransaction(async (tx) => {
    const [freshIntentSnap, existingOrderSnap, bookingSnap, waiverSnap,
      outboxSnap, classSnap, lockSnap, existingReviewSnap] = await Promise.all([
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
    const freshIntent = freshIntentSnap.data() as PaygIntentDoc;
    const transactionPiiProcessingAtMillis = Math.max(
      input.processingNowMillis,
      Date.now()
    );
    const existingOrder = existingOrderSnap.exists ?
      existingOrderSnap.data() as PaygOrderDoc : null;
    const exactCanonicalOrder = existingOrder !== null &&
      existingOrder.purchaseKind === PAYG_PURCHASE_KIND &&
      existingOrder.orderId === intentRef.id &&
      existingOrder.checkoutSessionId === session.id &&
      existingOrder.paymentIntentId === paymentIntent.id;
    if (exactCanonicalOrder) {
      return {issueRefund: false, paymentReviewRefundId: null};
    }
    if (isExactPaygPaymentReviewOwner(
      existingReviewSnap,
      intentRef.id,
      session.id,
      paymentIntent.id
    )) {
      return {issueRefund: false, paymentReviewRefundId: null};
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
        schemaVersion: PAYG_SCHEMA_VERSION,
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
          paymentIntent.amount_received : FieldValue.delete(),
        refundReason: reviewRefundSafe ?
          "paid_contract_mismatch" : FieldValue.delete(),
        refundRecoveryAt: reviewDisposition.scheduleRecovery ?
          Timestamp.fromMillis(Date.now()) : FieldValue.delete(),
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      }, {merge: true});
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
    const preserveRefunded = existingOrder?.status === "refunded";
    const precedence = existingOrder?.status === "disputed" ||
      existingOrder?.status === "manual_review";
    const fulfilledService = existingOrder?.status === "attended" ||
      existingOrder?.status === "no_show" || existingOrder?.status === "cancelled";
    const targetStatus: PaygOrderStatus = preserveRefunded ? "refunded" :
      precedence ? existingOrder.status : fulfilledService ? "manual_review" :
        input.automaticRefundSafe ? "refund_pending" : "manual_review";
    const issueRefund = targetStatus === "refund_pending" &&
      existingOrderSnap.get("refundStatus") !== "succeeded";
    if (existingOrder) {
      await releasePaidOrderCapacity(
        tx,
        orderRef,
        existingOrder,
        bookingSnap,
        classSnap,
        outboxSnap,
        lockSnap,
        {
          status: targetStatus,
          cancelledReason: "payg_paid_contract_mismatch",
          providerContractStatus: "mismatch",
          providerContractMismatches: [...mismatches],
          providerAmountReceivedPence: paymentIntent.amount_received,
          refundExpectedAmountPence: paymentIntent.amount_received,
          refundRecommended: paymentIntent.amount_received > 0,
          automaticRefundSafe: input.automaticRefundSafe,
          paymentReviewId: reviewRef.id,
          ...(issueRefund ? {
            refundRecoveryAt: Timestamp.fromMillis(Date.now()),
            refundReason: "paid_contract_mismatch",
          } : {
            refundRecoveryAt: FieldValue.delete(),
          }),
        }
      );
    } else {
      if (privacyPromotionMismatch !== null) {
        throw new PaygPiiPromotionClosedError(privacyPromotionMismatch);
      }
      if ((freshIntent.capacityState === "held" ||
        freshIntent.unpaidHoldState === "counted") && classSnap.exists) {
        const bookedCount = Number(classSnap.get("bookedCount") ?? 0);
        const unpaidHoldCount = Number(classSnap.get("paygUnpaidHoldCount") ?? 0);
        tx.set(classSnap.ref, {
          ...(freshIntent.capacityState === "held" ? {
            bookedCount: FieldValue.increment(bookedCount > 0 ? -1 : 0),
          } : {}),
          ...(freshIntent.unpaidHoldState === "counted" ? {
            paygUnpaidHoldCount: FieldValue.increment(unpaidHoldCount > 0 ? -1 : 0),
          } : {}),
          updatedAt: serverTimestamp(),
        }, {merge: true});
      }
      if (bookingSnap.exists && bookingSnap.get("status") === "booked") {
        tx.set(bookingRef, {
          status: "cancelled",
          cancelledAt: serverTimestamp(),
          cancelledReason: "payg_paid_contract_mismatch",
          updatedAt: serverTimestamp(),
        }, {merge: true});
      }
      releasePaygDuplicateLock(tx, lockSnap, intentRef.id);
      tombstonePaygConfirmation(tx, outboxSnap, "payg_paid_contract_mismatch");
      const order = buildPaygOrder(
        intentRef,
        freshIntent,
        session,
        paymentIntent,
        targetStatus === "refund_pending" ? "refund_pending" : "manual_review",
        "released",
        null
      );
      tx.create(orderRef, {
        ...order,
        providerContractStatus: "mismatch",
        providerContractMismatches: [...mismatches],
        providerAmountReceivedPence: paymentIntent.amount_received,
        refundExpectedAmountPence: paymentIntent.amount_received,
        refundRecommended: paymentIntent.amount_received > 0,
        automaticRefundSafe: input.automaticRefundSafe,
        paymentReviewId: reviewRef.id,
        ...(issueRefund ? {refundReason: "paid_contract_mismatch"} : {}),
      });
    }
    if (!waiverSnap.exists && privacyPromotionMismatch === null) {
      const waiverPiiRetentionCutoffAt =
        paygWaiverPiiRetentionCutoffAt(freshIntent);
      tx.create(waiverRef, {
        schemaVersion: PAYG_SCHEMA_VERSION,
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
    tx.set(intentRef, {
      status: targetStatus === "manual_review" ? "manual_review" : "fulfilled",
      capacityState: "released",
      unpaidHoldState: "released",
      checkoutSessionId: session.id,
      paymentIntentId: paymentIntent.id,
      orderId: intentRef.id,
      holdExpiresAt: FieldValue.delete(),
      paidContractMismatches: [...mismatches],
      paymentReviewId: reviewRef.id,
      fulfilledAt: serverTimestamp(),
      ...existingPaygIntentPrivacySchedule(freshIntentSnap),
      piiDeleteAt: FieldValue.delete(),
      updatedAt: serverTimestamp(),
    }, {merge: true});
    tx.set(reviewRef, {
      schemaVersion: PAYG_SCHEMA_VERSION,
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
    }, {merge: true});
    return {issueRefund, paymentReviewRefundId: null};
  });
}

/**
 * Idempotently turns a paid PAYG Checkout Session into one order and one guest
 * booking. Exported so the shared Stripe event ledger can dispatch here first.
 */
export async function fulfilPaygCheckoutSession(
  session: Stripe.Checkout.Session,
  successEvidence: PaygPaymentSuccessEvidence | null = null
): Promise<void> {
  const intentId = paygIntentIdFromCheckoutSession(session);
  if (!intentId) {
    throw new Error(`Checkout Session ${session.id} is not a PAYG class purchase.`);
  }
  const intentRef = db().collection("paygIntents").doc(intentId);
  const intentSnap = await intentRef.get();
  if (!intentSnap.exists) {
    throw new Error(`PAYG intent ${intentId} was not found for ${session.id}.`);
  }
  const intent = intentSnap.data() as PaygIntentDoc;
  const environment = assertPaygBillingEnvironment();
  if (intent.stripeMode !== environment.stripeMode) {
    throw new Error(`PAYG intent ${intentId} belongs to another Stripe environment.`);
  }
  const paymentIntentId = idOf(session.payment_intent);
  const existingOrder = await db().collection("paygOrders").doc(intentId).get();
  if (existingOrder.exists &&
    existingOrder.get("purchaseKind") === PAYG_PURCHASE_KIND &&
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
  const paymentReviewRef = db().collection(PAYG_PAYMENT_REVIEW_COLLECTION).doc(
    paygPaymentReviewId(intentId, session.id, paymentIntentId)
  );
  const existingPaymentReview = await paymentReviewRef.get();
  if (isExactPaygPaymentReviewOwner(
    existingPaymentReview,
    intentId,
    session.id,
    paymentIntentId
  )) {
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
  const automaticRefundSafe = isPaygPaymentRefundSafe(
    paymentIntent,
    intentId,
    environment.expectedLivemode
  );
  const mismatches = collectPaygPaidContractMismatches({
    session,
    paymentIntent,
    intentId,
    expectedClassId: intent.class.classId,
    expectedEmail: intent.contact?.email || "",
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
  if (!hasIntentEvidence) mismatches.push("intent_evidence_missing");
  if (privacyPromotionMismatch) mismatches.push(privacyPromotionMismatch);
  const uniqueMismatches = [...new Set(mismatches)];
  const routeToPaymentReview = async (
    reviewMismatches: readonly string[]
  ): Promise<void> => {
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
      } catch (error) {
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
    let review: Awaited<ReturnType<typeof persistPaygPaidContractMismatch>>;
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
    } catch (error) {
      if (!(error instanceof PaygPiiPromotionClosedError)) throw error;
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
      } catch (error) {
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
      } catch (error) {
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
  const duplicateLockRef = db().collection(PAYG_DUPLICATE_LOCK_COLLECTION)
    .doc(intent.duplicateLockId);
  let outcome: Readonly<{
    status: PaygOrderStatus | "payment_review";
    alreadyFulfilled: boolean;
  }>;
  try {
    outcome = await db().runTransaction(async (tx) => {
      const [freshIntentSnap, existingOrder, classSnap, bookingSnap, waiverSnap,
        outboxSnap, duplicateLockSnap, freshPaymentReview] = await Promise.all([
        tx.get(intentRef),
        tx.get(orderRef),
        tx.get(db().collection("classes").doc(intent.class.classId)),
        tx.get(bookingRef),
        tx.get(waiverRef),
        tx.get(outboxRef),
        tx.get(duplicateLockRef),
        tx.get(paymentReviewRef),
      ]);
      if (!freshIntentSnap.exists) throw new Error(`PAYG intent ${intentId} disappeared.`);
      const freshIntent = freshIntentSnap.data() as PaygIntentDoc;
      const transactionPiiProcessingAtMillis = Math.max(
        piiPromotionProcessingAtMillis,
        Date.now()
      );
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
        const existing = existingOrder.data() as PaygOrderDoc;
        const exactCanonicalOrder = existing.purchaseKind === PAYG_PURCHASE_KIND &&
          existing.orderId === intentId &&
          existing.checkoutSessionId === session.id &&
          existing.paymentIntentId === paymentIntent.id &&
          existing.class.classId === freshIntent.class.classId;
        if (exactCanonicalOrder) {
          // Exact canonical replay is converged. A missing outbox may be the
          // result of privacy closure; never reconstruct its recipient/template.
          return {status: existing.status, alreadyFulfilled: true};
        }
        if (isExactPaygPaymentReviewOwner(
          freshPaymentReview,
          intentId,
          session.id,
          paymentIntent.id
        )) {
          return {status: "payment_review" as const, alreadyFulfilled: true};
        }
        throw new Error(`PAYG order ${intentId} conflicts with a replayed payment.`);
      }
      if (isExactPaygPaymentReviewOwner(
        freshPaymentReview,
        intentId,
        session.id,
        paymentIntent.id
      )) {
        return {status: "payment_review" as const, alreadyFulfilled: true};
      }
      if (freshPrivacyPromotionMismatch !== null) {
        throw new PaygPiiPromotionClosedError(freshPrivacyPromotionMismatch);
      }
      const classUnavailable = !classSnap.exists ||
      classSnap.get("status") !== "scheduled" ||
      classSnap.get("paygEligible") === false;
      const duplicateLockInvalid = !duplicateLockSnap.exists ||
      duplicateLockSnap.get("intentId") !== intentId ||
      duplicateLockSnap.get("status") !== "held";
      const cannotUseHeldPlace = freshIntent.capacityState !== "held" ||
      classUnavailable || duplicateLockInvalid;
      if (cannotUseHeldPlace) {
        if ((freshIntent.capacityState === "held" ||
        freshIntent.unpaidHoldState === "counted") && classSnap.exists) {
          const bookedCount = Number(classSnap.get("bookedCount") ?? 0);
          const unpaidHoldCount = Number(classSnap.get("paygUnpaidHoldCount") ?? 0);
          tx.set(classSnap.ref, {
            ...(freshIntent.capacityState === "held" ? {
              bookedCount: FieldValue.increment(bookedCount > 0 ? -1 : 0),
            } : {}),
            ...(freshIntent.unpaidHoldState === "counted" ? {
              paygUnpaidHoldCount: FieldValue.increment(unpaidHoldCount > 0 ? -1 : 0),
            } : {}),
            updatedAt: serverTimestamp(),
          }, {merge: true});
        }
        if (duplicateLockSnap.exists &&
        duplicateLockSnap.get("intentId") === intentId) {
          tx.delete(duplicateLockRef);
        }
        const order = buildPaygOrder(
          intentRef,
          freshIntent,
          session,
          paymentIntent,
          "refund_pending",
          "released",
          null
        );
        tx.create(orderRef, {
          ...order,
          refundReason: "hold_released_before_payment",
        });
        if (!waiverSnap.exists) {
          const waiverPiiRetentionCutoffAt =
          paygWaiverPiiRetentionCutoffAt(freshIntent);
          tx.create(waiverRef, {
            schemaVersion: PAYG_SCHEMA_VERSION,
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
        tx.set(intentRef, {
          status: "fulfilled",
          capacityState: "released",
          unpaidHoldState: "released",
          checkoutSessionId: session.id,
          paymentIntentId: paymentIntent.id,
          orderId: intentId,
          holdExpiresAt: FieldValue.delete(),
          fulfilledAt: serverTimestamp(),
          ...existingPaygIntentPrivacySchedule(freshIntentSnap),
          piiDeleteAt: FieldValue.delete(),
          updatedAt: serverTimestamp(),
        }, {merge: true});
        return {status: "refund_pending" as const, alreadyFulfilled: false};
      }
      if (bookingSnap.exists) {
        throw new Error(`PAYG guest booking ${bookingId} already exists without its order.`);
      }
      const order = buildPaygOrder(
        intentRef,
        freshIntent,
        session,
        paymentIntent,
        "confirmed",
        "held",
        bookingId
      );
      tx.create(orderRef, order);
      tx.create(bookingRef, {
        classId: freshIntent.class.classId,
        userId: paygGuestUserId(intentId),
        userName: freshIntent.attendee.fullName,
        status: "booked",
        bookingKind: "payg_guest",
        isGuestBooking: true,
        paygOrderId: intentId,
        retainedAcceptanceEvidence:
          retainedPaygAcceptanceEvidence(freshIntent),
        attendanceStatus: "none",
        attended: false,
        checkedInAt: null,
        checkedInBy: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      if (freshIntent.unpaidHoldState === "counted") {
        const unpaidHoldCount = Number(classSnap.get("paygUnpaidHoldCount") ?? 0);
        tx.set(classSnap.ref, {
          paygUnpaidHoldCount: FieldValue.increment(unpaidHoldCount > 0 ? -1 : 0),
          updatedAt: serverTimestamp(),
        }, {merge: true});
      }
      tx.set(duplicateLockRef, {
        status: "booked",
        activeUntil: Timestamp.fromMillis(freshIntent.classEndMillis),
        updatedAt: serverTimestamp(),
      }, {merge: true});
      if (!waiverSnap.exists) {
        const waiverPiiRetentionCutoffAt =
        paygWaiverPiiRetentionCutoffAt(freshIntent);
        tx.create(waiverRef, {
          schemaVersion: PAYG_SCHEMA_VERSION,
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
        const confirmationOutbox = confirmationOutboxFor(
          intentRef,
          freshIntent
        );
        tx.create(outboxRef, {
          ...confirmationOutbox,
          status: "pending",
          attemptCount: 0,
          nextAttemptAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      tx.set(intentRef, {
        status: "fulfilled",
        unpaidHoldState: "released",
        checkoutSessionId: session.id,
        paymentIntentId: paymentIntent.id,
        orderId: intentId,
        holdExpiresAt: FieldValue.delete(),
        fulfilledAt: serverTimestamp(),
        ...existingPaygIntentPrivacySchedule(freshIntentSnap),
        piiDeleteAt: FieldValue.delete(),
        updatedAt: serverTimestamp(),
      }, {merge: true});
      return {status: "confirmed" as const, alreadyFulfilled: false};
    });
  } catch (error) {
    if (!(error instanceof PaygPiiPromotionClosedError)) throw error;
    await routeToPaymentReview([...uniqueMismatches, error.mismatch]);
    return;
  }

  if (outcome.status === "refund_pending") {
    await issuePaygRefund(intentId, "hold_released_before_payment");
  }
}

async function retrieveAndFulfilPaygCheckout(sessionId: string): Promise<void> {
  const session = await stripe().checkout.sessions.retrieve(sessionId);
  assertStripeObjectMode("Checkout Session", session.id, session.livemode);
  await fulfilPaygCheckoutSession(session);
}

function requireCheckoutSessionId(value: unknown): string {
  const id = typeof value === "string" ? value.trim() : "";
  if (id.length < 12 || id.length > 255 || !/^cs_[A-Za-z0-9_]+$/.test(id)) {
    throw paygError("invalid-argument", "sessionId is invalid.");
  }
  return id;
}

function publicOrderState(status: PaygOrderStatus):
  "confirmed" | "cancelled" | "refund_pending" | "refunded" | "disputed" | "no_show" {
  if (status === "attended") return "confirmed";
  if (status === "manual_review") return "disputed";
  return status;
}

export function publicPaygPaymentReviewState(
  status: unknown,
  refundStatus: unknown
): "refund_pending" | "refunded" | "disputed" {
  if (status === "refunded" || refundStatus === "succeeded") return "refunded";
  if (status === "refund_pending" || refundStatus === "pending") {
    return "refund_pending";
  }
  return "disputed";
}

export function publicPaygAttendeeName(
  value: unknown,
  piiRedactedAt?: unknown
): string {
  if (piiRedactedAt !== undefined && piiRedactedAt !== null) {
    return "PAYG guest";
  }
  if (!value || typeof value !== "object") return "PAYG guest";
  const name = (value as {fullName?: unknown}).fullName;
  return typeof name === "string" && name.length >= 2 && name.length <= 160 ?
    name : "PAYG guest";
}

export function isPaygOrderPiiClosed(input: Readonly<{
  piiRedactedAt: unknown;
  piiRetentionCutoffAt: unknown;
  nowMillis: number;
}>): boolean {
  const cutoff = timestampMillis(input.piiRetentionCutoffAt);
  return input.piiRedactedAt !== undefined && input.piiRedactedAt !== null ||
    cutoff === null || cutoff <= input.nowMillis;
}

export function buildPaygCancellationPreviewPayload(input: Readonly<{
  orderId: string;
  status: PaygOrderStatus;
  class: PaygClassSnapshot;
  classStartMillis: number;
  cancellationCutoffAtMillis: number;
  nowMillis: number;
}>) {
  const expectedCutoff = input.classStartMillis -
    PAYG_CANCELLATION_CUTOFF_HOURS * 60 * 60 * 1000;
  if (!/^payg_[a-f0-9]{64}$/.test(input.orderId) ||
    !Number.isSafeInteger(input.classStartMillis) ||
    !Number.isSafeInteger(input.cancellationCutoffAtMillis) ||
    input.cancellationCutoffAtMillis !== expectedCutoff ||
    !Number.isSafeInteger(input.nowMillis)) {
    throw new Error("PAYG cancellation preview evidence is invalid.");
  }
  const decision = resolvePaygCancellationDecision(
    input.classStartMillis,
    input.nowMillis
  );
  return Object.freeze({
    ok: true as const,
    currentOrderState: publicOrderState(input.status),
    class: input.class,
    cancellationCutoffAt: new Date(input.cancellationCutoffAtMillis).toISOString(),
    refundEligibleNow: input.status === "confirmed" && decision.refundEligible,
  });
}

export function buildGetPaygCancellationPreview() {
  return onCall({
    region: REGION,
    secrets: PAYG_CANCELLATION_PREVIEW_SECRETS,
    enforceAppCheck: !isFirebaseFunctionsEmulatorProcess(),
    consumeAppCheckToken: !isFirebaseFunctionsEmulatorProcess(),
  }, async (request) => {
    assertPaygCheckoutAppCheck(request);
    assertPaygFirebaseProject();
    assertCancellationTokenSecretConfigured();
    const token = requireBoundedString(request.data?.token, "token", 40, 2048);
    const payload = verifyPaygCancellationTokenWithKeyring(
      token,
      cancellationVerificationKeyring()
    );
    const order = await db().collection("paygOrders").doc(payload.orderId).get();
    if (!order.exists || order.get("purchaseKind") !== PAYG_PURCHASE_KIND ||
      order.get("orderId") !== payload.orderId) {
      throw paygError("not-found", "This PAYG order was not found.");
    }
    const value = order.data() as PaygOrderDoc;
    const cutoff = timestampMillis(order.get("cancellationCutoffAt"));
    if (cutoff === null) {
      throw paygError(
        "failed-precondition",
        "This PAYG booking needs support review before cancellation."
      );
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
    } catch {
      throw paygError(
        "failed-precondition",
        "This PAYG booking needs support review before cancellation."
      );
    }
  });
}

function publicOrderProjection(
  order: PaygOrderDoc,
  signingKey: PaygVerificationKey,
  nowMillis = Date.now()
) {
  const privacyClosed = isPaygOrderPiiClosed({
    piiRedactedAt: order.piiRedactedAt,
    piiRetentionCutoffAt: order.piiRetentionCutoffAt,
    nowMillis,
  });
  const decision = resolvePaygCancellationDecision(order.classStartMillis, nowMillis);
  const tokenExpiresAt = Math.floor(
    (order.classEndMillis + 24 * 60 * 60 * 1000) / 1000
  );
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
      attendeeName: publicPaygAttendeeName(
        order.attendee,
        privacyClosed ? true : null
      ),
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

export function buildGetPaygCheckoutStatus() {
  return onCall({
    region: REGION,
    secrets: PAYG_STATUS_SECRETS,
    enforceAppCheck: !isFirebaseFunctionsEmulatorProcess(),
  }, async (request) => {
    assertPaygFirebaseProject();
    const sessionId = requireCheckoutSessionId(request.data?.sessionId);
    const orders = await db().collection("paygOrders")
      .where("checkoutSessionId", "==", sessionId)
      .limit(2)
      .get();
    if (orders.size > 1) {
      console.error("CRITICAL_BILLING_PAYG_DUPLICATE_CHECKOUT_SESSION", {
        checkoutSessionIdHash: sha256(sessionId),
        orderIds: orders.docs.map((doc) => doc.id),
      });
      throw paygError(
        "failed-precondition",
        "This PAYG purchase needs support review before it can be shown."
      );
    }
    if (orders.size === 1) {
      const order = orders.docs[0].data() as PaygOrderDoc;
      let signingKey: PaygVerificationKey;
      try {
        signingKey = cancellationSigningKey();
      } catch {
        throw paygError(
          "failed-precondition",
          "PAYG cancellation links are not configured."
        );
      }
      return publicOrderProjection(order, signingKey);
    }
    const reviews = await db().collection(PAYG_PAYMENT_REVIEW_COLLECTION)
      .where("checkoutSessionId", "==", sessionId)
      .limit(2)
      .get();
    if (reviews.size > 1) {
      console.error("CRITICAL_BILLING_PAYG_DUPLICATE_REVIEW_SESSION", {
        checkoutSessionIdHash: sha256(sessionId),
        paymentReviewIds: reviews.docs.map((doc) => doc.id),
      });
      throw paygError(
        "failed-precondition",
        "This PAYG purchase needs support review before it can be shown."
      );
    }
    if (reviews.size === 1) {
      const review = reviews.docs[0];
      return {
        ok: true,
        state: publicPaygPaymentReviewState(
          review.get("status"),
          review.get("refundStatus")
        ),
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
      throw paygError(
        "failed-precondition",
        "This PAYG purchase needs support review before it can be shown."
      );
    }
    if (intents.empty) {
      throw paygError("not-found", "No PAYG checkout was found for that session.");
    }
    return {ok: true, state: "processing" as const};
  });
}

type CancellationPreparation = Readonly<{
  outcome: "refund_pending" | "cancelled_non_refundable" | "already_cancelled";
  refundEligible: boolean;
  capacityReleased: boolean;
  issueRefund: boolean;
}>;

async function preparePaygCancellation(
  orderRef: DocumentReference,
  nowMillis: number
): Promise<CancellationPreparation> {
  return db().runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) {
      throw paygError("not-found", "This PAYG order was not found.");
    }
    const order = orderSnap.data() as PaygOrderDoc;
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
        }, {merge: true});
      }
      return {
        outcome: "already_cancelled" as const,
        refundEligible: order.status === "refunded",
        capacityReleased: order.capacityState === "released",
        issueRefund: false,
      };
    }
    if (order.status === "refund_pending") {
      const pending = resolvePaygCancellationRefundPendingDisposition(
        orderSnap.get("refundReason")
      );
      tombstonePaygConfirmation(tx, outboxSnap, "order_refund_pending");
      releasePaygDuplicateLock(tx, lockSnap, orderRef.id);
      tx.set(orderRef, {
        confirmationEmailStatus: "not_required",
        updatedAt: serverTimestamp(),
      }, {merge: true});
      return {
        outcome: "refund_pending" as const,
        refundEligible: pending.refundEligible,
        capacityReleased: order.capacityState === "released",
        issueRefund: pending.issueRefund,
      };
    }
    if (order.status !== "confirmed") {
      throw paygError(
        "failed-precondition",
        "This PAYG order cannot be cancelled automatically."
      );
    }
    const decision = resolvePaygCancellationDecision(order.classStartMillis, nowMillis);
    if (decision.kind === "no_show") {
      const attendanceRecorded = bookingSnap?.get("attended") === true ||
        bookingSnap?.get("attendanceStatus") === "checked_in" ||
        timestampMillis(bookingSnap?.get("checkedInAt")) !== null;
      const disposition = resolvePaygPostStartCancellationDisposition(
        attendanceRecorded
      );
      if (disposition === "attended") {
        releasePaygDuplicateLock(tx, lockSnap, orderRef.id);
        tx.set(orderRef, {
          status: "attended",
          capacityState: "consumed",
          noShowReviewAt: FieldValue.delete(),
          attendanceResolvedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, {merge: true});
        if (bookingRef && bookingSnap?.exists) {
          tx.set(bookingRef, {
            paygAttendanceOutcome: "attended",
            updatedAt: serverTimestamp(),
          }, {merge: true});
        }
        return {
          outcome: "already_cancelled" as const,
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
      }, {merge: true});
      return {
        outcome: "cancelled_non_refundable" as const,
        refundEligible: false,
        capacityReleased: false,
        issueRefund: false,
      };
    }
    const shouldRelease = order.capacityState === "held";
    if (shouldRelease && classSnap.exists) {
      const bookedCount = Number(classSnap.get("bookedCount") ?? 0);
      tx.set(classRef, {
        bookedCount: FieldValue.increment(bookedCount > 0 ? -1 : 0),
        updatedAt: serverTimestamp(),
      }, {merge: true});
    }
    if (bookingRef && bookingSnap?.exists && bookingSnap.get("status") === "booked") {
      tx.set(bookingRef, {
        status: "cancelled",
        cancelledAt: serverTimestamp(),
        cancelledReason: decision.refundEligible ?
          "payg_guest_refundable" : "payg_guest_late",
        updatedAt: serverTimestamp(),
      }, {merge: true});
    }
    tombstonePaygConfirmation(
      tx,
      outboxSnap,
      decision.refundEligible ? "guest_cancellation_refund" : "guest_cancellation_late"
    );
    releasePaygDuplicateLock(tx, lockSnap, orderRef.id);
    tx.set(orderRef, {
      status: decision.refundEligible ? "refund_pending" : "cancelled",
      capacityState: "released",
      confirmationEmailStatus: "not_required",
      noShowReviewAt: FieldValue.delete(),
      ...(decision.refundEligible ? {
        refundRecoveryAt: Timestamp.fromMillis(nowMillis),
        refundReason: "guest_cancellation",
      } : {}),
      cancellation: {
        requestedAt: serverTimestamp(),
        policyOutcome: decision.refundEligible ?
          "at_least_24_hours_refundable" : "under_24_hours_non_refundable",
        refundEligible: decision.refundEligible,
        cutoffAt: Timestamp.fromMillis(decision.cutoffAtMillis),
      },
      updatedAt: serverTimestamp(),
    }, {merge: true});
    return {
      outcome: decision.refundEligible ?
        "refund_pending" as const : "cancelled_non_refundable" as const,
      refundEligible: decision.refundEligible,
      capacityReleased: shouldRelease,
      issueRefund: decision.refundEligible,
    };
  });
}

export function buildRequestPaygCancellation() {
  return onCall({
    region: REGION,
    secrets: PAYG_CANCELLATION_SECRETS,
    enforceAppCheck: !isFirebaseFunctionsEmulatorProcess(),
    consumeAppCheckToken: !isFirebaseFunctionsEmulatorProcess(),
    timeoutSeconds: 120,
  }, async (request) => {
    assertPaygCheckoutAppCheck(request);
    if (request.data?.confirm !== true) {
      throw paygError(
        "failed-precondition",
        "Confirm the PAYG cancellation before submitting it."
      );
    }
    assertPaygDataPlaneEnvironment();
    const token = requireBoundedString(request.data?.token, "token", 40, 2048);
    const payload = verifyPaygCancellationTokenWithKeyring(
      token,
      cancellationVerificationKeyring()
    );
    const orderRef = db().collection("paygOrders").doc(payload.orderId);
    const prepared = await preparePaygCancellation(orderRef, Date.now());
    if (prepared.issueRefund) {
      try {
        await issuePaygRefund(payload.orderId, "guest_cancellation");
      } catch (error) {
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

async function markPaygPaymentPending(
  session: Stripe.Checkout.Session
): Promise<void> {
  if (!isPaygMetadata(session.metadata)) return;
  const intentId = String(session.metadata?.paygIntentId);
  const intentRef = db().collection("paygIntents").doc(intentId);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(intentRef);
    if (!snap.exists) throw new Error(`PAYG intent ${intentId} was not found.`);
    const intent = snap.data() as PaygIntentDoc;
    assertSessionBinding(session, intentId, intent);
    if (intent.status === "fulfilled" || intent.capacityState === "released") return;
    const nextCheckMillis = Math.min(
      intent.classStartMillis,
      Date.now() + 5 * 60 * 1000
    );
    tx.set(intentRef, {
      status: "payment_pending",
      checkoutSessionId: session.id,
      holdExpiresAt: Timestamp.fromMillis(nextCheckMillis),
      updatedAt: serverTimestamp(),
    }, {merge: true});
  });
}

async function releasePaygSession(
  session: Stripe.Checkout.Session,
  reason: string
): Promise<void> {
  if (!isPaygMetadata(session.metadata)) return;
  const intentId = String(session.metadata?.paygIntentId);
  const intentRef = db().collection("paygIntents").doc(intentId);
  const snap = await intentRef.get();
  if (!snap.exists) throw new Error(`PAYG intent ${intentId} was not found.`);
  assertSessionBinding(session, intentId, snap.data() as PaygIntentDoc);
  await releasePaygHold(intentRef, reason, session.id);
}

type PaygPaymentOwner = Readonly<{
  kind: "order" | "review";
  doc: QueryDocumentSnapshot;
}>;

async function paygPaymentOwnerForPaymentIntent(
  paymentIntent: Stripe.PaymentIntent
): Promise<PaygPaymentOwner> {
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
  if (orders.size === 1) return {kind: "order", doc: orders.docs[0]};

  let reviews = await db().collection(PAYG_PAYMENT_REVIEW_COLLECTION)
    .where("paymentIntentId", "==", paymentIntent.id)
    .limit(2)
    .get();
  if (reviews.size > 1) {
    throw new Error(
      `PaymentIntent ${paymentIntent.id} belongs to multiple PAYG payment reviews.`
    );
  }
  if (reviews.size === 1) return {kind: "review", doc: reviews.docs[0]};

  if (orders.empty && reviews.empty) {
    const intentId = paymentIntent.metadata?.paygIntentId;
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
          db().collection(PAYG_PAYMENT_REVIEW_COLLECTION)
            .where("paymentIntentId", "==", paymentIntent.id)
            .limit(2)
            .get(),
        ]);
        if (orders.size > 1 || reviews.size > 1 ||
          (orders.size === 1 && reviews.size === 1 &&
            reviews.docs[0].get("orderId") !== orders.docs[0].id)) {
          throw new Error(
            `PaymentIntent ${paymentIntent.id} has conflicting PAYG owners.`
          );
        }
        if (orders.size === 1) return {kind: "order", doc: orders.docs[0]};
        if (reviews.size === 1) return {kind: "review", doc: reviews.docs[0]};
      }
    }
  }
  throw new Error(`PAYG owner for PaymentIntent ${paymentIntent.id} was not found.`);
}

async function releasePaidOrderCapacity(
  tx: Transaction,
  orderRef: DocumentReference,
  order: PaygOrderDoc,
  bookingSnap: DocumentSnapshot | null,
  classSnap: DocumentSnapshot,
  outboxSnap: DocumentSnapshot | null,
  duplicateLockSnap: DocumentSnapshot | null,
  update: Record<string, unknown>
): Promise<void> {
  if (order.capacityState === "held" && classSnap.exists) {
    const bookedCount = Number(classSnap.get("bookedCount") ?? 0);
    tx.set(classSnap.ref, {
      bookedCount: FieldValue.increment(bookedCount > 0 ? -1 : 0),
      updatedAt: serverTimestamp(),
    }, {merge: true});
  }
  if (order.bookingId && bookingSnap?.exists && bookingSnap.get("status") === "booked") {
    tx.set(bookingSnap.ref, {
      status: "cancelled",
      cancelledAt: serverTimestamp(),
      cancelledReason: String(update.cancelledReason || "payg_provider_reversal"),
      updatedAt: serverTimestamp(),
    }, {merge: true});
  }
  releasePaygDuplicateLock(tx, duplicateLockSnap, orderRef.id);
  tombstonePaygConfirmation(
    tx,
    outboxSnap,
    String(update.cancelledReason || "payg_provider_reversal")
  );
  tx.set(orderRef, {
    capacityState: "released",
    confirmationEmailStatus: "not_required",
    noShowReviewAt: FieldValue.delete(),
    ...update,
    ...paygRefundClaimCleanup(),
    updatedAt: serverTimestamp(),
  }, {merge: true});
}

async function applyPaygPaymentReviewChargeRefund(
  reviewDoc: QueryDocumentSnapshot,
  charge: Stripe.Charge,
  paymentIntent: Stripe.PaymentIntent
): Promise<void> {
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
    if (hasPaygSucceededRefundEvidence(
      currentStatus,
      review.get("refundStatus")
    )) {
      tx.set(review.ref, {
        refundRecoveryAt: FieldValue.delete(),
        ...paygRefundClaimCleanup(),
        updatedAt: serverTimestamp(),
      }, {merge: true});
      return;
    }
    const precedence = currentStatus === "manual_review" ||
      currentStatus === "disputed";
    tx.set(review.ref, {
      status: precedence ? currentStatus : fullyRefunded ?
        "refunded" : "manual_review",
      chargeId: charge.id,
      refundStatus: fullyRefunded ? "succeeded" :
        exact ? "partial_refund_manual_review" : "provider_contract_mismatch",
      refundedAmountPence: charge.amount_refunded,
      refundRecoveryAt: FieldValue.delete(),
      refundedAt: fullyRefunded ? serverTimestamp() : FieldValue.delete(),
      ...paygRefundClaimCleanup(),
      updatedAt: serverTimestamp(),
    }, {merge: true});
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

async function applyPaygChargeRefund(
  charge: Stripe.Charge,
  paymentIntent: Stripe.PaymentIntent
): Promise<void> {
  const owner = await paygPaymentOwnerForPaymentIntent(paymentIntent);
  if (owner.kind === "review") {
    await applyPaygPaymentReviewChargeRefund(owner.doc, charge, paymentIntent);
    return;
  }
  const orderDoc = owner.doc;
  const orderRef = orderDoc.ref;
  await db().runTransaction(async (tx) => {
    const freshOrder = await tx.get(orderRef);
    if (!freshOrder.exists) throw new Error(`PAYG order ${orderRef.id} disappeared.`);
    const order = freshOrder.data() as PaygOrderDoc;
    const bookingRef = order.bookingId ?
      db().collection("bookings").doc(order.bookingId) : null;
    const outboxRef = db().collection("paygEmailOutbox").doc(orderRef.id);
    const lockRef = paygDuplicateLockRef(order.duplicateLockId);
    const reviewRef = paygPaymentReviewRef(freshOrder.get("paymentReviewId"));
    const [bookingSnap, classSnap, outboxSnap, lockSnap, reviewSnap] =
      await Promise.all([
        bookingRef ? tx.get(bookingRef) : Promise.resolve(null),
        tx.get(db().collection("classes").doc(order.class.classId)),
        tx.get(outboxRef),
        lockRef ? tx.get(lockRef) : Promise.resolve(null),
        reviewRef ? tx.get(reviewRef) : Promise.resolve(null),
      ]);
    const storedExpectedAmount = Number(freshOrder.get("refundExpectedAmountPence"));
    const expectedAmount = Number.isSafeInteger(storedExpectedAmount) &&
      storedExpectedAmount > 0 ? storedExpectedAmount : order.amountPence;
    const fullyRefunded = charge.amount_refunded >= charge.amount &&
      charge.amount === expectedAmount && charge.currency === order.currency &&
      idOf(charge.payment_intent) === order.paymentIntentId;
    const linkedReview = reviewSnap?.exists &&
      reviewSnap.get("orderId") === orderRef.id &&
      reviewSnap.get("paymentIntentId") === paymentIntent.id;
    const orderRefundSucceeded = hasPaygSucceededRefundEvidence(
      order.status,
      freshOrder.get("refundStatus")
    );
    const linkedReviewRefundSucceeded = linkedReview &&
      hasPaygSucceededRefundEvidence(
        reviewSnap.get("status"),
        reviewSnap.get("refundStatus")
      );
    if (orderRefundSucceeded) {
      tx.set(orderRef, {
        refundRecoveryAt: FieldValue.delete(),
        ...paygRefundClaimCleanup(),
        updatedAt: serverTimestamp(),
      }, {merge: true});
      if (linkedReview && !linkedReviewRefundSucceeded) {
        tx.set(reviewSnap.ref, {
          status: "refunded",
          refundStatus: "succeeded",
          refundRecoveryAt: FieldValue.delete(),
          ...paygRefundClaimCleanup(),
          updatedAt: serverTimestamp(),
        }, {merge: true});
      }
      return;
    }
    if (linkedReview && !linkedReviewRefundSucceeded) {
      tx.set(reviewSnap.ref, {
        status: resolvePaygLinkedReviewRefundStatus(
          reviewSnap.get("status"),
          fullyRefunded ? "succeeded" : null,
          fullyRefunded
        ),
        chargeId: charge.id,
        refundStatus: fullyRefunded ?
          "succeeded" : "partial_refund_manual_review",
        refundedAmountPence: charge.amount_refunded,
        refundedAt: fullyRefunded ? serverTimestamp() : FieldValue.delete(),
        refundRecoveryAt: FieldValue.delete(),
        ...paygRefundClaimCleanup(),
        updatedAt: serverTimestamp(),
      }, {merge: true});
    }
    if (!fullyRefunded) {
      const preserved = order.status === "refunded" ||
        order.status === "disputed" || order.status === "manual_review" ?
        order.status : "manual_review";
      await releasePaidOrderCapacity(
        tx,
        orderRef,
        order,
        bookingSnap,
        classSnap,
        outboxSnap,
        lockSnap,
        {
          status: preserved,
          cancelledReason: "partial_refund_manual_review",
          refundStatus: "partial_refund_manual_review",
          refundedAmountPence: charge.amount_refunded,
        }
      );
      console.error("CRITICAL_BILLING_PAYG_PARTIAL_REFUND", {
        orderId: orderRef.id,
        chargeId: charge.id,
        amountRefunded: charge.amount_refunded,
      });
      return;
    }
    await releasePaidOrderCapacity(
      tx,
      orderRef,
      order,
      bookingSnap,
      classSnap,
      outboxSnap,
      lockSnap,
      {
        status: order.status === "refunded" || order.status === "disputed" ||
          order.status === "manual_review" ? order.status : "refunded",
        cancelledReason: "payg_refunded",
        chargeId: charge.id,
        refundedAmountPence: charge.amount_refunded,
        refundStatus: "succeeded",
        refundRecoveryAt: FieldValue.delete(),
        refundedAt: serverTimestamp(),
      }
    );
  });
}

function isOpenDispute(status: Stripe.Dispute.Status): boolean {
  const lifecycle = classifyPaygDisputeStatus(status);
  // Unknown future provider states remain fail-closed: automation stays
  // suspended until an operator or a code update classifies them.
  return lifecycle === "open" || lifecycle === "unknown";
}

async function applyPaygPaymentReviewDispute(
  reviewDoc: QueryDocumentSnapshot,
  dispute: Stripe.Dispute,
  paymentIntent: Stripe.PaymentIntent
): Promise<void> {
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
      tx.set(review.ref, {
        refundRecoveryAt: FieldValue.delete(),
        refundAutomationStatus: "suspended_dispute",
        ...paygRefundClaimCleanup(),
        updatedAt: serverTimestamp(),
      }, {merge: true});
      return;
    }
    if (observation === "conflict_manual_review") {
      tx.set(review.ref, {
        status: "manual_review",
        conflictingDisputeId: dispute.id,
        conflictingDisputeStatus: dispute.status,
        refundRecoveryAt: FieldValue.delete(),
        refundAutomationStatus: "suspended_dispute",
        refundObligationReviewRequired: true,
        ...paygRefundClaimCleanup(),
        updatedAt: serverTimestamp(),
      }, {merge: true});
      return;
    }
    const currentStatus = review.get("status");
    const status = resolvePaygDisputeOwnerStatus(
      currentStatus,
      exact,
      dispute.status
    );
    tx.set(review.ref, {
      status,
      disputeId: dispute.id,
      disputeStatus: dispute.status,
      disputeOpen: isOpenDispute(dispute.status),
      disputeUpdatedAt: serverTimestamp(),
      refundRecoveryAt: FieldValue.delete(),
      refundAutomationStatus: "suspended_dispute",
      refundObligationReviewRequired: true,
      ...paygRefundClaimCleanup(),
      updatedAt: serverTimestamp(),
    }, {merge: true});
    if (!exact) {
      console.error("CRITICAL_BILLING_PAYG_REVIEW_DISPUTE_MISMATCH", {
        paymentReviewId: review.id,
        disputeId: dispute.id,
      });
    }
  });
}

async function applyPaygDispute(
  dispute: Stripe.Dispute,
  paymentIntent: Stripe.PaymentIntent
): Promise<void> {
  const owner = await paygPaymentOwnerForPaymentIntent(paymentIntent);
  if (owner.kind === "review") {
    await applyPaygPaymentReviewDispute(owner.doc, dispute, paymentIntent);
    return;
  }
  const orderDoc = owner.doc;
  const orderRef = orderDoc.ref;
  await db().runTransaction(async (tx) => {
    const freshOrder = await tx.get(orderRef);
    if (!freshOrder.exists) throw new Error(`PAYG order ${orderRef.id} disappeared.`);
    const order = freshOrder.data() as PaygOrderDoc;
    const bookingRef = order.bookingId ?
      db().collection("bookings").doc(order.bookingId) : null;
    const outboxRef = db().collection("paygEmailOutbox").doc(orderRef.id);
    const lockRef = paygDuplicateLockRef(order.duplicateLockId);
    const reviewRef = paygPaymentReviewRef(freshOrder.get("paymentReviewId"));
    const [bookingSnap, classSnap, outboxSnap, lockSnap, reviewSnap] =
      await Promise.all([
        bookingRef ? tx.get(bookingRef) : Promise.resolve(null),
        tx.get(db().collection("classes").doc(order.class.classId)),
        tx.get(outboxRef),
        lockRef ? tx.get(lockRef) : Promise.resolve(null),
        reviewRef ? tx.get(reviewRef) : Promise.resolve(null),
      ]);
    const observation = resolvePaygDisputeObservation({
      storedDisputeId: freshOrder.get("disputeId"),
      storedDisputeStatus: freshOrder.get("disputeStatus"),
      incomingDisputeId: dispute.id,
      incomingDisputeStatus: dispute.status,
    });
    const linkedReview = reviewSnap?.exists &&
      reviewSnap.get("orderId") === orderRef.id &&
      reviewSnap.get("paymentIntentId") === paymentIntent.id;
    if (observation === "preserve_terminal") {
      await releasePaidOrderCapacity(
        tx,
        orderRef,
        order,
        bookingSnap,
        classSnap,
        outboxSnap,
        lockSnap,
        {
          status: order.status,
          cancelledReason: "payg_dispute",
          refundRecoveryAt: FieldValue.delete(),
          refundAutomationStatus: "suspended_dispute",
        }
      );
      if (linkedReview) {
        tx.set(reviewSnap.ref, {
          refundRecoveryAt: FieldValue.delete(),
          refundAutomationStatus: "suspended_dispute",
          ...paygRefundClaimCleanup(),
          updatedAt: serverTimestamp(),
        }, {merge: true});
      }
      return;
    }
    if (observation === "conflict_manual_review") {
      await releasePaidOrderCapacity(
        tx,
        orderRef,
        order,
        bookingSnap,
        classSnap,
        outboxSnap,
        lockSnap,
        {
          status: "manual_review",
          cancelledReason: "payg_dispute_conflict",
          conflictingDisputeId: dispute.id,
          conflictingDisputeStatus: dispute.status,
          refundRecoveryAt: FieldValue.delete(),
          refundAutomationStatus: "suspended_dispute",
          refundObligationReviewRequired: true,
        }
      );
      if (linkedReview) {
        tx.set(reviewSnap.ref, {
          status: "manual_review",
          conflictingDisputeId: dispute.id,
          conflictingDisputeStatus: dispute.status,
          refundRecoveryAt: FieldValue.delete(),
          refundAutomationStatus: "suspended_dispute",
          refundObligationReviewRequired: true,
          ...paygRefundClaimCleanup(),
          updatedAt: serverTimestamp(),
        }, {merge: true});
      }
      return;
    }
    if (linkedReview) {
      tx.set(reviewSnap.ref, {
        status: resolvePaygDisputeOwnerStatus(
          reviewSnap.get("status"),
          true,
          dispute.status
        ),
        disputeId: dispute.id,
        disputeStatus: dispute.status,
        disputeOpen: isOpenDispute(dispute.status),
        disputeUpdatedAt: serverTimestamp(),
        refundRecoveryAt: FieldValue.delete(),
        refundAutomationStatus: "suspended_dispute",
        refundObligationReviewRequired: true,
        ...paygRefundClaimCleanup(),
        updatedAt: serverTimestamp(),
      }, {merge: true});
    }
    await releasePaidOrderCapacity(
      tx,
      orderRef,
      order,
      bookingSnap,
      classSnap,
      outboxSnap,
      lockSnap,
      {
        status: resolvePaygDisputeOwnerStatus(
          order.status,
          true,
          dispute.status
        ),
        cancelledReason: "payg_dispute",
        disputeId: dispute.id,
        disputeStatus: dispute.status,
        disputeOpen: isOpenDispute(dispute.status),
        disputeUpdatedAt: serverTimestamp(),
        refundRecoveryAt: FieldValue.delete(),
        refundAutomationStatus: "suspended_dispute",
        refundObligationReviewRequired: true,
      }
    );
  });
}

async function paygPaymentIntentForCharge(
  charge: Stripe.Charge
): Promise<Stripe.PaymentIntent | null> {
  const paymentIntentId = idOf(charge.payment_intent);
  if (!paymentIntentId) return null;
  const paymentIntent = await stripe().paymentIntents.retrieve(paymentIntentId);
  assertStripeObjectMode("PaymentIntent", paymentIntent.id, paymentIntent.livemode);
  if (isPaygMetadata(paymentIntent.metadata)) return paymentIntent;
  // A paid contract-mismatch review may intentionally exist because the final
  // PaymentIntent metadata was missing or altered. The private, unique stored
  // provider binding remains authoritative for later refund/dispute events.
  const [orders, reviews] = await Promise.all([
    db().collection("paygOrders")
      .where("paymentIntentId", "==", paymentIntent.id)
      .limit(2)
      .get(),
    db().collection(PAYG_PAYMENT_REVIEW_COLLECTION)
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

function paygPaymentSuccessEvidenceFromEvent(
  event: Stripe.Event
): PaygPaymentSuccessEvidence | null {
  if (event.type !== "checkout.session.completed" &&
    event.type !== "checkout.session.async_payment_succeeded") return null;
  const session = event.data.object as Stripe.Checkout.Session;
  const intentId = paygIntentIdFromCheckoutSession(session);
  const paymentIntentId = idOf(session.payment_intent);
  if (!intentId || !paymentIntentId ||
    session.object !== "checkout.session" ||
    session.mode !== "payment" || session.status !== "complete" ||
    session.payment_status !== "paid" ||
    session.livemode !== event.livemode ||
    typeof event.id !== "string" ||
    !/^evt_[A-Za-z0-9_]{4,250}$/.test(event.id) ||
    !Number.isSafeInteger(event.created) || event.created <= 0) return null;
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
export async function dispatchPaygStripeEvent(event: Stripe.Event): Promise<boolean> {
  switch (event.type) {
  case "checkout.session.completed":
  case "checkout.session.async_payment_succeeded": {
    const trigger = event.data.object as Stripe.Checkout.Session;
    if (!paygIntentIdFromCheckoutSession(trigger)) return false;
    const successEvidence = paygPaymentSuccessEvidenceFromEvent(event);
    const session = await stripe().checkout.sessions.retrieve(trigger.id);
    if (session.payment_status === "unpaid" ||
      (successEvidence === null && event.type === "checkout.session.completed" &&
        trigger.payment_status === "unpaid")) {
      await markPaygPaymentPending(session);
    } else {
      await fulfilPaygCheckoutSession(session, successEvidence);
    }
    return true;
  }
  case "checkout.session.expired":
  case "checkout.session.async_payment_failed": {
    const session = event.data.object as Stripe.Checkout.Session;
    if (!isPaygMetadata(session.metadata)) return false;
    assertStripeObjectMode("Checkout Session", session.id, session.livemode);
    await releasePaygSession(session, event.type);
    return true;
  }
  case "charge.refunded": {
    const delivered = event.data.object as Stripe.Charge;
    const charge = await stripe().charges.retrieve(delivered.id);
    assertStripeObjectMode("Charge", charge.id, charge.livemode);
    const paymentIntent = await paygPaymentIntentForCharge(charge);
    if (!paymentIntent) return false;
    await applyPaygChargeRefund(charge, paymentIntent);
    return true;
  }
  case "refund.created":
  case "refund.updated":
  case "refund.failed": {
    const delivered = event.data.object as Stripe.Refund;
    const refund = await stripe().refunds.retrieve(delivered.id);
    if (await convergePaygRefund(refund)) return true;
    return convergePaygPaymentReviewRefund(refund);
  }
  case "charge.dispute.created":
  case "charge.dispute.updated":
  case "charge.dispute.closed": {
    const delivered = event.data.object as Stripe.Dispute;
    const dispute = await stripe().disputes.retrieve(delivered.id);
    assertStripeObjectMode("Dispute", dispute.id, dispute.livemode);
    const chargeId = idOf(dispute.charge);
    if (!chargeId) return false;
    const charge = await stripe().charges.retrieve(chargeId);
    assertStripeObjectMode("Charge", charge.id, charge.livemode);
    const paymentIntent = await paygPaymentIntentForCharge(charge);
    if (!paymentIntent) return false;
    await applyPaygDispute(dispute, paymentIntent);
    return true;
  }
  default:
    return false;
  }
}

const PAYG_CHECKOUT_RECOVERY_LEASE_MS = 5 * 60 * 1000;
let paygSessionRecoveryAfterReadTestBarrier: Readonly<{
  markReached: () => void;
  waitForRelease: Promise<void>;
}> | null = null;

function pauseNextPaygSessionRecoveryAfterRead(): Readonly<{
  reached: Promise<void>;
  release: () => void;
}> {
  if (!isFirebaseFunctionsEmulatorProcess()) {
    throw new Error("PAYG session recovery read pause is emulator-only.");
  }
  if (paygSessionRecoveryAfterReadTestBarrier !== null) {
    throw new Error("A PAYG session recovery read pause is already active.");
  }
  let markReached!: () => void;
  let release!: () => void;
  const reached = new Promise<void>((resolve) => {
    markReached = resolve;
  });
  const waitForRelease = new Promise<void>((resolve) => {
    release = resolve;
  });
  paygSessionRecoveryAfterReadTestBarrier = {markReached, waitForRelease};
  return Object.freeze({reached, release});
}

async function maybePausePaygSessionRecoveryAfterReadForTest(): Promise<void> {
  const barrier = paygSessionRecoveryAfterReadTestBarrier;
  if (!barrier) return;
  paygSessionRecoveryAfterReadTestBarrier = null;
  barrier.markReached();
  await barrier.waitForRelease;
}

type RecoveredPaygSessionWrite =
  | "recorded"
  | "privacy_expired"
  | "claim_lost"
  | "terminal";

type PaygSessionRecoveryClaim =
  | Readonly<{outcome: "claimed"; intent: PaygIntentDoc; token: string}>
  | Readonly<{
    outcome:
      | "deferred"
      | "privacy_expired"
      | "fulfilled"
      | "released"
      | "session_recorded";
    intent: PaygIntentDoc;
  }>;

function hasRecoverablePaygIntentPii(
  intent: PaygIntentDoc,
  nowMillis: number
): boolean {
  const piiRetentionCutoffMillis = timestampMillis(
    intent.piiRetentionCutoffAt
  );
  return (intent.piiScrubbedAt === undefined || intent.piiScrubbedAt === null) &&
    typeof intent.contact?.email === "string" &&
    intent.contact.email.trim().length > 0 &&
    piiRetentionCutoffMillis !== null &&
    piiRetentionCutoffMillis > nowMillis;
}

async function claimPaygSessionRecovery(
  intentRef: DocumentReference,
  nowMillis: number
): Promise<PaygSessionRecoveryClaim> {
  const token = randomUUID();
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(intentRef);
    await maybePausePaygSessionRecoveryAfterReadForTest();
    // Re-evaluate after the transactional read on every attempt. A slow read
    // or retry that crosses the immutable cutoff must never create a late
    // provider-recovery claim from the stale pre-read time.
    const checkedAt = Math.max(nowMillis, Date.now());
    if (!snap.exists) throw new Error(`PAYG intent ${intentRef.id} disappeared.`);
    const intent = snap.data() as PaygIntentDoc;
    if (intent.status === "fulfilled") return {outcome: "fulfilled", intent};
    if (intent.capacityState === "released") return {outcome: "released", intent};
    if (intent.checkoutSessionId) return {outcome: "session_recorded", intent};
    if (!hasRecoverablePaygIntentPii(intent, checkedAt)) {
      return {outcome: "privacy_expired", intent};
    }
    const activeLeaseToken = snap.get("checkoutRecoveryToken");
    const activeLeaseExpiresAt = timestampMillis(
      snap.get("checkoutRecoveryLeaseExpiresAt")
    );
    if (typeof activeLeaseToken === "string" && activeLeaseToken.length > 0 &&
      activeLeaseExpiresAt !== null && activeLeaseExpiresAt > checkedAt) {
      return {outcome: "deferred", intent};
    }
    tx.set(intentRef, {
      checkoutRecoveryToken: token,
      checkoutRecoveryClaimedAt: serverTimestamp(),
      checkoutRecoveryLeaseExpiresAt: Timestamp.fromMillis(
        checkedAt + PAYG_CHECKOUT_RECOVERY_LEASE_MS
      ),
      updatedAt: serverTimestamp(),
    }, {merge: true});
    return {outcome: "claimed", intent, token};
  });
}

async function recordRecoveredSession(
  intentRef: DocumentReference,
  session: Stripe.Checkout.Session,
  recoveryToken: string,
  nowMillis: number
): Promise<RecoveredPaygSessionWrite> {
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(intentRef);
    if (!snap.exists) throw new Error(`PAYG intent ${intentRef.id} disappeared.`);
    const intent = snap.data() as PaygIntentDoc;
    if (intent.checkoutSessionId && intent.checkoutSessionId !== session.id) {
      throw new Error(`PAYG intent ${intentRef.id} has conflicting Checkout Sessions.`);
    }
    if (intent.status === "fulfilled" || intent.capacityState === "released") {
      if (snap.get("checkoutRecoveryToken") === recoveryToken) {
        tx.set(intentRef, {
          checkoutRecoveryToken: FieldValue.delete(),
          checkoutRecoveryLeaseExpiresAt: FieldValue.delete(),
          updatedAt: serverTimestamp(),
        }, {merge: true});
      }
      return "terminal";
    }
    if (snap.get("checkoutRecoveryToken") !== recoveryToken) {
      return "claim_lost";
    }
    if (!hasRecoverablePaygIntentPii(
      intent,
      Math.max(nowMillis, Date.now())
    )) {
      // Privacy redaction can win after the recovery query but before Stripe
      // answers. Retain only the provider identifier needed for reconciliation;
      // never recreate the customer-bearing Checkout URL from that stale read.
      tx.set(intentRef, {
        checkoutSessionId: session.id,
        checkoutSessionUrl: FieldValue.delete(),
        checkoutRecoveryToken: FieldValue.delete(),
        checkoutRecoveryLeaseExpiresAt: FieldValue.delete(),
        privacyRecoveryBlockedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, {merge: true});
      return "privacy_expired";
    }
    tx.set(intentRef, {
      status: "checkout_created",
      checkoutSessionId: session.id,
      checkoutSessionUrl: session.url,
      checkoutRecoveryToken: FieldValue.delete(),
      checkoutRecoveryLeaseExpiresAt: FieldValue.delete(),
      updatedAt: serverTimestamp(),
    }, {merge: true});
    return "recorded";
  });
}

async function recoverPaygHold(
  intentDoc: QueryDocumentSnapshot,
  nowMillis: number
): Promise<"fulfilled" | "released" | "deferred"> {
  const intentRef = intentDoc.ref;
  let intent = intentDoc.data() as PaygIntentDoc;
  if (intent.status === "fulfilled" || intent.capacityState === "released") {
    await intentRef.set({holdExpiresAt: FieldValue.delete()}, {merge: true});
    return intent.status === "fulfilled" ? "fulfilled" : "released";
  }
  let privacyExpiredDuringRecovery = false;
  let session: Stripe.Checkout.Session | null = null;
  try {
    if (intent.checkoutSessionId) {
      session = await stripe().checkout.sessions.retrieve(intent.checkoutSessionId);
    } else {
      const claim = await claimPaygSessionRecovery(intentRef, nowMillis);
      intent = claim.intent;
      if (claim.outcome === "fulfilled" || claim.outcome === "released") {
        await intentRef.set({holdExpiresAt: FieldValue.delete()}, {merge: true});
        return claim.outcome;
      }
      if (claim.outcome === "deferred") return "deferred";
      if (claim.outcome === "privacy_expired") {
        // The approved privacy deadline can outlive a persistently failed
        // create/recovery attempt. Once its PII is redacted, no new Checkout
        // may be reconstructed; release the stale hold while preserving the
        // non-PII recovery/audit record. A provider event for a payment that
        // somehow completed still follows the missing-evidence review/refund
        // path in fulfilPaygCheckoutSession.
        await releasePaygHold(
          intentRef,
          "privacy_redacted_before_session_recovery"
        );
        return "released";
      }
      if (claim.outcome === "session_recorded") {
        session = await stripe().checkout.sessions.retrieve(
          String(intent.checkoutSessionId)
        );
      } else if (claim.outcome === "claimed") {
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
        const writeOutcome = await recordRecoveredSession(
          intentRef,
          session,
          claim.token,
          nowMillis
        );
        if (writeOutcome === "claim_lost") return "deferred";
        privacyExpiredDuringRecovery = writeOutcome === "privacy_expired";
      }
    }
  } catch (error) {
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
    } catch (error) {
      // It may have completed between retrieve and expire. Re-read before any
      // capacity release so a paid class is never silently dropped.
      session = await stripe().checkout.sessions.retrieve(session.id);
      assertSessionBinding(session, intentRef.id, intent);
      if (session.status === "complete" && session.payment_status === "paid") {
        await fulfilPaygCheckoutSession(session);
        return "fulfilled";
      }
      if (session.status === "open") throw error;
    }
  }
  await releasePaygHold(
    intentRef,
    privacyExpiredDuringRecovery ?
      "privacy_redacted_during_session_recovery" :
      "recovery_confirmed_session_ended",
    session.id
  );
  return "released";
}

async function recoverDuePaygHolds(
  nowMillis: number,
  limit: number
): Promise<{fulfilled: number; released: number; deferred: number; failed: number}> {
  const due = await db().collection("paygIntents")
    .where("holdExpiresAt", "<=", Timestamp.fromMillis(nowMillis))
    .limit(limit)
    .get();
  const result = {fulfilled: 0, released: 0, deferred: 0, failed: 0};
  for (const intent of due.docs) {
    try {
      result[await recoverPaygHold(intent, nowMillis)] += 1;
    } catch (error) {
      result.failed += 1;
      console.error("PAYG hold recovery failed", {intentId: intent.id, error});
    }
  }
  return result;
}

type PaygPiiRedactionResult = {
  redacted: number;
  deferred: number;
  skipped: number;
  failed: number;
};

export type PaygPiiRedactionSweepResult = Readonly<{
  intents: Readonly<PaygPiiRedactionResult>;
  orders: Readonly<PaygPiiRedactionResult>;
  outbox: Readonly<PaygPiiRedactionResult>;
  waivers: Readonly<PaygPiiRedactionResult>;
}>;

const PAYG_PII_REDACTION_FAILURE_RETRY_MS = 60 * 60 * 1000;
const PAYG_PII_DISCOVERY_STATE_COLLECTION = "paygPiiRedactionDiscovery";
const PAYG_PII_DISCOVERY_LEASE_MS = 5 * 60 * 1000;
const injectedPaygPiiRedactionFailures = new Set<string>();

type PaygPiiDiscoveryConfig = Readonly<{
  collectionId:
    | "paygIntents"
    | "paygOrders"
    | "paygEmailOutbox"
    | "paygWaiverAcceptances";
  piiFields: readonly string[];
  legacyScheduleField: "piiScrubAt" | "piiRedactAt";
  redactedAtField: "piiScrubbedAt" | "piiRedactedAt";
  discoversBookingBinding?: boolean;
}>;

function injectPaygPiiRedactionFailureOnce(
  collectionId: PaygPiiDiscoveryConfig["collectionId"],
  documentId: string
): void {
  if (!isFirebaseFunctionsEmulatorProcess()) {
    throw new Error("PAYG PII redaction failure injection is emulator-only.");
  }
  if (!PAYG_PII_DISCOVERY_CONFIGS.some(
    (config) => config.collectionId === collectionId
  ) || !documentId || documentId.includes("/")) {
    throw new Error("PAYG PII redaction failure injection target is invalid.");
  }
  injectedPaygPiiRedactionFailures.add(`${collectionId}/${documentId}`);
}

function maybeThrowInjectedPaygPiiRedactionFailure(
  collectionId: PaygPiiDiscoveryConfig["collectionId"],
  documentId: string
): void {
  const key = `${collectionId}/${documentId}`;
  if (!injectedPaygPiiRedactionFailures.delete(key)) return;
  throw new Error(`Injected PAYG PII redaction failure for ${key}.`);
}

const PAYG_PII_DISCOVERY_CONFIGS = Object.freeze([
  Object.freeze({
    collectionId: "paygIntents",
    piiFields: PAYG_INTENT_PII_FIELDS,
    legacyScheduleField: "piiScrubAt",
    redactedAtField: "piiScrubbedAt",
  }),
  Object.freeze({
    collectionId: "paygOrders",
    piiFields: PAYG_ORDER_PII_FIELDS,
    legacyScheduleField: "piiRedactAt",
    redactedAtField: "piiRedactedAt",
    discoversBookingBinding: true,
  }),
  Object.freeze({
    collectionId: "paygEmailOutbox",
    piiFields: PAYG_OUTBOX_PII_FIELDS,
    legacyScheduleField: "piiRedactAt",
    redactedAtField: "piiRedactedAt",
  }),
  Object.freeze({
    collectionId: "paygWaiverAcceptances",
    piiFields: PAYG_WAIVER_PII_FIELDS,
    legacyScheduleField: "piiRedactAt",
    redactedAtField: "piiRedactedAt",
  }),
] satisfies readonly PaygPiiDiscoveryConfig[]);

function emptyPaygPiiRedactionResult(): PaygPiiRedactionResult {
  return {redacted: 0, deferred: 0, skipped: 0, failed: 0};
}

function assertPaygPiiSweepInput(nowMillis: number, limit: number): void {
  if (!Number.isSafeInteger(nowMillis) || nowMillis <= 0 ||
    !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("PAYG PII redaction sweep bounds are invalid.");
  }
}

const PAYG_EMAIL_LEASE_MS = 10 * 60 * 1000;

export function isActivePaygEmailLease(input: Readonly<{
  status: unknown;
  leaseToken: unknown;
  leaseStartedAtMillis: number | null;
  leaseExpiresAtMillis: number | null;
  retentionCutoffAtMillis: number | null;
  nowMillis: number;
}>): boolean {
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

type PaygPiiDiscoveryLease = Readonly<{
  token: string;
  cursorDocumentId: string | null;
}>;

function paygPiiDiscoveryStateRef(
  config: PaygPiiDiscoveryConfig
): DocumentReference {
  return db().collection(PAYG_PII_DISCOVERY_STATE_COLLECTION)
    .doc(config.collectionId);
}

async function acquirePaygPiiDiscoveryLease(
  config: PaygPiiDiscoveryConfig,
  nowMillis: number
): Promise<PaygPiiDiscoveryLease | null> {
  const stateRef = paygPiiDiscoveryStateRef(config);
  return db().runTransaction(async (tx) => {
    const state = await tx.get(stateRef);
    const leaseExpiresAt = timestampMillis(state.get("leaseExpiresAt"));
    if (leaseExpiresAt !== null && leaseExpiresAt > nowMillis) return null;
    const storedCursor = state.get("cursorDocumentId");
    const cursorDocumentId = typeof storedCursor === "string" && storedCursor ?
      storedCursor : null;
    const token = randomUUID();
    tx.set(stateRef, {
      schemaVersion: 1,
      collectionId: config.collectionId,
      cursorDocumentId,
      leaseToken: token,
      leaseExpiresAt: Timestamp.fromMillis(
        nowMillis + PAYG_PII_DISCOVERY_LEASE_MS
      ),
      lastStartedAt: serverTimestamp(),
      ...(state.exists ? {} : {createdAt: serverTimestamp()}),
      updatedAt: serverTimestamp(),
    }, {merge: true});
    return {token, cursorDocumentId};
  });
}

function paygDocumentHasDiscoverablePii(
  snapshot: DocumentSnapshot,
  config: PaygPiiDiscoveryConfig
): boolean {
  return config.piiFields.some((field) => {
    const value = snapshot.get(field);
    return value !== undefined && value !== null;
  });
}

async function hasExactBoundPaygBookingPii(
  tx: Transaction,
  order: DocumentSnapshot,
  config: PaygPiiDiscoveryConfig
): Promise<boolean> {
  if (config.discoversBookingBinding !== true) return false;
  const bookingId = order.get("bookingId");
  if (typeof bookingId !== "string" || !bookingId ||
    bookingId.includes("/")) return false;
  const booking = await tx.get(db().collection("bookings").doc(bookingId));
  return booking.exists && booking.get("bookingKind") === "payg_guest" &&
    booking.get("paygOrderId") === order.id &&
    hasNonNullDocumentField(booking, "userName");
}

function hasLegitimatePaygPiiRetryDeferral(
  candidate: DocumentSnapshot,
  config: PaygPiiDiscoveryConfig,
  cutoff: number | null,
  retryAt: number,
  nowMillis: number
): boolean {
  if (timestampMillis(candidate.get("piiRedactionLastFailedAt")) !== null &&
    retryAt <= nowMillis + PAYG_PII_REDACTION_FAILURE_RETRY_MS) return true;
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

async function scheduleDiscoveredPaygPiiCandidate(
  candidateRef: DocumentReference,
  config: PaygPiiDiscoveryConfig,
  nowMillis: number
): Promise<boolean> {
  return db().runTransaction(async (tx) => {
    const candidate = await tx.get(candidateRef);
    if (!candidate.exists) return false;
    const hasInlinePii = paygDocumentHasDiscoverablePii(candidate, config);
    const hasBookingPii = hasInlinePii ? false :
      await hasExactBoundPaygBookingPii(tx, candidate, config);
    if (!hasInlinePii && !hasBookingPii) return false;
    const retryAt = timestampMillis(
      candidate.get(PAYG_PII_REDACTION_RETRY_FIELD)
    );
    const cutoff = timestampMillis(
      candidate.get(PAYG_PII_RETENTION_CUTOFF_FIELD)
    );
    const privacyAlreadyClosed = hasNonNullDocumentField(
      candidate,
      config.redactedAtField
    );
    let normalizedRetryAt: number | null = null;
    if (privacyAlreadyClosed) {
      if (retryAt === null || retryAt > nowMillis) normalizedRetryAt = nowMillis;
    } else if (cutoff !== null && cutoff > nowMillis) {
      if (retryAt !== cutoff) normalizedRetryAt = cutoff;
    } else if (retryAt === null) {
      normalizedRetryAt = nowMillis;
    } else if (retryAt > nowMillis && !hasLegitimatePaygPiiRetryDeferral(
      candidate,
      config,
      cutoff,
      retryAt,
      nowMillis
    )) {
      normalizedRetryAt = nowMillis;
    }
    const hasLegacySchedule =
      candidate.get(config.legacyScheduleField) !== undefined;
    const hasAbandonedIntentTtl = config.collectionId === "paygIntents" &&
      candidate.get("piiDeleteAt") !== undefined;
    if (normalizedRetryAt === null && !hasLegacySchedule &&
      !hasAbandonedIntentTtl) return false;

    tx.set(candidateRef, {
      ...(normalizedRetryAt === null ? {} : {
        [PAYG_PII_REDACTION_RETRY_FIELD]:
          Timestamp.fromMillis(normalizedRetryAt),
      }),
      [config.legacyScheduleField]: FieldValue.delete(),
      ...(config.collectionId === "paygIntents" ? {
        // Disarm the abandoned whole-document TTL proposal as soon as an old
        // row is encountered, even if its canonical cutoff is still future.
        piiDeleteAt: FieldValue.delete(),
      } : {}),
      piiRedactionDiscoveredAt: serverTimestamp(),
      piiRedactionDiscoveryReason: privacyAlreadyClosed ?
        "pii_reintroduced_after_redaction" : cutoff === null ?
          "retention_cutoff_missing" : retryAt === null ?
            "retry_marker_missing" : normalizedRetryAt !== null ?
              "retry_marker_normalized" : "legacy_schedule_removed",
      ...(privacyAlreadyClosed ? {
        piiRedactionReintroducedAt: serverTimestamp(),
      } : {}),
      updatedAt: serverTimestamp(),
    }, {merge: true});
    return true;
  });
}

async function finishPaygPiiDiscoveryPage(
  config: PaygPiiDiscoveryConfig,
  lease: PaygPiiDiscoveryLease,
  pageSize: number,
  limit: number,
  lastDocumentId: string | null,
  scheduledCount: number
): Promise<void> {
  const stateRef = paygPiiDiscoveryStateRef(config);
  await db().runTransaction(async (tx) => {
    const state = await tx.get(stateRef);
    if (!state.exists || state.get("leaseToken") !== lease.token) return;
    const cycleComplete = pageSize < limit;
    tx.set(stateRef, {
      cursorDocumentId: cycleComplete ? null : lastDocumentId,
      scannedCount: FieldValue.increment(pageSize),
      scheduledCount: FieldValue.increment(scheduledCount),
      ...(cycleComplete ? {completedCycleCount: FieldValue.increment(1)} : {}),
      leaseToken: FieldValue.delete(),
      leaseExpiresAt: FieldValue.delete(),
      lastError: FieldValue.delete(),
      lastCompletedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, {merge: true});
  });
}

async function releaseFailedPaygPiiDiscoveryLease(
  config: PaygPiiDiscoveryConfig,
  lease: PaygPiiDiscoveryLease,
  error: unknown
): Promise<void> {
  const stateRef = paygPiiDiscoveryStateRef(config);
  const message = error instanceof Error ? error.message : String(error);
  await db().runTransaction(async (tx) => {
    const state = await tx.get(stateRef);
    if (!state.exists || state.get("leaseToken") !== lease.token) return;
    tx.set(stateRef, {
      leaseToken: FieldValue.delete(),
      leaseExpiresAt: FieldValue.delete(),
      lastError: message.slice(0, 1000),
      lastFailedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, {merge: true});
  });
}

async function discoverPaygPiiCandidates(
  config: PaygPiiDiscoveryConfig,
  nowMillis: number,
  limit: number
): Promise<void> {
  const lease = await acquirePaygPiiDiscoveryLease(config, nowMillis);
  if (!lease) return;
  try {
    const baseQuery = db().collection(config.collectionId)
      .orderBy(FieldPath.documentId())
      .limit(limit);
    const page = lease.cursorDocumentId ?
      await baseQuery.startAfter(lease.cursorDocumentId).get() :
      await baseQuery.get();
    let scheduledCount = 0;
    for (const candidate of page.docs) {
      if (await scheduleDiscoveredPaygPiiCandidate(
        candidate.ref,
        config,
        nowMillis
      )) scheduledCount += 1;
    }
    await finishPaygPiiDiscoveryPage(
      config,
      lease,
      page.size,
      limit,
      page.docs.length > 0 ? page.docs[page.docs.length - 1].id : null,
      scheduledCount
    );
  } catch (error) {
    await releaseFailedPaygPiiDiscoveryLease(config, lease, error)
      .catch((releaseError) => console.error(
        "Could not release PAYG PII discovery lease",
        {collectionId: config.collectionId, releaseError}
      ));
    throw error;
  }
}

async function deferPaygPiiRedactionAfterFailure(
  ref: DocumentReference,
  nowMillis: number
): Promise<void> {
  await ref.set({
    [PAYG_PII_REDACTION_RETRY_FIELD]: Timestamp.fromMillis(
      nowMillis + PAYG_PII_REDACTION_FAILURE_RETRY_MS
    ),
    piiRedactionFailureCount: FieldValue.increment(1),
    piiRedactionLastFailedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, {merge: true});
}

async function recoverDuePaygIntentPrivacy(
  nowMillis: number,
  limit: number
): Promise<PaygPiiRedactionResult> {
  const due = await db().collection("paygIntents")
    .where(PAYG_PII_REDACTION_RETRY_FIELD, "<=", Timestamp.fromMillis(nowMillis))
    .limit(limit)
    .get();
  const result = emptyPaygPiiRedactionResult();
  for (const intent of due.docs) {
    try {
      const outcome = await db().runTransaction(async (tx) => {
        const fresh = await tx.get(intent.ref);
        const retryAt = fresh.exists ? timestampMillis(
          fresh.get(PAYG_PII_REDACTION_RETRY_FIELD)
        ) : null;
        if (!fresh.exists || retryAt === null || retryAt > nowMillis) {
          return "skipped" as const;
        }
        const cutoff = timestampMillis(
          fresh.get(PAYG_PII_RETENTION_CUTOFF_FIELD)
        );
        const privacyAlreadyClosed = hasNonNullDocumentField(
          fresh,
          "piiScrubbedAt"
        );
        if (!privacyAlreadyClosed && cutoff !== null && cutoff > nowMillis) {
          tx.set(intent.ref, {
            [PAYG_PII_REDACTION_RETRY_FIELD]: Timestamp.fromMillis(cutoff),
            updatedAt: serverTimestamp(),
          }, {merge: true});
          return "skipped" as const;
        }
        const status = fresh.get("status");
        const knownOperationalStatus = status === "reserved" ||
          status === "checkout_created" ||
          status === "payment_pending" || status === "expired" ||
          status === "failed" || status === "fulfilled" ||
          status === "manual_review";
        maybeThrowInjectedPaygPiiRedactionFailure("paygIntents", intent.id);
        tx.set(intent.ref, {
          attendee: FieldValue.delete(),
          contact: FieldValue.delete(),
          acceptances: FieldValue.delete(),
          requestFingerprint: FieldValue.delete(),
          checkoutSessionUrl: FieldValue.delete(),
          [PAYG_PII_REDACTION_RETRY_FIELD]: FieldValue.delete(),
          piiScrubAt: FieldValue.delete(),
          piiDeleteAt: FieldValue.delete(),
          piiScrubbedAt: serverTimestamp(),
          piiScrubReason: cutoff === null ?
            "retention_cutoff_missing" : "retention_expired",
          piiRedactionPolicyVersion:
            fresh.get("privacy.policyVersion") ?? "unrecorded-v1",
          piiRedactionDeferredAt: FieldValue.delete(),
          piiRedactionDeferredReason: FieldValue.delete(),
          piiRedactionLastFailedAt: FieldValue.delete(),
          ...(knownOperationalStatus ? {
            piiRedactionOperationalWarning: FieldValue.delete(),
            piiRedactionOperationalWarningAt: FieldValue.delete(),
          } : {
            // Operational corruption must not become authority to retain guest
            // identity. Preserve a non-PII warning while redacting regardless.
            piiRedactionOperationalWarning: "unknown_intent_status",
            piiRedactionOperationalWarningAt: serverTimestamp(),
          }),
          updatedAt: serverTimestamp(),
        }, {merge: true});
        return knownOperationalStatus ?
          "redacted" as const : "redacted_operational_warning" as const;
      });
      if (outcome === "redacted_operational_warning") {
        result.redacted += 1;
        console.error("PAYG intent privacy state requires manual review", {
          intentId: intent.id,
          warning: "unknown_intent_status",
        });
      } else {
        result[outcome] += 1;
      }
    } catch (error) {
      result.failed += 1;
      console.error("PAYG intent privacy recovery failed", {
        intentId: intent.id,
        error,
      });
      await deferPaygPiiRedactionAfterFailure(
        intent.ref,
        nowMillis
      ).catch(() => undefined);
    }
  }
  return result;
}

async function recoverDuePaygOrderPrivacy(
  nowMillis: number,
  limit: number
): Promise<PaygPiiRedactionResult> {
  const due = await db().collection("paygOrders")
    .where(PAYG_PII_REDACTION_RETRY_FIELD, "<=", Timestamp.fromMillis(nowMillis))
    .limit(limit)
    .get();
  const result = emptyPaygPiiRedactionResult();
  for (const order of due.docs) {
    try {
      const outcome = await db().runTransaction(async (tx) => {
        const fresh = await tx.get(order.ref);
        const retryAt = fresh.exists ? timestampMillis(
          fresh.get(PAYG_PII_REDACTION_RETRY_FIELD)
        ) : null;
        if (!fresh.exists || retryAt === null || retryAt > nowMillis) {
          return "skipped" as const;
        }
        const cutoff = timestampMillis(
          fresh.get(PAYG_PII_RETENTION_CUTOFF_FIELD)
        );
        const privacyAlreadyClosed = hasNonNullDocumentField(
          fresh,
          "piiRedactedAt"
        );
        if (!privacyAlreadyClosed && cutoff !== null && cutoff > nowMillis) {
          tx.set(order.ref, {
            [PAYG_PII_REDACTION_RETRY_FIELD]: Timestamp.fromMillis(cutoff),
            updatedAt: serverTimestamp(),
          }, {merge: true});
          return "skipped" as const;
        }
        const bookingId = fresh.get("bookingId");
        const bookingIdIsAbsent = bookingId === null || bookingId === undefined;
        const bookingIdIsValid = typeof bookingId === "string" &&
          bookingId.length > 0 && !bookingId.includes("/");
        const bookingRef = bookingIdIsValid ?
          db().collection("bookings").doc(bookingId) : null;
        const booking = bookingRef ? await tx.get(bookingRef) : null;
        const bookingBindingConflict = booking?.exists === true &&
          (booking.get("bookingKind") !== "payg_guest" ||
            booking.get("paygOrderId") !== order.id);
        const bookingWarning = !bookingIdIsAbsent && !bookingIdIsValid ?
          "invalid_booking_binding" : bookingBindingConflict ?
            "conflicting_booking_binding" : null;
        maybeThrowInjectedPaygPiiRedactionFailure("paygOrders", order.id);
        tx.set(order.ref, {
          attendee: FieldValue.delete(),
          contact: FieldValue.delete(),
          acceptances: FieldValue.delete(),
          [PAYG_PII_REDACTION_RETRY_FIELD]: FieldValue.delete(),
          piiRedactAt: FieldValue.delete(),
          piiRedactedAt: serverTimestamp(),
          piiRedactionReason: cutoff === null ?
            "retention_cutoff_missing" : "retention_expired",
          piiRedactionPolicyVersion:
            fresh.get("privacy.policyVersion") ?? "unrecorded-v1",
          piiRedactionLastFailedAt: FieldValue.delete(),
          piiRedactionBookingWarning:
            bookingWarning ?? FieldValue.delete(),
          piiRedactionBookingWarningAt: bookingWarning ?
            serverTimestamp() : FieldValue.delete(),
          updatedAt: serverTimestamp(),
        }, {merge: true});
        if (booking?.exists && bookingRef && !bookingBindingConflict) {
          tx.set(bookingRef, {
            userName: FieldValue.delete(),
            paygPiiRedactedAt: serverTimestamp(),
            paygPiiRedactionReason: cutoff === null ?
              "retention_cutoff_missing" : "retention_expired",
            updatedAt: serverTimestamp(),
          }, {merge: true});
        }
        return bookingWarning ?
          "redacted_booking_warning" as const : "redacted" as const;
      });
      if (outcome === "redacted_booking_warning") {
        result.redacted += 1;
        console.error("PAYG order booking privacy binding requires manual review", {
          orderId: order.id,
        });
      } else {
        result[outcome] += 1;
      }
    } catch (error) {
      result.failed += 1;
      console.error("PAYG order privacy redaction failed", {
        orderId: order.id,
        error,
      });
      await deferPaygPiiRedactionAfterFailure(
        order.ref,
        nowMillis
      ).catch(() => undefined);
    }
  }
  return result;
}

async function recoverDuePaygOutboxPrivacy(
  nowMillis: number,
  limit: number
): Promise<PaygPiiRedactionResult> {
  const due = await db().collection("paygEmailOutbox")
    .where(PAYG_PII_REDACTION_RETRY_FIELD, "<=", Timestamp.fromMillis(nowMillis))
    .limit(limit)
    .get();
  const result = emptyPaygPiiRedactionResult();
  for (const outbox of due.docs) {
    try {
      const outcome = await db().runTransaction(async (tx) => {
        const fresh = await tx.get(outbox.ref);
        const retryAt = fresh.exists ? timestampMillis(
          fresh.get(PAYG_PII_REDACTION_RETRY_FIELD)
        ) : null;
        if (!fresh.exists || retryAt === null || retryAt > nowMillis) {
          return "skipped" as const;
        }
        const cutoff = timestampMillis(
          fresh.get(PAYG_PII_RETENTION_CUTOFF_FIELD)
        );
        const privacyAlreadyClosed = hasNonNullDocumentField(
          fresh,
          "piiRedactedAt"
        );
        if (cutoff === null) {
          // Missing immutable evidence is already privacy-closed. Unlike an
          // approved canonical cutoff, an active or stale lease cannot justify
          // retaining or using this payload for another moment.
          maybeThrowInjectedPaygPiiRedactionFailure(
            "paygEmailOutbox",
            outbox.id
          );
          redactAndTombstonePaygOutbox(
            tx,
            fresh,
            "retention_deadline_missing"
          );
          return "redacted" as const;
        }
        if (!privacyAlreadyClosed && cutoff > nowMillis) {
          tx.set(outbox.ref, {
            [PAYG_PII_REDACTION_RETRY_FIELD]: Timestamp.fromMillis(cutoff),
            updatedAt: serverTimestamp(),
          }, {merge: true});
          return "skipped" as const;
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
            [PAYG_PII_REDACTION_RETRY_FIELD]:
              Timestamp.fromMillis(leaseExpiresAt as number),
            piiRedactionDeferredAt: serverTimestamp(),
            piiRedactionDeferredReason: "active_email_lease",
            updatedAt: serverTimestamp(),
          }, {merge: true});
          return "deferred" as const;
        }
        maybeThrowInjectedPaygPiiRedactionFailure(
          "paygEmailOutbox",
          outbox.id
        );
        tx.set(outbox.ref, {
          to: FieldValue.delete(),
          templateData: FieldValue.delete(),
          lastError: FieldValue.delete(),
          [PAYG_PII_REDACTION_RETRY_FIELD]: FieldValue.delete(),
          piiRedactAt: FieldValue.delete(),
          piiRedactedAt: serverTimestamp(),
          piiRedactionReason: cutoff === null ?
            "retention_cutoff_missing" : "retention_expired",
          piiRedactionDeferredAt: FieldValue.delete(),
          piiRedactionDeferredReason: FieldValue.delete(),
          piiRedactionLastFailedAt: FieldValue.delete(),
          updatedAt: serverTimestamp(),
        }, {merge: true});
        return "redacted" as const;
      });
      result[outcome] += 1;
    } catch (error) {
      result.failed += 1;
      console.error("PAYG outbox privacy redaction failed", {
        outboxId: outbox.id,
        error,
      });
      await deferPaygPiiRedactionAfterFailure(
        outbox.ref,
        nowMillis
      ).catch(() => undefined);
    }
  }
  return result;
}

async function recoverDuePaygWaiverPrivacy(
  nowMillis: number,
  limit: number
): Promise<PaygPiiRedactionResult> {
  const due = await db().collection("paygWaiverAcceptances")
    .where(PAYG_PII_REDACTION_RETRY_FIELD, "<=", Timestamp.fromMillis(nowMillis))
    .limit(limit)
    .get();
  const result = emptyPaygPiiRedactionResult();
  for (const waiver of due.docs) {
    try {
      const outcome = await db().runTransaction(async (tx) => {
        const fresh = await tx.get(waiver.ref);
        const retryAt = fresh.exists ? timestampMillis(
          fresh.get(PAYG_PII_REDACTION_RETRY_FIELD)
        ) : null;
        if (!fresh.exists || retryAt === null || retryAt > nowMillis) {
          return "skipped" as const;
        }
        const cutoff = timestampMillis(
          fresh.get(PAYG_PII_RETENTION_CUTOFF_FIELD)
        );
        const privacyAlreadyClosed = hasNonNullDocumentField(
          fresh,
          "piiRedactedAt"
        );
        if (!privacyAlreadyClosed && cutoff !== null && cutoff > nowMillis) {
          tx.set(waiver.ref, {
            [PAYG_PII_REDACTION_RETRY_FIELD]: Timestamp.fromMillis(cutoff),
            updatedAt: serverTimestamp(),
          }, {merge: true});
          return "skipped" as const;
        }
        maybeThrowInjectedPaygPiiRedactionFailure(
          "paygWaiverAcceptances",
          waiver.id
        );
        tx.set(waiver.ref, {
          attendee: FieldValue.delete(),
          acceptances: FieldValue.delete(),
          [PAYG_PII_REDACTION_RETRY_FIELD]: FieldValue.delete(),
          piiRedactAt: FieldValue.delete(),
          piiRedactedAt: serverTimestamp(),
          piiRedactionReason: cutoff === null ?
            "retention_cutoff_missing" : "retention_expired",
          piiRedactionPolicyVersion:
            fresh.get("privacy.policyVersion") ?? "unrecorded-v1",
          piiRedactionLastFailedAt: FieldValue.delete(),
          updatedAt: serverTimestamp(),
        }, {merge: true});
        return "redacted" as const;
      });
      result[outcome] += 1;
    } catch (error) {
      result.failed += 1;
      console.error("PAYG waiver privacy redaction failed", {
        waiverId: waiver.id,
        error,
      });
      await deferPaygPiiRedactionAfterFailure(
        waiver.ref,
        nowMillis
      ).catch(() => undefined);
    }
  }
  return result;
}

export async function runPaygPiiRedactionSweep(
  nowMillis = Date.now(),
  limit = PAYG_PII_REDACTION_BATCH_SIZE
): Promise<PaygPiiRedactionSweepResult> {
  assertPaygPiiSweepInput(nowMillis, limit);
  const recoverWithDiscovery = async (
    config: PaygPiiDiscoveryConfig,
    recoverDue: (
      recoveryNowMillis: number,
      recoveryLimit: number
    ) => Promise<PaygPiiRedactionResult>
  ): Promise<PaygPiiRedactionResult> => {
    let discoveryFailures = 0;
    try {
      await discoverPaygPiiCandidates(config, nowMillis, limit);
    } catch (error) {
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
    recoverWithDiscovery(
      PAYG_PII_DISCOVERY_CONFIGS[0],
      recoverDuePaygIntentPrivacy
    ),
    recoverWithDiscovery(
      PAYG_PII_DISCOVERY_CONFIGS[1],
      recoverDuePaygOrderPrivacy
    ),
    recoverWithDiscovery(
      PAYG_PII_DISCOVERY_CONFIGS[2],
      recoverDuePaygOutboxPrivacy
    ),
    recoverWithDiscovery(
      PAYG_PII_DISCOVERY_CONFIGS[3],
      recoverDuePaygWaiverPrivacy
    ),
  ]);
  return Object.freeze({intents, orders, outbox, waivers});
}

async function recoverDuePaygRefunds(
  nowMillis: number,
  limit: number
): Promise<{processed: number; failed: number}> {
  const due = await db().collection("paygOrders")
    .where("refundRecoveryAt", "<=", Timestamp.fromMillis(nowMillis))
    .limit(limit)
    .get();
  const result = {processed: 0, failed: 0};
  for (const order of due.docs) {
    try {
      const storedReason = order.get("refundReason");
      const reason: PaygRefundReason = storedReason === "guest_cancellation" ||
        storedReason === "hold_released_before_payment" ||
        storedReason === "paid_contract_mismatch" ? storedReason :
        order.get("cancellation") ? "guest_cancellation" :
          "hold_released_before_payment";
      await issuePaygRefund(order.id, reason);
      result.processed += 1;
    } catch (error) {
      result.failed += 1;
      console.error("PAYG refund recovery failed", {orderId: order.id, error});
    }
  }
  return result;
}

async function recoverDuePaygPaymentReviewRefunds(
  nowMillis: number,
  limit: number
): Promise<{processed: number; failed: number}> {
  const due = await db().collection(PAYG_PAYMENT_REVIEW_COLLECTION)
    .where("refundRecoveryAt", "<=", Timestamp.fromMillis(nowMillis))
    .limit(limit)
    .get();
  const result = {processed: 0, failed: 0};
  for (const review of due.docs) {
    try {
      await issuePaygPaymentReviewRefund(review.id);
      result.processed += 1;
    } catch (error) {
      result.failed += 1;
      console.error("PAYG payment-review refund recovery failed", {
        paymentReviewId: review.id,
        error,
      });
    }
  }
  return result;
}

async function convergePaygAttendanceOutcome(
  orderDoc: QueryDocumentSnapshot
): Promise<"attended" | "no_show" | "skipped"> {
  return db().runTransaction(async (tx) => {
    const freshOrder = await tx.get(orderDoc.ref);
    if (!freshOrder.exists) return "skipped";
    const order = freshOrder.data() as PaygOrderDoc;
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
      tx.set(orderDoc.ref, {noShowReviewAt: FieldValue.delete()}, {merge: true});
      return "skipped";
    }
    const attended = booking?.get("attended") === true ||
      booking?.get("attendanceStatus") === "checked_in" ||
      timestampMillis(booking?.get("checkedInAt")) !== null;
    const status: "attended" | "no_show" = attended ? "attended" : "no_show";
    releasePaygDuplicateLock(tx, lock, orderDoc.id);
    if (status === "no_show") {
      tombstonePaygConfirmation(tx, outbox, "order_no_show");
    }
    tx.set(orderDoc.ref, {
      status,
      capacityState: "consumed",
      ...(status === "no_show" ? {confirmationEmailStatus: "not_required"} : {}),
      postStartCancellationReviewPending: FieldValue.delete(),
      noShowReviewAt: FieldValue.delete(),
      attendanceResolvedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, {merge: true});
    if (bookingRef && booking?.exists) {
      tx.set(bookingRef, {
        ...(status === "no_show" ? {attendanceStatus: "dip"} : {}),
        paygAttendanceOutcome: status,
        updatedAt: serverTimestamp(),
      }, {merge: true});
    }
    return status;
  });
}

async function recoverDuePaygNoShows(
  nowMillis: number,
  limit: number
): Promise<{attended: number; noShow: number; skipped: number; failed: number}> {
  const due = await db().collection("paygOrders")
    .where("noShowReviewAt", "<=", Timestamp.fromMillis(nowMillis))
    .limit(limit)
    .get();
  const result = {attended: 0, noShow: 0, skipped: 0, failed: 0};
  for (const order of due.docs) {
    try {
      const outcome = await convergePaygAttendanceOutcome(order);
      if (outcome === "attended") result.attended += 1;
      else if (outcome === "no_show") result.noShow += 1;
      else result.skipped += 1;
    } catch (error) {
      result.failed += 1;
      console.error("PAYG attendance convergence failed", {orderId: order.id, error});
    }
  }
  return result;
}

type PaygConfirmationOutboxPayload = ReturnType<
  typeof buildPaygConfirmationOutboxPayload
>;
type PaygConfirmationCorrectionOutboxPayload = ReturnType<
  typeof buildPaygConfirmationCorrectionOutboxPayload
>;
type PaygEmailOutboxPayload =
  | PaygConfirmationOutboxPayload
  | PaygConfirmationCorrectionOutboxPayload;

type PaygConfirmationEmail = Readonly<{
  from: string;
  to: readonly string[];
  reply_to: string;
  subject: string;
  text: string;
  html: string;
}>;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function assertEmailRoutingAddress(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 320 || /[\r\n]/.test(trimmed)) {
    throw new Error(`${field} is not configured safely.`);
  }
  const address = trimmed.match(/<([^<>]+)>$/)?.[1] ?? trimmed;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    throw new Error(`${field} is not configured safely.`);
  }
  return trimmed;
}

export function buildPaygConfirmationEmail(
  outbox: PaygConfirmationOutboxPayload,
  from: string,
  replyTo: string
): PaygConfirmationEmail {
  const data = outbox.templateData;
  const classStart = DateTime.fromISO(data.class.startTime, {setZone: true})
    .setZone(data.class.timezone);
  if (!classStart.isValid) throw new Error("PAYG confirmation class time is invalid.");
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

function paygCorrectionMessage(paid: string): string {
  return `Your booking is no longer active. The ${paid} payment or refund status may still be updating. If a refund is due, it will be returned to the original payment method; contact support for the latest status.`;
}

export function buildPaygConfirmationCorrectionEmail(
  outbox: PaygConfirmationCorrectionOutboxPayload,
  from: string,
  replyTo: string
): PaygConfirmationEmail {
  const data = outbox.templateData;
  const classStart = DateTime.fromISO(data.class.startTime, {setZone: true})
    .setZone(data.class.timezone);
  if (!classStart.isValid) throw new Error("PAYG correction class time is invalid.");
  const when = classStart.toFormat("cccc d LLLL yyyy 'at' HH:mm ZZZZ");
  const paid = `£${(data.amountPence / 100).toFixed(2)} ${
    data.currency.toUpperCase()
  }`;
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

function buildPaygOutboxEmail(
  outbox: PaygEmailOutboxPayload,
  from: string,
  replyTo: string
): PaygConfirmationEmail {
  return outbox.kind === "payg_guest_confirmation" ?
    buildPaygConfirmationEmail(outbox, from, replyTo) :
    buildPaygConfirmationCorrectionEmail(outbox, from, replyTo);
}

function isPaygEmailPayloadDeliverable(
  payload: PaygEmailOutboxPayload,
  status: PaygOrderStatus
): boolean {
  return payload.kind === "payg_guest_confirmation" ?
    shouldSendPaygConfirmation(status) :
    shouldEnqueuePaygConfirmationCorrection(status);
}

type PaygEmailLease =
  | Readonly<{
    state: "acquired";
    outboxId: string;
    orderId: string;
    leaseToken: string;
    attemptCount: number;
    payload: PaygEmailOutboxPayload;
    idempotencyKey: string;
    reconcileAfterStateChange: boolean;
  }>
  | Readonly<{state: "sent" | "terminal" | "in_progress" | "deferred" | "missing"}>;

const PAYG_EMAIL_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
let paygEmailPreflightTestBarrier: Readonly<{
  markReached: () => void;
  waitForRelease: Promise<void>;
}> | null = null;
let paygEmailFailureAfterReadsTestBarrier: Readonly<{
  markReached: () => void;
  waitForRelease: Promise<void>;
}> | null = null;

function pauseNextPaygEmailPreflight(): Readonly<{
  reached: Promise<void>;
  release: () => void;
}> {
  if (!isFirebaseFunctionsEmulatorProcess()) {
    throw new Error("PAYG email preflight pause is emulator-only.");
  }
  if (paygEmailPreflightTestBarrier !== null) {
    throw new Error("A PAYG email preflight pause is already active.");
  }
  let markReached!: () => void;
  let release!: () => void;
  const reached = new Promise<void>((resolve) => {
    markReached = resolve;
  });
  const waitForRelease = new Promise<void>((resolve) => {
    release = resolve;
  });
  paygEmailPreflightTestBarrier = {markReached, waitForRelease};
  return Object.freeze({reached, release});
}

async function maybePausePaygEmailPreflightForTest(): Promise<void> {
  const barrier = paygEmailPreflightTestBarrier;
  if (!barrier) return;
  paygEmailPreflightTestBarrier = null;
  barrier.markReached();
  await barrier.waitForRelease;
}

function pauseNextPaygEmailFailureAfterReads(): Readonly<{
  reached: Promise<void>;
  release: () => void;
}> {
  if (!isFirebaseFunctionsEmulatorProcess()) {
    throw new Error("PAYG email failure read pause is emulator-only.");
  }
  if (paygEmailFailureAfterReadsTestBarrier !== null) {
    throw new Error("A PAYG email failure read pause is already active.");
  }
  let markReached!: () => void;
  let release!: () => void;
  const reached = new Promise<void>((resolve) => {
    markReached = resolve;
  });
  const waitForRelease = new Promise<void>((resolve) => {
    release = resolve;
  });
  paygEmailFailureAfterReadsTestBarrier = {markReached, waitForRelease};
  return Object.freeze({reached, release});
}

async function maybePausePaygEmailFailureAfterReadsForTest(): Promise<void> {
  const barrier = paygEmailFailureAfterReadsTestBarrier;
  if (!barrier) return;
  paygEmailFailureAfterReadsTestBarrier = null;
  barrier.markReached();
  await barrier.waitForRelease;
}

type PaygOutboxPrivacyClosureReason =
  | "retention_expired"
  | "retention_deadline_missing";

function paygOutboxPrivacyClosureReason(
  outbox: DocumentSnapshot,
  nowMillis: number
): PaygOutboxPrivacyClosureReason | null {
  if (hasNonNullDocumentField(outbox, "piiRedactedAt")) {
    return "retention_expired";
  }
  const deadline = timestampMillis(
    outbox.get(PAYG_PII_RETENTION_CUTOFF_FIELD)
  );
  if (deadline === null) return "retention_deadline_missing";
  return deadline <= nowMillis ? "retention_expired" : null;
}

function redactAndTombstonePaygOutbox(
  tx: Transaction,
  outbox: DocumentSnapshot,
  reason: PaygOutboxPrivacyClosureReason,
  auditUpdate: Record<string, unknown> = {}
): void {
  tx.set(outbox.ref, {
    status: "tombstoned",
    deliveryStateBeforeTombstone:
      outbox.get("deliveryStateBeforeTombstone") ?? outbox.get("status") ?? null,
    tombstoneReason: `pii_${reason}`,
    tombstonedAt: serverTimestamp(),
    ...auditUpdate,
    // These fields can contain guest PII. Privacy closure always wins over a
    // stale worker payload, including an expired or malformed legacy lease.
    to: FieldValue.delete(),
    templateData: FieldValue.delete(),
    lastError: FieldValue.delete(),
    [PAYG_PII_REDACTION_RETRY_FIELD]: FieldValue.delete(),
    piiRedactAt: FieldValue.delete(),
    piiRedactedAt: serverTimestamp(),
    piiRedactionReason: reason,
    piiRedactionDeferredAt: FieldValue.delete(),
    piiRedactionDeferredReason: FieldValue.delete(),
    piiRedactionLastFailedAt: FieldValue.delete(),
    leaseToken: FieldValue.delete(),
    leaseExpiresAt: FieldValue.delete(),
    nextAttemptAt: FieldValue.delete(),
    tombstonedLeaseCorrelation: FieldValue.delete(),
    ambiguousLeaseCorrelation: FieldValue.delete(),
    reconcileAfterStateChange: FieldValue.delete(),
    updatedAt: serverTimestamp(),
  }, {merge: true});
}

function paygPrivacyClosedOrderEmailUpdate(kind: unknown) {
  return kind === "payg_guest_confirmation" ? {
    confirmationEmailStatus: "not_required",
  } : kind === "payg_guest_confirmation_correction" ? {
    confirmationCorrectionEmailStatus: "not_required",
  } : {};
}

function paygEmailRetryAt(attemptCount: number, nowMillis: number): number {
  const delay = Math.min(60, 5 * Math.pow(2, Math.max(0, attemptCount - 1)));
  return nowMillis + delay * 60 * 1000;
}

function validPaygOutboxPayload(
  outboxId: string,
  value: unknown
): value is PaygEmailOutboxPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as any;
  const common = payload.schemaVersion === PAYG_SCHEMA_VERSION &&
    typeof payload.orderId === "string" &&
    /^payg_[a-f0-9]{64}$/.test(payload.orderId) &&
    Array.isArray(payload.to) && payload.to.length === 1 &&
    typeof payload.to[0] === "string" &&
    payload.templateData && typeof payload.templateData === "object";
  if (!common) return false;
  if (payload.kind === "payg_guest_confirmation") {
    return payload.orderId === outboxId &&
      payload.idempotencyKey === `payg-confirmation/${payload.orderId}/v1` &&
    payload.templateData.amountPence === PAYG_AMOUNT_PENCE &&
    payload.templateData.currency === PAYG_CURRENCY &&
    validPaygConfirmationLegalAcceptance(
      payload.templateData.legalAcceptance
    ) &&
    typeof payload.templateData.cancellationUrl === "string" &&
    payload.templateData.cancellationUrl.includes("/pay-as-you-go/cancel?token=");
  }
  return payload.kind === "payg_guest_confirmation_correction" &&
    payload.outboxId === outboxId &&
    outboxId === paygConfirmationCorrectionOutboxId(payload.orderId) &&
    payload.idempotencyKey ===
      `payg-confirmation-correction/${payload.orderId}/v1` &&
    shouldEnqueuePaygConfirmationCorrection(payload.templateData.orderStatus) &&
    payload.templateData.amountPence === PAYG_AMOUNT_PENCE &&
    payload.templateData.currency === PAYG_CURRENCY &&
    typeof payload.templateData.attendeeName === "string" &&
    payload.templateData.class &&
    typeof payload.templateData.class.title === "string";
}

async function acquirePaygEmailLease(
  outboxId: string,
  nowMillis: number,
  leaseToken = randomUUID()
): Promise<PaygEmailLease> {
  const outboxRef = db().collection("paygEmailOutbox").doc(outboxId);
  return db().runTransaction(async (tx) => {
    const outbox = await tx.get(outboxRef);
    if (!outbox.exists) return {state: "missing" as const};
    const effectiveNow = Math.max(nowMillis, Date.now());
    const privacyClosure = paygOutboxPrivacyClosureReason(
      outbox,
      effectiveNow
    );
    if (privacyClosure !== null) {
      const orderId = outbox.get("orderId");
      const orderRef = typeof orderId === "string" &&
        /^payg_[a-f0-9]{64}$/.test(orderId) ?
        db().collection("paygOrders").doc(orderId) : null;
      const order = orderRef ? await tx.get(orderRef) : null;
      redactAndTombstonePaygOutbox(tx, outbox, privacyClosure);
      if (orderRef && order?.exists &&
        order.get("purchaseKind") === PAYG_PURCHASE_KIND &&
        order.get("orderId") === orderId) {
        tx.set(orderRef, {
          ...paygPrivacyClosedOrderEmailUpdate(outbox.get("kind")),
          updatedAt: serverTimestamp(),
        }, {merge: true});
      }
      return {state: "terminal" as const};
    }
    const rawPayload: unknown = {
      schemaVersion: outbox.get("schemaVersion"),
      kind: outbox.get("kind"),
      orderId: outbox.get("orderId"),
      outboxId: outbox.get("outboxId"),
      idempotencyKey: outbox.get("idempotencyKey"),
      to: outbox.get("to"),
      templateData: outbox.get("templateData"),
    };
    if (!validPaygOutboxPayload(outboxId, rawPayload)) {
      const reason = "PAYG email outbox payload is missing or invalid.";
      tx.set(outboxRef, {
        status: "dead_letter",
        deadLetterReason: reason,
        deadLetteredAt: serverTimestamp(),
        nextAttemptAt: FieldValue.delete(),
        updatedAt: serverTimestamp(),
      }, {merge: true});
      return {state: "terminal" as const};
    }
    const payload: PaygEmailOutboxPayload = rawPayload;
    const orderRef = db().collection("paygOrders").doc(payload.orderId);
    const order = await tx.get(orderRef);
    if (!order.exists || order.get("purchaseKind") !== PAYG_PURCHASE_KIND ||
      order.get("orderId") !== payload.orderId) {
      tx.set(outboxRef, {
        status: "manual_review",
        deadLetterReason: "PAYG email outbox has no matching order.",
        deadLetteredAt: serverTimestamp(),
        nextAttemptAt: FieldValue.delete(),
        updatedAt: serverTimestamp(),
      }, {merge: true});
      return {state: "terminal" as const};
    }
    const orderPiiDeadline = timestampMillis(
      order.get(PAYG_PII_RETENTION_CUTOFF_FIELD)
    );
    if (hasNonNullDocumentField(order, "piiRedactedAt") ||
      orderPiiDeadline === null || orderPiiDeadline <= effectiveNow) {
      const privacyClosure = orderPiiDeadline !== null ||
        hasNonNullDocumentField(order, "piiRedactedAt") ?
        "retention_expired" : "retention_deadline_missing";
      redactAndTombstonePaygOutbox(tx, outbox, privacyClosure);
      tx.set(orderRef, {
        ...paygPrivacyClosedOrderEmailUpdate(payload.kind),
        updatedAt: serverTimestamp(),
      }, {merge: true});
      return {state: "terminal" as const};
    }
    const orderStatus = order.get("status") as PaygOrderStatus;
    const status = outbox.get("status");
    const reconcileAfterStateChange =
      shouldRecoverPaygConfirmationAcceptance({
        kind: payload.kind,
        status,
        providerAcceptanceState: outbox.get("providerAcceptanceState"),
        tombstonedLeaseCorrelation: outbox.get("tombstonedLeaseCorrelation"),
      });
    const deliverable = payload.kind === "payg_guest_confirmation" ?
      shouldSendPaygConfirmation(orderStatus) :
      shouldEnqueuePaygConfirmationCorrection(orderStatus);
    if (!deliverable && !reconcileAfterStateChange) {
      tombstonePaygConfirmation(tx, outbox, `order_${String(orderStatus)}`);
      tx.set(orderRef, {
        ...(payload.kind === "payg_guest_confirmation" ? {
          confirmationEmailStatus: "not_required",
        } : {
          confirmationCorrectionEmailStatus: "not_required",
        }),
        updatedAt: serverTimestamp(),
      }, {merge: true});
      return {state: "terminal" as const};
    }
    if (status === "sent") {
      const orderEmailField = payload.kind === "payg_guest_confirmation" ?
        "confirmationEmailStatus" : "confirmationCorrectionEmailStatus";
      if (order.get(orderEmailField) !== "sent") {
        tx.set(orderRef, {
          [orderEmailField]: "sent",
          updatedAt: serverTimestamp(),
        }, {merge: true});
      }
      return {state: "sent" as const};
    }
    if (status === "manual_review" || status === "dead_letter" ||
      (status === "tombstoned" && !reconcileAfterStateChange)) {
      return {state: "terminal" as const};
    }
    const leaseExpiresAt = timestampMillis(outbox.get("leaseExpiresAt"));
    if ((status === "sending" || status === "reconciling") &&
      leaseExpiresAt !== null &&
      leaseExpiresAt > nowMillis) return {state: "in_progress" as const};
    const nextAttemptAt = timestampMillis(outbox.get("nextAttemptAt"));
    if ((status === "pending" || reconcileAfterStateChange) &&
      nextAttemptAt !== null && nextAttemptAt > nowMillis) {
      return {state: "deferred" as const};
    }
    const retryDeadlineAt = timestampMillis(outbox.get("retryDeadlineAt"));
    if (retryDeadlineAt !== null && nowMillis >= retryDeadlineAt) {
      const reason = "Resend idempotency window expired before PAYG email delivery.";
      tx.set(outboxRef, {
        status: "manual_review",
        deadLetterReason: reason,
        deadLetteredAt: serverTimestamp(),
        leaseToken: FieldValue.delete(),
        leaseExpiresAt: FieldValue.delete(),
        nextAttemptAt: FieldValue.delete(),
        updatedAt: serverTimestamp(),
      }, {merge: true});
      tx.set(orderRef, {
        ...(reconcileAfterStateChange ? {
          confirmationEmailStatus: "not_required",
          confirmationCorrectionEmailStatus: "manual_review",
          confirmationAcceptanceState: "manual_review",
        } : payload.kind === "payg_guest_confirmation" ? {
          confirmationEmailStatus: "manual_review",
          confirmationEmailError: reason,
        } : {
          confirmationCorrectionEmailStatus: "manual_review",
          confirmationCorrectionEmailError: reason,
        }),
        updatedAt: serverTimestamp(),
      }, {merge: true});
      console.error("CRITICAL_BILLING_PAYG_CONFIRMATION_MANUAL_REVIEW", {
        orderId: payload.orderId,
        reason,
      });
      return {state: "terminal" as const};
    }
    const attemptCount = typeof outbox.get("attemptCount") === "number" ?
      Number(outbox.get("attemptCount")) : 0;
    const firstAttemptAt = timestampMillis(outbox.get("firstAttemptAt"));
    tx.set(outboxRef, {
      status: reconcileAfterStateChange ? "reconciling" : "sending",
      leaseToken,
      leaseExpiresAt: Timestamp.fromMillis(effectiveNow + PAYG_EMAIL_LEASE_MS),
      nextAttemptAt: Timestamp.fromMillis(effectiveNow + PAYG_EMAIL_LEASE_MS),
      ...(reconcileAfterStateChange ? {
        providerAcceptanceState: "unknown_in_flight",
        reconcileAfterStateChange: true,
        tombstonedLeaseCorrelation: paygEmailLeaseCorrelation(leaseToken),
      } : {}),
      attemptCount: attemptCount + 1,
      lastAttemptAt: serverTimestamp(),
      ...(firstAttemptAt === null ? {
        firstAttemptAt: Timestamp.fromMillis(effectiveNow),
        retryDeadlineAt: Timestamp.fromMillis(
          effectiveNow + PAYG_EMAIL_RETRY_WINDOW_MS
        ),
      } : {}),
      updatedAt: serverTimestamp(),
    }, {merge: true});
    return {
      state: "acquired" as const,
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
  constructor(
    message: string,
    readonly status: number | null,
    readonly providerErrorName: string | null
  ) {
    super(message);
  }
}

async function sendPaygEmailViaResend(
  email: PaygConfirmationEmail,
  idempotencyKey: string
): Promise<string | null> {
  const apiKey = resendApiKey.value().trim();
  if (!apiKey) {
    throw new PaygEmailDeliveryError(
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
      "User-Agent": "AlphaWOD-payg/1.0",
    },
    body: JSON.stringify(email),
    signal: AbortSignal.timeout(20000),
  });
  const body = await response.text();
  if (!response.ok) {
    let name: string | null = null;
    let message = body;
    try {
      const parsed = JSON.parse(body) as {name?: unknown; message?: unknown};
      name = typeof parsed.name === "string" ? parsed.name : null;
      message = typeof parsed.message === "string" ? parsed.message : body;
    } catch {
      // Keep the non-JSON provider response as bounded diagnostic context.
    }
    throw new PaygEmailDeliveryError(
      (message || response.statusText || `Resend returned ${response.status}.`).slice(0, 1000),
      response.status,
      name
    );
  }
  try {
    const parsed = JSON.parse(body) as {id?: unknown};
    return typeof parsed.id === "string" ? parsed.id : null;
  } catch {
    return null;
  }
}

async function processPaygConfirmationOutbox(
  outboxId: string,
  nowMillis: number,
  sender: typeof sendPaygEmailViaResend = sendPaygEmailViaResend
): Promise<"sent" | "failed" | "systemic_failure" | PaygEmailLease["state"]> {
  const lease = await acquirePaygEmailLease(outboxId, nowMillis);
  if (lease.state !== "acquired") return lease.state;
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
      outbox.get("leaseToken") !== lease.leaseToken) return "lost" as const;
    const matchingOrder = order.exists &&
      order.get("purchaseKind") === PAYG_PURCHASE_KIND &&
      order.get("orderId") === lease.orderId;
    const privacyClosure = paygOutboxPrivacyClosureReason(
      outbox,
      Math.max(nowMillis, Date.now())
    );
    if (privacyClosure !== null) {
      redactAndTombstonePaygOutbox(tx, outbox, privacyClosure);
      if (matchingOrder) {
        tx.set(orderRef, {
          ...paygPrivacyClosedOrderEmailUpdate(lease.payload.kind),
          updatedAt: serverTimestamp(),
        }, {merge: true});
      }
      return "terminal" as const;
    }
    const preflightNow = Math.max(nowMillis, Date.now());
    const orderPiiDeadline = matchingOrder ? timestampMillis(
      order.get(PAYG_PII_RETENTION_CUTOFF_FIELD)
    ) : null;
    const orderPrivacyClosed = matchingOrder &&
      (hasNonNullDocumentField(order, "piiRedactedAt") ||
        orderPiiDeadline === null || orderPiiDeadline <= preflightNow);
    if (orderPrivacyClosed) {
      const orderPrivacyClosure = orderPiiDeadline !== null ||
        hasNonNullDocumentField(order, "piiRedactedAt") ?
        "retention_expired" : "retention_deadline_missing";
      redactAndTombstonePaygOutbox(tx, outbox, orderPrivacyClosure);
      tx.set(orderRef, {
        ...paygPrivacyClosedOrderEmailUpdate(lease.payload.kind),
        updatedAt: serverTimestamp(),
      }, {merge: true});
      return "terminal" as const;
    }
    const currentlyDeliverable = matchingOrder && isPaygEmailPayloadDeliverable(
      lease.payload,
      order.get("status") as PaygOrderStatus
    );
    if (!matchingOrder || (!lease.reconcileAfterStateChange &&
      !currentlyDeliverable)) {
      tombstonePaygConfirmation(
        tx,
        outbox,
        `order_${String(order.exists ? order.get("status") : "missing")}`
      );
      if (matchingOrder) {
        tx.set(orderRef, {
          ...(lease.payload.kind === "payg_guest_confirmation" ? {
            confirmationEmailStatus: "not_required",
          } : {
            confirmationCorrectionEmailStatus: "not_required",
          }),
          updatedAt: serverTimestamp(),
        }, {merge: true});
      }
      return "terminal" as const;
    }
    return "send" as const;
  });
  if (preflight !== "send") {
    return preflight === "terminal" ? "terminal" : "in_progress";
  }
  let providerAccepted = false;
  try {
    const email = buildPaygOutboxEmail(
      lease.payload,
      paygFromEmail.value(),
      paygReplyToEmail.value()
    );
    const providerMessageId = await sender(email, lease.idempotencyKey);
    providerAccepted = true;
    const persistProviderAcceptance = () => db().runTransaction(async (tx) => {
      const correctionRef = lease.payload.kind === "payg_guest_confirmation" ?
        db().collection("paygEmailOutbox").doc(
          paygConfirmationCorrectionOutboxId(lease.orderId)
        ) : null;
      const [outbox, order, correction] = await Promise.all([
        tx.get(outboxRef),
        tx.get(orderRef),
        correctionRef ? tx.get(correctionRef) : Promise.resolve(null),
      ]);
      if (!outbox.exists) return "lost" as const;
      const orderStatus = order.exists ?
        order.get("status") as PaygOrderStatus : null;
      const decision = lease.payload.kind === "payg_guest_confirmation" ?
        resolvePaygConfirmationPostSend({
          outboxStatus: outbox.get("status"),
          activeLeaseToken: outbox.get("leaseToken"),
          tombstonedLeaseCorrelation: outbox.get("tombstonedLeaseCorrelation"),
          leaseToken: lease.leaseToken,
          orderStatus,
          correctionExists: Boolean(correction?.exists),
        }) : outbox.get("status") === "sending" &&
          outbox.get("leaseToken") === lease.leaseToken ? Object.freeze({
            disposition: orderStatus !== null &&
              isPaygEmailPayloadDeliverable(lease.payload, orderStatus) ?
              "sent" as const : "accepted_after_state_change" as const,
            enqueueCorrection: false,
          }) : Object.freeze({
            disposition: "lost" as const,
            enqueueCorrection: false,
          });
      if (decision.disposition === "lost") return "lost" as const;
      const acceptanceNow = Date.now();
      const outboxPrivacyClosure = paygOutboxPrivacyClosureReason(
        outbox,
        acceptanceNow
      );
      const orderPiiDeadline = order.exists ? timestampMillis(
        order.get(PAYG_PII_RETENTION_CUTOFF_FIELD)
      ) : null;
      const orderPrivacyClosed = !order.exists || orderPiiDeadline === null ||
        hasNonNullDocumentField(order, "piiRedactedAt") ||
        orderPiiDeadline <= acceptanceNow;
      if (outboxPrivacyClosure !== null || orderPrivacyClosed) {
        const privacyClosure = outboxPrivacyClosure ??
          (order.exists && (hasNonNullDocumentField(order, "piiRedactedAt") ||
            (orderPiiDeadline !== null && orderPiiDeadline <= acceptanceNow)) ?
            "retention_expired" : "retention_deadline_missing");
        const acceptedAfterStateChange =
          decision.disposition === "accepted_after_state_change";
        redactAndTombstonePaygOutbox(tx, outbox, privacyClosure, {
          deliveryStateBeforeTombstone: "sent",
          deliveredAfterStateChange: acceptedAfterStateChange ||
            FieldValue.delete(),
          providerAcceptanceState: acceptedAfterStateChange ?
            "accepted_after_state_change" : "accepted",
          providerMessageId,
          providerAcceptedAt: serverTimestamp(),
          acceptedLeaseCorrelation: paygEmailLeaseCorrelation(
            lease.leaseToken
          ),
          ...(acceptedAfterStateChange ? {} : {
            sentAt: serverTimestamp(),
          }),
        });
        if (correctionRef && correction?.exists) {
          redactAndTombstonePaygOutbox(
            tx,
            correction,
            privacyClosure
          );
        }
        if (order.exists) {
          tx.set(orderRef, {
            ...(lease.payload.kind === "payg_guest_confirmation" ?
              acceptedAfterStateChange ? {
                confirmationEmailStatus: "not_required",
                confirmationAcceptedAfterStateChange: true,
                confirmationCorrectionEmailStatus: "not_required",
              } : {
                confirmationEmailStatus: "sent",
                confirmationEmailSentAt: serverTimestamp(),
                confirmationEmailProviderId: providerMessageId,
                confirmationEmailError: FieldValue.delete(),
                confirmationCorrectionEmailStatus: "not_required",
              } : acceptedAfterStateChange ? {
                confirmationCorrectionEmailStatus: "not_required",
                confirmationCorrectionAcceptedAfterStateChange: true,
              } : {
                confirmationCorrectionEmailStatus: "sent",
                confirmationCorrectionEmailSentAt: serverTimestamp(),
                confirmationCorrectionEmailProviderId: providerMessageId,
                confirmationCorrectionEmailError: FieldValue.delete(),
              }),
            updatedAt: serverTimestamp(),
          }, {merge: true});
        }
        return acceptedAfterStateChange ?
          "state_changed" as const : "sent" as const;
      }
      if (decision.disposition === "accepted_after_state_change") {
        let correctionOutboxId: string | null = correction?.exists ? correction.id : null;
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
          tx.create(correctionRef, {
            ...correctionPayload,
            status: "pending",
            attemptCount: 0,
            nextAttemptAt: serverTimestamp(),
            piiRetentionCutoffAt: Timestamp.fromMillis(orderPiiDeadline),
            piiRedactionRetryAt: Timestamp.fromMillis(orderPiiDeadline),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          correctionOutboxId = correctionRef.id;
        }
        tx.set(outboxRef, {
          status: "tombstoned",
          deliveredAfterStateChange: true,
          providerAcceptanceState: "accepted_after_state_change",
          providerMessageId,
          providerAcceptedAt: serverTimestamp(),
          acceptedLeaseCorrelation: paygEmailLeaseCorrelation(lease.leaseToken),
          tombstonedLeaseCorrelation: FieldValue.delete(),
          ambiguousLeaseCorrelation: FieldValue.delete(),
          reconcileAfterStateChange: FieldValue.delete(),
          leaseToken: FieldValue.delete(),
          leaseExpiresAt: FieldValue.delete(),
          nextAttemptAt: FieldValue.delete(),
          ...(correctionOutboxId ? {correctionOutboxId} : {}),
          updatedAt: serverTimestamp(),
        }, {merge: true});
        if (order.exists) {
          tx.set(orderRef, {
            ...(lease.payload.kind === "payg_guest_confirmation" ? {
              confirmationEmailStatus: "not_required",
              confirmationAcceptedAfterStateChange: true,
              confirmationCorrectionEmailStatus: correction?.exists ?
                correction.get("status") : correctionOutboxId ? "pending" :
                  "not_required",
              ...(correctionOutboxId ? {confirmationCorrectionOutboxId: correctionOutboxId} : {}),
            } : {
              confirmationCorrectionEmailStatus: "not_required",
              confirmationCorrectionAcceptedAfterStateChange: true,
            }),
            updatedAt: serverTimestamp(),
          }, {merge: true});
        }
        return "state_changed" as const;
      }
      tx.set(outboxRef, {
        status: "sent",
        providerAcceptanceState: "accepted",
        sentAt: serverTimestamp(),
        providerMessageId,
        leaseToken: FieldValue.delete(),
        leaseExpiresAt: FieldValue.delete(),
        nextAttemptAt: FieldValue.delete(),
        tombstonedLeaseCorrelation: FieldValue.delete(),
        ambiguousLeaseCorrelation: FieldValue.delete(),
        reconcileAfterStateChange: FieldValue.delete(),
        lastError: FieldValue.delete(),
        updatedAt: serverTimestamp(),
      }, {merge: true});
      tx.set(orderRef, {
        ...(lease.payload.kind === "payg_guest_confirmation" ? {
          confirmationEmailStatus: "sent",
          confirmationEmailSentAt: serverTimestamp(),
          confirmationEmailProviderId: providerMessageId,
          confirmationEmailError: FieldValue.delete(),
        } : {
          confirmationCorrectionEmailStatus: "sent",
          confirmationCorrectionEmailSentAt: serverTimestamp(),
          confirmationCorrectionEmailProviderId: providerMessageId,
          confirmationCorrectionEmailError: FieldValue.delete(),
        }),
        updatedAt: serverTimestamp(),
      }, {merge: true});
      return "sent" as const;
    });
    let marked: "lost" | "state_changed" | "sent";
    try {
      marked = await persistProviderAcceptance();
    } catch (error) {
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
  } catch (error) {
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
      if (!outbox.exists) return null;
      const ownsActiveLease = (outbox.get("status") === "sending" ||
        outbox.get("status") === "reconciling") &&
        outbox.get("leaseToken") === lease.leaseToken;
      const ownsTombstonedLease = lease.payload.kind ===
        "payg_guest_confirmation" && outbox.get("status") === "tombstoned" &&
        outbox.get("tombstonedLeaseCorrelation") ===
          paygEmailLeaseCorrelation(lease.leaseToken);
      if (!ownsActiveLease && !ownsTombstonedLease) return null;
      const outboxPrivacyClosure = paygOutboxPrivacyClosureReason(
        outbox,
        transactionFailureNow
      );
      const orderPiiDeadline = order.exists ? timestampMillis(
        order.get(PAYG_PII_RETENTION_CUTOFF_FIELD)
      ) : null;
      const orderPrivacyClosed = !order.exists || orderPiiDeadline === null ||
        hasNonNullDocumentField(order, "piiRedactedAt") ||
        orderPiiDeadline <= transactionFailureNow;
      if (outboxPrivacyClosure !== null || orderPrivacyClosed) {
        const privacyClosure = outboxPrivacyClosure ??
          (order.exists && (hasNonNullDocumentField(order, "piiRedactedAt") ||
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
          tx.set(orderRef, {
            ...paygPrivacyClosedOrderEmailUpdate(lease.payload.kind),
            updatedAt: serverTimestamp(),
          }, {merge: true});
        }
        return {terminal: true, privacyExpired: true};
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
        tx.set(outboxRef, {
          status: terminal ? "manual_review" : "tombstoned",
          providerAcceptanceState: terminal ?
            "manual_review" : "unknown_in_flight",
          reconcileAfterStateChange: terminal ?
            FieldValue.delete() : true,
          tombstonedLeaseCorrelation: terminal ? FieldValue.delete() :
            paygEmailLeaseCorrelation(lease.leaseToken),
          ambiguousLeaseCorrelation: FieldValue.delete(),
          lastError: message,
          lastHttpStatus: status,
          lastProviderErrorName: providerName,
          failedAt: serverTimestamp(),
          leaseToken: FieldValue.delete(),
          leaseExpiresAt: FieldValue.delete(),
          ...(terminal ? {
            deadLetteredAt: serverTimestamp(),
            nextAttemptAt: FieldValue.delete(),
          } : {
            nextAttemptAt: Timestamp.fromMillis(
              paygEmailRetryAt(lease.attemptCount, transactionFailureNow)
            ),
          }),
          updatedAt: serverTimestamp(),
        }, {merge: true});
        if (order.exists) {
          tx.set(orderRef, {
            confirmationEmailStatus: "not_required",
            confirmationCorrectionEmailStatus: terminal ?
              "manual_review" : "pending",
            confirmationAcceptanceState: terminal ?
              "manual_review" : "unknown_in_flight",
            updatedAt: serverTimestamp(),
          }, {merge: true});
        }
        return {terminal};
      }
      if (!order.exists || !isPaygEmailPayloadDeliverable(
        lease.payload,
        order.get("status") as PaygOrderStatus
      )) {
        tombstonePaygConfirmation(
          tx,
          outbox,
          `order_${String(order.exists ? order.get("status") : "missing")}`
        );
        tx.set(outboxRef, {
          providerRejectedAfterStateChange: true,
          providerAcceptanceState: "rejected_after_state_change",
          tombstonedLeaseCorrelation: FieldValue.delete(),
          ambiguousLeaseCorrelation: FieldValue.delete(),
          leaseToken: FieldValue.delete(),
          leaseExpiresAt: FieldValue.delete(),
          nextAttemptAt: FieldValue.delete(),
          lastError: message,
          updatedAt: serverTimestamp(),
        }, {merge: true});
        if (order.exists) {
          tx.set(orderRef, {
            ...(lease.payload.kind === "payg_guest_confirmation" ? {
              confirmationEmailStatus: "not_required",
            } : {
              confirmationCorrectionEmailStatus: "not_required",
            }),
            updatedAt: serverTimestamp(),
          }, {merge: true});
        }
        return {terminal: true};
      }
      const retryDeadline = timestampMillis(outbox.get("retryDeadlineAt"));
      const terminal = permanent ||
        (retryDeadline !== null && transactionFailureNow >= retryDeadline);
      tx.set(outboxRef, {
        status: terminal ? "manual_review" : "pending",
        providerAcceptanceState: terminal ? "manual_review" : ambiguous ?
          "unknown_in_flight" : "rejected",
        ambiguousLeaseCorrelation: ambiguous && !terminal ?
          paygEmailLeaseCorrelation(lease.leaseToken) : FieldValue.delete(),
        lastError: message,
        lastHttpStatus: status,
        lastProviderErrorName: providerName,
        failedAt: serverTimestamp(),
        leaseToken: FieldValue.delete(),
        leaseExpiresAt: FieldValue.delete(),
        ...(terminal ? {
          deadLetteredAt: serverTimestamp(),
          nextAttemptAt: FieldValue.delete(),
        } : {
          nextAttemptAt: Timestamp.fromMillis(
            paygEmailRetryAt(lease.attemptCount, transactionFailureNow)
          ),
        }),
        updatedAt: serverTimestamp(),
      }, {merge: true});
      if (order.exists) {
        tx.set(orderRef, {
          ...(lease.payload.kind === "payg_guest_confirmation" ? {
            confirmationEmailStatus: terminal ? "manual_review" : "pending",
            confirmationEmailError: message.slice(0, 500),
          } : {
            confirmationCorrectionEmailStatus: terminal ? "manual_review" : "pending",
            confirmationCorrectionEmailError: message.slice(0, 500),
          }),
          updatedAt: serverTimestamp(),
        }, {merge: true});
      }
      return {terminal};
    });
    if (outcome?.privacyExpired) return "terminal";
    if (outcome?.terminal) {
      console.error("CRITICAL_BILLING_PAYG_CONFIRMATION_MANUAL_REVIEW", {
        orderId: lease.orderId,
        providerName,
        status,
        error: message,
      });
    } else {
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

async function retryDuePaygConfirmations(
  nowMillis = Date.now(),
  limit = 50
): Promise<{
  sent: number;
  failed: number;
  skipped: number;
  systemicFailure: boolean;
}> {
  const due = await db().collection("paygEmailOutbox")
    .where("nextAttemptAt", "<=", Timestamp.fromMillis(nowMillis))
    .orderBy("nextAttemptAt", "asc")
    .limit(limit)
    .get();
  const result = {sent: 0, failed: 0, skipped: 0, systemicFailure: false};
  for (const outbox of due.docs) {
    const outcome = await processPaygConfirmationOutbox(
      outbox.id,
      Math.max(nowMillis, Date.now())
    );
    if (outcome === "sent") result.sent += 1;
    else if (outcome === "failed" || outcome === "systemic_failure") {
      result.failed += 1;
    } else result.skipped += 1;
    if (outcome === "systemic_failure") {
      result.systemicFailure = true;
      break;
    }
  }
  return result;
}

export function buildRetryPaygConfirmations() {
  return onSchedule({
    region: REGION,
    schedule: "every 5 minutes",
    timeZone: "UTC",
    secrets: PAYG_EMAIL_WORKER_SECRETS,
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

export function buildRecoverPaygOperations() {
  return onSchedule({
    region: REGION,
    schedule: "every 5 minutes",
    timeZone: "UTC",
    secrets: PAYG_WORKER_SECRETS,
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

export function buildRedactPaygPii() {
  return onSchedule({
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

export const __testing = Object.freeze({
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
