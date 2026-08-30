/* eslint-disable require-jsdoc, max-len */

export const ACCESS_SCHEMA_VERSION = 2;
export const CLAIMS_VERSION = 3;

export const USER_ROLES = ["admin", "user", "sgpt", "banned"] as const;
export type UserRole = typeof USER_ROLES[number];

export const APPROVAL_STATUSES = ["approved", "pending"] as const;
export type ApprovalStatus = typeof APPROVAL_STATUSES[number];

export const ENTITLEMENT_STATUSES = ["none", "active", "restricted"] as const;
export type EntitlementStatus = typeof ENTITLEMENT_STATUSES[number];

export const ENTITLEMENT_SOURCES = ["none", "legacy", "manual", "stripe", "staff"] as const;
export type EntitlementSource = typeof ENTITLEMENT_SOURCES[number];

export const APP_ACCESS_TIERS = ["none", "limited", "full"] as const;
export type AppAccessTier = typeof APP_ACCESS_TIERS[number];

export const CONDITIONING_SLOT_KEYS = [
  "monday_0600",
  "tuesday_1800",
  "thursday_1800",
  "friday_0530",
] as const;
export type ConditioningSlotKey = typeof CONDITIONING_SLOT_KEYS[number];

export const CURRENT_WAIVER_VERSION = "2026-30-05";
export const CURRENT_WAIVER_TITLE =
  "Zero Alpha Fitness — Participation Agreement, Assumption of Risk & Liability Waiver";

export const CURRENT_WAIVER_ACKNOWLEDGEMENTS = [
  "I have read and understood this Agreement and accept the risks in Clause 3.",
  "I will follow all instructions and rules and take responsibility for my own pacing under Clause 4.",
  "I will disclose relevant medical conditions and stop if unwell under Clause 2.",
  "I understand the release/indemnity and the UK carve-out for negligence in Clause 5.",
  "I understand the data processing summary and where to find the Privacy Notice under Clause 8.",
  "If applicable, I agree to the Membership Terms under Clause 10.",
] as const;

function isFirestoreTimestampLike(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const timestamp = value as {seconds?: unknown; nanoseconds?: unknown};
  return Number.isSafeInteger(timestamp.seconds) &&
    Number.isInteger(timestamp.nanoseconds) &&
    Number(timestamp.nanoseconds) >= 0 &&
    Number(timestamp.nanoseconds) < 1_000_000_000;
}

/**
 * Checks the exact evidence shape trusted to back the current waiver marker.
 * @param {string} userId Expected authenticated user ID.
 * @param {unknown} value Candidate waiver evidence.
 * @return {boolean} Whether the evidence is canonical and complete.
 */
export function isCanonicalCurrentWaiverAcceptance(
  userId: string,
  value: unknown
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const acceptance = value as Record<string, unknown>;
  const acceptedName = typeof acceptance.acceptedName === "string" ?
    acceptance.acceptedName.trim() : "";
  const acceptedEmail = acceptance.acceptedEmail;
  const emailValid = acceptedEmail === null || (
    typeof acceptedEmail === "string" &&
    acceptedEmail.length > 0 &&
    acceptedEmail.length <= 320 &&
    acceptedEmail === acceptedEmail.trim().toLowerCase()
  );
  const authenticatedAt = acceptance.authenticatedAt;
  const authenticatedAtValid = authenticatedAt === null || (
    typeof authenticatedAt === "number" &&
    Number.isFinite(authenticatedAt) && authenticatedAt >= 0
  );
  const signInProvider = acceptance.signInProvider;
  const signInProviderValid = signInProvider === null || (
    typeof signInProvider === "string" && signInProvider.length <= 100
  );
  const acknowledgements = acceptance.acknowledgements;

  return acceptance.acceptanceSchemaVersion === 1 &&
    acceptance.userId === userId &&
    acceptance.version === CURRENT_WAIVER_VERSION &&
    acceptance.agreementTitle === CURRENT_WAIVER_TITLE &&
    acceptance.source === "authenticated_callable" &&
    isFirestoreTimestampLike(acceptance.acceptedAt) &&
    acceptedName.length >= 2 && acceptedName.length <= 160 &&
    emailValid &&
    typeof acceptance.acceptedEmailVerified === "boolean" &&
    Array.isArray(acknowledgements) &&
    acknowledgements.length === CURRENT_WAIVER_ACKNOWLEDGEMENTS.length &&
    CURRENT_WAIVER_ACKNOWLEDGEMENTS.every(
      (text, index) => acknowledgements[index] === text
    ) &&
    typeof acceptance.mediaConsent === "boolean" &&
    authenticatedAtValid &&
    signInProviderValid &&
    typeof acceptance.userAgent === "string" &&
    acceptance.userAgent.length <= 500;
}

export type UserAuthorisationInput = {
  role?: unknown;
  approvalStatus?: unknown;
  entitlementStatus?: unknown;
  entitlementSource?: unknown;
  entitlementPlanKey?: unknown;
  appAccessTier?: unknown;
  entitlementClassSlots?: unknown;
};

