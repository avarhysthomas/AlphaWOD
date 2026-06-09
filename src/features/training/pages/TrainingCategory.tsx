import React, { useEffect, useMemo, useState } from "react";
import { Link, Navigate, NavLink, useParams } from "react-router-dom";
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  Search,
} from "lucide-react";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "../../../firebase";
import { useAuth } from "../../../context/AuthContext";
import { getUserNavItems } from "../../../components/layout/UserTopNav";
import { getCategoryByKey, type TrainingMovement } from "../../../lib/training";
import {
  formatDisplayValue,
  parseChartValue,
} from "../utils/movementHelpers";

type TrainingLog = {
  id: string;
  category: string;
  movementSlug: string;
  movementName: string;
  metricType: string;
  value: string;
  unit: string;
  date: string;
};

type MovementSummary = {
  movement: TrainingMovement;
  logs: TrainingLog[];
  bestLog: TrainingLog | null;
  latestLog: TrainingLog | null;
  tag: string;
};

function daysAgo(date?: string) {
  if (!date) return "No logs";
  const then = new Date(`${date}T00:00:00`);
  if (Number.isNaN(then.getTime())) return date;
  const days = Math.max(0, Math.floor((Date.now() - then.getTime()) / 86400000));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `Last ${days}d ago`;
}

function isLowerBetter(categoryKey?: string, movementName?: string, unit?: string) {
  const name = movementName?.toLowerCase() ?? "";
  return (
    categoryKey === "engine" ||
    unit === "mm:ss" ||
    unit === "seconds" ||
    name.includes("run") ||
    name.includes("row") ||
    name.includes("ski") ||
    name.includes("bike")
  );
}

function findBestLog(logs: TrainingLog[], categoryKey?: string) {
  const numeric = logs
    .map((log) => ({ log, parsed: parseChartValue(log.value, log.unit) }))
    .filter((item): item is { log: TrainingLog; parsed: number } => item.parsed !== null);

  if (!numeric.length) return null;

  return numeric.reduce((best, current) => {
    const lowerBetter = isLowerBetter(categoryKey, current.log.movementName, current.log.unit);
    return lowerBetter
      ? current.parsed < best.parsed ? current : best
      : current.parsed > best.parsed ? current : best;
  }).log;
}

function movementTag(categoryKey: string, movement: TrainingMovement) {
  const name = movement.name.toLowerCase();

  if (categoryKey === "strength" || categoryKey === "power") {
    if (name.includes("bench") || name.includes("press")) return "Push";
    if (name.includes("row") || name.includes("pull") || name.includes("deadlift")) return "Pull";
    if (name.includes("squat") || name.includes("sled") || name.includes("thrust")) return "Lower";
    if (name.includes("pull ups")) return "BW";
  }

  if (categoryKey === "engine") {
    if (name.includes("run")) return "Run";
    if (name.includes("row")) return "Row";
    if (name.includes("ski")) return "Ski";
    if (name.includes("bike")) return "Bike";
  }

  if (categoryKey === "personal") return "Check-in";
  if (categoryKey === "zaps") return "Standard";
  return "Benchmark";
}

function metricLabel(movement: TrainingMovement) {
  return movement.metricTypes[0] ?? "Result";
}

