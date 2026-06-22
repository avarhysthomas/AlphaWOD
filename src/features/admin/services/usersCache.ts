import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "../../../firebase";

export type CachedAdminUser = {
  id: string;
  name?: string;
  email?: string;
  photoURL?: string;
  role?: string;
  approvalStatus?: "approved" | "pending";
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

export async function getCachedAdminUsers() {
  const now = Date.now();

  if (usersCache && usersCache.expiresAt > now) {
    return usersCache.users;
  }

  const snap = await getDocs(collection(db, "users"));
  const users: CachedAdminUser[] = snap.docs.map((item) => ({
    id: item.id,
    ...(item.data() as Omit<CachedAdminUser, "id">),
  }));

  usersCache = {
    expiresAt: now + USERS_CACHE_TTL_MS,
    users,
  };

  return users;
}

export async function getCachedAdminUser(userId: string) {
  const cached = usersCache?.users.find((user) => user.id === userId);
  if (cached) return cached;

  const snap = await getDoc(doc(db, "users", userId));
  if (!snap.exists()) return null;

  return {
    id: snap.id,
    ...(snap.data() as Omit<CachedAdminUser, "id">),
  };
}
