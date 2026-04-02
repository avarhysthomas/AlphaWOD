import { collection, getDocs } from "firebase/firestore";
import { db } from "../../../firebase";
import type { AdminUser } from "../types";

function getMonthKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function daysSince(dateStr?: string) {
  if (!dateStr) return Infinity;
  const then = new Date(`${dateStr}T00:00:00`);
  const now = new Date();
  const diff = now.getTime() - then.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export async function getAdminUsers(): Promise<AdminUser[]> {
  const snap = await getDocs(collection(db, "users"));

  return snap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<AdminUser, "id">),
  }));
}

export async function getInsightsSummary() {
  const users = await getAdminUsers();
  const monthKey = getMonthKey();

  const members = users.filter((u) => u.role !== "admin");

  const totalMembers = members.length;

  const activeMembers = members.filter((u) => {
    return daysSince(u.stats?.lastCheckInDate) <= 30;
  }).length;

  const monthCheckIns = members.reduce((sum, u) => {
    return sum + (u.stats?.monthCheckIns?.[monthKey] ?? 0);
  }, 0);

  const totalCheckIns = members.reduce((sum, u) => {
    return sum + (u.stats?.totalCheckIns ?? 0);
  }, 0);

  const topStreakUser =
    [...members].sort(
      (a, b) => (b.stats?.currentStreak ?? 0) - (a.stats?.currentStreak ?? 0)
    )[0] ?? null;

  const topAttenders = [...members]
    .sort(
      (a, b) =>
        (b.stats?.monthCheckIns?.[monthKey] ?? 0) -
        (a.stats?.monthCheckIns?.[monthKey] ?? 0)
    )
    .slice(0, 8);

  const inactiveMembers = members
    .filter((u) => daysSince(u.stats?.lastCheckInDate) > 14)
    .sort(
      (a, b) =>
        daysSince(b.stats?.lastCheckInDate) - daysSince(a.stats?.lastCheckInDate)
    )
    .slice(0, 8);

  return {
    totalMembers,
    activeMembers,
    monthCheckIns,
    totalCheckIns,
    topStreakUser,
    topAttenders,
    inactiveMembers,
    monthKey,
    users: members,
  };
}