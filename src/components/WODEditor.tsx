import React, { useEffect, useMemo, useState } from "react";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import LogoutButton from "./LogoutButton";
import UserTopNav from "./UserTopNav";
import {
  CalendarDays,
  Dumbbell,
  Flame,
  Save,
  Plus,
  Layers3,
} from "lucide-react";

type SessionType = "HYROX" | "Strength";
type WodType = "AMRAP" | "For Time" | "EMOM" | "Chipper";
type TimeOfDay = "AM" | "PM" | "930AM";
type TimerMode = "timed" | "stationControlled";

type StrengthRow = {
  movement: string;
  percent: string;
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

const inputClass =
  "w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-white outline-none transition placeholder:text-white/25 focus:border-white/20 focus:bg-black";
const labelClass =
  "mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-white/44";
const cardClass =
  "relative overflow-hidden rounded-[30px] border border-white/10 bg-neutral-950 shadow-[0_24px_60px_rgba(0,0,0,0.35)]";

const WODEditor = () => {
  const [formData, setFormData] = useState({
    wodName: "",
    date: "",
    timeOfDay: "AM" as TimeOfDay,
    sessionType: "HYROX" as SessionType,

    wodType: "AMRAP" as WodType,
    groupSize: 4,
    timerMode: "timed" as TimerMode,

    roundMinutes: 12,
    roundSeconds: 0,
    rounds: 1,
    restBetweenRoundsSeconds: 0,
    controlStationIndex: 0,

    stations: [{ id: makeId(), title: "Station 1", movements: [{ id: makeId(), name: "" }] }] as Station[],

    notes: "",

    strengthMovements: [{ movement: "", percent: "", repRange: "" }] as StrengthRow[],

    strengthGoal: "Quality reps",
    strengthLoad: "% of 1RM",
    strengthRange: "Hit target reps",
    strengthCue: "Clean reps with full ROM. Quality over Quantity.",
  });

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
        target: String((m as any).target ?? "").trim(),
        notes: String((m as any).notes ?? "").trim(),
      })),
    }));

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

        const storedRoundSeconds = toInt(existing.roundDurationSeconds, 0);
        const mins = storedRoundSeconds ? Math.floor(storedRoundSeconds / 60) : 0;
        const secs = storedRoundSeconds ? storedRoundSeconds % 60 : 0;

        setFormData((prev) => ({
          ...prev,
          wodName: String(existing.wodName ?? ""),
          sessionType: (existing.sessionType as SessionType) ?? "HYROX",
          notes: String(existing.notes ?? ""),

          wodType: (existing.wodType as WodType) ?? "AMRAP",
          groupSize: toInt(existing.groupSize, 4),
          timerMode: (existing.timerMode as TimerMode) ?? "timed",
          roundMinutes: mins,
          roundSeconds: secs,
          rounds: toInt(existing.rounds, 1),
          restBetweenRoundsSeconds: toInt(existing.restBetweenRoundsSeconds, 0),
          controlStationIndex: clampInt(toInt(existing.controlStationIndex, 0), 0, 999),
          stations: normaliseStations(existing.stations, existing.movements),

          strengthMovements: normaliseStrength(existing.strengthMovements),
          strengthGoal: String(existing.strengthGoal ?? "Quality reps"),
          strengthLoad: String(existing.strengthLoad ?? "% of 1RM"),
          strengthRange: String(existing.strengthRange ?? "Hit target reps"),
          strengthCue: String(existing.strengthCue ?? ""),
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
        roundDurationSeconds,
        rounds: roundsNum,
        restBetweenRoundsSeconds: restSeconds,
        totalWorkSeconds,
        totalSessionSeconds,
        controlStationIndex: clampInt(toInt(formData.controlStationIndex, 0), 0, 999),
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
        strengthGoal: String(formData.strengthGoal ?? "").trim(),
        strengthLoad: String(formData.strengthLoad ?? "").trim(),
        strengthRange: String(formData.strengthRange ?? "").trim(),
        strengthCue: String(formData.strengthCue ?? "").trim(),
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
    <div className="min-h-screen bg-black text-white">
      <UserTopNav />

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="relative overflow-hidden rounded-[32px] border border-white/10 bg-neutral-950 shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(59,130,246,0.12),transparent_28%),radial-gradient(circle_at_85%_0%,rgba(249,115,22,0.12),transparent_28%),linear-gradient(135deg,rgba(255,255,255,0.03),transparent_55%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:32px_32px] opacity-[0.06]" />
          <div className="absolute -right-8 bottom-[-30px] select-none text-[100px] font-black uppercase tracking-[0.18em] text-white/[0.04] sm:text-[140px] lg:text-[180px]">
            EDIT
          </div>

          <div className="relative flex flex-col gap-8 p-6 sm:p-8 lg:flex-row lg:items-end lg:justify-between lg:p-10">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-white/72">
                <Layers3 className="h-3.5 w-3.5" />
                Admin Editor
              </div>

              <h1 className="mt-6 text-4xl font-heading uppercase tracking-[-0.04em] sm:text-5xl lg:text-6xl">
                AlphaFIT Editor
              </h1>

              <p className="mt-4 max-w-2xl text-sm leading-7 text-white/68 sm:text-base">
                Build HYROX and Strength sessions, control timing modes, define
                station flow, and publish polished programming into the AlphaFIT system.
              </p>

              <div className="mt-6 flex flex-wrap gap-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/45">
                <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">
                  Session builder
                </span>
                <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">
                  HYROX + Strength
                </span>
                <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">
                  Zero Alpha control
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <LogoutButton />
            </div>
          </div>
        </section>

        <form
          onSubmit={handleSubmit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const el = e.target as HTMLElement;
              const tag = el.tagName.toLowerCase();
              const isTextArea = tag === "textarea";
              if (!isTextArea) e.preventDefault();
            }
          }}
          className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]"
        >
          <section className={`${cardClass} p-5 sm:p-6`}>
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.05),transparent_30%)]" />
            <div className="relative space-y-5">
              <div>
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/42">
                  <CalendarDays className="h-3.5 w-3.5" />
                  Session Setup
                </div>
                <h2 className="text-2xl font-semibold tracking-[-0.03em]">Programming Details</h2>
                <p className="mt-2 text-sm leading-7 text-white/62">
                  Set the core identity, date, and structure of the session.
                </p>
              </div>

              <div>
                <label className={labelClass}>Workout Name</label>
                <input
                  type="text"
                  name="wodName"
                  value={formData.wodName}
                  onChange={handleChange}
                  className={inputClass}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Date</label>
                  <input
                    type="date"
                    name="date"
                    value={formData.date}
                    onChange={handleChange}
                    className={`${inputClass} [color-scheme:dark]`}
                  />
                </div>

                <div>
                  <label className={labelClass}>Session</label>
                  <select
                    name="timeOfDay"
                    value={formData.timeOfDay}
                    onChange={handleChange}
                    className={inputClass}
                  >
                    <option value="AM">AM</option>
                    <option value="PM">PM</option>
                    <option value="930AM">9:30AM</option>
                  </select>
                </div>
              </div>

              <div>
                <label className={labelClass}>Session Type</label>
                <select
                  name="sessionType"
                  value={formData.sessionType}
                  onChange={handleChange}
                  className={inputClass}
                >
                  <option value="HYROX">HYROX</option>
                  <option value="Strength">Strength</option>
                </select>
              </div>

              <div>
                <label className={labelClass}>Notes</label>
                <textarea
                  name="notes"
                  value={formData.notes}
                  onChange={handleChange}
                  rows={5}
                  className={`${inputClass} resize-none`}
                />
              </div>
            </div>
          </section>

          {formData.sessionType === "HYROX" && (
            <section className="space-y-6">
              <section className={`${cardClass} p-5 sm:p-6`}>
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(249,115,22,0.10),transparent_30%)]" />
                <div className="relative space-y-5">
                  <div>
                    <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-orange-400/20 bg-orange-400/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.24em] text-orange-100">
                      <Flame className="h-3.5 w-3.5" />
                      HYROX Settings
                    </div>
                    <h2 className="text-2xl font-semibold tracking-[-0.03em]">Session Engine</h2>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <div>
                      <label className={labelClass}>WOD Type</label>
                      <select
                        name="wodType"
                        value={formData.wodType}
                        onChange={handleChange}
                        className={inputClass}
                      >
                        <option value="AMRAP">AMRAP</option>
                        <option value="For Time">For Time</option>
                        <option value="EMOM">EMOM</option>
                        <option value="Chipper">Chipper</option>
                      </select>
                    </div>

                    <div>
                      <label className={labelClass}>Group Size</label>
                      <input
                        type="number"
                        name="groupSize"
                        value={formData.groupSize}
                        onChange={handleChange}
                        className={inputClass}
                      />
                    </div>

                    <div>
                      <label className={labelClass}>Timer Mode</label>
                      <select
                        name="timerMode"
                        value={formData.timerMode}
                        onChange={handleChange}
                        className={inputClass}
                      >
                        <option value="timed">Timed (Rounds)</option>
                        <option value="stationControlled">Station Controlled</option>
                      </select>
                    </div>
                  </div>

                  {formData.timerMode === "timed" && (
                    <>
                      <div className="grid gap-4 md:grid-cols-3">
                        <div>
                          <label className={labelClass}>Minutes</label>
                          <input
                            type="number"
                            name="roundMinutes"
                            value={formData.roundMinutes}
                            onChange={handleChange}
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <label className={labelClass}>Seconds</label>
                          <input
                            type="number"
                            name="roundSeconds"
                            value={formData.roundSeconds}
                            onChange={handleChange}
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <label className={labelClass}>Rounds</label>
                          <input
                            type="number"
                            name="rounds"
                            value={formData.rounds}
                            onChange={handleChange}
                            className={inputClass}
                          />
                        </div>
                      </div>

                      <div>
                        <label className={labelClass}>Rest Between Rounds (sec)</label>
                        <input
                          type="number"
                          name="restBetweenRoundsSeconds"
                          value={formData.restBetweenRoundsSeconds}
                          onChange={handleChange}
                          className={inputClass}
                        />
                      </div>

                      <div className="rounded-[24px] border border-white/10 bg-black/40 p-5">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">
                          Total Session Time
                        </div>
                        <div className="mt-2 text-4xl font-semibold tracking-[-0.04em]">
                          {formatSeconds(totalSessionSeconds)}
                        </div>
                        <div className="mt-2 text-sm text-white/60">
                          Work: {formatSeconds(totalWorkSeconds)}
                        </div>
                      </div>
                    </>
                  )}

                  {formData.timerMode === "stationControlled" && (
                    <div>
                      <label className={labelClass}>Controlled Station</label>
                      <select
                        name="controlStationIndex"
                        value={formData.controlStationIndex}
                        onChange={handleChange}
                        className={inputClass}
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
              </section>

              <section className={`${cardClass} p-5 sm:p-6`}>
                <div className="relative space-y-5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/42">
                        <Layers3 className="h-3.5 w-3.5" />
                        Stations
                      </div>
                      <h2 className="text-2xl font-semibold tracking-[-0.03em]">Build the Floor</h2>
                    </div>

                    <button
                      type="button"
                      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
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
                      <Plus className="h-4 w-4" />
                      Add Station
                    </button>
                  </div>

                  <div className="space-y-4">
                    {(formData.stations || []).map((station, sIdx) => (
                      <div
                        key={station.id}
                        className="rounded-[24px] border border-white/10 bg-black/30 p-4"
                      >
                        <div className="mb-3 flex items-center gap-3">
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
                            className={inputClass}
                          />

                          <button
                            type="button"
                            className="shrink-0 rounded-full border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-semibold text-white/70 transition hover:border-white/20 hover:bg-white/[0.06] hover:text-white disabled:opacity-40"
                            onClick={() => {
                              setFormData((p: any) => ({
                                ...p,
                                stations: (p.stations || []).filter((s: Station) => s.id !== station.id),
                              }));
                            }}
                            disabled={(formData.stations || []).length <= 1}
                          >
                            Remove
                          </button>
                        </div>

                        <div className="space-y-3">
                          {(station.movements || []).map((mv, mIdx) => (
                            <div key={mv.id} className="grid gap-3 md:grid-cols-12">
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
                                          ? {
                                              ...s,
                                              movements: [...(s.movements || []), { id: makeId(), name: "" }],
                                            }
                                          : s
                                      ),
                                    }));
                                  }
                                }}
                                placeholder={`Movement ${mIdx + 1}`}
                                className="md:col-span-7 w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-white outline-none transition placeholder:text-white/25 focus:border-white/20 focus:bg-black"
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
                                placeholder="Target"
                                className="md:col-span-4 w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-white outline-none transition placeholder:text-white/25 focus:border-white/20 focus:bg-black"
                              />

                              <button
                                type="button"
                                className="md:col-span-1 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm font-semibold text-white/70 transition hover:border-white/20 hover:bg-white/[0.06] hover:text-white disabled:opacity-40"
                                onClick={() => {
                                  setFormData((p: any) => ({
                                    ...p,
                                    stations: (p.stations || []).map((s: Station) =>
                                      s.id === station.id
                                        ? {
                                            ...s,
                                            movements: (s.movements || []).filter(
                                              (m: Movement) => m.id !== mv.id
                                            ),
                                          }
                                        : s
                                    ),
                                  }));
                                }}
                                disabled={(station.movements || []).length <= 1}
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>

                        <button
                          type="button"
                          className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
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
                          <Plus className="h-4 w-4" />
                          Add Movement
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </section>
          )}

          {formData.sessionType === "Strength" && (
            <section className="space-y-6">
              <section className={`${cardClass} p-5 sm:p-6`}>
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.10),transparent_30%)]" />
                <div className="relative space-y-5">
                  <div>
                    <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-100">
                      <Dumbbell className="h-3.5 w-3.5" />
                      Strength Block
                    </div>
                    <h2 className="text-2xl font-semibold tracking-[-0.03em]">Strength Builder</h2>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <div>
                      <label className={labelClass}>Goal</label>
                      <input
                        type="text"
                        name="strengthGoal"
                        value={formData.strengthGoal}
                        onChange={handleChange}
                        className={inputClass}
                      />
                    </div>

                    <div>
                      <label className={labelClass}>Load</label>
                      <input
                        type="text"
                        name="strengthLoad"
                        value={formData.strengthLoad}
                        onChange={handleChange}
                        className={inputClass}
                      />
                    </div>

                    <div>
                      <label className={labelClass}>Range</label>
                      <input
                        type="text"
                        name="strengthRange"
                        value={formData.strengthRange}
                        onChange={handleChange}
                        className={inputClass}
                      />
                    </div>
                  </div>

                  <div>
                    <label className={labelClass}>Coach Notes</label>
                    <textarea
                      name="strengthCue"
                      value={formData.strengthCue}
                      onChange={handleChange}
                      rows={3}
                      className={`${inputClass} resize-none`}
                    />
                  </div>

                  <div className="space-y-3">
                    {formData.strengthMovements.map((row, idx) => (
                      <div
                        key={idx}
                        className="grid gap-3 rounded-[24px] border border-white/10 bg-black/30 p-4 md:grid-cols-3"
                      >
                        <input
                          type="text"
                          value={row.movement}
                          placeholder="Movement"
                          onChange={(e) => {
                            const updated = [...formData.strengthMovements];
                            updated[idx] = { ...updated[idx], movement: e.target.value };
                            setFormData((p) => ({ ...p, strengthMovements: updated }));
                          }}
                          className={inputClass}
                        />
                        <input
                          type="text"
                          value={row.percent}
                          placeholder="Load"
                          onChange={(e) => {
                            const updated = [...formData.strengthMovements];
                            updated[idx] = { ...updated[idx], percent: e.target.value };
                            setFormData((p) => ({ ...p, strengthMovements: updated }));
                          }}
                          className={inputClass}
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
                          className={inputClass}
                        />
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
                    onClick={() =>
                      setFormData((p) => ({
                        ...p,
                        strengthMovements: [
                          ...p.strengthMovements,
                          { movement: "", percent: "", repRange: "" },
                        ],
                      }))
                    }
                  >
                    <Plus className="h-4 w-4" />
                    Add Strength Row
                  </button>
                </div>
              </section>
            </section>
          )}

          <div className="xl:col-span-2">
            <div className="sticky bottom-4 z-20 rounded-[28px] border border-white/10 bg-neutral-950/95 p-4 shadow-[0_24px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">
                    Ready to publish
                  </div>
                  <div className="mt-1 text-sm text-white/65">
                    Save this session for the selected date and slot.
                  </div>
                </div>

                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-2 rounded-[22px] border border-white/15 bg-white px-6 py-3 text-sm font-semibold text-black transition hover:opacity-90"
                >
                  <Save className="h-4 w-4" />
                  Save Session
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default WODEditor;