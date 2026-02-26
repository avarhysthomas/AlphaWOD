/* eslint-disable require-jsdoc, max-len, @typescript-eslint/no-explicit-any */

import {onCall, HttpsError} from "firebase-functions/v2/https";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {setGlobalOptions} from "firebase-functions/v2";
import * as admin from "firebase-admin";
import {DateTime} from "luxon";


setGlobalOptions({region: "europe-west1"});
admin.initializeApp();
const db = admin.firestore();

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

function hhmmToParts(hhmm: string) {
  const [h, m] = (hhmm || "").split(":").map((x) => Number(x));
  return {hour: Number.isFinite(h) ? h : 0, minute: Number.isFinite(m) ? m : 0};
}

function toJsDayOfWeek(luxonWeekday: number) {
  // luxon: 1=Mon..7=Sun
  // we use: 0=Sun..6=Sat
  return luxonWeekday === 7 ? 0 : luxonWeekday;
}

function classIdFor(templateId: string, start: DateTime) {
  // deterministic: templateId_YYYY-MM-DD_HHmm
  return `${templateId}_${start.toFormat("yyyy-LL-dd")}_${start.toFormat("HHmm")}`;
}

async function generateRange(daysAhead: number) {
  const nowUtc = DateTime.utc();

  const templatesSnap = await db
    .collection("classTemplates")
    .where("isActive", "==", true)
    .get();

  const templates = templatesSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as any),
  })) as Array<{ id: string } & ClassTemplate>;

  const created: string[] = [];
  const skipped: string[] = [];

  for (const t of templates) {
    const tz = t.timezone || "Europe/London";
    const {hour, minute} = hhmmToParts(t.startTime);

    for (let i = 0; i <= daysAhead; i++) {
      const day = nowUtc.plus({days: i}).setZone(tz);

      // match template dayOfWeek
      const dow = toJsDayOfWeek(day.weekday); // 0..6
      if (dow !== t.dayOfWeek) continue;


      const start = day.set({hour, minute, second: 0, millisecond: 0});
      const end = start.plus({minutes: t.durationMinutes || 60});

      const id = classIdFor(t.id, start);
      const ref = db.collection("classes").doc(id);

      const payload = {
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
        // create() fails if doc exists (perfect for idempotent generation)
        await ref.create(payload);
        created.push(id);
      } catch (e: any) {
        // ALREADY_EXISTS -> skip
        skipped.push(id);
      }
    }
  }

  return {createdCount: created.length, skippedCount: skipped.length};
}

/**
 * Scheduled job: generates the next 28 days of classes.
 * Requires Blaze plan (because scheduler).
 */
export const generateClassOccurrencesDaily = onSchedule(
  {schedule: "0 2 * * *", timeZone: "Europe/London"},
  async () => {
    const result = await generateRange(28);
    console.log("Generation result:", result);
  }
);

/**
 * Callable: manually generate (useful while building).
 * Call from admin UI.
 */
export const generateClassOccurrences = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Login required.");

  const daysAhead =
    typeof request.data?.daysAhead === "number" ? request.data.daysAhead : 28;

  try {
    const result = await generateRange(daysAhead);
    return result;
  } catch (err: any) {
    // This is the bit that will turn your mystery "internal" into actionable info in logs
    console.error("generateClassOccurrences failed", err?.message, err?.stack, err);
    throw new HttpsError(
      "internal",
      err?.message || "generateRange failed",
      {stack: err?.stack}
    );
  }
});

export const bookClass = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Login required.");
  }

  const uid = request.auth.uid;
  const {classId} = request.data;

  if (!classId) {
    throw new HttpsError("invalid-argument", "classId required");
  }

  const classRef = db.collection("classes").doc(classId);
  const bookingRef = db.collection("bookings").doc(`${classId}_${uid}`);
  const userRef = db.collection("users").doc(uid);

  return db.runTransaction(async (tx) => {
    const classSnap = await tx.get(classRef);
    if (!classSnap.exists) {
      throw new HttpsError("not-found", "Class not found");
    }

    const classData = classSnap.data()!;
    const capacity = classData.capacity || 0;
    const bookedCount = classData.bookedCount || 0;

    if (bookedCount >= capacity) {
      throw new HttpsError("failed-precondition", "Class is full");
    }

    const existingBooking = await tx.get(bookingRef);
    if (existingBooking.exists && existingBooking.data()?.status === "booked") {
      throw new HttpsError("already-exists", "Already booked");
    }

    const userSnap = await tx.get(userRef);
    const userName = userSnap.data()?.name || "Member";

    tx.set(bookingRef, {
      classId,
      userId: uid,
      userName,
      status: "booked",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    tx.update(classRef, {
      bookedCount: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {success: true};
  });
});

export const cancelBooking = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Login required.");
  }

  const uid = request.auth.uid;
  const {classId} = request.data;

  if (!classId) {
    throw new HttpsError("invalid-argument", "classId required");
  }

  const classRef = db.collection("classes").doc(classId);
  const bookingRef = db.collection("bookings").doc(`${classId}_${uid}`);

  return db.runTransaction(async (tx) => {
    const bookingSnap = await tx.get(bookingRef);
    if (!bookingSnap.exists || bookingSnap.data()?.status !== "booked") {
      throw new HttpsError("not-found", "No active booking found");
    }

    tx.update(bookingRef, {
      status: "cancelled",
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    tx.update(classRef, {
      bookedCount: admin.firestore.FieldValue.increment(-1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {success: true};
  });
});

export const checkInBooking = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Login required.");

  const callerUid = request.auth.uid;
  const classId = String(request.data?.classId || "");
  const userId = String(request.data?.userId || "");
  const attended = Boolean(request.data?.attended);

  if (!classId || !userId) {
    throw new HttpsError("invalid-argument", "classId and userId required.");
  }

  // ✅ Role gate (admin for now)
  const callerUserSnap = await db.collection("users").doc(callerUid).get();
  const role = callerUserSnap.data()?.role;
  if (role !== "admin") {
    throw new HttpsError("permission-denied", "Admin only.");
  }

  const bookingId = `${classId}_${userId}`;
  const bookingRef = db.collection("bookings").doc(bookingId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(bookingRef);
    if (!snap.exists) throw new HttpsError("not-found", "Booking not found.");

    const data = snap.data() as any;

    // only allow check-in if booking is active
    if (data.status !== "booked") {
      throw new HttpsError("failed-precondition", "Not an active booking.");
    }

    tx.update(bookingRef, {
      attended,
      checkedInAt: admin.firestore.FieldValue.serverTimestamp(),
      checkedInBy: callerUid,
    });
  });

  return { ok: true };
});
