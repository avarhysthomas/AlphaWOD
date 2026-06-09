import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock3,
  Flame,
  ImagePlus,
  MapPinned,
  Minus,
  Plus,
  Route,
  Timer,
  Trophy,
  Waves,
} from "lucide-react";
import { getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";
import { useAuth } from "../../../context/AuthContext";
import MovementCombobox from "../components/MovementCombobox";
import { getDateInputValueInTimeZone } from "../../../utils/date";
import { getMovementLibrary } from "../services/movementLibrary";
import { createWorkoutSession } from "../services/workouts";
import type {
  MovementLibraryItem,
  WorkoutMovementEntry,
  WorkoutMovementEntryMetric,
  WorkoutType,
  WorkoutVisibility,
} from "../types";

const timeZone = "Europe/London";

type ComposerStep = 0 | 1 | 2;
type LoggingMode = "structured" | "freeText";

type TypeMeta = {
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  titlePlaceholder: string;
};

const workoutTypes: Array<WorkoutType> = ["run", "strength", "amrap", "emom"];

const workoutTypeMeta: Record<WorkoutType, TypeMeta> = {
  run: {
    label: "Cardio",
    hint: "Log runs, rows, rides, ski, or other cardio pieces.",
    icon: Route,
    titlePlaceholder: "Cardio Session",
  },
  strength: {
    label: "Strength",
    hint: "Pick the strength movements you hit and total session time.",
    icon: Trophy,
    titlePlaceholder: "Strength Session",
  },
  amrap: {
    label: "AMRAP",
    hint: "Build the workout from movements, reps, cals, or distance.",
    icon: Flame,
    titlePlaceholder: "AMRAP Session",
  },
  emom: {
    label: "EMOM",
    hint: "Log the movement blocks and total time.",
    icon: Waves,
    titlePlaceholder: "EMOM Session",
  },
  engine: {
    label: "Engine",
    hint: "",
    icon: Route,
    titlePlaceholder: "",
  },
  class: {
    label: "Class",
    hint: "",
    icon: Flame,
    titlePlaceholder: "",
  },
  hybrid: {
    label: "Hybrid",
    hint: "",
    icon: Waves,
    titlePlaceholder: "",
  },
};

const movementMetricOptions: Array<{
  value: WorkoutMovementEntryMetric;
  label: string;
}> = [
  { value: "reps", label: "Reps" },
  { value: "cals", label: "Cals" },
  { value: "distance", label: "Distance" },
  { value: "seconds", label: "Seconds" },
  { value: "load", label: "Load" },
];

const cardioModes = [
  { value: "run", label: "Run" },
  { value: "row", label: "Row" },
  { value: "bike", label: "Bike" },
  { value: "ski", label: "Ski" },
  { value: "other", label: "Other" },
] as const;

type CardioMode = (typeof cardioModes)[number]["value"];

const cardioTimePresets = ["5:00", "10:00", "20:00", "30:00"];

const cardioDistanceOptions: Record<CardioMode, Array<{ label: string; value: string }>> = {
  run: [
    { label: "1k", value: "1000" },
    { label: "3k", value: "3000" },
    { label: "5k", value: "5000" },
    { label: "10k", value: "10000" },
    { label: "Half", value: "21097" },
  ],
  row: [
    { label: "250m", value: "250" },
    { label: "500m", value: "500" },
    { label: "1k", value: "1000" },
    { label: "2k", value: "2000" },
    { label: "5k", value: "5000" },
  ],
  bike: [
    { label: "5k", value: "5000" },
    { label: "10k", value: "10000" },
    { label: "20k", value: "20000" },
    { label: "40k", value: "40000" },
  ],
  ski: [
    { label: "250m", value: "250" },
    { label: "500m", value: "500" },
    { label: "1k", value: "1000" },
    { label: "2k", value: "2000" },
    { label: "5k", value: "5000" },
  ],
  other: [
    { label: "500m", value: "500" },
    { label: "1k", value: "1000" },
    { label: "2k", value: "2000" },
    { label: "5k", value: "5000" },
    { label: "10k", value: "10000" },
  ],
};

function currentTimeValue() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const hour = parts.find((part) => part.type === "hour")?.value ?? "12";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

function tidyNumberInput(value: string) {
  return value.replace(/[^\d:.]/g, "");
}

async function readImageFileDimensions(file: File) {
  return new Promise<{ width: number; height: number; image: HTMLImageElement }>(
    (resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();

      image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve({
          width: image.naturalWidth,
          height: image.naturalHeight,
          image,
        });
      };

      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Could not read the selected picture."));
      };

      image.src = objectUrl;
    }
  );
}

async function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number
) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Could not prepare the picture for upload."));
          return;
        }

        resolve(blob);
      },
      type,
      quality
    );
  });
}

async function compressWorkoutImage(file: File) {
  const compressibleTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

  if (!compressibleTypes.includes(file.type)) {
    return file;
  }

  try {
    const { width, height, image } = await readImageFileDimensions(file);
    const maxDimension = 1600;
    const largestSide = Math.max(width, height);

    if (!largestSide) return file;

    const scale = largestSide > maxDimension ? maxDimension / largestSide : 1;
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const context = canvas.getContext("2d");
    if (!context) return file;

    context.drawImage(image, 0, 0, targetWidth, targetHeight);

    const outputType = file.type === "image/png" ? "image/jpeg" : file.type;
    const quality = outputType === "image/png" ? undefined : 0.82;
    const blob = await canvasToBlob(canvas, outputType, quality);

    if (blob.size >= file.size && scale === 1) {
      return file;
    }

    const nextName =
      outputType === "image/jpeg"
        ? file.name.replace(/\.(png|webp)$/i, ".jpg")
        : file.name;

    return new File([blob], nextName, {
      type: outputType,
      lastModified: Date.now(),
    });
  } catch (error) {
    console.error("Could not compress workout image", error);
    return file;
  }
}

