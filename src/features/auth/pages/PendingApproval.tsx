import React, { useState } from "react";
import LogoutButton from "../../../components/ui/LogoutButton";
import { useAuth } from "../../../context/AuthContext";
import { bootstrapUserProfile } from "../services/account";

export default function PendingApproval() {
  const { user, appUser, refreshAppUser } = useAuth();
  const [name, setName] = useState(() => user?.displayName?.trim() || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const profileMissing = appUser?.profileExists === false;
  const profileUnavailable = appUser?.profileExists === undefined;

  async function recoverProfile(event: React.FormEvent) {
    event.preventDefault();
    const displayName = name.trim();
    if (displayName.length < 2 || busy) return;
    try {
      setBusy(true);
      setError("");
      await bootstrapUserProfile(displayName);
      await refreshAppUser();
    } catch (err) {
      console.error("Failed to finish account setup:", err);
      setError("We could not finish setting up your account. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function retryVerification() {
    try {
      setBusy(true);
      setError("");
      await refreshAppUser();
    } catch (err) {
      console.error("Failed to verify account access:", err);
      setError("We still cannot verify your account. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const eyebrow = profileMissing ? "Setup Interrupted" :
    profileUnavailable ? "Verification Required" : "Approval Required";
  const title = profileMissing ? "Finish setting up your account" :
    profileUnavailable ? "We cannot verify your account yet" :
      "Your account is waiting for admin approval";

  return (
    <div className="auth-screen carbon-fiber-bg min-h-screen px-4 py-5 text-white sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-2.5rem)] max-w-xl items-center justify-center">
        <div className="w-full rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(217,119,6,0.14),transparent_28%),linear-gradient(180deg,rgba(18,18,18,0.98),rgba(5,5,5,0.98))] p-7 shadow-[0_24px_80px_rgba(0,0,0,0.45)] sm:p-8">
          <div className="inline-flex rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-200">
            {eyebrow}
          </div>

          <h1 className="mt-5 text-3xl font-heading uppercase tracking-wide text-white sm:text-4xl">
            {title}
          </h1>

          {profileMissing ? (
            <form className="mt-5" onSubmit={recoverProfile}>
              <p className="text-sm leading-7 text-neutral-300 sm:text-base">
                Your login was created, but setup did not finish. Enter your name to safely retry;
                this will not create a duplicate account.
              </p>
              <label className="mt-5 block">
                <span className="mb-2 block text-sm font-medium text-neutral-300">Full name</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  required
                  minLength={2}
                  className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none focus:border-amber-400/40"
                />
              </label>
              <button
                type="submit"
                disabled={busy || name.trim().length < 2}
                className="mt-5 min-h-11 rounded-2xl bg-amber-300 px-5 py-3 font-semibold text-black disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "Finishing setup..." : "Finish account setup"}
              </button>
            </form>
          ) : profileUnavailable ? (
            <div className="mt-5">
              <p className="text-sm leading-7 text-neutral-300 sm:text-base">
                For security, Zero Alpha App opens only after the server confirms your current access.
                Reconnect to the internet and try again.
              </p>
              <button
                type="button"
                onClick={retryVerification}
                disabled={busy}
                className="mt-5 min-h-11 rounded-2xl bg-amber-300 px-5 py-3 font-semibold text-black disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "Checking..." : "Retry verification"}
              </button>
            </div>
          ) : (
            <>
              <p className="mt-4 text-sm leading-7 text-neutral-300 sm:text-base">
                <span className="font-medium text-white">{appUser?.email || "This account"}</span> has
                been created, but access is still locked until an admin approves it.
              </p>
              <p className="mt-3 text-sm leading-7 text-neutral-400">
                Once approved, you can log straight back in and use the app normally.
              </p>
            </>
          )}

          {error ? <p role="alert" className="mt-4 text-sm text-red-200">{error}</p> : null}

          <div className="mt-8 flex flex-wrap gap-3">
            <LogoutButton />
          </div>
        </div>
      </div>
    </div>
  );
}
