/* eslint-disable @typescript-eslint/no-var-requires */

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  accessGrantCandidate,
  analyseLegacyWaiver,
  assertApprovedAccessReport,
  assertAuthAuditState,
  authAuditState,
  canonicalAuthIdentity,
  canonicalAccessReviewEntries,
  canonicalCurrentWaiverMarker,
  concurrentWriteError,
  currentAuthOnlyClaims,
  currentProfileApplyState,
  desiredHistoricalAccess,
  isProvenLegacyWaiverCleanupRerun,
  isValidLegacyWaiverQuarantine,
  legacyWaiverFieldSnapshot,
  legacyWaiverFieldsMatch,
  profileAccessStateForAuth,
  privilegedClaimSnapshot,
  requireUpdateTime,
} = require("../scripts/backfillClaims");
const {
  CURRENT_WAIVER_ACKNOWLEDGEMENTS,
  CURRENT_WAIVER_TITLE,
  CURRENT_WAIVER_VERSION,
} = require("../lib/authz");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test(
  "legacy approved members without entitlement receive legacy access",
  () => {
    const result = desiredHistoricalAccess({
      role: "user",
      approvalStatus: "approved",
    });
    assert.deepEqual(result.next, {
      role: "user",
      approvalStatus: "approved",
      entitlementStatus: "active",
      entitlementSource: "legacy",
    });
    assert.equal(result.access.alphaWodAccess, true);
  }
);

test("disabled Auth users are restricted and excluded from grants", () => {
  const historical = desiredHistoricalAccess({
    role: "user",
    approvalStatus: "approved",
  });
  const scanState = profileAccessStateForAuth(
    historical.next,
    {disabled: true}
  );

  assert.equal(scanState.authDisabled, true);
  assert.equal(scanState.profile.entitlementStatus, "restricted");
  assert.equal(scanState.profile.entitlementSource, "legacy");
  assert.equal(scanState.profile.alphaWodAccess, false);
  assert.equal(scanState.access.alphaWodAccess, false);
  assert.equal(accessGrantCandidate("uid-disabled", scanState.profile), null);
  assert.deepEqual(
    profileAccessStateForAuth(scanState.profile, {disabled: true}).profile,
    scanState.profile
  );

  const applyState = currentProfileApplyState({
    ...historical.next,
    alphaWodAccess: true,
  }, {
    disabled: true,
    email: "DISABLED@Example.Test",
    emailVerified: true,
    customClaims: {externalTenant: "keep-me", alphaWodAccess: true},
  });
  assert.equal(applyState.patch.entitlementStatus, "restricted");
  assert.equal(applyState.patch.alphaWodAccess, false);
  assert.equal(applyState.nextClaims.alphaWodAccess, false);
  assert.equal(applyState.nextClaims.disabled, true);
  assert.equal(applyState.nextClaims.restricted, true);
  assert.equal(applyState.nextClaims.externalTenant, "keep-me");
});

test("migration preserves an explicit restriction", () => {
  const result = desiredHistoricalAccess({
    role: "user",
    approvalStatus: "approved",
    entitlementStatus: "restricted",
    entitlementSource: "manual",
  });
  assert.deepEqual(result.next, {
    role: "user",
    approvalStatus: "approved",
    entitlementStatus: "restricted",
    entitlementSource: "manual",
  });
  assert.equal(result.access.alphaWodAccess, false);
});

test("migration reports invalid partial entitlement data", () => {
  assert.equal(
    desiredHistoricalAccess({
      role: "user",
      approvalStatus: "approved",
      entitlementStatus: "active",
    }).error,
    "invalid_entitlement"
  );
});

test("legacy waiver migration refuses incomplete evidence", () => {
  const result = analyseLegacyWaiver("uid-1", {
    waiverAcceptedVersion: "2026-30-05",
    waiverAcceptedName: "Member",
    waiverMediaConsent: false,
  });
  assert.equal(result.complete, false);
  assert.equal(result.missing.includes("waiverAcceptedAt"), true);
  assert.equal(result.missing.includes("waiverAcknowledgements"), true);
});

