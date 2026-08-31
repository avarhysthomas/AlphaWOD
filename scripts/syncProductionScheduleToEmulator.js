/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");

const SOURCE_PROJECT_ID = "alphawod-d1f2f";
const DESTINATION_PROJECT_ID = "demo-alphawod-stripe";
const SNAPSHOT_PREFIX = "prod-public-";
const MAX_PUBLIC_CLASSES = 250;
const MINIMUM_CHECKOUT_WINDOW_MS = 30 * 60 * 1000;
const ALLOWED_EMULATOR_HOSTS = new Set([
  "127.0.0.1:8080",
  "localhost:8080",
]);

function parseArguments(argumentsList) {
  const allowed = new Set(["--apply"]);
  const unknown = argumentsList.filter((argument) => !allowed.has(argument));
  if (unknown.length > 0 ||
      argumentsList.filter((argument) => argument === "--apply").length > 1) {
    throw new Error("The only supported option is --apply.");
  }
  return {apply: argumentsList.includes("--apply")};
}

function assertLocalDestination(environment) {
  const host = environment.FIRESTORE_EMULATOR_HOST;
  if (!ALLOWED_EMULATOR_HOSTS.has(host)) {
    throw new Error(
      "FIRESTORE_EMULATOR_HOST must be exactly 127.0.0.1:8080 or localhost:8080."
    );
  }
  for (const key of ["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT"]) {
    if (environment[key] !== DESTINATION_PROJECT_ID) {
      throw new Error(`${key} must be exactly ${DESTINATION_PROJECT_ID}.`);
    }
  }
  return host;
}

function firestoreString(fields, name, fallback = "") {
  const value = fields?.[name]?.stringValue;
  return typeof value === "string" ? value.trim() : fallback;
}

function firestoreInteger(fields, name) {
  const raw = fields?.[name]?.integerValue ?? fields?.[name]?.doubleValue;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : 0;
}

function firestoreTimestamp(fields, name) {
  const value = fields?.[name]?.timestampValue;
  if (typeof value !== "string") return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? {iso: new Date(millis).toISOString(), millis} : null;
}

function productionClassId(documentName) {
  const prefix = `projects/${SOURCE_PROJECT_ID}/databases/(default)/documents/classes/`;
  if (typeof documentName !== "string" || !documentName.startsWith(prefix)) {
    throw new Error("Production query returned a document outside the classes collection.");
  }
  const classId = documentName.slice(prefix.length);
  if (!/^[A-Za-z0-9._-]{1,500}$/.test(classId)) {
    throw new Error("Production query returned an unsafe class document ID.");
  }
  return classId;
}

function sanitizeProductionClass(document, nowMillis) {
  if (!document || typeof document !== "object") {
    throw new Error("Production query returned a malformed class document.");
  }
  const classId = productionClassId(document.name);
  const fields = document.fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    throw new Error(`Production class ${classId} has no fields map.`);
  }
  const start = firestoreTimestamp(fields, "startTime");
  const end = firestoreTimestamp(fields, "endTime");
  const status = firestoreString(fields, "status");
  if (status !== "scheduled" || !start || !end ||
      end.millis <= start.millis || start.millis <= nowMillis) return null;

  const title = firestoreString(fields, "title").slice(0, 160);
  const timezone = firestoreString(fields, "timezone", "Europe/London")
    .slice(0, 80) || "Europe/London";
  const location = firestoreString(fields, "location").slice(0, 200);
  const coachName = firestoreString(fields, "coachName").slice(0, 160);
  if (!title || !location) {
    throw new Error(`Production class ${classId} is missing its public title or location.`);
  }

  const capacity = Math.max(0, firestoreInteger(fields, "capacity"));
  const bookedCount = Math.max(0, firestoreInteger(fields, "bookedCount"));
  const spacesRemaining = Math.max(0, capacity - bookedCount);
  const explicitlyExcluded = fields.paygEligible?.booleanValue === false;
  const checkoutWindowOpen = start.millis - nowMillis >=
    MINIMUM_CHECKOUT_WINDOW_MS;
  const eligible = !explicitlyExcluded && checkoutWindowOpen && capacity > 0;
  const availability = !eligible ? "unavailable" :
    spacesRemaining > 0 ? "available" : "full";

  return Object.freeze({
    classId,
    title,
    startTime: start.iso,
    endTime: end.iso,
    timezone,
    coachName,
    location,
    spacesRemaining,
    availability,
  });
}

