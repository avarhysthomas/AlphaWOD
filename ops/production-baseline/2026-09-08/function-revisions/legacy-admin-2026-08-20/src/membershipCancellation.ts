/* eslint-disable require-jsdoc, valid-jsdoc, max-len, no-control-regex */

/**
 * Immutable evidence and durable acknowledgement helpers for a cooling-off
 * cancellation. This module deliberately has no Firestore, Stripe, or email
 * provider dependency: the transaction that stores the receipt and the worker
 * that sends the acknowledgement can both reuse the same frozen projection.
 *
 * A receipt records when the cancellation notice reached the business. Stripe
 * may report a later `providerEndedAtMillis`; that provider timestamp must
 * never replace the legally significant receipt/effective time.
 */

export const MEMBERSHIP_CANCELLATION_SCHEMA_VERSION = 1;
export const CANCELLATION_ACKNOWLEDGEMENT_VERSION = 1;
export const MEMBERSHIP_CANCELLATION_RECEIPT_COLLECTION =
  "membershipCancellationReceipts";
export const MEMBERSHIP_CANCELLATION_OUTBOX_COLLECTION =
  "membershipEmailOutbox";

export const CANONICAL_CANCELLATION_STATEMENT =
  "I am giving notice that I cancel this membership contract.";
export const CANONICAL_CANCELLATION_STATEMENT_VERSION =
  "membership-cancellation-statement/v1";

const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{8,255}$/;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export type CancellationKind =
  | "presale_withdrawal"
  | "cooling_off"
  | "contractual";

export type CancellationReceiptStatus = "received";

export type CancellationProviderStatus =
  | "pending"
  | "applied"
  | "manual_review";

/** Customer-safe request statuses used by the membership management UI. */
export type CancellationRequestStatus =
  | "accepted"
  | CancellationProviderStatus
  | "refund_review";

export type CancellationReceiptChannel =
  | "membership_portal"
  | "support_email"
  | "staff_recorded";

export type CancellationIdentitySnapshot = Readonly<{
  uid: string | null;
  fullName: string | null;
  email: string | null;
}>;

export type CancellationSourceEvidence = Readonly<{
  /** Hash only: never persist a provider message id in the receipt. */
  externalMessageIdSha256: string | null;
  /** SHA-256 of the original request bytes or canonical portal request. */
  contentSha256: string | null;
}>;

export type CancellationMembershipSnapshot = Readonly<{
  planKey: string;
  planName: string;
  participantFullName: string;
  contractMadeAtMillis: number;
  coolingOffEndsAtMillis: number;
  serviceStartsAtMillis: number;
  firstPaymentReceivedAtMillis: number | null;
  immediatePerformanceRequested: boolean;
}>;

export type ImmediateCoolingOffOutcome = Readonly<{
  kind: "cooling_off";
  legalReceiptAtMillis: number;
  cancellationEffectiveAtMillis: number;
  accessEndsAtMillis: number;
  collectFuturePayments: false;
  futurePaymentDuePence: 0;
  providerCancellationMode: "immediate";
  /** Remains null in immutable evidence; provider state is projected later. */
  providerEndedAtMillis: null;
  refundReviewRequired: boolean;
  /** Refund values are a staffed decision and are never calculated here. */
  refundAmountPence: null;
  refundReviewStatus: "not_required" | "manual_review";
}>;

export type MembershipCancellationReceipt = Readonly<{
  schemaVersion: typeof MEMBERSHIP_CANCELLATION_SCHEMA_VERSION;
  receiptId: string;
  requestId: string;
  subscriptionId: string;
  kind: "cooling_off";
  status: CancellationReceiptStatus;
  channel: CancellationReceiptChannel;
  statement: typeof CANONICAL_CANCELLATION_STATEMENT;
  statementVersion: typeof CANONICAL_CANCELLATION_STATEMENT_VERSION;
  receivedAtMillis: number;
  recordedAtMillis: number;
  actorUid: string | null;
  staffActorUid: string | null;
  payer: CancellationIdentitySnapshot;
  sender: CancellationIdentitySnapshot;
  sourceEvidence: CancellationSourceEvidence;
  membership: CancellationMembershipSnapshot;
  outcome: ImmediateCoolingOffOutcome;
}>;

