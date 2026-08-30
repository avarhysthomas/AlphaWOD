import type { AppUser } from "../context/authUser";
import { getEffectiveAppAccessTier } from "../context/authUser";

export type AppCapability =
  | "dashboard"
  | "schedule"
  | "profile"
  | "membership"
  | "training"
  | "leaderboards";

const LIMITED_CAPABILITIES = new Set<AppCapability>([
  "schedule",
  "profile",
  "membership",
]);

export function hasAppCapability(
  appUser: AppUser | null | undefined,
  capability: AppCapability
) {
  const tier = getEffectiveAppAccessTier(appUser);
  if (tier === "full") return true;
  if (tier === "limited") return LIMITED_CAPABILITIES.has(capability);
  return false;
}

export function isLimitedAppUser(appUser?: AppUser | null) {
  return getEffectiveAppAccessTier(appUser) === "limited";
}
