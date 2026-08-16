import React from "react";
import {
  ConditioningBlock,
  SessionBlock,
  StrengthBlock,
  conditioningTiming,
} from "../../utils/programming";
import { RoundTimer, useRoundTimer } from "../../hooks/useRoundTimer";

/** Status is carried by text first; colour only reinforces it. */
const STATUS_TONE: Record<RoundTimer["status"], string> = {
  WORK: "text-[var(--zaf-accent)]",
  REST: "text-[var(--zaf-text)]",
  PAUSED: "text-[var(--zaf-text-dim)]",
  COMPLETE: "text-[var(--zaf-accent-soft)]",
};

const RING_TONE: Record<RoundTimer["status"], string> = {
  WORK: "var(--zaf-accent)",
  REST: "rgba(244,244,244,0.72)",
  PAUSED: "rgba(244,244,244,0.34)",
  COMPLETE: "var(--zaf-accent-soft)",
};

export function formatSeconds(total: number) {
  const seconds = Math.max(0, Math.floor(total));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/* ------------------------------ panel chrome ------------------------------ */

function Panel({
  kicker,
  children,
}: {
  kicker: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={kicker}
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden border border-[var(--zaf-line-strong)] bg-[var(--zaf-panel)]"
      style={{
        backgroundImage:
          "linear-gradient(180deg, rgba(244,244,244,0.05), transparent 38%)",
      }}
    >
      <div className="flex shrink-0 items-center gap-[0.8em] border-b border-[var(--zaf-line)] px-[clamp(0.75rem,1.1vw,2rem)] py-[clamp(0.4rem,0.6vw,1.1rem)] font-body text-[clamp(0.8rem,0.9vw,1.6rem)] font-black uppercase leading-none tracking-[0.28em] text-[var(--zaf-text-faint)]">
        <span
          aria-hidden="true"
          className="h-px w-[2.5em] shrink-0 bg-[var(--zaf-accent)]/70"
        />
        {kicker}
      </div>
      {children}
    </section>
  );
}

function Meter({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);

  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 font-body text-[clamp(0.8rem,0.92vw,1.65rem)] font-black uppercase leading-none tracking-[0.2em] text-[var(--zaf-text-faint)]">
        <span className="truncate">{label}</span>
        <span className="shrink-0 tabular-nums text-[var(--zaf-text-dim)]">
          {pct}%
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="mt-[0.5em] h-[clamp(0.25rem,0.3vw,0.6rem)] overflow-hidden bg-[var(--zaf-sunken)]"
      >
        <div
          className="zaf-meter-fill h-full"
          style={{ width: `${pct}%`, backgroundColor: tone }}
        />
      </div>
    </div>
  );
}

/**
 * Ring and digits share one viewBox, so the countdown is always sized off the
 * ring rather than the viewport — it can never outgrow the circle, at 1366 or
 * at 4K.
 */
function TimerDial({
  progress,
  tone,
  urgent,
  time,
}: {
  progress: number;
  tone: string;
  urgent: boolean;
  time: string;
}) {
  const stroke = 3.2;
  const radius = 50 - stroke / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(1, Math.max(0, progress));

  return (
    <svg
      viewBox="0 0 100 100"
      role="img"
      aria-label={`${time} remaining`}
      className="pointer-events-none h-full w-full"
    >
      <circle
        cx="50"
        cy="50"
        r={radius}
        fill="none"
        stroke="rgba(244,244,244,0.08)"
        strokeWidth={stroke}
      />
      <circle
        cx="50"
        cy="50"
        r={radius}
        fill="none"
        stroke={tone}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - clamped)}
        transform="rotate(-90 50 50)"
        className={`zaf-ring-sweep ${urgent ? "zaf-urgent" : ""}`}
      />
      <text
        x="50"
        y="50"
        textAnchor="middle"
        dominantBaseline="central"
        fill="var(--zaf-text)"
        className="font-heading [font-size:29px]"
      >
        {time}
      </text>
    </svg>
  );
}

