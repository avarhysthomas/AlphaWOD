"use strict";
/* eslint-disable require-jsdoc, max-len */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MANAGED_CLAIM_KEYS = exports.CURRENT_WAIVER_ACKNOWLEDGEMENTS = exports.CURRENT_WAIVER_TITLE = exports.CURRENT_WAIVER_VERSION = exports.ENTITLEMENT_SOURCES = exports.ENTITLEMENT_STATUSES = exports.APPROVAL_STATUSES = exports.USER_ROLES = exports.CLAIMS_VERSION = exports.ACCESS_SCHEMA_VERSION = void 0;
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
exports.ACCESS_SCHEMA_VERSION = 1;
exports.CLAIMS_VERSION = 2;
exports.USER_ROLES = ["admin", "user", "sgpt", "banned"];
exports.APPROVAL_STATUSES = ["approved", "pending"];
exports.ENTITLEMENT_STATUSES = ["none", "active", "restricted"];
exports.ENTITLEMENT_SOURCES = ["none", "legacy", "manual", "stripe", "staff"];
exports.CURRENT_WAIVER_VERSION = "2026-30-05";
exports.CURRENT_WAIVER_TITLE = "Zero Alpha Fitness — Participation Agreement, Assumption of Risk & Liability Waiver";
exports.CURRENT_WAIVER_ACKNOWLEDGEMENTS = [
    "I have read and understood this Agreement and accept the risks in Clause 3.",
    "I will follow all instructions and rules and take responsibility for my own pacing under Clause 4.",
    "I will disclose relevant medical conditions and stop if unwell under Clause 2.",
    "I understand the release/indemnity and the UK carve-out for negligence in Clause 5.",
    "I understand the data processing summary and where to find the Privacy Notice under Clause 8.",
    "If applicable, I agree to the Membership Terms under Clause 10.",
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
    const rawStatus = entitlementStatusValid ?
        input === null || input === void 0 ? void 0 : input.entitlementStatus : "none";
    const rawSource = entitlementSourceValid ?
        input === null || input === void 0 ? void 0 : input.entitlementSource : "none";
    const pairValid = isValidEntitlementPair(rawStatus, rawSource);
    if (!pairValid)
        issues.push("entitlement_pair_invalid");
    const valid = profileExists && roleValid && approvalValid &&
        entitlementStatusValid && entitlementSourceValid && pairValid;
    const role = valid ? input.role : "user";
    const approvalStatus = valid ?
        input.approvalStatus : "pending";
    const entitlementStatus = valid ? rawStatus : "none";
    const entitlementSource = valid ? rawSource : "none";
    const explicitlyBanned = roleValid && (input === null || input === void 0 ? void 0 : input.role) === "banned";
    const disabled = !profileExists || !valid || explicitlyBanned;
    const staffAccess = (role === "admin" || role === "sgpt") &&
        entitlementStatus === "active" && entitlementSource === "staff";
    const memberAccess = role === "user" &&
        entitlementStatus === "active" &&
        (entitlementSource === "legacy" ||
            entitlementSource === "manual" || entitlementSource === "stripe");
    const alphaWodAccess = valid && !explicitlyBanned &&
        approvalStatus === "approved" && (staffAccess || memberAccess);
    return {
        role: explicitlyBanned && valid ? "banned" : role,
        approvalStatus,
        entitlementStatus,
        entitlementSource,
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