// src/pages/Profile.tsx
import React, { useEffect, useMemo, useState } from "react";
import { getAuth, signOut, updateEmail, updateProfile } from "firebase/auth";
import { Link, NavLink, useNavigate } from "react-router-dom";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";
import { db } from "../../../firebase";
import { AlertTriangle, Bell, Plus, Save } from "lucide-react";
import { getUserNavItems } from "../../../components/layout/UserTopNav";
import { useAuth } from "../../../context/AuthContext";


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

export default function Profile() {
  const auth = useMemo(() => getAuth(), []);
  const storage = useMemo(() => getStorage(), []);
  const navigate = useNavigate();
  const { appUser } = useAuth();
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
              approvalStatus: "approved",
              strengthBlock: "none",
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

  async function onSignOut() {
    await signOut(auth);
    navigate("/login");
  }

  if (loading) {
    return (
      <div className="carbon-fiber-bg min-h-screen p-6 text-white/80">
        Loading profile...
      </div>
    );
  }

  const mk = monthKeyLondon(new Date());
  const monthCount = stats?.monthCheckIns?.[mk] ?? 0;
  const totalCheckIns = stats?.totalCheckIns ?? 0;
  const navItems = getUserNavItems(appUser?.role);
  const firstName = displayName.split(" ")[0] || email.split("@")[0] || "A";
  const initials =
    displayName
      .split(" ")
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "ZA";
  const handle = email ? `@${email.split("@")[0]}` : "@member";

  return (
    <div className="carbon-fiber-bg min-h-screen overflow-x-hidden text-[#f4f0ea]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_right,rgba(120,95,70,0.16),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.025),transparent_22%)]" />
      <main className="relative mx-auto min-h-screen max-w-xl px-5 pb-36 pt-7 sm:max-w-3xl sm:px-8">
        <header className="flex items-center justify-between" style={{ paddingTop: "env(safe-area-inset-top)" }}>
          <Link to="/dashboard" aria-label="Zero Alpha home" className="block">
            <img src="/ZERO-ALPHA.png" alt="ZERO-ALPHA" className="h-20 w-auto object-contain" />
          </Link>
          <div className="flex items-center gap-3">
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
              {photoURL || previewURL ? (
                <img
                  src={previewURL || photoURL}
                  alt={displayName ? `${displayName}'s profile` : "Profile"}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="grid h-full w-full place-items-center">{firstName.slice(0, 1)}</span>
              )}
            </Link>
          </div>
        </header>

        <section className="mt-12">
          <p className="text-[12px] font-bold uppercase tracking-[0.3em] text-white/34">
            Account
          </p>
          <h1 className="mt-4 text-5xl font-bold leading-none tracking-[-0.06em] text-white sm:text-6xl">
            Profile
          </h1>
        </section>

        <section className="mt-8 overflow-hidden rounded-[28px] border border-white/10 bg-[#151311] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
          <div className="grid grid-cols-[128px_1fr] items-center gap-5">
            <div className="relative">
              <div className="h-28 w-28 overflow-hidden rounded-full border-2 border-[#8b725b]/80 bg-[#765f4b] shadow-[0_14px_45px_rgba(0,0,0,0.36)]">
                {previewURL || photoURL ? (
                  <img
                    src={previewURL || photoURL}
                    alt={displayName ? `${displayName}'s profile picture` : "Profile"}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="grid h-full w-full place-items-center text-4xl font-black text-white">
                    {initials}
                  </div>
                )}
              </div>
              <label className="absolute bottom-0 right-4 grid h-10 w-10 cursor-pointer place-items-center rounded-full bg-[#f6dd62] text-black shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
                <Plus className="h-5 w-5" />
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>

            <div className="min-w-0">
              <h2 className="text-3xl font-bold leading-none tracking-[-0.05em] text-white">
                {displayName || "Member"}
              </h2>
              <p className="mt-2 truncate font-mono text-sm text-white/36">
                {handle}
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <TierChip count={monthCount} />
                <span className="font-mono text-sm text-white/38">{totalCheckIns} lifetime</span>
              </div>
            </div>
          </div>
          {file ? (
            <div className="mt-4 rounded-[16px] border border-white/10 bg-white/[0.04] px-4 py-3 text-xs font-medium text-white/56">
              Selected: <span className="font-bold text-white/78">{file.name}</span>
            </div>
          ) : null}
        </section>

        <section className="mt-10">
          <h2 className="mb-4 text-[12px] font-bold uppercase tracking-[0.32em] text-white/54">
            Sign-in
          </h2>
          <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#151311]">
            <label className="block border-b border-white/10 px-5 py-4">
              <span className="block text-[11px] font-black uppercase tracking-[0.22em] text-white/34">
                Display name
              </span>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                className="mt-2 w-full bg-transparent text-xl font-bold text-white outline-none placeholder:text-white/20"
              />
            </label>
            <label className="block px-5 py-4">
              <span className="block text-[11px] font-black uppercase tracking-[0.22em] text-white/34">
                Email
              </span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                className="mt-2 w-full bg-transparent text-xl font-bold text-white outline-none placeholder:text-white/20"
              />
            </label>
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs font-medium text-white/38">
            <AlertTriangle className="h-4 w-4" />
            Changing email may require a fresh sign-in.
          </div>

          {(err || msg) && (
            <div
              className={[
                "mt-4 rounded-[18px] border px-4 py-3 text-sm",
                err
                  ? "border-red-500/20 bg-red-500/10 text-red-200"
                  : "border-emerald-400/20 bg-emerald-400/10 text-emerald-100",
              ].join(" ")}
            >
              {err ?? msg}
            </div>
          )}

          <div className="mt-6 grid gap-3">
            <button
              onClick={onSave}
              disabled={saving}
              className="inline-flex w-full items-center justify-center gap-3 rounded-full bg-[#f2eee8] px-6 py-4 text-base font-extrabold text-black transition hover:bg-white disabled:opacity-60"
            >
              <Save className="h-4 w-4" />
              {saving ? "Saving..." : "Save changes"}
            </button>
            <button
              onClick={onSignOut}
              className="w-full rounded-full border border-white/12 px-6 py-4 text-base font-bold text-white transition hover:bg-white/[0.05]"
            >
              Sign out
            </button>
          </div>
        </section>

      </main>

      <nav
        className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-[27rem] rounded-[22px] border border-white/40 bg-white/90 px-2 py-2 shadow-[0_12px_34px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:max-w-xl"
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
        aria-label="Primary"
      >
        <div className="flex gap-1 overflow-x-auto px-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {navItems.map(({ to, label, icon: NavIcon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                [
                  "flex min-w-[56px] shrink-0 flex-col items-center gap-1 rounded-[15px] px-1.5 py-1.5 text-[10px] font-extrabold leading-tight transition",
                  isActive ? "bg-black/12 text-black" : "text-black hover:bg-black/6",
                ].join(" ")
              }
            >
              <NavIcon className="h-[18px] w-[18px] text-black" />
              <span className="max-w-[56px] truncate leading-tight text-black">{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
