import type { WorkoutScoreType, WorkoutSession } from "../types";

export function getPrimaryScoreLabel(workout: WorkoutSession) {
  const scoreType = workout.stats.scoreType;

  if (workout.type === "run") return "Time";
  if (workout.type === "amrap" && scoreType === "rounds") return "Rounds";
  if (workout.type === "emom") return "Time";

  switch (scoreType) {
    case "time":
      return "Time";
    case "rounds":
      return "Rounds";
    case "weight":
      return "Weight";
    case "distance":
      return "Distance";
    case "custom":
      return workout.type === "strength" ? "Logged" : "Result";
    default:
      return inferPrimaryScoreLabel(workout);
  }
}

function inferPrimaryScoreLabel(workout: WorkoutSession) {
  if (workout.type === "strength") return "Logged";
  if (workout.type === "amrap") return "Rounds";
  if (workout.type === "emom") return "Time";
  return "Result";
}

export function formatScoreValue(
  value: string | undefined,
  scoreType: WorkoutScoreType | undefined
) {
  if (!value?.trim()) return value;
  if (scoreType === "time" || scoreType === "rounds") return value;
  return value;
}
