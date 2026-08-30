import React from "react";
import { CalendarDays, CreditCard, User } from "lucide-react";
import { Link } from "react-router-dom";

export default function FeatureNotIncluded({ featureName }: { featureName: string }) {
  return (
    <main className="carbon-fiber-bg grid min-h-screen place-items-center px-5 py-10 text-[#f4f0ea]">
      <section className="w-full max-w-xl rounded-2xl border border-amber-300/20 bg-[#151311] p-7 shadow-[0_24px_80px_rgba(0,0,0,0.45)] sm:p-9">
        <h1 className="font-heading text-5xl uppercase leading-none text-white">
          Not included
        </h1>
        <p className="mt-5 text-base leading-7 text-white/70">
          {featureName} isn&rsquo;t included with Adult Conditioning Only. Your
          membership includes the schedule, your profile, and membership management.
        </p>
        <div className="mt-7 grid gap-3 sm:grid-cols-3">
          <Link
            to="/schedule"
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-[#f4b16d] px-4 py-3 text-sm font-black text-black outline-none transition hover:bg-[#ffc485] focus-visible:ring-2 focus-visible:ring-[#f4b16d] focus-visible:ring-offset-2 focus-visible:ring-offset-[#151311]"
          >
            <CalendarDays className="h-4 w-4" /> Schedule
          </Link>
          <Link
            to="/profile"
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-3 text-sm font-bold text-white outline-none transition hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <User className="h-4 w-4" /> Profile
          </Link>
          <Link
            to="/account/membership"
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-3 text-sm font-bold text-white outline-none transition hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <CreditCard className="h-4 w-4" /> Membership
          </Link>
        </div>
        <p className="mt-6 text-sm leading-6 text-white/48">
          Want full app access? Compare memberships or contact Zero Alpha Fitness.
        </p>
        <Link
          to="/memberships"
          className="mt-2 inline-flex text-sm font-bold text-[#f4b16d] underline decoration-[#f4b16d]/40 underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f4b16d]"
        >
          Compare memberships
        </Link>
      </section>
    </main>
  );
}
