const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {verifyBillingMonitoring} = require("./verifyBillingMonitoring");
const {
  PAYG_REQUIRED_EVENTS,
  verifyBillingWebhookEvents,
} = require("./verifyBillingWebhookEvents");

const root = path.resolve(__dirname, "..");

test("monitoring covers every explicit PAYG runtime error signal", () => {
  assert.doesNotThrow(() => verifyBillingMonitoring());
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
