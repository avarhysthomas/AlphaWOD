export type FormFieldErrors = {
  value?: string;
  reps?: string;
  date?: string;
  notes?: string;
};

export type SmartFormConfig = {
  valueLabel: string;
  valuePlaceholder: string;
  showRepsField: boolean;
  repsLabel: string;
  repsPlaceholder: string;
  showUnitSelector: boolean;
  lockedUnit: string | null;
};

export type AccentClasses = {
  glow: string;
  softGlow: string;
  badge: string;
  badgeGlow: string;
  button: string;
  line: string;
  chartStroke: string;
  chartGrid: string;
  chartDot: string;
};

export function prettyDate(dateString: string) {
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

export function shortDate(dateString: string) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
    }).format(new Date(dateString));
  } catch {
    return dateString;
  }
}

export function parseChartValue(rawValue: string, unit?: string) {
  const value = rawValue.trim();

  if (!value) return null;

  const isMinuteSecondTime = unit === "mm:ss";

  if (value.includes(":")) {
    const parts = value.split(":").map((part) => part.trim());

    if (parts.length === 2) {
      const minutes = Number(parts[0]);
      const seconds = Number(parts[1]);

      if (
        Number.isInteger(minutes) &&
        Number.isInteger(seconds) &&
        minutes >= 0 &&
        seconds >= 0 &&
        seconds < 60
      ) {
        return minutes * 60 + seconds;
      }
    }
  }

  if (isMinuteSecondTime && value.includes(".")) {
    const parts = value.split(".").map((part) => part.trim());

    if (parts.length === 2) {
      const minutes = Number(parts[0]);
      const seconds = Number(parts[1]);

      if (
        Number.isInteger(minutes) &&
        Number.isInteger(seconds) &&
        minutes >= 0 &&
        seconds >= 0 &&
        seconds < 60
      ) {
        return minutes * 60 + seconds;
      }
    }
  }

  const parsed = Number(value);
  if (Number.isFinite(parsed) && (!isMinuteSecondTime || !value.includes("."))) {
    return parsed;
  }

  return null;
}

export function normalizeTrainingLogValue(rawValue: string, unit?: string) {
  const trimmedValue = rawValue.trim();
  if (!trimmedValue) return trimmedValue;

  if (unit === "mm:ss") {
    const parsed = parseChartValue(trimmedValue, unit);
    if (parsed !== null) {
      return formatSeconds(parsed);
    }
  }

  return trimmedValue;
}

export function formatSeconds(totalSeconds: number) {
  const safe = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function isTimeBasedMovement(categoryKey?: string | null, movementName?: string) {
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

export function isTimeDisplay(unit?: string, categoryKey?: string | null, movementName?: string) {
  if (unit === "mm:ss" || unit === "seconds") return true;
  return isTimeBasedMovement(categoryKey, movementName);
}

export function formatDisplayValue(
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

export function formatChartValue(
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

function isPositiveNumber(value: string) {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed > 0;
}

function isValidDateInput(value: string) {
  if (!value.trim()) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

function isFutureDateInput(value: string) {
  if (!isValidDateInput(value)) return false;
  const selected = new Date(value);
  const today = new Date();
  selected.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return selected.getTime() > today.getTime();
}

export function validateTrainingLogForm(args: {
  value: string;
  reps: string;
  date: string;
  notes: string;
  unit?: string;
  categoryKey?: string | null;
  movementName?: string;
  showRepsField: boolean;
}) {
  const {
    value,
    reps,
    date,
    notes,
    unit,
    categoryKey,
    movementName,
    showRepsField,
  } = args;

  const errors: FormFieldErrors = {};
  const trimmedValue = value.trim();
  const trimmedReps = reps.trim();
  const trimmedNotes = notes.trim();

  if (!trimmedValue) {
    errors.value = "Enter a result before saving.";
  } else if (isTimeDisplay(unit, categoryKey, movementName)) {
    const parsed = parseChartValue(trimmedValue, unit);
    if (parsed === null || parsed <= 0) {
      errors.value = "Enter a valid time like 4:30 or 4.30, or a positive number of seconds.";
    }
  } else if (!isPositiveNumber(trimmedValue)) {
    errors.value = "Enter a positive number.";
  }

  if (showRepsField && trimmedReps && !Number.isInteger(Number(trimmedReps))) {
    errors.reps = "Reps must be a whole number.";
  } else if (showRepsField && trimmedReps && Number(trimmedReps) <= 0) {
    errors.reps = "Reps must be greater than zero.";
  }

  if (!date.trim()) {
    errors.date = "Pick a date.";
  } else if (!isValidDateInput(date)) {
    errors.date = "Enter a valid date.";
  } else if (isFutureDateInput(date)) {
    errors.date = "Date cannot be in the future.";
  }

  if (trimmedNotes.length > 280) {
    errors.notes = "Notes must be 280 characters or fewer.";
  }

  return errors;
}

export function getSmartFormConfig(args: {
  categoryKey?: string | null;
  movementName?: string;
  movementSlug?: string;
  metricType: string;
  unitOptions: string[];
}): SmartFormConfig {
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

export function getAccentClasses(categoryKey?: string | null): AccentClasses {
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

export function isBetterPerformance(args: {
  categoryKey?: string | null;
  nextValue: number;
  currentBestValue: number | null;
}) {
  const { categoryKey, nextValue, currentBestValue } = args;

  if (currentBestValue === null) return true;

  if (categoryKey === "engine") {
    return nextValue < currentBestValue;
  }

  return nextValue > currentBestValue;
}
