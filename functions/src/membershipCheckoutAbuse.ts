/* eslint-disable require-jsdoc, valid-jsdoc */

/**
 * Server-only admission controls for anonymous membership checkout.
 *
 * The browser's checkout attempt is already stable across safe retries. This
 * module gives each new attempt one rate-limit admission without charging the
 * same attempt again when Stripe or the network is retried. Neither source IP
 * addresses nor raw attempt identifiers are persisted.
 */

import {createHmac} from "crypto";
import {isIP} from "net";
import {
  CollectionReference,
  DocumentReference,
  Firestore,
  Timestamp,
  Transaction,
} from "firebase-admin/firestore";

export const CHECKOUT_ABUSE_SCHEMA_VERSION = 1;
export const CHECKOUT_BURST_LIMIT = 6;
export const CHECKOUT_BURST_WINDOW_MS = 10 * 60 * 1000;
export const CHECKOUT_DAILY_LIMIT = 20;
export const CHECKOUT_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
// This pre-parse guard intentionally sits far above the valid-attempt limits.
// It catches request floods without turning ordinary network retries into new
// checkout attempts or making shared household/NAT traffic fragile.
export const CHECKOUT_EARLY_BURST_LIMIT = 60;
export const CHECKOUT_EARLY_BURST_WINDOW_MS = 60 * 1000;
export const CHECKOUT_EARLY_HOURLY_LIMIT = 600;
export const CHECKOUT_EARLY_HOURLY_WINDOW_MS = 60 * 60 * 1000;
export const CHECKOUT_RATE_RECORD_RETENTION_MS = 48 * 60 * 60 * 1000;
export const CHECKOUT_RATE_ADMISSION_COLLECTION =
  "membershipCheckoutRateAdmissions";
export const CHECKOUT_RATE_LIMIT_COLLECTION = "membershipCheckoutRateLimits";

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const MINIMUM_HMAC_SECRET_BYTES = 32;

export type CheckoutAttemptRateWindowKind = "burst" | "daily";
export type CheckoutEarlyRateWindowKind =
  "request_burst" | "request_hourly";
export type CheckoutRateWindowKind =
  CheckoutAttemptRateWindowKind | CheckoutEarlyRateWindowKind;

export type CheckoutRateBucket<
  Kind extends CheckoutRateWindowKind = CheckoutRateWindowKind
> = {
  id: string;
  kind: Kind;
  limit: number;
  sourceHash: string;
  windowIndex: number;
  windowStartedAtMillis: number;
  windowEndsAtMillis: number;
  expiresAtMillis: number;
};

export type CheckoutRateAdmissionReferences = {
  intentRef: DocumentReference;
  admissionRef: DocumentReference;
  burst: CheckoutRateBucket<"burst"> & {ref: DocumentReference};
  daily: CheckoutRateBucket<"daily"> & {ref: DocumentReference};
};

export type CheckoutRateAdmissionResult = {
  status: "admitted" | "existing_admission" | "existing_intent";
  burst: CheckoutRateBucket<"burst">;
  daily: CheckoutRateBucket<"daily">;
};

export type CheckoutEarlyRateAdmissionReferences = {
  burst: CheckoutRateBucket<"request_burst"> & {ref: DocumentReference};
  hourly: CheckoutRateBucket<"request_hourly"> & {ref: DocumentReference};
};

export type CheckoutEarlyRateAdmissionResult = {
  status: "admitted";
  burst: CheckoutRateBucket<"request_burst">;
  hourly: CheckoutRateBucket<"request_hourly">;
};

export class CheckoutAttemptFingerprintMismatchError extends Error {
  constructor() {
    super("This checkout attempt was already used with different details.");
    this.name = "CheckoutAttemptFingerprintMismatchError";
  }
}

export class CheckoutRateLimitExceededError extends Error {
  readonly retryAfterSeconds: number;
  readonly windows: CheckoutRateWindowKind[];

  constructor(
    retryAfterSeconds: number,
    windows: CheckoutRateWindowKind[]
  ) {
    super("Too many new checkout attempts. Wait before trying again.");
    this.name = "CheckoutRateLimitExceededError";
    this.retryAfterSeconds = retryAfterSeconds;
    this.windows = windows;
  }
}

export class CheckoutRateLimitStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckoutRateLimitStateError";
  }
}