test("legacy waiver migration preserves supplied evidence", () => {
  const acceptedAt = {seconds: 1, nanoseconds: 0};
  const result = analyseLegacyWaiver("uid-1", {
    waiverAcceptedVersion: "2026-30-05",
    waiverAcceptedAt: acceptedAt,
    waiverAcceptedName: "Member",
    waiverAcceptedEmail: "member@example.com",
    waiverAcknowledgements: ["Accepted text"],
    waiverMediaConsent: false,
  });
  assert.equal(result.complete, true);
  assert.equal(result.evidence.acceptedAt, acceptedAt);
  assert.equal(result.evidence.acceptedEmail, "member@example.com");
  assert.deepEqual(result.evidence.acknowledgements, ["Accepted text"]);
  assert.equal(result.evidence.eligibleAsAuthoritative, false);
  assert.equal(
    result.evidence.evidenceStatus,
    "legacy_client_record_unverified"
  );
});

test("legacy waiver migration detects marker-only forged acceptance", () => {
  const acceptedAt = {seconds: 1, nanoseconds: 0};
  const result = analyseLegacyWaiver("uid-1", {
    waiverAcceptedVersion: CURRENT_WAIVER_VERSION,
    waiverAcceptedAt: acceptedAt,
  });

  assert.equal(result.complete, false);
  assert.equal(result.requiresResolution, false);
  assert.deepEqual(result.markerFields, [
    "waiverAcceptedVersion",
    "waiverAcceptedAt",
  ]);
  assert.deepEqual(result.detailFields, []);
  assert.equal(
    result.evidence.evidenceStatus,
    "legacy_client_marker_unverified"
  );
  assert.equal(result.evidence.eligibleAsAuthoritative, false);
});

test("waiver cleanup requires the exact audited legacy fields", () => {
  const auditedData = {
    waiverAcceptedVersion: CURRENT_WAIVER_VERSION,
    waiverAcceptedAt: {seconds: 1, nanoseconds: 2},
    waiverAcceptedName: "Member One",
    waiverAcknowledgements: ["legacy acknowledgement"],
    waiverMediaConsent: false,
  };
  const snapshot = legacyWaiverFieldSnapshot(auditedData);

  assert.equal(legacyWaiverFieldsMatch({
    ...auditedData,
    waiverAcceptedAt: {seconds: 1, nanoseconds: 2},
    role: "user",
    accessMigrationVersion: 1,
    updatedAt: {seconds: 99, nanoseconds: 0},
  }, snapshot), true);
  assert.equal(legacyWaiverFieldsMatch({
    ...auditedData,
    waiverAcceptedName: "Concurrent Admin Edit",
  }, snapshot), false);
  assert.equal(legacyWaiverFieldsMatch({
    ...auditedData,
    waiverAcceptedEmail: "new@example.test",
  }, snapshot), false);
  const withoutAcceptedAt = {...auditedData};
  delete withoutAcceptedAt.waiverAcceptedAt;
  assert.equal(legacyWaiverFieldsMatch(withoutAcceptedAt, snapshot), false);
});

test("only exact canonical waiver evidence restores the marker", () => {
  const acceptedAt = {seconds: 1, nanoseconds: 0};
  const canonical = {
    acceptanceSchemaVersion: 1,
    userId: "uid-1",
    version: CURRENT_WAIVER_VERSION,
    agreementTitle: CURRENT_WAIVER_TITLE,
    source: "authenticated_callable",
    acceptedAt,
    acceptedName: "Member One",
    acceptedEmail: "member@example.test",
    acceptedEmailVerified: true,
    acknowledgements: [...CURRENT_WAIVER_ACKNOWLEDGEMENTS],
    mediaConsent: false,
    authenticatedAt: 1,
    signInProvider: "password",
    userAgent: "migration-test",
  };

  assert.deepEqual(canonicalCurrentWaiverMarker("uid-1", canonical), {
    waiverAcceptedVersion: CURRENT_WAIVER_VERSION,
    waiverAcceptedAt: acceptedAt,
  });
  assert.equal(canonicalCurrentWaiverMarker("uid-1", {
    ...canonical,
    source: "legacy_user_doc_migration",
  }), null);
  assert.equal(canonicalCurrentWaiverMarker("uid-1", {
    ...canonical,
    userId: "another-user",
  }), null);
  assert.equal(canonicalCurrentWaiverMarker("uid-1", {
    ...canonical,
    acknowledgements: ["forged"],
  }), null);
  assert.equal(canonicalCurrentWaiverMarker("uid-1", {
    ...canonical,
    acceptedAt: "forged timestamp",
  }), null);
});

