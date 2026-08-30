#!/usr/bin/env node

/**
 * Dry-run-first access migration.
 *
 * Historical semantics treated a missing approvalStatus as approved. This
 * script makes that legacy grant explicit, gives legitimate historical users
 * an entitlement, derives alphaWodAccess, and synchronises the complete claim
 * set without deleting claims owned by other systems.
 *
 * Preview (default):
 *   npm run backfill:claims -- --project alphawod-d1f2f
 *
 * Apply only after reviewing the preview:
 *   npm run backfill:claims -- --project alphawod-d1f2f --apply \
 *     --confirm-project alphawod-d1f2f \
 *     --approved-access-report /secure/path/phase-0-dry-run.json \
 *     --allow-implicit-approved
 *
 * Invalid roles/statuses and user docs without a matching Auth user are
 * reported and block apply unless --allow-unresolved is explicitly supplied.
 */

const fs = require("node:fs");
const admin = require("firebase-admin");
const {
  ACCESS_SCHEMA_VERSION,
  CURRENT_WAIVER_VERSION,
  buildManagedClaims,
  isAppAccessTier,
  isApprovalStatus,
  isCanonicalCurrentWaiverAcceptance,
  isEntitlementCompatibleWithRole,
  isEntitlementSource,
  isEntitlementStatus,
  isUserRole,
  mergeManagedClaims,
  resolveUserAuthorisation,
} = require("../lib/authz");

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const equalsIndex = token.indexOf("=");
    if (equalsIndex > 2) {
      parsed[token.slice(2, equalsIndex)] = token.slice(equalsIndex + 1);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

const ACCESS_REVIEW_FIELDS = [
  "userId",
  "role",
  "approvalStatus",
  "entitlementStatus",
  "entitlementSource",
  "entitlementPlanKey",
  "appAccessTier",
  "entitlementClassSlots",
  "alphaWodAccess",
];

function accessReviewEntry(userId, patch) {
  return {
    userId,
    role: patch.role,
    approvalStatus: patch.approvalStatus,
    entitlementStatus: patch.entitlementStatus,
    entitlementSource: patch.entitlementSource,
    entitlementPlanKey: typeof patch.entitlementPlanKey === "string" ?
      patch.entitlementPlanKey : null,
    appAccessTier: patch.appAccessTier,
    entitlementClassSlots: patch.entitlementClassSlots,
    alphaWodAccess: patch.alphaWodAccess,
  };
}

function accessGrantCandidate(userId, patch) {
  return patch.alphaWodAccess === true ? accessReviewEntry(userId, patch) : null;
}

function canonicalAccessReviewEntries(entries) {
  if (!Array.isArray(entries)) {
    throw new Error("The approved access report has no accessGrantCandidates array.");
  }

  const seen = new Set();
  const canonical = entries.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("The approved access report contains an invalid candidate.");
    }
    const keys = Object.keys(entry).sort();
    if (JSON.stringify(keys) !== JSON.stringify([...ACCESS_REVIEW_FIELDS].sort())) {
      throw new Error("The approved access report candidate shape is invalid.");
    }
    if (typeof entry.userId !== "string" || !entry.userId ||
      !isUserRole(entry.role) || !isApprovalStatus(entry.approvalStatus) ||
      !isEntitlementStatus(entry.entitlementStatus) ||
      !isEntitlementSource(entry.entitlementSource) ||
      !(entry.entitlementPlanKey === null ||
        typeof entry.entitlementPlanKey === "string") ||
      !isAppAccessTier(entry.appAccessTier) ||
      !Array.isArray(entry.entitlementClassSlots) ||
      entry.alphaWodAccess !== true) {
      throw new Error("The approved access report contains an invalid access grant.");
    }
    const resolved = resolveUserAuthorisation(entry);
    if (!resolved.valid || !resolved.alphaWodAccess ||
      resolved.appAccessTier !== entry.appAccessTier ||
      JSON.stringify(resolved.entitlementClassSlots) !==
        JSON.stringify(entry.entitlementClassSlots)) {
      throw new Error("The approved access report contains an invalid access policy.");
    }
    if (seen.has(entry.userId)) {
      throw new Error(`The approved access report repeats user ${entry.userId}.`);
    }
    seen.add(entry.userId);
    return Object.fromEntries(ACCESS_REVIEW_FIELDS.map((field) => [field, entry[field]]));
  });

  return canonical.sort((left, right) => left.userId.localeCompare(right.userId));
}

