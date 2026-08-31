const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DESTINATION_PROJECT_ID,
  SNAPSHOT_PREFIX,
  SOURCE_PROJECT_ID,
  assertLocalDestination,
  buildLocalWrites,
  emulatorFieldsFor,
  parseArguments,
  sanitizeProductionClass,
  syncProductionSchedule,
} = require("./syncProductionScheduleToEmulator");

const NOW = Date.parse("2026-08-31T12:00:00.000Z");

function productionDocument(overrides = {}) {
  return {
    name: `projects/${SOURCE_PROJECT_ID}/databases/(default)/documents/classes/class_1`,
    fields: {
      title: {stringValue: "Conditioning"},
      timezone: {stringValue: "Europe/London"},
      startTime: {timestampValue: "2026-09-01T17:00:00.000Z"},
      endTime: {timestampValue: "2026-09-01T18:00:00.000Z"},
      coachName: {stringValue: "Coach"},
      coachId: {stringValue: "private-coach-id"},
      templateId: {stringValue: "private-template-id"},
      capacity: {integerValue: "16"},
      bookedCount: {integerValue: "5"},
      location: {stringValue: "Unit 3"},
      status: {stringValue: "scheduled"},
      createdAt: {timestampValue: "2026-01-01T00:00:00.000Z"},
      ...overrides,
    },
  };
}

test("destination guard permits only the explicit demo emulator data plane", () => {
  const valid = {
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
    GCLOUD_PROJECT: DESTINATION_PROJECT_ID,
    GOOGLE_CLOUD_PROJECT: DESTINATION_PROJECT_ID,
  };
  assert.equal(assertLocalDestination(valid), "127.0.0.1:8080");
  for (const patch of [
    {FIRESTORE_EMULATOR_HOST: undefined},
    {FIRESTORE_EMULATOR_HOST: "firestore.googleapis.com"},
    {GCLOUD_PROJECT: SOURCE_PROJECT_ID},
    {GOOGLE_CLOUD_PROJECT: SOURCE_PROJECT_ID},
  ]) {
    assert.throws(() => assertLocalDestination({...valid, ...patch}));
  }
});

test("arguments are dry-run by default and reject every unsupported option", () => {
  assert.deepEqual(parseArguments([]), {apply: false});
  assert.deepEqual(parseArguments(["--apply"]), {apply: true});
  assert.throws(() => parseArguments(["--apply", "--apply"]));
  assert.throws(() => parseArguments(["--project", SOURCE_PROJECT_ID]));
});

test("production rows reduce to the exact public PAYG projection", () => {
  const result = sanitizeProductionClass(productionDocument(), NOW);
  assert.deepEqual(result, {
    classId: "class_1",
    title: "Conditioning",
    startTime: "2026-09-01T17:00:00.000Z",
    endTime: "2026-09-01T18:00:00.000Z",
    timezone: "Europe/London",
    coachName: "Coach",
    location: "Unit 3",
    spacesRemaining: 11,
    availability: "available",
  });
  assert.equal(JSON.stringify(result).includes("private-coach-id"), false);
  assert.equal(JSON.stringify(result).includes("private-template-id"), false);
});

test("sanitizer filters non-public rows and fails closed on unsafe documents", () => {
  assert.equal(sanitizeProductionClass(productionDocument({
    status: {stringValue: "cancelled"},
  }), NOW), null);
  assert.equal(sanitizeProductionClass(productionDocument({
    startTime: {timestampValue: "2026-08-31T11:00:00.000Z"},
  }), NOW), null);
  assert.throws(() => sanitizeProductionClass({
    ...productionDocument(),
    name: "projects/another/databases/(default)/documents/users/user_1",
  }, NOW));
  assert.throws(() => sanitizeProductionClass(productionDocument({
    location: {stringValue: ""},
  }), NOW));
});

test("emulator documents preserve public availability without private occupancy", () => {
  const available = sanitizeProductionClass(productionDocument(), NOW);
  const availableFields = emulatorFieldsFor(available);
  assert.equal(availableFields.capacity.integerValue, "11");
  assert.equal(availableFields.bookedCount.integerValue, "0");
  assert.equal(availableFields.paygEligible.booleanValue, true);
  assert.equal("coachId" in availableFields, false);
  assert.equal("templateId" in availableFields, false);

  const full = sanitizeProductionClass(productionDocument({
    bookedCount: {integerValue: "16"},
  }), NOW);
  const fullFields = emulatorFieldsFor(full);
  assert.equal(fullFields.capacity.integerValue, "1");
  assert.equal(fullFields.bookedCount.integerValue, "1");
});

test("local replacement touches only prefixed snapshot rows", () => {
  const publicClass = sanitizeProductionClass(productionDocument(), NOW);
  const base = `projects/${DESTINATION_PROJECT_ID}/databases/(default)/documents/classes/`;
  const writes = buildLocalWrites([publicClass], [
    `${base}${SNAPSHOT_PREFIX}stale`,
    `${base}${SNAPSHOT_PREFIX}${publicClass.classId}`,
  ]);
  assert.deepEqual(writes[0], {delete: `${base}${SNAPSHOT_PREFIX}stale`});
  assert.equal(writes[1].update.name, `${base}${SNAPSHOT_PREFIX}class_1`);
  assert.equal(writes.some((write) => write.delete === `${base}local-fixture`), false);
});

test("dry run reads production but never contacts the emulator or leaks its token", async () => {
  const requests = [];
  const secretToken = "secret-access-token";
  const fetchImpl = async (url, options = {}) => {
    requests.push({url, options});
    return {
      ok: true,
      status: 200,
      json: async () => [{document: productionDocument()}],
    };
  };
  const summary = await syncProductionSchedule({
    argumentsList: [],
    environment: {
      FIRESTORE_EMULATOR_HOST: "localhost:8080",
      GCLOUD_PROJECT: DESTINATION_PROJECT_ID,
      GOOGLE_CLOUD_PROJECT: DESTINATION_PROJECT_ID,
    },
    fetchImpl,
    getAccessToken: async () => secretToken,
    nowMillis: NOW,
  });
  assert.equal(summary.applied, false);
  assert.equal(summary.classCount, 1);
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /firestore\.googleapis\.com/);
  assert.equal(JSON.stringify(summary).includes(secretToken), false);
});
