import type { AppRole } from "../lib/roles";

export const CONDITIONING_SLOT_KEYS = [
  "monday_0600",
  "tuesday_1800",
  "thursday_1800",
  "friday_0530",
] as const;

export type ConditioningSlotKey = typeof CONDITIONING_SLOT_KEYS[number];
export type AppAccessTier = "none" | "limited" | "full";

export type AppUser = {
  uid: string;
  profileExists?: boolean;
  email?: string | null;
  name?: string;
  role?: AppRole;
  approvalStatus?: "approved" | "pending";
  entitlementStatus?: "none" | "active" | "restricted";
  entitlementSource?: "none" | "legacy" | "manual" | "stripe" | "staff";
  alphaWodAccess?: boolean;
  appAccessTier?: AppAccessTier;
  entitlementPlanKey?: string;
  entitlementClassSlots?: ConditioningSlotKey[];
  entitlementWeeklyBookingLimit?: number;
  strengthBlock?: "A" | "B" | "none";
  photoURL?: string;
  waiverAcceptedAt?: unknown;
  waiverAcceptedVersion?: string;
};

type RawUserDoc = {
  name?: unknown;
  role?: unknown;
  approvalStatus?: unknown;
  entitlementStatus?: unknown;
  entitlementSource?: unknown;
  alphaWodAccess?: unknown;
  appAccessTier?: unknown;
  entitlementPlanKey?: unknown;
  entitlementClassSlots?: unknown;
  entitlementWeeklyBookingLimit?: unknown;
  strengthBlock?: unknown;
  photoURL?: unknown;
  waiverAcceptedAt?: unknown;
  waiverAcceptedVersion?: unknown;
};

export function buildAppUser(
  firebaseUser: { uid: string; email?: string | null },
  rawData?: RawUserDoc | null
): AppUser {
  const role =
    rawData?.role === "admin"
      ? "admin"
      : rawData?.role === "sgpt"
      ? "sgpt"
      : rawData?.role === "banned"
      ? "banned"
      : rawData?.role === "user"
      ? "user"
      : undefined;
  const name = typeof rawData?.name === "string" ? rawData.name : undefined;
  const photoURL = typeof rawData?.photoURL === "string" ? rawData.photoURL : undefined;
  const waiverAcceptedVersion =
    typeof rawData?.waiverAcceptedVersion === "string"
      ? rawData.waiverAcceptedVersion
      : undefined;
  const appAccessTier =
    rawData?.appAccessTier === "full" || rawData?.appAccessTier === "limited" ||
    rawData?.appAccessTier === "none"
      ? rawData.appAccessTier
      : rawData && Object.prototype.hasOwnProperty.call(rawData, "appAccessTier")
      ? "none"
      : undefined;
  const entitlementPlanKey =
    typeof rawData?.entitlementPlanKey === "string" && rawData.entitlementPlanKey.trim()
      ? rawData.entitlementPlanKey.trim()
      : undefined;
  const rawEntitlementClassSlots = rawData?.entitlementClassSlots;
  const entitlementClassSlots = Array.isArray(rawEntitlementClassSlots)
    ? Array.from(new Set(rawEntitlementClassSlots)).filter(
        (slot): slot is ConditioningSlotKey =>
          CONDITIONING_SLOT_KEYS.includes(slot as ConditioningSlotKey)
      )
    : undefined;
  const hasWeeklyBookingLimit = rawData !== null && rawData !== undefined &&
    Object.prototype.hasOwnProperty.call(rawData, "entitlementWeeklyBookingLimit") &&
    rawData.entitlementWeeklyBookingLimit !== null &&
    rawData.entitlementWeeklyBookingLimit !== undefined;
  const entitlementWeeklyBookingLimit = Number.isInteger(
    rawData?.entitlementWeeklyBookingLimit
  ) && Number(rawData?.entitlementWeeklyBookingLimit) > 0
    ? Number(rawData?.entitlementWeeklyBookingLimit)
    : hasWeeklyBookingLimit
      ? 0
      : undefined;

  return {
    uid: firebaseUser.uid,
    profileExists: true,
    email: firebaseUser.email ?? null,
    ...(name !== undefined ? { name } : {}),
    ...(role !== undefined ? { role } : {}),
    // Approval is deliberately fail-closed. Missing, legacy, and malformed
    // values must never grant member access.
    approvalStatus: rawData?.approvalStatus === "approved" ? "approved" : "pending",
    entitlementStatus:
      rawData?.entitlementStatus === "active" || rawData?.entitlementStatus === "restricted"
        ? rawData.entitlementStatus
        : "none",
    entitlementSource:
      rawData?.entitlementSource === "legacy" ||
      rawData?.entitlementSource === "manual" ||
      rawData?.entitlementSource === "stripe" ||
      rawData?.entitlementSource === "staff"
        ? rawData.entitlementSource
        : "none",
    alphaWodAccess: rawData?.alphaWodAccess === true,
    ...(appAccessTier !== undefined ? { appAccessTier } : {}),
    ...(entitlementPlanKey !== undefined ? { entitlementPlanKey } : {}),
    ...(entitlementClassSlots !== undefined ? { entitlementClassSlots } : {}),
    ...(entitlementWeeklyBookingLimit !== undefined
      ? { entitlementWeeklyBookingLimit }
      : {}),
    strengthBlock:
      rawData?.strengthBlock === "A" || rawData?.strengthBlock === "B"
        ? rawData.strengthBlock
        : "none",
    ...(photoURL !== undefined ? { photoURL } : {}),
    ...(rawData?.waiverAcceptedAt !== undefined
      ? { waiverAcceptedAt: rawData.waiverAcceptedAt }
      : {}),
    ...(waiverAcceptedVersion !== undefined ? { waiverAcceptedVersion } : {}),
  };
}

