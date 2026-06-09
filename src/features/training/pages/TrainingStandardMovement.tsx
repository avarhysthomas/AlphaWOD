import React, { useEffect, useMemo, useState } from "react";
import { Link, Navigate, NavLink, useParams } from "react-router-dom";
import {
  Bell,
  ChevronLeft,
  Plus,
  X,
} from "lucide-react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db } from "../../../firebase";
import { getMovementBySlug } from "../../../lib/training";
import PBShareModal from "../../training/components/PBShareModal";
import MovementHistorySection from "../components/MovementHistorySection";
import MovementLogForm from "../components/MovementLogForm";
import {
  ResponsiveContainer,
  AreaChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceDot,
} from "recharts";
import { getUserNavItems } from "../../../components/layout/UserTopNav";
import { useAuth } from "../../../context/AuthContext";
import {
  formatChartValue,
  formatDisplayValue,
  getAccentClasses,
  getSmartFormConfig,
  isBetterPerformance,
  isTimeDisplay,
  normalizeTrainingLogValue,
  parseChartValue,
  prettyDate,
  shortDate,
  type FormFieldErrors,
  validateTrainingLogForm,
} from "../utils/movementHelpers";
import { getDateInputValueInTimeZone } from "../../../utils/date";
import { createPerformanceFeedPost } from "../../workouts/services/workouts";

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

type ChartPoint = {
  id: string;
  date: string;
  shortDate: string;
  value: number;
  metricType: string;
  isBest: boolean;
};

function CustomTooltip({
  active,
  payload,
  label,
  categoryKey,
  movementName,
  unit,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartPoint }>;
  label?: string;
  categoryKey?: string | null;
  movementName?: string;
  unit?: string;
}) {
  if (!active || !payload?.length) return null;

  const point = payload[0].payload;

  return (
    <div className="rounded-2xl border border-white/10 bg-neutral-950/95 px-4 py-3 shadow-[0_16px_40px_rgba(0,0,0,0.35)] backdrop-blur">
      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/40">
        {label}
      </div>
      <div className="mt-2 text-lg font-semibold text-white">
        {formatChartValue(point.value, categoryKey, movementName, unit)}
      </div>
      <div className="mt-1 text-sm text-white/60">{point.metricType}</div>
    </div>
  );
}

