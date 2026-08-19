/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifestPath = path.join(root, "ops/monitoring/billing-alerts.json");
const sourcePath = path.join(root, "functions/src/membership.ts");
const productionExamplePath = path.join(
  root,
  "functions/.env.production.example"
);

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function assertSameValues(actual, expected, label) {
  if (JSON.stringify(uniqueSorted(actual)) !== JSON.stringify(uniqueSorted(expected))) {
    throw new Error(`${label} is stale; update the monitoring manifest with the source.`);
  }
}

function verifyBillingMonitoring() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const source = fs.readFileSync(sourcePath, "utf8");
  const productionExample = fs.readFileSync(productionExamplePath, "utf8");

  if (manifest.schemaVersion !== 1 || manifest.deploymentMode !== "template-only") {
    throw new Error("Monitoring manifest must remain an explicit versioned template.");
  }
  if (manifest.purchaseGateExpected !== false ||
    !/^MEMBERSHIP_PURCHASE_ENABLED=false$/m.test(productionExample)) {
    throw new Error("Monitoring preparation must not open the purchase gate.");
  }
  if (!manifest.notificationChannelRequired || !manifest.runbook) {
    throw new Error("Monitoring requires a notification channel and runbook.");
  }

  const sourceMarkers = uniqueSorted(
    source.match(/CRITICAL_BILLING_[A-Z0-9_]+/g) ?? []
  );
  const configuredMarkers = manifest.policies.flatMap(
    (policy) => policy.sourceMarkers ?? []
  );
  assertSameValues(configuredMarkers, sourceMarkers, "Critical billing marker coverage");

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
    `${sourceMarkers.length} critical runtime markers.`
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

module.exports = {verifyBillingMonitoring};
