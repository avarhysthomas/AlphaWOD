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
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import {getBytes, ref, uploadBytes} from "firebase/storage";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const projectId = "alpha-wod-rules-test";
const bucket = `${projectId}.appspot.com`;
const firestoreEmulator = new URL(
  `http://${process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080"}`
);
const storageEmulator = new URL(
  `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST || "127.0.0.1:9199"}`
);

const legacyMember = {
  name: "Legacy Member",
  role: "user",
  approvalStatus: "approved",
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
      host: firestoreEmulator.hostname,
      port: Number(firestoreEmulator.port),
      rules: readFileSync(resolve(projectRoot, "firestore.phase0-compat.rules"), "utf8"),
    },
    storage: {
      host: storageEmulator.hostname,
      port: Number(storageEmulator.port),
      rules: readFileSync(resolve(projectRoot, "storage.phase0-compat.rules"), "utf8"),
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

describe("temporary Phase 0 maintenance lockdown", () => {
  test("all client profile creates are denied, including self-admin and self-approval", async () => {
    const db = firestoreFor("attacker");
    await assertFails(setDoc(doc(db, "users", "attacker"), {
      role: "admin",
      approvalStatus: "approved",
    }));
    await assertFails(setDoc(doc(db, "users", "attacker"), legacyMember));
  });

  test("an account can read only its own profile and nobody can list users", async () => {
    await seedFirestore({
      "users/member": legacyMember,
      "users/admin": {role: "admin", approvalStatus: "approved"},
    });
    const memberDb = firestoreFor("member");
    await assertSucceeds(getDoc(doc(memberDb, "users", "member")));
    await assertFails(getDoc(doc(memberDb, "users", "admin")));
    await assertFails(getDocs(collection(memberDb, "users")));
    await assertFails(getDocs(collection(firestoreFor("admin"), "users")));
  });

  test("all profile writes remain closed during maintenance", async () => {
    await seedFirestore({"users/member": legacyMember});
    const ownRef = doc(firestoreFor("member"), "users", "member");
    await assertFails(updateDoc(ownRef, {
      name: "Updated Name",
      photoURL: "https://example.test/member.jpg",
      updatedAt: serverTimestamp(),
    }));
    for (const update of [
      {role: "admin"},
      {approvalStatus: "approved"},
      {entitlementStatus: "active"},
      {alphaWodAccess: true},
      {email: "forged@example.test"},
      {waiverAcceptedVersion: "forged"},
      {stats: {totalCheckIns: 999}},
    ]) {
      await assertFails(updateDoc(ownRef, {...update, updatedAt: serverTimestamp()}));
    }
  });

  test("legacy members and claimed staff cannot access protected app data", async () => {
    await seedFirestore({
      "users/member": legacyMember,
      "users/admin": {role: "admin", approvalStatus: "approved"},
      "users/sgpt": {role: "sgpt", approvalStatus: "approved"},
      "wods/today": {title: "Workout"},
      "classes/class-1": {title: "Class"},
      "appSettings/booking": {strengthBlocksEnabled: true},
      "leaderboards/2026-08": {summary: {rows: []}},
    });
    for (const uid of ["member", "admin", "sgpt"]) {
      const db = firestoreFor(uid, {role: "admin", approvalStatus: "approved"});
      await assertFails(getDoc(doc(db, "wods", "today")));
      await assertFails(getDoc(doc(db, "classes", "class-1")));
      await assertFails(getDoc(doc(db, "appSettings", "booking")));
      await assertFails(getDoc(doc(db, "leaderboards", "2026-08")));
    }
  });

  test("operational writes, training logs, and raw waiver evidence are closed", async () => {
    await seedFirestore({
      "users/admin": {role: "admin", approvalStatus: "approved"},
      "users/admin/trainingLogs/log-1": {userId: "admin"},
      "classes/class-1": {bookedCount: 0},
      "waiverAcceptances/admin__v1": {userId: "admin", version: "v1"},
    });
    const db = firestoreFor("admin", {role: "admin", approvalStatus: "approved"});
    await assertFails(setDoc(doc(db, "bookings", "forged"), {userId: "admin"}));
    await assertFails(updateDoc(doc(db, "classes", "class-1"), {bookedCount: 999}));
    await assertFails(getDoc(doc(db, "users/admin/trainingLogs/log-1")));
    await assertFails(getDoc(doc(db, "waiverAcceptances", "admin__v1")));
  });

  test("temporary Storage rules permit only constrained owner profile files", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const ownerPicture = ref(storageFor("member"), "profilePics/member.jpg");
    await assertSucceeds(uploadBytes(ownerPicture, jpeg, {contentType: "image/jpeg"}));
    await assertSucceeds(getBytes(ownerPicture));
    await assertFails(getBytes(ref(storageFor("other"), "profilePics/member.jpg")));
    await assertFails(uploadBytes(
      ref(storageFor("member"), "profilePics/other.jpg"),
      jpeg,
      {contentType: "image/jpeg"}
    ));
    await assertFails(uploadBytes(
      ref(storageFor("member"), "profilePics/member.svg"),
      jpeg,
      {contentType: "image/svg+xml"}
    ));
    await assertFails(getBytes(ref(
      testEnv.unauthenticatedContext().storage(bucket),
      "profilePics/member.jpg"
    )));
  });
});