export default function TrainingStandardMovement() {
  const timeZone = "Europe/London";
  const { user, appUser } = useAuth();
  const { category, movementSlug } = useParams<{
    category: string;
    movementSlug: string;
  }>();

  const result = getMovementBySlug(category, movementSlug);

  const selectedCategory = result?.category ?? null;
  const movement = result?.movement ?? null;

  const accent = getAccentClasses(selectedCategory?.key);

  const defaultMetricType = movement?.metricTypes[0] ?? "Entry";
  const defaultUnit = movement?.unitOptions[0] ?? "";

  const [logs, setLogs] = useState<TrainingLog[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saved, setSaved] = useState(false);
  const [metricType, setMetricType] = useState(defaultMetricType);
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState(defaultUnit);
  const [reps, setReps] = useState("");
  const [date, setDate] = useState(() =>
    getDateInputValueInTimeZone(new Date(), timeZone)
  );
  const [notes, setNotes] = useState("");
  const [formErrors, setFormErrors] = useState<FormFieldErrors>({});
  const [saveError, setSaveError] = useState("");
  const [activeMetricFilter, setActiveMetricFilter] = useState(
    movement?.metricTypes[0] ?? ""
    );
  const [logSheetOpen, setLogSheetOpen] = useState(false);

  const [shareOpen, setShareOpen] = useState(false);
  const [isNewPB, setIsNewPB] = useState(false);
  const [deletingLogId, setDeletingLogId] = useState<string | null>(null);
  const [postingLogId, setPostingLogId] = useState<string | null>(null);
  const [sharePayload, setSharePayload] = useState<{
    movement: string;
    metricType: string;
    value: string;
    unit?: string;
    dateLabel?: string;
  } | null>(null);

const movementLogs = useMemo(() => {
  if (!selectedCategory || !movement) return [];
  return [...logs].sort((a, b) => b.date.localeCompare(a.date));
}, [logs, selectedCategory, movement]);

const metricFilterOptions = useMemo(() => {
  return movement?.metricTypes ?? [];
}, [movement?.metricTypes]);

const filteredLogs = useMemo(() => {
  if (!activeMetricFilter) return [];
  return movementLogs.filter((log) => log.metricType === activeMetricFilter);
}, [movementLogs, activeMetricFilter]);

  const bestLog = useMemo(() => {
  if (!selectedCategory) return null;

  const numericLogs = filteredLogs
    .map((log) => ({
      ...log,
      parsed: parseChartValue(log.value, log.unit),
    }))
        .filter((log) => log.parsed !== null) as Array<
        TrainingLog & { parsed: number }
    >;

    if (!numericLogs.length) return null;

    if (selectedCategory.key === "engine") {
        return numericLogs.reduce((best, current) =>
        current.parsed < best.parsed ? current : best
        );
    }

    return numericLogs.reduce((best, current) =>
        current.parsed > best.parsed ? current : best
    );
    }, [filteredLogs, selectedCategory]);

  const latestLog = filteredLogs[0] ?? null;

  const chartData = useMemo<ChartPoint[]>(() => {
  const numeric = filteredLogs
    .map((log) => {
      const parsed = parseChartValue(log.value, log.unit);
      if (parsed === null) return null;

      return {
        id: log.id,
        date: prettyDate(log.date),
        shortDate: shortDate(log.date),
        value: parsed,
        metricType: log.metricType,
        isBest: bestLog?.id === log.id,
      };
    })
    .filter(Boolean) as ChartPoint[];

  return [...numeric].reverse();
}, [filteredLogs, bestLog]);

const formConfig = useMemo(() => {
  return getSmartFormConfig({
    categoryKey: selectedCategory?.key,
    movementName: movement?.name,
    movementSlug: movement?.slug,
    metricType,
    unitOptions: movement?.unitOptions ?? [],
  });
}, [
  selectedCategory?.key,
  movement?.name,
  movement?.slug,
  movement?.unitOptions,
  metricType,
]);

const effectiveUnit = formConfig.lockedUnit ?? unit;

  const chartMin = useMemo(() => {
    if (!chartData.length) return 0;
    const min = Math.min(...chartData.map((point) => point.value));
    return Math.max(0, min - Math.max(2, Math.round(min * 0.05)));
  }, [chartData]);

  const chartMax = useMemo(() => {
    if (!chartData.length) return 100;
    const max = Math.max(...chartData.map((point) => point.value));
    return max + Math.max(2, Math.round(max * 0.05));
  }, [chartData]);

    function resetForm() {
    const nextMetricType = movement?.metricTypes[0] ?? "Entry";

    setMetricType(nextMetricType);
    setValue("");

    const nextConfig = getSmartFormConfig({
        categoryKey: selectedCategory?.key,
        movementName: movement?.name,
        movementSlug: movement?.slug,
        metricType: nextMetricType,
        unitOptions: movement?.unitOptions ?? [],
    });

    setUnit(nextConfig.lockedUnit ?? movement?.unitOptions[0] ?? "");
    setReps("");
    setDate(getDateInputValueInTimeZone(new Date(), timeZone));
    setNotes("");
    setFormErrors({});
    setSaveError("");
    }

  useEffect(() => {
  const nextMetricType = movement?.metricTypes[0] ?? "Entry";

  setMetricType(nextMetricType);
  setValue("");

  const nextConfig = getSmartFormConfig({
    categoryKey: selectedCategory?.key,
    movementName: movement?.name,
    movementSlug: movement?.slug,
    metricType: nextMetricType,
    unitOptions: movement?.unitOptions ?? [],
  });

  setUnit(nextConfig.lockedUnit ?? movement?.unitOptions[0] ?? "");
  setReps("");
  setDate(getDateInputValueInTimeZone(new Date(), timeZone));
  setNotes("");
  setSaved(false);
  setFormErrors({});
  setSaveError("");
  setActiveMetricFilter(movement?.metricTypes[0] ?? "");
}, [
  selectedCategory?.key,
  movement?.slug,
  movement?.name,
  movement?.metricTypes,
  movement?.unitOptions,
]);

  useEffect(() => {
    if (!saved) return;

    const timer = window.setTimeout(() => setSaved(false), 2200);
    return () => window.clearTimeout(timer);
  }, [saved]);

  useEffect(() => {
    if (!selectedCategory || !movement) {
      setLogs([]);
      return;
    }

    if (!user) {
      setLogs([]);
      setLoadError("You need to be signed in to view training logs.");
      return;
    }

    setLoadError("");

    const logsRef = collection(db, "users", user.uid, "trainingLogs");
    const q = query(
      logsRef,
      where("category", "==", selectedCategory.key),
      where("movementSlug", "==", movement.slug),
      orderBy("date", "desc")
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
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

        setLogs(nextLogs);
      },
      (error) => {
        console.error("Error loading training logs:", error);
        setLoadError(error.message || "Could not load training logs.");
      }
    );

    return () => unsubscribe();
  }, [selectedCategory, movement, user]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!user || !selectedCategory || !movement) return;

    const nextErrors = validateTrainingLogForm({
      value,
      reps,
      date,
      notes,
      unit: effectiveUnit,
      categoryKey: selectedCategory.key,
      movementName: movement.name,
      showRepsField: formConfig.showRepsField,
    });

    setFormErrors(nextErrors);
    setSaveError("");

    if (Object.keys(nextErrors).length > 0) {
      setSaved(false);
      return;
    }

    try {
      setIsSaving(true);
      setSaved(false);
      setIsNewPB(false);

      const submittedValue = normalizeTrainingLogValue(value, effectiveUnit);
      const submittedUnit = effectiveUnit;
      const parsedSubmittedValue = parseChartValue(submittedValue, submittedUnit);

      const currentBestParsed =
        bestLog ? parseChartValue(bestLog.value, bestLog.unit) : null;

      const nextIsPB =
        parsedSubmittedValue !== null &&
        isBetterPerformance({
          categoryKey: selectedCategory.key,
          nextValue: parsedSubmittedValue,
          currentBestValue: currentBestParsed,
        });

      const logsRef = collection(db, "users", user.uid, "trainingLogs");

      await addDoc(logsRef, {
        userId: user.uid,
        category: selectedCategory.key,
        movementSlug: movement.slug,
        movementName: movement.name,
        metricType,
        value: submittedValue,
        unit: submittedUnit,
        reps: reps.trim(),
        date,
        notes: notes.trim(),
        createdAt: serverTimestamp(),
      });

      setIsNewPB(Boolean(nextIsPB));

      if (nextIsPB) {
        setSharePayload({
          movement: movement.name,
          metricType,
          value: submittedValue,
          unit: submittedUnit,
          dateLabel: prettyDate(date),
        });
      } else {
        setSharePayload(null);
      }

      resetForm();
      setSaved(true);
    } catch (error) {
      console.error("Error saving training log:", error);
      setSaveError("Could not save this log. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteLog(logId: string) {
    if (!user) return;

    const confirmed = window.confirm(
      "Delete this metric entry? This can’t be undone."
    );

    if (!confirmed) return;

    try {
      setDeletingLogId(logId);
      setSaveError("");

      await deleteDoc(doc(db, "users", user.uid, "trainingLogs", logId));

      if (sharePayload && filteredLogs.some((log) => log.id === logId)) {
        setShareOpen(false);
        setSharePayload((current) => {
          if (!current) return null;
          const deletedLog = filteredLogs.find((log) => log.id === logId);
          if (!deletedLog) return current;

          return current.value === deletedLog.value &&
            current.metricType === deletedLog.metricType &&
            current.dateLabel === prettyDate(deletedLog.date)
            ? null
            : current;
        });
      }
    } catch (error) {
      console.error("Error deleting training log:", error);
      setSaveError("Could not delete this log. Please try again.");
    } finally {
      setDeletingLogId(null);
    }
  }

  async function handlePostLogToFeed(log: TrainingLog) {
    if (!user || !selectedCategory || !movement) return;

    try {
      setPostingLogId(log.id);
      setSaveError("");

      await createPerformanceFeedPost({
        actorId: user.uid,
        actorName: appUser?.name || user.displayName || "Member",
        actorPhotoURL: user.photoURL || undefined,
        category: selectedCategory.key,
        movementSlug: movement.slug,
        movementName: movement.name,
        metricType: log.metricType,
        value: log.value,
        unit: log.unit,
        date: log.date,
        notes: log.notes,
      });
    } catch (error) {
      console.error("Error posting training log to feed:", error);
      setSaveError("Could not post this PB to the feed. Please try again.");
    } finally {
      setPostingLogId(null);
    }
  }

  if (!selectedCategory || !movement) {
    return <Navigate to="/training" replace />;
  }

  const navItems = getUserNavItems(appUser?.role);
  const firstName = appUser?.name?.split(" ")[0] || appUser?.email?.split("@")[0] || "there";
  const profilePhotoURL = appUser?.photoURL || user?.photoURL || "";
  const oldestLog = filteredLogs[filteredLogs.length - 1] ?? null;
  const daysTracked = oldestLog
    ? Math.max(
        0,
        Math.floor(
          (Date.now() - new Date(`${oldestLog.date}T00:00:00`).getTime()) / 86400000
        )
      )
    : 0;

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
            to={`/training/${selectedCategory.key}`}
            className="inline-flex items-center gap-2 text-sm font-bold text-white/34 transition hover:text-white/70"
          >
            <ChevronLeft className="h-4 w-4" />
            {selectedCategory.label}
          </Link>
          <p className="mt-8 text-[12px] font-bold uppercase tracking-[0.28em] text-white/34">
            Barbell · Benchmark
          </p>
          <h1 className="mt-5 font-heading text-[4.4rem] uppercase leading-none tracking-[0.01em] text-white sm:text-[6rem]">
            {movement.name}
          </h1>
        </section>

        <section className="mt-8 overflow-hidden rounded-[28px] border border-white/10 bg-[#151311] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
          <div className="flex items-start justify-between gap-4">
            <p className="text-[12px] font-bold uppercase tracking-[0.28em] text-white/34">
              Current {activeMetricFilter} · Best ever
            </p>
            {bestLog ? (
              <span className="rounded-full bg-white/[0.08] px-4 py-2 text-[12px] font-bold uppercase tracking-[0.12em] text-white/72">
                PR · {prettyDate(bestLog.date)}
              </span>
            ) : null}
          </div>

          <div className="mt-5 flex items-end gap-3">
            <div className="font-mono text-[4.2rem] leading-none text-[#f2eee8] sm:text-[5.4rem]">
              {bestLog
                ? formatDisplayValue(bestLog.value, bestLog.unit, selectedCategory.key, movement.name).replace(/\s?(kg|reps|bpm|%)$/i, "")
                : "—"}
            </div>
            {bestLog?.unit && bestLog.unit !== "mm:ss" ? (
              <div className="pb-3 text-lg font-bold uppercase tracking-[0.12em] text-white/36">
                {bestLog.unit}
              </div>
            ) : null}
          </div>

          {latestLog && bestLog ? (
            <p className="mt-3 font-mono text-[15px] text-emerald-300">
              ▲ Latest {formatDisplayValue(latestLog.value, latestLog.unit, selectedCategory.key, movement.name)}
            </p>
          ) : null}

          <div className="mt-7 flex flex-wrap gap-2">
            {metricFilterOptions.map((option) => {
              const isActive = activeMetricFilter === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setActiveMetricFilter(option);
                    setMetricType(option);
                  }}
                  className={[
                    "rounded-full border px-4 py-2 text-sm font-bold transition",
                    isActive
                      ? "border-white/20 bg-white/[0.12] text-white"
                      : "border-white/10 bg-white/[0.02] text-white/28 hover:text-white/65",
                  ].join(" ")}
                >
                  {option}
                </button>
              );
            })}
          </div>
        </section>

        <section className="mt-5 rounded-[24px] border border-white/10 bg-[#151311] p-5">
          <div className="grid grid-cols-3 divide-x divide-white/10 text-center">
            {[
              {
                label: `Best · ${activeMetricFilter}`,
                value: bestLog
                  ? formatDisplayValue(bestLog.value, bestLog.unit, selectedCategory.key, movement.name)
                  : "—",
              },
              {
                label: latestLog ? `Last · ${latestLog.metricType}` : "Latest",
                value: latestLog
                  ? formatDisplayValue(latestLog.value, latestLog.unit, selectedCategory.key, movement.name)
                  : "—",
              },
              { label: `${filteredLogs.length} logs`, value: `${daysTracked} d` },
            ].map(({ label, value }) => (
              <div key={label} className="px-2">
                <div className="font-mono text-2xl font-bold leading-none text-white sm:text-3xl">
                  {value}
                </div>
                <div className="mt-3 text-[10px] font-bold uppercase tracking-[0.14em] text-white/34">
                  {label}
                </div>
              </div>
            ))}
          </div>
        </section>

        <button
          type="button"
          onClick={() => setLogSheetOpen(true)}
          className="mt-6 flex w-full items-center justify-center gap-3 rounded-full bg-[#f2eee8] px-6 py-5 text-lg font-bold text-black transition hover:bg-white"
        >
          <Plus className="h-5 w-5" />
          Log set
        </button>

        <section className="mt-6 overflow-hidden rounded-[28px] border border-white/10 bg-[#151311] p-5 shadow-[0_24px_60px_rgba(0,0,0,0.35)]">

          <div className="relative">
            <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <p className="text-[12px] font-bold uppercase tracking-[0.28em] text-white/34">
                      Progress · {activeMetricFilter}
                    </p>
                </div>

                <div className="text-right text-sm text-white/62">
                    {bestLog
                        ? `${formatDisplayValue(
                            bestLog.value,
                            bestLog.unit,
                            selectedCategory.key,
                            movement.name
                          )} · ${prettyDate(bestLog.date)}`
                        : selectedCategory.key === "engine"
                        ? `No ${activeMetricFilter} time yet`
                        : `No ${activeMetricFilter} entry yet`}
                </div>
                </div>

            {chartData.length >= 2 ? (
              <div className="h-[300px] w-full overflow-hidden rounded-[24px] bg-black/10 px-1 py-2">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={chartData}
                    margin={{ top: 22, right: 10, left: -12, bottom: 6 }}
                  >
                    <defs>
                      <linearGradient id="movementProgressFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f2eee8" stopOpacity={0.28} />
                        <stop offset="52%" stopColor="#f2eee8" stopOpacity={0.11} />
                        <stop offset="100%" stopColor="#f2eee8" stopOpacity={0.01} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      stroke="rgba(255,255,255,0.075)"
                      vertical={false}
                      strokeDasharray="0"
                    />
                    <XAxis
                      dataKey="shortDate"
                      stroke="rgba(255,255,255,0.22)"
                      tickLine={false}
                      axisLine={false}
                      fontSize={11}
                      tickMargin={12}
                    />
                    <YAxis
                        stroke="rgba(255,255,255,0.18)"
                        tickLine={false}
                        axisLine={false}
                        fontSize={11}
                        domain={[chartMin, chartMax]}
                        allowDecimals={selectedCategory.key === "personal"}
                        width={52}
                        tickFormatter={(val) =>
                            formatChartValue(Number(val), selectedCategory.key, movement.name, effectiveUnit)
                    }
                    />
                    <Tooltip
                    content={
                        <CustomTooltip
                        categoryKey={selectedCategory.key}
                        movementName={movement.name}
                        unit={effectiveUnit}
                        />
                    }
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="none"
                      fill="url(#movementProgressFill)"
                      activeDot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="#f2eee8"
                      strokeWidth={3.5}
                      dot={{
                        r: 4.5,
                        fill: "#f2eee8",
                        stroke: "#151311",
                        strokeWidth: 2,
                      }}
                      activeDot={{
                        r: 7,
                        fill: "#f2eee8",
                        stroke: "rgba(242,238,232,0.22)",
                        strokeWidth: 8,
                      }}
                    />
                    {chartData
                      .filter((point) => point.isBest)
                      .map((point) => (
                        <ReferenceDot
                          key={point.id}
                          x={point.shortDate}
                          y={point.value}
                          r={8}
                          fill="#f2eee8"
                          stroke="rgba(242,238,232,0.2)"
                          strokeWidth={8}
                        />
                      ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="rounded-[24px] border border-dashed border-white/10 bg-black/25 p-6 text-sm text-white/55">
                Add at least two numeric logs to unlock the movement progress chart.
              </div>
            )}
          </div>
        </section>

        <div className="mt-6 grid gap-6">
          <MovementHistorySection
            accent={accent}
            movementName={movement.name}
            activeMetricFilter={activeMetricFilter}
            filteredLogs={filteredLogs}
            bestLogId={bestLog?.id}
            deletingLogId={deletingLogId}
            postingLogId={postingLogId}
            isTimeDisplay={(unitValue, movementNameValue) =>
              isTimeDisplay(unitValue, selectedCategory.key, movementNameValue)
            }
            formatDisplayValue={(rawValue, unitValue, movementNameValue) =>
              formatDisplayValue(rawValue, unitValue, selectedCategory.key, movementNameValue)
            }
            prettyDate={prettyDate}
            onShareLog={(log) => {
              setSharePayload({
                movement: movement.name,
                metricType: log.metricType,
                value: log.value,
                unit: log.unit,
                dateLabel: prettyDate(log.date),
              });
              setShareOpen(true);
            }}
            onPostToFeed={(log) => {
              void handlePostLogToFeed({
                ...log,
                category: selectedCategory.key,
                movementSlug: movement.slug,
                movementName: movement.name,
              });
            }}
            onDeleteLog={handleDeleteLog}
          />
        </div>
        {logSheetOpen ? (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/72 backdrop-blur-sm">
            <button
              type="button"
              className="absolute inset-0 cursor-default"
              aria-label="Close log set"
              onClick={() => setLogSheetOpen(false)}
            />
            <div className="relative max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-t-[32px] border border-white/10 bg-[#151311] p-4 shadow-[0_-24px_80px_rgba(0,0,0,0.55)] sm:max-w-2xl sm:p-5">
              <div className="mx-auto mb-5 h-1.5 w-16 rounded-full bg-white/22" />
              <button
                type="button"
                onClick={() => setLogSheetOpen(false)}
                className="absolute right-5 top-12 z-20 grid h-12 w-12 place-items-center rounded-full bg-white/[0.08] text-white/72 transition hover:bg-white/[0.12] hover:text-white"
                aria-label="Close log set"
              >
                <X className="h-6 w-6" />
              </button>
              <MovementLogForm
                movementName={movement.name}
                metricTypes={movement.metricTypes}
                unitOptions={movement.unitOptions}
                metricType={metricType}
                setMetricType={setMetricType}
                unit={unit}
                setUnit={setUnit}
                effectiveUnit={effectiveUnit}
                value={value}
                setValue={setValue}
                reps={reps}
                setReps={setReps}
                date={date}
                setDate={setDate}
                notes={notes}
                setNotes={setNotes}
                formConfig={formConfig}
                formErrors={formErrors}
                clearFieldError={(field) =>
                  setFormErrors((current) => ({ ...current, [field]: undefined }))
                }
                handleSubmit={handleSubmit}
                isSaving={isSaving}
                saved={saved}
                isNewPB={isNewPB}
                hasSharePayload={Boolean(sharePayload)}
                onShare={() => setShareOpen(true)}
                saveError={saveError}
                loadError={loadError}
                accent={accent}
                presentation="sheet"
                onCancel={() => setLogSheetOpen(false)}
                previousBestValue={bestLog?.value}
              />
            </div>
          </div>
        ) : null}
        <PBShareModal
          open={shareOpen && !!sharePayload}
          onClose={() => setShareOpen(false)}
          athleteName={appUser?.name || user?.displayName || "AlphaFIT Athlete"}
          movement={sharePayload?.movement || movement.name}
          metricType={sharePayload?.metricType || metricType}
          value={sharePayload?.value || value}
          unit={sharePayload?.unit || effectiveUnit}
          dateLabel={sharePayload?.dateLabel || prettyDate(date)}
          categoryKey={selectedCategory?.key}
        />
      </main>

      <nav
        className="fixed inset-x-3 z-40 mx-auto max-w-[27rem] rounded-[22px] border border-white/40 bg-white/90 px-2 py-1.5 shadow-[0_12px_34px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:max-w-xl"
        style={{ bottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        aria-label="Primary"
      >
        <div className="flex gap-1 overflow-x-auto px-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {navItems.map(({ to, label, icon: NavIcon }) => (
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
              <NavIcon className="h-[18px] w-[18px] text-black" />
              <span className="max-w-[56px] truncate leading-tight text-black">{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
