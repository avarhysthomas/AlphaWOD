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

type Movement = {
  id: string;
  name: string;
  target?: string;
  notes?: string;
};

type Station = {
  id: string;
  title: string;
  movements: Movement[];
};

function makeId() {
  // crypto.randomUUID is supported in modern browsers; fallback keeps it safe
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? (crypto as any).randomUUID()
    : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

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
  // kept for legacy fields in old docs
  if (!Array.isArray(raw)) return [];
  return raw
    .map((m) => {
      if (typeof m === "string") return m;
      if (m && typeof m === "object") {
        const v = m.partner1 ?? m.movement ?? "";
        return String(v);
      }
      return String(m ?? "");
    })
    .map((s) => s.trim())
    .filter(Boolean);
}

function normaliseStations(rawStations: any, rawMovements: any): Station[] {
  // Preferred: stations[] exists
  if (Array.isArray(rawStations) && rawStations.length) {
    const stations: Station[] = rawStations.map((s: any, i: number) => {
      const title = String(s?.title ?? `Station ${i + 1}`).trim();
      const rawMs = Array.isArray(s?.movements) ? s.movements : [];
      const movements: Movement[] = rawMs
        .map((m: any) => ({
          id: String(m?.id ?? makeId()),
          name: String(m?.name ?? "").trim(),
          target: String(m?.target ?? "").trim() || undefined,
          notes: String(m?.notes ?? "").trim() || undefined,
        }))
        .filter((m: Movement) => m.name.length > 0 || m.target || m.notes);

      return {
        id: String(s?.id ?? makeId()),
        title,
        movements: movements.length ? movements : [{ id: makeId(), name: "" }],
      };
    });

    return stations.length
      ? stations
      : [{ id: makeId(), title: "Station 1", movements: [{ id: makeId(), name: "" }] }];
  }

  // Legacy fallback: movements: string[]
  const legacy = normaliseMovements(rawMovements);
  if (legacy.length) {
    return [
      {
        id: makeId(),
        title: "Station 1",
        movements: legacy.map((name) => ({ id: makeId(), name })),
      },
    ];
  }

  // Default
  return [{ id: makeId(), title: "Station 1", movements: [{ id: makeId(), name: "" }] }];
}

