import React from "react";
import { Link } from "react-router-dom";
import { Activity, ArrowUpRight, CalendarDays, Clock3, Lock, Users } from "lucide-react";
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
};

function formatWorkoutType(type: WorkoutSession["type"]) {
  return type === "run" ? "Cardio" : type.toUpperCase();
}

export default function WorkoutSessionCard({
  workout,
  showOwner = false,
}: WorkoutSessionCardProps) {
  const chips = statChips(workout);

  return (
    <Link
      to={`/workouts/${workout.id}`}
      className="group relative overflow-hidden rounded-[28px] border border-white/10 bg-neutral-950/95 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.35)] transition duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-neutral-900"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.1),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(14,165,233,0.08),transparent_26%)] opacity-80" />

      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/52">
              <Activity className="h-3.5 w-3.5" />
              {formatWorkoutType(workout.type)}
            </div>

            <div>
              <h3 className="text-2xl font-semibold tracking-[-0.03em] text-white">
                {workout.title}
              </h3>
              <p className="mt-2 max-w-xl text-sm leading-7 text-white/60">
                {workout.notes || "Session logged and ready to revisit."}
              </p>
            </div>
          </div>

          <div className="rounded-full border border-white/10 bg-black/30 p-2.5 text-white/45 transition group-hover:border-white/20 group-hover:text-white/80">
            <ArrowUpRight className="h-4 w-4" />
          </div>
        </div>

        {showOwner ? (
          <div className="mt-5 flex items-center gap-3 text-sm text-white/68">
            <UserAvatar
              name={workout.userName}
              photoURL={workout.userPhotoURL}
              size={36}
            />
            <span>{workout.userName}</span>
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-white/55">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/25 px-3 py-1.5">
            <CalendarDays className="h-4 w-4" />
            {formatDateLabel(workout.sessionDate)}
          </span>
          {workout.startTime ? (
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/25 px-3 py-1.5">
              <Clock3 className="h-4 w-4" />
              {workout.startTime}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/25 px-3 py-1.5">
            {workout.visibility === "members" ? (
              <Users className="h-4 w-4" />
            ) : (
              <Lock className="h-4 w-4" />
            )}
            {workout.visibility === "members" ? "Shared to feed" : "Private"}
          </span>
        </div>

        {chips.length ? (
          <div className="mt-5 flex flex-wrap gap-2">
            {chips.map((chip) => (
              <span
                key={chip}
                className="rounded-full border border-amber-400/15 bg-amber-400/[0.08] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-amber-100"
              >
                {chip}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </Link>
  );
}
