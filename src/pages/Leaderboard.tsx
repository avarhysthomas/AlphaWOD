import React, {useEffect, useMemo, useState} from "react";
import {getFunctions, httpsCallable} from "firebase/functions";
import {Crown, Medal, Star, Trophy, RefreshCw, Calendar} from "lucide-react";
import {useAuth} from "../context/AuthContext";
import {useNavigate} from "react-router-dom";
import { collection, documentId, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import UserAvatar from "../components/UserAvatar";

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

function monthKeyUTC(d: Date) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function addMonthsUTC(monthKey: string, delta: number) {
  const [yStr, mStr] = monthKey.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const base = new Date(Date.UTC(y, m - 1, 1));
  base.setUTCMonth(base.getUTCMonth() + delta);
  return monthKeyUTC(base);
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
  const navigate = useNavigate();
  const functions = useMemo(() => getFunctions(undefined, "europe-west1"), []);
  const getMonthlyLeaderboard = useMemo(
    () => httpsCallable<any, LeaderboardResponse>(functions, "getMonthlyLeaderboard"),
    [functions]
  );

  const [monthKey, setMonthKey] = useState(() => monthKeyUTC(new Date()));
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
      <div className="mx-auto w-full max-w-5xl px-4 py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.35em] text-white/60 font-semibold">
              {monthKey}
            </div>
            <h1 className="mt-2 text-4xl sm:text-6xl font-heading uppercase tracking-wide">
              Board of Fame
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <button
                onClick={()=> navigate("/schedule")}
                className="inline-flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-neutral-900"
                title="Schedule"
            >
                <Calendar className="h-4 w-4" />
                Schedule
            </button>

            <button
                className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm font-semibold text-white/80 hover:bg-neutral-900"
                onClick={() => setMonthKey((mk) => addMonthsUTC(mk, -1))}
            >
                ← Prev
            </button>

            <button
                className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm font-semibold text-white/80 hover:bg-neutral-900"
                onClick={() => setMonthKey(monthKeyUTC(new Date()))}
            >
                This month
            </button>

            <button
                className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm font-semibold text-white/80 hover:bg-neutral-900"
                onClick={() => setMonthKey((mk) => addMonthsUTC(mk, 1))}
            >
                Next →
            </button>

            <button
                className="inline-flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm font-semibold text-white/80 hover:bg-neutral-900 disabled:opacity-50"
                onClick={load}
                disabled={loading}
                title="Refresh"
            >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                {loading ? "Loading…" : "Refresh"}
            </button>

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
            {/* Mobile: stacked podium tiers (still 1 column, but visually tiered) */}
            <div className="md:hidden space-y-4">
            {/* #1 */}
            <div className="mx-0">
                <PodiumCard place={1} row={top1} isMe={Boolean(user?.uid && top1.userId === user.uid)} />
            </div>

            {/* #2 */}
            {top2 ? (
                <div className="mx-3">
                <PodiumCard place={2} row={top2} isMe={Boolean(user?.uid && top2.userId === user.uid)} />
                </div>
            ) : (
                <div className="mx-3 rounded-2xl border border-neutral-800 bg-neutral-950 p-6 text-white/40 flex items-center justify-center">
                No #2 yet
                </div>
            )}

            {/* #3 */}
            {top3 ? (
                <div className="mx-6">
                <PodiumCard place={3} row={top3} isMe={Boolean(user?.uid && top3.userId === user.uid)} />
                </div>
            ) : (
                <div className="mx-6 rounded-2xl border border-neutral-800 bg-neutral-950 p-6 text-white/40 flex items-center justify-center">
                No #3 yet
                </div>
            )}
            </div>

            {/* Desktop+: 2,1,3 */}
            <div className="hidden md:grid md:grid-cols-3 md:items-end gap-4">
                {top2 ? (
                <PodiumCard place={2} row={top2} isMe={Boolean(user?.uid && top2.userId === user.uid)} />
                ) : (
                <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-6 min-h-[200px] text-white/40 flex items-center justify-center">
                    No #2 yet
                </div>
                )}

                <div className="md:scale-[1.02] md:-translate-y-1">
                <PodiumCard place={1} row={top1} isMe={Boolean(user?.uid && top1.userId === user.uid)} />
                </div>

                {top3 ? (
                <PodiumCard place={3} row={top3} isMe={Boolean(user?.uid && top3.userId === user.uid)} />
                ) : (
                <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-6 min-h-[180px] text-white/40 flex items-center justify-center">
                    No #3 yet
                </div>
                )}
            </div>
            </>
        )}
        </div>

        {/* Everyone else */}
        <div className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-950 overflow-hidden">
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
                    className={`flex items-center justify-between px-4 py-3 ${
                      isMe ? "bg-neutral-900/40" : ""
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
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
                        <div className="truncate text-sm font-semibold text-white/90">
                          {r.name || "Member"} {isMe ? <span className="text-white/50">(you)</span> : null}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-baseline gap-2">
                      <div className="text-2xl font-extrabold tracking-tight">
                        {Number(r.attendedCount || 0)}
                      </div>
                      <div className="text-xs uppercase tracking-[0.35em] text-white/50 font-semibold">
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