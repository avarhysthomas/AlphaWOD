import React from "react";
import type { WorkoutSection, WorkoutSession } from "../types";
import { getPrimaryScoreLabel } from "../utils/workoutDisplay";

type WorkoutShareCardProps = {
  workout: WorkoutSession;
  saluteCount?: number;
};

function formatWorkoutType(type: WorkoutSession["type"]) {
  switch (type) {
    case "run":
      return "Cardio";
    case "strength":
      return "Strength";
    case "amrap":
      return "AMRAP";
    case "emom":
      return "EMOM";
    case "engine":
      return "Engine";
    case "class":
      return "Class";
    case "hybrid":
      return "Hybrid";
    default:
      return "Workout";
  }
}

function formatDateLabel(sessionDate: string) {
  if (!sessionDate) return "Date TBD";

  const value = new Date(`${sessionDate}T12:00:00`);
  if (Number.isNaN(value.getTime())) return sessionDate;

  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(value);
}

function sectionLabel(kind: WorkoutSection["kind"]) {
  switch (kind) {
    case "warmup":
      return "Warm-up";
    case "main":
      return "Main";
    case "finisher":
      return "Finisher";
    case "notes":
      return "Notes";
    default:
      return kind;
  }
}

function isQuickLog(workout: WorkoutSession) {
  const hasMovementEntries = workout.movementEntries.some((entry) =>
    entry.movementName.trim()
  );
  const hasSections = workout.sections.some((section) => section.text.trim());

  return !hasMovementEntries && !hasSections;
}