export default function TrainingCategory() {
  const { category } = useParams<{ category: string }>();
  const selectedCategory = getCategoryByKey(category);
  const { user, appUser } = useAuth();

  const [logs, setLogs] = useState<TrainingLog[]>([]);
  const [activeFilter, setActiveFilter] = useState("All");
  const [sortMode, setSortMode] = useState<"default" | "name">("default");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    if (!user || !selectedCategory) {
      setLogs([]);
      return;
    }

    const logsRef = collection(db, "users", user.uid, "trainingLogs");
    const logsQuery = query(
      logsRef,
      where("category", "==", selectedCategory.key),
      orderBy("date", "desc")
    );

    return onSnapshot(
      logsQuery,
      (snap) => {
        setLogs(
          snap.docs.map((doc) => {
            const data = doc.data();
            return {
              id: doc.id,
              category: data.category ?? "",
              movementSlug: data.movementSlug ?? "",
              movementName: data.movementName ?? "",
              metricType: data.metricType ?? "",
              value: data.value ?? "",
              unit: data.unit ?? "",
              date: data.date ?? "",
            };
          })
        );
      },
      (error) => console.error("Category logs fetch error:", error)
    );
  }, [selectedCategory, user]);

  const navItems = getUserNavItems(appUser?.role);
  const firstName = appUser?.name?.split(" ")[0] || appUser?.email?.split("@")[0] || "there";
  const profilePhotoURL = appUser?.photoURL || user?.photoURL || "";

  const summaries = useMemo<MovementSummary[]>(() => {
    if (!selectedCategory) return [];

    return selectedCategory.movements.map((movement) => {
      const movementLogs = logs.filter((log) => log.movementSlug === movement.slug);
      return {
        movement,
        logs: movementLogs,
        bestLog: findBestLog(movementLogs, selectedCategory.key),
        latestLog: movementLogs[0] ?? null,
        tag: movementTag(selectedCategory.key, movement),
      };
    });
  }, [logs, selectedCategory]);

  const filterOptions = useMemo(() => {
    const tags = Array.from(new Set(summaries.map((summary) => summary.tag)));
    return ["All", ...tags];
  }, [summaries]);

  const filteredSummaries = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    let rows = summaries.filter((summary) => activeFilter === "All" || summary.tag === activeFilter);

    if (term) {
      rows = rows.filter((summary) =>
        `${summary.movement.name} ${summary.tag} ${summary.movement.description}`
          .toLowerCase()
          .includes(term)
      );
    }

    if (sortMode === "name") {
      return [...rows].sort((a, b) => a.movement.name.localeCompare(b.movement.name));
    }

    return rows;
  }, [activeFilter, searchTerm, sortMode, summaries]);

  const recentPrs = logs.length;
  const heaviestKg = useMemo(() => {
    const values = logs
      .filter((log) => log.unit === "kg")
      .map((log) => Number(log.value))
      .filter((value) => Number.isFinite(value));
    if (!values.length) return null;
    return Math.max(...values);
  }, [logs]);

  if (!selectedCategory) {
    return <Navigate to="/training" replace />;
  }

  return (
    <div className="carbon-fiber-bg min-h-screen overflow-x-hidden font-barlow text-[#f4f0ea]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_right,rgba(120,95,70,0.16),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.025),transparent_22%)]" />

      <main className="relative mx-auto min-h-screen max-w-xl px-5 pb-32 pt-7 sm:max-w-3xl sm:px-8">
        <header className="flex items-center justify-between" style={{ paddingTop: "env(safe-area-inset-top)" }}>
          <Link to="/dashboard" aria-label="Zero Alpha home" className="block">
            <img src="/ZERO-ALPHA.png" alt="ZERO-ALPHA" className="h-20 w-auto object-contain" />
          </Link>
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Search movements"
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

        <section className="mt-12">
          <Link
            to="/training"
            className="inline-flex items-center gap-2 text-sm font-bold text-white/34 transition hover:text-white/70"
          >
            <ChevronLeft className="h-4 w-4" />
            Performance
          </Link>
          <p className="mt-8 text-[12px] font-bold uppercase tracking-[0.28em] text-white/34">
            Category
          </p>
          <h1 className="mt-5 font-heading text-[4.4rem] uppercase leading-none tracking-[0.01em] text-white sm:text-[6rem]">
            {selectedCategory.label}
          </h1>
        </section>

        <section className="mt-6 grid grid-cols-3 gap-4">
          {[
            { value: selectedCategory.movements.length, label: "Movements" },
            { value: recentPrs, label: "Recent PRs" },
            {
              value: heaviestKg !== null ? heaviestKg.toFixed(heaviestKg % 1 ? 1 : 0) : "-",
              label: "Heaviest · kg",
            },
          ].map(({ value, label }) => (
            <div key={label}>
              <div className="font-mono text-3xl leading-none text-white sm:text-4xl">{value}</div>
              <div className="mt-3 text-[11px] font-bold uppercase tracking-[0.14em] text-white/34">
                {label}
              </div>
            </div>
          ))}
        </section>

        {searchOpen ? (
          <section className="mt-6">
            <label className="sr-only" htmlFor="category-search">
              Search movements
            </label>
            <input
              id="category-search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search movement"
              className="w-full rounded-[18px] border border-white/10 bg-[#151311] px-5 py-4 text-[15px] text-white outline-none placeholder:text-white/28 focus:border-white/25"
            />
          </section>
        ) : null}

        <section className="mt-8">
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {filterOptions.map((filter) => {
              const selected = filter === activeFilter;
              return (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setActiveFilter(filter)}
                  className={[
                    "min-w-fit rounded-full border px-5 py-3 text-sm font-bold transition",
                    selected
                      ? "border-[#f2eee8] bg-[#f2eee8] text-black"
                      : "border-white/10 bg-[#151311] text-white/48 hover:bg-[#1b1815] hover:text-white/75",
                  ].join(" ")}
                >
                  {filter}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setSortMode((mode) => (mode === "default" ? "name" : "default"))}
              className="min-w-fit rounded-full border border-white/10 bg-[#151311] px-5 py-3 text-sm font-bold text-white/48 transition hover:bg-[#1b1815] hover:text-white/75"
            >
              Sort
            </button>
          </div>
        </section>

        <section className="mt-6 overflow-hidden rounded-[24px] border border-white/10 bg-[#151311]">
          {filteredSummaries.length === 0 ? (
            <div className="p-6">
              <p className="font-heading text-4xl uppercase leading-none text-white">No matches</p>
              <p className="mt-4 text-sm text-white/48">Try another filter or search term.</p>
            </div>
          ) : (
            filteredSummaries.map((summary) => {
              const best = summary.bestLog;
              const latest = summary.latestLog;
              const href = `/training/${selectedCategory.key}/${summary.movement.slug}`;

              return (
                <Link
                  key={summary.movement.slug}
                  to={href}
                  className="flex items-center gap-4 border-b border-white/8 px-5 py-5 last:border-b-0 transition hover:bg-white/[0.03]"
                >
                  <div className="min-w-0 flex-1">
                    <h2 className="font-heading text-3xl uppercase leading-none text-white">
                      {summary.movement.name}
                    </h2>
                    <p className="mt-2 truncate text-sm text-white/34">
                      {metricLabel(summary.movement)} · {summary.tag} · {daysAgo(latest?.date)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-mono text-3xl leading-none text-white">
                      {best ? formatDisplayValue(best.value, best.unit, selectedCategory.key, summary.movement.name) : "-"}
                    </div>
                    <div className="mt-2 text-sm text-emerald-300/80">
                      {best?.metricType || metricLabel(summary.movement)}
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-white/28" />
                </Link>
              );
            })
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
