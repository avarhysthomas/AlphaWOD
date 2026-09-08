"use strict";
/* eslint-disable require-jsdoc, valid-jsdoc */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CheckoutRateLimitStateError = exports.CheckoutRateLimitExceededError = exports.CheckoutAttemptFingerprintMismatchError = exports.CHECKOUT_RATE_LIMIT_COLLECTION = exports.CHECKOUT_RATE_ADMISSION_COLLECTION = exports.CHECKOUT_RATE_RECORD_RETENTION_MS = exports.CHECKOUT_EARLY_HOURLY_WINDOW_MS = exports.CHECKOUT_EARLY_HOURLY_LIMIT = exports.CHECKOUT_EARLY_BURST_WINDOW_MS = exports.CHECKOUT_EARLY_BURST_LIMIT = exports.CHECKOUT_DAILY_WINDOW_MS = exports.CHECKOUT_DAILY_LIMIT = exports.CHECKOUT_BURST_WINDOW_MS = exports.CHECKOUT_BURST_LIMIT = exports.CHECKOUT_ABUSE_SCHEMA_VERSION = void 0;
exports.normalizeCheckoutSourceAddress = normalizeCheckoutSourceAddress;
exports.deriveCheckoutSourceHash = deriveCheckoutSourceHash;
exports.createCheckoutRateBucket = createCheckoutRateBucket;
exports.createEarlyCheckoutRateAdmissionReferences = createEarlyCheckoutRateAdmissionReferences;
exports.createCheckoutRateAdmissionReferences = createCheckoutRateAdmissionReferences;
exports.admitEarlyMembershipCheckoutRequest = admitEarlyMembershipCheckoutRequest;
exports.admitMembershipCheckoutAttempt = admitMembershipCheckoutAttempt;
/**
 * Server-only admission controls for anonymous membership checkout.
 *
 * The browser's checkout attempt is already stable across safe retries. This
 * module gives each new attempt one rate-limit admission without charging the
 * same attempt again when Stripe or the network is retried. Neither source IP
 * addresses nor raw attempt identifiers are persisted.
 */
const crypto_1 = require("crypto");
const net_1 = require("net");
const firestore_1 = require("firebase-admin/firestore");
exports.CHECKOUT_ABUSE_SCHEMA_VERSION = 1;
exports.CHECKOUT_BURST_LIMIT = 6;
exports.CHECKOUT_BURST_WINDOW_MS = 10 * 60 * 1000;
exports.CHECKOUT_DAILY_LIMIT = 20;
exports.CHECKOUT_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
// This pre-parse guard intentionally sits far above the valid-attempt limits.
// It catches request floods without turning ordinary network retries into new
// checkout attempts or making shared household/NAT traffic fragile.
exports.CHECKOUT_EARLY_BURST_LIMIT = 60;
exports.CHECKOUT_EARLY_BURST_WINDOW_MS = 60 * 1000;
exports.CHECKOUT_EARLY_HOURLY_LIMIT = 600;
exports.CHECKOUT_EARLY_HOURLY_WINDOW_MS = 60 * 60 * 1000;
exports.CHECKOUT_RATE_RECORD_RETENTION_MS = 48 * 60 * 60 * 1000;
exports.CHECKOUT_RATE_ADMISSION_COLLECTION = "membershipCheckoutRateAdmissions";
exports.CHECKOUT_RATE_LIMIT_COLLECTION = "membershipCheckoutRateLimits";
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const MINIMUM_HMAC_SECRET_BYTES = 32;
class CheckoutAttemptFingerprintMismatchError extends Error {
    constructor() {
        super("This checkout attempt was already used with different details.");
        this.name = "CheckoutAttemptFingerprintMismatchError";
    }
}
exports.CheckoutAttemptFingerprintMismatchError = CheckoutAttemptFingerprintMismatchError;
class CheckoutRateLimitExceededError extends Error {
    constructor(retryAfterSeconds, windows) {
        super("Too many new checkout attempts. Wait before trying again.");
        this.name = "CheckoutRateLimitExceededError";
        this.retryAfterSeconds = retryAfterSeconds;
        this.windows = windows;
    }
}
exports.CheckoutRateLimitExceededError = CheckoutRateLimitExceededError;
class CheckoutRateLimitStateError extends Error {
    constructor(message) {
        super(message);
        this.name = "CheckoutRateLimitStateError";
    }
}
exports.CheckoutRateLimitStateError = CheckoutRateLimitStateError;
/** Canonicalises the proxy-resolved address before applying the server HMAC. */
function normalizeCheckoutSourceAddress(value) {
    if (typeof value !== "string") {
        throw new CheckoutRateLimitStateError("Checkout source address is unavailable.");
    }
    let address = value.trim();
    if (address.startsWith("[") && address.endsWith("]")) {
        address = address.slice(1, -1);
    }
    const version = (0, net_1.isIP)(address);
    if (version === 4) {
        return address.split(".").map((part) => String(Number(part))).join(".");
    }
    if (version !== 6) {
        throw new CheckoutRateLimitStateError("Checkout source address is invalid.");
    }
    // WHATWG URL parsing emits one canonical, compressed, lowercase IPv6 form.
    const hostname = new URL(`http://[${address}]/`).hostname;
    return hostname.slice(1, -1);
}
/**
 * Creates a non-enumerable pseudonymous key. A plain digest is unsafe because
 * the IPv4 address space can be exhaustively hashed offline.
 */
