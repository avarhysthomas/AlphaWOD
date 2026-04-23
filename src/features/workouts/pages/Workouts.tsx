import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";
import UserTopNav from "../../../components/layout/UserTopNav";
import { useAuth } from "../../../context/AuthContext";
import WorkoutSessionCard from "../components/WorkoutSessionCard";
import { listenToMemberWorkouts } from "../services/workouts";
import type { WorkoutSession } from "../types";

export default function Workouts() {
  const { user, appUser } = useAuth();
  const [workouts, setWorkouts] = useState<WorkoutSession[]>([]);

  const firstName =
    (appUser?.name || user?.displayName || "Your").trim().split(/\s+/)[0] || "Your";

  useEffect(() => {
    if (!user) {
      setWorkouts([]);
      return;
    }

    const unsubscribe = listenToMemberWorkouts(user.uid, setWorkouts);
    return () => unsubscribe();
  }, [user]);

  return (
    <div className="min-h-screen bg-black text-white">
      <UserTopNav />

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="relative overflow-hidden rounded-[32px] border border-white/10 bg-neutral-950 shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_12%,rgba(14,165,233,0.18),transparent_28%),radial-gradient(circle_at_82%_10%,rgba(245,158,11,0.16),transparent_30%),linear-gradient(135deg,rgba(255,255,255,0.03),transparent_55%)]" />
          <div className="absolute -right-6 bottom-[-26px] select-none text-[110px] font-black uppercase tracking-[0.18em] text-white/[0.04] sm:text-[150px]">
            WORK
          </div>

          <div className="relative p-6 sm:p-8 lg:p-10">
            <h1 className="mt-6 text-4xl font-heading uppercase tracking-[-0.04em] sm:text-5xl lg:text-6xl">
              {firstName}&apos;s Training
            </h1>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                to="/workouts/new"
                className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/12 px-5 py-3 text-sm font-semibold text-amber-100 transition hover:brightness-110"
              >
                <Sparkles className="h-4 w-4" />
                Log workout
              </Link>
              <Link
                to="/feed"
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-5 py-3 text-sm font-semibold text-white/72 transition hover:border-white/20 hover:text-white"
              >
                Zero Alpha Feed
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-4">
          {workouts.length ? (
            workouts.map((workout) => (
              <WorkoutSessionCard key={workout.id} workout={workout} />
            ))
          ) : (
            <div className="rounded-[28px] border border-dashed border-white/10 bg-neutral-950/90 px-6 py-10 text-center">
              <div className="text-lg font-semibold text-white">
                No workouts logged yet.
              </div>
              <p className="mt-3 text-sm leading-7 text-white/58">
                Your session history will start here once you log your first
                workout.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