function parseRunTimeToSeconds(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parts = getTimeParts(trimmed).map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) return null;

  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function tidyTimeInput(value: string) {
  return value
    .replace(/[^\d:.]/g, "")
    .split(/[:.]/)
    .slice(0, 3)
    .join(value.includes(".") && !value.includes(":") ? "." : ":");
}

function getTimeParts(value: string) {
  return value.replace(/\./g, ":").split(":").filter((part) => part !== "");
}

function normalizeRunTimeInput(value: string) {
  const cleaned = tidyTimeInput(value).trim();
  if (!cleaned) return "";

  const parts = getTimeParts(cleaned);
  if (!parts.length) return "";

  if (parts.length === 1) {
    const digits = parts[0].replace(/\D/g, "");
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) {
      return `${digits.slice(0, -2)}:${digits.slice(-2).padStart(2, "0")}`;
    }
    return `${digits.slice(0, -4)}:${digits.slice(-4, -2).padStart(2, "0")}:${digits
      .slice(-2)
      .padStart(2, "0")}`;
  }

  const [first, second, third] = parts.map((part) => part.replace(/\D/g, ""));
  if (parts.length === 2) {
    return `${first || "0"}:${(second || "0").padStart(2, "0")}`;
  }

  return `${first || "0"}:${(second || "0").padStart(2, "0")}:${(third || "0").padStart(2, "0")}`;
}