function emulatorFieldsFor(publicClass) {
  const capacity = Math.max(1, publicClass.spacesRemaining);
  const bookedCount = publicClass.spacesRemaining === 0 ? capacity : 0;
  return {
    title: {stringValue: publicClass.title},
    timezone: {stringValue: publicClass.timezone},
    startTime: {timestampValue: publicClass.startTime},
    endTime: {timestampValue: publicClass.endTime},
    coachName: {stringValue: publicClass.coachName},
    capacity: {integerValue: String(capacity)},
    bookedCount: {integerValue: String(bookedCount)},
    location: {stringValue: publicClass.location},
    status: {stringValue: "scheduled"},
    paygEligible: {
      booleanValue: publicClass.availability !== "unavailable",
    },
  };
}

function remoteQueryBody(nowIso) {
  return {
    structuredQuery: {
      from: [{collectionId: "classes"}],
      where: {
        fieldFilter: {
          field: {fieldPath: "startTime"},
          op: "GREATER_THAN_OR_EQUAL",
          value: {timestampValue: nowIso},
        },
      },
      orderBy: [{
        field: {fieldPath: "startTime"},
        direction: "ASCENDING",
      }],
      limit: MAX_PUBLIC_CLASSES,
    },
  };
}

function safeErrorMessage(body) {
  const message = body?.error?.message;
  return typeof message === "string" ? message.slice(0, 500) : "unknown error";
}

async function fetchProductionClasses(fetchImpl, accessToken, nowMillis) {
  const response = await fetchImpl(
    `https://firestore.googleapis.com/v1/projects/${SOURCE_PROJECT_ID}` +
      "/databases/(default)/documents:runQuery",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(remoteQueryBody(new Date(nowMillis).toISOString())),
    }
  );
  const body = await response.json();
  if (!response.ok) {
    throw new Error(
      `Production Firestore read failed (${response.status}): ${safeErrorMessage(body)}`
    );
  }
  if (!Array.isArray(body)) {
    throw new Error("Production Firestore returned an unexpected query response.");
  }
  const classes = body
    .filter((row) => row && row.document)
    .map((row) => sanitizeProductionClass(row.document, nowMillis))
    .filter(Boolean);
  if (classes.length === 0) {
    throw new Error("Production returned no valid future public classes; local data was not changed.");
  }
  return classes;
}

function localBaseUrl(host) {
  return `http://${host}/v1/projects/${DESTINATION_PROJECT_ID}` +
    "/databases/(default)/documents";
}

async function listExistingSnapshotNames(fetchImpl, host) {
  const names = [];
  let pageToken = "";
  do {
    const query = new URLSearchParams({pageSize: "250"});
    if (pageToken) query.set("pageToken", pageToken);
    const response = await fetchImpl(`${localBaseUrl(host)}/classes?${query}`, {
      headers: {Authorization: "Bearer owner"},
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(
        `Local Firestore list failed (${response.status}): ${safeErrorMessage(body)}`
      );
    }
    for (const document of body.documents ?? []) {
      if (typeof document?.name === "string" &&
          document.name.startsWith(
            `projects/${DESTINATION_PROJECT_ID}/databases/(default)/documents/classes/${SNAPSHOT_PREFIX}`
          )) {
        names.push(document.name);
      }
    }
    pageToken = typeof body.nextPageToken === "string" ? body.nextPageToken : "";
  } while (pageToken);
  return names;
}

function buildLocalWrites(publicClasses, existingNames) {
  const collectionPrefix =
    `projects/${DESTINATION_PROJECT_ID}/databases/(default)/documents/classes/`;
  const updates = publicClasses.map((publicClass) => ({
    update: {
      name: `${collectionPrefix}${SNAPSHOT_PREFIX}${publicClass.classId}`,
      fields: emulatorFieldsFor(publicClass),
    },
  }));
  const nextNames = new Set(updates.map(({update}) => update.name));
  const deletes = existingNames
    .filter((name) => !nextNames.has(name))
    .map((name) => ({delete: name}));
  const writes = [...deletes, ...updates];
  if (writes.length > 500) {
    throw new Error("The local snapshot would exceed Firestore's atomic 500-write limit.");
  }
  return writes;
}

async function applyLocalSnapshot(fetchImpl, host, publicClasses) {
  const existingNames = await listExistingSnapshotNames(fetchImpl, host);
  const writes = buildLocalWrites(publicClasses, existingNames);
  const response = await fetchImpl(
    `${localBaseUrl(host)}:commit`,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer owner",
        "content-type": "application/json",
      },
      body: JSON.stringify({writes}),
    }
  );
  const body = await response.json();
  if (!response.ok) {
    throw new Error(
      `Local Firestore commit failed (${response.status}): ${safeErrorMessage(body)}`
    );
  }
  return {written: publicClasses.length, removed: writes.length - publicClasses.length};
}

