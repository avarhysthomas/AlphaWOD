// src/pages/Schedule.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAuth, onAuthStateChanged, User } from "firebase/auth";
import {
  collection,
  doc,
  increment,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
} from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";

type ClassDoc = {
  title: string;
  timezone?: string; // "Europe/London"
  startTime: Timestamp;
  endTime: Timestamp;
  coachName?: string;
  location?: string;
  capacity?: number;
  bookedCount?: number;
  status?: "scheduled" | "cancelled";
};

type BookingDoc = {
  classId: string;
  userId: string;
  userName?: string;
  status: "booked" | "cancelled";
  createdAt?: Timestamp;
  cancelledAt?: Timestamp;
};

const RANGE_OPTIONS = [7, 14, 28] as const;
const DEFAULT_TZ = "Europe/London";

function classIdToBookingId(classId: string, userId: string) {
  // deterministic booking id
  return `${classId}_${userId}`;
}

function fmtDate(d: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone,
  }).format(d);
}

function fmtTime(d: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(d);
}

function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0)
  );
}

function addDaysUtc(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export default function Schedule() {
  const navigate = useNavigate();
  const auth = getAuth();

  // ✅ role comes from AuthContext (not Firebase auth user)
  const { appUser } = useAuth();
  const isAdmin = appUser?.role === "admin";

  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [rangeDays, setRangeDays] = useState<(typeof RANGE_OPTIONS)[number]>(14);

  const [classes, setClasses] = useState<Array<{ id: string; data: ClassDoc }>>(
    []
  );
  const [activeBookingsByClassId, setActiveBookingsByClassId] = useState<
    Record<string, BookingDoc>
  >({});

  const [busyClassId, setBusyClassId] = useState<string | null>(null);

  // auth listener (so schedule works after refresh)
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, [auth]);

  const windowUtc = useMemo(() => {
    const from = startOfTodayUtc();
    const to = addDaysUtc(from, rangeDays + 1); // +1 include last day
    return { from, to };
  }, [rangeDays]);

  // live classes feed for the chosen range
  useEffect(() => {
    const classesRef = collection(db, "classes");
    const q = query(
      classesRef,
      where("startTime", ">=", Timestamp.fromDate(windowUtc.from)),
      where("startTime", "<", Timestamp.fromDate(windowUtc.to)),
      orderBy("startTime", "asc")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({
          id: d.id,
          data: d.data() as ClassDoc,
        }));
        setClasses(rows);
      },
      (err) => console.error("classes onSnapshot error:", err)
    );

    return () => unsub();
  }, [windowUtc.from, windowUtc.to]);

  // live bookings for this user (only ACTIVE ones)
  useEffect(() => {
    if (!user) {
      setActiveBookingsByClassId({});
      return;
    }

    const bookingsRef = collection(db, "bookings");
    const q = query(
      bookingsRef,
      where("userId", "==", user.uid),
      where("status", "==", "booked")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const map: Record<string, BookingDoc> = {};
        snap.docs.forEach((d) => {
          const b = d.data() as BookingDoc;
          if (b?.classId) map[b.classId] = b;
        });
        setActiveBookingsByClassId(map);
      },
      (err) => console.error("bookings onSnapshot error:", err)
    );

    return () => unsub();
  }, [user]);

  const grouped = useMemo(() => {
    const groups: Record<string, Array<{ id: string; data: ClassDoc }>> = {};
    for (const c of classes) {
      const tz = c.data.timezone || DEFAULT_TZ;
      const start = c.data.startTime.toDate();
      const key = fmtDate(start, tz);

      if (!groups[key]) groups[key] = [];
      groups[key].push(c);
    }
    return groups;
  }, [classes]);

  async function handleBook(classId: string) {
    if (!user) return alert("Log in first.");

    setBusyClassId(classId);
    try {
      const classRef = doc(db, "classes", classId);
      const bookingId = classIdToBookingId(classId, user.uid);
      const bookingRef = doc(db, "bookings", bookingId);

      await runTransaction(db, async (tx) => {
        const [classSnap, bookingSnap] = await Promise.all([
          tx.get(classRef),
          tx.get(bookingRef),
        ]);

        if (!classSnap.exists()) throw new Error("Class not found");

        const classData = classSnap.data() as ClassDoc;
        const capacity = Number(classData.capacity ?? 0);
        const bookedCount = Number(classData.bookedCount ?? 0);

        if (bookingSnap.exists()) {
          const b = bookingSnap.data() as BookingDoc;
          if (b.status === "booked") {
            const err: any = new Error("Already booked");
            err.code = "already-booked";
            throw err;
          }
        }

        if (capacity > 0 && bookedCount >= capacity) {
          const err: any = new Error("Class is full");
          err.code = "full";
          throw err;
        }

        tx.set(
          bookingRef,
          {
            classId,
            userId: user.uid,
            userName: user.displayName || user.email || "Member",
            status: "booked",
            createdAt: serverTimestamp(),
          } as BookingDoc,
          { merge: true }
        );

        tx.update(classRef, {
          bookedCount: increment(1),
        });
      });
    } catch (e: any) {
      console.error("Book failed:", e);
      if (e?.code === "already-booked" || e?.message === "Already booked")
        return alert("Already booked");
      if (e?.code === "full" || e?.message === "Class is full")
        return alert("Class is full");
      alert(e?.message || "Booking failed");
    } finally {
      setBusyClassId(null);
    }
  }

  async function handleCancel(classId: string) {
    if (!user) return alert("Log in first.");

    setBusyClassId(classId);
    try {
      const classRef = doc(db, "classes", classId);
      const bookingId = classIdToBookingId(classId, user.uid);
      const bookingRef = doc(db, "bookings", bookingId);

      await runTransaction(db, async (tx) => {
        const [classSnap, bookingSnap] = await Promise.all([
          tx.get(classRef),
          tx.get(bookingRef),
        ]);

        if (!bookingSnap.exists()) {
          const err: any = new Error("No active booking found");
          err.code = "no-booking";
          throw err;
        }

        const bookingData = bookingSnap.data() as BookingDoc;
        if (bookingData.status !== "booked") {
          const err: any = new Error("No active booking found");
          err.code = "no-booking";
          throw err;
        }

        if (!classSnap.exists()) throw new Error("Class not found");

        tx.update(bookingRef, {
          status: "cancelled",
          cancelledAt: serverTimestamp(),
        });

        tx.update(classRef, {
          bookedCount: increment(-1),
        });
      });
    } catch (e: any) {
      console.error("Cancel failed:", e);
      if (e?.code === "no-booking" || e?.message === "No active booking found") {
        return alert("No active booking found");
      }
      alert(e?.message || "Cancel failed");
    } finally {
      setBusyClassId(null);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white p-6 overflow-x-hidden">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-5xl font-extrabold uppercase tracking-widest">
              Schedule
            </h1>
            <div className="text-white/60 mt-1">Upcoming classes</div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-white/60 text-sm">Range</div>
            <select
              value={rangeDays}
              onChange={(e) => setRangeDays(Number(e.target.value) as any)}
              className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
            >
              {RANGE_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-8 space-y-8">
          {Object.keys(grouped).length === 0 ? (
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-6 text-white/70">
              No classes in this range.
            </div>
          ) : (
            Object.entries(grouped).map(([dayLabel, items]) => (
              <div
                key={dayLabel}
                className="rounded-3xl border border-neutral-800 bg-neutral-950/60 p-6"
              >
                <h2 className="text-2xl font-bold">{dayLabel}</h2>

                <div className="mt-4 grid gap-3">
                  {items.map(({ id, data }) => {
                    const tz = data.timezone || DEFAULT_TZ;
                    const start = data.startTime.toDate();
                    const end = data.endTime.toDate();

                    const booked = !!activeBookingsByClassId[id];
                    const capacity = Number(data.capacity ?? 0);
                    const bookedCount = Number(data.bookedCount ?? 0);
                    const full = capacity > 0 && bookedCount >= capacity;

                    return (
                      <div
                          key={id}
                          className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
                        >
                        <div className="min-w-0">
                          <div className="flex items-center gap-3">
                            <div className="font-semibold">
                              {fmtTime(start, tz)}–{fmtTime(end, tz)} •{" "}
                              {data.title}
                            </div>

                            {booked ? (
                              <span className="text-xs font-semibold tracking-wide uppercase rounded-full px-2 py-0.5 border border-emerald-500/60 text-emerald-200">
                                Booked
                              </span>
                            ) : null}

                            {!booked && full ? (
                              <span className="text-xs font-semibold tracking-wide uppercase rounded-full px-2 py-0.5 border border-red-500/60 text-red-200">
                                Full
                              </span>
                            ) : null}
                          </div>

                          <div className="text-sm text-white/60 mt-1">
                            Coach: {data.coachName || "—"} •{" "}
                            {data.location || "—"} • {bookedCount}/
                            {capacity || "—"}
                          </div>
                        </div>

                        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0 w-full sm:w-auto">
                          {/* ✅ Admin-only roster button */}
                          {isAdmin ? (
                            <button
                              onClick={() => navigate(`/admin/classes/${id}`)}
                              className="px-5 py-2 w-full sm:w-auto rounded-lg border border-sky-500/60 text-sky-200 font-semibold hover:bg-white/5"
                            >
                              Roster
                            </button>
                          ) : null}

                          {booked ? (
                            <button
                              onClick={() => handleCancel(id)}
                              disabled={busyClassId === id}
                              className="px-5 py-2 w-full sm:w-auto rounded-lg border border-yellow-500/70 text-yellow-100 font-semibold disabled:opacity-50"
                            >
                              {busyClassId === id ? "Cancelling…" : "Cancel"}
                            </button>
                          ) : (
                            <button
                              onClick={() => handleBook(id)}
                              disabled={busyClassId === id || full}
                              className="px-5 py-2 w-full sm:w-auto rounded-lg border border-emerald-500/60 text-emerald-100 font-semibold disabled:opacity-40"
                            >
                              {busyClassId === id ? "Booking…" : "Book"}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}