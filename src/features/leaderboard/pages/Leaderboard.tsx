import React, {useEffect, useMemo, useState} from "react";
import {getFunctions, httpsCallable} from "firebase/functions";
import {Bell, ChevronLeft, ChevronRight, RefreshCw} from "lucide-react";
import {useAuth} from "../../../context/AuthContext";
import { collection, documentId, getDocs, query, where } from "firebase/firestore";
import { db } from "../../../firebase";
import UserAvatar from "../../../components/ui/UserAvatar";
import { Link, NavLink } from "react-router-dom";
import { getUserNavItems } from "../../../components/layout/UserTopNav";

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

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  });
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
      ? "bg-yellow-300 text-black"
      : badge.tier === "silver"
      ? "bg-zinc-200 text-black"
      : badge.tier === "bronze"
      ? "bg-[#8b6748] text-white"
      : "bg-emerald-300 text-black";

  return (
    <span
      className={`inline-flex rounded-md px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${styles}`}
      title={`${badge.label} badge — ${badge.classesText}`}
    >
      {badge.shortLabel}
    </span>
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
  return (
    <div
      className={[
        "relative flex min-h-[168px] flex-col items-center justify-end overflow-hidden rounded-[22px] border bg-[#151311] px-4 py-5 text-center",
        place === 1
          ? "min-h-[220px] border-yellow-400/30 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(21,19,17,1))]"
          : "border-white/10",
      ].join(" ")}
    >
      <div className="absolute top-5 rounded-full bg-white/[0.08] px-3 py-1 text-[11px] font-black tracking-[0.12em] text-white/52">
        # {place}
      </div>
      <div className="mb-3 rounded-full border border-[#8b725b]/70 bg-[#66503f] p-1">
        <UserAvatar name={row.name || "Member"} photoURL={row.photoURL} size={place === 1 ? 64 : 58} />
      </div>
      <div className="min-w-0 max-w-full truncate text-base font-bold text-white">
        {row.name || "Member"} {isMe ? <span className="text-white/45">(you)</span> : null}
      </div>
      <div className="mt-3 font-mono text-5xl font-bold leading-none text-white">
          {Number(row.attendedCount || 0)}
      </div>
      <div className="mt-2 text-[11px] font-bold uppercase tracking-[0.24em] text-white/34">
        Classes
      </div>
    </div>
  );
}

