import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ChevronRight,
  Dumbbell,
  Flame,
  Target,
  Trophy,
} from "lucide-react";
import PerformanceAccessOnly from "../../../components/guards/PerformanceAccessOnly";
import AppBottomNav from "../../../components/layout/AppBottomNav";
import UserAvatar from "../../../components/ui/UserAvatar";
import { useAuth } from "../../../context/AuthContext";
import AdminSectionCard from "../components/AdminSectionCard";
import { getPerformanceSummary } from "../services/performance";

type PerformanceSummary = Awaited<ReturnType<typeof getPerformanceSummary>>;

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

  return "border-white/8 bg-white/[0.035] text-white/70";
}

function RankBadge({ index }: { index: number }) {
  const rank = index + 1;

  const styles =
    rank === 1
      ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
      : rank === 2
      ? "border-neutral-300/20 bg-neutral-300/10 text-white/72"
      : rank === 3
      ? "border-orange-500/20 bg-orange-500/10 text-orange-200"
      : "border-white/8 bg-white/[0.035] text-white/60";

  return (
    <div
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold sm:h-9 sm:w-9 ${styles}`}
    >
      {rank}
    </div>
  );
}

export default function AdminPerformance() {
  const { appUser } = useAuth();
  const [data, setData] = useState<PerformanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const dashboardLabel = appUser?.role === "sgpt" ? "Performance Dashboard" : "Admin Performance";
  const dashboardTitle = appUser?.role === "sgpt" ? "Performance Dashboard" : "Performance Command Centre";

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const res = await getPerformanceSummary();
        if (alive) setData(res);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  return (
    <PerformanceAccessOnly>
      <div className="carbon-fiber-bg min-h-screen overflow-x-hidden font-barlow text-[#f4f0ea]">

        <div className="px-3 pb-36 pt-5 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="relative overflow-hidden rounded-[24px] border border-white/8 bg-[#11100f] p-4 sm:rounded-[28px] sm:p-8">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_72%_0%,rgba(255,255,255,0.05),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.025),transparent_48%)]" />
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/18 to-transparent" />

              <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                <div className="max-w-2xl min-w-0">
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-white/58 sm:text-[11px] sm:tracking-[0.28em]">
                    <Activity className="h-3.5 w-3.5" />
                    {dashboardLabel}
                  </div>

                  <h1 className="mt-4 text-[2.75rem] font-bold leading-none sm:text-6xl">
                    {dashboardTitle}
                  </h1>

                  <p className="mt-3 max-w-xl text-sm leading-6 text-white/42 sm:text-base">
                    See who is logging, what is being tracked most, and jump
                    straight into individual member performance histories.
                  </p>
                </div>

                {!loading && data ? (
                  <div className="grid w-full grid-cols-2 gap-3 lg:w-auto lg:min-w-[420px] lg:grid-cols-4">
                    <div className="rounded-2xl border border-white/8 bg-[#050505]/55 px-3 py-3 backdrop-blur sm:px-4">
                      <div className="text-[10px] uppercase tracking-[0.2em] text-white/30 sm:text-[11px] sm:tracking-[0.25em]">
                        Log volume
                      </div>
                      <div className="mt-2 text-xl font-semibold text-white sm:text-2xl">
                        {data.totalLogs}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/8 bg-[#050505]/55 px-3 py-3 backdrop-blur sm:px-4">
                      <div className="text-[10px] uppercase tracking-[0.2em] text-white/30 sm:text-[11px] sm:tracking-[0.25em]">
                        Active loggers
                      </div>
                      <div className="mt-2 text-xl font-semibold text-white sm:text-2xl">
                        {data.athletesLogging}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/8 bg-[#050505]/55 px-3 py-3 backdrop-blur sm:px-4">
                      <div className="text-[10px] uppercase tracking-[0.2em] text-white/30 sm:text-[11px] sm:tracking-[0.25em]">
                        Top metric
                      </div>
                      <div className="mt-2 line-clamp-2 text-sm font-semibold text-white">
                        {data.mostLoggedMetric}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/8 bg-[#050505]/55 px-3 py-3 backdrop-blur sm:px-4">
                      <div className="text-[10px] uppercase tracking-[0.2em] text-white/30 sm:text-[11px] sm:tracking-[0.25em]">
                        Top category
                      </div>
                      <div className="mt-2 text-xl font-semibold capitalize text-white sm:text-2xl">
                        {data.topCategories[0]?.category || "—"}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            {loading ? (
              <div className="mt-6 rounded-[22px] border border-white/8 bg-[#11100f] p-6 text-white/42 sm:mt-8">
                Loading performance...
              </div>
            ) : !data ? (
              <div className="mt-6 rounded-[22px] border border-white/8 bg-[#11100f] p-6 text-white/42 sm:mt-8">
                No performance data available.
              </div>
            ) : (
              <>
                <div className="mt-6 grid gap-6 lg:mt-8 lg:grid-cols-2">
                  <AdminSectionCard title="Most Logged Metrics">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <p className="text-sm text-white/42">
                        Open the most-used metrics fast, or browse the full library.
                      </p>
                      <Link
                        to="/admin/performance/metrics"
                        className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/8 bg-white/[0.03] px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/70 transition hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
                      >
                        View all
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Link>
                    </div>

                    <div className="space-y-3">
                      {data.topMetrics.length === 0 ? (
                        <div className="text-sm text-white/42">
                          No training log data yet.
                        </div>
                      ) : (
                        data.topMetrics.map((item, index) => (
                          <Link
                            key={`${item.label}-${index}`}
                            to={
                              item.movementSlug && item.metricType
                                ? `/admin/performance/metric/${item.movementSlug}/${encodeURIComponent(
                                    item.metricType
                                  )}`
                                : "#"
                            }
                            className="group flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/[0.025] px-3 py-3 transition hover:border-white/15 hover:bg-white/[0.035] sm:gap-4 sm:px-4 sm:py-4"
                          >
                            <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                              <RankBadge index={index} />
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-white transition group-hover:text-white">
                                  {item.label}
                                </div>
                                <div className="mt-1 flex items-center gap-2 text-xs text-white/30">
                                  <Target className="h-3.5 w-3.5 shrink-0" />
                                  Logged entries
                                </div>
                              </div>
                            </div>

                            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                              <div className="text-right">
                                <div className="text-lg font-semibold text-white">
                                  {item.count}
                                </div>
                                <div className="text-[10px] uppercase tracking-[0.18em] text-white/30 sm:text-[11px] sm:tracking-[0.2em]">
                                  total
                                </div>
                              </div>
                              {item.movementSlug && item.metricType ? (
                                <ChevronRight className="h-4 w-4 shrink-0 text-white/24 transition group-hover:text-white" />
                              ) : null}
                            </div>
                          </Link>
                        ))
                      )}
                    </div>
                  </AdminSectionCard>

                  <AdminSectionCard title="Top Loggers">
                    <div className="space-y-3">
                      {data.topLoggers.length === 0 ? (
                        <div className="text-sm text-white/42">
                          No loggers found yet.
                        </div>
                      ) : (
                        data.topLoggers.map((user, index) => (
                          <Link
                            key={user.userId}
                            to={`/admin/performance/${user.userId}`}
                            className="group flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/[0.025] px-3 py-3 transition hover:border-white/16 hover:bg-white/[0.035] sm:gap-4 sm:px-4 sm:py-4"
                          >
                            <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
                              <RankBadge index={index} />

                              <div className="relative shrink-0">
                                <UserAvatar
                                  name={user.name}
                                  photoURL={user.photoURL}
                                  size={44}
                                />
                                {index === 0 ? (
                                  <div className="absolute -right-1 -top-1 rounded-full border border-amber-400/30 bg-amber-400/10 p-1 text-amber-200">
                                    <Trophy className="h-3 w-3" />
                                  </div>
                                ) : null}
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium text-white transition group-hover:text-white sm:text-base">
                                  {user.name}
                                </div>
                                <div className="truncate text-xs text-white/30 sm:text-sm">
                                  {user.email || "No email"}
                                </div>
                              </div>
                            </div>

                            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                              <div className="text-right">
                                <div className="text-lg font-semibold text-white">
                                  {user.count}
                                </div>
                                <div className="text-[10px] uppercase tracking-[0.18em] text-white/30 sm:text-[11px] sm:tracking-[0.2em]">
                                  logs
                                </div>
                              </div>
                              <ChevronRight className="h-4 w-4 shrink-0 text-white/24 transition group-hover:text-white" />
                            </div>
                          </Link>
                        ))
                      )}
                    </div>
                  </AdminSectionCard>
                </div>

                <div className="mt-6 grid gap-6 lg:mt-8 lg:grid-cols-[1.25fr_0.75fr]">
                  <AdminSectionCard title="Recent Training Logs">
                    <>
                      {/* Mobile cards */}
                      <div className="space-y-3 sm:hidden">
                        {data.recentLogs.length === 0 ? (
                          <div className="rounded-2xl border border-white/8 bg-white/[0.025] px-4 py-8 text-center text-sm text-white/30">
                            No training logs found.
                          </div>
                        ) : (
                          data.recentLogs.map((log) => (
                            <Link
                              key={log.id}
                              to={`/admin/performance/${log.userId}`}
                              className="block rounded-2xl border border-white/8 bg-white/[0.025] p-4 transition hover:border-white/15 hover:bg-white/[0.035]"
                            >
                              <div className="flex items-start gap-3">
                                <UserAvatar
                                  name={log.userName}
                                  photoURL={log.photoURL}
                                  size={40}
                                />

                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-sm font-medium text-white">
                                    {log.userName}
                                  </div>
                                  <div className="truncate text-xs text-white/30">
                                    {log.userEmail || "No email"}
                                  </div>

                                  <div className="mt-3 flex items-center gap-2 text-sm text-white">
                                    <Dumbbell className="h-4 w-4 shrink-0 text-white/30" />
                                    <span className="truncate">{log.metricLabel}</span>
                                  </div>

                                  <div className="mt-3 flex flex-wrap items-center gap-2">
                                    <span
                                      className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium capitalize ${getCategoryPill(
                                        log.category
                                      )}`}
                                    >
                                      {log.category || "—"}
                                    </span>
                                    <span className="text-sm text-white">
                                      {formatLogValue(log)}
                                    </span>
                                  </div>

                                  <div className="mt-3 space-y-1 text-xs text-white/42">
                                    <div>Date: {log.date || "—"}</div>
                                    <div>Created: {formatCreatedAt(log.createdAt)}</div>
                                  </div>
                                </div>

                                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-white/24" />
                              </div>
                            </Link>
                          ))
                        )}
                      </div>

                      {/* Desktop table */}
                      <div className="hidden overflow-x-auto sm:block">
                        <table className="min-w-full border-separate border-spacing-y-2">
                          <thead>
                            <tr className="text-left text-[11px] uppercase tracking-[0.22em] text-white/30">
                              <th className="px-4 py-2">Member</th>
                              <th className="px-4 py-2">Metric</th>
                              <th className="px-4 py-2">Category</th>
                              <th className="px-4 py-2">Value</th>
                              <th className="px-4 py-2">Date</th>
                              <th className="px-4 py-2">Created</th>
                            </tr>
                          </thead>

                          <tbody>
                            {data.recentLogs.map((log) => (
                              <tr
                                key={log.id}
                                className="group rounded-2xl bg-[#11100f] text-sm transition hover:bg-[#151311]"
                              >
                                <td className="rounded-l-2xl border-y border-l border-white/6 px-4 py-4">
                                  <Link
                                    to={`/admin/performance/${log.userId}`}
                                    className="flex items-center gap-3"
                                  >
                                    <UserAvatar
                                      name={log.userName}
                                      photoURL={log.photoURL}
                                      size={38}
                                    />
                                    <div className="min-w-0">
                                      <div className="truncate font-medium text-white transition group-hover:text-white">
                                        {log.userName}
                                      </div>
                                      <div className="truncate text-xs text-white/30">
                                        {log.userEmail || "No email"}
                                      </div>
                                    </div>
                                  </Link>
                                </td>

                                <td className="border-y border-white/6 px-4 py-4 text-white">
                                  <div className="flex items-center gap-2">
                                    <Dumbbell className="h-4 w-4 shrink-0 text-white/30" />
                                    <span className="truncate">{log.metricLabel}</span>
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

                                <td className="border-y border-white/6 px-4 py-4 text-white/42">
                                  {log.date || "—"}
                                </td>

                                <td className="rounded-r-2xl border-y border-r border-white/6 px-4 py-4 text-white/42">
                                  {formatCreatedAt(log.createdAt)}
                                </td>
                              </tr>
                            ))}

                            {data.recentLogs.length === 0 ? (
                              <tr>
                                <td
                                  colSpan={6}
                                  className="px-4 py-10 text-center text-sm text-white/30"
                                >
                                  No training logs found.
                                </td>
                              </tr>
                            ) : null}
                          </tbody>
                        </table>
                      </div>
                    </>
                  </AdminSectionCard>

                  <AdminSectionCard title="Category Breakdown">
                    <div className="space-y-3">
                      {data.topCategories.length === 0 ? (
                        <div className="text-sm text-white/42">
                          No category data yet.
                        </div>
                      ) : (
                        data.topCategories.map((item) => {
                          const max = data.topCategories[0]?.count || 1;
                          const width = `${(item.count / max) * 100}%`;

                          return (
                            <div key={item.category} className="space-y-2">
                              <div className="flex items-center justify-between gap-4">
                                <div className="flex min-w-0 items-center gap-2">
                                  <Flame className="h-4 w-4 shrink-0 text-white/30" />
                                  <span className="truncate text-sm font-medium capitalize text-white">
                                    {item.category}
                                  </span>
                                </div>
                                <span className="shrink-0 text-sm font-semibold text-white">
                                  {item.count}
                                </span>
                              </div>

                              <div className="h-2 overflow-hidden rounded-full bg-white/6">
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-amber-400 via-orange-400 to-red-500"
                                  style={{ width }}
                                />
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </AdminSectionCard>
                </div>
              </>
            )}
          </div>
        </div>
        <AppBottomNav />
      </div>
    </PerformanceAccessOnly>
  );
}
