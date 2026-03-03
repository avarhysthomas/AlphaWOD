import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import { db } from "../firebase";
import { checkInBooking } from "../service/checkin";
import UserAvatar from "../components/UserAvatar";

type BookingRow = {
  userId: string;
  name?: string;
  email?: string;
  photoURL?: string;
  attended?: boolean;
  checkedInAt?: any;
};

type RosterResponse = {
  classId: string;
  total: number;
  checkedInCount: number;
  attendees: BookingRow[];
};

export default function ClassRoster() {
  const { classId } = useParams<{ classId: string }>();
  const auth = getAuth();

  const [classTitle, setClassTitle] = useState("Class");
  const [classMeta, setClassMeta] = useState("");
  const [rows, setRows] = useState<BookingRow[]>([]);
  const [serverCounts, setServerCounts] = useState<{ total: number; checkedIn: number }>({
    total: 0,
    checkedIn: 0,
  });

  const [loadingRoster, setLoadingRoster] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  // ----- Load class header/meta -----
  useEffect(() => {
    if (!classId) return;

    (async () => {
      const snap = await getDoc(doc(db, "classes", classId));
      if (!snap.exists()) return;

      const d: any = snap.data();
      setClassTitle(d.title || "Class");

      const start = d.startTime?.toDate?.();
      const end = d.endTime?.toDate?.();

      const time =
        start && end
          ? `${start.toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
            })}–${end.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
          : "";

      const date = start
        ? start.toLocaleDateString("en-GB", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })
        : "";

      setClassMeta([date, time, d.location].filter(Boolean).join(" • "));
    })();
  }, [classId]);

  // ----- Callable: get roster -----
  const loadRoster = useCallback(async () => {
    if (!classId) return;

    try {
      setLoadingRoster(true);

      const functions = getFunctions(undefined, "europe-west1");
      const getRoster = httpsCallable<{ classId: string }, RosterResponse>(functions, "getClassRoster");

      const res = await getRoster({ classId });
      const data = res.data;

      const attendees = data.attendees || [];

      // Enrich from /users so roster shows real names/emails
      const enriched = await Promise.all(
        attendees.map(async (r) => {
          try {
            const userSnap = await getDoc(doc(db, "users", r.userId));
            const u: any = userSnap.exists() ? userSnap.data() : null;

            const merged: BookingRow = {
              ...r,
              name: u?.name ?? r.name,
              email: u?.email ?? r.email,
              photoURL: u?.photoURL ?? r.photoURL,
            };

            if (!merged.name) merged.name = "Member";
            if (!merged.email) merged.email = "";

            return merged;
          } catch {
            const merged: BookingRow = { ...r };
            if (!merged.name) merged.name = "Member";
            if (!merged.email) merged.email = "";
            return merged;
          }
        })
      );

      setRows(enriched);
      setServerCounts({
        total: data.total ?? enriched.length,
        checkedIn: data.checkedInCount ?? enriched.filter((x) => x.attended === true).length,
      });
    } catch (err: any) {
      console.error("Roster error:", err);
      alert(`code: ${err.code}\nmessage: ${err.message}\ndetails: ${JSON.stringify(err.details ?? {}, null, 2)}`);
      setRows([]);
      setServerCounts({ total: 0, checkedIn: 0 });
    } finally {
      setLoadingRoster(false);
    }
  }, [classId]);

  useEffect(() => {
    loadRoster();
  }, [loadRoster]);

  const localCheckedInCount = useMemo(() => rows.filter((r) => r.attended === true).length, [rows]);
  const checkedInShown = serverCounts.checkedIn || localCheckedInCount;
  const totalShown = serverCounts.total || rows.length;

  // Sort: checked-in first, then by name
  const sortedRows = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const ain = a.attended === true ? 0 : 1;
      const bin = b.attended === true ? 0 : 1;
      if (ain !== bin) return ain - bin;
      return (a.name ?? "").localeCompare(b.name ?? "");
    });
    return copy;
  }, [rows]);

  // ----- Toggle check-in -----
  async function toggle(userId: string, next: boolean) {
    const user = auth.currentUser;
    if (!user) return alert("Log in first.");
    if (!classId) return;

    try {
      setBusyUserId(userId);
      await checkInBooking({ classId, userId, attended: next });
      await loadRoster();
    } catch (e: any) {
      console.error("Check-in error:", e);
      alert(
        `code: ${e?.code ?? "?"}\nmessage: ${e?.message ?? "Check-in failed"}\ndetails: ${JSON.stringify(
          e?.details ?? {},
          null,
          2
        )}`
      );
    } finally {
      setBusyUserId(null);
    }
  }

  // ----- Bulk check-in -----
  async function checkInAll() {
    const user = auth.currentUser;
    if (!user) return alert("Log in first.");
    if (!classId) return;

    const toCheckIn = rows.filter((r) => r.attended !== true);

    if (toCheckIn.length === 0) return;

    try {
      setBulkBusy(true);

      const results = await Promise.allSettled(
        toCheckIn.map((r) => checkInBooking({ classId, userId: r.userId, attended: true }))
      );

      const failed = results.filter((x) => x.status === "rejected").length;
      await loadRoster();

      if (failed > 0) {
        alert(`Checked in ${toCheckIn.length - failed}/${toCheckIn.length}. ${failed} failed — try again or refresh.`);
      }
    } catch (e: any) {
      console.error("Bulk check-in error:", e);
      alert(e?.message ?? "Bulk check-in failed");
    } finally {
      setBulkBusy(false);
    }
  }

  const progressPct = totalShown ? Math.round((checkedInShown / totalShown) * 100) : 0;
  const canBulkCheckIn = !loadingRoster && !bulkBusy && rows.some((r) => r.attended !== true);

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* HERO HEADER */}
        <div className="rounded-3xl border border-neutral-800 bg-gradient-to-b from-neutral-950 to-black p-7 shadow-[0_0_40px_rgba(0,0,0,0.6)]">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0">
              <h1 className="text-6xl sm:text-7xl font-heading uppercase tracking-widest text-white">{classTitle}</h1>
              <div className="text-white/50 mt-2">{classMeta}</div>
            </div>

            <div className="shrink-0 text-right">
              <div className="text-xs uppercase tracking-widest text-white/40">Checked in</div>
              <div className="text-5xl font-bold">
                {checkedInShown}
                <span className="text-white/30">/{totalShown}</span>
              </div>
            </div>
          </div>

          <div className="mt-5">
            <div className="h-2 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-emerald-500/40 transition-all duration-500" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="mt-2 text-xs text-white/40 uppercase tracking-widest">{progressPct}% checked in</div>
          </div>
        </div>

        {/* ATTENDEES */}
        <div className="rounded-3xl border border-neutral-800 bg-neutral-950 p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xl font-semibold">Attendees</div>

            <div className="flex items-center gap-3">
              <button
                onClick={checkInAll}
                disabled={!canBulkCheckIn}
                className={`rounded-xl border px-4 py-2 text-sm font-semibold transition
                  ${
                    canBulkCheckIn
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15"
                      : "border-white/10 bg-white/[0.03] text-white/40"
                  }`}
              >
                {bulkBusy ? "Checking in…" : "Check in all"}
              </button>

              <button onClick={loadRoster} className="text-sm underline text-white/70" disabled={loadingRoster || bulkBusy}>
                {loadingRoster ? "Loading..." : "Refresh"}
              </button>
            </div>
          </div>

          {loadingRoster ? (
            <div className="mt-6 text-white/50">Loading roster…</div>
          ) : sortedRows.length === 0 ? (
            <div className="mt-6 text-white/60">No bookings yet.</div>
          ) : (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {sortedRows.map((r) => {
                const isBusy = busyUserId === r.userId || bulkBusy;
                const isIn = r.attended === true;

                return (
                  <button
                    key={r.userId}
                    onClick={() => toggle(r.userId, !isIn)}
                    disabled={isBusy}
                    className={`
                      group rounded-2xl border p-5 text-left transition
                      ${isIn ? "border-emerald-500/60 bg-emerald-500/10" : "border-white/10 bg-white/[0.03]"}
                      ${isBusy ? "opacity-60" : "hover:border-white/20 hover:bg-white/[0.05] hover:-translate-y-[1px]"}
                    `}
                  >
                    <div className="flex items-center gap-4">
                      <div
                        className={[
                          "shrink-0 rounded-full p-[2px] border",
                          isIn ? "border-emerald-500/70" : "border-white/10",
                        ].join(" ")}
                      >
                        <UserAvatar name={r.name ?? "Member"} photoURL={r.photoURL} size={48} />
                      </div>

                      <div className="min-w-0">
                        <div className="font-semibold truncate text-white">{r.name ?? "Member"}</div>
                        <div className="text-xs text-white/50 truncate">{r.email ?? ""}</div>
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-between">
                      <span
                        className={`
                          text-xs uppercase tracking-widest px-3 py-1 rounded-full border
                          ${isIn ? "border-emerald-500/60 text-emerald-200" : "border-white/15 text-white/60"}
                        `}
                      >
                        {isBusy ? "…" : isIn ? "Checked in" : "Tap to check in"}
                      </span>

                      <span className="text-xs text-white/30 font-mono">{r.checkedInAt ? "✓" : ""}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}