function assertApprovedAccessReport(reportPath, projectId, candidates) {
  if (!reportPath) {
    throw new Error(
      "Refusing to grant migrated access without --approved-access-report " +
      "pointing to the reviewed dry-run JSON."
    );
  }

  let report;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read the approved access report: ${error.message}`);
  }
  if (!report || report.projectId !== projectId || report.mode !== "dry-run") {
    throw new Error(
      "The approved access report must be a dry run for the exact target project."
    );
  }

  const approved = canonicalAccessReviewEntries(report.accessGrantCandidates);
  const current = canonicalAccessReviewEntries(candidates);
  if (JSON.stringify(approved) !== JSON.stringify(current)) {
    throw new Error(
      "The current access grants do not exactly match the reviewed dry-run report. " +
      "Run and review a fresh dry run before applying."
    );
  }
}

function desiredHistoricalAccess(data) {
  const rawRole = data.role;
  const rawApproval = data.approvalStatus;
  const role = rawRole === undefined || rawRole === null || rawRole === "" ?
    "user" : rawRole;
  const implicitApproval = rawApproval === undefined || rawApproval === null ||
    rawApproval === "";
  const approvalStatus = implicitApproval ? "approved" : rawApproval;

  if (!isUserRole(role)) {
    return {error: "invalid_role"};
  }
  if (!isApprovalStatus(approvalStatus)) {
    return {error: "invalid_approval_status"};
  }

  const hasStatus = data.entitlementStatus !== undefined &&
    data.entitlementStatus !== null && data.entitlementStatus !== "";
  const hasSource = data.entitlementSource !== undefined &&
    data.entitlementSource !== null && data.entitlementSource !== "";
  let entitlementStatus;
  let entitlementSource;
  if (hasStatus || hasSource) {
    if (!hasStatus || !hasSource || !isEntitlementStatus(data.entitlementStatus) ||
      !isEntitlementSource(data.entitlementSource) ||
      !isEntitlementCompatibleWithRole(
        role,
        data.entitlementStatus,
        data.entitlementSource
      )) {
      return {error: "invalid_entitlement"};
    }
    entitlementStatus = data.entitlementStatus;
    entitlementSource = data.entitlementSource;
  } else if (role === "banned") {
    entitlementStatus = "restricted";
    entitlementSource = "manual";
  } else if (approvalStatus === "approved" && (role === "admin" || role === "sgpt")) {
    entitlementStatus = "active";
    entitlementSource = "staff";
  } else if (approvalStatus === "approved") {
    entitlementStatus = "active";
    entitlementSource = "legacy";
  } else {
    entitlementStatus = "none";
    entitlementSource = "none";
  }

  const entitlementPlanKeyPresent = data.entitlementPlanKey !== undefined &&
    data.entitlementPlanKey !== null && data.entitlementPlanKey !== "";
  if (entitlementPlanKeyPresent && typeof data.entitlementPlanKey !== "string") {
    return {error: "invalid_access_policy"};
  }
  const next = {
    role,
    approvalStatus,
    entitlementStatus,
    entitlementSource,
    ...(entitlementPlanKeyPresent ? {
      entitlementPlanKey: data.entitlementPlanKey,
    } : {}),
    ...(data.appAccessTier !== undefined && data.appAccessTier !== null ? {
      appAccessTier: data.appAccessTier,
    } : {}),
    ...(data.entitlementClassSlots !== undefined ? {
      entitlementClassSlots: data.entitlementClassSlots,
    } : {}),
  };
  const access = resolveUserAuthorisation(next);
  if (!access.valid) return {error: "invalid_access_policy"};
  return {next, access, implicitApproval};
}

function profileAccessStateForAuth(profile, authUser) {
  const authDisabled = authUser?.disabled === true;
  const next = {...profile};
  const resolved = resolveUserAuthorisation(next);
  const access = authDisabled ? {
    ...resolved,
    appAccessTier: "none",
    entitlementClassSlots: [],
    alphaWodAccess: false,
    disabled: true,
    restricted: true,
  } : resolved;
  return {
    profile: {
      ...next,
      // Auth-disabled and pending users retain the frozen membership policy in
      // Firestore. Only claims and alphaWodAccess represent effective access.
      appAccessTier: resolved.entitlementPolicyAppAccessTier,
      entitlementClassSlots: resolved.entitlementPolicyClassSlots,
      alphaWodAccess: access.alphaWodAccess,
    },
    access,
    authDisabled,
  };
}

async function listAllAuthUsers() {
  const users = [];
  let pageToken;
  do {
    const page = await admin.auth().listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

function privilegedClaimSnapshot(authUser) {
  const claims = authUser.customClaims || {};
  if (claims.role !== "admin" && claims.role !== "sgpt" &&
    claims.approvalStatus !== "approved" && claims.alphaWodAccess !== true) {
    return null;
  }
  return {
    userId: authUser.uid,
    role: claims.role ?? null,
    approvalStatus: claims.approvalStatus ?? null,
    entitlementStatus: claims.entitlementStatus ?? null,
    entitlementSource: claims.entitlementSource ?? null,
    appAccessTier: claims.appAccessTier ?? null,
    entitlementClassSlots: Array.isArray(claims.entitlementClassSlots) ?
      claims.entitlementClassSlots : null,
    alphaWodAccess: claims.alphaWodAccess === true,
    disabled: claims.disabled === true,
    restricted: claims.restricted === true,
  };
}

function canonicalAuthIdentity(authUser) {
  return {
    email: typeof authUser.email === "string" && authUser.email.trim() ?
      authUser.email.trim().toLowerCase() : null,
    emailVerified: authUser.emailVerified === true,
  };
}

function authAuditState(authUser) {
  return {
    ...canonicalAuthIdentity(authUser),
    disabled: authUser.disabled === true,
  };
}

function assertAuthAuditState(userId, audited, current) {
  if (JSON.stringify(authAuditState(audited)) !==
    JSON.stringify(authAuditState(current))) {
    throw new Error(
      `Firebase Auth identity/disabled state changed concurrently for ${userId}. ` +
      "Stop and re-audit before applying."
    );
  }
}

function currentProfileApplyState(basePatch, authUser) {
  const state = profileAccessStateForAuth({
    ...basePatch,
    ...canonicalAuthIdentity(authUser),
  }, authUser);
  const managedClaims = buildManagedClaims(state.profile);
  if (state.authDisabled) {
    managedClaims.appAccessTier = "none";
    managedClaims.entitlementClassSlots = [];
    managedClaims.alphaWodAccess = false;
    managedClaims.disabled = true;
    managedClaims.restricted = true;
  }
  return {
    patch: state.profile,
    nextClaims: mergeManagedClaims(
      authUser.customClaims,
      managedClaims
    ),
  };
}

function currentAuthOnlyClaims(authUser) {
  return mergeManagedClaims(
    authUser.customClaims,
    buildManagedClaims(undefined, {profileExists: false})
  );
}

function requireUpdateTime(snapshot, description) {
  if (!snapshot.updateTime) {
    throw new Error(`Cannot safely update ${description}: update time is missing.`);
  }
  return snapshot.updateTime;
}

function concurrentWriteError(description, error) {
  if (error?.code === 9 || error?.code === "failed-precondition") {
    return new Error(
      `${description} changed concurrently. Stop and re-audit before applying.`
    );
  }
  return error;
}

const LEGACY_WAIVER_DETAIL_FIELDS = [
  "waiverAcceptedBy",
  "waiverAcceptedEmail",
  "waiverAcceptedName",
  "waiverAcknowledgements",
  "waiverMediaConsent",
];

const LEGACY_WAIVER_MARKER_FIELDS = [
  "waiverAcceptedVersion",
  "waiverAcceptedAt",
];

const LEGACY_WAIVER_FIELDS = [
  ...LEGACY_WAIVER_MARKER_FIELDS,
  ...LEGACY_WAIVER_DETAIL_FIELDS,
];

function presentFields(data, fields) {
  return fields.filter((field) => Object.prototype.hasOwnProperty.call(data, field));
}

function legacyWaiverFieldSnapshot(data) {
  return Object.fromEntries(LEGACY_WAIVER_FIELDS.map((field) => [field,
    Object.prototype.hasOwnProperty.call(data, field) ?
      {present: true, value: data[field]} :
      {present: false},
  ]));
}

function firestoreValueEquals(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  if (Buffer.isBuffer(left) || Buffer.isBuffer(right)) {
    return Buffer.isBuffer(left) && Buffer.isBuffer(right) && left.equals(right);
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => firestoreValueEquals(value, right[index]));
  }
  if (typeof left.isEqual === "function") {
    try {
      return left.isEqual(right) === true;
    } catch {
      return false;
    }
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] &&
      firestoreValueEquals(left[key], right[key]));
}

function legacyWaiverFieldsMatch(data, auditedSnapshot) {
  const current = legacyWaiverFieldSnapshot(data);
  return LEGACY_WAIVER_FIELDS.every((field) => {
    const audited = auditedSnapshot[field];
    const live = current[field];
    return audited?.present === live.present &&
      (!live.present || firestoreValueEquals(audited.value, live.value));
  });
}

function analyseLegacyWaiver(userId, data) {
  const markerFields = presentFields(data, LEGACY_WAIVER_MARKER_FIELDS);
  const detailFields = presentFields(data, LEGACY_WAIVER_DETAIL_FIELDS);
  if (markerFields.length === 0 && detailFields.length === 0) return null;
  const fieldSnapshot = legacyWaiverFieldSnapshot(data);

  const missing = [];
  if (typeof data.waiverAcceptedVersion !== "string" ||
    !data.waiverAcceptedVersion.trim()) missing.push("waiverAcceptedVersion");
  if (!data.waiverAcceptedAt) missing.push("waiverAcceptedAt");
  if (typeof data.waiverAcceptedName !== "string" ||
    data.waiverAcceptedName.trim().length < 2) missing.push("waiverAcceptedName");
  if (!Array.isArray(data.waiverAcknowledgements) ||
    data.waiverAcknowledgements.length === 0 ||
    !data.waiverAcknowledgements.every((item) => typeof item === "string")) {
    missing.push("waiverAcknowledgements");
  }
  if (typeof data.waiverMediaConsent !== "boolean") {
    missing.push("waiverMediaConsent");
  }

  const suppliedFields = Object.fromEntries(
    presentFields(data, LEGACY_WAIVER_FIELDS).map((field) => [field, data[field]])
  );
  const hasDetails = detailFields.length > 0;
  const complete = hasDetails && missing.length === 0;

  if (!complete) {
    return {
      complete: false,
      requiresResolution: hasDetails,
      userId,
      markerFields,
      detailFields,
      fieldSnapshot,
      missing,
      evidence: {
        acceptanceSchemaVersion: 1,
        userId,
        source: "legacy_user_doc_migration",
        evidenceStatus: hasDetails ?
          "legacy_client_record_incomplete" :
          "legacy_client_marker_unverified",
        eligibleAsAuthoritative: false,
        suppliedFields,
        ...(missing.length ? {missingFields: missing} : {}),
      },
    };
  }

  const version = data.waiverAcceptedVersion.trim();
  const evidence = {
    acceptanceSchemaVersion: 1,
    userId,
    version,
    acceptedAt: data.waiverAcceptedAt,
    acceptedName: data.waiverAcceptedName.trim(),
    acknowledgements: data.waiverAcknowledgements,
    mediaConsent: data.waiverMediaConsent,
    source: "legacy_user_doc_migration",
    evidenceStatus: "legacy_client_record_unverified",
    eligibleAsAuthoritative: false,
    ...(typeof data.waiverAcceptedBy === "string" ?
      {acceptedByUid: data.waiverAcceptedBy} : {}),
    ...(typeof data.waiverAcceptedEmail === "string" ?
      {acceptedEmail: data.waiverAcceptedEmail} : {}),
  };
  return {
    complete: true,
    requiresResolution: false,
    userId,
    version,
    markerFields,
    detailFields,
    fieldSnapshot,
    missing: [],
    evidence,
  };
}

function canonicalCurrentWaiverMarker(userId, acceptance) {
  if (!isCanonicalCurrentWaiverAcceptance(userId, acceptance)) {
    return null;
  }

  return {
    waiverAcceptedVersion: CURRENT_WAIVER_VERSION,
    waiverAcceptedAt: acceptance.acceptedAt,
  };
}

function isValidLegacyWaiverQuarantine(userId, evidence) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return false;
  }
  if (evidence.acceptanceSchemaVersion !== 1 ||
    evidence.userId !== userId ||
    evidence.source !== "legacy_user_doc_migration" ||
    evidence.eligibleAsAuthoritative !== false) {
    return false;
  }

  if (evidence.evidenceStatus === "legacy_client_record_unverified") {
    return typeof evidence.version === "string" &&
      evidence.version.trim().length > 0 &&
      Boolean(evidence.acceptedAt) &&
      typeof evidence.acceptedName === "string" &&
      evidence.acceptedName.trim().length >= 2 &&
      Array.isArray(evidence.acknowledgements) &&
      evidence.acknowledgements.length > 0 &&
      evidence.acknowledgements.every((item) => typeof item === "string") &&
      typeof evidence.mediaConsent === "boolean";
  }

  return (evidence.evidenceStatus === "legacy_client_record_incomplete" ||
    evidence.evidenceStatus === "legacy_client_marker_unverified") &&
    Boolean(evidence.suppliedFields) &&
    typeof evidence.suppliedFields === "object" &&
    !Array.isArray(evidence.suppliedFields);
}

function isProvenLegacyWaiverCleanupRerun(
  userId,
  profile,
  canonicalAcceptance,
  quarantine
) {
  const canonicalMarker = canonicalCurrentWaiverMarker(
    userId,
    canonicalAcceptance
  );
  return Boolean(canonicalMarker) &&
    presentFields(profile, LEGACY_WAIVER_DETAIL_FIELDS).length === 0 &&
    profile.waiverAcceptedVersion === canonicalMarker.waiverAcceptedVersion &&
    firestoreValueEquals(
      profile.waiverAcceptedAt,
      canonicalMarker.waiverAcceptedAt
    ) &&
    isValidLegacyWaiverQuarantine(userId, quarantine);
}

async function loadCanonicalCurrentWaivers(db, userIds) {
  const results = new Map();
  const refs = userIds.map((userId) => db.collection("waiverAcceptances")
    .doc(`${userId}__${CURRENT_WAIVER_VERSION}`));

  // BatchGet is streamed by Firestore, but small chunks keep the one-time
  // migration predictable for projects with a large historical user list.
  for (let index = 0; index < refs.length; index += 100) {
    const snapshots = await db.getAll(...refs.slice(index, index + 100));
    snapshots.forEach((snapshot) => {
      const suffix = `__${CURRENT_WAIVER_VERSION}`;
      const userId = snapshot.id.endsWith(suffix) ?
        snapshot.id.slice(0, -suffix.length) : "";
      results.set(userId, {
        exists: snapshot.exists,
        data: snapshot.exists ? snapshot.data() : undefined,
      });
    });
  }

  return results;
}

async function scanLeaderboardPii(db) {
  const rootSnap = await db.collection("leaderboards").get();
  const rootOperations = [];
  const nestedOperations = [];
  let summaryRowsWithEmail = 0;
  let userDocsWithEmail = 0;
  let dipDocsWithEmail = 0;

  for (const rootDoc of rootSnap.docs) {
    const summary = rootDoc.get("summary");
    if (summary && Array.isArray(summary.rows)) {
      let changed = false;
      const rows = summary.rows.map((row) => {
        if (!row || typeof row !== "object" ||
          !Object.prototype.hasOwnProperty.call(row, "email")) return row;
        changed = true;
        summaryRowsWithEmail += 1;
        const {email: _email, ...withoutEmail} = row;
        return withoutEmail;
      });
      if (changed) rootOperations.push({
        ref: rootDoc.ref,
        rows,
        updateTime: requireUpdateTime(rootDoc, `leaderboard ${rootDoc.id}`),
      });
    }

    for (const collectionName of ["users", "dipUsers"]) {
      const nestedSnap = await rootDoc.ref.collection(collectionName).get();
      nestedSnap.docs.forEach((nestedDoc) => {
        if (!Object.prototype.hasOwnProperty.call(nestedDoc.data(), "email")) return;
        nestedOperations.push({
          ref: nestedDoc.ref,
          updateTime: requireUpdateTime(
            nestedDoc,
            `leaderboard entry ${rootDoc.id}/${collectionName}/${nestedDoc.id}`
          ),
        });
        if (collectionName === "users") userDocsWithEmail += 1;
        else dipDocsWithEmail += 1;
      });
    }
  }

  return {
    rootOperations,
    nestedOperations,
    report: {summaryRowsWithEmail, userDocsWithEmail, dipDocsWithEmail},
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = args.project;
  const apply = args.apply === "true";
  const confirmProject = args["confirm-project"];
  const approvedAccessReport = args["approved-access-report"];
  const allowImplicitApproved = args["allow-implicit-approved"] === "true";
  const allowUnresolved = args["allow-unresolved"] === "true";

  if (!projectId) throw new Error("--project is required; no default project is permitted.");
  if (apply && confirmProject !== projectId) {
    throw new Error("Apply requires --confirm-project to exactly match --project.");
  }
  const reportFile = args.report ? fs.openSync(args.report, "wx") : null;

  admin.initializeApp({projectId});
  const db = admin.firestore();
  const snap = await db.collection("users").get();
  const authUsers = await listAllAuthUsers();
  const authUsersById = new Map(authUsers.map((user) => [user.uid, user]));
  const firestoreUserIds = new Set(snap.docs.map((doc) => doc.id));
  const legacyWaiversByUserId = new Map(snap.docs
    .map((doc) => [doc.id, analyseLegacyWaiver(doc.id, doc.data() || {})])
    .filter(([, analysis]) => Boolean(analysis)));
  const canonicalCurrentWaivers = await loadCanonicalCurrentWaivers(
    db,
    [...legacyWaiversByUserId.keys()]
  );
  const operations = [];
  const authOnlyClaimOperations = [];
  const waiverOperations = [];
  const report = {
    projectId,
    mode: apply ? "apply" : "dry-run",
    scanned: snap.size,
    scannedAuthUsers: authUsers.length,
    migratable: 0,
    implicitApproved: [],
    invalid: [],
    missingAuthUsers: [],
    changes: [],
    accessGrantCandidates: [],
    privilegedClaimCandidates: authUsers
      .map(privilegedClaimSnapshot)
      .filter(Boolean),
    authUsersWithoutProfiles: [],
    identityCorrections: [],
    disabledAuthUsers: [],
    legacyWaivers: {detected: [], eligible: [], incomplete: []},
    leaderboardPii: null,
  };

  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const legacyWaiver = legacyWaiversByUserId.get(doc.id);
    if (legacyWaiver) {
      waiverOperations.push({userRef: doc.ref, ...legacyWaiver});
      const canonicalRecord = canonicalCurrentWaivers.get(doc.id);
      const canonicalMarker = canonicalCurrentWaiverMarker(
        doc.id,
        canonicalRecord?.data
      );
      report.legacyWaivers.detected.push({
        userId: doc.id,
        markerFields: legacyWaiver.markerFields,
        detailFields: legacyWaiver.detailFields,
        evidenceStatus: legacyWaiver.evidence.evidenceStatus,
        canonicalCurrentRecord: canonicalMarker ?
          "valid" : canonicalRecord?.exists ? "invalid" : "missing",
        action: canonicalMarker ?
          "quarantine_legacy_and_restore_canonical_marker" :
          "quarantine_legacy_and_clear_marker",
      });
    }
    if (legacyWaiver?.complete) {
      report.legacyWaivers.eligible.push(doc.id);
    } else if (legacyWaiver?.requiresResolution) {
      report.legacyWaivers.incomplete.push({
        userId: doc.id,
        missing: legacyWaiver.missing,
      });
    }

    const desired = desiredHistoricalAccess(data);
    if (desired.error) {
      report.invalid.push({userId: doc.id, reason: desired.error});
      continue;
    }

    const authUser = authUsersById.get(doc.id);
    if (!authUser) {
      report.missingAuthUsers.push(doc.id);
      continue;
    }
    if (desired.implicitApproval) report.implicitApproved.push(doc.id);
    const canonicalIdentity = canonicalAuthIdentity(authUser);
    if ((data.email ?? null) !== canonicalIdentity.email ||
      data.emailVerified !== canonicalIdentity.emailVerified) {
      report.identityCorrections.push({
        userId: doc.id,
        emailChanged: (data.email ?? null) !== canonicalIdentity.email,
        emailVerifiedChanged:
          data.emailVerified !== canonicalIdentity.emailVerified,
      });
    }

    const authAccess = profileAccessStateForAuth(desired.next, authUser);
    const patch = {
      ...authAccess.profile,
      ...canonicalIdentity,
      accessSchemaVersion: ACCESS_SCHEMA_VERSION,
      profileSchemaVersion: 1,
      accessMigratedFromLegacy: true,
      accessMigrationVersion: 1,
    };
    if (authAccess.authDisabled) report.disabledAuthUsers.push(doc.id);
    operations.push({doc, patch, auditedAuthUser: authUser});
    report.migratable += 1;
    report.changes.push({
      userId: doc.id,
      role: patch.role,
      approvalStatus: patch.approvalStatus,
      entitlementStatus: patch.entitlementStatus,
      entitlementSource: patch.entitlementSource,
      entitlementPlanKey: patch.entitlementPlanKey ?? null,
      appAccessTier: patch.appAccessTier,
      entitlementClassSlots: patch.entitlementClassSlots,
      alphaWodAccess: patch.alphaWodAccess,
      authDisabled: authAccess.authDisabled,
      implicitApproval: desired.implicitApproval,
    });
    const grantCandidate = accessGrantCandidate(doc.id, patch);
    if (grantCandidate) report.accessGrantCandidates.push(grantCandidate);
  }

  report.accessGrantCandidates.sort((left, right) =>
    left.userId.localeCompare(right.userId)
  );
  report.privilegedClaimCandidates.sort((left, right) =>
    left.userId.localeCompare(right.userId)
  );
  report.identityCorrections.sort((left, right) =>
    left.userId.localeCompare(right.userId)
  );
  report.disabledAuthUsers.sort((left, right) => left.localeCompare(right));
  report.legacyWaivers.detected.sort((left, right) =>
    left.userId.localeCompare(right.userId)
  );
  report.legacyWaivers.eligible.sort((left, right) => left.localeCompare(right));
  report.legacyWaivers.incomplete.sort((left, right) =>
    left.userId.localeCompare(right.userId)
  );

  for (const authUser of authUsers) {
    if (firestoreUserIds.has(authUser.uid)) continue;
    authOnlyClaimOperations.push({authUser});
    report.authUsersWithoutProfiles.push({
      userId: authUser.uid,
      existingPrivilegedClaims: privilegedClaimSnapshot(authUser),
    });
  }
  report.authUsersWithoutProfiles.sort((left, right) =>
    left.userId.localeCompare(right.userId)
  );

  const leaderboardPii = await scanLeaderboardPii(db);
  report.leaderboardPii = leaderboardPii.report;

  if (apply && report.implicitApproved.length > 0 && !allowImplicitApproved) {
    throw new Error(
      `Refusing to apply: ${report.implicitApproved.length} users rely on the historical ` +
      "missing-means-approved rule. Review the dry run, then pass --allow-implicit-approved."
    );
  }
  if (apply && !allowUnresolved &&
    (report.invalid.length > 0 || report.missingAuthUsers.length > 0 ||
      report.legacyWaivers.incomplete.length > 0)) {
    throw new Error(
      "Refusing to apply while invalid users, missing Auth users, or incomplete legacy " +
      "waivers remain. Resolve them or explicitly pass --allow-unresolved after review."
    );
  }
  if (apply && report.accessGrantCandidates.length > 0) {
    assertApprovedAccessReport(
      approvedAccessReport,
      projectId,
      report.accessGrantCandidates
    );
  }

  if (apply) {
    for (const operation of operations) {
      const userId = operation.doc.id;
      const currentAuthUser = await admin.auth().getUser(userId);
      assertAuthAuditState(userId, operation.auditedAuthUser, currentAuthUser);
      const liveState = currentProfileApplyState(operation.patch, currentAuthUser);

      try {
        await operation.doc.ref.update({
          ...liveState.patch,
          accessMigratedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, {
          lastUpdateTime: requireUpdateTime(
            operation.doc,
            `user profile ${userId}`
          ),
        });
      } catch (error) {
        throw concurrentWriteError(`User profile ${userId}`, error);
      }

      // Auth has no compare-and-swap API for custom claims. Re-fetch as close
      // as possible to the replacing write so unrelated current claims are
      // merged rather than overwritten from the earlier audit snapshot.
      const latestAuthUser = await admin.auth().getUser(userId);
      assertAuthAuditState(userId, operation.auditedAuthUser, latestAuthUser);
      const nextClaims = currentProfileApplyState(
        liveState.patch,
        latestAuthUser
      ).nextClaims;
      await admin.auth().setCustomUserClaims(userId, nextClaims);
    }

    for (const operation of authOnlyClaimOperations) {
      const userId = operation.authUser.uid;
      const profile = await db.collection("users").doc(userId).get();
      if (profile.exists) {
        throw new Error(
          `Auth-only user ${userId} gained a profile concurrently. ` +
          "Stop and re-audit before applying."
        );
      }
      const latestAuthUser = await admin.auth().getUser(userId);
      assertAuthAuditState(userId, operation.authUser, latestAuthUser);
      await admin.auth().setCustomUserClaims(
        userId,
        currentAuthOnlyClaims(latestAuthUser)
      );
    }

    for (const waiver of waiverOperations) {
      const quarantineRef = db.collection("waiverAcceptances")
        .doc(`${waiver.userId}__legacy__phase0`);
      const canonicalRef = db.collection("waiverAcceptances")
        .doc(`${waiver.userId}__${CURRENT_WAIVER_VERSION}`);
      await db.runTransaction(async (tx) => {
        const [currentUser, existingQuarantine, canonicalSnapshot] = await Promise.all([
          tx.get(waiver.userRef),
          tx.get(quarantineRef),
          tx.get(canonicalRef),
        ]);
        if (!currentUser.exists || !legacyWaiverFieldsMatch(
          currentUser.data() || {},
          waiver.fieldSnapshot
        )) {
          throw new Error(
            `Legacy waiver fields changed concurrently for ${waiver.userId}. ` +
            "Stop and re-audit before applying."
          );
        }
        const currentUserData = currentUser.data() || {};
        const canonicalAcceptance = canonicalSnapshot.exists ?
          canonicalSnapshot.data() : undefined;
        const canonicalMarker = canonicalCurrentWaiverMarker(
          waiver.userId,
          canonicalAcceptance
        );
        if (existingQuarantine.exists && !firestoreValueEquals(
          existingQuarantine.data(),
          waiver.evidence
        ) && !isProvenLegacyWaiverCleanupRerun(
          waiver.userId,
          currentUserData,
          canonicalAcceptance,
          existingQuarantine.data()
        )) {
          throw new Error(
            `Legacy waiver quarantine changed concurrently for ${waiver.userId}. ` +
            "Stop and re-audit before applying."
          );
        }
        if (!existingQuarantine.exists) {
          tx.create(quarantineRef, waiver.evidence);
        }
        const markerPatch = canonicalMarker || {
          waiverAcceptedVersion: admin.firestore.FieldValue.delete(),
          waiverAcceptedAt: admin.firestore.FieldValue.delete(),
        };
        tx.set(waiver.userRef, {
          ...markerPatch,
          waiverAcceptedBy: admin.firestore.FieldValue.delete(),
          waiverAcceptedEmail: admin.firestore.FieldValue.delete(),
          waiverAcceptedName: admin.firestore.FieldValue.delete(),
          waiverAcknowledgements: admin.firestore.FieldValue.delete(),
          waiverMediaConsent: admin.firestore.FieldValue.delete(),
        }, {merge: true});
      });
    }

    for (const operation of leaderboardPii.rootOperations) {
      try {
        await operation.ref.update(
          {"summary.rows": operation.rows},
          {lastUpdateTime: operation.updateTime}
        );
      } catch (error) {
        throw concurrentWriteError(
          `Leaderboard ${operation.ref.path}`,
          error
        );
      }
    }
    for (const operation of leaderboardPii.nestedOperations) {
      try {
        await operation.ref.update(
          {email: admin.firestore.FieldValue.delete()},
          {lastUpdateTime: operation.updateTime}
        );
      } catch (error) {
        throw concurrentWriteError(
          `Leaderboard entry ${operation.ref.path}`,
          error
        );
      }
    }
  }

  if (reportFile !== null) {
    fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
    fs.closeSync(reportFile);
  }
  console.log(JSON.stringify(report, null, 2));
  console.log(apply ? "Migration applied." : "Dry run only; no data was changed.");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
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
};
