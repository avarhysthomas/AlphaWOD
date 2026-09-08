"use strict";
/* eslint-disable require-jsdoc, max-len */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONDITIONING_WEEKLY_USAGE_COLLECTION = void 0;
exports.conditioningWeekForClassStart = conditioningWeekForClassStart;
exports.reserveConditioningWeeklyQuota = reserveConditioningWeeklyQuota;
exports.prepareConditioningQuotaRelease = prepareConditioningQuotaRelease;
exports.applyConditioningQuotaRelease = applyConditioningQuotaRelease;
const crypto_1 = require("crypto");
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const luxon_1 = require("luxon");
const membershipPlans_1 = require("./membershipPlans");
exports.CONDITIONING_WEEKLY_USAGE_COLLECTION = "conditioningWeeklyBookingUsage";
function quotaError(message, reason = "conditioning_weekly_quota_invalid") {
    return new https_1.HttpsError("failed-precondition", message, { reason });
}
function dateFromTimestampLike(value) {
    if (!value || typeof value !== "object" ||
        !("toDate" in value) || typeof value.toDate !== "function")
        return null;
    const date = value.toDate();
    return date instanceof Date && Number.isFinite(date.getTime()) ? date : null;
}
function conditioningWeekForClassStart(classStart) {
    const date = dateFromTimestampLike(classStart);
    if (!date)
        return null;
    const london = luxon_1.DateTime.fromJSDate(date, {
        zone: membershipPlans_1.CONDITIONING_BOOKING_POLICY.timezone,
    });
    if (!london.isValid)
        return null;
    const monday = london.startOf("week").startOf("day");
    return {
        weekKey: monday.toFormat("yyyy-LL-dd"),
        weekEndsOn: monday.plus({ days: 6 }).toFormat("yyyy-LL-dd"),
    };
}
function usageIdFor(userId, weekKey) {
    return (0, crypto_1.createHash)("sha256")
        .update(`conditioning-week:${userId}:${weekKey}`)
        .digest("hex");
}
function assertCurrentPolicy(policy) {
    if (policy.version !== membershipPlans_1.CONDITIONING_BOOKING_POLICY.version ||
        policy.timezone !== membershipPlans_1.CONDITIONING_BOOKING_POLICY.timezone ||
        policy.weekStartsOn !== membershipPlans_1.CONDITIONING_BOOKING_POLICY.weekStartsOn ||
        policy.weeklyBookingLimit !==
            membershipPlans_1.CONDITIONING_BOOKING_POLICY.weeklyBookingLimit ||
        policy.eligibleSlotKeys.length !==
            membershipPlans_1.CONDITIONING_BOOKING_POLICY.eligibleSlotKeys.length ||
        !membershipPlans_1.CONDITIONING_BOOKING_POLICY.eligibleSlotKeys.every((slot, index) => policy.eligibleSlotKeys[index] === slot)) {
        throw quotaError("The membership's weekly booking policy is invalid.");
    }
}
function validateStoredUsage(data, userId, weekKey, policy) {
    const activeBookingIds = data.activeBookingIds;
    if (data.schemaVersion !== 1 || data.userId !== userId ||
        data.weekKey !== weekKey || data.timezone !== policy.timezone ||
        data.weekStartsOn !== policy.weekStartsOn ||
        data.weeklyBookingLimit !== policy.weeklyBookingLimit ||
        !Array.isArray(activeBookingIds) ||
        activeBookingIds.some((id) => typeof id !== "string" || !id) ||
        new Set(activeBookingIds).size !== activeBookingIds.length ||
        activeBookingIds.length > policy.weeklyBookingLimit ||
        data.bookedCount !== activeBookingIds.length) {
        throw quotaError("The weekly booking counter needs support before it can be changed.");
    }
    return activeBookingIds;
}
async function reserveConditioningWeeklyQuota(tx, firestore, input) {
    assertCurrentPolicy(input.policy);
    if (!input.policy.eligibleSlotKeys.includes(input.classSlot)) {
        throw quotaError("This class is not included in Adult Conditioning membership.", "class_not_conditioning_membership_slot");
    }
    const week = conditioningWeekForClassStart(input.classStart);
    if (!week)
        throw quotaError("The class week could not be resolved safely.");
    const usageId = usageIdFor(input.userId, week.weekKey);
    const ref = firestore.collection(exports.CONDITIONING_WEEKLY_USAGE_COLLECTION)
        .doc(usageId);
    const snap = await tx.get(ref);
    const activeBookingIds = snap.exists ? validateStoredUsage(snap.data(), input.userId, week.weekKey, input.policy) : [];
    if (!activeBookingIds.includes(input.bookingId) &&
        activeBookingIds.length >= input.policy.weeklyBookingLimit) {
        throw new https_1.HttpsError("failed-precondition", "This membership has already booked two Conditioning classes in this Monday-to-Sunday week.", {
            reason: "conditioning_weekly_booking_limit_reached",
            weeklyBookingLimit: input.policy.weeklyBookingLimit,
            weekStartsOn: week.weekKey,
            weekEndsOn: week.weekEndsOn,
            timezone: input.policy.timezone,
        });
    }
    const nextBookingIds = activeBookingIds.includes(input.bookingId) ?
        activeBookingIds : [...activeBookingIds, input.bookingId].sort();
    tx.set(ref, Object.assign(Object.assign({ schemaVersion: 1, userId: input.userId, weekKey: week.weekKey, timezone: input.policy.timezone, weekStartsOn: input.policy.weekStartsOn, weeklyBookingLimit: input.policy.weeklyBookingLimit, activeBookingIds: nextBookingIds, bookedCount: nextBookingIds.length, subscriptionIds: firestore_1.FieldValue.arrayUnion(input.subscriptionId) }, (snap.exists ? {} : { createdAt: firestore_1.FieldValue.serverTimestamp() })), { updatedAt: firestore_1.FieldValue.serverTimestamp() }), { merge: true });
    return {
        conditioningQuotaUsageId: usageId,
        conditioningQuotaWeekKey: week.weekKey,
        conditioningQuotaPolicyVersion: input.policy.version,
        conditioningQuotaWeeklyLimit: input.policy.weeklyBookingLimit,
    };
}
async function prepareConditioningQuotaRelease(tx, firestore, bookingId, booking) {
    const fields = [
        booking.conditioningQuotaUsageId,
        booking.conditioningQuotaWeekKey,
        booking.conditioningQuotaPolicyVersion,
        booking.conditioningQuotaWeeklyLimit,
    ];
    if (fields.every((value) => value === undefined || value === null)) {
        return null;
    }
    if (typeof booking.userId !== "string" || !booking.userId ||
        typeof booking.conditioningQuotaUsageId !== "string" ||
        typeof booking.conditioningQuotaWeekKey !== "string" ||
        booking.conditioningQuotaPolicyVersion !==
            membershipPlans_1.CONDITIONING_BOOKING_POLICY.version ||
        booking.conditioningQuotaWeeklyLimit !==
            membershipPlans_1.CONDITIONING_BOOKING_POLICY.weeklyBookingLimit ||
        booking.conditioningQuotaUsageId !== usageIdFor(booking.userId, booking.conditioningQuotaWeekKey)) {
        throw quotaError("This booking's weekly quota binding is invalid.");
    }
    const ref = firestore.collection(exports.CONDITIONING_WEEKLY_USAGE_COLLECTION)
        .doc(booking.conditioningQuotaUsageId);
    const snap = await tx.get(ref);
    if (!snap.exists) {
        throw quotaError("This booking's weekly quota counter is missing.");
    }
    const activeBookingIds = validateStoredUsage(snap.data(), booking.userId, booking.conditioningQuotaWeekKey, membershipPlans_1.CONDITIONING_BOOKING_POLICY);
    if (!activeBookingIds.includes(bookingId)) {
        throw quotaError("This booking is missing from its weekly quota counter.");
    }
    return {
        ref,
        activeBookingIds: activeBookingIds.filter((id) => id !== bookingId),
    };
}
function applyConditioningQuotaRelease(tx, plan) {
    if (!plan)
        return;
    tx.set(plan.ref, {
        activeBookingIds: plan.activeBookingIds,
        bookedCount: plan.activeBookingIds.length,
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    }, { merge: true });
}
//# sourceMappingURL=conditioningQuota.js.map