test(
  "canonical waiver cleanup with a full archive is safely rerunnable",
  () => {
    const acceptedAt = {seconds: 1, nanoseconds: 0};
    const canonical = {
      acceptanceSchemaVersion: 1,
      userId: "uid-1",
      version: CURRENT_WAIVER_VERSION,
      agreementTitle: CURRENT_WAIVER_TITLE,
      source: "authenticated_callable",
      acceptedAt,
      acceptedName: "Member One",
      acceptedEmail: "member@example.test",
      acceptedEmailVerified: true,
      acknowledgements: [...CURRENT_WAIVER_ACKNOWLEDGEMENTS],
      mediaConsent: false,
      authenticatedAt: 1,
      signInProvider: "password",
      userAgent: "migration-test",
    };
    const fullLegacyArchive = {
      acceptanceSchemaVersion: 1,
      userId: "uid-1",
      version: "legacy-v1",
      acceptedAt: {seconds: 0, nanoseconds: 0},
      acceptedName: "Legacy Member",
      acknowledgements: ["legacy acknowledgement"],
      mediaConsent: false,
      source: "legacy_user_doc_migration",
      evidenceStatus: "legacy_client_record_unverified",
      eligibleAsAuthoritative: false,
    };
    const canonicalMarkerOnlyProfile = {
      waiverAcceptedVersion: CURRENT_WAIVER_VERSION,
      waiverAcceptedAt: acceptedAt,
    };

    assert.equal(
      isValidLegacyWaiverQuarantine("uid-1", fullLegacyArchive),
      true
    );
    assert.equal(isProvenLegacyWaiverCleanupRerun(
      "uid-1",
      canonicalMarkerOnlyProfile,
      canonical,
      fullLegacyArchive
    ), true);
    assert.equal(isProvenLegacyWaiverCleanupRerun(
      "uid-1",
      {...canonicalMarkerOnlyProfile, waiverAcceptedName: "Live full record"},
      canonical,
      fullLegacyArchive
    ), false);
    assert.equal(isProvenLegacyWaiverCleanupRerun(
      "uid-1",
      {...canonicalMarkerOnlyProfile, waiverAcceptedEmail: "live@example.test"},
      canonical,
      fullLegacyArchive
    ), false);
    assert.equal(isProvenLegacyWaiverCleanupRerun(
      "uid-1",
      {
        ...canonicalMarkerOnlyProfile,
        waiverAcceptedAt: {seconds: 2, nanoseconds: 0},
      },
      canonical,
      fullLegacyArchive
    ), false);
    assert.equal(isProvenLegacyWaiverCleanupRerun(
      "uid-1",
      canonicalMarkerOnlyProfile,
      canonical,
      {...fullLegacyArchive, userId: "another-user"}
    ), false);
    assert.equal(isProvenLegacyWaiverCleanupRerun(
      "uid-1",
      canonicalMarkerOnlyProfile,
      {...canonical, source: "legacy_user_doc_migration"},
      fullLegacyArchive
    ), false);
    assert.equal(isProvenLegacyWaiverCleanupRerun(
      "uid-1",
      canonicalMarkerOnlyProfile,
      canonical,
      {...fullLegacyArchive, eligibleAsAuthoritative: true}
    ), false);
  }
);

const reviewedGrant = {
  userId: "uid-1",
  role: "user",
  approvalStatus: "approved",
  entitlementStatus: "active",
  entitlementSource: "legacy",
  alphaWodAccess: true,
};

test("access review rejects duplicate or malformed grants", () => {
  assert.throws(
    () => canonicalAccessReviewEntries([reviewedGrant, reviewedGrant]),
    /repeats user uid-1/
  );
  assert.throws(
    () => canonicalAccessReviewEntries([{...reviewedGrant, unexpected: true}]),
    /shape is invalid/
  );
});

