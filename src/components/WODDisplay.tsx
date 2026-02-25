import React, { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import { Dumbbell, Flame, Sun, Moon } from "lucide-react";

type SessionKey = "AM" | "PM" | "930AM";
type TimerMode = "timed" | "stationControlled";
type Phase = "WORK" | "REST" | "FINISHED";

const WODDisplay = () => {
  const [wod, setWod] = useState<any>(null);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [sessionKey, setSessionKey] = useState<SessionKey>("AM");
  const [loading, setLoading] = useState<boolean>(false);

  const selectedDateObj = useMemo(() => {
    if (!selectedDate) return null;
    const d = new Date(selectedDate);
    return Number.isNaN(d.getTime()) ? null : d;
  }, [selectedDate]);

  const dayName = useMemo(() => {
    if (!selectedDateObj) return "";
    return selectedDateObj.toLocaleDateString("en-GB", { weekday: "long" });
  }, [selectedDateObj]);

  // You can change this later if you want Tue=Upper Thu=Lower etc
  const strengthTitle = "Strength";

  const fetchWODForDate = async (dateString: string, key: SessionKey) => {
    setLoading(true);
    try {
      const docRef = doc(db, "wods", dateString);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const data = docSnap.data();
        const sessionData = (data as any)[key];
        setWod(sessionData || null);
      } else {
        setWod(null);
      }
    } catch (error) {
      console.error("Error fetching WOD:", error);
      setWod(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const today = new Date();
    const isoToday = today.toISOString().split("T")[0];
    setSelectedDate(isoToday);
  }, []);

  useEffect(() => {
    if (selectedDate) fetchWODForDate(selectedDate, sessionKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, sessionKey]);

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedDate(e.target.value);
  };

  /** -------------------- Derived values -------------------- */

  const timerMode: TimerMode = useMemo(() => {
    const m = wod?.timerMode;
    return m === "stationControlled" ? "stationControlled" : "timed";
  }, [wod?.timerMode]);

  const groupSize: number | null = useMemo(() => {
    const n = wod?.groupSize;
    return typeof n === "number" && n > 0 ? n : null;
  }, [wod?.groupSize]);

  const movementsList: string[] = useMemo(() => {
    return normalizeMovements(wod?.movements);
  }, [wod?.movements]);

  const controlStationIndex: number | null = useMemo(() => {
    const v = wod?.controlStationIndex;
    return typeof v === "number" && v >= 0 ? v : null;
  }, [wod?.controlStationIndex]);

  const roundDurationSeconds: number | null = useMemo(() => {
    const v = wod?.roundDurationSeconds;
    if (typeof v === "number" && v > 0) return v;
    // fallback if you ever still have old "duration" strings
    return parseDurationToSeconds(wod?.duration);
  }, [wod?.roundDurationSeconds, wod?.duration]);

  const rounds: number | null = useMemo(() => {
    const v = wod?.rounds;
    if (typeof v === "number" && v >= 1) return v;
    if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
      return Math.max(1, Math.floor(Number(v)));
    }
    return null;
  }, [wod?.rounds]);

  const restBetweenRoundsSeconds: number = useMemo(() => {
    const v = wod?.restBetweenRoundsSeconds;
    return typeof v === "number" && v >= 0 ? v : 0;
  }, [wod?.restBetweenRoundsSeconds]);

  const sessionHeaderBits = useMemo(() => {
    if (!wod) return { type: "—", style: "—", extra: "—" };

    if (wod.sessionType === "HYROX") {
      const grp = groupSize ? `GROUP OF ${groupSize}` : "GROUP";
      const mode = timerMode === "timed" ? "TIMED" : "STATION CONTROL";
      return {
        type: "HYROX",
        style: (wod.wodType ?? "—").toString().toUpperCase(),
        extra: `${grp} | ${mode}`,
      };
    }

    if (wod.sessionType === "Strength") {
      return {
        type: "STRENGTH",
        style: strengthTitle.toUpperCase(),
        extra: `${(wod?.strengthMovements?.length ?? 0)} STATIONS`,
      };
    }

    return { type: wod.sessionType ?? "—", style: wod.wodType ?? "—", extra: "—" };
  }, [wod, groupSize, timerMode, strengthTitle]);

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto w-full max-w-[1400px] px-4 py-4">
        {/* TOP CONTROLS */}
        <div className="flex flex-wrap items-center gap-2 pb-3">
          <input
            type="date"
            value={selectedDate}
            onChange={handleDateChange}
            className="p-2 rounded bg-neutral-900 text-white border border-neutral-700"
          />
          <button
            onClick={() => setSessionKey("AM")}
            className={`px-4 py-2 rounded border ${
              sessionKey === "AM"
                ? "bg-white text-black border-white"
                : "bg-neutral-900 text-white border-neutral-700"
            }`}
          >
            AM <Sun className="inline ml-1 w-4 h-4" />
          </button>
          <button
            onClick={() => setSessionKey("930AM")}
            className={`px-4 py-2 rounded border ${
              sessionKey === "930AM"
                ? "bg-white text-black border-white"
                : "bg-neutral-900 text-white border-neutral-700"
            }`}
          >
            9:30AM
          </button>
          <button
            onClick={() => setSessionKey("PM")}
            className={`px-4 py-2 rounded border ${
              sessionKey === "PM"
                ? "bg-white text-black border-white"
                : "bg-neutral-900 text-white border-neutral-700"
            }`}
          >
            PM <Moon className="inline ml-1 w-4 h-4" />
          </button>
        </div>

        {!selectedDate ? null : loading ? (
          <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-10 text-center text-xl">
            Loading…
          </div>
        ) : !wod ? (
          <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-10 text-center text-xl">
            No session found for selected date.
          </div>
        ) : (
          <div className="space-y-4">
            <TVHeader
              selectedDate={selectedDateObj}
              sessionKey={sessionKey}
              type={sessionHeaderBits.type}
              style={sessionHeaderBits.style}
              extra={sessionHeaderBits.extra}
            />

            <div className="grid gap-4 grid-cols-[1fr_2fr] max-lg:grid-cols-1">
              {/* LEFT */}
              <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-6">
                <div className="flex items-start justify-between gap-6">
                  <div className="min-w-0">
                    <h1 className="text-6xl sm:text-7xl font-heading uppercase tracking-widest text-white">
                      AlphaFIT
                    </h1>

                    {wod.sessionType === "Strength" ? (
                      <div className="mt-2 text-4xl sm:text-5xl font-bold italic tracking-tight text-white/90">
                      </div>
                    ) : (
                      <div className="mt-2 text-4xl sm:text-5xl font-bold italic tracking-tight text-white/90">
                        {dayName || ""}
                      </div>
                    )}

                    {wod.wodName ? (
                      <div className="mt-3 text-xl text-white/70">
                        {wod.wodName}
                      </div>
                    ) : null}
                  </div>

                  <div className="hidden sm:block">
                    <img
                      src="/ZERO-ALPHA.png"
                      alt="Zero Alpha Fitness Logo"
                      className="h-20 object-contain opacity-90"
                    />
                  </div>
                </div>

                <div className="mt-6 space-y-4">

                {/* HERO MODULE */}
                <div>
                  {wod.sessionType === "HYROX" ? (
                    timerMode === "timed" ? (
                      roundDurationSeconds && rounds ? (
                        <RoundTimer
                          roundDurationSeconds={roundDurationSeconds}
                          rounds={rounds}
                          restBetweenRoundsSeconds={restBetweenRoundsSeconds}
                        />
                      ) : (
                        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
                          <div className="text-xs uppercase tracking-[0.35em] text-white/60 font-semibold">
                            Timer not configured
                          </div>
                          <div className="mt-2 text-white/80">
                            Set minutes/seconds + rounds in the editor.
                          </div>
                        </div>
                      )
                    ) : (
                      <ControlStationHero
                        controlIndex={controlStationIndex}
                        total={movementsList.length}
                        controlName={
                          controlStationIndex != null ? movementsList[controlStationIndex] : null
                        }
                      />
                    )
                  ) : (
                    <StrengthOverview
                      title={strengthTitle}
                      movements={wod.strengthMovements || []}
                    />
                  )}
                </div>
              </div>
              </div>

              {/* RIGHT: Session Plan */}
              <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-6">
                <div className="flex items-baseline justify-between gap-4">
                  <h2 className="text-3xl font-bold uppercase tracking-wide text-white/90">
                    {wod.sessionType === "Strength" ? strengthTitle : "Session Plan"}
                  </h2>
                  <div className="text-sm text-white/60">
                    {wod.sessionType === "Strength"
                      ? `${wod?.strengthMovements?.length ?? 0} stations`
                      : `${movementsList.length} stations`}
                  </div>
                </div>

                <div className="mt-4">
                  {wod.sessionType === "Strength" ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                      {wod.strengthMovements?.map((sm: any, index: number) => (
                        <StrengthStationCard
                          key={index}
                          index={index}
                          movement={sm.movement}
                          percent={sm.percent}
                          repRange={sm.repRange}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                      {movementsList.map((name: string, index: number) => {
                        const isControl =
                          timerMode === "stationControlled" &&
                          controlStationIndex != null &&
                          index === controlStationIndex;

                        return (
                          <StationCard
                            key={index}
                            title={`${index + 1}. ${name}`}
                            subtitle={isControl ? "CONTROL STATION" : null}
                            icon="flame"
                            emphasis={isControl ? "control" : "none"}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="text-center text-xs text-white/20 tracking-[0.3em] uppercase">
              AlphaFIT TV Mode
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WODDisplay;

/* ------------------------- Header ------------------------- */

function TVHeader({
  selectedDate,
  sessionKey,
  type,
  style,
  extra,
}: {
  selectedDate: Date | null;
  sessionKey: SessionKey;
  type: string;
  style: string;
  extra: string;
}) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950 px-5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-sm sm:text-base text-white/80">
          <span className="font-semibold text-white">
            {selectedDate
              ? selectedDate.toLocaleDateString("en-GB", {
                  weekday: "long",
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })
              : "—"}
          </span>
          <span className="text-white/30">|</span>
          <span className="uppercase tracking-widest">{sessionKey}</span>
          <span className="text-white/30">|</span>
          <span className="uppercase">{type}</span>
          <span className="text-white/30">|</span>
          <span className="uppercase">{style}</span>
          <span className="text-white/30">|</span>
          <span className="uppercase">{extra}</span>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <span className="inline-flex h-2 w-2 rounded-full bg-red-500" />
          <span className="uppercase tracking-widest text-white/90">LIVE</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------- Generic UI ------------------------- */

function MetaPill({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 px-3 py-2">
      <div className="text-xs uppercase tracking-widest text-white/50">{label}</div>
      <div className="text-base font-semibold text-white/90 truncate">
        {value || "—"}
      </div>
    </div>
  );
}

function StationCard({
  title,
  subtitle,
  icon,
  emphasis = "none",
}: {
  title: string;
  subtitle: string | null;
  icon: "flame" | "dumbbell";
  emphasis?: "none" | "control";
}) {
  const Icon = icon === "flame" ? Flame : Dumbbell;

  const border =
    emphasis === "control"
      ? "border-sky-400 shadow-[0_0_30px_rgba(56,189,248,0.18)]"
      : "border-neutral-800";

  const badge = emphasis === "control" ? "text-sky-300" : "text-white/70";
  const iconColor = emphasis === "control" ? "text-sky-300" : "text-yellow-400";

  return (
    <div className={`rounded-2xl border ${border} bg-neutral-900/40 p-4`}>
      <div className="flex items-start gap-3">
        <div className="rounded-xl border border-neutral-700 bg-neutral-950 p-2">
          <Icon className={`h-5 w-5 ${iconColor}`} />
        </div>
        <div className="min-w-0">
          <div className="text-xl font-bold text-white/95 leading-snug">
            {title}
          </div>
          {subtitle ? (
            <div className={`mt-1 text-sm font-semibold ${badge}`}>{subtitle}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ------------------------- Strength ------------------------- */

function StrengthOverview({
  title,
  movements,
}: {
  title: string;
  movements: any[];
}) {
  return (
    <div className="w-full rounded-2xl border border-neutral-800 bg-neutral-950 p-6">
      <div className="text-xs uppercase tracking-[0.35em] text-white/60 font-semibold">
        Strength Block
      </div>
      <div className="mt-2 text-5xl font-extrabold tracking-tight text-white">
        {title}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <MetaPill label="Stations" value={`${movements.length || 0}`} />
        <MetaPill label="Goal" value="Quality reps" />
        <MetaPill label="Load" value="% of 1RM" />
        <MetaPill label="Range" value="Hit target reps" />
      </div>

      <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
        <div className="text-sm font-semibold text-white/80">Coaching cue</div>
        <div className="mt-1 text-sm text-white/60">
          Keep reps crisp. Stop before form breaks. Move up only if all reps look the same.
        </div>
      </div>
    </div>
  );
}

function StrengthStationCard({
  index,
  movement,
  percent,
  repRange,
}: {
  index: number;
  movement: string;
  percent?: any;
  repRange?: any;
}) {
  const pct = String(percent ?? "").trim();
  const rr = String(repRange ?? "").trim();

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-[0.35em] text-white/50">
            Station {index + 1}
          </div>

          <div className="mt-1 text-2xl font-bold text-white/95 leading-snug">
            {movement || "—"}
          </div>

          <div className="mt-2 text-lg font-semibold text-white/80">
            {pct ? `${pct}% of 1RM` : "—"}
            {rr ? ` • ${rr} reps` : ""}
          </div>
        </div>

        <div className="rounded-xl border border-neutral-700 bg-neutral-950 p-3">
          <Dumbbell className="h-6 w-6 text-yellow-300" />
        </div>
      </div>
    </div>
  );
}

/* ------------------------- HYROX - Station Controlled (no ring) ------------------------- */

function ControlStationHero({ controlIndex, total, controlName, }: { controlIndex: number | null; total: number; controlName: string | null; }) { const has = controlIndex != null && total > 0 && !!controlName; return ( <div className="w-full rounded-2xl border border-sky-400/60 bg-sky-500/5 p-6 shadow-[0_0_40px_rgba(56,189,248,0.10)]"> <div className="flex items-center justify-between"> <div className="text-xs uppercase tracking-[0.35em] text-sky-300 font-semibold"> Control Station </div> <div className="text-xs uppercase tracking-[0.25em] text-white/60"> STATION CONTROL </div> </div> <div className="mt-4"> <div className="text-6xl font-extrabold text-white leading-none"> {has ? `${controlIndex! + 1}/${total}` : "—"} </div> <div className="mt-3 text-3xl font-bold text-white/90"> {has ? controlName : "Pick a control station in the editor"} </div> <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-950/40 p-4"> <div className="text-sm text-white/70"> Use this station as the pace setter. </div> <div className="mt-1 text-sm text-white/50"> Move on when the group completes the target here. </div> </div> </div> </div> ); }

/* ------------------------- HYROX - Timed rounds timer ------------------------- */

function RoundTimer({
  roundDurationSeconds,
  rounds,
  restBetweenRoundsSeconds,
}: {
  roundDurationSeconds: number;
  rounds: number;
  restBetweenRoundsSeconds: number;
}) {
  const safeRoundSeconds = Math.max(0, Math.floor(roundDurationSeconds || 0));
  const safeRounds = Math.max(1, Math.floor(rounds || 1));
  const safeRest = Math.max(0, Math.floor(restBetweenRoundsSeconds || 0));

  const [phase, setPhase] = useState<Phase>("WORK");
  const [roundIndex, setRoundIndex] = useState<number>(1); // 1-based

  // control
  const [isRunning, setIsRunning] = useState<boolean>(false);

  // track elapsed in the current phase without relying on "phaseStartTs" running in background
  const [elapsedInPhase, setElapsedInPhase] = useState<number>(0); // seconds

  // tick when running
  useEffect(() => {
    if (!isRunning) return;

    const t = setInterval(() => {
      setElapsedInPhase((e) => e + 1);
    }, 1000);

    return () => clearInterval(t);
  }, [isRunning]);

  const phaseDuration =
    phase === "WORK" ? safeRoundSeconds : phase === "REST" ? safeRest : 0;

  const remaining =
    phase === "FINISHED"
      ? 0
      : Math.max(0, Math.floor(phaseDuration - elapsedInPhase));

  const progress =
    phaseDuration > 0 ? Math.min(1, Math.max(0, elapsedInPhase / phaseDuration)) : 0;

  // phase completion
  useEffect(() => {
    if (!isRunning) return;
    if (phase === "FINISHED") return;
    if (phaseDuration <= 0) return;

    if (elapsedInPhase >= phaseDuration) {
      advanceToNext(); // auto-advance only while running
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsedInPhase, isRunning, phase, phaseDuration]);

  const resetToStart = () => {
    setIsRunning(false);
    setPhase("WORK");
    setRoundIndex(1);
    setElapsedInPhase(0);
  };

  const pause = () => setIsRunning(false);
  const startOrResume = () => {
    if (phase === "FINISHED") {
      // if finished, starting should restart
      resetToStart();
      setIsRunning(true);
      return;
    }
    setIsRunning(true);
  };

  const advanceToNext = () => {
    // called by Next Round button or on completion while running
    if (phase === "FINISHED") return;

    if (phase === "WORK") {
      const hasMoreRounds = roundIndex < safeRounds;

      if (!hasMoreRounds) {
        setPhase("FINISHED");
        setIsRunning(false);
        setElapsedInPhase(0);
        return;
      }

      if (safeRest > 0) {
        setPhase("REST");
        setElapsedInPhase(0);
        return;
      }

      // no rest: jump straight to next round work
      setRoundIndex((r) => r + 1);
      setPhase("WORK");
      setElapsedInPhase(0);
      return;
    }

    if (phase === "REST") {
      setRoundIndex((r) => r + 1);
      setPhase("WORK");
      setElapsedInPhase(0);
      return;
    }
  };

  const label = phase === "WORK" ? "WORK" : phase === "REST" ? "REST" : "FINISHED";
  const labelColor =
    phase === "WORK"
      ? "text-yellow-300"
      : phase === "REST"
      ? "text-sky-300"
      : "text-emerald-300";

  return (
  <div className="flex flex-col items-center justify-center gap-6">
    {/* ring + time (stacked in same box, no negative margins) */}
    <div className="relative flex items-center justify-center">
      <Ring progress={progress} size={300} stroke={16} />

      <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-auto">
        <div className="text-7xl font-extrabold tracking-tight text-white">
          {secondsToClock(remaining)}
        </div>

        <div className={`mt-2 text-sm uppercase tracking-[0.25em] ${labelColor}`}>
          {label}{phase !== "FINISHED" ? (isRunning ? "" : " (PAUSED)") : ""}
        </div>

        <div className="mt-4 text-sm font-semibold text-white/80">
          ROUND {Math.min(roundIndex, safeRounds)} / {safeRounds}
        </div>
      </div>
    </div>

    {/* buttons live BELOW the ring */}
    <div className="flex items-center justify-center gap-3">
      {!isRunning ? (
        <button
          type="button"
          onClick={startOrResume}
          className="px-4 py-2 rounded-lg border border-neutral-700 bg-white text-black text-xs uppercase tracking-widest font-bold"
        >
          {elapsedInPhase === 0 && phase === "WORK" && roundIndex === 1 ? "Start" : "Resume"}
        </button>
      ) : (
        <button
          type="button"
          onClick={pause}
          className="px-4 py-2 rounded-lg border border-neutral-700 bg-neutral-900/40 text-xs uppercase tracking-widest text-white/90 hover:text-white"
        >
          Pause
        </button>
      )}

      <button
        type="button"
        onClick={advanceToNext}
        disabled={phase === "FINISHED"}
        className={`px-4 py-2 rounded-lg border border-neutral-700 text-xs uppercase tracking-widest ${
          phase === "FINISHED"
            ? "bg-neutral-900/20 text-white/30 cursor-not-allowed"
            : "bg-neutral-900/40 text-white/90 hover:text-white"
        }`}
      >
        Next round
      </button>

      <button
        type="button"
        onClick={resetToStart}
        className="px-4 py-2 rounded-lg border border-neutral-700 bg-neutral-900/40 text-xs uppercase tracking-widest text-white/70 hover:text-white"
      >
        Restart
      </button>
    </div>
  </div>
);
}

function Ring({
  progress,
  size,
  stroke,
}: {
  progress: number;
  size: number;
  stroke: number;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(1, Math.max(0, progress));
  const offset = c * (1 - clamped);

  return (
    <svg
      width={size}
      height={size}
      className="pointer-events-none drop-shadow-[0_0_30px_rgba(250,204,21,0.20)]"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke="rgba(255,255,255,0.10)"
        strokeWidth={stroke}
        fill="transparent"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke="rgba(250,204,21,0.90)"
        strokeWidth={stroke}
        strokeLinecap="round"
        fill="transparent"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

/* ------------------------- helpers ------------------------- */

function normalizeMovements(movements: any): string[] {
  if (!movements) return [];

  // New schema: string[]
  if (Array.isArray(movements) && movements.every((x) => typeof x === "string")) {
    return movements.map((s) => s.trim()).filter(Boolean);
  }

  // Old schema: [{partner1}] => use partner1 as movement name
  if (Array.isArray(movements) && movements.every((x) => x && typeof x === "object")) {
    return movements
      .map((m: any) => (m?.partner1 ?? m?.movement ?? "").toString().trim())
      .filter(Boolean);
  }

  return [];
}

function parseDurationToSeconds(duration: any): number | null {
  if (!duration) return null;
  if (typeof duration === "number") return Math.max(0, Math.floor(duration * 60));
  if (typeof duration !== "string") return null;

  const s = duration.trim();
  if (/^\d+$/.test(s)) return Math.max(0, parseInt(s, 10) * 60);

  if (/^\d{1,2}:\d{2}$/.test(s)) {
    const [m, sec] = s.split(":").map((x) => parseInt(x, 10));
    if (Number.isFinite(m) && Number.isFinite(sec)) return m * 60 + sec;
  }

  return null;
}

function secondsToClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}