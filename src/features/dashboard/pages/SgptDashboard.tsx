import React from "react";
import { Link } from "react-router-dom";
import { Activity, ArrowRight, BrainCircuit, ClipboardPen } from "lucide-react";
import UserTopNav from "../../../components/layout/UserTopNav";
import LogoutButton from "../../../components/ui/LogoutButton";
import { useAuth } from "../../../context/AuthContext";

export default function SgptDashboard() {
  const { appUser } = useAuth();

  return (
    <div className="carbon-fiber-bg min-h-screen text-white">
      <UserTopNav />

      <div className="px-3 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-neutral-950 p-5 sm:rounded-[2rem] sm:p-8">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.16),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.10),transparent_28%)]" />
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-400/40 to-transparent" />

            <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-sky-200 sm:text-[11px] sm:tracking-[0.28em]">
                  <BrainCircuit className="h-3.5 w-3.5" />
                  SGPT Access
                </div>

                <h1 className="mt-4 text-2xl font-heading tracking-tight sm:text-4xl">
                  Welcome back{appUser?.name ? `, ${appUser.name}` : ""}.
                </h1>

                <p className="mt-3 max-w-xl text-sm leading-6 text-neutral-400 sm:text-base">
                  This workspace is limited to performance logging and the performance dashboard.
                </p>
              </div>

              <LogoutButton />
            </div>
          </div>

          <div className="mt-6 grid gap-6 lg:mt-8 lg:grid-cols-2">
            <Link
              to="/training"
              className="group relative overflow-hidden rounded-[1.5rem] border border-white/10 bg-neutral-950 p-6 transition hover:border-sky-400/25 hover:bg-neutral-900"
            >
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.10),transparent_32%)] opacity-0 transition group-hover:opacity-100" />
              <div className="relative z-10">
                <div className="inline-flex rounded-2xl border border-sky-500/20 bg-sky-500/10 p-3 text-sky-200">
                  <ClipboardPen className="h-5 w-5" />
                </div>
                <h2 className="mt-4 text-xl font-semibold text-white">Performance logging</h2>
                <p className="mt-2 text-sm leading-6 text-neutral-400">
                  Add, review, and manage metric entries inside the training performance area.
                </p>
                <div className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-sky-200">
                  Open logging
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                </div>
              </div>
            </Link>

            <Link
              to="/admin/performance"
              className="group relative overflow-hidden rounded-[1.5rem] border border-white/10 bg-neutral-950 p-6 transition hover:border-emerald-400/25 hover:bg-neutral-900"
            >
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.12),transparent_32%)] opacity-0 transition group-hover:opacity-100" />
              <div className="relative z-10">
                <div className="inline-flex rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-emerald-200">
                  <Activity className="h-5 w-5" />
                </div>
                <h2 className="mt-4 text-xl font-semibold text-white">Performance dashboard</h2>
                <p className="mt-2 text-sm leading-6 text-neutral-400">
                  View aggregate metrics, leaderboards, and athlete performance history.
                </p>
                <div className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-emerald-200">
                  Open dashboard
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                </div>
              </div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
