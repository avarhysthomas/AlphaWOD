export type AppUser = {
  uid: string;
  email?: string | null;
  name?: string;
  role?: "admin" | "user";
  approvalStatus?: "approved" | "pending";
};

type RawUserDoc = {
  name?: unknown;
  role?: unknown;
  approvalStatus?: unknown;
};

export function buildAppUser(
  firebaseUser: { uid: string; email?: string | null },
  rawData?: RawUserDoc | null
): AppUser {
  return {
    uid: firebaseUser.uid,
    email: firebaseUser.email ?? null,
    name: typeof rawData?.name === "string" ? rawData.name : undefined,
    role: rawData?.role === "admin" ? "admin" : "user",
    approvalStatus: rawData?.approvalStatus === "pending" ? "pending" : "approved",
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
  };
}
