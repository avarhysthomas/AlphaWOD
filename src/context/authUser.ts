import type { AppRole } from "../lib/roles";

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
    strengthBlock: "none",
  };
}

type AlphaWodAccessRecord = {
  approvalStatus?: unknown;
  entitlementStatus?: unknown;
  entitlementSource?: unknown;
  alphaWodAccess?: unknown;
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

  return (
    appUser?.approvalStatus === "approved" &&
    appUser.entitlementStatus === "active" &&
    appUser.alphaWodAccess === true &&
    hasValidEntitlement
  );
}

export function getAlphaWodAccessGateRoute(
  appUser?: AppUser | null
): "/pending-approval" | "/access-restricted" | null {
  if (appUser?.approvalStatus !== "approved") return "/pending-approval";
  if (!hasAlphaWodAccess(appUser)) return "/access-restricted";
  return null;
}
