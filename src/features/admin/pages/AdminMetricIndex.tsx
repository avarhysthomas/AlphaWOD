import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Search,
  Target,
} from "lucide-react";
import PerformanceAccessOnly from "../../../components/guards/PerformanceAccessOnly";
import UserTopNav from "../../../components/layout/UserTopNav";
import AdminSectionCard from "../components/AdminSectionCard";
import { getPerformanceSummary } from "../services/performance";

type PerformanceSummary = Awaited<ReturnType<typeof getPerformanceSummary>>;

function getCategoryPill(category?: string) {
  const key = (category || "").toLowerCase();

  if (key === "strength") {
    return "border-sky-500/20 bg-sky-500/10 text-sky-300";
  }
  if (key === "power") {
    return "border-amber-500/20 bg-amber-500/10 text-amber-300";
  }
  if (key === "engine") {
    return "border-red-500/20 bg-red-500/10 text-red-300";
  }
  if (key === "personal") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
  }

  return "border-white/10 bg-white/[0.04] text-white/70";
}

export default function AdminMetricIndex() {
  const [data, setData] = useState<PerformanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const res = await getPerformanceSummary();
        if (alive) setData(res);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const filteredMetrics = useMemo(() => {
    if (!data) return [];

    return data.allMetrics.filter((metric) => {
      const matchesCategory =
        categoryFilter === "all" || (metric.category || "unknown") === categoryFilter;
      const needle = search.trim().toLowerCase();
      const matchesSearch =
        !needle ||
        metric.label.toLowerCase().includes(needle) ||
        (metric.movementName || "").toLowerCase().includes(needle) ||
        (metric.metricType || "").toLowerCase().includes(needle);

      return matchesCategory && matchesSearch;
    });
  }, [categoryFilter, data, search]);

  const groupedMetrics = useMemo(() => {
    return filteredMetrics.reduce<
      Array<{
        category: string;
        items: typeof filteredMetrics;
      }>
    >((acc, metric) => {
      const category = metric.category || "unknown";
      const existing = acc.find((group) => group.category === category);

      if (existing) {
        existing.items.push(metric);
        return acc;
      }

      acc.push({
        category,
        items: [metric],
      });

      return acc;
    }, []);
  }, [filteredMetrics]);

  useEffect(() => {
    if (!groupedMetrics.length) return;

    setOpenCategories((current) => {
      const next = { ...current };

      groupedMetrics.forEach((group, index) => {
        if (next[group.category] === undefined) {
          next[group.category] = categoryFilter !== "all" || index === 0;
        }
      });

      return next;
    });
  }, [categoryFilter, groupedMetrics]);

  function toggleCategory(category: string) {
    setOpenCategories((current) => ({
      ...current,
      [category]: !current[category],
    }));
  }

  return (
    <PerformanceAccessOnly>
      <div className="min-h-screen bg-black text-white">
        <UserTopNav />

        <div className="overflow-x-hidden px-3 py-5 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <Link
              to="/admin/performance"
              className="inline-flex items-center gap-2 text-sm text-neutral-400 transition hover:text-white"
            >
              <ArrowLeft className="h-4 w-4 shrink-0" />
              Back to performance
            </Link>

            <div className="relative mt-6 overflow-hidden rounded-[1.75rem] border border-white/10 bg-neutral-950 p-4 sm:rounded-[2rem] sm:p-8">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.12),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.10),transparent_28%)]" />
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/40 to-transparent" />

              <div className="relative z-10 flex min-w-0 flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-amber-200 sm:text-[11px] sm:tracking-[0.28em]">
                    <Activity className="h-3.5 w-3.5 shrink-0" />
                    All Metrics
                  </div>

                  <h1 className="mt-4 text-2xl font-heading tracking-tight sm:text-4xl">
                    Browse Every Logged Metric
                  </h1>

                  <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-400 sm:text-base">
                    Search the full metrics library and open the ranking board for any movement members have logged.
                  </p>
                </div>

                {!loading && data ? (
                  <div className="grid w-full grid-cols-2 gap-3 lg:w-auto lg:min-w-[320px] lg:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-black/40 px-3 py-3 backdrop-blur sm:px-4">
                      <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 sm:text-[11px] sm:tracking-[0.25em]">
                        Total metrics
                      </div>
                      <div className="mt-2 text-xl font-semibold text-white sm:text-2xl">
                        {data.allMetrics.length}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/40 px-3 py-3 backdrop-blur sm:px-4">
                      <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 sm:text-[11px] sm:tracking-[0.25em]">
                        Showing
                      </div>
                      <div className="mt-2 text-xl font-semibold text-white sm:text-2xl">
                        {filteredMetrics.length}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="mt-6 grid gap-6 lg:mt-8 lg:grid-cols-[0.85fr_1.15fr]">
              <AdminSectionCard title="Filters">
                <div className="space-y-4">
                  <label className="block">
                    <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-white/44">
                      Search
                    </span>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search movement or metric"
                        className="w-full rounded-[20px] border border-white/10 bg-black/85 py-3.5 pl-11 pr-4 text-sm text-white outline-none transition placeholder:text-white/22 focus:border-white/20 focus:bg-neutral-950"
                      />
                    </div>
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-white/44">
                      Category
                    </span>
                    <select
                      value={categoryFilter}
                      onChange={(e) => setCategoryFilter(e.target.value)}
                      className="w-full rounded-[20px] border border-white/10 bg-black/85 px-4 py-3.5 text-sm text-white outline-none transition focus:border-white/20 focus:bg-neutral-950"
                    >
                      <option value="all">All categories</option>
                      {data?.topCategories.map((item) => (
                        <option key={item.category} value={item.category}>
                          {item.category}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </AdminSectionCard>

              <AdminSectionCard title="Metric Library">
                {loading ? (
                  <div className="text-sm text-neutral-400">Loading metrics...</div>
                ) : filteredMetrics.length === 0 ? (
                  <div className="text-sm text-neutral-400">
                    No metrics match this search yet.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {groupedMetrics.map((group) => {
                      const isOpen = openCategories[group.category] ?? false;

                      return (
                        <div
                          key={group.category}
                          className="overflow-hidden rounded-[1.5rem] border border-white/8 bg-white/[0.02]"
                        >
                          <button
                            type="button"
                            onClick={() => toggleCategory(group.category)}
                            className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition hover:bg-white/[0.03]"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.18em] ${getCategoryPill(
                                    group.category
                                  )}`}
                                >
                                  {group.category}
                                </span>
                                <span className="text-sm text-neutral-400">
                                  {group.items.length} metrics
                                </span>
                              </div>
                            </div>

                            <ChevronDown
                              className={`h-4 w-4 shrink-0 text-neutral-500 transition ${
                                isOpen ? "rotate-180 text-white" : ""
                              }`}
                            />
                          </button>

                          {isOpen ? (
                            <div className="space-y-3 border-t border-white/6 px-3 py-3 sm:px-4">
                              {group.items.map((item) => (
                                <Link
                                  key={`${item.movementSlug}-${item.metricType}`}
                                  to={
                                    item.movementSlug && item.metricType
                                      ? `/admin/performance/metric/${item.movementSlug}/${encodeURIComponent(
                                          item.metricType
                                        )}`
                                      : "#"
                                  }
                                  className="group flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-black/30 px-3 py-3 transition hover:border-white/15 hover:bg-white/[0.04] sm:gap-4 sm:px-4 sm:py-4"
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-medium text-white transition group-hover:text-amber-100 sm:text-base">
                                      {item.label}
                                    </div>

                                    <div className="mt-2 flex items-center gap-2 text-xs text-neutral-500">
                                      <Target className="h-3.5 w-3.5 shrink-0" />
                                      {item.count} logged entries
                                    </div>
                                  </div>

                                  <div className="flex shrink-0 items-center gap-2">
                                    <div className="text-right">
                                      <div className="text-lg font-semibold text-white">
                                        {item.count}
                                      </div>
                                      <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">
                                        total
                                      </div>
                                    </div>
                                    <ChevronRight className="h-4 w-4 shrink-0 text-neutral-600 transition group-hover:text-amber-200" />
                                  </div>
                                </Link>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </AdminSectionCard>
            </div>
          </div>
        </div>
      </div>
    </PerformanceAccessOnly>
  );
}
