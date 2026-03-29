import React, { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  ChevronLeft,
  ArrowUpRight,
  TimerReset,
  Link2,
} from "lucide-react";
import {
  collection,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { auth, db } from "../../../firebase";
import { getMovementBySlug } from "../../../lib/training";
import UserTopNav from "../../../components/layout/UserTopNav";

type TrainingLog = {
  id: string;
  category: string;
  movementSlug: string;
  movementName: string;
  metricType: string;
  value: string;
  unit: string;
  reps?: string;
  date: string;
  notes: string;
};

function prettyDate(dateString: string) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(dateString));
  } catch {
    return dateString;
  }
}

function parseChartValue(rawValue: string, unit?: string) {
  const value = rawValue.trim();
  if (!value) return null;

  if (value.includes(":")) {
    const parts = value.split(":").map((part) => part.trim());
    if (parts.length === 2) {
      const minutes = Number(parts[0]);
      const seconds = Number(parts[1]);
      if (Number.isFinite(minutes) && Number.isFinite(seconds)) {
        return minutes * 60 + seconds;
      }
    }
  }

  const parsed = Number(value);
  if (Number.isFinite(parsed)) return parsed;

  return null;
}

function formatSeconds(totalSeconds: number) {
  const safe = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function isTimeBasedMovement(categoryKey?: string | null, movementName?: string) {
  if (categoryKey !== "engine" && categoryKey !== "zaps") return false;

  const name = movementName?.toLowerCase() ?? "";
  return (
    name.includes("run") ||
    name.includes("row") ||
    name.includes("ski") ||
    name.includes("bike") ||
    name.includes("time") ||
    name.includes("aerobic")
  );
}

function isTimeDisplay(unit?: string, categoryKey?: string | null, movementName?: string) {
  if (unit === "mm:ss" || unit === "seconds") return true;
  return isTimeBasedMovement(categoryKey, movementName);
}

function formatDisplayValue(
  rawValue: string,
  unit?: string,
  categoryKey?: string | null,
  movementName?: string
) {
  if (isTimeDisplay(unit, categoryKey, movementName)) {
    const parsed = parseChartValue(rawValue, unit);
    if (parsed === null) return rawValue;
    return formatSeconds(parsed);
  }

  return unit ? `${rawValue} ${unit}` : rawValue;
}

function getAccentClasses(categoryKey?: string | null) {
  switch (categoryKey) {
    case "zaps":
      return {
        glow: "bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.18),transparent_24%)]",
        softGlow:
          "bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.12),transparent_26%)]",
        badge: "border-amber-400/20 bg-amber-400/10 text-amber-100",
        badgeGlow:
          "border-amber-400/30 bg-amber-400/15 text-amber-100 shadow-[0_0_18px_rgba(245,158,11,0.35)]",
        line:
          "bg-gradient-to-r from-transparent via-amber-300/25 to-transparent",
      };
    default:
      return {
        glow: "bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.06),transparent_24%)]",
        softGlow:
          "bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.05),transparent_26%)]",
        badge: "border-white/10 bg-white/[0.06] text-white/80",
        badgeGlow:
          "border-white/15 bg-white/[0.08] text-white shadow-[0_0_14px_rgba(255,255,255,0.14)]",
        line:
          "bg-gradient-to-r from-transparent via-white/15 to-transparent",
      };
  }
}

function getBestLog(logs: TrainingLog[], lowerIsBetter = false) {
  const numericLogs = logs
    .map((log) => ({ ...log, parsed: parseChartValue(log.value, log.unit) }))
    .filter((log) => log.parsed !== null) as Array<TrainingLog & { parsed: number }>;

  if (!numericLogs.length) return null;

  if (lowerIsBetter) {
    return numericLogs.reduce((best, current) =>
      current.parsed < best.parsed ? current : best
    );
  }

  return numericLogs.reduce((best, current) =>
    current.parsed > best.parsed ? current : best
  );
}

function SummaryCard({
  title,
  value,
  subtext,
  accentLine,
}: {
  title: string;
  value: string;
  subtext: string;
  accentLine: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-neutral-950 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.35)]">
      <div className={`absolute inset-x-0 top-0 h-px ${accentLine}`} />
      <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/42">
        {title}
      </div>
      <div className="mt-4 text-3xl font-semibold tracking-[-0.04em]">{value}</div>
      <div className="mt-3 text-sm text-white/62">{subtext}</div>
    </div>
  );
}

