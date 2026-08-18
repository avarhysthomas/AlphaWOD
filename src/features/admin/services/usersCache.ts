import { getFunctions, httpsCallable } from "firebase/functions";
import app from "../../../firebaseApp";

const functions = getFunctions(app, "europe-west1");

export type CachedAdminUser = {
  id: string;
  name?: string;
  email?: string;
  photoURL?: string;
  role?: string;
  approvalStatus?: "approved" | "pending";
  entitlementStatus?: "none" | "active" | "restricted";
  entitlementSource?: "none" | "legacy" | "manual" | "stripe" | "staff";
  alphaWodAccess?: boolean;
  stats?: {
    currentStreak?: number;
    longestStreak?: number;
    lastCheckInDate?: string;
    totalCheckIns?: number;
    monthCheckIns?: Record<string, number>;
  };
};

const USERS_CACHE_TTL_MS = 5 * 60_000;

let usersCache:
  | {
      expiresAt: number;
      users: CachedAdminUser[];
    }
  | null = null;

type ListStaffUsersResponse = {
  users: CachedAdminUser[];
};

export function invalidateCachedAdminUsers() {
  usersCache = null;
}

export async function getCachedAdminUsers() {
  const now = Date.now();

  if (usersCache && usersCache.expiresAt > now) {
    return usersCache.users;
  }

  const callable = httpsCallable<Record<string, never>, ListStaffUsersResponse>(
    functions,
    "listStaffUsers"
  );
  const response = await callable({});
  const users = response.data?.users;

  if (!Array.isArray(users) || users.some((user) => !user || typeof user.id !== "string")) {
    throw new Error("The staff user directory returned an invalid response.");
  }

  usersCache = {
    expiresAt: now + USERS_CACHE_TTL_MS,
    users,
  };

  return users;
}

export async function getCachedAdminUser(userId: string) {
  const users = await getCachedAdminUsers();
  return users.find((user) => user.id === userId) ?? null;
}