export type MembershipCancellationProjection = Readonly<{
  receiptId: string;
  requestId: string;
  kind: "cooling_off";
  status: CancellationRequestStatus;
  providerStatus: CancellationProviderStatus;
  receivedAtMillis: number;
  cancellationEffectiveAtMillis: number;
  accessEndsAtMillis: number;
  collectFuturePayments: false;
  futurePaymentDuePence: 0;
  providerEndedAtMillis: number | null;
  refundReviewRequired: boolean;
  refundAmountPence: null;
  acknowledgementOutboxId: string;
  acknowledgementIdempotencyKey: string;
}>;

export type BuildCoolingOffCancellationReceiptInput = Readonly<{
  requestId: string;
  subscriptionId: string;
  channel: CancellationReceiptChannel;
  receivedAtMillis: number;
  recordedAtMillis: number;
  actorUid: string | null;
  staffActorUid: string | null;
  payer: CancellationIdentitySnapshot;
  sender: CancellationIdentitySnapshot;
  sourceEvidence: CancellationSourceEvidence;
  membership: CancellationMembershipSnapshot;
}>;

export type CancellationAcknowledgementCompany = Readonly<{
  legalName: string;
  tradingName: string;
  supportEmail: string;
  fromEmail: string;
  postalAddress: string;
}>;

export type CancellationAcknowledgementMembership = Readonly<{
  subscriptionId: string;
  planName: string;
  participantFullName: string;
}>;

export type CancellationAcknowledgementRecipient = Readonly<{
  fullName: string | null;
  email: string;
}>;

export type CancellationAcknowledgementInput = Readonly<{
  receipt: MembershipCancellationReceipt;
  company: CancellationAcknowledgementCompany;
  membership: CancellationAcknowledgementMembership;
  recipient: CancellationAcknowledgementRecipient;
}>;

export type CancellationAcknowledgementEmailPayload = Readonly<{
  from: string;
  to: string[];
  /** Resend raw HTTP API field (the SDK alias would be `replyTo`). */
  reply_to: string;
  subject: string;
  html: string;
}>;

export class MembershipCancellationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MembershipCancellationValidationError";
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MembershipCancellationValidationError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireSafeIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !SAFE_IDENTIFIER_PATTERN.test(value)) {
    throw new MembershipCancellationValidationError(
      `${label} must be a safe identifier between 8 and 255 characters.`
    );
  }
  return value;
}

function requireUid(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 128 ||
    value.includes("/") || CONTROL_CHARACTER_PATTERN.test(value)) {
    throw new MembershipCancellationValidationError(
      `${label} must be a non-empty Firebase UID of at most 128 characters.`
    );
  }
  return value;
}

function requireOptionalUid(value: unknown, label: string): string | null {
  if (value === null) return null;
  return requireUid(value, label);
}

function requirePlainText(
  value: unknown,
  label: string,
  maxLength = 255
): string {
  if (typeof value !== "string") {
    throw new MembershipCancellationValidationError(`${label} must be text.`);
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength ||
    CONTROL_CHARACTER_PATTERN.test(trimmed)) {
    throw new MembershipCancellationValidationError(
      `${label} must be non-empty text without control characters.`
    );
  }
  return trimmed;
}

function requireOptionalPlainText(
  value: unknown,
  label: string,
  maxLength = 255
): string | null {
  if (value === null) return null;
  return requirePlainText(value, label, maxLength);
}

export function canonicalizeCancellationEmail(
  value: unknown,
  label = "email"
): string {
  const email = requirePlainText(value, label, 320).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw new MembershipCancellationValidationError(
      `${label} must be a valid email address.`
    );
  }
  return email;
}

function requireOptionalEmail(value: unknown, label: string): string | null {
  if (value === null) return null;
  return canonicalizeCancellationEmail(value, label);
}

function requireMillis(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 ||
    !Number.isFinite(new Date(value).getTime())) {
    throw new MembershipCancellationValidationError(
      `${label} must be a positive millisecond timestamp.`
    );
  }
  return value;
}

