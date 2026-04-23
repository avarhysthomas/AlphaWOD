export type WorkoutType =
  | "run"
  | "strength"
  | "amrap"
  | "emom"
  | "engine"
  | "class"
  | "hybrid";

export type WorkoutSource = "manual" | "class" | "strava";

export type WorkoutVisibility = "private" | "members";

export type WorkoutScoreType =
  | "time"
  | "rounds"
  | "weight"
  | "distance"
  | "custom";

export type WorkoutSectionKind = "warmup" | "main" | "finisher" | "notes";

export type WorkoutSection = {
  kind: WorkoutSectionKind;
  text: string;
};

export type WorkoutStats = {
  score?: string;
  scoreType?: WorkoutScoreType;
  loadKg?: string;
  reps?: string;
  distanceM?: string;
  calories?: string;
  avgHeartRate?: string;
  area?: string;
  totalRounds?: string;
};

export type WorkoutMovementEntryMetric =
  | "reps"
  | "cals"
  | "distance"
  | "seconds"
  | "load";

export type WorkoutMovementEntry = {
  movementId?: string;
  movementName: string;
  isCustom?: boolean;
  metric: WorkoutMovementEntryMetric;
  value: string;
  loadKg?: string;
  reps?: string;
  sets?: string;
};

export type MovementLibraryItem = {
  id: string;
  slug: string;
  name: string;
  category: string;
  measurementTypes: WorkoutMovementEntryMetric[];
  aliases: string[];
  equipment: string[];
  tags: string[];
  isActive: boolean;
  sortOrder: number;
};

export type WorkoutSession = {
  id: string;
  userId: string;
  userName: string;
  userPhotoURL?: string;
  title: string;
  type: WorkoutType;
  source: WorkoutSource;
  sessionDate: string;
  startTime?: string;
  durationMin?: string;
  notes: string;
  visibility: WorkoutVisibility;
  stats: WorkoutStats;
  sections: WorkoutSection[];
  movementEntries: WorkoutMovementEntry[];
  linkedClassId?: string;
  linkedClassTitle?: string;
  selfieURL?: string;
  createdAtMs: number | null;
  updatedAtMs: number | null;
};

export type FeedPost = {
  id: string;
  kind?: "workout" | "performance";
  workoutSessionId?: string;
  actorId: string;
  actorName: string;
  actorPhotoURL?: string;
  workoutTitle: string;
  workoutType: WorkoutType;
  sessionDate: string;
  startTime?: string;
  durationMin?: string;
  summary: string;
  previewStat: string;
  notesPreview?: string;
  reactionCount: number;
  reactionUserIds: string[];
  linkedClassTitle?: string;
  performanceCategory?: string;
  performanceMovementSlug?: string;
  performanceMetricType?: string;
  performanceValue?: string;
  performanceUnit?: string;
  createdAtMs: number | null;
};

export type CreateWorkoutSessionInput = {
  userId: string;
  userName: string;
  userPhotoURL?: string;
  title: string;
  type: WorkoutType;
  source?: WorkoutSource;
  sessionDate: string;
  startTime?: string;
  durationMin?: string;
  notes: string;
  visibility: WorkoutVisibility;
  stats: WorkoutStats;
  sections: WorkoutSection[];
  movementEntries?: WorkoutMovementEntry[];
  linkedClassId?: string;
  linkedClassTitle?: string;
  selfieURL?: string;
};
