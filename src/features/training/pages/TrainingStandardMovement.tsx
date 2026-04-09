import React, { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  ChevronLeft,
  TimerReset,
  Trophy,
  Sparkles,
  BarChart3,
  CheckCircle2,
  Plus,
  Share2,
} from "lucide-react";
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { auth, db } from "../../../firebase";
import { getMovementBySlug } from "../../../lib/training";
import PBShareModal from "../../training/components/PBShareModal";
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

function shortDate(dateString: string) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
    }).format(new Date(dateString));
  } catch {
    return dateString;
  }
}

function parseChartValue(rawValue: string, unit?: string) {
  const value = rawValue.trim();

  if (!value) return null;

  // Handle mm:ss or m:ss
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

  // Plain numeric values
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }

  return null;
}

function formatSeconds(totalSeconds: number) {
  const safe = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function isTimeBasedMovement(categoryKey?: string | null, movementName?: string) {
  if (categoryKey !== "engine") return false;

  const name = movementName?.toLowerCase() ?? "";
  return (
    name.includes("run") ||
    name.includes("row") ||
    name.includes("ski") ||
    name.includes("bike") ||
    name.includes("time")
  );
}

function formatChartValue(
  value: number,
  categoryKey?: string | null,
  movementName?: string,
  unit?: string
) {
  const useTime =
    unit === "mm:ss" ||
    unit === "seconds" ||
    isTimeBasedMovement(categoryKey, movementName);

  if (useTime) {
    return formatSeconds(value);
  }

  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}

function getSmartFormConfig(args: {
  categoryKey?: string | null;
  movementName?: string;
  movementSlug?: string;
  metricType: string;
  unitOptions: string[];
}) {
  const { categoryKey, movementName, movementSlug, metricType, unitOptions } = args;

  const metric = metricType.toLowerCase();
  const movement = movementName?.toLowerCase() ?? "";
  const slug = movementSlug ?? "";

  const isTimeMetric =
    metric.includes("time") ||
    metric.includes("for time") ||
    metric.includes("trial") ||
    metric.includes("best time") ||
    metric.includes("average time");

  const isMaxRepsMetric = metric.includes("max reps") || metric.includes("max unbroken");
  const isWeightedMetric = metric.includes("weighted");
  const isVolumeMetric = metric.includes("volume");
  const isCheckInMetric = metric.includes("check-in");

  const isPersonal = categoryKey === "personal";
  const isEngine = categoryKey === "engine";
  const isPullUps = slug === "pull-ups";

  let valueLabel = "Value";
  let valuePlaceholder = "e.g. 100 or 1:42";
  let showRepsField = categoryKey === "strength" || categoryKey === "power";
  let repsLabel = "Reps";
  let repsPlaceholder = "e.g. 3";
  let showUnitSelector = true;
  let lockedUnit: string | null = null;

  if (isPersonal || isCheckInMetric) {
    valueLabel = "Result";
    valuePlaceholder = movement.includes("bodyweight")
      ? "e.g. 62.4"
      : movement.includes("resting hr")
      ? "e.g. 58"
      : movement.includes("body fat")
      ? "e.g. 21.5"
      : "Enter result";
    showRepsField = false;
    if (unitOptions.length === 1) {
      showUnitSelector = false;
      lockedUnit = unitOptions[0];
    }
  }

  if (isEngine || isTimeMetric) {
    valueLabel = "Time";
    valuePlaceholder = "e.g. 4:30";
    showRepsField = false;
    if (unitOptions.includes("mm:ss")) {
      showUnitSelector = false;
      lockedUnit = "mm:ss";
    } else if (unitOptions.length === 1) {
      showUnitSelector = false;
      lockedUnit = unitOptions[0];
    }
  }

  if (isMaxRepsMetric) {
    valueLabel = "Result";
    valuePlaceholder = "e.g. 12";
    showRepsField = false;

    if (isPullUps || unitOptions.includes("reps")) {
      showUnitSelector = false;
      lockedUnit = "reps";
    }
  }

  if (isWeightedMetric) {
    valueLabel = "Load";
    valuePlaceholder = "e.g. 10";
    showRepsField = true;
    repsLabel = "Reps";
    repsPlaceholder = "e.g. 5";

    if (unitOptions.includes("kg")) {
      showUnitSelector = false;
      lockedUnit = "kg";
    }
  }

  if (isVolumeMetric) {
    valueLabel = "Total";
    valuePlaceholder = "e.g. 40";
    showRepsField = false;

    if (unitOptions.length === 1) {
      showUnitSelector = false;
      lockedUnit = unitOptions[0];
    }
  }

  if (metric.includes("working set")) {
    valueLabel = "Load";
    valuePlaceholder = "e.g. 80";
    showRepsField = true;
    repsLabel = "Reps";
    repsPlaceholder = "e.g. 8";

    if (unitOptions.includes("kg")) {
      showUnitSelector = false;
      lockedUnit = "kg";
    }
  }

  if (metric.includes("1rm") || metric.includes("3rm") || metric.includes("5rm")) {
    valueLabel = "Load";
    valuePlaceholder = "e.g. 100";
    showRepsField = false;

    if (unitOptions.includes("kg")) {
      showUnitSelector = false;
      lockedUnit = "kg";
    }
  }

  if (movement.includes("assault bike") && metric.includes("test piece")) {
    valueLabel = "Calories";
    valuePlaceholder = "e.g. 18";
    showRepsField = false;

    if (unitOptions.includes("cals")) {
      showUnitSelector = false;
      lockedUnit = "cals";
    }
  }

  return {
    valueLabel,
    valuePlaceholder,
    showRepsField,
    repsLabel,
    repsPlaceholder,
    showUnitSelector,
    lockedUnit,
  };
}

function getAccentClasses(categoryKey?: string | null) {
  switch (categoryKey) {
    case "strength":
      return {
        glow: "bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.14),transparent_24%)]",
        softGlow:
          "bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.10),transparent_26%)]",
        badge: "border-sky-400/20 bg-sky-400/10 text-sky-100",
        badgeGlow:
          "border-sky-400/30 bg-sky-400/12 text-sky-100 shadow-[0_0_14px_rgba(59,130,246,0.32)]",
        button:
          "border-sky-300/15 bg-white text-black shadow-[0_10px_30px_rgba(59,130,246,0.16)]",
        line:
          "bg-gradient-to-r from-transparent via-sky-300/20 to-transparent",
        chartStroke: "#60a5fa",
        chartGrid: "rgba(255,255,255,0.08)",
        chartDot: "#dbeafe",
      };
    case "power":
      return {
        glow: "bg-[radial-gradient(circle_at_top_right,rgba(168,85,247,0.16),transparent_24%)]",
        softGlow:
          "bg-[radial-gradient(circle_at_top_left,rgba(217,70,239,0.10),transparent_26%)]",
        badge: "border-fuchsia-400/20 bg-fuchsia-400/10 text-fuchsia-100",
        badgeGlow:
          "border-fuchsia-400/30 bg-fuchsia-400/12 text-fuchsia-100 shadow-[0_0_14px_rgba(168,85,247,0.32)]",
        button:
          "border-fuchsia-300/15 bg-white text-black shadow-[0_10px_30px_rgba(168,85,247,0.18)]",
        line:
          "bg-gradient-to-r from-transparent via-fuchsia-300/20 to-transparent",
        chartStroke: "#d946ef",
        chartGrid: "rgba(255,255,255,0.08)",
        chartDot: "#fae8ff",
      };
    case "engine":
      return {
        glow: "bg-[radial-gradient(circle_at_top_right,rgba(249,115,22,0.16),transparent_24%)]",
        softGlow:
          "bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.10),transparent_26%)]",
        badge: "border-orange-400/20 bg-orange-400/10 text-orange-100",
        badgeGlow:
          "border-orange-400/30 bg-orange-400/12 text-orange-100 shadow-[0_0_14px_rgba(249,115,22,0.32)]",
        button:
          "border-orange-300/15 bg-white text-black shadow-[0_10px_30px_rgba(249,115,22,0.18)]",
        line:
          "bg-gradient-to-r from-transparent via-orange-300/20 to-transparent",
        chartStroke: "#fb923c",
        chartGrid: "rgba(255,255,255,0.08)",
        chartDot: "#ffedd5",
      };
    case "personal":
      return {
        glow: "bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.16),transparent_24%)]",
        softGlow:
          "bg-[radial-gradient(circle_at_top_left,rgba(20,184,166,0.10),transparent_26%)]",
        badge: "border-emerald-400/20 bg-emerald-400/10 text-emerald-100",
        badgeGlow:
          "border-emerald-400/30 bg-emerald-400/12 text-emerald-100 shadow-[0_0_14px_rgba(16,185,129,0.32)]",
        button:
          "border-emerald-300/15 bg-white text-black shadow-[0_10px_30px_rgba(16,185,129,0.18)]",
        line:
          "bg-gradient-to-r from-transparent via-emerald-300/20 to-transparent",
        chartStroke: "#34d399",
        chartGrid: "rgba(255,255,255,0.08)",
        chartDot: "#d1fae5",
      };
      case "zaps":
        return {
            glow: "bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.16),transparent_24%)]",
            softGlow:
            "bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.10),transparent_26%)]",
            badge: "border-amber-400/20 bg-amber-400/10 text-amber-100",
            badgeGlow:
            "border-amber-400/30 bg-amber-400/12 text-amber-100 shadow-[0_0_14px_rgba(245,158,11,0.32)]",
            button:
            "border-amber-300/15 bg-white text-black shadow-[0_10px_30px_rgba(245,158,11,0.18)]",
            line:
            "bg-gradient-to-r from-transparent via-amber-300/20 to-transparent",
            chartStroke: "#f59e0b",
            chartGrid: "rgba(255,255,255,0.08)",
            chartDot: "#fef3c7",
        };
    default:
      return {
        glow: "bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.06),transparent_24%)]",
        softGlow:
          "bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.05),transparent_26%)]",
        badge: "border-white/10 bg-white/[0.06] text-white/80",
        badgeGlow:
          "border-white/15 bg-white/[0.08] text-white shadow-[0_0_14px_rgba(255,255,255,0.14)]",
        button:
          "border-white/10 bg-white text-black shadow-[0_10px_30px_rgba(255,255,255,0.08)]",
        line:
          "bg-gradient-to-r from-transparent via-white/15 to-transparent",
        chartStroke: "#ffffff",
        chartGrid: "rgba(255,255,255,0.08)",
        chartDot: "#ffffff",
      };
  }
}

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

function isBetterPerformance(args: {
  categoryKey?: string | null;
  nextValue: number;
  currentBestValue: number | null;
}) {
  const { categoryKey, nextValue, currentBestValue } = args;

  if (currentBestValue === null) return true;

  // engine = lower is better
  if (categoryKey === "engine") {
    return nextValue < currentBestValue;
  }

  // everything else = higher is better
  return nextValue > currentBestValue;
}

export default function TrainingStandardMovement() {
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
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [activeMetricFilter, setActiveMetricFilter] = useState(
    movement?.metricTypes[0] ?? ""
    );

  const [shareOpen, setShareOpen] = useState(false);
  const [isNewPB, setIsNewPB] = useState(false);
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
    setDate(new Date().toISOString().slice(0, 10));
    setNotes("");
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
  setDate(new Date().toISOString().slice(0, 10));
  setNotes("");
  setSaved(false);
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

    const user = auth.currentUser;

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
  }, [selectedCategory, movement]);

  async function handleSubmit(e: React.FormEvent) {
  e.preventDefault();

  const user = auth.currentUser;

  if (!user || !selectedCategory || !movement) return;
  if (!value.trim() || !date.trim()) return;

  try {
    setIsSaving(true);
    setSaved(false);
    setIsNewPB(false);

    const submittedValue = value.trim();
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
  } finally {
    setIsSaving(false);
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
                    Movement Detail
                  </span>
                  <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 backdrop-blur">
                    Benchmark Tracking
                  </span>
                  <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 backdrop-blur">
                    Zero Alpha Performance
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
                Latest Entry
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
                Total Logs
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
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/42">
                    <BarChart3 className="h-3.5 w-3.5" />
                    Progress
                    </div>
                    <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em]">
                    Progress over time
                    </h2>
                    <p className="mt-2 max-w-2xl text-sm leading-7 text-white/62">
                    Track how this benchmark is moving across sessions and spot PB moments instantly.
                    </p>
                    <p className="mt-2 text-sm text-white/50">
                    {activeMetricFilter
                        ? `Viewing ${activeMetricFilter} entries.`
                        : "Select a metric type to view progress."}
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
                    {selectedCategory.key === "engine" ? "Current fastest" : "Current best"} · {activeMetricFilter}
                    </div>
                    <div className="mt-3 text-sm text-white/62">
                    {bestLog
                        ? `${bestLog.metricType} · ${prettyDate(bestLog.date)}`
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
          <section className="relative overflow-hidden rounded-[30px] border border-white/10 bg-neutral-950 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.35)] sm:p-6">
            <div className={`absolute inset-0 ${accent.softGlow}`} />
            <div className={`absolute inset-x-0 top-0 h-px ${accent.line}`} />

            <div className="relative mb-8 flex items-start justify-between gap-4">
              <div>
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/42">
                  <Sparkles className="h-3.5 w-3.5" />
                  Manual Log
                </div>
                <h2 className="text-2xl font-semibold tracking-[-0.03em]">
                  Log {movement.name}
                </h2>
                <p className="mt-3 max-w-xl text-sm leading-7 text-white/62">
                  Create a movement-specific entry with the right metric type,
                  unit, and session detail.
                </p>
              </div>
            </div>

            {loadError ? (
              <div className="relative mb-6 rounded-[22px] border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                {loadError}
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="relative space-y-6">
              <div className={`grid gap-4 ${formConfig.showUnitSelector ? "sm:grid-cols-2" : "sm:grid-cols-1"}`}>
                <label className="block">
                    <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-white/44">
                    Metric Type
                    </span>
                    <select
                    value={metricType}
                    onChange={(e) => setMetricType(e.target.value)}
                    className="w-full rounded-[22px] border border-white/10 bg-black px-4 py-3.5 text-sm text-white outline-none transition focus:border-white/20 focus:bg-neutral-950"
                    >
                    {movement.metricTypes.map((option) => (
                        <option key={option} value={option}>
                        {option}
                        </option>
                    ))}
                    </select>
                </label>

                {formConfig.showUnitSelector ? (
                    <label className="block">
                    <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-white/44">
                        Unit
                    </span>
                    <select
                        value={unit}
                        onChange={(e) => setUnit(e.target.value)}
                        className="w-full rounded-[22px] border border-white/10 bg-black px-4 py-3.5 text-sm text-white outline-none transition focus:border-white/20 focus:bg-neutral-950"
                    >
                        {movement.unitOptions.map((option) => (
                        <option key={option} value={option}>
                            {option}
                        </option>
                        ))}
                    </select>
                    </label>
                ) : (
                    <div className="block">
                    <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-white/44">
                        Unit
                    </span>
                    <div className="flex h-[54px] items-center rounded-[22px] border border-white/10 bg-black px-4 text-sm font-medium text-white/80">
                        {effectiveUnit || "Auto"}
                    </div>
                    </div>
                )}
                </div>

              <div
                className={`grid gap-4 ${
                    formConfig.showRepsField ? "sm:grid-cols-3" : "sm:grid-cols-2"
                }`}
                >
                <label className="block">
                    <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-white/44">
                    {formConfig.valueLabel}
                    </span>
                    <input
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={formConfig.valuePlaceholder}
                    className="w-full rounded-[22px] border border-white/10 bg-black px-4 py-3.5 text-sm text-white outline-none transition placeholder:text-white/22 focus:border-white/20 focus:bg-neutral-950"
                    />
                </label>

                {formConfig.showRepsField ? (
                    <label className="block">
                    <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-white/44">
                        {formConfig.repsLabel}
                    </span>
                    <input
                        value={reps}
                        onChange={(e) => setReps(e.target.value)}
                        placeholder={formConfig.repsPlaceholder}
                        className="w-full rounded-[22px] border border-white/10 bg-black px-4 py-3.5 text-sm text-white outline-none transition placeholder:text-white/22 focus:border-white/20 focus:bg-neutral-950"
                    />
                    </label>
                ) : null}

                <label className="block">
                    <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-white/44">
                    Date
                    </span>

                    <div className="relative">
                    <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        onClick={(e) => {
                        const input = e.currentTarget as HTMLInputElement & {
                            showPicker?: () => void;
                        };
                        input.showPicker?.();
                        }}
                        className="w-full rounded-[22px] border border-white/10 bg-black px-4 py-3.5 pr-12 text-sm text-white outline-none transition focus:border-white/20 focus:bg-neutral-950 [color-scheme:dark]"
                    />

                    <button
                        type="button"
                        onClick={(e) => {
                        const input = e.currentTarget.previousElementSibling as
                            | (HTMLInputElement & { showPicker?: () => void })
                            | null;
                        input?.showPicker?.();
                        }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full border border-white/10 bg-white/[0.03] p-2 text-white/55 transition hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
                        aria-label="Open calendar"
                    >
                        <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        className="h-4 w-4"
                        >
                        <path d="M8 2v4" />
                        <path d="M16 2v4" />
                        <rect x="3" y="4" width="18" height="18" rx="2" />
                        <path d="M3 10h18" />
                        </svg>
                    </button>
                    </div>
                </label>
                <label className="block">
                <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-white/44">
                    Notes
                </span>
                <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={5}
                    placeholder="Optional notes..."
                    className="w-full resize-none rounded-[22px] border border-white/10 bg-black px-4 py-3.5 text-sm text-white outline-none transition placeholder:text-white/22 focus:border-white/20 focus:bg-neutral-950"
                />
                </label>

                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <button
                  type="submit"
                  disabled={isSaving}
                  className={`inline-flex items-center gap-2 rounded-[22px] px-5 py-3.5 text-sm font-semibold transition hover:translate-y-[-1px] hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 ${accent.button}`}
                >
                  <Plus className="h-4 w-4" />
                  {isSaving ? "Saving..." : "Save log"}
                </button>

                {saved ? (
                  <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-sm font-medium text-emerald-100">
                    <CheckCircle2 className="h-4 w-4" />
                    {isNewPB ? "PB logged" : "Log saved"}
                  </div>
                ) : null}

                {saved && isNewPB && sharePayload ? (
                  <button
                    type="button"
                    onClick={() => setShareOpen(true)}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-white transition hover:border-white/20 hover:bg-white/[0.06]"
                  >
                    <Share2 className="h-4 w-4" />
                    Share PB
                  </button>
                ) : null}
              </div>

                </div>
            </form>
          </section>

          <section className="relative overflow-hidden rounded-[30px] border border-white/10 bg-neutral-950 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.35)] sm:p-6">
            <div className={`absolute inset-0 ${accent.glow}`} />
            <div className={`absolute inset-x-0 top-0 h-px ${accent.line}`} />

            <div className="relative mb-8 flex items-center justify-between gap-4">
              <div>
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/42">
                  <TimerReset className="h-3.5 w-3.5" />
                  History
                </div>
                <h2 className="text-2xl font-semibold tracking-[-0.03em]">
                {activeMetricFilter
                    ? `${movement.name} · ${activeMetricFilter}`
                    : `${movement.name} History`}
                </h2>
                <p className="mt-3 text-sm leading-7 text-white/62">
                {activeMetricFilter
                    ? `Your latest ${activeMetricFilter} entries for this movement.`
                    : "Your latest entries for this movement."}
                </p>
              </div>
            </div>

            <div className="relative space-y-4">
              {filteredLogs.length === 0 ? (
                <div className="rounded-[24px] border border-dashed border-white/10 bg-black/30 p-6 text-sm text-white/50">
                  No logs yet for {movement.name}.
                </div>
              ) : (
                filteredLogs.map((log, index) => {
                  const isBest = bestLog?.id === log.id;

                  return (
                    <div
                      key={log.id}
                      className="group relative overflow-hidden rounded-[24px] border border-white/10 bg-black/35 p-5 transition duration-300 hover:-translate-y-0.5 hover:border-white/15 hover:bg-black/45"
                    >
                      <div
                        className={`absolute inset-0 ${
                          isBest
                            ? accent.softGlow
                            : "bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.04),transparent_24%)]"
                        } opacity-70`}
                      />

                      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-lg font-semibold text-white">
                              {log.metricType}
                            </div>

                            {isBest ? (
                              <span
                                className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] ${accent.badgeGlow}`}
                              >
                                PB
                              </span>
                            ) : null}

                            {index === 0 ? (
                              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/50">
                                Latest
                              </span>
                            ) : null}
                          </div>

                          <div className="mt-2 text-sm text-white/56">
                            {log.reps ? `${log.reps} reps` : "Logged entry"}
                          </div>

                          {log.notes ? (
                            <p className="mt-4 max-w-xl text-sm leading-7 text-white/64">
                              {log.notes}
                            </p>
                          ) : null}
                        </div>

                        <div className="shrink-0 text-left sm:text-right flex flex-col items-end gap-2">

                        <button
                          type="button"
                          onClick={() => {
                            setSharePayload({
                              movement: movement.name,
                              metricType: log.metricType,
                              value: log.value,
                              unit: log.unit,
                              dateLabel: prettyDate(log.date),
                            });
                            setShareOpen(true);
                          }}
                          className="rounded-full border border-white/10 bg-white/[0.04] p-2 text-white/60 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
                        >
                          <Share2 className="h-4 w-4" />
                        </button>

                        <div className="text-2xl font-semibold tracking-[-0.03em] text-white">
                          {isTimeDisplay(log.unit, selectedCategory.key, movement.name) ? (
                            formatDisplayValue(log.value, log.unit, selectedCategory.key, movement.name)
                          ) : (
                            <>
                              {log.value}{" "}
                              <span className="text-sm font-medium text-white/52">
                                {log.unit}
                              </span>
                            </>
                          )}
                        </div>

                        <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/38">
                          {prettyDate(log.date)}
                        </div>

                      </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>
        <PBShareModal
          open={shareOpen && !!sharePayload}
          onClose={() => setShareOpen(false)}
          athleteName={auth.currentUser?.displayName || "AlphaFIT Athlete"}
          movement={sharePayload?.movement || movement.name}
          metricType={sharePayload?.metricType || metricType}
          value={sharePayload?.value || value}
          unit={sharePayload?.unit || effectiveUnit}
          dateLabel={sharePayload?.dateLabel || prettyDate(date)}
        />
      </div>
    </div>
  );
}