import React, { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  updateDoc,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import { db } from "../firebase";

type Template = {
  id: string;
  title: string;
  dayOfWeek: number; // 0=Sun..6=Sat
  startTime: string; // "06:00"
  durationMinutes: number;
  timezone: string; // "Europe/London"
  coachName: string;
  coachId: string;
  capacity: number;
  location: string;
  isActive: boolean;
};

const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function AdminTemplates() {
  const auth = getAuth();

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const [form, setForm] = useState({
    title: "HYROX",
    dayOfWeek: 2,
    startTime: "06:00",
    durationMinutes: 60,
    timezone: "Europe/London",
    coachName: "Coach",
    capacity: 18,
    location: "Main Floor",
    isActive: true,
  });

  // ✅ Callable functions MUST be called via httpsCallable (NOT fetch)
  const functions = useMemo(() => getFunctions(undefined, "europe-west1"), []);
  const generateClassOccurrences = useMemo(
    () => httpsCallable(functions, "generateClassOccurrences"),
    [functions]
  );

  const load = async () => {
    setLoading(true);
    try {
      const q = query(
        collection(db, "classTemplates"),
        orderBy("dayOfWeek"),
        orderBy("startTime")
      );
      const snap = await getDocs(q);
      const rows: Template[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      }));
      setTemplates(rows);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createTemplate = async () => {
    const user = auth.currentUser;
    if (!user) return alert("Log in first.");

    await addDoc(collection(db, "classTemplates"), {
      ...form,
      coachId: user.uid, // simplest: set creator as coach for now
      coachName: form.coachName,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await load();
  };

  const toggleActive = async (t: Template) => {
    await updateDoc(doc(db, "classTemplates", t.id), {
      isActive: !t.isActive,
      updatedAt: new Date(),
    });
    await load();
  };

  const remove = async (t: Template) => {
    if (!window.confirm(`Delete "${t.title}" on ${days[t.dayOfWeek]} ${t.startTime}?`)) return;
    await deleteDoc(doc(db, "classTemplates", t.id));
    await load();
  };

  const generateNow = async () => {
    const user = auth.currentUser;
    if (!user) return alert("Log in first.");

    setGenerating(true);
    try {
      const result = await generateClassOccurrences({ daysAhead: 28 });
      console.log("Generated:", result.data);
      alert("Generated next 28 days ✅");
    } catch (e: any) {
      console.error("Callable error:", e);
      alert(
        [
          `code: ${e?.code ?? "?"}`,
          `message: ${e?.message ?? "?"}`,
          `details: ${
            typeof e?.details === "string"
              ? e.details
              : JSON.stringify(e?.details ?? null, null, 2)
          }`,
        ].join("\n\n")
      );
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold uppercase tracking-widest">
          Class Templates
        </h1>

        <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5 space-y-4">
          <div className="grid md:grid-cols-2 gap-3">
            <input
              className="p-2 rounded bg-neutral-800 border border-neutral-700"
              value={form.title}
              onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
              placeholder="Title"
            />
            <input
              className="p-2 rounded bg-neutral-800 border border-neutral-700"
              value={form.coachName}
              onChange={(e) =>
                setForm((p) => ({ ...p, coachName: e.target.value }))
              }
              placeholder="Coach name"
            />

            <select
              className="p-2 rounded bg-neutral-800 border border-neutral-700"
              value={form.dayOfWeek}
              onChange={(e) =>
                setForm((p) => ({ ...p, dayOfWeek: Number(e.target.value) }))
              }
            >
              {days.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>

            <input
              type="time"
              className="p-2 rounded bg-neutral-800 border border-neutral-700"
              value={form.startTime}
              onChange={(e) =>
                setForm((p) => ({ ...p, startTime: e.target.value }))
              }
            />

            <input
              type="number"
              className="p-2 rounded bg-neutral-800 border border-neutral-700"
              value={form.durationMinutes}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  durationMinutes: Number(e.target.value),
                }))
              }
              placeholder="Duration"
              min={15}
              max={180}
            />

            <input
              type="number"
              className="p-2 rounded bg-neutral-800 border border-neutral-700"
              value={form.capacity}
              onChange={(e) =>
                setForm((p) => ({ ...p, capacity: Number(e.target.value) }))
              }
              placeholder="Capacity"
              min={1}
              max={60}
            />

            <input
              className="p-2 rounded bg-neutral-800 border border-neutral-700"
              value={form.location}
              onChange={(e) =>
                setForm((p) => ({ ...p, location: e.target.value }))
              }
              placeholder="Location"
            />

            <input
              className="p-2 rounded bg-neutral-800 border border-neutral-700"
              value={form.timezone}
              onChange={(e) =>
                setForm((p) => ({ ...p, timezone: e.target.value }))
              }
              placeholder="Timezone"
            />
          </div>

          <button
            type="button"
            onClick={createTemplate}
            className="w-full bg-white text-black font-bold rounded py-2"
          >
            Create Template
          </button>
        </div>

        <button
          onClick={generateNow}
          className="text-sm underline text-white/70"
          disabled={generating}
        >
          {generating ? "Generating..." : "Generate next 28 days"}
        </button>

        <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Existing</h2>
            <button onClick={load} className="text-sm underline text-white/70">
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>

          <div className="mt-4 grid gap-3">
            {templates.map((t) => (
              <div
                key={t.id}
                className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 flex items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <div className="font-semibold">
                    {t.title} • {days[t.dayOfWeek]} {t.startTime}
                  </div>
                  <div className="text-sm text-white/60">
                    Coach: {t.coachName} • {t.durationMinutes} min • Cap{" "}
                    {t.capacity} • {t.location} •{" "}
                    {t.isActive ? "Active" : "Paused"}
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => toggleActive(t)}
                    className={`px-3 py-1 rounded border ${
                      t.isActive
                        ? "border-yellow-400 text-yellow-200"
                        : "border-green-400 text-green-200"
                    }`}
                  >
                    {t.isActive ? "Pause" : "Activate"}
                  </button>
                  <button
                    onClick={() => remove(t)}
                    className="px-3 py-1 rounded border border-red-500 text-red-300"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
            {templates.length === 0 && (
              <div className="text-white/60">No templates yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}