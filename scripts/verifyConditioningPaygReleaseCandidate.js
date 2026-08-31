/* eslint-disable no-console */

/**
 * Offline, read-only release-candidate gate. It reads checked-in files and runs
 * pure static verifiers only: no Firebase, Stripe, Vercel or email API is
 * contacted and no local/remote state is mutated.
 */

const fs = require("node:fs");
const path = require("node:path");
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
  "live-stripe-webhook-exact-event-readback",
  "payg-stripe-test-purchase-refund-dispute-email-journey",
  "resend-domain-and-confirmation-delivery",
]);
const PAYG_RETENTION_DECISION_ID =
  "payg-pii-retention-and-redaction-policy";
const PAYG_RETENTION_POLICY_VERSION =
  "ZAF-PAYG-PII-RETENTION-2026-08-31-01";

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

function assertPartialEvidence(items) {
  for (const item of items) {
    if (item.partialEvidence === undefined) continue;
    if (item.verified) {
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
  assertPartialEvidence(readiness.operationalEvidence);
  assertPaygRetentionOwnerEvidence(readiness.ownerDecisions);

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
  verifyConditioningPaygReleaseCandidate,
};
