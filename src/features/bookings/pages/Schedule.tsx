// src/pages/Schedule.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { ConditioningSlotKey } from "../../../context/authUser";
import { getUserNavItems } from "../../../components/layout/UserTopNav";
import { isLimitedAppUser } from "../../../lib/appAccess";
import { CONDITIONING_SLOT_OPTIONS } from "../../../lib/membershipPlans";
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
  conditioningSlotKey?: ConditioningSlotKey | null;
};

type BookingDoc = {
  classId: string;
  userId: string;
  userName?: string;
  status: "booked" | "cancelled";
  conditioningQuotaWeekKey?: string;
  conditioningQuotaWeeklyLimit?: number;
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
type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function zonedDateParts(value: Date, timeZone: string): ZonedDateParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((entry) => entry.type === type)?.value ?? 0);
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
    second: part("second"),
  };
}

function zonedDateTimeToDate(parts: ZonedDateParts, timeZone: string) {
  const desiredAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  let instant = desiredAsUtc;

  // Resolve the zone offset at the requested wall-clock time. A few passes
  // also cover the offset changing between the initial UTC guess and target.
  for (let pass = 0; pass < 4; pass += 1) {
    const actual = zonedDateParts(new Date(instant), timeZone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second
    );
    const adjustment = desiredAsUtc - actualAsUtc;
    instant += adjustment;
    if (adjustment === 0) break;
  }

  return new Date(instant);
}

function parseDayKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

