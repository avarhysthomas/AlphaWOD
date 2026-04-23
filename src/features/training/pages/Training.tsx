import React from "react";
import { Link } from "react-router-dom";
import {
  ChevronRight,
  Dumbbell,
} from "lucide-react";
import { TRAINING_CATEGORIES } from "../../../lib/training";
import UserTopNav from "../../../components/layout/UserTopNav";

export default function Training() {
  return (
    <div className="min-h-screen bg-black text-white">
      <UserTopNav />

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="relative overflow-hidden rounded-[32px] border border-white/10 bg-neutral-950 shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(59,130,246,0.16),transparent_30%),radial-gradient(circle_at_56%_0%,rgba(168,85,247,0.10),transparent_26%),radial-gradient(circle_at_85%_10%,rgba(249,115,22,0.14),transparent_28%),linear-gradient(135deg,rgba(255,255,255,0.03),transparent_55%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:32px_32px] opacity-[0.06]" />
          <div className="absolute -right-8 bottom-[-28px] select-none text-[110px] font-black uppercase tracking-[0.18em] text-white/[0.04] sm:text-[150px] lg:text-[190px]">
            PERF
          </div>

          <div className="relative p-6 sm:p-8 lg:p-10">
            <div className="max-w-4xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-white/72 backdrop-blur-md">
                <Dumbbell className="h-3.5 w-3.5" />
                Performance
              </div>

              <h1 className="mt-6 text-4xl font-heading uppercase tracking-[-0.04em] sm:text-5xl lg:text-6xl">
                Zero Alpha Performance Hub
              </h1>

              <p className="mt-4 max-w-3xl text-sm leading-7 text-white/68 sm:text-base">
                Explore your benchmark categories, log key movements, track
                progress over time.
              </p>

              <div className="mt-6 flex flex-wrap gap-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/45">
                <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 backdrop-blur">
                  {TRAINING_CATEGORIES.reduce(
                    (total, category) => total + category.movements.length,
                    0
                  )}{" "}
                  total movements
                </span>
                <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 backdrop-blur">
                  Performance tracking
                </span>
                <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 backdrop-blur">
                  Zero Alpha standard
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {TRAINING_CATEGORIES.map((category, index) => {
            const Icon = category.icon;

            return (
              <Link
                key={category.key}
                to={`/training/${category.key}`}
                className="group relative overflow-hidden rounded-[30px] border border-white/10 bg-neutral-950/95 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_24px_60px_rgba(0,0,0,0.35)] transition duration-300 hover:-translate-y-1.5 hover:border-white/20 hover:bg-neutral-900"
              >
                <div className="absolute inset-0 opacity-0 transition duration-300 group-hover:opacity-100 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_40%)]" />
                <div className={`absolute inset-0 bg-gradient-to-br ${category.accent} opacity-95`} />
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
                <div className="absolute right-5 top-5 text-[72px] font-black tracking-[-0.05em] text-white/[0.05] transition duration-300 group-hover:text-white/[0.08]">
                  {String(index + 1).padStart(2, "0")}
                </div>

                <div className="relative flex h-full flex-col p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="rounded-[22px] border border-white/10 bg-black/25 p-4 backdrop-blur">
                      <Icon className="h-5 w-5 text-white" />
                    </div>

                    <div className="rounded-full border border-white/10 bg-black/20 p-2.5 text-white/35 transition duration-300 group-hover:border-white/20 group-hover:bg-black/30 group-hover:text-white/75">
                      <ChevronRight className="h-4 w-4 transition duration-300 group-hover:translate-x-0.5" />
                    </div>
                  </div>

                  <div className="mt-16">
                    <div className="text-3xl font-heading uppercase tracking-[0.02em]">
                      {category.label}
                    </div>

                    <p className="mt-4 text-sm leading-7 text-white/72">
                      {category.description}
                    </p>
                  </div>

                  <div className="mt-8 grid grid-cols-2 gap-3 rounded-[22px] border border-white/10 bg-black/25 p-4 backdrop-blur-sm">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/38">
                        Movements
                      </div>
                      <div className="mt-1 text-sm font-semibold text-white/86">
                        {category.movements.length}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/38">
                        Focus
                      </div>
                      <div className="mt-1 text-sm font-semibold text-white/86">
                        {category.key === "strength"
                          ? "Force"
                          : category.key === "power"
                          ? "Explosive"
                          : category.key === "engine"
                          ? "Conditioning"
                          : category.key === "zaps"
                          ? "Gym Standard"
                          : "Health"}
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 flex items-center justify-between border-t border-white/8 pt-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/38">
                      Open category
                    </div>
                    <div className="text-sm font-medium text-white/68 transition duration-300 group-hover:text-white">
                      Explore
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </section>
      </div>
    </div>
  );
}
