import React from "react";
import { Sparkles } from "lucide-react";

type PBShareCardProps = {
  athleteName?: string;
  movement: string;
  metricType: string;
  value: string;
  unit?: string;
  dateLabel?: string;
  categoryLabel?: string;
};

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

export default function PBShareCard({
  athleteName,
  movement,
  metricType,
  value,
  unit,
  dateLabel,
  categoryLabel = "Zero Alpha Performance",
}: PBShareCardProps) {
  const movementLines = splitMovementLabel(movement);

  return (
    <div
      className="relative w-[720px] overflow-hidden rounded-[40px] border border-white/12 bg-black/60 p-10 shadow-[0_24px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl"
      style={{ background: "rgba(0,0,0,0.58)" }}
    >
      {/* background layers */}
      <div className="absolute inset-0 rounded-[40px] bg-[linear-gradient(180deg,rgba(255,255,255,0.045),transparent_24%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.10),transparent_32%)]" />

      <img
        src="/ZERO-ALPHA.png"
        alt=""
        className="pointer-events-none absolute left-1/2 top-1/2 w-[360px] -translate-x-1/2 -translate-y-1/2 select-none opacity-[0.045]"
      />

      <div className="relative">
        {/* badge */}
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4 py-2">
          <Sparkles className="h-4 w-4 text-white" />
          <span className="text-[12px] font-semibold uppercase tracking-[0.2em] text-white/72">
            New PB
          </span>
        </div>

        {/* category */}
        <div className="mt-5 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/38">
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
        <div className="mt-5 flex items-center gap-4">
          <div className="h-[2px] w-14 rounded-full bg-sky-400/70" />
          <div className="inline-flex items-center rounded-full border border-sky-400/20 bg-sky-400/10 px-4 py-2 text-[14px] font-semibold uppercase tracking-[0.2em] text-sky-100">
            {metricType}
          </div>
        </div>

        {/* result */}
        <div className="mt-8 flex items-end justify-between gap-6">
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
            Result
          </div>
        </div>

        {/* footer */}
        <div className="mt-8 flex items-end justify-between gap-6 border-t border-white/10 pt-5">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/35">
              Athlete
            </div>
            <div className="mt-1 truncate text-[16px] font-semibold text-white/80">
              {athleteName || "AlphaFIT Athlete"}
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
      </div>
    </div>
  );
}