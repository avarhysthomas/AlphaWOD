import React, { useEffect, useMemo, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import {
  Bell,
  ChevronRight,
  Search,
  Trophy,
} from "lucide-react";
import { db } from "../../../firebase";
import { useAuth } from "../../../context/AuthContext";
import { getUserNavItems } from "../../../components/layout/UserTopNav";
import { TRAINING_CATEGORIES, getCategoryByKey } from "../../../lib/training";

type TrainingLog = {
  id: string;
  category?: string;
  movementSlug?: string;
  movementName?: string;
  metricType?: string;
  value?: string;
  unit?: string;
  reps?: string;
  date?: string;
};

function formatLogValue(log: TrainingLog) {
  const value = String(log.value ?? "").trim();
  const unit = String(log.unit ?? "").trim();
  if (!value) return "--";
  if (!unit || unit === "mm:ss") return value;
  return `${value} ${unit}`;
}

function relativeDate(date?: string) {
  if (!date) return "Recently";
  const then = new Date(`${date}T00:00:00`);
  if (Number.isNaN(then.getTime())) return date;

  const days = Math.max(0, Math.floor((Date.now() - then.getTime()) / 86400000));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 14) return `${days} days ago`;
  return then.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default function Training() {
  const { user, appUser } = useAuth();
  const [logs, setLogs] = useState<TrainingLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    if (!user) {
      setLogs([]);
      setLoadingLogs(false);
      return;
    }

    let isMounted = true;
    const uid = user.uid;
    setLoadingLogs(true);

    async function loadLogs() {
      try {
        const logsRef = collection(db, "users", uid, "trainingLogs");
        const logsQuery = query(logsRef, orderBy("date", "desc"));
        const snap = await getDocs(logsQuery);

        if (!isMounted) return;

        setLogs(
          snap.docs.map((doc) => ({
            id: doc.id,
            ...(doc.data() as Omit<TrainingLog, "id">),
          }))
        );
        setLoadingLogs(false);
      } catch (error) {
        if (!isMounted) return;
        console.error("Training logs fetch error:", error);
        setLoadingLogs(false);
      }
    }

    loadLogs();

    return () => {
      isMounted = false;
    };
  }, [user]);

  const navItems = getUserNavItems(appUser?.role);
  const firstName = appUser?.name?.split(" ")[0] || appUser?.email?.split("@")[0] || "there";
  const profilePhotoURL = appUser?.photoURL || user?.photoURL || "";

  const totalMovements = TRAINING_CATEGORIES.reduce(
    (total, category) => total + category.movements.length,
    0
  );

  const filteredCategories = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return TRAINING_CATEGORIES;

    return TRAINING_CATEGORIES.filter((category) => {
      const movementText = category.movements
        .map((movement) => `${movement.name} ${movement.description}`)
        .join(" ");
      return `${category.label} ${category.description} ${movementText}`
        .toLowerCase()
        .includes(term);
    });
  }, [searchTerm]);

  const recentLogs = logs.slice(0, 8);
  const uniqueLoggedMovements = new Set(logs.map((log) => log.movementSlug).filter(Boolean)).size;
  const loggedCategories = new Set(logs.map((log) => log.category).filter(Boolean)).size;

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
              aria-label="Search performance"
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

        <section className="mt-12 sm:mt-16">
          <h1 className="mt-6 max-w-[11ch] font-heading text-[4rem] uppercase leading-[0.98] tracking-[0.01em] text-white sm:text-[5.7rem]">
            Performance hub
          </h1>
          <p className="mt-6 max-w-md text-[17px] leading-7 text-white/58">
            Track your performance across all categories.
          </p>
        </section>

        {searchOpen ? (
          <section className="mt-6">
            <label className="sr-only" htmlFor="performance-search">
              Search performance
            </label>
            <input
              id="performance-search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search category or movement"
              className="w-full rounded-[18px] border border-white/10 bg-[#151311] px-5 py-4 text-[15px] text-white outline-none placeholder:text-white/28 focus:border-white/25"
            />
          </section>
        ) : null}

        <section className="mt-9 rounded-[24px] border border-white/10 bg-[#151311] p-5">
          <div className="grid grid-cols-3 divide-x divide-white/10 text-center">
            {[
              { value: totalMovements, label: "Movements" },
              { value: TRAINING_CATEGORIES.length, label: "Categories" },
              { value: uniqueLoggedMovements, label: "Logged" },
            ].map(({ value, label }) => (
              <div key={label} className="px-2">
                <div className="font-heading text-4xl leading-none text-white">{value}</div>
                <div className="mt-3 text-[11px] font-bold uppercase tracking-[0.16em] text-white/34">
                  {label}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-10">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-[12px] font-bold uppercase tracking-[0.28em] text-white/34">
              Recently logged
            </p>
            <span className="text-sm font-bold text-white/50">
              {loadingLogs ? "Loading" : `${logs.length} total`}
            </span>
          </div>

          {recentLogs.length > 0 ? (
            <div className="flex gap-4 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {recentLogs.map((log) => {
                const category = getCategoryByKey(log.category);
                const href =
                  log.category && log.movementSlug
                    ? `/training/${log.category}/${log.movementSlug}`
                    : "/training";

                return (
                  <Link
                    key={log.id}
                    to={href}
                    className="min-w-[168px] rounded-[20px] border border-white/10 bg-[#151311] p-5 transition hover:bg-[#1b1815]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-h-[2.5rem] flex-1 text-[11px] font-bold uppercase leading-5 tracking-[0.16em] text-white/68">
                        {log.movementName || "Movement"}
                      </p>
                      {category ? (
                        <category.icon className="h-4 w-4 shrink-0 text-white/34" />
                      ) : (
                        <Trophy className="h-4 w-4 shrink-0 text-white/34" />
                      )}
                    </div>
                    <div className="mt-5 font-mono text-3xl leading-none text-white">
                      {formatLogValue(log)}
                    </div>
                    <div className="mt-3 text-sm text-white/35">{log.metricType || "Result"}</div>
                    <div className="mt-1 text-sm text-white/28">{relativeDate(log.date)}</div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="rounded-[24px] border border-white/10 bg-[#151311] p-7">
              <p className="font-heading text-4xl uppercase leading-none text-white">
                No logs yet
              </p>
              <p className="mt-4 text-sm leading-6 text-white/48">
                Pick a category below and add your first benchmark.
              </p>
            </div>
          )}
        </section>

        <section className="mt-10">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-[12px] font-bold uppercase tracking-[0.28em] text-white/34">
              Categories
            </p>
            <span className="text-sm font-bold text-white/50">
              {loggedCategories || 0} active
            </span>
          </div>

          <div className="space-y-3">
            {filteredCategories.map((category) => {
              const Icon = category.icon;
              const loggedCount = logs.filter((log) => log.category === category.key).length;

              return (
                <Link
                  key={category.key}
                  to={`/training/${category.key}`}
                  className="flex items-center gap-4 rounded-[20px] border border-white/10 bg-[#151311] p-4 transition hover:bg-[#1b1815]"
                >
                  <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.05] text-white/62">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="font-heading text-3xl uppercase leading-none text-white">
                        {category.label}
                      </h2>
                      {loggedCount > 0 ? (
                        <span className="rounded-md bg-white/[0.08] px-2 py-1 text-[11px] font-bold text-white/70">
                          {loggedCount}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-heading text-2xl leading-none text-white">
                      {category.movements.length}
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-white/28" />
                </Link>
              );
            })}
          </div>
        </section>
      </main>

      <nav
        className="fixed inset-x-3 z-40 mx-auto max-w-[27rem] rounded-[22px] border border-white/40 bg-white/90 px-2 py-1.5 shadow-[0_12px_34px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:max-w-xl"
        style={{ bottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        aria-label="Primary"
      >
        <div className="flex gap-1 overflow-x-auto px-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                [
                  "flex min-w-[56px] shrink-0 flex-col items-center gap-0.5 rounded-[14px] px-1.5 py-1 text-[10px] font-extrabold leading-tight transition",
                  isActive ? "bg-black/12 text-black" : "text-black hover:bg-black/6",
                ].join(" ")
              }
            >
              <Icon className="h-[18px] w-[18px] text-black" />
              <span className="max-w-[56px] truncate leading-tight text-black">{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
