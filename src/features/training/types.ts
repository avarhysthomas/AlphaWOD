export type TrainingLog = {
  id: string;
  category?: string;
  movementSlug?: string;
  movementName?: string;
  metricType: string;
  value: string;
  unit: string;
  reps?: string;
  date: string;
  notes?: string;
};
