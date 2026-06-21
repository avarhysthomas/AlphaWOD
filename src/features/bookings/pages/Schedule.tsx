// src/pages/Schedule.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import {
  collection,
  doc,
  getDocs,
  getDoc,
  orderBy,
  query,
  Timestamp,
  where,
} from "firebase/firestore";
import { db } from "../../../firebase";
import { useAuth } from "../../../context/AuthContext";
import { getUserNavItems } from "../../../components/layout/UserTopNav";
import { Flame, Dumbbell, PersonStanding, Award, Activity, Bell, Search } from "lucide-react";
import { bookClass as bookClassCallable, cancelBooking as cancelBookingCallable } from "../services/bookings";

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

type ClassRow = { id: string; data: ClassDoc };

const DEFAULT_TZ = "Europe/London";
type StrengthBlock = "A" | "B" | "none";

/** Booking close rules:
 *  - 06:00 class closes previous day 21:00
 *  - 18:00 class closes same day 15:00
 */
function computeBookingClosesAt(startTs?: Timestamp) {
  const start = startTs?.toDate?.();
  if (!start) return null;

  const closes = new Date(start);
  const hour = start.getHours();

  if (hour === 5 || hour === 6) {
    closes.setDate(closes.getDate() - 1);
    closes.setHours(21, 0, 0, 0);
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

function normalizeStrengthBlock(value: unknown): StrengthBlock {
  return value === "A" || value === "B" ? value : "none";
}

function getStrengthSlotForClass(classData: ClassDoc): "A" | "B" | null {
  const title = String(classData.title ?? "").toLowerCase();
  if (!title.includes("strength")) return null;

  const start = classData.startTime?.toDate?.();
  if (!start) return null;

  const day = start.getDay(); // Sun=0 ... Sat=6
  const hour = start.getHours();

  if ((day === 2 || day === 4) && hour === 6) return "A";
  if ((day === 1 || day === 3) && hour === 18) return "B";
  return null;
}

function canAccessClass(
  classData: ClassDoc,
  strengthBlock: StrengthBlock,
  isAdmin: boolean,
  strengthBlocksEnabled: boolean
) {
  if (!strengthBlocksEnabled) return true;

  const slot = getStrengthSlotForClass(classData);
  if (!slot) return true;

  if (isAdmin && strengthBlock === "none") return true;
  return strengthBlock === slot;
}

function fmtTime(d: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(d);
}

function dayKey(d: Date, timeZone = DEFAULT_TZ) {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(d);
}

function shortWeekday(d: Date) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(d).toUpperCase();
}

function dayNumber(d: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit" }).format(d);
}

function shortDayLabel(d: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(d);
}

function isTuesdayHyroxClass(classData: ClassDoc) {
  const title = String(classData.title ?? "").toLowerCase();
  const start = classData.startTime?.toDate?.();
  if (!title.includes("hyrox") || !start) return false;

  const weekday = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    timeZone: classData.timezone || DEFAULT_TZ,
  }).format(start);

  return weekday === "Tuesday";
}

function typeMeta(title?: string) {
  const t = (title || "").toLowerCase();

  if (t.includes("hyrox")) {
    return {
      label: "HYROX",
      icon: Flame,
      iconWrap: "border-orange-500/20 bg-orange-500/10 text-orange-200",
      accent: "bg-[#f4b16d]",
    };
  }

  if (t.includes("strength")) {
    return {
      label: "STRENGTH",
      icon: Dumbbell,
      iconWrap: "border-sky-500/20 bg-sky-500/10 text-sky-200",
      accent: "bg-sky-300",
    };
  }

  if (t.includes("bags")) {
    return {
      label: "BAGS",
      icon: Award,
      iconWrap: "border-red-500/20 bg-red-500/10 text-red-200",
      accent: "bg-red-300",
    };
  }

  if (t.includes("yoga")) {
    return {
      label: "YOGA",
      icon: PersonStanding,
      iconWrap: "border-teal-500/20 bg-teal-500/10 text-teal-200",
      accent: "bg-teal-300",
    };
  }

  if (t.includes("run club")) {
    return {
      label: "RUN CLUB",
      icon: Activity,
      iconWrap: "border-orange-500/20 bg-orange-500/10 text-orange-200",
      accent: "bg-orange-300",
    };
  }

  return {
    label: (title || "SESSION").toUpperCase(),
    icon: Activity,
    iconWrap: "border-white/15 bg-white/5 text-white/80",
    accent: "bg-white/50",
  };
}

