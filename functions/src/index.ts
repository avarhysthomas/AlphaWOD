/* eslint-disable
  require-jsdoc,
  valid-jsdoc,
  max-len,
  @typescript-eslint/no-explicit-any,
  @typescript-eslint/no-unused-vars
*/

import {onCall, HttpsError} from "firebase-functions/v2/https";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {onDocumentWritten} from "firebase-functions/v2/firestore";
import {setGlobalOptions} from "firebase-functions/v2";
import {defineSecret} from "firebase-functions/params";
import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {createHash} from "crypto";
import {DateTime} from "luxon";
import {
  ACCESS_SCHEMA_VERSION,
  CURRENT_WAIVER_ACKNOWLEDGEMENTS,
  CURRENT_WAIVER_TITLE,
  CURRENT_WAIVER_VERSION,
  EntitlementSource,
  EntitlementStatus,
  buildManagedClaims,
  claimsEqual,
  isApprovalStatus,
  isEntitlementSource,
  isEntitlementStatus,
  isEntitlementCompatibleWithRole,
  isCanonicalCurrentWaiverAcceptance,
  isUserRole,
  isValidEntitlementPair,
  mergeManagedClaims,
  resolveUserAuthorisation,
} from "./authz";
import {
  buildClaimMembership,
  buildCreateMembershipCheckoutSession,
  buildListMemberships,
  buildLinkMembershipParticipant,
  buildReleaseAbandonedMembershipCheckout,
  buildRecoverMembershipCancellations,
  buildRecoverStripeEvents,
  buildReconcilePastDueMemberships,
  buildRequestMembershipCancellation,
  buildRetryMembershipConfirmations,
  buildStripeWebhook,
  MEMBERSHIP_CHECKOUT_SCHEMA_VERSION,
} from "./membership";
import {
  LEADERBOARD_CANDIDATE_MAX_ROWS,
  LeaderboardProfile,
  filterAttendanceLeaderboardRows,
  filterDipLeaderboardRows,
  resolveBoundedLeaderboardMonthKey,
} from "./leaderboard";

setGlobalOptions({region: "europe-west1"});

admin.initializeApp();
const db = admin.firestore();
const resendApiKey = defineSecret("RESEND_API_KEY");
const resendFromEmail = defineSecret("RESEND_FROM_EMAIL");
const defaultInviteOrigin = "https://alpha-wod.vercel.app";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** -----------------------------
 * Types
 * ----------------------------*/
type StrengthBlock = "A" | "B" | "none" | string;

type UserDoc = {
  name?: string | null;
  email?: string | null;
  role?: unknown;
  approvalStatus?: unknown;
  entitlementStatus?: unknown;
  entitlementSource?: unknown;
  entitlementPlanKey?: string;
  entitlementReason?: string;
  alphaWodAccess?: boolean;
  accessSchemaVersion?: number;
  profileSchemaVersion?: number;
  strengthBlock?: StrengthBlock;
  approvedAt?: FieldValue | Timestamp;
  approvedBy?: string;
  photoURL?: string | null;
  createdAt?: FieldValue | Timestamp;
  updatedAt?: FieldValue | Timestamp;
  stats?: {
    totalCheckIns?: number;
    monthCheckIns?: Record<string, number>;
    currentStreak?: number;
    longestStreak?: number;
    lastCheckInDate?: string; // YYYY-MM-DD (Europe/London)
    updatedAt?: FieldValue | Timestamp;
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
  startTime: Timestamp;
  endTime: Timestamp;
  coachId: string;
  coachName: string;
  capacity: number;
  bookedCount: number;
  location: string;
  status: "scheduled" | "cancelled";
  createdAt: FieldValue | Timestamp;
  updatedAt?: FieldValue | Timestamp;
};

type BookingSettingsDoc = {
  strengthBlocksEnabled?: boolean;
  updatedAt?: FieldValue | Timestamp;
  updatedBy?: string;
};

type BookingDoc = {
  classId: string;
  userId: string;
  userName: string;

  // booking lifecycle
  status: "booked" | "cancelled";
  createdAt: FieldValue | Timestamp;
  cancelledAt?: FieldValue | Timestamp;
  cancelledReason?: "user_cancelled" | "authorised_absence" | string;

  // attendance (day-of)
  attendanceStatus?: "none" | "checked_in" | "dip";
  attended?: boolean;
  checkedInAt?: FieldValue | Timestamp | null;
  checkedInBy?: string | null;

  // admin exception metadata
  addedByAdmin?: boolean;
  addedByAdminBy?: string;
  addedByAdminAt?: FieldValue | Timestamp;
};

type LeaderboardUserDoc = {
  userId: string;
  name: string;
  attendedCount: number;
  updatedAt: FieldValue | Timestamp;
};

type DipLeaderboardUserDoc = {
  userId: string;
  name: string;
  photoURL: string;
  dipCount: number;
  updatedAt: FieldValue | Timestamp;
};

type InviteDoc = {
  email: string;
  invitedBy: string;
  inviteToken: string;
  signUpUrl: string;
  status: "sent";
  createdAt: FieldValue | Timestamp;
  updatedAt: FieldValue | Timestamp;
  lastSentAt: FieldValue | Timestamp;
};

type StrengthSlot = "A" | "B" | null;

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

function optionalBoundedString(
  value: unknown,
  field: string,
  maxLength: number
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", `${field} must be a string`);
  }

  const normalised = value.trim();
  if (!normalised) return undefined;
  if (normalised.length > maxLength) {
    throw new HttpsError(
      "invalid-argument",
      `${field} must be ${maxLength} characters or fewer`
    );
  }
  return normalised;
}

function userAccessPatch(user: UserDoc) {
  const access = resolveUserAuthorisation(user);
  return {
    alphaWodAccess: access.alphaWodAccess,
    accessSchemaVersion: ACCESS_SCHEMA_VERSION,
  };
}

async function syncUserCustomClaims(
  userId: string,
  user: UserDoc | undefined,
  profileExists = true
): Promise<void> {
  let authUser: admin.auth.UserRecord;
  try {
    authUser = await admin.auth().getUser(userId);
  } catch (error: any) {
    if (error?.code === "auth/user-not-found") {
      console.warn("Cannot sync claims for missing Auth user", userId);
      return;
    }
    throw error;
  }

  const managed = buildManagedClaims(user, {profileExists});
  const nextClaims = mergeManagedClaims(authUser.customClaims, managed);
  if (!claimsEqual(authUser.customClaims, nextClaims)) {
    await admin.auth().setCustomUserClaims(userId, nextClaims);
  }
}

