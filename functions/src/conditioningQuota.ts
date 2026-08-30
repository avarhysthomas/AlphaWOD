/* eslint-disable require-jsdoc, max-len */

import {createHash} from "crypto";
import {HttpsError} from "firebase-functions/v2/https";
import {
  DocumentReference,
  FieldValue,
  Firestore,
  Transaction,
} from "firebase-admin/firestore";
import {DateTime} from "luxon";
import {
  CONDITIONING_BOOKING_POLICY,
  ConditioningBookingPolicy,
} from "./membershipPlans";
import {ConditioningSlotKey} from "./authz";

export const CONDITIONING_WEEKLY_USAGE_COLLECTION =
  "conditioningWeeklyBookingUsage";

export type ConditioningQuotaBinding = {
  conditioningQuotaUsageId: string;
  conditioningQuotaWeekKey: string;
  conditioningQuotaPolicyVersion: number;
  conditioningQuotaWeeklyLimit: number;
};

type ConditioningQuotaBooking = Partial<ConditioningQuotaBinding> & {
  userId?: unknown;
};

type ConditioningQuotaReleasePlan = {
  ref: DocumentReference;
  activeBookingIds: string[];
};

function quotaError(
  message: string,
  reason = "conditioning_weekly_quota_invalid"
): HttpsError {
  return new HttpsError("failed-precondition", message, {reason});
}

function dateFromTimestampLike(value: unknown): Date | null {
  if (!value || typeof value !== "object" ||
    !("toDate" in value) || typeof value.toDate !== "function") return null;
  const date = value.toDate();
  return date instanceof Date && Number.isFinite(date.getTime()) ? date : null;
}

export function conditioningWeekForClassStart(
  classStart: unknown
): {weekKey: string; weekEndsOn: string} | null {
  const date = dateFromTimestampLike(classStart);
  if (!date) return null;
  const london = DateTime.fromJSDate(date, {
    zone: CONDITIONING_BOOKING_POLICY.timezone,
  });
  if (!london.isValid) return null;
  const monday = london.startOf("week").startOf("day");
  return {
    weekKey: monday.toFormat("yyyy-LL-dd"),
    weekEndsOn: monday.plus({days: 6}).toFormat("yyyy-LL-dd"),
  };
}

function usageIdFor(userId: string, weekKey: string): string {
  return createHash("sha256")
    .update(`conditioning-week:${userId}:${weekKey}`)
    .digest("hex");
}

function assertCurrentPolicy(policy: ConditioningBookingPolicy): void {
  if (policy.version !== CONDITIONING_BOOKING_POLICY.version ||
    policy.timezone !== CONDITIONING_BOOKING_POLICY.timezone ||
    policy.weekStartsOn !== CONDITIONING_BOOKING_POLICY.weekStartsOn ||
    policy.weeklyBookingLimit !==
      CONDITIONING_BOOKING_POLICY.weeklyBookingLimit ||
    policy.eligibleSlotKeys.length !==
      CONDITIONING_BOOKING_POLICY.eligibleSlotKeys.length ||
    !CONDITIONING_BOOKING_POLICY.eligibleSlotKeys.every(
      (slot, index) => policy.eligibleSlotKeys[index] === slot
    )) {
    throw quotaError("The membership's weekly booking policy is invalid.");
  }
}

function validateStoredUsage(
  data: Record<string, unknown>,
  userId: string,
  weekKey: string,
  policy: ConditioningBookingPolicy
): string[] {
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
  return activeBookingIds as string[];
}

