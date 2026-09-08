"use strict";
/* eslint-disable require-jsdoc, max-len */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MANAGED_CLAIM_KEYS = exports.CURRENT_WAIVER_ACKNOWLEDGEMENTS = exports.CURRENT_WAIVER_TITLE = exports.CURRENT_WAIVER_VERSION = exports.ENTITLEMENT_SOURCES = exports.ENTITLEMENT_STATUSES = exports.APPROVAL_STATUSES = exports.USER_ROLES = exports.CLAIMS_VERSION = exports.ACCESS_SCHEMA_VERSION = exports.isConditioningSlotKey = exports.isAppAccessTier = exports.CONDITIONING_SLOT_KEYS = exports.canonicalConditioningSlots = exports.canonicalConditioningEligibleSlots = exports.APP_ACCESS_TIERS = void 0;
exports.isCanonicalCurrentWaiverAcceptance = isCanonicalCurrentWaiverAcceptance;
exports.isUserRole = isUserRole;
exports.isApprovalStatus = isApprovalStatus;
exports.isEntitlementStatus = isEntitlementStatus;
exports.isEntitlementSource = isEntitlementSource;
exports.isValidEntitlementPair = isValidEntitlementPair;
exports.isEntitlementCompatibleWithRole = isEntitlementCompatibleWithRole;
exports.resolveUserAuthorisation = resolveUserAuthorisation;
exports.buildManagedClaims = buildManagedClaims;
exports.mergeManagedClaims = mergeManagedClaims;
exports.claimsEqual = claimsEqual;
const accessPolicy_1 = require("./accessPolicy");
const membershipPlans_1 = require("./membershipPlans");
var accessPolicy_2 = require("./accessPolicy");
Object.defineProperty(exports, "APP_ACCESS_TIERS", { enumerable: true, get: function () { return accessPolicy_2.APP_ACCESS_TIERS; } });
Object.defineProperty(exports, "canonicalConditioningEligibleSlots", { enumerable: true, get: function () { return accessPolicy_2.canonicalConditioningEligibleSlots; } });
Object.defineProperty(exports, "canonicalConditioningSlots", { enumerable: true, get: function () { return accessPolicy_2.canonicalConditioningSlots; } });
Object.defineProperty(exports, "CONDITIONING_SLOT_KEYS", { enumerable: true, get: function () { return accessPolicy_2.CONDITIONING_SLOT_KEYS; } });
Object.defineProperty(exports, "isAppAccessTier", { enumerable: true, get: function () { return accessPolicy_2.isAppAccessTier; } });
Object.defineProperty(exports, "isConditioningSlotKey", { enumerable: true, get: function () { return accessPolicy_2.isConditioningSlotKey; } });
exports.ACCESS_SCHEMA_VERSION = 3;
exports.CLAIMS_VERSION = 4;
exports.USER_ROLES = ["admin", "user", "sgpt", "banned"];
exports.APPROVAL_STATUSES = ["approved", "pending"];
exports.ENTITLEMENT_STATUSES = ["none", "active", "restricted"];
exports.ENTITLEMENT_SOURCES = ["none", "legacy", "manual", "stripe", "staff"];
const adultWaiverAcceptance = (0, membershipPlans_1.resolveCheckoutAcceptanceStatements)("adult_unlimited").find(({ id }) => id === "adult_participant_waiver");
if (!adultWaiverAcceptance) {
    throw new Error("The canonical Adult Waiver acceptance statement is missing.");
}
/**
 * Current app-waiver metadata is derived from the exact immutable document and
 * acceptance statement used by membership checkout. Historical waiver records
 * stay stored under their original versions but cannot satisfy this marker.
 */
exports.CURRENT_WAIVER_VERSION = membershipPlans_1.CHECKOUT_DOCUMENTS.adultWaiver.version;
exports.CURRENT_WAIVER_TITLE = membershipPlans_1.CHECKOUT_DOCUMENTS.adultWaiver.title;
exports.CURRENT_WAIVER_ACKNOWLEDGEMENTS = [
    adultWaiverAcceptance.statement,
];
function isFirestoreTimestampLike(value) {
    if (!value || typeof value !== "object")
        return false;
    const timestamp = value;
    return Number.isSafeInteger(timestamp.seconds) &&
        Number.isInteger(timestamp.nanoseconds) &&
        Number(timestamp.nanoseconds) >= 0 &&
        Number(timestamp.nanoseconds) < 1000000000;
}
/**
 * Checks the exact evidence shape trusted to back the current waiver marker.
 * @param {string} userId Expected authenticated user ID.
 * @param {unknown} value Candidate waiver evidence.
 * @return {boolean} Whether the evidence is canonical and complete.
 */
