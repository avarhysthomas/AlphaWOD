import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Activity,
  ArrowLeft,
  ChevronRight,
  Dumbbell,
  Medal,
  Target,
  Timer,
  Trophy,
} from "lucide-react";
import AdminOnly from "../../../components/guards/AdminOnly";
import UserTopNav from "../../../components/layout/UserTopNav";
import UserAvatar from "../../../components/ui/UserAvatar";
import AdminSectionCard from "../components/AdminSectionCard";
import { getMetricPerformance } from "../services/metricPerformance";

type MetricPerformanceData = Awaited<ReturnType<typeof getMetricPerformance>>;

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
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold sm:h-9 sm:w-9 ${styles}`}
    >
      {rank}
    </div>
  );
}

export default function AdminMetricPerformance() {
  const { movementSlug = "", metricType = "" } = useParams();
  const [data, setData] = useState<MetricPerformanceData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const res = await getMetricPerformance(movementSlug, metricType);
        if (alive) setData(res);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [movementSlug, metricType]);

  return (
    <AdminOnly>
      <div className="min-h-screen bg-black text-white">
        <UserTopNav />

        <div className="overflow-x-hidden px-3 py-5 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <Link
              to="/admin/performance"
              className="inline-flex items-center gap-2 text-sm text-neutral-400 transition hover:text-white"
            >
              <ArrowLeft className="h-4 w-4 shrink-0" />
              Back to performance
            </Link>

            {loading ? (
              <div className="mt-6 rounded-3xl border border-white/10 bg-neutral-950 p-6 text-neutral-400 sm:mt-8">
                Loading metric rankings...
              </div>
            ) : !data ? (
              <div className="mt-6 rounded-3xl border border-white/10 bg-neutral-950 p-6 text-neutral-400 sm:mt-8">
                Metric not found.
              </div>
            ) : (
              <>
                <div className="relative mt-6 overflow-hidden rounded-[1.75rem] border border-white/10 bg-neutral-950 p-4 sm:rounded-[2rem] sm:p-8">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.12),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.10),transparent_28%)]" />
                  <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/40 to-transparent" />

                  <div className="relative z-10 flex min-w-0 flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-amber-200 sm:text-[11px] sm:tracking-[0.28em]">
                        <Activity className="h-3.5 w-3.5 shrink-0" />
                        Metric Rankings
                      </div>

                      <h1 className="mt-4 text-2xl font-heading tracking-tight sm:text-4xl">
                        {data.metricLabel}
                      </h1>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium capitalize ${getCategoryPill(
                            data.category
                          )}`}
                        >
                          {data.category || "Unknown"}
                        </span>
                        <span className="inline-flex rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium text-white/75">
                          {data.lowerIsBetter ? "Lower score ranks higher" : "Higher score ranks higher"}
                        </span>
                      </div>
                    </div>

                    <div className="grid w-full grid-cols-2 gap-3 lg:w-auto lg:min-w-[420px] lg:grid-cols-4">
                      <div className="rounded-2xl border border-white/10 bg-black/40 px-3 py-3 backdrop-blur sm:px-4">
                        <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 sm:text-[11px] sm:tracking-[0.25em]">
                          Athletes ranked
                        </div>
                        <div className="mt-2 text-xl font-semibold text-white sm:text-2xl">
                          {data.totalAthletes}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-black/40 px-3 py-3 backdrop-blur sm:px-4">
                        <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 sm:text-[11px] sm:tracking-[0.25em]">
                          Total logs
                        </div>
                        <div className="mt-2 text-xl font-semibold text-white sm:text-2xl">
                          {data.totalLogs}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-black/40 px-3 py-3 backdrop-blur sm:px-4">
                        <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 sm:text-[11px] sm:tracking-[0.25em]">
                          Movement
                        </div>
                        <div className="mt-2 line-clamp-2 text-sm font-semibold text-white">
                          {data.movementName}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-black/40 px-3 py-3 backdrop-blur sm:px-4">
                        <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 sm:text-[11px] sm:tracking-[0.25em]">
                          Metric type
                        </div>
                        <div className="mt-2 line-clamp-2 text-sm font-semibold text-white">
                          {data.metricType}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-6 grid gap-6 lg:mt-8 lg:grid-cols-[1.2fr_0.8fr]">
                  <AdminSectionCard title="Ranking Board">
                    <div className="space-y-3">
                      {data.rankings.length === 0 ? (
                        <div className="text-sm text-neutral-400">
                          No ranked entries found for this metric yet.
                        </div>
                      ) : (
                        data.rankings.map((athlete, index) => (
                          <Link
                            key={athlete.userId}
                            to={`/admin/performance/${athlete.userId}`}
                            className="group flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/[0.02] px-3 py-3 transition hover:border-amber-400/20 hover:bg-white/[0.04] sm:gap-4 sm:px-4 sm:py-4"
                          >
                            <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
                              <RankBadge index={index} />

                              <div className="relative shrink-0">
                                <UserAvatar
                                  name={athlete.name}
                                  photoURL={athlete.photoURL}
                                  size={44}
                                />
                                {index === 0 ? (
                                  <div className="absolute -right-1 -top-1 rounded-full border border-amber-400/30 bg-amber-400/10 p-1 text-amber-200">
                                    <Trophy className="h-3 w-3" />
                                  </div>
                                ) : null}
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium text-white transition group-hover:text-amber-100 sm:text-base">
                                  {athlete.name}
                                </div>
                                <div className="truncate text-xs text-neutral-500 sm:text-sm">
                                  {athlete.email || "No email"}
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                                  <span>{athlete.totalLogs} logs</span>
                                  <span className="text-neutral-700">•</span>
                                  <span>Latest: {athlete.latestDate || formatCreatedAt(athlete.latestCreatedAt)}</span>
                                </div>
                              </div>
                            </div>

                            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                              <div className="text-right">
                                <div className="text-lg font-semibold text-white">
                                  {athlete.bestValueDisplay}
                                </div>
                                <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-500 sm:text-[11px] sm:tracking-[0.2em]">
                                  best
                                </div>
                              </div>
                              <ChevronRight className="h-4 w-4 shrink-0 text-neutral-600 transition group-hover:text-amber-200" />
                            </div>
                          </Link>
                        ))
                      )}
                    </div>
                  </AdminSectionCard>

                  <AdminSectionCard title="Leaderboard Notes">
                    <div className="space-y-3">
                      <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                        <div className="flex items-center gap-2 text-sm font-medium text-white">
                          {data.lowerIsBetter ? (
                            <Timer className="h-4 w-4 text-amber-300" />
                          ) : (
                            <Dumbbell className="h-4 w-4 text-amber-300" />
                          )}
                          Ranking rule
                        </div>
                        <p className="mt-2 text-sm leading-6 text-neutral-400">
                          {data.lowerIsBetter
                            ? "This metric is time-based, so faster results rank above slower ones."
                            : "This metric is score- or load-based, so bigger results rank above smaller ones."}
                        </p>
                      </div>

                      <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                        <div className="flex items-center gap-2 text-sm font-medium text-white">
                          <Target className="h-4 w-4 text-amber-300" />
                          Best attempt only
                        </div>
                        <p className="mt-2 text-sm leading-6 text-neutral-400">
                          Each athlete appears once using their best logged result for this exact metric.
                        </p>
                      </div>

                      <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                        <div className="flex items-center gap-2 text-sm font-medium text-white">
                          <Medal className="h-4 w-4 text-amber-300" />
                          Drill into athlete
                        </div>
                        <p className="mt-2 text-sm leading-6 text-neutral-400">
                          Tap any ranked athlete to jump straight into their full admin performance history.
                        </p>
                      </div>
                    </div>
                  </AdminSectionCard>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </AdminOnly>
  );
}
