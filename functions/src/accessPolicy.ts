/* eslint-disable require-jsdoc, max-len */

/**
 * Leaf access-policy primitives shared by the membership catalogue and
 * authorisation resolver. Keeping this module dependency-free prevents the
 * catalogue/current-waiver relationship from forming a runtime import cycle.
 */

export const APP_ACCESS_TIERS = ["none", "limited", "full"] as const;
export type AppAccessTier = typeof APP_ACCESS_TIERS[number];

export const CONDITIONING_SLOT_KEYS = [
  "monday_0600",
  "tuesday_1800",
  "thursday_1800",
  "friday_0530",
] as const;
export type ConditioningSlotKey = typeof CONDITIONING_SLOT_KEYS[number];

export function isAppAccessTier(value: unknown): value is AppAccessTier {
  return typeof value === "string" &&
    (APP_ACCESS_TIERS as readonly string[]).includes(value);
}

export function isConditioningSlotKey(value: unknown): value is ConditioningSlotKey {
  return typeof value === "string" &&
    (CONDITIONING_SLOT_KEYS as readonly string[]).includes(value);
}

/**
 * Returns the two fixed historical schema-v6 Half-membership slots in
 * canonical catalogue order. Current schema-v7 memberships use
 * canonicalConditioningEligibleSlots instead.
 * Any duplicate, unknown, missing, or additional value fails closed.
 * @param {unknown} value Candidate stored or submitted slot list.
 * @return {ConditioningSlotKey[] | null} Canonical slots, or null when invalid.
 */
export function canonicalConditioningSlots(value: unknown): ConditioningSlotKey[] | null {
  if (!Array.isArray(value) || value.length !== 2 ||
      !value.every(isConditioningSlotKey)) return null;
  const unique = new Set<ConditioningSlotKey>(value);
  if (unique.size !== 2) return null;
  return CONDITIONING_SLOT_KEYS.filter((slot) => unique.has(slot));
}

/**
 * Returns the complete canonical flexible Conditioning scope, or null.
 * @param {unknown} value Candidate stored eligible-slot scope.
 * @return {ConditioningSlotKey[] | null} Canonical complete scope or null.
 */
export function canonicalConditioningEligibleSlots(
  value: unknown
): ConditioningSlotKey[] | null {
  if (!Array.isArray(value) || value.length !== CONDITIONING_SLOT_KEYS.length ||
    !value.every(isConditioningSlotKey)) return null;
  const unique = new Set<ConditioningSlotKey>(value);
  if (unique.size !== CONDITIONING_SLOT_KEYS.length) return null;
  return CONDITIONING_SLOT_KEYS.filter((slot) => unique.has(slot));
}