test("apply access review must exactly match the dry-run candidates", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "phase-0-access-review-")
  );
  const reportPath = path.join(directory, "review.json");
  fs.writeFileSync(reportPath, JSON.stringify({
    projectId: "alphawod-d1f2f",
    mode: "dry-run",
    accessGrantCandidates: [reviewedGrant],
  }));

  assert.doesNotThrow(() => assertApprovedAccessReport(
    reportPath,
    "alphawod-d1f2f",
    [reviewedGrant]
  ));
  assert.throws(
    () => assertApprovedAccessReport(
      reportPath,
      "another-project",
      [reviewedGrant]
    ),
    /exact target project/
  );
  assert.throws(
    () => assertApprovedAccessReport(reportPath, "alphawod-d1f2f", [
      {...reviewedGrant, role: "admin", entitlementSource: "staff"},
    ]),
    /do not exactly match/
  );
});

test("privileged legacy Auth claims are surfaced for the initial audit", () => {
  assert.deepEqual(privilegedClaimSnapshot({
    uid: "uid-1",
    customClaims: {
      role: "admin",
      approvalStatus: "approved",
      alphaWodAccess: true,
    },
  }), {
    userId: "uid-1",
    role: "admin",
    approvalStatus: "approved",
    entitlementStatus: null,
    entitlementSource: null,
    alphaWodAccess: true,
    disabled: false,
    restricted: false,
  });
  assert.equal(privilegedClaimSnapshot({
    uid: "uid-2",
    customClaims: {role: "user", approvalStatus: "pending"},
  }), null);
});

test("migration canonicalises profile email from Firebase Auth", () => {
  assert.deepEqual(canonicalAuthIdentity({
    email: "  MEMBER@Example.Test ",
    emailVerified: true,
  }), {
    email: "member@example.test",
    emailVerified: true,
  });
  assert.deepEqual(canonicalAuthIdentity({emailVerified: false}), {
    email: null,
    emailVerified: false,
  });
});

test("apply uses current Auth identity and unrelated claims", () => {
  const basePatch = {
    role: "user",
    approvalStatus: "approved",
    entitlementStatus: "active",
    entitlementSource: "legacy",
    alphaWodAccess: true,
  };
  const state = currentProfileApplyState(basePatch, {
    email: "LATEST@Example.Test",
    emailVerified: true,
    customClaims: {
      role: "admin",
      alphaWodAccess: true,
      externalTenant: "latest-value",
    },
  });

  assert.equal(state.patch.email, "latest@example.test");
  assert.equal(state.patch.emailVerified, true);
  assert.equal(state.nextClaims.role, "user");
  assert.equal(state.nextClaims.alphaWodAccess, true);
  assert.equal(state.nextClaims.externalTenant, "latest-value");

  const authOnly = currentAuthOnlyClaims({
    customClaims: {role: "admin", externalTenant: "keep-me"},
  });
  assert.equal(authOnly.role, "user");
  assert.equal(authOnly.alphaWodAccess, false);
  assert.equal(authOnly.disabled, true);
  assert.equal(authOnly.externalTenant, "keep-me");
});

test("apply aborts when audited Auth state changes", () => {
  const audited = {
    email: "member@example.test",
    emailVerified: false,
    disabled: false,
  };
  assert.deepEqual(authAuditState(audited), audited);
  assert.doesNotThrow(() => assertAuthAuditState(
    "uid-1",
    audited,
    {...audited, customClaims: {externalTenant: "changed safely"}}
  ));
  assert.throws(
    () => assertAuthAuditState("uid-1", audited, {...audited, disabled: true}),
    /changed concurrently for uid-1/
  );
  assert.throws(
    () => assertAuthAuditState("uid-1", audited, {
      ...audited,
      email: "changed@example.test",
    }),
    /changed concurrently for uid-1/
  );
});

test("migration writes require and surface optimistic concurrency", () => {
  const updateTime = {seconds: 1, nanoseconds: 2};
  assert.equal(requireUpdateTime({updateTime}, "profile"), updateTime);
  assert.throws(
    () => requireUpdateTime({}, "profile uid-1"),
    /update time is missing/
  );

  const conflict = concurrentWriteError("User profile uid-1", {code: 9});
  assert.match(conflict.message, /changed concurrently/);
  const other = new Error("transport failed");
  assert.equal(concurrentWriteError("User profile uid-1", other), other);
});
