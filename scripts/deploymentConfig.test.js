const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("Vercel production builds are preflighted and preserve SPA deep links", () => {
  const vercel = JSON.parse(
    fs.readFileSync(path.join(root, "vercel.json"), "utf8")
  );
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8")
  );

  assert.equal(vercel.framework, "create-react-app");
  assert.equal(vercel.outputDirectory, "build");
  assert.equal(vercel.buildCommand, "npm run build:production");
  assert.deepEqual(vercel.rewrites, [
    {source: "/(.*)", destination: "/index.html"},
  ]);
  assert.match(
    packageJson.scripts["build:production"],
    /^node scripts\/verifyFrontendProductionEnv\.js && /
  );
  assert.equal(
    packageJson.scripts["verify:frontend-production-closed"],
    "node scripts/verifyFrontendProductionEnv.js --expect-purchase-closed"
  );
  assert.equal(
    packageJson.scripts["verify:frontend-production-open"],
    "node scripts/verifyFrontendProductionEnv.js --expect-purchase-open"
  );
  assert.equal(
    packageJson.scripts["verify:frontend-conditioning-production-open"],
    "node scripts/verifyFrontendProductionEnv.js --expect-purchase-open " +
      "--expect-conditioning-open"
  );
  assert.equal(
    packageJson.scripts["verify:production-open-payg-config"],
    "npm run verify:production-open-payg-config --prefix functions"
  );
  assert.equal(
    packageJson.scripts["verify:production-open-conditioning-payg-config"],
    "npm run verify:production-open-conditioning-payg-config --prefix functions"
  );
  assert.equal(packageJson.engines?.node, "24.x");
});

test("CI exercises the production build preflight with an inert browser fixture", () => {
  const workflow = fs.readFileSync(
    path.join(root, ".github/workflows/ci.yml"),
    "utf8"
  );

  assert.match(workflow, /run: npm run build:production/);
  assert.match(workflow, /VERCEL_ENV: "production"/);
  assert.match(
    workflow,
    /REACT_APP_FIREBASE_PROJECT_ID: "alphawod-d1f2f"/
  );
  assert.match(
    workflow,
    /REACT_APP_FIREBASE_API_KEY: "ci-inert-invalid-key"/
  );
  assert.match(workflow, /REACT_APP_USE_EMULATORS: "false"/);
  assert.match(
    workflow,
    /REACT_APP_MEMBERSHIP_TEST_JOURNEY_ENABLED: "false"/
  );
  assert.match(
    workflow,
    /REACT_APP_MEMBERSHIP_PURCHASE_ENABLED: "false"/
  );
  assert.match(
    workflow,
    /REACT_APP_ADULT_CONDITIONING_PURCHASE_ENABLED: "false"/
  );
});

test("checked-in production examples keep every purchase/test gate closed", () => {
  const frontend = fs.readFileSync(
    path.join(root, ".env.production.example"),
    "utf8"
  );
  const functions = fs.readFileSync(
    path.join(root, "functions/.env.production.example"),
    "utf8"
  );

  assert.match(frontend, /^REACT_APP_USE_EMULATORS=false$/m);
  assert.match(
    frontend,
    /^REACT_APP_MEMBERSHIP_TEST_JOURNEY_ENABLED=false$/m
  );
  assert.match(
    frontend,
    /^REACT_APP_MEMBERSHIP_PURCHASE_ENABLED=false$/m
  );
  assert.match(frontend, /^REACT_APP_FIREBASE_APPCHECK_SITE_KEY=/m);
  assert.match(functions, /^MEMBERSHIP_PURCHASE_ENABLED=false$/m);
  assert.match(functions, /^MEMBERSHIP_TEST_JOURNEY_ENABLED=false$/m);
  assert.match(functions, /^MEMBERSHIP_CHECKOUT_APP_ID=/m);
  assert.match(functions, /^MEMBERSHIP_FIREBASE_PROJECT_ID=alphawod-d1f2f$/m);
  assert.match(functions, /^STRIPE_EXPECTED_MODE=live$/m);
  assert.match(functions, /^PAYG_PII_REDACTION_IMPLEMENTED=true$/m);
  assert.match(functions, /^PAYG_PII_RETENTION_APPROVED=false$/m);
  assert.match(functions, /^PAYG_CANCELLATION_TOKEN_KEY_ID=cancel-v1$/m);
  assert.match(functions, /^PAYG_DUPLICATE_LOCK_KEY_ID=lock-v1$/m);
  assert.match(functions, /MEMBERSHIP_CHECKOUT_RATE_LIMIT_SECRET/);
  assert.match(functions, /PAYG_CANCELLATION_TOKEN_SECRET/);
  assert.match(functions, /PAYG_CHECKOUT_RATE_LIMIT_SECRET/);
  assert.match(functions, /PAYG_DUPLICATE_LOCK_SECRET/);
});

test("checkout abuse records have server-managed TTL field overrides", () => {
  const indexes = JSON.parse(
    fs.readFileSync(path.join(root, "firestore.indexes.json"), "utf8")
  );
  const overrides = new Map(
    indexes.fieldOverrides.map((override) => [
      `${override.collectionGroup}/${override.fieldPath}`,
      override,
    ])
  );

  for (const collection of [
    "membershipCheckoutRateAdmissions",
    "membershipCheckoutRateLimits",
    "paygCheckoutAdmissions",
    "paygCheckoutRateLimits",
  ]) {
    const override = overrides.get(`${collection}/expiresAt`);
    assert.equal(override?.ttl, true);
    assert.deepEqual(override?.indexes, []);
  }

  const lockOverride = overrides.get("paygCheckoutLocks/deleteAt");
  assert.equal(lockOverride?.ttl, true);
  assert.deepEqual(lockOverride?.indexes, []);

  assert.equal(
    overrides.has("paygIntents/piiDeleteAt"),
    false,
    "PII redaction must retain the non-PII intent audit record"
  );

  for (const collection of [
    "paygIntents",
    "paygOrders",
    "paygEmailOutbox",
    "paygWaiverAcceptances",
  ]) {
    assert.equal(
      overrides.has(`${collection}/piiRetentionCutoffAt`),
      false,
      `${collection} immutable cutoff must not be configured as whole-document TTL`
    );
    assert.equal(
      overrides.has(`${collection}/piiRedactionRetryAt`),
      false,
      `${collection} retry field must keep its default single-field query index`
    );
  }
});

test("Conditioning/PAYG Functions have a complete no-deploy batch manifest", () => {
  const {
    REQUIRED_BOOKING_ACCESS_TARGETS,
    REQUIRED_PAYG_TARGETS,
    verifyConditioningPaygDeployment,
  } = require("./verifyConditioningPaygDeployment");
  const manifest = verifyConditioningPaygDeployment();
  const targets = manifest.batches.flatMap((batch) => batch.targets);

  assert.equal(manifest.deploymentMode, "template-only");
  assert.equal(manifest.purchaseGatesExpectedClosed, true);
  assert.ok(manifest.batches.every((batch) => batch.targets.length <= 10));
  for (const target of [
    ...REQUIRED_PAYG_TARGETS,
    ...REQUIRED_BOOKING_ACCESS_TARGETS,
  ]) {
    assert.ok(targets.includes(target), `${target} is missing from deployment batches`);
  }
});
