/* eslint-disable
  max-len,
  require-jsdoc,
  valid-jsdoc,
  @typescript-eslint/no-var-requires
*/

const test = require("node:test");
const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");

const {
  CHECKOUT_BURST_LIMIT,
  CHECKOUT_BURST_WINDOW_MS,
  CHECKOUT_DAILY_LIMIT,
  CHECKOUT_DAILY_WINDOW_MS,
  CHECKOUT_EARLY_BURST_LIMIT,
  CHECKOUT_EARLY_BURST_WINDOW_MS,
  CHECKOUT_EARLY_HOURLY_LIMIT,
  CHECKOUT_EARLY_HOURLY_WINDOW_MS,
  CHECKOUT_RATE_ADMISSION_COLLECTION,
  CHECKOUT_RATE_LIMIT_COLLECTION,
  CHECKOUT_RATE_RECORD_RETENTION_MS,
  CheckoutAttemptFingerprintMismatchError,
  CheckoutRateLimitExceededError,
  CheckoutRateLimitStateError,
  admitEarlyMembershipCheckoutRequest,
  admitMembershipCheckoutAttempt,
  createCheckoutRateAdmissionReferences,
  createCheckoutRateBucket,
  createEarlyCheckoutRateAdmissionReferences,
  deriveCheckoutSourceHash,
  normalizeCheckoutSourceAddress,
} = require("../lib/membershipCheckoutAbuse");

const HMAC_SECRET = "0123456789abcdef0123456789abcdef";

function digest(label) {
  return createHash("sha256").update(label).digest("hex");
}

class FakeDocumentSnapshot {
  constructor(ref, value) {
    this.ref = ref;
    this.exists = value !== undefined;
    this.value = value;
  }

  get(field) {
    return this.value?.[field];
  }

  data() {
    return this.value;
  }
}

class FakeDocumentReference {
  constructor(path) {
    this.path = path;
    this.id = path.slice(path.lastIndexOf("/") + 1);
  }
}

class FakeCollectionReference {
  constructor(path) {
    this.path = path;
  }

  doc(id) {
    return new FakeDocumentReference(`${this.path}/${id}`);
  }
}

class FakeFirestore {
  constructor() {
    this.docs = new Map();
    this.transactionTail = Promise.resolve();
  }

  collection(path) {
    return new FakeCollectionReference(path);
  }

  seed(ref, value) {
    this.docs.set(ref.path, value);
  }

  read(ref) {
    return this.docs.get(ref.path);
  }

  async runTransaction(callback) {
    const execute = async () => {
      const writes = [];
      const transaction = {
        get: async (ref) => new FakeDocumentSnapshot(ref, this.docs.get(ref.path)),
        set: (ref, value) => writes.push({ref, value}),
      };
      const result = await callback(transaction);
      writes.forEach(({ref, value}) => this.docs.set(ref.path, value));
      return result;
    };
    const result = this.transactionTail.then(execute, execute);
    this.transactionTail = result.then(() => undefined, () => undefined);
    return result;
  }
}

function admissionInput(firestore, overrides = {}) {
  const checkoutAttemptHash = overrides.checkoutAttemptHash ?? digest("attempt-1");
  return {
    firestore,
    intentRef: firestore.collection("membershipIntents").doc(
      `attempt_${checkoutAttemptHash}`
    ),
    checkoutAttemptHash,
    requestFingerprint: overrides.requestFingerprint ?? digest("fingerprint-1"),
    sourceHash: overrides.sourceHash ?? deriveCheckoutSourceHash(
      "203.0.113.9",
      HMAC_SECRET
    ),
    nowMillis: overrides.nowMillis ?? Date.UTC(2026, 7, 19, 14, 7, 0),
  };
}

function earlyAdmissionInput(firestore, overrides = {}) {
  return {
    firestore,
    sourceHash: overrides.sourceHash ?? deriveCheckoutSourceHash(
      "203.0.113.9",
      HMAC_SECRET
    ),
    nowMillis: overrides.nowMillis ?? Date.UTC(2026, 7, 19, 14, 7, 0),
  };
}

function bucketDocument(firestore, input, kind) {
  const bucket = createCheckoutRateBucket(
    input.sourceHash,
    kind,
    input.nowMillis
  );
  return firestore.read(
    firestore.collection(CHECKOUT_RATE_LIMIT_COLLECTION).doc(bucket.id)
  );
}

