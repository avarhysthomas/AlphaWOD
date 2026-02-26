import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, doc, getDoc, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { db } from "../firebase";
import { checkInBooking } from "../service/checkin";

type BookingRow = {
  id: string;
  classId: string;
  userId: string;
  userName?: string;
  status: "booked" | "cancelled";
  attended?: boolean;
};

export default function ClassRoster() {
  const { classId } = useParams<{ classId: string }>();
  const auth = getAuth();

  const [classTitle, setClassTitle] = useState<string>("Class");
  const [classMeta, setClassMeta] = useState<string>("");
  const [rows, setRows] = useState<BookingRow[]>([]);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

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
          ? `${start.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}–${end.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
          : "";
      const date =
        start
          ? start.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })
          : "";
      setClassMeta([date, time, d.location].filter(Boolean).join(" • "));
    })();
  }, [classId]);

  useEffect(() => {
    if (!classId) return;

    const q = query(
      collection(db, "bookings"),
      where("classId", "==", classId),
      where("status", "==", "booked"),
      orderBy("createdAt", "asc")
    );

    return onSnapshot(q, (snap) => {
      const data = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as BookingRow[];
      setRows(data);
    });
  }, [classId]);

  const attendedCount = useMemo(
    () => rows.filter((r) => r.attended).length,
    [rows]
  );

  async function toggle(userId: string, next: boolean) {
    const user = auth.currentUser;
    if (!user) return alert("Log in first.");
    if (!classId) return;

    try {
      setBusyUserId(userId);
      await checkInBooking({ classId, userId, attended: next });
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Check-in failed");
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5">
          <div className="text-3xl font-extrabold uppercase tracking-widest">{classTitle}</div>
          <div className="text-white/60 mt-1">{classMeta}</div>
          <div className="mt-3 text-white/80">
            Checked in: <span className="font-semibold">{attendedCount}</span> / {rows.length}
          </div>
        </div>

        <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5">
          <div className="text-xl font-semibold">Attendees</div>

          <div className="mt-4 grid gap-3">
            {rows.map((r) => {
              const isBusy = busyUserId === r.userId;
              const isIn = !!r.attended;

              return (
                <button
                  key={r.id}
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

            {rows.length === 0 ? (
              <div className="text-white/60">No bookings yet.</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}