function requireOptionalMillis(value: unknown, label: string): number | null {
  if (value === null) return null;
  return requireMillis(value, label);
}

function requireOptionalSha256(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !SHA256_HEX_PATTERN.test(value)) {
    throw new MembershipCancellationValidationError(
      `${label} must be a lowercase SHA-256 hex digest.`
    );
  }
  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new MembershipCancellationValidationError(`${label} must be boolean.`);
  }
  return value;
}

function freezeIdentity(
  value: CancellationIdentitySnapshot,
  label: string
): CancellationIdentitySnapshot {
  return Object.freeze({
    uid: requireOptionalUid(value.uid, `${label}.uid`),
    fullName: requireOptionalPlainText(value.fullName, `${label}.fullName`),
    email: requireOptionalEmail(value.email, `${label}.email`),
  });
}

function freezeSourceEvidence(
  value: CancellationSourceEvidence
): CancellationSourceEvidence {
  return Object.freeze({
    externalMessageIdSha256: requireOptionalSha256(
      value.externalMessageIdSha256,
      "sourceEvidence.externalMessageIdSha256"
    ),
    contentSha256: requireOptionalSha256(
      value.contentSha256,
      "sourceEvidence.contentSha256"
    ),
  });
}

function freezeMembershipSnapshot(
  value: CancellationMembershipSnapshot
): CancellationMembershipSnapshot {
  const snapshot = Object.freeze({
    planKey: requirePlainText(value.planKey, "membership.planKey", 100),
    planName: requirePlainText(value.planName, "membership.planName"),
    participantFullName: requirePlainText(
      value.participantFullName,
      "membership.participantFullName"
    ),
    contractMadeAtMillis: requireMillis(
      value.contractMadeAtMillis,
      "membership.contractMadeAtMillis"
    ),
    coolingOffEndsAtMillis: requireMillis(
      value.coolingOffEndsAtMillis,
      "membership.coolingOffEndsAtMillis"
    ),
    serviceStartsAtMillis: requireMillis(
      value.serviceStartsAtMillis,
      "membership.serviceStartsAtMillis"
    ),
    firstPaymentReceivedAtMillis: requireOptionalMillis(
      value.firstPaymentReceivedAtMillis,
      "membership.firstPaymentReceivedAtMillis"
    ),
    immediatePerformanceRequested: requireBoolean(
      value.immediatePerformanceRequested,
      "membership.immediatePerformanceRequested"
    ),
  });
  if (snapshot.coolingOffEndsAtMillis < snapshot.contractMadeAtMillis) {
    throw new MembershipCancellationValidationError(
      "membership.coolingOffEndsAtMillis cannot precede the contract time."
    );
  }
  return snapshot;
}

export function isCancellationKind(value: unknown): value is CancellationKind {
  return value === "presale_withdrawal" || value === "cooling_off" ||
    value === "contractual";
}

export function isCancellationRequestStatus(
  value: unknown
): value is CancellationRequestStatus {
  return value === "accepted" || value === "pending" || value === "applied" ||
    value === "refund_review" || value === "manual_review";
}

export function isCancellationProviderStatus(
  value: unknown
): value is CancellationProviderStatus {
  return value === "pending" || value === "applied" ||
    value === "manual_review";
}

export function isCancellationReceiptChannel(
  value: unknown
): value is CancellationReceiptChannel {
  return value === "membership_portal" || value === "support_email" ||
    value === "staff_recorded";
}

export function cancellationReceiptDocumentId(requestId: string): string {
  return requireSafeIdentifier(requestId, "requestId");
}

export function cancellationAcknowledgementOutboxId(
  requestId: string
): string {
  return `cancellation-${requireSafeIdentifier(requestId, "requestId")}`;
}

export function cancellationAcknowledgementIdempotencyKey(
  requestId: string
): string {
  return `membership-cancellation/${requireSafeIdentifier(requestId, "requestId")}/ack/v${CANCELLATION_ACKNOWLEDGEMENT_VERSION}`;
}

