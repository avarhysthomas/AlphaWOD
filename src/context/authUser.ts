import type { AppRole } from "../lib/roles";

export type AppUser = {
  uid: string;
  email?: string | null;
  name?: string;
  role?: AppRole;
  approvalStatus?: "approved" | "pending";
  strengthBlock?: "A" | "B" | "none";
};

type RawUserDoc = {
  name?: unknown;
  role?: unknown;
  approvalStatus?: unknown;
  strengthBlock?: unknown;
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
