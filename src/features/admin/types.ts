export type UserStats = {
  currentStreak?: number;
  lastCheckInDate?: string;
  longestStreak?: number;
  monthCheckIns?: Record<string, number>;
  totalCheckIns?: number;
  updatedAt?: any;
};

export type AdminUser = {
  id: string;
  name?: string;
  email?: string;
  photoURL?: string;
  role?: string;
  stats?: UserStats;
};

export type AdminKpi = {
  label: string;
  value: string | number;
  sublabel?: string;
};