export type ResolvedUserAuthorisation = {
  role: UserRole;
  approvalStatus: ApprovalStatus;
  entitlementStatus: EntitlementStatus;
  entitlementSource: EntitlementSource;
  /** Frozen policy stored on the profile, even while effective access is gated. */
  entitlementPolicyAppAccessTier: AppAccessTier;
  /** Frozen Conditioning slots stored on the profile, even while access is gated. */
  entitlementPolicyClassSlots: ConditioningSlotKey[];
  /** Effective tier exposed to claims and runtime authorisation. */
  appAccessTier: AppAccessTier;
  /** Effective Conditioning slots exposed to claims and runtime authorisation. */
  entitlementClassSlots: ConditioningSlotKey[];
  alphaWodAccess: boolean;
  disabled: boolean;
  restricted: boolean;
  valid: boolean;
  issues: string[];
};

export type ManagedClaims = {
  role: UserRole;
  approvalStatus: ApprovalStatus;
  entitlementStatus: EntitlementStatus;
  entitlementSource: EntitlementSource;
  appAccessTier: AppAccessTier;
  entitlementClassSlots: ConditioningSlotKey[];
  alphaWodAccess: boolean;
  disabled: boolean;
  restricted: boolean;
  accessSchemaVersion: number;
  claimsVersion: number;
};

export const MANAGED_CLAIM_KEYS = [
  "role",
  "approvalStatus",
  "entitlementStatus",
  "entitlementSource",
  "appAccessTier",
  "entitlementClassSlots",
  "alphaWodAccess",
  "disabled",
  "restricted",
  "accessSchemaVersion",
  "claimsVersion",
] as const;

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && (USER_ROLES as readonly string[]).includes(value);
}

export function isApprovalStatus(value: unknown): value is ApprovalStatus {
  return typeof value === "string" &&
    (APPROVAL_STATUSES as readonly string[]).includes(value);
}

export function isEntitlementStatus(value: unknown): value is EntitlementStatus {
  return typeof value === "string" &&
    (ENTITLEMENT_STATUSES as readonly string[]).includes(value);
}

export function isEntitlementSource(value: unknown): value is EntitlementSource {
  return typeof value === "string" &&
    (ENTITLEMENT_SOURCES as readonly string[]).includes(value);
}

export function isAppAccessTier(value: unknown): value is AppAccessTier {
  return typeof value === "string" &&
    (APP_ACCESS_TIERS as readonly string[]).includes(value);
}

export function isConditioningSlotKey(value: unknown): value is ConditioningSlotKey {
  return typeof value === "string" &&
    (CONDITIONING_SLOT_KEYS as readonly string[]).includes(value);
}