function flattenStationMovements(stations: Station[]): string[] {
  return (stations || [])
    .flatMap((s) => (s.movements || []).map((m) => String(m.name ?? "").trim()))
    .filter((n) => n.length > 0);
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

    // Stations -> Movements
    stations: [
      { id: makeId(), title: "Station 1", movements: [{ id: makeId(), name: "" }] },
    ] as Station[],

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

  const cleanedStations = useMemo(() => {
    const stations = (formData.stations || []).map((s) => ({
      ...s,
      title: String(s.title ?? "").trim(),
      movements: (s.movements || []).map((m) => ({
        ...m,
        name: String(m.name ?? "").trim(),
        target: String((m as any).target ?? "").trim(), // "" if empty
        notes: String((m as any).notes ?? "").trim(),   // "" if empty
      })),
    }));

    // keep at least one station + one movement input
    if (!stations.length) {
      return [{ id: makeId(), title: "Station 1", movements: [{ id: makeId(), name: "" }] }];
    }

    return stations.map((s, idx) => ({
      ...s,
      title: s.title || `Station ${idx + 1}`,
      movements: s.movements.length ? s.movements : [{ id: makeId(), name: "" }],
    }));
  }, [formData.stations]);

  const flattenedMovements = useMemo(() => flattenStationMovements(cleanedStations), [cleanedStations]);

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
          stations: normaliseStations(existing.stations, existing.movements),

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

        // ✅ save stations (new) + movements (legacy flat list)
        stations: cleanedStations,
        movements: flattenedMovements,
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
    <form
      onSubmit={handleSubmit}
      onKeyDown={(e) => {
        // stop Enter from submitting the whole form (we use Enter to add movements)
        if (e.key === "Enter") {
          const el = e.target as HTMLElement;
          const tag = el.tagName.toLowerCase();
          const isTextArea = tag === "textarea";
          if (!isTextArea) e.preventDefault();
        }
      }}
      className="max-w-xl mx-auto bg-neutral-900 p-6 pb-24 rounded-lg space-y-6 text-white"
    >
      <h1 className="text-3xl font-heading font-bold text-center uppercase tracking-widest">
        AlphaFIT Editor
      </h1>

      <LogoutButton />

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
          <option value="PM">PM</option>
          <option value="930AM">9:30AM</option>
        </select>
      </div>

      {/* Session type */}
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
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4 space-y-3">
            <div className="text-sm font-semibold text-white/80">HYROX Settings</div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <div className="text-xs tracking-wider text-white/50 mb-1">WOD TYPE</div>
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
                <div className="text-xs tracking-wider text-white/50 mb-1">GROUP SIZE</div>
                <input
                  type="number"
                  name="groupSize"
                  value={formData.groupSize}
                  onChange={handleChange}
                  className="w-full p-2 rounded bg-neutral-800 border border-neutral-700 text-white"
                />
              </div>

              <div>
                <div className="text-xs tracking-wider text-white/50 mb-1">TIMER MODE</div>
                <select
                  name="timerMode"
                  value={formData.timerMode}
                  onChange={handleChange}
                  className="w-full p-2 rounded bg-neutral-800 border border-neutral-700 text-white"
                >
                  <option value="timed">Timed (Rounds)</option>
                  <option value="stationControlled">Station Controlled</option>
                </select>
              </div>
            </div>

            {/* Timed settings */}
            {formData.timerMode === "timed" && (
              <div className="space-y-3 pt-2">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <div className="text-xs tracking-wider text-white/50 mb-1">MINUTES</div>
                    <input
                      type="number"
                      name="roundMinutes"
                      value={formData.roundMinutes}
                      onChange={handleChange}
                      className="w-full p-2 rounded bg-neutral-800 border border-neutral-700 text-white"
                    />
                  </div>

                  <div>
                    <div className="text-xs tracking-wider text-white/50 mb-1">SECONDS</div>
                    <input
                      type="number"
                      name="roundSeconds"
                      value={formData.roundSeconds}
                      onChange={handleChange}
                      className="w-full p-2 rounded bg-neutral-800 border border-neutral-700 text-white"
                    />
                  </div>

                  <div>
                    <div className="text-xs tracking-wider text-white/50 mb-1">ROUNDS</div>
                    <input
                      type="number"
                      name="rounds"
                      value={formData.rounds}
                      onChange={handleChange}
                      className="w-full p-2 rounded bg-neutral-800 border border-neutral-700 text-white"
                    />
                  </div>
                </div>

                <div>
                  <div className="text-xs tracking-wider text-white/50 mb-1">REST BETWEEN ROUNDS (SEC)</div>
                  <input
                    type="number"
                    name="restBetweenRoundsSeconds"
                    value={formData.restBetweenRoundsSeconds}
                    onChange={handleChange}
                    className="w-full p-2 rounded bg-neutral-800 border border-neutral-700 text-white"
                  />
                </div>

                <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-4">
                  <div className="text-xs tracking-wider text-white/50">TOTAL SESSION TIME</div>
                  <div className="text-3xl font-bold mt-1">{formatSeconds(totalSessionSeconds)}</div>
                  <div className="text-sm text-white/60 mt-1">Work: {formatSeconds(totalWorkSeconds)}</div>
                </div>
              </div>
            )}

            {/* Station Controlled settings */}
            {formData.timerMode === "stationControlled" && (
              <div className="space-y-2 pt-2">
                <div className="text-xs tracking-wider text-white/50">CONTROLLED STATION</div>
                <select
                  name="controlStationIndex"
                  value={formData.controlStationIndex}
                  onChange={handleChange}
                  className="w-full p-2 rounded bg-neutral-800 border border-neutral-700 text-white"
                >
                  {flattenedMovements.length === 0 ? (
                    <option value={0}>Add movements first</option>
                  ) : (
                    flattenedMovements.map((m, i) => (
                      <option key={i} value={i}>
                        {i + 1}. {m}
                      </option>
                    ))
                  )}
                </select>
              </div>
            )}
          </div>

          {/* Stations */}
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4 space-y-4">
            <div className="text-sm font-semibold text-white/80">Stations</div>

            {(formData.stations || []).map((station, sIdx) => (
              <div
                key={station.id}
                className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3 space-y-3"
              >
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={station.title}
                    onChange={(e) => {
                      const title = e.target.value;
                      setFormData((p: any) => ({
                        ...p,
                        stations: (p.stations || []).map((s: Station) =>
                          s.id === station.id ? { ...s, title } : s
                        ),
                      }));
                    }}
                    placeholder={`Station ${sIdx + 1} title`}
                    className="w-full p-2 rounded bg-neutral-800 border border-neutral-700 text-white"
                  />

                  <button
                    type="button"
                    className="text-xs text-white/70 underline shrink-0"
                    onClick={() => {
                      setFormData((p: any) => ({
                        ...p,
                        stations: (p.stations || []).filter((s: Station) => s.id !== station.id),
                      }));
                    }}
                    disabled={(formData.stations || []).length <= 1}
                    title={(formData.stations || []).length <= 1 ? "Keep at least one station" : "Remove station"}
                  >
                    Remove
                  </button>
                </div>

                <div className="space-y-2">
                  {(station.movements || []).map((mv, mIdx) => (
                    <div key={mv.id} className="grid grid-cols-1 md:grid-cols-12 gap-2">
                      <input
                        type="text"
                        value={mv.name}
                        onChange={(e) => {
                          const name = e.target.value;
                          setFormData((p: any) => ({
                            ...p,
                            stations: (p.stations || []).map((s: Station) =>
                              s.id === station.id
                                ? {
                                    ...s,
                                    movements: (s.movements || []).map((m: Movement) =>
                                      m.id === mv.id ? { ...m, name } : m
                                    ),
                                  }
                                : s
                            ),
                          }));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            setFormData((p: any) => ({
                              ...p,
                              stations: (p.stations || []).map((s: Station) =>
                                s.id === station.id
                                  ? { ...s, movements: [...(s.movements || []), { id: makeId(), name: "" }] }
                                  : s
                              ),
                            }));
                          }
                        }}
                        placeholder={`Movement ${mIdx + 1}`}
                        className="md:col-span-7 w-full p-2 rounded bg-neutral-800 border border-neutral-700 text-white"
                      />

                      <input
                        type="text"
                        value={(mv as any).target ?? ""}
                        onChange={(e) => {
                          const target = e.target.value;
                          setFormData((p: any) => ({
                            ...p,
                            stations: (p.stations || []).map((s: Station) =>
                              s.id === station.id
                                ? {
                                    ...s,
                                    movements: (s.movements || []).map((m: Movement) =>
                                      m.id === mv.id ? { ...(m as any), target } : m
                                    ),
                                  }
                                : s
                            ),
                          }));
                        }}
                        placeholder="Target (e.g. 12 cals / 10 reps)"
                        className="md:col-span-4 w-full p-2 rounded bg-neutral-800 border border-neutral-700 text-white"
                      />

                      <button
                        type="button"
                        className="md:col-span-1 text-xs text-white/70 underline"
                        onClick={() => {
                          setFormData((p: any) => ({
                            ...p,
                            stations: (p.stations || []).map((s: Station) =>
                              s.id === station.id
                                ? { ...s, movements: (s.movements || []).filter((m: Movement) => m.id !== mv.id) }
                                : s
                            ),
                          }));
                        }}
                        disabled={(station.movements || []).length <= 1}
                        title={(station.movements || []).length <= 1 ? "Keep at least one movement" : "Remove movement"}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  className="text-sm underline text-white/80"
                  onClick={() =>
                    setFormData((p: any) => ({
                      ...p,
                      stations: (p.stations || []).map((s: Station) =>
                        s.id === station.id
                          ? { ...s, movements: [...(s.movements || []), { id: makeId(), name: "" }] }
                          : s
                      ),
                    }))
                  }
                >
                  + Add Movement
                </button>
              </div>
            ))}

            <button
              type="button"
              className="text-sm underline text-white/80"
              onClick={() =>
                setFormData((p: any) => ({
                  ...p,
                  stations: [
                    ...(p.stations || []),
                    {
                      id: makeId(),
                      title: `Station ${(p.stations || []).length + 1}`,
                      movements: [{ id: makeId(), name: "" }],
                    },
                  ],
                }))
              }
            >
              + Add Station
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
                placeholder="%"
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
                placeholder="Rep range"
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
            + Add Strength Row
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
          rows={4}
          className="w-full p-2 rounded bg-neutral-800 border border-neutral-700 text-white"
          placeholder="Coaching notes / scaling / reminders..."
        />
      </div>

      <button
        type="submit"
        className="w-full py-3 rounded bg-white text-black font-semibold hover:bg-white/90"
      >
        Save Session
      </button>
    </form>
  );
};

export default WODEditor;