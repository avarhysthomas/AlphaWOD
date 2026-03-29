import React from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getCategoryByKey } from "../../../lib/training";
import UserTopNav from "../../../components/layout/UserTopNav";

export default function TrainingCategory() {
  const { category } = useParams<{ category: string }>();
  const selectedCategory = getCategoryByKey(category);

  if (!selectedCategory) {
    return <Navigate to="/training" replace />;
  }

  const Icon = selectedCategory.icon;

  return (
    <div className="min-h-screen bg-black text-white">
      <UserTopNav />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="relative overflow-hidden rounded-[32px] border border-white/10 bg-neutral-950 shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_28%),radial-gradient(circle_at_85%_20%,rgba(59,130,246,0.18),transparent_30%),linear-gradient(135deg,rgba(255,255,255,0.03),transparent_55%)]" />
          <div className={`absolute inset-0 bg-gradient-to-br ${selectedCategory.accent} opacity-90`} />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:32px_32px] opacity-[0.07]" />
          <div className="absolute -right-10 bottom-[-18px] select-none text-[88px] font-heading uppercase tracking-[0.28em] text-white/[0.05] sm:text-[120px] lg:text-[160px]">
            {selectedCategory.label}
          </div>

          <div className="relative p-6 sm:p-8 lg:p-10">
            <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.35em] text-white/75 backdrop-blur-md">
                  <Icon className="h-3.5 w-3.5" />
                  {selectedCategory.label}
                </div>

                <h1 className="text-4xl font-heading uppercase tracking-[-0.04em] sm:text-5xl lg:text-6xl">
                  {selectedCategory.label}
                </h1>

                <p className="mt-4 max-w-2xl text-sm leading-7 text-white/72 sm:text-base">
                  {selectedCategory.description}
                </p>

                <div className="mt-6 flex flex-wrap items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.26em] text-white/45">
                  <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 backdrop-blur">
                    {selectedCategory.movements.length} movements
                  </span>
                  <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 backdrop-blur">
                    Zero Alpha Performance
                  </span>
                  <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 backdrop-blur">
                    Track progress precisely
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <Link
                  to="/training"
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/25 px-5 py-3 text-sm font-semibold text-white/85 backdrop-blur-md transition hover:border-white/20 hover:bg-black/35 hover:text-white"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Back to Training
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {selectedCategory.movements.map((movement, index) => (
            <Link
              key={movement.slug}
              to={`/training/${selectedCategory.key}/${movement.slug}`}
              className="group relative overflow-hidden rounded-[30px] border border-white/10 bg-neutral-950/95 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_24px_60px_rgba(0,0,0,0.35)] transition duration-300 hover:-translate-y-1.5 hover:border-white/20 hover:bg-neutral-900"
            >
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.06),transparent_28%)] opacity-70" />
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
              <div className="absolute right-5 top-5 text-[64px] font-black tracking-[-0.05em] text-white/[0.035] transition duration-300 group-hover:text-white/[0.06]">
                {String(index + 1).padStart(2, "0")}
              </div>

              <div className="relative flex h-full flex-col">
                <div className="flex items-start justify-between gap-4">
                  <div className="pr-10">
                    <div className="mb-3 inline-flex rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                      Benchmark
                    </div>

                    <h2 className="text-2xl font-heading uppercase tracking-[-0.03em] text-white">
                      {movement.name}
                    </h2>

                    <p className="mt-3 text-sm leading-7 text-white/62">
                      {movement.description}
                    </p>
                  </div>

                  <div className="mt-1 rounded-full border border-white/10 bg-white/[0.03] p-2.5 text-white/40 transition duration-300 group-hover:border-white/20 group-hover:bg-white/[0.06] group-hover:text-white/75">
                    <ChevronRight className="h-4 w-4 transition duration-300 group-hover:translate-x-0.5" />
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap gap-2">
                  {movement.metricTypes.map((metric) => (
                    <span
                      key={metric}
                      className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-white/72 transition duration-300 group-hover:border-white/15 group-hover:bg-white/[0.05]"
                    >
                      {metric}
                    </span>
                  ))}
                </div>
                <div className="mt-5 flex items-center justify-between border-t border-white/8 pt-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/35">
                    Open movement
                  </div>
                  <div className="text-sm font-medium text-white/65 transition duration-300 group-hover:text-white">
                    View details
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </section>
      </div>
    </div>
  );
}