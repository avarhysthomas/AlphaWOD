import React from "react";

type Props = {
  label: string;
  value: string | number;
  sublabel?: string;
};

export default function AdminKpiCard({ label, value, sublabel }: Props) {
  return (
    <div className="min-w-0 overflow-hidden rounded-[20px] border border-white/8 bg-[#11100f]/92 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] sm:p-5">
      <div className="truncate text-[10px] font-bold uppercase tracking-[0.18em] text-white/34 sm:text-[11px] sm:tracking-[0.24em]">
        {label}
      </div>

      <div className="mt-3 truncate font-mono text-3xl font-bold leading-none text-white sm:text-4xl">
        {value}
      </div>

      {sublabel ? (
        <div className="mt-2 truncate text-sm font-medium text-white/38">
          {sublabel}
        </div>
      ) : null}
    </div>
  );
}
