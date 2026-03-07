/* eslint-disable
  require-jsdoc,
  valid-jsdoc,
  max-len,
  @typescript-eslint/no-explicit-any,
  @typescript-eslint/no-unused-vars
*/

import {onCall, HttpsError} from "firebase-functions/v2/https";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {setGlobalOptions} from "firebase-functions/v2";
import * as admin from "firebase-admin";
import {DateTime} from "luxon";

setGlobalOptions({region: "europe-west1"});

admin.initializeApp();
const db = admin.firestore();

/** -----------------------------
 * Types
 * ----------------------------*/
type Role = "admin" | "user" | string;

type UserDoc = {
  name?: string;
  email?: string;
  role?: Role;
  photoURL?: string;
  stats?: {
    totalCheckIns?: number;
    monthCheckIns?: Record<string, number>;
    currentStreak?: number;
    longestStreak?: number;
    lastCheckInDate?: string; // YYYY-MM-DD (Europe/London)
    updatedAt?: admin.firestore.FieldValue | admin.firestore.Timestamp;
  };
};

type ClassTemplate = {
  title: string;
  dayOfWeek: number; // 0=Sun..6=Sat
  startTime: string; // "18:00"
  durationMinutes: number;
  timezone: string; // "Europe/London"
  coachId: string;
  coachName: string;
  capacity: number;
  location: string;
  isActive: boolean;
};

type ClassDoc = {
  templateId: string;
  title: string;
  timezone: string;
  startTime: admin.firestore.Timestamp;
  endTime: admin.firestore.Timestamp;
  coachId: string;
  coachName: string;
  capacity: number;
  bookedCount: number;
  location: string;
  status: "scheduled" | "cancelled";
  createdAt: admin.firestore.FieldValue | admin.firestore.Timestamp;
  updatedAt?: admin.firestore.FieldValue | admin.firestore.Timestamp;
};

type BookingDoc = {
  classId: string;
  userId: string;
  userName: string;

  // booking lifecycle
  status: "booked" | "cancelled";
  createdAt: admin.firestore.FieldValue | admin.firestore.Timestamp;
  cancelledAt?: admin.firestore.FieldValue | admin.firestore.Timestamp;
  cancelledReason?: "user_cancelled" | "authorised_absence" | string;

  // attendance (day-of)
  attendanceStatus?: "none" | "checked_in" | "dip"; // NEW
  attended?: boolean; // keep (used for leaderboard/stats)
  checkedInAt?: admin.firestore.FieldValue | admin.firestore.Timestamp | null;
  checkedInBy?: string | null;
};

type LeaderboardUserDoc = {
  userId: string;
  name: string;
  email: string;
  attendedCount: number;
  updatedAt: admin.firestore.FieldValue | admin.firestore.Timestamp;
};


/** -----------------------------
 * Helpers
 * ----------------------------*/
function requireAuth(request: Parameters<typeof onCall>[0] extends never ? never : any) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Login required.");
  return request.auth.uid as string;
}

function requireString(value: unknown, field: string): string {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v) throw new HttpsError("invalid-argument", `${field} required`);
  return v;
}

function hhmmToParts(hhmm: string) {
  const [h, m] = (hhmm || "").split(":").map((x) => Number(x));
  return {
    hour: Number.isFinite(h) ? h : 0,
    minute: Number.isFinite(m) ? m : 0,
  };
}

function toJsDayOfWeek(luxonWeekday: number) {
  // luxon: 1=Mon..7=Sun
  // ours:  0=Sun..6=Sat
  return luxonWeekday === 7 ? 0 : luxonWeekday;
}

function classIdFor(templateId: string, start: DateTime) {
  // deterministic: templateId_YYYY-MM-DD_HHmm
  return `${templateId}_${start.toFormat("yyyy-LL-dd")}_${start.toFormat("HHmm")}`;
}

function bookingIdFor(classId: string, userId: string) {
  return `${classId}_${userId}`;
}

