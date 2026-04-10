import React from "react";
import { Sparkles } from "lucide-react";
import type { TrainingCategoryKey } from "../../../lib/training";

type PBShareCardProps = {
  athleteName?: string;
  movement: string;
  metricType: string;
  value: string;
  unit?: string;
  dateLabel?: string;
  categoryLabel?: string;
  categoryKey?: TrainingCategoryKey | null;
};

function getPBShareTheme(categoryKey?: TrainingCategoryKey | null) {
  switch (categoryKey) {
    case "strength":
      return {
        badgeLabel: "Strength PB",
        glow: "radial-gradient(circle_at_top_right,rgba(59,130,246,0.12),transparent_32%)",
        ambientGlow:
          "radial-gradient(circle_at_bottom_left,rgba(96,165,250,0.08),transparent_38%)",
        line: "bg-sky-400/70",
        pill: "border-sky-400/20 bg-sky-400/10 text-sky-100",
        resultPanel:
          "border-sky-400/18 bg-sky-400/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
        resultLabel: "Load",
        categoryText: "text-sky-100/78",
        logoOpacity: "opacity-[0.22]",
      };
    case "power":
      return {
        badgeLabel: "Power PB",
        glow: "radial-gradient(circle_at_top_right,rgba(168,85,247,0.14),transparent_32%)",
        ambientGlow:
          "radial-gradient(circle_at_bottom_left,rgba(217,70,239,0.10),transparent_40%)",
        line: "bg-fuchsia-400/70",
        pill: "border-fuchsia-400/20 bg-fuchsia-400/10 text-fuchsia-100",
        resultPanel:
          "border-fuchsia-400/18 bg-fuchsia-400/[0.08] shadow-[0_0_24px_rgba(168,85,247,0.12)]",
        resultLabel: "Output",
        categoryText: "text-fuchsia-100/78",
        logoOpacity: "opacity-[0.22]",
      };
    case "engine":
      return {
        badgeLabel: "Engine PB",
        glow: "radial-gradient(circle_at_top_right,rgba(249,115,22,0.14),transparent_32%)",
        ambientGlow:
          "radial-gradient(circle_at_bottom_left,rgba(251,191,36,0.10),transparent_40%)",
        line: "bg-orange-400/70",
        pill: "border-orange-400/20 bg-orange-400/10 text-orange-100",
        resultPanel:
          "border-orange-400/18 bg-orange-400/[0.08] shadow-[0_0_24px_rgba(249,115,22,0.12)]",
        resultLabel: "Time",
        categoryText: "text-orange-100/80",
        logoOpacity: "opacity-[0.24]",
      };
    case "personal":
      return {
        badgeLabel: "Personal Best",
        glow: "radial-gradient(circle_at_top_right,rgba(16,185,129,0.14),transparent_32%)",
        ambientGlow:
          "radial-gradient(circle_at_bottom_left,rgba(45,212,191,0.10),transparent_40%)",
        line: "bg-emerald-400/70",
        pill: "border-emerald-400/20 bg-emerald-400/10 text-emerald-100",
        resultPanel:
          "border-emerald-400/18 bg-emerald-400/[0.08] shadow-[0_0_24px_rgba(16,185,129,0.12)]",
        resultLabel: "Result",
        categoryText: "text-emerald-100/78",
        logoOpacity: "opacity-[0.22]",
      };
    case "zaps":
      return {
        badgeLabel: "Gym PB",
        glow: "radial-gradient(circle_at_top_right,rgba(245,158,11,0.14),transparent_32%)",
        ambientGlow:
          "radial-gradient(circle_at_bottom_left,rgba(251,146,60,0.10),transparent_40%)",
        line: "bg-amber-400/70",
        pill: "border-amber-400/20 bg-amber-400/10 text-amber-100",
        resultPanel:
          "border-amber-400/18 bg-amber-400/[0.08] shadow-[0_0_24px_rgba(245,158,11,0.12)]",
        resultLabel: "Score",
        categoryText: "text-amber-100/78",
        logoOpacity: "opacity-[0.24]",
      };
    default:
      return {
        badgeLabel: "New PB",
        glow: "radial-gradient(circle_at_top_right,rgba(255,255,255,0.08),transparent_32%)",
        ambientGlow:
          "radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.06),transparent_40%)",
        line: "bg-white/70",
        pill: "border-white/12 bg-white/[0.08] text-white",
        resultPanel:
          "border-white/12 bg-white/[0.05] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
        resultLabel: "Result",
        categoryText: "text-white/72",
        logoOpacity: "opacity-[0.22]",
      };
  }
}

function splitMovementLabel(input: string) {
  const words = input.trim().split(/\s+/);

  if (words.length <= 2) {
    return [input];
  }

  const midpoint = Math.ceil(words.length / 2);
  return [
    words.slice(0, midpoint).join(" "),
    words.slice(midpoint).join(" "),
  ];
}

function isTimeLikeCategory(categoryKey?: TrainingCategoryKey | null) {
  return categoryKey === "engine";
}

