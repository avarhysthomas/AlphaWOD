import {
  collectionGroup,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "../../../firebase";
import { getCachedAdminUsers } from "./usersCache";
import {
  formatDisplayValue,
  isTimeDisplay,
  parseChartValue,
} from "../../training/utils/movementHelpers";

type MetricTrainingLog = {
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

const METRIC_LOG_LIMIT = 2000;

function getCreatedAtMs(raw: any) {
  if (!raw) return 0;
  if (typeof raw?.toDate === "function") return raw.toDate().getTime();

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function formatMetricLabel(log: MetricTrainingLog) {
  const movement = log.movementName || "Unknown movement";
  const metric = log.metricType || "";
  return metric ? `${movement} · ${metric}` : movement;
}

function isLowerBetter(log: MetricTrainingLog) {
  return isTimeDisplay(log.unit, log.category, log.movementName);
}

export async function getMetricPerformance(
  movementSlug: string,
  metricType: string
) {
  const metricLogsQuery = query(
    collectionGroup(db, "trainingLogs"),
    where("movementSlug", "==", movementSlug),
    where("metricType", "==", metricType)
  );

  const [users, logsSnap, countSnap] = await Promise.all([
    getCachedAdminUsers(),
    getDocs(
      query(
        collectionGroup(db, "trainingLogs"),
        where("movementSlug", "==", movementSlug),
        where("metricType", "==", metricType),
        orderBy("createdAt", "desc"),
        limit(METRIC_LOG_LIMIT)
      )
    ),
    getCountFromServer(metricLogsQuery),
  ]);

  const userMap = new Map(users.map((user) => [user.id, user]));

  const logs: MetricTrainingLog[] = logsSnap.docs
    .map((doc) => ({
      id: doc.id,
      ...(doc.data() as Omit<MetricTrainingLog, "id">),
    }))
    .filter((log) => {
      const user = log.userId ? userMap.get(log.userId) : null;
      return user?.role !== "admin" && user?.role !== "banned" && user?.approvalStatus !== "pending";
    })
    .sort((a, b) => getCreatedAtMs(b.createdAt) - getCreatedAtMs(a.createdAt));

  const metricLabel = logs[0] ? formatMetricLabel(logs[0]) : "Unknown metric";
  const movementName = logs[0]?.movementName || "Unknown movement";
  const category = logs[0]?.category || "";
  const lowerIsBetter = logs[0] ? isLowerBetter(logs[0]) : false;

  const logsByUser = logs.reduce<Record<string, MetricTrainingLog[]>>((acc, log) => {
    if (!log.userId) return acc;
    acc[log.userId] = acc[log.userId] ?? [];
    acc[log.userId].push(log);
    return acc;
  }, {});

  const rankings = Object.entries(logsByUser)
    .map(([userId, userLogs]) => {
      const numericLogs = userLogs
        .map((log) => ({
          ...log,
          parsed: log.value ? parseChartValue(log.value, log.unit) : null,
        }))
        .filter((log) => log.parsed !== null) as Array<
        MetricTrainingLog & { parsed: number }
      >;

      if (!numericLogs.length) return null;

      const bestLog = numericLogs.reduce((best, current) => {
        if (lowerIsBetter) {
          return current.parsed < best.parsed ? current : best;
        }

        return current.parsed > best.parsed ? current : best;
      });

      const user = userMap.get(userId);

      return {
        userId,
        name: user?.name || "Unknown athlete",
        email: user?.email || "",
        photoURL: user?.photoURL || "",
        bestValue: bestLog.value || "—",
        bestValueDisplay: formatDisplayValue(
          bestLog.value || "—",
          bestLog.unit,
          bestLog.category,
          bestLog.movementName
        ),
        parsedValue: bestLog.parsed,
        unit: bestLog.unit || "",
        totalLogs: userLogs.length,
        latestDate: userLogs[0]?.date || "",
        latestCreatedAt: userLogs[0]?.createdAt,
      };
    })
    .filter(Boolean) as Array<{
    userId: string;
    name: string;
    email: string;
    photoURL: string;
    bestValue: string;
    bestValueDisplay: string;
    parsedValue: number;
    unit: string;
    totalLogs: number;
    latestDate: string;
    latestCreatedAt: any;
  }>;

  rankings.sort((a, b) => {
    if (a.parsedValue === b.parsedValue) {
      return b.totalLogs - a.totalLogs;
    }

    return lowerIsBetter ? a.parsedValue - b.parsedValue : b.parsedValue - a.parsedValue;
  });

  return {
    metricLabel,
    movementName,
    metricType,
    movementSlug,
    category,
    totalLogs: countSnap.data().count,
    totalAthletes: rankings.length,
    lowerIsBetter,
    rankings,
  };
}
