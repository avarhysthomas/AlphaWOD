import {
  collection,
  collectionGroup,
  getDocs,
  limit,
  orderBy,
  query,
} from "firebase/firestore";
import { db } from "../../../firebase";

type AdminUserLite = {
  id: string;
  name?: string;
  email?: string;
  photoURL?: string;
  role?: string;
};

export type TrainingLog = {
  id: string;
  userId?: string;
  category?: string;
  movementSlug?: string;
  movementName?: string;
  metricType?: string;
  value?: string;
  unit?: string;
  reps?: string;
  date?: string;
  notes?: string;
  createdAt?: any;
};

function formatMetricLabel(log: TrainingLog) {
  const movement = log.movementName || "Unknown movement";
  const metric = log.metricType || "";
  return metric ? `${movement} · ${metric}` : movement;
}

function getCreatedAtMs(raw: any) {
  if (!raw) return 0;
  if (typeof raw?.toDate === "function") return raw.toDate().getTime();

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

export async function getPerformanceSummary() {
  const [usersSnap, logsSnap] = await Promise.all([
    getDocs(collection(db, "users")),
    getDocs(
      query(
        collectionGroup(db, "trainingLogs"),
        orderBy("createdAt", "desc"),
        limit(250)
      )
    ),
  ]);

  const users: AdminUserLite[] = usersSnap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<AdminUserLite, "id">),
  }));

  const userMap = new Map(users.map((u) => [u.id, u]));

  const logs: TrainingLog[] = logsSnap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<TrainingLog, "id">),
  }));

  const memberLogs = logs
    .filter((log) => {
      const user = log.userId ? userMap.get(log.userId) : null;
      return user?.role !== "admin";
    })
    .sort((a, b) => getCreatedAtMs(b.createdAt) - getCreatedAtMs(a.createdAt));

  const totalLogs = memberLogs.length;

  const athletesLogging = new Set(
    memberLogs.map((log) => log.userId).filter(Boolean)
  ).size;

  const movementCounts = memberLogs.reduce<Record<string, number>>((acc, log) => {
    const key = formatMetricLabel(log);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const categoryCounts = memberLogs.reduce<Record<string, number>>((acc, log) => {
    const key = log.category || "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const userCounts = memberLogs.reduce<Record<string, number>>((acc, log) => {
    if (!log.userId) return acc;
    acc[log.userId] = (acc[log.userId] ?? 0) + 1;
    return acc;
  }, {});

  const mostLoggedMetric =
    Object.entries(movementCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";

  const topMetrics = Object.entries(movementCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, count]) => ({ label, count }));

  const topCategories = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({ category, count }));

  const topLoggers = Object.entries(userCounts)
    .map(([userId, count]) => {
      const user = userMap.get(userId);
      return {
        userId,
        count,
        name: user?.name || "Unknown athlete",
        email: user?.email || "",
        photoURL: user?.photoURL || "",
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const recentLogs = memberLogs.slice(0, 20).map((log) => {
    const user = log.userId ? userMap.get(log.userId) : null;

    return {
      ...log,
      userName: user?.name || "Unknown athlete",
      userEmail: user?.email || "",
      photoURL: user?.photoURL || "",
      metricLabel: formatMetricLabel(log),
    };
  });

  return {
    totalLogs,
    athletesLogging,
    mostLoggedMetric,
    topMetrics,
    topCategories,
    topLoggers,
    recentLogs,
  };
}