function monthKeyFromDate(d: Date) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`; // e.g. "2026-03"
}

function ukDateKeyNow() {
  return DateTime.now().setZone("Europe/London").toFormat("yyyy-LL-dd");
}

function ukYesterdayKeyNow() {
  return DateTime.now().setZone("Europe/London").minus({days: 1}).toFormat("yyyy-LL-dd");
}

function ukMonthKeyFromDate(d: Date) {
  return DateTime.fromJSDate(d, {zone: "Europe/London"}).toFormat("yyyy-LL"); // YYYY-MM
}

/** -----------------------------
 * Class generation
 * ----------------------------*/
async function generateRange(daysAhead: number) {
  const nowUtc = DateTime.utc();

  const templatesSnap = await db
    .collection("classTemplates")
    .where("isActive", "==", true)
    .get();

  const templates = templatesSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as ClassTemplate),
  })) as Array<{ id: string } & ClassTemplate>;

  const created: string[] = [];
  const skipped: string[] = [];

  for (const t of templates) {
    const tz = t.timezone || "Europe/London";
    const {hour, minute} = hhmmToParts(t.startTime);

    for (let i = 0; i <= daysAhead; i++) {
      const day = nowUtc.plus({days: i}).setZone(tz);

      const dow = toJsDayOfWeek(day.weekday);
      if (dow !== t.dayOfWeek) continue;

      const start = day.set({hour, minute, second: 0, millisecond: 0});
      const end = start.plus({minutes: t.durationMinutes || 60});

      const id = classIdFor(t.id, start);
      const ref = db.collection("classes").doc(id);

      const payload: ClassDoc = {
        templateId: t.id,
        title: t.title,
        timezone: tz,
        startTime: admin.firestore.Timestamp.fromDate(start.toJSDate()),
        endTime: admin.firestore.Timestamp.fromDate(end.toJSDate()),
        coachId: t.coachId,
        coachName: t.coachName,
        capacity: t.capacity,
        bookedCount: 0,
        location: t.location,
        status: "scheduled",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      try {
        await ref.create(payload); // idempotent: fails if exists
        created.push(id);
      } catch {
        skipped.push(id);
      }
    }
  }

  return {createdCount: created.length, skippedCount: skipped.length};
}

export const generateClassOccurrencesDaily = onSchedule(
  {schedule: "0 2 * * *", timeZone: "Europe/London"},
  async () => {
    const result = await generateRange(28);
    console.log("Generation result:", result);
  }
);

export const generateClassOccurrences = onCall(async (request) => {
  requireAuth(request);

  // Optional: admin only (uncomment if you want)
  // await requireAdmin(uid);

  const daysAhead =
    typeof request.data?.daysAhead === "number" ? request.data.daysAhead : 28;

  try {
    return await generateRange(daysAhead);
  } catch (err: any) {
    console.error("generateClassOccurrences failed", err?.message, err?.stack, err);
    throw new HttpsError("internal", err?.message || "generateRange failed");
  }
});

/** -----------------------------
 * Booking
 * ----------------------------*/
export const bookClass = onCall(async (request) => {
  const uid = requireAuth(request);
  const classId = requireString(request.data?.classId, "classId");

  const classRef = db.collection("classes").doc(classId);
  const bookingRef = db.collection("bookings").doc(bookingIdFor(classId, uid));
  const userRef = db.collection("users").doc(uid);

  return db.runTransaction(async (tx) => {
    const [classSnap, existingBookingSnap, userSnap] = await Promise.all([
      tx.get(classRef),
      tx.get(bookingRef),
      tx.get(userRef),
    ]);

    if (!classSnap.exists) throw new HttpsError("not-found", "Class not found");

    const classData = classSnap.data() as Partial<ClassDoc>;
    const capacity = Number(classData.capacity ?? 0);
    const bookedCount = Number(classData.bookedCount ?? 0);

    if (capacity <= 0) throw new HttpsError("failed-precondition", "Class has no capacity set");
    if (bookedCount >= capacity) throw new HttpsError("failed-precondition", "Class is full");

    if (existingBookingSnap.exists) {
      const b = existingBookingSnap.data() as Partial<BookingDoc>;
      if (b.status === "booked") throw new HttpsError("already-exists", "Already booked");
      // if cancelled, we allow re-book (overwrite below)
    }

    const userName = (userSnap.data() as UserDoc | undefined)?.name || "Member";

    tx.set(bookingRef, {
      classId,
      userId: uid,
      userName,
      status: "booked",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    } satisfies BookingDoc);

    tx.update(classRef, {
      bookedCount: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {success: true};
  });
});

export const cancelBooking = onCall(async (request) => {
  const uid = requireAuth(request);
  const classId = requireString(request.data?.classId, "classId");

  const classRef = db.collection("classes").doc(classId);
  const bookingRef = db.collection("bookings").doc(bookingIdFor(classId, uid));

  return db.runTransaction(async (tx) => {
    const [bookingSnap, classSnap] = await Promise.all([
      tx.get(bookingRef),
      tx.get(classRef),
    ]);

    if (!bookingSnap.exists) throw new HttpsError("not-found", "No booking found");

    const booking = bookingSnap.data() as BookingDoc;
    if (booking.status !== "booked") throw new HttpsError("failed-precondition", "No active booking found");

    const classData = classSnap.exists ? (classSnap.data() as Partial<ClassDoc>) : {};
    const bookedCount = Number(classData.bookedCount ?? 0);

    tx.update(bookingRef, {
      status: "cancelled",
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Guard against negatives
    tx.update(classRef, {
      bookedCount: admin.firestore.FieldValue.increment(bookedCount > 0 ? -1 : 0),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {success: true};
  });
});

/** -----------------------------
 * Admin check-in
 * ----------------------------*/
export const checkInBooking = onCall(async (request) => {
  const callerUid = requireAuth(request);
  await requireAdmin(callerUid);

  // Accept either bookingId OR (classId + userId)
  const bookingIdFromPayload =
    typeof request.data?.bookingId === "string" ? request.data.bookingId.trim() : "";
  const classId =
    typeof request.data?.classId === "string" ? request.data.classId.trim() : "";
  const userIdFromPayload =
    typeof request.data?.userId === "string" ? request.data.userId.trim() : "";

  const bookingId =
    bookingIdFromPayload ||
    (classId && userIdFromPayload ? bookingIdFor(classId, userIdFromPayload) : "");

  if (!bookingId) {
    throw new HttpsError("invalid-argument", "bookingId OR (classId and userId) required.");
  }

  const nextAttended = Boolean(request.data?.attended);
  const bookingRef = db.collection("bookings").doc(bookingId);

  try {
    const result = await db.runTransaction(async (tx) => {
      const bookingSnap = await tx.get(bookingRef);
      if (!bookingSnap.exists) throw new HttpsError("not-found", "Booking not found.");

      const booking = bookingSnap.data() as BookingDoc;

      if (booking.status !== "booked") {
        throw new HttpsError("failed-precondition", "Not an active booking.");
      }

      // If attended isn't changing, we still allow updating checkedInBy timestamp if you want,
      // but leaderboard should not change.
      // If attended isn't changing, we still allow updating checkedInBy timestamp if you want,
      // but leaderboard should not change.
      const prevAttended = booking.attended === true;
      if (prevAttended === nextAttended) {
        tx.update(bookingRef, {
          checkedInBy: callerUid,
          checkedInAt: prevAttended ? admin.firestore.FieldValue.serverTimestamp() : booking.checkedInAt ?? null,
          attendanceStatus: prevAttended ? "checked_in" : "none",
        });
        return {ok: true, leaderboardChanged: false};
      }

      // We need the class to determine which month to count it in
      const classRef = db.collection("classes").doc(booking.classId);
      const classSnap = await tx.get(classRef);
      if (!classSnap.exists) throw new HttpsError("not-found", "Class not found.");

      const classDoc = classSnap.data() as ClassDoc;
      const classStart = classDoc.startTime.toDate();

      // Use UK month bucket (matches your gym reality)
      const monthKey = ukMonthKeyFromDate(classStart);

      const delta = nextAttended ? 1 : -1;

      const lbUserRef = db
        .collection("leaderboards")
        .doc(monthKey)
        .collection("users")
        .doc(booking.userId);

      // Read current leaderboard doc so we can clamp at >= 0
      const lbSnap = await tx.get(lbUserRef);
      const current = lbSnap.exists ?
        Number((lbSnap.data() as Partial<LeaderboardUserDoc>).attendedCount ?? 0) :
        0;

      const nextCount = Math.max(0, current + delta);

      // Read user profile info for nicer leaderboard display
      const userRef = db.collection("users").doc(booking.userId);
      const userSnap = await tx.get(userRef);
      const u = (userSnap.data() || {}) as UserDoc;

      // ---- Tier 1 Stats: totals + streaks (UK local day key) ----
      const today = ukDateKeyNow();
      const yesterday = ukYesterdayKeyNow();

      const existingStats = (u.stats || {}) as any;
      const prevTotal = Number(existingStats.totalCheckIns ?? 0);
      const prevMonth = Number((existingStats.monthCheckIns || {})[monthKey] ?? 0);

      let nextTotal = prevTotal;
      let nextMonth = prevMonth;

      let currentStreak = Number(existingStats.currentStreak ?? 0);
      let longestStreak = Number(existingStats.longestStreak ?? 0);
      let lastCheckInDate = typeof existingStats.lastCheckInDate === "string" ? existingStats.lastCheckInDate : "";

      // delta = +1 when checking in, -1 when unchecking
      if (delta === 1) {
        // counts
        nextTotal = prevTotal + 1;
        nextMonth = prevMonth + 1;

        // streak
        if (lastCheckInDate === today) {
          // idempotent-ish: shouldn't happen because we gate on attended change,
          // but safe if data gets weird.
        } else if (lastCheckInDate === yesterday) {
          currentStreak = currentStreak + 1;
        } else {
          currentStreak = 1;
        }

        longestStreak = Math.max(longestStreak, currentStreak);
        lastCheckInDate = today;
      }

      if (delta === -1) {
        // counts (clamped)
        nextTotal = Math.max(0, prevTotal - 1);
        nextMonth = Math.max(0, prevMonth - 1);

        // Quick-win behavior:
        // we do NOT recompute streak on uncheck (rare edge case).
        // If you ever need perfect streak correctness, we’ll add a nightly recompute job.
      }

      // Update booking
      tx.update(bookingRef, {
        attended: nextAttended,
        attendanceStatus: nextAttended ? "checked_in" : "none",
        checkedInAt: nextAttended ? admin.firestore.FieldValue.serverTimestamp() : null,
        checkedInBy: callerUid,
      });

      // Update leaderboard (merge so name/email can refresh)
      tx.set(
        lbUserRef,
        {
          userId: booking.userId,
          name: u.name ?? booking.userName ?? "Member",
          email: u.email ?? "",
          attendedCount: nextCount,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        } satisfies LeaderboardUserDoc,
        {merge: true}
      );

      // Write user stats (merge)
      tx.set(
        userRef,
        {
          stats: {
            totalCheckIns: nextTotal,
            monthCheckIns: {[monthKey]: nextMonth},
            currentStreak,
            longestStreak,
            lastCheckInDate: lastCheckInDate || null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
        {merge: true}
      );

      return {ok: true, leaderboardChanged: true, monthKey, attendedCount: nextCount};
    });

    return result;
  } catch (err: any) {
    console.error("checkInBooking failed", err?.message, err?.stack, err);
    throw err instanceof HttpsError ? err : new HttpsError("internal", err?.message || "Check-in failed");
  }
});

async function requireAdmin(uid: string): Promise<UserDoc> {
  const snap = await db.collection("users").doc(uid).get();
  const user = (snap.data() || {}) as UserDoc;
  if (user.role !== "admin") {
    throw new HttpsError("permission-denied", "Admin only.");
  }
  return user;
}

/**
 * Admin check-in / dip / authorised absence
 * - checked_in: uses your existing stats/leaderboard logic (delegates to checkInBooking)
 * - dip: marks as no-show (does NOT change leaderboard/stats)
 * - authorised_absence: cancels booking and frees capacity (does NOT change leaderboard/stats)
 */
export const markBookingStatus = onCall(async (request) => {
  const callerUid = requireAuth(request);
  await requireAdmin(callerUid);

  const classId = requireString(request.data?.classId, "classId");
  const userId = requireString(request.data?.userId, "userId");
  const status = requireString(request.data?.status, "status") as
    | "checked_in"
    | "booked"
    | "dip"
    | "authorised_absence";

  const bookingId = bookingIdFor(classId, userId);
  const bookingRef = db.collection("bookings").doc(bookingId);
  const classRef = db.collection("classes").doc(classId);
  const userRef = db.collection("users").doc(userId);

  return db.runTransaction(async (tx) => {
    const bookingSnap = await tx.get(bookingRef);
    if (!bookingSnap.exists) throw new HttpsError("not-found", "Booking not found.");

    const booking = bookingSnap.data() as BookingDoc;
    if (booking.status !== "booked") {
      throw new HttpsError("failed-precondition", "Not an active booking.");
    }

    const classSnap = await tx.get(classRef);
    if (!classSnap.exists) throw new HttpsError("not-found", "Class not found.");

    const classDoc = classSnap.data() as ClassDoc;
    const classStart = classDoc.startTime.toDate();
    const monthKey = ukMonthKeyFromDate(classStart);

    const userSnap = await tx.get(userRef);
    const u = (userSnap.data() || {}) as UserDoc;

    const lbUserRef = db
      .collection("leaderboards")
      .doc(monthKey)
      .collection("users")
      .doc(userId);

    const prevAttended = booking.attended === true;
    const prevAttendanceStatus = booking.attendanceStatus ?? (prevAttended ? "checked_in" : "none");

    let nextAttended = prevAttended;
    let nextAttendanceStatus: "none" | "checked_in" | "dip" = prevAttendanceStatus;

    if (status === "checked_in") {
      nextAttended = true;
      nextAttendanceStatus = "checked_in";
    } else if (status === "booked") {
      nextAttended = false;
      nextAttendanceStatus = "none";
    } else if (status === "dip") {
      nextAttended = false;
      nextAttendanceStatus = "dip";
    } else if (status === "authorised_absence") {
      nextAttended = false;
      nextAttendanceStatus = "none";
    } else {
      throw new HttpsError("invalid-argument", "Invalid status.");
    }

    const delta = (nextAttended ? 1 : 0) - (prevAttended ? 1 : 0);

    // Update leaderboard + user stats ONLY if attended changed
    if (delta !== 0) {
      const lbSnap = await tx.get(lbUserRef);
      const currentLb = lbSnap.exists ?
        Number((lbSnap.data() as Partial<LeaderboardUserDoc>).attendedCount ?? 0) :
        0;
      const nextLb = Math.max(0, currentLb + delta);

      const existingStats = (u.stats || {}) as any;
      const prevTotal = Number(existingStats.totalCheckIns ?? 0);
      const prevMonth = Number((existingStats.monthCheckIns || {})[monthKey] ?? 0);

      let nextTotal = prevTotal;
      let nextMonth = prevMonth;

      let currentStreak = Number(existingStats.currentStreak ?? 0);
      let longestStreak = Number(existingStats.longestStreak ?? 0);
      let lastCheckInDate =
        typeof existingStats.lastCheckInDate === "string" ? existingStats.lastCheckInDate : "";

      const today = ukDateKeyNow();
      const yesterday = ukYesterdayKeyNow();

      if (delta === 1) {
        nextTotal = prevTotal + 1;
        nextMonth = prevMonth + 1;

        if (lastCheckInDate === today) {
          // no-op
        } else if (lastCheckInDate === yesterday) {
          currentStreak = currentStreak + 1;
        } else {
          currentStreak = 1;
        }

        longestStreak = Math.max(longestStreak, currentStreak);
        lastCheckInDate = today;
      }

      if (delta === -1) {
        nextTotal = Math.max(0, prevTotal - 1);
        nextMonth = Math.max(0, prevMonth - 1);
        // keeping your existing simple behavior:
        // do not fully recompute streak on removal
      }

      tx.set(
        lbUserRef,
        {
          userId,
          name: u.name ?? booking.userName ?? "Member",
          email: u.email ?? "",
          attendedCount: nextLb,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        } satisfies LeaderboardUserDoc,
        {merge: true}
      );

      tx.set(
        userRef,
        {
          stats: {
            totalCheckIns: nextTotal,
            monthCheckIns: {[monthKey]: nextMonth},
            currentStreak,
            longestStreak,
            lastCheckInDate: lastCheckInDate || null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
        {merge: true}
      );
    }

    // Authorised absence = cancel booking + free spot
    if (status === "authorised_absence") {
      const bookedCount = Number(classDoc.bookedCount ?? 0);

      tx.update(bookingRef, {
        status: "cancelled",
        cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
        cancelledReason: "authorised_absence",
        attendanceStatus: "none",
        attended: false,
        checkedInAt: null,
        checkedInBy: null,
      });

      tx.update(classRef, {
        bookedCount: admin.firestore.FieldValue.increment(bookedCount > 0 ? -1 : 0),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {ok: true, kind: "authorised_absence", delta};
    }

    // booked / checked_in / dip stay as active bookings
    tx.update(bookingRef, {
      attendanceStatus: nextAttendanceStatus,
      attended: nextAttended,
      checkedInAt: nextAttended ? admin.firestore.FieldValue.serverTimestamp() : null,
      checkedInBy: callerUid,
    });

    return {
      ok: true,
      kind: status,
      delta,
      prevAttendanceStatus,
      nextAttendanceStatus,
    };
  });
});

/**
 * Admin-only: return roster for a class.
 * Includes only active bookings (status === "booked").
 */
export const getClassRoster = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Login required.");
  }

  const callerUid = request.auth.uid;
  await requireAdmin(callerUid);

  const classId = String(request.data?.classId || "").trim();
  if (!classId) {
    throw new HttpsError("invalid-argument", "classId required.");
  }

  // Only active bookings in the roster
  const snap = await db
    .collection("bookings")
    .where("classId", "==", classId)
    .where("status", "==", "booked")
    .get();

  const attendees = snap.docs.map((d) => d.data() as BookingDoc);

  const checkedInCount = attendees.filter((b) => b.attended === true).length;

  return {
    classId,
    total: attendees.length,
    checkedInCount,
    attendees: attendees
      .map((b) => ({
        userId: b.userId,
        userName: b.userName,
        attended: Boolean(b.attended),
        attendanceStatus: b.attendanceStatus ?? (b.attended ? "checked_in" : "none"),
        checkedInAt: b.checkedInAt ?? null,
      }))
      .sort((a, b) => a.userName.localeCompare(b.userName)),
  };
});

/**
 * Monthly Leaderboard Generation
 */
export const getMonthlyLeaderboard = onCall(async (request) => {
  requireAuth(request);

  const monthKey =
    typeof request.data?.monthKey === "string" && request.data.monthKey.trim() ?
      request.data.monthKey.trim() :
      monthKeyFromDate(new Date());

  const limit =
    typeof request.data?.limit === "number" && request.data.limit > 0 ?
      Math.min(500, Math.floor(request.data.limit)) :
      200;

  // 1) Fetch all users (or only users with role === "user")
  const usersSnap = await db
    .collection("users")
    .get();

  const allUsers = usersSnap.docs.map((d) => ({
    userId: d.id,
    name: String((d.data() as any)?.name || "Member"),
    email: String((d.data() as any)?.email || ""),
    photoURL: String((d.data() as any)?.photoURL || ""),
  }));

  // 2) Fetch leaderboard entries for this month
  const lbSnap = await db
    .collection("leaderboards")
    .doc(monthKey)
    .collection("users")
    .get();

  const counts = new Map<string, number>();
  lbSnap.forEach((doc) => {
    const data = doc.data() as any;
    counts.set(doc.id, Number(data.attendedCount || 0));
  });

  // 3) Merge so everyone appears, default 0
  const rows = allUsers
    .map((u) => ({
      userId: u.userId,
      name: u.name,
      email: u.email,
      photoURL: u.photoURL,
      attendedCount: counts.get(u.userId) ?? 0,
    }))
    .sort((a, b) => {
      const diff = (b.attendedCount || 0) - (a.attendedCount || 0);
      if (diff !== 0) return diff;
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit);

  return {monthKey, total: rows.length, rows};
});

export const reconcileMonthlyLeaderboard = onCall(async (request) => {
  const callerUid = requireAuth(request);
  await requireAdmin(callerUid);

  const monthKey =
    typeof request.data?.monthKey === "string" && request.data.monthKey.trim() ?
      request.data.monthKey.trim() :
      ukMonthKeyFromDate(new Date());

  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    throw new HttpsError("invalid-argument", "monthKey must be YYYY-MM");
  }

  const bookingsSnap = await db.collection("bookings").get();

  const counts = new Map<string, number>();

  for (const doc of bookingsSnap.docs) {
    const b = doc.data() as Partial<BookingDoc>;
    if (!b.classId || !b.userId) continue;

    // only attended bookings count
    if (b.attended !== true) continue;

    const classSnap = await db.collection("classes").doc(String(b.classId)).get();
    if (!classSnap.exists) continue;

    const classData = classSnap.data() as Partial<ClassDoc>;
    const classStart = classData.startTime?.toDate?.();
    if (!classStart) continue;

    const bookingMonthKey = ukMonthKeyFromDate(classStart);
    if (bookingMonthKey !== monthKey) continue;

    counts.set(String(b.userId), (counts.get(String(b.userId)) || 0) + 1);
  }

  const lbMonthRef = db.collection("leaderboards").doc(monthKey);
  const existingSnap = await lbMonthRef.collection("users").get();

  const batch = db.batch();

  // clear old docs first
  existingSnap.forEach((doc) => batch.delete(doc.ref));

  // rebuild
  for (const [userId, attendedCount] of counts.entries()) {
    const userSnap = await db.collection("users").doc(userId).get();
    const u = (userSnap.data() || {}) as UserDoc;

    const ref = lbMonthRef.collection("users").doc(userId);
    batch.set(ref, {
      userId,
      name: u.name ?? "Member",
      email: u.email ?? "",
      attendedCount,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    } satisfies LeaderboardUserDoc);
  }

  await batch.commit();

  return {
    ok: true,
    monthKey,
    rebuiltUsers: counts.size,
  };
});
