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
  assert.match(functions, /MEMBERSHIP_CHECKOUT_RATE_LIMIT_SECRET/);
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
  ]) {
    const override = overrides.get(`${collection}/expiresAt`);
    assert.equal(override?.ttl, true);
    assert.deepEqual(override?.indexes, []);
  }
});

test("membership Functions deploy in complete selective batches of ten or fewer", () => {
  const rollout = fs.readFileSync(
    path.join(root, "docs/billing/phase-1-rollout.md"),
    "utf8"
  );
  const batches = [...rollout.matchAll(
    /^firebase deploy --only (functions:[^\n]+) --project alphawod-d1f2f$/gm
  )].map((match) => match[1].split(","));
  const expectedTargets = [
    "functions:claimMembership",
    "functions:createCustomerPortalSession",
    "functions:createMembershipCheckoutSession",
    "functions:getMyMemberships",
    "functions:linkMembershipParticipant",
    "functions:listMemberships",
    "functions:recoverMembershipCancellations",
    "functions:recoverStripeEvents",
    "functions:reconcilePastDueMemberships",
    "functions:requestMembershipCancellation",
    "functions:retryMembershipConfirmations",
    "functions:stripeWebhook",
  ];

  assert.equal(batches.length, 2);
  for (const batch of batches) {
    assert.ok(batch.length <= 10, "Firebase recommends batches of ten or fewer");
    assert.ok(batch.every((target) => target.startsWith("functions:")));
  }
  assert.deepEqual(
    [...new Set(batches.flat())].sort(),
    [...expectedTargets].sort()
  );

  const orderedMarkers = [
    "firebase deploy --only firestore:indexes --project alphawod-d1f2f",
    "firebase deploy --only firestore:rules,storage --project alphawod-d1f2f",
    "npm run verify:frontend-production-closed",
    "npm run verify:published-legal",
    "firebase deploy --only functions:stripeWebhook,",
    "firebase deploy --only functions:createMembershipCheckoutSession,",
  ];
  const positions = orderedMarkers.map((marker) => rollout.indexOf(marker));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(positions, [...positions].sort((left, right) => left - right));
});
