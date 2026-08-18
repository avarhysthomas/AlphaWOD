/* eslint-disable @typescript-eslint/no-var-requires */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CURRENT_WAIVER_ACKNOWLEDGEMENTS,
  CURRENT_WAIVER_TITLE,
  CURRENT_WAIVER_VERSION,
  buildManagedClaims,
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
