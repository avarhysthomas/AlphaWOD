import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Activity,
  ArrowLeft,
  ChevronRight,
  Dumbbell,
  Flame,
  Shield,
  Target,
  Trophy,
} from "lucide-react";
import AdminOnly from "../../../components/guards/AdminOnly";
import UserTopNav from "../../../components/layout/UserTopNav";
import UserAvatar from "../../../components/ui/UserAvatar";
import AdminKpiCard from "../components/AdminKpiCard";
import AdminSectionCard from "../components/AdminSectionCard";
import { getMemberPerformance } from "../services/memberPerformance";

type MemberPerformanceData = Awaited<ReturnType<typeof getMemberPerformance>>;

function formatCreatedAt(raw: any) {
  if (!raw) return "Unknown";

  let date: Date | null = null;

  if (typeof raw?.toDate === "function") {
    date = raw.toDate();
  } else {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) date = parsed;
  }

  if (!date) return "Unknown";

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatLogValue(log: any) {
  const value = log.value || "—";
  const unit = log.unit || "";
  const reps = log.reps ? ` · ${log.reps} reps` : "";
  return `${value}${unit ? ` ${unit}` : ""}${reps}`;
}

function getCategoryPill(category?: string) {
  const key = (category || "").toLowerCase();

  if (key === "strength") {
    return "border-sky-500/20 bg-sky-500/10 text-sky-300";
  }
  if (key === "power") {
    return "border-amber-500/20 bg-amber-500/10 text-amber-300";
  }
  if (key === "engine") {
    return "border-red-500/20 bg-red-500/10 text-red-300";
  }
  if (key === "personal") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
  }

  return "border-white/10 bg-white/[0.04] text-white/70";
}

function RankBadge({ index }: { index: number }) {
  const rank = index + 1;

  const styles =
    rank === 1
      ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
      : rank === 2
      ? "border-neutral-300/20 bg-neutral-300/10 text-neutral-200"
      : rank === 3
      ? "border-orange-500/20 bg-orange-500/10 text-orange-200"
      : "border-white/10 bg-white/[0.04] text-white/60";

  return (
    <div
      className={`inline-flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold ${styles}`}
    >
      {rank}
    </div>
  );
}

