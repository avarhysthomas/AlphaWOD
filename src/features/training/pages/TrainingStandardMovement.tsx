import React, { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  ChevronLeft,
  Trophy,
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
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceDot,
} from "recharts";
import UserTopNav from "../../../components/layout/UserTopNav";
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

  const Icon = selectedCategory.icon;

  return (
    <div className="min-h-screen bg-black text-white">
        <UserTopNav />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="relative overflow-hidden rounded-[32px] border border-white/10 bg-neutral-950 shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_25%),radial-gradient(circle_at_85%_20%,rgba(59,130,246,0.18),transparent_28%),linear-gradient(135deg,rgba(255,255,255,0.03),transparent_55%)]" />
          <div className={`absolute inset-0 bg-gradient-to-br ${selectedCategory.accent} opacity-95`} />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:34px_34px] opacity-[0.07]" />
          <div className="absolute -right-6 bottom-[-18px] select-none text-[82px] font-black uppercase tracking-[0.22em] text-white/[0.05] sm:text-[120px] lg:text-[165px]">
            {movement.name.replace(/\s+/g, " ")}
          </div>

          <div className="relative p-6 sm:p-8 lg:p-10">
            <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.35em] text-white/78 backdrop-blur-md">
                  <Icon className="h-3.5 w-3.5" />
                  {selectedCategory.label}
                </div>

                <h1 className="text-4xl font-heading uppercase tracking-[-0.05em] sm:text-5xl lg:text-6xl">
                  {movement.name}
                </h1>

                <p className="mt-4 max-w-2xl text-sm leading-7 text-white/74 sm:text-base">
                  {movement.description}
                </p>

                <div className="mt-6 flex flex-wrap items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/45">
                  <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 backdrop-blur">
                    {movement.metricTypes.length} metrics
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <Link
                  to="/training"
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/25 px-5 py-3 text-sm font-semibold text-white/85 backdrop-blur-md transition hover:border-white/20 hover:bg-black/35 hover:text-white"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Performance
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

        <section className="grid gap-4 md:grid-cols-3">
          <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-neutral-950 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.35)]">
            <div className={`absolute inset-0 ${accent.glow}`} />
            <div className={`absolute inset-x-0 top-0 h-px ${accent.line}`} />
            <div className="relative">
            <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/42">
            {selectedCategory.key === "engine" ? "Fastest" : "Best"} · {activeMetricFilter}
            </div>
              <div className="mt-4 flex items-center gap-3">
                <div className={`rounded-2xl border p-3 ${accent.badgeGlow}`}>
                  <Trophy className="h-5 w-5" />
                </div>
                <div className="text-3xl font-semibold tracking-[-0.04em]">
                  {bestLog
                    ? formatDisplayValue(
                        bestLog.value,
                        bestLog.unit,
                        selectedCategory.key,
                        movement.name
                        )
                    : "—"}
                </div>
              </div>
              <div className="mt-3 text-sm text-white/62">
                {bestLog
                  ? `${bestLog.metricType} · ${prettyDate(bestLog.date)}`
                  : "No best entry yet"}
              </div>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-neutral-950 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.35)]">
            <div className={`absolute inset-0 ${accent.softGlow}`} />
            <div className={`absolute inset-x-0 top-0 h-px ${accent.line}`} />
            <div className="relative">
              <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/42">
                Latest
              </div>
              <div className="mt-4 text-3xl font-semibold tracking-[-0.04em]">
                {latestLog
                ? formatDisplayValue(
                    latestLog.value,
                    latestLog.unit,
                    selectedCategory.key,
                    movement.name
                    )
                : "—"}
              </div>
              <div className="mt-3 text-sm text-white/62">
                {latestLog
                  ? `${latestLog.metricType} · ${prettyDate(latestLog.date)}`
                  : "No logs yet"}
              </div>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-neutral-950 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.35)]">
            <div className={`absolute inset-0 ${accent.softGlow}`} />
            <div className={`absolute inset-x-0 top-0 h-px ${accent.line}`} />
            <div className="relative">
              <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/42">
                Entries
              </div>
              <div className="mt-4 text-3xl font-semibold tracking-[-0.04em]">
                {filteredLogs.length}
              </div>
              <div className="mt-3 text-sm text-white/62">
                Entries recorded for {movement.name}
              </div>
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden rounded-[30px] border border-white/10 bg-neutral-950 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.35)]">
          <div className={`absolute inset-0 ${accent.glow}`} />
          <div className={`absolute inset-x-0 top-0 h-px ${accent.line}`} />

          <div className="relative">
            <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-2xl font-semibold tracking-[-0.03em]">
                    Progress
                    </h2>
                    <p className="mt-2 max-w-2xl text-sm leading-7 text-white/62">
                    {activeMetricFilter
                        ? `${activeMetricFilter} across logged sessions.`
                        : "Select a metric to view progress."}
                    </p>
                    <div className="mt-5 flex flex-wrap gap-2">
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
                              "rounded-full border px-4 py-2 text-sm font-semibold transition",
                              isActive
                                ? `${accent.badgeGlow}`
                                : "border-white/10 bg-white/[0.03] text-white/65 hover:border-white/15 hover:bg-white/[0.05] hover:text-white",
                            ].join(" ")}
                          >
                            {option}
                          </button>
                        );
                      })}
                    </div>
                </div>

                <div className="rounded-[24px] border border-white/10 bg-black/30 px-5 py-4 text-sm text-white/62 backdrop-blur">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/38">
                    {selectedCategory.key === "engine" ? "Current fastest" : "Current best"}
                    </div>
                    <div className="mt-3 text-sm text-white/62">
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
                </div>

            {chartData.length >= 2 ? (
              <div className="h-[280px] w-full rounded-[24px] border border-white/10 bg-black/25 p-4">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={chartData}
                    margin={{ top: 16, right: 12, left: 0, bottom: 8 }}
                  >
                    <CartesianGrid stroke={accent.chartGrid} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="shortDate"
                      stroke="rgba(255,255,255,0.38)"
                      tickLine={false}
                      axisLine={false}
                      fontSize={12}
                    />
                    <YAxis
                        stroke="rgba(255,255,255,0.38)"
                        tickLine={false}
                        axisLine={false}
                        fontSize={12}
                        domain={[chartMin, chartMax]}
                        allowDecimals={selectedCategory.key === "personal"}
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
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke={accent.chartStroke}
                      strokeWidth={3}
                      dot={{
                        r: 4,
                        fill: accent.chartDot,
                        stroke: accent.chartStroke,
                        strokeWidth: 2,
                      }}
                      activeDot={{
                        r: 6,
                        fill: accent.chartDot,
                        stroke: accent.chartStroke,
                        strokeWidth: 2,
                      }}
                    />
                    {chartData
                      .filter((point) => point.isBest)
                      .map((point) => (
                        <ReferenceDot
                          key={point.id}
                          x={point.shortDate}
                          y={point.value}
                          r={7}
                          fill={accent.chartDot}
                          stroke={accent.chartStroke}
                          strokeWidth={3}
                        />
                      ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="rounded-[24px] border border-dashed border-white/10 bg-black/25 p-6 text-sm text-white/55">
                Add at least two numeric logs to unlock the movement progress chart.
              </div>
            )}
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[1.02fr_0.98fr]">
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
          />

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
      </div>
    </div>
  );
}
