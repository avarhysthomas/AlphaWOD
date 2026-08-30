/* eslint-disable @typescript-eslint/no-var-requires, max-len */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CURRENT_WAIVER_ACKNOWLEDGEMENTS,
  CURRENT_WAIVER_TITLE,
  CURRENT_WAIVER_VERSION,
  ACCESS_SCHEMA_VERSION,
  CLAIMS_VERSION,
  buildManagedClaims,
  canonicalConditioningSlots,
  claimsEqual,
  isCanonicalCurrentWaiverAcceptance,
  isEntitlementCompatibleWithRole,
  mergeManagedClaims,
  resolveUserAuthorisation,
} = require("../lib/authz");

test("approved legacy members receive AlphaWOD access", () => {
  const access = resolveUserAuthorisation({
    role: "user",
    approvalStatus: "approved",
    entitlementStatus: "active",
    entitlementSource: "legacy",
  });
  assert.equal(access.valid, true);
  assert.equal(access.alphaWodAccess, true);
  assert.equal(access.disabled, false);
  assert.equal(access.restricted, false);
  assert.equal(access.appAccessTier, "full");
  assert.deepEqual(access.entitlementClassSlots, []);
});

test("Adult Conditioning derives limited base access only with two canonical slots", () => {
  const access = resolveUserAuthorisation({
    role: "user",
    approvalStatus: "approved",
    entitlementStatus: "active",
    entitlementSource: "stripe",
    entitlementPlanKey: "adult_conditioning",
    appAccessTier: "limited",
    entitlementClassSlots: ["friday_0530", "monday_0600"],
  });
  assert.equal(access.valid, true);
  assert.equal(access.alphaWodAccess, true);
  assert.equal(access.appAccessTier, "limited");
  assert.deepEqual(access.entitlementClassSlots, ["monday_0600", "friday_0530"]);

  const malformed = resolveUserAuthorisation({
    role: "user",
    approvalStatus: "approved",
    entitlementStatus: "active",
    entitlementSource: "stripe",
    entitlementPlanKey: "adult_conditioning",
    appAccessTier: "limited",
    entitlementClassSlots: ["monday_0600", "monday_0600"],
  });
  assert.equal(malformed.valid, false);
  assert.equal(malformed.alphaWodAccess, false);
  assert.equal(malformed.appAccessTier, "none");
  assert.ok(malformed.issues.includes("app_access_policy_invalid"));
});

test("flexible Conditioning requires all four eligible slots and an exact weekly limit", () => {
  const profile = {
    role: "user",
    approvalStatus: "approved",
    entitlementStatus: "active",
    entitlementSource: "stripe",
    entitlementPlanKey: "adult_conditioning",
    appAccessTier: "limited",
    entitlementClassSlots: [
      "monday_0600",
      "tuesday_1800",
      "thursday_1800",
      "friday_0530",
    ],
    entitlementWeeklyBookingLimit: 2,
  };
  const access = resolveUserAuthorisation(profile);
  assert.equal(access.valid, true);
  assert.equal(access.entitlementPolicyWeeklyBookingLimit, 2);
  assert.equal(access.entitlementWeeklyBookingLimit, 2);
  assert.deepEqual(access.entitlementClassSlots, profile.entitlementClassSlots);
  assert.equal(buildManagedClaims(profile).entitlementWeeklyBookingLimit, 2);

  assert.equal(resolveUserAuthorisation({
    ...profile,
    entitlementWeeklyBookingLimit: 3,
  }).valid, false);
  assert.equal(resolveUserAuthorisation({
    ...profile,
    entitlementClassSlots: ["monday_0600", "tuesday_1800"],
  }).valid, false);
});

test("gated Conditioning profiles preserve policy while claims stay effective", () => {
  const pendingProfile = {
    role: "user",
    approvalStatus: "pending",
    entitlementStatus: "active",
    entitlementSource: "stripe",
    entitlementPlanKey: "adult_conditioning",
    appAccessTier: "limited",
    entitlementClassSlots: ["friday_0530", "monday_0600"],
  };
  const pending = resolveUserAuthorisation(pendingProfile);
  assert.equal(pending.valid, true);
  assert.equal(pending.alphaWodAccess, false);
  assert.equal(pending.entitlementPolicyAppAccessTier, "limited");
  assert.deepEqual(pending.entitlementPolicyClassSlots, [
    "monday_0600", "friday_0530",
  ]);
  assert.equal(pending.appAccessTier, "none");
  assert.deepEqual(pending.entitlementClassSlots, []);

  const claims = buildManagedClaims(pendingProfile);
  assert.equal(claims.alphaWodAccess, false);
  assert.equal(claims.appAccessTier, "none");
  assert.deepEqual(claims.entitlementClassSlots, []);

  const suspended = resolveUserAuthorisation({
    ...pendingProfile,
    approvalStatus: "approved",
    entitlementStatus: "restricted",
  });
  assert.equal(suspended.valid, true);
  assert.equal(suspended.entitlementPolicyAppAccessTier, "limited");
  assert.deepEqual(suspended.entitlementPolicyClassSlots, [
    "monday_0600", "friday_0530",
  ]);
  assert.equal(suspended.appAccessTier, "none");
  assert.equal(suspended.alphaWodAccess, false);
});