export default function AdminMemberPerformance() {
  const { userId = "" } = useParams();
  const [data, setData] = useState<MemberPerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState("all");

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const res = await getMemberPerformance(userId);
        if (alive) setData(res);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [userId]);

  const filteredLogs = useMemo(() => {
    if (!data) return [];
    if (categoryFilter === "all") return data.logs;
    return data.logs.filter((log) => (log.category || "unknown") === categoryFilter);
  }, [data, categoryFilter]);

  return (
    <AdminOnly>
      <div className="min-h-screen bg-black text-white">
        <UserTopNav />

        <div className="px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <Link
              to="/admin/performance"
              className="inline-flex items-center gap-2 text-sm text-neutral-400 transition hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to performance
            </Link>

            {loading ? (
              <div className="mt-8 rounded-3xl border border-white/10 bg-neutral-950 p-6 text-neutral-400">
                Loading athlete data...
              </div>
            ) : !data?.user ? (
              <div className="mt-8 rounded-3xl border border-white/10 bg-neutral-950 p-6 text-neutral-400">
                Athlete not found.
              </div>
            ) : (
              <>
                <div className="relative mt-6 overflow-hidden rounded-[2rem] border border-white/10 bg-neutral-950 p-6 sm:p-8">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.12),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.10),transparent_28%)]" />
                  <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/40 to-transparent" />

                  <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                    <div className="flex items-center gap-4">
                      <div className="relative">
                        <UserAvatar
                          name={data.user.name || "Athlete"}
                          photoURL={data.user.photoURL}
                          size={72}
                        />
                        <div className="absolute -bottom-1 -right-1 rounded-full border border-amber-400/30 bg-amber-400/10 p-1.5 text-amber-200">
                          <Shield className="h-3.5 w-3.5" />
                        </div>
                      </div>

                      <div>
                        <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-amber-200">
                          <Activity className="h-3.5 w-3.5" />
                          Athlete Profile
                        </div>

                        <h1 className="mt-3 text-3xl font-heading uppercase tracking-tight sm:text-4xl">
                          {data.user.name || "Unnamed athlete"}
                        </h1>

                        <p className="mt-2 text-sm text-neutral-400">
                          {data.user.email || "No email"}
                        </p>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <span className="inline-flex rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium text-white/80">
                            Last check-in: {data.user.stats?.lastCheckInDate || "Never"}
                          </span>
                          <span className="inline-flex rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
                            Member
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 backdrop-blur">
                        <div className="text-[11px] uppercase tracking-[0.25em] text-neutral-500">
                          Logs
                        </div>
                        <div className="mt-2 text-2xl font-semibold text-white">
                          {data.totalLogs}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 backdrop-blur">
                        <div className="text-[11px] uppercase tracking-[0.25em] text-neutral-500">
                          Current streak
                        </div>
                        <div className="mt-2 text-2xl font-semibold text-white">
                          {data.user.stats?.currentStreak ?? 0}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 backdrop-blur">
                        <div className="text-[11px] uppercase tracking-[0.25em] text-neutral-500">
                          Longest streak
                        </div>
                        <div className="mt-2 text-2xl font-semibold text-white">
                          {data.user.stats?.longestStreak ?? 0}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 backdrop-blur">
                        <div className="text-[11px] uppercase tracking-[0.25em] text-neutral-500">
                          Check-ins
                        </div>
                        <div className="mt-2 text-2xl font-semibold text-white">
                          {data.user.stats?.totalCheckIns ?? 0}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <AdminKpiCard label="Total Logs" value={data.totalLogs} />
                  <AdminKpiCard
                    label="Current Streak"
                    value={data.user.stats?.currentStreak ?? 0}
                  />
                  <AdminKpiCard
                    label="Longest Streak"
                    value={data.user.stats?.longestStreak ?? 0}
                  />
                  <AdminKpiCard
                    label="Total Check-ins"
                    value={data.user.stats?.totalCheckIns ?? 0}
                  />
                </div>

                <div className="mt-8 grid gap-6 lg:grid-cols-2">
                  <AdminSectionCard title="Most Logged Categories">
                    <div className="space-y-3">
                      {data.categoryCounts.length === 0 ? (
                        <div className="text-sm text-neutral-400">
                          No category data yet.
                        </div>
                      ) : (
                        data.categoryCounts.slice(0, 6).map((item, index) => (
                          <div
                            key={item.label}
                            className="flex items-center justify-between gap-4 rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-4"
                          >
                            <div className="flex items-center gap-4">
                              <RankBadge index={index} />
                              <div className="flex items-center gap-2">
                                <Flame className="h-4 w-4 text-neutral-500" />
                                <span className="text-sm font-medium capitalize text-white">
                                  {item.label}
                                </span>
                              </div>
                            </div>

                            <div className="text-lg font-semibold text-white">
                              {item.count}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </AdminSectionCard>

                  <AdminSectionCard title="Most Logged Metrics">
                    <div className="space-y-3">
                      {data.metricCounts.length === 0 ? (
                        <div className="text-sm text-neutral-400">
                          No metric data yet.
                        </div>
                      ) : (
                        data.metricCounts.slice(0, 6).map((item, index) => (
                          <div
                            key={item.label}
                            className="flex items-center justify-between gap-4 rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-4"
                          >
                            <div className="flex items-center gap-4">
                              <RankBadge index={index} />
                              <div className="flex items-center gap-2">
                                <Target className="h-4 w-4 text-neutral-500" />
                                <span className="text-sm font-medium text-white">
                                  {item.label}
                                </span>
                              </div>
                            </div>

                            <div className="text-lg font-semibold text-white">
                              {item.count}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </AdminSectionCard>
                </div>

                <div className="mt-8">
                  <AdminSectionCard title="Log History">
                    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-sm text-neutral-400">
                        Filter this athlete’s training history by category.
                      </div>

                      <div className="relative">
                        <select
                          value={categoryFilter}
                          onChange={(e) => setCategoryFilter(e.target.value)}
                          className="appearance-none rounded-2xl border border-white/10 bg-neutral-900 px-4 py-3 pr-10 text-sm text-white outline-none transition focus:border-amber-400/20"
                        >
                          <option value="all">All categories</option>
                          {data.categoryCounts.map((item) => (
                            <option key={item.label} value={item.label}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                          <ChevronRight className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 rotate-90 text-neutral-500" />
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="min-w-full border-separate border-spacing-y-2">
                        <thead>
                          <tr className="text-left text-[11px] uppercase tracking-[0.22em] text-neutral-500">
                            <th className="px-4 py-2">Metric</th>
                            <th className="px-4 py-2">Category</th>
                            <th className="px-4 py-2">Value</th>
                            <th className="px-4 py-2">Log Date</th>
                            <th className="px-4 py-2">Created</th>
                            <th className="px-4 py-2">Notes</th>
                          </tr>
                        </thead>

                        <tbody>
                          {filteredLogs.map((log) => (
                            <tr
                              key={log.id}
                              className="group rounded-2xl bg-neutral-950 text-sm transition hover:bg-neutral-900"
                            >
                              <td className="rounded-l-2xl border-y border-l border-white/6 px-4 py-4 text-white">
                                <div className="flex items-center gap-2">
                                  <Dumbbell className="h-4 w-4 text-neutral-500" />
                                  {log.metricLabel}
                                </div>
                              </td>

                              <td className="border-y border-white/6 px-4 py-4">
                                <span
                                  className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium capitalize ${getCategoryPill(
                                    log.category
                                  )}`}
                                >
                                  {log.category || "—"}
                                </span>
                              </td>

                              <td className="border-y border-white/6 px-4 py-4 text-white">
                                {formatLogValue(log)}
                              </td>

                              <td className="border-y border-white/6 px-4 py-4 text-neutral-400">
                                {log.date || "—"}
                              </td>

                              <td className="border-y border-white/6 px-4 py-4 text-neutral-400">
                                {formatCreatedAt(log.createdAt)}
                              </td>

                              <td className="rounded-r-2xl border-y border-r border-white/6 px-4 py-4 text-neutral-400">
                                {log.notes?.trim() || "—"}
                              </td>
                            </tr>
                          ))}

                          {filteredLogs.length === 0 ? (
                            <tr>
                              <td
                                colSpan={6}
                                className="px-4 py-10 text-center text-sm text-neutral-500"
                              >
                                No logs found for this filter.
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </AdminSectionCard>
                </div>

                <div className="mt-8 grid gap-4 lg:grid-cols-3">
                  <div className="rounded-[1.75rem] border border-white/10 bg-neutral-950 p-5">
                    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-neutral-500">
                      <Trophy className="h-4 w-4 text-amber-300" />
                      Coach Note
                    </div>
                    <p className="mt-3 text-sm leading-6 text-neutral-400">
                      This athlete view is now a strong base for future PB logic,
                      movement-specific trends, and progress charting.
                    </p>
                  </div>

                  <div className="rounded-[1.75rem] border border-white/10 bg-neutral-950 p-5">
                    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-neutral-500">
                      <Activity className="h-4 w-4 text-sky-300" />
                      Next Upgrade
                    </div>
                    <p className="mt-3 text-sm leading-6 text-neutral-400">
                      Add a metric filter so you can isolate one movement and
                      inspect how that member has progressed over time.
                    </p>
                  </div>

                  <div className="rounded-[1.75rem] border border-white/10 bg-neutral-950 p-5">
                    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-neutral-500">
                      <Target className="h-4 w-4 text-red-300" />
                      Future Insight
                    </div>
                    <p className="mt-3 text-sm leading-6 text-neutral-400">
                      Numeric logs can later feed into automatic PB detection and
                      trend visualisations for a proper athlete analysis suite.
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </AdminOnly>
  );
}