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
import {defineSecret} from "firebase-functions/params";
import * as admin from "firebase-admin";
import {DateTime} from "luxon";

setGlobalOptions({region: "europe-west1"});

admin.initializeApp();
const db = admin.firestore();
const resendApiKey = defineSecret("RESEND_API_KEY");
const resendFromEmail = defineSecret("RESEND_FROM_EMAIL");
const defaultInviteOrigin = "https://alpha-wod.vercel.app";

/** -----------------------------
 * Types
 * ----------------------------*/
type Role = "admin" | "user" | string;
type ApprovalStatus = "approved" | "pending" | string;

type UserDoc = {
  name?: string;
  email?: string;
  role?: Role;
  approvalStatus?: ApprovalStatus;
  approvedAt?: admin.firestore.FieldValue | admin.firestore.Timestamp;
  approvedBy?: string;
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
  attendanceStatus?: "none" | "checked_in" | "dip";
  attended?: boolean;
  checkedInAt?: admin.firestore.FieldValue | admin.firestore.Timestamp | null;
  checkedInBy?: string | null;

  // admin exception metadata
  addedByAdmin?: boolean;
  addedByAdminBy?: string;
  addedByAdminAt?: admin.firestore.FieldValue | admin.firestore.Timestamp;
};

type LeaderboardUserDoc = {
  userId: string;
  name: string;
  email: string;
  attendedCount: number;
  updatedAt: admin.firestore.FieldValue | admin.firestore.Timestamp;
};

type InviteDoc = {
  email: string;
  invitedBy: string;
  inviteToken: string;
  signUpUrl: string;
  status: "sent";
  createdAt: admin.firestore.FieldValue | admin.firestore.Timestamp;
  updatedAt: admin.firestore.FieldValue | admin.firestore.Timestamp;
  lastSentAt: admin.firestore.FieldValue | admin.firestore.Timestamp;
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

function requireEmail(value: unknown, field: string): string {
  const email = requireString(value, field).toLowerCase();
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailPattern.test(email)) {
    throw new HttpsError("invalid-argument", `${field} must be a valid email address`);
  }

  return email;
}

function normaliseAppOrigin(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";

  if (!raw) {
    throw new HttpsError("invalid-argument", "origin required");
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new HttpsError("invalid-argument", "origin must be a valid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HttpsError("invalid-argument", "origin must use http or https");
  }

  return parsed.origin;
}

function resolveInviteOrigin(value: unknown): string {
  const origin = normaliseAppOrigin(value);
  const hostname = new URL(origin).hostname.toLowerCase();

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return defaultInviteOrigin;
  }

  return origin;
}

function inviteDocIdFor(email: string) {
  return Buffer.from(email.toLowerCase()).toString("base64url");
}

