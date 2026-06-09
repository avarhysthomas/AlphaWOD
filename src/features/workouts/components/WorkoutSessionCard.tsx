import React from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import UserAvatar from "../../../components/ui/UserAvatar";
import type { WorkoutSession } from "../types";

function formatDateLabel(sessionDate: string) {
  if (!sessionDate) return "Date TBD";

  const value = new Date(`${sessionDate}T12:00:00`);
  if (Number.isNaN(value.getTime())) return sessionDate;

  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(value);
}

function statChips(workout: WorkoutSession) {
  const chips: string[] = [];

  if (workout.stats.score) chips.push(workout.stats.score);
  if (workout.stats.loadKg) chips.push(`${workout.stats.loadKg} kg`);
  if (workout.stats.distanceM) chips.push(`${workout.stats.distanceM} m`);
  if (workout.durationMin) chips.push(`${workout.durationMin} min`);

  return chips.slice(0, 3);
}

type WorkoutSessionCardProps = {
  workout: WorkoutSession;
  showOwner?: boolean;
  compact?: boolean;
};

function formatWorkoutType(type: WorkoutSession["type"]) {
  return type === "run" ? "Cardio" : type.toUpperCase();
}

function sessionSummary(workout: WorkoutSession) {
  const chips = statChips(workout);
  const movementCount = workout.movementEntries.filter((entry) =>
    entry.movementName.trim()
  ).length;

  if (workout.type === "strength" && movementCount) {
    return `${movementCount} move${movementCount === 1 ? "" : "s"}${
      workout.durationMin ? ` · ${workout.durationMin} min` : ""
    }`;
  }

  if (chips.length) return chips.join(" · ");
  if (workout.notes) return workout.notes;
  return "Session logged";
}

export default function WorkoutSessionCard({
  workout,
  showOwner = false,
  compact = false,
}: WorkoutSessionCardProps) {
  const summary = sessionSummary(workout);

  return (
    <Link
      to={`/workouts/${workout.id}`}
      className={[
        "group grid grid-cols-[84px_1fr_auto] items-center gap-3 border-white/8 px-4 py-4 transition hover:bg-white/[0.025]",
        compact
          ? "border-b last:border-b-0"
          : "rounded-[18px] border bg-[#11100f]",
      ].join(" ")}
    >
      <div className="min-w-0">
        <span className="inline-flex max-w-full rounded-full border border-white/8 bg-white/[0.045] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-white/55">
          {formatWorkoutType(workout.type)}
        </span>
      </div>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-[17px] font-bold leading-5 text-white sm:text-xl">
            {workout.title}
          </h3>
          <span className="shrink-0 text-white/28">·</span>
          <span className="shrink-0 font-mono text-sm text-white/50">
            {formatDateLabel(workout.sessionDate)}
          </span>
        </div>
        <p className="mt-1 truncate font-mono text-[13px] text-white/32">{summary}</p>
        {showOwner ? (
          <div className="mt-2 flex items-center gap-2 text-xs font-bold text-white/44">
            <UserAvatar name={workout.userName} photoURL={workout.userPhotoURL} size={22} />
            <span className="truncate">{workout.userName}</span>
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-3">
        {workout.startTime ? (
          <span className="hidden font-mono text-sm text-white/32 sm:inline">
            {workout.startTime}
          </span>
        ) : null}
        <ChevronRight className="h-4 w-4 text-white/20 transition group-hover:text-white/55" />
      </div>
    </Link>
  );
}
