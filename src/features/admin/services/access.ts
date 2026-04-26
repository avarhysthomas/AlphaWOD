import { getFunctions, httpsCallable } from "firebase/functions";

const functions = getFunctions(undefined, "europe-west1");

function getApprovalErrorMessage(err: any) {
  const code = String(err?.code || "");
  const message = String(err?.message || "");

  if (
    code.includes("internal") ||
    code.includes("unavailable") ||
    message.includes("404") ||
    message.toLowerCase().includes("cors")
  ) {
    return "The approve access function is not available yet. Deploy the latest Cloud Functions, or restart the Functions emulator if you're testing locally.";
  }

  if (code.includes("permission-denied")) {
    return "This account does not have permission to approve users.";
  }

  return message || "Failed to approve member.";
}

function getInviteErrorMessage(err: any) {
  const code = String(err?.code || "");
  const message = String(err?.message || "");

  if (
    code.includes("internal") ||
    code.includes("unavailable") ||
    message.includes("404") ||
    message.toLowerCase().includes("cors")
  ) {
    return "The invite member function is not available yet. Deploy the latest Cloud Functions, or restart the Functions emulator if you're testing locally.";
  }

  if (code.includes("permission-denied")) {
    return "This account does not have permission to invite members.";
  }

  return message || "Failed to send invite email.";
}

export async function approveUserAccess(userId: string) {
  const callable = httpsCallable<{ userId: string }, { ok: boolean }>(
    functions,
    "approveUserAccess"
  );

  try {
    return await callable({ userId });
  } catch (err: any) {
    throw new Error(getApprovalErrorMessage(err));
  }
}

export async function inviteMemberByEmail(email: string) {
  const callable = httpsCallable<
    { email: string; origin: string },
    { ok: boolean; signUpUrl: string }
  >(functions, "inviteMemberByEmail");

  try {
    return await callable({ email, origin: window.location.origin });
  } catch (err: any) {
    throw new Error(getInviteErrorMessage(err));
  }
}

function getRoleUpdateErrorMessage(err: any) {
  const code = String(err?.code || "");
  const message = String(err?.message || "");

  if (
    code.includes("internal") ||
    code.includes("unavailable") ||
    message.includes("404") ||
    message.toLowerCase().includes("cors")
  ) {
    return "The member role update function is not available yet. Deploy the latest Cloud Functions, or restart the Functions emulator if you're testing locally.";
  }

  if (code.includes("permission-denied")) {
    return "This account does not have permission to change member roles.";
  }

  return message || "Failed to update member role.";
}

export async function updateMemberRole(userId: string, role: "user" | "sgpt" | "banned") {
  const callable = httpsCallable<{ userId: string; role: "user" | "sgpt" | "banned" }, { ok: boolean }>(
    functions,
    "updateMemberRole"
  );

  try {
    return await callable({ userId, role });
  } catch (err: any) {
    throw new Error(getRoleUpdateErrorMessage(err));
  }
}
