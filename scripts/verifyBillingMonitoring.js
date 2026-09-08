/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifestPath = path.join(root, "ops/monitoring/billing-alerts.json");
const productionExamplePath = path.join(
  root,
  "functions/.env.production.example"
);
const PAYMENT_FAILED_POLICY_ID = "billing-payment-failed";
const PAYMENT_FAILED_SIGNAL = "BILLING_PAYMENT_FAILED";
const PAYMENT_FAILED_NOTIFICATION_ROUTE = "business-owner-email";

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function assertSameValues(actual, expected, label) {
  if (JSON.stringify(uniqueSorted(actual)) !== JSON.stringify(uniqueSorted(expected))) {
    throw new Error(`${label} is stale; update the monitoring manifest with the source.`);
  }
}

function consoleErrorSignals(source) {
  return uniqueSorted(
    [...source.matchAll(/console\.error\(\s*"([^"]+)"/g)]
      .map((match) => match[1])
  );
}

function verifyBillingMonitoring() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const sourceByFile = new Map((manifest.sourceFiles ?? []).map((relativePath) => [
    relativePath,
    fs.readFileSync(path.join(root, relativePath), "utf8"),
  ]));
  const source = [...sourceByFile.values()].join("\n");
  const paygSource = sourceByFile.get("functions/src/payg.ts") ?? "";
  const productionExample = fs.readFileSync(productionExamplePath, "utf8");

  if (manifest.schemaVersion !== 2 || manifest.deploymentMode !== "template-only") {
    throw new Error("Monitoring manifest must remain an explicit versioned template.");
  }
  if (!sourceByFile.has("functions/src/membership.ts") || !paygSource) {
    throw new Error("Monitoring must cover both membership and PAYG runtime sources.");
  }
  if (manifest.purchaseGateExpected !== false ||
    !/^MEMBERSHIP_PURCHASE_ENABLED=false$/m.test(productionExample)) {
    throw new Error("Monitoring preparation must not open the purchase gate.");
  }
  if (!manifest.notificationChannelRequired || !manifest.runbook) {
    throw new Error("Monitoring requires a notification channel and runbook.");
  }

  const paymentFailedPolicies = manifest.policies.filter(
    (policy) => policy.id === PAYMENT_FAILED_POLICY_ID
  );
  const paymentFailedPolicy = paymentFailedPolicies[0];
  if (paymentFailedPolicies.length !== 1 || paymentFailedPolicy.priority !== "page" ||
    paymentFailedPolicy.windowSeconds !== 60 || paymentFailedPolicy.threshold !== 1 ||
    paymentFailedPolicy.notificationRoute !== PAYMENT_FAILED_NOTIFICATION_ROUTE ||
    JSON.stringify(paymentFailedPolicy.sourceSignals) !==
      JSON.stringify([PAYMENT_FAILED_SIGNAL]) ||
    !paymentFailedPolicy.cloudLoggingFilter.includes("severity>=WARNING") ||
    !paymentFailedPolicy.cloudLoggingFilter.includes(PAYMENT_FAILED_SIGNAL)) {
    throw new Error(
      "Missed-payment monitoring must page immediately to the business-owner email route."
    );
  }

  const sourceMarkers = uniqueSorted(
    source.match(/CRITICAL_(?:BILLING_)?[A-Z0-9_]+/g) ?? []
  );
  const configuredMarkers = manifest.policies.flatMap(
    (policy) => policy.sourceMarkers ?? []
  );
  assertSameValues(configuredMarkers, sourceMarkers, "Critical billing marker coverage");

  // Every explicit PAYG error is operationally significant: critical integrity
  // markers page immediately, while recovery/provider/email failures use their
  // own thresholds. Keeping exact coverage here prevents a newly added worker
  // or outbox error from silently shipping without a corresponding alert.
  const paygErrorSignals = uniqueSorted([
    ...consoleErrorSignals(paygSource),
    ...(paygSource.match(/CRITICAL_(?:BILLING_)?PAYG_[A-Z0-9_]+/g) ?? []),
  ]);
  const configuredPaygSignals = manifest.policies.flatMap((policy) => [
    ...(policy.sourceMarkers ?? []),
    ...(policy.sourceSignals ?? []),
  ]).filter((signal) => signal.includes("PAYG"));
  assertSameValues(
    configuredPaygSignals,
    paygErrorSignals,
    "PAYG error signal coverage"
  );

  for (const policy of manifest.policies) {
    if (!policy.id || !Number.isSafeInteger(policy.windowSeconds) ||
      !Number.isSafeInteger(policy.threshold) || policy.threshold < 1 ||
      !policy.cloudLoggingFilter.includes("cloud_run_revision") ||
      (!policy.cloudLoggingFilter.includes("severity>=ERROR") &&
        !policy.cloudLoggingFilter.includes("severity>=WARNING"))) {
      throw new Error(`Monitoring policy ${policy.id ?? "<missing>"} is incomplete.`);
    }
    for (const signal of policy.sourceSignals ?? []) {
      if (!source.includes(signal)) {
        throw new Error(`Monitoring policy ${policy.id} references a stale signal: ${signal}`);
      }
    }
  }

  console.log(
    `Billing monitoring template verified: ${manifest.policies.length} policies cover ` +
    `${sourceMarkers.length} critical runtime markers and ` +
    `${paygErrorSignals.length} PAYG error signals.`
  );
}

if (require.main === module) {
  try {
    verifyBillingMonitoring();
  } catch (error) {
    console.error(`Billing monitoring verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  PAYMENT_FAILED_NOTIFICATION_ROUTE,
  PAYMENT_FAILED_POLICY_ID,
  PAYMENT_FAILED_SIGNAL,
  consoleErrorSignals,
  verifyBillingMonitoring,
};
