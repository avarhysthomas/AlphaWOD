/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifestPath = path.join(
  root,
  "ops/deployment/conditioning-payg-functions.json"
);

const REQUIRED_MEMBERSHIP_TARGETS = Object.freeze([
  "claimMembership",
  "createCustomerPortalSession",
  "createMembershipCheckoutSession",
  "createMembershipCheckoutSessionV2",
  "getMyMemberships",
  "linkMembershipParticipant",
  "listMemberships",
  "recoverMembershipCancellations",
  "recoverStripeEvents",
  "reconcileMembershipBookings",
  "reconcilePastDueMemberships",
  "releaseAbandonedMembershipCheckout",
  "requestMembershipCancellation",
  "retryMembershipConfirmations",
  "stripeWebhook",
]);

const REQUIRED_PAYG_TARGETS = Object.freeze([
  "createPaygCheckoutSession",
  "getPaygCancellationPreview",
  "getPaygCheckoutStatus",
  "getPublicPaygSchedule",
  "redactPaygPii",
  "recoverPaygOperations",
  "recoverStripeEvents",
  "requestPaygCancellation",
  "retryPaygConfirmations",
  "stripeWebhook",
]);

const REQUIRED_BOOKING_ACCESS_TARGETS = Object.freeze([
  "acceptCurrentWaiver",
  "adminAddBooking",
  "approveUserAccess",
  "bookClass",
  "bootstrapUserProfile",
  "cancelBooking",
  "checkInBooking",
  "generateClassOccurrences",
  "generateClassOccurrencesDaily",
  "getClassRoster",
  "getMonthlyDipLeaderboard",
  "getMonthlyLeaderboard",
  "listStaffUsers",
  "markBookingStatus",
  "onLeaderboardEntryWritten",
  "onUserDocWritten",
  "reconcileMonthlyLeaderboard",
  "setMemberEntitlement",
  "updateMemberRole",
]);

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function assertSameValues(actual, expected, label) {
  if (JSON.stringify(uniqueSorted(actual)) !== JSON.stringify(uniqueSorted(expected))) {
    throw new Error(`${label} is stale.`);
  }
}

function exportedFunctionNames(source) {
  const direct = [...source.matchAll(/export\s+const\s+([A-Za-z0-9_]+)/g)]
    .map((match) => match[1]);
  const named = [...source.matchAll(/export\s*\{([^}]+)\}\s*from/gs)]
    .flatMap((match) => match[1].split(","))
    .map((name) => name.trim().split(/\s+as\s+/).at(-1))
    .filter(Boolean);
  return uniqueSorted([...direct, ...named]);
}

function readCurrentSchemaVersions() {
  const membershipPlans = fs.readFileSync(
    path.join(root, "functions/src/membershipPlans.ts"),
    "utf8"
  );
  const membership = fs.readFileSync(
    path.join(root, "functions/src/membership.ts"),
    "utf8"
  );
  const record = membershipPlans.match(
    /MEMBERSHIP_SCHEMA_VERSION\s*=\s*(\d+)/
  );
  const checkout = membership.match(
    /MEMBERSHIP_CHECKOUT_SCHEMA_VERSION\s*=\s*(\d+)/
  );
  if (!record || !checkout) {
    throw new Error("Membership schema constants could not be read.");
  }
  return {record: Number(record[1]), checkout: Number(checkout[1])};
}

function verifyRunbookSchemaReferences() {
  const versions = readCurrentSchemaVersions();
  const currentStatements = [
    `Stored membership records now use schema version ${versions.record}`,
    `checkout request contract uses version ${versions.checkout}`,
    `checkoutSchemaVersion: ${versions.checkout}`,
  ];
  const runbookPaths = [
    "docs/billing/phase-1-rollout.md",
    "docs/billing/production-operations.md",
    "docs/billing/local-stripe-test-journey.md",
    "docs/phase-1-handover.md",
  ];
  const combined = runbookPaths.map((relativePath) =>
    fs.readFileSync(path.join(root, relativePath), "utf8")
  ).join("\n");
  for (const statement of currentStatements) {
    if (!combined.includes(statement)) {
      throw new Error(`Runbooks are missing the current schema reference: ${statement}`);
    }
  }
  for (const stale of [
    "Stored membership records now use schema version 5",
    "checkout request contract uses version 4",
    "checkoutSchemaVersion: 4",
    "schema version 4 only to the V2 intake",
  ]) {
    if (combined.includes(stale)) {
      throw new Error(`Runbooks retain a stale schema reference: ${stale}`);
    }
  }
  return versions;
}

