import { useCallback, useEffect, useMemo, useState } from "react";

export type TimerPhase = "WORK" | "REST" | "FINISHED";

/** Seconds left in the round below which the board flags the run-in. */
export const URGENT_SECONDS = 10;

export type RoundTimer = {
  phase: TimerPhase;
  /** 1-based, clamped to the configured round count. */
  round: number;
  totalRounds: number;
  isRunning: boolean;
  remaining: number;
  /** 0-1 through the current work or rest phase. */
  phaseProgress: number;
  /** 0-1 through the whole block, rests included. */
  sessionProgress: number;
  isUrgent: boolean;
  /** WORK / REST / PAUSED / COMPLETE — never colour alone. */
  status: "WORK" | "REST" | "PAUSED" | "COMPLETE";
  canAdvance: boolean;
  /** True before the clock has ever moved, so the button can read "Start". */
  isAtStart: boolean;
  start: () => void;
  pause: () => void;
  advance: () => void;
  restart: () => void;
};

/**
 * Round/rest clock for a conditioning block.
 *
 * Elapsed time is counted in the current phase rather than off a wall-clock
 * start stamp: the board is often paused mid-round by a coach, and phase-local
 * elapsed keeps pause/resume exact without any drift bookkeeping.
 */
export function useRoundTimer({
  roundDurationSeconds,
  rounds,
  restBetweenRoundsSeconds,
  onRunningChange,
}: {
  roundDurationSeconds: number;
  rounds: number;
  restBetweenRoundsSeconds: number;
  onRunningChange?: (running: boolean) => void;
}): RoundTimer {
  const safeRoundSeconds = Math.max(0, Math.floor(roundDurationSeconds || 0));
  const safeRounds = Math.max(1, Math.floor(rounds || 1));
  const safeRest = Math.max(0, Math.floor(restBetweenRoundsSeconds || 0));

  const [phase, setPhase] = useState<TimerPhase>("WORK");
  const [roundIndex, setRoundIndex] = useState<number>(1); // 1-based
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [elapsedInPhase, setElapsedInPhase] = useState<number>(0); // seconds

  useEffect(() => {
    if (!isRunning) return;

    const tick = setInterval(() => {
      setElapsedInPhase((elapsed) => elapsed + 1);
    }, 1000);

    return () => clearInterval(tick);
  }, [isRunning]);

  // Lets the board suspend auto-rotate while this clock is live, and release it
  // again when the timer stops or the block changes underneath us.
  useEffect(() => {
    onRunningChange?.(isRunning);
  }, [isRunning, onRunningChange]);

  useEffect(() => {
    return () => onRunningChange?.(false);
  }, [onRunningChange]);

  const phaseDuration =
    phase === "WORK" ? safeRoundSeconds : phase === "REST" ? safeRest : 0;

  const remaining =
    phase === "FINISHED"
      ? 0
      : Math.max(0, Math.floor(phaseDuration - elapsedInPhase));

  const phaseProgress =
    phaseDuration > 0
      ? Math.min(1, Math.max(0, elapsedInPhase / phaseDuration))
      : 0;

  const restart = useCallback(() => {
    setIsRunning(false);
    setPhase("WORK");
    setRoundIndex(1);
    setElapsedInPhase(0);
  }, []);

  const pause = useCallback(() => setIsRunning(false), []);

  const start = useCallback(() => {
    if (phase === "FINISHED") {
      // Starting a finished block restarts it.
      restart();
      setIsRunning(true);
      return;
    }

    setIsRunning(true);
  }, [phase, restart]);

  const advance = useCallback(() => {
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

      // No rest configured: straight into the next round's work.
      setRoundIndex((round) => round + 1);
      setPhase("WORK");
      setElapsedInPhase(0);
      return;
    }

    if (phase === "REST") {
      setRoundIndex((round) => round + 1);
      setPhase("WORK");
      setElapsedInPhase(0);
    }
  }, [phase, roundIndex, safeRest, safeRounds]);

  // Auto-advance only while running, so a paused board holds its phase.
  useEffect(() => {
    if (!isRunning) return;
    if (phase === "FINISHED") return;
    if (phaseDuration <= 0) return;
    if (elapsedInPhase < phaseDuration) return;

    advance();
  }, [advance, elapsedInPhase, isRunning, phase, phaseDuration]);

  const sessionProgress = useMemo(() => {
    const total = safeRoundSeconds * safeRounds + safeRest * (safeRounds - 1);
    if (total <= 0) return phase === "FINISHED" ? 1 : 0;
    if (phase === "FINISHED") return 1;

    const completedRounds = roundIndex - 1;
    const done =
      phase === "WORK"
        ? completedRounds * safeRoundSeconds + completedRounds * safeRest
        : roundIndex * safeRoundSeconds + completedRounds * safeRest;

    return Math.min(1, Math.max(0, (done + elapsedInPhase) / total));
  }, [
    elapsedInPhase,
    phase,
    roundIndex,
    safeRest,
    safeRoundSeconds,
    safeRounds,
  ]);

  const status =
    phase === "FINISHED" ? "COMPLETE" : isRunning ? phase : "PAUSED";

  return {
    phase,
    round: Math.min(roundIndex, safeRounds),
    totalRounds: safeRounds,
    isRunning,
    remaining,
    phaseProgress,
    sessionProgress,
    isUrgent: isRunning && phase !== "FINISHED" && remaining <= URGENT_SECONDS,
    status,
    canAdvance: phase !== "FINISHED",
    isAtStart: elapsedInPhase === 0 && phase === "WORK" && roundIndex === 1,
    start,
    pause,
    advance,
    restart,
  };
}
