import React, { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Ban,
  Bot,
  CheckCircle2,
  Flame,
  LoaderCircle,
  RotateCcw,
  ShieldAlert,
  Trophy,
  Users,
} from "lucide-react";
import AdminOnly from "../../../components/guards/AdminOnly";
import UserAvatar from "../../../components/ui/UserAvatar";
import AdminKpiCard from "../components/AdminKpiCard";
import AdminSectionCard from "../components/AdminSectionCard";
import {
  approveUserAccess,
  inviteMemberByEmail,
  updateMemberRole,
} from "../services/access";
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
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold sm:h-9 sm:w-9 ${styles}`}
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
  const [approvingUserId, setApprovingUserId] = useState<string | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [roleBusyUserId, setRoleBusyUserId] = useState<string | null>(null);
  const [roleActionError, setRoleActionError] = useState<string | null>(null);
  const [memberSearch, setMemberSearch] = useState("");

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

  async function handleApprove(userId: string) {
    try {
      setApprovingUserId(userId);
      setApprovalError(null);
      await approveUserAccess(userId);
      setData((current) => {
        if (!current) return current;
        const approvedUser =
          current.pendingApprovals.find((user) => user.id === userId) ?? null;
        const nextPending = current.pendingApprovals.filter((user) => user.id !== userId);

        return {
          ...current,
          totalMembers: current.totalMembers + (approvedUser ? 1 : 0),
          pendingApprovals: nextPending,
          users: approvedUser
            ? [...current.users, { ...approvedUser, approvalStatus: "approved" }]
            : current.users,
        };
      });
    } catch (err: any) {
      setApprovalError(err?.message ?? "Failed to approve member.");
    } finally {
      setApprovingUserId(null);
    }
  }

  async function handleInviteSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    try {
      setInviteLoading(true);
      setInviteError(null);
      setInviteSuccess(null);
      const email = inviteEmail.trim().toLowerCase();

      await inviteMemberByEmail(email);

      setInviteSuccess(`Invite sent to ${email}.`);
      setInviteEmail("");
    } catch (err: any) {
      setInviteError(err?.message ?? "Failed to send invite email.");
    } finally {
      setInviteLoading(false);
    }
  }

  async function handleRoleChange(userId: string, role: "user" | "sgpt" | "banned") {
    try {
      setRoleBusyUserId(userId);
      setRoleActionError(null);
      await updateMemberRole(userId, role);

      setData((current) => {
        if (!current) return current;

        const movedUser =
          current.users.find((user) => user.id === userId) ??
          current.inactiveMembers.find((user) => user.id === userId) ??
          current.bannedMembers.find((user) => user.id === userId) ??
          null;

        if (!movedUser) return current;

        const nextUsers = current.users
          .filter((user) => user.id !== userId)
          .map((user) => (user.id === userId ? {...user, role} : user));

        const nextInactiveMembers = current.inactiveMembers.filter((user) => user.id !== userId);
        const nextBannedMembers = current.bannedMembers.filter((user) => user.id !== userId);
        const wasBanned = movedUser.role === "banned";
        const wasActiveRecently =
          !!movedUser.stats?.lastCheckInDate &&
          Math.floor(
            (Date.now() - new Date(`${movedUser.stats.lastCheckInDate}T00:00:00`).getTime()) /
              (1000 * 60 * 60 * 24)
          ) <= 30;
        const monthCheckIns = movedUser.stats?.monthCheckIns?.[current.monthKey] ?? 0;
        const totalCheckIns = movedUser.stats?.totalCheckIns ?? 0;

        if (role === "banned") {
          return {
            ...current,
            totalMembers: wasBanned ? current.totalMembers : Math.max(0, current.totalMembers - 1),
            activeMembers:
              !wasBanned && wasActiveRecently ? Math.max(0, current.activeMembers - 1) : current.activeMembers,
            monthCheckIns: wasBanned ? current.monthCheckIns : current.monthCheckIns - monthCheckIns,
            totalCheckIns: wasBanned ? current.totalCheckIns : current.totalCheckIns - totalCheckIns,
            users: nextUsers,
            inactiveMembers: nextInactiveMembers,
            bannedMembers: [...nextBannedMembers, {...movedUser, role}].sort((a, b) =>
              (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? "")
            ),
          };
        }

        return {
          ...current,
          totalMembers: wasBanned ? current.totalMembers + 1 : current.totalMembers,
          activeMembers: wasBanned && wasActiveRecently ? current.activeMembers + 1 : current.activeMembers,
          monthCheckIns: wasBanned ? current.monthCheckIns + monthCheckIns : current.monthCheckIns,
          totalCheckIns: wasBanned ? current.totalCheckIns + totalCheckIns : current.totalCheckIns,
          users: [...nextUsers, {...movedUser, role}].sort((a, b) =>
            (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? "")
          ),
          bannedMembers: nextBannedMembers,
        };
      });
    } catch (err: any) {
      setRoleActionError(err?.message ?? "Failed to update member role.");
    } finally {
      setRoleBusyUserId(null);
    }
  }

  const normalizedSearch = memberSearch.trim().toLowerCase();
  const searchableMembers = data
    ? data.users.filter((user) => {
        if (!normalizedSearch) return true;
        const haystack = `${user.name ?? ""} ${user.email ?? ""}`.toLowerCase();
        return haystack.includes(normalizedSearch);
      })
    : [];

  return (
    <AdminOnly>
      <div className="min-h-screen bg-black text-white">
        <UserTopNav />

        <div className="px-3 py-5 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-neutral-950 p-4 sm:rounded-[2rem] sm:p-8">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.14),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(239,68,68,0.10),transparent_28%)]" />
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/50 to-transparent" />

              <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                <div className="max-w-2xl min-w-0">
                  <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-amber-200 sm:text-[11px] sm:tracking-[0.28em]">
                    <Activity className="h-3.5 w-3.5 shrink-0" />
                    Admin Insights
                  </div>

                  <h1 className="mt-4 text-2xl font-heading tracking-tight sm:text-4xl">
                    Member Pulse
                  </h1>

                  <p className="mt-3 max-w-xl text-sm leading-6 text-neutral-400 sm:text-base">
                    Track engagement, identify your most consistent members, and
                    catch who is drifting before they disappear.
                  </p>
                </div>

                {!loading && data ? (
                  <div className="grid w-full grid-cols-2 gap-3 lg:w-auto lg:min-w-[520px] lg:grid-cols-5">
                    <div className="rounded-2xl border border-white/10 bg-black/40 px-3 py-3 backdrop-blur sm:px-4">
                      <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 sm:text-[11px] sm:tracking-[0.25em]">
                        Members
                      </div>
                      <div className="mt-2 text-xl font-semibold text-white sm:text-2xl">
                        {data.totalMembers}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/40 px-3 py-3 backdrop-blur sm:px-4">
                      <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 sm:text-[11px] sm:tracking-[0.25em]">
                        Active
                      </div>
                      <div className="mt-2 text-xl font-semibold text-white sm:text-2xl">
                        {data.activeMembers}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/40 px-3 py-3 backdrop-blur sm:px-4">
                      <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 sm:text-[11px] sm:tracking-[0.25em]">
                        This month
                      </div>
                      <div className="mt-2 text-xl font-semibold text-white sm:text-2xl">
                        {data.monthCheckIns}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/40 px-3 py-3 backdrop-blur sm:px-4">
                      <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 sm:text-[11px] sm:tracking-[0.25em]">
                        Attention
                      </div>
                      <div className="mt-2 text-xl font-semibold text-white sm:text-2xl">
                        {data.inactiveMembers.length}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/40 px-3 py-3 backdrop-blur sm:px-4">
                      <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 sm:text-[11px] sm:tracking-[0.25em]">
                        Pending
                      </div>
                      <div className="mt-2 text-xl font-semibold text-white sm:text-2xl">
                        {data.pendingApprovals.length}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            {loading ? (
              <div className="mt-6 rounded-3xl border border-white/10 bg-neutral-950 p-6 text-neutral-400 sm:mt-8">
                Loading insights...
              </div>
            ) : !data ? (
              <div className="mt-6 rounded-3xl border border-white/10 bg-neutral-950 p-6 text-neutral-400 sm:mt-8">
                No data available.
              </div>
            ) : (
              <>
                <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
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
                  <AdminKpiCard
                    label="Pending Approvals"
                    value={data.pendingApprovals.length}
                  />
                </div>

                <div className="mt-6 lg:mt-8">
                  <AdminSectionCard title="Invite New Member">
                    <form onSubmit={handleInviteSubmit} className="space-y-4">
                      <div className="max-w-xl">
                        <label className="mb-2 block text-sm font-medium text-neutral-300">
                          Email address
                        </label>
                        <div className="flex flex-col gap-3 sm:flex-row">
                          <input
                            type="email"
                            value={inviteEmail}
                            onChange={(e) => setInviteEmail(e.target.value)}
                            placeholder="newmember@example.com"
                            autoComplete="email"
                            inputMode="email"
                            required
                            className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none transition placeholder:text-neutral-500 focus:border-amber-400/40 focus:bg-white/[0.06]"
                          />
                          <button
                            type="submit"
                            disabled={inviteLoading}
                            className="rounded-2xl bg-[linear-gradient(135deg,#fde68a,#f59e0b)] px-5 py-3 font-semibold text-black transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70"
                          >
                            {inviteLoading ? "Sending..." : "Send invite"}
                          </button>
                        </div>
                      </div>

                      {inviteSuccess ? (
                        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                          {inviteSuccess}
                        </div>
                      ) : null}

                      {inviteError ? (
                        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                          {inviteError}
                        </div>
                      ) : null}

                      <p className="text-sm leading-6 text-neutral-400">
                        This sends a sign-up link to the new member so they can create
                        their own account before appearing in pending approvals.
                      </p>
                    </form>
                  </AdminSectionCard>
                </div>

                <div className="mt-6 lg:mt-8">
                  <AdminSectionCard title="Pending Sign-up Approvals">
                    {approvalError || roleActionError ? (
                      <div className="mb-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                        {approvalError ?? roleActionError}
                      </div>
                    ) : null}

                    {data.pendingApprovals.length === 0 ? (
                      <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/5 px-4 py-5 text-sm text-emerald-300">
                        No pending sign-up approvals right now.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {data.pendingApprovals.map((user) => {
                          const isApproving = approvingUserId === user.id;

                          return (
                            <div
                              key={user.id}
                              className="flex flex-col gap-4 rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                            >
                              <div className="flex min-w-0 items-center gap-3">
                                <UserAvatar
                                  name={user.name || "Pending member"}
                                  photoURL={user.photoURL}
                                  size={44}
                                />

                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium text-white sm:text-base">
                                    {user.name || "Unnamed member"}
                                  </div>
                                  <div className="truncate text-xs text-neutral-500 sm:text-sm">
                                    {user.email || "No email"}
                                  </div>
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() => handleApprove(user.id)}
                                disabled={isApproving}
                                className="inline-flex items-center justify-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {isApproving ? (
                                  <LoaderCircle className="h-4 w-4 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="h-4 w-4" />
                                )}
                                {isApproving ? "Approving..." : "Approve access"}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </AdminSectionCard>
                </div>

                <div className="mt-6 grid gap-6 lg:mt-8 lg:grid-cols-2 [&>*]:min-w-0">
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
                            className="group w-full overflow-hidden rounded-2xl border border-white/8 bg-white/[0.02] px-3 py-3 transition hover:border-white/15 hover:bg-white/[0.04] sm:px-4 sm:py-4"
                          >
                            <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                              <RankBadge index={index} />

                              <div className="relative shrink-0">
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

                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium text-white transition group-hover:text-amber-100 sm:text-base">
                                  {user.name || "Unnamed member"}
                                </div>
                                <div className="truncate text-xs text-neutral-500 sm:text-sm">
                                  {user.email || "No email"}
                                </div>
                              </div>

                              <div className="shrink-0 pl-1 text-right sm:pl-2">
                                <div className="text-base font-semibold text-white sm:text-lg">
                                  {user.stats?.monthCheckIns?.[data.monthKey] ?? 0}
                                </div>
                                <div className="text-[10px] uppercase tracking-[0.14em] text-neutral-500 sm:text-[11px] sm:tracking-[0.2em]">
                                  check-ins
                                </div>
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
                            className="group w-full overflow-hidden rounded-2xl border border-white/8 bg-white/[0.02] px-3 py-3 transition hover:border-amber-400/20 hover:bg-white/[0.04] sm:px-4 sm:py-4"
                          >
                            <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                              <div className="relative shrink-0">
                                <UserAvatar
                                  name={user.name || "Member"}
                                  photoURL={user.photoURL}
                                  size={44}
                                />
                                <div className="absolute -right-1 -top-1 rounded-full border border-red-500/25 bg-red-500/10 p-1 text-red-300">
                                  <ShieldAlert className="h-3 w-3" />
                                </div>
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium text-white transition group-hover:text-amber-100 sm:text-base">
                                  {user.name || "Unnamed member"}
                                </div>
                                <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-neutral-500 sm:text-sm">
                                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                  <span className="truncate">
                                    Last check-in: {user.stats?.lastCheckInDate || "Never"}
                                  </span>
                                </div>
                              </div>

                              <div className="hidden shrink-0 items-center gap-3 sm:flex">
                                <div
                                  className={`rounded-full border px-3 py-1 text-xs font-medium ${getAttentionBadge(
                                    user.stats?.lastCheckInDate
                                  )}`}
                                >
                                  Needs attention
                                </div>
                              </div>
                            </div>

                            <div className="mt-3 flex items-center justify-between gap-3 sm:hidden">
                              <div
                                className={`max-w-full rounded-full border px-3 py-1 text-[11px] font-medium ${getAttentionBadge(
                                  user.stats?.lastCheckInDate
                                )}`}
                              >
                                Needs attention
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </AdminSectionCard>
                </div>

                <div className="mt-6 lg:mt-8">
                  <AdminSectionCard title="Suspended Members">
                    <div className="mb-4 space-y-3">
                      <input
                        type="search"
                        value={memberSearch}
                        onChange={(e) => setMemberSearch(e.target.value)}
                        placeholder="Search members to assign SGPT or suspend..."
                        className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none transition placeholder:text-neutral-500 focus:border-red-400/40 focus:bg-white/[0.06]"
                      />

                      {normalizedSearch ? (
                        searchableMembers.length === 0 ? (
                          <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-4 text-sm text-neutral-400">
                            No matching active members found.
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {searchableMembers.slice(0, 6).map((user) => (
                              <div
                                key={user.id}
                                className="flex flex-col gap-4 rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                              >
                                <div className="flex min-w-0 items-center gap-3">
                                  <UserAvatar
                                    name={user.name || "Member"}
                                    photoURL={user.photoURL}
                                    size={44}
                                  />

                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-medium text-white sm:text-base">
                                      {user.name || "Unnamed member"}
                                    </div>
                                    <div className="truncate text-xs text-neutral-500 sm:text-sm">
                                      {user.email || "No email"}
                                    </div>
                                  </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleRoleChange(user.id, user.role === "sgpt" ? "user" : "sgpt")}
                                    disabled={roleBusyUserId === user.id}
                                    className="inline-flex items-center justify-center gap-2 rounded-full border border-sky-500/25 bg-sky-500/10 px-4 py-2 text-sm font-semibold text-sky-100 transition hover:bg-sky-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    {roleBusyUserId === user.id ? (
                                      <LoaderCircle className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Bot className="h-4 w-4" />
                                    )}
                                    {user.role === "sgpt" ? "Make member" : "Make SGPT"}
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => handleRoleChange(user.id, "banned")}
                                    disabled={roleBusyUserId === user.id}
                                    className="inline-flex items-center justify-center gap-2 rounded-full border border-red-500/25 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-100 transition hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    {roleBusyUserId === user.id ? (
                                      <LoaderCircle className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Ban className="h-4 w-4" />
                                    )}
                                    Ban 7 days
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )
                      ) : null}
                    </div>

                    {data.bannedMembers.length === 0 ? (
                      <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-5 text-sm text-neutral-400">
                        No suspended members right now.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {data.bannedMembers.map((user) => (
                          <div
                            key={user.id}
                            className="flex flex-col gap-4 rounded-2xl border border-red-500/15 bg-red-500/[0.04] px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <UserAvatar
                                name={user.name || "Suspended member"}
                                photoURL={user.photoURL}
                                size={44}
                              />

                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-white sm:text-base">
                                  {user.name || "Unnamed member"}
                                </div>
                                <div className="truncate text-xs text-neutral-500 sm:text-sm">
                                  {user.email || "No email"}
                                </div>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleRoleChange(user.id, "user")}
                              disabled={roleBusyUserId === user.id}
                              className="inline-flex items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {roleBusyUserId === user.id ? (
                                <LoaderCircle className="h-4 w-4 animate-spin" />
                              ) : (
                                <RotateCcw className="h-4 w-4" />
                              )}
                              Restore member
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </AdminSectionCard>
                </div>

                <div className="mt-6 grid gap-6 lg:mt-8 lg:grid-cols-[1.1fr_0.9fr] [&>*]:min-w-0">
                  <AdminSectionCard title="Attendance Signal">
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4 sm:p-5">
                        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-neutral-500 sm:text-[11px] sm:tracking-[0.28em]">
                          <Users className="h-4 w-4 shrink-0 text-sky-300" />
                          Total base
                        </div>
                        <div className="mt-3 text-2xl font-semibold text-white sm:text-3xl">
                          {data.totalMembers}
                        </div>
                        <p className="mt-2 text-sm text-neutral-400">
                          Current member count in the system.
                        </p>
                      </div>

                      <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4 sm:p-5">
                        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-neutral-500 sm:text-[11px] sm:tracking-[0.28em]">
                          <Activity className="h-4 w-4 shrink-0 text-emerald-300" />
                          Active
                        </div>
                        <div className="mt-3 text-2xl font-semibold text-white sm:text-3xl">
                          {data.activeMembers}
                        </div>
                        <p className="mt-2 text-sm text-neutral-400">
                          Checked in during the last 30 days.
                        </p>
                      </div>

                      <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4 sm:p-5">
                        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-neutral-500 sm:text-[11px] sm:tracking-[0.28em]">
                          <Flame className="h-4 w-4 shrink-0 text-red-300" />
                          Attention
                        </div>
                        <div className="mt-3 text-2xl font-semibold text-white sm:text-3xl">
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
                        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amber-200 sm:text-[11px] sm:tracking-[0.28em]">
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
                        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-neutral-500 sm:text-[11px] sm:tracking-[0.28em]">
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