function isFailedPrecondition(error: unknown): boolean {
  const code = (error as {code?: unknown} | undefined)?.code;
  return code === 9 || code === "failed-precondition";
}

function sameDocumentVersion(
  left: admin.firestore.DocumentSnapshot,
  right: admin.firestore.DocumentSnapshot
): boolean {
  if (left.exists !== right.exists) return false;
  if (!left.exists) return true;
  return Boolean(
    left.updateTime && right.updateTime && left.updateTime.isEqual(right.updateTime)
  );
}

/**
 * Converges derived Firestore markers and Auth claims from the current profile.
 * Firestore events can be delivered out of order, so the event's `after` image
 * must never be used as the authority for revocable access state.
 */
async function convergeUserDerivedAccess(userId: string): Promise<void> {
  const userRef = db.collection("users").doc(userId);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await userRef.get();
    if (!current.exists) {
      await syncUserCustomClaims(userId, undefined, false);
      const verification = await userRef.get();
      if (!verification.exists) return;
      continue;
    }

    const user = current.data() as UserDoc;
    const accessPatch = userAccessPatch(user);
    if (user.alphaWodAccess !== accessPatch.alphaWodAccess ||
      user.accessSchemaVersion !== ACCESS_SCHEMA_VERSION) {
      if (!current.updateTime) {
        throw new Error(`Cannot derive access for ${userId} without an update time.`);
      }
      try {
        await userRef.update({
          ...accessPatch,
          updatedAt: FieldValue.serverTimestamp(),
        }, {lastUpdateTime: current.updateTime});
      } catch (error) {
        if (isFailedPrecondition(error)) continue;
        throw error;
      }
      // Re-read the version created by our marker correction before syncing
      // claims. The correction itself emits another event, but this invocation
      // also converges so correctness does not depend on its delivery order.
      continue;
    }

    await syncUserCustomClaims(userId, user, true);
    const verification = await userRef.get();
    if (sameDocumentVersion(current, verification)) return;
  }

  // retry:true asks Eventarc to redeliver after sustained concurrent writes.
  throw new Error(`User ${userId} changed repeatedly while deriving access state.`);
}

function requireStrictAuthorisation(user: UserDoc | undefined) {
  const resolved = resolveUserAuthorisation(user, {profileExists: Boolean(user)});
  if (!resolved.valid) {
    throw new HttpsError(
      "failed-precondition",
      "This account profile is incomplete or invalid. Contact support."
    );
  }
  return resolved;
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

  if (origin !== defaultInviteOrigin) {
    throw new HttpsError("invalid-argument", "origin is not an approved app URL");
  }

  return defaultInviteOrigin;
}

function inviteDocIdFor(email: string) {
  return Buffer.from(email.toLowerCase()).toString("base64url");
}

function normaliseStrengthBlock(value: unknown): "A" | "B" | "none" {
  return value === "A" || value === "B" ? value : "none";
}

function getStrengthSlotForClass(classData: Partial<ClassDoc>): StrengthSlot {
  const start = classData.startTime?.toDate?.();
  if (!start) return null;

  const title = String(classData.title ?? "").toLowerCase();
  if (!title.includes("strength")) return null;

  const zone = String(classData.timezone || "Europe/London");
  const session = DateTime.fromJSDate(start, {zone});
  const weekday = session.weekday; // Mon=1 .. Sun=7
  const hour = session.hour;

  if ((weekday === 2 || weekday === 4) && hour === 6) return "A";
  if ((weekday === 1 || weekday === 3) && hour === 18) return "B";
  return null;
}

function normaliseStrengthBlocksEnabled(value: unknown) {
  return value === false ? false : true;
}

function canUserAccessClass(
  user: Partial<UserDoc>,
  classData: Partial<ClassDoc>,
  strengthBlocksEnabled: boolean
) {
  if (!strengthBlocksEnabled) return true;

  const slot = getStrengthSlotForClass(classData);
  if (!slot) return true;

  const strengthBlock = normaliseStrengthBlock(user.strengthBlock);
  if (user.role === "admin" && strengthBlock === "none") return true;
  return strengthBlock === slot;
}

function getClassStart(classData: Partial<ClassDoc>) {
  const start = classData.startTime?.toDate?.();
  if (!start) return null;

  return DateTime.fromJSDate(start, {
    zone: String(classData.timezone || "Europe/London"),
  });
}

function getBookingClosesAt(classData: Partial<ClassDoc>) {
  const start = getClassStart(classData);
  if (!start) return null;

  if (start.hour === 5 || start.hour === 6) {
    return start.minus({days: 1}).set({
      hour: 21,
      minute: 0,
      second: 0,
      millisecond: 0,
    });
  }

  if (start.hour === 18) {
    return start.set({
      hour: 15,
      minute: 0,
      second: 0,
      millisecond: 0,
    });
  }

  return start.minus({hours: 2});
}

function assertBookingWindowOpen(classData: Partial<ClassDoc>, message: string) {
  const start = getClassStart(classData);
  const closesAt = getBookingClosesAt(classData);
  if (!start || !closesAt) return;

  const now = DateTime.now().setZone(start.zone);
  if (now >= start || now >= closesAt) {
    throw new HttpsError("failed-precondition", message);
  }
}

