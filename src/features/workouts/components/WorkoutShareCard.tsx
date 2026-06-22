import React from "react";
import { BadgeCheck, CalendarDays, UserRound } from "lucide-react";
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
  const heartRate = workout.stats.avgHeartRate?.trim();
  const rows = [
    workout.stats.score && !quickLog
      ? { label: getPrimaryScoreLabel(workout), value: workout.stats.score }
      : null,
    workout.stats.loadKg ? { label: "Load", value: `${workout.stats.loadKg} kg` } : null,
    workout.stats.reps ? { label: "Reps", value: workout.stats.reps } : null,
    workout.stats.distanceM ? { label: "Distance", value: `${workout.stats.distanceM} m` } : null,
    workout.stats.calories ? { label: "Calories", value: workout.stats.calories } : null,
    heartRate
      ? { label: "Avg HR", value: /\bbpm\b/i.test(heartRate) ? heartRate : `${heartRate} bpm` }
      : null,
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

  return Math.max(920, 680 + heroBump + infoRows * 72 + (saluteCount ? 48 : 0));
}

function BrandSocialHeader() {
  return (
    <div className="flex h-[58px] items-center justify-between bg-[#f4f4f4] px-4 text-[#050505]">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#050505] font-heading text-[12px] text-[#f4f4f4]">
          ZA
        </div>
        <div className="flex items-center gap-1.5 text-[14px] font-bold leading-none">
          zeroalphafitness
          <BadgeCheck className="h-4 w-4 fill-[#3f3f3f] text-[#f4f4f4]" />
        </div>
      </div>
      <div className="text-[20px] font-black leading-none">...</div>
    </div>
  );
}

function PosterImage({ workout }: { workout: WorkoutSession }) {
  if (workout.selfieURL) {
    return (
      <img
        src={workout.selfieURL}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="absolute inset-0 h-full w-full select-none object-cover grayscale"
      />
    );
  }

  return (
    <img
      src="/ZERO-ALPHA.png"
      alt=""
      aria-hidden="true"
      draggable={false}
      className="absolute left-1/2 top-1/2 h-[270px] w-[420px] -translate-x-1/2 -translate-y-1/2 select-none object-contain opacity-[0.34] grayscale"
    />
  );
}