test("source addresses are canonicalised and HMACed without enumerable raw-IP digests", () => {
  assert.equal(normalizeCheckoutSourceAddress(" 203.0.113.9 "), "203.0.113.9");
  assert.equal(
    normalizeCheckoutSourceAddress("[2001:0DB8:0:0:0:0:0:1]"),
    "2001:db8::1"
  );
  assert.equal(
    deriveCheckoutSourceHash("203.0.113.9", HMAC_SECRET),
    "62c81e497e60d93e76c54e511ed3613a31a826b919d5643efa688f5ca2b438e5"
  );
  assert.notEqual(
    deriveCheckoutSourceHash("203.0.113.9", "fedcba9876543210fedcba9876543210"),
    deriveCheckoutSourceHash("203.0.113.9", HMAC_SECRET)
  );
  assert.throws(
    () => normalizeCheckoutSourceAddress("not-an-address"),
    CheckoutRateLimitStateError
  );
  assert.throws(
    () => deriveCheckoutSourceHash("203.0.113.9", "short"),
    /at least 32 bytes/i
  );
});

test("bucket ids, UTC windows and retention expiries are deterministic", () => {
  const sourceHash = digest("source");
  const nowMillis = Date.UTC(2026, 7, 19, 14, 7, 0);
  const burst = createCheckoutRateBucket(sourceHash, "burst", nowMillis);
  const daily = createCheckoutRateBucket(sourceHash, "daily", nowMillis);

  assert.equal(burst.id, `${sourceHash}_burst_${Math.floor(nowMillis / CHECKOUT_BURST_WINDOW_MS)}`);
  assert.equal(burst.limit, CHECKOUT_BURST_LIMIT);
  assert.equal(burst.windowStartedAtMillis, Date.UTC(2026, 7, 19, 14, 0, 0));
  assert.equal(burst.windowEndsAtMillis, Date.UTC(2026, 7, 19, 14, 10, 0));
  assert.equal(
    burst.expiresAtMillis,
    burst.windowEndsAtMillis + CHECKOUT_RATE_RECORD_RETENTION_MS
  );
  assert.equal(daily.id, `${sourceHash}_daily_${Math.floor(nowMillis / CHECKOUT_DAILY_WINDOW_MS)}`);
  assert.equal(daily.limit, CHECKOUT_DAILY_LIMIT);
  assert.equal(daily.windowStartedAtMillis, Date.UTC(2026, 7, 19, 0, 0, 0));
  assert.equal(daily.windowEndsAtMillis, Date.UTC(2026, 7, 20, 0, 0, 0));
});

test("pre-parse request buckets are deterministic and separate from attempt quotas", () => {
  const firestore = new FakeFirestore();
  const input = earlyAdmissionInput(firestore);
  const refs = createEarlyCheckoutRateAdmissionReferences(input);

  assert.equal(refs.burst.kind, "request_burst");
  assert.equal(refs.burst.limit, CHECKOUT_EARLY_BURST_LIMIT);
  assert.equal(
    refs.burst.windowEndsAtMillis - refs.burst.windowStartedAtMillis,
    CHECKOUT_EARLY_BURST_WINDOW_MS
  );
  assert.equal(refs.hourly.kind, "request_hourly");
  assert.equal(refs.hourly.limit, CHECKOUT_EARLY_HOURLY_LIMIT);
  assert.equal(
    refs.hourly.windowEndsAtMillis - refs.hourly.windowStartedAtMillis,
    CHECKOUT_EARLY_HOURLY_WINDOW_MS
  );
  assert.notEqual(refs.burst.id, refs.hourly.id);
  assert.ok(CHECKOUT_EARLY_BURST_LIMIT > CHECKOUT_BURST_LIMIT);
  assert.ok(CHECKOUT_EARLY_HOURLY_LIMIT > CHECKOUT_DAILY_LIMIT);
});