function ControlButton({
  onClick,
  children,
  variant = "ghost",
  disabled,
}: {
  onClick: () => void;
  children: React.ReactNode;
  variant?: "primary" | "ghost";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "min-w-0 truncate border px-[clamp(0.5rem,0.7vw,1.25rem)] py-[clamp(0.4rem,0.55vw,1rem)] font-body text-[clamp(0.8rem,0.92vw,1.65rem)] font-black uppercase leading-none tracking-[0.16em] transition-colors duration-200",
        disabled
          ? "cursor-not-allowed border-[var(--zaf-line)] bg-transparent text-[var(--zaf-text-faint)]/50"
          : variant === "primary"
          ? "border-[var(--zaf-accent)] bg-[var(--zaf-accent)] text-[#050505] hover:bg-[var(--zaf-accent-soft)]"
          : "border-[var(--zaf-line-strong)] bg-[var(--zaf-sunken)] text-[var(--zaf-text-dim)] hover:text-[var(--zaf-text)]",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/* ------------------------------ timed rounds ------------------------------ */

function RoundTimerView({
  block,
  onRunningChange,
}: {
  block: ConditioningBlock;
  onRunningChange: (running: boolean) => void;
}) {
  const timing = conditioningTiming(block);
  const timer = useRoundTimer({
    roundDurationSeconds: timing.roundDurationSeconds,
    rounds: timing.rounds,
    restBetweenRoundsSeconds: timing.rest,
    onRunningChange,
  });

  const tone = RING_TONE[timer.status];

  return (
    <Panel kicker="Live timer">
      <div className="flex min-h-0 flex-1 flex-col gap-[clamp(0.5rem,0.8vw,1.5rem)] p-[clamp(0.75rem,1.1vw,2rem)]">
        {/* Status reads as words first — never colour alone. */}
        <div className="flex shrink-0 items-baseline justify-between gap-3">
          <span
            key={timer.status}
            className={`zaf-state-in font-heading uppercase leading-[0.85] text-[clamp(1.5rem,2.6vw,5rem)] ${
              STATUS_TONE[timer.status]
            }`}
          >
            {timer.status}
          </span>
          <span className="shrink-0 font-body text-[clamp(0.8rem,0.95vw,1.75rem)] font-black uppercase leading-none tracking-[0.18em] text-[var(--zaf-text-dim)]">
            Round {timer.round} of {timer.totalRounds}
          </span>
        </div>

        {/* The dial absorbs whatever height is left: its viewBox letterboxes
            itself, so status, meters and controls never get squeezed out. */}
        <div className="min-h-[clamp(7rem,17vh,26rem)] flex-1">
          <TimerDial
            progress={timer.phaseProgress}
            tone={tone}
            urgent={timer.isUrgent}
            time={formatSeconds(timer.remaining)}
          />
        </div>

        <div className="grid shrink-0 gap-[clamp(0.4rem,0.6vw,1.1rem)]">
          <Meter
            label={timer.phase === "REST" ? "Rest" : "Round"}
            value={timer.phaseProgress}
            tone={tone}
          />
          <Meter
            label="Session"
            value={timer.sessionProgress}
            tone="rgba(244,244,244,0.42)"
          />
        </div>

        <div className="grid shrink-0 grid-cols-3 gap-[clamp(0.3rem,0.45vw,0.85rem)]">
          {timer.isRunning ? (
            <ControlButton onClick={timer.pause}>Pause</ControlButton>
          ) : (
            <ControlButton onClick={timer.start} variant="primary">
              {timer.isAtStart ? "Start" : "Resume"}
            </ControlButton>
          )}
          <ControlButton onClick={timer.advance} disabled={!timer.canAdvance}>
            Next round
          </ControlButton>
          <ControlButton onClick={timer.restart}>Restart</ControlButton>
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------ other block states ------------------------------ */

function ControlStationView({ block }: { block: ConditioningBlock }) {
  const total = block.stations.length;
  const name = block.stations[block.controlStationIndex]?.title?.trim() ?? "";
  const has = total > 0 && !!name;

  return (
    <Panel kicker="Station control">
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-[clamp(0.5rem,0.9vw,1.75rem)] p-[clamp(0.75rem,1.1vw,2rem)]">
        <span className="font-heading uppercase leading-[0.85] text-[var(--zaf-accent)] text-[clamp(1.5rem,2.6vw,5rem)]">
          Pace setter
        </span>

        <div className="font-heading leading-[0.82] tabular-nums text-[var(--zaf-text)] text-[clamp(3rem,7.5vw,14rem)]">
          {has ? `${block.controlStationIndex + 1}/${total}` : "—"}
        </div>

        <div className="font-heading uppercase leading-[0.95] text-[var(--zaf-text)] text-[clamp(1.25rem,2.2vw,4.25rem)]">
          {has ? name : "Pick a control station in the editor"}
        </div>

        <p className="border-t border-[var(--zaf-line)] pt-[clamp(0.4rem,0.6vw,1.1rem)] font-body text-[clamp(0.85rem,1vw,1.85rem)] font-bold leading-snug text-[var(--zaf-text-dim)]">
          Move on when the group completes the target here.
        </p>
      </div>
    </Panel>
  );
}

function StatLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-t border-[var(--zaf-line)] pt-[clamp(0.3rem,0.45vw,0.8rem)]">
      <div className="font-body text-[clamp(0.8rem,0.92vw,1.65rem)] font-black uppercase leading-none tracking-[0.2em] text-[var(--zaf-text-faint)]">
        {label}
      </div>
      <div className="mt-[0.35em] truncate font-heading uppercase leading-none text-[var(--zaf-text)] text-[clamp(1.1rem,1.5vw,2.9rem)]">
        {value}
      </div>
    </div>
  );
}

function StrengthView({
  block,
  fallbackTitle,
}: {
  block: StrengthBlock;
  fallbackTitle: string;
}) {
  return (
    <Panel kicker="Strength block">
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-[clamp(0.5rem,0.9vw,1.75rem)] p-[clamp(0.75rem,1.1vw,2rem)]">
        <div className="font-heading uppercase leading-[0.84] text-[var(--zaf-text)] text-[clamp(2rem,4.2vw,8rem)]">
          {block.title.trim() || fallbackTitle}
        </div>

        <div className="grid gap-[clamp(0.35rem,0.55vw,1rem)]">
          <StatLine label="Stations" value={`${block.stations.length}`} />
          <StatLine label="Goal" value={block.goal.trim() || "Quality reps"} />
          <StatLine label="Load" value={block.load.trim() || "% of 1RM"} />
          <StatLine
            label="Range"
            value={block.range.trim() || "Hit target reps"}
          />
        </div>
      </div>
    </Panel>
  );
}

function MessageView({
  kicker,
  title,
  detail,
}: {
  kicker: string;
  title: string;
  detail: string;
}) {
  return (
    <Panel kicker={kicker}>
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-[clamp(0.5rem,0.8vw,1.5rem)] p-[clamp(0.75rem,1.1vw,2rem)]">
        <div className="font-heading uppercase leading-[0.86] text-[var(--zaf-text)] text-[clamp(1.75rem,3.4vw,6.5rem)]">
          {title}
        </div>
        <p className="font-body text-[clamp(0.85rem,1vw,1.85rem)] font-bold leading-snug text-[var(--zaf-text-dim)]">
          {detail}
        </p>
      </div>
    </Panel>
  );
}

/**
 * Warm-up, finisher, cooldown and notes have no clock, no rounds and no
 * stations — a live column for them could only repeat the block's own name back
 * at the floor, so the board runs those blocks full width instead.
 */
export function hasLivePanel(block: SessionBlock | null) {
  return !block || block.kind === "conditioning" || block.kind === "strength";
}

/**
 * Left column of the board: whatever the active block's live status is.
 *
 * A timed conditioning block gets the clock; strength gets its brief. Blocks
 * with nothing live to show render nothing — see `hasLivePanel`.
 */
export default function LiveTimerPanel({
  block,
  sessionTitle,
  strengthTitle,
  onRunningChange,
}: {
  block: SessionBlock | null;
  sessionTitle: string;
  strengthTitle: string;
  onRunningChange: (running: boolean) => void;
}) {
  if (!block) {
    return (
      <MessageView
        kicker="Session brief"
        title={sessionTitle}
        detail="Nothing programmed yet. Add blocks in the editor."
      />
    );
  }

  if (block.kind === "conditioning") {
    if (block.timerMode === "stationControlled") {
      return <ControlStationView block={block} />;
    }

    if (!conditioningTiming(block).roundDurationSeconds) {
      return (
        <MessageView
          kicker="Live timer"
          title="Set round time"
          detail="Add minutes, seconds, and rounds in the editor."
        />
      );
    }

    // Keyed on the block so moving between blocks never inherits a clock.
    return (
      <RoundTimerView
        key={block.id}
        block={block}
        onRunningChange={onRunningChange}
      />
    );
  }

  if (block.kind === "strength") {
    return <StrengthView block={block} fallbackTitle={strengthTitle} />;
  }

  return null;
}
