import React, { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  ChevronLeft,
  Clock3,
  Globe2,
  Image,
  Lock,
  MapPinned,
  Share2,
  Sparkles,
  ShieldCheck,
  Trophy,
} from "lucide-react";
import UserTopNav from "../../../components/layout/UserTopNav";
import UserAvatar from "../../../components/ui/UserAvatar";
import WorkoutShareModal from "../components/WorkoutShareModal";
import { listenToFeedPost, listenToWorkoutSession } from "../services/workouts";
import type { FeedPost, WorkoutSession } from "../types";
import { getPrimaryScoreLabel } from "../utils/workoutDisplay";

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

function buildStatRows(workout: WorkoutSession) {
  const scoreMatchesRounds =
    (workout.type === "amrap" || workout.type === "emom") &&
    workout.stats.score &&
    workout.stats.totalRounds &&
    workout.stats.score.toLowerCase().includes(workout.stats.totalRounds.toLowerCase());
  const isCardio = workout.type === "run";

  return [
    workout.stats.score && !isCardio
      ? { label: getPrimaryScoreLabel(workout), value: workout.stats.score }
      : null,
    workout.stats.loadKg ? { label: "Load", value: `${workout.stats.loadKg} kg` } : null,
    workout.stats.reps ? { label: "Reps", value: workout.stats.reps } : null,
    workout.stats.distanceM ? { label: "Distance", value: `${workout.stats.distanceM} m` } : null,
    workout.stats.calories ? { label: "Calories", value: workout.stats.calories } : null,
    workout.stats.avgHeartRate
      ? { label: "Avg HR", value: `${workout.stats.avgHeartRate} bpm` }
      : null,
    workout.stats.area && !isCardio ? { label: "Details", value: workout.stats.area } : null,
    workout.stats.totalRounds && !scoreMatchesRounds
      ? { label: "Total Rounds", value: workout.stats.totalRounds }
      : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;
}

function parseDurationToSeconds(value?: string) {
  if (!value?.trim()) return null;

  const parts = value.trim().split(":").map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) return null;

  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function formatCardioPace(distance?: string, score?: string) {
  const distanceMeters = distance ? Number(distance) : 0;
  const totalSeconds = parseDurationToSeconds(score);

  if (!distanceMeters || !totalSeconds) return null;

  const secondsPerKm = totalSeconds / (distanceMeters / 1000);
  if (!Number.isFinite(secondsPerKm)) return null;

  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = Math.round(secondsPerKm % 60);

  if (seconds === 60) {
    return `${minutes + 1}:00 / km`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")} / km`;
}

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

function buildHeroSummary(workout: WorkoutSession) {
  if (workout.type === "run") {
    const parts = [
      workout.stats.distanceM ? `${workout.stats.distanceM} m` : "",
      workout.stats.score || "",
      workout.durationMin ? `${workout.durationMin} min` : "",
    ].filter(Boolean);

    return parts.join(" • ");
  }

  if (workout.type === "strength") {
    const movementCount = workout.movementEntries.filter((entry) => entry.movementName.trim()).length;
    return movementCount ? `${movementCount} movement${movementCount === 1 ? "" : "s"} logged` : "Strength session";
  }

  if (workout.type === "amrap" && workout.stats.totalRounds && workout.durationMin) {
    return `${workout.stats.totalRounds} rounds in ${workout.durationMin} min`;
  }

  if (workout.type === "emom" && workout.durationMin) {
    return `${workout.durationMin} min EMOM`;
  }

  return workout.stats.score || workout.durationMin || "Session logged";
}

function sectionLabel(kind: string) {
  switch (kind) {
    case "warmup":
      return "Warm-up";
    case "main":
      return "Main piece";
    case "finisher":
      return "Finisher";
    case "notes":
      return "Notes";
    default:
      return kind;
  }
}

function getDisplaySections(workout: WorkoutSession) {
  if (workout.type !== "run") return workout.sections;

  return workout.sections.filter((section) => {
    if (section.kind !== "notes") return true;
    const text = section.text.trim().toLowerCase();
    return !text.startsWith("area:") && !text.startsWith("mode:");
  });
}

export default function WorkoutDetail() {
  const { workoutId } = useParams<{ workoutId: string }>();
  const [workout, setWorkout] = useState<WorkoutSession | null>(null);
  const [feedPost, setFeedPost] = useState<FeedPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    if (!workoutId) {
      setWorkout(null);
      setLoading(false);
      return;
    }

    const unsubscribe = listenToWorkoutSession(workoutId, (nextWorkout) => {
      setWorkout(nextWorkout);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [workoutId]);

  useEffect(() => {
    if (!workoutId) {
      setFeedPost(null);
      return;
    }

    const unsubscribe = listenToFeedPost(workoutId, setFeedPost);
    return () => unsubscribe();
  }, [workoutId]);

  if (!loading && !workoutId) {
    return <Navigate to="/workouts" replace />;
  }

  const displaySections = workout ? getDisplaySections(workout) : [];
  const cardioPace = workout
    ? formatCardioPace(workout.stats.distanceM, workout.stats.score)
    : null;

  return (
    <div className="min-h-screen bg-black text-white">
      <UserTopNav />

      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8">
        {!loading && !workout ? (
          <div className="rounded-[28px] border border-dashed border-white/10 bg-neutral-950/90 px-6 py-10 text-center">
            <div className="text-lg font-semibold text-white">
              This workout couldn&apos;t be found.
            </div>
            <Link
              to="/workouts"
              className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/72 transition hover:border-white/20 hover:text-white"
            >
              <ChevronLeft className="h-4 w-4" />
              Back to workouts
            </Link>
          </div>
        ) : null}

        {workout ? (
          <>
            <section className="relative overflow-hidden rounded-[28px] border border-white/10 bg-neutral-950 shadow-[0_24px_60px_rgba(0,0,0,0.38)]">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_14%,rgba(59,130,246,0.16),transparent_28%),radial-gradient(circle_at_82%_10%,rgba(245,158,11,0.16),transparent_28%),linear-gradient(135deg,rgba(255,255,255,0.03),transparent_55%)]" />
              <div className="relative p-5 sm:p-6 lg:p-7">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <Link
                      to="/workouts"
                      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/25 px-4 py-2.5 text-sm font-semibold text-white/85 transition hover:border-white/20 hover:bg-black/35 hover:text-white"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Workouts
                    </Link>
                    <button
                      type="button"
                      onClick={() => setShareOpen(true)}
                      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white/85 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
                    >
                      <Share2 className="h-4 w-4" />
                      Share
                    </button>
                  </div>

                  <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/72">
                    <Sparkles className="h-3.5 w-3.5" />
                    {formatWorkoutType(workout.type)}
                  </div>
                </div>

                <h1 className="mt-4 text-2xl font-heading uppercase tracking-[-0.04em] sm:text-4xl">
                  {workout.title}
                </h1>

                {workout.type !== "run" ? (
                  <div className="mt-2 text-sm text-white/60 sm:text-base">
                    {buildHeroSummary(workout)}
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center gap-2.5 text-sm text-white/62">
                  <span>{formatDateLabel(workout.sessionDate)}</span>
                  {workout.startTime ? (
                    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1">
                      <Clock3 className="h-4 w-4" />
                      {workout.startTime}
                    </span>
                  ) : null}
                  <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1">
                    {workout.visibility === "members" ? (
                      <Globe2 className="h-4 w-4" />
                    ) : (
                      <Lock className="h-4 w-4" />
                    )}
                    {workout.visibility === "members" ? "Shared to feed" : "Private"}
                  </span>
                  {workout.linkedClassTitle ? (
                    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1">
                      {workout.linkedClassTitle}
                    </span>
                  ) : null}
                </div>

                <div className="mt-4 flex items-center gap-3">
                  <UserAvatar
                    name={workout.userName}
                    photoURL={workout.userPhotoURL}
                    size={38}
                  />
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-white/40">Logged by</div>
                    <div className="text-sm font-semibold text-white/88">
                      {workout.userName}
                    </div>
                  </div>
                </div>

                {feedPost?.reactionCount ? (
                  <div className="mt-4 rounded-[20px] border border-white/10 bg-black/20 p-4">
                    <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">
                      <ShieldCheck className="h-3.5 w-3.5 text-white/48" />
                      Salutes
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2.5">
                      {feedPost.reactionUsers.slice(0, 6).map((entry) => (
                        <div
                          key={entry.userId}
                          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1.5"
                        >
                          <UserAvatar
                            name={entry.name}
                            photoURL={entry.photoURL}
                            size={24}
                          />
                          <span className="text-sm font-medium text-white/78">
                            {entry.name}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {workout.notes ? (
                  <div className="mt-4 max-w-3xl rounded-[20px] border border-white/10 bg-black/20 p-4">
                    <p className="text-sm leading-6 text-white/68">
                      {workout.notes}
                    </p>
                  </div>
                ) : null}
              </div>
            </section>

            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {workout.type === "run" && workout.stats.distanceM ? (
                <div className="rounded-[20px] border border-white/10 bg-neutral-950/95 p-3.5 sm:p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">
                    Distance
                  </div>
                  <div className="mt-2 text-xl font-semibold tracking-[-0.04em] text-white sm:text-2xl">
                    {workout.stats.distanceM} m
                  </div>
                </div>
              ) : null}

              {workout.type === "run" && cardioPace ? (
                <div className="rounded-[20px] border border-white/10 bg-neutral-950/95 p-3.5 sm:p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">
                    Pace
                  </div>
                  <div className="mt-2 text-xl font-semibold tracking-[-0.04em] text-white sm:text-2xl">
                    {cardioPace}
                  </div>
                </div>
              ) : null}

              {buildStatRows(workout).map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-[20px] border border-white/10 bg-neutral-950/95 p-3.5 sm:p-4"
                >
                  <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">
                    {stat.label}
                  </div>
                  <div className="mt-2 text-xl font-semibold tracking-[-0.04em] text-white sm:text-2xl">
                    {stat.value}
                  </div>
                </div>
              ))}

              {workout.durationMin ? (
                <div className="rounded-[20px] border border-white/10 bg-neutral-950/95 p-3.5 sm:p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">
                    Duration
                  </div>
                  <div className="mt-2 text-xl font-semibold tracking-[-0.04em] text-white sm:text-2xl">
                    {workout.durationMin} min
                  </div>
                </div>
              ) : null}
            </section>

            <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
              {workout.movementEntries.length ? (
                <div className="rounded-[24px] border border-white/10 bg-neutral-950/95 p-4 sm:p-5">
                  <div className="flex items-center gap-2">
                    <Trophy className="h-4.5 w-4.5 text-white/52" />
                    <h2 className="text-xl font-semibold tracking-[-0.03em] text-white">
                      Session Breakdown
                    </h2>
                  </div>

                  <div className="mt-4 space-y-2.5">
                    {workout.movementEntries.map((entry, index) => (
                      <div
                        key={`${entry.movementId || entry.movementName}-${index}`}
                        className="rounded-[18px] border border-white/10 bg-black/20 p-3.5"
                      >
                        <div className="text-sm font-semibold text-white">
                          {entry.movementName}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {entry.loadKg ? (
                            <span className="rounded-full border border-amber-400/15 bg-amber-400/[0.08] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-100">
                              {entry.loadKg} kg
                            </span>
                          ) : null}
                          {entry.reps ? (
                            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">
                              {entry.reps} reps
                            </span>
                          ) : null}
                          {entry.sets ? (
                            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">
                              {entry.sets} sets
                            </span>
                          ) : null}
                          {!entry.loadKg && !entry.reps && !entry.sets ? (
                            <span className="rounded-full border border-amber-400/15 bg-amber-400/[0.08] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-100">
                              {entry.value}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="space-y-3">
                {displaySections.length ? (
                  <div className="rounded-[24px] border border-white/10 bg-neutral-950/95 p-4 sm:p-5">
                    <h2 className="text-xl font-semibold tracking-[-0.03em] text-white">
                      Extra Notes
                    </h2>

                    <div className="mt-4 space-y-2.5">
                      {displaySections.map((section, index) => (
                        <div
                          key={`${section.kind}-${index}`}
                          className="rounded-[18px] border border-white/10 bg-black/20 p-3.5"
                        >
                          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">
                            {sectionLabel(section.kind)}
                          </div>
                          <p className="mt-2 text-sm leading-6 text-white/74">
                            {section.text}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {workout.stats.area ? (
                  <div className="rounded-[24px] border border-white/10 bg-neutral-950/95 p-4 sm:p-5">
                    <div className="flex items-center gap-2">
                      <MapPinned className="h-4 w-4 text-white/48" />
                      <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">
                        Location
                      </div>
                    </div>
                    <div className="mt-2 text-base font-semibold text-white">
                      {workout.stats.area}
                    </div>
                  </div>
                ) : null}
              </div>
            </section>

            {workout.selfieURL ? (
              <section className="rounded-[24px] border border-white/10 bg-neutral-950/95 p-4 sm:p-5">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/52">
                  <Image className="h-3.5 w-3.5" />
                  Session Pic
                </div>
                <img
                  src={workout.selfieURL}
                  alt="Workout pic"
                  className="mt-4 w-full max-w-lg rounded-[20px] border border-white/10 object-cover"
                />
              </section>
            ) : null}
          </>
        ) : null}
      </div>

      {workout ? (
        <WorkoutShareModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          workout={workout}
          saluteCount={feedPost?.reactionCount || 0}
        />
      ) : null}
    </div>
  );
}