test("pre-parse admission counts requests without storing raw request material", async () => {
  const firestore = new FakeFirestore();
  const input = earlyAdmissionInput(firestore);
  const refs = createEarlyCheckoutRateAdmissionReferences(input);

  await admitEarlyMembershipCheckoutRequest(input);
  await admitEarlyMembershipCheckoutRequest({...input, nowMillis: input.nowMillis + 1});

  assert.equal(firestore.read(refs.burst.ref).count, 2);
  assert.equal(firestore.read(refs.hourly.ref).count, 2);
  assert.equal(
    [...firestore.docs.keys()].some((path) =>
      path.startsWith(`${CHECKOUT_RATE_ADMISSION_COLLECTION}/`)
    ),
    false
  );
  const stored = JSON.stringify([...firestore.docs.entries()]);
  assert.equal(stored.includes("203.0.113.9"), false);
  assert.equal(stored.includes("checkoutAttempt"), false);
  assert.equal(stored.includes("requestFingerprint"), false);
});

test("pre-parse request volume does not consume idempotent attempt admission", async () => {
  const firestore = new FakeFirestore();
  const early = earlyAdmissionInput(firestore);
  const attempt = admissionInput(firestore, {sourceHash: early.sourceHash});

  await admitEarlyMembershipCheckoutRequest(early);
  assert.equal((await admitMembershipCheckoutAttempt(attempt)).status, "admitted");
  await admitEarlyMembershipCheckoutRequest({
    ...early,
    nowMillis: early.nowMillis + 1,
  });
  assert.equal(
    (await admitMembershipCheckoutAttempt({
      ...attempt,
      nowMillis: attempt.nowMillis + 1,
    })).status,
    "existing_admission"
  );

  const earlyRefs = createEarlyCheckoutRateAdmissionReferences(early);
  assert.equal(firestore.read(earlyRefs.burst.ref).count, 2);
  assert.equal(bucketDocument(firestore, attempt, "burst").count, 1);
  assert.equal(bucketDocument(firestore, attempt, "daily").count, 1);
});

test("the sixty-first pre-parse request in one minute is rejected atomically", async () => {
  const firestore = new FakeFirestore();
  const input = earlyAdmissionInput(firestore);
  for (let index = 0; index < CHECKOUT_EARLY_BURST_LIMIT; index += 1) {
    await admitEarlyMembershipCheckoutRequest({
      ...input,
      nowMillis: input.nowMillis + index,
    });
  }

  await assert.rejects(
    () => admitEarlyMembershipCheckoutRequest({
      ...input,
      nowMillis: input.nowMillis + CHECKOUT_EARLY_BURST_LIMIT,
    }),
    (error) => {
      assert.ok(error instanceof CheckoutRateLimitExceededError);
      assert.deepEqual(error.windows, ["request_burst"]);
      assert.equal(error.retryAfterSeconds, 60);
      return true;
    }
  );
  const refs = createEarlyCheckoutRateAdmissionReferences(input);
  assert.equal(firestore.read(refs.burst.ref).count, CHECKOUT_EARLY_BURST_LIMIT);
  assert.equal(firestore.read(refs.hourly.ref).count, CHECKOUT_EARLY_BURST_LIMIT);
});

test("the pre-parse hourly ceiling survives minute-window rotation", async () => {
  const firestore = new FakeFirestore();
  const input = earlyAdmissionInput(firestore);
  await admitEarlyMembershipCheckoutRequest(input);
  const refs = createEarlyCheckoutRateAdmissionReferences(input);
  firestore.read(refs.hourly.ref).count = CHECKOUT_EARLY_HOURLY_LIMIT;
  const nextMinute = {
    ...input,
    nowMillis: input.nowMillis + CHECKOUT_EARLY_BURST_WINDOW_MS,
  };

  await assert.rejects(
    () => admitEarlyMembershipCheckoutRequest(nextMinute),
    (error) => {
      assert.ok(error instanceof CheckoutRateLimitExceededError);
      assert.deepEqual(error.windows, ["request_hourly"]);
      assert.equal(
        error.retryAfterSeconds,
        Math.ceil((refs.hourly.windowEndsAtMillis - nextMinute.nowMillis) / 1000)
      );
      return true;
    }
  );
  const nextRefs = createEarlyCheckoutRateAdmissionReferences(nextMinute);
  assert.equal(firestore.read(nextRefs.burst.ref), undefined);
  assert.equal(firestore.read(refs.hourly.ref).count, CHECKOUT_EARLY_HOURLY_LIMIT);
});

