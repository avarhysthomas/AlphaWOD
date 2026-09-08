/* eslint-disable max-len, require-jsdoc, valid-jsdoc, @typescript-eslint/no-var-requires */

const {DateTime} = require("luxon");

const CONDITIONING_SCOPE = "adult_conditioning";
const CONDITIONING_TIMEZONE = "Europe/London";
const CONDITIONING_FIXTURE_KIND =
  "adult_conditioning_full_app_journey";
const CONDITIONING_FIXTURE_SCHEMA_VERSION = 1;
const CONDITIONING_FIXTURE_CAPACITY = 10;
const CONDITIONING_FIXTURE_DEFINITIONS = Object.freeze([
  Object.freeze({
    classId: "conditioning_browser_thursday_a",
    fixtureLabel: "Thursday A",
    title: "Conditioning Browser Thursday A",
    dayOffset: 3,
    hour: 18,
    minute: 0,
    conditioningSlotKey: "thursday_1800",
  }),
  Object.freeze({
    classId: "conditioning_browser_thursday_b",
    fixtureLabel: "Thursday B",
    title: "Conditioning Browser Thursday B",
    dayOffset: 3,
    hour: 18,
    minute: 0,
    conditioningSlotKey: "thursday_1800",
  }),
  Object.freeze({
    classId: "conditioning_browser_friday_a",
    fixtureLabel: "Friday A",
    title: "Conditioning Browser Friday A",
    dayOffset: 4,
    hour: 5,
    minute: 30,
    conditioningSlotKey: "friday_0530",
  }),
  Object.freeze({
    classId: "conditioning_browser_friday_b",
    fixtureLabel: "Friday B",
    title: "Conditioning Browser Friday B",
    dayOffset: 4,
    hour: 5,
    minute: 30,
    conditioningSlotKey: "friday_0530",
  }),
]);
const CONDITIONING_FIXTURE_IDS = Object.freeze(
  CONDITIONING_FIXTURE_DEFINITIONS.map(({classId}) => classId)
);

function asIso(value) {
  const result = value.toUTC().toISO({suppressMilliseconds: false});
  if (!result) throw new Error("The local Conditioning fixture date is invalid.");
  return result;
}

/**
 * Matches Schedule's Saturday 10:00 London cutover. Before the cutover the
 * current Monday-to-Sunday week is visible; afterwards the next week is.
 */
function visibleConditioningWeek(nowMillis = Date.now()) {
  if (!Number.isSafeInteger(nowMillis) || nowMillis <= 0) {
    throw new Error("The local Conditioning fixture seed time is invalid.");
  }
  const now = DateTime.fromMillis(nowMillis, {zone: CONDITIONING_TIMEZONE});
  if (!now.isValid) {
    throw new Error("The local Conditioning fixture seed time is invalid.");
  }
  let monday = now.startOf("week").startOf("day");
  const saturdayCutover = monday.plus({days: 5, hours: 10});
  if (now.toMillis() >= saturdayCutover.toMillis()) {
    monday = monday.plus({weeks: 1});
  }
  return Object.freeze({
    monday,
    weekKey: monday.toFormat("yyyy-LL-dd"),
    weekEndsOn: monday.plus({days: 6}).toFormat("yyyy-LL-dd"),
  });
}

function firestoreClassBody(definition, start, end, createdAt, weekKey) {
  return Object.freeze({
    fields: Object.freeze({
      templateId: {stringValue: `local_${definition.classId}`},
      title: {stringValue: definition.title},
      timezone: {stringValue: CONDITIONING_TIMEZONE},
      startTime: {timestampValue: asIso(start)},
      endTime: {timestampValue: asIso(end)},
      coachId: {stringValue: "local-conditioning-test"},
      coachName: {stringValue: "Local Test Coach"},
      capacity: {integerValue: String(CONDITIONING_FIXTURE_CAPACITY)},
      bookedCount: {integerValue: "0"},
      location: {stringValue: "Local emulator — no real booking"},
      status: {stringValue: "scheduled"},
      conditioningSlotKey: {stringValue: definition.conditioningSlotKey},
      paygEligible: {booleanValue: false},
      localTestFixture: {booleanValue: true},
      localTestFixtureKind: {stringValue: CONDITIONING_FIXTURE_KIND},
      localTestFixtureSchemaVersion: {
        integerValue: String(CONDITIONING_FIXTURE_SCHEMA_VERSION),
      },
      localTestFixtureLabel: {stringValue: definition.fixtureLabel},
      localTestFixtureWeekKey: {stringValue: weekKey},
      createdAt: {timestampValue: asIso(createdAt)},
    }),
  });
}

function buildLocalConditioningClassDocuments(nowMillis = Date.now()) {
  const now = DateTime.fromMillis(nowMillis, {zone: CONDITIONING_TIMEZONE});
  const week = visibleConditioningWeek(nowMillis);
  const thursdayBookingCutoff = week.monday.plus({
    days: 3,
    hours: 15,
  });
  if (now.toMillis() >= thursdayBookingCutoff.toMillis()) {
    throw new Error(
      "The visible Conditioning test week no longer has three open fixture candidates. " +
      "Run this journey before Thursday 15:00 Europe/London."
    );
  }

  const createdAt = DateTime.fromMillis(nowMillis, {zone: "utc"});
  const fixtures = CONDITIONING_FIXTURE_DEFINITIONS.map((definition) => {
    const start = week.monday.plus({
      days: definition.dayOffset,
      hours: definition.hour,
      minutes: definition.minute,
    });
    const end = start.plus({hours: 1});
    return Object.freeze({
      ...definition,
      weekKey: week.weekKey,
      startTime: asIso(start),
      endTime: asIso(end),
      body: firestoreClassBody(
        definition,
        start,
        end,
        createdAt,
        week.weekKey
      ),
    });
  });

  return Object.freeze({
    timezone: CONDITIONING_TIMEZONE,
    weekKey: week.weekKey,
    weekEndsOn: week.weekEndsOn,
    bookingCutoff: asIso(thursdayBookingCutoff),
    fixtures: Object.freeze(fixtures),
  });
}

function assertLocalConditioningTarget({projectId, firestoreHost, appOrigin}) {
  if (projectId !== "demo-alphawod-stripe") {
    throw new Error("The Conditioning fixture requires the dedicated demo Firebase project.");
  }
  if (firestoreHost !== "127.0.0.1:8080" &&
    firestoreHost !== "localhost:8080") {
    throw new Error("The Conditioning fixture requires the loopback Firestore emulator.");
  }
  if (appOrigin !== "http://localhost:3002" &&
    appOrigin !== "http://127.0.0.1:3002") {
    throw new Error("The Conditioning fixture requires the loopback browser origin.");
  }
  return true;
}

module.exports = {
  CONDITIONING_FIXTURE_CAPACITY,
  CONDITIONING_FIXTURE_DEFINITIONS,
  CONDITIONING_FIXTURE_IDS,
  CONDITIONING_FIXTURE_KIND,
  CONDITIONING_FIXTURE_SCHEMA_VERSION,
  CONDITIONING_SCOPE,
  CONDITIONING_TIMEZONE,
  assertLocalConditioningTarget,
  buildLocalConditioningClassDocuments,
  visibleConditioningWeek,
};