export async function reserveConditioningWeeklyQuota(
  tx: Transaction,
  firestore: Firestore,
  input: {
    userId: string;
    subscriptionId: string;
    bookingId: string;
    classStart: unknown;
    classSlot: ConditioningSlotKey;
    policy: ConditioningBookingPolicy;
  }
): Promise<ConditioningQuotaBinding> {
  assertCurrentPolicy(input.policy);
  if (!input.policy.eligibleSlotKeys.includes(input.classSlot)) {
    throw quotaError(
      "This class is not included in Adult Conditioning membership.",
      "class_not_conditioning_membership_slot"
    );
  }
  const week = conditioningWeekForClassStart(input.classStart);
  if (!week) throw quotaError("The class week could not be resolved safely.");
  const usageId = usageIdFor(input.userId, week.weekKey);
  const ref = firestore.collection(CONDITIONING_WEEKLY_USAGE_COLLECTION)
    .doc(usageId);
  const snap = await tx.get(ref);
  const activeBookingIds = snap.exists ? validateStoredUsage(
    snap.data() as Record<string, unknown>,
    input.userId,
    week.weekKey,
    input.policy
  ) : [];

  if (!activeBookingIds.includes(input.bookingId) &&
    activeBookingIds.length >= input.policy.weeklyBookingLimit) {
    throw new HttpsError(
      "failed-precondition",
      "This membership has already booked two Conditioning classes in this Monday-to-Sunday week.",
      {
        reason: "conditioning_weekly_booking_limit_reached",
        weeklyBookingLimit: input.policy.weeklyBookingLimit,
        weekStartsOn: week.weekKey,
        weekEndsOn: week.weekEndsOn,
        timezone: input.policy.timezone,
      }
    );
  }

  const nextBookingIds = activeBookingIds.includes(input.bookingId) ?
    activeBookingIds : [...activeBookingIds, input.bookingId].sort();
  tx.set(ref, {
    schemaVersion: 1,
    userId: input.userId,
    weekKey: week.weekKey,
    timezone: input.policy.timezone,
    weekStartsOn: input.policy.weekStartsOn,
    weeklyBookingLimit: input.policy.weeklyBookingLimit,
    activeBookingIds: nextBookingIds,
    bookedCount: nextBookingIds.length,
    subscriptionIds: FieldValue.arrayUnion(input.subscriptionId),
    ...(snap.exists ? {} : {createdAt: FieldValue.serverTimestamp()}),
    updatedAt: FieldValue.serverTimestamp(),
  }, {merge: true});

  return {
    conditioningQuotaUsageId: usageId,
    conditioningQuotaWeekKey: week.weekKey,
    conditioningQuotaPolicyVersion: input.policy.version,
    conditioningQuotaWeeklyLimit: input.policy.weeklyBookingLimit,
  };
}

export async function prepareConditioningQuotaRelease(
  tx: Transaction,
  firestore: Firestore,
  bookingId: string,
  booking: ConditioningQuotaBooking
): Promise<ConditioningQuotaReleasePlan | null> {
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
      CONDITIONING_BOOKING_POLICY.version ||
    booking.conditioningQuotaWeeklyLimit !==
      CONDITIONING_BOOKING_POLICY.weeklyBookingLimit ||
    booking.conditioningQuotaUsageId !== usageIdFor(
      booking.userId,
      booking.conditioningQuotaWeekKey
    )) {
    throw quotaError("This booking's weekly quota binding is invalid.");
  }

  const ref = firestore.collection(CONDITIONING_WEEKLY_USAGE_COLLECTION)
    .doc(booking.conditioningQuotaUsageId);
  const snap = await tx.get(ref);
  if (!snap.exists) {
    throw quotaError("This booking's weekly quota counter is missing.");
  }
  const activeBookingIds = validateStoredUsage(
    snap.data() as Record<string, unknown>,
    booking.userId,
    booking.conditioningQuotaWeekKey,
    CONDITIONING_BOOKING_POLICY
  );
  if (!activeBookingIds.includes(bookingId)) {
    throw quotaError("This booking is missing from its weekly quota counter.");
  }
  return {
    ref,
    activeBookingIds: activeBookingIds.filter((id) => id !== bookingId),
  };
}

export function applyConditioningQuotaRelease(
  tx: Transaction,
  plan: ConditioningQuotaReleasePlan | null
): void {
  if (!plan) return;
  tx.set(plan.ref, {
    activeBookingIds: plan.activeBookingIds,
    bookedCount: plan.activeBookingIds.length,
    updatedAt: FieldValue.serverTimestamp(),
  }, {merge: true});
}
