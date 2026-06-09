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
import AppBottomNav from "../../../components/layout/AppBottomNav";
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

  return "border-white/8 bg-white/[0.035] text-white/70";
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
      <div className="carbon-fiber-bg min-h-screen overflow-x-hidden font-barlow text-[#f4f0ea]">

        <div className="overflow-x-hidden px-3 pb-36 pt-5 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <Link
              to="/admin/performance"
              className="inline-flex items-center gap-2 text-sm text-white/42 transition hover:text-white"
            >
              <ArrowLeft className="h-4 w-4 shrink-0" />
              Back to performance
            </Link>

            <div className="relative mt-6 overflow-hidden rounded-[24px] border border-white/8 bg-[#11100f] p-4 sm:rounded-[28px] sm:p-8">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_72%_0%,rgba(255,255,255,0.05),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.025),transparent_48%)]" />
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/18 to-transparent" />

              <div className="relative z-10 flex min-w-0 flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-white/58 sm:text-[11px] sm:tracking-[0.28em]">
                    <Activity className="h-3.5 w-3.5 shrink-0" />
                    All Metrics
                  </div>

                  <h1 className="mt-4 text-[2.75rem] font-bold leading-none sm:text-6xl">
                    Browse Every Logged Metric
                  </h1>

                  <p className="mt-3 max-w-2xl text-sm leading-6 text-white/42 sm:text-base">
                    Search the full metrics library and open the ranking board for any movement members have logged.
                  </p>
                </div>

                {!loading && data ? (
                  <div className="grid w-full grid-cols-2 gap-3 lg:w-auto lg:min-w-[320px] lg:grid-cols-2">
                    <div className="rounded-2xl border border-white/8 bg-[#050505]/55 px-3 py-3 backdrop-blur sm:px-4">
                      <div className="text-[10px] uppercase tracking-[0.2em] text-white/30 sm:text-[11px] sm:tracking-[0.25em]">
                        Total metrics
                      </div>
                      <div className="mt-2 text-xl font-semibold text-white sm:text-2xl">
                        {data.allMetrics.length}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/8 bg-[#050505]/55 px-3 py-3 backdrop-blur sm:px-4">
                      <div className="text-[10px] uppercase tracking-[0.2em] text-white/30 sm:text-[11px] sm:tracking-[0.25em]">
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
                        className="w-full rounded-[20px] border border-white/8 bg-[#090909] py-3.5 pl-11 pr-4 text-sm text-white outline-none transition placeholder:text-white/22 focus:border-white/20 focus:bg-[#11100f]"
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
                      className="w-full rounded-[20px] border border-white/8 bg-[#090909] px-4 py-3.5 text-sm text-white outline-none transition focus:border-white/20 focus:bg-[#11100f]"
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
                  <div className="text-sm text-white/42">Loading metrics...</div>
                ) : filteredMetrics.length === 0 ? (
                  <div className="text-sm text-white/42">
                    No metrics match this search yet.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {groupedMetrics.map((group) => {
                      const isOpen = openCategories[group.category] ?? false;

                      return (
                        <div
                          key={group.category}
                          className="overflow-hidden rounded-[1.5rem] border border-white/8 bg-white/[0.025]"
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
                                <span className="text-sm text-white/42">
                                  {group.items.length} metrics
                                </span>
                              </div>
                            </div>

                            <ChevronDown
                              className={`h-4 w-4 shrink-0 text-white/30 transition ${
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
                                  className="group flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-[#050505]/50 px-3 py-3 transition hover:border-white/15 hover:bg-white/[0.035] sm:gap-4 sm:px-4 sm:py-4"
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-medium text-white transition group-hover:text-white sm:text-base">
                                      {item.label}
                                    </div>

                                    <div className="mt-2 flex items-center gap-2 text-xs text-white/30">
                                      <Target className="h-3.5 w-3.5 shrink-0" />
                                      {item.count} logged entries
                                    </div>
                                  </div>

                                  <div className="flex shrink-0 items-center gap-2">
                                    <div className="text-right">
                                      <div className="text-lg font-semibold text-white">
                                        {item.count}
                                      </div>
                                      <div className="text-[10px] uppercase tracking-[0.18em] text-white/30">
                                        total
                                      </div>
                                    </div>
                                    <ChevronRight className="h-4 w-4 shrink-0 text-white/24 transition group-hover:text-white" />
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
        <AppBottomNav />
      </div>
    </PerformanceAccessOnly>
  );
}