export default function Leaderboard() {
  const {user, appUser} = useAuth();
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
  const myIndex = user?.uid ? rows.findIndex((row) => row.userId === user.uid) : -1;
  const myRow = myIndex >= 0 ? rows[myIndex] : null;
  const myCount = Number(myRow?.attendedCount || 0);
  const myBadge = getAttendanceBadge(myCount);
  const nextTarget = myCount < 4 ? 4 : myCount < 8 ? 8 : myCount < 12 ? 12 : myCount < 16 ? 16 : myCount;
  const tierFloor = myCount < 4 ? 0 : myCount < 8 ? 4 : myCount < 12 ? 8 : myCount < 16 ? 12 : 16;
  const nextTierLabel = myCount < 4 ? "Starter" : myCount < 8 ? "Bronze" : myCount < 12 ? "Silver" : myCount < 16 ? "Gold" : "Gold";
  const progressPct = nextTarget > tierFloor ? Math.min(100, Math.round(((myCount - tierFloor) / (nextTarget - tierFloor)) * 100)) : 100;
  const navItems = getUserNavItems(appUser?.role);
  const firstName = appUser?.name?.split(" ")[0] || appUser?.email?.split("@")[0] || "A";
  const profilePhotoURL = appUser?.photoURL || user?.photoURL || "";

return (
  <div className="carbon-fiber-bg min-h-screen overflow-x-hidden text-[#f4f0ea]">
    <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_right,rgba(120,95,70,0.16),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.025),transparent_22%)]" />
    <main className="relative mx-auto min-h-screen max-w-xl px-5 pb-36 pt-7 sm:max-w-3xl sm:px-8">
      <header className="flex items-center justify-between" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <Link to="/dashboard" aria-label="Zero Alpha home" className="block">
          <img src="/ZERO-ALPHA.png" alt="ZERO-ALPHA" className="h-20 w-auto object-contain" />
        </Link>
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Notifications"
            className="grid h-12 w-12 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white/55 transition hover:bg-white/[0.08] hover:text-white"
          >
            <Bell className="h-5 w-5" />
          </button>
          <Link
            to="/profile"
            aria-label="Profile"
            className="grid h-12 w-12 overflow-hidden rounded-full border border-[#8b725b]/60 bg-[#765f4b] text-sm font-bold uppercase text-[#f8efe5]"
          >
            {profilePhotoURL ? (
              <img
                src={profilePhotoURL}
                alt={appUser?.name ? `${appUser.name}'s profile` : "Profile"}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="grid h-full w-full place-items-center">{firstName.slice(0, 1)}</span>
            )}
          </Link>
        </div>
      </header>

      <section className="mt-12">
        <h1 className="mt-4 font-heading text-[3.6rem] uppercase leading-none text-white sm:text-[6rem]">
              Board of Fame
        </h1>

        <div className="mt-7 flex w-fit items-center overflow-hidden rounded-full border border-white/10 bg-[#151311] p-1">
          <button
            className="grid h-10 w-10 place-items-center rounded-full bg-white/[0.04] text-white/45 transition hover:text-white"
            onClick={() => setMonthKey((mk) => addMonthsUK(mk, -1))}
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            className="min-w-[150px] px-4 text-sm font-bold text-white"
            onClick={() => setMonthKey(monthKeyUK(new Date()))}
          >
            • {formatMonthLabel(monthKey)}
          </button>
          <button
            className="grid h-10 w-10 place-items-center rounded-full text-white/30 transition hover:bg-white/[0.04] hover:text-white"
            onClick={() => setMonthKey((mk) => addMonthsUK(mk, 1))}
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </section>

      <section className="mt-7 overflow-hidden rounded-[28px] border border-white/10 bg-[#151311] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
        <div className="grid grid-cols-[64px_1fr_auto] items-center gap-4">
          <div className="rounded-full border-2 border-[#f2eee8] bg-[#765f4b] p-1">
            <UserAvatar name={myRow?.name || appUser?.name || "Member"} photoURL={myRow?.photoURL || profilePhotoURL} size={52} />
          </div>
          <div className="min-w-0">
            <p className="text-[12px] font-bold uppercase tracking-[0.28em] text-white/34">
              Your rank
            </p>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-mono text-4xl font-bold leading-none text-white">
                {myIndex >= 0 ? `#${myIndex + 1}` : "—"}
              </span>
              {myRow ? (
                <span className="font-mono text-sm text-emerald-300">
                  ▲ {myCount} this month
                </span>
              ) : null}
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-4xl font-bold leading-none text-white">{myCount}</div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/34">Classes</div>
          </div>
        </div>
        <div className="mt-5 flex items-center justify-between gap-3 text-[12px] font-bold uppercase tracking-[0.18em] text-white/40">
          <span>{myBadge?.label || "Unranked"} · {myCount}/{nextTarget || myCount}</span>
          <span>{Math.max(0, nextTarget - myCount)} more to {nextTierLabel}</span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-[#f2eee8]" style={{ width: `${progressPct}%` }} />
        </div>
      </section>

      <section className="mt-10">
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 className="text-[12px] font-bold uppercase tracking-[0.32em] text-white/54">Podium</h2>
          <button
            className="inline-flex items-center gap-2 rounded-full text-sm font-bold text-white/42 transition hover:text-white disabled:opacity-45"
            onClick={load}
            disabled={loading}
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {!top1 ? (
          <div className="rounded-[28px] border border-white/10 bg-[#151311] p-6 text-sm font-medium text-white/44">
            No check-ins yet for this month.
          </div>
        ) : (
          <div className="grid grid-cols-3 items-end gap-3">
              {top2 ? (
              <PodiumCard place={2} row={top2} isMe={Boolean(user?.uid && top2.userId === user.uid)} />
              ) : (
              <div className="flex min-h-[168px] items-center justify-center rounded-[22px] border border-white/10 bg-[#151311] p-4 text-center text-sm font-bold text-white/30">
                  No #2 yet
                </div>
              )}

            <PodiumCard place={1} row={top1} isMe={Boolean(user?.uid && top1.userId === user.uid)} />

              {top3 ? (
              <PodiumCard place={3} row={top3} isMe={Boolean(user?.uid && top3.userId === user.uid)} />
              ) : (
              <div className="flex min-h-[168px] items-center justify-center rounded-[22px] border border-white/10 bg-[#151311] p-4 text-center text-sm font-bold text-white/30">
                  No #3 yet
                </div>
              )}
            </div>
        )}
      </section>

      <section className="mt-10">
        <div className="mb-4 flex items-end justify-between gap-4">
          <h2 className="text-[12px] font-bold uppercase tracking-[0.32em] text-white/54">Full rankings</h2>
          <span className="text-sm font-bold text-white/40">{rows.length} members</span>
        </div>
        {err ? <div className="mb-4 rounded-[18px] border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">{err}</div> : null}

        {!err && !loading && rows.length === 0 && (
          <div className="rounded-[28px] border border-white/10 bg-[#151311] p-6 text-sm font-medium text-white/44">No members yet.</div>
        )}

        {rows.length > 0 && (
          <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#151311] shadow-[0_24px_60px_rgba(0,0,0,0.28)]">
            {rows.map((r, idx) => {
              const isMe = Boolean(user?.uid && r.userId === user.uid);
              const rank = idx + 1;

              return (
                <div
                  key={r.userId}
                  className={[
                    "grid grid-cols-[44px_1fr_auto] items-center gap-3 border-b border-white/10 px-4 py-4 last:border-b-0",
                    isMe ? "bg-white/[0.035]" : "",
                  ].join(" ")}
                >
                  <div className="text-center font-mono text-base font-bold text-white">
                    {rank}
                  </div>
                  <div className="flex min-w-0 items-center gap-3">
                    <UserAvatar name={r.name || "Member"} photoURL={r.photoURL} size={44} />
                    <div className="min-w-0">
                      <div className="truncate text-base font-bold text-white">
                        {r.name || "Member"} {isMe ? <span className="text-white/45">(you)</span> : null}
                      </div>
                      <div className="mt-1">
                        <AttendanceBadge count={Number(r.attendedCount || 0)} />
                      </div>
                    </div>
                  </div>
                  <div className="font-mono text-2xl font-bold text-white">
                    {Number(r.attendedCount || 0)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>

    <nav
      className="fixed inset-x-4 bottom-4 z-40 mx-auto max-w-xl rounded-[28px] border border-white/45 bg-white/90 px-3 py-3 shadow-[0_18px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:max-w-2xl"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      aria-label="Primary"
    >
      <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {navItems.map(({ to, label, icon: NavIcon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
                [
                  "flex min-w-[76px] shrink-0 flex-col items-center gap-1.5 rounded-2xl px-2 py-2 text-[11px] font-bold transition",
                  isActive ? "bg-black/10 text-black" : "text-black hover:bg-black/5",
                ].join(" ")
              }
            >
            <NavIcon className="h-5 w-5 text-black" />
            <span className="max-w-full truncate">{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  </div>
);
}

export {};
