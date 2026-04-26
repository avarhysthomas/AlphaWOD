export type AppRole = "admin" | "user" | "sgpt" | "banned";

export function isAdminRole(role?: string): role is "admin" {
  return role === "admin";
}

export function isSgptRole(role?: string): role is "sgpt" {
  return role === "sgpt";
}

export function hasPerformanceAccess(role?: string) {
  return isAdminRole(role) || isSgptRole(role);
}

export function isGeneralMemberRole(role?: string): role is "admin" | "user" {
  return role === "admin" || role === "user";
}

export function canAccessTraining(role?: string): role is "admin" | "user" | "sgpt" {
  return isGeneralMemberRole(role) || isSgptRole(role);
}
