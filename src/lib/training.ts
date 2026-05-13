import {
  Activity,
  Dumbbell,
  HeartPulse,
  TrendingUp,
  Flame,
  type LucideIcon,
} from "lucide-react";

export type TrainingCategoryKey = "strength" | "power" | "engine" | "personal" | "zaps";

export type TrainingMovement = {
  name: string;
  slug: string;
  description: string;
  metricTypes: string[];
  unitOptions: string[];
};

export type TrainingCategory = {
  key: TrainingCategoryKey;
  label: string;
  description: string;
  icon: LucideIcon;
  accent: string;
  movements: TrainingMovement[];
};

export const TRAINING_CATEGORIES: TrainingCategory[] = [
  {
    key: "strength",
    label: "Strength",
    description: "Track your main lifts, maxes, and foundational strength work.",
    icon: Dumbbell,
    accent: "from-sky-500/20 to-blue-500/5",
    movements: [
      {
        name: "Back Squat",
        slug: "back-squat",
        description: "Track max strength, working sets, and squat progress over time.",
        metricTypes: ["1RM", "3RM", "5RM", "Working Set", "Volume"],
        unitOptions: ["kg", "reps"],
      },
      {
        name: "Front Squat",
        slug: "front-squat",
        description: "Monitor front rack strength, posture, and lower body power.",
        metricTypes: ["1RM", "3RM", "5RM", "Working Set", "Volume"],
        unitOptions: ["kg", "reps"],
      },
      {
        name: "Flat Bench",
        slug: "flat-bench",
        description: "Track pressing strength and benchmark upper body progress.",
        metricTypes: ["1RM", "3RM", "5RM", "Working Set", "Volume"],
        unitOptions: ["kg", "reps"],
      },
      {
        name: "Incline Bench",
        slug: "incline-bench",
        description: "Track upper-chest development and pressing strength at an angle.",
        metricTypes: ["1RM", "3RM", "5RM", "Working Set", "Volume"],
        unitOptions: ["kg", "reps"],
      },
      {
        name: "Overhead Press",
        slug: "overhead-press",
        description: "Track overhead pressing strength and shoulder development.",
        metricTypes: ["1RM", "3RM", "5RM", "Working Set", "Volume"],
        unitOptions: ["kg", "reps"],
      },
      {
        name: "Deadlift",
        slug: "deadlift",
        description: "Monitor posterior-chain strength and top-end pulling numbers.",
        metricTypes: ["1RM", "3RM", "5RM", "Working Set", "Volume"],
        unitOptions: ["kg", "reps"],
      },
      {
        name: "Trap Bar Deadlift",
        slug: "trap-bar-deadlift",
        description: "Track lower-body force production and athletic strength.",
        metricTypes: ["1RM", "3RM", "5RM", "Working Set"],
        unitOptions: ["kg", "reps"],
      },
      {
        name: "Bent Over Row",
        slug: "bent-over-row",
        description: "Track upper-back strength and balance to pressing numbers.",
        metricTypes: ["1RM", "3RM", "5RM", "Working Set", "Volume"],
        unitOptions: ["kg", "reps"],
      },
      {
        name: "Barbell Hip Thrust",
        slug: "barbell-hip-thrust",
        description: "Track glute strength and hip extension power.",
        metricTypes: ["1RM", "3RM", "5RM", "Working Set", "Volume"],
        unitOptions: ["kg", "reps"],
      },
      {
        name: "Pull Ups",
        slug: "pull-ups",
        description: "Track bodyweight pulling strength and endurance.",
        metricTypes: ["Max Reps", "Weighted", "Bodyweight Set", "Volume"],
        unitOptions: ["reps", "kg"],
      },
      {
        name: "Sled Push",
        slug: "sled-push",
        description: "Track load, pace, and lower-body power output under fatigue.",
        metricTypes: ["Heavy Push", "Distance Effort", "Time Trial"],
        unitOptions: ["kg", "m", "seconds"],
      },
    ],
  },
  {
    key: "power",
    label: "Power",
    description: "Measure explosive output, speed, and movement intent.",
    icon: TrendingUp,
    accent: "from-violet-500/20 to-fuchsia-500/5",
    movements: [
      {
        name: "Hang Power Clean",
        slug: "hang-power-clean",
        description: "Track explosive hip extension and bar speed.",
        metricTypes: ["1RM", "3RM", "Working Set"],
        unitOptions: ["kg", "reps"],
      },
      {
        name: "Trap Bar Deadlift",
        slug: "trap-bar-deadlift",
        description: "Track lower-body force production and athletic strength.",
        metricTypes: ["1RM", "3RM", "5RM", "Working Set"],
        unitOptions: ["kg", "reps"],
      },
      {
        name: "Box Jump",
        slug: "box-jump",
        description: "Monitor explosive lower-body output and jump confidence.",
        metricTypes: ["Max Height", "Rebound Set", "Volume"],
        unitOptions: ["cm", "in", "reps"],
      },
      {
        name: "Box Squat",
        slug: "box-squat",
        description: "Track lower-body strength and squat mechanics.",
        metricTypes: ["1RM", "3RM", "5RM", "Working Set"],
        unitOptions: ["kg", "reps"],
      },
      {
        name: "Horizontal Pin Press",
        slug: "horizontal-pin-press",
        description: "Track upper-body pressing strength and stability.",
        metricTypes: ["1RM", "3RM", "5RM", "Working Set"],
        unitOptions: ["kg", "reps"],
      },
      {
        name: "Vertical Pin Press",
        slug: "vertical-pin-press",
        description: "Track overhead pressing strength and lockout power.",
        metricTypes: ["1RM", "3RM", "5RM", "Working Set"],
        unitOptions: ["kg", "reps"],
      },
      {
        name: "Broad Jump",
        slug: "broad-jump",
        description: "Track horizontal explosiveness and power output.",
        metricTypes: ["Max Distance", "Rebound Set", "Volume"],
        unitOptions: ["cm", "in", "reps"],
      },
      {
        name: "10 Cal Assault Bike",
        slug: "10-cal-assault-bike",
        description: "Track sprint output and repeatability.",
        metricTypes: ["Best Time", "Average Time", "Test Piece"],
        unitOptions: ["seconds"],
      },
    ],
  },
  {
    key: "engine",
    label: "Engine",
    description: "Keep your conditioning benchmarks in one place.",
    icon: Activity,
    accent: "from-orange-500/20 to-amber-500/5",
    movements: [
      {
        name: "1km Run",
        slug: "1km-run",
        description: "Track speed endurance and running benchmark pace.",
        metricTypes: ["Time Trial"],
        unitOptions: ["mm:ss", "seconds"],
      },
      {
        name: "2km Run",
        slug: "2km-run",
        description: "Monitor aerobic power and pacing consistency.",
        metricTypes: ["Time Trial"],
        unitOptions: ["mm:ss", "seconds"],
      },
      {
        name: "500m Row",
        slug: "500m-row",
        description: "Track rowing power and short-engine performance.",
        metricTypes: ["Time Trial"],
        unitOptions: ["mm:ss", "seconds"],
      },
      {
        name: "500m Ski",
        slug: "500m-ski",
        description: "Track ski erg efficiency and upper-body engine.",
        metricTypes: ["Time Trial"],
        unitOptions: ["mm:ss", "seconds"],
      },
      {
        name: "Wall Balls Unbroken",
        slug: "wall-balls-unbroken",
        description: "Track muscular endurance and fatigue resistance.",
        metricTypes: ["Max Unbroken"],
        unitOptions: ["reps"],
      },
    ],
  },
  {
    key: "personal",
    label: "Personal Metrics",
    description: "Keep tabs on body composition and daily health indicators.",
    icon: HeartPulse,
    accent: "from-emerald-500/20 to-teal-500/5",
    movements: [
      {
        name: "Bodyweight",
        slug: "bodyweight",
        description: "Track bodyweight trends over time.",
        metricTypes: ["Check-In"],
        unitOptions: ["kg"],
      },
      {
        name: "Resting HR",
        slug: "resting-hr",
        description: "Track recovery markers and cardiovascular readiness.",
        metricTypes: ["Check-In"],
        unitOptions: ["bpm"],
      },
      {
        name: "Body Fat",
        slug: "body-fat",
        description: "Track body composition changes over time.",
        metricTypes: ["Check-In"],
        unitOptions: ["%"],
      },
    ],
  },
  {
  key: "zaps",
  label: "ZAPS",
  description:
    "Zero Alpha Performance Standard benchmarks for tracking all-round performance.",
  icon: Flame,
  accent: "from-amber-500/20 via-orange-500/10 to-red-500/10",
  movements: [
    {
      name: "Mixed Modal Conditioning",
      slug: "mixed-modal-conditioning",
      description:
        "3 rounds for time: 500m Run, 10 Zero Alphas, 10 KB Swing.",
      metricTypes: ["For Time"],
      unitOptions: ["mm:ss", "seconds"],
    }
  ],
}
];

export function getCategoryByKey(key?: string) {
  return TRAINING_CATEGORIES.find((category) => category.key === key);
}

export function getMovementBySlug(
  categoryKey?: string,
  movementSlug?: string
) {
  const category = getCategoryByKey(categoryKey);
  if (!category) return null;

  const movement = category.movements.find((item) => item.slug === movementSlug);
  if (!movement) return null;

  return { category, movement };
}