export function buildImmediateCoolingOffOutcome(input: Readonly<{
  receivedAtMillis: number;
  serviceStartsAtMillis: number;
  firstPaymentReceivedAtMillis: number | null;
}>): ImmediateCoolingOffOutcome {
  const receivedAtMillis = requireMillis(
    input.receivedAtMillis,
    "receivedAtMillis"
  );
  const serviceStartsAtMillis = requireMillis(
    input.serviceStartsAtMillis,
    "serviceStartsAtMillis"
  );
  const firstPaymentReceivedAtMillis = requireOptionalMillis(
    input.firstPaymentReceivedAtMillis,
    "firstPaymentReceivedAtMillis"
  );
  const refundReviewRequired = firstPaymentReceivedAtMillis !== null ||
    receivedAtMillis >= serviceStartsAtMillis;

  return Object.freeze({
    kind: "cooling_off" as const,
    legalReceiptAtMillis: receivedAtMillis,
    cancellationEffectiveAtMillis: receivedAtMillis,
    accessEndsAtMillis: receivedAtMillis,
    collectFuturePayments: false as const,
    futurePaymentDuePence: 0 as const,
    providerCancellationMode: "immediate" as const,
    providerEndedAtMillis: null,
    refundReviewRequired,
    refundAmountPence: null,
    refundReviewStatus: refundReviewRequired ?
      "manual_review" as const : "not_required" as const,
  });
}

export function buildCoolingOffCancellationReceipt(
  input: BuildCoolingOffCancellationReceiptInput
): MembershipCancellationReceipt {
  const requestId = requireSafeIdentifier(input.requestId, "requestId");
  const subscriptionId = requireSafeIdentifier(
    input.subscriptionId,
    "subscriptionId"
  );
  if (!isCancellationReceiptChannel(input.channel)) {
    throw new MembershipCancellationValidationError(
      "channel is not a supported cancellation receipt channel."
    );
  }
  const receivedAtMillis = requireMillis(
    input.receivedAtMillis,
    "receivedAtMillis"
  );
  const recordedAtMillis = requireMillis(
    input.recordedAtMillis,
    "recordedAtMillis"
  );
  if (recordedAtMillis < receivedAtMillis) {
    throw new MembershipCancellationValidationError(
      "recordedAtMillis cannot precede receivedAtMillis."
    );
  }

  const membership = freezeMembershipSnapshot(input.membership);
  if (receivedAtMillis < membership.contractMadeAtMillis ||
    receivedAtMillis > membership.coolingOffEndsAtMillis) {
    throw new MembershipCancellationValidationError(
      "receivedAtMillis must fall within the stored cooling-off period."
    );
  }
  const actorUid = requireOptionalUid(input.actorUid, "actorUid");
  const staffActorUid = requireOptionalUid(
    input.staffActorUid,
    "staffActorUid"
  );
  const sender = freezeIdentity(input.sender, "sender");
  const sourceEvidence = freezeSourceEvidence(input.sourceEvidence);
  if (input.channel === "membership_portal" && !actorUid) {
    throw new MembershipCancellationValidationError(
      "membership_portal receipts require actorUid."
    );
  }
  if (input.channel === "support_email" &&
    (!sender.email || !sourceEvidence.contentSha256)) {
    throw new MembershipCancellationValidationError(
      "support_email receipts require a sender email and content hash."
    );
  }
  if (input.channel === "staff_recorded" && !staffActorUid) {
    throw new MembershipCancellationValidationError(
      "staff_recorded receipts require staffActorUid."
    );
  }

  const outcome = buildImmediateCoolingOffOutcome({
    receivedAtMillis,
    serviceStartsAtMillis: membership.serviceStartsAtMillis,
    firstPaymentReceivedAtMillis: membership.firstPaymentReceivedAtMillis,
  });
  return Object.freeze({
    schemaVersion: MEMBERSHIP_CANCELLATION_SCHEMA_VERSION,
    receiptId: cancellationReceiptDocumentId(requestId),
    requestId,
    subscriptionId,
    kind: "cooling_off" as const,
    status: "received" as const,
    channel: input.channel,
    statement: CANONICAL_CANCELLATION_STATEMENT,
    statementVersion: CANONICAL_CANCELLATION_STATEMENT_VERSION,
    receivedAtMillis,
    recordedAtMillis,
    actorUid,
    staffActorUid,
    payer: freezeIdentity(input.payer, "payer"),
    sender,
    sourceEvidence,
    membership,
    outcome,
  });
}