/** Canonicalises the proxy-resolved address before applying the server HMAC. */
export function normalizeCheckoutSourceAddress(value: unknown): string {
  if (typeof value !== "string") {
    throw new CheckoutRateLimitStateError(
      "Checkout source address is unavailable."
    );
  }

  let address = value.trim();
  if (address.startsWith("[") && address.endsWith("]")) {
    address = address.slice(1, -1);
  }

  const version = isIP(address);
  if (version === 4) {
    return address.split(".").map((part) => String(Number(part))).join(".");
  }
  if (version !== 6) {
    throw new CheckoutRateLimitStateError(
      "Checkout source address is invalid."
    );
  }

  // WHATWG URL parsing emits one canonical, compressed, lowercase IPv6 form.
  const hostname = new URL(`http://[${address}]/`).hostname;
  return hostname.slice(1, -1);
}

/**
 * Creates a non-enumerable pseudonymous key. A plain digest is unsafe because
 * the IPv4 address space can be exhaustively hashed offline.
 */
export function deriveCheckoutSourceHash(
  value: unknown,
  secret: string
): string {
  if (typeof secret !== "string" ||
    Buffer.byteLength(secret, "utf8") < MINIMUM_HMAC_SECRET_BYTES) {
    throw new CheckoutRateLimitStateError(
      "Checkout rate-limit secret must contain at least 32 bytes."
    );
  }
  const address = normalizeCheckoutSourceAddress(value);
  return createHmac("sha256", secret)
    .update(`membership-checkout-source:v1:${address}`, "utf8")
    .digest("hex");
}

function requireSha256Hex(value: string, field: string): void {
  if (!SHA256_HEX_PATTERN.test(value)) {
    throw new CheckoutRateLimitStateError(
      `${field} must be a lowercase SHA-256 digest.`
    );
  }
}

function requireNowMillis(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CheckoutRateLimitStateError(
      "Checkout admission time must be a non-negative integer."
    );
  }
}

/** Returns the deterministic fixed-window row for one pseudonymous source. */
export function createCheckoutRateBucket<Kind extends CheckoutRateWindowKind>(
  sourceHash: string,
  kind: Kind,
  nowMillis: number
): CheckoutRateBucket<Kind> {
  requireSha256Hex(sourceHash, "sourceHash");
  requireNowMillis(nowMillis);
  const configuration: Record<CheckoutRateWindowKind, {
    windowMs: number;
    limit: number;
  }> = {
    burst: {
      windowMs: CHECKOUT_BURST_WINDOW_MS,
      limit: CHECKOUT_BURST_LIMIT,
    },
    daily: {
      windowMs: CHECKOUT_DAILY_WINDOW_MS,
      limit: CHECKOUT_DAILY_LIMIT,
    },
    request_burst: {
      windowMs: CHECKOUT_EARLY_BURST_WINDOW_MS,
      limit: CHECKOUT_EARLY_BURST_LIMIT,
    },
    request_hourly: {
      windowMs: CHECKOUT_EARLY_HOURLY_WINDOW_MS,
      limit: CHECKOUT_EARLY_HOURLY_LIMIT,
    },
  };
  const {windowMs, limit} = configuration[kind];
  const windowIndex = Math.floor(nowMillis / windowMs);
  const windowStartedAtMillis = windowIndex * windowMs;
  const windowEndsAtMillis = windowStartedAtMillis + windowMs;
  return {
    id: `${sourceHash}_${kind}_${windowIndex}`,
    kind,
    limit,
    sourceHash,
    windowIndex,
    windowStartedAtMillis,
    windowEndsAtMillis,
    expiresAtMillis: windowEndsAtMillis + CHECKOUT_RATE_RECORD_RETENTION_MS,
  };
}

function rateLimitCollection(firestore: Firestore): CollectionReference {
  return firestore.collection(CHECKOUT_RATE_LIMIT_COLLECTION);
}

/**
 * Returns the two deterministic request-volume rows used before payload/auth
 * parsing. They deliberately share the private TTL-managed rate collection,
 * but use distinct window kinds so they cannot consume attempt-admission rows.
 */
