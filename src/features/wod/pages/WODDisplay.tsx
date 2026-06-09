import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../../firebase";
import { Dumbbell, Flame, Home, MonitorPlay, Moon, Settings2, Share, Sun } from "lucide-react";
import SessionShareModal from "../components/SessionShareModal";
import { getDateInputValueInTimeZone } from "../../../utils/date";

type SessionKey = "AM" | "PM" | "930AM";
type TimerMode = "timed" | "stationControlled";
type Phase = "WORK" | "REST" | "FINISHED";

type Movement = {
  id?: string;
  name: string;
  target?: string;
  notes?: string;
};

type Station = {
  id?: string;
  title: string;
  movements: Movement[];
};

const WODDisplay = () => {
  const timeZone = "Europe/London";
  const [wod, setWod] = useState<any>(null);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [sessionKey, setSessionKey] = useState<SessionKey>("AM");
  const [loading, setLoading] = useState<boolean>(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const latestFetchRequestRef = useRef(0);

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
    const requestId = latestFetchRequestRef.current + 1;
    latestFetchRequestRef.current = requestId;
    setLoading(true);
    try {
      const docRef = doc(db, "wods", dateString);
      const docSnap = await getDoc(docRef);
      if (latestFetchRequestRef.current !== requestId) return;

      if (docSnap.exists()) {
        const data = docSnap.data();
        const sessionData = (data as any)[key];
        setWod(sessionData || null);
      } else {
        setWod(null);
      }
    } catch (error) {
      if (latestFetchRequestRef.current !== requestId) return;
      console.error("Error fetching WOD:", error);
      setWod(null);
    } finally {
      if (latestFetchRequestRef.current === requestId) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    setSelectedDate(getDateInputValueInTimeZone(new Date(), timeZone));
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

  /**
   * NEW: stations-aware normalization (with legacy fallback to old movements[])
   */
  const stations: Station[] = useMemo(() => {
    return normalizeStations(wod?.stations, wod?.movements);
  }, [wod?.stations, wod?.movements]);

  const stationCount = stations.length;

  const controlStationIndex: number | null = useMemo(() => {
    const v = wod?.controlStationIndex;
    return typeof v === "number" && v >= 0 ? v : null;
  }, [wod?.controlStationIndex]);

  const controlStationTitle: string | null = useMemo(() => {
    if (controlStationIndex == null) return null;
    return stations[controlStationIndex]?.title ?? null;
  }, [controlStationIndex, stations]);

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

  const sessionTimeLabel = useMemo(() => getSessionTimeLabel(sessionKey), [sessionKey]);

  const sharePayload = useMemo(() => {
    if (!wod || !selectedDateObj) return null;

    const dateLabel = selectedDateObj.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });

    if (wod.sessionType === "Strength") {
      const movements = Array.isArray(wod.strengthMovements) ? wod.strengthMovements : [];
      const items = movements
        .map((movement: any) => {
          const name = String(movement?.movement ?? "").trim();
          const percent = String(movement?.percent ?? "").trim();
          const repRange = String(movement?.repRange ?? "").trim();
          const details = [percent, repRange].filter(Boolean).join(" • ");
          return name ? `${name}${details ? ` • ${details}` : ""}` : "";
        })
        .filter(Boolean);

      return {
        title: wod.wodName?.trim() || strengthTitle,
        subtitle: dayName ? `${dayName} strength session` : "Programmed strength session",
        filename: `${selectedDate}-${sessionKey.toLowerCase()}-session.png`,
        shareTitle: `${sessionTimeLabel} session`,
        shareText: `Today's ${sessionTimeLabel.toLowerCase()} session is live: ${wod.wodName?.trim() || strengthTitle}`,
        dateLabel,
        sessionLabel: sessionKey,
        sessionTimeLabel,
        sessionType: sessionHeaderBits.type,
        sessionStyle: sessionHeaderBits.style,
        sessionExtra: sessionHeaderBits.extra,
        highlight: `${movements.length || 0}`,
        highlightLabel: "Stations",
        stationsLabel: `${movements.length || 0} strength stations`,
        coachNote: String(wod?.strengthCue ?? "").trim() || undefined,
        items,
      };
    }

    const items = stations
      .map((station: Station, index: number) => {
        const title = (station.title || `Station ${index + 1}`).trim();
        const movementNames = station.movements
          .map((movement) => String(movement.name ?? "").trim())
          .filter(Boolean)
          .slice(0, 2)
          .join(" + ");

        return movementNames ? `${title} • ${movementNames}` : title;
      })
      .filter(Boolean);

    const highlight =
      timerMode === "timed"
        ? roundDurationSeconds && rounds
          ? `${formatSeconds(roundDurationSeconds)} x ${rounds}`
          : `${stationCount || 0}`
        : controlStationIndex != null
        ? `${controlStationIndex + 1}/${stationCount || 1}`
        : `${stationCount || 0}`;

    const highlightLabel =
      timerMode === "timed"
        ? "Timer"
        : controlStationIndex != null
        ? "Control"
        : "Stations";

    const formatLabel =
      timerMode === "timed"
        ? `${stationCount || 0} stations • ${rounds || 1} rounds`
        : controlStationTitle
        ? `Control station: ${controlStationTitle}`
        : `${stationCount || 0} stations`;

    return {
      title: wod.wodName?.trim() || `${dayName || "Daily"} Session`,
      subtitle: dayName ? `${dayName} HYROX session` : "Programmed HYROX session",
      filename: `${selectedDate}-${sessionKey.toLowerCase()}-session.png`,
      shareTitle: `${sessionTimeLabel} session`,
      shareText: `Today's ${sessionTimeLabel.toLowerCase()} session is live: ${wod.wodName?.trim() || "HYROX session"}`,
      dateLabel,
      sessionLabel: sessionKey,
      sessionTimeLabel,
      sessionType: sessionHeaderBits.type,
      sessionStyle: sessionHeaderBits.style,
      sessionExtra: sessionHeaderBits.extra,
      highlight,
      highlightLabel,
      stationsLabel: formatLabel,
      coachNote: undefined,
      items,
    };
  }, [
    controlStationIndex,
    controlStationTitle,
    dayName,
    roundDurationSeconds,
    rounds,
    selectedDate,
    selectedDateObj,
    sessionHeaderBits.extra,
    sessionHeaderBits.style,
    sessionHeaderBits.type,
    sessionKey,
    sessionTimeLabel,
    stationCount,
    stations,
    strengthTitle,
    timerMode,
    wod,
  ]);

  const isStrengthSession = wod?.sessionType === "Strength";
  const displayTitle = isStrengthSession
    ? wod?.wodName?.trim() || strengthTitle
    : wod?.wodName?.trim() || `${dayName || "Daily"} Session`;
  const displaySubtitle = isStrengthSession
    ? String(wod?.strengthGoal ?? "Strength block").trim() || "Strength block"
    : dayName || sessionHeaderBits.style;
  const boardCountLabel = isStrengthSession
    ? `${wod?.strengthMovements?.length ?? 0} stations`
    : `${stationCount} stations`;
  const footerNote = isStrengthSession
    ? String(wod?.strengthCue ?? "").trim() || "Quality reps. Own the positions."
    : timerMode === "stationControlled" && controlStationTitle
    ? `Control station: ${controlStationTitle}. Move when the pace station completes the target.`
    : "Stay sharp. Rotate clean. Chase standards.";

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#030303] font-body text-[#f4f0ea]">
      <div className="absolute inset-0 carbon-fiber-bg opacity-70" />
      <div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(255,255,255,0.06),transparent_28%,rgba(20,184,166,0.13)_60%,transparent_82%)]" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/35 to-transparent" />
      <img
        src="/ZERO-ALPHA.png"
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute -right-12 top-1/2 hidden w-[44vw] max-w-[760px] -translate-y-1/2 select-none opacity-[0.035] mix-blend-screen lg:block"
      />

      <AdminControls
        controlsOpen={controlsOpen}
        setControlsOpen={setControlsOpen}
        selectedDate={selectedDate}
        handleDateChange={handleDateChange}
        sessionKey={sessionKey}
        setSessionKey={setSessionKey}
        canShare={!!wod}
        onShare={() => setShareOpen(true)}
      />

      <main className="relative z-10 flex min-h-screen items-stretch p-4 md:p-6 xl:p-8">
        {!selectedDate ? null : loading ? (
          <DisplayState title="Loading session" detail="Pulling the latest board from AlphaFIT." />
        ) : !wod ? (
          <DisplayState title="No session found" detail="Open controls to choose a different date or class time." />
        ) : (
          <div className="grid min-h-[calc(100vh-2rem)] w-full grid-rows-[auto_1fr_auto] gap-4 md:min-h-[calc(100vh-3rem)] xl:min-h-[calc(100vh-4rem)]">
            <TVHeader
              selectedDate={selectedDateObj}
              sessionKey={sessionKey}
              type={sessionHeaderBits.type}
              style={sessionHeaderBits.style}
              extra={sessionHeaderBits.extra}
              title={displayTitle}
              subtitle={displaySubtitle}
            />

            <section className="grid min-h-0 gap-4 xl:grid-cols-[minmax(390px,0.88fr)_minmax(620px,1.42fr)] 2xl:grid-cols-[minmax(440px,0.82fr)_minmax(760px,1.55fr)]">
              <div className="relative min-h-0 overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(21,19,17,0.94),rgba(8,8,8,0.96))] p-5 shadow-[0_26px_90px_rgba(0,0,0,0.50)] xl:p-7">
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-teal-300/70 to-transparent" />
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-[11px] font-black uppercase tracking-[0.34em] text-white/34">
                      Zero Alpha Made
                    </div>
                    <h1 className="mt-3 max-w-[12ch] font-heading text-[3.35rem] uppercase leading-[0.92] text-white md:text-[4.7rem] xl:text-[4.4rem] 2xl:text-[5.8rem]">
                      Zero Alpha Fit.
                    </h1>
                  </div>
                  <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.05] text-white/70">
                    <MonitorPlay className="h-7 w-7" />
                  </div>
                </div>

                <div className="mt-5 xl:mt-8">
                  {wod.sessionType === "HYROX" ? (
                    timerMode === "timed" ? (
                      roundDurationSeconds && rounds ? (
                        <RoundTimer
                          roundDurationSeconds={roundDurationSeconds}
                          rounds={rounds}
                          restBetweenRoundsSeconds={restBetweenRoundsSeconds}
                        />
                      ) : (
                        <TimerEmptyState />
                      )
                    ) : (
                      <ControlStationHero
                        controlIndex={controlStationIndex}
                        total={stationCount}
                        controlName={controlStationTitle}
                      />
                    )
                  ) : (
                    <StrengthOverview
                      title={strengthTitle}
                      movements={wod.strengthMovements || []}
                      goal={wod?.strengthGoal}
                      load={wod?.strengthLoad}
                      range={wod?.strengthRange}
                      cue={wod?.strengthCue}
                    />
                  )}
                </div>
              </div>

              <div className="relative min-h-0 overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(15,14,13,0.92),rgba(4,4,4,0.94))] p-5 shadow-[0_26px_90px_rgba(0,0,0,0.46)] xl:p-7">
                <div className="absolute inset-y-8 left-0 w-px bg-gradient-to-b from-transparent via-white/18 to-transparent" />
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <div className="text-[11px] font-black uppercase tracking-[0.34em] text-teal-100/75">
                      Workout Board
                    </div>
                    <h2 className="mt-2 font-heading text-5xl uppercase leading-none text-white md:text-6xl xl:text-7xl">
                      {wod.sessionType === "Strength" ? strengthTitle : "Session Plan"}
                    </h2>
                  </div>
                  <div className="shrink-0 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-right">
                    <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/34">
                      Floor
                    </div>
                    <div className="mt-1 text-xl font-black uppercase text-white">{boardCountLabel}</div>
                  </div>
                </div>

                <div className="mt-5 min-h-0 overflow-hidden xl:mt-7">
                  {wod.sessionType === "Strength" ? (
                    <div className="grid max-h-full grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
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
                    <div className="grid max-h-full grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {stations.map((s: Station, index: number) => {
                        const isControl =
                          timerMode === "stationControlled" &&
                          controlStationIndex != null &&
                          index === controlStationIndex;

                        return (
                          <HyroxStationCard
                            key={s.id ?? index}
                            index={index}
                            station={s}
                            isControl={isControl}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </section>

            <div className="flex items-center justify-between gap-5 rounded-[22px] border border-white/10 bg-black/70 px-5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <div className="min-w-0 truncate text-base font-semibold text-white/74 xl:text-xl">
                {footerNote}
              </div>
              <div className="shrink-0 text-[11px] font-black uppercase tracking-[0.35em] text-white/30">
                AlphaFIT TV Mode
              </div>
            </div>
          </div>
        )}
      </main>
      {sharePayload ? (
        <SessionShareModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          title={sharePayload.title}
          subtitle={sharePayload.subtitle}
          filename={sharePayload.filename}
          shareTitle={sharePayload.shareTitle}
          shareText={sharePayload.shareText}
          dateLabel={sharePayload.dateLabel}
          sessionLabel={sharePayload.sessionLabel}
          sessionTimeLabel={sharePayload.sessionTimeLabel}
          sessionType={sharePayload.sessionType}
          sessionStyle={sharePayload.sessionStyle}
          sessionExtra={sharePayload.sessionExtra}
          highlight={sharePayload.highlight}
          highlightLabel={sharePayload.highlightLabel}
          stationsLabel={sharePayload.stationsLabel}
          coachNote={sharePayload.coachNote}
          items={sharePayload.items}
        />
      ) : null}
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
  title,
  subtitle,
}: {
  selectedDate: Date | null;
  sessionKey: SessionKey;
  type: string;
  style: string;
  extra: string;
  title: string;
  subtitle: string;
}) {
  return (
    <header className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(18,18,18,0.90),rgba(5,5,5,0.88))] px-5 py-4 shadow-[0_24px_80px_rgba(0,0,0,0.40)] xl:px-7">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-teal-500/0 via-teal-200/85 to-teal-500/0" />
      <div className="flex items-center justify-between gap-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3 text-[11px] font-black uppercase tracking-[0.28em] text-white/44">
            <span>
              {selectedDate
                ? selectedDate.toLocaleDateString("en-GB", {
                    weekday: "long",
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })
                : "—"}
            </span>
            <span className="h-1 w-1 rounded-full bg-teal-200/75" />
            <span>{sessionKey}</span>
            <span className="h-1 w-1 rounded-full bg-teal-200/75" />
            <span>{type}</span>
            <span className="h-1 w-1 rounded-full bg-teal-200/75" />
            <span>{style}</span>
            <span className="hidden xl:inline">{extra}</span>
          </div>
          <div className="mt-2 flex min-w-0 items-end gap-5">
            <h1 className="truncate font-heading text-5xl uppercase leading-none text-white md:text-6xl xl:text-7xl">
              {title}
            </h1>
            <div className="hidden pb-2 text-2xl font-bold uppercase italic text-white/54 lg:block">
              {subtitle}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3 rounded-2xl border border-teal-200/25 bg-teal-400/10 px-4 py-3">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-200 opacity-60" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-teal-300" />
          </span>
          <span className="text-sm font-black uppercase tracking-[0.28em] text-teal-50">Live</span>
        </div>
      </div>
    </header>
  );
}

