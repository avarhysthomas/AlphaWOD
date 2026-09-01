const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
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
  assertEvidence,
  assertOperationalEvidenceContent,
  assertOperationalGateSpecificContent,
  assertPaygPrivacyOwnerDecision,
  assertPartialEvidence,
  assertRecordedBrowserEvidence,
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
  assert.ok(readiness.ownerDecisions.every((decision) => decision.approved));
  assert.ok(readiness.operationalEvidence.some((check) => !check.verified));
});

test("recorded Stripe/browser evidence stays PII-free and partial", () => {
  const readiness = JSON.parse(fs.readFileSync(
    path.join(root, "ops/release/conditioning-payg-readiness.json"),
    "utf8"
  ));
  assert.doesNotThrow(
    () => assertRecordedBrowserEvidence(readiness.operationalEvidence)
  );

  const conditioning = JSON.parse(fs.readFileSync(path.join(
    root,
    "ops/release/evidence/conditioning-stripe-test-and-local-browser-2026-09-01.json"
  ), "utf8"));
  const payg = JSON.parse(fs.readFileSync(path.join(
    root,
    "ops/release/evidence/payg-stripe-test-browser-purchase-2026-09-01.json"
  ), "utf8"));
  assert.equal(conditioning.customerPiiRecorded, false);
  assert.equal(conditioning.stripeReadback.confirmationDelivered, false);
  assert.equal(conditioning.localBrowserRerun.newStripeRequestPerformed, false);
  assert.equal(
    conditioning.releaseGateAssessment.fullConditioningOperationalGateVerified,
    false
  );
  assert.equal(payg.customerPiiRecorded, false);
  assert.equal(payg.localApplicationReadback.confirmationEmailDelivered, false);
  assert.equal(payg.releaseGateAssessment.refundVerified, false);
  assert.equal(payg.releaseGateAssessment.disputeVerified, false);
  assert.equal(payg.releaseGateAssessment.fullPaygOperationalGateVerified, false);
});

test("product terms approval remains separate from publication and runtime binding", () => {
  const readiness = JSON.parse(fs.readFileSync(
    path.join(root, "ops/release/conditioning-payg-readiness.json"),
    "utf8"
  ));
  const decisions = readiness.ownerDecisions.filter(({id}) => [
    "adult-conditioning-product-terms",
    "payg-product-terms-and-waiver",
  ].includes(id));
  assert.equal(decisions.length, 2);
  assert.ok(decisions.every(({approved}) => approved));
  assert.equal(decisions[0].evidence, decisions[1].evidence);
  const publication = readiness.operationalEvidence.find(
    ({id}) => id === "product-legal-publication-and-runtime-binding"
  );
  assert.equal(publication?.verified, false);
  assert.equal(publication?.evidence, null);
  assert.equal(
    publication?.partialEvidence,
    "ops/release/evidence/payg-privacy-runtime-binding-readiness-2026-09-01.json"
  );
  assert.deepEqual(publication?.supportingEvidence, [
    decisions[0].evidence,
    "ops/release/evidence/payg-privacy-notice-owner-approval-2026-09-01.json",
  ]);
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

test("cleared Stripe backlog uses its schema-v2 operational evidence envelope", () => {
  const evidence = {
    schemaVersion: 2,
    evidenceType: "stripe-live-delivery-backlog-cleared-readback",
    readinessItemId: "live-stripe-delivery-backlog-cleared",
    verified: true,
    newProductPurchaseGatesRemainClosed: true,
    customerPiiRecorded: false,
    recordedAt: "2026-09-01T10:20:00.000Z",
    verifiedControls: [
      "compatible-code-deployed",
      "exact-event-reconciled",
      "redelivery-acknowledged",
      "zero-unsuccessful-events-full-readback",
    ],
  };
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "release-evidence-"));
  const evidenceFile = path.join(tempDirectory, "cleared.json");
  fs.writeFileSync(evidenceFile, `${JSON.stringify(evidence)}\n`);
  const evidenceSha256 = crypto.createHash("sha256")
    .update(fs.readFileSync(evidenceFile))
    .digest("hex");
  const item = {
    id: "live-stripe-delivery-backlog-cleared",
    evidenceSha256,
  };
  assert.doesNotThrow(
    () => assertOperationalEvidenceContent(item, evidence, evidenceFile)
  );

  const stale = {...evidence, schemaVersion: 1};
  fs.writeFileSync(evidenceFile, `${JSON.stringify(stale)}\n`);
  assert.throws(
    () => assertOperationalEvidenceContent(item, stale, evidenceFile),
    /unbound, incomplete or stale/
  );
});