function isCanonicalCurrentWaiverAcceptance(userId, value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
    const acceptance = value;
    const acceptedName = typeof acceptance.acceptedName === "string" ?
        acceptance.acceptedName.trim() : "";
    const acceptedEmail = acceptance.acceptedEmail;
    const emailValid = acceptedEmail === null || (typeof acceptedEmail === "string" &&
        acceptedEmail.length > 0 &&
        acceptedEmail.length <= 320 &&
        acceptedEmail === acceptedEmail.trim().toLowerCase());
    const authenticatedAt = acceptance.authenticatedAt;
    const authenticatedAtValid = authenticatedAt === null || (typeof authenticatedAt === "number" &&
        Number.isFinite(authenticatedAt) && authenticatedAt >= 0);
    const signInProvider = acceptance.signInProvider;
    const signInProviderValid = signInProvider === null || (typeof signInProvider === "string" && signInProvider.length <= 100);
    const acknowledgements = acceptance.acknowledgements;
    return acceptance.acceptanceSchemaVersion === 1 &&
        acceptance.userId === userId &&
        acceptance.version === exports.CURRENT_WAIVER_VERSION &&
        acceptance.agreementTitle === exports.CURRENT_WAIVER_TITLE &&
        acceptance.source === "authenticated_callable" &&
        isFirestoreTimestampLike(acceptance.acceptedAt) &&
        acceptedName.length >= 2 && acceptedName.length <= 160 &&
        emailValid &&
        typeof acceptance.acceptedEmailVerified === "boolean" &&
        Array.isArray(acknowledgements) &&
        acknowledgements.length === exports.CURRENT_WAIVER_ACKNOWLEDGEMENTS.length &&
        exports.CURRENT_WAIVER_ACKNOWLEDGEMENTS.every((text, index) => acknowledgements[index] === text) &&
        typeof acceptance.mediaConsent === "boolean" &&
        authenticatedAtValid &&
        signInProviderValid &&
        typeof acceptance.userAgent === "string" &&
        acceptance.userAgent.length <= 500;
}
exports.MANAGED_CLAIM_KEYS = [
    "role",
    "approvalStatus",
    "entitlementStatus",
    "entitlementSource",
    "appAccessTier",
    "entitlementClassSlots",
    "entitlementWeeklyBookingLimit",
    "alphaWodAccess",
    "disabled",
    "restricted",
    "accessSchemaVersion",
    "claimsVersion",
];
function isUserRole(value) {
    return typeof value === "string" && exports.USER_ROLES.includes(value);
}
function isApprovalStatus(value) {
    return typeof value === "string" &&
        exports.APPROVAL_STATUSES.includes(value);
}
function isEntitlementStatus(value) {
    return typeof value === "string" &&
        exports.ENTITLEMENT_STATUSES.includes(value);
}
function isEntitlementSource(value) {
    return typeof value === "string" &&
        exports.ENTITLEMENT_SOURCES.includes(value);
}
function isValidEntitlementPair(status, source) {
    if (status === "none")
        return source === "none";
    return source !== "none";
}
function isEntitlementCompatibleWithRole(role, status, source) {
    if (!isValidEntitlementPair(status, source))
        return false;
    if (status !== "active")
        return true;
    if (role === "admin" || role === "sgpt")
        return source === "staff";
    if (role === "banned")
        return false;
    return source === "legacy" || source === "manual" || source === "stripe";
}
function resolveUserAuthorisation(input, options = {}) {
    const profileExists = options.profileExists !== false;
    const issues = [];
    const roleValid = isUserRole(input === null || input === void 0 ? void 0 : input.role);
    const approvalValid = isApprovalStatus(input === null || input === void 0 ? void 0 : input.approvalStatus);
    const entitlementStatusValid = isEntitlementStatus(input === null || input === void 0 ? void 0 : input.entitlementStatus);
    const entitlementSourceValid = isEntitlementSource(input === null || input === void 0 ? void 0 : input.entitlementSource);
    const appAccessTierPresent = (input === null || input === void 0 ? void 0 : input.appAccessTier) !== undefined &&
        (input === null || input === void 0 ? void 0 : input.appAccessTier) !== null;
    const appAccessTierValid = !appAccessTierPresent ||
        (0, accessPolicy_1.isAppAccessTier)(input === null || input === void 0 ? void 0 : input.appAccessTier);
    if (!profileExists)
        issues.push("profile_missing");
    if (!roleValid)
        issues.push("role_invalid");
    if (!approvalValid)
        issues.push("approval_status_invalid");
    if (!entitlementStatusValid)
        issues.push("entitlement_status_invalid");
    if (!entitlementSourceValid)
        issues.push("entitlement_source_invalid");
    if (!appAccessTierValid)
        issues.push("app_access_tier_invalid");
    const rawStatus = entitlementStatusValid ?
        input === null || input === void 0 ? void 0 : input.entitlementStatus : "none";
    const rawSource = entitlementSourceValid ?
        input === null || input === void 0 ? void 0 : input.entitlementSource : "none";
    const pairValid = isValidEntitlementPair(rawStatus, rawSource);
    if (!pairValid)
        issues.push("entitlement_pair_invalid");
    const structurallyValid = profileExists && roleValid && approvalValid &&
        entitlementStatusValid && entitlementSourceValid && pairValid &&
        appAccessTierValid;
    const role = structurallyValid ? input === null || input === void 0 ? void 0 : input.role : "user";
    const approvalStatus = structurallyValid ?
        input === null || input === void 0 ? void 0 : input.approvalStatus : "pending";
    const entitlementStatus = structurallyValid ? rawStatus : "none";
    const entitlementSource = structurallyValid ? rawSource : "none";
    const explicitlyBanned = roleValid && (input === null || input === void 0 ? void 0 : input.role) === "banned";
    const baseStaffAccess = (role === "admin" || role === "sgpt") &&
        entitlementStatus === "active" && entitlementSource === "staff";
    const baseMemberAccess = role === "user" &&
        entitlementStatus === "active" &&
        (entitlementSource === "legacy" || entitlementSource === "manual" ||
            entitlementSource === "stripe");
    let accessPolicyValid = true;
    let entitlementPolicyAppAccessTier = "none";
    let entitlementPolicyClassSlots = [];
    let entitlementPolicyWeeklyBookingLimit = null;
    if (baseStaffAccess) {
        entitlementPolicyAppAccessTier = "full";
    }
    else if (role === "user" && entitlementSource === "stripe") {
        // Stripe policy remains meaningful while approval or the membership state
        // gates effective access. Never erase a paid Conditioning member's frozen
        // slots merely because their account is pending, suspended, or disputed.
        const hasNoPolicySlots = (input === null || input === void 0 ? void 0 : input.entitlementClassSlots) === undefined ||
            (input === null || input === void 0 ? void 0 : input.entitlementClassSlots) === null ||
            (Array.isArray(input.entitlementClassSlots) &&
                input.entitlementClassSlots.length === 0);
        const hasNoWeeklyLimit = (input === null || input === void 0 ? void 0 : input.entitlementWeeklyBookingLimit) ===
            undefined || (input === null || input === void 0 ? void 0 : input.entitlementWeeklyBookingLimit) === null;
        if (entitlementStatus === "restricted" &&
            (input === null || input === void 0 ? void 0 : input.appAccessTier) === "none" && hasNoPolicySlots &&
            hasNoWeeklyLimit) {
            // An invalid provider/commercial contract is projected as an explicit
            // fail-closed Stripe restriction. It carries no usable policy.
            entitlementPolicyAppAccessTier = "none";
        }
        else if ((input === null || input === void 0 ? void 0 : input.entitlementPlanKey) === "adult_unlimited" &&
            (!appAccessTierPresent || (input === null || input === void 0 ? void 0 : input.appAccessTier) === "full") &&
            hasNoPolicySlots && hasNoWeeklyLimit) {
            entitlementPolicyAppAccessTier = "full";
        }
        else if ((input === null || input === void 0 ? void 0 : input.entitlementPlanKey) === "adult_conditioning" &&
            (!appAccessTierPresent || (input === null || input === void 0 ? void 0 : input.appAccessTier) === "limited")) {
            const weeklyLimit = input === null || input === void 0 ? void 0 : input.entitlementWeeklyBookingLimit;
            const flexibleSlots = (0, accessPolicy_1.canonicalConditioningEligibleSlots)(input === null || input === void 0 ? void 0 : input.entitlementClassSlots);
            const legacySlots = (0, accessPolicy_1.canonicalConditioningSlots)(input === null || input === void 0 ? void 0 : input.entitlementClassSlots);
            if (weeklyLimit === 2 && flexibleSlots) {
                entitlementPolicyAppAccessTier = "limited";
                entitlementPolicyClassSlots = flexibleSlots;
                entitlementPolicyWeeklyBookingLimit = 2;
            }
            else if ((weeklyLimit === undefined || weeklyLimit === null) &&
                legacySlots) {
                entitlementPolicyAppAccessTier = "limited";
                entitlementPolicyClassSlots = legacySlots;
            }
            else {
                accessPolicyValid = false;
            }
        }
        else {
            // A Stripe entitlement without a recognised plan/tier is never upgraded
            // by a truthy legacy boolean.
            accessPolicyValid = false;
        }
    }
    else if (baseMemberAccess) {
        const requestedTier = appAccessTierPresent ?
            input === null || input === void 0 ? void 0 : input.appAccessTier : "full";
        if (requestedTier === "limited") {
            const slots = (0, accessPolicy_1.canonicalConditioningSlots)(input === null || input === void 0 ? void 0 : input.entitlementClassSlots);
            if (slots && ((input === null || input === void 0 ? void 0 : input.entitlementWeeklyBookingLimit) === undefined ||
                (input === null || input === void 0 ? void 0 : input.entitlementWeeklyBookingLimit) === null)) {
                entitlementPolicyAppAccessTier = "limited";
                entitlementPolicyClassSlots = slots;
            }
            else {
                accessPolicyValid = false;
            }
        }
        else {
            const hasNoPolicySlots = (input === null || input === void 0 ? void 0 : input.entitlementClassSlots) === undefined ||
                (input === null || input === void 0 ? void 0 : input.entitlementClassSlots) === null ||
                (Array.isArray(input.entitlementClassSlots) &&
                    input.entitlementClassSlots.length === 0);
            if (hasNoPolicySlots &&
                ((input === null || input === void 0 ? void 0 : input.entitlementWeeklyBookingLimit) === undefined ||
                    (input === null || input === void 0 ? void 0 : input.entitlementWeeklyBookingLimit) === null)) {
                entitlementPolicyAppAccessTier = requestedTier;
            }
            else {
                accessPolicyValid = false;
            }
        }
    }
    if (!accessPolicyValid)
        issues.push("app_access_policy_invalid");
    const valid = structurallyValid && accessPolicyValid;
    const disabled = !profileExists || !valid || explicitlyBanned;
    const alphaWodAccess = valid && !explicitlyBanned &&
        approvalStatus === "approved" && (baseStaffAccess || baseMemberAccess) &&
        entitlementPolicyAppAccessTier !== "none";
    return {
        role: explicitlyBanned && valid ? "banned" : role,
        approvalStatus,
        entitlementStatus,
        entitlementSource,
        entitlementPolicyAppAccessTier,
        entitlementPolicyClassSlots,
        entitlementPolicyWeeklyBookingLimit,
        appAccessTier: alphaWodAccess ? entitlementPolicyAppAccessTier : "none",
        entitlementClassSlots: alphaWodAccess &&
            entitlementPolicyAppAccessTier === "limited" ?
            entitlementPolicyClassSlots : [],
        entitlementWeeklyBookingLimit: alphaWodAccess &&
            entitlementPolicyAppAccessTier === "limited" ?
            entitlementPolicyWeeklyBookingLimit : null,
        alphaWodAccess,
        disabled,
        restricted: !alphaWodAccess,
        valid,
        issues,
    };
}
function buildManagedClaims(input, options = {}) {
    const resolved = resolveUserAuthorisation(input, options);
    return {
        role: resolved.role,
        approvalStatus: resolved.approvalStatus,
        entitlementStatus: resolved.entitlementStatus,
        entitlementSource: resolved.entitlementSource,
        appAccessTier: resolved.appAccessTier,
        entitlementClassSlots: resolved.entitlementClassSlots,
        entitlementWeeklyBookingLimit: resolved.entitlementWeeklyBookingLimit,
        alphaWodAccess: resolved.alphaWodAccess,
        disabled: resolved.disabled,
        restricted: resolved.restricted,
        accessSchemaVersion: exports.ACCESS_SCHEMA_VERSION,
        claimsVersion: exports.CLAIMS_VERSION,
    };
}
function mergeManagedClaims(existingClaims, managedClaims) {
    const managedKeys = new Set(exports.MANAGED_CLAIM_KEYS);
    const preserved = Object.fromEntries(Object.entries(existingClaims || {}).filter(([key]) => !managedKeys.has(key)));
    return Object.assign(Object.assign({}, preserved), managedClaims);
}
function stableValue(value) {
    if (Array.isArray(value))
        return value.map(stableValue);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, nested]) => [key, stableValue(nested)]));
    }
    return value;
}
function claimsEqual(left, right) {
    return JSON.stringify(stableValue(left || {})) ===
        JSON.stringify(stableValue(right || {}));
}
//# sourceMappingURL=authz.js.map