export default function PBShareCard({
  athleteName,
  movement,
  metricType,
  value,
  unit,
  dateLabel,
  categoryLabel = "Zero Alpha Performance",
  categoryKey,
}: PBShareCardProps) {
  const movementLines = splitMovementLabel(movement);
  const theme = getPBShareTheme(categoryKey);
  const isTimeLike = isTimeLikeCategory(categoryKey);

  return (
    <div
      className="relative w-[720px] overflow-hidden rounded-[40px] border border-white/12 p-10 shadow-[0_24px_60px_rgba(0,0,0,0.45)]"
      style={{
        background:
          "linear-gradient(180deg, rgba(14,14,16,0.9), rgba(6,6,8,0.9))",
      }}
    >
      {/* background layers */}
      <div
        className="absolute inset-0 rounded-[40px]"
        style={{
          background: `linear-gradient(180deg, rgba(255,255,255,0.045), transparent 24%), ${theme.glow}, ${theme.ambientGlow}`,
        }}
      />

      <img
        src="/ZERO-ALPHA.png"
        alt=""
        aria-hidden="true"
        draggable={false}
        data-export-skip="true"
        className={`pointer-events-none absolute left-1/2 top-[58%] h-[400px] w-[600px] -translate-x-1/2 -translate-y-1/2 select-none object-contain ${theme.logoOpacity}`}
      />

      <div className="relative">
        {/* badge */}
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4 py-2">
          <Sparkles className="h-4 w-4 text-white" />
          <span className="text-[12px] font-semibold uppercase tracking-[0.2em] text-white/72">
            {theme.badgeLabel}
          </span>
        </div>

        {/* category */}
        <div
          className={`mt-5 text-[11px] font-semibold uppercase tracking-[0.24em] ${theme.categoryText}`}
        >
          {categoryLabel}
        </div>

        {/* movement */}
        <h1 className="mt-4 text-[72px] font-black uppercase leading-[0.9] tracking-[-0.055em] text-white">
          {movementLines.map((line, index) => (
            <span key={`${line}-${index}`} className="block">
              {line}
            </span>
          ))}
        </h1>

        {/* accent + metric */}
        <div className={`flex items-center gap-4 ${isTimeLike ? "mt-4" : "mt-5"}`}>
          <div className={`h-[2px] w-14 rounded-full ${theme.line}`} />
          <div
            className={`inline-flex items-center rounded-full px-4 py-2 text-[14px] font-semibold uppercase tracking-[0.2em] ${theme.pill}`}
          >
            {metricType}
          </div>
        </div>

        {/* result */}
        <div className={`mt-8 ${isTimeLike ? "grid grid-cols-[1.2fr_0.8fr] gap-5" : "flex items-end justify-between gap-6"}`}>
          <div className={`rounded-[30px] border px-6 ${isTimeLike ? "py-6" : "flex-1 py-5"} ${theme.resultPanel}`}>
            {isTimeLike ? (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/38">
                  {theme.resultLabel}
                </div>
                <div className="mt-4 flex items-end leading-none">
                  <span className="text-[84px] font-black tracking-[-0.075em] text-white">
                    {value}
                  </span>
                  {unit ? (
                    <span className="ml-3 pb-[10px] text-[24px] font-semibold text-white/62">
                      {unit}
                    </span>
                  ) : null}
                </div>
                <div className="mt-4 h-px w-full bg-white/10" />
                <div className="mt-4 text-[12px] font-semibold uppercase tracking-[0.22em] text-white/46">
                  Precision beats pace drift
                </div>
              </div>
            ) : (
              <div className="flex items-end justify-between gap-6">
                <div className="flex items-end leading-none">
                  <span className="text-[76px] font-black tracking-[-0.065em] text-white">
                    {value}
                  </span>
                  {unit ? (
                    <span className="ml-2 pb-[8px] text-[26px] font-semibold text-white/65">
                      {unit}
                    </span>
                  ) : null}
                </div>

                <div className="text-right text-[11px] font-semibold uppercase tracking-[0.22em] text-white/35">
                  {theme.resultLabel}
                </div>
              </div>
            )}
          </div>

          {isTimeLike ? (
            <div className="rounded-[30px] border border-white/10 bg-white/[0.04] px-5 py-5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/35">
                Benchmark
              </div>
              <div className="mt-2 text-[22px] font-bold leading-tight text-white">
                {movement}
              </div>
              <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/42">
                Logged
              </div>
              <div className="mt-1 text-[16px] font-semibold text-white/80">
                {dateLabel || "Today"}
              </div>
            </div>
          ) : null}
        </div>

        {/* footer */}
        <div className={`mt-8 border-t border-white/10 pt-5 ${isTimeLike ? "flex items-end justify-between gap-6" : "grid grid-cols-[1fr_auto] gap-6"}`}>
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/35">
              Athlete
            </div>
            <div className="mt-1 truncate text-[16px] font-semibold text-white/80">
              {athleteName || "AlphaFIT Athlete"}
            </div>
          </div>

          {isTimeLike ? (
            <div className="shrink-0 text-right">
              <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/35">
                Category
              </div>
              <div className="mt-1 text-[16px] font-semibold text-white/80">
                {categoryLabel}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-6">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/35">
                  Metric
                </div>
                <div className="mt-1 truncate text-[16px] font-semibold text-white/80">
                  {metricType}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/35">
                  Logged
                </div>
                <div className="mt-1 text-[16px] font-semibold text-white/80">
                  {dateLabel || "Today"}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