function formatRunPace(distanceMeters: string, runTimeValue: string) {
  const distance = Number(distanceMeters);
  const totalSeconds = parseRunTimeToSeconds(runTimeValue);

  if (!distance || !totalSeconds) return null;

  const secondsPerKm = totalSeconds / (distance / 1000);
  if (!Number.isFinite(secondsPerKm)) return null;

  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = Math.round(secondsPerKm % 60);

  if (seconds === 60) {
    return `${minutes + 1}:00 / km`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")} / km`;
}

function defaultCardioTitle(mode: CardioMode, distanceMeters: string) {
  const modeLabel = cardioModes.find((item) => item.value === mode)?.label ?? "Cardio";

  if (mode === "run") {
    switch (distanceMeters) {
      case "3000":
        return "3k Run";
      case "5000":
        return "5k Run";
      case "10000":
        return "10k Run";
      case "21097":
        return "Half Marathon";
      default:
        return distanceMeters.trim() ? `${distanceMeters}m Run` : "Cardio Session";
    }
  }

  if (distanceMeters.trim()) return `${distanceMeters}m ${modeLabel}`;
  if (mode === "other") return "Cardio Session";
  return `${modeLabel} Session`;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function emptyMovement(metric: WorkoutMovementEntryMetric = "reps"): WorkoutMovementEntry {
  return {
    movementId: undefined,
    movementName: "",
    isCustom: false,
    metric,
    value: "",
    loadKg: "",
    reps: "",
    sets: "",
  };
}

function defaultTitleForType(type: WorkoutType) {
  return workoutTypeMeta[type].titlePlaceholder;
}

function headlineForType(type: WorkoutType) {
  switch (type) {
    case "run":
      return "Cardio details";
    case "strength":
      return "Strength details";
    case "amrap":
      return "AMRAP details";
    case "emom":
      return "EMOM details";
    default:
      return "Session details";
  }
}

export default function WorkoutComposer() {
  const { user, appUser } = useAuth();
  const navigate = useNavigate();
  const storage = useMemo(() => getStorage(), []);

  const [step, setStep] = useState<ComposerStep>(0);
  const [type, setType] = useState<WorkoutType>("run");
  const [title, setTitle] = useState(defaultTitleForType("run"));
  const [sessionDate, setSessionDate] = useState(
    getDateInputValueInTimeZone(new Date(), timeZone)
  );
  const [startTime] = useState(currentTimeValue());
  const [totalTime, setTotalTime] = useState("");
  const [visibility, setVisibility] = useState<WorkoutVisibility>("members");
  const [movementLibrary, setMovementLibrary] = useState<MovementLibraryItem[]>([]);
  const [loadingMovements, setLoadingMovements] = useState(true);

  const [runDistance, setRunDistance] = useState("");
  const [runTime, setRunTime] = useState("");
  const [runArea, setRunArea] = useState("");
  const [cardioMode, setCardioMode] = useState<CardioMode>("run");
  const [customCardioDistance, setCustomCardioDistance] = useState(false);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null);

  const [strengthMovements, setStrengthMovements] = useState<WorkoutMovementEntry[]>([
    emptyMovement("load"),
  ]);

  const [sessionMovements, setSessionMovements] = useState<WorkoutMovementEntry[]>([
    emptyMovement("reps"),
  ]);
  const [loggingMode, setLoggingMode] = useState<LoggingMode>("structured");
  const [sessionText, setSessionText] = useState("");
  const [totalRounds, setTotalRounds] = useState("");
  const [notes, setNotes] = useState("");
  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const typeMeta = workoutTypeMeta[type];
  const TypeIcon = typeMeta.icon;
  const cardioDistanceChoices = cardioDistanceOptions[cardioMode];
  const cardioDistanceIsPreset = cardioDistanceChoices.some((item) => item.value === runDistance);
  const runPace = useMemo(
    () => formatRunPace(runDistance, runTime),
    [runDistance, runTime]
  );
  const resolvedTitle =
    type === "run" && !title.trim() ? defaultCardioTitle(cardioMode, runDistance) : title.trim();
  const completionLabel = useMemo(() => {
    const count = [
      title.trim(),
      totalTime.trim(),
      runDistance.trim(),
      runTime.trim(),
      runArea.trim(),
      type === "run" ? cardioMode : "",
      totalRounds.trim(),
      sessionText.trim(),
      notes.trim(),
      ...strengthMovements.flatMap((item) => [item.movementName.trim(), item.value.trim()]),
      ...sessionMovements.flatMap((item) => [item.movementName.trim(), item.value.trim()]),
    ].filter(Boolean).length;

    return `${count} details added`;
  }, [
    notes,
    runArea,
    runDistance,
    runTime,
    sessionMovements,
    strengthMovements,
    title,
    type,
    cardioMode,
    totalRounds,
    sessionText,
    totalTime,
  ]);

  useEffect(() => {
    let active = true;

    async function loadMovementLibrary() {
      setLoadingMovements(true);

      try {
        const items = await getMovementLibrary();
        if (!active) return;
        setMovementLibrary(items);
      } catch (error) {
        console.error("Could not load movement library", error);
        if (active) setMovementLibrary([]);
      } finally {
        if (active) setLoadingMovements(false);
      }
    }

    void loadMovementLibrary();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (selfiePreview) URL.revokeObjectURL(selfiePreview);
    };
  }, [selfiePreview]);

  function applyType(nextType: WorkoutType) {
    setType(nextType);
    setTitle((current) =>
      current.trim() && current !== defaultTitleForType(type)
        ? current
        : defaultTitleForType(nextType)
    );
    setTotalRounds("");
    setSaveError("");
    setLoggingMode(nextType === "run" ? "structured" : "structured");

    if (nextType === "strength" && strengthMovements.length === 0) {
      setStrengthMovements([emptyMovement("load")]);
    }

    if ((nextType === "amrap" || nextType === "emom") && sessionMovements.length === 0) {
      setSessionMovements([emptyMovement("reps")]);
    }
  }

  const strengthLibrary = useMemo(
    () =>
      movementLibrary.filter((item) =>
        ["strength", "gymnastics"].includes(item.category)
      ),
    [movementLibrary]
  );

  const metconLibrary = useMemo(
    () =>
      movementLibrary.filter((item) =>
        ["strength", "conditioning", "engine", "gymnastics"].includes(item.category)
      ),
    [movementLibrary]
  );

  function findMovementItem(entry: WorkoutMovementEntry) {
    if (!entry.movementId) return null;
    return movementLibrary.find((item) => item.id === entry.movementId) ?? null;
  }

  function metricOptionsForEntry(entry: WorkoutMovementEntry) {
    const libraryItem = findMovementItem(entry);
    const allowed = libraryItem?.measurementTypes?.length
      ? libraryItem.measurementTypes
      : movementMetricOptions.map((option) => option.value);

    return movementMetricOptions.filter((option) => allowed.includes(option.value));
  }

  function applyMovementSelection(
    updateFn: (index: number, next: Partial<WorkoutMovementEntry>) => void,
    index: number,
    movementId: string,
    library: MovementLibraryItem[]
  ) {
    const selected = library.find((item) => item.id === movementId);
    if (!selected) {
      updateFn(index, {
        movementId: undefined,
        movementName: "",
        metric: "reps",
      });
      return;
    }

    updateFn(index, {
      movementId: selected.id,
      movementName: selected.name,
      metric: selected.measurementTypes[0] ?? "reps",
    });
  }

  function updateStrengthMovement(
    index: number,
    next: Partial<WorkoutMovementEntry>
  ) {
    setStrengthMovements((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...next } : item
      )
    );
  }

  function updateSessionMovement(
    index: number,
    next: Partial<WorkoutMovementEntry>
  ) {
    setSessionMovements((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...next } : item
      )
    );
  }

  function onPickSelfie(file: File | null) {
    setSelfieFile(file);

    if (selfiePreview) {
      URL.revokeObjectURL(selfiePreview);
    }

    setSelfiePreview(file ? URL.createObjectURL(file) : null);
  }

  function validateCurrentStep() {
    if (step === 1) {
      if (type !== "run" && !title.trim()) {
        setSaveError("Give the session a clear title.");
        return false;
      }

      if (type === "run") {
        if (!runDistance.trim() || !runTime.trim()) {
          setSaveError("For a run, add both the distance and the time.");
          return false;
        }
      }

      if (type === "strength") {
        if (loggingMode === "freeText") {
          if (!sessionText.trim()) {
            setSaveError("Add a quick note about what you trained.");
            return false;
          }
          setSaveError("");
          return true;
        }

        const validMovements = strengthMovements.filter(
          (item) =>
            item.movementName.trim() &&
            item.loadKg?.trim() &&
            item.reps?.trim() &&
            item.sets?.trim()
        );

        if (!validMovements.length) {
          setSaveError("Add at least one strength movement and a result.");
          return false;
        }
      }

      if (type === "amrap" || type === "emom") {
        if (loggingMode === "freeText") {
          if (!sessionText.trim()) {
            setSaveError(`Add a quick note about the ${type.toUpperCase()} session.`);
            return false;
          }
          setSaveError("");
          return true;
        }

        const validMovements = sessionMovements.filter(
          (item) => item.movementName.trim() && item.value.trim()
        );

        if (!validMovements.length) {
          setSaveError(`Add at least one movement to the ${type.toUpperCase()} session.`);
          return false;
        }

        if (!totalTime.trim()) {
          setSaveError(
            type === "amrap"
              ? "Add the total time and total rounds for the AMRAP session."
              : "Add the total time for the EMOM session."
          );
          return false;
        }

        if (type === "amrap" && !totalRounds.trim()) {
          setSaveError("Add the total rounds for the AMRAP session.");
          return false;
        }
      }
    }

    setSaveError("");
    return true;
  }

  function nextStep() {
    if (!validateCurrentStep()) return;
    setStep((current) => Math.min(2, current + 1) as ComposerStep);
  }

  function previousStep() {
    setSaveError("");
    setStep((current) => Math.max(0, current - 1) as ComposerStep);
  }

  async function uploadSelfieIfNeeded() {
    if (!user || !selfieFile) return undefined;

    const uploadFile = await withTimeout(
      compressWorkoutImage(selfieFile),
      8000,
      "Preparing the picture took too long."
    );

    const ext = uploadFile.name.split(".").pop()?.toLowerCase() || "jpg";
    const safeExt = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "jpg";
    const path = `workoutSelfies/${user.uid}/${Date.now()}.${safeExt}`;
    const storageRef = ref(storage, path);

    await withTimeout(
      uploadBytes(storageRef, uploadFile, { contentType: uploadFile.type }),
      30000,
      "Picture upload timed out."
    );
    return withTimeout(
      getDownloadURL(storageRef),
      12000,
      "Could not fetch the uploaded picture."
    );
  }

  async function saveWorkout() {
    if (!user) return;
    if (!validateCurrentStep()) return;

    try {
      setIsSaving(true);
      setSaveError("");

      const selfieURL = await uploadSelfieIfNeeded();

      const baseMovementEntries =
        loggingMode === "freeText"
          ? []
          : type === "strength"
          ? strengthMovements
          : type === "amrap" || type === "emom"
          ? sessionMovements
          : [];

      const cleanMovementEntries = baseMovementEntries.filter((item) => {
        if (!item.movementName.trim()) return false;

        if (type === "strength") {
          return Boolean(item.loadKg?.trim() && item.reps?.trim() && item.sets?.trim());
        }

        return Boolean(item.value.trim());
      });

      await withTimeout(
        createWorkoutSession({
        userId: user.uid,
        userName: appUser?.name || user.displayName || "Member",
        userPhotoURL: user.photoURL || undefined,
        title: resolvedTitle,
        type,
        source: "manual",
        sessionDate,
        startTime,
        durationMin: type === "strength" ? undefined : totalTime,
        notes,
        visibility,
        stats: {
          score:
            type === "run"
              ? runTime
              : loggingMode === "freeText"
              ? totalTime.trim()
                ? `${totalTime.trim()} min`
                : "Quick log"
              : type === "strength"
              ? `${cleanMovementEntries.length} movement${cleanMovementEntries.length === 1 ? "" : "s"}`
              : type === "amrap"
              ? `${totalRounds} rounds`
              : `${totalTime} min`,
          scoreType:
            type === "run"
              ? "time"
              : loggingMode === "freeText"
              ? "custom"
              : type === "strength"
              ? "custom"
              : type === "amrap"
              ? "rounds"
              : "time",
          distanceM: type === "run" ? runDistance : undefined,
          area: type === "run" ? runArea : undefined,
          totalRounds: type === "amrap" ? totalRounds : undefined,
        },
        movementEntries: cleanMovementEntries,
        selfieURL,
        sections: [
          ...(loggingMode === "freeText" && sessionText.trim()
            ? [{ kind: "main" as const, text: sessionText.trim() }]
            : []),
          ...(type === "run" && runArea.trim()
            ? [{ kind: "notes" as const, text: `Area: ${runArea.trim()}` }]
            : []),
          ...(type === "run" && cardioMode !== "run"
            ? [
                {
                  kind: "notes" as const,
                  text: `Mode: ${cardioModes.find((item) => item.value === cardioMode)?.label ?? "Cardio"}`,
                },
              ]
            : []),
        ],
        }),
        15000,
        "Saving the workout took too long."
      );

      navigate("/workouts");
    } catch (error) {
      console.error("Could not save workout", error);
      if (error instanceof Error) {
        setSaveError(error.message || "Could not save this session right now. Please try again.");
      } else {
        setSaveError("Could not save this session right now. Please try again.");
      }
    } finally {
      setIsSaving(false);
    }
  }

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
              {appUser?.photoURL || user?.photoURL ? (
                <img
                  src={appUser?.photoURL || user?.photoURL || ""}
                  alt={appUser?.name ? `${appUser.name}'s profile` : "Profile"}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="grid h-full w-full place-items-center">
                  {(appUser?.name || user?.displayName || "A").slice(0, 1)}
                </span>
              )}
            </Link>
          </div>
        </header>

        <div className="mt-7 flex items-center justify-between gap-4">
          <Link
            to="/workouts"
            className="text-base font-bold text-white/45 transition hover:text-white"
          >
            Cancel
          </Link>
          <span className="font-mono text-sm text-white/34">Step {step + 1} of 3</span>
        </div>

        <section className="mt-7">
          <p className="text-[12px] font-bold uppercase tracking-[0.28em] text-white/34">
            Log workout
          </p>
          <h1 className="mt-4 font-heading text-[2.6rem] uppercase leading-none text-white sm:text-[6rem]">
            {step === 0
              ? "What did you train?"
              : step === 1
              ? headlineForType(type)
              : "Final touch and save"}
          </h1>
          <p className="mt-4 max-w-md text-[17px] leading-7 text-white/42">
            {step === 0
              ? "We'll tailor the next step to match sets and reps for strength, distance and pace for cardio."
              : step === 1
              ? completionLabel
              : visibility === "members"
              ? "This will post to the members feed once it saves."
              : "This will stay private in your training history."}
          </p>
        </section>

        <form
          onSubmit={(event) => event.preventDefault()}
          className="mt-8 space-y-6"
        >
          {saveError ? (
            <div className="rounded-[20px] border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {saveError}
            </div>
          ) : null}

          {step === 0 ? (
            <section className="space-y-5">
              <div className="grid grid-cols-2 gap-3">
                {workoutTypes.map((option) => {
                  const meta = workoutTypeMeta[option];
                  const Icon = meta.icon;
                  const isActive = option === type;

                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => applyType(option)}
                      className={[
                        "relative min-h-[142px] rounded-[20px] border p-5 text-left transition",
                        isActive
                          ? "border-[#f2eee8] bg-[#1b1917] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                          : "border-white/8 bg-[#11100f] text-white/62 hover:border-white/18 hover:bg-[#171513]",
                      ].join(" ")}
                    >
                      <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.055] text-white/60">
                        <Icon className="h-5 w-5" />
                      </span>
                      {isActive ? (
                        <CheckCircle2 className="absolute right-5 top-5 h-5 w-5 text-[#f2eee8]" />
                      ) : null}
                      <span className="mt-7 block text-[1.35rem] font-bold leading-none text-white">
                        {meta.label}
                      </span>
                      <span className="mt-2 block text-sm leading-5 text-white/34">
                        {option === "run"
                          ? "Distance/time"
                          : option === "strength"
                          ? "Sets & reps"
                          : option === "amrap"
                          ? "Rounds in time"
                          : "Per-minute"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          {step === 1 ? (
            <section className="space-y-5">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.035] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/45">
                  <TypeIcon className="h-3.5 w-3.5" />
                  {typeMeta.label}
                </div>
                <h2 className="mt-3 text-2xl font-bold tracking-[-0.01em] text-white">
                  {headlineForType(type)}
                </h2>
              </div>

              {type === "run" ? (
                <div className="max-w-full space-y-4 overflow-hidden rounded-[22px] border border-white/8 bg-[#11100f]/92 p-4">
                  <div>
                    <div className="text-sm font-semibold text-white">Result</div>
                    <div className="text-sm text-white/52">
                      Pick the cardio mode, add the output and time, and we&apos;ll handle the rest.
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {cardioModes.map((mode) => {
                      const isActive = cardioMode === mode.value;

                      return (
                        <button
                          key={mode.value}
                          type="button"
                          onClick={() => {
                            setCardioMode(mode.value);
                            setCustomCardioDistance(false);
                            const nextDefaultDistance =
                              cardioDistanceOptions[mode.value][0]?.value ?? "";
                            if (!runDistance || !cardioDistanceOptions[mode.value].some((item) => item.value === runDistance)) {
                              setRunDistance(nextDefaultDistance);
                            }
                            if (!title.trim() || title === defaultCardioTitle(cardioMode, runDistance)) {
                              setTitle(defaultCardioTitle(mode.value, nextDefaultDistance || runDistance));
                            }
                          }}
                          className={[
                            "rounded-full border px-3.5 py-2 text-sm font-semibold transition",
                            isActive
                              ? "border-[#f2eee8] bg-white/[0.08] text-white"
                              : "border-white/8 bg-[#11100f] text-white/48 hover:border-white/16 hover:text-white/75",
                          ].join(" ")}
                        >
                          {mode.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)]">
                    <label className="block min-w-0">
                      <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-white/44">
                        Distance
                      </span>
                      <div className="space-y-2">
                        <div className="flex max-w-full flex-wrap gap-2">
                          {cardioDistanceChoices.map((option) => {
                            const isActive = runDistance === option.value && !customCardioDistance;

                            return (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() => {
                                  setCustomCardioDistance(false);
                                  setRunDistance(option.value);
                                  if (!title.trim() || title === defaultCardioTitle(cardioMode, runDistance)) {
                                    setTitle(defaultCardioTitle(cardioMode, option.value));
                                  }
                                }}
                                className={[
                                  "rounded-full border px-3 py-2 text-sm font-semibold transition",
                                  isActive
                                    ? "border-[#f2eee8] bg-white/[0.08] text-white"
                                    : "border-white/8 bg-[#11100f] text-white/48 hover:border-white/16 hover:text-white/75",
                                ].join(" ")}
                              >
                                {option.label}
                              </button>
                            );
                          })}
                          <button
                            type="button"
                            onClick={() => setCustomCardioDistance(true)}
                            className={[
                              "shrink-0 rounded-full border px-3 py-2 text-sm font-semibold transition",
                              customCardioDistance || (!!runDistance && !cardioDistanceIsPreset)
                                ? "border-[#f2eee8] bg-white/[0.08] text-white"
                                : "border-white/8 bg-[#11100f] text-white/48 hover:border-white/16 hover:text-white/75",
                            ].join(" ")}
                          >
                            Custom
                          </button>
                        </div>
                        {customCardioDistance || (!!runDistance && !cardioDistanceIsPreset) ? (
                          <div className="relative">
                            <input
                              value={runDistance}
                              onChange={(event) => setRunDistance(tidyNumberInput(event.target.value))}
                              placeholder="1500"
                              className="w-full rounded-[18px] border border-white/10 bg-[#090909] px-4 py-3 pr-12 text-sm text-white outline-none transition placeholder:text-white/22 focus:border-white/20 focus:bg-[#0d0d0d]"
                            />
                            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold uppercase tracking-[0.18em] text-white/35">
                              m
                            </span>
                          </div>
                        ) : null}
                      </div>
                    </label>

                    <label className="block min-w-0">
                      <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-white/44">
                        Time
                      </span>
                      <div className="w-full max-w-full overflow-hidden rounded-[20px] border border-white/10 bg-[#090909] px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Timer className="h-5 w-5 shrink-0 text-white/28" />
                          <input
                            inputMode="decimal"
                            value={runTime}
                            onChange={(event) => setRunTime(tidyTimeInput(event.target.value))}
                            onBlur={() => setRunTime((current) => normalizeRunTimeInput(current))}
                            placeholder="24:18"
                            aria-label="Elapsed time"
                            className="min-w-0 flex-1 bg-transparent font-mono text-[2rem] font-bold leading-none text-white outline-none placeholder:text-white/18"
                          />
                          <span className="hidden shrink-0 text-[11px] font-bold uppercase tracking-[0.18em] text-white/28 sm:inline">
                            mm:ss
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {cardioTimePresets.map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => setRunTime(preset)}
                              className={[
                                "shrink-0 rounded-full border px-3 py-1.5 font-mono text-xs font-bold transition",
                                runTime === preset
                                  ? "border-[#f2eee8] bg-white/[0.08] text-white"
                                  : "border-white/8 bg-white/[0.03] text-white/40 hover:text-white/70",
                              ].join(" ")}
                            >
                              {preset}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="mt-2 text-xs text-white/34">
                        Type 2430, 24:30, or 1.23.40.
                      </div>
                    </label>

                    <div className="min-w-0 rounded-[20px] border border-white/8 bg-[#11100f] px-4 py-3.5">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/40">
                        Pace
                      </div>
                      <div className="mt-2 text-lg font-semibold text-white">
                        {runPace ?? "--"}
                      </div>
                    </div>
                  </div>

                  <div className="grid min-w-0 gap-4 md:grid-cols-2">
                    <label className="block min-w-0">
                      <span className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/44">
                        <MapPinned className="h-3.5 w-3.5" />
                        Route / machine
                      </span>
                      <input
                        value={runArea}
                        onChange={(event) => setRunArea(event.target.value)}
                        placeholder=""
                        className="w-full rounded-[20px] border border-white/10 bg-[#090909] px-4 py-3.5 text-sm text-white outline-none transition placeholder:text-white/22 focus:border-white/20 focus:bg-[#0d0d0d]"
                      />
                    </label>

                    <label className="block min-w-0">
                      <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-white/44">
                        Title
                      </span>
                      <input
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        placeholder={defaultCardioTitle(cardioMode, runDistance)}
                        className="w-full rounded-[20px] border border-white/10 bg-[#090909] px-4 py-3.5 text-sm text-white outline-none transition placeholder:text-white/22 focus:border-white/20 focus:bg-[#0d0d0d]"
                      />
                    </label>
                  </div>

                  <label className="block max-w-xs">
                    <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-white/44">
                      Date
                    </span>
                    <input
                      type="date"
                      value={sessionDate}
                      onChange={(event) => setSessionDate(event.target.value)}
                      className="w-full rounded-[20px] border border-white/10 bg-[#090909] px-4 py-3.5 text-sm text-white outline-none transition [color-scheme:dark] focus:border-white/20 focus:bg-[#0d0d0d]"
                    />
                  </label>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-3">
                  <label className="block md:col-span-2">
                    <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-white/44">
                      Title
                    </span>
                    <input
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder={typeMeta.titlePlaceholder}
                      className="w-full rounded-[20px] border border-white/10 bg-[#090909] px-4 py-3.5 text-sm text-white outline-none transition placeholder:text-white/22 focus:border-white/20 focus:bg-[#0d0d0d]"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-white/44">
                      Date
                    </span>
                    <input
                      type="date"
                      value={sessionDate}
                      onChange={(event) => setSessionDate(event.target.value)}
                      className="w-full rounded-[20px] border border-white/10 bg-[#090909] px-4 py-3.5 text-sm text-white outline-none transition [color-scheme:dark] focus:border-white/20 focus:bg-[#0d0d0d]"
                    />
                  </label>
                </div>
              )}

              {type !== "run" ? (
                <div className="flex flex-wrap gap-2">
                  {([
                    { value: "structured", label: "Structured" },
                    { value: "freeText", label: "Free Text" },
                  ] as const).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setLoggingMode(option.value)}
                      className={[
                        "rounded-full border px-3.5 py-2 text-sm font-semibold transition",
                        loggingMode === option.value
                          ? "border-[#f2eee8] bg-white/[0.08] text-white"
                          : "border-white/8 bg-[#11100f] text-white/48 hover:border-white/16 hover:text-white/75",
                      ].join(" ")}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              ) : null}

              {type !== "run" && loggingMode === "freeText" ? (
                <label className="block">
                  <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-white/44">
                    Session notes
                  </span>
                  <textarea
                    value={sessionText}
                    onChange={(event) => setSessionText(event.target.value)}
                    rows={7}
                    placeholder="Write the session however you want: movements, sets, rounds, weights, or just a quick note."
                    className="w-full resize-none rounded-[20px] border border-white/10 bg-[#090909] px-4 py-3.5 text-sm text-white outline-none transition placeholder:text-white/22 focus:border-white/20 focus:bg-[#0d0d0d]"
                  />
                </label>
              ) : null}

              {type === "strength" && loggingMode === "structured" ? (
                <div className="space-y-3 rounded-[22px] border border-white/8 bg-[#11100f]/92 p-3.5">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-white">Strength movements</div>
                    </div>

                    <div className="flex flex-wrap items-end gap-2.5">
                      <button
                        type="button"
                        onClick={() =>
                          setStrengthMovements((current) => [...current, emptyMovement("load")])
                        }
                        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-white/72 transition hover:border-white/20 hover:text-white"
                      >
                        <Plus className="h-4 w-4" />
                        Add
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {strengthMovements.map((item, index) => (
                      <div
                        key={`strength-${index}`}
                        className="space-y-2.5 rounded-[18px] border border-white/8 bg-[#11100f] p-2.5"
                      >
                        <MovementCombobox
                          items={strengthLibrary}
                          valueId={item.movementId}
                          placeholder="Search strength movements"
                          onSelect={(movementId) =>
                            applyMovementSelection(
                              updateStrengthMovement,
                              index,
                              movementId,
                              strengthLibrary
                            )
                          }
                        />

                        <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
                          <label className="block">
                            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">
                              Load
                            </span>
                            <input
                              value={item.loadKg || ""}
                              onChange={(event) =>
                                updateStrengthMovement(index, {
                                  loadKg: tidyNumberInput(event.target.value),
                                })
                              }
                              placeholder="kg"
                              className="w-full rounded-[14px] border border-white/10 bg-[#090909] px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-white/22 focus:border-white/20 focus:bg-[#0d0d0d]"
                            />
                          </label>

                          <label className="block">
                            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">
                              Reps
                            </span>
                            <input
                              value={item.reps || ""}
                              onChange={(event) =>
                                updateStrengthMovement(index, {
                                  reps: tidyNumberInput(event.target.value),
                                })
                              }
                              placeholder="8"
                              className="w-full rounded-[14px] border border-white/10 bg-[#090909] px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-white/22 focus:border-white/20 focus:bg-[#0d0d0d]"
                            />
                          </label>

                          <label className="block">
                            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">
                              Sets
                            </span>
                            <input
                              value={item.sets || ""}
                              onChange={(event) =>
                                updateStrengthMovement(index, {
                                  sets: tidyNumberInput(event.target.value),
                                })
                              }
                              placeholder="4"
                              className="w-full rounded-[14px] border border-white/10 bg-[#090909] px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-white/22 focus:border-white/20 focus:bg-[#0d0d0d]"
                            />
                          </label>

                          <button
                            type="button"
                            onClick={() =>
                              setStrengthMovements((current) =>
                                current.filter((_, itemIndex) => itemIndex !== index)
                              )
                            }
                            disabled={strengthMovements.length <= 1}
                            className="inline-flex h-[42px] w-[42px] items-center justify-center self-end rounded-full border border-white/10 bg-white/[0.04] text-white/72 transition hover:border-red-400/20 hover:bg-red-400/10 hover:text-red-100 disabled:cursor-not-allowed disabled:opacity-45"
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {loadingMovements ? (
                    <div className="text-sm text-white/52">Loading movement library...</div>
                  ) : null}
                </div>
              ) : null}

              {(type === "amrap" || type === "emom") && loggingMode === "structured" ? (
                <div className="space-y-4 rounded-[24px] border border-white/8 bg-[#11100f]/92 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">Session movements</div>
                      <div className="text-sm text-white/52">
                        Build the workout from the movements inside the session.
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setSessionMovements((current) => [...current, emptyMovement("reps")])
                      }
                      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-2 text-sm font-semibold text-white/72 transition hover:border-white/20 hover:text-white"
                    >
                      <Plus className="h-4 w-4" />
                      Add movement
                    </button>
                  </div>

                  <div className="space-y-3">
                    {sessionMovements.map((item, index) => (
                      <div
                        key={`session-${index}`}
                        className="grid gap-3 rounded-[22px] border border-white/8 bg-[#11100f] p-3 md:grid-cols-[1.1fr_0.7fr_0.7fr_auto]"
                      >
                        <MovementCombobox
                          items={metconLibrary}
                          valueId={item.movementId}
                          placeholder="Search session movements"
                          onSelect={(movementId) =>
                            applyMovementSelection(
                              updateSessionMovement,
                              index,
                              movementId,
                              metconLibrary
                            )
                          }
                        />

                        <select
                          value={item.metric}
                          onChange={(event) =>
                            updateSessionMovement(index, {
                              metric: event.target.value as WorkoutMovementEntryMetric,
                            })
                          }
                          className="rounded-[18px] border border-white/10 bg-[#090909] px-4 py-3 text-sm text-white outline-none transition focus:border-white/20 focus:bg-[#0d0d0d]"
                        >
                          {metricOptionsForEntry(item).map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>

                        <input
                          value={item.value}
                          onChange={(event) =>
                            updateSessionMovement(index, {
                              value: event.target.value,
                            })
                          }
                          placeholder="Value"
                          className="rounded-[18px] border border-white/10 bg-[#090909] px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/22 focus:border-white/20 focus:bg-[#0d0d0d]"
                        />

                        <button
                          type="button"
                          onClick={() =>
                            setSessionMovements((current) =>
                              current.filter((_, itemIndex) => itemIndex !== index)
                            )
                          }
                          disabled={sessionMovements.length <= 1}
                          className="inline-flex h-fit items-center justify-center rounded-full border border-white/10 bg-white/[0.04] p-3 text-white/72 transition hover:border-red-400/20 hover:bg-red-400/10 hover:text-red-100 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>

                  {loadingMovements ? (
                    <div className="text-sm text-white/52">Loading movement library...</div>
                  ) : null}

                  <div className={type === "amrap" ? "grid gap-4 md:grid-cols-2" : "grid gap-4"}>
                    <label className="block">
                      <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-white/44">
                        Total time
                      </span>
                      <input
                        value={totalTime}
                        onChange={(event) => setTotalTime(tidyNumberInput(event.target.value))}
                        placeholder="20"
                        className="w-full rounded-[20px] border border-white/10 bg-[#090909] px-4 py-3.5 text-sm text-white outline-none transition placeholder:text-white/22 focus:border-white/20 focus:bg-[#0d0d0d]"
                      />
                    </label>

                    {type === "amrap" ? (
                      <label className="block">
                        <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-white/44">
                          Total rounds
                        </span>
                        <input
                          value={totalRounds}
                          onChange={(event) => setTotalRounds(tidyNumberInput(event.target.value))}
                          placeholder="5"
                          className="w-full rounded-[20px] border border-white/10 bg-[#090909] px-4 py-3.5 text-sm text-white outline-none transition placeholder:text-white/22 focus:border-white/20 focus:bg-[#0d0d0d]"
                        />
                      </label>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          {step === 2 ? (
            <section className="space-y-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/40">
                  Share
                </div>
                <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-white sm:text-2xl">
                  Final touch and save
                </h2>
              </div>

              <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
                <div className="space-y-4">
                  <label className="block">
                    <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-white/44">
                      Notes
                    </span>
                    <textarea
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      rows={3}
                      placeholder="Anything worth keeping from the session?"
                      className="w-full resize-none rounded-[18px] border border-white/10 bg-[#090909] px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/22 focus:border-white/20 focus:bg-[#0d0d0d]"
                    />
                  </label>

                  <label className="block rounded-[20px] border border-white/8 bg-[#11100f]/92 p-3.5">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/44">
                        <ImagePlus className="h-3.5 w-3.5" />
                        Add a pic
                      </span>
                      {selfiePreview ? (
                        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/34">
                          Ready
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-start gap-3">
                      {selfiePreview ? (
                        <img
                          src={selfiePreview}
                          alt="Workout preview"
                          className="h-20 w-20 shrink-0 rounded-[16px] border border-white/10 object-cover"
                        />
                      ) : (
                        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-[16px] border border-dashed border-white/10 bg-white/[0.03] text-white/26">
                          <ImagePlus className="h-5 w-5" />
                        </div>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(event) => onPickSelfie(event.target.files?.[0] ?? null)}
                        className="block w-full rounded-[16px] border border-white/10 bg-[#090909] px-3 py-2.5 text-sm text-white file:mr-3 file:rounded-full file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white"
                      />
                    </div>
                  </label>
                </div>

                <div className="space-y-4">
                  <div className="rounded-[20px] border border-white/8 bg-[#11100f]/92 p-3.5">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/40">
                      Preview
                    </div>
                    <div className="mt-3 text-lg font-semibold text-white">{resolvedTitle}</div>
                    <div className="mt-1 text-sm text-white/58">
                  {type === "run"
                    ? `${runDistance || "0"} m · ${runTime || "No time"}${runPace ? ` · ${runPace}` : ""}`
                    : loggingMode === "freeText"
                    ? sessionText.trim() || "Quick text log"
                    : type === "strength"
                    ? `${strengthMovements.filter((item) => item.movementName.trim()).length} strength movements`
                    : type === "amrap"
                    ? `${totalRounds || "0"} rounds in ${totalTime || "0"} min`
                    : `${totalTime || "0"} min EMOM`}
                </div>
              </div>

                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => setVisibility("members")}
                      className={[
                        "w-full rounded-[20px] border px-4 py-3 text-left transition",
                        visibility === "members"
                          ? "border-[#f2eee8] bg-white/[0.08] text-white"
                          : "border-white/8 bg-[#11100f] text-white/58 hover:border-white/16 hover:text-white/82",
                      ].join(" ")}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <Flame className="h-4.5 w-4.5" />
                          <div>
                            <div className="text-sm font-semibold">Share to members feed</div>
                            <div className="mt-0.5 text-xs text-white/52">
                              Post it once it saves.
                            </div>
                          </div>
                        </div>
                        <div
                          className={[
                            "h-2.5 w-2.5 rounded-full transition",
                            visibility === "members" ? "bg-[#f2eee8]" : "bg-white/15",
                          ].join(" ")}
                        />
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setVisibility("private")}
                      className={[
                        "w-full rounded-[20px] border px-4 py-3 text-left transition",
                        visibility === "private"
                          ? "border-[#f2eee8] bg-white/[0.08] text-white"
                          : "border-white/8 bg-[#11100f] text-white/58 hover:border-white/16 hover:text-white/82",
                      ].join(" ")}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <Clock3 className="h-4.5 w-4.5" />
                          <div>
                            <div className="text-sm font-semibold">Keep private</div>
                            <div className="mt-0.5 text-xs text-white/52">
                              Save it only to your history.
                            </div>
                          </div>
                        </div>
                        <div
                          className={[
                            "h-2.5 w-2.5 rounded-full transition",
                            visibility === "private" ? "bg-[#f2eee8]" : "bg-white/15",
                          ].join(" ")}
                        />
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          <div className="fixed inset-x-4 bottom-4 z-40 mx-auto max-w-xl rounded-[28px] border border-white/10 bg-[#191715]/95 px-5 py-4 shadow-[0_20px_70px_rgba(0,0,0,0.5)] backdrop-blur-xl sm:max-w-2xl">
            <div className="mb-4 h-1 rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-[#f2eee8] transition-all"
                style={{ width: `${((step + 1) / 3) * 100}%` }}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={previousStep}
              disabled={step === 0}
              className="inline-flex items-center gap-2 rounded-[20px] px-5 py-3 text-base font-bold text-white/42 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </button>

            {step < 2 ? (
              <button
                type="button"
                onClick={nextStep}
                className="inline-flex min-w-[190px] items-center justify-center gap-2 rounded-full bg-[#f2eee8] px-7 py-4 text-base font-bold text-black transition hover:brightness-95"
              >
                Continue
                <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void saveWorkout()}
                disabled={isSaving}
                className="inline-flex min-w-[190px] items-center justify-center gap-2 rounded-full bg-[#f2eee8] px-7 py-4 text-base font-bold text-black transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? "Saving..." : "Save workout"}
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
            </div>
          </div>
        </form>
      </main>
    </div>
  );
}