export function createEarlyCheckoutRateAdmissionReferences(input: {
  firestore: Firestore;
  sourceHash: string;
  nowMillis: number;
}): CheckoutEarlyRateAdmissionReferences {
  const burst = createCheckoutRateBucket(
    input.sourceHash,
    "request_burst",
    input.nowMillis
  );
  const hourly = createCheckoutRateBucket(
    input.sourceHash,
    "request_hourly",
    input.nowMillis
  );
  return {
    burst: {
      ...burst,
      ref: rateLimitCollection(input.firestore).doc(burst.id),
    },
    hourly: {
      ...hourly,
      ref: rateLimitCollection(input.firestore).doc(hourly.id),
    },
  };
}

export function createCheckoutRateAdmissionReferences(input: {
  firestore: Firestore;
  intentRef: DocumentReference;
  checkoutAttemptHash: string;
  sourceHash: string;
  nowMillis: number;
}): CheckoutRateAdmissionReferences {
  requireSha256Hex(input.checkoutAttemptHash, "checkoutAttemptHash");
  const burst = createCheckoutRateBucket(
    input.sourceHash,
    "burst",
    input.nowMillis
  );
  const daily = createCheckoutRateBucket(
    input.sourceHash,
    "daily",
    input.nowMillis
  );
  return {
    intentRef: input.intentRef,
    admissionRef: input.firestore
      .collection(CHECKOUT_RATE_ADMISSION_COLLECTION)
      .doc(input.checkoutAttemptHash),
    burst: {...burst, ref: rateLimitCollection(input.firestore).doc(burst.id)},
    daily: {...daily, ref: rateLimitCollection(input.firestore).doc(daily.id)},
  };
}

function timestampMillis(value: unknown): number | null {
  return value instanceof Timestamp ? value.toMillis() : null;
}

function readBucketCount(
  snapshot: FirebaseFirestore.DocumentSnapshot,
  bucket: CheckoutRateBucket
): number {
  if (!snapshot.exists) return 0;
  const count = snapshot.get("count");
  const startedAt = timestampMillis(snapshot.get("windowStartedAt"));
  const endsAt = timestampMillis(snapshot.get("windowEndsAt"));
  if (!Number.isSafeInteger(count) || count < 0 ||
    snapshot.get("sourceHash") !== bucket.sourceHash ||
    snapshot.get("windowKind") !== bucket.kind ||
    startedAt !== bucket.windowStartedAtMillis ||
    endsAt !== bucket.windowEndsAtMillis) {
    throw new CheckoutRateLimitStateError(
      `Stored ${bucket.kind} checkout rate-limit state is malformed.`
    );
  }
  return count as number;
}

function writeBucket(
  transaction: Transaction,
  bucket: CheckoutRateBucket & {ref: DocumentReference},
  count: number,
  nowMillis: number
): void {
  transaction.set(bucket.ref, {
    schemaVersion: CHECKOUT_ABUSE_SCHEMA_VERSION,
    sourceHash: bucket.sourceHash,
    windowKind: bucket.kind,
    windowStartedAt: Timestamp.fromMillis(bucket.windowStartedAtMillis),
    windowEndsAt: Timestamp.fromMillis(bucket.windowEndsAtMillis),
    count: count + 1,
    updatedAt: Timestamp.fromMillis(nowMillis),
    expiresAt: Timestamp.fromMillis(bucket.expiresAtMillis),
  });
}

/**
 * Counts an App-Check-verified invocation before untrusted payload/auth data is
 * parsed. Every invocation is counted, including retries, but these generous
 * request-only windows are independent of the stricter idempotent attempt
 * admission below. No address, payload or attempt identifier is stored.
 */
