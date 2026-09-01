const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const crypto = require("node:crypto");

const {
  PAYMENT_FAILED_NOTIFICATION_ROUTE,
  PAYMENT_FAILED_POLICY_ID,
  PAYMENT_FAILED_SIGNAL,
  verifyBillingMonitoring,
} = require("./verifyBillingMonitoring");
const {
  PAYG_REQUIRED_EVENTS,
  verifyBillingWebhookEvents,
} = require("./verifyBillingWebhookEvents");
const {
  assertClearedStripeDeliveryBacklogEvidence,
  assertPartialEvidence,
} = require("./verifyConditioningPaygReleaseCandidate");

const root = path.resolve(__dirname, "..");

test("monitoring covers every explicit PAYG runtime error signal", () => {
  assert.doesNotThrow(() => verifyBillingMonitoring());
});

test("each failed membership payment immediately routes a PII-free signal to owner email", () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(root, "ops/monitoring/billing-alerts.json"),
    "utf8"
  ));
  const policy = manifest.policies.find(({id}) => id === PAYMENT_FAILED_POLICY_ID);
  assert.deepEqual(policy.sourceSignals, [PAYMENT_FAILED_SIGNAL]);
  assert.equal(policy.priority, "page");
  assert.equal(policy.windowSeconds, 60);
  assert.equal(policy.threshold, 1);
  assert.equal(policy.notificationRoute, PAYMENT_FAILED_NOTIFICATION_ROUTE);
  assert.match(policy.cloudLoggingFilter, /severity>=WARNING/);
});

test("webhook manifest includes PAYG refund and dispute convergence", () => {
  assert.doesNotThrow(() => verifyBillingWebhookEvents());
  const manifest = JSON.parse(fs.readFileSync(
    path.join(root, "ops/stripe/billing-webhook-events.json"),
    "utf8"
  ));
  for (const event of PAYG_REQUIRED_EVENTS) {
    assert.ok(manifest.requiredEvents.includes(event), event);
  }
  assert.equal(manifest.requiredEvents.length, 18);
});

test("release readiness remains read-only with every production gate closed", () => {
  const readiness = JSON.parse(fs.readFileSync(
    path.join(root, "ops/release/conditioning-payg-readiness.json"),
    "utf8"
  ));
  assert.equal(readiness.verificationMode, "read-only-no-deploy");
  assert.equal(readiness.productionGatesExpectedClosed, true);
  assert.ok(readiness.ownerDecisions.some((decision) => !decision.approved));
  assert.ok(readiness.operationalEvidence.some((check) => !check.verified));
});

test("live Stripe delivery backlog remains an explicit release blocker", () => {
  const readiness = JSON.parse(fs.readFileSync(
    path.join(root, "ops/release/conditioning-payg-readiness.json"),
    "utf8"
  ));
  const blocker = readiness.operationalEvidence.find(
    ({id}) => id === "live-stripe-delivery-backlog-cleared"
  );
  assert.equal(blocker?.verified, false);
  assert.equal(blocker?.evidence, null);
  const pending = JSON.parse(fs.readFileSync(
    path.join(root, blocker.partialEvidence),
    "utf8"
  ));
  assert.equal(pending.readback.unsuccessfulEventCount, 1);
  assert.equal(pending.readback.events[0].pendingWebhooks, 1);
  assert.equal(pending.applicationLedger.state, "dead-lettered");
  assert.equal(pending.customerPiiRecorded, false);
  assert.equal(pending.amountRecorded, false);
  assert.equal(pending.subscriptionIdRecorded, false);
  assert.equal(pending.remediationRequired.zeroUnsuccessfulEventsReadback, false);
  assert.equal(pending.deploymentPerformed, false);
});