async function updateDipLeaderboardCount(
  tx: admin.firestore.Transaction,
  monthKey: string,
  userId: string,
  user: Partial<UserDoc>,
  bookingUserName: string | undefined,
  delta: number
) {
  if (delta === 0) return;

  const ref = db
    .collection("leaderboards")
    .doc(monthKey)
    .collection("dipUsers")
    .doc(userId);
  const snap = await tx.get(ref);
  const current = snap.exists ?
    Number((snap.data() as Partial<DipLeaderboardUserDoc>).dipCount ?? 0) :
    0;
  const nextCount = Math.max(0, current + delta);

  tx.set(
    ref,
    {
      userId,
      name: user.name ?? bookingUserName ?? "Member",
      email: FieldValue.delete(),
      photoURL: user.photoURL ?? "",
      dipCount: nextCount,
      updatedAt: FieldValue.serverTimestamp(),
    },
    {merge: true}
  );
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
                                  3. Jump into classes, programming, and progress tracking
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
        startTime: Timestamp.fromDate(start.toJSDate()),
        endTime: Timestamp.fromDate(end.toJSDate()),
        coachId: t.coachId,
        coachName: t.coachName,
        capacity: t.capacity,
        bookedCount: 0,
        location: t.location,
        status: "scheduled",
        createdAt: FieldValue.serverTimestamp(),
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
  await requireAdmin(request);

  const requestedDays = request.data?.daysAhead;
  const daysAhead = requestedDays === undefined ? 28 : requestedDays;
  if (!Number.isInteger(daysAhead) || daysAhead < 1 || daysAhead > 90) {
    throw new HttpsError(
      "invalid-argument",
      "daysAhead must be an integer between 1 and 90."
    );
  }

  try {
    return await generateRange(daysAhead as number);
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
  const bookingSettingsRef = db.collection("appSettings").doc("booking");

  return db.runTransaction(async (tx) => {
    const [
      classSnap,
      existingBookingSnap,
      userSnap,
      bookingSettingsSnap,
    ] = await Promise.all([
      tx.get(classRef),
      tx.get(bookingRef),
      tx.get(userRef),
      tx.get(bookingSettingsRef),
    ]);

    if (!classSnap.exists) throw new HttpsError("not-found", "Class not found");

    const member = assertApprovedMember(userSnap.data() as UserDoc | undefined);

    const classData = classSnap.data() as Partial<ClassDoc>;
    const bookingSettings =
      bookingSettingsSnap.data() as Partial<BookingSettingsDoc> | undefined;
    const strengthBlocksEnabled = normaliseStrengthBlocksEnabled(
      bookingSettings?.strengthBlocksEnabled
    );

    if (!canUserAccessClass(member, classData, strengthBlocksEnabled)) {
      throw new HttpsError(
        "permission-denied",
        "This member is not assigned to the strength block for this class."
      );
    }

    assertBookingWindowOpen(classData, "Booking closed");

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
      createdAt: FieldValue.serverTimestamp(),
    } satisfies BookingDoc);

    tx.update(classRef, {
      bookedCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {success: true};
  });
});

export const cancelBooking = onCall(async (request) => {
  const uid = requireAuth(request);
  const classId = requireString(request.data?.classId, "classId");

  const classRef = db.collection("classes").doc(classId);
  const bookingRef = db.collection("bookings").doc(bookingIdFor(classId, uid));
  const userRef = db.collection("users").doc(uid);

  return db.runTransaction(async (tx) => {
    const [bookingSnap, classSnap, userSnap] = await Promise.all([
      tx.get(bookingRef),
      tx.get(classRef),
      tx.get(userRef),
    ]);

    assertApprovedMember(userSnap.data() as UserDoc | undefined);

    if (!bookingSnap.exists) throw new HttpsError("not-found", "No booking found");

    const booking = bookingSnap.data() as BookingDoc;
    if (booking.status !== "booked") throw new HttpsError("failed-precondition", "No active booking found");

    if (!classSnap.exists) throw new HttpsError("not-found", "Class not found");

    const classData = classSnap.data() as Partial<ClassDoc>;
    assertBookingWindowOpen(classData, "Cancellation closed");
    const bookedCount = Number(classData.bookedCount ?? 0);

    tx.update(bookingRef, {
      status: "cancelled",
      cancelledAt: FieldValue.serverTimestamp(),
    });

    // Guard against negatives
    tx.update(classRef, {
      bookedCount: FieldValue.increment(bookedCount > 0 ? -1 : 0),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {success: true};
  });
});

export const adminAddBooking = onCall(async (request) => {
  const callerUid = requireAuth(request);
  await requireAdmin(request);

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

    const userData = assertApprovedMember(userSnap.data() as UserDoc);

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
      createdAt: FieldValue.serverTimestamp(),
      attendanceStatus: "none",
      attended: false,
      checkedInAt: null,
      checkedInBy: null,
      addedByAdmin: true,
      addedByAdminBy: callerUid,
      addedByAdminAt: FieldValue.serverTimestamp(),
    } as any);

    tx.update(classRef, {
      bookedCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {success: true};
  });
});

/** -----------------------------
 * Admin check-in
 * ----------------------------*/