function buildInviteEmailHtml(signUpUrl: string) {
  const logoUrl = `${defaultInviteOrigin}/ZERO-ALPHA.png`;

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Zero Alpha Invite</title>
      </head>
      <body style="margin:0;padding:0;background-color:#060606;color:#f5f5f5;font-family:Arial,sans-serif;">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
          Your Zero Alpha invite is ready. Create your account and we’ll get you inside.
        </div>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#060606;">
          <tr>
            <td align="center" style="padding:32px 16px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px;border-collapse:collapse;">
                <tr>
                  <td style="padding-bottom:14px;text-align:center;">
                    <img
                      src="${logoUrl}"
                      alt="Zero Alpha"
                      width="188"
                      style="display:inline-block;width:188px;max-width:100%;height:auto;border:0;"
                    />
                  </td>
                </tr>
                <tr>
                  <td style="background:linear-gradient(180deg,#141414 0%,#090909 100%);border:1px solid #242424;border-radius:28px;overflow:hidden;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td style="padding:0;">
                          <div style="height:10px;background:linear-gradient(90deg,#f59e0b 0%,#fcd34d 55%,#fb7185 100%);"></div>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:42px 34px 18px 34px;background:
                          radial-gradient(circle at top left, rgba(245,158,11,0.22), transparent 34%),
                          radial-gradient(circle at bottom right, rgba(244,63,94,0.14), transparent 26%),
                          #0b0b0b;">
                          <div style="color:#f6c35b;font-size:12px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;margin-bottom:14px;">
                            Member Invite
                          </div>
                          <h1 style="margin:0 0 14px 0;font-size:42px;line-height:0.92;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:#ffffff;font-family:'Anton','Arial Narrow',Arial,sans-serif;">
                            YOU&rsquo;RE IN.
                            <br />
                            LET&rsquo;S GET YOU SET UP.
                          </h1>
                          <p style="margin:0;max-width:450px;font-size:16px;line-height:1.7;color:#c7c7c7;">
                            You’ve been invited to join Zero Alpha. Create your account using the link below, then an admin can approve your access and get you moving.
                          </p>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:0 34px 34px 34px;background:#0b0b0b;">
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid #252525;border-radius:22px;background:#111111;">
                            <tr>
                              <td style="padding:24px 24px 10px 24px;">
                                <div style="font-size:14px;line-height:1.7;color:#e5e5e5;">
                                  1. Create your account
                                  <br />
                                  2. Wait for admin approval
                                  <br />
                                  3. Jump into classes, workouts, and progress tracking
                                </div>
                              </td>
                            </tr>
                            <tr>
                              <td style="padding:10px 24px 24px 24px;">
                                <a href="${signUpUrl}" style="display:inline-block;padding:15px 24px;border-radius:14px;background:linear-gradient(135deg,#fde68a 0%,#f59e0b 100%);color:#111111;text-decoration:none;font-size:15px;font-weight:800;letter-spacing:0.01em;">
                                  Create your account
                                </a>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:0 34px 34px 34px;background:#0b0b0b;">
                          <div style="border-top:1px solid #222222;padding-top:22px;">
                            <div style="font-size:12px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#8f8f8f;margin-bottom:10px;">
                              Need the raw link?
                            </div>
                            <p style="margin:0;font-size:13px;line-height:1.8;color:#b8b8b8;word-break:break-word;">
                              <a href="${signUpUrl}" style="color:#f6c35b;text-decoration:none;">${signUpUrl}</a>
                            </p>
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:18px 12px 0 12px;text-align:center;">
                    <p style="margin:0;font-size:12px;line-height:1.7;color:#7b7b7b;">
                      Zero Alpha Fitness
                      <br />
                      Wherever we go, we go together.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

async function sendInviteEmail(email: string, signUpUrl: string) {
  const apiKey = resendApiKey.value().trim();
  const fromEmail = resendFromEmail.value().trim();

  if (!apiKey) {
    throw new HttpsError("failed-precondition", "RESEND_API_KEY is not configured.");
  }

  if (!fromEmail) {
    throw new HttpsError("failed-precondition", "RESEND_FROM_EMAIL is not configured.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `Zero Alpha <${fromEmail}>`,
      to: [email],
      subject: "You're invited to join Zero Alpha",
      html: buildInviteEmailHtml(signUpUrl),
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new HttpsError(
      "internal",
      `Failed to send invite email: ${message || response.statusText}`
    );
  }
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
  await requireApprovedMember(uid);
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
  await requireApprovedMember(uid);
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

export const adminAddBooking = onCall(async (request) => {
  const callerUid = requireAuth(request);
  await requireAdmin(callerUid);

  const classId = requireString(request.data?.classId, "classId");
  const userId = requireString(request.data?.userId, "userId");

  const classRef = db.collection("classes").doc(classId);
  const bookingRef = db.collection("bookings").doc(bookingIdFor(classId, userId));
  const userRef = db.collection("users").doc(userId);

  return db.runTransaction(async (tx) => {
    const [classSnap, existingBookingSnap, userSnap] = await Promise.all([
      tx.get(classRef),
      tx.get(bookingRef),
      tx.get(userRef),
    ]);

    if (!classSnap.exists) {
      throw new HttpsError("not-found", "Class not found.");
    }

    if (!userSnap.exists) {
      throw new HttpsError("not-found", "User not found.");
    }

    const userData = userSnap.data() as UserDoc;
    if (userData.approvalStatus === "pending") {
      throw new HttpsError("failed-precondition", "User must be approved before being added to a class.");
    }

    const classData = classSnap.data() as Partial<ClassDoc>;
    const capacity = Number(classData.capacity ?? 0);
    const bookedCount = Number(classData.bookedCount ?? 0);

    if (capacity <= 0) {
      throw new HttpsError("failed-precondition", "Class has no capacity set.");
    }

    if (bookedCount >= capacity) {
      throw new HttpsError("failed-precondition", "Class is full.");
    }

    if (existingBookingSnap.exists) {
      const b = existingBookingSnap.data() as Partial<BookingDoc>;

      if (b.status === "booked") {
        throw new HttpsError("already-exists", "Already booked.");
      }
      // If cancelled, allow overwrite / re-add
    }

    const userName = userData.name || "Member";

    tx.set(bookingRef, {
      classId,
      userId,
      userName,
      status: "booked",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      attendanceStatus: "none",
      attended: false,
      checkedInAt: null,
      checkedInBy: null,
      addedByAdmin: true,
      addedByAdminBy: callerUid,
      addedByAdminAt: admin.firestore.FieldValue.serverTimestamp(),
    } as any);

    tx.update(classRef, {
      bookedCount: admin.firestore.FieldValue.increment(1),
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

async function requireApprovedMember(uid: string): Promise<UserDoc> {
  const snap = await db.collection("users").doc(uid).get();
  const user = (snap.data() || {}) as UserDoc;

  if (user.role === "admin") {
    return user;
  }

  if (user.approvalStatus === "pending") {
    throw new HttpsError("permission-denied", "Your account is awaiting admin approval.");
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
  const uid = requireAuth(request);
  await requireApprovedMember(uid);

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
    approvalStatus: String((d.data() as any)?.approvalStatus || "approved"),
  })).filter((u) => u.approvalStatus !== "pending");

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
    if (u.approvalStatus === "pending") continue;

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

export const getMonthlyDipLeaderboard = onCall(async (request) => {
  const uid = requireAuth(request);
  await requireApprovedMember(uid);

  const monthKey =
    typeof request.data?.monthKey === "string" && request.data.monthKey.trim() ?
      request.data.monthKey.trim() :
      monthKeyFromDate(new Date());

  const limit =
    typeof request.data?.limit === "number" && request.data.limit > 0 ?
      Math.min(500, Math.floor(request.data.limit)) :
      200;

  const usersSnap = await db.collection("users").get();

  const allUsers = usersSnap.docs.map((d) => ({
    userId: d.id,
    name: String((d.data() as any)?.name || "Member"),
    email: String((d.data() as any)?.email || ""),
    photoURL: String((d.data() as any)?.photoURL || ""),
    approvalStatus: String((d.data() as any)?.approvalStatus || "approved"),
  })).filter((u) => u.approvalStatus !== "pending");

  const bookingsSnap = await db.collection("bookings").get();
  const counts = new Map<string, number>();

  for (const doc of bookingsSnap.docs) {
    const b = doc.data() as Partial<BookingDoc>;
    if (!b.classId || !b.userId) continue;
    if (b.attendanceStatus !== "dip") continue;

    const classSnap = await db.collection("classes").doc(String(b.classId)).get();
    if (!classSnap.exists) continue;

    const classData = classSnap.data() as Partial<ClassDoc>;
    const classStart = classData.startTime?.toDate?.();
    if (!classStart) continue;

    const bookingMonthKey = ukMonthKeyFromDate(classStart);
    if (bookingMonthKey !== monthKey) continue;

    counts.set(String(b.userId), (counts.get(String(b.userId)) || 0) + 1);
  }

  const rows = allUsers
    .map((u) => ({
      userId: u.userId,
      name: u.name,
      email: u.email,
      photoURL: u.photoURL,
      dipCount: counts.get(u.userId) ?? 0,
    }))
    .sort((a, b) => {
      const diff = (b.dipCount || 0) - (a.dipCount || 0);
      if (diff !== 0) return diff;
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit);

  return {monthKey, total: rows.length, rows};
});

export const approveUserAccess = onCall(async (request) => {
  const callerUid = requireAuth(request);
  await requireAdmin(callerUid);

  const userId = requireString(request.data?.userId, "userId");
  const userRef = db.collection("users").doc(userId);
  const snap = await userRef.get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "User not found.");
  }

  const user = snap.data() as UserDoc;
  if (user.role === "admin") {
    throw new HttpsError("failed-precondition", "Admins do not require approval.");
  }

  await userRef.set({
    approvalStatus: "approved",
    approvedAt: admin.firestore.FieldValue.serverTimestamp(),
    approvedBy: callerUid,
  }, {merge: true});

  return {ok: true};
});

export const inviteMemberByEmail = onCall({secrets: [resendApiKey, resendFromEmail]}, async (request) => {
  const callerUid = requireAuth(request);
  await requireAdmin(callerUid);

  const email = requireEmail(request.data?.email, "email");
  const origin = resolveInviteOrigin(request.data?.origin);

  const existingAuthUser = await admin.auth().getUserByEmail(email).catch((err: any) => {
    if (err?.code === "auth/user-not-found") {
      return null;
    }

    throw err;
  });

  if (existingAuthUser) {
    const userSnap = await db.collection("users").doc(existingAuthUser.uid).get();
    const user = (userSnap.data() || {}) as UserDoc;

    if (user.role === "admin") {
      throw new HttpsError("already-exists", "That email already belongs to an admin.");
    }

    if (user.approvalStatus !== "pending") {
      throw new HttpsError("already-exists", "That member already has an account.");
    }
  }

  const inviteToken = crypto.randomUUID();
  const signUpUrl = `${origin}/signup?email=${encodeURIComponent(email)}&invite=${encodeURIComponent(inviteToken)}`;
  const inviteRef = db.collection("memberInvites").doc(inviteDocIdFor(email));

  await sendInviteEmail(email, signUpUrl);

  await inviteRef.set({
    email,
    invitedBy: callerUid,
    inviteToken,
    signUpUrl,
    status: "sent",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastSentAt: admin.firestore.FieldValue.serverTimestamp(),
  } satisfies InviteDoc, {merge: true});

  return {ok: true, signUpUrl};
});
