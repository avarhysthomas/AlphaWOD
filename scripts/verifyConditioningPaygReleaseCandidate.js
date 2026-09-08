/* eslint-disable no-console */

/**
 * Offline, read-only release-candidate gate. It reads checked-in files and runs
 * pure static verifiers only: no Firebase, Stripe, Vercel or email API is
 * contacted and no local/remote state is mutated.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {isDeepStrictEqual} = require("node:util");
const {verifyBillingMonitoring} = require("./verifyBillingMonitoring");
const {
  verifyBillingWebhookEvents,
} = require("./verifyBillingWebhookEvents");
const {
  verifyConditioningPaygDeployment,
} = require("./verifyConditioningPaygDeployment");
const {
  verifyApprovedProductLegalDocuments,
} = require("./verifyApprovedProductLegalDocuments");

const root = path.resolve(__dirname, "..");
const readinessPath = path.join(
  root,
  "ops/release/conditioning-payg-readiness.json"
);

const EXPECTED_OWNER_DECISIONS = Object.freeze([
  "adult-conditioning-product-terms",
  "payg-privacy-notice",
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
  "production-access-tier-backfill-and-claims-readback",
  "product-legal-publication-and-runtime-binding",
  "resend-domain-and-confirmation-delivery",
]);
const OPERATIONAL_EVIDENCE_REQUIREMENTS = Object.freeze({
  "billing-alert-policies-and-staffed-notification-route": Object.freeze({
    evidenceType: "gcp-billing-and-payg-alert-policy-suite",
    verifiedControls: Object.freeze([
      "nine-policies-enabled",
      "primary-route-delivery-acknowledged",
      "independent-backup-route-delivery-acknowledged",
      "named-primary-responder",
      "named-backup-responder",
    ]),
  }),
  "class-cancellation-quota-and-payg-refund-drill": Object.freeze({
    evidenceType: "class-cancellation-quota-and-payg-refund-drill",
    verifiedControls: Object.freeze([
      "conditioning-quota-cancel-rebook-verified",
      "conditioning-late-cancel-quota-verified",
      "payg-refund-over-24h-verified",
      "payg-no-refund-under-24h-verified",
      "payg-capacity-released-after-refund",
      "ordered-whole-class-cancellation-and-booking-stop",
      "authorised-absence-release-for-every-conditioning-booking",
      "all-admission-roster-and-cleanup-mutations-blocked-after-freeze",
      "unpaid-payg-holds-and-duplicate-locks-reconciled",
      "exact-provider-terminal-state-required-before-finalize",
      "ambiguous-payment-and-review-state-blocked-finalize",
      "all-payg-orders-inventoried-and-operation-bound",
      "paid-payg-guest-identification-and-provider-refund-reconciliation",
      "confirmation-suppression-or-correction-resolved-before-finalize",
      "bound-idempotent-operations-audit",
    ]),
  }),
  "conditioning-stripe-test-purchase-to-booking-journey": Object.freeze({
    evidenceType: "stripe-test-membership-checkout",
    verifiedControls: Object.freeze([
      "stripe-test-checkout-completed",
      "webhook-membership-created",
      "membership-entitlement-active",
      "purchased-member-app-booking",
      "two-per-week-enforced",
      "confirmation-delivered",
    ]),
  }),
  "live-product-catalogue-and-closed-config-readback": Object.freeze({
    evidenceType: "production-provider-app-check-and-closed-config-readback",
    verifiedControls: Object.freeze([
      "stripe-live-catalogue-verified",
      "payg-price-700-gbp",
      "app-check-provider-bound",
      "secrets-versioned-without-values",
      "new-product-gates-closed",
    ]),
  }),
  "live-stripe-delivery-backlog-cleared": Object.freeze({
    schemaVersion: 2,
    evidenceType: "stripe-live-delivery-backlog-cleared-readback",
    verifiedControls: Object.freeze([
      "compatible-code-deployed",
      "exact-event-reconciled",
      "redelivery-acknowledged",
      "zero-unsuccessful-events-full-readback",
    ]),
  }),
  "live-stripe-webhook-exact-event-readback": Object.freeze({
    evidenceType: "stripe-live-webhook-exact-event-readback",
    verifiedControls: Object.freeze([
      "live-account-readback",
      "endpoint-enabled",
      "exact-required-event-set",
      "signing-secret-not-recorded",
      "read-only",
    ]),
  }),
  "payg-stripe-test-purchase-refund-dispute-email-journey": Object.freeze({
    evidenceType: "payg-stripe-test-purchase-refund-dispute-email-journey",
    verifiedControls: Object.freeze([
      "stripe-test-checkout-completed",
      "webhook-booking-created",
      "confirmation-delivered",
      "refund-converged",
      "dispute-converged",
      "emails-delivered",
    ]),
  }),
  "production-access-tier-backfill-and-claims-readback": Object.freeze({
    evidenceType: "production-access-tier-backfill-and-claims-readback",
    verifiedControls: Object.freeze([
      "dry-run-reviewed",
      "exact-report-applied",
      "zero-unresolved-users",
      "profiles-read-back",
      "custom-claims-read-back",
      "rules-deployed-after-backfill",
    ]),
  }),
  "product-legal-publication-and-runtime-binding": Object.freeze({
    evidenceType: "product-legal-publication-and-runtime-binding",
    verifiedControls: Object.freeze([
      "immutable-documents-published",
      "runtime-config-bound",
      "closed-gate-deployed",
      "production-readback-matched",
      "privacy-notice-before-personal-data",
    ]),
  }),
  "resend-domain-and-confirmation-delivery": Object.freeze({
    evidenceType: "resend-production-domain-and-confirmation-delivery-readback",
    verifiedControls: Object.freeze([
      "domain-verified",
      "membership-confirmation-delivered",
      "sender-configured",
      "secret-value-not-recorded",
      "recipient-pii-not-recorded",
    ]),
  }),
});
const PAYG_RETENTION_DECISION_ID =
  "payg-pii-retention-and-redaction-policy";
const PAYG_PRIVACY_DECISION_ID = "payg-privacy-notice";
const PAYG_PRIVACY_ENGINEERING_EVIDENCE =
  "ops/release/evidence/payg-privacy-runtime-binding-readiness-2026-09-01.json";
const CONDITIONING_BROWSER_PARTIAL_EVIDENCE =
  "ops/release/evidence/conditioning-stripe-test-full-app-2026-09-02.json";
const PAYG_BROWSER_PARTIAL_EVIDENCE =
  "ops/release/evidence/payg-stripe-test-purchase-refund-dispute-2026-09-02.json";
const BILLING_ALERT_PARTIAL_EVIDENCE =
  "ops/release/evidence/billing-alert-policy-suite-2026-09-01.json";
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

function evidenceSha256(absolutePath) {
  return crypto.createHash("sha256")
    .update(fs.readFileSync(absolutePath))
    .digest("hex");
}

function productLegalPublicationDocumentsMatch(
  evidence,
  {
    publicationManifest = null,
    readPublishedDocument = null,
  } = {}
) {
  try {
    const manifest = publicationManifest ?? JSON.parse(fs.readFileSync(
      path.join(root, "public/legal/products/manifest.json"),
      "utf8"
    ));
    const readDocument = readPublishedDocument ?? ((entry) =>
      fs.readFileSync(path.join(root, "public/legal/products", entry.filename))
    );
    const expectedKeys = [
      "adultConditioningAddendum",
      "paygPrivacyNotice",
      "paygTerms",
      "paygWaiver",
    ];
    const manifestKeys = Object.keys(manifest.documents ?? {}).sort();
    const evidenceDocuments = Array.isArray(evidence.documents) ?
      evidence.documents : [];
    const evidenceKeys = evidenceDocuments.map(({key}) => key).sort();
    if (manifest.approvedForPublication !== true ||
      manifest.productionPurchaseGatesRemainClosed !== true ||
      manifest.ownerDecisions?.paygPrivacyNoticeApproved !== true ||
      JSON.stringify(manifestKeys) !== JSON.stringify(expectedKeys) ||
      JSON.stringify(evidenceKeys) !== JSON.stringify(expectedKeys) ||
      evidenceDocuments.length !== expectedKeys.length) {
      return false;
    }
    return expectedKeys.every((key) => {
      const entry = manifest.documents[key];
      const recorded = evidenceDocuments.find((document) => document.key === key);
      if (!entry || !recorded || entry.approvedForPublication !== true ||
        entry.filename !== `${entry.version}.txt` ||
        entry.publicUrl !== `/legal/products/${entry.filename}` ||
        !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0 ||
        !/^[a-f0-9]{64}$/.test(entry.sha256 || "") ||
        recorded.version !== entry.version || recorded.bytes !== entry.bytes ||
        recorded.sha256 !== entry.sha256 ||
        recorded.publicUrl !== entry.publicUrl) {
        return false;
      }
      const bytes = readDocument(entry, key);
      return Buffer.isBuffer(bytes) && bytes.length === entry.bytes &&
        crypto.createHash("sha256").update(bytes).digest("hex") === entry.sha256;
    });
  } catch {
    return false;
  }
}

function assertOperationalGateSpecificContent(item, evidence, options = {}) {
  let valid = true;
  switch (item.id) {
    case "live-stripe-webhook-exact-event-readback":
      {
        const webhookManifest = JSON.parse(fs.readFileSync(
          path.join(root, "ops/stripe/billing-webhook-events.json"),
          "utf8"
        ));
        const expectedEvents = [...(webhookManifest.requiredEvents ?? [])].sort();
        const configuredEvents = Array.isArray(evidence.endpoint?.enabledEvents) ?
          [...evidence.endpoint.enabledEvents].sort() : [];
        valid = evidence.stripeMode === "live" &&
          evidence.endpoint?.status === "enabled" &&
          configuredEvents.length === expectedEvents.length &&
          JSON.stringify(configuredEvents) === JSON.stringify(expectedEvents) &&
          evidence.verification?.expectedEventCount === 18 &&
          evidence.verification?.configuredEventCount === 18 &&
          evidence.verification?.exactSetMatch === true &&
          evidence.verification?.signingSecretValueRecorded === false &&
          evidence.readbackMutation === false &&
          evidence.deploymentPerformed === false;
      }
      break;
    case "live-product-catalogue-and-closed-config-readback":
      valid = evidence.firebaseProjectId === "alphawod-d1f2f" &&
        evidence.stripeCatalogue?.mode === "live" &&
        evidence.stripeCatalogue?.recurringCatalogueExactMatch === true &&
        evidence.stripeCatalogue?.payg?.productId ===
          "prod_VAOGG2ZsBQ65Qt" &&
        evidence.stripeCatalogue?.payg?.priceId ===
          "price_1UAmoCFzNDZoGGA0lKDwjbBU" &&
        evidence.stripeCatalogue?.payg?.amountPence === 700 &&
        evidence.stripeCatalogue?.payg?.currency === "gbp" &&
        evidence.stripeCatalogue?.payg?.priceType === "one_time" &&
        evidence.stripeCatalogue?.payg?.active === true &&
        evidence.stripeCatalogue?.payg?.productDefaultPrice === true &&
        evidence.stripeCatalogue?.supersededPaygPrice?.priceId ===
          "price_1UA3TdFzNDZoGGA0dCgYfU2h" &&
        evidence.stripeCatalogue?.supersededPaygPrice?.active === false &&
        evidence.closedNewOfferConfiguration?.adultConditioningPurchaseEnabled ===
          false &&
        evidence.closedNewOfferConfiguration?.adultConditioningLegalApproved ===
          false &&
        evidence.closedNewOfferConfiguration?.paygAvailabilityEnabled === false &&
        evidence.closedNewOfferConfiguration?.paygLegalApproved === false &&
        evidence.firebaseAppCheck?.registrationStatus === "registered" &&
        evidence.firebaseAppCheck?.provider === "reCAPTCHA Enterprise" &&
        evidence.firebaseAppCheck?.allowedDomain === "alpha-wod.vercel.app" &&
        evidence.firebaseAppCheck?.vercelProductionSiteKeyMatchesRegisteredKey ===
          true &&
        evidence.firebaseAppCheck?.siteKeyValueRecorded === false &&
        evidence.firebaseSecretManager?.secretValuesRecorded === false &&
        evidence.productionDeploymentPerformed === false;
      break;
    case "live-stripe-delivery-backlog-cleared":
      // The exact deployment, reconciliation, acknowledgement and full Stripe
      // readback contract is validated by assertClearedStripeDeliveryBacklogEvidence.
      valid = true;
      break;
    case "resend-domain-and-confirmation-delivery":
      valid = evidence.domain?.name === "zeroalphafitness.co.uk" &&
        evidence.domain?.status === "verified" &&
        evidence.configuration?.fromAddress ===
          "hello@zeroalphafitness.co.uk" &&
        evidence.configuration?.secretValueRecorded === false &&
        evidence.deliveryReadback?.productionMembershipConfirmationObserved ===
          true &&
        evidence.deliveryReadback?.providerStatus === "delivered" &&
        evidence.deliveryReadback?.recipientPiiRecorded === false &&
        evidence.readbackMutation === false &&
        evidence.deploymentPerformed === false;
      break;
    case "billing-alert-policies-and-staffed-notification-route":
      valid = evidence.googleCloudProjectId === "alphawod-d1f2f" &&
        evidence.policyCountExpected === 9 &&
        evidence.policyCountVerified === 9 &&
        Array.isArray(evidence.notificationRoutes) &&
        evidence.notificationRoutes.length >= 2 &&
        evidence.notificationRoutes.every((route) =>
          route.enabled === true && route.recipientConfiguredInProvider === true
        ) &&
        new Set(
          evidence.notificationRoutes.map(({providerId}) => providerId)
        ).size >= 2 &&
        evidence.verification?.allManifestPoliciesCreated === true &&
        evidence.verification?.allPoliciesEnabled === true &&
        evidence.verification?.allFiltersMatchCheckedInManifest === true &&
        evidence.verification?.allThresholdWindowsVerified === true &&
        evidence.verification?.primaryEmailAttachedToEveryPolicy === true &&
        evidence.verification?.twoIndependentRoutesAttachedToEveryPolicy === true &&
        evidence.verification?.namedPrimaryAndBackupRosterRecorded === true &&
        evidence.verification?.syntheticDeliveryTestPerformed === true;
      break;
    case "conditioning-stripe-test-purchase-to-booking-journey":
      valid = evidence.stripeMode === "test" &&
        evidence.planKey === "adult_conditioning" &&
        evidence.amountPence === 3000 &&
        /^cs_test_[A-Za-z0-9_]+$/.test(
          evidence.providerReferences?.checkoutSessionId || ""
        ) &&
        /^sub_[A-Za-z0-9_]+$/.test(
          evidence.providerReferences?.subscriptionId || ""
        ) &&
        /^evt_[A-Za-z0-9_]+$/.test(
          evidence.providerReferences?.webhookEventId || ""
        ) &&
        typeof evidence.applicationReferences?.membershipId === "string" &&
        evidence.applicationReferences.membershipId.length >= 8 &&
        evidence.verification?.hostedCheckoutCompleted === true &&
        evidence.verification?.webhookAcknowledged === true &&
        evidence.verification?.membershipCreated === true &&
        evidence.verification?.entitlementActivated === true &&
        evidence.verification?.purchasedMemberAppBookingVerified === true &&
        evidence.verification?.limitedAppAccessVerified === true &&
        evidence.verification?.twoClassesPerLondonWeekEnforced === true &&
        evidence.verification?.flexibleEligibleClassChangesVerified === true &&
        evidence.verification?.confirmationDelivered === true &&
        evidence.liveProviderMutation === false;
      break;
    case "payg-stripe-test-purchase-refund-dispute-email-journey":
      {
        const purchase = evidence.providerScenarios?.purchase;
        const refund = evidence.providerScenarios?.refund;
        const dispute = evidence.providerScenarios?.dispute;
        const application = evidence.applicationReferences;
        const scenarios = [purchase, refund, dispute];
        const orderIds = [
          application?.purchaseOrderId,
          application?.refundOrderId,
          application?.disputeOrderId,
        ];
        const bookingIds = [
          application?.purchaseGuestBookingId,
          application?.refundGuestBookingId,
          application?.disputeGuestBookingId,
        ];
        const applicationBindings = [
          application?.purchaseProviderBinding,
          application?.refundProviderBinding,
          application?.disputeProviderBinding,
        ];
        valid = evidence.stripeMode === "test" &&
          evidence.productKey === "adult_payg_class" &&
          evidence.amountPence === 700 &&
          evidence.currency === "gbp" &&
          evidence.accountRequired === false &&
          scenarios.every((scenario) =>
            scenario?.amountPence === 700 &&
            scenario.currency === "gbp" &&
            scenario.productId === "prod_VAOxXxpax1MuRt" &&
            scenario.priceId === "price_1UAmVVFzNDZoGGA04z8hX10N"
          ) &&
          /^cs_test_[A-Za-z0-9_]+$/.test(
            purchase?.checkoutSessionId || ""
          ) &&
          /^pi_[A-Za-z0-9_]+$/.test(
            purchase?.paymentIntentId || ""
          ) &&
          /^evt_[A-Za-z0-9_]+$/.test(
            purchase?.checkoutCompletedEventId || ""
          ) &&
          /^cs_test_[A-Za-z0-9_]+$/.test(
            refund?.checkoutSessionId || ""
          ) &&
          /^pi_[A-Za-z0-9_]+$/.test(
            refund?.paymentIntentId || ""
          ) &&
          /^re_[A-Za-z0-9_]+$/.test(
            refund?.refundId || ""
          ) &&
          Array.isArray(refund?.webhookEventIds) &&
          refund.webhookEventIds.length >= 1 &&
          refund.webhookEventIds.every((id) =>
            /^evt_[A-Za-z0-9_]+$/.test(id)
          ) &&
          /^cs_test_[A-Za-z0-9_]+$/.test(
            dispute?.checkoutSessionId || ""
          ) &&
          /^pi_[A-Za-z0-9_]+$/.test(
            dispute?.paymentIntentId || ""
          ) &&
          /^du_[A-Za-z0-9_]+$/.test(
            dispute?.disputeId || ""
          ) &&
          /^evt_[A-Za-z0-9_]+$/.test(
            dispute?.webhookEventId || ""
          ) &&
          refund.checkoutSessionId !== dispute.checkoutSessionId &&
          refund.paymentIntentId !== dispute.paymentIntentId &&
          new Set(scenarios.map(({checkoutSessionId}) => checkoutSessionId))
            .size === 3 &&
          new Set(scenarios.map(({paymentIntentId}) => paymentIntentId))
            .size === 3 &&
          orderIds.every((id) =>
            typeof id === "string" && /^payg_[a-f0-9]{64}$/.test(id)
          ) &&
          new Set(orderIds).size === 3 &&
          typeof application?.purchaseGuestBookingId === "string" &&
          application.purchaseGuestBookingId ===
            `payg_guest_${application.purchaseOrderId.slice("payg_".length)}` &&
          typeof application?.refundGuestBookingId === "string" &&
          application.refundGuestBookingId ===
            `payg_guest_${application.refundOrderId.slice("payg_".length)}` &&
          typeof application?.disputeGuestBookingId === "string" &&
          application.disputeGuestBookingId ===
            `payg_guest_${application.disputeOrderId.slice("payg_".length)}` &&
          new Set(bookingIds).size === 3 &&
          applicationBindings.every((binding, index) =>
            binding?.checkoutSessionId === scenarios[index].checkoutSessionId &&
            binding?.paymentIntentId === scenarios[index].paymentIntentId &&
            binding?.orderId === orderIds[index] &&
            binding?.guestBookingId === bookingIds[index]
          ) &&
          evidence.verification?.hostedCheckoutCompleted === true &&
          evidence.verification?.paidWebhookCreatedBooking === true &&
          evidence.verification?.providerApplicationBindingsVerified === true &&
          evidence.verification?.confirmationEmailDelivered === true &&
          evidence.verification?.refundConverged === true &&
          evidence.verification?.refundEmailDelivered === true &&
          evidence.verification?.disputeConverged === true &&
          evidence.verification?.disputeEmailDelivered === true &&
          evidence.verification?.noAccountJourneyVerified === true &&
          evidence.liveProviderMutation === false;
      }
      break;
    case "production-access-tier-backfill-and-claims-readback":
      valid = evidence.firebaseProjectId === "alphawod-d1f2f" &&
        evidence.accessSchemaVersion === 3 &&
        /^[0-9a-f]{40}$/.test(evidence.sourceCommit || "") &&
        /^[a-f0-9]{64}$/.test(evidence.dryRun?.reportSha256 || "") &&
        Number.isSafeInteger(evidence.dryRun?.scannedProfiles) &&
        evidence.dryRun.scannedProfiles >= 0 &&
        Number.isSafeInteger(evidence.dryRun?.scannedAuthUsers) &&
        evidence.dryRun.scannedAuthUsers >= 0 &&
        evidence.dryRun.invalidCount === 0 &&
        evidence.dryRun.missingAuthUsersCount === 0 &&
        evidence.dryRun.incompleteLegacyWaiverCount === 0 &&
        evidence.dryRun.reviewedByRole === "Zero Alpha Fitness operations" &&
        evidence.apply?.approvedReportSha256 ===
          evidence.dryRun.reportSha256 &&
        evidence.apply?.mode === "apply" &&
        isIsoTimestamp(evidence.apply?.completedAt) &&
        evidence.readback?.allProfilesHaveValidAppAccessTier === true &&
        evidence.readback?.allManagedClaimsMatchProfiles === true &&
        evidence.readback?.unresolvedCount === 0 &&
        Number.isSafeInteger(evidence.readback?.profilesVerified) &&
        evidence.readback.profilesVerified === evidence.dryRun.scannedProfiles &&
        evidence.rulesDeployment?.firestoreRulesDeployedAfterApply === true &&
        evidence.rulesDeployment?.storageRulesDeployedAfterApply === true &&
        isIsoTimestamp(evidence.rulesDeployment?.completedAt) &&
        Date.parse(evidence.rulesDeployment.completedAt) >=
          Date.parse(evidence.apply.completedAt);
      break;
    case "class-cancellation-quota-and-payg-refund-drill":
      valid = evidence.environment === "isolated-test" &&
        evidence.timezone === "Europe/London" &&
        evidence.conditioningWeeklyBookingLimit === 2 &&
        evidence.paygCancellationCutoffHours === 24 &&
        typeof evidence.drillReferences?.conditioningMemberIdHash === "string" &&
        /^[a-f0-9]{64}$/.test(
          evidence.drillReferences.conditioningMemberIdHash
        ) &&
        typeof evidence.drillReferences?.paygOrderId === "string" &&
        evidence.drillReferences.paygOrderId.length >= 8 &&
        /^[a-f0-9]{64}$/.test(
          evidence.drillReferences?.conditioningOccurrenceIdHash || ""
        ) &&
        /^[a-f0-9]{64}$/.test(
          evidence.drillReferences?.paygOrderIdsHash || ""
        ) &&
        typeof evidence.drillReferences?.auditRecordId === "string" &&
        evidence.drillReferences.auditRecordId.length >= 8 &&
        evidence.verification?.thirdConditioningBookingRejected === true &&
        evidence.verification?.eligibleCancellationReleasedQuota === true &&
        evidence.verification?.replacementConditioningBookingSucceeded === true &&
        evidence.verification?.refundAtOrBeforeCutoffSucceeded === true &&
        evidence.verification?.insideCutoffStayedNonRefundable === true &&
        evidence.verification?.noShowStayedNonRefundable === true &&
        evidence.verification?.paygBookingNeverBecameCredit === true &&
        evidence.verification?.refundedCapacityReleased === true &&
        evidence.verification?.newBookingsStoppedBeforeWholeClassCancellation ===
          true &&
        evidence.verification?.wholeClassCancelledAfterBookingStop === true &&
        evidence.verification
          ?.everyConditioningBookingMarkedAuthorisedAbsence === true &&
        evidence.verification
          ?.everyConditioningBookingReleasedCapacityAndQuota === true &&
        evidence.verification
          ?.allAdmissionsAndRosterMutationsRejectedAfterFreeze === true &&
        evidence.verification?.memberCleanupSkippedFrozenOccurrence === true &&
        evidence.verification?.unpaidPaygHoldsReleased === true &&
        evidence.verification?.duplicatePaygLocksReconciled === true &&
        evidence.verification
          ?.everyCheckoutProviderStateAuthoritativeBeforeFinalize === true &&
        evidence.verification
          ?.ambiguousCheckoutOrPaymentStateBlockedFinalize === true &&
        evidence.verification?.unknownPaymentReviewBlockedFinalize === true &&
        evidence.verification?.everyPaidPaygGuestIdentifiedBeforeClose === true &&
        evidence.verification
          ?.everyPaygOrderBoundToCancellationOperation === true &&
        evidence.verification?.everyPaidPaygRefundReconciled === true &&
        evidence.verification?.unsentCustomerConfirmationsSuppressed === true &&
        evidence.verification
          ?.acceptedCustomerConfirmationsCorrectedBeforeFinalize === true &&
        evidence.verification?.finalizationAuditBindingVerified === true &&
        evidence.verification?.finalizationIdempotent === true &&
        evidence.verification?.operationsAuditRecordRetained === true &&
        evidence.liveProviderMutation === false &&
        evidence.observedByRole === "Zero Alpha Fitness operations";
      break;
    case "product-legal-publication-and-runtime-binding": {
      valid = evidence.productionOrigin === "https://alpha-wod.vercel.app" &&
        productLegalPublicationDocumentsMatch(evidence, options) &&
        evidence.deployment?.environment === "production" &&
        /^[0-9a-f]{40}$/.test(evidence.deployment?.sourceCommit || "") &&
        isIsoTimestamp(evidence.deployment?.completedAt) &&
        evidence.deployment?.adultConditioningPurchaseEnabled === false &&
        evidence.deployment?.paygAvailabilityEnabled === false &&
        evidence.deployment?.paygLegalApproved === false &&
        evidence.verification?.http200Utf8ExactBytes === true &&
        evidence.verification?.manifestHashesMatched === true &&
        evidence.verification?.runtimeVersionUrlHashBindingsMatched === true &&
        evidence.verification?.deployedReadbackMatched === true &&
        evidence.verification?.privacyNoticeShownBeforePersonalData === true &&
        evidence.verification?.privacyNoticeTreatedAsConsent === false &&
        evidence.verification?.allNewProductGatesStayedClosed === true;
      break;
    }
    default:
      throw new Error(`Operational evidence ${item.id} has no gate validator.`);
  }
  if (!valid) {
    throw new Error(`Operational evidence ${item.id} failed its content validator.`);
  }
}

function assertOperationalEvidenceContent(item, evidence, absolutePath) {
  const requirement = OPERATIONAL_EVIDENCE_REQUIREMENTS[item.id];
  if (!requirement) {
    throw new Error(`Operational evidence ${item.id} has no content validator.`);
  }
  const controls = Array.isArray(evidence?.verifiedControls) ?
    new Set(evidence.verifiedControls) : new Set();
  if (evidence?.schemaVersion !== (requirement.schemaVersion ?? 1) ||
    evidence.evidenceType !== requirement.evidenceType ||
    evidence.readinessItemId !== item.id ||
    evidence.verified !== true ||
    evidence.newProductPurchaseGatesRemainClosed !== true ||
    evidence.customerPiiRecorded !== false ||
    typeof evidence.recordedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(
      evidence.recordedAt
    ) ||
    !Number.isFinite(Date.parse(evidence.recordedAt)) ||
    !/^[a-f0-9]{64}$/.test(item.evidenceSha256 || "") ||
    evidenceSha256(absolutePath) !== item.evidenceSha256 ||
    requirement.verifiedControls.some((control) => !controls.has(control))) {
    throw new Error(
      `Operational evidence ${item.id} is unbound, incomplete or stale.`
    );
  }
  assertOperationalGateSpecificContent(item, evidence);
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
      const absolutePath = evidencePath(item.evidence, `${label} ${item.id}`);
      let evidence;
      try {
        evidence = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
      } catch {
        throw new Error(`${label} ${item.id} evidence is not valid JSON.`);
      }
      if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
        throw new Error(`${label} ${item.id} evidence must be a JSON object.`);
      }
      if (label === "Operational evidence") {
        assertOperationalEvidenceContent(item, evidence, absolutePath);
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

const PROHIBITED_PARTIAL_EVIDENCE_KEYS = new Set([
  "attendee",
  "contact",
  "recipient",
  "to",
  "email",
  "emailaddress",
  "phone",
  "mobile",
  "dateofbirth",
  "dob",
  "fullname",
  "customername",
  "cancellationtoken",
]);

function assertEvidenceContainsNoCustomerPii(value) {
  const visit = (candidate) => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (candidate && typeof candidate === "object") {
      for (const [key, child] of Object.entries(candidate)) {
        const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (PROHIBITED_PARTIAL_EVIDENCE_KEYS.has(normalizedKey)) {
          throw new Error("Partial evidence contains a prohibited customer PII field.");
        }
        visit(child);
      }
      return;
    }
    if (typeof candidate !== "string") return;
    const containsEmailAddress =
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(candidate);
    const containsTokenQuery =
      /(?:^|[?&])(?:cancellation[_-]?token|token)=[^&#\s]+/i.test(candidate);
    const containsNamedCancellationToken =
      /cancellation[_-]?token\s*[:=]\s*[^\s,;]+/i.test(candidate);
    const containsJwtLikeSecret =
      /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/.test(
        candidate
      );
    if (containsEmailAddress || containsTokenQuery ||
      containsNamedCancellationToken || containsJwtLikeSecret) {
      throw new Error("Partial evidence contains a prohibited customer PII value.");
    }
  };
  visit(value);
}

function assertPartialEvidence(items, statusField) {
  for (const item of items) {
    if (item.partialEvidence === undefined) continue;
    if (item[statusField]) {
      throw new Error(`${item.id} must remove partial evidence once fully verified.`);
    }
    const absolutePath = evidencePath(
      item.partialEvidence,
      `Partial evidence for ${item.id}`
    );
    if (!/^[a-f0-9]{64}$/.test(item.partialEvidenceSha256 || "") ||
      evidenceSha256(absolutePath) !== item.partialEvidenceSha256) {
      throw new Error(`${item.id} partial evidence is unbound or stale.`);
    }
    const evidence = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
      throw new Error(`${item.id} partial evidence must be a JSON object.`);
    }
    assertEvidenceContainsNoCustomerPii(evidence);
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

function assertPaygPrivacyOwnerDecision(ownerDecisions) {
  const decision = ownerDecisions.find(
    (item) => item.id === PAYG_PRIVACY_DECISION_ID
  );
  if (!decision) {
    throw new Error("PAYG Privacy Notice owner decision is missing.");
  }
  if (decision.approved !== true ||
    decision.evidence !==
      "ops/release/evidence/payg-privacy-notice-owner-approval-2026-09-01.json" ||
    decision.partialEvidence !== undefined) {
    throw new Error("PAYG Privacy Notice owner decision is stale or unsafe.");
  }
  const approval = readEvidence(
    decision.evidence,
    "PAYG Privacy Notice owner approval"
  );
  const manifest = JSON.parse(fs.readFileSync(
    path.join(root, "public/legal/products/manifest.json"),
    "utf8"
  ));
  const draftManifest = JSON.parse(fs.readFileSync(
    path.join(root, "public/legal/product-drafts/manifest.json"),
    "utf8"
  ));
  const final = manifest.documents?.paygPrivacyNotice;
  const draft = draftManifest.documents?.paygPrivacyNotice;
  if (approval.schemaVersion !== 1 ||
    approval.decisionId !== "payg-privacy-notice-owner-approval" ||
    approval.approved !== true || approval.approvedByRole !== "business-owner" ||
    approval.approvedReviewDocument?.decision !== "payg-privacy-notice" ||
    approval.approvedReviewDocument.version !== draft?.version ||
    approval.approvedReviewDocument.bytes !== draft?.bytes ||
    approval.approvedReviewDocument.sha256 !== draft?.sha256 ||
    approval.approvedFinalPublicationCandidate?.decision !==
      "payg-privacy-notice" ||
    approval.approvedFinalPublicationCandidate.version !== final?.version ||
    approval.approvedFinalPublicationCandidate.bytes !== final?.bytes ||
    approval.approvedFinalPublicationCandidate.sha256 !== final?.sha256 ||
    approval.customerFacingSectionsUnchanged !== true ||
    approval.customerFacingSectionsByteEvidence?.bytes !== 13059 ||
    approval.customerFacingSectionsByteEvidence.sourceDraftSha256 !==
      "e4180eb07e52af8cb768898a86d10eac0b7b2fbce6624dd00469cd8a8ea68f0d" ||
    approval.customerFacingSectionsByteEvidence.finalSha256 !==
      "e4180eb07e52af8cb768898a86d10eac0b7b2fbce6624dd00469cd8a8ea68f0d" ||
    approval.customerPiiRecorded !== false ||
    approval.runtimePublicationComplete !== false ||
    approval.deploymentAuthorized !== false ||
    approval.productionPurchaseGatesRemainClosed !== true ||
    manifest.ownerDecisions?.paygPrivacyNoticeApproved !== true ||
    manifest.productionPurchaseGatesRemainClosed !== true) {
    throw new Error("PAYG Privacy Notice owner approval evidence is stale or unsafe.");
  }
  const engineering = readEvidence(
    PAYG_PRIVACY_ENGINEERING_EVIDENCE,
    "PAYG Privacy Notice engineering evidence"
  );
  if (engineering.schemaVersion !== 1 ||
    engineering.evidenceType !==
      "payg-privacy-notice-runtime-binding-engineering-readiness" ||
    engineering.engineeringReady !== true || engineering.launchReady !== false ||
    engineering.privacyNoticeApproved !== true ||
    engineering.ownerApprovalEvidence !== decision.evidence ||
    engineering.approvedFinal?.version !== final.version ||
    engineering.approvedFinal?.publicUrl !== final.publicUrl ||
    engineering.approvedFinal?.bytes !== final.bytes ||
    engineering.approvedFinal?.sha256 !== final.sha256 ||
    engineering.productionPurchaseGatesRemainClosed !== true ||
    engineering.deploymentAuthorized !== false ||
    engineering.customerPiiRecorded !== false) {
    throw new Error("PAYG Privacy Notice engineering evidence is stale or unsafe.");
  }
}

function assertProductTermsOwnerEvidence(ownerDecisions) {
  const ids = [
    "adult-conditioning-product-terms",
    "payg-product-terms-and-waiver",
  ];
  const decisions = ids.map((id) => ownerDecisions.find((item) => item.id === id));
  if (decisions.some((decision) => !decision?.approved)) return;
  if (decisions[0].evidence !== decisions[1].evidence) {
    throw new Error("Product terms owner decisions must bind one exact approval record.");
  }
  const evidence = readEvidence(
    decisions[0].evidence,
    "Product terms owner approval"
  );
  if (evidence.schemaVersion !== 1 ||
    evidence.decisionId !== "conditioning-and-payg-product-terms-owner-approval" ||
    evidence.approved !== true || evidence.approvedByRole !== "business-owner" ||
    evidence.paygSpecificDateCancellationStatementApproved !== true ||
    evidence.customerPiiRecorded !== false ||
    evidence.runtimePublicationComplete !== false ||
    evidence.deploymentAuthorized !== false ||
    evidence.productionPurchaseGatesRemainClosed !== true) {
    throw new Error("Product terms owner approval evidence is stale or unsafe.");
  }
  verifyApprovedProductLegalDocuments();
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

function assertPendingRecordedGate(gate, expectations = {}) {
  if (!gate || typeof gate.verified !== "boolean") {
    throw new Error("Partial browser evidence is missing a required gate.");
  }
  if (gate.verified) return false;

  const {
    partialEvidence,
    remainingControls = [],
    syntheticDeliveryAcknowledged,
  } = expectations;
  if (gate.evidence !== null ||
    (partialEvidence !== undefined &&
      gate.partialEvidence !== partialEvidence) ||
    remainingControls.some((control) =>
      !gate.remainingControls?.includes(control)
    ) ||
    (syntheticDeliveryAcknowledged !== undefined &&
      gate.syntheticDeliveryAcknowledged !== syntheticDeliveryAcknowledged)) {
    throw new Error("Partial browser evidence must retain every external blocker.");
  }
  return true;
}

function assertRecordedBrowserEvidence(operationalEvidence) {
  const conditioningGate = operationalEvidence.find(
    ({id}) => id === "conditioning-stripe-test-purchase-to-booking-journey"
  );
  const paygGate = operationalEvidence.find(
    ({id}) => id === "payg-stripe-test-purchase-refund-dispute-email-journey"
  );
  const cancellationDrill = operationalEvidence.find(
    ({id}) => id === "class-cancellation-quota-and-payg-refund-drill"
  );
  const alertGate = operationalEvidence.find(
    ({id}) => id === "billing-alert-policies-and-staffed-notification-route"
  );
  const backlogGate = operationalEvidence.find(
    ({id}) => id === "live-stripe-delivery-backlog-cleared"
  );
  const publicationGate = operationalEvidence.find(
    ({id}) => id === "product-legal-publication-and-runtime-binding"
  );

  const conditioningPending = assertPendingRecordedGate(conditioningGate, {
    partialEvidence: CONDITIONING_BROWSER_PARTIAL_EVIDENCE,
    remainingControls: [
      "confirmation-email-delivered",
    ],
  });
  const paygPending = assertPendingRecordedGate(paygGate, {
    partialEvidence: PAYG_BROWSER_PARTIAL_EVIDENCE,
    remainingControls: [
      "confirmation-email-delivered",
      "refund-email-delivered",
      "dispute-email-delivered",
    ],
  });
  const cancellationPending = assertPendingRecordedGate(cancellationDrill, {
    partialEvidence: PAYG_BROWSER_PARTIAL_EVIDENCE,
  });
  const alertPending = assertPendingRecordedGate(alertGate, {
    partialEvidence: BILLING_ALERT_PARTIAL_EVIDENCE,
    remainingControls: [
      "synthetic-alert-delivery-test-and-human-acknowledgement",
    ],
    syntheticDeliveryAcknowledged: false,
  });
  assertPendingRecordedGate(backlogGate);
  assertPendingRecordedGate(publicationGate);

  if (conditioningPending) {
    const conditioning = readEvidence(
      CONDITIONING_BROWSER_PARTIAL_EVIDENCE,
      "Conditioning Stripe/browser partial evidence"
    );
    if (conditioning.schemaVersion !== 3 ||
      conditioning.evidenceType !==
        "conditioning-stripe-test-provider-app-partial" ||
      conditioning.readinessItemId !== conditioningGate.id ||
      conditioning.testedSourceCommit !==
        "f0d9efc54d3c0d46e38b9515ba367450d142b03d" ||
      conditioning.customerPiiRecorded !== false ||
      conditioning.stripeMode !== "test" ||
      conditioning.planKey !== "adult_conditioning" ||
      conditioning.providerReferences?.checkoutSessionId !==
        "cs_test_a1keBmeAxXZAYTeeyxRhRsBvjNFFgtMW46K6sULUSzTnc2xjE9ONq0UnoD" ||
      conditioning.providerReferences?.subscriptionId !==
        "sub_1UB1yPFzNDZoGGA0w7j4zdXC" ||
      conditioning.providerReferences?.checkoutCompletedEventId !==
        "evt_1UB1yRFzNDZoGGA0Ui9GZrJv" ||
      conditioning.catalogue?.testProductId !== "prod_VAOvaoryJOeb04" ||
      conditioning.catalogue?.testPriceId !==
        "price_1UA47fFzNDZoGGA0lgyZPUZ9" ||
      conditioning.catalogue?.recurringAmountPence !== 3000 ||
      conditioning.catalogue?.initialProratedAmountPence !== 2900 ||
      conditioning.catalogue?.currency !== "gbp" ||
      conditioning.providerReadback?.checkoutStatus !== "complete" ||
      conditioning.providerReadback?.checkoutPaymentStatus !== "paid" ||
      conditioning.providerReadback?.subscriptionStatus !== "active" ||
      conditioning.providerReadback?.checkoutEventAcknowledged !== true ||
      conditioning.applicationReferences?.membershipId !==
        conditioning.providerReferences.subscriptionId ||
      conditioning.applicationReferences?.quotaWeekKey !== "2026-08-31" ||
      !isDeepStrictEqual(
        conditioning.applicationReferences?.fixtureClassIds,
        [
          "conditioning_browser_thursday_a",
          "conditioning_browser_thursday_b",
          "conditioning_browser_friday_a",
          "conditioning_browser_friday_b",
        ]
      ) ||
      conditioning.applicationReadback?.membershipState !== "active" ||
      conditioning.applicationReadback?.entitlementState !== "active" ||
      conditioning.applicationReadback?.membershipClaimVerifierConsumed !==
        true ||
      conditioning.applicationReadback?.entitlementProjectionApplied !== true ||
      conditioning.applicationReadback?.appAccessTier !== "limited" ||
      !isDeepStrictEqual(
        conditioning.applicationReadback?.restrictedRoutesVerified,
        ["/dashboard", "/leaderboard", "/training"]
      ) ||
      conditioning.applicationReadback?.weeklyBookingLimit !== 2 ||
      conditioning.applicationReadback?.flexibleEligibleClassSelection !== true ||
      !isDeepStrictEqual(
        conditioning.applicationReadback?.eligibleSlotKeys,
        [
          "monday_0600",
          "tuesday_1800",
          "thursday_1800",
          "friday_0530",
        ]
      ) ||
      conditioning.applicationReadback?.waiverVersion !==
        "ZAF-ADULT-WAIVER-2026-08-23-01" ||
      conditioning.applicationReadback?.waiverExactAcknowledgementSetMatched !==
        true ||
      !isDeepStrictEqual(
        conditioning.applicationReadback?.activeBookingFixtureLabels,
        ["Thursday A", "Friday B"]
      ) ||
      !isDeepStrictEqual(
        conditioning.applicationReadback?.cancelledBookingFixtureLabels,
        ["Friday A"]
      ) ||
      !isDeepStrictEqual(
        conditioning.applicationReadback?.rejectedBookingFixtureLabels,
        ["Thursday B"]
      ) ||
      conditioning.applicationReadback?.quotaBookedCount !== 2 ||
      !isDeepStrictEqual(
        conditioning.applicationReadback?.fixtureBookedCounts,
        {"Thursday A": 1, "Thursday B": 0, "Friday A": 0, "Friday B": 1}
      ) ||
      conditioning.applicationReadback?.confirmationOutboxState !== "pending" ||
      conditioning.applicationReadback?.confirmationTransport !== "disabled" ||
      conditioning.applicationReadback?.confirmationDelivered !== false ||
      conditioning.verification?.hostedCheckoutCompleted !== true ||
      conditioning.verification?.webhookAcknowledged !== true ||
      conditioning.verification?.membershipCreated !== true ||
      conditioning.verification?.entitlementActivated !== true ||
      conditioning.verification
        ?.singleRunProviderToClaimedMembershipWithoutFixtureSubstitution !==
        true ||
      conditioning.verification?.limitedAppAccessVerified !== true ||
      conditioning.verification?.currentWaiverAccepted !== true ||
      conditioning.verification?.purchasedMemberAppBookingVerified !== true ||
      conditioning.verification?.thirdBookingRejectedWithoutMutation !== true ||
      conditioning.verification?.eligibleCancellationReleasedCapacityAndQuota !==
        true ||
      conditioning.verification?.replacementBookingSucceeded !== true ||
      conditioning.verification?.twoClassesPerLondonWeekEnforced !== true ||
      conditioning.verification?.flexibleEligibleClassChangesVerified !== true ||
      conditioning.verification?.confirmationDelivered !== false ||
      conditioning.testProviderMutationPerformed !== true ||
      conditioning.liveProviderMutation !== false ||
      conditioning.productionWritePerformed !== false ||
      conditioning.deploymentPerformed !== false ||
      conditioning.newProductPurchaseGatesRemainClosed !== true) {
      throw new Error(
        "Conditioning Stripe/browser partial evidence is stale or unsafe."
      );
    }

    const fixture = readEvidence(
      "ops/release/evidence/conditioning-stripe-test-and-local-browser-2026-09-01.json",
      "Conditioning local-browser supporting evidence"
    );
    const conditioningSequence = fixture.localBrowserRerun?.bookingSequence;
    if (fixture.schemaVersion !== 1 ||
      fixture.evidenceType !==
        "conditioning-stripe-test-and-local-browser-partial" ||
      fixture.customerPiiRecorded !== false ||
      fixture.localBrowserRerun?.environment !== "local-emulator-fixture" ||
      fixture.localBrowserRerun?.waiver?.version !==
        "ZAF-ADULT-WAIVER-2026-08-23-01" ||
      fixture.localBrowserRerun?.waiver?.exactAcknowledgementSetMatched !== true ||
      !Array.isArray(conditioningSequence) || conditioningSequence.length !== 5 ||
      conditioningSequence[2]?.result !== "blocked-weekly-quota" ||
      conditioningSequence[3]?.result !==
        "succeeded-capacity-and-quota-released" ||
      conditioningSequence[4]?.result !== "succeeded" ||
      fixture.localBrowserRerun?.finalEmulatorReadback?.quotaBookedCount !== 2 ||
      fixture.localBrowserRerun?.finalEmulatorReadback
        ?.allObservedUnbookedCandidateBookedCountsZero !== true ||
      fixture.liveProviderMutation !== false ||
      fixture.productionWritePerformed !== false) {
      throw new Error("Conditioning browser support is stale or unsafe.");
    }
    assertSameValues(
      fixture.localBrowserRerun.finalEmulatorReadback
        .activeBookingFixtureLabels,
      ["Thursday A", "Friday D"],
      "Conditioning active browser fixtures"
    );
    assertSameValues(
      fixture.localBrowserRerun.finalEmulatorReadback
        .cancelledBookingFixtureLabels,
      ["Friday C"],
      "Conditioning cancelled browser fixtures"
    );
    assertSameValues(
      fixture.localBrowserRerun.finalEmulatorReadback
        .quotaActiveBookingFixtureLabels,
      ["Thursday A", "Friday D"],
      "Conditioning quota browser fixtures"
    );
    assertSameValues(
      fixture.localBrowserRerun.accessReadback.available,
      ["Schedule", "Profile", "Membership"],
      "Conditioning available app surfaces"
    );
    assertSameValues(
      fixture.localBrowserRerun.accessReadback.notIncluded,
      ["Dashboard", "Training", "Leaderboard"],
      "Conditioning excluded app surfaces"
    );
    if (fixture.localBrowserRerun.accessReadback.notIncludedCopy !==
      "Not included") {
      throw new Error("Conditioning excluded app copy is stale.");
    }
  }

  if (paygPending || cancellationPending) {
    const payg = readEvidence(
      PAYG_BROWSER_PARTIAL_EVIDENCE,
      "PAYG Stripe/browser partial evidence"
    );
    const refund = payg.refundScenario;
    const dispute = payg.disputeScenario;
    if (payg.schemaVersion !== 2 ||
      payg.evidenceType !==
        "payg-stripe-test-purchase-refund-dispute-partial" ||
      payg.readinessItemId !== paygGate.id ||
      payg.testedSourceCommit !==
        "f0d9efc54d3c0d46e38b9515ba367450d142b03d" ||
      payg.customerPiiRecorded !== false ||
      payg.stripeMode !== "test" || payg.productKey !== "adult_payg_class" ||
      payg.accountRequired !== false ||
      payg.catalogue?.testProductId !== "prod_VAOxXxpax1MuRt" ||
      payg.catalogue?.testPriceId !==
        "price_1UAmVVFzNDZoGGA04z8hX10N" ||
      payg.catalogue?.amountPence !== 700 ||
      payg.catalogue?.currency !== "gbp" ||
      payg.catalogue?.exactApprovedTestPriceVerified !== true ||
      refund?.providerReferences?.checkoutSessionId !==
        "cs_test_a1GeAMCx49zZtgYLXSV7UHp3QTX8YjVxcm75jUlSECBh2FFj2BSI3azwgz" ||
      refund?.providerReferences?.paymentIntentId !==
        "pi_3UB0vRFzNDZoGGA01ItZF4Hw" ||
      refund?.providerReferences?.refundId !==
        "re_3UB0vRFzNDZoGGA01ZUuC7ZB" ||
      refund?.purchaseReadback?.checkoutCompleted !== true ||
      refund?.purchaseReadback?.paymentSucceeded !== true ||
      refund?.purchaseReadback?.authenticationAccountCreated !== false ||
      refund?.purchaseReadback?.orderInitiallyConfirmed !== true ||
      refund?.purchaseReadback?.guestBookingInitiallyBooked !== true ||
      refund?.refundReadback?.refundStatus !== "succeeded" ||
      refund?.refundReadback?.refundedAmountPence !== 700 ||
      refund?.refundReadback?.orderStatus !== "refunded" ||
      refund?.refundReadback?.capacityState !== "released" ||
      refund?.refundReadback?.bookingStatus !== "cancelled" ||
      refund?.refundReadback?.cancellationPolicyOutcome !==
        "at_least_24_hours_refundable" ||
      refund?.refundReadback?.finalBookedCount !== 0 ||
      refund?.refundReadback?.confirmationOutboxStatus !== "tombstoned" ||
      refund?.refundReadback?.allRecordedRefundEventsProcessed !== true ||
      dispute?.providerReferences?.checkoutSessionId !==
        "cs_test_a1GLqudYJzDzoDtfknS0zz2xKohjEPlGmzHyS26rLL7unL8Qgebl3XuZa1" ||
      dispute?.providerReferences?.paymentIntentId !==
        "pi_3UB12zFzNDZoGGA01AT8PDoe" ||
      dispute?.providerReferences?.disputeId !==
        "du_1UB132FzNDZoGGA0kLiyc8C2" ||
      dispute?.providerReadback?.disputeStatus !== "needs_response" ||
      dispute?.providerReadback?.disputeReason !== "product_not_received" ||
      dispute?.providerReadback?.disputeOpen !== true ||
      dispute?.providerReadback?.disputeEventProcessed !== true ||
      dispute?.applicationReadback?.orderStatus !== "disputed" ||
      dispute?.applicationReadback?.capacityState !== "released" ||
      dispute?.applicationReadback?.bookingStatus !== "cancelled" ||
      dispute?.applicationReadback?.refundAutomationStatus !==
        "suspended_dispute" ||
      dispute?.applicationReadback?.refundObligationReviewRequired !== true ||
      dispute?.applicationReadback?.finalBookedCount !== 0 ||
      dispute?.applicationReadback?.confirmationOutboxStatus !== "tombstoned" ||
      refund.providerReferences.checkoutSessionId ===
        dispute.providerReferences.checkoutSessionId ||
      refund.providerReferences.paymentIntentId ===
        dispute.providerReferences.paymentIntentId ||
      payg.emailDelivery?.transport !== "disabled" ||
      payg.emailDelivery?.confirmationDelivered !== false ||
      payg.emailDelivery?.refundEmailDelivered !== false ||
      payg.emailDelivery?.disputeEmailDelivered !== false ||
      payg.releaseGateAssessment?.fullPaygOperationalGateVerified !== false ||
      payg.releaseGateAssessment?.confirmationDeliveryVerified !== false ||
      payg.releaseGateAssessment?.refundableCancellationAndProviderRefundVerified !==
        true ||
      payg.releaseGateAssessment?.separateProviderDisputeConvergenceVerified !==
        true ||
      payg.releaseGateAssessment?.lateCancellationAndNoShowVerified !== false ||
      payg.testProviderMutationPerformed !== true ||
      payg.liveProviderMutation !== false ||
      payg.productionWritePerformed !== false ||
      payg.deploymentPerformed !== false ||
      payg.newProductPurchaseGatesRemainClosed !== true) {
      throw new Error("PAYG Stripe/browser partial evidence is stale or unsafe.");
    }
    assertSameValues(
      refund.providerReferences.refundEventIds,
      [
        "evt_3UB0vRFzNDZoGGA01zkXDQl5",
        "evt_3UB0vRFzNDZoGGA01AUKFE6S",
        "evt_3UB0vRFzNDZoGGA01VA4m4Qi",
      ],
      "PAYG refund webhook events"
    );
  }

  if (alertPending) {
    const alertEvidence = readEvidence(
      BILLING_ALERT_PARTIAL_EVIDENCE,
      "Billing alert partial evidence"
    );
    if (alertEvidence.verification?.syntheticDeliveryTestPerformed !== false ||
      alertEvidence.verification?.namedPrimaryAndBackupRosterRecorded !== false) {
      throw new Error("Alert evidence must not claim synthetic acknowledgement.");
    }
  }
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
  assertProductTermsOwnerEvidence(readiness.ownerDecisions);
  assertPaygPrivacyOwnerDecision(readiness.ownerDecisions);
  assertPaygRetentionOwnerEvidence(readiness.ownerDecisions);
  assertLiveStripeDeliveryBacklogEvidence(readiness.operationalEvidence);
  assertRecordedBrowserEvidence(readiness.operationalEvidence);

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
  assertEvidence,
  assertEvidenceContainsNoCustomerPii,
  assertOperationalEvidenceContent,
  assertOperationalGateSpecificContent,
  assertPaygPrivacyOwnerDecision,
  assertPartialEvidence,
  assertRecordedBrowserEvidence,
  verifyConditioningPaygReleaseCandidate,
};
