import assert from "node:assert/strict";
import {after, before, beforeEach, describe, test} from "node:test";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, resolve} from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  deleteObject,
  getBytes,
  ref,
  uploadBytes,
} from "firebase/storage";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const projectId = "alpha-wod-rules-test";
const bucket = `${projectId}.appspot.com`;

const accessProfiles = {
  admin: {
    role: "admin",
    approvalStatus: "approved",
    entitlementStatus: "active",
    entitlementSource: "staff",
    alphaWodAccess: true,
  },
  sgpt: {
    role: "sgpt",
    approvalStatus: "approved",
    entitlementStatus: "active",
    entitlementSource: "staff",
    alphaWodAccess: true,
  },
  member: {
    role: "user",
    approvalStatus: "approved",
    entitlementStatus: "active",
    entitlementSource: "stripe",
    alphaWodAccess: true,
  },
  legacy: {
    role: "user",
    approvalStatus: "approved",
    entitlementStatus: "active",
    entitlementSource: "legacy",
    alphaWodAccess: true,
  },
  pending: {
    role: "user",
    approvalStatus: "pending",
    entitlementStatus: "active",
    entitlementSource: "stripe",
    alphaWodAccess: true,
  },
  restricted: {
    role: "user",
    approvalStatus: "approved",
    entitlementStatus: "restricted",
    entitlementSource: "stripe",
    alphaWodAccess: true,
  },
  staffRestricted: {
    role: "admin",
    approvalStatus: "approved",
    entitlementStatus: "restricted",
    entitlementSource: "staff",
    alphaWodAccess: true,
  },
  banned: {
    role: "banned",
    approvalStatus: "approved",
    entitlementStatus: "active",
    entitlementSource: "stripe",
    alphaWodAccess: true,
  },
};

let testEnv;

function firestoreFor(uid, claims = {}) {
  return testEnv.authenticatedContext(uid, claims).firestore();
}

function storageFor(uid, claims = {}) {
  return testEnv.authenticatedContext(uid, claims).storage(bucket);
}

async function seedFirestore(seed) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const [path, value] of Object.entries(seed)) {
      await setDoc(doc(db, path), value);
    }
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: readFileSync(resolve(projectRoot, "firestore.rules"), "utf8"),
    },
    storage: {
      host: "127.0.0.1",
      port: 9199,
      rules: readFileSync(resolve(projectRoot, "storage.rules"), "utf8"),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.clearStorage();
});

after(async () => {
  await testEnv.cleanup();
});

describe("authoritative access state", () => {
  test("missing, pending, restricted, banned, and malformed profiles fail closed", async () => {
    await seedFirestore({
      "users/pending": accessProfiles.pending,
      "users/restricted": accessProfiles.restricted,
      "users/staff-restricted": accessProfiles.staffRestricted,
      "users/banned": accessProfiles.banned,
      "users/malformed": {
        role: "user",
        approvalStatus: "approved",
        alphaWodAccess: true,
      },
      "wods/today": {title: "Workout"},
    });

    for (const uid of [
      "missing",
      "pending",
      "restricted",
      "staff-restricted",
      "banned",
      "malformed",
    ]) {
      await assertFails(getDoc(doc(firestoreFor(uid), "wods", "today")));
    }
  });

  test("stale privileged claims cannot override a revoked Firestore profile", async () => {
    await seedFirestore({
      "users/revoked": accessProfiles.restricted,
      "wods/today": {title: "Workout"},
    });

    const staleClaims = {
      role: "admin",
      approvalStatus: "approved",
      entitlementStatus: "active",
      entitlementSource: "staff",
      alphaWodAccess: true,
    };

    await assertFails(
      getDoc(doc(firestoreFor("revoked", staleClaims), "wods", "today"))
    );
  });

  test("active members and active staff can read member-gated data", async () => {
    await seedFirestore({
      "users/member": accessProfiles.member,
      "users/legacy": accessProfiles.legacy,
      "users/admin": accessProfiles.admin,
      "users/sgpt": accessProfiles.sgpt,
      "wods/today": {title: "Workout"},
      "classes/class-1": {title: "Class"},
      "appSettings/booking": {strengthBlocksEnabled: true},
    });

    for (const uid of ["member", "legacy", "admin", "sgpt"]) {
      const db = firestoreFor(uid);
      await assertSucceeds(getDoc(doc(db, "wods", "today")));
      await assertSucceeds(getDoc(doc(db, "classes", "class-1")));
      await assertSucceeds(getDoc(doc(db, "appSettings", "booking")));
    }
  });
});

