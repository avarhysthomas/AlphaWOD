"use strict";
/* eslint-disable
  require-jsdoc,
  valid-jsdoc,
  max-len,
  @typescript-eslint/no-explicit-any
*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.__testing = exports.getMyMemberships = exports.createCustomerPortalSession = exports.MEMBERSHIP_EMAIL_WORKER_SECRETS = exports.MEMBERSHIP_STRIPE_WORKER_SECRETS = exports.MEMBERSHIP_WEBHOOK_SECRETS = exports.MEMBERSHIP_CHECKOUT_SECRETS = exports.MEMBERSHIP_SECRETS = exports.MEMBERSHIP_CHECKOUT_SCHEMA_VERSION = void 0;
exports.reconcileMembershipFutureBookings = reconcileMembershipFutureBookings;
exports.buildReconcileMembershipBookings = buildReconcileMembershipBookings;
exports.assertStripeMembershipBookingEligibility = assertStripeMembershipBookingEligibility;
exports.buildReconcilePastDueMemberships = buildReconcilePastDueMemberships;
exports.buildCreateMembershipCheckoutSession = buildCreateMembershipCheckoutSession;
exports.buildRecoverMembershipCancellations = buildRecoverMembershipCancellations;
exports.buildRequestMembershipCancellation = buildRequestMembershipCancellation;
exports.buildClaimMembership = buildClaimMembership;
exports.buildStripeWebhook = buildStripeWebhook;
exports.buildRecoverStripeEvents = buildRecoverStripeEvents;
exports.buildListMemberships = buildListMemberships;
exports.buildReleaseAbandonedMembershipCheckout = buildReleaseAbandonedMembershipCheckout;
exports.buildLinkMembershipParticipant = buildLinkMembershipParticipant;
exports.buildRetryMembershipConfirmations = buildRetryMembershipConfirmations;
/**
 * Phase 1: public membership purchase, Stripe Billing, and the membership
 * state that drives AlphaWOD entitlement.
 *
 * Design rules carried over from Phase 0 and the approved policy documents:
 *
 * - Firestore documents, never client input and never ID-token claims, are
 *   authoritative for access. Every entitlement change here goes through the
 *   same `resolveUserAuthorisation` derivation the rest of the app uses.
 * - Stripe is the authority for subscription state. Webhook payloads are
 *   treated only as a signal to re-read the subscription, so an out-of-order
 *   delivery can never install stale access.
 * - The browser never computes a chargeable amount or a billing date. Stripe
 *   calculates the proration; the server calculates every cancellation date.
 * - Participant and guardian details are written by the server only and are
 *   never exposed to client rules.
 */
const https_1 = require("firebase-functions/v2/https");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const params_1 = require("firebase-functions/params");
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const crypto_1 = require("crypto");
const stripe_1 = __importDefault(require("stripe"));
const membershipPlans_1 = require("./membershipPlans");
const authz_1 = require("./authz");
const conditioningQuota_1 = require("./conditioningQuota");
const membershipCheckoutAbuse_1 = require("./membershipCheckoutAbuse");
const membershipCancellation_1 = require("./membershipCancellation");
const membershipCheckoutRecovery_1 = require("./membershipCheckoutRecovery");
const stripeLiveCatalog_1 = require("./stripeLiveCatalog");
/**
 * Version of the browser/server checkout contract and the legal/commercial
 * snapshot it accepts. Keep this independent from the stored document schema:
 * a Firestore migration must not invalidate an otherwise exact Stripe retry.
 */
exports.MEMBERSHIP_CHECKOUT_SCHEMA_VERSION = 6;
const REGION = "europe-west1";
/**
 * Region is set explicitly on every definition rather than relying on the
 * global option in index.ts, because module import order decides whether that
 * global has been applied when these definitions are evaluated.
 */
const stripeSecretKey = (0, params_1.defineSecret)("STRIPE_SECRET_KEY");
const stripeWebhookSecret = (0, params_1.defineSecret)("STRIPE_WEBHOOK_SECRET");
const resendApiKey = (0, params_1.defineSecret)("RESEND_API_KEY");
const membershipCheckoutRateLimitSecret = (0, params_1.defineSecret)("MEMBERSHIP_CHECKOUT_RATE_LIMIT_SECRET");
const membershipFromEmail = (0, params_1.defineString)("MEMBERSHIP_FROM_EMAIL", {
    default: membershipPlans_1.COMPANY.confirmationSender,
});
const appPublicOrigin = (0, params_1.defineString)("APP_PUBLIC_ORIGIN", {
    default: "https://alpha-wod.vercel.app",
});
const stripePortalConfigurationId = (0, params_1.defineString)("STRIPE_PORTAL_CONFIGURATION_ID", {
    default: "",
});
const membershipPurchaseEnabled = (0, params_1.defineString)("MEMBERSHIP_PURCHASE_ENABLED", {
    default: "false",
});
const adultConditioningPurchaseEnabled = (0, params_1.defineString)("ADULT_CONDITIONING_PURCHASE_ENABLED", { default: "false" });
const adultConditioningLegalApproved = (0, params_1.defineString)("ADULT_CONDITIONING_LEGAL_APPROVED", { default: "false" });
const membershipTestJourneyEnabled = (0, params_1.defineString)("MEMBERSHIP_TEST_JOURNEY_ENABLED", {
    default: "false",
});
const membershipFirebaseProjectId = (0, params_1.defineString)("MEMBERSHIP_FIREBASE_PROJECT_ID", {
    default: "",
});
const membershipCheckoutAppId = (0, params_1.defineString)("MEMBERSHIP_CHECKOUT_APP_ID", {
    default: "",
});
const stripeExpectedMode = (0, params_1.defineString)("STRIPE_EXPECTED_MODE", {
    default: "",
});
const stripeExistingMemberCouponId = (0, params_1.defineString)("STRIPE_EXISTING_MEMBER_COUPON_ID", { default: "" });
const stripeExistingMemberPromotionCodeId = (0, params_1.defineString)("STRIPE_EXISTING_MEMBER_PROMOTION_CODE_ID", { default: "" });
const stripeYouthFamilyCouponId = (0, params_1.defineString)("STRIPE_YOUTH_FAMILY_COUPON_ID", { default: "" });
const priceParams = {
    adult_unlimited: (0, params_1.defineString)("STRIPE_PRICE_ADULT_UNLIMITED", { default: "" }),
    adult_conditioning: (0, params_1.defineString)("STRIPE_PRICE_ADULT_CONDITIONING", { default: "" }),
    adult_ladies: (0, params_1.defineString)("STRIPE_PRICE_ADULT_LADIES", { default: "" }),
    adult_gym: (0, params_1.defineString)("STRIPE_PRICE_ADULT_GYM", { default: "" }),
    youth_youngstars: (0, params_1.defineString)("STRIPE_PRICE_YOUTH_YOUNGSTARS", { default: "" }),
    youth_teenstars: (0, params_1.defineString)("STRIPE_PRICE_YOUTH_TEENSTARS", { default: "" }),
};
const PRODUCTION_FIREBASE_PROJECT_ID = "alphawod-d1f2f";
const LOCAL_TEST_FIREBASE_PROJECT_ID = "demo-alphawod-stripe";
const LOCAL_TEST_JOURNEY_ORIGINS = new Set([
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3002",
    "http://127.0.0.1:3002",
]);
/**
 * The emulator receives short-lived test credentials from its parent process.
 * Bindings are omitted only for the exact demo project with both data-plane
 * emulators on loopback. A production or partially configured process keeps
 * its normal Secret Manager bindings even if FUNCTIONS_EMULATOR is injected.
 */
function secretsForRuntime(secrets) {
    return isIsolatedLocalTestEmulatorProcess() ? [] : secrets;
}
exports.MEMBERSHIP_SECRETS = secretsForRuntime([stripeSecretKey]);
exports.MEMBERSHIP_CHECKOUT_SECRETS = secretsForRuntime([
    stripeSecretKey,
    membershipCheckoutRateLimitSecret,
]);
exports.MEMBERSHIP_WEBHOOK_SECRETS = secretsForRuntime([
    stripeSecretKey,
    stripeWebhookSecret,
]);
exports.MEMBERSHIP_STRIPE_WORKER_SECRETS = secretsForRuntime([stripeSecretKey]);
exports.MEMBERSHIP_EMAIL_WORKER_SECRETS = secretsForRuntime([resendApiKey]);
/**
 * Firestore and Stripe clients are resolved lazily. `admin.initializeApp()`
 * runs in the body of index.ts, which executes after this module is imported.
 */
function db() {
    return admin.firestore();
}
let stripeClient = null;
function isFirebaseFunctionsEmulatorProcess() {
    return process.env.FUNCTIONS_EMULATOR === "true";
}
function isLoopbackEmulatorHost(value) {
    return typeof value === "string" &&
        /^(127\.0\.0\.1|localhost):\d+$/.test(value);
}
function hasLoopbackFirebaseEmulatorDataPlane() {
    return isFirebaseFunctionsEmulatorProcess() &&
        isLoopbackEmulatorHost(process.env.FIRESTORE_EMULATOR_HOST) &&
        isLoopbackEmulatorHost(process.env.FIREBASE_AUTH_EMULATOR_HOST);
}
/** Resolves the Firebase project identity Cloud Functions actually supplied. */
function runtimeFirebaseProjectId() {
    const direct = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
    if (direct === null || direct === void 0 ? void 0 : direct.trim())
        return direct.trim();
    try {
        const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG || "{}");
        return typeof firebaseConfig.projectId === "string" ?
            firebaseConfig.projectId.trim() : "";
    }
    catch (_a) {
        return "";
    }
}
/** The only runtime allowed to receive memory-only local test credentials. */
function isIsolatedLocalTestEmulatorProcess() {
    return hasLoopbackFirebaseEmulatorDataPlane() &&
        runtimeFirebaseProjectId() === LOCAL_TEST_FIREBASE_PROJECT_ID;
}
/**
 * Binds one Firebase data plane to one explicit Stripe mode without requiring
 * a Stripe credential. Firestore-only workers use this guard so they can
 * validate frozen billing evidence while retaining least-privilege secrets.
 */
function assertBillingDataPlaneEnvironment() {
    const expectedProjectId = membershipFirebaseProjectId.value().trim();
    const projectId = runtimeFirebaseProjectId();
    if (!expectedProjectId || !projectId || expectedProjectId !== projectId) {
        throw new https_1.HttpsError("failed-precondition", "Billing is disabled because the Firebase project identity is not explicitly matched.");
    }
    const rawMode = stripeExpectedMode.value().trim().toLowerCase();
    if (rawMode !== "test" && rawMode !== "live") {
        throw new https_1.HttpsError("failed-precondition", "Billing is disabled because the expected Stripe mode is not configured.");
    }
    const stripeMode = rawMode;
    if (projectId === PRODUCTION_FIREBASE_PROJECT_ID && stripeMode === "test") {
        throw new https_1.HttpsError("failed-precondition", "Stripe test mode is forbidden in the production Firebase project.");
    }
    if (projectId === LOCAL_TEST_FIREBASE_PROJECT_ID && stripeMode !== "test") {
        throw new https_1.HttpsError("failed-precondition", "Stripe live mode is forbidden in the isolated local Firebase project.");
    }
    if (isFirebaseFunctionsEmulatorProcess() && stripeMode === "live") {
        throw new https_1.HttpsError("failed-precondition", "Stripe live mode is forbidden in every Firebase emulator process.");
    }
    return {
        projectId,
        stripeMode,
        expectedLivemode: stripeMode === "live",
    };
}
/**
 * Binds one Firebase data plane to one explicit Stripe mode before any Stripe
 * network call. This prevents a test key being aimed at production Firestore,
 * or a live key being used from the isolated test project.
 */
function assertBillingEnvironment() {
    const environment = assertBillingDataPlaneEnvironment();
    const key = stripeSecretKey.value().trim();
    const keyMode = key.startsWith("sk_test_") || key.startsWith("rk_test_") ? "test" :
        key.startsWith("sk_live_") || key.startsWith("rk_live_") ? "live" : null;
    if (keyMode !== environment.stripeMode) {
        throw new https_1.HttpsError("failed-precondition", "Billing is disabled because the Stripe key does not match the configured mode.");
    }
    return environment;
}
/** Refuses a provider object from the other half of Stripe's test/live split. */
function assertStripeObjectMode(objectType, objectId, livemode) {
    const environment = assertBillingEnvironment();
    if (typeof livemode !== "boolean" ||
        livemode !== environment.expectedLivemode) {
        console.error("CRITICAL_BILLING_STRIPE_MODE_MISMATCH", {
            projectId: environment.projectId,
            expectedStripeMode: environment.stripeMode,
            objectType,
            objectId,
            livemode: typeof livemode === "boolean" ? livemode : null,
        });
        throw new https_1.HttpsError("failed-precondition", `Billing refused a ${objectType} from the wrong Stripe mode.`);
    }
}
/**
 * Optional API host override.
 *
 * Stripe documents host/port/protocol so an integration suite can run against
 * a local mock instead of the live API. It is read from the environment and is
 * never set in a deployed environment, so production always talks to Stripe.
 */
function stripeHostOptions() {
    const host = process.env.STRIPE_API_HOST;
    if (!host)
        return {};
    if (!hasLoopbackFirebaseEmulatorDataPlane() ||
        stripeExpectedMode.value().trim().toLowerCase() !== "test") {
        throw new https_1.HttpsError("failed-precondition", "The Stripe API host override is allowed only in the isolated emulator suite.");
    }
    return {
        host,
        port: Number(process.env.STRIPE_API_PORT || 12111),
        protocol: process.env.STRIPE_API_PROTOCOL || "http",
    };
}
function stripe() {
    assertBillingEnvironment();
    const key = stripeSecretKey.value();
    if (!key) {
        throw new https_1.HttpsError("failed-precondition", "Billing is not configured.");
    }
    if (!stripeClient) {
        stripeClient = new stripe_1.default(key, Object.assign({ maxNetworkRetries: 2, timeout: 20000 }, stripeHostOptions()));
    }
    return stripeClient;
}
const serverTimestamp = () => firestore_1.FieldValue.serverTimestamp();
/**
 * Compatibility projection for the existing Stripe cancellation recovery.
 * The immutable cooling-off receipt remains authoritative for the legal
 * effective/access stop; this shape only lets the established worker perform
 * and verify an immediate provider cancellation.
 */
function resolveCoolingOffCancellationOutcome(receivedAtMillis) {
    const receivedAtUnixSeconds = Math.floor(receivedAtMillis / 1000);
    return Object.assign(Object.assign({}, (0, membershipPlans_1.resolveCancellationOutcome)(receivedAtMillis)), { noticeDeadlineMet: true, finalPaymentDate: null, accessEndsOnDate: (0, membershipPlans_1.formatUnixBillingIsoDate)(receivedAtUnixSeconds), cancelAtUnixSeconds: receivedAtUnixSeconds });
}
function cancellationAcknowledgementStatusForClient(status) {
    if (status === "sent")
        return "sent";
    if (status === "pending" || status === "sending")
        return "pending";
    if (status === "dead_letter" || status === "manual_review")
        return "failed";
    return null;
}
function isPresaleIntent(intent) {
    return intent.billingMode === "presale_deferred";
}
function addUtcMonths(unixSeconds, months) {
    const date = new Date(unixSeconds * 1000);
    return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()) / 1000);
}
function resolvePresaleCancellationOutcome(receivedAtMillis, membership) {
    const receivedAt = Math.floor(receivedAtMillis / 1000);
    const firstPaymentDate = (0, membershipPlans_1.formatUnixBillingIsoDate)(membership.firstPaymentAt);
    const noticeDaysGiven = Math.max(0, Math.floor((membership.firstPaymentAt * 1000 - receivedAtMillis) /
        (24 * 60 * 60 * 1000)));
    return {
        nextBillingDate: firstPaymentDate,
        noticeDeadlineMet: true,
        noticeDaysGiven,
        noticeDeadlineDate: (0, membershipPlans_1.formatUnixBillingIsoDate)(membership.firstPaymentAt - membershipPlans_1.BILLING_POLICY.cancellationNoticeDays * 24 * 60 * 60),
        finalPaymentDate: null,
        accessEndsOnDate: (0, membershipPlans_1.formatUnixBillingIsoDate)(membership.serviceStartsAt - 1),
        // This request withdraws a not-yet-started service. Freezing receipt time
        // makes recovery cancel immediately and guarantees no opening-day invoice.
        cancelAtUnixSeconds: receivedAt,
    };
}
/** Normalises legacy singular records into the current ordered participant set. */
function participantsFor(value) {
    if (Array.isArray(value.participants) && value.participants.length > 0) {
        return value.participants;
    }
    return value.participant ? [value.participant] : [];
}
function participantKeysFor(value) {
    const stored = Array.isArray(value.participantKeys) ?
        value.participantKeys.filter((key) => typeof key === "string" && key) : [];
    const derived = participantsFor(value).map(({ participantKey }) => participantKey);
    return [...new Set(stored.length > 0 ? stored : derived)];
}
function participantCountFor(value) {
    const participants = participantsFor(value);
    return Number.isSafeInteger(value.participantCount) &&
        value.participantCount >= 1 ?
        value.participantCount : Math.max(1, participants.length);
}
function participantNamesFor(value) {
    return participantsFor(value).map(({ fullName }) => fullName).join(", ");
}
function createOrderSnapshot(commercialTerms, participantCount) {
    const standardMonthlyPence = commercialTerms.amountPence * participantCount;
    const familyDiscountApplies = youthFamilyDiscountApplies(commercialTerms.planKey, participantCount);
    const familyDiscountPercent = familyDiscountApplies ?
        membershipPlans_1.YOUTH_FAMILY_OFFER.percentOff : null;
    return {
        participantCount,
        unitAmountPence: commercialTerms.amountPence,
        standardMonthlyPence,
        familyDiscountPercent,
        recurringMonthlyPence: familyDiscountPercent === null ?
            standardMonthlyPence : Math.round(standardMonthlyPence * (100 - familyDiscountPercent) / 100),
    };
}
function orderFor(value) {
    var _a;
    const participantCount = participantCountFor(value);
    const commercialTerms = (_a = value.commercialTerms) !== null && _a !== void 0 ? _a : (0, membershipPlans_1.createCommercialPlanSnapshot)(value.planKey);
    const stored = value.order;
    if (stored && stored.participantCount === participantCount &&
        stored.unitAmountPence === commercialTerms.amountPence &&
        Number.isSafeInteger(stored.standardMonthlyPence) &&
        Number.isSafeInteger(stored.recurringMonthlyPence)) {
        return stored;
    }
    return createOrderSnapshot(commercialTerms, participantCount);
}
function conditioningEntitlementProjection(commercialTerms, planKey) {
    const policy = (0, membershipPlans_1.validateCommercialEntitlementPolicy)(commercialTerms, planKey);
    if (!policy || planKey !== "adult_conditioning") {
        return {
            conditioningBookingPolicy: null,
            entitlementClassSlots: [],
            entitlementWeeklyBookingLimit: null,
        };
    }
    return Object.assign({ conditioningBookingPolicy: policy.conditioningBookingPolicy, entitlementClassSlots: [...policy.entitlementClassSlots], entitlementWeeklyBookingLimit: policy.entitlementWeeklyBookingLimit }, (!policy.conditioningBookingPolicy ? {
        selectedConditioningSlots: [...policy.entitlementClassSlots],
    } : {}));
}
function youthFamilyDiscountPercentFor(discount) {
    return (discount === null || discount === void 0 ? void 0 : discount.kind) === "youth_family" &&
        (0, membershipPlans_1.isSupportedYouthFamilyDiscountPercent)(discount.percentOff) ?
        discount.percentOff : null;
}
function discountedMonthlyPenceFor(standardMonthlyPence, discount) {
    if (!discount)
        return null;
    const familyPercentOff = youthFamilyDiscountPercentFor(discount);
    if (familyPercentOff !== null) {
        return Math.round(standardMonthlyPence * (100 - familyPercentOff) / 100);
    }
    return typeof discount.amountOffPence === "number" ?
        Math.max(0, standardMonthlyPence - discount.amountOffPence) : null;
}
function paymentScheduleFor(intent, discount, observedInitialChargePence) {
    var _a, _b, _c;
    const order = orderFor(intent);
    const firstPaymentAt = (_a = intent.firstPaymentAt) !== null && _a !== void 0 ? _a : intent.billingCycleAnchor;
    return {
        amountDueTodayPence: (_b = intent.initialChargePence) !== null && _b !== void 0 ? _b : observedInitialChargePence,
        firstPaymentAt,
        standardMonthlyPence: order.standardMonthlyPence,
        discountedMonthlyPence: discountedMonthlyPenceFor(order.standardMonthlyPence, discount),
        discountedPaymentCount: (discount === null || discount === void 0 ? void 0 : discount.duration) === "forever" ?
            null : (_c = discount === null || discount === void 0 ? void 0 : discount.durationInMonths) !== null && _c !== void 0 ? _c : 0,
        fullPriceFrom: (discount === null || discount === void 0 ? void 0 : discount.duration) === "forever" ? null :
            typeof (discount === null || discount === void 0 ? void 0 : discount.durationInMonths) === "number" ?
                addUtcMonths(firstPaymentAt, discount.durationInMonths) : null,
    };
}
async function retrieveApprovedExistingMemberCoupon(billingStripe, productId, requireCurrentlyRedeemable = true) {
    var _a, _b;
    const configuredCouponId = stripeExistingMemberCouponId.value().trim();
    if (!configuredCouponId) {
        throw new https_1.HttpsError("failed-precondition", "The existing-member Coupon allowlist is not configured.");
    }
    // Stripe omits `applies_to` from the default representation. Expanding it
    // keeps this on the typed SDK path while making the Product allowlist
    // available for the fail-closed preflight and fulfilment checks.
    const coupon = await billingStripe.coupons.retrieve(configuredCouponId, {
        expand: ["applies_to"],
    });
    assertStripeObjectMode("Coupon", coupon.id, coupon.livemode);
    const applicableProducts = (_b = (_a = coupon.applies_to) === null || _a === void 0 ? void 0 : _a.products) !== null && _b !== void 0 ? _b : [];
    if (coupon.deleted || (requireCurrentlyRedeemable && coupon.valid !== true) ||
        coupon.amount_off !== membershipPlans_1.EXISTING_MEMBER_OFFER.amountOffPence ||
        coupon.currency !== membershipPlans_1.EXISTING_MEMBER_OFFER.currency || coupon.percent_off !== null ||
        coupon.duration !== "repeating" ||
        coupon.duration_in_months !== membershipPlans_1.EXISTING_MEMBER_OFFER.durationMonths ||
        // Stripe validates an amount-off Coupon against this deferred
        // subscription's future billing anchor. A Coupon that expires at the
        // earlier local-midnight signup cutoff is rejected as `coupon_expired`
        // even while `coupon.valid` is still true. Eligibility is bounded by the
        // exact allowlisted Promotion Code and app cutoff instead.
        coupon.redeem_by !== null ||
        coupon.max_redemptions !== null ||
        applicableProducts.length !== 1 || applicableProducts[0] !== productId) {
        throw new https_1.HttpsError("failed-precondition", "The configured existing-member Coupon does not match the approved £5 offer.");
    }
    return coupon;
}
function youthFamilyDiscountApplies(planKey, participantCount) {
    return membershipPlans_1.YOUTH_FAMILY_OFFER.eligiblePlanKeys.includes(planKey) &&
        participantCount >= membershipPlans_1.YOUTH_FAMILY_OFFER.minimumParticipants;
}
async function resolveApprovedYouthProductIds(billingStripe) {
    return Promise.all(membershipPlans_1.YOUTH_FAMILY_OFFER.eligiblePlanKeys.map(async (planKey) => {
        const typedPlanKey = planKey;
        return assertStripePriceMatchesPlan(billingStripe, resolvePriceId(typedPlanKey), (0, membershipPlans_1.getPlan)(typedPlanKey));
    }));
}
/** Validates a current or frozen historical family Coupon against both youth Products. */
async function retrieveApprovedYouthFamilyCoupon(billingStripe, couponId, expectedProductIds, expectedPercentOff, requireCurrentlyRedeemable = true) {
    var _a, _b;
    if (!couponId ||
        !(0, membershipPlans_1.isSupportedYouthFamilyDiscountPercent)(expectedPercentOff)) {
        throw new https_1.HttpsError("failed-precondition", "The youth family-discount Coupon allowlist or percentage is not configured.");
    }
    const coupon = await billingStripe.coupons.retrieve(couponId, {
        expand: ["applies_to"],
    });
    assertStripeObjectMode("Coupon", coupon.id, coupon.livemode);
    const applicableProducts = [...((_b = (_a = coupon.applies_to) === null || _a === void 0 ? void 0 : _a.products) !== null && _b !== void 0 ? _b : [])].sort();
    const expectedProducts = [...new Set(expectedProductIds)].sort();
    const exactProducts = applicableProducts.length === expectedProducts.length &&
        applicableProducts.every((id, index) => id === expectedProducts[index]);
    if (coupon.id !== couponId || coupon.deleted ||
        (requireCurrentlyRedeemable && coupon.valid !== true) ||
        coupon.percent_off !== expectedPercentOff ||
        coupon.amount_off !== null || coupon.currency !== null ||
        coupon.duration !== "forever" || coupon.duration_in_months !== null ||
        coupon.redeem_by !== null || coupon.max_redemptions !== null ||
        !exactProducts) {
        throw new https_1.HttpsError("failed-precondition", `The youth family Coupon does not match the approved ${expectedPercentOff}% offer.`);
    }
    return coupon;
}
function promotionCodeMatchesApprovedOffer(promotionCode, couponId) {
    var _a, _b, _c, _d, _e;
    const currencyOptions = (_a = promotionCode.restrictions) === null || _a === void 0 ? void 0 : _a.currency_options;
    return idOf((_b = promotionCode.promotion) === null || _b === void 0 ? void 0 : _b.coupon) === couponId &&
        promotionCode.max_redemptions === null &&
        promotionCode.expires_at ===
            membershipPlans_1.EXISTING_MEMBER_OFFER.promotionCodeExpiresAtUnixSeconds &&
        promotionCode.customer == null && promotionCode.customer_account == null &&
        ((_c = promotionCode.restrictions) === null || _c === void 0 ? void 0 : _c.first_time_transaction) !== true &&
        ((_d = promotionCode.restrictions) === null || _d === void 0 ? void 0 : _d.minimum_amount) === null &&
        ((_e = promotionCode.restrictions) === null || _e === void 0 ? void 0 : _e.minimum_amount_currency) === null &&
        (!currencyOptions || Object.keys(currencyOptions).length === 0);
}
/**
 * Validates Stripe's campaign-wide redemption counter without treating a
 * reusable code as if it belonged to one customer. The count may increase
 * between Checkout and fulfilment because the same campaign code is shared.
 */
function promotionCodeRedemptionCountIsCredible(promotionCode) {
    const redeemed = promotionCode.times_redeemed;
    return Number.isSafeInteger(redeemed) && redeemed >= 0;
}
async function resolveApprovedPromotionCodeForCheckout(billingStripe, normalizedCode) {
    const configuredCouponId = stripeExistingMemberCouponId.value().trim();
    const configuredPromotionCodeId = stripeExistingMemberPromotionCodeId.value().trim();
    if (!configuredPromotionCodeId) {
        throw new https_1.HttpsError("failed-precondition", "The existing-member Promotion Code allowlist is not configured.");
    }
    const matches = await billingStripe.promotionCodes.list({
        active: true,
        code: normalizedCode,
        limit: 10,
    });
    const exactMatches = matches.data.filter((promotionCode) => promotionCode.code.normalize("NFKC").trim().toUpperCase() === normalizedCode);
    if (exactMatches.length !== 1) {
        throw new https_1.HttpsError("failed-precondition", "This promotion code is not valid for the founding-member offer.");
    }
    const promotionCode = exactMatches[0];
    assertStripeObjectMode("Promotion Code", promotionCode.id, promotionCode.livemode);
    if (promotionCode.id !== configuredPromotionCodeId ||
        !promotionCodeMatchesApprovedOffer(promotionCode, configuredCouponId) ||
        promotionCode.active !== true ||
        !promotionCodeRedemptionCountIsCredible(promotionCode)) {
        throw new https_1.HttpsError("failed-precondition", "This promotion code is not valid for the founding-member offer.");
    }
    return promotionCode.id;
}
async function resolveApprovedCheckoutDiscount(session, subscription, intent, completionUnixSeconds) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const applied = (_a = session.discounts) !== null && _a !== void 0 ? _a : [];
    const participantCount = participantCountFor(intent);
    const familyDiscountExpected = youthFamilyDiscountApplies(intent.planKey, participantCount);
    if (familyDiscountExpected !== Boolean(intent.familyDiscountCouponId)) {
        throw new Error(`Checkout intent for ${session.id} has an invalid family-discount state.`);
    }
    if (applied.length === 0) {
        if (intent.promotionCodeId || intent.familyDiscountCouponId ||
            ((_b = subscription.discounts) !== null && _b !== void 0 ? _b : []).length > 0) {
            throw new Error(`Subscription ${subscription.id} has an unapproved discount.`);
        }
        return null;
    }
    if (intent.familyDiscountCouponId) {
        if (intent.promotionCodeId || applied.length !== 1) {
            throw new Error(`Checkout Session ${session.id} has an invalid family discount.`);
        }
        const frozenCouponId = intent.familyDiscountCouponId;
        const couponId = idOf(applied[0].coupon);
        const promotionCodeId = idOf(applied[0].promotion_code);
        if (couponId !== frozenCouponId || promotionCodeId !== null) {
            throw new Error(`Checkout Session ${session.id} used an unapproved family discount.`);
        }
        const billingStripe = stripe();
        const expectedProductIds = await resolveApprovedYouthProductIds(billingStripe);
        const frozenOrder = orderFor(intent);
        const frozenPercentOff = frozenOrder.familyDiscountPercent;
        if (!(0, membershipPlans_1.isSupportedYouthFamilyDiscountPercent)(frozenPercentOff) ||
            frozenOrder.recurringMonthlyPence !== Math.round(frozenOrder.standardMonthlyPence * (100 - frozenPercentOff) / 100)) {
            throw new Error(`Checkout intent for ${session.id} has an invalid frozen family discount.`);
        }
        const coupon = await retrieveApprovedYouthFamilyCoupon(billingStripe, frozenCouponId, expectedProductIds, frozenPercentOff, false);
        const subscriptionDiscounts = ((_c = subscription.discounts) !== null && _c !== void 0 ? _c : []).filter((value) => {
            var _a, _b, _c, _d;
            if (typeof value === "string")
                return false;
            const compatibleDiscount = value;
            const subscriptionCouponId = (_a = idOf(compatibleDiscount.coupon)) !== null && _a !== void 0 ? _a : idOf((_b = compatibleDiscount.source) === null || _b === void 0 ? void 0 : _b.coupon);
            const subscriptionPromotionCodeId = (_c = idOf(compatibleDiscount.promotion_code)) !== null && _c !== void 0 ? _c : idOf((_d = compatibleDiscount.source) === null || _d === void 0 ? void 0 : _d.promotion_code);
            return subscriptionCouponId === coupon.id &&
                subscriptionPromotionCodeId === null;
        });
        if (subscriptionDiscounts.length !== 1 || subscription.discounts.length !== 1) {
            throw new Error(`Subscription ${subscription.id} does not carry the approved family discount.`);
        }
        const [subscriptionDiscount] = subscriptionDiscounts;
        return {
            kind: "youth_family",
            couponId: coupon.id,
            promotionCodeId: null,
            amountOffPence: null,
            percentOff: frozenPercentOff,
            currency: null,
            duration: "forever",
            durationInMonths: null,
            startsAt: (_d = subscriptionDiscount.start) !== null && _d !== void 0 ? _d : completionUnixSeconds,
            endsAt: (_e = subscriptionDiscount.end) !== null && _e !== void 0 ? _e : null,
        };
    }
    if (!isPresaleIntent(intent) || intent.planKey !== membershipPlans_1.EXISTING_MEMBER_OFFER.planKey ||
        !intent.promotionCodeId) {
        throw new Error(`Checkout Session ${session.id} has an unapproved discount.`);
    }
    if (applied.length !== 1) {
        throw new Error(`Checkout Session ${session.id} has multiple discounts.`);
    }
    const configuredCouponId = stripeExistingMemberCouponId.value().trim();
    const configuredPromotionCodeId = stripeExistingMemberPromotionCodeId.value().trim();
    const couponId = idOf(applied[0].coupon);
    const promotionCodeId = idOf(applied[0].promotion_code);
    if (!configuredPromotionCodeId ||
        (couponId !== null && couponId !== configuredCouponId) ||
        promotionCodeId !== configuredPromotionCodeId ||
        promotionCodeId !== intent.promotionCodeId) {
        throw new Error(`Checkout Session ${session.id} used an unapproved promotion.`);
    }
    const billingStripe = stripe();
    const itemPrice = (_f = subscription.items.data[0]) === null || _f === void 0 ? void 0 : _f.price;
    let productId = itemPrice && typeof itemPrice !== "string" ?
        idOf(itemPrice.product) : null;
    if (!productId) {
        const price = await billingStripe.prices.retrieve(intent.stripePriceId);
        assertStripeObjectMode("Price", price.id, price.livemode);
        productId = idOf(price.product);
    }
    if (!productId) {
        throw new Error(`Subscription ${subscription.id} has no membership Product.`);
    }
    const [coupon, promotionCode] = await Promise.all([
        // Once Stripe has authoritatively applied the Coupon and Promotion Code to
        // both Session and Subscription, delayed webhook/recovery processing must
        // validate the frozen offer terms without pretending it is a new
        // redemption or requiring the code to remain active.
        retrieveApprovedExistingMemberCoupon(billingStripe, productId, false),
        billingStripe.promotionCodes.retrieve(promotionCodeId),
    ]);
    assertStripeObjectMode("Promotion Code", promotionCode.id, promotionCode.livemode);
    if (promotionCode.id !== configuredPromotionCodeId ||
        coupon.id !== configuredCouponId ||
        (couponId !== null && coupon.id !== couponId) ||
        !promotionCodeMatchesApprovedOffer(promotionCode, coupon.id) ||
        !promotionCodeRedemptionCountIsCredible(promotionCode)) {
        throw new Error(`Promotion Code ${promotionCode.id} is not the approved reusable campaign code.`);
    }
    const subscriptionDiscounts = ((_g = subscription.discounts) !== null && _g !== void 0 ? _g : []).filter((value) => {
        var _a, _b, _c, _d;
        if (typeof value === "string")
            return false;
        const compatibleDiscount = value;
        return ((_a = idOf(compatibleDiscount.coupon)) !== null && _a !== void 0 ? _a : idOf((_b = compatibleDiscount.source) === null || _b === void 0 ? void 0 : _b.coupon)) === coupon.id &&
            ((_c = idOf(compatibleDiscount.promotion_code)) !== null && _c !== void 0 ? _c : idOf((_d = compatibleDiscount.source) === null || _d === void 0 ? void 0 : _d.promotion_code)) === promotionCode.id;
    });
    if (subscriptionDiscounts.length !== 1 || subscription.discounts.length !== 1) {
        throw new Error(`Subscription ${subscription.id} does not carry the approved Checkout discount.`);
    }
    const [subscriptionDiscount] = subscriptionDiscounts;
    return {
        couponId: coupon.id,
        promotionCodeId: promotionCode.id,
        amountOffPence: membershipPlans_1.EXISTING_MEMBER_OFFER.amountOffPence,
        currency: "gbp",
        durationInMonths: membershipPlans_1.EXISTING_MEMBER_OFFER.durationMonths,
        startsAt: (_h = subscriptionDiscount === null || subscriptionDiscount === void 0 ? void 0 : subscriptionDiscount.start) !== null && _h !== void 0 ? _h : completionUnixSeconds,
        endsAt: (_j = subscriptionDiscount === null || subscriptionDiscount === void 0 ? void 0 : subscriptionDiscount.end) !== null && _j !== void 0 ? _j : null,
    };
}
/**
 * Identifies the one historical founding-presale shape that was persisted
 * without its already-applied existing-member discount. Keeping this exact
 * prevents a provider discount from silently changing any other legacy
 * contract.
 */
function hasRecoverableLegacyPresaleDiscountGap(membership) {
    const schedule = membership.paymentSchedule;
    const order = orderFor(membership);
    return membership.schemaVersion === 1 &&
        membership.planKey === membershipPlans_1.EXISTING_MEMBER_OFFER.planKey &&
        membership.state === "scheduled" &&
        membership.stripeStatus === "active" &&
        membership.billingMode === "presale_deferred" &&
        membership.billingCycleAnchor === membershipPlans_1.PRESALE_BILLING_ANCHOR_UNIX_SECONDS &&
        membership.firstPaymentAt === membershipPlans_1.PRESALE_BILLING_ANCHOR_UNIX_SECONDS &&
        membership.serviceStartsAt === membershipPlans_1.PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS &&
        participantCountFor(membership) === 1 &&
        membership.firstPaymentReceivedAt === null &&
        membership.firstPaidInvoiceId === null &&
        membership.discount == null &&
        (schedule === null || schedule === void 0 ? void 0 : schedule.amountDueTodayPence) === 0 &&
        (schedule === null || schedule === void 0 ? void 0 : schedule.firstPaymentAt) === membership.firstPaymentAt &&
        (schedule === null || schedule === void 0 ? void 0 : schedule.standardMonthlyPence) === (0, membershipPlans_1.getPlan)(membershipPlans_1.EXISTING_MEMBER_OFFER.planKey).amountPence &&
        order.standardMonthlyPence === schedule.standardMonthlyPence &&
        schedule.discountedMonthlyPence == null &&
        (schedule.discountedPaymentCount == null ||
            schedule.discountedPaymentCount === 0) &&
        schedule.fullPriceFrom == null;
}
/**
 * Recovers the missing schema-v1 schedule only from an exact, authoritative
 * Stripe contract. This deliberately repeats the Coupon/Promotion/Product
 * allowlist checks used at Checkout; observing a £55 invoice is never enough
 * by itself to approve or infer a discount.
 */
async function resolveLegacyPresaleDiscountRecovery(subscription, membership) {
    var _a, _b, _c, _d, _e, _f, _g;
    if (!hasRecoverableLegacyPresaleDiscountGap(membership))
        return null;
    const applied = (_a = subscription.discounts) !== null && _a !== void 0 ? _a : [];
    if (applied.length === 0)
        return null;
    if (applied.length !== 1 || typeof applied[0] === "string") {
        throw new Error(`Legacy membership ${membership.subscriptionId} does not carry one ` +
            "expanded approved discount.");
    }
    const configuredCouponId = stripeExistingMemberCouponId.value().trim();
    const configuredPromotionCodeId = stripeExistingMemberPromotionCodeId.value().trim();
    if (!configuredCouponId) {
        throw new Error(`Legacy membership ${membership.subscriptionId} cannot validate its discount allowlist.`);
    }
    const compatibleDiscount = applied[0];
    const couponId = (_b = idOf(compatibleDiscount.coupon)) !== null && _b !== void 0 ? _b : idOf((_c = compatibleDiscount.source) === null || _c === void 0 ? void 0 : _c.coupon);
    const promotionCodeId = (_d = idOf(compatibleDiscount.promotion_code)) !== null && _d !== void 0 ? _d : idOf((_e = compatibleDiscount.source) === null || _e === void 0 ? void 0 : _e.promotion_code);
    const directApprovedCoupon = couponId === configuredCouponId &&
        promotionCodeId === null;
    const approvedPromotion = couponId === configuredCouponId &&
        Boolean(configuredPromotionCodeId) &&
        promotionCodeId === configuredPromotionCodeId;
    const fullPriceFrom = addUtcMonths(membership.firstPaymentAt, membershipPlans_1.EXISTING_MEMBER_OFFER.durationMonths);
    const finalDiscountedPaymentAt = addUtcMonths(membership.firstPaymentAt, membershipPlans_1.EXISTING_MEMBER_OFFER.durationMonths - 1);
    if (couponId !== configuredCouponId ||
        (!directApprovedCoupon && !approvedPromotion) ||
        idOf(compatibleDiscount.subscription) !== subscription.id ||
        compatibleDiscount.subscription_item != null ||
        !Number.isSafeInteger(compatibleDiscount.start) ||
        !Number.isSafeInteger(compatibleDiscount.end) ||
        compatibleDiscount.start > membership.firstPaymentAt ||
        compatibleDiscount.end <= finalDiscountedPaymentAt ||
        compatibleDiscount.end > fullPriceFrom) {
        throw new Error(`Legacy membership ${membership.subscriptionId} carries an unapproved discount.`);
    }
    const billingStripe = stripe();
    const itemPrice = (_f = subscription.items.data[0]) === null || _f === void 0 ? void 0 : _f.price;
    let productId = itemPrice && typeof itemPrice !== "string" ?
        idOf(itemPrice.product) : null;
    if (!productId) {
        const price = await billingStripe.prices.retrieve(membership.stripePriceId);
        assertStripeObjectMode("Price", price.id, price.livemode);
        productId = idOf(price.product);
    }
    if (!productId) {
        throw new Error(`Legacy membership ${membership.subscriptionId} has no membership Product.`);
    }
    const coupon = await retrieveApprovedExistingMemberCoupon(billingStripe, productId, false);
    let promotionCode = null;
    if (approvedPromotion) {
        promotionCode = await billingStripe.promotionCodes.retrieve(configuredPromotionCodeId);
        assertStripeObjectMode("Promotion Code", promotionCode.id, promotionCode.livemode);
    }
    if (coupon.id !== configuredCouponId ||
        (promotionCode && (promotionCode.id !== configuredPromotionCodeId ||
            !promotionCodeMatchesApprovedOffer(promotionCode, coupon.id) ||
            !promotionCodeRedemptionCountIsCredible(promotionCode)))) {
        throw new Error(`Legacy membership ${membership.subscriptionId} does not carry the ` +
            "approved existing-member offer.");
    }
    const standardMonthlyPence = membership.paymentSchedule.standardMonthlyPence;
    const discountedMonthlyPence = Math.max(0, standardMonthlyPence - membershipPlans_1.EXISTING_MEMBER_OFFER.amountOffPence);
    const discount = {
        couponId: coupon.id,
        promotionCodeId: (_g = promotionCode === null || promotionCode === void 0 ? void 0 : promotionCode.id) !== null && _g !== void 0 ? _g : null,
        amountOffPence: membershipPlans_1.EXISTING_MEMBER_OFFER.amountOffPence,
        currency: "gbp",
        durationInMonths: membershipPlans_1.EXISTING_MEMBER_OFFER.durationMonths,
        startsAt: compatibleDiscount.start,
        endsAt: compatibleDiscount.end,
    };
    return {
        discount,
        paymentSchedule: {
            amountDueTodayPence: 0,
            firstPaymentAt: membership.firstPaymentAt,
            standardMonthlyPence,
            discountedMonthlyPence,
            discountedPaymentCount: membershipPlans_1.EXISTING_MEMBER_OFFER.durationMonths,
            fullPriceFrom,
        },
    };
}
/** Keeps stored customer-facing dates aligned with an earlier Stripe schedule. */
function alignCancellationOutcome(proposed, effectiveCancelAt) {
    if (effectiveCancelAt === proposed.cancelAtUnixSeconds)
        return proposed;
    const accessEndsOnDate = (0, membershipPlans_1.formatUnixBillingIsoDate)(Math.max(0, effectiveCancelAt - 1));
    return Object.assign(Object.assign({}, proposed), { cancelAtUnixSeconds: effectiveCancelAt, 
        // An earlier provider schedule does not necessarily remove the next
        // payment. If access crosses the next billing day, that payment remains
        // part of the frozen customer-facing outcome.
        finalPaymentDate: accessEndsOnDate >= proposed.nextBillingDate ?
            proposed.nextBillingDate : null, accessEndsOnDate });
}
/** Future cancel_at, or the actual ended_at once Stripe has canceled it. */
function authoritativeSubscriptionCancellationEnd(subscription) {
    var _a, _b, _c;
    if (subscription.status === "canceled") {
        return (_b = (_a = subscription.ended_at) !== null && _a !== void 0 ? _a : subscription.cancel_at) !== null && _b !== void 0 ? _b : null;
    }
    return (_c = subscription.cancel_at) !== null && _c !== void 0 ? _c : null;
}
/** ---------------------------------------------------------------
 * Input validation
 * -------------------------------------------------------------- */
function requireAuthUid(request) {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Login required.");
    return request.auth.uid;
}
/** Uid when the caller happens to be signed in, null for a public visitor. */
function optionalAuthUid(request) {
    return request.auth ? request.auth.uid : null;
}
function requireBoundedString(value, field, min, max) {
    const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
    if (text.length < min || text.length > max) {
        throw new https_1.HttpsError("invalid-argument", `${field} must be between ${min} and ${max} characters.`);
    }
    return text;
}
const UNSAFE_PERSON_NAME_CHARACTER = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u;
/**
 * Names become durable contract and identity data. Reject characters that can
 * be invisible, reorder text, or disappear between clients before normalising
 * ordinary spacing. The identity normaliser below still strips them as a
 * defence for historical stored rows that predate this input boundary.
 */
function requirePersonName(value, field) {
    const raw = typeof value === "string" ? value : "";
    if (UNSAFE_PERSON_NAME_CHARACTER.test(raw) ||
        UNSAFE_PERSON_NAME_CHARACTER.test(raw.normalize("NFKC"))) {
        throw new https_1.HttpsError("invalid-argument", `${field} contains unsupported invisible or control characters.`);
    }
    return requireBoundedString(raw, field, 2, 160);
}
function normalizePromotionCode(value) {
    if (value === undefined || value === null || value === "")
        return null;
    if (typeof value !== "string") {
        throw new https_1.HttpsError("invalid-argument", "promotionCode must be text.");
    }
    const normalized = value.normalize("NFKC").trim().toUpperCase();
    const hasControlCharacter = [...normalized].some((character) => {
        const code = character.charCodeAt(0);
        return code <= 31 || code === 127;
    });
    if (!normalized || normalized.length > 64 || hasControlCharacter) {
        throw new https_1.HttpsError("invalid-argument", "Enter a valid promotion code.");
    }
    return normalized;
}
function optionalBoundedText(value, min, max) {
    if (typeof value !== "string")
        return null;
    const text = value.trim();
    return text.length >= min && text.length <= max ? text : null;
}
function requirePlanKey(value) {
    if (!(0, membershipPlans_1.isPlanKey)(value)) {
        throw new https_1.HttpsError("invalid-argument", "Unknown membership plan.");
    }
    return value;
}
function rejectLegacySelectedConditioningSlots(value) {
    if (value !== undefined && value !== null &&
        (!Array.isArray(value) || value.length > 0)) {
        throw new https_1.HttpsError("invalid-argument", "Fixed Conditioning slots are no longer selected at checkout. Refresh and review the flexible weekly booking terms.", { reason: "conditioning_slots_no_longer_supported" });
    }
}
function normalizeParticipantIdentityName(fullName) {
    return fullName.normalize("NFKC")
        .replace(/\p{Default_Ignorable_Code_Point}/gu, "")
        .replace(/\s+/gu, " ")
        .replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu, "")
        .trim()
        .toLocaleLowerCase("en-GB");
}
function participantKeyFor(fullName, dateOfBirth) {
    return (0, crypto_1.createHash)("sha256")
        .update(`${normalizeParticipantIdentityName(fullName)}|${dateOfBirth}`)
        .digest("hex");
}
function sha256(value) {
    return (0, crypto_1.createHash)("sha256").update(value).digest("hex");
}
/**
 * The client keeps this opaque attempt id stable while retrying one checkout.
 * It is intentionally stricter than a general string because it also feeds a
 * Stripe idempotency key. The hash, rather than the raw value, is persisted.
 */
function requireCheckoutAttemptId(value) {
    const attemptId = typeof value === "string" ? value.trim() : "";
    if (attemptId.length < 8 || attemptId.length > 255 ||
        !/^[A-Za-z0-9._:-]+$/.test(attemptId)) {
        throw new https_1.HttpsError("invalid-argument", "checkoutAttemptId must be an 8–255 character opaque identifier.");
    }
    return attemptId;
}
/** Prevents a stable attempt id being replayed with materially different data. */
function checkoutRequestFingerprint(input) {
    var _a;
    const participants = ((_a = input.participants) === null || _a === void 0 ? void 0 : _a.length) ?
        input.participants : [input.participant];
    return sha256(JSON.stringify({
        schemaVersion: exports.MEMBERSHIP_CHECKOUT_SCHEMA_VERSION,
        payerUid: input.payerUid,
        planKey: input.planKey,
        expectedBillingMode: input.expectedBillingMode,
        promotionCode: input.promotionCode,
        participants: participants.map((participant) => ({
            fullName: participant.fullName,
            dateOfBirth: participant.dateOfBirth,
            isPayer: participant.isPayer,
            participantKey: participant.participantKey,
        })),
        guardian: input.guardian,
        signedName: input.signedName,
        commercialTerms: input.commercialTerms,
        acceptances: input.acceptances,
    }));
}
/**
 * The browser submits ids only. The server independently resolves the exact
 * plan/role set and rejects missing, duplicate, unknown or extra ids before it
 * stores the canonical statements and immutable document contents.
 */
function requireExactCheckoutAcceptanceIds(value, expected) {
    if (!Array.isArray(value) || value.some((id) => typeof id !== "string")) {
        throw new https_1.HttpsError("invalid-argument", "Each required checkout statement must be accepted separately.");
    }
    const submitted = value;
    const expectedIds = expected.map(({ id }) => id);
    const submittedSet = new Set(submitted);
    const exact = submittedSet.size === submitted.length &&
        submittedSet.size === expectedIds.length &&
        expectedIds.every((id) => submittedSet.has(id));
    if (!exact) {
        throw new https_1.HttpsError("failed-precondition", "Review and accept every required checkout statement separately.");
    }
    return [...expectedIds];
}
/**
 * Stripe does not cache validation failures under an idempotency key because
 * request execution never began. A validation response therefore proves that
 * no Checkout Session was created for this attempt; connection/5xx failures
 * remain ambiguous and deliberately keep their uniqueness locks.
 */
function isDefinitiveCheckoutCreateFailure(error) {
    if (!error || typeof error !== "object")
        return false;
    const candidate = error;
    return candidate.type === "StripeInvalidRequestError" ||
        candidate.rawType === "invalid_request_error" ||
        candidate.type === "StripeAuthenticationError" ||
        candidate.rawType === "authentication_error" ||
        candidate.type === "StripePermissionError";
}
/**
 * Only the approved public origin is accepted for Stripe return URLs. An
 * attacker-supplied origin would otherwise turn checkout completion into an
 * open redirect carrying a session id.
 */
function resolveReturnOrigin() {
    const configured = appPublicOrigin.value().trim();
    try {
        return new URL(configured).origin;
    }
    catch (_a) {
        throw new https_1.HttpsError("failed-precondition", "The public app origin is misconfigured.");
    }
}
/**
 * Price IDs verified directly against the Stripe sandbox on 18 August 2026.
 * Products, prices, portal configurations and webhook secrets are all
 * mode-specific, so these can never be correct in live mode.
 */
const KNOWN_TEST_PRICE_IDS = new Set([
    "price_1U5PS5FzNDZoGGA0rPLiyQ2Q",
    "price_1UA47fFzNDZoGGA0lgyZPUZ9",
    "price_1U5PKZFzNDZoGGA0xsnNcV2m",
    "price_1U5PJHFzNDZoGGA0izMSvHP1",
    "price_1U5PFZFzNDZoGGA06T2ggw4M",
    "price_1U7akwFzNDZoGGA0zOcCZthI",
    "price_1U5PEwFzNDZoGGA0d24UJaZd",
]);
function resolvePriceId(planKey) {
    const priceId = priceParams[planKey].value().trim();
    if (!priceId) {
        throw new https_1.HttpsError("failed-precondition", `No Stripe price is configured for ${planKey}.`);
    }
    // Stripe would reject this anyway, but only once a real customer was part
    // way through checkout. Failing here makes the misconfiguration obvious
    // before anyone is asked to pay.
    const stripeMode = assertBillingEnvironment().stripeMode;
    if (stripeMode === "live" && KNOWN_TEST_PRICE_IDS.has(priceId)) {
        throw new https_1.HttpsError("failed-precondition", `${planKey} is still pointing at a Stripe test-mode price. Create the live ` +
            "catalogue and set the live price IDs before taking payments.");
    }
    if (stripeMode === "live" &&
        priceId !== stripeLiveCatalog_1.APPROVED_LIVE_STRIPE_CATALOGUE[planKey].priceId) {
        throw new https_1.HttpsError("failed-precondition", `${planKey} is not pointing at the approved live Stripe Price.`);
    }
    return priceId;
}
/** Refuses a swapped, inactive, wrongly priced, or wrongly named Stripe Price. */
async function assertStripePriceMatchesPlan(client, priceId, plan) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    let price;
    try {
        price = await client.prices.retrieve(priceId, { expand: ["product"] });
    }
    catch (error) {
        console.error("Stripe membership price preflight failed", { planKey: plan.key, error });
        if (isDefinitiveCheckoutCreateFailure(error)) {
            throw new https_1.HttpsError("failed-precondition", `The billing price for ${plan.name} is not available. Contact support before paying.`);
        }
        // A transient provider outage must preserve the browser's stable attempt
        // id. It may be the only way to recover a Session accepted immediately
        // before a process/network failure.
        throw new https_1.HttpsError("unavailable", "Stripe is temporarily unavailable. Retry this same checkout attempt.");
    }
    const product = typeof price.product === "object" && price.product &&
        !("deleted" in price.product) ? price.product : null;
    const stripeMode = assertBillingEnvironment().stripeMode;
    const approvedLive = stripeMode === "live" ?
        stripeLiveCatalog_1.APPROVED_LIVE_STRIPE_CATALOGUE[plan.key] : null;
    assertStripeObjectMode("Price", price.id, price.livemode);
    if (product) {
        assertStripeObjectMode("Product", product.id, product.livemode);
    }
    const valid = price.active === true &&
        price.currency.toLowerCase() === plan.currency &&
        price.unit_amount === plan.amountPence &&
        price.type === "recurring" &&
        ((_a = price.recurring) === null || _a === void 0 ? void 0 : _a.interval) === "month" &&
        price.recurring.interval_count === 1 &&
        (product === null || product === void 0 ? void 0 : product.active) === true &&
        product.name === ((_b = approvedLive === null || approvedLive === void 0 ? void 0 : approvedLive.productName) !== null && _b !== void 0 ? _b : plan.name) &&
        (!approvedLive || (0, stripeLiveCatalog_1.matchesApprovedLiveStripeCatalogueEntry)(price, product, approvedLive));
    if (!valid) {
        console.error("CRITICAL_BILLING_PRICE_MISMATCH", {
            planKey: plan.key,
            priceId,
            active: price.active,
            livemode: price.livemode,
            currency: price.currency,
            unitAmount: price.unit_amount,
            type: price.type,
            interval: (_c = price.recurring) === null || _c === void 0 ? void 0 : _c.interval,
            intervalCount: (_d = price.recurring) === null || _d === void 0 ? void 0 : _d.interval_count,
            productName: (_e = product === null || product === void 0 ? void 0 : product.name) !== null && _e !== void 0 ? _e : null,
            productActive: (_f = product === null || product === void 0 ? void 0 : product.active) !== null && _f !== void 0 ? _f : null,
            expectedLiveProductId: (_g = approvedLive === null || approvedLive === void 0 ? void 0 : approvedLive.productId) !== null && _g !== void 0 ? _g : null,
            expectedLiveProductName: (_h = approvedLive === null || approvedLive === void 0 ? void 0 : approvedLive.productName) !== null && _h !== void 0 ? _h : null,
        });
        throw new https_1.HttpsError("failed-precondition", `The billing price for ${plan.name} does not match the approved catalogue.`);
    }
    return product.id;
}
/** Prevents an operator-selected portal configuration bypassing cancellation policy. */
async function assertPortalConfigurationIsLockedDown(client, configurationId) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    let configuration;
    try {
        configuration = await client.billingPortal.configurations.retrieve(configurationId);
    }
    catch (error) {
        console.error("Stripe portal configuration preflight failed", {
            configurationId,
            error,
        });
        if (isDefinitiveCheckoutCreateFailure(error)) {
            throw new https_1.HttpsError("failed-precondition", "The billing portal is not configured.");
        }
        throw new https_1.HttpsError("unavailable", "The billing portal is temporarily unavailable.");
    }
    assertStripeObjectMode("Customer Portal configuration", configuration.id, configuration.livemode);
    const subscriptionPauseEnabled = (_a = configuration.features.subscription_pause) === null || _a === void 0 ? void 0 : _a.enabled;
    if (configuration.active !== true ||
        ((_b = configuration.login_page) === null || _b === void 0 ? void 0 : _b.enabled) !== false ||
        ((_c = configuration.features.customer_update) === null || _c === void 0 ? void 0 : _c.enabled) !== false ||
        ((_d = configuration.features.invoice_history) === null || _d === void 0 ? void 0 : _d.enabled) !== true ||
        ((_e = configuration.features.payment_method_update) === null || _e === void 0 ? void 0 : _e.enabled) !== true ||
        configuration.features.subscription_cancel.enabled !== false ||
        configuration.features.subscription_update.enabled !== false ||
        subscriptionPauseEnabled === true) {
        console.error("CRITICAL_BILLING_PORTAL_CONFIGURATION_MISMATCH", {
            configurationId,
            active: configuration.active,
            hostedLoginEnabled: (_f = configuration.login_page) === null || _f === void 0 ? void 0 : _f.enabled,
            customerUpdateEnabled: (_g = configuration.features.customer_update) === null || _g === void 0 ? void 0 : _g.enabled,
            invoiceHistoryEnabled: (_h = configuration.features.invoice_history) === null || _h === void 0 ? void 0 : _h.enabled,
            paymentMethodUpdateEnabled: (_j = configuration.features.payment_method_update) === null || _j === void 0 ? void 0 : _j.enabled,
            subscriptionCancellationEnabled: configuration.features.subscription_cancel.enabled,
            subscriptionUpdateEnabled: configuration.features.subscription_update.enabled,
            subscriptionPauseEnabled: subscriptionPauseEnabled !== null && subscriptionPauseEnabled !== void 0 ? subscriptionPauseEnabled : null,
        });
        throw new https_1.HttpsError("failed-precondition", "The billing portal is unavailable because its configuration is unsafe.");
    }
}
/** Fail closed if a future gate flip leaves draft or internally inconsistent legal copy. */
function assertCheckoutDocumentModel(publicationReadyRequired) {
    if (publicationReadyRequired) {
        const companyPublicationFields = {
            legalName: membershipPlans_1.COMPANY.legalName,
            tradingName: membershipPlans_1.COMPANY.tradingName,
            companyNumber: membershipPlans_1.COMPANY.companyNumber,
            address: membershipPlans_1.COMPANY.address,
            registeredOffice: membershipPlans_1.COMPANY.registeredOffice,
            registrationJurisdiction: membershipPlans_1.COMPANY.registrationJurisdiction,
            supportEmail: membershipPlans_1.COMPANY.supportEmail,
            confirmationSender: membershipPlans_1.COMPANY.confirmationSender,
        };
        if (Object.values(companyPublicationFields).some((value) => !value.trim()) ||
            /\b(?:PENDING|DRAFT)\b/i.test(JSON.stringify(companyPublicationFields))) {
            throw new https_1.HttpsError("failed-precondition", "Company disclosures are not ready for publication.");
        }
        const aggregateDocumentBytes = Object.values(membershipPlans_1.CHECKOUT_DOCUMENTS).reduce((total, document) => total + Buffer.byteLength(document.content, "utf8"), 0);
        if (aggregateDocumentBytes > membershipPlans_1.CHECKOUT_DOCUMENT_CONTENT_BUDGET_BYTES) {
            throw new https_1.HttpsError("failed-precondition", "Checkout documents exceed the safe publication byte budget.");
        }
    }
    const exactRequirements = {
        adult_unlimited: {
            documents: ["membershipTerms", "cancellationPolicy", "privacyNotice", "adultWaiver"],
            statements: [
                "membership_contract", "privacy_notice", "adult_participant_waiver",
                "recurring_payment_authority", "immediate_performance",
            ],
            signerRole: "adult_participant_and_payer",
        },
        adult_conditioning: {
            documents: [
                "membershipTerms", "cancellationPolicy", "adultConditioningAddendum",
                "privacyNotice", "adultWaiver",
            ],
            statements: [
                "membership_contract", "privacy_notice", "adult_participant_waiver",
                "recurring_payment_authority", "immediate_performance",
            ],
            signerRole: "adult_participant_and_payer",
        },
        adult_ladies: {
            documents: ["membershipTerms", "cancellationPolicy", "privacyNotice", "adultWaiver"],
            statements: [
                "membership_contract", "privacy_notice", "adult_participant_waiver",
                "recurring_payment_authority", "immediate_performance",
            ],
            signerRole: "adult_participant_and_payer",
        },
        adult_gym: {
            documents: ["membershipTerms", "cancellationPolicy", "privacyNotice", "adultWaiver"],
            statements: [
                "membership_contract", "privacy_notice", "adult_participant_waiver",
                "recurring_payment_authority", "immediate_performance",
            ],
            signerRole: "adult_participant_and_payer",
        },
        youth_youngstars: {
            documents: ["membershipTerms", "cancellationPolicy", "privacyNotice", "guardianAddendum"],
            statements: [
                "membership_contract", "privacy_notice", "guardian_authority",
                "guardian_youth_addendum", "recurring_payment_authority", "immediate_performance",
            ],
            signerRole: "youth_guardian_and_payer",
        },
        youth_teenstars: {
            documents: ["membershipTerms", "cancellationPolicy", "privacyNotice", "guardianAddendum"],
            statements: [
                "membership_contract", "privacy_notice", "guardian_authority",
                "guardian_youth_addendum", "recurring_payment_authority", "immediate_performance",
            ],
            signerRole: "youth_guardian_and_payer",
        },
    };
    for (const planKey of membershipPlans_1.PLAN_KEYS) {
        const documents = (0, membershipPlans_1.resolveCheckoutDocuments)(planKey);
        const statements = (0, membershipPlans_1.resolveCheckoutAcceptanceStatements)(planKey);
        const requirement = exactRequirements[planKey];
        const documentKeys = documents.map(({ key }) => key);
        const statementIds = statements.map(({ id }) => id);
        if (JSON.stringify(documentKeys) !== JSON.stringify(requirement.documents) ||
            JSON.stringify(statementIds) !== JSON.stringify(requirement.statements) ||
            (0, membershipPlans_1.resolveCheckoutSignerRole)(planKey) !== requirement.signerRole ||
            new Set(documentKeys).size !== documentKeys.length ||
            new Set(statementIds).size !== statementIds.length) {
            throw new https_1.HttpsError("failed-precondition", `Checkout legal requirements are invalid for ${planKey}.`);
        }
        const availableKeys = new Set(documentKeys);
        if (statements.some((statement) => !statement.statement.trim() ||
            new Set(statement.documentKeys).size !== statement.documentKeys.length ||
            statement.documentKeys.some((key) => !availableKeys.has(key)))) {
            throw new https_1.HttpsError("failed-precondition", `A checkout statement is incomplete or references an unavailable document for ${planKey}.`);
        }
        if (!publicationReadyRequired)
            continue;
        for (const document of documents) {
            const serialized = JSON.stringify(document);
            const immutableUrl = (() => {
                try {
                    const parsed = new URL(document.publicUrl, "https://same-origin.invalid");
                    const sameOriginPath = document.publicUrl.startsWith("/") &&
                        parsed.origin === "https://same-origin.invalid";
                    const absoluteHttps = /^https:\/\//.test(document.publicUrl);
                    return (sameOriginPath || absoluteHttps) &&
                        !parsed.search && !parsed.hash && parsed.pathname.includes(document.version);
                }
                catch (_a) {
                    return false;
                }
            })();
            const effectiveDate = document.effectiveDate.trim();
            const parsedEffectiveDate = new Date(`${effectiveDate}T00:00:00.000Z`);
            const validEffectiveDate = /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) &&
                Number.isFinite(parsedEffectiveDate.getTime()) &&
                parsedEffectiveDate.toISOString().slice(0, 10) === effectiveDate;
            if (/\b(?:PENDING|DRAFT)\b/i.test(serialized) ||
                document.contentType !== "text/plain; charset=utf-8" ||
                document.hashCovers !== "UTF-8 bytes of content" ||
                !document.title.trim() ||
                !/^[A-Za-z0-9][A-Za-z0-9._-]{2,159}$/.test(document.version) ||
                !validEffectiveDate ||
                !document.content.trim() ||
                !/^[a-f0-9]{64}$/.test(document.sha256) ||
                sha256(document.content) !== document.sha256 ||
                !immutableUrl) {
                throw new https_1.HttpsError("failed-precondition", `Checkout document ${document.key} is not ready for publication.`);
            }
        }
    }
}
/**
 * The purchase flow stays closed until the checkout documents are approved for
 * publication *and* the deployment explicitly enables purchasing. Both gates
 * are required: approved source content alone must never open a deployment,
 * and an unapproved future version must never reach a paying customer.
 */
function requirePurchaseFlowOpen() {
    const testJourneyRequested = membershipTestJourneyEnabled.value().trim().toLowerCase() === "true";
    if (!membershipPlans_1.CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION && !testJourneyRequested) {
        throw new https_1.HttpsError("failed-precondition", "Membership purchase is not open yet: the checkout documents are not approved for publication.");
    }
    if (!membershipPlans_1.CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION) {
        const environment = assertBillingEnvironment();
        const origin = resolveReturnOrigin();
        if (environment.stripeMode !== "test" ||
            environment.projectId === PRODUCTION_FIREBASE_PROJECT_ID ||
            !hasLoopbackFirebaseEmulatorDataPlane() ||
            !LOCAL_TEST_JOURNEY_ORIGINS.has(origin)) {
            throw new https_1.HttpsError("failed-precondition", "The unpublished checkout can run only in the isolated local Stripe test journey.");
        }
    }
    assertCheckoutDocumentModel(membershipPlans_1.CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION);
    if (membershipPurchaseEnabled.value().trim().toLowerCase() !== "true") {
        throw new https_1.HttpsError("failed-precondition", "Membership purchase is not enabled for this environment.");
    }
    assertBillingEnvironment();
}
/**
 * Adult Conditioning has a separate launch boundary because the currently
 * published membership bundle predates this plan and describes Unlimited as
 * the only app-access membership. A local test journey may exercise the
 * contract before publication, but a deployed/live runtime cannot.
 */
function requirePlanPurchaseFlowOpen(planKey) {
    if (planKey !== "adult_conditioning")
        return;
    if (adultConditioningPurchaseEnabled.value().trim().toLowerCase() !== "true") {
        throw new https_1.HttpsError("failed-precondition", "Adult Conditioning membership is not available for purchase yet.", { reason: "adult_conditioning_purchase_unavailable" });
    }
    if (adultConditioningLegalApproved.value().trim().toLowerCase() === "true") {
        return;
    }
    const testJourneyRequested = membershipTestJourneyEnabled.value().trim().toLowerCase() === "true";
    const environment = assertBillingEnvironment();
    const origin = resolveReturnOrigin();
    const isolatedTestJourney = testJourneyRequested &&
        environment.stripeMode === "test" &&
        environment.projectId !== PRODUCTION_FIREBASE_PROJECT_ID &&
        hasLoopbackFirebaseEmulatorDataPlane() &&
        LOCAL_TEST_JOURNEY_ORIGINS.has(origin);
    if (!isolatedTestJourney) {
        throw new https_1.HttpsError("failed-precondition", "Adult Conditioning checkout is awaiting approved and published membership terms.", { reason: "adult_conditioning_legal_not_approved" });
    }
}
/** ---------------------------------------------------------------
 * Customer and membership lookup
 * -------------------------------------------------------------- */
async function resolveStripeCustomerId(userId) {
    var _a;
    const userRef = db().collection("users").doc(userId);
    const snap = await userRef.get();
    if (!snap.exists) {
        throw new https_1.HttpsError("failed-precondition", "Create your profile before purchasing.");
    }
    const existing = snap.get("stripeCustomerId");
    if (typeof existing === "string" && existing)
        return existing;
    const authUser = await admin.auth().getUser(userId);
    const customer = await stripe().customers.create({
        email: ((_a = authUser.email) === null || _a === void 0 ? void 0 : _a.trim().toLowerCase()) || undefined,
        name: snap.get("name") || authUser.displayName || undefined,
        metadata: { firebaseUid: userId },
    }, 
    // Retrying a create with the same key returns the original customer rather
    // than duplicating one if this call is replayed.
    { idempotencyKey: `customer:${userId}` });
    assertStripeObjectMode("Customer", customer.id, customer.livemode);
    await userRef.set({ stripeCustomerId: customer.id, updatedAt: serverTimestamp() }, { merge: true });
    return customer.id;
}
/** ---------------------------------------------------------------
 * Atomic checkout reservations
 * -------------------------------------------------------------- */
const CHECKOUT_LOCK_COLLECTION = "membershipCheckoutLocks";
const ENTITLEMENT_OWNER_COLLECTION = "membershipEntitlementOwners";
const CHECKOUT_SETTLEMENT_GRACE_SECONDS = 60 * 60;
const ASYNC_PAYMENT_RESERVATION_MS = 7 * 24 * 60 * 60 * 1000;
const CHECKOUT_MANUAL_RELEASE_MIN_AGE_MS = 10 * 60 * 1000;
function membershipExistsError() {
    return new https_1.HttpsError("already-exists", membershipPlans_1.POLICY_TEXT.duplicateBlocked, { reason: "membership_exists" });
}
function checkoutInProgressError() {
    return new https_1.HttpsError("already-exists", "A checkout or membership setup is already in progress for these details. Wait before trying again or contact support.", { reason: "checkout_in_progress" });
}
/**
 * A purchase can be anonymous, so participant identity is always locked. A
 * signed-in payer also gets a second deterministic lock when the selected plan
 * grants AlphaWOD access. Hashes keep UIDs and participant details out of doc
 * paths while ensuring concurrent transactions contend on the same documents.
 */
function checkoutLockSpecs(payerUid, planKey, participantKeys) {
    const keys = [...new Set(typeof participantKeys === "string" ?
            [participantKeys] : participantKeys)];
    const specs = keys.map((participantKey) => ({
        id: `participant_${participantKey}`,
        kind: "participant",
        identityHash: participantKey,
    }));
    if (payerUid && (0, membershipPlans_1.getPlan)(planKey).grantsAlphaWodAccess) {
        const payerHash = sha256(payerUid);
        specs.push({
            id: `alpha_wod_payer_${payerHash}`,
            kind: "alpha_wod_payer",
            identityHash: payerHash,
        });
    }
    return specs;
}
function timestampMillis(value) {
    return value instanceof firestore_1.Timestamp ? value.toMillis() : null;
}
function isBlockingMembershipDoc(doc) {
    if ((0, membershipPlans_1.isMembershipStateBlockingDuplicate)(doc.get("state"))) {
        return true;
    }
    const stripeStatus = doc.get("stripeStatus");
    // Revocation describes access, not whether Stripe has stopped billing. A
    // refunded/disputed membership can remain provider-active, so it must block
    // a replacement sale until Stripe is authoritatively terminal. Unknown
    // provider state also fails closed for legacy/malformed rows.
    return typeof stripeStatus !== "string" ||
        (stripeStatus !== "canceled" && stripeStatus !== "incomplete_expired");
}
function entitlementOwnerRef(userId) {
    return db().collection(ENTITLEMENT_OWNER_COLLECTION).doc(sha256(userId));
}
function alphaWodPayerCheckoutLockRef(userId) {
    return db().collection(CHECKOUT_LOCK_COLLECTION)
        .doc(`alpha_wod_payer_${sha256(userId)}`);
}
async function hasBlockingPayerCheckoutReservation(tx, userId) {
    const lock = await tx.get(alphaWodPayerCheckoutLockRef(userId));
    if (!lock.exists)
        return false;
    const intentId = lock.get("intentId");
    if (typeof intentId !== "string")
        return true;
    const intent = await tx.get(db().collection("membershipIntents").doc(intentId));
    if (!intent.exists)
        return true;
    const status = intent.get("status");
    return status !== "expired" && status !== "failed";
}
const MEMBERSHIP_BOOKING_INELIGIBLE_REASON = "stripe_membership_booking_ineligible";
/**
 * Resolves the access stop the member has already accepted, even while Stripe
 * convergence is still pending or under manual review. Provider state must
 * never extend that frozen promise. Malformed accepted evidence fails closed.
 */
function acceptedCancellationBoundary(membership) {
    const raw = membership
        .cancellationRequest;
    if (raw === undefined || raw === null) {
        return { present: false, valid: true, accessEndsAtMillis: null };
    }
    if (typeof raw !== "object") {
        return { present: true, valid: false, accessEndsAtMillis: null };
    }
    const request = raw;
    if (typeof request.id !== "string" || !request.id ||
        !(request.receivedAt instanceof firestore_1.Timestamp) ||
        (request.status !== "pending" && request.status !== "applied" &&
            request.status !== "manual_review")) {
        return { present: true, valid: false, accessEndsAtMillis: null };
    }
    if (request.kind === "cooling_off") {
        const accessEndsAtMillis = request.accessEndsAtMillis;
        if (!Number.isSafeInteger(accessEndsAtMillis) ||
            Number(accessEndsAtMillis) <= 0) {
            return { present: true, valid: false, accessEndsAtMillis: null };
        }
        return {
            present: true,
            valid: true,
            accessEndsAtMillis: Number(accessEndsAtMillis),
        };
    }
    if (request.kind !== undefined && request.kind !== "contractual" &&
        request.kind !== "presale_withdrawal") {
        return { present: true, valid: false, accessEndsAtMillis: null };
    }
    const outcome = request.outcome;
    if (!outcome || typeof outcome !== "object") {
        return { present: true, valid: false, accessEndsAtMillis: null };
    }
    const cancelAtUnixSeconds = outcome
        .cancelAtUnixSeconds;
    if (!Number.isSafeInteger(cancelAtUnixSeconds) ||
        Number(cancelAtUnixSeconds) <= 0) {
        return { present: true, valid: false, accessEndsAtMillis: null };
    }
    const accessEndsAtMillis = Number(cancelAtUnixSeconds) * 1000;
    if (!Number.isSafeInteger(accessEndsAtMillis)) {
        return { present: true, valid: false, accessEndsAtMillis: null };
    }
    return { present: true, valid: true, accessEndsAtMillis };
}
function authoritativeMembershipAccessEnd(membership) {
    const cancelAt = membership.cancelAt;
    if (cancelAt !== null &&
        (!Number.isSafeInteger(cancelAt) || cancelAt <= 0)) {
        return { valid: false, accessEndsAtMillis: null };
    }
    const providerCancelAtMillis = cancelAt === null ? null : cancelAt * 1000;
    if (providerCancelAtMillis !== null &&
        !Number.isSafeInteger(providerCancelAtMillis)) {
        return { valid: false, accessEndsAtMillis: null };
    }
    const acceptedCancellation = acceptedCancellationBoundary(membership);
    if (!acceptedCancellation.valid) {
        return { valid: false, accessEndsAtMillis: null };
    }
    const candidates = [
        providerCancelAtMillis,
        acceptedCancellation.accessEndsAtMillis,
    ].filter((value) => value !== null);
    return {
        valid: true,
        accessEndsAtMillis: candidates.length > 0 ? Math.min(...candidates) : null,
    };
}
function membershipBookingBoundary(membership) {
    const entitled = (0, membershipPlans_1.isMembershipStateEntitled)(membership.state) &&
        membership.grantsAlphaWodAccess === true &&
        membership.providerContractStatus === "verified";
    if (!entitled) {
        return {
            entitled: false,
            valid: true,
            cancelAtMillis: null,
            graceEndsAtMillis: null,
        };
    }
    const accessEnd = authoritativeMembershipAccessEnd(membership);
    if (!accessEnd.valid) {
        return {
            entitled: true,
            valid: false,
            cancelAtMillis: null,
            graceEndsAtMillis: null,
        };
    }
    const cancelAtMillis = accessEnd.accessEndsAtMillis;
    if (membership.state !== "past_due_grace") {
        return {
            entitled: true,
            valid: true,
            cancelAtMillis,
            graceEndsAtMillis: null,
        };
    }
    const graceEndsAtMillis = timestampMillis(membership.pastDueGraceEndsAt);
    if (graceEndsAtMillis === null) {
        return {
            entitled: true,
            valid: false,
            cancelAtMillis,
            graceEndsAtMillis: null,
        };
    }
    return {
        entitled: true,
        valid: true,
        cancelAtMillis,
        graceEndsAtMillis,
    };
}
const MEMBERSHIP_BOOKING_CLEANUP_COLLECTION = "membershipBookingCleanupJobs";
const MEMBERSHIP_BOOKING_CLEANUP_BATCH_SIZE = 50;
const MEMBERSHIP_BOOKING_CLEANUP_LEASE_MS = 4 * 60 * 1000;
function membershipBookingCleanupJobRef(subscriptionId) {
    return db().collection(MEMBERSHIP_BOOKING_CLEANUP_COLLECTION)
        .doc(subscriptionId);
}
function membershipBookingCleanupFingerprint(membership) {
    const boundary = membershipBookingBoundary(membership);
    if (boundary.entitled && boundary.valid &&
        boundary.cancelAtMillis === null &&
        boundary.graceEndsAtMillis === null)
        return null;
    return sha256(JSON.stringify({
        entitled: boundary.entitled,
        valid: boundary.valid,
        cancelAtMillis: boundary.cancelAtMillis,
        graceEndsAtMillis: boundary.graceEndsAtMillis,
    }));
}
function writeMembershipBookingCleanupJob(tx, jobRef, jobSnap, subscriptionId, userId, boundaryFingerprint, legacyUnboundEligible, acceptedAt) {
    const existing = jobSnap.exists ?
        jobSnap.data() : null;
    const sameBoundary = (existing === null || existing === void 0 ? void 0 : existing.boundaryFingerprint) === boundaryFingerprint &&
        existing.subscriptionId === subscriptionId &&
        existing.userId === userId;
    if (sameBoundary && (existing === null || existing === void 0 ? void 0 : existing.status) === "complete")
        return;
    if (sameBoundary && (existing === null || existing === void 0 ? void 0 : existing.status) === "pending") {
        tx.set(jobRef, {
            legacyUnboundEligible: existing.legacyUnboundEligible === true || legacyUnboundEligible,
            updatedAt: serverTimestamp(),
        }, { merge: true });
        return;
    }
    tx.set(jobRef, {
        schemaVersion: 1,
        subscriptionId,
        userId,
        boundaryFingerprint,
        status: "pending",
        acceptedAt,
        legacyUnboundEligible,
        cursorBookingId: null,
        attemptCount: 0,
        processedCount: 0,
        cancelledCount: 0,
        leaseToken: firestore_1.FieldValue.delete(),
        leaseExpiresAt: firestore_1.FieldValue.delete(),
        lastError: firestore_1.FieldValue.delete(),
        completedAt: firestore_1.FieldValue.delete(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    }, { merge: true });
}
/** Queues bounded, resumable cleanup without delaying entitlement projection. */
async function enqueueMembershipBookingCleanup(membershipRef, nowMillis = Date.now()) {
    const jobRef = membershipBookingCleanupJobRef(membershipRef.id);
    const acceptedAt = firestore_1.Timestamp.fromMillis(nowMillis);
    return db().runTransaction(async (tx) => {
        const membershipSnap = await tx.get(membershipRef);
        if (!membershipSnap.exists)
            return null;
        const membership = membershipSnap.data();
        const userId = membership.entitlementTargetUid;
        const boundaryFingerprint = membershipBookingCleanupFingerprint(membership);
        if (!userId || !boundaryFingerprint)
            return null;
        const [ownerSnap, userSnap, jobSnap] = await Promise.all([
            tx.get(entitlementOwnerRef(userId)),
            tx.get(db().collection("users").doc(userId)),
            tx.get(jobRef),
        ]);
        const legacyUnboundEligible = ownerSnap.exists &&
            ownerSnap.get("state") === "active" &&
            ownerSnap.get("subscriptionId") === membershipRef.id &&
            userSnap.exists && userSnap.get("entitlementSource") === "stripe";
        writeMembershipBookingCleanupJob(tx, jobRef, jobSnap, membershipRef.id, userId, boundaryFingerprint, legacyUnboundEligible, acceptedAt);
        return jobRef;
    });
}
async function acquireMembershipBookingCleanupLease(jobRef, nowMillis) {
    return db().runTransaction(async (tx) => {
        const jobSnap = await tx.get(jobRef);
        if (!jobSnap.exists || jobSnap.get("status") !== "pending")
            return null;
        const job = jobSnap.data();
        if (job.schemaVersion !== 1 || job.subscriptionId !== jobRef.id ||
            typeof job.userId !== "string" || !job.userId ||
            typeof job.boundaryFingerprint !== "string" ||
            !(job.acceptedAt instanceof firestore_1.Timestamp) ||
            typeof job.legacyUnboundEligible !== "boolean" ||
            (job.cursorBookingId !== null &&
                typeof job.cursorBookingId !== "string")) {
            tx.set(jobRef, {
                status: "manual_review",
                lastError: "Membership booking cleanup job evidence is malformed.",
                manualReviewAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            }, { merge: true });
            return null;
        }
        const leaseExpiresAtMillis = timestampMillis(job.leaseExpiresAt);
        if (leaseExpiresAtMillis !== null && leaseExpiresAtMillis > nowMillis) {
            return null;
        }
        const token = (0, crypto_1.randomUUID)();
        tx.set(jobRef, {
            attemptCount: firestore_1.FieldValue.increment(1),
            leaseToken: token,
            leaseExpiresAt: firestore_1.Timestamp.fromMillis(nowMillis + MEMBERSHIP_BOOKING_CLEANUP_LEASE_MS),
            lastAttemptAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        }, { merge: true });
        return { token, job };
    });
}
async function reconcileMembershipBookingCandidate(membershipRef, job, bookingRef, nowMillis) {
    return db().runTransaction(async (tx) => {
        var _a;
        const [membershipSnap, bookingSnap] = await Promise.all([
            tx.get(membershipRef),
            tx.get(bookingRef),
        ]);
        if (!bookingSnap.exists)
            return false;
        const booking = bookingSnap.data();
        if (booking.status !== "booked" || booking.userId !== job.userId ||
            booking.bookingKind === "payg_guest" ||
            booking.isGuestBooking === true)
            return false;
        const binding = booking.entitlementSubscriptionId;
        const hasBinding = binding !== undefined && binding !== null;
        if (hasBinding && binding !== membershipRef.id)
            return false;
        if (!hasBinding) {
            const createdAtMillis = timestampMillis(booking.createdAt);
            if (!job.legacyUnboundEligible || createdAtMillis === null ||
                createdAtMillis > job.acceptedAt.toMillis())
                return false;
        }
        const classId = typeof booking.classId === "string" ?
            booking.classId : "";
        if (!classId)
            return false;
        const classRef = db().collection("classes").doc(classId);
        const classSnap = await tx.get(classRef);
        if (!classSnap.exists)
            return false;
        const classStartMillis = timestampMillis(classSnap.get("startTime"));
        if (classStartMillis === null || classStartMillis < nowMillis)
            return false;
        if (membershipSnap.exists) {
            const membership = membershipSnap.data();
            if (membership.entitlementTargetUid === job.userId &&
                classStartAllowedByMembership(membershipBookingBoundary(membership), classStartMillis))
                return false;
            if (!hasBinding && membership.entitlementTargetUid !== job.userId) {
                return false;
            }
        }
        else if (!hasBinding) {
            return false;
        }
        const bookedCount = Number((_a = classSnap.get("bookedCount")) !== null && _a !== void 0 ? _a : 0);
        const quotaRelease = await (0, conditioningQuota_1.prepareConditioningQuotaRelease)(tx, db(), bookingRef.id, booking);
        (0, conditioningQuota_1.applyConditioningQuotaRelease)(tx, quotaRelease);
        tx.update(bookingRef, {
            status: "cancelled",
            cancelledAt: serverTimestamp(),
            cancelledReason: "membership_ineligible",
        });
        tx.update(classRef, {
            bookedCount: firestore_1.FieldValue.increment(bookedCount > 0 ? -1 : 0),
            updatedAt: serverTimestamp(),
        });
        return true;
    });
}
async function processMembershipBookingCleanupJob(jobRef, nowMillis = Date.now()) {
    const lease = await acquireMembershipBookingCleanupLease(jobRef, nowMillis);
    if (!lease)
        return { processed: 0, cancelled: 0, completed: false };
    const membershipRef = db().collection("memberships")
        .doc(lease.job.subscriptionId);
    try {
        const baseQuery = db().collection("bookings")
            .where("userId", "==", lease.job.userId)
            .where("status", "==", "booked")
            .orderBy(firestore_1.FieldPath.documentId())
            .limit(MEMBERSHIP_BOOKING_CLEANUP_BATCH_SIZE);
        const page = lease.job.cursorBookingId ?
            await baseQuery.startAfter(lease.job.cursorBookingId).get() :
            await baseQuery.get();
        let cancelled = 0;
        for (let offset = 0; offset < page.docs.length; offset += 5) {
            const results = await Promise.all(page.docs
                .slice(offset, offset + 5)
                .map((booking) => reconcileMembershipBookingCandidate(membershipRef, lease.job, booking.ref, nowMillis)));
            cancelled += results.filter(Boolean).length;
        }
        const completed = page.size < MEMBERSHIP_BOOKING_CLEANUP_BATCH_SIZE;
        const cursorBookingId = page.docs.length > 0 ?
            page.docs[page.docs.length - 1].id : lease.job.cursorBookingId;
        await db().runTransaction(async (tx) => {
            const current = await tx.get(jobRef);
            if (!current.exists || current.get("status") !== "pending" ||
                current.get("leaseToken") !== lease.token ||
                current.get("boundaryFingerprint") !==
                    lease.job.boundaryFingerprint)
                return;
            tx.set(jobRef, Object.assign(Object.assign({ status: completed ? "complete" : "pending", cursorBookingId, processedCount: firestore_1.FieldValue.increment(page.size), cancelledCount: firestore_1.FieldValue.increment(cancelled), leaseToken: firestore_1.FieldValue.delete(), leaseExpiresAt: firestore_1.FieldValue.delete(), lastError: firestore_1.FieldValue.delete() }, (completed ? { completedAt: serverTimestamp() } : {})), { updatedAt: serverTimestamp() }), { merge: true });
        });
        return { processed: page.size, cancelled, completed };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await db().runTransaction(async (tx) => {
            const current = await tx.get(jobRef);
            if (!current.exists || current.get("leaseToken") !== lease.token ||
                current.get("boundaryFingerprint") !==
                    lease.job.boundaryFingerprint)
                return;
            tx.set(jobRef, {
                leaseToken: firestore_1.FieldValue.delete(),
                leaseExpiresAt: firestore_1.FieldValue.delete(),
                lastError: message.slice(0, 1000),
                updatedAt: serverTimestamp(),
            }, { merge: true });
        }).catch((recordError) => console.error("Could not release membership booking cleanup lease", jobRef.id, recordError));
        throw error;
    }
}
/**
 * Enqueues and processes one bounded cleanup page. Exported for focused
 * emulator verification; production convergence uses the resumable worker.
 */
async function reconcileMembershipFutureBookings(membershipRef, nowMillis = Date.now()) {
    const jobRef = await enqueueMembershipBookingCleanup(membershipRef, nowMillis);
    if (jobRef)
        await processMembershipBookingCleanupJob(jobRef, nowMillis);
}
async function reconcileMembershipBookingCleanupJobsOnce(limit = 20) {
    const jobs = await db().collection(MEMBERSHIP_BOOKING_CLEANUP_COLLECTION)
        .where("status", "==", "pending")
        .limit(limit)
        .get();
    const result = { processed: 0, failed: 0, skipped: 0 };
    for (const job of jobs.docs) {
        try {
            const page = await processMembershipBookingCleanupJob(job.ref);
            if (page.processed === 0 && !page.completed)
                result.skipped += 1;
            else
                result.processed += 1;
        }
        catch (error) {
            console.error("Membership booking cleanup job failed", job.id, error);
            result.failed += 1;
        }
    }
    return result;
}
/** Resumes bounded cleanup pages independently of Stripe webhook latency. */
function buildReconcileMembershipBookings() {
    return (0, scheduler_1.onSchedule)({
        region: REGION,
        schedule: "every 5 minutes",
        timeZone: "UTC",
        timeoutSeconds: 540,
    }, async () => {
        await reconcileMembershipBookingCleanupJobsOnce();
    });
}
function classStartAllowedByMembership(boundary, classStartMillis) {
    if (!boundary.valid || !boundary.entitled)
        return false;
    // Stripe's cancel_at is the first instant without access.
    if (boundary.cancelAtMillis !== null &&
        classStartMillis >= boundary.cancelAtMillis)
        return false;
    // The stored grace deadline is the inclusive final millisecond of grace.
    if (boundary.graceEndsAtMillis !== null &&
        classStartMillis > boundary.graceEndsAtMillis)
        return false;
    return true;
}
function membershipBookingIneligibleError() {
    return new https_1.HttpsError("permission-denied", "This Stripe membership does not cover the selected class date.", { reason: MEMBERSHIP_BOOKING_INELIGIBLE_REASON });
}
/**
 * Resolves a Stripe-backed profile through its deterministic owner generation
 * and authoritative membership inside the caller's transaction. Manual,
 * legacy and staff entitlements do not depend on a Stripe membership row.
 */
async function assertStripeMembershipBookingEligibility(tx, userId, user, classStart, expectedSubscriptionId) {
    const hasBookingBinding = expectedSubscriptionId !== undefined &&
        expectedSubscriptionId !== null;
    const bookingSubscriptionId = typeof expectedSubscriptionId === "string" &&
        expectedSubscriptionId.length > 0 && expectedSubscriptionId.length <= 255 ?
        expectedSubscriptionId : null;
    if (hasBookingBinding && !bookingSubscriptionId) {
        throw membershipBookingIneligibleError();
    }
    if (user.entitlementSource !== "stripe" && !bookingSubscriptionId) {
        return { subscriptionId: null, conditioningBookingPolicy: null };
    }
    const owner = await tx.get(entitlementOwnerRef(userId));
    const subscriptionId = owner.get("subscriptionId");
    if (!owner.exists || owner.get("state") !== "active" ||
        typeof subscriptionId !== "string" || !subscriptionId ||
        (bookingSubscriptionId !== null && subscriptionId !== bookingSubscriptionId)) {
        throw membershipBookingIneligibleError();
    }
    const membership = await tx.get(db().collection("memberships").doc(subscriptionId));
    if (!membership.exists)
        throw membershipBookingIneligibleError();
    const authority = membership.data();
    const entitlementPolicy = (0, membershipPlans_1.validateCommercialEntitlementPolicy)(authority.commercialTerms, authority.planKey);
    const profilePolicy = (0, authz_1.resolveUserAuthorisation)(user);
    const classStartMillis = timestampMillis(classStart);
    if (authority.subscriptionId !== subscriptionId ||
        authority.entitlementTargetUid !== userId ||
        !entitlementPolicy || entitlementPolicy.grantsAlphaWodAccess !== true ||
        !profilePolicy.valid || profilePolicy.entitlementSource !== "stripe" ||
        profilePolicy.entitlementPolicyAppAccessTier !==
            entitlementPolicy.appAccessTier ||
        JSON.stringify(profilePolicy.entitlementPolicyClassSlots) !==
            JSON.stringify(entitlementPolicy.entitlementClassSlots) ||
        profilePolicy.entitlementPolicyWeeklyBookingLimit !==
            entitlementPolicy.entitlementWeeklyBookingLimit ||
        classStartMillis === null ||
        !classStartAllowedByMembership(membershipBookingBoundary(authority), classStartMillis)) {
        throw membershipBookingIneligibleError();
    }
    return {
        subscriptionId,
        conditioningBookingPolicy: entitlementPolicy.conditioningBookingPolicy,
    };
}
/**
 * Reads the deterministic entitlement generation. An active generation stays
 * authoritative until its entitlement transaction has either projected access
 * or restored the prior grant and marked the generation released.
 */
async function readEntitlementOwner(tx, userId, requestedSubscriptionId) {
    const ref = entitlementOwnerRef(userId);
    const owner = await tx.get(ref);
    const ownerSubscriptionId = owner.exists &&
        typeof owner.get("subscriptionId") === "string" ?
        owner.get("subscriptionId") : null;
    const ownerState = ownerSubscriptionId ?
        (owner.get("state") === "released" ? "released" : "active") : null;
    if (!ownerSubscriptionId || ownerSubscriptionId === requestedSubscriptionId) {
        return { ref, ownerSubscriptionId, ownerState, ownerMembershipBlocks: false };
    }
    if (ownerState === "released") {
        return { ref, ownerSubscriptionId, ownerState, ownerMembershipBlocks: false };
    }
    // An active generation remains authoritative until its entitlement
    // transaction restores the user and atomically marks this row released.
    // Looking only at the membership state would open a gap where a replacement
    // snapshots the old Stripe grant instead of the original manual/legacy one.
    return {
        ref,
        ownerSubscriptionId,
        ownerState,
        ownerMembershipBlocks: true,
    };
}
function acquireEntitlementOwner(tx, owner, userId, subscriptionId) {
    if (owner.ownerSubscriptionId &&
        owner.ownerSubscriptionId !== subscriptionId &&
        owner.ownerMembershipBlocks) {
        throw new https_1.HttpsError("already-exists", membershipPlans_1.POLICY_TEXT.duplicateBlocked);
    }
    tx.set(owner.ref, Object.assign({ schemaVersion: membershipPlans_1.MEMBERSHIP_SCHEMA_VERSION, subscriptionId, userIdHash: sha256(userId), state: "active", releasedAt: firestore_1.FieldValue.delete(), updatedAt: serverTimestamp() }, (owner.ownerSubscriptionId ? {} : { createdAt: serverTimestamp() })), { merge: true });
}
function participantMembershipQueries(participantKeys) {
    return participantKeys.flatMap((participantKey) => [
        db().collection("memberships")
            .where("participant.participantKey", "==", participantKey),
        db().collection("memberships")
            .where("participantKeys", "array-contains", participantKey),
    ]);
}
/**
 * Before plural youth checkout, memberships stored only the singular
 * `participant` map and its key used the older trim/lower normalisation. DOB
 * is the indexed candidate lookup; canonical name + DOB below is the actual
 * identity comparison, so siblings sharing a birthday never collide.
 */
function legacySingularParticipantMembershipQueries(participants) {
    return [...new Set(participants.map(({ dateOfBirth }) => dateOfBirth))].map((dateOfBirth) => db().collection("memberships")
        .where("participant.dateOfBirth", "==", dateOfBirth));
}
function canonicalParticipantIdentityToken(participant) {
    return JSON.stringify([
        participant.dateOfBirth,
        normalizeParticipantIdentityName(participant.fullName),
    ]);
}
function matchingLegacySingularParticipantDocs(snapshots, participants) {
    const proposedIdentities = new Set(participants.map(canonicalParticipantIdentityToken));
    return uniqueMembershipDocs(snapshots).filter((doc) => {
        const stored = doc.get("participant");
        return Boolean(stored && typeof stored.fullName === "string" &&
            typeof stored.dateOfBirth === "string" &&
            proposedIdentities.has(canonicalParticipantIdentityToken({
                fullName: stored.fullName,
                dateOfBirth: stored.dateOfBirth,
            })));
    });
}
function participantMembershipDocs(keyedSnapshots, legacyDobSnapshots, participants) {
    const byId = new Map(uniqueMembershipDocs(keyedSnapshots).map((doc) => [doc.id, doc]));
    matchingLegacySingularParticipantDocs(legacyDobSnapshots, participants).forEach((doc) => byId.set(doc.id, doc));
    return [...byId.values()];
}
function uniqueMembershipDocs(snapshots) {
    const byId = new Map();
    snapshots.forEach((snapshot) => snapshot.docs.forEach((doc) => byId.set(doc.id, doc)));
    return [...byId.values()];
}
/**
 * Atomically reserves every uniqueness key and checks existing memberships.
 * Stripe is deliberately called only after this transaction has committed.
 */
async function reserveCheckoutAttempt(intentRef, proposedIntent, nowMillis, convergedMembershipIds) {
    const participants = participantsFor(proposedIntent);
    const participantKeys = participantKeysFor(proposedIntent);
    const lockSpecs = checkoutLockSpecs(proposedIntent.payerUid, proposedIntent.planKey, participantKeys);
    const lockRefs = lockSpecs.map((spec) => db().collection(CHECKOUT_LOCK_COLLECTION).doc(spec.id));
    const participantQueries = participantMembershipQueries(participantKeys);
    const legacyParticipantQueries = legacySingularParticipantMembershipQueries(participants);
    const payerQuery = proposedIntent.payerUid &&
        proposedIntent.commercialTerms.grantsAlphaWodAccess ?
        db().collection("memberships").where("payerUid", "==", proposedIntent.payerUid) :
        null;
    const targetQuery = proposedIntent.payerUid &&
        proposedIntent.commercialTerms.grantsAlphaWodAccess ?
        db().collection("memberships")
            .where("entitlementTargetUid", "==", proposedIntent.payerUid) : null;
    return db().runTransaction(async (tx) => {
        var _a, _b, _c, _d;
        const existingIntent = await tx.get(intentRef);
        if (existingIntent.exists) {
            const stored = existingIntent.data();
            if (stored.requestFingerprint !== proposedIntent.requestFingerprint) {
                throw new https_1.HttpsError("failed-precondition", "This checkout attempt was already used with different membership details.");
            }
            return {
                created: false,
                intent: stored,
                intentRef,
                disposition: "same_attempt",
            };
        }
        // All reads precede every write, as Firestore transactions require.
        const lockSnaps = await Promise.all(lockRefs.map((ref) => tx.get(ref)));
        const participantSnaps = await Promise.all(participantQueries.map((query) => tx.get(query)));
        const legacyParticipantSnaps = await Promise.all(legacyParticipantQueries.map((query) => tx.get(query)));
        const byParticipant = participantMembershipDocs(participantSnaps, legacyParticipantSnaps, participants);
        const byPayer = payerQuery ? await tx.get(payerQuery) : null;
        const byTarget = targetQuery ? await tx.get(targetQuery) : null;
        const entitlementOwner = proposedIntent.payerUid && payerQuery ?
            await readEntitlementOwner(tx, proposedIntent.payerUid, intentRef.id) : null;
        if (convergedMembershipIds) {
            assertEligibilityDocsWereConverged([
                ...byParticipant,
                ...((_a = byPayer === null || byPayer === void 0 ? void 0 : byPayer.docs) !== null && _a !== void 0 ? _a : []).filter((doc) => doc.get("grantsAlphaWodAccess") === true),
                ...((_b = byTarget === null || byTarget === void 0 ? void 0 : byTarget.docs) !== null && _b !== void 0 ? _b : []).filter((doc) => doc.get("grantsAlphaWodAccess") === true),
            ], convergedMembershipIds);
            if ((entitlementOwner === null || entitlementOwner === void 0 ? void 0 : entitlementOwner.ownerState) === "active" &&
                entitlementOwner.ownerSubscriptionId &&
                !convergedMembershipIds.has(entitlementOwner.ownerSubscriptionId)) {
                throw new https_1.HttpsError("unavailable", AUTHORITATIVE_ELIGIBILITY_UNAVAILABLE, { reason: "membership_state_changed" });
            }
        }
        const priorIntentIds = [...new Set(lockSnaps.flatMap((snap) => snap.exists && typeof snap.get("intentId") === "string" ?
                [snap.get("intentId")] : []))];
        const priorIntentSnaps = await Promise.all(priorIntentIds.map((id) => tx.get(db().collection("membershipIntents").doc(id))));
        const priorIntentStatus = new Map(priorIntentSnaps.map((snap) => [
            snap.id,
            snap.exists ? snap.get("status") : null,
        ]));
        const blockingParticipantDocs = byParticipant.filter(isBlockingMembershipDoc);
        const blockingPayerDocs = ((_c = byPayer === null || byPayer === void 0 ? void 0 : byPayer.docs) !== null && _c !== void 0 ? _c : []).filter((doc) => isBlockingMembershipDoc(doc) && doc.get("grantsAlphaWodAccess") === true);
        const blockingTargetDocs = ((_d = byTarget === null || byTarget === void 0 ? void 0 : byTarget.docs) !== null && _d !== void 0 ? _d : []).filter((doc) => isBlockingMembershipDoc(doc) && doc.get("grantsAlphaWodAccess") === true);
        const membershipBlocks = blockingParticipantDocs.length > 0 ||
            blockingPayerDocs.length > 0 || blockingTargetDocs.length > 0 ||
            (entitlementOwner === null || entitlementOwner === void 0 ? void 0 : entitlementOwner.ownerMembershipBlocks) === true;
        const membershipIsBoundToAuthenticatedPayer = Boolean(proposedIntent.payerUid && ([...blockingParticipantDocs, ...blockingPayerDocs, ...blockingTargetDocs]
            .some((doc) => doc.get("payerUid") === proposedIntent.payerUid ||
            doc.get("entitlementTargetUid") === proposedIntent.payerUid) ||
            (entitlementOwner === null || entitlementOwner === void 0 ? void 0 : entitlementOwner.ownerMembershipBlocks) === true));
        const blockingLockSnaps = lockSnaps.filter((snap) => {
            if (!snap.exists)
                return false;
            const expiresAt = timestampMillis(snap.get("expiresAt"));
            if (expiresAt === null || expiresAt > nowMillis)
                return true;
            const ownerIntentId = snap.get("intentId");
            if (typeof ownerIntentId !== "string")
                return true;
            const ownerStatus = priorIntentStatus.get(ownerIntentId);
            // Time alone never proves a Checkout Session is unpaid. Only a terminal
            // intent, normally driven by Stripe's expired/async-failed event, may be
            // reclaimed. This prevents a delayed paid webhook being stranded behind
            // a replacement sale.
            return ownerStatus !== "expired" && ownerStatus !== "failed";
        });
        if (membershipBlocks) {
            throw membershipIsBoundToAuthenticatedPayer ?
                membershipExistsError() : checkoutInProgressError();
        }
        if (blockingLockSnaps.length > 0) {
            const blockingOwnerIds = [...new Set(blockingLockSnaps.flatMap((snap) => typeof snap.get("intentId") === "string" ?
                    [snap.get("intentId")] : []))];
            const resumeOwnerId = blockingOwnerIds.length === 1 ?
                blockingOwnerIds[0] : null;
            const resumeOwner = resumeOwnerId ? priorIntentSnaps.find((snap) => snap.id === resumeOwnerId) : null;
            const resumeIntent = (resumeOwner === null || resumeOwner === void 0 ? void 0 : resumeOwner.exists) ?
                resumeOwner.data() : null;
            const expectedLockIds = lockRefs.map((ref) => ref.id).sort();
            const storedLockIds = resumeIntent &&
                Array.isArray(resumeIntent.reservationLockIds) ?
                [...resumeIntent.reservationLockIds].sort() : [];
            const ownsEveryExpectedLock = Boolean(resumeOwnerId) &&
                lockSnaps.every((snap) => snap.exists && snap.get("intentId") === resumeOwnerId);
            const hasExactLockSet = expectedLockIds.length === storedLockIds.length &&
                expectedLockIds.every((id, index) => id === storedLockIds[index]);
            const resumableByOwner = Boolean(proposedIntent.payerUid &&
                resumeOwnerId &&
                resumeIntent &&
                ownsEveryExpectedLock &&
                hasExactLockSet &&
                resumeIntent.payerUid === proposedIntent.payerUid &&
                resumeIntent.requestFingerprint === proposedIntent.requestFingerprint &&
                resumeIntent.stripeMode === proposedIntent.stripeMode &&
                resumeIntent.status === "created" &&
                typeof resumeIntent.checkoutSessionId === "string" &&
                resumeIntent.checkoutSessionId &&
                typeof resumeIntent.checkoutSessionUrl === "string" &&
                resumeIntent.checkoutSessionUrl);
            if (resumableByOwner && resumeOwner && resumeIntent) {
                return {
                    created: false,
                    intent: resumeIntent,
                    intentRef: resumeOwner.ref,
                    disposition: "owned_resume_candidate",
                };
            }
            throw checkoutInProgressError();
        }
        tx.create(intentRef, proposedIntent);
        lockSpecs.forEach((spec, index) => {
            tx.set(lockRefs[index], {
                schemaVersion: membershipPlans_1.MEMBERSHIP_SCHEMA_VERSION,
                kind: spec.kind,
                identityHash: spec.identityHash,
                intentId: intentRef.id,
                status: "reserved",
                expiresAt: proposedIntent.reservationExpiresAt,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
        });
        return {
            created: true,
            intent: proposedIntent,
            intentRef,
            disposition: "created",
        };
    });
}
/**
 * Releases only locks still owned by this intent. The ownership check matters
 * when an old webhook arrives after an expired lock has been reused.
 */
async function transitionCheckoutReservation(intentRef, status, updates = {}, releaseLocks = true, stripeSessionBinding) {
    return db().runTransaction(async (tx) => {
        var _a;
        const intentSnap = await tx.get(intentRef);
        if (!intentSnap.exists)
            return false;
        if (intentSnap.get("stripeMode") !== assertBillingEnvironment().stripeMode) {
            throw new Error(`Checkout intent ${intentRef.id} belongs to another Stripe environment.`);
        }
        if (stripeSessionBinding) {
            const storedSessionId = intentSnap.get("checkoutSessionId");
            const storedPlanKey = intentSnap.get("planKey");
            if (!stripeSessionBinding.sessionId ||
                stripeSessionBinding.mode !== "subscription" ||
                stripeSessionBinding.planKey !== storedPlanKey ||
                (storedSessionId !== null && storedSessionId !== undefined &&
                    storedSessionId !== stripeSessionBinding.sessionId)) {
                throw new Error(`Stripe Checkout Session does not match membership intent ${intentRef.id}.`);
            }
        }
        const current = intentSnap.get("status");
        const allowed = {
            reserved: ["reserved", "created", "payment_pending", "fulfilled", "expired", "failed"],
            created: ["created", "payment_pending", "fulfilled", "expired", "failed"],
            payment_pending: ["payment_pending", "fulfilled", "expired", "failed"],
            fulfilled: ["fulfilled"],
            expired: ["expired"],
            failed: ["failed"],
        };
        if (!((_a = allowed[current]) === null || _a === void 0 ? void 0 : _a.includes(status)))
            return false;
        const lockIds = Array.isArray(intentSnap.get("reservationLockIds")) ?
            intentSnap.get("reservationLockIds") : [];
        const lockRefs = lockIds.map((id) => db().collection(CHECKOUT_LOCK_COLLECTION).doc(id));
        const lockSnaps = await Promise.all(lockRefs.map((ref) => tx.get(ref)));
        if (releaseLocks) {
            lockSnaps.forEach((snap, index) => {
                if (snap.exists && snap.get("intentId") === intentRef.id) {
                    tx.delete(lockRefs[index]);
                }
            });
        }
        tx.set(intentRef, Object.assign(Object.assign(Object.assign({ status }, updates), (stripeSessionBinding ? {
            checkoutSessionId: stripeSessionBinding.sessionId,
        } : {})), { updatedAt: serverTimestamp() }), { merge: true });
        return true;
    });
}
/** Keeps a completed-but-delayed payment from losing its duplicate guard. */
async function extendCheckoutReservationForAsyncPayment(intentRef) {
    const expiresAt = firestore_1.Timestamp.fromMillis(Date.now() + ASYNC_PAYMENT_RESERVATION_MS);
    await db().runTransaction(async (tx) => {
        const intentSnap = await tx.get(intentRef);
        if (!intentSnap.exists)
            return;
        const current = intentSnap.get("status");
        if (current !== "reserved" && current !== "created" &&
            current !== "payment_pending")
            return;
        const lockIds = Array.isArray(intentSnap.get("reservationLockIds")) ?
            intentSnap.get("reservationLockIds") : [];
        const lockRefs = lockIds.map((id) => db().collection(CHECKOUT_LOCK_COLLECTION).doc(id));
        const lockSnaps = await Promise.all(lockRefs.map((ref) => tx.get(ref)));
        const ownsEveryLock = lockRefs.length > 0 && lockSnaps.every((snap) => snap.exists && snap.get("intentId") === intentRef.id);
        if (!ownsEveryLock) {
            throw new Error(`Checkout ${intentRef.id} lost its payment reservation.`);
        }
        lockSnaps.forEach((_snap, index) => tx.set(lockRefs[index], {
            status: "payment_pending",
            expiresAt,
            updatedAt: serverTimestamp(),
        }, { merge: true }));
        tx.set(intentRef, {
            status: "payment_pending",
            reservationExpiresAt: expiresAt,
            updatedAt: serverTimestamp(),
        }, { merge: true });
    });
}
/**
 * Gives an expired local reservation one authoritative Stripe check before a
 * replacement purchase is attempted. A timestamp never releases a lock by
 * itself: terminal intent/Session state does. Paid or uncertain Sessions stay
 * blocked for webhook/manual recovery.
 */
async function reconcileExpiredCheckoutReservations(lockIds, nowMillis = Date.now(), verifyRegardlessOfLockExpiry = false) {
    var _a;
    const lockSnaps = await Promise.all(lockIds.map((id) => db().collection(CHECKOUT_LOCK_COLLECTION).doc(id).get()));
    const ownerIds = [...new Set(lockSnaps.flatMap((snap) => {
            if (!snap.exists)
                return [];
            const expiresAt = timestampMillis(snap.get("expiresAt"));
            if (!verifyRegardlessOfLockExpiry &&
                (expiresAt === null || expiresAt > nowMillis))
                return [];
            return typeof snap.get("intentId") === "string" ?
                [snap.get("intentId")] : [];
        }))];
    for (const ownerId of ownerIds) {
        const intentRef = db().collection("membershipIntents").doc(ownerId);
        const intent = await intentRef.get();
        if (!intent.exists) {
            console.error("CRITICAL_BILLING_ORPHAN_CHECKOUT_LOCK", { intentId: ownerId });
            continue;
        }
        if (intent.get("stripeMode") !== assertBillingEnvironment().stripeMode) {
            console.error("CRITICAL_BILLING_CHECKOUT_LOCK_MODE_MISMATCH", {
                intentId: ownerId,
                storedStripeMode: (_a = intent.get("stripeMode")) !== null && _a !== void 0 ? _a : null,
            });
            continue;
        }
        const status = intent.get("status");
        if (status === "expired" || status === "failed") {
            await transitionCheckoutReservation(intentRef, status);
            continue;
        }
        const sessionId = intent.get("checkoutSessionId");
        if (typeof sessionId !== "string" || !sessionId) {
            console.error("CRITICAL_BILLING_UNVERIFIED_CHECKOUT_LOCK", { intentId: ownerId });
            continue;
        }
        try {
            let session = await stripe().checkout.sessions.retrieve(sessionId);
            assertStripeObjectMode("Checkout Session", session.id, session.livemode);
            if (session.status === "open" &&
                typeof session.expires_at === "number" &&
                session.expires_at * 1000 <= nowMillis) {
                session = await stripe().checkout.sessions.expire(sessionId);
                assertStripeObjectMode("Checkout Session", session.id, session.livemode);
            }
            if (session.status === "expired") {
                await transitionCheckoutReservation(intentRef, "expired", {
                    verifiedTerminalAt: serverTimestamp(),
                });
            }
            else if (session.status === "complete") {
                await extendCheckoutReservationForAsyncPayment(intentRef);
                if (session.payment_status !== "unpaid") {
                    console.error("CRITICAL_BILLING_PAID_SESSION_AWAITING_FULFILMENT", {
                        intentId: ownerId,
                        checkoutSessionId: sessionId,
                    });
                    await writeAudit({
                        type: "paid_checkout_awaiting_fulfilment",
                        severity: "critical",
                        intentId: ownerId,
                        checkoutSessionId: sessionId,
                    }).catch((auditError) => console.error("Could not write paid-checkout audit", ownerId, auditError));
                }
            }
        }
        catch (error) {
            // Retrieval uncertainty is deliberately fail-closed; reserveCheckoutAttempt
            // will keep rejecting the replacement while this owner remains nonterminal.
            console.error("Checkout reservation verification failed", ownerId, error);
        }
    }
}
function checkoutProcessingError() {
    return new https_1.HttpsError("failed-precondition", "This checkout has already been submitted and Stripe is processing it. Check your membership account before trying again.", { reason: "checkout_processing" });
}
function checkoutRecoveryUnavailableError() {
    return new https_1.HttpsError("unavailable", "The existing Stripe checkout could not be verified safely. Try again shortly or contact support.", { reason: "checkout_recovery_unavailable" });
}
function checkoutRecoveryReviewError() {
    return new https_1.HttpsError("failed-precondition", "The existing Stripe checkout no longer matches this membership request. Contact support before trying again.", { reason: "checkout_recovery_review" });
}
function checkoutRecoveryProviderDiagnostic(error) {
    const candidate = error;
    const safeText = (value) => typeof value === "string" ? value.slice(0, 120) : null;
    return {
        name: safeText(candidate === null || candidate === void 0 ? void 0 : candidate.name),
        type: safeText(candidate === null || candidate === void 0 ? void 0 : candidate.type),
        code: safeText(candidate === null || candidate === void 0 ? void 0 : candidate.code),
        statusCode: typeof (candidate === null || candidate === void 0 ? void 0 : candidate.statusCode) === "number" ?
            candidate.statusCode : null,
        requestId: safeText(candidate === null || candidate === void 0 ? void 0 : candidate.requestId),
    };
}
function conditioningPolicyMetadata(policy) {
    return {
        conditioningPolicyVersion: String(policy.version),
        conditioningWeeklyLimit: String(policy.weeklyBookingLimit),
        conditioningEligibleSlots: policy.eligibleSlotKeys.join(","),
    };
}
function conditioningPolicyMetadataMismatch(metadata, policy) {
    const expected = conditioningPolicyMetadata(policy);
    return (metadata === null || metadata === void 0 ? void 0 : metadata.conditioningPolicyVersion) !==
        expected.conditioningPolicyVersion ||
        (metadata === null || metadata === void 0 ? void 0 : metadata.conditioningWeeklyLimit) !== expected.conditioningWeeklyLimit ||
        (metadata === null || metadata === void 0 ? void 0 : metadata.conditioningEligibleSlots) !== expected.conditioningEligibleSlots ||
        (metadata === null || metadata === void 0 ? void 0 : metadata.conditioningSlots) != null;
}
function hasUnexpectedConditioningMetadata(metadata) {
    return (metadata === null || metadata === void 0 ? void 0 : metadata.conditioningSlots) != null ||
        (metadata === null || metadata === void 0 ? void 0 : metadata.conditioningPolicyVersion) != null ||
        (metadata === null || metadata === void 0 ? void 0 : metadata.conditioningWeeklyLimit) != null ||
        (metadata === null || metadata === void 0 ? void 0 : metadata.conditioningEligibleSlots) != null;
}
function checkoutSessionCommonBindingMismatch(session, intentRef, intent) {
    var _a, _b, _c, _d, _e, _f, _g;
    if (session.id !== intent.checkoutSessionId)
        return "session_id";
    if (session.mode !== "subscription")
        return "session_mode";
    if (((_a = session.metadata) === null || _a === void 0 ? void 0 : _a.intentId) !== intentRef.id)
        return "intent_metadata";
    if (((_b = session.metadata) === null || _b === void 0 ? void 0 : _b.planKey) !== intent.planKey)
        return "plan_metadata";
    if (((_c = session.metadata) === null || _c === void 0 ? void 0 : _c.appAccessTier) !== intent.commercialTerms.appAccessTier) {
        return "app_access_tier_metadata";
    }
    const policy = (0, membershipPlans_1.validateCommercialEntitlementPolicy)(intent.commercialTerms, intent.planKey);
    if (!policy)
        return "commercial_entitlement_policy";
    if (intent.planKey === "adult_conditioning" &&
        policy.conditioningBookingPolicy &&
        conditioningPolicyMetadataMismatch(session.metadata, policy.conditioningBookingPolicy))
        return "conditioning_booking_policy_metadata";
    if (intent.planKey === "adult_conditioning" &&
        !policy.conditioningBookingPolicy) {
        const expectedSlots = (0, authz_1.canonicalConditioningSlots)(intent.selectedConditioningSlots);
        if (!expectedSlots || JSON.stringify(expectedSlots) !==
            JSON.stringify(policy.entitlementClassSlots) ||
            ((_d = session.metadata) === null || _d === void 0 ? void 0 : _d.conditioningSlots) !==
                expectedSlots.join(",") ||
            ((_e = session.metadata) === null || _e === void 0 ? void 0 : _e.conditioningPolicyVersion) != null ||
            ((_f = session.metadata) === null || _f === void 0 ? void 0 : _f.conditioningWeeklyLimit) != null ||
            ((_g = session.metadata) === null || _g === void 0 ? void 0 : _g.conditioningEligibleSlots) != null) {
            return "conditioning_slots_metadata";
        }
    }
    if (intent.planKey !== "adult_conditioning" &&
        hasUnexpectedConditioningMetadata(session.metadata)) {
        return "unexpected_conditioning_slots_metadata";
    }
    if (typeof session.expires_at !== "number" ||
        session.expires_at !== intent.checkoutExpiresAt)
        return "session_expiry";
    return null;
}
function checkoutAuthenticatedBindingMismatch(session, payerUid, expectedStripeCustomerId) {
    var _a;
    if (((_a = session.metadata) === null || _a === void 0 ? void 0 : _a.firebaseUid) !== payerUid)
        return "payer_metadata";
    if (session.client_reference_id !== payerUid)
        return "client_reference";
    if (!expectedStripeCustomerId ||
        idOf(session.customer) !== expectedStripeCustomerId)
        return "stripe_customer";
    return null;
}
function checkoutAnonymousBindingMismatch(session) {
    var _a;
    if (((_a = session.metadata) === null || _a === void 0 ? void 0 : _a.firebaseUid) != null)
        return "unexpected_payer_metadata";
    if (session.client_reference_id !== null)
        return "unexpected_client_reference";
    return null;
}
async function assertCheckoutSessionStillCurrent(intentRef, expected, payerUid) {
    const lockIds = Array.isArray(expected.reservationLockIds) ?
        expected.reservationLockIds : [];
    if (lockIds.length === 0)
        return false;
    return db().runTransaction(async (tx) => {
        const current = await tx.get(intentRef);
        const lockRefs = lockIds.map((id) => db().collection(CHECKOUT_LOCK_COLLECTION).doc(id));
        const locks = await Promise.all(lockRefs.map((ref) => tx.get(ref)));
        const currentLockIds = current.exists &&
            Array.isArray(current.get("reservationLockIds")) ?
            [...current.get("reservationLockIds")] : [];
        if (!current.exists ||
            current.get("status") !== "created" ||
            current.get("payerUid") !== payerUid ||
            current.get("requestFingerprint") !== expected.requestFingerprint ||
            current.get("stripeMode") !== expected.stripeMode ||
            current.get("checkoutSessionId") !== expected.checkoutSessionId ||
            current.get("checkoutSessionUrl") !== expected.checkoutSessionUrl ||
            current.get("checkoutExpiresAt") !== expected.checkoutExpiresAt ||
            currentLockIds.length !== lockIds.length ||
            currentLockIds.some((id, index) => id !== lockIds[index])) {
            return false;
        }
        return locks.every((lock) => lock.exists && lock.get("intentId") === intentRef.id);
    });
}
/**
 * A recorded Session is recoverable only through its exact attempt verifier or
 * by the authenticated owner of an identical request and full lock set. Stripe
 * is re-read before the URL is returned; Firestore ownership alone never proves
 * that a hosted Checkout remains open.
 */
async function verifyCheckoutSessionCandidate(reservation, payerUid, expectedStripeCustomerId, expectedDisposition, nowMillis = Date.now(), transitionExpired = true) {
    var _a, _b, _c, _d;
    const intent = reservation.intent;
    const sessionId = intent.checkoutSessionId;
    if (reservation.disposition !== expectedDisposition ||
        typeof sessionId !== "string" || !sessionId ||
        ((_a = intent.payerUid) !== null && _a !== void 0 ? _a : null) !== payerUid ||
        (expectedDisposition === "owned_resume_candidate" && !payerUid)) {
        throw checkoutRecoveryReviewError();
    }
    let session;
    try {
        session = await stripe().checkout.sessions.retrieve(sessionId);
    }
    catch (error) {
        console.error("Checkout resume provider verification failed", {
            checkoutSessionIdHash: sha256(sessionId),
            intentIdHash: sha256(reservation.intentRef.id),
            provider: checkoutRecoveryProviderDiagnostic(error),
        });
        throw checkoutRecoveryUnavailableError();
    }
    const validateBinding = (candidate) => {
        try {
            assertStripeObjectMode("Checkout Session", candidate.id, candidate.livemode);
        }
        catch (error) {
            console.error("CRITICAL_BILLING_CHECKOUT_RESUME_MODE_MISMATCH", {
                checkoutSessionIdHash: sha256(sessionId),
                intentIdHash: sha256(reservation.intentRef.id),
                provider: checkoutRecoveryProviderDiagnostic(error),
            });
            throw checkoutRecoveryReviewError();
        }
        const mismatch = checkoutSessionCommonBindingMismatch(candidate, reservation.intentRef, intent) || (payerUid ? checkoutAuthenticatedBindingMismatch(candidate, payerUid, expectedStripeCustomerId) : checkoutAnonymousBindingMismatch(candidate));
        if (mismatch) {
            console.error("CRITICAL_BILLING_CHECKOUT_RESUME_BINDING_MISMATCH", {
                checkoutSessionIdHash: sha256(sessionId),
                intentIdHash: sha256(reservation.intentRef.id),
                mismatch,
            });
            throw checkoutRecoveryReviewError();
        }
    };
    validateBinding(session);
    if (session.status === "open" && session.expires_at <= Math.floor(nowMillis / 1000)) {
        try {
            session = await stripe().checkout.sessions.expire(sessionId);
        }
        catch (error) {
            console.error("Checkout resume expiry verification failed", {
                checkoutSessionIdHash: sha256(sessionId),
                intentIdHash: sha256(reservation.intentRef.id),
                provider: checkoutRecoveryProviderDiagnostic(error),
            });
            throw checkoutRecoveryUnavailableError();
        }
        validateBinding(session);
    }
    if (session.status === "complete") {
        await extendCheckoutReservationForAsyncPayment(reservation.intentRef);
        throw checkoutProcessingError();
    }
    if (session.status === "expired") {
        if (!transitionExpired)
            return { kind: "expired", session };
        const transitioned = await transitionCheckoutReservation(reservation.intentRef, "expired", { verifiedTerminalAt: serverTimestamp() }, true, {
            sessionId: session.id,
            mode: session.mode,
            planKey: (_c = (_b = session.metadata) === null || _b === void 0 ? void 0 : _b.planKey) !== null && _c !== void 0 ? _c : null,
        });
        if (!transitioned)
            throw checkoutProcessingError();
        return { kind: "expired", session };
    }
    if (session.status !== "open" || !session.url) {
        console.error("CRITICAL_BILLING_CHECKOUT_RESUME_UNSAFE_STATUS", {
            checkoutSessionIdHash: sha256(sessionId),
            intentIdHash: sha256(reservation.intentRef.id),
            status: (_d = session.status) !== null && _d !== void 0 ? _d : null,
            hasUrl: Boolean(session.url),
        });
        throw checkoutRecoveryReviewError();
    }
    if (!await assertCheckoutSessionStillCurrent(reservation.intentRef, intent, payerUid)) {
        throw checkoutProcessingError();
    }
    return { kind: "open", session };
}
async function verifyOwnedCheckoutResumeCandidate(reservation, payerUid, expectedStripeCustomerId, nowMillis = Date.now()) {
    return verifyCheckoutSessionCandidate(reservation, payerUid, expectedStripeCustomerId, "owned_resume_candidate", nowMillis);
}
async function verifySameAttemptCheckoutSession(reservation, payerUid, expectedStripeCustomerId, nowMillis = Date.now()) {
    return verifyCheckoutSessionCandidate(reservation, payerUid, expectedStripeCustomerId, "same_attempt", nowMillis);
}
/** ---------------------------------------------------------------
 * Entitlement application
 * -------------------------------------------------------------- */
async function writeAudit(entry) {
    await db().collection("membershipAudit").add(Object.assign(Object.assign({}, entry), { createdAt: serverTimestamp() }));
}
/**
 * Applies a membership's entitlement decision to the target profile, then
 * converges derived markers and Auth claims through the caller-supplied
 * Phase 0 routine.
 *
 * Staff roles are deliberately untouched: admin and SGPT access is granted by
 * role with a `staff` source and must remain independent of any consumer
 * membership. A banned role is never granted anything.
 */
async function applyMembershipEntitlement(membershipRef, converge) {
    // Snapshot the previous owner/profile generation for legacy unbound rows,
    // but never make an unbounded booking scan a prerequisite for revocation.
    // New booking gates already read this membership authority synchronously;
    // the scheduled worker restores class capacity in bounded pages.
    await enqueueMembershipBookingCleanup(membershipRef).catch(async (error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Membership booking cleanup could not be queued", {
            subscriptionId: membershipRef.id,
            error: message,
        });
        await writeAudit({
            type: "membership_booking_cleanup_queue_failed",
            severity: "error",
            subscriptionId: membershipRef.id,
            error: message.slice(0, 1000),
        }).catch((auditError) => console.error("Could not write booking-cleanup queue audit", membershipRef.id, auditError));
    });
    const cleanupAcceptedAt = firestore_1.Timestamp.now();
    const outcome = await db().runTransaction(async (tx) => {
        var _a, _b, _c, _d, _e, _f;
        const membershipSnap = await tx.get(membershipRef);
        if (!membershipSnap.exists)
            return null;
        const membership = membershipSnap.data();
        const uid = membership.entitlementTargetUid;
        if (!uid)
            return null;
        const commercialEntitlementPolicy = (0, membershipPlans_1.validateCommercialEntitlementPolicy)(membership.commercialTerms, membership.planKey);
        // A blocking presale owns the duplicate lock but normally must not change
        // entitlement before first payment. The one exception is an already-
        // approved historical member whose profile predates the entitlement
        // schema: completing and claiming checkout restores the same legacy grant
        // the reviewed Phase 0 migration assigns. New/pending members and any
        // explicit restriction remain gated until the first payment succeeds.
        // Once a prepayment membership becomes terminal, release only its owner
        // generation; any independent legacy/manual access remains untouched.
        if (membership.billingMode === "presale_deferred" &&
            membership.firstPaymentReceivedAt === null) {
            if ((0, membershipPlans_1.isMembershipStateBlockingDuplicate)(membership.state)) {
                if (membership.state !== "scheduled" ||
                    (commercialEntitlementPolicy === null || commercialEntitlementPolicy === void 0 ? void 0 : commercialEntitlementPolicy.grantsAlphaWodAccess) !== true ||
                    membership.providerContractStatus !== "verified" ||
                    ((_a = membership.participant) === null || _a === void 0 ? void 0 : _a.isPayer) !== true)
                    return null;
                const userRef = db().collection("users").doc(uid);
                const userSnap = await tx.get(userRef);
                if (!userSnap.exists)
                    return null;
                const user = userSnap.data();
                if (user.role !== "user" || user.approvalStatus !== "approved") {
                    return null;
                }
                const alreadyGrandfathered = user.entitlementStatus === "active" &&
                    (user.entitlementSource === "legacy" ||
                        user.entitlementSource === "manual");
                if (alreadyGrandfathered) {
                    return { convergeUid: uid, reviewReason: null, reviewUidHash: null };
                }
                const hasHistoricalUnprojectedEntitlement = (user.entitlementStatus === undefined ||
                    user.entitlementStatus === null ||
                    user.entitlementStatus === "") &&
                    (user.entitlementSource === undefined ||
                        user.entitlementSource === null ||
                        user.entitlementSource === "");
                if (!hasHistoricalUnprojectedEntitlement)
                    return null;
                const restored = (0, authz_1.resolveUserAuthorisation)({
                    role: "user",
                    approvalStatus: "approved",
                    entitlementStatus: "active",
                    entitlementSource: "legacy",
                });
                tx.set(userRef, {
                    entitlementStatus: "active",
                    entitlementSource: "legacy",
                    appAccessTier: "full",
                    entitlementClassSlots: firestore_1.FieldValue.delete(),
                    entitlementPlanKey: firestore_1.FieldValue.delete(),
                    alphaWodAccess: restored.alphaWodAccess,
                    accessSchemaVersion: authz_1.ACCESS_SCHEMA_VERSION,
                    entitlementReason: "presale_existing_member_grandfathered",
                    entitlementUpdatedAt: serverTimestamp(),
                    entitlementUpdatedBy: "stripe_membership_claim",
                    updatedAt: serverTimestamp(),
                }, { merge: true });
                tx.set(membershipRef, {
                    existingMemberAccessRestoredAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                }, { merge: true });
                return { convergeUid: uid, reviewReason: null, reviewUidHash: null };
            }
            const owner = await readEntitlementOwner(tx, uid, membershipRef.id);
            if (owner.ownerSubscriptionId === membershipRef.id &&
                owner.ownerState === "active") {
                tx.set(owner.ref, {
                    schemaVersion: membershipPlans_1.MEMBERSHIP_SCHEMA_VERSION,
                    subscriptionId: membershipRef.id,
                    userIdHash: sha256(uid),
                    state: "released",
                    releasedAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                }, { merge: true });
            }
            return null;
        }
        const frozenDecision = (0, membershipPlans_1.resolveEntitlementForCommercialTerms)(membership.commercialTerms, membership.state, membership.planKey);
        const decision = membership.providerContractStatus === "manual_review" &&
            (0, membershipPlans_1.isMembershipStateBlockingDuplicate)(membership.state) && frozenDecision ? Object.assign(Object.assign({}, frozenDecision), { entitlementStatus: "restricted", entitlementSource: "stripe", reason: "Stripe subscription contract requires manual review." }) : frozenDecision;
        if (!decision)
            return null;
        const userRef = db().collection("users").doc(uid);
        const userSnap = await tx.get(userRef);
        const owner = await readEntitlementOwner(tx, uid, membershipRef.id);
        const cleanupFingerprint = membershipBookingCleanupFingerprint(membership);
        if (cleanupFingerprint) {
            const cleanupJobRef = membershipBookingCleanupJobRef(membershipRef.id);
            const cleanupJobSnap = await tx.get(cleanupJobRef);
            writeMembershipBookingCleanupJob(tx, cleanupJobRef, cleanupJobSnap, membershipRef.id, uid, cleanupFingerprint, owner.ownerSubscriptionId === membershipRef.id &&
                owner.ownerState === "active" && userSnap.exists &&
                userSnap.get("entitlementSource") === "stripe", cleanupAcceptedAt);
        }
        // Once a replacement membership owns this account, an older cancelled or
        // revoked membership is no longer authoritative for its entitlement. A
        // delayed convergence of the old subscription must not erase the valid
        // replacement grant or restore the old pre-membership snapshot.
        const membershipBlocks = (0, membershipPlans_1.isMembershipStateBlockingDuplicate)(membership.state);
        if (!membershipBlocks &&
            (owner.ownerSubscriptionId !== membershipRef.id || owner.ownerState !== "active")) {
            return null;
        }
        const releaseOwnerWithoutProjection = (reason) => {
            if (!membershipBlocks && owner.ownerSubscriptionId === membershipRef.id &&
                owner.ownerState === "active") {
                tx.set(owner.ref, {
                    schemaVersion: membershipPlans_1.MEMBERSHIP_SCHEMA_VERSION,
                    subscriptionId: membershipRef.id,
                    userIdHash: sha256(uid),
                    state: "released",
                    releasedAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                }, { merge: true });
            }
            tx.set(membershipRef, {
                entitlementProjectionStatus: "manual_review",
                entitlementProjectionError: reason,
                updatedAt: serverTimestamp(),
            }, { merge: true });
            return { convergeUid: null, reviewReason: reason, reviewUidHash: sha256(uid) };
        };
        // An ended membership must release its active generation even when the
        // target profile can no longer be safely projected. Otherwise a deleted,
        // malformed or staff-converted profile would block every replacement
        // membership forever. The profile itself remains untouched for review.
        if (!userSnap.exists) {
            return releaseOwnerWithoutProjection("The entitlement target profile is missing.");
        }
        const user = userSnap.data();
        if (!(0, authz_1.isUserRole)(user.role) || !(0, authz_1.isApprovalStatus)(user.approvalStatus)) {
            return releaseOwnerWithoutProjection("The entitlement target profile has an invalid role or approval status.");
        }
        if (user.role !== "user") {
            return releaseOwnerWithoutProjection("The entitlement target is now a staff or banned profile and was left unchanged.");
        }
        const current = (0, authz_1.resolveUserAuthorisation)(user);
        let nextStatus = decision.entitlementStatus;
        let nextSource = decision.entitlementSource;
        let nextTier = decision.appAccessTier;
        let nextClassSlots = decision.entitlementClassSlots;
        let nextWeeklyBookingLimit = decision.entitlementWeeklyBookingLimit;
        let nextPlanKey = nextSource === "stripe" ?
            membership.planKey : null;
        // Remember what the member held before a paid membership first moved them,
        // so cancelling a purchase restores a grandfathered grant instead of
        // removing access the purchase never created.
        const preMembership = (_b = membership.preMembershipEntitlement) !== null && _b !== void 0 ? _b : {
            entitlementStatus: current.entitlementStatus,
            entitlementSource: current.entitlementSource,
            appAccessTier: current.entitlementPolicyAppAccessTier,
            entitlementPlanKey: typeof user.entitlementPlanKey === "string" ?
                user.entitlementPlanKey : null,
            entitlementClassSlots: current.entitlementPolicyClassSlots,
            entitlementWeeklyBookingLimit: current.entitlementPolicyWeeklyBookingLimit,
        };
        if (nextStatus === "none" &&
            preMembership.entitlementStatus === "active" &&
            (preMembership.entitlementSource === "legacy" ||
                preMembership.entitlementSource === "manual")) {
            nextStatus = preMembership.entitlementStatus;
            nextSource = preMembership.entitlementSource;
            nextTier = (_c = preMembership.appAccessTier) !== null && _c !== void 0 ? _c : "full";
            nextPlanKey = (_d = preMembership.entitlementPlanKey) !== null && _d !== void 0 ? _d : null;
            nextClassSlots = (_e = (0, authz_1.canonicalConditioningSlots)(preMembership.entitlementClassSlots)) !== null && _e !== void 0 ? _e : [];
            nextWeeklyBookingLimit =
                (_f = preMembership.entitlementWeeklyBookingLimit) !== null && _f !== void 0 ? _f : null;
        }
        if (!(0, authz_1.isEntitlementCompatibleWithRole)(user.role, nextStatus, nextSource)) {
            return releaseOwnerWithoutProjection("The resolved membership entitlement is incompatible with the target profile.");
        }
        // A purchase that grants app access also completes approval for that
        // account. This is the only non-admin approval path and it exists solely
        // on the server-side fulfilment route.
        const approvalStatus = nextStatus === "active" ? "approved" : user.approvalStatus;
        const next = {
            role: user.role,
            approvalStatus,
            entitlementStatus: nextStatus,
            entitlementSource: nextSource,
            appAccessTier: nextTier,
            entitlementPlanKey: nextPlanKey,
            entitlementClassSlots: nextClassSlots,
            entitlementWeeklyBookingLimit: nextWeeklyBookingLimit,
        };
        const access = (0, authz_1.resolveUserAuthorisation)(next);
        if (membershipBlocks) {
            acquireEntitlementOwner(tx, owner, uid, membershipRef.id);
        }
        else {
            // Keep a released generation as a tombstone. Otherwise a later webhook
            // for this same ended subscription would see no owner and could replay
            // the old entitlement restoration over a newer membership/manual grant.
            tx.set(owner.ref, {
                schemaVersion: membershipPlans_1.MEMBERSHIP_SCHEMA_VERSION,
                subscriptionId: membershipRef.id,
                userIdHash: sha256(uid),
                state: "released",
                releasedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            }, { merge: true });
        }
        tx.set(userRef, Object.assign(Object.assign(Object.assign(Object.assign({}, next), { entitlementPlanKey: nextPlanKey !== null && nextPlanKey !== void 0 ? nextPlanKey : firestore_1.FieldValue.delete(), entitlementClassSlots: access.entitlementPolicyAppAccessTier === "limited" ?
                access.entitlementPolicyClassSlots : firestore_1.FieldValue.delete(), entitlementWeeklyBookingLimit: access.entitlementPolicyWeeklyBookingLimit, appAccessTier: access.entitlementPolicyAppAccessTier, alphaWodAccess: access.alphaWodAccess, accessSchemaVersion: authz_1.ACCESS_SCHEMA_VERSION, entitlementReason: decision.reason, entitlementUpdatedAt: serverTimestamp(), entitlementUpdatedBy: "stripe_membership" }), (approvalStatus === "approved" && user.approvalStatus !== "approved" ?
            { approvedAt: serverTimestamp(), approvedBy: "stripe_membership" } :
            {})), { updatedAt: serverTimestamp() }), { merge: true });
        tx.set(membershipRef, {
            preMembershipEntitlement: preMembership,
            entitlementProjectionStatus: "applied",
            entitlementProjectionError: firestore_1.FieldValue.delete(),
            updatedAt: serverTimestamp(),
        }, { merge: true });
        return { convergeUid: uid, reviewReason: null, reviewUidHash: null };
    });
    if (outcome === null || outcome === void 0 ? void 0 : outcome.reviewReason) {
        console.error("CRITICAL_BILLING_ENTITLEMENT_PROJECTION_REVIEW", {
            subscriptionId: membershipRef.id,
            targetUidHash: outcome.reviewUidHash,
            reason: outcome.reviewReason,
        });
        await writeAudit({
            type: "entitlement_projection_manual_review",
            severity: "critical",
            subscriptionId: membershipRef.id,
            targetUidHash: outcome.reviewUidHash,
            reason: outcome.reviewReason,
        }).catch((error) => console.error("Could not write entitlement projection audit", membershipRef.id, error));
    }
    if (outcome === null || outcome === void 0 ? void 0 : outcome.convergeUid)
        await converge(outcome.convergeUid);
}
/** ---------------------------------------------------------------
 * Subscription convergence
 * -------------------------------------------------------------- */
function resolveCurrentPeriodEnd(subscription) {
    var _a, _b;
    // Recent Stripe API versions expose the period on the subscription item.
    const item = (_b = (_a = subscription.items) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b[0];
    if (typeof (item === null || item === void 0 ? void 0 : item.current_period_end) === "number")
        return item.current_period_end;
    const legacy = subscription.current_period_end;
    return typeof legacy === "number" ? legacy : null;
}
const MEMBERSHIP_CONVERGENCE_LEASE_MS = 2 * 60 * 1000;
// One Stripe request may use the configured 20-second timeout three times
// (the initial request plus two network retries). Leave headroom for retry
// backoff while staying below the two-minute Firestore lease.
const ELIGIBILITY_CONVERGENCE_CONTENTION_WAIT_MS = 75 * 1000;
const ELIGIBILITY_CONVERGENCE_CONTENTION_MAX_BACKOFF_MS = 250;
// Eligibility-aware callables may wait behind that lease and then still need
// further provider reads or a Checkout create. Override Firebase's 60-second
// default so the platform cannot terminate the intended bounded path first.
const MEMBERSHIP_INTERACTIVE_TIMEOUT_SECONDS = 540;
const SUSPENDED_RECONCILE_INTERVAL_MS = 15 * 60 * 1000;
class MembershipConvergenceInProgressError extends Error {
    constructor(subscriptionId, leaseToken, leaseExpiresAtMillis) {
        super(`Membership ${subscriptionId} is already converging.`);
        this.leaseToken = leaseToken;
        this.leaseExpiresAtMillis = leaseExpiresAtMillis;
        this.name = "MembershipConvergenceInProgressError";
    }
}
function subscriptionLineEvidence(invoice) {
    var _a, _b;
    return ((_b = (_a = invoice.lines) === null || _a === void 0 ? void 0 : _a.data) !== null && _b !== void 0 ? _b : []).flatMap((line) => {
        var _a, _b, _c, _d, _e, _f;
        const details = (_a = line.parent) === null || _a === void 0 ? void 0 : _a.subscription_item_details;
        const subscriptionId = (_b = details === null || details === void 0 ? void 0 : details.subscription) !== null && _b !== void 0 ? _b : idOf(line.subscription);
        const priceId = idOf((_d = (_c = line.pricing) === null || _c === void 0 ? void 0 : _c.price_details) === null || _d === void 0 ? void 0 : _d.price);
        if (((_e = line.parent) === null || _e === void 0 ? void 0 : _e.type) !== "subscription_item_details" || !details ||
            !subscriptionId || !priceId || typeof ((_f = line.period) === null || _f === void 0 ? void 0 : _f.start) !== "number") {
            return [];
        }
        return [{
                subscriptionId,
                priceId,
                periodStart: line.period.start,
                quantity: line.quantity,
                proration: details.proration,
            }];
    });
}
function isOpenDisputeStatus(status) {
    return status !== "won" && status !== "lost" &&
        status !== "warning_closed" && status !== "prevented";
}
async function acquireMembershipConvergenceLease(membershipRef, nowMillis = Date.now(), token = (0, crypto_1.randomUUID)()) {
    return db().runTransaction(async (tx) => {
        const snap = await tx.get(membershipRef);
        if (!snap.exists)
            return { state: "missing" };
        const leaseExpiresAt = timestampMillis(snap.get("convergenceLeaseExpiresAt"));
        const activeToken = snap.get("convergenceLeaseToken");
        if (typeof activeToken === "string" &&
            leaseExpiresAt !== null && leaseExpiresAt > nowMillis) {
            return {
                state: "in_progress",
                token: activeToken,
                expiresAtMillis: leaseExpiresAt,
            };
        }
        const expiresAtMillis = nowMillis + MEMBERSHIP_CONVERGENCE_LEASE_MS;
        tx.set(membershipRef, {
            convergenceLeaseToken: token,
            convergenceLeaseExpiresAt: firestore_1.Timestamp.fromMillis(expiresAtMillis),
            updatedAt: serverTimestamp(),
        }, { merge: true });
        return { state: "acquired", token, expiresAtMillis };
    });
}
async function releaseMembershipConvergenceLease(membershipRef, token) {
    await db().runTransaction(async (tx) => {
        const snap = await tx.get(membershipRef);
        if (!snap.exists || snap.get("convergenceLeaseToken") !== token)
            return;
        tx.set(membershipRef, {
            convergenceLeaseToken: firestore_1.FieldValue.delete(),
            convergenceLeaseExpiresAt: firestore_1.FieldValue.delete(),
            updatedAt: serverTimestamp(),
        }, { merge: true });
    });
}
/**
 * Re-reads the subscription from Stripe and converges the stored membership.
 *
 * Webhook payloads are never trusted as the state authority: Stripe does not
 * guarantee delivery order, so a delayed `updated` event carrying an older
 * snapshot could otherwise restore access that has since been withdrawn.
 */
async function convergeMembershipFromStripe(subscriptionId, converge, overrides = {}, nowMillis = Date.now()) {
    var _a, _b;
    // Fail before acquiring a Firestore lease: a mixed Firebase/Stripe
    // deployment must not mutate even local billing state before it is refused.
    assertBillingEnvironment();
    const membershipRef = db().collection("memberships").doc(subscriptionId);
    const lease = await acquireMembershipConvergenceLease(membershipRef);
    if (lease.state === "in_progress") {
        throw new MembershipConvergenceInProgressError(subscriptionId, lease.token, lease.expiresAtMillis);
    }
    let subscription;
    try {
        subscription = await stripe().subscriptions.retrieve(subscriptionId, {
            expand: ["discounts"],
        });
        assertStripeObjectMode("Subscription", subscription.id, subscription.livemode);
    }
    catch (error) {
        if (lease.state === "acquired") {
            await releaseMembershipConvergenceLease(membershipRef, lease.token).catch(() => undefined);
        }
        throw error;
    }
    let authoritativeActivationPayment = overrides.activationPayment;
    if (!authoritativeActivationPayment) {
        const presaleSnapshot = await membershipRef.get();
        const firstPaymentAt = presaleSnapshot.get("firstPaymentAt");
        if (presaleSnapshot.exists &&
            presaleSnapshot.get("billingMode") === "presale_deferred" &&
            presaleSnapshot.get("firstPaymentReceivedAt") == null &&
            typeof firstPaymentAt === "number" && nowMillis >= firstPaymentAt * 1000) {
            let latestInvoice = typeof subscription.latest_invoice === "string" ?
                await stripe().invoices.retrieve(subscription.latest_invoice) :
                subscription.latest_invoice;
            if (latestInvoice && typeof latestInvoice !== "string" &&
                "id" in latestInvoice) {
                latestInvoice = latestInvoice;
                if (typeof latestInvoice.livemode === "boolean") {
                    assertStripeObjectMode("Invoice", latestInvoice.id, latestInvoice.livemode);
                }
                const paidAt = (_a = latestInvoice.status_transitions) === null || _a === void 0 ? void 0 : _a.paid_at;
                if (resolveInvoiceSubscriptionId(latestInvoice) === subscriptionId &&
                    latestInvoice.status === "paid" && latestInvoice.amount_paid > 0 &&
                    typeof paidAt === "number" && typeof latestInvoice.currency === "string") {
                    authoritativeActivationPayment = {
                        invoiceId: latestInvoice.id,
                        paidAt,
                        amountPaidPence: latestInvoice.amount_paid,
                        currency: latestInvoice.currency,
                        lines: subscriptionLineEvidence(latestInvoice),
                    };
                }
            }
        }
    }
    if (lease.state === "missing") {
        // Stripe can deliver subscription/invoice/refund events before Checkout
        // completion. App-owned subscriptions must be retried after fulfilment;
        // unrelated Stripe objects are intentionally ignored.
        if ((_b = subscription.metadata) === null || _b === void 0 ? void 0 : _b.intentId) {
            throw new Error(`Membership ${subscriptionId} is waiting for Checkout intent ` +
                `${subscription.metadata.intentId} to fulfil.`);
        }
        return;
    }
    let convergenceOutcome;
    try {
        const legacyRecoverySnapshot = authoritativeActivationPayment ?
            await membershipRef.get() : null;
        const legacyPresaleDiscountRecovery = (legacyRecoverySnapshot === null || legacyRecoverySnapshot === void 0 ? void 0 : legacyRecoverySnapshot.exists) ?
            await resolveLegacyPresaleDiscountRecovery(subscription, legacyRecoverySnapshot.data()) : null;
        convergenceOutcome = await db().runTransaction(async (tx) => {
            var _a, _b, _c, _d, _e, _f, _g;
            const fresh = await tx.get(membershipRef);
            if (!fresh.exists || fresh.get("convergenceLeaseToken") !== lease.token) {
                throw new Error(`Membership ${subscriptionId} lost its convergence lease.`);
            }
            const stored = fresh.data();
            const applyLegacyPresaleDiscountRecovery = Boolean(legacyPresaleDiscountRecovery &&
                hasRecoverableLegacyPresaleDiscountGap(stored));
            const effectiveDiscount = applyLegacyPresaleDiscountRecovery ?
                legacyPresaleDiscountRecovery === null || legacyPresaleDiscountRecovery === void 0 ? void 0 : legacyPresaleDiscountRecovery.discount : stored.discount;
            const effectivePaymentSchedule = applyLegacyPresaleDiscountRecovery ?
                legacyPresaleDiscountRecovery === null || legacyPresaleDiscountRecovery === void 0 ? void 0 : legacyPresaleDiscountRecovery.paymentSchedule : stored.paymentSchedule;
            const storedEntitlementPolicy = (0, membershipPlans_1.validateCommercialEntitlementPolicy)(stored.commercialTerms, stored.planKey);
            const expectsLegacyConditioningSlots = stored.planKey === "adult_conditioning" &&
                Boolean(storedEntitlementPolicy) &&
                !(storedEntitlementPolicy === null || storedEntitlementPolicy === void 0 ? void 0 : storedEntitlementPolicy.conditioningBookingPolicy);
            const storedLegacySlots = expectsLegacyConditioningSlots ?
                (0, authz_1.canonicalConditioningSlots)(stored.selectedConditioningSlots) : null;
            const storedLegacyPolicyMismatch = expectsLegacyConditioningSlots &&
                (!storedLegacySlots || JSON.stringify(storedLegacySlots) !==
                    JSON.stringify(storedEntitlementPolicy === null || storedEntitlementPolicy === void 0 ? void 0 : storedEntitlementPolicy.entitlementClassSlots));
            const currentContractMismatch = !storedEntitlementPolicy ||
                storedLegacyPolicyMismatch ?
                `Membership ${stored.subscriptionId} has an invalid commercial entitlement policy.` :
                stripeSubscriptionContractMismatch(subscription, Object.assign(Object.assign(Object.assign(Object.assign({ planKey: stored.planKey, stripePriceId: stored.stripePriceId, stripeCustomerId: stored.stripeCustomerId, billingCycleAnchor: stored.billingCycleAnchor }, (stored.schemaVersion >= membershipPlans_1.MEMBERSHIP_SCHEMA_VERSION ? {
                    appAccessTier: (_b = (_a = stored.commercialTerms) === null || _a === void 0 ? void 0 : _a.appAccessTier) !== null && _b !== void 0 ? _b : (0, membershipPlans_1.getPlan)(stored.planKey).appAccessTier,
                } : {})), (Number.isSafeInteger(stored.participantCount) ? {
                    participantCount: stored.participantCount,
                } : {})), (stored.planKey === "adult_conditioning" &&
                    storedEntitlementPolicy.conditioningBookingPolicy ? {
                    conditioningBookingPolicy: storedEntitlementPolicy.conditioningBookingPolicy,
                } : stored.planKey === "adult_conditioning" ? {
                    selectedConditioningSlots: storedLegacySlots || undefined,
                } : {})), (stored.schemaVersion >= 2 ||
                    applyLegacyPresaleDiscountRecovery ? {
                    discountCouponId: (_c = effectiveDiscount === null || effectiveDiscount === void 0 ? void 0 : effectiveDiscount.couponId) !== null && _c !== void 0 ? _c : null,
                } : {})));
            const providerNeedsManualReview = Boolean(currentContractMismatch);
            const openDisputeIds = Array.isArray(stored.openDisputeIds) ?
                [...new Set(stored.openDisputeIds.filter((id) => typeof id === "string"))] : [];
            if (overrides.dispute) {
                const index = openDisputeIds.indexOf(overrides.dispute.id);
                if (isOpenDisputeStatus(overrides.dispute.status) && index < 0) {
                    openDisputeIds.push(overrides.dispute.id);
                }
                else if (!isOpenDisputeStatus(overrides.dispute.status) && index >= 0) {
                    openDisputeIds.splice(index, 1);
                }
            }
            const disputeOpen = overrides.dispute ?
                openDisputeIds.length > 0 :
                openDisputeIds.length > 0 || stored.disputeOpen === true;
            // A full refund or lost dispute is irreversible automatically. Support
            // can correct an exceptional case explicitly, but a delayed event can
            // never clear revocation and restore access.
            const accessRevoked = stored.accessRevoked === true ||
                overrides.accessRevoked === true || ((_d = overrides.dispute) === null || _d === void 0 ? void 0 : _d.status) === "lost";
            let firstPaymentReceivedAt = typeof stored.firstPaymentReceivedAt === "number" ?
                stored.firstPaymentReceivedAt : null;
            let firstPaidInvoiceId = typeof stored.firstPaidInvoiceId === "string" ?
                stored.firstPaidInvoiceId : null;
            const activationPayment = authoritativeActivationPayment;
            if (stored.billingMode === "presale_deferred" && activationPayment) {
                const matchingLines = activationPayment.lines.filter((line) => line.subscriptionId === subscriptionId &&
                    line.priceId === stored.stripePriceId &&
                    line.quantity === participantCountFor(stored) && line.proration === false);
                if (matchingLines.length !== 1) {
                    throw new Error(`Invoice ${activationPayment.invoiceId} has no unique approved membership line.`);
                }
                const [membershipLine] = matchingLines;
                if (activationPayment.paidAt < stored.firstPaymentAt ||
                    membershipLine.periodStart < stored.firstPaymentAt ||
                    activationPayment.amountPaidPence <= 0 ||
                    activationPayment.currency !== "gbp") {
                    throw new Error(`Invoice ${activationPayment.invoiceId} is not an approved recurring payment.`);
                }
                const discountedPeriod = Boolean(effectiveDiscount) && ((effectiveDiscount === null || effectiveDiscount === void 0 ? void 0 : effectiveDiscount.duration) === "forever" ||
                    (typeof (effectivePaymentSchedule === null || effectivePaymentSchedule === void 0 ? void 0 : effectivePaymentSchedule.fullPriceFrom) === "number" &&
                        membershipLine.periodStart < effectivePaymentSchedule.fullPriceFrom));
                const expectedAmount = discountedPeriod ?
                    effectivePaymentSchedule === null || effectivePaymentSchedule === void 0 ? void 0 : effectivePaymentSchedule.discountedMonthlyPence :
                    ((_e = effectivePaymentSchedule === null || effectivePaymentSchedule === void 0 ? void 0 : effectivePaymentSchedule.standardMonthlyPence) !== null && _e !== void 0 ? _e : (0, membershipPlans_1.getPlan)(stored.planKey).amountPence);
                if (typeof expectedAmount !== "number" ||
                    activationPayment.amountPaidPence !== expectedAmount) {
                    throw new Error(`Invoice ${activationPayment.invoiceId} paid an unexpected first-payment amount.`);
                }
                if (firstPaymentReceivedAt === null ||
                    activationPayment.paidAt < firstPaymentReceivedAt) {
                    firstPaymentReceivedAt = activationPayment.paidAt;
                    firstPaidInvoiceId = activationPayment.invoiceId;
                }
            }
            let pastDueSince = null;
            if (subscription.status === "past_due") {
                const detectedAt = Math.floor(nowMillis / 1000);
                const incoming = typeof overrides.pastDueSince === "number" ?
                    overrides.pastDueSince : null;
                const storedFailure = typeof stored.pastDueSince === "number" ?
                    stored.pastDueSince : null;
                const candidates = [incoming, storedFailure].filter((value) => value !== null);
                pastDueSince = candidates.length > 0 ? Math.min(...candidates) : detectedAt;
            }
            const graceEndMillis = (0, membershipPlans_1.resolvePastDueGraceEndMillis)(pastDueSince);
            const pastDueGraceEndsAt = graceEndMillis === null ?
                null : firestore_1.Timestamp.fromMillis(graceEndMillis);
            let state = (0, membershipPlans_1.resolveMembershipState)({
                stripeStatus: subscription.status,
                pastDueSinceUnixSeconds: pastDueSince,
                disputeOpen,
                accessRevoked,
                cancelAtUnixSeconds: subscription.cancel_at,
                serviceStartsAtUnixSeconds: stored.serviceStartsAt,
                activationPendingFirstPayment: stored.billingMode === "presale_deferred" && firstPaymentReceivedAt === null,
            }, nowMillis);
            if (stored.billingMode === "presale_deferred" &&
                firstPaymentReceivedAt === null && state === "past_due_grace") {
                // Past-due grace preserves already-earned access. A founding presale
                // has no earned access until its first recurring invoice is paid.
                state = "past_due_suspended";
            }
            const nextReconcileAt = state === "scheduled" ?
                firestore_1.Timestamp.fromMillis(Math.max(stored.firstPaymentAt * 1000, nowMillis + SUSPENDED_RECONCILE_INTERVAL_MS)) : state === "past_due_grace" ?
                pastDueGraceEndsAt : state === "past_due_suspended" ?
                firestore_1.Timestamp.fromMillis(nowMillis + SUSPENDED_RECONCILE_INTERVAL_MS) : null;
            const pendingCancellation = stored.cancellationRequest;
            const authoritativeCancelAt = authoritativeSubscriptionCancellationEnd(subscription);
            let projectedCancelAt = authoritativeCancelAt;
            let settledCancellation = null;
            let cancellationDrift = null;
            let cancellationUpdate = {};
            const validRequest = typeof (pendingCancellation === null || pendingCancellation === void 0 ? void 0 : pendingCancellation.id) === "string" &&
                pendingCancellation.receivedAt instanceof firestore_1.Timestamp &&
                typeof ((_f = pendingCancellation.outcome) === null || _f === void 0 ? void 0 : _f.cancelAtUnixSeconds) === "number";
            const successfulPresaleWithdrawal = validRequest &&
                pendingCancellation.kind === "presale_withdrawal" &&
                subscription.status === "canceled" && authoritativeCancelAt !== null &&
                pendingCancellation.receivedAt.toMillis() < stored.serviceStartsAt * 1000 &&
                authoritativeCancelAt < stored.firstPaymentAt &&
                stored.firstPaymentReceivedAt === null;
            const successfulCoolingOffCancellation = validRequest &&
                pendingCancellation.kind === "cooling_off" &&
                typeof pendingCancellation.receiptId === "string" &&
                subscription.status === "canceled" && authoritativeCancelAt !== null;
            if (stored.cancellationOutcome) {
                const promisedCancelAt = stored.cancellationOutcome.cancelAtUnixSeconds;
                if (successfulCoolingOffCancellation) {
                    // Stripe normally records `ended_at` a little after the notice was
                    // received. That provider completion time must not replace, delay,
                    // or invalidate the immutable cooling-off effective/access stop.
                    projectedCancelAt = promisedCancelAt;
                    cancellationUpdate = {
                        cancellationOutcome: stored.cancellationOutcome,
                        cancellationRequest: Object.assign(Object.assign({}, pendingCancellation), { status: "applied", outcome: stored.cancellationOutcome, stripeCancelAt: authoritativeCancelAt, providerEndedAtMillis: authoritativeCancelAt * 1000, nextAttemptAt: firestore_1.FieldValue.delete(), leaseToken: firestore_1.FieldValue.delete(), leaseExpiresAt: firestore_1.FieldValue.delete(), lastError: firestore_1.FieldValue.delete() }),
                    };
                }
                else if (successfulPresaleWithdrawal) {
                    projectedCancelAt = authoritativeCancelAt;
                    cancellationUpdate = {
                        cancellationOutcome: stored.cancellationOutcome,
                        cancellationRequest: Object.assign(Object.assign({}, pendingCancellation), { status: "applied", outcome: stored.cancellationOutcome, stripeCancelAt: authoritativeCancelAt, nextAttemptAt: firestore_1.FieldValue.delete(), leaseToken: firestore_1.FieldValue.delete(), leaseExpiresAt: firestore_1.FieldValue.delete(), lastError: firestore_1.FieldValue.delete() }),
                    };
                }
                else if (authoritativeCancelAt !== null &&
                    authoritativeCancelAt <= promisedCancelAt) {
                    const aligned = alignCancellationOutcome(stored.cancellationOutcome, authoritativeCancelAt);
                    projectedCancelAt = authoritativeCancelAt;
                    cancellationUpdate = Object.assign({ cancellationOutcome: aligned }, (validRequest ? {
                        cancellationRequest: Object.assign(Object.assign({}, pendingCancellation), { status: "applied", outcome: aligned, stripeCancelAt: authoritativeCancelAt, nextAttemptAt: firestore_1.FieldValue.delete(), leaseToken: firestore_1.FieldValue.delete(), leaseExpiresAt: firestore_1.FieldValue.delete(), lastError: firestore_1.FieldValue.delete() }),
                    } : {}));
                }
                else if (subscription.status === "canceled" &&
                    authoritativeCancelAt !== null &&
                    promisedCancelAt <= Math.floor(nowMillis / 1000)) {
                    const reason = "Stripe ended this subscription after the cancellation date promised to the member. " +
                        "Review charges after that date and issue any required refund.";
                    projectedCancelAt = promisedCancelAt;
                    cancellationDrift = {
                        requestId: validRequest ? pendingCancellation.id : `repair-${subscriptionId}`,
                        reason,
                        repairQueued: false,
                    };
                    cancellationUpdate = Object.assign({ cancellationOutcome: stored.cancellationOutcome }, (validRequest ? {
                        cancellationRequest: Object.assign(Object.assign({}, pendingCancellation), { status: "manual_review", outcome: stored.cancellationOutcome, stripeCancelAt: authoritativeCancelAt, lastError: reason, manualReviewAt: serverTimestamp(), nextAttemptAt: firestore_1.FieldValue.delete(), leaseToken: firestore_1.FieldValue.delete(), leaseExpiresAt: firestore_1.FieldValue.delete() }),
                    } : {}));
                }
                else {
                    const repairQueued = subscription.status !== "canceled";
                    const requestId = validRequest ?
                        pendingCancellation.id : `repair-${subscriptionId}`;
                    const repairGeneration = typeof (pendingCancellation === null || pendingCancellation === void 0 ? void 0 : pendingCancellation.repairGeneration) === "number" ?
                        pendingCancellation.repairGeneration : 0;
                    const reason = authoritativeCancelAt === null ?
                        "Stripe no longer has the confirmed cancellation schedule." :
                        "Stripe has a later cancellation schedule than the member confirmed.";
                    projectedCancelAt = promisedCancelAt;
                    cancellationDrift = { requestId, reason, repairQueued };
                    cancellationUpdate = {
                        cancellationOutcome: null,
                        cancellationRequest: Object.assign(Object.assign(Object.assign(Object.assign({}, (pendingCancellation !== null && pendingCancellation !== void 0 ? pendingCancellation : {})), { id: requestId, status: repairQueued ? "pending" : "manual_review", receivedAt: validRequest ? pendingCancellation.receivedAt :
                                (stored.cancellationRequestedAt instanceof firestore_1.Timestamp ?
                                    stored.cancellationRequestedAt :
                                    firestore_1.Timestamp.fromMillis(nowMillis)), outcome: stored.cancellationOutcome, repairGeneration: (pendingCancellation === null || pendingCancellation === void 0 ? void 0 : pendingCancellation.status) === "pending" ?
                                repairGeneration : repairGeneration + 1, recoveryStartedAt: (pendingCancellation === null || pendingCancellation === void 0 ? void 0 : pendingCancellation.status) === "pending" &&
                                pendingCancellation.recoveryStartedAt instanceof firestore_1.Timestamp ?
                                pendingCancellation.recoveryStartedAt :
                                firestore_1.Timestamp.fromMillis(nowMillis), attemptCount: (pendingCancellation === null || pendingCancellation === void 0 ? void 0 : pendingCancellation.status) === "pending" ?
                                ((_g = pendingCancellation.attemptCount) !== null && _g !== void 0 ? _g : 0) : 0, lastError: reason }), (repairQueued ? {
                            nextAttemptAt: firestore_1.Timestamp.fromMillis(nowMillis),
                        } : {
                            nextAttemptAt: firestore_1.FieldValue.delete(),
                            manualReviewAt: serverTimestamp(),
                        })), { leaseToken: firestore_1.FieldValue.delete(), leaseExpiresAt: firestore_1.FieldValue.delete() }),
                    };
                }
            }
            else if (successfulCoolingOffCancellation) {
                settledCancellation = {
                    requestId: pendingCancellation.id,
                    payerUid: stored.payerUid,
                    outcome: pendingCancellation.outcome,
                };
                projectedCancelAt = pendingCancellation.outcome.cancelAtUnixSeconds;
                cancellationUpdate = {
                    cancellationRequestedAt: pendingCancellation.receivedAt,
                    cancellationOutcome: settledCancellation.outcome,
                    cancellationRequest: Object.assign(Object.assign({}, pendingCancellation), { status: "applied", outcome: settledCancellation.outcome, stripeCancelAt: authoritativeCancelAt, providerEndedAtMillis: authoritativeCancelAt * 1000, appliedAt: serverTimestamp(), nextAttemptAt: firestore_1.FieldValue.delete(), leaseToken: firestore_1.FieldValue.delete(), leaseExpiresAt: firestore_1.FieldValue.delete(), lastError: firestore_1.FieldValue.delete() }),
                };
            }
            else if (successfulPresaleWithdrawal) {
                settledCancellation = {
                    requestId: pendingCancellation.id,
                    payerUid: stored.payerUid,
                    outcome: pendingCancellation.outcome,
                };
                projectedCancelAt = authoritativeCancelAt;
                cancellationUpdate = {
                    cancellationRequestedAt: pendingCancellation.receivedAt,
                    cancellationOutcome: settledCancellation.outcome,
                    cancellationRequest: Object.assign(Object.assign({}, pendingCancellation), { status: "applied", outcome: settledCancellation.outcome, stripeCancelAt: authoritativeCancelAt, appliedAt: serverTimestamp(), nextAttemptAt: firestore_1.FieldValue.delete(), leaseToken: firestore_1.FieldValue.delete(), leaseExpiresAt: firestore_1.FieldValue.delete(), lastError: firestore_1.FieldValue.delete() }),
                };
            }
            else if (((pendingCancellation === null || pendingCancellation === void 0 ? void 0 : pendingCancellation.status) === "pending" ||
                (pendingCancellation === null || pendingCancellation === void 0 ? void 0 : pendingCancellation.status) === "manual_review") && validRequest &&
                authoritativeCancelAt !== null &&
                authoritativeCancelAt <= pendingCancellation.outcome.cancelAtUnixSeconds) {
                settledCancellation = {
                    requestId: pendingCancellation.id,
                    payerUid: stored.payerUid,
                    outcome: alignCancellationOutcome(pendingCancellation.outcome, authoritativeCancelAt),
                };
                projectedCancelAt = authoritativeCancelAt;
                cancellationUpdate = {
                    cancellationRequestedAt: pendingCancellation.receivedAt,
                    cancellationOutcome: settledCancellation.outcome,
                    cancellationRequest: Object.assign(Object.assign({}, pendingCancellation), { status: "applied", outcome: settledCancellation.outcome, stripeCancelAt: authoritativeCancelAt, appliedAt: serverTimestamp(), nextAttemptAt: firestore_1.FieldValue.delete(), leaseToken: firestore_1.FieldValue.delete(), leaseExpiresAt: firestore_1.FieldValue.delete(), lastError: firestore_1.FieldValue.delete() }),
                };
            }
            else if (validRequest && subscription.status === "canceled" &&
                authoritativeCancelAt !== null &&
                authoritativeCancelAt > pendingCancellation.outcome.cancelAtUnixSeconds &&
                pendingCancellation.outcome.cancelAtUnixSeconds <= Math.floor(nowMillis / 1000)) {
                const reason = "Stripe ended this subscription after the cancellation date promised to the member. " +
                    "Review charges after that date and issue any required refund.";
                projectedCancelAt = pendingCancellation.outcome.cancelAtUnixSeconds;
                cancellationDrift = {
                    requestId: pendingCancellation.id,
                    reason,
                    repairQueued: false,
                };
                cancellationUpdate = {
                    cancellationRequestedAt: pendingCancellation.receivedAt,
                    cancellationOutcome: pendingCancellation.outcome,
                    cancellationRequest: Object.assign(Object.assign({}, pendingCancellation), { status: "manual_review", stripeCancelAt: authoritativeCancelAt, lastError: reason, manualReviewAt: serverTimestamp(), nextAttemptAt: firestore_1.FieldValue.delete(), leaseToken: firestore_1.FieldValue.delete(), leaseExpiresAt: firestore_1.FieldValue.delete() }),
                };
            }
            else if (!stored.cancellationOutcome && validRequest &&
                subscription.status === "canceled" && authoritativeCancelAt === null) {
                const reason = "Stripe canceled the subscription without an authoritative end time.";
                cancellationDrift = {
                    requestId: pendingCancellation.id,
                    reason,
                    repairQueued: false,
                };
                cancellationUpdate = {
                    cancellationRequest: Object.assign(Object.assign({}, pendingCancellation), { status: "manual_review", lastError: reason, manualReviewAt: serverTimestamp(), nextAttemptAt: firestore_1.FieldValue.delete(), leaseToken: firestore_1.FieldValue.delete(), leaseExpiresAt: firestore_1.FieldValue.delete() }),
                };
            }
            tx.set(membershipRef, Object.assign(Object.assign(Object.assign(Object.assign({ state, stripeStatus: subscription.status, firstPaymentReceivedAt,
                firstPaidInvoiceId }, (applyLegacyPresaleDiscountRecovery ? {
                discount: legacyPresaleDiscountRecovery === null || legacyPresaleDiscountRecovery === void 0 ? void 0 : legacyPresaleDiscountRecovery.discount,
                paymentSchedule: legacyPresaleDiscountRecovery === null || legacyPresaleDiscountRecovery === void 0 ? void 0 : legacyPresaleDiscountRecovery.paymentSchedule,
                legacyPresaleDiscountRecoveryVersion: 1,
                legacyPresaleDiscountRecoveredAt: serverTimestamp(),
            } : {})), { currentPeriodEnd: resolveCurrentPeriodEnd(subscription), cancelAt: projectedCancelAt, openDisputeIds,
                disputeOpen,
                accessRevoked, providerContractStatus: providerNeedsManualReview ?
                    "manual_review" : "verified", providerContractError: currentContractMismatch !== null && currentContractMismatch !== void 0 ? currentContractMismatch : firestore_1.FieldValue.delete(), pastDueSince,
                pastDueGraceEndsAt,
                nextReconcileAt }), cancellationUpdate), { 
                // This marker and the authoritative membership projection commit in
                // the same transaction. A waiter can therefore accept this exact
                // lease's result without issuing a second Stripe read. A failed lease
                // is merely released and never writes a completion token.
                convergenceCompletedLeaseToken: lease.token, convergenceCompletedAt: serverTimestamp(), convergenceLeaseToken: firestore_1.FieldValue.delete(), convergenceLeaseExpiresAt: firestore_1.FieldValue.delete(), updatedAt: serverTimestamp() }), { merge: true });
            if (applyLegacyPresaleDiscountRecovery && activationPayment) {
                tx.set(db().collection("membershipAudit").doc(`legacy-presale-discount-recovery-${activationPayment.invoiceId}`), {
                    type: "legacy_presale_discount_recovered",
                    subscriptionId,
                    invoiceId: activationPayment.invoiceId,
                    recoveryVersion: 1,
                    createdAt: serverTimestamp(),
                }, { merge: false });
            }
            return {
                state,
                disputeOpen,
                accessRevoked,
                settledCancellation,
                cancellationDrift,
                providerContractError: currentContractMismatch,
            };
        });
    }
    catch (error) {
        await releaseMembershipConvergenceLease(membershipRef, lease.token).catch(() => undefined);
        throw error;
    }
    await applyMembershipEntitlement(membershipRef, converge);
    await writeAudit({
        type: "membership_converged",
        subscriptionId,
        state: convergenceOutcome.state,
        stripeStatus: subscription.status,
        disputeOpen: convergenceOutcome.disputeOpen,
        accessRevoked: convergenceOutcome.accessRevoked,
    });
    if (convergenceOutcome.providerContractError) {
        console.error("CRITICAL_BILLING_PROVIDER_CONTRACT_MISMATCH", {
            subscriptionId,
            error: convergenceOutcome.providerContractError,
        });
        await writeAudit({
            type: "provider_contract_mismatch",
            severity: "critical",
            subscriptionId,
            error: convergenceOutcome.providerContractError,
        });
    }
    if (convergenceOutcome.settledCancellation) {
        await writeAudit({
            type: "cancellation_requested",
            subscriptionId,
            payerUid: convergenceOutcome.settledCancellation.payerUid,
            requestId: convergenceOutcome.settledCancellation.requestId,
            outcome: convergenceOutcome.settledCancellation.outcome,
            settledBy: "stripe_convergence",
        });
    }
    if (convergenceOutcome.cancellationDrift) {
        console.error("CRITICAL_BILLING_CANCELLATION_DRIFT", Object.assign({ subscriptionId }, convergenceOutcome.cancellationDrift));
        await writeAudit(Object.assign({ type: "cancellation_schedule_drift", severity: "critical", subscriptionId }, convergenceOutcome.cancellationDrift));
    }
}
const AUTHORITATIVE_ELIGIBILITY_UNAVAILABLE = "Current membership status could not be verified with Stripe. No new purchase, claim or link was made. Try again later.";
async function waitForMembershipConvergenceCompletion(subscriptionId, collision, options = {}) {
    var _a, _b, _c;
    const membershipRef = db().collection("memberships").doc(subscriptionId);
    const waitMs = (_a = options.waitMs) !== null && _a !== void 0 ? _a : ELIGIBILITY_CONVERGENCE_CONTENTION_WAIT_MS;
    const deadlineMillis = Math.min(Date.now() + Math.max(0, waitMs), collision.leaseExpiresAtMillis);
    let backoffMs = Math.max(1, (_b = options.initialBackoffMs) !== null && _b !== void 0 ? _b : 25);
    const maxBackoffMs = Math.max(backoffMs, (_c = options.maxBackoffMs) !== null && _c !== void 0 ? _c : ELIGIBILITY_CONVERGENCE_CONTENTION_MAX_BACKOFF_MS);
    for (;;) {
        const snapshot = await membershipRef.get();
        if (!snapshot.exists) {
            throw new Error(`Membership ${subscriptionId} disappeared during convergence contention.`);
        }
        if (snapshot.get("convergenceCompletedLeaseToken") ===
            collision.leaseToken) {
            return;
        }
        const activeToken = snapshot.get("convergenceLeaseToken");
        const activeExpiresAtMillis = timestampMillis(snapshot.get("convergenceLeaseExpiresAt"));
        if (activeToken !== collision.leaseToken ||
            activeExpiresAtMillis !== collision.leaseExpiresAtMillis) {
            throw new Error(`Membership ${subscriptionId} released its convergence lease ` +
                "without completing it.");
        }
        const nowMillis = Date.now();
        if (nowMillis >= deadlineMillis || nowMillis >= activeExpiresAtMillis) {
            throw new Error(`Membership ${subscriptionId} convergence did not complete before ` +
                "its contention deadline.");
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(backoffMs, deadlineMillis - nowMillis)));
        backoffMs = Math.min(backoffMs * 2, maxBackoffMs);
    }
}
/**
 * Serialises eligibility reads behind a concurrent authoritative convergence.
 * A lease collision is local contention, not evidence that Stripe is
 * unavailable. The waiter accepts only the exact colliding lease's committed
 * completion marker, so it does not amplify Stripe traffic and cannot mistake
 * a failed, expired or replacement lease for authoritative success.
 */
async function convergeEligibilityMembershipFromStripe(subscriptionId, converge, contentionOptions = {}) {
    try {
        await convergeMembershipFromStripe(subscriptionId, converge);
    }
    catch (error) {
        if (!(error instanceof MembershipConvergenceInProgressError))
            throw error;
        await waitForMembershipConvergenceCompletion(subscriptionId, error, contentionOptions);
    }
}
/**
 * Converges every stored subscription that can affect a state-sensitive
 * eligibility decision. A local terminal state is not proof that Stripe has
 * stopped billing: delayed/dead-lettered lifecycle events must therefore be
 * healed before the final Firestore transaction is allowed to decide.
 */
async function convergeEligibilityMemberships(snapshots, converge, context) {
    const memberships = new Map();
    snapshots.forEach((snapshot) => {
        if (snapshot.exists)
            memberships.set(snapshot.id, snapshot);
    });
    for (const snapshot of [...memberships.values()].sort((left, right) => left.id.localeCompare(right.id))) {
        const storedSubscriptionId = snapshot.get("subscriptionId");
        if (storedSubscriptionId !== snapshot.id) {
            console.error("CRITICAL_BILLING_ELIGIBILITY_STATE_UNCERTAIN", {
                context,
                subscriptionId: snapshot.id,
                reason: "subscription_id_mismatch",
            });
            await writeAudit({
                type: "membership_eligibility_state_uncertain",
                severity: "critical",
                context,
                subscriptionId: snapshot.id,
                reason: "subscription_id_mismatch",
            }).catch((error) => console.error("Could not write eligibility-state audit", snapshot.id, error));
            throw new https_1.HttpsError("unavailable", AUTHORITATIVE_ELIGIBILITY_UNAVAILABLE, { reason: "membership_state_unavailable" });
        }
        try {
            await convergeEligibilityMembershipFromStripe(snapshot.id, converge);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error("CRITICAL_BILLING_ELIGIBILITY_STATE_UNCERTAIN", {
                context,
                subscriptionId: snapshot.id,
                reason: message.slice(0, 500),
            });
            await writeAudit({
                type: "membership_eligibility_state_uncertain",
                severity: "critical",
                context,
                subscriptionId: snapshot.id,
                reason: message.slice(0, 500),
            }).catch((auditError) => console.error("Could not write eligibility-state audit", snapshot.id, auditError));
            throw new https_1.HttpsError("unavailable", AUTHORITATIVE_ELIGIBILITY_UNAVAILABLE, { reason: "membership_state_unavailable" });
        }
    }
    return new Set(memberships.keys());
}
/** Existing AlphaWOD memberships that can block a grant to this account. */
async function alphaWodMembershipsForAccount(userId) {
    const [byPayer, byTarget] = await Promise.all([
        db().collection("memberships").where("payerUid", "==", userId).get(),
        db().collection("memberships").where("entitlementTargetUid", "==", userId).get(),
    ]);
    const relevant = new Map();
    [...byPayer.docs, ...byTarget.docs].forEach((snapshot) => {
        if (snapshot.get("grantsAlphaWodAccess") === true) {
            relevant.set(snapshot.id, snapshot);
        }
    });
    const owner = await entitlementOwnerRef(userId).get();
    if (owner.exists && owner.get("state") !== "released") {
        const ownerSubscriptionId = owner.get("subscriptionId");
        if (typeof ownerSubscriptionId !== "string" || !ownerSubscriptionId) {
            console.error("CRITICAL_BILLING_ELIGIBILITY_STATE_UNCERTAIN", {
                context: "entitlement_owner",
                targetUidHash: sha256(userId),
                reason: "invalid_active_owner",
            });
            throw new https_1.HttpsError("unavailable", AUTHORITATIVE_ELIGIBILITY_UNAVAILABLE, { reason: "membership_state_unavailable" });
        }
        if (!relevant.has(ownerSubscriptionId)) {
            const ownerMembership = await db().collection("memberships")
                .doc(ownerSubscriptionId).get();
            if (!ownerMembership.exists) {
                console.error("CRITICAL_BILLING_ELIGIBILITY_STATE_UNCERTAIN", {
                    context: "entitlement_owner",
                    subscriptionId: ownerSubscriptionId,
                    targetUidHash: sha256(userId),
                    reason: "active_owner_membership_missing",
                });
                throw new https_1.HttpsError("unavailable", AUTHORITATIVE_ELIGIBILITY_UNAVAILABLE, { reason: "membership_state_unavailable" });
            }
            relevant.set(ownerMembership.id, ownerMembership);
        }
    }
    return [...relevant.values()];
}
function assertEligibilityDocsWereConverged(snapshots, convergedMembershipIds) {
    const unconverged = snapshots.find((snapshot) => !convergedMembershipIds.has(snapshot.id));
    if (unconverged) {
        console.error("CRITICAL_BILLING_ELIGIBILITY_NEW_MEMBERSHIP_RACE", {
            subscriptionId: unconverged.id,
        });
        throw new https_1.HttpsError("unavailable", AUTHORITATIVE_ELIGIBILITY_UNAVAILABLE, { reason: "membership_state_changed" });
    }
}
/**
 * Reconciles every stored membership considered by a new checkout's duplicate
 * guard. The following reservation transaction performs the final re-read, so
 * concurrent local claims/links/checkouts still contend atomically.
 */
async function convergeCheckoutDuplicateScope(participants, participantKeys, payerUid, grantsAlphaWodAccess, converge) {
    const participantSnaps = await Promise.all(participantMembershipQueries(participantKeys).map((query) => query.get()));
    const legacyParticipantSnaps = await Promise.all(legacySingularParticipantMembershipQueries(participants)
        .map((query) => query.get()));
    const byParticipant = participantMembershipDocs(participantSnaps, legacyParticipantSnaps, participants);
    const accountMemberships = payerUid && grantsAlphaWodAccess ?
        await alphaWodMembershipsForAccount(payerUid) : [];
    return convergeEligibilityMemberships([...byParticipant, ...accountMemberships], converge, "checkout_duplicate_admission");
}
/** Re-checks memberships whose activation or payment-recovery deadline is due. */
async function reconcilePastDueMembershipsOnce(converge, nowMillis = Date.now(), limit = 100) {
    assertBillingEnvironment();
    const due = await db().collection("memberships")
        .where("state", "in", ["scheduled", "past_due_grace", "past_due_suspended"])
        .where("nextReconcileAt", "<=", firestore_1.Timestamp.fromMillis(nowMillis))
        .orderBy("nextReconcileAt", "asc")
        .limit(limit)
        .get();
    const result = { processed: 0, failed: 0 };
    for (const membership of due.docs) {
        try {
            // Stripe is re-read immediately before mutation. A payment that recovered
            // just before this sweep therefore restores active state instead of being
            // suspended by a stale Firestore snapshot.
            await convergeMembershipFromStripe(membership.id, converge, {}, Math.max(nowMillis, Date.now()));
            result.processed += 1;
        }
        catch (error) {
            console.error("Past-due membership reconciliation failed", membership.id, error);
            result.failed += 1;
        }
    }
    return result;
}
function buildReconcilePastDueMemberships(converge) {
    return (0, scheduler_1.onSchedule)({
        region: REGION,
        schedule: "every 15 minutes",
        timeZone: "UTC",
        secrets: exports.MEMBERSHIP_STRIPE_WORKER_SECRETS,
        timeoutSeconds: 540,
    }, async () => {
        const result = await reconcilePastDueMembershipsOnce(converge);
        console.log("Past-due membership reconciliation result", result);
    });
}
/** ---------------------------------------------------------------
 * Callables
 * -------------------------------------------------------------- */
/**
 * App Check enforcement rejects invalid tokens before the handler. This
 * second check binds the anonymous sale to the intended web app and rejects a
 * valid token that replay protection reports as already consumed.
 */
function assertCheckoutAppCheck(request, enforce = !isFirebaseFunctionsEmulatorProcess(), expectedAppId) {
    if (!enforce)
        return;
    const configuredAppId = (expectedAppId === null || expectedAppId === void 0 ? void 0 : expectedAppId.trim()) ||
        membershipCheckoutAppId.value().trim();
    if (!configuredAppId) {
        console.error("CRITICAL_BILLING_CHECKOUT_ABUSE_CONFIGURATION", {
            reason: "missing_app_id",
        });
        throw new https_1.HttpsError("unavailable", "Checkout security is not configured. Try again later.", { reason: "checkout_security_unavailable" });
    }
    const app = request === null || request === void 0 ? void 0 : request.app;
    if ((app === null || app === void 0 ? void 0 : app.alreadyConsumed) === true) {
        console.warn("MEMBERSHIP_CHECKOUT_APP_CHECK_REPLAY", {
            reason: "already_consumed",
        });
        throw new https_1.HttpsError("permission-denied", "Checkout security verification could not be completed. Refresh and try again.", { reason: "app_check_replay" });
    }
    if (!app || app.appId !== configuredAppId) {
        console.warn("MEMBERSHIP_CHECKOUT_APP_CHECK_REJECTED", {
            reason: app ? "app_id_mismatch" : "missing_context",
        });
        throw new https_1.HttpsError("permission-denied", "Checkout security verification could not be completed. Refresh and try again.", { reason: "app_check_rejected" });
    }
}
/**
 * Bounds even malformed App-Check-verified traffic before request or Auth
 * parsing. These generous request-volume buckets are independent from the
 * stricter stable-attempt admission below, so legitimate provider/network
 * retries retain their existing idempotent allowance.
 */
async function admitEarlyCheckoutRequest(request, nowMillis = Date.now()) {
    var _a;
    try {
        const sourceHash = (0, membershipCheckoutAbuse_1.deriveCheckoutSourceHash)((_a = request === null || request === void 0 ? void 0 : request.rawRequest) === null || _a === void 0 ? void 0 : _a.ip, membershipCheckoutRateLimitSecret.value());
        await (0, membershipCheckoutAbuse_1.admitEarlyMembershipCheckoutRequest)({
            firestore: db(),
            sourceHash,
            nowMillis,
        });
    }
    catch (error) {
        if (error instanceof membershipCheckoutAbuse_1.CheckoutRateLimitExceededError) {
            console.warn("MEMBERSHIP_CHECKOUT_RATE_LIMITED", {
                stage: "pre_parse",
                windows: error.windows,
                retryAfterSeconds: error.retryAfterSeconds,
            });
            throw new https_1.HttpsError("resource-exhausted", "Too many checkout requests. Wait before trying again.", {
                reason: "checkout_rate_limited",
                retryAfterSeconds: error.retryAfterSeconds,
            });
        }
        if (error instanceof membershipCheckoutAbuse_1.CheckoutRateLimitStateError) {
            console.error("CRITICAL_BILLING_CHECKOUT_ABUSE_CONFIGURATION", {
                reason: "early_rate_limit_state_unavailable",
            });
            throw new https_1.HttpsError("unavailable", "Checkout security could not be verified. Try again later.", { reason: "checkout_security_unavailable" });
        }
        throw error;
    }
}
async function admitCheckoutRequest(input) {
    var _a, _b;
    try {
        const sourceHash = (0, membershipCheckoutAbuse_1.deriveCheckoutSourceHash)((_b = (_a = input.request) === null || _a === void 0 ? void 0 : _a.rawRequest) === null || _b === void 0 ? void 0 : _b.ip, membershipCheckoutRateLimitSecret.value());
        await (0, membershipCheckoutAbuse_1.admitMembershipCheckoutAttempt)({
            firestore: db(),
            intentRef: input.intentRef,
            checkoutAttemptHash: input.checkoutAttemptHash,
            requestFingerprint: input.requestFingerprint,
            sourceHash,
            nowMillis: input.nowMillis,
        });
    }
    catch (error) {
        if (error instanceof membershipCheckoutAbuse_1.CheckoutAttemptFingerprintMismatchError) {
            throw new https_1.HttpsError("failed-precondition", "This checkout attempt was already used with different membership details.");
        }
        if (error instanceof membershipCheckoutAbuse_1.CheckoutRateLimitExceededError) {
            console.warn("MEMBERSHIP_CHECKOUT_RATE_LIMITED", {
                windows: error.windows,
                retryAfterSeconds: error.retryAfterSeconds,
            });
            throw new https_1.HttpsError("resource-exhausted", "Too many new checkout attempts. Wait before trying again.", {
                reason: "checkout_rate_limited",
                retryAfterSeconds: error.retryAfterSeconds,
            });
        }
        if (error instanceof membershipCheckoutAbuse_1.CheckoutRateLimitStateError) {
            console.error("CRITICAL_BILLING_CHECKOUT_ABUSE_CONFIGURATION", {
                reason: "rate_limit_state_unavailable",
            });
            throw new https_1.HttpsError("unavailable", "Checkout security could not be verified. Try again later.", { reason: "checkout_security_unavailable" });
        }
        throw error;
    }
}
function buildCreateMembershipCheckoutHandler(assertPurchaseOpen, enforceAppCheck = !isFirebaseFunctionsEmulatorProcess(), converge = async () => undefined, requiredCheckoutSchemaVersion) {
    return async (request) => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4;
        assertCheckoutAppCheck(request, enforceAppCheck);
        if (requiredCheckoutSchemaVersion !== undefined &&
            ((_a = request.data) === null || _a === void 0 ? void 0 : _a.checkoutSchemaVersion) !== requiredCheckoutSchemaVersion) {
            throw new https_1.HttpsError("failed-precondition", "Refresh the membership page before starting checkout.");
        }
        if (!isFirebaseFunctionsEmulatorProcess()) {
            await admitEarlyCheckoutRequest(request);
        }
        // Membership is bought before signing in. A visitor with no account can
        // complete checkout; the purchase is attached to an account afterwards by
        // `claimMembership`. A signed-in buyer is linked immediately instead.
        const payerUid = optionalAuthUid(request);
        assertPurchaseOpen();
        const checkoutAttemptId = requireCheckoutAttemptId((_b = request.data) === null || _b === void 0 ? void 0 : _b.checkoutAttemptId);
        const checkoutAttemptHash = sha256(`membership-checkout:${checkoutAttemptId}`);
        const intentRef = db().collection("membershipIntents")
            .doc(`attempt_${checkoutAttemptHash}`);
        let payerProfileStripeCustomerId = null;
        if (payerUid) {
            const profile = await db().collection("users").doc(payerUid).get();
            if (!profile.exists) {
                const existing = await intentRef.get();
                if (existing.exists && existing.get("status") === "reserved" &&
                    !existing.get("checkoutSessionId")) {
                    await transitionCheckoutReservation(intentRef, "failed", {
                        failureKind: "missing_payer_profile",
                        failedAt: serverTimestamp(),
                    });
                }
                throw new https_1.HttpsError("failed-precondition", "Create your profile before purchasing.");
            }
            const storedStripeCustomerId = profile.get("stripeCustomerId");
            payerProfileStripeCustomerId = typeof storedStripeCustomerId === "string" &&
                storedStripeCustomerId ? storedStripeCustomerId : null;
        }
        const planKey = requirePlanKey((_c = request.data) === null || _c === void 0 ? void 0 : _c.planKey);
        requirePlanPurchaseFlowOpen(planKey);
        const plan = (0, membershipPlans_1.getPlan)(planKey);
        rejectLegacySelectedConditioningSlots((_d = request.data) === null || _d === void 0 ? void 0 : _d.selectedConditioningSlots);
        const participantName = requirePersonName((_e = request.data) === null || _e === void 0 ? void 0 : _e.participantFullName, "participantFullName");
        const dateOfBirth = requireBoundedString((_f = request.data) === null || _f === void 0 ? void 0 : _f.participantDateOfBirth, "participantDateOfBirth", 10, 10);
        const signedName = requirePersonName((_g = request.data) === null || _g === void 0 ? void 0 : _g.signedName, "signedName");
        const participantIsPayer = ((_h = request.data) === null || _h === void 0 ? void 0 : _h.participantIsPayer) === true;
        const now = Date.now();
        const billingPolicy = (0, membershipPlans_1.resolveCheckoutBillingPolicy)(now);
        const expectedBillingMode = (_j = request.data) === null || _j === void 0 ? void 0 : _j.expectedBillingMode;
        if (expectedBillingMode !== "presale_deferred" && expectedBillingMode !== "standard") {
            throw new https_1.HttpsError("invalid-argument", "expectedBillingMode must identify the billing terms shown before checkout.");
        }
        const promotionCode = normalizePromotionCode((_k = request.data) === null || _k === void 0 ? void 0 : _k.promotionCode);
        const age = (0, membershipPlans_1.resolveAgeFromDateOfBirth)(dateOfBirth, now);
        if (age === null) {
            throw new https_1.HttpsError("invalid-argument", "Enter a valid participant date of birth.");
        }
        if (!(0, membershipPlans_1.isAgeEligibleForPlan)(plan, age)) {
            throw new https_1.HttpsError("failed-precondition", `The participant's age (${age}) is not eligible for ${plan.name}.`);
        }
        if (plan.audience === "adult" && !participantIsPayer) {
            throw new https_1.HttpsError("failed-precondition", "An adult membership must be purchased by the participant for themselves.");
        }
        const rawAdditionalParticipants = (_l = request.data) === null || _l === void 0 ? void 0 : _l.additionalParticipants;
        if (plan.audience === "adult" && rawAdditionalParticipants !== undefined) {
            if (!Array.isArray(rawAdditionalParticipants) || rawAdditionalParticipants.length > 0) {
                throw new https_1.HttpsError("invalid-argument", "Additional participants are available only for youth memberships.");
            }
        }
        if (plan.audience === "youth" && rawAdditionalParticipants !== undefined &&
            !Array.isArray(rawAdditionalParticipants)) {
            throw new https_1.HttpsError("invalid-argument", "additionalParticipants must be a list of children.");
        }
        const additionalInputs = plan.audience === "youth" &&
            Array.isArray(rawAdditionalParticipants) ? rawAdditionalParticipants : [];
        if (additionalInputs.length + 1 > membershipPlans_1.YOUTH_FAMILY_OFFER.maximumParticipants) {
            throw new https_1.HttpsError("invalid-argument", `A youth checkout can include at most ${membershipPlans_1.YOUTH_FAMILY_OFFER.maximumParticipants} children.`);
        }
        const additionalParticipants = additionalInputs.map((rawParticipant, index) => {
            if (!rawParticipant || typeof rawParticipant !== "object" ||
                Array.isArray(rawParticipant)) {
                throw new https_1.HttpsError("invalid-argument", `Child ${index + 2} details are invalid.`);
            }
            const input = rawParticipant;
            const fullName = requirePersonName(input.fullName, `additionalParticipants[${index}].fullName`);
            const childDateOfBirth = requireBoundedString(input.dateOfBirth, `additionalParticipants[${index}].dateOfBirth`, 10, 10);
            const childAge = (0, membershipPlans_1.resolveAgeFromDateOfBirth)(childDateOfBirth, now);
            if (childAge === null) {
                throw new https_1.HttpsError("invalid-argument", `Enter a valid date of birth for child ${index + 2}.`);
            }
            if (!(0, membershipPlans_1.isAgeEligibleForPlan)(plan, childAge)) {
                throw new https_1.HttpsError("failed-precondition", `Child ${index + 2}'s age (${childAge}) is not eligible for ${plan.name}.`);
            }
            return {
                fullName,
                dateOfBirth: childDateOfBirth,
                age: childAge,
                isPayer: false,
                participantKey: participantKeyFor(fullName, childDateOfBirth),
            };
        });
        // Guardian rules: for a youth plan the payer must be the guardian and can
        // never be the participant.
        let guardian = null;
        if (plan.audience === "youth") {
            if (participantIsPayer) {
                throw new https_1.HttpsError("failed-precondition", membershipPlans_1.POLICY_TEXT.guardianRequirement);
            }
            guardian = {
                fullName: requirePersonName((_m = request.data) === null || _m === void 0 ? void 0 : _m.guardianFullName, "guardianFullName"),
                relationship: requireBoundedString((_o = request.data) === null || _o === void 0 ? void 0 : _o.guardianRelationship, "guardianRelationship", 2, 80),
                confirmedAuthority: true,
            };
        }
        const expectedSignedName = (_p = guardian === null || guardian === void 0 ? void 0 : guardian.fullName) !== null && _p !== void 0 ? _p : participantName;
        if (normalizeParticipantIdentityName(signedName) !==
            normalizeParticipantIdentityName(expectedSignedName)) {
            throw new https_1.HttpsError("failed-precondition", `Type ${plan.audience === "youth" ? "the paying adult's" : "your"} full name exactly to sign.`);
        }
        const commercialTerms = (0, membershipPlans_1.createCommercialPlanSnapshot)(planKey);
        const documents = (0, membershipPlans_1.resolveCheckoutDocuments)(planKey);
        const participantCount = 1 + additionalParticipants.length;
        const statements = (0, membershipPlans_1.resolveCheckoutAcceptanceStatements)(planKey, participantCount);
        const acceptedStatementIds = requireExactCheckoutAcceptanceIds((_q = request.data) === null || _q === void 0 ? void 0 : _q.acceptedStatementIds, statements);
        const acceptanceEvidence = {
            signerRole: (0, membershipPlans_1.resolveCheckoutSignerRole)(planKey),
            documents,
            statements,
            acceptedStatementIds,
            immediatePerformanceRequested: true,
        };
        const participantKey = participantKeyFor(participantName, dateOfBirth);
        const participant = {
            fullName: participantName,
            dateOfBirth,
            age,
            isPayer: participantIsPayer,
            participantKey,
        };
        const participants = [participant, ...additionalParticipants];
        const participantKeys = participants.map(({ participantKey: key }) => key);
        if (new Set(participantKeys).size !== participantKeys.length) {
            throw new https_1.HttpsError("invalid-argument", "Each child can be included only once in the same checkout.");
        }
        const order = createOrderSnapshot(commercialTerms, participantCount);
        const requestFingerprint = checkoutRequestFingerprint({
            payerUid,
            planKey,
            expectedBillingMode,
            promotionCode,
            participant,
            participants,
            guardian,
            signedName,
            commercialTerms,
            acceptances: acceptanceEvidence,
        });
        const payerEmail = payerUid ?
            ((_r = (await admin.auth().getUser(payerUid)).email) === null || _r === void 0 ? void 0 : _r.trim().toLowerCase()) || null :
            null;
        // Existing attempts and admitted fingerprints retry for free. A brand-new
        // anonymous attempt must be admitted before any Stripe object is retrieved
        // or created, so abuse cannot turn provider validation into an unbounded
        // public endpoint.
        if (!isFirebaseFunctionsEmulatorProcess()) {
            await admitCheckoutRequest({
                request,
                intentRef,
                checkoutAttemptHash,
                requestFingerprint,
                nowMillis: now,
            });
        }
        let checkoutConfig = null;
        const ensureCheckoutConfig = async (frozenPriceId) => {
            if (checkoutConfig) {
                if (frozenPriceId && checkoutConfig.priceId !== frozenPriceId) {
                    throw new Error("Checkout attempt changed its frozen Stripe Price.");
                }
                return checkoutConfig;
            }
            const priceId = frozenPriceId !== null && frozenPriceId !== void 0 ? frozenPriceId : resolvePriceId(planKey);
            const origin = resolveReturnOrigin();
            const client = stripe();
            const productId = await assertStripePriceMatchesPlan(client, priceId, plan);
            if (billingPolicy.kind === "presale" &&
                planKey === membershipPlans_1.EXISTING_MEMBER_OFFER.planKey) {
                await retrieveApprovedExistingMemberCoupon(client, productId);
            }
            let familyDiscountCouponId = null;
            if (youthFamilyDiscountApplies(planKey, participantCount)) {
                const youthProductIds = await resolveApprovedYouthProductIds(client);
                const configuredCouponId = stripeYouthFamilyCouponId.value().trim();
                const coupon = await retrieveApprovedYouthFamilyCoupon(client, configuredCouponId, youthProductIds, membershipPlans_1.YOUTH_FAMILY_OFFER.percentOff);
                familyDiscountCouponId = coupon.id;
            }
            checkoutConfig = {
                client,
                priceId,
                productId,
                origin,
                familyDiscountCouponId,
            };
            return checkoutConfig;
        };
        let reservation;
        let proposedIntent = null;
        const existingSnap = await intentRef.get();
        let convergedMembershipIds;
        if (!existingSnap.exists) {
            // Stripe, not a potentially delayed Firestore projection, decides
            // whether an older subscription is terminal. The reservation
            // transaction below re-runs every duplicate query after convergence.
            convergedMembershipIds = await convergeCheckoutDuplicateScope(participants, participantKeys, payerUid, commercialTerms.grantsAlphaWodAccess, converge);
        }
        if (!existingSnap.exists && expectedBillingMode !== billingPolicy.billingMode) {
            // A page left open across the presale cutoff must never display £0 terms
            // and then silently create an immediately chargeable standard Checkout.
            // Existing frozen attempts remain retryable under their recorded terms.
            throw new https_1.HttpsError("failed-precondition", "The membership billing terms changed while this page was open. Refresh and review them before continuing.", {
                reason: "billing_policy_changed",
                expectedBillingMode,
                currentBillingMode: billingPolicy.billingMode,
            });
        }
        if (!existingSnap.exists && promotionCode &&
            (billingPolicy.kind !== "presale" ||
                planKey !== membershipPlans_1.EXISTING_MEMBER_OFFER.planKey)) {
            throw new https_1.HttpsError("failed-precondition", "Promotion codes are available only for the Adult Unlimited founding presale.");
        }
        if (existingSnap.exists) {
            const existing = existingSnap.data();
            if (existing.requestFingerprint !== requestFingerprint) {
                throw new https_1.HttpsError("failed-precondition", "This checkout attempt was already used with different membership details.");
            }
            reservation = {
                created: false,
                intent: existing,
                intentRef,
                disposition: "same_attempt",
            };
        }
        else {
            // Validate provider configuration before taking a new reservation. An
            // existing recorded Session can still be returned during a later Stripe
            // outage without risking its recovery verifier.
            const validatedConfig = await ensureCheckoutConfig();
            const promotionCodeId = promotionCode ?
                await resolveApprovedPromotionCodeForCheckout(validatedConfig.client, promotionCode) : null;
            let checkoutExpiresAt;
            try {
                checkoutExpiresAt = (0, membershipPlans_1.resolveCheckoutSessionExpiry)(now);
            }
            catch (error) {
                if (!(error instanceof RangeError))
                    throw error;
                throw new https_1.HttpsError("failed-precondition", "Membership checkout pauses briefly at the monthly billing boundary. Please try again after midnight.");
            }
            const reservationLockIds = checkoutLockSpecs(payerUid, planKey, participantKeys).map((spec) => spec.id);
            proposedIntent = {
                schemaVersion: membershipPlans_1.MEMBERSHIP_SCHEMA_VERSION,
                checkoutAttemptHash,
                requestFingerprint,
                payerUid,
                payerEmail,
                planKey,
                commercialTerms,
                stripeMode: assertBillingEnvironment().stripeMode,
                stripePriceId: validatedConfig.priceId,
                participant,
                participants,
                participantKeys,
                participantCount,
                order,
                guardian,
                acceptances: Object.assign(Object.assign({ signedName }, acceptanceEvidence), { acceptedAt: serverTimestamp(), userAgent: String(request.rawRequest.get("user-agent") || "").slice(0, 500) }),
                checkoutSessionId: null,
                checkoutSessionUrl: null,
                status: "reserved",
                billingMode: billingPolicy.billingMode,
                billingCycleAnchor: billingPolicy.billingCycleAnchor,
                serviceStartsAt: billingPolicy.serviceStartsAtUnixSeconds,
                firstPaymentAt: billingPolicy.firstPaymentAtUnixSeconds,
                initialChargePence: billingPolicy.paymentDueToday ? null : 0,
                prorationBehavior: billingPolicy.prorationBehavior,
                promotionCodeId,
                familyDiscountCouponId: validatedConfig.familyDiscountCouponId,
                firstFullChargeDate: billingPolicy.firstFullChargeDate,
                checkoutExpiresAt,
                reservationExpiresAt: firestore_1.Timestamp.fromMillis((checkoutExpiresAt + CHECKOUT_SETTLEMENT_GRACE_SECONDS) * 1000),
                reservationLockIds,
                createdAt: serverTimestamp(),
            };
            await reconcileExpiredCheckoutReservations(reservationLockIds, now);
            let resolvedReservation = null;
            // An expired owner can race another exact retry that immediately acquires
            // the released locks. Follow at most two such owners; every candidate is
            // independently authenticated and verified with Stripe before use.
            for (let recoveryAttempt = 0; recoveryAttempt < 3; recoveryAttempt += 1) {
                const candidate = await reserveCheckoutAttempt(intentRef, proposedIntent, now, convergedMembershipIds);
                if (candidate.disposition !== "owned_resume_candidate") {
                    resolvedReservation = candidate;
                    break;
                }
                if (!payerUid)
                    throw checkoutInProgressError();
                const resume = await verifyOwnedCheckoutResumeCandidate(candidate, payerUid, payerProfileStripeCustomerId);
                if (resume.kind === "open") {
                    return Object.assign(Object.assign({ ok: true, disposition: "resumed", sessionUrl: resume.session.url, sessionId: resume.session.id, firstFullChargeDate: candidate.intent.firstFullChargeDate, billingMode: (_s = candidate.intent.billingMode) !== null && _s !== void 0 ? _s : "standard", serviceStartsAt: (_t = candidate.intent.serviceStartsAt) !== null && _t !== void 0 ? _t : null, firstPaymentAt: (_u = candidate.intent.firstPaymentAt) !== null && _u !== void 0 ? _u : candidate.intent.billingCycleAnchor, initialChargePence: (_v = candidate.intent.initialChargePence) !== null && _v !== void 0 ? _v : null, appAccessTier: candidate.intent.commercialTerms.appAccessTier }, conditioningEntitlementProjection(candidate.intent.commercialTerms, candidate.intent.planKey)), { promotionCodesEnabled: isPresaleIntent(candidate.intent) &&
                            candidate.intent.planKey === membershipPlans_1.EXISTING_MEMBER_OFFER.planKey });
                }
                // Stripe authoritatively reported the old Session expired and the bound
                // transition released only that intent's locks. Retry this same new
                // attempt inside the current invocation so the customer can continue.
            }
            if (!resolvedReservation) {
                throw checkoutRecoveryUnavailableError();
            }
            reservation = resolvedReservation;
        }
        const intent = reservation.intent;
        if (intent.requestFingerprint !== requestFingerprint) {
            throw new https_1.HttpsError("failed-precondition", "This checkout attempt was already used with different membership details.");
        }
        if (intent.stripeMode !== assertBillingEnvironment().stripeMode) {
            throw new https_1.HttpsError("failed-precondition", "This checkout attempt belongs to another Stripe environment. Start again.");
        }
        const checkoutWindowEnded = () => intent.checkoutExpiresAt <= Math.floor(Date.now() / 1000) ||
            intent.checkoutExpiresAt >= intent.billingCycleAnchor;
        // Once Checkout has been submitted, a hosted URL is no longer a safe retry
        // target even if Firestore retained it for audit/reconciliation purposes.
        if (intent.status === "payment_pending" || intent.status === "fulfilled") {
            throw checkoutProcessingError();
        }
        // The attempt id is the recovery verifier for an anonymous checkout. It
        // proves access to this exact Firestore intent, but never that Stripe still
        // considers the hosted page open. Re-read Stripe and validate its immutable
        // binding before returning the provider's current URL to either an
        // anonymous or authenticated exact-attempt retry.
        if (intent.status === "created" && intent.checkoutSessionId &&
            reservation.disposition === "same_attempt") {
            const verified = await verifySameAttemptCheckoutSession(reservation, payerUid, payerProfileStripeCustomerId);
            if (verified.kind === "expired") {
                throw new https_1.HttpsError("deadline-exceeded", "This checkout attempt has ended. Start again with a new checkout attempt.", { reason: "checkout_expired" });
            }
            return Object.assign(Object.assign({ ok: true, disposition: "created", sessionUrl: verified.session.url, sessionId: verified.session.id, firstFullChargeDate: intent.firstFullChargeDate, billingMode: (_w = intent.billingMode) !== null && _w !== void 0 ? _w : "standard", serviceStartsAt: (_x = intent.serviceStartsAt) !== null && _x !== void 0 ? _x : null, firstPaymentAt: (_y = intent.firstPaymentAt) !== null && _y !== void 0 ? _y : intent.billingCycleAnchor, initialChargePence: (_z = intent.initialChargePence) !== null && _z !== void 0 ? _z : null, appAccessTier: intent.commercialTerms.appAccessTier }, conditioningEntitlementProjection(intent.commercialTerms, intent.planKey)), { promotionCodesEnabled: isPresaleIntent(intent) &&
                    intent.planKey === membershipPlans_1.EXISTING_MEMBER_OFFER.planKey });
        }
        if (intent.status !== "reserved") {
            throw new https_1.HttpsError("deadline-exceeded", "This checkout attempt has ended. Start again with a new checkout attempt.");
        }
        if (typeof intent.stripePriceId !== "string" || !intent.stripePriceId) {
            throw new https_1.HttpsError("failed-precondition", "This checkout attempt predates the frozen billing-price safety check. Contact support.");
        }
        const { client: checkoutStripe, priceId, origin } = await ensureCheckoutConfig(intent.stripePriceId);
        // Only a signed-in buyer gets a pre-resolved Stripe customer. Stripe calls
        // remain outside the reservation transaction. A retry uses the same hashed
        // client attempt id, so Stripe returns the same Checkout Session.
        let customerId = null;
        try {
            customerId = payerUid ? await resolveStripeCustomerId(payerUid) : null;
        }
        catch (error) {
            // Customer setup happens before Checkout creation. It is therefore safe
            // to terminalise this attempt: no payment Session can exist yet, even if
            // Stripe created the idempotent Customer before a response was lost.
            await transitionCheckoutReservation(intentRef, "failed", {
                failureKind: "stripe_customer_setup",
                failedAt: serverTimestamp(),
            });
            console.error("Membership customer setup failed", { payerUid, error });
            throw new https_1.HttpsError("deadline-exceeded", "Billing setup could not be completed. Start again with a new checkout attempt.");
        }
        let session;
        const legacyConditioningSlots = intent.planKey === "adult_conditioning" &&
            !intent.commercialTerms.conditioningBookingPolicy ?
            (0, authz_1.canonicalConditioningSlots)(intent.selectedConditioningSlots) : null;
        if (intent.planKey === "adult_conditioning" &&
            !intent.commercialTerms.conditioningBookingPolicy &&
            !legacyConditioningSlots) {
            throw new https_1.HttpsError("failed-precondition", "This checkout's frozen Conditioning policy is invalid. Contact support.");
        }
        let conditioningMetadata = {};
        if (intent.planKey === "adult_conditioning") {
            conditioningMetadata = intent.commercialTerms.conditioningBookingPolicy ?
                conditioningPolicyMetadata(intent.commercialTerms.conditioningBookingPolicy) : { conditioningSlots: (legacyConditioningSlots || []).join(",") };
        }
        try {
            session = await checkoutStripe.checkout.sessions.create(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ mode: "subscription", 
                // The public catalogue and frozen contract are denominated in GBP.
                // Override Stripe's mutable Dashboard default so Adaptive Pricing
                // cannot localise this or future subscription payments.
                adaptive_pricing: { enabled: false } }, (customerId ? { customer: customerId } : {})), (payerUid ? { client_reference_id: payerUid } : {})), { line_items: [{ price: priceId, quantity: participantCountFor(intent) }], payment_method_collection: "always" }), (intent.familyDiscountCouponId ? {
                discounts: [{ coupon: intent.familyDiscountCouponId }],
            } : intent.promotionCodeId ? {
                discounts: [{ promotion_code: intent.promotionCodeId }],
            } : {})), { 
                // Dynamic payment methods are managed from the Stripe Dashboard, so
                // `payment_method_types` is deliberately omitted.
                billing_address_collection: membershipPlans_1.BILLING_POLICY.collectBillingAddress ? "required" : "auto", phone_number_collection: { enabled: membershipPlans_1.BILLING_POLICY.collectPhoneNumber }, automatic_tax: { enabled: membershipPlans_1.BILLING_POLICY.automaticTaxEnabled }, submit_type: "subscribe", locale: "en-GB", expires_at: intent.checkoutExpiresAt, success_url: `${origin}/memberships/success?session_id={CHECKOUT_SESSION_ID}` +
                    `&plan=${encodeURIComponent(plan.key)}`, cancel_url: `${origin}/memberships?checkout=cancelled`, subscription_data: {
                    description: intent.commercialTerms.planName,
                    // The frozen policy is either the one-off £0 presale period or the
                    // normal immediate-start proration. Stripe remains the amount
                    // authority in both cases.
                    billing_cycle_anchor: intent.billingCycleAnchor,
                    proration_behavior: (_0 = intent.prorationBehavior) !== null && _0 !== void 0 ? _0 : "create_prorations",
                    metadata: Object.assign(Object.assign(Object.assign({}, (payerUid ? { firebaseUid: payerUid } : {})), { planKey, intentId: intentRef.id, participantCount: String(participantCountFor(intent)), appAccessTier: intent.commercialTerms.appAccessTier }), conditioningMetadata),
                }, metadata: Object.assign(Object.assign(Object.assign({}, (payerUid ? { firebaseUid: payerUid } : {})), { planKey, intentId: intentRef.id, participantCount: String(participantCountFor(intent)), appAccessTier: intent.commercialTerms.appAccessTier }), conditioningMetadata) }), { idempotencyKey: `checkout:${checkoutAttemptHash}` });
            assertStripeObjectMode("Checkout Session", session.id, session.livemode);
        }
        catch (error) {
            if (isDefinitiveCheckoutCreateFailure(error)) {
                const stripeFailure = error;
                // `expires_at` is fully server-generated. Any definitive provider
                // rejection of it means this frozen attempt can no longer produce a
                // Session (including Stripe's 30-minute minimum window), not that the
                // operator's billing catalogue is broken.
                const expiredAttempt = stripeFailure.param === "expires_at";
                await transitionCheckoutReservation(intentRef, "failed", {
                    failureKind: expiredAttempt ?
                        "checkout_attempt_expired" : "stripe_checkout_validation",
                    failedAt: serverTimestamp(),
                });
                const safeDiagnostic = (value) => typeof value === "string" ? value.slice(0, 120) : null;
                console.error("Stripe Checkout Session creation was rejected", {
                    planKey,
                    hasPromotion: Boolean(intent.promotionCodeId),
                    type: safeDiagnostic(stripeFailure.type),
                    code: safeDiagnostic(stripeFailure.code),
                    param: safeDiagnostic(stripeFailure.param),
                    statusCode: typeof stripeFailure.statusCode === "number" ?
                        stripeFailure.statusCode : null,
                    requestId: safeDiagnostic(stripeFailure.requestId),
                });
                if (expiredAttempt) {
                    throw new https_1.HttpsError("deadline-exceeded", "This checkout attempt expired before Stripe created it. Start again with a new checkout attempt.");
                }
                throw new https_1.HttpsError("failed-precondition", "Stripe could not start checkout because the billing setup needs attention. No checkout was created or charged. Please contact us.", { reason: "stripe_checkout_configuration" });
            }
            // A timeout, connection loss or Stripe 5xx may have happened after the
            // Session was accepted. Retain the reservation so the same attempt can
            // replay its idempotency key and recover the exact response.
            throw error;
        }
        if (!session.url) {
            throw new https_1.HttpsError("internal", "Stripe did not return a Checkout URL.");
        }
        const newlyRecorded = await db().runTransaction(async (tx) => {
            const fresh = await tx.get(intentRef);
            if (!fresh.exists) {
                throw new https_1.HttpsError("internal", "The checkout reservation was lost.");
            }
            const storedSessionId = fresh.get("checkoutSessionId");
            if (typeof storedSessionId === "string" && storedSessionId !== session.id) {
                throw new https_1.HttpsError("failed-precondition", "This checkout attempt is already bound to another Stripe session.");
            }
            const currentStatus = fresh.get("status");
            if (currentStatus === "expired" || currentStatus === "failed") {
                throw new https_1.HttpsError("deadline-exceeded", "This checkout attempt ended before Stripe returned. Start again.");
            }
            const alreadyRecorded = storedSessionId === session.id;
            tx.set(intentRef, Object.assign(Object.assign({ checkoutSessionId: session.id, checkoutSessionUrl: session.url }, (currentStatus === "reserved" ? { status: "created" } : {})), { updatedAt: serverTimestamp() }), { merge: true });
            return !alreadyRecorded;
        });
        // A `reserved` row can mean Stripe accepted the idempotent create request
        // but the process died before recording its response. Replaying the create
        // above recovers that exact Session. If its window has since ended, verify
        // the recovered Session now; release occurs only on Stripe-confirmed
        // terminal state, never on the browser/server clock alone.
        if (checkoutWindowEnded()) {
            await reconcileExpiredCheckoutReservations(intent.reservationLockIds, Date.now(), true);
            const refreshed = await intentRef.get();
            if (!refreshed.exists) {
                throw new https_1.HttpsError("internal", "The checkout reservation was lost.");
            }
            const refreshedStatus = refreshed.get("status");
            if (refreshedStatus === "expired" || refreshedStatus === "failed") {
                throw new https_1.HttpsError("deadline-exceeded", "This checkout attempt has ended. Start again after the billing boundary.");
            }
        }
        if (newlyRecorded) {
            await writeAudit({
                type: "checkout_session_created",
                payerUid,
                planKey,
                intentId: intentRef.id,
                checkoutSessionId: session.id,
            });
        }
        return Object.assign(Object.assign({ ok: true, disposition: "created", sessionUrl: session.url, sessionId: session.id, firstFullChargeDate: intent.firstFullChargeDate, billingMode: (_1 = intent.billingMode) !== null && _1 !== void 0 ? _1 : "standard", serviceStartsAt: (_2 = intent.serviceStartsAt) !== null && _2 !== void 0 ? _2 : null, firstPaymentAt: (_3 = intent.firstPaymentAt) !== null && _3 !== void 0 ? _3 : intent.billingCycleAnchor, initialChargePence: (_4 = intent.initialChargePence) !== null && _4 !== void 0 ? _4 : null, appAccessTier: intent.commercialTerms.appAccessTier }, conditioningEntitlementProjection(intent.commercialTerms, intent.planKey)), { promotionCodesEnabled: isPresaleIntent(intent) &&
                intent.planKey === membershipPlans_1.EXISTING_MEMBER_OFFER.planKey });
    };
}
function buildCreateMembershipCheckoutSession(converge, requiredCheckoutSchemaVersion) {
    return (0, https_1.onCall)({
        region: REGION,
        secrets: exports.MEMBERSHIP_CHECKOUT_SECRETS,
        enforceAppCheck: !isFirebaseFunctionsEmulatorProcess(),
        consumeAppCheckToken: !isFirebaseFunctionsEmulatorProcess(),
        timeoutSeconds: MEMBERSHIP_INTERACTIVE_TIMEOUT_SECONDS,
    }, buildCreateMembershipCheckoutHandler(requirePurchaseFlowOpen, !isFirebaseFunctionsEmulatorProcess(), converge, requiredCheckoutSchemaVersion));
}
exports.createCustomerPortalSession = (0, https_1.onCall)({ region: REGION, secrets: exports.MEMBERSHIP_SECRETS }, async (request) => {
    var _a;
    // Refuse a mixed project/key deployment before reading billing records.
    assertBillingEnvironment();
    const userId = requireAuthUid(request);
    const subscriptionId = requireBoundedString((_a = request.data) === null || _a === void 0 ? void 0 : _a.subscriptionId, "subscriptionId", 3, 255);
    const membership = await db().collection("memberships").doc(subscriptionId).get();
    if (!membership.exists) {
        throw new https_1.HttpsError("not-found", "Membership not found.");
    }
    if (membership.get("payerUid") !== userId) {
        throw new https_1.HttpsError("permission-denied", "Only the payer can open this membership's billing portal.");
    }
    const customerId = membership.get("stripeCustomerId");
    if (typeof customerId !== "string" || !customerId) {
        throw new https_1.HttpsError("failed-precondition", "This account has no billing profile yet.");
    }
    const configuration = stripePortalConfigurationId.value().trim();
    if (!configuration) {
        // Without an explicit configuration Stripe falls back to the account
        // default, which has cancellation enabled. That would let a member
        // cancel without the 14-day notice rule being applied or the receipt
        // time being recorded, so an unconfigured portal is refused outright.
        throw new https_1.HttpsError("failed-precondition", "The billing portal is not configured.");
    }
    const portalStripe = stripe();
    await assertPortalConfigurationIsLockedDown(portalStripe, configuration);
    const session = await portalStripe.billingPortal.sessions.create({
        customer: customerId,
        configuration,
        return_url: `${resolveReturnOrigin()}/account/membership`,
    });
    return { ok: true, portalUrl: session.url };
});
exports.getMyMemberships = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const userId = requireAuthUid(request);
    const snap = await db().collection("memberships").where("payerUid", "==", userId).get();
    const preview = (0, membershipPlans_1.resolveCancellationOutcome)(Date.now());
    const receiptIds = Array.from(new Set(snap.docs.flatMap((doc) => {
        var _a;
        const receiptId = (_a = doc.data().cancellationRequest) === null || _a === void 0 ? void 0 : _a.receiptId;
        return typeof receiptId === "string" && receiptId ? [receiptId] : [];
    })));
    const receiptSnaps = await Promise.all(receiptIds.map((receiptId) => db().collection(membershipCancellation_1.MEMBERSHIP_CANCELLATION_RECEIPT_COLLECTION)
        .doc(receiptId).get()));
    const receipts = new Map(receiptSnaps
        .filter((receipt) => receipt.exists)
        .map((receipt) => [receipt.id, receipt.data()]));
    const memberships = snap.docs.map((doc) => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5;
        const membership = doc.data();
        const participants = participantsFor(membership);
        const cancellationRequest = membership.cancellationRequest;
        const cancellationKind = (_a = cancellationRequest === null || cancellationRequest === void 0 ? void 0 : cancellationRequest.kind) !== null && _a !== void 0 ? _a : (cancellationRequest ? "contractual" : null);
        const requestReceipt = cancellationKind !== "cooling_off" &&
            cancellationRequest &&
            typeof cancellationRequest.id === "string" &&
            cancellationRequest.id &&
            cancellationRequest.receivedAt instanceof firestore_1.Timestamp ? {
            reference: cancellationRequest.id,
            receivedAt: cancellationRequest.receivedAt.toDate().toISOString(),
            kind: cancellationKind,
        } : null;
        let coolingOffReceipt = null;
        let coolingOffProjection = null;
        let coolingOffProjectionError = null;
        if (cancellationKind === "cooling_off" && (cancellationRequest === null || cancellationRequest === void 0 ? void 0 : cancellationRequest.receiptId)) {
            const storedReceipt = receipts.get(cancellationRequest.receiptId);
            try {
                (0, membershipCancellation_1.assertMembershipCancellationReceipt)(storedReceipt);
                coolingOffReceipt = storedReceipt;
                coolingOffProjection = (0, membershipCancellation_1.buildMembershipCancellationProjection)(storedReceipt, {
                    status: cancellationRequest.status,
                    endedAtMillis: (_b = cancellationRequest.providerEndedAtMillis) !== null && _b !== void 0 ? _b : null,
                });
            }
            catch (_6) {
                coolingOffProjectionError =
                    "This cancellation receipt needs support because its stored evidence is incomplete.";
            }
        }
        else if (cancellationKind === "cooling_off") {
            coolingOffProjectionError =
                "This cancellation receipt needs support because its stored evidence is incomplete.";
        }
        const presaleWithdrawalAvailable = membership.billingMode === "presale_deferred" &&
            membership.firstPaymentReceivedAt === null &&
            Date.now() < membership.serviceStartsAt * 1000 &&
            (0, membershipPlans_1.isMembershipStateBlockingDuplicate)(membership.state);
        const coolingOffEndsAt = (_d = (_c = membership.acceptances) === null || _c === void 0 ? void 0 : _c.coolingOffEndsAt) !== null && _d !== void 0 ? _d : null;
        const coolingOffEndMillis = typeof coolingOffEndsAt === "string" ?
            Date.parse(coolingOffEndsAt) : Number.NaN;
        return Object.assign(Object.assign({ subscriptionId: membership.subscriptionId, planKey: membership.planKey, planName: membership.planName, state: membership.state, grantsAlphaWodAccess: membership.grantsAlphaWodAccess, appAccessTier: (_f = (_e = membership.commercialTerms) === null || _e === void 0 ? void 0 : _e.appAccessTier) !== null && _f !== void 0 ? _f : (0, membershipPlans_1.getPlan)(membership.planKey).appAccessTier }, conditioningEntitlementProjection(membership.commercialTerms, membership.planKey)), { participantFullName: (_h = (_g = membership.participant) === null || _g === void 0 ? void 0 : _g.fullName) !== null && _h !== void 0 ? _h : "", participantFullNames: participants.map(({ fullName }) => fullName), participantCount: participantCountFor(membership), participantIsPayer: (_k = (_j = membership.participant) === null || _j === void 0 ? void 0 : _j.isPayer) !== null && _k !== void 0 ? _k : false, billingMode: (_l = membership.billingMode) !== null && _l !== void 0 ? _l : "standard", serviceStartsAt: (_m = membership.serviceStartsAt) !== null && _m !== void 0 ? _m : null, firstPaymentAt: (_p = (_o = membership.firstPaymentAt) !== null && _o !== void 0 ? _o : membership.billingCycleAnchor) !== null && _p !== void 0 ? _p : null, billingCycleAnchor: (_q = membership.billingCycleAnchor) !== null && _q !== void 0 ? _q : null, initialChargePence: (_r = membership.initialChargePence) !== null && _r !== void 0 ? _r : null, firstPaymentReceivedAt: (_s = membership.firstPaymentReceivedAt) !== null && _s !== void 0 ? _s : null, discount: (_t = membership.discount) !== null && _t !== void 0 ? _t : null, paymentSchedule: (_u = membership.paymentSchedule) !== null && _u !== void 0 ? _u : null, currentPeriodEnd: (_v = membership.currentPeriodEnd) !== null && _v !== void 0 ? _v : null, cancelAt: (_w = membership.cancelAt) !== null && _w !== void 0 ? _w : null, cancellationOutcome: (_x = membership.cancellationOutcome) !== null && _x !== void 0 ? _x : null, cancellationRequestStatus: (_y = coolingOffProjection === null || coolingOffProjection === void 0 ? void 0 : coolingOffProjection.status) !== null && _y !== void 0 ? _y : (coolingOffProjectionError ? "manual_review" :
                (_z = cancellationRequest === null || cancellationRequest === void 0 ? void 0 : cancellationRequest.status) !== null && _z !== void 0 ? _z : null), cancellationRequestKind: cancellationKind, cancellationReceipt: coolingOffReceipt ? {
                reference: coolingOffReceipt.receiptId,
                receivedAt: new Date(coolingOffReceipt.receivedAtMillis).toISOString(),
                kind: coolingOffReceipt.kind,
                acknowledgementStatus: (_0 = cancellationAcknowledgementStatusForClient(membership.cancellationAcknowledgementStatus)) !== null && _0 !== void 0 ? _0 : "pending",
                refundReviewRequired: coolingOffReceipt.outcome.refundReviewRequired,
            } : requestReceipt, cancellationPending: (cancellationRequest === null || cancellationRequest === void 0 ? void 0 : cancellationRequest.status) === "pending", cancellationManualReview: (cancellationRequest === null || cancellationRequest === void 0 ? void 0 : cancellationRequest.status) === "manual_review" ||
                coolingOffProjectionError !== null, cancellationRequestError: (_1 = coolingOffProjectionError !== null && coolingOffProjectionError !== void 0 ? coolingOffProjectionError : cancellationRequest === null || cancellationRequest === void 0 ? void 0 : cancellationRequest.lastError) !== null && _1 !== void 0 ? _1 : null, cancellationMode: presaleWithdrawalAvailable ? "cancel_before_start" : "standard", cancellationPreview: presaleWithdrawalAvailable ? Object.assign(Object.assign({}, resolvePresaleCancellationOutcome(Date.now(), membership)), { 
                // The receipt-time cancellation instant is recomputed and frozen only
                // when the member submits. This stable boundary is display-only.
                cancelAtUnixSeconds: membership.serviceStartsAt }) : preview, providerContractStatus: (_2 = membership.providerContractStatus) !== null && _2 !== void 0 ? _2 : null, providerContractError: (_3 = membership.providerContractError) !== null && _3 !== void 0 ? _3 : null, entitlementProjectionStatus: (_4 = membership.entitlementProjectionStatus) !== null && _4 !== void 0 ? _4 : null, entitlementProjectionError: (_5 = membership.entitlementProjectionError) !== null && _5 !== void 0 ? _5 : null, coolingOffEndsAt, coolingOffActive: Number.isFinite(coolingOffEndMillis) &&
                Date.now() <= coolingOffEndMillis });
    });
    return { ok: true, memberships, cancellationPreview: preview };
});
const CANCELLATION_RECOVERY_LEASE_MS = 10 * 60 * 1000;
const CANCELLATION_RECOVERY_MAX_ATTEMPTS = 24;
const CANCELLATION_RECOVERY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
function cancellationRetryAtMillis(attemptCount, nowMillis) {
    const delay = Math.min(60 * 60 * 1000, 60 * 1000 * (2 ** Math.min(attemptCount - 1, 6)));
    return nowMillis + delay;
}
/** Applies one frozen cancellation request without ever extending Stripe's date. */
async function settlePreparedCancellation(membershipRef, payerUid, prepared, converge) {
    var _a, _b, _c, _d, _e, _f;
    const subscriptionId = membershipRef.id;
    // The accepted receipt is already authoritative for class access. Queue
    // bounded capacity cleanup, but never delay the member's provider
    // cancellation if this secondary reconciliation needs a later retry.
    await enqueueMembershipBookingCleanup(membershipRef).catch(async (error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Membership booking cleanup queue needs convergence retry", {
            subscriptionId,
            requestId: prepared.requestId,
            error: message,
        });
        await writeAudit({
            type: "membership_booking_cleanup_retry",
            severity: "error",
            subscriptionId,
            requestId: prepared.requestId,
            error: message.slice(0, 1000),
        }).catch((auditError) => console.error("Could not write booking-cleanup audit", subscriptionId, auditError));
    });
    const before = await membershipRef.get();
    if (!before.exists) {
        throw new Error(`Membership ${subscriptionId} disappeared during cancellation.`);
    }
    const currentRequest = before.get("cancellationRequest");
    if ((currentRequest === null || currentRequest === void 0 ? void 0 : currentRequest.id) !== prepared.requestId) {
        throw new Error(`Membership ${subscriptionId} changed cancellation request.`);
    }
    const hadOutcome = Boolean(before.get("cancellationOutcome"));
    const currentSubscription = await stripe().subscriptions.retrieve(subscriptionId);
    assertStripeObjectMode("Subscription", currentSubscription.id, currentSubscription.livemode);
    const currentObservedEnd = currentSubscription.status === "canceled" ?
        ((_b = (_a = currentSubscription.ended_at) !== null && _a !== void 0 ? _a : currentSubscription.cancel_at) !== null && _b !== void 0 ? _b : null) :
        ((_c = currentSubscription.cancel_at) !== null && _c !== void 0 ? _c : null);
    const overdue = prepared.outcome.cancelAtUnixSeconds <= Math.floor(Date.now() / 1000);
    const cancelImmediately = prepared.kind === "cooling_off" || overdue;
    if (currentSubscription.status !== "canceled" && cancelImmediately) {
        // Stripe cannot accept a cancel_at in the past. Honour the member's frozen
        // request by stopping billing immediately, then route any charges taken
        // after the promised date to audited refund review.
        await stripe().subscriptions.cancel(subscriptionId, {
            prorate: false,
            invoice_now: false,
        }, {
            idempotencyKey: `cancel-now:${subscriptionId}:${prepared.requestId}:g${prepared.repairGeneration}`,
        });
    }
    else if (currentSubscription.status !== "canceled" &&
        (currentObservedEnd === null ||
            currentObservedEnd > prepared.outcome.cancelAtUnixSeconds)) {
        await stripe().subscriptions.update(subscriptionId, {
            cancel_at: prepared.outcome.cancelAtUnixSeconds,
            proration_behavior: "none",
            metadata: {
                cancellationRequestedBy: payerUid,
                cancellationNoticeMet: String(prepared.outcome.noticeDeadlineMet),
                cancellationRequestId: prepared.requestId,
                cancellationRepairGeneration: String(prepared.repairGeneration),
            },
        }, {
            idempotencyKey: `cancel:${subscriptionId}:${prepared.requestId}:g${prepared.repairGeneration}`,
        });
    }
    // Re-read after the idempotent update. Stripe can cache an idempotency result;
    // only current authoritative state proves that the schedule is now in place.
    const verifiedSubscription = await stripe().subscriptions.retrieve(subscriptionId);
    assertStripeObjectMode("Subscription", verifiedSubscription.id, verifiedSubscription.livemode);
    const verifiedEnd = verifiedSubscription.status === "canceled" ?
        ((_e = (_d = verifiedSubscription.ended_at) !== null && _d !== void 0 ? _d : verifiedSubscription.cancel_at) !== null && _e !== void 0 ? _e : null) :
        ((_f = verifiedSubscription.cancel_at) !== null && _f !== void 0 ? _f : null);
    const verified = cancelImmediately ?
        verifiedSubscription.status === "canceled" && verifiedEnd !== null :
        verifiedEnd !== null && verifiedEnd <= prepared.outcome.cancelAtUnixSeconds;
    if (!verified) {
        throw new Error(`Stripe has not applied cancellation request ${prepared.requestId}.`);
    }
    // The convergence transaction both records the frozen cancellation outcome
    // and brings state/entitlement up to date, including already-canceled rows.
    await convergeMembershipFromStripe(subscriptionId, converge);
    const finalized = await membershipRef.get();
    const outcome = finalized.get("cancellationOutcome");
    const finalRequestStatus = finalized.get("cancellationRequest.status");
    if (!outcome || (finalRequestStatus !== "applied" &&
        finalRequestStatus !== "manual_review")) {
        throw new Error(`Membership ${subscriptionId} did not settle its cancellation.`);
    }
    return { outcome, newlyFinalized: !hadOutcome };
}
async function markPendingCancellationFailed(membershipRef, requestId, error, nowMillis = Date.now()) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
    const terminal = await db().runTransaction(async (tx) => {
        var _a, _b;
        const snap = await tx.get(membershipRef);
        if (!snap.exists || snap.get("cancellationOutcome"))
            return false;
        const pending = snap.get("cancellationRequest");
        if ((pending === null || pending === void 0 ? void 0 : pending.id) !== requestId || pending.status !== "pending")
            return false;
        const attemptCount = typeof pending.attemptCount === "number" ? pending.attemptCount : 1;
        const receivedAt = (_a = timestampMillis(pending.receivedAt)) !== null && _a !== void 0 ? _a : nowMillis;
        const recoveryStartedAt = (_b = timestampMillis(pending.recoveryStartedAt)) !== null && _b !== void 0 ? _b : receivedAt;
        const isTerminal = attemptCount >= CANCELLATION_RECOVERY_MAX_ATTEMPTS ||
            nowMillis - recoveryStartedAt >= CANCELLATION_RECOVERY_MAX_AGE_MS;
        tx.update(membershipRef, Object.assign(Object.assign({ "cancellationRequest.status": isTerminal ? "manual_review" : "pending", "cancellationRequest.lastError": message, 
            // Each retry retrieves current Stripe state first. Rotating only after a
            // failed verification lets it reassert a schedule that was removed after
            // Stripe cached the prior idempotent update.
            "cancellationRequest.repairGeneration": typeof pending.repairGeneration === "number" ?
                pending.repairGeneration + 1 : 1, "cancellationRequest.failedAt": serverTimestamp(), "cancellationRequest.leaseToken": firestore_1.FieldValue.delete(), "cancellationRequest.leaseExpiresAt": firestore_1.FieldValue.delete(), "cancellationRequest.nextAttemptAt": isTerminal ?
                firestore_1.FieldValue.delete() :
                firestore_1.Timestamp.fromMillis(cancellationRetryAtMillis(attemptCount, nowMillis)) }, (isTerminal ? { "cancellationRequest.manualReviewAt": serverTimestamp() } : {})), { "updatedAt": serverTimestamp() }));
        return isTerminal;
    });
    if (terminal) {
        console.error("CRITICAL_BILLING_CANCELLATION_MANUAL_REVIEW", {
            subscriptionId: membershipRef.id,
            requestId,
            error: message,
        });
        await writeAudit({
            type: "cancellation_manual_review",
            severity: "critical",
            subscriptionId: membershipRef.id,
            requestId,
            error: message,
        }).catch((auditError) => console.error("Could not write cancellation manual-review audit", membershipRef.id, auditError));
    }
    return terminal;
}
async function acquireCancellationRecoveryLease(membershipRef, nowMillis = Date.now()) {
    const token = (0, crypto_1.randomUUID)();
    const result = await db().runTransaction(async (tx) => {
        var _a;
        const snap = await tx.get(membershipRef);
        if (!snap.exists || snap.get("cancellationOutcome")) {
            return { state: "skipped" };
        }
        const payerUid = snap.get("payerUid");
        const pending = snap.get("cancellationRequest");
        const outcome = pending === null || pending === void 0 ? void 0 : pending.outcome;
        if ((pending === null || pending === void 0 ? void 0 : pending.status) !== "pending")
            return { state: "skipped" };
        if (typeof pending.id !== "string" || typeof payerUid !== "string" || !payerUid ||
            !(pending.receivedAt instanceof firestore_1.Timestamp) ||
            typeof (outcome === null || outcome === void 0 ? void 0 : outcome.cancelAtUnixSeconds) !== "number") {
            const reason = "Pending cancellation evidence is malformed.";
            tx.update(membershipRef, {
                "cancellationRequest.status": "manual_review",
                "cancellationRequest.lastError": reason,
                "cancellationRequest.manualReviewAt": serverTimestamp(),
                "cancellationRequest.nextAttemptAt": firestore_1.FieldValue.delete(),
                "cancellationRequest.leaseToken": firestore_1.FieldValue.delete(),
                "cancellationRequest.leaseExpiresAt": firestore_1.FieldValue.delete(),
                "updatedAt": serverTimestamp(),
            });
            return {
                state: "terminal",
                requestId: typeof pending.id === "string" ? pending.id : "malformed",
                reason,
            };
        }
        const nextAttemptAt = timestampMillis(pending.nextAttemptAt);
        const leaseExpiresAt = timestampMillis(pending.leaseExpiresAt);
        if ((nextAttemptAt !== null && nextAttemptAt > nowMillis) ||
            (leaseExpiresAt !== null && leaseExpiresAt > nowMillis)) {
            return { state: "skipped" };
        }
        const attemptCount = typeof pending.attemptCount === "number" ?
            pending.attemptCount : 1;
        const recoveryStartedAtMillis = (_a = timestampMillis(pending.recoveryStartedAt)) !== null && _a !== void 0 ? _a : pending.receivedAt.toMillis();
        if (attemptCount >= CANCELLATION_RECOVERY_MAX_ATTEMPTS ||
            nowMillis - recoveryStartedAtMillis >= CANCELLATION_RECOVERY_MAX_AGE_MS) {
            tx.update(membershipRef, {
                "cancellationRequest.status": "manual_review",
                "cancellationRequest.lastError": "Automatic cancellation recovery exhausted.",
                "cancellationRequest.manualReviewAt": serverTimestamp(),
                "cancellationRequest.nextAttemptAt": firestore_1.FieldValue.delete(),
                "cancellationRequest.leaseToken": firestore_1.FieldValue.delete(),
                "cancellationRequest.leaseExpiresAt": firestore_1.FieldValue.delete(),
                "updatedAt": serverTimestamp(),
            });
            return {
                state: "terminal",
                requestId: pending.id,
                reason: "Automatic cancellation recovery exhausted.",
            };
        }
        tx.update(membershipRef, {
            "cancellationRequest.attemptCount": attemptCount + 1,
            "cancellationRequest.lastAttemptAt": serverTimestamp(),
            "cancellationRequest.leaseToken": token,
            "cancellationRequest.leaseExpiresAt": firestore_1.Timestamp.fromMillis(nowMillis + CANCELLATION_RECOVERY_LEASE_MS),
            "cancellationRequest.nextAttemptAt": firestore_1.Timestamp.fromMillis(nowMillis + CANCELLATION_RECOVERY_LEASE_MS),
            "updatedAt": serverTimestamp(),
        });
        return {
            state: "acquired",
            token,
            payerUid,
            prepared: {
                requestId: pending.id,
                kind: pending.kind === "presale_withdrawal" ||
                    pending.kind === "cooling_off" ?
                    pending.kind : "contractual",
                receivedAt: pending.receivedAt,
                outcome,
                repairGeneration: typeof pending.repairGeneration === "number" ?
                    pending.repairGeneration : 0,
            },
        };
    });
    if (result.state === "terminal") {
        console.error("CRITICAL_BILLING_CANCELLATION_MANUAL_REVIEW", {
            subscriptionId: membershipRef.id,
            requestId: result.requestId,
            error: result.reason,
        });
        await writeAudit({
            type: "cancellation_manual_review",
            severity: "critical",
            subscriptionId: membershipRef.id,
            requestId: result.requestId,
            error: result.reason,
        }).catch((auditError) => console.error("Could not write cancellation manual-review audit", membershipRef.id, auditError));
        return null;
    }
    if (result.state !== "acquired")
        return null;
    return {
        token: result.token,
        payerUid: result.payerUid,
        prepared: result.prepared,
    };
}
/** Retries frozen cancellation receipts independently of a customer returning. */
async function recoverPendingCancellationsOnce(nowMillis = Date.now(), limit = 50, converge = async () => undefined) {
    assertBillingEnvironment();
    const due = await db().collection("memberships")
        .where("cancellationRequest.nextAttemptAt", "<=", firestore_1.Timestamp.fromMillis(nowMillis))
        .orderBy("cancellationRequest.nextAttemptAt", "asc")
        .limit(limit)
        .get();
    const result = { processed: 0, failed: 0, skipped: 0 };
    for (const membership of due.docs) {
        const itemNow = Math.max(nowMillis, Date.now());
        const lease = await acquireCancellationRecoveryLease(membership.ref, itemNow);
        if (!lease) {
            result.skipped += 1;
            continue;
        }
        try {
            await settlePreparedCancellation(membership.ref, lease.payerUid, lease.prepared, converge);
            result.processed += 1;
        }
        catch (error) {
            await markPendingCancellationFailed(membership.ref, lease.prepared.requestId, error, Math.max(itemNow, Date.now()));
            console.error("Scheduled cancellation recovery failed", membership.id, error);
            result.failed += 1;
        }
    }
    return result;
}
function buildRecoverMembershipCancellations(converge) {
    return (0, scheduler_1.onSchedule)({
        region: REGION,
        schedule: "every 5 minutes",
        timeZone: "UTC",
        secrets: exports.MEMBERSHIP_STRIPE_WORKER_SECRETS,
        timeoutSeconds: 540,
    }, async () => {
        const result = await recoverPendingCancellationsOnce(Date.now(), 50, converge);
        console.log("Membership cancellation recovery result", result);
    });
}
function buildRequestMembershipCancellation(converge) {
    return (0, https_1.onCall)({ region: REGION, secrets: exports.MEMBERSHIP_SECRETS }, async (request) => {
        var _a, _b, _c, _d, _e;
        // The receipt transaction is legally significant. Never write it until
        // the Firebase project and Stripe key are proven to be paired.
        assertBillingEnvironment();
        const userId = requireAuthUid(request);
        const subscriptionId = requireBoundedString((_a = request.data) === null || _a === void 0 ? void 0 : _a.subscriptionId, "subscriptionId", 3, 255);
        const requestedKind = (_b = request.data) === null || _b === void 0 ? void 0 : _b.kind;
        if (requestedKind !== undefined && requestedKind !== "cooling_off" &&
            requestedKind !== "contractual") {
            throw new https_1.HttpsError("invalid-argument", "kind must be cooling_off or contractual when supplied.");
        }
        const expectedCancelAtUnixSeconds = (_c = request.data) === null || _c === void 0 ? void 0 : _c.expectedCancelAtUnixSeconds;
        if (typeof expectedCancelAtUnixSeconds !== "number" ||
            !Number.isSafeInteger(expectedCancelAtUnixSeconds) || expectedCancelAtUnixSeconds <= 0) {
            throw new https_1.HttpsError("invalid-argument", "expectedCancelAtUnixSeconds must be the cancellation date currently shown to you.");
        }
        const membershipRef = db().collection("memberships").doc(subscriptionId);
        const receivedAtMillis = Date.now();
        const proposedRequestId = (0, crypto_1.randomUUID)();
        // Freeze the legally decisive receipt time and outcome before calling
        // Stripe. A crash after Stripe accepts the update can then replay this same
        // request rather than recomputing it across a notice/month boundary.
        const prepared = await db().runTransaction(async (tx) => {
            var _a, _b, _c, _d, _e, _f, _g, _h;
            const snap = await tx.get(membershipRef);
            if (!snap.exists)
                throw new https_1.HttpsError("not-found", "Membership not found.");
            const membership = snap.data();
            if (membership.payerUid !== userId) {
                throw new https_1.HttpsError("permission-denied", "Only the payer can cancel this membership.");
            }
            const pending = snap.get("cancellationRequest");
            const pendingOutcome = pending === null || pending === void 0 ? void 0 : pending.outcome;
            if ((pending === null || pending === void 0 ? void 0 : pending.kind) === "cooling_off" &&
                typeof pending.id === "string" &&
                pending.receivedAt instanceof firestore_1.Timestamp &&
                typeof (pendingOutcome === null || pendingOutcome === void 0 ? void 0 : pendingOutcome.cancelAtUnixSeconds) === "number" &&
                typeof pending.receiptId === "string") {
                const receiptSnap = await tx.get(db().collection(membershipCancellation_1.MEMBERSHIP_CANCELLATION_RECEIPT_COLLECTION)
                    .doc(pending.receiptId));
                const receipt = receiptSnap.data();
                try {
                    (0, membershipCancellation_1.assertMembershipCancellationReceipt)(receipt);
                }
                catch (_j) {
                    throw new https_1.HttpsError("failed-precondition", "This cancellation needs support because its receipt evidence is incomplete.");
                }
                if (receipt.subscriptionId !== subscriptionId ||
                    receipt.requestId !== pending.id) {
                    throw new https_1.HttpsError("failed-precondition", "This cancellation needs support because its receipt does not match the membership.");
                }
                return {
                    alreadyFinalized: Boolean(membership.cancellationOutcome) ||
                        pending.status === "applied",
                    requestId: pending.id,
                    kind: "cooling_off",
                    receivedAt: pending.receivedAt,
                    outcome: pendingOutcome,
                    repairGeneration: typeof pending.repairGeneration === "number" ?
                        pending.repairGeneration : 0,
                    receipt,
                };
            }
            if (membership.cancellationOutcome) {
                if (typeof (pending === null || pending === void 0 ? void 0 : pending.id) !== "string" ||
                    !(pending.receivedAt instanceof firestore_1.Timestamp)) {
                    throw new https_1.HttpsError("failed-precondition", "This cancellation needs support because its recovery evidence is incomplete.");
                }
                const repairGeneration = typeof pending.repairGeneration === "number" ?
                    pending.repairGeneration + 1 : 1;
                const nextAttemptAt = firestore_1.Timestamp.fromMillis(receivedAtMillis + CANCELLATION_RECOVERY_LEASE_MS);
                tx.set(membershipRef, {
                    cancellationOutcome: null,
                    cancellationRequest: Object.assign(Object.assign({}, pending), { status: "pending", outcome: membership.cancellationOutcome, repairGeneration, recoveryStartedAt: firestore_1.Timestamp.fromMillis(receivedAtMillis), attemptCount: 1, lastAttemptAt: firestore_1.Timestamp.fromMillis(receivedAtMillis), nextAttemptAt, leaseToken: firestore_1.FieldValue.delete(), leaseExpiresAt: firestore_1.FieldValue.delete(), lastError: firestore_1.FieldValue.delete() }),
                    updatedAt: serverTimestamp(),
                }, { merge: true });
                return {
                    alreadyFinalized: true,
                    requestId: pending.id,
                    kind: pending.kind === "presale_withdrawal" ?
                        "presale_withdrawal" : "contractual",
                    receivedAt: pending.receivedAt,
                    outcome: membership.cancellationOutcome,
                    repairGeneration,
                    receipt: null,
                };
            }
            if ((pending === null || pending === void 0 ? void 0 : pending.status) === "pending" && typeof pending.id === "string" &&
                pending.receivedAt instanceof firestore_1.Timestamp &&
                typeof (pendingOutcome === null || pendingOutcome === void 0 ? void 0 : pendingOutcome.cancelAtUnixSeconds) === "number") {
                return {
                    alreadyFinalized: false,
                    requestId: pending.id,
                    kind: pending.kind === "presale_withdrawal" ?
                        "presale_withdrawal" : "contractual",
                    receivedAt: pending.receivedAt,
                    outcome: pendingOutcome,
                    repairGeneration: typeof pending.repairGeneration === "number" ?
                        pending.repairGeneration : 0,
                    receipt: null,
                };
            }
            if ((pending === null || pending === void 0 ? void 0 : pending.status) === "manual_review") {
                throw new https_1.HttpsError("failed-precondition", "This cancellation is already with support for manual review.");
            }
            if (membership.billingMode === "presale_deferred" &&
                membership.firstPaymentReceivedAt === null &&
                receivedAtMillis < membership.serviceStartsAt * 1000) {
                const receivedAt = firestore_1.Timestamp.fromMillis(receivedAtMillis);
                const outcome = resolvePresaleCancellationOutcome(receivedAtMillis, membership);
                tx.set(membershipRef, {
                    cancellationRequest: {
                        id: proposedRequestId,
                        status: "pending",
                        receivedAt,
                        recoveryStartedAt: receivedAt,
                        outcome,
                        attemptCount: 1,
                        repairGeneration: 0,
                        lastAttemptAt: receivedAt,
                        nextAttemptAt: firestore_1.Timestamp.fromMillis(receivedAtMillis + CANCELLATION_RECOVERY_LEASE_MS),
                        kind: "presale_withdrawal",
                    },
                    updatedAt: serverTimestamp(),
                }, { merge: true });
                return {
                    alreadyFinalized: false,
                    requestId: proposedRequestId,
                    kind: "presale_withdrawal",
                    receivedAt,
                    outcome,
                    repairGeneration: 0,
                    receipt: null,
                };
            }
            const coolingOffEndsAt = (_a = membership.acceptances) === null || _a === void 0 ? void 0 : _a.coolingOffEndsAt;
            const coolingOffEndMillis = typeof coolingOffEndsAt === "string" ?
                Date.parse(coolingOffEndsAt) : Number.NaN;
            if (Number.isFinite(coolingOffEndMillis) &&
                receivedAtMillis <= coolingOffEndMillis) {
                if (requestedKind !== "cooling_off") {
                    throw new https_1.HttpsError("failed-precondition", "This membership is still within its cooling-off period. Review and submit the cooling-off cancellation option.", { reason: "cooling_off_confirmation_required", coolingOffEndsAt });
                }
                const contractMadeAt = (_b = membership.acceptances) === null || _b === void 0 ? void 0 : _b.contractMadeAt;
                if (!(contractMadeAt instanceof firestore_1.Timestamp) ||
                    !Number.isSafeInteger(membership.serviceStartsAt) ||
                    membership.serviceStartsAt <= 0 ||
                    membership.acceptances.immediatePerformanceRequested !== true) {
                    throw new https_1.HttpsError("failed-precondition", "This cancellation needs support because its contract evidence is incomplete.");
                }
                const receivedAt = firestore_1.Timestamp.fromMillis(receivedAtMillis);
                const receipt = (0, membershipCancellation_1.buildCoolingOffCancellationReceipt)({
                    requestId: proposedRequestId,
                    subscriptionId,
                    channel: "membership_portal",
                    receivedAtMillis,
                    recordedAtMillis: receivedAtMillis,
                    actorUid: userId,
                    staffActorUid: null,
                    payer: {
                        uid: userId,
                        fullName: (_d = (_c = membership.guardian) === null || _c === void 0 ? void 0 : _c.fullName) !== null && _d !== void 0 ? _d : participantNamesFor(membership),
                        email: membership.payerEmail,
                    },
                    sender: {
                        uid: userId,
                        fullName: (_f = (_e = membership.guardian) === null || _e === void 0 ? void 0 : _e.fullName) !== null && _f !== void 0 ? _f : participantNamesFor(membership),
                        email: membership.payerEmail,
                    },
                    sourceEvidence: {
                        externalMessageIdSha256: null,
                        contentSha256: null,
                    },
                    membership: {
                        planKey: membership.planKey,
                        planName: membership.planName,
                        participantFullName: participantNamesFor(membership),
                        contractMadeAtMillis: contractMadeAt.toMillis(),
                        coolingOffEndsAtMillis: coolingOffEndMillis,
                        serviceStartsAtMillis: membership.serviceStartsAt * 1000,
                        firstPaymentReceivedAtMillis: typeof membership.firstPaymentReceivedAt === "number" ?
                            membership.firstPaymentReceivedAt * 1000 : null,
                        immediatePerformanceRequested: membership.acceptances.immediatePerformanceRequested,
                    },
                });
                const projection = (0, membershipCancellation_1.buildMembershipCancellationProjection)(receipt);
                const outcome = resolveCoolingOffCancellationOutcome(receivedAtMillis);
                const receiptRef = db()
                    .collection(membershipCancellation_1.MEMBERSHIP_CANCELLATION_RECEIPT_COLLECTION)
                    .doc(receipt.receiptId);
                const outboxId = (0, membershipCancellation_1.cancellationAcknowledgementOutboxId)(receipt.requestId);
                const outboxRef = db().collection(CONFIRMATION_OUTBOX_COLLECTION)
                    .doc(outboxId);
                let acknowledgementPayload = null;
                let acknowledgementError = null;
                if (membership.payerEmail) {
                    try {
                        acknowledgementPayload = (0, membershipCancellation_1.buildCancellationAcknowledgementPayload)({
                            receipt,
                            company: {
                                legalName: membershipPlans_1.COMPANY.legalName,
                                tradingName: membershipPlans_1.COMPANY.tradingName,
                                supportEmail: membershipPlans_1.COMPANY.supportEmail,
                                fromEmail: membershipFromEmail.value().trim() ||
                                    membershipPlans_1.COMPANY.confirmationSender,
                                postalAddress: membershipPlans_1.COMPANY.address,
                            },
                            membership: {
                                subscriptionId,
                                planName: membership.planName,
                                participantFullName: participantNamesFor(membership),
                            },
                            recipient: {
                                fullName: (_h = (_g = membership.guardian) === null || _g === void 0 ? void 0 : _g.fullName) !== null && _h !== void 0 ? _h : participantNamesFor(membership),
                                email: membership.payerEmail,
                            },
                        });
                    }
                    catch (_k) {
                        acknowledgementError =
                            "The payer email could not be used for the cancellation acknowledgement.";
                    }
                }
                else {
                    acknowledgementError =
                        "The payer email was unavailable for the cancellation acknowledgement.";
                }
                // Receipt, provider-recovery request, safe member projection and the
                // durable acknowledgement are accepted atomically before Stripe.
                tx.create(receiptRef, receipt);
                tx.set(membershipRef, Object.assign(Object.assign({ cancellationRequest: {
                        id: proposedRequestId,
                        kind: "cooling_off",
                        status: "pending",
                        receivedAt,
                        recoveryStartedAt: receivedAt,
                        outcome,
                        attemptCount: 1,
                        repairGeneration: 0,
                        lastAttemptAt: receivedAt,
                        nextAttemptAt: firestore_1.Timestamp.fromMillis(receivedAtMillis + CANCELLATION_RECOVERY_LEASE_MS),
                        receiptId: receipt.receiptId,
                        cancellationEffectiveAtMillis: projection.cancellationEffectiveAtMillis,
                        accessEndsAtMillis: projection.accessEndsAtMillis,
                        collectFuturePayments: false,
                        futurePaymentDuePence: 0,
                        providerEndedAtMillis: null,
                        refundReviewRequired: projection.refundReviewRequired,
                        refundAmountPence: null,
                        acknowledgementOutboxId: projection.acknowledgementOutboxId,
                        acknowledgementIdempotencyKey: projection.acknowledgementIdempotencyKey,
                    }, cancellationAcknowledgementStatus: acknowledgementPayload ?
                        "pending" : "manual_review" }, (acknowledgementError ? {
                    cancellationAcknowledgementError: acknowledgementError,
                } : {
                    cancellationAcknowledgementError: firestore_1.FieldValue.delete(),
                })), { updatedAt: serverTimestamp() }), { merge: true });
                tx.create(outboxRef, Object.assign(Object.assign({ schemaVersion: membershipPlans_1.MEMBERSHIP_SCHEMA_VERSION, kind: "membership_cancellation_acknowledgement", subscriptionId, requestId: receipt.requestId, receiptId: receipt.receiptId, status: acknowledgementPayload ? "pending" : "manual_review" }, (acknowledgementPayload ? {
                    payload: acknowledgementPayload,
                    idempotencyKey: (0, membershipCancellation_1.cancellationAcknowledgementIdempotencyKey)(receipt.requestId),
                    nextAttemptAt: serverTimestamp(),
                } : {
                    deadLetterReason: acknowledgementError,
                    deadLetteredAt: serverTimestamp(),
                })), { attemptCount: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
                return {
                    alreadyFinalized: false,
                    requestId: proposedRequestId,
                    kind: "cooling_off",
                    receivedAt,
                    outcome,
                    repairGeneration: 0,
                    receipt,
                    acknowledgementError,
                };
            }
            if (requestedKind === "cooling_off") {
                throw new https_1.HttpsError("failed-precondition", "The cooling-off period ended before this request was submitted. Review the current cancellation dates and confirm again.", { reason: "cooling_off_expired", coolingOffEndsAt: coolingOffEndsAt !== null && coolingOffEndsAt !== void 0 ? coolingOffEndsAt : null });
            }
            const receivedAt = firestore_1.Timestamp.fromMillis(receivedAtMillis);
            const outcome = (0, membershipPlans_1.resolveCancellationOutcome)(receivedAtMillis);
            if (outcome.cancelAtUnixSeconds !== expectedCancelAtUnixSeconds) {
                throw new https_1.HttpsError("failed-precondition", "The cancellation dates have changed. Review the updated dates and confirm again.", { cancellationPreview: outcome });
            }
            tx.set(membershipRef, {
                cancellationRequest: {
                    id: proposedRequestId,
                    kind: "contractual",
                    status: "pending",
                    receivedAt,
                    recoveryStartedAt: receivedAt,
                    outcome,
                    attemptCount: 1,
                    repairGeneration: 0,
                    lastAttemptAt: receivedAt,
                    nextAttemptAt: firestore_1.Timestamp.fromMillis(receivedAtMillis + CANCELLATION_RECOVERY_LEASE_MS),
                },
                updatedAt: serverTimestamp(),
            }, { merge: true });
            return {
                alreadyFinalized: false,
                requestId: proposedRequestId,
                kind: "contractual",
                receivedAt,
                outcome,
                repairGeneration: 0,
                receipt: null,
            };
        });
        if (prepared.kind === "cooling_off" && prepared.receipt &&
            "acknowledgementError" in prepared && prepared.acknowledgementError) {
            console.error("CRITICAL_BILLING_CANCELLATION_ACKNOWLEDGEMENT_MANUAL_REVIEW", {
                subscriptionId,
                requestId: prepared.requestId,
                outboxId: (0, membershipCancellation_1.cancellationAcknowledgementOutboxId)(prepared.requestId),
                error: prepared.acknowledgementError,
            });
            await writeAudit({
                type: "cancellation_acknowledgement_terminal",
                severity: "critical",
                subscriptionId,
                requestId: prepared.requestId,
                outboxId: (0, membershipCancellation_1.cancellationAcknowledgementOutboxId)(prepared.requestId),
                error: prepared.acknowledgementError,
            }).catch((auditError) => console.error("Could not write cancellation-acknowledgement terminal audit", subscriptionId, auditError));
        }
        try {
            const settled = await settlePreparedCancellation(membershipRef, userId, prepared, converge);
            if (prepared.receipt) {
                const finalized = await membershipRef.get();
                const providerStatus = finalized.get("cancellationRequest.status");
                const providerEndedAtMillis = finalized.get("cancellationRequest.providerEndedAtMillis");
                const projection = (0, membershipCancellation_1.buildMembershipCancellationProjection)(prepared.receipt, {
                    status: providerStatus === "applied" ||
                        providerStatus === "manual_review" ?
                        providerStatus : "pending",
                    endedAtMillis: typeof providerEndedAtMillis === "number" ?
                        providerEndedAtMillis : null,
                });
                return {
                    ok: true,
                    outcome: settled.outcome,
                    requestStatus: projection.status,
                    receipt: {
                        reference: prepared.receipt.receiptId,
                        receivedAt: new Date(prepared.receipt.receivedAtMillis).toISOString(),
                        kind: prepared.receipt.kind,
                        acknowledgementStatus: (_d = cancellationAcknowledgementStatusForClient(finalized.get("cancellationAcknowledgementStatus"))) !== null && _d !== void 0 ? _d : "pending",
                        refundReviewRequired: projection.refundReviewRequired,
                    },
                    alreadyCancelled: prepared.alreadyFinalized ||
                        !settled.newlyFinalized,
                };
            }
            return {
                ok: true,
                outcome: settled.outcome,
                receipt: {
                    reference: prepared.requestId,
                    receivedAt: prepared.receivedAt.toDate().toISOString(),
                    kind: prepared.kind,
                },
                alreadyCancelled: prepared.alreadyFinalized || !settled.newlyFinalized,
            };
        }
        catch (error) {
            await markPendingCancellationFailed(membershipRef, prepared.requestId, error).catch((recordError) => console.error("Could not schedule cancellation recovery", subscriptionId, recordError));
            if (prepared.receipt) {
                const current = await membershipRef.get();
                const providerStatus = current.get("cancellationRequest.status");
                const projection = (0, membershipCancellation_1.buildMembershipCancellationProjection)(prepared.receipt, {
                    status: providerStatus === "manual_review" ?
                        "manual_review" : "pending",
                    endedAtMillis: null,
                });
                console.error("Cooling-off provider cancellation queued for recovery", {
                    subscriptionId,
                    requestId: prepared.requestId,
                    error: error instanceof Error ? error.message : String(error),
                });
                return {
                    ok: true,
                    outcome: null,
                    requestStatus: projection.status,
                    receipt: {
                        reference: prepared.receipt.receiptId,
                        receivedAt: new Date(prepared.receipt.receivedAtMillis).toISOString(),
                        kind: prepared.receipt.kind,
                        acknowledgementStatus: (_e = cancellationAcknowledgementStatusForClient(current.get("cancellationAcknowledgementStatus"))) !== null && _e !== void 0 ? _e : "pending",
                        refundReviewRequired: projection.refundReviewRequired,
                    },
                    alreadyCancelled: prepared.alreadyFinalized,
                };
            }
            throw error;
        }
    });
}
/**
 * Window in which the checkout session plus browser-held verifier can attach a
 * purchase for the buyer who creates their account straight after paying.
 */
const SESSION_CLAIM_WINDOW_MS = 24 * 60 * 60 * 1000;
function toMillis(value) {
    if (value instanceof firestore_1.Timestamp)
        return value.toMillis();
    return null;
}
/**
 * Attaches a membership bought before sign-up to the account that now owns it.
 *
 * Two routes, deliberately different in what they demand:
 *
 * - By checkout session id plus the separate browser-held attempt verifier:
 *   both must identify the same fulfilled membership. The verifier is accepted
 *   without a verified email only inside a 24 hour window and is consumed by
 *   the ownership transaction. A leaked Stripe URL is therefore insufficient.
 * - By email: no window, but the account's email must be verified and must
 *   match the address Stripe billed. Without the verification requirement,
 *   anyone could register a victim's address and take their membership.
 *
 * The attach itself is transactional and asserts the membership is still
 * unclaimed, so two accounts racing on the same purchase cannot both win.
 */
function buildClaimMembership(converge) {
    return (0, https_1.onCall)({
        region: REGION,
        secrets: exports.MEMBERSHIP_SECRETS,
        timeoutSeconds: MEMBERSHIP_INTERACTIVE_TIMEOUT_SECONDS,
    }, async (request) => {
        var _a, _b, _c;
        const userId = requireAuthUid(request);
        const sessionId = optionalBoundedText((_a = request.data) === null || _a === void 0 ? void 0 : _a.sessionId, 3, 255);
        const checkoutAttemptId = sessionId && ((_b = request.data) === null || _b === void 0 ? void 0 : _b.checkoutAttemptId) !== undefined ?
            requireCheckoutAttemptId(request.data.checkoutAttemptId) : null;
        const presentedAttemptHash = checkoutAttemptId ?
            sha256(`membership-checkout:${checkoutAttemptId}`) : null;
        const authUser = await admin.auth().getUser(userId);
        const email = ((_c = authUser.email) === null || _c === void 0 ? void 0 : _c.trim().toLowerCase()) || null;
        if (!sessionId && (!authUser.emailVerified || !email)) {
            throw new https_1.HttpsError("permission-denied", "Verify the email address you paid with before claiming this membership.");
        }
        const userRef = db().collection("users").doc(userId);
        if (!(await userRef.get()).exists) {
            throw new https_1.HttpsError("failed-precondition", "Set up your member profile before claiming a purchase.");
        }
        let candidates = sessionId ?
            await db().collection("memberships")
                .where("checkoutSessionId", "==", sessionId).get() :
            await (email ?
                db().collection("memberships").where("payerEmail", "==", email).get() :
                Promise.resolve({ docs: [] }));
        if (sessionId && candidates.docs.length > 1) {
            const checkoutSessionIdHash = sha256(sessionId);
            console.error("CRITICAL_BILLING_DUPLICATE_CHECKOUT_SESSION", {
                checkoutSessionIdHash,
                membershipIds: candidates.docs.map((doc) => doc.id),
            });
            await writeAudit({
                type: "duplicate_checkout_session_claim",
                severity: "critical",
                checkoutSessionIdHash,
                membershipIds: candidates.docs.map((doc) => doc.id),
                claimantUid: userId,
            });
            throw new https_1.HttpsError("failed-precondition", "This purchase link needs support review before it can be claimed.");
        }
        const initiallyOwned = candidates.docs.filter((doc) => doc.get("payerUid") === userId &&
            (Boolean(sessionId) || (authUser.emailVerified && Boolean(email))));
        // Reject an unowned session link before it is allowed to trigger any
        // provider reads. Exact-owner retries deliberately remain idempotent even
        // after the original verifier window has elapsed.
        if (sessionId && candidates.docs.length === 1 && initiallyOwned.length === 0) {
            if (!presentedAttemptHash ||
                candidates.docs[0].get("checkoutAttemptHash") !== presentedAttemptHash) {
                const checkoutSessionIdHash = sha256(sessionId);
                await writeAudit({
                    type: "invalid_checkout_claim_verifier",
                    severity: "critical",
                    checkoutSessionIdHash,
                    membershipId: candidates.docs[0].id,
                    claimantUid: userId,
                });
                throw new https_1.HttpsError("permission-denied", "This checkout link cannot prove ownership. Sign in with the verified email used to pay.");
            }
            const fulfilledAt = toMillis(candidates.docs[0].get("fulfilledAt"));
            const claimNow = Date.now();
            const maxClockSkewMs = 5 * 60 * 1000;
            if (fulfilledAt === null || fulfilledAt > claimNow + maxClockSkewMs) {
                const checkoutSessionIdHash = sha256(sessionId);
                await writeAudit({
                    type: "invalid_checkout_session_claim_evidence",
                    severity: "critical",
                    checkoutSessionIdHash,
                    membershipId: candidates.docs[0].id,
                    claimantUid: userId,
                });
                throw new https_1.HttpsError("failed-precondition", "This purchase link needs support review before it can be claimed.");
            }
            if (claimNow - fulfilledAt > SESSION_CLAIM_WINDOW_MS) {
                throw new https_1.HttpsError("deadline-exceeded", "This purchase link has expired. Sign in with the email you paid with to claim it.");
            }
        }
        let convergedMembershipIds = new Set();
        if (candidates.docs.length > 0) {
            const candidateCanGrant = candidates.docs.some((doc) => doc.get("grantsAlphaWodAccess") === true &&
                doc.get("participant.isPayer") === true);
            const accountMemberships = candidateCanGrant ?
                await alphaWodMembershipsForAccount(userId) : [];
            convergedMembershipIds = await convergeEligibilityMemberships([...candidates.docs, ...accountMemberships], converge, "membership_claim");
            // Convergence can make a stale local terminal membership blocking (or
            // vice versa). Refresh claim candidates before the final transaction,
            // which independently rechecks all account-level duplicates.
            candidates = sessionId ?
                await db().collection("memberships")
                    .where("checkoutSessionId", "==", sessionId).get() :
                await (email ?
                    db().collection("memberships").where("payerEmail", "==", email).get() :
                    Promise.resolve({ docs: [] }));
            if (sessionId && candidates.docs.length > 1) {
                console.error("CRITICAL_BILLING_DUPLICATE_CHECKOUT_SESSION_AFTER_CONVERGENCE", {
                    checkoutSessionIdHash: sha256(sessionId),
                    membershipIds: candidates.docs.map((doc) => doc.id),
                });
                throw new https_1.HttpsError("failed-precondition", "This purchase link needs support review before it can be claimed.");
            }
            assertEligibilityDocsWereConverged(candidates.docs, convergedMembershipIds);
        }
        // A success page can call this more than once (navigation retries, Strict
        // Mode, or a network response lost after the transaction committed). Once
        // this exact session already belongs to the caller, treat the repeat as a
        // successful no-op and re-run entitlement convergence in case the first
        // attempt committed the attach but failed before convergence completed.
        const alreadyOwned = candidates.docs.filter((doc) => doc.get("payerUid") === userId &&
            (Boolean(sessionId) || (authUser.emailVerified && Boolean(email))));
        if (sessionId && alreadyOwned.length > 0) {
            await Promise.all(alreadyOwned.map((doc) => applyMembershipEntitlement(doc.ref, converge)));
            return {
                ok: true,
                claimed: alreadyOwned.map((doc) => doc.id),
                alreadyClaimed: true,
            };
        }
        const unclaimed = candidates.docs.filter((doc) => !doc.get("payerUid"));
        if (unclaimed.length === 0) {
            if (alreadyOwned.length > 0) {
                await Promise.all(alreadyOwned.map((doc) => applyMembershipEntitlement(doc.ref, converge)));
                return {
                    ok: true,
                    claimed: alreadyOwned.map((doc) => doc.id),
                    alreadyClaimed: true,
                };
            }
            throw new https_1.HttpsError("not-found", "No unclaimed membership was found for this account.");
        }
        // A verified-email retry may find both a membership attached just before a
        // prior invocation crashed and another still-unclaimed membership for the
        // same payer. Re-converge the owned rows, then continue claiming the rest.
        await Promise.all(alreadyOwned.map((doc) => applyMembershipEntitlement(doc.ref, converge)));
        const claimed = alreadyOwned.map((doc) => doc.id);
        for (const candidate of unclaimed) {
            const membershipRef = candidate.ref;
            const payerEmail = candidate.get("payerEmail");
            if (!sessionId && (!authUser.emailVerified || !email || email !== payerEmail)) {
                throw new https_1.HttpsError("permission-denied", "Verify the email address you paid with before claiming this membership.");
            }
            const plan = (0, membershipPlans_1.getPlan)(candidate.get("planKey"));
            const attached = await db().runTransaction(async (tx) => {
                var _a, _b, _c, _d, _e, _f;
                const fresh = await tx.get(membershipRef);
                const freshUser = await tx.get(userRef);
                if (!fresh.exists)
                    return { state: "taken", customerConflict: false };
                if (!freshUser.exists) {
                    throw new https_1.HttpsError("failed-precondition", "Set up your member profile before claiming a purchase.");
                }
                const currentPayerUid = fresh.get("payerUid");
                if (currentPayerUid && currentPayerUid !== userId) {
                    return { state: "taken", customerConflict: false };
                }
                if (sessionId && fresh.get("checkoutAttemptHash") !== presentedAttemptHash) {
                    throw new https_1.HttpsError("permission-denied", "This checkout link cannot prove ownership.");
                }
                const participantIsPayer = fresh.get("participant.isPayer") === true;
                const currentTargetUid = fresh.get("entitlementTargetUid");
                if (participantIsPayer && currentTargetUid !== null &&
                    currentTargetUid !== undefined && currentTargetUid !== userId) {
                    throw new https_1.HttpsError("failed-precondition", "This self-payer membership is already linked to another account.");
                }
                const shouldOwnEntitlement = plan.grantsAlphaWodAccess && participantIsPayer &&
                    (0, membershipPlans_1.isMembershipStateBlockingDuplicate)(fresh.get("state"));
                const payerMemberships = shouldOwnEntitlement ? await tx.get(db().collection("memberships").where("payerUid", "==", userId)) : null;
                const targetMemberships = shouldOwnEntitlement ? await tx.get(db().collection("memberships").where("entitlementTargetUid", "==", userId)) : null;
                const duplicate = [...((_a = payerMemberships === null || payerMemberships === void 0 ? void 0 : payerMemberships.docs) !== null && _a !== void 0 ? _a : []),
                    ...((_b = targetMemberships === null || targetMemberships === void 0 ? void 0 : targetMemberships.docs) !== null && _b !== void 0 ? _b : [])].some((doc) => doc.id !== membershipRef.id &&
                    doc.get("grantsAlphaWodAccess") === true &&
                    isBlockingMembershipDoc(doc));
                if (shouldOwnEntitlement) {
                    assertEligibilityDocsWereConverged([
                        ...((_c = payerMemberships === null || payerMemberships === void 0 ? void 0 : payerMemberships.docs) !== null && _c !== void 0 ? _c : []).filter((doc) => doc.get("grantsAlphaWodAccess") === true),
                        ...((_d = targetMemberships === null || targetMemberships === void 0 ? void 0 : targetMemberships.docs) !== null && _d !== void 0 ? _d : []).filter((doc) => doc.get("grantsAlphaWodAccess") === true),
                    ], convergedMembershipIds);
                }
                if (duplicate) {
                    throw new https_1.HttpsError("already-exists", membershipPlans_1.POLICY_TEXT.duplicateBlocked);
                }
                if (shouldOwnEntitlement &&
                    await hasBlockingPayerCheckoutReservation(tx, userId)) {
                    throw new https_1.HttpsError("already-exists", membershipPlans_1.POLICY_TEXT.duplicateBlocked);
                }
                const owner = shouldOwnEntitlement ?
                    await readEntitlementOwner(tx, userId, membershipRef.id) : null;
                if ((owner === null || owner === void 0 ? void 0 : owner.ownerState) === "active" && owner.ownerSubscriptionId &&
                    !convergedMembershipIds.has(owner.ownerSubscriptionId)) {
                    throw new https_1.HttpsError("unavailable", AUTHORITATIVE_ELIGIBILITY_UNAVAILABLE, { reason: "membership_state_changed" });
                }
                if (owner)
                    acquireEntitlementOwner(tx, owner, userId, membershipRef.id);
                tx.set(membershipRef, Object.assign(Object.assign(Object.assign(Object.assign({ payerUid: userId, payerEmail: (_f = (_e = fresh.get("payerEmail")) !== null && _e !== void 0 ? _e : payerEmail) !== null && _f !== void 0 ? _f : email }, (currentPayerUid === userId ? {} : {
                    claimedAt: serverTimestamp(),
                    claimedVia: sessionId ? "checkout_session" : "verified_email",
                })), (sessionId ? { checkoutClaimVerifierConsumedAt: serverTimestamp() } : {})), (shouldOwnEntitlement ?
                    { entitlementTargetUid: userId } :
                    {})), { updatedAt: serverTimestamp() }), { merge: true });
                const customerId = fresh.get("stripeCustomerId");
                const currentCustomerId = freshUser.get("stripeCustomerId");
                if (typeof customerId === "string" && customerId && !currentCustomerId) {
                    tx.set(userRef, {
                        stripeCustomerId: customerId,
                        updatedAt: serverTimestamp(),
                    }, { merge: true });
                }
                return {
                    state: currentPayerUid === userId ? "already_mine" : "attached",
                    customerConflict: typeof customerId === "string" && Boolean(customerId) &&
                        typeof currentCustomerId === "string" && Boolean(currentCustomerId) &&
                        currentCustomerId !== customerId,
                };
            });
            if (attached.state === "taken")
                continue;
            if (attached.customerConflict) {
                console.error("CRITICAL_BILLING_CUSTOMER_CONFLICT", {
                    subscriptionId: membershipRef.id,
                    userId,
                });
                await writeAudit({
                    type: "billing_customer_conflict",
                    severity: "critical",
                    subscriptionId: membershipRef.id,
                    payerUid: userId,
                });
            }
            await applyMembershipEntitlement(membershipRef, converge);
            claimed.push(membershipRef.id);
            if (attached.state === "attached") {
                await writeAudit({
                    type: "membership_claimed",
                    subscriptionId: membershipRef.id,
                    payerUid: userId,
                    claimedVia: sessionId ? "checkout_session" : "verified_email",
                });
            }
        }
        if (claimed.length === 0) {
            throw new https_1.HttpsError("already-exists", "That membership has already been claimed by another account.");
        }
        return { ok: true, claimed };
    });
}
/** ---------------------------------------------------------------
 * Webhook
 * -------------------------------------------------------------- */
async function fulfilCheckoutSession(session, converge, completionUnixSeconds) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w;
    assertStripeObjectMode("Checkout Session", session.id, session.livemode);
    const intentId = (_a = session.metadata) === null || _a === void 0 ? void 0 : _a.intentId;
    const subscriptionId = typeof session.subscription === "string" ?
        session.subscription :
        (_b = session.subscription) === null || _b === void 0 ? void 0 : _b.id;
    if (!intentId)
        return;
    const intentRef = db().collection("membershipIntents").doc(intentId);
    const intentSnap = await intentRef.get();
    if (!intentSnap.exists) {
        throw new Error(`Checkout intent ${intentId} was not found for ${session.id}.`);
    }
    const intent = intentSnap.data();
    if (intent.stripeMode !== assertBillingEnvironment().stripeMode) {
        throw new Error(`Checkout intent ${intentId} belongs to another Stripe environment.`);
    }
    if (session.mode !== "subscription") {
        throw new Error(`Checkout Session ${session.id} is not a subscription checkout.`);
    }
    if (intent.checkoutSessionId && intent.checkoutSessionId !== session.id) {
        throw new Error(`Checkout Session ${session.id} does not match intent ${intentRef.id}.`);
    }
    if (((_c = session.metadata) === null || _c === void 0 ? void 0 : _c.planKey) !== intent.planKey) {
        throw new Error(`Checkout Session ${session.id} has the wrong membership plan.`);
    }
    if (((_d = session.metadata) === null || _d === void 0 ? void 0 : _d.appAccessTier) !== intent.commercialTerms.appAccessTier) {
        throw new Error(`Checkout Session ${session.id} has the wrong app access tier.`);
    }
    const entitlementPolicy = (0, membershipPlans_1.validateCommercialEntitlementPolicy)(intent.commercialTerms, intent.planKey);
    if (!entitlementPolicy) {
        throw new Error(`Checkout Session ${session.id} has an invalid commercial entitlement policy.`);
    }
    if (intent.planKey === "adult_conditioning" &&
        entitlementPolicy.conditioningBookingPolicy &&
        conditioningPolicyMetadataMismatch(session.metadata, entitlementPolicy.conditioningBookingPolicy)) {
        throw new Error(`Checkout Session ${session.id} has a different conditioning booking policy.`);
    }
    if (intent.planKey === "adult_conditioning" &&
        !entitlementPolicy.conditioningBookingPolicy) {
        const expectedSessionSlots = (0, authz_1.canonicalConditioningSlots)(intent.selectedConditioningSlots);
        if (!expectedSessionSlots || JSON.stringify(expectedSessionSlots) !==
            JSON.stringify(entitlementPolicy.entitlementClassSlots) ||
            ((_e = session.metadata) === null || _e === void 0 ? void 0 : _e.conditioningSlots) !==
                expectedSessionSlots.join(",") ||
            ((_f = session.metadata) === null || _f === void 0 ? void 0 : _f.conditioningPolicyVersion) != null ||
            ((_g = session.metadata) === null || _g === void 0 ? void 0 : _g.conditioningWeeklyLimit) != null ||
            ((_h = session.metadata) === null || _h === void 0 ? void 0 : _h.conditioningEligibleSlots) != null) {
            throw new Error(`Checkout Session ${session.id} has different conditioning slots.`);
        }
    }
    const presale = isPresaleIntent(intent);
    // Some dynamic payment methods complete standard Checkout before funds
    // settle. Keep uniqueness locks alive for its async success/failure event.
    if (session.payment_status === "unpaid") {
        await extendCheckoutReservationForAsyncPayment(intentRef);
        return;
    }
    if (presale) {
        const exactPresaleContract = intent.billingCycleAnchor === membershipPlans_1.PRESALE_BILLING_ANCHOR_UNIX_SECONDS &&
            intent.firstPaymentAt === membershipPlans_1.PRESALE_BILLING_ANCHOR_UNIX_SECONDS &&
            intent.serviceStartsAt === membershipPlans_1.PRESALE_SIGNUP_CUTOFF_UNIX_SECONDS &&
            intent.initialChargePence === 0 &&
            intent.prorationBehavior === "none" &&
            session.status === "complete" &&
            session.payment_status === "no_payment_required" &&
            session.payment_method_collection === "always" &&
            session.amount_total === 0 &&
            session.expires_at === intent.checkoutExpiresAt &&
            completionUnixSeconds <= intent.checkoutExpiresAt &&
            completionUnixSeconds < intent.billingCycleAnchor;
        if (!exactPresaleContract) {
            throw new Error(`Checkout Session ${session.id} does not match the frozen £0 presale contract.`);
        }
    }
    else if (session.payment_status !== "paid") {
        throw new Error(`Checkout Session ${session.id} is not paid (${session.payment_status}).`);
    }
    if (!subscriptionId) {
        throw new Error(`Completed Checkout Session ${session.id} has no subscription.`);
    }
    const commercialTerms = (_j = intent.commercialTerms) !== null && _j !== void 0 ? _j : (0, membershipPlans_1.createCommercialPlanSnapshot)(intent.planKey);
    const subscription = await stripe().subscriptions.retrieve(subscriptionId, {
        expand: ["discounts"],
    });
    assertStripeObjectMode("Subscription", subscription.id, subscription.livemode);
    const sessionCustomerId = idOf(session.customer);
    if (!sessionCustomerId) {
        throw new Error(`Checkout Session ${session.id} has no Stripe customer.`);
    }
    const contractMismatch = stripeSubscriptionContractMismatch(subscription, Object.assign(Object.assign({ planKey: intent.planKey, stripePriceId: intent.stripePriceId, stripeCustomerId: sessionCustomerId, billingCycleAnchor: intent.billingCycleAnchor, appAccessTier: commercialTerms.appAccessTier, intentId: intentRef.id }, (Number.isSafeInteger(intent.participantCount) ? {
        participantCount: intent.participantCount,
    } : {})), (intent.planKey === "adult_conditioning" &&
        entitlementPolicy.conditioningBookingPolicy ? {
        conditioningBookingPolicy: entitlementPolicy.conditioningBookingPolicy,
    } : intent.planKey === "adult_conditioning" ? {
        selectedConditioningSlots: entitlementPolicy.entitlementClassSlots,
    } : {})));
    if (contractMismatch)
        throw new Error(contractMismatch);
    const discount = await resolveApprovedCheckoutDiscount(session, subscription, intent, completionUnixSeconds);
    const membershipRef = db().collection("memberships").doc(subscriptionId);
    const fulfilmentNow = Date.now();
    const contractMadeMillis = Number.isFinite(completionUnixSeconds) &&
        completionUnixSeconds > 0 ?
        completionUnixSeconds * 1000 : fulfilmentNow;
    const pastDueSince = subscription.status === "past_due" ?
        Math.floor(fulfilmentNow / 1000) : null;
    const graceEndMillis = (0, membershipPlans_1.resolvePastDueGraceEndMillis)(pastDueSince);
    const pastDueGraceEndsAt = graceEndMillis === null ?
        null : firestore_1.Timestamp.fromMillis(graceEndMillis);
    const providerState = (0, membershipPlans_1.resolveMembershipState)({
        stripeStatus: subscription.status,
        pastDueSinceUnixSeconds: pastDueSince,
        cancelAtUnixSeconds: subscription.cancel_at,
    }, fulfilmentNow);
    const state = presale && providerState === "active" ?
        "scheduled" : providerState;
    // Stripe collected the billing email during checkout. It is the identity a
    // later claim is matched against, so it takes precedence over anything the
    // intent captured before payment.
    const stripeEmail = ((_l = (_k = session.customer_details) === null || _k === void 0 ? void 0 : _k.email) === null || _l === void 0 ? void 0 : _l.trim().toLowerCase()) ||
        intent.payerEmail ||
        null;
    const membership = Object.assign(Object.assign({ schemaVersion: membershipPlans_1.MEMBERSHIP_SCHEMA_VERSION, subscriptionId, stripeCustomerId: typeof session.customer === "string" ?
            session.customer :
            (_o = (_m = session.customer) === null || _m === void 0 ? void 0 : _m.id) !== null && _o !== void 0 ? _o : "", checkoutSessionId: session.id, checkoutAttemptHash: intent.checkoutAttemptHash, payerUid: intent.payerUid, payerEmail: stripeEmail, fulfilledAt: serverTimestamp(), claimedAt: intent.payerUid ? serverTimestamp() : null, planKey: intent.planKey, stripePriceId: intent.stripePriceId, commercialTerms }, (intent.selectedConditioningSlots ? {
        selectedConditioningSlots: intent.selectedConditioningSlots,
    } : {})), { planName: commercialTerms.planName, grantsAlphaWodAccess: commercialTerms.grantsAlphaWodAccess, participant: intent.participant, participants: participantsFor(intent), participantKeys: participantKeysFor(intent), participantCount: participantCountFor(intent), order: orderFor(intent), guardian: intent.guardian, acceptances: Object.assign(Object.assign({}, intent.acceptances), { contractMadeAt: firestore_1.Timestamp.fromMillis(contractMadeMillis), coolingOffEndsAt: (0, membershipPlans_1.resolveCoolingOffEnd)(contractMadeMillis) }), state, stripeStatus: subscription.status, 
        // Access is granted only to an account that bought this for itself. An
        // unclaimed purchase has no account yet, so the target stays null until
        // `claimMembership` attaches one. A purchase made for another person is
        // linked by an administrator instead.
        entitlementTargetUid: commercialTerms.grantsAlphaWodAccess && intent.participant.isPayer ?
            intent.payerUid :
            null, preMembershipEntitlement: null, currentPeriodEnd: resolveCurrentPeriodEnd(subscription), billingMode: (_p = intent.billingMode) !== null && _p !== void 0 ? _p : "standard", billingCycleAnchor: intent.billingCycleAnchor, serviceStartsAt: (_q = intent.serviceStartsAt) !== null && _q !== void 0 ? _q : Math.floor(contractMadeMillis / 1000), firstPaymentAt: (_r = intent.firstPaymentAt) !== null && _r !== void 0 ? _r : intent.billingCycleAnchor, initialChargePence: (_s = session.amount_total) !== null && _s !== void 0 ? _s : null, firstPaymentReceivedAt: presale ? null : Math.floor(contractMadeMillis / 1000), firstPaidInvoiceId: null, discount, paymentSchedule: paymentScheduleFor(intent, discount, (_t = session.amount_total) !== null && _t !== void 0 ? _t : null), pastDueSince,
        pastDueGraceEndsAt, nextReconcileAt: state === "scheduled" ?
            firestore_1.Timestamp.fromMillis(((_u = intent.firstPaymentAt) !== null && _u !== void 0 ? _u : intent.billingCycleAnchor) * 1000) :
            state === "past_due_grace" ? pastDueGraceEndsAt :
                state === "past_due_suspended" ? firestore_1.Timestamp.fromMillis(fulfilmentNow + SUSPENDED_RECONCILE_INTERVAL_MS) : null, openDisputeIds: [], disputeOpen: false, accessRevoked: false, providerContractStatus: "verified", cancelAt: (_v = subscription.cancel_at) !== null && _v !== void 0 ? _v : null, cancellationRequestedAt: null, cancellationOutcome: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    // Membership state and its durable confirmation are accepted atomically.
    // A replay never overwrites a membership that has moved on, but it can heal
    // a missing outbox row from an interrupted earlier version of the handler.
    await ensureMembershipAndConfirmationOutbox(membershipRef, membership, (_w = session.amount_total) !== null && _w !== void 0 ? _w : null, intentRef, intent);
    await transitionCheckoutReservation(intentRef, "fulfilled", {
        subscriptionId,
        fulfilledAt: serverTimestamp(),
    });
    // Re-read authoritative Stripe state after the membership exists. This also
    // heals an invoice/subscription event that arrived before Checkout fulfilment
    // and guarantees a past-due membership has a bounded grace deadline.
    await convergeMembershipFromStripe(subscriptionId, converge, {}, fulfilmentNow);
    // The scheduled sender owns delivery. Webhook completion therefore never
    // depends on Resend availability, and every retry uses the frozen outbox
    // payload rather than waiting for another unrelated Stripe event.
    await writeAudit({
        type: "checkout_fulfilled",
        subscriptionId,
        payerUid: intent.payerUid,
        planKey: intent.planKey,
        state,
    });
}
/**
 * Resolves the membership a charge belongs to.
 *
 * `Charge` no longer carries an `invoice` field, so the link runs through the
 * charge's PaymentIntent and the invoice payment recorded against it. If that
 * Customer identity alone is never enough: a customer can have sequential
 * subscriptions and unrelated one-off charges. If invoice linkage is missing,
 * an app-owned customer is sent through durable retry/manual review instead of
 * guessing and revoking the wrong membership.
 */
async function findMembershipIdForCharge(charge) {
    const paymentIntentId = idOf(charge.payment_intent);
    if (paymentIntentId) {
        const payments = await stripe().invoicePayments.list({
            payment: { type: "payment_intent", payment_intent: paymentIntentId },
            limit: 10,
        });
        for (const payment of payments.data) {
            const invoiceId = idOf(payment.invoice);
            if (!invoiceId)
                continue;
            const invoice = await stripe().invoices.retrieve(invoiceId);
            assertStripeObjectMode("Invoice", invoice.id, invoice.livemode);
            const subscriptionId = resolveInvoiceSubscriptionId(invoice);
            if (subscriptionId)
                return subscriptionId;
        }
    }
    const customerId = idOf(charge.customer);
    if (!customerId)
        return null;
    const byCustomer = await db()
        .collection("memberships")
        .where("stripeCustomerId", "==", customerId)
        .get();
    if (byCustomer.empty)
        return null;
    console.error("CRITICAL_BILLING_UNRESOLVED_CHARGE_MEMBERSHIP", {
        chargeId: charge.id,
        customerId,
        membershipIds: byCustomer.docs.map((doc) => doc.id),
    });
    // Retrying may heal a temporarily unavailable invoice-payment link. If it
    // never becomes resolvable, the durable Stripe event reaches manual review.
    throw new Error(`Charge ${charge.id} has no authoritative invoice-to-membership link.`);
}
function idOf(value) {
    if (typeof value === "string")
        return value;
    if (value && typeof value === "object" && "id" in value) {
        return String(value.id);
    }
    return null;
}
/** Returns the first immutable provider-contract mismatch, or null when safe. */
function stripeSubscriptionContractMismatch(subscription, expected) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    if (subscription.collection_method !== "charge_automatically") {
        return `Subscription ${subscription.id} is not collected automatically.`;
    }
    if (subscription.pause_collection !== null) {
        return `Subscription ${subscription.id} has payment collection paused.`;
    }
    if (subscription.status === "trialing" || subscription.trial_start !== null ||
        subscription.trial_end !== null) {
        return `Subscription ${subscription.id} has an unapproved trial.`;
    }
    if (((_a = subscription.metadata) === null || _a === void 0 ? void 0 : _a.planKey) !== expected.planKey) {
        return `Subscription ${subscription.id} has the wrong plan metadata.`;
    }
    if (expected.appAccessTier !== undefined &&
        ((_b = subscription.metadata) === null || _b === void 0 ? void 0 : _b.appAccessTier) !== expected.appAccessTier) {
        return `Subscription ${subscription.id} has the wrong app access tier.`;
    }
    if (expected.selectedConditioningSlots) {
        const expectedSlots = (0, authz_1.canonicalConditioningSlots)(expected.selectedConditioningSlots);
        if (!expectedSlots ||
            ((_c = subscription.metadata) === null || _c === void 0 ? void 0 : _c.conditioningSlots) !== expectedSlots.join(",") ||
            ((_d = subscription.metadata) === null || _d === void 0 ? void 0 : _d.conditioningPolicyVersion) != null ||
            ((_e = subscription.metadata) === null || _e === void 0 ? void 0 : _e.conditioningWeeklyLimit) != null ||
            ((_f = subscription.metadata) === null || _f === void 0 ? void 0 : _f.conditioningEligibleSlots) != null) {
            return `Subscription ${subscription.id} has different conditioning slots.`;
        }
    }
    if (expected.conditioningBookingPolicy &&
        conditioningPolicyMetadataMismatch(subscription.metadata, expected.conditioningBookingPolicy)) {
        return `Subscription ${subscription.id} has a different conditioning booking policy.`;
    }
    if (expected.intentId && ((_g = subscription.metadata) === null || _g === void 0 ? void 0 : _g.intentId) !== expected.intentId) {
        return `Subscription ${subscription.id} has the wrong checkout intent metadata.`;
    }
    if (idOf(subscription.customer) !== expected.stripeCustomerId) {
        return `Subscription ${subscription.id} has the wrong Stripe customer.`;
    }
    if (subscription.billing_cycle_anchor !== expected.billingCycleAnchor) {
        return `Subscription ${subscription.id} has a different billing-cycle anchor.`;
    }
    const items = subscription.items.data;
    if (items.length !== 1) {
        return `Subscription ${subscription.id} does not have exactly one membership item.`;
    }
    if (idOf(items[0].price) !== expected.stripePriceId) {
        return `Subscription ${subscription.id} has a different membership Price.`;
    }
    const expectedQuantity = (_h = expected.participantCount) !== null && _h !== void 0 ? _h : 1;
    if (items[0].quantity !== expectedQuantity) {
        return `Subscription ${subscription.id} does not have quantity ${expectedQuantity}.`;
    }
    if (expected.discountCouponId !== undefined) {
        const discounts = (_j = subscription.discounts) !== null && _j !== void 0 ? _j : [];
        if (expected.discountCouponId === null && discounts.length !== 0) {
            return `Subscription ${subscription.id} carries an unexpected discount.`;
        }
        if (expected.discountCouponId !== null) {
            if (discounts.length !== 1 || typeof discounts[0] === "string") {
                return `Subscription ${subscription.id} does not carry its approved discount.`;
            }
            const compatibleDiscount = discounts[0];
            const couponId = (_k = idOf(compatibleDiscount.coupon)) !== null && _k !== void 0 ? _k : idOf((_l = compatibleDiscount.source) === null || _l === void 0 ? void 0 : _l.coupon);
            if (couponId !== expected.discountCouponId) {
                return `Subscription ${subscription.id} carries a different discount.`;
            }
        }
    }
    return null;
}
/**
 * Resolves the subscription an invoice belongs to.
 *
 * The current API exposes this on `invoice.parent.subscription_details`. The
 * line-item and legacy top-level paths are kept as fallbacks so an account
 * pinned to an older API version still resolves.
 */
function resolveInvoiceSubscriptionId(invoice) {
    var _a, _b, _c, _d, _e;
    const fromParent = idOf((_b = (_a = invoice.parent) === null || _a === void 0 ? void 0 : _a.subscription_details) === null || _b === void 0 ? void 0 : _b.subscription);
    if (fromParent)
        return fromParent;
    for (const line of (_d = (_c = invoice.lines) === null || _c === void 0 ? void 0 : _c.data) !== null && _d !== void 0 ? _d : []) {
        const parent = line.parent;
        const fromLine = idOf((_e = parent === null || parent === void 0 ? void 0 : parent.subscription_item_details) === null || _e === void 0 ? void 0 : _e.subscription);
        if (fromLine)
            return fromLine;
    }
    return idOf(invoice.subscription);
}
const STRIPE_EVENT_LEASE_MS = 10 * 60 * 1000;
const STRIPE_EVENT_MAX_ATTEMPTS = 12;
const STRIPE_EVENT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
function stripeEventRetryAtMillis(attemptCount, nowMillis) {
    const exponent = Math.max(0, Math.min(attemptCount - 1, 6));
    return nowMillis + Math.min(60 * 60 * 1000, 60 * 1000 * (2 ** exponent));
}
/**
 * Claims a recoverable processing lease for one Stripe event. A plain
 * create-if-absent ledger loses an event forever if the process dies after the
 * create but before handling. Status plus an expiring lease lets a later
 * delivery distinguish completed work from an abandoned attempt.
 */
async function acquireStripeEventLease(event, nowMillis = Date.now(), leaseToken = (0, crypto_1.randomUUID)()) {
    const ledgerRef = db().collection("stripeEvents").doc(event.id);
    let newlyTerminal = false;
    const result = await db().runTransaction(async (tx) => {
        const snap = await tx.get(ledgerRef);
        if (snap.exists && snap.get("status") === "processed") {
            return { state: "processed" };
        }
        if (snap.exists && snap.get("status") === "dead_letter") {
            return { state: "terminal" };
        }
        const activeLeaseExpiresAt = snap.exists ?
            timestampMillis(snap.get("leaseExpiresAt")) : null;
        if (snap.exists && snap.get("status") === "processing" &&
            activeLeaseExpiresAt !== null && activeLeaseExpiresAt > nowMillis) {
            return { state: "in_progress" };
        }
        const nextAttemptAt = snap.exists ?
            timestampMillis(snap.get("nextAttemptAt")) : null;
        if (snap.exists && snap.get("status") === "failed" &&
            nextAttemptAt !== null && nextAttemptAt > nowMillis) {
            return { state: "deferred" };
        }
        const attemptCount = snap.exists && typeof snap.get("attemptCount") === "number" ?
            snap.get("attemptCount") : 0;
        const stripeCreated = snap.exists && typeof snap.get("stripeCreated") === "number" ?
            snap.get("stripeCreated") : event.created;
        if (attemptCount >= STRIPE_EVENT_MAX_ATTEMPTS ||
            nowMillis - stripeCreated * 1000 >= STRIPE_EVENT_MAX_AGE_MS) {
            newlyTerminal = true;
            tx.set(ledgerRef, {
                type: event.type,
                stripeCreated,
                status: "dead_letter",
                deadLetteredAt: serverTimestamp(),
                deadLetterReason: "Stripe event retry budget exhausted.",
                leaseToken: firestore_1.FieldValue.delete(),
                leaseExpiresAt: firestore_1.FieldValue.delete(),
                nextAttemptAt: firestore_1.FieldValue.delete(),
                updatedAt: serverTimestamp(),
            }, { merge: true });
            return { state: "terminal" };
        }
        const leaseExpiresAt = firestore_1.Timestamp.fromMillis(nowMillis + STRIPE_EVENT_LEASE_MS);
        tx.set(ledgerRef, Object.assign(Object.assign({ type: event.type, stripeCreated: event.created, status: "processing", leaseToken,
            leaseExpiresAt, 
            // A crashed invocation becomes discoverable by the scheduled worker as
            // soon as its lease expires.
            nextAttemptAt: leaseExpiresAt, attemptCount: attemptCount + 1, lastAttemptAt: serverTimestamp() }, (snap.exists ? {} : { receivedAt: serverTimestamp() })), { lastError: firestore_1.FieldValue.delete(), failedAt: firestore_1.FieldValue.delete() }), { merge: true });
        return { state: "acquired", leaseToken };
    });
    if (newlyTerminal) {
        console.error("CRITICAL_BILLING_STRIPE_EVENT_DEAD_LETTER", {
            eventId: event.id,
            eventType: event.type,
        });
        await writeAudit({
            type: "stripe_event_dead_lettered",
            severity: "critical",
            stripeEventId: event.id,
            stripeEventType: event.type,
            reason: "retry_budget_exhausted",
        }).catch((error) => console.error("Could not write dead-letter audit", event.id, error));
    }
    return result;
}
async function markStripeEventProcessed(eventId, leaseToken) {
    const ledgerRef = db().collection("stripeEvents").doc(eventId);
    return db().runTransaction(async (tx) => {
        const snap = await tx.get(ledgerRef);
        if (!snap.exists || snap.get("status") !== "processing" ||
            snap.get("leaseToken") !== leaseToken)
            return false;
        tx.set(ledgerRef, {
            status: "processed",
            processedAt: serverTimestamp(),
            leaseToken: firestore_1.FieldValue.delete(),
            leaseExpiresAt: firestore_1.FieldValue.delete(),
            nextAttemptAt: firestore_1.FieldValue.delete(),
            lastError: firestore_1.FieldValue.delete(),
        }, { merge: true });
        return true;
    });
}
async function markStripeEventFailed(eventId, leaseToken, error, nowMillis = Date.now()) {
    var _a;
    const ledgerRef = db().collection("stripeEvents").doc(eventId);
    const outcome = await db().runTransaction(async (tx) => {
        const snap = await tx.get(ledgerRef);
        if (!snap.exists || snap.get("status") !== "processing" ||
            snap.get("leaseToken") !== leaseToken)
            return null;
        const message = error instanceof Error ? error.message : String(error);
        const attemptCount = typeof snap.get("attemptCount") === "number" ?
            snap.get("attemptCount") : 1;
        const stripeCreated = typeof snap.get("stripeCreated") === "number" ?
            snap.get("stripeCreated") : Math.floor(nowMillis / 1000);
        const terminal = attemptCount >= STRIPE_EVENT_MAX_ATTEMPTS ||
            nowMillis - stripeCreated * 1000 >= STRIPE_EVENT_MAX_AGE_MS;
        const terminalMessage = message.slice(0, 1000);
        tx.set(ledgerRef, Object.assign({ status: terminal ? "dead_letter" : "failed", failedAt: serverTimestamp(), lastError: message.slice(0, 1000), leaseToken: firestore_1.FieldValue.delete(), leaseExpiresAt: firestore_1.FieldValue.delete() }, (terminal ? {
            deadLetteredAt: serverTimestamp(),
            nextAttemptAt: firestore_1.FieldValue.delete(),
        } : {
            nextAttemptAt: firestore_1.Timestamp.fromMillis(stripeEventRetryAtMillis(attemptCount, nowMillis)),
        })), { merge: true });
        return { terminal, terminalMessage };
    });
    if (outcome === null || outcome === void 0 ? void 0 : outcome.terminal) {
        console.error("CRITICAL_BILLING_STRIPE_EVENT_DEAD_LETTER", {
            eventId,
            error: outcome.terminalMessage,
        });
        await writeAudit({
            type: "stripe_event_dead_lettered",
            severity: "critical",
            stripeEventId: eventId,
            error: outcome.terminalMessage,
        }).catch((auditError) => console.error("Could not write dead-letter audit", eventId, auditError));
    }
    return (_a = outcome === null || outcome === void 0 ? void 0 : outcome.terminal) !== null && _a !== void 0 ? _a : false;
}
async function processStripeEventUnderLease(event, leaseToken, converge, dispatchExternalEvent) {
    try {
        const handledExternally = dispatchExternalEvent ?
            await dispatchExternalEvent(event) : false;
        if (!handledExternally) {
            await handleStripeEvent(event, converge);
        }
        const marked = await markStripeEventProcessed(event.id, leaseToken);
        if (!marked) {
            throw new Error("The Stripe event processing lease changed before completion.");
        }
    }
    catch (error) {
        await markStripeEventFailed(event.id, leaseToken, error).catch((ledgerError) => console.error("Could not record Stripe webhook failure", event.id, ledgerError));
        throw error;
    }
}
/**
 * Stripe webhook endpoint.
 *
 * The signature is verified against the raw body before anything is read, and
 * every event is recorded in a recoverable lease ledger so redelivery cannot
 * apply completed work twice while a crashed handler can still be retried.
 */
function buildStripeWebhook(converge, dispatchExternalEvent, webhookSecrets = exports.MEMBERSHIP_WEBHOOK_SECRETS) {
    return (0, https_1.onRequest)({ region: REGION, secrets: webhookSecrets, cors: false }, async (req, res) => {
        if (req.method !== "POST") {
            res.status(405).send("Method Not Allowed");
            return;
        }
        try {
            // Fail before writing the webhook receipt/lease in Firestore.
            assertBillingEnvironment();
        }
        catch (error) {
            console.error("Rejected Stripe webhook in an invalid billing environment", error);
            res.status(503).send("Billing environment unavailable.");
            return;
        }
        const signature = req.get("stripe-signature");
        const webhookSecret = stripeWebhookSecret.value();
        if (!signature || !webhookSecret) {
            res.status(400).send("Missing signature.");
            return;
        }
        let event;
        try {
            event = stripe().webhooks.constructEvent(req.rawBody, signature, webhookSecret);
        }
        catch (error) {
            console.error("Rejected Stripe webhook signature", error);
            res.status(400).send("Invalid signature.");
            return;
        }
        try {
            assertStripeObjectMode("Event", event.id, event.livemode);
        }
        catch (error) {
            console.error("Rejected Stripe webhook from the wrong mode", event.id, error);
            res.status(400).send("Wrong Stripe mode.");
            return;
        }
        let lease;
        try {
            lease = await acquireStripeEventLease(event);
        }
        catch (error) {
            console.error("Stripe webhook lease acquisition failed", event.id, error);
            res.status(500).send("Ledger error.");
            return;
        }
        if (lease.state === "processed") {
            res.status(200).send("Already processed.");
            return;
        }
        if (lease.state === "terminal") {
            res.status(200).send("Accepted for manual review.");
            return;
        }
        if (lease.state === "in_progress" || lease.state === "deferred") {
            res.set("Retry-After", "5");
            res.status(409).send("Event processing is deferred; retry.");
            return;
        }
        try {
            await processStripeEventUnderLease(event, lease.leaseToken, converge, dispatchExternalEvent);
            res.status(200).send("ok");
        }
        catch (error) {
            console.error("Stripe webhook handling failed", event.id, event.type, error);
            res.status(500).send("Handler error.");
        }
    });
}
/** Reclaims due failed/crashed events and retrieves the signed object from Stripe. */
async function recoverDueStripeEventsOnce(converge, nowMillis = Date.now(), limit = 50, dispatchExternalEvent) {
    assertBillingEnvironment();
    const due = await db().collection("stripeEvents")
        .where("nextAttemptAt", "<=", firestore_1.Timestamp.fromMillis(nowMillis))
        .orderBy("nextAttemptAt", "asc")
        .limit(limit)
        .get();
    const result = { processed: 0, failed: 0, skipped: 0 };
    for (const ledger of due.docs) {
        const itemNow = Math.max(nowMillis, Date.now());
        const eventStub = {
            id: ledger.id,
            type: String(ledger.get("type") || "unknown"),
            created: typeof ledger.get("stripeCreated") === "number" ?
                ledger.get("stripeCreated") : Math.floor(itemNow / 1000),
        };
        const lease = await acquireStripeEventLease(eventStub, itemNow);
        if (lease.state !== "acquired") {
            result.skipped += 1;
            continue;
        }
        try {
            const event = await stripe().events.retrieve(ledger.id);
            assertStripeObjectMode("Event", event.id, event.livemode);
            await processStripeEventUnderLease(event, lease.leaseToken, converge, dispatchExternalEvent);
            result.processed += 1;
        }
        catch (error) {
            // Retrieval and handler failures are already recorded by the shared
            // processor only after retrieval. Record retrieval failures here too.
            const fresh = await ledger.ref.get();
            if (fresh.get("status") === "processing" &&
                fresh.get("leaseToken") === lease.leaseToken) {
                await markStripeEventFailed(ledger.id, lease.leaseToken, error, Math.max(itemNow, Date.now()));
            }
            console.error("Scheduled Stripe event recovery failed", ledger.id, error);
            result.failed += 1;
        }
    }
    return result;
}
function buildRecoverStripeEvents(converge, dispatchExternalEvent, workerSecrets = exports.MEMBERSHIP_STRIPE_WORKER_SECRETS) {
    return (0, scheduler_1.onSchedule)({
        region: REGION,
        schedule: "every 5 minutes",
        timeZone: "UTC",
        secrets: workerSecrets,
        timeoutSeconds: 540,
    }, async () => {
        const result = await recoverDueStripeEventsOnce(converge, Date.now(), 50, dispatchExternalEvent);
        console.log("Stripe event recovery result", result);
    });
}
async function handleStripeEvent(event, converge) {
    var _a, _b, _c, _d, _e;
    switch (event.type) {
        case "checkout.session.completed":
        case "checkout.session.async_payment_succeeded": {
            const trigger = event.data.object;
            if (typeof trigger.id !== "string" || !trigger.id) {
                throw new Error(`Stripe event ${event.id} has no Checkout Session id.`);
            }
            // Webhook endpoint versions can lag the deployed SDK schema. Treat the
            // signed payload only as a trigger, then fulfil from Stripe's authoritative
            // current-API representation with its applied discounts expanded.
            const session = await stripe().checkout.sessions.retrieve(trigger.id, {
                expand: ["discounts.coupon", "discounts.promotion_code"],
            });
            assertStripeObjectMode("Checkout Session", session.id, session.livemode);
            await fulfilCheckoutSession(session, converge, event.created);
            return;
        }
        case "checkout.session.expired":
        case "checkout.session.async_payment_failed": {
            const session = event.data.object;
            assertStripeObjectMode("Checkout Session", session.id, session.livemode);
            const intentId = (_a = session.metadata) === null || _a === void 0 ? void 0 : _a.intentId;
            if (intentId) {
                const status = event.type === "checkout.session.expired" ? "expired" : "failed";
                await transitionCheckoutReservation(db().collection("membershipIntents").doc(intentId), status, {
                    endedByStripeEvent: event.type,
                    endedAt: serverTimestamp(),
                }, true, {
                    sessionId: session.id,
                    mode: session.mode,
                    planKey: (_c = (_b = session.metadata) === null || _b === void 0 ? void 0 : _b.planKey) !== null && _c !== void 0 ? _c : null,
                });
            }
            return;
        }
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted":
        case "customer.subscription.paused":
        case "customer.subscription.resumed": {
            const subscription = event.data.object;
            await convergeMembershipFromStripe(subscription.id, converge);
            return;
        }
        case "invoice.paid": {
            const trigger = event.data.object;
            if (typeof trigger.id !== "string" || !trigger.id) {
                throw new Error(`Stripe event ${event.id} has no Invoice id.`);
            }
            // Line parent/pricing shapes changed across Stripe API versions. Retrieve
            // the current invoice before constructing activation evidence so an older
            // webhook snapshot can never falsely grant or withhold access.
            const invoice = await stripe().invoices.retrieve(trigger.id);
            assertStripeObjectMode("Invoice", invoice.id, invoice.livemode);
            const subscriptionId = resolveInvoiceSubscriptionId(invoice);
            if (subscriptionId) {
                const paidAt = (_e = (_d = invoice.status_transitions) === null || _d === void 0 ? void 0 : _d.paid_at) !== null && _e !== void 0 ? _e : event.created;
                const activationPayment = invoice.status === "paid" &&
                    typeof invoice.amount_paid === "number" && invoice.amount_paid > 0 &&
                    typeof paidAt === "number" && typeof invoice.currency === "string" ? {
                    invoiceId: invoice.id,
                    paidAt,
                    amountPaidPence: invoice.amount_paid,
                    currency: invoice.currency,
                    lines: subscriptionLineEvidence(invoice),
                } : undefined;
                await convergeMembershipFromStripe(subscriptionId, converge, Object.assign({ pastDueSince: null }, (activationPayment ? { activationPayment } : {})));
            }
            return;
        }
        case "invoice.payment_failed": {
            const invoice = event.data.object;
            const subscriptionId = resolveInvoiceSubscriptionId(invoice);
            // This warning is the PII-free source for the business-owner missed-payment
            // alert. Keep it to Stripe identifiers and the signed event timestamp: the
            // Cloud Monitoring notification route, not application code, delivers the
            // alert email.
            if (subscriptionId) {
                const appOwnedMembership = await db()
                    .collection("memberships")
                    .doc(subscriptionId)
                    .get();
                if (appOwnedMembership.exists) {
                    console.warn("BILLING_PAYMENT_FAILED", {
                        stripeEventId: event.id,
                        stripeInvoiceId: typeof invoice.id === "string" ? invoice.id : null,
                        stripeSubscriptionId: subscriptionId,
                        stripeEventCreated: event.created,
                    });
                }
                // `due_date` is meaningful only for manually sent invoices. Automatic
                // invoices can be created/finalised well before the failed collection
                // attempt, so their grace period starts at the signed failure event.
                const pastDueSince = invoice.collection_method === "send_invoice" &&
                    typeof invoice.due_date === "number" ?
                    invoice.due_date : event.created;
                await convergeMembershipFromStripe(subscriptionId, converge, { pastDueSince });
            }
            return;
        }
        case "charge.dispute.created":
        case "charge.dispute.closed": {
            const delivered = event.data.object;
            // The event snapshot may be older than another delivered event. Retrieve
            // the current Dispute so a delayed `created` can never reopen a won/closed
            // dispute or undo a lost-dispute revocation.
            const dispute = await stripe().disputes.retrieve(delivered.id);
            assertStripeObjectMode("Dispute", dispute.id, dispute.livemode);
            const subscriptionId = await findMembershipIdForDispute(dispute);
            if (!subscriptionId)
                return;
            await convergeMembershipFromStripe(subscriptionId, converge, Object.assign({ dispute: { id: dispute.id, status: dispute.status } }, (dispute.status === "lost" ? { accessRevoked: true } : {})));
            return;
        }
        case "charge.refunded": {
            const charge = event.data.object;
            const fullyRefunded = charge.amount_refunded >= charge.amount;
            if (!fullyRefunded)
                return;
            const subscriptionId = await findMembershipIdForCharge(charge);
            if (subscriptionId) {
                await convergeMembershipFromStripe(subscriptionId, converge, { accessRevoked: true });
            }
            return;
        }
        default:
            return;
    }
}
async function findMembershipIdForDispute(dispute) {
    var _a;
    const chargeId = typeof dispute.charge === "string" ? dispute.charge : (_a = dispute.charge) === null || _a === void 0 ? void 0 : _a.id;
    if (!chargeId)
        return null;
    const charge = await stripe().charges.retrieve(chargeId);
    assertStripeObjectMode("Charge", charge.id, charge.livemode);
    return findMembershipIdForCharge(charge);
}
function emptyAdminMembershipSummaryBucket() {
    return {
        totalSubscriptions: 0,
        openSubscriptions: 0,
        openParticipants: 0,
        currentSubscriptions: 0,
        scheduledSubscriptions: 0,
        paymentIssueSubscriptions: 0,
        awaitingPaymentSubscriptions: 0,
        endedSubscriptions: 0,
        projectedMonthlyPence: 0,
        atRiskMonthlyPence: 0,
    };
}
/**
 * Returns the membership's current contracted monthly amount from frozen
 * server-side commercial evidence. This is a projection, not cash received.
 */
function adminMembershipFinancialProjectionFor(membership, asOfUnixSeconds = Math.floor(Date.now() / 1000)) {
    var _a, _b;
    const order = orderFor(membership);
    const schedule = membership.paymentSchedule;
    const standardMonthlyPence = Number.isSafeInteger(schedule === null || schedule === void 0 ? void 0 : schedule.standardMonthlyPence) &&
        schedule.standardMonthlyPence >= 0 ?
        schedule.standardMonthlyPence : order.standardMonthlyPence;
    const discountedMonthlyPence = Number.isSafeInteger(schedule === null || schedule === void 0 ? void 0 : schedule.discountedMonthlyPence) &&
        (schedule === null || schedule === void 0 ? void 0 : schedule.discountedMonthlyPence) >= 0 ?
        schedule === null || schedule === void 0 ? void 0 : schedule.discountedMonthlyPence : null;
    const fullPriceFrom = typeof (schedule === null || schedule === void 0 ? void 0 : schedule.fullPriceFrom) === "number" ?
        schedule.fullPriceFrom : null;
    const discountEndsAt = typeof ((_a = membership.discount) === null || _a === void 0 ? void 0 : _a.endsAt) === "number" ?
        membership.discount.endsAt : null;
    const discountIsForever = ((_b = membership.discount) === null || _b === void 0 ? void 0 : _b.duration) === "forever";
    const discountIsActive = discountedMonthlyPence !== null && Boolean(membership.discount) && (discountIsForever ||
        (fullPriceFrom !== null && asOfUnixSeconds < fullPriceFrom) ||
        (fullPriceFrom === null && discountEndsAt !== null && asOfUnixSeconds < discountEndsAt));
    const monthlyRecurringPence = discountIsActive ?
        discountedMonthlyPence : standardMonthlyPence;
    if (membership.accessRevoked || membership.state === "cancelled" ||
        membership.state === "revoked" || membership.state === "incomplete") {
        return { monthlyRecurringPence, revenueState: "excluded" };
    }
    if (membership.disputeOpen || membership.state === "disputed" ||
        membership.state === "past_due_grace" || membership.state === "past_due_suspended") {
        return { monthlyRecurringPence, revenueState: "at_risk" };
    }
    return { monthlyRecurringPence, revenueState: "projected" };
}
function applyAdminMembershipToSummaryBucket(bucket, membership, projection) {
    bucket.totalSubscriptions += 1;
    const participantCount = participantCountFor(membership);
    if (projection.revenueState !== "excluded") {
        bucket.openSubscriptions += 1;
        bucket.openParticipants += participantCount;
    }
    if (membership.state === "active" && projection.revenueState === "projected") {
        bucket.currentSubscriptions += 1;
    }
    if (membership.state === "scheduled" && projection.revenueState === "projected") {
        bucket.scheduledSubscriptions += 1;
    }
    if (membership.state === "incomplete")
        bucket.awaitingPaymentSubscriptions += 1;
    if (membership.state === "cancelled" || membership.state === "revoked") {
        bucket.endedSubscriptions += 1;
    }
    if (projection.revenueState === "projected") {
        bucket.projectedMonthlyPence += projection.monthlyRecurringPence;
    }
    if (projection.revenueState === "at_risk") {
        bucket.paymentIssueSubscriptions += 1;
        bucket.atRiskMonthlyPence += projection.monthlyRecurringPence;
    }
}
function buildAdminMembershipFinancialSummary(memberships, asOfUnixSeconds = Math.floor(Date.now() / 1000)) {
    const totals = emptyAdminMembershipSummaryBucket();
    const plans = Object.fromEntries(membershipPlans_1.PLAN_KEYS.map((planKey) => [
        planKey,
        Object.assign({ planKey, planName: (0, membershipPlans_1.getPlan)(planKey).name }, emptyAdminMembershipSummaryBucket()),
    ]));
    for (const membership of memberships) {
        const projection = adminMembershipFinancialProjectionFor(membership, asOfUnixSeconds);
        applyAdminMembershipToSummaryBucket(totals, membership, projection);
        applyAdminMembershipToSummaryBucket(plans[membership.planKey], membership, projection);
    }
    return Object.assign(Object.assign({ asOf: new Date(asOfUnixSeconds * 1000).toISOString() }, totals), { plans: membershipPlans_1.PLAN_KEYS.map((planKey) => plans[planKey]) });
}
function buildListMemberships(requireAdmin) {
    return (0, https_1.onCall)({ region: REGION }, async (request) => {
        requireAuthUid(request);
        await requireAdmin(request);
        const [snap, checkoutIssueSnap] = await Promise.all([
            db().collection("memberships").orderBy("createdAt", "desc").limit(500).get(),
            db().collection("membershipIntents")
                .orderBy("createdAt", "desc")
                .limit(500)
                .get(),
        ]);
        const receiptIds = Array.from(new Set(snap.docs.flatMap((doc) => {
            var _a;
            const receiptId = (_a = doc.data().cancellationRequest) === null || _a === void 0 ? void 0 : _a.receiptId;
            return typeof receiptId === "string" && receiptId ? [receiptId] : [];
        })));
        const receiptSnaps = await Promise.all(receiptIds.map((receiptId) => db().collection(membershipCancellation_1.MEMBERSHIP_CANCELLATION_RECEIPT_COLLECTION)
            .doc(receiptId).get()));
        const receipts = new Map(receiptSnaps
            .filter((receipt) => receipt.exists)
            .map((receipt) => [receipt.id, receipt.data()]));
        const asOfUnixSeconds = Math.floor(Date.now() / 1000);
        const storedMemberships = snap.docs.map((doc) => doc.data());
        const checkoutIssues = checkoutIssueSnap.docs.filter((doc) => {
            const intent = doc.data();
            const resumableRelease = intent.status === "expired" &&
                hasCheckoutRecoveryReleaseClaim(doc.id, intent) &&
                !hasStaffCheckoutRecoveryEmailMarker(doc.id, intent);
            return intent.status === "reserved" || intent.status === "created" ||
                intent.status === "payment_pending" || resumableRelease;
        }).map((doc) => {
            var _a, _b, _c, _d;
            const intent = doc.data();
            const participants = participantsFor(intent);
            const createdAt = timestampMillis(intent.createdAt);
            const resumableRelease = intent.status === "expired" &&
                hasCheckoutRecoveryReleaseClaim(doc.id, intent) &&
                !hasStaffCheckoutRecoveryEmailMarker(doc.id, intent);
            return Object.assign(Object.assign({ intentId: doc.id, planKey: intent.planKey, planName: (_b = (_a = intent.commercialTerms) === null || _a === void 0 ? void 0 : _a.planName) !== null && _b !== void 0 ? _b : (0, membershipPlans_1.getPlan)(intent.planKey).name }, conditioningEntitlementProjection(intent.commercialTerms, intent.planKey)), { participantFullNames: participants.map(({ fullName }) => fullName), participantCount: participantCountFor(intent), payerUid: (_c = intent.payerUid) !== null && _c !== void 0 ? _c : null, payerEmail: (_d = intent.payerEmail) !== null && _d !== void 0 ? _d : null, status: resumableRelease ? "release_claimed" :
                    intent.status, createdAt, checkoutExpiresAt: intent.checkoutExpiresAt, canRelease: (intent.status === "created" || resumableRelease) &&
                    typeof intent.checkoutSessionId === "string" &&
                    Boolean(intent.checkoutSessionId) &&
                    typeof intent.checkoutSessionUrl === "string" &&
                    Boolean(intent.checkoutSessionUrl) &&
                    createdAt !== null &&
                    createdAt <= Date.now() - CHECKOUT_MANUAL_RELEASE_MIN_AGE_MS });
        }).sort((left, right) => { var _a, _b; return ((_a = right.createdAt) !== null && _a !== void 0 ? _a : 0) - ((_b = left.createdAt) !== null && _b !== void 0 ? _b : 0); });
        const memberships = snap.docs.map((doc) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12, _13, _14, _15, _16;
            const membership = doc.data();
            const participants = participantsFor(membership);
            const financialProjection = adminMembershipFinancialProjectionFor(membership, asOfUnixSeconds);
            const requestReceiptId = (_a = membership.cancellationRequest) === null || _a === void 0 ? void 0 : _a.receiptId;
            let receipt = null;
            if (requestReceiptId) {
                try {
                    const storedReceipt = receipts.get(requestReceiptId);
                    (0, membershipCancellation_1.assertMembershipCancellationReceipt)(storedReceipt);
                    receipt = storedReceipt;
                }
                catch (_17) {
                    receipt = null;
                }
            }
            return Object.assign(Object.assign({ subscriptionId: membership.subscriptionId, payerUid: membership.payerUid, payerEmail: membership.payerEmail, planKey: membership.planKey, planName: membership.planName, state: membership.state, stripeStatus: membership.stripeStatus, grantsAlphaWodAccess: membership.grantsAlphaWodAccess, appAccessTier: (_c = (_b = membership.commercialTerms) === null || _b === void 0 ? void 0 : _b.appAccessTier) !== null && _c !== void 0 ? _c : (0, membershipPlans_1.getPlan)(membership.planKey).appAccessTier }, conditioningEntitlementProjection(membership.commercialTerms, membership.planKey)), { entitlementTargetUid: membership.entitlementTargetUid, participantFullName: (_e = (_d = membership.participant) === null || _d === void 0 ? void 0 : _d.fullName) !== null && _e !== void 0 ? _e : "", participantFullNames: participants.map(({ fullName }) => fullName), participantCount: participantCountFor(membership), participantAge: (_g = (_f = membership.participant) === null || _f === void 0 ? void 0 : _f.age) !== null && _g !== void 0 ? _g : null, participantAges: participants.map(({ age }) => age), participantIsPayer: (_j = (_h = membership.participant) === null || _h === void 0 ? void 0 : _h.isPayer) !== null && _j !== void 0 ? _j : false, guardianFullName: (_l = (_k = membership.guardian) === null || _k === void 0 ? void 0 : _k.fullName) !== null && _l !== void 0 ? _l : null, billingMode: (_m = membership.billingMode) !== null && _m !== void 0 ? _m : "standard", serviceStartsAt: (_o = membership.serviceStartsAt) !== null && _o !== void 0 ? _o : null, firstPaymentAt: (_q = (_p = membership.firstPaymentAt) !== null && _p !== void 0 ? _p : membership.billingCycleAnchor) !== null && _q !== void 0 ? _q : null, billingCycleAnchor: (_r = membership.billingCycleAnchor) !== null && _r !== void 0 ? _r : null, initialChargePence: (_s = membership.initialChargePence) !== null && _s !== void 0 ? _s : null, firstPaymentReceivedAt: (_t = membership.firstPaymentReceivedAt) !== null && _t !== void 0 ? _t : null, discount: (_u = membership.discount) !== null && _u !== void 0 ? _u : null, paymentSchedule: (_v = membership.paymentSchedule) !== null && _v !== void 0 ? _v : null, monthlyRecurringPence: financialProjection.monthlyRecurringPence, revenueState: financialProjection.revenueState, currentPeriodEnd: (_w = membership.currentPeriodEnd) !== null && _w !== void 0 ? _w : null, cancelAt: (_x = membership.cancelAt) !== null && _x !== void 0 ? _x : null, disputeOpen: (_y = membership.disputeOpen) !== null && _y !== void 0 ? _y : false, accessRevoked: (_z = membership.accessRevoked) !== null && _z !== void 0 ? _z : false, providerContractStatus: (_0 = membership.providerContractStatus) !== null && _0 !== void 0 ? _0 : null, providerContractError: (_1 = membership.providerContractError) !== null && _1 !== void 0 ? _1 : null, pastDueSince: (_2 = membership.pastDueSince) !== null && _2 !== void 0 ? _2 : null, confirmationEmailStatus: typeof membership.confirmationEmailStatus === "string" ?
                    membership.confirmationEmailStatus : null, confirmationEmailError: typeof membership.confirmationEmailError === "string" ?
                    membership.confirmationEmailError : null, confirmationEmailProviderId: typeof membership.confirmationEmailProviderId === "string" ?
                    membership.confirmationEmailProviderId : null, cancellationRequestStatus: (_4 = (_3 = membership.cancellationRequest) === null || _3 === void 0 ? void 0 : _3.status) !== null && _4 !== void 0 ? _4 : null, cancellationRequestKind: (_6 = (_5 = membership.cancellationRequest) === null || _5 === void 0 ? void 0 : _5.kind) !== null && _6 !== void 0 ? _6 : (membership.cancellationRequest ? "contractual" : null), cancellationReceipt: receipt ? {
                    reference: receipt.receiptId,
                    receivedAt: new Date(receipt.receivedAtMillis).toISOString(),
                    kind: receipt.kind,
                    channel: receipt.channel,
                } : null, refundReviewRequired: (_9 = (_7 = receipt === null || receipt === void 0 ? void 0 : receipt.outcome.refundReviewRequired) !== null && _7 !== void 0 ? _7 : (_8 = membership.cancellationRequest) === null || _8 === void 0 ? void 0 : _8.refundReviewRequired) !== null && _9 !== void 0 ? _9 : false, cancellationRequestError: (_11 = (_10 = membership.cancellationRequest) === null || _10 === void 0 ? void 0 : _10.lastError) !== null && _11 !== void 0 ? _11 : null, cancellationAcknowledgementStatus: (_12 = membership.cancellationAcknowledgementStatus) !== null && _12 !== void 0 ? _12 : null, cancellationAcknowledgementError: (_13 = membership.cancellationAcknowledgementError) !== null && _13 !== void 0 ? _13 : null, cancellationAcknowledgementProviderId: (_14 = membership.cancellationAcknowledgementProviderId) !== null && _14 !== void 0 ? _14 : null, entitlementProjectionStatus: (_15 = membership.entitlementProjectionStatus) !== null && _15 !== void 0 ? _15 : null, entitlementProjectionError: (_16 = membership.entitlementProjectionError) !== null && _16 !== void 0 ? _16 : null });
        });
        return {
            ok: true,
            memberships,
            checkoutIssues,
            planKeys: membershipPlans_1.PLAN_KEYS,
            summary: Object.assign(Object.assign({}, buildAdminMembershipFinancialSummary(storedMemberships, asOfUnixSeconds)), { isComplete: snap.size < 500, reportingLimit: 500 }),
        };
    });
}
function requireMembershipIntentId(value) {
    const intentId = requireBoundedString(value, "intentId", 72, 72);
    if (!isCanonicalMembershipIntentId(intentId)) {
        throw new https_1.HttpsError("invalid-argument", "intentId is not a checkout intent.");
    }
    return intentId;
}
function isCanonicalMembershipIntentId(value) {
    return typeof value === "string" && /^attempt_[a-f0-9]{64}$/.test(value);
}
function checkoutRecoveryRecipient(value, source) {
    const email = (0, membershipCheckoutRecovery_1.canonicalizeCheckoutRecoveryEmail)(value);
    const maskedEmail = (0, membershipCheckoutRecovery_1.maskCheckoutRecoveryEmail)(email);
    return email && maskedEmail ? { email, maskedEmail, source } : null;
}
/** Resolves only addresses frozen by Auth or returned by the exact Stripe objects. */
async function resolveCheckoutRecoveryRecipient(session, intent) {
    var _a, _b, _c;
    const sessionDetails = checkoutRecoveryRecipient((_a = session.customer_details) === null || _a === void 0 ? void 0 : _a.email, "stripe_session_customer_details");
    if (sessionDetails)
        return sessionDetails;
    const sessionEmail = checkoutRecoveryRecipient(session.customer_email, "stripe_session_customer_email");
    if (sessionEmail)
        return sessionEmail;
    const authenticatedIntentEmail = intent.payerUid ?
        checkoutRecoveryRecipient(intent.payerEmail, "authenticated_intent") : null;
    if (authenticatedIntentEmail)
        return authenticatedIntentEmail;
    const customerId = idOf(session.customer);
    if (!customerId)
        return null;
    try {
        const embedded = typeof session.customer === "object" && session.customer &&
            !("deleted" in session.customer) ? session.customer : null;
        if (embedded) {
            assertStripeObjectMode("Customer", embedded.id, embedded.livemode);
            const embeddedEmail = checkoutRecoveryRecipient(embedded.email, "stripe_customer");
            if (embeddedEmail)
                return embeddedEmail;
        }
        const customer = await stripe().customers.retrieve(customerId);
        if (customer.deleted)
            return null;
        assertStripeObjectMode("Customer", customer.id, customer.livemode);
        return checkoutRecoveryRecipient(customer.email, "stripe_customer");
    }
    catch (error) {
        // A missing address or unavailable Customer must not re-lock an unpaid,
        // provider-expired checkout. The transaction records manual-review evidence.
        console.error("Checkout recovery email Customer lookup failed", {
            intentIdHash: sha256((_c = (_b = session.metadata) === null || _b === void 0 ? void 0 : _b.intentId) !== null && _c !== void 0 ? _c : ""),
            checkoutSessionIdHash: sha256(session.id),
            stripeCustomerIdHash: sha256(customerId),
            provider: checkoutRecoveryProviderDiagnostic(error),
        });
        return null;
    }
}
function prepareCheckoutRecoveryEmail(intent, recipient) {
    var _a, _b;
    if (!recipient) {
        return {
            recipient: null,
            payload: null,
            manualReviewReason: "No verified recovery email address was available after Stripe checkout release.",
        };
    }
    try {
        return {
            recipient,
            payload: (0, membershipCheckoutRecovery_1.buildCheckoutRecoveryPayload)({
                recipientEmail: recipient.email,
                fromEmail: membershipFromEmail.value().trim() || membershipPlans_1.COMPANY.confirmationSender,
                publicOrigin: resolveReturnOrigin(),
                planName: (_b = (_a = intent.commercialTerms) === null || _a === void 0 ? void 0 : _a.planName) !== null && _b !== void 0 ? _b : (0, membershipPlans_1.getPlan)(intent.planKey).name,
                participantFullNames: participantsFor(intent).map(({ fullName }) => fullName),
            }),
            manualReviewReason: null,
        };
    }
    catch (error) {
        console.error("Checkout recovery email payload could not be frozen", {
            planKey: intent.planKey,
            error: error instanceof Error ? error.message.slice(0, 500) : String(error),
        });
        return {
            recipient,
            payload: null,
            manualReviewReason: "The recovery email payload could not be frozen safely after checkout release.",
        };
    }
}
function checkoutRecoveryReleaseClaimBinding(intent) {
    var _a, _b;
    return sha256(JSON.stringify({
        schemaVersion: intent.schemaVersion,
        checkoutAttemptHash: intent.checkoutAttemptHash,
        requestFingerprint: intent.requestFingerprint,
        payerUid: intent.payerUid,
        payerEmail: intent.payerEmail,
        planKey: intent.planKey,
        planName: (_b = (_a = intent.commercialTerms) === null || _a === void 0 ? void 0 : _a.planName) !== null && _b !== void 0 ? _b : null,
        participantCount: intent.participantCount,
        participantFullNames: participantsFor(intent).map(({ fullName }) => fullName),
        stripeMode: intent.stripeMode,
        checkoutSessionId: intent.checkoutSessionId,
        checkoutSessionUrl: intent.checkoutSessionUrl,
        checkoutExpiresAt: intent.checkoutExpiresAt,
        reservationLockIds: intent.reservationLockIds,
        createdAtMillis: timestampMillis(intent.createdAt),
    }));
}
function hasCheckoutRecoveryReleaseClaim(intentId, intent) {
    if (!isCanonicalMembershipIntentId(intentId))
        return false;
    return intent.checkoutRecoveryReleaseClaimId ===
        (0, membershipCheckoutRecovery_1.checkoutRecoveryOutboxId)(intentId) &&
        typeof intent.checkoutRecoveryReleaseClaimedBy === "string" &&
        Boolean(intent.checkoutRecoveryReleaseClaimedBy) &&
        intent.checkoutRecoveryReleaseClaimBinding ===
            checkoutRecoveryReleaseClaimBinding(intent);
}
/**
 * Freezes proof that staff began this exact recovery while every reservation
 * lock was still owned. The marker is written before Stripe is mutated, so a
 * webhook interleaving or function crash can be resumed without treating an
 * unrelated naturally expired checkout as an email candidate.
 */
async function acquireCheckoutRecoveryReleaseClaim(intentRef, expectedIntent, claimedBy) {
    const claimId = (0, membershipCheckoutRecovery_1.checkoutRecoveryOutboxId)(intentRef.id);
    const expectedBinding = checkoutRecoveryReleaseClaimBinding(expectedIntent);
    return db().runTransaction(async (tx) => {
        const freshSnap = await tx.get(intentRef);
        if (!freshSnap.exists) {
            throw new https_1.HttpsError("not-found", "Checkout reservation not found.");
        }
        const fresh = freshSnap.data();
        if (fresh.stripeMode !== assertBillingEnvironment().stripeMode) {
            throw checkoutRecoveryReviewError();
        }
        if (fresh.status === "failed" ||
            (fresh.status === "expired" &&
                !hasCheckoutRecoveryReleaseClaim(intentRef.id, fresh))) {
            return { kind: "terminal", intent: fresh };
        }
        if (fresh.status === "payment_pending" || fresh.status === "fulfilled") {
            throw checkoutProcessingError();
        }
        if (fresh.status !== "created" && fresh.status !== "expired") {
            throw checkoutRecoveryReviewError();
        }
        const freshBinding = checkoutRecoveryReleaseClaimBinding(fresh);
        if (freshBinding !== expectedBinding) {
            throw checkoutRecoveryReviewError();
        }
        if (hasCheckoutRecoveryReleaseClaim(intentRef.id, fresh)) {
            return { kind: "claimed", intent: fresh };
        }
        if (fresh.checkoutRecoveryReleaseClaimId ||
            fresh.checkoutRecoveryReleaseClaimBinding ||
            fresh.checkoutRecoveryReleaseClaimedBy ||
            fresh.checkoutRecoveryReleaseClaimedAt) {
            throw checkoutRecoveryReviewError();
        }
        const lockIds = Array.isArray(fresh.reservationLockIds) ?
            fresh.reservationLockIds : [];
        const lockRefs = lockIds.map((id) => db().collection(CHECKOUT_LOCK_COLLECTION).doc(id));
        const lockSnaps = await Promise.all(lockRefs.map((ref) => tx.get(ref)));
        const ownsEveryLock = lockRefs.length > 0 && lockSnaps.every((lock) => lock.exists && lock.get("intentId") === intentRef.id);
        if (!ownsEveryLock)
            throw checkoutRecoveryReviewError();
        tx.set(intentRef, {
            checkoutRecoveryReleaseClaimId: claimId,
            checkoutRecoveryReleaseClaimBinding: freshBinding,
            checkoutRecoveryReleaseClaimedAt: serverTimestamp(),
            checkoutRecoveryReleaseClaimedBy: claimedBy,
            updatedAt: serverTimestamp(),
        }, { merge: true });
        return {
            kind: "claimed",
            intent: Object.assign(Object.assign({}, fresh), { checkoutRecoveryReleaseClaimId: claimId, checkoutRecoveryReleaseClaimBinding: freshBinding, checkoutRecoveryReleaseClaimedBy: claimedBy }),
        };
    });
}
function terminalCheckoutRecoveryEmailResponse(intentId, intent) {
    const hasStaffEmailMarker = hasStaffCheckoutRecoveryEmailMarker(intentId, intent);
    if (!hasStaffEmailMarker) {
        return {
            outcome: "already_released",
            recoveryEmailStatus: "not_applicable",
            recoveryEmailRecipient: null,
        };
    }
    const recoveryEmailStatus = intent.checkoutRecoveryEmailStatus === "pending" ||
        intent.checkoutRecoveryEmailStatus === "sent" ?
        "already_queued" : "manual_review";
    return {
        outcome: "already_released",
        recoveryEmailStatus,
        recoveryEmailRecipient: typeof intent.checkoutRecoveryEmailRecipientMasked === "string" ?
            intent.checkoutRecoveryEmailRecipientMasked : null,
    };
}
function hasStaffCheckoutRecoveryEmailMarker(intentId, intent) {
    return intent.status === "expired" &&
        typeof intent.manualRecoveryBy === "string" && Boolean(intent.manualRecoveryBy) &&
        (intent.manualRecoveryReason === "staff_verified_open_unpaid" ||
            intent.manualRecoveryReason === "staff_verified_provider_expired") &&
        intent.checkoutRecoveryEmailOutboxId === (0, membershipCheckoutRecovery_1.checkoutRecoveryOutboxId)(intentId);
}
async function finalizeStaffCheckoutRelease(intentRef, expectedIntent, expiredSession, releasedBy, releaseReason, preparedEmail) {
    const outboxId = (0, membershipCheckoutRecovery_1.checkoutRecoveryOutboxId)(intentRef.id);
    const outboxRef = db().collection(CONFIRMATION_OUTBOX_COLLECTION).doc(outboxId);
    const auditRef = db().collection("membershipAudit")
        .doc(`checkout-release_${sha256(intentRef.id)}`);
    return db().runTransaction(async (tx) => {
        var _a, _b, _c, _d, _e;
        const freshSnap = await tx.get(intentRef);
        const outboxSnap = await tx.get(outboxRef);
        if (!freshSnap.exists) {
            throw new https_1.HttpsError("not-found", "Checkout reservation not found.");
        }
        const fresh = freshSnap.data();
        const lockIds = Array.isArray(fresh.reservationLockIds) ?
            fresh.reservationLockIds : [];
        const lockRefs = lockIds.map((id) => db().collection(CHECKOUT_LOCK_COLLECTION).doc(id));
        const lockSnaps = await Promise.all(lockRefs.map((ref) => tx.get(ref)));
        const alreadyFinalizedByStaff = hasStaffCheckoutRecoveryEmailMarker(intentRef.id, fresh);
        if (alreadyFinalizedByStaff || fresh.status === "failed") {
            return Object.assign(Object.assign({}, terminalCheckoutRecoveryEmailResponse(intentRef.id, fresh)), { manualReviewReason: (_a = fresh.checkoutRecoveryEmailError) !== null && _a !== void 0 ? _a : null });
        }
        if (fresh.status === "payment_pending" || fresh.status === "fulfilled") {
            throw checkoutProcessingError();
        }
        const currentLockIds = Array.isArray(fresh.reservationLockIds) ?
            fresh.reservationLockIds : [];
        const releaseClaimInvalid = !hasCheckoutRecoveryReleaseClaim(intentRef.id, fresh);
        const bindingChanged = (fresh.status !== "created" && fresh.status !== "expired") ||
            fresh.stripeMode !== expectedIntent.stripeMode ||
            fresh.requestFingerprint !== expectedIntent.requestFingerprint ||
            fresh.payerUid !== expectedIntent.payerUid ||
            fresh.payerEmail !== expectedIntent.payerEmail ||
            fresh.planKey !== expectedIntent.planKey ||
            fresh.checkoutSessionId !== expectedIntent.checkoutSessionId ||
            fresh.checkoutSessionUrl !== expectedIntent.checkoutSessionUrl ||
            fresh.checkoutExpiresAt !== expectedIntent.checkoutExpiresAt ||
            timestampMillis(fresh.createdAt) !== timestampMillis(expectedIntent.createdAt) ||
            currentLockIds.length !== expectedIntent.reservationLockIds.length ||
            currentLockIds.some((id, index) => id !== expectedIntent.reservationLockIds[index]);
        if (releaseClaimInvalid || bindingChanged ||
            expiredSession.status !== "expired" ||
            expiredSession.payment_status !== "unpaid" ||
            checkoutSessionCommonBindingMismatch(expiredSession, intentRef, fresh)) {
            throw checkoutRecoveryReviewError();
        }
        lockSnaps.forEach((lock, index) => {
            if (lock.exists && lock.get("intentId") === intentRef.id) {
                tx.delete(lockRefs[index]);
            }
        });
        const recipient = preparedEmail.recipient;
        const recipientHash = recipient ? sha256(recipient.email) : null;
        const existingOutboxConflict = outboxSnap.exists;
        const ownsEveryLock = lockRefs.length > 0 && lockSnaps.every((lock) => lock.exists && lock.get("intentId") === intentRef.id);
        const preparedEmailReady = Boolean(preparedEmail.payload && recipient);
        const manualReviewReason = existingOutboxConflict ?
            "A checkout recovery outbox row already existed without matching release evidence." :
            fresh.status === "created" && !ownsEveryLock ?
                "The checkout no longer owned every reservation lock at staff release." :
                (_b = preparedEmail.manualReviewReason) !== null && _b !== void 0 ? _b : (!preparedEmailReady ?
                    "Checkout recovery email routing evidence was incomplete." : null);
        const queueEmail = preparedEmailReady && !manualReviewReason;
        const projectedStatus = queueEmail ? "pending" : "manual_review";
        tx.set(intentRef, {
            status: "expired",
            verifiedTerminalAt: serverTimestamp(),
            manualRecoveryAt: serverTimestamp(),
            manualRecoveryBy: releasedBy,
            manualRecoveryReason: releaseReason,
            checkoutRecoveryEmailOutboxId: outboxId,
            checkoutRecoveryEmailStatus: projectedStatus,
            checkoutRecoveryEmailError: manualReviewReason !== null && manualReviewReason !== void 0 ? manualReviewReason : firestore_1.FieldValue.delete(),
            checkoutRecoveryEmailRecipientHash: recipientHash !== null && recipientHash !== void 0 ? recipientHash : firestore_1.FieldValue.delete(),
            checkoutRecoveryEmailRecipientSource: (_c = recipient === null || recipient === void 0 ? void 0 : recipient.source) !== null && _c !== void 0 ? _c : firestore_1.FieldValue.delete(),
            checkoutRecoveryEmailRecipientMasked: (_d = recipient === null || recipient === void 0 ? void 0 : recipient.maskedEmail) !== null && _d !== void 0 ? _d : firestore_1.FieldValue.delete(),
            checkoutRecoveryEmailProviderId: firestore_1.FieldValue.delete(),
            checkoutRecoveryEmailSentAt: firestore_1.FieldValue.delete(),
            updatedAt: serverTimestamp(),
        }, { merge: true });
        if (!outboxSnap.exists && queueEmail && preparedEmail.payload && recipient) {
            tx.create(outboxRef, {
                schemaVersion: membershipCheckoutRecovery_1.MEMBERSHIP_CHECKOUT_RECOVERY_EMAIL_SCHEMA_VERSION,
                kind: "checkout_recovery",
                intentId: intentRef.id,
                checkoutSessionId: expiredSession.id,
                stripeMode: fresh.stripeMode,
                providerSessionStatus: "expired",
                providerPaymentStatus: "unpaid",
                releaseReason,
                releasedBy,
                recipientEmailHash: recipientHash,
                recipientSource: recipient.source,
                status: "pending",
                payload: preparedEmail.payload,
                idempotencyKey: (0, membershipCheckoutRecovery_1.checkoutRecoveryIdempotencyKey)(intentRef.id),
                attemptCount: 0,
                nextAttemptAt: serverTimestamp(),
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
        }
        else if (!outboxSnap.exists) {
            tx.create(outboxRef, Object.assign(Object.assign(Object.assign({ schemaVersion: membershipCheckoutRecovery_1.MEMBERSHIP_CHECKOUT_RECOVERY_EMAIL_SCHEMA_VERSION, kind: "checkout_recovery", intentId: intentRef.id, checkoutSessionId: expiredSession.id, stripeMode: fresh.stripeMode, providerSessionStatus: "expired", providerPaymentStatus: "unpaid", releaseReason,
                releasedBy }, (recipientHash ? { recipientEmailHash: recipientHash } : {})), (recipient ? { recipientSource: recipient.source } : {})), { status: "manual_review", deadLetterReason: manualReviewReason, deadLetteredAt: serverTimestamp(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
        }
        tx.set(auditRef, Object.assign(Object.assign({ type: "abandoned_checkout_released", intentId: intentRef.id, checkoutSessionId: expiredSession.id, releasedBy, providerStatus: "expired", providerPaymentStatus: "unpaid", releaseReason, recoveryEmailStatus: queueEmail ? "queued" : "manual_review", recoveryEmailOutboxId: outboxId, recoveryReleaseClaimId: fresh.checkoutRecoveryReleaseClaimId, recoveryReleaseClaimedBy: fresh.checkoutRecoveryReleaseClaimedBy }, (manualReviewReason ? {
            recoveryEmailManualReviewReason: manualReviewReason,
        } : {})), { createdAt: serverTimestamp() }));
        return {
            outcome: "released",
            recoveryEmailStatus: queueEmail ? "queued" : "manual_review",
            recoveryEmailRecipient: (_e = recipient === null || recipient === void 0 ? void 0 : recipient.maskedEmail) !== null && _e !== void 0 ? _e : null,
            manualReviewReason,
        };
    });
}
function buildReleaseAbandonedCheckoutHandler(requireAdmin, afterProviderTerminalVerified) {
    return async (request) => {
        var _a, _b, _c;
        const staffUid = requireAuthUid(request);
        await requireAdmin(request);
        const intentId = requireMembershipIntentId((_a = request.data) === null || _a === void 0 ? void 0 : _a.intentId);
        const intentRef = db().collection("membershipIntents").doc(intentId);
        const intentSnap = await intentRef.get();
        if (!intentSnap.exists) {
            throw new https_1.HttpsError("not-found", "Checkout reservation not found.");
        }
        const intent = intentSnap.data();
        if (intent.stripeMode !== assertBillingEnvironment().stripeMode) {
            throw new https_1.HttpsError("failed-precondition", "This checkout belongs to another Stripe environment.");
        }
        const hasReleaseClaim = hasCheckoutRecoveryReleaseClaim(intentId, intent);
        if (intent.status === "failed" ||
            (intent.status === "expired" && !hasReleaseClaim)) {
            await transitionCheckoutReservation(intentRef, intent.status);
            return Object.assign({ ok: true, intentId }, terminalCheckoutRecoveryEmailResponse(intentId, intent));
        }
        if (intent.status === "payment_pending" || intent.status === "fulfilled") {
            throw checkoutProcessingError();
        }
        if ((intent.status !== "created" &&
            !(intent.status === "expired" && hasReleaseClaim)) ||
            typeof intent.checkoutSessionId !== "string" ||
            !intent.checkoutSessionId ||
            typeof intent.checkoutSessionUrl !== "string" ||
            !intent.checkoutSessionUrl) {
            throw new https_1.HttpsError("failed-precondition", "Stripe has not recorded a verifiable Checkout Session for this reservation. Keep it locked for billing review.", { reason: "checkout_recovery_review" });
        }
        const createdAtMillis = timestampMillis(intent.createdAt);
        if (createdAtMillis === null ||
            createdAtMillis > Date.now() - CHECKOUT_MANUAL_RELEASE_MIN_AGE_MS) {
            throw new https_1.HttpsError("failed-precondition", "This checkout is too recent to release. Let the customer finish or wait ten minutes before support recovery.", { reason: "checkout_still_recent" });
        }
        const claimResult = await acquireCheckoutRecoveryReleaseClaim(intentRef, intent, staffUid);
        if (claimResult.kind === "terminal") {
            return Object.assign({ ok: true, intentId }, terminalCheckoutRecoveryEmailResponse(intentId, claimResult.intent));
        }
        const recoveryIntent = claimResult.intent;
        let expectedStripeCustomerId = null;
        if (recoveryIntent.payerUid) {
            const profile = await db().collection("users")
                .doc(recoveryIntent.payerUid).get();
            const storedCustomerId = profile.exists ? profile.get("stripeCustomerId") : null;
            expectedStripeCustomerId = typeof storedCustomerId === "string" &&
                storedCustomerId ? storedCustomerId : null;
        }
        const reservation = {
            created: false,
            intent: recoveryIntent,
            intentRef,
            disposition: "same_attempt",
        };
        const verified = await verifyCheckoutSessionCandidate(reservation, (_b = recoveryIntent.payerUid) !== null && _b !== void 0 ? _b : null, expectedStripeCustomerId, "same_attempt", Date.now(), false);
        if (verified.session.payment_status !== "unpaid") {
            throw checkoutProcessingError();
        }
        let expired;
        let releaseReason;
        if (verified.kind === "expired") {
            expired = verified.session;
            releaseReason = "staff_verified_provider_expired";
        }
        else {
            releaseReason = "staff_verified_open_unpaid";
            try {
                expired = await stripe().checkout.sessions.expire(verified.session.id);
            }
            catch (expireError) {
                try {
                    const current = await stripe().checkout.sessions.retrieve(verified.session.id);
                    assertStripeObjectMode("Checkout Session", current.id, current.livemode);
                    if (current.status === "complete") {
                        await extendCheckoutReservationForAsyncPayment(intentRef);
                        throw checkoutProcessingError();
                    }
                    if (current.status === "expired") {
                        expired = current;
                    }
                    else {
                        throw expireError;
                    }
                }
                catch (refreshError) {
                    if (refreshError instanceof https_1.HttpsError)
                        throw refreshError;
                    console.error("Staff checkout release could not verify Stripe", {
                        intentIdHash: sha256(intentId),
                        checkoutSessionIdHash: sha256(verified.session.id),
                        provider: checkoutRecoveryProviderDiagnostic(expireError),
                    });
                    throw checkoutRecoveryUnavailableError();
                }
            }
        }
        assertStripeObjectMode("Checkout Session", expired.id, expired.livemode);
        const mismatch = checkoutSessionCommonBindingMismatch(expired, intentRef, recoveryIntent) || (recoveryIntent.payerUid ? checkoutAuthenticatedBindingMismatch(expired, recoveryIntent.payerUid, expectedStripeCustomerId) : checkoutAnonymousBindingMismatch(expired));
        if (expired.status !== "expired" ||
            expired.payment_status !== "unpaid" || mismatch) {
            console.error("Staff checkout release binding mismatch", {
                intentIdHash: sha256(intentId),
                checkoutSessionIdHash: sha256(verified.session.id),
                status: (_c = expired.status) !== null && _c !== void 0 ? _c : null,
                mismatch,
            });
            throw checkoutRecoveryReviewError();
        }
        if (afterProviderTerminalVerified) {
            await afterProviderTerminalVerified();
        }
        const recipient = await resolveCheckoutRecoveryRecipient(expired, recoveryIntent);
        const preparedEmail = prepareCheckoutRecoveryEmail(recoveryIntent, recipient);
        const releaseOutcome = await finalizeStaffCheckoutRelease(intentRef, recoveryIntent, expired, staffUid, releaseReason, preparedEmail);
        if (releaseOutcome.recoveryEmailStatus === "manual_review") {
            console.error("CRITICAL_BILLING_CHECKOUT_RECOVERY_EMAIL_MANUAL_REVIEW", {
                intentId,
                outboxId: (0, membershipCheckoutRecovery_1.checkoutRecoveryOutboxId)(intentId),
                reason: releaseOutcome.manualReviewReason,
            });
        }
        return {
            ok: true,
            intentId,
            outcome: releaseOutcome.outcome,
            recoveryEmailStatus: releaseOutcome.recoveryEmailStatus,
            recoveryEmailRecipient: releaseOutcome.recoveryEmailRecipient,
        };
    };
}
function buildReleaseAbandonedMembershipCheckout(requireAdmin) {
    return (0, https_1.onCall)({
        region: REGION,
        secrets: exports.MEMBERSHIP_SECRETS,
        timeoutSeconds: MEMBERSHIP_INTERACTIVE_TIMEOUT_SECONDS,
    }, buildReleaseAbandonedCheckoutHandler(requireAdmin));
}
/**
 * Links a membership bought for another person to that person's account, so a
 * purchase where the payer is not the participant can still grant access.
 */
function buildLinkMembershipParticipant(requireAdmin, converge) {
    return (0, https_1.onCall)({
        region: REGION,
        secrets: exports.MEMBERSHIP_SECRETS,
        timeoutSeconds: MEMBERSHIP_INTERACTIVE_TIMEOUT_SECONDS,
    }, async (request) => {
        var _a, _b, _c, _d, _e, _f;
        const callerUid = requireAuthUid(request);
        await requireAdmin(request);
        const subscriptionId = requireBoundedString((_a = request.data) === null || _a === void 0 ? void 0 : _a.subscriptionId, "subscriptionId", 3, 255);
        const targetUid = requireBoundedString((_b = request.data) === null || _b === void 0 ? void 0 : _b.participantUid, "participantUid", 3, 128);
        const membershipRef = db().collection("memberships").doc(subscriptionId);
        const targetRef = db().collection("users").doc(targetUid);
        const [initialMembership, initialTarget] = await Promise.all([
            membershipRef.get(),
            targetRef.get(),
        ]);
        if (!initialMembership.exists) {
            throw new https_1.HttpsError("not-found", "Membership not found.");
        }
        if (!initialTarget.exists) {
            throw new https_1.HttpsError("not-found", "Participant account not found.");
        }
        const requestedPriorProjectionStatus = (_c = initialMembership.get("entitlementProjectionStatus")) !== null && _c !== void 0 ? _c : null;
        const requestedPriorProjectionError = (_d = initialMembership.get("entitlementProjectionError")) !== null && _d !== void 0 ? _d : null;
        const accountMemberships = initialMembership.get("grantsAlphaWodAccess") === true ?
            await alphaWodMembershipsForAccount(targetUid) : [];
        const convergedMembershipIds = await convergeEligibilityMemberships([initialMembership, ...accountMemberships], converge, "participant_link_or_repair");
        const decision = await db().runTransaction(async (tx) => {
            var _a, _b;
            const membershipSnap = await tx.get(membershipRef);
            const userSnap = await tx.get(targetRef);
            if (!membershipSnap.exists)
                throw new https_1.HttpsError("not-found", "Membership not found.");
            if (!userSnap.exists)
                throw new https_1.HttpsError("not-found", "Participant account not found.");
            const membership = membershipSnap.data();
            if (!convergedMembershipIds.has(membershipRef.id)) {
                throw new https_1.HttpsError("unavailable", AUTHORITATIVE_ELIGIBILITY_UNAVAILABLE, { reason: "membership_state_changed" });
            }
            if (!membership.grantsAlphaWodAccess) {
                throw new https_1.HttpsError("failed-precondition", "This plan does not include Zero Alpha App access.");
            }
            const target = userSnap.data();
            if (target.role !== "user") {
                throw new https_1.HttpsError("failed-precondition", "Only a member account can be linked to a membership.");
            }
            const alreadyLinked = membership.entitlementTargetUid === targetUid;
            const selfPayer = ((_a = membership.participant) === null || _a === void 0 ? void 0 : _a.isPayer) === true;
            if (selfPayer && (!alreadyLinked || membership.payerUid !== targetUid)) {
                throw new https_1.HttpsError("failed-precondition", "A self-payer membership must be claimed by its payer and can only be repaired on that same account.");
            }
            if (membership.entitlementTargetUid &&
                membership.entitlementTargetUid !== targetUid) {
                // A transfer needs explicit restoration of the old target's snapshot.
                // Until that workflow exists, fail closed instead of leaking access.
                throw new https_1.HttpsError("failed-precondition", "This membership is already linked. Contact support to review a transfer.");
            }
            const membershipBlocks = (0, membershipPlans_1.isMembershipStateBlockingDuplicate)(membership.state);
            if (!alreadyLinked && !membershipBlocks) {
                throw new https_1.HttpsError("failed-precondition", "This membership is no longer eligible to grant Zero Alpha App access.");
            }
            if (!alreadyLinked && ((_b = membership.participant) === null || _b === void 0 ? void 0 : _b.isPayer) !== false) {
                throw new https_1.HttpsError("failed-precondition", "A self-payer membership must be claimed by its payer account.");
            }
            if (membershipBlocks) {
                const targetMemberships = await tx.get(db().collection("memberships").where("entitlementTargetUid", "==", targetUid));
                const payerMemberships = await tx.get(db().collection("memberships").where("payerUid", "==", targetUid));
                const duplicate = [...targetMemberships.docs, ...payerMemberships.docs].some((doc) => doc.id !== membershipRef.id &&
                    doc.get("grantsAlphaWodAccess") === true &&
                    isBlockingMembershipDoc(doc));
                assertEligibilityDocsWereConverged([
                    ...targetMemberships.docs.filter((doc) => doc.get("grantsAlphaWodAccess") === true),
                    ...payerMemberships.docs.filter((doc) => doc.get("grantsAlphaWodAccess") === true),
                ], convergedMembershipIds);
                if (duplicate) {
                    throw new https_1.HttpsError("already-exists", membershipPlans_1.POLICY_TEXT.duplicateBlocked);
                }
                if (await hasBlockingPayerCheckoutReservation(tx, targetUid)) {
                    throw new https_1.HttpsError("already-exists", membershipPlans_1.POLICY_TEXT.duplicateBlocked);
                }
                const owner = await readEntitlementOwner(tx, targetUid, subscriptionId);
                if (owner.ownerState === "active" && owner.ownerSubscriptionId &&
                    !convergedMembershipIds.has(owner.ownerSubscriptionId)) {
                    throw new https_1.HttpsError("unavailable", AUTHORITATIVE_ELIGIBILITY_UNAVAILABLE, { reason: "membership_state_changed" });
                }
                acquireEntitlementOwner(tx, owner, targetUid, subscriptionId);
            }
            if (!alreadyLinked) {
                tx.set(membershipRef, {
                    entitlementTargetUid: targetUid,
                    entitlementTargetLinkedBy: callerUid,
                    entitlementTargetLinkedAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                }, { merge: true });
            }
            return {
                kind: alreadyLinked ? "repair" : "link",
            };
        });
        // Linking is the action that makes this paid membership authoritative for
        // the participant. Apply it now; waiting for a later Stripe webhook can
        // leave a fully paid member without access indefinitely.
        await applyMembershipEntitlement(membershipRef, converge);
        if (decision.kind === "link") {
            await writeAudit({
                type: "membership_participant_linked",
                subscriptionId,
                targetUid,
                linkedBy: callerUid,
            });
        }
        else {
            const repaired = await membershipRef.get();
            await writeAudit({
                type: "membership_entitlement_projection_repair",
                subscriptionId,
                targetUid,
                repairedBy: callerUid,
                priorProjectionStatus: requestedPriorProjectionStatus,
                priorProjectionError: requestedPriorProjectionError,
                projectionStatus: (_e = repaired.get("entitlementProjectionStatus")) !== null && _e !== void 0 ? _e : null,
                projectionError: (_f = repaired.get("entitlementProjectionError")) !== null && _f !== void 0 ? _f : null,
            });
        }
        return {
            ok: true,
            subscriptionId,
            participantUid: targetUid,
            alreadyLinked: decision.kind === "repair",
            repaired: decision.kind === "repair",
        };
    });
}
exports.__testing = {
    secretsForRuntime,
    assertBillingEnvironment,
    assertStripeObjectMode,
    requirePurchaseFlowOpen,
    requirePlanPurchaseFlowOpen,
    assertCheckoutDocumentModel,
    requireExactCheckoutAcceptanceIds,
    participantKeyFor,
    checkoutLockSpecs,
    checkoutRequestFingerprint,
    assertCheckoutAppCheck,
    buildCreateMembershipCheckoutHandler,
    reserveCheckoutAttempt,
    transitionCheckoutReservation,
    reconcileExpiredCheckoutReservations,
    settlePreparedCancellation,
    recoverPendingCancellationsOnce,
    cancellationRetryAtMillis,
    acquireStripeEventLease,
    markStripeEventProcessed,
    markStripeEventFailed,
    processStripeEventUnderLease,
    recoverDueStripeEventsOnce,
    stripeEventRetryAtMillis,
    reconcilePastDueMembershipsOnce,
    convergeMembershipFromStripe,
    convergeEligibilityMembershipFromStripe,
    handleStripeEvent,
    buildConfirmationPayload,
    buildWelcomePayload,
    ensureMembershipAndConfirmationOutbox,
    acquireConfirmationEmailLease,
    processMembershipConfirmationOutbox,
    retryDueMembershipConfirmationsOnce,
    confirmationEmailRetryAtMillis,
    isPermanentConfirmationFailure,
    isSystemicResendFailure,
    resolveCurrentPeriodEnd,
    resolveInvoiceSubscriptionId,
    resolveApprovedCheckoutDiscount,
    adminMembershipFinancialProjectionFor,
    buildAdminMembershipFinancialSummary,
    stripeSubscriptionContractMismatch,
    conditioningEntitlementProjection,
    buildReleaseAbandonedCheckoutHandler,
};
/** ---------------------------------------------------------------
 * Durable confirmation email (Membership Terms 4)
 *
 * The Terms require an emailed durable copy carrying the agreed plan, amounts,
 * next payment date, cancellation information, signed acceptance evidence, and
 * the actual immutable documents accepted by the buyer. The outbox freezes the
 * complete commercial snapshot, exact statements, inline document text and
 * one plain-text attachment per document before any delivery attempt begins.
 * -------------------------------------------------------------- */
function escapeHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
const ZERO_ALPHA_APP_LOGIN_URL = "https://alpha-wod.vercel.app/login";
const ZERO_ALPHA_EMAIL_LOGO_URL = "https://alpha-wod.vercel.app/ZERO-ALPHA.png";
const WELCOME_EMAIL_VARIANTS = {
    adult_unlimited: {
        eyebrow: "ADULT UNLIMITED",
        headline: "You’re in. Let’s get to work.",
        summary: "Full access to coached sessions, the gym floor and eligible Zero Alpha App access.",
        inclusions: [
            "Coached sessions and gym-floor access",
            "Eligible Zero Alpha App access included",
            "A rolling monthly membership with no minimum term",
        ],
        accessNote: "Zero Alpha App access becomes available to an eligible, linked account while the membership is active.",
        appCta: {
            title: "Sign up or log into the Zero Alpha app!",
            buttonLabel: "Open the Zero Alpha app",
        },
    },
    adult_conditioning: {
        eyebrow: "ADULT CONDITIONING",
        headline: "Two sessions each week. Your choice.",
        summary: "Book any two eligible conditioning sessions in each Monday-to-Sunday London week, with limited Zero Alpha App access.",
        inclusions: [
            "Choose any two of the four eligible conditioning sessions each week",
            "Class schedule, bookings and profile access in the Zero Alpha App",
            "A rolling monthly membership with no minimum term",
        ],
        accessNote: "Your linked account can book up to two eligible conditioning sessions each Monday-to-Sunday week. You can change your choice by cancelling and booking another eligible session in the same week. WOD, training-log and leaderboard features are not included.",
        appCta: {
            title: "Choose your weekly sessions in the Zero Alpha app",
            buttonLabel: "Open the Zero Alpha app",
        },
    },
    adult_ladies: {
        eyebrow: "LADIES ONLY",
        headline: "Welcome to Ladies Only.",
        summary: "Your space for ladies-only coached sessions and gym access.",
        inclusions: [
            "Ladies-only coached sessions",
            "Gym-floor access",
            "A rolling monthly membership with no minimum term",
        ],
        accessNote: "This membership does not include Zero Alpha App access.",
    },
    adult_gym: {
        eyebrow: "GYM ONLY",
        headline: "Your gym membership is ready.",
        summary: "Straightforward access to the gym floor, built around your own training.",
        inclusions: [
            "Gym-floor access",
            "Independent gym-floor training",
            "A rolling monthly membership with no minimum term",
        ],
        accessNote: "This membership does not include coached sessions or Zero Alpha App access.",
    },
    youth_youngstars: {
        eyebrow: "MINI ALPHAS - 10 & Under",
        headline: "A strong start begins here.",
        summary: "A strength and conditioning class for 10 and under! Fun, progressive, and challenging.",
        inclusions: [
            "Fun, progressive strength and conditioning",
            "A supportive introduction to movement and fitness",
        ],
        accessNote: "Youth memberships do not include Zero Alpha App access.",
    },
    youth_teenstars: {
        eyebrow: "TEEN ALPHAS - 11 & UP",
        headline: "Their next level starts here.",
        summary: "Strength and conditioning for 11 and up! Develop athletic qualities in a supportive environment.",
        inclusions: [
            "Coached strength and conditioning sessions",
            "Training that develops athletic qualities and confidence",
        ],
        accessNote: "Youth memberships do not include Zero Alpha App access.",
    },
};
// Historical schema-v6 memberships keep their two checkout-frozen slots.
// Current schema-v7 Conditioning memberships use the flexible plan variant.
const LEGACY_FIXED_CONDITIONING_WELCOME_VARIANT = {
    eyebrow: "ADULT CONDITIONING",
    headline: "Your two weekly sessions are set.",
    summary: "Access to the two recurring conditioning sessions selected at checkout, with limited Zero Alpha App access.",
    inclusions: [
        "Booking access for your two fixed weekly conditioning slots",
        "Class schedule, bookings and profile access in the Zero Alpha App",
        "A rolling monthly membership with no minimum term",
    ],
    accessNote: "Your linked account can book only the two recurring conditioning slots frozen with this membership. WOD, training-log and leaderboard features are not included.",
    appCta: {
        title: "Manage your selected sessions in the Zero Alpha app",
        buttonLabel: "Open the Zero Alpha app",
    },
};
function buildConfirmationHtml(details) {
    var _a;
    const { membership, initialChargePence, claimUrl } = details;
    const commercialTerms = (_a = membership.commercialTerms) !== null && _a !== void 0 ? _a : (0, membershipPlans_1.createCommercialPlanSnapshot)(membership.planKey);
    const isYouthPlan = commercialTerms.audience === "youth";
    const participants = participantsFor(membership);
    const participantCount = participantCountFor(membership);
    const order = orderFor(membership);
    const frozenFamilyDiscountPercent = youthFamilyDiscountPercentFor(membership.discount);
    const isPresale = membership.billingMode === "presale_deferred";
    const firstFullCharge = (0, membershipPlans_1.formatUnixBillingDate)(membership.billingCycleAnchor);
    const documents = membership.acceptances.documents
        .map((document) => `<li><strong>${escapeHtml(document.title)}</strong> — ` +
        `<code>${escapeHtml(document.version)}</code><br>` +
        `SHA-256: <code>${escapeHtml(document.sha256)}</code></li>`)
        .join("");
    const statements = membership.acceptances.statements
        .map(({ statement }) => `<li>${escapeHtml(statement)}</li>`)
        .join("");
    const documentContents = membership.acceptances.documents
        .map((document) => "<section style=\"margin:28px 0;page-break-before:always;\">" +
        `<h3 style="font-size:15px;margin:0 0 4px;">${escapeHtml(document.title)}</h3>` +
        "<p style=\"font-size:12px;color:#666;margin:0 0 12px;\">" +
        `${escapeHtml(document.version)} · SHA-256 ${escapeHtml(document.sha256)}</p>` +
        "<div style=\"white-space:pre-wrap;font:13px/1.55 Arial,Helvetica,sans-serif;" +
        `border:1px solid #ddd;padding:14px;">${escapeHtml(document.content)}</div>` +
        "</section>")
        .join("");
    const rows = [
        ["Plan", commercialTerms.planName],
        [isYouthPlan && participantCount > 1 ? "Children" :
                isYouthPlan ? "Child" : "Participant",
            participants.map(({ fullName }) => fullName).join(", ")],
        ...(isYouthPlan ? [
            [
                "Contracted quantity",
                `${participantCount} ${participantCount === 1 ? "child" : "children"}`,
            ],
            [
                "Price per child",
                `${(0, membershipPlans_1.formatPence)(order.unitAmountPence)} per month`,
            ],
            [
                "Undiscounted monthly subtotal",
                `${(0, membershipPlans_1.formatPence)(order.standardMonthlyPence)} per month`,
            ],
        ] : []),
        [isYouthPlan ? "Recurring monthly total" : "Monthly price", `${(0, membershipPlans_1.formatPence)(frozenFamilyDiscountPercent !== null ?
                order.recurringMonthlyPence : order.standardMonthlyPence)} per month`],
        [
            "Paid today",
            isPresale && initialChargePence === 0 ?
                "£0.00 — no payment has been taken" : initialChargePence === null ?
                "See your Stripe receipt" :
                `${(0, membershipPlans_1.formatPence)(initialChargePence)} (pro rata to ${firstFullCharge})`,
        ],
        [isPresale ? "First monthly payment" : "First full monthly payment", firstFullCharge],
        ["Then", "The first of each month"],
    ];
    if (frozenFamilyDiscountPercent !== null) {
        const recurringTotalIndex = rows.findIndex(([label]) => label === "Recurring monthly total");
        rows.splice(recurringTotalIndex, 0, [
            "Family discount",
            `${frozenFamilyDiscountPercent}% (−${(0, membershipPlans_1.formatPence)(order.standardMonthlyPence - order.recurringMonthlyPence)}) off the ${(0, membershipPlans_1.formatPence)(order.standardMonthlyPence)} subtotal; ` +
                `${(0, membershipPlans_1.formatPence)(order.recurringMonthlyPence)} per month while ` +
                "this subscription covers at least two children",
        ]);
    }
    else if (membership.discount &&
        typeof membership.discount.amountOffPence === "number" &&
        typeof membership.discount.durationInMonths === "number" &&
        typeof membership.paymentSchedule.fullPriceFrom === "number") {
        rows.splice(3, 0, [
            "Existing-member offer",
            `${(0, membershipPlans_1.formatPence)(commercialTerms.amountPence - membership.discount.amountOffPence)} for the ` +
                `first ${membership.discount.durationInMonths} monthly payments; ` +
                `${(0, membershipPlans_1.formatPence)(commercialTerms.amountPence)} from ` +
                `${(0, membershipPlans_1.formatUnixBillingDate)(membership.paymentSchedule.fullPriceFrom)}`,
        ]);
    }
    if (membership.guardian) {
        rows.splice(2, 0, [
            isYouthPlan ? "Paying adult" : "Parent or guardian",
            `${membership.guardian.fullName} (${membership.guardian.relationship})`,
        ]);
    }
    const tableRows = rows
        .map(([label, value]) => `<tr><td style="padding:6px 16px 6px 0;color:#666;">${escapeHtml(label)}</td>` +
        `<td style="padding:6px 0;"><strong>${escapeHtml(value)}</strong></td></tr>`)
        .join("");
    const claimBlock = claimUrl ?
        `<div style="margin:24px 0;padding:16px;background:#fff8e6;border:1px solid #e6c67a;">
      <p style="margin:0 0 10px;"><strong>One step left: claim your membership</strong></p>
      <p style="margin:0 0 12px;">Sign in, or create and verify an account with this email
      address, to link this membership to it.</p>
      <p style="margin:0;"><a href="${escapeHtml(claimUrl)}">${escapeHtml(claimUrl)}</a></p>
    </div>` :
        "";
    return `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(`Your ${commercialTerms.planName} is confirmed`)}</title>
</head><body style="font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.6;">
  <div style="margin:0 0 28px;padding:10px 24px;background:#000;">
    <img src="${escapeHtml(ZERO_ALPHA_EMAIL_LOGO_URL)}" width="180"
      alt="Zero Alpha Fitness"
      style="display:block;width:180px;max-width:100%;height:auto;border:0;">
  </div>
  <h1 style="font-size:20px;margin:0 0 6px;">Your ${escapeHtml(commercialTerms.planName)} is confirmed</h1>
  <p style="margin:0 0 20px;color:#555;">Keep this email. It is your durable copy of this
  agreement.</p>

  ${isPresale ? `<p style="margin:0 0 20px;"><strong>Your membership is scheduled to start on
  ${escapeHtml((0, membershipPlans_1.formatUnixBillingDate)(membership.serviceStartsAt))}. Nothing has been charged
  today.</strong></p>` : ""}

  ${claimBlock}

  <table style="border-collapse:collapse;margin:0 0 24px;">${tableRows}</table>

  <h2 style="font-size:15px;margin:24px 0 8px;">Cancelling</h2>
  <p style="margin:0 0 8px;">${escapeHtml(isPresale ?
        `You can cancel before ${(0, membershipPlans_1.formatUnixBillingDate)(membership.serviceStartsAt)} and no first ` +
            `payment will be taken. After service starts, ${membershipPlans_1.POLICY_TEXT.cancellationRule}` :
        membershipPlans_1.POLICY_TEXT.cancellationRule)}</p>
  <p style="margin:0 0 8px;">Request cancellation from your membership page when signed in,
  or email ${escapeHtml(membershipPlans_1.COMPANY.supportEmail)} from this address if the page is unavailable.
  Your request is treated as received when it reaches that request flow or inbox; a later
  acknowledgement is evidence of receipt, not a condition that makes the request valid. Keep
  the acknowledgement and contact us promptly if it does not arrive.</p>
  <p style="margin:0 0 8px;">${escapeHtml(membershipPlans_1.POLICY_TEXT.refund)}</p>
  <p style="margin:0 0 8px;">${escapeHtml(membershipPlans_1.POLICY_TEXT.noPause)}</p>

  <h2 style="font-size:15px;margin:24px 0 8px;">Cooling-off</h2>
  <p style="margin:0 0 8px;">You may cancel within
  ${membershipPlans_1.BILLING_POLICY.coolingOffDays} days of the day this contract was made. Your period ends
  ${escapeHtml((0, membershipPlans_1.formatBillingDate)(membership.acceptances.coolingOffEndsAt.slice(0, 10)))}.
  ${membership.acceptances.immediatePerformanceRequested ?
        `You expressly requested that the membership begin ${isPresale ?
            `on ${(0, membershipPlans_1.formatUnixBillingDate)(membership.serviceStartsAt)}` : "immediately"}, so if you cancel within ` +
            "that period we may charge only the proportionate amount permitted by law for services " +
            "already supplied." :
        "You did not request service to begin before the cooling-off period ends."}</p>

  <h2 style="font-size:15px;margin:24px 0 8px;">Documents you accepted</h2>
  <ul style="margin:0 0 8px;padding-left:20px;">${documents}</ul>

  <h2 style="font-size:15px;margin:24px 0 8px;">Statements you accepted separately</h2>
  <ul style="margin:0 0 8px;padding-left:20px;">${statements}</ul>

  <h2 style="font-size:15px;margin:24px 0 8px;">Your signature</h2>
  <p style="margin:0 0 8px;">Signed by typing the name
  <strong>${escapeHtml(membership.acceptances.signedName)}</strong> at checkout as
  ${escapeHtml(membership.acceptances.signerRole)}.</p>

  <h2 style="font-size:15px;margin:28px 0 8px;">Complete immutable document copies</h2>
  <p style="margin:0 0 8px;">The complete text accepted at checkout appears below and is
  also attached as separate plain-text files.</p>
  ${documentContents}

  <hr style="border:none;border-top:1px solid #ddd;margin:28px 0 12px;">
  <p style="margin:0;font-size:12px;color:#666;">
    ${escapeHtml(membershipPlans_1.COMPANY.legalName)} · Company number ${escapeHtml(membershipPlans_1.COMPANY.companyNumber)}<br>
    ${escapeHtml(membershipPlans_1.COMPANY.address)}<br>
    Registered office: ${escapeHtml(membershipPlans_1.COMPANY.registeredOffice)}<br>
    Registered in: ${escapeHtml(membershipPlans_1.COMPANY.registrationJurisdiction)}<br>
    Questions: ${escapeHtml(membershipPlans_1.COMPANY.supportEmail)}<br>
    We are not VAT registered; the price shown is the total price.
  </p>
</body></html>`;
}
function buildWelcomeHtml(membership) {
    var _a, _b, _c, _d;
    const commercialTerms = (_a = membership.commercialTerms) !== null && _a !== void 0 ? _a : (0, membershipPlans_1.createCommercialPlanSnapshot)(membership.planKey);
    const variant = membership.planKey === "adult_conditioning" &&
        commercialTerms.catalogueSchemaVersion === 6 ?
        LEGACY_FIXED_CONDITIONING_WELCOME_VARIANT :
        WELCOME_EMAIL_VARIANTS[membership.planKey];
    const participants = participantsFor(membership);
    const participantNames = participants.map(({ fullName }) => fullName).join(", ");
    const participantCount = participantCountFor(membership);
    const isYouthPlan = commercialTerms.audience === "youth";
    const recipientName = isYouthPlan && ((_b = membership.guardian) === null || _b === void 0 ? void 0 : _b.fullName) ?
        membership.guardian.fullName : (_d = (_c = participants[0]) === null || _c === void 0 ? void 0 : _c.fullName) !== null && _d !== void 0 ? _d : "there";
    const order = orderFor(membership);
    const frozenFamilyDiscountPercent = youthFamilyDiscountPercentFor(membership.discount);
    const recurringMonthlyPence = frozenFamilyDiscountPercent !== null ?
        order.recurringMonthlyPence : order.standardMonthlyPence;
    const inclusions = [
        ...variant.inclusions,
        ...(frozenFamilyDiscountPercent === null ? [] : [
            `${frozenFamilyDiscountPercent}% family discount while this subscription ` +
                "covers two or more children",
        ]),
    ]
        .map((item) => "<tr><td style=\"width:28px;padding:0 0 12px;vertical-align:top;" +
        "color:#8b6748;font-size:18px;line-height:20px;\">&#10003;</td>" +
        "<td style=\"padding:0 0 12px;color:#25221f;font-size:15px;" +
        `line-height:22px;">${escapeHtml(item)}</td></tr>`)
        .join("");
    const startCopy = membership.billingMode === "presale_deferred" ?
        `Starts ${(0, membershipPlans_1.formatUnixBillingDate)(membership.serviceStartsAt)}` : "Membership active";
    const youthParticipantLabel = participantCount === 1 ? "Child" : "Children";
    const participantLabel = isYouthPlan ? youthParticipantLabel : "Member";
    const preheader = `Welcome to ${commercialTerms.planName}. Here’s what happens next.`;
    const actionBlock = variant.appCta ? `
        <tr><td style="padding:12px 34px 40px;font-family:Arial,Helvetica,sans-serif;">
          <div style="padding:24px;background:#201d1a;border-radius:16px;color:#f4f0ea;">
            <h2 style="margin:0 0 20px;font-size:19px;line-height:25px;color:#f4f0ea;">
              ${escapeHtml(variant.appCta.title)}
            </h2>
            <a href="${escapeHtml(ZERO_ALPHA_APP_LOGIN_URL)}"
              style="display:inline-block;padding:13px 20px;background:#f4f0ea;border-radius:999px;
              color:#171513;font-size:14px;font-weight:800;text-decoration:none;">
              ${escapeHtml(variant.appCta.buttonLabel)}
            </a>
          </div>
        </td></tr>` : "";
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light only">
  <title>${escapeHtml(`Welcome to ${commercialTerms.planName}`)}</title>
</head>
<body style="margin:0;padding:0;background:#0b0a09;color:#171513;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    ${escapeHtml(preheader)}
  </div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
    style="width:100%;background:#0b0a09;">
    <tr><td align="center" style="padding:32px 14px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
        style="width:100%;max-width:620px;background:#f4f0ea;border-radius:24px;overflow:hidden;">
        <tr><td style="padding:10px 34px;background:#000;border-bottom:1px solid #302b27;">
          <img src="${escapeHtml(ZERO_ALPHA_EMAIL_LOGO_URL)}" width="180"
            alt="Zero Alpha Fitness"
            style="display:block;width:180px;max-width:100%;height:auto;border:0;">
        </td></tr>
        <tr><td style="padding:42px 34px 20px;font-family:Arial,Helvetica,sans-serif;">
          <div style="margin-bottom:16px;font-size:11px;font-weight:800;letter-spacing:2px;
            color:#8b6748;">${escapeHtml(variant.eyebrow)}</div>
          <p style="margin:0 0 12px;font-size:16px;line-height:24px;color:#5c554f;">
            Hi ${escapeHtml(recipientName)},
          </p>
          <h1 style="margin:0 0 16px;font-size:34px;line-height:39px;letter-spacing:-1px;
            color:#171513;">${escapeHtml(variant.headline)}</h1>
          <p style="margin:0;font-size:17px;line-height:27px;color:#514b45;">
            ${escapeHtml(variant.summary)}
          </p>
        </td></tr>
        <tr><td style="padding:12px 34px 28px;font-family:Arial,Helvetica,sans-serif;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
            style="width:100%;background:#e9e2da;border-radius:16px;">
            <tr>
              <td style="padding:18px 20px;border-bottom:1px solid #d7cdc4;">
                <div style="font-size:10px;font-weight:800;letter-spacing:1.5px;color:#766c64;">
                  ${escapeHtml(participantLabel.toUpperCase())}
                </div>
                <div style="margin-top:5px;font-size:15px;font-weight:700;line-height:21px;
                  color:#171513;">${escapeHtml(participantNames)}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 20px;">
                <div style="font-size:10px;font-weight:800;letter-spacing:1.5px;color:#766c64;">
                  MEMBERSHIP
                </div>
                <div style="margin-top:5px;font-size:15px;font-weight:700;line-height:21px;
                  color:#171513;">${escapeHtml(commercialTerms.planName)} ·
                  ${escapeHtml((0, membershipPlans_1.formatPence)(recurringMonthlyPence))}/month ·
                  ${escapeHtml(startCopy)}</div>
              </td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:0 34px 22px;font-family:Arial,Helvetica,sans-serif;">
          <h2 style="margin:0 0 18px;font-size:18px;line-height:24px;color:#171513;">
            What your membership includes
          </h2>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            ${inclusions}
          </table>
          <p style="margin:4px 0 0;padding:14px 16px;background:#eee8e1;border-radius:12px;
            font-size:13px;line-height:20px;color:#625a53;">${escapeHtml(variant.accessNote)}</p>
        </td></tr>
        ${actionBlock}
        <tr><td style="padding:24px 34px;background:#e7dfd7;
          font-family:Arial,Helvetica,sans-serif;">
          <p style="margin:0 0 8px;font-size:12px;line-height:19px;color:#625a53;">
            Your signed membership record, cancellation information and the exact legal documents
            accepted at checkout are attached to this email. Please keep them for your records.
          </p>
          <p style="margin:0;font-size:12px;line-height:19px;color:#625a53;">
            Questions? Reply to this email or contact
            <a href="mailto:${escapeHtml(membershipPlans_1.COMPANY.supportEmail)}"
              style="color:#51463c;">${escapeHtml(membershipPlans_1.COMPANY.supportEmail)}</a>.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
const CONFIRMATION_OUTBOX_COLLECTION = "membershipEmailOutbox";
const CONFIRMATION_EMAIL_LEASE_MS = 10 * 60 * 1000;
// Resend's idempotency guarantee lasts 24 hours. Stop automatic uncertain
// retries with an hour to spare so a late retry cannot create a duplicate.
const CONFIRMATION_EMAIL_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
function isMembershipEmailKind(value) {
    return value === "membership_confirmation" ||
        value === "membership_cancellation_acknowledgement" ||
        value === "checkout_recovery";
}
function membershipEmailProjectionFields(kind, status, error = null, providerMessageId = null) {
    if (kind === "membership_cancellation_acknowledgement") {
        return Object.assign(Object.assign({ cancellationAcknowledgementStatus: status, cancellationAcknowledgementError: error !== null && error !== void 0 ? error : firestore_1.FieldValue.delete() }, (status === "sent" ? {
            cancellationAcknowledgementSentAt: serverTimestamp(),
            cancellationAcknowledgementProviderId: providerMessageId,
        } : {})), { updatedAt: serverTimestamp() });
    }
    return Object.assign(Object.assign({ confirmationEmailStatus: status, confirmationEmailError: error !== null && error !== void 0 ? error : firestore_1.FieldValue.delete() }, (status === "sent" ? {
        confirmationEmailSentAt: serverTimestamp(),
        confirmationEmailProviderId: providerMessageId,
    } : {})), { updatedAt: serverTimestamp() });
}
function checkoutRecoveryEmailProjectionFields(status, error = null, providerMessageId = null) {
    return Object.assign(Object.assign({ checkoutRecoveryEmailStatus: status, checkoutRecoveryEmailError: error !== null && error !== void 0 ? error : firestore_1.FieldValue.delete() }, (status === "sent" ? {
        checkoutRecoveryEmailSentAt: serverTimestamp(),
        checkoutRecoveryEmailProviderId: providerMessageId,
    } : {})), { updatedAt: serverTimestamp() });
}
function buildConfirmationPayload(membership, initialChargePence) {
    if (initialChargePence === null)
        return null;
    const welcomePayload = buildWelcomePayload(membership);
    if (!welcomePayload)
        return null;
    const agreementHtml = buildConfirmationHtml({
        membership,
        initialChargePence,
        claimUrl: null,
    });
    return Object.assign(Object.assign({}, welcomePayload), { attachments: [
            {
                filename: "membership-agreement.html",
                content: Buffer.from(agreementHtml, "utf8").toString("base64"),
            },
            ...membership.acceptances.documents.map((document) => ({
                filename: `${document.version}.txt`,
                content: Buffer.from(document.content, "utf8").toString("base64"),
            })),
        ] });
}
function buildWelcomePayload(membership) {
    var _a;
    if (!membership.payerEmail)
        return null;
    const fromEmail = membershipFromEmail.value().trim() || membershipPlans_1.COMPANY.confirmationSender;
    const commercialTerms = (_a = membership.commercialTerms) !== null && _a !== void 0 ? _a : (0, membershipPlans_1.createCommercialPlanSnapshot)(membership.planKey);
    return {
        from: `${membershipPlans_1.COMPANY.tradingName} <${fromEmail}>`,
        to: [membership.payerEmail],
        reply_to: membershipPlans_1.COMPANY.supportEmail,
        subject: `Welcome to Zero Alpha — ${commercialTerms.planName}`,
        html: buildWelcomeHtml(membership),
    };
}
/** Atomically creates a membership and its immutable confirmation/welcome outbox rows. */
async function ensureMembershipAndConfirmationOutbox(membershipRef, proposedMembership, initialChargePence, intentRef, intent) {
    var _a, _b;
    const outboxRef = db().collection(CONFIRMATION_OUTBOX_COLLECTION)
        .doc(membershipRef.id);
    const lockRefs = intent.reservationLockIds.map((id) => db().collection(CHECKOUT_LOCK_COLLECTION).doc(id));
    const participants = participantsFor(intent);
    const participantQueries = participantMembershipQueries(participantKeysFor(intent));
    const legacyParticipantQueries = legacySingularParticipantMembershipQueries(participants);
    const frozenGrantsAlphaWodAccess = (_b = (_a = intent.commercialTerms) === null || _a === void 0 ? void 0 : _a.grantsAlphaWodAccess) !== null && _b !== void 0 ? _b : (0, membershipPlans_1.getPlan)(intent.planKey).grantsAlphaWodAccess;
    const payerQuery = intent.payerUid && frozenGrantsAlphaWodAccess ?
        db().collection("memberships").where("payerUid", "==", intent.payerUid) :
        null;
    const targetQuery = intent.payerUid && frozenGrantsAlphaWodAccess ?
        db().collection("memberships").where("entitlementTargetUid", "==", intent.payerUid) :
        null;
    const transactionOutcome = await db().runTransaction(async (tx) => {
        // Every read precedes every write. The deterministic lock ownership check
        // is the final paid-session guard: even if an unusually late asynchronous
        // payment arrives after its reservation was reclaimed, two subscriptions
        // cannot both fulfil for the same participant/account.
        const freshIntent = await tx.get(intentRef);
        const membershipSnap = await tx.get(membershipRef);
        const outboxSnap = await tx.get(outboxRef);
        const lockSnaps = await Promise.all(lockRefs.map((ref) => tx.get(ref)));
        const participantSnaps = await Promise.all(participantQueries.map((query) => tx.get(query)));
        const legacyParticipantSnaps = await Promise.all(legacyParticipantQueries.map((query) => tx.get(query)));
        const byParticipant = participantMembershipDocs(participantSnaps, legacyParticipantSnaps, participants);
        const byPayer = payerQuery ? await tx.get(payerQuery) : null;
        const byTarget = targetQuery ? await tx.get(targetQuery) : null;
        const effectiveTargetUid = membershipSnap.exists ?
            membershipSnap.get("entitlementTargetUid") :
            proposedMembership.entitlementTargetUid;
        const effectiveState = membershipSnap.exists ?
            membershipSnap.get("state") : proposedMembership.state;
        const entitlementOwner = effectiveTargetUid &&
            (0, membershipPlans_1.isMembershipStateBlockingDuplicate)(effectiveState) ?
            await readEntitlementOwner(tx, effectiveTargetUid, membershipRef.id) : null;
        if (!freshIntent.exists) {
            throw new Error(`Checkout intent ${intentRef.id} disappeared during fulfilment.`);
        }
        const storedSessionId = freshIntent.get("checkoutSessionId");
        if (typeof storedSessionId === "string" &&
            storedSessionId !== proposedMembership.checkoutSessionId) {
            throw new Error(`Checkout intent ${intentRef.id} is bound to another Session.`);
        }
        const intentStatus = freshIntent.get("status");
        if ((intentStatus === "failed" || intentStatus === "expired") &&
            !membershipSnap.exists) {
            throw new Error(`Checkout intent ${intentRef.id} ended before fulfilment.`);
        }
        if (!storedSessionId) {
            tx.set(intentRef, Object.assign(Object.assign({ checkoutSessionId: proposedMembership.checkoutSessionId }, (intentStatus === "reserved" || intentStatus === "created" ?
                { status: "payment_pending" } : {})), { updatedAt: serverTimestamp() }), { merge: true });
        }
        if (!membershipSnap.exists) {
            const ownsEveryLock = lockRefs.length > 0 && lockSnaps.every((lock) => lock.exists && lock.get("intentId") === intentRef.id);
            const duplicateParticipant = byParticipant.some((doc) => doc.id !== membershipRef.id && isBlockingMembershipDoc(doc));
            const duplicatePayer = Boolean(byPayer === null || byPayer === void 0 ? void 0 : byPayer.docs.some((doc) => doc.id !== membershipRef.id &&
                doc.get("grantsAlphaWodAccess") === true &&
                isBlockingMembershipDoc(doc))) || Boolean(byTarget === null || byTarget === void 0 ? void 0 : byTarget.docs.some((doc) => doc.id !== membershipRef.id &&
                doc.get("grantsAlphaWodAccess") === true &&
                isBlockingMembershipDoc(doc)));
            if (!ownsEveryLock || duplicateParticipant || duplicatePayer) {
                throw new Error(`Checkout ${intentRef.id} no longer owns a unique fulfilment reservation.`);
            }
        }
        const membership = membershipSnap.exists ?
            membershipSnap.data() : proposedMembership;
        const alreadySent = membershipSnap.exists &&
            Boolean(membershipSnap.get("confirmationEmailSentAt"));
        const payload = alreadySent ? null :
            buildConfirmationPayload(membership, initialChargePence);
        const manualReviewReason = alreadySent ? null :
            !membership.payerEmail ?
                "Payer email was unavailable at fulfilment." :
                initialChargePence === null ?
                    "Stripe did not provide the amount charged at fulfilment." : null;
        if (!membershipSnap.exists) {
            if (effectiveTargetUid && entitlementOwner) {
                acquireEntitlementOwner(tx, entitlementOwner, effectiveTargetUid, membershipRef.id);
            }
            tx.create(membershipRef, Object.assign(Object.assign(Object.assign({}, proposedMembership), { confirmationEmailStatus: payload ? "pending" : "manual_review" }), (manualReviewReason ? { confirmationEmailError: manualReviewReason } : {})));
        }
        else if (alreadySent) {
            tx.set(membershipRef, { confirmationEmailStatus: "sent" }, { merge: true });
        }
        else if (payload && !outboxSnap.exists) {
            tx.set(membershipRef, {
                confirmationEmailStatus: "pending",
                updatedAt: serverTimestamp(),
            }, { merge: true });
        }
        else if (manualReviewReason) {
            tx.set(membershipRef, {
                confirmationEmailStatus: "manual_review",
                confirmationEmailError: manualReviewReason,
                updatedAt: serverTimestamp(),
            }, { merge: true });
        }
        if (payload && !outboxSnap.exists) {
            tx.create(outboxRef, {
                schemaVersion: membershipPlans_1.MEMBERSHIP_SCHEMA_VERSION,
                kind: "membership_confirmation",
                subscriptionId: membershipRef.id,
                commercialTerms: membership.commercialTerms,
                acceptedDocuments: membership.acceptances.documents,
                acceptedStatements: membership.acceptances.statements,
                signerRole: membership.acceptances.signerRole,
                status: "pending",
                payload,
                idempotencyKey: `membership-confirmation/${membershipRef.id}/v1`,
                initialChargePence,
                attemptCount: 0,
                nextAttemptAt: serverTimestamp(),
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
        }
        if (payload && !outboxSnap.exists) {
            return { manualReviewCreated: false, manualReviewReason: null };
        }
        if (manualReviewReason && !outboxSnap.exists) {
            tx.create(outboxRef, {
                schemaVersion: membershipPlans_1.MEMBERSHIP_SCHEMA_VERSION,
                kind: "membership_confirmation",
                subscriptionId: membershipRef.id,
                commercialTerms: membership.commercialTerms,
                acceptedDocuments: membership.acceptances.documents,
                acceptedStatements: membership.acceptances.statements,
                signerRole: membership.acceptances.signerRole,
                status: "manual_review",
                initialChargePence,
                deadLetterReason: manualReviewReason,
                deadLetteredAt: serverTimestamp(),
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
            return { manualReviewCreated: true, manualReviewReason };
        }
        return { manualReviewCreated: false, manualReviewReason: null };
    });
    if (transactionOutcome.manualReviewCreated) {
        console.error("CRITICAL_BILLING_CONFIRMATION_MANUAL_REVIEW", {
            subscriptionId: membershipRef.id,
            reason: transactionOutcome.manualReviewReason,
        });
        await writeAudit({
            type: "confirmation_email_terminal",
            severity: "critical",
            subscriptionId: membershipRef.id,
            reason: transactionOutcome.manualReviewReason,
        }).catch((error) => console.error("Could not write confirmation terminal audit", membershipRef.id, error));
    }
}
function confirmationEmailRetryAtMillis(attemptCount, nowMillis) {
    const exponent = Math.max(0, Math.min(attemptCount - 1, 4));
    return nowMillis + Math.min(60 * 60 * 1000, 5 * 60 * 1000 * (2 ** exponent));
}
const PERMANENT_RESEND_ERROR_NAMES = new Set([
    "invalid_attachment",
    "invalid_idempotency_key",
    "invalid_idempotent_request",
    "invalid_parameter",
    "invalid_to_address",
    "missing_required_field",
]);
const SYSTEMIC_RESEND_ERROR_NAMES = new Set([
    "missing_api_key",
    "invalid_api_key",
    "restricted_api_key",
    "invalid_from_address",
    "invalid_region",
    "validation_error",
    "daily_quota_exceeded",
    "monthly_quota_exceeded",
    "rate_limit_exceeded",
]);
function isPermanentConfirmationFailure(_status, providerErrorName = null) {
    return providerErrorName !== null &&
        PERMANENT_RESEND_ERROR_NAMES.has(providerErrorName);
}
function isSystemicResendFailure(status, providerErrorName) {
    return (providerErrorName !== null &&
        SYSTEMIC_RESEND_ERROR_NAMES.has(providerErrorName)) || status === 429;
}
function confirmationOutboxTerminalFields(status, reason) {
    return {
        status,
        deadLetteredAt: serverTimestamp(),
        deadLetterReason: reason,
        leaseToken: firestore_1.FieldValue.delete(),
        leaseExpiresAt: firestore_1.FieldValue.delete(),
        nextAttemptAt: firestore_1.FieldValue.delete(),
        updatedAt: serverTimestamp(),
    };
}
function checkoutRecoveryRoutingMismatch(outboxId, outbox, intent) {
    const intentId = intent.id;
    const manualRecoveryReason = intent.get("manualRecoveryReason");
    if (intent.get("status") !== "expired")
        return "intent_status";
    if (typeof intent.get("manualRecoveryBy") !== "string" ||
        !intent.get("manualRecoveryBy"))
        return "staff_release_actor";
    if (manualRecoveryReason !== "staff_verified_open_unpaid" &&
        manualRecoveryReason !== "staff_verified_provider_expired") {
        return "staff_release_reason";
    }
    if (intent.get("checkoutRecoveryEmailOutboxId") !== outboxId ||
        outboxId !== (0, membershipCheckoutRecovery_1.checkoutRecoveryOutboxId)(intentId))
        return "outbox_binding";
    if (intent.get("checkoutRecoveryEmailStatus") !== "pending") {
        return "intent_email_status";
    }
    if (outbox.get("intentId") !== intentId)
        return "intent_binding";
    if (outbox.get("checkoutSessionId") !== intent.get("checkoutSessionId")) {
        return "session_binding";
    }
    if (outbox.get("stripeMode") !== intent.get("stripeMode") ||
        intent.get("stripeMode") !==
            assertBillingDataPlaneEnvironment().stripeMode) {
        return "stripe_mode";
    }
    if (outbox.get("providerSessionStatus") !== "expired" ||
        outbox.get("providerPaymentStatus") !== "unpaid") {
        return "provider_terminal_evidence";
    }
    if (outbox.get("releaseReason") !== manualRecoveryReason ||
        outbox.get("releasedBy") !== intent.get("manualRecoveryBy")) {
        return "staff_release_binding";
    }
    return null;
}
function checkoutRecoveryPayloadMismatch(intentId, payload, idempotencyKey, outbox, intent) {
    if (!payload || typeof payload !== "object" ||
        typeof payload.from !== "string" || !payload.from ||
        !Array.isArray(payload.to) || payload.to.length !== 1 ||
        typeof payload.reply_to !== "string" ||
        typeof payload.subject !== "string" || !payload.subject ||
        typeof payload.text !== "string" || !payload.text ||
        typeof payload.html !== "string" || !payload.html ||
        payload.attachments !== undefined)
        return "payload_shape";
    const recipient = (0, membershipCheckoutRecovery_1.canonicalizeCheckoutRecoveryEmail)(payload.to[0]);
    if (!recipient || recipient !== payload.to[0])
        return "payload_recipient";
    if (idempotencyKey !== (0, membershipCheckoutRecovery_1.checkoutRecoveryIdempotencyKey)(intentId)) {
        return "idempotency_key";
    }
    const recipientHash = sha256(recipient);
    if (outbox.get("recipientEmailHash") !== recipientHash ||
        intent.get("checkoutRecoveryEmailRecipientHash") !== recipientHash ||
        intent.get("checkoutRecoveryEmailRecipientMasked") !==
            (0, membershipCheckoutRecovery_1.maskCheckoutRecoveryEmail)(recipient))
        return "recipient_binding";
    const source = outbox.get("recipientSource");
    if (!membershipCheckoutRecovery_1.CHECKOUT_RECOVERY_RECIPIENT_SOURCES.includes(source) ||
        intent.get("checkoutRecoveryEmailRecipientSource") !== source) {
        return "recipient_source";
    }
    return null;
}
async function acquireConfirmationEmailLease(outboxId, nowMillis = Date.now(), leaseToken = (0, crypto_1.randomUUID)()) {
    const outboxRef = db().collection(CONFIRMATION_OUTBOX_COLLECTION)
        .doc(outboxId);
    const outcome = await db().runTransaction(async (tx) => {
        const snap = await tx.get(outboxRef);
        if (!snap.exists) {
            return {
                result: { state: "missing" },
                terminalReason: null,
                kind: null,
                subscriptionId: null,
                intentId: null,
            };
        }
        const kind = snap.get("kind");
        if (!isMembershipEmailKind(kind)) {
            const terminalReason = "Membership email outbox routing evidence is missing or invalid.";
            tx.set(outboxRef, confirmationOutboxTerminalFields("dead_letter", terminalReason), { merge: true });
            return {
                result: { state: "terminal" },
                terminalReason,
                kind: null,
                subscriptionId: null,
                intentId: null,
            };
        }
        const rawSubscriptionId = snap.get("subscriptionId");
        const rawIntentId = snap.get("intentId");
        const subscriptionId = kind === "checkout_recovery" ? null :
            typeof rawSubscriptionId === "string" && rawSubscriptionId ?
                rawSubscriptionId : null;
        const intentId = kind === "checkout_recovery" &&
            typeof rawIntentId === "string" &&
            /^attempt_[a-f0-9]{64}$/.test(rawIntentId) ? rawIntentId : null;
        if ((kind === "checkout_recovery" &&
            (!intentId || outboxId !== (0, membershipCheckoutRecovery_1.checkoutRecoveryOutboxId)(intentId))) ||
            (kind !== "checkout_recovery" && !subscriptionId)) {
            const terminalReason = "Membership email outbox routing evidence is missing or invalid.";
            tx.set(outboxRef, confirmationOutboxTerminalFields("dead_letter", terminalReason), { merge: true });
            return {
                result: { state: "terminal" },
                terminalReason,
                kind,
                subscriptionId,
                intentId,
            };
        }
        const destinationRef = kind === "checkout_recovery" ?
            db().collection("membershipIntents").doc(intentId) :
            db().collection("memberships").doc(subscriptionId);
        const destination = await tx.get(destinationRef);
        if (!destination.exists) {
            const terminalReason = kind === "checkout_recovery" ?
                "Checkout recovery email outbox has no checkout intent document." :
                "Membership email outbox has no membership document.";
            tx.set(outboxRef, confirmationOutboxTerminalFields("manual_review", terminalReason), { merge: true });
            return {
                result: { state: "terminal" },
                terminalReason,
                kind,
                subscriptionId,
                intentId,
            };
        }
        const status = snap.get("status");
        if (status === "sent") {
            return {
                result: { state: "sent" },
                terminalReason: null,
                kind,
                subscriptionId,
                intentId,
            };
        }
        if (status === "dead_letter" || status === "manual_review") {
            return {
                result: { state: "terminal" },
                terminalReason: null,
                kind,
                subscriptionId,
                intentId,
            };
        }
        if (kind === "checkout_recovery") {
            const mismatch = checkoutRecoveryRoutingMismatch(outboxId, snap, destination);
            if (mismatch) {
                const terminalReason = `Checkout recovery email release evidence is invalid (${mismatch}).`;
                tx.set(outboxRef, confirmationOutboxTerminalFields("manual_review", terminalReason), { merge: true });
                tx.update(destinationRef, checkoutRecoveryEmailProjectionFields("manual_review", terminalReason));
                return {
                    result: { state: "terminal" },
                    terminalReason,
                    kind,
                    subscriptionId,
                    intentId,
                };
            }
        }
        if (status !== "pending" && status !== "sending") {
            const terminalReason = "Membership email outbox status is invalid.";
            tx.set(outboxRef, confirmationOutboxTerminalFields("dead_letter", terminalReason), { merge: true });
            if (kind === "checkout_recovery") {
                tx.update(destinationRef, checkoutRecoveryEmailProjectionFields("dead_letter", terminalReason));
            }
            else {
                tx.update(destinationRef, membershipEmailProjectionFields(kind, "dead_letter", terminalReason));
            }
            return {
                result: { state: "terminal" },
                terminalReason,
                kind,
                subscriptionId,
                intentId,
            };
        }
        const leaseExpiresAt = timestampMillis(snap.get("leaseExpiresAt"));
        if (status === "sending" && leaseExpiresAt !== null &&
            leaseExpiresAt > nowMillis) {
            return {
                result: { state: "in_progress" },
                terminalReason: null,
                kind,
                subscriptionId,
                intentId,
            };
        }
        const nextAttemptAt = timestampMillis(snap.get("nextAttemptAt"));
        if (status !== "sending" && nextAttemptAt !== null &&
            nextAttemptAt > nowMillis) {
            return {
                result: { state: "deferred" },
                terminalReason: null,
                kind,
                subscriptionId,
                intentId,
            };
        }
        const firstAttemptAt = timestampMillis(snap.get("firstAttemptAt"));
        const retryDeadlineAt = timestampMillis(snap.get("retryDeadlineAt"));
        if (retryDeadlineAt !== null && nowMillis >= retryDeadlineAt) {
            const terminalReason = "Resend idempotency window expired before confirmed delivery.";
            tx.set(outboxRef, confirmationOutboxTerminalFields("manual_review", terminalReason), { merge: true });
            if (kind === "checkout_recovery") {
                tx.update(destinationRef, checkoutRecoveryEmailProjectionFields("manual_review", "Delivery requires manual review."));
            }
            else {
                tx.update(destinationRef, membershipEmailProjectionFields(kind, "manual_review", "Delivery requires manual review."));
            }
            return {
                result: { state: "terminal" },
                terminalReason,
                kind,
                subscriptionId,
                intentId,
            };
        }
        const payload = snap.get("payload");
        const idempotencyKey = snap.get("idempotencyKey");
        const recoveryPayloadMismatch = kind === "checkout_recovery" ?
            checkoutRecoveryPayloadMismatch(intentId, payload, idempotencyKey, snap, destination) : null;
        if (!payload || typeof idempotencyKey !== "string" ||
            recoveryPayloadMismatch) {
            const terminalReason = recoveryPayloadMismatch ?
                `Checkout recovery email payload is invalid (${recoveryPayloadMismatch}).` :
                "Membership email payload is missing or invalid.";
            tx.set(outboxRef, confirmationOutboxTerminalFields("dead_letter", terminalReason), { merge: true });
            if (kind === "checkout_recovery") {
                tx.update(destinationRef, checkoutRecoveryEmailProjectionFields("dead_letter", terminalReason));
            }
            else {
                tx.update(destinationRef, membershipEmailProjectionFields(kind, "dead_letter", terminalReason));
            }
            return {
                result: { state: "terminal" },
                terminalReason,
                kind,
                subscriptionId,
                intentId,
            };
        }
        const attemptCount = typeof snap.get("attemptCount") === "number" ?
            snap.get("attemptCount") : 0;
        const newLeaseExpiresAt = firestore_1.Timestamp.fromMillis(nowMillis + CONFIRMATION_EMAIL_LEASE_MS);
        tx.set(outboxRef, Object.assign(Object.assign({ status: "sending", leaseToken, leaseExpiresAt: newLeaseExpiresAt, nextAttemptAt: newLeaseExpiresAt, attemptCount: attemptCount + 1, lastAttemptAt: serverTimestamp() }, (firstAttemptAt === null ? {
            firstAttemptAt: firestore_1.Timestamp.fromMillis(nowMillis),
            retryDeadlineAt: firestore_1.Timestamp.fromMillis(nowMillis + CONFIRMATION_EMAIL_RETRY_WINDOW_MS),
        } : {})), { updatedAt: serverTimestamp() }), { merge: true });
        const acquired = kind === "checkout_recovery" ? {
            state: "acquired",
            outboxId,
            subscriptionId: null,
            intentId: intentId,
            kind,
            leaseToken,
            payload,
            idempotencyKey,
            attemptCount: attemptCount + 1,
        } : {
            state: "acquired",
            outboxId,
            subscriptionId: subscriptionId,
            intentId: null,
            kind,
            leaseToken,
            payload,
            idempotencyKey,
            attemptCount: attemptCount + 1,
        };
        return {
            result: acquired,
            terminalReason: null,
            kind,
            subscriptionId,
            intentId,
        };
    });
    if (outcome.terminalReason) {
        const checkoutRecovery = outcome.kind === "checkout_recovery";
        const cancellationAcknowledgement = outcome.kind ===
            "membership_cancellation_acknowledgement";
        console.error(checkoutRecovery ?
            "CRITICAL_BILLING_CHECKOUT_RECOVERY_EMAIL_MANUAL_REVIEW" :
            cancellationAcknowledgement ?
                "CRITICAL_BILLING_CANCELLATION_ACKNOWLEDGEMENT_MANUAL_REVIEW" :
                "CRITICAL_BILLING_CONFIRMATION_MANUAL_REVIEW", {
            outboxId,
            subscriptionId: outcome.subscriptionId,
            intentId: outcome.intentId,
            reason: outcome.terminalReason,
        });
        await writeAudit({
            type: checkoutRecovery ? "checkout_recovery_email_terminal" :
                cancellationAcknowledgement ?
                    "cancellation_acknowledgement_terminal" :
                    "confirmation_email_terminal",
            severity: "critical",
            outboxId,
            subscriptionId: outcome.subscriptionId,
            intentId: outcome.intentId,
            reason: outcome.terminalReason,
        }).catch((error) => console.error("Could not write membership-email terminal audit", outboxId, error));
    }
    return outcome.result;
}
class ConfirmationDeliveryError extends Error {
    constructor(message, status, providerErrorName) {
        super(message);
        this.status = status;
        this.providerErrorName = providerErrorName;
    }
}
function redactCheckoutRecoveryDeliveryError(message) {
    return message.replace(/[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+/g, "[redacted-email]");
}
const sendConfirmationViaResend = async (payload, idempotencyKey) => {
    const apiKey = resendApiKey.value().trim();
    if (!apiKey) {
        throw new ConfirmationDeliveryError("RESEND_API_KEY is not configured.", null, "missing_api_key");
    }
    const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
            "User-Agent": "AlphaWOD-membership/1.0",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20000),
    });
    const body = await response.text();
    if (!response.ok) {
        let providerErrorName = null;
        let providerMessage = body;
        try {
            const parsed = JSON.parse(body);
            providerErrorName = typeof parsed.name === "string" ? parsed.name : null;
            providerMessage = typeof parsed.message === "string" ? parsed.message : body;
        }
        catch (_a) {
            // Keep the provider body as diagnostic context when it is not JSON.
        }
        throw new ConfirmationDeliveryError(providerMessage || response.statusText || `Resend returned ${response.status}.`, response.status, providerErrorName);
    }
    let providerMessageId = null;
    try {
        const parsed = JSON.parse(body);
        providerMessageId = typeof parsed.id === "string" ? parsed.id : null;
    }
    catch (_b) {
        // A 2xx response is authoritative even if its optional metadata is absent.
    }
    return { providerMessageId };
};
async function processMembershipConfirmationOutbox(outboxId, nowMillis = Date.now(), sender = sendConfirmationViaResend) {
    const lease = await acquireConfirmationEmailLease(outboxId, nowMillis);
    if (lease.state !== "acquired")
        return lease.state;
    const outboxRef = db().collection(CONFIRMATION_OUTBOX_COLLECTION)
        .doc(outboxId);
    const destinationRef = lease.kind === "checkout_recovery" ?
        db().collection("membershipIntents").doc(lease.intentId) :
        db().collection("memberships").doc(lease.subscriptionId);
    const ownerAuditFields = lease.kind === "checkout_recovery" ?
        { intentId: lease.intentId } : { subscriptionId: lease.subscriptionId };
    try {
        const delivery = await sender(lease.payload, lease.idempotencyKey);
        const markOutcome = await db().runTransaction(async (tx) => {
            const snap = await tx.get(outboxRef);
            const destination = await tx.get(destinationRef);
            if (!snap.exists || snap.get("status") !== "sending" ||
                snap.get("leaseToken") !== lease.leaseToken) {
                return { marked: false, missingDestination: false };
            }
            tx.set(outboxRef, {
                status: "sent",
                sentAt: serverTimestamp(),
                providerMessageId: delivery.providerMessageId,
                leaseToken: firestore_1.FieldValue.delete(),
                leaseExpiresAt: firestore_1.FieldValue.delete(),
                nextAttemptAt: firestore_1.FieldValue.delete(),
                lastError: firestore_1.FieldValue.delete(),
                updatedAt: serverTimestamp(),
            }, { merge: true });
            if (destination.exists) {
                tx.update(destinationRef, lease.kind === "checkout_recovery" ?
                    checkoutRecoveryEmailProjectionFields("sent", null, delivery.providerMessageId) : membershipEmailProjectionFields(lease.kind, "sent", null, delivery.providerMessageId));
            }
            return { marked: true, missingDestination: !destination.exists };
        });
        if (!markOutcome.marked)
            return "in_progress";
        if (markOutcome.missingDestination) {
            console.error(lease.kind === "checkout_recovery" ?
                "CRITICAL_BILLING_SENT_CHECKOUT_RECOVERY_EMAIL_ORPHAN" :
                lease.kind === "membership_cancellation_acknowledgement" ?
                    "CRITICAL_BILLING_SENT_CANCELLATION_ACKNOWLEDGEMENT_ORPHAN" :
                    "CRITICAL_BILLING_SENT_CONFIRMATION_ORPHAN", Object.assign({ outboxId }, ownerAuditFields));
            await writeAudit(Object.assign(Object.assign({ type: lease.kind === "checkout_recovery" ?
                    "checkout_recovery_email_orphaned_after_send" :
                    lease.kind === "membership_cancellation_acknowledgement" ?
                        "cancellation_acknowledgement_orphaned_after_send" :
                        "confirmation_email_orphaned_after_send", severity: "critical", outboxId }, ownerAuditFields), { providerMessageId: delivery.providerMessageId })).catch((error) => console.error("Could not write sent-orphan audit", outboxId, error));
        }
        await writeAudit(Object.assign(Object.assign({ type: lease.kind === "checkout_recovery" ?
                "checkout_recovery_email_sent" :
                lease.kind === "membership_cancellation_acknowledgement" ?
                    "cancellation_acknowledgement_sent" : "confirmation_email_sent", outboxId }, ownerAuditFields), { providerMessageId: delivery.providerMessageId })).catch((error) => console.error("Could not write membership email audit", outboxId, error));
        return "sent";
    }
    catch (error) {
        const errorStatus = error instanceof ConfirmationDeliveryError ?
            error.status : null;
        const providerErrorName = error instanceof ConfirmationDeliveryError ?
            error.providerErrorName : null;
        const rawMessage = error instanceof Error ? error.message : String(error);
        const message = lease.kind === "checkout_recovery" ?
            redactCheckoutRecoveryDeliveryError(rawMessage) : rawMessage;
        const failureNow = Math.max(nowMillis, Date.now());
        const failureOutcome = await db().runTransaction(async (tx) => {
            const snap = await tx.get(outboxRef);
            const destination = await tx.get(destinationRef);
            if (!snap.exists || snap.get("status") !== "sending" ||
                snap.get("leaseToken") !== lease.leaseToken)
                return null;
            const retryDeadlineAt = timestampMillis(snap.get("retryDeadlineAt"));
            const permanent = isPermanentConfirmationFailure(errorStatus, providerErrorName);
            const windowExpired = retryDeadlineAt !== null && failureNow >= retryDeadlineAt;
            const terminalStatus = permanent ? "dead_letter" : "manual_review";
            const orphan = !destination.exists;
            const terminal = permanent || windowExpired || orphan;
            tx.set(outboxRef, Object.assign(Object.assign({ status: terminal ? (orphan ? "manual_review" : terminalStatus) : "pending", lastError: message.slice(0, 1000), lastHttpStatus: errorStatus, lastProviderErrorName: providerErrorName, failedAt: serverTimestamp(), leaseToken: firestore_1.FieldValue.delete(), leaseExpiresAt: firestore_1.FieldValue.delete() }, (terminal ? {
                deadLetteredAt: serverTimestamp(),
                nextAttemptAt: firestore_1.FieldValue.delete(),
            } : {
                nextAttemptAt: firestore_1.Timestamp.fromMillis(confirmationEmailRetryAtMillis(lease.attemptCount, failureNow)),
            })), { updatedAt: serverTimestamp() }), { merge: true });
            if (destination.exists) {
                tx.update(destinationRef, lease.kind === "checkout_recovery" ?
                    checkoutRecoveryEmailProjectionFields(terminal ? terminalStatus : "pending", message.slice(0, 500)) : membershipEmailProjectionFields(lease.kind, terminal ? terminalStatus : "pending", message.slice(0, 500)));
            }
            return { terminal, orphan };
        });
        if (!failureOutcome)
            return "in_progress";
        const { terminal, orphan } = failureOutcome;
        if (terminal || orphan) {
            console.error(lease.kind === "checkout_recovery" ?
                "CRITICAL_BILLING_CHECKOUT_RECOVERY_EMAIL_MANUAL_REVIEW" :
                lease.kind === "membership_cancellation_acknowledgement" ?
                    "CRITICAL_BILLING_CANCELLATION_ACKNOWLEDGEMENT_MANUAL_REVIEW" :
                    "CRITICAL_BILLING_CONFIRMATION_MANUAL_REVIEW", Object.assign(Object.assign({ outboxId }, ownerAuditFields), { providerErrorName, error: message, orphan }));
            await writeAudit(Object.assign(Object.assign({ type: lease.kind === "checkout_recovery" ?
                    "checkout_recovery_email_terminal" :
                    lease.kind === "membership_cancellation_acknowledgement" ?
                        "cancellation_acknowledgement_terminal" :
                        "confirmation_email_terminal", severity: "critical", outboxId }, ownerAuditFields), { providerErrorName, error: message.slice(0, 1000), orphan })).catch((auditError) => console.error("Could not write membership-email terminal audit", outboxId, auditError));
        }
        else {
            if (lease.kind === "checkout_recovery") {
                console.error("Checkout recovery email delivery failed", {
                    outboxId,
                    intentId: lease.intentId,
                    providerErrorName,
                    status: errorStatus,
                    error: message,
                });
            }
            else {
                console.error("Membership email delivery failed", outboxId, error);
            }
        }
        if (!terminal && isSystemicResendFailure(errorStatus, providerErrorName)) {
            console.error("CRITICAL_BILLING_RESEND_CONFIGURATION", {
                providerErrorName,
                status: errorStatus,
            });
            return "systemic_failure";
        }
        return "failed";
    }
}
async function retryDueMembershipConfirmationsOnce(nowMillis = Date.now(), limit = 50, sender = sendConfirmationViaResend) {
    const due = await db().collection(CONFIRMATION_OUTBOX_COLLECTION)
        .where("nextAttemptAt", "<=", firestore_1.Timestamp.fromMillis(nowMillis))
        .orderBy("nextAttemptAt", "asc")
        .limit(limit)
        .get();
    const result = { sent: 0, failed: 0, skipped: 0 };
    for (const outbox of due.docs) {
        const itemNow = Math.max(nowMillis, Date.now());
        const status = await processMembershipConfirmationOutbox(outbox.id, itemNow, sender);
        if (status === "sent")
            result.sent += 1;
        else if (status === "failed" || status === "systemic_failure")
            result.failed += 1;
        else
            result.skipped += 1;
        // A bad key, unverified sender/domain, or provider-wide quota applies to
        // every row. Stop this batch so one configuration incident cannot churn all
        // confirmations; the next schedule retries after operators are alerted.
        if (status === "systemic_failure")
            break;
    }
    return result;
}
function buildRetryMembershipConfirmations() {
    return (0, scheduler_1.onSchedule)({
        region: REGION,
        schedule: "every 5 minutes",
        timeZone: "UTC",
        secrets: exports.MEMBERSHIP_EMAIL_WORKER_SECRETS,
        timeoutSeconds: 540,
    }, async () => {
        const result = await retryDueMembershipConfirmationsOnce();
        console.log("Membership confirmation retry result", result);
    });
}
//# sourceMappingURL=membership.js.map