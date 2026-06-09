import React, { useEffect, useState } from "react";
import { Link, Navigate, NavLink, useNavigate, useParams } from "react-router-dom";
import {
  Bell,
  ChevronLeft,
  Globe2,
  Image,
  Lock,
  Share2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { getUserNavItems } from "../../../components/layout/UserTopNav";
import UserAvatar from "../../../components/ui/UserAvatar";
import { useAuth } from "../../../context/AuthContext";
import WorkoutShareModal from "../components/WorkoutShareModal";
import {
  deleteWorkoutSession,
  listenToFeedPost,
  listenToWorkoutSession,
} from "../services/workouts";
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
  const { user, appUser } = useAuth();
  const navigate = useNavigate();
  const { workoutId } = useParams<{ workoutId: string }>();
  const [workout, setWorkout] = useState<WorkoutSession | null>(null);
  const [feedPost, setFeedPost] = useState<FeedPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

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
  const canDelete = Boolean(user?.uid && workout && user.uid === workout.userId);
  const navItems = getUserNavItems(appUser?.role);
  const profilePhotoURL = appUser?.photoURL || user?.photoURL || "";
  const firstName = appUser?.name?.split(" ")[0] || appUser?.email?.split("@")[0] || "A";

  async function handleDeleteWorkout() {
    if (!workout || !canDelete || isDeleting) return;

    const confirmed = window.confirm(
      "Delete this workout log? This will also remove it from the feed."
    );
    if (!confirmed) return;

    try {
      setIsDeleting(true);
      await deleteWorkoutSession(workout.id);
      navigate("/workouts");
    } catch (error) {
      console.error("Could not delete workout session", error);
      setIsDeleting(false);
    }
  }

  return (
    <div className="carbon-fiber-bg min-h-screen overflow-x-hidden font-barlow text-[#f4f0ea]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_right,rgba(120,95,70,0.16),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.025),transparent_22%)]" />

      <main className="relative mx-auto min-h-screen max-w-xl px-5 pb-36 pt-7 sm:max-w-3xl sm:px-8">
        <header className="flex items-center justify-between" style={{ paddingTop: "env(safe-area-inset-top)" }}>
          <Link to="/dashboard" aria-label="Zero Alpha home" className="block">
            <img src="/ZERO-ALPHA.png" alt="ZERO-ALPHA" className="h-20 w-auto object-contain" />
          </Link>
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Notifications"
              className="grid h-12 w-12 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white/55 transition hover:bg-white/[0.08] hover:text-white"
            >
              <Bell className="h-5 w-5" />
            </button>
            <Link
              to="/profile"
              aria-label="Profile"
              className="grid h-12 w-12 overflow-hidden rounded-full border border-[#8b725b]/60 bg-[#765f4b] text-sm font-bold uppercase text-[#f8efe5]"
            >
              {profilePhotoURL ? (
                <img
                  src={profilePhotoURL}
                  alt={appUser?.name ? `${appUser.name}'s profile` : "Profile"}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="grid h-full w-full place-items-center">{firstName.slice(0, 1)}</span>
              )}
            </Link>
          </div>
        </header>

        {!loading && !workout ? (
          <div className="mt-12 rounded-[28px] border border-dashed border-white/10 bg-[#151311] px-6 py-10 text-center">
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
            <section className="mt-10">
              <Link
                to="/feed"
                className="inline-flex items-center gap-2 text-sm font-bold text-white/34 transition hover:text-white/70"
              >
                <ChevronLeft className="h-4 w-4" />
                Feed
              </Link>
              <p className="mt-8 text-[12px] font-bold uppercase tracking-[0.3em] text-white/34">
                Session detail
              </p>
              <h1 className="mt-4 font-heading text-[4.6rem] uppercase leading-none text-white sm:text-[6rem]">
                {workout.title}
              </h1>
            </section>

            <article className="mt-8 overflow-hidden rounded-[28px] border border-white/10 bg-[#151311] shadow-[0_24px_60px_rgba(0,0,0,0.28)]">
              <div className="p-5">
                <div className="grid grid-cols-[48px_1fr_auto] gap-3.5">
                  <UserAvatar
                    name={workout.userName}
                    photoURL={workout.userPhotoURL}
                    size={48}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-base font-bold text-white">{workout.userName}</div>
                    <div className="mt-1 text-sm font-medium text-white/36">{formatDateLabel(workout.sessionDate)}</div>
                  </div>
                  <span className="h-fit rounded-full bg-white/[0.08] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-white/58">
                    {formatWorkoutType(workout.type)}
                  </span>
                </div>

                <div className="mt-6">
                  <h2 className="text-4xl font-bold leading-none text-white">
                    {workout.title}
                  </h2>
                  <p className="mt-2 font-mono text-sm text-white/40">
                    {buildHeroSummary(workout)}
                    {workout.durationMin ? ` · ${workout.durationMin} min` : ""}
                    {workout.startTime ? ` · ${workout.startTime}` : ""}
                  </p>
                  {workout.notes ? (
                    <p className="mt-5 text-base leading-7 text-white/68">
                      {workout.notes}
                    </p>
                  ) : null}
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-bold text-white/52">
                    {workout.visibility === "members" ? <Globe2 className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                    {workout.visibility === "members" ? "Shared" : "Private"}
                  </span>
                  {workout.linkedClassTitle ? (
                    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-bold text-white/52">
                      {workout.linkedClassTitle}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center gap-3 border-t border-white/10 px-4 py-3">
                {feedPost?.reactionCount ? (
                  <div className="inline-flex items-center gap-2 rounded-full bg-white/[0.05] px-3.5 py-2 text-sm font-bold text-white/62">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {feedPost.reactionCount}
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => setShareOpen(true)}
                  className="inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-bold text-white/46 transition hover:bg-white/[0.06] hover:text-white"
                >
                  <Share2 className="h-4 w-4" />
                  Share
                </button>
                {canDelete ? (
                  <button
                    type="button"
                    onClick={handleDeleteWorkout}
                    disabled={isDeleting}
                    className="ml-auto inline-flex items-center gap-2 rounded-full p-2 text-white/32 transition hover:bg-red-500/10 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="Delete workout"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            </article>

            <section className="mt-5 grid gap-3 sm:grid-cols-2">
              {workout.type === "run" && workout.stats.distanceM ? (
                <div className="rounded-[20px] border border-white/10 bg-[#151311] p-4">
                  <div className="text-[11px] font-black uppercase tracking-[0.2em] text-white/34">Distance</div>
                  <div className="mt-2 font-mono text-3xl font-bold text-white">{workout.stats.distanceM} m</div>
                </div>
              ) : null}

              {workout.type === "run" && cardioPace ? (
                <div className="rounded-[20px] border border-white/10 bg-[#151311] p-4">
                  <div className="text-[11px] font-black uppercase tracking-[0.2em] text-white/34">Pace</div>
                  <div className="mt-2 font-mono text-3xl font-bold text-white">{cardioPace}</div>
                </div>
              ) : null}

              {buildStatRows(workout).map((stat) => (
                <div key={stat.label} className="rounded-[20px] border border-white/10 bg-[#151311] p-4">
                  <div className="text-[11px] font-black uppercase tracking-[0.2em] text-white/34">{stat.label}</div>
                  <div className="mt-2 font-mono text-3xl font-bold text-white">{stat.value}</div>
                </div>
              ))}
            </section>

            <section className="mt-5 grid gap-4">
              {workout.movementEntries.length ? (
                <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#151311]">
                  <div className="border-b border-white/10 px-5 py-4">
                    <h2 className="text-[12px] font-bold uppercase tracking-[0.28em] text-white/54">
                      Session breakdown
                    </h2>
                  </div>
                  {workout.movementEntries.map((entry, index) => (
                    <div
                      key={`${entry.movementId || entry.movementName}-${index}`}
                      className="grid grid-cols-[1fr_auto] gap-4 border-b border-white/10 px-5 py-4 last:border-b-0"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-lg font-bold text-white">{entry.movementName}</div>
                        <div className="mt-1 font-mono text-sm text-white/38">
                          {entry.sets ? `${entry.sets} sets` : ""}
                          {entry.reps ? `${entry.sets ? " · " : ""}${entry.reps} reps` : ""}
                        </div>
                      </div>
                      <div className="font-mono text-lg font-bold text-white">
                        {entry.loadKg ? `${entry.loadKg} kg` : entry.value}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {displaySections.length ? (
                <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#151311]">
                  <div className="border-b border-white/10 px-5 py-4">
                    <h2 className="text-[12px] font-bold uppercase tracking-[0.28em] text-white/54">
                      Notes
                    </h2>
                  </div>
                  {displaySections.map((section, index) => (
                    <div key={`${section.kind}-${index}`} className="border-b border-white/10 px-5 py-4 last:border-b-0">
                      <div className="text-[11px] font-black uppercase tracking-[0.2em] text-white/34">
                        {sectionLabel(section.kind)}
                      </div>
                      <p className="mt-2 text-base leading-7 text-white/68">{section.text}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>

            {feedPost?.reactionCount ? (
              <section className="mt-5 overflow-hidden rounded-[28px] border border-white/10 bg-[#151311] p-5">
                <h2 className="text-[12px] font-bold uppercase tracking-[0.28em] text-white/54">
                  Salutes
                </h2>
                <div className="mt-4 flex flex-wrap gap-2">
                  {feedPost.reactionUsers.slice(0, 8).map((entry) => (
                    <div key={entry.userId} className="inline-flex items-center gap-2 rounded-full bg-white/[0.05] px-3 py-2">
                      <UserAvatar name={entry.name} photoURL={entry.photoURL} size={26} />
                      <span className="text-sm font-bold text-white/72">{entry.name}</span>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {workout.selfieURL ? (
              <section className="mt-5 rounded-[28px] border border-white/10 bg-[#151311] p-5">
                <div className="inline-flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.28em] text-white/54">
                  <Image className="h-4 w-4" />
                  Session pic
                </div>
                <img
                  src={workout.selfieURL}
                  alt="Workout pic"
                  className="mt-4 w-full rounded-[22px] border border-white/10 object-cover"
                />
              </section>
            ) : null}

          </>
        ) : null}
      </main>

      <nav
        className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-[27rem] rounded-[22px] border border-white/40 bg-white/90 px-2 py-2 shadow-[0_12px_34px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:max-w-xl"
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
        aria-label="Primary"
      >
        <div className="flex gap-1 overflow-x-auto px-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {navItems.map(({ to, label, icon: NavIcon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                [
                  "flex min-w-[56px] shrink-0 flex-col items-center gap-1 rounded-[15px] px-1.5 py-1.5 text-[10px] font-extrabold leading-tight transition",
                  isActive ? "bg-black/12 text-black" : "text-black hover:bg-black/6",
                ].join(" ")
              }
            >
              <NavIcon className="h-[18px] w-[18px] text-black" />
              <span className="max-w-[56px] truncate leading-tight text-black">{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>

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