function deriveCheckoutSourceHash(value, secret) {
    if (typeof secret !== "string" ||
        Buffer.byteLength(secret, "utf8") < MINIMUM_HMAC_SECRET_BYTES) {
        throw new CheckoutRateLimitStateError("Checkout rate-limit secret must contain at least 32 bytes.");
    }
    const address = normalizeCheckoutSourceAddress(value);
    return (0, crypto_1.createHmac)("sha256", secret)
        .update(`membership-checkout-source:v1:${address}`, "utf8")
        .digest("hex");
}
function requireSha256Hex(value, field) {
    if (!SHA256_HEX_PATTERN.test(value)) {
        throw new CheckoutRateLimitStateError(`${field} must be a lowercase SHA-256 digest.`);
    }
}
function requireNowMillis(value) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new CheckoutRateLimitStateError("Checkout admission time must be a non-negative integer.");
    }
}
/** Returns the deterministic fixed-window row for one pseudonymous source. */
function createCheckoutRateBucket(sourceHash, kind, nowMillis) {
    requireSha256Hex(sourceHash, "sourceHash");
    requireNowMillis(nowMillis);
    const configuration = {
        burst: {
            windowMs: exports.CHECKOUT_BURST_WINDOW_MS,
            limit: exports.CHECKOUT_BURST_LIMIT,
        },
        daily: {
            windowMs: exports.CHECKOUT_DAILY_WINDOW_MS,
            limit: exports.CHECKOUT_DAILY_LIMIT,
        },
        request_burst: {
            windowMs: exports.CHECKOUT_EARLY_BURST_WINDOW_MS,
            limit: exports.CHECKOUT_EARLY_BURST_LIMIT,
        },
        request_hourly: {
            windowMs: exports.CHECKOUT_EARLY_HOURLY_WINDOW_MS,
            limit: exports.CHECKOUT_EARLY_HOURLY_LIMIT,
        },
    };
    const { windowMs, limit } = configuration[kind];
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
        expiresAtMillis: windowEndsAtMillis + exports.CHECKOUT_RATE_RECORD_RETENTION_MS,
    };
}
function rateLimitCollection(firestore) {
    return firestore.collection(exports.CHECKOUT_RATE_LIMIT_COLLECTION);
}
/**
 * Returns the two deterministic request-volume rows used before payload/auth
 * parsing. They deliberately share the private TTL-managed rate collection,
 * but use distinct window kinds so they cannot consume attempt-admission rows.
 */
