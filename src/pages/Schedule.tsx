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

const DEFAULT_TZ = "Europe/London";

/** Booking close rules:
 *  - 06:00 class closes previous day 20:30
 *  - 18:00 class closes same day 15:00
 */
function computeBookingClosesAt(startTs?: Timestamp) {
  const start = startTs?.toDate?.();
  if (!start) return null;

  const closes = new Date(start);
  const hour = start.getHours();

  if (hour === 6) {
    closes.setDate(closes.getDate() - 1);
    closes.setHours(20, 30, 0, 0);
    return closes;
  }

  if (hour === 18) {
    closes.setHours(15, 0, 0, 0);
    return closes;
  }

  closes.setTime(start.getTime() - 2 * 60 * 60 * 1000);
  return closes;
}

function bookingStatus(startTs?: Timestamp) {
  const start = startTs?.toDate?.();
  if (!start) return { state: "unknown" as const };

  const closes = computeBookingClosesAt(startTs);
  const now = Date.now();

  if (now >= start.getTime()) return { state: "started" as const, closes };
  if (closes && now >= closes.getTime()) return { state: "closed" as const, closes };

  return {
    state: "open" as const,
    closes,
    msLeft: closes ? closes.getTime() - now : 0,
  };
}

function fmtRemaining(ms: number) {
  const mins = Math.ceil(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

function classIdToBookingId(classId: string, userId: string) {
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

/** Next calendar week (Mon 00:00 -> Mon 00:00) in local time */
function startOfWeekMonday(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay(); // Sun=0 ... Sat=6
  const diffToMonday = (day + 6) % 7; // Mon=0 ... Sun=6
  x.setDate(x.getDate() - diffToMonday);
  return x;
}

function thisCalendarWeekWindow(now = new Date()) {
  const from = startOfWeekMonday(now);
  const to = new Date(from);
  to.setDate(to.getDate() + 7);
  return { from, to };
}

export default function Schedule() {
  const navigate = useNavigate();
  const auth = getAuth();

  const { appUser } = useAuth();
  const isAdmin = appUser?.role === "admin";

  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [classes, setClasses] = useState<Array<{ id: string; data: ClassDoc }>>([]);
  const [activeBookingsByClassId, setActiveBookingsByClassId] = useState<Record<string, BookingDoc>>(
    {}
  );
  const [busyClassId, setBusyClassId] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, [auth]);

  // ✅ fixed window: next calendar week only
  const windowLocal = useMemo(() => thisCalendarWeekWindow(new Date()), []);

  // live classes feed for next calendar week
  useEffect(() => {
    const classesRef = collection(db, "classes");
    const q = query(
      classesRef,
      where("startTime", ">=", Timestamp.fromDate(windowLocal.from)),
      where("startTime", "<", Timestamp.fromDate(windowLocal.to)),
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
  }, [windowLocal.from, windowLocal.to]);

  // live bookings for this user (only ACTIVE ones)
  useEffect(() => {
    if (!user) {
      setActiveBookingsByClassId({});
      return;
    }

    const bookingsRef = collection(db, "bookings");
    const q = query(bookingsRef, where("userId", "==", user.uid), where("status", "==", "booked"));

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
        const [classSnap, bookingSnap] = await Promise.all([tx.get(classRef), tx.get(bookingRef)]);
        if (!classSnap.exists()) throw new Error("Class not found");

        const classData = classSnap.data() as ClassDoc;

        // ✅ Enforce booking close rules server-side (transaction)
        const bs = bookingStatus(classData.startTime);
        if (bs.state === "closed" || bs.state === "started") {
          const err: any = new Error("Booking closed");
          err.code = "closed";
          throw err;
        }

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

        tx.update(classRef, { bookedCount: increment(1) });
      });
    } catch (e: any) {
      console.error("Book failed:", e);
      if (e?.code === "already-booked" || e?.message === "Already booked") return alert("Already booked");
      if (e?.code === "full" || e?.message === "Class is full") return alert("Class is full");
      if (e?.code === "closed" || e?.message === "Booking closed") return alert("Booking closed for this class");
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
        const [classSnap, bookingSnap] = await Promise.all([tx.get(classRef), tx.get(bookingRef)]);

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

        tx.update(bookingRef, { status: "cancelled", cancelledAt: serverTimestamp() });
        tx.update(classRef, { bookedCount: increment(-1) });
      });
    } catch (e: any) {
      console.error("Cancel failed:", e);
      if (e?.code === "no-booking" || e?.message === "No active booking found") return alert("No active booking found");
      alert(e?.message || "Cancel failed");
    } finally {
      setBusyClassId(null);
    }
  }

  const weekLabel = useMemo(() => {
  const a = windowLocal.from.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const endMinus1 = new Date(windowLocal.to.getTime() - 1);
  const b = endMinus1.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `${a} – ${b}`;
}, [windowLocal.from, windowLocal.to]);

  return (
    <div className="min-h-screen bg-black text-white p-6 overflow-x-hidden">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-6xl sm:text-7xl font-heading uppercase tracking-widest text-white">Schedule</h1>
            <div className="text-white/60 mt-1">This week • {weekLabel}</div>
          </div>
        </div>

        <div className="mt-8 space-y-8">
          {Object.keys(grouped).length === 0 ? (
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-6 text-white/70">
              No classes scheduled for next week.
            </div>
          ) : (
            Object.entries(grouped).map(([dayLabel, items]) => (
              <div
                key={dayLabel}
                className="rounded-3xl border border-neutral-800 bg-neutral-950 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.03)]"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-bold tracking-wide">{dayLabel}</h2>
                  <div className="text-xs uppercase tracking-widest text-white/40">{items.length} Sessions</div>
                </div>

                <div className="mt-4 grid gap-3">
                  {items.map(({ id, data }) => {
                    const tz = data.timezone || DEFAULT_TZ;

                    const start = data.startTime.toDate();
                    const end = data.endTime.toDate();

                    const capacity = Number(data.capacity ?? 0);
                    const bookedCount = Number(data.bookedCount ?? 0);
                    const booked = Boolean(activeBookingsByClassId[id]);
                    const full = capacity > 0 && bookedCount >= capacity;

                    const bs = bookingStatus(data.startTime);
                    const bookingClosed = bs.state === "closed" || bs.state === "started";

                    return (
                      <div
                        key={id}
                        className="
                          group rounded-2xl border border-white/10 bg-white/[0.03] p-5
                          flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4
                          transition hover:border-white/20 hover:bg-white/[0.05] hover:-translate-y-[1px]
                        "
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-3 flex-wrap">
                            <span className="font-mono text-sm text-white/80">
                              {fmtTime(start, tz)}–{fmtTime(end, tz)}
                            </span>

                            <span className="text-xs uppercase tracking-widest px-3 py-1 rounded-full border bg-white/5 border-white/15 text-white/80">
                              {data.title}
                            </span>

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

                            {!booked && !full && bs.state === "open" && bs.msLeft != null ? (
                              <span className="text-xs font-semibold tracking-wide uppercase rounded-full px-2 py-0.5 border border-amber-500/40 bg-amber-500/10 text-amber-200">
                                Closes in {fmtRemaining(bs.msLeft)}
                              </span>
                            ) : null}

                            {!booked && bookingClosed ? (
                              <span className="text-xs font-semibold tracking-wide uppercase rounded-full px-2 py-0.5 border border-white/10 bg-white/5 text-white/40">
                                Booking closed
                              </span>
                            ) : null}
                          </div>

                          <div className="text-sm text-white/60 mt-2">
                            Coach: {data.coachName || "—"} • {data.location || "—"} • {bookedCount}/{capacity || "—"}
                          </div>
                        </div>

                        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0 w-full sm:w-auto">
                          {isAdmin ? (
                            <button
                              onClick={() => navigate(`/admin/classes/${id}`)}
                              className="px-5 py-2 w-full sm:w-auto rounded-xl border border-sky-500/50 text-sky-200 font-semibold hover:bg-white/5"
                            >
                              Roster
                            </button>
                          ) : null}

                          {booked ? (
                            <button
                              onClick={() => handleCancel(id)}
                              disabled={busyClassId === id}
                              className="px-5 py-2 w-full sm:w-auto rounded-xl border border-yellow-500/60 text-yellow-100 font-semibold disabled:opacity-50"
                            >
                              {busyClassId === id ? "Cancelling…" : "Cancel"}
                            </button>
                          ) : (
                            <button
                              onClick={() => handleBook(id)}
                              disabled={busyClassId === id || full || bookingClosed}
                              className={`
                                px-5 py-2 w-full sm:w-auto rounded-xl border font-semibold disabled:opacity-40
                                ${
                                  bookingClosed
                                    ? "border-white/10 bg-white/5 text-white/30 cursor-not-allowed"
                                    : "border-emerald-500/50 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/15"
                                }
                              `}
                            >
                              {bookingClosed ? "Closed" : busyClassId === id ? "Booking…" : "Book"}
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