test("cleared Stripe backlog evidence binds deployment, reconciliation and full live readback", () => {
  const sourceSha256 = crypto.createHash("sha256")
    .update(fs.readFileSync(path.join(root, "functions/src/membership.ts")))
    .digest("hex");
  const valid = {
    schemaVersion: 2,
    evidenceType: "stripe-live-delivery-backlog-cleared-readback",
    deployment: {
      compatibleCodeDeployed: true,
      environment: "production",
      firebaseProjectId: "alphawod-d1f2f",
      sourceCommit: "a".repeat(40),
      compatibilitySourceSha256: sourceSha256,
      stripeWebhookRevision: "stripewebhook-00042-abc",
      reconcilePastDueMembershipsRevision:
        "reconcilepastduememberships-00042-def",
      completedAt: "2026-09-01T10:00:00.000Z",
    },
    reconciliation: {
      eventId: "evt_1UAgFqFzNDZoGGA0UDdTWXmb",
      eventCreated: 1788225169,
      invoiceId: "in_1UAfI7FzNDZoGGA0axkViBtH",
      subscriptionIdSha256:
        "603678ab7502208430a4b7ce131e220ece946adccca58e35d28baca51e27386a",
      eventAndCustomerStateSafelyReconciled: true,
      reconciliationFunction: "reconcilePastDueMemberships",
      reconciliationFunctionRevision:
        "reconcilepastduememberships-00042-def",
      applicationLedgerState: "dead_letter",
      applicationLedgerResolution: "authoritative_state_reconciled",
      resolutionAuditId:
        "legacy-presale-discount-recovery-in_1UAfI7FzNDZoGGA0axkViBtH",
      membershipProviderContractStatus: "verified",
      firstPaymentRecorded: true,
      firstPaidInvoiceId: "in_1UAfI7FzNDZoGGA0axkViBtH",
      legacyPresaleDiscountRecoveryVersion: 1,
      completedAt: "2026-09-01T10:10:00.000Z",
    },
    deliveryAcknowledgement: {
      eventId: "evt_1UAgFqFzNDZoGGA0UDdTWXmb",
      handler: "stripeWebhook",
      handlerRevision: "stripewebhook-00042-abc",
      httpStatus: 200,
      disposition: "accepted_for_manual_review_after_reconciliation",
      completedAt: "2026-09-01T10:15:00.000Z",
    },
    readback: {
      stripeAccountId: "acct_1Q1PQcFzNDZoGGA0",
      stripeMode: "live",
      deliverySuccess: false,
      windowStart: "2026-08-25T00:00:00.000Z",
      windowEnd: "2026-09-01T10:20:00.000Z",
      paginationComplete: true,
      pagesRead: 1,
      unsuccessfulEventCount: 0,
      events: [],
      completedAt: "2026-09-01T10:20:00.000Z",
    },
    customerPiiRecorded: false,
  };
  assert.doesNotThrow(() => assertClearedStripeDeliveryBacklogEvidence(valid));

  const unsafeMutations = [
    (evidence) => { evidence.deployment.compatibilitySourceSha256 = "0".repeat(64); },
    (evidence) => { evidence.reconciliation.firstPaidInvoiceId = "in_other"; },
    (evidence) => { evidence.reconciliation.applicationLedgerState = "processed"; },
    (evidence) => { evidence.deliveryAcknowledgement.handlerRevision = "other-revision"; },
    (evidence) => { evidence.readback.paginationComplete = false; },
    (evidence) => {
      evidence.readback.windowStart = "2026-09-01T02:00:00.000Z";
    },
    (evidence) => {
      evidence.readback.windowEnd = "2026-09-01T09:00:00.000Z";
      evidence.readback.completedAt = "2026-09-01T09:00:00.000Z";
    },
  ];
  for (const mutate of unsafeMutations) {
    const unsafe = JSON.parse(JSON.stringify(valid));
    mutate(unsafe);
    assert.throws(
      () => assertClearedStripeDeliveryBacklogEvidence(unsafe),
      /compatible deployment, exact reconciliation/
    );
  }
});

test("approved owner decisions cannot retain partial evidence", () => {
  assert.throws(
    () => assertPartialEvidence([
      {id: "owner-decision", approved: true, partialEvidence: "stale.json"},
    ], "approved"),
    /must remove partial evidence/
  );
});

test("owner-approved PAYG retention evidence is exact without claiming legal approval", () => {
  const readiness = JSON.parse(fs.readFileSync(
    path.join(root, "ops/release/conditioning-payg-readiness.json"),
    "utf8"
  ));
  const decision = readiness.ownerDecisions.find(
    (item) => item.id === "payg-pii-retention-and-redaction-policy"
  );
  assert.equal(decision?.approved, true);
  const evidence = JSON.parse(fs.readFileSync(
    path.join(root, decision.evidence),
    "utf8"
  ));
  assert.equal(evidence.policy.abandonedUnpaidIntent.retentionDays, 30);
  assert.equal(evidence.policy.paidOrderAfterClassEnd.retentionDays, 90);
  assert.equal(evidence.policy.waiverIdentityAfterClassEnd.retentionDays, 2190);
  assert.equal(evidence.policy.execution.bounded, true);
  assert.equal(evidence.policy.execution.resumable, true);
  assert.equal(evidence.policy.execution.idempotent, true);
  assert.equal(evidence.legalReviewStatus, "pending");
  assert.equal(evidence.customerFacingDocumentsApproved, false);
  assert.equal(evidence.deploymentAuthorized, false);
  assert.equal(evidence.productionGatesRemainClosed, true);
});
