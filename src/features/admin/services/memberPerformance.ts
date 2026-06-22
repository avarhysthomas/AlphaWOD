import {
  collection,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
} from "firebase/firestore";
import { db } from "../../../firebase";
import { getCachedAdminUser, type CachedAdminUser } from "./usersCache";

export type MemberTrainingLog = {
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

const MEMBER_LOG_LIMIT = 500;

function formatMetricLabel(log: MemberTrainingLog) {
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

export async function getMemberPerformance(userId: string) {
  const user = (await getCachedAdminUser(userId)) as CachedAdminUser | null;

  if (!user) {
    return {
      user: null,
      logs: [],
      totalLogs: 0,
      categoryCounts: [],
      metricCounts: [],
    };
  }

  const logsRef = collection(db, "users", userId, "trainingLogs");
  const [logsSnap, countSnap] = await Promise.all([
    getDocs(query(logsRef, orderBy("createdAt", "desc"), limit(MEMBER_LOG_LIMIT))),
    getCountFromServer(logsRef),
  ]);

  const logs: MemberTrainingLog[] = logsSnap.docs
    .map((doc) => ({
      id: doc.id,
      ...(doc.data() as Omit<MemberTrainingLog, "id">),
    }))
    .sort((a, b) => getCreatedAtMs(b.createdAt) - getCreatedAtMs(a.createdAt));

  const categoryMap = logs.reduce<Record<string, number>>((acc, log) => {
    const key = log.category || "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const metricMap = logs.reduce<Record<string, number>>((acc, log) => {
    const key = formatMetricLabel(log);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const categoryCounts = Object.entries(categoryMap)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count }));

  const metricCounts = Object.entries(metricMap)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count }));

  return {
    user,
    logs: logs.map((log) => ({
      ...log,
      metricLabel: formatMetricLabel(log),
    })),
    totalLogs: countSnap.data().count,
    categoryCounts,
    metricCounts,
  };
}