test("pending operational gates require concrete journey, drill, and publication results", () => {
  const legalDocumentKeys = [
    "adultConditioningAddendum",
    "paygPrivacyNotice",
    "paygTerms",
    "paygWaiver",
  ];
  const legalContents = Object.fromEntries(legalDocumentKeys.map((key) => [
    key,
    Buffer.from(`Immutable ${key} publication\n`, "utf8"),
  ]));
  const legalManifestDocuments = Object.fromEntries(legalDocumentKeys.map((key) => {
    const version = `ZAF-${key.toUpperCase()}-2026-09-01-01`;
    const bytes = legalContents[key];
    return [key, {
      version,
      filename: `${version}.txt`,
      publicUrl: `/legal/products/${version}.txt`,
      bytes: bytes.length,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      approvedForPublication: true,
    }];
  }));
  const legalManifest = {
    approvedForPublication: true,
    productionPurchaseGatesRemainClosed: true,
    ownerDecisions: {paygPrivacyNoticeApproved: true},
    documents: legalManifestDocuments,
  };
  const cases = [
    {
      id: "conditioning-stripe-test-purchase-to-booking-journey",
      evidence: {
        stripeMode: "test",
        planKey: "adult_conditioning",
        amountPence: 3000,
        providerReferences: {
          checkoutSessionId: "cs_test_conditioning",
          subscriptionId: "sub_conditioning",
          webhookEventId: "evt_conditioning",
        },
        applicationReferences: {membershipId: "membership_conditioning"},
        verification: {
          hostedCheckoutCompleted: true,
          webhookAcknowledged: true,
          membershipCreated: true,
          entitlementActivated: true,
          limitedAppAccessVerified: true,
          twoClassesPerLondonWeekEnforced: true,
          flexibleEligibleClassChangesVerified: true,
          confirmationDelivered: true,
        },
        liveProviderMutation: false,
      },
      invalidate: (evidence) => {
        evidence.verification.twoClassesPerLondonWeekEnforced = false;
      },
    },
    {
      id: "payg-stripe-test-purchase-refund-dispute-email-journey",
      evidence: {
        stripeMode: "test",
        productKey: "adult_payg_class",
        amountPence: 700,
        accountRequired: false,
        providerReferences: {
          checkoutSessionId: "cs_test_payg",
          paymentIntentId: "pi_payg",
          refundId: "re_payg",
          disputeId: "dp_payg",
        },
        applicationReferences: {guestBookingId: "booking_payg"},
        verification: {
          hostedCheckoutCompleted: true,
          paidWebhookCreatedBooking: true,
          confirmationEmailDelivered: true,
          refundConverged: true,
          refundEmailDelivered: true,
          disputeConverged: true,
          disputeEmailDelivered: true,
          noAccountJourneyVerified: true,
        },
        liveProviderMutation: false,
      },
      invalidate: (evidence) => {
        evidence.providerReferences.disputeId = "missing";
      },
    },
    {
      id: "class-cancellation-quota-and-payg-refund-drill",
      evidence: {
        environment: "isolated-test",
        timezone: "Europe/London",
        conditioningWeeklyBookingLimit: 2,
        paygCancellationCutoffHours: 24,
        drillReferences: {
          conditioningMemberIdHash: "a".repeat(64),
          paygOrderId: "payg_order_test",
        },
        verification: {
          thirdConditioningBookingRejected: true,
          eligibleCancellationReleasedQuota: true,
          replacementConditioningBookingSucceeded: true,
          refundAtOrBeforeCutoffSucceeded: true,
          insideCutoffStayedNonRefundable: true,
          noShowStayedNonRefundable: true,
          paygBookingNeverBecameCredit: true,
          refundedCapacityReleased: true,
        },
        liveProviderMutation: false,
        observedByRole: "Zero Alpha Fitness operations",
      },
      invalidate: (evidence) => {
        evidence.verification.noShowStayedNonRefundable = false;
      },
    },
    {
      id: "product-legal-publication-and-runtime-binding",
      evidence: {
        productionOrigin: "https://alpha-wod.vercel.app",
        documents: legalDocumentKeys.map((key) => ({
          key,
          version: legalManifestDocuments[key].version,
          bytes: legalManifestDocuments[key].bytes,
          sha256: legalManifestDocuments[key].sha256,
          publicUrl: legalManifestDocuments[key].publicUrl,
        })),
        deployment: {
          environment: "production",
          sourceCommit: "c".repeat(40),
          completedAt: "2026-09-01T12:00:00.000Z",
          adultConditioningPurchaseEnabled: false,
          paygAvailabilityEnabled: false,
          paygLegalApproved: false,
        },
        verification: {
          http200Utf8ExactBytes: true,
          manifestHashesMatched: true,
          runtimeVersionUrlHashBindingsMatched: true,
          deployedReadbackMatched: true,
          privacyNoticeShownBeforePersonalData: true,
          privacyNoticeTreatedAsConsent: false,
          allNewProductGatesStayedClosed: true,
        },
      },
      options: {
        publicationManifest: legalManifest,
        readPublishedDocument: (_entry, key) => legalContents[key],
      },
      invalidate: (evidence) => {
        evidence.documents[1].sha256 = "b".repeat(64);
      },
    },
  ];

  for (const gate of cases) {
    assert.doesNotThrow(
      () => assertOperationalGateSpecificContent(
        gate,
        gate.evidence,
        gate.options
      ),
      gate.id
    );
    const invalid = JSON.parse(JSON.stringify(gate.evidence));
    gate.invalidate(invalid);
    assert.throws(
      () => assertOperationalGateSpecificContent(gate, invalid, gate.options),
      /failed its content validator/,
      gate.id
    );
  }

  const legalGate = cases.find(
    ({id}) => id === "product-legal-publication-and-runtime-binding"
  );
  assert.throws(
    () => assertOperationalGateSpecificContent(legalGate, legalGate.evidence),
    /failed its content validator/,
    "synthetic evidence cannot claim the checked-in final document bytes"
  );
});

