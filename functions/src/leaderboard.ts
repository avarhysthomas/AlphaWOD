/* eslint-disable require-jsdoc */

import {resolveUserAuthorisation, UserAuthorisationInput} from "./authz";

export const LEADERBOARD_HISTORY_MONTHS = 24;
export const LEADERBOARD_FUTURE_MONTHS = 1;
export const LEADERBOARD_CANDIDATE_MAX_ROWS = 500;

export type LeaderboardProfile = UserAuthorisationInput & {
  name?: unknown;
  photoURL?: unknown;
};

function monthOrdinal(monthKey: string): number | null {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || year < 2000 || year > 9999 ||
    month < 1 || month > 12) {
    return null;
  }
  return year * 12 + month - 1;
}

export function resolveBoundedLeaderboardMonthKey(
  value: unknown,
  currentMonthKey: string
): string | null {
  const candidate = typeof value === "string" && value.trim() ?
    value.trim() : currentMonthKey;
  const candidateOrdinal = monthOrdinal(candidate);
  const currentOrdinal = monthOrdinal(currentMonthKey);
  if (candidateOrdinal === null || currentOrdinal === null) return null;
  const difference = candidateOrdinal - currentOrdinal;
  if (difference < -LEADERBOARD_HISTORY_MONTHS ||
    difference > LEADERBOARD_FUTURE_MONTHS) return null;
  return candidate;
}

function currentDisplayProfile(
  userId: string,
  profiles: Map<string, LeaderboardProfile>
): {name: string; photoURL: string} | null {
  const profile = profiles.get(userId);
  if (!profile || !resolveUserAuthorisation(profile).alphaWodAccess) {
    return null;
  }
  return {
    name: typeof profile.name === "string" && profile.name.trim() ?
      profile.name.trim() : "Member",
    photoURL: typeof profile.photoURL === "string" ? profile.photoURL : "",
  };
}

function normaliseDipCount(value: unknown): number {
  let count: number;
  try {
    count = Number(value ?? 0);
  } catch {
    return 0;
  }

  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(count));
}

export function filterAttendanceLeaderboardRows(
  values: unknown[],
  profiles: Map<string, LeaderboardProfile>,
  limit: number
) {
  const rows = new Map<string, {
    userId: string;
    name: string;
    photoURL: string;
    attendedCount: number;
  }>();
  values.forEach((value) => {
    const row = (value || {}) as Record<string, unknown>;
    const userId = typeof row.userId === "string" ? row.userId : "";
    if (!userId || rows.has(userId)) return;
    const profile = currentDisplayProfile(userId, profiles);
    if (!profile) return;
    rows.set(userId, {
      userId,
      ...profile,
      attendedCount: Math.max(0, Number(row.attendedCount || 0)),
    });
  });
  return [...rows.values()]
    .sort((left, right) =>
      right.attendedCount - left.attendedCount ||
      left.name.localeCompare(right.name)
    )
    .slice(0, limit);
}

export function filterDipLeaderboardRows(
  values: unknown[],
  profiles: Map<string, LeaderboardProfile>,
  limit: number
) {
  const rows = new Map<string, {
    userId: string;
    name: string;
    photoURL: string;
    dipCount: number;
  }>();
  values.forEach((value) => {
    const row = (value || {}) as Record<string, unknown>;
    const userId = typeof row.userId === "string" ? row.userId : "";
    if (!userId || rows.has(userId)) return;
    const profile = currentDisplayProfile(userId, profiles);
    const dipCount = normaliseDipCount(row.dipCount);
    if (!profile || dipCount <= 0) return;
    rows.set(userId, {userId, ...profile, dipCount});
  });
  return [...rows.values()]
    .sort((left, right) =>
      right.dipCount - left.dipCount || left.name.localeCompare(right.name)
    )
    .slice(0, limit);
}