function capacityPercent(bookedCount: number, capacity: number) {
  if (!capacity || capacity <= 0) return 0;
  return Math.max(0, Math.min(100, (bookedCount / capacity) * 100));
}

/** Cancel close rule:
 *  - cannot cancel after booking closes (same as booking close time)
 */
function cancelStatus(startTs?: Timestamp) {
  return bookingStatus(startTs);
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

function scheduleWindowWithSaturdayCutover(now = new Date()) {
  const thisMon = startOfWeekMonday(now);

  // Cutover time: Saturday 10:00 of the current week
  const cutover = new Date(thisMon);
  cutover.setDate(cutover.getDate() + 5); // Monday + 5 days = Saturday
  cutover.setHours(10, 0, 0, 0);

  const showNextWeek = now.getTime() >= cutover.getTime();

  const from = new Date(thisMon);
  if (showNextWeek) from.setDate(from.getDate() + 7); // next Monday

  const to = new Date(from);
  to.setDate(to.getDate() + 7);

  return { from, to, showNextWeek };
}

function adjustClassBookedCount(rows: ClassRow[], classId: string, delta: number) {
  return rows.map((row) => {
    if (row.id !== classId) return row;

    return {
      ...row,
      data: {
        ...row.data,
        bookedCount: Math.max(0, Number(row.data.bookedCount ?? 0) + delta),
      },
    };
  });
}

function normalizeStrengthBlocksEnabled(value: unknown) {
  return value === false ? false : true;
}

const BOOKING_SETTINGS_REF = doc(db, "appSettings", "booking");

export default function Schedule() {
  const navigate = useNavigate();

  const { user, appUser } = useAuth();
  const isAdmin = appUser?.role === "admin";

  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [activeBookingsByClassId, setActiveBookingsByClassId] = useState<Record<string, BookingDoc>>(
    {}
  );
  const [busyClassId, setBusyClassId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [strengthBlocksEnabled, setStrengthBlocksEnabled] = useState(true);
  const [selectedDayKey, setSelectedDayKey] = useState(() => {
    const windowLocal = scheduleWindowWithSaturdayCutover(new Date());
    const today = new Date();
    return today >= windowLocal.from && today < windowLocal.to
      ? dayKey(today)
      : dayKey(windowLocal.from);
  });

  // Next calendar week only
  const windowLocal = useMemo(() => scheduleWindowWithSaturdayCutover(new Date()), []);

  // Load the visible week once. Keeping this live made Schedule re-render whenever
  // anyone booked/cancelled, which is costly on the busiest screen.
  useEffect(() => {
    let isMounted = true;
    const classesRef = collection(db, "classes");
    const q = query(
      classesRef,
      where("startTime", ">=", Timestamp.fromDate(windowLocal.from)),
      where("startTime", "<", Timestamp.fromDate(windowLocal.to)),
      orderBy("startTime", "asc")
    );

    async function loadClasses() {
      try {
        const snap = await getDocs(q);
        if (!isMounted) return;
        const rows = snap.docs.map((d) => ({
          id: d.id,
          data: d.data() as ClassDoc,
        }));
        setClasses(rows);
      } catch (err) {
        if (!isMounted) return;
        console.error("classes fetch error:", err);
      }
    }

    loadClasses();

    return () => {
      isMounted = false;
    };
  }, [windowLocal.from, windowLocal.to]);

  useEffect(() => {
    let isMounted = true;

    async function loadBookingSettings() {
      try {
        const snap = await getDoc(BOOKING_SETTINGS_REF);
        if (!isMounted) return;
        setStrengthBlocksEnabled(
          normalizeStrengthBlocksEnabled(snap.data()?.strengthBlocksEnabled)
        );
      } catch (err) {
        if (!isMounted) return;
        console.error("booking settings fetch error:", err);
      }
    }

    loadBookingSettings();

    return () => {
      isMounted = false;
    };
  }, []);

  // Load this user's active bookings once. Successful book/cancel actions update
  // local state immediately, avoiding an always-on listener while scrolling.
  useEffect(() => {
    if (!user) {
      setActiveBookingsByClassId({});
      return;
    }

    const bookingsRef = collection(db, "bookings");
    const q = query(bookingsRef, where("userId", "==", user.uid), where("status", "==", "booked"));

    async function loadBookings() {
      try {
        const snap = await getDocs(q);
        if (!isMounted) return;
        const map: Record<string, BookingDoc> = {};
        snap.docs.forEach((d) => {
          const b = d.data() as BookingDoc;
          if (b?.classId) map[b.classId] = b;
        });
        setActiveBookingsByClassId(map);
      } catch (err) {
        if (!isMounted) return;
        console.error("bookings fetch error:", err);
      }
    }

    let isMounted = true;
    loadBookings();

    return () => {
      isMounted = false;
    };
  }, [user]);

  const memberStrengthBlock = normalizeStrengthBlock(appUser?.strengthBlock);
  const visibleClasses = useMemo(
    () =>
      classes.filter(({ data }) =>
        canAccessClass(data, memberStrengthBlock, isAdmin, strengthBlocksEnabled)
      ),
    [classes, isAdmin, memberStrengthBlock, strengthBlocksEnabled]
  );

  const weekDays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => {
        const d = new Date(windowLocal.from);
        d.setDate(d.getDate() + index);
        return d;
      }),
    [windowLocal.from]
  );

  const classCountsByDay = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of visibleClasses) {
      const key = dayKey(c.data.startTime.toDate(), c.data.timezone || DEFAULT_TZ);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [visibleClasses]);

  const selectedDayClasses = useMemo(
    () =>
      visibleClasses.filter(
        ({ data }) => dayKey(data.startTime.toDate(), data.timezone || DEFAULT_TZ) === selectedDayKey
      ),
    [selectedDayKey, visibleClasses]
  );

  const selectedDate =
    weekDays.find((day) => dayKey(day) === selectedDayKey) ?? weekDays[0] ?? windowLocal.from;

  const filteredSelectedDayClasses = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return selectedDayClasses;

    return selectedDayClasses.filter(({ data }) =>
      [data.title, data.coachName, data.location]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }, [searchTerm, selectedDayClasses]);

  const handleBook = useCallback(async (classId: string) => {
    if (!user) return alert("Log in first.");

    const classRow = classes.find((item) => item.id === classId);
    if (
      classRow &&
      !canAccessClass(classRow.data, memberStrengthBlock, isAdmin, strengthBlocksEnabled)
    ) {
      return alert("You are not assigned to the strength block for this class.");
    }

    setBusyClassId(classId);
    try {
      await bookClassCallable({ classId });
      setActiveBookingsByClassId((current) => ({
        ...current,
        [classId]: {
          classId,
          userId: user.uid,
          userName: appUser?.name,
          status: "booked",
        },
      }));
      setClasses((current) => adjustClassBookedCount(current, classId, 1));
    } catch (e: any) {
      console.error("Book failed:", e);
      const message = String(e?.message ?? "");
      if (e?.code === "already-exists" || message.includes("Already booked")) return alert("Already booked");
      if (e?.code === "failed-precondition" && message.includes("Class is full")) return alert("Class is full");
      if (e?.code === "failed-precondition" && message.includes("Booking closed")) return alert("Booking closed for this class");
      if (e?.code === "permission-denied" || message.includes("strength block")) {
        return alert("You are not assigned to the strength block for this class.");
      }
      alert(message || "Booking failed");
    } finally {
      setBusyClassId(null);
    }
  }, [appUser?.name, classes, isAdmin, memberStrengthBlock, strengthBlocksEnabled, user]);

  const handleCancel = useCallback(async (classId: string) => {
    if (!user) return alert("Log in first.");

    setBusyClassId(classId);
    try {
      await cancelBookingCallable({ classId });
      setActiveBookingsByClassId((current) => {
        const next = { ...current };
        delete next[classId];
        return next;
      });
      setClasses((current) => adjustClassBookedCount(current, classId, -1));
    } catch (e: any) {
      console.error("Cancel failed:", e);
      const message = String(e?.message ?? "");
      if (e?.code === "not-found" || message.includes("No active booking") || message.includes("No booking")) return alert("No active booking found");
      if (e?.code === "failed-precondition" && message.includes("Cancellation closed"))
        return alert("Too late to cancel — cancellations close 1 hour before class.");
      alert(message || "Cancel failed");
    } finally {
      setBusyClassId(null);
    }
  }, [user]);

  const weekLabel = useMemo(() => {
    const a = windowLocal.from.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const endMinus1 = new Date(windowLocal.to.getTime() - 1);
    const b = endMinus1.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    return `${a} - ${b}`;
  }, [windowLocal.from, windowLocal.to]);

  const handleRoster = useCallback((classId: string) => {
    navigate(`/admin/classes/${classId}`);
  }, [navigate]);

  const navItems = getUserNavItems(appUser?.role);
  const firstName = appUser?.name?.split(" ")[0] || appUser?.email?.split("@")[0] || "there";
  const profilePhotoURL = appUser?.photoURL || user?.photoURL || "";

  return (
    <div className="carbon-fiber-bg min-h-screen overflow-x-hidden text-[#f4f0ea]">
      <main className="relative mx-auto min-h-screen max-w-xl px-5 pb-32 pt-7 sm:max-w-3xl sm:px-8">
        <header className="flex items-center justify-between" style={{ paddingTop: "env(safe-area-inset-top)" }}>
          <Link to="/dashboard" aria-label="Zero Alpha home" className="block">
            <img src="/ZERO-ALPHA.png" alt="ZERO-ALPHA" className="h-20 w-auto object-contain" />
          </Link>
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Search schedule"
              aria-pressed={searchOpen}
              onClick={() => setSearchOpen((open) => !open)}
              className="grid h-12 w-12 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white/55 transition hover:bg-white/[0.08] hover:text-white"
            >
              <Search className="h-5 w-5" />
            </button>
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

        <section className="mt-12 sm:mt-16">
          <p className="text-[12px] font-bold uppercase tracking-[0.28em] text-white/34">
            {weekLabel}
          </p>
          <h1 className="mt-3 font-heading text-[4rem] uppercase leading-none tracking-[0.01em] text-white sm:text-[5.7rem]">
            Schedule
          </h1>
        </section>

        {searchOpen ? (
          <section className="mt-6">
            <label className="sr-only" htmlFor="schedule-search">
              Search schedule
            </label>
            <input
              id="schedule-search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search class, coach, location"
              className="w-full rounded-[18px] border border-white/10 bg-[#151311] px-5 py-4 text-[15px] text-white outline-none placeholder:text-white/28 focus:border-white/25"
            />
          </section>
        ) : null}

        <section className="mt-8">
          <div className="flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {weekDays.map((day) => {
              const key = dayKey(day);
              const selected = key === selectedDayKey;
              const count = classCountsByDay[key] ?? 0;

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedDayKey(key)}
                  className={[
                    "grid min-h-[110px] min-w-[78px] place-items-center rounded-[18px] border px-3 py-4 text-center transition",
                    selected
                      ? "border-[#f2eee8] bg-[#f2eee8] text-black"
                      : "border-white/10 bg-[#151311] text-white/42 hover:bg-[#1b1815] hover:text-white/70",
                  ].join(" ")}
                >
                  <span className="text-[12px] font-bold uppercase tracking-[0.16em]">{shortWeekday(day)}</span>
                  <span className="font-heading text-3xl leading-none">{dayNumber(day)}</span>
                  <span className={selected ? "h-1.5 w-1.5 rounded-full bg-black" : "h-1.5 w-1.5 rounded-full bg-white/55"} />
                  <span className="sr-only">{count} sessions</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mt-9">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <h2 className="font-heading text-4xl uppercase leading-none text-white">
                {shortDayLabel(selectedDate)}
              </h2>
              <p className="mt-2 text-sm text-white/36">
                {filteredSelectedDayClasses.length} {filteredSelectedDayClasses.length === 1 ? "session" : "sessions"}
              </p>
            </div>
            <div className="text-sm font-bold text-white/58">
              {windowLocal.showNextWeek ? "Next week" : "This week"}
            </div>
          </div>

          {filteredSelectedDayClasses.length === 0 ? (
            <div className="rounded-[24px] border border-white/10 bg-[#151311] p-7">
              <p className="font-heading text-4xl uppercase leading-none text-white">
                {searchTerm.trim() ? "No matches" : "No sessions"}
              </p>
              <p className="mt-4 text-sm leading-6 text-white/48">
                {searchTerm.trim()
                  ? "Try a different class, coach, or location."
                  : "Nothing is scheduled for this day."}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredSelectedDayClasses.map(({ id, data }) => (
                <ScheduleClassCard
                  key={id}
                  id={id}
                  data={data}
                  booked={Boolean(activeBookingsByClassId[id])}
                  busy={busyClassId === id}
                  isAdmin={isAdmin}
                  onBook={handleBook}
                  onCancel={handleCancel}
                  onRoster={handleRoster}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      <nav
        className="fixed inset-x-3 z-40 mx-auto max-w-[27rem] rounded-[22px] border border-white/35 bg-white/95 px-2 py-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.22)] sm:max-w-xl"
        style={{ bottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        aria-label="Primary"
      >
        <div className="flex gap-1 overflow-x-auto px-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                [
                  "flex min-w-[56px] shrink-0 flex-col items-center gap-0.5 rounded-[14px] px-1.5 py-1 text-[10px] font-extrabold leading-tight transition",
                  isActive ? "bg-black/12 text-black" : "text-black hover:bg-black/6",
                ].join(" ")
              }
            >
              <Icon className="h-[18px] w-[18px] text-black" />
              <span className="max-w-[56px] truncate leading-tight text-black">{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

const ScheduleClassCard = React.memo(function ScheduleClassCard({
  id,
  data,
  booked,
  busy,
  isAdmin,
  onBook,
  onCancel,
  onRoster,
}: {
  id: string;
  data: ClassDoc;
  booked: boolean;
  busy: boolean;
  isAdmin: boolean;
  onBook: (classId: string) => void;
  onCancel: (classId: string) => void;
  onRoster: (classId: string) => void;
}) {
  const tz = data.timezone || DEFAULT_TZ;
  const start = data.startTime.toDate();
  const end = data.endTime.toDate();
  const capacity = Number(data.capacity ?? 0);
  const bookedCount = Number(data.bookedCount ?? 0);
  const full = capacity > 0 && bookedCount >= capacity;
  const bs = bookingStatus(data.startTime);
  const bookingClosed = bs.state === "closed" || bs.state === "started";
  const cs = cancelStatus(data.startTime);
  const cancelClosed = cs.state === "closed" || cs.state === "started";
  const meta = typeMeta(data.title);
  const Icon = meta.icon;
  const showChili = isTuesdayHyroxClass(data);
  const percent = capacityPercent(bookedCount, capacity);
  const waitlist = capacity > 0 ? Math.max(0, bookedCount - capacity) : 0;

  return (
    <article
      className="rounded-[24px] border border-white/10 bg-[#151311] p-4 shadow-[0_12px_34px_rgba(0,0,0,0.18)]"
      style={{ contentVisibility: "auto", containIntrinsicSize: "220px" } as React.CSSProperties}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 font-mono text-[13px] font-bold leading-none text-white/78">
              {fmtTime(start, tz)} - {fmtTime(end, tz)}
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.18em] text-white/42">
              {waitlist > 0 ? "Waitlist" : "Spots"} {bookedCount}/{capacity || "-"}
            </span>
          </div>
          <h3 className="mt-4 font-heading text-3xl uppercase leading-none text-white sm:text-4xl">
            {meta.label}
          </h3>
          <p className="mt-3 truncate text-[15px] font-medium text-white/44">
            {[data.coachName, data.location].filter(Boolean).join(" · ") || "AlphaFIT"}
          </p>
        </div>
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl border ${meta.iconWrap}`}>
          {showChili ? (
            <span role="img" aria-label="Chili pepper" className="text-[1.35rem] leading-none">
              🌶️
            </span>
          ) : (
            <Icon className="h-5 w-5" />
          )}
        </div>
      </div>

      <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/8">
        <div className={`h-full rounded-full ${meta.accent}`} style={{ width: `${percent}%` }} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {booked ? (
          <span className="rounded-full bg-emerald-400/12 px-4 py-2 text-[12px] font-bold uppercase tracking-[0.12em] text-emerald-200">
            Booked
          </span>
        ) : null}
        {!booked && full ? (
          <span className="rounded-full bg-red-400/12 px-4 py-2 text-[12px] font-bold uppercase tracking-[0.12em] text-red-200">
            Full
          </span>
        ) : null}
        {!booked && !full && bs.state === "open" && bs.msLeft != null ? (
          <span className="rounded-full bg-[#8a633e]/24 px-4 py-2 text-[12px] font-bold uppercase tracking-[0.12em] text-[#f4b16d]">
            Closes in {fmtRemaining(bs.msLeft)}
          </span>
        ) : null}
        {!booked && bookingClosed ? (
          <span className="rounded-full bg-white/[0.06] px-4 py-2 text-[12px] font-bold uppercase tracking-[0.12em] text-white/36">
            Booking closed
          </span>
        ) : null}
        {booked && cancelClosed ? (
          <span className="rounded-full bg-white/[0.06] px-4 py-2 text-[12px] font-bold uppercase tracking-[0.12em] text-white/36">
            Cancellation closed
          </span>
        ) : null}
      </div>

      <div className="mt-5 flex flex-col gap-3 border-t border-white/8 pt-4 sm:flex-row">
        {isAdmin ? (
          <button
            type="button"
            onClick={() => onRoster(id)}
            className="rounded-full bg-white/[0.06] px-5 py-4 text-sm font-bold text-white transition hover:bg-white/[0.1] sm:min-w-[120px]"
          >
            Roster
          </button>
        ) : null}

        {booked ? (
          <button
            type="button"
            onClick={() => onCancel(id)}
            disabled={busy || cancelClosed}
            className="rounded-full bg-[#f2eee8] px-5 py-4 text-sm font-bold text-black transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-35 sm:min-w-[150px]"
          >
            {cancelClosed ? "Too late" : busy ? "Cancelling..." : "Cancel booking"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onBook(id)}
            disabled={busy || full || bookingClosed}
            className="rounded-full bg-[#f2eee8] px-5 py-4 text-sm font-bold text-black transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-35 sm:min-w-[150px]"
          >
            {bookingClosed ? "Closed" : busy ? "Booking..." : full ? "Join queue" : "Book session"}
          </button>
        )}
      </div>
    </article>
  );
});
