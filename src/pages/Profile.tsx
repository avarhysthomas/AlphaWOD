// src/pages/Profile.tsx
import React, { useEffect, useMemo, useState } from "react";
import { getAuth, updateEmail, updateProfile } from "firebase/auth";
import {useNavigate} from "react-router-dom";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import {
  getDownloadURL,
  getStorage,
  ref,
  uploadBytes,
} from "firebase/storage";
import { db } from "../firebase";
import { Camera, Save, AlertTriangle, Calendar } from "lucide-react";

type UserDoc = {
  name?: string;
  email?: string;
  role?: string;
  photoURL?: string;
};

export default function Profile() {
  const auth = useMemo(() => getAuth(), []);
  const storage = useMemo(() => getStorage(), []);
  const user = auth.currentUser;
const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Keep the state name as displayName for UI, but map it to Firestore field `name`
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [photoURL, setPhotoURL] = useState<string | undefined>(undefined);

  const [file, setFile] = useState<File | null>(null);
  const [previewURL, setPreviewURL] = useState<string | null>(null);

  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function onPickFile(f: File | null) {
    setErr(null);
    setMsg(null);
    setFile(f);

    // preview locally so you see it in the circle immediately
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

        // Your DB uses `name`, not `displayName`
        const nameFromDoc = data.name ?? "";
        const emailFromDoc = data.email ?? "";
        const picFromDoc = data.photoURL ?? "";

        const resolvedName = nameFromDoc || user.displayName || "";
        const resolvedEmail = emailFromDoc || user.email || "";
        const resolvedPhoto = picFromDoc || user.photoURL || undefined;

        setDisplayName(resolvedName);
        setEmail(resolvedEmail);
        setPhotoURL(resolvedPhoto);

        // Ensure doc exists (merge so we don’t clobber anything)
        if (!snap.exists()) {
          await setDoc(
            userRef,
            {
              name: resolvedName || null,
              email: resolvedEmail || null,
              role: "user", // optional default (remove if you don’t want)
              photoURL: resolvedPhoto ?? null,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        }
      } catch (e: any) {
        setErr(e?.message ?? "Failed to load profile.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

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
      // 1) upload image (if chosen)
      const newPhotoURL = await uploadProfilePicIfNeeded();

      // 2) update Auth profile (optional but nice)
      const authUpdates: { displayName?: string; photoURL?: string } = {};
      const trimmedName = displayName.trim();
      if (trimmedName && trimmedName !== (user.displayName ?? "")) {
        authUpdates.displayName = trimmedName;
      }
      if (newPhotoURL) authUpdates.photoURL = newPhotoURL;

      if (Object.keys(authUpdates).length) {
        await updateProfile(user, authUpdates);
      }

      // 3) update email in Auth if changed
      const nextEmail = email.trim();
      const currentEmail = user.email ?? "";
      if (nextEmail && nextEmail !== currentEmail) {
        await updateEmail(user, nextEmail);
      }

      // 4) write to Firestore user doc using your schema (name/email/role/photoURL)
      await setDoc(
        doc(db, "users", user.uid),
        {
          name: trimmedName || null, // <-- your DB field
          email: (user.email ?? nextEmail) || null,
          photoURL: (newPhotoURL ?? user.photoURL) || null,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      // 5) update local UI
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

  return (
    <div className="min-h-[calc(100vh-64px)] bg-black text-white">
      <div className="mx-auto w-full max-w-3xl px-4 py-8">
        <div className="rounded-3xl border border-neutral-800 bg-neutral-950 p-6 sm:p-8">
          <div className="text-xs uppercase tracking-[0.35em] text-white/60 font-semibold">
            Profile
          </div>
          <div className="mt-2 text-4xl sm:text-5xl font-heading tracking-wide">
            Your account
          </div>

            <div className="mt-2 flex items-center gap-2">
            <button
                onClick={()=> navigate("/schedule")}
                className="inline-flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-neutral-900"
                title="Schedule"
            >
            <Calendar className="h-4 w-4" />
                Schedule
            </button>
          </div>
          <div className="mt-6 grid gap-6 sm:grid-cols-[160px_1fr]">
            {/* Avatar */}
            <div className="flex flex-col items-center sm:items-start gap-3">
              <div className="relative">
                <div className="h-36 w-36 rounded-full overflow-hidden border border-neutral-800 bg-neutral-900/40">
                  <img
                    src={
                      previewURL ||
                      photoURL ||
                      "https://dummyimage.com/256x256/111/fff&text=ZA"
                    }
                    alt="Profile"
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
                  Selected:{" "}
                  <span className="text-white/90 font-semibold">{file.name}</span>
                </div>
              )}
            </div>

            {/* Form */}
            <div className="space-y-4">
              <div>
                <label className="block text-xs uppercase tracking-widest text-white/60 font-semibold">
                  Display name
                </label>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                  className="mt-2 w-full rounded-2xl border border-neutral-800 bg-neutral-900/40 px-4 py-3 text-white outline-none focus:border-white/30"
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-widest text-white/60 font-semibold">
                  Email
                </label>
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
                    err
                      ? "border-red-900/60 bg-red-950/30 text-red-200"
                      : "border-emerald-900/60 bg-emerald-950/30 text-emerald-200",
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
          <div className="text-xs uppercase tracking-[0.35em] text-white/60 font-semibold">
            Coming next
          </div>
          <div className="mt-2 text-xl font-bold text-white/90">
            Lifts & PB's
          </div>
          <div className="mt-2 text-sm text-white/60">
            Tracking for strength blocks, hyrox, and weight.
          </div>
        </div>
      </div>
    </div>
  );
}