function AdminControls({
  controlsOpen,
  setControlsOpen,
  selectedDate,
  handleDateChange,
  sessionKey,
  setSessionKey,
  canShare,
  onShare,
}: {
  controlsOpen: boolean;
  setControlsOpen: (open: boolean) => void;
  selectedDate: string;
  handleDateChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  sessionKey: SessionKey;
  setSessionKey: (key: SessionKey) => void;
  canShare: boolean;
  onShare: () => void;
}) {
  return (
    <div className="fixed left-4 top-4 z-50">
      <div className="flex items-center gap-2">
        <Link
          to="/dashboard"
          className="inline-grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-black/70 text-white/70 opacity-20 shadow-[0_18px_55px_rgba(0,0,0,0.42)] backdrop-blur-xl transition hover:border-white/20 hover:text-white hover:opacity-100 focus:opacity-100"
          aria-label="Back to dashboard"
        >
          <Home className="h-5 w-5" />
        </Link>
        <button
          type="button"
          onClick={() => setControlsOpen(!controlsOpen)}
          className="inline-grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-black/70 text-white/70 opacity-20 shadow-[0_18px_55px_rgba(0,0,0,0.42)] backdrop-blur-xl transition hover:border-white/20 hover:text-white hover:opacity-100 focus:opacity-100"
          aria-label="Toggle TV controls"
        >
          <Settings2 className="h-5 w-5" />
        </button>
      </div>

      {controlsOpen ? (
        <div className="mt-3 w-[min(92vw,560px)] rounded-[24px] border border-white/12 bg-[#080807]/95 p-3 shadow-[0_24px_90px_rgba(0,0,0,0.58)] backdrop-blur-xl">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={selectedDate}
              onChange={handleDateChange}
              className="h-11 rounded-2xl border border-white/12 bg-white/[0.06] px-3 text-sm font-semibold text-white outline-none"
            />
            <SessionButton active={sessionKey === "AM"} onClick={() => setSessionKey("AM")}>
              AM <Sun className="h-4 w-4" />
            </SessionButton>
            <SessionButton active={sessionKey === "930AM"} onClick={() => setSessionKey("930AM")}>
              9:30AM
            </SessionButton>
            <SessionButton active={sessionKey === "PM"} onClick={() => setSessionKey("PM")}>
              PM <Moon className="h-4 w-4" />
            </SessionButton>
            {canShare ? (
              <button
                type="button"
                onClick={onShare}
                className="ml-auto inline-flex h-11 items-center gap-2 rounded-2xl border border-white/12 bg-white/[0.06] px-4 text-sm font-bold text-white transition hover:bg-white/[0.10]"
              >
                <Share className="h-4 w-4" />
                Share
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SessionButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-11 items-center gap-2 rounded-2xl border px-4 text-sm font-black uppercase tracking-[0.12em] transition ${
        active
          ? "border-white bg-white text-black"
          : "border-white/12 bg-white/[0.05] text-white/70 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function DisplayState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="m-auto w-full max-w-2xl rounded-[30px] border border-white/10 bg-[#11100f]/92 p-10 text-center shadow-[0_28px_90px_rgba(0,0,0,0.48)]">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-white/10 bg-white/[0.05] text-white/64">
        <MonitorPlay className="h-8 w-8" />
      </div>
      <h1 className="mt-6 font-heading text-5xl uppercase text-white">{title}</h1>
      <p className="mt-3 text-lg font-medium text-white/56">{detail}</p>
    </div>
  );
}

function TimerEmptyState() {
  return (
    <div className="rounded-[26px] border border-white/10 bg-white/[0.04] p-7">
      <div className="text-[11px] font-black uppercase tracking-[0.34em] text-teal-100/75">
        Timer not configured
      </div>
      <div className="mt-4 font-heading text-5xl uppercase leading-none text-white">
        Set round time
      </div>
      <div className="mt-3 text-base font-medium text-white/54">
        Add minutes, seconds, and rounds in the editor.
      </div>
    </div>
  );
}

/* ------------------------- Generic UI ------------------------- */

function MetaPill({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-[18px] border border-white/10 bg-white/[0.045] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]">
      <div className="text-[10px] font-black uppercase tracking-[0.26em] text-white/34">{label}</div>
      <div className="mt-1 truncate text-xl font-black text-white">{value || "—"}</div>
    </div>
  );
}

/**
 * NEW: HYROX station card that shows movements inside the station
 */
function HyroxStationCard({
  index,
  station,
  isControl,
}: {
  index: number;
  station: Station;
  isControl: boolean;
}) {
  const border = isControl
    ? "border-teal-200/70 shadow-[0_0_44px_rgba(45,212,191,0.18)]"
    : "border-white/10";

  const badge = isControl ? "text-teal-100" : "text-teal-100/75";
  const iconColor = isControl ? "text-teal-100" : "text-teal-200";

  const title = (station.title || `Station ${index + 1}`).trim();
  const movements = (station.movements || []).filter((m) => String(m?.name ?? "").trim().length > 0);

  return (
    <div className={`relative min-h-[168px] overflow-hidden rounded-[22px] border ${border} bg-[linear-gradient(180deg,rgba(255,255,255,0.055),rgba(255,255,255,0.025))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]`}>
      <div className="absolute -right-3 -top-6 font-heading text-[8rem] leading-none text-white/[0.035]">
        {String(index + 1).padStart(2, "0")}
      </div>
      <div className="relative flex items-start gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-[18px] border border-white/12 bg-black/42">
          <Flame className={`h-6 w-6 ${iconColor}`} />
        </div>

        <div className="min-w-0 w-full">
          <div className="text-[11px] font-black uppercase tracking-[0.26em] text-white/34">
            Station {index + 1}
          </div>

          <div className="mt-1 line-clamp-2 text-2xl font-black uppercase leading-[1.02] text-white xl:text-[1.7rem]">
            {title}
          </div>

          {isControl ? <div className={`mt-2 text-xs font-black uppercase tracking-[0.22em] ${badge}`}>Control Station</div> : null}

          <div className="mt-3 space-y-2">
            {movements.length ? (
              movements.slice(0, 3).map((m, i) => {
                const name = String(m.name ?? "").trim();
                const target = String(m.target ?? "").trim();
                const notes = String(m.notes ?? "").trim();

                return (
                  <div key={m.id ?? i} className="border-t border-white/8 pt-2 first:border-t-0 first:pt-0">
                    <div className="line-clamp-1 text-base font-bold leading-tight text-white/86 xl:text-lg">
                      {name || "—"}
                    </div>
                    {(target || notes) ? (
                      <div className="mt-1 line-clamp-1 text-xs font-semibold uppercase tracking-[0.08em] text-white/42">
                        {target ? <span className="mr-2">Target: {target}</span> : null}
                        {notes ? <span>• {notes}</span> : null}
                      </div>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <div className="text-sm font-semibold text-white/42">No movements added.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------- Strength ------------------------- */

function StrengthOverview({
  title,
  movements,
  goal,
  load,
  range,
  cue,
}: {
  title: string;
  movements: any[];
  goal?: string;
  load?: string;
  range?: string;
  cue?: string;
}) {
  const goalText = (goal ?? "Quality reps").trim() || "Quality reps";
  const loadText = (load ?? "% of 1RM").trim() || "% of 1RM";
  const rangeText = (range ?? "Hit target reps").trim() || "Hit target reps";
  const cueText = (cue ?? "").trim();

  return (
    <div className="w-full rounded-[26px] border border-white/10 bg-white/[0.04] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]">
      <div className="text-[11px] font-black uppercase tracking-[0.34em] text-teal-100/75">
        Strength Block
      </div>
      <div className="mt-3 font-heading text-[4.4rem] uppercase leading-none text-white xl:text-[5.6rem]">{title}</div>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <MetaPill label="Stations" value={`${movements.length || 0}`} />
        <MetaPill label="Goal" value={goalText} />
        <MetaPill label="Load" value={loadText} />
        <MetaPill label="Range" value={rangeText} />
      </div>

      {cueText ? (
        <div className="mt-5 rounded-[20px] border border-teal-200/16 bg-teal-400/[0.055] p-4">
          <div className="text-[11px] font-black uppercase tracking-[0.24em] text-teal-50/60">Coaches Notes</div>
          <div className="mt-2 whitespace-pre-wrap text-base font-semibold leading-6 text-white/70">
            {cueText}
          </div>
        </div>
      ) : null}
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
    <div className="relative min-h-[150px] overflow-hidden rounded-[22px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.055),rgba(255,255,255,0.025))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
      <div className="absolute -right-3 -top-6 font-heading text-[8rem] leading-none text-white/[0.035]">
        {String(index + 1).padStart(2, "0")}
      </div>
      <div className="relative flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] font-black uppercase tracking-[0.26em] text-white/34">
            Station {index + 1}
          </div>

          <div className="mt-2 line-clamp-2 text-3xl font-black uppercase leading-[1.02] text-white">
            {movement || "—"}
          </div>

          <div className="mt-4 text-xl font-black uppercase tracking-[0.06em] text-teal-50/84">
            {pct ? `${pct}` : "—"}
            {rr ? ` • ${rr}` : ""}
          </div>
        </div>

        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-[18px] border border-white/12 bg-black/42">
          <Dumbbell className="h-6 w-6 text-teal-100" />
        </div>
      </div>
    </div>
  );
}

/* ------------------------- HYROX - Station Controlled (no ring) ------------------------- */

function ControlStationHero({
  controlIndex,
  total,
  controlName,
}: {
  controlIndex: number | null;
  total: number;
  controlName: string | null;
}) {
  const has = controlIndex != null && total > 0 && !!controlName;

  return (
    <div className="relative overflow-hidden rounded-[26px] border border-teal-200/50 bg-teal-400/[0.055] p-6 shadow-[0_0_54px_rgba(45,212,191,0.12),inset_0_1px_0_rgba(255,255,255,0.06)]">
      <div className="absolute -right-8 top-0 font-heading text-[14rem] leading-none text-teal-50/[0.04]">
        {has ? String(controlIndex! + 1).padStart(2, "0") : "00"}
      </div>
      <div className="relative flex items-center justify-between">
        <div className="text-[11px] font-black uppercase tracking-[0.34em] text-teal-100">
          Control Station
        </div>
        <div className="text-[11px] font-black uppercase tracking-[0.25em] text-white/46">
          STATION CONTROL
        </div>
      </div>

      <div className="relative mt-7">
        <div className="font-heading text-[8rem] uppercase leading-[0.84] text-white xl:text-[9.5rem]">
          {has ? `${controlIndex! + 1}/${total}` : "—"}
        </div>
        <div className="mt-5 text-4xl font-black uppercase leading-tight text-white/92">
          {has ? controlName : "Pick a control station in the editor"}
        </div>
        <div className="mt-6 rounded-[20px] border border-white/10 bg-black/30 p-4">
          <div className="text-lg font-black uppercase text-white/80">Pace setter</div>
          <div className="mt-1 text-base font-semibold leading-6 text-white/54">
            Move on when the group completes the target here.
          </div>
        </div>
      </div>
    </div>
  );
}

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
      ? "text-teal-50"
      : phase === "REST"
      ? "text-white"
      : "text-teal-100";
  const ringColor =
    phase === "WORK"
      ? "rgba(45,212,191,0.95)"
      : phase === "REST"
      ? "rgba(255,255,255,0.92)"
      : "rgba(153,246,228,0.94)";
  const glowColor =
    phase === "WORK"
      ? "rgba(45,212,191,0.24)"
      : phase === "REST"
      ? "rgba(255,255,255,0.18)"
      : "rgba(153,246,228,0.20)";
  const isUrgent = isRunning && phase !== "FINISHED" && remaining <= 10;

  return (
    <div className="flex flex-col items-center justify-center gap-6">
      <div
        className={`relative flex items-center justify-center rounded-full ${isUrgent ? "animate-pulse" : ""}`}
        style={{ filter: `drop-shadow(0 0 38px ${glowColor})` }}
      >
        <Ring progress={progress} size={340} stroke={18} color={ringColor} />

        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-auto">
          <div className="font-heading text-[5.9rem] leading-[0.84] tracking-normal text-white xl:text-[6.4rem]">
            {formatSeconds(remaining)}
          </div>

          <div className={`mt-4 text-sm font-black uppercase tracking-[0.32em] ${labelColor}`}>
            {label}{phase !== "FINISHED" ? (isRunning ? "" : " Paused") : ""}
          </div>

          <div className="mt-5 rounded-full border border-white/10 bg-white/[0.05] px-5 py-2 text-sm font-black uppercase tracking-[0.2em] text-white/78">
            Round {Math.min(roundIndex, safeRounds)} / {safeRounds}
          </div>
        </div>
      </div>

      <div className="w-full max-w-[420px]">
        <div className="mb-3 flex items-center justify-between text-[10px] font-black uppercase tracking-[0.24em] text-white/34">
          <span>{phase === "REST" ? "Rest progress" : "Work progress"}</span>
          <span>{Math.round(progress * 100)}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${progress * 100}%`, backgroundColor: ringColor }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        {!isRunning ? (
          <button
            type="button"
            onClick={startOrResume}
            className="h-11 rounded-2xl border border-white bg-white px-5 text-xs font-black uppercase tracking-[0.2em] text-black"
          >
            {elapsedInPhase === 0 && phase === "WORK" && roundIndex === 1 ? "Start" : "Resume"}
          </button>
        ) : (
          <button
            type="button"
            onClick={pause}
            className="h-11 rounded-2xl border border-white/12 bg-white/[0.05] px-5 text-xs font-black uppercase tracking-[0.2em] text-white/84 hover:text-white"
          >
            Pause
          </button>
        )}

        <button
          type="button"
          onClick={advanceToNext}
          disabled={phase === "FINISHED"}
          className={`h-11 rounded-2xl border border-white/12 px-5 text-xs font-black uppercase tracking-[0.2em] ${
            phase === "FINISHED"
              ? "cursor-not-allowed bg-white/[0.025] text-white/25"
              : "bg-white/[0.05] text-white/78 hover:text-white"
          }`}
        >
          Next round
        </button>

        <button
          type="button"
          onClick={resetToStart}
          className="h-11 rounded-2xl border border-white/12 bg-white/[0.035] px-5 text-xs font-black uppercase tracking-[0.2em] text-white/54 hover:text-white"
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
  color,
}: {
  progress: number;
  size: number;
  stroke: number;
  color: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(1, Math.max(0, progress));
  const offset = c * (1 - clamped);

  return (
    <svg
      width={size}
      height={size}
      className="pointer-events-none"
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
        stroke={color}
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

/* ------------------------- Helpers ------------------------- */

function formatSeconds(total: number) {
  const s = Math.max(0, Math.floor(total));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function parseDurationToSeconds(duration: any): number | null {
  if (!duration || typeof duration !== "string") return null;
  const s = duration.trim();
  if (!s) return null;

  // supports "MM:SS"
  const parts = s.split(":").map((p) => p.trim());
  if (parts.length === 2) {
    const mm = Number(parts[0]);
    const ss = Number(parts[1]);
    if (Number.isFinite(mm) && Number.isFinite(ss)) return mm * 60 + ss;
  }

  // supports "12m", "45s", "12m30s"
  const m = s.match(/(\d+)\s*m/i);
  const sec = s.match(/(\d+)\s*s/i);
  const mins = m ? Number(m[1]) : 0;
  const secs = sec ? Number(sec[1]) : 0;
  const total = mins * 60 + secs;
  return total > 0 ? total : null;
}

function normalizeMovements(raw: any): string[] {
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

function normalizeStations(rawStations: any, rawMovements: any): Station[] {
  // Preferred: stations[] exists
  if (Array.isArray(rawStations) && rawStations.length) {
    const stations: Station[] = rawStations.map((s: any, i: number) => {
      const title = String(s?.title ?? `Station ${i + 1}`).trim();
      const rawMs = Array.isArray(s?.movements) ? s.movements : [];

      const movements: Movement[] = rawMs
        .map((m: any) => ({
          id: m?.id,
          name: String(m?.name ?? "").trim(),
          target: String(m?.target ?? "").trim() || undefined,
          notes: String(m?.notes ?? "").trim() || undefined,
        }))
        .filter((m: { name: string | any[]; target: any; notes: any; }) => m.name.length > 0 || m.target || m.notes);

      return {
        id: s?.id,
        title: title || `Station ${i + 1}`,
        movements,
      };
    });

    // Ensure at least 1 station
    return stations.length ? stations : [{ title: "Station 1", movements: [] }];
  }

  // Legacy fallback: movements: string[]
  const legacy = normalizeMovements(rawMovements);
  if (legacy.length) {
    return [
      {
        title: "Station 1",
        movements: legacy.map((name) => ({ name })),
      },
    ];
  }

  // Default
  return [{ title: "Station 1", movements: [] }];
}

function getSessionTimeLabel(sessionKey: SessionKey) {
  if (sessionKey === "AM") return "6AM";
  if (sessionKey === "PM") return "6PM";
  return "9:30AM";
}