function dayKeyFromParts({ year, month, day }: Pick<ZonedDateParts, "year" | "month" | "day">) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function shiftDayKey(value: string, days: number) {
  const { year, month, day } = parseDayKey(value);
  const shifted = new Date(Date.UTC(year, month - 1, day + days, 12));
  return dayKeyFromParts({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

function dateForDayKey(value: string) {
  const { year, month, day } = parseDayKey(value);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function dateAtStartOfDay(value: string, timeZone: string) {
  return zonedDateTimeToDate(
    { ...parseDayKey(value), hour: 0, minute: 0, second: 0 },
    timeZone
  );
}

export function computeBookingClosesAt(startTs?: Timestamp, timeZone = DEFAULT_TZ) {
  const start = startTs?.toDate?.();
  if (!start) return null;

  const startParts = zonedDateParts(start, timeZone);
  const startDayKey = dayKeyFromParts(startParts);

  if (startParts.hour === 5 || startParts.hour === 6) {
    return zonedDateTimeToDate(
      { ...parseDayKey(shiftDayKey(startDayKey, -1)), hour: 21, minute: 0, second: 0 },
      timeZone
    );
  }

  if (startParts.hour === 18) {
    return zonedDateTimeToDate(
      { ...parseDayKey(startDayKey), hour: 15, minute: 0, second: 0 },
      timeZone
    );
  }

  return new Date(start.getTime() - 2 * 60 * 60 * 1000);
}

function bookingStatus(startTs?: Timestamp, timeZone = DEFAULT_TZ) {
  const start = startTs?.toDate?.();
  if (!start) return { state: "unknown" as const };

  const closes = computeBookingClosesAt(startTs, timeZone);
  const now = Date.now();

  if (now >= start.getTime()) return { state: "started" as const, closes };
  if (closes && now >= closes.getTime()) return { state: "closed" as const, closes };

  return {
    state: "open" as const,
    closes,
    msLeft: closes ? closes.getTime() - now : 0,
  };
}

function normalizeStrengthBlock(value: unknown): StrengthBlock {
  return value === "A" || value === "B" ? value : "none";
}

const CONDITIONING_SLOT_BY_DAY_TIME: Record<string, ConditioningSlotKey> = {
  "Monday|06:00": "monday_0600",
  "Tuesday|18:00": "tuesday_1800",
  "Thursday|18:00": "thursday_1800",
  "Friday|05:30": "friday_0530",
};

function getConditioningSlotForClass(classData: ClassDoc): ConditioningSlotKey | null {
  if (classData.timezone !== DEFAULT_TZ || classData.conditioningSlotKey === null) {
    return null;
  }
  const start = classData.startTime?.toDate?.();
  if (!start) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: DEFAULT_TZ,
  }).formatToParts(start);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  const derived = CONDITIONING_SLOT_BY_DAY_TIME[`${part("weekday")}|${part("hour")}:${part("minute")}`] ?? null;
  if (classData.conditioningSlotKey !== undefined) {
    return classData.conditioningSlotKey === derived ? derived : null;
  }
  return derived;
}

type ClassAccess = {
  allowed: boolean;
  reason?: "not_conditioning_slot" | "conditioning_class_not_in_agreement" | "strength_block";
  message?: string;
};

function resolveClassAccess({
  classData,
  limited,
  entitlementClassSlots,
  entitlementWeeklyBookingLimit,
  strengthBlock,
  isAdmin,
  strengthBlocksEnabled,
}: {
  classData: ClassDoc;
  limited: boolean;
  entitlementClassSlots: ConditioningSlotKey[];
  entitlementWeeklyBookingLimit?: number;
  strengthBlock: StrengthBlock;
  isAdmin: boolean;
  strengthBlocksEnabled: boolean;
}): ClassAccess {
  if (limited) {
    const conditioningSlot = getConditioningSlotForClass(classData);
    if (!conditioningSlot) {
      return {
        allowed: false,
        reason: "not_conditioning_slot",
        message: "Conditioning Only covers the four eligible classes shown in your weekly allowance.",
      };
    }
    // Current memberships can use any of the four eligible classes and are
    // capped by the server across the Monday–Sunday week. Historical v6
    // memberships retain their original fixed-slot eligibility.
    if (entitlementWeeklyBookingLimit === undefined &&
        !entitlementClassSlots.includes(conditioningSlot)) {
      return {
        allowed: false,
        reason: "conditioning_class_not_in_agreement",
        message: "This class is not included in your current Conditioning agreement.",
      };
    }
  }
  if (!canAccessClass(classData, strengthBlock, isAdmin, strengthBlocksEnabled)) {
    return {
      allowed: false,
      reason: "strength_block",
      message: "You are not assigned to the strength block for this class.",
    };
  }
  return { allowed: true };
}

function getStrengthSlotForClass(classData: ClassDoc): "A" | "B" | null {
  const title = String(classData.title ?? "").toLowerCase();
  if (!title.includes("strength")) return null;

  const start = classData.startTime?.toDate?.();
  if (!start) return null;

  const timeZone = classData.timezone || DEFAULT_TZ;
  const parts = zonedDateParts(start, timeZone);
  const day = dateForDayKey(dayKeyFromParts(parts)).getUTCDay(); // Sun=0 ... Sat=6
  const hour = parts.hour;

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
  return dayKeyFromParts(zonedDateParts(d, timeZone));
}

function shortWeekday(d: Date) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" })
    .format(d)
    .toUpperCase();
}

function dayNumber(d: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", timeZone: "UTC" }).format(d);
}

function shortDayLabel(d: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(d);
}

function formatCutoff(value: Date, timeZone: string) {
  const formatted = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(value);
  return timeZone === DEFAULT_TZ ? `${formatted} UK time` : `${formatted} ${timeZone}`;
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
function cancelStatus(startTs?: Timestamp, timeZone = DEFAULT_TZ) {
  return bookingStatus(startTs, timeZone);
}

/** Visible Monday–Sunday schedule, with Saturday 10:00 cutover in London. */
export function scheduleWindowWithSaturdayCutover(now = new Date()) {
  const currentDayKey = dayKey(now, DEFAULT_TZ);
  const currentWeekday = dateForDayKey(currentDayKey).getUTCDay();
  const thisMondayKey = shiftDayKey(currentDayKey, -((currentWeekday + 6) % 7));
  const saturdayKey = shiftDayKey(thisMondayKey, 5);
  const cutover = zonedDateTimeToDate(
    { ...parseDayKey(saturdayKey), hour: 10, minute: 0, second: 0 },
    DEFAULT_TZ
  );
  const showNextWeek = now.getTime() >= cutover.getTime();
  const fromDayKey = shiftDayKey(thisMondayKey, showNextWeek ? 7 : 0);
  const toDayKey = shiftDayKey(fromDayKey, 7);

  return {
    from: dateAtStartOfDay(fromDayKey, DEFAULT_TZ),
    to: dateAtStartOfDay(toDayKey, DEFAULT_TZ),
    fromDayKey,
    toDayKey,
    showNextWeek,
  };
}

async function fetchActiveBookings(userId: string) {
  const bookingsRef = collection(db, "bookings");
  const q = query(bookingsRef, where("userId", "==", userId), where("status", "==", "booked"));
  const snap = await getDocs(q);
  const map: Record<string, BookingDoc> = {};
  snap.docs.forEach((bookingSnapshot) => {
    const booking = bookingSnapshot.data() as BookingDoc;
    if (booking?.classId) map[booking.classId] = booking;
  });
  return map;
}

function confirmedConditioningUsage(
  bookings: Record<string, BookingDoc>,
  weekKey: string,
  weeklyLimit: number
) {
  return Object.values(bookings).filter(
    (booking) =>
      booking.status === "booked" &&
      booking.conditioningQuotaWeekKey === weekKey &&
      booking.conditioningQuotaWeeklyLimit === weeklyLimit
  ).length;
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
  const userId = user?.uid;
  const isAdmin = appUser?.role === "admin";
  const limitedAccess = isLimitedAppUser(appUser);

  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [classesError, setClassesError] = useState("");
  const [classesLoadAttempt, setClassesLoadAttempt] = useState(0);
  const [activeBookingsByClassId, setActiveBookingsByClassId] = useState<Record<string, BookingDoc>>(
    {}
  );
  const [loadingBookings, setLoadingBookings] = useState(true);
  const [bookingsError, setBookingsError] = useState("");
  const [bookingsLoadAttempt, setBookingsLoadAttempt] = useState(0);
  const [bookingAnnouncement, setBookingAnnouncement] = useState("");
  const [busyClassId, setBusyClassId] = useState<string | null>(null);
  const bookingActionLock = useRef(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [strengthBlocksEnabled, setStrengthBlocksEnabled] = useState(true);
  const [selectedDayKey, setSelectedDayKey] = useState(() => {
    const today = new Date(Date.now());
    const windowLocal = scheduleWindowWithSaturdayCutover(today);
    return today >= windowLocal.from && today < windowLocal.to
      ? dayKey(today)
      : windowLocal.fromDayKey;
  });

  // One London calendar week at a time, with the Saturday publishing cutover.
  const windowLocal = useMemo(
    () => scheduleWindowWithSaturdayCutover(new Date(Date.now())),
    []
  );

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
      setLoadingClasses(true);
      setClassesError("");
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
        setClassesError("We couldn’t load the schedule. Check your connection and try again.");
      } finally {
        if (isMounted) setLoadingClasses(false);
      }
    }

    loadClasses();

    return () => {
      isMounted = false;
    };
  }, [classesLoadAttempt, windowLocal.from, windowLocal.to]);

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

  // Verify this user's current bookings before showing any booking state or
  // enabling actions. The server remains authoritative after every mutation.
  useEffect(() => {
    if (!userId) {
      setActiveBookingsByClassId({});
      setBookingsError("");
      setLoadingBookings(false);
      return;
    }
    const activeUserId = userId;

    let isMounted = true;

    async function loadBookings() {
      setLoadingBookings(true);
      setBookingsError("");
      try {
        const map = await fetchActiveBookings(activeUserId);
        if (!isMounted) return;
        setActiveBookingsByClassId(map);
      } catch (err) {
        if (!isMounted) return;
        console.error("bookings fetch error:", err);
        setBookingsError(
          "We couldn’t verify your bookings. Booking and cancellation controls are paused."
        );
      } finally {
        if (isMounted) setLoadingBookings(false);
      }
    }

    loadBookings();

    return () => {
      isMounted = false;
    };
  }, [bookingsLoadAttempt, userId]);

  const memberStrengthBlock = normalizeStrengthBlock(appUser?.strengthBlock);
  const entitlementClassSlots = useMemo(
    () => appUser?.entitlementClassSlots ?? [],
    [appUser?.entitlementClassSlots]
  );
  const entitlementWeeklyBookingLimit = appUser?.entitlementWeeklyBookingLimit;
  const visibleClasses = useMemo(
    () =>
      limitedAccess ? classes : classes.filter(({ data }) =>
        canAccessClass(data, memberStrengthBlock, isAdmin, strengthBlocksEnabled)
      ),
    [classes, isAdmin, limitedAccess, memberStrengthBlock, strengthBlocksEnabled]
  );

  const weekDays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) =>
        dateForDayKey(shiftDayKey(windowLocal.fromDayKey, index))
      ),
    [windowLocal.fromDayKey]
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

  const bookingState: "loading" | "error" | "ready" = loadingBookings
    ? "loading"
    : bookingsError || !user
    ? "error"
    : "ready";
  const bookingsVerified = bookingState === "ready";
  const confirmedWeeklyUsage = useMemo(
    () =>
      typeof entitlementWeeklyBookingLimit === "number"
        ? confirmedConditioningUsage(
            activeBookingsByClassId,
            windowLocal.fromDayKey,
            entitlementWeeklyBookingLimit
          )
        : 0,
    [
      activeBookingsByClassId,
      entitlementWeeklyBookingLimit,
      windowLocal.fromDayKey,
    ]
  );
  const confirmedWeeklyRemaining = Math.max(
    0,
    Number(entitlementWeeklyBookingLimit ?? 0) - confirmedWeeklyUsage
  );

  const refreshBookingsAfterMutation = useCallback(
    async (verb: "Booked" | "Cancelled", classTitle: string) => {
      if (!user) return;
      setLoadingBookings(true);
      setBookingsError("");
      try {
        const map = await fetchActiveBookings(user.uid);
        setActiveBookingsByClassId(map);
        if (limitedAccess && typeof entitlementWeeklyBookingLimit === "number") {
          const used = confirmedConditioningUsage(
            map,
            windowLocal.fromDayKey,
            entitlementWeeklyBookingLimit
          );
          const remaining = Math.max(0, entitlementWeeklyBookingLimit - used);
          setBookingAnnouncement(
            `${verb} ${classTitle}. ${used} of ${entitlementWeeklyBookingLimit} Conditioning bookings used; ${remaining} remaining this Monday–Sunday week.`
          );
        } else {
          setBookingAnnouncement(`${verb} ${classTitle}.`);
        }
      } catch (error) {
        console.error("bookings refresh error:", error);
        setBookingsError(
          "Your change was saved, but we couldn’t refresh your bookings. Try again before making another change."
        );
        setBookingAnnouncement(
          `${verb} ${classTitle}. We couldn’t refresh your ${limitedAccess ? "remaining allowance" : "booking status"} yet.`
        );
      } finally {
        setLoadingBookings(false);
      }
    },
    [entitlementWeeklyBookingLimit, limitedAccess, user, windowLocal.fromDayKey]
  );

  const handleBook = useCallback(async (classId: string) => {
    if (!user) return alert("Log in first.");
    if (!bookingsVerified) {
      return alert("Wait until your bookings have been verified, then try again.");
    }
    if (bookingActionLock.current) return;

    const classRow = classes.find((item) => item.id === classId);
    if (classRow) {
      const access = resolveClassAccess({
        classData: classRow.data,
        limited: limitedAccess,
        entitlementClassSlots,
        entitlementWeeklyBookingLimit,
        strengthBlock: memberStrengthBlock,
        isAdmin,
        strengthBlocksEnabled,
      });
      if (!access.allowed) return alert(access.message || "This class is not included in your membership.");
    }

    bookingActionLock.current = true;
    setBusyClassId(classId);
    setBookingAnnouncement("");
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
      await refreshBookingsAfterMutation("Booked", classRow?.data.title || "class");
    } catch (e: any) {
      console.error("Book failed:", e);
      const message = String(e?.message ?? "");
      if (e?.code === "already-exists" || message.includes("Already booked")) return alert("Already booked");
      if (e?.code === "failed-precondition" && message.includes("Class is full")) return alert("Class is full");
      if (e?.code === "failed-precondition" && message.includes("Booking closed")) return alert("Booking closed for this class");
      const reason = e?.details?.reason;
      if (reason === "class_not_conditioning_membership_slot") {
        return alert("Conditioning Only covers the four eligible classes shown in your weekly allowance.");
      }
      if (reason === "conditioning_slot_not_selected") {
        return alert("This class is not included in your current Conditioning agreement.");
      }
      if (reason === "conditioning_weekly_booking_limit_reached") {
        return alert("You’ve used both Conditioning bookings for this Monday–Sunday week. Cancel an eligible booking before its cutoff to choose another class.");
      }
      if (e?.code === "permission-denied" || message.includes("strength block")) {
        return alert("You are not assigned to the strength block for this class.");
      }
      alert(message || "Booking failed");
    } finally {
      bookingActionLock.current = false;
      setBusyClassId(null);
    }
  }, [appUser?.name, bookingsVerified, classes, entitlementClassSlots, entitlementWeeklyBookingLimit, isAdmin, limitedAccess, memberStrengthBlock, refreshBookingsAfterMutation, strengthBlocksEnabled, user]);

  const handleCancel = useCallback(async (classId: string) => {
    if (!user) return alert("Log in first.");
    if (!bookingsVerified) {
      return alert("Wait until your bookings have been verified, then try again.");
    }
    if (bookingActionLock.current) return;

    const classRow = classes.find((item) => item.id === classId);
    bookingActionLock.current = true;
    setBusyClassId(classId);
    setBookingAnnouncement("");
    try {
      await cancelBookingCallable({ classId });
      setActiveBookingsByClassId((current) => {
        const next = { ...current };
        delete next[classId];
        return next;
      });
      setClasses((current) => adjustClassBookedCount(current, classId, -1));
      await refreshBookingsAfterMutation("Cancelled", classRow?.data.title || "class");
    } catch (e: any) {
      console.error("Cancel failed:", e);
      const message = String(e?.message ?? "");
      if (e?.code === "not-found" || message.includes("No active booking") || message.includes("No booking")) return alert("No active booking found");
      if (e?.code === "failed-precondition" && message.includes("Cancellation closed")) {
        const timeZone = classRow?.data.timezone || DEFAULT_TZ;
        const closesAt = computeBookingClosesAt(classRow?.data.startTime, timeZone);
        return alert(
          closesAt
            ? `Cancellation closed at ${formatCutoff(closesAt, timeZone)}.`
            : "Cancellation is closed for this class."
        );
      }
      alert(message || "Cancel failed");
    } finally {
      bookingActionLock.current = false;
      setBusyClassId(null);
    }
  }, [bookingsVerified, classes, refreshBookingsAfterMutation, user]);

  const weekLabel = useMemo(() => {
    const a = dateForDayKey(windowLocal.fromDayKey).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
    const b = dateForDayKey(shiftDayKey(windowLocal.toDayKey, -1)).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
    return `${a} - ${b}`;
  }, [windowLocal.fromDayKey, windowLocal.toDayKey]);

  const handleRoster = useCallback((classId: string) => {
    navigate(`/admin/classes/${classId}`);
  }, [navigate]);

  const navItems = getUserNavItems(appUser);
  const firstName = appUser?.name?.split(" ")[0] || appUser?.email?.split("@")[0] || "there";
  const profilePhotoURL = appUser?.photoURL || user?.photoURL || "";

  return (
    <div className="carbon-fiber-bg min-h-screen overflow-x-hidden text-[#f4f0ea]">
      <main className="relative mx-auto min-h-screen max-w-xl px-5 pb-32 pt-7 sm:max-w-3xl sm:px-8">
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {bookingAnnouncement}
        </p>
        <header className="flex items-center justify-between" style={{ paddingTop: "env(safe-area-inset-top)" }}>
          <Link to={limitedAccess ? "/schedule" : "/dashboard"} aria-label="Zero Alpha home" className="block">
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

        {limitedAccess && entitlementWeeklyBookingLimit === 2 ? (
          <section
            className="mt-7 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-5"
            aria-labelledby="conditioning-weekly-allowance-title"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-lg">
                <h2
                  id="conditioning-weekly-allowance-title"
                  className="font-heading text-2xl uppercase text-white"
                >
                  Your weekly allowance
                </h2>
                <p className="mt-2 text-sm leading-6 text-amber-50/78">
                  Book up to {entitlementWeeklyBookingLimit ?? 2} eligible Conditioning
                  classes in each Monday–Sunday week. Your choices can change every week.
                </p>
              </div>
              <p
                className="rounded-xl border border-amber-200/25 bg-black/20 px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-amber-100"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {loadingBookings
                  ? "Checking confirmed bookings…"
                  : bookingsError
                  ? "Allowance unavailable"
                  : `${confirmedWeeklyUsage} of ${entitlementWeeklyBookingLimit} booked · ${confirmedWeeklyRemaining} remaining`}
              </p>
            </div>
            <p className="mt-4 text-xs leading-5 text-amber-50/60">
              Eligible: {CONDITIONING_SLOT_OPTIONS.map(({label}) => label).join(" · ")}.
              Cancel before the class cutoff to free that booking and choose another.
            </p>
            <p className="mt-2 text-xs leading-5 text-amber-50/60">
              The count comes from your server-confirmed bookings for the London-time week shown here.
            </p>
          </section>
        ) : null}

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
                  aria-pressed={selected}
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
                {loadingClasses
                  ? "Loading sessions…"
                  : classesError
                  ? "Schedule unavailable"
                  : `${filteredSelectedDayClasses.length} ${filteredSelectedDayClasses.length === 1 ? "session" : "sessions"}`}
              </p>
            </div>
            <div className="text-sm font-bold text-white/58">
              {windowLocal.showNextWeek ? "Next week" : "This week"}
            </div>
          </div>

          {!loadingClasses && !classesError && loadingBookings ? (
            <div
              className="mb-4 rounded-xl border border-white/10 bg-white/[0.04] p-4 text-sm leading-6 text-white/65"
              role="status"
            >
              Checking your current bookings. Actions will unlock when they are verified.
            </div>
          ) : null}

          {!loadingClasses && !classesError && bookingsError ? (
            <div
              className="mb-4 rounded-xl border border-red-400/25 bg-red-400/10 p-4 text-sm leading-6 text-red-100"
              role="alert"
            >
              <p>{bookingsError}</p>
              <button
                type="button"
                onClick={() => setBookingsLoadAttempt((attempt) => attempt + 1)}
                className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#f2eee8] px-4 py-2 font-bold text-black outline-none transition hover:bg-white focus-visible:ring-2 focus-visible:ring-white"
              >
                Retry booking status
              </button>
            </div>
          ) : null}

          {loadingClasses ? (
            <div className="space-y-4" role="status" aria-live="polite">
              <span className="sr-only">Loading schedule…</span>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  aria-hidden="true"
                  className="h-[220px] animate-pulse rounded-[24px] border border-white/10 bg-[#151311]"
                />
              ))}
            </div>
          ) : classesError ? (
            <div className="rounded-[24px] border border-red-400/25 bg-red-400/10 p-7" role="alert">
              <h3 className="font-heading text-4xl uppercase leading-none text-white">
                Schedule unavailable
              </h3>
              <p className="mt-4 text-sm leading-6 text-red-100">{classesError}</p>
              <button
                type="button"
                onClick={() => setClassesLoadAttempt((attempt) => attempt + 1)}
                className="mt-5 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#f2eee8] px-5 py-3 text-sm font-bold text-black outline-none transition hover:bg-white focus-visible:ring-2 focus-visible:ring-white"
              >
                Retry schedule
              </button>
            </div>
          ) : filteredSelectedDayClasses.length === 0 ? (
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
                  actionsLocked={busyClassId !== null}
                  bookingState={bookingState}
                  isAdmin={isAdmin}
                  access={resolveClassAccess({
                    classData: data,
                    limited: limitedAccess,
                    entitlementClassSlots,
                    entitlementWeeklyBookingLimit,
                    strengthBlock: memberStrengthBlock,
                    isAdmin,
                    strengthBlocksEnabled,
                  })}
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
  actionsLocked,
  bookingState,
  isAdmin,
  access,
  onBook,
  onCancel,
  onRoster,
}: {
  id: string;
  data: ClassDoc;
  booked: boolean;
  busy: boolean;
  actionsLocked: boolean;
  bookingState: "loading" | "error" | "ready";
  isAdmin: boolean;
  access: ClassAccess;
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
  const bs = bookingStatus(data.startTime, tz);
  const bookingClosed = bs.state === "closed" || bs.state === "started";
  const cs = cancelStatus(data.startTime, tz);
  const cancelClosed = cs.state === "closed" || cs.state === "started";
  const meta = typeMeta(data.title);
  const Icon = meta.icon;
  const showChili = isTuesdayHyroxClass(data);
  const percent = capacityPercent(bookedCount, capacity);
  const waitlist = capacity > 0 ? Math.max(0, bookedCount - capacity) : 0;
  const bookingNotIncluded = bookingState === "ready" && !access.allowed && !booked;
  const bookingActionUnavailable = bookingState !== "ready";

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
            {[data.coachName, data.location].filter(Boolean).join(" · ") || "Zero Alpha Fitness"}
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
        {bookingNotIncluded ? (
          <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-4 py-2 text-[12px] font-bold uppercase tracking-[0.12em] text-amber-200">
            Not in your plan
          </span>
        ) : null}
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
        {bookingState === "loading" ? (
          <span className="rounded-full bg-white/[0.06] px-4 py-2 text-[12px] font-bold uppercase tracking-[0.12em] text-white/50">
            Checking booking
          </span>
        ) : bookingState === "error" ? (
          <span className="rounded-full bg-red-400/12 px-4 py-2 text-[12px] font-bold uppercase tracking-[0.12em] text-red-200">
            Booking unavailable
          </span>
        ) : null}
        {!booked && !full && bs.state === "open" && bs.closes ? (
          <span className="rounded-full bg-[#8a633e]/24 px-4 py-2 text-[12px] font-bold uppercase tracking-[0.12em] text-[#f4b16d]">
            Book by {formatCutoff(bs.closes, tz)}
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
        {booked && !cancelClosed && cs.closes ? (
          <span className="rounded-full bg-[#8a633e]/24 px-4 py-2 text-[12px] font-bold uppercase tracking-[0.12em] text-[#f4b16d]">
            Cancel by {formatCutoff(cs.closes, tz)}
          </span>
        ) : null}
      </div>

      {bookingNotIncluded ? (
        <div className="mt-4 rounded-xl border border-amber-300/15 bg-amber-300/[0.07] p-4">
          <p className="text-sm leading-6 text-amber-50/75">{access.message}</p>
        </div>
      ) : null}

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
            disabled={bookingActionUnavailable || actionsLocked || cancelClosed}
            className="rounded-full bg-[#f2eee8] px-5 py-4 text-sm font-bold text-black transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-35 sm:min-w-[150px]"
          >
            {bookingState === "loading"
              ? "Checking booking…"
              : bookingState === "error"
              ? "Booking unavailable"
              : cancelClosed
              ? "Too late"
              : busy
              ? "Cancelling..."
              : actionsLocked
              ? "Please wait…"
              : "Cancel booking"}
          </button>
        ) : bookingNotIncluded ? (
          <Link
            to="/memberships"
            className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-amber-300/25 bg-amber-300/10 px-5 py-3 text-sm font-bold text-amber-100 outline-none transition hover:bg-amber-300/15 focus-visible:ring-2 focus-visible:ring-amber-200 sm:min-w-[150px]"
          >
            View full access
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => onBook(id)}
            disabled={bookingActionUnavailable || actionsLocked || full || bookingClosed}
            className="rounded-full bg-[#f2eee8] px-5 py-4 text-sm font-bold text-black transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-35 sm:min-w-[150px]"
          >
            {bookingState === "loading"
              ? "Checking booking…"
              : bookingState === "error"
              ? "Booking unavailable"
              : bookingClosed
              ? "Closed"
              : busy
              ? "Booking..."
              : actionsLocked
              ? "Please wait…"
              : full
              ? "Join queue"
              : "Book session"}
          </button>
        )}
      </div>
    </article>
  );
});
