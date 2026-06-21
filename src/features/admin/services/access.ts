import { getFunctions, httpsCallable } from "firebase/functions";
import app from "../../../firebase";

const functions = getFunctions(app, "europe-west1");

function describeFirebaseError(err: any) {
  const code = String(err?.code || "");
  const message = String(err?.message || "");
  const details = err?.details ? ` ${JSON.stringify(err.details)}` : "";

  return [code, message].filter(Boolean).join(": ") + details;
}

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
  const diagnostic = describeFirebaseError(err);

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

  return diagnostic || message || "Failed to send invite email.";
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
  const normalisedEmail = email.trim().toLowerCase();

  if (!normalisedEmail) {
    throw new Error("Email address is required.");
  }

  const callable = httpsCallable<
    { email: string; origin: string },
    { ok: boolean; signUpUrl: string }
  >(functions, "inviteMemberByEmail");

  try {
    return await callable({ email: normalisedEmail, origin: window.location.origin });
  } catch (err: any) {
    console.error("inviteMemberByEmail failed", err);
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

function getStrengthBlockUpdateErrorMessage(err: any) {
  const code = String(err?.code || "");
  const message = String(err?.message || "");

  if (
    code.includes("internal") ||
    code.includes("unavailable") ||
    message.includes("404") ||
    message.toLowerCase().includes("cors")
  ) {
    return "The strength block update function is not available yet. Deploy the latest Cloud Functions, or restart the Functions emulator if you're testing locally.";
  }

  if (code.includes("permission-denied")) {
    return "This account does not have permission to change strength blocks.";
  }

  return message || "Failed to update strength block.";
}

export async function updateMemberStrengthBlock(
  userId: string,
  strengthBlock: "A" | "B" | "none"
) {
  const callable = httpsCallable<
    { userId: string; strengthBlock: "A" | "B" | "none" },
    { ok: boolean }
  >(functions, "updateMemberStrengthBlock");

  try {
    return await callable({ userId, strengthBlock });
  } catch (err: any) {
    throw new Error(getStrengthBlockUpdateErrorMessage(err));
  }
}

function getStrengthBlockSettingsUpdateErrorMessage(err: any) {
  const code = String(err?.code || "");
  const message = String(err?.message || "");

  if (
    code.includes("internal") ||
    code.includes("unavailable") ||
    message.includes("404") ||
    message.toLowerCase().includes("cors")
  ) {
    return "The strength block settings function is not available yet. Deploy the latest Cloud Functions, or restart the Functions emulator if you're testing locally.";
  }

  if (code.includes("permission-denied")) {
    return "This account does not have permission to change strength block settings.";
  }

  return message || "Failed to update strength block settings.";
}

export async function updateStrengthBlockSettings(strengthBlocksEnabled: boolean) {
  const callable = httpsCallable<
    { strengthBlocksEnabled: boolean },
    { ok: boolean; strengthBlocksEnabled: boolean }
  >(functions, "updateStrengthBlockSettings");

  try {
    return await callable({ strengthBlocksEnabled });
  } catch (err: any) {
    throw new Error(getStrengthBlockSettingsUpdateErrorMessage(err));
  }
}