export function buildSafePendingAppUser(
  firebaseUser: { uid: string; email?: string | null },
  options: {profileExists?: boolean} = {}
): AppUser {
  return {
    uid: firebaseUser.uid,
    ...(options.profileExists !== undefined
      ? { profileExists: options.profileExists }
      : {}),
    email: firebaseUser.email ?? null,
    role: "user",
    approvalStatus: "pending",
    entitlementStatus: "none",
    entitlementSource: "none",
    alphaWodAccess: false,
    appAccessTier: "none",
    strengthBlock: "none",
  };
}

type AlphaWodAccessRecord = {
  approvalStatus?: unknown;
  entitlementStatus?: unknown;
  entitlementSource?: unknown;
  alphaWodAccess?: unknown;
  appAccessTier?: unknown;
  entitlementClassSlots?: unknown;
  entitlementWeeklyBookingLimit?: unknown;
  entitlementPlanKey?: unknown;
  role?: unknown;
};

export function hasAlphaWodAccess(appUser?: AlphaWodAccessRecord | null) {
  const hasValidEntitlement =
    ((appUser?.role === "admin" || appUser?.role === "sgpt") &&
      appUser?.entitlementSource === "staff") ||
    (appUser?.role === "user" &&
      (appUser?.entitlementSource === "legacy" ||
        appUser?.entitlementSource === "manual" ||
        appUser?.entitlementSource === "stripe"));

  const baseAccess = (
    appUser?.approvalStatus === "approved" &&
    appUser.entitlementStatus === "active" &&
    appUser.alphaWodAccess === true &&
    hasValidEntitlement
  );
  if (!baseAccess) return false;
  if (appUser?.appAccessTier === undefined) return true;
  if (appUser.appAccessTier === "full") return true;
  if (appUser.appAccessTier !== "limited") return false;

  // Current Conditioning memberships carry a server-authoritative weekly
  // booking allowance and all four eligible timetable slots.
  if (appUser.entitlementWeeklyBookingLimit !== undefined) {
    if (appUser.entitlementPlanKey !== "adult_conditioning" ||
        appUser.entitlementWeeklyBookingLimit !== 2 ||
        !Array.isArray(appUser.entitlementClassSlots) ||
        appUser.entitlementClassSlots.length !== CONDITIONING_SLOT_KEYS.length) {
      return false;
    }
    const currentSlots = new Set(appUser.entitlementClassSlots);
    return currentSlots.size === CONDITIONING_SLOT_KEYS.length &&
      CONDITIONING_SLOT_KEYS.every((slot) => currentSlots.has(slot));
  }

  // Historical v6 memberships remain valid under the two slots agreed at
  // their checkout. New memberships never rely on this projection.
  if (!Array.isArray(appUser.entitlementClassSlots) ||
      appUser.entitlementClassSlots.length !== 2) return false;
  const uniqueSlots = new Set(appUser.entitlementClassSlots);
  return uniqueSlots.size === 2 && Array.from(uniqueSlots).every((slot) =>
    CONDITIONING_SLOT_KEYS.includes(slot as ConditioningSlotKey)
  );
}

export function getAlphaWodAccessGateRoute(
  appUser?: AppUser | null
): "/pending-approval" | "/access-restricted" | null {
  if (appUser?.approvalStatus !== "approved") return "/pending-approval";
  if (!hasAlphaWodAccess(appUser)) return "/access-restricted";
  return null;
}

/**
 * Legacy entitled users pre-date the tier projection. Keep those approved
 * accounts on full access while explicit malformed or `none` values fail closed.
 */
export function getEffectiveAppAccessTier(
  appUser?: AppUser | null
): AppAccessTier {
  if (!hasAlphaWodAccess(appUser)) return "none";
  if (appUser?.appAccessTier === "limited" || appUser?.appAccessTier === "full") {
    return appUser.appAccessTier;
  }
  return appUser?.appAccessTier === undefined ? "full" : "none";
}
