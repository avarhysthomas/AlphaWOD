import React, { useEffect, useMemo, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { Bell, Plus, Search } from "lucide-react";
import { getUserNavItems } from "../../../components/layout/UserTopNav";
import { useAuth } from "../../../context/AuthContext";
import WorkoutSessionCard from "../components/WorkoutSessionCard";
import { listenToMemberWorkouts } from "../services/workouts";
import type { WorkoutSession, WorkoutType } from "../types";

type FilterKey = "all" | "strength" | "run" | "amrap" | "emom";

const filterOptions: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "strength", label: "Strength" },
  { key: "run", label: "Cardio" },
  { key: "amrap", label: "AMRAP" },
  { key: "emom", label: "EMOM" },
];

function parseSessionDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function groupLabel(sessionDate: string) {
  const date = parseSessionDate(sessionDate);
  if (!date) return "Earlier";

  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const itemStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((todayStart.getTime() - itemStart.getTime()) / 86400000);

  if (diffDays < 7) return "This week";
  if (diffDays < 14) return "Last week";
  return "Earlier";
}

function getDurationHours(workouts: WorkoutSession[]) {
  const minutes = workouts.reduce((total, workout) => {
    const value = Number(workout.durationMin);
    return total + (Number.isFinite(value) ? value : 0);
  }, 0);

  if (!minutes) return "0h";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

function isRecentPr(workout: WorkoutSession) {
  return /(^|\b)(pr|pb|personal best|best)(\b|$)/i.test(
    `${workout.title} ${workout.notes ?? ""} ${workout.stats.score ?? ""}`
  );
}

export default function Workouts() {
  const { user, appUser } = useAuth();
  const [workouts, setWorkouts] = useState<WorkoutSession[]>([]);
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    if (!user) {
      setWorkouts([]);
      return;
    }

    const unsubscribe = listenToMemberWorkouts(user.uid, setWorkouts);
    return () => unsubscribe();
  }, [user]);

  const navItems = getUserNavItems(appUser?.role);
  const firstName = appUser?.name?.split(" ")[0] || appUser?.email?.split("@")[0] || "A";
  const profilePhotoURL = appUser?.photoURL || user?.photoURL || "";

  const thisMonthWorkouts = useMemo(() => {
    const now = new Date();
    return workouts.filter((workout) => {
      const date = parseSessionDate(workout.sessionDate);
      return (
        date &&
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth()
      );
    });
  }, [workouts]);

  const filteredWorkouts = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return workouts.filter((workout) => {
      const matchesType = activeFilter === "all" || workout.type === (activeFilter as WorkoutType);
      const matchesSearch =
        !term ||
        `${workout.title} ${workout.notes ?? ""} ${workout.stats.score ?? ""}`
          .toLowerCase()
          .includes(term);
      return matchesType && matchesSearch;
    });
  }, [activeFilter, searchTerm, workouts]);

  const groupedWorkouts = useMemo(() => {
    const groups: Record<string, WorkoutSession[]> = {
      "This week": [],
      "Last week": [],
      Earlier: [],
    };

    filteredWorkouts.forEach((workout) => {
      groups[groupLabel(workout.sessionDate)].push(workout);
    });

    return Object.entries(groups).filter(([, items]) => items.length);
  }, [filteredWorkouts]);

  return (
    <div className="carbon-fiber-bg min-h-screen overflow-x-hidden font-barlow text-[#f4f0ea]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_72%_0%,rgba(255,255,255,0.045),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.018),transparent_26%)]" />

      <main className="relative mx-auto min-h-screen max-w-xl px-5 pb-36 pt-7 sm:max-w-3xl sm:px-8">
        <header className="flex items-center justify-between" style={{ paddingTop: "env(safe-area-inset-top)" }}>
          <Link to="/dashboard" aria-label="Zero Alpha home" className="block">
            <img src="/ZERO-ALPHA.png" alt="ZERO-ALPHA" className="h-20 w-auto object-contain" />
          </Link>
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Search sessions"
              aria-pressed={searchOpen}
              onClick={() => setSearchOpen((open) => !open)}
              className="grid h-12 w-12 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white/55 transition hover:bg-white/[0.08] hover:text-white"
            >
              <Search className="h-5 w-5" />
            </button>
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

        <section className="mt-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[12px] font-bold uppercase tracking-[0.28em] text-white/34">
                Training log
              </p>
              <h1 className="mt-2 font-heading text-[3.6rem] uppercase leading-none text-white sm:text-[6rem]">
                Your sessions
              </h1>
            </div>
            <Link
              to="/workouts/new"
              className="mt-8 inline-flex shrink-0 items-center gap-2 rounded-full bg-[#f2eee8] px-5 py-3 text-base font-bold text-black shadow-[0_14px_36px_rgba(242,238,232,0.12)] transition hover:brightness-95"
            >
              <Plus className="h-5 w-5" />
              Log
            </Link>
          </div>
        </section>

        <section className="mt-7 border-y border-white/8 py-5">
          <div className="grid grid-cols-3 divide-x divide-white/8 text-center">
            {[
              { value: workouts.length, label: "Sessions" },
              { value: getDurationHours(thisMonthWorkouts), label: "This month" },
              { value: workouts.filter(isRecentPr).length, label: "PRs" },
            ].map(({ value, label }) => (
              <div key={label} className="px-2">
                <div className="font-mono text-[2rem] font-bold leading-none text-white">{value}</div>
                <div className="mt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white/32">
                  {label}
                </div>
              </div>
            ))}
          </div>
        </section>

        {searchOpen ? (
          <section className="mt-6">
            <label className="sr-only" htmlFor="session-search">
              Search sessions
            </label>
            <input
              id="session-search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search sessions"
              className="w-full rounded-[18px] border border-white/10 bg-[#151311] px-5 py-4 text-[15px] text-white outline-none placeholder:text-white/28 focus:border-white/25"
            />
          </section>
        ) : null}

        <section className="mt-7">
          <div className="flex gap-1 overflow-x-auto rounded-full border border-white/8 bg-white/[0.035] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {filterOptions.map((filter) => {
              const selected = filter.key === activeFilter;
              return (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => setActiveFilter(filter.key)}
                  className={[
                    "min-w-fit rounded-full px-4 py-2.5 text-sm font-bold transition",
                    selected
                      ? "bg-[#f2eee8] text-black"
                      : "text-white/42 hover:bg-white/[0.05] hover:text-white/75",
                  ].join(" ")}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>
        </section>

        <section className="mt-8 space-y-8">
          {groupedWorkouts.length ? (
            groupedWorkouts.map(([label, items]) => (
              <div key={label}>
                <div className="mb-3 grid grid-cols-[auto_auto_1fr] items-center gap-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-white/32">
                    {label}
                  </p>
                  <span className="font-mono text-xs text-white/22">{items.length}</span>
                  <div className="h-px bg-white/8" />
                </div>
                <div className="overflow-hidden rounded-[20px] border border-white/8 bg-[#11100f]/92">
                  {items.map((workout) => (
                    <WorkoutSessionCard key={workout.id} workout={workout} compact />
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-[28px] border border-dashed border-white/10 bg-[#151311] px-6 py-10 text-center">
              <div className="text-lg font-bold text-white">No sessions found.</div>
              <p className="mt-3 text-sm leading-7 text-white/48">
                Log your first workout and it will land here.
              </p>
            </div>
          )}
        </section>
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
    </div>
  );
}
