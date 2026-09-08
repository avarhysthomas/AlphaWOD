/* eslint-disable @typescript-eslint/no-var-requires, max-len, require-jsdoc */

const test = require("node:test");
const assert = require("node:assert/strict");
const admin = require("firebase-admin");
const functionsTest = require("firebase-functions-test")();
const functions = require("../lib/index");
const {
  CURRENT_WAIVER_ACKNOWLEDGEMENTS,
  CURRENT_WAIVER_VERSION,
} = require("../lib/authz");

const projectId = process.env.GCLOUD_PROJECT || "alpha-wod-functions-test";
const db = admin.firestore();
const bootstrapUserProfile = functionsTest.wrap(functions.bootstrapUserProfile);
const acceptCurrentWaiver = functionsTest.wrap(functions.acceptCurrentWaiver);
const listStaffUsers = functionsTest.wrap(functions.listStaffUsers);
const setMemberEntitlement = functionsTest.wrap(functions.setMemberEntitlement);
const getMonthlyLeaderboard = functionsTest.wrap(functions.getMonthlyLeaderboard);

function request(data, uid) {
  return {
    data,
    ...(uid ? {auth: {uid, token: {auth_time: 1, firebase: {
      sign_in_provider: "password",
    }}}} : {}),
    rawRequest: {get: () => "phase-0-emulator-test"},
    acceptsStreaming: false,
  };
}

async function clearEmulators() {
  const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  assert.ok(firestoreHost, "FIRESTORE_EMULATOR_HOST is required");
  assert.ok(authHost, "FIREBASE_AUTH_EMULATOR_HOST is required");
  await fetch(
    `http://${firestoreHost}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    {method: "DELETE"}
  );
  await fetch(`http://${authHost}/emulator/v1/projects/${projectId}/accounts`, {
    method: "DELETE",
  });
}

async function createAuthUser(uid, email = `${uid}@example.test`) {
  return admin.auth().createUser({uid, email, emailVerified: true});
}

function activeProfile(role, source) {
  return {
    role,
    approvalStatus: "approved",
    entitlementStatus: "active",
    entitlementSource: source,
    alphaWodAccess: true,
  };
}

test.beforeEach(clearEmulators);
test.after(() => functionsTest.cleanup());

test("bootstrap rejects unauthenticated callers and creates fail-closed defaults", async () => {
  await assert.rejects(
    bootstrapUserProfile(request({displayName: "Attacker"})),
    (error) => error.code === "unauthenticated"
  );

  await createAuthUser("member");
  const result = await bootstrapUserProfile(request({displayName: "Member A"}, "member"));
  assert.equal(result.profile.role, "user");
  assert.equal(result.profile.approvalStatus, "pending");
  assert.equal(result.profile.entitlementStatus, "none");
  assert.equal(result.profile.entitlementSource, "none");
  assert.equal(result.profile.alphaWodAccess, false);

  const profile = (await db.collection("users").doc("member").get()).data();
  assert.equal(profile.name, "Member A");
  assert.equal(profile.role, "user");
  assert.equal(profile.approvalStatus, "pending");
  assert.equal(profile.alphaWodAccess, false);
});

test("admin boundaries use authoritative profiles and staff directory is projected", async () => {
  await Promise.all([createAuthUser("admin"), createAuthUser("member")]);
  await db.collection("users").doc("admin").set({
    ...activeProfile("admin", "staff"),
    name: "Admin",
    email: "admin@example.test",
    privateBillingId: "must-not-leak",
  });
  await db.collection("users").doc("member").set({
    ...activeProfile("user", "stripe"),
    name: "Member",
    email: "member@example.test",
    privateBillingId: "must-not-leak",
  });

  await assert.rejects(
    setMemberEntitlement(request({
      userId: "member",
      entitlementStatus: "restricted",
      entitlementSource: "manual",
    }, "member")),
    (error) => error.code === "permission-denied"
  );

  const directory = await listStaffUsers(request({}, "admin"));
  assert.equal(directory.users.length, 2);
  assert.equal(directory.users.some((user) => "privateBillingId" in user), false);
});

test("admin entitlement changes cannot forge Stripe or legacy provenance", async () => {
  await Promise.all([createAuthUser("admin"), createAuthUser("member")]);
  await db.collection("users").doc("admin").set({
    ...activeProfile("admin", "staff"),
    name: "Admin",
    email: "admin@example.test",
  });
  const memberRef = db.collection("users").doc("member");
  await memberRef.set({
    role: "user",
    approvalStatus: "approved",
    entitlementStatus: "none",
    entitlementSource: "none",
    alphaWodAccess: false,
  });

  for (const forgedSource of ["stripe", "legacy"]) {
    await assert.rejects(
      setMemberEntitlement(request({
        userId: "member",
        entitlementStatus: "active",
        entitlementSource: forgedSource,
      }, "admin")),
      (error) => error.code === "invalid-argument" && /source manual/i.test(error.message)
    );
  }
  assert.equal((await memberRef.get()).get("entitlementSource"), "none");
  assert.equal((await memberRef.get()).get("entitlementUpdatedAt"), undefined);

  const applied = await setMemberEntitlement(request({
    userId: "member",
    entitlementStatus: "active",
    entitlementSource: "manual",
  }, "admin"));
  assert.equal(applied.entitlementSource, "manual");
  assert.equal((await memberRef.get()).get("entitlementSource"), "manual");

  const removed = await setMemberEntitlement(request({
    userId: "member",
    entitlementStatus: "none",
    entitlementSource: "none",
  }, "admin"));
  assert.equal(removed.entitlementSource, "none");
  assert.equal((await memberRef.get()).get("entitlementSource"), "none");
});

