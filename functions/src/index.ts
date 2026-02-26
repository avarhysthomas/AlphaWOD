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
  status: "booked" | "cancelled";
  createdAt: admin.firestore.FieldValue | admin.firestore.Timestamp;
  cancelledAt?: admin.firestore.FieldValue | admin.firestore.Timestamp;
  attended?: boolean;
  checkedInAt?: admin.firestore.FieldValue | admin.firestore.Timestamp;
  checkedInBy?: string;
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
  const bookingIdFromPayload = typeof request.data?.bookingId === "string" ? request.data.bookingId.trim() : "";
  const classId = typeof request.data?.classId === "string" ? request.data.classId.trim() : "";
  const userId = typeof request.data?.userId === "string" ? request.data.userId.trim() : "";

  const bookingId =
    bookingIdFromPayload ||
    (classId && userId ? bookingIdFor(classId, userId) : "");

  if (!bookingId) {
    throw new HttpsError("invalid-argument", "bookingId OR (classId and userId) required.");
  }

  const attended = Boolean(request.data?.attended);
  const bookingRef = db.collection("bookings").doc(bookingId);

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(bookingRef);
      if (!snap.exists) throw new HttpsError("not-found", "Booking not found.");

      const data = snap.data() as BookingDoc;

      if (data.status !== "booked") {
        throw new HttpsError("failed-precondition", "Not an active booking.");
      }

      tx.update(bookingRef, {
        attended,
        checkedInAt: admin.firestore.FieldValue.serverTimestamp(),
        checkedInBy: callerUid,
      });
    });

    return {ok: true};
  } catch (err: any) {
    console.error("checkInBooking failed", err?.message, err?.stack, err);
    throw err instanceof HttpsError ?
      err :
      new HttpsError("internal", err?.message || "Check-in failed");
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
        checkedInAt: b.checkedInAt ?? null,
      }))
      .sort((a, b) => a.userName.localeCompare(b.userName)),
  };
});