function createEarlyCheckoutRateAdmissionReferences(input) {
    const burst = createCheckoutRateBucket(input.sourceHash, "request_burst", input.nowMillis);
    const hourly = createCheckoutRateBucket(input.sourceHash, "request_hourly", input.nowMillis);
    return {
        burst: Object.assign(Object.assign({}, burst), { ref: rateLimitCollection(input.firestore).doc(burst.id) }),
        hourly: Object.assign(Object.assign({}, hourly), { ref: rateLimitCollection(input.firestore).doc(hourly.id) }),
    };
}
function createCheckoutRateAdmissionReferences(input) {
    requireSha256Hex(input.checkoutAttemptHash, "checkoutAttemptHash");
    const burst = createCheckoutRateBucket(input.sourceHash, "burst", input.nowMillis);
    const daily = createCheckoutRateBucket(input.sourceHash, "daily", input.nowMillis);
    return {
        intentRef: input.intentRef,
        admissionRef: input.firestore
            .collection(exports.CHECKOUT_RATE_ADMISSION_COLLECTION)
            .doc(input.checkoutAttemptHash),
        burst: Object.assign(Object.assign({}, burst), { ref: rateLimitCollection(input.firestore).doc(burst.id) }),
        daily: Object.assign(Object.assign({}, daily), { ref: rateLimitCollection(input.firestore).doc(daily.id) }),
    };
}
function timestampMillis(value) {
    return value instanceof firestore_1.Timestamp ? value.toMillis() : null;
}
function readBucketCount(snapshot, bucket) {
    if (!snapshot.exists)
        return 0;
    const count = snapshot.get("count");
    const startedAt = timestampMillis(snapshot.get("windowStartedAt"));
    const endsAt = timestampMillis(snapshot.get("windowEndsAt"));
    if (!Number.isSafeInteger(count) || count < 0 ||
        snapshot.get("sourceHash") !== bucket.sourceHash ||
        snapshot.get("windowKind") !== bucket.kind ||
        startedAt !== bucket.windowStartedAtMillis ||
        endsAt !== bucket.windowEndsAtMillis) {
        throw new CheckoutRateLimitStateError(`Stored ${bucket.kind} checkout rate-limit state is malformed.`);
    }
    return count;
}
function writeBucket(transaction, bucket, count, nowMillis) {
    transaction.set(bucket.ref, {
        schemaVersion: exports.CHECKOUT_ABUSE_SCHEMA_VERSION,
        sourceHash: bucket.sourceHash,
        windowKind: bucket.kind,
        windowStartedAt: firestore_1.Timestamp.fromMillis(bucket.windowStartedAtMillis),
        windowEndsAt: firestore_1.Timestamp.fromMillis(bucket.windowEndsAtMillis),
        count: count + 1,
        updatedAt: firestore_1.Timestamp.fromMillis(nowMillis),
        expiresAt: firestore_1.Timestamp.fromMillis(bucket.expiresAtMillis),
    });
}
/**
 * Counts an App-Check-verified invocation before untrusted payload/auth data is
 * parsed. Every invocation is counted, including retries, but these generous
 * request-only windows are independent of the stricter idempotent attempt
 * admission below. No address, payload or attempt identifier is stored.
 */
async function admitEarlyMembershipCheckoutRequest(input) {
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
        const exceeded = [refs.burst, refs.hourly]
            .filter((bucket) => counts[bucket.kind] >= bucket.limit);
        if (exceeded.length) {
            const retryAfterSeconds = Math.max(...exceeded.map((bucket) => Math.max(1, Math.ceil((bucket.windowEndsAtMillis - input.nowMillis) / 1000))));
            throw new CheckoutRateLimitExceededError(retryAfterSeconds, exceeded.map((bucket) => bucket.kind));
        }
        writeBucket(transaction, refs.burst, counts.request_burst, input.nowMillis);
        writeBucket(transaction, refs.hourly, counts.request_hourly, input.nowMillis);
        return { status: "admitted", burst: refs.burst, hourly: refs.hourly };
    });
}
/**
 * Atomically admits one new fingerprint before provider configuration is read.
 *
 * An existing intent always wins. An active admission also follows the stable
 * attempt across an IP/network change. A different fingerprint can never use
 * either record as a bypass.
 */
async function admitMembershipCheckoutAttempt(input) {
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
            return { status: "existing_intent", burst: refs.burst, daily: refs.daily };
        }
        if (admission.exists) {
            if (admission.get("requestFingerprint") !== input.requestFingerprint) {
                throw new CheckoutAttemptFingerprintMismatchError();
            }
            const expiresAt = timestampMillis(admission.get("expiresAt"));
            if (expiresAt === null) {
                throw new CheckoutRateLimitStateError("Stored checkout rate admission is malformed.");
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
        const exceeded = [refs.burst, refs.daily]
            .filter((bucket) => counts[bucket.kind] >= bucket.limit);
        if (exceeded.length) {
            const retryAfterSeconds = Math.max(...exceeded.map((bucket) => Math.max(1, Math.ceil((bucket.windowEndsAtMillis - input.nowMillis) / 1000))));
            throw new CheckoutRateLimitExceededError(retryAfterSeconds, exceeded.map((bucket) => bucket.kind));
        }
        transaction.set(refs.admissionRef, {
            schemaVersion: exports.CHECKOUT_ABUSE_SCHEMA_VERSION,
            requestFingerprint: input.requestFingerprint,
            sourceHash: input.sourceHash,
            admittedAt: firestore_1.Timestamp.fromMillis(input.nowMillis),
            expiresAt: firestore_1.Timestamp.fromMillis(input.nowMillis + exports.CHECKOUT_RATE_RECORD_RETENTION_MS),
        });
        writeBucket(transaction, refs.burst, counts.burst, input.nowMillis);
        writeBucket(transaction, refs.daily, counts.daily, input.nowMillis);
        return { status: "admitted", burst: refs.burst, daily: refs.daily };
    });
}
//# sourceMappingURL=membershipCheckoutAbuse.js.map