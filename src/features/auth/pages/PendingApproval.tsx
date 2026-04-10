import React from "react";
import LogoutButton from "../../../components/ui/LogoutButton";
import { useAuth } from "../../../context/AuthContext";

export default function PendingApproval() {
  const { appUser } = useAuth();

  return (
    <div className="auth-screen min-h-screen bg-black px-4 py-5 text-white sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-2.5rem)] max-w-xl items-center justify-center">
        <div className="w-full rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(217,119,6,0.14),transparent_28%),linear-gradient(180deg,rgba(18,18,18,0.98),rgba(5,5,5,0.98))] p-7 shadow-[0_24px_80px_rgba(0,0,0,0.45)] sm:p-8">
          <div className="inline-flex rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-200">
            Approval Required
          </div>

          <h1 className="mt-5 text-3xl font-heading uppercase tracking-wide text-white sm:text-4xl">
            Your account is waiting for admin approval
          </h1>

          <p className="mt-4 text-sm leading-7 text-neutral-300 sm:text-base">
            <span className="font-medium text-white">{appUser?.email || "This account"}</span> has
            been created, but access is still locked until an admin approves it.
          </p>

          <p className="mt-3 text-sm leading-7 text-neutral-400">
            Once approved, you can log straight back in and use the app normally.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <LogoutButton />
          </div>
        </div>
      </div>
    </div>
  );
}