function buildStatRows(workout: WorkoutSession) {
  const quickLog = isQuickLog(workout);
  const rows = [
    workout.stats.score && !quickLog
      ? { label: getPrimaryScoreLabel(workout), value: workout.stats.score }
      : null,
    workout.stats.loadKg ? { label: "Load", value: `${workout.stats.loadKg} kg` } : null,
    workout.stats.reps ? { label: "Reps", value: workout.stats.reps } : null,
    workout.stats.distanceM ? { label: "Distance", value: `${workout.stats.distanceM} m` } : null,
    workout.stats.calories ? { label: "Calories", value: workout.stats.calories } : null,
    workout.stats.avgHeartRate ? { label: "Avg HR", value: `${workout.stats.avgHeartRate} bpm` } : null,
    workout.stats.area ? { label: "Details", value: workout.stats.area } : null,
    workout.stats.totalRounds ? { label: "Rounds", value: workout.stats.totalRounds } : null,
    workout.durationMin ? { label: "Duration", value: `${workout.durationMin} min` } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  return rows;
}

function buildMovementLines(workout: WorkoutSession) {
  return workout.movementEntries
    .filter((entry) => entry.movementName.trim())
    .map((entry) => {
      const details = [
        entry.loadKg ? `${entry.loadKg} kg` : "",
        entry.reps ? `${entry.reps} reps` : "",
        entry.sets ? `${entry.sets} sets` : "",
        !entry.loadKg && !entry.reps && !entry.sets && entry.value ? entry.value : "",
      ].filter(Boolean);

      return details.length
        ? `${entry.movementName} • ${details.join(" • ")}`
        : entry.movementName;
    });
}

function buildSectionLines(workout: WorkoutSession) {
  return workout.sections
    .filter((section) => section.text.trim())
    .map((section) => `${sectionLabel(section.kind)} • ${section.text.trim()}`);
}

export function getWorkoutShareCardHeight(
  workout: WorkoutSession,
  saluteCount = 0
) {
  const statRows = buildStatRows(workout).length;
  const movementRows = buildMovementLines(workout).length;
  const sectionRows = buildSectionLines(workout).length;
  const notesRows = workout.notes.trim() ? 1 : 0;
  const heroBump = workout.title.trim().length > 22 ? 56 : 0;
  const infoRows = statRows + movementRows + sectionRows + notesRows;

  return Math.max(720, 500 + heroBump + infoRows * 78 + (saluteCount ? 56 : 0));
}

function renderListCard(title: string, items: string[], accent: string) {
  if (!items.length) return null;

  return (
    <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/38">
        {title}
      </div>
      <div className="mt-4 space-y-3">
        {items.map((item, index) => (
          <div
            key={`${title}-${index}-${item}`}
            className="relative overflow-hidden rounded-[22px] border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.075),rgba(255,255,255,0.02))] px-4 py-3.5"
          >
            <div className={`absolute inset-y-0 left-0 w-[3px] ${accent}`} />
            <div className="pl-2 text-[15px] font-medium leading-6 text-white/82">
              {item}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function WorkoutShareCard({
  workout,
  saluteCount = 0,
}: WorkoutShareCardProps) {
  const dateLabel = formatDateLabel(workout.sessionDate);
  const typeLabel = formatWorkoutType(workout.type);
  const statRows = buildStatRows(workout);
  const movementLines = buildMovementLines(workout);
  const sectionLines = buildSectionLines(workout);
  const cardHeight = getWorkoutShareCardHeight(workout, saluteCount);

  return (
    <div
      className="relative w-[720px] overflow-hidden rounded-[40px] border border-white/12 p-10 shadow-[0_24px_60px_rgba(0,0,0,0.45)]"
      style={{
        minHeight: `${cardHeight}px`,
        background:
          "linear-gradient(180deg, rgba(14,14,16,0.96), rgba(6,6,8,0.98))",
      }}
    >
      <div className="absolute inset-0 rounded-[40px] bg-[linear-gradient(180deg,rgba(255,255,255,0.045),transparent_24%),radial-gradient(circle_at_top_right,rgba(245,158,11,0.12),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.10),transparent_34%)]" />

      <img
        src="/ZERO-ALPHA.png"
        alt=""
        aria-hidden="true"
        draggable={false}
        data-export-skip="true"
        className="pointer-events-none absolute left-1/2 top-[56%] h-[400px] w-[600px] -translate-x-1/2 -translate-y-1/2 select-none object-contain opacity-[0.2]"
      />

      <div className="relative">
        <div className="inline-flex w-fit items-center rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.2em] text-white/72">
          Workout Share
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/42">
          <span>{dateLabel}</span>
          <span className="text-white/20">|</span>
          <span>{typeLabel}</span>
          {workout.startTime ? (
            <>
              <span className="text-white/20">|</span>
              <span>{workout.startTime}</span>
            </>
          ) : null}
        </div>

        <h1 className="mt-4 text-[62px] font-black uppercase leading-[0.9] tracking-[-0.055em] text-white">
          {workout.title}
        </h1>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center rounded-full border border-amber-300/20 bg-amber-300/10 px-4 py-2 text-[14px] font-semibold uppercase tracking-[0.18em] text-amber-100">
            {typeLabel}
          </div>
          <div className="inline-flex items-center rounded-full border border-sky-300/20 bg-sky-300/10 px-4 py-2 text-[14px] font-semibold uppercase tracking-[0.18em] text-sky-100">
            {workout.userName}
          </div>
          {workout.linkedClassTitle ? (
            <div className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-[14px] font-semibold uppercase tracking-[0.16em] text-white/70">
              {workout.linkedClassTitle}
            </div>
          ) : null}
          {saluteCount ? (
            <div className="inline-flex items-center rounded-full border border-emerald-300/20 bg-emerald-300/10 px-4 py-2 text-[14px] font-semibold uppercase tracking-[0.16em] text-emerald-100">
              {saluteCount} Salutes
            </div>
          ) : null}
        </div>

        {statRows.length ? (
          <div className="mt-8 grid grid-cols-2 gap-4">
            {statRows.map((stat) => (
              <div
                key={stat.label}
                className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5"
              >
                <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/35">
                  {stat.label}
                </div>
                <div className="mt-2 text-[30px] font-black leading-none tracking-[-0.04em] text-white">
                  {stat.value}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-8 grid gap-5">
          {renderListCard("Movement Log", movementLines, "bg-gradient-to-b from-amber-300/90 to-sky-300/80")}
          {renderListCard("Session Notes", sectionLines, "bg-gradient-to-b from-white/80 to-white/30")}

          {workout.notes.trim() ? (
            <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/38">
                Athlete Note
              </div>
              <p className="mt-4 text-[16px] leading-7 text-white/78">
                {workout.notes.trim()}
              </p>
            </div>
          ) : null}

          {!statRows.length && !movementLines.length && !sectionLines.length && !workout.notes.trim() ? (
            <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/38">
                Session Log
              </div>
              <p className="mt-4 text-[16px] leading-7 text-white/78">
                {workout.title} logged by {workout.userName} on {dateLabel}.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