function LinkedSourceCard({
  title,
  logs,
  lowerIsBetter,
  sourceHref,
  accent,
  sourceCategoryKey,
}: {
  title: string;
  logs: TrainingLog[];
  lowerIsBetter?: boolean;
  sourceHref: string;
  accent: ReturnType<typeof getAccentClasses>;
  sourceCategoryKey?: string;
}) {
  const bestLog = useMemo(() => getBestLog(logs, lowerIsBetter), [logs, lowerIsBetter]);
  const latestLog = logs[0] ?? null;

  return (
    <div className="relative overflow-hidden rounded-[30px] border border-white/10 bg-neutral-950 p-6 shadow-[0_24px_60px_rgba(0,0,0,0.35)]">
      <div className={`absolute inset-0 ${accent.softGlow}`} />
      <div className={`absolute inset-x-0 top-0 h-px ${accent.line}`} />

      <div className="relative flex items-start justify-between gap-4">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/42">
            <Link2 className="h-3.5 w-3.5" />
            Linked benchmark
          </div>
          <h3 className="text-2xl font-semibold tracking-[-0.03em]">{title}</h3>
          <p className="mt-2 text-sm text-white/60">
            Synced from your logged movement data.
          </p>
        </div>

        <Link
          to={sourceHref}
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
        >
          Open source
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="relative mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-[24px] border border-white/10 bg-black/30 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/38">
            {lowerIsBetter ? "Fastest" : "Best"}
          </div>
          <div className="mt-2 text-2xl font-semibold">
            {bestLog
              ? formatDisplayValue(
                  bestLog.value,
                  bestLog.unit,
                  sourceCategoryKey,
                  title
                )
              : "—"}
          </div>
          <div className="mt-2 text-sm text-white/58">
            {bestLog
              ? `${bestLog.metricType} · ${prettyDate(bestLog.date)}`
              : "No benchmark logged yet"}
          </div>
        </div>

        <div className="rounded-[24px] border border-white/10 bg-black/30 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/38">
            Latest
          </div>
          <div className="mt-2 text-2xl font-semibold">
            {latestLog
              ? formatDisplayValue(
                  latestLog.value,
                  latestLog.unit,
                  sourceCategoryKey,
                  title
                )
              : "—"}
          </div>
          <div className="mt-2 text-sm text-white/58">
            {latestLog
              ? `${latestLog.metricType} · ${prettyDate(latestLog.date)}`
              : "No benchmark logged yet"}
          </div>
        </div>
      </div>

      <div className="relative mt-6">
        <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/40">
          <TimerReset className="h-3.5 w-3.5" />
          Recent history
        </div>

        <div className="space-y-3">
          {logs.length === 0 ? (
            <div className="rounded-[22px] border border-dashed border-white/10 bg-black/25 p-4 text-sm text-white/50">
              No linked entries found yet.
            </div>
          ) : (
            logs.slice(0, 4).map((log) => (
              <div
                key={log.id}
                className="rounded-[22px] border border-white/10 bg-black/25 p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-base font-semibold">{log.metricType}</div>
                    <div className="mt-1 text-sm text-white/55">
                      {log.reps ? `${log.reps} reps` : "Logged entry"}
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-lg font-semibold">
                      {formatDisplayValue(
                        log.value,
                        log.unit,
                        sourceCategoryKey,
                        title
                      )}
                    </div>
                    <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/40">
                      {prettyDate(log.date)}
                    </div>
                  </div>
                </div>

                {log.notes ? (
                  <p className="mt-3 text-sm leading-6 text-white/62">{log.notes}</p>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default function TrainingLinkedMovement() {
  const { category, movementSlug } = useParams<{
    category: string;
    movementSlug: string;
  }>();

  const result = getMovementBySlug(category, movementSlug);

  const selectedCategory = result?.category ?? null;
  const movement = result?.movement ?? null;

  const accent = getAccentClasses(selectedCategory?.key);

  const [allLogs, setAllLogs] = useState<TrainingLog[]>([]);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!selectedCategory || !movement) {
      setAllLogs([]);
      return;
    }

    const user = auth.currentUser;

    if (!user) {
      setAllLogs([]);
      setLoadError("You need to be signed in to view linked benchmarks.");
      return;
    }

    setLoadError("");

    const sourceSlugs = movement.linkedMovementSlugs ?? [];
    if (!sourceSlugs.length) {
      setAllLogs([]);
      return;
    }

    const logsRef = collection(db, "users", user.uid, "trainingLogs");

    const unsubscribers = sourceSlugs.map((slug) => {
      const q = query(logsRef, where("movementSlug", "==", slug));

      return onSnapshot(
        q,
        (snapshot) => {
          setAllLogs((prev) => {
            const otherLogs = prev.filter((log) => log.movementSlug !== slug);

            const nextLogs: TrainingLog[] = snapshot.docs.map((doc) => {
              const data = doc.data();
              return {
                id: doc.id,
                category: data.category ?? "",
                movementSlug: data.movementSlug ?? "",
                movementName: data.movementName ?? "",
                metricType: data.metricType ?? "",
                value: data.value ?? "",
                unit: data.unit ?? "",
                reps: data.reps ?? "",
                date: data.date ?? "",
                notes: data.notes ?? "",
              };
            });

            return [...otherLogs, ...nextLogs].sort((a, b) =>
              b.date.localeCompare(a.date)
            );
          });
        },
        (error) => {
          console.error("Error loading linked movement logs:", error);
          setLoadError(error.message || "Could not load linked benchmarks.");
        }
      );
    });

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [selectedCategory, movement]);

  if (!selectedCategory || !movement) {
    return <Navigate to="/training" replace />;
  }

  const Icon = selectedCategory.icon;
  const linkedSlugs = movement.linkedMovementSlugs ?? [];

  const linkedGroups = linkedSlugs.map((slug) => {
    const logs = allLogs
      .filter((log) => log.movementSlug === slug)
      .sort((a, b) => b.date.localeCompare(a.date));

    const label =
      slug === "2km-run"
        ? "2km Run"
        : slug === "back-squat"
        ? "Back Squat"
        : slug === "flat-bench"
        ? "Flat Bench"
        : slug;

    const href =
      slug === "2km-run"
        ? "/training/engine/2km-run"
        : slug === "back-squat"
        ? "/training/strength/back-squat"
        : slug === "flat-bench"
        ? "/training/strength/flat-bench"
        : `/training/${selectedCategory.key}/${slug}`;

    const lowerIsBetter = slug === "2km-run";

    const sourceCategoryKey =
      slug === "2km-run" ? "engine" : "strength";

    return {
      slug,
      label,
      href,
      logs,
      lowerIsBetter,
      sourceCategoryKey,
    };
  });

  const totalLinkedEntries = allLogs.length;

  return (
    <div className="min-h-screen bg-black text-white">
        <UserTopNav />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="relative overflow-hidden rounded-[32px] border border-white/10 bg-neutral-950 shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
          <div className={`absolute inset-0 ${accent.glow}`} />
          <div className={`absolute inset-x-0 top-0 h-px ${accent.line}`} />
          <div className="absolute -right-6 bottom-[-18px] select-none text-[82px] font-black uppercase tracking-[0.22em] text-white/[0.05] sm:text-[120px] lg:text-[165px]">
            {movement.name}
          </div>

          <div className="relative p-6 sm:p-8 lg:p-10">
            <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.35em] text-white/78 backdrop-blur-md">
                  <Icon className="h-3.5 w-3.5" />
                  {selectedCategory.label}
                </div>

                <h1 className="text-4xl font-heading uppercase tracking-[-0.04em] sm:text-5xl lg:text-6xl">
                  {movement.name}
                </h1>

                <p className="mt-4 max-w-2xl text-sm leading-7 text-white/70 sm:text-base">
                  {movement.description}
                </p>

                <div className="mt-6 flex flex-wrap gap-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/45">
                  <span className={`rounded-full border px-3 py-1.5 ${accent.badge}`}>
                    Linked benchmark
                  </span>
                  <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">
                    {linkedGroups.length} data source{linkedGroups.length === 1 ? "" : "s"}
                  </span>
                  <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">
                    {totalLinkedEntries} total entries
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <Link
                  to="/training"
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/25 px-5 py-3 text-sm font-semibold text-white/85 backdrop-blur-md transition hover:border-white/20 hover:bg-black/35 hover:text-white"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Training
                </Link>

                <Link
                  to={`/training/${selectedCategory.key}`}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/25 px-5 py-3 text-sm font-semibold text-white/85 backdrop-blur-md transition hover:border-white/20 hover:bg-black/35 hover:text-white"
                >
                  {selectedCategory.label}
                </Link>
              </div>
            </div>
          </div>
        </section>

        {loadError ? (
          <div className="rounded-[24px] border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {loadError}
          </div>
        ) : null}

        <section className="grid gap-4 md:grid-cols-3">
          <SummaryCard
            title="Linked Sources"
            value={String(linkedGroups.length)}
            subtext="Benchmarks feeding this ZAPS view"
            accentLine={accent.line}
          />
          <SummaryCard
            title="Total Entries"
            value={String(totalLinkedEntries)}
            subtext="Combined linked history"
            accentLine={accent.line}
          />
          <SummaryCard
            title="Mode"
            value="Synced"
            subtext="Reading from your existing benchmark logs"
            accentLine={accent.line}
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          {linkedGroups.map((group) => (
            <LinkedSourceCard
              key={group.slug}
              title={group.label}
              logs={group.logs}
              lowerIsBetter={group.lowerIsBetter}
              sourceHref={group.href}
              accent={accent}
              sourceCategoryKey={group.sourceCategoryKey}
            />
          ))}
        </section>
      </div>
    </div>
  );
}