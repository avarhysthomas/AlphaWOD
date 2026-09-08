"use strict";
/* eslint-disable require-jsdoc, max-len */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONDITIONING_SLOT_KEYS = exports.APP_ACCESS_TIERS = void 0;
exports.isAppAccessTier = isAppAccessTier;
exports.isConditioningSlotKey = isConditioningSlotKey;
exports.canonicalConditioningSlots = canonicalConditioningSlots;
exports.canonicalConditioningEligibleSlots = canonicalConditioningEligibleSlots;
/**
 * Leaf access-policy primitives shared by the membership catalogue and
 * authorisation resolver. Keeping this module dependency-free prevents the
 * catalogue/current-waiver relationship from forming a runtime import cycle.
 */
exports.APP_ACCESS_TIERS = ["none", "limited", "full"];
exports.CONDITIONING_SLOT_KEYS = [
    "monday_0600",
    "tuesday_1800",
    "thursday_1800",
    "friday_0530",
];
function isAppAccessTier(value) {
    return typeof value === "string" &&
        exports.APP_ACCESS_TIERS.includes(value);
}
function isConditioningSlotKey(value) {
    return typeof value === "string" &&
        exports.CONDITIONING_SLOT_KEYS.includes(value);
}
/**
 * Returns the two fixed historical schema-v6 Half-membership slots in
 * canonical catalogue order. Current schema-v7 memberships use
 * canonicalConditioningEligibleSlots instead.
 * Any duplicate, unknown, missing, or additional value fails closed.
 * @param {unknown} value Candidate stored or submitted slot list.
 * @return {ConditioningSlotKey[] | null} Canonical slots, or null when invalid.
 */
function canonicalConditioningSlots(value) {
    if (!Array.isArray(value) || value.length !== 2 ||
        !value.every(isConditioningSlotKey))
        return null;
    const unique = new Set(value);
    if (unique.size !== 2)
        return null;
    return exports.CONDITIONING_SLOT_KEYS.filter((slot) => unique.has(slot));
}
/**
 * Returns the complete canonical flexible Conditioning scope, or null.
 * @param {unknown} value Candidate stored eligible-slot scope.
 * @return {ConditioningSlotKey[] | null} Canonical complete scope or null.
 */
function canonicalConditioningEligibleSlots(value) {
    if (!Array.isArray(value) || value.length !== exports.CONDITIONING_SLOT_KEYS.length ||
        !value.every(isConditioningSlotKey))
        return null;
    const unique = new Set(value);
    if (unique.size !== exports.CONDITIONING_SLOT_KEYS.length)
        return null;
    return exports.CONDITIONING_SLOT_KEYS.filter((slot) => unique.has(slot));
}
//# sourceMappingURL=accessPolicy.js.map