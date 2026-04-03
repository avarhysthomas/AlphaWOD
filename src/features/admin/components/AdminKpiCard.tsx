import React from "react";

type Props = {
  label: string;
  value: string | number;
  sublabel?: string;
};

export default function AdminKpiCard({ label, value, sublabel }: Props) {
  return (
    <div className="min-w-0 overflow-hidden rounded-[1.5rem] border border-white/10 bg-neutral-950 p-4 sm:rounded-3xl sm:p-5">
      <div className="truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500 sm:text-[11px] sm:tracking-[0.3em]">
        {label}
      </div>

      <div className="mt-3 truncate text-2xl font-semibold tracking-tight text-white sm:text-3xl">
        {value}
      </div>

      {sublabel ? (
        <div className="mt-2 truncate text-sm text-neutral-400">
          {sublabel}
        </div>
      ) : null}
    </div>
  );
}