export function buildMembershipCancellationProjection(
  receipt: MembershipCancellationReceipt,
  provider: Readonly<{
    status: CancellationProviderStatus;
    endedAtMillis: number | null;
  }> = {status: "pending", endedAtMillis: null}
): MembershipCancellationProjection {
  assertMembershipCancellationReceipt(receipt);
  if (!isCancellationProviderStatus(provider.status)) {
    throw new MembershipCancellationValidationError(
      "provider.status is not a supported cancellation status."
    );
  }
  const providerEndedAtMillis = requireOptionalMillis(
    provider.endedAtMillis,
    "provider.endedAtMillis"
  );
  if (provider.status === "applied" && providerEndedAtMillis === null) {
    throw new MembershipCancellationValidationError(
      "An applied provider cancellation requires provider.endedAtMillis."
    );
  }
  const status: CancellationRequestStatus = provider.status === "manual_review" ?
    "manual_review" : receipt.outcome.refundReviewRequired ?
      "refund_review" : provider.status === "applied" ? "applied" : "accepted";
  return Object.freeze({
    receiptId: receipt.receiptId,
    requestId: receipt.requestId,
    kind: receipt.kind,
    status,
    providerStatus: provider.status,
    receivedAtMillis: receipt.receivedAtMillis,
    cancellationEffectiveAtMillis:
      receipt.outcome.cancellationEffectiveAtMillis,
    accessEndsAtMillis: receipt.outcome.accessEndsAtMillis,
    collectFuturePayments: false as const,
    futurePaymentDuePence: 0 as const,
    providerEndedAtMillis,
    refundReviewRequired: receipt.outcome.refundReviewRequired,
    refundAmountPence: null,
    acknowledgementOutboxId: cancellationAcknowledgementOutboxId(
      receipt.requestId
    ),
    acknowledgementIdempotencyKey:
      cancellationAcknowledgementIdempotencyKey(receipt.requestId),
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatUkTimestamp(millis: number): {iso: string; display: string} {
  const iso = new Date(millis).toISOString();
  const display = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(millis));
  return {iso, display};
}

function validateAcknowledgementInput(
  input: CancellationAcknowledgementInput
): Readonly<{
  company: CancellationAcknowledgementCompany;
  membership: CancellationAcknowledgementMembership;
  recipient: CancellationAcknowledgementRecipient;
}> {
  assertMembershipCancellationReceipt(input.receipt);
  const company = Object.freeze({
    legalName: requirePlainText(input.company.legalName, "company.legalName"),
    tradingName: requirePlainText(
      input.company.tradingName,
      "company.tradingName"
    ),
    supportEmail: canonicalizeCancellationEmail(
      input.company.supportEmail,
      "company.supportEmail"
    ),
    fromEmail: canonicalizeCancellationEmail(
      input.company.fromEmail,
      "company.fromEmail"
    ),
    postalAddress: requirePlainText(
      input.company.postalAddress,
      "company.postalAddress",
      500
    ),
  });
  const membership = Object.freeze({
    subscriptionId: requireSafeIdentifier(
      input.membership.subscriptionId,
      "membership.subscriptionId"
    ),
    planName: requirePlainText(
      input.membership.planName,
      "membership.planName"
    ),
    participantFullName: requirePlainText(
      input.membership.participantFullName,
      "membership.participantFullName"
    ),
  });
  if (membership.subscriptionId !== input.receipt.subscriptionId) {
    throw new MembershipCancellationValidationError(
      "The acknowledgement membership does not match the receipt."
    );
  }
  if (membership.planName !== input.receipt.membership.planName ||
    membership.participantFullName !==
      input.receipt.membership.participantFullName) {
    throw new MembershipCancellationValidationError(
      "The acknowledgement membership details do not match the receipt."
    );
  }
  const recipient = Object.freeze({
    fullName: requireOptionalPlainText(
      input.recipient.fullName,
      "recipient.fullName"
    ),
    email: canonicalizeCancellationEmail(
      input.recipient.email,
      "recipient.email"
    ),
  });
  return Object.freeze({company, membership, recipient});
}

export function buildCancellationAcknowledgementHtml(
  input: CancellationAcknowledgementInput
): string {
  const {company, membership, recipient} = validateAcknowledgementInput(input);
  const {receipt} = input;
  const receivedAt = formatUkTimestamp(receipt.receivedAtMillis);
  const greeting = recipient.fullName ?
    `Hello ${escapeHtml(recipient.fullName)},` : "Hello,";
  const refundReview = receipt.outcome.refundReviewRequired ?
    "<p style=\"margin:0 0 16px;\"><strong>Manual refund review:</strong> our records show that a payment may already have been received or the service start time had been reached. We will review any amount already paid and any service already supplied. This acknowledgement does not calculate or promise a refund amount.</p>" :
    "<p style=\"margin:0 0 16px;\">Our receipt-time records do not indicate a payment or started service requiring a refund calculation. No refund amount has been calculated by this automated acknowledgement.</p>";

  return `<!doctype html>
<html lang="en"><body style="font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.6;">
  <h1 style="font-size:20px;margin:0 0 12px;">We received your cancellation</h1>
  <p style="margin:0 0 16px;">${greeting}</p>
  <p style="margin:0 0 16px;">We received your clear notice cancelling the membership shown below at <time datetime="${escapeHtml(receivedAt.iso)}"><strong>${escapeHtml(receivedAt.display)}</strong></time>. Your receipt reference is <strong>${escapeHtml(receipt.receiptId)}</strong>.</p>
  <p style="margin:0 0 16px;"><strong>No further recurring membership payment will be taken under this cancellation.</strong></p>
  <p style="margin:0 0 16px;">The cancellation is recorded as an immediate stop from the receipt time shown above. Payment-provider and access-system processing are tracked separately.</p>
  <p style="margin:0 0 16px;">The payment provider may record completion later. That provider processing time does not replace the receipt time recorded in this acknowledgement.</p>
  ${refundReview}
  <table style="border-collapse:collapse;margin:20px 0;">
    <tr><td style="padding:5px 16px 5px 0;color:#666;">Membership</td><td style="padding:5px 0;"><strong>${escapeHtml(membership.planName)}</strong></td></tr>
    <tr><td style="padding:5px 16px 5px 0;color:#666;">Participant</td><td style="padding:5px 0;"><strong>${escapeHtml(membership.participantFullName)}</strong></td></tr>
    <tr><td style="padding:5px 16px 5px 0;color:#666;">Subscription reference</td><td style="padding:5px 0;"><code>${escapeHtml(membership.subscriptionId)}</code></td></tr>
    <tr><td style="padding:5px 16px 5px 0;color:#666;">Request type</td><td style="padding:5px 0;">Cooling-off cancellation</td></tr>
  </table>
  <p style="margin:0 0 20px;">If any detail is wrong, reply to this email or contact <a href="mailto:${escapeHtml(company.supportEmail)}">${escapeHtml(company.supportEmail)}</a> and quote the receipt reference.</p>
  <hr style="border:none;border-top:1px solid #ddd;margin:24px 0 12px;">
  <p style="margin:0;font-size:12px;color:#666;">${escapeHtml(company.tradingName)} is operated by ${escapeHtml(company.legalName)}.<br>${escapeHtml(company.postalAddress)}</p>
</body></html>`;
}

export function buildCancellationAcknowledgementPayload(
  input: CancellationAcknowledgementInput
): CancellationAcknowledgementEmailPayload {
  const {company, membership, recipient} = validateAcknowledgementInput(input);
  return Object.freeze({
    from: `${company.tradingName} <${company.fromEmail}>`,
    to: [recipient.email],
    reply_to: company.supportEmail,
    subject: `Cancellation received — ${membership.planName}`,
    html: buildCancellationAcknowledgementHtml(input),
  });
}

export function assertMembershipCancellationReceipt(
  value: unknown
): asserts value is MembershipCancellationReceipt {
  const receipt = requireRecord(value, "receipt");
  if (receipt.schemaVersion !== MEMBERSHIP_CANCELLATION_SCHEMA_VERSION ||
    receipt.kind !== "cooling_off" || receipt.status !== "received" ||
    receipt.statement !== CANONICAL_CANCELLATION_STATEMENT ||
    receipt.statementVersion !== CANONICAL_CANCELLATION_STATEMENT_VERSION) {
    throw new MembershipCancellationValidationError(
      "Receipt schema, kind, status, or canonical statement is invalid."
    );
  }
  const requestId = requireSafeIdentifier(receipt.requestId, "receipt.requestId");
  if (receipt.receiptId !== cancellationReceiptDocumentId(requestId)) {
    throw new MembershipCancellationValidationError(
      "receipt.receiptId does not match receipt.requestId."
    );
  }
  requireSafeIdentifier(receipt.subscriptionId, "receipt.subscriptionId");
  if (!isCancellationReceiptChannel(receipt.channel)) {
    throw new MembershipCancellationValidationError(
      "receipt.channel is unsupported."
    );
  }
  const receivedAtMillis = requireMillis(
    receipt.receivedAtMillis,
    "receipt.receivedAtMillis"
  );
  const recordedAtMillis = requireMillis(
    receipt.recordedAtMillis,
    "receipt.recordedAtMillis"
  );
  if (recordedAtMillis < receivedAtMillis) {
    throw new MembershipCancellationValidationError(
      "receipt.recordedAtMillis cannot precede receipt.receivedAtMillis."
    );
  }
  requireOptionalUid(receipt.actorUid, "receipt.actorUid");
  requireOptionalUid(receipt.staffActorUid, "receipt.staffActorUid");
  const payer = freezeIdentity(
    requireRecord(receipt.payer, "receipt.payer") as CancellationIdentitySnapshot,
    "receipt.payer"
  );
  const sender = freezeIdentity(
    requireRecord(receipt.sender, "receipt.sender") as CancellationIdentitySnapshot,
    "receipt.sender"
  );
  const sourceEvidence = freezeSourceEvidence(
    requireRecord(
      receipt.sourceEvidence,
      "receipt.sourceEvidence"
    ) as CancellationSourceEvidence
  );
  const membership = freezeMembershipSnapshot(
    requireRecord(
      receipt.membership,
      "receipt.membership"
    ) as CancellationMembershipSnapshot
  );
  if (receivedAtMillis < membership.contractMadeAtMillis ||
    receivedAtMillis > membership.coolingOffEndsAtMillis) {
    throw new MembershipCancellationValidationError(
      "receipt.receivedAtMillis is outside the stored cooling-off period."
    );
  }
  if (receipt.channel === "membership_portal" && !receipt.actorUid) {
    throw new MembershipCancellationValidationError(
      "membership_portal receipts require actorUid."
    );
  }
  if (receipt.channel === "support_email" &&
    (!sender.email || !sourceEvidence.contentSha256)) {
    throw new MembershipCancellationValidationError(
      "support_email receipts require a sender email and content hash."
    );
  }
  if (receipt.channel === "staff_recorded" && !receipt.staffActorUid) {
    throw new MembershipCancellationValidationError(
      "staff_recorded receipts require staffActorUid."
    );
  }
  // Validate every outcome value, rather than trusting an amount or date read
  // back from storage. There is intentionally no automated refund amount.
  const expected = buildImmediateCoolingOffOutcome({
    receivedAtMillis,
    serviceStartsAtMillis: membership.serviceStartsAtMillis,
    firstPaymentReceivedAtMillis: membership.firstPaymentReceivedAtMillis,
  });
  const outcome = requireRecord(receipt.outcome, "receipt.outcome");
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (outcome[key] !== expectedValue) {
      throw new MembershipCancellationValidationError(
        `receipt.outcome.${key} is inconsistent with immutable receipt evidence.`
      );
    }
  }
  // Touch the payer snapshot so validation cannot be accidentally removed as
  // an unused expression by a later refactor.
  void payer;
}
