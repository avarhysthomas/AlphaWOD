/* eslint-disable @typescript-eslint/no-var-requires, max-len */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  CONDITIONING_FIXTURE_IDS,
  CONDITIONING_FIXTURE_KIND,
  assertLocalConditioningTarget,
  buildLocalConditioningClassDocuments,
  visibleConditioningWeek,
} = require("../scripts/localStripeConditioningJourney");

const REPOSITORY_ROOT = path.resolve(__dirname, "../..");
const WEDNESDAY_NOW = Date.parse("2026-09-02T12:00:00.000Z");

test("Conditioning browser fixtures match the current visible London week", () => {
  const seeded = buildLocalConditioningClassDocuments(WEDNESDAY_NOW);
  assert.equal(seeded.timezone, "Europe/London");
  assert.equal(seeded.weekKey, "2026-08-31");
  assert.equal(seeded.weekEndsOn, "2026-09-06");
  assert.equal(seeded.bookingCutoff, "2026-09-03T14:00:00.000Z");
  assert.deepEqual(
    seeded.fixtures.map(({classId}) => classId),
    CONDITIONING_FIXTURE_IDS
  );
  assert.deepEqual(
    seeded.fixtures.map(({startTime}) => startTime),
    [
      "2026-09-03T17:00:00.000Z",
      "2026-09-03T17:00:00.000Z",
      "2026-09-04T04:30:00.000Z",
      "2026-09-04T04:30:00.000Z",
    ]
  );
  assert.deepEqual(
    seeded.fixtures.map(({endTime}) => endTime),
    [
      "2026-09-03T18:00:00.000Z",
      "2026-09-03T18:00:00.000Z",
      "2026-09-04T05:30:00.000Z",
      "2026-09-04T05:30:00.000Z",
    ]
  );
});

test("Conditioning fixtures are visibly labelled, non-PAYG, and emulator-only", () => {
  const seeded = buildLocalConditioningClassDocuments(WEDNESDAY_NOW);
  for (const fixture of seeded.fixtures) {
    const fields = fixture.body.fields;
    assert.equal(fields.templateId.stringValue, `local_${fixture.classId}`);
    assert.match(fields.title.stringValue, /^Conditioning Browser /);
    assert.equal(fields.timezone.stringValue, "Europe/London");
    assert.equal(fields.coachId.stringValue, "local-conditioning-test");
    assert.equal(fields.coachName.stringValue, "Local Test Coach");
    assert.equal(fields.capacity.integerValue, "10");
    assert.equal(fields.bookedCount.integerValue, "0");
    assert.equal(fields.location.stringValue, "Local emulator — no real booking");
    assert.equal(fields.status.stringValue, "scheduled");
    assert.equal(fields.paygEligible.booleanValue, false);
    assert.equal(fields.localTestFixture.booleanValue, true);
    assert.equal(fields.localTestFixtureKind.stringValue, CONDITIONING_FIXTURE_KIND);
    assert.equal(fields.localTestFixtureSchemaVersion.integerValue, "1");
    assert.equal(fields.localTestFixtureWeekKey.stringValue, "2026-08-31");
    assert.equal(
      fields.conditioningSlotKey.stringValue,
      fixture.conditioningSlotKey
    );
  }
});

test("Conditioning fixture target is hard-bound to demo Firebase and loopback", () => {
  assert.equal(assertLocalConditioningTarget({
    projectId: "demo-alphawod-stripe",
    firestoreHost: "127.0.0.1:8080",
    appOrigin: "http://localhost:3002",
  }), true);
  for (const candidate of [
    {
      projectId: "alphawod-d1f2f",
      firestoreHost: "127.0.0.1:8080",
      appOrigin: "http://localhost:3002",
    },
    {
      projectId: "demo-alphawod-stripe",
      firestoreHost: "firestore.googleapis.com",
      appOrigin: "http://localhost:3002",
    },
    {
      projectId: "demo-alphawod-stripe",
      firestoreHost: "127.0.0.1:8080",
      appOrigin: "https://alpha-wod.vercel.app",
    },
  ]) {
    assert.throws(
      () => assertLocalConditioningTarget(candidate),
      /demo Firebase|loopback/
    );
  }
});

test("Saturday cutover selects the same visible week as Schedule", () => {
  const before = visibleConditioningWeek(
    Date.parse("2026-09-05T08:59:59.000Z")
  );
  const after = visibleConditioningWeek(
    Date.parse("2026-09-05T09:00:00.000Z")
  );
  assert.equal(before.weekKey, "2026-08-31");
  assert.equal(after.weekKey, "2026-09-07");
});

test("runner fails before seeding a visible week whose third candidate is closed", () => {
  assert.throws(
    () => buildLocalConditioningClassDocuments(
      Date.parse("2026-09-03T14:00:00.000Z")
    ),
    /before Thursday 15:00 Europe\/London/
  );
});

test("runner wording describes the current Conditioning contract and verifier", () => {
  const source = fs.readFileSync(
    path.join(
      REPOSITORY_ROOT,
      "functions/scripts/runLocalStripeTestJourney.js"
    ),
    "utf8"
  );
  assert.match(
    source,
    /current prorated charge, then £30\/month/
  );
  assert.match(
    source,
    /verify:stripe-test-conditioning-app-journey/
  );
  assert.doesNotMatch(
    source,
    /Presale expectation: £0 today; first payment on 1 September 2026/
  );
});