function renderListCard(title: string, items: string[]) {
  if (!items.length) return null;

  return (
    <div className="border border-white/18 bg-[#101010]">
      <div className="border-b border-white/18 px-5 py-4 text-[12px] font-black uppercase leading-none text-white/46">
        {title}
      </div>
      <div>
        {items.map((item, index) => (
          <div
            key={`${title}-${index}-${item}`}
            className="border-b border-white/12 px-5 py-4 text-[16px] font-bold leading-snug text-white/84 last:border-b-0"
          >
            {item}
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
      className="relative w-[720px] overflow-hidden rounded-[18px] bg-[#050505] shadow-[0_30px_80px_rgba(0,0,0,0.55)]"
      style={{ minHeight: `${cardHeight}px` }}
    >
      <BrandSocialHeader />

      <div
        className="relative overflow-hidden bg-[#050505] text-white"
        style={{ minHeight: `${cardHeight - 58}px` }}
      >
        <div className="absolute inset-0 opacity-[0.1] [background-image:radial-gradient(circle_at_10%_20%,#f4f4f4_0_1px,transparent_1px),radial-gradient(circle_at_70%_60%,#f4f4f4_0_1px,transparent_1px)] [background-size:7px_7px,12px_12px]" />

        <div className="relative grid h-[260px] grid-cols-[1fr_220px] border-b border-white/18">
          <div className="relative overflow-hidden bg-[#d8d8d8]">
            <PosterImage workout={workout} />
            <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(0,0,0,0.72),rgba(0,0,0,0.12)_50%,rgba(0,0,0,0.78))]" />
            <div className="absolute bottom-5 left-6 font-heading text-[58px] uppercase leading-[0.82] text-[#f4f4f4]">
              Logged
              <br />
              Work
            </div>
          </div>

          <div className="flex flex-col justify-between border-l border-white/18 bg-[#101010] p-5">
            <div className="text-[11px] font-black uppercase leading-tight text-white/48">
              {typeLabel}
            </div>
            <div className="font-heading text-[55px] uppercase leading-[0.82] text-[#f4f4f4]">
              ZAF
              <br />
              Proof
            </div>
            <div className="text-[12px] font-black uppercase leading-tight text-white/62">
              {workout.userName}
            </div>
          </div>
        </div>

        <div className="relative bg-[#f4f4f4] px-7 py-7 text-[#050505]">
          <div className="flex flex-wrap items-center gap-3 text-[13px] font-black uppercase leading-none text-[#050505]/62">
            <span className="inline-flex items-center gap-2">
              <CalendarDays className="h-4 w-4" />
              {dateLabel}
            </span>
            <span className="h-px w-8 bg-[#050505]/40" />
            <span>{typeLabel}</span>
            {workout.startTime ? <span>{workout.startTime}</span> : null}
          </div>

          <h1 className="mt-5 font-heading text-[78px] uppercase leading-[0.84]">
            {workout.title}
          </h1>

          <div className="mt-6 grid grid-cols-3 border-y border-[#050505] text-[15px] font-black uppercase leading-tight">
            <div className="py-4 pr-4">{typeLabel}</div>
            <div className="flex items-center gap-2 border-x border-[#050505] p-4">
              <UserRound className="h-4 w-4" />
              {workout.userName}
            </div>
            <div className="py-4 pl-4">
              {saluteCount ? `${saluteCount} Salutes` : workout.linkedClassTitle || "Session"}
            </div>
          </div>
        </div>

        {statRows.length ? (
          <div className="relative grid grid-cols-2 border-b border-white/18">
            {statRows.map((stat, index) => (
              <div
                key={`${stat.label}-${index}`}
                className="border-r border-t border-white/18 bg-[#101010] p-5 odd:border-l-0 even:border-r-0"
              >
                <div className="text-[11px] font-black uppercase leading-none text-white/42">
                  {stat.label}
                </div>
                <div className="mt-3 font-heading text-[38px] uppercase leading-[0.9] text-[#f4f4f4]">
                  {stat.value}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <div className="relative grid gap-5 p-7">
          {renderListCard("Movement Log", movementLines)}
          {renderListCard("Session Notes", sectionLines)}

          {workout.notes.trim() ? (
            <div className="border border-white/18 bg-[#101010] p-5">
              <div className="text-[12px] font-black uppercase leading-none text-white/46">
                Athlete Note
              </div>
              <p className="mt-3 text-[18px] font-bold leading-snug text-white/82">
                {workout.notes.trim()}
              </p>
            </div>
          ) : null}

          {!statRows.length && !movementLines.length && !sectionLines.length && !workout.notes.trim() ? (
            <div className="border border-white/18 bg-[#101010] p-5">
              <div className="text-[12px] font-black uppercase leading-none text-white/46">
                Session Log
              </div>
              <p className="mt-3 text-[18px] font-bold leading-snug text-white/82">
                {workout.title} logged by {workout.userName} on {dateLabel}.
              </p>
            </div>
          ) : null}
        </div>

        <div className="relative flex items-end justify-between gap-5 border-t border-white/18 bg-[#101010] px-7 py-5">
          <div>
            <div className="text-[12px] font-black uppercase leading-none text-white">
              Zero Alpha Fitness
            </div>
            <div className="mt-2 text-[11px] font-bold uppercase leading-tight text-white/44">
              Session proof, built by the athlete
            </div>
          </div>
          <div className="text-right text-[13px] font-black uppercase leading-none text-white">
            @zeroalphafitness
          </div>
        </div>
      </div>
    </div>
  );
}
