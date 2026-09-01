/* eslint-disable no-console */

/**
 * Offline, read-only release-candidate gate. It reads checked-in files and runs
 * pure static verifiers only: no Firebase, Stripe, Vercel or email API is
 * contacted and no local/remote state is mutated.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {verifyBillingMonitoring} = require("./verifyBillingMonitoring");
const {
  verifyBillingWebhookEvents,
} = require("./verifyBillingWebhookEvents");
const {
  verifyConditioningPaygDeployment,
} = require("./verifyConditioningPaygDeployment");

const root = path.resolve(__dirname, "..");
const readinessPath = path.join(
  root,
  "ops/release/conditioning-payg-readiness.json"
);

const EXPECTED_OWNER_DECISIONS = Object.freeze([
  "adult-conditioning-product-terms",
  "payg-pii-retention-and-redaction-policy",
  "payg-product-terms-and-waiver",
]);
const EXPECTED_OPERATIONAL_EVIDENCE = Object.freeze([
  "billing-alert-policies-and-staffed-notification-route",
  "class-cancellation-quota-and-payg-refund-drill",
  "conditioning-stripe-test-purchase-to-booking-journey",
  "live-product-catalogue-and-closed-config-readback",
  "live-stripe-delivery-backlog-cleared",
  "live-stripe-webhook-exact-event-readback",
  "payg-stripe-test-purchase-refund-dispute-email-journey",
  "resend-domain-and-confirmation-delivery",
]);
const PAYG_RETENTION_DECISION_ID =
  "payg-pii-retention-and-redaction-policy";
const PAYG_RETENTION_POLICY_VERSION =
  "ZAF-PAYG-PII-RETENTION-2026-08-31-01";
const LIVE_STRIPE_DELIVERY_BACKLOG_ID =
  "live-stripe-delivery-backlog-cleared";
const LIVE_STRIPE_ACCOUNT_ID = "acct_1Q1PQcFzNDZoGGA0";
const LIVE_STRIPE_BACKLOG_WINDOW_START = "2026-08-25T00:00:00.000Z";
const BLOCKED_STRIPE_EVENT_ID = "evt_1UAgFqFzNDZoGGA0UDdTWXmb";
const BLOCKED_STRIPE_INVOICE_ID = "in_1UAfI7FzNDZoGGA0axkViBtH";
const BLOCKED_STRIPE_EVENT_CREATED = 1788225169;
const BLOCKED_STRIPE_SUBSCRIPTION_SHA256 =
  "603678ab7502208430a4b7ce131e220ece946adccca58e35d28baca51e27386a";
const LEGACY_RECOVERY_AUDIT_ID =
  `legacy-presale-discount-recovery-${BLOCKED_STRIPE_INVOICE_ID}`;

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function assertSameValues(actual, expected, label) {
  if (JSON.stringify(uniqueSorted(actual)) !== JSON.stringify(uniqueSorted(expected))) {
    throw new Error(`${label} is stale.`);
  }
}

function assertEvidence(items, statusField, label) {
  for (const item of items) {
    if (!item.id || typeof item[statusField] !== "boolean") {
      throw new Error(`${label} contains an invalid item.`);
    }
    if (item[statusField]) {
      if (typeof item.evidence !== "string" || item.evidence.trim().length < 8) {
        throw new Error(`${label} ${item.id} needs a durable evidence reference.`);
      }
    } else if (item.evidence !== null) {
      throw new Error(`${label} ${item.id} must not claim evidence while pending.`);
    }
  }
}

function evidencePath(relativePath, label) {
  if (typeof relativePath !== "string" ||
    !/^ops\/release\/evidence\/[A-Za-z0-9._-]+\.json$/.test(relativePath)) {
    throw new Error(`${label} must use a checked-in JSON evidence path.`);
  }
  const absolutePath = path.resolve(root, relativePath);
  const evidenceRoot = `${path.resolve(root, "ops/release/evidence")}${path.sep}`;
  if (!absolutePath.startsWith(evidenceRoot) || !fs.existsSync(absolutePath)) {
    throw new Error(`${label} does not resolve to checked-in evidence.`);
  }
  return absolutePath;
}

function readEvidence(relativePath, label) {
  return JSON.parse(fs.readFileSync(evidencePath(relativePath, label), "utf8"));
}

function assertPartialEvidence(items, statusField) {
  for (const item of items) {
    if (item.partialEvidence === undefined) continue;
    if (item[statusField]) {
      throw new Error(`${item.id} must remove partial evidence once fully verified.`);
    }
    readEvidence(item.partialEvidence, `Partial evidence for ${item.id}`);
  }
}

function assertPaygRetentionOwnerEvidence(ownerDecisions) {
  const decision = ownerDecisions.find(
    (item) => item.id === PAYG_RETENTION_DECISION_ID
  );
  if (!decision?.approved) return;
  const evidence = readEvidence(
    decision.evidence,
    `Owner decision ${PAYG_RETENTION_DECISION_ID}`
  );
  const policy = evidence.policy;
  const expectedIntentFields = [
    "attendee",
    "contact",
    "acceptances",
    "requestFingerprint",
    "checkoutSessionUrl",
  ];
  if (evidence.schemaVersion !== 1 ||
    evidence.decisionId !== PAYG_RETENTION_DECISION_ID ||
    evidence.approved !== true ||
    evidence.approvedByRole !== "business-owner" ||
    evidence.policyVersion !== PAYG_RETENTION_POLICY_VERSION ||
    evidence.legalReviewStatus !== "pending" ||
    evidence.customerFacingDocumentsApproved !== false ||
    evidence.deploymentAuthorized !== false ||
    evidence.productionGatesRemainClosed !== true ||
    policy?.abandonedUnpaidIntent?.retentionDays !== 30 ||
    JSON.stringify(policy.abandonedUnpaidIntent.fieldsRedacted) !==
      JSON.stringify(expectedIntentFields) ||
    policy?.paidOrderAfterClassEnd?.retentionDays !== 90 ||
    JSON.stringify(policy.paidOrderAfterClassEnd.orderFieldsRedacted) !==
      JSON.stringify(["attendee", "contact", "acceptances"]) ||
    JSON.stringify(policy.paidOrderAfterClassEnd.emailOutboxFieldsRedacted) !==
      JSON.stringify(["to", "templateData", "lastError"]) ||
    JSON.stringify(policy.paidOrderAfterClassEnd.guestBookingFieldsRedacted) !==
      JSON.stringify(["userName"]) ||
    policy?.waiverIdentityAfterClassEnd?.retentionDays !== 2190 ||
    JSON.stringify(policy.waiverIdentityAfterClassEnd.fieldsRedacted) !==
      JSON.stringify(["attendee", "acceptances"]) ||
    policy?.execution?.bounded !== true ||
    policy.execution.resumable !== true ||
    policy.execution.idempotent !== true ||
    typeof policy.activeEmailLeaseRule !== "string") {
    throw new Error("PAYG retention owner evidence does not match the approved policy.");
  }
}

function assertLiveStripeDeliveryBacklogEvidence(operationalEvidence) {
  const item = operationalEvidence.find(
    ({id}) => id === LIVE_STRIPE_DELIVERY_BACKLOG_ID
  );
  if (!item) {
    throw new Error("Live Stripe delivery backlog readiness item is missing.");
  }
  if (item.verified) {
    const cleared = readEvidence(
      item.evidence,
      `Operational evidence ${LIVE_STRIPE_DELIVERY_BACKLOG_ID}`
    );
    assertClearedStripeDeliveryBacklogEvidence(cleared);
    return;
  }

  const pending = readEvidence(
    item.partialEvidence,
    `Partial evidence for ${LIVE_STRIPE_DELIVERY_BACKLOG_ID}`
  );
  const event = pending.readback?.events?.[0];
  const remediation = pending.remediationRequired;
  if (pending.schemaVersion !== 1 ||
    pending.evidenceType !== "stripe-live-delivery-backlog-readback" ||
    pending.readback?.windowStart !== "2026-08-25" ||
    pending.readback?.unsuccessfulEventCount !== 1 ||
    pending.readback.events.length !== 1 ||
    event?.eventId !== BLOCKED_STRIPE_EVENT_ID ||
    event.type !== "invoice.paid" ||
    event.createdAtUnixSeconds !== BLOCKED_STRIPE_EVENT_CREATED ||
    event.pendingWebhooks !== 1 ||
    event.invoiceId !== BLOCKED_STRIPE_INVOICE_ID ||
    pending.applicationLedger?.state !== "dead-lettered" ||
    pending.applicationLedger?.repeatedFailureReason !==
      "unexpected first-payment amount" ||
    remediation?.compatibleCodeDeployed !== false ||
    remediation.eventAndCustomerStateSafelyReconciled !== false ||
    remediation.zeroUnsuccessfulEventsReadback !== false ||
    pending.customerPiiRecorded !== false ||
    pending.amountRecorded !== false ||
    pending.subscriptionIdRecorded !== false ||
    pending.providerMutation !== false ||
    pending.applicationDataMutation !== false ||
    pending.deploymentPerformed !== false) {
    throw new Error("Live Stripe delivery backlog evidence is stale or unsafe.");
  }
}

function isIsoTimestamp(value) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

function sourceSha256(relativePath) {
  return crypto.createHash("sha256")
    .update(fs.readFileSync(path.join(root, relativePath)))
    .digest("hex");
}

/**
 * A zero count is not sufficient on its own: the original failure can only be
 * cleared after compatible production code and the exact customer/event state
 * have converged, followed by a complete live-account query covering the
 * original incident window.
 */
