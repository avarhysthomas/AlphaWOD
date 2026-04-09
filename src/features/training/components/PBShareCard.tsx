import React from "react";
import { Trophy, Sparkles } from "lucide-react";

type PBShareCardProps = {
  athleteName?: string;
  movement: string;
  metricType: string;
  value: string;
  unit?: string;
  dateLabel?: string;
  categoryLabel?: string;
};

export default function PBShareCard({
  athleteName,
  movement,
  metricType,
  value,
  unit,
  dateLabel,
  categoryLabel = "Zero Alpha Performance",
}: PBShareCardProps) {
  return (
    <div
      className="relative w-[1080px] h-[1920px] overflow-hidden"
      style={{ background: "transparent" }}
    >
      {/* transparent canvas */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[140px] left-[90px] h-[280px] w-[280px] rounded-full bg-sky-500/15 blur-3xl" />
        <div className="absolute bottom-[180px] right-[80px] h-[320px] w-[320px] rounded-full bg-blue-500/10 blur-3xl" />
      </div>

      {/* floating badge */}
      <div className="absolute top-[120px] left-[80px] inline-flex items-center gap-3 rounded-full border border-white/15 bg-black/45 px-7 py-4 backdrop-blur-xl">
        <Sparkles className="h-6 w-6 text-white" />
        <span className="text-[26px] font-semibold uppercase tracking-[0.28em] text-white/85">
          New PB
        </span>
      </div>

      {/* main sticker */}
      <div className="absolute left-[80px] right-[80px] top-[300px] rounded-[48px] border border-white/12 bg-black/55 p-12 shadow-[0_40px_120px_rgba(0,0,0,0.4)] backdrop-blur-2xl">
        <div className="absolute inset-0 rounded-[48px] bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.16),transparent_25%),linear-gradient(135deg,rgba(255,255,255,0.04),transparent_55%)]" />

        <div className="relative">
          <div className="flex items-start justify-between gap-8">
            <div>
              <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-5 py-3">
                <Trophy className="h-6 w-6 text-white" />
                <span className="text-[22px] font-semibold uppercase tracking-[0.22em] text-white/70">
                  {categoryLabel}
                </span>
              </div>

              <h1 className="mt-10 max-w-[760px] text-[128px] font-black uppercase leading-[0.88] tracking-[-0.06em] text-white">
                {movement}
              </h1>

              <div className="mt-10 inline-flex items-center rounded-full border border-sky-400/25 bg-sky-400/10 px-6 py-3 text-[28px] font-semibold uppercase tracking-[0.22em] text-sky-100">
                {metricType}
              </div>
            </div>

            <div className="rounded-[32px] border border-white/10 bg-black/35 px-8 py-7 text-right">
              <div className="text-[22px] font-semibold uppercase tracking-[0.24em] text-white/40">
                Result
              </div>
              <div className="mt-4 text-[86px] font-black leading-none tracking-[-0.05em] text-white">
                {value}
                {unit ? (
                  <span className="ml-3 text-[42px] font-semibold text-white/70">
                    {unit}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-16 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent" />

          <div className="mt-12 flex items-end justify-between gap-8">
            <div>
              <div className="text-[22px] font-semibold uppercase tracking-[0.22em] text-white/38">
                Athlete
              </div>
              <div className="mt-3 text-[44px] font-semibold tracking-[-0.03em] text-white">
                {athleteName || "AlphaFIT Athlete"}
              </div>
            </div>

            <div className="text-right">
              <div className="text-[22px] font-semibold uppercase tracking-[0.22em] text-white/38">
                Logged
              </div>
              <div className="mt-3 text-[36px] font-semibold tracking-[-0.03em] text-white">
                {dateLabel || "Today"}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* bottom brand */}
      <div className="absolute bottom-[120px] left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-black/40 px-8 py-4 backdrop-blur-xl">
        <span className="text-[24px] font-semibold uppercase tracking-[0.32em] text-white/55">
          ZERO ALPHA
        </span>
      </div>
    </div>
  );
}