test("Stripe plan derivation fails closed while legacy/manual profiles remain migratable", () => {
  const missingStripePlan = resolveUserAuthorisation({
    role: "user",
    approvalStatus: "approved",
    entitlementStatus: "active",
    entitlementSource: "stripe",
  });
  assert.equal(missingStripePlan.valid, false);
  assert.equal(missingStripePlan.alphaWodAccess, false);

  const unlimited = resolveUserAuthorisation({
    role: "user",
    approvalStatus: "approved",
    entitlementStatus: "active",
    entitlementSource: "stripe",
    entitlementPlanKey: "adult_unlimited",
  });
  assert.equal(unlimited.valid, true);
  assert.equal(unlimited.appAccessTier, "full");
  assert.equal(unlimited.alphaWodAccess, true);
  assert.deepEqual(canonicalConditioningSlots([
    "thursday_1800", "tuesday_1800",
  ]), ["tuesday_1800", "thursday_1800"]);
  assert.equal(canonicalConditioningSlots(["unknown", "monday_0600"]), null);
});

test("missing and malformed profiles fail closed", () => {
  const missing = buildManagedClaims(undefined, {profileExists: false});
  assert.deepEqual(
    {
      role: missing.role,
      approvalStatus: missing.approvalStatus,
      entitlementStatus: missing.entitlementStatus,
      entitlementSource: missing.entitlementSource,
      alphaWodAccess: missing.alphaWodAccess,
      disabled: missing.disabled,
      restricted: missing.restricted,
    },
    {
      role: "user",
      approvalStatus: "pending",
      entitlementStatus: "none",
      entitlementSource: "none",
      alphaWodAccess: false,
      disabled: true,
      restricted: true,
    }
  );

  const malformed = resolveUserAuthorisation({
    role: "owner",
    approvalStatus: "yes",
    entitlementStatus: "active",
    entitlementSource: "stripe",
  });
  assert.equal(malformed.valid, false);
  assert.equal(malformed.alphaWodAccess, false);
  assert.equal(malformed.disabled, true);
});

test("admin without active staff entitlement is restricted", () => {
  const access = resolveUserAuthorisation({
    role: "admin",
    approvalStatus: "approved",
    entitlementStatus: "none",
    entitlementSource: "none",
  });
  assert.equal(access.valid, true);
  assert.equal(access.alphaWodAccess, false);
  assert.equal(access.restricted, true);
});

test("SGPT with restricted staff entitlement is restricted", () => {
  const access = resolveUserAuthorisation({
    role: "sgpt",
    approvalStatus: "approved",
    entitlementStatus: "restricted",
    entitlementSource: "staff",
  });
  assert.equal(access.valid, true);
  assert.equal(access.alphaWodAccess, false);
});

test("ordinary user cannot receive staff entitlement", () => {
  const access = resolveUserAuthorisation({
    role: "user",
    approvalStatus: "approved",
    entitlementStatus: "active",
    entitlementSource: "staff",
  });
  assert.equal(access.valid, true);
  assert.equal(access.alphaWodAccess, false);
  assert.equal(
    isEntitlementCompatibleWithRole("user", "active", "staff"),
    false
  );
  assert.equal(
    isEntitlementCompatibleWithRole("sgpt", "active", "stripe"),
    false
  );
});

test("banned users are disabled and restricted", () => {
  const access = resolveUserAuthorisation({
    role: "banned",
    approvalStatus: "approved",
    entitlementStatus: "restricted",
    entitlementSource: "manual",
  });
  assert.equal(access.valid, true);
  assert.equal(access.alphaWodAccess, false);
  assert.equal(access.disabled, true);
  assert.equal(access.restricted, true);
});

test("managed claim updates preserve unrelated claims", () => {
  const managed = buildManagedClaims({
    role: "user",
    approvalStatus: "pending",
    entitlementStatus: "none",
    entitlementSource: "none",
  });
  const merged = mergeManagedClaims({
    role: "admin",
    approvalStatus: "approved",
    alphaWodAccess: true,
    externalTenant: "keep-me",
  }, managed);

  assert.equal(merged.externalTenant, "keep-me");
  assert.equal(merged.role, "user");
  assert.equal(merged.approvalStatus, "pending");
  assert.equal(merged.alphaWodAccess, false);
  assert.equal(merged.accessSchemaVersion, ACCESS_SCHEMA_VERSION);
  assert.equal(merged.claimsVersion, CLAIMS_VERSION);
  assert.equal(claimsEqual(merged, {...merged}), true);
});

test("only complete current callable waiver evidence is canonical", () => {
  const evidence = {
    acceptanceSchemaVersion: 1,
    userId: "uid-1",
    version: CURRENT_WAIVER_VERSION,
    agreementTitle: CURRENT_WAIVER_TITLE,
    acceptedAt: {seconds: 1, nanoseconds: 0},
    acceptedName: "Member One",
    acceptedEmail: "member@example.test",
    acceptedEmailVerified: true,
    acknowledgements: [...CURRENT_WAIVER_ACKNOWLEDGEMENTS],
    mediaConsent: false,
    authenticatedAt: 1,
    signInProvider: "password",
    userAgent: "unit-test",
    source: "authenticated_callable",
  };

  assert.equal(isCanonicalCurrentWaiverAcceptance("uid-1", evidence), true);
  assert.equal(isCanonicalCurrentWaiverAcceptance("uid-1", {
    ...evidence,
    source: "legacy_user_doc_migration",
  }), false);
  assert.equal(isCanonicalCurrentWaiverAcceptance("uid-1", {
    ...evidence,
    acceptedEmailVerified: undefined,
  }), false);
  assert.equal(
    isCanonicalCurrentWaiverAcceptance("another-user", evidence),
    false
  );
});