describe("user documents", () => {
  test("clients cannot bootstrap a user document or self-promote", async () => {
    const db = firestoreFor("new-user");

    await assertFails(setDoc(doc(db, "users", "new-user"), accessProfiles.member));
    await assertFails(setDoc(doc(db, "users", "new-user"), accessProfiles.admin));
  });

  test("owners can update only harmless profile fields", async () => {
    await seedFirestore({
      "users/member": {...accessProfiles.member, name: "Before"},
      "users/pending": accessProfiles.pending,
    });
    const ownRef = doc(firestoreFor("member"), "users", "member");

    await assertSucceeds(updateDoc(ownRef, {
      name: "After",
      photoURL: "https://example.test/member.jpg",
      updatedAt: serverTimestamp(),
    }));

    await assertFails(updateDoc(ownRef, {
      role: "admin",
      updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(ownRef, {
      alphaWodAccess: false,
      updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(ownRef, {
      waiverAcceptedVersion: "forged",
      updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(ownRef, {
      email: "forged@example.test",
      updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(firestoreFor("pending"), "users", "pending"), {
      approvalStatus: "approved",
      updatedAt: serverTimestamp(),
    }));
  });

  test("only the owner or an authoritative admin can read a user document", async () => {
    await seedFirestore({
      "users/member": accessProfiles.member,
      "users/other": accessProfiles.member,
      "users/admin": accessProfiles.admin,
      "users/sgpt": accessProfiles.sgpt,
    });

    await assertSucceeds(getDoc(doc(firestoreFor("member"), "users", "member")));
    await assertFails(getDoc(doc(firestoreFor("member"), "users", "other")));
    await assertSucceeds(getDoc(doc(firestoreFor("admin"), "users", "other")));
    await assertFails(getDoc(doc(firestoreFor("sgpt"), "users", "other")));

    await assertSucceeds(getDocs(collection(firestoreFor("admin"), "users")));
    await assertFails(getDocs(collection(firestoreFor("member"), "users")));
    await assertFails(getDocs(collection(firestoreFor("sgpt"), "users")));
  });

  test("even admins cannot directly mutate access fields", async () => {
    await seedFirestore({
      "users/admin": accessProfiles.admin,
      "users/member": accessProfiles.member,
    });

    await assertFails(updateDoc(doc(firestoreFor("admin"), "users", "member"), {
      role: "admin",
    }));
  });
});

describe("server-owned operational state", () => {
  test("clients cannot forge bookings, class counts, settings, or waiver evidence", async () => {
    await seedFirestore({
      "users/member": accessProfiles.member,
      "users/admin": accessProfiles.admin,
      "classes/class-1": {bookedCount: 0},
      "appSettings/booking": {strengthBlocksEnabled: true},
      "waiverAcceptances/member__v1": {userId: "member", version: "v1"},
      "leaderboards/2026-08": {summary: {rows: []}},
    });

    const memberDb = firestoreFor("member");
    const adminDb = firestoreFor("admin");

    await assertFails(setDoc(doc(memberDb, "bookings", "class-1_member"), {
      classId: "class-1",
      userId: "member",
      status: "booked",
    }));
    await assertFails(updateDoc(doc(memberDb, "classes", "class-1"), {bookedCount: 999}));
    await assertFails(updateDoc(doc(adminDb, "classes", "class-1"), {bookedCount: 999}));
    await assertFails(updateDoc(doc(adminDb, "appSettings", "booking"), {
      strengthBlocksEnabled: false,
    }));
    await assertFails(
      getDoc(doc(memberDb, "waiverAcceptances", "member__v1"))
    );
    await assertFails(
      getDoc(doc(adminDb, "waiverAcceptances", "member__v1"))
    );
    await assertFails(setDoc(doc(memberDb, "waiverAcceptances", "member__v2"), {
      userId: "member",
      version: "v2",
    }));
    await assertFails(getDoc(doc(memberDb, "leaderboards", "2026-08")));
    await assertFails(getDoc(doc(adminDb, "leaderboards", "2026-08")));
  });

  test("members can read only their own bookings; admins can read rosters", async () => {
    await seedFirestore({
      "users/member": accessProfiles.member,
      "users/other": accessProfiles.member,
      "users/admin": accessProfiles.admin,
      "bookings/one": {classId: "class-1", userId: "member", status: "booked"},
      "bookings/two": {classId: "class-1", userId: "other", status: "booked"},
    });

    const memberDb = firestoreFor("member");
    await assertSucceeds(getDoc(doc(memberDb, "bookings", "one")));
    await assertFails(getDoc(doc(memberDb, "bookings", "two")));
    await assertSucceeds(
      getDocs(query(collection(memberDb, "bookings"), where("userId", "==", "member")))
    );
    await assertFails(getDocs(collection(memberDb, "bookings")));
    await assertSucceeds(getDocs(collection(firestoreFor("admin"), "bookings")));
  });
});

describe("training logs", () => {
  function validLog(userId) {
    return {
      userId,
      category: "strength",
      movementSlug: "back-squat",
      movementName: "Back Squat",
      metricType: "weight",
      value: "100",
      unit: "kg",
      reps: "5",
      date: "2026-08-17",
      notes: "",
      createdAt: serverTimestamp(),
    };
  }

  test("active owners can create valid logs but cannot inject identity or extra fields", async () => {
    await seedFirestore({
      "users/member": accessProfiles.member,
      "users/other": accessProfiles.member,
    });
    const memberDb = firestoreFor("member");

    await assertSucceeds(
      setDoc(doc(memberDb, "users/member/trainingLogs/log-1"), validLog("member"))
    );
    await assertFails(
      setDoc(doc(memberDb, "users/member/trainingLogs/log-2"), validLog("other"))
    );
    await assertFails(
      setDoc(doc(memberDb, "users/other/trainingLogs/log-3"), validLog("member"))
    );
    await assertFails(
      setDoc(doc(memberDb, "users/member/trainingLogs/log-4"), {
        ...validLog("member"),
        role: "admin",
      })
    );
  });

  test("restricted members cannot read or write their historical logs", async () => {
    await seedFirestore({
      "users/restricted": accessProfiles.restricted,
      "users/restricted/trainingLogs/log-1": {
        ...validLog("restricted"),
        createdAt: new Date("2026-08-17T10:00:00Z"),
      },
    });
    const db = firestoreFor("restricted");

    await assertFails(getDoc(doc(db, "users/restricted/trainingLogs/log-1")));
    await assertFails(
      setDoc(doc(db, "users/restricted/trainingLogs/log-2"), validLog("restricted"))
    );
  });
});

describe("profile picture storage", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

  beforeEach(async () => {
    await seedFirestore({
      "users/member": accessProfiles.member,
      "users/other": accessProfiles.member,
      "users/admin": accessProfiles.admin,
      "users/restricted": accessProfiles.restricted,
    });
  });

  test("owners and admins can upload constrained images", async () => {
    await assertSucceeds(
      uploadBytes(ref(storageFor("member"), "profilePics/member.jpg"), jpeg, {
        contentType: "image/jpeg",
      })
    );
    await assertSucceeds(
      uploadBytes(ref(storageFor("admin"), "profilePics/other.png"), jpeg, {
        contentType: "image/png",
      })
    );
  });

  test("members cannot overwrite another profile or upload unsafe content", async () => {
    const storage = storageFor("member");

    await assertFails(
      uploadBytes(ref(storage, "profilePics/other.jpg"), jpeg, {contentType: "image/jpeg"})
    );
    await assertFails(
      uploadBytes(ref(storage, "profilePics/member.svg"), jpeg, {contentType: "image/svg+xml"})
    );
    await assertFails(
      uploadBytes(ref(storage, "profilePics/member.jpg"), jpeg, {contentType: "text/html"})
    );
    await assertFails(
      uploadBytes(
        ref(storage, "profilePics/member.jpg"),
        new Uint8Array(5 * 1024 * 1024 + 1),
        {contentType: "image/jpeg"}
      )
    );
  });

  test("only active users can read profile pictures", async () => {
    const ownerStorage = storageFor("member");
    const picture = ref(ownerStorage, "profilePics/member.jpg");
    await uploadBytes(picture, jpeg, {contentType: "image/jpeg"});

    await assertSucceeds(getBytes(picture));
    await assertSucceeds(getBytes(ref(storageFor("other"), "profilePics/member.jpg")));
    await assertFails(getBytes(ref(storageFor("restricted"), "profilePics/member.jpg")));
    await assertFails(
      getBytes(ref(testEnv.unauthenticatedContext().storage(bucket), "profilePics/member.jpg"))
    );
  });

  test("an owner can delete their own image but not another member's", async () => {
    const memberStorage = storageFor("member");
    const otherStorage = storageFor("other");
    await uploadBytes(ref(memberStorage, "profilePics/member.jpg"), jpeg, {
      contentType: "image/jpeg",
    });
    await uploadBytes(ref(otherStorage, "profilePics/other.jpg"), jpeg, {
      contentType: "image/jpeg",
    });

    await assertFails(deleteObject(ref(memberStorage, "profilePics/other.jpg")));
    await assertSucceeds(deleteObject(ref(memberStorage, "profilePics/member.jpg")));
  });
});

describe("billing collections are server-only", () => {
  const billingPaths = [
    "memberships/sub_test",
    "membershipIntents/intent_test",
    "stripeEvents/evt_test",
    "membershipAudit/audit_test",
  ];

  beforeEach(async () => {
    await seedFirestore(
      Object.fromEntries(
        billingPaths.map((path) => [path, {payerUid: "member", state: "active"}])
      )
    );
  });

  test("no client role can read billing documents", async () => {
    for (const path of billingPaths) {
      for (const uid of ["member", "admin", "sgpt"]) {
        await assertFails(getDoc(doc(firestoreFor(uid), path)));
      }
      await assertFails(
        getDoc(doc(testEnv.unauthenticatedContext().firestore(), path))
      );
    }
  });

  test("no client role can write billing documents", async () => {
    for (const path of billingPaths) {
      for (const uid of ["member", "admin"]) {
        await assertFails(setDoc(doc(firestoreFor(uid), path), {state: "active"}));
      }
    }
  });

  test("a member cannot forge a membership that grants themselves access", async () => {
    await assertFails(
      setDoc(doc(firestoreFor("restricted"), "memberships/forged"), {
        payerUid: "restricted",
        planKey: "adult_unlimited",
        state: "active",
        grantsAlphaWodAccess: true,
        entitlementTargetUid: "restricted",
      })
    );
  });

  test("a member cannot list memberships to read other people's data", async () => {
    await assertFails(getDocs(collection(firestoreFor("member"), "memberships")));
    await assertFails(getDocs(collection(firestoreFor("admin"), "memberships")));
  });

  test("a member cannot write a Stripe customer id onto their own profile", async () => {
    // stripeCustomerId is server-owned; the harmless-profile-update allowance
    // must not be widened by the Phase 1 fields.
    await assertFails(
      updateDoc(doc(firestoreFor("member"), "users/member"), {
        stripeCustomerId: "cus_attacker",
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(
      updateDoc(doc(firestoreFor("member"), "users/member"), {
        entitlementSource: "stripe",
        entitlementStatus: "active",
        updatedAt: serverTimestamp(),
      })
    );
  });
});

test("sanity: test fixtures preserve the intended access combinations", () => {
  assert.equal(accessProfiles.admin.entitlementSource, "staff");
  assert.equal(accessProfiles.member.entitlementStatus, "active");
  assert.equal(accessProfiles.restricted.alphaWodAccess, true);
});