function verifyConditioningPaygDeployment() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1 ||
    manifest.deploymentMode !== "template-only" ||
    manifest.productionProjectId !== "alphawod-d1f2f" ||
    manifest.firebaseCliVersion !== "15.5.1" ||
    manifest.purchaseGatesExpectedClosed !== true ||
    manifest.maximumTargetsPerBatch !== 10 ||
    manifest.firestoreConfiguration?.rules !== "firestore.rules" ||
    manifest.firestoreConfiguration?.indexes !== "firestore.indexes.json" ||
    manifest.firestoreConfiguration?.paygIntentWholeDocumentTtlExpected !== false) {
    throw new Error("Deployment manifest safety boundary is incomplete.");
  }

  const batchIds = manifest.batches.map((batch) => batch.id);
  if (batchIds.length !== new Set(batchIds).size) {
    throw new Error("Deployment batch ids must be unique.");
  }
  const targets = manifest.batches.flatMap((batch) => batch.targets ?? []);
  if (targets.length !== new Set(targets).size) {
    throw new Error("A Function may appear in only one deployment batch.");
  }
  for (const batch of manifest.batches) {
    if (!batch.id || !batch.invocationBoundary || !batch.targets?.length ||
      batch.targets.length > manifest.maximumTargetsPerBatch) {
      throw new Error(`Deployment batch ${batch.id ?? "<missing>"} is unsafe.`);
    }
  }

  const expectedTargets = uniqueSorted([
    ...REQUIRED_MEMBERSHIP_TARGETS,
    ...REQUIRED_PAYG_TARGETS,
    ...REQUIRED_BOOKING_ACCESS_TARGETS,
  ]);
  assertSameValues(targets, expectedTargets, "Conditioning/PAYG Function manifest");

  const indexSource = fs.readFileSync(
    path.join(root, "functions/src/index.ts"),
    "utf8"
  );
  const exports = exportedFunctionNames(indexSource);
  const missingExports = targets.filter((target) => !exports.includes(target));
  if (missingExports.length) {
    throw new Error(`Deployment targets are not exported: ${missingExports.join(", ")}`);
  }

  for (const environmentPath of [
    ".env.production.example",
    "functions/.env.production.example",
  ]) {
    const environment = fs.readFileSync(path.join(root, environmentPath), "utf8");
    const openGates = [...environment.matchAll(
      /^(?:REACT_APP_)?(?:MEMBERSHIP_PURCHASE_ENABLED|ADULT_CONDITIONING_PURCHASE_ENABLED|PAYG_AVAILABILITY_ENABLED)=([^\n]+)$/gm
    )].filter((match) => match[1].trim() !== "false");
    if (openGates.length) {
      throw new Error(`${environmentPath} must keep every purchase gate closed.`);
    }
  }

  const runbook = fs.readFileSync(
    path.join(root, "docs/billing/conditioning-payg-rollout.md"),
    "utf8"
  );
  if (!runbook.includes("ops/deployment/conditioning-payg-functions.json")) {
    throw new Error("Conditioning/PAYG runbook must cite the deployment manifest.");
  }
  const versions = verifyRunbookSchemaReferences();

  console.log(
    `Conditioning/PAYG deployment template verified: ${targets.length} unique ` +
    `Functions in ${manifest.batches.length} batches (maximum 10); membership ` +
    `schema ${versions.record}, checkout schema ${versions.checkout}; all gates closed.`
  );
  return manifest;
}

if (require.main === module) {
  try {
    verifyConditioningPaygDeployment();
  } catch (error) {
    console.error(`Conditioning/PAYG deployment verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  REQUIRED_BOOKING_ACCESS_TARGETS,
  REQUIRED_MEMBERSHIP_TARGETS,
  REQUIRED_PAYG_TARGETS,
  exportedFunctionNames,
  verifyConditioningPaygDeployment,
  verifyRunbookSchemaReferences,
};
