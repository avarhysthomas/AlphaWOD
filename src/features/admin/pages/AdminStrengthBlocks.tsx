import React, { useEffect, useMemo, useState } from "react";
import { CalendarDays, Dumbbell, LoaderCircle, Search, Users } from "lucide-react";
import AdminOnly from "../../../components/guards/AdminOnly";
import AppBottomNav from "../../../components/layout/AppBottomNav";
import UserAvatar from "../../../components/ui/UserAvatar";
import AdminKpiCard from "../components/AdminKpiCard";
import AdminSectionCard from "../components/AdminSectionCard";
import { updateMemberStrengthBlock } from "../services/access";
import { getAdminUsers } from "../services/insights";
import type { AdminUser } from "../types";

type StrengthBlock = "A" | "B" | "none";

type BlockMember = AdminUser & {
  strengthBlock: StrengthBlock;
};

const BLOCK_META: Record<
  StrengthBlock,
  { title: string; subtitle: string; accent: string; pill: string }
> = {
  A: {
    title: "Block A",
    subtitle: "Tuesday 06:00 and Thursday 06:00",
    accent: "from-sky-500/20 via-sky-500/8 to-transparent",
    pill: "border-sky-500/25 bg-sky-500/10 text-sky-200",
  },
  B: {
    title: "Block B",
    subtitle: "Monday 18:00 and Wednesday 18:00",
    accent: "from-amber-500/20 via-amber-500/8 to-transparent",
    pill: "border-amber-500/25 bg-amber-500/10 text-amber-200",
  },
  none: {
    title: "Unassigned",
    subtitle: "No strength block access",
    accent: "from-white/10 via-white/[0.04] to-transparent",
    pill: "border-white/15 bg-white/[0.05] text-white/75",
  },
};

function normalizeStrengthBlock(value: unknown): StrengthBlock {
  return value === "A" || value === "B" ? value : "none";
}

function toManagedMember(user: AdminUser): BlockMember {
  return {
    ...user,
    strengthBlock: normalizeStrengthBlock(user.strengthBlock),
  };
}

function MemberCard({
  user,
  busy,
  onChange,
}: {
  user: BlockMember;
  busy: boolean;
  onChange: (userId: string, strengthBlock: StrengthBlock) => void;
}) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 transition hover:border-white/15 hover:bg-white/[0.05]">
      <div className="flex items-center gap-3">
        <UserAvatar name={user.name || "Member"} photoURL={user.photoURL} size={44} />

        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-white sm:text-base">
            {user.name || "Unnamed member"}
          </div>
          <div className="truncate text-xs text-white/30 sm:text-sm">
            {user.email || "No email"}
          </div>
        </div>

        <span
          className={[
            "rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]",
            BLOCK_META[user.strengthBlock].pill,
          ].join(" ")}
        >
          {user.strengthBlock === "none" ? "None" : `Block ${user.strengthBlock}`}
        </span>
      </div>

      <div className="mt-4">
        <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.22em] text-white/30">
          Strength block
        </label>
        <select
          value={user.strengthBlock}
          onChange={(e) => onChange(user.id, e.target.value as StrengthBlock)}
          disabled={busy}
          className="w-full rounded-2xl border border-white/8 bg-[#050505]/50 px-4 py-3 text-sm text-white outline-none transition focus:border-white/22"
        >
          <option value="none">No block access</option>
          <option value="A">Block A</option>
          <option value="B">Block B</option>
        </select>
      </div>

      {busy ? (
        <div className="mt-3 inline-flex items-center gap-2 text-xs text-amber-200">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          Updating block...
        </div>
      ) : null}
    </div>
  );
}

