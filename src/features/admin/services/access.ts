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
