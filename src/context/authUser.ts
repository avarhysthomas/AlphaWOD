import type { AppRole } from "../lib/roles";

export type AppUser = {
  uid: string;
  email?: string | null;
  name?: string;
  role?: AppRole;
  approvalStatus?: "approved" | "pending";
  strengthBlock?: "A" | "B" | "none";
  photoURL?: string;
  waiverAcceptedAt?: unknown;
  waiverAcceptedName?: string;
  waiverAcceptedVersion?: string;
};

type RawUserDoc = {
  name?: unknown;
  role?: unknown;
  approvalStatus?: unknown;
  strengthBlock?: unknown;
  photoURL?: unknown;
  waiverAcceptedAt?: unknown;
  waiverAcceptedName?: unknown;
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
      : "user";

  return {
    uid: firebaseUser.uid,
    email: firebaseUser.email ?? null,
    name: typeof rawData?.name === "string" ? rawData.name : undefined,
    role,
    approvalStatus: rawData?.approvalStatus === "pending" ? "pending" : "approved",
    strengthBlock:
      rawData?.strengthBlock === "A" || rawData?.strengthBlock === "B"
        ? rawData.strengthBlock
        : "none",
    photoURL: typeof rawData?.photoURL === "string" ? rawData.photoURL : undefined,
    waiverAcceptedAt: rawData?.waiverAcceptedAt,
    waiverAcceptedName:
      typeof rawData?.waiverAcceptedName === "string"
        ? rawData.waiverAcceptedName
        : undefined,
    waiverAcceptedVersion:
      typeof rawData?.waiverAcceptedVersion === "string"
        ? rawData.waiverAcceptedVersion
        : undefined,
  };
}

export function buildSafePendingAppUser(
  firebaseUser: { uid: string; email?: string | null }
): AppUser {
  return {
    uid: firebaseUser.uid,
    email: firebaseUser.email ?? null,
    role: "user",
    approvalStatus: "pending",
    strengthBlock: "none",
  };
}
