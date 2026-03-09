// src/pages/Profile.tsx
import React, { useEffect, useMemo, useState } from "react";
import { getAuth, updateEmail, updateProfile } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  documentId,
  Timestamp,
} from "firebase/firestore";
import { getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";
import { db } from "../firebase";
import { Camera, Save, AlertTriangle, Flame, Trophy, CheckCircle2, Dumbbell, Activity, Calendar } from "lucide-react";
import UserTopNav from "../components/UserTopNav";

type UserStats = {
  totalCheckIns?: number;
  monthCheckIns?: Record<string, number>;
  currentStreak?: number;
  longestStreak?: number;
  lastCheckInDate?: string; // YYYY-MM-DD (Europe/London)
};

type UserDoc = {
  name?: string;
  email?: string;
  role?: string;
  photoURL?: string;
  stats?: UserStats;
};

type BookingDoc = {
  classId: string;
  userId: string;
  userName?: string;
  status: "booked" | "cancelled";
  createdAt?: Timestamp;
  cancelledAt?: Timestamp;
};

type ClassDoc = {
  title?: string;
  timezone?: string;
  startTime: Timestamp;
  endTime?: Timestamp;
  coachName?: string;
  location?: string;
  status?: "scheduled" | "cancelled";
};

function monthKeyLondon(d: Date) {
  // "YYYY-MM" in Europe/London
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(d);

  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "00";
  return `${y}-${m}`;
}

function StatPill({
  label,
  value,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs uppercase tracking-[0.35em] text-white/50 font-semibold">{label}</div>
        {icon ? <div className="text-white/60">{icon}</div> : null}
      </div>
      <div className="mt-2 text-3xl font-extrabold tracking-tight text-white">{value}</div>
    </div>
  );
}

function getAttendanceTier(count: number) {
  if (count >= 16) {
    return {
      label: "Gold",
      short: "GOLD",
      nextTarget: null,
      tone: "gold" as const,
    };
  }

  if (count >= 12) {
    return {
      label: "Silver",
      short: "SILVER",
      nextTarget: 16,
      tone: "silver" as const,
    };
  }

  if (count >= 8) {
    return {
      label: "Bronze",
      short: "BRONZE",
      nextTarget: 12,
      tone: "bronze" as const,
    };
  }

  if (count >= 4) {
    return {
      label: "Starter",
      short: "STARTER",
      nextTarget: 8,
      tone: "starter" as const,
    };
  }

  return {
    label: "Unranked",
    short: "UNRANKED",
    nextTarget: 4,
    tone: "base" as const,
  };
}

function TierChip({ count }: { count: number }) {
  const tier = getAttendanceTier(count);

  const styles =
    tier.tone === "gold"
      ? "border-yellow-500/25 bg-yellow-500/10 text-yellow-100"
      : tier.tone === "silver"
      ? "border-zinc-300/15 bg-zinc-200/10 text-zinc-100"
      : tier.tone === "bronze"
      ? "border-amber-700/25 bg-amber-700/10 text-amber-100"
      : tier.tone === "starter"
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
      : "border-white/10 bg-white/[0.04] text-white/70";

  return (
    <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.25em] ${styles}`}>
      <span className="h-2 w-2 rounded-full bg-current opacity-80" />
      {tier.short}
    </div>
  );
}

function ProgressCard({
  monthCount,
}: {
  monthCount: number;
}) {
  const tier = getAttendanceTier(monthCount);
  const nextTarget = tier.nextTarget;
  const remaining = nextTarget ? Math.max(0, nextTarget - monthCount) : 0;
  const progressPct = nextTarget
    ? Math.max(0, Math.min(100, (monthCount / nextTarget) * 100))
    : 100;

  return (
    <div className="rounded-3xl border border-neutral-800 bg-neutral-950/90 p-5">
      <div className="text-xs font-semibold uppercase tracking-[0.35em] text-white/50">
        This month
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-3xl font-extrabold tracking-tight text-white">{monthCount}</div>
          <div className="mt-1 text-sm text-white/55">Classes attended</div>
        </div>

        <TierChip count={monthCount} />
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between text-xs text-white/45">
          <span>Progress</span>
          <span>
            {nextTarget ? `${monthCount}/${nextTarget}` : "Top tier reached"}
          </span>
        </div>

        <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-white/40 transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <div className="mt-4 text-sm text-white/65">
        {nextTarget
          ? `${remaining} more ${remaining === 1 ? "class" : "classes"} to reach ${getAttendanceTier(nextTarget).label}.`
          : "You’ve reached the top attendance tier this month."}
      </div>
    </div>
  );
}

function fmtDateShort(d: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone,
  }).format(d);
}

function fmtTimeShort(d: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(d);
}

function classIcon(title?: string) {
  const t = (title || "").toLowerCase();

  if (t.includes("hyrox")) {
    return <Flame className="h-5 w-5 text-yellow-400" />;
  }

  if (t.includes("strength")) {
    return <Dumbbell className="h-5 w-5 text-sky-400" />;
  }

  if (t.includes("bags")) {
    return <Activity className="h-5 w-5 text-orange-400" />;
  }

  return <Calendar className="h-5 w-5 text-white/50" />;
}

function timeUntil(start: Date) {
  const now = Date.now();
  const diff = start.getTime() - now;

  if (diff <= 0) return "Starting soon";

  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const m = mins % 60;

  if (hours > 0) return `Starts in ${hours}h ${m}m`;
  return `Starts in ${m}m`;
}

export default function Profile() {
  const auth = useMemo(() => getAuth(), []);
  const storage = useMemo(() => getStorage(), []);
  const user = auth.currentUser;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // UI state (stored as displayName, maps to Firestore `name`)
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [photoURL, setPhotoURL] = useState<string | undefined>(undefined);

  const [stats, setStats] = useState<UserStats | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [previewURL, setPreviewURL] = useState<string | null>(null);

  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [upcomingClasses, setUpcomingClasses] = useState<Array<{ id: string; data: ClassDoc }>>([]);

  function onPickFile(f: File | null) {
    setErr(null);
    setMsg(null);
    setFile(f);

    if (previewURL) URL.revokeObjectURL(previewURL);
    setPreviewURL(f ? URL.createObjectURL(f) : null);
  }

  useEffect(() => {
    return () => {
      if (previewURL) URL.revokeObjectURL(previewURL);
    };
  }, [previewURL]);

  useEffect(() => {
    (async () => {
      setErr(null);
      setMsg(null);

      if (!user) {
        setErr("You must be logged in to view your profile.");
        setLoading(false);
        return;
      }

      try {
        const userRef = doc(db, "users", user.uid);
        const snap = await getDoc(userRef);

        const data = (snap.exists() ? (snap.data() as UserDoc) : {}) as UserDoc;

        const nameFromDoc = data.name ?? "";
        const emailFromDoc = data.email ?? "";
        const picFromDoc = data.photoURL ?? "";

        const resolvedName = nameFromDoc || user.displayName || "";
        const resolvedEmail = emailFromDoc || user.email || "";
        const resolvedPhoto = picFromDoc || user.photoURL || undefined;

        setDisplayName(resolvedName);
        setEmail(resolvedEmail);
        setPhotoURL(resolvedPhoto);

        setStats(data.stats ?? null);

        // Ensure doc exists (merge so we don’t clobber anything)
        if (!snap.exists()) {
          await setDoc(
            userRef,
            {
              name: resolvedName || null,
              email: resolvedEmail || null,
              role: "user",
              photoURL: resolvedPhoto ?? null,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              stats: {
                totalCheckIns: 0,
                monthCheckIns: {},
                currentStreak: 0,
                longestStreak: 0,
                lastCheckInDate: null,
                updatedAt: serverTimestamp(),
              },
            },
            { merge: true }
          );
          setStats({
            totalCheckIns: 0,
            monthCheckIns: {},
            currentStreak: 0,
            longestStreak: 0,
          });
        }

        const bookingsRef = collection(db, "bookings");
        const bookingsQ = query(
          bookingsRef,
          where("userId", "==", user.uid),
          where("status", "==", "booked")
        );

        const bookingsSnap = await getDocs(bookingsQ);
        const activeBookings = bookingsSnap.docs.map((d) => d.data() as BookingDoc);

        const classIds = Array.from(new Set(activeBookings.map((b) => b.classId).filter(Boolean)));

        if (classIds.length) {
          const classDocs: Array<{ id: string; data: ClassDoc }> = [];

          for (let i = 0; i < classIds.length; i += 10) {
            const chunk = classIds.slice(i, i + 10);
            const classesQ = query(collection(db, "classes"), where(documentId(), "in", chunk));
            const classesSnap = await getDocs(classesQ);

            classesSnap.forEach((d) => {
              classDocs.push({
                id: d.id,
                data: d.data() as ClassDoc,
              });
            });
          }

          const now = Date.now();

          const upcoming = classDocs
            .filter((c) => {
              const start = c.data.startTime?.toDate?.();
              return (
                !!start &&
                start.getTime() > now &&
                (c.data.status ?? "scheduled") === "scheduled"
              );
            })
            .sort((a, b) => a.data.startTime.toDate().getTime() - b.data.startTime.toDate().getTime());

          setUpcomingClasses(upcoming);
        } else {
          setUpcomingClasses([]);
        }
      } catch (e: any) {
        setErr(e?.message ?? "Failed to load profile.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function uploadProfilePicIfNeeded(): Promise<string | null> {
    if (!user) return null;
    if (!file) return null;

    if (!file.type.startsWith("image/")) {
      throw new Error("Please upload an image file.");
    }

    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const safeExt = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "jpg";
    const path = `profilePics/${user.uid}.${safeExt}`;

    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file, { contentType: file.type });
    return await getDownloadURL(storageRef);
  }

  async function onSave() {
    if (!user) return;

    setSaving(true);
    setErr(null);
    setMsg(null);

    try {
      const newPhotoURL = await uploadProfilePicIfNeeded();

      const authUpdates: { displayName?: string; photoURL?: string } = {};
      const trimmedName = displayName.trim();

      if (trimmedName && trimmedName !== (user.displayName ?? "")) authUpdates.displayName = trimmedName;
      if (newPhotoURL) authUpdates.photoURL = newPhotoURL;

      if (Object.keys(authUpdates).length) await updateProfile(user, authUpdates);

      const nextEmail = email.trim();
      const currentEmail = user.email ?? "";
      if (nextEmail && nextEmail !== currentEmail) await updateEmail(user, nextEmail);

      await setDoc(
        doc(db, "users", user.uid),
        {
          name: trimmedName || null,
          email: (user.email ?? nextEmail) || null,
          photoURL: (newPhotoURL ?? user.photoURL) || null,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      if (newPhotoURL) {
        setPhotoURL(newPhotoURL);
        onPickFile(null);
      }

      setMsg("Profile updated.");
    } catch (e: any) {
      const code = e?.code || "";
      if (code.includes("requires-recent-login")) {
        setErr("To change email, please log out and log back in, then try again.");
      } else {
        setErr(e?.message ?? "Failed to update profile.");
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-white/80 p-6">Loading profile…</div>;
  }

  const mk = monthKeyLondon(new Date());
  const monthCount = stats?.monthCheckIns?.[mk] ?? 0;
  const currentStreak = stats?.currentStreak ?? 0;
  const longestStreak = stats?.longestStreak ?? 0;
  const totalCheckIns = stats?.totalCheckIns ?? 0;

    return (
    <div className="min-h-screen bg-black text-white">
      <UserTopNav />

      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Hero */}
        <div className="relative overflow-hidden rounded-[28px] border border-neutral-800 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.03),transparent_35%),linear-gradient(180deg,rgba(15,15,15,0.97),rgba(0,0,0,0.99))] px-6 py-6 sm:px-8 sm:py-8 shadow-[0_0_50px_rgba(0,0,0,0.45)]">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent_60%)]" />
          <div className="pointer-events-none absolute -top-16 left-1/4 h-56 w-56 rounded-full bg-white/[0.015] blur-3xl" />

          <div className="relative">
            <div className="text-xs font-semibold uppercase tracking-[0.35em] text-white/55">
              Profile
            </div>

            <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h1 className="text-5xl leading-none sm:text-7xl font-heading uppercase tracking-[0.04em] text-white">
                  Your Account
                </h1>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <TierChip count={monthCount} />
                  <div className="text-sm text-white/45">
                    {monthCount} classes this month • {totalCheckIns} lifetime
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Top dashboard row */}
        <div className="mt-8 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          {/* Stats block */}
          <div className="rounded-3xl border border-neutral-800 bg-neutral-950 p-6 sm:p-7">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.35em] text-white/50">
                  Performance
                </div>
                <div className="mt-2 text-2xl font-bold text-white/95">
                  Your training stats
                </div>
              </div>

              <TierChip count={monthCount} />
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatPill
                label="Streak"
                value={currentStreak}
                icon={<Flame className="h-4 w-4 text-orange-400" />}
              />

              <StatPill
                label="Longest"
                value={longestStreak}
                icon={<Trophy className="h-4 w-4 text-yellow-400" />}
              />

              <StatPill
                label="Month"
                value={monthCount}
                icon={<CheckCircle2 className="h-4 w-4 text-blue-400" />}
              />

              <StatPill
                label="Total"
                value={totalCheckIns}
                icon={<CheckCircle2 className="h-4 w-4 text-emerald-400" />}
              />
            </div>
          </div>

          {/* Progress block */}
          <ProgressCard monthCount={monthCount} />
        </div>

        {/* Main account card */}
        <div className="mt-8 rounded-3xl border border-neutral-800 bg-neutral-950 p-6 sm:p-8">
          <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
            {/* Avatar / identity rail */}
            <div className="flex flex-col items-center lg:items-start">
              <div className="relative">
                <div className="h-40 w-40 overflow-hidden rounded-full border border-neutral-800 bg-neutral-900/40 shadow-[0_10px_40px_rgba(0,0,0,0.45)]">
                  <img
                    src={previewURL || photoURL || "https://dummyimage.com/256x256/111/fff&text=ZA"}
                    alt={displayName ? `${displayName}'s profile picture` : "Profile"}
                    className="h-full w-full object-cover"
                  />
                </div>

                <label className="absolute -bottom-3 left-1/2 inline-flex -translate-x-1/2 cursor-pointer items-center gap-2 rounded-2xl border border-neutral-800 bg-neutral-900 px-4 py-2 text-sm font-semibold text-white/90 hover:bg-neutral-800">
                  <Camera className="h-4 w-4" />
                  Change
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>

              {file && (
                <div className="mt-6 max-w-[220px] text-center text-xs text-white/65 lg:text-left">
                  Selected: <span className="font-semibold text-white/90">{file.name}</span>
                </div>
              )}

              <div className="mt-8 w-full rounded-2xl border border-neutral-800 bg-neutral-900/30 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.3em] text-white/45">
                  Member status
                </div>
                <div className="mt-3 text-lg font-bold text-white/95">
                  {getAttendanceTier(monthCount).label} Tier
                </div>
                <div className="mt-1 text-sm text-white/55">
                  Based on your monthly attendance.
                </div>
              </div>
            </div>

            {/* Form */}
            <div className="space-y-5">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-[0.35em] text-white/50">
                  Display name
                </label>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                  className="mt-2 w-full rounded-2xl border border-neutral-800 bg-neutral-900/40 px-5 py-4 text-lg font-semibold text-white outline-none transition focus:border-white/25"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-[0.35em] text-white/50">
                  Email
                </label>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@email.com"
                  className="mt-2 w-full rounded-2xl border border-neutral-800 bg-neutral-900/40 px-5 py-4 text-lg font-semibold text-white outline-none transition focus:border-white/25"
                />
                <div className="mt-3 flex items-center gap-2 text-xs text-white/45">
                  <AlertTriangle className="h-4 w-4" />
                  Changing email may require you to log out and back in.
                </div>
              </div>

              {(err || msg) && (
                <div
                  className={[
                    "rounded-2xl border px-4 py-3 text-sm",
                    err
                      ? "border-red-900/60 bg-red-950/30 text-red-200"
                      : "border-emerald-900/60 bg-emerald-950/30 text-emerald-200",
                  ].join(" ")}
                >
                  {err ?? msg}
                </div>
              )}

              <div className="pt-2">
                <button
                  onClick={onSave}
                  disabled={saving}
                  className="inline-flex items-center gap-3 rounded-2xl bg-white px-6 py-4 text-sm font-extrabold uppercase tracking-[0.25em] text-black transition hover:bg-white/90 disabled:opacity-60"
                >
                  <Save className="h-4 w-4" />
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Upcoming classes card */}
        <div className="mt-8 rounded-3xl border border-neutral-800 bg-neutral-950 p-6 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.35em] text-white/50">
                Upcoming
              </div>
              <div className="mt-2 text-2xl font-bold text-white/95">
                My upcoming classes
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-white/55">
                {upcomingClasses.length} booked
              </div>
            </div>
          </div>

          {upcomingClasses.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900/30 p-5 text-sm text-white/60">
              You’ve got no upcoming classes booked right now.
            </div>
          ) : (
            <>
              {/* Upcoming list */}
              <div className="mt-6 grid gap-3">
                {upcomingClasses.map(({ id, data }) => {
                  const tz = data.timezone || "Europe/London";
                  const start = data.startTime.toDate();
                  const end = data.endTime?.toDate?.();

                  return (
                    <div
                      key={id}
                      className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-4 transition hover:border-white/15 hover:bg-neutral-900/40"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex items-center gap-3">
                            {classIcon(data.title)}

                            <div>
                              <div className="text-lg font-bold text-white">
                                {data.title || "Class"}
                              </div>

                              <div className="mt-1 text-sm text-white/55">
                                {fmtDateShort(start, tz)} • {fmtTimeShort(start, tz)}
                                {end ? `–${fmtTimeShort(end, tz)}` : ""} • {data.location || "Main Floor"}
                              </div>

                              <div className="mt-1 text-sm text-white/40">
                                Coach: {data.coachName || "TBC"}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 sm:flex-col sm:items-end">
                          <div className="text-xs font-semibold uppercase tracking-wider text-white/45">
                            {timeUntil(start)}
                          </div>

                          <div className="shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-extrabold uppercase tracking-[0.25em] text-emerald-200">
                            Booked
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Secondary card */}
        <div className="mt-8 rounded-3xl border border-neutral-800 bg-neutral-950 p-6 sm:p-7">
          <div className="text-xs font-semibold uppercase tracking-[0.35em] text-white/50">
            Coming next
          </div>
          <div className="mt-2 text-2xl font-bold text-white/95">
            Lifts & PB&apos;s
          </div>
          <div className="mt-3 max-w-2xl text-sm text-white/60">
            Track strength numbers, Hyrox benchmarks, and bodyweight progress in one place.
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-4 text-sm text-white/65">
              Strength block history
            </div>
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-4 text-sm text-white/65">
              Hyrox benchmark tracking
            </div>
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-4 text-sm text-white/65">
              Weight & notes log
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}