function assertClearedStripeDeliveryBacklogEvidence(cleared) {
  const deployment = cleared?.deployment;
  const reconciliation = cleared?.reconciliation;
  const acknowledgement = cleared?.deliveryAcknowledgement;
  const readback = cleared?.readback;
  const deploymentCompletedAt = deployment?.completedAt;
  const reconciliationCompletedAt = reconciliation?.completedAt;
  const readbackCompletedAt = readback?.completedAt;
  if (cleared?.schemaVersion !== 2 ||
    cleared.evidenceType !==
      "stripe-live-delivery-backlog-cleared-readback" ||
    deployment?.compatibleCodeDeployed !== true ||
    deployment.environment !== "production" ||
    deployment.firebaseProjectId !== "alphawod-d1f2f" ||
    !/^[0-9a-f]{40}$/.test(deployment.sourceCommit || "") ||
    deployment.compatibilitySourceSha256 !==
      sourceSha256("functions/src/membership.ts") ||
    typeof deployment.stripeWebhookRevision !== "string" ||
    deployment.stripeWebhookRevision.trim().length < 8 ||
    typeof deployment.reconcilePastDueMembershipsRevision !== "string" ||
    deployment.reconcilePastDueMembershipsRevision.trim().length < 8 ||
    !isIsoTimestamp(deploymentCompletedAt) ||
    reconciliation?.eventId !== BLOCKED_STRIPE_EVENT_ID ||
    reconciliation.eventCreated !== BLOCKED_STRIPE_EVENT_CREATED ||
    reconciliation.invoiceId !== BLOCKED_STRIPE_INVOICE_ID ||
    reconciliation.subscriptionIdSha256 !==
      BLOCKED_STRIPE_SUBSCRIPTION_SHA256 ||
    reconciliation.eventAndCustomerStateSafelyReconciled !== true ||
    reconciliation.reconciliationFunction !== "reconcilePastDueMemberships" ||
    reconciliation.reconciliationFunctionRevision !==
      deployment.reconcilePastDueMembershipsRevision ||
    reconciliation.applicationLedgerState !== "dead_letter" ||
    reconciliation.applicationLedgerResolution !==
      "authoritative_state_reconciled" ||
    reconciliation.resolutionAuditId !== LEGACY_RECOVERY_AUDIT_ID ||
    reconciliation.membershipProviderContractStatus !== "verified" ||
    reconciliation.firstPaymentRecorded !== true ||
    reconciliation.firstPaidInvoiceId !== BLOCKED_STRIPE_INVOICE_ID ||
    reconciliation.legacyPresaleDiscountRecoveryVersion !== 1 ||
    !isIsoTimestamp(reconciliationCompletedAt) ||
    acknowledgement?.eventId !== BLOCKED_STRIPE_EVENT_ID ||
    acknowledgement.handler !== "stripeWebhook" ||
    acknowledgement.handlerRevision !== deployment.stripeWebhookRevision ||
    acknowledgement.httpStatus !== 200 ||
    acknowledgement.disposition !==
      "accepted_for_manual_review_after_reconciliation" ||
    !isIsoTimestamp(acknowledgement.completedAt) ||
    readback?.stripeAccountId !== LIVE_STRIPE_ACCOUNT_ID ||
    readback.stripeMode !== "live" ||
    readback.deliverySuccess !== false ||
    readback.windowStart !== LIVE_STRIPE_BACKLOG_WINDOW_START ||
    !isIsoTimestamp(readback.windowEnd) ||
    readback.paginationComplete !== true ||
    !Number.isInteger(readback.pagesRead) || readback.pagesRead < 1 ||
    readback.unsuccessfulEventCount !== 0 ||
    !Array.isArray(readback.events) || readback.events.length !== 0 ||
    !isIsoTimestamp(readbackCompletedAt) ||
    Date.parse(reconciliationCompletedAt) < Date.parse(deploymentCompletedAt) ||
    Date.parse(acknowledgement.completedAt) <
      Date.parse(reconciliationCompletedAt) ||
    Date.parse(readbackCompletedAt) < Date.parse(acknowledgement.completedAt) ||
    readback.windowEnd !== readbackCompletedAt ||
    Date.parse(readback.windowStart) > BLOCKED_STRIPE_EVENT_CREATED * 1000 ||
    Date.parse(readback.windowEnd) < BLOCKED_STRIPE_EVENT_CREATED * 1000 ||
    cleared.customerPiiRecorded !== false) {
    throw new Error(
      "Cleared Stripe delivery backlog needs compatible deployment, exact " +
      "reconciliation and a complete zero-event live readback."
    );
  }
}

