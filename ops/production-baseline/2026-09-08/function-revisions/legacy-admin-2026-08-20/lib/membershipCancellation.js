"use strict";
/* eslint-disable require-jsdoc, valid-jsdoc, max-len, no-control-regex */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MembershipCancellationValidationError = exports.CANONICAL_CANCELLATION_STATEMENT_VERSION = exports.CANONICAL_CANCELLATION_STATEMENT = exports.MEMBERSHIP_CANCELLATION_OUTBOX_COLLECTION = exports.MEMBERSHIP_CANCELLATION_RECEIPT_COLLECTION = exports.CANCELLATION_ACKNOWLEDGEMENT_VERSION = exports.MEMBERSHIP_CANCELLATION_SCHEMA_VERSION = void 0;
exports.canonicalizeCancellationEmail = canonicalizeCancellationEmail;
exports.isCancellationKind = isCancellationKind;
exports.isCancellationRequestStatus = isCancellationRequestStatus;
exports.isCancellationProviderStatus = isCancellationProviderStatus;
exports.isCancellationReceiptChannel = isCancellationReceiptChannel;
exports.cancellationReceiptDocumentId = cancellationReceiptDocumentId;
exports.cancellationAcknowledgementOutboxId = cancellationAcknowledgementOutboxId;
exports.cancellationAcknowledgementIdempotencyKey = cancellationAcknowledgementIdempotencyKey;
exports.buildImmediateCoolingOffOutcome = buildImmediateCoolingOffOutcome;
exports.buildCoolingOffCancellationReceipt = buildCoolingOffCancellationReceipt;
exports.buildMembershipCancellationProjection = buildMembershipCancellationProjection;
exports.buildCancellationAcknowledgementHtml = buildCancellationAcknowledgementHtml;
exports.buildCancellationAcknowledgementPayload = buildCancellationAcknowledgementPayload;
exports.assertMembershipCancellationReceipt = assertMembershipCancellationReceipt;
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
exports.MEMBERSHIP_CANCELLATION_SCHEMA_VERSION = 1;
exports.CANCELLATION_ACKNOWLEDGEMENT_VERSION = 1;
exports.MEMBERSHIP_CANCELLATION_RECEIPT_COLLECTION = "membershipCancellationReceipts";
exports.MEMBERSHIP_CANCELLATION_OUTBOX_COLLECTION = "membershipEmailOutbox";
exports.CANONICAL_CANCELLATION_STATEMENT = "I am giving notice that I cancel this membership contract.";
exports.CANONICAL_CANCELLATION_STATEMENT_VERSION = "membership-cancellation-statement/v1";
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{8,255}$/;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
class MembershipCancellationValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = "MembershipCancellationValidationError";
    }
}
exports.MembershipCancellationValidationError = MembershipCancellationValidationError;
function requireRecord(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new MembershipCancellationValidationError(`${label} must be an object.`);
    }
    return value;
}
function requireSafeIdentifier(value, label) {
    if (typeof value !== "string" || !SAFE_IDENTIFIER_PATTERN.test(value)) {
        throw new MembershipCancellationValidationError(`${label} must be a safe identifier between 8 and 255 characters.`);
    }
    return value;
}
function requireUid(value, label) {
    if (typeof value !== "string" || value.length < 1 || value.length > 128 ||
        value.includes("/") || CONTROL_CHARACTER_PATTERN.test(value)) {
        throw new MembershipCancellationValidationError(`${label} must be a non-empty Firebase UID of at most 128 characters.`);
    }
    return value;
}
function requireOptionalUid(value, label) {
    if (value === null)
        return null;
    return requireUid(value, label);
}
function requirePlainText(value, label, maxLength = 255) {
    if (typeof value !== "string") {
        throw new MembershipCancellationValidationError(`${label} must be text.`);
    }
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > maxLength ||
        CONTROL_CHARACTER_PATTERN.test(trimmed)) {
        throw new MembershipCancellationValidationError(`${label} must be non-empty text without control characters.`);
    }
    return trimmed;
}
function requireOptionalPlainText(value, label, maxLength = 255) {
    if (value === null)
        return null;
    return requirePlainText(value, label, maxLength);
}
function canonicalizeCancellationEmail(value, label = "email") {
    const email = requirePlainText(value, label, 320).toLowerCase();
    if (!EMAIL_PATTERN.test(email)) {
        throw new MembershipCancellationValidationError(`${label} must be a valid email address.`);
    }
    return email;
}
function requireOptionalEmail(value, label) {
    if (value === null)
        return null;
    return canonicalizeCancellationEmail(value, label);
}
function requireMillis(value, label) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 ||
        !Number.isFinite(new Date(value).getTime())) {
        throw new MembershipCancellationValidationError(`${label} must be a positive millisecond timestamp.`);
    }
    return value;
}
function requireOptionalMillis(value, label) {
    if (value === null)
        return null;
    return requireMillis(value, label);
}
function requireOptionalSha256(value, label) {
    if (value === null)
        return null;
    if (typeof value !== "string" || !SHA256_HEX_PATTERN.test(value)) {
        throw new MembershipCancellationValidationError(`${label} must be a lowercase SHA-256 hex digest.`);
    }
    return value;
}
function requireBoolean(value, label) {
    if (typeof value !== "boolean") {
        throw new MembershipCancellationValidationError(`${label} must be boolean.`);
    }
    return value;
}
function freezeIdentity(value, label) {
    return Object.freeze({
        uid: requireOptionalUid(value.uid, `${label}.uid`),
        fullName: requireOptionalPlainText(value.fullName, `${label}.fullName`),
        email: requireOptionalEmail(value.email, `${label}.email`),
    });
}
function freezeSourceEvidence(value) {
    return Object.freeze({
        externalMessageIdSha256: requireOptionalSha256(value.externalMessageIdSha256, "sourceEvidence.externalMessageIdSha256"),
        contentSha256: requireOptionalSha256(value.contentSha256, "sourceEvidence.contentSha256"),
    });
}
function freezeMembershipSnapshot(value) {
    const snapshot = Object.freeze({
        planKey: requirePlainText(value.planKey, "membership.planKey", 100),
        planName: requirePlainText(value.planName, "membership.planName"),
        participantFullName: requirePlainText(value.participantFullName, "membership.participantFullName"),
        contractMadeAtMillis: requireMillis(value.contractMadeAtMillis, "membership.contractMadeAtMillis"),
        coolingOffEndsAtMillis: requireMillis(value.coolingOffEndsAtMillis, "membership.coolingOffEndsAtMillis"),
        serviceStartsAtMillis: requireMillis(value.serviceStartsAtMillis, "membership.serviceStartsAtMillis"),
        firstPaymentReceivedAtMillis: requireOptionalMillis(value.firstPaymentReceivedAtMillis, "membership.firstPaymentReceivedAtMillis"),
        immediatePerformanceRequested: requireBoolean(value.immediatePerformanceRequested, "membership.immediatePerformanceRequested"),
    });
    if (snapshot.coolingOffEndsAtMillis < snapshot.contractMadeAtMillis) {
        throw new MembershipCancellationValidationError("membership.coolingOffEndsAtMillis cannot precede the contract time.");
    }
    return snapshot;
}
function isCancellationKind(value) {
    return value === "presale_withdrawal" || value === "cooling_off" ||
        value === "contractual";
}
function isCancellationRequestStatus(value) {
    return value === "accepted" || value === "pending" || value === "applied" ||
        value === "refund_review" || value === "manual_review";
}
function isCancellationProviderStatus(value) {
    return value === "pending" || value === "applied" ||
        value === "manual_review";
}
function isCancellationReceiptChannel(value) {
    return value === "membership_portal" || value === "support_email" ||
        value === "staff_recorded";
}
function cancellationReceiptDocumentId(requestId) {
    return requireSafeIdentifier(requestId, "requestId");
}
function cancellationAcknowledgementOutboxId(requestId) {
    return `cancellation-${requireSafeIdentifier(requestId, "requestId")}`;
}
function cancellationAcknowledgementIdempotencyKey(requestId) {
    return `membership-cancellation/${requireSafeIdentifier(requestId, "requestId")}/ack/v${exports.CANCELLATION_ACKNOWLEDGEMENT_VERSION}`;
}
function buildImmediateCoolingOffOutcome(input) {
    const receivedAtMillis = requireMillis(input.receivedAtMillis, "receivedAtMillis");
    const serviceStartsAtMillis = requireMillis(input.serviceStartsAtMillis, "serviceStartsAtMillis");
    const firstPaymentReceivedAtMillis = requireOptionalMillis(input.firstPaymentReceivedAtMillis, "firstPaymentReceivedAtMillis");
    const refundReviewRequired = firstPaymentReceivedAtMillis !== null ||
        receivedAtMillis >= serviceStartsAtMillis;
    return Object.freeze({
        kind: "cooling_off",
        legalReceiptAtMillis: receivedAtMillis,
        cancellationEffectiveAtMillis: receivedAtMillis,
        accessEndsAtMillis: receivedAtMillis,
        collectFuturePayments: false,
        futurePaymentDuePence: 0,
        providerCancellationMode: "immediate",
        providerEndedAtMillis: null,
        refundReviewRequired,
        refundAmountPence: null,
        refundReviewStatus: refundReviewRequired ?
            "manual_review" : "not_required",
    });
}
function buildCoolingOffCancellationReceipt(input) {
    const requestId = requireSafeIdentifier(input.requestId, "requestId");
    const subscriptionId = requireSafeIdentifier(input.subscriptionId, "subscriptionId");
    if (!isCancellationReceiptChannel(input.channel)) {
        throw new MembershipCancellationValidationError("channel is not a supported cancellation receipt channel.");
    }
    const receivedAtMillis = requireMillis(input.receivedAtMillis, "receivedAtMillis");
    const recordedAtMillis = requireMillis(input.recordedAtMillis, "recordedAtMillis");
    if (recordedAtMillis < receivedAtMillis) {
        throw new MembershipCancellationValidationError("recordedAtMillis cannot precede receivedAtMillis.");
    }
    const membership = freezeMembershipSnapshot(input.membership);
    if (receivedAtMillis < membership.contractMadeAtMillis ||
        receivedAtMillis > membership.coolingOffEndsAtMillis) {
        throw new MembershipCancellationValidationError("receivedAtMillis must fall within the stored cooling-off period.");
    }
    const actorUid = requireOptionalUid(input.actorUid, "actorUid");
    const staffActorUid = requireOptionalUid(input.staffActorUid, "staffActorUid");
    const sender = freezeIdentity(input.sender, "sender");
    const sourceEvidence = freezeSourceEvidence(input.sourceEvidence);
    if (input.channel === "membership_portal" && !actorUid) {
        throw new MembershipCancellationValidationError("membership_portal receipts require actorUid.");
    }
    if (input.channel === "support_email" &&
        (!sender.email || !sourceEvidence.contentSha256)) {
        throw new MembershipCancellationValidationError("support_email receipts require a sender email and content hash.");
    }
    if (input.channel === "staff_recorded" && !staffActorUid) {
        throw new MembershipCancellationValidationError("staff_recorded receipts require staffActorUid.");
    }
    const outcome = buildImmediateCoolingOffOutcome({
        receivedAtMillis,
        serviceStartsAtMillis: membership.serviceStartsAtMillis,
        firstPaymentReceivedAtMillis: membership.firstPaymentReceivedAtMillis,
    });
    return Object.freeze({
        schemaVersion: exports.MEMBERSHIP_CANCELLATION_SCHEMA_VERSION,
        receiptId: cancellationReceiptDocumentId(requestId),
        requestId,
        subscriptionId,
        kind: "cooling_off",
        status: "received",
        channel: input.channel,
        statement: exports.CANONICAL_CANCELLATION_STATEMENT,
        statementVersion: exports.CANONICAL_CANCELLATION_STATEMENT_VERSION,
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
function buildMembershipCancellationProjection(receipt, provider = { status: "pending", endedAtMillis: null }) {
    assertMembershipCancellationReceipt(receipt);
    if (!isCancellationProviderStatus(provider.status)) {
        throw new MembershipCancellationValidationError("provider.status is not a supported cancellation status.");
    }
    const providerEndedAtMillis = requireOptionalMillis(provider.endedAtMillis, "provider.endedAtMillis");
    if (provider.status === "applied" && providerEndedAtMillis === null) {
        throw new MembershipCancellationValidationError("An applied provider cancellation requires provider.endedAtMillis.");
    }
    const status = provider.status === "manual_review" ?
        "manual_review" : receipt.outcome.refundReviewRequired ?
        "refund_review" : provider.status === "applied" ? "applied" : "accepted";
    return Object.freeze({
        receiptId: receipt.receiptId,
        requestId: receipt.requestId,
        kind: receipt.kind,
        status,
        providerStatus: provider.status,
        receivedAtMillis: receipt.receivedAtMillis,
        cancellationEffectiveAtMillis: receipt.outcome.cancellationEffectiveAtMillis,
        accessEndsAtMillis: receipt.outcome.accessEndsAtMillis,
        collectFuturePayments: false,
        futurePaymentDuePence: 0,
        providerEndedAtMillis,
        refundReviewRequired: receipt.outcome.refundReviewRequired,
        refundAmountPence: null,
        acknowledgementOutboxId: cancellationAcknowledgementOutboxId(receipt.requestId),
        acknowledgementIdempotencyKey: cancellationAcknowledgementIdempotencyKey(receipt.requestId),
    });
}
function escapeHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
function formatUkTimestamp(millis) {
    const iso = new Date(millis).toISOString();
    const display = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/London",
        dateStyle: "long",
        timeStyle: "short",
    }).format(new Date(millis));
    return { iso, display };
}
function validateAcknowledgementInput(input) {
    assertMembershipCancellationReceipt(input.receipt);
    const company = Object.freeze({
        legalName: requirePlainText(input.company.legalName, "company.legalName"),
        tradingName: requirePlainText(input.company.tradingName, "company.tradingName"),
        supportEmail: canonicalizeCancellationEmail(input.company.supportEmail, "company.supportEmail"),
        fromEmail: canonicalizeCancellationEmail(input.company.fromEmail, "company.fromEmail"),
        postalAddress: requirePlainText(input.company.postalAddress, "company.postalAddress", 500),
    });
    const membership = Object.freeze({
        subscriptionId: requireSafeIdentifier(input.membership.subscriptionId, "membership.subscriptionId"),
        planName: requirePlainText(input.membership.planName, "membership.planName"),
        participantFullName: requirePlainText(input.membership.participantFullName, "membership.participantFullName"),
    });
    if (membership.subscriptionId !== input.receipt.subscriptionId) {
        throw new MembershipCancellationValidationError("The acknowledgement membership does not match the receipt.");
    }
    if (membership.planName !== input.receipt.membership.planName ||
        membership.participantFullName !==
            input.receipt.membership.participantFullName) {
        throw new MembershipCancellationValidationError("The acknowledgement membership details do not match the receipt.");
    }
    const recipient = Object.freeze({
        fullName: requireOptionalPlainText(input.recipient.fullName, "recipient.fullName"),
        email: canonicalizeCancellationEmail(input.recipient.email, "recipient.email"),
    });
    return Object.freeze({ company, membership, recipient });
}
function buildCancellationAcknowledgementHtml(input) {
    const { company, membership, recipient } = validateAcknowledgementInput(input);
    const { receipt } = input;
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
function buildCancellationAcknowledgementPayload(input) {
    const { company, membership, recipient } = validateAcknowledgementInput(input);
    return Object.freeze({
        from: `${company.tradingName} <${company.fromEmail}>`,
        to: [recipient.email],
        reply_to: company.supportEmail,
        subject: `Cancellation received — ${membership.planName}`,
        html: buildCancellationAcknowledgementHtml(input),
    });
}
function assertMembershipCancellationReceipt(value) {
    const receipt = requireRecord(value, "receipt");
    if (receipt.schemaVersion !== exports.MEMBERSHIP_CANCELLATION_SCHEMA_VERSION ||
        receipt.kind !== "cooling_off" || receipt.status !== "received" ||
        receipt.statement !== exports.CANONICAL_CANCELLATION_STATEMENT ||
        receipt.statementVersion !== exports.CANONICAL_CANCELLATION_STATEMENT_VERSION) {
        throw new MembershipCancellationValidationError("Receipt schema, kind, status, or canonical statement is invalid.");
    }
    const requestId = requireSafeIdentifier(receipt.requestId, "receipt.requestId");
    if (receipt.receiptId !== cancellationReceiptDocumentId(requestId)) {
        throw new MembershipCancellationValidationError("receipt.receiptId does not match receipt.requestId.");
    }
    requireSafeIdentifier(receipt.subscriptionId, "receipt.subscriptionId");
    if (!isCancellationReceiptChannel(receipt.channel)) {
        throw new MembershipCancellationValidationError("receipt.channel is unsupported.");
    }
    const receivedAtMillis = requireMillis(receipt.receivedAtMillis, "receipt.receivedAtMillis");
    const recordedAtMillis = requireMillis(receipt.recordedAtMillis, "receipt.recordedAtMillis");
    if (recordedAtMillis < receivedAtMillis) {
        throw new MembershipCancellationValidationError("receipt.recordedAtMillis cannot precede receipt.receivedAtMillis.");
    }
    requireOptionalUid(receipt.actorUid, "receipt.actorUid");
    requireOptionalUid(receipt.staffActorUid, "receipt.staffActorUid");
    const payer = freezeIdentity(requireRecord(receipt.payer, "receipt.payer"), "receipt.payer");
    const sender = freezeIdentity(requireRecord(receipt.sender, "receipt.sender"), "receipt.sender");
    const sourceEvidence = freezeSourceEvidence(requireRecord(receipt.sourceEvidence, "receipt.sourceEvidence"));
    const membership = freezeMembershipSnapshot(requireRecord(receipt.membership, "receipt.membership"));
    if (receivedAtMillis < membership.contractMadeAtMillis ||
        receivedAtMillis > membership.coolingOffEndsAtMillis) {
        throw new MembershipCancellationValidationError("receipt.receivedAtMillis is outside the stored cooling-off period.");
    }
    if (receipt.channel === "membership_portal" && !receipt.actorUid) {
        throw new MembershipCancellationValidationError("membership_portal receipts require actorUid.");
    }
    if (receipt.channel === "support_email" &&
        (!sender.email || !sourceEvidence.contentSha256)) {
        throw new MembershipCancellationValidationError("support_email receipts require a sender email and content hash.");
    }
    if (receipt.channel === "staff_recorded" && !receipt.staffActorUid) {
        throw new MembershipCancellationValidationError("staff_recorded receipts require staffActorUid.");
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
            throw new MembershipCancellationValidationError(`receipt.outcome.${key} is inconsistent with immutable receipt evidence.`);
        }
    }
    // Touch the payer snapshot so validation cannot be accidentally removed as
    // an unused expression by a later refactor.
    void payer;
}
//# sourceMappingURL=membershipCancellation.js.map