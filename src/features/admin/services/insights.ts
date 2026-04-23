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

  const approvedMembers = users.filter(
    (u) => u.role !== "admin" && u.role !== "banned" && u.approvalStatus !== "pending"
  );
  const pendingApprovals = users
    .filter((u) => u.role !== "admin" && u.role !== "banned" && u.approvalStatus === "pending")
    .sort((a, b) => (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? ""));
  const bannedMembers = users
    .filter((u) => u.role === "banned")
    .sort((a, b) => (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? ""));

  const totalMembers = approvedMembers.length;

  const activeMembers = approvedMembers.filter((u) => {
    return daysSince(u.stats?.lastCheckInDate) <= 30;
  }).length;

  const monthCheckIns = approvedMembers.reduce((sum, u) => {
    return sum + (u.stats?.monthCheckIns?.[monthKey] ?? 0);
  }, 0);

  const totalCheckIns = approvedMembers.reduce((sum, u) => {
    return sum + (u.stats?.totalCheckIns ?? 0);
  }, 0);

  const topStreakUser =
    [...approvedMembers].sort(
      (a, b) => (b.stats?.currentStreak ?? 0) - (a.stats?.currentStreak ?? 0)
    )[0] ?? null;

  const topAttenders = [...approvedMembers]
    .sort(
      (a, b) =>
        (b.stats?.monthCheckIns?.[monthKey] ?? 0) -
        (a.stats?.monthCheckIns?.[monthKey] ?? 0)
    )
    .slice(0, 8);

  const inactiveMembers = approvedMembers
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
    bannedMembers,
    pendingApprovals,
    monthKey,
    users: approvedMembers,
  };
}