test("approved owner decisions cannot retain partial evidence", () => {
  assert.throws(
    () => assertPartialEvidence([
      {id: "owner-decision", approved: true, partialEvidence: "stale.json"},
    ], "approved"),
    /must remove partial evidence/
  );
});

test("PAYG Privacy Notice owner approval binds the exact draft and final", () => {
  const approved = {
    id: "payg-privacy-notice",
    approved: true,
    evidence:
      "ops/release/evidence/payg-privacy-notice-owner-approval-2026-09-01.json",
  };
  assert.doesNotThrow(() => assertPaygPrivacyOwnerDecision([approved]));
  assert.throws(
    () => assertPaygPrivacyOwnerDecision([{
      ...approved,
      evidence: "ops/release/evidence/bogus.json",
    }]),
    /stale or unsafe/
  );
});

test("verified operational gates require bound, typed and hashed evidence", () => {
  const readiness = JSON.parse(fs.readFileSync(
    path.join(root, "ops/release/conditioning-payg-readiness.json"),
    "utf8"
  ));
  const verified = readiness.operationalEvidence.filter(({verified: value}) => value);
  assert.doesNotThrow(
    () => assertEvidence(verified, "verified", "Operational evidence")
  );

  const stale = {...verified[0], evidenceSha256: "0".repeat(64)};
  assert.throws(
    () => assertEvidence([stale], "verified", "Operational evidence"),
    /unbound, incomplete or stale/
  );

  const unrelatedSource = verified.find(
    ({id}) => id === "resend-domain-and-confirmation-delivery"
  );
  const unrelated = {
    ...verified[0],
    evidence: unrelatedSource.evidence,
    evidenceSha256: unrelatedSource.evidenceSha256,
  };
  assert.throws(
    () => assertEvidence([unrelated], "verified", "Operational evidence"),
    /unbound, incomplete or stale/
  );

  assert.throws(
    () => assertEvidence([{
      ...verified[0],
      evidence: "ops/release/evidence/does-not-exist.json",
    }], "verified", "Operational evidence"),
    /does not resolve to checked-in evidence/
  );
});

test("verified Stripe webhook and catalogue evidence cannot contradict its summaries", () => {
  const webhook = JSON.parse(fs.readFileSync(path.join(
    root,
    "ops/release/evidence/live-stripe-webhook-exact-event-readback-2026-09-01.json"
  ), "utf8"));
  const catalogue = JSON.parse(fs.readFileSync(path.join(
    root,
    "ops/release/evidence/production-provider-app-check-and-closed-config-readback-2026-09-01.json"
  ), "utf8"));
  assert.doesNotThrow(() => assertOperationalGateSpecificContent(
    {id: "live-stripe-webhook-exact-event-readback"},
    webhook
  ));
  assert.doesNotThrow(() => assertOperationalGateSpecificContent(
    {id: "live-product-catalogue-and-closed-config-readback"},
    catalogue
  ));

  const wrongEvents = JSON.parse(JSON.stringify(webhook));
  wrongEvents.endpoint.enabledEvents[0] = "account.updated";
  assert.throws(
    () => assertOperationalGateSpecificContent(
      {id: "live-stripe-webhook-exact-event-readback"},
      wrongEvents
    ),
    /failed its content validator/
  );

  const wrongPrice = JSON.parse(JSON.stringify(catalogue));
  wrongPrice.stripeCatalogue.payg.priceId = "price_wrong";
  assert.throws(
    () => assertOperationalGateSpecificContent(
      {id: "live-product-catalogue-and-closed-config-readback"},
      wrongPrice
    ),
    /failed its content validator/
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