function firebaseToolsLibDirectory(environment = process.env) {
  const candidates = [
    environment.FIREBASE_TOOLS_LIB_DIR,
    path.resolve(
      path.dirname(process.execPath),
      "../lib/node_modules/firebase-tools/lib"
    ),
    "/usr/local/lib/node_modules/firebase-tools/lib",
  ].filter(Boolean);
  const directory = candidates.find((candidate) =>
    fs.existsSync(path.join(candidate, "auth.js")) &&
    fs.existsSync(path.join(candidate, "scopes.js"))
  );
  if (!directory) {
    throw new Error("Firebase CLI authentication libraries were not found.");
  }
  return directory;
}

async function firebaseCliAccessToken(environment = process.env) {
  const directory = firebaseToolsLibDirectory(environment);
  const auth = require(path.join(directory, "auth"));
  const scopes = require(path.join(directory, "scopes"));
  const account = auth.getGlobalDefaultAccount();
  if (!account?.tokens?.refresh_token) {
    throw new Error("Firebase CLI is not signed in; run firebase login first.");
  }
  const token = await auth.getAccessToken(
    account.tokens.refresh_token,
    [scopes.CLOUD_PLATFORM]
  );
  if (typeof token?.access_token !== "string" || !token.access_token) {
    throw new Error("Firebase CLI did not provide an access token.");
  }
  return token.access_token;
}

async function syncProductionSchedule({
  argumentsList = process.argv.slice(2),
  environment = process.env,
  fetchImpl = fetch,
  getAccessToken = firebaseCliAccessToken,
  nowMillis = Date.now(),
} = {}) {
  const {apply} = parseArguments(argumentsList);
  const host = assertLocalDestination(environment);
  const accessToken = await getAccessToken(environment);
  const publicClasses = await fetchProductionClasses(
    fetchImpl,
    accessToken,
    nowMillis
  );
  const starts = publicClasses.map(({startTime}) => startTime);
  const summary = {
    sourceProject: SOURCE_PROJECT_ID,
    destinationProject: DESTINATION_PROJECT_ID,
    classCount: publicClasses.length,
    firstStart: starts[0],
    lastStart: starts.at(-1),
    applied: false,
  };
  if (!apply) return summary;
  const applied = await applyLocalSnapshot(fetchImpl, host, publicClasses);
  return {...summary, applied: true, ...applied};
}

if (require.main === module) {
  syncProductionSchedule()
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
      if (!summary.applied) {
        console.log("Dry run only. Re-run with --apply to replace the local public snapshot.");
      }
    })
    .catch((error) => {
      console.error(`Production schedule snapshot failed: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  ALLOWED_EMULATOR_HOSTS,
  DESTINATION_PROJECT_ID,
  MAX_PUBLIC_CLASSES,
  SNAPSHOT_PREFIX,
  SOURCE_PROJECT_ID,
  applyLocalSnapshot,
  assertLocalDestination,
  buildLocalWrites,
  emulatorFieldsFor,
  fetchProductionClasses,
  parseArguments,
  remoteQueryBody,
  sanitizeProductionClass,
  syncProductionSchedule,
};
