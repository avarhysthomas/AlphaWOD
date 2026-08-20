import React, { useEffect, useMemo, useRef, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../../../firebase";
import { MonitorPlay } from "lucide-react";
import AttendeeRail from "../components/AttendeeRail";
import SessionShareModal from "../components/SessionShareModal";
import BlockRail from "../components/display/BlockRail";
import DisplayControls from "../components/display/DisplayControls";
import DisplayHeader from "../components/display/DisplayHeader";
import LiveTimerPanel, {
  formatSeconds,
  hasLivePanel,
} from "../components/display/LiveTimerPanel";
import SessionPlan from "../components/display/SessionPlan";
import { getDateInputValueInTimeZone, getHourInTimeZone } from "../../../utils/date";
import { formatStationForShare } from "../utils/sessionShare";
import { useFullscreen } from "../hooks/useFullscreen";
import { useSessionAttendees } from "../hooks/useSessionAttendees";
import { useWakeLock } from "../hooks/useWakeLock";
import {
  ConditioningBlock,
  SLOT_LABELS,
  SessionBlock,
  SessionPlan as SessionPlanType,
  SlotKey,
  StrengthBlock,
  normalizeSessionPlan,
  sessionShareItems,
  slotForHour,
} from "../utils/programming";

type TimerMode = "timed" | "stationControlled";

/** Seconds each block holds the board before auto-rotate moves on. */
const BLOCK_ROTATE_SECONDS = 18;

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
  const [dayDoc, setDayDoc] = useState<Record<string, any> | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [sessionKey, setSessionKey] = useState<SlotKey>(() =>
    slotForHour(getHourInTimeZone(new Date(), "Europe/London"))
  );
  const [loading, setLoading] = useState<boolean>(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [activeBlockIndex, setActiveBlockIndex] = useState(0);
  const [autoRotate, setAutoRotate] = useState(true);
  const [timerRunning, setTimerRunning] = useState(false);
  const dayCacheRef = useRef<Map<string, Record<string, any> | null>>(new Map());

  const { isFullscreen, toggle: toggleFullscreen, supported: fullscreenSupported } =
    useFullscreen();
  useWakeLock(true);

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

  useEffect(() => {
    setSelectedDate(getDateInputValueInTimeZone(new Date(), timeZone));
  }, []);

  /**
   * Watch the whole day document rather than fetching once: a board left running
   * on the TV has to pick up edits made in the editor mid-class. Switching
   * AM/9:30/PM then costs nothing, since all three slots live in this document.
   */
  useEffect(() => {
    if (!selectedDate) return;

    const cached = dayCacheRef.current.get(selectedDate);
    setDayDoc(cached ?? null);
    setLoading(!dayCacheRef.current.has(selectedDate));

    const unsubscribe = onSnapshot(
      doc(db, "wods", selectedDate),
      (snapshot) => {
        const data = snapshot.exists() ? (snapshot.data() as Record<string, any>) : null;
        dayCacheRef.current.set(selectedDate, data);
        setDayDoc(data);
        setLoading(false);
      },
      (error) => {
        console.error("Error watching WOD:", error);
        setDayDoc(null);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [selectedDate]);

  const wod = useMemo(
    () => (dayDoc ? dayDoc[sessionKey] ?? null : null),
    [dayDoc, sessionKey]
  );

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
   * Stations-aware normalization (with legacy fallback to old movements[]).
   * Feeds the share card only — the board itself reads the active block.
   */
  const stations: Station[] = useMemo(() => {
    return normalizeStations(wod?.stations, wod?.movements);
  }, [wod?.stations, wod?.movements]);

  const stationCount = stations.length;

  /** Block view of the session (works for both v2 and legacy payloads). */
  const plan: SessionPlanType = useMemo(() => normalizeSessionPlan(wod), [wod]);
  const planBlocks = plan.blocks;
  const primaryConditioning = useMemo(
    () =>
      planBlocks.find(
        (block): block is ConditioningBlock => block.kind === "conditioning"
      ) ?? null,
    [planBlocks]
  );
  const strengthBlock = useMemo(
    () =>
      planBlocks.find(
        (block): block is StrengthBlock => block.kind === "strength"
      ) ?? null,
    [planBlocks]
  );
  const isHybrid = Boolean(primaryConditioning && strengthBlock);
  const isMultiBlock = planBlocks.length > 1;
  const strengthStationCount = strengthBlock?.stations.length ?? 0;

  /**
   * The board shows one block at a time — timer panel and station grid stay in
   * step, so a multi-block session never overflows and every block gets a real
   * timer.
   */
  const blockSignature = useMemo(
    () => planBlocks.map((block) => block.id).join("|"),
    [planBlocks]
  );

  /** Open on the block that needs a clock, falling back to session order. */
  const defaultBlockIndex = useMemo(() => {
    const conditioning = planBlocks.findIndex((block) => block.kind === "conditioning");
    if (conditioning >= 0) return conditioning;
    const strength = planBlocks.findIndex((block) => block.kind === "strength");
    return strength >= 0 ? strength : 0;
  }, [planBlocks]);

  useEffect(() => {
    setActiveBlockIndex(defaultBlockIndex);
    // Re-anchor only when the programming itself changes, not on every snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockSignature]);

  const activeBlock: SessionBlock | null = planBlocks[activeBlockIndex] ?? null;
  const showLivePanel = hasLivePanel(activeBlock);

  // Rotate through blocks so an untouched TV shows the whole session, but never
  // pull the board away from a clock that is counting down.
  useEffect(() => {
    if (!autoRotate || timerRunning || planBlocks.length < 2) return;

    const id = setInterval(() => {
      setActiveBlockIndex((index) => (index + 1) % planBlocks.length);
    }, BLOCK_ROTATE_SECONDS * 1000);

    return () => clearInterval(id);
  }, [autoRotate, timerRunning, planBlocks.length, activeBlockIndex]);

  // Legacy flat fields below describe the session as a whole. The board reads
  // the active block instead; these remain for the share card.
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

  const sessionHeaderBits = useMemo(() => {
    if (!wod) return { type: "—", style: "—", extra: "—" };

    if (wod.sessionType === "HYROX") {
      const grp = groupSize ? `GROUP OF ${groupSize}` : "GROUP";
      const mode = timerMode === "timed" ? "TIMED" : "STATION CONTROL";
      return {
        type: isHybrid ? "HYBRID" : "HYROX",
        style: (wod.wodType ?? "—").toString().toUpperCase(),
        extra: `${grp} | ${mode}`,
      };
    }

    if (wod.sessionType === "Strength") {
      return {
        type: "STRENGTH",
        style: strengthTitle.toUpperCase(),
        extra: `${strengthStationCount || (wod?.strengthMovements?.length ?? 0)} STATIONS`,
      };
    }

    return { type: wod.sessionType ?? "—", style: wod.wodType ?? "—", extra: "—" };
  }, [wod, groupSize, timerMode, strengthTitle, isHybrid, strengthStationCount]);

  /**
   * What the screen is showing right now. Diverges from `sessionHeaderBits`
   * (which describes the whole session for the share card) once a session has
   * more than one block.
   */
  const boardHeaderBits = useMemo(() => {
    if (!wod) return { type: "—", style: "—", extra: "—" };

    const type = isHybrid
      ? "HYBRID"
      : primaryConditioning
      ? "HYROX"
      : strengthBlock
      ? "STRENGTH"
      : "SESSION";

    if (activeBlock?.kind === "conditioning") {
      const group =
        activeBlock.groupSize > 0 ? `GROUP OF ${activeBlock.groupSize}` : "GROUP";
      const mode = activeBlock.timerMode === "timed" ? "TIMED" : "STATION CONTROL";
      return { type, style: activeBlock.format.toUpperCase(), extra: `${group} | ${mode}` };
    }

    if (activeBlock?.kind === "strength") {
      return {
        type,
        style: "STRENGTH",
        extra: `${activeBlock.stations.length} STATIONS`,
      };
    }

    if (activeBlock) {
      // The board's own heading carries the block's name in full — the strip
      // only needs to say which kind of block is up.
      return {
        type,
        style: BLOCK_KIND_LABEL_FALLBACK(activeBlock),
        extra: "—",
      };
    }

    return sessionHeaderBits;
  }, [wod, activeBlock, isHybrid, primaryConditioning, strengthBlock, sessionHeaderBits]);

  const sessionTimeLabel = SLOT_LABELS[sessionKey];

  /** The one place the day is named, and the only session metadata strip. */
  const headerDateLabel = useMemo(() => {
    if (!selectedDateObj) return "—";
    return selectedDateObj.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  }, [selectedDateObj]);

  const headerMeta = useMemo(() => {
    if (!wod) return [];

    const items = [sessionTimeLabel, boardHeaderBits.type, boardHeaderBits.style];

    boardHeaderBits.extra.split("|").forEach((part) => items.push(part.trim()));

    if (isMultiBlock) {
      items.push(`Block ${activeBlockIndex + 1} / ${planBlocks.length}`);
    }

    // A block titled "Warm-up" would otherwise print its kind and its title as
    // two identical chips — metadata reads once or not at all.
    const seen = new Set<string>();

    return items
      .map((item) => String(item ?? "").trim())
      .filter((item) => {
        if (!item || item === "—") return false;
        const key = item.toUpperCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [
    activeBlockIndex,
    boardHeaderBits.extra,
    boardHeaderBits.style,
    boardHeaderBits.type,
    isMultiBlock,
    planBlocks.length,
    sessionTimeLabel,
    wod,
  ]);

  /**
   * One dominant heading. Falls back to the session type rather than the
   * weekday, which the date strip already carries.
   */
  const displayTitle = useMemo(() => {
    const named = String(wod?.wodName ?? "").trim();
    if (named) return named;
    if (wod?.sessionType === "Strength") return `${strengthTitle} Session`;

    const type = boardHeaderBits.type;
    return type && type !== "—" ? `${type} Session` : "Session";
  }, [boardHeaderBits.type, strengthTitle, wod?.sessionType, wod?.wodName]);

  const sharePayload = useMemo(() => {
    if (!wod || !selectedDateObj) return null;

    const dateLabel = selectedDateObj.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });

    if (wod.sessionType === "Strength") {
      const movements = Array.isArray(wod.strengthMovements) ? wod.strengthMovements : [];
      const items = isMultiBlock
        ? sessionShareItems(plan)
        : movements
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
        highlight: `${strengthStationCount || movements.length || 0}`,
        highlightLabel: "Stations",
        stationsLabel: `${strengthStationCount || movements.length || 0} strength stations`,
        coachNote: String(wod?.strengthCue ?? "").trim() || undefined,
        items,
      };
    }

    const items = isMultiBlock
      ? sessionShareItems(plan)
      : stations
          .map((station: Station, index: number) => {
            return formatStationForShare(station, index);
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
    isMultiBlock,
    plan,
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
    strengthStationCount,
    strengthTitle,
    timerMode,
    wod,
  ]);

  /** Everyone booked onto this date + slot, for the rail along the foot. */
  const attendees = useSessionAttendees(selectedDate, sessionKey);

  return (
    <div className="zaf-board relative flex h-screen flex-col overflow-hidden bg-[var(--zaf-bg)] font-body text-[var(--zaf-text)] [height:100dvh]">
      <div className="zaf-grid-texture pointer-events-none absolute inset-0" />

      {/* Watermark lives in genuine negative space behind the board. */}
      <img
        src="/ZERO-ALPHA.png"
        alt=""
        aria-hidden="true"
        draggable={false}
        className="pointer-events-none absolute -right-[8%] top-1/2 w-[46vw] -translate-y-1/2 select-none object-contain opacity-[0.028]"
      />

      <DisplayControls
        controlsOpen={controlsOpen}
        setControlsOpen={setControlsOpen}
        selectedDate={selectedDate}
        handleDateChange={handleDateChange}
        sessionKey={sessionKey}
        setSessionKey={setSessionKey}
        canShare={!!wod}
        onShare={() => setShareOpen(true)}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        fullscreenSupported={fullscreenSupported}
        autoRotate={autoRotate}
        onToggleAutoRotate={() => setAutoRotate((on) => !on)}
        canAutoRotate={planBlocks.length > 1}
      />

      {!selectedDate ? null : loading ? (
        <BoardMessage title="Loading session" detail="Pulling the latest board from Zero Alpha App." />
      ) : !wod ? (
        <BoardMessage
          title="No session found"
          detail="Open controls to choose a different date or class time."
        />
      ) : (
        <>
          <DisplayHeader
            title={displayTitle}
            dateLabel={headerDateLabel}
            meta={headerMeta}
            isLive={timerRunning}
          />

          <main
            className={[
              "relative z-10 grid min-h-0 flex-1 gap-[var(--zaf-gap)] p-[var(--zaf-inset)]",
              showLivePanel
                ? "grid-cols-[minmax(0,32fr)_minmax(0,68fr)]"
                : "grid-cols-1",
            ].join(" ")}
          >
            {showLivePanel ? (
              <div className="flex min-h-0 flex-col gap-[var(--zaf-gap)]">
                <LiveTimerPanel
                  block={activeBlock}
                  sessionTitle={displayTitle}
                  strengthTitle={strengthTitle}
                  onRunningChange={setTimerRunning}
                />

                {isMultiBlock ? (
                  <BlockRail
                    blocks={planBlocks}
                    activeIndex={activeBlockIndex}
                    onSelect={setActiveBlockIndex}
                  />
                ) : null}
              </div>
            ) : null}

            <div className="flex min-h-0 flex-col gap-[var(--zaf-gap)]">
              <SessionPlan block={activeBlock} showStrengthCue />

              {/* Without the left column the rail has nowhere else to live. */}
              {!showLivePanel && isMultiBlock ? (
                <BlockRail
                  blocks={planBlocks}
                  activeIndex={activeBlockIndex}
                  onSelect={setActiveBlockIndex}
                />
              ) : null}
            </div>
          </main>

          <AttendeeRail attendees={attendees} slotLabel={sessionTimeLabel} />
        </>
      )}

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

/* ------------------------- Board states ------------------------- */

function BoardMessage({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="relative z-10 grid min-h-0 flex-1 place-items-center p-[var(--zaf-inset)]">
      <div className="w-full max-w-2xl border border-[var(--zaf-line-strong)] bg-[var(--zaf-panel)] p-[clamp(1.5rem,3vw,4rem)] text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center border border-[var(--zaf-line-strong)] bg-[var(--zaf-sunken)] text-[var(--zaf-text-dim)]">
          <MonitorPlay className="h-8 w-8" />
        </div>
        <h1 className="mt-6 font-heading text-5xl uppercase text-[var(--zaf-text)]">{title}</h1>
        <p className="mt-3 text-lg font-medium text-[var(--zaf-text-dim)]">{detail}</p>
      </div>
    </div>
  );
}

/* ------------------------- Helpers ------------------------- */

function BLOCK_KIND_LABEL_FALLBACK(block: SessionBlock) {
  const labels: Record<SessionBlock["kind"], string> = {
    warmup: "WARM-UP",
    strength: "STRENGTH",
    conditioning: "CONDITIONING",
    finisher: "FINISHER",
    cooldown: "COOLDOWN",
    notes: "NOTES",
  };

  return labels[block.kind];
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
        .filter((m: { name: string | any[]; target: any; notes: any }) =>
          m.name.length > 0 || m.target || m.notes
        );

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