/**
 * Returns the two fixed Half-membership slots in canonical catalogue order.
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

export function isValidEntitlementPair(
  status: EntitlementStatus,
  source: EntitlementSource
): boolean {
  if (status === "none") return source === "none";
  return source !== "none";
}

export function isEntitlementCompatibleWithRole(
  role: UserRole,
  status: EntitlementStatus,
  source: EntitlementSource
): boolean {
  if (!isValidEntitlementPair(status, source)) return false;
  if (status !== "active") return true;
  if (role === "admin" || role === "sgpt") return source === "staff";
  if (role === "banned") return false;
  return source === "legacy" || source === "manual" || source === "stripe";
}

export function resolveUserAuthorisation(
  input: UserAuthorisationInput | undefined,
  options: {profileExists?: boolean} = {}
): ResolvedUserAuthorisation {
  const profileExists = options.profileExists !== false;
  const issues: string[] = [];
  const roleValid = isUserRole(input?.role);
  const approvalValid = isApprovalStatus(input?.approvalStatus);
  const entitlementStatusValid = isEntitlementStatus(input?.entitlementStatus);
  const entitlementSourceValid = isEntitlementSource(input?.entitlementSource);
  const appAccessTierPresent = input?.appAccessTier !== undefined &&
    input?.appAccessTier !== null;
  const appAccessTierValid = !appAccessTierPresent ||
    isAppAccessTier(input?.appAccessTier);

  if (!profileExists) issues.push("profile_missing");
  if (!roleValid) issues.push("role_invalid");
  if (!approvalValid) issues.push("approval_status_invalid");
  if (!entitlementStatusValid) issues.push("entitlement_status_invalid");
  if (!entitlementSourceValid) issues.push("entitlement_source_invalid");
  if (!appAccessTierValid) issues.push("app_access_tier_invalid");

  const rawStatus: EntitlementStatus = entitlementStatusValid ?
    input?.entitlementStatus as EntitlementStatus : "none";
  const rawSource: EntitlementSource = entitlementSourceValid ?
    input?.entitlementSource as EntitlementSource : "none";
  const pairValid = isValidEntitlementPair(rawStatus, rawSource);
  if (!pairValid) issues.push("entitlement_pair_invalid");

  const structurallyValid = profileExists && roleValid && approvalValid &&
    entitlementStatusValid && entitlementSourceValid && pairValid &&
    appAccessTierValid;
  const role: UserRole = structurallyValid ? input?.role as UserRole : "user";
  const approvalStatus: ApprovalStatus = structurallyValid ?
    input?.approvalStatus as ApprovalStatus : "pending";
  const entitlementStatus: EntitlementStatus = structurallyValid ? rawStatus : "none";
  const entitlementSource: EntitlementSource = structurallyValid ? rawSource : "none";
  const explicitlyBanned = roleValid && input?.role === "banned";
  const baseStaffAccess = (role === "admin" || role === "sgpt") &&
    entitlementStatus === "active" && entitlementSource === "staff";
  const baseMemberAccess = role === "user" &&
    entitlementStatus === "active" &&
    (entitlementSource === "legacy" || entitlementSource === "manual" ||
      entitlementSource === "stripe");

  let accessPolicyValid = true;
  let entitlementPolicyAppAccessTier: AppAccessTier = "none";
  let entitlementPolicyClassSlots: ConditioningSlotKey[] = [];
  if (baseStaffAccess) {
    entitlementPolicyAppAccessTier = "full";
  } else if (role === "user" && entitlementSource === "stripe") {
    // Stripe policy remains meaningful while approval or the membership state
    // gates effective access. Never erase a paid Conditioning member's frozen
    // slots merely because their account is pending, suspended, or disputed.
    const hasNoPolicySlots = input?.entitlementClassSlots === undefined ||
      input?.entitlementClassSlots === null ||
      (Array.isArray(input.entitlementClassSlots) &&
        input.entitlementClassSlots.length === 0);
    if (entitlementStatus === "restricted" &&
        input?.appAccessTier === "none" && hasNoPolicySlots) {
      // An invalid provider/commercial contract is projected as an explicit
      // fail-closed Stripe restriction. It carries no usable policy.
      entitlementPolicyAppAccessTier = "none";
    } else if (input?.entitlementPlanKey === "adult_unlimited" &&
        (!appAccessTierPresent || input?.appAccessTier === "full")) {
      entitlementPolicyAppAccessTier = "full";
    } else if (input?.entitlementPlanKey === "adult_conditioning" &&
        (!appAccessTierPresent || input?.appAccessTier === "limited")) {
      const slots = canonicalConditioningSlots(input?.entitlementClassSlots);
      if (slots) {
        entitlementPolicyAppAccessTier = "limited";
        entitlementPolicyClassSlots = slots;
      } else {
        accessPolicyValid = false;
      }
    } else {
      // A Stripe entitlement without a recognised plan/tier is never upgraded
      // by a truthy legacy boolean.
      accessPolicyValid = false;
    }
  } else if (baseMemberAccess) {
    const requestedTier = appAccessTierPresent ?
      input?.appAccessTier as AppAccessTier : "full";
    if (requestedTier === "limited") {
      const slots = canonicalConditioningSlots(input?.entitlementClassSlots);
      if (slots) {
        entitlementPolicyAppAccessTier = "limited";
        entitlementPolicyClassSlots = slots;
      } else {
        accessPolicyValid = false;
      }
    } else {
      entitlementPolicyAppAccessTier = requestedTier;
    }
  }
  if (!accessPolicyValid) issues.push("app_access_policy_invalid");

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
    appAccessTier: alphaWodAccess ? entitlementPolicyAppAccessTier : "none",
    entitlementClassSlots: alphaWodAccess &&
      entitlementPolicyAppAccessTier === "limited" ?
      entitlementPolicyClassSlots : [],
    alphaWodAccess,
    disabled,
    restricted: !alphaWodAccess,
    valid,
    issues,
  };
}

export function buildManagedClaims(
  input: UserAuthorisationInput | undefined,
  options: {profileExists?: boolean} = {}
): ManagedClaims {
  const resolved = resolveUserAuthorisation(input, options);
  return {
    role: resolved.role,
    approvalStatus: resolved.approvalStatus,
    entitlementStatus: resolved.entitlementStatus,
    entitlementSource: resolved.entitlementSource,
    appAccessTier: resolved.appAccessTier,
    entitlementClassSlots: resolved.entitlementClassSlots,
    alphaWodAccess: resolved.alphaWodAccess,
    disabled: resolved.disabled,
    restricted: resolved.restricted,
    accessSchemaVersion: ACCESS_SCHEMA_VERSION,
    claimsVersion: CLAIMS_VERSION,
  };
}

export function mergeManagedClaims(
  existingClaims: Record<string, unknown> | undefined,
  managedClaims: ManagedClaims
): Record<string, unknown> {
  const managedKeys = new Set<string>(MANAGED_CLAIM_KEYS);
  const preserved = Object.fromEntries(
    Object.entries(existingClaims || {}).filter(([key]) => !managedKeys.has(key))
  );
  return {...preserved, ...managedClaims};
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)])
    );
  }
  return value;
}

export function claimsEqual(
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown> | undefined
): boolean {
  return JSON.stringify(stableValue(left || {})) ===
    JSON.stringify(stableValue(right || {}));
}
