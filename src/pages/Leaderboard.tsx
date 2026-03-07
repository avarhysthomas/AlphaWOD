import React, {useEffect, useMemo, useState} from "react";
import {getFunctions, httpsCallable} from "firebase/functions";
import {Crown, Medal, Star, Trophy, RefreshCw} from "lucide-react";
import {useAuth} from "../context/AuthContext";
import { collection, documentId, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import UserAvatar from "../components/UserAvatar";
import UserTopNav from "../components/UserTopNav";

type LeaderboardRow = {
  userId: string;
  name: string;
  email?: string;
  photoURL?: string;
  attendedCount: number;
  updatedAt?: any;
};

type LeaderboardResponse = {
  monthKey: string; // "YYYY-MM"
  total: number;
  rows: LeaderboardRow[];
};

function monthKeyUK(d: Date) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
  });

  const parts = fmt.formatToParts(d);
  const year = parts.find((p) => p.type === "year")?.value ?? "0000";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${year}-${month}`;
}

function addMonthsUK(monthKey: string, delta: number) {
  const [yStr, mStr] = monthKey.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const base = new Date(Date.UTC(y, m - 1 + delta, 1));
  return monthKeyUK(base);
}

type UserProfile = {
  name?: string;
  photoURL?: string;
};

async function fetchUserProfiles(uids: string[]) {
  const map = new Map<string, UserProfile>();
  const unique = Array.from(new Set(uids.filter(Boolean)));
  if (!unique.length) return map;

  // Firestore "in" query limit is 10
  for (let i = 0; i < unique.length; i += 10) {
    const chunk = unique.slice(i, i + 10);
    const q = query(collection(db, "users"), where(documentId(), "in", chunk));
    const snap = await getDocs(q);
    snap.forEach((d) => map.set(d.id, d.data() as UserProfile));
  }

  return map;
}

function getAttendanceBadge(count: number) {
  if (count >= 16) {
    return {
      label: "Gold",
      shortLabel: "GOLD",
      classesText: "16+ classes",
      tier: "gold" as const,
    };
  }

  if (count >= 12) {
    return {
      label: "Silver",
      shortLabel: "SILVER",
      classesText: "12+ classes",
      tier: "silver" as const,
    };
  }

  if (count >= 8) {
    return {
      label: "Bronze",
      shortLabel: "BRONZE",
      classesText: "8+ classes",
      tier: "bronze" as const,
    };
  }

  if (count >= 4) {
    return {
      label: "Starter",
      shortLabel: "STARTER",
      classesText: "4+ classes",
      tier: "starter" as const,
    };
  }

  return null;
}

function AttendanceBadge({ count }: { count: number }) {
  const badge = getAttendanceBadge(count);
  if (!badge) return null;

  const styles =
    badge.tier === "gold"
      ? {
          outer:
            "border-yellow-500/30 bg-[linear-gradient(180deg,rgba(234,179,8,0.16),rgba(234,179,8,0.06))] text-yellow-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_22px_rgba(234,179,8,0.10)]",
          inner: "bg-yellow-200/10",
          dot: "bg-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.65)]",
          micro: "text-yellow-100/60",
        }
      : badge.tier === "silver"
      ? {
          outer:
            "border-zinc-300/20 bg-[linear-gradient(180deg,rgba(212,212,216,0.14),rgba(212,212,216,0.05))] text-zinc-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_20px_rgba(212,212,216,0.08)]",
          inner: "bg-zinc-100/10",
          dot: "bg-zinc-300 shadow-[0_0_10px_rgba(212,212,216,0.5)]",
          micro: "text-zinc-100/55",
        }
      : badge.tier === "bronze"
      ? {
          outer:
            "border-amber-700/30 bg-[linear-gradient(180deg,rgba(180,83,9,0.16),rgba(180,83,9,0.05))] text-amber-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_20px_rgba(180,83,9,0.10)]",
          inner: "bg-amber-200/10",
          dot: "bg-amber-600 shadow-[0_0_10px_rgba(217,119,6,0.55)]",
          micro: "text-amber-100/55",
        }
      : {
          outer:
            "border-emerald-500/25 bg-[linear-gradient(180deg,rgba(16,185,129,0.16),rgba(16,185,129,0.05))] text-emerald-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_20px_rgba(16,185,129,0.10)]",
          inner: "bg-emerald-100/10",
          dot: "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.55)]",
          micro: "text-emerald-100/55",
        };

  return (
    <div
      className={[
        "relative inline-flex items-center overflow-hidden rounded-xl border px-2.5 py-1.5",
        "backdrop-blur-sm",
        styles.outer,
      ].join(" ")}
      title={`${badge.label} badge — ${badge.classesText}`}
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.07),transparent_45%)]" />
      <div className="relative flex items-center gap-2">
        <div className={`rounded-md p-1 ${styles.inner}`}>
          <span className={`block h-2 w-2 rounded-full ${styles.dot}`} />
        </div>

        <div className="leading-none">
          <div className="text-[9px] font-black tracking-[0.28em]">
            {badge.shortLabel}
          </div>
          <div className={`mt-0.5 text-[8px] uppercase tracking-[0.22em] ${styles.micro}`}>
            attendance
          </div>
        </div>
      </div>
    </div>
  );
}

function PodiumCard({
  place,
  row,
  isMe,
}:{
  place: 1|2|3;
  row: LeaderboardRow;
  isMe: boolean;
}) {
  const label = place === 1 ? "CHAMPION" : place === 2 ? "RUNNER UP" : "THIRD";
  const icon =
    place === 1 ? <Trophy className="h-5 w-5" /> :
    place === 2 ? <Medal className="h-5 w-5" /> :
    <Star className="h-5 w-5" />;

  const height =
    place === 1 ? "min-h-[230px]" :
    place === 2 ? "min-h-[200px]" :
    "min-h-[180px]";

  // Medal glow flavours (Tailwind-only, no custom colors needed)
  const glow =
    place === 1 ? "shadow-[0_0_40px_rgba(255,215,0,0.18)] border-white/15" :
    place === 2 ? "shadow-[0_0_35px_rgba(192,192,192,0.14)] border-white/12" :
    "shadow-[0_0_35px_rgba(205,127,50,0.14)] border-white/12";

  const badge = getAttendanceBadge(Number(row.attendedCount || 0));  

  const ring =
    place === 1 ? "bg-[radial-gradient(circle_at_center,rgba(255,215,0,0.18),transparent_65%)]" :
    place === 2 ? "bg-[radial-gradient(circle_at_center,rgba(192,192,192,0.16),transparent_65%)]" :
    "bg-[radial-gradient(circle_at_center,rgba(205,127,50,0.16),transparent_65%)]";

  const spotlight =
    place === 1
      ? "bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.10),transparent_55%)]"
      : "bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_60%)]";

  return (
    <div className={`rounded-2xl border bg-neutral-950 p-5 ${height} relative overflow-hidden ${glow}`}>
      {/* Spotlight wash */}
      <div className={`pointer-events-none absolute inset-0 ${spotlight}`} />

      {/* Medal glow ring */}
      <div className={`pointer-events-none absolute -inset-8 ${ring} blur-2xl`} />

      {/* Subtle top shine line */}
      <div className="pointer-events-none absolute left-0 right-0 top-0 h-px bg-white/10" />

      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.35em] text-white/60 font-semibold">
          <span className="inline-flex items-center gap-2">
            {icon}
            {label}
          </span>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 px-3 py-1 text-xs font-extrabold tracking-widest text-white/80">
          #{place}
        </div>
      </div>

      <div className="relative mt-4 flex items-center gap-3">
        <UserAvatar name={row.name || "Member"} photoURL={row.photoURL} size={48} />    
        <div className="min-w-0">
          <div className="truncate text-lg font-extrabold text-white/90">
            {row.name || "Member"} {isMe ? <span className="text-white/50">(you)</span> : null}
          </div>
        </div>
      </div>

      <div className="relative mt-6 flex items-baseline gap-3">
        <div className="text-5xl font-extrabold tracking-tight text-white">
          {Number(row.attendedCount || 0)}
        </div>
        <div className="text-xs uppercase tracking-[0.35em] text-white/50 font-semibold">
          classes
        </div>
      </div>

      {badge ? (
        <div className="relative mt-3">
          <AttendanceBadge count={Number(row.attendedCount || 0)} />
        </div>
      ) : null}

      {/* Little "plate" at the bottom */}
      <div className="relative mt-6 rounded-xl border border-neutral-800 bg-neutral-900/30 px-3 py-2 text-xs font-semibold text-white/70">
        Board of Fame — {place === 1 ? "Gold" : place === 2 ? "Silver" : "Bronze"}
      </div>

      {isMe ? (
        <div className="relative mt-3 inline-flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-xs font-semibold text-white/70">
          <Crown className="h-4 w-4" />
          Featured on the Board of Fame
        </div>
      ) : null}
    </div>
  );
}

export default function Leaderboard() {
  const {user} = useAuth();
  const functions = useMemo(() => getFunctions(undefined, "europe-west1"), []);
  const getMonthlyLeaderboard = useMemo(
    () => httpsCallable<any, LeaderboardResponse>(functions, "getMonthlyLeaderboard"),
    [functions]
  );

  const [monthKey, setMonthKey] = useState(() => monthKeyUK(new Date()));
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
  setLoading(true);
  setErr(null);

  try {
    const res = await getMonthlyLeaderboard({ monthKey, limit: 200 });
    const baseRows: LeaderboardRow[] = res.data?.rows || [];

    // Pull profiles for everyone on this leaderboard
    const uids = baseRows.map((r) => r.userId);
    const profiles = await fetchUserProfiles(uids);

    const merged = baseRows.map((r) => {
      const p = profiles.get(r.userId);

      return {
        ...r,
        // Your Firestore uses `name`, so prefer that
        name: p?.name ?? r.name ?? "Member",
        photoURL: p?.photoURL ?? r.photoURL,
      };
    });

    setRows(merged);
  } catch (e: any) {
    console.error(e);
    setErr(e?.message || "Failed to load leaderboard");
  } finally {
    setLoading(false);
  }
}

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthKey]);

  const top1 = rows[0];
  const top2 = rows[1];
  const top3 = rows[2];

return (
  <div className="min-h-screen bg-black text-white">
    <UserTopNav />

    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-[28px] border border-neutral-800 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.025),transparent_35%),linear-gradient(180deg,rgba(15,15,15,0.97),rgba(0,0,0,0.98))] px-6 py-6 sm:px-8 sm:py-8 shadow-[0_0_50px_rgba(0,0,0,0.45)]">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent_60%)]" />
        <div className="pointer-events-none absolute -top-16 left-1/3 h-56 w-56 rounded-full bg-white/[0.015] blur-3xl" />

        <div className="relative flex flex-col gap-8 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.35em] text-white/60">
              <span className="h-2 w-2 rounded-full bg-white/50" />
              {monthKey}
            </div>

            <h1 className="mt-4 text-5xl leading-none sm:text-7xl xl:text-8xl font-heading uppercase tracking-[0.04em] text-white">
              Board of Fame
            </h1>

            <div className="mt-4 flex flex-wrap gap-2">
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[11px] font-extrabold uppercase tracking-[0.22em] text-emerald-100">
                Starter <span className="text-emerald-100/60">4+</span>
              </div>
              <div className="rounded-xl border border-amber-700/25 bg-amber-700/10 px-3 py-2 text-[11px] font-extrabold uppercase tracking-[0.22em] text-amber-100">
                Bronze <span className="text-amber-100/60">8+</span>
              </div>
              <div className="rounded-xl border border-zinc-300/15 bg-zinc-200/10 px-3 py-2 text-[11px] font-extrabold uppercase tracking-[0.22em] text-zinc-100">
                Silver <span className="text-zinc-100/60">12+</span>
              </div>
              <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/10 px-3 py-2 text-[11px] font-extrabold uppercase tracking-[0.22em] text-yellow-100">
                Gold <span className="text-yellow-100/60">16+</span>
              </div>
            </div>

            <div className="mt-4 max-w-2xl text-sm sm:text-base text-white/45">
              Monthly attendance rankings for Zero Alpha members.
            </div>
          </div>

          <div className="flex flex-col gap-3 xl:items-end">
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
              <button
                className="rounded-2xl border border-neutral-700 bg-neutral-950/80 px-4 py-3 text-sm font-semibold text-white/80 transition hover:bg-neutral-900"
                onClick={() => setMonthKey((mk) => addMonthsUK(mk, -1))}
              >
                ← Prev
              </button>

              <button
                className="rounded-2xl border border-neutral-700 bg-neutral-950/80 px-4 py-3 text-sm font-semibold text-white/80 transition hover:bg-neutral-900"
                onClick={() => setMonthKey(monthKeyUK(new Date()))}
              >
                This month
              </button>

              <button
                className="rounded-2xl border border-neutral-700 bg-neutral-950/80 px-4 py-3 text-sm font-semibold text-white/80 transition hover:bg-neutral-900"
                onClick={() => setMonthKey((mk) => addMonthsUK(mk, 1))}
              >
                Next →
              </button>
            </div>

            <button
              className="inline-flex items-center justify-center gap-2 self-start rounded-2xl border border-neutral-700 bg-neutral-950/80 px-4 py-3 text-sm font-semibold text-white/80 transition hover:bg-neutral-900 disabled:opacity-50 xl:self-end"
              onClick={load}
              disabled={loading}
              title="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>
      </div>

      {/* Podium */}
      <div className="mt-8">
        <div className="mb-3 text-sm font-semibold text-white/80">Podium</div>

        {!top1 ? (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-6 text-sm text-white/60">
            No check-ins yet for this month.
          </div>
        ) : (
          <>
            {/* Mobile */}
            <div className="space-y-4 md:hidden">
              <div className="mx-0">
                <PodiumCard place={1} row={top1} isMe={Boolean(user?.uid && top1.userId === user.uid)} />
              </div>

              {top2 ? (
                <div className="mx-3">
                  <PodiumCard place={2} row={top2} isMe={Boolean(user?.uid && top2.userId === user.uid)} />
                </div>
              ) : (
                <div className="mx-3 flex items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 p-6 text-white/40">
                  No #2 yet
                </div>
              )}

              {top3 ? (
                <div className="mx-6">
                  <PodiumCard place={3} row={top3} isMe={Boolean(user?.uid && top3.userId === user.uid)} />
                </div>
              ) : (
                <div className="mx-6 flex items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 p-6 text-white/40">
                  No #3 yet
                </div>
              )}
            </div>

            {/* Desktop */}
            <div className="hidden gap-4 md:grid md:grid-cols-3 md:items-end">
              {top2 ? (
                <PodiumCard place={2} row={top2} isMe={Boolean(user?.uid && top2.userId === user.uid)} />
              ) : (
                <div className="flex min-h-[200px] items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 p-6 text-white/40">
                  No #2 yet
                </div>
              )}

              <div className="md:scale-[1.02] md:-translate-y-1">
                <PodiumCard place={1} row={top1} isMe={Boolean(user?.uid && top1.userId === user.uid)} />
              </div>

              {top3 ? (
                <PodiumCard place={3} row={top3} isMe={Boolean(user?.uid && top3.userId === user.uid)} />
              ) : (
                <div className="flex min-h-[180px] items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 p-6 text-white/40">
                  No #3 yet
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Full rankings */}
      <div className="mt-10 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950">
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <div className="text-sm font-semibold text-white/80">Full rankings</div>
          {err ? <div className="text-sm text-red-300">{err}</div> : null}
        </div>

        {!err && !loading && rows.length === 0 && (
          <div className="px-4 py-6 text-sm text-white/60">No members yet.</div>
        )}

        {rows.length > 0 && (
          <div className="divide-y divide-neutral-800">
            {rows.map((r, idx) => {
              const isMe = Boolean(user?.uid && r.userId === user.uid);
              const rank = idx + 1;

              return (
                <div
                  key={r.userId}
                  className={`flex items-center justify-between px-4 py-3 ${isMe ? "bg-neutral-900/40" : ""}`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="w-12 text-center text-sm font-extrabold text-white/80">
                      #{rank}
                    </div>

                    <div className="shrink-0">
                      <UserAvatar
                        name={r.name || "Member"}
                        photoURL={r.photoURL}
                        size={40}
                      />
                    </div>

                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <div className="truncate text-sm font-semibold text-white/90">
                          {r.name || "Member"} {isMe ? <span className="text-white/50">(you)</span> : null}
                        </div>

                        <div className="shrink-0">
                          <AttendanceBadge count={Number(r.attendedCount || 0)} />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-baseline gap-2">
                    <div className="text-2xl font-extrabold tracking-tight">
                      {Number(r.attendedCount || 0)}
                    </div>
                    <div className="text-xs font-semibold uppercase tracking-[0.35em] text-white/50">
                      classes
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  </div>
);
}

export {};