export const checkInBooking = onCall(async (request) => {
  const callerUid = requireAuth(request);
  await requireAdmin(request);

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
      const prevAttendanceStatus = booking.attendanceStatus ?? (prevAttended ? "checked_in" : "none");
      const nextAttendanceStatus = nextAttended ? "checked_in" : "none";
      const dipDelta = prevAttendanceStatus === "dip" ? -1 : 0;

      if (prevAttended === nextAttended) {
        if (dipDelta !== 0) {
          const classRef = db.collection("classes").doc(booking.classId);
          const classSnap = await tx.get(classRef);
          if (!classSnap.exists) throw new HttpsError("not-found", "Class not found.");

          const classDoc = classSnap.data() as ClassDoc;
          const monthKey = ukMonthKeyFromDate(classDoc.startTime.toDate());
          const userRef = db.collection("users").doc(booking.userId);
          const userSnap = await tx.get(userRef);
          const u = (userSnap.data() || {}) as UserDoc;

          await updateDipLeaderboardCount(
            tx,
            monthKey,
            booking.userId,
            u,
            booking.userName,
            dipDelta
          );
        }

        tx.update(bookingRef, {
          checkedInBy: callerUid,
          checkedInAt: prevAttended ? FieldValue.serverTimestamp() : booking.checkedInAt ?? null,
          attendanceStatus: nextAttendanceStatus,
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

      await updateDipLeaderboardCount(
        tx,
        monthKey,
        booking.userId,
        u,
        booking.userName,
        dipDelta
      );

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
        checkedInAt: nextAttended ? FieldValue.serverTimestamp() : null,
        checkedInBy: callerUid,
      });

      // Update the member-visible leaderboard without private contact data.
      tx.set(
        lbUserRef,
        {
          userId: booking.userId,
          name: u.name ?? booking.userName ?? "Member",
          email: FieldValue.delete(),
          attendedCount: nextCount,
          updatedAt: FieldValue.serverTimestamp(),
        },
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
            updatedAt: FieldValue.serverTimestamp(),
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

type AuthedRequest = {auth?: {uid?: string; token?: Record<string, unknown>} | null};

async function requireAdmin(request: AuthedRequest): Promise<void> {
  const uid = requireAuth(request);
  const snap = await db.collection("users").doc(uid).get();
  const user = snap.exists ? snap.data() as UserDoc : undefined;
  const access = requireStrictAuthorisation(user);
  if (access.role !== "admin" || access.approvalStatus !== "approved" ||
    !access.alphaWodAccess || access.disabled) {
    throw new HttpsError("permission-denied", "Admin only.");
  }
}

async function requireAdminOrSgpt(request: AuthedRequest): Promise<void> {
  const uid = requireAuth(request);
  const snap = await db.collection("users").doc(uid).get();
  const user = snap.exists ? snap.data() as UserDoc : undefined;
  const access = requireStrictAuthorisation(user);
  if ((access.role !== "admin" && access.role !== "sgpt") ||
    access.approvalStatus !== "approved" || !access.alphaWodAccess ||
    access.disabled) {
    throw new HttpsError("permission-denied", "Staff only.");
  }
}

async function requireApprovedMember(request: AuthedRequest): Promise<void> {
  const uid = requireAuth(request);
  const snap = await db.collection("users").doc(uid).get();
  assertApprovedMember(snap.exists ? snap.data() as UserDoc : undefined);
}

/**
 * Synchronises the complete, fail-closed access claim set while preserving
 * claims owned by other systems. Firestore remains authoritative for
 * privileged callable checks so stale ID tokens cannot extend access.
 */
export const onUserDocWritten = onDocumentWritten({
  document: "users/{userId}",
  retry: true,
}, async (event) => {
  await convergeUserDerivedAccess(event.params.userId);
});

function assertApprovedMember(user: UserDoc | undefined): UserDoc {
  if (!user) {
    throw new HttpsError(
      "failed-precondition",
      "This account profile is missing. Contact support."
    );
  }
  const access = requireStrictAuthorisation(user);
  if (access.role === "banned" || access.disabled) {
    throw new HttpsError("permission-denied", "Your account is currently suspended.");
  }

  if (access.approvalStatus !== "approved") {
    throw new HttpsError("permission-denied", "Your account is awaiting admin approval.");
  }

  if (!access.alphaWodAccess) {
    throw new HttpsError(
      "permission-denied",
      "This account does not currently have Zero Alpha App access."
    );
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
  await requireAdmin(request);

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
    const dipDelta =
      (nextAttendanceStatus === "dip" ? 1 : 0) -
      (prevAttendanceStatus === "dip" ? 1 : 0);

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

      await updateDipLeaderboardCount(
        tx,
        monthKey,
        userId,
        u,
        booking.userName,
        dipDelta
      );

      tx.set(
        lbUserRef,
        {
          userId,
          name: u.name ?? booking.userName ?? "Member",
          email: FieldValue.delete(),
          attendedCount: nextLb,
          updatedAt: FieldValue.serverTimestamp(),
        },
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
            updatedAt: FieldValue.serverTimestamp(),
          },
        },
        {merge: true}
      );
    } else if (dipDelta !== 0) {
      await updateDipLeaderboardCount(
        tx,
        monthKey,
        userId,
        u,
        booking.userName,
        dipDelta
      );
    }

    // Authorised absence = cancel booking + free spot
    if (status === "authorised_absence") {
      const bookedCount = Number(classDoc.bookedCount ?? 0);

      tx.update(bookingRef, {
        status: "cancelled",
        cancelledAt: FieldValue.serverTimestamp(),
        cancelledReason: "authorised_absence",
        attendanceStatus: "none",
        attended: false,
        checkedInAt: null,
        checkedInBy: null,
      });

      tx.update(classRef, {
        bookedCount: FieldValue.increment(bookedCount > 0 ? -1 : 0),
        updatedAt: FieldValue.serverTimestamp(),
      });

      return {ok: true, kind: "authorised_absence", delta};
    }

    // booked / checked_in / dip stay as active bookings
    tx.update(bookingRef, {
      attendanceStatus: nextAttendanceStatus,
      attended: nextAttended,
      checkedInAt: nextAttended ? FieldValue.serverTimestamp() : null,
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

  await requireAdmin(request);

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
  const profileRefs = Array.from(new Set(attendees.map((b) => b.userId).filter(Boolean)))
    .map((userId) => db.collection("users").doc(userId));
  const profileSnaps = profileRefs.length ? await db.getAll(...profileRefs) : [];
  const profiles = new Map(
    profileSnaps.map((profileSnap) => [
      profileSnap.id,
      (profileSnap.data() || {}) as UserDoc,
    ])
  );

  const checkedInCount = attendees.filter((b) => b.attended === true).length;

  return {
    classId,
    total: attendees.length,
    checkedInCount,
    attendees: attendees
      .map((b) => {
        const profile = profiles.get(b.userId);
        const name = profile?.name || b.userName || "Member";

        return {
          userId: b.userId,
          userName: name,
          name,
          email: profile?.email ?? "",
          photoURL: profile?.photoURL ?? "",
          attended: Boolean(b.attended),
          attendanceStatus: b.attendanceStatus ?? (b.attended ? "checked_in" : "none"),
          checkedInAt: b.checkedInAt ?? null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
});

/**
 * Monthly Leaderboard Generation
 */
type LeaderboardSummaryRow = {
  userId: string;
  name: string;
  photoURL: string;
  attendedCount: number;
};

/**
 * Builds the merged, ranked leaderboard for a month
 * (every non-pending user appears, default count 0).
 */
async function buildMonthlyLeaderboardRows(monthKey: string): Promise<LeaderboardSummaryRow[]> {
  const [usersSnap, lbSnap] = await Promise.all([
    db.collection("users").get(),
    db.collection("leaderboards").doc(monthKey).collection("users").get(),
  ]);

  const counts = new Map<string, number>();
  lbSnap.forEach((doc) => {
    const data = doc.data() as any;
    counts.set(doc.id, Number(data.attendedCount || 0));
  });

  return usersSnap.docs
    .map((d) => {
      const user = d.data() as UserDoc;
      return {
        userId: d.id,
        name: String(user.name || "Member"),
        photoURL: String(user.photoURL || ""),
        access: resolveUserAuthorisation(user),
      };
    })
    .filter((u) => u.access.alphaWodAccess)
    .map((u) => ({
      userId: u.userId,
      name: u.name,
      photoURL: u.photoURL,
      attendedCount: counts.get(u.userId) ?? 0,
    }))
    .sort((a, b) => {
      const diff = (b.attendedCount || 0) - (a.attendedCount || 0);
      if (diff !== 0) return diff;
      return a.name.localeCompare(b.name);
    });
}

function requireLeaderboardMonthKey(value: unknown): string {
  const monthKey = resolveBoundedLeaderboardMonthKey(
    value,
    ukMonthKeyFromDate(new Date())
  );
  if (!monthKey) {
    throw new HttpsError(
      "invalid-argument",
      "monthKey must be a supported YYYY-MM month."
    );
  }
  return monthKey;
}

function leaderboardLimit(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ?
    Math.min(200, Math.floor(value)) : 200;
}

async function loadLeaderboardProfiles(values: unknown[]): Promise<Map<string, LeaderboardProfile>> {
  const userIds = Array.from(new Set(values.map((value) => {
    const row = (value || {}) as Record<string, unknown>;
    return typeof row.userId === "string" ? row.userId : "";
  }).filter(Boolean))).slice(0, LEADERBOARD_CANDIDATE_MAX_ROWS);
  if (!userIds.length) return new Map();
  const snapshots = await db.getAll(...userIds.map((userId) =>
    db.collection("users").doc(userId)
  ));
  return new Map(snapshots
    .filter((snapshot) => snapshot.exists)
    .map((snapshot) => [snapshot.id, snapshot.data() as LeaderboardProfile]));
}

/**
 * Precomputes the month's ranked leaderboard into a `summary` field on
 * `leaderboards/{monthKey}` so clients can read one doc instead of
 * calling a function that scans the whole users collection.
 */
async function rebuildLeaderboardSummary(monthKey: string): Promise<LeaderboardSummaryRow[]> {
  const rows = await buildMonthlyLeaderboardRows(monthKey);

  await db.collection("leaderboards").doc(monthKey).set(
    {
      summary: {
        rows: rows.slice(0, LEADERBOARD_CANDIDATE_MAX_ROWS),
        total: rows.length,
        updatedAt: FieldValue.serverTimestamp(),
      },
    },
    {merge: true}
  );

  return rows;
}

/**
 * Keeps the precomputed summary fresh whenever a per-user leaderboard
 * entry changes (check-ins, reconciles, etc.).
 */
export const onLeaderboardEntryWritten = onDocumentWritten(
  "leaderboards/{monthKey}/users/{userId}",
  async (event) => {
    const before = event.data?.before?.exists ? event.data.before.data() : undefined;
    const after = event.data?.after?.exists ? event.data.after.data() : undefined;
    // The Phase 0 scrub removes only legacy email fields. Counts and display
    // data are unchanged, so avoid a full rebuild for every migrated row.
    if (before && after &&
      before.userId === after.userId &&
      before.name === after.name &&
      before.photoURL === after.photoURL &&
      before.attendedCount === after.attendedCount) {
      return;
    }
    await rebuildLeaderboardSummary(event.params.monthKey);
  }
);

export const getMonthlyLeaderboard = onCall(async (request) => {
  requireAuth(request);
  await requireApprovedMember(request);

  const monthKey = requireLeaderboardMonthKey(request.data?.monthKey);
  const limit = leaderboardLimit(request.data?.limit);

  // Fast path: serve the precomputed summary.
  const monthSnap = await db.collection("leaderboards").doc(monthKey).get();
  const summary = (monthSnap.data() as any)?.summary;
  if (summary && Array.isArray(summary.rows)) {
    const profiles = await loadLeaderboardProfiles(summary.rows);
    const rows = filterAttendanceLeaderboardRows(summary.rows, profiles, limit);
    return {monthKey, total: rows.length, rows};
  }

  // A member cache miss remains read-only and bounded. Summary generation is
  // owned by trusted triggers/admin reconciliation, not arbitrary read input.
  const countSnap = await db.collection("leaderboards").doc(monthKey)
    .collection("users").limit(LEADERBOARD_CANDIDATE_MAX_ROWS).get();
  const rawRows = countSnap.docs.map((snapshot) => ({
    userId: snapshot.id,
    attendedCount: snapshot.data().attendedCount,
  }));
  const profiles = await loadLeaderboardProfiles(rawRows);
  const rows = filterAttendanceLeaderboardRows(rawRows, profiles, limit);
  return {monthKey, total: rows.length, rows};
});

export const reconcileMonthlyLeaderboard = onCall(async (request) => {
  requireAuth(request);
  await requireAdmin(request);

  const monthKey = requireLeaderboardMonthKey(request.data?.monthKey);

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
    if (!userSnap.exists) continue;
    const u = userSnap.data() as UserDoc;
    if (!resolveUserAuthorisation(u).alphaWodAccess) continue;

    const ref = lbMonthRef.collection("users").doc(userId);
    batch.set(ref, {
      userId,
      name: u.name ?? "Member",
      attendedCount,
      updatedAt: FieldValue.serverTimestamp(),
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
  requireAuth(request);
  await requireApprovedMember(request);

  const monthKey = requireLeaderboardMonthKey(request.data?.monthKey);
  const limit = leaderboardLimit(request.data?.limit);

  const dipRollupSnap = await db
    .collection("leaderboards")
    .doc(monthKey)
    .collection("dipUsers")
    .orderBy("dipCount", "desc")
    .limit(LEADERBOARD_CANDIDATE_MAX_ROWS)
    .get();

  if (!dipRollupSnap.empty) {
    const rawRows = dipRollupSnap.docs.map((snapshot) => ({
      userId: String(snapshot.data().userId || snapshot.id),
      dipCount: snapshot.data().dipCount,
    }));
    const profiles = await loadLeaderboardProfiles(rawRows);
    const rows = filterDipLeaderboardRows(rawRows, profiles, limit);

    return {monthKey, total: rows.length, rows};
  }

  // Rollups are maintained transactionally by attendance mutations. Do not
  // turn a member-facing cache miss into an all-bookings/all-classes scan.
  return {monthKey, total: 0, rows: []};
});

export const listStaffUsers = onCall(async (request) => {
  requireAuth(request);
  await requireAdminOrSgpt(request);
  const usersSnap = await db.collection("users").get();
  const users = usersSnap.docs.map((doc) => {
    const user = doc.data() as UserDoc;
    const access = resolveUserAuthorisation(user);
    const stats = user.stats ? {
      totalCheckIns: Math.max(0, Number(user.stats.totalCheckIns || 0)),
      monthCheckIns: Object.fromEntries(
        Object.entries(user.stats.monthCheckIns || {}).map(([month, count]) => [
          month,
          Math.max(0, Number(count || 0)),
        ])
      ),
      currentStreak: Math.max(0, Number(user.stats.currentStreak || 0)),
      longestStreak: Math.max(0, Number(user.stats.longestStreak || 0)),
      lastCheckInDate: typeof user.stats.lastCheckInDate === "string" ?
        user.stats.lastCheckInDate : null,
    } : undefined;

    return {
      id: doc.id,
      name: typeof user.name === "string" ? user.name : "",
      email: typeof user.email === "string" ? user.email : "",
      photoURL: typeof user.photoURL === "string" ? user.photoURL : "",
      role: access.role,
      approvalStatus: access.approvalStatus,
      entitlementStatus: access.entitlementStatus,
      entitlementSource: access.entitlementSource,
      alphaWodAccess: access.alphaWodAccess,
      strengthBlock: user.strengthBlock === "A" || user.strengthBlock === "B" ?
        user.strengthBlock : "none",
      stats,
    };
  });
  return {users};
});

export const bootstrapUserProfile = onCall(async (request) => {
  const userId = requireAuth(request);
  const requestedName = optionalBoundedString(request.data?.displayName, "displayName", 120);
  const authUser = await admin.auth().getUser(userId);
  const canonicalEmail = authUser.email?.trim().toLowerCase() || null;
  const fallbackName = authUser.displayName?.trim() || null;
  const userRef = db.collection("users").doc(userId);
  let finalUser: UserDoc = {};

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const existing = snap.exists ? snap.data() as UserDoc : {};
    const existingAccess = resolveUserAuthorisation(existing);
    const safeAuthorisation = existingAccess.valid ? {
      role: existingAccess.role,
      approvalStatus: existingAccess.approvalStatus,
      entitlementStatus: existingAccess.entitlementStatus,
      entitlementSource: existingAccess.entitlementSource,
    } : {
      role: "user" as const,
      approvalStatus: "pending" as const,
      entitlementStatus: "none" as const,
      entitlementSource: "none" as const,
    };
    const nextAccess = resolveUserAuthorisation(safeAuthorisation);
    const currentName = typeof existing.name === "string" && existing.name.trim() ?
      existing.name.trim() : undefined;
    const resolvedName = currentName || requestedName || fallbackName || undefined;

    const patch = {
      ...safeAuthorisation,
      alphaWodAccess: nextAccess.alphaWodAccess,
      accessSchemaVersion: ACCESS_SCHEMA_VERSION,
      profileSchemaVersion: 1,
      email: canonicalEmail,
      emailVerified: authUser.emailVerified,
      ...(resolvedName ? {name: resolvedName} : {}),
      strengthBlock: existing.strengthBlock === "A" || existing.strengthBlock === "B" ?
        existing.strengthBlock : "none",
      updatedAt: FieldValue.serverTimestamp(),
      ...(!snap.exists || !existing.createdAt ? {
        createdAt: FieldValue.serverTimestamp(),
      } : {}),
    };

    tx.set(userRef, patch, {merge: true});
    finalUser = {...existing, ...patch};
  });

  await convergeUserDerivedAccess(userId);
  const access = resolveUserAuthorisation(finalUser);
  return {
    ok: true,
    profile: {
      userId,
      role: access.role,
      approvalStatus: access.approvalStatus,
      entitlementStatus: access.entitlementStatus,
      entitlementSource: access.entitlementSource,
      alphaWodAccess: access.alphaWodAccess,
    },
  };
});

export const acceptCurrentWaiver = onCall(async (request) => {
  const userId = requireAuth(request);
  const signedName = optionalBoundedString(request.data?.signedName, "signedName", 160);
  if (!signedName || signedName.length < 2) {
    throw new HttpsError("invalid-argument", "signedName must contain at least 2 characters.");
  }

  if (request.data?.version !== CURRENT_WAIVER_VERSION) {
    throw new HttpsError(
      "failed-precondition",
      `The current waiver version is ${CURRENT_WAIVER_VERSION}.`
    );
  }
  if (!Array.isArray(request.data?.acknowledgements) ||
    request.data.acknowledgements.length !== CURRENT_WAIVER_ACKNOWLEDGEMENTS.length ||
    !CURRENT_WAIVER_ACKNOWLEDGEMENTS.every(
      (text, index) => request.data.acknowledgements[index] === text
    )) {
    throw new HttpsError(
      "invalid-argument",
      "Every current waiver acknowledgement must be accepted exactly."
    );
  }
  if (typeof request.data?.mediaConsent !== "boolean") {
    throw new HttpsError("invalid-argument", "mediaConsent must be true or false.");
  }

  const authUser = await admin.auth().getUser(userId);
  const firebaseToken = request.auth?.token?.firebase as
    {sign_in_provider?: unknown} | undefined;
  const userRef = db.collection("users").doc(userId);
  const acceptanceRef = db.collection("waiverAcceptances")
    .doc(`${userId}__${CURRENT_WAIVER_VERSION}`);
  let alreadyAccepted = false;

  await db.runTransaction(async (tx) => {
    const [userSnap, acceptanceSnap] = await Promise.all([
      tx.get(userRef),
      tx.get(acceptanceRef),
    ]);
    if (!userSnap.exists) {
      throw new HttpsError(
        "failed-precondition",
        "Create your member profile before accepting the waiver."
      );
    }

    if (acceptanceSnap.exists) {
      const existingAcceptance = acceptanceSnap.data();
      if (!isCanonicalCurrentWaiverAcceptance(userId, existingAcceptance)) {
        throw new HttpsError(
          "failed-precondition",
          "Stored waiver evidence is invalid. Contact an administrator before retrying."
        );
      }
      alreadyAccepted = true;
      const existingAcceptedAt = acceptanceSnap.get("acceptedAt");
      tx.set(userRef, {
        waiverAcceptedVersion: CURRENT_WAIVER_VERSION,
        waiverAcceptedAt: existingAcceptedAt,
      }, {merge: true});
      return;
    }

    const acceptedAt = FieldValue.serverTimestamp();
    tx.create(acceptanceRef, {
      acceptanceSchemaVersion: 1,
      userId,
      version: CURRENT_WAIVER_VERSION,
      agreementTitle: CURRENT_WAIVER_TITLE,
      acceptedAt,
      acceptedName: signedName,
      acceptedEmail: authUser.email?.trim().toLowerCase() || null,
      acceptedEmailVerified: authUser.emailVerified,
      acknowledgements: [...CURRENT_WAIVER_ACKNOWLEDGEMENTS],
      mediaConsent: request.data.mediaConsent,
      authenticatedAt: request.auth?.token?.auth_time || null,
      signInProvider: typeof firebaseToken?.sign_in_provider === "string" ?
        firebaseToken.sign_in_provider : null,
      userAgent: String(request.rawRequest.get("user-agent") || "").slice(0, 500),
      source: "authenticated_callable",
    });
    tx.set(userRef, {
      waiverAcceptedVersion: CURRENT_WAIVER_VERSION,
      waiverAcceptedAt: acceptedAt,
    }, {merge: true});
  });

  return {ok: true, version: CURRENT_WAIVER_VERSION, alreadyAccepted};
});

export const setMemberEntitlement = onCall(async (request) => {
  const callerUid = requireAuth(request);
  await requireAdmin(request);
  const userId = requireString(request.data?.userId, "userId");
  const status = request.data?.entitlementStatus;
  const source = request.data?.entitlementSource;
  if (!isEntitlementStatus(status) || !isEntitlementSource(source) ||
    !isValidEntitlementPair(status, source)) {
    throw new HttpsError(
      "invalid-argument",
      "entitlementStatus and entitlementSource are not a valid combination."
    );
  }
  if ((status === "none" && source !== "none") ||
    (status !== "none" && source !== "manual")) {
    throw new HttpsError(
      "invalid-argument",
      "Administrative entitlement changes must use source manual, or none when removing access."
    );
  }

  const planKey = optionalBoundedString(request.data?.planKey, "planKey", 100);
  const reason = optionalBoundedString(request.data?.reason, "reason", 500);
  const userRef = db.collection("users").doc(userId);
  const entitlementOwnerRef = db.collection("membershipEntitlementOwners")
    .doc(sha256(userId));
  let finalUser: UserDoc | undefined;

  await db.runTransaction(async (tx) => {
    const [snap, entitlementOwner] = await Promise.all([
      tx.get(userRef),
      tx.get(entitlementOwnerRef),
    ]);
    if (!snap.exists) throw new HttpsError("not-found", "User not found.");
    // A paid membership owns both the current Stripe projection and the
    // entitlement value that must be restored when it ends. Allowing a manual
    // edit here would leave that frozen restoration snapshot stale, so a later
    // cancellation could silently erase the administrator's newer decision.
    // Fail closed until the membership generation has atomically released its
    // owner row; support can then apply the manual change normally.
    if (entitlementOwner.exists && entitlementOwner.get("state") !== "released") {
      throw new HttpsError(
        "failed-precondition",
        "This member has an active Stripe entitlement. End or repair that membership before assigning manual access."
      );
    }
    const user = snap.data() as UserDoc;
    if (!isUserRole(user.role) || !isApprovalStatus(user.approvalStatus)) {
      throw new HttpsError(
        "failed-precondition",
        "The member role or approval state is invalid; repair it before assigning access."
      );
    }
    if (!isEntitlementCompatibleWithRole(user.role, status, source)) {
      throw new HttpsError(
        "invalid-argument",
        "That active entitlement source is not valid for the member role."
      );
    }

    const next = {
      role: user.role,
      approvalStatus: user.approvalStatus,
      entitlementStatus: status,
      entitlementSource: source,
    };
    const access = resolveUserAuthorisation(next);
    const patch = {
      ...next,
      alphaWodAccess: access.alphaWodAccess,
      accessSchemaVersion: ACCESS_SCHEMA_VERSION,
      entitlementPlanKey: planKey || FieldValue.delete(),
      entitlementReason: reason || FieldValue.delete(),
      entitlementUpdatedAt: FieldValue.serverTimestamp(),
      entitlementUpdatedBy: callerUid,
      updatedAt: FieldValue.serverTimestamp(),
    };
    tx.set(userRef, patch, {merge: true});
    finalUser = {...user, ...next, alphaWodAccess: access.alphaWodAccess};
  });

  await convergeUserDerivedAccess(userId);
  const access = resolveUserAuthorisation(finalUser);
  return {ok: true, userId, ...access};
});

export const approveUserAccess = onCall(async (request) => {
  const callerUid = requireAuth(request);
  await requireAdmin(request);

  const userId = requireString(request.data?.userId, "userId");
  const userRef = db.collection("users").doc(userId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) throw new HttpsError("not-found", "User not found.");
    const user = snap.data() as UserDoc;
    if (!isUserRole(user.role)) {
      throw new HttpsError("failed-precondition", "The member role is invalid.");
    }
    if (user.role === "admin") {
      throw new HttpsError("failed-precondition", "Admins do not require approval.");
    }
    if (user.role === "banned") {
      throw new HttpsError("failed-precondition", "A suspended member cannot be approved.");
    }

    const memberSources: EntitlementSource[] = ["legacy", "manual", "stripe"];
    const preserveMemberEntitlement = user.role === "user" &&
      user.entitlementStatus === "active" &&
      isEntitlementSource(user.entitlementSource) &&
      memberSources.includes(user.entitlementSource);
    const entitlementStatus: EntitlementStatus = "active";
    const entitlementSource: EntitlementSource = user.role === "sgpt" ?
      "staff" : preserveMemberEntitlement ?
        user.entitlementSource as EntitlementSource : "manual";
    const next = {
      role: user.role,
      approvalStatus: "approved" as const,
      entitlementStatus,
      entitlementSource,
    };
    const access = resolveUserAuthorisation(next);
    const patch = {
      ...next,
      alphaWodAccess: access.alphaWodAccess,
      accessSchemaVersion: ACCESS_SCHEMA_VERSION,
      approvedAt: FieldValue.serverTimestamp(),
      approvedBy: callerUid,
      entitlementUpdatedAt: FieldValue.serverTimestamp(),
      entitlementUpdatedBy: callerUid,
      updatedAt: FieldValue.serverTimestamp(),
    };
    tx.set(userRef, patch, {merge: true});
  });

  await convergeUserDerivedAccess(userId);

  return {ok: true};
});

export const updateMemberRole = onCall(async (request) => {
  const callerUid = requireAuth(request);
  await requireAdmin(request);

  const userId = requireString(request.data?.userId, "userId");
  const role = requireString(request.data?.role, "role") as "user" | "sgpt" | "banned";

  if (role !== "user" && role !== "sgpt" && role !== "banned") {
    throw new HttpsError("invalid-argument", "Role must be user, sgpt, or banned.");
  }

  const userRef = db.collection("users").doc(userId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) throw new HttpsError("not-found", "User not found.");
    const user = snap.data() as UserDoc;
    if (!isUserRole(user.role)) {
      throw new HttpsError("failed-precondition", "The member role is invalid.");
    }
    if (user.role === "admin") {
      throw new HttpsError("failed-precondition", "Admins cannot be reassigned.");
    }

    const entitlementStatus: EntitlementStatus = role === "sgpt" ?
      "active" : role === "banned" ? "restricted" : "none";
    const entitlementSource: EntitlementSource = role === "sgpt" ?
      "staff" : role === "banned" ? "manual" : "none";
    const next = {
      role,
      approvalStatus: "approved" as const,
      entitlementStatus,
      entitlementSource,
    };
    const access = resolveUserAuthorisation(next);
    const patch = {
      ...next,
      alphaWodAccess: access.alphaWodAccess,
      accessSchemaVersion: ACCESS_SCHEMA_VERSION,
      updatedAt: FieldValue.serverTimestamp(),
      ...(role === "banned" ? {
        suspendedAt: FieldValue.serverTimestamp(),
        suspendedBy: callerUid,
        entitlementReason: "suspended_by_admin",
      } : {
        restoredAt: FieldValue.serverTimestamp(),
        restoredBy: callerUid,
        entitlementReason: role === "user" ?
          "access_requires_explicit_entitlement" : "staff_role",
      }),
    };
    tx.set(userRef, patch, {merge: true});
  });

  await convergeUserDerivedAccess(userId);

  return {ok: true};
});

export const updateMemberStrengthBlock = onCall(async (request) => {
  const callerUid = requireAuth(request);
  await requireAdmin(request);

  const userId = requireString(request.data?.userId, "userId");
  const strengthBlock = normaliseStrengthBlock(request.data?.strengthBlock);

  if (
    strengthBlock !== "A" &&
    strengthBlock !== "B" &&
    strengthBlock !== "none"
  ) {
    throw new HttpsError("invalid-argument", "Strength block must be A, B, or none.");
  }

  const userRef = db.collection("users").doc(userId);
  const snap = await userRef.get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "User not found.");
  }

  await userRef.set({
    strengthBlock,
    updatedAt: FieldValue.serverTimestamp(),
    strengthBlockUpdatedAt: FieldValue.serverTimestamp(),
    strengthBlockUpdatedBy: callerUid,
  }, {merge: true});

  return {ok: true};
});

export const updateStrengthBlockSettings = onCall(async (request) => {
  const callerUid = requireAuth(request);
  await requireAdmin(request);

  if (typeof request.data?.strengthBlocksEnabled !== "boolean") {
    throw new HttpsError(
      "invalid-argument",
      "strengthBlocksEnabled must be a boolean."
    );
  }

  const strengthBlocksEnabled = request.data.strengthBlocksEnabled;

  await db.collection("appSettings").doc("booking").set({
    strengthBlocksEnabled,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: callerUid,
  } satisfies BookingSettingsDoc, {merge: true});

  return {ok: true, strengthBlocksEnabled};
});

export const inviteMemberByEmail = onCall({secrets: [resendApiKey, resendFromEmail]}, async (request) => {
  const callerUid = requireAuth(request);
  await requireAdmin(request);

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
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    lastSentAt: FieldValue.serverTimestamp(),
  } satisfies InviteDoc, {merge: true});

  return {ok: true, signUpUrl};
});