test("a first attempt is admitted once and persists only hashes and counters", async () => {
  const firestore = new FakeFirestore();
  const input = admissionInput(firestore);
  const result = await admitMembershipCheckoutAttempt(input);
  const refs = createCheckoutRateAdmissionReferences(input);

  assert.equal(result.status, "admitted");
  assert.equal(firestore.read(refs.burst.ref).count, 1);
  assert.equal(firestore.read(refs.daily.ref).count, 1);
  const admission = firestore.read(refs.admissionRef);
  assert.equal(admission.requestFingerprint, input.requestFingerprint);
  assert.equal(admission.sourceHash, input.sourceHash);
  assert.equal(
    admission.expiresAt.toMillis(),
    input.nowMillis + CHECKOUT_RATE_RECORD_RETENTION_MS
  );
  const stored = JSON.stringify([...firestore.docs.entries()]);
  assert.equal(stored.includes("203.0.113.9"), false);
  assert.equal(stored.includes("attempt-1"), false);
  assert.ok(refs.admissionRef.path.startsWith(`${CHECKOUT_RATE_ADMISSION_COLLECTION}/`));
});

test("a stable attempt retry is free even after its network source changes", async () => {
  const firestore = new FakeFirestore();
  const first = admissionInput(firestore);
  const secondSourceHash = deriveCheckoutSourceHash("198.51.100.44", HMAC_SECRET);

  assert.equal((await admitMembershipCheckoutAttempt(first)).status, "admitted");
  const retry = await admitMembershipCheckoutAttempt({
    ...first,
    sourceHash: secondSourceHash,
    nowMillis: first.nowMillis + 1000,
  });

  assert.equal(retry.status, "existing_admission");
  assert.equal(bucketDocument(firestore, first, "burst").count, 1);
  assert.equal(bucketDocument(firestore, first, "daily").count, 1);
  assert.equal(bucketDocument(firestore, {
    ...first,
    sourceHash: secondSourceHash,
  }, "burst"), undefined);

  firestore.seed(first.intentRef, {requestFingerprint: first.requestFingerprint});
  const afterIntent = await admitMembershipCheckoutAttempt({
    ...first,
    sourceHash: secondSourceHash,
    nowMillis: first.nowMillis + CHECKOUT_RATE_RECORD_RETENTION_MS + 1,
  });
  assert.equal(afterIntent.status, "existing_intent");
});

test("one attempt can never be reused with a different request fingerprint", async () => {
  const firestore = new FakeFirestore();
  const input = admissionInput(firestore);
  await admitMembershipCheckoutAttempt(input);

  await assert.rejects(
    () => admitMembershipCheckoutAttempt({
      ...input,
      requestFingerprint: digest("changed-details"),
    }),
    CheckoutAttemptFingerprintMismatchError
  );
  assert.equal(bucketDocument(firestore, input, "burst").count, 1);

  const otherStore = new FakeFirestore();
  const intentInput = admissionInput(otherStore);
  otherStore.seed(intentInput.intentRef, {
    requestFingerprint: digest("frozen-intent-details"),
  });
  await assert.rejects(
    () => admitMembershipCheckoutAttempt(intentInput),
    CheckoutAttemptFingerprintMismatchError
  );
});

test("concurrent retries contend on the admission and increment each window once", async () => {
  const firestore = new FakeFirestore();
  const input = admissionInput(firestore);
  const results = await Promise.all(
    Array.from({length: 8}, () => admitMembershipCheckoutAttempt(input))
  );

  assert.equal(results.filter((result) => result.status === "admitted").length, 1);
  assert.equal(
    results.filter((result) => result.status === "existing_admission").length,
    7
  );
  assert.equal(bucketDocument(firestore, input, "burst").count, 1);
  assert.equal(bucketDocument(firestore, input, "daily").count, 1);
});

