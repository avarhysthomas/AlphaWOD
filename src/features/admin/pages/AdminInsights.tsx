import React, { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ChevronRight,
  Flame,
  ShieldAlert,
  Trophy,
  Users,
} from "lucide-react";
import AdminOnly from "../../../components/guards/AdminOnly";
import UserAvatar from "../../../components/ui/UserAvatar";
import AdminKpiCard from "../components/AdminKpiCard";
import AdminSectionCard from "../components/AdminSectionCard";
import { getInsightsSummary } from "../services/insights";
import UserTopNav from "../../../components/layout/UserTopNav";

type Summary = Awaited<ReturnType<typeof getInsightsSummary>>;

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

function getAttentionBadge(lastCheckInDate?: string) {
  if (!lastCheckInDate) {
    return "border-red-500/25 bg-red-500/10 text-red-300";
  }

  const last = new Date(`${lastCheckInDate}T00:00:00`);
  const now = new Date();
  const diff = now.getTime() - last.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days > 30) {
    return "border-red-500/25 bg-red-500/10 text-red-300";
  }

  return "border-amber-500/30 bg-amber-500/10 text-amber-300";
}

export default function AdminInsights() {
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const res = await getInsightsSummary();
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
    <AdminOnly>
      <div className="min-h-screen bg-black text-white">
        <UserTopNav />

        <div className="px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-neutral-950 p-6 sm:p-8">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.14),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(239,68,68,0.10),transparent_28%)]" />
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/50 to-transparent" />

              <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                <div className="max-w-2xl">
                  <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-amber-200">
                    <Activity className="h-3.5 w-3.5" />
                    Admin Insights
                  </div>

                  <h1 className="mt-4 text-3xl font-heading tracking-tight sm:text-4xl">
                    Member Pulse
                  </h1>

                  <p className="mt-3 max-w-xl text-sm leading-6 text-neutral-400 sm:text-base">
                    Track engagement, identify your most consistent members, and
                    catch who is drifting before they disappear.
                  </p>
                </div>

                {!loading && data ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 backdrop-blur">
                      <div className="text-[11px] uppercase tracking-[0.25em] text-neutral-500">
                        Members
                      </div>
                      <div className="mt-2 text-2xl font-semibold text-white">
                        {data.totalMembers}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 backdrop-blur">
                      <div className="text-[11px] uppercase tracking-[0.25em] text-neutral-500">
                        Active
                      </div>
                      <div className="mt-2 text-2xl font-semibold text-white">
                        {data.activeMembers}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 backdrop-blur">
                      <div className="text-[11px] uppercase tracking-[0.25em] text-neutral-500">
                        This month
                      </div>
                      <div className="mt-2 text-2xl font-semibold text-white">
                        {data.monthCheckIns}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 backdrop-blur">
                      <div className="text-[11px] uppercase tracking-[0.25em] text-neutral-500">
                        Attention
                      </div>
                      <div className="mt-2 text-2xl font-semibold text-white">
                        {data.inactiveMembers.length}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            {loading ? (
              <div className="mt-8 rounded-3xl border border-white/10 bg-neutral-950 p-6 text-neutral-400">
                Loading insights...
              </div>
            ) : !data ? (
              <div className="mt-8 rounded-3xl border border-white/10 bg-neutral-950 p-6 text-neutral-400">
                No data available.
              </div>
            ) : (
              <>
                <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <AdminKpiCard label="Total Members" value={data.totalMembers} />
                  <AdminKpiCard label="Active Members" value={data.activeMembers} />
                  <AdminKpiCard
                    label="Check-ins This Month"
                    value={data.monthCheckIns}
                    sublabel={data.monthKey}
                  />
                  <AdminKpiCard
                    label="Total Check-ins"
                    value={data.totalCheckIns}
                  />
                </div>

                <div className="mt-8 grid gap-6 lg:grid-cols-2">
                  <AdminSectionCard title="Top Attenders This Month">
                    <div className="space-y-3">
                      {data.topAttenders.length === 0 ? (
                        <div className="text-sm text-neutral-400">
                          No member activity yet.
                        </div>
                      ) : (
                        data.topAttenders.map((user, index) => (
                          <div
                            key={user.id}
                            className="group flex items-center justify-between gap-4 rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-4 transition hover:border-white/15 hover:bg-white/[0.04]"
                          >
                            <div className="flex items-center gap-4">
                              <RankBadge index={index} />

                              <div className="relative">
                                <UserAvatar
                                  name={user.name || "Member"}
                                  photoURL={user.photoURL}
                                  size={44}
                                />
                                {index === 0 ? (
                                  <div className="absolute -right-1 -top-1 rounded-full border border-amber-400/30 bg-amber-400/10 p-1 text-amber-200">
                                    <Trophy className="h-3 w-3" />
                                  </div>
                                ) : null}
                              </div>

                              <div>
                                <div className="text-sm font-medium text-white transition group-hover:text-amber-100">
                                  {user.name || "Unnamed member"}
                                </div>
                                <div className="text-xs text-neutral-500">
                                  {user.email || "No email"}
                                </div>
                              </div>
                            </div>

                            <div className="text-right">
                              <div className="text-lg font-semibold text-white">
                                {user.stats?.monthCheckIns?.[data.monthKey] ?? 0}
                              </div>
                              <div className="text-[11px] uppercase tracking-[0.2em] text-neutral-500">
                                check-ins
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </AdminSectionCard>

                  <AdminSectionCard title="Members Needing Attention">
                    {data.inactiveMembers.length === 0 ? (
                      <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/5 px-4 py-5 text-sm text-emerald-300">
                        No inactive members right now.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {data.inactiveMembers.map((user) => (
                          <div
                            key={user.id}
                            className="group flex items-center justify-between gap-4 rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-4 transition hover:border-amber-400/20 hover:bg-white/[0.04]"
                          >
                            <div className="flex items-center gap-4">
                              <div className="relative">
                                <UserAvatar
                                  name={user.name || "Member"}
                                  photoURL={user.photoURL}
                                  size={44}
                                />
                                <div className="absolute -right-1 -top-1 rounded-full border border-red-500/25 bg-red-500/10 p-1 text-red-300">
                                  <ShieldAlert className="h-3 w-3" />
                                </div>
                              </div>

                              <div>
                                <div className="text-sm font-medium text-white transition group-hover:text-amber-100">
                                  {user.name || "Unnamed member"}
                                </div>
                                <div className="mt-1 flex items-center gap-2 text-xs text-neutral-500">
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                  Last check-in:{" "}
                                  {user.stats?.lastCheckInDate || "Never"}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-3">
                              <div
                                className={`rounded-full border px-3 py-1 text-xs font-medium ${getAttentionBadge(
                                  user.stats?.lastCheckInDate
                                )}`}
                              >
                                Needs attention
                              </div>
                              <ChevronRight className="h-4 w-4 text-neutral-600 transition group-hover:text-amber-200" />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </AdminSectionCard>
                </div>

                <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
                  <AdminSectionCard title="Attendance Signal">
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-5">
                        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-neutral-500">
                          <Users className="h-4 w-4 text-sky-300" />
                          Total base
                        </div>
                        <div className="mt-3 text-3xl font-semibold text-white">
                          {data.totalMembers}
                        </div>
                        <p className="mt-2 text-sm text-neutral-400">
                          Current member count in the system.
                        </p>
                      </div>

                      <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-5">
                        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-neutral-500">
                          <Activity className="h-4 w-4 text-emerald-300" />
                          Active
                        </div>
                        <div className="mt-3 text-3xl font-semibold text-white">
                          {data.activeMembers}
                        </div>
                        <p className="mt-2 text-sm text-neutral-400">
                          Checked in during the last 30 days.
                        </p>
                      </div>

                      <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-5">
                        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-neutral-500">
                          <Flame className="h-4 w-4 text-red-300" />
                          Attention
                        </div>
                        <div className="mt-3 text-3xl font-semibold text-white">
                          {data.inactiveMembers.length}
                        </div>
                        <p className="mt-2 text-sm text-neutral-400">
                          Members showing signs of disengagement.
                        </p>
                      </div>
                    </div>
                  </AdminSectionCard>

                  <AdminSectionCard title="Coach Take">
                    <div className="space-y-4">
                      <div className="rounded-2xl border border-amber-500/15 bg-amber-500/5 p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-amber-200">
                          Current read
                        </div>
                        <p className="mt-2 text-sm leading-6 text-neutral-300">
                          Your strongest attendance momentum is sitting with the
                          members at the top of this month’s board, while the
                          attention list shows exactly who may need a nudge
                          before churn becomes a bigger issue.
                        </p>
                      </div>

                      <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-neutral-500">
                          Suggested next step
                        </div>
                        <p className="mt-2 text-sm leading-6 text-neutral-400">
                          Next upgrade here should be clickable member insight
                          rows that jump into a full member profile with both
                          attendance and performance history together.
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