/** -----------------------------
 * Phase 1: membership purchase and Stripe Billing
 *
 * The membership module is self-contained and receives the two trusted Phase 0
 * routines it must not reimplement: derived-access convergence and the admin
 * guard. Handlers are re-exported here so the deployed function names stay in
 * one manifest.
 * ----------------------------*/
export {
  createCustomerPortalSession,
  getMyMemberships,
} from "./membership";

export const createMembershipCheckoutSession = buildCreateMembershipCheckoutSession(
  convergeUserDerivedAccess,
  MEMBERSHIP_CHECKOUT_SCHEMA_VERSION
);
// Both names require the explicit current browser contract. A pre-v2 page
// therefore cannot submit old checkbox ids and have the server silently store
// the new legal/commercial statements. Already-created Sessions continue to
// fulfil independently from their frozen membership intent.
export const createMembershipCheckoutSessionV2 = buildCreateMembershipCheckoutSession(
  convergeUserDerivedAccess,
  MEMBERSHIP_CHECKOUT_SCHEMA_VERSION
);
export const stripeWebhook = buildStripeWebhook(convergeUserDerivedAccess);
export const recoverStripeEvents = buildRecoverStripeEvents(convergeUserDerivedAccess);
export const recoverMembershipCancellations = buildRecoverMembershipCancellations(
  convergeUserDerivedAccess
);
export const reconcilePastDueMemberships = buildReconcilePastDueMemberships(
  convergeUserDerivedAccess
);
export const retryMembershipConfirmations = buildRetryMembershipConfirmations();
export const requestMembershipCancellation = buildRequestMembershipCancellation(
  convergeUserDerivedAccess
);
export const claimMembership = buildClaimMembership(convergeUserDerivedAccess);
export const listMemberships = buildListMemberships(requireAdmin);
export const releaseAbandonedMembershipCheckout =
  buildReleaseAbandonedMembershipCheckout(requireAdmin);
export const linkMembershipParticipant = buildLinkMembershipParticipant(
  requireAdmin,
  convergeUserDerivedAccess
);