test("manual entitlement changes cannot bypass an active Stripe owner generation", async () => {
  await Promise.all([createAuthUser("admin"), createAuthUser("member")]);
  await db.collection("users").doc("admin").set({
    ...activeProfile("admin", "staff"),
    name: "Admin",
    email: "admin@example.test",
  });
  const memberRef = db.collection("users").doc("member");
  await memberRef.set({
    ...activeProfile("user", "stripe"),
    name: "Member",
    email: "member@example.test",
  });
  const ownerRef = db.collection("membershipEntitlementOwners")
    .doc(require("node:crypto").createHash("sha256").update("member").digest("hex"));
  await ownerRef.set({
    schemaVersion: 1,
    subscriptionId: "sub_active_membership",
    state: "active",
  });

  await assert.rejects(
    setMemberEntitlement(request({
      userId: "member",
      entitlementStatus: "restricted",
      entitlementSource: "manual",
      reason: "Temporary support restriction",
    }, "admin")),
    (error) => error.code === "failed-precondition" && /active Stripe/i.test(error.message)
  );
  assert.equal((await memberRef.get()).get("entitlementSource"), "stripe");

  await ownerRef.set({state: "released"}, {merge: true});
  const applied = await setMemberEntitlement(request({
    userId: "member",
    entitlementStatus: "restricted",
    entitlementSource: "manual",
    reason: "Temporary support restriction",
  }, "admin"));
  assert.equal(applied.entitlementStatus, "restricted");
  assert.equal((await memberRef.get()).get("entitlementSource"), "manual");
});

test("canonical waiver evidence is immutable across a retry", async () => {
  await createAuthUser("member");
  await bootstrapUserProfile(request({displayName: "Member A"}, "member"));
  const first = await acceptCurrentWaiver(request({
    signedName: "Member A",
    version: CURRENT_WAIVER_VERSION,
    acknowledgements: [...CURRENT_WAIVER_ACKNOWLEDGEMENTS],
    mediaConsent: false,
  }, "member"));
  assert.equal(first.alreadyAccepted, false);

  const acceptanceRef = db.collection("waiverAcceptances")
    .doc(`member__${CURRENT_WAIVER_VERSION}`);
  const original = (await acceptanceRef.get()).data();
  const retry = await acceptCurrentWaiver(request({
    signedName: "Changed Name",
    version: CURRENT_WAIVER_VERSION,
    acknowledgements: [...CURRENT_WAIVER_ACKNOWLEDGEMENTS],
    mediaConsent: true,
  }, "member"));
  const afterRetry = (await acceptanceRef.get()).data();
  assert.equal(retry.alreadyAccepted, true);
  assert.equal(afterRetry.acceptedName, original.acceptedName);
  assert.equal(afterRetry.mediaConsent, original.mediaConsent);
});

test("invalid canonical-ID waiver evidence fails closed", async () => {
  await createAuthUser("member");
  await bootstrapUserProfile(request({displayName: "Member A"}, "member"));
  await db.collection("waiverAcceptances")
    .doc(`member__${CURRENT_WAIVER_VERSION}`)
    .set({
      acceptanceSchemaVersion: 1,
      userId: "member",
      version: CURRENT_WAIVER_VERSION,
      acceptedAt: admin.firestore.Timestamp.now(),
      source: "legacy_user_doc_migration",
    });

  await assert.rejects(
    acceptCurrentWaiver(request({
      signedName: "Member A",
      version: CURRENT_WAIVER_VERSION,
      acknowledgements: [...CURRENT_WAIVER_ACKNOWLEDGEMENTS],
      mediaConsent: false,
    }, "member")),
    (error) => error.code === "failed-precondition"
  );
  const profile = (await db.collection("users").doc("member").get()).data();
  assert.equal(profile.waiverAcceptedVersion, undefined);
  assert.equal(profile.waiverAcceptedAt, undefined);
});

test("leaderboard callable rejects abusive month keys before scanning", async () => {
  await createAuthUser("member");
  await db.collection("users").doc("member").set(activeProfile("user", "stripe"));
  await assert.rejects(
    getMonthlyLeaderboard(request({monthKey: "attacker-random-month"}, "member")),
    (error) => error.code === "invalid-argument"
  );
});

test("an out-of-order user event converges claims from the current restriction", async () => {
  await createAuthUser("member");
  const memberRef = db.collection("users").doc("member");
  await memberRef.set({
    role: "user",
    approvalStatus: "approved",
    entitlementStatus: "restricted",
    entitlementSource: "manual",
    // Simulate a stale derived marker left by an older active event.
    alphaWodAccess: true,
    accessSchemaVersion: 1,
  });
  await admin.auth().setCustomUserClaims("member", {
    role: "admin",
    approvalStatus: "approved",
    entitlementStatus: "active",
    entitlementSource: "staff",
    alphaWodAccess: true,
    externalTenant: "preserved",
  });

  await functions.onUserDocWritten.run({
    params: {userId: "member"},
    // The handler deliberately ignores this stale event image.
    data: {after: {exists: true, data: () => activeProfile("admin", "staff")}},
  });

  const profile = (await memberRef.get()).data();
  const authUser = await admin.auth().getUser("member");
  assert.equal(profile.alphaWodAccess, false);
  assert.equal(authUser.customClaims.role, "user");
  assert.equal(authUser.customClaims.entitlementStatus, "restricted");
  assert.equal(authUser.customClaims.alphaWodAccess, false);
  assert.equal(authUser.customClaims.restricted, true);
  assert.equal(authUser.customClaims.externalTenant, "preserved");
});
