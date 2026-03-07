// src/pages/Profile.tsx
import React, { useEffect, useMemo, useState } from "react";
import { getAuth, updateEmail, updateProfile } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";
import { db } from "../firebase";
import { Camera, Save, AlertTriangle, Flame, Trophy, CheckCircle2 } from "lucide-react";
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
    <div className="min-h-[calc(100vh-64px)] bg-black text-white">
      <UserTopNav />
      <div className="mx-auto w-full max-w-3xl px-4 py-8">
        <div className="rounded-3xl border border-neutral-800 bg-neutral-950 p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.35em] text-white/60 font-semibold">Profile</div>
              <div className="mt-2 text-4xl sm:text-5xl font-heading tracking-wide">Your account</div>
            </div>
          </div>

          {/* Stats */}
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
                label="Months Classes"
                value={monthCount}
                icon={<CheckCircle2 className="h-4 w-4 text-blue-400" />}
            />

            <StatPill
                label="Total Classes"
                value={totalCheckIns}
                icon={<CheckCircle2 className="h-4 w-4 text-emerald-400" />}
            />
            </div>
          <div className="mt-6 grid gap-6 sm:grid-cols-[160px_1fr]">
            {/* Avatar */}
            <div className="flex flex-col items-center sm:items-start gap-3">
              <div className="relative">
                <div className="h-36 w-36 rounded-full overflow-hidden border border-neutral-800 bg-neutral-900/40">
                  <img
                    src={previewURL || photoURL || "https://dummyimage.com/256x256/111/fff&text=ZA"}
                    alt={displayName ? `${displayName}'s profile picture` : "Profile"}
                    className="h-full w-full object-cover"
                  />
                </div>

                <label className="absolute -bottom-3 left-1/2 -translate-x-1/2 cursor-pointer rounded-2xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-semibold text-white/90 hover:bg-neutral-800 inline-flex items-center gap-2">
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
                <div className="text-xs text-white/70">
                  Selected: <span className="text-white/90 font-semibold">{file.name}</span>
                </div>
              )}
            </div>

            {/* Form */}
            <div className="space-y-4">
              <div>
                <label className="block text-xs uppercase tracking-widest text-white/60 font-semibold">Display name</label>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                  className="mt-2 w-full rounded-2xl border border-neutral-800 bg-neutral-900/40 px-4 py-3 text-white outline-none focus:border-white/30"
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-widest text-white/60 font-semibold">Email</label>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@email.com"
                  className="mt-2 w-full rounded-2xl border border-neutral-800 bg-neutral-900/40 px-4 py-3 text-white outline-none focus:border-white/30"
                />
                <div className="mt-2 text-xs text-white/50 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Changing email may require you to log out and back in.
                </div>
              </div>

              {(err || msg) && (
                <div
                  className={[
                    "rounded-2xl border px-4 py-3 text-sm",
                    err ? "border-red-900/60 bg-red-950/30 text-red-200" : "border-emerald-900/60 bg-emerald-950/30 text-emerald-200",
                  ].join(" ")}
                >
                  {err ?? msg}
                </div>
              )}

              <button
                onClick={onSave}
                disabled={saving}
                className="mt-2 inline-flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-extrabold uppercase tracking-widest text-black hover:bg-white/90 disabled:opacity-60"
              >
                <Save className="h-4 w-4" />
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>

        {/* Future section */}
        <div className="mt-6 rounded-3xl border border-neutral-800 bg-neutral-950 p-6">
          <div className="text-xs uppercase tracking-[0.35em] text-white/60 font-semibold">Coming next</div>
          <div className="mt-2 text-xl font-bold text-white/90">Lifts & PB&apos;s</div>
          <div className="mt-2 text-sm text-white/60">Tracking for strength blocks, hyrox, and weight.</div>
        </div>
      </div>
    </div>
  );
}