function paygRedactionImplemented() {
  const source = fs.readFileSync(
    path.join(root, "functions/src/payg.ts"),
    "utf8"
  );
  const match = source.match(/PAYG_PII_REDACTION_IMPLEMENTED\s*=\s*(true|false)/);
  if (!match) throw new Error("PAYG PII redaction implementation marker is missing.");
  return match[1] === "true";
}

function verifyConditioningPaygReleaseCandidate() {
  console.log("PASS static: running offline release verifiers (no deploy, no network). ");
  verifyBillingMonitoring();
  verifyBillingWebhookEvents();
  verifyConditioningPaygDeployment();

  const readiness = JSON.parse(fs.readFileSync(readinessPath, "utf8"));
  if (readiness.schemaVersion !== 1 ||
    readiness.verificationMode !== "read-only-no-deploy" ||
    readiness.release !== "adult-conditioning-and-payg" ||
    readiness.productionGatesExpectedClosed !== true) {
    throw new Error("Release-readiness manifest does not preserve the no-deploy boundary.");
  }
  assertSameValues(
    readiness.ownerDecisions.map((item) => item.id),
    EXPECTED_OWNER_DECISIONS,
    "Owner decision list"
  );
  assertSameValues(
    readiness.operationalEvidence.map((item) => item.id),
    EXPECTED_OPERATIONAL_EVIDENCE,
    "Operational evidence list"
  );
  assertEvidence(readiness.ownerDecisions, "approved", "Owner decisions");
  assertEvidence(readiness.operationalEvidence, "verified", "Operational evidence");
  assertPartialEvidence(readiness.ownerDecisions, "approved");
  assertPartialEvidence(readiness.operationalEvidence, "verified");
  assertPaygRetentionOwnerEvidence(readiness.ownerDecisions);
  assertLiveStripeDeliveryBacklogEvidence(readiness.operationalEvidence);

  const engineeringBlockers = [];
  if (!paygRedactionImplemented()) {
    engineeringBlockers.push("payg-pii-redaction-implementation");
  }
  const ownerBlockers = readiness.ownerDecisions
    .filter((item) => !item.approved)
    .map((item) => item.id);
  const operationalBlockers = readiness.operationalEvidence
    .filter((item) => !item.verified)
    .map((item) => item.id);

  console.log("PASS static: manifests, source coverage, runbooks and closed gates agree.");
  for (const blocker of engineeringBlockers) {
    console.log(`BLOCKED_BY_ENGINEERING ${blocker}`);
  }
  for (const blocker of ownerBlockers) {
    console.log(`BLOCKED_BY_OWNER ${blocker}`);
  }
  for (const blocker of operationalBlockers) {
    console.log(`BLOCKED_BY_OPERATIONS ${blocker}`);
  }
  if (engineeringBlockers.length || ownerBlockers.length || operationalBlockers.length) {
    process.exitCode = 2;
    return {ready: false, engineeringBlockers, ownerBlockers, operationalBlockers};
  }
  console.log("PASS RELEASE_CANDIDATE_READY_WITH_GATES_CLOSED");
  return {ready: true, engineeringBlockers, ownerBlockers, operationalBlockers};
}

if (require.main === module) {
  try {
    verifyConditioningPaygReleaseCandidate();
  } catch (error) {
    console.error(`FAIL release-candidate verification: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  assertClearedStripeDeliveryBacklogEvidence,
  assertPartialEvidence,
  verifyConditioningPaygReleaseCandidate,
};
