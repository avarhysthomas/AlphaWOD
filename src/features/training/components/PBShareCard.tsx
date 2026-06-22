import React from "react";
import { BadgeCheck, CalendarDays, Trophy, UserRound } from "lucide-react";
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

function getPBShareCopy(categoryKey?: TrainingCategoryKey | null) {
  switch (categoryKey) {
    case "strength":
      return { badgeLabel: "Strength PB", resultLabel: "Load" };
    case "power":
      return { badgeLabel: "Power PB", resultLabel: "Output" };
    case "engine":
      return { badgeLabel: "Engine PB", resultLabel: "Time" };
    case "personal":
      return { badgeLabel: "Personal Best", resultLabel: "Result" };
    case "zaps":
      return { badgeLabel: "Gym PB", resultLabel: "Score" };
    default:
      return { badgeLabel: "New PB", resultLabel: "Result" };
  }
}

function splitMovementLabel(input: string) {
  const words = input.trim().split(/\s+/).filter(Boolean);

  if (words.length <= 2) {
    return [input];
  }

  const midpoint = Math.ceil(words.length / 2);
  return [
    words.slice(0, midpoint).join(" "),
    words.slice(midpoint).join(" "),
  ];
}

function BrandSocialHeader() {
  return (
    <div className="flex h-[58px] items-center justify-between bg-[#f4f4f4] px-4 text-[#050505]">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#050505] font-heading text-[12px] text-[#f4f4f4]">
          ZA
        </div>
        <div className="flex items-center gap-1.5 text-[14px] font-bold leading-none">
          zeroalphafitness
          <BadgeCheck className="h-4 w-4 fill-[#3f3f3f] text-[#f4f4f4]" />
        </div>
      </div>
      <div className="text-[20px] font-black leading-none">...</div>
    </div>
  );
}

function MetaBlock({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 text-[11px] font-black uppercase leading-none text-white/42">
        {icon}
        {label}
      </div>
      <div className="mt-2 truncate text-[18px] font-black leading-tight text-white">
        {value}
      </div>
    </div>
  );
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
  const copy = getPBShareCopy(categoryKey);

  return (
    <div className="relative w-[720px] overflow-hidden rounded-[18px] bg-[#050505] shadow-[0_30px_80px_rgba(0,0,0,0.55)]">
      <BrandSocialHeader />

      <div className="relative overflow-hidden border-t border-[#050505] bg-[#050505] text-white">
        <div className="absolute inset-0 opacity-[0.12] [background-image:radial-gradient(circle_at_20%_10%,#f4f4f4_0_1px,transparent_1px),radial-gradient(circle_at_80%_70%,#f4f4f4_0_1px,transparent_1px)] [background-size:7px_7px,11px_11px]" />

        <div className="relative grid h-[230px] grid-cols-[1fr_180px] border-b border-white/18">
          <div className="relative overflow-hidden bg-[#d7d7d7]">
            <img
              src="/ZERO-ALPHA.png"
              alt=""
              aria-hidden="true"
              draggable={false}
              className="absolute left-1/2 top-1/2 h-[260px] w-[430px] -translate-x-1/2 -translate-y-1/2 select-none object-contain opacity-[0.28] grayscale"
            />
            <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(0,0,0,0.62),rgba(0,0,0,0.06)_45%,rgba(0,0,0,0.74))]" />
            <div className="absolute bottom-5 left-6 font-heading text-[50px] uppercase leading-[0.88] text-[#f4f4f4]">
              New
              <br />
              Best
            </div>
            <div className="absolute right-5 top-5 text-right text-[11px] font-black uppercase leading-tight text-[#f4f4f4]/70">
              Zero Alpha
              <br />
              Performance
            </div>
          </div>

          <div className="flex flex-col justify-between border-l border-white/18 bg-[#101010] p-5">
            <div className="text-[11px] font-black uppercase leading-tight text-white/48">
              {copy.badgeLabel}
            </div>
            <div className="font-heading text-[64px] uppercase leading-[0.82] text-[#f4f4f4]">
              PB
            </div>
            <div className="text-[12px] font-black uppercase leading-tight text-white/62">
              {categoryLabel}
            </div>
          </div>
        </div>

        <div className="relative bg-[#f4f4f4] px-7 py-7 text-[#050505]">
          <h1 className="font-heading text-[82px] uppercase leading-[0.88]">
            {movementLines.map((line, index) => (
              <span key={`${line}-${index}`} className="block">
                {line}
              </span>
            ))}
          </h1>

          <div className="mt-5 grid grid-cols-[1fr_230px] border-y border-[#050505]">
            <div className="py-5 pr-5">
              <div className="text-[12px] font-black uppercase leading-none text-[#050505]/55">
                {metricType}
              </div>
              <div className="mt-3 flex items-end leading-none">
                <span className="font-heading text-[116px] leading-[0.8]">
                  {value}
                </span>
                {unit ? (
                  <span className="mb-2 ml-3 text-[30px] font-black uppercase leading-none">
                    {unit}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col justify-between border-l border-[#050505] py-5 pl-5">
              <div className="text-[12px] font-black uppercase leading-tight text-[#050505]/55">
                Result Type
              </div>
              <div className="font-heading text-[34px] uppercase leading-[0.9]">
                {copy.resultLabel}
              </div>
            </div>
          </div>
        </div>

        <div className="relative grid grid-cols-[1fr_1fr] border-b border-white/18 bg-[#050505] px-7 py-5">
          <MetaBlock
            icon={<UserRound className="h-3.5 w-3.5" />}
            label="Athlete"
            value={athleteName || "AlphaFIT Athlete"}
          />
          <MetaBlock
            icon={<CalendarDays className="h-3.5 w-3.5" />}
            label="Logged"
            value={dateLabel || "Today"}
          />
        </div>

        <div className="relative flex items-end justify-between gap-5 bg-[#101010] px-7 py-5">
          <div>
            <div className="flex items-center gap-2 text-[12px] font-black uppercase leading-none text-white">
              <Trophy className="h-4 w-4" />
              Zero Alpha Fitness
            </div>
            <div className="mt-2 text-[11px] font-bold uppercase leading-tight text-white/44">
              Performance earned, not guessed
            </div>
          </div>
          <div className="text-right text-[13px] font-black uppercase leading-none text-white">
            @zeroalphafitness
          </div>
        </div>
      </div>
    </div>
  );
}
