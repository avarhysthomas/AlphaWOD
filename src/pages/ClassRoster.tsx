import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import { db } from "../firebase";
import { checkInBooking } from "../service/checkin";

type BookingRow = {
  userId: string;
  userName?: string;
  attended?: boolean;
  checkedInAt?: any; // Timestamp | null (optional)
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

      // Uses default firebase app. Region must match your functions region.
      const functions = getFunctions(undefined, "europe-west1");
      const getRoster = httpsCallable<{ classId: string }, RosterResponse>(
        functions,
        "getClassRoster"
      );

      const res = await getRoster({ classId });
      const data = res.data;

      setRows(data.attendees || []);
      setServerCounts({
        total: data.total ?? (data.attendees?.length ?? 0),
        checkedIn: data.checkedInCount ?? 0,
      });
    } catch (err: any) {
      console.error("Roster error:", err);
      alert(
        `code: ${err.code}\nmessage: ${err.message}\ndetails: ${JSON.stringify(
          err.details ?? {},
          null,
          2
        )}`
      );
      setRows([]);
      setServerCounts({ total: 0, checkedIn: 0 });
    } finally {
      setLoadingRoster(false);
    }
  }, [classId]);

  useEffect(() => {
    loadRoster();
  }, [loadRoster]);

  // Local computed fallback (handy if you want to trust UI state)
  const localCheckedInCount = useMemo(
    () => rows.filter((r) => r.attended === true).length,
    [rows]
  );

  // ----- Toggle check-in -----
  async function toggle(userId: string, next: boolean) {
    const user = auth.currentUser;
    if (!user) return alert("Log in first.");
    if (!classId) return;

    try {
      setBusyUserId(userId);
      await checkInBooking({ classId, userId, attended: next });

      // Refresh roster after mutation
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

  const checkedInShown = serverCounts.checkedIn || localCheckedInCount;
  const totalShown = serverCounts.total || rows.length;

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5">
          <div className="text-3xl font-extrabold uppercase tracking-widest">{classTitle}</div>
          <div className="text-white/60 mt-1">{classMeta}</div>

          <div className="mt-3 text-white/80">
            Checked in: <span className="font-semibold">{checkedInShown}</span> / {totalShown}
          </div>
        </div>

        <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5">
          <div className="flex items-center justify-between">
            <div className="text-xl font-semibold">Attendees</div>
            <button
              onClick={loadRoster}
              className="text-sm underline text-white/70"
              disabled={loadingRoster}
            >
              {loadingRoster ? "Loading..." : "Refresh"}
            </button>
          </div>

          <div className="mt-4 grid gap-3">
            {rows.map((r) => {
              const isBusy = busyUserId === r.userId;
              const isIn = r.attended === true;

              return (
                <button
                  key={r.userId}
                  onClick={() => toggle(r.userId, !isIn)}
                  disabled={isBusy}
                  className={`w-full text-left rounded-xl border p-4 flex items-center justify-between transition
                    ${isIn ? "border-emerald-500/60 bg-emerald-500/10" : "border-neutral-800 bg-neutral-900/40"}
                    ${isBusy ? "opacity-60" : "hover:bg-white/5"}
                  `}
                >
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{r.userName || r.userId}</div>
                    <div className="text-xs text-white/50 truncate">{r.userId}</div>
                  </div>

                  <div className="shrink-0">
                    <span
                      className={`text-xs uppercase tracking-widest px-3 py-1 rounded-full border
                        ${isIn ? "border-emerald-500/60 text-emerald-200" : "border-neutral-700 text-white/50"}
                      `}
                    >
                      {isBusy ? "…" : isIn ? "Checked in" : "Tap to check in"}
                    </span>
                  </div>
                </button>
              );
            })}

            {!loadingRoster && rows.length === 0 ? (
              <div className="text-white/60">No bookings yet.</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}