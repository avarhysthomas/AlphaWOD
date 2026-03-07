import React, { useEffect, useMemo, useState } from "react";
import { getFunctions, httpsCallable } from "firebase/functions";
import { AlertTriangle, RefreshCw, Flame } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { collection, documentId, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import UserAvatar from "../components/UserAvatar";
import UserTopNav from "../components/UserTopNav";

type DipRow = {
  userId: string;
  name: string;
  email?: string;
  photoURL?: string;
  dipCount: number;
};

type DipLeaderboardResponse = {
  monthKey: string;
  total: number;
  rows: DipRow[];
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

  for (let i = 0; i < unique.length; i += 10) {
    const chunk = unique.slice(i, i + 10);
    const q = query(collection(db, "users"), where(documentId(), "in", chunk));
    const snap = await getDocs(q);
    snap.forEach((d) => map.set(d.id, d.data() as UserProfile));
  }

  return map;
}

export default function DipLeaderboard() {
  const { user } = useAuth();
  const functions = useMemo(() => getFunctions(undefined, "europe-west1"), []);
  const getMonthlyDipLeaderboard = useMemo(
    () => httpsCallable<any, DipLeaderboardResponse>(functions, "getMonthlyDipLeaderboard"),
    [functions]
  );
  

  const [monthKey, setMonthKey] = useState(() => monthKeyUK(new Date()));
  const [rows, setRows] = useState<DipRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);

    try {
      const res = await getMonthlyDipLeaderboard({ monthKey, limit: 200 });
      const baseRows: DipRow[] = res.data?.rows || [];

      const uids = baseRows.map((r) => r.userId);
      const profiles = await fetchUserProfiles(uids);

      const merged = baseRows.map((r) => {
        const p = profiles.get(r.userId);
        return {
          ...r,
          name: p?.name ?? r.name ?? "Member",
          photoURL: p?.photoURL ?? r.photoURL,
        };
      });

      setRows(merged);
    } catch (e: any) {
      console.error(e);
      setErr(e?.message || "Failed to load Board of Shame");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
  load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [monthKey]);

  const top3 = rows.filter((r) => r.dipCount > 0).slice(0, 3);

  return (
    <div className="min-h-screen bg-black text-white">
    <UserTopNav />
      <div className="mx-auto w-full max-w-5xl px-4 py-10">
        <div className="relative overflow-hidden rounded-[28px] border border-red-950/40 bg-[radial-gradient(circle_at_top_left,rgba(239,68,68,0.10),transparent_30%),linear-gradient(180deg,rgba(23,23,23,0.96),rgba(0,0,0,0.96))] px-6 py-6 sm:px-8 sm:py-8 shadow-[0_0_50px_rgba(0,0,0,0.45)]">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),transparent_35%)]" />
          <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-red-500/15 bg-red-500/10 px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.35em] text-red-100/70">
                <span className="h-2 w-2 rounded-full bg-red-400/80" />
                {monthKey}
              </div>

              <h1 className="mt-4 text-5xl leading-none sm:text-7xl xl:text-8xl font-heading uppercase tracking-[0.04em] text-white">
                Board of Shame
              </h1>

              <div className="mt-4 max-w-2xl text-sm sm:text-base text-white/45">
                Monthly dip rankings for Zero Alpha members. 1 dip = 25 Burpees.
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
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                {loading ? "Loading…" : "Refresh"}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-6">
          <div className="mb-3 text-sm font-semibold text-white/80">Top offenders</div>

          {top3.length === 0 ? (
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-6 text-sm text-white/60">
              No dips for this month. Miracles do happen.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              {top3.map((r, idx) => {
                const isMe = Boolean(user?.uid && r.userId === user.uid);
                return (
                  <div
                    key={r.userId}
                    className="rounded-2xl border border-red-500/20 bg-[radial-gradient(circle_at_top,rgba(239,68,68,0.08),transparent_55%),rgba(10,10,10,1)] p-5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="inline-flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.3em] text-red-200/70">
                        <AlertTriangle className="h-4 w-4" />
                        #{idx + 1}
                      </div>
                      <div className="rounded-xl border border-red-500/15 bg-red-500/10 px-3 py-1 text-xs font-bold text-red-100/80">
                        {r.dipCount} dips
                      </div>
                    </div>

                    <div className="mt-4 flex items-center gap-3">
                      <UserAvatar name={r.name || "Member"} photoURL={r.photoURL} size={48} />
                      <div className="min-w-0">
                        <div className="truncate text-lg font-extrabold text-white">
                          {r.name || "Member"} {isMe ? <span className="text-white/50">(you)</span> : null}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-950 overflow-hidden">
          <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
            <div className="text-sm font-semibold text-white/80">Full dip rankings</div>
            {err ? <div className="text-sm text-red-300">{err}</div> : null}
          </div>

          {!err && !loading && rows.length === 0 && (
            <div className="px-4 py-6 text-sm text-white/60">No members yet.</div>
          )}

          {rows.filter((r) => r.dipCount > 0).length > 0 && (
            <div className="divide-y divide-neutral-800">
              {rows
                .filter((r) => r.dipCount > 0)
                .map((r, idx) => {
                  const isMe = Boolean(user?.uid && r.userId === user.uid);
                  const rank = idx + 1;

                  return (
                    <div
                      key={r.userId}
                      className={`flex items-center justify-between px-4 py-3 ${isMe ? "bg-red-950/20" : ""}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-12 text-center text-sm font-extrabold text-white/80">
                          #{rank}
                        </div>
                        <UserAvatar name={r.name || "Member"} photoURL={r.photoURL} size={40} />
                        <div className="truncate text-sm font-semibold text-white/90">
                          {r.name || "Member"} {isMe ? <span className="text-white/50">(you)</span> : null}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2">
                        <Flame className="h-4 w-4 text-red-300" />
                        <div className="text-lg font-extrabold">{r.dipCount}</div>
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