test("the seventh distinct attempt in ten minutes is rejected without a counter write", async () => {
  const firestore = new FakeFirestore();
  const base = admissionInput(firestore);
  for (let index = 0; index < CHECKOUT_BURST_LIMIT; index += 1) {
    await admitMembershipCheckoutAttempt(admissionInput(firestore, {
      checkoutAttemptHash: digest(`burst-attempt-${index}`),
      requestFingerprint: digest(`burst-fingerprint-${index}`),
      sourceHash: base.sourceHash,
      nowMillis: base.nowMillis,
    }));
  }

  await assert.rejects(
    () => admitMembershipCheckoutAttempt(admissionInput(firestore, {
      checkoutAttemptHash: digest("burst-attempt-blocked"),
      requestFingerprint: digest("burst-fingerprint-blocked"),
      sourceHash: base.sourceHash,
      nowMillis: base.nowMillis,
    })),
    (error) => {
      assert.ok(error instanceof CheckoutRateLimitExceededError);
      assert.deepEqual(error.windows, ["burst"]);
      assert.equal(error.retryAfterSeconds, 180);
      return true;
    }
  );
  assert.equal(bucketDocument(firestore, base, "burst").count, CHECKOUT_BURST_LIMIT);
  assert.equal(bucketDocument(firestore, base, "daily").count, CHECKOUT_BURST_LIMIT);
});

test("the twenty-first distinct attempt in one UTC day is rejected", async () => {
  const firestore = new FakeFirestore();
  const sourceHash = digest("daily-source");
  const start = Date.UTC(2026, 7, 19, 0, 1, 0);
  for (let index = 0; index < CHECKOUT_DAILY_LIMIT; index += 1) {
    await admitMembershipCheckoutAttempt(admissionInput(firestore, {
      checkoutAttemptHash: digest(`daily-attempt-${index}`),
      requestFingerprint: digest(`daily-fingerprint-${index}`),
      sourceHash,
      nowMillis: start + index * 11 * 60 * 1000,
    }));
  }

  const blockedTime = start + CHECKOUT_DAILY_LIMIT * 11 * 60 * 1000;
  await assert.rejects(
    () => admitMembershipCheckoutAttempt(admissionInput(firestore, {
      checkoutAttemptHash: digest("daily-attempt-blocked"),
      requestFingerprint: digest("daily-fingerprint-blocked"),
      sourceHash,
      nowMillis: blockedTime,
    })),
    (error) => {
      assert.ok(error instanceof CheckoutRateLimitExceededError);
      assert.deepEqual(error.windows, ["daily"]);
      assert.equal(
        error.retryAfterSeconds,
        Math.ceil((Date.UTC(2026, 7, 20) - blockedTime) / 1000)
      );
      return true;
    }
  );
});

test("a new fixed window succeeds even while expired rows await TTL deletion", async () => {
  const firestore = new FakeFirestore();
  const sourceHash = digest("boundary-source");
  const windowStart = Date.UTC(2026, 7, 19, 14, 0, 0);
  for (let index = 0; index < CHECKOUT_BURST_LIMIT; index += 1) {
    await admitMembershipCheckoutAttempt(admissionInput(firestore, {
      checkoutAttemptHash: digest(`boundary-attempt-${index}`),
      requestFingerprint: digest(`boundary-fingerprint-${index}`),
      sourceHash,
      nowMillis: windowStart + 1,
    }));
  }

  const nextWindow = admissionInput(firestore, {
    checkoutAttemptHash: digest("boundary-next-attempt"),
    requestFingerprint: digest("boundary-next-fingerprint"),
    sourceHash,
    nowMillis: windowStart + CHECKOUT_BURST_WINDOW_MS,
  });
  assert.equal((await admitMembershipCheckoutAttempt(nextWindow)).status, "admitted");
  assert.equal(bucketDocument(firestore, nextWindow, "burst").count, 1);
});

test("an expired admission is charged again without relying on TTL deletion", async () => {
  const firestore = new FakeFirestore();
  const first = admissionInput(firestore);
  await admitMembershipCheckoutAttempt(first);
  const secondSourceHash = deriveCheckoutSourceHash("198.51.100.88", HMAC_SECRET);
  const later = {
    ...first,
    sourceHash: secondSourceHash,
    nowMillis: first.nowMillis + CHECKOUT_RATE_RECORD_RETENTION_MS + 1,
  };

  assert.equal((await admitMembershipCheckoutAttempt(later)).status, "admitted");
  const refs = createCheckoutRateAdmissionReferences(later);
  assert.equal(firestore.read(refs.admissionRef).sourceHash, secondSourceHash);
  assert.equal(bucketDocument(firestore, later, "burst").count, 1);
  assert.equal(bucketDocument(firestore, later, "daily").count, 1);
});
