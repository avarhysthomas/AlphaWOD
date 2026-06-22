import {
  collectionGroup,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
} from "firebase/firestore";
import { db } from "../../../firebase";
import { getCachedAdminUsers } from "./usersCache";

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

const PERFORMANCE_LOG_SAMPLE_LIMIT = 1500;

export type TopMetricSummary = {
  label: string;
  count: number;
  movementSlug?: string;
  movementName?: string;
  metricType?: string;
  category?: string;
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

const PERFORMANCE_CACHE_TTL_MS = 5 * 60_000;

let performanceCache: {
  expiresAt: number;
  data: Awaited<ReturnType<typeof _fetchPerformanceSummary>>;
} | null = null;

export async function getPerformanceSummary() {
  const now = Date.now();
  if (performanceCache && performanceCache.expiresAt > now) {
    return performanceCache.data;
  }
  const data = await _fetchPerformanceSummary();
  performanceCache = { expiresAt: now + PERFORMANCE_CACHE_TTL_MS, data };
  return data;
}

async function _fetchPerformanceSummary() {
  const [users, logsSnap, countSnap] = await Promise.all([
    getCachedAdminUsers(),
    getDocs(
      query(
        collectionGroup(db, "trainingLogs"),
        orderBy("createdAt", "desc"),
        limit(PERFORMANCE_LOG_SAMPLE_LIMIT)
      )
    ),
    getCountFromServer(collectionGroup(db, "trainingLogs")),
  ]);

  const userMap = new Map(users.map((u) => [u.id, u]));

  const logs: TrainingLog[] = logsSnap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<TrainingLog, "id">),
  }));

  const memberLogs = logs
    .filter((log) => {
      const user = log.userId ? userMap.get(log.userId) : null;
      return user?.role !== "admin" && user?.role !== "banned" && user?.approvalStatus !== "pending";
    })
    .sort((a, b) => getCreatedAtMs(b.createdAt) - getCreatedAtMs(a.createdAt));

  const totalLogs = countSnap.data().count;

  const athletesLogging = new Set(
    memberLogs.map((log) => log.userId).filter(Boolean)
  ).size;

  const movementCounts = memberLogs.reduce<Record<string, TopMetricSummary>>(
    (acc, log) => {
      const key = `${log.movementSlug || log.movementName || "unknown"}::${log.metricType || ""}`;
      const existing = acc[key];

      if (existing) {
        existing.count += 1;
        return acc;
      }

      acc[key] = {
        label: formatMetricLabel(log),
        count: 1,
        movementSlug: log.movementSlug,
        movementName: log.movementName,
        metricType: log.metricType,
        category: log.category,
      };

      return acc;
    },
    {}
  );

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
    Object.values(movementCounts).sort((a, b) => b.count - a.count)[0]?.label ?? "—";

  const topMetrics = Object.values(movementCounts)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map((item) => ({ ...item }));

  const allMetrics = Object.values(movementCounts)
    .sort((a, b) => b.count - a.count)
    .map((item) => ({ ...item }));

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
    allMetrics,
    topCategories,
    topLoggers,
    recentLogs,
  };
}