export default function AdminStrengthBlocks() {
  const [members, setMembers] = useState<BlockMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const users = await getAdminUsers();
        if (!alive) return;

        const managedMembers = users
          .filter((user) => user.role !== "banned")
          .filter((user) => user.approvalStatus !== "pending")
          .map(toManagedMember)
          .sort((a, b) => (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? ""));

        setMembers(managedMembers);
      } catch (err: any) {
        if (alive) setError(err?.message ?? "Failed to load strength blocks.");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const normalizedSearch = search.trim().toLowerCase();

  const filteredMembers = useMemo(() => {
    if (!normalizedSearch) return members;

    return members.filter((user) => {
      const haystack = `${user.name ?? ""} ${user.email ?? ""}`.toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [members, normalizedSearch]);

  const grouped = useMemo(() => {
    return {
      A: filteredMembers.filter((user) => user.strengthBlock === "A"),
      B: filteredMembers.filter((user) => user.strengthBlock === "B"),
      none: filteredMembers.filter((user) => user.strengthBlock === "none"),
    };
  }, [filteredMembers]);

  const totals = useMemo(() => {
    return {
      total: members.length,
      A: members.filter((user) => user.strengthBlock === "A").length,
      B: members.filter((user) => user.strengthBlock === "B").length,
      none: members.filter((user) => user.strengthBlock === "none").length,
    };
  }, [members]);

  async function handleStrengthBlockChange(userId: string, strengthBlock: StrengthBlock) {
    try {
      setBusyUserId(userId);
      setError(null);
      await updateMemberStrengthBlock(userId, strengthBlock);
      setMembers((current) =>
        current.map((user) => (user.id === userId ? { ...user, strengthBlock } : user))
      );
    } catch (err: any) {
      setError(err?.message ?? "Failed to update strength block.");
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <AdminOnly>
      <div className="carbon-fiber-bg min-h-screen overflow-x-hidden font-barlow text-[#f4f0ea]">

        <div className="px-3 pb-36 pt-5 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="relative overflow-hidden rounded-[24px] border border-white/8 bg-[#11100f] p-4 sm:rounded-[28px] sm:p-8">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_72%_0%,rgba(255,255,255,0.05),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.025),transparent_48%)]" />
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/18 to-transparent" />

              <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                <div className="max-w-2xl min-w-0">
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-white/58 sm:text-[11px] sm:tracking-[0.28em]">
                    <Dumbbell className="h-3.5 w-3.5" />
                    Strength Blocks
                  </div>

                  <h1 className="mt-4 text-[2.75rem] font-bold leading-none sm:text-6xl">
                    Strength Block Control
                  </h1>

                  <p className="mt-3 max-w-xl text-sm leading-6 text-white/42 sm:text-base">
                    Assign people to Block A or Block B, keep the split balanced,
                    and see who currently has no access to strength-block classes.
                  </p>
                </div>

                {!loading ? (
                  <div className="grid w-full grid-cols-2 gap-3 lg:w-auto lg:min-w-[420px] lg:grid-cols-4">
                    <AdminKpiCard label="Assigned People" value={totals.total} />
                    <AdminKpiCard label="Block A" value={totals.A} sublabel={BLOCK_META.A.subtitle} />
                    <AdminKpiCard label="Block B" value={totals.B} sublabel={BLOCK_META.B.subtitle} />
                    <AdminKpiCard label="Unassigned" value={totals.none} sublabel="No strength access" />
                  </div>
                ) : null}
              </div>
            </div>

            {error ? (
              <div className="mt-6 rounded-[22px] border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200 sm:mt-8">
                {error}
              </div>
            ) : null}

            {loading ? (
              <div className="mt-6 rounded-[22px] border border-white/8 bg-[#11100f] p-6 text-white/42 sm:mt-8">
                Loading strength blocks...
              </div>
            ) : (
              <>
                <div className="mt-6 grid gap-6 lg:mt-8 lg:grid-cols-[1.2fr_0.8fr]">
                  <AdminSectionCard title="Strength Block Rules">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="rounded-2xl border border-sky-500/20 bg-sky-500/10 p-4">
                        <div className="inline-flex items-center gap-2 text-sm font-semibold text-sky-100">
                          <CalendarDays className="h-4 w-4" />
                          Block A
                        </div>
                        <p className="mt-2 text-sm leading-6 text-sky-100/85">
                          Members in Block A can book Tuesday 6am and Thursday 6am strength classes.
                        </p>
                      </div>

                      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                        <div className="inline-flex items-center gap-2 text-sm font-semibold text-amber-100">
                          <CalendarDays className="h-4 w-4" />
                          Block B
                        </div>
                        <p className="mt-2 text-sm leading-6 text-amber-100/85">
                          Members in Block B can book Monday 6pm and Wednesday 6pm strength classes.
                        </p>
                      </div>
                    </div>
                  </AdminSectionCard>

                  <AdminSectionCard title="Member Search">
                    <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.22em] text-white/30">
                      Find a member
                    </label>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
                      <input
                        type="search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by name or email"
                        className="w-full rounded-2xl border border-white/8 bg-white/[0.035] py-3 pl-11 pr-4 text-white outline-none transition placeholder:text-white/30 focus:border-white/22 focus:bg-white/[0.06]"
                      />
                    </div>

                    <div className="mt-4 rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-sm text-white/42">
                      Showing {filteredMembers.length} of {members.length} managed members.
                    </div>
                  </AdminSectionCard>
                </div>

                <div className="mt-6 grid gap-6 xl:grid-cols-3">
                  {(["A", "B", "none"] as StrengthBlock[]).map((blockKey) => (
                    <AdminSectionCard key={blockKey} title={BLOCK_META[blockKey].title}>
                      <div
                        className={`rounded-2xl border border-white/8 bg-gradient-to-br ${BLOCK_META[blockKey].accent} p-4`}
                      >
                        <div className="inline-flex items-center gap-2 text-sm font-semibold text-white">
                          <Users className="h-4 w-4" />
                          {grouped[blockKey].length} member{grouped[blockKey].length === 1 ? "" : "s"}
                        </div>
                        <div className="mt-2 text-sm text-white/58">
                          {BLOCK_META[blockKey].subtitle}
                        </div>
                      </div>

                      <div className="mt-4 space-y-3">
                        {grouped[blockKey].length === 0 ? (
                          <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-5 text-sm text-white/42">
                            No members in this group for the current filter.
                          </div>
                        ) : (
                          grouped[blockKey].map((user) => (
                            <MemberCard
                              key={user.id}
                              user={user}
                              busy={busyUserId === user.id}
                              onChange={handleStrengthBlockChange}
                            />
                          ))
                        )}
                      </div>
                    </AdminSectionCard>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
        <AppBottomNav />
      </div>
    </AdminOnly>
  );
}