export async function admitEarlyMembershipCheckoutRequest(input: {
  firestore: Firestore;
  sourceHash: string;
  nowMillis: number;
}): Promise<CheckoutEarlyRateAdmissionResult> {
  requireSha256Hex(input.sourceHash, "sourceHash");
  requireNowMillis(input.nowMillis);
  const refs = createEarlyCheckoutRateAdmissionReferences(input);

  return input.firestore.runTransaction(async (transaction) => {
    const [burst, hourly] = await Promise.all([
      transaction.get(refs.burst.ref),
      transaction.get(refs.hourly.ref),
    ]);
    const counts = {
      request_burst: readBucketCount(burst, refs.burst),
      request_hourly: readBucketCount(hourly, refs.hourly),
    };
    const exceeded = ([refs.burst, refs.hourly] as const)
      .filter((bucket) => counts[bucket.kind] >= bucket.limit);
    if (exceeded.length) {
      const retryAfterSeconds = Math.max(...exceeded.map((bucket) =>
        Math.max(1, Math.ceil(
          (bucket.windowEndsAtMillis - input.nowMillis) / 1000
        ))
      ));
      throw new CheckoutRateLimitExceededError(
        retryAfterSeconds,
        exceeded.map((bucket) => bucket.kind)
      );
    }

    writeBucket(
      transaction,
      refs.burst,
      counts.request_burst,
      input.nowMillis
    );
    writeBucket(
      transaction,
      refs.hourly,
      counts.request_hourly,
      input.nowMillis
    );
    return {status: "admitted", burst: refs.burst, hourly: refs.hourly};
  });
}

/**
 * Atomically admits one new fingerprint before provider configuration is read.
 *
 * An existing intent always wins. An active admission also follows the stable
 * attempt across an IP/network change. A different fingerprint can never use
 * either record as a bypass.
 */
export async function admitMembershipCheckoutAttempt(input: {
  firestore: Firestore;
  intentRef: DocumentReference;
  checkoutAttemptHash: string;
  requestFingerprint: string;
  sourceHash: string;
  nowMillis: number;
}): Promise<CheckoutRateAdmissionResult> {
  requireSha256Hex(input.checkoutAttemptHash, "checkoutAttemptHash");
  requireSha256Hex(input.requestFingerprint, "requestFingerprint");
  requireSha256Hex(input.sourceHash, "sourceHash");
  requireNowMillis(input.nowMillis);
  const refs = createCheckoutRateAdmissionReferences(input);

  return input.firestore.runTransaction(async (transaction) => {
    // Firestore requires all reads before any writes in a transaction.
    const [intent, admission, burst, daily] = await Promise.all([
      transaction.get(refs.intentRef),
      transaction.get(refs.admissionRef),
      transaction.get(refs.burst.ref),
      transaction.get(refs.daily.ref),
    ]);

    if (intent.exists) {
      if (intent.get("requestFingerprint") !== input.requestFingerprint) {
        throw new CheckoutAttemptFingerprintMismatchError();
      }
      return {status: "existing_intent", burst: refs.burst, daily: refs.daily};
    }

    if (admission.exists) {
      if (admission.get("requestFingerprint") !== input.requestFingerprint) {
        throw new CheckoutAttemptFingerprintMismatchError();
      }
      const expiresAt = timestampMillis(admission.get("expiresAt"));
      if (expiresAt === null) {
        throw new CheckoutRateLimitStateError(
          "Stored checkout rate admission is malformed."
        );
      }
      if (expiresAt > input.nowMillis) {
        return {
          status: "existing_admission",
          burst: refs.burst,
          daily: refs.daily,
        };
      }
    }

    const counts = {
      burst: readBucketCount(burst, refs.burst),
      daily: readBucketCount(daily, refs.daily),
    };
    const exceeded = ([refs.burst, refs.daily] as const)
      .filter((bucket) => counts[bucket.kind] >= bucket.limit);
    if (exceeded.length) {
      const retryAfterSeconds = Math.max(...exceeded.map((bucket) =>
        Math.max(1, Math.ceil(
          (bucket.windowEndsAtMillis - input.nowMillis) / 1000
        ))
      ));
      throw new CheckoutRateLimitExceededError(
        retryAfterSeconds,
        exceeded.map((bucket) => bucket.kind)
      );
    }

    transaction.set(refs.admissionRef, {
      schemaVersion: CHECKOUT_ABUSE_SCHEMA_VERSION,
      requestFingerprint: input.requestFingerprint,
      sourceHash: input.sourceHash,
      admittedAt: Timestamp.fromMillis(input.nowMillis),
      expiresAt: Timestamp.fromMillis(
        input.nowMillis + CHECKOUT_RATE_RECORD_RETENTION_MS
      ),
    });
    writeBucket(transaction, refs.burst, counts.burst, input.nowMillis);
    writeBucket(transaction, refs.daily, counts.daily, input.nowMillis);
    return {status: "admitted", burst: refs.burst, daily: refs.daily};
  });
}
