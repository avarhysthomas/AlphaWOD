import React, { useEffect, useMemo, useState } from "react";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import LogoutButton from "./LogoutButton";

type SessionType = "HYROX" | "Strength";
type WodType = "AMRAP" | "For Time" | "EMOM" | "Chipper";
type TimeOfDay = "AM" | "PM" | "930AM";
type TimerMode = "timed" | "stationControlled";

type StrengthRow = {
  movement: string;
  percent: string; // keep as string so you can write "75-80" if you want
  repRange: string;
};

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function toInt(value: any, fallback: number) {
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function formatSeconds(total: number) {
  const s = Math.max(0, Math.floor(total));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function normaliseMovements(raw: any): string[] {
  if (!Array.isArray(raw)) return [""];
  const out = raw
    .map((m) => {
      if (typeof m === "string") return m;
      // legacy object format { partner1, partner2 } or { movement }
      if (m && typeof m === "object") {
        const v = m.partner1 ?? m.movement ?? "";
        return String(v);
      }
      return String(m ?? "");
    })
    .map((s) => s.trim())
    .filter(Boolean);

  return out.length ? out : [""];
}

function normaliseStrength(raw: any): StrengthRow[] {
  if (!Array.isArray(raw)) return [{ movement: "", percent: "", repRange: "" }];

  const out = raw
    .map((s) => ({
      movement: String(s?.movement ?? "").trim(),
      percent: String(s?.percent ?? "").trim(),
      repRange: String(s?.repRange ?? "").trim(),
    }))
    .filter((s) => s.movement.length > 0);

  return out.length ? out : [{ movement: "", percent: "", repRange: "" }];
}

const WODEditor = () => {
  const [formData, setFormData] = useState({
    wodName: "",
    date: "",
    timeOfDay: "AM" as TimeOfDay,

    sessionType: "HYROX" as SessionType,

    // HYROX
    wodType: "AMRAP" as WodType,
    groupSize: 4,

    timerMode: "timed" as TimerMode,

    // timed settings
    roundMinutes: 12,
    roundSeconds: 0,
    rounds: 1,
    restBetweenRoundsSeconds: 0,

    // station controlled
    controlStationIndex: 0,

    // movements as strings
    movements: [""] as string[],

    notes: "",

    // Strength
    strengthMovements: [{ movement: "", percent: "", repRange: "" }] as StrengthRow[],
  });

  // --- computed timing (Timed mode) ---
  const roundDurationSeconds = useMemo(() => {
    const m = clampInt(toInt(formData.roundMinutes, 0), 0, 180);
    const s = clampInt(toInt(formData.roundSeconds, 0), 0, 59);
    return m * 60 + s;
  }, [formData.roundMinutes, formData.roundSeconds]);

  const roundsNum = useMemo(() => clampInt(toInt(formData.rounds, 1), 1, 99), [formData.rounds]);

  const restSeconds = useMemo(
    () => clampInt(toInt(formData.restBetweenRoundsSeconds, 0), 0, 600),
    [formData.restBetweenRoundsSeconds]
  );

  const totalWorkSeconds = useMemo(() => roundDurationSeconds * roundsNum, [roundDurationSeconds, roundsNum]);

  const totalSessionSeconds = useMemo(
    () => totalWorkSeconds + restSeconds * Math.max(0, roundsNum - 1),
    [totalWorkSeconds, restSeconds, roundsNum]
  );

  const cleanedMovements = useMemo(() => {
    return (formData.movements || [])
      .map((m) => String(m ?? "").trim()) // ✅ safe
      .filter((m) => m.length > 0);
  }, [formData.movements]);

  // --- load existing session when date/time changes ---
  useEffect(() => {
    const loadExisting = async () => {
      if (!formData.date || !formData.timeOfDay) return;

      try {
        const docRef = doc(db, "wods", formData.date);
        const snap = await getDoc(docRef);
        if (!snap.exists()) return;

        const data = snap.data() as any;
        const existing = data?.[formData.timeOfDay];
        if (!existing) return;

        // derive mins/secs from stored roundDurationSeconds (if present)
        const storedRoundSeconds = toInt(existing.roundDurationSeconds, 0);
        const mins = storedRoundSeconds ? Math.floor(storedRoundSeconds / 60) : 0;
        const secs = storedRoundSeconds ? storedRoundSeconds % 60 : 0;

        setFormData((prev) => ({
          ...prev,

          // keep selected date + timeOfDay as-is
          wodName: String(existing.wodName ?? ""),
          sessionType: (existing.sessionType as SessionType) ?? "HYROX",
          notes: String(existing.notes ?? ""),

          // HYROX
          wodType: (existing.wodType as WodType) ?? "AMRAP",
          groupSize: toInt(existing.groupSize, 4),
          timerMode: (existing.timerMode as TimerMode) ?? "timed",
          roundMinutes: mins,
          roundSeconds: secs,
          rounds: toInt(existing.rounds, 1),
          restBetweenRoundsSeconds: toInt(existing.restBetweenRoundsSeconds, 0),
          controlStationIndex: clampInt(toInt(existing.controlStationIndex, 0), 0, 999),
          movements: normaliseMovements(existing.movements),

          // Strength
          strengthMovements: normaliseStrength(existing.strengthMovements),
        }));
      } catch (e) {
        console.error("Failed to load existing session", e);
      }
    };

    loadExisting();
  }, [formData.date, formData.timeOfDay]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev: any) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.date) {
      alert("Please choose a date.");
      return;
    }

    const sessionKey = formData.timeOfDay;
    const dateString = formData.date;
    const docRef = doc(db, "wods", dateString);

    const sessionPayload: any = {
      wodName: String(formData.wodName ?? ""),
      sessionType: formData.sessionType,
      notes: String(formData.notes ?? ""),
      createdAt: new Date(),
    };

    if (formData.sessionType === "HYROX") {
      const groupSize = clampInt(toInt(formData.groupSize, 4), 1, 50);

      Object.assign(sessionPayload, {
        wodType: formData.wodType,
        groupSize,
        timerMode: formData.timerMode,

        // timed settings stored regardless (harmless)
        roundDurationSeconds,
        rounds: roundsNum,
        restBetweenRoundsSeconds: restSeconds,
        totalWorkSeconds,
        totalSessionSeconds,

        // station controlled
        controlStationIndex: clampInt(toInt(formData.controlStationIndex, 0), 0, 999),

        // ✅ always save string[]
        movements: cleanedMovements,
      });
    } else {
      const cleanedStrength = (formData.strengthMovements || [])
        .map((s) => ({
          movement: String(s.movement ?? "").trim(),
          percent: String(s.percent ?? "").trim(),
          repRange: String(s.repRange ?? "").trim(),
        }))
        .filter((s) => s.movement.length > 0);

      Object.assign(sessionPayload, {
        strengthMovements: cleanedStrength,
      });
    }

    try {
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        await updateDoc(docRef, { [sessionKey]: sessionPayload });
      } else {
        await setDoc(docRef, { [sessionKey]: sessionPayload });
      }
      alert(`${sessionKey} session saved for ${dateString}`);
    } catch (err) {
      console.error("Error saving session:", err);
      alert("Failed to save session. Please try again.");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-xl mx-auto bg-neutral-900 p-6 pb-24 rounded-lg space-y-6 text-white">
      <h1 className="text-3xl font-heading font-bold text-center uppercase tracking-widest">
        AlphaFIT Editor
      </h1>

      {/* Workout name */}
      <div>
        <label className="block text-sm font-medium text-white/80 mb-1">Workout Name</label>
        <input
          type="text"
          name="wodName"
          value={formData.wodName}
          onChange={handleChange}
          className="w-full p-2 rounded bg-neutral-800 border border-neutral-700 text-white"
        />
      </div>

      {/* Date */}
      <div>
        <label className="block text-sm font-medium text-white/80 mb-1">Date</label>
        <input
          type="date"
          name="date"
          value={formData.date}
          onChange={handleChange}
          className="w-full p-2 rounded bg-neutral-800 border border-neutral-700 text-white"
        />
      </div>

      {/* Session key */}
      <div>
        <label className="block text-sm font-medium text-white/80 mb-1">Session</label>
        <select
          name="timeOfDay"
          value={formData.timeOfDay}
          onChange={handleChange}
          className="w-full p-2 rounded bg-neutral-800 border border-neutral-700 text-white"
        >
          <option value="AM">AM</option>
          <option value="930AM">9:30 AM</option>
          <option value="PM">PM</option>
        </select>
      </div>

      {/* Type */}
      <div>
        <label className="block text-sm font-medium text-white/80 mb-1">Session Type</label>
        <select
          name="sessionType"
          value={formData.sessionType}
          onChange={handleChange}
          className="w-full p-2 rounded bg-neutral-800 border border-neutral-700 text-white"
        >
          <option value="HYROX">HYROX</option>
          <option value="Strength">Strength</option>
        </select>
      </div>

      {/* HYROX */}
      {formData.sessionType === "HYROX" && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-white/80 mb-1">Style</label>
            <select
              name="wodType"
              value={formData.wodType}
              onChange={handleChange}
              className="w-full p-2 rounded bg-neutral-800 border border-neutral-700 text-white"
            >
              <option value="AMRAP">AMRAP</option>
              <option value="For Time">For Time</option>
              <option value="EMOM">EMOM</option>
              <option value="Chipper">Chipper</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-white/80 mb-1">People per group</label>
            <input
              type="number"
              name="groupSize"
              value={formData.groupSize}
              onChange={handleChange}
              className="w-full p-2 rounded bg-neutral-800 border border-neutral-700 text-white"
              min={1}
              max={50}
            />
          </div>

          {/* Timer mode toggle */}
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
            <div className="text-sm font-semibold text-white/80 mb-3">Timer Mode</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setFormData((p) => ({ ...p, timerMode: "timed" }))}
                className={`p-2 rounded border ${
                  formData.timerMode === "timed"
                    ? "bg-white text-black border-white"
                    : "bg-neutral-800 text-white border-neutral-700"
                }`}
              >
                Timed (Rounds)
              </button>
              <button
                type="button"
                onClick={() => setFormData((p) => ({ ...p, timerMode: "stationControlled" }))}
                className={`p-2 rounded border ${
                  formData.timerMode === "stationControlled"
                    ? "bg-white text-black border-white"
                    : "bg-neutral-800 text-white border-neutral-700"
                }`}
              >
                Station Controlled
              </button>
            </div>

            {/* Timed settings */}
            {formData.timerMode === "timed" && (
              <div className="mt-4 space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs uppercase tracking-widest text-white/50 mb-1">
                      Minutes
                    </label>
                    <input
                      type="number"
                      name="roundMinutes"
                      value={formData.roundMinutes}
                      onChange={handleChange}
                      className="w-full p-2 rounded bg-neutral-800 border border-neutral-700 text-white"
                      min={0}
                      max={180}
                    />
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-widest text-white/50 mb-1">
                      Seconds
                    </label>
                    <input
                      type="number"
                      name="roundSeconds"
                      value={formData.roundSeconds}
                      onChange={handleChange}
                      className="w-full p-2 rounded bg-neutral-800 border border-neutral-700 text-white"
                      min={0}
                      max={59}
                    />
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-widest text-white/50 mb-1">
                      Rounds
                    </label>
                    <input
                      type="number"
                      name="rounds"
                      value={formData.rounds}
                      onChange={handleChange}
                      className="w-full p-2 rounded bg-neutral-800 border border-neutral-700 text-white"
                      min={1}
                      max={99}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-widest text-white/50 mb-1">
                    Rest between rounds (sec)
                  </label>
                  <input
                    type="number"
                    name="restBetweenRoundsSeconds"
                    value={formData.restBetweenRoundsSeconds}
                    onChange={handleChange}
                    className="w-full p-2 rounded bg-neutral-800 border border-neutral-700 text-white"
                    min={0}
                    max={600}
                  />
                </div>

                <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
                  <div className="text-xs uppercase tracking-widest text-white/50">
                    Total session time
                  </div>
                  <div className="mt-1 text-2xl font-bold text-white">
                    {formatSeconds(totalSessionSeconds)}
                  </div>
                  <div className="mt-1 text-sm text-white/60">
                    Work: {formatSeconds(totalWorkSeconds)}
                    {restSeconds > 0 ? ` • Rest: ${formatSeconds(restSeconds * Math.max(0, roundsNum - 1))}` : ""}
                  </div>
                </div>
              </div>
            )}

            {/* Station controlled settings */}
            {formData.timerMode === "stationControlled" && (
              <div className="mt-4">
                <label className="block text-xs uppercase tracking-widest text-white/50 mb-1">
                  Control station
                </label>
                <select
                  name="controlStationIndex"
                  value={formData.controlStationIndex}
                  onChange={handleChange}
                  className="w-full p-2 rounded bg-neutral-800 border border-neutral-700 text-white"
                >
                  {cleanedMovements.length === 0 ? (
                    <option value={0}>Add movements first</option>
                  ) : (
                    cleanedMovements.map((m, i) => (
                      <option key={i} value={i}>
                        {i + 1}. {m}
                      </option>
                    ))
                  )}
                </select>
              </div>
            )}
          </div>

          {/* Movements */}
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4 space-y-3">
            <div className="text-sm font-semibold text-white/80">Movements</div>

            {formData.movements.map((m, idx) => (
              <input
                key={idx}
                type="text"
                value={m}
                onChange={(e) => {
                  const updated = [...formData.movements];
                  updated[idx] = e.target.value;
                  setFormData((p) => ({ ...p, movements: updated }));
                }}
                placeholder={`Movement ${idx + 1}`}
                className="w-full p-2 rounded bg-neutral-800 border border-neutral-700 text-white"
              />
            ))}

            <button
              type="button"
              className="text-sm underline text-white/80"
              onClick={() =>
                setFormData((p) => ({ ...p, movements: [...p.movements, ""] }))
              }
            >
              + Add Movement
            </button>
          </div>
        </div>
      )}

      {/* Strength */}
      {formData.sessionType === "Strength" && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4 space-y-3">
          <div className="text-sm font-semibold text-white/80">Strength Stations</div>

          {formData.strengthMovements.map((row, idx) => (
            <div key={idx} className="grid grid-cols-1 gap-2">
              <input
                type="text"
                value={row.movement}
                placeholder="Movement"
                onChange={(e) => {
                  const updated = [...formData.strengthMovements];
                  updated[idx] = { ...updated[idx], movement: e.target.value };
                  setFormData((p) => ({ ...p, strengthMovements: updated }));
                }}
                className="w-full p-2 rounded bg-neutral-800 border border-neutral-700 text-white"
              />
              <input
                type="text"
                value={row.percent}
                placeholder="% of 1RM (e.g. 75 or 75-80)"
                onChange={(e) => {
                  const updated = [...formData.strengthMovements];
                  updated[idx] = { ...updated[idx], percent: e.target.value };
                  setFormData((p) => ({ ...p, strengthMovements: updated }));
                }}
                className="w-full p-2 rounded bg-neutral-800 border border-neutral-700 text-white"
              />
              <input
                type="text"
                value={row.repRange}
                placeholder="Rep Range (e.g. 6-8)"
                onChange={(e) => {
                  const updated = [...formData.strengthMovements];
                  updated[idx] = { ...updated[idx], repRange: e.target.value };
                  setFormData((p) => ({ ...p, strengthMovements: updated }));
                }}
                className="w-full p-2 rounded bg-neutral-800 border border-neutral-700 text-white"
              />
            </div>
          ))}

          <button
            type="button"
            className="text-sm underline text-white/80"
            onClick={() =>
              setFormData((p) => ({
                ...p,
                strengthMovements: [...p.strengthMovements, { movement: "", percent: "", repRange: "" }],
              }))
            }
          >
            + Add Station
          </button>
        </div>
      )}

      {/* Notes */}
      <div>
        <label className="block text-sm font-medium text-white/80 mb-1">Notes</label>
        <textarea
          name="notes"
          value={formData.notes}
          onChange={handleChange}
          placeholder="Coaching notes / scaling / reminders..."
          className="w-full p-2 rounded bg-neutral-800 border border-neutral-700 text-white min-h-[90px]"
        />
      </div>

      <button type="submit" className="bg-white text-black px-4 py-2 rounded w-full font-bold">
        Save Session
      </button>

      <LogoutButton />
    </form>
  );
};

export default WODEditor;